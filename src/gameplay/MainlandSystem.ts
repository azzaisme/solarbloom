import { GROUND } from '../core/GameState';
import { brokenCells, isMainlandCell, landingArea, onCauseway } from '../core/Mainland';
import { MAINLAND, MAINLAND_MACHINES } from '../data/mainland';
import type { Sim } from './Sim';

/**
 * E23.8.3.2: the grid (E23.3, `sim.power`, PR #480) and water network (E23.4, `sim.water`) as far as the mainland's
 * machines need them. Both are optional until those land: a machine they don't know simply stands there (cozy).
 */
export interface PowerHook {
  register(type: string, spec: { battery?: { capacity: number; rate: number }; consumer?: { shed: string; draw: number } }): void;
}
export interface WaterHook {
  /**
   * E23.4.2 (e23-water, PR #514): a pump of this machine type. `reach` is pipe steps it can feed, `flow` units per
   * game day, `power` its grid draw (registered as a consumer, shed 'pump'), `size` its footprint (for the bank check); `sea`
   * (stand on the sea's bank too) is a request #514 does not take yet, harmless to it, and the mainland has fresh water anyway.
   */
  registerPump?(type: string, spec: { reach: number; flow: number; power?: number; size?: number; sea?: boolean }): void;
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

  /** The grid and water hooks the mainland's machines joined (for tests and the PR's checklist). */
  wired = { power: false, water: false };

  /**
   * E23.8.3.2: joins the mainland's machines to the grid and the water network, once the Sim has built them
   * (called at the end of the Sim's constructor). The Grid Battery is storage; the Long-range Pump is a consumer that
   * sheds with the pumps, and a pump with a long reach.
   */
  wire(): void {
    const sim = this.sim as unknown as { power?: PowerHook; water?: WaterHook };
    const B = MAINLAND_MACHINES.gridBattery;
    const P = MAINLAND_MACHINES.longPump;
    if (sim.power?.register) {
      sim.power.register('gridBattery', { battery: { capacity: B.capacity, rate: B.rate } });
      sim.power.register('longPump', { consumer: { shed: 'pump', draw: P.draw } });
      this.wired.power = true;
    }
    if (sim.water?.registerPump) {
      sim.water.registerPump('longPump', { reach: P.reach, flow: P.flow, power: P.draw, size: 2, sea: P.sea });
      this.wired.water = true;
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
