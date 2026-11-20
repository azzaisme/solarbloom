/**
 * Full screen in a browser (Settings → Display). In the browser's own full screen (F11) the browser takes Esc to
 * leave it, so the game never sees Esc and the menu can't open. The page's own full screen can ask the browser to
 * keep Esc for the page (the Keyboard Lock API, Chrome and Edge): a press of Esc reaches the game, and holding it
 * leaves full screen. The desktop build is always full screen and already gives Esc to the game, so it has no
 * such setting.
 */

type LockingKeyboard = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };

const keyboard = (): LockingKeyboard | undefined => (typeof navigator !== 'undefined' ? (navigator as { keyboard?: LockingKeyboard }).keyboard : undefined);

/** Whether to offer it: a browser that can go full screen (not the desktop build, which always is). */
export function canFullScreen(): boolean {
  if (typeof document === 'undefined' || (globalThis as { solarbloomDesktop?: unknown }).solarbloomDesktop) return false;
  return !!document.fullscreenEnabled;
}

export function isFullScreen(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenElement;
}

/** Enters or leaves the page's full screen; entering asks to keep Esc for the game (where the browser can). */
export async function setFullScreen(on: boolean): Promise<void> {
  if (typeof document === 'undefined') return;
  try {
    if (on && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await keyboard()?.lock?.(['Escape']);
    } else if (!on && document.fullscreenElement) {
      keyboard()?.unlock?.();
      await document.exitFullscreen();
    }
  } catch {
    /* refused (no user gesture, or a browser without the API): stays as it is */
  }
}
