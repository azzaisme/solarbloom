import type * as pc from 'playcanvas';
import { mat, PALETTE } from './Materials';
import { shape } from './Shapes';

/**
 * E23.5.3: the compost bin and the Bio Digester, built from primitives in the machines' Look 3.12 style (cream
 * ceramic, brass trim, warm wood) until E23.10 (#466) brings their hand-built models. Their live state (the heap,
 * the fertiliser ready, the digester's glow) is drawn by CropVisuals on top.
 */

/** A slatted wooden bin, open at the top, on a low stone footing. */
export function compostBinBody(b: pc.Entity) {
  const wood = mat(PALETTE.woodPlank, { gloss: 0.2 });
  const dark = mat(PALETTE.woodDead, { gloss: 0.2 });
  shape(b, 'box', mat(PALETTE.stoneCream), { pos: [0, 0.04, 0], scale: [0.84, 0.08, 0.84], shadow: true });
  // corner posts
  for (const x of [-0.36, 0.36]) for (const z of [-0.36, 0.36]) shape(b, 'box', dark, { pos: [x, 0.33, z], scale: [0.08, 0.58, 0.08], shadow: true });
  // slats on four sides, with gaps (air for the heap)
  for (let i = 0; i < 4; i++) {
    const y = 0.15 + i * 0.13;
    shape(b, 'box', wood, { pos: [0, y, -0.36], scale: [0.66, 0.09, 0.04], shadow: true });
    shape(b, 'box', wood, { pos: [0, y, 0.36], scale: [0.66, 0.09, 0.04], shadow: true });
    shape(b, 'box', wood, { pos: [-0.36, y, 0], scale: [0.04, 0.09, 0.66], shadow: true });
    shape(b, 'box', wood, { pos: [0.36, y, 0], scale: [0.04, 0.09, 0.66], shadow: true });
  }
  // a brass band round the top
  shape(b, 'box', mat(PALETTE.brass, { metal: 0.6, gloss: 0.7 }), { pos: [0, 0.6, -0.385], scale: [0.8, 0.025, 0.012] });
  shape(b, 'box', mat(PALETTE.brass, { metal: 0.6, gloss: 0.7 }), { pos: [0, 0.6, 0.385], scale: [0.8, 0.025, 0.012] });
}

/** A cream ceramic dome tank on a footing, a brass pipe into the ground, and a round window that glows when it runs. */
export function digesterBody(b: pc.Entity) {
  const cream = mat(PALETTE.shell, { gloss: 0.45 });
  const seam = mat(PALETTE.shellLow, { gloss: 0.3 });
  const brass = mat(PALETTE.brass, { metal: 0.6, gloss: 0.75 });
  shape(b, 'box', mat(PALETTE.stoneCream), { pos: [0, 0.05, 0], scale: [0.86, 0.1, 0.86], shadow: true });
  shape(b, 'cylinder', cream, { pos: [0, 0.32, 0], scale: [0.66, 0.44, 0.66], shadow: true });
  shape(b, 'sphere', cream, { pos: [0, 0.54, 0], scale: [0.66, 0.4, 0.66], shadow: true });
  shape(b, 'cylinder', seam, { pos: [0, 0.54, 0], scale: [0.68, 0.03, 0.68] });
  shape(b, 'cylinder', brass, { pos: [0, 0.12, 0], scale: [0.7, 0.03, 0.7] });
  // the feed hatch on top, and the gas pipe
  shape(b, 'cylinder', brass, { pos: [0, 0.75, 0], scale: [0.2, 0.06, 0.2] });
  shape(b, 'cylinder', brass, { pos: [0.3, 0.42, 0.2], scale: [0.06, 0.5, 0.06] });
  shape(b, 'box', brass, { pos: [0.3, 0.68, 0.1], scale: [0.06, 0.06, 0.24] });
  // window frame (the glass is drawn by CropVisuals, lit while running)
  shape(b, 'torus', brass, { pos: [0, 0.34, 0.335], rot: [90, 0, 0], scale: [0.2, 0.05, 0.2] });
}
