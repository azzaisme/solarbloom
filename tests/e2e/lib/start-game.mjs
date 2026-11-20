// E23 UI reskin: one way for the e2e, screenshot and perf scripts to start a game and reach the build menu.
//
// How a game starts now (src/app/Boot.ts, src/ui/Title.ts):
//   - `?slot=N` skips the splash and the title and loads slot N; `&new=1` clears that slot first (a fresh garden).
//     A fresh garden opens straight into the world: there is no welcome card to dismiss any more.
//   - Without `?slot`, the page shows the splash, then the title ("Press any button"), then Play, then the
//     "Your gardens" slot cards (#tStartN on an empty slot, #tLoadN on a used one), then, for a new garden,
//     "How should the days go?" (#tYes: the game's own day, #tAlt: follow my clock). `?title=1` skips the splash.
//   - The game is ready once `window.solarbloom.bot` exists and `#loading` has the class `gone`.
//
// The build menu (src/ui/BuildMenu.ts) is `#buildMenu`, a sheet opened with Q / pad Y (class `open` while open),
// with tabs (`[role=tab]`, Q / E, LB / RB) and cells `[data-tool="<type>"]`. While building, the build dock is
// `#buildbar` (src/ui/Hotbar.ts BuildBar) with `#buildStop`; the shortcut dock is `#dock` (src/ui/Dock.ts).

/** The parts of the calm walking HUD (old-city rules): plain walking may show these and nothing else. */
export const WALKING_HUD = ['#res', '#obj', '#minimap', '#prompt', '#toasts', '#dock'];
/** The parts that show only while building (the build dock and its "Stop building" line). */
export const BUILD_HUD = ['#buildbar', '#buildStop'];
/** Sheets the player opens on purpose (they pause the world and cover it). */
export const HUD_SHEETS = ['#buildMenu', '#bpScreen', '#menu', '#settings'];
/** Every HUD part id a script may measure. */
export const HUD_PARTS = [...WALKING_HUD, ...BUILD_HUD, '#inspect', '#catPanel', '#buildMenu'];
/** True if `sel` is one of the HUD's parts (`#id`, with or without the `#`). */
export const isHudPart = (sel) => HUD_PARTS.includes(sel.startsWith('#') ? sel : `#${sel}`);
/** CSS that hides toasts for clean screenshots (the welcome card and the old hint line are gone). */
export const QUIET_CSS = '#toasts, .toast { display: none !important; }';

/** `${base}/?slot=N[&new=1][&extra]`, the URL that starts a game without the title. */
export function gameUrl(base, { slot = 1, fresh = true, query = '' } = {}) {
  const q = query.replace(/^[?&]+/, '');
  return `${base.replace(/\/$/, '')}/?slot=${slot}${fresh ? '&new=1' : ''}${q ? `&${q}` : ''}`;
}

/** Waits until the game is built and the loading screen has faded. */
export async function waitForGame(page, timeout = 240_000) {
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout });
}

/**
 * Starts a fresh game in slot `slot` straight from the URL (no title), with `settings` (an object for
 * `solarbloom.settings`) in place before the game reads them, and waits until it is on screen. Clears the
 * page's localStorage first unless `keepStorage`. Leaves the blur pause cleared, so a headless page runs.
 */
export async function startGame(page, base, { slot = 1, fresh = true, query = '', settings, keepStorage = false, timeout = 240_000 } = {}) {
  await page.addInitScript(
    ([settings, keep]) => {
      if (sessionStorage.getItem('sb.e2e.seeded')) return;
      sessionStorage.setItem('sb.e2e.seeded', '1');
      try {
        if (!keep) localStorage.clear();
        if (settings) localStorage.setItem('solarbloom.settings', JSON.stringify(settings));
      } catch {}
    },
    [settings ?? null, keepStorage],
  );
  await page.goto(gameUrl(base, { slot, fresh, query }), { timeout, waitUntil: 'domcontentloaded' });
  await waitForGame(page, timeout);
  await page.evaluate(() => window.solarbloom.pause?.clear?.('blur'));
}

/**
 * Starts a new garden the way a player does, with the keyboard and the mouse: title, Play, the slot's
 * "Start" card, then the day question (`clock`: 'game' takes the game's own day, 'real' follows the clock).
 * The slot must be empty (clear localStorage first). `query` is added to `?title=1`.
 */
export async function startGameFromTitle(page, base, { slot = 1, clock = 'game', query = '', timeout = 240_000 } = {}) {
  const q = query.replace(/^[?&]+/, '');
  await page.goto(`${base.replace(/\/$/, '')}/?title=1${q ? `&${q}` : ''}`, { timeout });
  await page.waitForSelector('#tPress', { timeout: 60_000 });
  await page.keyboard.press('Space');
  await page.waitForSelector('#tPlay');
  await page.click('#tPlay');
  await page.waitForSelector(`#tStart${slot}`);
  await page.click(`#tStart${slot}`);
  await page.waitForSelector('#tYes');
  await Promise.all([page.waitForNavigation({ timeout }).catch(() => {}), page.click(clock === 'real' ? '#tAlt' : '#tYes')]);
  await waitForGame(page, timeout);
  await page.evaluate(() => window.solarbloom.pause?.clear?.('blur'));
}

/** Opens the build menu (as Q / pad Y does) and waits for it. */
export async function openBuildMenu(page) {
  await page.evaluate(() => {
    const g = window.solarbloom;
    if (!g.hud.buildMenu?.isOpen) g.doAction('buildMenu');
  });
  await page.waitForSelector('#buildMenu.open', { timeout: 10_000 });
}

/** Closes the build menu if it is open. */
export async function closeBuildMenu(page) {
  await page.evaluate(() => {
    const g = window.solarbloom;
    if (g.hud.buildMenu?.isOpen) g.doAction('buildMenu');
  });
  await page.waitForSelector('#buildMenu.open', { state: 'detached', timeout: 10_000 }).catch(() => {});
}

/** Shows the tab of the build menu that holds `type` (the menu must be open). Returns false if no tab has it. */
export async function showBuildTab(page, type) {
  return page.evaluate((type) => {
    const has = () => !!document.querySelector(`#buildMenu.open [data-tool="${CSS.escape(type)}"]`);
    for (let i = 0; i < 8 && !has(); i++) window.solarbloom.hud.buildMenu.tab(1);
    return has();
  }, type);
}

/**
 * Takes `type` from the build menu with the mouse (open, the right tab, a double click on its cell: E23.11's
 * click selects, a double click takes). Returns true once it is in bloombot's hands.
 */
export async function pickBuild(page, type) {
  await openBuildMenu(page);
  if (!(await showBuildTab(page, type))) return false;
  await page.dblclick(`#buildMenu.open [data-tool="${type}"]`);
  await page.waitForTimeout(200);
  return (await page.evaluate(() => window.solarbloom.hud.currentTool)) === type;
}
