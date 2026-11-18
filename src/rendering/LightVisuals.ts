import * as pc from 'playcanvas';
import type { LitLight } from '../gameplay/Lights';
import type { PowerNode } from '../gameplay/PowerGrid';
import type { Sim } from '../gameplay/Sim';
import { LIGHTING } from '../data/lights';
import { color, PALETTE } from './Materials';
import { ball } from './MachineParts';
import { cableY } from './PowerLines';
import { SLAB_TOP } from './SceneBuilder';
import { group } from './Shapes';

type V3 = [number, number, number];
const L = PALETTE.light;
/** Brightness steps: lights share one material per tone and step, so they batch into a few draw calls. */
const STEPS = 8;

interface View {
  light: LitLight;
  parts: pc.Entity[];
  halo?: pc.Entity;
  /** where the glow sits (for insects) */
  at: V3;
  step: number;
}

interface Insect {
  e: pc.Entity;
  firefly: boolean;
  phase: number;
}

/**
 * E23.3.5 (#471): what lights look like when they're on. The bodies are decorations (DecorArt, drawn dark); this
 * draws only the glowing parts: a warm bulb and a soft pool of light on the ground under each light, bulbs strung
 * along a pole's lines, and fireflies and moths drifting round the lit lights nearest the view. Everything glows by
 * emission (no real lights, so a night of many lamps stays inside the Deck's light budget) and shares one material
 * per tone and brightness step, batched, so many lights cost a handful of draw calls.
 */
export class LightVisuals {
  private root: pc.Entity;
  private views = new Map<string, View>();
  private sig = '';
  private mats = new Map<string, pc.StandardMaterial>();
  private haloMesh: pc.Mesh;
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
    const device = pc.AppBase.getApplication()!.graphicsDevice;
    this.haloMesh = haloDisc(device);
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
  stats(): { lights: number; lit: number; insects: number } {
    let lit = 0;
    for (const v of this.views.values()) if (v.step > 0) lit++;
    return { lights: this.views.size, lit, insects: this.insects.filter((i) => i.e.enabled).length };
  }

  /** One shared material per tone and brightness step. `firefly` / `moth` are the insects'. */
  private mat(tone: string, step: number, halo = false): pc.StandardMaterial {
    const key = `${tone}|${step}|${halo ? 'h' : 'b'}`;
    let m = this.mats.get(key);
    if (m) return m;
    m = new pc.StandardMaterial();
    const hex = tone === 'firefly' ? L.firefly : tone === 'moth' ? L.moth : L.lamps[tone as keyof typeof L.lamps];
    m.useLighting = tone === 'moth';
    m.diffuse = tone === 'moth' ? color(hex) : new pc.Color(0, 0, 0);
    m.useFog = tone === 'moth';
    if (tone !== 'moth') {
      m.emissive = color(hex);
      m.emissiveIntensity = halo ? 0.16 * (step / STEPS) : 0.35 + 1.0 * (step / STEPS);
    }
    if (halo) {
      m.emissiveVertexColor = true;
      m.emissiveVertexColorChannel = 'rgb';
      m.opacityVertexColor = true;
      m.opacityVertexColorChannel = 'a';
      m.blendType = pc.BLEND_ADDITIVE;
      m.depthWrite = false;
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
    let halo: pc.Entity | undefined;
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
        }
      }
    } else {
      const base = this.tileTop(l.roofId, l.x, l.z);
      const [ox, oz] = turn(l.rot, def.id === 'porchlight' ? 0 : def.id === 'tablelight' ? 0.08 : 0, def.id === 'porchlight' ? -0.1 : def.id === 'tablelight' ? 0.04 : 0);
      at = [base[0] + ox, base[1] + def.bulbY, base[2] + oz];
      const size = def.id === 'lamppost' ? 0.2 : def.id === 'uplight' ? 0.14 : def.id === 'glowpod' ? 0.09 : 0.13;
      if (def.id === 'glowpod') {
        // five little glowing pods on the plant's stems
        for (let i = 0; i < 5; i++) {
          const ang = (i / 5) * Math.PI * 2;
          parts.push(this.part(g, this.bulbMesh, [base[0] + Math.cos(ang) * 0.12, base[1] + 0.25, base[2] + Math.sin(ang) * 0.12], size));
        }
      } else parts.push(this.part(g, this.bulbMesh, at, def.id === 'uplight' ? [size, 0.03, size] : size));
      // a soft pool of light on the ground (an uplight's is larger: it washes what stands beside it)
      const r = (def.id === 'uplight' ? 1.4 : def.id === 'lamppost' ? 1.9 : 1.0) * def.brightness;
      halo = this.part(g, this.haloMesh, [base[0] + ox, base[1] + 0.03, base[2] + oz], [r, 1, r]);
    }
    for (const e of [...parts, ...(halo ? [halo] : [])]) e.enabled = false;
    return { light: l, parts, halo, at, step: 0 };
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
      const step = l.glow < 0.02 ? 0 : Math.max(1, Math.round(l.glow * STEPS));
      if (step === v.step) continue;
      v.step = step;
      const on = step > 0;
      const bulb = on ? this.mat(l.def.tone, step) : undefined;
      const halo = on ? this.mat(l.def.tone, step, true) : undefined;
      for (const e of v.parts) {
        e.enabled = on;
        if (bulb) e.render!.meshInstances[0].material = bulb;
      }
      if (v.halo) {
        v.halo.enabled = on;
        if (halo) v.halo.render!.meshInstances[0].material = halo;
      }
      this.dirty = true;
    }
    if (this.dirty && this.batcher && this.group >= 0) this.batcher.markGroupDirty(this.group);
    this.dirty = false;
    this.updateInsects(cam);
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

/** A flat disc of radius 1 whose vertex colour fades from the centre (bright, opaque) to the rim (clear). */
function haloDisc(device: pc.GraphicsDevice): pc.Mesh {
  const pos: number[] = [0, 0, 0];
  const nrm: number[] = [0, 1, 0];
  // Additive: brightness is the vertex colour, so it falls from the centre to nothing at the rim.
  const col: number[] = [150, 150, 150, 255];
  const idx: number[] = [];
  const seg = 20;
  for (const [r, a, b] of [[0.4, 255, 70], [1, 255, 0]] as const) {
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      pos.push(Math.cos(t) * r, 0, Math.sin(t) * r);
      nrm.push(0, 1, 0);
      col.push(b, b, b, a);
    }
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    idx.push(0, 1 + j, 1 + i);
    idx.push(1 + i, 1 + j, 1 + seg + j, 1 + i, 1 + seg + j, 1 + seg + i);
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(pos);
  mesh.setNormals(nrm);
  mesh.setColors32(col);
  mesh.setIndices(idx);
  mesh.update();
  mesh.incRefCount(); // shared by every light's pool, rebuilt as lights come and go: never let the engine free it
  return mesh;
}
