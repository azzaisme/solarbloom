import * as pc from 'playcanvas';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { SLAB_TOP } from './SceneBuilder';
import { PALETTE } from './Palette';

interface Flash {
  e: pc.Entity;
  m: pc.StandardMaterial;
  life: number;
  max: number;
  peak: number;
  active: boolean;
  hold: boolean; // stays until released (chain origin marker)
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
  m.opacity = opacity;
  m.blendType = pc.BLEND_NORMAL; // normal blend: tints without blowing light tiles out to white
  m.depthWrite = false;
  m.useFog = false;
  m.update();
  return m;
}

/**
 * Tile-level feedback layered just above the slabs:
 * - a restrained glow on boosted tiles (one merged mesh, rebuilt only when the set changes)
 * - pooled flashes for chain waves, neighbour highlights and the chain-origin marker
 */
export class TileFx {
  private root: pc.Entity;
  private glow: pc.Entity;
  private glowMat: pc.StandardMaterial;
  private glowKey = '';
  private flashes: Flash[] = [];
  private quad: pc.Mesh;
  private frameMesh: pc.Mesh;
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
    this.frameMesh = this.frameMeshBuild();
    this.quad.incRefCount(); // shared by pooled flashes; never let the engine free it
    this.frameMesh.incRefCount();
    this.glowMat = additive(PALETTE.glow.amber, 0.16);
    this.glow = new pc.Entity('glow');
    this.root.addChild(this.glow);
    for (let i = 0; i < 48; i++) {
      const m = additive(PALETTE.pure.white, 0);
      const e = new pc.Entity('flash');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(this.quad, m)], castShadows: false, receiveShadows: false });
      e.enabled = false;
      this.root.addChild(e);
      this.flashes.push({ e, m, life: 0, max: 1, peak: 0.5, active: false, hold: false });
    }
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

  /** A square outline (4 thin quads) for the chain-origin marker. */
  private frameMeshBuild(): pc.Mesh {
    const pos: number[] = [];
    const nrm: number[] = [];
    const idx: number[] = [];
    const o = 0.5;
    const t = 0.07;
    const rects = [
      [-o, -o, o, -o + t],
      [-o, o - t, o, o],
      [-o, -o, -o + t, o],
      [o - t, -o, o, o],
    ];
    rects.forEach(([x0, z0, x1, z1], i) => {
      pos.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
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
    return this.flashes.find((f) => !f.active) ?? this.flashes.find((f) => !f.hold) ?? this.flashes[0];
  }

  /** Brief highlight on a tile (chain wave, neighbour softening). */
  flash(t: TileData, color: string, peak = 0.55, dur = 0.6, delay = 0) {
    const f = this.take();
    f.active = true;
    f.hold = false;
    f.key = undefined;
    f.life = -delay;
    f.max = this.reducedMotion ? Math.min(dur, 0.35) : dur;
    f.peak = peak;
    f.m.emissive = hex(color);
    f.m.opacity = 0;
    f.m.update();
    f.e.render!.meshInstances[0].mesh = this.quad;
    const p = this.tilePos(t);
    f.e.setPosition(p.x, p.y + 0.005, p.z);
    f.e.enabled = true;
  }

  /** Persistent gold outline on the tile that started a chain, until released. */
  hold(key: string, t: TileData, color = PALETTE.trim.amber) {
    const f = this.take();
    f.active = true;
    f.hold = true;
    f.key = key;
    f.life = 0;
    f.max = 1;
    f.peak = 0.9;
    f.m.emissive = hex(color);
    f.m.update();
    f.e.render!.meshInstances[0].mesh = this.frameMesh;
    const p = this.tilePos(t);
    f.e.setPosition(p.x, p.y + 0.01, p.z);
    f.e.enabled = true;
  }

  release(key: string) {
    for (const f of this.flashes)
      if (f.hold && f.key === key) {
        f.hold = false;
        f.life = f.max * 0.5; // fade out from the peak
      }
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
