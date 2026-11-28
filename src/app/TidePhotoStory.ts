/** A successful sketch starts the odds over. The fifth eligible photo always gets a page. */
export function tideDrawsPhoto(misses: number, first: boolean, roll: number): boolean {
  return first || misses >= 4 || roll < 0.5;
}
