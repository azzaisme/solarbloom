import { describe, expect, it } from 'vitest';
import { CAT_SIGHT, SightSchedule, type SightFrame } from '../src/core/CatSight';

/**
 * E23.12.3 (#530): how often the sight pick renders. Game hands SightSchedule.afterFrame a measure that is one
 * SightPicker.measure call: one pick render and one pixel read for every cat passed. Here the measure is a stand-in
 * picker that counts its renders, so the counts below are the pick renders the game would make.
 */

/** A stand-in for the GPU picker: one render per measure call, whatever the number of cats. */
class CountingPicker {
  renders = 0;
  cats: string[][] = [];
  constructor(public px: Record<string, number>) {}
  measure = (ids: string[]) => {
    this.renders++;
    this.cats.push([...ids]);
    return new Map(ids.map((id) => [id, this.px[id] ?? 0]));
  };
}

const setup = (px: Record<string, number> = { a: 400, b: 20 }) => {
  const clock = { t: 1000 };
  const keys: Record<string, string> = { a: 'view1', b: 'view1', c: 'view1' };
  const sched = new SightSchedule((id) => keys[id], () => clock.t);
  const picker = new CountingPicker(px);
  const near = new Set<string>();
  const frame = (over: Partial<SightFrame> = {}) =>
    sched.afterFrame({ known: false, paused: false, cats: ['a', 'b', 'c'], wanted: (id) => near.has(id), ...over }, picker.measure);
  /** n frames 16 ms apart */
  const frames = (n: number, over: Partial<SightFrame> = {}) => {
    for (let i = 0; i < n; i++) {
      clock.t += 16;
      frame(over);
    }
  };
  return { clock, keys, sched, picker, near, frame, frames };
};

describe('when the cat sight pick renders', () => {
  it('none while paused, even with cats near the pointer and something asking', () => {
    const { sched, picker, near, frames } = setup();
    near.add('a').add('b');
    expect(sched.visible('a')).toBe(false); // asked: would be measured after the next frame
    frames(120, { paused: true });
    expect(picker.renders).toBe(0);
    expect(sched.visible('a')).toBe(false);
  });

  it('none once a cat has been found', () => {
    const { sched, picker, near, frames } = setup();
    near.add('a').add('b');
    sched.visible('a');
    frames(120, { known: true });
    expect(picker.renders).toBe(0);
  });

  it('none while no cat is near the pointer or bloombot (and nothing asks)', () => {
    const { picker, frames } = setup();
    frames(600);
    expect(picker.renders).toBe(0);
  });

  it('one render for two cats in range, then none while the view holds still', () => {
    const { sched, picker, near, frame, frames } = setup();
    near.add('a').add('b');
    frame();
    expect(picker.renders).toBe(1);
    expect(picker.cats[0].sort()).toEqual(['a', 'b']);
    expect(sched.visible('a')).toBe(true); // 400 px
    expect(sched.visible('b')).toBe(false); // 20 px: too small to make out
    expect(sched.visible('c')).toBe(false); // never measured: asked
    frames(1); // c was asked: one render for it alone
    expect(picker.renders).toBe(2);
    expect(picker.cats[1]).toEqual(['c']);
    // a still view: the results hold until CAT_SIGHT.maxAgeSeconds, then one render re-measures both
    // a and b were measured one frame before c: 123 more frames leave them 1984 ms old, the next makes them 2000
    frames(Math.floor((CAT_SIGHT.maxAgeSeconds * 1000) / 16) - 2);
    expect(picker.renders).toBe(2);
    frames(1);
    expect(picker.renders).toBe(3);
    expect(picker.cats[2].sort()).toEqual(['a', 'b']);
  });

  it('a moving view re-measures at most every CAT_SIGHT.cacheSeconds, one render for both cats', () => {
    const { keys, picker, near, frame, clock } = setup();
    near.add('a').add('b');
    const steps = Math.round((2 * 1000) / 16); // two seconds of walking
    for (let i = 0; i < steps; i++) {
      clock.t += 16;
      keys.a = keys.b = `view${i}`;
      frame();
    }
    const most = Math.ceil(2 / CAT_SIGHT.cacheSeconds) + 1;
    expect(picker.renders).toBeGreaterThan(1);
    expect(picker.renders).toBeLessThanOrEqual(most);
    for (const ids of picker.cats) expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('a result taken on the frame just drawn answers until the next frame, however long that frame took', () => {
    const { sched, keys, near, frame, clock } = setup();
    near.add('a');
    frame();
    clock.t += 5000; // a very slow frame: older than any cache age
    keys.a = 'moved';
    expect(sched.visible('a')).toBe(true);
  });
});
