// E23.6.7 (#472): paths. Footpaths bloombot lays itself: a smooth curve through placed points, a width from a narrow
// trail to a wide promenade, and a material. All data, no rules: the numbers are starting values for tuning.

import type { ItemCost, Unlock } from './crafting';

export type PathMaterial = 'gravel' | 'steppingStones' | 'oldBrick' | 'woodChip' | 'mossyCobbles' | 'boardwalk' | 'sandTrail';

export interface PathMaterialDef {
  id: PathMaterial;
  name: string;
  icon: string;
  /** the path's colour, and its edge's (blending into the grass) */
  colour: string;
  edge: string;
  /** what each tile of path takes (refunded when the path is removed) */
  perTile: ItemCost;
  unlock: Unlock;
  /** may cross shallow water and wet ground (the boardwalk) */
  overWater?: boolean;
  /** only on sand (the beach trail) */
  sandOnly?: boolean;
  /** drawn as separate stones or planks rather than one surface */
  pieces?: 'stones' | 'planks';
}

export const PATH_MATERIALS: PathMaterialDef[] = [
  { id: 'gravel', name: 'Gravel', icon: '🪨', colour: '#b9ad98', edge: '#8f9a6a', perTile: { scrap: 1 }, unlock: { home: true } },
  { id: 'steppingStones', name: 'Stepping stones', icon: '🪨', colour: '#a9a39a', edge: '#7fa05a', perTile: { scrap: 1 }, unlock: { home: true }, pieces: 'stones' },
  { id: 'woodChip', name: 'Wood chip', icon: '🪵', colour: '#9c7650', edge: '#7a8a50', perTile: { timber: 1 }, unlock: { keeper: 'saltwind' } },
  { id: 'sandTrail', name: 'Sand trail', icon: '🏖️', colour: '#e3cf9c', edge: '#cdb57e', perTile: {}, unlock: { keeper: 'saltwind' }, sandOnly: true },
  { id: 'boardwalk', name: 'Boardwalk', icon: '🛶', colour: '#a87a4e', edge: '#7b5a3a', perTile: { planks: 1 }, unlock: { research: 'dc-boardwalk' }, overWater: true, pieces: 'planks' },
  { id: 'oldBrick', name: 'Old brick', icon: '🧱', colour: '#b0644a', edge: '#86865a', perTile: { clay: 1 }, unlock: { find: 'c-oldMarket-2' } },
  { id: 'mossyCobbles', name: 'Mossy cobbles', icon: '🟩', colour: '#8e9682', edge: '#6f9a45', perTile: { scrap: 1, seeds: 1 }, unlock: { research: 'dc-cobbles' } },
];

export const PATH_MATERIAL: Record<PathMaterial, PathMaterialDef> = Object.fromEntries(PATH_MATERIALS.map((m) => [m.id, m])) as Record<PathMaterial, PathMaterialDef>;

export const PATHS = {
  /** widths, in tiles: a narrow trail … a wide promenade */
  widths: [0.8, 1.4, 2, 3],
  /** at most this many points on one path, and at most this many paths */
  maxPoints: 24,
  maxPaths: 120,
  /** a point may be at most this far from the one before it (tiles) */
  maxSegment: 16,
  /** curve samples per tile of length (the decal and the tiles it covers) */
  samplesPerTile: 3,
  /** sprinting on a path costs this share of the usual charge (E23.2.1 reads `sim.paths.onPath`) */
  sprintChargeShare: 0.6,
  /** the decal's edge: this share of the width blends into the grass */
  edgeBlend: 0.25,
  /** the decal sits this far above the ground (no z-fighting) */
  lift: 0.025,
  /** moss and flowers creep onto a path's edges: a clump every this many tiles along each edge once fully crept,
   *  creeping in over this many game days (a game day is 2880 s of play) */
  creepEvery: 0.9,
  creepDays: 2,
  daySeconds: 2880,
};
