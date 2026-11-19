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
/**
 * Takes a build from the build menu as a player does: Q (Y on the pad) opens it, the arrows / d-pad reach the card,
 * Enter / A takes it. Returns the tray's size as it opened (it must be seen: the Old City hides the hotbar it sits in)
 * and whether the build is in hand.
 */
async function pick(page, dev, tool) {
  if (dev === 'pad') await pressPad(page, 3);
  else await page.keyboard.press('KeyQ');
  await page.waitForSelector('#buildTray.open', { timeout: 10000 }).catch(() => {});
  const tray = await page.evaluate(() => {
    const r = document.querySelector('#buildTray')?.getBoundingClientRect();
    return r ? { w: Math.round(r.width), h: Math.round(r.height) } : { w: 0, h: 0 };
  });
  const ok = await moveTo(page, `#buildTray.open [data-tool="${tool}"]`, dev);
  if (ok) await go(page, dev);
  await page.waitForTimeout(300);
  const inHand = ok && (await page.evaluate(() => window.solarbloom.hud.currentTool)) === tool;
  return { tray, inHand };
}

/**
 * Places what is in hand on (x, z) (a machine's corner, or a decoration's tile), aimed as in third person (#542):
 * build mode places under the crosshair, which rests a little ahead of bloombot, so bloombot steps until the ghost
 * sits on the spot (as a player walks the ghost over it), then Space or A places. The steps are moves to where
 * bloombot stands next (walking is not under test here). Returns what the game said if nothing was placed.
 */
async function placeAt(page, dev, x, z) {
  await page.waitForFunction(() => window.solarbloom.bot.visuals.busy !== 'assemble', null, { timeout: 90000 }).catch(() => {});
  const aimed = await page.evaluate(async ({ x, z }) => {
    const g = window.solarbloom;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const tool = g.hud.currentTool;
    const machine = !tool.startsWith('decor:');
    const size = machine ? ({ condenser: 1 }[tool] ?? 1) : 1;
    const cx = x + size / 2, cz = z + size / 2;
    const on = () => {
      const p = g.crosshairPick();
      if (!p) return { ok: false };
      const a = machine ? g.sim.build.anchorFor(tool, p.fx, p.fz) : { x: Math.floor(p.fx), z: Math.floor(p.fz) };
      return { ok: a.x === x && a.z === z, p };
    };
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const sx = cx + dx * 2, sz = cz + dz * 2;
      g.bot.cancelWalk();
      g.bot.teleport('g', sx, sz);
      if (Math.hypot(g.bot.pose.x - sx, g.bot.pose.z - sz) < 0.05) break;
    }
    for (let i = 0; i < 12; i++) {
      for (let f = 0; f < 3; f++) await frame();
      const st = on();
      if (st.ok) {
        await frame();
        if (on().ok) return true;
        continue;
      }
      if (!st.p) break;
      g.bot.cancelWalk();
      g.bot.teleport('g', g.bot.pose.x + (cx - st.p.fx), g.bot.pose.z + (cz - st.p.fz));
    }
    return false;
  }, { x, z });
  if (!aimed) return 'the crosshair never rested on it';
  await page.evaluate(() => {
    const g = window.solarbloom;
    window.__fails = [];
    if (!g.hud.__failHook) {
      const o = g.hud.showFail.bind(g.hud);
      g.hud.showFail = (m, ...a) => (window.__fails.push(m), o(m, ...a));
      g.hud.__failHook = true;
    }
  });
  if (dev === 'pad') await pressPad(page, 0);
  else await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  return (await page.evaluate(() => window.__fails.join(' | '))) || undefined;
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
    // the door in front of the shed keeps the house's own things: the radio by day (E23.7.2), the bed from dusk
    const door = await page.evaluate(async () => {
      const g = window.solarbloom;
      g.bot.teleport('g', 4.5, 6.5);
      g.bot.pose.facing = Math.PI;
      await new Promise((r) => setTimeout(r, 300));
      const id = g.interactTarget()?.id;
      g.bot.teleport('g', 3.5, 5.5);
      g.bot.pose.facing = Math.PI;
      await new Promise((r) => setTimeout(r, 300));
      return id;
    });
    check(door === 'house:radio' || door === 'house:sleep', T(`the door offers the radio or the bed (${door})`));
    check((await page.evaluate(() => window.solarbloom.interactTarget()?.id)) === 'craft:table', T('back at the shed: the crafting table again'));
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
    {
    // a decoration is made once at the table (Make, on the Craft tab), then placed free from the build menu
    await page.evaluate(() => {
      const g = window.solarbloom, s = g.sim;
      s.inventory.add('sunCell', 1);
      // open, restored ground west of the fountain to build on
      for (let x = 6; x < 12; x++)
        for (let z = 8; z < 13; z++) {
          const t = s.grid.get('g', x, z);
          if (!t || t.occupantId) continue;
          t.blocked = false;
          t.ground = 'restored';
          t.pollution = 0;
          t.bloom = 1;
          s.grid.touch(t);
          g.chunks.markTile(t);
        }
      g.bot.teleport('g', 3.5, 5.5);
      g.bot.pose.facing = Math.PI;
    });
    await page.waitForTimeout(300);
    await interact(page, dev);
    await page.waitForSelector('#craftScreen.open');
    // the Water Condenser is on the table's machine list, with its recipe
    const listed = await page.evaluate(() => [...document.querySelectorAll('#craftScreen .cr-machines li')].map((l) => l.getAttribute('aria-label')).find((l) => /^Water Condenser:/.test(l ?? '')));
    check(/12 Scrap/.test(listed ?? '') && /6 Copper/.test(listed ?? '') && /2 Wire/.test(listed ?? ''), T(`the table lists the Water Condenser with its recipe ("${listed}")`));
    const planksBefore = await page.evaluate(() => window.solarbloom.sim.inventory.count('planks') + window.solarbloom.sim.inventory.stored('planks'));
    check(await moveTo(page, '#cr-decor-bench', dev), T('reach the bench under Decorations'));
    await go(page, dev);
    const made = await page.evaluate(() => ({ made: window.solarbloom.sim.crafting.decorMade('bench'), planks: window.solarbloom.sim.inventory.count('planks') + window.solarbloom.sim.inventory.stored('planks'), live: document.querySelector('#craftScreen .bp-live').textContent }));
    check(made.made && made.planks === planksBefore - 2, T(`make the bench once: 2 Planks (${JSON.stringify(made)})`));
    await page.screenshot({ path: `${dir}/ui-workshop-decor-${dev}.png` });
    // E23.3.5 × E23.6.1: a night light is made at the table too (the Solar garden light: a Sun cell and a Scrap)
    check(await moveTo(page, '#cr-decor-solarstake', dev), T('reach the Solar garden light under Decorations'));
    await go(page, dev);
    const light = await page.evaluate(() => ({ made: window.solarbloom.sim.crafting.decorMade('solarstake'), sunCells: window.solarbloom.sim.inventory.count('sunCell'), live: document.querySelector('#craftScreen .bp-live').textContent }));
    check(light.made && light.sunCells === 0, T(`make the light: a Sun cell and a Scrap (${JSON.stringify(light)})`));
    await page.evaluate(() => document.querySelector('#craftScreen .cr-decor li:last-child')?.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${dir}/ui-workshop-light-${dev}.png` });
    await back(page, dev);
    await page.waitForTimeout(300);
    // the bench from the build menu: placing it is free
    const have = () => page.evaluate(() => window.solarbloom.sim.inventory.count('planks') + window.solarbloom.sim.inventory.stored('planks'));
    let p = await pick(page, dev, 'decor:bench');
    check(p.tray.w > 0 && p.tray.h > 0, T(`${dev === 'pad' ? 'Y' : 'Q'} opens the build menu, and it is seen (${p.tray.w} × ${p.tray.h})`));
    check(p.inHand, T('the bench is taken from the build menu'));
    await page.screenshot({ path: `${dir}/ui-workshop-buildmenu-${dev}.png` });
    const planks = await have();
    let why = await placeAt(page, dev, 7, 9);
    const bench = await page.evaluate(() => window.solarbloom.cozy.decorAt('g', 7, 9)?.kind);
    check(bench === 'bench' && (await have()) === planks, T(`Space / A places the bench, free (${bench}${why ? `: ${why}` : ''})`));
    // the light from the build menu
    p = await pick(page, dev, 'decor:solarstake');
    check(p.tray.w > 0 && p.inHand, T('the light is taken from the build menu'));
    why = await placeAt(page, dev, 9, 9);
    const lit = await page.evaluate(() => window.solarbloom.cozy.decorAt('g', 9, 9)?.kind);
    check(lit === 'solarstake', T(`Space / A places the light (${lit}${why ? `: ${why}` : ''})`));
    // a machine from its table recipe: the Water Condenser (12 Scrap, 6 Copper, 2 Wire), paid exactly where it is built
    p = await pick(page, dev, 'condenser');
    check(p.tray.w > 0 && p.inHand, T('the Water Condenser is taken from the build menu'));
    const total = () =>
      page.evaluate(() => {
        const inv = window.solarbloom.sim.inventory;
        return Object.fromEntries(['scrap', 'copper', 'wire'].map((k) => [k, inv.count(k) + inv.stored(k)]));
      });
    const before = await total();
    why = await placeAt(page, dev, 8, 11);
    const at = await page.evaluate(() => {
      const m = window.solarbloom.sim.machinesOfType('condenser')[0];
      return m && [m.x, m.z];
    });
    const paid = await total();
    check(
      !!at && paid.scrap === before.scrap - 12 && paid.copper === before.copper - 6 && paid.wire === before.wire - 2,
      T(`Space / A builds the Water Condenser for exactly its recipe (${JSON.stringify({ at, before, paid, why })})`),
    );
    await back(page, dev); // nothing more to build: B / Esc puts it away
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.bot.cancelWalk();
      g.bot.teleport('g', 8.5, 13.5);
      g.bot.pose.facing = Math.PI;
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${dir}/ui-workshop-placed-${dev}.png` });
    }
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
