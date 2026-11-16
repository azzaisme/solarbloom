import { machinesStamp } from '../core/GameState';
import { KINDS } from '../core/Economy';
import { chunkKey, distToFootprint, type Chunk } from '../core/Grid';
import { CHUNK } from '../core/Hash';
import { bloomCounts } from '../core/TilePack';
import { isRestorable } from '../core/GameState';
import type { MachineData, Rates, TileData } from '../core/types';
import { big } from '../core/Big';
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
    const r = this.sim.upgrades.maxPollinatorReach + 1;
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

  /**
   * `sustained`: without temporary boosts (bloom boosts, Solar Surge, Supernova), for offline progress and cat
   * rewards. Phase 5 E15: `boost` is the composed modifier (Modifiers' stacking policy), applied once here.
   */
  solarOutput(m: MachineData, sustained = false, boost = sustained ? 1 : this.sim.mods.solarMult()): number {
    const t = this.sim.time;
    let v = (m.starter ? TUNING.starterSolarRate : TUNING.solarRate) * this.sim.upgrades.solarMult(m);
    if (sustained) return v;
    if (m.boostUntil > t) v *= TUNING.solarBloomBoost.mult;
    v *= boost; // Solar Surge (composed centrally, Phase 4 E06.6; looked up once per rates() call)
    return v;
  }

  /** True if the tile lies inside any pollinator's zone. */
  inPollinatorZone(t: TileData): boolean {
    return this.gardenZoneMult(t) > 1;
  }

  /** The strongest garden multiplier over this tile (1 outside every zone; zones don't stack). */
  gardenZoneMult(t: TileData): number {
    // Phase 5 E12: each garden has its own reach (Pollinator Reach is bought per garden); E13: a Bloom Garden ×2.
    const u = this.sim.upgrades;
    let best = 1;
    for (const m of this.sim.grid.machinesNear(t.roofId, t.x, t.z, u.maxPollinatorReach))
      if (m.type === 'pollinator' && distToFootprint(t.x, t.z, m.x, m.z, m.size) <= u.pollinatorReach(m)) best = Math.max(best, u.gardenMult(m));
    return best;
  }

  tileBiomassRate(t: TileData): number {
    if (t.ground !== 'restored') return 0;
    let v = TUNING.restore.biomassPerSec * TUNING.restore.bloomRateMult[Math.max(1, t.bloom)] * this.sim.upgrades.soilMult;
    v *= this.gardenZoneMult(t);
    if (this.sim.state.progression.coreActivated) v *= TUNING.core.resonanceBiomassMult;
    if ((t.lushUntil ?? 0) > this.sim.time) v *= TUNING.neighbourhood.reservoir.lushMult;
    return v;
  }


  /**
   * Income per second. `sustained` leaves out temporary solar boosts (Phase 4 E01: offline progress). Biomass
   * from briefly lush tiles is still counted (it lasts 25 s and is a small share).
   */
  rates(sustained = false): Rates {
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
    const bonus = this.sim.areas.bonusIncome();
    const solarBoost = sustained ? 1 : this.sim.mods.solarMult();
    const sums = this.machineSums();
    // Phase 4 E11: solar and condenser totals are cached (they only change with machines and upgrades); only the
    // few panels in a bloom boost right now are visited each tick.
    let energy = bonus.energy + sums.solar * solarBoost;
    if (!sustained) {
      const now = this.sim.time;
      for (const m of this.boostedSolar) {
        if (m.boostUntil > now) energy += this.solarOutput(m, true) * (TUNING.solarBloomBoost.mult - 1) * solarBoost;
        else this.boostedSolar.delete(m);
      }
    }
    // Phase 5 E15: Super Rain multiplies the whole water rate once (composed in Modifiers).
    const water = (TUNING.rainBarrelRate + bonus.water + sums.condensers) * (sustained ? 1 : this.sim.mods.waterMult());
    // Phase 4 E06: temporary biomass boosts (Bloom Frenzy) apply to the total, never to the sustained rate.
    const bm = sustained ? 1 : this.sim.mods.biomassMult();
    // Phase 5 E12: per-tile and per-machine coefficients are plain numbers; the totals are big numbers.
    return { energy: big(energy), water: big(water), biomass: big(this.biomassRate + bonus.biomass).mul(bm) };
  }

  /** Solar panels in a bloom boost (kept small: boosts last seconds). */
  private boostedSolar = new Set<MachineData>();
  private sums?: { key: string; solar: number; condensers: number };

  /** A solar panel just got a bloom boost (BloomChainSystem). */
  solarBoosted(m: MachineData) {
    this.boostedSolar.add(m);
  }

  private machineSums() {
    const ms = this.sim.state.machines;
    const key = `${machinesStamp(ms)}|${this.sim.upgrades.version}`;
    if (this.sums?.key === key) return this.sums;
    let solar = 0;
    let condensers = 0;
    const now = this.sim.time;
    this.boostedSolar.clear();
    for (const m of ms) {
      if (m.type === 'solar') {
        solar += this.solarOutput(m, true);
        if (m.boostUntil > now) this.boostedSolar.add(m);
      } else if (m.type === 'condenser') condensers += this.sim.upgrades.waterMult(m);
    }
    return (this.sums = { key, solar, condensers });
  }

  tick(dt: number) {
    for (const [key, at] of this.lushAt) if (this.sim.time >= at) this.dirtyChunks.add(key);
    const r = this.rates();
    for (const k of KINDS) {
      const amt = r[k].mul(dt);
      if (k !== 'biomass') this.sim.frenzy.onProduced(k, amt);
      this.sim.econ.add(k, amt);
      const full = this.sim.econ.isFull(k);
      if (full && !this.wasFull[k]) this.sim.bus.emit('resource.full', { kind: k });
      this.wasFull[k] = full;
    }
    this.tickCondensers(dt);
  }

  /** Water Condensers fill a charge meter; when full they water the dry soil beside them (a chain). */
  private tickCondensers(dt: number) {
    const s = this.sim;
    const R = TUNING.neighbourhood.reservoir;
    const num = (id: string) => Number(id.slice(1)) || 0;
    for (const m of s.machinesOfType('condenser')) {
      if (m.project && m.project.stage < 3) continue; // Phase 5 E14: still being built
      const rate = TUNING.condenser.chargePerSec * (1 + 0.25 * s.upgrades.waterBloom(m));
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
