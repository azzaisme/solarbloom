// E27.2 (#680): every plot option on a restored park plot, seen from the follow camera with Bloombot beside it for
// scale, in the daytime light. One frame per option and a contact sheet, for before/after review of the plot art.
// Plant plots Bloombot works are also shot just worked (growth 0) and half grown back.
//   npx vite build && GPU=1 node tests/e2e/plot-gallery.mjs [outDir] [tag]
//   ONLY=orchard,arbour to retake some
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/e27-plots/gallery';
const tag = process.argv[3] ?? 'after';
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 4295);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const CROP = { x: 340, y: 150, width: 600, height: 520 };
const WORKED = ['garden', 'orchard', 'meadow', 'arbour', 'parklet', 'crates', 'reeds', 'greenhouse'];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(240_000);
  await startGame(page, `http://localhost:${port}`, { slot: 3 });
  await page.addStyleTag({ content: '#toasts, .toast, #guide, #tip { display: none !important; }' });
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (0.42 - s.clock.dayFraction()) * 2880;
  });
  // the park plot and side with the most open ground behind where Bloombot stands, out to where the camera sits (so
  // nothing stands between the camera and the plot)
  const view = await page.evaluate(() => {
    const g = window.solarbloom;
    const open = (x, z) => (g.bot.walker.walkable('g', Math.floor(x), Math.floor(z)) ? 1 : 0);
    const best = { i: 0, side: 0, n: -1 };
    g.cozy.spots('park').forEach((p, i) => {
      const c = p.size / 2;
      // sides: 0 south (facing +z), 1 north, 2 west (facing +x), 3 east
      [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([fx, fz], side) => {
        const sx = p.x + c - fx * (c + 1.1);
        const sz = p.z + c - fz * (c + 1.1);
        let n = 0;
        for (let k = 0; k <= 7; k++) for (let w = -1; w <= 1; w++) n += open(sx - fx * k + fz * w, sz - fz * k + fx * w);
        if (n > best.n) Object.assign(best, { i, side, n });
      });
    });
    return best;
  });
  await page.evaluate((v) => (window.__plotView = v), view);
  console.log('park plots', await page.evaluate(() => window.solarbloom.cozy.spots('park').map((p) => p.id).join(' ')));
  const options = await page.evaluate(() => window.solarbloom.plotOptionIds());
  const only = process.env.ONLY?.split(',');
  const shots = [];
  for (const option of options.filter((o) => !only || only.includes(o))) {
    const growths = WORKED.includes(option) ? [1, 0.5, 0] : [1];
    for (const growth of growths) {
      await page.evaluate(({ option, growth }) => {
        const g = window.solarbloom;
        const s = g.sim;
        const p = g.cozy.spots('park')[window.__plotView.i];
        for (let j = 0; j < p.size; j++)
          for (let i = 0; i < p.size; i++) {
            const t = s.grid.get('g', p.x + i, p.z + j);
            Object.assign(t, { ground: 'restored', pollution: 0, bloom: Math.max(2, t.bloom), blocked: false });
            s.grid.touch(t);
          }
        s.state.cozy ??= {};
        (s.state.cozy.plots ??= {})[p.id] = option;
        s.state.salvage.clipped ??= {};
        for (let j = 0; j < p.size; j++)
          for (let i = 0; i < p.size; i++) {
            const id = `g:${p.x + i}:${p.z + j}`;
            if (growth >= 1) delete s.state.salvage.clipped[id];
            else s.state.salvage.clipped[id] = s.time + 720 * (1 - growth);
          }
        // Bloombot a step back from the middle of the chosen side, a little off centre, facing in; the camera behind
        const v = window.__plotView;
        const [fx, fz] = [[0, 1], [0, -1], [1, 0], [-1, 0]][v.side];
        const c = p.size / 2;
        const x = p.x + c - fx * (c + 1.1) + fz * 0.45;
        const z = p.z + c - fz * (c + 1.1) - fx * 0.45;
        const facing = Math.atan2(fx, fz);
        g.bot.teleport('g', x, z);
        Object.assign(g.bot.pose, { roofId: 'g', x, z, facing });
        g.camera.turnTo((facing * 180) / Math.PI + 180 - 12, true);
        g.camera.zoomTo?.(1.7);
        g.chunks.markAll();
      }, { option, growth });
      await page.waitForTimeout(2000);
      const name = `${option}${growth < 1 ? `-g${Math.round(growth * 100)}` : ''}`;
      const path = `${dir}/${tag}-${name}.png`;
      await page.screenshot({ path, clip: CROP });
      shots.push({ path, label: growth < 1 ? `${option} · ${growth ? 'half grown back' : 'just worked'}` : option });
      console.log('shot', name);
    }
  }
  const imgs = shots.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(f.path).toString('base64')}"><figcaption>${f.label}</figcaption></figure>`).join('');
  const html = `<html><body style="margin:0;background:#f4efe4;font:600 15px system-ui;color:#2b3a2a"><h2 style="margin:10px 14px">Plot art · ${tag}</h2><div style="display:flex;flex-wrap:wrap;gap:8px;padding:0 10px 10px">${imgs}</div><style>figure{margin:0;width:300px}img{width:300px;display:block;border-radius:8px}figcaption{padding:4px 2px}</style></body></html>`;
  const sp = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await sp.setContent(html);
  await sp.screenshot({ path: `${dir}/sheet-${tag}${only ? '-' + only.join('-') : ''}.png`, fullPage: true });
  await sp.close();
} finally {
  await browser.close();
  server.httpServer.close();
}
