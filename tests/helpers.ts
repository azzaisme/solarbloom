import { createInitialState } from '../src/core/GameState';
import type { GroundState } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';

export function makeSim(seed = 1234) {
  return new Sim(createInitialState(seed));
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
