// E23.11: the calm walking HUD in Sunlit Glass, for review against the boards (docs/art/ui-sunlit-glass/Walk.dc.html
// and WalkPad.dc.html): walking with the keyboard (a prompt, a pick-up toast, the shortcut dock) at 1600 × 900 and at
// 1280 × 800 with ?gfx=deck, and with a pad (low charge, the Eat hint, the load wheel). Checks the parts' text is
// 16 px or more, nothing overlaps at 100, 125 and 150% interface size, the dock follows the device's buttons and opens
// what it shows, and a new request puts the dot on the backpack. Shots go to docs/review/e23-ui/ (SHOTS_DIR
// overrides). Run after `vite build` (DIST picks another build folder): node tests/e2e/e23-hud-shots.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.env.SHOTS_DIR ?? 'docs/review/e23-ui';
mkdirSync(out, { recursive: true });
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const PAD = driver + '\ninstallVirtualPad();';
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port: 4256, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
/** The walking parts (each toast on its own). */
const PARTS = ['#obj', '#res', '#minimap', '#prompt', '#dock', '#toasts > *'];

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
  await page.goto(`http://localhost:4256/?slot=1&new=1${query}`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    const s = g.sim;
    const sv = s.state.salvage;
    Object.assign(sv.pack, { scrap: 12, seeds: 8, copper: 3 });
    // by the fountain, facing it: its prompt shows
    const f = s.state.machines.find((m) => m.type === 'core' && s.areas.areaOf(m) === 'park');
    g.bot.teleport(f.roofId, f.x + f.size / 2, f.z + f.size + 1.2);
    g.bot.pose.facing = Math.PI;
  });
  await page.waitForTimeout(1500);
  return { page, errors };
}

/** Leaf text under the parts smaller than `min` px (as rendered: the HUD's zoom is applied by the browser). */
const smallText = (page, min) =>
  page.evaluate(
    ({ sels, min }) =>
      sels
        .flatMap((sel) => [...document.querySelectorAll(`${sel} *`)])
        .filter((e) => e.childElementCount === 0 && e.textContent.trim() && e.offsetParent && !e.closest('svg') && parseFloat(getComputedStyle(e).fontSize) < min)
        .map((e) => `${e.className || e.tagName}:${getComputedStyle(e).fontSize}`),
    { sels: ['#obj', '#res', '#minimap', '#prompt', '#toasts', '#loadWheel'], min },
  );

/** Overlapping or off-screen parts. */
const layout = (page) =>
  page.evaluate((sels) => {
    const rects = [];
    for (const sel of sels)
      for (const el of document.querySelectorAll(sel)) {
        const cs = getComputedStyle(el);
        if (el.hidden || cs.display === 'none' || +cs.opacity === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 2 && r.height > 2) rects.push({ sel, l: r.left, t: r.top, r: r.right, b: r.bottom });
      }
    const issues = [];
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1) issues.push(`${a.sel} overlaps ${b.sel}`);
      }
    for (const r of rects) if (r.l < -1 || r.t < -1 || r.r > innerWidth + 1 || r.b > innerHeight + 1) issues.push(`${r.sel} off screen`);
    return { issues, shown: [...new Set(rects.map((r) => r.sel))] };
  }, PARTS);

try {
  for (const [w, h, q, tag] of [
    [1600, 900, '', '1600'],
    [1280, 800, '&gfx=deck', 'deck'],
  ]) {
    // ── walking with the keyboard: the fountain's prompt, a pick-up, the dock ──
    {
      const { page, errors } = await open(w, h, q, false);
      await page.mouse.move(w / 2, h / 2);
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(60);
      await page.keyboard.up('KeyW');
      await page.evaluate(() => window.solarbloom.hud.pickup('Copper', 3));
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${out}/walk-keys-${tag}.png` });
      const parts = await page.evaluate(() => ({
        obj: document.querySelector('#objTitle')?.textContent,
        charge: document.querySelector('#chargeRow')?.innerText.replace(/\s+/g, ' ').trim(),
        prompt: document.querySelector('#prompt')?.innerText.replace(/\s+/g, ' ').trim(),
        rim: document.querySelector('#minimap .mm-rim')?.innerText,
        toast: document.querySelector('#toasts')?.innerText.trim(),
        dock: [...document.querySelectorAll('#dock [data-dock]')].map((b) => b.getAttribute('aria-label')),
        keyGlyph: document.querySelector('#dock [data-dock="backpack"] svg')?.getAttribute('aria-label'),
      }));
      console.log('  ', JSON.stringify(parts));
      check(!!parts.obj && /Charge 100%/.test(parts.charge ?? ''), `${tag} keys: the objective and Charge 100%`);
      check(/^\d\d:\d\d( · \w+)?$/.test(parts.rim ?? ''), `${tag} keys: the clock and the weather on the minimap's rim (${parts.rim})`);
      check(parts.toast === '+3 Copper', `${tag} keys: the pick-up toast (${parts.toast})`);
      check(parts.dock.length === 3 && /key$/.test(parts.keyGlyph ?? ''), `${tag} keys: the dock's three buttons with key pictures (${parts.dock.join(', ')})`);
      const small = await smallText(page, 16);
      check(small.length === 0, `${tag} keys: the walking HUD's text is 16 px or more ${small.slice(0, 6).join(', ')}`);
      for (const scale of [100, 125, 150]) {
        await page.evaluate((s) => window.solarbloom.hud.setUiScale(s), scale);
        await page.waitForTimeout(300);
        const l = await layout(page);
        check(l.issues.length === 0, `${tag} keys at ${scale}%: nothing overlaps or runs off screen (${l.shown.join(' ')}) ${l.issues.join('; ')}`);
        if (scale !== 100) await page.screenshot({ path: `${out}/walk-keys-${tag}-${scale}.png` });
      }
      await page.evaluate(() => window.solarbloom.hud.setUiScale(100));
      // the dock opens what it shows
      await page.click('#dock [data-dock="backpack"]');
      await page.waitForTimeout(400);
      check(await page.evaluate(() => window.solarbloom.hud.backpackOpen), `${tag} keys: the dock's Backpack opens the backpack`);
      await page.evaluate(() => window.solarbloom.closeAll());
      await page.waitForTimeout(200);
      await page.click('#dock [data-dock="menu"]');
      await page.waitForTimeout(400);
      check(await page.evaluate(() => !!document.querySelector('#menu.open')), `${tag} keys: the dock's Menu opens the pause menu`);
      await page.evaluate(() => window.solarbloom.closeAll());
      // a new request: the pink dot on the backpack until the backpack is opened
      await page.evaluate(() => {
        const s = window.solarbloom.sim;
        s.state.salvage.keepers.pylon = { step: 'request1' };
      });
      await page.waitForTimeout(1200);
      const dot = await page.evaluate(() => !document.querySelector('#dock .dot')?.hidden);
      check(dot, `${tag} keys: a new request puts the dot on the backpack`);
      await page.screenshot({ path: `${out}/walk-keys-${tag}-request.png` });
      await page.click('#dock [data-dock="backpack"]');
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.solarbloom.closeAll());
      await page.waitForTimeout(800);
      check(await page.evaluate(() => !!document.querySelector('#dock .dot')?.hidden), `${tag} keys: opening the backpack clears the dot`);
      check(!errors.length, `${tag} keys: no page errors ${errors.join(' | ')}`);
      await page.close();
    }
    // ── a pad: low charge with food to eat, the load wheel turned ──
    {
      const { page, errors } = await open(w, h, q, true);
      await pressPad(page, 1); // any press: the pad's pictures
      await page.evaluate(() => {
        const s = window.solarbloom.sim;
        s.state.salvage.pack.food = 2;
        s.state.salvage.pack.fertiliser = 0;
        s.state.charge.value = s.charge.max * 0.18;
      });
      await pressPad(page, 5); // RB: turn the load wheel (to Seeds)
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/walk-pad-${tag}.png` });
      const pad = await page.evaluate(() => ({
        charge: document.querySelector('#chargeRow')?.innerText.replace(/\s+/g, ' ').trim(),
        low: document.querySelector('#chargeRow')?.classList.contains('low'),
        eat: getComputedStyle(document.querySelector('#chargeRow .ch-eat')).display !== 'none',
        eatGlyph: document.querySelector('#chargeRow .ch-g svg')?.getAttribute('aria-label'),
        wheel: !document.querySelector('#loadWheel')?.hidden,
        on: document.querySelector('#loadWheel .lw-opt.on')?.textContent,
        chip: document.querySelector('#loadChip')?.textContent,
        dockGlyph: document.querySelector('#dock [data-dock="backpack"] svg')?.getAttribute('aria-label'),
        obj: document.querySelector('#objTitle')?.textContent,
      }));
      console.log('  ', JSON.stringify(pad));
      check(pad.low && /Low · 1[78]%/.test(pad.charge ?? ''), `${tag} pad: low charge reads "Low · 18%" (${pad.charge})`);
      check(pad.eat && /D-pad/.test(pad.eatGlyph ?? ''), `${tag} pad: the Eat hint with its pad picture (${pad.eatGlyph})`);
      check(pad.wheel && !!pad.on, `${tag} pad: the load wheel shows (${pad.on})`);
      check(/D-pad/.test(pad.dockGlyph ?? ''), `${tag} pad: the dock follows the pad (${pad.dockGlyph})`);
      const small = await smallText(page, 16);
      check(small.length === 0, `${tag} pad: the text is 16 px or more ${small.slice(0, 6).join(', ')}`);
      await page.waitForTimeout(3500); // the wheel closes; the chip stays
      await page.screenshot({ path: `${out}/walk-pad-${tag}-chip.png` });
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
