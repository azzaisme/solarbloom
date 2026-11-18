// E23.10.2 (#406, #464–#468): the E23 models and bloombot's new clips in the real game, headless (swiftshader).
// `npm run test:e23models` (builds first). A new Old City game; checks every E23 model on disk loaded in the
// game's ModelLibrary, sets them out beside bloombot in the park (machines, then each crop ripe and growing),
// plays each new bloombot clip, and saves screenshots to docs/review/e23-models-*.png. Look at them: this proves
// the files load and draw in the engine. Placing them for real is each system's job (E23.3, E23.5, E23.2.3).
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const MACHINES = ['charger', 'compost-bin', 'watering-can'];
const CROPS = ['seedling', 'radish', 'lettuce', 'potato', 'beans', 'tomato', 'sweetcorn', 'pumpkin', 'sunflower', 'watercress', 'rice', 'lavender', 'mint', 'moonflower', 'flowers', 'sea-kale'].map((c) => `crop-${c}`);
const CLIPS = ['meditate', 'sit-down', 'sit', 'stand-up', 'doze'];
const server = await preview({ preview: { port: 4251, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4251/?slot=1&new=1');
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  await page.waitForFunction(() => window.solarbloom.models?.ready);

  const loaded = await page.evaluate((names) => names.map((n) => [n, window.solarbloom.models.has(n)]), [...MACHINES, ...CROPS]);
  for (const [n, ok] of loaded) check(ok, `model ${n} loaded in the game`);

  // Bloombot by the fountain, the park restored round it, the camera close (near zoom, the default angle).
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    const s = g.sim;
    s.areas.clear('park', true);
    const f = s.state.machines.find((m) => m.type === 'core' && s.areas.areaOf(m) === 'park');
    g.bot.teleport(f.roofId, f.x + f.size / 2, f.z + f.size + 4);
    g.camera.zoomTo(g.camera.minZoom);
  });
  await page.waitForTimeout(2500);

  /** Sets models out in rows beside bloombot (world units), facing the camera. Returns nothing; removes the last set. */
  const layout = (rows) =>
    page.evaluate((rows) => {
      const g = window.solarbloom;
      g.__e23?.destroy();
      const Entity = g.bot.visuals.root.constructor; // pc.Entity
      const holder = new Entity('e23-check');
      g.bot.visuals.root.parent.addChild(holder);
      g.__e23 = holder;
      const p = g.bot.visuals.root.getPosition();
      // across the screen and away from the camera, on the ground plane (from the camera entity itself)
      const cam = g.app.root.findComponents('camera')[0].entity;
      const r = cam.right, f = cam.forward;
      const rl = Math.hypot(r.x, r.z) || 1, fl = Math.hypot(f.x, f.z) || 1;
      const ax = r.x / rl, az = r.z / rl;
      const bx = f.x / fl, bz = f.z / fl;
      const faceYaw = (Math.atan2(-bx, -bz) * 180) / Math.PI; // models' front (+Z) toward the camera
      holder.setPosition(p.x, p.y, p.z);
      holder.setEulerAngles(0, 0, 0);
      rows.forEach((row, ri) => {
        row.items.forEach((it, i) => {
          const e = g.models.instantiate(it.name);
          if (!e) return;
          const across = (i - (row.items.length - 1) / 2) * row.gap;
          const away = row.away;
          e.setLocalPosition(ax * across + bx * away, 0, az * across + bz * away);
          e.setLocalEulerAngles(0, faceYaw, 0);
          if (it.scale) e.setLocalScale(it.scale, it.scale, it.scale);
          if (it.hideFruit) {
            const fruit = e.findByName('fruit');
            if (fruit) fruit.enabled = false;
          }
          holder.addChild(e);
        });
      });
    }, rows);

  // 1. machines and props
  await layout([{ away: 1.6, gap: 1.6, items: MACHINES.map((name) => ({ name })) }]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/e23-models-machines.png` });

  // 2. crops: ripe (back row) and growing (front row: fruit hidden, scaled down) in two sets of eight
  for (const [k, set] of [CROPS.slice(0, 8), CROPS.slice(8)].entries()) {
    await layout([
      { away: 2.6, gap: 0.95, items: set.map((name) => ({ name })) },
      { away: 1.2, gap: 0.95, items: set.map((name) => ({ name, scale: 0.65, hideFruit: true })) },
    ]);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${dir}/e23-models-crops-${k + 1}.png` });
    const fruit = await page.evaluate((set) => set.map((n) => [n, !!window.solarbloom.models.instantiate(n)?.findByName('fruit')]), set);
    console.log('  fruit part:', fruit.map(([n, f]) => `${n.slice(5)} ${f ? 'yes' : 'no'}`).join(', '));
  }
  await page.evaluate(() => window.solarbloom.__e23?.destroy());

  // 3. bloombot's new clips (E23.2.3): each plays in the game; a frame part-way through each
  const lengths = await page.evaluate((clips) => clips.map((c) => [c, window.solarbloom.bot.visuals.clips.get(c) ?? 0]), CLIPS);
  for (const [c, len] of lengths) check(len > 0, `bloombot clip ${c} is in the game (${len.toFixed(2)} s)`);
  // bloombot turned three-quarters toward the camera, so each pose reads
  await page.evaluate(() => {
    const g = window.solarbloom;
    const f = g.app.root.findComponents('camera')[0].entity.forward;
    g.bot.pose.facing = Math.atan2(-f.x, -f.z) + 0.6;
  });
  await page.waitForTimeout(800);
  for (const [c, len] of lengths) {
    if (!len) continue;
    await page.evaluate((c) => window.solarbloom.bot.visuals.play(c), c);
    await page.waitForTimeout(Math.min(len * 1000 * 0.6, 4000));
    await page.screenshot({ path: `${dir}/e23-clip-${c}.png`, clip: { x: 340, y: 150, width: 600, height: 500 } });
    await page.waitForTimeout(len * 1000 * 0.5 + 400);
  }
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
  await server.close();
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
