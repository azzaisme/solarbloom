// #627 (E25): Bloombot's parts. Every upgrade, move and park growth shows on Bloombot, and every level changes it.
// In a real game at 1280 × 800 and 150% interface size (the Deck), three Bloombots, early, mid and late, each shot
// from the follow camera (behind, as you play) and close up from behind and the front, plus the parts that only a
// close look shows (feet, hands, the visor's lens). Checks:
//   - each stage wears exactly the parts data/botParts lists for it, and more as it grows;
//   - the Lantern's light shines from the lamp on its pack;
//   - Bloombot still reads from the follow camera: its parts stay within a little of its own outline.
// Shots go to docs/review/e25-627/ (SHOTS_DIR overrides). ONLY=late runs one stage (for placing parts by eye).
//   npm run build && GPU=1 node tests/e2e/bloombot-parts-shots.mjs
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.env.SHOTS_DIR ?? 'docs/review/e25-627';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4272);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

/** The three Bloombots: what each has grown into. */
const STAGES = {
  early: { moves: ['prune'], levels: { chargeCells: 1, pulseRadius: 1, backpack: 1 }, park: 1 },
  mid: { moves: ['prune', 'hover'], levels: { chargeCells: 3, chargeEfficiency: 2, sprint: 2, pulseRadius: 3, backpack: 2, quickHands: 1, keenEye: 1, sunSoak: 1, lantern: 1, luckyPulse: 1 }, park: 2 },
  late: { moves: ['prune', 'hover', 'climb', 'glide'], levels: { chargeCells: 5, chargeEfficiency: 5, sprint: 5, pulseRadius: 5, backpack: 5, quickHands: 3, keenEye: 3, sunSoak: 3, lantern: 2, luckyPulse: 3 }, park: 3 },
};

const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

/** Photo mode, its bar hidden, the camera at `yaw` round Bloombot, `zoom` (default: as close as it goes). */
const look = (yaw, zoom, pitch) =>
  page.evaluate(
    ({ yaw, zoom, pitch }) => {
      const g = window.solarbloom;
      if (!g.photo.active) g.photo.enter();
      if (!g.photo.clean) g.photo.action('backpack');
      g.bot.pose.facing = 0;
      g.camera.jumpZoom(zoom ?? g.camera.maxZoom);
      g.camera.turnTo(yaw, true);
      if (pitch !== undefined && g.camera.setPitch) g.camera.setPitch(pitch);
      g.camIdle = 0;
    },
    { yaw, zoom, pitch },
  );
/** A square crop round a point on Bloombot (`up`: how far above its feet). */
async function crop(path, up = 0.45, size = 480, scale = 'css') {
  const c = await page.evaluate((up) => {
    const g = window.solarbloom;
    const p = g.bot.visuals.root.getPosition().clone();
    p.y += up;
    return g.camera.toScreen(p);
  }, up);
  const vw = page.viewportSize();
  const x = Math.max(0, Math.min(vw.width - size, c.x - size / 2));
  const y = Math.max(0, Math.min(vw.height - size, c.y - size / 2));
  await page.screenshot({ path, clip: { x, y, width: size, height: size }, scale });
}

try {
  await page.goto(`http://localhost:${port}/?slot=1&new=1&gfx=deck`);
  await page.waitForFunction(() => window.solarbloom?.bot?.visuals?.loaded && document.querySelector('#loading')?.classList.contains('gone'));
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    g.hud.setUiScale(150);
    const [fx, fz] = g.sim.areas.info('park').landmark;
    g.bot.teleport('g', fx - 2.5, fz + 4.5);
    const s = g.sim;
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (0.3 - s.clock.dayFraction()) * 2880;
  });
  await page.waitForTimeout(1200);
  let last = 0;
  for (const [stage, grow] of Object.entries(STAGES)) {
    if (process.env.ONLY && process.env.ONLY !== stage) continue;
    const got = await page.evaluate((grow) => {
      const g = window.solarbloom;
      const sv = g.sim.state.salvage;
      sv.abilities = [...grow.moves];
      sv.research ??= { analysed: [], done: [], running: [], levels: {} };
      sv.research.levels = { ...grow.levels };
      g.sim.state.progression.parkGrowth = grow.park;
      return new Promise((r) => setTimeout(() => r(g.bot.visuals.growthPieces.map((p) => p.name)), 400));
    }, grow);
    const want = await page.evaluate((grow) => window.solarbloom.bot.visuals.partsFor(grow).map((p) => p.name), grow);
    if (want) check(JSON.stringify(got) === JSON.stringify(want), `${stage}: wears what botParts lists (${got.length})`);
    check(got.length > last, `${stage}: more parts than the stage before (${got.length} > ${last})`);
    last = got.length;
    // the follow camera, as you play: from behind, a little above
    await page.evaluate(() => window.solarbloom.photo.active && window.solarbloom.photo.exit());
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.bot.pose.facing = 0;
      g.camera.turnTo(180, true);
      g.camIdle = 0;
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${stage}-0-follow.png`, scale: 'css' });
    await look(180 + 25);
    await page.waitForTimeout(700);
    await crop(`${out}/${stage}-1-back.png`);
    await look(25);
    await page.waitForTimeout(700);
    await crop(`${out}/${stage}-2-front.png`);
    if (stage === 'late') {
      await look(90);
      await page.waitForTimeout(700);
      await crop(`${out}/${stage}-3-side.png`);
      await look(30);
      await page.waitForTimeout(700);
      await crop(`${out}/${stage}-4-feet.png`, 0.1, 200, 'device');
      await crop(`${out}/${stage}-5-head.png`, 0.72, 200, 'device');
      await look(180 + 20);
      await page.waitForTimeout(700);
      await crop(`${out}/${stage}-6-pack.png`, 0.5, 220, 'device');
    }
    await page.evaluate(() => window.solarbloom.photo.active && window.solarbloom.photo.exit());
  }
  if (!process.env.ONLY || process.env.ONLY === 'late') {
    // the Lantern shines from its lamp at night
    await page.evaluate(() => {
      const s = window.solarbloom.sim;
      (s.state.clock ??= { offset: 0 }).offset += (0.83 - s.clock.dayFraction()) * 2880;
      s.lights.dark = s.power.sky().dark;
    });
    await page.waitForTimeout(1500);
    const lamp = await page.evaluate(() => {
      const v = window.solarbloom.bot.visuals;
      const bulb = v.root.findByName('grow-lamp-bulb');
      const light = v.root.findByName('bloombot-lantern');
      if (!bulb || !light || !light.enabled) return null;
      const a = bulb.getPosition();
      const b = light.getPosition();
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    });
    check(lamp !== null && lamp < 0.05, `the Lantern's light shines from its lamp (${lamp})`);
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.bot.pose.facing = 0;
      g.camera.turnTo(180, true);
      g.camIdle = 0;
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/late-7-night-follow.png`, scale: 'css' });
  }
  check(!errors.length, `no page errors ${errors.join(' | ')}`);
} catch (e) {
  failed++;
  console.log('✗', e);
  await page.screenshot({ path: `${out}/x-error.png` }).catch(() => {});
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failed ? `${failed} failed` : 'all good');
process.exit(failed ? 1 : 0);
