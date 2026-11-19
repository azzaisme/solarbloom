import * as pc from 'playcanvas';
import { GROUND } from '../core/GameState';
import { levelY } from '../core/Height';
import type { MachineData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import type { WaterBody } from '../gameplay/WaterSystem';
import { mat } from './Materials';
import { PALETTE } from './Palette';

/** Sizes (tiles): how high above the ground the view floats, the arrows, the level gauges. */
const VIEW = { lift: 0.24, tile: 0.86, arrow: 0.22, gaugeH: 1.1, gaugeW: 0.16, ring: 0.62, reach: 40, every: 0.4 };

/** Flat lists for one unlit mesh. */
class Flat {
  pos: number[] = [];
  idx: number[] = [];
  quad(a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]) {
    const i = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    this.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }
  tri(a: [number, number, number], b: [number, number, number], c: [number, number, number]) {
    const i = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c);
    this.idx.push(i, i + 2, i + 1);
  }
  /** An upright box (the gauges). */
  box(x: number, y0: number, z: number, w: number, h: number) {
    const [x0, x1, z0, z1, y1] = [x - w / 2, x + w / 2, z - w / 2, z + w / 2, y0 + h];
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  }
  /** A flat ring on the ground (a dry planter's marker). */
  ring(x: number, y: number, z: number, r: number, w: number, n = 20) {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      const p = (a: number, rr: number): [number, number, number] => [x + Math.cos(a) * rr, y, z + Math.sin(a) * rr];
      this.quad(p(a0, r - w), p(a0, r), p(a1, r), p(a1, r - w));
    }
  }
  mesh(device: pc.GraphicsDevice): pc.Mesh | undefined {
    if (!this.idx.length) return undefined;
    const m = new pc.Mesh(device);
    m.setPositions(this.pos);
    const n: number[] = [];
    for (let i = 0; i < this.pos.length; i += 3) n.push(0, 1, 0);
    m.setNormals(n);
    m.setIndices(this.idx);
    m.update(pc.PRIMITIVE_TRIANGLES);
    return m;
  }
}

/**
 * E23.4.5 (#385): the Water view, in build mode. It floats over the world, unlit so it reads at any hour:
 * - every pipe tile as a soft tile (aqua when it carries water, grey when dry), with chevrons pointing the way the
 *   water flows (away from the pumps, plants and reservoirs that feed it);
 * - a level gauge standing in every pond, canal, reservoir and desalination tank near bloombot (dark frame, aqua as
 *   high as it is full);
 * - a red ring round every planter that is dry (E23.5.2's planters: no water in reach).
 * Rebuilt a few times a second while it is on; nothing while it is off.
 */
export class WaterOverlay {
  private root: pc.Entity;
  private meshes: pc.Mesh[] = [];
  private acc = 0;
  private on = false;

  constructor(
    private sim: Sim,
    parent: pc.Entity,
    private device: pc.GraphicsDevice,
  ) {
    this.root = new pc.Entity('water-view');
    this.root.enabled = false;
    parent.addChild(this.root);
  }

  set visible(v: boolean) {
    if (v === this.on) return;
    this.on = v;
    this.root.enabled = v;
    this.acc = VIEW.every;
    if (!v) this.clear();
  }

  get visible(): boolean {
    return this.on;
  }

  /** `at`: where bloombot (or the camera) is: gauges are drawn for water within `reach` of it. */
  update(dt: number, at: { x: number; z: number }) {
    if (!this.on) return;
    this.acc += dt;
    if (this.acc < VIEW.every) return;
    this.acc = 0;
    this.build(at);
  }

  /** Planters with no water in reach (a pond, a canal or a running pipe): the view rings them red. */
  static dryPlanters(sim: Sim): MachineData[] {
    return sim.machinesOfType('planter').filter((m) => {
      const t = sim.grid.peek(m.roofId, m.x, m.z);
      return !!t && !sim.water.isWatered(t);
    });
  }

  /**
   * E23.4.5: machines the Water view turns into blue holograms: water that runs or is held. A pump pushing water
   * (powered, on a bank with water), a reservoir holding some, and a desalination plant making or holding some.
   */
  static holoMachines(sim: Sim): Set<string> {
    const w = sim.water;
    const out = new Set<string>();
    for (const m of sim.state.machines) {
      if (m.type === 'reservoir') {
        const b = w.tank(m.id);
        if (b && w.amountOf(b.id) > 0) out.add(m.id);
      } else if (m.type === 'desalination') {
        // moving water: holding what it made while that has somewhere to go (the same rule as its arrows). A full
        // plant with nowhere for water to go stands idle, powered or not, and shows idle: no hologram, no arrows.
        if (w.pipes.moving(m)) out.add(m.id);
      } else if (w.pipes.pumpSpec(m.type) && w.pipes.pumpLive(m)) out.add(m.id);
    }
    return out;
  }

  private clear() {
    for (const c of [...this.root.children]) c.destroy();
    for (const m of this.meshes) m.destroy();
    this.meshes = [];
  }

  private y(x: number, z: number): number {
    const t = this.sim.grid.peek(GROUND, x, z);
    return this.sim.grid.layer(GROUND)!.height + levelY(t?.level ?? 1) + VIEW.lift;
  }

  private build(at: { x: number; z: number }) {
    this.clear();
    const p = this.sim.water.pipes;
    const w = this.sim.water;
    const wet = new Flat();
    const dry = new Flat();
    const arrows = new Flat();
    const frame = new Flat();
    const fill = new Flat();
    const warn = new Flat();
    // pipes and their flow
    const flow = p.flow();
    const h = VIEW.tile / 2;
    for (const k of p.keys()) {
      const [x, z] = k.split(',').map(Number);
      const y = this.y(x, z);
      const cx = x + 0.5;
      const cz = z + 0.5;
      (p.carries(x, z) ? wet : dry).quad([cx - h, y, cz - h], [cx - h, y, cz + h], [cx + h, y, cz + h], [cx + h, y, cz - h]);
      for (const [dx, dz] of flow.get(k) ?? []) {
        // a chevron from the middle toward that side, pointing downstream
        const a = VIEW.arrow;
        const tip: [number, number, number] = [cx + dx * 0.38, y + 0.01, cz + dz * 0.38];
        const back = [cx + dx * (0.38 - a), cz + dz * (0.38 - a)];
        const side = [dz * a, dx * a];
        arrows.tri(tip, [back[0] + side[0], y + 0.01, back[1] + side[1]], [back[0] - side[0], y + 0.01, back[1] - side[1]]);
      }
    }
    // level gauges in the water near bloombot
    const bodies = new Set<WaterBody>(w.live());
    const R = VIEW.reach;
    for (let z = Math.floor(at.z) - R; z <= at.z + R; z += 2)
      for (let x = Math.floor(at.x) - R; x <= at.x + R; x += 2) {
        const t = this.sim.grid.peek(GROUND, x, z);
        if (t && w.isFresh(t)) bodies.add(w.bodyAt(t)!);
      }
    for (const b of bodies) {
      const spot = this.gaugeSpot(b);
      if (!spot || Math.abs(spot.x - at.x) > R || Math.abs(spot.z - at.z) > R) continue;
      const lv = w.levelOf(b.id);
      const base = spot.y;
      frame.box(spot.x, base, spot.z, VIEW.gaugeW + 0.06, VIEW.gaugeH + 0.06);
      if (lv > 0.005) fill.box(spot.x, base + 0.03, spot.z, VIEW.gaugeW + 0.08, (VIEW.gaugeH - 0.02) * lv);
    }
    // dry planters (E23.5.2)
    for (const m of WaterOverlay.dryPlanters(this.sim)) {
      const c = m.size / 2;
      warn.ring(m.x + c, this.y(m.x, m.z), m.z + c, VIEW.ring * m.size, 0.12); // at the overlay's height, outside the footprint: no model or flowers hide it
    }
    const parts: [Flat, string, number][] = [
      [wet, PALETTE.aqua.water, 0.55],
      [dry, PALETTE.aqua.viewDry, 0.5],
      [arrows, PALETTE.aqua.mist, 0.95],
      [frame, PALETTE.aqua.abyss, 0.9],
      [fill, PALETTE.aqua.water, 0.95],
      [warn, PALETTE.aqua.viewThirsty, 0.9],
    ];
    const instances: pc.MeshInstance[] = [];
    for (const [g, colour, opacity] of parts) {
      const m = g.mesh(this.device);
      if (!m) continue;
      this.meshes.push(m);
      instances.push(new pc.MeshInstance(m, mat(colour, { unlit: true, opacity, doubleSided: true })));
    }
    if (!instances.length) return;
    const e = new pc.Entity('water-view-mesh');
    e.addComponent('render', { meshInstances: instances, castShadows: false, receiveShadows: false });
    this.root.addChild(e);
  }

  /** Where a body's gauge stands: in the middle of a pond or canal, on top of a tank. */
  private gaugeSpot(b: WaterBody): { x: number; z: number; y: number } | undefined {
    if (b.reservoir) {
      const m = b.reservoir;
      return { x: m.x + m.size / 2, z: m.z + m.size / 2, y: this.y(m.x, m.z) + 0.85 };
    }
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (const id of b.tiles) {
      const t = this.sim.grid.byTileId(id);
      if (!t) continue;
      sx += t.x + 0.5;
      sz += t.z + 0.5;
      n++;
    }
    if (!n) return undefined;
    // the water tile nearest the middle
    let best: { x: number; z: number } | undefined;
    let bd = Infinity;
    for (const id of b.tiles) {
      const t = this.sim.grid.byTileId(id);
      if (!t) continue;
      const d = (t.x + 0.5 - sx / n) ** 2 + (t.z + 0.5 - sz / n) ** 2;
      if (d < bd) {
        bd = d;
        best = { x: t.x + 0.5, z: t.z + 0.5 };
      }
    }
    return best && { ...best, y: this.y(Math.floor(best.x), Math.floor(best.z)) - VIEW.lift };
  }

  destroy() {
    this.clear();
    this.root.destroy();
  }
}
