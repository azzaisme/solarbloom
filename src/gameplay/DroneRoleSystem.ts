import { PARK } from '../core/Areas';
import { big, Decimal, toNum } from '../core/Big';
import { CAPPED, formatCost, KINDS } from '../core/Economy';
import type { Cost, DroneRole, MachineData } from '../core/types';
import { DRONE_ROLE_BY_ID, DRONE_ROLES, isDroneRole, type DroneRoleDef } from '../data/droneRoles';
import { TUNING } from '../data/tuning';
import { HOME } from './ProgressionSystem';
import type { Sim } from './Sim';

export interface RoleStatus {
  role: DroneRole;
  /** the hub's current role */
  current: boolean;
  /** refitted already (switching to it is free) */
  owned: boolean;
  /** the role's unlock is met */
  unlocked: boolean;
  /** can it be picked now (switch or refit)? */
  ok: boolean;
  reason?: string;
  /** refit price if not owned (empty if owned) */
  price: Cost;
}

/**
 * E18.1 (#201): drone roles per Drone Hub. A hub is refitted for a role once (one atomic purchase at the price
 * in `TUNING.drone.roles.refit`), then switches between its owned roles for free. Roles unlock from progress
 * (docs/DRONE_ROLES_EPIC.md 2.2). Behaviour lives in each role's `RoleStrategy` in `DroneSystem`; a role
 * whose strategy isn't built yet can't be picked.
 */
export class DroneRoleSystem {
  constructor(private sim: Sim) {}

  defs(): DroneRoleDef[] {
    return DRONE_ROLES;
  }

  /** Is the role's behaviour built (registered in DroneSystem)? Restorer always is. */
  available(role: DroneRole): boolean {
    return this.sim.drones.hasStrategy(role);
  }

  /** The hub's role (unset or unknown = Restorer). */
  roleOf(hub: MachineData): DroneRole {
    return this.sim.drones.hubRole(hub);
  }

  /** Roles a hub owns: Restorer always, plus its refits. */
  owned(hub: MachineData): DroneRole[] {
    return ['restorer', ...(hub.roles ?? []).filter((r) => isDroneRole(r) && r !== 'restorer')];
  }

  owns(hub: MachineData, role: DroneRole): boolean {
    return role === 'restorer' || !!hub.roles?.includes(role);
  }

  /** Has the game reached the point where this role makes sense (2.2)? */
  unlocked(role: DroneRole): boolean {
    const s = this.sim;
    const has = (type: string) => s.state.machines.some((m) => m.type === type && !m.starter);
    const U = TUNING.drone.roles.unlock;
    switch (role) {
      case 'restorer':
        return true;
      case 'gardener':
        // The fountain needs more full-bloom tiles than this, so once it's awake the count is met for good.
        return has('droneHub') && has('condenser') && (s.state.progression.coreActivated || s.progression.fullBloomCount(HOME) >= U.gardenerFullBloom);
      case 'scout':
        return s.areas.revealed().some((id) => id !== PARK);
      case 'courier':
        return has('motherTree') || has('relay');
      case 'spark':
        return s.state.machines.filter((m) => m.type === 'pollinator').length >= U.sparkGardens;
      case 'harvester': {
        const r = s.production.rates();
        return KINDS.some((k) => {
          const rate = toNum(r[k]);
          return rate > 0 && s.log.overflow[k] >= rate * U.harvesterOverflowSeconds;
        });
      }
    }
  }

  /** Hubs other than `hub` already refitted for `role` (each makes the next refit's biomass part ×refitGrowth). */
  private refitted(role: DroneRole, hub?: MachineData): number {
    let n = 0;
    for (const m of this.sim.machinesOfType('droneHub')) if (m !== hub && m.roles?.includes(role)) n++;
    return n;
  }

  /**
   * The one-time refit price (2.3): the biomass part grows ×refitGrowth per other hub already refitted to the
   * role; energy and water never grow and never pass machineCostMaxShare of their store.
   */
  refitPrice(role: DroneRole, hub?: MachineData): Cost {
    if (role === 'restorer') return {};
    const base = TUNING.drone.roles.refit[role] as Partial<Record<'biomass' | 'energy' | 'water', number>>;
    const cost: Cost = {};
    if (base.biomass) cost.biomass = big(base.biomass).mul(Decimal.pow(TUNING.drone.roles.refitGrowth, this.refitted(role, hub))).ceil();
    for (const k of CAPPED) {
      const v = base[k];
      if (!v) continue;
      const cap = this.sim.econ.cap(k);
      cost[k] = cap ? big(v).min(cap.mul(TUNING.machineCostMaxShare).floor().max(1)) : big(v);
    }
    return cost;
  }

  status(hub: MachineData, role: DroneRole): RoleStatus {
    const current = this.roleOf(hub) === role;
    const owned = this.owns(hub, role);
    const price = owned ? {} : this.refitPrice(role, hub);
    const unlocked = this.unlocked(role);
    const out = (ok: boolean, reason?: string): RoleStatus => ({ role, current, owned, unlocked, ok, reason, price });
    if (hub.type !== 'droneHub') return out(false, 'Only Drone Hubs take roles');
    if (!this.available(role)) return out(false, 'Coming soon');
    if (current) return out(false, 'Already its role');
    if (owned) return out(true);
    if (!unlocked) return out(false, DRONE_ROLE_BY_ID[role].lockedReason);
    if (!this.sim.econ.canAfford(price)) return out(false, `Need ${formatCost(price)}`);
    return out(true);
  }

  /**
   * Sets a hub's role: free if owned, else one atomic refit (check, pay once, apply once). A stale call (hub
   * gone, not a hub, role already current) changes nothing. Drones in flight finish the job they paid for
   * (it keeps its role), then follow the new one.
   */
  setRole(hubId: string, role: DroneRole): boolean {
    const s = this.sim;
    const hub = s.machine(hubId);
    if (!hub || !isDroneRole(role)) return false;
    const st = this.status(hub, role);
    if (!st.ok) {
      s.bus.emit('action.failed', { reason: st.reason ?? 'Unavailable' });
      return false;
    }
    const refit = !st.owned;
    if (refit && !s.econ.spend(st.price)) return false;
    if (refit) hub.roles = [...(hub.roles ?? []), role];
    if (role === 'restorer') delete hub.role;
    else hub.role = role;
    s.bus.emit('drone.roleChanged', { hubId, role, refit });
    return true;
  }
}
