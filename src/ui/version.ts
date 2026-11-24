/**
 * Which build this is, and in-game updates (the Steam Deck build). The version is baked in at build time
 * (vite.config.ts → __APP_VERSION__, from package.json, which the release workflow stamps "0.1.<build>"); the
 * desktop wrapper reports the same number. Updates come from electron/main.cjs: it downloads a newer release in
 * the background and says when it is ready; "Restart to update" installs it now, or it installs on the next quit.
 */
declare const __APP_VERSION__: string;

interface DesktopUpdates {
  ready(): string | null;
  onReady(cb: (version: string) => void): void;
  restart(): void;
}
const desktop = () => (globalThis as { solarbloomDesktop?: { version?: string; update?: DesktopUpdates } }).solarbloomDesktop;

/** "0.1.19" (or "dev" in a build that wasn't stamped). */
export function appVersion(): string {
  return desktop()?.version || (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev');
}

export const updates = {
  /** the version waiting to install, if one has downloaded */
  ready(): string | null {
    try {
      return desktop()?.update?.ready() ?? null;
    } catch {
      return null;
    }
  },
  onReady(cb: (version: string) => void) {
    desktop()?.update?.onReady(cb);
  },
  restart() {
    desktop()?.update?.restart();
  },
};
