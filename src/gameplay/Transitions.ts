import type { RestoreSource, TileData, TileTransition, TransitionKind } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

/** Restores that come in bulk (chains, Mega Bloom, abilities, events): they play the fast variant. */
const FAST: ReadonlySet<RestoreSource> = new Set<RestoreSource>(['chain', 'mega', 'super', 'pollinate', 'relay', 'canopy', 'neighbourhood', 'cat']);
/** Saved values keep 3 decimals; live ones match, so a reload is byte-identical. */
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const ORTHO: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Progress (0..1) of a transition at sim time `now`; 1 when there is none or it has finished. */
export function trProgress(tr: TileTransition | undefined, now: number): number {
  if (!tr) return 1;
  if (tr.d <= 0) return 1;
  return Math.max(0, Math.min(1, (now - tr.t0) / tr.d));
}

/** True while a tile's transition still has something to play (including a wave delay not yet reached). */
export function trActive(t: TileData, now: number): boolean {
  return !!t.tr && now < t.tr.t0 + t.tr.d;
}

/**
 * Look 6.2 (#171): the sim side of living transitions. The sim keeps its own timings (docs/design/cultivation.md):
 * this only records, on the tile, which process is playing, since when and for how long, so the renderer can play
 * it, a reload can continue it, and offline progress can finish it. Gameplay-time transitions (the Cultivator's
 * work) carry `g` and are driven by their owner; everything here is bookkeeping, never a rule.
 */
export class Transitions {

  constructor(private sim: Sim) {}

  private get now() {
    return this.sim.time;
  }

  /** Visual duration multiplier for a tile's ground type (paving reclaims faster than water clears). */
  featureMult(t: TileData): number {
    return TUNING.transitions.feature[t.feature ?? 'lawn'] ?? 1;
  }

  /** How long the restore sequence plays for a restore by `source` (the sim restored it already, or will soon). */
  restoreSeconds(t: TileData, source: RestoreSource, quiet = false): number {
    const R = TUNING.transitions.restore;
    const fast = quiet || FAST.has(source);
    const base = fast ? R.fast : source === 'pulse' ? R.pulse : source === 'broad' ? R.broad : R.auto;
    return base * this.featureMult(t);
  }

  /** The edge (1 +x, 2 −x, 3 +z, 4 −z) facing a living neighbour, or 0 (the change starts at the centre). */
  livingEdge(t: TileData): number {
    for (let i = 0; i < 4; i++) {
      const [dx, dz] = ORTHO[i];
      const n = this.sim.grid.peek(t.roofId, t.x + dx, t.z + dz);
      if (n && n.ground === 'restored') return i + 1;
    }
    return 0;
  }

  /** The edge of `t` that faces `from` (an orthogonal neighbour), or 0. */
  edgeToward(t: TileData, from: TileData): number {
    const dx = from.x - t.x;
    const dz = from.z - t.z;
    for (let i = 0; i < 4; i++) if (ORTHO[i][0] === dx && ORTHO[i][1] === dz) return i + 1;
    return 0;
  }

  /**
   * The value a tile currently *looks* like it has for a stackable quantity: mid-transition, it's between the old
   * transition's `from` and the tile's value. Used so a new transition starts from the current look (never snaps).
   */
  private lookValue(t: TileData, value: number, kinds: TransitionKind[]): number {
    const tr = t.tr;
    if (!tr || tr.from === undefined || !kinds.includes(tr.k)) return value;
    const p = trProgress(tr, this.now);
    if (p >= 1) return value;
    return tr.from + (value - tr.from) * Math.max(0, p);
  }

  /** Starts (or replaces) a tile's transition. `delay` holds it back (waves); `g` marks gameplay time. */
  begin(t: TileData, k: TransitionKind, d: number, o: { dir?: number; from?: number; delay?: number; g?: boolean } = {}): TileTransition {
    const tr: TileTransition = { k, t0: r3(this.now + (o.delay ?? 0)), d: r3(Math.max(0.05, d)) };
    if (o.dir) tr.dir = o.dir;
    if (o.from !== undefined) tr.from = Math.round(o.from * 100) / 100;
    if (o.g) tr.g = 1;
    t.tr = tr;
    this.live.set(t.id, t);
    this.sim.grid.touch(t);
    return tr;
  }

  /** Concrete softens: pollution just dropped from `before` to the tile's value. */
  soften(t: TileData, before: number, from?: TileData) {
    const look = this.lookValue(t, before, ['soften']);
    this.begin(t, 'soften', TUNING.transitions.soften * this.featureMult(t), { from: look, dir: from ? this.edgeToward(t, from) : this.livingEdge(t) });
  }

  /** Concrete turns to moss (pollution reached 0). Continues smoothly from any softening still playing. */
  moss(t: TileData, before: number, from?: TileData) {
    const look = this.lookValue(t, before, ['soften']);
    this.begin(t, 'moss', TUNING.transitions.moss * this.featureMult(t), { from: look, dir: from ? this.edgeToward(t, from) : this.livingEdge(t) });
  }

  /** The restore sequence (fracture → heave → crumble → sprout → knit). `before` = pollution before (0 = moss). */
  restore(t: TileData, source: RestoreSource, before: number, o: { quiet?: boolean; delay?: number; g?: boolean } = {}) {
    const look = this.lookValue(t, before, ['soften', 'moss']);
    const dir = source === 'pulse' ? 0 : this.livingEdge(t);
    this.begin(t, 'restore', this.restoreSeconds(t, source, o.quiet), { from: look, dir, delay: o.delay, g: o.g });
  }

  /**
   * VFX 1: a restore that has just started is washed in by a pulse's wave instead: the wave leaves (ox, oz) (world
   * offset from the tile's centre) after `delay` seconds and reaches `radius` in `seconds`. Visual only.
   */
  wash(t: TileData, ox: number, oz: number, radius: number, seconds: number, delay = 0) {
    const tr = t.tr;
    if (!tr || tr.k !== 'restore' || tr.g) return;
    const W = TUNING.transitions;
    tr.t0 = r3(this.now + delay);
    tr.d = r3(Math.max(W.wash, seconds + W.washAfter));
    tr.w = [r3(ox), r3(oz), r3(radius), r3(seconds)];
    delete tr.dir;
    this.sim.grid.touch(t);
  }

  /** One nurture step, starting from the tree's current age if another step is still playing. */
  bloom(t: TileData, level: number, auto: boolean, before = level - 1) {
    const tr = t.tr;
    const p = trProgress(tr, this.now);
    const start = tr?.k === 'bloom' ? tr.from ?? before : before;
    const from = start + (before - start) * p * p * (3 - 2 * p);
    const base = TUNING.transitions.bloom[Math.max(2, Math.min(4, level))] ?? 3;
    this.begin(t, 'bloom', base * (auto ? TUNING.transitions.autoMult : 1), { from });
  }

  /** An obstacle cleared by the area entry fix crumbles and greens over. */
  unblock(t: TileData) {
    this.begin(t, 'unblock', TUNING.transitions.unblock);
  }

  /** A tile becomes lush (Reservoir Overflow, irrigation): the wet mask soaks in from now unless it was already wet. */
  lush(t: TileData, until: number) {
    if (!(t.lushUntil && t.lushUntil > this.now)) t.lushAt = r3(this.now);
    t.lushUntil = until;
    this.sim.grid.touch(t);
    this.sim.bus.emit('tile.lush', { tile: t });
  }

  /**
   * A tap on a tile mid-transition: a visual knock that moves it along by a share of its length (never past the
   * end). Gameplay transitions are knocked by their owner (the Cultivator), not here. True if it moved.
   */
  knock(t: TileData): boolean {
    const tr = t.tr;
    if (!tr || tr.g || !trActive(t, this.now)) return false;
    const share = tr.k === 'bloom' ? TUNING.transitions.knock.bloom : TUNING.transitions.knock.visual;
    tr.t0 = r3(Math.max(tr.t0 - tr.d * share, this.now - tr.d));
    this.sim.grid.touch(t);
    this.sim.bus.emit('tile.knocked', { tile: t });
    return true;
  }

  /** Tiles with a transition (finished ones are swept once a second, so saves stay small). */
  private live = new Map<string, TileData>();
  private sweepAt = 0;

  /** Tiles with a transition right now (renderer, tests). */
  liveTiles(): Iterable<TileData> {
    return this.live.values();
  }
  get liveCount() {
    return this.live.size;
  }

  /** A chunk was loaded: picks up its saved transitions, dropping finished ones. */
  adopt(t: TileData) {
    const tr = t.tr;
    if (!tr) return;
    if (this.now >= tr.t0 + tr.d) t.tr = undefined;
    else this.live.set(t.id, t);
  }

  /** Once a second: clears finished transitions. */
  tick() {
    if (this.now < this.sweepAt || !this.live.size) return;
    this.sweepAt = this.now + 1;
    for (const [id, t] of this.live) {
      if (!t.tr) this.live.delete(id);
      else if (this.now >= t.tr.t0 + t.tr.d) {
        t.tr = undefined;
        this.live.delete(id);
        this.sim.grid.touch(t);
      }
    }
  }
}
