import { isRestorable } from '../core/GameState';
import type { BuildableType } from '../core/types';
import { MACHINES } from '../data/machines';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

export interface Requirement {
  label: string;
  done: boolean;
}

export const TUTORIAL: string[] = [
  'Tap a grey tile to bring it back to life.',
  'Restored tiles grow Biomass 🌿. Pulse a green tile again to nurture it into flowers.',
  'Spend Biomass on an upgrade — open Upgrades (U).',
  'Build a Water Condenser (4) on living ground for steady water.',
  'Plants and machines make each other stronger. Build a Pollinator Garden (5).',
  'Pulse mossy tiles inside the garden’s zone to set off a Bloom Chain.',
  'Build a Drone Hub (6). Your drone can handle the small jobs now.',
  'Restore 42 tiles, grow 24 to full bloom, build every machine and plant a Mother Tree to wake the Rooftop Core.',
  'The Core is ready! Click it to awaken the building.',
  'The building lives again. Rooftop 2 awaits across the bridge…',
];

/** Machines the Seed's Core asks for (Round 2 rules; later specialty pieces are not required). */
export const SEED_CORE_MACHINES: BuildableType[] = ['solar', 'condenser', 'pollinator', 'droneHub', 'motherTree'];

export class ProgressionSystem {
  private readyAnnounced = false;

  constructor(private sim: Sim) {}

  restoredCount(roofId: string): number {
    const r = this.sim.grid.roof(roofId);
    if (!r) return 0;
    return r.tiles.filter((t) => t.ground === 'restored' && isRestorable(t, this.sim.state.machines)).length;
  }

  fullBloomCount(roofId: string): number {
    const r = this.sim.grid.roof(roofId);
    return r ? r.tiles.filter((t) => t.ground === 'restored' && t.bloom >= TUNING.restore.maxBloom).length : 0;
  }

  restorableCount(roofId: string): number {
    const r = this.sim.grid.roof(roofId);
    if (!r) return 0;
    return r.tiles.filter((t) => isRestorable(t, this.sim.state.machines)).length;
  }

  built(type: BuildableType) {
    return this.sim.state.machines.some((m) => m.type === type && !m.starter);
  }

  requirements(): Requirement[] {
    const n = this.restoredCount('r1');
    return [
      { label: `Restore tiles ${Math.min(n, TUNING.core.restoredTiles)}/${TUNING.core.restoredTiles}`, done: n >= TUNING.core.restoredTiles },
      { label: `Grow full-bloom tiles ${Math.min(this.fullBloomCount('r1'), TUNING.core.fullBloomTiles)}/${TUNING.core.fullBloomTiles}`, done: this.fullBloomCount('r1') >= TUNING.core.fullBloomTiles },
      { label: `Build a ${MACHINES.solar.name}`, done: this.built('solar') },
      { label: `Build a ${MACHINES.condenser.name}`, done: this.built('condenser') },
      { label: `Build a ${MACHINES.pollinator.name}`, done: this.built('pollinator') },
      { label: `Build a ${MACHINES.droneHub.name}`, done: this.built('droneHub') },
      { label: `Plant a ${MACHINES.motherTree.name}`, done: this.built('motherTree') },
    ];
  }

  coreReady(): boolean {
    return !this.sim.state.progression.coreActivated && this.requirements().every((r) => r.done);
  }

  activateCore(): boolean {
    const s = this.sim;
    const p = s.state.progression;
    if (p.coreActivated) return false;
    if (!this.coreReady()) {
      s.bus.emit('action.failed', { reason: 'The Core is still dormant — check the objective list' });
      return false;
    }
    if (!s.econ.spend(TUNING.core.cost)) {
      s.bus.emit('action.failed', { reason: `Awakening needs ${TUNING.core.cost.energy}⚡ and ${TUNING.core.cost.biomass}🌿` });
      return false;
    }
    p.coreActivated = true;
    p.coreActivatedAt = s.time;
    p.cores = { ...p.cores, r1: true };
    const r2 = s.grid.roof('r2');
    if (r2) r2.unlocked = true; // revealed; playable once the Skybridge Relay is built
    s.production.markDirty();
    s.bus.emit('rooftop.coreRestored', {});
    return true;
  }

  private computeStep(): number {
    const s = this.sim.state;
    const has = (t: BuildableType) => this.built(t);
    const n = this.restoredCount('r1');
    if (s.progression.coreActivated) return 9;
    if (this.coreReady()) return 8;
    if (has('droneHub')) return 7;
    if (has('pollinator') && s.stats.maxCombo >= 3) return 6;
    if (has('pollinator')) return 5;
    if (has('condenser')) return 4;
    if (Object.keys(s.upgrades).length > 0 || n >= 15) return 3;
    if (n >= 4) return 2;
    if (n >= 1) return 1;
    return 0;
  }

  tick() {
    const p = this.sim.state.progression;
    const step = this.computeStep();
    if (step !== p.tutorialStep) {
      p.tutorialStep = step;
      this.sim.bus.emit('tutorial.step', { step });
    }
    if (this.coreReady() && !this.readyAnnounced) {
      this.readyAnnounced = true;
      this.sim.bus.emit('rooftop.coreReady', {});
    }
  }
}
