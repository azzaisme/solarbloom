import { GROUND } from '../core/GameState';
import { hashString, tileRandom } from '../core/Hash';
import type { MaterialId } from '../core/types';
import { BURIED } from '../data/pulse';
import { CAT_ANCHORS } from '../data/templates';
import type { Sim } from './Sim';

export interface BuriedFind {
  id: string;
  x: number;
  z: number;
  material: MaterialId;
  n: number;
}

const SALT = hashString('buried-finds');
/** Tiles a Lucky Cat's hand-placed nook uses: never a buried find (nothing near a cat ever lights up). */
const CAT_CELLS = new Set(CAT_ANCHORS.flatMap((a) => [`${Math.floor(a.pos[0])},${Math.floor(a.pos[2])}`, ...(a.needsFreeTile ? [`${a.needsFreeTile[0]},${a.needsFreeTile[1]}`] : [])]));
const OPEN = new Set(['lawn', 'clay', 'litter', 'sand', 'paving', 'road']);

/**
 * E23.2.2.3 (#413): seeds and salvage buried across the Old City's open ground. Where they lie is a pure
 * function of the seed and the tile (deterministic, nothing to save); what has been found (`known`: a mound
 * shows) and dug up is saved. Old-city rules only.
 */
export class BuriedSystem {
  constructor(private sim: Sim) {}

  private get st(): { known: string[]; dug: string[] } {
    return (this.sim.state.buried ??= { known: [], dug: [] });
  }

  /** The find buried at a ground tile, if any and not dug up yet. */
  at(x: number, z: number): BuriedFind | undefined {
    if (tileRandom(this.sim.state.seed, SALT, x, z) >= 1 / BURIED.oneIn) return undefined;
    if (CAT_CELLS.has(`${x},${z}`)) return undefined;
    const t = this.sim.grid.get(GROUND, x, z);
    if (!t || t.blocked || !OPEN.has(t.feature ?? 'lawn')) return undefined;
    // open ground only: never beside an obstacle (that is where a city cat's nook would be)
    if (this.sim.grid.neighbors(t).some((n) => n.blocked && n.prop)) return undefined;
    const id = `bur:${x}:${z}`;
    if (this.sim.state.buried?.dug.includes(id)) return undefined;
    const total = BURIED.finds.reduce((a, f) => a + f.weight, 0);
    let pick = tileRandom(this.sim.state.seed, SALT, x, z, 1) * total;
    const f = BURIED.finds.find((q) => (pick -= q.weight) < 0) ?? BURIED.finds[0];
    return { id, x, z, material: f.material, n: f.n };
  }

  /** Every find within `radius` tiles (Euclidean) of a cell, nearest first. */
  near(x: number, z: number, radius: number): BuriedFind[] {
    const out: BuriedFind[] = [];
    const R = Math.ceil(radius);
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const f = this.at(x + dx, z + dz);
        if (f) out.push(f);
      }
    return out.sort((a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - ((b.x - x) ** 2 + (b.z - z) ** 2) || a.id.localeCompare(b.id));
  }

  /** Marks finds as found: a mound shows on each from now until it is dug up. */
  reveal(finds: Pick<BuriedFind, 'id' | 'x' | 'z'>[]) {
    for (const f of finds) {
      if (this.st.known.includes(f.id)) continue;
      this.st.known.push(f.id);
      const t = this.sim.grid.get(GROUND, f.x, f.z);
      if (t) this.sim.grid.touch(t);
    }
  }

  /** The find at a tile if it has been revealed (a mound shows there). */
  known(x: number, z: number): BuriedFind | undefined {
    if (!this.sim.state.buried?.known.length) return undefined;
    const f = this.at(x, z);
    return f && this.sim.state.buried.known.includes(f.id) ? f : undefined;
  }

  /** Digs up a revealed find into the backpack. Units that came up (0: nothing known there, or no room). */
  dig(x: number, z: number): number {
    const f = this.known(x, z);
    if (!f) return 0;
    const got = f.n - this.sim.inventory.add(f.material, f.n);
    if (got <= 0) return 0;
    this.st.dug.push(f.id);
    this.st.known = this.st.known.filter((k) => k !== f.id);
    const t = this.sim.grid.get(GROUND, f.x, f.z);
    if (t) this.sim.grid.touch(t);
    this.sim.bus.emit('buried.dug', { id: f.id, material: f.material, n: got, x: f.x, z: f.z });
    return got;
  }
}
