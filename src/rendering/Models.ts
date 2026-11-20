import * as pc from 'playcanvas';
import { SOLID_SINK, type GeoBounds } from '../core/Solids';
import { MODEL_NAMES } from '../data/oldcity';

/**
 * Look 3.18/3.19: the hand-built models (assets/raw/models/final, built by assets/tools/build_props.py). Each model
 * has a near version (`<name>.glb`) and a far one (`<name>.lod1.glb`), in metres (1 tile = 1 m), pivot at the base
 * centre, front = +Z. Their materials keep the baked albedo and normal atlas (no palette swap).
 *
 * Two ways to draw them:
 * - `ModelBatch`: many copies in one chunk, hardware-instanced. A model's parts differ only in gloss and
 *   metalness (one per palette material, all on the model's one atlas), so for batches they are merged into a
 *   single mesh with gloss and metalness stored per vertex: one draw per model and chunk, not one per part;
 * - `ModelLibrary.instantiate`: one entity, for landmarks, machines and the cat (moving parts stay their own nodes).
 * Until a model has loaded (or with `?models=classic`), callers keep their procedural look.
 */
/**
 * Every file here is fetched before the loading screen ends, so only what the game draws lives in `final`. Models made
 * but not drawn yet wait in assets/raw/models/pending (committed, never fetched) until their system wires them in:
 * move the file here and add its MACHINE_MODELS entry in the same change. The Keepers are left out: KeeperVisuals
 * loads each one's own rigged file when that Keeper is first shown (and only the near version), so they are not
 * fetched twice.
 */
const URLS = import.meta.glob(['../../assets/raw/models/final/*.glb', '!../../assets/raw/models/final/keeper-*.glb'], { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export const useModels = () => typeof location === 'undefined' || new URLSearchParams(location.search).get('models') !== 'classic';

/** One drawable piece of a model: a mesh with its material and its transform within the model. */
export interface ModelPart {
  mesh: pc.Mesh;
  material: pc.Material;
  local: pc.Mat4;
  node: string;
}

interface Loaded {
  near?: pc.ContainerResource;
  far?: pc.ContainerResource;
  parts: [ModelPart[], ModelPart[]];
  /** the parts merged for batches (near, far), made on first use */
  merged: [ModelPart[] | undefined, ModelPart[] | undefined];
  /** E20.6: the same, with neglected materials (near, far) */
  neglected?: [ModelPart[] | undefined, ModelPart[] | undefined];
}

/** A material is plain when only its gloss and metalness set it apart from the model's other parts. */
function plain(m: pc.Material): m is pc.StandardMaterial {
  if (!(m instanceof pc.StandardMaterial)) return false;
  const white = m.diffuse.r > 0.999 && m.diffuse.g > 0.999 && m.diffuse.b > 0.999;
  const dark = m.emissive.r + m.emissive.g + m.emissive.b < 0.001;
  return white && dark && !m.emissiveMap && !m.glossMap && !m.metalnessMap && m.opacity >= 1 && m.useMetalness;
}

const IDENTITY = new pc.Mat4();
/** Which image a map is (empty = none). A model's materials may each hold their own texture object of one image. */
function texId(t: pc.Texture | null | undefined): string {
  return t ? `${t.name}:${t.width}x${t.height}` : '';
}

/**
 * Merges a model's plain parts that share their maps into one mesh (positions and normals moved into model space,
 * gloss in the vertex colour's red, metalness in its green) with one material. Parts that glow, are tinted, or have
 * an unexpected vertex layout stay as they are.
 */
function mergeParts(device: pc.GraphicsDevice, parts: ModelPart[]): ModelPart[] {
  const out: ModelPart[] = [];
  const groups = new Map<string, ModelPart[]>();
  for (const part of parts) {
    const m = part.material;
    const vb = part.mesh.vertexBuffer;
    const els = vb?.format.elements ?? [];
    const float = (name: string, n: number) => els.some((e) => e.name === name && e.numComponents === n && e.dataType === pc.TYPE_FLOAT32);
    const ok = plain(m) && !!vb?.storage && float(pc.SEMANTIC_POSITION, 3) && float(pc.SEMANTIC_NORMAL, 3) && float(pc.SEMANTIC_TEXCOORD0, 2) && part.mesh.primitive[0]?.type === pc.PRIMITIVE_TRIANGLES;
    if (!ok) {
      out.push(part);
      continue;
    }
    const sm = m as pc.StandardMaterial;
    const key = `${texId(sm.diffuseMap)}|${texId(sm.normalMap)}|${texId(sm.aoMap)}|${texId(sm.opacityMap)}|${sm.alphaTest}|${sm.cull}|${sm.blendType}|${sm.bumpiness}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(part);
  }
  const v = new pc.Vec3();
  for (const g of groups.values()) {
    if (g.length < 2) {
      out.push(...g);
      continue;
    }
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (const part of g) {
      const vb = part.mesh.vertexBuffer;
      const f32 = new Float32Array(vb.storage);
      const at = (name: string) => {
        const e = vb.format.elements.find((x) => x.name === name)!;
        return { off: e.offset / 4, stride: e.stride / 4 };
      };
      const P = at(pc.SEMANTIC_POSITION);
      const N = at(pc.SEMANTIC_NORMAL);
      const T = at(pc.SEMANTIC_TEXCOORD0);
      const m = part.material as pc.StandardMaterial;
      const gloss = Math.round(pc.math.clamp(m.gloss, 0, 1) * 255);
      const metal = Math.round(pc.math.clamp(m.metalness, 0, 1) * 255);
      const base = pos.length / 3;
      for (let i = 0; i < vb.numVertices; i++) {
        v.set(f32[i * P.stride + P.off], f32[i * P.stride + P.off + 1], f32[i * P.stride + P.off + 2]);
        part.local.transformPoint(v, v);
        pos.push(v.x, v.y, v.z);
        v.set(f32[i * N.stride + N.off], f32[i * N.stride + N.off + 1], f32[i * N.stride + N.off + 2]);
        part.local.transformVector(v, v).normalize();
        nrm.push(v.x, v.y, v.z);
        uv.push(f32[i * T.stride + T.off], f32[i * T.stride + T.off + 1]);
        col.push(gloss, metal, 0, 255);
      }
      const prim = part.mesh.primitive[0];
      const ib = part.mesh.indexBuffer[0];
      const src = ib && prim.indexed ? (ib.format === pc.INDEXFORMAT_UINT32 ? new Uint32Array(ib.storage) : ib.format === pc.INDEXFORMAT_UINT16 ? new Uint16Array(ib.storage) : new Uint8Array(ib.storage)) : undefined;
      for (let i = prim.base; i < prim.base + prim.count; i++) idx.push(base + (src ? src[i] + (prim.baseVertex ?? 0) : i));
    }
    const mesh = new pc.Mesh(device);
    mesh.setPositions(pos);
    mesh.setNormals(nrm);
    mesh.setUvs(0, uv);
    mesh.setColors32(col);
    mesh.setIndices(idx);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    mesh.incRefCount(); // owned by the library: chunks come and go, the merged mesh stays
    const material = (g[0].material as pc.StandardMaterial).clone();
    material.name = `${g[0].material.name}+merged`;
    material.diffuseVertexColor = false; // the vertex colour now carries gloss and metalness, not a tint
    material.gloss = 1;
    material.metalness = 1;
    material.glossVertexColor = true;
    material.glossVertexColorChannel = 'r';
    material.metalnessVertexColor = true;
    material.metalnessVertexColorChannel = 'g';
    material.update();
    out.push({ mesh, material, local: IDENTITY, node: g[0].node });
  }
  return out;
}

const MAP_SLOTS = ['diffuseMap', 'normalMap', 'aoMap', 'emissiveMap', 'glossMap', 'metalnessMap', 'opacityMap', 'specularMap'] as const;

/**
 * City 15.4: a model's materials all sample one atlas, but the loader gives each material its own copy of it on the
 * GPU (the pollinator garden held 14 copies of two 1024² images). Points every material at the first copy of each
 * image and frees the rest: across the model set that was about 700 MB of video memory.
 */
function shareTextures(container: pc.ContainerResource) {
  const kept = new Map<string, pc.Texture>();
  const spare = new Set<pc.Texture>();
  for (const asset of container.materials ?? []) {
    const m = asset.resource as pc.StandardMaterial | undefined;
    if (!m) continue;
    let changed = false;
    for (const slot of MAP_SLOTS) {
      const t = m[slot];
      if (!t) continue;
      const key = `${texId(t)}|${t.format}|${t.addressU}|${t.addressV}|${t.minFilter}|${t.magFilter}|${t.mipmaps}`;
      const first = kept.get(key);
      if (!first) kept.set(key, t);
      else if (first !== t) {
        m[slot] = first;
        spare.add(t);
        changed = true;
      }
    }
    if (changed) m.update();
  }
  for (const t of kept.values()) spare.delete(t);
  for (const t of spare) t.destroy();
}

function partsOf(container: pc.ContainerResource): ModelPart[] {
  const root = container.instantiateRenderEntity();
  root.syncHierarchy();
  const out: ModelPart[] = [];
  const walk = (e: pc.Entity) => {
    if (e.render)
      for (const mi of e.render.meshInstances) if (mi.mesh && mi.material) out.push({ mesh: mi.mesh, material: mi.material, local: e.getWorldTransform().clone(), node: e.name });
    for (const c of e.children) walk(c as pc.Entity);
  };
  walk(root);
  // The meshes and materials belong to the container; the throwaway entity can go.
  root.destroy();
  return out;
}

export class ModelLibrary {
  private models = new Map<string, Loaded>();
  /** every model that finished loading (near version at least) */
  readonly loaded = new Set<string>();
  /** called once, when every model has loaded or failed */
  onReady?: () => void;
  ready = false;

  constructor(private app: pc.AppBase) {}

  /** Names of all models on disk. */
  static names(): string[] {
    return Object.keys(URLS)
      .map((k) => k.split('/').pop()!.replace(/\.glb$/, ''))
      .filter((n) => !n.endsWith('.lod1'))
      .sort();
  }

  load() {
    if (!useModels()) return;
    const files = Object.entries(URLS);
    let pending = files.length;
    const done = () => {
      if (--pending > 0) return;
      this.ready = true;
      this.onReady?.();
    };
    for (const [path, url] of files) {
      const file = path.split('/').pop()!.replace(/\.glb$/, '');
      const far = file.endsWith('.lod1');
      const name = far ? file.slice(0, -5) : file;
      this.app.assets.loadFromUrl(url, 'container', (err, asset) => {
        if (err || !asset) console.warn(`Model ${file} failed to load; keeping the procedural look.`, err);
        else {
          const m: Loaded = this.models.get(name) ?? { parts: [[], []], merged: [undefined, undefined] };
          const res = asset.resource as pc.ContainerResource;
          shareTextures(res);
          if (far) {
            m.far = res;
            m.parts[1] = partsOf(res);
          } else {
            m.near = res;
            m.parts[0] = partsOf(res);
            this.loaded.add(name);
          }
          this.models.set(name, m);
        }
        done();
      });
    }
  }

  has(name: string): boolean {
    return this.loaded.has(name);
  }

  private boundsCache = new Map<string, GeoBounds>();
  /**
   * E23.12.3: a loaded model's extent about its pivot (metres, unscaled): the furthest it reaches from its vertical
   * axis and its height range, from its parts' bounds in the model. Undefined until loaded.
   */
  bounds(name: string): GeoBounds | undefined {
    const hit = this.boundsCache.get(name);
    if (hit) return hit;
    const parts = this.parts(name);
    if (!parts.length) return undefined;
    const box = new pc.BoundingBox();
    let first = true;
    const tmp = new pc.BoundingBox();
    for (const part of parts) {
      tmp.setFromTransformedAabb(part.mesh.aabb, part.local);
      if (first) box.copy(tmp);
      else box.add(tmp);
      first = false;
    }
    const lo = box.getMin();
    const hi = box.getMax();
    const b: GeoBounds = { r: Math.max(Math.hypot(lo.x, lo.z), Math.hypot(hi.x, hi.z), Math.hypot(lo.x, hi.z), Math.hypot(hi.x, lo.z)), y0: lo.y, y1: hi.y };
    this.boundsCache.set(name, b);
    return b;
  }

  /** The parts to draw (far = the LOD1 version, falling back to the near one). */
  parts(name: string, far = false): ModelPart[] {
    const m = this.models.get(name);
    if (!m) return [];
    return far && m.parts[1].length ? m.parts[1] : m.parts[0];
  }

  /** The parts to draw many copies with: `parts`, with those that differ only in gloss and metalness merged into one. */
  batchParts(name: string, far = false, neglected = false): ModelPart[] {
    const m = this.models.get(name);
    if (!m) return [];
    const i = far && m.parts[1].length ? 1 : 0;
    const merged = (m.merged[i] ??= mergeParts(this.app.graphicsDevice, m.parts[i]));
    if (!neglected) return merged;
    m.neglected ??= [undefined, undefined];
    return (m.neglected[i] ??= merged.map((p) => ({ ...p, material: neglectedMaterial(p.material) })));
  }

  /**
   * A model's triangles in model space (near version), each with its palette key (the `pal_<key>` material it
   * uses): for code that bakes models into its own mesh, like the skyline. Empty until loaded.
   */
  triangles(name: string): { pos: number[]; keys: string[] } {
    const pos: number[] = [];
    const keys: string[] = [];
    const v = new pc.Vec3();
    for (const part of this.parts(name)) {
      const vb = part.mesh.vertexBuffer;
      const ib = part.mesh.indexBuffer[0];
      const prim = part.mesh.primitive[0];
      const el = vb?.format.elements.find((e) => e.name === pc.SEMANTIC_POSITION);
      if (!vb || !el || !prim) continue;
      const f32 = new Float32Array(vb.storage);
      const stride = el.stride / 4;
      const off = el.offset / 4;
      const idx = ib ? (ib.format === pc.INDEXFORMAT_UINT32 ? new Uint32Array(ib.storage) : new Uint16Array(ib.storage)) : undefined;
      const key = part.material.name.replace(/^pal_/, '').replace(/\.\d+$/, '');
      for (let i = prim.base; i + 2 < prim.base + prim.count; i += 3) {
        for (let k = 0; k < 3; k++) {
          const j = idx ? idx[i + k] : i + k;
          v.set(f32[j * stride + off], f32[j * stride + off + 1], f32[j * stride + off + 2]);
          part.local.transformPoint(v, v);
          pos.push(v.x, v.y, v.z);
        }
        keys.push(key);
      }
    }
    return { pos, keys };
  }

  /** A fresh entity of the whole model (moving parts are child entities, found by name). */
  instantiate(name: string, far = false, shadows = true): pc.Entity | undefined {
    const m = this.models.get(name);
    const res = far && m?.far ? m.far : m?.near;
    if (!res) return undefined;
    const e = res.instantiateRenderEntity({ castShadows: shadows, receiveShadows: true });
    e.name = `model-${name}`;
    return e;
  }

  /**
   * City 15.4: a fresh entity of the model with its plain parts merged (see `batchParts`): one or two draw calls
   * instead of one per palette material (up to 14). For models that are placed whole (machines, landmarks); models
   * with moving parts found by name use `instantiate`.
   */
  instantiateMerged(name: string, shadows = true): pc.Entity | undefined {
    const parts = this.batchParts(name);
    if (!parts.length) return undefined;
    const e = new pc.Entity(`model-${name}`);
    const q = new pc.Quat();
    for (const part of parts) {
      const c = new pc.Entity(part.node);
      c.addComponent('render', { meshInstances: [new pc.MeshInstance(part.mesh, part.material)], castShadows: shadows, receiveShadows: true });
      if (part.local !== IDENTITY) {
        c.setLocalPosition(part.local.getTranslation());
        c.setLocalRotation(q.setFromMat4(part.local));
        c.setLocalScale(part.local.getScale());
      }
      e.addChild(c);
    }
    return e;
  }
}

/** Shared library (one per app); `null` until the game creates it. */
/**
 * E20.6 (#289): the neglected look of a prop model before its area is woken: the same mesh and atlas, darkened
 * toward a dusty warm grey, matte, and with no glow (lamps unlit). Cached per material, shared by every chunk.
 */
export const NEGLECT = { tint: [0.62, 0.58, 0.53] as const, gloss: 0.55 };
const neglectCache = new Map<pc.Material, pc.Material>();
function neglectedMaterial(src: pc.Material): pc.Material {
  let m = neglectCache.get(src);
  if (m) return m;
  const s = (src as pc.StandardMaterial).clone();
  s.name = `${src.name}+neglected`;
  s.diffuse = new pc.Color(s.diffuse.r * NEGLECT.tint[0], s.diffuse.g * NEGLECT.tint[1], s.diffuse.b * NEGLECT.tint[2]);
  if (!s.glossVertexColor) s.gloss *= NEGLECT.gloss;
  s.emissive = new pc.Color(0, 0, 0);
  s.emissiveMap = null;
  s.emissiveIntensity = 0;
  s.update();
  neglectCache.set(src, (m = s));
  return m;
}

export let MODELS: ModelLibrary | null = null;

/**
 * E21: the model to draw for an Old City name (data/oldcity MODEL_NAMES): the file itself once it has landed in
 * assets/raw/models/final, else its marked stand-in. undefined: draw the procedural stand-in.
 */
export function oldCityModel(name: string): string | undefined {
  if (MODELS?.has(name)) return name;
  const s = MODEL_NAMES[name]?.standIn;
  return s && s !== 'procedural' && MODELS?.has(s) ? s : undefined;
}
export function createModels(app: pc.AppBase): ModelLibrary {
  MODELS = new ModelLibrary(app);
  MODELS.load();
  return MODELS;
}

const tmp = new pc.Mat4();
const place = new pc.Mat4();
const q = new pc.Quat();
const pos = new pc.Vec3();
const scl = new pc.Vec3();

/**
 * Copies of models in one chunk, drawn with hardware instancing. Add placements while the chunk is built, then
 * `build()` makes one entity holding one instanced mesh instance per model (its parts merged; see `batchParts`).
 */
export class ModelBatch {
  private placed = new Map<string, number[]>();
  count = 0;

  constructor(
    private lib: ModelLibrary,
    private far: boolean,
  ) {}

  /** A copy at (x, y, z), turned rotY radians about +y, scaled (sx, sy, sz). E20.6: `neglected` draws its dusty look. */
  add(name: string, x: number, y: number, z: number, rotY: number, sx: number, sy = sx, sz = sx, neglected = false): boolean {
    if (!this.lib.has(name)) return false;
    // E23.12.3: the model as placed, at its loaded size, for the CPU line of sight
    if (SOLID_SINK.current) {
      const b = this.lib.bounds(name);
      if (b) SOLID_SINK.current.model(b, x, y, z, sx, sy, sz);
    }
    const key = neglected ? `${name}|neglected` : name;
    let list = this.placed.get(key);
    if (!list) this.placed.set(key, (list = []));
    q.setFromAxisAngle(pc.Vec3.UP, (rotY * 180) / Math.PI);
    place.setTRS(pos.set(x, y, z), q, scl.set(sx, sy, sz));
    for (let i = 0; i < 16; i++) list.push(place.data[i]);
    this.count++;
    return true;
  }

  /** The chunk's model entity (or undefined when nothing was placed). `bounds` culls the whole batch. */
  build(device: pc.GraphicsDevice, bounds: pc.BoundingBox, shadows: boolean): { entity?: pc.Entity; buffers: pc.VertexBuffer[]; tris: number } {
    const buffers: pc.VertexBuffer[] = [];
    if (!this.count) return { buffers, tris: 0 };
    const fmt = pc.VertexFormat.getDefaultInstancingFormat(device);
    const mis: pc.MeshInstance[] = [];
    let tris = 0;
    for (const [key, list] of this.placed) {
      const n = list.length / 16;
      const [name, neglected] = key.split('|');
      for (const part of this.lib.batchParts(name, this.far, !!neglected)) {
        // each copy's matrix = placement × the part's own transform in the model
        const data = new Float32Array(list.length);
        for (let k = 0; k < n; k++) {
          for (let i = 0; i < 16; i++) place.data[i] = list[k * 16 + i];
          tmp.mul2(place, part.local);
          data.set(tmp.data, k * 16);
        }
        const vb = new pc.VertexBuffer(device, fmt, n, { data });
        buffers.push(vb);
        const mi = new pc.MeshInstance(part.mesh, part.material);
        mi.setInstancing(vb);
        mi.instancingCount = n;
        mi.setCustomAabb(bounds);
        mis.push(mi);
        const prim = part.mesh.primitive[0];
        tris += (prim ? prim.count / 3 : 0) * n;
      }
    }
    const entity = new pc.Entity('models');
    entity.addComponent('render', { meshInstances: mis, castShadows: shadows, receiveShadows: true });
    return { entity, buffers, tris };
  }
}
