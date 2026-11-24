import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { SLAB_TOP } from './SceneBuilder';
import { NEON } from './Vfx';
import { PALETTE } from './Palette';

interface Flash {
  e: pc.Entity;
  m: pc.StandardMaterial;
  life: number;
  max: number;
  peak: number;
  active: boolean;
  hold: boolean; // stays until released (chain origin marker)
  /** Look 3.14: a restore target. Glows, breathing gently, while its tile grows; may be stolen if the pool runs dry. */
  target: boolean;
  key?: string;
}

const hex = (h: string) => {
  const c = new pc.Color();
  c.fromString(h);
  return c;
};

function additive(color: string, opacity: number): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = hex(color);
  m.emissiveIntensity = LOOK.emissive.tile; // Look 1.9: restore-tile glows reach the bloom range
  m.opacity = opacity;
  m.blendType = pc.BLEND_NORMAL; // normal blend: tints without blowing light tiles out to white
  m.depthWrite = false;
  m.useFog = false;
  m.update();
  return m;
}

/** Glow strength of the tile outlines (kept below 2: the bloom pass multiplies glows of 1 and more). */
export const GLOW_INTENSITY = 1.5;

/**
 * Look 3.14: the material for a glowing tile outline (see `glowTileMesh`). Unlit; the mesh's vertex colours
 * shade it (rgb = brightness, alpha = opacity), and `opacity` fades the whole thing. Create once and reuse.
 */
export function glowMaterial(color: string, intensity = GLOW_INTENSITY): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = hex(color);
  m.emissiveIntensity = intensity;
  m.emissiveVertexColor = true;
  m.emissiveVertexColorChannel = 'rgb';
  m.opacityVertexColor = true;
  m.opacityVertexColorChannel = 'a';
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.useFog = false;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

const glowMeshes = new WeakMap<pc.GraphicsDevice, Map<number | string, pc.Mesh>>();

/**
 * Look 3.14: a glowing tile square (as in docs/reference/target-look.png), flat at y=0 and centred: a thin bright
 * line set just inside the tile's edge, a soft halo either side of it and a faint inner fill. `size` is the
 * footprint in tiles; the line keeps the same width at every size. Shared and cached per device and size.
 */
export function glowTileMesh(device: pc.GraphicsDevice, size = 1, width = 1): pc.Mesh {
  let bySize = glowMeshes.get(device);
  if (!bySize) glowMeshes.set(device, (bySize = new Map()));
  const key = width === 1 ? size : `${size}|${width}`;
  let mesh = bySize.get(key);
  if (mesh) return mesh;
  const h = size / 2;
  const w = width; // E23.3.4: the Power view draws its frames thinner (the machines carry the outline)
  // Concentric squares from the outside in: [half size, alpha, brightness].
  const rings: [number, number, number][][] = [
    [[h - 0.0, 0, 0.5], [h - 0.045 * w, 0.6, 0.55]], // outer halo (deeper green, so the line reads on pale paving)
    [[h - 0.045 * w, 1, 1], [h - 0.083 * w, 1, 1]], // the line
    [[h - 0.083 * w, 0.6, 0.55], [h - 0.24 * w, 0.2, 0.5]], // inner glow
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const vert = (s: number, cx: number, cz: number, a: number, b: number) => {
    pos.push(cx * s, 0, cz * s);
    nrm.push(0, 1, 0);
    const v = Math.round(b * 255);
    col.push(v, v, v, Math.round(a * 255));
  };
  for (const [[so, ao, bo], [si, ai, bi]] of rings) {
    const base = pos.length / 3;
    for (const [cx, cz] of corners) vert(so, cx, cz, ao, bo);
    for (const [cx, cz] of corners) vert(si, cx, cz, ai, bi);
    for (let k = 0; k < 4; k++) {
      const a = base + k;
      const b = base + ((k + 1) % 4);
      const c = base + 4 + ((k + 1) % 4);
      const d = base + 4 + k;
      idx.push(a, c, b, a, d, c);
    }
  }
  // Inner fill.
  const inner = rings[2][1];
  const base = pos.length / 3;
  for (const [cx, cz] of corners) vert(inner[0], cx, cz, inner[1], inner[2]);
  idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  mesh = new pc.Mesh(device);
  mesh.setPositions(pos);
  mesh.setNormals(nrm);
  mesh.setColors32(col);
  mesh.setIndices(idx);
  mesh.update();
  mesh.incRefCount(); // shared by pooled entities; never let the engine free it
  bySize.set(key, mesh);
  return mesh;
}

/**
 * Tile-level feedback layered just above the slabs:
 * - a restrained glow on boosted tiles (one merged mesh, rebuilt only when the set changes)
 * - pooled glowing tile outlines for chain waves, neighbour highlights, restore targets and the chain-origin marker
 */
export class TileFx {
  private root: pc.Entity;
  private glow: pc.Entity;
  private glowMat: pc.StandardMaterial;
  private glowKey = '';
  private flashes: Flash[] = [];
  private quad: pc.Mesh;
  private tileMesh: pc.Mesh;
  private time = 0;
  private recheck = 0;
  reducedMotion = false;

  constructor(
    private sim: Sim,
    parent: pc.Entity,
    private device: pc.GraphicsDevice,
  ) {
    this.root = new pc.Entity('tileFx');
    parent.addChild(this.root);
    this.quad = this.quadMesh([[0, 0]], 0.94);
    this.quad.incRefCount();
    this.tileMesh = glowTileMesh(device);
    this.glowMat = additive(PALETTE.glow.amber, 0.16);
    this.glow = new pc.Entity('glow');
    this.root.addChild(this.glow);
    for (let i = 0; i < 64; i++) {
      const m = glowMaterial(PALETTE.pure.white);
      m.opacity = 0;
      const e = new pc.Entity('flash');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(this.tileMesh, m)], castShadows: false, receiveShadows: false });
      e.enabled = false;
      this.root.addChild(e);
      this.flashes.push({ e, m, life: 0, max: 1, peak: 0.5, active: false, hold: false, target: false });
    }
    // Look 3.14: restore targets glow green while they grow and pop brighter as they finish.
    sim.bus.on('tile.restoring', ({ tile }) => this.target(tile));
    sim.bus.on('tile.restored', ({ tile }) => this.landed(tile));
  }

  /** Flat quads (one per offset) at y=0, each `size` wide, centred on the offsets. */
  private quadMesh(cells: [number, number][], size: number): pc.Mesh {
    const pos: number[] = [];
    const nrm: number[] = [];
    const idx: number[] = [];
    const h = size / 2;
    cells.forEach(([cx, cz], i) => {
      pos.push(cx - h, 0, cz - h, cx + h, 0, cz - h, cx + h, 0, cz + h, cx - h, 0, cz + h);
      nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      const b = i * 4;
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    });
    const mesh = new pc.Mesh(this.device);
    mesh.setPositions(pos);
    mesh.setNormals(nrm);
    mesh.setIndices(idx);
    mesh.update();
    return mesh;
  }

  private tilePos(t: TileData): pc.Vec3 {
    const [x, y, z] = this.sim.grid.tileWorld(t);
    return new pc.Vec3(x, y + SLAB_TOP + 0.02, z);
  }

  /** Tiles currently "boosted" by a synergy: inside a pollinator zone, or next to a boosted solar panel. */
  boostedTiles(): TileData[] {
    const s = this.sim;
    const out: TileData[] = [];
    const now = s.time;
    const boostedSolar = s.state.machines.filter((m) => m.type === 'solar' && m.boostUntil > now);
    for (const r of s.grid.rooftops) {
      if (!r.unlocked || r.preview) continue;
      for (const t of s.grid.tilesOf(r.id)) {
        if (t.ground !== 'restored' || t.occupantId) continue;
        if (s.production.inPollinatorZone(t)) out.push(t);
        else if (boostedSolar.some((m) => m.roofId === t.roofId && Math.abs(t.x - m.x) + Math.abs(t.z - m.z) === 1)) out.push(t);
      }
    }
    return out;
  }

  private rebuildGlow() {
    const tiles = this.boostedTiles();
    const key = tiles.map((t) => t.id).join(',');
    if (key === this.glowKey) return;
    this.glowKey = key;
    if (this.glow.render) this.glow.removeComponent('render');
    if (!tiles.length) return;
    const p0 = this.tilePos(tiles[0]);
    const cells = tiles.map((t) => {
      const p = this.tilePos(t);
      return [p.x - p0.x, p.z - p0.z] as [number, number];
    });
    this.glow.setPosition(p0.x, p0.y, p0.z);
    this.glow.addComponent('render', { meshInstances: [new pc.MeshInstance(this.quadMesh(cells, 0.86), this.glowMat)], castShadows: false, receiveShadows: false });
  }

  private take(): Flash {
    return this.flashes.find((f) => !f.active) ?? this.flashes.find((f) => !f.hold && !f.target) ?? this.flashes.find((f) => !f.hold) ?? this.flashes[0];
  }

  private place(f: Flash, t: TileData, color: string, lift: number) {
    f.m.emissive = hex(color);
    f.m.opacity = 0;
    f.m.update();
    const p = this.tilePos(t);
    f.e.setPosition(p.x, p.y + lift, p.z);
    f.e.enabled = true;
  }

  /** Brief glowing outline on a tile (chain wave, neighbour softening). */
  flash(t: TileData, color: string, peak = 0.55, dur = 0.6, delay = 0) {
    const f = this.take();
    f.active = true;
    f.hold = false;
    f.target = false;
    f.key = undefined;
    f.life = -delay;
    f.max = this.reducedMotion ? Math.min(dur, 0.35) : dur;
    f.peak = Math.min(1, peak * 1.4); // outlines are mostly transparent, so they can run brighter than the old flat flash
    this.place(f, t, color, 0.005);
  }

  private objectiveFrames = new Map<string, pc.Entity>();
  private objectiveMaterial?: pc.StandardMaterial;

  /** Steady, separate from the transient pulse and chain effects pool. */
  showObjectiveTiles(tiles: readonly TileData[]) {
    const active = new Set(tiles.map(tile => tile.id));
    for (const [id, frame] of this.objectiveFrames) {
      if (active.has(id)) continue;
      frame.destroy();
      this.objectiveFrames.delete(id);
    }
    for (const tile of tiles) {
      if (this.objectiveFrames.has(tile.id)) continue;
      if (!this.objectiveMaterial) {
        this.objectiveMaterial = glowMaterial('#ffce65', 1.35);
        this.objectiveMaterial.opacity = 0.74;
        this.objectiveMaterial.update();
      }
      const frame = new pc.Entity('objective-tile');
      frame.addComponent('render', {
        meshInstances: [new pc.MeshInstance(glowTileMesh(this.device, 1, 0.48), this.objectiveMaterial)],
        castShadows: false, receiveShadows: false,
      });
      const p = this.tilePos(tile);
      frame.setPosition(p.x, p.y + 0.016, p.z);
      this.root.addChild(frame);
      this.objectiveFrames.set(tile.id, frame);
    }
  }

  /** Persistent gold outline on the tile that started a chain, until released. */
  hold(key: string, t: TileData, color = PALETTE.trim.amber) {
    const f = this.take();
    f.active = true;
    f.hold = true;
    f.target = false;
    f.key = key;
    f.life = 0;
    f.max = 1;
    f.peak = 0.9;
    this.place(f, t, color, 0.01);
  }

  release(key: string) {
    for (const f of this.flashes)
      if (f.hold && f.key === key) {
        f.hold = false;
        f.life = f.max * 0.5; // fade out from the peak
      }
  }

  /** Look 3.14: a restore target. Glows neon green while the tile grows (until `landed`, or a safety timeout). */
  target(t: TileData) {
    const key = `grow:${t.id}`;
    const f = this.flashes.find((x) => x.target && x.key === key) ?? this.take();
    f.active = true;
    f.hold = false;
    f.target = true;
    f.key = key;
    f.life = 0;
    f.max = Math.max(0.6, (t.growthRemainingSec ?? 0) + 2); // timeout only; `landed` normally ends it
    f.peak = 0.8;
    this.place(f, t, NEON, 0.008);
  }

  /** The target's tile finished: one bright pop, then the outline fades. */
  private landed(t: TileData) {
    const key = `grow:${t.id}`;
    let f = this.flashes.find((x) => x.target && x.key === key);
    if (!f) {
      f = this.take();
      this.place(f, t, NEON, 0.008);
    }
    f.active = true;
    f.target = false;
    f.hold = false;
    f.key = undefined;
    f.max = this.reducedMotion ? 0.4 : 0.7;
    f.life = f.max * 0.12; // start near the peak (the rise was the growing glow)
    f.peak = 1;
  }

  update(dt: number) {
    this.time += dt;
    this.recheck -= dt;
    if (this.recheck <= 0) {
      this.recheck = 0.25;
      this.rebuildGlow();
    }
    this.glowMat.opacity = this.reducedMotion ? 0.14 : 0.1 + 0.1 * (0.5 + 0.5 * Math.sin(this.time * 2.2));
    this.glowMat.update();
    for (const f of this.flashes) {
      if (!f.active) continue;
      if (f.hold) {
        f.m.opacity = this.reducedMotion ? 0.8 : 0.6 + 0.3 * Math.sin(this.time * 6);
        f.m.update();
        continue;
      }
      f.life += dt;
      if (f.life < 0) continue;
      if (f.target) {
        if (f.life >= f.max) {
          f.active = f.target = false;
          f.e.enabled = false;
          continue;
        }
        // Fade in over 0.15 s, then breathe while the tile grows.
        const rise = Math.min(1, f.life / 0.15);
        const breathe = this.reducedMotion ? 0.85 : 0.75 + 0.25 * Math.sin(this.time * 5 + f.e.getPosition().x);
        f.m.opacity = f.peak * rise * breathe;
        f.m.update();
        continue;
      }
      const k = f.life / f.max;
      if (k >= 1) {
        f.active = false;
        f.e.enabled = false;
        continue;
      }
      // quick rise, slower fall
      f.m.opacity = f.peak * (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8);
      f.m.update();
    }
  }
}
