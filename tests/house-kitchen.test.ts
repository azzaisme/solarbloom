import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { DECOR_RECIPES } from '../src/data/crafting';
import { HOUSE, HOUSE_GROWTH, HOUSE_INSIDE, houseDoorInside, houseFurniture, houseRooms, houseWalls } from '../src/data/oldcity';
import { drawRoom, type HouseSink } from '../src/rendering/HouseArt';
import { PALETTE } from '../src/rendering/Palette';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { houseHtml } from '../src/ui/OldCityPanel';
import { bannedIn } from '../src/ui/words';

const ID = HOUSE_INSIDE.layer;
const KITCHEN = ['stove', 'counter', 'table'];

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

describe('#858: the kitchen is furnished at the House', () => {
  it('growing to the House adds the stove, the counter and the table, all in the kitchen; the Cottage has none', () => {
    expect(houseFurniture(2).filter((f) => KITCHEN.includes(f.id))).toEqual([]);
    const { sim } = scene(2);
    sim.house.giveAll();
    expect(sim.house.level).toBe(3);
    for (const level of [3, 4]) {
      if (level === 4) sim.house.giveAll();
      for (const id of KITCHEN) {
        const f = sim.house.furniture().find((p) => p.id === id)!;
        expect(f, `${id} at level ${level}`).toBeDefined();
        for (let x = f.x; x < f.x + f.w; x++) for (let z = f.z; z < f.z + f.d; z++) {
          expect(sim.house.roomAt(x, z)?.id, `${id} at ${x},${z}`).toBe('kitchen');
          expect(sim.grid.get(ID, x, z)!.blocked).toBe(true);
        }
      }
    }
    // the stove is the one that is used: its prompt says so; the counter and the table are there to look at
    expect(houseFurniture(3).find((f) => f.id === 'stove')!.verb).toBe('Cook at');
    expect(houseFurniture(3).find((f) => f.id === 'counter')!.verb).toBeUndefined();
    expect(houseFurniture(3).find((f) => f.id === 'table')!.verb).toBeUndefined();
    expect(sim.house.cutOff()).toBeUndefined();
  });

  it('the house panel names them in what the House brings', () => {
    const { sim } = scene(2);
    const html = houseHtml(sim);
    expect(html).toMatch(/The house brings/);
    expect(html).toMatch(/A kitchen with a stove for cooking/);
    expect(html).toMatch(/A kitchen counter/);
    expect(html).toMatch(/A table and four chairs/);
    expect(bannedIn(html)).toEqual([]);
    expect(HOUSE[2].gives.length).toBeGreaterThanOrEqual(3);
  });

  it('a House or Home from an older save gains the pieces on load; decorations where they now stand move, none lost', () => {
    for (const level of [3, 4]) {
      const { sim } = scene(level);
      // an older save: the kitchen's corner decorated before there was a kitchen
      sim.state.cozy = { ...(sim.state.cozy ?? {}), decor: { [`${ID}|0|0`]: 'houseplant', [`${ID}|1|0`]: 'clock', [`${ID}|1|3`]: 'pot', [`${ID}|3|3`]: 'roundrug' } };
      const saver = new SaveService(undefined);
      saver.now = () => 1;
      const again = new Sim(saver.deserialize(saver.serialize(sim.state))!);
      const cozy = new Cozy(again);
      expect(cozy.settleHouse()).toEqual([]);
      for (const id of KITCHEN) expect(again.house.furniture().some((f) => f.id === id), `${id} at level ${level}`).toBe(true);
      expect(again.house.furnitureAt(0, 0)?.id).toBe('stove');
      expect(again.house.furnitureAt(2, 0)?.id).toBe('counter');
      expect(again.house.furnitureAt(1, 3)?.id).toBe('table');
      const kinds = cozy.decorations().filter((d) => d.roofId === ID).map((d) => d.kind).sort();
      expect(kinds).toEqual(['clock', 'houseplant', 'pot', 'roundrug']);
      for (const d of cozy.decorations()) expect(again.house.furnitureAt(d.x, d.z), `${d.kind} at level ${level}`).toBeUndefined();
      expect(cozy.decorAt(ID, 3, 3)?.kind).toBe('roundrug');
      expect(again.house.cutOff()).toBeUndefined();
    }
  });

  it('the kitchen wears painted textures: a gingham cloth on the table, tiles behind the stove and counter, wood for the rest', () => {
    const H = PALETTE.house;
    for (const level of [3, 4]) {
      const tex: Record<string, string[]> = { wood: [], weave: [], coir: [], cloth: [], tiles: [] };
      const plain: string[] = [];
      const sink: HouseSink = { add: (type, hex) => type === 'box' && plain.push(hex), tex: (name, hex) => tex[name].push(hex) };
      drawRoom(sink, { origin: [0, 0, 0], room: HOUSE[level - 1].room, wall: HOUSE_INSIDE.wall, level, door: houseDoorInside(level), furniture: houseFurniture(level), walls: houseWalls(level), rooms: houseRooms(level), keepsakes: 0, variant: (x, z) => x * 7 + z });
      expect(tex.cloth, `level ${level}: the cloth's top and its two hanging sides`).toEqual([H.cloth, H.cloth, H.cloth]);
      expect(tex.tiles, `level ${level}: behind the stove and the counter`).toEqual([H.tileWhite, H.tileWhite]);
      for (const hex of [H.plank, H.plankLight, H.plankDark]) expect(tex.wood, `level ${level}: the counter's ${hex}`).toContain(hex);
      expect(tex.wood.filter((h) => h === H.bedWood).length, `level ${level}: the table's top and legs`).toBe(5);
      for (const hex of [H.cloth, H.tileWhite, H.plankDark]) expect(plain, `level ${level}: no plain ${hex}`).not.toContain(hex);
    }
  });
});
