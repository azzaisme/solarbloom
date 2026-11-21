// E26 (#671): Bloombot's movement with more life. Plays a real game on the Deck (1280 × 800, ?gfx=deck, UI at 150%)
// with Bloombot wearing its late E25 parts, filmed side on (the camera turned 90°, its drift back behind switched off)
// while real keys drive it, and records the movement drawn every frame (BotMoves):
//   1. setting off and stopping, 2. walk into a run, 3. up a ramp, 4. wading, 5. landing a glide, 6. into a wall,
//   7. idle moments.
// Checks each one, and that the parts stay on. Saves a frame strip of each (docs/review/bot-moves/<name>-strip.png).
//   npm run build && GPU=1 node tests/e2e/bot-moves-shots.mjs [outDir]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/bot-moves';
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 4234);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};
const LATE = { moves: ['pry', 'hover', 'climb', 'glide'], levels: { chargeCells: 5, chargeEfficiency: 5, sprint: 5, pulseRadius: 5, backpack: 5, quickHands: 3, keenEye: 3, sunSoak: 3, lantern: 2, luckyPulse: 3 }, park: 3 };
const strips = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await startGame(page, `http://localhost:${port}`, { slot: 3, query: 'gfx=deck', settings: { uiScale: 150 } });
  await page.addStyleTag({ content: '#hud, #obj, #prompt, #toasts, .toast, #tip, .tip, #labels, .area-label { display: none !important; }' });
  const spots = await page.evaluate((grow) => {
    const g = window.solarbloom;
    const s = g.sim;
    g.pause.clear('blur');
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (0.4 - s.clock.dayFraction()) * 2880;
    const sv = s.state.salvage;
    sv.abilities = [...grow.moves];
    sv.research ??= { analysed: [], done: [], running: [], levels: {} };
    sv.research.levels = { ...grow.levels };
    s.state.progression.parkGrowth = grow.park;
    s.charge.fill?.();
    g.settings.noRecentre = true;
    const b = g.bot;
    const w = b.walker;
    const fits = (x, z) => w.fits('g', x + 0.5, z + 0.5);
    const p = b.pose;
    const keep = { x: p.x, z: p.z };
    const yAt = (x, z) => {
      p.x = x;
      p.z = z;
      return b.world()[1];
    };
    let open, ramp, water, wall;
    for (let z = -40; z <= 60; z++)
      for (let x = -40; x <= 50; x++) {
        if (!fits(x, z)) continue;
        // a run along -z: 9 cells clear, a cell either side, level
        if (!open) {
          let ok = true;
          for (let d = 0; d <= 9 && ok; d++) for (let e = -1; e <= 1 && ok; e++) ok = fits(x + e, z - d) && !w.wading({ roofId: 'g', x: x + e + 0.5, z: z - d + 0.5 });
          if (ok && Math.abs(yAt(x + 0.5, z + 0.5) - yAt(x + 0.5, z - 8.5)) < 1e-6) open = [x + 0.5, z + 0.5];
        }
        // a ramp climbing toward -z, with room below and above it
        if (!ramp && fits(x, z + 1) && fits(x, z + 2) && fits(x, z - 1) && fits(x, z - 2)) {
          const lo = yAt(x + 0.5, z + 0.9);
          const hi = yAt(x + 0.5, z + 0.1);
          if (hi - lo > 0.15) ramp = [x + 0.5, z + 2.5, x, z - 2];
        }
        // water to wade through along -z
        if (!water && w.wading({ roofId: 'g', x: x + 0.5, z: z + 0.5 }) && fits(x, z + 3) && fits(x, z - 3)) {
          let ok = true;
          for (let d = -3; d <= 3 && ok; d++) ok = fits(x, z + d);
          if (ok && !w.wading({ roofId: 'g', x: x + 0.5, z: z + 3.5 })) water = [x + 0.5, z + 3.5, x, z - 3];
        }
        // a wall just to -z, with a run-up of three cells
        if (!wall && !fits(x, z - 1) && fits(x, z + 1) && fits(x, z + 2) && fits(x, z + 3) && fits(x - 1, z) && fits(x + 1, z)) wall = [x + 0.5, z + 3.5];
      }
    p.x = keep.x;
    p.z = keep.z;
    // the beach below the Landing: open sand, seen clear from the side (the search's first find can be walled in)
    if (fits(8, 36) && fits(8, 28)) open = [8.5, 36.5];
    window.__rec = [];
    const v = b.visuals;
    const rec = () => {
      const m = v.moves;
      const l = m.look;
      window.__rec.push({ t: performance.now(), lean: l.body.lean, knee: l.body.knee, up: l.up, back: l.back, run: l.run, layer: v.runLayer?.weight ?? -1, leaves: l.leaves, armW: l.armW, out: l.arms.lOut, wade: l.wade, idle: l.idle ?? '', bump: m.bumping, speed: b.speed, loop: v.loop, climb: v.moveIn.climb, x: p.x, z: p.z, parts: v.pieces.length, far: Math.max(0, ...v.pieces.map((q) => q.e.getPosition().distance(v.root.getPosition()))) });
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
    return { open, ramp, water, wall };
  }, LATE);
  console.log('spots:', JSON.stringify(spots));
  /** stands Bloombot at (x, z) facing -z, the camera side on (yaw 90: D drives it along -z) */
  const place = async (at) => {
    await page.evaluate((at) => {
      const g = window.solarbloom;
      g.bot.teleport('g', at[0], at[1]);
      g.bot.pose.facing = Math.PI; // a test placing it: the turner takes it as it is
      g.bot.wake();
      g.camera.turnTo(90, true);
      g.zoomStepBy(-1); // a step closer than the default
      g.updateBotZoom();
    }, at);
    await page.waitForTimeout(900);
  };
  /** a square clip of `size` px about Bloombot's middle, as drawn now */
  const around = (size) =>
    page.evaluate((size) => {
      const g = window.solarbloom;
      const p = g.bot.visuals.root.getPosition().clone();
      p.y += 0.42;
      const s = g.camera.cam.worldToScreen(p);
      const x = Math.round(Math.min(1280 - size, Math.max(0, s.x - size / 2)));
      const y = Math.round(Math.min(800 - size, Math.max(0, s.y - size / 2)));
      return { x, y, width: size, height: size };
    }, size);
  const film = async (name, n, every, act) => {
    const done = act();
    for (let i = 0; i < n; i++) {
      await page.screenshot({ path: `${dir}/${name}-${String(i).padStart(2, '0')}.png`, clip: await around(300) });
      await page.waitForTimeout(every);
    }
    await done;
    strips.push(name);
  };
  const now = () => page.evaluate(() => performance.now());
  const since = (t0) => page.evaluate((t0) => window.__rec.filter((r) => r.t >= t0), t0);
  const max = (r, f) => Math.max(...r.map(f));
  const min = (r, f) => Math.min(...r.map(f));
  const partsOk = (r, what) => {
    const n = r[0]?.parts ?? 0;
    check(n > 10 && r.every((q) => q.parts === n) && max(r, (q) => q.far) < 1.4, `${what}: the E25 parts stay on (${n}, furthest ${max(r, (q) => q.far).toFixed(2)})`);
  };

  // ── 1. setting off and stopping ──
  await place(spots.open);
  let t0 = await now();
  await film('1-start-stop', 10, 90, async () => {
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(700);
    await page.keyboard.up('KeyD');
  });
  await page.waitForTimeout(1200);
  let r = await since(t0);
  const stopAt = r.findIndex((q, i) => i > 5 && q.speed < 0.05);
  const after = r.slice(stopAt > 0 ? stopAt - 15 : r.length);
  check(max(r.slice(0, 20), (q) => q.lean) > 3, `setting off: it leans in (${max(r.slice(0, 20), (q) => q.lean).toFixed(1)}°)`);
  check(max(after, (q) => q.lean) > 4 && min(after, (q) => q.lean) < -0.5, `stopping: forward, then a rock back (${max(after, (q) => q.lean).toFixed(1)}° … ${min(after, (q) => q.lean).toFixed(1)}°)`);
  check(Math.abs(r.at(-1).lean) < 1, `stopping: it settles (${r.at(-1).lean.toFixed(2)}°)`);
  partsOk(r, 'start-stop');

  // ── 2. a walk into a run ──
  await place(spots.open);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(600);
  t0 = await now();
  await film('2-walk-run', 10, 70, async () => {
    await page.keyboard.down('ShiftLeft');
    await page.waitForTimeout(900);
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyD');
  });
  await page.waitForTimeout(600);
  r = await since(t0);
  check(r.some((q) => q.layer > 0.05 && q.layer < 0.95), `walk → run: a blend on the way (${r.filter((q) => q.layer > 0.05 && q.layer < 0.95).length} frames between)`);
  check(max(r, (q) => q.layer) > 0.97, `running: the run clip in full (${max(r, (q) => q.layer).toFixed(2)})`);
  const running = r.filter((q) => q.run > 0.97);
  check(running.length > 5 && min(running, (q) => q.lean) > 6 && min(running, (q) => q.leaves) > 15 && min(running, (q) => q.armW) > 0.5, `running: leaning forward, arms trailing, leaves streaming (lean ≥ ${running.length ? min(running, (q) => q.lean).toFixed(1) : '-'}°)`);
  partsOk(r, 'run');

  // ── 3. up a ramp ──
  if (spots.ramp) {
    await place([spots.ramp[0], spots.ramp[1]]);
    t0 = await now();
    await film('3-ramp', 10, 90, async () => {
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(1500);
      await page.keyboard.up('KeyD');
    });
    await page.waitForTimeout(400);
    r = await since(t0);
    const up = r.filter((q) => q.climb > 0.1);
    check(up.length > 3 && max(up, (q) => q.lean) > 4, `ramp: leans into the climb (${up.length} frames climbing, lean up to ${up.length ? max(up, (q) => q.lean).toFixed(1) : '-'}°)`);
  } else check(false, 'ramp: none found near the start');

  // ── 4. wading ──
  if (spots.water) {
    await place([spots.water[0], spots.water[1]]);
    t0 = await now();
    await film('4-wade', 10, 120, async () => {
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(2200);
      await page.keyboard.up('KeyD');
    });
    await page.waitForTimeout(400);
    r = await since(t0);
    const wet = r.filter((q) => q.wade > 0.9 && q.speed > 0.3);
    check(wet.length > 5 && min(wet, (q) => q.out) > 20, `wading: arms out for balance (${wet.length} frames)`);
    check(wet.length > 5 && max(wet, (q) => q.speed) < 2.6 * 0.6 + 0.1, `wading: slower steps (${wet.length ? max(wet, (q) => q.speed).toFixed(2) : '-'} cells/s at most)`);
  } else check(false, 'wading: no water found near the start');

  // ── 5. landing a glide ──
  await place(spots.open);
  t0 = await now();
  await film('5-land', 12, 80, async () => {
    await page.evaluate((at) => window.solarbloom.bot.travel(at[0], at[1] - 3, 'glide', 0.9, 1.1), spots.open);
    await page.waitForTimeout(1500);
  });
  await page.waitForTimeout(300);
  r = await since(t0);
  check(max(r, (q) => q.knee) > 20 && max(r, (q) => q.up) > 0.03, `landing: a crouch and a little hop (knee ${max(r, (q) => q.knee).toFixed(0)}°, up ${max(r, (q) => q.up).toFixed(3)})`);
  partsOk(r, 'landing');

  // ── 6. into a wall ──
  if (spots.wall) {
    await place(spots.wall);
    t0 = await now();
    await film('6-wall', 10, 90, async () => {
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(1800);
      await page.keyboard.up('KeyD');
    });
    r = await since(t0);
    const bumps = r.filter((q, i) => q.bump && !r[i - 1]?.bump).length;
    const end = r.filter((q) => q.t > r.at(-1).t - 400);
    check(bumps === 1, `wall: one recoil while it holds into it (${bumps})`);
    check(max(r, (q) => q.back) > 0.04, `wall: it recoils back (${max(r, (q) => q.back).toFixed(3)})`);
    check(end.every((q) => q.speed < 0.1 && q.loop === 'idle'), `wall: then it stands, not running in place (${end.map((q) => q.loop).filter((x, i, a) => a.indexOf(x) === i)})`);
  } else check(false, 'wall: none found near the start');

  // ── 7. idle moments ──
  await place(spots.open);
  const kinds = [];
  for (let i = 0; i < 4; i++) {
    // skip the wait (it is MOVES.idle.after / .every seconds standing): the next one starts at once
    await page.evaluate(() => {
      const b = window.solarbloom.bot;
      b.stillFor += 7;
    });
    await page.waitForFunction(() => window.solarbloom.bot.visuals.moves.look.idle, null, { timeout: 5000 });
    const kind = await page.evaluate(() => window.solarbloom.bot.visuals.moves.look.idle);
    kinds.push(kind);
    if (kind !== 'look' || !strips.includes('7-idle-look')) await film(`7-idle-${kind}`, 8, kind === 'shake' ? 110 : 250, async () => {});
    await page.waitForFunction(() => !window.solarbloom.bot.visuals.moves.look.idle, null, { timeout: 8000 });
  }
  check(JSON.stringify(kinds) === JSON.stringify(['look', 'stretch', 'look', 'shake']), `idle: looking round, a stretch, again, shaking off dust (${kinds})`);
  // any play input ends one at once
  await page.evaluate(() => (window.solarbloom.bot.stillFor += 7));
  await page.waitForFunction(() => window.solarbloom.bot.visuals.moves.look.idle, null, { timeout: 5000 });
  t0 = await now();
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyD');
  r = await since(t0);
  const gone = r.find((q) => !q.idle);
  check(!!gone && gone.t - t0 < 300, `idle: a key press ends it at once (${gone ? Math.round(gone.t - t0) : '-'} ms)`);

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await page.close();
  for (const n of strips) execFileSync('python', ['tests/e2e/strip.py', dir, n, '0.8']);
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
