import { GROUND } from '../core/GameState';
import { CHUNK } from '../core/Hash';
import { rampAt } from '../core/Height';
import { setPieceAt } from '../core/OldCityLayout';
import { plotAt } from '../core/Plots';
import type { GameState, TileData } from '../core/types';
import { PARK_SET } from '../data/oldcity';
import type { Sim } from './Sim';

/** Occupant id stamped on the workbench's square (solid, as a decoration's; never a machine). */
export const BENCH_OCCUPANT = 'workbench';
export const isBenchOccupant = (id: string | undefined): boolean => id === BENCH_OCCUPANT;

/** The four squares beside a square, east first (the side the bench faces by default), then south, west, north. */
export const SIDES: readonly [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Stamps the workbench's square occupied as its chunk loads (Sim's chunk hook, after machines, before giants). */
export function stampBench(state: Pick<GameState, 'salvage'>, tiles: readonly (TileData | undefined)[]) {
  const at = state.salvage?.bench;
  if (!at) return;
  for (const t of tiles) if (t && t.roofId === GROUND && t.x === at.x && t.z === at.z && !t.occupantId) t.occupantId = BENCH_OCCUPANT;
}

/**
 * #783: the workbench. Crafting moved out of the house onto a wooden table with tools of its own, outside against the
 * house's wall, from the very start of a new garden. Bloombot walks up to it and presses Interact to open crafting
 * (the game's prompt); the house is left a home (its radio and its bed).
 *
 * It stands on one ground square, saved in `salvage.bench`. A new game puts it at `PARK_SET.bench`. A save from
 * before it existed gets it on its first load: the same square when that is free, else the free square beside the
 * house nearest it (one square out from the walls, then two), so nothing the player built moves. The square is
 * stamped occupied (like a world giant's trunk): Bloombot walks round it and nothing can be built on it.
 */
export class CraftBench {
  constructor(private sim: Sim) {}

  /** Where it stands (undefined only outside the Old City, which has no house). */
  get at(): { x: number; z: number } | undefined {
    return this.sim.state.salvage?.bench;
  }

  /** Is this ground square the workbench? */
  isAt(roofId: string, x: number, z: number): boolean {
    const b = this.at;
    return !!b && roofId === GROUND && b.x === x && b.z === z;
  }

  /** The way its front faces (dx, dz): toward the first open square, east by preference (the model's drawer side). */
  facing(): [number, number] {
    const b = this.at;
    if (!b) return [1, 0];
    return SIDES.find(([dx, dz]) => this.open(b.x + dx, b.z + dz)) ?? [1, 0];
  }

  /** The square in front of it, where Bloombot stands to use it (for "Show me where"). */
  front(): { x: number; z: number } | undefined {
    const b = this.at;
    if (!b) return undefined;
    const [dx, dz] = this.facing();
    return { x: b.x + dx, z: b.z + dz };
  }

  /**
   * Puts the workbench in the world if this game doesn't have it yet (a new game, or an older save's first load), and
   * stamps its square. Returns where it stands.
   */
  ensure(): { x: number; z: number } | undefined {
    const sv = this.sim.state.salvage;
    if (!sv) return undefined;
    if (!sv.bench) {
      const spot = this.findSpot();
      if (!spot) return undefined;
      sv.bench = spot;
    }
    // its chunk's hook stamps it when that loads; one already loaded (the search above loads the park) is stamped
    // here. A saved bench never loads its chunk early: saved chunks load lazily.
    const t = this.sim.grid.peek(GROUND, sv.bench.x, sv.bench.z);
    if (t && !t.occupantId) t.occupantId = BENCH_OCCUPANT;
    return sv.bench;
  }

  /**
   * A free square beside the house for it: `PARK_SET.bench` if free, else the nearest free square (to that spot)
   * one square out from the house's walls, then two. Never the house's door square, nor the one in front of it.
   */
  findSpot(): { x: number; z: number } | undefined {
    const want = PARK_SET.bench;
    if (this.free(want.x, want.z)) return { ...want };
    const sh = PARK_SET.shed;
    for (let r = 1; r <= 2; r++) {
      const ring: { x: number; z: number; d: number }[] = [];
      for (let z = sh.z - r; z < sh.z + sh.size + r; z++)
        for (let x = sh.x - r; x < sh.x + sh.size + r; x++) {
          const inner = x >= sh.x - r + 1 && x < sh.x + sh.size + r - 1 && z >= sh.z - r + 1 && z < sh.z + sh.size + r - 1;
          if (inner) continue; // only this ring
          ring.push({ x, z, d: Math.hypot(x - want.x, z - want.z) });
        }
      ring.sort((a, b) => a.d - b.d || a.z - b.z || a.x - b.x);
      const hit = ring.find((c) => this.free(c.x, c.z));
      if (hit) return { x: hit.x, z: hit.z };
    }
    return undefined;
  }

  /**
   * Is this square free for the workbench? Plain open ground on the park's terrace: nothing built or placed on it, no
   * set piece, pipe, plot, water or steps, not the house's door or the square before it, and with an open square
   * beside it for Bloombot to stand on.
   */
  free(x: number, z: number): boolean {
    if (!this.open(x, z)) return false;
    const [dx, dz] = PARK_SET.shed.door;
    if ((x === dx && z === dz) || (x === dx && z === dz + 1)) return false;
    if (plotAt(this.sim.grid.seed, x, z, this.sim.grid.layer(GROUND)?.gen ?? 1)) return false;
    if (this.sim.water?.pipes.has(x, z)) return false;
    return SIDES.some(([a, c]) => this.open(x + a, z + c) && !this.isAt(GROUND, x + a, z + c));
  }

  /** Open ground: in the park's chunk, unblocked, unoccupied, dry, flat and on the house's terrace. */
  private open(x: number, z: number): boolean {
    if (Math.floor(x / CHUNK) !== 0 || Math.floor(z / CHUNK) !== 0) return false;
    const t = this.sim.grid.get(GROUND, x, z);
    if (!t || t.blocked || t.prop || t.feature === 'water' || t.feature === 'building' || t.ramp) return false;
    if (t.occupantId && !isBenchOccupant(t.occupantId)) return false;
    if (setPieceAt(x, z) || rampAt(x, z)) return false;
    return (t.level ?? PARK_SET.level) === PARK_SET.level;
  }
}
