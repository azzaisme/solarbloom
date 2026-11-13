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
    return v;
  }

  rates(): Resources {
    if (this.dirty) {
      this.dirty = false;
      let b = 0;
      for (const r of this.sim.state.rooftops) {
        if (!r.unlocked || r.preview) continue;
        for (const t of r.tiles) if (isRestorable(t, this.sim.state.machines)) b += this.tileBiomassRate(t);
      }
      this.biomassRate = b;
    }
    let energy = 0;
    let water = TUNING.rainBarrelRate;
    for (const m of this.sim.state.machines) {
      if (m.type === 'solar') energy += this.solarOutput(m);
      else if (m.type === 'condenser') water += 1;
    }
    return { energy, water, biomass: this.biomassRate };
  }

  tick(dt: number) {
    const r = this.rates();
    for (const k of KINDS) {
      this.sim.econ.add(k, r[k] * dt);
      const full = this.sim.econ.isFull(k);
      if (full && !this.wasFull[k]) this.sim.bus.emit('resource.full', { kind: k });
      this.wasFull[k] = full;
    }
    this.tickCondensers(dt);
  }

  private tickCondensers(dt: number) {
    const s = this.sim;
    for (const m of s.state.machines) {
      if (m.type !== 'condenser') continue;
      m.timer += dt;
      if (m.timer < TUNING.condenser.irrigateEvery) continue;
      m.timer = 0;
      if (s.econ.get('water') < TUNING.condenser.irrigateWater) continue;
      const target = s.grid
        .tilesNear(m, TUNING.condenser.radius)
        .find((t) => t.ground === 'prepared' && s.restoration.isEligible(t, false));
      if (!target) continue;
      s.econ.spend({ water: TUNING.condenser.irrigateWater });
      s.restoration.beginGrowth(target, 'condenser', 0.6);
    }
  }
}
