// Look 5: HUD screenshots for the before/after comparison with docs/reference/target-look.png.
// `node tests/e2e/look5-shots.mjs <outDir> <prefix>` after `vite build`. Scenes: a busy desktop HUD (1280×800)
// with a combo and its breakdown, the same on a phone (390×844), an inspect panel,
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
  await page.goto('http://localhost:4211/?slot=1&gfx=high');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    for (const t of s.areas.tiles('park').filter((t) => s.restoration.isEligible(t)).slice(0, 26)) s.restoration.complete(t, 'pulse');
    for (const m of ['scrap','seeds','copper','timber','glass','clay','gears','sunstone','biomass','food']) s.state.salvage.pack[m] = 12; // E23.1.4: a full backpack (no counters)
  });
  await page.waitForTimeout(1500);
  return page;
}
async function busy(page) {
  await page.evaluate(() => {
    const h = window.solarbloom.hud;
    // a toast, as a busy moment shows one (E23.11: the chain feed is gone with the classic HUD)
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
      const m = g.sim.state.machines.find((m) => m.type !== 'core');
      if (m) g.select?.(m.id);
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${prefix}-desktop-drawers.png` });
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.select?.(undefined);
      g.settingsUi.open();
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${prefix}-desktop-settings.png` });
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.settingsUi.close();
      g.hud.catReward('Lucky Harvest', 'A gift in your backpack: food, biomass and seeds');
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/${prefix}-desktop-event.png` });
    await page.close();
  }
  {
    const page = await open(390, 844);
    await busy(page);
    await page.screenshot({ path: `${out}/${prefix}-phone.png` });
    await page.evaluate(() => window.solarbloom.hud.toggleTray(true)); // E23.11: the build menu sheet
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${prefix}-phone-tray.png` });
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(errs.length ? `page errors: ${errs.join('; ')}` : 'look5 shots: no page errors');
