import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, placeFixed } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';
import { regionById } from '../src/core/OldCityLayout';
import { upgradeHighlights } from '../src/gameplay/UpgradeEffects';

/** A game with one of every machine and cleared areas beyond the park. */
function world(rooftops: boolean) {
  const sim = new Sim(createInitialState(4));
  const st = sim.state;
  const roof = rooftops ? 'r1' : GROUND;
  let x = rooftops ? 0 : 2;
  for (const type of ['solar', 'condenser', 'pollinator', 'droneHub', 'droneHub', 'motherTree', ...(rooftops ? [] : ['relay', 'cultivator'])] as MachineData['type'][]) {
    const size = type === 'droneHub' || type === 'motherTree' ? 2 : 1;
    const m = placeFixed(st, roof, type, x, rooftops ? 5 : 2, size);
    sim.grid.indexMachine(m);
    x += size + (rooftops ? 0 : 1);
  }
  if (!rooftops) {
    st.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    sim.areas.clear(sim.areas.nextGoal()!, true);
    // E23.1.1: Saltwind (a beach) has no area bonus; the Elder Grove beyond its gate does
    sim.gates.open(regionById('elderGrove')!.gate.id, true);
    sim.areas.clear('elderGrove', true);
  } else {
    for (const l of Object.values(st.links ?? {})) l.built = true;
    st.links = { ...(st.links ?? {}), 'seed-reservoir': { built: true, builtAt: 0, readyAt: 0, crossings: 0 } };
  }
  return sim;
}

const best = (s: Sim, type: MachineData['type'], f: (m: MachineData) => number) => Math.max(0, ...s.machinesOfType(type).map(f));

/** What each upgrade changes, as a number to compare before and after buying it. */
const PROBES: Record<string, (s: Sim) => number> = {
  hover: (s) => s.state.upgrades.hover ?? 0, // E23.1.5: bloombot's sprint (also fountain tier 2's ability)
  broadPulse: (s) => s.upgrades.broadExtra,
  overcharge: (s) => s.upgrades.overchargeEvery,
  // Phase 5 E12: per-machine upgrades: the best level on any machine of the type.
  solarArray: (s) => best(s, 'solar', (m) => s.upgrades.solarMult(m)),
  droneSpeed: (s) => best(s, 'droneHub', (m) => s.upgrades.droneSpeed(m)),
  droneRadius: (s) => best(s, 'droneHub', (m) => s.upgrades.droneRadius(m)),
  chainIntel: (s) => best(s, 'droneHub', (m) => (s.upgrades.chainIntel(m) ? 1 : 0)),
  secondDrone: (s) => best(s, 'droneHub', (m) => s.upgrades.squad(m)),
  droneSweep: (s) => best(s, 'droneHub', (m) => s.upgrades.droneSweep(m)),
  pollinatorReach: (s) => best(s, 'pollinator', (m) => s.upgrades.pollinatorReach(m)),
  waterBloom: (s) => best(s, 'condenser', (m) => s.upgrades.waterBloom(m)),
  treeResonance: (s) => best(s, 'motherTree', (m) => s.upgrades.treeRadius(m)),
  chainHops: (s) => s.upgrades.pollinatorTriggers,
  corridorReach: (s) => s.upgrades.corridorRange,
  droneMesh: (s) => s.upgrades.networkRange,
  relayLens: (s) => best(s, 'relay', (m) => s.relays.range(m) + s.relays.targets(m)),
  fogLantern: (s) => s.upgrades.wakeNeedMult,
  // the Cultivator's own upgrades (per machine)
  cultSpeed: (s) => best(s, 'cultivator', (m) => s.cultivators.speed(m)),
  cultWidth: (s) => best(s, 'cultivator', (m) => s.cultivators.width(m)),
  cultSeed: (s) => best(s, 'cultivator', (m) => m.upg?.cultSeed ?? 0),
  cultRoute: (s) => best(s, 'cultivator', (m) => s.cultivators.radius(m)),
  cultSecond: (s) => best(s, 'cultivator', (m) => s.cultivators.unitsWanted(m)),
};

describe('upgrade tree for scale (City 09.4)', () => {
  for (const rooftops of [false]) {
    it(`${rooftops ? 'rooftops' : 'city'}: every upgrade changes what it says, and shows where in the world`, () => {
      const sim = world(rooftops);
      for (const def of sim.upgrades.all()) {
        const probe = PROBES[def.id];
        expect(probe, `${def.id} has a probe`).toBeDefined();
        const before = probe(sim);
        expect(sim.upgrades.grant(def.id), def.id).toBeGreaterThan(0);
        expect(probe(sim), def.id).not.toBe(before);
        expect(upgradeHighlights(sim, def.id).length, `${def.id} highlights`).toBeGreaterThan(0);
      }
    });
  }

});
