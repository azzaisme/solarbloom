import { big } from '../core/Big';
import { createInitialState, GROUND } from '../core/GameState';
import { PARK } from '../core/Areas';
import { Sim } from '../gameplay/Sim';
import type { Game } from './Game';
import type { FaceName } from '../rendering/DroneVisuals';
import type { CatVariant, WorldEventType } from '../core/types';
import { WORLD_EVENTS } from '../gameplay/WorldEventSystem';

/**
 * Phase 4 E00.5: debug helpers for repeatable testing. Loaded only by the Vite dev server
 * (`import.meta.env.DEV`), so none of this ships in a production build. Use from the browser console:
 *
 *   sbDev.reset(42)            fresh game with seed 42 (reloads)
 *   sbDev.preset('screenshot') a fresh park in the Phase 4 screenshot's economy (reloads)
 *   sbDev.simulate(120)        run 120 s of simulation now (accelerated)
 *   sbDev.log()                the local event log (sim time, event, small numbers)
 *   sbDev.overflow()           income lost to full storage so far
 *   sbDev.event('supernova')   start a world event now: supernova, migration, rain, invasion (Phase 5 E15)
 *   sbDev.cat('golden')        hide a cat now (standard, golden or rainbow) somewhere in view
 *   sbDev.face('excited')      show one drone expression on every drone (no argument: back to normal)
 */
export type PresetName = 'fresh' | 'screenshot' | 'rich' | 'wealthy';

export const PRESETS: Record<PresetName, string> = {
  fresh: 'A brand-new park.',
  screenshot: 'The Phase 4 screenshot: 19 park tiles restored, energy 60/60, water 40/40, biomass 24/100.',
  rich: 'A fresh park with large stores, for testing builds and upgrades.',
  wealthy: 'A fresh park with 1e15 biomass: for checking big-number display and long-tail upgrades.',
};

/** Builds a preset's starting state headlessly (also used by tests). */
export function presetSim(name: PresetName, seed: number): Sim {
  const sim = new Sim(createInitialState(seed));
  const s = sim.state;
  if (name === 'screenshot') {
    const [fx, fz] = sim.areas.info(PARK).landmark;
    const tiles = sim.areas
      .tiles(PARK)
      .filter((t) => sim.restoration.isEligible(t))
      .sort((a, b) => Math.abs(a.x - fx) + Math.abs(a.z - fz) - (Math.abs(b.x - fx) + Math.abs(b.z - fz)) || a.z - b.z || a.x - b.x);
    for (const t of tiles.slice(0, 19)) sim.restoration.complete(t, 'pulse');
    s.resources.energy = s.caps.energy;
    s.resources.water = s.caps.water;
    s.resources.biomass = big(24);
  } else if (name === 'rich') {
    s.caps.energy = big(5000);
    s.caps.water = big(5000);
    s.resources.energy = big(4000);
    s.resources.water = big(4000);
    s.resources.biomass = big(4000);
  } else if (name === 'wealthy') {
    s.resources.biomass = big('1e15');
  }
  void GROUND;
  return sim;
}

export function installDevTools(game: Game) {
  const api = {
    presets: PRESETS,
    get seed() {
      return game.sim.state.seed;
    },
    reset(seed = Math.floor(Math.random() * 1e9)) {
      api.preset('fresh', seed);
    },
    preset(name: PresetName, seed = game.sim.state.seed) {
      if (!PRESETS[name]) throw new Error(`Unknown preset. Try: ${Object.keys(PRESETS).join(', ')}`);
      const sim = presetSim(name, seed);
      (game as unknown as { resetting: boolean }).resetting = true; // stop autosave overwriting it
      game.saver.save(sim.state);
      location.reload();
    },
    simulate(seconds: number) {
      const t0 = performance.now();
      game.sim.advance(seconds);
      return `${seconds} s simulated in ${Math.round(performance.now() - t0)} ms`;
    },
    log() {
      return game.sim.log.entries;
    },
    /** Phase 5 E15: start a world event now (false while another runs). */
    event(type: WorldEventType) {
      if (!WORLD_EVENTS.includes(type)) throw new Error(`Unknown event. Try: ${WORLD_EVENTS.join(', ')}`);
      return game.sim.events.trigger(type);
    },
    /** Phase 5 E15: hide an extra cat of this rarity now (it behaves like an invasion cat). */
    cat(variant: CatVariant = 'standard') {
      const sim = game.sim;
      if (!sim.cat.invade(1)) return false;
      const spot = sim.state.cat.invasion![sim.state.cat.invasion!.length - 1];
      spot.variant = variant;
      game.cat.show(spot, true);
      return spot.id;
    },
    counts() {
      return game.sim.log.counts;
    },
    overflow() {
      return game.sim.log.overflow;
    },
    /** Drone redesign D03: preview an expression on every drone. */
    face(name?: FaceName) {
      game.drones.previewFace = name;
      return name ? `drones show "${name}"; sbDev.face() to go back` : 'drones show their normal faces';
    },
  };
  (window as unknown as { sbDev: typeof api }).sbDev = api;
  console.info('[solarbloom] dev tools: sbDev.reset(seed), sbDev.preset(name), sbDev.simulate(s), sbDev.log(), sbDev.face(name)');
}
