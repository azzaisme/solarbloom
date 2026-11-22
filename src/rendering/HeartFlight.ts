import { BIRD_HEART } from '../data/birdHeart';

/**
 * #689 (E27.5): the flight of the Great Bloom's heart of birds, worked out on screen (pixels, y down) so the heart
 * reads the same from any camera. Pure: no PlayCanvas, so the tests can follow every bird. `BirdHeart` draws it.
 *
 * Normal: half the flock sets off from the left edge and half from the right, staggered, and each swoops on a curve
 * into its own place on the heart's outline, slowing to arrive. The heart holds while its birds glide a little way
 * round the outline together, then they peel away out and up off the screen. Reduced motion: no flight across the
 * screen; the birds grow into their places, hold, and shrink away.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// ───────────── the heart's outline ─────────────

/** The classic heart curve at angle a: x = 16 sin³a, y = 13 cos a − 5 cos 2a − 2 cos 3a − cos 4a (y up). */
function heartAt(a: number): [number, number] {
  const s = Math.sin(a);
  return [16 * s * s * s, 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)];
}

const SAMPLES = 1024;
/** The outline sampled evenly by length, fitted to a unit box (u, v in −0.5 … 0.5, v up), from the top dip clockwise round the right lobe. */
const OUTLINE: [number, number][] = (() => {
  const fine: [number, number][] = [];
  const N = 8192;
  for (let i = 0; i <= N; i++) fine.push(heartAt((i / N) * Math.PI * 2));
  const len = [0];
  for (let i = 1; i <= N; i++) len.push(len[i - 1] + Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]));
  const total = len[N];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of fine) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const out: [number, number][] = [];
  let j = 0;
  for (let k = 0; k < SAMPLES; k++) {
    const want = (k / SAMPLES) * total;
    while (len[j + 1] < want) j++;
    const f = (want - len[j]) / (len[j + 1] - len[j] || 1);
    const x = fine[j][0] + (fine[j + 1][0] - fine[j][0]) * f;
    const y = fine[j][1] + (fine[j + 1][1] - fine[j][1]) * f;
    out.push([(x - minX) / (maxX - minX) - 0.5, (y - minY) / (maxY - minY) - 0.5]);
  }
  return out;
})();
/** The heart's height over its width (the curve is a little wider than tall). */
export const HEART_ASPECT = (() => {
  const xs = [0, 0.5 * Math.PI, 1.5 * Math.PI].map((a) => heartAt(a)[0]);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 4096; i++) {
    const y = heartAt((i / 4096) * Math.PI * 2)[1];
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return (maxY - minY) / (Math.max(...xs) - Math.min(...xs));
})();
/** The outline's length round a unit-wide box of HEART_ASPECT height (for spacing the birds). */
const OUTLINE_LENGTH = (() => {
  let L = 0;
  for (let k = 0; k < SAMPLES; k++) {
    const [a, b] = [OUTLINE[k], OUTLINE[(k + 1) % SAMPLES]];
    L += Math.hypot(b[0] - a[0], (b[1] - a[1]) * HEART_ASPECT);
  }
  return L;
})();

/** A point on the outline at `s` (0 … 1 round it, from the top dip, any s wraps), smoothly between samples. */
export function outlineAt(s: number): [number, number] {
  const f = (((s % 1) + 1) % 1) * SAMPLES;
  const i = Math.floor(f);
  const a = OUTLINE[i % SAMPLES];
  const b = OUTLINE[(i + 1) % SAMPLES];
  const k = f - i;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

export interface Slot {
  /** place round the outline, 0 … 1 from the top dip */
  s: number;
  /** in the unit box: u across, v up, each −0.5 … 0.5 */
  u: number;
  v: number;
  /** the edge of the screen it flies in from: −1 left, +1 right */
  side: -1 | 1;
}

/**
 * `n` places evenly round the heart (n even), starting at the top dip, so the bottom tip is one of them and the left
 * and right halves mirror. The left half flies in from the left; the dip goes with the left and the tip with the right,
 * so each side brings n / 2.
 */
export function heartSlots(n: number): Slot[] {
  return Array.from({ length: n }, (_, i) => {
    const s = i / n;
    const [u, v] = outlineAt(s);
    const side: -1 | 1 = i === 0 ? -1 : i === n / 2 ? 1 : u < 0 ? -1 : 1;
    return { s, u, v, side };
  });
}

// ───────────── where the heart goes on screen ─────────────

/**
 * The heart's box: in the top band of the screen, centred in the gap between the HUD cards there (the objective card on
 * the left, the charge card on the right: `blockers`, in screen pixels), as big as fits. If the gap is too narrow it
 * drops below the cards instead.
 */
export function heartBox(w: number, h: number, blockers: Rect[]): Box {
  const B = BIRD_HEART.box;
  const top = blockers.filter((r) => r.top < h * 0.5 && r.bottom > 0);
  let lo = 0;
  let hi = w;
  for (const r of top) {
    if ((r.left + r.right) / 2 < w / 2) lo = Math.max(lo, r.right);
    else hi = Math.min(hi, r.left);
  }
  const fit = (avail: number) => Math.min(avail, B.maxWidth * w, (B.maxHeight * h) / HEART_ASPECT);
  let bw = fit(hi - lo - 2 * B.gap);
  let cx = (lo + hi) / 2;
  let y = h * B.top;
  if (bw < w * 0.14) {
    // no room between the cards: below them, across the middle
    cx = w / 2;
    bw = fit(w - 2 * B.gap);
    y = Math.max(y, ...top.map((r) => r.bottom + B.gap));
  }
  const bh = bw * HEART_ASPECT;
  return { x: cx - bw / 2, y, w: bw, h: bh };
}

/** A unit-box point (u, v up) on screen in `box`. */
export function onScreen(box: Box, u: number, v: number): [number, number] {
  return [box.x + box.w * (0.5 + u), box.y + box.h * (0.5 - v)];
}

// ───────────── the flight ─────────────

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
/** Eases in from rest (zero speed at 0), for the glide round and the break away. */
const easeIn = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x;
};
/** A small seeded number per bird, 0 … 1 (the flight looks the same each time). */
const jitter = (i: number, salt: number) => {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

export interface BirdPose {
  x: number;
  y: number;
  /** 0 … 1: grown in (reduced motion fades by size) */
  scale: number;
  /** heading on screen, radians (atan2 of y-down motion) */
  heading: number;
  /** roll into the turn, radians (+ banks right) */
  bank: number;
  /** wing beats a second right now */
  flap: number;
  /** on screen at all */
  shown: boolean;
}

/** Where a bird of `slot` is at time t of the flight (no heading yet: `HeartFlight` steers). */
export function birdAt(i: number, slot: Slot, t: number, w: number, box: Box, calm: boolean): { x: number; y: number; scale: number; flap: number; gone: boolean } {
  const H = BIRD_HEART;
  const [sx, sy] = onScreen(box, slot.u, slot.v);
  if (calm) {
    const { fadeIn, hold, fadeOut } = H.calm;
    const scale = t < fadeIn ? smooth(t / fadeIn) : t < fadeIn + hold ? 1 : 1 - smooth((t - fadeIn - hold) / fadeOut);
    return { x: sx, y: sy, scale, flap: H.flap.glide, gone: t >= fadeIn + hold + fadeOut };
  }
  const t0 = jitter(i, 1) * H.stagger;
  const arrive = t0 + H.flyIn;
  const formed = H.stagger + H.flyIn;
  const held = formed + H.hold;
  if (t < arrive) {
    // the swoop in: a curve from just off its edge, a little below its place, rising and slowing into the heart
    const inward = -slot.side;
    const x0 = slot.side < 0 ? -w * 0.06 : w * 1.06;
    const y0 = sy + box.h * (0.25 + 0.5 * jitter(i, 2));
    const dx = Math.abs(sx - x0);
    const p = smooth((t - t0) / H.flyIn);
    const q = 1 - p;
    const P = [
      [x0, y0],
      [x0 + inward * dx * 0.45, y0 - box.h * 0.2],
      [sx - inward * dx * 0.18, sy + box.h * 0.2],
      [sx, sy],
    ];
    const b = [q * q * q, 3 * q * q * p, 3 * q * p * p, p * p * p];
    const x = P.reduce((a, c, k) => a + c[0] * b[k], 0);
    const y = P.reduce((a, c, k) => a + c[1] * b[k], 0);
    return { x, y, scale: 1, flap: H.flap.fly - (H.flap.fly - H.flap.glide) * smooth(((t - t0) / H.flyIn - 0.6) / 0.4), gone: false };
  }
  // the hold: every bird glides the same little way round the outline, easing in from rest
  const glide = H.drift * easeIn((t - formed) / H.hold) * (t > formed ? 1 : 0);
  const [u, v] = outlineAt(slot.s + glide);
  const [hx, hy] = onScreen(box, u, v);
  const t1 = held + jitter(i, 3) * 0.4;
  if (t < t1) return { x: hx, y: hy, scale: 1, flap: H.flap.glide, gone: false };
  // breaking away: out from the heart's middle, up, and back toward its own side, faster and faster
  let ox = u + slot.side * 0.35;
  let oy = -v - 0.6;
  const l = Math.hypot(ox, oy) || 1;
  ox /= l;
  oy /= l;
  const k = (t - t1) / H.breakAway;
  const d = easeIn(k) * w * 1.1;
  return { x: hx + ox * d, y: hy + oy * d, scale: 1, flap: H.flap.fly, gone: k >= 1 };
}

/** The whole flight's length (seconds). */
export function flightSeconds(calm: boolean): number {
  const H = BIRD_HEART;
  return calm ? H.calm.fadeIn + H.calm.hold + H.calm.fadeOut : H.stagger + H.flyIn + H.hold + 0.4 + H.breakAway;
}

/**
 * The flock in flight: steps time, follows each bird and steers its heading smoothly (turning at a bounded rate, so it
 * banks round rather than snapping) with a bank that leans into the turn.
 */
export class HeartFlight {
  readonly slots: Slot[];
  readonly poses: BirdPose[];
  t = 0;
  done = false;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly box: Box,
    readonly calm: boolean,
    n: number = BIRD_HEART.birds,
  ) {
    this.slots = heartSlots(n);
    this.poses = this.slots.map((sl, i) => {
      const p = birdAt(i, sl, 0, w, box, calm);
      // flying in, a bird starts heading in from its edge; in the calm heart, along the outline
      const heading = calm ? this.tangent(sl.s) : sl.side < 0 ? 0 : Math.PI;
      return { x: p.x, y: p.y, scale: p.scale, heading, bank: 0, flap: p.flap, shown: p.scale > 0 };
    });
  }

  /** The heading along the outline at s (going round), on screen. */
  private tangent(s: number): number {
    const [a, b] = [onScreen(this.box, ...outlineAt(s - 0.002)), onScreen(this.box, ...outlineAt(s + 0.002))];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  }

  /** The bird's on-screen size: its wingspan in pixels, a share of the space between neighbours on the outline. */
  get spanPx(): number {
    return (BIRD_HEART.span * OUTLINE_LENGTH * this.box.w) / this.slots.length;
  }

  step(dt: number) {
    if (this.done) return;
    this.t += dt;
    const turnRate = 6; // rad/s
    let gone = 0;
    this.slots.forEach((sl, i) => {
      const p = this.poses[i];
      const n = birdAt(i, sl, this.t, this.w, this.box, this.calm);
      const vx = n.x - p.x;
      const vy = n.y - p.y;
      const speed = Math.hypot(vx, vy) / Math.max(dt, 1e-6);
      // head where it's going while it moves; nearly still (arriving, or calm), head along the outline
      const want = speed > 12 ? Math.atan2(vy, vx) : this.calm ? this.tangent(sl.s) : p.heading;
      let d = want - p.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = Math.max(-turnRate * dt, Math.min(turnRate * dt, d));
      p.heading += turn;
      const bankMax = (BIRD_HEART.bank * Math.PI) / 180;
      const wantBank = Math.max(-bankMax, Math.min(bankMax, (turn / Math.max(dt, 1e-6)) * 0.35));
      p.bank += (wantBank - p.bank) * Math.min(1, dt * 6);
      p.x = n.x;
      p.y = n.y;
      p.scale = n.scale;
      p.flap = n.flap;
      p.shown = !n.gone && n.scale > 0.001 && n.x > -this.w * 0.2 && n.x < this.w * 1.2 && n.y > -this.h * 0.4 && n.y < this.h * 1.4;
      if (n.gone) gone++;
    });
    if (gone === this.slots.length || this.t >= flightSeconds(this.calm) + 0.1) this.done = true;
  }
}

/** Does this fountain tier's bloom get the heart? Only the Great Bloom (the fountain's last look). */
export function bloomGetsHeart(look: string | undefined): boolean {
  return look === 'bloom';
}
