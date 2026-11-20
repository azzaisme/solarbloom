// E23.10 batch B4 (#415 follow-up): every visitor has its own model (or is on purpose a placeholder), each model
// carries the clips the visitors play, and the clip for each moment is the right one (src/rendering/VisitorClips.ts).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ON_BOT, PLACEHOLDER_ONLY, VISITOR_LOOK, VISITORS, type Perch } from '../src/data/wildlife';
import { clipsFor, loops, pickClip, SITTING, visitorPhase } from '../src/rendering/VisitorClips';

const DIR = 'assets/raw/models/visitors';
const file = (id: string) => `${DIR}/${id}.glb`;
/** a GLB's JSON chunk */
const gltf = (path: string) => {
  const b = readFileSync(path);
  expect(b.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const n = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + n).toString('utf8')) as { animations?: { name?: string }[]; skins?: unknown[] };
};

describe('visitor models', () => {
  it('every visitor has its own model, or is a placeholder on purpose', () => {
    for (const v of VISITORS) {
      if (PLACEHOLDER_ONLY.includes(v.id)) expect(existsSync(file(v.id)), `${v.id} is placeholder-only but has a model`).toBe(false);
      else expect(existsSync(file(v.id)), `${v.id} has no model at ${file(v.id)}`).toBe(true);
      expect(VISITOR_LOOK[v.id], `${v.id} has a size`).toBeDefined();
    }
  });

  it('no model ships for anything that is not a visitor (the koi is for the ponds)', () => {
    const ids = VISITORS.map((v) => v.id);
    const glbs = readdirSync(DIR).filter((f) => f.endsWith('.glb'));
    for (const f of glbs) expect(ids, `${f} is not a visitor`).toContain(f.replace(/\.glb$/, ''));
    expect(glbs).not.toContain('koi.glb');
    expect(readdirSync(DIR).filter((f) => !f.endsWith('.glb'))).toEqual([]); // (no LOD or texture side files)
  });

  it('each model is rigged and has the clips the visitors play: idle, follow, sit and climb', () => {
    for (const v of VISITORS) {
      if (PLACEHOLDER_ONLY.includes(v.id)) continue;
      const j = gltf(file(v.id));
      expect(j.skins?.length, `${v.id} is rigged`).toBeGreaterThan(0);
      const names = (j.animations ?? []).map((a) => a.name ?? '');
      const c = clipsFor(names);
      expect(c, v.id).toEqual({ idle: 'idle', move: 'follow', sit: 'sit', climb: 'climb' });
    }
  });
});

describe('which clip plays', () => {
  const b4 = clipsFor(['idle', 'follow', 'sit', 'climb']);
  const phase = (perch: Perch, o: Partial<{ moving: boolean; leaving: boolean; toGo: number; climbFor: number }> = {}) =>
    visitorPhase({ moving: false, leaving: false, toGo: 0, climbFor: 0.9, perch, ...o });

  it('travelling in or out: follow', () => {
    for (const perch of ['head', 'sniff', 'beside', 'perchNear', 'passBy'] as Perch[]) {
      expect(phase(perch, { moving: true, toGo: 2 })).toBe('move');
      expect(phase(perch, { moving: true, leaving: true, toGo: -5 })).toBe('move');
    }
    expect(b4.move).toBe('follow');
  });

  it('the last moment onto a perch on bloombot: climb, once; never onto the ground, nor on the way out', () => {
    for (const perch of ON_BOT) {
      expect(phase(perch, { moving: true, toGo: 0.5 })).toBe('climb');
      expect(phase(perch, { moving: true, toGo: 1.5 })).toBe('move');
      expect(phase(perch, { moving: true, leaving: true, toGo: -1 })).toBe('move');
      expect(phase(perch, { moving: true, toGo: 0.5, climbFor: 0 })).toBe('move'); // (a model without a climb)
    }
    for (const perch of ['sniff', 'beside', 'perchNear', 'passBy'] as Perch[]) expect(phase(perch, { moving: true, toGo: 0.2 })).toBe('move');
    expect(b4.climb).toBe('climb');
    expect(loops('climb', b4)).toBe(false);
    for (const c of ['idle', 'follow', 'sit']) expect(loops(c, b4)).toBe(true);
  });

  it('settled on bloombot or beside it: sit; anywhere else: idle', () => {
    for (const perch of SITTING) expect(phase(perch)).toBe('sit');
    expect(SITTING).toEqual(expect.arrayContaining([...ON_BOT, 'beside']));
    for (const perch of ['sniff', 'perchNear'] as Perch[]) expect(phase(perch)).toBe('idle');
    expect(b4.sit).toBe('sit');
    expect(b4.idle).toBe('idle');
  });

  it('a model with fewer clips falls back: climb to follow, follow and sit to idle, idle to its first clip', () => {
    expect(clipsFor(['idle', 'walk'])).toEqual({ idle: 'idle', move: 'walk', sit: 'idle', climb: 'walk' });
    expect(clipsFor(['Armature|fly', 'Armature|perch'])).toEqual({ idle: 'Armature|fly', move: 'Armature|fly', sit: 'Armature|perch', climb: 'Armature|fly' });
    expect(clipsFor(['wiggle'])).toEqual({ idle: 'wiggle', move: 'wiggle', sit: 'wiggle', climb: 'wiggle' });
    expect(clipsFor([])).toEqual({ idle: undefined, move: undefined, sit: undefined, climb: undefined });
    // a climb that is the same clip as the move keeps looping
    expect(loops('walk', clipsFor(['idle', 'walk']))).toBe(true);
  });

  it('exact names win over ones that only contain them', () => {
    expect(pickClip(['sit-down', 'sit'], ['sit'])).toBe('sit');
    expect(pickClip(['Take|follow'], ['follow'])).toBe('Take|follow');
  });
});
