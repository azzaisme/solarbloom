/** Manhattan distance from a cell to the nearest cell of a square footprint. */
export function distToFootprintRaw(x: number, z: number, fx: number, fz: number, size: number): number {
  const dx = x < fx ? fx - x : x > fx + size - 1 ? x - (fx + size - 1) : 0;
  const dz = z < fz ? fz - z : z > fz + size - 1 ? z - (fz + size - 1) : 0;
  return dx + dz;
}
