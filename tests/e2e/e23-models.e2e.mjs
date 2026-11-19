// E23.10.2 (#406, #464–#468): the E23 models and bloombot's new clips in the real game, headless (swiftshader).
// `npm run test:e23models` (builds first). A new Old City game; checks every E23 model on disk loaded in the
// game's ModelLibrary, sets them out beside bloombot in the park (machines, then each crop ripe and growing),
// plays each new bloombot clip, and saves screenshots to docs/review/e23-models-*.png. Look at them: this proves
// the files load and draw in the engine. Placing them for real is each system's job (E23.3, E23.5, E23.2.3).
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const MACHINES = ['charger', 'compost-bin', 'watering-can'];
const B1 = ['battery', 'wind-turbine', 'large-solar-array', 'pump', 'desalination-plant', 'sprinkler', 'feed-tank'];
const CROPS = ['seedling', 'radish', 'lettuce', 'potato', 'beans', 'tomato', 'sweetcorn', 'pumpkin', 'sunflower', 'watercress', 'rice', 'lavender', 'mint', 'moonflower', 'flowers', 'sea-kale'].map((c) => `crop-${c}`);
const B2 = ['bio-digester', 'greenhouse', 'beehive', 'mushroom-log', 'hedgehog-house', 'bird-box', 'bat-box'];
const STYLES = ['picket', 'willow', 'pipe', 'stone', 'hedge'];
const FENCES = [...STYLES.flatMap((s) => ['run', 'post', 'gate'].map((p) => `fence-${s}-${p}`)), 'trellis'];
// B4: the animals live in assets/raw/models/visitors/ (the wildlife visitors load them, #544); fed in by hand here
const ANIMALS = ['fox', 'hedgehog', 'squirrel', 'otter', 'owl', 'magpie', 'frog', 'bumblebee', 'songbird', 'koi', 'heron', 'badger', 'kingfisher', 'butterfly', 'swallowtail', 'fawn'];
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

  const loaded = await page.evaluate((names) => names.map((n) => [n, window.solarbloom.models.has(n)]), [...MACHINES, ...B1, ...B2, ...FENCES, ...CROPS]);
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
          const e = it.animal ? g.__animals[it.name]?.resource.instantiateRenderEntity() : g.models.instantiate(it.name);
          if (!e) return;
          const across = (i - (row.items.length - 1) / 2) * row.gap;
          const away = row.away;
          e.setLocalPosition(ax * across + bx * away, 0, az * across + bz * away);
          e.setLocalEulerAngles(0, faceYaw, 0);
          if (it.clip) {
            const clip = g.__animals[it.name].resource.animations.find((c) => (c.resource?.name ?? c.name) === it.clip);
            e.addComponent('anim', { activate: true });
            e.anim.assignAnimation(it.clip, clip.resource);
          }
          if (it.at !== undefined) e.setLocalPosition(ax * it.at + bx * row.away, 0, az * it.at + bz * row.away);
          if (it.scale) e.setLocalScale(it.scale, it.scale, it.scale);
          if (it.open) {
            const gate = e.findByName('gate');
            if (gate) gate.setLocalEulerAngles(0, it.open, 0);
          }
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

  // 1b. batch B1, the small machines: battery, pump, sprinkler, feed tank (one tile each), close in
  await layout([{ away: 1.3, gap: 1.05, items: ['battery', 'pump', 'sprinkler', 'feed-tank'].map((name) => ({ name })) }]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/e23-models-power-water.png` });
  // 1c. the big ones: wind turbine (4 m), solar array, desalination plant, with the camera pulled back
  await page.evaluate(() => window.solarbloom.camera.zoomTo(1.2));
  await page.waitForTimeout(2500);
  await layout([{ away: 3.2, gap: 3.0, items: ['wind-turbine', 'large-solar-array', 'desalination-plant'].map((name) => ({ name })) }]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/e23-models-power-water-big.png` });
  await page.evaluate(() => window.solarbloom.camera.zoomTo(window.solarbloom.camera.minZoom));
  await page.waitForTimeout(2500);

  // 1d. batch B2 (farm): the small ones close, then the bio-digester and the greenhouse pulled back
  await layout([{ away: 1.4, gap: 1.0, items: ['beehive', 'mushroom-log', 'hedgehog-house', 'bird-box', 'bat-box'].map((name) => ({ name })) }]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/e23-models-farm.png` });
  await page.evaluate(() => window.solarbloom.camera.zoomTo(1.2));
  await page.waitForTimeout(2500);
  await layout([{ away: 3.0, gap: 3.2, items: ['bio-digester', 'greenhouse'].map((name) => ({ name })) }]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/e23-models-farm-big.png` });

  // 1e. the fences (#466): each style a short run along tile edges (post, run, gate opened 70°, run, post), the
  // trellis beside them, by day and by night (the clock pinned to noon, then to midnight)
  const fenceRows = STYLES.map((st, r) => ({
    away: 1.2 + r * 1.25,
    gap: 1,
    items: [
      { name: `fence-${st}-post`, at: -1.5 }, { name: `fence-${st}-run`, at: -1 }, { name: `fence-${st}-post`, at: -0.5 },
      { name: `fence-${st}-gate`, at: 0, open: r % 2 ? 0 : 70 }, { name: `fence-${st}-post`, at: 0.5 }, { name: `fence-${st}-run`, at: 1 },
      { name: `fence-${st}-post`, at: 1.5 }, ...(r === 2 ? [{ name: 'trellis', at: 2.6 }] : []),
    ],
  }));
  await layout(fenceRows);
  for (const [when, hour] of [['day', 12], ['night', 0]]) {
    await page.evaluate((hour) => {
      const c = window.solarbloom.sim.clock;
      c.now = () => new Date(2026, 10, 19, hour, 0);
      c.real = true;
    }, hour);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${dir}/e23-models-fences-${when}.png` });
  }
  await page.evaluate(() => (window.solarbloom.sim.clock.real = false));
  const gateParts = await page.evaluate((st) => st.map((s) => !!window.solarbloom.models.instantiate(`fence-${s}-gate`)?.findByName('gate')), STYLES);
  check(gateParts.every(Boolean), `every fence gate has its swinging part (${gateParts.join(', ')})`);

  // 1g. farmland ground (#466): an irregular field in front of bloombot, a band of each state (dry, watered,
  // fertilised from left to right), its edges fading into the ground; by day and by night
  await page.evaluate(() => window.solarbloom.__e23?.destroy());
  await page.evaluate(() => window.solarbloom.camera.zoomTo(0.9));
  await page.waitForTimeout(2500);
  const field = await page.evaluate(() => {
    const g = window.solarbloom;
    const p = g.bot.visuals.root.getPosition();
    const f = g.app.root.findComponents('camera')[0].entity.forward;
    const fl = Math.hypot(f.x, f.z) || 1;
    const cx = Math.floor(p.x + (f.x / fl) * 4), cz = Math.floor(p.z + (f.z / fl) * 4);
    const tiles = [];
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -4; dx <= 4; dx++) {
        if ((dz === -2 && dx > 2) || (dz === 2 && dx < -2) || (dz === 2 && dx === 4)) continue; // a ragged outline
        tiles.push({ x: cx + dx, z: cz + dz, y: p.y, state: dx < -1 ? 'dry' : dx < 2 ? 'watered' : 'fertilised' });
      }
    g.farmland.set(tiles);
    return { n: tiles.length, parts: g.farmland.root.children.length };
  });
  check(field.n > 30 && field.parts === 3, `farmland draws a field in all three states (${field.n} tiles, ${field.parts} meshes)`);
  for (const [when, hour] of [['day', 12], ['night', 0]]) {
    await page.evaluate((hour) => {
      const c = window.solarbloom.sim.clock;
      c.now = () => new Date(2026, 10, 19, hour, 0);
      c.real = true;
    }, hour);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${dir}/e23-farmland-${when}.png` });
  }
  await page.evaluate(() => {
    window.solarbloom.sim.clock.real = false;
    window.solarbloom.farmland.set([]);
  });

  // 1f. batch B4: the animals, fed in from assets/raw/models/visitors/ (16 GLBs, as #544 loads them)
  const files = Object.fromEntries(ANIMALS.map((n) => [n, readFileSync(`assets/raw/models/visitors/${n}.glb`).toString('base64')]));
  const got = await page.evaluate(async (files) => {
    const g = window.solarbloom;
    g.__animals = {};
    await Promise.all(Object.entries(files).map(([n, b64]) => new Promise((done) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bin], { type: 'model/gltf-binary' }));
      g.app.assets.loadFromUrlAndFilename(url, `${n}.glb`, 'container', (err, asset) => {
        if (!err && asset) g.__animals[n] = asset;
        done();
      });
    })));
    return Object.keys(g.__animals);
  }, files);
  for (const n of ANIMALS) check(got.includes(n), `animal ${n} loads in the game`);
  const clipNames = await page.evaluate(() => Object.entries(window.solarbloom.__animals).map(([n, a]) => [n, a.resource.animations.map((c) => c.resource?.name ?? c.name).sort().join(',')]));
  for (const [n, c] of clipNames) check(c === 'climb,follow,idle,sit', `animal ${n} has its clips in the game (${c})`);
  await page.evaluate(() => window.solarbloom.camera.zoomTo(window.solarbloom.camera.minZoom));
  await page.waitForTimeout(2500);
  for (const [k, set] of [ANIMALS.slice(0, 8), ANIMALS.slice(8)].entries()) {
    // the first eight in their idle, the rest in their sit (each clip running in the engine)
    await layout([{ away: 1.6, gap: 0.85, items: set.map((name) => ({ name, animal: true, clip: k ? 'sit' : 'idle' })) }]);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${dir}/e23-models-animals-${k + 1}.png` });
  }

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
