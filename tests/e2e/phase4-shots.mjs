// Phase 4 E09/E10: the park at the same camera angle: fresh, halfway, fully grown (with Radiant tiles), and
// during a Bloom Frenzy; plus a phone shot. Screenshots go to docs/review/phase4-*.png. Fails on page errors.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4199, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  for (const [name, w, h, dpr] of [['desktop', 1100, 760, 1], ['phone', 390, 844, 2]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
    await page.goto('http://localhost:4199/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.solarbloom);
    if (await page.locator('#introGo').isVisible()) await page.click('#introGo');
    await page.addStyleTag({ content: '#toasts, #hint { display: none !important; }' });
    const shot = async (label, fn) => {
      await page.evaluate(fn);
      await page.evaluate(() => {
        const g = window.solarbloom;
        g.camera.glide(8, 0, 8, innerWidth < 600 ? 0.75 : 0.95);
        for (let i = 0; i < 200; i++) g.camera.update(0.05);
      });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${out}/phase4-${name}-${label}.png` });
    };
    if (name === 'desktop') await shot('0-fresh', () => {});
    await shot('1-half', () => {
      const s = window.solarbloom.sim;
      const tiles = s.areas.tiles('park').filter((t) => s.restoration.isEligible(t)).sort((a, b) => Math.hypot(a.x - 5, a.z - 5) - Math.hypot(b.x - 5, b.z - 5));
      for (const t of tiles.slice(0, 120)) { s.restoration.complete(t, 'pulse'); t.bloom = 1 + (t.variant % 3); s.grid.touch(t); }
      s.production.markDirty();
    });
    await shot('2-grown', () => {
      const s = window.solarbloom.sim;
      for (const t of s.areas.tiles('park')) {
        if (!s.restoration.isEligible(t) && t.ground !== 'restored') continue;
        if (t.ground !== 'restored') s.restoration.complete(t, 'pulse');
        t.bloom = t.variant % 4 === 0 ? 4 : 3;
        s.grid.touch(t);
      }
      s.state.progression.coreActivated = true;
      s.areas.clear('park', true);
      s.production.markDirty();
    });
    if (name === 'desktop')
      await shot('3-frenzy', () => {
        const s = window.solarbloom.sim;
        s.state.frenzy = { charge: 100 };
        s.frenzy.activate();
      });
    await page.close();
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('phase 4 shots ok');
