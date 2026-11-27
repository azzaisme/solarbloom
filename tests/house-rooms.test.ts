import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { decorCells, DECOR_OPTION } from '../src/data/cozy';
import { DECOR_RECIPES } from '../src/data/crafting';
import { HOUSE, HOUSE_GROWTH, HOUSE_INSIDE, houseDoorInside, houseFurniture, houseRooms, houseWallBetween, houseWalls } from '../src/data/oldcity';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { Walker, type BotPose } from '../src/gameplay/Walker';
import { innerWallPieces, wallSinks } from '../src/rendering/HouseArt';

/** A garden at the fountain's first step, every material in its chests and every decoration made. */
function scene(level: number, seed = 7) {
  const sim = new Sim(createInitialState(seed));
  sim.areas.clear(PARK, true);
  const sv = sim.state.salvage!;
  sv.tier = HOUSE_GROWTH.opensAtStep;
  for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone'] as const) sv.store[m] = 500;
  sim.bot = { roofId: GROUND, x: 4.5, z: 6.5 };
  while (sim.house.level < level) sim.house.giveAll();
  sv.decorMade = DECOR_RECIPES.map((r) => r.id).sort();
  const cozy = new Cozy(sim);
  return { sim, cozy, id: HOUSE_INSIDE.layer };
}

const inRoom = (sim: Sim, id: string) => sim.grid.tilesOf(HOUSE_INSIDE.layer).filter((t) => sim.house.roomAt(t.x, t.z)?.id === id);

describe('#860: the bigger houses have rooms', () => {
  it('the Shed and the Cottage are one room; the House adds a kitchen and the Home a bedroom', () => {
    expect(houseRooms(1).map((r) => r.id)).toEqual(['main']);
    expect(houseRooms(2).map((r) => r.id)).toEqual(['main']);
    expect(houseRooms(3).map((r) => r.id)).toEqual(['main', 'kitchen']);
    expect(houseRooms(4).map((r) => r.id)).toEqual(['main', 'kitchen', 'bedroom']);
    expect(houseWalls(1)).toEqual([]);
    expect(houseWalls(2)).toEqual([]);
    // the House's and the Home's gives name the new room
    expect(HOUSE[2].gives).toContain('A kitchen with a stove for cooking'); // #858
    expect(HOUSE[3].gives).toContain('A bedroom');
  });

  it('each room lies inside the floor, the kitchen keeps its squares as the house grows, and every square is in one room', () => {
    for (const level of [3, 4]) {
      const { sim } = scene(level);
      const R = HOUSE[level - 1].room;
      for (const r of houseRooms(level)) expect(r.x + r.w <= R && r.z + r.d <= R, r.id).toBe(true);
      for (const r of houseRooms(level).slice(1)) expect(inRoom(sim, r.id)).toHaveLength(r.w * r.d);
      const counts = houseRooms(level).map((r) => inRoom(sim, r.id).length);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(R * R);
    }
    expect(houseRooms(4).find((r) => r.id === 'kitchen')).toEqual(houseRooms(3).find((r) => r.id === 'kitchen'));
  });

  it('a room is closed off by its walls except for one doorway, and nothing stands in a doorway', () => {
    for (const level of [3, 4]) {
      const { sim } = scene(level);
      for (const r of houseRooms(level).slice(1)) {
        // every side step from the room into another room crosses a wall, but for exactly one: the doorway
        const ways: string[] = [];
        for (const t of inRoom(sim, r.id))
          for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = sim.grid.get(HOUSE_INSIDE.layer, t.x + sx, t.z + sz);
            if (!n || sim.house.roomAt(n.x, n.z)?.id === r.id) continue;
            if (!houseWallBetween(level, t.x, t.z, n.x, n.z)) ways.push(`${t.x},${t.z}→${n.x},${n.z}`);
          }
        expect(ways, `${r.id} at level ${level}`).toHaveLength(1);
        // the squares either side of the doorway are free floor
        const [a, b] = ways[0].split('→').map((p) => p.split(',').map(Number));
        for (const [x, z] of [a, b]) expect(sim.house.furnitureAt(x, z), `${x},${z}`).toBeUndefined();
      }
    }
  });

  it('every piece of furniture stands on floor in one room, clear of the others and the door, never across a wall', () => {
    for (const level of [1, 2, 3, 4]) {
      const R = HOUSE[level - 1].room;
      const seen = new Set<string>();
      const [dx, dz] = houseDoorInside(level);
      for (const f of houseFurniture(level)) {
        const rooms = new Set<string>();
        for (let x = f.x; x < f.x + f.w; x++)
          for (let z = f.z; z < f.z + f.d; z++) {
            expect(x >= 0 && z >= 0 && x < R && z < R, `${f.id} at level ${level}`).toBe(true);
            expect(seen.has(`${x},${z}`), `${f.id} overlaps at level ${level}`).toBe(false);
            expect(x === dx && z === dz).toBe(false);
            seen.add(`${x},${z}`);
            rooms.add(String(houseRooms(level).slice(1).find((r) => x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d)?.id ?? 'main'));
          }
        expect(rooms.size, `${f.id} at level ${level}`).toBe(1);
      }
    }
    // the Shed and the Cottage keep the spots they always had (older saves look as they did)
    expect(houseFurniture(1).map((f) => [f.id, f.x, f.z])).toEqual([['bed', 0, 0], ['radio', 2, 0], ['chest', 5, 0]]);
    expect(houseFurniture(2).map((f) => [f.id, f.x, f.z])).toEqual([['bed', 0, 0], ['radio', 3, 0], ['chest', 7, 0], ['shelf', 7, 2], ['desk', 0, 3]]);
    // the Home's bed and chest are in the bedroom
    const { sim } = scene(4);
    for (const id of ['bed', 'chest']) {
      const f = sim.house.furniture().find((p) => p.id === id)!;
      expect(sim.house.roomAt(f.x, f.z)?.id).toBe('bedroom');
    }
  });
});

describe('#860: Bloombot walks from room to room', () => {
  it('from the front door it can walk to every room and to every piece of furniture, and back to the door, at each level', () => {
    for (const level of [1, 2, 3, 4]) {
      const { sim, id } = scene(level);
      const w = new Walker(sim);
      const [dx, dz] = sim.house.doorInside();
      for (const r of sim.house.rooms()) {
        const p = w.path(id, dx + 0.5, dz + 0.5, (x, z) => sim.house.roomAt(x, z)?.id === r.id, { x: r.x + r.w / 2, z: r.z + r.d / 2 });
        expect(p, `to ${r.id} at level ${level}`).toBeDefined();
        const last = p!.at(-1) ?? { x: dx + 0.5, z: dz + 0.5 };
        expect(w.path(id, last.x, last.z, (x, z) => x === dx && z === dz, { x: dx, z: dz }), `back from ${r.id}`).toBeDefined();
      }
      for (const f of sim.house.furniture()) {
        const beside = (x: number, z: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([sx, sz]) => sim.house.furnitureAt(x + sx, z + sz)?.id === f.id && !sim.house.wallBetween(x, z, x + sx, z + sz));
        expect(w.path(id, dx + 0.5, dz + 0.5, beside, { x: f.x, z: f.z }), `to ${f.id} at level ${level}`).toBeDefined();
      }
      expect(sim.house.cutOff()).toBeUndefined();
    }
  });

  it('walls stop it: walking straight at one it slides along, and a path goes round through the doorway', () => {
    const { sim, id } = scene(3);
    const w = new Walker(sim);
    // in the main room just east of the kitchen's east wall (x = 4), walking west into it
    const p: BotPose = { roofId: id, x: 4.5, z: 1.5, facing: -Math.PI / 2 };
    for (let i = 0; i < 40; i++) w.move(p, -0.1, 0);
    expect(p.x).toBeGreaterThanOrEqual(4 + 0.26 - 1e-9);
    expect(sim.house.roomAt(Math.floor(p.x), Math.floor(p.z))?.id).toBe('main');
    // the way into the kitchen goes through its doorway (2, 3) ↔ (2, 4)
    const way = w.path(id, 4.5, 1.5, (x, z) => x === 1 && z === 1, { x: 1, z: 1 })!;
    expect(way).toBeDefined();
    expect(way.some((c) => Math.floor(c.x) === 2 && Math.floor(c.z) === 4)).toBe(true);
    expect(way.some((c) => Math.floor(c.x) === 2 && Math.floor(c.z) === 3)).toBe(true);
    // and walking through the doorway itself is open
    const q: BotPose = { roofId: id, x: 2.5, z: 4.5, facing: Math.PI };
    for (let i = 0; i < 20; i++) w.move(q, 0, -0.1);
    expect(q.z).toBeLessThan(3);
  });

  it('nothing is used through a wall: the walls cut the side steps and both diagonals round a wall’s end', () => {
    const { sim } = scene(3);
    expect(sim.house.connected(3, 1, 4, 1)).toBe(false); // the kitchen's east wall
    expect(sim.house.connected(1, 3, 1, 4)).toBe(false); // its south wall
    expect(sim.house.connected(2, 3, 2, 4)).toBe(true); // its doorway
    expect(sim.house.connected(3, 3, 4, 4)).toBe(false); // round the corner where the two walls meet
    expect(sim.house.connected(4, 3, 3, 4)).toBe(true); // both outside the kitchen: round the corner's far side
  });

  it('a game saved in the kitchen loads with Bloombot still in the kitchen, the walls in place', () => {
    const { sim, id } = scene(4);
    sim.bot = { roofId: id, x: 1.5, z: 1.5 };
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const again = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(again.house.level).toBe(4);
    expect(again.house.walls()).toHaveLength(houseWalls(4).length);
    expect(again.house.roomAt(1, 1)?.id).toBe('kitchen');
    expect(new Walker(again).fits(id, 1.5, 1.5)).toBe(true);
  });
});

describe('#860: decorating each room', () => {
  it('a decoration can go in every room', () => {
    const { sim, cozy, id } = scene(4);
    for (const r of sim.house.rooms()) {
      const t = inRoom(sim, r.id).find((c) => !cozy.canDecorate('pot', id, c.x, c.z));
      expect(t, r.id).toBeDefined();
      expect(cozy.placeDecor('pot', 0, id, t!.x, t!.z)).toBeUndefined();
      expect(sim.house.roomAt(t!.x, t!.z)?.id).toBe(r.id);
    }
    expect(cozy.insideCount()).toBe(3);
  });

  it('a big piece never stands across a wall', () => {
    const { sim, cozy, id } = scene(3);
    // the dining table is two squares long along x: from (3, 1) it would cross the kitchen's east wall
    expect(DECOR_OPTION.diningtable.size).toEqual([2, 1]);
    expect(decorCells('diningtable', 0, 3, 1).map((c) => c.x)).toEqual([3, 4]);
    expect(cozy.canDecorate('diningtable', id, 3, 1, 0)).toBe('A wall is in the way');
    // #858: where it does go down (somewhere the kitchen's furniture leaves room), it stands in one room
    const fits: [number, number][] = [];
    for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) if (cozy.canDecorate('diningtable', id, x, z, 0) === undefined) fits.push([x, z]);
    expect(fits.length).toBeGreaterThan(0);
    for (const [x, z] of fits) expect(sim.house.roomAt(x, z)?.id, `${x},${z}`).toBe(sim.house.roomAt(x + 1, z)?.id);
  });

  it('a solid piece is refused where it would block the way into a room or to a piece of furniture; a rug is not', () => {
    const { sim, cozy, id } = scene(3);
    // the kitchen's doorway: a pot on either side of it would shut the kitchen off
    // (#858: the stove inside it is shut off too, and may be the one named)
    expect(cozy.canDecorate('pot', id, 2, 4)).toMatch(/^That would block the way (into the kitchen|to the stove)$/);
    expect(cozy.canDecorate('pot', id, 2, 3)).toMatch(/^That would block the way (into the kitchen|to the stove)$/);
    expect(cozy.canDecorate('roundrug', id, 2, 4)).toBeUndefined(); // Bloombot walks over a rug
    // the desk at (0, 6) on the west wall: block (0, 5) and (0, 7), then (1, 6) would close it in
    const desk = sim.house.furniture().find((f) => f.id === 'desk')!;
    expect(cozy.placeDecor('pot', 0, id, desk.x, desk.z - 1)).toBeUndefined();
    expect(cozy.placeDecor('pot', 0, id, desk.x, desk.z + 1)).toBeUndefined();
    expect(cozy.canDecorate('pot', id, desk.x + 1, desk.z)).toBe('That would block the way to the journal desk');
  });

  it('an older save’s decorations are all kept: any on a spot new furniture took, or across a new wall, moves to free floor', () => {
    // a House saved before the rooms: the old layout (the bed at the north-west corner and the shelf by the east
    // wall) left (5, 0) and (3, 1) … (4, 1) free, so decorations stood there
    const { sim, id } = scene(2);
    const st = sim.state;
    st.salvage!.house = 3;
    sim.house.sync();
    // write the decorations straight into the save, as an older game would have them
    st.cozy = { ...(st.cozy ?? {}), decor: { [`${id}|5|0`]: 'pot', [`${id}|3|1`]: 'diningtable', [`${id}|8|8`]: 'clock' } };
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const again = new Sim(saver.deserialize(saver.serialize(st))!);
    const c2 = new Cozy(again);
    c2.settleHouse();
    const inside = c2.decorations().filter((d) => d.roofId === id);
    expect(inside.map((d) => d.kind).sort()).toEqual(['clock', 'diningtable', 'pot']);
    for (const d of inside) {
      const cells = decorCells(d.kind, d.rot, d.x, d.z);
      for (const c of cells) expect(again.house.furnitureAt(c.x, c.z), `${d.kind} at ${c.x},${c.z}`).toBeUndefined();
      for (const a of cells) for (const b of cells) expect(again.house.wallBetween(a.x, a.z, b.x, b.z)).toBe(false);
    }
    expect(c2.decorAt(id, 8, 8)?.kind).toBe('clock'); // one in nobody's way stays put
    expect(again.house.cutOff()).toBeUndefined();
  });
});

describe('#860: the camera sees over the inner walls', () => {
  const kitchenSouth = innerWallPieces(houseWalls(3)[1]).filter((p) => !p.lintel);
  const kitchenEast = innerWallPieces(houseWalls(3)[0]);
  const cam = (x: number, z: number): [number, number] => [x, z + 6]; // the camera behind Bloombot, to the south

  it('a wall between the camera and Bloombot sinks; one beyond it, or seen end on, stands tall', () => {
    // Bloombot in the kitchen: its south wall is between it and the camera
    for (const p of kitchenSouth) expect(wallSinks(p, [1.5, 1.5], cam(1.5, 1.5))).toBe(true);
    // Bloombot in the main room, south of the kitchen: the kitchen's wall is beyond it
    for (const p of kitchenSouth) expect(wallSinks(p, [2.5, 6.5], cam(2.5, 6.5))).toBe(false);
    // the kitchen's east wall runs toward the camera: it hides nothing and stands tall
    for (const p of kitchenEast) expect(wallSinks(p, [5.5, 2.5], cam(5.5, 2.5))).toBe(false);
    // turned to look from the east, the east wall is the one in the way
    for (const p of kitchenEast) expect(wallSinks(p, [1.5, 1.5], [8, 1.5])).toBe(true);
    // the bedroom at the Home, the same way
    for (const p of innerWallPieces(houseWalls(4)[3]).filter((q) => !q.lintel)) {
      expect(wallSinks(p, [10.5, 2.5], cam(10.5, 2.5))).toBe(true);
      expect(wallSinks(p, [10.5, 8.5], cam(10.5, 8.5))).toBe(false);
    }
  });

  it('a wall is cut at its doorway: a stretch each side and the lintel over the gap', () => {
    const pieces = innerWallPieces(houseWalls(3)[1]);
    expect(pieces.map((p) => [p.line, !!p.lintel])).toEqual([
      [[0, 4, 2, 4], false],
      [[3, 4, 4, 4], false],
      [[2, 4, 3, 4], true],
    ]);
  });
});
