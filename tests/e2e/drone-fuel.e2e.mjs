// E23.6.3 (#392): what drones run on, in the game. A Drone Hub with a Storage chest beside it, on a stand-in grid
// (E23.3 plugs in through sim.power): cut the power and its drones finish, dock and say why in the hub's panel;
// bring it back and they start again by themselves. Screenshots go to SHOTS_DIR (default docs/review).
// Run after `vite build` (npm run test:drone-fuel), or against a dev server with BASE_URL.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const server = process.env.BASE_URL ? undefined : await preview({ preview: { port: 4237, strictPort: true }, logLevel: 'silent' });
const base = process.env.BASE_URL ?? 'http://localhost:4237';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?slot=1&new=1`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  // A hub and a chest on restored park ground, the store holding Greens, a stand-in grid that can be cut.
  const hubId = await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    const s = g.sim;
    s.state.salvage.tier = 2;
    window.grid = { on: true };
    s.power.isPowered = () => window.grid.on; // the real grid stays; whether it powers the hub is stood in
    for (let x = 10; x < 16; x++)
      for (let z = 14; z < 18; z++) {
        const t = s.grid.get('g', x, z);
        t.ground = 'restored';
        t.pollution = 0;
        t.bloom = 1;
        s.grid.touch(t);
      }
    s.state.resources.biomass = s.state.resources.biomass.add(200);
    for (const [k, v] of Object.entries(s.build.recipe('droneHub'))) if (k !== 'biomass') s.inventory.addToStore(k, v);
    for (const [k, v] of Object.entries(s.build.recipe('chest'))) s.inventory.addToStore(k, v);
    s.state.salvage.keepers.tide = { step: 'request1' };
    s.bot = { roofId: 'g', x: 12.5, z: 13.5 };
    const why = [s.build.check('droneHub', 'g', 10, 14).reason];
    const hub = s.build.place('droneHub', 'g', 10, 14);
    let chest;
    for (let x = 12; x < 16 && !chest; x++)
      for (let z = 14; z < 18 && !chest; z++) {
        if (s.build.check('chest', 'g', x, z).ok) chest = s.build.place('chest', 'g', x, z);
        else why.push(s.build.check('chest', 'g', x, z).reason);
      }
    return { id: hub?.id, chest: !!chest, why, beside: hub ? !!s.droneFuel.chestBeside(hub) : false };
  }).then((r) => {
    check(!!r.id && r.chest && r.beside, `a Drone Hub and a Storage chest beside it are built in the park (${JSON.stringify(r)})`);
    return r.id;
  });
  await page.waitForFunction((id) => window.solarbloom.sim.state.drones.some((d) => d.hubId === id), hubId);
  const status = () => page.evaluate((id) => window.solarbloom.sim.state.drones.filter((d) => d.hubId === id).map((d) => window.solarbloom.sim.drones.statusOf(d)), hubId);
  // cut the power: drones finish what they're on, then dock
  await page.evaluate(() => (window.grid.on = false));
  await page.waitForFunction((id) => window.solarbloom.sim.state.drones.filter((d) => d.hubId === id).every((d) => window.solarbloom.sim.drones.statusOf(d) === 'docked'), hubId, { timeout: 120000 }).catch(() => {});
  const off = await status();
  check(off.length > 0 && off.every((x) => x === 'docked'), `power off: the hub's drones dock (${off.join(', ')})`);
  await page.evaluate((id) => window.solarbloom.select(id), hubId);
  await page.waitForTimeout(500);
  const panel = await page.evaluate(() => document.querySelector('#inspect')?.innerText ?? '');
  check(/docked — waiting for power/.test(panel), `the hub's panel says why: "${(panel.match(/Drone 1[^\n]*/) ?? [''])[0]}"`);
  await page.screenshot({ path: `${dir}/ui-drone-fuel-docked.png` });
  // power back: they start again by themselves
  await page.evaluate(() => (window.grid.on = true));
  await page.waitForFunction((id) => window.solarbloom.sim.state.drones.filter((d) => d.hubId === id).every((d) => window.solarbloom.sim.drones.statusOf(d) !== 'docked'), hubId, { timeout: 120000 }).catch(() => {});
  const on = await status();
  if (on.some((x) => x === 'docked'))
    console.log('   ', await page.evaluate((id) => {
      const g = window.solarbloom, s = g.sim, hub = s.machine(id);
      return JSON.stringify({ short: s.droneFuel.short(hub, 'restorer'), paused: g.paused, biomass: s.droneFuel.biomass(), drones: s.state.drones.filter((d) => d.hubId === id).map((d) => [d.mode, d.timer]) });
    }, hubId));
  check(on.every((x) => x !== 'docked'), `power back: they start again by themselves (${on.join(', ')})`);
  await page.screenshot({ path: `${dir}/ui-drone-fuel-back.png` });
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await browser.close();
  await server?.close();
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
