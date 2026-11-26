import * as pc from 'playcanvas';
import { GROUND } from '../core/GameState';
import type { MachineData } from '../core/types';
import { gameSecondsOf } from '../gameplay/Clock';
import { DAY_SECONDS } from '../data/time';
import { giantStands } from '../gameplay/TreeGrowth';
import type { Sim } from '../gameplay/Sim';
import type { CameraBlockers } from './CameraController';
import { FoliageBuilder, foliageMaterial } from './Foliage';
import { giantBounds, giantGeo, type GiantGeo, type GiantStage } from './GiantTreeGen';
import { GIANT, TREE_GROWTH, ageStage, giantCells, giantsWithin, treeWorldOf } from './TreePlacement';

/** A planted giant's size by its growth stage (sapling … grown): it grows from a young tree, unlike a world giant. */
export const PLANTED_SCALE = [0.22, 0.45, 0.75, 1] as const;
/** A giant this small (canopy underside below this, world units) is a tree the camera goes over, like any other. */
const CEILING_FROM = 3.5;
/** Past its leaves' reach, the ceiling rises this steeply (so it has no edge to pop over). */
const CEILING_SLOPE = 1.2;
/** Giants drawn within this distance of the view's focus; full detail within `NEAR`. */
const RANGE = 72;
const NEAR = 30;

/** One giant in the world, as drawn and as the camera needs it. */
export interface GiantInfo {
  key: string;
  x: number;
  z: number;
  /** ground under the trunk (world y) */
  y: number;
  variant: number;
  rot: number;
  /** 1 for a world giant; a planted one grows into it */
  scale: number;
  /** leaves shown (0 bare) */
  leaves: GiantStage;
  /** trunk radius at the foot (world units) */
  trunkR: number;
  /** the canopy's underside (world y) and reach (from the trunk) */
  underside: number;
  reach: number;
  /** when (game seconds) it next grows */
  next?: number;
}

interface View {
  info: GiantInfo;
  entity: pc.Entity;
  geo: GiantGeo;
  lod: 0 | 1;
  /** a planted giant growing to its next size: from, to, and when (sim time) */
  grow?: { from: number; to: number; t0: number };
  shown: number;
}

const meshes = new Map<GiantGeo, pc.Mesh>();
/** A giant's mesh: never fades near the camera or under the cursor (the camera goes under it on purpose). */
function giantMesh(device: pc.GraphicsDevice, g: GiantGeo): pc.Mesh {
  let m = meshes.get(g);
  if (!m) {
    const b = new FoliageBuilder();
    b.add(g, 0, 0, 0, 0, 1, false);
    m = b.build(device)!;
    m.incRefCount();
    meshes.set(g, m);
  }
  return m;
}

/** How far a planted giant has grown (game seconds since planting): its size, and the leaves it shows. */
export function plantedGrowth(m: Pick<MachineData, 'plantedAt'>, now: number, bloom: number): { stage: 1 | 2 | 3 | 4; scale: number; leaves: GiantStage; next?: number } {
  const age = now - (m.plantedAt ?? -Infinity);
  const stage = ageStage(age, true);
  // grown leaves from the third stage; Radiant only where its ground is in full bloom (as a world giant)
  const leaves = (stage >= 3 ? (stage === 4 && bloom >= 4 ? 4 : 3) : stage) as GiantStage;
  const next = stage < 4 && m.plantedAt !== undefined ? m.plantedAt + TREE_GROWTH.giantDays[stage] * DAY_SECONDS : undefined;
  return { stage, scale: PLANTED_SCALE[stage - 1], leaves, next };
}

/**
 * Giant trees on screen (see TreePlacement GIANT): the woodland's own giants and the ones the player planted. Each
 * is its own entity (a canopy spans several chunks), swaps in its next stage as it leafs out, and a planted one grows
 * from a young tree to full size over game days, easing into each size on screen. It also tells the follow camera
 * where the trunks and canopies are (`blockers`), so the camera slides round a trunk and stays under the leaves.
 */
export class GiantTrees {
  private views = new Map<string, View>();
  private scanAt = -Infinity;
  /** giants near the focus, for the camera (refreshed with the views) */
  active: GiantInfo[] = [];

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private device: pc.GraphicsDevice,
    private groundY: (x: number, z: number) => number,
  ) {}

  /** What the follow camera keeps clear of. */
  readonly blockers: CameraBlockers = {
    trunks: (x, z, r) => this.active.filter((g) => Math.hypot(g.x - x, g.z - z) <= r + g.trunkR),
    ceiling: (x, z) => {
      let c = Infinity;
      for (const g of this.active) {
        if (g.underside - g.y < CEILING_FROM) continue;
        const d = Math.hypot(g.x - x, g.z - z);
        c = Math.min(c, g.underside + Math.max(0, d - g.reach) * CEILING_SLOPE);
      }
      return c;
    },
  };

  /** The giants within `r` of (x, z) as they are now (world and planted), in a stable order. */
  find(x: number, z: number, r: number): GiantInfo[] {
    const s = this.sim;
    const now = gameSecondsOf(s.state);
    const out: GiantInfo[] = [];
    for (const g of giantsWithin(treeWorldOf(s), x, z, r)) {
      if (s.areas.fog(s.areas.map.areaOfCell(g.gx, g.gz)) === 'hidden' || !giantStands(s, g)) continue;
      const grow = s.trees.giant(g);
      const b = giantBounds(g.variant);
      const y = this.groundY(g.gx + 0.5, g.gz + 0.5);
      out.push({ key: `w${g.gx},${g.gz}`, x: g.x, z: g.z, y, variant: g.variant, rot: g.rot, scale: 1, leaves: grow.stage, trunkR: GIANT.trunkR, underside: y + b.underside, reach: b.reach, next: grow.next });
    }
    for (const m of s.state.machines) {
      if (m.type !== 'giantTree' || m.roofId !== GROUND || Math.hypot(m.x + 1 - x, m.z + 1 - z) > r) continue;
      const bloom = Math.max(0, ...giantCells({ gx: m.x, gz: m.z }).map(([cx, cz]) => s.grid.peek(GROUND, cx, cz)?.bloom ?? 0));
      const p = plantedGrowth(m, now, bloom);
      const variant = Math.abs(m.x * 7 + m.z * 13) % 6;
      const b = giantBounds(variant);
      const y = this.groundY(m.x + 0.5, m.z + 0.5);
      out.push({ key: `m${m.id}`, x: m.x + 1, z: m.z + 1, y, variant, rot: ((m.x * 31 + m.z * 17) % 628) / 100, scale: p.scale, leaves: p.leaves, trunkR: GIANT.trunkR * p.scale, underside: y + b.underside * p.scale, reach: b.reach * p.scale, next: p.next });
    }
    return out;
  }

  /** Refreshes which giants are drawn (twice a second) and eases planted ones into their new size. */
  update(focus: { x: number; z: number }, cam: pc.Vec3, reducedMotion = false) {
    const t = this.sim.time;
    if (t >= this.scanAt + 0.5 || t < this.scanAt) {
      this.scanAt = t;
      const found = this.find(focus.x, focus.z, RANGE);
      const keep = new Set<string>();
      for (const g of found) {
        keep.add(g.key);
        this.place(g, cam);
      }
      for (const [k, v] of this.views)
        if (!keep.has(k)) {
          v.entity.destroy();
          this.views.delete(k);
        }
    }
    const active: GiantInfo[] = [];
    for (const v of this.views.values()) {
      if (v.grow) {
        const k = reducedMotion ? 1 : Math.min(1, (t - v.grow.t0) / TREE_GROWTH.morph);
        const e = k * k * (3 - 2 * k);
        v.shown = v.grow.from + (v.grow.to - v.grow.from) * e;
        if (k >= 1) v.grow = undefined;
        v.entity.setLocalScale(v.shown, v.shown, v.shown);
      }
      // the camera keeps to the size on screen
      const k = v.shown / v.info.scale;
      active.push(k === 1 ? v.info : { ...v.info, scale: v.shown, trunkR: v.info.trunkR * k, underside: v.info.y + (v.info.underside - v.info.y) * k, reach: v.info.reach * k });
    }
    this.active = active;
  }

  private place(g: GiantInfo, cam: pc.Vec3) {
    const lod: 0 | 1 = Math.hypot(cam.x - g.x, cam.z - g.z) < NEAR ? 1 : 0;
    let v = this.views.get(g.key);
    const geo = giantGeo(g.leaves, g.variant, lod);
    if (!v) {
      const entity = new pc.Entity(`giant-${g.key}`);
      entity.addComponent('render', { meshInstances: [new pc.MeshInstance(giantMesh(this.device, geo), foliageMaterial())], castShadows: true, receiveShadows: true });
      entity.setLocalEulerAngles(0, (g.rot * 180) / Math.PI, 0);
      entity.setLocalScale(g.scale, g.scale, g.scale);
      this.parent.addChild(entity);
      v = { info: g, entity, geo, lod, shown: g.scale };
      this.views.set(g.key, v);
    } else {
      if (geo !== v.geo) {
        v.entity.render!.meshInstances = [new pc.MeshInstance(giantMesh(this.device, geo), foliageMaterial())];
        v.geo = geo;
      }
      // a planted giant that just grew eases into its new size
      if (g.scale !== v.info.scale) v.grow = { from: v.shown, to: g.scale, t0: this.sim.time };
      v.info = g;
      v.lod = lod;
    }
    v.entity.setPosition(g.x, g.y, g.z);
  }

  /** Drops every view (world reset). */
  clear() {
    for (const v of this.views.values()) v.entity.destroy();
    this.views.clear();
    this.active = [];
    this.scanAt = -Infinity;
  }
}
