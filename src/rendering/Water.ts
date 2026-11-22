/**
 * Pools: water lies `drop` below the ground, in a basin whose banks take the neighbouring tile's material. Where a
 * pool turns an outer corner the bank is rounded: `fillet` is the radius in a narrow pool, `wide` where the pool
 * carries on behind the corner tile on both sides. `arc` = segments per rounded corner. Clean water gets a surface
 * mesh of `grid`×`grid` cells a tile, coloured by how far it is from the bank (deep at `deepAt` tiles).
 */
export const WATER = { drop: 0.13, fillet: 0.42, wide: 0.78, arc: 7, grid: 4, deepAt: 1.15 };

// E28.W01 (#694): the water's surface, its shader and its reflections are WaterSurface and WaterReflection now (one
// surface for the sea, the surf and restored pools); this file keeps the basin's shape and the sea slabs' colours.

/**
 * E27.1 (#679): the open sea and its shallows. They are slabs on the living surface (TransitionMaterial), and under the
 * old, over-bright light (and the restored grade's extra saturation) their deep authored blues came out a bright,
 * clear aqua by day: the look the owner approved. With the light brought down to a true sunlit level they showed as
 * their authored dull grey-teal, so the colours (PALETTE.ground.sea and .shallows) are authored brighter now, by
 * `SEA_LIFT` per channel (linear). By night that lift would turn the moonlit sea an electric blue, so the surface
 * divides it back out as night falls (`uTrSea`): at deep night the sea lands exactly on the colours the approved night
 * was tuned with.
 */
export const SEA_LIFT = [2.6, 2.2, 2.1] as const;

/** The sea's colour multiplier at a night amount (0 day … 1 deep night): 1 by day, 1 / SEA_LIFT at deep night. */
export function seaTintAt(n: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, n));
  return SEA_LIFT.map((l) => 1 + (1 / l - 1) * k) as [number, number, number];
}
