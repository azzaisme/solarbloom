import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND, rulesOf } from '../src/core/GameState';
import type { ItemId, MaterialId } from '../src/core/types';
import { HOUSE, KEEPERS, PAGES, PARK_SET, REGIONS, BLUEPRINTS, KEEPSAKES } from '../src/data/oldcity';
import { MATERIALS, TIERS, type MaterialCost } from '../src/data/salvage';
import { MACHINE_RECIPES } from '../src/data/crafting';
import { ITEM_DEFS } from '../src/data/items';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);

/** Every material a cost names is a real material (E23.5.1: biomass is one too). */
function realMaterials(cost: MaterialCost) {
  for (const k of Object.keys(cost)) expect(MATERIALS[k as MaterialId], `material ${k}`).toBeDefined();
  for (const v of Object.values(cost)) expect(v).toBeGreaterThan(0);
}

describe('E21.0: two rule sets', () => {
  it('a new Old City game is oldcity; createInitialState defaults to classic with no rules field at all', () => {
    const old = createInitialState(7, 'oldcity');
    expect(old.rules).toBe('oldcity');
    expect(old.salvage).toBeDefined();
    const classic = createInitialState(7);
    expect('rules' in classic).toBe(false);
    expect('salvage' in classic).toBe(false);
    expect(rulesOf(classic)).toBe('classic');
    expect(new Sim(createInitialState(7, 'oldcity')).oldCity).toBe(true);
  });

  it('a save made before E21 (no rules) loads as classic and re-saves byte-identically', () => {
    const sim = new Sim(createInitialState(11));
    for (let i = 0; i < 200; i++) sim.tick();
    const t = sim.grid.get(GROUND, 6, 5)!;
    sim.restoration.pulse(t.id);
    for (let i = 0; i < 100; i++) sim.tick();
    const before = saver.serialize(sim.state);
    expect(before.includes('"rules"')).toBe(false);
    const loaded = saver.deserialize(before)!;
    expect(rulesOf(loaded)).toBe('classic');
    expect(saver.serialize(new Sim(loaded).state)).toBe(before);
  });

  it('an Old City save keeps its rules and salvage state through a round trip', () => {
    const sim = new Sim(createInitialState(21, 'oldcity'));
    sim.state.salvage!.pack.scrap = 7;
    const json = saver.serialize(sim.state);
    const loaded = saver.deserialize(json)!;
    expect(loaded.rules).toBe('oldcity');
    expect(loaded.salvage!.pack.scrap).toBe(7);
    expect(saver.serialize(new Sim(loaded).state)).toBe(json);
  });
});

describe('E21.0: the data', () => {
  it('every recipe, tier delivery, request, landmark delivery and house level names real materials', () => {
    // E23.6.1: machine recipes are on the crafting table: every part a real material or component
    for (const r of MACHINE_RECIPES)
      for (const [k, v] of Object.entries(r.cost)) {
        expect(ITEM_DEFS[k as ItemId], `${r.id}: ${k}`).toBeDefined();
        expect(v).toBeGreaterThan(0);
      }
    for (const t of TIERS) realMaterials(t.delivery);
    for (const k of KEEPERS) {
      realMaterials(k.request1);
      realMaterials(k.landmark);
    }
    for (const h of HOUSE) realMaterials(h.delivery);
    for (const r of REGIONS) expect(MATERIALS[r.material]).toBeDefined();
    for (const r of REGIONS) if (r.gate.needs.repair) realMaterials(r.gate.needs.repair);
  });

  it('every region has a landmark, a Keeper, a seam, a gate, two caches and two pages', () => {
    expect(REGIONS).toHaveLength(10);
    for (const r of REGIONS) {
      expect(r.landmark.name, r.id).toBeTruthy();
      const k = KEEPERS.find((q) => q.id === r.keeper);
      expect(k?.region, r.id).toBe(r.id);
      expect(r.seam.name).toBeTruthy();
      expect(r.gate.cells.length).toBeGreaterThan(0);
      expect(r.caches).toHaveLength(2);
      expect(r.pages).toHaveLength(2);
      for (const p of r.pages) expect(PAGES[p.id], p.id).toBeDefined();
      expect(r.patch.w * r.patch.d).toBeGreaterThan(0);
    }
    expect(Object.keys(PAGES)).toHaveLength(23);
    for (const p of PARK_SET.pages) expect(PAGES[p.id]).toBeDefined();
    expect(BLUEPRINTS.map((b) => b.region)).toEqual(REGIONS.map((r) => r.id));
    expect(KEEPSAKES.map((b) => b.region)).toEqual(REGIONS.map((r) => r.id));
  });

  it('set pieces sit inside their region and never on one another', () => {
    const used = new Map<string, string>();
    const claim = (x: number, z: number, what: string) => {
      const k = `${x},${z}`;
      expect(used.get(k), `${what} at ${k}`).toBeUndefined();
      used.set(k, what);
    };
    for (const r of REGIONS) {
      const inside = (x: number, z: number) => Math.floor(x / 16) >= r.chunks.x0 && Math.floor(x / 16) <= r.chunks.x1 && Math.floor(z / 16) >= r.chunks.z0 && Math.floor(z / 16) <= r.chunks.z1;
      const k = KEEPERS.find((q) => q.id === r.keeper)!;
      for (const [x, z, what] of [[r.landmark.x, r.landmark.z, 'landmark'], [k.x, k.z, 'keeper'], [r.seam.x, r.seam.z, 'seam'], ...r.caches.map((c) => [c.x, c.z, c.id]), ...r.pages.map((c) => [c.x, c.z, c.id]), [r.lookout.x, r.lookout.z, 'lookout'], ...r.piles.map((p) => [p.x, p.z, p.id])] as [number, number, string][]) {
        expect(inside(x, z), `${r.id} ${what}`).toBe(true);
        claim(x, z, `${r.id} ${what}`);
      }
      for (const [dx, dz] of [[1, 0], [0, 1], [1, 1]]) {
        claim(r.landmark.x + dx, r.landmark.z + dz, `${r.id} landmark`);
        claim(r.seam.x + dx, r.seam.z + dz, `${r.id} seam`);
      }
    }
  });
});
