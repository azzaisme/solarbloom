import { GROUND } from '../core/GameState';
import { regionById, regionOfCell, seaCell, surfCell } from '../core/OldCityLayout';
import { isUsable } from './Unlocks';
import type { BuildableType, MachineData, TileData, WeatherKind } from '../core/types';
import { KEEPERS, REGIONS, type RegionId } from '../data/oldcity';
import { WATER_NET } from '../data/water';
import type { Sim } from './Sim';
import { plantId, tankId, WaterPipes } from './WaterPipes';

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
  /** E23.4.2.1: a reservoir (a built tank, id `r:<machine id>`; `tiles` is its footprint, not water) */
  reservoir?: MachineData;
}

/** E23.8.2's unlock ids for the water network (all handed over in Cistern Basin). */
export type WaterUnlock = 'reservoir' | 'pump' | 'pipe' | 'gravityFeed' | 'desalinationPlant';

/** E23.4.1: what a save keeps. Levels are shares of capacity (0…1), only for bodies that have changed. */
export interface WaterSave {
  levels: Record<string, number>;
}

/** Each region's water rectangles (its canals and ponds), by region. */
const REGION_WATER = new Map(REGIONS.filter((r) => r.water?.length).map((r) => [r.id, r.water!]));

/** E23.7's weather names, as the water reads them. */
const WEATHER_ALIASES: Record<string, WeatherKind> = {
  sunny: 'clear',
  storm: 'rain',
  fog: 'mist',
  wind: 'windy',
};

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
  /** E23.4.2: pipes, pumps and gravity feeds */
  readonly pipes: WaterPipes;

  constructor(private sim: Sim) {
    this.pipes = new WaterPipes(sim, this);
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

  /** The body with this id (its anchor `x,z`, or a reservoir's `r:<machine id>`). */
  body(id: string): WaterBody | undefined {
    if (id.startsWith('r:')) return this.tank(id.slice(2));
    if (id.startsWith('d:')) return this.plantTank(id.slice(2));
    const hit = this.bodies.get(id);
    if (hit) return hit;
    const [x, z] = id.split(',').map(Number);
    const b = this.bodyAt(this.sim.grid.get(GROUND, x, z));
    return b?.id === id ? b : undefined;
  }

  private tanks = new Map<string, WaterBody>();

  /** E23.4.2.1: a reservoir's water, by its machine id (undefined once it is taken down). */
  tank(machineId: string): WaterBody | undefined {
    const m = this.sim.machine(machineId);
    if (!m || m.type !== 'reservoir') {
      this.tanks.delete(machineId);
      return undefined;
    }
    let b = this.tanks.get(machineId);
    if (b?.reservoir !== m) {
      const tiles = new Set(this.sim.grid.footprint(m.roofId, m.x, m.z, m.size).flatMap((t) => (t ? [t.id] : [])));
      const region = this.sim.oldCity ? (regionOfCell(m.x, m.z)?.id as RegionId | undefined) : undefined;
      b = { id: tankId(m), tiles, capacity: WATER_NET.reservoir.capacity, region, reservoir: m };
      this.tanks.set(machineId, b);
    }
    return b;
  }

  /** Every reservoir's water. */
  reservoirs(): WaterBody[] {
    return this.sim.machinesOfType('reservoir').flatMap((m) => this.tank(m.id) ?? []);
  }

  /** E23.4.3: does this land tile touch the sea (the open sea, the bay or the surf; 8 neighbours)? */
  onShore(t: TileData): boolean {
    if (t.roofId !== GROUND || !this.sim.oldCity) return false;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.sim.grid.get(GROUND, t.x + dx, t.z + dz);
        if (n?.feature === 'water' && (seaCell(n.x, n.z) || surfCell(n.x, n.z))) return true;
      }
    return false;
  }

  /** E23.4.3: a desalination plant's fresh-water tank (its id is `d:<machine id>`). */
  plantTank(machineId: string): WaterBody | undefined {
    const m = this.sim.machine(machineId);
    if (!m || m.type !== 'desalination') return undefined;
    let b = this.tanks.get(machineId);
    if (b?.reservoir !== m) {
      const tiles = new Set(this.sim.grid.footprint(m.roofId, m.x, m.z, m.size).flatMap((t) => (t ? [t.id] : [])));
      b = { id: plantId(m), tiles, capacity: WATER_NET.desal.tank, reservoir: m };
      this.tanks.set(machineId, b);
    }
    return b;
  }

  /** Every desalination plant's tank. */
  plants(): WaterBody[] {
    return this.sim.machinesOfType('desalination').flatMap((m) => this.plantTank(m.id) ?? []);
  }

  /** E23.4.2: the region unlock (E23.8.2, Cistern Basin) a water machine needs, if it is one. */
  unlockFor(type: BuildableType): WaterUnlock | undefined {
    return type === 'reservoir' ? 'reservoir' : type === 'pump' ? 'pump' : type === 'desalination' ? 'desalinationPlant' : undefined;
  }

  /** Has bloombot been handed this part of the water network? (Classic rules: always.) */
  unlocked(id: WaterUnlock): boolean {
    return !this.sim.oldCity || isUsable(this.sim.state, id);
  }

  /** The water network's lock, in words (the build menu and a refused build). */
  lockLabel(): string {
    return `🔒 ${regionById('cistern')?.name ?? 'Cistern Basin'}`;
  }

  lockReason(): string {
    const k = KEEPERS.find((q) => q.region === 'cistern');
    return `Wake ${k?.name ?? 'the Keeper'} in ${regionById('cistern')?.name ?? 'Cistern Basin'} first`;
  }

  /** E23.4.2: why a water machine can't stand here (undefined: it can). Called by the build check. */
  placeProblem(type: BuildableType, roofId: string, x: number, z: number): string | undefined {
    if (type !== 'pump' && type !== 'reservoir' && type !== 'desalination') return undefined;
    const size = type === 'pump' ? 1 : 2;
    const foot = this.sim.grid.footprint(roofId, x, z, size);
    if (foot.some((t) => t?.feature === 'water')) return 'Not in the water: on its bank';
    if (type === 'reservoir') return undefined;
    if (type === 'desalination') return foot.some((t) => t && this.onShore(t)) ? undefined : 'A desalination plant stands on the shore, beside the sea';
    if (roofId !== GROUND) return 'A pump stands on the ground, on the bank of a pond or canal';
    for (const t of foot) if (t && this.bodyNear(t, 1)) return undefined;
    return 'A pump stands on the bank of a pond or canal';
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
    if (id.startsWith('r:') || id.startsWith('d:')) return WATER_NET.reservoir.startLevel;
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

  /**
   * Takes up to `units` from the nearest body within reach of a tile; with none in reach (or it ran dry), through a
   * pipe beside the tile that carries water (E23.4.2).
   */
  drawNear(t: TileData, units: number): number {
    const b = this.bodyNear(t);
    const got = b ? this.draw(b.id, units) : 0;
    return got < units ? got + this.pipes.drawAt(t, units - got) : got;
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

  /** Does a body within reach still hold water, or does a pipe beside the tile carry some? (planters) */
  isWatered(t: TileData): boolean {
    return this.wetness(t) > WATER_NET.dryBelow || this.pipes.feeds(t);
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
      else if ((id.startsWith('r:') || id.startsWith('d:')) && !this.sim.machine(id.slice(2))) delete this.save.levels[id]; // taken down
    }
    return out;
  }

  // ───────────── E23.4.4: land fades around low water ─────────────

  private fadeMap = new Map<string, number>();
  private fadeKey = '';

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
    this.refreshFade();
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
      if (b.reservoir) continue; // a tank's level is its own: the land beside it doesn't depend on it
      const s = WaterSystem.fadeSteps(this.levelOf(b.id));
      if (!s) continue;
      low.push(b);
      key += `${b.id}:${s}:${b.tiles.size};`;
    }
    return { key, low };
  }

  private refreshFade() {
    const { key, low } = this.fadeState();
    if (key === this.fadeKey) return;
    this.fadeKey = key;
    this.fadeMap.clear();
    const R = WATER_NET.fadeReach;
    const g = this.sim.grid;
    for (const b of low) {
      const [x0, z0, x1, z1] = this.fadeBounds(b);
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const t = g.get(GROUND, x, z);
          if (!t || t.feature === 'water' || this.fadeMap.has(t.id)) continue;
          const w = this.fullest(t, R);
          const s = w === undefined ? 0 : WaterSystem.fadeSteps(w); // no water in reach: nothing to fade
          if (s) this.fadeMap.set(t.id, s);
        }
    }
  }

  private shownSteps = new Map<string, number>();

  /**
   * For the renderer: the areas whose look changed since the last call (a body crossed a fade step), so only
   * their chunks are rebuilt.
   */
  takeFadeChanges(): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    const now = new Map<string, number>();
    for (const b of this.live()) {
      if (b.reservoir) continue;
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

  /**
   * The weather now: E23.7's `sim.weather.kind()` when it is there, else E21.13's saved field; unset is plain cloud
   * (no rain, no sun).
   */
  weather(): WeatherKind {
    const live = (this.sim as { weather?: { kind?: () => string } }).weather?.kind?.();
    if (live) return WEATHER_ALIASES[live] ?? (live as WeatherKind);
    return this.sim.state.salvage?.weather?.kind ?? 'cloudy';
  }

  // ───────────── hooks for the gentle-failure suite (E23.10) ─────────────

  /** Every body this session knows of, empty. */
  drainForTest() {
    for (const b of new Set([...this.bodies.values(), ...this.live()])) this.draw(b.id, b.capacity);
  }

  /** Every body this session knows of, full. */
  refillForTest() {
    for (const b of new Set([...this.bodies.values(), ...this.live()])) this.fill(b.id, b.capacity);
  }

  /** No water within reach that still holds any. */
  isDry(t: TileData): boolean {
    return !this.isWatered(t);
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
    for (const b of this.reservoirs()) if (!out.includes(b)) out.push(b);
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
    const w = this.weather();
    const fill = WATER_NET.weatherFill[w] ?? 0;
    const evap = w === 'clear' ? WATER_NET.evaporationPerDay : 0;
    for (const b of this.live()) {
      if (b.reservoir?.type === 'desalination') continue; // a closed tank: no rain, no sun
      let lv = this.levelOf(b.id);
      const before = lv;
      lv += (fill + this.springOf(b)) * days;
      if (evap && lv > WATER_NET.evaporationFloor) lv = Math.max(WATER_NET.evaporationFloor, lv - evap * days);
      if (lv !== before) this.set(b.id, lv);
    }
    // E23.4.2.1: a canal or pond on a reservoir's bank fills it
    for (const r of this.reservoirs()) {
      const room = (1 - this.levelOf(r.id)) * r.capacity;
      if (room <= 0) continue;
      const src = this.bankOf(r.reservoir!);
      if (!src) continue;
      this.fill(r.id, this.draw(src.id, Math.min(room, WATER_NET.reservoir.bankFillPerDay * r.capacity * days)));
    }
    this.pipes.registerPower();
    this.desalinate(days);
    this.pipes.tick(days);
  }

  /** Plants asking the grid for power this step (they run whenever their tank has room or somewhere to empty). */
  readonly desalinating = new Set<string>();

  /**
   * E23.4.3: each plant on power fills its tank from the sea, in any weather, then empties it into a pond or canal
   * on its bank. The pipes it touches take from the tank like a pump's line (WaterPipes).
   */
  private desalinate(days: number) {
    this.desalinating.clear();
    for (const t of this.plants()) {
      const m = t.reservoir!;
      const bank = this.bankOf(m);
      const room = (1 - this.levelOf(t.id)) * t.capacity;
      const outlet = bank ? (1 - this.levelOf(bank.id)) * bank.capacity : 0;
      if (room <= 1e-9 && outlet <= 1e-9 && !this.pipes.netsOf(m).length) continue;
      this.desalinating.add(m.id);
      if (!this.pipes.powered(m)) continue;
      this.fill(t.id, WATER_NET.desal.perDay * days);
      if (bank) this.fill(bank.id, this.draw(t.id, outlet));
    }
  }

  /** The pond or canal on a reservoir's bank (touching its footprint), if any. */
  bankOf(m: MachineData): WaterBody | undefined {
    for (const t of this.sim.grid.footprint(m.roofId, m.x, m.z, m.size)) {
      const b = t && this.bodyNear(t, 1);
      if (b) return b;
    }
    return undefined;
  }
}
