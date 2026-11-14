import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, placeFixed } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { upgradeHighlights } from '../src/gameplay/UpgradeEffects';

/** A game with one of every machine, a cleared area beyond the park and money to burn. */
function world(rooftops: boolean) {
  const sim = new Sim(createInitialState(4, rooftops ? { rooftops: true } : {}));
  const st = sim.state;
  st.caps.energy = st.caps.water = st.caps.biomass = 1e7;
  st.resources.energy = st.resources.water = st.resources.biomass = 1e6;
  const roof = rooftops ? 'r1' : GROUND;
  let x = rooftops ? 0 : 2;
  for (const type of ['solar', 'condenser', 'pollinator', 'droneHub', 'droneHub', 'motherTree'] as MachineData['type'][]) {
    const size = type === 'droneHub' || type === 'motherTree' ? 2 : 1;
    const m = placeFixed(st, roof, type, x, rooftops ? 5 : 2, size);
    sim.grid.indexMachine(m);
    x += size + (rooftops ? 0 : 1);
  }
  if (!rooftops) {
    st.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    sim.areas.clear(sim.areas.nextGoal()!, true);
  } else {
    for (const l of Object.values(st.links ?? {})) l.built = true;
    st.links = { ...(st.links ?? {}), 'seed-reservoir': { built: true, builtAt: 0, readyAt: 0, crossings: 0 } };
  }
  return sim;
}

/** What each upgrade changes, as a number to compare before and after buying it. */
const PROBES: Record<string, (s: Sim) => number> = {
  efficientPulse: (s) => s.upgrades.pulseEnergyMult,
  broadPulse: (s) => s.upgrades.broadExtra,
  overcharge: (s) => s.upgrades.overchargeEvery,
  solarArray: (s) => s.upgrades.solarMult,
  richSoil: (s) => s.upgrades.soilMult,
  seedVault: (s) => {
    // The caps it produces from the starting storage (the test world's caps are huge).
    const keep = { ...s.state.caps };
    Object.assign(s.state.caps, TUNING.start.caps);
    s.upgrades.applyCaps();
    const v = s.state.caps.biomass;
    Object.assign(s.state.caps, keep);
    return v;
  },
  droneSpeed: (s) => s.upgrades.droneFlyMult,
  droneRadius: (s) => s.upgrades.droneRadius,
  chainIntel: (s) => s.upgrades.level('chainIntel'),
  secondDrone: (s) => s.upgrades.level('secondDrone'),
  pollinatorReach: (s) => s.upgrades.pollinatorReach,
  waterBloom: (s) => s.upgrades.waterBloom,
  treeResonance: (s) => s.upgrades.treeRadius,
  relay2: (s) => s.hood.relayTargets(),
  droneDispatch: (s) => s.upgrades.level('droneDispatch'),
  corridorReach: (s) => s.upgrades.corridorRange,
  droneMesh: (s) => s.upgrades.networkRange,
  fogLantern: (s) => s.upgrades.wakeNeedMult,
  landmarkLights: (s) => s.areas.bonusIncome().biomass + s.areas.bonusIncome().energy + s.areas.bonusIncome().water,
};

describe('upgrade tree for scale (City 09.4)', () => {
  for (const rooftops of [false, true]) {
    it(`${rooftops ? 'rooftops' : 'city'}: every upgrade changes what it says, and shows where in the world`, () => {
      const sim = world(rooftops);
      for (const def of sim.upgrades.all()) {
        const probe = PROBES[def.id];
        expect(probe, `${def.id} has a probe`).toBeDefined();
        const st = sim.upgrades.status(def);
        expect(st.ok, `${def.id}: ${st.reason}`).toBe(true);
        const before = probe(sim);
        expect(sim.upgrades.purchase(def.id), def.id).toBe(true);
        expect(probe(sim), def.id).not.toBe(before);
        expect(upgradeHighlights(sim, def.id).length, `${def.id} highlights`).toBeGreaterThan(0);
      }
    });
  }

  it('no upgrade is locked behind something unrelated', () => {
    const sim = new Sim(createInitialState(5));
    for (const def of sim.upgrades.all()) {
      if (!def.lockedReason) continue;
      // The lock names the very thing the upgrade works on.
      const words = def.lockedReason.toLowerCase();
      const subject = def.describe(1).toLowerCase() + ' ' + def.name.toLowerCase();
      const related = ['drone', 'pollinator', 'garden', 'condenser', 'mother tree', 'landmark', 'fountain', 'bridge', 'hub'].some((w) => words.includes(w) && (subject.includes(w) || subject.includes(w.split(' ')[0])));
      expect(related || /fountain|landmark/.test(words), `${def.id}: "${def.lockedReason}" vs "${def.describe(1)}"`).toBe(true);
    }
  });
});
