import * as pc from 'playcanvas';
import type { LitLight } from '../gameplay/Lights';
import type { PowerNode } from '../gameplay/PowerGrid';
import type { Sim } from '../gameplay/Sim';
import { LIGHTING } from '../data/lights';
import { color, glow, PALETTE } from './Materials';
import { ball } from './MachineParts';
import { cableY } from './PowerLines';
import { SLAB_TOP } from './SceneBuilder';
import { group } from './Shapes';
import { worldLightLayers } from './WaterSurface';

type V3 = [number, number, number];
const L = PALETTE.light;
/** Brightness steps: lights share one material per tone and step, so they batch into a few draw calls. */
const STEPS = 8;

interface View {
  light: LitLight;
  parts: pc.Entity[];
  /** where the glow sits (for insects) */
  at: V3;
  step: number;
  /** E23.7.5: where this light really shines from, how high that is above the ground, and a share of its glow (which
   * already includes the lamp's own brightness) */
  casts: { pos: V3; h: number; power: number }[];
}

interface Insect {
  e: pc.Entity;
  firefly: boolean;
  phase: number;
}

/**
 * E23.3.5 (#471): what lights look like when they're on. The bodies are decorations (DecorArt, drawn dark); this
 * draws the glowing parts (a warm bulb on each light, bulbs strung along a pole's lines), the light they cast, and
 * fireflies and moths drifting round the lit lights nearest the view. The bulbs glow by emission and share one
 * material per tone and brightness step, batched, so many lights cost a handful of draw calls.
 *
 * E23.7.5: lamps cast real light. Each lit lamp is a point light at its bulb (no shadows), so the ground, the
 * plants, machines and bloombot near it are lit from the lamp's side and the light falls off with distance, as a
 * lamp's does. PlayCanvas' clustered lighting draws them all in the one pass, so they add no draw calls; a pool of
 * LIGHTING.cast.max lights goes to the lit lamps nearest the view, and farther lamps keep their glowing bulbs.
 */
export class LightVisuals {
  private root: pc.Entity;
  private views = new Map<string, View>();
  private sig = '';
  private mats = new Map<string, pc.StandardMaterial>();
  private pool: pc.Entity[] = [];
  /** E28.W05 (#698): the lamps casting light now (nearest the view first when there are more than the pool): where
   * each shines from, its colour (sRGB hex) and how strongly it glows (0 … 1). The water reflects these. */
  readonly shining: { x: number; y: number; z: number; tone: string; power: number }[] = [];
  private toneCol = new Map<string, pc.Color>();
  /** the most real lights at once (Game lowers it on the low graphics tier) */
  maxCast: number = LIGHTING.cast.max;
  /** the Power view's dim on the scene's lights (DayNight.lightShare): the lamps dim with them */
  share = 1;
  /** E23.7.5: photo mode's own darkness (0 day … 1 night) when it sets its own time or weather; else the game's */
  dark: number | undefined = undefined;

  /** How brightly a light glows on screen: the game's glow, or at photo mode's own darkness. */
  private glowOf(l: LitLight): number {
    return this.dark === undefined ? l.glow : this.sim.lights.glowAt(l.key, l.def, this.dark);
  }
  private bulbMesh = ball(8, 12);
  private group = -1;
  private insectGroup = -1;
  private insects: Insect[] = [];
  private time = 0;
  private dirty = false;
  reducedMotion = false;

  constructor(
    private sim: Sim,
    parent: pc.Entity,
    private machineAt: (m: PowerNode) => V3,
    private batcher?: pc.BatchManager,
  ) {
    this.root = group(parent, 'lights');
    if (batcher) {
      this.group = batcher.addGroup('lights', true, 400).id;
      this.insectGroup = batcher.addGroup('lightInsects', true, 400).id;
    }
    const n = LIGHTING.insects.lights * LIGHTING.insects.perLight;
    for (let i = 0; i < n; i++) {
      const firefly = i % 3 !== 2; // two fireflies to a moth
      const e = new pc.Entity(firefly ? 'firefly' : 'moth');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(this.bulbMesh, firefly ? this.mat('firefly', 1) : this.mat('moth', 1))], castShadows: false, receiveShadows: false });
      if (this.insectGroup >= 0) e.render!.batchGroupId = this.insectGroup;
      e.enabled = false;
      this.root.addChild(e);
      this.insects.push({ e, firefly, phase: i * 1.7 });
    }
  }

  /** Lights shown now (tests and the night-scene budget check). */
  stats(): { lights: number; lit: number; insects: number; cast: number } {
    let lit = 0;
    for (const v of this.views.values()) if (v.step > 0) lit++;
    return { lights: this.views.size, lit, insects: this.insects.filter((i) => i.e.enabled).length, cast: this.pool.filter((e) => e.enabled).length };
  }

  /** One shared material per tone and brightness step. `firefly` / `moth` are the insects'. */
  private mat(tone: string, step: number): pc.StandardMaterial {
    const key = `${tone}|${step}`;
    let m = this.mats.get(key);
    if (m) return m;
    m = new pc.StandardMaterial();
    const hex = tone === 'firefly' ? L.firefly : tone === 'moth' ? L.moth : L.lamps[tone as keyof typeof L.lamps];
    m.useLighting = tone === 'moth';
    m.diffuse = tone === 'moth' ? color(hex) : new pc.Color(0, 0, 0);
    m.useFog = tone === 'moth';
    if (tone !== 'moth') {
      m.emissive = color(hex);
      // bulbs are glows (into the bloom range); insects stay soft
      const [lo, hi] = LIGHTING.bulb.glow;
      m.emissiveIntensity = tone === 'firefly' ? 0.35 + step / STEPS : glow(lo + (hi - lo) * (step / STEPS));
    }
    m.update();
    this.mats.set(key, m);
    return m;
  }

  private tileTop(roofId: string, x: number, z: number): V3 {
    const r = this.sim.grid.roof(roofId)!;
    return [r.origin[0] + x + 0.5, r.origin[1] + r.height + SLAB_TOP + this.sim.grid.groundOffset(roofId, x, z), r.origin[2] + z + 0.5];
  }

  private part(parent: pc.Entity, mesh: pc.Mesh, pos: V3, scale: V3 | number): pc.Entity {
    const e = new pc.Entity('glow');
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, this.mat('warm', 0))], castShadows: false, receiveShadows: false });
    e.setLocalPosition(pos[0], pos[1], pos[2]);
    const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
    e.setLocalScale(s[0], s[1], s[2]);
    if (this.group >= 0) e.render!.batchGroupId = this.group;
    parent.addChild(e);
    return e;
  }

  /** Builds the glowing parts of one light (hidden until it is on). */
  private build(l: LitLight): View {
    const g = group(this.root, `light-${l.key}`);
    const def = l.def;
    const parts: pc.Entity[] = [];
    const casts: View['casts'] = [];
    const C = LIGHTING.cast;
    let at: V3;
    if (l.pole) {
      // Bulbs along the near half of every line from this pole (the far pole's own lights fill the other half).
      const p = this.machineAt(l.pole);
      const A: V3 = [p[0], p[1] + cableY(l.pole), p[2]];
      at = A;
      for (const o of this.sim.relays.linked(l.pole)) {
        const q = this.machineAt(o);
        const B: V3 = [q[0], q[1] + cableY(o), q[2]];
        const len = Math.hypot(B[0] - A[0], B[2] - A[2]);
        const sag = Math.min(1.2, len * 0.08);
        const mid: V3 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2 - sag * 2, (A[2] + B[2]) / 2];
        const n = Math.max(1, Math.round(len / (def.spacing ?? 1) / 2));
        for (let i = 1; i <= n; i++) {
          const t = (i / n) * 0.5;
          const u = 1 - t;
          // on the drop cable's curve (PowerLines), hanging a little below it
          const pos: V3 = [u * u * A[0] + 2 * u * t * mid[0] + t * t * B[0], u * u * A[1] + 2 * u * t * mid[1] + t * t * B[1] - 0.08, u * u * A[2] + 2 * u * t * mid[2] + t * t * B[2]];
          const size = def.id === 'fairylights' ? 0.06 : def.id === 'paperlanterns' ? 0.22 : def.id === 'glasslanterns' ? 0.16 : 0.11;
          parts.push(this.part(g, this.bulbMesh, [pos[0], pos[1] - (def.id === 'glasslanterns' ? 0.18 : 0), pos[2]], size));
          // one real light for every `lineEvery` tiles of bulbs, standing in for the bulbs around it
          const every = Math.max(1, Math.round(C.lineEvery / (def.spacing ?? 1)));
          if (i % every === Math.ceil(every / 2) % every) casts.push({ pos: [pos[0], pos[1] - 0.15, pos[2]], h: Math.max(C.minHeight, pos[1] - 0.15 - p[1]), power: C.linePower });
        }
      }
    } else {
      const base = this.tileTop(l.roofId, l.x, l.z);
      const [ox, oz] = turn(l.rot, def.id === 'porchlight' ? 0 : def.id === 'tablelight' ? 0.08 : 0, def.id === 'porchlight' ? -0.1 : def.id === 'tablelight' ? 0.04 : 0);
      at = [base[0] + ox, base[1] + def.bulbY, base[2] + oz];
      const size = (def.id === 'lamppost' || def.id === 'solarlamppost' ? 0.2 : def.id === 'uplight' ? 0.14 : def.id === 'glowpod' ? 0.09 : 0.13) * LIGHTING.bulb.cover;
      if (def.id === 'glowpod') {
        // five little glowing pods on the plant's stems
        for (let i = 0; i < 5; i++) {
          const ang = (i / 5) * Math.PI * 2;
          parts.push(this.part(g, this.bulbMesh, [base[0] + Math.cos(ang) * 0.12, base[1] + 0.25, base[2] + Math.sin(ang) * 0.12], size));
        }
      } else parts.push(this.part(g, this.bulbMesh, at, def.id === 'uplight' ? [size, 0.03, size] : size));
      // the light shines from the bulb; a very low one from a little above it, so its pool isn't a pinprick
      const h = Math.max(def.bulbY, C.minHeight);
      casts.push({ pos: [at[0], base[1] + h, at[2]], h, power: def.id === 'glowpod' ? C.glowPower : 1 });
    }
    for (const e of parts) e.enabled = false;
    return { light: l, parts, at, step: 0, casts };
  }

  update(dt: number, cam?: pc.Vec3): void {
    this.time += dt;
    const lights = this.sim.lights.all();
    // Rebuild only when the set of lights (or a pole's lines) changes.
    const sig = lights.map((l) => (l.pole ? `${l.key}:${l.def.id}:${this.sim.relays.linked(l.pole).map((o) => o.id).join('+')}` : `${l.key}:${l.def.id}@${l.rot}`)).join(';');
    if (sig !== this.sig) {
      this.sig = sig;
      for (const v of this.views.values()) v.parts[0]?.parent?.destroy();
      this.views.clear();
      for (const l of lights) this.views.set(l.key, this.build(l));
      this.dirty = true;
    }
    for (const l of lights) {
      const v = this.views.get(l.key);
      if (!v) continue;
      v.light = l;
      const lit = this.glowOf(l);
      const step = lit < 0.02 ? 0 : Math.max(1, Math.round(lit * STEPS));
      if (step === v.step) continue;
      v.step = step;
      const on = step > 0;
      const bulb = on ? this.mat(l.def.tone, step) : undefined;
      for (const e of v.parts) {
        e.enabled = on;
        if (bulb) e.render!.meshInstances[0].material = bulb;
      }
      this.dirty = true;
    }
    if (this.dirty && this.batcher && this.group >= 0) this.batcher.markGroupDirty(this.group);
    this.dirty = false;
    this.updateCast(cam);
    this.updateInsects(cam);
  }

  /**
   * E23.7.5: the real lights. The pool goes to the lit lamps nearest the view; each shines in its lamp's colour
   * from the bulb, as strong as the lamp glows now (so they fade in at dusk and dim on a short grid), and falls
   * off with the square of the distance. No shadows: the moon keeps those.
   */
  private updateCast(cam?: pc.Vec3) {
    const C = LIGHTING.cast;
    const want: { pos: V3; h: number; power: number; tone: string; d: number }[] = [];
    for (const v of this.views.values()) {
      const glow = this.glowOf(v.light);
      if (glow < 0.02) continue;
      for (const c of v.casts) want.push({ pos: c.pos, h: c.h, power: c.power * glow, tone: v.light.def.tone, d: cam ? dist2(c.pos, cam) : 0 });
    }
    if (want.length > this.maxCast) want.sort((a, b) => a.d - b.d);
    const n = Math.min(want.length, this.maxCast);
    while (this.pool.length < n) {
      const e = new pc.Entity('lamp-light');
      e.addComponent('light', { type: 'omni', castShadows: false, falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED, affectSpecularity: false, layers: worldLightLayers() });
      this.root.addChild(e);
      this.pool.push(e);
    }
    // E28.W05 (#698): the lamps shining now, for the water to reflect (WaterSurface.setWaterLamps)
    this.shining.length = 0;
    for (let i = 0; i < n; i++) {
      const w = want[i];
      this.shining.push({ x: w.pos[0], y: w.pos[1], z: w.pos[2], tone: L.lamps[w.tone as keyof typeof L.lamps] ?? L.lamps.warm, power: w.power });
    }
    this.pool.forEach((e, i) => {
      const w = want[i];
      e.enabled = i < n;
      if (i >= n) return;
      const light = e.light!;
      e.setLocalPosition(w.pos[0], w.pos[1], w.pos[2]);
      let col = this.toneCol.get(w.tone);
      if (!col) this.toneCol.set(w.tone, (col = color(L.lamps[w.tone as keyof typeof L.lamps])));
      light.color = col;
      light.range = C.range * (0.6 + 0.4 * Math.min(1, w.power)) + w.h;
      light.intensity = C.intensity * w.power * this.share;
    });
  }

  /**
   * Fireflies and moths gather at the lit lights nearest the view (never a light that's out). Fireflies drift and
   * blink low around the glow; moths flutter close round the bulb. They never scare anything away.
   */
  private updateInsects(cam?: pc.Vec3) {
    const lit = [...this.views.values()].filter((v) => v.step >= STEPS * 0.35);
    if (cam) lit.sort((a, b) => dist2(a.at, cam) - dist2(b.at, cam));
    const hosts = lit.slice(0, LIGHTING.insects.lights);
    const per = LIGHTING.insects.perLight;
    const t = this.time;
    this.insects.forEach((ins, i) => {
      const host = hosts[Math.floor(i / per)];
      if (!host) {
        ins.e.enabled = false;
        return;
      }
      ins.e.enabled = true;
      const [x, y, z] = host.at;
      const ph = ins.phase;
      const tm = this.reducedMotion ? ph : t;
      if (ins.firefly) {
        const r = 0.5 + 0.35 * Math.sin(tm * 0.3 + ph);
        const a = tm * 0.35 + ph;
        ins.e.setLocalPosition(x + Math.cos(a) * r, Math.max(y - 0.6, host.at[1] - host.light.def.bulbY + 0.25) + 0.25 * Math.sin(tm * 0.7 + ph), z + Math.sin(a) * r);
        const blink = 0.5 + 0.5 * Math.sin(tm * 2.3 + ph * 3);
        const s = 0.025 + 0.025 * blink;
        ins.e.setLocalScale(s, s, s);
      } else {
        const a = tm * 2.6 + ph;
        const r = 0.22 + 0.06 * Math.sin(tm * 5 + ph);
        ins.e.setLocalPosition(x + Math.cos(a) * r, y + 0.08 * Math.sin(tm * 3.7 + ph), z + Math.sin(a * 1.3) * r);
        ins.e.setLocalScale(0.035, 0.012, 0.03);
      }
    });
  }
}

function dist2(a: V3, b: pc.Vec3): number {
  return (a[0] - b.x) ** 2 + (a[1] - b.y) ** 2 + (a[2] - b.z) ** 2;
}

/** A quarter-turned local offset (as DecorArt turns its parts). */
function turn(rot: number, dx: number, dz: number): [number, number] {
  switch (rot & 3) {
    case 1:
      return [dz, -dx];
    case 2:
      return [-dx, -dz];
    case 3:
      return [-dz, dx];
    default:
      return [dx, dz];
  }
}
