import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { decorAnchor, decorCells, DECOR_OPTION } from '../src/data/cozy';
import { DECOR_RECIPES } from '../src/data/crafting';
import { HOUSE, HOUSE_GROWTH, HOUSE_INSIDE } from '../src/data/oldcity';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';
import { bannedIn, WORDS } from '../src/ui/words';

const ID = HOUSE_INSIDE.layer;

function scene(level: number, seed = 7) {
  const sim = new Sim(createInitialState(seed));
  sim.areas.clear(PARK, true);
  const sv = sim.state.salvage!;
  sv.tier = HOUSE_GROWTH.opensAtStep;
  for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone'] as const) sv.store[m] = 500;
  sim.bot = { roofId: GROUND, x: 4.5, z: 6.5 };
  while (sim.house.level < level) sim.house.giveAll();
  sv.decorMade = DECOR_RECIPES.map((r) => r.id).sort();
  return { sim, cozy: new Cozy(sim) };
}

/** What a placed decoration is, wherever it stands (to check nothing is lost). */
const kinds = (cozy: Cozy) => cozy.decorations().filter((d) => d.roofId === ID).map((d) => d.kind).sort();

/**
 * Fills the room to its level's limit through the game's own rules: a mix of solid pieces (one-square and two-square)
 * where they shut nothing off, flat ones (rugs, flower patches) on the rest.
 */
function fill(sim: Sim, cozy: Cozy) {
  const limit = sim.house.decorMax();
  const solid = ['houseplant', 'diningtable', 'pot', 'clock', 'sidetable'];
  const flat = ['flowerbed', 'roundrug', 'cushions'];
  let i = 0;
  for (const t of sim.grid.tilesOf(ID)) {
    if (cozy.insideCount() >= limit) break;
    for (const kind of [solid[i % solid.length], flat[i % flat.length]]) {
      const [ax, az] = decorAnchor(kind, 0, t.x, t.z);
      if (!cozy.placeDecor(kind, 0, ID, ax, az)) {
        i++;
        break;
      }
    }
  }
  return cozy.insideCount();
}

/** Every rule a settled room keeps: nothing in furniture or across a wall, every room and piece in reach of the door. */
function expectSettled(sim: Sim, cozy: Cozy, label: string) {
  const h = sim.house;
  for (const d of cozy.decorations().filter((x) => x.roofId === ID)) {
    const cells = decorCells(d.kind, d.rot, d.x, d.z);
    for (const c of cells) {
      expect(h.furnitureAt(c.x, c.z), `${label}: ${d.kind} in furniture at ${c.x},${c.z}`).toBeUndefined();
      expect(sim.grid.get(ID, c.x, c.z)?.occupantId, `${label}: ${d.kind} stamped at ${c.x},${c.z}`).toBe(`d:${d.key}`);
    }
    for (const a of cells) for (const b of cells) expect(h.wallBetween(a.x, a.z, b.x, b.z), `${label}: ${d.kind} across a wall`).toBe(false);
  }
  expect(h.cutOff(), label).toBeUndefined();
  // Bloombot walks from the door to every room and every piece, and back to the door
  const w = new Walker(sim);
  const [dx, dz] = h.doorInside();
  expect(w.walkable(ID, dx, dz), `${label}: the door square is free`).toBe(true);
  for (const r of h.rooms()) expect(w.path(ID, dx + 0.5, dz + 0.5, (x, z) => h.roomAt(x, z)?.id === r.id, { x: r.x, z: r.z }), `${label}: to ${r.id}`).toBeDefined();
  for (const f of h.furniture()) {
    const beside = (x: number, z: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([sx, sz]) => h.furnitureAt(x + sx, z + sz)?.id === f.id && !h.wallBetween(x, z, x + sx, z + sz));
    const p = w.path(ID, dx + 0.5, dz + 0.5, beside, { x: f.x, z: f.z });
    expect(p, `${label}: to ${f.id}`).toBeDefined();
    const end = p!.at(-1) ?? { x: dx + 0.5, z: dz + 0.5 };
    expect(w.path(ID, end.x, end.z, (x, z) => x === dx && z === dz, { x: dx, z: dz }), `${label}: from ${f.id} back to the door`).toBeDefined();
  }
}

describe('#862: decorations are kept safe when the house grows', () => {
  for (const level of [1, 2, 3]) {
    it(`the ${HOUSE[level - 1].name} filled to its limit of ${HOUSE[level - 1].decor} grows, and every decoration is still there, clear of furniture and walls, with the door in reach`, () => {
      const { sim, cozy } = scene(level);
      expect(fill(sim, cozy)).toBe(HOUSE[level - 1].decor);
      expectSettled(sim, cozy, `filled ${HOUSE[level - 1].name}`);
      const before = kinds(cozy);
      sim.house.giveAll();
      expect(sim.house.level).toBe(level + 1);
      const back = cozy.settleHouse();
      expect(back).toEqual([]);
      expect(kinds(cozy)).toEqual(before);
      expectSettled(sim, cozy, `grown to the ${HOUSE[level].name}`);
      // and it survives save → load as it is
      const saver = new SaveService(undefined);
      saver.now = () => 1;
      const again = new Sim(saver.deserialize(saver.serialize(sim.state))!);
      const c2 = new Cozy(again);
      expect(c2.settleHouse()).toEqual([]);
      expect(kinds(c2)).toEqual(before);
    });
  }

  it('the Home holds as many as fit on its floor and keeps them all through a save', () => {
    const { sim, cozy } = scene(4);
    const n = fill(sim, cozy);
    // 140 is more than the Home's free floor (12 × 12, less furniture and the door): it fills every square it can
    expect(n).toBeGreaterThan(HOUSE[2].decor);
    expectSettled(sim, cozy, 'filled Home');
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const again = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    const c2 = new Cozy(again);
    expect(c2.settleHouse()).toEqual([]);
    expect(c2.insideCount()).toBe(n);
  });
});

describe('#862: an older save loads into the new rooms with nothing lost', () => {
  /** An old House or Home save: decorations written straight into it, as a game from before the rooms left them. */
  function oldSave(level: number, decor: Record<string, string>) {
    const { sim } = scene(level);
    sim.state.cozy = { ...(sim.state.cozy ?? {}), decor };
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const again = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    return { sim: again, cozy: new Cozy(again) };
  }

  it('a House saved with the old layout: pieces on the new furniture, across the kitchen walls and boxing in the desk all move', () => {
    // the old House had its bed at (0, 0) and desk at (0, 3); these squares are now the bed (5, 0), the kitchen's walls
    // and the way to the desk at (0, 6)
    const decor: Record<string, string> = {
      [`${ID}|5|0`]: 'pot', // on the bed
      [`${ID}|7|0`]: 'clock', // on the radio
      [`${ID}|3|2`]: 'diningtable', // across the kitchen's east wall
      [`${ID}|2|3`]: 'diningtable@1', // across the kitchen's doorway… and its south wall
      [`${ID}|0|5`]: 'houseplant', // with the next two, shutting the desk in
      [`${ID}|0|7`]: 'houseplant',
      [`${ID}|1|6`]: 'bookshelf',
      [`${ID}|6|6`]: 'bigrug', // flat, nobody's way
    };
    const { sim, cozy } = oldSave(3, decor);
    expect(sim.house.cutOff()?.id).toBe('desk');
    const back = cozy.settleHouse();
    expect(back).toEqual([]);
    expect(kinds(cozy)).toEqual(Object.values(decor).map((v) => v.split('@')[0]).sort());
    expectSettled(sim, cozy, 'old House');
    expect(cozy.decorAt(ID, 6, 6)?.kind).toBe('bigrug'); // the rug in nobody's way stays put
  });

  it('a Home saved with a wall of pots where the bedroom now has its doorway: they move and the bedroom opens', () => {
    const decor: Record<string, string> = {};
    for (let x = 8; x < 12; x++) decor[`${ID}|${x}|5`] = 'pot'; // all along the bedroom's south side
    for (let x = 8; x < 12; x++) decor[`${ID}|${x}|6`] = 'clock'; // and a second row
    const { sim, cozy } = oldSave(4, decor);
    expect(sim.house.cutOff()).toBeDefined();
    expect(cozy.settleHouse()).toEqual([]);
    expect(cozy.insideCount()).toBe(8);
    expectSettled(sim, cozy, 'old Home');
  });

  it('with no free floor left, a piece goes back to the build menu and the toast names it', () => {
    // a Shed whose every free square already holds a decoration, and one more on the chest's square
    const { sim } = scene(1);
    const decor: Record<string, string> = {};
    const [dx, dz] = sim.house.doorInside();
    for (const t of sim.grid.tilesOf(ID)) if (!t.blocked && !(t.x === dx && t.z === dz)) decor[`${ID}|${t.x}|${t.z}`] = 'flowerbed';
    const chest = sim.house.furniture().find((f) => f.id === 'chest')!;
    decor[`${ID}|${chest.x}|${chest.z}`] = 'pot';
    sim.state.cozy = { ...(sim.state.cozy ?? {}), decor };
    const cozy = new Cozy(sim);
    const back = cozy.settleHouse();
    expect(back.map((d) => d.kind)).toEqual(['pot']);
    expect(cozy.decorations().some((d) => d.kind === 'pot')).toBe(false);
    expect(sim.crafting.decorMade('pot')).toBe(true); // still made: free to put down again
    expectSettled(sim, cozy, 'full Shed');
    const one = WORDS.house.handedBack([DECOR_OPTION.pot.name]);
    expect(one).toMatch(/Your flower pot was in the way/);
    expect(one).toMatch(/back in your build menu/);
    const many = WORDS.house.handedBack(['Flower pot', 'Clock']);
    expect(many).toMatch(/2 of your decorations were in the way/);
    expect(many).toMatch(/Flower pot, Clock/);
    expect(bannedIn(one)).toEqual([]);
    expect(bannedIn(many)).toEqual([]);
  });
});
