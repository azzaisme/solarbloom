import * as pc from 'playcanvas';

/**
 * E23.12.3 (#530): the only place the game reads PlayCanvas internals for the sight pick. Everything here is what
 * PlayCanvas's own `Picker.getSelection` does (PlayCanvas 2.23): the Picker keeps its colour target in `renderTarget`
 * and its id → mesh table in `mapping` (both private in the typings), and reads the target with the WebGL device's
 * `readPixels` between `updateBegin`/`updateEnd`, rows bottom-up. The pick pass draws only mesh instances whose
 * `pick` flag is set (`RenderPassPicker.execute`), which is how see-through things are left out.
 *
 * `tests/picker-internals.test.ts` checks each of these against the installed PlayCanvas, so an upgrade that moves
 * them fails loudly there rather than quietly leaving every cat unseen (the sight then falls back to the CPU ray
 * march, core/CatSight).
 */

/** The Picker's private fields the sight pick reads. */
export interface PickBuffer {
  renderTarget: pc.RenderTarget;
  mapping: Map<number, pc.MeshInstance>;
}

/** A WebGL device's pixel read (not in the GraphicsDevice typings). */
interface PixelReader {
  readPixels(x: number, y: number, w: number, h: number, out: Uint8Array): void;
  updateBegin(): void;
  updateEnd(): void;
}

/** The Picker's buffer and id table, or undefined if this PlayCanvas doesn't keep them where 2.23 does. */
export function pickBuffer(picker: pc.Picker): PickBuffer | undefined {
  const p = picker as unknown as Partial<PickBuffer>;
  return p.renderTarget instanceof pc.RenderTarget && p.mapping instanceof Map ? { renderTarget: p.renderTarget, mapping: p.mapping } : undefined;
}

/** Can this device read a pick buffer back at once (WebGL)? WebGPU reads are async only: the sight uses the CPU ray march. */
export function canReadPixels(device: pc.GraphicsDevice): boolean {
  const d = device as unknown as Partial<PixelReader>;
  return !device.isWebGPU && typeof d.readPixels === 'function' && typeof d.updateBegin === 'function' && typeof d.updateEnd === 'function';
}

/**
 * Reads a rectangle of a pick buffer (top-left origin, buffer pixels) as RGBA bytes, rows bottom-up as WebGL stores
 * them (the order doesn't matter to a count).
 */
export function readRect(device: pc.GraphicsDevice, buf: PickBuffer, x: number, y: number, w: number, h: number): Uint8Array {
  const d = device as unknown as PixelReader;
  const out = new Uint8Array(4 * w * h);
  device.setRenderTarget(buf.renderTarget);
  d.updateBegin();
  d.readPixels(x, buf.renderTarget.height - (y + h), w, h, out);
  d.updateEnd();
  return out;
}
