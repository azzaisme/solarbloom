import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import { RUINS, type RuinKind, type RuinLayerName } from '../data/ruins';
import type { Sky } from './Sky';

type V3 = [number, number, number];
type V2 = [number, number];

/** sRGB hex → linear 0–1 (the ruins' colours go to the screen as the dome's do: encoded once on output). */
function lin(hex: string): V3 {
  const c = new pc.Color();
  c.fromString(hex);
  return [c.r ** 2.2, c.g ** 2.2, c.b ** 2.2];
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** One mesh's worth of flat-shaded convex pieces, with what the recolour needs per vertex. */
export class Geo {
  pos: number[] = [];
  nrm: number[] = [];
  alb: number[] = [];
  lamp: number[] = [];
  idx: number[] = [];

  /** A planar (or nearly) convex polygon, wound so it faces away from `inside`. */
  face(pts: V3[], inside: V3, col: V3, lamp = 0) {
    // Newell's normal: robust for slightly non-planar quads
    let n: V3 = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])];
    }
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9) return;
    n = scl(n, 1 / len);
    const c = scl(pts.reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / pts.length);
    if (dot(n, sub(c, inside)) < 0) {
      pts = [...pts].reverse();
      n = scl(n, -1);
    }
    const base = this.pos.length / 3;
    for (const p of pts) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.alb.push(col[0], col[1], col[2]);
      this.lamp.push(lamp);
    }
    for (let i = 1; i < pts.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
  }

  /** A convex polygon `front` swept along `off` (its two caps and the sides between). */
  hull(front: V3[], off: V3, col: V3, lamp = 0) {
    const back = front.map((p) => add(p, off));
    const inside = scl(add(front.reduce((s, p) => add(s, p), [0, 0, 0] as V3), scl(off, front.length / 2)), 1 / front.length);
    this.face(front, inside, col, lamp);
    this.face(back, inside, col, lamp);
    for (let i = 0; i < front.length; i++) {
      const j = (i + 1) % front.length;
      this.face([front[i], front[j], back[j], back[i]], inside, col, lamp);
    }
  }

  /** An oriented box: centre and three half-axis vectors. */
  box(c: V3, a: V3, b: V3, d: V3, col: V3, lamp = 0) {
    const f = sub(c, d);
    this.hull([sub(sub(f, a), b), sub(add(f, a), b), add(add(f, a), b), add(sub(f, a), b)], scl(d, 2), col, lamp);
  }

  /**
   * A frustum on the ground: convex footprints at the bottom (`y0`) and top (one height per top corner), with the
   * top cap coloured `topCol` and the sides `sideCol`. The bottom is never seen.
   */
  frustum(bot: V2[], top: V2[], y0: number, ytop: number[], sideCol: V3, topCol: V3) {
    const B: V3[] = bot.map(([x, z]) => [x, y0, z]);
    const T: V3[] = top.map(([x, z], i) => [x, ytop[i], z]);
    const inside = scl([...B, ...T].reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / (B.length + T.length));
    this.face(T, inside, topCol);
    for (let i = 0; i < B.length; i++) {
      const j = (i + 1) % B.length;
      this.face([B[i], B[j], T[j], T[i]], inside, sideCol);
    }
  }
}

/** A frame on the coast: origin on the ground, `t` along the coast, `n` inward (toward the island), up is +y. */
class Frame {
  constructor(
    readonly o: V3,
    readonly t: V3,
    readonly n: V3,
  ) {}
  /** local (u along, v up, w inward) → world */
  at(u: number, v: number, w: number): V3 {
    return [this.o[0] + this.t[0] * u + this.n[0] * w, this.o[1] + v, this.o[2] + this.t[2] * u + this.n[2] * w];
  }
  /** local direction → world */
  dir(u: number, v: number, w: number): V3 {
    return [this.t[0] * u + this.n[0] * w, v, this.t[2] * u + this.n[2] * w];
  }
}

const C = {
  stone: lin(RUINS.colours.stone),
  stoneDark: lin(RUINS.colours.stoneDark),
  metal: lin(RUINS.colours.metal),
  panel: lin(RUINS.colours.panel),
  landTop: lin(RUINS.colours.landTop),
  cliff: lin(RUINS.colours.cliff),
  moss: lin(RUINS.colours.moss),
  water: lin(RUINS.falls.colour),
};

export interface Built {
  layer: number;
  sector: number;
  geo: Geo;
  /** baked per-vertex fade base (the band's) */
  fade: number;
}

/**
 * P7-E32: the ruins' plan: every band's coasts and structures as flat-shaded geometry, a pure function of
 * RUINS.seed (no GPU, so it is unit-tested). `reach` is the furthest any piece stands from the centre.
 */
export class RuinPlanner {
  private seed: number = RUINS.seed;
  reach = 0;
  /** the thinnest a part may be in this band (world units): thinner reads as a crossbar floating in the sky */
  private thin = 1;

  private rnd() {
    let t = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  private range(a: number, b: number) {
    return a + (b - a) * this.rnd();
  }

  private pickKind(layer: RuinLayerName): RuinKind {
    const w = RUINS.kinds[layer];
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    let r = this.rnd() * total;
    for (const [k, v] of Object.entries(w) as [RuinKind, number][]) if ((r -= v) < 0) return k;
    return 'tower';
  }

  /** Every band's coasts and structures, as one Geo per (band, slice), far band first. */
  build(): Built[] {
    const out: Built[] = [];
    const [cx, cz] = RUINS.centre;
    const S = RUINS.sectors;
    const lampSpots: { geo: Geo; at: V3; n: V3 }[] = [];
    RUINS.layers.forEach((L, li) => {
      const name = L.name as RuinLayerName;
      this.thin = L.radius[0] * RUINS.minThin;
      const geos = Array.from({ length: S }, () => new Geo());
      const sectorOf = (deg: number) => Math.floor((((deg % 360) + 360) % 360) / (360 / S)) % S;
      const toRad = (d: number) => (d * Math.PI) / 180;
      let falls = 0;
      for (const [a0, a1] of RUINS.coasts[name]) {
        // the coast's shape along its arc: an uneven shoreline and a plateau that eases down at both headlands
        const ph = [this.rnd() * 6.3, this.rnd() * 6.3, this.rnd() * 6.3];
        const rIn = (deg: number) => L.radius[0] + 7 * Math.sin(toRad(deg) * 9 + ph[0]) + 4 * Math.sin(toRad(deg) * 23 + ph[1]);
        const hAt = (deg: number) => {
          const end = smooth(Math.min(deg - a0, a1 - deg) / 5);
          // low shores rising in steps to flat-topped mesas (the step makes a cliff between two slices)
          const wav = 0.5 + 0.35 * Math.sin(toRad(deg) * 7 + ph[2]) + 0.25 * Math.sin(toRad(deg) * 19 + ph[0]);
          const mesa = smooth((wav - 0.55) / 0.08);
          return (L.land[0] + (L.land[1] - L.land[0]) * Math.min(1, 0.2 * Math.max(0, wav) + 0.8 * mesa)) * end;
        };
        const step = 2.5;
        for (let d = a0; d < a1 - 1e-6; d += step) {
          const e = Math.min(a1, d + step);
          const p = (deg: number, r: number): V2 => [cx + r * Math.sin(toRad(deg)), cz + r * Math.cos(toRad(deg))];
          const depth = 70;
          const bot = [p(d, rIn(d) - 4), p(e, rIn(e) - 4), p(e, rIn(e) + depth), p(d, rIn(d) + depth)];
          const hd = hAt(d);
          const he = hAt(e);
          const lean = RUINS.slope[name];
          const top = [p(d, rIn(d) + 2 + hd * lean), p(e, rIn(e) + 2 + he * lean), p(e, rIn(e) + depth), p(d, rIn(d) + depth)];
          const geo = geos[sectorOf((d + e) / 2)];
          geo.frustum(bot, top, 0, [hd, he, he, hd], this.rnd() < 0.4 ? C.stoneDark : C.cliff, this.rnd() < (name === 'near' ? 0.6 : 0.35) ? C.moss : C.landTop);
          // a waterfall off the near band's high cliffs, now and then
          const F = RUINS.falls;
          if (name === 'near' && falls < F.count && Math.min(hd, he) >= F.minHeight && this.rnd() < 0.35) {
            falls++;
            const m = (d + e) / 2;
            const th = toRad(m);
            const h = Math.min(hd, he) - 0.2;
            const at: V3 = [cx + (rIn(m) - 4.8) * Math.sin(th), h / 2, cz + (rIn(m) - 4.8) * Math.cos(th)];
            geo.box(at, [Math.cos(th) * 1.6, 0, -Math.sin(th) * 1.6], [0, h / 2, 0], [Math.sin(th) * 0.5, 0, Math.cos(th) * 0.5], C.water);
          }
        }
        // the structures, deeper inland first (drawn first: they stand behind the nearer ones)
        const count = Math.max(1, Math.round(((a1 - a0) / 10) * L.density));
        const spots: { deg: number; r: number }[] = [];
        for (let i = 0; i < count; i++) {
          const deg = a0 + 3 + (a1 - a0 - 6) * ((i + 0.2 + this.rnd() * 0.6) / count);
          spots.push({ deg, r: rIn(deg) + this.range(6, 40) });
        }
        spots.sort((a, b) => b.r - a.r);
        for (const s of spots) {
          const th = toRad(s.deg);
          const ground = hAt(s.deg);
          const f = new Frame([cx + s.r * Math.sin(th), ground - 1, cz + s.r * Math.cos(th)], [Math.cos(th), 0, -Math.sin(th)], [-Math.sin(th), 0, -Math.cos(th)]);
          const g = geos[sectorOf(s.deg)];
          const lamp = (at: V3) => {
            if (li > 0) lampSpots.push({ geo: g, at, n: f.n });
          };
          this.structure(this.pickKind(name), g, f, L.scale * this.range(0.8, 1.2), lamp);
        }
      }
      geos.forEach((geo, sector) => out.push({ layer: li, sector, geo, fade: L.fade }));
      const r = L.radius[1] + 75;
      this.reach = Math.max(this.reach, r);
    });
    // a few tiny warm windows by night, on the near and mid bands only
    for (let i = 0; i < RUINS.lamps.count && lampSpots.length; i++) {
      const k = Math.floor(this.rnd() * lampSpots.length);
      const s = lampSpots.splice(k, 1)[0];
      const h = RUINS.lamps.size / 2;
      const t: V3 = [s.n[2], 0, -s.n[0]];
      s.geo.box(add(s.at, scl(s.n, 0.4)), scl(t, h), [0, h * 1.3, 0], scl(s.n, 0.3), C.stoneDark, 1);
    }
    return out;
  }

  /** One structure at frame `f`, size `s`; `lamp` offers a window spot for the night lights. */
  private structure(kind: RuinKind, g: Geo, f: Frame, s: number, lamp: (at: V3) => void) {
    const up: V3 = [0, 1, 0];
    const T = f.dir(1, 0, 0);
    const N = f.dir(0, 0, 1);
    const box = (u: number, v: number, w: number, hu: number, hv: number, hw: number, col: V3, l = 0) => g.box(f.at(u, v, w), scl(T, hu), scl(up, hv), scl(N, hw), col, l);
    /** a slanted break on top of a wall: a triangle in the u–v plane, swept through its depth */
    const wedge = (u0: number, u1: number, v: number, rise: number, hw: number, highRight: boolean, col: V3) =>
      g.hull([f.at(u0, v, -hw), f.at(u1, v, -hw), highRight ? f.at(u1, v + rise, -hw) : f.at(u0, v + rise, -hw)], scl(N, hw * 2), col);
    const stone = this.rnd() < 0.7 ? C.stone : C.stoneDark;
    switch (kind) {
      case 'tower': {
        const w = this.range(6, 10) * s;
        const h = this.range(20, 34) * s;
        if (this.rnd() < 0.6) {
          // a solid shaft with a jagged, stepped broken crown and moss on its ledges
          const body = h * this.range(0.65, 0.8);
          box(0, body / 2, 0, w / 2, body / 2, w / 2, stone);
          box(0, body + 0.25 * s, 0, w / 2 + 0.2 * s, 0.25 * s, w / 2 + 0.2 * s, C.moss);
          const steps = 2 + Math.floor(this.rnd() * 2);
          let u = -w / 2;
          for (let i = 0; i < steps; i++) {
            const sw = (w / steps) * this.range(0.8, 1.1);
            const sh = (h - body) * this.range(0.3, 1);
            const u1 = Math.min(w / 2, u + sw);
            box((u + u1) / 2, body + sh / 2, 0, (u1 - u) / 2, sh / 2, w / 2 * 0.9, stone);
            wedge(u, u1, body + sh, this.range(0.6, 1.6) * s, w / 2 * 0.9, this.rnd() < 0.5, stone);
            u = u1;
          }
          lamp(f.at(0, body * 0.6, w / 2));
          break;
        }
        const base = h * this.range(0.55, 0.7);
        box(0, base / 2, 0, w / 2, base / 2, w / 2, stone);
        // the upper storey is open: two corner piers (one broken short), a lintel across where it survives
        const pw = Math.max(w * 0.3, this.thin);
        const hl = h - base;
        const hr = hl * this.range(0.35, 0.8);
        box(-w / 2 + pw / 2, base + hl / 2, 0, pw / 2, hl / 2, w / 2, stone);
        box(w / 2 - pw / 2, base + hr / 2, 0, pw / 2, hr / 2, w / 2, stone);
        wedge(w / 2 - pw, w / 2, base + hr, pw * 1.6, w / 2, false, stone);
        if (this.rnd() < 0.6) box(-w * 0.1, base + hl * 0.45, 0, w * 0.4, w * 0.07, w / 2, stone);
        lamp(f.at(0, base * 0.7, w / 2));
        break;
      }
      case 'spire': {
        // a solarpunk tower: an octagonal shaft narrowing upward, ring platforms (some half fallen), panel fins
        const r = this.range(2.4, 3.4) * s;
        const h = this.range(34, 58) * s;
        const oct = (rr: number): V2[] => Array.from({ length: 8 }, (_, i) => {
          const a = ((i + 0.5) / 8) * Math.PI * 2;
          const p = f.at(Math.cos(a) * rr, 0, Math.sin(a) * rr);
          return [p[0], p[2]];
        });
        const top = h * this.range(0.75, 1);
        g.frustum(oct(r), oct(r * 0.62), f.o[1], new Array(8).fill(f.o[1] + top), C.stone, C.stone);
        wedge(-r * 0.6, r * 0.6, top, r * 1.5, r * 0.6, this.rnd() < 0.5, C.stone);
        for (const k of [0.38, 0.66]) {
          if (k * h > top) continue;
          const rr = r * this.range(2, 2.8);
          const half = this.rnd() < 0.45;
          const ring: V3[] = Array.from({ length: half ? 5 : 8 }, (_, i) => {
            const a = half ? (i / 4) * Math.PI : (i / 8) * Math.PI * 2;
            return f.at(Math.cos(a) * rr, k * h, (half ? -1 : 1) * Math.sin(a) * rr);
          });
          g.hull(ring, [0, 0.9 * s, 0], C.stoneDark);
          // a panel fin tilted off the ring's rim
          const side = this.rnd() < 0.5 ? -1 : 1;
          const c = f.at(side * rr * 0.95, k * h + 2.2 * s, 0);
          const tilt = this.range(0.5, 1.1);
          g.box(c, scl(T, 0.25 * s), add(scl(up, Math.cos(tilt) * 2.6 * s), scl(T, side * Math.sin(tilt) * 2.6 * s)), scl(N, 2.2 * s), C.panel);
        }
        lamp(f.at(0, h * 0.5, r * 0.8));
        break;
      }
      case 'aqueduct': {
        const bays = 3 + Math.floor(this.rnd() * 5);
        const bw = this.range(9, 12) * s;
        const H = this.range(16, 24) * s;
        const pw = Math.max(2.6 * s, this.thin);
        const deck = 3 * s;
        const hw = 1.8 * s;
        const u0 = (-bays * bw) / 2;
        const broken = new Set<number>();
        for (let i = 0; i < bays; i++) if (this.rnd() < 0.25) broken.add(i);
        for (let i = 0; i <= bays; i++) {
          const ph = broken.has(i) && broken.has(i - 1) ? H * 0.4 : H - deck;
          box(u0 + i * bw, ph / 2, 0, pw / 2, ph / 2, hw, stone);
        }
        for (let i = 0; i < bays; i++) {
          if (broken.has(i)) continue;
          const uc = u0 + (i + 0.5) * bw;
          const rr = (bw - pw) / 2;
          const spring = H - deck - rr * 0.9;
          const K = 8;
          for (let k = 0; k < K; k++) {
            const a0 = Math.PI - (k / K) * Math.PI;
            const a1 = Math.PI - ((k + 1) / K) * Math.PI;
            const p0: V2 = [uc + Math.cos(a0) * rr, spring + Math.sin(a0) * rr * 0.9];
            const p1: V2 = [uc + Math.cos(a1) * rr, spring + Math.sin(a1) * rr * 0.9];
            g.hull([f.at(p0[0], p0[1], -hw), f.at(p1[0], p1[1], -hw), f.at(p1[0], H - deck, -hw), f.at(p0[0], H - deck, -hw)], scl(N, hw * 2), stone);
          }
          box(uc, H - deck / 2, 0, bw / 2 + 0.01, deck / 2, hw * 1.1, stone);
          if (this.rnd() < 0.6) box(uc, H + 0.2 * s, 0, bw / 2 * this.range(0.4, 1), 0.2 * s, hw * 1.15, C.moss);
        }
        // a second, lighter tier on some
        if (this.rnd() < 0.4) {
          for (let i = 0; i < bays; i++) {
            if (broken.has(i) || this.rnd() < 0.3) continue;
            const uc = u0 + (i + 0.5) * bw;
            box(uc - bw / 2 + pw * 0.4, H + bw * 0.3, 0, pw * 0.4, bw * 0.3, hw * 0.8, stone);
            box(uc, H + bw * 0.6 + deck * 0.3, 0, bw / 2, deck * 0.3, hw * 0.8, stone);
          }
        }
        break;
      }
      case 'viaduct': {
        const segs = 3 + Math.floor(this.rnd() * 3);
        const span = this.range(12, 16) * s;
        const H = this.range(16, 26) * s;
        const u0 = (-segs * span) / 2;
        const gap = 1 + Math.floor(this.rnd() * (segs - 1));
        const pr = Math.max(0.8 * s, this.thin / 2);
        for (let i = 0; i <= segs; i++) box(u0 + i * span, H / 2, 0, pr, H / 2, pr, C.stoneDark);
        for (let i = 0; i < segs; i++) {
          const uc = u0 + (i + 0.5) * span;
          if (i === gap) {
            // the fallen span hangs from one pier down toward the ground
            const drop = H * 0.55;
            const c = f.at(uc - span * 0.1, H - drop / 2, 0);
            const len = Math.hypot(span * 0.8, drop) / 2;
            const dir = scl(add(scl(T, span * 0.8), [0, -drop, 0]), 1 / (len * 2));
            g.box(c, scl(dir, len), scl(up, 0.7 * s), scl(N, 1.8 * s), C.stone);
            continue;
          }
          box(uc, H + 0.7 * s, 0, span / 2, 0.7 * s, 1.8 * s, C.stone);
        }
        break;
      }
      case 'dome': {
        // a ruined dome on a drum: octagonal tiers narrowing to the crown, the top broken open on some
        const r = this.range(5, 8) * s;
        const oct = (rr: number, half = false): V2[] => Array.from({ length: half ? 5 : 8 }, (_, i) => {
          const a = half ? (i / 4) * Math.PI : ((i + 0.5) / 8) * Math.PI * 2;
          const p = f.at(Math.cos(a) * rr, 0, (half ? -1 : 1) * Math.sin(a) * rr);
          return [p[0], p[2]];
        });
        const y0 = f.o[1];
        const drum = r * this.range(0.5, 0.9);
        g.frustum(oct(r), oct(r), y0, new Array(8).fill(y0 + drum), stone, stone);
        g.frustum(oct(r), oct(r * 0.82), y0 + drum, new Array(8).fill(y0 + drum + r * 0.35), stone, stone);
        const broken = this.rnd() < 0.5;
        g.frustum(oct(r * 0.82, broken), oct(r * 0.5, broken), y0 + drum + r * 0.35, new Array(broken ? 5 : 8).fill(y0 + drum + r * 0.65), stone, stone);
        if (!broken) g.frustum(oct(r * 0.5), oct(r * 0.15), y0 + drum + r * 0.65, new Array(8).fill(y0 + drum + r * 0.85), stone, stone);
        lamp(f.at(0, drum * 0.5, r));
        break;
      }
      case 'block': {
        const w = this.range(8, 14) * s;
        const d = this.range(6, 10) * s;
        const h = this.range(10, 20) * s;
        box(0, h / 2, 0, w / 2, h / 2, d / 2, stone);
        const parts = 1 + Math.floor(this.rnd() * 3);
        for (let i = 0; i < parts; i++) {
          const pu = this.range(-w / 2, w / 2) * 0.6;
          const ph = this.range(3, 9) * s;
          const pw = this.range(1.5, 3.5) * s;
          box(pu, h + ph / 2, this.range(-d, d) * 0.2, pw, ph / 2, d / 2 * 0.8, stone);
        }
        wedge(w * 0.1, w / 2, h, this.range(2, 5) * s, d / 2, false, stone);
        lamp(f.at(-w * 0.2, h * 0.55, d / 2));
        break;
      }
      case 'frame': {
        // a lattice support frame: four legs leaning in, with rings of bracing
        const b = this.range(5, 7) * s;
        const tp = b * 0.35;
        const h = this.range(24, 36) * s;
        const top = h * (this.rnd() < 0.5 ? 1 : 0.8);
        const leg = Math.max(0.35 * s, this.thin / 2);
        const corners: V2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (const [cu, cw] of corners) {
          const p0 = f.at(cu * b, 0, cw * b);
          const p1 = f.at(cu * tp, top, cw * tp);
          const mid = scl(add(p0, p1), 0.5);
          const half = scl(sub(p1, p0), 0.5);
          g.box(mid, half, scl(T, leg), scl(N, leg), C.metal);
        }
        for (const k of [0.3, 0.6, 0.9]) {
          if (k * h > top) continue;
          const r = b + (tp - b) * (k * h / h);
          box(0, k * h, -r, r, leg, leg, C.metal);
          box(-r, k * h, 0, leg, leg, r, C.metal);
          box(r, k * h, 0, leg, leg, r, C.metal);
        }
        break;
      }
      case 'turbine': {
        // a derelict wind turbine: a tapered mast, its nacelle, and what's left of three blades
        const h = this.range(26, 34) * s;
        const oct = (rr: number): V2[] => Array.from({ length: 6 }, (_, i) => {
          const a = ((i + 0.5) / 6) * Math.PI * 2;
          const p = f.at(Math.cos(a) * rr, 0, Math.sin(a) * rr);
          return [p[0], p[2]];
        });
        g.frustum(oct(Math.max(1 * s, this.thin * 0.7)), oct(Math.max(0.5 * s, this.thin * 0.5)), f.o[1], new Array(6).fill(f.o[1] + h), C.stone, C.stone);
        box(0, h + 0.6 * s, -0.5 * s, 0.9 * s, 0.9 * s, 1.8 * s, C.stone);
        const hub = f.at(0, h + 0.6 * s, 1.4 * s);
        const spin = this.rnd() * Math.PI * 2;
        for (let i = 0; i < 3; i++) {
          if (i === 2 && this.rnd() < 0.6) continue;
          const len = (i === 1 ? this.range(0.3, 0.6) : 1) * 13 * s;
          const a = spin + (i / 3) * Math.PI * 2;
          const dir = add(scl(T, Math.cos(a)), scl(up, Math.sin(a)));
          g.box(add(hub, scl(dir, len / 2)), scl(dir, len / 2), scl(add(scl(T, -Math.sin(a)), scl(up, Math.cos(a))), Math.max(0.45 * s, this.thin / 2)), scl(N, 0.15 * s), C.stone);
        }
        break;
      }
    }
  }

}

/**
 * P7-E32 (#756, #761, #762): the distant ruined city. Three bands of coast round the island (far, mid, near), each
 * with broken stone towers, solarpunk spires with ring platforms and panel fins, aqueduct arches, viaducts, lattice
 * frames, derelict wind turbines and ruined blocks, generated once from RUINS.seed.
 *
 * Drawn in its own layer right after the world's opaque pass, depth-tested but writing no depth; within it the bands
 * draw far to near (manual order). Each frame every vertex is slid along its ray from the camera onto a plane
 * where the distance has gone to haze (see update and data/ruins.ts): on screen each silhouette is exactly where the real one would be.
 * Light and distance fade are baked into vertex colours and rebaked only when the sun, the haze or the night move.
 * One mesh per band and azimuth slice, so the camera culls what's behind it: a handful of draw calls.
 */
export class Ruins {
  readonly layer: pc.Layer;
  readonly root: pc.Entity;
  private meshes: { mesh: pc.Mesh; mi: pc.MeshInstance; base: Float32Array; drawn: Float32Array; nrm: Float32Array; alb: Float32Array; y: Float32Array; lamp: Float32Array; fade: number; cols: Uint8Array }[] = [];
  private sig: number[] = [];
  private viewSig: number[] = [];
  /** E23.7.2: the weather's view (1 clear … less in fog and rain): the ruins fade out with it */
  view = 1;

  constructor(
    app: pc.AppBase,
    private sky: Sky,
    private sun: pc.Entity,
  ) {
    const comp = app.scene.layers;
    this.layer = new pc.Layer({ name: 'Ruins', opaqueSortMode: pc.SORTMODE_MANUAL });
    // right after the world's opaque pass: the ruins sit where the distance has gone to haze (see update), so the visible world
    // hides them by depth while the fully fogged distance behind that plane doesn't
    const world = comp.getLayerById(pc.LAYERID_WORLD)!;
    comp.insertOpaque(this.layer, comp.getOpaqueIndex(world) + 1);
    this.root = new pc.Entity('ruins');
    app.root.addChild(this.root);

    const mat = new pc.StandardMaterial();
    mat.useLighting = false;
    mat.useFog = false;
    mat.useSkybox = false;
    mat.diffuse = new pc.Color(0, 0, 0);
    mat.emissive = new pc.Color(1, 1, 1);
    mat.emissiveVertexColor = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.cull = pc.CULLFACE_BACK;
    mat.update();

    const built = new RuinPlanner().build();
    for (const b of built) {
      const g = b.geo;
      if (!g.idx.length) continue;
      const mesh = new pc.Mesh(app.graphicsDevice);
      mesh.setPositions(g.pos);
      mesh.setColors32(new Array((g.pos.length / 3) * 4).fill(255));
      mesh.setIndices(g.idx);
      mesh.update(pc.PRIMITIVE_TRIANGLES);
      const mi = new pc.MeshInstance(mesh, mat);
      mi.drawOrder = b.layer;
      const e = new pc.Entity(`ruins-${RUINS.layers[b.layer].name}-${b.sector}`);
      e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false, layers: [this.layer.id] });
      this.root.addChild(e);
      const n = g.pos.length / 3;
      this.meshes.push({
        mesh,
        mi,
        base: Float32Array.from(g.pos),
        drawn: Float32Array.from(g.pos),
        nrm: Float32Array.from(g.nrm),
        alb: Float32Array.from(g.alb),
        y: Float32Array.from({ length: n }, (_, i) => g.pos[i * 3 + 1]),
        lamp: Float32Array.from(g.lamp),
        fade: b.fade,
        cols: new Uint8Array(n * 4),
      });
    }
  }

  /** Draw calls the ruins can cost at most (every slice in view): for the budget report. */
  get meshCount() {
    return this.meshes.length;
  }

  /**
   * Places the ruins for this frame's camera and rebakes their colours when the light, haze or night move.
   *
   * Every vertex is slid along its own ray from the camera onto a plane `D` deep, so on screen each silhouette is
   * exactly where the real one, hundreds of units out, would be; but by depth the ruins stand where the distance
   * above the horizon has gone wholly to haze: the horizon haze (LookShaders `lookHorizonFog`, LOOK.horizon) is full
   * from `start + reach × (end − start)` of the scene fog, well before the fog's end. The visible world in front of
   * that plane hides the ruins; the haze-coloured distance behind it (it reads as sky) doesn't. `fogStart`/`fogEnd`
   * are the scene fog's, as view depths.
   */
  update(cam: pc.Vec3, forward: pc.Vec3, fogStart: number, fogEnd: number) {
    this.root.enabled = RUINS.on;
    if (!RUINS.on) return;
    const H = LOOK.horizon;
    const full = H.strength >= 0.99 ? fogStart + (fogEnd - fogStart) * H.reach : fogEnd;
    const D = Math.max(1, full * RUINS.depth);
    const vs = [cam.x, cam.y, cam.z, forward.x, forward.y, forward.z, D];
    if (!this.viewSig.length || vs.some((v, i) => Math.abs(v - this.viewSig[i]) > 1e-4)) {
      this.viewSig = vs;
      for (const m of this.meshes) {
        const b = m.base;
        const o = m.drawn;
        for (let i = 0; i < b.length; i += 3) {
          const dx = b[i] - cam.x;
          const dy = b[i + 1] - cam.y;
          const dz = b[i + 2] - cam.z;
          // depth along the view; near or behind the camera's plane, fall back to the distance along the ray
          let t = dx * forward.x + dy * forward.y + dz * forward.z;
          const r = Math.hypot(dx, dy, dz);
          if (t < r * 0.2) t = r;
          const k = D / t;
          o[i] = cam.x + dx * k;
          o[i + 1] = cam.y + dy * k;
          o[i + 2] = cam.z + dz * k;
        }
        m.mesh.setPositions(o);
        m.mesh.update(pc.PRIMITIVE_TRIANGLES);
      }
    }

    const s = this.sun.up;
    const lc = this.sun.light?.color ?? new pc.Color(1, 1, 1);
    const haze = this.sky.horizonSeen();
    const sig = [s.x, s.y, s.z, lc.r, lc.g, lc.b, ...haze, this.sky.night, this.sky.clarity, this.view];
    if (this.sig.length && sig.every((v, i) => Math.abs(v - this.sig[i]) < 0.004)) return;
    this.sig = sig;
    this.recolour([s.x, s.y, s.z], [lc.r, lc.g, lc.b], haze);
  }

  private recolour(sunDir: V3, sunCol: V3, haze: [number, number, number]) {
    const night = Math.min(1, Math.max(0, this.sky.night));
    const L = RUINS.light;
    // the sky's light is a cool blue by day and a deeper one by night (each tint normalised to its brightest channel)
    const norm = (c: V3) => c.map((v) => v / Math.max(...c, 1e-3)) as V3;
    const day = norm(lin(L.dayTint));
    const nt = norm(lin(L.nightTint));
    const amb = L.ambient + (L.ambientNight - L.ambient) * night;
    const ambC = day.map((d, i) => amb * (d + (nt[i] - d) * night)) as V3;
    const sunK = L.sun * (1 - 0.4 * night);
    const sl: V3 = sunCol.map((c) => (c ** 2.2) * sunK) as V3;
    const lampC = lin(RUINS.lamps.colour);
    const lampOn = smooth((night - RUINS.lamps.from) / (1 - RUINS.lamps.from));
    const HF = RUINS.heightFog;
    const view = Math.min(1, Math.max(0, this.view));
    for (const m of this.meshes) {
      let fb = m.fade * (1 + (RUINS.nightFade - 1) * night);
      fb += (1 - fb) * RUINS.foggedFade * (1 - this.sky.clarity);
      const n = m.y.length;
      const cols = m.cols;
      for (let i = 0; i < n; i++) {
        const nd = Math.max(0, m.nrm[i * 3] * sunDir[0] + m.nrm[i * 3 + 1] * sunDir[1] + m.nrm[i * 3 + 2] * sunDir[2]);
        const hf = HF.strength * Math.exp(-Math.max(0, m.y[i]) / HF.height);
        let f = 1 - (1 - fb) * (1 - hf);
        f = 1 - (1 - f) * view * view;
        const lamp = m.lamp[i] * lampOn;
        for (let c = 0; c < 3; c++) {
          let v = m.alb[i * 3 + c] * (ambC[c] + sl[c] * nd);
          v = v + (haze[c] - v) * f;
          if (lamp > 0) v = v + (lampC[c] * 1.6 - v) * lamp * (1 - f * 0.5);
          cols[i * 4 + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
        }
        cols[i * 4 + 3] = 255;
      }
      m.mesh.setColors32(cols as unknown as number[]);
      m.mesh.update(pc.PRIMITIVE_TRIANGLES);
    }
  }
}
