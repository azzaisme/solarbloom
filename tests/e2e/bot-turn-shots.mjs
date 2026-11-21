// E26 (#670): Bloombot turns smoothly, never in a snap. Plays a real game on the Deck (1280 × 800, ?gfx=deck, UI at
// 150%) with the follow camera and real key presses, and records Bloombot's facing every frame:
//   1. an about-turn from standing (S tapped from facing away), 2. a reversal while running (Shift+W, then S),
//   3. a curve (W, then W+D), 4. arriving at a spot (a click-walk: it turns to face the thing, then acts).
// Checks: the facing never turns faster than TURN.rate; the reversal stops before it sets off the new way; arriving,
// it acts only once it faces the thing. Saves a frame strip of each (docs/review/bot-turn/<name>-strip.png, built by
// tests/e2e/strip.py from the frames beside it).
//   npm run build && GPU=1 node tests/e2e/bot-turn-shots.mjs [outDir]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/bot-turn';
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 4233);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};
const RATE = 10; // TURN.rate (src/data/botMotion.ts)
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await startGame(page, `http://localhost:${port}`, { slot: 3, query: 'gfx=deck', settings: { uiScale: 150 } });
  await page.addStyleTag({ content: '#hud, #obj, #prompt, #toasts, .toast, #tip, .tip, #labels, .area-label { display: none !important; }' });
  // an open stretch of beach, Hover learned (Shift runs), a fixed camera heading, and a recorder of every frame
  const at = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    g.pause.clear('blur');
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (0.4 - s.clock.dayFraction()) * 2880;
    if (!s.state.salvage.abilities.includes('hover')) s.state.salvage.abilities.push('hover');
    const w = g.bot.walker;
    let best;
    for (let z = 30; z <= 46 && !best; z++)
      for (let x = 4; x <= 24 && !best; x++) {
        let ok = true;
        for (let dz = -4; dz <= 4 && ok; dz++) for (let dx = -4; dx <= 4 && ok; dx++) ok = w.fits('g', x + 0.5 + dx, z + 0.5 + dz) && w.canStepCell?.(x, z, x + dx, z + dz) !== false;
        if (ok) best = [x + 0.5, z + 0.5];
      }
    best ??= [12.5, 40.5];
    g.bot.teleport('g', best[0], best[1]);
    window.__rec = [];
    const rec = () => {
      const p = g.bot.pose;
      window.__rec.push({ t: performance.now(), f: p.facing, x: p.x, z: p.z, v: g.bot.speed, left: g.bot.turner.left, piv: g.bot.stride.pivoting });
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
    return best;
  });
  console.log(`spot: ${at}`);
  /** puts Bloombot back on the spot facing away from the camera (camera at yaw 0 looks along -z: away is -z) */
  const reset = async () => {
    await page.evaluate((at) => {
      const g = window.solarbloom;
      g.bot.teleport('g', at[0], at[1]);
      g.bot.pose.facing = Math.PI; // a test placing it: the turner takes it as it is
      g.camera.turnTo(0, true);
      g.camera.jumpZoom?.(g.camera.minZoom + (g.camera.maxZoom - g.camera.minZoom) * 0.12);
    }, at);
    await page.waitForTimeout(900);
  };
  /** frames while `act` runs: n shots `every` ms apart */
  const film = async (name, n, every, act) => {
    const done = act();
    for (let i = 0; i < n; i++) {
      await page.screenshot({ path: `${dir}/${name}-${String(i).padStart(2, '0')}.png`, clip: { x: 360, y: 180, width: 560, height: 560 } });
      await page.waitForTimeout(every);
    }
    await done;
  };
  const recSince = async (t0, name) => {
    const rec = await page.evaluate((t0) => window.__rec.filter((r) => r.t >= t0), t0);
    if (process.env.DUMP) for (const q of rec) console.log(name, Math.round(q.t - t0), q.f.toFixed(3), q.x.toFixed(3), q.z.toFixed(3), q.v.toFixed(2), q.left.toFixed(3), q.piv);
    return rec;
  };
  const now = () => page.evaluate(() => performance.now());
  /**
   * the fastest the facing changed, radians a second, over spans of at least 80 ms (a screenshot stalls the page, so
   * single-frame timestamps jitter; the game's own frame time is steady)
   */
  const fastest = (rec) => {
    let m = 0;
    for (let i = 0; i < rec.length; i++) {
      let j = i + 1;
      while (j < rec.length && rec[j].t - rec[i].t < 80) j++;
      if (j >= rec.length) break;
      let turned = 0;
      for (let k = i + 1; k <= j; k++) turned += Math.abs(Math.atan2(Math.sin(rec[k].f - rec[k - 1].f), Math.cos(rec[k].f - rec[k - 1].f)));
      m = Math.max(m, turned / ((rec[j].t - rec[i].t) / 1000));
    }
    return m;
  };

  // ── 1. about-turn from standing ──
  await reset();
  let t0 = await now();
  await film('1-about-turn', 8, 60, async () => {
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(150);
    await page.keyboard.up('KeyS');
  });
  await page.waitForTimeout(600);
  let r = await recSince(t0, 'about');
  let turnMs = (() => {
    const start = r.find((q) => Math.abs(q.left) > 0.1);
    const end = start && r.find((q) => q.t > start.t && Math.abs(q.left) < 0.01);
    return start && end ? Math.round(end.t - start.t) : -1;
  })();
  check(fastest(r) <= RATE * 1.15, `about-turn: never faster than the top rate (${fastest(r).toFixed(1)} rad/s, cap ${RATE})`);
  check(turnMs > 350, `about-turn: takes a readable moment (${turnMs} ms)`);
  check(Math.abs(Math.cos(r.at(-1).f)) > 0.99 && Math.cos(r.at(-1).f) > 0, `about-turn: ends facing the camera (${r.at(-1).f.toFixed(2)})`);

  // ── 2. a reversal while running ──
  await reset();
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);
  t0 = await now();
  await film('2-reversal', 9, 50, async () => {
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(700);
    await page.keyboard.up('KeyS');
    await page.keyboard.up('ShiftLeft');
  });
  await page.waitForTimeout(500);
  r = await recSince(t0, 'rev');
  const stopped = r.findIndex((q) => q.v < 0.05);
  // while it pivots it moves only on along its old way (braking), never back toward the new way
  const backwards = r.slice(1).some((q, i) => q.piv && q.z - r[i].z > 0.001); // the old way is -z
  check(stopped > 0, `reversal: it brakes to a stop (${stopped} frames in)`);
  check(!backwards, 'reversal: no sliding backwards while it turns round');
  check(fastest(r) <= RATE * 1.15, `reversal: never faster than the top rate (${fastest(r).toFixed(1)} rad/s)`);

  // ── 3. a curve: W, then W+D ──
  await reset();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  t0 = await now();
  await film('3-curve', 8, 70, async () => {
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(700);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
  });
  await page.waitForTimeout(400);
  r = await recSince(t0, 'curve');
  const minSpeed = Math.min(...r.filter((q) => q.t - t0 > 30 && q.t - t0 < 600).map((q) => q.v)); // D held, keys not yet let go
  check(minSpeed > 1, `curve: a 45° bend keeps it moving (slowest ${minSpeed.toFixed(2)} cells/s)`);
  check(fastest(r) <= RATE * 1.15, `curve: smooth (${fastest(r).toFixed(1)} rad/s at most)`);

  // ── 4. arriving at a spot: it turns to face the thing, then acts ──
  await reset();
  const arrival = await page.evaluate(async (at) => {
    const g = window.solarbloom;
    const out = { acted: -1, leftAtAct: 0 };
    // the cell three to its right; it stands beside it and has to turn to face it
    const ok = g.bot.goTo('g', Math.floor(at[0]) + 3, Math.floor(at[1]) + 1, 1, () => {
      out.acted = performance.now();
      out.leftAtAct = g.bot.turner.left;
    });
    window.__arrive = out;
    return ok;
  }, at);
  check(arrival, 'arrive: a path there');
  await film('4-arrive', 10, 90, async () => {});
  await page.waitForTimeout(800);
  const a = await page.evaluate(() => window.__arrive);
  check(a.acted > 0 && Math.abs(a.leftAtAct) <= (15 * Math.PI) / 180 + 1e-6, `arrive: it acts once it faces the thing (${((a.leftAtAct * 180) / Math.PI).toFixed(1)}° off)`);

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await page.close();
  for (const n of ['1-about-turn', '2-reversal', '3-curve', '4-arrive']) execFileSync('python', ['tests/e2e/strip.py', dir, n]);
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
