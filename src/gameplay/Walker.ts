import { decorKeyOf, parseDecorValue } from '../core/Decor';
import { GROUND } from '../core/GameState';
import { DECOR_OPTION } from '../data/cozy';
import { LANDING } from '../data/oldcity';
import { canStep, connected } from '../core/Height';
import { mainlandClosedAt } from '../core/Mainland';
import type { Sim } from './Sim';

/**
 * Bloombot (#234, G.2): where bloombot may stand and how it moves. Pure rules, no rendering, so tests can
 * drive it. Positions are in a layer's cell units (cell x covers [x, x + 1)); `facing` is radians with
 * 0 = +z and π/2 = +x, so the direction is (sin f, cos f).
 *
 * Nothing here changes the simulation: bloombot's pose is presentation plus a save field, and every action
 * it takes goes through the same Sim calls the cursor used (docs/BLOOMBOT_EPIC.md §9).
 */
export interface BotPose {
  roofId: string;
  x: number;
  z: number;
  facing: number;
}

export const BOT = {
  /** collision radius, cells */
  radius: 0.26,
  /** speeds, cells per second */
  walk: 2.6,
  sprint: 4.6,
  /** speed factor in water (canals, ponds) */
  wade: 0.6,
  /** how fast facing turns toward the move direction (per second, exponential) */
  turn: 16,
  /** A* gives up after expanding this many cells */
  maxSearch: 9000,
} as const;

/** The 8 neighbour steps, cardinal first. */
const STEPS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export class Walker {
  constructor(private sim: Sim) {}

  /** E19 (#235): extra solid cells the game knows about (a chosen solid plot option). */
  solid?: (roofId: string, cx: number, cz: number) => boolean;

  /** Can bloombot stand in this cell? Revealed ground, dead or restored; not fog, obstacles, machines or landmarks. */
  walkable(roofId: string, cx: number, cz: number): boolean {
    const g = this.sim.grid;
    if (roofId === GROUND) {
      // island release: the causeway and the mainland wait for a future update (bloombot turns back, see BotController)
      if (mainlandClosedAt(cx, cz)) return false;
      if (this.sim.areas.fog(this.sim.areas.map.areaOfCell(cx, cz)) === 'hidden') return false;
    } else if (!g.isPlayable(roofId) || !g.inBounds(roofId, cx, cz)) return false;
    const t = g.get(roofId, cx, cz);
    if (!t || t.blocked) return false;
    // E21.5: a deep-water gate (a canal, the basin's moat) is only crossed with Hover
    if (t.feature === 'water' && t.prop?.startsWith('gate:') && !this.sim.state.salvage?.abilities.includes('hover') && !this.sim.gates.isOpen(t.prop.slice(5))) return false;
    // E19.2: a flat decoration (a flower patch, stepping stones) occupies its tile but can be walked over.
    if (t.occupantId && !this.flatDecor(t.occupantId)) return false;
    if (this.solid?.(roofId, cx, cz)) return false;
    // An obstacle cleared to open a way in keeps its 'obstacle' feature but is no longer blocked.
    return t.feature !== 'building';
  }

  private flatDecor(occupantId: string): boolean {
    const key = decorKeyOf(occupantId);
    const v = key && this.sim.state.cozy?.decor?.[key];
    return !!v && DECOR_OPTION[parseDecorValue(v).kind]?.solid === false;
  }

  /** Does a bloombot-sized circle at (x, z) touch only walkable cells (E21.24: on its own terrace)? */
  fits(roofId: string, x: number, z: number, r: number = BOT.radius): boolean {
    const terraced = this.sim.grid.terraced(roofId);
    const ox = Math.floor(x);
    const oz = Math.floor(z);
    for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++)
      for (let cz = Math.floor(z - r); cz <= Math.floor(z + r); cz++) {
        if (!this.walkable(roofId, cx, cz)) return false;
        if (terraced && !connected(ox, oz, cx, cz)) return false;
      }
    return true;
  }

  /** E21.24: may bloombot move from one cell to a touching one (a cliff edge blocks both ways)? */
  stepOk(roofId: string, ax: number, az: number, bx: number, bz: number): boolean {
    return !this.sim.grid.terraced(roofId) || connected(ax, az, bx, bz);
  }

  /** In water (bloombot wades: slower, with a splash)? */
  wading(p: BotPose): boolean {
    return this.sim.grid.get(p.roofId, Math.floor(p.x), Math.floor(p.z))?.feature === 'water';
  }

  /**
   * Moves by (dx, dz), sliding along walls: the whole step if it fits, else each axis on its own. Steps longer
   * than a third of a cell are split so a fast frame can't tunnel through a one-cell obstacle. Returns the
   * distance actually moved.
   */
  move(p: BotPose, dx: number, dz: number): number {
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return 0;
    const n = Math.ceil(len / 0.3);
    const sx = dx / n;
    const sz = dz / n;
    const x0 = p.x;
    const z0 = p.z;
    const ok = (x: number, z: number) => this.fits(p.roofId, x, z) && this.stepOk(p.roofId, Math.floor(p.x), Math.floor(p.z), Math.floor(x), Math.floor(z));
    for (let i = 0; i < n; i++) {
      if (ok(p.x + sx, p.z + sz)) {
        p.x += sx;
        p.z += sz;
      } else {
        if (ok(p.x + sx, p.z)) p.x += sx;
        if (ok(p.x, p.z + sz)) p.z += sz;
      }
    }
    return Math.hypot(p.x - x0, p.z - z0);
  }

  /**
   * The cell bloombot acts on (Interact, Pulse): the first cell a ray from where bloombot really stands, along its
   * facing, enters. Depth decides, not the facing rounded to 8 ways: standing near a cell's edge, the cell right in
   * front of bloombot's face wins over a diagonal one further off. When the ray leaves through (nearly) a corner,
   * within `Walker.CORNER` tiles of travel, it's the diagonal cell.
   */
  front(p: BotPose): { x: number; z: number } {
    const s = Math.sin(p.facing);
    const c = Math.cos(p.facing);
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    // how far along the ray it crosses into the next column (x) and the next row (z)
    const tx = Math.abs(s) < 1e-9 ? Infinity : (s > 0 ? cx + 1 - p.x : p.x - cx) / Math.abs(s);
    const tz = Math.abs(c) < 1e-9 ? Infinity : (c > 0 ? cz + 1 - p.z : p.z - cz) / Math.abs(c);
    const dx = Math.sign(s);
    const dz = Math.sign(c);
    if (Math.abs(tx - tz) <= Walker.CORNER) return { x: cx + dx, z: cz + dz };
    return tx < tz ? { x: cx + dx, z: cz } : { x: cx, z: cz + dz };
  }

  /** Ray crossings this close together (in tiles) count as leaving through the corner: the diagonal cell. */
  static CORNER = 0.12;

  /**
   * Puts bloombot somewhere legal: where it is if that fits, else the nearest walkable cell centre (searching
   * outward ring by ring). Returns false only when nothing within `maxR` is walkable.
   */
  settle(p: BotPose, maxR = 40): boolean {
    if (this.fits(p.roofId, p.x, p.z)) return true;
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    for (let r = 0; r <= maxR; r++) {
      let best: [number, number] | undefined;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.walkable(p.roofId, cx + dx, cz + dz)) continue;
          const d = Math.hypot(cx + dx + 0.5 - p.x, cz + dz + 0.5 - p.z);
          if (d < bestD) {
            bestD = d;
            best = [cx + dx, cz + dz];
          }
        }
      if (best) {
        p.x = best[0] + 0.5;
        p.z = best[1] + 0.5;
        return true;
      }
    }
    return false;
  }

  /**
   * A* over walkable cells from bloombot's cell to the nearest cell that `goal` accepts. Diagonals don't cut
   * corners. Returns cell centres to walk through (excluding the start), [] when already there, or undefined
   * when no path exists within the search budget.
   */
  path(roofId: string, fx: number, fz: number, goal: (x: number, z: number) => boolean, hint: { x: number; z: number }): { x: number; z: number }[] | undefined {
    const sx = Math.floor(fx);
    const sz = Math.floor(fz);
    if (goal(sx, sz)) return [];
    const key = (x: number, z: number) => `${x},${z}`;
    const h = (x: number, z: number) => {
      const ax = Math.abs(x - hint.x);
      const az = Math.abs(z - hint.z);
      return Math.max(ax, az) + (Math.SQRT2 - 1) * Math.min(ax, az);
    };
    const g = new Map<string, number>([[key(sx, sz), 0]]);
    const from = new Map<string, string>();
    const heap = new MinHeap<[number, number, string]>();
    heap.push(h(sx, sz), [sx, sz, key(sx, sz)]);
    const closed = new Set<string>();
    const terraced = this.sim.grid.terraced(roofId);
    let expanded = 0;
    while (heap.size) {
      const [x, z, k] = heap.pop()!;
      if (closed.has(k)) continue;
      closed.add(k);
      if (goal(x, z)) {
        const out: { x: number; z: number }[] = [];
        let c: string | undefined = k;
        while (c && c !== key(sx, sz)) {
          const [px, pz] = c.split(',').map(Number);
          out.push({ x: px + 0.5, z: pz + 0.5 });
          c = from.get(c);
        }
        return out.reverse();
      }
      if (++expanded > BOT.maxSearch) return undefined;
      const gk = g.get(k)!;
      for (const [dx, dz] of STEPS) {
        const nx = x + dx;
        const nz = z + dz;
        if (!this.walkable(roofId, nx, nz)) continue;
        if (dx && dz && (!this.walkable(roofId, x + dx, z) || !this.walkable(roofId, x, z + dz))) continue;
        if (terraced && !(dx && dz ? canStep(x, z, x + dx, z) && canStep(x + dx, z, nx, nz) && canStep(x, z, x, z + dz) && canStep(x, z + dz, nx, nz) : canStep(x, z, nx, nz))) continue;
        const nk = key(nx, nz);
        const ng = gk + (dx && dz ? Math.SQRT2 : 1);
        if (ng >= (g.get(nk) ?? Infinity)) continue;
        g.set(nk, ng);
        from.set(nk, k);
        heap.push(ng + h(nx, nz), [nx, nz, nk]);
      }
    }
    return undefined;
  }
}

/** A small binary min-heap keyed by number. */
class MinHeap<T> {
  private keys: number[] = [];
  private vals: T[] = [];
  get size() {
    return this.keys.length;
  }
  push(k: number, v: T) {
    const ks = this.keys;
    const vs = this.vals;
    let i = ks.length;
    ks.push(k);
    vs.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= k) break;
      ks[i] = ks[p];
      vs[i] = vs[p];
      i = p;
    }
    ks[i] = k;
    vs[i] = v;
  }
  pop(): T | undefined {
    const ks = this.keys;
    const vs = this.vals;
    if (!ks.length) return undefined;
    const top = vs[0];
    const k = ks.pop()!;
    const v = vs.pop()!;
    if (ks.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= ks.length) break;
        const c = l + 1 < ks.length && ks[l + 1] < ks[l] ? l + 1 : l;
        if (ks[c] >= k) break;
        ks[i] = ks[c];
        vs[i] = vs[c];
        i = c;
      }
      ks[i] = k;
      vs[i] = v;
    }
    return top;
  }
}

/** Where a new game puts bloombot: the Landing (E21.26). */
export function spawnPose(sim: Sim, walker: Walker): BotPose {
  // E21.26: a new game starts at the Landing, the jetty on Saltwind Beach below the park's south steps
  void sim;
  const q: BotPose = { roofId: GROUND, x: LANDING.spawn[0], z: LANDING.spawn[1], facing: LANDING.facing };
  walker.settle(q);
  return q;
}
