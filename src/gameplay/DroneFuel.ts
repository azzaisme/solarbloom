import { GROUND } from '../core/GameState';
import { distToFootprint } from '../core/Grid';
import type { DroneRole, MachineData, TileData } from '../core/types';
import { DRONE_HUB, DRONE_SUPPLY, type DroneSupply } from '../data/drones';
import type { Sim } from './Sim';

/** What drones run short of. */
export type Shortage = 'power' | 'water' | 'biomass';

/**
 * E23.6.3 (#392): what drones run on. Each role draws from its hub (data/drones DRONE_SUPPLY):
 * - grid power (`sim.power`, E23.3): a hub is a helper on the grid, drawing its role's power for each drone out
 *   working (`draw`, which the grid reads; a hub whose drones nap or wait draws nothing). A drone sets out only when
 *   the grid has room for its draw at the hub (`headroom`), so a short grid keeps it home instead of shedding the hub
 *   mid-job, over and over;
 * - water per job, from the fullest pond, canal or reservoir within `DRONE_HUB.waterReach` of the hub that still
 *   holds a job's worth (`sim.water`, E23.4), which goes down as it is drawn; with none, through a pipe carrying
 *   water beside the hub (E23.4.2: its pump's pond or its reservoir);
 * - Biomass per job, from the store (E23.5's item) through a Storage chest beside the hub.
 * Lighter drones (research) cuts every role's draw by its share. Water is drawn in fractions; Biomass is whole
 * items, so each hub keeps the part of an item it has paid ahead (`m.fuelCredit`) and pays a whole one only when
 * that runs out: at 0.7 a job, ten jobs take seven.
 * A hub short of something its role needs lets its drones finish the job in hand, then dock and wait; they start
 * again by themselves once it is back. Roles that don't need what ran short carry on. The old park drone runs on
 * sunlight and needs nothing.
 */
export class DroneFuel {
  constructor(private sim: Sim) {}

  /** What a role draws now: its data, less Lighter drones (research, E23.6.2): fractions, paid as above. */
  supply(role: DroneRole | 'cultivator'): DroneSupply {
    const base = DRONE_SUPPLY[role];
    const k = 1 - Math.min(0.9, this.sim.research.effect('droneThrift'));
    if (k >= 1) return base;
    return { power: base.power * k, water: base.water && base.water * k, biomass: base.biomass && base.biomass * k };
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

  /**
   * The water a hub draws from: of the bodies within reach of its middle, the fullest that still holds `units`
   * (a dry pond a tile closer never hides a full canal further off).
   */
  waterBeside(hub: MachineData, units: number): string | undefined {
    const t = this.hubTile(hub);
    if (!t) return undefined;
    const R = DRONE_HUB.waterReach;
    const w = this.sim.water;
    let best: string | undefined;
    let most = units - 1e-9;
    const seen = new Set<string>();
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const b = w.bodyAt(this.sim.grid.get(t.roofId, t.x + dx, t.z + dz));
        if (!b || seen.has(b.id)) continue;
        seen.add(b.id);
        const n = w.amountOf(b.id);
        if (n >= most) {
          most = n;
          best = b.id;
        }
      }
    return best;
  }

  /** A footprint tile of a hub with a pipe carrying a job's worth of water beside it (E23.4.2), if any. */
  pipeBeside(hub: MachineData, units: number): TileData | undefined {
    if (hub.roofId !== GROUND) return undefined;
    const pipes = this.sim.water.pipes;
    for (let dz = 0; dz < hub.size; dz++)
      for (let dx = 0; dx < hub.size; dx++) {
        const t = this.sim.grid.get(hub.roofId, hub.x + dx, hub.z + dz);
        if (t && pipes.feeds(t) && pipes.availableAt(t) + 1e-9 >= units) return t;
      }
    return undefined;
  }

  /** A Storage chest within reach of a hub (its way into the store), if any. */
  chestBeside(hub: MachineData): MachineData | undefined {
    const cx = Math.floor(hub.x + hub.size / 2);
    const cz = Math.floor(hub.z + hub.size / 2);
    return this.sim.machinesOfType('chest').find((c) => c.roofId === hub.roofId && distToFootprint(cx, cz, c.x, c.z, c.size) <= DRONE_HUB.chestReach + hub.size / 2);
  }

  /** Whole Biomass items a hub pays for its next job (none while it has paid that far ahead). */
  biomassDue(hub: MachineData, role: DroneRole | 'cultivator'): number {
    const c = this.supply(role).biomass ?? 0;
    if (!c) return 0;
    return Math.max(0, Math.ceil(c - (hub.fuelCredit ?? 0) - 1e-9));
  }

  /** What a hub is short of for a role's next job, if anything (the first thing missing). */
  short(hub: MachineData, role: DroneRole | 'cultivator'): Shortage | undefined {
    const s = this.supply(role);
    const p = this.sim.power;
    // off the grid, shed, or no room on its line for one more drone at work (after every drone already out, on every
    // hub on the line, and every launch booked since the grid last solved)
    if (!p.isPowered(hub) || p.headroom(hub) + 1e-9 < s.power) return 'power';
    if (s.water && !this.waterBeside(hub, s.water) && !this.pipeBeside(hub, s.water)) return 'water';
    if (s.biomass && (!this.chestBeside(hub) || this.sim.inventory.stored('biomass') < this.biomassDue(hub, role))) return 'biomass';
    return undefined;
  }

  /**
   * Takes one job's water and Biomass from a hub's supply. False (and nothing taken) when it is short: the drone
   * docks and waits instead.
   */
  take(hub: MachineData, role: DroneRole | 'cultivator'): boolean {
    if (this.short(hub, role)) return false;
    const s = this.supply(role);
    // water first: a pipe may give less than it looked to hold, and then the job doesn't go and it all goes back
    if (s.water) {
      const body = this.waterBeside(hub, s.water);
      if (body) this.sim.water.draw(body, s.water);
      else {
        const taken: [string, number][] = [];
        const got = this.sim.water.pipes.drawAt(this.pipeBeside(hub, s.water)!, s.water, taken);
        if (got + 1e-9 < s.water) {
          for (const [id, n] of taken) this.sim.water.fill(id, n);
          if (taken.length) this.sim.water.pipes.refreshFed(); // a reservoir it emptied holds water again
          return false;
        }
      }
    }
    if (s.biomass) {
      const due = this.biomassDue(hub, role);
      if (!this.sim.inventory.takeFromStore('biomass', due)) return false;
      const credit = (hub.fuelCredit ?? 0) + due - s.biomass;
      hub.fuelCredit = credit > 1e-9 ? credit : undefined;
    }
    // the drone at work draws its power from now: booked on the line at once, so no other launch counts on it
    this.sim.power.reserve(hub, s.power);
    return true;
  }

  /** Is a drone out working (flying to a job, at it, or on its way home), so drawing its hub's power? */
  private working(d: { mode: string; homing?: boolean }): boolean {
    if (d.mode === 'returning' && d.homing) return false; // sent home short: no load on the way back
    return d.mode !== 'idle' && d.mode !== 'cooldown';
  }

  /**
   * Power a hub draws (W): its role's power for each drone out working, or each tiller at work for a Cultivator dock.
   * The grid reads this (PowerGrid registers hubs and docks as helpers).
   */
  draw(hub: MachineData): number {
    if (hub.type === 'cultivator') return (hub.cult?.units ?? []).filter((u) => u.work.length && !u.parked).length * this.supply('cultivator').power;
    let w = 0;
    for (const d of this.sim.state.drones) if (d.hubId === hub.id && !d.old && this.working(d)) w += this.supply(d.role ?? this.sim.roles.roleOf(hub)).power;
    return w;
  }
}
