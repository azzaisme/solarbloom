import { TIERS } from '../data/salvage';
import { PARK } from '../core/Areas';
import { isRestorable } from '../core/GameState';
import type { BuildableType, TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';
import { oldCityStep } from '../ui/OldCityGuide';


/** Fountain tier 1's park tiles: the park's art stages count toward it. */
const PARK_GOAL = TIERS[0].needs.parkTiles ?? 60;

/** The player's starting area (the park in the city). */
export const HOME = 'home';

export class ProgressionSystem {
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
    return this.tilesFor(id).filter((t) => t.ground === 'restored' && t.bloom >= TUNING.restore.fullBloom).length;
  }

  restorableCount(id: string): number {
    return this.tilesFor(id).filter((t) => isRestorable(t, this.sim.state.machines)).length;
  }

  built(type: BuildableType) {
    return this.sim.state.machines.some((m) => m.type === type && !m.starter);
  }

  /**
   * City 05.2: the park's look, 0 (dilapidated) to 4 (fountain awake): 1 at 25% of the restoration goal (paths
   * swept), 2 at 50% (benches repaired), 3 at 75% (lamps relit, trees leaf out, bunting). Presentation only.
   */
  parkStage(): number {
    // E21.6: the park cheers up toward fountain tier 1's park tiles, and is awake from tier 1
    if ((this.sim.state.salvage.tier ?? 0) >= 1) return 4;
    return Math.min(3, Math.floor((this.sim.areas.counts(PARK).restored / PARK_GOAL) * 4 + 1e-9));
  }

  private computeStep(): number {
    // E21.12: the first fifteen minutes, one step at a time (a step already done shows for a moment)
    return Math.min(this.sim.state.progression.tutorialStep + 1, oldCityStep(this.sim));
  }

  tick() {
    const p = this.sim.state.progression;
    const step = this.computeStep();
    if (step !== p.tutorialStep) {
      p.tutorialStep = step;
      this.sim.bus.emit('tutorial.step', { step });
    }
  }
}
