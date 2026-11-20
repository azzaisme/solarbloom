// E23.11: build mode in Sunlit Glass, for review against the boards (docs/art/ui-sunlit-glass/Build.dc.html,
// BuildPad.dc.html, BuildMenu.dc.html): build mode with the keyboard (a Solar Panel in hand, the Power view on),
// build mode with a pad (a Bench in hand), and the build menu, at 1600 × 900 and at 1280 × 800 with ?gfx=deck.
// Also checks the dock and the menu fit the screen, their text is 14 px (dock) / 16 px (menu) or more, and the
// pad's d-pad walks the slots and cycles the view. Shots go to docs/review/e23-ui/ (SHOTS_DIR overrides).
// Run after `vite build` (DIST picks another build folder): node tests/e2e/e23-build-shots.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.env.SHOTS_DIR ?? 'docs/review/e23-ui';
mkdirSync(out, { recursive: true });
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const PAD = driver + '\ninstallVirtualPad();';
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port: 4251, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

async function pressPad(page, b) {
  await page.evaluate(async (b) => {
    const frames = (n) => new Promise((r) => (function f(k) { k ? requestAnimationFrame(() => f(k - 1)) : r(); })(n));
    window.__pad.buttons[b].pressed = true;
    window.__pad.buttons[b].value = 1;
    await frames(2);
    window.__pad.buttons[b].pressed = false;
    window.__pad.buttons[b].value = 0;
    await frames(2);
  }, b);
}

async function open(w, h, query, pad) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (pad) await page.addInitScript(PAD);
  await page.goto(`http://localhost:4251/?slot=1&new=1${query}`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    const s = g.sim;
    const sv = s.state.salvage;
    // some way in: Pylon, Tally, Tide and Sluice are awake (poles, solar, farming, water); Tock still sleeps (the
    // battery shows locked); a little short of Copper
    for (const k of ['pylon', 'tally', 'tide', 'sluice']) sv.keepers[k] = { step: 'settled' };
    Object.assign(sv.pack, { scrap: 40, seeds: 20, timber: 30, glass: 20, clay: 30, copper: 1 });
    for (const c of ['wire', 'planks', 'glassPane', 'pipe', 'batteryCell', 'motor']) sv.pack[c] = 12;
    sv.tier = Math.max(sv.tier, 1);
    const f = s.state.machines.find((m) => m.type === 'core' && s.areas.areaOf(m) === 'park');
    g.bot.teleport(f.roofId, f.x + f.size / 2, f.z + f.size + 1.6);
    g.bot.pose.facing = 0;
  });
  await page.waitForTimeout(800);
  return { page, errors };
}

/** Leaf text under a selector smaller than `min` px (font-size, as rendered: the HUD's zoom is applied). */
const smallText = (page, sel, min) =>
  page.evaluate(
    ({ sel, min }) =>
      [...document.querySelectorAll(`${sel} *`)]
        .filter((e) => e.childElementCount === 0 && e.textContent.trim() && e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < min)
        .map((e) => `${e.className || e.tagName}:${getComputedStyle(e).fontSize}`),
    { sel, min },
  );
const onScreen = (page, sel) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return !!r && r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
  }, sel);

try {
  for (const [w, h, q, tag] of [
    [1600, 900, '', '1600'],
    [1280, 800, '&gfx=deck', 'deck'],
  ]) {
    // ── keyboard: a Solar Panel in hand, the Power view on ──
    {
      const { page, errors } = await open(w, h, q, false);
      await page.mouse.move(w / 2, h / 2);
      await page.keyboard.press('KeyQ');
      await page.waitForSelector('#buildMenu.open');
      check(await page.evaluate(() => window.solarbloom.paused), `${tag} keys: the build menu pauses the game`);
      // the menu, keyboard: on the Power tab with the Solar Panel shown
      for (let i = 0; i < 8 && !(await page.evaluate(() => !!document.querySelector('#bm-solar'))); i++) await page.keyboard.press('KeyE');
      // a click selects a card; a click on the card already shown builds it (the second click), so only click it
      // to show it when the tab opened on another
      if (!(await page.evaluate(() => document.querySelector('#bm-solar')?.classList.contains('sel')))) await page.click('#bm-solar');
      await page.waitForTimeout(300);
      check(await page.evaluate(() => !!document.querySelector('#buildMenu.open') && document.querySelector('#bm-solar')?.classList.contains('sel')), `${tag} keys: the Solar Panel is shown and the menu stays open`);
      await page.screenshot({ path: `${out}/build-menu-keys-${tag}.png` });
      const sheetBox = await page.evaluate(() => { const r = document.querySelector('#buildMenu .bm-sheet')?.getBoundingClientRect(); return r ? `${[r.left, r.top, r.right, r.bottom].map(Math.round).join(',')} in ${innerWidth}x${innerHeight}` : 'none'; });
      check(await onScreen(page, '#buildMenu .bm-sheet'), `${tag} keys: the build menu fits the screen (${sheetBox})`);
      const small = await smallText(page, '#buildMenu', 16);
      check(small.length === 0, `${tag} keys: the build menu's text is 16 px or more ${small.slice(0, 4).join(', ')}`);
      // pin it to slot 9 with P then 9, then take it with a second click
      await page.keyboard.press('KeyP');
      await page.keyboard.press('Digit9');
      await page.waitForTimeout(200);
      const pinned = await page.evaluate(() => window.solarbloom.settings.hotbar?.[8]);
      check(pinned === 'solar', `${tag} keys: P then 9 pins the Solar Panel to slot 9 (${pinned})`);
      const solars = () => page.evaluate(() => window.solarbloom.sim.state.machines.filter((m) => m.type === 'solar').length);
      const before = await solars();
      await page.dblclick('#bm-solar');
      await page.waitForTimeout(300);
      const held = await page.evaluate(() => ({ tool: window.solarbloom.hud.currentTool, open: window.solarbloom.hud.trayOpen }));
      check(held.tool === 'solar' && !held.open, `${tag} keys: a double click takes it in hand and closes the menu (${JSON.stringify(held)})`);
      check((await solars()) === before, `${tag} keys: the double click's second click doesn't fall through and build in the world`);
      // a grid to show: a panel and a battery placed beside the fountain
      await page.evaluate(() => {
        const g = window.solarbloom;
        const s = g.sim;
        const f = s.state.machines.find((m) => m.type === 'core' && s.areas.areaOf(m) === 'park');
        for (const [t, dx] of [['solar', -3], ['battery', -4]]) {
          for (let dz = 3; dz < 9; dz++) if (s.build.place(t, f.roofId, f.x + dx, f.z + dz)) break;
        }
        g.machines?.sync?.();
      });
      await page.keyboard.press('KeyO');
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${out}/build-keys-${tag}.png` });
      check(await onScreen(page, '#buildbar'), `${tag} keys: the build dock fits the screen`);
      // one tidy row: every slot and mode button the same height from the same top, every key badge on one line
      // inside the dock, and no name broken or cut short (the owner's two lines across the dock)
      for (const scale of [100, 125, 150]) {
        await page.evaluate((s) => window.solarbloom.hud.setUiScale(s), scale);
        await page.waitForTimeout(300); // #565: the dock finds its place as the scale changes
        const row = await page.evaluate(() => {
          const bar = document.querySelector('#buildbar');
          const dock = bar.getBoundingClientRect();
          const mm = document.querySelector('#minimap').getBoundingClientRect();
          const items = [...document.querySelectorAll('#buildbar .bslot, #buildbar .bmode')].map((e) => e.getBoundingClientRect());
          const keys = [...document.querySelectorAll('#buildbar .bg')].map((e) => e.getBoundingClientRect());
          const names = [...document.querySelectorAll('#buildbar .bl')];
          const spread = (v) => Math.max(...v) - Math.min(...v);
          return {
            tops: spread(items.map((r) => r.top)),
            heights: spread(items.map((r) => r.height)),
            keyTops: spread(keys.map((r) => r.top)),
            inside: [...items, ...keys].every((r) => r.top >= dock.top - 0.5 && r.bottom <= dock.bottom + 0.5),
            lines: names.filter((e) => e.getClientRects().length !== 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent),
            clear: dock.left >= mm.right - 0.5 || dock.bottom <= mm.top + 0.5 || getComputedStyle(document.querySelector('#minimap')).visibility === 'hidden',
            onScreen: dock.left >= 0 && dock.right <= innerWidth + 0.5,
            cut: names.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent),
            // #565: the slots fit inside the dock (they can't run past its edge, where the box check can't see them)
            fits: bar.scrollWidth <= bar.clientWidth + 1 && items.every((r) => r.left >= dock.left - 0.5 && r.right <= dock.right + 0.5),
            aside: getComputedStyle(document.querySelector('#minimap')).visibility === 'hidden',
            tight: bar.classList.contains('tight'),
            // #599: the piece's tooltip stays clear of the prompt (with its cost chips), Stop building and the dock
            tipClear: (() => {
              const tip = document.querySelector('#tip');
              const t = tip && getComputedStyle(tip).display !== 'none' ? tip.getBoundingClientRect() : undefined;
              if (!t || !t.width) return true;
              return ['#prompt', '#buildStop', '#buildbar'].every((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return !r || !r.width || t.right <= r.left || t.left >= r.right || t.bottom <= r.top || t.top >= r.bottom; });
            })(),
            // the prompt and Stop building stay above it
            above: ['#prompt', '#buildStop'].every((s) => { const e = document.querySelector(s); const r = e?.getBoundingClientRect(); return !r || !r.height || r.bottom <= dock.top + 0.5; }),
          };
        });
        // (above 100% the dock may run out of room: then it draws tighter, and on the smaller screen at 150% the
        // minimap steps aside while building and the dock takes the width; #599: its names stay whole throughout)
        check(row.tops < 1 && row.heights < 1 && row.keyTops < 1 && row.inside && !row.lines.length && row.clear && row.onScreen && row.fits && row.above && row.tipClear && !row.cut.length, `${tag} keys at ${scale}%: the dock is one even row, clear of the minimap ${JSON.stringify(row)}`);
        await page.screenshot({ path: `${out}/build-dock-${tag}-${scale}.png`, clip: await page.evaluate(() => { const r = document.querySelector('#buildbar').getBoundingClientRect(); return { x: Math.max(0, r.left - 12), y: Math.max(0, r.top - 70), width: Math.min(innerWidth, r.width + 24), height: r.height + 82 }; }) });
      }
      await page.evaluate(() => window.solarbloom.hud.setUiScale(100));
      check(await page.evaluate(() => getComputedStyle(document.querySelector('#minimap')).visibility !== 'hidden'), `${tag} keys: back at 100% the minimap is back beside the dock`);
      const dsmall = await smallText(page, '#buildbar', 14);
      check(dsmall.length === 0, `${tag} keys: the dock's labels are 14 px or more ${dsmall.slice(0, 4).join(', ')}`);
      const dock = await page.evaluate(() => ({
        slots: document.querySelectorAll('#buildbar .bslot').length,
        on: document.querySelector('#buildbar .bslot.on')?.getAttribute('aria-label'),
        power: !!document.querySelector('#buildbar .bmode.power.on'),
        stop: document.querySelector('#buildStop')?.textContent,
        prompt: document.querySelector('#prompt')?.textContent,
      }));
      check(dock.slots === 9 && /Solar/.test(dock.on ?? '') && dock.power && /Stop building/.test(dock.stop) && /Build a Solar Panel/.test(dock.prompt), `${tag} keys: nine slots, the Solar Panel lit, the Power view on, Stop building, the prompt (${JSON.stringify(dock)})`);
      // UI scale 150 on the Deck: the dock still fits
      if (tag === 'deck') {
        await page.evaluate(() => window.solarbloom.hud.setUiScale(150));
        await page.waitForTimeout(300);
        check(await onScreen(page, '#buildbar'), `${tag} keys: at 150% the dock still fits`);
        await page.screenshot({ path: `${out}/build-keys-${tag}-150.png` });
        await page.evaluate(() => window.solarbloom.hud.setUiScale(100));
      }
      check(!errors.length, `${tag} keys: no page errors ${errors.join(' | ')}`);
      await page.close();
    }
    // ── a pad: a Solar Panel in hand; d-pad right walks the slots, d-pad up changes the view ──
    {
      const { page, errors } = await open(w, h, q, true);
      await pressPad(page, 3); // Y: the build menu
      await page.waitForSelector('#buildMenu.open');
      for (let i = 0; i < 8 && (await page.evaluate(() => document.querySelector('#buildMenu [role=tab][aria-selected=true]')?.textContent)) !== 'Power'; i++) await pressPad(page, 5);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/build-menu-pad-${tag}.png` });
      // pin the piece shown on the Power tab (the Solar Panel: a new garden can build it; the decorations are made at
      // the table first) to slot 1 with X (Y opens and closes the menu itself), then take it with A
      const bench = await page.evaluate(() => document.activeElement?.dataset?.tool);
      await pressPad(page, 2); // X: pick a slot
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/build-menu-pin-pad-${tag}.png` });
      if (await page.evaluate(() => Number(document.activeElement?.dataset?.pin) >= 5)) await pressPad(page, 12); // the top row
      for (let i = 0; i < 6; i++) await pressPad(page, 14); // along it to slot 1
      await pressPad(page, 0); // A: pin here
      const s0 = await page.evaluate(() => window.solarbloom.settings.hotbar?.[0]);
      check(s0 === bench, `${tag} pad: X then A pins ${bench} to slot 1 (${s0})`);
      await pressPad(page, 0); // A: take it
      await page.waitForTimeout(400);
      const tool = await page.evaluate(() => window.solarbloom.hud.currentTool);
      check(tool === bench, `${tag} pad: A takes it in hand (${tool})`);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${out}/build-pad-${tag}.png` });
      const pad = await page.evaluate(() => ({
        keys: [...document.querySelectorAll('#buildbar .bslot .bg')].length,
        edges: document.querySelectorAll('#buildbar .bedge').length,
        view: document.querySelector('#buildbar .bmode.view .bl')?.textContent,
        prompt: document.querySelector('#prompt')?.textContent,
      }));
      check(pad.keys === 0 && pad.edges === 2 && /^View: /.test(pad.view ?? '') && /Build a Solar Panel/.test(pad.prompt) && !/Turn/.test(pad.prompt), `${tag} pad: no number keys, the d-pad at both ends, one View button, Build (a machine doesn't turn: Turn is for decorations) (${JSON.stringify(pad)})`);
      await pressPad(page, 15); // d-pad right: the next slot
      await page.waitForTimeout(200);
      const next = await page.evaluate(() => window.solarbloom.hud.currentTool);
      check(next !== bench && next !== 'pulse', `${tag} pad: d-pad right takes the next slot (${next})`);
      await pressPad(page, 12); // d-pad up: the next view
      await page.waitForTimeout(200);
      const v = await page.evaluate(() => document.querySelector('#buildbar .bmode.view .bl')?.textContent);
      check(v !== 'View: off', `${tag} pad: d-pad up changes the view (${v})`);
      await pressPad(page, 14); // back to the bench
      check(!errors.length, `${tag} pad: no page errors ${errors.join(' | ')}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exitCode = 1;
}
