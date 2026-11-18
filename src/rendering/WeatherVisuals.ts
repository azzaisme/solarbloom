import * as pc from 'playcanvas';
import type { WeatherKind } from '../data/weather';
import { WEATHER } from '../data/weather';

/** What the weather looks like at a moment (from the sim, or photo mode's own pick). */
export interface WeatherLook {
  kind: WeatherKind;
}

const DROPS = 700;
const BOX = 22; // drops fall in a box this wide round the camera's target
const TOP = 14;

/**
 * E23.7.2 (#396): the weather on screen. Rain and a storm's downpour are streaks falling round the view (one
 * dynamic mesh); a storm adds lightning flashes; fog pulls the haze in; wind hurries the clouds. Overcast skies
 * and dimmer light come through DayNight (`overcast`). Presentation only: it reads the weather and changes nothing.
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

  constructor(app: pc.AppBase, parent: pc.Entity) {
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < DROPS; i++) this.drops.push({ x: (rnd() - 0.5) * BOX, y: rnd() * TOP, z: (rnd() - 0.5) * BOX, s: 0.8 + rnd() * 0.4 });
    this.pos = new Float32Array(DROPS * 2 * 3);
    this.mesh = new pc.Mesh(app.graphicsDevice);
    this.mesh.setPositions(this.pos);
    const idx: number[] = [];
    for (let i = 0; i < DROPS * 2; i++) idx.push(i);
    this.mesh.setIndices(idx);
    this.mesh.update(pc.PRIMITIVE_LINES);
    const m = new pc.StandardMaterial();
    m.useLighting = false;
    m.emissive = new pc.Color(0.78, 0.84, 0.92);
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
  }

  private material: pc.StandardMaterial;

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
    const rainTarget = Math.min(1, e.rain);
    this.rainA += (rainTarget - this.rainA) * ease;
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
    const len = look.kind === 'storm' ? 0.55 : 0.4;
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
    this.material.opacity = 0.35 + 0.2 * this.rainA;
  }
}
