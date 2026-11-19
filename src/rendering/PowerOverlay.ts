import * as pc from 'playcanvas';
import type { PowerNetwork, PowerNode } from '../gameplay/PowerGrid';
import type { Sim } from '../gameplay/Sim';
import { PALETTE, uniqueMat } from './Materials';
import { bezier, part, ring, tube } from './MachineParts';
import { cableY } from './PowerLines';
import { group, shape } from './Shapes';
import { GLOW_INTENSITY, glowMaterial, glowTileMesh } from './TileFx';
import { POWER } from '../data/power';

const P = PALETTE.signal.power;

/** E23.3.5's lights are grid nodes too (`light:<kind>`). */
const isLight = (m: PowerNode) => m.type.startsWith('light:');

interface MemberView {
  m: PowerNode;
  frame: pc.MeshInstance;
  net: number;
  network: PowerNetwork;
}
interface LineView {
  mi: pc.MeshInstance;
  net: number;
  network: PowerNetwork;
}
interface BarView {
  m: PowerNode;
  fill: pc.Entity;
}

/**
 * E23.3.4: the Power overlay, shown in build mode when toggled. Every machine on the grid sits on a glowing frame
 * in its network's colour, so you can see at a glance which machines each network powers; poles and their links
 * and the drop cables glow in that colour too; a machine with no power gets a red frame; each battery shows a bar
 * of its stored share; a pole lightning tripped gets a red ring. Everything is unlit and fog-free, so it reads at
 * night. Rebuilt when the networks change; states refresh four times a second.
 */
export class PowerOverlay {
  private root: pc.Entity;
  private seen?: PowerNetwork[];
  private members: MemberView[] = [];
  private lines: LineView[] = [];
  /** the network under the cursor (highlighted) */
  private focus?: PowerNetwork;
  private focusMat: pc.StandardMaterial;
  private focusLineMat: pc.StandardMaterial;
  private bars: BarView[] = [];
  private refreshIn = 0;
  private device: pc.GraphicsDevice;
  private netMats: pc.StandardMaterial[];
  private darkMat: pc.StandardMaterial;
  private on = false;
  /** Frames, lines and rings are batched into one static group (rebatched when the networks or a frame's state
   * change), so a big grid costs a few draw calls, not one per frame and line. Battery bars move and stay
   * unbatched. */
  private group = -1;
  /** every material the overlay draws with and its own emissive, so `setBoost` can keep them bright */
  private glowMats: { m: pc.StandardMaterial; base: number }[] = [];
  private lineMats: pc.StandardMaterial[];
  private redMat: pc.StandardMaterial;
  private cellMat: pc.StandardMaterial;
  private cellBackMat: pc.StandardMaterial;
  private boost = 1;

  constructor(
    private sim: Sim,
    parent: pc.Entity,
    private worldOf: (m: PowerNode) => [number, number, number],
    private batcher?: pc.BatchManager,
  ) {
    this.root = group(parent, 'powerOverlay');
    this.root.enabled = false;
    this.device = pc.AppBase.getApplication()!.graphicsDevice;
    this.netMats = P.nets.map((c) => glowMaterial(c));
    this.darkMat = glowMaterial(P.dark);
    this.focusMat = glowMaterial(P.focus, GLOW_INTENSITY * 1.4);
    this.focusLineMat = uniqueMat(P.focus, { unlit: true, emissiveIntensity: 1.6 });
    this.lineMats = P.nets.map((c) => uniqueMat(c, { unlit: true }));
    this.redMat = uniqueMat(P.tripped, { unlit: true });
    this.cellMat = uniqueMat(P.cell, { unlit: true });
    this.cellBackMat = uniqueMat(P.cellBack, { unlit: true });
    for (const m of [...this.netMats, this.darkMat, this.focusMat, this.focusLineMat, ...this.lineMats, this.redMat, this.cellMat, this.cellBackMat]) this.glowMats.push({ m, base: m.emissiveIntensity });
    if (batcher) this.group = batcher.addGroup('powerOverlay', false, 10000).id;
  }

  /** Keeps the overlay as bright while the Power view's dim lowers the exposure (DayNight.boost). */
  setBoost(b: number): void {
    if (Math.abs(b - this.boost) < 0.01) return;
    this.boost = b;
    for (const g of this.glowMats) {
      g.m.emissiveIntensity = g.base * b;
      g.m.update();
    }
  }

  get visible(): boolean {
    return this.on;
  }

  /** Shows or hides the overlay (the game shows it only in build mode). */
  show(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.root.enabled = on;
    if (on) {
      this.seen = undefined;
      this.refreshIn = 0;
    }
  }

  /** `focus`: where the cursor is (tile coordinates on a roof); the network near it is highlighted. */
  update(dt: number, focus?: { roofId: string; x: number; z: number }): void {
    if (!this.on) return;
    const nets = this.sim.power.networks();
    if (nets !== this.seen) this.rebuild(nets);
    const near = focus ? this.sim.power.networkNear(focus.roofId, focus.x, focus.z, POWER.view.focus) : undefined;
    const focusMoved = near !== this.focus;
    this.focus = near;
    this.refreshIn -= dt;
    if (this.refreshIn > 0 && !focusMoved) return;
    if (this.refreshIn <= 0) this.refreshIn = 0.25;
    let changed = false;
    for (const v of this.members) {
      const role = this.sim.power.roleOf(v.m);
      const dark = !!role?.consumer && !this.sim.power.isPowered(v.m);
      const want = dark ? this.darkMat : v.network === near ? this.focusMat : this.netMats[v.net % this.netMats.length];
      if (v.frame.material !== want) {
        v.frame.material = want;
        changed = true;
      }
    }
    for (const l of this.lines) {
      const want = l.network === near ? this.focusLineMat : this.lineMats[l.net % this.lineMats.length];
      if (l.mi.material !== want) {
        l.mi.material = want;
        changed = true;
      }
    }
    if (changed) this.rebatch();
    for (const b of this.bars) {
      const { stored, capacity } = this.sim.power.stored(b.m);
      const k = capacity > 0 ? Math.max(0.02, stored / capacity) : 0.02;
      b.fill.setLocalScale(0.16, 0.7 * k, 0.16);
      b.fill.setLocalPosition(0, 0.7 * k * 0.5 - 0.35, 0.001);
    }
  }

  /** Test and HUD hook: what the overlay draws right now (counts). */
  summary(): { networks: number; members: number; dark: number; batteries: number; tripped: number; links: number } {
    let dark = 0;
    for (const v of this.members) if (v.frame.material === this.darkMat) dark++;
    const nets = this.seen ?? [];
    return {
      networks: nets.length,
      members: this.members.length,
      dark,
      batteries: this.bars.length,
      tripped: this.sim.state.machines.filter((m) => this.sim.power.isTripped(m)).length,
      links: nets.reduce((a, n) => a + n.links.length + n.feeds.length, 0),
    };
  }

  private rebuild(nets: PowerNetwork[]) {
    this.seen = nets;
    for (const c of [...this.root.children]) c.destroy();
    this.members = [];
    this.lines = [];
    this.bars = [];
    // Colours by size: the biggest network (by machines) is always yellow, like the machines' glow in this view;
    // a separate network gets the next colour, so you can still tell which machines share a grid.
    const machinesIn = (n: PowerNetwork) => n.members.filter((m) => !m.type.startsWith('light:')).length;
    const rank = new Map([...nets].sort((a, b) => machinesIn(b) - machinesIn(a)).map((n, k) => [n, k]));
    nets.forEach((n) => {
      const i = rank.get(n)!;
      const line = this.lineMats[i % this.lineMats.length];
      for (const m of n.members) {
        const [x, y, z] = this.worldOf(m);
        const e = group(this.root, 'pframe', [x, y + 0.04, z]);
        // A light gets a small glowing dot, not a tile frame and no line, so the machines and the grid's shape read
        // first; you can still see which lights a network powers (or that one has none, in red).
        const size = isLight(m) ? 0.4 : m.size + 0.2;
        const mi = new pc.MeshInstance(glowTileMesh(this.device, size), this.netMats[i % this.netMats.length]);
        e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false });
        this.members.push({ m, frame: mi, net: i, network: n });
        if (this.sim.power.roleOf(m)?.battery) this.bar(m, x, y, z);
      }
      for (const [a, b] of n.links) this.lines.push({ mi: this.glowCable(a, b, line, 0.045), net: i, network: n });
      for (const [p, m] of n.feeds) if (!isLight(m)) this.lines.push({ mi: this.glowCable(p, m, line, 0.022), net: i, network: n });
    });
    // Poles lightning tripped: a red ring at the foot (they are on no network until reset).
    const red = this.redMat;
    for (const m of this.sim.state.machines) {
      if (!this.sim.power.isTripped(m)) continue;
      const [x, y, z] = this.worldOf(m);
      part(this.root, ring(28, 6), red, { pos: [x, y + 0.08, z], scale: [1.3, 0.08, 1.3] });
    }
    if (this.group >= 0) for (const c of this.root.children) if (c.name !== 'pbar') this.batch(c as pc.Entity);
    this.rebatch();
    this.refreshIn = 0;
  }

  private batch(e: pc.Entity) {
    if (e.render) e.render.batchGroupId = this.group;
    for (const c of e.children) this.batch(c as pc.Entity);
  }

  private rebatch() {
    if (this.batcher && this.group >= 0) this.batcher.markGroupDirty(this.group);
  }

  /** A battery's level bar, standing above it and facing the camera (which looks from +x +z). */
  private bar(m: PowerNode, x: number, y: number, z: number) {
    const g = group(this.root, 'pbar', [x, y + 1.45, z]);
    g.setLocalEulerAngles(0, 45, 0);
    shape(g, 'box', this.cellBackMat, { pos: [0, 0, -0.01], scale: [0.24, 0.8, 0.02] });
    const fill = shape(g, 'box', this.cellMat, { pos: [0, 0, 0.001], scale: [0.16, 0.7, 0.16] });
    this.bars.push({ m, fill });
  }

  private glowCable(a: PowerNode, b: PowerNode, m: pc.Material, r: number): pc.MeshInstance {
    const pa = this.worldOf(a);
    const pb = this.worldOf(b);
    const A: [number, number, number] = [pa[0], pa[1] + cableY(a), pa[2]];
    const B: [number, number, number] = [pb[0], pb[1] + cableY(b), pb[2]];
    const len = Math.hypot(B[0] - A[0], B[2] - A[2]);
    const sag = Math.min(1.2, len * (r > 0.03 ? 0.08 : 0.12));
    const mid: [number, number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2 - sag * 2, (A[2] + B[2]) / 2];
    const key = `powerGlow|${A.map((v) => v.toFixed(2)).join(',')}|${B.map((v) => v.toFixed(2)).join(',')}|${r}`;
    return part(this.root, tube(key, bezier(A, mid, B, Math.max(6, Math.ceil(len))), r, { sides: 5 }), m, {}).render!.meshInstances[0];
  }
}
