import { GROUND } from '../core/GameState';
import { regionOfCell, seaCell, surfCell } from '../core/OldCityLayout';
import type { TileData } from '../core/types';
import type { WeatherKind } from '../data/weather';
import { REGIONS, type RegionId } from '../data/oldcity';
import { WATER_NET } from '../data/water';
import type { Sim } from './Sim';

/**
 * A body of fresh water: one connected stretch of water tiles (a pond, a canal, a basin). Its id is its anchor
 * tile (the first in z, then x order) as `x,z`, so it stays the same across sessions while the water's shape does.
 */
export interface WaterBody {
  id: string;
  /** ground tile ids */
  tiles: Set<string>;
  /** what it holds when full (units) */
  capacity: number;
  /** the region its anchor lies in (springs, starting level) */
  region?: RegionId;
}

/** E23.4.1: what a save keeps. Levels are shares of capacity (0…1), only for bodies that have changed. */
export interface WaterSave {
  levels: Record<string, number>;
}

/** Each region's water rectangles (its canals and ponds), by region. */
const REGION_WATER = new Map(REGIONS.filter((r) => r.water?.length).map((r) => [r.id, r.water!]));

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * E23.4.1 (#381): water levels. Every pond, canal and reservoir has a level that goes down as it is used and comes
 * back with rain, Cistern Basin's springs and (later) desalination; sunny days take a little by evaporation, but
 * never below `evaporationFloor`. This is `sim.water`, the handle the farm, the helpers, pumps and the overlay use.
 *
 * Bodies are found lazily by flood fill from the tile asked about, cached until a water tile changes, so nothing
 * sweeps the world. A body nobody has touched sits at its starting level (full, or empty for the dry basin) and
 * costs nothing per tick; once anything changes it, its level is tracked (and saved) from then on.
 *
 * API:
 * - `bodyAt(tile)` / `bodyNear(tile, reach?)`: the body a water tile is part of / the nearest one within reach.
 * - `levelOf(id)`: 0…1. `amountOf(id)`: units held.
 * - `draw(id, units)`: takes up to `units`, returns what it got (never below empty).
 * - `drawNear(tile, units)`: the same from the nearest body within reach (0 if none).
 * - `fill(id, units)`: adds water (desalination, pumps), returns what fitted.
 * - `isWatered(tile)`: a body within reach holds more than `dryBelow`.
 * - `wetness(tile)`: 0…1, the fullest body within reach (1 = full, 0 = dry or none) for the land's look (E23.4.4).
 * - `tracked()`: bodies with a level of their own; `live()`: those plus water whose level can change on its own
 *   (rendering and the overlay draw these; every other body is full).
 */
export class WaterSystem {
  private byTile = new Map<string, WaterBody>();
  private bodies = new Map<string, WaterBody>();
  private acc = 0;
  /** bumped whenever any level changes (renderers redraw on change) */
  version = 0;

  constructor(private sim: Sim) {
    sim.grid.touchListeners.push((t) => {
      if (t.feature === 'water' && this.byTile.size) this.forget();
    });
  }

  private get save(): WaterSave {
    return (this.sim.state.water ??= { levels: {} });
  }

  private forget() {
    this.byTile.clear();
    this.bodies.clear();
  }

  /**
   * Is this tile part of a body of fresh water? Deep water (canals, the basin's pond) always is; a shallow pond only
   * once restored (until then it is a silted bed). The open sea, the bay and the surf never are.
   */
  isFresh(t: TileData | undefined): t is TileData {
    if (!t || t.roofId !== GROUND || t.feature !== 'water') return false;
    if (this.sim.oldCity && (seaCell(t.x, t.z) || surfCell(t.x, t.z))) return false;
    return (this.sim.oldCity && t.blocked) || t.ground === 'restored';
  }

  /** The body a water tile belongs to. */
  bodyAt(t: TileData | undefined): WaterBody | undefined {
    if (!this.isFresh(t)) return undefined;
    return this.byTile.get(t.id) ?? this.flood(t);
  }

  /** The body with this id (its anchor `x,z`). */
  body(id: string): WaterBody | undefined {
    const hit = this.bodies.get(id);
    if (hit) return hit;
    const [x, z] = id.split(',').map(Number);
    const b = this.bodyAt(this.sim.grid.get(GROUND, x, z));
    return b?.id === id ? b : undefined;
  }

  /** The nearest body (by square distance, then fullest) within `reach` tiles of a tile. */
  bodyNear(t: TileData, reach = WATER_NET.reach): WaterBody | undefined {
    if (t.roofId !== GROUND) return undefined;
    let best: WaterBody | undefined;
    let bestD = Infinity;
    const g = this.sim.grid;
    for (let dz = -reach; dz <= reach; dz++)
      for (let dx = -reach; dx <= reach; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        if (d > bestD) continue;
        const n = g.get(GROUND, t.x + dx, t.z + dz);
        if (!this.isFresh(n)) continue;
        const b = this.bodyAt(n)!;
        if (d < bestD || (best && this.levelOf(b.id) > this.levelOf(best.id))) {
          best = b;
          bestD = d;
        }
      }
    return best;
  }

  private flood(start: TileData): WaterBody {
    const g = this.sim.grid;
    const tiles = new Set<string>([start.id]);
    const stack = [start];
    let anchor = start;
    while (stack.length && tiles.size < WATER_NET.maxTiles) {
      const t = stack.pop()!;
      if (t.z < anchor.z || (t.z === anchor.z && t.x < anchor.x)) anchor = t;
      for (const [dx, dz] of SIDES) {
        const n = g.get(GROUND, t.x + dx, t.z + dz);
        if (!this.isFresh(n) || tiles.has(n.id)) continue;
        tiles.add(n.id);
        stack.push(n);
      }
    }
    const id = `${anchor.x},${anchor.z}`;
    const region = this.sim.oldCity ? (regionOfCell(anchor.x, anchor.z)?.id as RegionId | undefined) : undefined;
    const body: WaterBody = { id, tiles, capacity: tiles.size * WATER_NET.perTile, region };
    for (const tid of tiles) this.byTile.set(tid, body);
    this.bodies.set(id, body);
    this.carryOver(body);
    this.sizes.set(id, tiles.size);
    return body;
  }

  /** Last known size of each body (this session), so water carries over when a body grows or two join. */
  private sizes = new Map<string, number>();

  /**
   * A body whose shape changed (a pond restored a tile further, two stretches joined) keeps the water its old
   * parts held: their saved levels (keyed by their old anchors, which lie inside it) pool into its own; new
   * tiles arrive full.
   */
  private carryOver(b: WaterBody) {
    const levels = this.save.levels;
    if (levels[b.id] !== undefined && this.sizes.get(b.id) === b.tiles.size) return;
    let held = 0;
    let counted = 0;
    let found = false;
    for (const key of Object.keys(levels)) {
      const [x, z] = key.split(',').map(Number);
      const t = this.sim.grid.peek(GROUND, x, z);
      if (!t || !b.tiles.has(t.id)) continue;
      const n = Math.min(this.sizes.get(key) ?? b.tiles.size, b.tiles.size - counted);
      held += levels[key] * n;
      counted += n;
      found = true;
      if (key !== b.id) delete levels[key];
    }
    if (!found) return;
    const start = (b.region && WATER_NET.startLevel[b.region]) ?? 1;
    const v = Math.max(0, Math.min(1, (held + (b.tiles.size - counted) * start) / b.tiles.size));
    if (levels[b.id] !== v) {
      levels[b.id] = v;
      this.version++;
    }
  }

  /** 0…1: how full a body is. */
  levelOf(id: string): number {
    const saved = this.save.levels[id];
    if (saved !== undefined) return saved;
    const b = this.bodies.get(id) ?? this.body(id);
    return (b?.region && WATER_NET.startLevel[b.region]) ?? 1;
  }

  /** Units a body holds. */
  amountOf(id: string): number {
    const b = this.body(id);
    return b ? this.levelOf(id) * b.capacity : 0;
  }

  private set(id: string, level: number) {
    const v = Math.max(0, Math.min(1, level));
    if (this.save.levels[id] === v) return;
    this.save.levels[id] = v;
    this.version++;
  }

  /** Takes up to `units` from a body; returns what it got. */
  draw(id: string, units: number): number {
    const b = this.body(id);
    if (!b || units <= 0) return 0;
    const have = this.levelOf(id) * b.capacity;
    const got = Math.min(have, units);
    this.set(id, (have - got) / b.capacity);
    return got;
  }

  /** Takes up to `units` from the nearest body within reach of a tile. */
  drawNear(t: TileData, units: number): number {
    const b = this.bodyNear(t);
    return b ? this.draw(b.id, units) : 0;
  }

  /** Adds up to `units` to a body; returns what fitted. */
  fill(id: string, units: number): number {
    const b = this.body(id);
    if (!b || units <= 0) return 0;
    const have = this.levelOf(id) * b.capacity;
    const put = Math.min(b.capacity - have, units);
    this.set(id, (have + put) / b.capacity);
    return put;
  }

  /** Does a body within reach still hold water? (planters, the land's look) */
  isWatered(t: TileData): boolean {
    return this.wetness(t) > WATER_NET.dryBelow;
  }

  /** 0…1: the fullest body within reach (0 if there is none). */
  wetness(t: TileData, reach = WATER_NET.reach): number {
    if (t.roofId !== GROUND) return 0;
    let best = 0;
    const seen = new Set<WaterBody>();
    const g = this.sim.grid;
    for (let dz = -reach; dz <= reach; dz++)
      for (let dx = -reach; dx <= reach; dx++) {
        const n = g.get(GROUND, t.x + dx, t.z + dz);
        if (!this.isFresh(n)) continue;
        const b = this.bodyAt(n)!;
        if (seen.has(b)) continue;
        seen.add(b);
        best = Math.max(best, this.levelOf(b.id));
      }
    return best;
  }

  /** Bodies with a level of their own (changed at least once), loading them if needed. */
  tracked(): WaterBody[] {
    const out: WaterBody[] = [];
    for (const id of Object.keys(this.save.levels).sort()) {
      const b = this.body(id);
      if (b) out.push(b);
    }
    return out;
  }

  /** The weather now (E23.7.2's `sim.weather`). */
  weather(): WeatherKind {
    return this.sim.weather.kind();
  }

  /**
   * What the weather does to the water now (shares of capacity per game day): E23.7.2's rain (`rainShare` of
   * capacity for each unit: 1 a day's steady rain, 2 a storm) and its sun's evaporation.
   */
  sky(): { fill: number; evap: number } {
    const wx = this.sim.weather;
    return { fill: WATER_NET.rainShare * wx.rain(), evap: wx.effects().evaporation };
  }

  // ───────────── hooks for the gentle-failure suite (E23.10) ─────────────

  /** Every body in the areas bloombot has seen (and any this session has looked at), empty. */
  drainForTest() {
    for (const b of this.allSeen()) this.draw(b.id, b.capacity);
  }

  /** Every body in the areas bloombot has seen (and any this session has looked at), full. */
  refillForTest() {
    for (const b of this.allSeen()) this.fill(b.id, b.capacity);
  }

  private allSeen(): Set<WaterBody> {
    const out = new Set<WaterBody>([...this.bodies.values(), ...this.live()]);
    for (const id of Object.keys(this.sim.state.areas))
      for (const t of this.sim.areas.tiles(id)) {
        const b = this.bodyAt(t);
        if (b) out.add(b);
      }
    return out;
  }

  /** Land that lives off water and has none: a body within reach, but none in reach still holds any (land with no
   * water near it never depended on water, so it is never dry). */
  isDry(t: TileData): boolean {
    return !!this.bodyNear(t) && !this.isWatered(t);
  }

  /** Spring flow for a body (share of capacity per game day). */
  private springOf(b: WaterBody): number {
    const r = b.region;
    const rate = r ? (WATER_NET.springs[r] ?? 0) : 0;
    if (!rate) return 0;
    if (WATER_NET.springsNeedLandmark && this.sim.areas.fog(r!) !== 'cleared') return 0;
    return rate;
  }

  /**
   * Bodies whose level can change on its own: tracked ones, plus the water of regions with springs or a starting
   * level below full (so rain fills the dry basin before anything has touched it).
   */
  live(): WaterBody[] {
    const out = this.tracked();
    if (!this.sim.oldCity) return out;
    const regions = new Set([...Object.keys(WATER_NET.springs), ...Object.keys(WATER_NET.startLevel)] as RegionId[]);
    for (const r of regions) for (const b of this.springBodies(r)) if (!out.includes(b)) out.push(b);
    return out;
  }

  /** The fresh water in a region (from its data rectangles: the canals and ponds it was drawn with). */
  springBodies(region: RegionId): WaterBody[] {
    const def = this.sim.oldCity ? REGION_WATER.get(region) : undefined;
    const out: WaterBody[] = [];
    for (const q of def ?? []) {
      const b = this.bodyAt(this.sim.grid.get(GROUND, q.x, q.z));
      if (b && !out.includes(b)) out.push(b);
    }
    return out;
  }

  tick(dt: number) {
    this.acc += dt;
    if (this.acc < WATER_NET.step) return;
    const span = this.acc;
    this.acc = 0;
    const days = span / WATER_NET.daySeconds;
    const { fill, evap } = this.sky();
    for (const b of this.live()) {
      let lv = this.levelOf(b.id);
      const before = lv;
      lv += (fill + this.springOf(b)) * days;
      if (evap && lv > WATER_NET.evaporationFloor) lv = Math.max(WATER_NET.evaporationFloor, lv - evap * days);
      if (lv !== before) this.set(b.id, lv);
    }
  }
}
