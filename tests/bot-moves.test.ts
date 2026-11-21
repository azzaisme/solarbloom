import { describe, expect, it } from 'vitest';
import { MOVES } from '../src/data/botMotion';
import { BotMoves, type MoveIn } from '../src/rendering/BotMoves';

const DT = 1 / 60;
const base = (o: Partial<MoveIn> = {}): MoveIn => ({ pace: 0, accel: 0, walk: 2.6, run: 4.6, climb: 0, wading: false, still: 0, reduced: false, ...o });

/** Runs `secs` of frames, `at(t)` giving the input each frame; returns what `read` saw each frame. */
function run<T>(m: BotMoves, secs: number, at: (t: number) => Partial<MoveIn>, read: (m: BotMoves) => T): T[] {
  const out: T[] = [];
  for (let t = 0; t < secs; t += DT) {
    m.update(DT, base(at(t)));
    out.push(read(m));
  }
  return out;
}

/** Speeds up to a walk, walks, then brakes to a stop (as the Stride does). */
const walkThenStop = (t: number): Partial<MoveIn> => {
  if (t < 0.16) return { pace: 16 * t, accel: 16 };
  if (t < 1) return { pace: 2.6, accel: 0 };
  const b = 2.6 - 14 * (t - 1);
  return b > 0 ? { pace: b, accel: -14 } : { pace: 0, accel: 0 };
};

describe('#671: starting and stopping', () => {
  it('leans in to set off, and stopping carries on forward, rocks back past upright and settles', () => {
    const m = new BotMoves();
    const lean = run(m, 2.4, walkThenStop, (m) => m.look.body.lean);
    const at = (t: number) => lean[Math.round(t / DT)];
    expect(Math.max(...lean.slice(0, 20))).toBeGreaterThan(3); // the lean-in setting off
    const stop = Math.round(1 / DT);
    const after = lean.slice(stop);
    expect(Math.max(...after)).toBeGreaterThan(5); // forward as it brakes
    expect(Math.min(...after)).toBeLessThan(-0.8); // the rock back
    expect(Math.abs(at(2.35))).toBeLessThan(0.5); // settled
    expect(Math.max(...lean.map(Math.abs))).toBeLessThanOrEqual(MOVES.lean.most);
  });

  it('reduced motion: no lean-in and no rock back', () => {
    const m = new BotMoves();
    const lean = run(m, 2.4, (t) => ({ ...walkThenStop(t), reduced: true }), (m) => m.look.body.lean);
    expect(Math.max(...lean.map(Math.abs))).toBeLessThan(0.01);
  });
});

describe('#671: walk and run', () => {
  it('blends the run in by speed, not a switch', () => {
    const m = new BotMoves();
    const w = (pace: number) => m.update(DT, base({ pace })).run;
    expect(w(2.6)).toBe(0);
    expect(w(4.6)).toBe(1);
    const mid = [3, 3.4, 3.8, 4.2].map(w);
    for (let i = 1; i < mid.length; i++) expect(mid[i]).toBeGreaterThan(mid[i - 1]);
    expect(mid[0]).toBeGreaterThan(0);
    expect(mid[3]).toBeLessThan(1);
  });

  it('running leans forward, trails the arms back with bent elbows and streams the leaves', () => {
    const m = new BotMoves();
    const l = run(m, 1.5, () => ({ pace: 4.6 }), (m) => ({ ...m.look, body: { ...m.look.body }, arms: { ...m.look.arms } })).at(-1)!;
    expect(l.body.lean).toBeCloseTo(MOVES.run.lean, 0);
    expect(l.arms.lRaise).toBeLessThan(-20);
    expect(l.arms.rElbow).toBeGreaterThan(30);
    expect(l.armW).toBeGreaterThan(0.5);
    expect(l.leaves).toBeGreaterThan(MOVES.run.leaves - MOVES.run.flutter - 1e-9);
    // walking: the clip's own arms and leaves
    const w = new BotMoves();
    const lw = run(w, 1, () => ({ pace: 2.6 }), (m) => ({ armW: m.look.armW, leaves: m.look.leaves })).at(-1)!;
    expect(lw.armW).toBe(0);
    expect(lw.leaves).toBe(0);
  });
});

describe('#671: the ground', () => {
  it('leans into a climb, back a little going down, and lifts the swinging foot uphill', () => {
    const up = new BotMoves();
    const down = new BotMoves();
    const lu = run(up, 2, () => ({ pace: 2.6, climb: 0.5 }), (m) => [m.look.body.lean, m.look.swingLift]).at(-1)!;
    const ld = run(down, 2, () => ({ pace: 2.6, climb: -0.5 }), (m) => m.look.body.lean).at(-1)!;
    expect(lu[0]).toBeGreaterThan(4);
    expect(ld).toBeLessThan(-2);
    expect(lu[1]).toBeGreaterThan(5);
  });

  it('wading: careful high steps and the arms out, eased in', () => {
    const m = new BotMoves();
    const first = m.update(DT, base({ pace: 1.5, wading: true })).wade;
    expect(first).toBeLessThan(0.2);
    const l = run(m, 2, () => ({ pace: 1.5, wading: true }), (m) => ({ wade: m.look.wade, lift: m.look.swingLift, out: m.look.arms.lOut, w: m.look.armW })).at(-1)!;
    expect(l.wade).toBeGreaterThan(0.95);
    expect(l.lift).toBeGreaterThan(MOVES.wade.lift * 0.9);
    expect(l.out).toBeGreaterThan(20);
    expect(l.w).toBeGreaterThan(0.5);
  });

  it('landing: a crouch, then a little hop back up, done in about half a second', () => {
    const m = new BotMoves();
    m.land(1);
    const r = run(m, 0.8, () => ({}), (m) => [m.look.body.knee, m.look.up]);
    expect(Math.max(...r.map((x) => x[0]))).toBeGreaterThan(MOVES.land.knee * 0.9);
    expect(Math.max(...r.map((x) => x[1]))).toBeGreaterThan(MOVES.land.hop * 0.8);
    expect(r.at(-1)).toEqual([0, 0]);
    const q = new BotMoves();
    q.land(1);
    const rq = run(q, 0.8, () => ({ reduced: true }), (m) => m.look.up);
    expect(Math.max(...rq)).toBe(0);
  });
});

describe('#671: bumping into a wall', () => {
  it('recoils back once, and not again while it holds into the wall', () => {
    const m = new BotMoves();
    expect(m.bump()).toBe(true);
    const r = run(m, 0.6, () => ({}), (m) => m.look.back);
    expect(Math.max(...r)).toBeGreaterThan(MOVES.bump.back * 0.9);
    expect(r.at(-1)).toBe(0);
    expect(m.bump()).toBe(false); // still holding into it, 0.6 s on
    run(m, 0.4, () => ({}), () => 0);
    expect(m.bump()).toBe(true); // a fresh walk into it, a moment later
  });
});

describe('#671: idle moments', () => {
  it('none before a while standing; then looking around, a stretch, looking again, shaking off dust', () => {
    const m = new BotMoves();
    const seen: string[] = [];
    let still = 0;
    for (let t = 0; t < 40; t += DT) {
      still += DT;
      const l = m.update(DT, base({ still }));
      if (t < MOVES.idle.after - 0.05) expect(l.idle).toBeUndefined();
      if (l.idle && seen.at(-1) !== l.idle) seen.push(l.idle);
    }
    expect(seen.slice(0, 4)).toEqual(['look', 'stretch', 'look', 'shake']);
  });

  it('any play input ends one at once (a quick fade), and the wait starts again', () => {
    const m = new BotMoves();
    let still = 0;
    for (let t = 0; t < MOVES.idle.after + 0.5; t += DT) m.update(DT, base({ still: (still += DT) }));
    expect(m.look.idle).toBe('look');
    const r = run(m, 0.5, () => ({ still: 0 }), (m) => m.look.idle);
    expect(r.findIndex((x) => x === undefined)).toBeLessThanOrEqual(Math.ceil(MOVES.idle.fade / DT) + 1);
    // standing again: nothing until the full wait has passed
    still = 0;
    const again = run(m, MOVES.idle.after - 0.1, () => ({ still: (still += DT) }), (m) => m.look.idle);
    expect(again.every((x) => x === undefined)).toBe(true);
  });

  it('reduced motion: only looking around', () => {
    const m = new BotMoves();
    const seen = new Set<string>();
    let still = 0;
    for (let t = 0; t < 40; t += DT) {
      const l = m.update(DT, base({ still: (still += DT), reduced: true }));
      if (l.idle) seen.add(l.idle);
    }
    expect([...seen]).toEqual(['look']);
  });
});
