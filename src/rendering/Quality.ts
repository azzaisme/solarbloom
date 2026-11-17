import type * as pc from 'playcanvas';
import type { GfxTier } from '../data/look';

/** The Graphics setting: a fixed tier, or Auto (detected, then stepped down if frames stay slow). */
export type GfxSetting = 'auto' | 'deck' | GfxTier;

/**
 * Steam Deck (#243): the Deck preset. It sits on the Medium tier (post-processing with bloom, 2x MSAA, no SSAO
 * or depth of field) and then renders at three-quarter resolution with 1024 shadows, Low's thinner flowers,
 * tufts and near-tree detail, and its own reach for the close camera (see CLOSE_VIEW_REACH).
 */
export const DECK = { tier: 'medium' as GfxTier, renderScale: 0.75, shadowRes: 1024, detail: 'low' as GfxTier, closeReach: 0.7 };

/** Is this GPU name a Steam Deck's (the LCD model's "vangogh" APU or the OLED's "sephiroth")? */
export function isDeckGpu(renderer: string): boolean {
  return /vangogh|van gogh|sephiroth|amd custom gpu 0(405|932)|steam ?deck/i.test(renderer);
}

/** `?gfx=deck` forces the Deck preset for this session. */
export function urlDeck(): boolean {
  try {
    return new URLSearchParams(location.search).get('gfx') === 'deck';
  } catch {
    return false;
  }
}

/** Running on a Steam Deck: the desktop wrapper says so (Steam sets SteamDeck=1), or the GPU's name does. */
export function onSteamDeck(device: pc.GraphicsDevice): boolean {
  const desk = (globalThis as { solarbloomDesktop?: { deck?: boolean } }).solarbloomDesktop;
  return !!desk?.deck || isDeckGpu(rendererName(device));
}

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
