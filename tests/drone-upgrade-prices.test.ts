import { describe, expect, it } from 'vitest';
import { big, toNum } from '../src/core/Big';
import type { Cost } from '../src/core/types';
import { UPGRADE_BY_ID } from '../src/data/upgrades';
import { TUNING } from '../src/data/tuning';
import type { Sim } from '../src/gameplay/Sim';
import { fill, makeSim, PAD, rich } from './helpers';

/** E18.7 (#207): drone upgrades priced by what they do (docs/DRONE_ROLES_EPIC.md 2.3). */
const DRONE_UPGRADES = ['droneSpeed', 'droneRadius', 'droneSweep', 'secondDrone', 'chainIntel', 'droneMesh'];

const n = (c: Cost) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, toNum(big(v!))]));

function setup() {
  const sim = makeSim();
  rich(sim);
  fill(sim, 0, 0, 7, 7, 'restored');
  const hub = sim.build.place('droneHub', PAD, 4, 4)!;
  const hub2 = sim.build.place('droneHub', PAD, 6, 1)!; // Drone Mesh needs two hubs
  return { sim, hub, hub2 };
}

const fillStores = (sim: Sim) => {
  sim.state.resources.energy = sim.state.caps.energy;
  sim.state.resources.water = sim.state.caps.water;
  sim.state.resources.biomass = big(1e12);
};

describe('E18.7: drone upgrades priced by what they do', () => {
  it('first levels cost the 2.3 prices', () => {
    const { sim, hub } = setup();
    const p = (id: string) => n(sim.upgrades.price(UPGRADE_BY_ID[id], UPGRADE_BY_ID[id].machine ? hub : undefined));
    expect(p('droneSpeed')).toEqual({ biomass: 25, energy: 10 });
    expect(p('droneRadius')).toEqual({ biomass: 28, energy: 10 });
    expect(p('droneSweep')).toEqual({ biomass: 85, energy: 8 }); // energy, not water: see docs/E18_AUDIT.md
    expect(p('secondDrone')).toEqual({ biomass: 70 }); // building drones is hardware: biomass only
    expect(p('chainIntel')).toEqual({ biomass: 30, energy: 15 });
    expect(p('droneMesh')).toEqual({ biomass: 140, energy: 25 });
    // Everything else keeps its old price.
    expect(p('efficientPulse')).toEqual({ biomass: UPGRADE_BY_ID.efficientPulse.baseCost });
  });

  it('each part grows by its own rate per level', () => {
    const { sim, hub } = setup();
    hub.upg = { droneSpeed: 2, droneSweep: 3 };
    expect(n(sim.upgrades.price(UPGRADE_BY_ID.droneSpeed, hub))).toEqual({ biomass: Math.ceil(25 * 1.65 ** 2), energy: Math.ceil(10 * 1.4 ** 2) });
    expect(n(sim.upgrades.price(UPGRADE_BY_ID.droneSweep, hub))).toEqual({ biomass: Math.ceil(85 * 2 ** 3), energy: Math.ceil(8 * 1.4 ** 3) });
  });

  it('a purchase pays every part at once, or nothing; the short part is named', () => {
    const { sim, hub } = setup();
    sim.state.resources.energy = big(5);
    const before = { e: toNum(sim.state.resources.energy), b: toNum(sim.state.resources.biomass) };
    const st = sim.upgrades.status(UPGRADE_BY_ID.droneSpeed, hub);
    expect(st.ok).toBe(false);
    expect(st.reason).toBe('Need 10 ⚡');
    expect(sim.upgrades.purchase('droneSpeed', hub.id)).toBe(false);
    expect({ e: toNum(sim.state.resources.energy), b: toNum(sim.state.resources.biomass) }).toEqual(before);
    expect(sim.upgrades.levelOf(hub, 'droneSpeed')).toBe(0);
    sim.state.resources.energy = big(100);
    expect(sim.upgrades.purchase('droneSpeed', hub.id)).toBe(true);
    expect(toNum(sim.state.resources.energy)).toBe(90);
    expect(toNum(sim.state.resources.biomass)).toBe(before.b - 25);
  });

  it('every drone upgrade can be bought at every level at every Seed Vault tier (no impossible price)', () => {
    const vault = UPGRADE_BY_ID.seedVault;
    for (let tier = 0; tier <= vault.maxLevel; tier++) {
      const { sim, hub } = setup();
      sim.state.upgrades.seedVault = tier;
      sim.upgrades.applyCaps();
      for (const id of DRONE_UPGRADES) {
        const def = UPGRADE_BY_ID[id];
        const target = def.machine ? hub : undefined;
        const max = Number.isFinite(def.maxLevel) ? def.maxLevel : 30;
        for (let lvl = 0; lvl < max; lvl++) {
          const price = sim.upgrades.price(def, target);
          for (const k of ['energy', 'water'] as const)
            if (price[k] !== undefined) expect(toNum(big(price[k]!)), `${id} L${lvl} tier ${tier} ${k}`).toBeLessThanOrEqual(toNum(sim.state.caps[k]) * TUNING.machineCostMaxShare);
          expect(sim.econ.exceedsStorage(price), `${id} L${lvl} tier ${tier}`).toBeUndefined();
          fillStores(sim);
          expect(sim.upgrades.purchase(id, target?.id), `${id} L${lvl} tier ${tier}`).toBe(true);
        }
      }
    }
  });

  it('past 60% of the store only the biomass part keeps growing', () => {
    const { sim, hub } = setup();
    sim.state.caps.energy = big(30);
    hub.upg = { droneSpeed: 5 };
    const p = n(sim.upgrades.price(UPGRADE_BY_ID.droneSpeed, hub));
    expect(p.energy).toBe(18); // 10 × 1.4^5 ≈ 54, capped at 60% of 30
    expect(p.biomass).toBe(Math.ceil(25 * 1.65 ** 5));
  });

  it('"Upgrade all" buys cheapest-first and stops quietly at the first level it can’t pay', () => {
    const { sim, hub, hub2 } = setup();
    const hub3 = sim.build.place('droneHub', PAD, 1, 5)!;
    sim.state.resources.energy = big(25); // two first levels (10 ⚡ each), not three
    const bought = sim.upgrades.purchaseAll('droneSpeed');
    expect(bought).toBe(2);
    expect([hub, hub2, hub3].map((h) => sim.upgrades.levelOf(h, 'droneSpeed')).sort()).toEqual([0, 1, 1]);
    expect(toNum(sim.state.resources.energy)).toBe(5);
  });

  it('the advisor saves up for the whole mixed price', () => {
    const { sim } = setup();
    sim.state.resources.biomass = big(0);
    sim.state.resources.energy = big(0);
    sim.state.resources.water = big(0);
    const next = sim.advisor.nextPurchase();
    expect(next).toBeDefined();
    // Whatever it picks, its price is the upgrade's full price (or a machine's), never just the biomass part.
    const def = Object.values(UPGRADE_BY_ID).find((d) => d.name === next!.name);
    if (def) expect(n(next!.cost)).toEqual(n(sim.upgrades.status(def).price));
    const dash = sim.upgrades.status(UPGRADE_BY_ID.droneSpeed).price;
    expect(n(dash).energy).toBe(10);
  });
});
