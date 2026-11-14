import { createInitialState, GROUND, placeFixed } from '../src/core/GameState';
import type { GroundState, LayerData } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';

/**
 * Mechanics tests run on a small bounded test layer (`PAD`, 8×8, laid out like the Seed rooftop template:
 * vents at (7,0) and (0,7), a few mossy tiles, a Core in the corner and an old solar panel), standing in a
 * normal city far from the park, so its tiles never touch the city's fog or areas.
 */
export const PAD = 'r1';

export function makeSim(seed = 1234) {
  const state = createInitialState(seed);
  const pad: LayerData = { id: PAD, name: 'Test pad', kind: 'raised', width: 8, depth: 8, height: 0, origin: [-200, 0, -200], unlocked: true, preview: false, template: 'seed' };
  state.layers.push(pad);
  placeFixed(state, PAD, 'core', 0, 0, 2);
  placeFixed(state, PAD, 'solar', 3, 1, 1, true);
  return new Sim(state);
}

export function rich(sim: Sim) {
  const s = sim.state;
  s.caps.energy = s.caps.water = s.caps.biomass = 10000;
  s.resources.energy = s.resources.water = s.resources.biomass = 5000;
}

export function setGround(sim: Sim, x: number, z: number, g: GroundState, roof = PAD) {
  const t = sim.grid.get(roof, x, z)!;
  t.ground = g;
  t.pollution = g === 'polluted' ? 100 : 0;
  t.bloom = g === 'restored' ? Math.max(1, t.bloom) : 0;
  sim.grid.touch(t);
  sim.production.markDirty();
  return t;
}

/** Fills a rectangle of the test pad with a ground state. */
export function fill(sim: Sim, x0: number, z0: number, x1: number, z1: number, g: GroundState) {
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const t = sim.grid.get(PAD, x, z)!;
      if (t.blocked || sim.isCoreTile(t)) continue;
      setGround(sim, x, z, g);
    }
}

/** Sets a tile's ground on any layer. */
export function ground(sim: Sim, roof: string, x: number, z: number, g: GroundState) {
  return setGround(sim, x, z, g, roof);
}

export { GROUND };
