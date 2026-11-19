// E23.4.3 (#383): the desalination plant, played headless. Run after `vite build`:
//   node tests/e2e/desal-shots.mjs [outDir]
// Scenes (screenshots in outDir, default docs/review/desal):
//   1 plant-idle: the plant on the Landing's shore, whole in frame, with no power: fan still, lamp dark, columns empty
//   2 plant-working: the same with solar panels: the roof fan turning, the aqua lamp lit, water rising in the columns
//   3 plant-close: a close look at the working plant from the other side
//   4 plant-line: its pipe inland carrying water (aqua sight glasses)
// Prints ✓/✗ checks and exits non-zero if any fails. Requires Playwright.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/desal';
mkdirSync(out, { recursive: true });
// other sessions run their own e2e servers at the same time: take the first free port from 4291 up
const server = await preview({ preview: { port: 4291, strictPort: false }, logLevel: 'silent' });
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
await page.addStyleTag({ content: '#hint, #intro, .toast, #toasts { display: none !important; }' });

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
    // the explore camera follows bloombot: stand it beside the spot, then hold the view there
    if (g.bot) {
      g.bot.teleport('g', x + 2.5, z + 0.5);
      g.bot.following = false;
    }
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
  // the Landing's shore: Cistern Basin's Keeper awake (the plant unlocks), Old Market's (solar panels), materials
  const spot = await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.state.salvage.tier = 2;
    s.state.salvage.keepers.sluice = { step: 'request1' };
    s.state.salvage.keepers.tally = { step: 'request1' };
    s.state.salvage.pack = { scrap: 80, copper: 20, clay: 80, pipe: 60, wire: 30, glassPane: 40 };
    const p = s.power;
    const noon = { ...p.sky(), sun: 1, solar: 1 };
    p.skyOverride = () => noon;
    const fogged = (t) => s.areas.fog(s.areas.map.areaOfCell(t.x, t.z)) === 'hidden';
    const land = (t) => t && t.feature !== 'water' && !t.blocked && !t.occupantId && t.feature !== 'building' && !fogged(t);
    for (let z = 47; z >= 36; z--)
      for (let x = 2; x <= 26; x++) {
        const f = s.grid.footprint('g', x, z, 2);
        if (!f.every(land) || !f.some((t) => s.water.onShore(t))) continue;
        let ok = true;
        for (let k = 1; k <= 6; k++) if (!land(s.grid.get('g', x, z - k))) ok = false;
        for (const [dx, dz] of [[2, 0], [2, 1], [-1, 0], [-1, 1], [2, -1]]) if (!land(s.grid.get('g', x + dx, z + dz))) ok = false;
        if (!ok) continue;
        for (let dz = -7; dz <= 2; dz++)
          for (let dx = -2; dx <= 3; dx++) {
            const t = s.grid.get('g', x + dx, z + dz);
            if (land(t)) Object.assign(t, { ground: 'restored', pollution: 0, bloom: Math.max(1, t.bloom) }), s.grid.touch(t);
          }
        g.chunks.markAll();
        s.bot = { roofId: 'g', x: x + 0.5, z: z - 2.5 };
        g.bot.teleport('g', x + 3.5, z - 4.5);
        return { x, z };
      }
    return null;
  });
  check(!!spot, `a shore spot by the Landing (${JSON.stringify(spot)})`);
  const built = await run(({ x, z }) => {
    const s = window.solarbloom.sim;
    const m = s.build.place('desalination', 'g', x, z);
    const laid = [1, 2, 3, 4, 5, 6].map((k) => s.water.pipes.lay('g', x, z - k));
    return { id: m?.id, laid: laid.every(Boolean) };
  }, spot);
  check(!!built.id && built.laid, `the plant built on the shore through the real build, its pipe laid inland (${JSON.stringify(built)})`);
  await water(3);
  const idle = await run((id) => {
    const s = window.solarbloom.sim;
    const m = s.machine(id);
    return { powered: s.power.isPowered(m), level: s.water.levelOf(`d:${id}`), carries: s.water.pipes.carries(m.x, m.z - 6) };
  }, built.id);
  check(!idle.powered && idle.level === 0 && !idle.carries, `no power: idle, its tank empty, the line dry (${JSON.stringify(idle)})`);
  await frame(spot.x + 1, spot.z + 0.5, 2.6, 20, 9000);
  await shot('1-plant-idle');
  const panels = await run(({ x, z }) => {
    const s = window.solarbloom.sim;
    return [[2, 0], [2, 1], [-1, 0], [-1, 1], [2, -1]].map(([dx, dz]) => s.build.place('solar', 'g', x + dx, z + dz)).filter(Boolean).length;
  }, spot);
  // a game hour of running: its tank (and the glass columns) fill while the line takes what it needs
  await run(() => {
    const s = window.solarbloom.sim;
    for (let i = 0; i < 12; i++) {
      s.power.tick(1);
      s.water.tick(10);
    }
  });
  const working = await run((id) => {
    const s = window.solarbloom.sim;
    const m = s.machine(id);
    return { powered: s.power.isPowered(m), draw: s.power.draw(m), level: s.water.levelOf(`d:${id}`), carries: s.water.pipes.carries(m.x, m.z - 6) };
  }, built.id);
  check(panels === 5 && working.powered && working.draw >= 12 && working.level > 0.3 && working.carries, `panels power it: a heavy load, its tank filling, the line carrying water (${JSON.stringify(working)})`);
  await settle(5000);
  await frame(spot.x + 1, spot.z + 0.5, 2.6, 20, 6000);
  await shot('2-plant-working');
  await frame(spot.x + 1, spot.z + 0.5, 4, 200, 6000);
  await shot('3-plant-close');
  await frame(spot.x + 0.5, spot.z - 3, 2, 300, 6000);
  await shot('4-plant-line');
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
