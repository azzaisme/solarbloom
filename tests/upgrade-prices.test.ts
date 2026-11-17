import { describe, expect, it } from 'vitest';
import { big, toNum } from '../src/core/Big';
import { formatPriceHtml } from '../src/core/Economy';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { UPGRADE_BY_ID } from '../src/data/upgrades';
import { Sim } from '../src/gameplay/Sim';

/** E18.7 (#207): drone upgrades priced by what they do (biomass plus an energy or water part). */

function insert(sim: Sim, type: MachineData['type'], x: number, z: number, size = 2) {
  const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  return m;
}

/** A city with two hubs (Drone Mesh needs two), at Seed Vault tier `tier`. */
function setup(tier = 0) {
  const sim = new Sim(createInitialState(5));
  const hub = insert(sim, 'droneHub', 0, 50);
  insert(sim, 'droneHub', 17, 50);
  sim.state.upgrades.seedVault = tier;
  sim.upgrades.applyCaps();
  for (const k of ['energy', 'water', 'biomass'] as const) sim.state.resources[k] = big(0);
  return { sim, hub };
}

/** The spec's table (L = current level): main biomass part, then the energy / water part. */
const SPEC: Record<string, { bio: [number, number]; energy?: [number, number]; water?: [number, number] }> = {
  droneSpeed: { bio: [25, 1.65], energy: [10, 1.4] },
  droneRadius: { bio: [28, 1.65], energy: [10, 1.4] },
  droneSweep: { bio: [85, 2], water: [8, 1.4] },
  secondDrone: { bio: [70, 2.5] },
  chainIntel: { bio: [30, 1], energy: [15, 1] },
  droneMesh: { bio: [140, 2], energy: [25, 1.5] },
};

const setLevel = (sim: Sim, hub: MachineData, id: string, l: number) => {
  if (UPGRADE_BY_ID[id].machine) {
    for (const m of sim.state.machines) if (m.type === 'droneHub') (m.upg ??= {})[id] = l;
  } else sim.state.upgrades[id] = l;
  void hub;
};

describe('E18.7: drone upgrades priced by what they do', () => {
  it('matches the spec at every level, each energy or water part capped at 60% of its store', () => {
    for (let tier = 0; tier < TUNING.storageTiers.energy.length; tier++) {
      const { sim, hub } = setup(tier);
      for (const [id, spec] of Object.entries(SPEC)) {
        const def = UPGRADE_BY_ID[id];
        for (let l = 0; l < def.maxLevel; l++) {
          setLevel(sim, hub, id, l);
          const p = sim.upgrades.price(def, def.machine ? hub : undefined);
          const ctx = `${id} L${l} tier ${tier}`;
          expect(toNum(big(p.biomass!)), ctx).toBe(Math.ceil(spec.bio[0] * Math.pow(spec.bio[1], l)));
          for (const k of ['energy', 'water'] as const) {
            const s = spec[k];
            if (!s) {
              expect(p[k], ctx).toBeUndefined();
              continue;
            }
            const cap = toNum(sim.state.caps[k]);
            const want = Math.min(Math.ceil(s[0] * Math.pow(s[1], l)), Math.floor(cap * TUNING.machineCostMaxShare));
            expect(toNum(big(p[k]!)), `${ctx} ${k}`).toBe(want);
            expect(toNum(big(p[k]!)), `${ctx} ${k} fits`).toBeLessThanOrEqual(cap * TUNING.machineCostMaxShare);
          }
        }
      }
    }
  });

  it('every level can be bought at every Seed Vault tier, paying every part at once', () => {
    for (let tier = 0; tier < TUNING.storageTiers.energy.length; tier++) {
      for (const id of Object.keys(SPEC)) {
        const { sim, hub } = setup(tier);
        const def = UPGRADE_BY_ID[id];
        for (let l = 0; l < def.maxLevel; l++) {
          const target = def.machine ? hub : undefined;
          const price = sim.upgrades.price(def, target);
          const ctx = `${id} L${l} tier ${tier}`;
          // Exactly the price, no more: the whole of it fits the stores and buys the level.
          for (const k of ['energy', 'water', 'biomass'] as const) {
            sim.state.resources[k] = big(price[k] ?? 0);
            if (k !== 'biomass') expect(sim.state.resources[k].lte(sim.state.caps[k]), `${ctx} ${k} fits the store`).toBe(true);
          }
          expect(sim.upgrades.purchase(id, target?.id), ctx).toBe(true);
          expect(def.machine ? sim.upgrades.levelOf(hub, id) : sim.upgrades.level(id), ctx).toBe(l + 1);
          for (const k of ['energy', 'water', 'biomass'] as const) expect(toNum(sim.state.resources[k]), `${ctx} ${k} spent`).toBe(0);
        }
      }
    }
  });

  it('short of the energy part: nothing is spent, and the reason names the energy', () => {
    const { sim, hub } = setup(0);
    sim.state.resources.biomass = big(1000);
    sim.state.resources.energy = big(5);
    const st = sim.upgrades.status(UPGRADE_BY_ID.droneSpeed, hub);
    expect(st.ok).toBe(false);
    expect(st.reason).toBe('Need 10 ⚡');
    expect(sim.upgrades.short(st)).toBe('energy');
    expect(sim.upgrades.purchase('droneSpeed', hub.id)).toBe(false);
    expect(toNum(sim.state.resources.biomass)).toBe(1000);
    expect(toNum(sim.state.resources.energy)).toBe(5);
    // Short of biomass too: the main part is named first, as before E18.7.
    sim.state.resources.biomass = big(1);
    expect(sim.upgrades.status(UPGRADE_BY_ID.droneSpeed, hub).reason).toBe('Need 25 🌿');
  });

  it('"Upgrade all" goes cheapest-first and stops at the first level whose energy it cannot pay', () => {
    const { sim } = setup(0);
    insert(sim, 'droneHub', 30, 50); // three hubs, all at level 0: 25 🌿 + 10 ⚡ each
    sim.state.resources.biomass = big(10_000);
    sim.state.resources.energy = big(25); // two levels' energy, not three
    expect(sim.upgrades.purchaseAll('droneSpeed')).toBe(2);
    expect(toNum(sim.state.resources.energy)).toBe(5);
    expect(toNum(sim.state.resources.biomass)).toBe(10_000 - 50);
    expect(sim.upgrades.purchaseAll('droneSpeed')).toBe(0); // no error, nothing spent
    expect(toNum(sim.state.resources.energy)).toBe(5);
  });

  it('upgrades without parts keep their biomass-only price', () => {
    const { sim } = setup(0);
    expect(sim.upgrades.price(UPGRADE_BY_ID.efficientPulse)).toEqual({ biomass: sim.upgrades.cost(UPGRADE_BY_ID.efficientPulse) });
    expect(sim.upgrades.pendingParts()).toBeUndefined();
  });

  it('drones leave a drone upgrade’s energy part alone once its biomass is there', () => {
    const { sim, hub } = setup(0); // energy cap 60, drone reserve 25% = 15
    setLevel(sim, hub, 'droneSpeed', 3); // 113 🌿 + ceil(10 × 1.4³) = 28 ⚡
    // Out of the way: the cheapest pending upgrade (by biomass) is the one held, so make Drone Dash it.
    setLevel(sim, hub, 'droneRadius', 3); // 126 🌿
    setLevel(sim, hub, 'chainIntel', 1); // maxed
    setLevel(sim, hub, 'droneSweep', 4); // maxed (Drone Mesh is 140 🌿)
    sim.state.resources.energy = big(30);
    // Biomass short: drones keep only their usual reserve.
    sim.state.resources.biomass = big(0);
    expect(sim.upgrades.pendingParts()).toBeUndefined();
    expect(sim.drones.payJob({ energy: 5 })).toBe(true); // 30 → 25, above 15
    // Biomass there (a new tick): drones won't dip below the 28 ⚡ the upgrade still needs.
    sim.tick();
    sim.state.resources.energy = big(30);
    sim.state.resources.biomass = big(10_000);
    expect(toNum(big(sim.upgrades.pendingParts()!.energy!))).toBe(28);
    expect(sim.drones.payJob({ energy: 5 })).toBe(false);
    expect(toNum(sim.state.resources.energy)).toBe(30);
    expect(sim.drones.payJob({ energy: 2 })).toBe(true); // 30 → 28 is fine
  });

  it('buy buttons show every part and underline the one you are short of', () => {
    expect(formatPriceHtml({ biomass: 25, energy: 10 })).toBe('10⚡ 25🌿');
    expect(formatPriceHtml({ biomass: 25, energy: 10 }, 'energy')).toBe('<span class="short">10⚡</span> 25🌿');
  });
});
