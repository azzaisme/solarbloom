import { describe, expect, it } from 'vitest';
import { ORBIT, PLAY_TILT, VIEW, tiltedOffset } from '../src/rendering/CameraController';
import { PHOTO, PHOTO_TILT } from '../src/app/PhotoMode';

// Phase 6: the play camera is a 3D orbit around bloombot. Its tilt is the zoom's pitch plus an offset that the
// player turns with a drag or the right stick; the final pitch must stay inside what the camera allows (6–80°).
describe('camera tilt', () => {
  it('adds and subtracts, and stops at the play range', () => {
    expect(tiltedOffset(0, 10)).toBe(10);
    expect(tiltedOffset(10, -4)).toBe(6);
    expect(tiltedOffset(0, 500)).toBe(PLAY_TILT.max);
    expect(tiltedOffset(0, -500)).toBe(PLAY_TILT.min);
    expect(tiltedOffset(PLAY_TILT.max, 5)).toBe(PLAY_TILT.max);
  });

  it("keeps the play view's pitch within the camera's 6–80° at the close view", () => {
    // In play the zoom is fixed beyond the close zoom, so the base pitch is VIEW.closePitch.
    expect(VIEW.closePitch + PLAY_TILT.min).toBeGreaterThanOrEqual(6);
    expect(VIEW.closePitch + PLAY_TILT.max).toBeLessThanOrEqual(80);
    // and it spans nearly level to nearly overhead
    expect(VIEW.closePitch + PLAY_TILT.min).toBeLessThanOrEqual(12);
    expect(VIEW.closePitch + PLAY_TILT.max).toBeGreaterThanOrEqual(70);
  });

  it("photo mode's own range stays inside the camera's limits too", () => {
    expect(PHOTO_TILT).toEqual({ min: PHOTO.tiltMin, max: PHOTO.tiltMax });
    expect(tiltedOffset(0, 999, PHOTO_TILT)).toBe(PHOTO.tiltMax);
    expect(tiltedOffset(0, -999, PHOTO_TILT)).toBe(PHOTO.tiltMin);
  });

  it('drag and stick speeds turn a full screen of drag into a clear but not wild change', () => {
    // 100 px of drag: 35° of turn, 25° of tilt. A full second of stick: 150° turn, 70° tilt.
    expect(100 * ORBIT.yawPerPx).toBeCloseTo(35);
    expect(100 * ORBIT.tiltPerPx).toBeCloseTo(25);
    expect(ORBIT.stickTilt).toBeLessThan(ORBIT.stickYaw);
  });
});
