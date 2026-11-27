import * as pc from 'playcanvas';
import { PALETTE } from './Palette';

export type TileMarkerKind = 'hover' | 'selected' | 'valid' | 'restore' | 'invalid' | 'objective';
export type MarkerView = Pick<pc.Vec3, 'x' | 'z'>;

/** Keep the stem toward the camera while the four corners stay aligned to the tile. */
export function faceTileMarker(marker: pc.Entity, view: MarkerView) {
  const p = marker.getPosition();
  const turn = Math.round(Math.atan2(view.x - p.x, view.z - p.z) / (Math.PI / 2));
  marker.setLocalEulerAngles(0, turn * 90, 0);
}
type Point = readonly [number, number];
type Tint = readonly [hex: string, opacity: number];

const art = {
  hover: { ...PALETTE.tileMarker.hover, fill: 0, halo: 0.22 },
  selected: { ...PALETTE.tileMarker.selected, fill: 0.14, halo: 0.42 },
  valid: { ...PALETTE.tileMarker.valid, fill: 0.10, halo: 0.36 },
  restore: { ...PALETTE.tileMarker.valid, fill: 0.14, halo: 0.42 },
  invalid: { ...PALETTE.tileMarker.invalid, fill: 0.12, halo: 0.29 },
  objective: { ...PALETTE.tileMarker.objective, fill: 0.15, halo: 0.49 },
} as const;

class Marks {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  point(x: number, y: number, z: number, [hex, alpha]: Tint) {
    const rgb = Number.parseInt(hex.slice(1), 16);
    const i = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.normals.push(0, 1, 0);
    this.colors.push((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, Math.round(alpha * 255));
    return i;
  }

  quad(a: number, b: number, c: number, d: number) {
    this.indices.push(a, c, b, a, d, c);
  }

  fill(points: readonly Point[], tint: Tint, y: number) {
    const indices = points.map(([x, z]) => this.point(x, y, z, tint));
    for (let i = 1; i < indices.length - 1; i++) this.indices.push(indices[0], indices[i + 1], indices[i]);
  }

  /** A soft stroke has a bright spine and transparent sides. */
  stroke(points: readonly Point[], width: number, tint: Tint, y: number, feather = false) {
    const [hex] = tint;
    const offsets = feather ? [-1, 0, 1] : [-1, 1];
    const first = this.positions.length / 3;
    for (let i = 0; i < points.length; i++) {
      const [x, z] = points[i];
      const [px, pz] = points[Math.max(0, i - 1)];
      const [nx, nz] = points[Math.min(points.length - 1, i + 1)];
      const length = Math.hypot(nx - px, nz - pz);
      for (const side of offsets) {
        const shift = side * width / (2 * length);
        this.point(x - (nz - pz) * shift, y, z + (nx - px) * shift, feather && side !== 0 ? [hex, 0] : tint);
      }
    }
    const n = offsets.length;
    for (let i = 0; i < points.length - 1; i++) for (let j = 0; j < n - 1; j++) {
      const a = first + i * n + j;
      this.quad(a, a + 1, a + n + 1, a + n);
    }
  }

  mesh(device: pc.GraphicsDevice) {
    const mesh = new pc.Mesh(device);
    mesh.setPositions(this.positions);
    mesh.setNormals(this.normals);
    mesh.setColors32(this.colors);
    mesh.setIndices(this.indices);
    mesh.update();
    mesh.incRefCount();
    return mesh;
  }
}

/** Pointed leaf built from two curved sides, rooted at its stem. */
function leaf(root: Point, tip: Point, width: number): Point[] {
  const dx = tip[0] - root[0], dz = tip[1] - root[1];
  const length = Math.hypot(dx, dz);
  const curve = (t: number, side: number): Point => {
    const bow = Math.sin(Math.PI * t) * width * side;
    return [root[0] + dx * t - dz / length * bow, root[1] + dz * t + dx / length * bow];
  };
  return [...Array.from({ length: 9 }, (_, i) => curve(i / 8, 1)),
    ...Array.from({ length: 7 }, (_, i) => curve((7 - i) / 8, -1))];
}

function sprout(mesh: Marks, foreground: string, shadow: string, objective: boolean) {
  const stem: Point[] = [[0, 0.105], [-0.004, 0.066], [0.009, 0.012], [0.019, -0.026]];
  mesh.stroke(stem, 0.036, [shadow, 0.59], 0.009);
  mesh.stroke(stem, 0.018, [foreground, 1], 0.010);
  const leaves = [
    { root: [-0.003, 0.055] as Point, tip: [-0.138, -0.042] as Point, width: 0.036 },
    { root: [0.009, 0.034] as Point, tip: [0.146, -0.095] as Point, width: 0.047 },
  ];
  if (objective) leaves.push({ root: [0.01, 0.014], tip: [0.009, -0.145], width: 0.036 });
  for (const { root, tip, width } of leaves) {
    const outline = leaf(root, tip, width);
    const closed = [...outline, outline[0]];
    mesh.stroke(closed, 0.026, [shadow, 0.63], 0.009);
    if (objective) mesh.stroke(closed, 0.013, [foreground, 1], 0.010);
    else {
      mesh.fill(outline, [foreground, 1], 0.010);
      const vein: Point = [root[0] + 0.73 * (tip[0] - root[0]), root[1] + 0.73 * (tip[1] - root[1])];
      mesh.stroke([root, vein], 0.009, [shadow, 0.58], 0.012);
    }
  }
}

const cache = new WeakMap<pc.GraphicsDevice, Map<string, pc.Mesh>>();
function cached(device: pc.GraphicsDevice, key: string, make: () => Marks) {
  let meshes = cache.get(device);
  if (!meshes) cache.set(device, meshes = new Map());
  let mesh = meshes.get(key);
  if (!mesh) {
    mesh = make().mesh(device);
    meshes.set(key, mesh);
  }
  return mesh;
}

/** Solid corners and restrained fill keep the silhouette visible on both brick and soil. */
export function tileMarkerMesh(device: pc.GraphicsDevice, kind: TileMarkerKind, size = 1, depth = size) {
  return cached(device, depth === size ? `${kind}:${size}` : `${kind}:${size}x${depth}`, () => {
    const mesh = new Marks();
    const ink = art[kind];
    // #849: half-widths across (x) and deep (z); a square frame when they match
    const h = size / 2 - 0.085;
    const hz = depth / 2 - 0.085;
    const arm = 0.146;
    const chamfer = 0.025;
    const edge = kind === 'hover' ? 0.012 : 0.013;
    if (ink.fill) mesh.fill([[-h, -hz], [h, -hz], [h, hz], [-h, hz]], [ink.line, ink.fill], 0);
    for (const sign of [-1, 1]) {
      const sides: [(a: number, b: number) => Point[], number][] = [
        [(a: number, b: number): Point[] => [[a, sign * hz], [b, sign * hz]], h],
        [(a: number, b: number): Point[] => [[sign * h, a], [sign * h, b]], hz],
      ];
      for (const [side, half] of sides) {
        const lo = -half + arm - 0.015, hi = half - arm + 0.015;
        const n = kind === 'invalid' ? Math.max(2, Math.ceil((hi - lo) / 0.12)) : 1;
        for (let i = 0; i < n; i++) {
          const d = (hi - lo) / n;
          const run = side(lo + i * d, lo + (i + (n === 1 ? 1 : 0.59)) * d);
          mesh.stroke(run, edge + 0.015, [ink.shadow, 0.62], 0.003);
          mesh.stroke(run, 0.089, [ink.line, ink.halo], 0.004, true);
          mesh.stroke(run, edge, [ink.line, kind === 'hover' ? 0.76 : 0.93], 0.005);
        }
      }
      for (const z of [-1, 1]) {
        const corner: Point[] = [[sign * (h - arm), z * hz], [sign * (h - chamfer), z * hz],
          [sign * h, z * (hz - chamfer)], [sign * h, z * (hz - arm)]];
        const width = kind === 'hover' ? 0.024 : 0.038;
        mesh.stroke(corner, width + 0.018, [ink.shadow, 0.64], 0.004);
        mesh.stroke(corner, 0.139, [ink.line, ink.halo], 0.005, true);
        mesh.stroke(corner, width, [ink.tip, 1], 0.007);
      }
    }
    if (kind === 'restore' || kind === 'objective') sprout(mesh, ink.tip, ink.shadow, kind === 'objective');
    if (kind === 'invalid') for (const sign of [-1, 1]) {
      const cross: Point[] = [[-0.077, sign * -0.077], [0.077, sign * 0.077]];
      mesh.stroke(cross, 0.046, [ink.shadow, 0.62], 0.009);
      mesh.stroke(cross, 0.028, [ink.tip, 1], 0.011);
    }
    return mesh;
  });
}

/** Small glints and tapered shafts in world space, batchable with one mesh per marked spot. */
export function markerShimmerMesh(device: pc.GraphicsDevice, kind: 'restore' | 'objective') {
  return cached(device, `shimmer:${kind}`, () => {
    const mesh = new Marks();
    const ink = art[kind];
    const objective = kind === 'objective';
    const glints = [[-0.27, 0.13, -0.07], [0.22, 0.26, -0.21], [0.27, 0.095, 0.18], [-0.09, 0.34, -0.3]];
    for (const [i, [x, height, z]] of glints.entries()) {
      if (!objective && i === 3) break;
      const y = height * (objective ? 1 : 0.67);
      const width = (i % 2 ? 0.018 : 0.013) * (objective ? 1 : 0.76);
      // Crossed planes make each glint readable from any compass direction.
      for (const axis of [0, 1]) {
        const pos = (side: number, h: number, tint: Tint) => mesh.point(x + (axis === 0 ? side : 0), h, z + (axis === 1 ? side : 0), tint);
        if (objective) {
          const a = pos(-width * 0.54, 0.018, [ink.line, 0]);
          const b = pos(width * 0.54, 0.018, [ink.line, 0]);
          const c = pos(width * 0.31, y, [ink.line, 0.28]);
          const d = pos(-width * 0.31, y, [ink.line, 0.28]);
          mesh.quad(a, b, c, d);
        }
        const peak: Tint = [ink.tip, 0.94];
        mesh.quad(pos(0, y + width * 1.8, peak), pos(width, y, peak), pos(0, y - width * 1.8, peak), pos(-width, y, peak));
      }
    }
    return mesh;
  });
}
