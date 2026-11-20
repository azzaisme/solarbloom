// E19.1.3 (#249): every plot option on a plot, the empty "waiting" look, the far level of detail, and the picker
// with bloombot projecting its hologram. Screenshots into docs/review/e19-plots/.
//
//   npm run shots:plots
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/e19-plots';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4196, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const hideToasts = () => page.addStyleTag({ content: '#toasts, .toast { display: none !important; }' });

// 1. Each option, close up, on the park's first plot (the cursor camera frames it freely).
await page.goto('http://localhost:4196/?slot=1&cursor=1');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => !!window.solarbloom);
await hideToasts();
await page.evaluate(() => window.solarbloom.fillPlots());
const list = await page.evaluate(() => window.solarbloom.plotOptionIds());
for (const opt of [...list, '(waiting)']) {
  await page.evaluate((opt) => {
    const g = window.solarbloom;
    const p = g.cozy.spots('park')[0];
    const st = g.sim.state;
    st.cozy ??= {};
    st.cozy.plots ??= {};
    // Review only: any option on the park's plot (the picker would offer only the park's own).
    if (opt === '(waiting)') delete st.cozy.plots[p.id];
    else st.cozy.plots[p.id] = opt;
    g.chunks.markAll();
    g.camera.glide(p.x + 1, 0, p.z + 1, 1.7);
    for (let i = 0; i < 200; i++) g.camera.update(0.05);
  }, opt);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/plot-${opt === '(waiting)' ? 'waiting' : opt}.png` });
  console.log('shot', opt);
}

// 2. Far level of detail: both park plots filled, from the overview.
await page.evaluate(() => {
  const g = window.solarbloom;
  g.fillPlots();
  const p = g.cozy.spots('park')[0];
  g.camera.glide(p.x + 1, 0, p.z + 1, 0.42);
  for (let i = 0; i < 200; i++) g.camera.update(0.05);
});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/plots-far.png` });

// 3. Bloombot at a plot with the picker open, projecting the option it's looking at.
await page.goto('http://localhost:4196/?slot=1');
await page.waitForFunction(() => !!window.solarbloom?.bot);
await hideToasts();
await page.evaluate(async () => {
  const g = window.solarbloom;
  g.fillPlots();
  const p = g.cozy.spots('park')[0];
  g.bot.teleport('g', p.x - 1.5, p.z + 1);
  g.bot.pose.facing = Math.PI / 2;
  await new Promise((r) => setTimeout(r, 1200));
  g.openPlotPicker(p);
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('#ppList button[data-opt="arbour"]')?.dispatchEvent(new Event('mouseenter'));
});
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/picker-hologram.png` });
console.log('shot picker');
await browser.close();
server.httpServer.close();
