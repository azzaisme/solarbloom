import * as pc from 'playcanvas';
import { GROUND } from '../core/GameState';
import { levelAt, levelY } from '../core/Height';
import { CHUNK } from '../core/Hash';
import { regionById } from '../core/OldCityLayout';
import { REGIONS, type GateDef } from '../data/oldcity';
import { LOOK } from '../data/look';
import type { Sim } from '../gameplay/Sim';
import { hash01 } from './FaunaPlan';
import { FoliageBuilder, foliageMaterial } from './Foliage';
import { giantGeo } from './GiantTreeGen';
import { laidHedge } from './HedgeGen';
import { PALETTE } from './Palette';
import { SLAB_TOP } from './SceneBuilder';

/** One sealed (or still hidden) area's wall: its hedge, the dead trees and forcefield at its entrance, and its leaving. */
interface Line {
  root: pc.Entity;
  /** its entrance's forcefield (none on a hidden area's ring) */
  fields: Field[];
  /** withering after its gate opened: seconds since it started (undefined while standing) */
  leaving?: number;
}

/** A region's way in, on its hedge: where along the edge, the hedge's line, the forcefield's line just in front of it. */
interface Entrance {
  along: 'x' | 'z';
  at: number;
  line: number;
  front: number;
  half: number;
  y: number;
}

/** A forcefield panel's material, pulsing gently, and the brighter glow filling it as its lock's ground comes back. */
interface Field {
  mat: pc.StandardMaterial;
  phase: number;
  gate?: GateDef;
  fill: pc.Entity;
  /** the bright line along the fill's top, so the level reads from a distance */
  edge: pc.Entity;
}

/**
 * #hedge-line (owner, 27 Nov 2026): what marks an area Bloombot can't enter yet. It replaced the cloud walls (stacks
 * of white puffs that read as props): a dead laid hedge (HedgeGen: bent-over stems, stakes, a woven binding, dead whips
 * and thorny canes; no leaves, nothing round it has been revived) along every edge where a sealed area meets open
 * ground, an impenetrable wall. At a region's entrance (its gate) two big dead trees stand either side of a locked
 * green forcefield (no posts, owner) in front of the hedge (which runs on behind it), a padlock glowing on it: the way in, once Bloombot can prune through.
 * When the gate opens, the wall withers back into the ground over a couple of seconds.
 *
 * With LOOK.hedgeLine.ring on, still-hidden areas next to revealed ground get the same hedge (no entrance), so the
 * open island reads as walled in by an overgrown garden rather than fading into grey haze.
 *
 * One mesh per area (the hedge batched with FoliageBuilder, so it takes the park's plant shading) plus the entrance's
 * trees and forcefield. Purely visual: the gates and the Walker keep Bloombot out.
 */
export class HedgeLine {
  private lines = new Map<string, Line>();
  /** the forcefields of the wall being built */
  private building: Field[] = [];
  private root: pc.Entity;
  private time = 0;
  private fillWait = 0;
  reducedMotion = false;

  constructor(
    private sim: Sim,
    parent: pc.Entity,
    private device: pc.GraphicsDevice,
  ) {
    this.root = new pc.Entity('hedgeLine');
    parent.addChild(this.root);
  }

  /** Rebuilds every sealed area's wall (call after reveals and gate openings). */
  sync() {
    const s = this.sim;
    const sealed = new Set(s.areas.sealedAreas());
    if (LOOK.hedgeLine.ring) for (const id of this.hiddenNeighbours()) sealed.add(id);
    // hedge gates inside open ground (Saltwind's boardwalk): a short plug of hedge across the way
    const plugs = new Map<string, GateDef>();
    for (const r of REGIONS) if (r.gate.kind === 'hedge' && r.gate.plug && !s.gates.isOpen(r.gate.id) && s.areas.fog(r.id) !== 'hidden') plugs.set(`plug:${r.gate.id}`, r.gate);
    for (const [id, l] of this.lines) if (l.leaving === undefined && !sealed.has(id) && !plugs.has(id)) l.leaving = 0;
    for (const id of [...sealed, ...plugs.keys()]) {
      const old = this.lines.get(id);
      if (old) drop(old); // rebuilt: a neighbour may have opened since (or it closed again mid-wither)
      this.building = [];
      const plug = plugs.get(id);
      const root = plug ? this.buildPlug(id, plug) : this.build(id);
      this.lines.set(id, { root, fields: this.building });
    }
  }

  /** Hidden (never revealed, not sealed) areas that share a chunk edge with revealed ground. */
  private hiddenNeighbours(): Set<string> {
    const s = this.sim;
    const map = s.areas.map;
    const out = new Set<string>();
    for (const id of s.areas.revealed())
      for (const [cx, cz] of s.areas.info(id).chunks)
        for (const [dx, dz] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const a = map.areaOfChunk(cx + dx, cz + dz);
          if (a !== id && s.areas.fog(a) === 'hidden') out.add(a);
        }
    return out;
  }

  /** The hedge along each chunk edge this area shares with open ground, and the entrance on its gate. */
  private build(id: string): pc.Entity {
    const s = this.sim;
    const map = s.areas.map;
    const H = LOOK.hedgeLine;
    const root = new pc.Entity(`hedge:${id}`);
    this.root.addChild(root);
    const ground = (s.grid.layer(GROUND)?.height ?? 0) + SLAB_TOP;
    const open = (cx: number, cz: number) => {
      const a = map.areaOfChunk(cx, cz);
      return a !== id && s.areas.fog(a) !== 'hidden';
    };
    // the entrance: a sealed region's gate (a backstreet has none)
    const region = s.areas.sealed(id) ? regionById(id) : undefined;
    const cells = region && !s.gates.isOpen(region.gate.id) ? region.gate.cells.map(([x, z]) => [x + 0.5, z + 0.5] as [number, number]) : [];
    const gx = cells.reduce((t, c) => t + c[0], 0) / Math.max(1, cells.length);
    const gz = cells.reduce((t, c) => t + c[1], 0) / Math.max(1, cells.length);
    const lift = (x: number, z: number) => (s.grid.terraced(GROUND) ? levelY(levelAt(Math.floor(x), Math.floor(z))) : 0);
    const b = new FoliageBuilder();
    let anchor: [number, number, number] | undefined;
    let entrance: Entrance | undefined;
    for (const [cx, cz] of s.areas.info(id).chunks) {
      // [neighbour chunk, along-axis, edge line, inward normal]: west, east, north, south edges
      const sides: [number, number, 'x' | 'z', number, number][] = [
        [cx - 1, cz, 'z', cx * CHUNK, 1],
        [cx + 1, cz, 'z', (cx + 1) * CHUNK, -1],
        [cx, cz - 1, 'x', cz * CHUNK, 1],
        [cx, cz + 1, 'x', (cz + 1) * CHUNK, -1],
      ];
      for (const [nx, nz, along, line, inward] of sides) {
        if (!open(nx, nz)) continue;
        const start = along === 'z' ? cz * CHUNK : cx * CHUNK;
        const off = line + inward * H.inset;
        // the gate on this edge: how far along it sits and how wide it is (the hedge runs on across it, owner: the
        // forcefield stands in front of the hedge, not in a gap)
        if (cells.length && Math.abs((along === 'z' ? gx : gz) - line) < 2.5) {
          const at = along === 'z' ? gz : gx;
          if (at > start - 1 && at < start + CHUNK + 1) {
            const half = cells.reduce((m, c) => Math.max(m, Math.abs((along === 'z' ? c[1] : c[0]) - at) + 0.5), 0.5) + H.gap;
            const [ex, ez] = along === 'z' ? [off, at] : [at, off];
            entrance = { along, at, line: off, front: off - inward * H.field.front, half, y: ground + lift(ex, ez) };
          }
        }
        for (let u = 0; u < CHUNK; u++) {
          const a = start + u;
          const h = hash01(a, line, along === 'z' ? 1 : 2, 7);
          const wob = (h - 0.5) * 0.12;
          const x = along === 'z' ? off + wob : a;
          const z = along === 'z' ? a : off + wob;
          const y = ground + lift(x + (along === 'x' ? 0.5 : 0), z + (along === 'z' ? 0.5 : 0));
          anchor ??= [x, y, z];
          b.add(laidHedge(Math.floor(h * 600)), x - anchor[0], y - anchor[1] - 0.04, z - anchor[2], along === 'z' ? Math.PI / 2 : 0, H.height * (0.94 + 0.14 * hash01(a, line, 3, 5)));
        }
      }
    }
    if (anchor) {
      const mesh = b.build(this.device);
      if (mesh) {
        const e = new pc.Entity('hedge');
        e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, foliageMaterial())], castShadows: true, receiveShadows: true });
        e.setLocalPosition(anchor[0], anchor[1], anchor[2]);
        root.addChild(e);
      }
    }
    if (entrance) this.entrance(root, entrance, id);
    return root;
  }

  /** A hedge gate's plug: hedge across its cells, the forcefield on the side Bloombot comes from. */
  private buildPlug(id: string, g: GateDef): pc.Entity {
    const s = this.sim;
    const H = LOOK.hedgeLine;
    const P = g.plug!;
    const root = new pc.Entity(`hedge:${id}`);
    this.root.addChild(root);
    const ground = (s.grid.layer(GROUND)?.height ?? 0) + SLAB_TOP;
    const ax = (c: [number, number]) => (P.along === 'x' ? c[0] : c[1]);
    const cross = (c: [number, number]) => (P.along === 'x' ? c[1] : c[0]);
    const a0 = Math.min(...g.cells.map(ax));
    const a1 = Math.max(...g.cells.map(ax)) + 1;
    const line = (Math.min(...g.cells.map(cross)) + Math.max(...g.cells.map(cross)) + 1) / 2;
    const b = new FoliageBuilder();
    for (let a = a0; a < a1; a++) {
      const h = hash01(a, line, 5, 11);
      const [x, z] = P.along === 'x' ? [a, line] : [line, a];
      b.add(laidHedge(Math.floor(h * 600)), x, 0, z, P.along === 'z' ? Math.PI / 2 : 0, H.height * (0.94 + 0.14 * h));
    }
    const mesh = b.build(this.device);
    if (mesh) {
      const e = new pc.Entity('hedge');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, foliageMaterial())], castShadows: true, receiveShadows: true });
      e.setLocalPosition(0, ground - 0.04, 0);
      root.addChild(e);
    }
    const half = (a1 - a0) / 2;
    const at = (a0 + a1) / 2;
    const front = line + P.front * H.field.front;
    const fore = (v: number): [number, number] => (P.along === 'z' ? [front, v] : [v, front]);
    const [cx, cz] = fore(at - half);
    root.addChild(this.field(cx, ground, cz, P.along, half * 2, g));
    return root;
  }

  /** The way in: two big dead trees, and the locked forcefield between them. */
  private entrance(root: pc.Entity, e: Entrance, id: string) {
    const H = LOOK.hedgeLine;
    const pos = (along: number): [number, number] => (e.along === 'z' ? [e.line, along] : [along, e.line]);
    const fore = (along: number): [number, number] => (e.along === 'z' ? [e.front, along] : [along, e.front]);
    for (const side of [-1, 1]) {
      // the dead tree, just past the forcefield's end
      const [tx, tz] = pos(e.at + side * (e.half + H.tree.offset));
      const v = Math.floor(hash01(Math.round(e.at * 3), Math.round(e.line * 3), side, id.length) * 1000);
      const b = new FoliageBuilder();
      b.dry = 1;
      const scale = H.tree.scale * (0.9 + 0.2 * hash01(v, 1, 2, 3));
      b.add(giantGeo(0, v, 1), 0, 0, 0, hash01(v, 4, 5, 6) * Math.PI * 2, scale, false);
      const mesh = b.build(this.device);
      if (mesh) {
        const t = new pc.Entity('entranceTree');
        t.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, foliageMaterial())], castShadows: true, receiveShadows: true });
        t.setLocalPosition(tx, e.y - 0.05, tz);
        root.addChild(t);
      }
    }
    // the forcefield, across the way in
    const [cx, cz] = fore(e.at - e.half);
    root.addChild(this.field(cx, e.y, cz, e.along, e.half * 2, regionById(id)?.gate));
  }


  /** A see-through green wall `w` long, its wavy top and foot glowing, vines in it and a padlock on it. */
  private field(x: number, y: number, z: number, along: 'x' | 'z', w: number, gate?: GateDef): pc.Entity {
    const F = LOOK.hedgeLine.field;
    const segs = Math.max(8, Math.round(w * 6));
    const P: number[] = [];
    const U: number[] = [];
    const I: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const top = F.height + F.wave * Math.sin(t * Math.PI * 2 + 0.6) * (1 - Math.abs(t - 0.5));
      P.push(t * w, 0.02, 0, t * w, top, 0);
      U.push(t, 1, t, 0); // the canvas is drawn top-down
      if (i < segs) I.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const mesh = new pc.Mesh(this.device);
    mesh.setPositions(P);
    mesh.setNormals(P.map((_, i) => (i % 3 === 2 ? 1 : 0))); // unlit, but the shader still reads a normal
    mesh.setUvs(0, U);
    mesh.setIndices(I);
    mesh.update();
    const tex = fieldTexture(this.device, w / F.height);
    const m = new pc.StandardMaterial();
    m.useLighting = false;
    m.diffuse = new pc.Color(0, 0, 0);
    m.emissive = new pc.Color(1, 1, 1);
    m.emissiveMap = tex;
    m.emissiveIntensity = F.glow;
    m.opacityMap = tex;
    m.opacityMapChannel = 'a';
    m.opacity = F.opacity;
    m.blendType = pc.BLEND_NORMAL;
    m.depthWrite = false;
    m.cull = pc.CULLFACE_NONE;
    m.update();
    const e = new pc.Entity('forcefield');
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, m)], castShadows: false, receiveShadows: false });
    e.setLocalPosition(x, y, z);
    if (along === 'z') e.setLocalEulerAngles(0, -90, 0);
    // the fill: a brighter glow rising from the foot as the ground on Bloombot's side comes back (#hedge-line: the
    // lock's second need, a share of that ground alive), full when it's met
    const fill = new pc.Entity('fill');
    const fm = new pc.Mesh(this.device);
    fm.setPositions([0, 0.02, 0, w, 0.02, 0, 0, F.height, 0, w, F.height, 0]);
    fm.setNormals([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    fm.setIndices([0, 1, 2, 2, 1, 3]);
    fm.update();
    fill.addComponent('render', { meshInstances: [new pc.MeshInstance(fm, fillMaterial())], castShadows: false, receiveShadows: false });
    fill.setLocalScale(1, 0.001, 1);
    e.addChild(fill);
    const edge = new pc.Entity('fillEdge');
    const em = new pc.Mesh(this.device);
    em.setPositions([0, -0.03, 0, w, -0.03, 0, 0, 0.03, 0, w, 0.03, 0]);
    em.setNormals([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    em.setIndices([0, 1, 2, 2, 1, 3]);
    em.update();
    edge.addComponent('render', { meshInstances: [new pc.MeshInstance(em, fillMaterial(true))], castShadows: false, receiveShadows: false });
    edge.setLocalPosition(0, 0.02, 0);
    e.addChild(edge);
    this.building.push({ mat: m, phase: hash01(Math.round(x), Math.round(z), 9, 9) * 6, gate, fill, edge });
    return e;
  }

  /** The forcefields pulse softly; a wall whose gate opened withers back into the ground, then goes. */
  update(dt: number) {
    this.time += dt;
    const F = LOOK.hedgeLine.field;
    // the fills, twice a second: how much of each lock's ground is alive, as a share of what it needs
    this.fillWait -= dt;
    if (this.fillWait <= 0) {
      this.fillWait = 0.5;
      for (const [, l] of this.lines)
        for (const f of l.fields) {
          const need = f.gate?.needs.alive;
          const k = need ? Math.min(1, this.sim.gates.aliveShare(f.gate!) / need) : 1;
          f.fill.setLocalScale(1, Math.max(0.001, k), 1);
          f.edge.setLocalPosition(0, 0.02 + (F.height - 0.04) * k, 0);
        }
    }
    if (!this.reducedMotion)
      for (const [, l] of this.lines)
        for (const f of l.fields) {
        f.mat.emissiveIntensity = F.glow * (1 + F.pulse * Math.sin(this.time * 1.6 + f.phase));
        f.mat.update();
      }
    for (const [id, l] of this.lines) {
      if (l.leaving === undefined) continue;
      l.leaving += dt;
      const k = this.reducedMotion ? 1 : Math.min(1, l.leaving / LOOK.hedgeLine.leave);
      const e = k * k * (3 - 2 * k);
      for (const c of l.root.children) (c as pc.Entity).setLocalScale(1 - 0.25 * e, Math.max(0.001, 1 - e), 1 - 0.25 * e);
      if (k >= 1) {
        drop(l);
        this.lines.delete(id);
      }
    }
  }
}

const fillMats = new Map<boolean, pc.StandardMaterial>();
/** The forcefields' fill: a soft additive green, so the field brightens from the foot up as it fills (`edge`: its top line). */
function fillMaterial(edge = false): pc.StandardMaterial {
  const hit = fillMats.get(edge);
  if (hit) return hit;
  const F = LOOK.hedgeLine.field;
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color().fromString(PALETTE.forcefield.rim);
  m.emissiveIntensity = edge ? F.fill * 3 : F.fill;
  m.opacity = edge ? 1 : 0.7;
  m.blendType = pc.BLEND_ADDITIVEALPHA;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  fillMats.set(edge, m);
  return m;
}

/** Takes a wall down, with its forcefields' own textures and materials. */
function drop(l: Line) {
  for (const f of l.fields) {
    f.mat.emissiveMap?.destroy();
    f.mat.destroy();
  }
  l.root.destroy();
}


/**
 * The forcefield's face, drawn once per width: a green glow brighter toward the foot, faint vines woven through it, a
 * bright wavy rim along the top and foot, and a glowing padlock in the middle (kept round whatever the field's width).
 */
function fieldTexture(device: pc.GraphicsDevice, aspect: number): pc.Texture {
  const h = 256;
  const w = Math.min(2048, Math.max(256, Math.round(h * aspect)));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  const C = PALETTE.forcefield;
  // the field: a soft green glow, stronger at the foot
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hexA(C.field, 0.3));
  grad.addColorStop(0.75, hexA(C.field, 0.48));
  grad.addColorStop(1, hexA(C.field, 0.7));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // faint upright shimmer
  for (let x = 0; x < w; x += 9) {
    g.fillStyle = hexA(C.rim, 0.04 + 0.05 * Math.abs(Math.sin(x * 0.37)));
    g.fillRect(x, 0, 3, h);
  }
  // vines woven through it
  g.lineCap = 'round';
  let r = 12345;
  const R = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < Math.round(w / 40); i++) {
    g.strokeStyle = hexA(C.rim, 0.12 + R() * 0.14);
    g.lineWidth = 2 + R() * 3;
    g.beginPath();
    const x0 = R() * w;
    g.moveTo(x0, h);
    g.bezierCurveTo(x0 + (R() - 0.5) * 160, h * 0.6, x0 + (R() - 0.5) * 220, h * 0.35, x0 + (R() - 0.5) * 260, h * (0.05 + R() * 0.3));
    g.stroke();
  }
  // the rims: bright lines along the top and the foot, glowing
  g.shadowColor = C.rim;
  g.shadowBlur = 14;
  g.strokeStyle = hexA(C.rim, 0.95);
  g.lineWidth = 6;
  for (const y of [5, h - 4]) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  // the padlock
  const cx = w / 2;
  const cy = h * 0.56;
  const s = h * 0.3;
  g.strokeStyle = hexA(C.lock, 0.95);
  g.lineWidth = s * 0.16;
  g.shadowBlur = 18;
  g.beginPath();
  g.arc(cx, cy - s * 0.42, s * 0.42, Math.PI, 0);
  g.lineTo(cx + s * 0.42, cy - s * 0.1);
  g.moveTo(cx - s * 0.42, cy - s * 0.42);
  g.lineTo(cx - s * 0.42, cy - s * 0.1);
  g.stroke();
  g.lineWidth = s * 0.14;
  roundRect(g, cx - s * 0.68, cy - s * 0.1, s * 1.36, s * 1.05, s * 0.18);
  g.stroke();
  g.fillStyle = hexA(C.field, 0.35);
  g.fill();
  g.fillStyle = hexA(C.lock, 0.95);
  g.beginPath();
  g.arc(cx, cy + s * 0.32, s * 0.14, 0, Math.PI * 2);
  g.fill();
  g.fillRect(cx - s * 0.06, cy + s * 0.35, s * 0.12, s * 0.32);
  const tex = new pc.Texture(device, { width: w, height: h, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
  tex.setSource(cv);
  return tex;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
