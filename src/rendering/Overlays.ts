import * as pc from 'playcanvas';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { mat } from './Materials';
import { group, shape } from './Shapes';
import { SLAB_TOP } from './SceneBuilder';

export type OverlayTone = 'hover' | 'ok' | 'bad' | 'info';
const TONE: Record<OverlayTone, string> = { hover: '#ffffff', ok: '#7dff9a', bad: '#ff6b6b', info: '#fff0a0' };

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

  constructor(
    private sim: Sim,
    parent: pc.Entity,
  ) {
    const root = group(parent, 'overlays');
    this.frame = group(root, 'frame');
    for (let i = 0; i < 4; i++) this.bars.push(shape(this.frame, 'box', mat('#ffffff', { unlit: true }), { scale: 0.05, receive: false }));
    this.frame.enabled = false;
    this.ghost = group(root, 'ghost');
    this.ghostBox = shape(this.ghost, 'box', mat(TONE.ok, { opacity: 0.5, unlit: true }), { receive: false });
    this.ghost.enabled = false;
    // Faint tile boundaries, shown only while building.
    this.gridLines = group(root, 'buildGrid');
    const lineMat = mat('#1d3640', { opacity: 0.45, unlit: true });
    for (const r of sim.state.rooftops) {
      if (!r.unlocked || r.preview) continue;
      const y = r.origin[1] + r.height + SLAB_TOP + 0.012;
      for (let i = 0; i <= r.width; i++) shape(this.gridLines, 'box', lineMat, { pos: [r.origin[0] + i, y, r.origin[2] + r.depth / 2], scale: [0.04, 0.01, r.depth], receive: false });
      for (let i = 0; i <= r.depth; i++) shape(this.gridLines, 'box', lineMat, { pos: [r.origin[0] + r.width / 2, y, r.origin[2] + i], scale: [r.width, 0.01, 0.04], receive: false });
    }
    this.gridLines.enabled = false;
    this.radiusRoot = group(root, 'radius');
    for (let i = 0; i < 80; i++) {
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
    if (this.frame.enabled) {
      const s = 1 + Math.sin(this.time * 6) * 0.015;
      this.frame.setLocalScale(s, 1, s);
    }
  }
}
