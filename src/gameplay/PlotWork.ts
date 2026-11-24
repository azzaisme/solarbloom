import { GROUND } from '../core/GameState';
import { plotAt, type PlotSpot } from '../core/Plots';
import type { TileData } from '../core/types';
import { PLOT_OPTION, PLOT_WORK, type PlotWork as Work } from '../data/cozy';
import { GATHER } from '../data/farm';
import { gameDays } from '../data/time';
import type { Sim } from './Sim';

/**
 * E27.2 (#680): Bloombot works the plant plots. Facing a chosen kitchen garden, meadow, crate garden, reed bed or
 * glasshouse, holding Interact gathers from it; facing an orchard, a rose arbour or a parklet, it prunes. Either way an
 * armful of Greens goes into the backpack, the plot is left picked or cut back, and it grows back by itself.
 *
 * It rides on E23.5.1's clipping (GatherSystem): a plot is worked as one, but what it gives is what its own tiles
 * would give clipped one by one (each counted as flowered ground at least, so a new plot always has something), and
 * working it clips all of its tiles, which regrow on the same clock (`salvage.clipped`). So nothing new is saved, a
 * plot can't be worked twice over through its tiles, and the Greens a plot of ground gives in a day are what they
 * were. The plot's tiles leave the tile-by-tile clipping (Bloombot's and the Harvesters'): the plot is the thing
 * there now.
 */
export class PlotWork {
  constructor(private sim: Sim) {}

  private get regrowSecs(): number {
    return gameDays(GATHER.regrowDays);
  }

  /** The work at a chosen plot (undefined: no plot, nothing chosen, a place rather than a plant, or built over). */
  workOf(p: PlotSpot): Work | undefined {
    const id = this.sim.state.cozy?.plots?.[p.id];
    if (!id || !PLOT_OPTION[id]) return undefined;
    const w = PLOT_WORK[id];
    if (!w) return undefined;
    for (const t of this.tiles(p)) if (!t || t.occupantId) return undefined; // a machine stands on it: no plant shows
    return w;
  }

  /** The workable plot covering this tile, if any. */
  spotFor(t: { roofId: string; x: number; z: number } | undefined): PlotSpot | undefined {
    if (!t || t.roofId !== GROUND || !this.sim.state.cozy?.plots) return undefined;
    const p = plotAt(this.sim.grid.seed, t.x, t.z, this.sim.grid.layer(GROUND)?.gen ?? 1);
    return p && this.workOf(p) ? p : undefined;
  }

  /** The plot's ground tiles (never loads a chunk). */
  tiles(p: PlotSpot): (TileData | undefined)[] {
    const out: (TileData | undefined)[] = [];
    for (let j = 0; j < p.size; j++) for (let i = 0; i < p.size; i++) out.push(this.sim.grid.peek(GROUND, p.x + i, p.z + j));
    return out;
  }

  /** Sim time the plot is ready again (undefined: it's ready now). */
  regrowsAt(p: PlotSpot): number | undefined {
    const c = this.sim.state.salvage?.clipped;
    if (!c) return undefined;
    let at = -Infinity;
    for (const t of this.tiles(p)) if (t && c[t.id] !== undefined) at = Math.max(at, c[t.id]);
    return at > this.sim.time ? at : undefined;
  }

  /** How grown back it is: 0 just picked or pruned, 1 ready to work again. */
  growth(p: PlotSpot): number {
    const at = this.regrowsAt(p);
    if (at === undefined) return 1;
    return Math.max(0, Math.min(1, 1 - (at - this.sim.time) / this.regrowSecs));
  }

  /**
   * The Greens one working of the plot gives: each of its tiles as if clipped (E23.5.1's yield, pulse loads and the
   * weather included), counted as flowered ground (GATHER.base) at least.
   */
  yieldOf(p: PlotSpot): number {
    let n = 0;
    for (const t of this.tiles(p)) {
      if (!t || t.ground !== 'restored') continue;
      n += Math.max(GATHER.base, this.sim.gather.yieldOf(t));
    }
    return n;
  }

  /** Why working this plot won't do anything now, in the player's words (undefined: it will). */
  problem(p: PlotSpot): string | undefined {
    const w = this.workOf(p);
    if (!w) return 'Nothing to do here';
    if (this.yieldOf(p) <= 0) return 'Nothing has grown here yet';
    const at = this.regrowsAt(p);
    if (at !== undefined) {
      const mins = Math.max(1, Math.round((at - this.sim.time) / 60));
      const when = mins === 1 ? 'in about a minute' : `in about ${mins} minutes`;
      return w.verb === 'prune' ? `Pruned not long ago. It grows back ${when}.` : `Picked not long ago. It grows back ${when}.`;
    }
    if (this.sim.inventory.room('biomass') <= 0) return "Bloombot can't carry any more Greens. Leave some at the fountain or in a chest";
    return undefined;
  }

  /**
   * Works the plot: Greens into the backpack (as many as fit), and every tile of it clipped until it grows back.
   * Returns the Greens taken (0, with a reason said, when it can't).
   */
  work(p: PlotSpot): number {
    const s = this.sim;
    const why = this.problem(p);
    if (why) {
      s.bus.emit('action.failed', { reason: why });
      return 0;
    }
    const w = this.workOf(p)!;
    // #625 Green thumb (Moss): Bloombot's own gathering gives more
    const want = Math.round(this.yieldOf(p) * s.knacks.gather);
    const got = want - s.inventory.add('biomass', want);
    if (got <= 0) return 0;
    const clipped = (s.state.salvage!.clipped ??= {});
    for (const [id, at] of Object.entries(clipped)) if (at <= s.time) delete clipped[id]; // regrown ones are forgotten
    const until = s.time + this.regrowSecs;
    for (const t of this.tiles(p)) if (t) clipped[t.id] = until;
    const first = this.tiles(p)[0];
    s.bus.emit('plot.worked', { plotId: p.id, verb: w.verb, got, x: p.x + p.size / 2, z: p.z + p.size / 2 });
    s.bus.emit('biomass.gathered', { tileId: first?.id ?? p.id, x: p.x, z: p.z, got, by: 'bot' });
    return got;
  }
}
