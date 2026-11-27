import * as pc from 'playcanvas';
import { lin } from './ChunkRenderer';

/**
 * #861 (epic #845): the house's painted textures, on the pieces inside that are made of something you'd see the
 * grain or weave of: wood (beams, wall plates, joist ends, door posts, skirting), the rugs' weave and the coir
 * doormat; #858: the kitchen's gingham tablecloth and its tiled splashback (its table, chairs and counter are wood). Painted by hand in klad (owner, 28 Nov 2026: no procedural noise or stock images), as seamless tiles in
 * light warm greys: the piece's palette colour tints them, so one wood tile serves the dark beams and the paler
 * skirting, and one weave every rug. The `.klad` sources sit next to the PNGs in `assets/raw/textures/house/`
 * (`paint.py` there made the strokes, `klad render <name>.klad --region 256,256,256,256` cuts out the tile), so
 * they can be repainted.
 *
 * Each texture is one mesh per room (boxes with UVs, the vertex colour the tint), drawn with its own material.
 */

export type HouseTexName = 'wood' | 'weave' | 'coir' | 'cloth' | 'tiles';
export const HOUSE_TEXTURES: HouseTexName[] = ['wood', 'weave', 'coir', 'cloth', 'tiles'];

/** World metres one copy of each tile covers. */
export const HOUSE_TEX_METRES: Record<HouseTexName, number> = { wood: 0.9, weave: 1.6, coir: 1.0, cloth: 0.5, tiles: 0.6 };

/**
 * Each tile's mean brightness (sRGB, measured from the PNGs): the material lifts the tint by its inverse, so a
 * textured piece averages out at its palette colour rather than a shade darker.
 */
export const HOUSE_TEX_MEAN: Record<HouseTexName, number> = { wood: 0.846, weave: 0.893, coir: 0.802, cloth: 0.807, tiles: 0.885 };

const FILES = import.meta.glob('../../assets/raw/textures/house/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export function houseTexUrl(name: HouseTexName): string | undefined {
  for (const [path, url] of Object.entries(FILES)) if (path.split('/').pop() === `${name}.png`) return url;
  return undefined;
}

type V3 = [number, number, number];

export interface TexGeo {
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

const AXES = [0, 1, 2] as const;

/**
 * Adds a box (centre `p`, size `s`) to `g` with texture coordinates in metres over `metres`: on each face the tile's
 * U runs along the box's longest side when that side lies in the face (so wood grain runs along a beam or a skirting
 * board), else along the face's longer side. Coordinates start at the box's corner, shifted by `seed` so two boards
 * side by side don't show the same knot.
 */
export function addTexBox(g: TexGeo, rgb: V3, p: V3, s: V3, metres: number, seed = 0) {
  const long = AXES.reduce((a, b) => (s[b] > s[a] ? b : a), 0);
  const shift = (((seed * 0.6180339) % 1) + 1) % 1;
  const R = Math.round(rgb[0] * 255), G = Math.round(rgb[1] * 255), B = Math.round(rgb[2] * 255);
  for (const axis of AXES)
    for (const sign of [-1, 1]) {
      const [a, b] = AXES.filter((k) => k !== axis);
      // U along the long side if it's in this face, else the face's longer side; V the other
      const u = a === long || b === long ? long : s[a] >= s[b] ? a : b;
      const v = u === a ? b : a;
      const base = g.pos.length / 3;
      for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const q: V3 = [0, 0, 0];
        q[axis] = p[axis] + (sign * s[axis]) / 2;
        q[u] = p[u] + (du * s[u]) / 2;
        q[v] = p[v] + (dv * s[v]) / 2;
        g.pos.push(...q);
        const n: V3 = [0, 0, 0];
        n[axis] = sign;
        g.nrm.push(...n);
        g.uv.push(((du + 1) / 2) * (s[u] / metres) + shift, ((dv + 1) / 2) * (s[v] / metres) + shift * 0.37);
        g.col.push(R, G, B, 255);
      }
      // wind each face so it faces out along its normal: (q1 − q0) × (q2 − q0) along the normal's axis
      const P = g.pos;
      const e1 = [0, 1, 2].map((k) => P[(base + 1) * 3 + k] - P[base * 3 + k]);
      const e2 = [0, 1, 2].map((k) => P[(base + 2) * 3 + k] - P[base * 3 + k]);
      const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (cross[axis] * sign > 0) g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else g.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
}

/** #861: collects the house's textured boxes, one geometry per texture, and builds a mesh of each. */
export class HouseTexBuilder {
  readonly geo = new Map<HouseTexName, TexGeo>();
  private n = 0;

  box(name: HouseTexName, hex: string, p: V3, s: V3) {
    let g = this.geo.get(name);
    if (!g) this.geo.set(name, (g = { pos: [], nrm: [], uv: [], col: [], idx: [] }));
    addTexBox(g, lin(hex), p, s, HOUSE_TEX_METRES[name], ++this.n + Math.round(p[0] * 7 + p[2] * 13));
  }

  /** The boxes of one texture (for tests). */
  count(name: HouseTexName): number {
    return (this.geo.get(name)?.idx.length ?? 0) / 36;
  }

  build(device: pc.GraphicsDevice): { name: HouseTexName; mesh: pc.Mesh }[] {
    const out: { name: HouseTexName; mesh: pc.Mesh }[] = [];
    for (const [name, g] of this.geo) {
      if (!g.idx.length) continue;
      const m = new pc.Mesh(device);
      m.setPositions(g.pos);
      m.setNormals(g.nrm);
      m.setUvs(0, g.uv);
      m.setColors32(g.col);
      m.setIndices(g.idx);
      m.update(pc.PRIMITIVE_TRIANGLES);
      out.push({ name, mesh: m });
    }
    return out;
  }
}

const materials = new Map<HouseTexName, pc.StandardMaterial>();

/** The material of one of the house's textures: the painted tile times the vertex colour, lifted by its mean. */
export function houseTexMaterial(device: pc.GraphicsDevice, name: HouseTexName): pc.StandardMaterial {
  const have = materials.get(name);
  if (have) return have;
  const m = new pc.StandardMaterial();
  const k = 1 / HOUSE_TEX_MEAN[name];
  m.diffuse = new pc.Color(k, k, k);
  m.diffuseVertexColor = true;
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = name === 'wood' ? 0.3 : 0.12;
  m.update();
  materials.set(name, m);
  const url = houseTexUrl(name);
  if (url) {
    const img = new Image();
    img.onload = () => {
      const tex = new pc.Texture(device, {
        name: `house-${name}`,
        mipmaps: true,
        anisotropy: 8,
        addressU: pc.ADDRESS_REPEAT,
        addressV: pc.ADDRESS_REPEAT,
        minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: pc.FILTER_LINEAR,
      });
      tex.setSource(img);
      m.diffuseMap = tex;
      m.update();
    };
    img.src = url;
  }
  return m;
}
