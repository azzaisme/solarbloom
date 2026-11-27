import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { HOUSE, HOUSE_INSIDE, houseDoorInside, houseFurniture, houseRooms, houseRugs, houseWallBetween, houseWalls } from '../src/data/oldcity';
import { RUG } from '../src/rendering/DecorArt';
import { ceilingBeams, drawCeilingBeam, drawRoom, windowSpots, wallSinks, type HouseSink } from '../src/rendering/HouseArt';
import { addTexBox, HOUSE_TEX_MEAN, HOUSE_TEXTURES, houseTexUrl } from '../src/rendering/HouseTex';
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

/** Decodes an 8-bit RGB or RGBA PNG (no interlace) to its size and RGBA pixels. */
function readPng(file: string): { w: number; h: number; px: Uint8Array } {
  const buf = readFileSync(file);
  let o = 8;
  let w = 0, h = 0, ch = 4;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      ch = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = new Uint8Array(w * h * ch);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y ? out[(y - 1) * stride + x] : 0;
      const c = x >= ch && y ? out[(y - 1) * stride + x - ch] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[y * stride + x] = (v + pred) & 255;
    }
  }
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) for (let k = 0; k < 4; k++) px[i * 4 + k] = k < ch ? out[i * ch + k] : 255;
  return { w, h, px };
}

const TEX_DIR = 'assets/raw/textures/house';

describe('#861: the house’s painted textures (klad)', () => {
  it('each texture is a painted tile with its klad source beside it, and the game finds it', () => {
    for (const name of HOUSE_TEXTURES) {
      expect(existsSync(`${TEX_DIR}/${name}.klad/doc.json`), `${name}.klad`).toBe(true);
      expect(readdirSync(`${TEX_DIR}/${name}.klad/strokes`).length, `${name}: painted strokes`).toBeGreaterThan(0);
      const { w, h, px } = readPng(`${TEX_DIR}/${name}.png`);
      expect([w, h]).toEqual([256, 256]);
      for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) throw new Error(`${name}.png has see-through pixels`);
      expect(houseTexUrl(name), name).toBeTruthy();
    }
  });

  it('each tile’s mean brightness is the one the material lifts the tint by', () => {
    for (const name of HOUSE_TEXTURES) {
      const { px } = readPng(`${TEX_DIR}/${name}.png`);
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      expect(sum / (px.length / 4) / 255, name).toBeCloseTo(HOUSE_TEX_MEAN[name], 1);
    }
  });

  it('the tiles are seamless: across each wrap the colour changes no more than between some neighbouring rows inside', () => {
    for (const name of HOUSE_TEXTURES) {
      const { w, h, px } = readPng(`${TEX_DIR}/${name}.png`);
      const at = (x: number, y: number) => {
        const i = (y * w + x) * 4;
        return px[i] + px[i + 1] + px[i + 2];
      };
      // how much a whole row (or column) changes from the one before it
      const rows = (y0: number, y1: number) => Array.from({ length: w }, (_, x) => Math.abs(at(x, y0) - at(x, y1))).reduce((a, b) => a + b) / w;
      const cols = (x0: number, x1: number) => Array.from({ length: h }, (_, y) => Math.abs(at(x0, y) - at(x1, y))).reduce((a, b) => a + b) / h;
      const insideRows = Math.max(...Array.from({ length: h - 1 }, (_, y) => rows(y, y + 1)));
      const insideCols = Math.max(...Array.from({ length: w - 1 }, (_, x) => cols(x, x + 1)));
      expect(rows(h - 1, 0), `${name} top/bottom`).toBeLessThanOrEqual(insideRows);
      expect(cols(w - 1, 0), `${name} left/right`).toBeLessThanOrEqual(insideCols);
    }
  });

  it('a textured box: 6 faces wound outward, the grain along its longest side', () => {
    const g = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], col: [] as number[], idx: [] as number[] };
    addTexBox(g, [0.5, 0.4, 0.3], [1, 2, 3], [4, 0.12, 0.06], 0.9);
    expect(g.pos.length / 3).toBe(24);
    expect(g.idx.length).toBe(36);
    for (let t = 0; t < 36; t += 3) {
      const [a, b, c] = [g.idx[t], g.idx[t + 1], g.idx[t + 2]].map((i) => [0, 1, 2].map((k) => g.pos[i * 3 + k]));
      const e1 = b.map((v, k) => v - a[k]);
      const e2 = c.map((v, k) => v - a[k]);
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const n = [0, 1, 2].map((k) => g.nrm[g.idx[t] * 3 + k]);
      expect(cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2]).toBeGreaterThan(0);
    }
    // the top face (normal +y): U spans the beam's 4 m length, V its 0.06 m depth
    const ups = [...Array(24).keys()].filter((i) => g.nrm[i * 3 + 1] === 1);
    const us = ups.map((i) => g.uv[i * 2]);
    const vs = ups.map((i) => g.uv[i * 2 + 1]);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(4 / 0.9, 5);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(0.06 / 0.9, 5);
  });

  it('with textures, the dressing is painted: rugs woven, the doormat coir, beams, plates, joists, posts and skirting wood', () => {
    for (const level of [1, 2, 3, 4]) {
      const plain: string[] = [];
      const tex: Record<string, string[]> = { wood: [], weave: [], coir: [] };
      const sink: HouseSink = {
        add: (type, hex) => {
          if (type === 'box') plain.push(hex);
        },
        tex: (name, hex) => tex[name].push(hex),
      };
      const furniture = houseFurniture(level);
      drawRoom(sink, { origin: [0, 0, 0], room: HOUSE[level - 1].room, wall: HOUSE_INSIDE.wall, level, door: houseDoorInside(level), furniture, walls: houseWalls(level), rooms: houseRooms(level), keepsakes: 0, variant: (x, z) => x * 7 + z });
      const rugs = houseRugs(level).length;
      expect(tex.weave.length, `level ${level}: each rug's edge and middle`).toBe(rugs * 2);
      expect(tex.coir, `level ${level}: the doormat and its two bands`).toEqual([H.doormat, H.doormatDark, H.doormatDark]);
      expect(tex.wood.filter((h) => h === H.skirting).length, `level ${level}: skirting`).toBeGreaterThanOrEqual(5);
      expect(tex.wood.filter((h) => h === H.beam).length, `level ${level}: plates, joists, posts, lamps`).toBeGreaterThanOrEqual(7);
      for (const hex of [H.skirting, H.doormat, H.doormatDark, H.rug, H.rugBlue, H.rugGreen]) expect(plain, `level ${level}: no plain ${hex} left`).not.toContain(hex);
      // the ceiling beams too
      const beams: string[] = [];
      for (const piece of ceilingBeams(level, HOUSE[level - 1].room)) drawCeilingBeam({ add: () => beams.push('plain'), tex: (n) => beams.push(n) }, piece, [0, 0, 0]);
      expect(beams).toEqual(Array(level - 1).fill('wood'));
    }
  });
});
