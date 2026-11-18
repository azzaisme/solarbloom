// City 14.5: no HUD overlap on phone and desktop at near, mid and far zoom, with the busiest HUD we can make
// (objective with a suggestion, an open area panel, a hint, toasts and a chain counter). Screenshots go to
// docs/review/hud-*.png.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4197, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let fails = 0;
const PANELS = ['#res', '#obj', '#hotbar', '#hint', '#inspect', '#toasts', '#catPanel', '#combo', '#chips', '#quick'];
try {
  for (const [name, w, h] of [['phone', 390, 844], ['desktop', 1280, 800]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto('http://localhost:4197/?slot=1');
    // E20.7 (#290): calm is the default; NUMBERS=1 runs the same checks with "Show numbers" on.
    await page.evaluate((numbers) => {
      localStorage.clear();
      if (numbers) localStorage.setItem('solarbloom.settings', JSON.stringify({ showNumbers: true }));
    }, !!process.env.NUMBERS);
    await page.reload();
    await page.waitForFunction(() => !!window.solarbloom);
    if (await page.locator('#introGo').isVisible()) await page.click('#introGo');
    await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      s.state.progression.coreActivated = true;
      s.areas.clear('park', true);
      for (let i = 0; i < 6; i++) s.areas.clear(s.areas.nextGoal(), true);
      // Busy HUD: an area panel, a toast, a hint.
      g.hud.toast('✨ A busy moment<small>Checking nothing overlaps.</small>', 'gold', 30);
      const lm = s.areas.landmark(s.areas.nextGoal());
      g.select?.(lm.id);
    });
    for (const [zname, zoom] of [['near', 1.6], ['mid', 0.8], ['far', 0.24]]) {
      await page.evaluate((zoom) => {
        const g = window.solarbloom;
        g.camera.glide(8, 0, 8, zoom);
        for (let i = 0; i < 300; i++) g.camera.update(0.05);
      }, zoom);
      await page.waitForTimeout(2000);
      // Look 5.5: a big chain's combo panel with its breakdown is on screen while we measure.
      await page.evaluate(() => {
        const h = window.solarbloom.hud;
        h.combo(24, '+40🌿 earned');
        h.chainBreakdown({ restored: 8, adjacent: 9, synergy: 5, relay: 2 });
      });
      await page.waitForTimeout(500);
      const rects = await page.evaluate((PANELS) => {
        const out = [];
        for (const sel of PANELS) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const cs = getComputedStyle(el);
          if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0 || el.classList.contains('hide')) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          // #toasts is a full-width column: measure its children instead.
          if (sel === '#toasts') {
            for (const c of el.children) {
              const cr = c.getBoundingClientRect();
              if (cr.width > 2) out.push({ sel: '#toasts>*', l: cr.left, t: cr.top, r: cr.right, b: cr.bottom });
            }
            continue;
          }
          out.push({ sel, l: r.left, t: r.top, r: r.right, b: r.bottom });
        }
        return out;
      }, PANELS);
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
          const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
          if (ox > 2 && oy > 2) {
            fails++;
            console.error(`  ✗ ${name} ${zname}: ${a.sel} overlaps ${b.sel} (${Math.round(ox)}×${Math.round(oy)} px)`);
          }
        }
      for (const a of rects) if (a.l < -1 || a.t < -1 || a.r > w + 1 || a.b > h + 1) {
        fails++;
        console.error(`  ✗ ${name} ${zname}: ${a.sel} runs off screen`);
      }
      await page.screenshot({ path: `${dir}/hud-${name}-${zname}.png` });
    }
    // The action button is always visible on the phone.
    const act = await page.evaluate(() => {
      const b = document.querySelector('#objAct button');
      if (!b) return 'none';
      const r = b.getBoundingClientRect();
      return r.width > 10 && r.bottom <= innerHeight && r.top >= 0 ? 'ok' : 'hidden';
    });
    if (act !== 'ok') {
      fails++;
      console.error(`  ✗ ${name}: the objective's action button is ${act}`);
    }
    await page.close();
  }
  if (!fails) console.log('  ✓ no HUD overlap on phone or desktop at near, mid or far zoom');
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(fails ? 1 : 0);
