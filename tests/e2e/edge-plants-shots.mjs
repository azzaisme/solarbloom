// #687 (E27.4): review shots of plants at the edge of the ground, into docs/review/edge-plants/ (or argv[2]).
//   npx vite build && GPU=1 node tests/e2e/edge-plants-shots.mjs [outDir]
// Run it on the base build for the "before" set and on the branch for "after": the spots and camera are the same.
// At each spot the ground for a few tiles round is restored to full bloom (the edges at their lushest), and its area
// cleared, then Bloombot stands just back from the edge and the follow camera looks past it at the water or the
// drop (each shot also saved as a close crop of the edge, `-zoom`): a rounded tip on Saltwind's surf line, a corner of the sandbar island, the canal bank, a terrace edge and the
// Cistern's pond. 1280 × 800 on the high graphics. Checks: no page errors.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame, QUIET_CSS, WALKING_HUD } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/edge-plants';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4283, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({
  args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
/** name, the edge tile, and (for the pond) a search for the nearest land beside it */
const SPOTS = [
  ['1-surf-tip', 0, 41],
  ['2-sandbar-corner', 10, 56],
  ['3-canal-bank', -4, 24],
  ['4-terrace-edge', -23, 1],
  ['5-pond-edge', 63, 44, true],
];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await startGame(page, 'http://localhost:4283', { slot: 3, query: 'gfx=high&still' });
  await page.addStyleTag({ content: `${QUIET_CSS} ${WALKING_HUD.join(', ')}, #hud { visibility: hidden !important; }` });
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (0.42 - s.clock.dayFraction()) * 2880;
  });
  for (const [name, tx, tz, nearLand] of SPOTS) {
    const at = await page.evaluate(({ tx, tz, nearLand }) => {
      const g = window.solarbloom;
      const s = g.sim;
      const peek = (x, z) => s.grid.peek('g', x, z);
      const wet = (t) => !t || t.feature === 'water';
      let edge = peek(tx, tz);
      if (nearLand) {
        // the pond: the nearest open land tile beside its water
        let best;
        for (let dz = -6; dz <= 6; dz++)
          for (let dx = -6; dx <= 6; dx++) {
            const t = peek(tx + dx, tz + dz);
            if (!t || wet(t) || t.blocked || t.ramp) continue;
            if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => wet(peek(t.x + a, t.z + b)))) continue;
            const d = dx * dx + dz * dz;
            if (!best || d < best.d) best = { t, d };
          }
        edge = best?.t;
      }
      if (!edge) return undefined;
      // which way the ground ends: toward water or lower ground
      let ox = 0;
      let oz = 0;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = peek(edge.x + a, edge.z + b);
        if (wet(n) || (n.level !== undefined && edge.level !== undefined && n.level < edge.level)) {
          ox += a;
          oz += b;
        }
      }
      const len = Math.hypot(ox, oz) || 1;
      ox /= len;
      oz /= len;
      // restore the ground round it to full bloom, clear its area
      const area = s.areas.areaOf({ roofId: 'g', x: edge.x, z: edge.z });
      if (area && s.state.areas[area]) s.state.areas[area].sealed = false;
      if (area) s.areas.clear(area, true);
      for (let dz = -5; dz <= 5; dz++)
        for (let dx = -5; dx <= 5; dx++) {
          const t = peek(edge.x + dx, edge.z + dz);
          if (!t || t.feature === 'water' || t.blocked || t.occupantId || t.ramp) continue;
          t.ground = 'restored';
          t.bloom = 4;
          t.pollution = 0;
          g.chunks.markTile(t);
        }
      // Bloombot just back from the edge, on land
      let bx = edge.x + 0.5 - ox * 1.2;
      let bz = edge.z + 0.5 - oz * 1.2;
      const back = peek(Math.floor(bx), Math.floor(bz));
      if (!back || wet(back)) [bx, bz] = [edge.x + 0.5, edge.z + 0.5];
      g.bot.teleport('g', bx, bz);
      g.bot.pose.facing = Math.atan2(ox, oz);
      g.bot.following = true;
      // the camera yaw that looks along (ox, oz)
      let best = 0;
      let bestDot = -2;
      for (let y = 0; y < 360; y += 5) {
        g.camera.turnTo(y, true);
        g.camera.update(0.016);
        const f = g.camera.entity.forward;
        const l = Math.hypot(f.x, f.z) || 1;
        const dot = (f.x * ox + f.z * oz) / l;
        if (dot > bestDot) [bestDot, best] = [dot, y];
      }
      g.camera.turnTo(best, true);
      for (let i = 0; i < 300; i++) g.camera.update(0.05);
      return { x: edge.x, z: edge.z, ox, oz, yaw: best };
    }, { tx, tz, nearLand: !!nearLand });
    if (!at) {
      check(false, `${name}: no tile at ${tx}, ${tz}`);
      continue;
    }
    // the chunks rebuild over a few frames
    await page.waitForFunction(() => window.solarbloom.chunks.pending === 0, null, { timeout: 60_000 }).catch(() => {});
    // restored ground grows in (trees, beds) over several seconds: let it finish so both sets match
    await page.waitForTimeout(12000);
    const file = `${out}/${name}.png`;
    await page.screenshot({ path: file });
    await page.screenshot({ path: `${out}/${name}-zoom.png`, clip: { x: 340, y: 230, width: 600, height: 375 } });
    console.log(`  ${file}  (edge tile ${at.x}, ${at.z}, looking ${at.ox.toFixed(2)}, ${at.oz.toFixed(2)})`);
  }
  check(errors.length === 0, `no page errors${errors.length ? ` (${errors.slice(0, 3).join(' | ')})` : ''}`);
} catch (e) {
  console.log(`✗ crashed: ${e.message}`);
  failures.push('crash');
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(failures.length ? 1 : 0);
