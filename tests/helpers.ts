import { createInitialState } from '../src/core/GameState';
import type { GroundState } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';
import { LINKS, type RoofLinkDef } from '../src/data/rooftops';

/**
 * Mechanics tests build bridges directly, so the bridges' full-bloom milestones are relaxed in files that
 * use these helpers (each test file has its own module graph). neighbourhood.test.ts restores and tests them;
 * the pacing tests don't import this file and play with the real milestones.
 */
export const MILESTONES: Record<string, RoofLinkDef['requiresFullBloom']> = Object.fromEntries(LINKS.map((l) => [l.id, l.requiresFullBloom]));
for (const l of LINKS) delete l.requiresFullBloom;

export function makeSim(seed = 1234) {
  return new Sim(createInitialState(seed, { rooftops: true }));
}

export function rich(sim: Sim) {
  const s = sim.state;
  s.caps.energy = s.caps.water = s.caps.biomass = 10000;
  s.resources.energy = s.resources.water = s.resources.biomass = 5000;
}

export function setGround(sim: Sim, x: number, z: number, g: GroundState, roof = 'r1') {
  const t = sim.grid.get(roof, x, z)!;
  t.ground = g;
  t.pollution = g === 'polluted' ? 100 : 0;
  t.bloom = g === 'restored' ? Math.max(1, t.bloom) : 0;
  sim.grid.touch(t);
  sim.production.markDirty();
  return t;
}

/** Fills a rectangle of tiles with a ground state. */
export function fill(sim: Sim, x0: number, z0: number, x1: number, z1: number, g: GroundState) {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const t = sim.grid.get('r1', x, z)!;
    if (t.blocked || sim.isCoreTile(t)) continue;
    setGround(sim, x, z, g);
  }
}

/** Skips the Round 2 game: the Seed's Core is awake (as if activated). */
export function awakenSeed(sim: Sim) {
  const p = sim.state.progression;
  p.coreActivated = true;
  p.coreActivatedAt = sim.time;
  p.cores = { ...p.cores, r1: true };
  sim.grid.roof('r2')!.unlocked = true;
  sim.production.markDirty();
}

/** Sets a tile's ground on any roof. */
export function ground(sim: Sim, roof: string, x: number, z: number, g: GroundState) {
  return setGround(sim, x, z, g, roof);
}
