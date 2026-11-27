// VFX 1: Bloombot's pulse as a ring of healing light, into docs/review/pulse/<argv[2] ?? 'after'>/.
//   npx vite build && GPU=1 node tests/e2e/pulse-shots.mjs [after]
//   BASE=http://localhost:5203 GPU=1 node tests/e2e/pulse-shots.mjs     (a running dev server instead of a build)
// A tap pulse on dead ground by day and by night (power gathering in, the wave mid-way, the wave at its edge), then a
// Mega Pulse: the hold (Bloombot lifting, rings spinning, light streaming in) and the burst rolling out all round it.
// Shots are timed in effect time (the world runs at a fifth of its speed), so a slow software browser still lands on
// the same moments. Fails on any page error, or when a pulse or the Mega Pulse doesn't fire.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
import { QUIET_CSS, startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = `docs/review/pulse/${process.argv[2] ?? 'after'}`;
mkdirSync(dir, { recursive: true });
const server = process.env.BASE ? undefined : await preview({ preview: { port: 4214, strictPort: true }, logLevel: 'silent' });
const base = process.env.BASE ?? 'http://localhost:4214';
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const SLOW = 0.2;
let failed = false;
const fail = (why) => {
  failed = true;
  console.error(`  ✗ ${why}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await startGame(page, base, { slot: 3, query: 'gfx=high', settings: { hints: false } });
  await page.addStyleTag({ content: QUIET_CSS + ' #obj, #prompt { display: none !important; }' });

  /** The light clock (0.3 morning, 0.83 midnight), sunny. */
  const sky = async (f) => {
    await page.evaluate((f) => {
      const s = window.solarbloom.sim;
      s.weather.forceForTest('sunny', 1e9);
      (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
      s.lights.dark = s.power.sky().dark;
    }, f);
    await page.waitForTimeout(2000);
  };
  /** A dead park tile with open dead ground all round it (radius 2), Bloombot stood on it facing the next one north. */
  const standOnDead = async (skip = 0) => {
    const c = await page.evaluate((skip) => {
      const g = window.solarbloom;
      const s = g.sim;
      const ok = (x, z) => {
        const t = s.grid.get('g', x, z);
        return t && !t.blocked && !t.occupantId && t.feature !== 'water' && t.feature !== 'building' && s.restoration.isEligible(t);
      };
      const all = s.areas.tiles('park').filter((t) => {
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dz * dz <= 4 && !ok(t.x + dx, t.z + dz)) return false;
        return true;
      });
      const t = all.length ? all[skip % all.length] : undefined;
      if (!t) return undefined;
      g.bot.teleport('g', t.x + 0.5, t.z + 0.5);
      Object.assign(g.bot.pose, { x: t.x + 0.5, z: t.z + 0.5, facing: Math.PI });
      g.camera.turnTo(360, true);
      g.closeAll?.();
      return { x: t.x, z: t.z };
    }, skip);
    await page.waitForTimeout(1800);
    return c;
  };
  /** Waits until `s` more seconds of effect time have passed. */
  const after = async (s) => {
    const until = await page.evaluate((s) => window.solarbloom.vfx.clock + s, s);
    await page.waitForFunction((u) => window.solarbloom.vfx.clock >= u, until, { polling: 'raf' });
  };
  const shot = async (name) => {
    await page.screenshot({ path: `${dir}/${name}.png` });
    console.log(`  ✓ ${dir}/${name}.png`);
  };
  const greenNow = () => page.evaluate(() => window.solarbloom.sim.areas.tiles('park').filter((t) => t.ground === 'restored' || t.ground === 'growing').length);

  // 1. a tap pulse on dead ground, day and night
  for (const [name, f, skip] of [
    ['day', 0.32, 0],
    ['night', 0.83, 40],
  ]) {
    await sky(f);
    const c = await standOnDead(skip);
    if (!c) {
      fail(`${name}: no open dead ground to pulse`);
      continue;
    }
    const before = await greenNow();
    await page.evaluate((k) => (window.solarbloom.app.timeScale = k), SLOW);
    await page.keyboard.press('Space');
    await after(0.08);
    await shot(`${name}-1-gather`);
    await after(0.2);
    await shot(`${name}-2-wave`);
    await after(0.3);
    await shot(`${name}-3-edge`);
    await page.evaluate(() => (window.solarbloom.app.timeScale = 1));
    await page.waitForTimeout(1500);
    if ((await greenNow()) <= before) fail(`${name}: the pulse didn't take`);
  }

  // 2. the Mega Pulse: hold to charge (Bloombot lifts, rings spin, light streams in), then the burst all round it
  await sky(0.36);
  const c = await standOnDead(80);
  if (!c) fail('mega: no open dead ground');
  else {
    await page.evaluate(() => {
      const p = window.solarbloom.sim.state.progression;
      p.coreActivated = true;
      p.megaCharge = 1e3;
    });
    const before = await greenNow();
    await page.evaluate((k) => (window.solarbloom.app.timeScale = k), SLOW);
    await page.keyboard.down('Space');
    for (const k of [0.35, 0.7, 0.95]) {
      await page.waitForFunction((k) => window.solarbloom.overlays.megaCharge >= k, k, { polling: 'raf' });
      await shot(`mega-1-charge-${Math.round(k * 100)}`);
    }
    await page.waitForFunction(() => window.solarbloom.overlays.megaCharge === 0, null, { polling: 'raf' });
    await after(0.06);
    await shot('mega-2-burst');
    await after(0.35);
    await shot('mega-3-wave');
    await after(0.6);
    await shot('mega-4-edge');
    await page.keyboard.up('Space');
    await page.evaluate(() => (window.solarbloom.app.timeScale = 1));
    await page.waitForTimeout(4000);
    await shot('mega-5-after');
    const lift = await page.evaluate(() => window.solarbloom.bot.visuals.levitate);
    if (lift > 0.01) fail(`mega: Bloombot still floating ${lift.toFixed(2)} after the burst`);
    if ((await greenNow()) < before + 10) fail("mega: the Mega Pulse didn't heal the ground round it");
  }
  if (errors.length) fail(`page errors:\n${errors.join('\n')}`);
} finally {
  await browser.close();
  await server?.close();
}
process.exit(failed ? 1 : 0);
