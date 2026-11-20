// E23.11 (Sunlit Glass): screenshots of the panel shell for review against the design boards in docs/art.
// `node tests/e2e/e23-panels-shots.mjs [outDir] [scene]` after `vite build`. Scenes, under old-city rules: the
// backpack, the crafting table, machine cards docked right (a planter, the compost bin, the fountain, a machine's
// details), pause, and Settings > Controls. Two sizes: desktop (1600 × 900) and the Steam Deck (1280 × 800,
// ?gfx=deck). Runs in headless Chromium (SwiftShader), so it works while the app's Browser pane is hidden.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/e23-ui';
const only = process.argv[3]; // optional: one scene name
const PORT = 4223;
mkdirSync(out, { recursive: true });
const server = await preview({ root: process.cwd(), preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errs = [];
const wait = (page, ms) => page.waitForTimeout(ms);

async function open(w, h, query) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errs.push(String(e)));
  page.setDefaultTimeout(240000);
  await page.goto(`http://localhost:${PORT}/${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 240000 });
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));
  await wait(page, 1500);
  // some materials, so the backpack and the table have things in them
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    for (const [k, v] of Object.entries({ scrap: 24, copper: 12, planks: 8, glass: 5, wire: 3, biomass: 30, fertiliser: 2 })) s.inventory.add(k, v);
  });
  return page;
}

/** Restores open ground round bloombot and places a machine on it; returns its id (or undefined). */
async function placeNear(page, type) {
  return page.evaluate((type) => {
    const g = window.solarbloom;
    const s = g.sim;
    const bx = Math.floor(g.bot.pose.x);
    const bz = Math.floor(g.bot.pose.z);
    const level = s.grid.get('g', bx, bz)?.level ?? 0;
    for (let r = 2; r <= 6; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          const t = s.grid.get('g', bx + dx, bz + dz);
          if (!t || t.blocked || t.occupantId || t.feature === 'water' || (t.level ?? 0) !== level || s.salvage.pileAt(bx + dx, bz + dz)) continue;
          if (t.state !== 'restored') {
            s.restoration.complete(t, 'pulse');
            s.grid.touch(t);
          }
          const m = s.build.place(type, 'g', bx + dx, bz + dz);
          if (m) return m.id;
        }
    return undefined;
  }, type);
}

const SCENES = {
  async backpack(page, name) {
    await page.evaluate(() => window.solarbloom.hud.toggleBackpack(true));
    await wait(page, 700);
    await page.screenshot({ path: `${out}/${name}-backpack.png` });
  },
  async craft(page, name) {
    await page.evaluate(() => window.solarbloom.hud.craft.open());
    await wait(page, 700);
    await page.screenshot({ path: `${out}/${name}-craft.png` });
  },
  async planter(page, name) {
    const id = await placeNear(page, 'planter');
    if (!id) return console.log('   (no room for a planter)');
    await page.evaluate((id) => window.solarbloom.oc.planter(window.solarbloom.sim.machine(id)), id);
    await wait(page, 800);
    await page.screenshot({ path: `${out}/${name}-planter.png` });
  },
  async compost(page, name) {
    const id = await placeNear(page, 'compostBin');
    if (!id) return console.log('   (no room for a compost bin)');
    await page.evaluate((id) => {
      const g = window.solarbloom;
      const m = g.sim.machine(id);
      g.oc.compostBin(m);
    }, id);
    await wait(page, 800);
    await page.screenshot({ path: `${out}/${name}-compost.png` });
  },
  async fountain(page, name) {
    await page.evaluate(() => window.solarbloom.oc.openFountain());
    await wait(page, 800);
    await page.screenshot({ path: `${out}/${name}-fountain.png` });
  },
  async inspect(page, name) {
    const id = await placeNear(page, 'solar');
    if (!id) return console.log('   (no room for a solar panel)');
    await page.evaluate((id) => {
      window.solarbloom.select(id);
    }, id);
    await wait(page, 800);
    await page.screenshot({ path: `${out}/${name}-inspect.png` });
  },
  async pause(page, name) {
    await page.keyboard.press('Escape');
    await wait(page, 700);
    await page.screenshot({ path: `${out}/${name}-pause.png` });
    await page.click('#menu-settings');
    await wait(page, 600);
    const tab = page.locator('#settings [role=tab]', { hasText: 'Controls' });
    if (await tab.count()) await tab.first().click();
    await wait(page, 600);
    await page.screenshot({ path: `${out}/${name}-settings-controls.png` });
    // listening for a new key
    const cell = page.locator('#ctl-interact-key');
    if (await cell.count()) {
      await cell.click();
      await wait(page, 400);
      await page.screenshot({ path: `${out}/${name}-settings-listening.png` });
    }
  },
};

const SIZES = [
  { name: 'desktop', w: 1600, h: 900, q: '?slot=1&gfx=high&ui=oldcity' },
  { name: 'deck', w: 1280, h: 800, q: '?slot=1&gfx=deck&ui=oldcity' },
];
try {
  for (const s of SIZES)
    for (const [scene, run] of Object.entries(SCENES)) {
      if (only && only !== scene) continue;
      const page = await open(s.w, s.h, s.q);
      try {
        await run(page, s.name);
        console.log(`✓ ${s.name} ${scene}`);
      } catch (e) {
        console.log(`✗ ${s.name} ${scene}: ${String(e).split('\n')[0]}`);
      }
      await page.close();
    }
} finally {
  await browser.close();
  server.httpServer.close();
}
if (errs.length) console.log('page errors:\n' + [...new Set(errs)].join('\n'));
