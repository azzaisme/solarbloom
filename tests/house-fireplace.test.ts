// #859 (epic #845): the Home's fireplace and reading nook. Growing to the Home adds both to its main room; the fire
// glows and has a light of its own; sitting by it brings Charge back quicker than a bench (data/charge, measured in
// tests/charging-order.test.ts); the nook is where the journal's found pages are read again. Both have a prompt.
import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { DECOR_RECIPES } from '../src/data/crafting';
import { HOUSE, HOUSE_GROWTH, HOUSE_INSIDE, houseDoorInside, houseFurniture, houseRooms, houseWalls } from '../src/data/oldcity';
import { drawRoom, FIREPLACE, NOOK_SHELF, windowSpots, type HouseSink } from '../src/rendering/HouseArt';
import { PALETTE } from '../src/rendering/Palette';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { houseHtml } from '../src/ui/OldCityPanel';
import { bannedIn } from '../src/ui/words';

const ID = HOUSE_INSIDE.layer;
const HOME = ['fireplace', 'nook'];

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

/** The room drawn into a sink that keeps what each texture and each glowing piece was asked for. */
function drawn(level: number) {
  const tex: Record<string, string[]> = { wood: [], weave: [], coir: [], cloth: [], tiles: [], brick: [], hearth: [] };
  const glow: string[] = [];
  const plain: string[] = [];
  const sink: HouseSink = {
    add: (type, hex, _p, _s, g) => {
      if (g && g >= 0.9) glow.push(hex);
      if (type === 'box') plain.push(hex);
    },
    tex: (name, hex) => tex[name].push(hex),
  };
  drawRoom(sink, { origin: [0, 0, 0], room: HOUSE[level - 1].room, wall: HOUSE_INSIDE.wall, level, door: houseDoorInside(level), furniture: houseFurniture(level), walls: houseWalls(level), rooms: houseRooms(level), keepsakes: 0, variant: (x, z) => x * 7 + z });
  return { tex, glow, plain };
}

describe('#859: the Home brings a fireplace and a reading nook', () => {
  it('growing to the Home adds the fireplace (on the west wall) and the reading nook, both in the main room; the House has neither', () => {
    expect(houseFurniture(3).filter((f) => HOME.includes(f.id))).toEqual([]);
    const { sim } = scene(3);
    expect(sim.house.furniture().filter((f) => HOME.includes(f.id))).toEqual([]);
    sim.house.giveAll();
    expect(sim.house.level).toBe(4);
    for (const id of HOME) {
      const f = sim.house.furniture().find((p) => p.id === id)!;
      expect(f, id).toBeDefined();
      for (let x = f.x; x < f.x + f.w; x++)
        for (let z = f.z; z < f.z + f.d; z++) {
          expect(sim.house.roomAt(x, z)?.id, `${id} at ${x},${z}`).toBe('main');
          expect(sim.grid.get(ID, x, z)!.blocked).toBe(true);
        }
    }
    const fire = sim.house.furniture().find((p) => p.id === 'fireplace')!;
    expect(fire.x, 'against the west wall').toBe(0);
    // the hearth in front of it is open floor, so Bloombot can sit there
    for (let z = fire.z; z < fire.z + fire.d; z++) expect(sim.grid.get(ID, fire.x + fire.w, z)!.blocked, `hearth ${z}`).toBe(false);
    expect(sim.house.cutOff(), 'every piece is reachable from the door').toBeUndefined();
  });

  it('both have a prompt: "Sit by the fire" and "Read in the reading nook"', () => {
    const fire = houseFurniture(4).find((f) => f.id === 'fireplace')!;
    const nook = houseFurniture(4).find((f) => f.id === 'nook')!;
    expect(`${fire.verb} ${fire.name}`).toBe('Sit by the fire');
    expect(`${nook.verb} ${nook.name}`).toBe('Read in the reading nook');
  });

  it('the house panel names them in what the Home brings, in plain words', () => {
    const { sim } = scene(3);
    const html = houseHtml(sim);
    expect(html).toMatch(/A fireplace to sit by/);
    expect(html).toMatch(/A reading nook/);
    expect(HOUSE[3].gives).toEqual(['A bedroom', 'A fireplace to sit by', 'A reading nook', 'Travel home from anywhere']);
    expect(bannedIn(HOUSE[3].gives.join(' '))).toEqual([]);
  });

  it('sitting by the fire needs the fireplace and Bloombot inside: not at the House, not from the park', () => {
    const { sim } = scene(3);
    sim.bot = { roofId: ID, x: 1.5, z: 7.5 };
    expect(sim.rest.sitByFire(), 'the House has no fireplace').toBe(false);
    sim.house.giveAll();
    sim.bot = { roofId: GROUND, x: 4.5, z: 6.5 };
    expect(sim.rest.sitByFire(), 'outside').toBe(false);
    sim.bot = { roofId: ID, x: 1.5, z: 7.5 };
    expect(sim.rest.sitByFire()).toBe(true);
    expect(sim.rest.sitting).toEqual({ kind: 'fire' });
    expect(sim.wildlife.seat(), 'no animal visits indoors').toBeUndefined();
    sim.rest.stand();
    expect(sim.rest.sitting).toBeUndefined();
  });

  it('the fire is drawn in painted brick on a stone hearth, with a wooden mantel, and its flames and embers glow', () => {
    const H = PALETTE.house;
    const { tex, glow } = drawn(4);
    expect(tex.brick.length, 'the jambs and the breast').toBe(3);
    expect(tex.brick.every((h) => h === H.brick)).toBe(true);
    expect(tex.hearth).toEqual([H.hearth]);
    expect(glow).toContain(H.flame);
    expect(glow).toContain(H.ember);
    // the House (no fireplace) has no brick or hearth inside
    const before = drawn(3);
    expect(before.tex.brick).toEqual([]);
    expect(before.tex.hearth).toEqual([]);
    expect(before.glow).not.toContain(H.ember);
  });

  it('the nook: a bookcase full of books, an armchair, a lit lamp; no window behind the fireplace; the bookcase sits under one', () => {
    const H = PALETTE.house;
    const F = PALETTE.furnish;
    const { plain, glow } = drawn(4);
    const books = plain.filter((h) => H.book.includes(h)).length;
    expect(books, 'books on the shelves (and the desk)').toBeGreaterThan(20);
    expect(plain).toContain(F.fabric);
    expect(plain).toContain(F.cushion);
    expect(glow.filter((h) => h === H.lamp).length, 'the nook lamp lit, as the room lamps and the desk lamp').toBeGreaterThanOrEqual(4);
    const level = 4;
    const spots = windowSpots({ room: HOUSE[level - 1].room, level, furniture: houseFurniture(level), walls: houseWalls(level) });
    const R = HOUSE[level - 1].room;
    const near = (f: { z: number; d: number }, col: number) => spots.filter((s) => s.axis === 'x' && s.at === col && s.along > f.z - 0.2 && s.along < f.z + f.d + 0.2);
    const fire = houseFurniture(level).find((p) => p.id === 'fireplace')!;
    const nook = houseFurniture(level).find((p) => p.id === 'nook')!;
    expect(near(fire, 0), 'no window behind the chimney breast').toEqual([]);
    expect(near(nook, R).length, 'the nook keeps its window, the low bookcase under it').toBe(1);
    expect(NOOK_SHELF, 'the bookcase under the sill').toBeLessThan(0.91);
    // the Home keeps all six side windows it had (the fireplace stands between the desk and the west wall's window)
    expect(spots.filter((s) => s.axis === 'x').length).toBe(6);
  });

  it('the fire sits within its own squares: the hearth stone stays in front of its breast, the mantel under the wall top', () => {
    const f = houseFurniture(4).find((p) => p.id === 'fireplace')!;
    expect(FIREPLACE.hearth).toBeLessThanOrEqual(f.w);
    expect(FIREPLACE.wide).toBeLessThanOrEqual(f.d);
    expect(FIREPLACE.depth).toBeLessThan(FIREPLACE.hearth);
    expect(FIREPLACE.mouthTop + 0.4).toBeLessThan(HOUSE_INSIDE.wall);
  });

  it('a Home from an older save gains the pieces on load; decorations where they now stand move, none lost', () => {
    const { sim } = scene(4);
    sim.state.cozy = { ...(sim.state.cozy ?? {}), decor: { [`${ID}|0|7`]: 'houseplant', [`${ID}|10|10`]: 'clock', [`${ID}|11|11`]: 'pot', [`${ID}|0|8`]: 'roundrug' } };
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const again = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    const cozy = new Cozy(again);
    cozy.settleHouse();
    for (const id of HOME) expect(again.house.furniture().some((f) => f.id === id), id).toBe(true);
    const kinds = cozy.decorations().filter((d) => d.roofId === ID).map((d) => d.kind).sort();
    expect(kinds).toEqual(['clock', 'houseplant', 'pot', 'roundrug']);
    for (const d of cozy.decorations()) expect(again.house.furnitureAt(d.x, d.z), `${d.kind}`).toBeUndefined();
    expect(again.house.cutOff()).toBeUndefined();
  });
});
