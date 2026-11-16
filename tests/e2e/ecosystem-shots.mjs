// Phase 5 E16: screenshots of the four tile stages (the whole park at one stage each, plus all four side by side)
// and of the fauna, at gameplay zoom. Fails on page or console errors. Run after `vite build`:
//   node tests/e2e/ecosystem-shots.mjs [dir] [prefix]
// Headless Chromium with SwiftShader (software rendering): judge the look, not the frame rate.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review';
const prefix = process.argv[3] ?? 'e16';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4198, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const GAME_ZOOM = 0.95;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`page: ${e}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto('http://localhost:4198/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  await page.waitForTimeout(1000);
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
  const frame = async (x, z, zoom, wait = 2500) => {
    await page.evaluate(
      ([x, z, zoom]) => {
        const g = window.solarbloom;
        g.camera.glide(x, 0, z, zoom);
        for (let i = 0; i < 200; i++) g.camera.update(0.05);
      },
      [x, z, zoom],
    );
    await page.waitForTimeout(wait);
  };
  // Pause the sim so drones and growth don't change the stages under the camera.
  await page.evaluate(() => window.solarbloom.setPaused?.(true));
  const setStages = (mode) =>
    page.evaluate((mode) => {
      const g = window.solarbloom;
      const s = g.sim;
      for (const t of s.areas.tiles('park')) {
        if (t.blocked || t.occupantId) continue;
        if (t.ground !== 'restored') s.restoration.complete(t, 'pulse');
        t.ground = 'restored';
        t.growthRemainingSec = 0;
        t.pollution = 0;
        // 'mixed': four quadrants around the fountain, Restored (NW) · Blooming (NE) · Thriving (SW) · Radiant (SE)
        t.bloom = mode === 'mixed' ? 1 + (t.x >= 8 ? 1 : 0) + (t.z >= 8 ? 2 : 0) : mode;
        s.grid.touch(t);
      }
      g.chunks.markAll();
    }, mode);
  for (const stage of [1, 2, 3, 4]) {
    await setStages(stage);
    await frame(8, 8, GAME_ZOOM);
    await page.screenshot({ path: `${dir}/${prefix}-stage-${stage}.png` });
  }
  await setStages('mixed');
  await frame(8, 8, GAME_ZOOM);
  await page.screenshot({ path: `${dir}/${prefix}-stages-mixed.png` });
  await frame(8, 8, 0.45);
  await page.screenshot({ path: `${dir}/${prefix}-stages-far.png` });

  // Fauna: a lush park with machines, the fountain flowing, a finished superstructure, every kind unlocked.
  const info = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const st = s.state;
    for (const t of s.areas.tiles('park')) {
      if (t.blocked || t.occupantId) continue;
      t.bloom = (t.x + t.z) % 3 === 0 ? 4 : 3;
      s.grid.touch(t);
    }
    const D = st.resources.biomass.constructor; // break_infinity Decimal
    st.caps.energy = new D(1e9);
    st.caps.water = new D(1e9);
    for (const k of ['energy', 'water', 'biomass']) st.resources[k] = new D(1e9);
    const placed = [];
    for (const [type, x, z] of [['solar', 4, 3], ['condenser', 5, 3], ['solar', 3, 4], ['pollinator', 10, 11], ['condenser', 11, 12], ['solar', 13, 11], ['pollinator', 3, 13], ['solar', 12, 13], ['condenser', 13, 6], ['solar', 2, 2], ['condenser', 9, 13], ['solar', 6, 13], ['pollinator', 13, 9], ['solar', 10, 4], ['condenser', 14, 3]]) {
      const m = s.build.place(type, 'g', x, z);
      if (m) placed.push(m.id);
    }
    st.progression.coreActivated = true;
    g.machines.setCoreState('awake', true);
    st.cores = [...(st.cores ?? []), { type: 'pollinator' }];
    const spot = s.areas.tiles('park').find((t) => t.x <= 6 && s.supers.check('pollinator', 'g', t.x, t.z).ok);
    const sup = spot ? s.supers.place('pollinator', 'g', spot.x, spot.z) : undefined;
    if (sup) {
      s.supers.advance(sup.id);
      s.supers.advance(sup.id);
    }
    s.ecosystem.refresh(true);
    st.fauna = { butterflies: st.time, birds: st.time, koi: st.time, robots: st.time };
    g.chunks.markAll();
    return { placed: placed.length, super: !!sup, unlocked: s.ecosystem.unlocked() };
  });
  console.log('fauna scene:', JSON.stringify(info));
  await page.evaluate(() => window.solarbloom.setPaused?.(false));
  await frame(7, 8, GAME_ZOOM, 1000);
  // Fauna re-plan once a second of frames (slow under software rendering): wait for them.
  await page.waitForFunction(() => { const a = window.solarbloom.fauna.active; return a.koi > 0 && a.robots > 0 && a.cats > 0; }, null, { timeout: 60000 }).catch(() => console.log('fauna slow to appear'));
  await page.waitForTimeout(1500);
  const counts = await page.evaluate(() => ({ ...window.solarbloom.fauna.active, butterflies: window.solarbloom.butterflies.count }));
  console.log('fauna in view:', JSON.stringify(counts));
  await page.screenshot({ path: `${dir}/${prefix}-fauna.png` });
  // Close-ups of a garden robot, a sleeping cat and a songbird, wherever they are right now.
  for (const kind of ['robots', 'cats', 'groundBirds']) {
    const at = await page.evaluate((kind) => {
      const a = window.solarbloom.fauna.pools[kind].find((x) => x.used);
      if (!a) return undefined;
      const p = a.root.getPosition();
      return [p.x, p.z];
    }, kind);
    if (!at) {
      console.log(`no ${kind} in view for a close-up`);
      continue;
    }
    await page.evaluate(() => (window.solarbloom.camera.maxZoom = 4));
    await frame(at[0], at[1], 2.4, 2000);
    await page.screenshot({ path: `${dir}/${prefix}-near-${kind}.png` });
  }
  await frame(8, 8, 1.6, 2500);
  await page.screenshot({ path: `${dir}/${prefix}-fountain-koi.png` });
  // Fireflies (an option in Settings).
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.setSetting?.('fireflies', true);
  });
  await frame(7, 8, GAME_ZOOM, 3000);
  await page.screenshot({ path: `${dir}/${prefix}-fireflies.png` });
  console.log('fireflies:', await page.evaluate(() => window.solarbloom.fauna.active.fireflies));
} finally {
  await browser.close();
  await server.close();
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page or console errors');
process.exit(errors.length ? 1 : 0);
