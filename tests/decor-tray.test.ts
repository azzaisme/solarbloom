import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { decorKey, decorOccupant } from '../src/core/Decor';
import { createInitialState, GROUND } from '../src/core/GameState';
import { DECOR_OPTION, DECOR_OPTIONS, decorSet, type DecorOption } from '../src/data/cozy';
import { DECOR_RECIPES } from '../src/data/crafting';
import { HOUSE_GROWTH, HOUSE_INSIDE } from '../src/data/oldcity';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { buildItems, DECOR_SET_LABEL, setHeads } from '../src/ui/BuildCatalog';
import { bannedIn } from '../src/ui/words';

/**
 * #847: the build menu's Decorations tab leads with the set that suits where Bloombot is. Two stand-in indoor pieces
 * keep these tests about the order, whatever the real indoor set holds.
 */
const CHAIR: DecorOption = { id: 'test-chair', name: 'Test chair', icon: '🪑', blurb: 'A test chair for a room.', solid: true, unlock: { start: true }, indoor: true };
const LAMP: DecorOption = { id: 'test-lamp', name: 'Test lamp', icon: '💡', blurb: 'A test lamp for a room.', solid: true, unlock: { start: true }, indoor: true };
const STANDINS = [CHAIR, LAMP];

beforeAll(() => {
  for (const o of STANDINS) {
    DECOR_OPTION[o.id] = o;
    DECOR_OPTIONS.push(o);
  }
});
afterAll(() => {
  for (const o of STANDINS) {
    delete DECOR_OPTION[o.id];
    DECOR_OPTIONS.splice(DECOR_OPTIONS.indexOf(o), 1);
  }
});

/** A garden past the Shed, every decoration made, Bloombot by the door outside. */
function scene(seed = 7) {
  const sim = new Sim(createInitialState(seed));
  sim.areas.clear(PARK, true);
  const sv = sim.state.salvage!;
  sv.tier = HOUSE_GROWTH.opensAtStep;
  for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone'] as const) sv.store[m] = 500;
  sim.bot = { roofId: GROUND, x: 4.5, z: 6.5 };
  sim.house.giveAll();
  sv.decorMade = DECOR_RECIPES.map((r) => r.id).sort();
  return { sim, cozy: new Cozy(sim) };
}

const decorTools = (sim: Sim, inside: boolean) => buildItems(sim, inside).filter((i) => i.tab === 'decorations');

describe('#847: every decoration is in one of two sets', () => {
  it('the 17 decorations the game had are garden pieces; a piece made for a room is an indoor one', () => {
    const before = DECOR_OPTIONS.filter((o) => !STANDINS.includes(o));
    expect(before.length).toBeGreaterThanOrEqual(17);
    for (const o of before.slice(0, 17)) expect(decorSet(o), o.id).toBe('garden');
    expect(decorSet(CHAIR)).toBe('indoor');
    for (const o of DECOR_OPTIONS) expect(['indoor', 'garden']).toContain(decorSet(o));
  });

  it('the set headings read plainly', () => {
    for (const t of Object.values(DECOR_SET_LABEL)) expect(bannedIn(t), t).toEqual([]);
    expect(DECOR_SET_LABEL).toEqual({ indoor: 'For the house', garden: 'For the garden' });
  });
});

describe('#847: the tray leads with the set that suits where Bloombot is', () => {
  it('inside the house, indoor pieces first and the garden pieces after them, under their own heading', () => {
    const { sim } = scene();
    const items = decorTools(sim, true);
    const sets = items.map((i) => i.set);
    const firstGarden = sets.indexOf('garden');
    expect(sets.slice(0, firstGarden).every((s) => s === 'indoor')).toBe(true);
    expect(sets.slice(firstGarden).every((s) => s === 'garden')).toBe(true);
    expect(items[0].set).toBe('indoor');
    expect(items.slice(0, firstGarden).map((i) => i.tool)).toEqual(expect.arrayContaining(['decor:test-chair', 'decor:test-lamp']));
    const heads = setHeads(items);
    expect(heads[0]).toBe('indoor');
    expect(heads[firstGarden]).toBe('garden');
    expect(heads.filter(Boolean)).toHaveLength(2);
  });

  it('outside, the garden pieces first and the indoor pieces after them', () => {
    const { sim } = scene();
    const items = decorTools(sim, false);
    const sets = items.map((i) => i.set);
    const firstIndoor = sets.indexOf('indoor');
    expect(firstIndoor).toBeGreaterThan(0);
    expect(sets.slice(0, firstIndoor).every((s) => s === 'garden')).toBe(true);
    expect(sets.slice(firstIndoor).every((s) => s === 'indoor')).toBe(true);
    expect(setHeads(items)[0]).toBe('garden');
    expect(setHeads(items)[firstIndoor]).toBe('indoor');
  });

  it('within each set the data order stays, and nothing else in the menu moves', () => {
    const { sim } = scene();
    const garden = DECOR_OPTIONS.filter((o) => decorSet(o) === 'garden').map((o) => `decor:${o.id}`);
    for (const inside of [true, false]) {
      const got = decorTools(sim, inside).filter((i) => i.set === 'garden').map((i) => i.tool);
      expect(got).toEqual(garden.filter((t) => (got as string[]).includes(t)));
    }
    const strip = (inside: boolean) => buildItems(sim, inside).filter((i) => i.tab !== 'decorations').map((i) => i.tool);
    expect(strip(true)).toEqual(strip(false));
    expect(buildItems(sim).map((i) => i.tool)).toEqual(buildItems(sim, false).map((i) => i.tool));
  });

  it('with one set listed there are no headings (nothing to tell apart)', () => {
    const { sim } = scene();
    const garden = decorTools(sim, true).filter((i) => i.set === 'garden');
    expect(setHeads(garden).every((h) => h === undefined)).toBe(true);
  });
});

describe('#847: either set can go in either place', () => {
  it('an indoor piece goes on the garden’s ground, and a garden piece on the house’s floor', () => {
    const { sim, cozy } = scene();
    const id = HOUSE_INSIDE.layer;
    // a square of the park's ground made green, the first one a piece is allowed on
    const ground = sim.areas.tiles(PARK).find((t) => {
      if (t.blocked || t.occupantId || t.feature === 'water') return false;
      t.ground = 'restored';
      t.pollution = 0;
      t.bloom = Math.max(1, t.bloom);
      sim.grid.touch(t);
      return !cozy.canDecorate('bench', GROUND, t.x, t.z);
    })!;
    expect(ground).toBeDefined();
    expect(cozy.placeDecor(CHAIR.id, 0, GROUND, ground.x, ground.z)).toBeUndefined();
    expect(cozy.placeDecor('bench', 2, id, 2, 2)).toBeUndefined();
    expect(cozy.decorAt(GROUND, ground.x, ground.z)?.kind).toBe(CHAIR.id);
    expect(cozy.decorAt(id, 2, 2)?.kind).toBe('bench');
  });
});

describe('#847: what already stands keeps standing', () => {
  it('an older save of garden pieces, indoors and out, loads unchanged and every piece is where it was', () => {
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const { sim, cozy } = scene();
    const id = HOUSE_INSIDE.layer;
    // a save made before the sets existed: garden pieces only, a few inside the house
    for (const [i, kind] of ['pot', 'flowerbed', 'bench', 'lantern'].entries()) expect(cozy.placeDecor(kind, i, id, 1 + i, 2), kind).toBeUndefined();
    const json = saver.serialize(sim.state);
    const copy = new Sim(saver.deserialize(json)!);
    expect(saver.serialize(copy.state)).toBe(json);
    const c2 = new Cozy(copy);
    expect(c2.decorations().map((d) => `${d.kind}@${d.rot} ${d.x},${d.z}`)).toEqual(['pot@0 1,2', 'flowerbed@1 2,2', 'bench@2 3,2', 'lantern@3 4,2']);
    for (const d of c2.decorations()) expect(copy.grid.get(id, d.x, d.z)!.occupantId).toBe(decorOccupant(decorKey(id, d.x, d.z)));
  });
});
