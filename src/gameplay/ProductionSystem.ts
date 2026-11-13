import { KINDS } from '../core/Economy';
import { distToFootprint } from '../core/Grid';
import { isRestorable } from '../core/GameState';
import type { MachineData, Resources, TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

export class ProductionSystem {
  private dirty = true;
  private biomassRate = 0;
  private wasFull: Record<string, boolean> = {};

  constructor(private sim: Sim) {}

  markDirty() {
    this.dirty = true;
  }

  frenzyActive() {
    return this.sim.state.buffs.some((b) => b.type === 'solarFrenzy');
  }

  solarOutput(m: MachineData): number {
    const t = this.sim.time;
    let v = (m.starter ? TUNING.starterSolarRate : TUNING.solarRate) * this.sim.upgrades.solarMult;
    if (m.boostUntil > t) v *= TUNING.solarBloomBoost.mult;
    if (this.frenzyActive()) v *= TUNING.cat.frenzyMult;
    return v;
  }

  /** True if the tile lies inside any pollinator's zone. */
  inPollinatorZone(t: TileData): boolean {
    const reach = this.sim.upgrades.pollinatorReach;
    return this.sim.state.machines.some(
      (m) => m.type === 'pollinator' && m.roofId === t.roofId && distToFootprint(t.x, t.z, m.x, m.z, m.size) <= reach,
    );
  }

  tileBiomassRate(t: TileData): number {
    if (t.ground !== 'restored') return 0;
    let v = TUNING.restore.biomassPerSec * TUNING.restore.bloomRateMult[Math.max(1, t.bloom)] * this.sim.upgrades.soilMult;
    if (this.inPollinatorZone(t)) v *= TUNING.pollinator.biomassMult;
    if (this.sim.state.progression.coreActivated) v *= TUNING.core.resonanceBiomassMult;
    if (this.sim.state.progression.neighbourhoodBloomAt >= 0) v *= TUNING.neighbourhood.bloom.biomassMult;
    if ((t.lushUntil ?? 0) > this.sim.time) v *= TUNING.neighbourhood.reservoir.lushMult;
    return v;
  }

  /** Earliest moment a lush (Overflow) tile goes back to normal, so cached rates refresh then. */
  private lushExpiry = Infinity;

  rates(): Resources {
    if (this.dirty) {
      this.dirty = false;
      let b = 0;
      this.lushExpiry = Infinity;
      const now = this.sim.time;
      for (const r of this.sim.state.rooftops) {
        if (!r.unlocked || r.preview) continue;
        for (const t of r.tiles) {
          if (isRestorable(t, this.sim.state.machines)) b += this.tileBiomassRate(t);
          if ((t.lushUntil ?? 0) > now) this.lushExpiry = Math.min(this.lushExpiry, t.lushUntil!);
        }
      }
      this.biomassRate = b;
    }
    let energy = 0;
    let water = TUNING.rainBarrelRate + (this.sim.hood.coreAwake('r2') ? TUNING.neighbourhood.reservoir.cisternWater : 0);
    for (const m of this.sim.state.machines) {
      if (m.type === 'solar') energy += this.solarOutput(m);
      else if (m.type === 'condenser') water += 1;
    }
    return { energy, water, biomass: this.biomassRate };
  }

  tick(dt: number) {
    if (this.sim.time >= this.lushExpiry) this.dirty = true;
    const r = this.rates();
    for (const k of KINDS) {
      this.sim.econ.add(k, r[k] * dt);
      const full = this.sim.econ.isFull(k);
      if (full && !this.wasFull[k]) this.sim.bus.emit('resource.full', { kind: k });
      this.wasFull[k] = full;
    }
    this.tickCondensers(dt);
  }

  /** Water Condensers fill a charge meter; when full they water the dry soil beside them (a chain). */
  private tickCondensers(dt: number) {
    const s = this.sim;
    const rate = TUNING.condenser.chargePerSec * (1 + 0.25 * s.upgrades.waterBloom);
    const R = TUNING.neighbourhood.reservoir;
    for (const m of s.state.machines) {
      if (m.type !== 'condenser') continue;
      const was = m.charge ?? 0;
      m.charge = Math.min(TUNING.condenser.threshold, was + rate * dt);
      if (m.charge < TUNING.condenser.threshold) continue;
      // A full condenser waters the dry soil beside it, and/or tops up Reservoir Gardens in range.
      const gardens = s.state.machines.filter(
        (g) => g.type === 'reservoirGarden' && g.roofId === m.roofId && g.charge < R.threshold && distToFootprint(g.x, g.z, m.x, m.z, m.size) <= R.condenserRange,
      );
      for (const g of gardens) {
        g.charge = Math.min(R.threshold, g.charge + R.fillPerCharge);
        s.bus.emit('reservoir.fill', { machineId: g.id, from: m.id });
      }
      if (s.chains.startWater(m) || gardens.length) m.charge = 0;
    }
    // Full Reservoir Gardens spill over when there is dry ground to irrigate.
    for (const g of s.state.machines) if (g.type === 'reservoirGarden' && g.charge >= R.threshold && !this.overflowing.has(g.id)) {
      if (s.chains.startOverflow(g)) this.overflowing.add(g.id);
    }
    if (this.overflowing.size) for (const id of [...this.overflowing]) if ((s.machine(id)?.charge ?? 0) < R.threshold) this.overflowing.delete(id);
  }

  /** Gardens whose Overflow chain is queued (so it doesn't start twice before it resolves). */
  private overflowing = new Set<string>();
}
