import * as pc from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { POOL_GLOW, POOL_NIGHT, poolGlowAt, poolMaterial, setPoolNight } from '../src/rendering/Water';

/**
 * #563: at night the ponds read pale, like lit ice, on every tier. Night water now darkens to deep moonlit navy (the
 * albedo tinted, the unlit aqua glow faded), on every tier; by day the water is exactly as it was.
 */
describe('night water', () => {
  const param = (name: string) => (poolMaterial().getParameter(name) as { data?: unknown } | undefined)?.data;

  it('by day the water is untouched: no tint, the full aqua glow', () => {
    expect(poolGlowAt(0)).toBe(POOL_GLOW);
    const m = poolMaterial();
    expect(m.emissiveIntensity).toBe(POOL_GLOW);
    expect(param('uPoolNight')).toBe(0);
    setPoolNight(0);
    expect(m.emissiveIntensity).toBe(POOL_GLOW);
  });

  it('by night it darkens to navy and the glow all but goes, on every tier (no tier gate)', () => {
    const m = poolMaterial();
    setPoolNight(1);
    expect(param('uPoolNight')).toBe(1);
    expect(m.emissiveIntensity).toBeCloseTo(POOL_GLOW * POOL_NIGHT.glow, 9);
    expect(m.emissiveIntensity).toBeLessThan(POOL_GLOW * 0.1);
    // the tint is navy: blue strongest, and dark enough to sit under the moonlit ground
    const [r, g, b] = POOL_NIGHT.tint;
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
    expect(Math.max(r, g, b)).toBeLessThan(0.5);
    // dusk is in between, and dawn brings it all back
    setPoolNight(0.5);
    expect(m.emissiveIntensity).toBeGreaterThan(POOL_GLOW * POOL_NIGHT.glow);
    expect(m.emissiveIntensity).toBeLessThan(POOL_GLOW);
    setPoolNight(0);
    expect(m.emissiveIntensity).toBe(POOL_GLOW);
    expect(param('uPoolNight')).toBe(0);
  });

  it('the shader tints by the same navy the constants say', () => {
    const src = poolMaterial().getShaderChunks(pc.SHADERLANGUAGE_GLSL).get('diffusePS');
    expect(src).toContain(`#define POOL_NIGHT_TINT vec3(${POOL_NIGHT.tint.join(', ')})`);
    expect(src).toContain('mix(dAlbedo, dAlbedo * POOL_NIGHT_TINT, uPoolNight)');
  });
});
