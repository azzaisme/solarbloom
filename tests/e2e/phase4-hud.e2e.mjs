// E22.5 (#342): the HUD laid out as the epic's table (docs/E22_CONTROLS_UI.md, "The HUD"), checked on the
// platforms the game ships for (desktop and Steam Deck): 1280 × 800 and 1920 × 1080, at 100, 125 and 150%
// interface size, under both rule sets (old-city rules previewed with ?ui=oldcity until E21 lands). Reports
// overlapping parts, parts off screen and how much of the screen the HUD covers; under old-city rules plain
// walking may show only the five parts in the table. Also opens the build menu, the backpack, the pause menu and
// Settings (each tab) and checks they stay on screen. Screenshots go to docs/review/hud-*.png. Run after
// `vite build`; STRICT=1 fails on any problem.
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
/** Everything that can be on the walking view. */
const PARTS = ['#res', '#obj', '#hotbar', '#hint', '#toasts', '#frenzyBtn', '#quick', '#prompt', '#minimap', '#buildbar', '#eventBanner', '#combo'];
/** Old-city rules: plain walking shows these and nothing else (the epic's table). */
const FIVE = new Set(['#obj', '#res', '#minimap', '#prompt', '#toasts']);
const SIZES = [
  [1280, 800],
  [1920, 1080],
];
const SCALES = [100, 125, 150];
let problems = 0;

async function visibleRects(page, sels) {
  return page.evaluate((sels) => {
    const out = [];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0 || el.classList.contains('hide')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      out.push({ sel, l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
    return out;
  }, sels);
}

function overlaps(rects, w, h) {
  const issues = [];
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (ox > 1 && oy > 1) issues.push(`${a.sel} overlaps ${b.sel} (${Math.round(ox)}×${Math.round(oy)})`);
    }
  for (const r of rects) if (r.l < -1 || r.t < -1 || r.r > w + 1 || r.b > h + 1) issues.push(`${r.sel} off screen`);
  return issues;
}

try {
  for (const rules of ['classic', 'oldcity'])
    for (const [w, h] of SIZES)
      for (const scale of SCALES) {
        const name = `${rules}-${w}x${h}-${scale}`;
        const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
        await page.goto(`http://localhost:4198/?slot=1&ui=${rules}`);
        await page.evaluate((scale) => {
          localStorage.clear();
          localStorage.setItem('solarbloom.settings', JSON.stringify({ uiScale: scale, showNumbers: !!globalThis.NUMBERS }));
        }, scale);
        await page.reload();
        await page.waitForFunction(() => !!window.solarbloom?.hud);
        await page.waitForTimeout(1200);
        // A few restored tiles, like the Phase 4 screenshot, and a toast.
        await page.evaluate(() => {
          const g = window.solarbloom;
          g.pause.clear('blur');
          const s = g.sim;
          const tiles = s.areas.tiles('park').filter((t) => s.restoration.isEligible(t)).slice(0, 19);
          for (const t of tiles) s.restoration.complete(t, 'pulse');
          g.hud.pickup('Copper', 3);
        });
        await page.waitForTimeout(1500);
        const rects = await visibleRects(page, PARTS);
        const issues = overlaps(rects, w, h);
        if (rules === 'oldcity') for (const r of rects) if (!FIVE.has(r.sel)) issues.push(`${r.sel} is on the walking view (only the five parts may be)`);
        // Look 5.2: no emoji on screen (game strings carry them; the HUD draws icons instead).
        const emoji = await page.evaluate(() => {
          const t = document.getElementById('hud').innerText;
          const titles = [...document.querySelectorAll('#hud [title], #hud [aria-label]')].map((e) => `${e.getAttribute('title') ?? ''} ${e.getAttribute('aria-label') ?? ''}`).join(' ');
          return [...`${t} ${titles}`.matchAll(/\p{Extended_Pictographic}/gu)].map((m) => m[0]).join('');
        });
        if (emoji) issues.push(`emoji on screen: ${emoji}`);
        const covered = rects.reduce((a, r) => a + Math.max(0, Math.min(r.r, w) - Math.max(r.l, 0)) * Math.max(0, Math.min(r.b, h) - Math.max(r.t, 0)), 0);
        console.log(`${name}: HUD covers ~${Math.round((100 * covered) / (w * h))}% · ${issues.length ? issues.join('; ') : 'no overlaps'}`);
        problems += issues.length;
        await page.screenshot({ path: `${dir}/hud-${name}.png` });
        // The panels open on screen: the build menu, the backpack, the menu and every Settings tab.
        for (const [label, open, sel] of [
          ['build menu', (g) => g.doAction('buildMenu'), '#buildMenu.open, #buildTray.open'],
          ['backpack', (g) => g.doAction('backpack'), '#bpScreen.open, #backpack.open'],
          ['menu', (g) => g.doAction('menu'), '#menu.open'],
          ['settings', (g) => (g.doAction('menu'), g.menuChoose('settings')), '#settings.open'],
        ]) {
          await page.evaluate(`(${open.toString()})(window.solarbloom)`);
          await page.waitForTimeout(350);
          const r = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const card = el.querySelector('.screen-card, .menu-card, .bm-card') ?? el;
            const b = card.getBoundingClientRect();
            return { l: b.left, t: b.top, r: b.right, b: b.bottom };
          }, sel);
          if (!r || r.l < -1 || r.t < -1 || r.r > w + 1 || r.b > h + 1) {
            console.log(`   ${label} problem: ${JSON.stringify(r)}`);
            problems++;
          }
          await page.screenshot({ path: `${dir}/hud-${name}-${label.replace(' ', '-')}.png` });
          await page.evaluate(() => {
            const g = window.solarbloom;
            g.closeAll();
          });
          await page.waitForTimeout(200);
        }
        await page.close();
      }
} finally {
  await browser.close();
  server.httpServer.close();
}
if (problems) console.error(`${problems} HUD problems`);
if (strict && problems) process.exit(1);
