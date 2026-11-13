import { formatCost, scaleCost } from '../core/Economy';
import type { BuildableType, Cost, MachineData } from '../core/types';
import { CAT_ANCHORS } from '../data/rooftops';
import { MACHINES } from '../data/machines';
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
    const u = MACHINES[type].unlock;
    return !u || this.sim.state.machines.some((m) => m.type === u.needs);
  }

  count(type: BuildableType) {
    return this.sim.state.machines.filter((m) => m.type === type && !m.starter).length;
  }

  cost(type: BuildableType): Cost {
    return scaleCost(MACHINES[type].cost, Math.pow(TUNING.machineCostGrowth, this.count(type)));
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
    const roof = s.grid.roof(roofId);
    if (!roof || !roof.unlocked || roof.preview) return fail('This rooftop is not reachable yet');
    const cells = s.grid.footprint(roofId, x, z, def.size);
    if (cells.some((c) => !c)) return fail('Too close to the edge');
    for (const c of cells) {
      if (!c) continue;
      if (c.blocked) return fail('A rusty vent is in the way');
      if (c.occupantId) return fail(`${MACHINES[s.occupant(c)!.type].name} is already here`);
      if (s.drones.isReserved(c.id)) return fail('Your drone is about to work here');
      if (c.ground === 'growing') return fail('Let it finish growing first');
      if (!def.allowedGround.includes(c.ground)) return fail('Needs restored or mossy ground — pulse it first');
    }
    const active = s.state.cat.active;
    if (active) {
      const a = CAT_ANCHORS.find((a) => a.id === active.anchorId);
      if (a?.needsFreeTile && a.roofId === roofId) {
        const [ax, az] = a.needsFreeTile;
        if (ax >= x && ax < x + def.size && az >= z && az < z + def.size) return fail('Something small and lucky is sitting there…');
      }
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
    s.production.markDirty();
    s.bus.emit('machine.built', { machine: m });
    if (type === 'droneHub') s.drones.spawn(m);
    return m;
  }
}
