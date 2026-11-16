/**
 * Look 3 (#105): small plants as cached geometry templates — grass clumps (3.3), flower species (3.4), leafy and
 * flowering shrubs (3.6), ivy and vines (3.8) and banners (3.10).
 *
 * Pure geometry in the tree template format (`TreeGeo`: x, y, z, flex per vertex; linear RGBA bytes), so the chunk
 * renderer stamps them into its merged, wind-swaying foliage mesh (one draw call per chunk) and Look 6's
 * transition hooks can stamp the same templates on their own. Flex is 0 at the roots and rises toward tips and
 * cloth hems; the foliage shader's wind sways by it (Foliage.ts).
 *
 * Cards (leaves, petals, blades, cloth) are emitted with both windings, so they read from every side without a
 * second, double-sided material.
 */
import {
  Buf, puff, tube, plate, hsl, hex, mix, scaleC, add, mul, norm, cross, rng, card, leafShell, randDir, setShrubBuilder,
  type TreeGeo, type Lod, type V, type C,
} from './TreeGen';

export { card, leafShell };

/** A thin tapered blade (one triangle each side). */
function blade(B: Buf, p: V, tipP: V, w: number, face: V, col: C, tipC: C, flex: number) {
  const dir = norm(add(tipP, mul(p, -1)));
  const side = norm(cross(dir, face));
  const n = norm(add(mul([0, 1, 0], 0.7), mul(face, 0.3)));
  const l = add(p, mul(side, w / 2));
  const r = add(p, mul(side, -w / 2));
  const a = B.v(l, n, col, 0), b = B.v(r, n, col, 0), c = B.v(tipP, n, tipC, flex);
  B.tri(a, b, c);
  B.tri(a, c, b);
}

const UP: V = [0, 1, 0];

// ───────────── grass (3.3) ─────────────

/** Grass colours by tile stage (1 Restored pale … 4 Radiant warm). */
const GRASS_HUE = [0, 92, 104, 110, 96];
/** Dry weeds poking out of dead ground (stage 0). */
export function buildGrass(stage: number, variant: number, lod: Lod): TreeGeo {
  const B = new Buf();
  const R = rng(variant * 4099 + stage * 31 + 5);
  const n = lod === 2 ? 16 : lod === 1 ? 11 : 5;
  const dead = stage === 0;
  const tall = dead ? 0.1 : stage === 1 ? 0.08 : 0.13;
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2;
    const d = R() * 0.09;
    const p: V = [Math.cos(a) * d, 0, Math.sin(a) * d];
    const h = tall * (0.55 + R() * 0.6);
    // blades lean outward from the clump's heart, a few spilling well over (edges overhang neighbours)
    const lean = 0.25 + R() * 0.5;
    const tipP: V = [p[0] + Math.cos(a) * h * lean, h, p[2] + Math.sin(a) * h * lean];
    const hue = dead ? 52 + R() * 18 : GRASS_HUE[stage] + (R() - 0.5) * 16;
    const base = dead ? hsl(hue, 22, 34) : hsl(hue + 8, 52, 26 + R() * 6);
    const tip = dead ? hsl(hue - 8, 30, 58) : hsl(hue - 12, 62, (stage === 1 ? 62 : 50) + R() * 10);
    blade(B, p, tipP, 0.016 + R() * 0.01, norm([-Math.sin(a), 0, Math.cos(a)]), base, tip, 0.35 + h * 3);
  }
  return B.done();
}

// ───────────── flowers (3.4) ─────────────

export type FlowerSpecies = 'daisy' | 'cosmos' | 'lavender' | 'sunflower' | 'wild';
export const FLOWER_SPECIES: FlowerSpecies[] = ['daisy', 'cosmos', 'lavender', 'sunflower', 'wild'];
/** Petal colours per species (one per clump, Look 2.4 will own the exact values). */
export const FLOWER_COLOURS: Record<FlowerSpecies, string[]> = {
  daisy: ['#ffffff', '#fff4c9', '#ffe066'],
  cosmos: ['#ff7eb6', '#e0479e', '#ffc1dc', '#ff9a5a'],
  lavender: ['#9a78e0', '#b48cff', '#7f8ce8'],
  sunflower: ['#ffd23f', '#ffb52e'],
  wild: ['#ffffff', '#ffd23f', '#8fb8ff', '#ff9fd0'],
};
const STEM = hex('#3f8f36');
const STEM_DARK = hex('#2f6e2b');
const LEAF = hex('#4f9a3a');
const LEAF_LIGHT = hex('#86c45a');

/**
 * A flower head: one star-shaped fan of petals round a centre disc, facing `face` (single-sided: the camera looks
 * down on it; `twoSided` for heads turned sideways, like sunflowers). ~2 triangles per petal.
 */
function head(B: Buf, c: V, face: V, petals: number, L: number, w: number, col: C, centre: C, cr: number, flex: number, cup: number, R: () => number, twoSided = false) {
  const ax = norm(Math.abs(face[1]) < 0.9 ? cross(face, UP) : cross(face, [1, 0, 0]));
  const ay = cross(face, ax);
  const off = R() * Math.PI;
  const notch = cr + Math.min(L * 0.7, w * 0.55);
  for (const side of twoSided ? [1, -1] : [1]) {
    const n = mul(face, side);
    const lift = mul(face, 0.002 * side);
    const ctr = B.v(add(c, lift), n, scaleC(col, 0.9), flex);
    const ring: number[] = [];
    for (let i = 0; i < petals * 2; i++) {
      const a = off + (i / (petals * 2)) * Math.PI * 2;
      const tip = i % 2 === 0;
      const r = tip ? cr + L : notch;
      const d = add(mul(ax, Math.cos(a) * r), mul(ay, Math.sin(a) * r));
      const p = add(add(c, d), mul(face, tip ? L * cup : 0));
      ring.push(B.v(p, n, tip ? mix(col, [1, 1, 1], 0.12) : col, flex * (tip ? 1.1 : 1)));
    }
    for (let i = 0; i < ring.length; i++) {
      if (side > 0) B.tri(ctr, ring[i], ring[(i + 1) % ring.length]);
      else B.tri(ctr, ring[(i + 1) % ring.length], ring[i]);
    }
    // the centre disc, a touch proud
    const cc = B.v(add(c, mul(face, 0.004 * side)), n, centre, flex);
    const cring: number[] = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      cring.push(B.v(add(add(c, mul(face, 0.003 * side)), add(mul(ax, Math.cos(a) * cr), mul(ay, Math.sin(a) * cr))), n, scaleC(centre, 0.8), flex));
    }
    for (let i = 0; i < 5; i++) {
      if (side > 0) B.tri(cc, cring[i], cring[(i + 1) % 5]);
      else B.tri(cc, cring[(i + 1) % 5], cring[i]);
    }
  }
}

/** A stem: one thin tapered blade each side (2 triangles). */
function stem(B: Buf, base: V, top: V, r: number, flex: number) {
  blade(B, base, top, r * 2.2, norm([0.6, 0, 0.8]), STEM_DARK, STEM, flex);
}

/**
 * A clump of one species in one colour. `open` false = buds (Blooming's first flowers); sizes in tiles follow the
 * reference: most flowers 0.08–0.2 tall, sunflowers and spikes up to ~0.35.
 */
export function buildFlowers(sp: FlowerSpecies, colour: number, open: boolean, variant: number, lod: Lod): TreeGeo {
  const B = new Buf();
  const R = rng(variant * 7717 + FLOWER_SPECIES.indexOf(sp) * 131 + colour * 17 + (open ? 3 : 0));
  const pc = hex(FLOWER_COLOURS[sp][colour % FLOWER_COLOURS[sp].length]);
  const detail = lod > 0;
  const plants = sp === 'sunflower' ? 2 : sp === 'wild' ? 7 : sp === 'lavender' ? 6 : sp === 'daisy' ? 6 : 4;
  const spread = sp === 'sunflower' ? 0.07 : 0.09;
  const grow = open ? 1 : 0.7;
  for (let i = 0; i < plants; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * spread;
    const base: V = [Math.cos(a) * d, 0, Math.sin(a) * d];
    const lean: V = [(R() - 0.5) * 0.04, 0, (R() - 0.5) * 0.04];
    const H = grow * (sp === 'sunflower' ? 0.28 + R() * 0.07 : sp === 'lavender' ? 0.17 + R() * 0.13 : sp === 'cosmos' ? 0.12 + R() * 0.08 : sp === 'daisy' ? 0.06 + R() * 0.05 : 0.03 + R() * 0.04);
    const top: V = add(add(base, [0, H, 0]), lean);
    const fx = 0.5 + H * 2.2;
    stem(B, base, top, sp === 'sunflower' ? 0.008 : 0.0035, fx);
    // leaves low on the stem
    if (detail && sp !== 'wild') {
      const nl = sp === 'sunflower' ? 2 : 1;
      for (let k = 0; k < nl; k++) {
        const la = R() * Math.PI * 2;
        const y = H * (0.15 + 0.35 * R());
        const dir = norm([Math.cos(la), 0.5 + R() * 0.4, Math.sin(la)]);
        const Ls = sp === 'sunflower' ? 0.075 : sp === 'lavender' ? 0.045 : 0.035;
        card(B, add(base, [lean[0] * (y / H), y, lean[2] * (y / H)]), dir, UP, Ls, Ls * (sp === 'lavender' ? 0.25 : 0.55), LEAF, LEAF_LIGHT, fx * 0.3, fx * 0.6);
      }
    }
    if (!open) {
      // a closed bud, green with a hint of its colour
      const bc = mix(hex('#5aa045'), pc, 0.45);
      if (sp === 'lavender') for (let k = 0; k < 3; k++) puff(B, { c: add(top, [0, -k * 0.018, 0]), r: [0.007, 0.012, 0.007], base: bc, light: mix(bc, pc, 0.4), dark: scaleC(bc, 0.7), flex: fx, seed: k, detail: 0, lump: 0 });
      else puff(B, { c: top, r: [0.012, 0.016, 0.012].map((v) => v * (sp === 'sunflower' ? 2 : 1)) as V, base: bc, light: mix(bc, pc, 0.5), dark: scaleC(bc, 0.7), flex: fx, seed: i, detail: 0, lump: 0 });
      continue;
    }
    switch (sp) {
      case 'daisy': {
        const face = norm([(R() - 0.5) * 0.6, 1, (R() - 0.5) * 0.6]);
        head(B, top, face, detail ? 10 : 6, 0.024, 0.009, pc, hex('#ffcf3a'), 0.009, fx, 0.12, R);
        break;
      }
      case 'cosmos': {
        const face = norm([(R() - 0.5) * 0.8, 1, (R() - 0.5) * 0.8]);
        head(B, top, face, detail ? 7 : 5, 0.032, 0.022, pc, hex('#ffd23f'), 0.008, fx, 0.2, R);
        break;
      }
      case 'sunflower': {
        // a big head turned toward the sun / camera side
        const face = norm([0.45 + (R() - 0.5) * 0.3, 0.55, 0.7 + (R() - 0.5) * 0.3]);
        head(B, top, face, detail ? 14 : 9, 0.036, 0.016, pc, hex('#6b3f1f'), 0.03, fx, 0.05, R, true);
        break;
      }
      case 'lavender': {
        // a spike of small buds round the top third of the stem
        const n = detail ? 12 : 6;
        for (let k = 0; k < n; k++) {
          const y = H * (0.62 + 0.38 * (k / n));
          const ba = k * 2.4 + R();
          const p = add(base, [lean[0] * (y / H), y, lean[2] * (y / H)]);
          const dir = norm([Math.cos(ba), 0.9, Math.sin(ba)]);
          const s = 0.016 * (1 - 0.4 * (k / n));
          blade(B, p, add(p, mul(dir, s * 1.6)), s, norm([-dir[2], 0, dir[0]]), scaleC(pc, 0.8 + 0.25 * R()), mix(pc, [1, 1, 1], 0.25), fx);
        }
        break;
      }
      default: {
        // filler: tiny four-petal dots
        const face = norm([(R() - 0.5) * 0.5, 1, (R() - 0.5) * 0.5]);
        const col = hex(FLOWER_COLOURS.wild[(colour + i) % FLOWER_COLOURS.wild.length]);
        head(B, top, face, 5, 0.011, 0.008, col, hex('#ffe28a'), 0.004, fx, 0.15, R);
      }
    }
  }
  return B.done();
}

// ───────────── shrubs (3.6) ─────────────

/** A leafy shrub of 2–3 overlapping clusters with twigs; `flowering` adds bougainvillea-style blossom masses. */
export function buildLeafyShrub(variant: number, lod: Lod, flowering = false): TreeGeo {
  const B = new Buf();
  const R = rng(variant * 9973 + (flowering ? 501 : 7));
  const h = 96 + R() * 30;
  const base = hsl(h, 52, 33), light = hsl(h - 20, 62, 52), dark = hsl(h + 16, 45, 17);
  const n = 2 + Math.floor(R() * 2);
  const bloom = [hex('#e0479e'), hex('#ff7eb6'), hex('#ff9fd0'), hex('#f45d8a')][variant % 4];
  for (let i = 0; i < n; i++) {
    const s = 0.11 + R() * 0.07;
    const a = R() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.09 + R() * 0.08;
    const c: V = [Math.cos(a) * d, s * 0.8, Math.sin(a) * d];
    const r: V = [s, s * 0.82, s];
    // Look 3.6: rounded leaf clusters with dark crevices (no cards: nothing pointy), twigs, and blossom clusters
    puff(B, { c, r, base, light, dark, flex: 0.25, seed: R() * 1e9, detail: lod === 0 ? 0 : 2, lump: 0.3, clusters: lod === 0 ? 0 : 6 });
    if (lod > 0) {
      for (let k = 0; k < 2; k++) {
        const u = randDir(R, 0.2);
        tube(B, [[c[0], 0, c[2]], add(c, mul(u, s * 1.02))], [0.006, 0.003], 3, [hex('#6b4a32'), hex('#7d5a3c')], [0, 0.3], false);
      }
      if (flowering)
        for (let k = 0; k < 6; k++) {
          const u = randDir(R, 0.15);
          const p = add(c, [u[0] * r[0] * 0.95, u[1] * r[1] * 0.95, u[2] * r[2] * 0.95]);
          const fr = 0.035 + R() * 0.015;
          puff(B, { c: p, r: [fr, fr * 0.8, fr], base: scaleC(bloom, 0.95), light: mix(bloom, [1, 1, 1], 0.25), dark: scaleC(bloom, 0.7), flex: 0.35, seed: k, detail: 1, lump: 0 });
        }
    } else if (flowering) puff(B, { c: add(c, [0, s * 0.4, 0]), r: [s * 0.7, s * 0.5, s * 0.7], base: bloom, light: mix(bloom, [1, 1, 1], 0.2), dark: scaleC(bloom, 0.7), flex: 0.3, seed: i, detail: 0, lump: 0.2 });
  }
  return B.done();
}

// ───────────── vines and ivy (3.8) ─────────────

/**
 * One tile of ivy hanging from an edge: strands run down from y = 0 along the x = 0…1 edge, on the z = 0 face,
 * leaves facing +z. `stage` 0 dead (sparse, dry, short) … 4 lush with flowers; `hang` the drop in tiles.
 */
export function buildVine(stage: number, hang: number, variant: number, lod: Lod): TreeGeo {
  const B = new Buf();
  const R = rng(variant * 6151 + stage * 97 + Math.round(hang * 10));
  const dead = stage === 0;
  const strands = dead ? 2 : stage >= 3 ? 5 : 3;
  const grow = dead ? 0.35 : [0, 0.45, 0.7, 1, 1.1][stage];
  for (let i = 0; i < strands; i++) {
    const x0 = (i + 0.2 + R() * 0.6) / strands;
    const L = hang * grow * (0.5 + R() * 0.6);
    const drift = (R() - 0.5) * 0.12;
    const pts: V[] = [[x0, 0.02, 0.03], [x0 + drift * 0.5, -L * 0.5, 0.035], [x0 + drift, -L, 0.03]];
    const vc = dead ? hex('#6b5a45') : hex('#4e7a34');
    tube(B, pts, [0.006, 0.005, 0.003], 3, [vc, vc, vc], [0, 0.35, 0.7], false);
    const leaves = Math.min(dead ? 5 : 14, Math.max(1, Math.round((L / 0.05) * (dead ? 0.4 : lod === 0 ? 0.35 : 1))));
    for (let k = 0; k < leaves; k++) {
      const t = (k + 0.5) / leaves;
      const p: V = [x0 + drift * t + (R() - 0.5) * 0.03, -L * t, 0.04 + R() * 0.02];
      const side = k % 2 ? 1 : -1;
      const dir = norm([side * (0.5 + R() * 0.5), -0.3 + R() * 0.5, 0.35 + R() * 0.3]);
      const s = (dead ? 0.045 : 0.065 + R() * 0.035) * (stage === 1 ? 0.75 : 1) * Math.max(1, L / (leaves * 0.05));
      const hue = 92 + R() * 26;
      const col = dead ? hsl(36 + R() * 14, 30, 38 + R() * 10) : hsl(hue, 52, 30 + R() * 14);
      const tip = dead ? hsl(30, 35, 50) : hsl(hue - 14, 60, 52);
      // broad, ivy-like leaves (wide near the base)
      card(B, p, dir, [0, 0, 1], s, s * 0.85, col, tip, 0.2 + t * 0.6, 0.3 + t * 0.7, 0.38, 0.12);
      if (stage >= 3 && !dead && lod > 0 && R() < 0.22) {
        const fc = hex(['#ff7eb6', '#ffffff', '#ff9fd0', '#ffd23f'][Math.floor(R() * 4)]);
        head(B, add(p, [0, 0, 0.02]), norm([0, 0.2, 1]), 5, 0.018, 0.014, fc, hex('#ffe28a'), 0.006, 0.3 + t * 0.7, 0.2, R);
      }
    }
  }
  // a creeping run along the top edge, so the vine reads attached
  if (!dead || R() < 0.5) {
    const n = lod === 0 ? 3 : dead ? 3 : 7;
    for (let k = 0; k < n; k++) {
      const x = (k + R()) / n;
      const dir = norm([R() - 0.5, 0.6, 0.6]);
      const s = dead ? 0.04 : 0.06;
      card(B, [x, 0.01, 0.03], dir, [0, 0, 1], s, s * 0.85, dead ? hsl(40, 30, 40) : hsl(100 + R() * 20, 50, 34), dead ? hsl(34, 30, 52) : hsl(90, 60, 50), 0.1, 0.25, 0.38, 0.12);
    }
  }
  return B.done();
}

// ───────────── banners (3.10) ─────────────

const GOLD = hex('#e8ba40');
/**
 * A sun-emblem banner. `kind` 'pole': on a pole with a gold finial (base at the origin, cloth on +x);
 * 'rail': cloth hanging from a rail at y = 0. Dead banners are faded and torn. Cloth sways (flex grows to the hem).
 */
export function buildBanner(kind: 'pole' | 'rail', alive: boolean, variant: number, lod: Lod): TreeGeo {
  const B = new Buf();
  const cloth = alive ? hex(['#f2b13a', '#f5c04a', '#eaa233'][variant % 3]) : hex('#a89a80');
  const emblem = alive ? hex('#fff3d0') : hex('#c8bea8');
  const W = kind === 'pole' ? 0.2 : 0.28;
  const Hc = (kind === 'pole' ? 0.36 : 0.32) * (alive ? 1 : 0.8);
  let topY = 0;
  let x0 = 0;
  if (kind === 'pole') {
    const H = 0.95;
    tube(B, [[0, 0, 0], [0, H, 0]], [0.014, 0.011], 5, [hex('#5d4a3a'), hex('#6e5a48')], [0, 0.05], false);
    puff(B, { c: [0, H + 0.025, 0], r: [0.024, 0.03, 0.024], base: alive ? GOLD : hex('#8f8160'), light: hex('#fff1b8'), dark: scaleC(GOLD, 0.7), flex: 0.05, seed: 1, detail: 1, lump: 0 });
    tube(B, [[0, H - 0.03, 0], [W + 0.02, H - 0.03, 0]], [0.007, 0.007], 4, [hex('#5d4a3a'), hex('#5d4a3a')], [0.05, 0.08], false);
    topY = H - 0.04;
    x0 = 0.02;
  } else {
    x0 = -W / 2;
    topY = -0.01;
  }
  // cloth: a 3 × 5 grid, flex rising toward the hem and the free edge
  const cols = lod === 0 ? 1 : 3;
  const rows = lod === 0 ? 2 : 5;
  const vtx = (front: boolean) => {
    const ids: number[] = [];
    const nz = front ? 1 : -1;
    for (let r = 0; r <= rows; r++)
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const v = r / rows;
        const torn = !alive && r === rows && c % 2 === 1 ? -0.05 : 0;
        const wave = Math.sin(u * 3 + v * 2) * 0.01;
        const p: V = [x0 + u * W, topY - v * Hc - torn, wave * nz * 0 + wave];
        const shade = 0.9 + 0.1 * Math.sin(u * 4 + v * 3);
        ids.push(B.v(p, [0, 0, nz], scaleC(front ? cloth : scaleC(cloth, 0.8), shade), 0.15 + v * 0.75 + (kind === 'pole' ? u * 0.25 : 0)));
      }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const a = ids[r * (cols + 1) + c], b = ids[r * (cols + 1) + c + 1], cc = ids[(r + 1) * (cols + 1) + c], d = ids[(r + 1) * (cols + 1) + c + 1];
        if (front) {
          B.tri(a, cc, b);
          B.tri(b, cc, d);
        } else {
          B.tri(a, b, cc);
          B.tri(b, d, cc);
        }
      }
  };
  vtx(true);
  vtx(false);
  if (lod > 0) {
    // the sun emblem on both faces: a disc and rays
    const ec: V = [x0 + W / 2, topY - Hc * 0.48, 0];
    for (const s of [1, -1]) {
      const f: V = [0, 0, s];
      plate(B, add(ec, [0, 0, 0.012 * s]), W * 0.17, f, emblem, 0.5, 10);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const dir: V = [Math.cos(a), Math.sin(a), 0];
        card(B, add(add(ec, mul(dir, W * 0.21)), [0, 0, 0.012 * s]), dir, f, W * 0.13, W * 0.07, emblem, emblem, 0.5, 0.55, 0.3, 0);
      }
    }
  }
  return B.done();
}

// ───────────── caches ─────────────

setShrubBuilder((v, lod) => buildLeafyShrub(v, lod)); // far-zoom and planter shrubs are leafy too


const cache = new Map<string, TreeGeo>();
const get = (key: string, make: () => TreeGeo) => {
  let g = cache.get(key);
  if (!g) cache.set(key, (g = make()));
  return g;
};
export const FLORA_VARIANTS = 4;
export const grassGeo = (stage: number, variant: number, lod: Lod) => get(`g|${stage}|${variant % FLORA_VARIANTS}|${lod}`, () => buildGrass(stage, variant % FLORA_VARIANTS, lod));
export const flowerGeo = (sp: FlowerSpecies, colour: number, open: boolean, variant: number, lod: Lod) =>
  get(`f|${sp}|${colour % FLOWER_COLOURS[sp].length}|${open}|${variant % 3}|${lod}`, () => buildFlowers(sp, colour % FLOWER_COLOURS[sp].length, open, variant % 3, lod));
export const leafyShrubGeo = (variant: number, lod: Lod, flowering = false) => get(`s|${variant % 6}|${lod}|${flowering}`, () => buildLeafyShrub(variant % 6, lod, flowering));
export const vineGeo = (stage: number, hang: number, variant: number, lod: Lod) => {
  const hq = Math.max(1, Math.min(6, Math.round(hang * 4))) / 4; // hang in quarter tiles
  return get(`v|${stage}|${hq}|${variant % FLORA_VARIANTS}|${lod}`, () => buildVine(stage, hq, variant % FLORA_VARIANTS, lod));
};
export const bannerGeo = (kind: 'pole' | 'rail', alive: boolean, variant: number, lod: Lod) => get(`b|${kind}|${alive}|${variant % 3}|${lod}`, () => buildBanner(kind, alive, variant % 3, lod));

/** Everything the ground uses at normal detail, so the caches fill ahead of need (a slice per frame). */
export function* warmFlora(): Generator<void> {
  for (let st = 0; st <= 4; st++) for (let v = 0; v < FLORA_VARIANTS; v++) (grassGeo(st, v, 1), grassGeo(st, v, 2));
  yield;
  for (const sp of FLOWER_SPECIES)
    for (let c = 0; c < FLOWER_COLOURS[sp].length; c++)
      for (let v = 0; v < 3; v++) {
        flowerGeo(sp, c, true, v, 1);
        flowerGeo(sp, c, false, v, 1);
        yield;
      }
  for (let v = 0; v < 6; v++) {
    leafyShrubGeo(v, 1);
    leafyShrubGeo(v, 1, true);
    yield;
  }
}

