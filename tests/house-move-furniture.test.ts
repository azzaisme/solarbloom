// #875 (epic #845): the house's built-in furniture can be moved. Each piece (all but the fireplace, built into the
// wall) can be picked up, turned and put on free floor anywhere in the house; never across a wall, on the door's
// square, on another piece or a decoration, where it would shut Bloombot out of a room or away from a piece, or shut
// Bloombot in. Where each stands is saved; a new game or an older save starts with today's layout; a move is kept as
// the house grows, unless the new level needs the floor (then the piece goes back to its level's spot, or the nearest
// that fits).
import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { DECOR_RECIPES } from '../src/data/crafting';
import { furnitureAt, HOUSE_GROWTH, HOUSE_INSIDE, houseDoorInside, houseFurniture, houseRooms, houseRugs, houseWalls, type HouseFurniture } from '../src/data/oldcity';
import { backAgainstWall, drawFurniture, drawRoom } from '../src/rendering/HouseArt';
import { PALETTE } from '../src/rendering/Palette';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';

const ID = HOUSE_INSIDE.layer;

function scene(level: number, seed = 7) {
  const sim = new Sim(createInitialState(seed));
  sim.areas.clear(PARK, true);
  const sv = sim.state.salvage!;
  sv.tier = HOUSE_GROWTH.opensAtStep;
  for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone'] as const) sv.store[m] = 500;
  sim.bot = { roofId: GROUND, x: 4.5, z: 6.5 };
  for (let i = 0; i < 6 && sim.house.level < level; i++) sim.house.giveAll();
  expect(sim.house.level).toBe(level);
  sv.decorMade = DECOR_RECIPES.map((r) => r.id).sort();
  return { sim, cozy: new Cozy(sim) };
}
const piece = (sim: Sim, id: string) => sim.house.furniture().find((f) => f.id === id)!;
const grow = (sim: Sim) => {
  sim.bot = { roofId: GROUND, x: 4.5, z: 6.5 };
  sim.house.giveAll();
};
/** Every free square (not furniture, not the door) where a piece could go, turned `rot`, by the house's own rules. */
function spotsFor(sim: Sim, id: HouseFurniture['id'], rot: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const R = sim.house.room();
  for (let x = 0; x < R; x++) for (let z = 0; z < R; z++) if (!sim.house.placeProblem(id, x, z, rot)) out.push({ x, z });
  return out;
}

describe('#875: the house’s built-in furniture can be moved', () => {
  it('a new game, and a save from before, start with today’s layout', () => {
    expect(createInitialState(7).salvage?.houseLayout).toBeUndefined();
    for (const level of [1, 2, 3, 4]) {
      const { sim } = scene(level);
      expect(sim.house.furniture()).toEqual(houseFurniture(level));
      expect(sim.house.furniture().every((f) => f.rot === 0)).toBe(true);
    }
  });

  it('every piece but the fireplace moves, in each of its four turns, anywhere free in the house: its squares go with it', () => {
    const { sim } = scene(4);
    const h = sim.house;
    for (const f of h.furniture()) {
      if (f.fixed) {
        expect(f.id).toBe('fireplace');
        expect(h.movable(f)).toBe(false);
        expect(h.placeProblem(f.id, 5, 5, 0)).toBe('The fire is built into the house: it stays where it is');
        expect(h.move(f.id, 5, 5, 0)).toBeDefined();
        continue;
      }
      expect(h.movable(f), f.id).toBe(true);
      for (const rot of [0, 1, 2, 3]) {
        const spots = spotsFor(sim, f.id, rot);
        expect(spots.length, `${f.id} turned ${rot}: somewhere to go`).toBeGreaterThan(3);
        const old = piece(sim, f.id);
        // the spot furthest from where it stands, to be sure it really moved
        const to = spots.sort((a, b) => Math.hypot(b.x - old.x, b.z - old.z) - Math.hypot(a.x - old.x, a.z - old.z))[0];
        expect(h.move(f.id, to.x, to.z, rot), `${f.id} to ${to.x},${to.z} turned ${rot}`).toBeUndefined();
        const now = piece(sim, f.id);
        expect([now.x, now.z, now.rot]).toEqual([to.x, to.z, rot]);
        const want = furnitureAt(f, to.x, to.z, rot);
        expect([now.w, now.d]).toEqual([want.w, want.d]);
        for (let x = now.x; x < now.x + now.w; x++)
          for (let z = now.z; z < now.z + now.d; z++) {
            expect(h.furnitureAt(x, z)?.id, `${f.id} on ${x},${z}`).toBe(f.id);
            expect(sim.grid.get(ID, x, z)!.blocked).toBe(true);
          }
        // its old squares are free floor again (unless it overlaps where it was)
        for (let x = old.x; x < old.x + old.w; x++)
          for (let z = old.z; z < old.z + old.d; z++) if (!(x >= now.x && x < now.x + now.w && z >= now.z && z < now.z + now.d)) expect(sim.grid.get(ID, x, z)!.blocked, `${f.id} left ${x},${z}`).toBe(false);
        expect(h.cutOff(), `${f.id}: every room and piece still in reach`).toBeUndefined();
      }
    }
  });

  it('never on the door, across a wall, on another piece or a decoration, outside the room, or where it would block the way', () => {
    const { sim, cozy } = scene(4);
    const h = sim.house;
    const [dx, dz] = houseDoorInside(4);
    expect(h.placeProblem('radio', dx, dz, 0)).toBe('Keep the door of the house clear');
    // the bed turned across the kitchen's east wall (between columns 3 and 4)
    expect(h.placeProblem('bed', 3, 5, 1)).toBe(undefined); // below the kitchen: clear of its wall
    expect(h.placeProblem('bed', 3, 2, 1)).toBe('A wall is in the way');
    expect(h.placeProblem('chest', 0, 0, 0)).toBe('The stove stands here');
    expect(h.placeProblem('chest', 12, 3, 0)).toBe('It doesn’t fit here');
    expect(h.placeProblem('bed', 11, 11, 0)).toBe('It doesn’t fit here');
    // a decoration where it would go
    expect(cozy.placeDecor('houseplant', 0, ID, 6, 3)).toBeUndefined();
    expect(h.placeProblem('radio', 6, 3, 0)).toBe('A decoration stands here: move it first');
    // in the kitchen's doorway (the only way in): the kitchen would be shut off
    expect(h.placeProblem('radio', 2, 4, 0)).toBe('That would block the way to the stove'); // (the kitchen and all in it)
    // and nothing changed for asking
    expect(h.furniture()).toEqual(houseFurniture(4));
    expect(sim.state.salvage!.houseLayout).toBeUndefined();
  });

  it('never on Bloombot, and never so it shuts Bloombot in', () => {
    const { sim } = scene(1);
    const h = sim.house;
    const bot = { x: 0.5, z: 5.5 }; // the Shed's south-west corner
    expect(h.placeProblem('radio', 0, 5, 0, bot)).toBe('Bloombot is standing there');
    expect(h.move('bed', 0, 4, 1, bot)).toBeUndefined(); // turned, along the corner's north side
    expect(h.placeProblem('chest', 1, 5, 0, bot)).toBe('That would shut Bloombot in');
    expect(h.placeProblem('chest', 1, 5, 0), 'with Bloombot elsewhere it fits').toBeUndefined();
  });

  it('where each piece stands, and how it is turned, is saved and loads again; its prompts go with it', () => {
    const { sim } = scene(4);
    expect(sim.house.move('bed', 6, 7, 1)).toBeUndefined();
    expect(sim.house.move('nook', 5, 9, 2)).toBeUndefined();
    expect(sim.house.move('stove', 4, 6, 3)).toBeUndefined();
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const again = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    new Cozy(again).settleHouse();
    expect(again.house.furniture()).toEqual(sim.house.furniture());
    expect(again.state.salvage!.houseLayout).toEqual({ bed: { x: 6, z: 7, rot: 1 }, nook: { x: 5, z: 9, rot: 2 }, stove: { x: 4, z: 6, rot: 3 } });
    // what stands on a square is the piece moved there (the game's prompts ask the house this)
    expect(again.house.furnitureAt(7, 7)?.id).toBe('bed');
    expect(again.house.furnitureAt(4, 6)?.verb).toBe('Cook at');
    expect(again.cooking.hasStove()).toBe(true);
    expect(again.grid.get(ID, 6, 7)!.blocked).toBe(true);
  });

  it('a move is kept as the house grows; a piece whose floor the new level needs goes back to its spot, or the nearest that fits', () => {
    const { sim } = scene(2);
    const h = sim.house;
    expect(h.move('radio', 6, 6, 0)).toBeUndefined(); // still free at the House and the Home
    expect(h.move('chest', 1, 0, 0)).toBeUndefined(); // where the House's counter will stand
    expect(h.move('bed', 3, 1, 1)).toBeUndefined(); // turned across where the kitchen's east wall will be
    expect(h.move('desk', 5, 4, 0)).toBeUndefined();
    grow(sim);
    expect(h.level).toBe(3);
    expect(piece(sim, 'radio')).toMatchObject({ x: 6, z: 6 });
    expect(piece(sim, 'desk')).toMatchObject({ x: 5, z: 4 });
    // the chest and the bed went back to where the House puts them
    const def = houseFurniture(3);
    for (const id of ['chest', 'bed']) expect(piece(sim, id), id).toEqual(def.find((f) => f.id === id));
    expect(sim.state.salvage!.houseLayout).toEqual({ radio: { x: 6, z: 6, rot: 0 }, desk: { x: 5, z: 4, rot: 0 } });
    // nothing overlaps, and all is in reach
    const seen = new Map<string, string>();
    for (const f of h.furniture())
      for (let x = f.x; x < f.x + f.w; x++)
        for (let z = f.z; z < f.z + f.d; z++) {
          expect(seen.get(`${x},${z}`), `${f.id} on ${x},${z}`).toBeUndefined();
          seen.set(`${x},${z}`, f.id);
        }
    expect(h.cutOff()).toBeUndefined();
    grow(sim);
    expect(h.level).toBe(4);
    expect(piece(sim, 'radio')).toMatchObject({ x: 6, z: 6 });
    expect(piece(sim, 'desk')).toMatchObject({ x: 5, z: 4 });
    expect(h.cutOff()).toBeUndefined();
  });

  it('a moved piece whose level spot is taken too goes to the nearest square where it fits, turned as it was', () => {
    const { sim } = scene(2);
    const h = sim.house;
    // the chest on the counter's squares, and the radio on the chest's House spot (9, 0): the chest has to go elsewhere
    expect(h.move('chest', 2, 0, 1)).toBeUndefined();
    expect(h.move('radio', 7, 1, 0)).toBeUndefined();
    grow(sim);
    const chest = piece(sim, 'chest');
    expect(h.placeProblem('chest', chest.x, chest.z, chest.rot)).toBeUndefined();
    expect(h.cutOff()).toBeUndefined();
  });

  it('a turned piece is drawn turned, within its own squares; the stove’s and counter’s tiles only go up against a wall', () => {
    const H = PALETTE.house;
    for (const id of ['bed', 'shelf', 'counter', 'table', 'nook', 'desk'] as const)
      for (const rot of [1, 2, 3]) {
        const f = furnitureAt(houseFurniture(4).find((p) => p.id === id)!, 4, 5, rot);
        const pts: number[][] = [];
        drawFurniture({ add: (_t, _h, p) => pts.push(p), tex: (_n, _h, p) => pts.push(p) }, f, [0, 0, 0], 0, 3);
        for (const [x, , z] of pts) {
          expect(x, `${id} turned ${rot}`).toBeGreaterThanOrEqual(f.x - 0.05);
          expect(x).toBeLessThanOrEqual(f.x + f.w + 0.05);
          expect(z).toBeGreaterThanOrEqual(f.z - 0.05);
          expect(z).toBeLessThanOrEqual(f.z + f.d + 0.05);
        }
      }
    const stove = houseFurniture(4).find((p) => p.id === 'stove')!;
    expect(backAgainstWall(stove, 12, 4)).toBe(true);
    const out = furnitureAt(stove, 5, 6, 0);
    expect(backAgainstWall(out, 12, 4)).toBe(false);
    expect(backAgainstWall(furnitureAt(stove, 0, 5, 3), 12, 4), 'turned three times: its back to the west wall').toBe(true);
    expect(backAgainstWall(furnitureAt(stove, 11, 5, 1), 12, 4), 'turned once: its back to the east wall').toBe(true);
    const tiles = (furniture: HouseFurniture[]) => {
      const got: string[] = [];
      drawRoom({ add: () => undefined, tex: (n, hex) => n === 'tiles' && got.push(hex) }, { origin: [0, 0, 0], room: 12, wall: HOUSE_INSIDE.wall, level: 4, door: houseDoorInside(4), furniture, walls: houseWalls(4), rooms: houseRooms(4), keepsakes: 0, variant: () => 0 });
      return got;
    };
    expect(tiles(houseFurniture(4))).toEqual([H.tileWhite, H.tileWhite]);
    expect(tiles(houseFurniture(4).map((f) => (f.id === 'stove' ? out : f))), 'the stove out in the room: only the counter’s').toEqual([H.tileWhite]);
  });

  it('the rug beside the bed follows it; a rug a piece now stands on is rolled up', () => {
    const def = houseFurniture(4);
    expect(houseRugs(4, def)).toEqual(houseRugs(4));
    const bed = furnitureAt(def.find((f) => f.id === 'bed')!, 6, 6, 1);
    const rugs = houseRugs(4, def.map((f) => (f.id === 'bed' ? bed : f)));
    const blue = rugs.find((r) => r.colour === 'blue')!;
    expect(blue.x).toBeCloseTo(bed.x + bed.w / 2);
    expect(blue.z).toBeCloseTo(bed.z + bed.d + 0.5);
    // the table on the middle rug
    const table = furnitureAt(def.find((f) => f.id === 'table')!, 5, 6, 0);
    expect(houseRugs(4, def.map((f) => (f.id === 'table' ? table : f))).some((r) => r.colour === 'red')).toBe(false);
  });

  it('a layout that would leave a room or a piece out of reach goes back to today’s on load', () => {
    const { sim } = scene(4);
    // a save edited by hand: the radio in the kitchen's doorway
    sim.state.salvage!.houseLayout = { radio: { x: 2, z: 4, rot: 0 } };
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const again = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    new Cozy(again).settleHouse();
    expect(again.house.furniture()).toEqual(houseFurniture(4));
    expect(again.state.salvage!.houseLayout).toBeUndefined();
  });
});
