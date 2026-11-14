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
    let sum = 0;
    for (const [key, packed] of Object.entries(this.sim.grid.pending)) {
      if (!this.sim.grid.isPlayable(key.split('|')[0])) continue;
      const c = bloomCounts(packed);
      const r = R.biomassPerSec * mult * c.reduce((a, n, lvl) => a + n * (R.bloomRateMult[lvl] ?? 0), 0);
      this.pendingEstimate.set(key, r);
      sum += r;
    }
    return sum;
  }

  /** Something global changed (upgrade, Core, a new rooftop): re-sum every chunk. */
  markDirty() {
    this.dirty = true;
  }

  /**
   * A machine appeared or moved: only tiles under it or inside a garden's reach change rate, so re-sum just
   * the chunks around it (a full re-sum of a 1,000-area city takes hundreds of ms).
   */
  markNear(roofId: string, x: number, z: number, size = 1) {
    const r = this.sim.upgrades.pollinatorReach + 1;
    for (let cz = Math.floor((z - r) / CHUNK); cz <= Math.floor((z + size + r) / CHUNK); cz++)
      for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + size + r) / CHUNK); cx++) this.dirtyChunks.add(chunkKey(roofId, cx, cz));
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

  /** The Lucky Cat's Solar Surge buff (saved as 'solarFrenzy'; renamed so "Frenzy" means only Bloom Frenzy). */
  surgeActive() {
    return this.sim.state.buffs.some((b) => b.type === 'solarFrenzy');
  }

  /** `sustained`: without temporary boosts (bloom boosts, Solar Surge), for offline progress and cat rewards. */
  solarOutput(m: MachineData, sustained = false): number {
    const t = this.sim.time;
    let v = (m.starter ? TUNING.starterSolarRate : TUNING.solarRate) * this.sim.upgrades.solarMult;
    if (sustained) return v;
    if (m.boostUntil > t) v *= TUNING.solarBloomBoost.mult;
    if (this.surgeActive()) v *= TUNING.cat.frenzyMult;
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
    if ((t.lushUntil ?? 0) > this.sim.time) v *= TUNING.neighbourhood.reservoir.lushMult;
    return v;
  }


  /**
   * Income per second. `sustained` leaves out temporary solar boosts (Phase 4 E01: offline progress). Biomass
   * from briefly lush tiles is still counted (it lasts 25 s and is a small share).
   */
  rates(sustained = false): Resources {
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
    let water = TUNING.rainBarrelRate + bonus.water;
    for (const m of this.sim.state.machines) {
      if (m.type === 'solar') energy += this.solarOutput(m, sustained);
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
  }

  /** Water Condensers fill a charge meter; when full they water the dry soil beside them (a chain). */
  private tickCondensers(dt: number) {
    const s = this.sim;
    const rate = TUNING.condenser.chargePerSec * (1 + 0.25 * s.upgrades.waterBloom);
    const R = TUNING.neighbourhood.reservoir;
    const num = (id: string) => Number(id.slice(1)) || 0;
    for (const m of s.machinesOfType('condenser')) {
      const was = m.charge ?? 0;
      m.charge = Math.min(TUNING.condenser.threshold, was + rate * dt);
      if (m.charge < TUNING.condenser.threshold) continue;
      // A full condenser waters the dry soil beside it, and/or tops up Reservoir Gardens in range.
      const near = s.fullScan ? s.state.machines : s.grid.machinesNear(m.roofId, m.x, m.z, R.condenserRange + 1);
      const gardens = near
        .filter((g) => g.type === 'reservoirGarden' && g.roofId === m.roofId && g.charge < R.threshold && distToFootprint(g.x, g.z, m.x, m.z, m.size) <= R.condenserRange)
        .sort((a, b) => num(a.id) - num(b.id)); // build order, whichever way they were found
      // City 10.3: with no garden beside it, a condenser on a canal fills the emptiest garden on that network.
      if (!gardens.length) {
        const far = s.canals.of(m)?.gardens.filter((g) => g.charge < R.threshold).sort((a, b) => a.charge - b.charge || (a.id < b.id ? -1 : 1))[0];
        if (far) {
          gardens.push(far);
          s.bus.emit('canal.flow', { from: m.id, to: far.id, path: s.canals.path(m, far), kind: 'fill' });
        }
      }
      for (const g of gardens) {
        g.charge = Math.min(R.threshold, g.charge + R.fillPerCharge);
        s.bus.emit('reservoir.fill', { machineId: g.id, from: m.id });
      }
      if (s.chains.startWater(m) || gardens.length) m.charge = 0;
    }
    // Full Reservoir Gardens spill over when there is dry ground to irrigate.
    for (const g of s.machinesOfType('reservoirGarden')) if (g.charge >= R.threshold && !this.overflowing.has(g.id)) {
      if (s.chains.startOverflow(g)) this.overflowing.add(g.id);
    }
    if (this.overflowing.size) for (const id of [...this.overflowing]) if ((s.machine(id)?.charge ?? 0) < R.threshold) this.overflowing.delete(id);
  }

  /** Gardens whose Overflow chain is queued (so it doesn't start twice before it resolves). */
  private overflowing = new Set<string>();
}
