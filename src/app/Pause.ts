/**
 * E22.11 (#349): one pause state with reasons. While any reason is set the game does not tick the simulation,
 * the clock, weather, helpers, animation or world sound, and neither autosaves nor counts time away (so a pause
 * changes nothing: `savedAt` and offline time are not advanced by it).
 *
 * - `menu`: the in-game menu is open (Esc with nothing open, or Menu on the pad).
 * - `panel`: a full-screen panel is open (backpack, settings, storage, Workbench, house).
 * - `hidden`: the page is hidden (another tab, minimised). Always: the world waits, exactly as when the game is
 *   closed, and nothing is paid back on return (E23.1: no idle catch-up).
 * - `blur`: the window lost focus while still showing (setting "Pause when the window is not in focus").
 * - `sleep`: the Steam Deck (or the computer) went to sleep.
 * - `padLost`: the pad in use disconnected (the menu opens; resuming clears it).
 *
 * #673: a pause stops the world, not the sound. Music and the world's ambient sound (sea, birds, wind, the brook)
 * play on at the player's volumes through the menu, Settings, the backpack and every other pause; see `volumesFor`.
 */
export type PauseReason = 'menu' | 'panel' | 'hidden' | 'blur' | 'sleep' | 'padLost';

export class Pause {
  private reasons = new Set<PauseReason>();
  /** called when the game goes from running to paused or back */
  onChange?: (paused: boolean) => void;
  /** #673: called whenever a reason comes or goes (hiding the page while the menu is open changes the sound) */
  onReasons?: () => void;

  get paused(): boolean {
    return this.reasons.size > 0;
  }

  has(r: PauseReason): boolean {
    return this.reasons.has(r);
  }

  set(r: PauseReason, on = true) {
    const was = this.paused;
    const had = this.reasons.has(r);
    if (on) this.reasons.add(r);
    else this.reasons.delete(r);
    if (was !== this.paused) this.onChange?.(this.paused);
    if (had !== on) this.onReasons?.();
  }

  clear(...rs: PauseReason[]) {
    for (const r of rs) this.set(r, false);
  }

  list(): PauseReason[] {
    return [...this.reasons];
  }
}

/**
 * #673: the volumes (0..1) for effects and music while the game is in this pause state. Every pause the player makes
 * (the menu, a panel, the window losing focus, a disconnected pad) keeps the sound at the player's settings. Only when
 * the player is away goes it quiet: the page hidden (another tab, minimised), like a closed game, or the device asleep.
 * It fades back in on return. The Sound and Music on/off settings are applied separately and still win.
 */
export function volumesFor(settings: { sfxVolume?: number; musicVolume?: number }, pause: Pause): { sfx: number; music: number } {
  if (pause.has('hidden') || pause.has('sleep')) return { sfx: 0, music: 0 };
  return { sfx: (settings.sfxVolume ?? 100) / 100, music: (settings.musicVolume ?? 100) / 100 };
}

/** What the frame loop owes the simulation (Game keeps one; tests drive it directly). */
export interface SimClock {
  /** simulated seconds not yet ticked (never more than one step carried between frames) */
  acc: number;
}

export interface SimTicker {
  tick(dt: number): void;
}

/**
 * Runs the simulation for one frame (City 06.5's budgeted loop): nothing at all while paused, otherwise the frame's
 * own time, within `budgetMs`. Time the budget can't fit is dropped, never owed (E23.1: no catch-up, so nothing in
 * the world moves on while the player is away or the device stalls). Returns the number of ticks run.
 */
export function runSimFrame(sim: SimTicker, clock: SimClock, dt: number, o: { pause?: Pause; speed?: number; step: number; budgetMs: number; now?: () => number }): number {
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
  // More than the budget allows (a slow device at high speed): drop it, so it never piles up as a backlog.
  if (clock.acc > o.step) clock.acc = o.step;
  return n;
}
