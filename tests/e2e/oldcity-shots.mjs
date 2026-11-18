// E21: review shots of the Old City (a new old-city game) into docs/review/oldcity-*.png.
//   node tests/e2e/oldcity-shots.mjs park     the park's salvage piles at all three sizes, the Landing (E21.2, E21.26)
//   node tests/e2e/oldcity-shots.mjs city     the Old City overview and a close-up of each region type, beach included (E21.4)
//   node tests/e2e/oldcity-shots.mjs height   the park steps and beach, the embankment, the sea from the fountain (E21.24)
// `npm run shots:park` and `npm run shots:city` run the matching section after the classic shots.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}
const section = process.argv[2] ?? 'park';
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4197, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:4197/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  await page.addStyleTag({ content: '#hint, #intro, .toast, #toasts { display: none !important; }' });
  const rules = await page.evaluate(() => window.solarbloom.sim.state.rules);
  if (rules !== 'oldcity') throw new Error(`a new game should be an Old City, got ${rules}`);
  /** Points the camera at (x, z) from a yaw (degrees, 0 = looking north) and zoom, holds it, takes a shot. */
  const shot = async (name, x, z, zoom, yaw = 0, wait = 6000) => {
    await page.evaluate(({ x, z, zoom, yaw }) => {
      const g = window.solarbloom;
      g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
      g.camera.minZoom = 0.12;
      if (g.bot) g.bot.following = false;
      g.camera.glide(x, 0, z, zoom);
      g.camera.turnTo(yaw);
      for (let i = 0; i < 300; i++) g.camera.update(0.05);
    }, { x, z, zoom, yaw });
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${dir}/${name}.png` });
    console.log(`  ✓ ${dir}/${name}.png`);
  };
  if (section === 'park') {
    const sizes = await page.evaluate(() => window.solarbloom.sim.salvage && ['pk-s2', 'pk-s3', 'pk-s5'].map((id) => window.solarbloom.sim.salvage.left(id)));
    console.log('  piles small / medium / large hold', sizes.join(' / '));
    await shot('oldcity-park-piles', 11.5, 9, 1.25, 0);
    await shot('oldcity-park-large-pile', 13.5, 13, 1.7, 0);
    await shot('oldcity-park-overview', 8, 8, 0.7, 0);
    await shot('oldcity-landing', 8, 40, 1.0, 0);
    // half a pile: it shrinks as it empties
    await page.evaluate(() => {
      const s = window.solarbloom.sim;
      s.inventory.add('scrap', 0);
      for (let i = 0; i < 4; i++) s.salvage.salvage('pk-s5');
      window.solarbloom.chunks.markAll();
    });
    await shot('oldcity-park-large-pile-half', 13.5, 13, 1.7, 0);
  } else if (section === 'city') {
    // open every region and backstreet and wake the landmarks, so the whole island shows
    const types = await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      s.state.salvage.tier = 4;
      s.state.salvage.abilities = ['pry', 'hover', 'climb', 'glide'];
      s.state.progression.coreActivated = true;
      s.areas.clear('park', true);
      const ids = new Set();
      for (let cz = -6; cz <= 6; cz++) for (let cx = -6; cx <= 6; cx++) ids.add(s.areas.map.areaOfChunk(cx, cz));
      const byType = {};
      for (const id of ids) {
        if (id === 'sea' || id === 'park') continue;
        s.state.areas[id] = { fog: 'thinning', revealedAt: 0 };
        const info = s.areas.info(id);
        if (info.region) byType[info.type] ??= [info.landmark[0] + 1, info.landmark[1] + 1, info.region];
      }
      g.chunks.markAll();
      g.cloudWall?.sync?.();
      return byType;
    });
    await shot('oldcity-overview', 8, -8, 0.13, 0, 30000);
    for (const [type, [x, z, id]] of Object.entries(types)) await shot(`oldcity-region-${type}-${id}`, x, z, 0.9, 0, 8000);
  } else if (section === 'height') {
    await page.evaluate(() => {
      const s = window.solarbloom.sim;
      for (const id of ['mastRow', 'elderGrove', 'cistern', 'observatory', 'terraces']) s.state.areas[id] = { fog: 'thinning', revealedAt: 0 };
      window.solarbloom.chunks.markAll();
    });
    await shot('oldcity-height-park-steps', 8, 15, 1.2, 0);
    await shot('oldcity-height-steps-from-beach', 8, 16, 1.2, 180);
    await shot('oldcity-height-embankment', 26, -24, 1.0, 270);
    // from the fountain, turning the camera south shows the bay
    await shot('oldcity-height-sea-from-fountain', 8, 10, 0.9, 180);
    await shot('oldcity-height-elder-grove-hill', -18, -2, 0.8, 300);
    await shot('oldcity-height-cistern-basin', 56, 46, 0.55, 20);
    // the view from Observatory Hill, the highest ground, back over the city
    await shot('oldcity-height-from-observatory-hill', 64, -66, 0.35, 225);
  }
  if (section === 'keepers') {
    // E21.8: a sleeping Keeper (Tide, on the open beach), the same Keeper awake and speaking, and the Pylon settled
    await shot('oldcity-keeper-asleep', 10.5, 21, 1.7, 0);
    await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      g.bot.teleport('g', 10.5, 20.5);
      s.bot = { roofId: 'g', x: 10.5, z: 20.5 };
      s.keepers.pulse('tide');
      s.inventory.add('scrap', 6);
      s.keepers.interact('tide');
    });
    await shot('oldcity-keeper-awake', 10.5, 21, 1.7, 0, 2500);
    const step = await page.evaluate(() => window.solarbloom.sim.keepers.step('tide'));
    if (step !== 'request1') throw new Error(`Tide should be awake, is ${step}`);
  }
  if (errors.length) {
    failed = true;
    console.error('page errors:', errors.slice(0, 5));
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
if (failed) process.exit(1);
