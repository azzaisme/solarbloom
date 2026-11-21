import * as pc from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { MODEL_STALL_MS, ModelLibrary } from '../src/rendering/Models';

/**
 * #567: a second game in the same browser faded in with models missing, because the loading screen gave up on them
 * after a fixed 30 s. Now it waits for every model still arriving, however slow, and stops only when they have all
 * loaded or failed, or when nothing has finished for MODEL_STALL_MS (truly stuck requests).
 */
type Cb = (err: string | null, asset?: pc.Asset) => void;

function library() {
  let t = 0;
  const calls: { url: string; cb: Cb }[] = [];
  const app = { assets: { loadFromUrl: (url: string, _type: string, cb: Cb) => calls.push({ url, cb }) } } as unknown as pc.AppBase;
  const lib = new ModelLibrary(app, () => t);
  lib.load();
  const ok = (i: number) => calls[i].cb(null, { resource: { materials: [], instantiateRenderEntity: () => ({ syncHierarchy() {}, children: [], destroy() {} }) } } as unknown as pc.Asset);
  const fail = (i: number) => calls[i].cb('404');
  return { lib, calls, ok, fail, at: (ms: number) => (t = ms) };
}

describe('the loading screen waits for the models (#567)', () => {
  it('keeps waiting past 30 s while models are still arriving, and is done when the last one lands', () => {
    const { lib, calls, ok, at } = library();
    expect(calls.length).toBeGreaterThan(10);
    // a slow second start: one file every 10 s, well past the old 30 s give-up
    for (let i = 0; i < calls.length - 1; i++) {
      at((i + 1) * 10000);
      ok(i);
      expect(lib.waitOver(), `after file ${i} at ${(i + 1) * 10} s`).toBe(false);
    }
    at(calls.length * 10000);
    ok(calls.length - 1);
    expect(lib.ready).toBe(true);
    expect(lib.waitOver()).toBe(true);
    expect(lib.failed.size).toBe(0);
  });

  it('gives up only on files that truly failed: they are counted, and the rest still load', () => {
    const { lib, calls, ok, fail, at } = library();
    fail(0);
    fail(1);
    at(5000);
    expect(lib.waitOver()).toBe(false); // a failure doesn't end the wait for the others
    for (let i = 2; i < calls.length; i++) ok(i);
    expect(lib.waitOver()).toBe(true);
    expect(lib.failed.size).toBe(2);
    expect(lib.loaded.size).toBeGreaterThan(0);
  });

  it('stops waiting when nothing has finished for MODEL_STALL_MS (stuck requests), not before', () => {
    const { lib, ok, at } = library();
    at(20000);
    ok(0);
    at(20000 + MODEL_STALL_MS);
    expect(lib.waitOver()).toBe(false);
    at(20000 + MODEL_STALL_MS + 1);
    expect(lib.waitOver()).toBe(true);
    expect(lib.ready).toBe(false);
    // stuck from the very start counts the same way
    const fresh = library();
    fresh.at(MODEL_STALL_MS + 1);
    expect(fresh.lib.waitOver()).toBe(true);
  });
});

describe('a model asked for before it has loaded', () => {
  it('gives nothing yet and caches nothing, so it draws once it lands (a dozing Keeper\'s stone block floated)', () => {
    const { lib, calls, ok } = library();
    // its far (LOD1) file lands first: the model has an entry, but its near meshes haven't arrived
    const far = calls.findIndex((c) => /stone-block\.lod1/.test(c.url));
    expect(far, 'stone-block.lod1 is a startup file').toBeGreaterThanOrEqual(0);
    ok(far);
    const models = (lib as unknown as { models: Map<string, { parts: unknown[][]; merged: unknown[] }> }).models;
    const m = models.get('stone-block');
    expect(m).toBeDefined();
    expect(m!.parts[0].length).toBe(0); // not arrived yet
    expect(lib.batchParts('stone-block')).toEqual([]);
    expect(lib.batchParts('stone-block', true)).toEqual([]);
    expect(m!.merged[0]).toBeUndefined(); // nothing kept: the first call after it lands merges the real parts
    expect(m!.merged[1]).toBeUndefined();
  });
});
