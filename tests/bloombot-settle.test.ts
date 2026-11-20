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

describe('#576: its settle looks at both ends of the liveliest leg swing', () => {
  it('a shin that dips further at full swing counts, and is put back as drawn', () => {
    const { app, v } = bot();
    // a model with two shins hanging from the knees, 0.5 up: each a box 0.3 long under its bone
    const model = new pc.Entity('model', app);
    v.root.addChild(model);
    const shins = ['LeftLeg', 'RightLeg'].map((name, i) => {
      const b = new pc.Entity(name, app);
      b.setLocalPosition(i ? -0.1 : 0.1, 0.5, 0);
      const box = new pc.Entity(`${name}-mesh`, app);
      box.addComponent('render', { type: 'box' });
      box.setLocalScale(0.05, 0.3, 0.05);
      box.setLocalPosition(0, -0.15, 0);
      b.addChild(box);
      model.addChild(b);
      return b;
    });
    const inner = v as unknown as {
      model?: pc.Entity;
      restingOn?: unknown;
      swung: number;
      swingMost: number;
      measure(): { up: number; out: number };
      measureNow(): { up: number; out: number };
    };
    inner.model = model;
    v.setPose('sit', REST.benchSeat);
    inner.restingOn = { cx: 0, cz: 0, facing: 0, x: [-1, 1], z: [-1, 1], y: [0, 0.1] };
    const before = shins.map((b) => b.getLocalRotation().clone());
    // still: only what is drawn
    inner.swung = 0;
    inner.swingMost = 0;
    const still = inner.measureNow();
    expect(inner.measure()).toEqual(still);
    // swinging (5 degrees now, up to 30): the look takes the most it needs of the drawn pose and both full swings,
    // so never less than the drawn pose alone
    inner.swung = 5;
    inner.swingMost = 30;
    const now = inner.measureNow();
    const m = inner.measure();
    expect(m.up).toBeGreaterThanOrEqual(now.up);
    // and nothing moved: each shin exactly as it was drawn
    shins.forEach((b, i) => {
      const q = b.getLocalRotation();
      expect(Math.abs(q.dot(before[i]))).toBeCloseTo(1, 9);
    });
    app.destroy();
  });

  it('at full swing a knee that dips into the seat counts, though the drawn look misses it', () => {
    const { app, v } = bot();
    const model = new pc.Entity('model', app);
    v.root.addChild(model);
    // a shin bent forward (its box out along +z from the knee): swinging it down brings its end into the seat top
    const shin = new pc.Entity('LeftLeg', app);
    shin.setLocalPosition(0, 0.15, 0);
    const box = new pc.Entity('shin-mesh', app);
    box.addComponent('render', { type: 'box' });
    box.setLocalScale(0.02, 0.02, 0.2);
    box.setLocalPosition(0, 0, 0.1);
    shin.addChild(box);
    model.addChild(shin);
    const inner = v as unknown as { model?: pc.Entity; restingOn?: unknown; swung: number; swingMost: number; measure(): { up: number }; measureNow(): { up: number } };
    inner.model = model;
    v.setPose('sit', REST.benchSeat);
    inner.restingOn = { cx: 0, cz: 0, facing: 0, x: [-1, 1], z: [-1, 1], y: [0, 0.1] };
    inner.swung = 0;
    inner.swingMost = 30;
    // drawn level, its lowest is 0.14 up (over the seat's top at 0.1); swung 30 degrees, its end goes down 0.1
    expect(inner.measureNow().up).toBeLessThan(0);
    expect(inner.measure().up).toBeGreaterThan(inner.measureNow().up + 0.05);
    app.destroy();
  });
});
