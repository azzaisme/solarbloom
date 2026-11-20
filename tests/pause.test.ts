import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createInitialState } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';
import { SaveService } from '../src/app/SaveService';
import { Pause, type PauseReason, runSimFrame } from '../src/app/Pause';
import { playedText } from '../src/ui/Menu';
import { settingsRows } from '../src/ui/SettingsRows';
import { SETTINGS_TABS } from '../src/ui/SettingsScreen';
import { TUNING } from '../src/data/tuning';

/** E22.11 (#349): a real pause. */
const REASONS: PauseReason[] = ['menu', 'panel', 'hidden', 'blur', 'sleep', 'padLost'];

function frames(sim: Sim, clock: { acc: number }, pause: Pause, seconds: number) {
  let ticks = 0;
  // Wall time at 30 frames a second, with the frame loop's real rules.
  for (let i = 0; i < seconds * 30; i++) ticks += runSimFrame(sim, clock, 1 / 30, { pause, step: TUNING.simStep, budgetMs: 1e9, now: () => 0 });
  return ticks;
}

describe('E22.11: the pause', () => {
  it('ten minutes paused leave the save byte-identical, for every pause reason', () => {
    const saver = new SaveService(undefined);
    saver.now = () => 1_700_000_000_000; // a fixed wall clock: only the game could change the save
    for (const reason of REASONS) {
      const sim = new Sim(createInitialState(77));
      const clock = { acc: 0 };
      const pause = new Pause();
      frames(sim, clock, pause, 2); // the game runs a moment first
      const before = saver.serialize(sim.state);
      pause.set(reason);
      expect(frames(sim, clock, pause, 600), reason).toBe(0);
      expect(saver.serialize(sim.state), reason).toBe(before);
      expect(clock.acc, reason).toBeLessThan(TUNING.simStep); // nothing owed up while paused
      pause.set(reason, false);
      expect(frames(sim, clock, pause, 1), reason).toBeGreaterThan(0); // and it runs again on resume
    }
  });

  // E23.1 (#355): no idle mechanics. A hidden tab used to bank up to 600 s and pay it back on return, so research,
  // crafting and salvage timers finished while the player was away. Now the world waits, exactly as when closed.
  it('E23.1: hiding the tab advances nothing, and nothing is paid back when it comes back', () => {
    const saver = new SaveService(undefined);
    saver.now = () => 1_700_000_000_000;
    const sim = new Sim(createInitialState(41));
    const clock = { acc: 0 };
    const pause = new Pause();
    frames(sim, clock, pause, 3);
    const t0 = sim.time;
    const before = saver.serialize(sim.state);
    pause.set('hidden'); // what Game does on visibilitychange, whatever the focus setting says
    expect(frames(sim, clock, pause, 20 * 60)).toBe(0); // twenty minutes in another tab
    expect(sim.time).toBe(t0);
    expect(saver.serialize(sim.state)).toBe(before);
    pause.clear('hidden');
    // back: the next second plays exactly one second of game time (30 frames), nothing more
    const ticks = frames(sim, clock, pause, 1);
    expect(sim.time - t0).toBeCloseTo(ticks * TUNING.simStep, 6);
    expect(sim.time - t0).toBeLessThanOrEqual(1 + TUNING.simStep);
  });

  it('E23.1: a stalled frame is dropped, never owed: no backlog builds up on a slow device', () => {
    const sim = new Sim(createInitialState(42));
    const clock = { acc: 0 };
    let ms = 0;
    // a 30 s stall arrives as one frame, with a budget that fits only a few ticks
    const n = runSimFrame(sim, clock, 30, { step: TUNING.simStep, budgetMs: 4, now: () => (ms += 1) });
    expect(n).toBeLessThan(10);
    expect(clock.acc).toBeLessThanOrEqual(TUNING.simStep);
    const t1 = sim.time;
    // the next ordinary frame runs only its own time
    runSimFrame(sim, clock, 1 / 30, { step: TUNING.simStep, budgetMs: 1e9, now: () => 0 });
    expect(sim.time - t1).toBeLessThanOrEqual(2 * TUNING.simStep);
  });

  it('the source holds no catch-up: no awayFor, no owed time, no "catching up" toast', () => {
    const src = readFileSync('src/app/Game.ts', 'utf8') + readFileSync('src/app/Pause.ts', 'utf8') + readFileSync('src/data/tuning.ts', 'utf8');
    for (const s of ['awayFor', 'catchUpDebt', 'catchUp:', 'Catching up', 'kept growing while you were away']) expect(src, s).not.toContain(s);
  });

  it('stays paused while any reason is set, and says when it changes', () => {
    const p = new Pause();
    const seen: boolean[] = [];
    p.onChange = (v) => seen.push(v);
    p.set('blur');
    p.set('menu');
    p.clear('blur');
    expect(p.paused).toBe(true);
    p.clear('menu', 'padLost');
    expect(p.paused).toBe(false);
    expect(seen).toEqual([true, false]);
  });
});

describe('E22.11: the menu and Settings', () => {
  it('says the time played in words', () => {
    expect(playedText(20)).toBe('less than a minute');
    expect(playedText(60)).toBe('1 minute');
    expect(playedText(12 * 60 + 5)).toBe('12 minutes');
    expect(playedText(3600 + 5 * 60)).toBe('1 hour 5 minutes');
    expect(playedText(7200)).toBe('2 hours');
  });

  it('is one screen with the five tabs, the same from the title and from the menu', () => {
    expect(SETTINGS_TABS.map((t) => t.label)).toEqual(['Game', 'Controls', 'Display', 'Sound', 'Accessibility']);
    for (const t of SETTINGS_TABS) {
      const title = settingsRows(t.id, { inGame: false, debug: false });
      const game = settingsRows(t.id, { inGame: true, debug: false, stats: '<p>stats</p>' });
      // The game adds its stats; every setting itself is the same in both places.
      const keys = (rows: ReturnType<typeof settingsRows>) => rows.flatMap((r) => ('key' in r ? [r.key] : []));
      expect(keys(game), t.id).toEqual(keys(title));
    }
    const game = settingsRows('game', { inGame: false, debug: false });
    expect(game.some((r) => 'key' in r && r.key === 'pauseOnBlur')).toBe(true);
    // Fast-forward is a developer tool: only with the debug overlay on.
    expect(game.some((r) => 'key' in r && r.key === 'speed')).toBe(false);
    expect(settingsRows('game', { inGame: false, debug: true }).some((r) => 'key' in r && r.key === 'speed')).toBe(true);
  });
});
