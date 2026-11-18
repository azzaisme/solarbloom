// E23.6.1 (#435) and E23.6.2 (#391): the workshop in the house (crafting table, upgrades, research station) with
// the keyboard alone and with the pad alone, at 1280 × 800.
// - Craft: open it at the shed, make Wire, see it in the backpack count; the game pauses while it is open.
// - Research: look closely at a find, start a project, see it on the bench.
// - Upgrade: buy a level of an upgrade research has opened.
// Screenshots go to SHOTS_DIR (default docs/review/ui-workshop-*.png). Run after `vite build` (npm run test:workshop),
// or against a running dev server with BASE_URL=http://localhost:5173.
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const PAD = driver + '\ninstallVirtualPad(); window.padDriver = padDriver; window.installVirtualPad = installVirtualPad;';
const server = process.env.BASE_URL ? undefined : await preview({ preview: { port: 4236, strictPort: true }, logLevel: 'silent' });
const base = process.env.BASE_URL ?? 'http://localhost:4236';
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
  for (let i = 0; i < 60; i++) {
    const dir = await page.evaluate((sel) => {
      const t = document.querySelector(sel);
      const c = document.activeElement;
      if (!t) return 'missing';
      if (c === t) return 'here';
      if (!c || c === document.body) return 'down';
      if (c.closest('[role=tablist]')) return 'down';
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
const nextTab = (page, dev) => (dev === 'pad' ? pressPad(page, 5) : page.keyboard.press('KeyE'));
const back = (page, dev) => (dev === 'pad' ? pressPad(page, 1) : page.keyboard.press('Escape'));
const interact = (page, dev) => (dev === 'pad' ? pressPad(page, 0) : page.keyboard.press('KeyE'));

async function open(dev) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (dev === 'pad') await page.addInitScript(PAD);
  await page.goto(`${base}/?slot=1&new=1`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  // An Old City game a little way in: Copper and Timber carried, Pylon awake (so the station is there), and a
  // finished project that opened the backpack upgrade. Bloombot stands at the shed's door, facing it.
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    const sv = g.sim.state.salvage;
    Object.assign(sv.pack, { scrap: 30, seeds: 12, copper: 32, timber: 20 });
    Object.assign(sv.store, { planks: 20, scrap: 40 });
    sv.tier = 1;
    sv.keepers.pylon = { step: 'request1' };
    sv.research = { analysed: [], done: ['rb-backpack'], running: [], levels: {} };
    g.bot.teleport('g', 3.5, 5.5);
    g.bot.pose.facing = Math.PI;
  });
  await page.waitForTimeout(600);
  return { page, errors };
}

try {
  for (const dev of (process.env.DEVS ?? 'keys,pad').split(',')) {
    const { page, errors } = await open(dev);
    const T = (s) => `E23.6 ${dev}: ${s}`;
    const prompt = await page.evaluate(() => window.solarbloom.interactTarget()?.id);
    check(prompt === 'craft:table', T(`the shed offers the crafting table (${prompt})`));
    await interact(page, dev);
    await page.waitForSelector('#craftScreen.open');
    check(await page.evaluate(() => window.solarbloom.paused), T('the workshop opens and the game pauses'));
    // Craft: Wire
    check(await moveTo(page, '#crc-wire', dev), T('reach Wire'));
    await go(page, dev);
    check(await page.evaluate(() => document.activeElement?.id === 'cr-make-1'), T('Enter / A on Wire steps into Make'));
    await go(page, dev);
    await page.waitForFunction(() => window.solarbloom.sim.inventory.count('wire') >= 2, null, { timeout: 30000 }).catch(() => {});
    const made = await page.evaluate(() => ({ wire: window.solarbloom.sim.inventory.count('wire'), copper: window.solarbloom.sim.inventory.count('copper'), live: document.querySelector('#craftScreen .bp-live').textContent, paused: window.solarbloom.paused, why: [...(window.solarbloom.pause.reasons ?? [])], q: JSON.stringify(window.solarbloom.sim.state.salvage.craft) }));
    if (made.wire !== 2) console.log('   ', JSON.stringify(made));
    check(made.wire === 2 && made.copper === 30, T(`make Wire while paused: ${made.wire} Wire, ${made.copper} Copper, "${made.live}"`));
    await page.screenshot({ path: `${dir}/ui-workshop-craft-${dev}.png` });
    // Upgrade: the backpack
    await nextTab(page, dev);
    await page.waitForSelector('#cr-up-backpack');
    check(await moveTo(page, '#cr-up-backpack', dev), T('reach the backpack upgrade'));
    const before = await page.evaluate(() => window.solarbloom.sim.inventory.stackLimit());
    await go(page, dev);
    const after = await page.evaluate(() => ({ lvl: window.solarbloom.sim.research.level('backpack'), stack: window.solarbloom.sim.inventory.stackLimit() }));
    check(after.lvl === 1 && after.stack === before + 20, T(`buy a level: level ${after.lvl}, stacks ${before} → ${after.stack}`));
    await page.screenshot({ path: `${dir}/ui-workshop-upgrade-${dev}.png` });
    // Research: look at a find, start a project
    await nextTab(page, dev);
    await page.waitForSelector('[data-find]');
    const find = await page.evaluate(() => document.querySelector('[data-find]').id);
    check(await moveTo(page, `#${find}`, dev), T('reach a new find'));
    await go(page, dev);
    const opened = await page.evaluate(() => window.solarbloom.sim.research.open().map((p) => p.id));
    check(opened.length > 0, T(`looking closely opens projects: ${opened.join(', ')}`));
    const pid = await page.evaluate(() => {
      const r = window.solarbloom.sim.research;
      return r.open().find((p) => !r.problem(p.id))?.id;
    });
    if (pid) {
      check(await moveTo(page, `#rs-p-${pid}`, dev), T(`reach project ${pid}`));
      await go(page, dev);
      if (!(await page.evaluate(() => document.activeElement?.id === 'rs-start'))) await moveTo(page, '#rs-start', dev);
      await go(page, dev);
      const bench = await page.evaluate(() => window.solarbloom.sim.research.bench().map((b) => b.project.id));
      check(bench.includes(pid), T(`start a project: on the bench ${bench.join(', ')}`));
    } else check(false, T('a project that can start'));
    await page.screenshot({ path: `${dir}/ui-workshop-research-${dev}.png` });
    const fits = await page.evaluate(() => {
      const r = document.querySelector('#craftScreen .bp-card').getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    });
    check(fits, T('the panel fits 1280 × 800'));
    await back(page, dev);
    await page.waitForTimeout(200);
    const closed = await page.evaluate(() => ({ open: window.solarbloom.hud.craft.isOpen, paused: window.solarbloom.paused }));
    check(!closed.open && !closed.paused, T('Esc / B closes it and the game runs again'));
    // a decoration is made once at the table (Make, on the Craft tab), then placed free from the build menu
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.bot.teleport('g', 3.5, 5.5);
      g.bot.pose.facing = Math.PI;
    });
    await interact(page, dev);
    await page.waitForSelector('#craftScreen.open');
    const planksBefore = await page.evaluate(() => window.solarbloom.sim.inventory.count('planks') + window.solarbloom.sim.inventory.stored('planks'));
    check(await moveTo(page, '#cr-decor-bench', dev), T('reach the bench under Decorations'));
    await go(page, dev);
    const made = await page.evaluate(() => ({ made: window.solarbloom.sim.crafting.decorMade('bench'), planks: window.solarbloom.sim.inventory.count('planks') + window.solarbloom.sim.inventory.stored('planks'), live: document.querySelector('#craftScreen .bp-live').textContent }));
    check(made.made && made.planks === planksBefore - 2, T(`make the bench once: 2 Planks (${JSON.stringify(made)})`));
    await page.screenshot({ path: `${dir}/ui-workshop-decor-${dev}.png` });
    await back(page, dev);
    await page.waitForTimeout(200);
    const dec = await page.evaluate(() => {
      const g = window.solarbloom, s = g.sim;
      const t = s.grid.get('g', 6, 7);
      t.ground = 'restored';
      t.pollution = 0;
      s.grid.touch(t);
      const have = () => s.inventory.count('planks') + s.inventory.stored('planks');
      const before = have();
      g.selectTool('decor:bench');
      const hidden = document.querySelector('#hotbar [data-tool="decor:bench"]')?.hidden;
      const why = g.cozy.canDecorate('bench', 'g', 6, 7) ?? g.cozy.placeDecor('bench', 0, 'g', 6, 7);
      const why2 = g.cozy.canDecorate('bench', 'g', 6, 8);
      const placed = have();
      g.cozy.removeDecor('g', 6, 7);
      g.selectTool('pulse');
      return { why, why2, before, placed, hidden };
    });
    check(!dec.why && dec.placed === dec.before && dec.hidden === false, T(`then the bench is placed free from the build menu (${JSON.stringify(dec)})`));
    check(errors.length === 0, T(`no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`));
    await page.context().close();
  }
} finally {
  await browser.close();
  await server?.close();
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
