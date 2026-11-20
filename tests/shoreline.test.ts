// E23.13: Saltwind's shore: a ragged surf line (never a ruler), a canal that opens out toward the sea, and the
// barricade still spanning the canal where it's narrow.
import { describe, expect, it } from 'vitest';
import { inSurfBand, regionById, regionWater, seaCell, setPieceAt, shallowSea, surfCell, surfDepth } from '../src/core/OldCityLayout';
import { OLD_CITY } from '../src/data/oldcity';

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
      expect(seaCell(x, EDGE)).toBe(true);
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
