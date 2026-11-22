import * as pc from 'playcanvas';
import { BIRD_HEART } from '../data/birdHeart';
import { HeartFlight, type Box } from './HeartFlight';
import { PALETTE } from './Materials';
import { group } from './Shapes';

/** One bird: a root to place, and its two wings to flap (about its forward axis). */
export interface HeartBird {
  root: pc.Entity;
  wings: [pc.Entity, pc.Entity];
}

/** The camera the heart is laid out for: where a screen point lies at a depth, and which way it looks. */
export interface HeartCamera {
  screenToWorld(x: number, y: number, z: number, out?: pc.Vec3): pc.Vec3;
  readonly entity: { forward: pc.Vec3 };
}

/** sRGB hex as linear bytes (the vertex colours are linear, as the chunks' are). */
function linBytes(hex: string): [number, number, number] {
  const c = new pc.Color().fromString(hex);
  return [Math.round(Math.pow(c.r, 2.2) * 255), Math.round(Math.pow(c.g, 2.2) * 255), Math.round(Math.pow(c.b, 2.2) * 255)];
}

/** A flat-ish fan of triangles from (x, y, z) points with a colour each, as a mesh lit from above. */
function fanMesh(device: pc.GraphicsDevice, tris: { p: [number, number, number]; c: string }[][]): pc.Mesh {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  for (const t of tris)
    for (const v of t) {
      pos.push(...v.p);
      nrm.push(0, 1, 0);
      col.push(...linBytes(v.c), 255);
    }
  const m = new pc.Mesh(device);
  m.setPositions(pos);
  m.setNormals(nrm);
  m.setColors32(col);
  m.update();
  return m;
}

interface GullKit {
  body: pc.Mesh;
  wing: [pc.Mesh, pc.Mesh];
  mat: pc.StandardMaterial;
}
const KITS = new WeakMap<pc.GraphicsDevice, GullKit>();

/**
 * The heart gull, seen from above (its back is what the camera sees): a pale tapered body, and long swept wings, soft
 * grey inside and dark at the tips like a gull's, with a slight bend so they read as a gull's M. One wingspan across
 * (GULL_SPAN). Lit, with a strong glow of its own colour, so it stays pale against any sky, and drawn over the world.
 * Three meshes, all shared.
 */
function gullKit(device: pc.GraphicsDevice): GullKit {
  let k = KITS.get(device);
  if (k) return k;
  const G = PALETTE.fauna.heartGull;
  // body: an ellipse outline round a raised spine, nose at +z
  const rim: [number, number][] = [
    [0, 0.2],
    [0.05, 0.13],
    [0.07, 0.03],
    [0.055, -0.1],
    [0.03, -0.2],
    [0, -0.24],
    [-0.03, -0.2],
    [-0.055, -0.1],
    [-0.07, 0.03],
    [-0.05, 0.13],
  ];
  const body = fanMesh(
    device,
    rim.map((a, i) => {
      const b = rim[(i + 1) % rim.length];
      return [
        { p: [0, 0.04, 0], c: G.back },
        { p: [a[0], 0, a[1]], c: G.back },
        { p: [b[0], 0, b[1]], c: G.back },
      ];
    }),
  );
  // a wing from its root (x 0) out along +x: broad and swept back, bent up at the wrist, a dark tip
  const wingTris = (sd: number) => {
    const P = (x: number, y: number, z: number): [number, number, number] => [sd * x, y, z];
    const rootF = P(0, 0, 0.09);
    const rootB = P(0, 0, -0.08);
    const wristF = P(0.22, 0.045, 0.06);
    const wristB = P(0.24, 0.04, -0.07);
    const tip = P(0.47, -0.01, -0.12);
    return [
      [{ p: rootF, c: G.wing }, { p: wristF, c: G.wing }, { p: wristB, c: G.wing }],
      [{ p: rootF, c: G.wing }, { p: wristB, c: G.wing }, { p: rootB, c: G.wing }],
      [{ p: wristF, c: G.wing }, { p: tip, c: G.tip }, { p: wristB, c: G.tip }],
    ];
  };
  const mat = new pc.StandardMaterial();
  mat.diffuse = new pc.Color(1, 1, 1);
  mat.diffuseVertexColor = true;
  mat.emissive = new pc.Color(1, 1, 1);
  mat.emissiveVertexColor = true;
  mat.emissiveIntensity = BIRD_HEART.glow;
  mat.cull = pc.CULLFACE_NONE;
  mat.useFog = false;
  // the heart is drawn in the sky over everything (it sits in clear screen space, away from Bloombot and the HUD):
  // where it comes down over near ground, the ground would otherwise swallow the lower birds. Drawn in the
  // transparent pass, after the world, so nothing paints over it.
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.blendType = pc.BLEND_NORMAL;
  mat.opacity = 1;
  mat.update();
  k = { body, wing: [fanMesh(device, wingTris(-1)), fanMesh(device, wingTris(1))], mat };
  KITS.set(device, k);
  return k;
}

function gull(parent: pc.Entity, device: pc.GraphicsDevice): HeartBird {
  const kit = gullKit(device);
  const b = group(parent, 'heart-bird');
  b.addComponent('render', { meshInstances: [new pc.MeshInstance(kit.body, kit.mat)], castShadows: false, receiveShadows: false });
  const wings = [0, 1].map((i) => {
    const w = group(b, 'wing', [(i ? 1 : -1) * 0.05, 0.02, 0.01]);
    w.addComponent('render', { meshInstances: [new pc.MeshInstance(kit.wing[i], kit.mat)], castShadows: false, receiveShadows: false });
    return w;
  }) as [pc.Entity, pc.Entity];
  return { root: b, wings };
}
/** The gull's wingspan at scale 1 (wing roots at ±0.05, each wing 0.47 long). */
const GULL_SPAN = 1.04;

/**
 * #689 (E27.5): the Great Bloom's heart of birds. `play` builds the flock and starts the flight (HeartFlight works out
 * where each bird is on screen); `update` lays each bird out at that screen point a set depth in front of the camera,
 * facing its heading with its back to the camera (so its wings show), banked into its turns and flapping. When the
 * flight ends every bird is destroyed: nothing is left over between blooms. Playing again while it flies does nothing.
 */
export class BirdHeart {
  private root?: pc.Entity;
  private birds: HeartBird[] = [];
  private flight?: HeartFlight;
  private phase: number[] = [];
  private p = new pc.Vec3();
  private q = new pc.Vec3();
  private f = new pc.Vec3();
  private up = new pc.Vec3();
  private side = new pc.Vec3();
  private look = new pc.Vec3();

  private make: (parent: pc.Entity) => HeartBird;

  constructor(
    private parent: pc.Entity,
    device?: pc.GraphicsDevice,
    make?: (parent: pc.Entity) => HeartBird,
  ) {
    this.make = make ?? ((p) => gull(p, device!));
  }

  get active(): boolean {
    return !!this.flight;
  }

  /** Starts the flight on a screen `w` × `h` (CSS pixels), the heart in `box`. False if one is already flying. */
  play(w: number, h: number, box: Box, calm: boolean): boolean {
    if (this.flight) return false;
    this.flight = new HeartFlight(w, h, box, calm);
    this.root = group(this.parent, 'bird-heart');
    this.birds = this.flight.slots.map(() => this.make(this.root!));
    this.phase = this.birds.map((_, i) => i * 0.37);
    for (const b of this.birds) b.root.enabled = false;
    return true;
  }

  update(dt: number, cam: HeartCamera) {
    const fl = this.flight;
    if (!fl) return;
    fl.step(dt);
    if (fl.done) return this.stop();
    const D = BIRD_HEART.depth;
    // world units per screen pixel at the flock's depth, for its size
    const mid = fl.box.y + fl.box.h / 2;
    const perPx = cam.screenToWorld(fl.w / 2 + 50, mid, D, this.q).distance(cam.screenToWorld(fl.w / 2 - 50, mid, D, this.p)) / 100;
    const size = (fl.spanPx * perPx) / GULL_SPAN;
    // the birds' backs face the camera, tipped a little toward the sky, so the wings read as a V from the front
    this.up.copy(cam.entity.forward).mulScalar(-1).normalize();
    fl.poses.forEach((ps, i) => {
      const b = this.birds[i];
      b.root.enabled = ps.shown;
      if (!ps.shown) return;
      const P = cam.screenToWorld(ps.x, ps.y, D, this.p);
      const A = cam.screenToWorld(ps.x + Math.cos(ps.heading) * 10, ps.y + Math.sin(ps.heading) * 10, D, this.q);
      this.f.sub2(A, P).normalize();
      // roll the back's normal about the heading by the bank
      this.side.cross(this.f, this.up);
      const c = Math.cos(ps.bank);
      const s = Math.sin(ps.bank);
      this.side.mulScalar(s).add(this.look.copy(this.up).mulScalar(c));
      b.root.setPosition(P);
      // lookAt points −z at the target: aim it behind, so the gull's +z (its beak end) leads
      b.root.lookAt(this.look.copy(P).sub(this.f), this.side);
      b.root.setLocalScale(size * ps.scale, size * ps.scale, size * ps.scale);
      this.phase[i] += dt * ps.flap * Math.PI * 2;
      const flap = Math.sin(this.phase[i]) * (ps.flap > BIRD_HEART.flap.glide + 0.2 ? 34 : 12);
      b.wings[0].setLocalEulerAngles(0, 0, -flap);
      b.wings[1].setLocalEulerAngles(0, 0, flap);
    });
  }

  /** Ends the flight now and removes every bird. */
  stop() {
    this.root?.destroy();
    this.root = undefined;
    this.birds = [];
    this.phase = [];
    this.flight = undefined;
  }
}
