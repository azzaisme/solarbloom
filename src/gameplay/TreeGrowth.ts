import { GROUND } from '../core/GameState';
import { decorKey } from '../core/Decor';
import { chunkKey } from '../core/Grid';
import { CHUNK } from '../core/Hash';
import type { TileData } from '../core/types';
import { giantCells, giantGrowth, giantNear, grownAge, treeSpot, treeStage, treeWorldOf, type GiantSpot } from '../rendering/TreePlacement';
import { gameSecondsOf } from './Clock';
import type { Sim } from './Sim';

/** Occupant id stamped on a world giant's trunk cells (solid, as a decoration's tile; never a machine). */
export const GIANT_PREFIX = 'giant:';
export const giantOccupant = (g: Pick<GiantSpot, 'gx' | 'gz'>) => `${GIANT_PREFIX}${g.gx},${g.gz}`;
export const isGiantOccupant = (id: string | undefined): id is string => !!id && id.startsWith(GIANT_PREFIX);

/**
 * Does this world giant stand? Not where a machine or decoration (built in a save from before giants grew) already
 * stands on one of its trunk cells: what the player built stays, and that giant never grows.
 */
export function giantStands(sim: Pick<Sim, 'grid'>, g: Pick<GiantSpot, 'gx' | 'gz'>): boolean {
  for (const [x, z] of giantCells(g)) {
    const key = chunkKey(GROUND, Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    if (sim.grid.machinesInChunk(key).some((m) => m.roofId === GROUND && x >= m.x && x < m.x + m.size && z >= m.z && z < m.z + m.size)) return false;
    if (sim.grid.decorInChunk(key).includes(decorKey(GROUND, x, z))) return false;
  }
  return true;
}

/** Stamps a loaded ground chunk's world-giant trunk cells occupied (Sim's chunk hook; machines are stamped first). */
export function stampGiants(sim: Pick<Sim, 'state' | 'grid'>, tiles: (TileData | undefined)[]) {
  const w = treeWorldOf(sim);
  for (const t of tiles) {
    if (!t || t.roofId !== GROUND || t.occupantId) continue;
    const g = giantNear(w, t.x, t.z);
    if (g && giantStands(sim, g)) t.occupantId = giantOccupant(g);
  }
}

/**
 * Trees grow over game days (owner, 26 Nov 2026). `sim.trees`:
 *  - planting: when a tile with a tree is restored, it remembers when (`treeAt`, game seconds); the tree shows a
 *    sapling and grows a stage at a time as it ages (TreePlacement TREE_GROWTH), as far as the tile's bloom allows;
 *  - every so often it looks over the loaded ground for trees that grew a stage since its last look, touches their
 *    tile (so counts and wildlife recount) and says so (`tree.grew`, the renderer grows it in on screen); a tree
 *    fully grown forgets its planting time (it shows its bloom from then on, as trees from older saves do);
 *  - world giants: their trunk cells are stamped occupied when their chunk loads (solid for every walker), and
 *    grow from their own trunk cells' ground (`giant(g)`).
 */
export class TreeGrowth {
  /** game seconds of the last look */
  private last?: number;
  private nextLook = 0;
  /** seconds (sim) between looks: stages are days apart, so a look every half minute is plenty */
  static readonly LOOK = 30;

  constructor(private sim: Sim) {}

  private get now(): number {
    return gameSecondsOf(this.sim.state);
  }

  /** Is there a tree (an ordinary one or a world giant's trunk) on this ground tile? */
  hasTree(t: TileData): 'tree' | 'giant' | undefined {
    if (t.roofId !== GROUND || t.feature === 'water') return undefined;
    const w = treeWorldOf(this.sim);
    if (isGiantOccupant(t.occupantId)) return 'giant';
    if (t.occupantId) return undefined;
    const area = this.sim.areas.areaOf(t);
    if (!area) return undefined;
    if (giantNear(w, t.x, t.z)) return 'giant';
    return treeSpot(t, this.sim.areas.info(area).type, w) ? 'tree' : undefined;
  }

  /** A tile was just restored: its tree (if it has one) starts growing now. */
  planted(t: TileData) {
    if (t.ground !== 'restored' || !this.hasTree(t)) return;
    t.treeAt = this.now;
    this.sim.grid.touch(t);
  }

  /** A tile's ground died: its tree is gone, and a new one grows from scratch when it is restored again. */
  lost(t: TileData) {
    t.treeAt = undefined;
  }

  /** How far a world giant has grown (0: bare, before its ground is restored), and when it next grows. */
  giant(g: GiantSpot): { stage: 0 | 1 | 2 | 3 | 4; next?: number } {
    return giantGrowth(giantCells(g).map(([x, z]) => this.sim.grid.peek(GROUND, x, z)), this.now);
  }

  /** The stage the tree on this tile shows now (undefined: no tree shown), with low water's fading. */
  stage(t: TileData): ReturnType<typeof treeStage> {
    return treeStage(t, this.sim.water.bloomShown(t), this.now);
  }

  tick() {
    const s = this.sim;
    if (s.time < this.nextLook) return;
    this.nextLook = s.time + TreeGrowth.LOOK;
    const now = this.now;
    const then = this.last ?? now;
    this.last = now;
    if (then === now) return;
    const grown = grownAge(false), giantGrown = grownAge(true);
    for (const l of s.grid.playableLayers())
      for (const c of s.grid.loadedChunks(l.id))
        for (const t of c.tiles) {
          if (!t || t.treeAt === undefined) continue;
          if (t.ground !== 'restored') {
            t.treeAt = undefined;
            continue;
          }
          const giant = isGiantOccupant(t.occupantId);
          const bloom = giant ? t.bloom : s.water.bloomShown(t);
          const from = treeStage(t, bloom, then, giant);
          const to = treeStage(t, bloom, now, giant);
          if (now - t.treeAt >= (giant ? giantGrown : grown)) t.treeAt = undefined;
          if (from !== to) {
            s.grid.touch(t);
            s.bus.emit('tree.grew', { tile: t, from: from ?? 0, to: to ?? 0 });
          } else if (t.treeAt === undefined) s.grid.touch(t);
        }
  }
}
