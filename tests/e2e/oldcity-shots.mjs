// E21: review shots of the Old City (a new old-city game) into docs/review/oldcity-*.png.
//   node tests/e2e/oldcity-shots.mjs park     the park's salvage piles at all three sizes, the Landing (E21.2, E21.26)
//   node tests/e2e/oldcity-shots.mjs city     the Old City overview and a close-up of each region type, beach included (E21.4)
//   node tests/e2e/oldcity-shots.mjs height   the park steps and beach, the embankment, the sea from the fountain (E21.24)
//   node tests/e2e/oldcity-shots.mjs regions  each region dead, then restored, framed on its dressing (E23.8; REGIONS=a,b picks some)
//   node tests/e2e/oldcity-shots.mjs skyline  each region's landmark, seen from the fountain (E23.8)
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
  page.setDefaultTimeout(180_000); // a loaded machine (SwiftShader) can take minutes
  await page.goto('http://localhost:4197/?slot=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  await page.addStyleTag({ content: '#hint, #intro, .toast, #toasts { display: none !important; }' });
  if (!(await page.evaluate(() => !!window.solarbloom.sim.state.salvage))) throw new Error('a new game should be an Old City');
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
  if (section === 'regions' || section === 'skyline') {
    // E23.8 (#327–#329): every region open, every landmark standing (dormant), the park restored round the fountain
    await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      s.state.salvage.tier = 4;
      s.state.salvage.abilities = ['pry', 'hover', 'climb', 'glide'];
      s.areas.clear('park', true);
      for (let cz = -6; cz <= 6; cz++)
        for (let cx = -6; cx <= 6; cx++) {
          const id = s.areas.map.areaOfChunk(cx, cz);
          if (id !== 'sea' && id !== 'park' && !id.startsWith('out_')) s.state.areas[id] = { fog: 'thinning', revealedAt: 0 };
        }
      g.chunks.markAll();
      g.cloudWall?.sync?.();
    });
  }
  if (section === 'regions') {
    // each region dead, then restored, framed on its dressing (data/oldcity `dressing`)
    const ids = process.env.REGIONS?.split(',') ?? ['mastRow', 'oldMarket', 'saltwind', 'elderGrove', 'cistern', 'clockPlaza', 'terraces', 'glasshouse', 'observatory', 'spireHeights'];
    for (const id of ids) {
      const at = await page.evaluate((id) => {
        const s = window.solarbloom.sim;
        // the region's dressing cells, read off the ground (each tile carries `dress:<kind>:<turn>`)
        const cells = [];
        for (let z = -110; z < 110; z++)
          for (let x = -110; x < 110; x++) {
            const t = s.grid.peek('g', x, z);
            if (t?.prop?.startsWith('dress:') && s.areas.map.areaOfCell(x, z) === id) cells.push([x, z]);
          }
        if (!cells.length) return null;
        const cx = cells.reduce((a, c) => a + c[0], 0) / cells.length;
        const cz = cells.reduce((a, c) => a + c[1], 0) / cells.length;
        // the dressed cell nearest the middle: the camera looks there (the middle itself may be off the region)
        cells.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz));
        // a close look: the prop built from shapes if the region has one (they have no model to fall back on)
        const shaped = ['tram-rails', 'cable-pole', 'lantern-string', 'stump-ring', 'fallen-trunk', 'clockwork-heap'];
        const close = cells.find((c) => shaped.includes(s.grid.peek('g', c[0], c[1]).prop.split(':')[1])) ?? cells[0];
        return { x: cells[0][0] + 0.5, z: cells[0][1] + 0.5, n: cells.length, close: [close[0] + 0.5, close[1] + 0.5] };
      }, id);
      if (!at) {
        failed = true;
        console.log(`  ✗ ${id} has no dressing on the ground`);
        continue;
      }
      await shot(`region-${id}-dead`, at.x, at.z, 0.75, 20, 10000);
      await shot(`region-${id}-close`, at.close[0], at.close[1], 1.8, 20, 6000);
      // restored: the region's fog lifted and every open tile of it restored, flowering a little
      await page.evaluate((id) => {
        const g = window.solarbloom;
        const s = g.sim;
        s.areas.clear(id, true);
        for (const t of s.areas.tiles(id)) {
          if (t.blocked || t.occupantId || t.feature === 'water') continue;
          s.restoration.complete(t, 'pulse', undefined, true);
          t.bloom = Math.max(t.bloom, 2);
          s.grid.touch(t);
        }
        g.chunks.markAll();
      }, id);
      await shot(`region-${id}-restored`, at.x, at.z, 0.75, 20, 30000);
    }
  }
  if (section === 'skyline') {
    // each landmark from the fountain: the camera stands at the fountain and turns to face it
    // each region's landmark cell (data/oldcity REGIONS[].landmark)
    const LANDMARKS = [
      ['mastRow', 18, -26], ['oldMarket', 32, 14], ['saltwind', -6, 40], ['elderGrove', -20, -4], ['cistern', 56, 48],
      ['clockPlaza', 64, 4], ['terraces', 6, -52], ['glasshouse', -50, -10], ['observatory', 60, -66], ['spireHeights', -50, -66],
    ];
    const F = [8.5, 8.5]; // the fountain
    for (const [id, x, z] of LANDMARKS) {
      // yaw 0 looks north (−z), 180 south (+z), 90 west (−x): turn to face the landmark from the fountain
      const yaw = ((Math.atan2(-(x + 1 - F[0]), -(z + 1 - F[1])) * 180) / Math.PI + 360) % 360;
      await shot(`skyline-${id}`, F[0], F[1], 1.7, Math.round(yaw), 10000); // the low, near view: the horizon shows
    }
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
