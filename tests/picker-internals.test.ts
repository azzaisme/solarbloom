import { describe, expect, it } from 'vitest';
import * as pc from 'playcanvas';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { canReadPixels, pickBuffer } from '../src/rendering/PickerInternals';

/**
 * E23.12.3 (#530): the cat sight pick (rendering/SightPicker) reads PlayCanvas internals through one adapter
 * (rendering/PickerInternals). These checks fail loudly if a PlayCanvas upgrade moves any of them, rather than every
 * hiding cat quietly counting as unseen.
 */
describe('PlayCanvas internals the sight pick relies on', () => {
  /** PlayCanvas's own null device (no GPU in node): a Picker on it sets up its fields the same way. */
  const nullDevice = () => {
    const canvas = { width: 64, height: 64, style: {}, addEventListener() {}, removeEventListener() {}, getContext: () => null } as unknown as HTMLCanvasElement;
    return new pc.NullGraphicsDevice(canvas);
  };
  const nullPicker = () => new pc.Picker({ graphicsDevice: nullDevice(), renderer: {} } as unknown as pc.AppBase, 32, 16);

  it('a Picker keeps its colour target in renderTarget and its id table in mapping', () => {
    const picker = nullPicker();
    const buf = pickBuffer(picker);
    expect(buf, 'pickBuffer found no renderTarget/mapping on pc.Picker: PlayCanvas moved them').toBeDefined();
    expect(buf!.renderTarget.width).toBe(32);
    expect(buf!.renderTarget.height).toBe(16);
    expect(buf!.mapping).toBeInstanceOf(Map);
  });

  it('pickBuffer says so when they are missing (an upgrade that moves them): the sight then falls back to the CPU', () => {
    expect(pickBuffer({} as unknown as pc.Picker)).toBeUndefined();
    expect(pickBuffer({ renderTarget: {}, mapping: new Map() } as unknown as pc.Picker)).toBeUndefined();
  });

  it('the WebGL device reads pixels synchronously (readPixels between updateBegin/updateEnd)', () => {
    const proto = pc.WebglGraphicsDevice.prototype as unknown as Record<string, unknown>;
    for (const name of ['readPixels', 'updateBegin', 'updateEnd', 'setRenderTarget']) expect(typeof proto[name], `WebglGraphicsDevice.${name}`).toBe('function');
    expect(canReadPixels(Object.assign(Object.create(pc.WebglGraphicsDevice.prototype), { isWebGPU: false }) as pc.GraphicsDevice)).toBe(true);
    // WebGPU: no synchronous read, so the CPU ray march is used
    expect(canReadPixels({ isWebGPU: true, readPixels() {}, updateBegin() {}, updateEnd() {} } as unknown as pc.GraphicsDevice)).toBe(false);
  });

  it("the pick pass draws only mesh instances whose pick flag is set (how see-through things are left out)", () => {
    expect(new pc.MeshInstance(new pc.Mesh(nullDevice()), new pc.StandardMaterial()).pick).toBe(true);
    // RenderPassPicker.execute: `if (meshInstance.pick)`, and the ARGB id decode the count mirrors (core/CatSight.countIds)
    const src = readFileSync(createRequire(import.meta.url).resolve('playcanvas'), 'utf8');
    const at = src.indexOf('RenderPassPicker = class');
    expect(at, 'RenderPassPicker class not found in the PlayCanvas build').toBeGreaterThan(0);
    const pass = src.slice(at, src.indexOf('Picker = class', at + 30));
    expect(pass, 'RenderPassPicker no longer filters on meshInstance.pick').toMatch(/if \(meshInstance\.pick\)/);
    expect(src, 'Picker.decodePixels no longer packs ids as (a<<24|r<<16|g<<8|b)').toMatch(/\(a << 24 \| r << 16 \| g << 8 \| b\) >>> 0/);
  });
});
