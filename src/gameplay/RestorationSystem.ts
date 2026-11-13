import { formatCost } from '../core/Economy';
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
    if (t.ground === 'restored') return { ok: false, reason: 'Already in full bloom', cost };
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
    this.beginGrowth(t, 'pulse', TUNING.pulse.growSeconds);
    const extra: string[] = [];
    const n = this.sim.upgrades.broadExtra;
    if (n > 0) {
      const cands = this.sim.grid
        .neighbors(t)
        .filter((nb) => this.isEligible(nb))
        .sort((a, b) => a.pollution - b.pollution || a.id.localeCompare(b.id));
      for (const nb of cands.slice(0, n)) {
        this.beginGrowth(nb, 'broad', TUNING.pulse.growSeconds + 0.15 * (extra.length + 1));
        extra.push(nb.id);
      }
    }
    this.sim.bus.emit('pulse.fired', { tileId, extra });
    return true;
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
    t.pollution = 0;
    t.growthRemainingSec = 0;
    t.growSource = undefined;
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
      }
    }
    this.sim.production.markDirty();
    const id = this.sim.chains.onRestored(t, source, chainId);
    this.sim.bus.emit('tile.restored', { tile: t, source, chainId: id, biomass });
    return id;
  }
}
