// E22.6 (#343) and E22.7 (#344): the backpack and the build menu with the keyboard alone and with the pad alone,
// at 1280 × 800.
// - Backpack: open it, read a material, pin a request, deposit a stack; axe-core finds no serious or critical
//   issue on any tab; again at 150% interface size in high contrast.
// - Build menu (when present): build a Solar Panel and place a decoration with the pad alone.
// Screenshots go to docs/review/ui-backpack-*.png and ui-build-*.png. Run after `vite build` (npm run test:backpack).
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const PAD = driver + '\ninstallVirtualPad(); window.padDriver = padDriver; window.installVirtualPad = installVirtualPad;';
const server = await preview({ preview: { port: 4235, strictPort: true }, logLevel: 'silent' });
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

async function open(dev, settings = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); // axe-core wants a context of its own
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (dev === 'pad') await page.addInitScript(PAD);
  await page.addInitScript((s) => localStorage.setItem('solarbloom.settings', JSON.stringify(s)), settings);
  await page.goto('http://localhost:4235/?slot=1&new=1');
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  // An Old City game some way in: things carried and stored, two Keepers asking, a page and a blueprint found,
  // the fountain's first step done (so there is build mode), bloombot beside the fountain (a way into the store).
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    const s = g.sim;
    const sv = s.state.salvage;
    Object.assign(sv.pack, { scrap: 30, seeds: 12, copper: 32, timber: 20 });
    Object.assign(sv.store, { copper: 110, scrap: 60, timber: 40 });
    sv.keepers.pylon = { step: 'request1' };
    sv.keepers.tide = { step: 'request1' };
    sv.pages = ['p-park-1', 'p-mastRow-1'];
    sv.blueprints = ['networks'];
    sv.tier = 1;
    if (!sv.abilities.includes('pry')) sv.abilities.push('pry');
    const f = s.state.machines.find((m) => m.type === 'core' && s.areas.areaOf(m) === 'park');
    g.bot.teleport(f.roofId, f.x + f.size / 2, f.z + f.size + 1.6);
    g.bot.pose.facing = 0; // facing away from the fountain: open ground in front
  });
  await page.waitForTimeout(600);
  return { page, errors };
}

async function axe(page, sel, what) {
  const r = await new AxeBuilder({ page }).include(sel).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(bad.length === 0, `${what}: axe-core finds no serious or critical issue${bad.length ? `: ${bad.map((v) => `${v.id} (${v.nodes.length}: ${v.nodes[0].target})`).join('; ')}` : ''}`);
}

try {
  for (const dev of ['keys', 'pad']) {
    const { page, errors } = await open(dev);
    const T = (s) => `E22.6 ${dev}: ${s}`;
    if (dev === 'pad') await pressPad(page, 12); // d-pad up
    else await page.keyboard.press('Tab');
    await page.waitForSelector('#bpScreen.open');
    check(await page.evaluate(() => window.solarbloom.paused), T('the backpack opens and the game pauses'));
    // read a material: move the focus ring to Copper
    check(await moveTo(page, '#bpmat-copper', dev), T('reach Copper in the grid'));
    const read = await page.evaluate(() => ({ label: document.querySelector('#bpmat-copper').getAttribute('aria-label'), detail: document.querySelector('#bpDetail').innerText, sel: document.querySelector('#bpmat-copper').getAttribute('aria-selected') }));
    check(read.label === 'Copper, 32 of 40 in backpack, 110 in store' && read.sel === 'true' && /Mast Row/.test(read.detail) && /In the store\s*110/.test(read.detail), T(`reading Copper: "${read.label}", where it comes from and the store`));
    await page.screenshot({ path: `${dir}/ui-backpack-items-${dev}.png` });
    await axe(page, '#bpScreen', T('Items'));
    // deposit a stack: Enter / A on the material steps into its moves
    await go(page, dev);
    check(await moveTo(page, '#bp-put-stack', dev), T('reach "All of it"'));
    await go(page, dev);
    const dep = await page.evaluate(() => ({ live: document.querySelector('.bp-live').textContent, pack: window.solarbloom.sim.inventory.count('copper'), store: window.solarbloom.sim.inventory.stored('copper'), label: document.querySelector('#bpmat-copper').getAttribute('aria-label') }));
    check(dep.live === 'Deposited 32 Copper' && dep.pack === 0 && dep.store === 142, T(`deposit a stack: "${dep.live}" (${dep.label})`));
    // Requests: pin the second one
    await nextTab(page, dev);
    await page.waitForSelector('#bpreq-tide');
    check(await moveTo(page, '#bpreq-tide', dev), T('reach Tide\'s request'));
    await go(page, dev);
    const pin = await page.evaluate(() => ({ live: document.querySelector('.bp-live').textContent, pressed: document.querySelector('#bpreq-tide').getAttribute('aria-pressed') }));
    check(pin.pressed === 'true' && /Pinned: Tide/.test(pin.live), T(`pin a request: "${pin.live}"`));
    await page.screenshot({ path: `${dir}/ui-backpack-requests-${dev}.png` });
    await axe(page, '#bpScreen', T('Requests'));
    for (const tab of ['Journal', 'Collection', 'Blueprints']) {
      await nextTab(page, dev);
      await page.waitForFunction((t) => document.querySelector('#bpScreen [role=tab][aria-selected=true]')?.textContent === t, tab);
      if (dev === 'keys') await page.screenshot({ path: `${dir}/ui-backpack-${tab.toLowerCase()}.png` });
      await axe(page, '#bpScreen', T(tab));
      const fits = await page.evaluate(() => {
        const r = document.querySelector('#bpScreen .bp-card').getBoundingClientRect();
        return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      });
      check(fits, T(`${tab} stays on screen`));
    }
    const small = await page.evaluate(() => [...document.querySelectorAll('#bpScreen *')].filter((e) => e.childElementCount === 0 && e.textContent.trim() && e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => `${e.className || e.tagName}:${getComputedStyle(e).fontSize}`));
    check(small.length === 0, T(`all text is 16 px or more ${small.slice(0, 4).join(', ')}`));
    await back(page, dev);
    await page.waitForFunction(() => !document.querySelector('#bpScreen.open'));
    const after = await page.evaluate(() => ({ paused: window.solarbloom.paused, obj: document.querySelector('#objTitle').innerText }));
    check(!after.paused && /Tide/.test(after.obj), T(`closing resumes the game; the objective shows the pinned request ("${after.obj.replace(/\s+/g, ' ')}")`));
    check(!errors.length, T(`no page errors ${errors.join(' | ')}`));

    // ───── E22.7: the build menu, pad alone (and the keyboard for good measure) ─────
    if (await page.evaluate(() => !!document.querySelector('#buildMenu'))) {
      const B = (s) => `E22.7 ${dev}: ${s}`;
      const openMenu = () => (dev === 'pad' ? pressPad(page, 3) : page.keyboard.press('KeyQ'));
      await openMenu();
      await page.waitForSelector('#buildMenu.open');
      await page.screenshot({ path: `${dir}/ui-build-machines-${dev}.png` });
      await axe(page, '#buildMenu', B('Machines'));
      // E23.11: the Solar Panel is on the Power tab
      for (let i = 0; i < 8 && !(await page.evaluate(() => !!document.querySelector('#bm-solar'))); i++) await nextTab(page, dev);
      check(await moveTo(page, '#bm-solar', dev), B('reach the Solar Panel card'));
      await go(page, dev);
      await page.waitForFunction(() => window.solarbloom.hud.currentTool === 'solar' && !document.querySelector('#buildMenu.open'));
      const before = await page.evaluate(() => window.solarbloom.sim.state.machines.filter((m) => m.type === 'solar' && !m.starter).length);
      if (dev === 'pad') await pressPad(page, 0);
      else await page.keyboard.press('Space');
      await page.waitForTimeout(400);
      const built = await page.evaluate(() => ({ n: window.solarbloom.sim.state.machines.filter((m) => m.type === 'solar' && !m.starter).length, scrap: window.solarbloom.sim.inventory.count('scrap') }));
      check(built.n === before + 1, B(`a Solar Panel is built (${built.n - before} new, ${built.scrap} Scrap left)`));
      // a decoration: the Decorations tab, the first card, placed beside
      await page.evaluate(() => {
        const g = window.solarbloom;
        g.closeAll();
        g.bot.pose.facing = Math.PI / 2;
      });
      await page.waitForTimeout(300);
      await openMenu();
      await page.waitForSelector('#buildMenu.open');
      // E23.11: RB / E until the Decorations tab (the menu opens on the tab used last)
      for (let i = 0; i < 8 && (await page.evaluate(() => document.querySelector('#buildMenu [role=tab][aria-selected=true]')?.textContent)) !== 'Decorations'; i++) await nextTab(page, dev);
      await page.waitForFunction(() => document.querySelector('#buildMenu [role=tab][aria-selected=true]')?.textContent === 'Decorations');
      await page.screenshot({ path: `${dir}/ui-build-decorations-${dev}.png` });
      await axe(page, '#buildMenu', B('Decorations'));
      const first = await page.evaluate(() => document.querySelector('#buildMenu .bm-card:not([aria-disabled=true])')?.id);
      check(!!first && (await moveTo(page, `#${first}`, dev)), B('reach a decoration card'));
      await go(page, dev);
      await page.waitForFunction(() => window.solarbloom.hud.currentTool.startsWith('decor:'));
      const d0 = await page.evaluate(() => Object.keys(window.solarbloom.sim.state.cozy?.decor ?? {}).length);
      if (dev === 'pad') await pressPad(page, 0);
      else await page.keyboard.press('Space');
      await page.waitForTimeout(400);
      const d1 = await page.evaluate(() => Object.keys(window.solarbloom.sim.state.cozy?.decor ?? {}).length);
      check(d1 === d0 + 1, B('a decoration is placed'));
      check(!errors.length, B(`no page errors ${errors.join(' | ')}`));
    }
    await page.close();
  }

  // ───── 150% and high contrast: the backpack still fits and passes axe ─────
  {
    const { page, errors } = await open('keys', { uiScale: 150, highContrast: true });
    await page.keyboard.press('Tab');
    await page.waitForSelector('#bpScreen.open');
    for (const tab of ['Items', 'Requests', 'Journal', 'Collection', 'Blueprints']) {
      await page.waitForFunction((t) => document.querySelector('#bpScreen [role=tab][aria-selected=true]')?.textContent === t, tab);
      const fits = await page.evaluate(() => {
        const r = document.querySelector('#bpScreen .bp-card').getBoundingClientRect();
        return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
      });
      check(fits, `E22.6 150% high contrast: ${tab} stays on screen`);
      await axe(page, '#bpScreen', `E22.6 150% high contrast: ${tab}`);
      if (tab === 'Items') await page.screenshot({ path: `${dir}/ui-backpack-items-150-contrast.png` });
      await page.keyboard.press('KeyE');
    }
    check(!errors.length, `E22.6 150% high contrast: no page errors ${errors.join(' | ')}`);
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
