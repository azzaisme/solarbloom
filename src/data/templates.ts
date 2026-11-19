// City 12.1 / 12.4: rooftop layouts the generator places on rooftop-cluster areas. These were the three fixed
// rooftops of the original campaign (the Seed, the Reservoir and the Canopy); now they are templates.
// Coordinates are roof-local integer grid cells (x, z).

export interface RoofTemplate {
  id: string;
  name: string;
  /** short label */
  short: string;
  width: number;
  depth: number;
  /** obstacles (vents, drains, stumps) */
  blocked: [number, number][];
  /** mossy tiles to start on */
  prepared: [number, number][];
  /** roof-local cell of its Core (the area's landmark) */
  core: [number, number];
}

export const ROOF_TEMPLATES: Record<string, RoofTemplate> = {
  seed: {
    id: 'seed',
    name: 'Old Ferry Building',
    short: 'The Seed',
    width: 8,
    depth: 8,
    blocked: [[7, 0], [0, 7]],
    prepared: [[3, 4], [4, 4], [4, 5]],
    core: [0, 0],
  },
  reservoir: {
    id: 'reservoir',
    name: 'The Reservoir',
    short: 'Reservoir',
    width: 8,
    depth: 8,
    blocked: [[7, 0], [0, 0]],
    prepared: [[0, 6], [1, 7]],
    core: [5, 2],
  },
  canopy: {
    id: 'canopy',
    name: 'The Canopy',
    short: 'Canopy',
    width: 10,
    depth: 8,
    blocked: [[0, 0], [1, 7]],
    prepared: [[9, 2], [8, 1]],
    core: [4, 3],
  },
};

/** A Lucky Cat hiding place: a position on a layer, valid while a tile is free. */
export interface CatAnchor {
  id: string;
  roofId: string;
  /** layer-local position; y is height above the surface */
  pos: [number, number, number];
  rotY: number;
  /** anchor is only valid while this tile is free of machines */
  needsFreeTile?: [number, number];
  hint: string;
}

/** The park's hand-placed nooks (cleared city areas add generated ones). */
export const CAT_ANCHORS: CatAnchor[] = [
  { id: 'park-bench', roofId: 'g', pos: [3.5, 0.08, 7.25], rotY: 210, needsFreeTile: [3, 7], hint: 'under a park bench' },
  { id: 'bandstand-steps', roofId: 'g', pos: [11.6, 0.08, 4.25], rotY: 200, needsFreeTile: [11, 4], hint: 'on the bandstand steps' },
  { id: 'fountain-rim', roofId: 'g', pos: [9.25, 0.08, 8.4], rotY: 230, needsFreeTile: [9, 8], hint: 'by the fountain rim' },
  { id: 'toppled-lamp', roofId: 'g', pos: [5.3, 0.08, 12.5], rotY: 220, needsFreeTile: [5, 12], hint: 'beside the toppled lamp' },
  { id: 'hedge-gap', roofId: 'g', pos: [0.35, 0.08, 10.5], rotY: 250, needsFreeTile: [0, 10], hint: 'in a gap in the hedge' },
];
