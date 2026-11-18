// Phase 5 E12: phone HUD with a big balance (1.234e15), the resource breakdown and the Upgrades drawer.
// Screenshots to the folder given (default docs/review). Run after `vite build`.
import { createRequire } from 'node:module';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review';
const server = await preview({ root: process.cwd(), preview: { port: 4199, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const [name, w, h] of [['320', 320, 640], ['390', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto('http://localhost:4199/?slot=1');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.solarbloom);
    await page.waitForTimeout(1500);
    if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
    await page.evaluate(() => {
      const s = window.solarbloom.sim;
      const D = s.state.resources.energy.constructor;
      for (const t of s.areas.tiles('park').filter((t) => s.restoration.isEligible(t)).slice(0, 19)) s.restoration.complete(t, 'pulse');
      s.state.resources.biomass = new D('1.234e15');
      s.state.resources.energy = new D(s.state.caps.energy);
    });
    await page.waitForTimeout(25000); // let the ledger warm up (20 s window)
    const rects = await page.evaluate(() => ['#res', '#obj', '#hotbar', '#hint', '#chips', '#toasts'].map((sel) => { const e = document.querySelector(sel); if (!e) return `${sel}: none`; const r = e.getBoundingClientRect(); const vis = getComputedStyle(e).display !== 'none' && r.width > 0; return `${sel} ${Math.round(r.width)}×${Math.round(r.height)}${vis ? '' : ' (hidden)'}`; }).join('  '));
    console.log(name, rects);
    console.log(name, 'res text:', await page.evaluate(() => [...document.querySelectorAll('[data-res]')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));
    await page.screenshot({ path: `${out}/p5-hud-${name}.png` });
    await page.click('[data-res="biomass"]');
    await page.waitForTimeout(300);
    console.log(name, 'popover:', await page.evaluate(() => document.querySelector('#resInfo').textContent.replace(/\s+/g, ' ')));
    await page.screenshot({ path: `${out}/p5-hud-${name}-breakdown.png` });
    await page.click('#upgBtn'); // also closes the breakdown (a tap outside the resource strip)
    await page.waitForTimeout(1200);
    console.log(name, 'breakdown closed:', await page.evaluate(() => document.querySelector('#resInfo').hidden));
    await page.screenshot({ path: `${out}/p5-hud-${name}-upgrades.png` });
    console.log(name, 'errors:', errs.length ? errs.join('; ') : 'none');
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
