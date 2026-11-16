import * as pc from 'playcanvas';
import { LOOK } from '../data/look';

/** Look 2: every colour lives in Palette.ts (docs/art/palette.md); re-exported here for existing imports. */
import { PALETTE } from './Palette';
export { PALETTE };

const cache = new Map<string, pc.StandardMaterial>();

export interface MatOpts {
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  gloss?: number;
  metal?: number;
  unlit?: boolean;
  doubleSided?: boolean;
}

export function color(hex: string): pc.Color {
  const c = new pc.Color();
  c.fromString(hex);
  return c;
}

/**
 * Look 1.9: emissive intensity as rendered. Materials authored as glows (intensity >= 1) are scaled into the bloom
 * range; weaker emissive tints stay below it.
 */
export function glow(intensity: number): number {
  return intensity >= 1 ? intensity * LOOK.emissive.gain : intensity;
}

/** Shared, cached material. Never create materials per frame. */
export function mat(hex: string, o: MatOpts = {}): pc.StandardMaterial {
  const key = hex + JSON.stringify(o);
  let m = cache.get(key);
  if (m) return m;
  m = new pc.StandardMaterial();
  m.diffuse = color(hex);
  m.useMetalness = true;
  m.metalness = o.metal ?? 0;
  m.gloss = o.gloss ?? 0.35;
  if (o.emissive) {
    m.emissive = color(o.emissive);
    m.emissiveIntensity = glow(o.emissiveIntensity ?? 1);
  }
  if (o.unlit) {
    m.useLighting = false;
    m.emissive = color(hex);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
    m.diffuse = new pc.Color(0, 0, 0);
  }
  if (o.opacity !== undefined && o.opacity < 1) {
    m.opacity = o.opacity;
    m.blendType = pc.BLEND_NORMAL;
    m.depthWrite = false;
  }
  if (o.doubleSided) m.cull = pc.CULLFACE_NONE;
  m.update();
  cache.set(key, m);
  return m;
}

/** Look 2.8: a shared machine / prop surface from PALETTE.surfaces (cached like every mat()). */
export function surface(name: keyof typeof PALETTE.surfaces, o: MatOpts = {}): pc.StandardMaterial {
  const s = PALETTE.surfaces[name];
  return mat(s.hex, { gloss: s.gloss, metal: s.metal, ...o });
}

/** A private (uncached) material for things that animate their colour, like the Core. */
export function uniqueMat(hex: string, o: MatOpts = {}): pc.StandardMaterial {
  const m = mat(hex, o).clone() as pc.StandardMaterial;
  m.update();
  return m;
}
