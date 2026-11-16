// Look 5: HUD screenshots for the before/after comparison with docs/reference/target-look.png.
// `node tests/e2e/look5-shots.mjs <outDir> <prefix>` after `vite build`. Scenes: a busy desktop HUD (1280×800)
// with a combo and its breakdown, the same on a phone (390×844), the upgrades drawer with an inspect panel,
// settings, and a world event with the Lucky Cat panel.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/look5';
const prefix = process.argv[3] ?? 'after';
mkdirSync(out, { recursive: true });
const server = await preview({ root: process.cwd(), preview: { port: 4211, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errs = [];
async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('http://localhost:4211/?gfx=high');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  await page.waitForTimeout(1200);
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const D = s.state.resources.energy.constructor;
    for (const t of s.areas.tiles('park').filter((t) => s.restoration.isEligible(t)).slice(0, 26)) s.restoration.complete(t, 'pulse');
    s.state.resources.energy = new D(48);
    s.state.resources.water = new D(28);
    s.state.resources.biomass = new D(124);
  });
  await page.waitForTimeout(1500);
  return page;
}
async function busy(page) {
  await page.evaluate(() => {
    const h = window.solarbloom.hud;
    // A real chain drives these; here we call the HUD with a chain's numbers.
    h.combo(3, '+12🌿 earned');
    h.chainBreakdown?.({ restored: 3, adjacent: 3, synergy: 3, relay: 0 });
    h.feed('🌸 Bloom chain ×3');
    h.toast('🌱 25 tiles restored!<small>+20🌿 · next reward at 40</small>', 'gold', 30);
  });
  await page.waitForTimeout(500);
}
try {
  {
    const page = await open(1280, 800);
    await busy(page);
    await page.screenshot({ path: `${out}/${prefix}-desktop.png` });
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.hud.toggleUpgrades(true);
      const m = g.sim.state.machines.find((m) => m.type !== 'core');
      if (m) g.select?.(m.id);
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${prefix}-desktop-drawers.png` });
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.hud.toggleUpgrades(false);
      g.select?.(undefined);
      g.hud.openSettings(true);
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${prefix}-desktop-settings.png` });
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.hud.openSettings(false);
      g.sim.events.trigger('supernova');
      g.hud.catReward('Lucky Harvest', 'A full harvest of every resource, banked.');
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/${prefix}-desktop-event.png` });
    await page.close();
  }
  {
    const page = await open(390, 844);
    await busy(page);
    await page.screenshot({ path: `${out}/${prefix}-phone.png` });
    await page.click('#buildToggle');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${prefix}-phone-tray.png` });
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(errs.length ? `page errors: ${errs.join('; ')}` : 'look5 shots: no page errors');
