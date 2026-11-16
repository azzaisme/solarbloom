// Look 1.4 and 1.11: the colour pipeline is consistent, and graphics tiers are well formed.
import * as pc from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../src/rendering/Materials';
import { lin } from '../src/rendering/ChunkRenderer';

const hexes = Object.values(PALETTE).flatMap((v) => (Array.isArray(v) ? v : [v]));

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
