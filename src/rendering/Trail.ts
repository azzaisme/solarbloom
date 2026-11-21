import * as pc from 'playcanvas';
import { levelY } from '../core/Height';
import { WAYMARK } from '../data/waymark';
import type { Sim } from '../gameplay/Sim';
import { trailDots, type TrailRoute } from '../gameplay/TrailRoute';
import { PALETTE } from './Materials';
import { SLAB_TOP } from './SceneBuilder';
import { group } from './Shapes';
import { glowMaterial } from './TileFx';

/** Each dot: a centre, then rings at the core's edge, in the dark rim, and at the halo's edge. */
const SEG = 12;
const RINGS = 3;
const PER_DOT = 1 + SEG * RINGS;

const smooth = (a: number) => {
  const t = Math.max(0, Math.min(1, a));
  return t * t * (3 - 2 * t);
};

/**
 * #632: Show me where's trail. Soft glowing dots lie on the ground along the walkable way from bloombot to the goal
 * (gameplay/TrailRoute.ts). It runs out from bloombot when asked, a faint glow drifts along it towards the goal, the
 * dots bloombot walks past fade behind it, and the whole trail fades after a while or once bloombot gets there.
 * Pressing again draws it afresh. It ignores the fog (as the waymark does), so it reads in mist and at night.
 * Reduced motion: it appears at once and nothing runs along it.
 */
export class Trail {
  private root: pc.Entity;
  private material: pc.StandardMaterial;
  private mesh?: pc.Mesh;
  private dots: { x: number; z: number; s: number }[] = [];
  private colors = new Uint8Array(0);
  /** each dot's centre in the world, and the vertex positions (rebuilt as the dots grow with distance) */
  private centres: number[] = [];
  private positions = new Float32Array(0);
  private route?: TrailRoute;
  private age = 0;
  /** how far along the way bloombot has got (cells), never going back */
  private progress = 0;
  /** 0 … 1 while it fades out early (bloombot got there) */
  private leaving = 0;
  reducedMotion = false;
  private dayColor = new pc.Color().fromString(PALETTE.signal.trailDay);
  private nightColor = new pc.Color().fromString(PALETTE.signal.trail);

  constructor(
    private sim: Sim,
    parent: pc.Entity,
  ) {
    this.root = group(parent, 'trail');
    this.material = glowMaterial(PALETTE.signal.trail, WAYMARK.trail.glow);
    this.root.enabled = false;
  }

  /** Is a trail on the ground now (tests and screenshots read it)? */
  get showing(): boolean {
    return this.root.enabled && !!this.route;
  }

  /** The way it is drawing, while it shows. */
  get way(): TrailRoute | undefined {
    return this.showing ? this.route : undefined;
  }

  /** How many dots it laid. */
  get count(): number {
    return this.dots.length;
  }

  /** Lays a new trail along `route` (replacing any trail already down). */
  show(route: TrailRoute) {
    this.clear();
    this.centres = [];
    const layer = this.sim.grid.layer(route.roofId);
    const dots = trailDots(route.points);
    if (!layer || !dots.length) return;
    this.route = route;
    this.dots = dots;
    this.age = 0;
    this.progress = 0;
    this.leaving = 0;
    const T = WAYMARK.trail;
    const pos: number[] = [];
    const idx: number[] = [];
    for (const d of dots) {
      const lv = this.sim.grid.peek(route.roofId, Math.floor(d.x), Math.floor(d.z))?.level;
      const y = layer.origin[1] + layer.height + SLAB_TOP + (lv !== undefined ? levelY(lv) : 0) + T.lift;
      const x = layer.origin[0] + d.x;
      const z = layer.origin[2] + d.z;
      const base = pos.length / 3;
      this.centres.push(x, y, z);
      pos.push(x, y, z);
      for (const r of [T.dot, T.rim, T.halo])
        for (let k = 0; k < SEG; k++) {
          const a = (k / SEG) * Math.PI * 2;
          pos.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
        }
      for (let k = 0; k < SEG; k++) {
        const k1 = (k + 1) % SEG;
        idx.push(base, base + 1 + k, base + 1 + k1);
        for (let ring = 0; ring < RINGS - 1; ring++) {
          const i0 = base + 1 + ring * SEG + k;
          const i1 = base + 1 + ring * SEG + k1;
          idx.push(i0, i0 + SEG, i1 + SEG, i0, i1 + SEG, i1);
        }
      }
    }
    const device = pc.AppBase.getApplication()!.graphicsDevice;
    const mesh = new pc.Mesh(device);
    this.positions = new Float32Array(pos);
    mesh.setPositions(this.positions);
    mesh.setNormals(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)));
    this.colors = new Uint8Array(dots.length * PER_DOT * 4);
    mesh.setColors32(this.colors);
    mesh.setIndices(idx);
    mesh.update();
    this.mesh = mesh;
    this.root.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, this.material)], castShadows: false, receiveShadows: false });
    this.root.enabled = true;
  }

  /** Takes the trail up at once. */
  clear() {
    this.root.removeComponent('render');
    this.mesh?.destroy();
    this.mesh = undefined;
    this.route = undefined;
    this.dots = [];
    this.root.enabled = false;
  }

  /**
   * Each frame. `show`: false while something else owns the screen (building, photo mode, a cutscene); it hides
   * then, and is gone afterwards if it ran out meanwhile. `bot`: bloombot's position. `night`: 0 by day … 1 at night.
   */
  /**
   * Seen from the low follow camera a flat dot shrinks to a sliver a few metres off, so each dot grows with its
   * distance from the camera (up to `farScale`), and the stretch ahead stays readable.
   */
  private size(camera: pc.Vec3) {
    const T = WAYMARK.trail;
    const c = this.centres;
    const p = this.positions;
    let o = 0;
    for (let i = 0; i < c.length; i += 3) {
      const x = c[i];
      const y = c[i + 1];
      const z = c[i + 2];
      const d = Math.hypot(x - camera.x, y - camera.y, z - camera.z);
      const k = Math.min(T.farScale, Math.max(1, 1 + (d - T.nearDistance) * T.growth));
      p[o++] = x;
      p[o++] = y;
      p[o++] = z;
      for (const r of [T.dot, T.rim, T.halo])
        for (let j = 0; j < SEG; j++) {
          const a = (j / SEG) * Math.PI * 2;
          p[o++] = x + Math.cos(a) * r * k;
          p[o++] = y;
          p[o++] = z + Math.sin(a) * r * k;
        }
    }
    this.mesh!.setPositions(p);
  }

  update(dt: number, show: boolean, bot: { roofId: string; x: number; z: number } | undefined, night: number, camera?: pc.Vec3) {
    const route = this.route;
    if (!route || !this.mesh) return;
    const T = WAYMARK.trail;
    this.age += dt;
    const total = this.dots[this.dots.length - 1].s;
    // bloombot walking the way: the nearest dot ahead of what it has passed marks its progress
    if (bot && bot.roofId === route.roofId) {
      let best = Infinity;
      let at = this.progress;
      for (const d of this.dots) {
        if (d.s < this.progress - 2 || d.s > this.progress + 8) continue;
        const dd = Math.hypot(d.x - bot.x, d.z - bot.z);
        if (dd < best) {
          best = dd;
          at = d.s;
        }
      }
      if (best < 1.2) this.progress = Math.max(this.progress, at);
      const end = route.points[route.points.length - 1];
      const there = Math.hypot(end.x - bot.x, end.z - bot.z) < T.reach * 0.75 && this.progress > total - T.reach * 2;
      if (there) this.leaving = Math.min(1, this.leaving + dt / T.fade);
    }
    const out = Math.max(this.leaving, smooth((this.age - T.life) / T.fade));
    if (out >= 1) return this.clear();
    if (this.root.enabled !== show) this.root.enabled = show;
    if (!show) return;
    const speed = Math.max(T.draw, total / T.drawMax);
    const front = this.reducedMotion ? Infinity : this.age * speed;
    const run = this.reducedMotion ? -Infinity : ((this.age * T.run) % (total + T.runLength * 2)) - T.runLength;
    const c = this.colors;
    const dark = Math.max(0, Math.min(1, night));
    const shade = Math.round(255 * T.rimShade);
    const rimA = T.rimAlpha * (1 - dark);
    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i];
      const drawn = smooth((front - d.s) / 1.5);
      const behind = smooth((d.s - this.progress + T.behind * 0.5) / T.behind);
      // the last few dots soften into the goal's light
      const tail = route.reached ? 1 : 0.55 + 0.45 * smooth((total - d.s) / 3);
      const a = drawn * behind * tail * (1 - out);
      const lift = 1 + T.runLift * Math.exp(-(((d.s - run) / T.runLength) ** 2) * 2);
      const bright = Math.min(255, Math.round(200 * lift));
      let o = i * PER_DOT * 4;
      const put = (rgb: number, alpha: number, n: number) => {
        for (let k = 0; k < n; k++) {
          c[o++] = rgb;
          c[o++] = rgb;
          c[o++] = rgb;
          c[o++] = Math.round(255 * alpha);
        }
      };
      put(bright, a, 1);
      put(bright, a * 0.95, SEG);
      // the dark rim: strong by day on pale ground, gone at night (the glow carries it there); its edge fades to nothing
      put(shade, a * rimA, SEG);
      put(shade, 0, SEG);
    }
    this.mesh.setColors32(c);
    if (camera) this.size(camera);
    this.mesh.update(pc.PRIMITIVE_TRIANGLES, !!camera);
    this.material.emissive.lerp(this.dayColor, this.nightColor, dark);
    this.material.emissiveIntensity = T.glow + (T.nightGlow - T.glow) * dark;
    this.material.update();
  }
}
