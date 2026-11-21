// #648: the stone retaining walls by the water, close up, on every graphics tier (1280 × 800, UI at 150%). Reports
// what anti-aliasing each tier really draws with (MSAA samples on the CameraFrame target, or the canvas's own), the
// render scale, and saves a whole frame and a close crop of the wall's top and its foot in the water.
//   npm run build && GPU=1 node tests/e2e/wall-edges-shots.mjs [outDir] [label]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/wall-edges';
const label = process.argv[3] ?? 'after';
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 4228);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};
const views = [
  // on the cliff above the sea wall east of the beach, looking along it: the coping, the face and the waterline below
  { name: 'cliff', x: 26.5, z: 46.5, facing: -Math.PI / 2 - 0.5, yaw: 0, zoom: 0.9 },
  // on the jetty, looking east along the sea wall under the cliff (the owner's view: wall top, face and waterline)
  { name: 'seawall', x: 9.5, z: 47.5, facing: Math.PI / 2 + 0.25, yaw: 0, zoom: 0.35 },
  // on the beach by the Saltwind canal, looking along its wall
  { name: 'canal', x: 11.5, z: 44.5, facing: Math.PI / 2 - 0.2, yaw: 0, zoom: 0.35 },
];
try {
  for (const tier of ['low', 'medium', 'high', 'deck']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.setDefaultTimeout(240_000);
    await startGame(page, `http://localhost:${port}`, { slot: 3, query: `gfx=${tier}`, settings: { uiScale: 150 } });
    await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      g.pause.clear('blur');
      s.weather.forceForTest('sunny', 1e9);
      (s.state.clock ??= { offset: 0 }).offset += (0.4 - s.clock.dayFraction()) * 2880;
      for (const id of [s.areas.map.areaOfCell(22, 46), s.areas.map.areaOfCell(-3, 30)]) if (s.areas.fog(id) === 'hidden') s.gates.openRegion(id);
    });
    await page.addStyleTag({ content: '#obj, #toasts, .toast { visibility: hidden !important; }' });
    const info = await page.evaluate(() => {
      const g = window.solarbloom;
      const dev = g.app.graphicsDevice;
      const f = g.look.post.frame;
      const rt = f?.renderPassCamera?.rt;
      return {
        post: !!f,
        frameSamples: f?.rendering?.samples,
        rtSamples: rt?.samples,
        rtFormat: rt?.colorBuffer?.format,
        canvasAA: dev.gl?.getContextAttributes?.().antialias,
        canvasSamples: dev.gl?.getParameter?.(dev.gl.SAMPLES),
        maxSamples: dev.maxSamples,
        dpr: dev.maxPixelRatio,
        canvas: `${dev.width}×${dev.height}`,
        taa: f?.taa?.enabled,
        fxaa: g.look.post.fxaaOn ?? false,
      };
    });
    console.log(`${tier}: ${JSON.stringify(info)}`);
    const aa = info.post ? (info.rtSamples ?? 1) > 1 || info.fxaa : (info.canvasSamples ?? 0) > 1 || info.canvasAA;
    check(!!aa, `${tier}: edges are smoothed (${info.post ? `CameraFrame target ${info.rtSamples}× MSAA${info.fxaa ? ' + FXAA' : ''}` : `canvas ${info.canvasSamples}× MSAA`})`);
    for (const v of views) {
      await page.evaluate((v) => {
        const g = window.solarbloom;
        g.bot.teleport('g', v.x, v.z);
        Object.assign(g.bot.pose, { x: v.x, z: v.z, facing: v.facing });
        g.camera.turnTo((v.facing * 180) / Math.PI + 180 + v.yaw, true);
        g.camera.jumpZoom?.(g.camera.minZoom + (g.camera.maxZoom - g.camera.minZoom) * v.zoom);
      }, v);
      await page.waitForTimeout(2500);
      const path = `${dir}/${label}-${tier}-${v.name}`;
      await page.screenshot({ path: `${path}.png` });
      // the right half, low: where the wall's top and foot run off at a slant
      await page.screenshot({ path: `${path}-close.png`, clip: { x: 760, y: 300, width: 330, height: 130 } });
      console.log(`  · ${path}.png`);
    }
    check(!errors.length, `${tier}: no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
