// Look 1.4 and 1.11: the colour pipeline is consistent, and graphics tiers are well formed.
import * as pc from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../src/rendering/Materials';
import { lin } from '../src/rendering/ChunkRenderer';
import { LOOK } from '../src/data/look';
import { lowerTier, TIER_ORDER } from '../src/rendering/Quality';

// Look 2 groups the palette into nested families: collect every hex string at any depth.
const flat = (v: unknown): string[] =>
  typeof v === 'string' ? (v.startsWith('#') ? [v] : []) : Array.isArray(v) ? v.flatMap(flat) : v && typeof v === 'object' ? Object.values(v).flatMap(flat) : [];
const hexes = flat(PALETTE);

describe('colour pipeline (Look 1.4)', () => {
  it('vertex colours linearise palette hexes exactly like standard materials do', () => {
    for (const hex of hexes) {
      // StandardMaterial uploads diffuse through Color.linear() (pow 2.2); chunk meshes store lin() in 8 bits.
      const m = new pc.Color().fromString(hex).linear();
      const [r, g, b] = lin(hex);
      expect(Math.abs(r - m.r)).toBeLessThan(1e-9);
      expect(Math.abs(g - m.g)).toBeLessThan(1e-9);
      expect(Math.abs(b - m.b)).toBeLessThan(1e-9);
    }
  });
});

describe('graphics tiers (Look 1.11)', () => {
  it('step down Low ← Medium ← High and stop at Low', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBe('low');
  });

  it('never get more expensive going down a tier', () => {
    const order = TIER_ORDER.map((t) => LOOK.tiers[t]);
    for (let i = 1; i < order.length; i++) {
      const lo = order[i - 1];
      const hi = order[i];
      expect(lo.shadowRes).toBeLessThanOrEqual(hi.shadowRes);
      expect(lo.samples).toBeLessThanOrEqual(hi.samples);
      for (const k of ['post', 'bloom', 'ssao', 'dof', 'softShadows'] as const) if (lo[k]) expect(hi[k]).toBe(true);
      expect(LOOK.atmosphere.motes[TIER_ORDER[i - 1]]).toBeLessThanOrEqual(LOOK.atmosphere.motes[TIER_ORDER[i]]);
    }
    // Phones (Low) get no post-processing and no motes; High gets the full stack.
    expect(LOOK.tiers.low.post).toBe(false);
    expect(LOOK.atmosphere.motes.low).toBe(0);
    // Phase 6: no depth of field during normal play (kept for a photo mode)
    expect(LOOK.tiers.high).toMatchObject({ post: true, bloom: true, ssao: true, dof: false });
  });
});
