import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import { lowGeometry } from './Shapes';

/** A small deterministic generator, so atmosphere never disturbs Math.random sequences elsewhere. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Mote {
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  size: number;
  phase: number;
}

interface Shaft {
  x: number;
  z: number;
  width: number;
  length: number;
  age: number;
  life: number;
}

/**
 * Look 1.10: atmosphere over restored ground. Warm light motes and pollen drift slowly in the sunlit air, and a
 * few soft light shafts slant down along the sun. Both only appear above restored tiles near the camera's focus,
 * so the dead city stays clear and restoring an area fills it with light.
 *
 * Each is one instanced draw call (a per-instance matrix buffer rebuilt every frame on the CPU). Counts come from
 * the graphics tier; Low, `lowVfx` and reduced motion turn the motes off (they are pure motion), and reduced
 * motion freezes the shafts.
 */
export class Atmosphere {
  private motes: Mote[] = [];
  private shafts: Shaft[] = [];
  private moteMI: pc.MeshInstance;
  private shaftMI: pc.MeshInstance;
  private moteVB?: pc.VertexBuffer;
  private shaftVB?: pc.VertexBuffer;
  private moteData = new Float32Array(0);
  private shaftData = new Float32Array(0);
  private rand = rng(0x5017);
  private time = 0;
  reducedMotion = false;
  /** Whether a world tile is restored (motes and shafts only live above restored ground). */
  isLit: (x: number, z: number) => boolean = () => false;

  constructor(
    private device: pc.GraphicsDevice,
    parent: pc.Entity,
  ) {
    const moteMat = new pc.StandardMaterial();
    moteMat.useLighting = false;
    moteMat.diffuse = new pc.Color(0, 0, 0);
    moteMat.emissive = new pc.Color().fromString(LOOK.atmosphere.moteColor);
    moteMat.emissiveIntensity = LOOK.atmosphere.moteGlow;
    moteMat.blendType = pc.BLEND_ADDITIVE;
    moteMat.depthWrite = false;
    moteMat.update();
    const sphere = pc.Mesh.fromGeometry(device, lowGeometry('sphere'));
    this.moteMI = new pc.MeshInstance(sphere, moteMat);
    const shaftMat = new pc.StandardMaterial();
    shaftMat.useLighting = false;
    shaftMat.diffuse = new pc.Color(0, 0, 0);
    shaftMat.emissive = new pc.Color().fromString(LOOK.atmosphere.shaftColor);
    shaftMat.emissiveIntensity = LOOK.atmosphere.shaftGlow;
    shaftMat.opacityVertexColor = true;
    shaftMat.opacityVertexColorChannel = 'a';
    shaftMat.blendType = pc.BLEND_ADDITIVEALPHA;
    shaftMat.depthWrite = false;
    shaftMat.cull = pc.CULLFACE_NONE;
    shaftMat.useFog = true;
    shaftMat.update();
    this.shaftMI = new pc.MeshInstance(this.shaftMesh(), shaftMat);
    for (const [name, mi] of [['motes', this.moteMI], ['shafts', this.shaftMI]] as const) {
      const e = new pc.Entity(name);
      e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false });
      // Instances move every frame anywhere around the camera: skip culling the mesh's own bounds.
      mi.cull = false;
      parent.addChild(e);
    }
    this.setCounts(0, 0);
  }

  /** A unit card (x −0.5…0.5, y 0…1 toward the sun) whose vertex alpha fades to the edges and both ends. */
  private shaftMesh(): pc.Mesh {
    const xs = [-0.5, 0, 0.5];
    const ys = [0, 0.18, 0.6, 1];
    const fadeY = [0, 1, 0.7, 0];
    const pos: number[] = [];
    const col: number[] = [];
    for (let j = 0; j < ys.length; j++)
      for (let i = 0; i < xs.length; i++) {
        pos.push(xs[i], ys[j], 0);
        col.push(255, 255, 255, Math.round((i === 1 ? 1 : 0) * fadeY[j] * 255));
      }
    const idx: number[] = [];
    for (let j = 0; j < ys.length - 1; j++)
      for (let i = 0; i < xs.length - 1; i++) {
        const a = j * xs.length + i;
        idx.push(a, a + 1, a + xs.length, a + 1, a + xs.length + 1, a + xs.length);
      }
    const m = new pc.Mesh(this.device);
    m.setPositions(pos);
    // the shader asks for normals even unlit (a console error every frame without them): flat, facing the card
    m.setNormals(pos.map((_, i) => (i % 3 === 2 ? 1 : 0)));
    m.setColors32(col);
    m.setIndices(idx);
    m.update(pc.PRIMITIVE_TRIANGLES);
    return m;
  }

  /** Sets how many motes and shafts exist (0 hides them; their draw calls go away). */
  setCounts(motes: number, shafts: number) {
    const fmt = pc.VertexFormat.getDefaultInstancingFormat(this.device);
    if (motes !== this.motes.length) {
      this.motes = [];
      for (let i = 0; i < motes; i++) this.motes.push({ x: 0, y: -99, z: 0, age: 1, life: 0, size: 0, phase: this.rand() * 6.28 });
      this.moteVB?.destroy();
      this.moteVB = motes ? new pc.VertexBuffer(this.device, fmt, motes, { usage: pc.BUFFER_DYNAMIC }) : undefined;
      this.moteData = new Float32Array(motes * 16);
      this.moteMI.setInstancing(this.moteVB ?? null);
      this.moteMI.instancingCount = motes;
    }
    if (shafts !== this.shafts.length) {
      this.shafts = [];
      for (let i = 0; i < shafts; i++) this.shafts.push({ x: 0, z: 0, width: 0, length: 0, age: 1, life: 0 });
      this.shaftVB?.destroy();
      this.shaftVB = shafts ? new pc.VertexBuffer(this.device, fmt, shafts, { usage: pc.BUFFER_DYNAMIC }) : undefined;
      this.shaftData = new Float32Array(shafts * 16);
      this.shaftMI.setInstancing(this.shaftVB ?? null);
      this.shaftMI.instancingCount = shafts;
    }
    this.moteMI.visible = motes > 0;
    this.shaftMI.visible = shafts > 0;
  }

  /** A random restored spot near the focus, or undefined after a few misses (nothing restored nearby). */
  private spot(cx: number, cz: number, radius: number): [number, number] | undefined {
    for (let k = 0; k < 6; k++) {
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * radius;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (this.isLit(Math.floor(x), Math.floor(z))) return [x, z];
    }
    return undefined;
  }

  /**
   * @param focus the camera's goal point
   * @param radius how far around the focus to fill (world units)
   * @param toSun unit vector toward the sun
   * @param viewDir the camera's forward vector
   */
  update(dt: number, focus: pc.Vec3, radius: number, toSun: pc.Vec3, viewDir: pc.Vec3) {
    this.time += dt;
    const A = LOOK.atmosphere;
    const t = this.time;
    // Motes: drift on slow, smooth noise, rise a little, fade in and out over a few seconds, then respawn.
    const md = this.moteData;
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      m.age += dt;
      if (m.age >= m.life || Math.hypot(m.x - focus.x, m.z - focus.z) > radius * 1.3) {
        const s = this.spot(focus.x, focus.z, radius);
        m.age = 0;
        m.life = 4 + this.rand() * 6;
        if (s) {
          m.x = s[0];
          m.z = s[1];
          m.y = 0.25 + this.rand() * 2.2;
          m.size = (0.6 + this.rand() * 0.8) * A.moteSize;
        } else m.size = 0;
      }
      m.x += Math.sin(t * 0.37 + m.phase) * 0.12 * dt;
      m.z += Math.cos(t * 0.29 + m.phase * 1.3) * 0.12 * dt;
      m.y += (0.05 + Math.sin(t * 0.8 + m.phase) * 0.06) * dt;
      const k = Math.min(1, m.age / 1.2, (m.life - m.age) / 1.2);
      const s = m.size * Math.max(0, k) * (0.8 + 0.2 * Math.sin(t * 3 + m.phase * 2));
      const o = i * 16;
      md.fill(0, o, o + 16);
      md[o] = s;
      md[o + 5] = s;
      md[o + 10] = s;
      md[o + 12] = m.x;
      md[o + 13] = m.y;
      md[o + 14] = m.z;
      md[o + 15] = 1;
    }
    if (this.moteVB && this.motes.length) this.moteVB.setData(md);

    // Shafts: cards slanting toward the sun from restored ground, turned about their own axis to face the camera.
    // They breathe slowly in and out; seen along the light they would read as smears, so they fade there.
    const sd = this.shaftData;
    const across = 1 - Math.abs(toSun.dot(viewDir));
    const ax = new pc.Vec3();
    const az = new pc.Vec3();
    for (let i = 0; i < this.shafts.length; i++) {
      const sh = this.shafts[i];
      if (!this.reducedMotion) sh.age += dt;
      if (sh.age >= sh.life || Math.hypot(sh.x - focus.x, sh.z - focus.z) > radius * 1.2) {
        const s = this.spot(focus.x, focus.z, radius * 0.8);
        sh.age = this.reducedMotion ? sh.life * 0.5 : 0;
        sh.life = 9 + this.rand() * 8;
        if (s) {
          sh.x = s[0];
          sh.z = s[1];
          sh.width = A.shaftWidth * (0.6 + this.rand() * 0.8);
          sh.length = A.shaftLength * (0.7 + this.rand() * 0.6);
        } else sh.width = 0;
        if (this.reducedMotion) sh.age = sh.life * 0.5;
      }
      const k = Math.sin(Math.min(1, Math.max(0, sh.age / sh.life)) * Math.PI);
      const w = sh.width * (0.3 + 0.7 * across) * k;
      // Basis: Y toward the sun, X across the view, Z completing it.
      ax.cross(toSun, viewDir);
      if (ax.lengthSq() < 1e-6) ax.set(1, 0, 0);
      ax.normalize();
      az.cross(ax, toSun).normalize();
      const o = i * 16;
      sd[o] = ax.x * w;
      sd[o + 1] = ax.y * w;
      sd[o + 2] = ax.z * w;
      sd[o + 3] = 0;
      sd[o + 4] = toSun.x * sh.length;
      sd[o + 5] = toSun.y * sh.length;
      sd[o + 6] = toSun.z * sh.length;
      sd[o + 7] = 0;
      sd[o + 8] = az.x;
      sd[o + 9] = az.y;
      sd[o + 10] = az.z;
      sd[o + 11] = 0;
      sd[o + 12] = sh.x;
      sd[o + 13] = 0.05;
      sd[o + 14] = sh.z;
      sd[o + 15] = 1;
    }
    if (this.shaftVB && this.shafts.length) this.shaftVB.setData(sd);
  }
}
