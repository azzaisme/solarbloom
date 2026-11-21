// #633: Settings › Display › Glow at night, every step set with the pad alone (Start, the d-pad to Settings, A, RB
// to Display, the d-pad to Glow, then left and right). After each step: back to the world, a midnight shot of a
// small lit farm (the night-shots set-up), and the bloom strength the camera now uses.
// Shots go to docs/review/e24-glow/ (SHOTS_DIR to change). Run after `vite build`: GPU=1 node tests/e2e/glow-shots.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/e24-glow';
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 4256);
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
const A = 0, B = 1, RB = 5, START = 9, DOWN = 13, LEFT = 14, RIGHT = 15;
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(`${driver}\ninstallVirtualPad();`);

async function press(b) {
  await page.evaluate(async (b) => {
    const f = (k) => new Promise((r) => (function go(i) { i ? requestAnimationFrame(() => go(i - 1)) : r(); })(k));
    window.__pad.buttons[b].pressed = true;
    window.__pad.buttons[b].value = 1;
    await f(3);
    window.__pad.buttons[b].pressed = false;
    window.__pad.buttons[b].value = 0;
    await f(3);
  }, b);
}
const active = () => page.evaluate(() => document.activeElement?.id ?? '');
async function padDownTo(id) {
  for (let i = 0; i < 25 && (await active()) !== id; i++) await press(DOWN);
  return (await active()) === id;
}

try {
  await startGame(page, `http://localhost:${port}`, { settings: { uiScale: 150, gfx: 'high' } });
  await page.waitForTimeout(1500);
  // A small powered farm and night lights (placement checks and recipes bypassed: this is a look test).
      await page.evaluate(() => {
        const g = window.solarbloom;
        const s = g.sim;
        s.state.salvage.tier = 3;
        const check = s.build.check.bind(s.build);
        const pay = s.inventory.pay.bind(s.inventory);
        s.build.check = () => ({ ok: true, cost: {}, spotOk: true });
        s.inventory.pay = () => true;
        const put = (type, x, z, size = 1) => {
          for (let dz = 0; dz < size; dz++)
            for (let dx = 0; dx < size; dx++) {
              const t = s.grid.get('g', x + dx, z + dz);
              t.ground = 'restored';
              t.blocked = false;
              t.bloom = 1;
              t.pollution = 0;
              s.grid.touch(t);
            }
          return s.build.place(type, 'g', x, z) ?? {};
        };
        put('solar', 7, 43);
        put('solar', 8, 43);
        put('battery', 6, 43).charge = 4200;
        put('relay', 5, 40);
        put('relay', 12, 40);
        put('windTurbine', 10, 43);
        put('charger', 8, 41);
        put('droneHub', 13, 42, 2);
        s.build.check = check;
        s.inventory.pay = pay;
        const cz = (s.state.cozy ??= {});
        cz.decorUnlocked = [...(cz.decorUnlocked ?? []), 'lamppost', 'uplight', 'porchlight', 'tablelight', 'fairylights', 'paperlanterns', 'glasslanterns'];
        // E23.6.1 (#489): a light opens once it has been made at the crafting table
        s.state.salvage.decorMade = [...new Set([...(s.state.salvage.decorMade ?? []), ...cz.decorUnlocked, 'festoon', 'pathlight', 'lantern', 'solarstake', 'glowpod', 'solarlamppost'])].sort();
        g.cozy.checkDecorUnlocks();
        const kinds = ['lamppost', 'pathlight', 'lantern', 'solarstake', 'glowpod', 'uplight', 'tablelight', 'porchlight'];
        let n = 0;
        for (let z = 36; z <= 47 && n < 24; z++)
          for (let x = 0; x <= 15 && n < 24; x++) {
            const t = s.grid.get('g', x, z);
            if (!t || t.occupantId || t.feature === 'water' || (x + z) % 3) continue;
            const was = { g: t.ground, b: t.blocked };
            t.ground = 'restored';
            t.bloom = 1;
            t.pollution = 0;
            t.blocked = false;
            const k = kinds[n % kinds.length];
            if (g.cozy.canDecorate(k, 'g', x, z)) {
              Object.assign(t, { ground: was.g, blocked: was.b });
              continue;
            }
            s.grid.touch(t);
            g.cozy.placeDecor(k, n % 4, 'g', x, z);
            g.chunks.markTile(t);
            n++;
          }
        const relays = s.state.machines.filter((m) => m.type === 'relay');
        s.lights.hang('festoon', 'g', relays[0].x, relays[0].z);
        for (const l of s.lights.all()) if (l.def.power === 'solar') s.lights.nodeOf(l.key).charge = 300;
      });
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (0.83 - s.clock.dayFraction()) * 2880;
    s.lights.dark = s.power.sky().dark;
    const g = window.solarbloom;
    g.bot.teleport('g', 4, 39);
    g.bot.following = true;
    g.camera.turnTo(200);
    for (let i = 0; i < 300; i++) g.camera.update(0.05);
  });
  await page.waitForTimeout(4000);

  // the pad to Settings › Display › Glow
  await press(START);
  await page.waitForSelector('#menu.open');
  check(await padDownTo('menu-settings'), 'the d-pad reaches Settings in the menu');
  await press(A);
  await page.waitForSelector('#settings.open');
  for (let i = 0; i < 5 && (await page.evaluate(() => document.querySelector('#settings [aria-selected=true]')?.dataset.tab)) !== 'display'; i++) await press(RB);
  check(await padDownTo('set-glow'), 'the d-pad reaches Glow on the Display tab');
  const row = await page.evaluate(() => document.getElementById('set-glow')?.closest('.set-row')?.innerText.replace(/\n/g, ' / '));
  console.log(`  the row: ${row}`);
  await page.screenshot({ path: `${dir}/settings-glow.png` });
  // to Off, then up through every step
  for (let i = 0; i < 4; i++) await press(LEFT);
  const steps = [];
  for (let i = 0; i < 4; i++) {
    if (i) {
      await page.evaluate(() => document.getElementById('set-glow')?.focus({ focusVisible: true }));
      await press(RIGHT);
    }
    const label = await page.evaluate(() => document.querySelector('#set-glow .st-val')?.textContent);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('solarbloom.settings') || '{}').glow);
    await press(B); // Settings
    await press(B); // the menu
    await page.waitForTimeout(2500);
    const bloom = await page.evaluate(() => window.solarbloom.look.post.bloomNow);
    steps.push({ label, saved, bloom });
    console.log(`  ${label}: saved ${saved}, bloom ${bloom.toFixed(3)}`);
    await page.screenshot({ path: `${dir}/night-glow-${i}-${String(label).toLowerCase()}.png` });
    await press(START);
    await page.waitForSelector('#menu.open');
    await padDownTo('menu-settings');
    await press(A);
    await page.waitForSelector('#settings.open');
    for (let k = 0; k < 5 && (await page.evaluate(() => document.querySelector('#settings [aria-selected=true]')?.dataset.tab)) !== 'display'; k++) await press(RB);
    await padDownTo('set-glow');
  }
  check(steps.map((s) => s.label).join(',') === 'Off,Soft,Normal,Strong', `the steps run Off, Soft, Normal, Strong (${steps.map((s) => s.label).join(', ')})`);
  check(steps.map((s) => s.saved).join(',') === '0,0.5,1,1.6', `each is saved (${steps.map((s) => s.saved).join(', ')})`);
  check(steps[0].bloom === 0 && steps[1].bloom > 0 && steps[2].bloom > steps[1].bloom && steps[3].bloom > steps[2].bloom, 'the glow is off, then grows with each step, live');
  check(Math.abs(steps[2].bloom / steps[1].bloom - 2) < 0.01, 'Soft is half of Normal');
  // Low graphics turns the glow off: the row says so, and how to turn it back on
  await page.evaluate(() => window.solarbloom.settingsUi.close());
  await page.evaluate(() => window.solarbloom.changeSetting?.('gfx', 'low'));
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.settingsUi.open('display');
  });
  await page.waitForTimeout(400);
  const lowHint = await page.evaluate(() => document.getElementById('set-glow-h')?.textContent ?? '');
  check(/Graphics is set to Low, so lights don't shine/.test(lowHint), `on Low graphics the row says "${lowHint}"`);
  await page.screenshot({ path: `${dir}/settings-glow-low.png` });
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
