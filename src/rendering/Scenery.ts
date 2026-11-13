import * as pc from 'playcanvas';
import type { RooftopData } from '../core/types';
import { mat, PALETTE } from './Materials';
import { group, shape, vshape, type VPrim } from './Shapes';
import { ease, type Tweens } from './Tween';

class R {
  constructor(private s: number) {}
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  pick<T>(a: readonly T[]) {
    return a[Math.floor(this.next() * a.length)];
  }
}

const WHITES = ['#f3efe6', '#ece6da', '#e8eef0', '#f6f2ea'];
const GREENS = ['#6fbf4f', '#5aae46', '#7fcc5a', '#4f9e44'];
const SQ = Math.SQRT1_2;
/** Screen-space helpers for the fixed 45°/35° camera: u = screen-right, v = toward camera. */
const worldOf = (u: number, v: number): [number, number] => [4 + (u + v) * SQ, 4 + (v - u) * SQ];
/** Height that puts an object's top at screen height S (world units above the roof centre) at depth v. */
const topFor = (S: number, v: number) => (S + 0.574 * v) / 0.819;

type Box = (p: pc.Entity, type: VPrim, hex: string, pos: [number, number, number], scale: [number, number, number] | number, rot?: [number, number, number]) => pc.Entity;
const V: Box = (p, type, hex, pos, scale, rot) => vshape(p, type, hex, { pos, scale, rot });

interface StageItem {
  e: pc.Entity;
  stage: number;
  base: pc.Vec3;
  shown: boolean;
  anim?: 'pop' | 'grow-down' | 'unfold';
}

/**
 * Everything around the playable grid that gives the scene depth: a hazy layered solarpunk city,
 * foreground terraces, the service ledge behind the garden, and greenery that arrives in stages
 * (25 / 50 / 75 % restored). Static parts use the shared vertex-colour material (cheap batching).
 */
export class Scenery {
  readonly staticRoot: pc.Entity;
  readonly stageRoot: pc.Entity;
  private items: StageItem[] = [];
  private waterfalls: pc.Entity[] = [];
  private stage = -1;
  private time = 0;

  constructor(
    parent: pc.Entity,
    private tweens: Tweens,
  ) {
    this.staticRoot = group(parent, 'scenery-static');
    this.stageRoot = group(parent, 'scenery-stage');
  }

  /** World-space footprints (other rooftops' buildings) the city and terraces must stay clear of. */
  private avoid: { x0: number; x1: number; z0: number; z1: number }[] = [];

  private blocked(x: number, z: number, half: number) {
    return this.avoid.some((a) => x + half > a.x0 && x - half < a.x1 && z + half > a.z0 && z - half < a.z1);
  }

  build(main: RooftopData, others: RooftopData[] = []) {
    this.avoid = others.map((r) => ({ x0: r.origin[0] - 1.5, x1: r.origin[0] + r.width + 1.5, z0: r.origin[2] - 1.5, z1: r.origin[2] + r.depth + 1.5 }));
    this.backdrop();
    this.foreground();
    this.ledge(main);
  }

  private stageItem(e: pc.Entity, stage: number, anim: StageItem['anim'] = 'pop') {
    this.items.push({ e, stage, base: e.getLocalScale().clone(), shown: true, anim });
    return e;
  }

  // ───────────── distant city ─────────────

  private tower(g: pc.Entity, rng: R, x: number, z: number, top: number, w: number, d: number, lush: number, layer: number) {
    const tiers = 2 + Math.floor(rng.next() * 3);
    let tw = w;
    let td = d;
    let y = top - 40;
    const tierH = [] as number[];
    let remaining = top - y;
    for (let i = 0; i < tiers; i++) tierH.push(i === 0 ? remaining - (tiers - 1) * rng.range(1.2, 2.2) : 0);
    for (let i = 1; i < tiers; i++) tierH[i] = (remaining - tierH[0]) / (tiers - 1);
    // Further layers are bluer and paler (aerial perspective), on top of the scene fog.
    const col = layer === 0 ? rng.pick(WHITES) : layer === 1 ? rng.pick(['#dfe6e6', '#d9e2e4', '#e3e8e6']) : rng.pick(['#cfdbe2', '#c8d6de', '#d3dee3']);
    const band = layer === 0 ? '#9fb6c2' : '#b5c8d2';
    for (let i = 0; i < tiers; i++) {
      const h = tierH[i];
      const cy = y + h / 2;
      V(g, 'box', col, [x, cy, z], [tw, h, td]);
      // window bands on the two camera-facing faces (near layer only)
      if (layer === 0)
        for (let b = 1; b <= 3; b++) {
          const by = y + h - b * 0.55;
          if (by < y + 0.3 || by < top - 9) break;
          V(g, 'box', band, [x, by, z + td / 2 + 0.01], [tw * 0.86, 0.16, 0.02]);
          V(g, 'box', band, [x + tw / 2 + 0.01, by, z], [0.02, 0.16, td * 0.86]);
        }
      y += h;
      // garden terrace on every setback
      const greenTop = V(g, 'box', rng.pick(GREENS), [x, y + 0.06, z], [tw * 0.94, 0.12, td * 0.94]);
      if (rng.next() > lush) this.stageItem(greenTop, 2);
      if (layer < 2) {
        const trees = 1 + Math.floor(rng.next() * 3);
        for (let k = 0; k < trees; k++) {
          const ts = rng.range(0.35, 0.65);
          const t = V(g, 'sphereHi', rng.pick(GREENS), [x + rng.range(-tw * 0.35, tw * 0.35), y + ts * 0.45, z + rng.range(-td * 0.35, td * 0.35)], [ts, ts * 0.8, ts]);
          if (rng.next() > lush) this.stageItem(t, rng.next() < 0.5 ? 2 : 3);
        }
        // hanging greenery down the front faces
        if (i > 0 && rng.next() < 0.8) {
          const len = Math.min(h * 0.8, rng.range(0.8, 2.4));
          const hang = V(g, 'box', rng.pick(GREENS), [x + rng.range(-tw * 0.3, tw * 0.3), y - len / 2, z + td / 2 + 0.03], [rng.range(0.3, 0.7), len, 0.06]);
          if (rng.next() > lush) this.stageItem(hang, 3, 'grow-down');
        }
      }
      tw *= rng.range(0.7, 0.85);
      td *= rng.range(0.7, 0.85);
    }
    // crown: glass dome, spire or turbine
    const crown = rng.next();
    if (crown < 0.25 && layer < 2) {
      const dome = shape(g, 'sphere', mat('#bfe9f5', { opacity: 0.55, gloss: 0.9 }), { pos: [x, y + 0.1, z], scale: [tw * 0.8, tw * 0.6, td * 0.8] });
      void dome;
      V(g, 'cylinder', PALETTE.gold, [x, y + 0.08, z], [tw * 0.82, 0.08, td * 0.82]);
    } else if (crown < 0.4) {
      V(g, 'cylinder', '#f6f2ea', [x, y + 0.9, z], [0.14, 1.8, 0.14]);
    }
    return { y, tw, td };
  }

  private backdrop() {
    const g = group(this.staticRoot, 'city');
    const rng = new R(4242);
    const nearTops: { x: number; z: number; y: number; u: number }[] = [];
    // Far → near so nothing important is overdrawn. Each layer sits higher on screen and hazier.
    const layers = [
      { v: [-40, -34], S: [5.5, 8.5], u: [-36, 38], step: 2.2, w: [1.1, 1.8], lush: 0.5 },
      { v: [-30, -24], S: [4.5, 7.5], u: [-32, 34], step: 2.8, w: [1.4, 2.2], lush: 0.45 },
      { v: [-20, -15], S: [3.5, 6.5], u: [-28, 30], step: 3.6, w: [1.7, 2.6], lush: 0.4 },
    ];
    layers.forEach((L, li) => {
      const layer = 2 - li;
      for (let u = L.u[0]; u < L.u[1]; u += L.step * rng.range(0.8, 1.2)) {
        const side = Math.abs(u - 2) > 13;
        const v = side && layer === 0 ? rng.range(-10, -5) : rng.range(L.v[0], L.v[1]);
        const S = side && layer === 0 ? rng.range(-1, 3.5) : rng.range(L.S[0], L.S[1]);
        const [x, z] = worldOf(u, v);
        const w = rng.range(L.w[0], L.w[1]);
        const top = topFor(S, v);
        const d = rng.range(L.w[0], L.w[1]);
        if (this.blocked(x, z, Math.max(w, d) / 2)) {
          // Keep the random sequence identical so the rest of the skyline doesn't change.
          const tmp = new pc.Entity();
          const items = this.items.length;
          this.tower(tmp, rng, x, z, top, w, d, L.lush, layer);
          this.items.length = items;
          tmp.destroy();
          if (layer === 0) rng.next();
          continue;
        }
        const r = this.tower(g, rng, x, z, top, w, d, L.lush, layer);
        if (layer === 0) nearTops.push({ x, z, y: r.y, u });
        // waterfalls pour off some near towers once the city wakes (stage 3)
        if (layer === 0 && rng.next() < 0.3) {
          const fall = rng.range(3, 6);
          const wf = V(g, 'box', '#a8ecff', [x + rng.range(-0.4, 0.4), r.y - fall / 2 - 0.3, z + r.td / 2 + 0.05], [0.35, fall, 0.05]);
          this.stageItem(wf, 3, 'grow-down');
          this.waterfalls.push(wf);
        }
      }
    });
    // Skybridges between neighbouring near towers
    nearTops.sort((a, b) => a.u - b.u);
    for (let i = 0; i + 1 < nearTops.length; i++) {
      const a = nearTops[i];
      const b = nearTops[i + 1];
      if (rng.next() < 0.45) continue;
      const y = Math.min(a.y, b.y) - rng.range(1.2, 2.5);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
      const br = group(g, 'skybridge', [(a.x + b.x) / 2, y, (a.z + b.z) / 2]);
      br.setLocalEulerAngles(0, yaw, 0);
      V(br, 'box', '#f4f0e8', [0, 0, 0], [0.5, 0.18, len]);
      const garden = V(br, 'box', '#79c85a', [0, 0.12, 0], [0.42, 0.06, len * 0.95]);
      this.stageItem(garden, 2);
      for (let k = -2; k <= 2; k++) V(br, 'box', '#f4f0e8', [0, -0.25 - (2 - Math.abs(k)) * 0.06, (k * len) / 5], [0.45, 0.08, len / 5.5]);
    }
  }

  // ───────────── foreground terraces (bottom corners, closest to camera) ─────────────

  private foreground() {
    const g = group(this.staticRoot, 'foreground');
    const rng = new R(77);
    const spots = [
      { u: -11.5, v: 10, S: -4.6 },
      { u: -15, v: 7, S: -2.6 },
      { u: 13.5, v: 11, S: -5.0 },
      { u: 17.5, v: 6, S: -2.2 },
    ];
    for (const sp of spots) {
      const [x, z] = worldOf(sp.u, sp.v);
      const top = topFor(sp.S, sp.v);
      const w = rng.range(3, 4.5);
      if (this.blocked(x, z, w / 2)) continue;
      V(g, 'box', '#efe9de', [x, top - 6, z], [w, 12, w]);
      V(g, 'box', '#5fae45', [x, top + 0.08, z], [w * 0.96, 0.16, w * 0.96]);
      for (let k = 0; k < 4; k++) {
        const s = rng.range(1.0, 1.7);
        V(g, 'sphereHi', rng.pick(['#3f8f3c', '#4a9e40', '#357f36']), [x + rng.range(-w * 0.3, w * 0.3), top + s * 0.4, z + rng.range(-w * 0.3, w * 0.3)], [s, s * 0.8, s]);
      }
      for (let k = 0; k < 8; k++) V(g, 'sphere', rng.pick(PALETTE.flower), [x + rng.range(-w * 0.45, w * 0.45), top + 0.25, z + w * 0.48], 0.22);
      // ivy spilling over the front edges
      for (let k = 0; k < 4; k++) V(g, 'box', '#4f9e44', [x + rng.range(-w * 0.4, w * 0.4), top - 0.8, z + w / 2 + 0.03], [0.5, 1.6, 0.06]);
    }
  }

  // ───────────── service ledge behind the garden ─────────────

  private ledge(roof: RooftopData) {
    const g = group(this.staticRoot, 'ledge');
    const st = group(this.stageRoot, 'ledge-stage');
    const top = roof.origin[1] + roof.height;
    const rng = new R(9);
    const rust = '#9a6a4a';
    // Pipes along the back and left inner walls
    V(g, 'cylinder', rust, [3.2, top + 0.12, -0.32], [0.12, 9.6, 0.12], [0, 0, 90]);
    V(g, 'cylinder', rust, [-0.32, top + 0.12, 3.2], [0.12, 9.6, 0.12], [90, 0, 0]);
    for (let i = -1; i < 8; i += 1.6) {
      V(g, 'box', '#5d5f63', [i, top + 0.06, -0.32], [0.06, 0.14, 0.18]);
      V(g, 'box', '#5d5f63', [-0.32, top + 0.06, i], [0.18, 0.14, 0.06]);
    }
    // AC units
    const ac = (x: number, z: number, rot = 0) => {
      const u = group(g, 'ac', [x, top, z]);
      u.setLocalEulerAngles(0, rot, 0);
      V(u, 'box', '#c9c7c0', [0, 0.28, 0], [0.8, 0.56, 0.6]);
      for (let k = 0; k < 4; k++) V(u, 'box', '#77797d', [0, 0.12 + k * 0.11, 0.305], [0.66, 0.03, 0.02]);
      V(u, 'cylinder', '#55585c', [0.15, 0.565, 0], [0.4, 0.02, 0.4]);
      V(u, 'cylinder', rust, [-0.45, 0.2, 0.1], [0.06, 0.3, 0.06], [0, 0, 90]);
    };
    ac(1.2, -0.9);
    ac(7.2, -0.95);
    ac(-0.95, 1.2, 90);
    // Stairwell hut
    const hut = group(g, 'hut', [4.9, top, -0.95]);
    V(hut, 'box', '#bdb9b0', [0, 0.65, 0], [1.9, 1.3, 1.3]);
    V(hut, 'box', '#a7a39a', [0, 1.34, 0], [2.05, 0.1, 1.45]);
    V(hut, 'box', '#5b5148', [0.35, 0.5, 0.655], [0.5, 1.0, 0.03]);
    V(hut, 'sphere', PALETTE.gold, [0.52, 0.5, 0.68], 0.04);
    V(hut, 'cylinder', '#8a8d90', [-0.6, 1.6, -0.2], [0.18, 0.45, 0.18]);
    // Water tower in the back corner
    const wt = group(g, 'waterTower', [-0.95, top, 3.4]); // on the left strip, clear of the Core spire
    for (const [a, b] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) V(wt, 'box', '#6d5a49', [a, 0.6, b], [0.08, 1.2, 0.08]);
    V(wt, 'box', '#6d5a49', [0, 1.18, 0], [0.8, 0.06, 0.8]);
    V(wt, 'cylinder', '#9c7b5c', [0, 1.65, 0], [1.0, 0.9, 1.0]);
    for (let k = 0; k < 3; k++) V(wt, 'cylinder', '#6d5a49', [0, 1.35 + k * 0.3, 0], [1.03, 0.03, 1.03]);
    V(wt, 'cone', '#7a6a5b', [0, 2.3, 0], [1.1, 0.4, 1.1]);
    // Crates and a pallet on the left strip
    const crate = (x: number, y: number, z: number, s: number, r: number) => {
      const c = group(g, 'crate', [x, top + y + s / 2, z]);
      c.setLocalEulerAngles(0, r, 0);
      V(c, 'box', '#b08a5e', [0, 0, 0], s);
      V(c, 'box', '#8d6a45', [0, 0, s / 2 + 0.005], [s, 0.06, 0.01]);
      V(c, 'box', '#8d6a45', [s / 2 + 0.005, 0, 0], [0.01, 0.06, s]);
    };
    // (kept clear of the Canopy Bridge, which crosses the left strip at z ≈ 5.5)
    V(g, 'box', '#a58a68', [-0.9, top + 0.05, 7.2], [1.1, 0.1, 1.2]);
    crate(-1.05, 0.1, 6.95, 0.5, 8);
    crate(-0.75, 0.1, 7.55, 0.42, -12);
    crate(-1.0, 0.6, 7.0, 0.38, 20);
    // weeds in ledge cracks (grey-green, before restoration)
    for (let i = 0; i < 14; i++) {
      const p: [number, number, number] = rng.next() < 0.6 ? [rng.range(-1.6, 8), top + 0.04, rng.range(-1.6, -0.5)] : [rng.range(-1.6, -0.5), top + 0.04, rng.range(0, 8)];
      V(g, 'cone', '#8a9466', p, [0.07, 0.12, 0.07]);
    }

    // ── Stage 1 (25%): moss and little flowers creep over the ledge
    for (let i = 0; i < 12; i++) {
      const p: [number, number, number] = i % 2 ? [rng.range(-1.5, 7.8), top + 0.01, rng.range(-1.6, -0.45)] : [rng.range(-1.6, -0.45), top + 0.01, rng.range(-1.2, 7.8)];
      const s = rng.range(0.25, 0.5);
      this.stageItem(V(st, 'sphere', '#86b85c', p, [s, 0.05, s * 0.8]), 1);
      if (i % 3 === 0) this.stageItem(V(st, 'sphere', rng.pick(PALETTE.flower), [p[0] + 0.1, top + 0.08, p[2]], 0.09), 1);
    }
    // ── Stage 2 (50%): folding solar array on the hut opens, planters bloom, ivy hangs from the rails
    const arr = group(st, 'array', [4.9, top + 1.4, -0.95]);
    for (let i = 0; i < 3; i++) {
      const leaf = group(arr, 'leaf', [(i - 1) * 0.62, 0.02, 0]);
      V(leaf, 'box', '#f2efe8', [0, 0.02, 0], [0.58, 0.04, 1.0]);
      V(leaf, 'box', PALETTE.panel, [0, 0.05, 0], [0.52, 0.02, 0.92]);
      leaf.tags.add('fold');
      this.stageItem(leaf, 2, 'unfold');
    }
    const planter = (x: number, z: number) => {
      const p = group(st, 'planter', [x, top, z]);
      V(p, 'box', '#f4f0e8', [0, 0.14, 0], [0.7, 0.28, 0.45]);
      for (let k = 0; k < 4; k++) {
        V(p, 'sphere', rng.pick(GREENS), [-0.24 + k * 0.16, 0.32, 0], [0.2, 0.16, 0.2]);
        V(p, 'sphere', rng.pick(PALETTE.flower), [-0.24 + k * 0.16, 0.42, 0.04], 0.1);
      }
      this.stageItem(p, 2);
    };
    planter(2.4, -1.3);
    planter(6.3, -1.35);
    planter(-1.35, 4.3);
    planter(-1.3, 0.9);
    for (let i = 0; i < 9; i++) {
      // ivy draping over the front rails, outside the garden
      const along = i % 2 === 0;
      const a = 0.6 + i * 0.85;
      const len = rng.range(0.6, 1.4);
      const iv = group(st, 'ivy', along ? [a, top + 0.25, 8.12] : [8.12, top + 0.25, a]);
      V(iv, 'box', rng.pick(GREENS), [0, -len / 2, 0], along ? [0.32, len, 0.06] : [0.06, len, 0.32]);
      V(iv, 'sphere', rng.pick(PALETTE.flower), [0, -len * 0.6, along ? 0.05 : 0], 0.09);
      this.stageItem(iv, 2, 'grow-down');
    }
    // ── Stage 3 (75%): green roof on the hut, vines up the water tower
    this.stageItem(V(st, 'box', '#6cbf4c', [4.9, top + 1.42, -0.95], [1.95, 0.06, 1.4]), 3);
    for (let k = 0; k < 3; k++) {
      const vine = group(st, 'towerVine', [-0.95 + Math.cos(k * 2.1) * 0.5, top + 2.1, 3.4 + Math.sin(k * 2.1) * 0.5]);
      V(vine, 'box', '#4f9e44', [0, -1.0, 0], [0.12, 2.0, 0.12]);
      this.stageItem(vine, 3, 'grow-down');
    }
  }

  forEachStageItem(fn: (e: pc.Entity) => void) {
    for (const it of this.items) fn(it.e);
  }

  /** Show greenery up to `stage` (0..4). Returns true if anything new appeared. */
  setStage(stage: number, instant: boolean): boolean {
    if (stage === this.stage) return false;
    const grew = stage > this.stage && this.stage >= 0;
    this.stage = stage;
    let delay = 0;
    for (const it of this.items) {
      const want = stage >= it.stage;
      if (want === it.shown) continue;
      it.shown = want;
      const e = it.e;
      const b = it.base;
      if (!want) {
        if (it.anim === 'unfold') e.setLocalEulerAngles(0, 0, 0);
        e.enabled = false;
        continue;
      }
      e.enabled = true;
      const d = instant ? 0 : (delay += 0.025);
      const dur = instant ? 0.001 : 0.6;
      if (it.anim === 'grow-down') this.tweens.add(dur, (k) => e.setLocalScale(b.x, Math.max(0.001, b.y * k), b.z), { delay: d, ease: ease.outCubic });
      else if (it.anim === 'unfold') {
        const i = e.getLocalPosition().x;
        this.tweens.add(instant ? 0.001 : 1.2, (k) => e.setLocalEulerAngles(-28 * k, 0, (1 - k) * (i < 0 ? 170 : i > 0 ? -170 : 0)), { delay: d, ease: ease.outBack });
      } else this.tweens.add(dur, (k) => e.setLocalScale(b.x * k, b.y * k, b.z * k), { delay: d, ease: ease.outBack });
    }
    return grew;
  }

  update(dt: number) {
    this.time += dt;
  }
}
