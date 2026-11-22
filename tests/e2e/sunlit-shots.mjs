// E27.1 (#679): the sunlit look from the follow camera, in docs/review/e27-679/ (or argv[2]).
// `npm run build` first, then `GPU=1 node tests/e2e/sunlit-shots.mjs [outDir]`.
// A new game with the ground around Bloombot's start restored to full bloom (and a dead stretch beside it), shot
// from the follow camera at morning, noon, afternoon, dusk and midnight, on High (1920 × 1080) and on the Deck
// (1280 × 800, ?gfx=deck). For each shot it logs what the tuning is judged on: how much of the picture clips to
// white, how bright it is on average, how much light and shade there is (the spread of brightness), and how
// saturated the greens are. It fails if a sunlit shot clips or the greens go fluorescent, or if night stops being
// a readable blue.
//   TAG=before     name the shots (default: after)
//   LOOKSET='{…}'  a JSON patch merged into LOOK before the shots (tuning experiments; e.g. '{"bloom":{"intensity":0}}')
//   QUICK=1        High only, noon and midnight
// Looking out to sea at noon, dusk and midnight it also measures the horizon: the biggest brightness step between
// rows where the sea meets the sky (#683 took the skyline away; the far sea must fade into the sky, not cut off).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/e27-679';
mkdirSync(dir, { recursive: true });
const TAG = process.env.TAG ?? 'after';
const LOOKSET = process.env.LOOKSET ? JSON.parse(process.env.LOOKSET) : undefined;
const QUICK = !!process.env.QUICK;
const server = await preview({ preview: { port: 4241, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
const SIZES = [
  { name: 'high', width: 1920, height: 1080, query: '&gfx=high' },
  { name: 'deck', width: 1280, height: 800, query: '&gfx=deck' },
];
const TIMES = QUICK ? { noon: 0.3, midnight: 0.83 } : { morning: 0.1, noon: 0.3, afternoon: 0.5, dusk: 0.655, midnight: 0.83 };
const fail = (msg) => {
  failed = true;
  console.error(`    ✗ ${msg}`);
};
try {
  for (const size of QUICK ? SIZES.slice(0, 1) : SIZES) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.setDefaultTimeout(300_000);
    await page.goto(`http://localhost:4241/?slot=1${size.query}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.solarbloom && !!window.solarbloom.sim);
    await page.waitForTimeout(3000);
    await page.addStyleTag({ content: '#hud, .toast, #toasts { display: none !important; }' });
    // the spots: Bloombot's start with the ground around it restored to full bloom, and the dead ground just past it
    const spots = await page.evaluate((patch) => {
      const g = window.solarbloom;
      const s = g.sim;
      if (patch) {
        const merge = (a, b) => {
          for (const [k, v] of Object.entries(b)) if (v && typeof v === 'object' && !Array.isArray(v)) merge((a[k] ??= {}), v);
          else a[k] = v;
        };
        merge(g.look.cfg, patch);
        g.look.apply();
      }
      const p = g.bot.pose;
      const x0 = Math.round(p.x);
      const z0 = Math.round(p.z);
      for (let dz = -9; dz <= 9; dz++)
        for (let dx = -9; dx <= 5; dx++) {
          const t = s.grid.get('g', x0 + dx, z0 + dz);
          if (!t || t.feature === 'water' || !s.areas.canTouch(t)) continue;
          t.ground = 'restored';
          t.bloom = 3;
          t.pollution = 0;
          s.grid.touch(t);
          g.chunks.markTile(t);
        }
      // the dead ground: the nearest open stretch (no water, walls or restored ground within 3 tiles) past the lush block
      const open = (x, z) => {
        for (let dz = -3; dz <= 3; dz++)
          for (let dx = -3; dx <= 3; dx++) {
            const t = s.grid.get('g', x + dx, z + dz);
            if (!t || t.feature === 'water' || t.blocked || t.occupantId || t.ground === 'restored' || !s.areas.canTouch(t)) return false;
          }
        return true;
      };
      let dead = [x0 + 8, z0 + 2];
      let best = Infinity;
      for (let z = z0 - 30; z <= z0 + 30; z++)
        for (let x = x0 - 30; x <= x0 + 30; x++) {
          const d = Math.hypot(x - x0, z - z0);
          if (d < 12 || d >= best || !open(x, z)) continue;
          best = d;
          dead = [x, z];
        }
      return { lush: [x0 - 2, z0], dead, sea: [p.x, p.z] };
    }, LOOKSET);
    const at = (f) =>
      page.evaluate((f) => {
        const s = window.solarbloom.sim;
        s.weather.forceForTest('sunny', 1e9);
        (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
        s.lights.dark = s.power.sky().dark;
      }, f);
    const shot = async (name, [x, z], yaw) => {
      await page.evaluate(({ x, z, yaw }) => {
        const g = window.solarbloom;
        g.bot.teleport('g', x, z);
        g.bot.following = true;
        g.camera.turnTo(yaw);
        for (let i = 0; i < 300; i++) g.camera.update(0.05);
      }, { x, z, yaw });
      // the grade follows the restoration in view over a few seconds: let it find its target, then settle there
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.solarbloom.look.snapMood());
      await page.waitForTimeout(3500);
      const file = `${dir}/${TAG}-${name}-${size.name}.png`;
      const png = await page.screenshot({ path: file });
      const m = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 200;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, 320, 200);
        const d = x.getImageData(0, 0, 320, 200).data;
        const n = d.length / 4;
        let clip = 0, sum = 0, sq = 0, gSat = 0, gN = 0, gHot = 0;
        const mean = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], gr = d[i + 1], b = d[i + 2];
          const y = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
          sum += y;
          sq += y * y;
          mean[0] += r;
          mean[1] += gr;
          mean[2] += b;
          if (Math.max(r, gr, b) >= 250) clip++;
          // greens: green leads both other channels
          if (gr > r && gr > b) {
            const mx = gr, mn = Math.min(r, b);
            const sat = mx ? (mx - mn) / mx : 0;
            gSat += sat;
            gN++;
            if (sat > 0.6 && mx > 200) gHot++; // bright and strongly saturated: the fluorescent look
          }
        }
        // the horizon over the open sea (#683 took the skyline away): the biggest step in brightness from one row to
        // the next across the band where the sea meets the sky, on the right of the picture (away from the coast)
        let horizon = 0;
        const rowLum = (y) => {
          let t = 0;
          for (let x = 176; x < 304; x++) {
            const k = (y * 320 + x) * 4;
            t += 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
          }
          return t / 128;
        };
        for (let y = 41; y < 76; y++) horizon = Math.max(horizon, Math.abs(rowLum(y) - rowLum(y - 1)));
        const avg = sum / n;
        return {
          horizon,
          clip: (100 * clip) / n,
          lum: avg,
          spread: Math.sqrt(Math.max(0, sq / n - avg * avg)),
          greenSat: gN ? gSat / gN : 0,
          greenHot: gN ? (100 * gHot) / gN : 0,
          mean: mean.map((v) => Math.round(v / n)),
        };
      }, png.toString('base64'));
      console.log(`  ${file}  horizon step ${m.horizon.toFixed(0)}  clip ${m.clip.toFixed(1)}%  lum ${m.lum.toFixed(0)}  spread ${m.spread.toFixed(0)}  green sat ${m.greenSat.toFixed(2)} (hot ${m.greenHot.toFixed(1)}%)  mean ${m.mean.join(',')}`);
      return m;
    };
    const day = {};
    for (const [name, f] of Object.entries(TIMES)) {
      await at(f);
      const lush = await shot(`${name}-lush`, spots.lush, 0);
      if (name !== 'midnight') await shot(`${name}-dead`, spots.dead, 0);
      // looking out to sea from the start (as #683's shots do): the far sea and coast fade into the sky, no hard line
      if (name === 'noon' || name === 'dusk' || name === 'midnight') {
        const sea = await shot(`${name}-sea`, spots.sea, 200);
        if (TAG !== 'before' && sea.horizon > 20) fail(`${name}: the sea meets the sky in a hard line (a step of ${sea.horizon.toFixed(0)})`);
      }
      if (name === 'noon') day.noon = lush;
      if (TAG === 'before') continue;
      if (name === 'midnight') {
        const share = lush.lum / day.noon.lum;
        console.log(`    midnight is ${(share * 100).toFixed(0)}% as bright as noon; blue − red = ${lush.mean[2] - lush.mean[0]}`);
        if (lush.mean[2] <= lush.mean[0] || share < 0.3) fail(`${name}: not a readable blue night`);
      } else if (name !== 'dusk') {
        if (lush.clip > 1) fail(`${name}: ${lush.clip.toFixed(1)}% of the picture clips to white`);
        if (lush.greenHot > 5) fail(`${name}: ${lush.greenHot.toFixed(1)}% of the greens are fluorescent`);
      }
    }
    if (errors.length) fail('page errors:\n' + [...new Set(errors)].slice(0, 5).join('\n'));
    await page.close();
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failed ? 'FAILED' : 'all good');
process.exit(failed ? 1 : 0);
