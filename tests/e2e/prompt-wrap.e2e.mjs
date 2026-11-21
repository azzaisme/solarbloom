// #590: the Interact prompt when it is refused with a long reason. In a new game (fountain step 0) bloombot faces
// two things that refuse: a barricade that needs Pry ("Hold Pry"), and a sealed region's clouds ("Look at the
// clouds", with the region's longer reason, the prompt the issue was seen on). At 100, 125 and 150% interface size,
// at 1280 × 720 and at the Deck's 1280 × 800 (?gfx=deck), it checks the words stay on one line, the reason wraps
// under them, and the prompt stays on screen and clear of the other walking parts. Shots go to
// docs/review/e23-polish/ (SHOTS_DIR overrides).
//   npm run build && node tests/e2e/prompt-wrap.e2e.mjs      (GPU=1: the real GPU, d3d11; otherwise SwiftShader)
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.env.SHOTS_DIR ?? 'docs/review/e23-polish';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4257);
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

/** Stands bloombot beside a barricade that needs Pry, facing it, or facing a sealed region's clouds. */
function standAt(scene) {
  const g = window.solarbloom;
  g.pause.clear('blur');
  const s = g.sim;
  const w = g.bot.walker;
  if (scene === 'clouds') {
    // a new game has nothing sealed yet: the park cleared (as cat-proof does) reveals the regions beside it, each
    // sealed behind its gate
    if (!s.areas.sealedAreas().length) s.areas.clear('park', true);
    // every walkable cell and heading whose Interact target is the clouds: the one with the longest reason
    let best;
    const seen = { sealed: s.areas.sealedAreas().length, walkable: 0, sealedAhead: 0, targets: {} };
    for (let x = -60; x <= 70; x++)
      for (let z = -60; z <= 70; z++) {
        if (!w.walkable('g', x, z)) continue;
        seen.walkable++;
        for (const f of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          g.bot.teleport('g', x + 0.5, z + 0.5);
          g.bot.pose.facing = f;
          if (!g.sealedAhead()) continue;
          seen.sealedAhead++;
          const t = g.interactTarget();
          const id = t?.id?.split(':')[0] ?? 'none';
          seen.targets[id] = (seen.targets[id] ?? 0) + 1;
          if (t?.id?.startsWith('seal:') && (!best || t.refused.length > best.why.length)) best = { x, z, f, why: t.refused };
        }
      }
    if (!best) return { none: JSON.stringify(seen) };
    g.bot.teleport('g', best.x + 0.5, best.z + 0.5);
    g.bot.pose.facing = best.f;
    return best;
  }
  for (let r = 2; r < 40; r++)
    for (let x = 8 - r; x <= 8 + r; x++)
      for (let z = 8 - r; z <= 8 + r; z++) {
        if (Math.max(Math.abs(x - 8), Math.abs(z - 8)) !== r) continue;
        const gate = s.gates.gateAt(x, z);
        if (!gate || !s.gates.problem(gate)) continue;
        for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          if (!w.walkable('g', x + dx, z + dz) || s.gates.gateAt(x + dx, z + dz)) continue;
          g.bot.teleport('g', x + dx + 0.5, z + dz + 0.5);
          g.bot.pose.facing = Math.atan2(-dx, -dz);
          return { x, z, why: s.gates.problem(gate) };
        }
      }
  return { none: 'no barricade that refuses within 40 cells of the fountain' };
}

/** The refused prompt's boxes: its words, its reason, and whether it is on screen and clear of the HUD. */
function measure() {
  const r = (e) => e && e.getBoundingClientRect();
  const text = document.querySelector('#prompt .pr-refused .pr-text');
  const why = document.querySelector('#prompt .pr-refused .pr-why');
  const main = document.querySelector('#prompt .pr-main');
  if (!text || !why || !main) return undefined;
  // the boxes are zoomed with the HUD; the computed line heights aren't
  const zoom = +window.solarbloom.hud.root.style.zoom || 1;
  const lh = (e) => (parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.2) * zoom;
  const t = r(text), y = r(why), p = r(main);
  // the walking parts the prompt must stay clear of
  const hit = ['#obj', '#res', '#minimap', '#dock', '#toasts > *']
    .flatMap((sel) => [...document.querySelectorAll(sel)])
    .filter((e) => e.offsetParent !== null && !e.closest('#prompt'))
    .map((e) => ({ id: e.id || e.className, b: r(e) }))
    .filter(({ b }) => b.width > 0 && b.height > 0 && b.left < p.right && b.right > p.left && b.top < p.bottom && b.bottom > p.top)
    .map((o) => o.id);
  return {
    words: text.textContent,
    lines: +(t.height / lh(text)).toFixed(2),
    under: y.top >= t.bottom - 1,
    whyLines: Math.round(y.height / lh(why)),
    inside: p.left >= 0 && p.right <= innerWidth && p.top >= 0 && p.bottom <= innerHeight,
    hit,
  };
}

try {
  for (const [w, h, query, label] of [
    [1280, 720, '', '1280x720'],
    [1280, 800, '&gfx=deck', 'deck'],
  ]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${port}/?slot=1&new=1${query}`);
    await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
    for (const scene of ['pry', 'clouds']) {
      const at = await page.evaluate(standAt, scene);
      check(!at.none, `${label} ${scene}: bloombot faces something that refuses (${at.none ?? `${at.x},${at.z}: ${at.why}`})`);
      if (at.none) continue;
      for (const pct of [100, 125, 150]) {
        await page.evaluate((pct) => window.solarbloom.hud.setUiScale(pct), pct);
        await page.waitForFunction(() => !!document.querySelector('#prompt .pr-refused .pr-why'), null, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(600);
        const m = await page.evaluate(measure);
        const where = `${label} ${scene} ${pct}%`;
        check(!!m, `${where}: the refused prompt shows its words and its reason`);
        if (!m) continue;
        check(m.lines < 1.5, `${where}: "${m.words}" stays on one line (${m.lines} lines high)`);
        check(m.under, `${where}: the reason sits under the words (${m.whyLines} line${m.whyLines === 1 ? '' : 's'})`);
        check(m.inside, `${where}: the prompt is on screen`);
        check(!m.hit.length, `${where}: the prompt overlaps none of the walking parts${m.hit.length ? ` (${m.hit.join(', ')})` : ''}`);
        await page.screenshot({ path: `${out}/590-prompt-${scene}-${label}-${pct}.png` });
      }
    }
    check(!errors.length, `${label}: no page errors ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]).catch(() => {});
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);
