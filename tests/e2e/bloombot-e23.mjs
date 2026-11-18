// E23.2 (#356): a headless play-through of bloombot's charge, driven by real key presses where there is a key
// for it. `node tests/e2e/bloombot-e23.mjs [outDir]` after `vite build` (DIST=<dir> serves a copied build).
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
 * Holds a key for `ms` of real time: how far bloombot went, and its walking speed (the controller's own per-frame
 * speed, sampled while walking; the median, so a slow software-rendered frame doesn't skew it).
 */
async function walk(page, code, ms) {
  const a = await page.evaluate(() => ({ x: window.solarbloom.bot.pose.x, z: window.solarbloom.bot.pose.z }));
  await page.keyboard.down(code);
  const speeds = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.waitForTimeout(120);
    const v = await page.evaluate(() => window.solarbloom.bot.speed);
    if (v > 0.05) speeds.push(v);
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
    s.econ.spend({ biomass: s.econ.get('biomass') }); // nothing to eat
  });
  check(await until(page, () => document.getElementById('chargeRow').classList.contains('empty')), 'at zero the meter goes grey');
  await shot(page, '03-charge-empty', 'out of charge: the grey meter at 0% and the one-time "Out of charge" note');

  // ── the low-power walk: slower, never stuck; bloombot droops ──
  await page.evaluate(() => (window.solarbloom.sim.state.charge.value = 100));
  const full = await walk(page, 'KeyS', 1500);
  await page.evaluate(() => (window.solarbloom.sim.state.charge.value = 0));
  const flat = await walk(page, 'KeyW', 1500);
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
    s.econ.add('biomass', 3);
  });
  await key(page, 'KeyF');
  check(await until(page, () => window.solarbloom.sim.charge.value() >= 15.9 && !window.solarbloom.sim.charge.eating), 'F eats a snack and the charge comes back');
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
