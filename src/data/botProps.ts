/**
 * #628: the little tools and things Bloombot holds while it acts (src/data/botActs.ts), built from primitives in
 * BotProps. Each is drawn in its grip frame, in world units:
 *
 *   +y  out of the fist, along the forearm
 *   +z  up, as near as the forearm allows (square to +y)
 *   +x  across the fist (+y × +z)
 *
 * so a shaft held upright through the fist runs along z, and a blade or a spout carries on along y. `tip` is where
 * an act's 'tool' effects come from (the trowel's blade, the can's spout, the bar's foot). `turn` tips the whole prop
 * in its grip frame (degrees, x then y then z).
 */
export type PropId = 'bar' | 'trowel' | 'can' | 'basket' | 'sack' | 'wrench' | 'flower' | 'page' | 'shell' | 'spyglass' | 'orb' | 'shears';
export type PropColour = 'metal' | 'metalDark' | 'wood' | 'cloth' | 'basket' | 'can' | 'brass' | 'paper' | 'stem' | 'petal' | 'core' | 'shell' | 'fruit' | 'glow';

export interface PropPiece {
  shape: 'box' | 'cylinder' | 'cone' | 'sphere';
  colour: PropColour;
  at: [number, number, number];
  /** box: its sizes; cylinder and cone: [width, length, width] along their own y; sphere: its sizes */
  size: [number, number, number];
  /** degrees, about x, y, z */
  euler?: [number, number, number];
}

export interface PropDef {
  pieces: PropPiece[];
  tip: [number, number, number];
  turn?: [number, number, number];
}

// cylinders and cones lie along their own y: [90, 0, 0] lays one along z, [0, 0, 90] along x
const ALONG_Z: [number, number, number] = [90, 0, 0];

export const PROPS: Record<PropId, PropDef> = {
  // a pry bar held upright through the fist: its hooked foot down in the rubble, its top up past the shoulder
  bar: {
    pieces: [
      { shape: 'cylinder', colour: 'metal', at: [0, 0, -0.04], size: [0.034, 0.86, 0.034], euler: ALONG_Z },
      { shape: 'box', colour: 'metalDark', at: [0, 0.05, -0.46], size: [0.036, 0.12, 0.034] },
    ],
    tip: [0, 0.08, -0.47],
    // tipped out past its shoulder, so the top shows from behind
    turn: [0, 48, 0],
  },
  // a garden trowel: wooden handle in the fist, a broad blade carrying on past it
  trowel: {
    pieces: [
      { shape: 'cylinder', colour: 'wood', at: [0, 0.02, 0], size: [0.034, 0.1, 0.034] },
      { shape: 'box', colour: 'metal', at: [0, 0.15, -0.01], size: [0.085, 0.16, 0.014] },
    ],
    tip: [0, 0.23, -0.01],
    turn: [-30, 0, 0],
  },
  // a little watering can hanging from its handle, spout out in front
  can: {
    pieces: [
      { shape: 'cylinder', colour: 'can', at: [0, 0.02, -0.1], size: [0.15, 0.14, 0.15], euler: ALONG_Z },
      { shape: 'cylinder', colour: 'brass', at: [0, 0.02, -0.025], size: [0.155, 0.015, 0.155], euler: ALONG_Z },
      { shape: 'cylinder', colour: 'can', at: [0, 0.14, -0.1], size: [0.024, 0.2, 0.024], euler: [-55, 0, 0] },
      { shape: 'cone', colour: 'brass', at: [0, 0.22, -0.045], size: [0.05, 0.04, 0.05], euler: [-55, 0, 0] },
    ],
    tip: [0, 0.24, -0.03],
  },
  // a basket hanging from the hand, a few picked things in it
  basket: {
    pieces: [
      { shape: 'cylinder', colour: 'basket', at: [0, 0, -0.15], size: [0.2, 0.1, 0.17], euler: ALONG_Z },
      { shape: 'box', colour: 'basket', at: [0.085, 0, -0.06], size: [0.014, 0.014, 0.13] },
      { shape: 'box', colour: 'basket', at: [-0.085, 0, -0.06], size: [0.014, 0.014, 0.13] },
      { shape: 'sphere', colour: 'fruit', at: [0.03, 0.02, -0.1], size: [0.06, 0.06, 0.06] },
      { shape: 'sphere', colour: 'stem', at: [-0.04, -0.01, -0.1], size: [0.07, 0.05, 0.06] },
    ],
    tip: [0, 0, -0.08],
  },
  // a cloth sack, held open by its neck
  sack: {
    pieces: [
      { shape: 'sphere', colour: 'cloth', at: [0, 0, -0.12], size: [0.17, 0.16, 0.19] },
      { shape: 'cylinder', colour: 'cloth', at: [0, 0, -0.03], size: [0.07, 0.05, 0.07], euler: ALONG_Z },
    ],
    tip: [0, 0, -0.02],
  },
  // a spanner, raised and brought down like a little hammer
  wrench: {
    pieces: [
      { shape: 'box', colour: 'metal', at: [0, 0.11, 0], size: [0.03, 0.22, 0.018] },
      { shape: 'box', colour: 'metalDark', at: [0, 0.23, 0], size: [0.085, 0.045, 0.024] },
    ],
    tip: [0, 0.24, 0],
  },
  // a flower to offer
  flower: {
    pieces: [
      { shape: 'cylinder', colour: 'stem', at: [0, 0.09, 0], size: [0.014, 0.18, 0.014] },
      { shape: 'sphere', colour: 'petal', at: [0, 0.19, 0], size: [0.09, 0.035, 0.09] },
      { shape: 'sphere', colour: 'core', at: [0, 0.205, 0], size: [0.035, 0.03, 0.035] },
    ],
    tip: [0, 0.2, 0],
    turn: [-20, 0, 0],
  },
  // a page held up to read
  page: {
    pieces: [{ shape: 'box', colour: 'paper', at: [0, 0.05, 0.03], size: [0.17, 0.012, 0.13] }],
    tip: [0, 0.05, 0.03],
    turn: [40, 0, 0],
  },
  // a shell held to its ear
  shell: {
    pieces: [{ shape: 'cone', colour: 'shell', at: [0, 0.06, 0], size: [0.07, 0.11, 0.07] }],
    tip: [0, 0.1, 0],
  },
  // a little brass spyglass
  spyglass: {
    pieces: [
      { shape: 'cylinder', colour: 'brass', at: [0, 0.08, 0], size: [0.04, 0.2, 0.04] },
      { shape: 'cylinder', colour: 'metalDark', at: [0, 0.19, 0], size: [0.05, 0.03, 0.05] },
    ],
    tip: [0, 0.2, 0],
  },
  // E27.2 (#680): garden shears, wooden handles in the fist and two long blades out in front, a little open
  shears: {
    pieces: [
      { shape: 'cylinder', colour: 'wood', at: [0.02, 0.03, 0], size: [0.03, 0.12, 0.03], euler: [0, 0, -8] },
      { shape: 'cylinder', colour: 'wood', at: [-0.02, 0.03, 0], size: [0.03, 0.12, 0.03], euler: [0, 0, 8] },
      { shape: 'cylinder', colour: 'brass', at: [0, 0.1, 0], size: [0.04, 0.02, 0.04], euler: ALONG_Z },
      { shape: 'box', colour: 'metal', at: [0.022, 0.21, 0], size: [0.022, 0.2, 0.01], euler: [0, 0, 6] },
      { shape: 'box', colour: 'metal', at: [-0.022, 0.21, 0], size: [0.022, 0.2, 0.01], euler: [0, 0, -6] },
    ],
    tip: [0, 0.3, 0],
    turn: [-20, 0, 0],
  },
  // a glow held out between its palms
  orb: {
    pieces: [{ shape: 'sphere', colour: 'glow', at: [0, 0.07, 0.03], size: [0.1, 0.1, 0.1] }],
    tip: [0, 0.07, 0.03],
  },
};
