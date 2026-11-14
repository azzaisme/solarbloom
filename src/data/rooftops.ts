// Data-defined rooftop layouts. Coordinates are roof-local integer grid cells (x, z).
// Every tile has a stable key `roofId:x:z`; world placement comes only from `origin` + `height`.

export interface CatAnchor {
  id: string;
  roofId: string;
  /** roof-local position; y is height above the roof surface */
  pos: [number, number, number];
  rotY: number;
  /** anchor is only valid while this tile is free of machines */
  needsFreeTile?: [number, number];
  hint: string;
}

export type RoofSpecialty = 'starter' | 'reservoir' | 'canopy';

export interface RooftopDef {
  id: string;
  name: string;
  /** short label for HUD chips */
  short: string;
  specialty: RoofSpecialty;
  width: number;
  depth: number;
  height: number;
  origin: [number, number, number];
  unlocked: boolean;
  preview: boolean;
  blocked: [number, number][];
  prepared: [number, number][];
  core?: [number, number];
  starterSolar?: [number, number];
  /** Link that has to be built before this roof is playable (undefined for the Seed). */
  unlockLink?: string;
  /** Dead ground here is tougher: pulse costs are multiplied (dry clay, matted roots). */
  pulseCostMult?: number;
}

/**
 * An explicit cross-roof connection. The bridge is the visual link; the relay pylons at each end are the
 * mechanical connection. Pylons stand just outside the grid; `fromTile` / `toTile` are the edge tiles whose
 * neighbourhood (Manhattan ≤ relay.zoneRadius) charges the relay.
 */
export interface RoofLinkDef {
  id: string;
  name: string;
  from: string;
  to: string;
  fromTile: [number, number];
  toTile: [number, number];
  cost: { biomass: number; energy: number };
  /** Rooftop Core that must be awake before this link can be built. */
  requiresCore: string;
  /**
   * A visible milestone on the near rooftop: this share of its open garden tiles (no machine on them)
   * grown to full bloom. A share, so building more machines can never make it unreachable.
   */
  requiresFullBloom?: { roofId: string; share: number };
}

export const ROOFTOPS: RooftopDef[] = [
  {
    id: 'r1',
    name: 'Old Ferry Building',
    short: 'The Seed',
    specialty: 'starter',
    width: 8,
    depth: 8,
    height: 0,
    origin: [0, 0, 0],
    unlocked: true,
    preview: false,
    blocked: [
      [7, 0],
      [0, 7],
    ], // rusty vents
    prepared: [
      [3, 4],
      [4, 4],
      [4, 5],
    ],
    core: [0, 0],
    starterSolar: [3, 1],
  },
  {
    id: 'r2',
    name: 'The Reservoir',
    short: 'Reservoir',
    specialty: 'reservoir',
    width: 8,
    depth: 8,
    height: 1.2,
    origin: [11, 0, -5],
    unlocked: false,
    preview: true,
    blocked: [
      [7, 0],
      [0, 0],
    ], // dry overflow drains
    prepared: [
      [0, 6],
      [1, 7],
    ],
    core: [5, 2], // the Old Cistern
    unlockLink: 'seed-reservoir',
    pulseCostMult: 2,
  },
  {
    id: 'r3',
    name: 'The Canopy',
    short: 'Canopy',
    specialty: 'canopy',
    width: 10,
    depth: 8,
    height: -0.6,
    origin: [-13, 0, 4],
    unlocked: false,
    preview: true,
    blocked: [
      [0, 0],
      [1, 7],
    ], // dead stumps
    prepared: [
      [9, 2],
      [8, 1],
    ],
    core: [4, 3], // the Elder Tree
    unlockLink: 'seed-canopy',
    pulseCostMult: 2,
  },
];

export const ROOF_BY_ID: Record<string, RooftopDef> = Object.fromEntries(ROOFTOPS.map((r) => [r.id, r]));

export const LINKS: RoofLinkDef[] = [
  {
    id: 'seed-reservoir',
    name: 'Skybridge Relay',
    from: 'r1',
    to: 'r2',
    fromTile: [7, 2],
    toTile: [0, 7],
    cost: { biomass: 220, energy: 90 },
    requiresCore: 'r1',
    requiresFullBloom: { roofId: 'r1', share: 1 },
  },
  {
    id: 'seed-canopy',
    name: 'Canopy Bridge',
    from: 'r1',
    to: 'r3',
    fromTile: [0, 5],
    toTile: [9, 1],
    cost: { biomass: 300, energy: 140 },
    requiresCore: 'r2',
    requiresFullBloom: { roofId: 'r2', share: 0.75 },
  },
];

export const LINK_BY_ID: Record<string, RoofLinkDef> = Object.fromEntries(LINKS.map((l) => [l.id, l]));

export const PARAPET_TOP = 0.32;

export const CAT_ANCHORS: CatAnchor[] = [
  { id: 'vent-east', roofId: 'r1', pos: [7.82, 0.08, 0.85], rotY: 225, needsFreeTile: [7, 0], hint: 'beside the east vent' },
  { id: 'vent-west', roofId: 'r1', pos: [0.85, 0.08, 7.82], rotY: 225, needsFreeTile: [0, 7], hint: 'beside the west vent' },
  { id: 'parapet-back', roofId: 'r1', pos: [5.2, PARAPET_TOP, -0.12], rotY: 200, hint: 'on the back railing' },
  { id: 'parapet-left', roofId: 'r1', pos: [-0.12, PARAPET_TOP, 4.6], rotY: 250, hint: 'on the left railing' },
  { id: 'rain-barrel', roofId: 'r1', pos: [6.55, PARAPET_TOP, -0.12], rotY: 210, hint: 'by the rain barrel' },
  { id: 'corner-ledge', roofId: 'r1', pos: [8.12, PARAPET_TOP, 8.12], rotY: 45, hint: 'on the front corner ledge' },
  { id: 'between-solar', roofId: 'r1', pos: [2.82, 0.08, 1.18], rotY: 230, needsFreeTile: [2, 1], hint: 'between the solar panels' },
  { id: 'ac-unit', roofId: 'r1', pos: [1.35, 0.57, -0.85], rotY: 210, hint: 'on top of the old AC unit' },
  { id: 'crates', roofId: 'r1', pos: [-1.0, 0.99, 7.0], rotY: 240, hint: 'on the stacked crates' },
  { id: 'hut-roof', roofId: 'r1', pos: [5.55, 1.4, -0.55], rotY: 200, hint: 'on the stairwell roof' },
  { id: 'water-tower', roofId: 'r1', pos: [-0.72, 1.21, 3.75], rotY: 220, hint: 'under the water tower' },
  { id: 'core-step', roofId: 'r1', pos: [2.1, 0.08, 0.2], rotY: 200, needsFreeTile: [2, 0], hint: 'by the Core' },
  // The Reservoir
  { id: 'cistern-rim', roofId: 'r2', pos: [7.2, 0.08, 2.4], rotY: 220, needsFreeTile: [7, 2], hint: 'beside the Old Cistern' },
  { id: 'drain-nook', roofId: 'r2', pos: [0.85, 0.08, 0.6], rotY: 210, needsFreeTile: [1, 0], hint: 'by the dry drain' },
  { id: 'res-railing', roofId: 'r2', pos: [3.6, PARAPET_TOP, -0.12], rotY: 200, hint: 'on the Reservoir railing' },
  { id: 'res-corner', roofId: 'r2', pos: [8.12, PARAPET_TOP, 8.12], rotY: 45, hint: 'on the Reservoir front corner' },
  // The Canopy
  { id: 'stump-west', roofId: 'r3', pos: [0.82, 0.08, 0.85], rotY: 225, needsFreeTile: [1, 0], hint: 'beside the old stump' },
  { id: 'canopy-rail', roofId: 'r3', pos: [5.6, PARAPET_TOP, -0.12], rotY: 200, hint: 'on the Canopy back wall' },
  { id: 'canopy-left', roofId: 'r3', pos: [-0.12, PARAPET_TOP, 3.6], rotY: 250, hint: 'on the Canopy side wall' },
  { id: 'root-nook', roofId: 'r3', pos: [2.3, 0.08, 7.1], rotY: 230, needsFreeTile: [2, 7], hint: 'among the dead roots' },
  // The city park (ground layer, park cells)
  { id: 'park-bench', roofId: 'g', pos: [3.5, 0.08, 7.25], rotY: 210, needsFreeTile: [3, 7], hint: 'under a park bench' },
  { id: 'bandstand-steps', roofId: 'g', pos: [11.6, 0.08, 4.25], rotY: 200, needsFreeTile: [11, 4], hint: 'on the bandstand steps' },
  { id: 'fountain-rim', roofId: 'g', pos: [9.25, 0.08, 8.4], rotY: 230, needsFreeTile: [9, 8], hint: 'by the fountain rim' },
  { id: 'toppled-lamp', roofId: 'g', pos: [5.3, 0.08, 12.5], rotY: 220, needsFreeTile: [5, 12], hint: 'beside the toppled lamp' },
  { id: 'hedge-gap', roofId: 'g', pos: [0.35, 0.08, 10.5], rotY: 250, needsFreeTile: [0, 10], hint: 'in a gap in the hedge' },
];
