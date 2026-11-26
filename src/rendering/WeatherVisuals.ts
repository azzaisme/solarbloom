import * as pc from 'playcanvas';
import type { WeatherKind } from '../data/weather';
import { WEATHER } from '../data/weather';
import { color, PALETTE } from './Materials';

/** What the weather looks like at a moment (from the sim, or photo mode's own pick). */
export interface WeatherLook {
  kind: WeatherKind;
}

const DROPS = 1400;
const BOX = 16; // drops fall in a box this wide round the camera's target
const TOP = 14;
/** #830: snowflakes (a tiny diamond each, in one mesh); the Low setting draws fewer */
const FLAKES = 420;
const FLAKE_V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FLAKE_I = [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5];

/**
 * E23.7.2 (#396): the weather on screen. Rain and a storm's downpour are streaks falling round the view (one
 * dynamic mesh); a storm adds lightning flashes; fog pulls the haze in; wind hurries the clouds. Overcast skies
 * and dimmer light come through DayNight (`overcast`). Presentation only: it reads the weather and changes nothing.
 * #830: winter's snow drifts down slowly as soft flakes that sway on the wind (a second small mesh).
 */
export class WeatherVisuals {
  private mesh: pc.Mesh;
  private entity: pc.Entity;
  private pos: Float32Array;
  private drops: { x: number; y: number; z: number; s: number }[] = [];
  private rainA = 0;
  private overcastNow = 0;
  private viewNow = 1;
  private windNow = 0;
  private flash = 0;
  private nextFlash = 3;
  private t = 0;
  reducedMotion = false;
  lowVfx = false;
  /** #830: the Low graphics setting (the Steam Deck's): a third of the snowflakes */
  lowTier = false;

  constructor(app: pc.AppBase, parent: pc.Entity) {
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < DROPS; i++) this.drops.push({ x: (rnd() - 0.5) * BOX, y: rnd() * TOP, z: (rnd() - 0.5) * BOX, s: 0.8 + rnd() * 0.4 });
    this.pos = new Float32Array(DROPS * 2 * 3);
    this.mesh = new pc.Mesh(app.graphicsDevice);
    this.mesh.setPositions(this.pos);
    // the shader asks for normals even unlit (a console error every frame without them): straight up
    const nrm = new Float32Array(DROPS * 2 * 3);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    this.mesh.setNormals(nrm);
    const idx: number[] = [];
    for (let i = 0; i < DROPS * 2; i++) idx.push(i);
    this.mesh.setIndices(idx);
    this.mesh.update(pc.PRIMITIVE_LINES);
    const m = new pc.StandardMaterial();
    m.useLighting = false;
    m.emissive = new pc.Color(0.5, 0.58, 0.7);
    m.diffuse = new pc.Color(0, 0, 0);
    m.opacity = 0.45;
    m.blendType = pc.BLEND_NORMAL;
    m.depthWrite = false;
    m.update();
    this.material = m;
    this.entity = new pc.Entity('rain');
    const mi = new pc.MeshInstance(this.mesh, m);
    mi.cull = false;
    this.entity.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false });
    this.entity.enabled = false;
    parent.addChild(this.entity);
    // #830: the snowflakes
    for (let i = 0; i < FLAKES; i++) this.flakes.push({ x: (rnd() - 0.5) * BOX, y: rnd() * TOP, z: (rnd() - 0.5) * BOX, s: 0.7 + rnd() * 0.6, ph: rnd() * 6.283 });
    this.flakePos = new Float32Array(FLAKES * 6 * 3);
    this.flakeMesh = new pc.Mesh(app.graphicsDevice);
    this.flakeMesh.setPositions(this.flakePos);
    const fn = new Float32Array(FLAKES * 6 * 3);
    for (let i = 0; i < FLAKES * 6; i++) fn.set(FLAKE_V[i % 6], i * 3);
    this.flakeMesh.setNormals(fn);
    const fi: number[] = [];
    for (let i = 0; i < FLAKES; i++) for (const k of FLAKE_I) fi.push(i * 6 + k);
    this.flakeMesh.setIndices(fi);
    this.flakeMesh.update(pc.PRIMITIVE_TRIANGLES);
    const fm = new pc.StandardMaterial();
    fm.useLighting = false;
    fm.emissive = color(PALETTE.season.snow);
    fm.diffuse = new pc.Color(0, 0, 0);
    fm.opacity = 0.9;
    fm.blendType = pc.BLEND_NORMAL;
    fm.depthWrite = false;
    fm.update();
    this.flakeMat = fm;
    this.snowEntity = new pc.Entity('snow');
    const fmi = new pc.MeshInstance(this.flakeMesh, fm);
    fmi.cull = false;
    this.snowEntity.addComponent('render', { meshInstances: [fmi], castShadows: false, receiveShadows: false });
    this.snowEntity.enabled = false;
    parent.addChild(this.snowEntity);
  }

  private material: pc.StandardMaterial;
  private flakes: { x: number; y: number; z: number; s: number; ph: number }[] = [];
  private flakePos: Float32Array;
  private flakeMesh: pc.Mesh;
  private flakeMat: pc.StandardMaterial;
  private snowEntity: pc.Entity;
  private snowA = 0;
  /** flakes drawn last frame (the rest are parked below the world and need no update) */
  private lastShown = FLAKES;

  /** #830: how much snow is falling now, 0 … 1, eased (the e2e reads it). */
  get snow(): number {
    return this.snowA;
  }

  /** How many flakes are drawn now (the e2e and the Low setting's check read it). */
  get flakesShown(): number {
    return this.snowEntity.enabled ? Math.floor(FLAKES * this.snowA * (this.lowTier ? 0.33 : this.lowVfx ? 0.45 : 1)) : 0;
  }

  /** 0 clear … 1 storm grey, eased (DayNight and the sky read it). */
  get overcast(): number {
    return this.overcastNow;
  }

  /** Haze reach share (fog shortens the view), eased. */
  get view(): number {
    return this.viewNow;
  }

  /** Wind 0 … 1, eased (the clouds read it). */
  get wind(): number {
    return this.windNow;
  }

  /** A lightning flash, 0 … 1 (DayNight adds it to the light). */
  get lightning(): number {
    return this.flash;
  }

  update(dt: number, look: WeatherLook, around: pc.Vec3) {
    this.t += dt;
    const e = WEATHER[look.kind];
    const ease = 1 - Math.exp(-dt / 2.5);
    this.overcastNow += (e.overcast - this.overcastNow) * ease;
    this.viewNow += (e.view - this.viewNow) * ease;
    this.windNow += (e.wind - this.windNow) * ease;
    const snowing = look.kind === 'snow';
    const rainTarget = snowing ? 0 : Math.min(1, e.rain);
    this.rainA += (rainTarget - this.rainA) * ease;
    this.snowA += ((snowing ? 1 : 0) - this.snowA) * ease;
    this.updateSnow(dt, around);
    // lightning: a storm flashes now and then (never with reduced motion: no strobing)
    this.flash = Math.max(0, this.flash - dt * 3.5);
    if (look.kind === 'storm' && !this.reducedMotion) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flash = 1;
        this.nextFlash = 6 + ((Math.sin(this.t * 12.9898) * 43758.5453) % 1 + 1) % 1 * 14;
      }
    }
    const show = this.rainA > 0.02 && !this.reducedMotion;
    this.entity.enabled = show;
    if (!show) return;
    const count = Math.floor(DROPS * this.rainA * (this.lowVfx ? 0.4 : 1));
    const fall = (look.kind === 'storm' ? 16 : 11) * dt;
    const slant = 0.12 + this.windNow * 0.35;
    const len = look.kind === 'storm' ? 1.1 : 0.8;
    const p = this.pos;
    for (let i = 0; i < DROPS; i++) {
      const d = this.drops[i];
      const j = i * 6;
      if (i >= count) {
        p[j] = p[j + 3] = around.x;
        p[j + 1] = p[j + 4] = -50;
        p[j + 2] = p[j + 5] = around.z;
        continue;
      }
      d.y -= fall * d.s;
      d.x += fall * d.s * slant;
      if (d.y < 0) {
        d.y += TOP;
        d.x = ((d.x + BOX / 2) % BOX) - BOX / 2;
      }
      if (d.x > BOX / 2) d.x -= BOX;
      const x = around.x + d.x;
      const y = around.y + d.y;
      const z = around.z + d.z;
      p[j] = x;
      p[j + 1] = y;
      p[j + 2] = z;
      p[j + 3] = x - slant * len;
      p[j + 4] = y + len;
      p[j + 5] = z;
    }
    this.mesh.setPositions(p);
    this.mesh.update(pc.PRIMITIVE_LINES, false);
    this.material.opacity = 0.5 + 0.3 * this.rainA;
  }

  /** #830: snowflakes drift down slowly, swaying, round the view (none with reduced motion: the frost still shows). */
  private updateSnow(dt: number, around: pc.Vec3) {
    const show = this.snowA > 0.02 && !this.reducedMotion;
    this.snowEntity.enabled = show;
    if (!show) return;
    const count = this.flakesShown;
    const shown = this.lastShown;
    this.lastShown = count;
    const fall = 0.9 * dt;
    const drift = (0.12 + this.windNow * 0.5) * dt;
    const p = this.flakePos;
    const size = 0.028;
    for (let i = 0; i < FLAKES; i++) {
      const f = this.flakes[i];
      const j = i * 18;
      if (i >= count) {
        if (i >= shown) break; // already parked out of sight
        for (let v = 0; v < 6; v++) {
          p[j + v * 3] = around.x;
          p[j + v * 3 + 1] = -50;
          p[j + v * 3 + 2] = around.z;
        }
        continue;
      }
      f.y -= fall * f.s;
      f.x += drift * f.s;
      if (f.y < 0) f.y += TOP;
      if (f.x > BOX / 2) f.x -= BOX;
      const sway = Math.sin(this.t * 1.3 + f.ph) * 0.35;
      const x = around.x + f.x + sway;
      const y = around.y + f.y;
      const z = around.z + f.z + Math.cos(this.t * 1.1 + f.ph) * 0.25;
      const r = size * f.s;
      for (let v = 0; v < 6; v++) {
        const o = FLAKE_V[v];
        p[j + v * 3] = x + o[0] * r;
        p[j + v * 3 + 1] = y + o[1] * r;
        p[j + v * 3 + 2] = z + o[2] * r;
      }
    }
    this.flakeMesh.setPositions(p);
    this.flakeMesh.update(pc.PRIMITIVE_TRIANGLES, false);
    // draw only the flakes in use (Low draws a third)
    this.flakeMesh.primitive[0].count = count * FLAKE_I.length;
    // the material only changes while the snow fades in or out
    const op = Math.round(0.9 * Math.min(1, this.snowA * 1.5) * 50) / 50;
    if (op !== this.flakeMat.opacity) {
      this.flakeMat.opacity = op;
      this.flakeMat.update();
    }
  }
}
