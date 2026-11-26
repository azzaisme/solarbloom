import * as pc from 'playcanvas';
import { SLAB_TOP } from '../core/Picking';
import type { Decoration } from '../core/Decor';
import { HOUSE_INSIDE } from '../data/oldcity';
import type { Sim } from '../gameplay/Sim';
import { MeshBuilder } from './ChunkRenderer';
import { drawDecor } from './DecorArt';
import { FoliageBuilder, foliageMaterial } from './Foliage';
import { drawRoom } from './HouseArt';
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
  private key = '';

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

  /** Shows the room (rebuilt first when something in it changed) or hides it. */
  update(show: boolean) {
    const h = this.sim.house;
    if (!show || !h.hasInside()) {
      this.root.enabled = false;
      return;
    }
    const decor = this.decor();
    const key = `${h.level}|${this.keepsakes()}|${decor.map((d) => `${d.key}:${d.kind}:${d.rot}`).join(',')}|${MODELS ? 1 : 0}`;
    if (key !== this.key) this.rebuild(decor, key);
    this.root.enabled = true;
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
    this.key = key;
    const h = this.sim.house;
    const room = h.room();
    const [ox, , oz] = HOUSE_INSIDE.origin;
    const y = this.floorY();
    const b = new MeshBuilder();
    drawRoom(b, {
      origin: [ox, y, oz],
      room,
      wall: HOUSE_INSIDE.wall,
      level: h.level,
      door: h.doorInside(),
      furniture: h.furniture(),
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
    for (const d of decor) drawDecor(host, d.kind, ox + d.x + 0.5, y, oz + d.z + 0.5, d.rot, false);
    const mesh = (name: string, m: pc.Mesh | undefined, material: pc.Material) => {
      if (!m) return;
      const e = new pc.Entity(name);
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(m, material)], castShadows: false, receiveShadows: true });
      this.root.addChild(e);
      this.parts.push(e);
    };
    mesh('house-room', b.build(this.device), vertexColourMaterial());
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
  }
}
