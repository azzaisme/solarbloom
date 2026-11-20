import { Bindings, migrateBindings } from './Bindings';
import { desktopApi, Game } from './Game';
import { SaveService, type Slot, SLOT_COUNT } from './SaveService';
import { parseSettings, SETTINGS_KEY } from './Settings';
import { ControlsTable } from '../ui/ControlsTable';
import type { PadStyle } from '../ui/Glyphs';
import type { Settings } from '../ui/Hud';
import { installIconDefs } from '../ui/Icons';
import { Loading, type LoadSteps } from '../ui/Loading';
import { settingsRows } from '../ui/SettingsRows';
import { SettingsScreen } from '../ui/SettingsScreen';
import { Title } from '../ui/Title';

/**
 * E22.12 (#350): how the game opens. Splash (up to 2 s) → title (Continue · New game · Load game · Settings ·
 * Quit) → the loading screen → the game, shown only once its first view is complete. `?slot=1` (2, 3) skips the
 * splash and the title and loads that slot (`&new=1` clears it first); `?title=1` skips the splash only (the way
 * back from "Quit to title").
 */
function loadSettings(): Settings {
  const rm = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY), rm);
  } catch {
    return parseSettings(null, rm);
  }
}

function persist(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, speed: undefined }));
  } catch {
    /* private mode */
  }
}

/** What Settings changes on the title itself (the game applies the rest when it starts). */
function applyTitleLook(s: Settings, el?: HTMLElement) {
  document.body.classList.toggle('contrast', !!s.highContrast);
  document.body.classList.toggle('reduced', !!s.reducedMotion);
  if (el) {
    const pct = s.uiScale === 125 || s.uiScale === 150 ? s.uiScale : 100;
    el.style.zoom = pct === 100 ? '' : String(pct / 100);
    el.style.setProperty('--ui-zoom', String(pct / 100));
    el.classList.toggle('still', !!s.reducedMotion);
  }
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const done = (s: LoadSteps) => s.models >= 1 && s.world >= 1 && s.view >= 1 && s.shaders >= 1;

export async function boot(canvas: HTMLCanvasElement) {
  const q = new URLSearchParams(location.search);
  const settings = loadSettings();
  applyTitleLook(settings);
  installIconDefs();
  let title: Title | undefined;

  const start = async (slot: Slot, fresh: boolean, device: 'keys' | 'pad', realClock = false) => {
    const loading = new Loading(!!settings.reducedMotion);
    loading.show();
    title?.destroy();
    title = undefined;
    const saver = new SaveService(undefined, slot);
    if (fresh) saver.clear();
    const lr = await saver.loadResultAsync();
    loading.progress({ models: 0, world: 0, view: 0, shaders: 0 });
    await frame(); // the loading screen is on screen before the world is built
    await frame();
    const game = new Game(canvas, lr, { slot, device, realClock: fresh && realClock });
    (window as unknown as { solarbloom: Game }).solarbloom = game;
    // Debug tools (Phase 4 E00.5) exist only on the dev server; production builds drop this branch.
    if (import.meta.env.DEV) void import('./DevTools').then((m) => m.installDevTools(game));
    document.getElementById('boot')?.classList.add('gone');
    // The game fades in only when the ground, models and textures round bloombot are ready.
    for (;;) {
      const s = game.loadSteps();
      loading.progress(s);
      if (done(s)) break;
      await frame();
    }
    await loading.done(500);
    game.shown();
  };

  const slotQ = Number(q.get('slot'));
  if (slotQ >= 1 && slotQ <= SLOT_COUNT) return start(slotQ as Slot, q.has('new'), 'keys', q.get('clock') === 'real');

  // ───── the title, with the same Settings screen as the game ─────
  const store = new SaveService();
  let screen: SettingsScreen | undefined;
  let onBack: (() => void) | undefined;
  let keyWait: ((e: KeyboardEvent) => void) | undefined;
  const stopWait = () => {
    if (keyWait) window.removeEventListener('keydown', keyWait, true);
    keyWait = undefined;
    if (title) title.listener = undefined;
  };
  const padStyle = (): PadStyle => (settings.glyphs === 'ps' || settings.glyphs === 'deck' || settings.glyphs === 'xbox' ? settings.glyphs : desktopApi()?.deck ? 'deck' : 'xbox');
  title = new Title({
    slots: () => store.slots(),
    start: (slot, fresh, device, realClock) => void start(slot, fresh, device, realClock),
    rename: (slot, name) => void new SaveService(undefined, slot).rename(name),
    remove: (slot) => new SaveService(undefined, slot).deleteSlot(),
    quit: desktopApi()?.quit,
    reducedMotion: !!settings.reducedMotion,
    earlierVersion: (slot) => new SaveService(undefined, slot).fromEarlierVersion(),
    preferRealClock: () => !!settings.realClock,
    padStyle,
    settingsOpen: () => !!screen?.isOpen,
    closeSettings: () => screen?.close(),
    settingsTab: (dir) => screen?.tab(dir, true),
    settings: (parent, back) => {
      onBack = back;
      const mig = migrateBindings(settings.keys || settings.pad ? { v: settings.bindingsV, keys: settings.keys, pad: settings.pad } : undefined);
      const bindings = new Bindings(mig.saved);
      screen ??= new SettingsScreen(parent, {
        settings,
        set: (k, v) => {
          (settings as unknown as Record<string, unknown>)[k] = v;
          persist(settings);
          applyTitleLook(settings, title?.el);
          if (k === 'debug' || k === 'gfx') screen?.refresh();
        },
        rows: (tab) => settingsRows(tab, { inGame: false, debug: !!settings.debug }),
        controls: (body) =>
          new ControlsTable(body, {
            bindings,
            padStyle,
            glyphSetting: () => settings.glyphs ?? 'auto',
            listen: (kind, got) => {
              stopWait();
              const finish = (v: string | number | 'clear' | undefined) => {
                stopWait();
                got(v);
              };
              keyWait = (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (e.code === 'Escape') finish(undefined);
                else if (kind === 'key') finish(e.code === 'Backspace' ? 'clear' : e.code);
              };
              window.addEventListener('keydown', keyWait, true);
              if (kind === 'pad' && title) title.listener = (i) => finish(i === 9 ? undefined : i);
            },
            changed: () => {
              const s = bindings.save();
              Object.assign(settings, { keys: s.keys, pad: s.pad, bindingsV: s.v });
              persist(settings);
            },
          }).render(),
        onClose: () => {
          stopWait();
          onBack?.();
        },
      });
      screen.open('game');
    },
  });
  applyTitleLook(settings, title.el);
  if (!q.has('title')) await title.splash();
  document.getElementById('boot')?.classList.add('gone');
  await title.show();
}
