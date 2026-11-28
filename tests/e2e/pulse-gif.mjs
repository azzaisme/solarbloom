// VFX 1: frames of one tap pulse on dead ground, evenly spaced in effect time, into docs/review/pulse/frames/ (then
// tools/frames-to-gif.py makes the GIF). The world runs slowed down while it records, so every frame lands on time
// however slow the browser is.
//   npx vite build && GPU=1 node tests/e2e/pulse-gif.mjs [day|night] [mega|tile|multi]
// `multi`: Wider pulse at level 1, so the tap heals a patch of tiles (one fire over all of them).
// `tile`: the camera close on the tile in front of Bloombot (held still), recording until it has grown in.
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { preview } from 'vite';
import { QUIET_CSS, startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const when = process.argv[2] ?? 'day';
const mega = process.argv[3] === 'mega';
const tile = process.argv[3] === 'tile';
const multi = process.argv[3] === 'multi';
const dir = `docs/review/pulse/frames/${when}${mega ? '-mega' : tile ? '-tile' : multi ? '-multi' : ''}`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4215, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const FPS = 25;
const SLOW = 0.05;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(240_000);
  await startGame(page, 'http://localhost:4215', { slot: 3, query: 'gfx=high', settings: { hints: false } });
  await page.addStyleTag({ content: QUIET_CSS + ' #hud, #res, #obj, #minimap, #prompt, #dock { display: none !important; }' });
  await page.evaluate((f) => {
    const s = window.solarbloom.sim;
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
    s.lights.dark = s.power.sky().dark;
  }, when === 'night' ? 0.83 : 0.36);
  await page.waitForTimeout(2000);
  // a dead park tile with dead ground round it; Bloombot on it, facing the next one north, the camera behind
  const ok = await page.evaluate((mega) => {
    const g = window.solarbloom;
    const s = g.sim;
    const dead = (x, z) => {
      const t = s.grid.get('g', x, z);
      return t && !t.blocked && !t.occupantId && t.feature !== 'water' && t.feature !== 'building' && s.restoration.isEligible(t);
    };
    // the most open dead ground: the tile with the most dead ground within 4 tiles (all of it within 2), on the
    // level the park's paving is on (not on the steps down to the beach)
    const level = (x, z) => s.grid.tileWorld(s.grid.get('g', x, z))[1];
    let t;
    let best = -1;
    for (const c of s.areas.tiles('park')) {
      let ring = true;
      for (let dz = -2; dz <= 2 && ring; dz++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dz * dz <= 4 && (!dead(c.x + dx, c.z + dz) || level(c.x + dx, c.z + dz) !== level(c.x, c.z))) ring = false;
      // close on a tile: dead bare earth round it (restored paving stays stone; earth turns to grass)
      if (mega === 'tile') {
        let earth = true;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!dead(c.x + dx, c.z + dz) || s.grid.get('g', c.x + dx, c.z + dz)?.feature === 'paving' || level(c.x + dx, c.z + dz) !== level(c.x, c.z)) earth = false;
        if (!earth) continue;
      } else if (!ring || c.z > 12) continue;
      let n = 0;
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dz * dz <= 16 && dead(c.x + dx, c.z + dz)) n++;
      if (n > best) {
        best = n;
        t = c;
      }
    }
    if (!t) return false;
    g.bot.teleport('g', t.x + 0.5, t.z + 0.5);
    Object.assign(g.bot.pose, { x: t.x + 0.5, z: t.z + 0.5, facing: Math.PI });
    g.camera.turnTo(360, true);
    g.closeAll?.();
    if (mega === 'multi') s.state.upgrades.broadPulse = 1;
    if (mega === true) {
      const p = s.state.progression;
      p.coreActivated = true;
      p.megaCharge = 1e3;
    }
    return true;
  }, tile ? 'tile' : multi ? 'multi' : mega);
  if (!ok) throw new Error('no open dead ground in the park');
  await page.waitForTimeout(2500);
  if (tile) {
    // close on the tile in front, from a little to the side, the camera held there (the follow can't take it back)
    await page.evaluate(([yaw, zoom, tilt]) => {
      const g = window.solarbloom;
      const f = g.bot.front();
      const [x, y, z] = g.sim.grid.tileWorld(g.sim.grid.get('g', f.x, f.z));
      const c = g.camera;
      const s = c.snapshot();
      // the chase camera looks at a point 1.05 above its target: drop the target so the tile is in the middle
      const t = [x, y - 0.95, z];
      c.restore({ ...s, target: t, goal: t, yaw, yawGoal: yaw, zoom, zoomGoal: zoom, maxZoom: zoom, pitchOffset: tilt, held: true });
    }, [Number(process.env.YAW ?? 270), Number(process.env.ZOOM ?? 6.5), Number(process.env.TILT ?? 30)]);
    await page.waitForTimeout(1500);
  }
  await page.evaluate((k) => (window.solarbloom.app.timeScale = k), SLOW);
  const clock = () => page.evaluate(() => window.solarbloom.vfx.clock);
  const start = await clock();
  let i = 0;
  const frame = async () => {
    const at = start + i / FPS;
    await page.waitForFunction((u) => window.solarbloom.vfx.clock >= u, at, { polling: 'raf' });
    await page.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png` });
    i++;
  };
  // a beat of stillness, the pulse, then until it has settled
  for (let k = 0; k < 6; k++) await frame();
  if (mega) await page.keyboard.down('Space');
  else await page.keyboard.press('Space');
  const seconds = mega ? 4.6 : tile ? 3.2 : 1.9;
  while (i < 6 + seconds * FPS) await frame();
  if (mega) await page.keyboard.up('Space');
  console.log(`  ✓ ${i} frames in ${dir}`);
} finally {
  await browser.close();
  await server.close();
}
