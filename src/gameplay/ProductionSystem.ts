import { KINDS } from '../core/Economy';
import { chunkKey, distToFootprint, type Chunk } from '../core/Grid';
import { CHUNK } from '../core/Hash';
import { bloomCounts } from '../core/TilePack';
import { isRestorable } from '../core/GameState';
import type { MachineData, Resources, TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

/**
 * Passive income. Biomass is cached per chunk: a tile change only re-sums its own chunk, so the cost of
 * restoring a tile does not grow with the city. Global changes (upgrades, new machines, Cores) re-sum all.
 */
export class ProductionSystem {
  private dirty = true;
  private biomassRate = 0;
  private wasFull: Record<string, boolean> = {};
  private chunkRate = new Map<string, number>();
  private dirtyChunks = new Set<string>();
  /** chunk → earliest lush expiry inside it */
  private lushAt = new Map<string, number>();

  constructor(private sim: Sim) {
    sim.grid.touchListeners.push((t) => this.dirtyChunks.add(chunkKey(t.roofId, Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK))));
  }

  /** A chunk was generated (or loaded with saved progress): include it, and drop its saved-data estimate. */
  chunkLoaded(key: string) {
    this.dirtyChunks.add(key);
    const est = this.pendingEstimate.get(key);
    if (est !== undefined) {
      this.biomassRate -= est;
      this.pendingEstimate.delete(key);
    }
  }

  /** Income of saved chunks not loaded yet, estimated from their packed columns (no pollinator/lush bonus). */
  private pendingEstimate = new Map<string, number>();

  private estimatePending(): number {
    this.pendingEstimate.clear();
    const R = TUNING.restore;
    let mult = this.sim.upgrades.soilMult;
    if (this.sim.state.progression.coreActivated) mult *= TUNING.core.resonanceBiomassMult;
    if (this.sim.state.progression.neighbourhoodBloomAt >= 0) mult *= TUNING.neighbourhood.bloom.biomassMult;
    let sum = 0;
    for (const [key, packed] of Object.entries(this.sim.grid.pending)) {
      if (!this.sim.grid.isPlayable(key.split('|')[0])) continue;
      const c = bloomCounts(packed);
      const r = R.biomassPerSec * mult * (c[1] * R.bloomRateMult[1] + c[2] * R.bloomRateMult[2] + c[3] * R.bloomRateMult[3]);
      this.pendingEstimate.set(key, r);
      sum += r;
    }
    return sum;
  }

  /** Something global changed (upgrade, machine, Core): re-sum every chunk. */
  markDirty() {
    this.dirty = true;
  }

  private sumChunk(c: Chunk): number {
    let b = 0;
    let lush = Infinity;
    const now = this.sim.time;
    for (const t of c.tiles) {
      if (!t) continue;
      if (isRestorable(t, this.sim.state.machines)) b += this.tileBiomassRate(t);
      if ((t.lushUntil ?? 0) > now) lush = Math.min(lush, t.lushUntil!);
    }
    if (lush < Infinity) this.lushAt.set(c.key, lush);
    else this.lushAt.delete(c.key);
    return b;
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
    return this.sim.grid.machinesNear(t.roofId, t.x, t.z, reach).some((m) => m.type === 'pollinator');
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


  rates(): Resources {
    const grid = this.sim.grid;
    if (this.dirty) {
      this.dirty = false;
      this.dirtyChunks.clear();
      this.chunkRate.clear();
      this.lushAt.clear();
      let b = 0;
      for (const l of grid.playableLayers()) {
        if (l.kind === 'raised') grid.tilesOf(l.id); // make sure a rooftop is fully generated
        for (const c of grid.loadedChunks(l.id)) {
          const r = this.sumChunk(c);
          this.chunkRate.set(c.key, r);
          b += r;
        }
      }
      this.biomassRate = b + this.estimatePending();
    } else if (this.dirtyChunks.size) {
      for (const key of this.dirtyChunks) {
        const [layer, cx, cz] = key.split('|');
        if (!grid.isPlayable(layer)) continue;
        const c = grid.chunkAt(layer, Number(cx), Number(cz));
        if (!c) continue;
        const r = this.sumChunk(c);
        this.biomassRate += r - (this.chunkRate.get(key) ?? 0);
        this.chunkRate.set(key, r);
      }
      this.dirtyChunks.clear();
    }
    let energy = 0;
    const bonus = this.sim.areas.bonusIncome();
    energy += bonus.energy;
    let water = TUNING.rainBarrelRate + bonus.water + (this.sim.hood.coreAwake('r2') ? TUNING.neighbourhood.reservoir.cisternWater : 0);
    for (const m of this.sim.state.machines) {
      if (m.type === 'solar') energy += this.solarOutput(m);
      else if (m.type === 'condenser') water += 1;
    }
    return { energy, water, biomass: this.biomassRate + bonus.biomass };
  }

  tick(dt: number) {
    for (const [key, at] of this.lushAt) if (this.sim.time >= at) this.dirtyChunks.add(key);
    const r = this.rates();
    for (const k of KINDS) {
      this.sim.econ.add(k, r[k] * dt);
      const full = this.sim.econ.isFull(k);
      if (full && !this.wasFull[k]) this.sim.bus.emit('resource.full', { kind: k });
      this.wasFull[k] = full;
    }
    this.tickCondensers(dt);
    this.tickElderTree(dt);
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

  /** The Elder Tree slowly charges by itself once the Canopy is partly alive (a no-stall guarantee). */
  private tickElderTree(dt: number) {
    const s = this.sim;
    if (!s.grid.isPlayable('r3')) return;
    const c = TUNING.neighbourhood.canopy;
    const tree = s.state.machines.find((m) => m.type === 'core' && m.roofId === 'r3');
    // A full ring is already releasing (a chain queued its burst): wait for it.
    if (!tree || tree.charge >= c.threshold - 1e-9) return;
    const p = s.progression;
    if (p.restoredCount('r3') < p.restorableCount('r3') * c.selfChargeFrom) return;
    tree.charge = Math.min(c.threshold, tree.charge + dt / c.selfChargeSeconds);
    // Only a fill that happened right here starts a burst (chain fills start their own).
    if (tree.charge >= c.threshold - 1e-9) s.chains.startCanopyBurst(tree);
  }

  /** Gardens whose Overflow chain is queued (so it doesn't start twice before it resolves). */
  private overflowing = new Set<string>();
}
