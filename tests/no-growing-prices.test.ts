import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { BuildableType, MachineData } from '../src/core/types';
import { BUILDABLE } from '../src/data/machines';
import { REGIONS } from '../src/data/oldcity';
import { UPGRADES } from '../src/data/upgrades';
import { Sim } from '../src/gameplay/Sim';
import { fill, makeSim, PAD, rich } from './helpers';

/**
 * E23.1.5 (#369): no price grows with purchases anywhere. Fog is never bought, nothing in the upgrade data has a
 * price, and a machine or a refit costs the same however many were bought before.
 */
describe('E23.1.5: no price grows with purchases', () => {
  it('every machine pays the same recipe for the tenth copy as for the first', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    const first = Object.fromEntries(BUILDABLE.map((t) => [t, JSON.stringify(sim.build.recipe(t))]));
    // pretend ten of each were already built
    sim.state.stats.built = Object.fromEntries(BUILDABLE.map((t) => [t, 10]));
    expect(sim.build.place('solar', PAD, 5, 5)).toBeTruthy();
    for (const t of BUILDABLE) expect(JSON.stringify(sim.build.recipe(t as BuildableType)), t).toBe(first[t]);
    // and what the backpack pays is the recipe, every time
    const scrap = () => sim.state.salvage.pack.scrap ?? 0;
    const before = scrap();
    expect(sim.build.place('solar', PAD, 6, 6)).toBeTruthy();
    expect(before - scrap()).toBe(sim.build.recipe('solar')!.scrap);
  });

  it('a drone refit costs the same on every hub', () => {
    const sim = new Sim(createInitialState(4));
    const hub = (x: number): MachineData => {
      const m: MachineData = { id: sim.newId('m'), type: 'droneHub', roofId: GROUND, x, z: 3, size: 2, boostUntil: 0, timer: 0, charge: 0 };
      sim.state.machines.push(m);
      sim.grid.indexMachine(m);
      return m;
    };
    const a = hub(3);
    const b = hub(9);
    const p0 = sim.roles.refitPrice(b, 'scout');
    a.roles = ['scout'];
    expect(sim.roles.refitPrice(b, 'scout')).toBe(p0);
  });

  it('upgrades carry no price at all, and research grants levels through one interface', () => {
    for (const u of UPGRADES) for (const k of ['baseCost', 'costMult', 'costKind', 'parts']) expect(u, `${u.id}.${k}`).not.toHaveProperty(k);
    const sim = new Sim(createInitialState(2));
    sim.state.salvage.pack.biomass = 50;
    const before = JSON.stringify(sim.state.salvage.pack);
    expect(sim.upgrades.grant('broadPulse')).toBe(1);
    expect(sim.upgrades.level('broadPulse')).toBe(1);
    expect(JSON.stringify(sim.state.salvage.pack)).toBe(before); // granted, not bought
    for (let i = 0; i < 8; i++) sim.upgrades.grant('broadPulse');
    expect(sim.upgrades.level('broadPulse')).toBe(4); // its last level
  });

  it('fog is never bought: sealed regions open by their gates and have no price', () => {
    const sim = new Sim(createInitialState(3));
    const areas = sim.areas as unknown as Record<string, unknown>;
    for (const k of ['unlock', 'unlockCost', 'unlockProblem']) expect(areas[k], k).toBeUndefined();
    for (const r of REGIONS) {
      const st = sim.state.areas[r.id] as unknown as Record<string, unknown> | undefined;
      expect(st?.price, r.id).toBeUndefined();
    }
  });

  it('the drawer, its key and its button are gone from the HUD and bindings', () => {
    const hud = readFileSync('src/ui/Hud.ts', 'utf8') + readFileSync('src/ui/Hotbar.ts', 'utf8') + readFileSync('src/ui/Panels.ts', 'utf8');
    for (const s of ['id="upgrades"', 'upgBtn', 'data-buy', 'toggleUpgrades']) expect(hud, s).not.toContain(s);
    expect(readFileSync('src/app/Bindings.ts', 'utf8')).not.toMatch(/'upgrades'/);
  });
});
