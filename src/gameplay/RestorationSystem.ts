import { formatCost } from '../core/Economy';
import { distToFootprint } from '../core/Grid';
import type { Cost, RestoreSource, TileData } from '../core/types';
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
    if (t.ground === 'restored') {
      const n = TUNING.restore.nurture[Math.min(TUNING.restore.maxBloom, t.bloom + 1)];
      return { energy: Math.round(n.energy * this.sim.upgrades.pulseEnergyMult * 100) / 100, water: n.water };
    }
    const base = t.ground === 'prepared' ? TUNING.pulse.prepared : TUNING.pulse.polluted;
    return { energy: Math.round(base.energy * this.sim.upgrades.pulseEnergyMult * 100) / 100, water: base.water };
  }

  /** Can this tile be turned into a restoration target at all (ignoring cost)? */
  isEligible(t: TileData, allowPolluted = true): boolean {
    const roof = this.sim.grid.roof(t.roofId);
    if (!roof || !roof.unlocked || roof.preview) return false;
    if (t.blocked || this.sim.isCoreTile(t)) return false;
    if (t.ground === 'restored' || t.ground === 'growing') return false;
    if (t.ground === 'polluted' && !allowPolluted) return false;
    if (this.sim.drones.isReserved(t.id)) return false;
    return true;
  }

  checkPulse(t: TileData): PulseCheck {
    const cost = this.pulseCost(t);
    const roof = this.sim.grid.roof(t.roofId);
    if (!roof || !roof.unlocked || roof.preview) return { ok: false, reason: 'This rooftop is not reachable yet', cost };
    if (t.blocked) return { ok: false, reason: 'A rusty vent — nothing grows here', cost };
    if (this.sim.isCoreTile(t)) return { ok: false, reason: 'The Rooftop Core — awaken it when it is ready', cost };
    if (t.ground === 'restored' && t.bloom >= TUNING.restore.maxBloom) return { ok: false, reason: 'Already in full bloom', cost };
    if (t.ground === 'growing') return { ok: false, reason: 'Already growing', cost };
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
      this.sim.bus.emit('action.failed', { reason: chk.reason!, tileId });
      return false;
    }
    this.sim.econ.spend(chk.cost);
    if (t.ground === 'restored') {
      this.grow(t);
      this.boostNeighbours(t);
      this.sim.bus.emit('pulse.fired', { tileId, extra: [], overcharged: false });
      return true;
    }
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
    const radius = overcharged ? 2 : this.sim.upgrades.broadExtra >= 3 ? 2 : this.sim.upgrades.broadExtra > 0 ? 1 : 0;
    const limit = overcharged || this.sim.upgrades.broadExtra >= 2 ? Infinity : 2;
    if (radius > 0) {
      const roof = this.sim.grid.roof(t.roofId)!;
      const cands = roof.tiles
        .map((nb) => ({ nb, d: Math.abs(nb.x - t.x) + Math.abs(nb.z - t.z) }))
        .filter(({ nb, d }) => d >= 1 && d <= radius && this.isEligible(nb))
        .sort((a, b) => a.d - b.d || a.nb.pollution - b.nb.pollution || a.nb.id.localeCompare(b.nb.id));
      for (const { nb, d } of cands.slice(0, limit)) {
        this.beginGrowth(nb, 'broad', TUNING.pulse.growSeconds + 0.12 * d + 0.03 * extra.length);
        extra.push(nb.id);
      }
    }
    this.sim.bus.emit('pulse.fired', { tileId, extra, overcharged });
    return true;
  }

  /**
   * Overcharge Pulse: a manual pulse right next to a machine boosts its next trigger
   * (+1 target, or more output for a solar burst). Automation never does this; only your taps.
   */
  boostNeighbours(t: TileData) {
    const s = this.sim;
    for (const m of s.state.machines) {
      if (m.roofId !== t.roofId || m.type === 'droneHub' || (m.type === 'core' && m.roofId !== 'r3')) continue;
      if (distToFootprint(t.x, t.z, m.x, m.z, m.size) !== 1) continue;
      const fresh = (m.overchargeUntil ?? 0) <= s.time;
      m.overchargeUntil = s.time + TUNING.neighbourhood.overchargeSeconds;
      if (fresh) s.bus.emit('machine.boosted', { machineId: m.id });
    }
  }

  /** Grows an already-restored tile one bloom level (grass → flowers → shrubs). Can start or continue a chain. */
  grow(t: TileData, chainId?: number) {
    if (t.ground !== 'restored' || t.bloom >= TUNING.restore.maxBloom) return;
    t.bloom = Math.min(TUNING.restore.maxBloom, t.bloom + 1);
    const b = this.sim.econ.add('biomass', TUNING.restore.nurtureBiomass * this.sim.upgrades.soilMult);
    if (b > 0) this.sim.bus.emit('resource.gain', { kind: 'biomass', amount: b, tileId: t.id });
    this.sim.production.markDirty();
    this.sim.bus.emit('tile.nurtured', { tile: t, level: t.bloom });
    const id = this.sim.chains.onGrown(t, chainId);
    this.sim.chains.addReward(id, b);
  }

  beginGrowth(t: TileData, source: RestoreSource, seconds: number) {
    t.ground = 'growing';
    t.pollution = 0;
    t.growthRemainingSec = seconds;
    t.growSource = source;
    this.sim.bus.emit('tile.restoring', { tile: t, source });
  }

  tick(dt: number) {
    for (const r of this.sim.state.rooftops) {
      for (const t of r.tiles) {
        if (t.ground !== 'growing') continue;
        t.growthRemainingSec -= dt;
        if (t.growthRemainingSec <= 1e-6) this.complete(t, t.growSource ?? 'pulse');
      }
    }
  }

  /** Finalises a tile as restored. Used by growth completion and chain steps. Idempotent. */
  complete(t: TileData, source: RestoreSource, chainId?: number): number {
    if (t.ground === 'restored') return chainId ?? -1;
    t.ground = 'restored';
    t.bloom = Math.max(1, t.bloom);
    t.pollution = 0;
    t.growthRemainingSec = 0;
    t.growSource = undefined;
    if (source === 'overflow') t.lushUntil = this.sim.time + TUNING.neighbourhood.reservoir.lushSeconds;
    this.sim.state.stats.tilesRestored++;
    const biomass = this.sim.econ.add('biomass', TUNING.restore.instantBiomass * this.sim.upgrades.soilMult);
    if (biomass > 0) this.sim.bus.emit('resource.gain', { kind: 'biomass', amount: biomass, tileId: t.id });
    // Life seeps outward: neighbours soften from concrete into moss.
    for (const nb of this.sim.grid.neighbors(t)) {
      if (nb.ground !== 'polluted' || nb.blocked) continue;
      nb.pollution = Math.max(0, nb.pollution - TUNING.restore.seep);
      if (nb.pollution <= 0) {
        nb.ground = 'prepared';
        this.sim.bus.emit('tile.prepared', { tile: nb });
      } else this.sim.bus.emit('tile.softened', { tile: nb });
    }
    this.sim.production.markDirty();
    const id = this.sim.chains.onRestored(t, source, chainId);
    this.sim.chains.addReward(id, biomass);
    this.sim.bus.emit('tile.restored', { tile: t, source, chainId: id, biomass });
    return id;
  }
}
