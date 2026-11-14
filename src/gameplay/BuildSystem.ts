import { formatCost, scaleCost } from '../core/Economy';
import type { BuildableType, Cost, MachineData } from '../core/types';
import { MACHINES } from '../data/machines';
import { AREA_TYPES, type AreaType } from '../data/city';
import { GROUND } from '../core/GameState';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

export interface PlacementCheck {
  ok: boolean;
  reason?: string;
  cost: Cost;
  /** true when the spot is fine and only resources are missing */
  spotOk: boolean;
}

export class BuildSystem {
  constructor(private sim: Sim) {}

  isUnlocked(type: BuildableType) {
    const def = MACHINES[type];
    const u = def.unlock;
    if (u && !this.sim.state.machines.some((m) => m.type === u.needs)) return false;
    if (def.cityOnly && !this.sim.grid.isPlayable(GROUND)) return false;
    if (def.roofs) {
      const onRoof = def.roofs.some((id) => this.sim.grid.isPlayable(id));
      // In the city, a specialty piece unlocks once an area of its type is revealed.
      const inCity = !!def.areaTypes && this.sim.grid.isPlayable(GROUND) && this.sim.areas.revealed().some((id) => def.areaTypes!.includes(this.sim.areas.info(id).type));
      if (!onRoof && !inCity) return false;
    }
    return true;
  }

  /** Short reason a machine is still locked (hotbar label). */
  lockLabel(type: BuildableType): string {
    const def = MACHINES[type];
    if (def.unlock && !this.sim.state.machines.some((m) => m.type === def.unlock!.needs)) return `🔒 ${MACHINES[def.unlock.needs].name}`;
    if (def.roofs && this.sim.grid.isPlayable(GROUND) && def.areaTypes) return `🔒 ${def.areaTypes.map((t) => AREA_TYPES[t as AreaType].name).join(' / ')}`;
    if (def.roofs) return `🔒 ${def.roofs.map((id) => this.sim.grid.roof(id)?.name ?? id).join(', ')}`;
    return '';
  }

  count(type: BuildableType) {
    return this.sim.state.machines.filter((m) => m.type === type && !m.starter).length;
  }

  cost(type: BuildableType): Cost {
    // Cleared city areas grant permits: each waives one copy's worth of cost growth.
    const permits = (this.sim.areas?.clearedCount() ?? 0) * TUNING.city.permitsPerArea;
    return scaleCost(MACHINES[type].cost, Math.pow(TUNING.machineCostGrowth, Math.max(0, this.count(type) - permits)));
  }

  /** Converts a cursor cell into the footprint anchor so the ghost centres on the pointer. */
  anchorFor(type: BuildableType, fx: number, fz: number): { x: number; z: number } {
    const size = MACHINES[type].size;
    return { x: Math.floor(fx - size / 2 + 0.5), z: Math.floor(fz - size / 2 + 0.5) };
  }

  check(type: BuildableType, roofId: string, x: number, z: number): PlacementCheck {
    const s = this.sim;
    const def = MACHINES[type];
    const cost = this.cost(type);
    const fail = (reason: string): PlacementCheck => ({ ok: false, reason, cost, spotOk: false });
    if (def.unlock && !s.state.machines.some((m) => m.type === def.unlock!.needs)) return fail(def.unlock.label);
    if (def.cityOnly && !s.grid.isPlayable(GROUND)) return fail('Only in the city');
    const roof = s.grid.roof(roofId);
    if (!roof || !roof.unlocked || roof.preview) return fail('This rooftop is not reachable yet');
    if (roofId === GROUND && def.areaTypes) {
      const t = AREA_TYPES[s.areas.info(s.areas.map.areaOfCell(x, z)).type];
      if (!def.areaTypes.includes(t.type)) return fail(`Only grows in a ${def.areaTypes.map((a) => AREA_TYPES[a as AreaType].name.toLowerCase()).join(' or ')} area`);
    } else if (def.roofs && !def.roofs.includes(roofId)) return fail(`Only grows on ${def.roofs.map((id) => s.grid.roof(id)?.name ?? id).join(', ')}`);
    const cells = s.grid.footprint(roofId, x, z, def.size);
    if (cells.some((c) => !c)) return fail('Too close to the edge');
    for (const c of cells) {
      if (!c) continue;
      if (!s.areas.isClear(c) && !s.areas.canTouch(c)) return fail('Lost in the fog — clear the ground here first');
      if (c.blocked) return fail('A rusty vent is in the way');
      if (c.occupantId) return fail(`${MACHINES[s.occupant(c)!.type].name} is already here`);
      if (s.drones.isReserved(c.id)) return fail('Your drone is about to work here');
      if (c.ground === 'growing') return fail('Let it finish growing first');
      if (!def.allowedGround.includes(c.ground)) return fail('Needs restored or mossy ground — pulse it first');
    }
    if (!s.econ.canAfford(cost)) return { ok: false, reason: `Need ${formatCost(cost)}`, cost, spotOk: true };
    return { ok: true, cost, spotOk: true };
  }

  place(type: BuildableType, roofId: string, x: number, z: number): MachineData | undefined {
    const s = this.sim;
    const chk = this.check(type, roofId, x, z);
    if (!chk.ok) {
      s.bus.emit('action.failed', { reason: chk.reason! });
      return undefined;
    }
    s.econ.spend(chk.cost);
    const def = MACHINES[type];
    const m: MachineData = { id: s.newId('m'), type, roofId, x, z, size: def.size, boostUntil: 0, timer: 0, charge: 0 };
    s.state.machines.push(m);
    for (const c of s.grid.footprint(roofId, x, z, def.size)) if (c) c.occupantId = m.id;
    s.grid.indexMachine(m);
    s.production.markNear(roofId, x, z, def.size);
    s.bus.emit('machine.built', { machine: m });
    s.cat.relocateIfBlocked(); // the Lucky Cat never blocks a build: it hops to another nook
    if (type === 'droneHub') s.drones.spawn(m); // more drones (upgrade) are topped up by DroneSystem
    return m;
  }
}
