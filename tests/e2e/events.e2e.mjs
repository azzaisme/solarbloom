// Phase 5 E15: world events and Lucky Cat variants in the real page (production build). At a phone and a desktop
// size: start each event, check the banner shows its effect and timer without covering the HUD panels, hide a
// Golden and a Rainbow cat, tap every hiding cat on screen (each pays once), check the 🐾 chip appears after the
// hint delay, and that there are no page or console errors. Screenshots: docs/review/p5-events-*.png.
// Run after `vite build`.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4203, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const SIZES = [
  ['390', 390, 844],
  ['desktop', 1280, 800],
];
const PANELS = ['#res', '#obj', '#hotbar', '#frenzyBtn', '#hint'];
let problems = 0;
const fail = (m) => {
  problems++;
  console.log(`  ✗ ${m}`);
};
try {
  for (const [name, w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('http://localhost:4203/?cursor=1');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.solarbloom);
    await page.waitForTimeout(1000);
    if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
    // A park with some green, rich stores and a Drone Hub (automation unlocked).
    await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      const tiles = s.areas.tiles('park').filter((t) => s.restoration.isEligible(t)).slice(0, 60);
      for (const t of tiles) s.restoration.complete(t, 'pulse');
      const B = s.state.resources.energy.constructor;
      s.state.caps.energy = new B(1e5);
      s.state.caps.water = new B(1e5);
      s.state.resources.energy = new B(5e4);
      s.state.resources.water = new B(5e4);
      s.state.resources.biomass = new B(1e6);
      s.state.cat.firstSpawned = true;
      s.state.cat.found = 1;
    });
    for (const type of ['supernova', 'migration', 'rain', 'invasion']) {
      const ok = await page.evaluate((type) => window.solarbloom.sim.events.trigger(type), type);
      if (!ok) fail(`${name}: ${type} did not start`);
      await page.waitForTimeout(1200);
      const banner = await page.evaluate((PANELS) => {
        const el = document.querySelector('#eventBanner');
        const r = el.getBoundingClientRect();
        const overlaps = [];
        for (const sel of PANELS) {
          const p = document.querySelector(sel);
          if (!p || p.hidden || getComputedStyle(p).display === 'none') continue;
          const q = p.getBoundingClientRect();
          const ox = Math.min(r.right, q.right) - Math.max(r.left, q.left);
          const oy = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
          if (ox > 1 && oy > 1) overlaps.push(sel);
        }
        return { hidden: el.hidden, text: el.innerText.replace(/\s+/g, ' '), overlaps, pe: getComputedStyle(el).pointerEvents };
      }, PANELS);
      console.log(`${name} ${type}: "${banner.text}"`);
      if (banner.hidden || !banner.text) fail(`${name}: no banner for ${type}`);
      if (banner.overlaps.length) fail(`${name}: ${type} banner overlaps ${banner.overlaps.join(', ')}`);
      if (banner.pe !== 'none') fail(`${name}: the banner takes pointer events`);
      if (type !== 'invasion' && !/\d+s/.test(banner.text)) fail(`${name}: ${type} banner has no timer`);
      await page.screenshot({ path: `${dir}/p5-events-${name}-${type}.png` });
      // Let it finish (sim time, accelerated) before the next one.
      await page.evaluate(() => window.solarbloom.sim.advance(40));
    }
    // A Golden and a Rainbow cat near the camera, then tap every cat that is on screen.
    const tapped = await page.evaluate(async () => {
      const g = window.solarbloom;
      const s = g.sim;
      g.camera.focus(8, 0, 8, 1, 0.01);
      await new Promise((r) => setTimeout(r, 300));
      s.cat.invade(2);
      const inv = s.state.cat.invasion;
      inv[inv.length - 2].variant = 'golden';
      inv[inv.length - 1].variant = 'rainbow';
      for (const c of inv.slice(-2)) {
        g.cat.hide(c.id, false);
        g.cat.show(c, false);
      }
      return s.cat.spots().length;
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/p5-events-${name}-cats.png` });
    const before = await page.evaluate(() => window.solarbloom.sim.state.cat.found);
    let clicks = 0;
    for (let i = 0; i < 12; i++) {
      const pt = await page.evaluate(() => {
        const g = window.solarbloom;
        for (const id of g.cat.ids()) {
          const p = g.cat.targetWorld(id);
          const sp = g.camera.toScreen(p);
          if (sp.x > 50 && sp.y > 50 && sp.x < innerWidth - 50 && sp.y < innerHeight - 50) {
            const el = document.elementFromPoint(sp.x, sp.y);
            if (el && el.tagName === 'CANVAS') return { id, x: sp.x, y: sp.y };
          }
        }
        return null;
      });
      if (!pt) break;
      await page.mouse.click(pt.x, pt.y);
      clicks++;
      await page.waitForTimeout(500);
      // A second tap on the same spot never pays twice.
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(300);
      const still = await page.evaluate((id) => !!window.solarbloom.sim.cat.find(id), pt.id);
      if (still) fail(`${name}: tapping cat ${pt.id} did not claim it`);
    }
    const after = await page.evaluate(() => ({ found: window.solarbloom.sim.state.cat.found, left: window.solarbloom.sim.cat.spots().length }));
    console.log(`${name}: ${tapped} cats hiding, ${clicks} tapped on screen, found ${after.found - before}, ${after.left} left`);
    if (after.found - before !== clicks) fail(`${name}: ${clicks} taps but ${after.found - before} cats paid`);
    if (!clicks) fail(`${name}: no cat could be tapped on screen`);
    // Paw prints: after the hint delay the 🐾 chip shows for cats still hiding.
    await page.evaluate(() => {
      const s = window.solarbloom.sim;
      if (!s.cat.spots().length) s.cat.invade(1);
      s.advance(95);
    });
    await page.waitForTimeout(600);
    const paw = await page.evaluate(() => ({ hidden: document.querySelector('#pawBtn').hidden, n: document.querySelector('#pawCount').textContent }));
    if (paw.hidden) fail(`${name}: no 🐾 chip after the hint delay`);
    await page.click('#pawBtn');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${dir}/p5-events-${name}-hint.png` });
    if (errors.length) fail(`${name}: page errors: ${errors.slice(0, 3).join(' | ')}`);
    console.log(`${name}: 🐾 ${paw.n} · ${errors.length} page/console errors`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(problems ? `${problems} problem(s)` : 'events e2e: pass');
process.exit(problems ? 1 : 0);
