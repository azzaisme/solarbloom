import { big, type Big } from '../core/Big';
import { GROUND } from '../core/GameState';
import { distToFootprint } from '../core/Grid';
import type { MachineData, RestoreSource, TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';
import { relayLinkId } from './RelaySystem';

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
  | 'CORRIDOR' // a street garden passes the chain to the next garden along the street (target = garden id)
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
  /** Presentation only: a resource amount (Decimal) or a count of targets / charge. */
  amount?: Big | number;
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
  pollinatorBonus: Map<string, number>;
  /** Corridor gardens that already passed the chain on (once each per chain). */
  corridorFired: Set<string>;
  /** City 10.3: Reservoir Gardens that sent or received a spill along a canal in this chain (once each). */
  canalSpilled: Set<string>;
  /** City areas this chain touched (for the summary). */
  areas: Set<string>;
  mode: 'normal' | 'mega';
  budget: number;
  /** who set it off: a manual action, or automation (drones, condensers, timers, rewards) */
  starter: ChainStarter;
  announced: boolean;
  biomass: Big;
  energy: Big;
  fastForward: boolean;
}

/** Earlier (time, then sequence) first. Times within 1e-9 count as equal. */
function before(a: ChainEvent, b: ChainEvent) {
  return Math.abs(a.at - b.at) < 1e-9 ? a.seq < b.seq : a.at < b.at;
}

/** Binary min-heap of queued chain events: O(log n) push/pop instead of a scan per event. */
class EventHeap {
  private a: ChainEvent[] = [];
  get length() {
    return this.a.length;
  }
  push(e: ChainEvent) {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  peek(): ChainEvent | undefined {
    return this.a[0];
  }
  /** Every queued event (heap order, not time order). */
  items(): readonly ChainEvent[] {
    return this.a;
  }
  pop(): ChainEvent | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      this.down(0);
    }
    return top;
  }
  private down(i: number) {
    const a = this.a;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < a.length && before(a[l], a[m])) m = l;
      if (r < a.length && before(a[r], a[m])) m = r;
      if (m === i) return;
      [a[i], a[m]] = [a[m], a[i]];
      i = m;
    }
  }
  /** Changes event times in place (fast-forward), then restores heap order. */
  update(fn: (e: ChainEvent) => void) {
    for (const e of this.a) fn(e);
    for (let i = (this.a.length >> 1) - 1; i >= 0; i--) this.down(i);
  }
}

/** Effects that count toward the BLOOM CHAIN ×N combo and milestones. */
const COUNTED: ChainEventType[] = ['RESTORE', 'GROW', 'PRODUCE_ENERGY', 'PRODUCE_WATER', 'DISCHARGE', 'RELAY', 'OVERFLOW', 'CANOPY_BURST', 'LUSH'];

/** Pollinator Gardens standing on streets and paths form green corridors. */
const CORRIDOR_GROUND = new Set(['road', 'paving']);

export type ChainStarter = 'player' | 'auto';
/** Restorations that are the player's own taps. */
const PLAYER_SOURCES = new Set<RestoreSource>(['pulse', 'broad', 'mega']);

/**
 * Bloom Chains: `action → tile event → synergy checks → new events → reward aggregation`.
 * - Events are queued with a delay (never recursive) and processed in (time, sequence) order: reproducible.
 * - A tile transitions at most once per chain; each solar panel bursts once, each garden pollinates
 *   at most `triggersPerChain` times, each Mother Tree discharges once and never charges from its own pulse.
 * - At `maxEvents`/`maxDepth` a chain stops growing and its remaining queue fast-forwards.
 */
export class BloomChainSystem {
  private runs = new Map<number, ChainRun>();
  private queue = new EventHeap();
  private nextChainId = 1;
  private seq = 0;
  /** Event log of recent processed events (tests, debug overlay). */
  readonly history: ChainEvent[] = [];

  constructor(private sim: Sim) {}

  /** Areas that a running chain is blooming right now (overview icons). */
  activeAreas(): Set<string> {
    const out = new Set<string>();
    for (const r of this.runs.values()) for (const a of r.areas) out.add(a);
    return out;
  }

  /** Targets of every queued chain event (tile or machine ids): where chains are working right now. */
  queuedTargets(): string[] {
    return this.queue.items().map((e) => e.target);
  }

  get activeRuns() {
    return this.runs.size;
  }

  get pendingSteps() {
    return this.queue.length;
  }

  private newRun(origin: TileData, mode: ChainRun['mode'] = 'normal', budget = Infinity, starter: ChainStarter = 'auto'): ChainRun {
    const run: ChainRun = {
      starter,
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
      pollinatorBonus: new Map(),
      corridorFired: new Set(),
      canalSpilled: new Set(),
      areas: new Set(),
      roofs: new Set([origin.roofId]),
      mode,
      budget,
      announced: false,
      biomass: big(0),
      energy: big(0),
      fastForward: false,
    };
    this.runs.set(run.id, run);
    return run;
  }

  /** The furthest any machine reacts to a tile change (machine lookups only need to look this far). */
  synergyReach(): number {
    const u = this.sim.upgrades;
    return Math.max(1, u.maxPollinatorReach, TUNING.motherTree.radius + u.maxLevelOf('treeResonance'), TUNING.neighbourhood.canopy.chargeRadius, TUNING.neighbourhood.reservoir.radius);
  }

  /** Event cap per chain: bigger in the endless city. */
  maxEvents(): number {
    return this.sim.progression.homeIsPark ? TUNING.chain.maxEventsCity : TUNING.chain.maxEvents;
  }

  /** Is this garden part of a green corridor (standing on a street or path)? */
  isCorridor(m: MachineData): boolean {
    if (m.type !== 'pollinator') return false;
    const t = this.sim.grid.get(m.roofId, m.x, m.z);
    return !!t && CORRIDOR_GROUND.has(t.feature ?? '');
  }

  /** The other corridor gardens within reach of one (nearest first, deterministic). */
  corridorNext(m: MachineData): MachineData[] {
    const R = this.sim.upgrades.corridorRange;
    return this.sim.grid
      .machinesNear(m.roofId, m.x, m.z, R)
      .filter((o) => o !== m && this.isCorridor(o))
      .sort((a, b) => distToFootprint(a.x, a.z, m.x, m.z, 1) - distToFootprint(b.x, b.z, m.x, m.z, 1) || (a.id < b.id ? -1 : 1));
  }

  /** An Elder Tree: a grove's landmark. */
  isElder(m: Pick<MachineData, 'type' | 'roofId' | 'x' | 'z'>): boolean {
    if (m.type !== 'core') return false;
    const id = m.roofId === GROUND ? this.sim.areas.areaOf(m) : undefined;
    return !!id && this.sim.areas.info(id).landmarkKind === 'elder';
  }

  /** Canopy Burst reach from an Elder Tree's footprint (further once its grove is awake). */
  canopyBurstRadius(tree?: Pick<MachineData, 'roofId' | 'x' | 'z'>): number {
    const c = TUNING.neighbourhood.canopy;
    const id = tree ? this.sim.areas.areaOf(tree) : undefined;
    const awake = !!id && this.sim.areas.fog(id) === 'cleared';
    return awake ? c.burstRadiusAwake : c.burstRadius;
  }

  /** A Pollinator Garden inside the Elder Tree's burst amplifies it. */
  inCanopyBurst(tree: MachineData, garden: MachineData): boolean {
    return garden.roofId === tree.roofId && distToFootprint(garden.x, garden.z, tree.x, tree.z, tree.size) <= this.canopyBurstRadius(tree);
  }

  addReward(chainId: number, biomass: Big) {
    const run = this.runs.get(chainId);
    if (run) run.biomass = run.biomass.add(biomass);
  }

  // ───────────── entry points (called by RestorationSystem and machines) ─────────────

  /** A tile became restored. Starts a chain if it isn't part of one. Returns the chain id. */
  onRestored(tile: TileData, source: RestoreSource, chainId?: number): number {
    const run = (chainId !== undefined && this.runs.get(chainId)) || this.newRun(tile, 'normal', Infinity, PLAYER_SOURCES.has(source) ? 'player' : 'auto');
    run.visited.add(tile.id);
    this.react(run, tile, 'RESTORE', this.depthOf(tile.id, run));
    return run.id;
  }

  /** A restored tile grew a bloom level (nurture, pollination, watering, tree pulse). */
  onGrown(tile: TileData, chainId?: number, starter: ChainStarter = 'auto'): number {
    const run = (chainId !== undefined && this.runs.get(chainId)) || this.newRun(tile, 'normal', Infinity, starter);
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
    const extra = s.upgrades.waterBloom(m);
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

  /**
   * Overcharge Pulse: a manual pulse right next to a machine boosts its next trigger (used up here). Returns the
   * boost: 0 when not overcharged, else 1 plus the Overcharge upgrade's level, so active play scales with upgrades.
   */
  consumeOvercharge(m: MachineData): number {
    if ((m.overchargeUntil ?? 0) <= this.sim.time) return 0;
    m.overchargeUntil = 0;
    this.sim.bus.emit('machine.boostUsed', { machineId: m.id });
    return 1 + this.sim.upgrades.level('overcharge');
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

  /**
   * City 10.3: a garden on a canal network also spills at one other connected garden: the one with the most dry
   * ground to water (then lowest id), travelling along the canal. Each garden sends and receives at most once per
   * chain, and routed spills never route again, so a network can't loop.
   */
  private routeOverflow(run: ChainRun, g: MachineData, depth: number) {
    const s = this.sim;
    const net = s.canals.of(g);
    if (!net || net.gardens.length < 2 || run.canalSpilled.has(g.id)) return;
    const options = net.gardens.filter((o) => o.id !== g.id && !run.canalSpilled.has(o.id));
    if (!options.length) return;
    const score = new Map(options.map((o) => [o.id, this.overflowTargets(o, 99, run.visited).length]));
    const to = options.sort((a, b) => score.get(b.id)! - score.get(a.id)! || (a.id < b.id ? -1 : 1))[0];
    run.canalSpilled.add(g.id);
    run.canalSpilled.add(to.id);
    const path = s.canals.path(g, to);
    s.bus.emit('canal.flow', { from: g.id, to: to.id, path, kind: 'overflow', chainId: run.id });
    this.enqueue(run, { type: 'OVERFLOW', source: g.id, target: to.id, cause: 'overflow', depth: depth + 1 }, Math.min(2.5, 0.3 + path.length * 0.04));
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
    // In the city, only the player's revealed areas (never a whole-world scan, never fog).
    const pool = s.grid.isPlayable(GROUND) ? s.areas.revealed().flatMap((id) => s.areas.tiles(id)) : s.grid.playableTiles();
    const restored = pool.filter((t) => t.ground === 'restored' && s.grid.neighbors(t).some((n) => s.restoration.isEligible(n)));
    if (!restored.length) return false;
    const origin = s.rng.pick(restored);
    const run = this.newRun(origin, 'mega', budget);
    this.spreadMega(run, origin, 0);
    return true;
  }

  /**
   * Mega Pulse (the player's charged tap): a city-scale chain seeded from the chosen tile. It restores the tile
   * if it can, then spreads outward through everything eligible, up to its budget.
   */
  startMegaPulse(origin: TileData, budget: number): number {
    const s = this.sim;
    const run = this.newRun(origin, 'mega', budget, 'player');
    if (s.restoration.isEligible(origin)) {
      run.visited.delete(origin.id); // the origin itself is the first restoration
      this.enqueue(run, { type: 'RESTORE', source: origin.id, target: origin.id, cause: 'mega', depth: 0 }, 0);
    } else this.spreadMega(run, origin, 0);
    s.bus.emit('mega.released', { tileId: origin.id, budget });
    return run.id;
  }

  // ───────────── synergy checks ─────────────

  private canGrow(run: ChainRun, depth: number) {
    return !run.fastForward && run.processed + run.pending < this.maxEvents() && depth < TUNING.chain.maxDepth;
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
      } else if (m.type === 'pollinator' && d >= 1 && d <= s.upgrades.pollinatorReach(m)) {
        // Newly restored *or* newly grown plants pollinate (limited per garden per chain).
        const used = run.pollinatorUses.get(m.id) ?? 0;
        if (used === 0) {
          const b = this.consumeOvercharge(m);
          if (b) run.pollinatorBonus.set(m.id, b);
        }
        if (used >= s.upgrades.pollinatorTriggers + (run.pollinatorBonus.get(m.id) ?? 0)) continue;
        const target = this.pollinationTarget(run, m, tile);
        if (target) {
          run.pollinatorUses.set(m.id, used + 1);
          run.visited.add(target.id);
          this.enqueue(run, { type: 'POLLINATE', source: m.id, target: target.id, cause: 'pollinate', depth: depth + 1 });
        }
        // A street garden passes the chain along its green corridor (once per garden per chain), even when
        // everything around it is already in full bloom.
        if (!run.corridorFired.has(m.id) && this.isCorridor(m)) {
          run.corridorFired.add(m.id);
          for (const o of this.corridorNext(m)) {
            if (run.corridorFired.has(o.id)) continue;
            this.enqueue(run, { type: 'CORRIDOR', source: m.id, target: o.id, cause: 'pollinate', depth: depth + 1 }, TUNING.chain.stepDelay * 0.8);
            s.bus.emit('corridor.sent', { from: m.id, to: o.id, chainId: run.id });
          }
        }
      } else if (m.type === 'motherTree' && d >= 1 && d <= s.upgrades.treeRadius(m) && !run.dischargedTrees.has(m.id)) {
        this.enqueue(run, { type: 'CHARGE', source: tile.id, target: m.id, cause: 'charge', depth: depth + 1 }, TUNING.chain.stepDelay * 0.6);
      } else if (m.type === 'core' && d >= 1 && d <= TUNING.neighbourhood.canopy.chargeRadius && !run.dischargedTrees.has(m.id) && this.isElder(m)) {
        // The Canopy's Elder Tree charges from blooms around it (dormant or awake).
        this.enqueue(run, { type: 'CHARGE', source: tile.id, target: m.id, cause: 'charge', depth: depth + 1 }, TUNING.chain.stepDelay * 0.6);
      }
    }
    if (run.mode === 'mega' && kind === 'RESTORE') this.spreadMega(run, tile, depth);
    this.reactCityRelays(run, tile, depth);
  }

  // ───────────── Bloom Relays ─────────────

  /**
   * City 10.4: a bloom beside a Bloom Relay sends one pulse down each of its ready links (once per link per
   * chain), if something around the far relay can bloom. Arriving blooms can set the far relay's other links
   * off in turn, so a pulse can run through a whole network; every link fires at most once, so it ends.
   */
  private reactCityRelays(run: ChainRun, tile: TileData, depth: number) {
    const s = this.sim;
    if (!this.canGrow(run, depth)) return;
    const zone = TUNING.relay.zoneRadius;
    for (const r of s.grid.machinesNear(tile.roofId, tile.x, tile.z, zone)) {
      if (r.type !== 'relay' || distToFootprint(tile.x, tile.z, r.x, r.z, r.size) < 1) continue;
      for (const o of s.relays.linked(r)) {
        const id = relayLinkId(r, o);
        if (run.relaysFired.has(id) || !s.relays.ready(id)) continue;
        if (!this.remoteTargetsAt(run, o.roofId, o.x, o.z, 1, TUNING.relay.remoteRadius).length) continue;
        run.relaysFired.add(id);
        s.relays.state(id).readyAt = s.time + TUNING.relay.cooldown;
        const travel = Math.min(1.5, 0.25 + s.relays.distance(r, o) * TUNING.relay.travelPerTile);
        this.enqueue(run, { type: 'RELAY', source: r.id, target: id, cause: 'relay', depth: depth + 1, roofId: o.roofId }, travel);
        s.bus.emit('relay.city', { from: r.id, to: o.id, linkId: id, chainId: run.id, travel });
      }
    }
  }

  /** Remote blooms around a point: live (restorable or growable) tiles by synergy, then lush ones. */
  remoteTargetsAt(run: ChainRun | undefined, roofId: string, rx: number, rz: number, count: number, R: number): TileData[] {
    const s = this.sim;
    if (!s.grid.roof(roofId) || count <= 0) return [];
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
      if (m.type === 'pollinator' && d <= s.upgrades.pollinatorReach(m)) score += 3;
      else if (m.type === 'solar' && d === 1) score += 1.5;
      else if (m.type === 'motherTree' && d <= s.upgrades.treeRadius(m)) score += 2;
      else if (m.type === 'core' && d <= TUNING.neighbourhood.canopy.chargeRadius && this.isElder(m)) score += 2;
      else if (m.type === 'reservoirGarden' && d <= TUNING.neighbourhood.reservoir.radius) score += 1;
    }
    return score;
  }

  /** Deterministic choice: mossy soil first, then concrete, then a green tile that can still grow. */
  private pollinationTarget(run: ChainRun, p: MachineData, from: TileData): TileData | undefined {
    const s = this.sim;
    const reach = s.upgrades.pollinatorReach(p);
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
      const ffAfter = this.sim.progression.homeIsPark ? TUNING.chain.fastForwardAfterCity : TUNING.chain.fastForwardAfter;
      if (!run.fastForward && (now - run.startedAt > ffAfter || run.processed >= this.maxEvents())) {
        run.fastForward = true;
        this.queue.update((q) => {
          if (q.chainId === run.id) q.at = Math.min(q.at, now);
        });
        s.bus.emit('chain.fastForward', { chainId: run.id });
      }
    }
    // Process due events in (time, sequence) order. New events are always scheduled in the future,
    // except fast-forwarded ones, so loop until nothing due remains (bounded by caps).
    let guard = 0;
    while (guard++ < 1000) {
      const next = this.queue.peek();
      if (!next || next.at > now + 1e-9) break;
      const ev = this.queue.pop()!;
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
        const ar = s.areas.areaOf(t);
        if (ar) run.areas.add(ar);
        this.emit(run, ev);
        s.restoration.complete(t, ev.cause as RestoreSource, run.id);
        return;
      }
      case 'GROW': {
        const t = s.grid.byTileId(ev.target);
        if (!t || t.ground !== 'restored' || t.bloom >= TUNING.restore.maxBloom) return;
        const ga = s.areas.areaOf(t);
        if (ga) run.areas.add(ga);
        this.emit(run, ev);
        s.restoration.grow(t, run.id);
        return;
      }
      case 'CORRIDOR': {
        // The pollen arrives at the next garden: it blooms a spot beside it, which sets that garden off.
        const g = s.machine(ev.target);
        if (!g || run.corridorFired.has(g.id)) return;
        const origin = s.grid.get(g.roofId, g.x, g.z)!;
        const target = this.pollinationTarget(run, g, origin);
        if (!target) return;
        this.emit(run, ev);
        run.visited.add(target.id);
        this.enqueue(run, { type: target.ground === 'restored' ? 'GROW' : 'RESTORE', source: g.id, target: target.id, cause: 'pollinate', depth: ev.depth + 1 }, TUNING.chain.stepDelay * 0.6);
        if (s.state.relayBonus > 0) {
          // Golden Relay (Lucky Cat) in the city: this hop blooms extra tiles around the garden, then it's spent.
          const extra = s.grid
            .tilesNear(g, 3)
            .filter((t) => !run.visited.has(t.id) && !t.occupantId && !t.blocked && (s.restoration.isEligible(t) || (t.ground === 'restored' && t.bloom < TUNING.restore.maxBloom)))
            .map((t) => ({ t, d: distToFootprint(t.x, t.z, g.x, g.z, g.size) }))
            .sort((a, b) => a.d - b.d || a.t.z - b.t.z || a.t.x - b.t.x)
            .slice(0, s.state.relayBonus);
          s.state.relayBonus = 0;
          extra.forEach(({ t }, i) => {
            run.visited.add(t.id);
            this.enqueue(run, { type: t.ground === 'restored' ? 'GROW' : 'RESTORE', source: g.id, target: t.id, cause: 'relay', depth: ev.depth + 1 }, 0.2 + i * 0.1);
          });
        }
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
        s.production.solarBoosted(m);
        const boost = 1 + this.consumeOvercharge(m);
        const got = s.econ.add('energy', TUNING.solarBloomBoost.burstEnergy * s.upgrades.solarMult(m) * boost);
        run.energy = run.energy.add(got);
        this.emit(run, { ...ev, amount: got });
        s.bus.emit('solar.boost', { machineId: m.id });
        if (got.gt(0)) s.bus.emit('resource.gain', { kind: 'energy', amount: got, reason: `machine:${m.id}` });
        return;
      }
      case 'PRODUCE_WATER': {
        const m = s.machine(ev.target);
        if (!m) return;
        m.charge = 0;
        this.emit(run, ev);
        const near = s.grid.tilesNear(m, TUNING.condenser.radius);
        const targets = TUNING.condenser.targets + Math.min(TUNING.condenser.maxExtraTargets, s.upgrades.waterBloom(m)) + s.upgrades.condenserTierTargets(m) + this.consumeOvercharge(m);
        const dry = near.filter((t) => t.ground === 'prepared' && s.restoration.isEligible(t, false) && !run.visited.has(t.id));
        const grow = s.upgrades.waterBloom(m) > 0 ? near.filter((t) => t.ground === 'restored' && !t.occupantId && t.bloom < TUNING.restore.maxBloom && !run.visited.has(t.id)) : [];
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
        const n = R.targets + this.consumeOvercharge(g);
        const targets = this.overflowTargets(g, n, run.visited);
        const routed = ev.source !== ev.target; // a spill that arrived along a canal: the basin keeps its water
        if (!routed) g.charge = 0;
        // Nothing to water: the spill still freshens the green around it (lush), so it always counts.
        if (!targets.length)
          for (const t of s.grid.tilesNear(g, TUNING.neighbourhood.reservoir.radius))
            if (t.ground === 'restored' && !t.occupantId) {
              t.lushUntil = s.time + TUNING.neighbourhood.reservoir.lushSeconds;
              s.grid.touch(t);
            }
        s.state.progression.overflows = (s.state.progression.overflows ?? 0) + 1;
        this.emit(run, { ...ev, amount: targets.length });
        s.bus.emit('reservoir.overflow', { machineId: g.id, tiles: targets.map((t) => t.id) });
        targets.forEach((t, i) => {
          run.visited.add(t.id);
          this.enqueue(run, { type: t.ground === 'restored' ? 'GROW' : 'RESTORE', source: g.id, target: t.id, cause: 'overflow', depth: ev.depth + 1 }, 0.15 + i * 0.12);
        });
        if (!routed) this.routeOverflow(run, g, ev.depth);
        return;
      }
      case 'CANOPY_BURST': {
        const m = s.machine(ev.target);
        if (!m) return;
        m.charge = 0;
        s.state.progression.canopyBursts = (s.state.progression.canopyBursts ?? 0) + 1;
        this.emit(run, ev);
        const radius = this.canopyBurstRadius(m) + Math.min(2, this.consumeOvercharge(m));
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
            .tilesNear(g, s.upgrades.pollinatorReach(g) + 2)
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
          .tilesNear(m, s.upgrades.treeRadius(m) + Math.min(2, this.consumeOvercharge(m)))
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
        {
          // City 10.4: a pulse arrives at the far Bloom Relay.
          const dest = s.relays.otherEnd(ev.target, ev.source!);
          if (!dest) return;
          let n = s.relays.targets(dest);
          if (s.state.relayBonus > 0) {
            n += s.state.relayBonus;
            s.state.relayBonus = 0;
          }
          const targets = this.remoteTargetsAt(run, dest.roofId, dest.x, dest.z, n, TUNING.relay.remoteRadius);
          s.relays.state(ev.target).crossings++;
          run.roofs.add(dest.roofId);
          this.emit(run, { ...ev, amount: targets.length });
          targets.forEach((t, i) => {
            run.visited.add(t.id);
            const type = t.ground !== 'restored' ? 'RESTORE' : t.bloom < TUNING.restore.maxBloom ? 'GROW' : 'LUSH';
            this.enqueue(run, { type, source: dest.id, target: t.id, cause: 'relay', depth: ev.depth + 1 }, 0.12 + i * 0.12);
          });
          return;
        }
        return;
      }
      case 'LUSH': {
        const t = s.grid.byTileId(ev.target);
        if (!t || t.ground !== 'restored') return;
        t.lushUntil = s.time + TUNING.neighbourhood.reservoir.lushSeconds;
        s.grid.touch(t);
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
    const bonus = run.biomass.add(perEffect).mul(pct).add(perEffect);
    const got = bonus.gt(0) ? s.econ.add('biomass', bonus) : big(0);
    s.state.stats.chains++;
    s.state.stats.maxCombo = Math.max(s.state.stats.maxCombo, run.combo);
    const reward: ChainEvent = { seq: this.seq++, type: 'REWARD', chainId: run.id, depth: 0, target: run.originTileId, cause: 'reward', at: s.time, amount: got };
    this.history.push(reward);
    s.bus.emit('chain.event', { event: reward, combo: run.combo });
    s.bus.emit('chain.ended', {
      chainId: run.id,
      combo: run.combo,
      bonus: got,
      total: run.biomass.add(got),
      milestonePct: pct,
      energy: run.energy,
      roofs: [...run.roofs],
      crossings: run.relaysFired.size,
      areas: run.areas.size,
      areaIds: [...run.areas],
      starter: run.starter,
    });
    if (run.combo >= TUNING.mega.bigChain) {
      const st = s.state.stats;
      st.bigChains = st.bigChains ?? { player: 0, auto: 0 };
      st.bigChains[run.starter]++;
    }
    if (run.relaysFired.size) s.metrics.first('remoteChain');
    if (got.gt(0)) s.bus.emit('resource.gain', { kind: 'biomass', amount: got, reason: 'chain' });
    s.metrics.onChain(run.combo);
  }
}
