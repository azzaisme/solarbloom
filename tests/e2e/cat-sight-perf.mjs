// Frame time and the after-frame sight cost with a hiding cat on screen (before the first find).
// E23.12.3 (#530): the cat sight cost, before/after. Usage: node tests/e2e/cat-sight-perf.mjs <label> [root] (root: a built copy of another commit, e.g. one unpacked with git archive; default: this checkout's dist). Run alone (through ~/.solarbloom/heavy.sh): numbers taken beside other jobs are skewed.
import { chromium } from 'playwright';
import { preview } from 'vite';
const label = process.argv[2] ?? 'run';
const root = process.argv[3] ?? '.';
const server = await preview({ root, preview: { port: 4394, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.on('pageerror', (e) => console.log('PAGEERR', String(e)));
await page.addInitScript(() => { if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1'); localStorage.clear(); });
await page.goto('http://localhost:4394/?slot=1', { timeout: 180000 });
await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 180000 });
await page.waitForTimeout(3000);
const cat = await page.evaluate(() => {
  const g = window.solarbloom, s = g.sim;
  const a = s.cat.candidates()[0];
  s.cat.spawn(a.id);
  // the after-frame sight step, timed where it runs (the same method in both builds)
  window.__sight = { ms: 0, n: 0 };
  const f = g.measureCatsAfterFrame.bind(g);
  g.measureCatsAfterFrame = () => { const t = performance.now(); try { f(); } finally { window.__sight.ms += performance.now() - t; window.__sight.n++; } };
  return { x: a.pos[0], z: a.pos[2] };
});
const measure = (ms) => page.evaluate(async (ms) => {
  const g = window.solarbloom;
  const frames = [];
  let fu = 0;
  const onFu = () => (fu = performance.now());
  const onFe = () => frames.push(performance.now() - fu);
  g.app.on('frameupdate', onFu);
  g.app.on('frameend', onFe);
  window.__sight = { ms: 0, n: 0 };
  const r0 = g.sight.renders ?? 0;
  await new Promise((r) => setTimeout(r, ms));
  g.app.off('frameupdate', onFu);
  g.app.off('frameend', onFe);
  frames.sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  const id = g.sim.state.cat.active?.id;
  return {
    frames: frames.length,
    frameAvgMs: +avg.toFixed(1),
    frameMedianMs: +frames[frames.length >> 1].toFixed(1),
    sightMsPerFrame: +(window.__sight.ms / Math.max(1, frames.length)).toFixed(2),
    sightMsTotal: +window.__sight.ms.toFixed(1),
    pickRenders: g.sight.renders === undefined ? 'n/a' : g.sight.renders - r0,
    catOnScreen: !!(id && g.camera.onScreen(g.cat.targetWorld(id), 0)),
  };
}, ms);
await page.keyboard.press('m');
await page.waitForTimeout(8000);
await page.mouse.move(40, 300); // the pointer away from any cat
console.log(label, 'overview, pointer away:', JSON.stringify(await measure(30000)));
const sc = await page.evaluate(() => { const g = window.solarbloom; return g.camera.onScreen(g.cat.targetWorld(g.sim.state.cat.active.id), 0); });
if (sc) {
  await page.mouse.move(sc.x, sc.y);
  console.log(label, 'overview, pointer resting on the cat:', JSON.stringify(await measure(30000)));
}
// back to the follow view, bloombot standing beside the cat (it could greet it), the pointer still
await page.keyboard.press('m');
await page.waitForTimeout(6000);
await page.evaluate((c) => { const g = window.solarbloom; g.bot.teleport('g', c.x + 0.8, c.z + 0.8); }, cat);
await page.waitForTimeout(8000);
console.log(label, 'follow view, bloombot beside the cat:', JSON.stringify(await measure(30000)));
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
console.log(label, 'paused:', JSON.stringify(await measure(15000)));
await browser.close();
server.httpServer.close();
