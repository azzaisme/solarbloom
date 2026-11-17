import { CAPPED, formatCost, scaleCost } from '../core/Economy';
import { big, Decimal } from '../core/Big';
import type { BuildableType, Cost, GroundState, MachineData } from '../core/types';
import { MACHINES, machineName } from '../data/machines';
import { AREA_TYPES, type AreaType } from '../data/city';
import { GROUND } from '../core/GameState';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

/** E19.2: what building over a decoration says (a decoration is free and instant to remove). */
export const DECOR_IN_WAY = 'A decoration is here: remove it first';

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

  /** Copies of a type standing now (a merged machine counts once). */
  count(type: BuildableType) {
    return this.sim.state.machines.filter((m) => m.type === type && !m.starter).length;
  }

  /**
   * Phase 5 E13: copies ever built (prices count these). Before the first merge or build this is the copies
   * standing, which also covers saves and tests that place machines directly.
   */
  built(type: BuildableType): number {
    return this.sim.state.stats.built?.[type] ?? this.count(type);
  }

  /** Starts the lifetime counts from what stands now (before anything is built or merged away). */
  ensureBuiltCounts(): Record<string, number> {
    const st = this.sim.state.stats;
    if (!st.built) {
      st.built = {};
      for (const m of this.sim.state.machines) if (!m.starter && m.type !== 'core') st.built[m.type] = (st.built[m.type] ?? 0) + 1;
    }
    return st.built;
  }

  /** The price before Phase 5's storage clamp: copies × machineCostGrowth, less permits (the specialty safety valve reads it). */
  rawCost(type: BuildableType): Cost {
    // Cleared city areas grant permits: each waives one copy's worth of cost growth.
    const permits = (this.sim.areas?.clearedCount() ?? 0) * TUNING.city.permitsPerArea;
    return scaleCost(MACHINES[type].cost, Decimal.pow(TUNING.machineCostGrowth, Math.max(0, this.built(type) - permits)));
  }

  cost(type: BuildableType): Cost {
    const cost = this.rawCost(type);
    // Phase 5 E12: never an impossible price. Energy and water incomes barely grow while biomass has no cap, so
    // the energy/water part grows for the first few copies only (further copies cost more biomass), and never
    // passes a share of that store. While the advisor says "save up", drones leave that much alone.
    const permits = (this.sim.areas?.clearedCount() ?? 0) * TUNING.city.permitsPerArea;
    const copies = Math.min(TUNING.machineCappedGrowthCopies, Math.max(0, this.built(type) - permits));
    const base = MACHINES[type].cost;
    for (const k of CAPPED) {
      const cap = this.sim.econ.cap(k);
      if (base[k] === undefined) continue;
      let v = big(base[k]).mul(Decimal.pow(TUNING.machineCostGrowth, copies)).ceil();
      if (cap) v = v.min(cap.mul(TUNING.machineCostMaxShare).floor());
      cost[k] = v;
    }
    return cost;
  }

  /** Why a footprint can't be built on (edge, fog, vent, occupied, drone target, growing, wrong ground), if it can't. */
  footprintProblem(roofId: string, x: number, z: number, size: number, allowed: GroundState[]): string | undefined {
    const s = this.sim;
    const cells = s.grid.footprint(roofId, x, z, size);
    if (cells.some((c) => !c)) return 'Too close to the edge';
    for (const c of cells) {
      if (!c) continue;
      if (!s.areas.isClear(c) && !s.areas.canTouch(c)) return 'Lost in the fog — clear the ground here first';
      if (c.blocked) return 'A rusty vent is in the way';
      if (c.occupantId) {
        const m = s.occupant(c);
        return m ? `${machineName(m)} is already here` : DECOR_IN_WAY; // E19.2: a decoration (free and instant to remove)
      }
      if (s.drones.isReserved(c.id)) return 'Your drone is about to work here';
      if (c.ground === 'growing') return 'Let it finish growing first';
      if (!allowed.includes(c.ground)) return 'Needs restored or mossy ground — pulse it first';
    }
    return undefined;
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
    const why = this.footprintProblem(roofId, x, z, def.size, def.allowedGround);
    if (why) return fail(why);
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
    const built = this.ensureBuiltCounts();
    built[type] = (built[type] ?? 0) + 1;
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
