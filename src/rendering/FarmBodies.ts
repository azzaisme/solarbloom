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

/** E23.5.4: a stacked wooden beehive (three boxes and a roof) on a stand. */
export function beehiveBody(b: pc.Entity) {
  const wood = mat(PALETTE.woodPlank, { gloss: 0.2 });
  const pale = mat(PALETTE.stoneCreamTop, { gloss: 0.3 });
  for (const x of [-0.18, 0.18]) for (const z of [-0.14, 0.14]) shape(b, 'box', mat(PALETTE.woodDead), { pos: [x, 0.09, z], scale: [0.05, 0.18, 0.05] });
  for (let i = 0; i < 3; i++) shape(b, 'box', i % 2 ? pale : wood, { pos: [0, 0.24 + i * 0.14, 0], scale: [0.46, 0.13, 0.38], shadow: true });
  shape(b, 'box', mat(PALETTE.terracotta), { pos: [0, 0.68, 0], scale: [0.54, 0.05, 0.46], shadow: true });
  // the entrance slot
  shape(b, 'box', mat(PALETTE.darkFace), { pos: [0, 0.2, 0.192], scale: [0.2, 0.025, 0.01] });
}

/** E23.5.4: a round stone-edged pond (its water and fish are drawn live). */
export function fishPondBody(b: pc.Entity) {
  shape(b, 'torus', mat(PALETTE.stoneCream), { pos: [0, 0.06, 0], scale: [0.86, 0.22, 0.86], shadow: true });
  shape(b, 'cylinder', mat(PALETTE.soilDark), { pos: [0, 0.02, 0], scale: [0.78, 0.03, 0.78] });
  for (const [x, z] of [[0.3, 0.22], [-0.28, -0.2]] as const) shape(b, 'cone', mat(PALETTE.stemLeaf), { pos: [x, 0.16, z], scale: [0.05, 0.26, 0.05] });
}

/**
 * E23.5.4 (#785): the ground a fruit tree stands in: a ring of cream stones round a bed of dark mulch. The tree, its
 * flowers and its fruit are drawn live (CropVisuals, TreeGen's orchard tree).
 */
export function orchardBody(b: pc.Entity) {
  shape(b, 'cylinder', mat(PALETTE.orchard.mulch), { pos: [0, 0.015, 0], scale: [0.62, 0.03, 0.62] });
  const stone = mat(PALETTE.stoneCream);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    shape(b, 'sphere', stone, { pos: [Math.cos(a) * 0.33, 0.035, Math.sin(a) * 0.33], rot: [0, i * 37, 0], scale: [0.11, 0.07, 0.09], shadow: true });
  }
}

/** E23.5.4: a mossy log lying on the ground (its mushrooms are drawn live). */
export function mushroomLogBody(b: pc.Entity) {
  shape(b, 'cylinder', mat(PALETTE.trunk), { pos: [0, 0.14, 0], rot: [0, 0, 90], scale: [0.26, 0.74, 0.26], shadow: true });
  shape(b, 'cylinder', mat(PALETTE.woodPlank), { pos: [0.372, 0.14, 0], rot: [0, 0, 90], scale: [0.22, 0.01, 0.22] });
  shape(b, 'box', mat(PALETTE.mossDark), { pos: [-0.1, 0.27, 0], scale: [0.4, 0.02, 0.16] });
}

/** E23.5.4: a lidded wooden worm bin with air holes. */
export function wormBinBody(b: pc.Entity) {
  shape(b, 'box', mat(PALETTE.woodPlank, { gloss: 0.2 }), { pos: [0, 0.2, 0], scale: [0.56, 0.4, 0.42], shadow: true });
  shape(b, 'box', mat(PALETTE.woodDead), { pos: [0, 0.42, 0], scale: [0.6, 0.04, 0.46], shadow: true });
  for (const x of [-0.16, 0, 0.16]) shape(b, 'cylinder', mat(PALETTE.darkFace), { pos: [x, 0.28, 0.212], rot: [90, 0, 0], scale: [0.04, 0.01, 0.04] });
}

/** E23.5.4: a bird box on a post, round hole and a perch. */
export function birdBoxBody(b: pc.Entity) {
  shape(b, 'cylinder', mat(PALETTE.woodDead), { pos: [0, 0.4, 0], scale: [0.06, 0.8, 0.06], shadow: true });
  shape(b, 'box', mat(PALETTE.woodPlank), { pos: [0, 0.9, 0], scale: [0.24, 0.26, 0.22], shadow: true });
  shape(b, 'box', mat(PALETTE.terracotta), { pos: [0, 1.05, 0], rot: [0, 0, 0], scale: [0.3, 0.04, 0.28] });
  shape(b, 'cylinder', mat(PALETTE.darkFace), { pos: [0, 0.94, 0.112], rot: [90, 0, 0], scale: [0.07, 0.01, 0.07] });
  shape(b, 'cylinder', mat(PALETTE.woodDead), { pos: [0, 0.86, 0.14], rot: [90, 0, 0], scale: [0.015, 0.06, 0.015] });
}

/** E23.5.4: a tall, narrow bat box on a post, open at the bottom. */
export function batBoxBody(b: pc.Entity) {
  shape(b, 'cylinder', mat(PALETTE.woodDead), { pos: [0, 0.5, 0], scale: [0.06, 1.0, 0.06], shadow: true });
  shape(b, 'box', mat(PALETTE.woodPlank), { pos: [0, 1.05, 0.04], scale: [0.26, 0.36, 0.1], shadow: true });
  shape(b, 'box', mat(PALETTE.woodDead), { pos: [0, 1.25, 0.04], scale: [0.3, 0.04, 0.14] });
  shape(b, 'box', mat(PALETTE.darkFace), { pos: [0, 0.875, 0.04], scale: [0.2, 0.01, 0.06] });
}

/** E23.5.4: a low domed hedgehog house of sticks and leaves. */
export function hedgehogHouseBody(b: pc.Entity) {
  shape(b, 'sphere', mat(PALETTE.woodPlank, { gloss: 0.15 }), { pos: [0, 0.1, 0], scale: [0.6, 0.36, 0.5], shadow: true });
  shape(b, 'sphere', mat(PALETTE.shrubLeaf[0]), { pos: [-0.1, 0.22, -0.05], scale: [0.36, 0.14, 0.3] });
  shape(b, 'box', mat(PALETTE.darkFace), { pos: [0, 0.07, 0.24], scale: [0.14, 0.12, 0.04] });
}

/** E23.5.4: a ring of bright flowers round a flat feeding stone. */
export function butterflyGardenBody(b: pc.Entity) {
  shape(b, 'cylinder', mat(PALETTE.soil), { pos: [0, 0.03, 0], scale: [0.84, 0.06, 0.84] });
  shape(b, 'cylinder', mat(PALETTE.stoneCream), { pos: [0, 0.07, 0], scale: [0.2, 0.04, 0.2] });
  const colours = [PALETTE.flowerCosmos[0], PALETTE.flowerLavender[0], PALETTE.flowerDaisy[1], PALETTE.flowerSunflower[0]];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = 0.3;
    shape(b, 'cylinder', mat(PALETTE.stemLeaf), { pos: [Math.cos(a) * r, 0.12, Math.sin(a) * r], scale: [0.015, 0.16, 0.015] });
    shape(b, 'sphere', mat(colours[i % colours.length]), { pos: [Math.cos(a) * r, 0.22, Math.sin(a) * r], scale: 0.08 });
  }
}
