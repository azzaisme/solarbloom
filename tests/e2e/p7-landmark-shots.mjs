// P7-E31 (#717): the Sea Lock, Saltwind's landmark by the start, in its three looks, from fixed cameras.
//
// Stages (data/landmarks landmarkStage):
//   ruined     a fresh game
//   restoring  most of Saltwind restored round the start, not yet woken (the lock ready to wake)
//   thriving   Saltwind restored and its landmark woken (as p7-shots' mid/late do), its vault forced open
// Cameras:
//   lock   Bloombot on the sand south of the lock, looking up the beach at its sea face (the beacon to its right)
//   third  the game's opening follow camera at the start (as p7-shots A)
//   iso    the high overview (as p7-shots B)
//
// node tests/e2e/p7-landmark-shots.mjs [outDir]   (build first: npx vite build)
// STAGES=ruined,restoring,thriving  CAMS=lock,third,iso  ONLY=day,golden,night  DIST=<dir>  RENDER_MS=9000
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { CHROME_ARGS, measure, openGame, placeCam, setTime, shoot, TIMES as ALL } from './lib/p7-scene.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const dir = process.argv[2] ?? 'docs/review/p7/e31';
mkdirSync(dir, { recursive: true });
const TIMES = Object.fromEntries(Object.entries(ALL).filter(([k]) => (process.env.ONLY ?? 'day').split(',').includes(k)));
const STAGES = (process.env.STAGES ?? 'ruined,restoring,thriving').split(',');
const CAMS = (process.env.CAMS ?? 'lock,third,iso').split(',');
const LOCK = { at: [-6.4, 44.6], look: [0.12, -1] };
const port = +(process.env.PORT ?? 4253);
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: CHROME_ARGS });
const metrics = {};
let failed = false;

/** Restores Saltwind's tiles (a share of them for `restoring`), and for `thriving` wakes its landmark. */
const setStage = (page, stage) =>
  page.evaluate((stage) => {
    const g = window.solarbloom;
    const s = g.sim;
    if (stage === 'ruined') return;
    s.gates.open('g-saltwind', true);
    const area = s.areas.areaOf({ roofId: 'g', x: -6, z: 40 });
    let i = 0;
    for (let z = 16; z <= 48; z++)
      for (let x = -16; x <= 16; x++) {
        if (s.areas.areaOf({ roofId: 'g', x, z }) !== area) continue;
        const t = s.grid.peek('g', x, z);
        if (!t || t.blocked || t.occupantId || t.ramp || t.feature === 'water') continue;
        // restoring: about two tiles in three (past the landmark's need, short of every tile)
        if (stage === 'restoring' && i++ % 3 === 2) continue;
        t.ground = 'restored';
        t.bloom = 4;
        t.pollution = 0;
        s.grid.touch(t);
        g.chunks.markTile(t);
        s.bus.emit('tile.restored', { tile: t });
      }
    if (stage === 'thriving') {
      if (s.state.areas[area]) s.state.areas[area].sealed = false;
      s.areas.clear(area, true);
      // and Saltwind's vault forced (Pry II): it shows as a garden outpost
      if (!s.state.salvage.caches.includes('v-saltwind')) s.state.salvage.caches.push('v-saltwind');
      const v = s.grid.peek('g', 11, 31);
      if (v) g.chunks.markTile(v);
    }
  }, stage);

const placeLock = (page, zoom0) =>
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
    { v: LOCK, zoom0 },
  );

try {
  for (const stage of STAGES) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openGame(page, port, process.env.GFX ?? 'high', stage);
    const start = await page.evaluate(() => [window.solarbloom.bot.pose.x, window.solarbloom.bot.pose.z]);
    await setStage(page, stage);
    for (const [time, f] of Object.entries(TIMES)) {
      await setTime(page, f, stage === 'ruined' ? 3000 : 8000);
      const zoom0 = await page.evaluate(() => window.solarbloom.camera.zoom);
      for (const cam of CAMS) {
        if (cam === 'lock') await placeLock(page, zoom0);
        else await placeCam(page, cam, start, zoom0);
        const name = `${stage}-${time}-${cam}`;
        const { shot, stats } = await shoot(page, `${dir}/${name}.png`, { renderMs: +(process.env.RENDER_MS ?? 9000) });
        const look = await page.evaluate(() => {
          const g = window.solarbloom;
          const lm = g.sim.areas.landmark(g.sim.areas.areaOf({ roofId: 'g', x: -6, z: 40 }));
          const d = lm && g.machines.view(lm.id)?.dress;
          return d ? { stage: d.stage, k: +d.k.toFixed(2), ready: d.ready } : null;
        });
        metrics[name] = { ...(await measure(page, shot)), ...stats, look };
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
