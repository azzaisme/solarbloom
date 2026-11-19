import { distToFootprint } from '../core/Grid';
import type { DroneRole, MachineData, TileData } from '../core/types';
import { DRONE_HUB, DRONE_SUPPLY, type DroneSupply } from '../data/drones';
import type { Sim } from './Sim';

/** What drones run short of. */
export type Shortage = 'power' | 'water' | 'biomass';

/**
 * E23.6.3 (#392): what drones run on. Each role draws from its hub (data/drones DRONE_SUPPLY):
 * - grid power (`sim.power`, E23.3): a hub is a helper on the grid, drawing each of its drones' role power while it
 *   stands (`draw`, which the grid reads), so a short grid sheds the hub as a whole and it stays off until power is back;
 * - water per job, from the nearest pond, canal or reservoir within `DRONE_HUB.waterReach` of the hub (`sim.water`,
 *   E23.4), which goes down as it is drawn;
 * - Biomass per job, from the store (E23.5's item) through a Storage chest beside the hub.
 * A hub short of something its role needs lets its drones finish the job in hand, then dock and wait; they start
 * again by themselves once it is back. Roles that don't need what ran short carry on. The old park drone runs on
 * sunlight and needs nothing.
 */
export class DroneFuel {
  constructor(private sim: Sim) {}

  /** What a role draws now: its data, less Lighter drones (research, E23.6.2), never below one unit a job. */
  supply(role: DroneRole | 'cultivator'): DroneSupply {
    const base = DRONE_SUPPLY[role];
    const k = 1 - Math.min(0.9, this.sim.research.effect('droneThrift'));
    if (k >= 1) return base;
    const less = (n: number | undefined) => (n ? Math.max(1, Math.round(n * k)) : n);
    return { power: base.power * k, water: less(base.water), biomass: less(base.biomass) };
  }

  /** What a role needs from its hub. */
  needs(role: DroneRole | 'cultivator'): Shortage[] {
    const s = this.supply(role);
    return ['power' as const, ...(s.water ? ['water' as const] : []), ...(s.biomass ? ['biomass' as const] : [])];
  }

  /** The ground tile at a hub's middle (where its water and chest are looked for). */
  private hubTile(hub: MachineData): TileData | undefined {
    return this.sim.grid.get(hub.roofId, Math.floor(hub.x + hub.size / 2), Math.floor(hub.z + hub.size / 2));
  }

  /** The water a hub draws from: the nearest body within reach holding more than a trickle, if any. */
  waterBeside(hub: MachineData, units: number): string | undefined {
    const t = this.hubTile(hub);
    const b = t && this.sim.water.bodyNear(t, DRONE_HUB.waterReach);
    return b && this.sim.water.amountOf(b.id) >= units ? b.id : undefined;
  }

  /** A Storage chest within reach of a hub (its way into the store), if any. */
  chestBeside(hub: MachineData): MachineData | undefined {
    const cx = Math.floor(hub.x + hub.size / 2);
    const cz = Math.floor(hub.z + hub.size / 2);
    return this.sim.machinesOfType('chest').find((c) => c.roofId === hub.roofId && distToFootprint(cx, cz, c.x, c.z, c.size) <= DRONE_HUB.chestReach + hub.size / 2);
  }

  /** What a hub is short of for a role's next job, if anything (the first thing missing). */
  short(hub: MachineData, role: DroneRole | 'cultivator'): Shortage | undefined {
    const s = this.supply(role);
    if (!this.sim.power.isPowered(hub)) return 'power';
    if (s.water && !this.waterBeside(hub, s.water)) return 'water';
    if (s.biomass && (!this.chestBeside(hub) || this.sim.inventory.stored('biomass') < s.biomass)) return 'biomass';
    return undefined;
  }

  /**
   * Takes one job's water and Biomass from a hub's supply. False (and nothing taken) when it is short: the drone
   * docks and waits instead.
   */
  take(hub: MachineData, role: DroneRole | 'cultivator'): boolean {
    if (this.short(hub, role)) return false;
    const s = this.supply(role);
    if (s.biomass && !this.sim.inventory.takeFromStore('biomass', s.biomass)) return false;
    if (s.water) this.sim.water.draw(this.waterBeside(hub, s.water)!, s.water);
    return true;
  }

  /**
   * Power a hub draws (W): each of its drones' role power while it stands, or each tiller's for a Cultivator dock.
   * The grid reads this (PowerGrid registers hubs and docks as helpers).
   */
  draw(hub: MachineData): number {
    if (hub.type === 'cultivator') return (hub.cult?.units.length ?? 0) * this.supply('cultivator').power;
    let w = 0;
    for (const d of this.sim.state.drones) if (d.hubId === hub.id && !d.old) w += this.supply(d.role ?? this.sim.roles.roleOf(hub)).power;
    return w;
  }
}
