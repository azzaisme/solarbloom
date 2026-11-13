// Data-defined rooftop layouts. Coordinates are roof-local integer grid cells.

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

export interface RooftopDef {
  id: string;
  name: string;
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
}

export const ROOFTOPS: RooftopDef[] = [
  {
    id: 'r1',
    name: 'Old Ferry Building',
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
    name: 'Greenhouse Tower',
    width: 6,
    depth: 6,
    height: 1.2,
    origin: [11, 0, -4.5],
    unlocked: false,
    preview: true,
    blocked: [],
    prepared: [],
  },
];

export const PARAPET_TOP = 0.32;

export const CAT_ANCHORS: CatAnchor[] = [
  { id: 'vent-east', roofId: 'r1', pos: [7.82, 0.08, 0.85], rotY: 225, needsFreeTile: [7, 0], hint: 'beside the east vent' },
  { id: 'vent-west', roofId: 'r1', pos: [0.85, 0.08, 7.82], rotY: 225, needsFreeTile: [0, 7], hint: 'beside the west vent' },
  { id: 'parapet-back', roofId: 'r1', pos: [5.2, PARAPET_TOP, -0.12], rotY: 200, hint: 'on the back railing' },
  { id: 'parapet-left', roofId: 'r1', pos: [-0.12, PARAPET_TOP, 4.6], rotY: 250, hint: 'on the left railing' },
  { id: 'rain-barrel', roofId: 'r1', pos: [6.55, PARAPET_TOP, -0.12], rotY: 210, hint: 'by the rain barrel' },
  { id: 'corner-ledge', roofId: 'r1', pos: [8.12, PARAPET_TOP, 8.12], rotY: 45, hint: 'on the front corner ledge' },
  { id: 'core-step', roofId: 'r1', pos: [2.1, 0.08, 0.2], rotY: 200, needsFreeTile: [2, 0], hint: 'by the Core' },
];
