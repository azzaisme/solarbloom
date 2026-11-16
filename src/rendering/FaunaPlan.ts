import { GROUND } from '../core/GameState';
import type { MachineData, TileData } from '../core/types';
import { CAT_ANCHORS } from '../data/templates';
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
