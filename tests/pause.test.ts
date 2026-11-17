import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';
import { SaveService } from '../src/app/SaveService';
import { Pause, type PauseReason, runSimFrame } from '../src/app/Pause';
import { playedText } from '../src/ui/Menu';
import { settingsRows } from '../src/ui/SettingsRows';
import { SETTINGS_TABS } from '../src/ui/SettingsScreen';
import { TUNING } from '../src/data/tuning';

/** E22.11 (#349): a real pause. */
const REASONS: PauseReason[] = ['menu', 'panel', 'blur', 'sleep', 'padLost'];

function frames(sim: Sim, clock: { acc: number; catchUpDebt: number }, pause: Pause, seconds: number) {
  let ticks = 0;
  // Wall time at 30 frames a second, with the frame loop's real budget and catch-up rules.
  for (let i = 0; i < seconds * 30; i++) ticks += runSimFrame(sim, clock, 1 / 30, { pause, step: TUNING.simStep, budgetMs: 1e9, maxCatchUp: TUNING.catchUp.maxSeconds, now: () => 0 });
  return ticks;
}

describe('E22.11: the pause', () => {
  it('ten minutes paused leave the save byte-identical, for every pause reason', () => {
    const saver = new SaveService(undefined);
    saver.now = () => 1_700_000_000_000; // a fixed wall clock: only the game could change the save
    for (const reason of REASONS) {
      const sim = new Sim(createInitialState(77));
      const clock = { acc: 0, catchUpDebt: 0 };
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
