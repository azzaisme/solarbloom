import { PALETTE } from './Palette';
import { Buf, hex, mix, scaleC, tube, rng, type C, type TreeGeo, type V } from './TreeGen';

/**
 * #hedge-line (owner, 27 Nov 2026): one metre of a dead laid hedge, the wall round ground Bloombot can't enter yet.
 * Built like an English laid hedge gone wild: thick stems cut near the root and bent over at about 35°, all leaning
 * the same way in two close layers; upright stakes; a twisted binding woven along the top; then years of neglect on
 * top of that: dead whips shooting up out of it and thorny canes arching over its foot. No leaves: nothing round it
 * has been brought back yet. Built along +x from x 0 to 1 (its stems reach on into the next metre, so a row of them
 * reads as one wall), centred on z 0, standing on y 0. About 1.4 tall at the binding, 2.4 with the whips.
 */
export function laidHedge(variant: number): TreeGeo {
  const k = ((variant % 12) + 12) % 12;
  let g = cache.get(k);
  if (!g) cache.set(k, (g = build(k)));
  return g;
}
const cache = new Map<number, TreeGeo>();

/** Dead wood colours: grey-brown bark, darker in the cuts, paler on the whips, red-brown thorny canes. */
function woods() {
  const W = PALETTE.hedge;
  return { bark: hex(W.bark), dark: hex(W.barkDark), stake: hex(W.stake), whip: hex(W.whip), cane: hex(W.cane) };
}

function build(variant: number): TreeGeo {
  const R = rng(9137 + variant * 7919);
  const B = new Buf(3, false);
  const W = woods();
  const jit = (c: C, a = 0.12): C => scaleC(c, 1 - a / 2 + R() * a);
  const pts = (n: number, f: (t: number) => V): V[] => Array.from({ length: n }, (_, i) => f(i / (n - 1)));
  const ramp = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => a + (b - a) * (i / (n - 1)));

  // the laid stems (pleachers): two close layers, most bent over the same way, every one writhing and twisting round
  // its neighbours (owner: more randomness and twisting); now and then a gnarled old one, or one laid the other way
  for (let layer = 0; layer < 2; layer++) {
    const z0 = layer ? 0.08 : -0.08;
    const n = 4 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const back = R() < 0.18 ? -1 : 1;
      const x0 = back > 0 ? (i + R() * 0.8) / n - 0.1 : 0.4 + R() * 0.7;
      const y0 = 0.03 + R() * 0.35 + layer * 0.06;
      const ang = ((18 + R() * 34) * Math.PI) / 180;
      const L = 1.0 + R() * 1.2;
      const gnarl = R() < 0.15 ? 1.5 : 1;
      // the twist: a wobble across the hedge and up and down, a few turns along the stem
      const turns = 0.8 + R() * 2;
      const tw = (0.05 + R() * 0.09) * gnarl;
      const ph = R() * Math.PI * 2;
      const sag = (R() - 0.3) * 0.25;
      const N = 9;
      const P = pts(N, (t) => {
        const a = t * turns * Math.PI * 2 + ph;
        return [
          x0 + back * Math.cos(ang) * L * t,
          y0 + Math.sin(ang) * L * t + Math.sin(Math.PI * t) * sag + Math.cos(a) * tw * 0.6 * t,
          z0 + Math.sin(a) * tw * (0.3 + t) + (R() - 0.5) * 0.025,
        ];
      });
      const c = jit(mix(W.bark, W.dark, R() * 0.6), 0.2);
      tube(B, P, ramp(N, 0.05 * gnarl, 0.013), 4, P.map(() => c), ramp(N, 0, 0.05));
      // dead side shoots off the laid stem, kinked, pointing up (what a laid stem sends up when it's left)
      const shoots = Math.floor(R() * 4);
      for (let s = 0; s < shoots; s++) {
        const at = P[2 + Math.floor(R() * (N - 3))];
        const h = 0.15 + R() * 0.4;
        const lean = (R() - 0.5) * 0.6;
        const lz = (R() - 0.5) * 0.25;
        const Q = pts(4, (u) => [at[0] + lean * h * u + (R() - 0.5) * 0.04, at[1] + h * u, at[2] + lz * h * u + (R() - 0.5) * 0.04]);
        tube(B, Q, [0.015, 0.01, 0.007, 0.003], 3, Q.map(() => jit(W.whip, 0.2)), [0.03, 0.08, 0.12, 0.16], false);
      }
    }
  }

  // stakes: two to the metre, a little out of true
  // (one or two to the metre, out of true, some snapped short)
  for (const sx of R() < 0.35 ? [0.3 + R() * 0.4] : [0.15 + R() * 0.2, 0.6 + R() * 0.25]) {
    const x = sx;
    const H = R() < 0.2 ? 0.6 + R() * 0.4 : 1.2 + R() * 0.3;
    const lx = (R() - 0.5) * 0.2;
    const lz = (R() - 0.5) * 0.16;
    const P = pts(3, (t) => [x + lx * t, H * t, (R() - 0.5) * 0.02 + lz * t]);
    const c = jit(W.stake);
    tube(B, P, [0.034, 0.03, 0.026], 5, P.map(() => c), [0, 0, 0]);
  }

  // the binding: two strands twisted round each other along the top, weaving past the stakes
  for (const ph of [0, Math.PI]) {
    const P = pts(9, (t) => {
      const a = t * Math.PI * 4 + ph + variant;
      return [-0.03 + t * 1.06, 1.24 + 0.06 * Math.sin(a) + (R() - 0.5) * 0.02, 0.07 * Math.cos(a)];
    });
    const c = jit(mix(W.bark, W.whip, 0.3));
    tube(B, P, ramp(9, 0.022, 0.022), 4, P.map(() => c), ramp(9, 0.02, 0.02), false);
  }

  // dead whips: years of unpruned growth spiking up out of the top
  // (short, crooked and leaning every which way: long straight ones read as a fence of spears)
  const whips = 4 + Math.floor(R() * 3);
  for (let i = 0; i < whips; i++) {
    const x = R();
    const y0 = 0.95 + R() * 0.3;
    const L = 0.3 + R() * 0.45;
    const lean = (R() - 0.5) * 1.1;
    const lz = (R() - 0.5) * 0.45;
    const curl = (R() - 0.5) * 0.5;
    const P = pts(5, (t) => [x + lean * L * t + curl * t * t + (t > 0 ? (R() - 0.5) * 0.08 : 0), y0 + L * t * (1 - 0.25 * t * Math.abs(lean)), (R() - 0.5) * 0.08 + lz * L * t + (t > 0 ? (R() - 0.5) * 0.06 : 0)]);
    const c = jit(mix(W.whip, W.bark, R() * 0.4));
    tube(B, P, ramp(5, 0.022, 0.004), 3, P.map(() => c), ramp(5, 0.04, 0.3), false);
    // a twig or two off it
    for (let f = 0; f < 2; f++) {
      if (R() < 0.3) continue;
      const at = P[2 + f];
      const side = R() < 0.5 ? -1 : 1;
      const Q = pts(3, (u) => [at[0] + side * (0.1 + R() * 0.1) * u, at[1] + (0.1 + R() * 0.1) * u, at[2] + (R() - 0.5) * 0.12 * u]);
      tube(B, Q, [0.009, 0.006, 0.003], 3, Q.map(() => c), [0.15, 0.25, 0.35], false);
    }
  }

  // thorny canes arching over the hedge's foot, both sides
  for (let i = 0; i < 4; i++) {
    const side = i % 2 ? 1 : -1;
    const x = R() * 0.8;
    const reach = 0.35 + R() * 0.35;
    const top = 0.4 + R() * 0.45;
    const run = 0.3 + R() * 0.5;
    const P = pts(6, (t) => [x + run * t, Math.sin(Math.PI * Math.min(1, t * 1.15)) * top + 0.02, side * (0.08 + reach * t)]);
    const c = jit(W.cane);
    tube(B, P, ramp(6, 0.016, 0.006), 3, P.map(() => c), ramp(6, 0.02, 0.12), false);
    // thorns: short dark spikes along it
    for (let t = 1; t < 5; t++) {
      const p = P[t];
      const d: V = [(R() - 0.5) * 0.06, 0.05 + R() * 0.03, side * 0.03];
      tube(B, [p, [p[0] + d[0], p[1] + d[1], p[2] + d[2]]], [0.006, 0.001], 3, [W.dark, W.dark], [0.05, 0.05], false);
    }
  }
  return B.done();
}
