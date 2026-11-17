import { big } from '../core/Big';
import { createInitialState, GROUND } from '../core/GameState';
import { PARK } from '../core/Areas';
import { Sim } from '../gameplay/Sim';
import type { Game } from './Game';
import type { FaceName } from '../rendering/DroneVisuals';
import type { CatVariant, TransitionKind, WorldEventType } from '../core/types';
import { TUNING } from '../data/tuning';
import { WORLD_EVENTS } from '../gameplay/WorldEventSystem';
import { roadPlanFor } from '../core/RoadPlan';
import { drawRoadOverview } from './RoadDebug';

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
 *   sbDev.tr.scrub(x, z, 0.4)  freeze ground tile (x, z)'s transition at 40 % (sbDev.tr.scrub() releases it)
 *   sbDev.tr.play(x, z, 'restore') start a transition on a ground tile (soften, moss, restore, bloom, unblock)
 *   sbDev.tr.speed(4)          every transition plays 4× slower (1 = normal), for tuning
 *   sbDev.tr.stats()           tiles mid-transition (sim) and drawn as transitions (renderer)
 *   sbDev.plots()              E19.1: fill every revealed plot (sbDev.plots('cafe') one option, sbDev.plots(null) clears)
 *   sbDev.roads(12)            toggle the City 16 road-network overview, 12 chunks round the camera
 *   sbDev.water(14)            restore the water tiles within 14 tiles of the view (to hear the 3D brook)
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
    /** 3D audio: restore the water tiles around the view, so the brook has clean water to sit at. */
    water(r = 14) {
      const f = game.camera.target;
      let n = 0;
      for (let z = Math.floor(f.z - r); z <= f.z + r; z++) {
        for (let x = Math.floor(f.x - r); x <= f.x + r; x++) {
          const t = game.sim.grid.get(GROUND, x, z);
          if (!t || t.blocked || t.feature !== 'water' || t.ground === 'restored') continue;
          t.ground = 'restored';
          game.chunks.markTile(t);
          n++;
        }
      }
      return `${n} water tiles restored around ${f.x.toFixed(1)}, ${f.z.toFixed(1)}`;
    },
    overflow() {
      return game.sim.log.overflow;
    },
    /** Look 6.12: the transition scrubber and time-scale. */
    tr: {
      scrub(x?: number, z?: number, p = 0.5) {
        const r = game.transitions;
        r.scrub = x === undefined || z === undefined ? undefined : { x, z, p: Math.max(0, Math.min(1, p)) };
        const t = x === undefined || z === undefined ? undefined : game.sim.grid.get(GROUND, x, z);
        if (t) game.chunks.markTile(t);
        return r.scrub ? `tile ${x},${z} frozen at ${Math.round(r.scrub.p * 100)}% (${t?.tr?.k ?? 'no transition: try sbDev.tr.play'})` : 'released';
      },
      play(x: number, z: number, kind: TransitionKind = 'restore') {
        const sim = game.sim;
        const t = sim.grid.get(GROUND, x, z);
        if (!t) return 'no tile there';
        const T = TUNING.transitions;
        const d = kind === 'soften' ? T.soften : kind === 'moss' ? T.moss : kind === 'bloom' ? T.bloom[Math.max(2, t.bloom)] : kind === 'unblock' ? T.unblock : T.restore.pulse;
        sim.transitions.begin(t, kind, d, { from: kind === 'bloom' ? Math.max(1, t.bloom - 1) : kind === 'restore' ? 100 : 100, dir: sim.transitions.livingEdge(t) });
        game.chunks.markTile(t);
        return `${kind} on ${x},${z} for ${d}s`;
      },
      speed(scale = 1) {
        game.transitions.durScale = Math.max(0.05, scale);
        game.chunks.markAll();
        return `transitions play at 1/${scale} speed`;
      },
      stats() {
        let drawn = 0;
        for (const n of game.transitions.liveByChunk.values()) drawn += n;
        return { sim: game.sim.transitions.liveCount, drawn, time: game.transitions.time };
      },
    },
    /**
     * City 16.8: toggle a road-network overview over the game (road tiles by tier, arterials, the parent tree to the
     * park, extra links, gates), centred on the camera's chunk. Ground generation 4+ only.
     */
    roads(radius = 12) {
      const old = document.getElementById('sb-road-debug');
      if (old) return void old.remove(), 'road overview hidden';
      const gen = game.sim.grid.layer(GROUND)?.gen ?? 1;
      if (gen < 4) return `this save is ground generation ${gen}: roads are the old row/column lattice`;
      const canvas = document.createElement('canvas');
      canvas.id = 'sb-road-debug';
      canvas.style.cssText = 'position:fixed;inset:8px;z-index:9999;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);margin:auto;border:2px solid #222;background:#000;image-rendering:pixelated;cursor:pointer';
      canvas.title = 'City 16 road overview: click to close';
      canvas.onclick = () => canvas.remove();
      const t = game.camera.target;
      drawRoadOverview(canvas.getContext('2d')!, roadPlanFor(game.sim.state.seed, gen), Math.floor(t.x / 16), Math.floor(t.z / 16), radius);
      document.body.appendChild(canvas);
      return 'road overview shown (click it, or call sbDev.roads() again, to close)';
    },
    /** E19.1: restore and fill every plot in the revealed city (round-robin, or one option id); null clears them. */
    plots(only?: string | null) {
      return `${game.fillPlots(only)} plots set`;
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
