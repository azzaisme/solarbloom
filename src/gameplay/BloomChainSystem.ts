import { distToFootprint } from '../core/Grid';
import { LINKS, type RoofLinkDef } from '../data/rooftops';
import type { MachineData, RestoreSource, TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

export type ChainEventType =
  | 'RESTORE'
  | 'GROW'
  | 'POLLINATE'
  | 'PRODUCE_ENERGY'
  | 'PRODUCE_WATER'
  | 'CHARGE'
  | 'DISCHARGE'
  | 'RELAY' // a pulse arrives across a bridge (target = link id)
  | 'OVERFLOW' // a Reservoir Garden spills over (target = garden id)
  | 'CANOPY_BURST' // the Elder Tree releases its charge (target = tree id)
  | 'LUSH' // a relay pulse lands on a tile already in full bloom: it turns lush and its neighbours respond
  | 'REWARD';

/** One step of a Bloom Chain. Presentation replays these; it never decides outcomes. */
export interface ChainEvent {
  seq: number;
  type: ChainEventType;
  chainId: number;
  depth: number;
  /** tile id or machine id that caused it */
  source?: string;
  /** tile id or machine id it acts on */
  target: string;
  cause: RestoreSource | 'solar' | 'charge' | 'reward';
  /** RELAY: the rooftop the pulse arrives on. */
  roofId?: string;
  at: number;
  amount?: number;
}

interface ChainRun {
  id: number;
  originTileId: string;
  startedAt: number;
  processed: number;
  combo: number; // unique linked effects (excludes the triggering action and charge ticks)
  pending: number;
  visited: Set<string>; // tiles already restored/grown in this chain (one-time transitions)
  solarFired: Set<string>;
  pollinatorUses: Map<string, number>;
  dischargedTrees: Set<string>;
  /** Links this chain already crossed (each at most once, in either direction: no loops through relays). */
  relaysFired: Set<string>;
  /** Rooftops this chain touched. */
  roofs: Set<string>;
  /** Gardens boosted by an Overcharge Pulse in this chain (+1 pollination). */
  pollinatorBonus: Set<string>;
  mode: 'normal' | 'mega';
  budget: number;
  announced: boolean;
  biomass: number;
  energy: number;
  fastForward: boolean;
}

/** Effects that count toward the BLOOM CHAIN ×N combo and milestones. */
const COUNTED: ChainEventType[] = ['RESTORE', 'GROW', 'PRODUCE_ENERGY', 'PRODUCE_WATER', 'DISCHARGE', 'RELAY', 'OVERFLOW', 'CANOPY_BURST', 'LUSH'];

/**
 * Bloom Chains: `action → tile event → synergy checks → new events → reward aggregation`.
 * - Events are queued with a delay (never recursive) and processed in (time, sequence) order: reproducible.
 * - A tile transitions at most once per chain; each solar panel bursts once, each garden pollinates
 *   at most `triggersPerChain` times, each Mother Tree discharges once and never charges from its own pulse.
 * - At `maxEvents`/`maxDepth` a chain stops growing and its remaining queue fast-forwards.
 */
export class BloomChainSystem {
  private runs = new Map<number, ChainRun>();
  private queue: ChainEvent[] = [];
  private nextChainId = 1;
  private seq = 0;
  /** Event log of recent processed events (tests, debug overlay). */
  readonly history: ChainEvent[] = [];

  constructor(private sim: Sim) {}

  get activeRuns() {
    return this.runs.size;
  }

  get pendingSteps() {
    return this.queue.length;
  }

  private newRun(origin: TileData, mode: ChainRun['mode'] = 'normal', budget = Infinity): ChainRun {
    const run: ChainRun = {
      id: this.nextChainId++,
      originTileId: origin.id,
      startedAt: this.sim.time,
      processed: 0,
      combo: 0,
      pending: 0,
      visited: new Set([origin.id]),
      solarFired: new Set(),
      pollinatorUses: new Map(),
      dischargedTrees: new Set(),
      relaysFired: new Set(),
      pollinatorBonus: new Set(),
      roofs: new Set([origin.roofId]),
      mode,
      budget,
      announced: false,
      biomass: 0,
      energy: 0,
      fastForward: false,
    };
    this.runs.set(run.id, run);
    return run;
  }

  /** The furthest any machine reacts to a tile change (machine lookups only need to look this far). */
  synergyReach(): number {
    const u = this.sim.upgrades;
    return Math.max(1, u.pollinatorReach, u.treeRadius, TUNING.neighbourhood.canopy.chargeRadius, TUNING.neighbourhood.reservoir.radius);
  }

  /** Canopy Burst reach from the Elder Tree's footprint. */
  canopyBurstRadius(): number {
    const c = TUNING.neighbourhood.canopy;
    return this.sim.hood.coreAwake('r3') ? c.burstRadiusAwake : c.burstRadius;
  }

  /** A Pollinator Garden inside the Elder Tree's burst amplifies it. */
  inCanopyBurst(tree: MachineData, garden: MachineData): boolean {
    return garden.roofId === tree.roofId && distToFootprint(garden.x, garden.z, tree.x, tree.z, tree.size) <= this.canopyBurstRadius();
  }

  addReward(chainId: number, biomass: number) {
    const run = this.runs.get(chainId);
    if (run) run.biomass += biomass;
  }

  // ───────────── entry points (called by RestorationSystem and machines) ─────────────

  /** A tile became restored. Starts a chain if it isn't part of one. Returns the chain id. */
  onRestored(tile: TileData, _source: RestoreSource, chainId?: number): number {
    const run = (chainId !== undefined && this.runs.get(chainId)) || this.newRun(tile);
    run.visited.add(tile.id);
    this.react(run, tile, 'RESTORE', this.depthOf(tile.id, run));
    return run.id;
  }

  /** A restored tile grew a bloom level (nurture, pollination, watering, tree pulse). */
  onGrown(tile: TileData, chainId?: number): number {
    const run = (chainId !== undefined && this.runs.get(chainId)) || this.newRun(tile);
    run.visited.add(tile.id);
    this.react(run, tile, 'GROW', this.depthOf(tile.id, run));
    return run.id;
  }

  private depthMap = new Map<string, number>();
  private depthOf(tileId: string, run: ChainRun) {
    return this.depthMap.get(`${run.id}|${tileId}`) ?? 0;
  }

  /** Water Condenser at full charge: waters the dry soil beside it. Returns false if there is nothing to water. */
  startWater(m: MachineData): boolean {
    const s = this.sim;
    const extra = s.upgrades.waterBloom;
    const near = s.grid.tilesNear(m, TUNING.condenser.radius);
    const dry = near.filter((t) => t.ground === 'prepared' && s.restoration.isEligible(t, false));
    const growable = extra > 0 ? near.filter((t) => t.ground === 'restored' && !t.occupantId && t.bloom < TUNING.restore.maxBloom) : [];
    if (!dry.length && !growable.length) return false;
    const origin = dry[0] ?? growable[0];
    const run = this.newRun(origin);
    run.visited.delete(origin.id);
    this.enqueue(run, { type: 'PRODUCE_WATER', source: m.id, target: m.id, cause: 'condenser', depth: 0 }, 0);
    return true;
  }

  /** Overcharge Pulse: a manual pulse right next to a machine boosts its next trigger (used up here). */
  consumeOvercharge(m: MachineData): boolean {
    if ((m.overchargeUntil ?? 0) <= this.sim.time) return false;
    m.overchargeUntil = 0;
    this.sim.bus.emit('machine.boostUsed', { machineId: m.id });
    return true;
  }

  /**
   * Tiles a Reservoir Garden's Overflow waters, nearest first: dry ground (mossy before concrete) is
   * irrigated into bloom; with nothing dry left, green tiles that can still grow get a bloom level instead.
   */
  overflowTargets(g: MachineData, count: number, visited?: Set<string>): TileData[] {
    const s = this.sim;
    const rank = (t: TileData) => (t.ground === 'prepared' ? 0 : t.ground === 'polluted' ? 1 : 2);
    return s.grid
      .tilesNear(g, TUNING.neighbourhood.reservoir.radius)
      .filter((t) => (!visited || !visited.has(t.id)) && !t.occupantId)
      .filter((t) => s.restoration.isEligible(t) || (t.ground === 'restored' && t.bloom < TUNING.restore.maxBloom))
      .map((t) => ({ t, d: distToFootprint(t.x, t.z, g.x, g.z, g.size) }))
      .sort((a, b) => rank(a.t) - rank(b.t) || a.d - b.d || a.t.z - b.t.z || a.t.x - b.t.x)
      .slice(0, count)
      .map((x) => x.t);
  }

  /** Reservoir Garden basin is full: it spills over (a chain). It never waits: with nothing to water it just splashes. */
  startOverflow(g: MachineData): boolean {
    const origin = this.sim.grid.get(g.roofId, g.x, g.z)!;
    const run = this.newRun(origin);
    run.visited.delete(origin.id);
    this.enqueue(run, { type: 'OVERFLOW', source: g.id, target: g.id, cause: 'overflow', depth: 0 }, 0);
    return true;
  }

  /** The Elder Tree's ring filled outside a chain (its slow self-charge): release a Canopy Burst. */
  startCanopyBurst(tree: MachineData): boolean {
    const origin = this.sim.grid.get(tree.roofId, tree.x, tree.z)!;
    const run = this.newRun(origin);
    run.visited.delete(origin.id);
    run.dischargedTrees.add(tree.id);
    this.enqueue(run, { type: 'CANOPY_BURST', source: tree.id, target: tree.id, cause: 'canopy', depth: 0 }, 0.2);
    return true;
  }

  /** Lucky Cat's Garden: restores and decorates a small cluster as one free chain. */
  startCatGarden(tiles: TileData[]): boolean {
    if (!tiles.length) return false;
    const run = this.newRun(tiles[0], 'mega', tiles.length * 2);
    run.visited.delete(tiles[0].id);
    tiles.forEach((t, i) => {
      run.visited.add(t.id);
      if (t.ground !== 'restored') this.enqueue(run, { type: 'RESTORE', source: tiles[0].id, target: t.id, cause: 'cat', depth: 1 }, 0.2 + i * 0.12);
      this.enqueue(run, { type: 'GROW', source: tiles[0].id, target: t.id, cause: 'cat', depth: 1 }, 0.55 + i * 0.12);
    });
    return true;
  }

  /** Lucky Cat Mega Bloom: a free chain that may break through concrete too. */
  startMega(budget: number = TUNING.cat.megaBloomTiles): boolean {
    const s = this.sim;
    const restored = s.grid
      .playableTiles()
      .filter((t) => t.ground === 'restored' && s.grid.neighbors(t).some((n) => s.restoration.isEligible(n)));
    if (!restored.length) return false;
    const origin = s.rng.pick(restored);
    const run = this.newRun(origin, 'mega', budget);
    this.spreadMega(run, origin, 0);
    return true;
  }

  // ───────────── synergy checks ─────────────

  private canGrow(run: ChainRun, depth: number) {
    return !run.fastForward && run.processed + run.pending < TUNING.chain.maxEvents && depth < TUNING.chain.maxDepth;
  }

  private enqueue(run: ChainRun, e: Omit<ChainEvent, 'seq' | 'chainId' | 'at'>, delay: number = TUNING.chain.stepDelay) {
    run.pending++;
    const ev: ChainEvent = { ...e, seq: this.seq++, chainId: run.id, at: this.sim.time + delay };
    if (e.type === 'RESTORE' || e.type === 'GROW' || e.type === 'POLLINATE') this.depthMap.set(`${run.id}|${e.target}`, e.depth);
    this.queue.push(ev);
  }

  /** Which nearby elements respond to `tile` changing. Adjacency is grid-based (N/E/S/W by default). */
  private react(run: ChainRun, tile: TileData, kind: 'RESTORE' | 'GROW', depth: number) {
    const s = this.sim;
    if (!this.canGrow(run, depth)) return;
    const machines = s.grid.machinesNear(tile.roofId, tile.x, tile.z, this.synergyReach());
    for (const m of machines) {
      const d = distToFootprint(tile.x, tile.z, m.x, m.z, m.size);
      if (m.type === 'solar' && d === 1 && !run.solarFired.has(m.id)) {
        run.solarFired.add(m.id);
        this.enqueue(run, { type: 'PRODUCE_ENERGY', source: tile.id, target: m.id, cause: 'solar', depth: depth + 1 });
      } else if (m.type === 'pollinator' && d >= 1 && d <= s.upgrades.pollinatorReach) {
        // Newly restored *or* newly grown plants pollinate (limited per garden per chain).
        const used = run.pollinatorUses.get(m.id) ?? 0;
        if (used === 0 && this.consumeOvercharge(m)) run.pollinatorBonus.add(m.id);
        if (used >= TUNING.pollinator.triggersPerChain + (run.pollinatorBonus.has(m.id) ? 1 : 0)) continue;
        const target = this.pollinationTarget(run, m, tile);
        if (!target) continue;
        run.pollinatorUses.set(m.id, used + 1);
        run.visited.add(target.id);
        this.enqueue(run, { type: 'POLLINATE', source: m.id, target: target.id, cause: 'pollinate', depth: depth + 1 });
      } else if (m.type === 'motherTree' && d >= 1 && d <= s.upgrades.treeRadius && !run.dischargedTrees.has(m.id)) {
        this.enqueue(run, { type: 'CHARGE', source: tile.id, target: m.id, cause: 'charge', depth: depth + 1 }, TUNING.chain.stepDelay * 0.6);
      } else if (m.type === 'core' && m.roofId === 'r3' && d >= 1 && d <= TUNING.neighbourhood.canopy.chargeRadius && !run.dischargedTrees.has(m.id)) {
        // The Canopy's Elder Tree charges from blooms around it (dormant or awake).
        this.enqueue(run, { type: 'CHARGE', source: tile.id, target: m.id, cause: 'charge', depth: depth + 1 }, TUNING.chain.stepDelay * 0.6);
      }
    }
    if (run.mode === 'mega' && kind === 'RESTORE') this.spreadMega(run, tile, depth);
    this.reactRelays(run, tile, depth);
  }

  // ───────────── cross-roof relays ─────────────

  /** The edge tile of a link on a given roof. */
  private relayTile(l: RoofLinkDef, roofId: string): [number, number] {
    return l.from === roofId ? l.fromTile : l.toTile;
  }

  /** Tiles whose chain effects charge a link's relay on this roof. */
  relayZone(l: RoofLinkDef, roofId: string): TileData[] {
    const [rx, rz] = this.relayTile(l, roofId);
    const R = TUNING.neighbourhood.relay.zoneRadius;
    return this.sim.grid.tilesWithin(roofId, rx, rz, R);
  }

  /**
   * A chain effect inside a relay's zone sends one pulse across its bridge (once per link per chain,
   * only when the relay has recharged, and only if something on the far side can bloom).
   */
  private reactRelays(run: ChainRun, tile: TileData, depth: number) {
    const s = this.sim;
    if (!this.canGrow(run, depth)) return;
    for (const l of LINKS) {
      if (l.from !== tile.roofId && l.to !== tile.roofId) continue;
      if (run.relaysFired.has(l.id) || !s.hood.relayReady(l.id)) continue;
      const [rx, rz] = this.relayTile(l, tile.roofId);
      if (Math.abs(tile.x - rx) + Math.abs(tile.z - rz) > TUNING.neighbourhood.relay.zoneRadius) continue;
      const remote = l.from === tile.roofId ? l.to : l.from;
      if (!s.grid.isPlayable(remote) || !this.remoteTargets(run, l, remote, 1).length) continue;
      run.relaysFired.add(l.id);
      const st = s.state.links[l.id];
      st.readyAt = s.time + s.hood.relayCooldown();
      const travel = TUNING.neighbourhood.relay.travelSeconds;
      this.enqueue(run, { type: 'RELAY', source: tile.id, target: l.id, cause: 'relay', depth: depth + 1, roofId: remote }, travel);
      s.bus.emit('relay.sent', { linkId: l.id, fromRoof: tile.roofId, toRoof: remote, chainId: run.id, travel });
    }
  }

  /**
   * Where a relay pulse lands on the far roof: synergy spots near the arriving pylon first. Dead ground
   * restores and grass grows; if everything nearby is already in full bloom, those tiles turn lush, so a
   * crossing always does something visible (and the machines beside it respond).
   */
  remoteTargets(run: ChainRun | undefined, l: RoofLinkDef, roofId: string, count: number): TileData[] {
    const s = this.sim;
    const roof = s.grid.roof(roofId);
    if (!roof || count <= 0) return [];
    const [rx, rz] = this.relayTile(l, roofId);
    const R = TUNING.neighbourhood.relay.remoteRadius;
    const growable = (t: TileData) => t.ground === 'restored' && !t.occupantId && t.bloom < TUNING.restore.maxBloom;
    const lushable = (t: TileData) => t.ground === 'restored' && !t.occupantId && !t.blocked;
    const near = s.grid.tilesWithin(roofId, rx, rz, R).filter((t) => !run || !run.visited.has(t.id));
    const rank = (list: TileData[]) =>
      list
        .map((t) => ({ t, score: this.synergyAt(t), d: Math.abs(t.x - rx) + Math.abs(t.z - rz) }))
        .sort((a, b) => b.score - a.score || a.d - b.d || a.t.z - b.t.z || a.t.x - b.t.x)
        .map((c) => c.t);
    const live = rank(near.filter((t) => s.restoration.isEligible(t) || growable(t)));
    const lush = live.length >= count ? [] : rank(near.filter((t) => !live.includes(t) && lushable(t)));
    return [...live, ...lush].slice(0, count);
  }

  /** How likely a bloom here is to set something off (relay targeting; mirrors the drone heuristic). */
  synergyAt(t: TileData): number {
    const s = this.sim;
    let score = 0;
    for (const m of s.grid.machinesNear(t.roofId, t.x, t.z, this.synergyReach())) {
      const d = distToFootprint(t.x, t.z, m.x, m.z, m.size);
      if (d < 1) continue;
      if (m.type === 'pollinator' && d <= s.upgrades.pollinatorReach) score += 3;
      else if (m.type === 'solar' && d === 1) score += 1.5;
      else if (m.type === 'motherTree' && d <= s.upgrades.treeRadius) score += 2;
      else if (m.type === 'core' && m.roofId === 'r3' && d <= TUNING.neighbourhood.canopy.chargeRadius) score += 2;
      else if (m.type === 'reservoirGarden' && d <= TUNING.neighbourhood.reservoir.radius) score += 1;
    }
    return score;
  }

  /** Deterministic choice: mossy soil first, then concrete, then a green tile that can still grow. */
  private pollinationTarget(run: ChainRun, p: MachineData, from: TileData): TileData | undefined {
    const s = this.sim;
    const reach = s.upgrades.pollinatorReach;
    const cands = s.grid
      .tilesNear(p, reach)
      .filter((t) => !run.visited.has(t.id) && !t.occupantId)
      .filter((t) => s.restoration.isEligible(t) || (t.ground === 'restored' && t.bloom < TUNING.restore.maxBloom));
    const rank = (t: TileData) => (t.ground === 'prepared' ? 0 : t.ground === 'polluted' ? 1 : 2);
    const dist = (t: TileData) => Math.abs(t.x - from.x) + Math.abs(t.z - from.z);
    cands.sort((a, b) => rank(a) - rank(b) || a.pollution - b.pollution || dist(a) - dist(b) || a.z - b.z || a.x - b.x);
    return cands[0];
  }

  private spreadMega(run: ChainRun, from: TileData, depth: number) {
    const s = this.sim;
    const cands = s.grid
      .neighbors(from)
      .filter((n) => !run.visited.has(n.id) && s.restoration.isEligible(n))
      .sort((a, b) => a.pollution - b.pollution || a.z - b.z || a.x - b.x);
    for (const n of cands) {
      if (run.combo + run.pending >= run.budget || !this.canGrow(run, depth)) return;
      run.visited.add(n.id);
      this.enqueue(run, { type: 'RESTORE', source: from.id, target: n.id, cause: 'mega', depth: depth + 1 });
    }
  }

  // ───────────── processing ─────────────

  tick() {
    const s = this.sim;
    const now = s.time;
    // Long chains fast-forward: stop growing, resolve what's queued right away.
    for (const run of this.runs.values()) {
      if (!run.fastForward && (now - run.startedAt > TUNING.chain.fastForwardAfter || run.processed >= TUNING.chain.maxEvents)) {
        run.fastForward = true;
        for (const q of this.queue) if (q.chainId === run.id) q.at = Math.min(q.at, now);
        s.bus.emit('chain.fastForward', { chainId: run.id });
      }
    }
    // Process due events in (time, sequence) order. New events are always scheduled in the future,
    // except fast-forwarded ones, so loop until nothing due remains (bounded by caps).
    let guard = 0;
    while (guard++ < 1000) {
      let idx = -1;
      for (let i = 0; i < this.queue.length; i++) {
        const q = this.queue[i];
        if (q.at > now + 1e-9) continue;
        if (idx < 0 || q.at < this.queue[idx].at - 1e-9 || (Math.abs(q.at - this.queue[idx].at) < 1e-9 && q.seq < this.queue[idx].seq)) idx = i;
      }
      if (idx < 0) break;
      const ev = this.queue.splice(idx, 1)[0];
      const run = this.runs.get(ev.chainId);
      if (!run) continue;
      run.pending--;
      this.process(run, ev);
    }
    for (const run of [...this.runs.values()]) if (run.pending <= 0) this.finish(run);
  }

  private announce(run: ChainRun) {
    if (run.announced) return;
    run.announced = true;
    this.sim.bus.emit('chain.started', { chainId: run.id, originTileId: run.originTileId });
  }

  private emit(run: ChainRun, ev: ChainEvent) {
    run.processed++;
    if (COUNTED.includes(ev.type)) {
      run.combo++;
      this.announce(run);
    }
    this.history.push(ev);
    if (this.history.length > 300) this.history.splice(0, this.history.length - 300);
    this.sim.bus.emit('chain.event', { event: ev, combo: run.combo });
  }

  private process(run: ChainRun, ev: ChainEvent) {
    const s = this.sim;
    switch (ev.type) {
      case 'RESTORE': {
        const t = s.grid.byTileId(ev.target);
        if (!t || !s.restoration.isEligible(t, true)) return;
        run.roofs.add(t.roofId);
        this.emit(run, ev);
        s.restoration.complete(t, ev.cause as RestoreSource, run.id);
        return;
      }
      case 'GROW': {
        const t = s.grid.byTileId(ev.target);
        if (!t || t.ground !== 'restored' || t.bloom >= TUNING.restore.maxBloom) return;
        this.emit(run, ev);
        s.restoration.grow(t, run.id);
        return;
      }
      case 'POLLINATE': {
        const t = s.grid.byTileId(ev.target);
        if (!t) return;
        this.emit(run, ev); // the pollen arc; the restore/grow below is the counted effect
        if (s.restoration.isEligible(t, true)) {
          run.combo++;
          this.announce(run);
          s.restoration.complete(t, 'pollinate', run.id);
        } else if (t.ground === 'restored' && t.bloom < TUNING.restore.maxBloom) {
          run.combo++;
          this.announce(run);
          s.restoration.grow(t, run.id);
        }
        return;
      }
      case 'PRODUCE_ENERGY': {
        const m = s.machine(ev.target);
        if (!m) return;
        m.boostUntil = s.time + TUNING.solarBloomBoost.seconds;
        const boost = this.consumeOvercharge(m) ? 2 : 1;
        const got = s.econ.add('energy', TUNING.solarBloomBoost.burstEnergy * s.upgrades.solarMult * boost);
        run.energy += got;
        this.emit(run, { ...ev, amount: got });
        s.bus.emit('solar.boost', { machineId: m.id });
        if (got > 0) s.bus.emit('resource.gain', { kind: 'energy', amount: got, reason: `machine:${m.id}` });
        return;
      }
      case 'PRODUCE_WATER': {
        const m = s.machine(ev.target);
        if (!m) return;
        m.charge = 0;
        this.emit(run, ev);
        const near = s.grid.tilesNear(m, TUNING.condenser.radius);
        const targets = TUNING.condenser.targets + s.upgrades.waterBloom + (this.consumeOvercharge(m) ? 1 : 0);
        const dry = near.filter((t) => t.ground === 'prepared' && s.restoration.isEligible(t, false) && !run.visited.has(t.id));
        const grow = s.upgrades.waterBloom > 0 ? near.filter((t) => t.ground === 'restored' && !t.occupantId && t.bloom < TUNING.restore.maxBloom && !run.visited.has(t.id)) : [];
        for (const t of [...dry, ...grow].slice(0, targets)) {
          run.visited.add(t.id);
          this.enqueue(run, { type: t.ground === 'restored' ? 'GROW' : 'RESTORE', source: m.id, target: t.id, cause: 'condenser', depth: ev.depth + 1 });
        }
        return;
      }
      case 'CHARGE': {
        const m = s.machine(ev.target);
        if (!m || run.dischargedTrees.has(m.id)) return;
        const elder = m.type === 'core';
        const threshold = elder ? TUNING.neighbourhood.canopy.threshold : TUNING.motherTree.threshold;
        m.charge = Math.min(threshold, m.charge + 1);
        this.emit(run, { ...ev, amount: m.charge });
        if (m.charge >= threshold && this.canGrow(run, ev.depth)) {
          run.dischargedTrees.add(m.id); // it can't charge again from its own pulse
          if (elder) this.enqueue(run, { type: 'CANOPY_BURST', source: m.id, target: m.id, cause: 'canopy', depth: ev.depth + 1 }, 0.5);
          else this.enqueue(run, { type: 'DISCHARGE', source: m.id, target: m.id, cause: 'motherTree', depth: ev.depth + 1 }, 0.45);
        }
        return;
      }
      case 'OVERFLOW': {
        const g = s.machine(ev.target);
        if (!g) return;
        const R = TUNING.neighbourhood.reservoir;
        const n = R.targets + (this.consumeOvercharge(g) ? 1 : 0);
        const targets = this.overflowTargets(g, n, run.visited);
        g.charge = 0;
        // Nothing to water: the spill still freshens the green around it (lush), so it always counts.
        if (!targets.length)
          for (const t of s.grid.tilesNear(g, TUNING.neighbourhood.reservoir.radius))
            if (t.ground === 'restored' && !t.occupantId) t.lushUntil = s.time + TUNING.neighbourhood.reservoir.lushSeconds;
        s.production.markDirty();
        s.state.progression.overflows = (s.state.progression.overflows ?? 0) + 1;
        this.emit(run, { ...ev, amount: targets.length });
        s.bus.emit('reservoir.overflow', { machineId: g.id, tiles: targets.map((t) => t.id) });
        targets.forEach((t, i) => {
          run.visited.add(t.id);
          this.enqueue(run, { type: t.ground === 'restored' ? 'GROW' : 'RESTORE', source: g.id, target: t.id, cause: 'overflow', depth: ev.depth + 1 }, 0.15 + i * 0.12);
        });
        return;
      }
      case 'CANOPY_BURST': {
        const m = s.machine(ev.target);
        if (!m) return;
        m.charge = 0;
        s.state.progression.canopyBursts = (s.state.progression.canopyBursts ?? 0) + 1;
        this.emit(run, ev);
        const radius = this.canopyBurstRadius() + (this.consumeOvercharge(m) ? 1 : 0);
        const ok = (t: TileData) => !run.visited.has(t.id) && (s.restoration.isEligible(t) || (t.ground === 'restored' && !t.occupantId && t.bloom < TUNING.restore.maxBloom));
        const inside = s.grid
          .tilesNear(m, radius)
          .filter(ok)
          .map((t) => ({ t, d: distToFootprint(t.x, t.z, m.x, m.z, m.size) }))
          .sort((a, b) => a.d - b.d || a.t.z - b.t.z || a.t.x - b.t.x);
        // Pollinator Gardens inside the burst carry it further: extra blooms beyond its edge, nearest the garden.
        const gardens = s.state.machines.filter((g) => g.type === 'pollinator' && this.inCanopyBurst(m, g));
        const extra: { t: TileData; d: number }[] = [];
        const taken = new Set(inside.map((x) => x.t.id));
        for (const g of gardens) {
          const beyond = s.grid
            .tilesNear(g, s.upgrades.pollinatorReach + 2)
            .filter((t) => ok(t) && !taken.has(t.id) && distToFootprint(t.x, t.z, m.x, m.z, m.size) > radius)
            .sort((a, b) => distToFootprint(a.x, a.z, g.x, g.z, 1) - distToFootprint(b.x, b.z, g.x, g.z, 1) || a.z - b.z || a.x - b.x)
            .slice(0, TUNING.neighbourhood.canopy.gardenBonusTargets);
          for (const t of beyond) {
            taken.add(t.id);
            extra.push({ t, d: distToFootprint(t.x, t.z, m.x, m.z, m.size) });
          }
        }
        s.bus.emit('canopy.burst', { machineId: m.id, radius, gardens: gardens.map((g) => g.id) });
        for (const { t, d } of [...inside, ...extra]) {
          if (!this.canGrow(run, ev.depth)) break;
          run.visited.add(t.id);
          this.enqueue(run, { type: t.ground === 'restored' ? 'GROW' : 'RESTORE', source: m.id, target: t.id, cause: 'canopy', depth: ev.depth + 1 }, 0.15 + d * 0.16);
        }
        return;
      }
      case 'DISCHARGE': {
        const m = s.machine(ev.target);
        if (!m) return;
        m.charge = 0;
        this.emit(run, ev);
        s.bus.emit('tree.discharged', { machineId: m.id });
        const tiles = s.grid
          .tilesNear(m, s.upgrades.treeRadius + (this.consumeOvercharge(m) ? 1 : 0))
          .filter((t) => !run.visited.has(t.id))
          .filter((t) => s.restoration.isEligible(t) || (t.ground === 'restored' && !t.occupantId && t.bloom < TUNING.restore.maxBloom))
          .map((t) => ({ t, d: distToFootprint(t.x, t.z, m.x, m.z, m.size) }))
          .sort((a, b) => a.d - b.d || a.t.z - b.t.z || a.t.x - b.t.x);
        for (const { t, d } of tiles) {
          if (!this.canGrow(run, ev.depth)) break;
          run.visited.add(t.id);
          // A ring wave outward from the trunk.
          this.enqueue(run, { type: t.ground === 'restored' ? 'GROW' : 'RESTORE', source: m.id, target: t.id, cause: 'motherTree', depth: ev.depth + 1 }, 0.12 + d * 0.14);
        }
        return;
      }
      case 'RELAY': {
        const l = LINKS.find((x) => x.id === ev.target);
        const remote = ev.roofId;
        if (!l || !remote) return;
        let n = s.hood.relayTargets();
        if (s.state.relayBonus > 0) {
          n += s.state.relayBonus; // Golden Relay (Lucky Cat): spent on this crossing
          s.state.relayBonus = 0;
        }
        const targets = this.remoteTargets(run, l, remote, n);
        const st = s.state.links[l.id];
        if (st) st.crossings++;
        run.roofs.add(remote);
        this.emit(run, { ...ev, amount: targets.length });
        targets.forEach((t, i) => {
          run.visited.add(t.id);
          const type = t.ground !== 'restored' ? 'RESTORE' : t.bloom < TUNING.restore.maxBloom ? 'GROW' : 'LUSH';
          this.enqueue(run, { type, source: ev.target, target: t.id, cause: 'relay', depth: ev.depth + 1 }, 0.12 + i * 0.12);
        });
        return;
      }
      case 'LUSH': {
        const t = s.grid.byTileId(ev.target);
        if (!t || t.ground !== 'restored') return;
        t.lushUntil = s.time + TUNING.neighbourhood.reservoir.lushSeconds;
        s.production.markDirty();
        run.roofs.add(t.roofId);
        this.emit(run, ev);
        this.react(run, t, 'GROW', ev.depth);
        return;
      }
      case 'REWARD':
        return;
    }
  }

  private finish(run: ChainRun) {
    const s = this.sim;
    this.runs.delete(run.id);
    for (const k of [...this.depthMap.keys()]) if (k.startsWith(`${run.id}|`)) this.depthMap.delete(k);
    if (run.combo <= 0) return;
    const milestone = [...TUNING.chain.milestones].reverse().find((m) => run.combo >= m.effects);
    const pct = milestone?.pct ?? 0;
    const perEffect = run.combo > 1 ? TUNING.chain.perEffectBiomass * run.combo : 0;
    const bonus = Math.round((perEffect + (run.biomass + perEffect) * pct) * 10) / 10;
    const got = bonus > 0 ? s.econ.add('biomass', bonus) : 0;
    s.state.stats.chains++;
    s.state.stats.maxCombo = Math.max(s.state.stats.maxCombo, run.combo);
    const reward: ChainEvent = { seq: this.seq++, type: 'REWARD', chainId: run.id, depth: 0, target: run.originTileId, cause: 'reward', at: s.time, amount: got };
    this.history.push(reward);
    s.bus.emit('chain.event', { event: reward, combo: run.combo });
    s.bus.emit('chain.ended', {
      chainId: run.id,
      combo: run.combo,
      bonus: Math.round(got * 10) / 10,
      total: run.biomass + got,
      milestonePct: pct,
      energy: run.energy,
      roofs: [...run.roofs],
      crossings: run.relaysFired.size,
    });
    if (run.relaysFired.size) s.metrics.first('remoteChain');
    if (got > 0) s.bus.emit('resource.gain', { kind: 'biomass', amount: got, reason: 'chain' });
    s.metrics.onChain(run.combo);
  }
}
