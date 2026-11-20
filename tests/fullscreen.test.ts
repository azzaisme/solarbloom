// Settings → Display → Full screen: in a browser, the page's own full screen keeps Esc for the game (the browser's
// F11 full screen takes Esc for itself, so the menu could not open). The desktop build is always full screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canFullScreen, isFullScreen, setFullScreen } from '../src/app/FullScreen';
import { settingsRows } from '../src/ui/SettingsRows';

const g = globalThis as Record<string, unknown>;
const had = { document: g.document, navigator: g.navigator, desktop: g.solarbloomDesktop };

function browser(enabled = true) {
  const doc = {
    fullscreenEnabled: enabled,
    fullscreenElement: null as unknown,
    documentElement: { requestFullscreen: vi.fn(async () => void (doc.fullscreenElement = doc.documentElement)) },
    exitFullscreen: vi.fn(async () => void (doc.fullscreenElement = null)),
  };
  const keyboard = { lock: vi.fn(async () => {}), unlock: vi.fn() };
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { keyboard }, configurable: true, writable: true });
  return { doc, keyboard };
}
const row = () => settingsRows('display', { inGame: true, debug: false }).find((r) => 'id' in r && r.id === 'fullScreen');

afterEach(() => {
  Object.defineProperty(globalThis, 'document', { value: had.document, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: had.navigator, configurable: true, writable: true });
  g.solarbloomDesktop = had.desktop;
});

describe('full screen in a browser keeps Esc for the game', () => {
  it('is offered in a browser that can go full screen, and nowhere else', () => {
    expect(canFullScreen()).toBe(false); // no page at all
    browser(false);
    expect(row()).toBeUndefined(); // a browser that can't
    browser(true);
    expect(row()).toBeDefined();
    g.solarbloomDesktop = { quit: () => {} };
    expect(row()).toBeUndefined(); // the desktop build is always full screen
  });

  it('entering asks the browser to keep Esc for the game; leaving lets it go', async () => {
    const { doc, keyboard } = browser();
    const r = row() as { get(): boolean; set(on: boolean): Promise<void> | void };
    expect(r.get()).toBe(false);
    await r.set(true);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalled();
    expect(keyboard.lock).toHaveBeenCalledWith(['Escape']);
    expect(isFullScreen()).toBe(true);
    expect(r.get()).toBe(true);
    await setFullScreen(false);
    expect(keyboard.unlock).toHaveBeenCalled();
    expect(doc.exitFullscreen).toHaveBeenCalled();
    expect(isFullScreen()).toBe(false);
  });

  it('a refusal (no click behind it, an old browser) changes nothing and throws nothing', async () => {
    const { doc } = browser();
    doc.documentElement.requestFullscreen = vi.fn(async () => {
      throw new Error('not allowed');
    });
    await expect(setFullScreen(true)).resolves.toBeUndefined();
    expect(isFullScreen()).toBe(false);
  });
});
