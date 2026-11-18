import { formatCost } from '../core/Economy';
import { distToFootprint } from '../core/Grid';
import { ROOF_TEMPLATES } from '../data/templates';
import { GROUND } from '../core/GameState';
import type { Cost, PlantKind, RestoreSource, TileData } from '../core/types';
import { PLANT_LOAD, PULSE_LOAD, type PulseLoadDef } from '../data/pulse';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

export interface PulseCheck {
  ok: boolean;
  reason?: string;
  cost: Cost;
}

export class RestorationSystem {
  constructor(private sim: Sim) {}

  pulseCost(t: TileData): Cost {
    const layer = this.sim.grid.layer(t.roofId);
    // City rooftops cost like their template's ground, scaled by their area's distance difficulty.
    const roofMult =
      t.roofId === GROUND
        ? this.sim.areas.info(this.sim.areas.areaOf(t)!).difficulty
        : ((layer?.template ? ROOF_TEMPLATES[layer.template]?.pulseCostMult : undefined) ?? 1) * (layer?.cluster ? this.sim.areas.info(layer.cluster).difficulty : 1);
    if (t.ground === 'restored') {
      const n = TUNING.restore.nurture[Math.min(TUNING.restore.maxBloom, t.bloom + 1)];
      return { energy: Math.round(n.energy * this.sim.upgrades.pulseEnergyMult * 100) / 100, water: n.water };
    }
    const base = t.ground === 'prepared' ? TUNING.pulse.prepared : TUNING.pulse.polluted;
    return { energy: Math.round(base.energy * this.sim.upgrades.pulseEnergyMult * roofMult * 100) / 100, water: Math.ceil(base.water * roofMult) };
  }

  /** E21.9: may a helper (drone, Cultivator, Mother Tree) work this tile? (Old City: bloombot's share first.) */
  helperMay(t: TileData): boolean {
    return t.roofId !== GROUND || this.sim.areas.helpersMayWork(this.sim.areas.areaOf(t));
  }

  /** Can this tile be turned into a restoration target at all (ignoring cost)? */
  isEligible(t: TileData, allowPolluted = true): boolean {
    const roof = this.sim.grid.roof(t.roofId);
    if (!roof || !roof.unlocked || roof.preview) return false;
    if (t.blocked || this.sim.isCoreTile(t)) return false;
    if (t.ground === 'restored' || t.ground === 'growing') return false;
    if (!this.sim.areas.canTouch(t)) return false;
    if (t.ground === 'polluted' && !allowPolluted) return false;
    if (this.sim.drones.isReserved(t.id)) return false;
    return true;
  }

  checkPulse(t: TileData): PulseCheck {
    const cost = this.pulseCost(t);
    const roof = this.sim.grid.roof(t.roofId);
    if (!roof || !roof.unlocked || roof.preview) return { ok: false, reason: 'This rooftop is not reachable yet', cost };
    const fog = this.sim.areas.fogReason(t);
    if (fog) return { ok: false, reason: fog, cost };
    if (t.blocked && t.feature === 'water') return { ok: false, reason: 'The open sea — nothing grows out there', cost };
    const piece = t.blocked ? this.sim.salvage?.describe(t) : undefined; // E21: a pile, a gate, a Keeper
    if (piece) return { ok: false, reason: piece.detail, cost };
    if (t.blocked) return { ok: false, reason: t.feature === 'building' ? 'An old building: its roof garden wakes when this area clears' : 'A rusty vent — nothing grows here', cost };
    if (this.sim.isCoreTile(t)) return { ok: false, reason: 'The Rooftop Core — awaken it when it is ready', cost };
    if (t.ground === 'restored' && t.bloom >= TUNING.restore.maxBloom) return { ok: false, reason: 'Already in full bloom', cost };
    // E23.2.1: out of charge, no pulse (bloombot walks on; eat, sit or find a charger)
    if (!this.sim.charge.canUse('pulse')) return { ok: false, reason: 'Out of charge. Eat something, rest or find a charger', cost };
    if (t.ground === 'growing') return { ok: false, reason: `Roots are breaking through — ${Math.max(1, Math.ceil(t.growthRemainingSec))}s`, cost };
    const tilling = this.sim.cultivators?.remaining(t);
    if (tilling !== undefined) return { ok: false, reason: `The Cultivator is breaking up this slab — ${Math.max(1, Math.ceil(tilling))}s`, cost };
    if (this.sim.drones.isReserved(t.id)) return { ok: false, reason: 'Your drone is on its way here', cost };
    const short = this.sim.econ.shortfall(cost);
    if (short === 'energy')
      return { ok: false, reason: `Need ${formatCost({ energy: cost.energy })} — solar is recharging, or Harvest Sunlight`, cost };
    if (short === 'water') {
      const hasCondenser = this.sim.state.machines.some((m) => m.type === 'condenser');
      return {
        ok: false,
        reason: hasCondenser ? 'Water is condensing — one moment' : 'Need 💧 — the rain barrel is refilling. A Water Condenser helps!',
        cost,
      };
    }
    return { ok: true, cost };
  }

  /** Player Restoration Pulse. */
  pulse(tileId: string): boolean {
    const t = this.sim.grid.byTileId(tileId);
    if (!t) return false;
    const chk = this.checkPulse(t);
    if (!chk.ok) {
      // Look 6.10: a tap on a tile mid-process knocks it along instead of failing: a Cultivator's tile (gameplay
      // time, limited), or one whose growth is still playing out (visual only).
      if (this.sim.cultivators.knock(t)) return false;
      if ((t.ground === 'growing' || (t.ground === 'restored' && t.bloom >= TUNING.restore.maxBloom)) && this.sim.transitions.knock(t)) return false;
      this.sim.bus.emit('action.failed', { reason: chk.reason!, tileId });
      return false;
    }
    this.sim.econ.spend(chk.cost);
    this.sim.charge.use('pulse');
    // E23.2.2: the pulse uses one unit of its load (or fires empty) and sends out its reveal ripple
    const load = this.sim.pulseLoad.take();
    this.sim.bus.emit('pulse.ripple', { tileId, targets: this.sim.pulseLoad.ripple(t) });
    if (this.megaReady()) return this.releaseMega(t);
    this.chargeMega();
    if (t.ground === 'restored') {
      if (load.plant) this.plant(t, load.plant);
      this.grow(t, undefined, 'player');
      this.boostNeighbours(t);
      this.sim.bus.emit('pulse.fired', { tileId, extra: [], overcharged: false });
      return true;
    }
    if (load.plant) this.plant(t, load.plant);
    this.beginGrowth(t, 'pulse', TUNING.pulse.growSeconds);
    this.boostNeighbours(t);
    // Overcharge: every Nth manual pulse restores everything within 2 tiles.
    const every = this.sim.upgrades.overchargeEvery;
    const prog = this.sim.state.progression;
    let overcharged = false;
    if (every > 0) {
      prog.pulseCharge = (prog.pulseCharge ?? 0) + 1;
      if (prog.pulseCharge >= every) {
        prog.pulseCharge = 0;
        overcharged = true;
      }
    }
    const extra: string[] = [];
    for (const { tile: nb, d } of this.footprint(t, overcharged, load)) {
      if (load.plant) this.plant(nb, load.plant);
      this.beginGrowth(nb, 'broad', TUNING.pulse.growSeconds + Math.min(1.2, 0.12 * d + 0.01 * extra.length)); // ripple outward, done within ~2 s
      extra.push(nb.id);
    }
    this.sim.bus.emit('pulse.fired', { tileId, extra, overcharged });
    return true;
  }

  /** Whether the next manual pulse on a dead tile will be Overcharged. */
  nextIsOvercharged(): boolean {
    const every = this.sim.upgrades.overchargeEvery;
    return every > 0 && (this.sim.state.progression.pulseCharge ?? 0) + 1 >= every;
  }

  /**
   * The extra tiles a pulse on dead tile `t` restores for free (beyond `t` itself), nearest first, with their
   * grid distance. Pure: the HUD previews exactly this before you tap (Phase 4 E03.1).
   */
  footprint(t: TileData, overcharged = this.nextIsOvercharged(), load: PulseLoadDef = this.sim.pulseLoad.next()): { tile: TileData; d: number }[] {
    const radius = this.pulseRadius(overcharged, load.extraReach);
    if (radius <= 0) return [];
    const r2 = radius * radius;
    return this.sim.grid
      .tilesWithin(t.roofId, t.x, t.z, Math.ceil(radius * Math.SQRT2)) // Manhattan bound around the circle
      .map((nb) => ({ tile: nb, d2: (nb.x - t.x) ** 2 + (nb.z - t.z) ** 2 }))
      .filter(({ tile, d2 }) => d2 >= 1 && d2 <= r2 + 1e-9 && this.isEligible(tile))
      .sort((a, b) => a.d2 - b.d2 || a.tile.pollution - b.tile.pollution || a.tile.id.localeCompare(b.tile.id))
      .map(({ tile, d2 }) => ({ tile, d: Math.sqrt(d2) }));
  }

  /** Phase 4 E04.2: the pulse's reach (Euclidean, in tiles) from Pulse Reach; Overcharge reaches a tier further. */
  pulseRadius(overcharged = false, extraReach = 0): number {
    const tiers = TUNING.pulseTiers;
    const lvl = Math.min(tiers.length - 1, this.sim.upgrades.broadExtra + extraReach + (overcharged ? 1 : 0));
    return overcharged ? Math.max(tiers[2].radius, tiers[lvl].radius) : tiers[lvl].radius;
  }

  /**
   * Overcharge Pulse: a manual pulse right next to a machine boosts its next trigger
   * (+1 target, or more output for a solar burst). Automation never does this; only your taps.
   */
  boostNeighbours(t: TileData) {
    const s = this.sim;
    for (const m of s.grid.machinesNear(t.roofId, t.x, t.z, 1)) {
      if (m.type === 'droneHub' || (m.type === 'core' && !s.chains.isElder(m))) continue;
      if (distToFootprint(t.x, t.z, m.x, m.z, m.size) !== 1) continue;
      const fresh = (m.overchargeUntil ?? 0) <= s.time;
      m.overchargeUntil = s.time + TUNING.neighbourhood.overchargeSeconds;
      if (fresh) s.bus.emit('machine.boosted', { machineId: m.id });
    }
  }

  /** Grows an already-restored tile one bloom level (grass → flowers → shrubs). Can start or continue a chain. */
  // ───────────── Mega Pulse ─────────────

  megaReady(): boolean {
    return (this.sim.state.progression.megaCharge ?? 0) >= TUNING.mega.charge;
  }

  /** Tiles the next Mega Pulse can bloom: grows with the city, capped. */
  megaBudget(): number {
    const M = TUNING.mega;
    return Math.min(M.maxTiles, M.baseTiles + M.tilesPerArea * (this.sim.areas?.clearedCount() ?? 0));
  }

  /** The Mega Pulse is the city's tool: it starts charging once the fountain is awake. */
  private chargeMega() {
    const p = this.sim.state.progression;
    if (!p.coreActivated) return;
    const was = p.megaCharge ?? 0;
    p.megaCharge = Math.min(TUNING.mega.charge, was + 1);
    if (p.megaCharge >= TUNING.mega.charge && was < TUNING.mega.charge) this.sim.bus.emit('mega.ready', {});
  }

  private releaseMega(t: TileData): boolean {
    this.sim.state.progression.megaCharge = 0;
    this.boostNeighbours(t);
    this.sim.chains.startMegaPulse(t, this.megaBudget());
    this.sim.bus.emit('pulse.fired', { tileId: t.id, extra: [], overcharged: true });
    return true;
  }

  /** `quiet`: offline drone work (Phase 4 E01) grows the tile and pays its yield but sets off no chain. */
  grow(t: TileData, chainId?: number, starter: 'player' | 'auto' = 'auto', quiet = false) {
    if (t.ground !== 'restored' || t.bloom >= TUNING.restore.maxBloom) return;
    this.chainPlantOn(t, chainId);
    t.bloom = Math.min(TUNING.restore.maxBloom, t.bloom + 1);
    this.sim.transitions.bloom(t, t.bloom, starter === 'auto' || quiet);
    this.sim.grid.touch(t);
    const b = this.sim.econ.add('biomass', TUNING.restore.nurtureBiomass * this.sim.upgrades.soilMult);
    if (b.gt(0)) this.sim.bus.emit('resource.gain', { kind: 'biomass', amount: b, tileId: t.id });
    this.sim.bus.emit('tile.nurtured', { tile: t, level: t.bloom, auto: starter === 'auto' });
    if (quiet) return;
    const id = this.sim.chains.onGrown(t, chainId, starter);
    this.sim.chains.addReward(id, b);
  }

  // ───────────── E23.2.2: what grows ─────────────

  /** What a loaded pulse grows on a tile (it stays: the look and the biomass follow it). */
  plant(t: TileData, kind: PlantKind) {
    t.plant = kind;
    this.sim.grid.touch(t);
    this.sim.bus.emit('tile.planted', { tile: t, plant: kind });
  }

  /** The load that grew this tile (nothing: plain grass and moss). */
  plantDef(t: TileData): PulseLoadDef {
    return t.plant ? PULSE_LOAD[PLANT_LOAD[t.plant]] : PULSE_LOAD.none;
  }

  /** Chains a loaded pulse set off grow what it carried (newest chains remembered; old ones fall away). */
  private chainPlants = new Map<number, PlantKind>();
  private rememberChainPlant(id: number, kind: PlantKind) {
    this.chainPlants.set(id, kind);
    if (this.chainPlants.size > 64) this.chainPlants.delete(this.chainPlants.keys().next().value!);
  }
  private chainPlantOn(t: TileData, chainId?: number) {
    if (t.plant || chainId === undefined || chainId < 0) return;
    const k = this.chainPlants.get(chainId);
    if (k) this.plant(t, k);
  }

  beginGrowth(t: TileData, source: RestoreSource, seconds: number) {
    // Look 6: the restore sequence starts now and plays on past the sim's (short) growth.
    this.sim.transitions.restore(t, source, t.ground === 'polluted' ? t.pollution : 0);
    t.ground = 'growing';
    t.pollution = 0;
    t.growthRemainingSec = seconds;
    t.growSource = source;
    this.growing.set(t.id, t);
    this.sim.grid.touch(t);
    this.sim.bus.emit('tile.restoring', { tile: t, source });
  }

  /** Tiles currently growing (kept as a set so a tick never scans the world). In world order for determinism. */
  private growing = new Map<string, TileData>();

  /** Picks up tiles that were mid-growth in a loaded save. */
  adoptGrowing() {
    for (const c of this.sim.grid.loadedChunks()) for (const t of c.tiles) if (t && t.ground === 'growing') this.growing.set(t.id, t);
  }

  /** Tiles growing right now (the active set). */
  growingTiles(): Iterable<TileData> {
    return this.growing.values();
  }

  tick(dt: number) {
    if (!this.growing.size) return;
    for (const t of [...this.growing.values()]) {
      if (t.ground !== 'growing') {
        this.growing.delete(t.id);
        continue;
      }
      t.growthRemainingSec -= dt;
      this.sim.grid.touch(t);
      if (t.growthRemainingSec <= 1e-6) this.complete(t, t.growSource ?? 'pulse');
    }
  }

  /**
   * Finalises a tile as restored. Used by growth completion and chain steps. Idempotent. `quiet`: offline drone
   * work (Phase 4 E01) restores the tile and pays its yield but sets off no chain.
   */
  complete(t: TileData, source: RestoreSource, chainId?: number, quiet = false): number {
    if (t.ground === 'restored') return chainId ?? -1;
    this.chainPlantOn(t, chainId);
    // Look 6: a tile that grew already plays its restore; one restored straight from dead ground starts it now.
    if (t.ground !== 'growing' || t.tr?.k !== 'restore') this.sim.transitions.restore(t, source, t.ground === 'polluted' ? t.pollution : 0, { quiet });
    this.growing.delete(t.id);
    t.ground = 'restored';
    t.bloom = Math.max(1, t.bloom, this.plantDef(t).bloom); // E23.2.2: a meadow flowers at once, a grove in full
    t.pollution = 0;
    t.growthRemainingSec = 0;
    t.growSource = undefined;
    if (source === 'overflow') this.sim.transitions.lush(t, this.sim.time + TUNING.neighbourhood.reservoir.lushSeconds);
    this.sim.grid.touch(t);
    this.sim.state.stats.tilesRestored++;
    const biomass = this.sim.econ.add('biomass', TUNING.restore.instantBiomass * this.sim.upgrades.soilMult * this.plantDef(t).biomass);
    if (biomass.gt(0)) this.sim.bus.emit('resource.gain', { kind: 'biomass', amount: biomass, tileId: t.id });
    // Life seeps outward: neighbours soften from concrete into moss.
    for (const nb of this.sim.grid.neighbors(t)) {
      if (nb.ground !== 'polluted' || nb.blocked) continue;
      const before = nb.pollution;
      nb.pollution = Math.max(0, nb.pollution - TUNING.restore.seep);
      this.sim.grid.touch(nb);
      if (nb.pollution <= 0) {
        nb.ground = 'prepared';
        this.sim.transitions.moss(nb, before, t);
        this.sim.bus.emit('tile.prepared', { tile: nb });
      } else {
        this.sim.transitions.soften(nb, before, t);
        this.sim.bus.emit('tile.softened', { tile: nb });
      }
    }
    // E21.9: bloombot's own pulses count toward its share of an Old City region
    if (source === 'pulse' || source === 'broad' || source === 'mega') this.sim.areas.countBot(t);
    this.sim.areas.onRestored(t);
    if (quiet) {
      this.sim.bus.emit('tile.restored', { tile: t, source, chainId: -1, biomass });
      return -1;
    }
    const id = this.sim.chains.onRestored(t, source, chainId);
    if (t.plant && id >= 0 && (source === 'pulse' || source === 'broad')) this.rememberChainPlant(id, t.plant);
    this.sim.chains.addReward(id, biomass);
    this.sim.bus.emit('tile.restored', { tile: t, source, chainId: id, biomass });
    if (source === 'cultivator') this.sim.cultivators.onRestored(t);
    return id;
  }
}
