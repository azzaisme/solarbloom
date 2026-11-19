// E23.6.3 (#392): what drones run on, in the game, on the real grid and store. A Drone Hub with a Storage chest
// beside it: with no power on its line its drones wait at home; solar panels beside it start them; with no Biomass
// left in the store they finish, dock and say why in the hub's panel; Biomass back, they start again by themselves.
// Screenshots go to SHOTS_DIR (default docs/review). Run after `vite build` (npm run test:drone-fuel), or against a
// dev server with BASE_URL.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const server = process.env.BASE_URL ? undefined : await preview({ preview: { port: Number(process.env.PORT ?? 4237), strictPort: true }, logLevel: 'silent' });
const base = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 4237}`;
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
  // A hub and a chest on restored park ground, Biomass in the store, nothing on the hub's line yet.
  const hubId = await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    const s = g.sim;
    s.state.salvage.tier = 2;
    s.weather.forceForTest('sunny', Infinity); // the panels' output does not hang on the weather here
    for (let x = 8; x < 18; x++)
      for (let z = 12; z < 20; z++) {
        const t = s.grid.get('g', x, z);
        if (t.occupantId) continue;
        t.ground = 'restored';
        t.pollution = 0;
        t.bloom = 1;
        s.grid.touch(t);
      }
    s.inventory.addToStore('biomass', 200);
    for (const [k, v] of Object.entries(s.build.recipe('droneHub'))) s.inventory.addToStore(k, v);
    for (const [k, v] of Object.entries(s.build.recipe('chest'))) s.inventory.addToStore(k, v);
    for (const [k, v] of Object.entries(s.build.recipe('solar'))) s.inventory.addToStore(k, v * 4);
    s.state.salvage.keepers.tide = { step: 'request1' };
    s.state.salvage.keepers.tally = { step: 'request1' }; // solar panels
    g.bot.teleport('g', 12.5, 12.5); // bloombot by the site (the store is in reach through the chest it builds)
    s.bot = { roofId: 'g', x: 12.5, z: 12.5 };
    const why = [s.build.check('droneHub', 'g', 10, 14).reason];
    const hub = s.build.place('droneHub', 'g', 10, 14);
    let chest;
    for (let x = 13; x < 16 && !chest; x++)
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
  const all = (want, not = false) =>
    page
      .waitForFunction(
        ({ id, want, not }) => window.solarbloom.sim.state.drones.filter((d) => d.hubId === id).every((d) => (window.solarbloom.sim.drones.statusOf(d) === want) !== not),
        { id: hubId, want, not },
        { timeout: 120000 },
      )
      .catch(() => {});
  const line = async () => {
    await page.evaluate((id) => window.solarbloom.select(id), hubId);
    await page.waitForTimeout(500);
    return page.evaluate(() => (document.querySelector('#inspect')?.innerText.match(/Drone 1[^\n]*/) ?? [''])[0]);
  };
  // nothing on its line: the hub sends no one out
  await all('waitingEnergy');
  const dark = await status();
  check(dark.length > 0 && dark.every((x) => x === 'waitingEnergy'), `no power on its line: the drones wait at home (${dark.join(', ')})`);
  let said = await line();
  check(/its hub has no power/.test(said), `the hub's panel says why: "${said}"`);
  // solar panels beside it: the grid powers it, for its drones' roles
  const lit = await page.evaluate((id) => {
    const s = window.solarbloom.sim, hub = s.machine(id);
    s.bot = { roofId: 'g', x: window.solarbloom.bot.pose.x, z: window.solarbloom.bot.pose.z };
    let n = 0;
    const why = new Set();
    // the tiles touching the hub's sides, then each new panel's (panels join a line by touching)
    for (let ring = 0; ring < 3 && n < 3; ring++)
      for (let x = hub.x - 1 - ring; x <= hub.x + hub.size + ring && n < 3; x++)
        for (let z = hub.z - 1 - ring; z <= hub.z + hub.size + ring && n < 3; z++) {
          const c = s.build.check('solar', 'g', x, z);
          if (!c.ok) why.add(c.reason);
          else if (s.build.place('solar', 'g', x, z) && (s.power.invalidate(), s.power.isPowered(hub) || n < 2)) n++;
        }
    s.power.invalidate();
    return { panels: n, powered: s.power.isPowered(hub), draw: s.power.draw(hub), want: s.droneFuel.supply('restorer').power, why: [...why] };
  }, hubId);
  check(lit.panels > 0 && lit.powered && lit.draw === lit.want, `solar panels beside the hub power it; it draws its Restorer's ${lit.want} W (${JSON.stringify(lit)})`);
  await all('waitingEnergy', true);
  let st = await status();
  check(st.every((x) => x !== 'waitingEnergy' && x !== 'docked'), `powered: the drones go to work by themselves (${st.join(', ')})`);
  // the store runs out of Biomass: they finish what they're on, then dock
  const used = await page.evaluate(() => {
    const inv = window.solarbloom.sim.inventory;
    const had = inv.stored('biomass');
    inv.takeFromStore('biomass', had);
    return had;
  });
  check(used < 200, `Restorers took Biomass from the store as they worked (200 → ${used})`);
  await all('docked');
  st = await status();
  check(st.length > 0 && st.every((x) => x === 'docked'), `no Biomass: the hub's drones dock (${st.join(', ')})`);
  said = await line();
  check(/docked — waiting for Biomass in the store/.test(said), `the hub's panel says why: "${said}"`);
  await page.screenshot({ path: `${dir}/ui-drone-fuel-docked.png` });
  // Biomass back: they start again by themselves
  await page.evaluate(() => window.solarbloom.sim.inventory.addToStore('biomass', 50));
  await all('docked', true);
  st = await status();
  check(st.length > 0 && st.every((x) => x !== 'docked' && x !== 'waitingEnergy'), `Biomass back: they start again by themselves (${st.join(', ')})`);
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
