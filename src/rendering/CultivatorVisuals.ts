import * as pc from 'playcanvas';
import type { CultivatorUnit, MachineData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { mat, PALETTE } from './Materials';
import { group, shape } from './Shapes';
import { MODELS } from './Models';
import type { Vfx } from './Vfx';

/**
 * Look 6.9 (#178): the Cultivator's look, from primitives (no assets). The dock is a cream charging pad with a
 * solar canopy and a gold sun emblem; each tiller is a cream-shelled body on soft treads with a sun-tracking solar
 * canopy, a front row of root-drill tines, a glass seed hopper with seeds inside, a rear moss roller and gold
 * trim. Animation: tines spin and dig in while working, the body bobs, the canopy tracks the sun, the hopper level
 * drops as it sows, it glows while working. Trail: soil and dust at the front (clean tech: no smoke) and seedlings
 * behind (the tile's own restore transition knits them into turf).
 *
 * Upgrades change the silhouette: Wide Tines widen the tine bar (and roller), Tiller Speed adds gold-rimmed big
 * treads, Seed Mix a second hopper, Fog Seeker a compass mast; the Second Tiller is a second unit.
 */

const SHELL = PALETTE.shell;
const GOLD = PALETTE.gold;
const GLASS = PALETTE.glass;
const PANEL = PALETTE.panel;
const TREAD = PALETTE.facadeDark;

/** The dock (built by MachineVisuals as the machine's body). */
export function cultivatorDock(b: pc.Entity) {
  shape(b, 'box', mat(SHELL), { pos: [0, 0.06, 0], scale: [0.9, 0.12, 0.9], shadow: true });
  shape(b, 'box', mat(GOLD, { metal: 0.6, gloss: 0.75 }), { pos: [0, 0.125, 0], scale: [0.92, 0.012, 0.92] });
  shape(b, 'box', mat(PALETTE.moss), { pos: [0, 0.13, 0], scale: [0.7, 0.01, 0.7] });
  // charging arch with a canopy
  for (const x of [-0.38, 0.38]) shape(b, 'cylinder', mat(SHELL), { pos: [x, 0.42, -0.36], scale: [0.06, 0.6, 0.06], shadow: true });
  shape(b, 'box', mat(PANEL, { gloss: 0.8 }), { pos: [0, 0.74, -0.2], scale: [0.86, 0.03, 0.46], rot: [18, 0, 0], shadow: true });
  shape(b, 'box', mat(SHELL), { pos: [0, 0.725, -0.2], scale: [0.9, 0.02, 0.5], rot: [18, 0, 0] });
  // sun emblem
  shape(b, 'cylinder', mat(GOLD, { emissive: GOLD, emissiveIntensity: 1.1 }), { pos: [0, 0.5, -0.4], scale: [0.16, 0.02, 0.16], rot: [90, 0, 0] });
}

interface UnitView {
  root: pc.Entity;
  body: pc.Entity;
  canopy: pc.Entity;
  tines: pc.Entity;
  roller: pc.Entity;
  seeds: pc.Entity;
  glow: pc.Entity;
  key: string;
  lastTrail: number;
  dust: number;
  /** Look 3.19: built from the hand-built model: its tine drum's rest position (the drum dips while working) */
  tinesRest?: pc.Vec3;
}

/** Look 6.9: the tillers, moved from the sim's unit positions each frame. */
export class CultivatorVisuals {
  private units = new Map<string, UnitView>();
  private time = 0;
  reducedMotion = false;

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private vfx?: Vfx,
  ) {}

  private build(m: MachineData, i: number): UnitView {
    const lv = (id: string) => m.upg?.[id] ?? 0;
    const w = 1 + lv('cultWidth');
    const root = group(this.parent, `tiller-${m.id}-${i}`);
    const body = group(root, 'body');
    const key = `${w}|${lv('cultSpeed') > 0}|${lv('cultSeed')}|${lv('cultRoute')}`;
    // Look 3.19: the hand-built Cultivator (treads, tine drum, moss roller, sun canopy, glass hopper with its seed
    // fill are its own parts, so they move as before). Wide Tines widen the drum; the glow stays procedural.
    const model = MODELS?.instantiate('cultivator');
    if (model) {
      model.setLocalScale(0.46, 0.46, 0.46);
      body.addChild(model);
      const find = (n: string) => (model.findByName(n) as pc.Entity | null) ?? group(model, n);
      const tines = find('tineDrum');
      if (w > 1) tines.setLocalScale(w, 1, 1);
      const glow = shape(body, 'sphere', mat(PALETTE.coreGlow, { emissive: PALETTE.coreGlow, emissiveIntensity: 1.4 }), { pos: [0, 0.1, 0.32], scale: [0.3 * w, 0.04, 0.08] });
      return { root, body, canopy: find('canopy'), tines, roller: find('mossRoller'), seeds: find('seedFill'), glow, key, lastTrail: 0, dust: 0, tinesRest: tines.getLocalPosition().clone() };
    }
    const s = 0.42; // overall scale: a bit under a tile
    body.setLocalScale(s, s, s);
    // treads
    const big = lv('cultSpeed') > 0;
    for (const x of [-0.55, 0.55]) {
      shape(body, 'capsule', mat(TREAD, { gloss: 0.2 }), { pos: [x, 0.22, 0], scale: [big ? 0.3 : 0.24, big ? 0.62 : 0.55, big ? 0.3 : 0.24], rot: [90, 0, 0], shadow: true });
      if (big) shape(body, 'torus', mat(GOLD, { metal: 0.6, gloss: 0.75 }), { pos: [x * 1.08, 0.22, 0], scale: [0.34, 0.08, 0.34], rot: [0, 0, 90] });
    }
    // shell
    shape(body, 'box', mat(SHELL), { pos: [0, 0.5, 0], scale: [0.95, 0.38, 1.1], shadow: true });
    shape(body, 'sphere', mat(SHELL), { pos: [0, 0.68, -0.1], scale: [0.9, 0.3, 0.9] });
    shape(body, 'box', mat(GOLD, { metal: 0.6, gloss: 0.75 }), { pos: [0, 0.7, 0], scale: [0.97, 0.03, 1.12] });
    shape(body, 'cylinder', mat(GOLD, { emissive: GOLD, emissiveIntensity: 1.1 }), { pos: [0, 0.55, 0.56], scale: [0.18, 0.02, 0.18], rot: [90, 0, 0] });
    // glass seed hopper(s) with seeds
    const hoppers = lv('cultSeed') ? [-0.22, 0.22] : [0];
    const seeds = group(body, 'seeds');
    for (const x of hoppers) {
      shape(body, 'cylinder', mat(GLASS, { gloss: 0.9, opacity: 0.45 }), { pos: [x, 0.98, -0.2], scale: [0.3, 0.36, 0.3] });
      shape(seeds, 'cylinder', mat(PALETTE.gold), { pos: [x, 0.92, -0.2], scale: [0.25, 0.24, 0.25] });
    }
    // sun-tracking canopy on a mast
    shape(body, 'cylinder', mat(SHELL), { pos: [0, 1.15, 0.12], scale: [0.06, 0.5, 0.06] });
    const canopy = group(body, 'canopy', [0, 1.42, 0.12]);
    shape(canopy, 'box', mat(PANEL, { gloss: 0.8 }), { scale: [1.0, 0.04, 0.7], shadow: true });
    shape(canopy, 'box', mat(SHELL), { pos: [0, -0.025, 0], scale: [1.04, 0.02, 0.74] });
    if (lv('cultSeed')) shape(canopy, 'box', mat(PANEL, { gloss: 0.8 }), { pos: [0, 0.12, -0.1], scale: [0.7, 0.03, 0.4] });
    if (lv('cultRoute')) {
      shape(body, 'cylinder', mat(SHELL), { pos: [0.4, 1.0, -0.45], scale: [0.04, 0.6, 0.04] });
      shape(body, 'sphere', mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1.2 }), { pos: [0.4, 1.33, -0.45], scale: 0.1 });
    }
    // front tine bar (wider with Wide Tines)
    const tines = group(body, 'tines', [0, 0.18, 0.72]);
    shape(tines, 'cylinder', mat(GOLD, { metal: 0.6, gloss: 0.7 }), { scale: [0.1, 0.9 * w, 0.1], rot: [0, 0, 90] });
    const n = 4 * w;
    for (let k = 0; k < n; k++) {
      const x = (k / (n - 1) - 0.5) * 0.85 * w;
      shape(tines, 'cone', mat(PALETTE.parapet, { metal: 0.5, gloss: 0.6 }), { pos: [x, -0.1, 0], scale: [0.07, 0.22, 0.07], rot: [180 + (k % 2) * 30, 0, 0] });
    }
    // rear moss roller
    const roller = group(body, 'roller', [0, 0.16, -0.68]);
    shape(roller, 'cylinder', mat(PALETTE.leafVein), { scale: [0.32, 0.8 * Math.max(1, w * 0.8), 0.32], rot: [0, 0, 90], shadow: true });
    // working glow
    const glow = shape(body, 'sphere', mat(PALETTE.coreGlow, { emissive: PALETTE.coreGlow, emissiveIntensity: 1.4 }), { pos: [0, 0.32, 0.72], scale: [0.6 * w, 0.08, 0.16] });
    return { root, body, canopy, tines, roller, seeds, glow, key: `${w}|${lv('cultSpeed') > 0}|${lv('cultSeed')}|${lv('cultRoute')}`, lastTrail: 0, dust: 0 };
  }

  /** Look 3.19: rebuild every tiller (the hand-built model has loaded); they're remade next frame. */
  rebuildAll() {
    for (const v of this.units.values()) v.root.destroy();
    this.units.clear();
  }

  update(dt: number) {
    this.time += dt;
    const s = this.sim;
    const seen = new Set<string>();
    const docks = s.cultivators.docks();
    for (const m of docks) {
      const units = m.cult?.units ?? [];
      units.forEach((u, i) => {
        const id = `${m.id}:${i}`;
        seen.add(id);
        const want = `${1 + (m.upg?.cultWidth ?? 0)}|${(m.upg?.cultSpeed ?? 0) > 0}|${m.upg?.cultSeed ?? 0}|${m.upg?.cultRoute ?? 0}`;
        let v = this.units.get(id);
        if (v && v.key !== want) {
          v.root.destroy();
          v = undefined;
        }
        if (!v) {
          v = this.build(m, i);
          this.units.set(id, v);
        }
        this.pose(v, m, u, dt);
      });
    }
    for (const [id, v] of this.units)
      if (!seen.has(id)) {
        v.root.destroy();
        this.units.delete(id);
      }
  }

  private pose(v: UnitView, m: MachineData, u: CultivatorUnit, dt: number) {
    const s = this.sim;
    const r = s.grid.roof(m.roofId);
    const y = (r ? r.origin[1] + r.height : 0) + 0.08;
    const ox = r ? r.origin[0] : 0;
    const oz = r ? r.origin[2] : 0;
    // ease the model toward the sim position (the sim moves in 0.1 s steps)
    const p = v.root.getLocalPosition();
    const tx = ox + u.px, tz = oz + u.pz;
    const k = Math.min(1, dt * 10);
    const nx = p.x === 0 && p.z === 0 ? tx : p.x + (tx - p.x) * k;
    const nz = p.x === 0 && p.z === 0 ? tz : p.z + (tz - p.z) * k;
    const working = u.work.length > 0 && !u.parked && Math.hypot(tx - nx, tz - nz) < 0.1 && s.grid.byTileId(u.work[0])?.ground !== 'restored';
    const t = this.time;
    const bob = this.reducedMotion ? 0 : working ? Math.sin(t * 14) * 0.012 : Math.sin(t * 3) * 0.006;
    v.root.setLocalPosition(nx, y + bob, nz);
    v.root.setLocalEulerAngles(0, (u.rot * 180) / Math.PI, 0);
    // tines spin and dig in while working
    const spin = working ? 900 : u.work.length ? 200 : 0;
    const e = v.tines.getLocalEulerAngles();
    v.tines.setLocalEulerAngles(this.reducedMotion ? 0 : e.x + spin * dt, 0, 0);
    if (v.tinesRest) v.tines.setLocalPosition(v.tinesRest.x, v.tinesRest.y - (working ? 0.06 : 0), v.tinesRest.z);
    else v.tines.setLocalPosition(0, working ? 0.12 : 0.18, 0.72);
    const re = v.roller.getLocalEulerAngles();
    v.roller.setLocalEulerAngles(this.reducedMotion ? 0 : re.x + (u.work.length ? 120 : 0) * dt, 0, v.tinesRest ? 0 : 90);
    // the canopy tracks the sun (a slow sweep standing in for the sun's path), independent of driving direction
    v.canopy.setLocalEulerAngles(18 + Math.sin(t * 0.05) * 6, -(u.rot * 180) / Math.PI + 35, 0);
    // the hopper empties as it sows (refills at the dock)
    const fill = 1 - ((m.cult?.done ?? 0) % 12) / 14;
    v.seeds.setLocalScale(1, Math.max(0.15, fill), 1);
    v.glow.enabled = working;
    // trail: soil and dust kicked up at the front, a seedling puff behind
    if (working && this.vfx && !this.reducedMotion && t - v.lastTrail > 0.35) {
      v.lastTrail = t;
      const fwd = new pc.Vec3(Math.sin(u.rot), 0, Math.cos(u.rot));
      this.vfx.burst(new pc.Vec3(nx + fwd.x * 0.32, y + 0.05, nz + fwd.z * 0.32), 3, { up: 0.8, speed: 0.6, size: 0.035, life: 0.5, hex: PALETTE.soil });
      if ((v.dust = (v.dust + 1) % 3) === 0) this.vfx.burst(new pc.Vec3(nx - fwd.x * 0.32, y + 0.04, nz - fwd.z * 0.32), 2, { up: 0.5, speed: 0.3, size: 0.03, life: 0.6, hex: PALETTE.leafFin });
    }
  }

  /** Where tiller `i` of a dock is drawn (screen hints, camera). */
  positionOf(machineId: string, i = 0): pc.Vec3 | undefined {
    return this.units.get(`${machineId}:${i}`)?.root.getPosition();
  }
}
