/**
 * P7-E30 (#716): terrain elevation, banks and waterfalls: the Phase 7 config block for relief and its dressing.
 *
 * Gameplay geometry (the overlook's stamp and stair) lives in data/oldcity's region data like every other terrace;
 * this block only names the overlook and the showcase fall so the renderer and the tests agree on where they are,
 * and holds the look tunables. Everything drawn from it is a pure function of the cell: nothing here is saved or
 * read by the simulation.
 */
export const TERRAIN = {
  /** the Falls overlook in Elder Grove: a level-2 pad over the head of Saltwind's canal (its stamp, in oldcity) */
  overlook: { x: -5, z: 12, w: 5, d: 4, level: 2 },
  /** the stair up to it from the grove (walked south, level 1 → 2) */
  overlookStair: { x: -2, z: 10, w: 2, d: 2 },
  /**
   * #745: the showcase waterfall. The rill runs south down the overlook along x = `x` from `spring` to the lip at
   * z = `lip` (the overlook's south edge) and pours over it into the canal two levels below. `source` are the cells
   * whose restoration feeds it (dead: a trickle; restored: full).
   */
  fall: {
    x: -2,
    spring: 13.1,
    lip: 16,
    source: { x: -3, z: 13, w: 2, d: 3 },
    /** the sheet's width at a trickle and at full flow (tiles) */
    trickle: 0.2,
    full: 1.55,
    /** how far out from the wall the sheet lands, as a share of the drop */
    reach: 0.2,
    /** the rill: its bed's width, the water's width at full flow, and how deep it is cut into the pad */
    bed: 0.62,
    water: 0.44,
    cut: 0.05,
    /** foam across the plunge (count across, size) and mist puffs */
    foam: 3,
    foamSize: 0.9,
    mist: 3,
    mistSize: 0.75,
  },
  /** #743: Saltwind's bounding walls once the beach below is restored: rocky, stepped and mossy */
  rockyWall: {
    /** the regions whose bounding walls are dressed (by the region of the lower, restored side) */
    regions: ['saltwind'] as readonly string[],
    /** boulders along the foot, per tile edge (min, max) */
    boulders: [2, 3] as [number, number],
    /** a stepped ledge partway up: its height as a share of the wall, and how far it stands out */
    ledgeAt: 0.42,
    ledgeOut: 0.24,
    /** moss over the coping and the ledge */
    moss: 0.8,
  },
  /** #758: wasteland dressing on dead Old City ground (shares of tiles) */
  wasteland: {
    /** cracked earth: a network of dark cracks */
    cracks: 0.55,
    /** broken pieces of an old path (lawn, litter) */
    pathPieces: 0.09,
    /** derelict clean-energy debris: a toppled panel or a snapped pole */
    debris: 0.028,
    /** dead beach: wrack, a rope end, a broken plank */
    beachLitter: 0.12,
  },
} as const;

/**
 * #745: the cells kept clear round the showcase fall: its rill and source, and the overlook's lip row (the view from
 * it and of the fall). PlantingZones reads them as `landmark_clearance`: short grass, no beds, no trees.
 */
export function fallClearing(x: number, z: number): boolean {
  const O = TERRAIN.overlook;
  const s = TERRAIN.fall.source;
  if (x >= s.x && x < s.x + s.w && z >= O.z && z < s.z + s.d) return true;
  return z === O.z + O.d - 1 && x >= O.x && x < O.x + O.w;
}
