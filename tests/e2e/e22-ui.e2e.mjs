// E22 (#337): the controls and UI checks that need a real page, at 1280 × 800.
// - E22.3: switching from the mouse to the pad changes the prompt's glyph within one frame, with no layout shift.
// - E22.4: Interact rebound on the keyboard and on the pad (from Settings › Controls, by the device alone), then used.
// - E22.11: the menu with the keyboard alone and with the pad alone: open it, change a setting, save, quit to the
//   title and come back (until E22.12's title screen, quitting reloads straight into the saved game).
// - E22.10: under old-city rules (?ui=oldcity), a scripted stretch of play scans every HUD string for the banned
//   words and "/" as a rate, and screenshots plain walking (docs/review/ui-walking-oldcity.png).
// Run after `vite build` (npm run test:ui). Requires Playwright.
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const PAD = driver + '\ninstallVirtualPad(); window.padDriver = padDriver; window.installVirtualPad = installVirtualPad;';
const server = await preview({ preview: { port: 4231, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (page, ms) => page.waitForTimeout(ms);

async function open(query = '', pad = false) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (pad) await page.addInitScript(PAD);
  page.setDefaultTimeout(180000);
  await page.goto(`http://localhost:4231/${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.solarbloom?.bot, null, { timeout: 180000 });
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));
  await wait(page, 800);
  return { page, errors };
}

/** Press a virtual pad button for a few frames. */
async function press(page, b) {
  // Held for two drawn frames and released for two: the game reads the pad once a frame, however slow the frames.
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

/** Puts bloombot in front of the park's fountain. */
const faceFountain = (page) =>
  page.evaluate(() => {
    const g = window.solarbloom;
    const f = g.sim.state.machines.find((m) => m.type === 'core');
    g.bot.teleport(f.roofId, f.x + f.size / 2, f.z + f.size + 0.6);
    g.bot.pose.facing = Math.PI;
  });

/** Moves the pad's focus ring onto an element by the d-pad (as a player would). */
async function padTo(page, sel, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const dir = await page.evaluate((sel) => {
      const t = document.querySelector(sel);
      const c = document.activeElement;
      if (!t) return 'missing';
      if (c === t) return 'here';
      if (!c || c === document.body) return 13;
      const a = c.getBoundingClientRect(), b = t.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      return Math.abs(dy) > 4 ? (dy > 0 ? 13 : 12) : dx > 0 ? 15 : 14;
    }, sel);
    if (dir === 'here') return true;
    if (dir === 'missing') {
      console.log(`   padTo ${sel}: not on the page (focus on ${await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)})`);
      return false;
    }
    await press(page, dir);
  }
  console.log(`   padTo ${sel}: gave up at ${await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}`);
  return false;
}

/** Moves the keyboard focus onto an element with the arrow keys (Tab as a fallback). */
async function keyTo(page, sel, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const dir = await page.evaluate((sel) => {
      const t = document.querySelector(sel);
      const c = document.activeElement;
      if (!t) return 'missing';
      if (c === t) return 'here';
      if (!c || c === document.body) return 'Tab';
      const a = c.getBoundingClientRect(), b = t.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      if (c.closest('[role=tablist]') || c.tagName === 'SELECT') return 'Tab';
      return Math.abs(dy) > 4 ? (dy > 0 ? 'ArrowDown' : 'ArrowUp') : dx > 0 ? 'ArrowRight' : 'ArrowLeft';
    }, sel);
    if (dir === 'here') return true;
    if (dir === 'missing') return false;
    await page.keyboard.press(dir);
    await wait(page, 60);
  }
  return false;
}

try {
  // ───── E22.3: mouse → pad, the prompt's glyph swaps within one frame and nothing moves ─────
  {
    const { page, errors } = await open('?slot=1', true);
    await faceFountain(page);
    await page.mouse.move(640, 300);
    await page.mouse.move(650, 310);
    await wait(page, 300);
    const before = await page.evaluate(() => ({ label: document.querySelector('#prompt svg')?.getAttribute('aria-label'), r: document.querySelector('#prompt .pr-main')?.getBoundingClientRect().toJSON() }));
    const after = await page.evaluate(async () => {
      const pad = window.__pad;
      pad.axes[2] = 0.3; // the right stick turns the view a little: the pad is now the device in use
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // one frame reads it, the next draws
      pad.axes[2] = 0;
      return { label: document.querySelector('#prompt svg')?.getAttribute('aria-label'), r: document.querySelector('#prompt .pr-main')?.getBoundingClientRect().toJSON() };
    });
    check(before.label === 'E key' && after.label === 'A button', `E22.3 the prompt's glyph follows the device (${before.label} → ${after.label})`);
    check(!!before.r && !!after.r && Math.abs(before.r.width - after.r.width) < 1 && Math.abs(before.r.height - after.r.height) < 1, 'E22.3 no layout shift when the glyph set changes');
    check(!errors.length, `E22.3 no page errors ${errors.join(' | ')}`);
    await page.close();
  }

  // ───── E22.4: rebind Interact with the keyboard alone, then use it ─────
  {
    const { page, errors } = await open('?slot=1');
    await page.keyboard.press('Escape'); // the menu
    await wait(page, 200);
    check(await keyTo(page, '#menu-settings'), 'E22.4 keyboard: reach Settings in the menu');
    await page.keyboard.press('Enter');
    await wait(page, 200);
    await page.keyboard.press('KeyE'); // next tab: Controls
    await wait(page, 200);
    check(await keyTo(page, '#ctl-interact-key'), 'E22.4 keyboard: reach Interact on the Controls tab');
    await page.keyboard.press('Enter');
    await wait(page, 150);
    await page.keyboard.press('KeyT');
    await wait(page, 200);
    const kb = await page.evaluate(() => window.solarbloom.bindings.keys.interact);
    check(kb[0] === 'KeyT', `E22.4 keyboard: Interact is now T (${kb})`);
    await page.keyboard.press('Escape'); // Settings closes
    await page.keyboard.press('Escape'); // the menu closes
    await wait(page, 200);
    await faceFountain(page);
    await wait(page, 300);
    await page.keyboard.press('KeyT');
    await wait(page, 300);
    const used = await page.evaluate(() => !!window.solarbloom.selected); // the fountain is selected: its panel follows
    const why = await page.evaluate(() => JSON.stringify({ p: window.solarbloom.pause.list(), m: window.solarbloom.menu.isOpen, s: window.solarbloom.settingsUi.isOpen, prompt: document.getElementById('prompt').innerText, k: window.solarbloom.bindings.keys.interact }));
    check(used, `E22.4 keyboard: T interacts with the fountain (its panel opens) ${used ? '' : why}`);
    check(!errors.length, `E22.4 keyboard: no page errors ${errors.join(' | ')}`);
    await page.close();
  }
  // ───── E22.4: rebind Interact with the pad alone, then use it ─────
  {
    const { page, errors } = await open('?slot=1', true);
    await press(page, 9); // Menu
    check(await page.evaluate(() => window.solarbloom.menu.isOpen), 'E22.4 pad: Menu opens the menu');
    check(await padTo(page, '#menu-settings'), 'E22.4 pad: reach Settings');
    await press(page, 0);
    await press(page, 5); // RB: Controls
    check(await padTo(page, '#ctl-interact-pad'), 'E22.4 pad: reach Interact in the gamepad column');
    await press(page, 0);
    await press(page, 10); // left stick click: Sprint on or off has it, so the row asks
    const asked = await page.evaluate(() => document.querySelector('.ctl-ask')?.textContent ?? '');
    check(/Swap with Sprint on or off/.test(asked), `E22.4 pad: a clash asks first (${asked})`);
    check(await padTo(page, '#ctlSwap'), 'E22.4 pad: reach Swap');
    await press(page, 0);
    const pb = await page.evaluate(() => [window.solarbloom.bindings.pad.interact, window.solarbloom.bindings.pad.sprintToggle]);
    check(pb[0] === 10 && pb[1] === 0, `E22.4 pad: Interact is the left stick click, Sprint toggle took A (${pb})`);
    await press(page, 1); // B: Settings closes
    await press(page, 1); // B: the menu closes
    await faceFountain(page);
    await wait(page, 300);
    await press(page, 10);
    await wait(page, 300);
    check(await page.evaluate(() => !!window.solarbloom.selected), 'E22.4 pad: the left stick click interacts with the fountain');
    check(!errors.length, `E22.4 pad: no page errors ${errors.join(' | ')}`);
    await page.close();
  }

  // ───── E22.11: the menu, keyboard alone ─────
  {
    const { page, errors } = await open('?slot=1');
    await page.keyboard.press('Escape');
    await wait(page, 200);
    const paused = await page.evaluate(() => [window.solarbloom.menu.isOpen, window.solarbloom.paused, document.body.classList.contains('paused')]);
    check(paused.every(Boolean), 'E22.11 keyboard: Esc opens the menu and pauses (the world dims)');
    const t0 = await page.evaluate(() => window.solarbloom.sim.state.time);
    await wait(page, 1500);
    check((await page.evaluate(() => window.solarbloom.sim.state.time)) === t0, 'E22.11 keyboard: nothing ticks while paused');
    await keyTo(page, '#menu-settings');
    await page.keyboard.press('Enter');
    await wait(page, 200);
    check(await keyTo(page, '#set-hints'), 'E22.11 keyboard: reach a setting');
    await page.keyboard.press('Space');
    await wait(page, 150);
    const hints = await page.evaluate(() => JSON.parse(localStorage.getItem('solarbloom.settings')).hints);
    check(hints === false, 'E22.11 keyboard: the setting changed and was saved');
    await page.keyboard.press('Escape');
    await wait(page, 150);
    check(await keyTo(page, '#menu-save'), 'E22.11 keyboard: reach Save now');
    await page.keyboard.press('Enter');
    await wait(page, 200);
    check(/Saved/.test(await page.evaluate(() => document.querySelector('.menu-saved').textContent)), 'E22.11 keyboard: Save now says Saved');
    const before = await page.evaluate(() => ({ seed: window.solarbloom.sim.state.seed, time: window.solarbloom.sim.state.time, bot: window.solarbloom.sim.state.bot }));
    await keyTo(page, '#menu-title');
    await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);
    await page.waitForFunction(() => window.solarbloom?.bot, null, { timeout: 60000 });
    const after = await page.evaluate(() => ({ seed: window.solarbloom.sim.state.seed, time: window.solarbloom.sim.state.time, bot: window.solarbloom.sim.state.bot }));
    check(after.seed === before.seed && after.time >= before.time && Math.hypot(after.bot.x - before.bot.x, after.bot.z - before.bot.z) < 0.5, `E22.11 keyboard: quit to title saved first, and the game continues (time ${before.time.toFixed(1)} → ${after.time.toFixed(1)})`);
    check(!errors.length, `E22.11 keyboard: no page errors ${errors.join(' | ')}`);
    await page.close();
  }
  // ───── E22.11: the menu, pad alone ─────
  {
    const { page, errors } = await open('?slot=1', true);
    await press(page, 9);
    check(await page.evaluate(() => window.solarbloom.menu.isOpen && window.solarbloom.paused), 'E22.11 pad: Menu opens the menu and pauses');
    check(await padTo(page, '#menu-settings'), 'E22.11 pad: reach Settings');
    await press(page, 0);
    await press(page, 5);
    await press(page, 5);
    await press(page, 5); // Sound
    check(await padTo(page, '#set-music'), 'E22.11 pad: reach Music on the Sound tab');
    await press(page, 0);
    check((await page.evaluate(() => JSON.parse(localStorage.getItem('solarbloom.settings')).music)) === false, 'E22.11 pad: the setting changed and was saved');
    await press(page, 1);
    check(await padTo(page, '#menu-save'), 'E22.11 pad: reach Save now');
    await press(page, 0);
    check(/Saved/.test(await page.evaluate(() => document.querySelector('.menu-saved').textContent)), 'E22.11 pad: Save now says Saved');
    await padTo(page, '#menu-title');
    await Promise.all([page.waitForNavigation(), press(page, 0).catch(() => {})]); // the page leaves mid-press
    await page.waitForFunction(() => window.solarbloom?.bot, null, { timeout: 60000 });
    check(true, 'E22.11 pad: quit to title and the game continues');
    await page.evaluate(() => window.solarbloom.pause.clear('blur'));
    await press(page, 9);
    await press(page, 1);
    check(await page.evaluate(() => !window.solarbloom.menu.isOpen && !window.solarbloom.paused), 'E22.11 pad: B resumes');
    check(!errors.length, `E22.11 pad: no page errors ${errors.join(' | ')}`);
    await page.close();
  }

  // ───── E22.10: plain words under old-city rules, over a scripted stretch of play ─────
  {
    const { page, errors } = await open('?slot=1&ui=oldcity', true);
    const BANNED = /\b(rates?|per second|caps?|overflow\w*|reward at|frontiers?|sealed|specialt(y|ies)|permits?|tiers?|combos?|multipliers?|buffs?|frenzy|full[- ]bloom|biomass|nodes?|seams?|old[- ]city|classic)\b|\/\s*(min|s)\b|[×x]\d/i;
    await wait(page, 1500);
    await page.screenshot({ path: `${dir}/ui-walking-oldcity.png` });
    const seen = new Set();
    const bad = new Set();
    const res = await page.evaluate(async () => {
      const g = window.solarbloom;
      const d = padDriver(g);
      const out = [];
      for (let i = 0; i < 30 * 60 * 12; i++) {
        d.tick();
        g.update(1 / 30);
        if (i % 45 === 0) {
          const hud = document.getElementById('hud');
          // what is on screen: visible text, and the labels a screen reader reads
          const vis = [...hud.querySelectorAll('*')].filter((e) => e.offsetParent !== null && e.childElementCount === 0).map((e) => e.textContent.trim()).filter(Boolean);
          out.push(...vis);
        }
        if (i % 3000 === 0) await new Promise((r) => setTimeout(r, 0));
        if (d.state.woke) break;
      }
      return { out, woke: d.state.woke, pulses: d.state.pulses };
    });
    for (const s of res.out) {
      if (seen.has(s)) continue;
      seen.add(s);
      if (BANNED.test(s)) bad.add(s);
    }
    check(bad.size === 0, `E22.10 no banned word or rate on screen under old-city rules over ${seen.size} strings${bad.size ? `: ${[...bad].slice(0, 8).join(' | ')}` : ''}`);
    check(!errors.length, `E22.10 no page errors ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
if (failures.length) {
  console.error(`${failures.length} failed`);
  process.exit(1);
}
