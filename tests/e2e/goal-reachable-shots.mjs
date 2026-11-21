// #644: Show me where on a fresh game, once the jetty's crate is dug out: the trail leads to a pile bloombot can walk to
// (it used to stop at the canal). On the Deck (1280 × 800, ?gfx=deck) at 150%, into docs/review/goal-reachable/.
//   npm run build && GPU=1 node tests/e2e/goal-reachable-shots.mjs [outDir]
// Fails on a page error, a trail that doesn't get there, or a goal flood slower than a frame's share.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/goal-reachable';
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 4227);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await startGame(page, `http://localhost:${port}`, { slot: 3, query: 'gfx=deck', settings: { uiScale: 150 } });
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    window.solarbloom.pause.clear('blur');
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (0.32 - s.clock.dayFraction()) * 2880;
  });
  const ask = async (name) => {
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.camera.turnTo((g.bot.pose.facing * 180) / Math.PI + 180, true);
      g.trail.clear();
    });
    await page.waitForTimeout(1500);
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(2500);
    const t = await page.evaluate(() => {
      const g = window.solarbloom;
      const w = g.trail.way;
      const o = g.hud.objective.current;
      return { on: g.trail.showing, reached: w?.reached, why: w?.why, goal: JSON.stringify(o?.where), name: o?.place?.name };
    });
    console.log(`  ${name}: ${t.name} ${t.goal} · ${t.on ? 'trail' : 'no trail'} · ${t.reached ? 'gets there' : `stops: ${t.why}`}`);
    await page.screenshot({ path: `${dir}/${name}.png` });
    return t;
  };

  // at the start, on the jetty: the crate in front
  const first = await ask('1-start');
  // bloombot starts right beside the crate: nothing to walk, so no trail (or one that's already there)
  check(/"x":8,"z":44/.test(first.goal) && (!first.on || first.reached), `at the start the goal is the jetty crate, right beside Bloombot (${first.goal})`);
  // dig the crate out, as the first minute of play does
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    const g = JSON.parse(JSON.stringify(window.solarbloom.hud.objective.current.where));
    const pile = s.salvage.pileAt(g.x, g.z);
    for (let i = 0; i < 50 && s.salvage.left(pile.id) > 0; i++) if (!s.salvage.salvage(pile.id)) break;
  });
  await page.waitForTimeout(1200);
  const next = await ask('2-after-crate');
  check(next.on && next.reached, `after the crate the trail gets to the next pile (${next.name} ${next.goal}${next.reached ? '' : `, stops: ${next.why}`})`);
  check(!/-7,|"x":-7/.test(next.goal), 'it no longer picks the Scrap pile across the canal');

  // how long the flood takes when bloombot moves to a new cell (the card asks twice a second)
  const ms = await page.evaluate(async () => {
    const { sim } = window.solarbloom;
    const out = [];
    for (let i = 0; i < 8; i++) {
      // a new cell each time (up the beach), so nothing is cached
      sim.bot = { roofId: 'g', x: 8.5 + (i % 2), z: 40.5 - i };
      const t0 = performance.now();
      sim.advisor.suggest();
      out.push(performance.now() - t0);
    }
    return out;
  });
  const worst = Math.max(...ms);
  console.log(`  flood + advice per new cell: ${ms.map((m) => m.toFixed(1)).join(', ')} ms`);
  check(worst < 30, `working out the goal from a new cell stays under 30 ms (worst ${worst.toFixed(1)} ms)`);
  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
