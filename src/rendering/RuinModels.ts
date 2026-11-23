/**
 * P7-E32 (#756): the authored ruin models (assets/raw/models/ruins, made with Meshy and finished in Blender:
 * assets/raw/models/pending/p7-ruins/README.md). Each is one node, pivot at the base centre, real metres, flat
 * palette materials with matching vertex colours (COLOR_0). Ruins.ts bakes their triangles into its own band meshes,
 * so they are fetched and parsed here rather than through ModelLibrary (which loads `final/` as near + LOD pairs).
 */

export type RuinModelName = 'aqueduct' | 'tower' | 'dome' | 'solarframe' | 'cliff';
export const RUIN_MODEL_NAMES: RuinModelName[] = ['aqueduct', 'tower', 'dome', 'solarframe', 'cliff'];

/** One model, merged into a single triangle list: positions, normals, linear 0–1 colours, indices. */
export interface RuinModel {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  idx: Uint32Array;
  /** bounds of the positions (metres): [minX, minY, minZ, maxX, maxY, maxZ] */
  box: [number, number, number, number, number, number];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Reads one GLB (glTF 2.0 binary) into a RuinModel: every primitive of every mesh node, node transforms ignored. */
export function parseRuinGlb(buf: ArrayBuffer): RuinModel {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;
  const read = (i: number): { data: number[]; n: number; comps: number } => {
    const a = json.accessors[i];
    const view = json.bufferViews[a.bufferView];
    const comps = COMPONENTS[a.type];
    const base = binStart + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const size = a.componentType === 5126 ? 4 : a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    const stride = view.byteStride ?? size * comps;
    const out: number[] = [];
    for (let k = 0; k < a.count; k++)
      for (let c = 0; c < comps; c++) {
        const o = base + k * stride + c * size;
        let v: number;
        if (a.componentType === 5126) v = dv.getFloat32(o, true);
        else if (a.componentType === 5125) v = dv.getUint32(o, true);
        else if (a.componentType === 5123) v = dv.getUint16(o, true) / (a.normalized ? 65535 : 1);
        else v = dv.getUint8(o) / (a.normalized ? 255 : 1);
        out.push(v);
      }
    return { data: out, n: a.count, comps };
  };
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const mesh of json.meshes)
    for (const p of mesh.primitives) {
      const base = pos.length / 3;
      const P = read(p.attributes.POSITION);
      const N = p.attributes.NORMAL !== undefined ? read(p.attributes.NORMAL) : undefined;
      const Cc = p.attributes.COLOR_0 !== undefined ? read(p.attributes.COLOR_0) : undefined;
      for (let k = 0; k < P.n; k++) {
        pos.push(P.data[k * 3], P.data[k * 3 + 1], P.data[k * 3 + 2]);
        nrm.push(N ? N.data[k * 3] : 0, N ? N.data[k * 3 + 1] : 1, N ? N.data[k * 3 + 2] : 0);
        if (Cc) col.push(Cc.data[k * Cc.comps], Cc.data[k * Cc.comps + 1], Cc.data[k * Cc.comps + 2]);
        else col.push(0.7, 0.7, 0.7);
      }
      if (p.indices !== undefined) for (const i of read(p.indices).data) idx.push(base + i);
      else for (let k = 0; k < P.n; k++) idx.push(base + k);
    }
  const box: RuinModel['box'] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let c = 0; c < 3; c++) {
      box[c] = Math.min(box[c], pos[i + c]);
      box[c + 3] = Math.max(box[c + 3], pos[i + c]);
    }
  return { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), col: Float32Array.from(col), idx: Uint32Array.from(idx), box };
}

const URLS = import.meta.glob('../../assets/raw/models/ruins/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** Fetches and parses every ruin model; resolves undefined if any is missing or fails (the ruins then stay procedural). */
export async function loadRuinModels(): Promise<Record<RuinModelName, RuinModel> | undefined> {
  try {
    const out = {} as Record<RuinModelName, RuinModel>;
    await Promise.all(
      RUIN_MODEL_NAMES.map(async (n) => {
        const url = Object.entries(URLS).find(([k]) => k.endsWith(`/ruin-${n}.glb`))?.[1];
        if (!url) throw new Error(`no ruin-${n}.glb`);
        const res = await fetch(url);
        out[n] = parseRuinGlb(await res.arrayBuffer());
      }),
    );
    return out;
  } catch (e) {
    console.warn('ruins: authored models unavailable, using the procedural pieces', e);
    return undefined;
  }
}
