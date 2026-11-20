import { describe, expect, it, vi } from 'vitest';
import * as pc from 'playcanvas';
import { BOT_CLIPS, REST } from '../src/data/rest';
import { BloombotVisuals } from '../src/rendering/BloombotVisuals';

/**
 * #576: bloombot sits on the bench seat and the charger's pad from the moment it sits down, not 7 cm into the seat
 * or over the pad until its first look (which waits for the 4.7 s sit-down clip); and sitting again while it is
 * still standing up goes straight into the new pose.
 */

function bot() {
  const canvas = { width: 1, height: 1, getContext: () => null, addEventListener() {}, removeEventListener() {}, style: {} };
  const app = new pc.AppBase(canvas as unknown as HTMLCanvasElement);
  const opts = new pc.AppOptions();
  opts.graphicsDevice = new pc.NullGraphicsDevice(canvas as unknown as HTMLCanvasElement);
  opts.componentSystems = [pc.RenderComponentSystem];
  app.init(opts);
  vi.spyOn(app.assets, 'loadFromUrl').mockImplementation(() => {}); // (no model: its clips are given below)
  const v = new BloombotVisuals(app, app.root);
  const inner = v as unknown as {
    clips: Map<string, number>;
    action?: { name: string; until: number };
    loop: string;
    settleUp: number;
    settleOut: number;
    wantUp: number;
    wantOut: number;
  };
  for (const [name, len] of [[BOT_CLIPS.sit, 10.67], [BOT_CLIPS.sitDown, 4.71], [BOT_CLIPS.standUp, 6.17], [BOT_CLIPS.meditate, 2.5]] as const) inner.clips.set(name, len);
  return { app, v, inner };
}

describe('#576: bloombot sits on what it sits on from the start', () => {
  it('on a bench it starts where it has always settled to; meditating, its root is on the pad', () => {
    const { app, v, inner } = bot();
    v.setPose('sit', REST.benchSeat);
    expect([inner.settleUp, inner.wantUp]).toEqual([REST.settle.bench.up, REST.settle.bench.up]);
    expect([inner.settleOut, inner.wantOut]).toEqual([REST.settle.bench.out, REST.settle.bench.out]);
    // only ever comes forward from there, within `most`
    expect(REST.settle.bench.out).toBeGreaterThan(0);
    expect(REST.settle.bench.out).toBeLessThan(REST.settle.most);
    expect(REST.settle.bench.up).toBeLessThan(REST.settle.most);
    v.setPose('meditate');
    expect([inner.settleUp, inner.settleOut]).toEqual([0, 0]);
    // the pad's glowing top is 0.1 up (MachineVisuals.charger): the cross-legged clip sits on its root a hair over it
    expect(REST.padTop).toBeGreaterThan(0.1);
    expect(REST.padTop).toBeLessThan(0.1 + 0.01);
    v.setPose(undefined);
    expect([inner.settleUp, inner.settleOut]).toEqual([0, 0]);
    app.destroy();
  });

  it('without the sit clip (legs bent by hand) it starts from the pose itself', () => {
    const { app, v, inner } = bot();
    inner.clips.delete(BOT_CLIPS.sit);
    v.setPose('sit', REST.benchSeat);
    expect([inner.settleUp, inner.settleOut]).toEqual([0, 0]);
    app.destroy();
  });

  it('meditating while still standing up from the bench: straight into meditating, the stand-up dropped', () => {
    const { app, v, inner } = bot();
    v.setPose('sit', REST.benchSeat);
    v.setPose(undefined);
    inner.action = { name: BOT_CLIPS.standUp, until: 6 }; // (as the stand-up clip sets it once the model is in)
    expect(v.busy).toBe(BOT_CLIPS.standUp);
    v.setPose('meditate');
    expect(v.busy).toBeUndefined();
    expect(inner.loop).toBe('meditate');
    // a gesture (not the stand-up) is never cut short by sitting
    v.setPose(undefined);
    inner.action = { name: 'interact', until: 3 };
    v.setPose('meditate');
    expect(v.busy).toBe('interact');
    app.destroy();
  });

  it('settled only once it sits and its looks are done', () => {
    const { app, v } = bot();
    expect(v.settled).toBe(false);
    v.setPose('meditate');
    expect(v.settled).toBe(false);
    app.destroy();
  });
});
