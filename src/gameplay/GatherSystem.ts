import { GROUND } from '../core/GameState';
import type { TileData } from '../core/types';
import { GATHER } from '../data/farm';
import { gameDays } from '../data/time';
import type { Sim } from './Sim';

/**
 * E23.5.1 (#386): biomass is gathered, never earned. Restored, open ground that has flowered (bloom 2+) can be
 * clipped: holding Interact facing it puts clippings in the backpack, more for lusher ground. A clipped tile
 * grows back by itself after a quarter of a game day; nothing about the tile changes (its bloom stays). Old-city
 * rules only. Clipped tiles are saved by tile id with the sim time they regrow, and forgotten once regrown.
 */
export class GatherSystem {
  constructor(private sim: Sim) {}

  /**
   * Biomass one gather of this tile gives (0: nothing to clip). E23.2.2: what a loaded pulse grew there gives more
   * (a meadow x1.5, a grove x2: PULSE_LOAD's `biomass`). E23.7.2: windy days shake more loose.
   */
  yieldOf(t: TileData): number {
    if (t.ground !== 'restored' || t.bloom < GATHER.minBloom) return 0;
    const bonus = (this.sim as unknown as { weather?: { effects?(): { gatherBonus?: number } } }).weather?.effects?.().gatherBonus ?? 1;
    const plain = GATHER.base + (t.bloom - GATHER.minBloom) * GATHER.perBloom;
    return Math.round(plain * this.sim.restoration.plantDef(t).biomass * bonus);
  }

  /** Sim time a clipped tile can be gathered again (undefined: it isn't clipped). */
  regrowsAt(t: TileData): number | undefined {
    const at = this.sim.state.salvage?.clipped?.[t.id];
    return at !== undefined && at > this.sim.time ? at : undefined;
  }

  /** Is there anything to gather on this tile (restored, flowered, open, not clipped)? */
  canGather(t: TileData | undefined): t is TileData {
    if (!t || t.roofId !== GROUND) return false;
    if (t.blocked || t.occupantId) return false;
    // E27.2 (#680): a plant plot is worked as one (PlotWork), not clipped a tile at a time
    if (this.sim.plotWork?.spotFor(t)) return false;
    return this.yieldOf(t) > 0 && this.regrowsAt(t) === undefined;
  }

  /** Why gathering here won't work right now (undefined: it will). */
  problem(t: TileData): string | undefined {
    if (!this.canGather(t)) return 'Nothing to gather here';
    if (this.sim.inventory.room('biomass') <= 0) return "Bloombot can't carry any more Greens. Leave some at the fountain or in a chest";
    return undefined;
  }

  /** Clips a tile: biomass into the backpack (as much as fits), and the tile regrows later. Returns units taken. */
  gather(t: TileData): number {
    const why = this.problem(t);
    if (why) {
      this.sim.bus.emit('action.failed', { reason: why });
      return 0;
    }
    return this.clip(t, 'pack');
  }

  /**
   * Clips a gatherable tile into the backpack (as much as fits) or, for a Harvester drone (E23.1.4), into the
   * city's store. The tile regrows later. Returns units taken (0: nothing to clip, or no room in the backpack).
   */
  clip(t: TileData, into: 'pack' | 'store'): number {
    const s = this.sim;
    if (!this.canGather(t)) return 0;
    // #625 Green thumb (Moss): Bloombot's own gathering gives more (not a Harvester's)
    const want = into === 'pack' ? Math.round(this.yieldOf(t) * s.knacks.gather) : this.yieldOf(t);
    const got = into === 'store' ? (s.inventory.addToStore('biomass', want), want) : want - s.inventory.add('biomass', want);
    if (got <= 0) return 0;
    const sv = s.state.salvage!;
    const clipped = (sv.clipped ??= {});
    // forget tiles that have regrown, so the save stays small
    for (const [id, at] of Object.entries(clipped)) if (at <= s.time) delete clipped[id];
    clipped[t.id] = s.time + gameDays(GATHER.regrowDays);
    s.bus.emit('biomass.gathered', { tileId: t.id, x: t.x, z: t.z, got, by: into === 'store' ? 'drone' : 'bot' });
    return got;
  }
}
