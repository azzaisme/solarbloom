// Phase 7 (P7-E27.7): live lighting tuning against the fixed cameras without rebuilding or reloading the world.
//   npm run build, then node tests/e2e/p7-tune.mjs <workDir>           STAGE=mid (default) GFX=high PORT=4252
// Loads one stage once, then watches <workDir>/queue for request files (JSON), oldest first:
//   { "name": "sky-a", "cams": ["third", "shore"], "time": "day", "js": "L.exposure = 1.0; S.zenith[1] = '#4f8fe0'" }
// `js` runs in the page with L = look.cfg (data/look.ts), S = look.sky, H = look.haze, D = look.day,
// B = look.skyBands, N = look.skyNight and g = window.solarbloom, then look.apply() re-reads everything.
// Changes persist across requests; `"reset": true` reloads the page first (back to the built values).
// Each shot goes to <workDir>/out/<name>-<cam>.png and a line of metrics to <workDir>/out/results.jsonl.
// A file named `stop` in the queue ends the run.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { CHROME_ARGS, measure, openGame, placeCam, setStage, setTime, shoot, TIMES } from './lib/p7-scene.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const work = process.argv[2] ?? 'p7-tune';
const queue = `${work}/queue`;
const out = `${work}/out`;
mkdirSync(queue, { recursive: true });
mkdirSync(out, { recursive: true });
const STAGE = process.env.STAGE ?? 'mid';
const port = +(process.env.PORT ?? 4252);
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: CHROME_ARGS });

let page;
let start;
let zoom0;
let time;
const errors = [];
async function load() {
  await page?.close();
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await openGame(page, port, process.env.GFX ?? 'high', STAGE);
  start = await setStage(page, STAGE);
  time = undefined;
  zoom0 = await page.evaluate(() => window.solarbloom.camera.zoom);
  console.log(`ready (${STAGE})`);
}

await load();
try {
  for (;;) {
    if (existsSync(`${queue}/stop`)) break;
    const files = readdirSync(queue).filter((f) => f.endsWith('.json')).sort((a, b) => statSync(`${queue}/${a}`).mtimeMs - statSync(`${queue}/${b}`).mtimeMs);
    if (!files.length) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    const file = `${queue}/${files[0]}`;
    let req;
    try {
      req = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.error(`bad request ${file}: ${e}`);
      unlinkSync(file);
      continue;
    }
    unlinkSync(file);
    const name = req.name ?? files[0].replace(/\.json$/, '');
    try {
      if (req.reset) await load();
      const t = req.time ?? 'day';
      if (t !== time) {
        await setTime(page, TIMES[t] ?? +t, 6000);
        time = t;
      }
      if (req.js) {
        await page.evaluate((js) => {
          const g = window.solarbloom;
          const l = g.look;
          new Function('g', 'L', 'S', 'H', 'D', 'B', 'N', js)(g, l.cfg, l.sky, l.haze, l.day, l.skyBands, l.skyNight);
          l.apply();
        }, req.js);
      }
      for (const cam of req.cams ?? ['third']) {
        await placeCam(page, cam, start, zoom0);
        const { shot, stats } = await shoot(page, `${out}/${name}-${cam}.png`, { renderMs: req.renderMs ?? 7000 });
        const m = { name, cam, ...(await measure(page, shot)), ...stats };
        appendFileSync(`${out}/results.jsonl`, JSON.stringify(m) + '\n');
        console.log(JSON.stringify(m));
      }
      if (req.eval) {
        const v = await page.evaluate((js) => new Function('g', js)(window.solarbloom), req.eval);
        appendFileSync(`${out}/results.jsonl`, JSON.stringify({ name, eval: v }) + '\n');
        console.log(JSON.stringify({ name, eval: v }));
      }
    } catch (e) {
      console.error(`request ${name} failed: ${e}`);
      appendFileSync(`${out}/results.jsonl`, JSON.stringify({ name, error: String(e) }) + '\n');
    }
    if (errors.length) console.error(`page errors: ${[...new Set(errors.splice(0))].slice(0, 4).join(' | ')}`);
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
