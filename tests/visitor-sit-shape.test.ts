import { describe, expect, it } from 'vitest';
import * as pc from 'playcanvas';
import { belowFeet, sittingShape } from '../src/rendering/Visitors';

/**
 * #576: an animal resting on bloombot is fitted with its shape as it sits (its sit clip, across the loop), not as it
 * was drawn when it first came (mid-flight, legs tucked up), so sitting it never sinks into bloombot.
 */

function headless() {
  const canvas = { width: 1, height: 1, getContext: () => null, addEventListener() {}, removeEventListener() {}, style: {} };
  const app = new pc.AppBase(canvas as unknown as HTMLCanvasElement);
  const opts = new pc.AppOptions();
  opts.graphicsDevice = new pc.NullGraphicsDevice(canvas as unknown as HTMLCanvasElement);
  opts.componentSystems = [pc.RenderComponentSystem, pc.AnimComponentSystem];
  app.init(opts);
  return app;
}

/** A track moving the `body` node's local y through `ys` over `duration` seconds (evenly spaced keys). */
function bob(name: string, duration: number, ys: number[]): pc.AnimTrack {
  const times = ys.map((_, i) => (duration * i) / (ys.length - 1));
  const input = new pc.AnimData(1, times);
  const output = new pc.AnimData(3, ys.flatMap((y) => [0, y, 0]));
  const curve = new pc.AnimCurve([{ entityPath: ['body'], component: 'graph', propertyPath: ['localPosition'] }], 0, 0, pc.INTERPOLATION_LINEAR);
  return new pc.AnimTrack(name, duration, [input], [output], [curve]);
}

/** An animal: root > model (anim) > body (a unit box, its underside at the body's y - 0.5). */
function animal(app: pc.AppBase, tracks: pc.AnimTrack[], sit?: string) {
  const root = new pc.Entity('visitor', app);
  app.root.addChild(root);
  const e = new pc.Entity('model', app);
  root.addChild(e);
  const body = new pc.Entity('body', app);
  body.addComponent('render', { type: 'box' });
  e.addChild(body);
  e.addComponent('anim', { activate: true });
  for (const t of tracks) e.anim!.assignAnimation(t.name, t, undefined, 1, true);
  const clips = { idle: 'idle', move: 'follow', sit, climb: 'follow' };
  e.anim!.baseLayer!.transition('follow', 0);
  e.anim!.update(0);
  const model = { holder: e, entity: e, clips, climbFor: 0, sitFor: tracks.find((t) => t.name === sit)?.duration ?? 0, lift: 0, clip: 'follow' as string | undefined };
  return { root, model, body };
}

const lowest = (pts: number[]) => Math.min(...pts.filter((_, i) => i % 3 === 1));
const highest = (pts: number[]) => Math.max(...pts.filter((_, i) => i % 3 === 1));

describe('#576: an animal on bloombot rests as it sits', () => {
  it('its shape is its sit pose across the whole loop, not its flight', () => {
    const app = headless();
    // in flight its body is tucked up (0.3 over its feet); sitting it settles down and breathes (down to 0.05 a
    // little way into the loop, back up to 0.1)
    const a = animal(app, [bob('follow', 1, [0.3, 0.3]), bob('idle', 1, [0.2, 0.2]), bob('sit', 2, [0.1, 0.1, 0.05, 0.1, 0.1])], 'sit');
    expect(a.body.getPosition().y).toBeCloseTo(0.3); // drawn as it flies in
    const { pts, tris } = sittingShape(a);
    // its lowest anywhere in the sit loop (0.05 - 0.5), never its flight (0.3 - 0.5), and its top at the loop's highest
    expect(lowest(pts)).toBeCloseTo(-0.45, 3);
    expect(highest(pts)).toBeCloseTo(0.6, 3);
    expect(lowest(tris)).toBeCloseTo(-0.45, 3);
    // the same corners in each pose merged: a box's 8 corners at the two heights the loop's quarters reach
    expect(pts.length / 3).toBe(8 * 2);
    // and it goes back to its own phase's clip afterwards (animate() picks it again)
    expect(a.model.clip).toBeUndefined();
    app.destroy();
  });

  it('a model without a sit clip, or a placeholder, keeps the shape it is drawn in', () => {
    const app = headless();
    const a = animal(app, [bob('follow', 1, [0.3, 0.3])]);
    const { pts } = sittingShape(a);
    expect(lowest(pts)).toBeCloseTo(-0.2, 3);
    expect(a.model.clip).toBe('follow');
    const p = animal(app, [bob('follow', 1, [0.3, 0.3])]);
    const placeholder = sittingShape({ root: p.root, model: undefined });
    expect(lowest(placeholder.pts)).toBeCloseTo(-0.2, 3);
    app.destroy();
  });

  it('one whose sit pose reaches under its feet is lifted by that sitting beside bloombot', () => {
    expect(belowFeet([0, 0.1, 0, 0, -0.031, 0.02, 0.01, 0.2, 0])).toBeCloseTo(0.031, 9);
    expect(belowFeet([0, 0, 0, 0, 0.05, 0])).toBe(0);
    expect(belowFeet([])).toBe(0);
  });
});
