import { distToFootprint } from '../core/Grid';
import type { RestoreSource, TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

interface ChainRun {
  id: number;
  originTileId: string;
  startedAt: number;
  events: number;
  combo: number;
  pending: number;
  visited: Set<string>;
  mode: 'normal' | 'mega';
  budget: number; // max secondary restorations (mega mode)
  announced: boolean;
  biomass: number; // everything this chain earned (tiles + bonus), for the end-of-chain total
}

interface QueuedStep {
  chainId: number;
  tileId: string;
  fromTileId: string;
  at: number;
  seq: number;
}

/**
 * Bloom Chains: bounded, event-queued cascades.
 * - Restorations are never called recursively: follow-ups are queued with a delay.
 * - Each tile can join a chain at most once (visited set).
 * - A chain processes at most `maxEvents` restorations and lives at most `maxDuration` seconds.
 * - Solar boosts are terminal (they never restore tiles), so no solar/pulse feedback loop exists.
 */
export class BloomChainSystem {
  private runs = new Map<number, ChainRun>();
  private queue: QueuedStep[] = [];
  private nextChainId = 1;
  private seq = 0;

  constructor(private sim: Sim) {}

  get activeRuns() {
    return this.runs.size;
  }

  get pendingSteps() {
    return this.queue.length;
  }

  private newRun(origin: TileData, mode: ChainRun['mode'], budget = Infinity): ChainRun {
    const run: ChainRun = {
      id: this.nextChainId++,
      originTileId: origin.id,
      startedAt: this.sim.time,
      events: 0,
      combo: 0,
      pending: 0,
      visited: new Set([origin.id]),
      mode,
      budget,
      announced: false,
      biomass: 0,
    };
    this.runs.set(run.id, run);
    return run;
  }

  /** Called by RestorationSystem whenever a tile becomes restored. Returns the chain id. */
  onRestored(tile: TileData, _source: RestoreSource, chainId?: number): number {
    let run = chainId !== undefined ? this.runs.get(chainId) : undefined;
    if (!run) run = this.newRun(tile, 'normal');
    run.visited.add(tile.id);
    run.events++;
    this.boostAdjacentSolar(tile);
    this.expand(run, tile);
    return run.id;
  }

  addReward(chainId: number, biomass: number) {
    const run = this.runs.get(chainId);
    if (run) run.biomass += biomass;
  }

  /** Lucky Cat Mega Bloom: a free chain that may break through concrete too. */
  startMega(budget: number = TUNING.cat.megaBloomTiles): boolean {
    const s = this.sim;
    const restored = s.state.rooftops
      .filter((r) => r.unlocked && !r.preview)
      .flatMap((r) => r.tiles)
      .filter((t) => t.ground === 'restored' && s.grid.neighbors(t).some((n) => s.restoration.isEligible(n)));
    if (!restored.length) return false;
    const origin = s.rng.pick(restored);
    const run = this.newRun(origin, 'mega', budget);
    run.events++;
    this.expand(run, origin);
    return true;
  }

  private boostAdjacentSolar(tile: TileData) {
    for (const m of this.sim.state.machines) {
      if (m.type !== 'solar' || m.roofId !== tile.roofId) continue;
      if (distToFootprint(tile.x, tile.z, m.x, m.z, m.size) !== 1) continue;
      m.boostUntil = this.sim.time + TUNING.solarBloomBoost.seconds;
      this.sim.bus.emit('solar.boost', { machineId: m.id });
    }
  }

  private canSpread(run: ChainRun) {
    if (run.events >= TUNING.chain.maxEvents) return false;
    if (this.sim.time - run.startedAt > TUNING.chain.maxDuration) return false;
    if (run.mode === 'mega' && run.combo + run.pending >= run.budget) return false;
    return true;
  }

  private expand(run: ChainRun, from: TileData) {
    if (!this.canSpread(run)) return;
    const s = this.sim;
    const mega = run.mode === 'mega';
    if (!mega && !s.production.inPollinatorZone(from)) return;
    const cands = s.grid
      .neighbors(from)
      .filter((n) => !run.visited.has(n.id) && s.restoration.isEligible(n, mega))
      .filter((n) => mega || s.production.inPollinatorZone(n))
      .sort((a, b) => a.pollution - b.pollution || a.z - b.z || a.x - b.x);
    let room = TUNING.chain.maxEvents - run.events - run.pending;
    if (mega) room = Math.min(room, run.budget - run.combo - run.pending);
    const take = Math.max(0, Math.min(TUNING.chain.spreadPerStep, room));
    for (const n of cands.slice(0, take)) {
      run.visited.add(n.id);
      run.pending++;
      this.queue.push({ chainId: run.id, tileId: n.id, fromTileId: from.id, at: s.time + TUNING.chain.stepDelay, seq: this.seq++ });
    }
  }

  tick() {
    const s = this.sim;
    if (this.queue.length) {
      const due = this.queue.filter((q) => q.at <= s.time + 1e-9).sort((a, b) => a.at - b.at || a.seq - b.seq);
      if (due.length) this.queue = this.queue.filter((q) => q.at > s.time + 1e-9);
      for (const step of due) {
        const run = this.runs.get(step.chainId);
        if (!run) continue;
        run.pending--;
        const t = s.grid.byTileId(step.tileId);
        if (!t || !s.restoration.isEligible(t, run.mode === 'mega')) continue;
        if (run.events >= TUNING.chain.maxEvents) continue;
        if (!run.announced) {
          run.announced = true;
          s.bus.emit('chain.started', { chainId: run.id, originTileId: run.originTileId });
        }
        run.combo++;
        s.restoration.complete(t, run.mode === 'mega' ? 'mega' : 'chain', run.id);
        s.bus.emit('chain.step', { chainId: run.id, tileId: t.id, fromTileId: step.fromTileId, combo: run.combo });
      }
    }
    for (const run of [...this.runs.values()]) {
      if (run.pending > 0) continue;
      this.runs.delete(run.id);
      if (run.combo <= 0) continue;
      let bonus = 0;
      for (const m of TUNING.chain.milestones) if (run.combo >= m.combo) bonus += m.biomass;
      const got = bonus ? s.econ.add('biomass', bonus) : 0;
      s.state.stats.chains++;
      s.state.stats.maxCombo = Math.max(s.state.stats.maxCombo, run.combo);
      s.bus.emit('chain.ended', { chainId: run.id, combo: run.combo, bonus: got, total: run.biomass + got });
      if (got > 0) s.bus.emit('resource.gain', { kind: 'biomass', amount: got, reason: 'chain' });
    }
  }
}
