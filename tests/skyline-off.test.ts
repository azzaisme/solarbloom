import { describe, expect, it } from 'vitest';
import { LOOK } from '../src/data/look';

/** Owner, 20 Nov 2026: the fake far skyline is switched off (Game builds no Skyline while LOOK.skyline is false). */
describe('the distant skyline', () => {
  it('is switched off', () => {
    expect(LOOK.skyline).toBe(false);
  });
});
