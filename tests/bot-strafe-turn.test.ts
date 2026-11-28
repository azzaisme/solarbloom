import { beforeAll, describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';
import { wrapAngle } from '../src/gameplay/Turner';

/** Anything asked of it does nothing (the drawing and the camera are not what this tests). */
const stub = (fields: Record<string, unknown> = {}) =>
  new Proxy(fields, { get: (t, k) => (k in t ? t[k as string] : () => undefined) }) as never;

beforeAll(() => {
  (globalThis as { window?: unknown }).window ??= { addEventListener: () => {} };
});

/**
 * Holding a piece to build, Bloombot faces the way the camera looks. Go home puts the piece away, then turns Bloombot
 * to face the park, in one step: the turn must win. It lost while "aiming" was a flag Game set after Bloombot's update,
 * still saying "aiming" for the first frame after the piece was put away.
 */
describe('putting a piece away and turning at once', () => {
  it('Bloombot turns where it was asked, not the way the camera looks', async () => {
    const { BotController } = await import('../src/app/BotController');
    const { Bindings } = await import('../src/app/Bindings');
    const sim = new Sim(createInitialState(7));
    sim.areas.clear(PARK, true);
    sim.bot = { roofId: GROUND, x: 4.5, z: 6.5 };
    const yaw = 45; // the camera looks this way; aiming, Bloombot faces atan2(-sin, -cos) of it
    const cameraWay = wrapAngle(Math.atan2(-Math.sin((yaw * Math.PI) / 180), -Math.cos((yaw * Math.PI) / 180)));
    const bot = new BotController(sim, stub({ yaw }), stub({ busy: undefined, seatShare: 0, reducedMotion: false }), new Bindings());
    let tool = 'decor:pot';
    bot.strafe = () => tool !== 'inspect' && tool !== 'pulse';
    const frames = (n: number) => {
      for (let i = 0; i < n; i++) bot.update(1 / 30);
    };

    frames(150); // holding the pot: it has turned to the camera's way
    expect(Math.abs(wrapAngle(bot.pose.facing - cameraWay))).toBeLessThan(1e-3);

    // Go home: the piece put away, Bloombot on its doorstep, turning to face the park (0), all before the next frame
    tool = 'inspect';
    bot.teleport(GROUND, 4.5, 6.6);
    bot.turnTo(0);
    frames(150);
    expect(Math.abs(wrapAngle(bot.pose.facing))).toBeLessThan(1e-3);
  });
});
