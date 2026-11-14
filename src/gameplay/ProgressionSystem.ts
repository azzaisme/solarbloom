import { PARK } from '../core/Areas';
import { isRestorable } from '../core/GameState';
import type { BuildableType, TileData } from '../core/types';
import { MACHINES } from '../data/machines';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

/** The player's starting area (the park in the city). */
export const HOME = 'home';

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

  /** The starting area is the park (the fixed rooftop campaign is gone, City 12.4). */
  get homeIsPark(): boolean {
    return true;
  }

  /**
   * Tiles of a place: `'home'`, a layer id (a rooftop) or a city area id. Everything that used to mean
   * "the Seed rooftop" asks for 'home'.
   */
  tilesFor(id: string): TileData[] {
    if (id === HOME) return this.sim.areas.tiles(PARK);
    if (this.sim.grid.layer(id)) return this.sim.grid.tilesOf(id);
    return this.sim.areas.tiles(id);
  }

  restoredCount(id: string): number {
    return this.tilesFor(id).filter((t) => t.ground === 'restored' && isRestorable(t, this.sim.state.machines)).length;
  }

  fullBloomCount(id: string): number {
    return this.tilesFor(id).filter((t) => t.ground === 'restored' && t.bloom >= TUNING.restore.maxBloom).length;
  }

  restorableCount(id: string): number {
    return this.tilesFor(id).filter((t) => isRestorable(t, this.sim.state.machines)).length;
  }

  /** Core requirement sizes for the home (the park is bigger than the old Seed rooftop). */
  private goals() {
    return this.homeIsPark ? TUNING.park : TUNING.core;
  }

  built(type: BuildableType) {
    return this.sim.state.machines.some((m) => m.type === type && !m.starter);
  }

  requirements(): Requirement[] {
    const n = this.restoredCount(HOME);
    const g = this.goals();
    const full = this.fullBloomCount(HOME);
    return [
      { label: `Restore tiles ${Math.min(n, g.restoredTiles)}/${g.restoredTiles}`, done: n >= g.restoredTiles },
      { label: `Grow full-bloom tiles ${Math.min(full, g.fullBloomTiles)}/${g.fullBloomTiles}`, done: full >= g.fullBloomTiles },
      { label: `Build a ${MACHINES.solar.name}`, done: this.built('solar') },
      { label: `Build a ${MACHINES.condenser.name}`, done: this.built('condenser') },
      { label: `Build a ${MACHINES.pollinator.name}`, done: this.built('pollinator') },
      { label: `Build a ${MACHINES.droneHub.name}`, done: this.built('droneHub') },
      { label: `Plant a ${MACHINES.motherTree.name}`, done: this.built('motherTree') },
    ];
  }

  /**
   * City 05.2: the park's look, 0 (dilapidated) to 4 (fountain awake): 1 at 25% of the restoration goal (paths
   * swept), 2 at 50% (benches repaired), 3 at 75% (lamps relit, trees leaf out, bunting). Presentation only.
   */
  parkStage(): number {
    if (!this.homeIsPark) return 0;
    if (this.sim.state.progression.coreActivated) return 4;
    const k = this.sim.areas.counts(PARK).restored / TUNING.park.restoredTiles;
    return Math.min(3, Math.floor(k * 4 + 1e-9));
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
    // Waking the park's fountain clears the park's fog and reveals the first ring of areas.
    s.areas.clear(PARK, true);
    s.production.markDirty();
    s.bus.emit('rooftop.coreRestored', {});
    return true;
  }

  private computeStep(): number {
    const s = this.sim.state;
    if (s.progression.coreActivated) return 9; // before any scan: after the fountain this runs every tick for nothing
    const has = (t: BuildableType) => this.built(t);
    const n = this.restoredCount(HOME);
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
