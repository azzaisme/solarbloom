import { GROUND } from '../core/GameState';
import type { MachineData, TileData } from '../core/types';
import { CAT_ANCHORS } from '../data/templates';
import { plotById } from '../core/Plots';
import { decoration } from '../core/Decor';
import { isBuilt } from '../data/machines';
import { TUNING } from '../data/tuning';
import type { Sim } from '../gameplay/Sim';

/**
 * Phase 5 E16: where cosmetic fauna go. Pure planning with no PlayCanvas (so it is unit-tested): it only reads
 * the simulation, never writes it, and everything is seeded (machine ids, actor indices, route legs), so the
 * same world always gives the same routes and resting spots. Fauna.ts animates the pooled actors it returns.
 */

/** 0..1 from integers (stable across runs; no Math.random). */
export function hash01(a: number, b: number, c: number, d = 0): number {
  let h = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791) ^ Math.imul(d | 0, 2654435761);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** A stable small integer from a string id. */
export function idHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * The `leg`th stop of an actor's wander route around `home` (cells within `radius`), seeded by `seed` and
 * `actor`. Cells failing `ok` are skipped (a few tries, then home). Same inputs, same route.
 */
export function wanderStop(seed: number, actor: number, leg: number, home: { x: number; z: number }, radius: number, ok: (x: number, z: number) => boolean): { x: number; z: number } {
  for (let k = 0; k < 8; k++) {
    const a = hash01(seed, actor, leg, k) * Math.PI * 2;
    const r = Math.sqrt(hash01(seed, actor, leg, k + 101)) * radius;
    const x = Math.floor(home.x + Math.cos(a) * r);
    const z = Math.floor(home.z + Math.sin(a) * r);
    if (ok(x, z)) return { x: x + 0.2 + 0.6 * hash01(seed, actor, leg, k + 7), z: z + 0.2 + 0.6 * hash01(seed, actor, leg, k + 13) };
  }
  return { x: home.x, z: home.z };
}

/** A machine that is really working right now (drives its "active" effects; idle machines only breathe). */
export function machineRunning(sim: Sim, m: MachineData): boolean {
  if (!isBuilt(m)) return false;
  const e = sim.econ;
  switch (m.type) {
    case 'solar':
      return !e.isFull('energy');
    case 'condenser':
      return !e.isFull('water');
    case 'droneHub':
      return sim.state.drones.some((d) => d.hubId === m.id && d.mode !== 'idle');
    case 'core':
      return !!sim.state.progression.coreActivated || (sim.areas.areaOf(m) !== undefined && sim.areas.fog(sim.areas.areaOf(m)!) === 'cleared');
    default:
      return true; // gardens, trees and relays work whenever they stand
  }
}

export interface CatSpot {
  machineId: string;
  x: number;
  z: number;
  /** degrees */
  rot: number;
  /** coat (0 grey tabby, 1 ginger, 2 black and white) */
  coat: number;
}

/** Lucky Cat anchors near a cell: the park's fixed ones and any city nook a free neighbour could become. */
function luckyAnchorsNear(sim: Sim, x: number, z: number): [number, number][] {
  const out: [number, number][] = [];
  for (const a of CAT_ANCHORS) if (a.roofId === GROUND && Math.abs(a.pos[0] - x) < 3 && Math.abs(a.pos[2] - z) < 3) out.push([a.pos[0], a.pos[2]]);
  // City nooks: a free tile beside an obstacle with a prop; the cat sits 0.32 towards the obstacle (the same
  // rule as LuckyCatSystem.nookAnchor, read with peek so planning never generates chunks).
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      const t = sim.grid.peek(GROUND, Math.floor(x) + dx, Math.floor(z) + dz);
      if (!t || t.blocked || t.occupantId) continue;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ob = sim.grid.peek(GROUND, t.x + ox, t.z + oz);
        if (ob && ob.blocked && ob.prop) out.push([t.x + 0.5 + ox * 0.32, t.z + 0.5 + oz * 0.32]);
      }
    }
  // every cat hiding right now: the regular one and any Lucky Cat Invasion cats (E15)
  for (const spot of sim.cat.spots()) {
    const act = sim.cat.anchor(spot.anchorId);
    if (act && act.roofId === GROUND) out.push([act.pos[0], act.pos[2]]);
  }
  return out;
}

/** Minimum distance (tiles) between a sleeping cat and any place a Lucky Cat could sit. */
export const CAT_ANCHOR_CLEARANCE = 0.75;

/**
 * Sleeping cats: a seeded share of finished machines on restored ground in view, curled up inside the machine's
 * own footprint (a cell no Lucky Cat can use: anchors need a free tile), never within CAT_ANCHOR_CLEARANCE of a
 * Lucky Cat anchor. Nearest the view centre first, at most `max`.
 */
export function catSpots(sim: Sim, rect: Rect, max: number): CatSpot[] {
  if (max <= 0) return [];
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  const share = TUNING.ecosystem.cats.share;
  const cands: (CatSpot & { d: number })[] = [];
  for (const m of sim.state.machines) {
    if (m.roofId !== GROUND || m.type === 'core' || !isBuilt(m)) continue;
    if (m.x + m.size < rect.x0 || m.x > rect.x1 || m.z + m.size < rect.z0 || m.z > rect.z1) continue;
    const h = idHash(m.id);
    if (hash01(h, 5, 9) >= share) continue;
    const t = sim.grid.peek(GROUND, m.x, m.z);
    if (!t || t.ground !== 'restored') continue;
    // The footprint's corner facing the camera (+x, +z), inset so the cat stays inside it and out from under
    // the machine's own panels.
    const inset = 0.16;
    const x = m.x + m.size - inset;
    const z = m.z + m.size - inset;
    if (luckyAnchorsNear(sim, x, z).some(([ax, az]) => Math.hypot(ax - x, az - z) < CAT_ANCHOR_CLEARANCE)) continue;
    cands.push({ machineId: m.id, x, z, rot: (h % 360) | 0, coat: h % 3, d: Math.hypot(x - cx, z - cz) });
  }
  cands.sort((a, b) => a.d - b.d);
  return cands.slice(0, max).map(({ d: _d, ...s }) => s);
}

/**
 * Tiles in a rectangle matching `pick`, nearest its centre first (square rings outwards, at most `radius` tiles
 * out, so the cost is bounded however far the view reaches). Only chunks already loaded; never generates.
 */
export function tilesIn(sim: Sim, rect: Rect, pick: (t: TileData) => boolean, limit = 400, radius = 14): TileData[] {
  const out: TileData[] = [];
  const cx = Math.floor((rect.x0 + rect.x1) / 2);
  const cz = Math.floor((rect.z0 + rect.z1) / 2);
  const visit = (x: number, z: number) => {
    if (x < rect.x0 - 1 || x > rect.x1 || z < rect.z0 - 1 || z > rect.z1) return;
    const t = sim.grid.peek(GROUND, x, z);
    if (t && pick(t)) out.push(t);
  };
  visit(cx, cz);
  for (let r = 1; r <= radius && out.length < limit; r++) {
    for (let i = -r; i < r; i++) {
      visit(cx + i, cz - r);
      visit(cx + r, cz + i);
      visit(cx - i, cz + r);
      visit(cx - r, cz - i);
    }
  }
  return out.slice(0, limit);
}

/** Built superstructures in (or near) a rectangle. */
export function supersIn(sim: Sim, rect: Rect, margin = 4): MachineData[] {
  return sim.state.machines.filter((m) => m.roofId === GROUND && (m.tier ?? 1) >= 3 && isBuilt(m) && m.x + m.size >= rect.x0 - margin && m.x <= rect.x1 + margin && m.z + m.size >= rect.z0 - margin && m.z <= rect.z1 + margin);
}

/** The park fountain (centre, world x/z), once it flows. */
export function fountainPond(sim: Sim): { x: number; z: number } | undefined {
  if (!sim.state.progression.coreActivated) return undefined;
  const m = sim.state.machines.find((x) => x.type === 'core' && x.roofId === GROUND && sim.areas.areaOf(x) === 'park');
  return m ? { x: m.x + m.size / 2, z: m.z + m.size / 2 } : undefined;
}

/** E19.3.1 (#257): the animals that move into cleared areas. */
export type LocalSpecies = 'rabbits' | 'pigeons' | 'ducks' | 'frogs' | 'squirrels';
export const LOCAL_SPECIES: readonly LocalSpecies[] = ['rabbits', 'pigeons', 'ducks', 'frogs', 'squirrels'];

export interface LocalSlot {
  species: LocalSpecies;
  key: string;
  home: { x: number; z: number };
  /** on a water tile (ducks swim at the water's surface) */
  water: boolean;
}

/** Where each species likes to be: a restored tile of the right kind, free of machines and obstacles. */
export function localHabitat(species: LocalSpecies, t: TileData, nearWater: () => boolean): boolean {
  if (t.ground !== 'restored' || t.blocked || t.occupantId) return false;
  const f = t.feature ?? 'lawn';
  switch (species) {
    case 'ducks':
      return f === 'water';
    case 'frogs':
      return f !== 'water' && nearWater();
    case 'pigeons':
      return f === 'paving' || f === 'road' || f === 'lawn';
    case 'rabbits':
    case 'squirrels':
      return f === 'lawn' || f === 'litter' || f === 'clay';
  }
}

/**
 * E19.3.1 (#257): animal slots in view. Only areas whose fog is cleared get their area type's cast
 * (`TUNING.ecosystem.locals`); one animal per `localsEvery` matching tiles, nearest the view centre first. Pure
 * and seeded by tile: the same world and view give the same slots. Reads the simulation, never writes it.
 */
export function localSlots(sim: Sim, rect: Rect): LocalSlot[] {
  const E = TUNING.ecosystem;
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  const castOf = new Map<string, readonly LocalSpecies[]>();
  const cast = (t: TileData): readonly LocalSpecies[] => {
    const id = sim.areas.areaOf(t);
    if (!id) return [];
    let c = castOf.get(id);
    if (!c) {
      c = sim.areas.fog(id) === 'cleared' ? (E.locals[sim.areas.info(id).type] ?? []) : [];
      castOf.set(id, c);
    }
    return c;
  };
  const tiles = tilesIn(sim, rect, (t) => t.ground === 'restored' && cast(t).length > 0, 600, 18);
  tiles.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
  const seen: Record<LocalSpecies, number> = { rabbits: 0, pigeons: 0, ducks: 0, frogs: 0, squirrels: 0 };
  const out: LocalSlot[] = [];
  for (const t of tiles) {
    const nearWater = () => sim.grid.neighbors(t).some((n) => n.feature === 'water');
    for (const sp of cast(t)) {
      if (!localHabitat(sp, t, nearWater)) continue;
      if (seen[sp]++ % E.localsEvery !== 0) continue;
      out.push({ species: sp, key: `${sp}:${t.x}:${t.z}`, home: { x: t.x + 0.5, z: t.z + 0.5 }, water: t.feature === 'water' });
    }
  }
  return out;
}

/** E19.3.2 (#258): who visits a chosen plot option (and, from E19.2, a decoration). */
export type VisitorKind = 'groundBirds' | 'cats' | LocalSpecies;
export const PLOT_VISITORS: Record<string, VisitorKind[]> = {
  garden: ['groundBirds', 'groundBirds'],
  orchard: ['groundBirds', 'squirrels'],
  meadow: ['rabbits', 'groundBirds'],
  arbour: ['groundBirds'],
  greenhouse: ['groundBirds'],
  crates: ['groundBirds'],
  cafe: ['cats', 'pigeons'],
  parklet: ['cats'],
  picnic: ['cats', 'groundBirds'],
  playground: ['pigeons'],
  bandstand: ['pigeons', 'pigeons'],
  bikes: ['pigeons'],
  stalls: ['pigeons', 'pigeons'],
  splash: ['pigeons'],
  mooring: ['ducks', 'ducks'],
  reeds: ['ducks', 'frogs'],
  dipping: ['frogs', 'frogs'],
  hut: ['squirrels'],
};

/** E19.3.2 (#258) with E19.2: who visits a decoration (one each). No cat at the Lucky Cat statue: never mistakable. */
export const DECOR_VISITORS: Record<string, VisitorKind> = {
  bench: 'cats',
  rug: 'cats',
  birdbath: 'groundBirds',
  flowerbed: 'groundBirds',
  trough: 'groundBirds',
  pot: 'groundBirds',
  topiary: 'groundBirds',
  barrel: 'groundBirds',
  bunting: 'pigeons',
  lamppost: 'pigeons',
  solarlamppost: 'pigeons',
  cratestack: 'squirrels',
  stones: 'frogs',
};

export interface VisitorSlot {
  kind: VisitorKind;
  key: string;
  home: { x: number; z: number };
  water: boolean;
}

/**
 * E19.3.2 (#258): animals drawn to what the player chose: birds in kitchen gardens, a cat asleep at the café,
 * ducks by a mooring, frogs at a dipping pond. Read from `state.cozy` (the game's own choices), seeded by plot id,
 * nearest the view first. Ducks need a restored water cell beside the plot; a cat never sits near a Lucky Cat
 * spot. Reads the simulation, never writes it.
 */
export function visitorSlots(sim: Sim, rect: Rect, gen = sim.grid.layer(GROUND)?.gen ?? 1): VisitorSlot[] {
  const chosen = sim.state.cozy?.plots ?? {};
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  const out: (VisitorSlot & { d: number })[] = [];
  for (const [id, option] of Object.entries(chosen)) {
    const kinds = PLOT_VISITORS[option];
    const spot = kinds && plotById(sim.grid.seed, id, gen);
    if (!spot || spot.x + spot.size < rect.x0 || spot.x > rect.x1 || spot.z + spot.size < rect.z0 || spot.z > rect.z1) continue;
    const h = idHash(id);
    const mid = { x: spot.x + spot.size / 2, z: spot.z + spot.size / 2 };
    const d = Math.hypot(mid.x - cx, mid.z - cz);
    kinds.forEach((kind, i) => {
      let home = { x: spot.x + 0.3 + hash01(h, i, 1) * (spot.size - 0.6), z: spot.z + 0.3 + hash01(h, i, 2) * (spot.size - 0.6) };
      let water = false;
      if (kind === 'ducks') {
        const w = waterBeside(sim, spot.x, spot.z, spot.size, h + i);
        if (!w) return;
        home = w;
        water = true;
      }
      if (kind === 'cats' && luckyAnchorsNear(sim, home.x, home.z).some(([ax, az]) => Math.hypot(ax - home.x, az - home.z) < CAT_ANCHOR_CLEARANCE)) return;
      out.push({ kind, key: `v:${id}:${i}`, home, water, d });
    });
  }
  for (const [key, value] of Object.entries(sim.state.cozy?.decor ?? {})) {
    const dec = decoration(key, value);
    const kind = dec && dec.roofId === GROUND ? DECOR_VISITORS[dec.kind] : undefined;
    if (!dec || !kind || dec.x < rect.x0 - 1 || dec.x > rect.x1 || dec.z < rect.z0 - 1 || dec.z > rect.z1) continue;
    const h = idHash(key);
    // beside it (the tile itself is taken), on a free restored neighbour picked by hash
    const t0 = sim.grid.peek(GROUND, dec.x, dec.z);
    if (!t0) continue;
    const free = sim.grid.neighbors(t0).filter((n) => n.ground === 'restored' && !n.blocked && !n.occupantId && (kind === 'frogs' || n.feature !== 'water'));
    const at = kind === 'cats' ? { x: dec.x + 0.5, z: dec.z + 0.5 } : free.length ? { x: free[h % free.length].x + 0.5, z: free[h % free.length].z + 0.5 } : undefined;
    if (!at) continue;
    if (kind === 'cats' && luckyAnchorsNear(sim, at.x, at.z).some(([ax, az]) => Math.hypot(ax - at.x, az - at.z) < CAT_ANCHOR_CLEARANCE)) continue;
    out.push({ kind, key: `vd:${key}`, home: at, water: false, d: Math.hypot(at.x - cx, at.z - cz) });
  }
  out.sort((a, b) => a.d - b.d);
  return out.map(({ d: _d, ...v }) => v);
}

/** A restored water cell touching the square [x, x+size) × [z, z+size), picked by `pick` among them. */
function waterBeside(sim: Sim, x: number, z: number, size: number, pick: number): { x: number; z: number } | undefined {
  const cells: { x: number; z: number }[] = [];
  for (let i = -1; i <= size; i++)
    for (let j = -1; j <= size; j++) {
      if (i >= 0 && i < size && j >= 0 && j < size) continue;
      const t = sim.grid.peek(GROUND, x + i, z + j);
      if (t && t.feature === 'water' && t.ground === 'restored') cells.push({ x: t.x + 0.5, z: t.z + 0.5 });
    }
  return cells.length ? cells[pick % cells.length] : undefined;
}
