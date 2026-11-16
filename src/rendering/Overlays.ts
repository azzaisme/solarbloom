import * as pc from 'playcanvas';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { mat, PALETTE } from './Materials';
import { group, shape } from './Shapes';
import { SLAB_TOP } from './SceneBuilder';

export type OverlayTone = 'hover' | 'ok' | 'bad' | 'info';
const TONE: Record<OverlayTone, string> = { hover: PALETTE.signal.hover, ok: PALETTE.signal.ok, bad: PALETTE.signal.bad, info: PALETTE.signal.info };

/** Hover frame, placement ghost and radius tiles. */
export class Overlays {
  private frame: pc.Entity;
  private bars: pc.Entity[] = [];
  private ghost: pc.Entity;
  private ghostBox: pc.Entity;
  private radius: pc.Entity[] = [];
  private radiusRoot: pc.Entity;
  private time = 0;
  private frameSize = 1;
  private gridLines: pc.Entity;
  private beacon: pc.Entity;
  private beaconArrow: pc.Entity;
  private beaconBase = new pc.Vec3();

  constructor(
    private sim: Sim,
    parent: pc.Entity,
  ) {
    const root = group(parent, 'overlays');
    this.frame = group(root, 'frame');
    for (let i = 0; i < 4; i++) this.bars.push(shape(this.frame, 'box', mat(PALETTE.signal.hover, { unlit: true }), { scale: 0.05, receive: false }));
    this.frame.enabled = false;
    this.ghost = group(root, 'ghost');
    this.ghostBox = shape(this.ghost, 'box', mat(TONE.ok, { opacity: 0.5, unlit: true }), { receive: false });
    this.ghost.enabled = false;
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
    // First-tile beacon: a bobbing golden arrow + soft glow plate.
    this.beacon = group(root, 'beacon');
    this.beaconArrow = group(this.beacon, 'arrow');
    shape(this.beaconArrow, 'cone', mat(PALETTE.signal.beacon, { emissive: PALETTE.signal.beaconGlow, emissiveIntensity: 0.6 }), { rot: [180, 0, 0], scale: [0.28, 0.34, 0.28] });
    shape(this.beaconArrow, 'cylinder', mat(PALETTE.signal.beacon, { emissive: PALETTE.signal.beaconGlow, emissiveIntensity: 0.6 }), { pos: [0, 0.3, 0], scale: [0.11, 0.3, 0.11] });
    shape(this.beacon, 'box', mat(PALETTE.signal.beaconPool, { opacity: 0.5, unlit: true }), { pos: [0, -0.5, 0], scale: [0.9, 0.02, 0.9], receive: false });
    this.beacon.enabled = false;
    this.radiusRoot = group(root, 'radius');
    for (let i = 0; i < 180; i++) { // Phase 4: room for the largest pulse footprint preview (161 tiles)
      const e = shape(this.radiusRoot, 'box', mat(TONE.info, { opacity: 0.45, unlit: true }), { scale: [0.9, 0.02, 0.9], receive: false });
      e.enabled = false;
      this.radius.push(e);
    }
  }

  private layoutFrame(size: number) {
    if (this.frameSize === size && this.bars[0].getLocalScale().x > 0.06) return;
    this.frameSize = size;
    const h = size / 2 - 0.02;
    const L = size;
    const w = 0.05;
    this.bars[0].setLocalPosition(0, 0, -h);
    this.bars[0].setLocalScale(L, 0.03, w);
    this.bars[1].setLocalPosition(0, 0, h);
    this.bars[1].setLocalScale(L, 0.03, w);
    this.bars[2].setLocalPosition(-h, 0, 0);
    this.bars[2].setLocalScale(w, 0.03, L);
    this.bars[3].setLocalPosition(h, 0, 0);
    this.bars[3].setLocalScale(w, 0.03, L);
  }

  private footprintCenter(roofId: string, x: number, z: number, size: number): pc.Vec3 {
    const r = this.sim.grid.roof(roofId)!;
    return new pc.Vec3(r.origin[0] + x + size / 2, r.origin[1] + r.height + SLAB_TOP + 0.02, r.origin[2] + z + size / 2);
  }

  showFrame(roofId: string, x: number, z: number, size: number, tone: OverlayTone) {
    this.layoutFrame(size);
    const p = this.footprintCenter(roofId, x, z, size);
    this.frame.setPosition(p.x, p.y, p.z);
    for (const b of this.bars) b.render!.material = mat(TONE[tone], { unlit: true });
    this.frame.enabled = true;
  }

  showGrid(on: boolean) {
    this.gridLines.enabled = on;
  }

  showBeacon(roofId: string, x: number, z: number) {
    const p = this.footprintCenter(roofId, x, z, 1);
    this.beaconBase.set(p.x, p.y + 0.55, p.z);
    this.beacon.enabled = true;
  }

  hideBeacon() {
    this.beacon.enabled = false;
  }

  hideFrame() {
    this.frame.enabled = false;
  }

  showGhost(roofId: string, x: number, z: number, size: number, ok: boolean, height = 0.5) {
    const p = this.footprintCenter(roofId, x, z, size);
    this.ghost.setPosition(p.x, p.y + height / 2, p.z);
    this.ghostBox.setLocalScale(size * 0.92, height, size * 0.92);
    this.ghostBox.render!.material = mat(ok ? TONE.ok : TONE.bad, { opacity: 0.5, unlit: true });
    this.ghost.enabled = true;
    this.showFrame(roofId, x, z, size, ok ? 'ok' : 'bad');
  }

  hideGhost() {
    this.ghost.enabled = false;
  }

  showRadius(tiles: TileData[], tone: OverlayTone = 'info') {
    this.radius.forEach((e, i) => {
      const t = tiles[i];
      if (!t) {
        e.enabled = false;
        return;
      }
      const [x, y, z] = this.sim.grid.tileWorld(t);
      e.setPosition(x, y + SLAB_TOP + 0.03, z);
      e.render!.material = mat(TONE[tone], { opacity: 0.45, unlit: true });
      e.enabled = true;
    });
  }

  hideRadius() {
    for (const e of this.radius) e.enabled = false;
  }

  update(dt: number) {
    this.time += dt;
    if (this.beacon.enabled) {
      const b = this.beaconBase;
      this.beacon.setPosition(b.x, b.y, b.z);
      this.beaconArrow.setLocalPosition(0, 0.25 + Math.abs(Math.sin(this.time * 3)) * 0.25, 0);
      this.beaconArrow.setLocalEulerAngles(0, this.time * 90, 0);
    }
    if (this.frame.enabled) {
      const s = 1 + Math.sin(this.time * 6) * 0.015;
      this.frame.setLocalScale(s, 1, s);
    }
  }
}
