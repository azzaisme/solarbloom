// The animals that live about the world (Fauna, the ambient butterflies, the flocks, the farm's creatures) are drawn
// with Tripo models (src/rendering/CritterModels.ts): each one named there exists, is rigged and has the clips its
// animals play, and only those main models go in the build.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CRITTER_KINDS, CRITTER_LENGTH } from '../src/rendering/CritterModels';
import { clipsFor } from '../src/rendering/VisitorClips';

const FAUNA = ['duck', 'pigeon', 'rabbit', 'sleeping-cat'];
const file = (kind: string) => `assets/raw/models/${FAUNA.includes(kind) ? 'fauna' : 'visitors'}/${kind}.glb`;
const gltf = (path: string) => {
  const b = readFileSync(path);
  expect(b.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const n = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + n).toString('utf8')) as { animations?: { name?: string }[]; skins?: unknown[] };
};

describe('critter models', () => {
  it('every kind has its model, rigged, with an idle and a way of moving, and a size', () => {
    for (const kind of CRITTER_KINDS) {
      expect(existsSync(file(kind)), `${kind}: ${file(kind)}`).toBe(true);
      expect(existsSync(file(kind).replace('.glb', '.lod1.glb')), `${kind} has its LOD`).toBe(true);
      const j = gltf(file(kind));
      expect(j.skins?.length, `${kind} is rigged`).toBeGreaterThan(0);
      const names = (j.animations ?? []).map((a) => a.name ?? '');
      const c = clipsFor(names);
      expect(c.idle, kind).toBe('idle');
      expect(c.move, kind).toBe('follow');
      expect(CRITTER_LENGTH[kind], kind).toBeGreaterThan(0);
    }
  });

  it('the songbird flies in the flocks: it has a fly clip', () => {
    expect((gltf(file('songbird')).animations ?? []).map((a) => a.name)).toContain('fly');
  });

  it('the loader takes exactly these main models: no LOD or texture file', () => {
    const src = readFileSync('src/rendering/CritterModels.ts', 'utf8');
    const ids = [...src.matchAll(/assets\/raw\/models\/(visitors|fauna)\/\{([^}]+)\}\.glb'/g)].flatMap((m) => m[2].split(',').map((x) => x.trim()));
    expect([...ids].sort()).toEqual([...CRITTER_KINDS].sort());
    for (const id of ids) expect(file(id), id).toContain(FAUNA.includes(id) ? '/fauna/' : '/visitors/');
  });
});
