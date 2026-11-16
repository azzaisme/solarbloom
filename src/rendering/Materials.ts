import * as pc from 'playcanvas';
import { LOOK } from '../data/look';

export const PALETTE = {
  concrete: ['#8d9196', '#7f8489', '#979a9e', '#868a8f'],
  concreteDark: '#5d6166',
  crack: '#3f4347',
  debris: '#6d7176',
  weed: '#7a8a5c',
  soil: '#8a6a4b',
  soilDark: '#6f533a',
  moss: '#7fa35a',
  grass: ['#69bf4a', '#74c64f', '#5fb446'],
  grassTuft: ['#4fae3a', '#5fbf43', '#86d45a'],
  flower: ['#ff7eb6', '#ffd23f', '#b48cff', '#ffffff', '#ff9a5a'],
  flowerCore: '#ffe28a',
  stem: '#3f9a3a',
  shrub: ['#3e9e46', '#4fb04f', '#2f8a3e'],
  trunk: '#8b6243',
  white: '#f4f1ea',
  whiteWarm: '#fbf6ec',
  shell: '#e9e6df',
  panel: '#1e3a6b',
  panelGlint: '#3a6fb8',
  gold: '#e7b54a',
  glass: '#7fd6f0',
  water: '#4cc3ea',
  darkFace: '#1d2633',
  eyeCyan: '#6ff3ff',
  leafFin: '#7fd36a',
  facadeGrey: '#a3a6aa',
  facadeDark: '#7d8085',
  window: '#3b4652',
  windowLit: '#ffe6a6',
  parapet: '#9a9ea2',
  parapetClean: '#f2efe8',
  vent: '#8a7d70',
  rust: '#a0623c',
  coreDormant: '#6f747a',
  coreGlow: '#7cf7c8',
  cat: '#fbfaf7',
  catRed: '#e2483c',
  pink: '#ff8fbf',
  skyline: ['#b9d6e6', '#acc9dc', '#c4dce8', '#a5c3d6'],
  skylineGreen: '#a8d3a0',
  bridge: '#eeeae2',
};

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

/** A private (uncached) material for things that animate their colour, like the Core. */
export function uniqueMat(hex: string, o: MatOpts = {}): pc.StandardMaterial {
  const m = mat(hex, o).clone() as pc.StandardMaterial;
  m.update();
  return m;
}
