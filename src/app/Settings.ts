import type { Settings } from '../ui/Hud';

/** Where the player's settings live, apart from the game save. */
export const SETTINGS_KEY = 'solarbloom.settings';

/** The settings a new player starts with. */
export function defaultSettings(prefersReducedMotion = false): Settings {
  return { sound: true, music: true, reducedMotion: prefersReducedMotion, hints: true, debug: false, lowVfx: false, lowFog: false, followChains: false, cozyMode: false };
}

/**
 * Reads saved settings (the raw localStorage string, or null when there are none) over the defaults. Unknown or
 * unreadable data falls back to the defaults.
 *
 * E20.7 (#290): calm is the default. "Show numbers" is off unless the player turned it on, so a new game and a
 * settings file from before the calm HUD existed (no `showNumbers` key) both start calm.
 */
export function parseSettings(raw: string | null, prefersReducedMotion = false): Settings {
  const def = defaultSettings(prefersReducedMotion);
  if (!raw) return def;
  try {
    const saved = JSON.parse(raw);
    return saved && typeof saved === 'object' ? { ...def, ...saved } : def;
  } catch {
    return def;
  }
}

/** E19.4.2 / E20.7: the calm HUD is on unless the player chose "Show numbers". */
export function calmHud(s: Settings): boolean {
  return !s.showNumbers;
}

/** E19.4.3 (#262): the potter-about pace (off by default): no nudges or advisor tips, softer chains. */
export function potterPace(s: Settings): boolean {
  return !!s.potter;
}
