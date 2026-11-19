import { GROUND } from '../core/GameState';
import { brokenCells, isMainlandCell, landingArea, onCauseway } from '../core/Mainland';
import { MAINLAND, MAINLAND_MACHINES } from '../data/mainland';
import type { Sim } from './Sim';

/**
 * E23.8.3.2: the grid (E23.3, `sim.power`, PR #480) as far as the mainland's machines need it. Optional: a machine it
 * doesn't know simply stands there (cozy). The Long-range Pump joins the water network in its own PR, after E23.4 (#514).
 */
export interface PowerHook {
  register(type: string, spec: { battery?: { capacity: number; rate: number } }): void;
}

/**
 * E23.8.3.1 (#451): the mainland. The Long Causeway's broken middle rises with the Great Bloom (fountain tier 5) and
 * the district it lands in comes out of the cloud; after that the mainland opens by restoring, one district revealing
 * the next, for ever. No gates, no prices and nothing idle: the same tools and rules as the island.
 * Saved through what it changes: the raised cells are entry fixes (`unblocked`), the landing is an area state.
 */
export class MainlandSystem {
  constructor(private sim: Sim) {
    sim.bus.on('fountain.tier', ({ tier }) => {
      if (tier >= MAINLAND.opensAtTier) this.open();
    });
  }

  /** The grid hooks the mainland's machines joined (for tests and the PR's checklist). */
  wired = { power: false };

  /**
   * E23.8.3.2: joins the mainland's machines to the grid, once the Sim has built it (called at the end of the Sim's
   * constructor). The Grid Battery is storage.
   */
  wire(): void {
    const sim = this.sim as unknown as { power?: PowerHook };
    const B = MAINLAND_MACHINES.gridBattery;
    if (sim.power?.register) {
      sim.power.register('gridBattery', { battery: { capacity: B.capacity, rate: B.rate } });
      this.wired.power = true;
    }
  }

  /** Has the Great Bloom raised the causeway? */
  get opened(): boolean {
    return (this.sim.state.salvage?.tier ?? 0) >= MAINLAND.opensAtTier;
  }

  /** Is a cell on the mainland or the causeway (for the map, the camera and anything that asks)? */
  isMainland(x: number, z: number): boolean {
    return isMainlandCell(x) || onCauseway(x, z);
  }

  /** Raises the causeway and reveals the landing district. Safe to call again. */
  open(): void {
    const s = this.sim;
    for (const [x, z] of brokenCells()) {
      const t = s.grid.get(GROUND, x, z);
      if (!t || !t.blocked) continue;
      t.blocked = false;
      t.unblocked = true;
      s.transitions.unblock(t);
      s.grid.touch(t);
    }
    s.areas.reveal(landingArea());
  }
}
