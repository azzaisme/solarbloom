// E24 (#616): every menu with the gamepad alone, at 1280 × 800 and 150% interface size, by day and by night.
//
// Each menu is opened the way a pad player opens it (Start, the d-pad, A on a menu item, Y for building), except the
// crafting table and the fountain's panel, which open the way A at them does (the script calls the game's own open,
// as walking there is not what this test is about). For each menu it checks:
// - something sensible has the focus the moment it opens (not nothing, and not the Back button), with no d-pad press;
// - wherever the focus goes, a focus ring shows, the focused control is on screen and not cut off by its scroll box;
// - every control can be reached with the d-pad: from each one it presses up, down, left and right and follows
//   where the focus goes, starting from where the menu put it (left and right on a stepper change its value
//   instead, and are checked for that);
// - every setting with choices is an in-place ‹ value › stepper (no native drop-down, which a pad can't open):
//   d-pad right changes it, the game takes the new value, and d-pad left puts it back.
// Screenshots go to docs/review/e24-pad-menus/ (SHOTS_DIR to change). Run after `vite build`:
//   GPU=1 node tests/e2e/pad-menus.e2e.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/e24-pad-menus';
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 4254);
const base = `http://localhost:${port}`;
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({
  args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
  return ok;
};

const A = 0, B = 1, Y = 3, LB = 4, RB = 5, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
const NAMES = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(`${driver}\ninstallVirtualPad();`);

/** One press of a pad button: held for two frames, then let go for two (the game reads the pad once a frame). */
async function press(b, frames = 3) {
  await page.evaluate(async ([b, n]) => {
    const f = (k) => new Promise((r) => (function go(i) { i ? requestAnimationFrame(() => go(i - 1)) : r(); })(k));
    window.__pad.buttons[b].pressed = true;
    window.__pad.buttons[b].value = 1;
    await f(n);
    window.__pad.buttons[b].pressed = false;
    window.__pad.buttons[b].value = 0;
    await f(n);
  }, [b, frames]);
}

/** What has the focus, and whether a player can see that it has: its ring, on screen and not cut off. */
const focusState = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { none: true };
    const tag = (e) => e.id || e.dataset?.key || e.dataset?.tool || e.dataset?.act || e.dataset?.tab || (e.textContent || '').trim().slice(0, 24) || e.tagName;
    // the ring may sit on the control or on the row it belongs to (a settings row rings the whole line)
    const ringOf = (e) => {
      const cs = getComputedStyle(e);
      const shadow = cs.boxShadow !== 'none' && /\b[1-9]\d*(\.\d+)?px/.test(cs.boxShadow.replace(/rgba?\([^)]*\)/g, ''));
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
      return shadow || outline;
    };
    const host = el.closest('[data-ring-host]') ?? el;
    const ring = ringOf(host) || ringOf(el);
    const r = host.getBoundingClientRect();
    // every box between it and the page that clips (overflow other than visible) must show all of it; a control
    // taller than its list (a long Collection card) must show its top, where its name is
    let clipped = '';
    let tall = false;
    for (let p = host.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
      const q = p.getBoundingClientRect();
      tall ||= r.height > q.height - 32;
      const off = tall ? r.top < q.top - 1 || r.top > q.bottom - 40 : r.top < q.top - 1 || r.bottom > q.bottom + 1;
      if (off || r.left < q.left - 1 || r.right > q.right + 1) {
        clipped = p.id || p.className || p.tagName;
        break;
      }
    }
    const onScreen = r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && (tall || r.bottom <= innerHeight);
    return { id: tag(el), ring, onScreen, clipped, stepper: el.classList.contains('stepper'), tab: el.getAttribute('role') === 'tab', value: el.dataset?.value ?? null };
  });

/** The open menu's controls the pad should reach (named, for the report). */
const controls = (sel) =>
  page.evaluate((sel) => {
    const p = document.querySelector(sel);
    if (!p) return [];
    p.querySelectorAll('[data-pad-test]').forEach((e) => delete e.dataset.padTest);
    // a pad button already does what Back and the action bar's items do (B, A, X): those aren't d-pad stops
    const all = [...p.querySelectorAll('button:not([disabled]):not(.st-arrow), input:not([disabled]), select:not([disabled]), [tabindex="0"]')];
    return all
      .filter((e) => !e.hidden && e.getClientRects().length && !e.closest('[hidden]') && e.getAttribute('tabindex') !== '-1' && !e.matches('[data-press], [data-back], .sheet-back') && !(e.getAttribute('role') === 'tab' && e.getAttribute('aria-selected') === 'false'))
      // a control with an id keeps it when its panel redraws (the crafting table's detail does as the focus moves)
      .map((e, i) => (e.dataset.padTest = e.id ? `#${e.id}` : `c${i}`));
  }, sel);

/**
 * Walks a menu with the d-pad from where its focus is now: from each control reached, every direction (left and
 * right on a stepper change it instead). Returns the controls never reached.
 */
async function walk(name, sel, { shotAt = 4 } = {}) {
  const want = await controls(sel);
  const seen = new Set();
  const start = await page.evaluate(() => (document.activeElement?.id ? `#${document.activeElement.id}` : document.activeElement?.dataset?.padTest));
  const edges = [];
  const queue = start ? [start] : [];
  let bad = 0, n = 0;
  while (queue.length && n < 400) {
    const at = queue.shift();
    if (seen.has(at)) continue;
    seen.add(at);
    for (const b of [UP, DOWN, LEFT, RIGHT]) {
      // back to the control being explored (the d-pad press below is the move being tested)
      const there = await page.evaluate(([sel, at]) => {
        const e = at.startsWith('#') ? document.getElementById(at.slice(1)) : document.querySelector(`${sel} [data-pad-test="${at}"]`);
        if (!e) return false;
        e.focus({ focusVisible: true });
        return document.activeElement === e;
      }, [sel, at]);
      if (!there) break;
      const before = await focusState();
      // left and right change a stepper's value, or open the next tab: both are tested on their own
      if ((before.stepper || before.tab) && (b === LEFT || b === RIGHT)) continue;
      await press(b);
      n++;
      const s = await focusState();
      const id = await page.evaluate(() => {
        const e = document.activeElement;
        return e?.id ? `#${e.id}` : e?.dataset?.padTest;
      });
      edges.push(`${at} ${NAMES[b]} → ${id ?? '(nothing)'}`);
      if (id && !seen.has(id)) queue.push(id);
      // (a press that goes nowhere leaves the control where this script's own focus() put it: nothing to check)
      if (id !== at && !s.none && (!s.ring || !s.onScreen || s.clipped) && bad++ < 6) check(false, `${name}: ${NAMES[b]} to "${s.id}" shows it (ring ${s.ring}, on screen ${s.onScreen}${s.clipped ? `, cut off by ${s.clipped}` : ''})`);
      if (n === shotAt) await page.screenshot({ path: `${dir}/${name}-walk.png` });
    }
  }
  const missed = want.filter((w) => !seen.has(w));
  const names = await page.evaluate(([sel, ids]) => ids.map((i) => {
    const e = i.startsWith('#') ? document.getElementById(i.slice(1)) : document.querySelector(`${sel} [data-pad-test="${i}"]`);
    return e?.id || e?.dataset?.key || (e?.textContent || '').trim().slice(0, 20) || e?.outerHTML.slice(0, 90) || 'gone';
  }), [sel, missed]);
  if (!check(!missed.length, `${name}: the d-pad reaches all ${want.length} controls${missed.length ? ` (not: ${names.join(', ')})` : ''}`)) console.log(`    from ${start}: ${edges.join(' · ')}`);
  if (!bad) check(true, `${name}: every control the d-pad reached showed its ring, whole and on screen`);
}

/** Checks the focus the moment a menu opens: something sensible, ringed and on screen. Takes the "open" shot. */
async function opened(name, sel, { notBack = true, expect } = {}) {
  await page.waitForSelector(sel, { timeout: 10_000 });
  await page.waitForTimeout(350);
  const s = await focusState();
  const inside = await page.evaluate((sel) => !!document.querySelector(sel)?.contains(document.activeElement), sel);
  check(inside && !s.none, `${name}: the focus is in it as it opens (on "${s.id ?? 'nothing'}")`);
  if (notBack) check(!/^back$/i.test(String(s.id)) && !(await page.evaluate(() => document.activeElement?.matches?.('[data-back], .sheet-back'))), `${name}: the first focus isn't the Back button`);
  if (expect) check(expect.test(String(s.id)), `${name}: it opens on ${expect}`);
  check(s.ring && s.onScreen && !s.clipped, `${name}: that first focus shows its ring, whole and on screen`);
  await page.screenshot({ path: `${dir}/${name}-open.png` });
}

/** Every setting with choices: a stepper the d-pad changes in place, and the game takes the value. */
async function steppers(name, tab) {
  const native = await page.evaluate(() => document.querySelectorAll('#settings.open select').length);
  check(!native, `${name} ${tab}: no native drop-downs (${native})`);
  const ids = await page.evaluate(() => [...document.querySelectorAll('#settings.open .stepper')].map((e) => e.id));
  for (const id of ids) {
    await page.evaluate((id) => document.getElementById(id).focus({ focusVisible: true }), id);
    const s0 = await focusState();
    const key = await page.evaluate((id) => document.getElementById(id).dataset.key, id);
    const read = () => page.evaluate(([id, key]) => ({ shown: document.getElementById(id)?.dataset.value, saved: key ? String(JSON.parse(localStorage.getItem('solarbloom.settings') || '{}')[key] ?? '') : '' }), [id, key]);
    const before = await read();
    await press(RIGHT);
    let after = await read();
    if (after.shown === before.shown) {
      // at its last choice: right stays put, so try left first
      await press(LEFT);
      after = await read();
    }
    const changed = after.shown !== before.shown;
    check(changed && (!key || after.saved === after.shown), `${name} ${tab}: "${s0.id}" changes in place with the d-pad (${before.shown} → ${after.shown}${key ? `, saved ${after.saved}` : ''})`);
    const still = await page.evaluate((id) => document.activeElement?.id === id, id);
    check(still, `${name} ${tab}: "${s0.id}" keeps the focus while it changes`);
    // put it back the other way
    await press(after.shown === (await read()).shown && changed ? (Number(after.shown) < Number(before.shown) || after.shown < before.shown ? RIGHT : LEFT) : LEFT);
    const back = await read();
    check(back.shown === before.shown, `${name} ${tab}: and back again (${back.shown})`);
  }
  return ids.length;
}

async function settingsTour(name) {
  await opened(`${name}-settings`, '#settings.open', { notBack: true });
  // up from the first setting reaches the open tab (not the nearest closed one), and right there opens the next
  await press(UP);
  const onTab = await page.evaluate(() => [document.activeElement?.getAttribute('role'), document.activeElement?.getAttribute('aria-selected'), document.activeElement?.dataset.tab]);
  check(onTab[0] === 'tab' && onTab[1] === 'true', `${name}: up from the first setting reaches the open tab (${onTab.join(' ')})`);
  await press(RIGHT);
  const next = await page.evaluate(() => document.querySelector('#settings [aria-selected=true]')?.dataset.tab);
  check(next !== onTab[2], `${name}: right on the tab opens the next one (${onTab[2]} → ${next})`);
  await press(LEFT);
  await page.waitForTimeout(150);
  let total = 0;
  for (let t = 0; t < 5; t++) {
    const tab = await page.evaluate(() => document.querySelector('#settings [aria-selected=true]')?.dataset.tab);
    // the tab's first control has the focus after LB / RB (or the tab itself): walk it from there
    await page.evaluate(() => {
      const first = document.querySelector('#settings.open .sheet-body [tabindex="0"], #settings.open .sheet-body button, #settings.open .sheet-body input');
      if (!document.querySelector('#settings.open .sheet-body')?.contains(document.activeElement)) first?.focus({ focusVisible: true });
    });
    await page.screenshot({ path: `${dir}/${name}-settings-${tab}.png` });
    total += await steppers(name, tab);
    await walk(`${name}-settings-${tab}`, '#settings.open', { shotAt: 9999 });
    await press(RB);
    await page.waitForTimeout(200);
  }
  check(total > 0, `${name}: Settings has ${total} steppers across its tabs`);
}

try {
  // ── the title screen: pad only from "Press any button" ──
  await page.goto(`${base}/?title=1`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('solarbloom.settings', JSON.stringify({ uiScale: 150 }));
  });
  await page.goto(`${base}/?title=1`);
  await page.waitForSelector('#tPress, #tPlay', { timeout: 120_000 });
  await page.waitForTimeout(800);
  if (await page.$('#tPress')) await press(A);
  await opened('title', '.t-menu', { expect: /tPlay/ });
  await walk('title', '.t-menu');
  await page.evaluate(() => document.getElementById('tPlay').focus({ focusVisible: true }));
  // Settings from the title
  const tSet = await page.evaluate(() => !!document.querySelector('.t-menu [data-t="settings"]'));
  if (check(tSet, 'title: has Settings')) {
    await page.evaluate(() => document.querySelector('.t-menu [data-t="settings"]').focus({ focusVisible: true }));
    await press(A);
    await settingsTour('title');
    await press(B);
    await page.waitForTimeout(300);
    const back = await focusState();
    check(!back.none && back.ring, `title: B from Settings puts the focus back on the menu ("${back.id}")`);
  }

  // ── in the game ──
  await startGame(page, base, { settings: { uiScale: 150 } });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const sv = window.solarbloom.sim.state.salvage;
    sv.tier = Math.max(sv.tier, 1); // build mode opens at fountain step 1
    if (!sv.abilities.includes('pry')) sv.abilities.push('pry');
  });
  for (const time of ['day', 'night']) {
    if (time === 'night')
      await page.evaluate(() => {
        const s = window.solarbloom.sim;
        (s.state.clock ??= { offset: 0 }).offset += (0.83 - s.clock.dayFraction()) * 2880;
        s.lights.dark = s.power.sky().dark;
      });
    await page.waitForTimeout(600);
    const T = (n) => `${time}-${n}`;
    // the pause menu: Start
    await press(START);
    await opened(T('menu'), '#menu.open', { expect: /resume/i });
    await walk(T('menu'), '#menu.open');
    if (time === 'day') {
      await page.evaluate(() => document.getElementById('menu-settings').focus({ focusVisible: true }));
      await press(A);
      await settingsTour('game');
      await press(B);
      await page.waitForTimeout(300);
      const back = await focusState();
      check(back.id === 'menu-settings', `menu: B from Settings comes back to Settings in the menu ("${back.id}")`);
    } else {
      await page.evaluate(() => document.getElementById('menu-settings').focus({ focusVisible: true }));
      await press(A);
      await opened(T('settings'), '#settings.open');
      await press(B);
      await page.waitForTimeout(300);
    }
    await press(B);
    await page.waitForTimeout(400);
    check(await page.evaluate(() => !document.querySelector('#menu.open')), `${time}: B closes the menu`);

    // the backpack: d-pad up
    await press(UP);
    await opened(T('backpack'), '#bpScreen.open');
    for (let t = 0; t < 4; t++) {
      const tab = await page.evaluate(() => document.querySelector('#bpScreen [aria-selected=true]')?.dataset.tab ?? 'tab');
      if (time === 'day') await walk(T(`backpack-${tab}`), '#bpScreen.open', { shotAt: 9999 });
      await page.screenshot({ path: `${dir}/${T(`backpack-${tab}`)}.png` });
      await press(RB);
      await page.waitForTimeout(250);
    }
    await press(B);
    await page.waitForTimeout(400);

    // the build menu: Y
    await press(Y);
    await opened(T('build'), '#buildMenu.open');
    if (time === 'day') await walk(T('build'), '#buildMenu.open');
    await press(B);
    await page.waitForTimeout(400);

    // the crafting table and the fountain (opened as A at them opens them)
    await page.evaluate(() => {
      window.solarbloom.bot.lastInput = 'pad';
      window.solarbloom.hud.craft.open();
    });
    await opened(T('craft'), '#craftScreen.open');
    if (time === 'day') await walk(T('craft'), '#craftScreen.open');
    await press(B);
    await page.waitForTimeout(400);
    await page.evaluate(() => window.solarbloom.oc.openFountain());
    await opened(T('fountain'), '#ocPanel.open', { notBack: false });
    if (time === 'day') await walk(T('fountain'), '#ocPanel.open');
    await press(B);
    await page.waitForTimeout(400);
  }
  check(!errors.length, `no page errors ${errors.join(' | ')}`);
} catch (e) {
  failures.push(String(e));
  console.log('✗', e);
  await page.screenshot({ path: `${dir}/x-error.png` }).catch(() => {});
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failures.length ? `${failures.length} failed` : 'all good');
process.exit(failures.length ? 1 : 0);
