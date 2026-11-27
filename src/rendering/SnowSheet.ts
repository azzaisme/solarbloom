import * as pc from 'playcanvas';
import { SNOW_SHEET } from '../data/seasons';
import { SEASON_FIELD_GLSL, seasonShading } from './SeasonLook';
import { color, PALETTE } from './Materials';

/**
 * #830: snow that builds up. Lying snow is a real layer: a sheet laid over the open ground of each chunk near the
 * camera (lawns, paving, earth: never water, buildings, machines or decorations), raised in the vertex shader into
 * the same patches and lumps the ground's snow tint shows (SeasonLook `sbsCoverAt`, `sbsLumps`). As the snow deepens
 * the patches swell into soft mounds and join; where the snow meets something it can't lie on, its edge rounds down
 * to the ground as a bank. Its height is one uniform (`uSnowHeight`), so building up and melting cost nothing: a
 * chunk's sheet is only rebuilt when the chunk itself is (something built, or the ground changed).
 *
 * The geometry is pure data (`buildSnowSheet`), so tests can check it; `SnowSheets` keeps the meshes.
 */

/** What the sheet needs to know about the ground. */
export interface SnowGround {
  /** can snow lie on this cell? Its level (cells at different levels don't share a bank) or undefined */
  levelAt(x: number, z: number): number | undefined;
  /** world height of the ground at a point inside cell (cx, cz) */
  yAt(px: number, pz: number, cx: number, cz: number): number;
}

export interface SnowSheetGeo {
  pos: Float32Array;
  /** per vertex: how far in from the snow's edge (0 at the edge … 1 inside), and its slope in x and z */
  rim: Float32Array;
  idx: Uint32Array;
  /** cells covered */
  cells: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0 at the snow's edge … 1 a little way in: the distance from (px, pz) to the nearest cell snow can't share. */
export function rimAt(g: SnowGround, px: number, pz: number, cx: number, cz: number, level: number): number {
  let d = Infinity;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const x = cx + dx, z = cz + dz;
      if (g.levelAt(x, z) === level) continue;
      const ex = Math.max(x - px, 0, px - (x + 1));
      const ez = Math.max(z - pz, 0, pz - (z + 1));
      d = Math.min(d, Math.hypot(ex, ez));
    }
  return smooth(0, SNOW_SHEET.bank, d);
}

/** The sheet over one chunk's cells (each cell its own little grid, so terraces at different levels never stretch). */
export function buildSnowSheet(g: SnowGround, cx0: number, cz0: number, size: number, sub: number): SnowSheetGeo {
  const pos: number[] = [];
  const rim: number[] = [];
  const idx: number[] = [];
  let cells = 0;
  const e = 0.05;
  for (let cz = cz0; cz < cz0 + size; cz++)
    for (let cx = cx0; cx < cx0 + size; cx++) {
      const level = g.levelAt(cx, cz);
      if (level === undefined) continue;
      cells++;
      const base = pos.length / 3;
      for (let j = 0; j <= sub; j++)
        for (let i = 0; i <= sub; i++) {
          const px = cx + i / sub, pz = cz + j / sub;
          // inside the cell (its own height, even on its border)
          const ix = Math.min(cx + 0.999, Math.max(cx + 0.001, px)), iz = Math.min(cz + 0.999, Math.max(cz + 0.001, pz));
          pos.push(px, g.yAt(ix, iz, cx, cz), pz);
          const r = rimAt(g, px, pz, cx, cz, level);
          rim.push(r, (rimAt(g, px + e, pz, cx, cz, level) - rimAt(g, px - e, pz, cx, cz, level)) / (2 * e), (rimAt(g, px, pz + e, cx, cz, level) - rimAt(g, px, pz - e, cx, cz, level)) / (2 * e), 0);
        }
      const row = sub + 1;
      for (let j = 0; j < sub; j++)
        for (let i = 0; i < sub; i++) {
          const a = base + j * row + i;
          idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
        }
    }
  return { pos: new Float32Array(pos), rim: new Float32Array(rim), idx: new Uint32Array(idx), cells };
}

const SNOW_VS_DECL = /* glsl */ `
attribute vec4 vertex_snow;
uniform float uSnowHeight;
varying float vSnowCov;
varying float vSnowLump;
`;

const SNOW_TRANSFORM = /* glsl */ `
#ifdef PIXELSNAP
uniform vec4 screen_size;
#endif
#ifdef SCREENSPACE
uniform float projectionFlipY;
#endif
${SEASON_FIELD_GLSL}
vec3 sbSnowN;
float sbsDrift(vec2 xz) {
	return sbsCoverAt(xz) * (0.5 + 0.5 * sbsLumps(xz));
}
vec4 evalWorldPosition(vec3 vertexPosition, mat4 modelMatrix) {
	vec4 posW = modelMatrix * vec4(getLocalPosition(vertexPosition), 1.0);
	vec2 xz = posW.xz;
	float rim = vertex_snow.x;
	float f = sbsDrift(xz);
	const float e = 0.08;
	float fx = (sbsDrift(xz + vec2(e, 0.0)) - f) / e;
	float fz = (sbsDrift(xz + vec2(0.0, e)) - f) / e;
	float H = uSnowHeight;
	posW.y += 0.012 + H * f * rim;
	vec2 dh = H * (vec2(fx, fz) * rim + f * vertex_snow.yz);
	sbSnowN = normalize(vec3(-dh.x, 1.0, -dh.y));
	vSnowCov = sbsCoverAt(xz) * rim;
	vSnowLump = sbsLumps(xz);
	return posW;
}
vec4 getPosition() {
	dModelMatrix = getModelMatrix();
	vec4 posW = evalWorldPosition(vertex_position.xyz, dModelMatrix);
	dPositionW = posW.xyz;
	vec4 screenPos;
	#ifdef UV1LAYOUT
		screenPos = vec4(vertex_texCoord1.xy * 2.0 - 1.0, 0.5, 1);
	#else
		#ifdef SCREENSPACE
			screenPos = posW;
			screenPos.y *= projectionFlipY;
		#else
			screenPos = matrix_viewProjection * posW;
		#endif
	#endif
	return screenPos;
}
vec3 getWorldPosition() {
	return dPositionW;
}
`;

const SNOW_NORMAL_VS = /* glsl */ `
mat3 dNormalMatrix;
vec3 getNormal() {
	dNormalMatrix = getNormalMatrix(dModelMatrix);
	return sbSnowN;
}
`;

const SNOW_PS_DECL = /* glsl */ `
varying float vSnowCov;
varying float vSnowLump;
uniform vec3 uSnowWhite;
uniform vec3 uSnowShade;
`;

/** Bright, matte snow: a touch of blue low in the hollows; the odd crystal glints up close. */
const SNOW_DIFFUSE_PS = /* glsl */ `
void getAlbedo() {
	dAlbedo = mix(uSnowShade, uSnowWhite, smoothstep(0.15, 0.6, vSnowLump));
	vec2 gq = vPositionW.xz * 38.0;
	float gs = 1.0 - smoothstep(0.4, 0.9, length(fwidth(gq)));
	dAlbedo *= 1.0 + 0.3 * step(0.986, fract(sin(dot(floor(gq), vec2(12.9898, 78.233))) * 43758.5453)) * gs;
}
`;

/** Only where the snow lies: elsewhere the sheet is not drawn at all (alpha test). */
const SNOW_OPACITY_PS = /* glsl */ `
void getOpacity() {
	dAlpha = smoothstep(0.3, 0.45, vSnowCov);
}
`;

let material: pc.StandardMaterial | undefined;
export function snowMaterial(): pc.StandardMaterial {
  if (material) return material;
  const m = new pc.StandardMaterial();
  m.name = 'season-snow';
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = 0.15;
  m.alphaTest = 0.5;
  m.setAttribute('vertex_snow', pc.SEMANTIC_ATTR12);
  try {
    const chunks = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
    chunks.set('litUserDeclarationVS', SNOW_VS_DECL);
    chunks.set('transformVS', SNOW_TRANSFORM);
    chunks.set('normalVS', SNOW_NORMAL_VS);
    chunks.set('litUserDeclarationPS', SNOW_PS_DECL);
    chunks.set('diffusePS', SNOW_DIFFUSE_PS);
    chunks.set('opacityPS', SNOW_OPACITY_PS);
  } catch {
    /* an engine without per-material chunks: no snow layer (the ground's snow tint still shows) */
  }
  m.setParameter('uSnowHeight', 0);
  const w = color(PALETTE.season.frost), sh = color(PALETTE.season.snowShade);
  m.setParameter('uSnowWhite', [Math.pow(w.r, 2.2), Math.pow(w.g, 2.2), Math.pow(w.b, 2.2)]);
  m.setParameter('uSnowShade', [Math.pow(sh.r, 2.2), Math.pow(sh.g, 2.2), Math.pow(sh.b, 2.2)]);
  seasonShading.register(m);
  m.update();
  return (material = m);
}

/**
 * The snow sheets near the camera. `update` (once a frame) keeps a sheet for each chunk within reach while snow is
 * lying, builds at most one new sheet a frame, and sets the height; `dirty(key)` asks for a chunk's sheet again
 * (ChunkRenderer calls it when it rebuilds that chunk).
 */
export class SnowSheets {
  private sheets = new Map<string, pc.Entity | null>();
  private stale = new Set<string>();
  private root: pc.Entity;
  /** the Low setting: coarser sheets, nearer the camera */
  low = false;

  constructor(
    private device: pc.GraphicsDevice,
    parent: pc.Entity,
    private ground: SnowGround,
    private chunkSize: number,
  ) {
    this.root = new pc.Entity('snow-sheets');
    parent.addChild(this.root);
  }

  dirty(key: string) {
    if (this.sheets.has(key)) this.stale.add(key);
  }

  /** How many chunks have a sheet now (tests and the e2e read it). */
  get count(): number {
    let n = 0;
    for (const e of this.sheets.values()) if (e) n++;
    return n;
  }

  /** `depth`: lying snow 0 … 1 (Seasons.snowCover); `fx`, `fz`: where the camera looks. */
  update(depth: number, fx: number, fz: number) {
    snowMaterial().setParameter('uSnowHeight', depth * SNOW_SHEET.maxHeight);
    const on = depth > SNOW_SHEET.minDepth;
    this.root.enabled = on;
    if (!on) {
      if (this.sheets.size) this.clear();
      return;
    }
    const C = this.chunkSize;
    const r = this.low ? SNOW_SHEET.reachLow : SNOW_SHEET.reach;
    const ccx = Math.floor(fx / C), ccz = Math.floor(fz / C);
    const want = new Set<string>();
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) want.add(`${ccx + dx},${ccz + dz}`);
    for (const [k, e] of this.sheets)
      if (!want.has(k)) {
        e?.destroy();
        this.sheets.delete(k);
        this.stale.delete(k);
      }
    // nearest first, one build a frame
    const todo = [...want].filter((k) => !this.sheets.has(k) || this.stale.has(k));
    if (!todo.length) return;
    todo.sort((a, b) => {
      const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number);
      return Math.hypot(ax - ccx, az - ccz) - Math.hypot(bx - ccx, bz - ccz);
    });
    this.build(todo[0]);
  }

  private build(key: string) {
    this.sheets.get(key)?.destroy();
    this.stale.delete(key);
    const [cx, cz] = key.split(',').map(Number);
    const C = this.chunkSize;
    const geo = buildSnowSheet(this.ground, cx * C, cz * C, C, this.low ? SNOW_SHEET.subLow : SNOW_SHEET.sub);
    if (!geo.cells) {
      this.sheets.set(key, null);
      return;
    }
    const mesh = new pc.Mesh(this.device);
    mesh.setPositions(geo.pos);
    const nrm = new Float32Array(geo.pos.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    mesh.setNormals(nrm);
    mesh.setVertexStream(pc.SEMANTIC_ATTR12, geo.rim, 4);
    mesh.setIndices(geo.idx);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    // the vertex shader lifts the sheet: pad the bounds so it isn't culled
    const b = mesh.aabb;
    mesh.aabb = new pc.BoundingBox(b.center.clone().add(new pc.Vec3(0, SNOW_SHEET.maxHeight / 2, 0)), b.halfExtents.clone().add(new pc.Vec3(0.1, SNOW_SHEET.maxHeight, 0.1)));
    const e = new pc.Entity(`snow-${key}`);
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, snowMaterial())], castShadows: false, receiveShadows: true });
    this.root.addChild(e);
    this.sheets.set(key, e);
  }

  clear() {
    for (const e of this.sheets.values()) e?.destroy();
    this.sheets.clear();
    this.stale.clear();
  }
}
