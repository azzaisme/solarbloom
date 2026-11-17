import { describe, expect, it } from 'vitest';
import { fileBackedStorage, type StorageLike } from '../src/app/SaveService';
import { DECK, isDeckGpu } from '../src/rendering/Quality';

function mem(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v), removeItem: (k) => void delete data[k] };
}

describe('Steam Deck build (#243)', () => {
  it('recognises the Deck GPUs and not ordinary ones', () => {
    expect(isDeckGpu('ANGLE (AMD, AMD Custom GPU 0405 (radeonsi, vangogh, LLVM 15.0.7), OpenGL 4.6)')).toBe(true);
    expect(isDeckGpu('AMD Custom GPU 0932 (radeonsi, sephiroth)')).toBe(true);
    expect(isDeckGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)')).toBe(false);
    expect(isDeckGpu('ANGLE (AMD, AMD Radeon RX 6600 XT)')).toBe(false);
    expect(isDeckGpu('')).toBe(false);
  });

  it('keeps the preset the issue asks for', () => {
    expect(DECK).toMatchObject({ tier: 'medium', renderScale: 0.75, shadowRes: 1024, detail: 'low' });
  });

  it('imports a browser-storage save into a file once, then uses files only', () => {
    const files = mem();
    const local = mem({ save: 'old-browser-save' });
    const s = fileBackedStorage(files, local);
    expect(s.getItem('save')).toBe('old-browser-save');
    expect(files.data.save).toBe('old-browser-save');
    s.setItem('save', 'new');
    expect(files.data.save).toBe('new');
    expect(local.data.save).toBe('old-browser-save'); // browser storage is never written again
    expect(s.getItem('save')).toBe('new');
  });

  it('a cleared save stays cleared (the import does not bring it back)', () => {
    const files = mem({ save: 'x' });
    const local = mem({ save: 'old' });
    const s = fileBackedStorage(files, local);
    s.removeItem('save');
    expect(s.getItem('save')).toBeNull();
  });

  it('works with no browser storage at all', () => {
    const s = fileBackedStorage(mem());
    expect(s.getItem('save')).toBeNull();
    s.setItem('save', 'a');
    expect(s.getItem('save')).toBe('a');
  });
});
