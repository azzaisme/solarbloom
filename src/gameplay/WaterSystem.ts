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
  /** bumped whenever bodies change shape (a water tile changed): the fade cache keys on both */
  private shapeRev = 0;

  constructor(private sim: Sim) {
    // A tile that joins or leaves the water (a pond restored a tile further, a tile filled in) changes the bodies
    // around it; anything else on a water tile (its bloom, say) does not.
    sim.grid.touchListeners.push((t) => {
      this.landRev++;
      if (!this.byTile.size) return;
      const was = this.byTile.has(t.id);
      if (was === this.isFresh(t)) return;
      if (!was && !SIDES.some(([dx, dz]) => this.byTile.has(sim.grid.peek(GROUND, t.x + dx, t.z + dz)?.id ?? ''))) return;
      this.forget();
    });
  }

  private get save(): WaterSave {
    return (this.sim.state.water ??= { levels: {} });
  }

  /**
   * The bodies' shapes changed: find them again. The water the changed bodies held stays with their tiles, so a
   * body split in two leaves both pieces at its level (never full again), joined bodies pool theirs, and a tile
   * that stopped being water takes its share with it.
   */
  private forget() {
    const levels = this.save.levels;
    const pieces: { tiles: string[]; level: number }[] = [];
    for (const b of this.bodies.values()) {
      const lv = levels[b.id];
      if (lv === undefined) continue;
      pieces.push({ tiles: [...b.tiles], level: lv });
      delete levels[b.id];
    }
    this.byTile.clear();
    this.bodies.clear();
    this.shapeRev++;
    this.shapes.clear();
    if (!pieces.length) return;
    const pool = new Map<WaterBody, { held: number; n: number }>();
    for (const p of pieces)
      for (const id of p.tiles) {
        const b = this.bodyAt(this.sim.grid.byTileId(id));
        if (!b) continue;
        const e = pool.get(b) ?? { held: 0, n: 0 };
        e.held += p.level;
        e.n++;
        pool.set(b, e);
      }
    for (const [b, e] of pool) this.set(b.id, (e.held + (b.tiles.size - e.n) * this.startOf(b)) / b.tiles.size);
    this.version++;
  }

  /** The level a body has before anything touches it: full, or its region's `startLevel` (the dry basin). */
  private startOf(b: WaterBody): number {
    return (b.region && WATER_NET.startLevel[b.region]) ?? 1;
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
    const body: WaterBody = {
      id,
      tiles,
      capacity: tiles.size * WATER_NET.perTile,
      region,
    };
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
    const start = this.startOf(b);
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
    return b ? this.startOf(b) : 1;
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
    return this.fullest(t, reach) ?? 0;
  }

  /** The level of the fullest body within reach, or undefined if there is no water in reach. */
  private fullest(t: TileData, reach: number): number | undefined {
    if (t.roofId !== GROUND) return undefined;
    let best: number | undefined;
    const seen = new Set<WaterBody>();
    const g = this.sim.grid;
    for (let dz = -reach; dz <= reach; dz++)
      for (let dx = -reach; dx <= reach; dx++) {
        const n = g.get(GROUND, t.x + dx, t.z + dz);
        if (!this.isFresh(n)) continue;
        const b = this.bodyAt(n)!;
        if (seen.has(b)) continue;
        seen.add(b);
        best = Math.max(best ?? 0, this.levelOf(b.id));
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

  // ───────────── E23.4.4: land fades around low water ─────────────

  private fadeMap = new Map<string, number>();
  private fadeKey = '';
  /**
   * What the fade map was built from (`version`, `shapeRev`). Levels and shapes only change in a water step or when a
   * water tile or a level is touched, so between those the land's look is one map lookup per tile: a chunk rebuild
   * never walks the bodies, and the renderer's per-frame check is two number compares.
   */
  private fadeAtVersion = -1;
  private fadeAtShape = -1;
  /** the spring regions still asleep when the fade map was built (waking one changes what fades) */
  private fadeAtSleep = '';

  /** Spring regions whose landmark still sleeps (their water is dormant), as a key. */
  private sleepKey(): string {
    if (!this.sim.oldCity || !WATER_NET.springsNeedLandmark) return '';
    return (Object.keys(WATER_NET.springs) as RegionId[]).filter((r) => this.sim.areas.fog(r) !== 'cleared').join();
  }

  private fadeStale(): boolean {
    return this.fadeAtVersion !== this.version || this.fadeAtShape !== this.shapeRev || this.fadeAtSleep !== this.sleepKey();
  }
  private changesVersion = -1;
  private changesShape = -1;

  /** Bloom stages a level takes off the land around it (0 at or above `fadeBelow`). */
  static fadeSteps(level: number): number {
    const { fadeBelow, fadeSteps } = WATER_NET;
    if (level >= fadeBelow) return 0;
    return Math.min(fadeSteps, Math.ceil(((fadeBelow - level) / fadeBelow) * fadeSteps));
  }

  /**
   * How many bloom stages a tile shows less because the water near it is low (0 almost everywhere). Land with no
   * water within `fadeReach` never fades: it never depended on it. The fullest body in reach decides.
   */
  fadeAt(t: TileData): number {
    if (this.fadeStale()) this.refreshFade();
    return this.fadeMap.size ? (this.fadeMap.get(t.id) ?? 0) : 0;
  }

  /**
   * The bloom stage a tile shows: its own bloom less the fade, never below 1 on restored ground. The tile itself
   * never changes (nothing is lost): refilling the water brings it all straight back.
   */
  bloomShown(t: TileData): number {
    if (t.ground !== 'restored' || t.bloom <= 1) return t.bloom;
    const f = this.fadeAt(t);
    return f ? Math.max(1, t.bloom - f) : t.bloom;
  }

  /** Bodies whose fade step is above 0, with the step, as a key (the map is rebuilt only when this changes). */
  private fadeState(): { key: string; low: WaterBody[] } {
    const low: WaterBody[] = [];
    let key = '';
    for (const b of this.live()) {
      if (this.dormant(b)) continue; // the dry Cistern pond is its landmark's story: its land doesn't fade for it
      const s = WaterSystem.fadeSteps(this.levelOf(b.id));
      if (!s) continue;
      low.push(b);
      key += `${b.id}:${s}:${b.tiles.size};`;
    }
    return { key, low };
  }

  private refreshFade() {
    this.fadeAtVersion = this.version;
    this.fadeAtShape = this.shapeRev;
    this.fadeAtSleep = this.sleepKey();
    const { key, low } = this.fadeState();
    if (key === this.fadeKey) return;
    this.fadeKey = key;
    this.fadeMap.clear();
    if (!low.length) return;
    const R = WATER_NET.fadeReach;
    const g = this.sim.grid;
    const cell = (x: number, z: number) => x * 65536 + z;
    // every body within reach of the faded areas (the low ones and any fuller neighbour), found once
    const near = new Set<WaterBody>();
    for (const b of low) {
      near.add(b);
      const [x0, z0, x1, z1] = this.fadeBounds(b);
      for (let z = z0 - R; z <= z1 + R; z++)
        for (let x = x0 - R; x <= x1 + R; x++) {
          const t = g.get(GROUND, x, z);
          if (this.isFresh(t)) near.add(this.bodyAt(t)!);
        }
    }
    // each body marks the land within its reach with its level; the fullest mark wins (no water in reach: no mark)
    const best = new Map<number, number>();
    for (const b of near) {
      const lv = this.levelOf(b.id);
      for (const id of b.tiles) {
        const t = g.byTileId(id);
        if (!t) continue;
        for (let dz = -R; dz <= R; dz++)
          for (let dx = -R; dx <= R; dx++) {
            const k = cell(t.x + dx, t.z + dz);
            const have = best.get(k);
            if (have === undefined || lv > have) best.set(k, lv);
          }
      }
    }
    for (const b of low) {
      const [x0, z0, x1, z1] = this.fadeBounds(b);
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const lv = best.get(cell(x, z));
          const steps = lv === undefined ? 0 : WaterSystem.fadeSteps(lv);
          if (!steps) continue;
          const t = g.get(GROUND, x, z);
          if (t && t.feature !== 'water') this.fadeMap.set(t.id, steps);
        }
    }
  }

  private shownSteps = new Map<string, number>();

  /**
   * For the renderer: the areas whose look changed since the last call (a body crossed a fade step), so only
   * their chunks are rebuilt.
   */
  takeFadeChanges(): [number, number, number, number][] {
    if (this.changesVersion === this.version && this.changesShape === this.shapeRev) return [];
    this.changesVersion = this.version;
    this.changesShape = this.shapeRev;
    const out: [number, number, number, number][] = [];
    const now = new Map<string, number>();
    for (const b of this.live()) {
      const s = WaterSystem.fadeSteps(this.levelOf(b.id));
      now.set(b.id, s);
      if ((this.shownSteps.get(b.id) ?? 0) !== s) out.push(this.fadeBounds(b));
    }
    for (const [id, s] of this.shownSteps) {
      if (now.has(id) || !s) continue;
      const b = this.body(id);
      if (b) out.push(this.fadeBounds(b));
    }
    this.shownSteps = now;
    return out;
  }

  /** The area (inclusive tile bounds, grown by the fade reach) whose look a body's level touches. */
  fadeBounds(b: WaterBody): [number, number, number, number] {
    let x0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      z1 = -Infinity;
    for (const id of b.tiles) {
      const t = this.sim.grid.byTileId(id);
      if (!t) continue;
      x0 = Math.min(x0, t.x);
      z0 = Math.min(z0, t.z);
      x1 = Math.max(x1, t.x);
      z1 = Math.max(z1, t.z);
    }
    const R = WATER_NET.fadeReach;
    return [x0 - R, z0 - R, x1 + R, z1 + R];
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

  /**
   * E23.1.5's advisor: is this area short of water? True only where its land actually shows a fade (restored,
   * blooming ground in reach of water below `fadeBelow`). Only areas the player has seen count (the advisor never
   * hints at unseen places), and a body still waiting for its landmark (the dry Cistern pond) fades nothing.
   */
  isLow(areaId: string): boolean {
    if (this.sim.areas.fog(areaId) === 'hidden') return false;
    return this.fadingAreas().has(areaId);
  }

  private fading?: { version: number; shape: number; land: number; sleep: string; areas: Set<string> };
  /** bumped on every tile change (a tile restored or bloomed changes which land shows a fade) */
  private landRev = 0;

  /**
   * Areas where land actually shows a fade now (E23.4.4): restored ground with some bloom on it, in reach of low
   * water. Low water with no such land beside it (a canal through dead streets) is not a hint worth giving.
   */
  private fadingAreas(): Set<string> {
    if (this.fadeStale()) this.refreshFade();
    const f = this.fading;
    if (f && f.version === this.version && f.shape === this.shapeRev && f.land === this.landRev && f.sleep === this.fadeAtSleep) return f.areas;
    const areas = new Set<string>();
    const map = this.sim.areas.map;
    for (const id of this.fadeMap.keys()) {
      const t = this.sim.grid.byTileId(id);
      if (t && t.ground === 'restored' && t.bloom > 1) areas.add(map.areaOfCell(t.x, t.z));
    }
    this.fading = { version: this.version, shape: this.shapeRev, land: this.landRev, sleep: this.fadeAtSleep, areas };
    return areas;
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

  /**
   * A body waiting for its landmark: spring-fed water whose landmark still sleeps (the Cistern pond until the Old
   * Cistern wakes). It stays as it is, dry, whatever the weather; waking the landmark fills it.
   */
  dormant(b: WaterBody): boolean {
    const r = b.region;
    return !!r && WATER_NET.springsNeedLandmark && !!WATER_NET.springs[r] && this.sim.areas.fog(r) !== 'cleared';
  }

  /**
   * Every body the sim knows: the live ones, every region's canals and ponds, and any body found this session.
   * The weather acts on all of them alike (only a dormant body waits).
   */
  known(): WaterBody[] {
    const out = new Set(this.live());
    if (this.sim.oldCity) for (const r of REGION_WATER.keys()) for (const b of this.springBodies(r)) out.add(b);
    for (const b of this.bodies.values()) out.add(b);
    return [...out];
  }

  /** Each body's depth map, for `bared`/`covered` and the drained bed's look (cleared when shapes change). */
  private shapes = new Map<WaterBody, { d: Map<string, number>; count: number[]; max: number }>();

  /** How far each tile of a body lies from its bank (1 = on it), by breadth-first walk inward. */
  depths(b: WaterBody): { d: Map<string, number>; count: number[]; max: number } {
    const hit = this.shapes.get(b);
    if (hit) return hit;
    const g = this.sim.grid;
    const d = new Map<string, number>();
    const queue: TileData[] = [];
    for (const id of b.tiles) {
      const t = g.byTileId(id);
      if (t && SIDES.some(([dx, dz]) => !b.tiles.has(g.peek(GROUND, t.x + dx, t.z + dz)?.id ?? ''))) {
        d.set(t.id, 1);
        queue.push(t);
      }
    }
    let max = 1;
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i];
      const k = d.get(t.id)!;
      for (const [dx, dz] of SIDES) {
        const n = g.peek(GROUND, t.x + dx, t.z + dz);
        if (!n || !b.tiles.has(n.id) || d.has(n.id)) continue;
        d.set(n.id, k + 1);
        max = Math.max(max, k + 1);
        queue.push(n);
      }
    }
    const count = new Array<number>(max + 2).fill(0);
    for (const k of d.values()) count[k]++;
    const out = { d, count, max };
    this.shapes.set(b, out);
    return out;
  }

  /**
   * How far in from the bank the bed shows (tiles), so the bed's area matches the share drained: each tile at
   * depth k shows `clamp(front - (k - 1), 0, 1)` of itself, and those add up to `empty` x the body's area.
   * `count[k]` is how many tiles lie at depth k.
   */
  static front(count: number[], max: number, empty: number): number {
    let total = 0;
    for (let k = 1; k <= max; k++) total += count[k] ?? 0;
    const want = empty * total;
    let done = 0;
    for (let k = 1; k <= max; k++) {
      const c = count[k] ?? 0;
      if (done + c >= want) return k - 1 + (c ? (want - done) / c : 0);
      done += c;
    }
    return max;
  }

  /** How much of a water tile its body's drained bed covers (0 = all water, 1 = bare bed). */
  bared(t: TileData | undefined): number {
    const b = this.bodyAt(t);
    if (!b) return 0;
    // in the renderer's steps, so the pads and koi agree with the bed drawn
    const empty = Math.round((1 - this.levelOf(b.id)) * WATER_NET.lookSteps) / WATER_NET.lookSteps;
    if (empty <= 0) return 0;
    const { d, count, max } = this.depths(b);
    const front = WaterSystem.front(count, max, empty);
    return Math.max(0, Math.min(1, front - ((d.get(t!.id) ?? 1) - 1)));
  }

  /** Is this water tile still under water? Lily pads and koi keep to these as a pond drains. */
  covered(t: TileData | undefined): boolean {
    return this.bodyAt(t) !== undefined && this.bared(t) < 0.5;
  }

  /** sim seconds counted by `tick` (for the wake rush) */
  private clock = 0;
  /** spring regions awake at the last tick (undefined until the first, so a loaded game never rushes) */
  private awake?: Set<RegionId>;
  /** region -> sim second its wake rush ends */
  private rushUntil = new Map<RegionId, number>();

  tick(dt: number) {
    this.acc += dt;
    if (this.acc < WATER_NET.step) return;
    const span = this.acc;
    this.acc = 0;
    this.clock += span;
    this.wakes();
    const days = span / WATER_NET.daySeconds;
    const { fill, evap } = this.sky();
    for (const b of this.known()) {
      if (this.dormant(b)) continue;
      let lv = this.levelOf(b.id);
      const before = lv;
      lv += (fill + this.springOf(b)) * days + this.rushOf(b, span);
      if (evap && lv > WATER_NET.evaporationFloor) lv = Math.max(WATER_NET.evaporationFloor, lv - evap * days);
      if (lv !== before) this.set(b.id, lv);
    }
  }

  /** A spring region whose landmark just woke starts its rush: its water fills over `wakeRush` seconds. */
  private wakes() {
    const now = new Set<RegionId>();
    if (this.sim.oldCity)
      for (const r of Object.keys(WATER_NET.springs) as RegionId[]) if (this.sim.areas.fog(r) === 'cleared') now.add(r);
    if (this.awake) for (const r of now) if (!this.awake.has(r)) this.rushUntil.set(r, this.clock + WATER_NET.wakeRush);
    this.awake = now;
  }

  /** The share a body gains from its region's wake rush this step. */
  private rushOf(b: WaterBody, span: number): number {
    const end = b.region ? this.rushUntil.get(b.region) : undefined;
    if (end === undefined) return 0;
    const from = this.clock - span;
    if (from >= end) {
      this.rushUntil.delete(b.region!);
      return 0;
    }
    return Math.min(span, end - from) / WATER_NET.wakeRush;
  }
}
