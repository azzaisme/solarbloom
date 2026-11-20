// E23.13: Saltwind's shore: a ragged surf line (never a ruler), a canal that opens out toward the sea, and the
// barricade still spanning the canal where it's narrow.
import { describe, expect, it } from 'vitest';
import { inSurfBand, onJetty, regionById, regionWater, seaCell, setPieceAt, shallowSea, surfCell, surfDepth } from '../src/core/OldCityLayout';
import { OLD_CITY } from '../src/data/oldcity';
import { ChunkRenderer } from '../src/rendering/ChunkRenderer';
import { WATER } from '../src/rendering/Water';

const EDGE = OLD_CITY.seaMinZ * 16;

describe('E23.13: the shoreline at Saltwind', () => {
  it('the surf is a ragged band: its depth changes along the beach', () => {
    const depths = new Set<number>();
    for (let x = -16; x <= 15; x++) depths.add(surfDepth(x));
    expect(depths.size).toBeGreaterThanOrEqual(3);
    for (const d of depths) expect(d).toBeLessThanOrEqual(5);
  });

  it('a salvage pile or a gate near the water stays on dry sand', () => {
    for (let x = -16; x <= 15; x++)
      for (let z = EDGE - 6; z < EDGE; z++) if (setPieceAt(x, z)) expect(surfCell(x, z), `${x},${z}`).toBe(false);
  });

  it('the surf meets the sea with nothing between: every surf column runs to the bay', () => {
    for (let x = -16; x <= 15; x++) {
      if (regionWater(x, EDGE - 1)) continue; // the canal's mouth
      if (surfDepth(x) > 0) expect(inSurfBand(x, EDGE - 1), `${x}`).toBe(true);
      if (!onJetty(x, EDGE)) expect(seaCell(x, EDGE)).toBe(true); // (the jetty's planks run on out over the bay)
    }
  });

  it('the bay has a ragged shallow shelf off the beach, and deep water further out', () => {
    let shelf = 0;
    for (let x = -16; x <= 15; x++) {
      if (shallowSea(x, EDGE)) shelf++;
      expect(shallowSea(x, EDGE + 3)).toBe(false);
    }
    expect(shelf).toBeGreaterThan(0);
    expect(shelf).toBeLessThan(32);
  });

  it('the canal is two wide where the barricade spans it and opens out toward the sea', () => {
    const width = (z: number) => [-6, -5, -4, -3, -2, -1, 0, 1, 2].filter((x) => regionWater(x, z)).length;
    expect(width(20)).toBe(2);
    expect(width(36)).toBe(2);
    expect(width(EDGE - 1)).toBeGreaterThan(width(36) + 1);
    for (let z = 16; z < EDGE - 1; z++) expect(width(z + 1)).toBeGreaterThanOrEqual(width(z));
    // the barricade covers the canal's whole width where it stands
    const gate = regionById('saltwind')!.gate.cells;
    for (const z of [36, 37]) for (let x = -6; x <= 2; x++) if (regionWater(x, z)) expect(gate.some(([gx, gz]) => gx === x && gz === z), `${x},${z}`).toBe(true);
    // and the Sea Lock stays on dry ground, west of the water
    expect(regionWater(-6, 40)).toBe(false);
  });
});

// E23.13: ground poking out into water has its corners rounded off (the other way round from a pool's inside corners)
describe('E23.13: rounded tips of ground at the water', () => {
  type Piece = { type: string; p: number[]; s: number[] };
  const proto = ChunkRenderer.prototype as unknown as {
    slabInto(this: unknown, sink: unknown, hex: string, p: number[], s: number[]): void;
    cutRing(this: unknown, t: { x: number; z: number }, cut: number[]): [number, number][];
    arc: unknown;
  };
  const draw = (cut: number[] | undefined, p = [5.5, 0, 7.5], s = [1, 0.16, 1]) => {
    const out: Piece[] = [];
    const sink = { grey: 0, add: (type: string, _hex: string, pp: number[], ss: number[]) => out.push({ type, p: [...pp], s: [...ss] }) };
    proto.slabInto.call({ cutNow: cut && { x: 5, z: 7, r: cut } }, sink, '#c8a165', p, s);
    return out;
  };
  // which points of the tile's top a set of pieces covers (a box's footprint, a disc's circle)
  const covers = (pieces: Piece[], x: number, z: number) =>
    pieces.some((q) => (q.type === 'disc' ? Math.hypot(x - q.p[0], z - q.p[2]) <= q.s[0] / 2 + 1e-9 : Math.abs(x - q.p[0]) <= q.s[0] / 2 + 1e-9 && Math.abs(z - q.p[2]) <= q.s[2] / 2 + 1e-9));

  it('a square tile stays one box', () => {
    expect(draw(undefined)).toEqual([{ type: 'box', p: [5.5, 0, 7.5], s: [1, 0.16, 1] }]);
    // and only a whole tile's slab is ever rounded
    expect(draw([WATER.fillet, 0, 0, 0], [5.5, 0, 7.5], [0.9, 0.2, 0.9])).toHaveLength(1);
  });

  it('a corner poking into water is rounded off; the rest of the tile is still covered', () => {
    const R = WATER.fillet;
    const pieces = draw([R, 0, 0, 0]); // CORNERS[0] is +x +z
    expect(pieces.filter((q) => q.type === 'disc')).toHaveLength(1);
    for (const q of pieces) for (const [dx, dz] of [[-1, -1], [1, 1]]) {
      // nothing spills past the tile
      const ex = q.p[0] + (dx * q.s[0]) / 2;
      const ez = q.p[2] + (dz * q.s[2]) / 2;
      expect(ex).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(ex).toBeLessThanOrEqual(6 + 1e-9);
      expect(ez).toBeGreaterThanOrEqual(7 - 1e-9);
      expect(ez).toBeLessThanOrEqual(8 + 1e-9);
    }
    // the very tip is water now, the other three corners and the middle are still ground
    expect(covers(pieces, 6, 8)).toBe(false);
    expect(covers(pieces, 6 - 0.05, 8 - 0.05)).toBe(false);
    for (const [x, z] of [[5, 7], [6, 7], [5, 8], [5.5, 7.5], [6, 8 - R], [6 - R, 8]]) expect(covers(pieces, x, z), `${x},${z}`).toBe(true);
    // just inside the curve is ground
    const a = Math.PI / 4;
    expect(covers(pieces, 6 - R + R * Math.cos(a) - 0.01, 8 - R + R * Math.sin(a) - 0.01)).toBe(true);
  });

  it("the painted ground's outline follows the same curve, closed and going one way round", () => {
    const R = WATER.fillet;
    for (const cut of [[R, 0, 0, 0], [0, R, 0, 0], [0, 0, R, 0], [0, 0, 0, R], [R, R, 0, 0], [R, R, R, R]]) {
      const ring = proto.cutRing.call({ arc: proto.arc }, { x: 5, z: 7 }, cut);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      for (const [x, z] of ring) {
        expect(x).toBeGreaterThanOrEqual(5 - 1e-9);
        expect(x).toBeLessThanOrEqual(6 + 1e-9);
        expect(z).toBeGreaterThanOrEqual(7 - 1e-9);
        expect(z).toBeLessThanOrEqual(8 + 1e-9);
      }
      // the area (shoelace) is the tile less each rounded tip: every step turns the same way, so no fold-backs
      let area = 0;
      for (let i = 0; i + 1 < ring.length; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      const tips = cut.filter((k) => k).length;
      expect(Math.abs(area / 2)).toBeCloseTo(1 - tips * R * R * (1 - Math.PI / 4), 2);
    }
  });
});
