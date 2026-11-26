import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { TileData } from '../src/core/types';
import { DECOR_OPTION, FIRST_DECOR } from '../src/data/cozy';
import { DECOR_RECIPES } from '../src/data/crafting';
import { PARK_SET } from '../src/data/oldcity';
import { Cozy, decorOpen } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { buildItem } from '../src/ui/BuildCatalog';
import { bannedIn, WORDS } from '../src/ui/words';

/** A new Old City game: the park cleared, a few cells of green ground by the house's door. */
function scene(seed = 7) {
  const sim = new Sim(createInitialState(seed));
  sim.areas.clear(PARK, true);
  const cozy = new Cozy(sim);
  const [dx, dz] = PARK_SET.shed.door;
  const cells: TileData[] = [];
  for (let r = 1; r <= 3 && cells.length < 3; r++)
    for (let z = dz - r; z <= dz + r && cells.length < 3; z++)
      for (let x = dx - r; x <= dx + r && cells.length < 3; x++) {
        const t = sim.grid.get(GROUND, x, z);
        if (x === dx && z === dz) continue; // the door stays clear
        if (!t || t.blocked || t.occupantId || t.feature === 'water' || cozy.spotAt(GROUND, x, z) || cells.includes(t)) continue;
        t.ground = 'restored';
        t.pollution = 0;
        t.bloom = Math.max(1, t.bloom);
        sim.grid.touch(t);
        cells.push(t);
      }
  return { sim, cozy, cells };
}

describe('#782: the first decoration is a gift at the fountain’s first step', () => {
  it('nothing is given before the first step; at it the Flower pot comes made, once', () => {
    const { sim, cozy } = scene();
    const sv = sim.state.salvage!;
    expect(sv.tier).toBe(0);
    expect(cozy.giveFirstDecor()).toBeUndefined();
    expect(sv.decorGift).toBeUndefined(); // a game before the step saves as before
    expect(sv.decorMade ?? []).not.toContain('pot');

    sv.tier = FIRST_DECOR.step;
    const g = cozy.giveFirstDecor();
    expect(g?.id).toBe('pot');
    expect(sv.decorGift).toBe('pot');
    expect(sim.crafting.decorMade('pot')).toBe(true);
    expect(decorOpen(sim, DECOR_OPTION.pot)).toBe(true);
    // once only, and its own toast is the only one (the made-at-the-table announcement doesn't repeat it)
    expect(cozy.giveFirstDecor()).toBeUndefined();
    expect(cozy.checkDecorUnlocks().map((o) => o.id)).not.toContain('pot');
  });

  it('the gift is in the build menu, open and free, and placing it by the house works', () => {
    const { sim, cozy, cells } = scene();
    expect(cells.length).toBeGreaterThan(0);
    const c = cells[0];
    // before: listed, but locked (to be made at the table)
    expect(buildItem(sim, 'decor:pot')?.locked).toBe(true);
    expect(cozy.canDecorate('pot', GROUND, c.x, c.z)).toMatch(/Not made yet/);
    sim.state.salvage!.tier = 1;
    cozy.giveFirstDecor();
    const it = buildItem(sim, 'decor:pot')!;
    expect(it.locked).toBe(false);
    expect(it.tab).toBe('decorations');
    expect(it.cost).toEqual([]);
    expect(it.affordable).toBe(true);
    for (const t of cells) expect(cozy.placeDecor('pot', 0, GROUND, t.x, t.z)).toBeUndefined(); // as many as you like
    expect(cozy.decorCount()).toBe(cells.length);
    // within a few steps of the house's door
    const [dx, dz] = PARK_SET.shed.door;
    for (const d of cozy.decorations()) expect(Math.max(Math.abs(d.x - dx), Math.abs(d.z - dz))).toBeLessThanOrEqual(3);
  });

  it('an older save already past the first step gets it once, and it survives save → load', () => {
    const { sim, cozy } = scene();
    sim.state.salvage!.tier = 3; // saved before the gift existed: no decorGift
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const old = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(old.state.salvage!.decorGift).toBeUndefined();
    const oc = new Cozy(old);
    expect(oc.giveFirstDecor()?.id).toBe('pot');
    const again = new Sim(saver.deserialize(saver.serialize(old.state))!);
    expect(again.state.salvage!.decorGift).toBe('pot');
    expect(again.crafting.decorMade('pot')).toBe(true);
    expect(new Cozy(again).giveFirstDecor()).toBeUndefined();
    expect(cozy).toBeDefined();
  });

  it('a save that made the Flower pot already gets the next one; one that made every gift gets none', () => {
    const a = scene();
    a.sim.state.salvage!.tier = 2;
    a.sim.state.salvage!.decorMade = ['pot'];
    expect(a.cozy.giveFirstDecor()?.id).toBe('flowerbed');

    const b = scene();
    b.sim.state.salvage!.tier = 2;
    b.sim.state.salvage!.decorMade = [...FIRST_DECOR.gifts].sort();
    expect(b.cozy.giveFirstDecor()).toBeUndefined();
    expect(b.sim.state.salvage!.decorGift).toBe(FIRST_DECOR.gifts[0]); // remembered: never asked again
  });

  it('every gift is a real decoration with a recipe, none of them a Lucky Cat’s', () => {
    for (const id of FIRST_DECOR.gifts) {
      expect(DECOR_OPTION[id], id).toBeDefined();
      const r = DECOR_RECIPES.find((x) => x.id === id);
      expect(r, id).toBeDefined();
      expect('cat' in r!.unlock, id).toBe(false);
    }
  });

  it('the gift’s toast is plain and warm, names the key and says what to do', () => {
    const text = WORDS.decor.gift('🪴', 'Flower pot');
    expect(bannedIn(text)).toEqual([]);
    expect(text).toContain('{buildMenu}');
    expect(text).toContain('Flower pot');
    expect(text).toMatch(/Decorations/);
    expect(text).not.toMatch(/\b(click|tap)\b/i);
  });
});

describe('#782: decorations go round the house, never in its door', () => {
  it('the ground at the door refuses a decoration; the ground beside it takes one', () => {
    const { sim, cozy } = scene();
    sim.state.salvage!.tier = 1;
    cozy.giveFirstDecor();
    const [dx, dz] = PARK_SET.shed.door;
    const t = sim.grid.get(GROUND, dx, dz)!;
    t.ground = 'restored';
    t.pollution = 0;
    sim.grid.touch(t);
    expect(cozy.canDecorate('pot', GROUND, dx, dz)).toMatch(/door of the house clear/);
    expect(bannedIn('Keep the door of the house clear')).toEqual([]);
  });
});
