import { distToFootprint } from '../core/Grid';
import type { DroneRole, ItemId, MachineData, TileData } from '../core/types';
import { DRONE_HUB, DRONE_SUPPLY, type DroneSupply } from '../data/drones';
import { ITEM_DEFS } from '../data/items';
import type { Sim } from './Sim';

/** What drones run short of. */
export type Shortage = 'power' | 'water' | 'biomass';

/** E23.3's grid, as far as drones need it (optional until it lands). */
interface PowerLike {
  isPowered(m: MachineData): boolean;
  register?(type: string, spec: { consumer: { shed: string; draw: number | ((m: MachineData) => number) } }): void;
}
/** E23.4's water, as far as drones need it (optional until it lands). */
interface WaterLike {
  isWatered(t: TileData): boolean;
  drawNear(t: TileData, units: number): number;
}

/**
 * E23.6.3 (#392): what drones run on. Each role draws from its hub (data/drones DRONE_SUPPLY): grid power while it
 * works, and per job water from water beside the hub (a pipe, a canal, a pond) or biomass from a Storage chest beside
 * it. A hub short of something its role needs lets its drones finish the job in hand, then dock and wait; they start
 * again by themselves once it is back. Roles that don't need what ran short carry on. The old park drone runs on
 * sunlight and needs nothing.
 *
 * The grid is read through `sim.power` (E23.3) and water through `sim.water` (E23.4). Until those land, power and
 * water count as there. Biomass is E23.5's backpack item once it exists, and the Greens resource until then.
 * Old-city rules only: classic games (gone with E23.1) keep their own drone costs.
 */
export class DroneFuel {
  private registered = false;

  constructor(private sim: Sim) {}

  private get power(): PowerLike | undefined {
    return (this.sim as { power?: PowerLike }).power;
  }

  private get water(): WaterLike | undefined {
    return (this.sim as { water?: WaterLike }).water;
  }

  /** What a role draws now: its data, less the Lighter drones research (E23.6.2), never below one unit a job. */
  supply(role: DroneRole | 'cultivator'): DroneSupply {
    const base = DRONE_SUPPLY[role];
    const k = 1 - Math.min(0.9, this.sim.research?.effect('droneThrift') ?? 0);
    if (k >= 1) return base;
    const less = (n: number | undefined) => (n ? Math.max(1, Math.round(n * k)) : n);
    return { power: base.power * k, water: less(base.water), biomass: less(base.biomass) };
  }

  /** What a role needs from its hub, in words for the hub's panel. */
  needs(role: DroneRole | 'cultivator'): Shortage[] {
    const s = this.supply(role);
    return ['power' as const, ...(s.water ? ['water' as const] : []), ...(s.biomass ? ['biomass' as const] : [])];
  }

  /** The ground tile at a hub's middle (where its water and chest are looked for). */
  private hubTile(hub: MachineData): TileData | undefined {
    return this.sim.grid.get(hub.roofId, Math.floor(hub.x + hub.size / 2), Math.floor(hub.z + hub.size / 2));
  }

  /** A Storage chest within reach of a hub (its way into the store), if any. */
  chestBeside(hub: MachineData): MachineData | undefined {
    const cx = Math.floor(hub.x + hub.size / 2);
    const cz = Math.floor(hub.z + hub.size / 2);
    return this.sim.machinesOfType('chest').find((c) => c.roofId === hub.roofId && distToFootprint(cx, cz, c.x, c.z, c.size) <= DRONE_HUB.chestReach + hub.size / 2);
  }

  /** Biomass in the store (E23.5's item once it exists, the Greens resource until then). */
  biomass(): number {
    if ('biomass' in ITEM_DEFS) return this.sim.inventory.stored('biomass' as ItemId);
    return Math.floor(this.sim.econ.get('biomass').toNumber());
  }

  private takeBiomass(n: number): boolean {
    if (this.biomass() < n) return false;
    if ('biomass' in ITEM_DEFS) {
      const id = 'biomass' as ItemId;
      const st = this.sim.state.salvage!.store;
      st[id] = (st[id] ?? 0) - n;
      if (!st[id]) delete st[id];
      this.sim.bus.emit('store.changed', { material: id, delta: -n });
      return true;
    }
    return this.sim.econ.spend({ biomass: n });
  }

  /** What a hub is short of for a role's next job, if anything (the first thing missing). */
  short(hub: MachineData, role: DroneRole | 'cultivator'): Shortage | undefined {
    if (!this.sim.oldCity) return undefined; // classic rules (until E23.1 removes them) keep their own drone costs
    const s = this.supply(role);
    if (this.power && !this.power.isPowered(hub)) return 'power';
    if (s.water && this.water) {
      const t = this.hubTile(hub);
      if (!t || !this.water.isWatered(t)) return 'water';
    }
    if (s.biomass) {
      if (!this.chestBeside(hub)) return 'biomass';
      if (this.biomass() < s.biomass) return 'biomass';
    }
    return undefined;
  }

  /**
   * Takes one job's water and biomass from a hub's supply. False (and nothing taken) when it is short: the drone
   * docks and waits instead.
   */
  take(hub: MachineData, role: DroneRole | 'cultivator'): boolean {
    if (!this.sim.oldCity) return true;
    if (this.short(hub, role)) return false;
    const s = this.supply(role);
    if (s.water && this.water) {
      const t = this.hubTile(hub)!;
      if (this.water.drawNear(t, s.water) <= 0) return false;
    }
    if (s.biomass && !this.takeBiomass(s.biomass)) return false;
    return true;
  }

  /** Power a hub's drones draw now: each drone out on a job, by its role (E23.3 asks for this as a consumer). */
  draw(hub: MachineData): number {
    if (hub.type === 'cultivator') return (hub.cult?.units ?? []).filter((u) => u.work.length && !u.parked).length * this.supply('cultivator').power;
    let w = 0;
    for (const d of this.sim.state.drones) if (d.hubId === hub.id && !d.old && d.mode !== 'idle' && d.mode !== 'cooldown') w += this.supply(d.role ?? this.sim.roles.roleOf(hub)).power;
    return w;
  }

  /** Once the grid exists: hubs and Cultivator docks are its consumers (shed with the helpers). */
  tick() {
    if (this.registered) return;
    const p = this.power;
    if (!p?.register) return;
    this.registered = true;
    for (const type of ['droneHub', 'cultivator']) p.register(type, { consumer: { shed: 'helper', draw: (m: MachineData) => this.draw(m) } });
  }
}
