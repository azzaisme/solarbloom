import type * as pc from 'playcanvas';
import type { GfxTier } from '../data/look';

/** The Graphics setting: a fixed tier, or Auto (detected, then stepped down if frames stay slow). */
export type GfxSetting = 'auto' | GfxTier;

export const TIER_ORDER: GfxTier[] = ['low', 'medium', 'high'];

/** The next tier down (Low stays Low). */
export function lowerTier(t: GfxTier): GfxTier {
  return TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(t) - 1)];
}

/** `?gfx=low|medium|high` in the page URL forces a tier for this session (tests, perf runs, support). */
export function urlTier(): GfxTier | undefined {
  try {
    const v = new URLSearchParams(location.search).get('gfx');
    return v === 'low' || v === 'medium' || v === 'high' ? v : undefined;
  } catch {
    return undefined;
  }
}

/** The GPU's name, when the browser shares it. */
function rendererName(device: pc.GraphicsDevice): string {
  try {
    const gl = (device as unknown as { gl?: WebGL2RenderingContext }).gl;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    return '';
  }
}

/**
 * Look 1.11: a starting tier for Auto. Software renderers and phones start Low (big phones with plenty of cores and
 * memory start Medium), tablets Medium, and computers High unless they report very few cores or little memory.
 * Auto then steps down at run time if frames stay slow (Game.adaptQuality).
 */
export function detectTier(device: pc.GraphicsDevice): GfxTier {
  const gpu = rendererName(device);
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu)) return 'low';
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 4;
  const cores = nav.hardwareConcurrency ?? 4;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(screen.width, screen.height);
  if (coarse && shortSide < 600) return mem >= 6 && cores >= 8 ? 'medium' : 'low';
  if (coarse) return 'medium';
  if (cores <= 2 || mem <= 2) return 'medium';
  return 'high';
}
