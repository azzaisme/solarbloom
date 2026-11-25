import * as pc from 'playcanvas';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { mat, PALETTE } from './Materials';
import { group, shape } from './Shapes';
import { SLAB_TOP } from './SceneBuilder';
import { glowMaterial, glowTileMesh } from './TileFx';
import { pavingOverlayLift } from './PavingSurface';
import { Hologram, type HoloShape } from './Hologram';
import { faceTileMarker, markerShimmerMesh, tileMarkerMesh, type MarkerView, type TileMarkerKind } from './TileMarker';

export type OverlayTone = 'hover' | 'ok' | 'bad' | 'info' | 'mega';
const TONE: Record<OverlayTone, string> = { hover: PALETTE.signal.hover, ok: PALETTE.signal.ok, bad: PALETTE.signal.bad, info: PALETTE.signal.info, mega: PALETTE.gold };
const TONES = Object.keys(TONE) as OverlayTone[];
type FrameTone = Exclude<OverlayTone, 'mega'> | 'restore';
const FRAME: Record<FrameTone, TileMarkerKind> = { hover: 'hover', ok: 'valid', bad: 'invalid', info: 'selected', restore: 'restore' };

/**
 * Hover frame, placement ghost and radius tiles. (E24 #609: the old first-tile arrow is retired; rendering/Waymark marks the goal.) Look 3.14: the frame and the radius / pulse-preview tiles are
 * glowing tile outlines with a soft inner fill (shared meshes, one shared material per tone and use).
 */
export class Overlays {
  private frame: pc.Entity;
  private frameMi: pc.MeshInstance;
  private frameTone: FrameTone = 'hover';
  private frameAt?: { roofId: string; x: number; z: number };
  private frameMat = glowMaterial(PALETTE.pure.white, 1.25);
  private shimmerMat = glowMaterial(PALETTE.pure.white, 1.35);
  private shimmer: pc.Entity;
  reducedMotion = false;
  private device: pc.GraphicsDevice;
  /** Radius tiles breathe separately from the primary marker. */
  private radiusMats = {} as Record<OverlayTone, pc.StandardMaterial>;
  private radiusTone?: OverlayTone;
  megaCharge = 0;
  private radiusMis: pc.MeshInstance[] = [];
  private ghost: pc.Entity;
  private ghostBox: pc.Entity;
  private radius: pc.Entity[] = [];
  private radiusRoot: pc.Entity;
  private time = 0;
  private frameSize = 1;
  private gridLines: pc.Entity;
  /** E19: the build hologram (replaces the plain ghost box when given a shape). */
  readonly holo: Hologram;

  constructor(
    private sim: Sim,
    parent: pc.Entity,
  ) {
    const root = group(parent, 'overlays');
    this.device = pc.AppBase.getApplication()!.graphicsDevice;
    for (const t of TONES) {
      this.radiusMats[t] = glowMaterial(TONE[t]);
    }
    this.frame = group(root, 'frame');
    this.frameMi = new pc.MeshInstance(tileMarkerMesh(this.device, 'hover'), this.frameMat);
    this.frame.addComponent('render', { meshInstances: [this.frameMi], castShadows: false, receiveShadows: false });
    this.shimmer = group(this.frame, 'restore-glints');
    this.shimmer.addComponent('render', { meshInstances: [new pc.MeshInstance(markerShimmerMesh(this.device, 'restore'), this.shimmerMat)], castShadows: false, receiveShadows: false });
    this.shimmer.enabled = false;
    this.frame.enabled = false;
    this.ghost = group(root, 'ghost');
    this.ghostBox = shape(this.ghost, 'box', mat(TONE.ok, { opacity: 0.5, unlit: true }), { receive: false });
    this.ghost.enabled = false;
    this.holo = new Hologram(this.device, root);
    // Faint tile boundaries, shown only while building.
    this.gridLines = group(root, 'buildGrid');
    const lineMat = mat(PALETTE.signal.gridLine, { opacity: 0.45, unlit: true });
    for (const r of sim.grid.rooftops) {
      if (!r.unlocked || r.preview) continue;
      const y = r.origin[1] + r.height + SLAB_TOP + 0.012;
      for (let i = 0; i <= r.width; i++) shape(this.gridLines, 'box', lineMat, { pos: [r.origin[0] + i, y, r.origin[2] + r.depth / 2], scale: [0.04, 0.01, r.depth], receive: false });
      for (let i = 0; i <= r.depth; i++) shape(this.gridLines, 'box', lineMat, { pos: [r.origin[0] + r.width / 2, y, r.origin[2] + i], scale: [r.width, 0.01, 0.04], receive: false });
    }
    this.gridLines.enabled = false;
    this.radiusRoot = group(root, 'radius');
  }

  private fillRadiusPool(count: number) {
    const tileMesh = glowTileMesh(this.device, 1);
    while (this.radius.length < count) {
      const e = group(this.radiusRoot, 'radiusTile');
      const mi = new pc.MeshInstance(tileMesh, this.radiusMats.info);
      e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false });
      e.enabled = false;
      this.radius.push(e);
      this.radiusMis.push(mi);
    }
  }

  private footprintCenter(roofId: string, x: number, z: number, size: number): pc.Vec3 {
    const r = this.sim.grid.roof(roofId)!;
    // E21.24: on its terrace
    return new pc.Vec3(r.origin[0] + x + size / 2, r.origin[1] + r.height + SLAB_TOP + 0.02 + this.sim.grid.groundOffset(roofId, x, z), r.origin[2] + z + size / 2);
  }

  showFrame(roofId: string, x: number, z: number, size: number, tone: FrameTone) {
    if (this.frameTone !== tone || this.frameSize !== size) {
      this.frameTone = tone;
      this.frameSize = size;
      this.frameMi.mesh = tileMarkerMesh(this.device, FRAME[tone], size);
    }
    const p = this.footprintCenter(roofId, x, z, size);
    let lift = 0;
    for (let dx = 0; dx < size; dx++) {
      for (let dz = 0; dz < size; dz++) {
        lift = Math.max(lift, pavingOverlayLift(this.sim.grid, this.sim.grid.peek(roofId, x + dx, z + dz)));
      }
    }
    this.frame.setPosition(p.x, p.y + lift + 0.024, p.z);
    this.frameAt = { roofId, x, z };
    this.shimmer.enabled = tone === 'restore' && !this.reducedMotion;
    this.frame.enabled = true;
  }

  framesTile(tile: TileData): boolean {
    const at = this.frameAt;
    return !!at && this.frame.enabled && tile.roofId === at.roofId && tile.x >= at.x && tile.z >= at.z
      && tile.x < at.x + this.frameSize && tile.z < at.z + this.frameSize;
  }

  showGrid(on: boolean) {
    this.gridLines.enabled = on;
  }

  hideFrame() {
    this.frame.enabled = false;
  }

  showGhost(roofId: string, x: number, z: number, size: number, ok: boolean, height = 0.5, shape?: HoloShape) {
    const p = this.footprintCenter(roofId, x, z, size);
    if (shape) {
      // E19: a hologram of the real thing, projected from bloombot's eyes
      this.ghost.enabled = false;
      this.holo.show(shape, p.x, p.y, p.z, size, ok ? 'ok' : 'bad');
      this.showFrame(roofId, x, z, size, ok ? 'ok' : 'bad');
      return;
    }
    this.holo.hide();
    this.ghost.setPosition(p.x, p.y + height / 2, p.z);
    this.ghostBox.setLocalScale(size * 0.92, height, size * 0.92);
    this.ghostBox.render!.material = mat(ok ? TONE.ok : TONE.bad, { opacity: 0.5, unlit: true });
    this.ghost.enabled = true;
    this.showFrame(roofId, x, z, size, ok ? 'ok' : 'bad');
  }

  hideGhost() {
    this.ghost.enabled = false;
    this.holo.hide();
  }

  showRadius(tiles: TileData[], tone: OverlayTone = 'info') {
    if (tiles.length > this.radius.length) this.fillRadiusPool(tiles.length);
    const m = this.radiusMats[tone];
    const retone = this.radiusTone !== tone;
    this.radiusTone = tone;
    this.radius.forEach((e, i) => {
      const t = tiles[i];
      if (!t) {
        e.enabled = false;
        return;
      }
      const [x, y, z] = this.sim.grid.tileWorld(t);
      e.setPosition(x, y + SLAB_TOP + pavingOverlayLift(this.sim.grid, t) + 0.028, z);
      if (retone || !e.enabled) this.radiusMis[i].material = m;
      e.enabled = true;
    });
  }

  hideRadius() {
    for (const e of this.radius) e.enabled = false;
  }

  update(dt: number, view?: MarkerView) {
    this.time += dt;
    this.holo.update(dt);
    if (this.frame.enabled) {
      if (view && this.frameTone === 'restore') faceTileMarker(this.frame, view);
      this.frameMat.opacity = this.frameTone === 'info' && !this.reducedMotion ? 0.91 + 0.09 * Math.sin(this.time * 3.2) : 1;
      this.frameMat.update();
      this.shimmer.enabled = this.frameTone === 'restore' && !this.reducedMotion;
      if (this.shimmer.enabled) {
        this.shimmer.setLocalPosition(0, 0.02 + 0.021 * Math.sin(this.time * 2.2), 0);
        this.shimmerMat.opacity = 0.65 + 0.22 * Math.sin(this.time * 2.2);
        this.shimmerMat.update();
      }
    }
    if (this.radiusTone && this.radius[0]?.enabled) {
      // The preview tiles breathe softly together, a little out of step with the hover frame.
      const m = this.radiusMats[this.radiusTone];
      m.opacity = this.radiusTone === 'mega' ? 0.4 + 0.6 * this.megaCharge : this.reducedMotion ? 0.69 : 0.62 + 0.18 * Math.sin(this.time * 3.2);
      m.update();
    }
  }
}
