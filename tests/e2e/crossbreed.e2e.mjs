// E23.6.2 (#391): crossbreeding in the game, at 1280 × 800, on the keyboard alone and the pad alone.
// - with the Crossbreeds research bought, two planters side by side (Radish ripe, Lettuce growing);
// - Interact (E or A) on the ripe Radish harvests it, and a toast names the new cross: "Radish × Lettuce";
// - Interact on the empty planter opens its panel; the cross is in the picker; arrows / d-pad and Enter / A plant it;
// - the bed then grows the cross (its panel names both parents).
// Screenshots go to SHOTS_DIR (default docs/review). Run after `vite build`, or against a dev server with BASE_URL.
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const PAD = driver + '\ninstallVirtualPad(); window.padDriver = padDriver; window.installVirtualPad = installVirtualPad;';
const server = process.env.BASE_URL ? undefined : await preview({ preview: { port: 4242, strictPort: true }, logLevel: 'silent' });
const base = process.env.BASE_URL ?? 'http://localhost:4242';
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

/** Moves the focus onto an element with the d-pad or the arrow keys, as a player would. */
async function moveTo(page, sel, dev) {
  for (let i = 0; i < 80; i++) {
    const dir = await page.evaluate((sel) => {
      const t = document.querySelector(sel);
      const c = document.activeElement;
      if (!t) return 'missing';
      if (c === t) return 'here';
      if (!c || c === document.body) return 'down';
      const a = c.getBoundingClientRect(), b = t.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      return Math.abs(dy) > 6 ? (dy > 0 ? 'down' : 'up') : dx > 0 ? 'right' : 'left';
    }, sel);
    if (dir === 'here') return true;
    if (dir === 'missing') break;
    if (dev === 'pad') await pressPad(page, { up: 12, down: 13, left: 14, right: 15 }[dir]);
    else await page.keyboard.press({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[dir]);
    await page.waitForTimeout(30);
  }
  console.log(`   moveTo ${sel}: stopped at ${await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}`);
  return false;
}
const go = (page, dev) => (dev === 'pad' ? pressPad(page, 0) : page.keyboard.press('Enter'));
const interact = (page, dev) => (dev === 'pad' ? pressPad(page, 0) : page.keyboard.press('KeyE'));

async function open(dev) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (dev === 'pad') await page.addInitScript(PAD);
  await page.goto(`${base}/?slot=1&new=1&gfx=deck`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  // A farm a little way in: Timber come in (Tide awake), the Crossbreeds research bought, a sunny day, and two
  // planters side by side by the fountain: a ripe Radish and a growing Lettuce. Bloombot faces the Radish.
  const ids = await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    const s = g.sim;
    const sv = s.state.salvage;
    sv.tier = 1;
    sv.keepers.tide = { step: 'request1' };
    sv.research = { analysed: [], done: ['fm-crossbreed'], running: [], levels: { crossbreed: 1 } };
    s.weather.forceForTest('sunny', 1e12);
    for (let x = 10; x < 16; x++)
      for (let z = 12; z < 17; z++) {
        const t = s.grid.get('g', x, z);
        if (!t || t.occupantId) continue;
        t.blocked = false;
        t.feature = undefined;
        t.ground = 'restored';
        t.pollution = 0;
        t.bloom = 1;
        s.grid.touch(t);
        g.chunks.markTile(t);
      }
    s.inventory.add('planks', 6);
    s.inventory.add('seeds', 4);
    const a = s.build.place('planter', 'g', 12, 14);
    const b = s.build.place('planter', 'g', 13, 14);
    (sv.crops ??= []).push('lettuce');
    s.farm.plant(a, 'radish');
    s.farm.plant(b, 'lettuce');
    sv.planters[a.id].grown = 1;
    g.bot.teleport('g', 12.5, 15.6);
    g.bot.pose.facing = Math.PI;
    return { a: a?.id, b: b?.id, front: g.bot.front() };
  });
  await page.waitForTimeout(600);
  return { page, errors, ids };
}

try {
  for (const dev of (process.env.DEVS ?? 'keys,pad').split(',')) {
    const { page, errors, ids } = await open(dev);
    const T = (s) => `E23.6.2 ${dev}: ${s}`;
    // the setup's own news ("20 tiles restored!") has had its turn: the calm HUD shows one toast at a time
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => !(document.querySelector('#toasts')?.textContent ?? '').trim(), null, { timeout: 20000 }).catch(() => {});
    const target = await page.evaluate(() => window.solarbloom.interactTarget());
    check(target?.id === `planter:${ids.a}` && target?.verb === 'Harvest', T(`facing the ripe Radish: "${target?.verb} ${target?.name}" (${JSON.stringify(ids)})`));
    await interact(page, dev);
    await page.waitForTimeout(400);
    const crosses = await page.evaluate(() => window.solarbloom.sim.state.salvage.crosses);
    check(crosses?.includes('radish+lettuce'), T(`the harvest beside Lettuce finds a cross (${JSON.stringify(crosses)})`));
    // toasts take turns: the cross's comes once the one before it has gone
    const toast = await page
      .waitForFunction(() => /Radish × Lettuce/.test(document.querySelector('#toasts')?.textContent ?? ''), null, { timeout: 20000 })
      .then(() => page.evaluate(() => document.querySelector('#toasts')?.textContent ?? ''))
      .catch(() => page.evaluate(() => `(not seen) ${document.querySelector('#toasts')?.textContent ?? ''}`));
    check(/Radish × Lettuce/.test(toast), T(`a toast names it ("${toast.slice(0, 80)}")`));
    await page.screenshot({ path: `${dir}/ui-cross-found-${dev}.png` });
    // the empty planter's panel: the cross is in the picker
    await page.waitForTimeout(1500);
    await interact(page, dev);
    await page.waitForSelector('#ocPanel.open');
    const btn = '#ocPanel button[data-arg="radish+lettuce"]';
    check(!!(await page.$(btn)), T('the empty planter offers the cross'));
    check(await moveTo(page, btn, dev), T('reach the cross with the arrows / d-pad'));
    await page.screenshot({ path: `${dir}/ui-cross-picker-${dev}.png` });
    await go(page, dev);
    await page.waitForTimeout(300);
    const bed = await page.evaluate((id) => ({ bed: window.solarbloom.sim.farm.bed(id), open: !!document.querySelector('#ocPanel.open') }), ids.a);
    check(bed.bed.crop === 'radish' && bed.bed.cross === 'lettuce' && !bed.open, T(`Enter / A plants it (${JSON.stringify(bed)})`));
    // its panel names both parents
    await page.waitForTimeout(1500);
    await interact(page, dev);
    await page.waitForSelector('#ocPanel.open');
    const title = await page.evaluate(() => document.querySelector('#ocPanel h2')?.textContent ?? '');
    check(/Radish × Lettuce/.test(title), T(`the growing cross is named for both parents ("${title}")`));
    await page.screenshot({ path: `${dir}/ui-cross-growing-${dev}.png` });
    check(errors.length === 0, T(`no page errors ${errors.join(' | ')}`));
  }
} finally {
  await browser.close();
  await server?.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
