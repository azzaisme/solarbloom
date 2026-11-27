import { describe, expect, it, vi } from 'vitest';
import * as pc from 'playcanvas';
import { BOT_CLIPS, REST, seatFeet, seatRamp } from '../src/data/rest';
import { BloombotVisuals } from '../src/rendering/BloombotVisuals';
import { BOT } from '../src/gameplay/Walker';
import { Skeleton } from './helpers/gltfPose';

// Getting onto a bench: bloombot stands in front of the seat while the sit-down clip turns it round, and only comes
// back onto the seat (and up to its height) as the clip's hips come down; standing up is the same backwards.
// Before this it was put on the seat, lifted to its height, at once, so for the clip's first two seconds it stood
// inside the bench and then sank slowly into place.

const bot = new Skeleton('assets/raw/bloombot/bloombot.glb');
/** The hips' height above the feet `t` seconds into a clip, as a share of the way from seated (0) to standing (1). */
function hipsUp(clip: string, t: number): number {
  const stand = bot.pose('sit-down', 0);
  const seated = bot.pose('sit', 0);
  const h = (p: Record<string, number[]>) => p.Hips[1] - Math.min(p.LeftToeBase[1], p.RightToeBase[1]);
  return (h(bot.pose(clip, t)) - h(seated)) / (h(stand) - h(seated));
}

describe('getting onto a bench', () => {
  it('comes onto the seat only while the sit-down clip brings its hips down', () => {
    const [from, to] = REST.onto.down;
    expect(to).toBeLessThan(bot.clipLength('sit-down'));
    // still standing all the time it is on the ground in front of the seat
    for (let t = 0; t <= from; t += 0.1) expect(hipsUp('sit-down', t), `${t.toFixed(1)} s in`).toBeGreaterThan(0.85);
    // and seated by the time it is all the way onto the seat
    expect(hipsUp('sit-down', to)).toBeLessThan(0.15);
    expect(seatRamp(from, REST.onto.down)).toBe(0);
    expect(seatRamp(to, REST.onto.down)).toBe(1);
  });

  it('comes off the seat only while the stand-up clip raises its hips', () => {
    const [from, to] = REST.onto.up;
    expect(to).toBeLessThan(bot.clipLength('stand-up'));
    for (let t = 0; t <= from; t += 0.1) expect(hipsUp('stand-up', t), `${t.toFixed(1)} s in`).toBeLessThan(0.15);
    expect(hipsUp('stand-up', to)).toBeGreaterThan(0.85);
  });

  it('eases from 0 to 1 across its window, never back', () => {
    let last = 0;
    for (let t = 0; t <= 5; t += 0.05) {
      const k = seatRamp(t, REST.onto.down);
      expect(k).toBeGreaterThanOrEqual(last);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
      last = k;
    }
    expect(last).toBe(1);
  });

  it('stands clear of the seat in front of it, then comes back onto it', () => {
    for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const seat = { x: 4.5 + Math.sin(facing) * REST.seat.out, z: 7.5 + Math.cos(facing) * REST.seat.out, facing };
      const on = seatFeet(seat, REST.onto.step, 1);
      expect(on.x).toBeCloseTo(seat.x, 6);
      expect(on.z).toBeCloseTo(seat.z, 6);
      // in front: out along the way it faces, far enough that its round body is off the seat's front edge
      const off = seatFeet(seat, REST.onto.step, 0);
      const ahead = (off.x - 4.5) * Math.sin(facing) + (off.z - 7.5) * Math.cos(facing);
      const seatFront = REST.benchSolids[0].z[1];
      expect(ahead - BOT.radius).toBeGreaterThan(seatFront);
      // halfway: halfway back
      const mid = seatFeet(seat, REST.onto.step, 0.5);
      expect(Math.hypot(mid.x - on.x, mid.z - on.z)).toBeCloseTo(REST.onto.step / 2, 6);
    }
  });
});

function visuals() {
  const canvas = { width: 1, height: 1, getContext: () => null, addEventListener() {}, removeEventListener() {}, style: {} };
  const app = new pc.AppBase(canvas as unknown as HTMLCanvasElement);
  const opts = new pc.AppOptions();
  opts.graphicsDevice = new pc.NullGraphicsDevice(canvas as unknown as HTMLCanvasElement);
  opts.componentSystems = [pc.RenderComponentSystem];
  app.init(opts);
  vi.spyOn(app.assets, 'loadFromUrl').mockImplementation(() => {}); // (no model: the clip is given below)
  const v = new BloombotVisuals(app, app.root);
  const inner = v as unknown as { clips: Map<string, number>; action?: { name: string; until: number; at?: number }; clock: number };
  return { app, v, inner };
}

describe('how far onto the seat it is drawn', () => {
  it('stays off the seat while the sit-down clip turns it round, and is on it once the hips are down', () => {
    const { app, v, inner } = visuals();
    v.setPose('sit', REST.benchSeat);
    inner.action = { name: BOT_CLIPS.sitDown, until: 4.5, at: 0 }; // (as the clip sets it once the model is in)
    for (const [t, want] of [[0, 0], [1.5, 0], [REST.onto.down[0], 0], [REST.onto.down[1], 1]] as const) {
      inner.clock = t;
      expect(v.seatShare, `${t} s in`).toBeCloseTo(want, 6);
    }
    inner.clock = (REST.onto.down[0] + REST.onto.down[1]) / 2;
    expect(v.seatShare).toBeCloseTo(0.5, 6);
    // once the clip is over it is simply on the seat; standing, off it
    inner.action = undefined;
    expect(v.seatShare).toBe(1);
    v.setPose(undefined);
    expect(v.seatShare).toBe(0);
    app.destroy();
  });
});

describe('legs out over the edge', () => {
  it('holds its shins forward enough to clear the seat across its whole swing', () => {
    // measured in the game on the park bench: hanging lower than about 55 degrees, the shins go into the seat's
    // front edge once it sits back against the backrest
    const s = REST.legSwing;
    expect(s.lift - s.degrees).toBeGreaterThanOrEqual(55);
    // and never kicked up past level with the seat
    expect(s.lift + s.degrees).toBeLessThanOrEqual(90);
  });

  it('starts settling about where it sits back against the backrest, not out at the seat edge', () => {
    // the seat's front edge is REST.benchSolids[0].z[1] ahead of the bench's middle; sitting at `seat.out` and settled
    // `bench.out` further forward, its middle stays well back on the seat
    const edge = REST.benchSolids[0].z[1];
    expect(REST.seat.out + REST.settle.bench.out - 0.12).toBeLessThan(edge);
  });
});
