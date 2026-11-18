/**
 * E22.11 (#349): one pause state with reasons. While any reason is set the game does not tick the simulation,
 * the clock, weather, helpers, animation or world sound, and neither autosaves nor counts time away (so a pause
 * changes nothing: `savedAt` and offline time are not advanced by it).
 *
 * - `menu`: the in-game menu is open (Esc with nothing open, or Menu on the pad).
 * - `panel`: a full-screen panel is open (backpack, settings, storage, Workbench, house).
 * - `blur`: the window lost focus or the page was hidden (setting "Pause when the window is not in focus").
 * - `sleep`: the Steam Deck (or the computer) went to sleep.
 * - `padLost`: the pad in use disconnected (the menu opens; resuming clears it).
 */
export type PauseReason = 'menu' | 'panel' | 'blur' | 'sleep' | 'padLost';

export class Pause {
  private reasons = new Set<PauseReason>();
  /** called when the game goes from running to paused or back */
  onChange?: (paused: boolean) => void;

  get paused(): boolean {
    return this.reasons.size > 0;
  }

  has(r: PauseReason): boolean {
    return this.reasons.has(r);
  }

  set(r: PauseReason, on = true) {
    const was = this.paused;
    if (on) this.reasons.add(r);
    else this.reasons.delete(r);
    if (was !== this.paused) this.onChange?.(this.paused);
  }

  clear(...rs: PauseReason[]) {
    for (const r of rs) this.set(r, false);
  }

  list(): PauseReason[] {
    return [...this.reasons];
  }
}

/** What the frame loop owes the simulation (Game keeps one; tests drive it directly). */
export interface SimClock {
  /** simulated seconds not yet ticked */
  acc: number;
  /** seconds owed after a hitch or a hidden tab, paid back within the frame budget (City 06.5) */
  catchUpDebt: number;
}

export interface SimTicker {
  tick(dt: number): void;
}

/**
 * Runs the simulation for one frame (City 06.5's budgeted loop): nothing at all while paused, otherwise the
 * frame's own time first, then any catch-up owed, within `budgetMs`. Returns the number of ticks run.
 */
export function runSimFrame(sim: SimTicker, clock: SimClock, dt: number, o: { pause?: Pause; speed?: number; step: number; budgetMs: number; maxCatchUp: number; now?: () => number }): number {
  if (o.pause?.paused) return 0;
  const now = o.now ?? (() => performance.now());
  const t0 = now();
  clock.acc += dt * (o.speed ?? 1);
  let n = 0;
  while (clock.acc >= o.step && (n === 0 || now() - t0 < o.budgetMs)) {
    sim.tick(o.step);
    clock.acc -= o.step;
    n++;
  }
  // More owed than the budget allows (a slow device at high speed): carry it as catch-up, not a backlog.
  if (clock.acc > 1) {
    clock.catchUpDebt = Math.min(o.maxCatchUp, clock.catchUpDebt + clock.acc - o.step);
    clock.acc = o.step;
  }
  while (clock.catchUpDebt >= o.step && now() - t0 < o.budgetMs) {
    sim.tick(o.step);
    clock.catchUpDebt -= o.step;
    n++;
  }
  if (clock.catchUpDebt < o.step) clock.catchUpDebt = 0;
  return n;
}
