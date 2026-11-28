/**
 * Build mode's drag: the squares a drag from one square to another covers. Pure, so the game, the preview and the
 * tests agree on them.
 *
 * - **Line** (the default): a run from the first square to the last. Straight when they share a row or column;
 *   otherwise one corner, along the longer side first, so a road or a pipe never has a diagonal step in it.
 * - **Fill**: every square of the rectangle between the two, row by row from the first square.
 *
 * Both start at the first square (so what is laid first is where the drag began, and running short of pieces leaves
 * the far end unlaid) and never repeat a square.
 */
export type DragShape = 'line' | 'fill';

export interface Cell {
  x: number;
  z: number;
}

/** The most squares one drag lays (a fill of this many is already a big plaza). */
export const DRAG_MAX = 400;

const step = (from: number, to: number) => (to > from ? 1 : to < from ? -1 : 0);

/** A run from `a` to `b`: straight, or with one corner (the longer side first; a tie goes along x). */
export function lineCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  const dx = Math.abs(b.x - a.x);
  const dz = Math.abs(b.z - a.z);
  const sx = step(a.x, b.x);
  const sz = step(a.z, b.z);
  if (dx >= dz) {
    for (let i = 0; i <= dx; i++) out.push({ x: a.x + sx * i, z: a.z });
    for (let i = 1; i <= dz; i++) out.push({ x: b.x, z: a.z + sz * i });
  } else {
    for (let i = 0; i <= dz; i++) out.push({ x: a.x, z: a.z + sz * i });
    for (let i = 1; i <= dx; i++) out.push({ x: a.x + sx * i, z: b.z });
  }
  return out;
}

/** Every square of the rectangle from `a` to `b`, row by row starting at `a`. */
export function fillCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  const sx = step(a.x, b.x) || 1;
  const sz = step(a.z, b.z) || 1;
  for (let z = a.z; z !== b.z + sz; z += sz) for (let x = a.x; x !== b.x + sx; x += sx) out.push({ x, z });
  return out;
}

/** The squares a drag covers, at most `max` of them (the nearest to where it began). */
export function dragCells(shape: DragShape, a: Cell, b: Cell, max = DRAG_MAX): Cell[] {
  const cells = shape === 'fill' ? fillCells(a, b) : lineCells(a, b);
  return cells.length > max ? cells.slice(0, max) : cells;
}
