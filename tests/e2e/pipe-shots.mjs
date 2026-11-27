// E23.4.2 (#382): pumps, pipes, reservoirs and gravity feeds, played headless. Run after `vite build`:
//   node tests/e2e/pipe-shots.mjs [outDir]
// Scenes (screenshots in outDir, default docs/review/pipes):
//   1 pump-dark / 2 pump-running: a pump on the park pond's bank and a pipe line, no power (dry sight glasses), then
//     powered by a solar panel (aqua glasses, the flywheel turning)
//   3 pump-filling / 3b reservoir-gauge: the pump filling a reservoir at the end of its line; the gauge up its side
//   4 gravity-tank: a reservoir on Mast Row's level-2 terrace feeding the street below, no pump, no power
//   5 gravity-stairs: the pipe stepping down the stairs on its sticks, short elbows at each riser
// Prints ✓/✗ checks and exits non-zero if any fails. Requires Playwright.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/pipes';
mkdirSync(out, { recursive: true });
// other sessions run their own e2e servers at the same time: take the first free port from 4281 up
const server = await preview({ preview: { port: 4281, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.setDefaultTimeout(240000);
await page.goto(`${base}/?slot=1&ui=oldcity`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 240000 });
await page.evaluate(() => window.solarbloom.pause.clear('blur'));
await page.addStyleTag({ content: '.toast, #toasts { display: none !important; }' });

async function settle(ms = 2500) {
  await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 240000 });
  await page.waitForTimeout(ms);
}
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${out}/${name}.png`);
};
const run = (fn, arg) => page.evaluate(fn, arg);
/** Frames a spot at a zoom and heading (bloombot's follow camera off), then waits for the chunks. */
const frame = async (x, z, zoom, yaw = 0, ms = 6000) => {
  await run(({ x, z, zoom, yaw }) => {
    const g = window.solarbloom;
    g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
    g.camera.minZoom = 0.12;
    if (g.bot) g.bot.following = false;
    g.camera.glide(x, 0, z, zoom);
    g.camera.turnTo(yaw);
    for (let i = 0; i < 300; i++) g.camera.update(0.05);
  }, { x, z, zoom, yaw });
  await settle(ms);
};
/** Runs the water network for a while (the headless sim runs far slower than real time on a shared machine). */
const water = (steps) =>
  run((n) => {
    const s = window.solarbloom.sim;
    for (let i = 0; i < n; i++) {
      s.power.tick(1);
      s.water.tick(1);
    }
  }, steps);

try {
  // The park restored, its pond restored; Cistern Basin's Keeper awake (the water pieces unlock), materials, midday.
  await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.areas.clear('park', true);
    s.state.salvage.tier = 2;
    s.state.salvage.keepers.sluice = { step: 'request1' }; // Cistern Basin: reservoirs, pumps, pipes
    s.state.salvage.keepers.tally = { step: 'request1' }; // Old Market: solar panels
    s.state.salvage.pack = { scrap: 80, copper: 20, clay: 80, pipe: 60, wire: 30, glassPane: 40 };
    for (let z = -2; z < 18; z++)
      for (let x = -2; x < 18; x++) {
        const t = s.grid.get('g', x, z);
        if (!t || t.blocked) continue;
        Object.assign(t, { ground: 'restored', pollution: 0, bloom: t.feature === 'water' ? 1 : 3 });
        delete t.tr;
        s.grid.touch(t);
      }
    g.chunks.markAll();
    const p = s.power;
    const noon = { ...p.sky(), sun: 1, solar: 1 };
    p.skyOverride = () => noon;
    s.water.fill('1,10', 1e9);
  });

  // 1–2: a pump on the pond's bank, a pipe line east; no power, then a panel
  const built = await run(() => {
    const s = window.solarbloom.sim;
    s.bot = { roofId: 'g', x: 6.5, z: 12.5 };
    const pump = s.build.place('pump', 'g', 4, 11);
    const laid = [5, 6, 7, 8, 9, 10, 11].map((x) => s.water.pipes.lay('g', x, 11));
    return { pump: !!pump, laid: laid.every(Boolean), pipesLeft: s.state.salvage.pack.pipe };
  });
  check(built.pump && built.laid && built.pipesLeft === 53, `pump built and 7 pipe tiles laid, one Pipe each (${JSON.stringify(built)})`);
  await water(2);
  check(!(await run(() => window.solarbloom.sim.water.pipes.carries(11, 11))), 'no power: the line is dry');
  await frame(8, 11.5, 2.2, 0);
  await shot('1-pump-dark');
  await run(() => {
    const s = window.solarbloom.sim;
    s.bot = { roofId: 'g', x: 6.5, z: 12.5 };
    s.build.place('solar', 'g', 5, 10);
  });
  await water(3);
  check(await run(() => window.solarbloom.sim.water.pipes.carries(11, 11)), 'a panel powers the pump: the line carries water');
  await settle(4000);
  await shot('2-pump-running');

  // 3: a reservoir at the end of the line fills from the pump
  const tank = await run(() => {
    const s = window.solarbloom.sim;
    // a 2×2 spot touching the end of the line (the first the build allows)
    const tried = [];
    for (const [x, z] of [[12, 10], [12, 11], [10, 12], [10, 9], [11, 12], [11, 9]]) {
      s.bot = { roofId: 'g', x: x + 1, z: z + 2.5 };
      const c = s.build.check('reservoir', 'g', x, z);
      tried.push(`${x},${z}: ${c.ok ? 'ok' : c.reason}`);
      if (!c.ok) continue;
      const r = s.build.place('reservoir', 'g', x, z);
      if (r) return { id: r.id, x, z, tried };
    }
    return { id: null, tried };
  });
  check(!!tank.id, `reservoir built at the end of the pump line (${tank.tried.join(' | ')})`);
  const before = await run((id) => window.solarbloom.sim.water.levelOf(`r:${id}`), tank.id);
  // a few game hours of pumping (1200 units a game day into a 400-unit tank)
  await run(() => {
    const s = window.solarbloom.sim;
    for (let i = 0; i < 60; i++) {
      s.power.tick(1);
      s.water.tick(10);
    }
  });
  const after = await run((id) => window.solarbloom.sim.water.levelOf(`r:${id}`), tank.id);
  check(before === 0 && after > 0.2 && after < 1, `the pump fills it (level ${before} → ${after.toFixed(2)})`);
  await settle(5000);
  await frame(9.5, 11.5, 2.2, 0);
  await shot('3-pump-filling');
  await frame(tank.x + 1, tank.z + 1, 3.2, 180);
  await shot('3b-reservoir-gauge');

  // 4–5: gravity: a reservoir on Mast Row's level-2 terrace, a pipe down its stairs, no pump
  const grav = await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    if (!s.state.salvage.abilities.includes('prune')) s.state.salvage.abilities.push('prune');
    s.gates.open('g-mastRow');
    s.areas.clear('mastRow', true);
    for (let z = -26; z <= -16; z++)
      for (let x = 24; x <= 29; x++) {
        const t = s.grid.get('g', x, z);
        if (t && !t.blocked && t.feature !== 'water') Object.assign(t, { ground: 'restored', pollution: 0, bloom: Math.max(1, t.bloom) }), s.grid.touch(t);
      }
    g.chunks.markAll();
    s.bot = { roofId: 'g', x: 27.5, z: -26.5 };
    const r = s.build.place('reservoir', 'g', 25, -25);
    if (r) s.water.fill(`r:${r.id}`, 160);
    const laid = [-24, -23, -22, -21, -20, -19, -18].map((z) => s.water.pipes.lay('g', 27, z));
    s.power.skyOverride = undefined;
    const dark = { ...s.power.sky(), sun: 0, solar: 0, wind: 0 };
    s.power.skyOverride = () => dark; // no power anywhere
    return { r: !!r, laid: laid.every(Boolean) };
  });
  check(grav.r && grav.laid, `terrace reservoir built and pipe laid down the stairs (${JSON.stringify(grav)})`);
  // waking Mast Row's landmark plays its camera cinematic: wait for the camera to come back
  await page.waitForFunction(() => !window.solarbloom.cinematic, null, { timeout: 240000 });
  await water(3);
  check(await run(() => window.solarbloom.sim.water.pipes.carries(27, -18)), 'the pipe carries water down the stairs');
  check(await run(() => window.solarbloom.sim.water.isWatered(window.solarbloom.sim.grid.get('g', 28, -17))), 'the street below the terrace is fed by gravity, with no power');
  /** bloombot's own follow camera, close in (no clouds, which only show zoomed out), from a spot on the terrace */
  // Under load the follow camera sometimes settles far out (clouds) or before the chunks are in: try again, with the
  // zoom set close at once, until it frames bloombot close in.
  const follow = async (x, z, yaw) => {
    let v;
    for (let i = 0; i < 4; i++) {
      await run(({ x, z, yaw, i }) => {
        const g = window.solarbloom;
        g.bot.following = true;
        g.bot.teleport('g', x, z);
        g.camera.turnTo(yaw, i > 0);
        if (i > 0) g.camera.jumpZoom(1.85);
      }, { x, z, yaw, i });
      await settle(5000 + i * 3000);
      v = await run(() => {
        const g = window.solarbloom;
        return { zoom: g.camera.zoom, clouds: g.scene.world.findByName('clouds')?.enabled ?? false };
      });
      if (!v.clouds && v.zoom > 1.5) return v;
    }
    return v;
  };
  // The grid is switched off on purpose here (water runs down with no power), so the park's pump is really dark and
  // the guide card says so: right, but not what these two shots are about. It is hidden for them, then shown again.
  const card = (show) =>
    run((show) => {
      const el = document.querySelector('#objTitle')?.parentElement?.closest('[id]');
      if (el) el.style.visibility = show ? '' : 'hidden';
      return !!el;
    }, show);
  check(await card(false), 'the guide card (saying the park pump is dark, as it is with the grid off) is hidden for the gravity shots');
  // the tank on the terrace and its pipe heading for the stairs, from beside it
  const v4 = await follow(26.5, -22.6, 0);
  check(!v4.clouds, `the tank shot is close, with no clouds in it (${JSON.stringify(v4)})`);
  await shot('4-gravity-tank');
  // the pipe stepping down the stairs to the street, the tank at the top, from the foot of the stairs
  const v5 = await follow(27.5, -16.2, 0);
  check(!v5.clouds, `the stairs shot is close, with no clouds in it (${JSON.stringify(v5)})`);
  await shot('5-gravity-stairs');
  // close, from the side of the flight: the pipe runs down it as one straight slope, one bend at the foot
  const v6 = await follow(29.6, -20.6, 90);
  check(!v6.clouds, `the close stairs shot has no clouds in it (${JSON.stringify(v6)})`);
  await shot('6-stairs-close');
  await card(true);
} catch (e) {
  failures.push(String(e));
  console.log('✗', e);
  await shot('error').catch(() => {});
} finally {
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
