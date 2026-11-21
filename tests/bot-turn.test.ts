import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TURN, TURN_LOOK } from '../src/data/botMotion';
import { Stride, Turner, wrapAngle } from '../src/gameplay/Turner';
import { stepPhase, turnLook } from '../src/rendering/BotTurn';

const DT = 1 / 60;

/** Turns until it gets there (or `most` seconds); returns the time taken and the fastest it turned. */
function turnFully(t: Turner, pose: { facing: number }, most = 3) {
  let time = 0;
  let fastest = 0;
  let firstStep = -1;
  while (t.turning && time < most) {
    const was = pose.facing;
    t.update(DT);
    if (firstStep < 0) firstStep = Math.abs(wrapAngle(pose.facing - was));
    fastest = Math.max(fastest, Math.abs(t.vel));
    time += DT;
  }
  return { time, fastest, firstStep };
}

describe('#670: the turner', () => {
  it('never snaps: an about-turn from standing takes a readable moment, at no more than the top rate', () => {
    const pose = { facing: 0 };
    const t = new Turner(pose);
    t.face(Math.PI);
    const r = turnFully(t, pose);
    expect(r.fastest).toBeLessThanOrEqual(TURN.rate + 1e-9);
    expect(r.time).toBeGreaterThan(0.45);
    expect(r.time).toBeLessThan(0.75);
    // it eases in: the first frame turns no more than the acceleration allows
    expect(r.firstStep).toBeLessThanOrEqual(TURN.accel * DT * DT + 1e-9);
    expect(Math.abs(wrapAngle(pose.facing - Math.PI))).toBeLessThan(1e-6);
  });

  it('eases out: it slows down as it arrives and stops on the goal without overshooting', () => {
    const pose = { facing: 0 };
    const t = new Turner(pose);
    t.face(Math.PI / 2);
    let most = 0;
    let lastVel = 0;
    while (t.turning) {
      t.update(DT);
      most = Math.max(most, pose.facing);
      if (t.turning) lastVel = Math.abs(t.vel);
    }
    expect(most).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    expect(lastVel).toBeLessThan(TURN.rate / 2);
  });

  it('small corrections are quick; 90° about a third of a second', () => {
    for (const [deg, lo, hi] of [
      [30, 0.12, 0.3],
      [90, 0.25, 0.45],
    ]) {
      const pose = { facing: 0 };
      const t = new Turner(pose);
      t.face((deg * Math.PI) / 180);
      const r = turnFully(t, pose);
      expect(r.time, `${deg}°`).toBeGreaterThan(lo);
      expect(r.time, `${deg}°`).toBeLessThan(hi);
    }
  });

  it('turns the short way round, across ±π', () => {
    const pose = { facing: Math.PI - 0.2 };
    const t = new Turner(pose);
    t.face(-Math.PI + 0.2);
    t.update(DT);
    t.update(DT);
    expect(t.vel).toBeGreaterThan(0); // +: through π, not back the long way
    turnFully(t, pose);
    expect(Math.abs(wrapAngle(pose.facing - (-Math.PI + 0.2)))).toBeLessThan(1e-6);
  });

  it('a facing set from outside (a save, a test) is kept, not turned away from', () => {
    const pose = { facing: 0 };
    const t = new Turner(pose);
    t.face(1);
    t.update(DT);
    pose.facing = -2;
    t.update(DT);
    expect(pose.facing).toBe(-2);
    expect(t.vel).toBe(0);
  });
});

describe('#670: the pivot', () => {
  it('reversing while running brakes to a stop and pivots before setting off the new way', () => {
    const s = new Stride();
    const pose = { facing: 0 };
    const t = new Turner(pose);
    for (let i = 0; i < 60; i++) s.step(DT, 4.6, 0);
    expect(s.pace).toBeCloseTo(4.6);
    // the new way: straight back
    t.face(Math.PI);
    let stoppedAt = -1;
    let setOffAt = -1;
    let time = 0;
    for (let i = 0; i < 120; i++) {
      t.update(DT);
      const pace = s.step(DT, 4.6, t.left);
      time += DT;
      if (stoppedAt < 0 && pace === 0) stoppedAt = time;
      if (stoppedAt >= 0 && setOffAt < 0 && pace > 0) setOffAt = time;
      // never off at more than pivotAt while it still moves (no sliding backwards)
      if (pace > 0 && stoppedAt >= 0 && setOffAt < 0) expect(Math.abs(t.left)).toBeLessThanOrEqual(TURN.setOff);
    }
    expect(stoppedAt).toBeGreaterThan(0);
    expect(stoppedAt).toBeLessThan(0.4); // brakes in well under half a second
    expect(setOffAt).toBeGreaterThan(stoppedAt);
    expect(Math.abs(t.left)).toBeLessThan(1e-3);
  });

  it('the threshold: past pivotAt it stops; under it it keeps moving, a little slower in a sharp curve', () => {
    const s = new Stride();
    for (let i = 0; i < 60; i++) s.step(DT, 2.6, 0);
    s.step(DT, 2.6, TURN.pivotAt + 0.05);
    expect(s.pivoting).toBe(true);
    const t = new Stride();
    for (let i = 0; i < 60; i++) t.step(DT, 2.6, 0);
    for (let i = 0; i < 60; i++) t.step(DT, 2.6, TURN.pivotAt - 0.05);
    expect(t.pivoting).toBe(false);
    expect(t.pace).toBeGreaterThan(2.6 * TURN.turnSlow * 0.95);
    expect(t.pace).toBeLessThan(2.6);
    // a small correction keeps full speed
    const u = new Stride();
    for (let i = 0; i < 60; i++) u.step(DT, 2.6, TURN.setOff * 0.8);
    expect(u.pace).toBeCloseTo(2.6);
  });

  it('it speeds up and brakes rather than jumping', () => {
    const s = new Stride();
    expect(s.step(DT, 4.6, 0)).toBeLessThanOrEqual(TURN.speedUp * DT + 1e-9);
    for (let i = 0; i < 60; i++) s.step(DT, 4.6, 0);
    expect(s.step(DT, 0, 0)).toBeCloseTo(4.6 - TURN.brake * DT);
  });
});

describe('#670: how a turn looks', () => {
  it('the head leads toward the new way, capped, and the body follows a little', () => {
    const l = turnLook(Math.PI, 0, 0, 0, false);
    expect(l.headYaw).toBe(TURN_LOOK.headLead);
    expect(l.twist).toBeCloseTo(TURN_LOOK.headLead * TURN_LOOK.twist);
    expect(turnLook(-0.2, 0, 0, 0, false).headYaw).toBeCloseTo((-0.2 * 180) / Math.PI);
  });

  it('turning on the spot steps one foot then the other; walking or turning slowly, no steps', () => {
    const a = turnLook(1, 8, 0, Math.PI / 2, false);
    const b = turnLook(1, 8, 0, (3 * Math.PI) / 2, false);
    expect(a.stepL).toBeGreaterThan(TURN_LOOK.lift * 0.9);
    expect(a.stepR).toBe(0);
    expect(b.stepR).toBeGreaterThan(TURN_LOOK.lift * 0.9);
    expect(b.stepL).toBe(0);
    expect(turnLook(1, 8, 2.6, Math.PI / 2, false).stepL).toBe(0);
    expect(turnLook(1, 0.3, 0, Math.PI / 2, false).stepL).toBe(0);
    // one step per stepEvery turned
    expect(stepPhase(0, TURN_LOOK.stepEvery)).toBeCloseTo(Math.PI);
  });

  it('leans into a curve, more when running, toward the way it turns', () => {
    const walk = turnLook(0.3, 2, 2.6, 0, false).lean;
    const run = turnLook(0.3, 2, 4.6, 0, false).lean;
    expect(walk).toBeGreaterThan(0);
    expect(run).toBeGreaterThan(walk);
    expect(turnLook(-0.3, -2, 4.6, 0, false).lean).toBeLessThan(0);
    expect(turnLook(1, 20, 4.6, 0, false).lean).toBe(TURN_LOOK.leanMost);
  });

  it('reduced motion keeps the turn and the head leading, and drops the lean and the steps', () => {
    const l = turnLook(1, 8, 0, Math.PI / 2, true);
    expect(l.headYaw).toBeGreaterThan(0);
    expect(l.stepL + l.stepR).toBe(0);
    expect(turnLook(0.3, 2, 4.6, 0, true).lean).toBe(0);
  });
});

describe('#670: one turner', () => {
  it("nothing outside the turner sets Bloombot's facing directly", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (f.endsWith('.ts')) files.push(f);
      }
    };
    walk('src');
    const bad: string[] = [];
    for (const f of files) {
      if (f.replace(/\\/g, '/').endsWith('gameplay/Turner.ts')) continue;
      const src = readFileSync(f, 'utf8');
      src.split('\n').forEach((line, i) => {
        // the bot's pose by any of its names in the app: bot.pose / this.pose / b.pose, and `p` where p is the bot's pose
        if (/\b(bot\.pose|b\.pose|this\.pose)\.facing\s*[-+*/]?=(?!=)/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
        if (/(BotController|Resting)\.ts$/.test(f) && /\bp\.facing\s*[-+*/]?=(?!=)/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
        if (/Object\.assign\((this\.)?(bot\.)?pose,\s*\{[^}]*facing/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
