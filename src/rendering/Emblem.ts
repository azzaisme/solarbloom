import type { GoalKind } from '../gameplay/Advisor';
import { PALETTE } from './Palette';

/**
 * The Solarbloom lotus: the game's logo, and the waymark's emblem (#609 follow-up). The beam says where to go, the
 * lotus says what for: a tall centre petal, side petals fanning out, low petals cupping its base, on a pad of leaves,
 * with the goal's symbol marked in the heart of the centre petal: a bolt to rest, a spanner for a pile, a sprout for
 * the park, a drop for the fountain, an archway for a way in, a heart for a Keeper, a sun for a landmark, a gear for a
 * machine, a little bloom for anywhere else.
 *
 * Pure geometry, no engine, one source: rendering/Waymark turns it into glowing meshes, `lotusSvg()` into the logo
 * on the title screen and the page's icon. Shapes are in the x/y plane, y up, the lotus standing on y = 0.
 */

/** A flat glowing shape: `pos` x, y pairs; `col` r, g, b, a (0 … 1, sRGB) per vertex; `idx` triangles. */
export interface Flat {
  pos: number[];
  col: number[];
  idx: number[];
}

type Rgba = [number, number, number, number];

function rgba(hex: string, a = 1): Rgba {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

/** The emblem's colours (sRGB, from the palette). */
export const EMBLEM_COLORS = PALETTE.signal.emblem;

class Builder {
  readonly f: Flat = { pos: [], col: [], idx: [] };
  vert(x: number, y: number, c: Rgba): number {
    this.f.pos.push(x, y);
    this.f.col.push(...c);
    return this.f.pos.length / 2 - 1;
  }
  tri(a: number, b: number, c: number) {
    this.f.idx.push(a, b, c);
  }
  /** A fan from `centre` round `pts` (closed when `loop`): any shape every edge of which the centre can see. */
  fan(cx: number, cy: number, cc: Rgba, pts: [number, number][], pc: Rgba | Rgba[], loop = true) {
    const c = this.vert(cx, cy, cc);
    const first = this.f.pos.length / 2;
    pts.forEach(([x, y], i) => this.vert(x, y, Array.isArray(pc[0]) ? (pc as Rgba[])[i] : (pc as Rgba)));
    const n = pts.length;
    for (let i = 0; i < (loop ? n : n - 1); i++) this.tri(c, first + i, first + ((i + 1) % n));
  }
  /** A straight stroke from a to b, `w` wide. */
  line(ax: number, ay: number, bx: number, by: number, w: number, c: Rgba) {
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * (w / 2);
    const ny = (dx / l) * (w / 2);
    const a = this.vert(ax + nx, ay + ny, c);
    const b = this.vert(ax - nx, ay - ny, c);
    const d = this.vert(bx - nx, by - ny, c);
    const e = this.vert(bx + nx, by + ny, c);
    this.tri(a, b, d);
    this.tri(a, d, e);
  }
  /** A stroke along a circle (angles in radians, a0 → a1), `w` wide. */
  arc(cx: number, cy: number, r: number, w: number, a0: number, a1: number, c: Rgba, seg = 24) {
    const inner: number[] = [];
    const outer: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      inner.push(this.vert(cx + Math.cos(a) * (r - w / 2), cy + Math.sin(a) * (r - w / 2), c));
      outer.push(this.vert(cx + Math.cos(a) * (r + w / 2), cy + Math.sin(a) * (r + w / 2), c));
    }
    for (let i = 0; i < seg; i++) {
      this.tri(inner[i], outer[i], outer[i + 1]);
      this.tri(inner[i], outer[i + 1], inner[i + 1]);
    }
  }
  disc(cx: number, cy: number, r: number, centre: Rgba, edge: Rgba = centre, seg = 24) {
    const pts: [number, number][] = [];
    for (let i = 0; i < seg; i++) pts.push([cx + Math.cos((i / seg) * Math.PI * 2) * r, cy + Math.sin((i / seg) * Math.PI * 2) * r]);
    this.fan(cx, cy, centre, pts, edge);
  }
  /**
   * A stroke along a polyline, `w` wide, with round joints and ends. `soft`: the stroke fades to nothing at its edges
   * (a glow round a line) instead of having hard edges.
   */
  stroke(pts: [number, number][], w: number, c: Rgba, soft = false) {
    const edge: Rgba = soft ? [c[0], c[1], c[2], 0] : c;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const l = Math.hypot(bx - ax, by - ay) || 1;
      const nx = (-(by - ay) / l) * (w / 2);
      const ny = ((bx - ax) / l) * (w / 2);
      const a0 = this.vert(ax + nx, ay + ny, edge);
      const a1 = this.vert(ax, ay, c);
      const a2 = this.vert(ax - nx, ay - ny, edge);
      const b0 = this.vert(bx + nx, by + ny, edge);
      const b1 = this.vert(bx, by, c);
      const b2 = this.vert(bx - nx, by - ny, edge);
      this.tri(a0, a1, b1);
      this.tri(a0, b1, b0);
      this.tri(a1, a2, b2);
      this.tri(a1, b2, b1);
    }
    for (const [x, y] of pts) this.disc(x, y, w / 2, c, edge, 10);
  }
  /** A leaf or petal: pointed at both ends, from a to b, `w` wide at its widest, with softly rounded sides. */
  leaf(ax: number, ay: number, bx: number, by: number, w: number, base: Rgba, tip: Rgba, mid: Rgba = base) {
    const SEG = 12;
    const mix = (t: number): Rgba => {
      const [p, q, k] = t < 0.45 ? [base, mid, t / 0.45] : [mid, tip, (t - 0.45) / 0.55];
      return p.map((v, i) => v + (q[i] - v) * k) as Rgba;
    };
    const pts = petalOutline(ax, ay, bx, by, w, SEG);
    // the outline runs base, one side, tip, the other side: each point's colour follows how far up the petal it is
    const ts = [0, ...Array.from({ length: SEG - 1 }, (_, i) => (i + 1) / SEG), 1, ...Array.from({ length: SEG - 1 }, (_, i) => (SEG - 1 - i) / SEG)];
    this.fan(ax + (bx - ax) * 0.45, ay + (by - ay) * 0.45, mid, pts, ts.map(mix));
  }
}

/**
 * A petal's (or leaf's) outline: base, up one side, the tip, down the other side. Round-bellied, widest a little
 * below the middle, `w` across at its widest.
 */
export function petalOutline(ax: number, ay: number, bx: number, by: number, w: number, seg = 8): [number, number][] {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  const side = (t: number) => (w / 2) * Math.pow(Math.sin(Math.PI * t), 0.75) * (1.08 - 0.16 * t);
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 1; i < seg; i++) {
    const t = i / seg;
    left.push([ax + dx * t + nx * side(t), ay + dy * t + ny * side(t)]);
    right.push([ax + dx * t - nx * side(t), ay + dy * t - ny * side(t)]);
  }
  return [[ax, ay], ...left, [bx, by], ...right.reverse()];
}

/** One petal (or leaf) of the lotus: from its base `a` to its tip `b`, `w` across. Listed back to front. */
interface PetalDef {
  a: [number, number];
  b: [number, number];
  w: number;
  leaf?: boolean;
}

const mirror = (p: PetalDef): PetalDef[] => [p, { ...p, a: [-p.a[0], p.a[1]], b: [-p.b[0], p.b[1]] }];

/** The lotus, back to front: the leaf pad, the outer petals, the side petals, the centre petal, the low cupping petals. */
export const LOTUS: readonly PetalDef[] = [
  { a: [-1.1, 0.02], b: [1.1, 0.02], w: 0.32, leaf: true },
  ...mirror({ a: [0.12, 0.08], b: [0.92, 0.64], w: 0.4 }),
  ...mirror({ a: [0.05, 0.08], b: [0.5, 1.04], w: 0.46 }),
  { a: [0, 0.06], b: [0, 1.28], w: 0.64 },
  ...mirror({ a: [0.05, 0.06], b: [0.66, 0.3], w: 0.32 }),
];

/** Where the goal's symbol sits (the heart of the centre petal) and how big it is drawn there. */
export const HEART = { x: 0, y: 0.55, scale: 0.68 } as const;

/** The symbol keeps inside this radius (drawn at HEART.scale in the lotus). */
export const SYMBOL_RADIUS = 0.38;

/** True if (x, y) is inside the closed polygon. */
function inside(x: number, y: number, poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** One line of the lotus outline: a run of points, and whether it belongs to the leaf pad. */
export interface LotusLine {
  pts: [number, number][];
  leaf: boolean;
}

/**
 * The lotus as an outline drawing: every petal's (and the leaf pad's) edge, with the stretches that lie behind a petal
 * in front of it left out, so it reads as one flower in line, not a tangle of crossing shapes. The one lotus line: the
 * waymark's emblem and the logo both draw these.
 */
export function lotusLines(seg = 40): LotusLine[] {
  const shapes = LOTUS.map((p) => petalOutline(p.a[0], p.a[1], p.b[0], p.b[1], p.w, seg));
  const lines: LotusLine[] = [];
  LOTUS.forEach((p, i) => {
    const ring = shapes[i];
    const front = shapes.slice(i + 1);
    // walk the closed edge, finely, keeping the runs that no petal in front covers
    const fine: [number, number][] = [];
    for (let k = 0; k < ring.length; k++) {
      const [ax, ay] = ring[k];
      const [bx, by] = ring[(k + 1) % ring.length];
      for (let t = 0; t < 4; t++) fine.push([ax + ((bx - ax) * t) / 4, ay + ((by - ay) * t) / 4]);
    }
    const seen = fine.map(([x, y]) => !front.some((f) => inside(x, y, f)));
    const runs: [number, number][][] = [];
    let run: [number, number][] = [];
    fine.forEach((pt, k) => {
      if (seen[k]) run.push(pt);
      else if (run.length) {
        runs.push(run);
        run = [];
      }
    });
    if (run.length) {
      // the edge is a loop: a run still open at the end carries on into the first one
      if (runs.length && seen[0]) runs[0] = [...run, ...runs[0]];
      else runs.push(seen.every(Boolean) ? [...run, run[0]] : run);
    }
    for (const r of runs) if (r.length > 1) lines.push({ pts: r, leaf: !!p.leaf });
  });
  return lines;
}

/** How wide the lotus's line is (the painted core), and the soft glow round it (lotus units). */
export const LINE = { core: 0.075, light: 0.04, glow: 0.24 } as const;

/** The lotus's light: a soft mint halo, a soft glow along every line and a bright thread down its middle. */
export function emblemFrame(): Flat {
  const b = new Builder();
  const C = EMBLEM_COLORS;
  b.disc(0, 0.55, 1.35, rgba(C.halo, 0.22), rgba(C.halo, 0), 32);
  const lines = lotusLines();
  for (const l of lines) b.stroke(l.pts, LINE.glow, rgba(l.leaf ? C.leaf : C.petalTip, 0.55), true);
  for (const l of lines) b.stroke(l.pts, LINE.light, rgba(l.leaf ? C.leafHeart : C.petalBase, 0.95));
  return b.f;
}

/**
 * The lotus's painted line under its light: gold petals and green leaves, as the logo has them. By day it gives the
 * glow something solid to shine from, so the lotus reads against a pale sky, sand and paving; at night it fades back
 * and the lotus is all light. Drawn as paint, not light.
 */
export function emblemBacking(): Flat {
  const b = new Builder();
  const C = EMBLEM_COLORS;
  for (const l of lotusLines()) b.stroke(l.pts, LINE.core, rgba(l.leaf ? C.bodyLeaf : C.bodyBase, 1));
  return b.f;
}

/** The logo: the lotus outline as an SVG (the title screen's badge and the page's icon), from the same lines. */
export function lotusSvg(): string {
  const C = EMBLEM_COLORS;
  const f = (n: number) => +n.toFixed(3);
  const lines = lotusLines(24);
  const path = (ls: LotusLine[]) => ls.map((l) => 'M' + l.pts.map(([x, y]) => `${f(x)} ${f(-y)}`).join('L')).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.2 -1.4 2.4 1.64" fill="none" stroke-width="0.09" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${path(lines.filter((l) => l.leaf))}" stroke="${C.logoLeafEdge}"/>` +
    `<path d="${path(lines.filter((l) => !l.leaf))}" stroke="${C.logoEdge}"/>` +
    `</svg>`
  );
}

/**
 * The symbol for a goal's kind (inside SYMBOL_RADIUS), in the centre petal: `paint` is its solid gold (by day; deep
 * blue for rest, so low charge stands apart), `light` its glow (white-gold; cyan for rest).
 */
export function emblemSymbol(kind: GoalKind, tone: 'paint' | 'light' = 'paint'): Flat {
  const b = new Builder();
  const C = EMBLEM_COLORS;
  const c = rgba(tone === 'paint' ? (kind === 'rest' ? C.rest : C.symbol) : kind === 'rest' ? C.restGlow : C.symbolGlow, tone === 'paint' ? 1 : 0.9);
  const TAU = Math.PI * 2;
  switch (kind) {
    case 'rest': {
      // a bolt: two slanted wedges meeting in the middle
      b.fan(0.02, 0.1, c, [[0.13, 0.34], [-0.15, -0.03], [0.07, -0.01]], c);
      b.fan(-0.02, -0.1, c, [[-0.13, -0.34], [0.15, 0.03], [-0.07, 0.01]], c);
      break;
    }
    case 'pile': {
      // a spanner: handle, an open jaw at the top right, a round end
      b.line(-0.19, -0.19, 0.1, 0.1, 0.15, c);
      b.arc(0.15, 0.15, 0.11, 0.11, Math.PI / 4 + 0.95, Math.PI / 4 + TAU - 0.95, c, 18);
      b.disc(-0.2, -0.2, 0.09, c);
      break;
    }
    case 'park': {
      // a sprout: a stem and two leaves
      b.line(0, -0.3, 0, 0.06, 0.1, c);
      b.leaf(0, 0.02, -0.25, 0.2, 0.2, c, c);
      b.leaf(0, 0.06, 0.24, 0.26, 0.2, c, c);
      break;
    }
    case 'fountain': {
      // a water drop
      const pts: [number, number][] = [[0, 0.34]];
      for (let i = 0; i <= 16; i++) {
        const a = Math.PI * 0.2 - (i / 16) * Math.PI * 1.4;
        pts.push([Math.cos(a) * 0.2, -0.1 + Math.sin(a) * 0.2]);
      }
      b.fan(0, -0.06, c, pts, c);
      break;
    }
    case 'gate': {
      // an open archway on a step
      b.line(-0.16, -0.22, -0.16, 0.05, 0.12, c);
      b.line(0.16, -0.22, 0.16, 0.05, 0.12, c);
      b.arc(0, 0.05, 0.16, 0.12, 0, Math.PI, c, 16);
      b.line(-0.21, -0.26, 0.21, -0.26, 0.09, c);
      break;
    }
    case 'keeper': {
      // a heart
      const pts: [number, number][] = [];
      for (let i = 0; i < 40; i++) {
        const t = (i / 40) * TAU;
        const x = 16 * Math.sin(t) ** 3;
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push([x * 0.019, y * 0.019 + 0.03]);
      }
      b.fan(0, 0.02, c, pts, c);
      break;
    }
    case 'landmark': {
      // a sun: a disc and eight rays
      b.disc(0, 0, 0.14, c);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const [ca, sa] = [Math.cos(a), Math.sin(a)];
        b.fan(ca * 0.27, sa * 0.27, c, [[ca * 0.2 - sa * 0.045, sa * 0.2 + ca * 0.045], [ca * 0.34, sa * 0.34], [ca * 0.2 + sa * 0.045, sa * 0.2 - ca * 0.045]], c);
      }
      break;
    }
    case 'machine': {
      // a gear: a ring with eight teeth
      b.arc(0, 0, 0.18, 0.13, 0, TAU, c, 32);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        b.line(Math.cos(a) * 0.2, Math.sin(a) * 0.2, Math.cos(a) * 0.32, Math.sin(a) * 0.32, 0.12, c);
      }
      break;
    }
    default: {
      // anywhere else: a little bloom
      b.disc(0, 0, 0.1, c);
      for (let i = 0; i < 5; i++) {
        const a = Math.PI / 2 + (i / 5) * TAU;
        b.leaf(Math.cos(a) * 0.1, Math.sin(a) * 0.1, Math.cos(a) * 0.33, Math.sin(a) * 0.33, 0.14, c, c);
      }
    }
  }
  return b.f;
}

/** Every goal kind (so tests and the shader warm-up see each symbol). */
export const GOAL_KINDS: GoalKind[] = ['rest', 'pile', 'park', 'fountain', 'gate', 'keeper', 'landmark', 'machine', 'spot'];

/** A place the waymark stands or a goal stands on. */
export interface Spot {
  roofId: string;
  x: number;
  z: number;
  kind: GoalKind;
}

/**
 * The game says something was done (`kinds`: the goal kinds that deed finishes; `where`: where it happened, when the
 * game knows). Was it the goal the waymark stands on? Only when the waymark had shown there, the deed finishes that
 * kind of goal, and it happened at the spot (within `reach` cells), or, with no place given, bloombot stood there.
 * Resting is not an objective, so it never blooms. A goal merely moving on (the advisor picking another pile or way
 * in as bloombot walks) is not a goal done: only the game's own events count.
 */
export function doneHere(
  at: Spot | undefined,
  kinds: readonly GoalKind[],
  where: { roofId?: string; x: number; z: number } | undefined,
  bot: { roofId: string; x: number; z: number } | undefined,
  reach: number,
  seen: boolean,
): boolean {
  if (!at || !seen || at.kind === 'rest' || !kinds.includes(at.kind)) return false;
  const p = where ?? bot;
  if (!p) return false;
  if ((p.roofId ?? at.roofId) !== at.roofId) return false;
  return Math.hypot(p.x - at.x, p.z - at.z) <= reach;
}
