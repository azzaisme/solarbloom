import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { levelAt } from '../src/core/Height';
import { LOOK } from '../src/data/look';
import { Sim } from '../src/gameplay/Sim';
import { wallDrop, wallRuns } from '../src/rendering/ChunkRenderer';
import { WATER } from '../src/rendering/Water';

// #648: the retaining walls by the water had stepped edges: coping stones 1.04 long overlapping at every tile,
// brick courses standing 0.01 off the face (thinner than a pixel, so their top edge broke into teeth) and a foot
// only 0.05 under the water. The walls now run straight, their courses stand clear and their foot sits deep.
describe('#648: retaining walls run straight', () => {
  const sim = new Sim(createInitialState(7));
  const weir = (x: number, z: number, dx: number, dz: number) =>
    sim.grid.peek(GROUND, x, z)?.feature === 'water' && sim.grid.peek(GROUND, x + dx, z + dz)?.feature === 'water';

  it('the sea wall under the east cliff is one run: every stone along it stops flush at the tile edge', () => {
    for (let x = 17; x <= 30; x++) {
      expect(wallDrop(x, 47, 0, 1)).toBe(levelAt(x, 48));
      expect(wallRuns(x, 47, 0, 1, weir)).toEqual([true, true]);
    }
  });

  it('where the wall turns a corner both of its sides reach on to close it', () => {
    // (16, 47): the cliff's corner, with the sea to the south and the Saltwind canal to the west
    expect(wallDrop(16, 47, 0, 1)).toBeDefined();
    expect(wallDrop(16, 47, -1, 0)).toBeDefined();
    expect(wallRuns(16, 47, 0, 1, weir)[0]).toBe(false);
    expect(wallRuns(16, 47, -1, 0, weir)[1]).toBe(false);
    // and its other ends run on along the sea and up the canal
    expect(wallRuns(16, 47, 0, 1, weir)[1]).toBe(true);
    expect(wallRuns(16, 47, -1, 0, weir)[0]).toBe(true);
  });

  it('no wall where the neighbour is as high', () => {
    expect(wallDrop(20, 46, 0, 1)).toBeUndefined();
    expect(wallDrop(20, 48, 0, -1)).toBeUndefined();
  });

  it('the foot sits well under the water and the courses stand clear of the face', () => {
    const W = LOOK.wall;
    // the water's surface is WATER.drop - 0.08 under the lower side's ground
    expect(W.footSink).toBeGreaterThanOrEqual(WATER.drop + 0.1);
    expect(W.courseProud).toBeGreaterThanOrEqual(0.025);
    expect(W.copingLip).toBeGreaterThan(0);
  });

  it('every tier that draws through the scene target smooths edges with 4× MSAA', () => {
    for (const t of Object.values(LOOK.tiers)) if (t.post) expect(t.samples).toBeGreaterThanOrEqual(4);
  });
});
