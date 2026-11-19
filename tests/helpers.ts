import { big } from '../src/core/Big';
import { createInitialState, GROUND, placeFixed } from '../src/core/GameState';
import type { GroundState, LayerData } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';
import { MATERIAL_IDS, TIERS } from '../src/data/salvage';
import { PARK } from '../src/core/Areas';
import { REGIONS } from '../src/data/oldcity';
import type { MachineData } from '../src/core/types';

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
  s.caps.energy = big(10000); s.caps.water = big(10000);
  s.resources.energy = big(5000); s.resources.water = big(5000); s.resources.biomass = big(5000);
  unlockAll(sim);
}

/**
 * E23.1.1: every game plays by the Old City's rules, where a machine unlocks at its fountain tier and is paid with
 * its recipe. Mechanics tests open every buildable tier (4: tier 5 is the Great Bloom) and fill the backpack, so a
 * placement only fails for the reason a test is about.
 */
export function unlockAll(sim: Sim, plenty = 9999) {
  const sv = sim.state.salvage!;
  sv.tier = Math.max(sv.tier, 4);
  for (const t of TIERS.slice(0, 4)) if (t.ability && !sv.abilities.includes(t.ability)) sv.abilities.push(t.ability);
  for (const m of MATERIAL_IDS) sv.pack[m] = plenty;
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

/**
 * E23.1.1: the whole island open, for tests about the world at scale (chains, drones, walking): every ability, the
 * fountain awake, every region's gate open and its landmark woken. The Old City is one fixed world, so the places
 * below are the same in every game.
 */
export function openIsland(sim: Sim): Sim {
  unlockAll(sim);
  sim.state.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  for (const r of REGIONS) {
    sim.gates.open(r.gate.id, true);
    if (sim.areas.fog(r.id) !== 'hidden') sim.areas.clear(r.id, true);
  }
  return sim;
}

/** A street garden (a Pollinator on paving), inserted directly: these tests measure chains, not building. */
export function streetGarden(sim: Sim, x: number, z: number, street = true): MachineData {
  const t = sim.grid.get(GROUND, x, z)!;
  t.blocked = false;
  if (street) t.feature = 'paving';
  const m: MachineData = { id: sim.newId('m'), type: 'pollinator', roofId: GROUND, x, z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  t.occupantId = m.id;
  return m;
}

/**
 * The island's longest crossing: row z = -30 runs x -80…79 through eight areas (Glasshouse Row, the Mast Row and
 * six backstreets) and column x = 34 runs z -96…79 through six more (the Old Market, the Cistern, the Observatory
 * and three backstreets). `streetCross` lines both with street gardens five tiles apart; a pulse at `start` sets
 * the chain off at the row's west end.
 */
export const CROSS = { row: -30, col: 34, start: [-80, -30] as const };

export function streetCross(sim: Sim) {
  for (let x = -78; x <= 79; x += 5) streetGarden(sim, x, CROSS.row);
  for (let z = -95; z <= 79; z += 5) if (z !== CROSS.row) streetGarden(sim, CROSS.col, z);
}
