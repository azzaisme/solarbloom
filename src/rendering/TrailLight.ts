import * as pc from 'playcanvas';
import { WAYMARK } from '../data/waymark';
import { PALETTE } from './Palette';
import { group } from './Shapes';
import { glowMaterial } from './TileFx';
import { smooth } from './TrailLeaf';

export interface LightPoint {
  x: number;
  y: number;
  z: number;
  s: number;
  heading: number;
}

const ROW = [
  { width: -1, alpha: 0, color: PALETTE.signal.trailAura },
  { width: -0.38, alpha: 0.26, color: PALETTE.signal.trailAura },
  { width: -0.11, alpha: 0.73, color: PALETTE.signal.trailThread },
  { width: 0, alpha: 0.92, color: PALETTE.signal.trailHeart },
  { width: 0.11, alpha: 0.73, color: PALETTE.signal.trailThread },
  { width: 0.38, alpha: 0.26, color: PALETTE.signal.trailAura },
  { width: 1, alpha: 0, color: PALETTE.signal.trailAura },
].map(row => ({ ...row, rgb: rgb(row.color) }));

const SPARKS = 72;
const SPARK_VERTICES = 17;
const SPARK_COLORS = [PALETTE.signal.trailHeart, PALETTE.signal.trailThread, PALETTE.signal.trailSpark].map(rgb);
const STAR = Array.from({ length: 8 }, (_, i) => {
  const a = i * Math.PI / 4;
  const radius = i % 2 ? 0.30 : 1;
  return { x: Math.cos(a), y: Math.sin(a), radius };
});

function rgb(hex: string) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

/** One depth-tested mesh for the light ribbon, moving beads and little star-shaped glints. */
export class TrailLight {
  private root: pc.Entity;
  private material = glowMaterial(PALETTE.pure.white, 1.85);
  private mesh?: pc.Mesh;
  private points: readonly LightPoint[] = [];
  private positions = new Float32Array(0);
  private colors = new Uint8Array(0);
  private cameraRight = new pc.Vec3();
  private cameraUp = new pc.Vec3();

  constructor(parent: pc.Entity) {
    this.root = group(parent, 'trail-light');
  }

  show(points: readonly LightPoint[]) {
    this.clear();
    if (points.length < 2) return;
    this.points = points;
    const ribbonVertices = points.length * ROW.length;
    this.positions = new Float32Array((ribbonVertices + SPARKS * SPARK_VERTICES) * 3);
    this.colors = new Uint8Array((ribbonVertices + SPARKS * SPARK_VERTICES) * 4);
    const indices: number[] = [];
    for (let i = 0; i < points.length; i++) {
      for (let j = 0; j < ROW.length; j++) {
        const a = i * ROW.length + j;
        this.colors.set(ROW[j].rgb, a * 4);
        if (i && j) {
          const b = a - ROW.length;
          indices.push(b - 1, b, a - 1, a - 1, b, a);
        }
      }
    }
    for (let i = 0; i < SPARKS; i++) {
      const base = ribbonVertices + i * SPARK_VERTICES;
      for (let j = 0; j < SPARK_VERTICES; j++) this.colors.set(SPARK_COLORS[i % SPARK_COLORS.length], (base + j) * 4);
      for (let j = 0; j < STAR.length; j++) {
        const a = base + 1 + j, b = base + 1 + ((j + 1) % STAR.length);
        indices.push(base, a, b, a, a + STAR.length, b, b, a + STAR.length, b + STAR.length);
      }
    }
    const mesh = new pc.Mesh(pc.AppBase.getApplication()!.graphicsDevice);
    mesh.setPositions(this.positions);
    mesh.setColors32(this.colors);
    mesh.setIndices(indices);
    mesh.update();
    this.mesh = mesh;
    this.root.addComponent('render', {
      meshInstances: [new pc.MeshInstance(mesh, this.material)],
      castShadows: false, receiveShadows: false,
    });
  }

  clear() {
    if (this.root.render) this.root.removeComponent('render');
    this.mesh?.destroy();
    this.mesh = undefined;
    this.points = [];
  }

  update(age: number, progress: number, revealSpeed: number, fade: number, reduced: boolean, camera?: pc.Vec3) {
    if (!this.mesh) return;
    const start = this.points[0].s;
    const end = this.points[this.points.length - 1].s;
    const front = reduced ? end + 1 : age * revealSpeed;
    const base = Math.max(start, progress - 0.4);
    const visibleSpan = Math.max(0, Math.min(16, end - base, front - base));
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const tx = Math.sin(p.heading), tz = Math.cos(p.heading);
      // Cross the local route tangent with the view ray so the ribbon keeps a readable width through turns.
      const dx = (camera?.x ?? p.x) - p.x, dy = (camera?.y ?? p.y + 1) - p.y, dz = (camera?.z ?? p.z - 1) - p.z;
      const sx = -tz * dy, sy = tz * dx - tx * dz, sz = tx * dy;
      const magnitude = Math.hypot(sx, sy, sz);
      const width = 0.14 + (reduced ? 0 : 0.018 * Math.sin(p.s * 2.5 - age * 1.7));
      const light = smooth((p.s - progress + 0.32) / 0.95) * smooth((front - p.s) / 0.5) *
        smooth((end - p.s) / 0.55) * (1 - fade);
      const crest = reduced ? 1 : 0.78 + 0.22 * Math.pow(0.5 + 0.5 * Math.cos(p.s * 2.8 - age * 3.4), 5);
      for (let j = 0; j < ROW.length; j++) {
        const row = ROW[j];
        const offset = magnitude > 0.0001 ? width * row.width / magnitude : 0;
        this.write(i * ROW.length + j, p.x + sx * offset, p.y + sy * offset, p.z + sz * offset, row.alpha * light * crest);
      }
    }
    this.sparkles(age, base, visibleSpan, reduced ? 0 : 1 - fade, camera);
    this.mesh.setPositions(this.positions);
    this.mesh.setColors32(this.colors);
    this.mesh.update(pc.PRIMITIVE_TRIANGLES);
  }

  private sparkles(age: number, base: number, span: number, opacity: number, camera?: pc.Vec3) {
    const first = this.points[0].s;
    const last = this.points.length - 1;
    const spacing = WAYMARK.trail.spacing / 4;
    for (let i = 0; i < SPARKS; i++) {
      const seed = i * 2.399963;
      const cycle = (age * (0.3 + (i % 5) * 0.025) + i * 0.618034) % 1;
      const s = base + ((i * 0.618034 + age * 0.11) % 1) * span;
      const f = Math.min(last, Math.max(0, (s - first) / spacing));
      const j = Math.floor(f);
      const a = this.points[j], b = this.points[Math.min(last, j + 1)];
      const t = f - j;
      const orbit = seed + age * (0.8 + i % 3 * 0.3);
      const drift = (0.055 + cycle * 0.24) * Math.sin(orbit);
      const x = a.x + (b.x - a.x) * t + Math.cos(a.heading) * drift;
      const z = a.z + (b.z - a.z) * t - Math.sin(a.heading) * drift;
      const y = a.y + (b.y - a.y) * t + Math.cos(orbit) * 0.1 + cycle * 0.28;
      const pulse = Math.pow(Math.sin(Math.PI * cycle), 2);
      const alpha = opacity * pulse * smooth((s - base) / 1.1) * smooth((base + span - s) / 1.1) * (i % 5 === 0 ? 1 : 0.72);
      const scale = (i % 5 === 0 ? 0.098 : 0.042) * (0.5 + pulse * 0.5);
      const vx = (camera?.x ?? x) - x, vy = (camera?.y ?? y + 1) - y, vz = (camera?.z ?? z - 1) - z;
      this.cameraRight.set(-vz, 0, vx).normalize();
      this.cameraUp.set(vx, vy, vz).cross(this.cameraUp, this.cameraRight).normalize();
      const v = this.points.length * ROW.length + i * SPARK_VERTICES;
      this.write(v, x, y, z, alpha);
      STAR.forEach(({ x: u, y: w, radius }, j) => {
        const sx = (this.cameraRight.x * u + this.cameraUp.x * w) * scale;
        const sy = this.cameraUp.y * w * scale;
        const sz = (this.cameraRight.z * u + this.cameraUp.z * w) * scale;
        this.write(v + 1 + j, x + sx * radius, y + sy * radius, z + sz * radius, alpha * 0.3);
        this.write(v + 1 + j + STAR.length, x + sx * 1.75, y + sy * 1.75, z + sz * 1.75, 0);
      });
    }
  }

  private write(index: number, x: number, y: number, z: number, alpha: number) {
    this.positions[index * 3] = x;
    this.positions[index * 3 + 1] = y;
    this.positions[index * 3 + 2] = z;
    this.colors[index * 4 + 3] = Math.round(alpha * 255);
  }
}
