// What 4× MSAA on Medium costs (#656), on the Deck preset (?gfx=deck: Medium at 0.75 render scale) and on Medium at
// full scale. A measuring tool, not a test: it isn't in the quick suite or CI, and it changes nothing in the game.
//
// It runs uncapped (no vsync, no frame-rate limit) so the frame interval shows the GPU's work, and switches the
// CameraFrame's samples live between 2 and 4 in the same view, alternating six A/B rounds so drift evens out. For each
// view and setting it prints the median and 95th-percentile frame interval, the frameupdate → frameend part of a frame
// (script plus render submission), and the GPU's own frame time where the browser exposes timer queries
// (EXT_disjoint_timer_query_webgl2, via PlayCanvas's gpuProfiler).
//
// On this PC (Windows): run it alone, through the heavy lock:
//   npm run build && bash ~/.solarbloom/heavy.sh "msaa perf" node tests/e2e/msaa-perf.mjs
//
// On a Steam Deck (Desktop Mode, Konsole), from a checkout of this repo:
//   1. Node 20 or later (for example from nvm), then: npm ci && npx playwright install chromium
//   2. npm run build && node tests/e2e/msaa-perf.mjs
//   Plug the Deck in and close Steam first: on battery, or with the game client running, the numbers drift.
//   Off Windows the script lets Chromium pick its own GL backend (ANGLE over GL or Vulkan on the Deck); set
//   ANGLE=vulkan (or gl, d3d11, swiftshader) to choose one. If the GPU line says SwiftShader, the run used the CPU
//   renderer and its numbers mean nothing: try ANGLE=gl. The PORT env var moves the preview server off 4232.
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const port = Number(process.env.PORT ?? 4232);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
// d3d11 on Windows; elsewhere Chromium's own choice unless ANGLE names one
const angle = process.env.ANGLE ?? (process.platform === 'win32' ? 'd3d11' : '');
const browser = await chromium.launch({
  args: [...(angle ? ['--use-gl=angle', `--use-angle=${angle}`] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-webgl-draft-extensions'],
});
const views = [
  // the start: the park, the fountain and the house, the follow camera
  { name: 'park', x: 8.5, z: 8.5, facing: Math.PI, zoom: 0.35 },
  // the sea wall under the cliff, the walls #656 changed, looking along them
  { name: 'seawall', x: 9.5, z: 47.5, facing: Math.PI / 2 + 0.25, zoom: 0.35 },
  // zoomed right out over the city: the most on screen
  { name: 'wide', x: 12.5, z: 30.5, facing: Math.PI, zoom: 1 },
];
const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return { med: +s[s.length >> 1].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2) };
};
try {
  for (const tier of ['deck', 'medium']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(240_000);
    await startGame(page, `http://localhost:${port}`, { slot: 3, query: `gfx=${tier}`, settings: { uiScale: 150 } });
    const env = await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      g.pause.clear('blur');
      s.weather.forceForTest('sunny', 1e9);
      (s.state.clock ??= { offset: 0 }).offset += (0.4 - s.clock.dayFraction()) * 2880;
      const dev = g.app.graphicsDevice;
      const gl = dev.gl;
      const timer = !!gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (timer && dev.gpuProfiler) dev.gpuProfiler.enabled = true;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return { canvas: `${dev.width}×${dev.height}`, dpr: dev.maxPixelRatio, samples: g.look.post.frame?.rendering?.samples, timer, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a' };
    });
    console.log(`${tier}: ${JSON.stringify(env)}`);
    for (const v of views) {
      await page.evaluate((v) => {
        const g = window.solarbloom;
        g.bot.teleport('g', v.x, v.z);
        Object.assign(g.bot.pose, { x: v.x, z: v.z, facing: v.facing });
        g.camera.turnTo((v.facing * 180) / Math.PI + 180, true);
        g.camera.jumpZoom?.(g.camera.minZoom + (g.camera.maxZoom - g.camera.minZoom) * v.zoom);
      }, v);
      await page.waitForTimeout(4000); // chunks stream in and settle
      const acc = { 2: { iv: [], cpu: [], gpu: [] }, 4: { iv: [], cpu: [], gpu: [] } };
      for (let round = 0; round < 6; round++) {
        const samples = round % 2 ? 2 : 4;
        const r = await page.evaluate(async (samples) => {
          const g = window.solarbloom;
          const f = g.look.post.frame;
          f.rendering.samples = samples;
          f.update?.();
          await new Promise((res) => setTimeout(res, 700)); // the target is rebuilt; let it settle
          const iv = [];
          const cpu = [];
          const gpu = [];
          let last = 0;
          let fu = 0;
          const prof = g.app.graphicsDevice.gpuProfiler;
          const onFu = () => (fu = performance.now());
          const onFe = () => {
            const now = performance.now();
            cpu.push(now - fu);
            if (last) iv.push(now - last);
            last = now;
            const t = prof?.enabled ? prof._frameTime ?? prof.frameTime : undefined;
            if (typeof t === 'number' && t > 0) gpu.push(t);
          };
          g.app.on('frameupdate', onFu);
          g.app.on('frameend', onFe);
          await new Promise((res) => setTimeout(res, 2500));
          g.app.off('frameupdate', onFu);
          g.app.off('frameend', onFe);
          return { iv, cpu, gpu, rt: f.renderPassCamera?.rt?.samples };
        }, samples);
        if (r.rt !== samples) console.log(`  ! asked for ${samples}×, the target has ${r.rt}×`);
        acc[samples].iv.push(...r.iv);
        acc[samples].cpu.push(...r.cpu);
        acc[samples].gpu.push(...r.gpu);
      }
      for (const n of [2, 4]) {
        const a = acc[n];
        const iv = stats(a.iv);
        console.log(
          `  ${tier} ${v.name} ${n}×: frame ${iv.med} ms median, ${iv.p95} ms p95 (${(1000 / iv.med).toFixed(0)} fps uncapped, ${a.iv.length} frames); cpu ${stats(a.cpu).med} ms` +
            (a.gpu.length ? `; gpu ${stats(a.gpu).med} ms median, ${stats(a.gpu).p95} ms p95` : '; gpu timer n/a'),
        );
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
