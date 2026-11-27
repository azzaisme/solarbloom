import * as pc from 'playcanvas';
import { SLAB_TOP } from '../core/Picking';
import type { Decoration } from '../core/Decor';
import { HOUSE_INSIDE } from '../data/oldcity';
import type { Sim } from '../gameplay/Sim';
import { MeshBuilder } from './ChunkRenderer';
import { drawDecor } from './DecorArt';
import { decorSize } from '../data/cozy';
import { FoliageBuilder, foliageMaterial } from './Foliage';
import { ceilingBeams, drawCeilingBeam, drawInnerWall, drawInnerWallCap, drawRoom, INNER_WALL, innerWallPieces, wallSinks, type HouseSink, type InnerWallPiece } from './HouseArt';
import { HouseTexBuilder, houseTexMaterial } from './HouseTex';
import { color, PALETTE } from './Materials';
import { MODELS, ModelBatch } from './Models';
import { vertexColourMaterial } from './Shapes';
import type { Lod, TreeGeo } from './TreeGen';
import type { VPrim } from './Shapes';

/**
 * #782: the inside of Bloombot's house, drawn where its layer stands (high over the park, out of sight from outside)
 * and shown only while Bloombot is in it: the room of its level, its furniture, the keepsakes on the shelf, the
 * decorations placed inside, and a warm lamp that lights it day and night. Rebuilt only when one of those changes.
 */
export class HouseInterior {
  private root: pc.Entity;
  private parts: pc.Entity[] = [];
  private buffers: pc.VertexBuffer[] = [];
  private lamp: pc.Entity;
  /** #860: a light of its own in each room beyond the main one (the kitchen, the bedroom), so its walls aren't dark */
  private roomLamps: pc.Entity[] = [];
  private key = '';
  /** #860: the inner walls' stretches, each its own entity so it can sink for the camera */
  private walls: { piece: InnerWallPiece; body: pc.Entity; cap?: pc.Entity; h: number }[] = [];
  private lastT = 0;

  constructor(
    private sim: Sim,
    parent: pc.Entity,
    private device: pc.GraphicsDevice,
    /** the decorations placed inside (the game's Cozy) */
    private decor: () => Decoration[],
    /** keepsakes found so far (they stand on the shelf) */
    private keepsakes: () => number,
  ) {
    this.root = new pc.Entity('house-inside');
    this.root.enabled = false;
    parent.addChild(this.root);
    this.lamp = new pc.Entity('house-lamp');
    this.lamp.addComponent('light', { type: 'omni', color: color(PALETTE.house.lamp), intensity: 1.4, range: 9, castShadows: false });
    this.root.addChild(this.lamp);
  }

  get visible(): boolean {
    return this.root.enabled;
  }

  /**
   * Shows the room (rebuilt first when something in it changed) or hides it. #860: `view` (Bloombot's spot in the
   * room's cells and the camera's in the world) sinks each inner wall standing between them.
   */
  update(show: boolean, view?: { bot: { x: number; z: number }; cam: pc.Vec3 }) {
    const h = this.sim.house;
    if (!show || !h.hasInside()) {
      this.root.enabled = false;
      return;
    }
    const decor = this.decor();
    const key = `${h.level}|${this.keepsakes()}|${decor.map((d) => `${d.key}:${d.kind}:${d.rot}`).join(',')}|${MODELS ? 1 : 0}`;
    if (key !== this.key) this.rebuild(decor, key);
    this.root.enabled = true;
    this.sinkWalls(view);
  }

  /** #860: each inner wall eases toward its height: low while it stands between the camera and Bloombot, else tall. */
  private sinkWalls(view?: { bot: { x: number; z: number }; cam: pc.Vec3 }) {
    const now = performance.now();
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 1;
    this.lastT = now;
    const [ox, , oz] = HOUSE_INSIDE.origin;
    const y = this.floorY();
    const k = 1 - Math.exp(-10 * dt);
    for (const w of this.walls) {
      const low = !!view && wallSinks(w.piece, [view.bot.x, view.bot.z], [view.cam.x - ox, view.cam.z - oz]);
      const goal = low ? INNER_WALL.low : HOUSE_INSIDE.wall;
      w.h += (goal - w.h) * k;
      if (Math.abs(goal - w.h) < 0.002) w.h = goal;
      if (w.piece.lintel || w.piece.beam) {
        w.body.enabled = w.h > INNER_WALL.doorTop + 0.05;
        continue;
      }
      w.body.setLocalScale(1, w.h, 1);
      w.cap?.setLocalPosition(0, y + w.h, 0);
    }
  }

  /** #860: each stretch of inner wall now: where it stands (cells) and how tall it is (tests and the review). */
  wallsNow(): { line: [number, number, number, number]; h: number }[] {
    return this.walls.filter((w) => !w.piece.lintel && !w.piece.beam).map((w) => ({ line: w.piece.line, h: w.h }));
  }

  /** #860: is a stretch of inner wall standing tall now (for tests and the review)? */
  wallHeights(): number[] {
    return this.walls.filter((w) => !w.piece.lintel && !w.piece.beam).map((w) => w.h);
  }

  /** #861: is each ceiling beam shown now (for tests and the review)? */
  beamsShown(): boolean[] {
    return this.walls.filter((w) => w.piece.beam).map((w) => w.body.enabled);
  }

  /** The floor's top in the world (where Bloombot's feet and the decorations stand). */
  floorY(): number {
    return HOUSE_INSIDE.origin[1] + HOUSE_INSIDE.height + SLAB_TOP;
  }

  private rebuild(decor: Decoration[], key: string) {
    for (const e of this.parts) e.destroy();
    for (const vb of this.buffers) vb.destroy();
    this.parts = [];
    this.buffers = [];
    this.walls = [];
    this.key = key;
    const h = this.sim.house;
    const room = h.room();
    const [ox, , oz] = HOUSE_INSIDE.origin;
    const y = this.floorY();
    const b = new MeshBuilder();
    const tb = new HouseTexBuilder();
    drawRoom(sinkOf(b, tb), {
      origin: [ox, y, oz],
      room,
      wall: HOUSE_INSIDE.wall,
      level: h.level,
      door: h.doorInside(),
      furniture: h.furniture(),
      walls: h.walls(),
      rooms: h.rooms(),
      keepsakes: this.keepsakes(),
      variant: (x, z) => this.sim.grid.get(h.layerId, x, z)?.variant ?? x * 7 + z,
    });
    const fb = new FoliageBuilder();
    const batch = MODELS ? new ModelBatch(MODELS, false) : undefined;
    const host = {
      add: (type: VPrim, hex: string, p: [number, number, number], sc: [number, number, number] | number, glow?: number) => b.add(type, hex, p, sc, glow),
      foliage: (g: TreeGeo, x: number, yy: number, z: number, rot: number, scale: number) => fb.add(g, x, yy, z, rot, scale),
      model: (name: string, x: number, yy: number, z: number, rot: number, sc: number) => !!batch?.add(name, x, yy, z, rot, sc),
      lod: 2 as Lod,
    };
    // #849: a big piece about the middle of its footprint; the seed keeps each houseplant its own
    for (const d of decor) {
      const [w, dd] = decorSize(d.kind, d.rot);
      drawDecor(host, d.kind, ox + d.x + w / 2, y, oz + d.z + dd / 2, d.rot, false, d.x * 31 + d.z);
    }
    const mesh = (name: string, m: pc.Mesh | undefined, material: pc.Material, tex?: HouseTexBuilder) => {
      // #861: with the painted pieces (wood, weave, coir) drawn in the same entity, each texture its own mesh
      const list = m ? [new pc.MeshInstance(m, material)] : [];
      for (const t of tex?.build(this.device) ?? []) list.push(new pc.MeshInstance(t.mesh, houseTexMaterial(this.device, t.name)));
      if (!list.length) return undefined;
      const e = new pc.Entity(name);
      e.addComponent('render', { meshInstances: list, castShadows: false, receiveShadows: true });
      this.root.addChild(e);
      this.parts.push(e);
      return e;
    };
    mesh('house-room', b.build(this.device), vertexColourMaterial(), tb);
    // #860: each stretch of inner wall its own entity: drawn a unit high and stretched to its height each frame
    for (const w of h.walls())
      for (const piece of innerWallPieces(w)) {
        const wb = new MeshBuilder();
        const wt = new HouseTexBuilder();
        drawInnerWall(sinkOf(wb, wt), piece, [ox, piece.lintel ? y : 0, oz]);
        const body = mesh('house-wall', wb.build(this.device), vertexColourMaterial(), wt);
        if (!body) continue;
        if (!piece.lintel) body.setLocalPosition(0, y, 0);
        let cap: pc.Entity | undefined;
        if (!piece.lintel) {
          const cb = new MeshBuilder();
          const ct = new HouseTexBuilder();
          drawInnerWallCap(sinkOf(cb, ct), piece, [ox, 0, oz]);
          cap = mesh('house-wall-cap', cb.build(this.device), vertexColourMaterial(), ct);
        }
        this.walls.push({ piece, body, cap, h: HOUSE_INSIDE.wall });
      }
    // #861: the ceiling's beams, each its own entity so one between the camera and Bloombot can go out of sight
    for (const piece of ceilingBeams(h.level, room)) {
      const bb = new MeshBuilder();
      const bt = new HouseTexBuilder();
      drawCeilingBeam(sinkOf(bb, bt), piece, [ox, y, oz]);
      const body = mesh('house-beam', bb.build(this.device), vertexColourMaterial(), bt);
      if (body) this.walls.push({ piece, body, h: HOUSE_INSIDE.wall });
    }
    mesh('house-plants', fb.build(this.device), foliageMaterial());
    if (batch?.count) {
      const bounds = new pc.BoundingBox(new pc.Vec3(ox + room / 2, y + 1, oz + room / 2), new pc.Vec3(room / 2 + 1, 2, room / 2 + 1));
      const { entity, buffers } = batch.build(this.device, bounds, false);
      if (entity) {
        this.root.addChild(entity);
        this.parts.push(entity);
      }
      this.buffers = buffers;
    }
    this.lamp.setPosition(ox + room / 2, y + HOUSE_INSIDE.wall - 0.4, oz + room / 2);
    this.lamp.light!.range = room * 1.1;
    const extra = h.rooms().slice(1);
    while (this.roomLamps.length < extra.length) {
      const e = new pc.Entity('house-room-lamp');
      e.addComponent('light', { type: 'omni', color: color(PALETTE.house.lamp), intensity: 1.1, range: 6, castShadows: false });
      this.root.addChild(e);
      this.roomLamps.push(e);
    }
    this.roomLamps.forEach((e, i) => {
      const r = extra[i];
      e.enabled = !!r;
      if (!r) return;
      e.setPosition(ox + r.x + r.w / 2, y + HOUSE_INSIDE.wall - 0.4, oz + r.z + r.d / 2);
      e.light!.range = Math.max(r.w, r.d) * 1.3;
    });
    this.lastT = 0; // the next update puts each wall straight at its height (no wall pops up and sinks again)
  }
}

/** #861: a sink drawing plain pieces into the vertex-coloured mesh and painted ones (wood, weave, coir) apart. */
function sinkOf(b: MeshBuilder, t: HouseTexBuilder): HouseSink {
  return {
    add: (type, hex, p, s, glow) => b.add(type, hex, p, s, glow),
    tri: (hex, a, c, d, n) => b.tri(hex, a, c, d, n),
    tex: (name, hex, p, s) => t.box(name, hex, p, s),
  };
}
