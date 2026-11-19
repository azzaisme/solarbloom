// E23.2 (#356): a headless play-through of bloombot's charge, the loaded pulse, the reveal ripple and buried finds,
// driven by real key presses where there is a key for it. `node tests/e2e/bloombot-e23.mjs [outDir]` after `vite build` (DIST=<dir> serves a copied build).
// Writes JPEG screenshots at the key moments and prints what each shows; fails on page errors or broken checks.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/e23-2';
mkdirSync(out, { recursive: true });
// any free port: other sessions run previews on this machine too
const server = await preview({ root: process.cwd(), build: { outDir: process.env.DIST ?? 'dist' }, preview: { port: 4251 + Math.floor(Math.random() * 400), strictPort: false }, logLevel: 'silent' });
const URL0 = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const checks = [];
const check = (ok, what) => {
  checks.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};
const shots = [];
async function shot(page, name, what) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 82 });
  shots.push(`${name}.jpg: ${what}`);
}
/** Waits (up to 60 s) for a condition in the page; false when it never came. */
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 60000 }).then(() => true, () => false);
const key = async (page, code) => {
  await page.keyboard.press(code);
  await page.waitForTimeout(250);
};
/**
 * Holds a key until bloombot has walked `tiles` (or `ms` of real time ran out, on a very slow machine): how far it
 * went, and its walking speed (the controller's own per-frame speed, sampled once it is under way past the first
 * half tile; the median, so a slow software-rendered frame doesn't skew it).
 */
async function walk(page, code, ms, tiles = 2.5) {
  const pos = () => page.evaluate(() => ({ x: window.solarbloom.bot.pose.x, z: window.solarbloom.bot.pose.z, v: window.solarbloom.bot.speed }));
  const a = await pos();
  await page.keyboard.down(code);
  const speeds = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.waitForTimeout(120);
    const p = await pos();
    const d = Math.hypot(p.x - a.x, p.z - a.z);
    if (d > 0.5 && p.v > 0.05) speeds.push(p.v);
    if (d >= tiles && speeds.length >= 3) break;
  }
  await page.keyboard.up(code);
  const b = await page.evaluate(() => ({ x: window.solarbloom.bot.pose.x, z: window.solarbloom.bot.pose.z }));
  speeds.sort((p, q) => p - q);
  return { d: Math.hypot(b.x - a.x, b.z - a.z), v: speeds.length ? speeds[Math.floor(speeds.length / 2)] : 0 };
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${URL0}?slot=1&new=1`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');

  // ── E23.2.1: the charge meter: full, low and empty ──
  const meter = () => page.evaluate(() => document.getElementById('chargeRow').innerText.replace(/\s+/g, ' ').trim());
  check((await meter()).includes('100%'), 'a new game starts with a full charge');
  // somewhere open in the park, near home
  await page.evaluate(() => {
    const g = window.solarbloom;
    const f = g.sim.state.machines.find((m) => m.type === 'core' && g.sim.areas.areaOf(m) === 'park');
    g.bot.teleport(f.roofId, f.x + f.size / 2, f.z + f.size + 6);
    g.bot.pose.facing = 0;
  });
  await shot(page, '01-charge-full', 'a full charge: the Charge pill (100%) at the top of the resource strip');
  await page.evaluate(() => (window.solarbloom.sim.state.charge.value = 14));
  check(await until(page, () => document.getElementById('chargeRow').classList.contains('low')), 'the meter warms when low');
  await shot(page, '02-charge-low', 'running low (14%): the pill glows amber');
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.state.charge.value = 0.4;
    s.charge.use('pulse');
    for (const k of Object.keys(s.state.salvage.pack)) delete s.state.salvage.pack[k]; // nothing to eat
  });
  check(await until(page, () => document.getElementById('chargeRow').classList.contains('empty')), 'at zero the meter goes grey');
  await shot(page, '03-charge-empty', 'out of charge: the grey meter at 0% and the one-time "Out of charge" note');

  // ── the low-power walk: slower, never stuck; bloombot droops ──
  await page.evaluate(() => (window.solarbloom.sim.state.charge.value = 100));
  const full = await walk(page, 'KeyS', 30000);
  await page.evaluate(() => (window.solarbloom.sim.state.charge.value = 0));
  const flat = await walk(page, 'KeyW', 30000);
  const vFull = full.v;
  const vFlat = flat.v;
  check(flat.d > 0.2 && vFlat > 0.5, `at zero bloombot still walks (${flat.d.toFixed(2)} tiles, ${vFlat.toFixed(2)} tiles/s)`);
  check(vFlat < vFull * 0.85, `the low-power walk is slower (${vFlat.toFixed(2)} vs ${vFull.toFixed(2)} tiles/s)`);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await shot(page, '04-low-power-walk', 'the low-power walk: bloombot droops forward and walks slower; the meter is grey');
  await page.keyboard.up('KeyW');

  // ── never stranded: walk home, stand still by the fountain, charge trickles back, pulse again ──
  await page.evaluate(() => {
    const g = window.solarbloom;
    const f = g.sim.state.machines.find((m) => m.type === 'core' && g.sim.areas.areaOf(m) === 'park');
    g.bot.teleport(f.roofId, f.x + f.size / 2, f.z + f.size + 1);
  });
  check(await until(page, () => window.solarbloom.sim.charge.atHome()), 'by the fountain counts as home');
  // software rendering runs the sim slowly: allow two minutes of real time for a pulse's worth to come back
  const trickled = await page.waitForFunction(() => window.solarbloom.sim.charge.value() >= 1, undefined, { timeout: 120000 }).then(() => true, () => false);
  check(trickled, 'standing still at home, the charge trickles back (enough for a pulse)');
  await shot(page, '05-resting-home', 'resting by the fountain: the charge creeps back up from zero');
  const pulsed = await page.evaluate(() => {
    const s = window.solarbloom.sim;
    const t = s.areas.tiles('park').find((q) => q.ground === 'polluted' && !q.blocked && !q.occupantId && s.restoration.checkPulse(q).ok);
    return !!t && s.restoration.pulse(t.id);
  });
  check(pulsed, 'with the charge back, a pulse works again');

  // ── eating with F ──
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.state.charge.value = 10;
    s.state.salvage.pack.biomass = 3;
  });
  await key(page, 'KeyF');
  check(
    await until(page, () => window.solarbloom.sim.charge.value() >= 13.9 && !window.solarbloom.sim.charge.eating && window.solarbloom.sim.state.salvage.pack.biomass === 2),
    'F eats a Biomass from the backpack and the charge comes back',
  );
  // ── E23.2.2.1: the load wheel on the keyboard ──
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.state.charge.value = 100;
    s.inventory.add('seeds', 6);
    s.state.salvage.pack.rareSeed = 2;
    s.state.salvage.pack.fertiliser = 2;
    s.econ.add('energy', 1e5);
    s.econ.add('water', 1e5);
  });
  await key(page, 'KeyV');
  check((await page.evaluate(() => window.solarbloom.sim.pulseLoad.choice)) === 'seeds', 'V turns the wheel to Seeds');
  await shot(page, '03-load-wheel', 'the load wheel above the prompt: Seeds lit; the chip under the charge says Seeds');
  await key(page, 'KeyZ');
  check((await page.evaluate(() => window.solarbloom.sim.pulseLoad.choice)) === 'none', 'Z turns it back to Nothing');

  // ── E23.2.2.2: pulse with each load, by Space on the tile in front ──
  const grown = await page.evaluate(async () => {
    const g = window.solarbloom;
    const s = g.sim;
    const dead = s.areas.tiles('park').filter((t) => t.ground === 'polluted' && !t.blocked && !t.occupantId && s.restoration.checkPulse(t).ok);
    const row = dead.find((t) => [0, 6, 12].every((dx) => dead.some((o) => o.x === t.x + dx && o.z === t.z)));
    return row ? [0, 6, 12].map((dx) => ({ x: row.x + dx, z: row.z })) : [];
  });
  check(grown.length === 3, 'three dead park tiles in a row to pulse');
  const loads = ['seeds', 'rare', 'fertiliser'];
  for (let i = 0; i < 3; i++) {
    const c = grown[i];
    await page.evaluate(({ c, load }) => {
      const g = window.solarbloom;
      g.sim.pulseLoad.choose(load);
      g.bot.teleport('g', c.x, c.z + 1);
      g.bot.pose.x = c.x + 0.5;
      g.bot.pose.z = c.z + 1.5;
      g.bot.pose.facing = Math.PI; // facing the tile
    }, { c, load: loads[i] });
    await page.waitForTimeout(300);
    // Space pulses the tile in front; press again if a slow frame swallowed it
    for (let tries = 0; tries < 4; tries++) {
      await key(page, 'Space');
      if (await until(page, (c) => window.solarbloom.sim.grid.get('g', c.x, c.z)?.ground !== 'polluted', c)) break;
    }
  }
  // let the restore transitions play out (the plants are drawn once a tile has finished turning)
  await until(page, (cs) => cs.every((c) => { const t = window.solarbloom.sim.grid.get('g', c.x, c.z); return t?.ground === 'restored' && !t.tr; }), grown);
  const plants = await page.evaluate((cs) => cs.map((c) => window.solarbloom.sim.grid.get('g', c.x, c.z)?.plant ?? 'none'), grown);
  check(plants.join() === 'meadow,rare,grove', `each load grew its own plant: ${plants.join(', ')}`);
  const left = await page.evaluate(() => ({ ...window.solarbloom.sim.state.salvage.pack }));
  check(left.seeds === 5 && left.rareSeed === 1 && left.fertiliser === 1, 'each pulse used one unit of its load');
  await page.evaluate((c) => {
    const g = window.solarbloom;
    // bloombot just in front of the middle plot, looking at the row: the camera follows it, the plots left to right
    g.bot.following = true;
    g.bot.teleport('g', c.x, c.z + 3);
    g.bot.pose.x = c.x + 0.5;
    g.bot.pose.z = c.z + 3.5;
    g.bot.pose.facing = Math.PI;
    g.camera.turnTo(0, true);
  }, grown[1]);
  await page.waitForTimeout(3500);
  await shot(page, '04-loads-grown', 'left to right: a wildflower meadow (seeds), the region\'s rare flowers, a young tree in shrubs over a bigger patch (fertiliser)');

  // ── E23.2.2.3: the ripple reveals a buried find; a mound shows; Interact digs it up ──
  const dug = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const finds = s.buried.near(8, 8, 30);
    for (const f of finds) {
      const t = s.areas.tiles('park').concat(s.areas.tiles('saltwind')).find((q) => q.ground === 'polluted' && !q.blocked && !q.occupantId && s.restoration.checkPulse(q).ok && Math.hypot(q.x - f.x, q.z - f.z) <= 6 && Math.hypot(q.x - f.x, q.z - f.z) >= 2);
      if (!t) continue;
      s.pulseLoad.choose('none');
      s.restoration.pulse(t.id);
      return { f, known: !!s.buried.known(f.x, f.z) };
    }
    return undefined;
  });
  check(!!dug?.known, 'a pulse near a buried find revealed it');
  if (dug) {
    const f = dug.f;
    const faced = await page.evaluate((f) => {
      // stand on a free side of the mound, facing it
      const g = window.solarbloom;
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const t = g.sim.grid.get('g', f.x + dx, f.z + dz);
        if (!t || t.blocked || t.occupantId) continue;
        g.bot.following = true;
        g.bot.teleport('g', f.x + dx, f.z + dz);
        g.bot.pose.x = f.x + dx + 0.5;
        g.bot.pose.z = f.z + dz + 0.5;
        g.bot.pose.facing = Math.atan2(-dx, -dz);
        const fr = g.bot.front();
        if (fr.x === f.x && fr.z === f.z) {
          g.camera.turnTo(45, true);
          return true;
        }
      }
      return false;
    }, f);
    check(faced, 'bloombot stands facing the mound');
    await shot(page, '05-buried-mound', `a revealed buried find (${f.material}): a mound of turned earth with a sprout; the prompt says Dig up`);
    const prompt = await page.evaluate(() => document.getElementById('prompt')?.innerText ?? '');
    check(/Dig up/.test(prompt), `the prompt offers to dig: "${prompt.replace(/\s+/g, ' ')}"`);
    const before = await page.evaluate((m) => window.solarbloom.sim.inventory.count(m), f.material);
    await key(page, 'KeyE');
    await page.waitForTimeout(400);
    const after = await page.evaluate((m) => window.solarbloom.sim.inventory.count(m), f.material);
    check(after === before + f.n, `E dug it up: ${f.material} ${before} → ${after}`);
    await shot(page, '06-buried-dug', 'dug up: the mound is gone and a pick-up toast shows');
  }
  await page.close();
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(shots.map((s) => `  ${s}`).join('\n'));
console.log(checks.join('\n'));
if (errors.length) {
  console.log('PAGE ERRORS:\n' + errors.join('\n'));
  process.exitCode = 1;
}
