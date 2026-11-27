import { describe, expect, it } from 'vitest';
import { HOUSE, HOUSE_INSIDE, houseDoorInside, houseFurniture, houseRooms, houseRugs, houseWallBetween, houseWalls } from '../src/data/oldcity';
import { RUG } from '../src/rendering/DecorArt';
import { ceilingBeams, drawRoom, windowSpots, wallSinks, type HouseSink } from '../src/rendering/HouseArt';
import { PALETTE } from '../src/rendering/Palette';

const H = PALETTE.house;
type Box = { hex: string; p: [number, number, number]; s: [number, number, number] };

/** Draws a level's room into a recording sink (origin at 0, 0, 0) and returns every box. */
function room(level: number): Box[] {
  const boxes: Box[] = [];
  const sink: HouseSink = {
    add: (type, hex, p, s) => {
      if (type === 'box') boxes.push({ hex, p, s: typeof s === 'number' ? [s, s, s] : s });
    },
  };
  drawRoom(sink, {
    origin: [0, 0, 0],
    room: HOUSE[level - 1].room,
    wall: HOUSE_INSIDE.wall,
    level,
    door: houseDoorInside(level),
    furniture: houseFurniture(level),
    walls: houseWalls(level),
    rooms: houseRooms(level),
    keepsakes: 0,
    variant: (x, z) => x * 7 + z,
  });
  return boxes;
}

const plan = (level: number) => ({ room: HOUSE[level - 1].room, level, furniture: houseFurniture(level), walls: houseWalls(level) });

describe('#861: the built-in dressing grows with the room', () => {
  it('a second rug from the Cottage on, and a third (the kitchen’s runner) from the House on', () => {
    expect([1, 2, 3, 4].map((l) => houseRugs(l).length)).toEqual([1, 2, 3, 3]);
  });

  it('every rug lies on the floor, inside one room, clear of the furniture and the door', () => {
    for (const level of [1, 2, 3, 4]) {
      const R = HOUSE[level - 1].room;
      const [dx, dz] = houseDoorInside(level);
      for (const r of houseRugs(level)) {
        const [x0, x1, z0, z1] = [r.x - r.w / 2, r.x + r.w / 2, r.z - r.d / 2, r.z + r.d / 2];
        expect(x0 >= 0 && z0 >= 0 && x1 <= R && z1 <= R, `rug at ${r.x},${r.z} level ${level}`).toBe(true);
        const cells: [number, number][] = [];
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) for (let z = Math.floor(z0); z < Math.ceil(z1); z++) cells.push([x, z]);
        for (const [x, z] of cells) {
          expect(houseFurniture(level).some((f) => x >= f.x && x < f.x + f.w && z >= f.z && z < f.z + f.d), `rug under furniture at ${x},${z} level ${level}`).toBe(false);
          expect(x === dx && z === dz, `rug on the door at level ${level}`).toBe(false);
        }
        for (const [ax, az] of cells) for (const [bx, bz] of cells) expect(houseWallBetween(level, ax, az, bx, bz), `rug across a wall at level ${level}`).toBe(false);
      }
    }
  });

  it('the rugs and the doormat lie lower than any rug the player puts down (no flicker where they overlap)', () => {
    const flat = new Set([H.rug, H.rugBlue, H.rugGreen, H.rugEdge, H.doormat, H.doormatDark]);
    for (const level of [1, 2, 3, 4]) {
      const low = room(level).filter((b) => flat.has(b.hex) && b.p[1] < 0.05);
      expect(low.length, `level ${level}`).toBeGreaterThan(2);
      for (const b of low) expect(b.p[1] + b.s[1] / 2, `level ${level}`).toBeLessThan(RUG.base - 0.005);
    }
  });

  it('a doormat inside the door at every level, and skirting along the low front wall each side of it', () => {
    for (const level of [1, 2, 3, 4]) {
      const R = HOUSE[level - 1].room;
      const [dx] = houseDoorInside(level);
      const boxes = room(level);
      const mat = boxes.find((b) => b.hex === H.doormat)!;
      expect(mat, `level ${level}`).toBeDefined();
      expect(Math.floor(mat.p[0])).toBe(dx);
      expect(mat.p[2]).toBeGreaterThan(R - 1);
      const front = boxes.filter((b) => b.hex === H.skirting && Math.abs(b.p[2] - (R - 0.015)) < 1e-6);
      expect(front, `level ${level}`).toHaveLength(2);
    }
  });

  it('more windows as the room widens: on the side walls from the Cottage on, none behind the radio or the shelf, none where an inner wall meets', () => {
    const counts = [1, 2, 3, 4].map((l) => windowSpots(plan(l)).length);
    for (let i = 1; i < counts.length; i++) expect(counts[i], `level ${i + 1}`).toBeGreaterThan(counts[i - 1]);
    expect(windowSpots(plan(1)).every((w) => w.axis === 'z')).toBe(true);
    for (const level of [2, 3, 4]) {
      const spots = windowSpots(plan(level));
      expect(spots.filter((w) => w.axis === 'x' && w.at === 0).length, `west, level ${level}`).toBeGreaterThan(0);
      expect(spots.filter((w) => w.axis === 'x' && w.at > 0).length, `east, level ${level}`).toBeGreaterThan(0);
      const shelf = houseFurniture(level).find((f) => f.id === 'shelf')!;
      const R = HOUSE[level - 1].room;
      if (shelf.x === R - 1) for (const w of spots.filter((s) => s.axis === 'x' && s.at === R)) expect(w.along < shelf.z - 0.2 || w.along > shelf.z + shelf.d + 0.2).toBe(true);
      for (const w of spots.filter((s) => s.axis === 'z')) for (const wall of houseWalls(level).filter((x) => x.axis === 'z')) expect(Math.abs(w.along - wall.at)).toBeGreaterThan(0.6);
      for (const w of spots.filter((s) => s.axis === 'x')) for (const wall of houseWalls(level).filter((x) => x.axis === 'x')) if ((w.at === 0 && wall.from === 0) || (w.at === R && wall.to === R)) expect(Math.abs(w.along - wall.at)).toBeGreaterThan(0.6);
    }
    const radio = houseFurniture(1).find((f) => f.id === 'radio')!;
    for (const w of windowSpots(plan(1))) expect(w.along < radio.x - 0.2 || w.along > radio.x + 1.2).toBe(true);
  });

  it('ceiling beams across the room, more as it grows, each put out of sight while it hangs between the camera and Bloombot', () => {
    expect([1, 2, 3, 4].map((l) => ceilingBeams(l, HOUSE[l - 1].room).length)).toEqual([0, 1, 2, 3]);
    for (const level of [2, 3, 4]) {
      const R = HOUSE[level - 1].room;
      for (const b of ceilingBeams(level, R)) {
        expect(b.beam).toBe(true);
        expect(b.line[0]).toBe(0);
        expect(b.line[2]).toBe(R);
        const z = b.line[1];
        // Bloombot north of it with the camera south: out of sight; south of it: shown
        expect(wallSinks(b, [R / 2, z - 1.5], [R / 2, z + 5])).toBe(true);
        expect(wallSinks(b, [R / 2, z + 1.5], [R / 2, z + 8])).toBe(false);
      }
    }
  });

  it('each room has its own lamp, and each level is better furnished than the one before', () => {
    const lamps = (level: number) => room(level).filter((b) => b.hex === H.beam && Math.abs(b.p[1] - 1.75) < 1e-6).length;
    expect([1, 2, 3, 4].map(lamps)).toEqual([1, 1, 2, 3]);
    const pieces = [1, 2, 3, 4].map((l) => room(l).length);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i]).toBeGreaterThan(pieces[i - 1]);
  });
});
