import { describe, expect, it } from 'vitest';
import { DRAG_MAX, dragCells, fillCells, lineCells } from '../src/core/BuildShape';

const keys = (cells: { x: number; z: number }[]) => cells.map((c) => `${c.x},${c.z}`);

/** Build mode's drag: the squares a run and a fill cover. */
describe('build drag shapes', () => {
  it('a drag that never left its square is that one square', () => {
    expect(keys(lineCells({ x: 3, z: 4 }, { x: 3, z: 4 }))).toEqual(['3,4']);
    expect(keys(fillCells({ x: 3, z: 4 }, { x: 3, z: 4 }))).toEqual(['3,4']);
  });

  it('a run along a row or a column is straight, starting where the drag began', () => {
    expect(keys(lineCells({ x: 2, z: 5 }, { x: 5, z: 5 }))).toEqual(['2,5', '3,5', '4,5', '5,5']);
    expect(keys(lineCells({ x: 2, z: 5 }, { x: 2, z: 3 }))).toEqual(['2,5', '2,4', '2,3']);
  });

  it('a run off the row turns one corner, the longer side first, and never steps diagonally', () => {
    expect(keys(lineCells({ x: 0, z: 0 }, { x: 3, z: 1 }))).toEqual(['0,0', '1,0', '2,0', '3,0', '3,1']);
    expect(keys(lineCells({ x: 0, z: 0 }, { x: -1, z: -3 }))).toEqual(['0,0', '0,-1', '0,-2', '0,-3', '-1,-3']);
    expect(keys(lineCells({ x: 0, z: 0 }, { x: 2, z: 2 }))).toEqual(['0,0', '1,0', '2,0', '2,1', '2,2']); // a tie goes along x
    for (const b of [{ x: 7, z: -4 }, { x: -6, z: 9 }, { x: 5, z: 5 }]) {
      const run = lineCells({ x: 1, z: 1 }, b);
      expect(new Set(keys(run)).size).toBe(run.length);
      expect(run[run.length - 1]).toEqual(b);
      for (let i = 1; i < run.length; i++) expect(Math.abs(run[i].x - run[i - 1].x) + Math.abs(run[i].z - run[i - 1].z)).toBe(1);
    }
  });

  it('a fill is the whole patch between the two squares, whichever way it was dragged', () => {
    const want = ['1,1', '1,2', '2,1', '2,2', '3,1', '3,2'];
    for (const [a, b] of [
      [{ x: 1, z: 1 }, { x: 3, z: 2 }],
      [{ x: 3, z: 2 }, { x: 1, z: 1 }],
      [{ x: 1, z: 2 }, { x: 3, z: 1 }],
    ]) {
      const cells = fillCells(a, b);
      expect(keys(cells).sort()).toEqual(want);
      expect(cells[0]).toEqual(a);
    }
  });

  it('one drag lays at most so many squares: the nearest to where it began', () => {
    const big = dragCells('fill', { x: 0, z: 0 }, { x: 49, z: 49 });
    expect(big.length).toBe(DRAG_MAX);
    expect(big[0]).toEqual({ x: 0, z: 0 });
    expect(dragCells('line', { x: 0, z: 0 }, { x: 9, z: 0 }, 4).map((c) => c.x)).toEqual([0, 1, 2, 3]);
    expect(dragCells('line', { x: 0, z: 0 }, { x: 2, z: 0 }).length).toBe(3);
  });
});
