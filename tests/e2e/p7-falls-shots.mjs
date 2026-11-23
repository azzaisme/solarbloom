// P7-E30 (#745): the showcase waterfall off the Falls overlook, framed on its own, and the overlook's view.
//   npx vite build && node tests/e2e/p7-falls-shots.mjs [outDir]          (default docs/review/p7/e30/falls)
// Stages as p7-shots (early: a fresh game, the fall a trickle; late: radius 20 restored round the spots, the overlook
// cleared and its source restored, the fall full). Cameras (the follow camera at the game's opening zoom):
//   beach     on the beach below, looking north up the canal at the fall
//   wide      from the east, up the beach: the fall, the bluff and the park's edge together
//   overlook  standing on the overlook, looking south over the beach to the sea
//   waste     the dead park close up, looking west (P7-E30's wasteland dressing)
// STAGES=early,late  CAMS=beach,wide,overlook  ONLY=day,golden,night  DIST=dist-base  STRIP_MS=… (a second frame
// that many ms later, to check the water moves)
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { CHROME_ARGS, measure, openGame, setStage, setTime, shoot, TIMES as ALL } from './lib/p7-scene.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/p7/e30/falls';
mkdirSync(dir, { recursive: true });
const TIMES = Object.fromEntries(Object.entries(ALL).filter(([k]) => (process.env.ONLY ?? 'day').split(',').includes(k)));
const STAGES = (process.env.STAGES ?? 'early,late').split(',');
const CAMS = (process.env.CAMS ?? 'beach,wide,overlook,waste').split(',');
const VIEWS = {
  beach: { at: [-2.2, 23.5], look: [0, -1], yaw: 0 },
  wide: { at: [5.5, 25.5], look: [-0.6, -1], yaw: 0 },
  overlook: { at: [-3.5, 13.5], look: [0.25, 1], yaw: 0 },
  // #758: dead ground close up (the park on a fresh game): cracks, broken path, debris
  waste: { at: [11.5, 9.5], look: [-1, -0.35], yaw: 0 },
};
const port = +(process.env.PORT ?? 4252);
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: CHROME_ARGS });
const metrics = {};
let failed = false;

/** The late stage also opens Elder Grove (its gate pried, the area cleared) and restores the fall's source. */
const openGrove = (page) =>
  page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.gates.open('g-elderGrove', true);
    const area = s.areas.areaOf({ roofId: 'g', x: -3, z: 13 });
    if (area) {
      if (s.state.areas[area]) s.state.areas[area].sealed = false;
      s.areas.clear(area, true);
    }
    for (let z = 10; z <= 15; z++)
      for (let x = -6; x <= 0; x++) {
        const t = s.grid.peek('g', x, z);
        if (!t || t.blocked || t.occupantId || t.ramp) continue;
        t.ground = 'restored';
        t.bloom = 4;
        t.pollution = 0;
        s.grid.touch(t);
        g.chunks.markTile(t);
      }
  });

const place = (page, v, zoom0) =>
  page.evaluate(
    ({ v, zoom0 }) => {
      const g = window.solarbloom;
      const c = g.camera;
      c.setZoom(zoom0);
      const [lx, lz] = v.look;
      g.bot.teleport('g', v.at[0], v.at[1]);
      g.bot.pose.facing = Math.atan2(lx, lz);
      g.bot.following = true;
      let best = 0;
      let bestDot = -2;
      const l0 = Math.hypot(lx, lz);
      for (let y = 0; y < 360; y += 5) {
        c.turnTo(y, true);
        c.update(0.016);
        const fw = c.entity.forward;
        const l = Math.hypot(fw.x, fw.z) || 1;
        const dot = (fw.x * lx + fw.z * lz) / l / l0;
        if (dot > bestDot) [bestDot, best] = [dot, y];
      }
      c.turnTo(best, true);
      for (let i = 0; i < 300; i++) c.update(0.05);
      return { pitch: c.pitch };
    },
    { v, zoom0 },
  );

try {
  for (const stage of STAGES) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openGame(page, port, process.env.GFX ?? 'high', stage);
    await setStage(page, stage);
    if (stage !== 'early') await openGrove(page);
    for (const [time, f] of Object.entries(TIMES)) {
      await setTime(page, f, stage === 'early' ? 3000 : 12000);
      const zoom0 = await page.evaluate(() => window.solarbloom.camera.zoom);
      for (const cam of CAMS) {
        if (cam === 'overlook' && stage === 'early') continue; // the grove is shut on a fresh game
        if (cam === 'waste' && stage !== 'early') continue; // dead ground: a fresh game
        await place(page, VIEWS[cam], zoom0);
        const name = `${stage}-${time}-${cam}`;
        const { shot, stats } = await shoot(page, `${dir}/${name}.png`, { renderMs: +(process.env.RENDER_MS ?? 9000) });
        if (process.env.STRIP_MS) {
          await page.evaluate(() => (window.solarbloom.app.autoRender = true));
          await page.waitForTimeout(+process.env.STRIP_MS);
          await page.screenshot({ path: `${dir}/${name}-b.png` });
          await page.evaluate(() => (window.solarbloom.app.autoRender = false));
        }
        metrics[name] = { ...(await measure(page, shot)), ...stats };
        console.log(`  ${name}: ${JSON.stringify(metrics[name])}`);
      }
    }
    if (errors.length) {
      failed = true;
      console.error(`  ✗ page errors (${stage}):\n` + [...new Set(errors)].slice(0, 6).join('\n'));
    }
    await page.close();
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  writeFileSync(`${dir}/metrics.json`, JSON.stringify(metrics, null, 2));
  await browser.close();
  server.httpServer.close();
}
console.log(failed ? 'FAILED' : 'all good');
process.exit(failed ? 1 : 0);
