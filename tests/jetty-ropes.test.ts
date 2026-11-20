import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANDING } from '../src/data/oldcity';
import { onJetty, seaCell } from '../src/core/OldCityLayout';

/**
 * The Landing's jetty (assets/raw/models/final/jetty.glb, its LOD too) runs 8 m along its +X and 5.2 m across its Z
 * (glTF, Y up), deck 1.7 m up. Its ropes run post to post along both side edges; the one rope that crosses the deck is
 * the rail across its +X end. It was placed backwards (turned π/2), which put that end rail at the beach, sagging
 * across the planks where bloombot starts. The end rail belongs out at sea.
 */
function ropeVerts(file: string): [number, number][] {
  const b = readFileSync(file);
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
  const bin = b.subarray(20 + len + 8);
  const acc = j.accessors[j.meshes[0].primitives[0].attributes.POSITION];
  const view = j.bufferViews[acc.bufferView];
  const off = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: [number, number][] = [];
  for (let i = 0; i < acc.count; i++) {
    const at = off + i * 12;
    // above the deck: posts, ropes and the bollard
    if (bin.readFloatLE(at + 4) >= 1.9) out.push([bin.readFloatLE(at), bin.readFloatLE(at + 8)]);
  }
  return out;
}

/** Where the model's +X end points in the world under a turn about +Y (PlayCanvas: +X → (cos, 0, −sin)). */
const plusX = (yaw: number) => [Math.cos(yaw), -Math.sin(yaw)] as const;

describe('the jetty ropes run along its side edges', () => {
  for (const name of ['jetty', 'jetty.lod1']) {
    it(`${name}: the only rope over the walkway's middle is the rail across its +X end`, () => {
      const v = ropeVerts(`assets/raw/models/final/${name}.glb`);
      expect(v.length).toBeGreaterThan(100);
      const middle = v.filter(([, z]) => Math.abs(z) < 0.9);
      expect(middle.length).toBeGreaterThan(0);
      for (const [x] of middle) expect(x).toBeGreaterThan(2);
    });
  }

  it('the jetty is turned so that end rail is out at sea, not at the beach where bloombot starts', () => {
    const J = LANDING.jetty;
    const [dx, dz] = plusX(LANDING.jettyYaw);
    // the end rail points south, along the jetty, away from the beach
    expect(dx).toBeCloseTo(0, 6);
    expect(dz).toBeCloseTo(1, 6);
    // south of the jetty is sea; its other end meets the beach, by the spawn
    expect(seaCell(J.x + 1, J.z + J.d)).toBe(true);
    expect(onJetty(LANDING.spawn[0], LANDING.spawn[1])).toBe(true);
    expect(LANDING.spawn[1]).toBeLessThan(J.z + J.d / 2);
  });
});
