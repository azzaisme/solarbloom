// Phase 4 E00/E02: the fresh-park HUD at phone widths (320, 360, 390, 430 CSS px), a phone in landscape,
// a tablet and a desktop. Reports overlapping panels, panels off screen and how much of the screen the HUD
// covers; screenshots go to docs/review/phase4-hud-*.png. Run after `vite build`.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
const strict = !!process.env.STRICT;
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4198, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const PANELS = ['#res', '#obj', '#hotbar', '#hint', '#chips', '#toasts'];
const SIZES = [
  ['320', 320, 640],
  ['360', 360, 740],
  ['390', 390, 844],
  ['430', 430, 932],
  ['phone-landscape', 844, 390],
  ['tablet', 820, 1180],
  ['desktop', 1280, 800],
];
let problems = 0;
try {
  for (const [name, w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.goto('http://localhost:4198/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.solarbloom);
    await page.waitForTimeout(1200);
    const intro = (await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible());
    if (intro) await page.click('#introGo');
    await page.waitForTimeout(800);
    // A few restored tiles, like the Phase 4 screenshot.
    await page.evaluate(() => {
      const s = window.solarbloom.sim;
      const tiles = s.areas.tiles('park').filter((t) => s.restoration.isEligible(t)).slice(0, 19);
      for (const t of tiles) s.restoration.complete(t, 'pulse');
      s.state.resources.energy = s.state.caps.energy;
      s.state.resources.water = s.state.caps.water;
      s.state.resources.biomass = 24;
    });
    await page.waitForTimeout(1500);
    const rects = await page.evaluate((PANELS) => {
      const out = [];
      for (const sel of PANELS) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const cs = getComputedStyle(el);
        if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0 || el.classList.contains('hide')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        out.push({ sel, l: r.left, t: r.top, r: r.right, b: r.bottom });
      }
      return out;
    }, PANELS);
    const issues = [];
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (ox > 1 && oy > 1) issues.push(`${a.sel} overlaps ${b.sel} (${Math.round(ox)}×${Math.round(oy)})`);
      }
    for (const r of rects) if (r.l < -1 || r.t < -1 || r.r > w + 1 || r.b > h + 1) issues.push(`${r.sel} off screen`);
    const covered = rects.reduce((a, r) => a + Math.max(0, Math.min(r.r, w) - Math.max(r.l, 0)) * Math.max(0, Math.min(r.b, h) - Math.max(r.t, 0)), 0);
    console.log(`${name} ${w}×${h}: HUD covers ~${Math.round((100 * covered) / (w * h))}% · ${issues.length ? issues.join('; ') : 'no overlaps'}`);
    console.log(`   ${rects.map((r) => `${r.sel} ${Math.round(r.r - r.l)}×${Math.round(r.b - r.t)}@${Math.round(r.l)},${Math.round(r.t)}`).join('  ')}`);
    problems += issues.length;
    await page.screenshot({ path: `${dir}/phase4-hud-${name}.png` });
    // The Build tray opens above the hotbar and stays on screen.
    await page.click('#buildToggle');
    await page.waitForTimeout(400);
    const tray = await page.evaluate(() => {
      const r = document.querySelector('#buildTray').getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, open: document.querySelector('#buildTray').classList.contains('open') };
    });
    if (!tray.open || tray.l < -1 || tray.t < -1 || tray.r > w + 1 || tray.b > h + 1) {
      console.log(`   build tray problem: ${JSON.stringify(tray)}`);
      problems++;
    }
    await page.screenshot({ path: `${dir}/phase4-hud-${name}-tray.png` });
    await page.close();
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
if (strict && problems) {
  console.error(`${problems} HUD problems`);
  process.exit(1);
}
