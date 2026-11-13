export const ease = {
  linear: (k: number) => k,
  outCubic: (k: number) => 1 - Math.pow(1 - k, 3),
  inOutCubic: (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outBack: (k: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  },
  outElastic: (k: number) =>
    k === 0 ? 0 : k === 1 ? 1 : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
};

interface Tween {
  t: number;
  delay: number;
  dur: number;
  fn: (k: number) => void;
  done?: () => void;
  ease: (k: number) => number;
  owner?: object;
}

/** Tiny tween runner. Presentation only — never drives game state. */
export class Tweens {
  private list: Tween[] = [];

  add(dur: number, fn: (k: number) => void, opts: { delay?: number; ease?: (k: number) => number; done?: () => void; owner?: object } = {}) {
    const tw: Tween = { t: 0, delay: opts.delay ?? 0, dur: Math.max(0.0001, dur), fn, done: opts.done, ease: opts.ease ?? ease.outCubic, owner: opts.owner };
    this.list.push(tw);
    if (tw.delay <= 0) fn(tw.ease(0));
    return tw;
  }

  has(owner: object) {
    return this.list.some((t) => t.owner === owner);
  }

  cancel(owner: object) {
    this.list = this.list.filter((t) => t.owner !== owner);
  }

  update(dt: number) {
    if (!this.list.length) return;
    const cur = this.list;
    this.list = []; // tweens added from callbacks land here
    for (const tw of cur) {
      if (tw.delay > 0) {
        tw.delay -= dt;
        if (tw.delay > 0) {
          this.list.push(tw);
          continue;
        }
      }
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(tw.ease(k));
      if (k >= 1) tw.done?.();
      else this.list.push(tw);
    }
  }
}
