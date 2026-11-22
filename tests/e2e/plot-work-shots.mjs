// E27.2 (#680): frame strips of Bloombot working the plant plots, for review. Not a pass/fail test, though it notes
// anything that goes wrong. For each worked plot it plays: the prompt, the hold (Bloombot gathering an armful or
// pruning with shears, a frame every so often), the plot just picked or pruned, and the plot growing back.
// Writes single frames and one strip per plot to docs/review/e27-plots/ (or argv[2]).
//   npx vite build && GPU=1 node tests/e2e/plot-work-shots.mjs [outDir]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/e27-plots';
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 4294);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const notes = [];
const note = (s) => {
  notes.push(s);
  console.log(`  ! ${s}`);
};
const PLOTS = (process.env.PLOTS ?? 'garden,orchard,meadow,arbour').split(',');
const W = 1280;
const H = 800;
// the part of the screen a strip keeps: Bloombot and the plot, centre screen
const CROP = { x: 340, y: 150, width: 600, height: 520 };

try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await startGame(page, `http://localhost:${port}`, { slot: 3 });
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (0.3 - s.clock.dayFraction()) * 2880;
  });
  // the park's plots, restored
  const spots = await page.evaluate(() => {
    const g = window.solarbloom;
    return g.cozy.spots('park').map((p) => {
      for (let j = 0; j < p.size; j++)
        for (let i = 0; i < p.size; i++) {
          const t = g.sim.grid.get('g', p.x + i, p.z + j);
          Object.assign(t, { ground: 'restored', pollution: 0, bloom: Math.max(2, t.bloom), blocked: false });
          g.sim.grid.touch(t);
        }
      return { id: p.id, x: p.x, z: p.z, size: p.size };
    });
  });
  if (!spots.length) throw new Error('no park plots');
  const strips = [];
  for (const [k, option] of PLOTS.entries()) {
    const p = spots[k % spots.length];
    const tag = `${String(k + 1).padStart(2, '0')}-${option}`;
    // choose it, stand Bloombot just south of it facing in, the camera behind
    const where = await page.evaluate(({ p, option }) => {
      const g = window.solarbloom;
      const s = g.sim;
      s.state.cozy ??= {};
      (s.state.cozy.plots ??= {})[p.id] = option;
      delete s.state.salvage.clipped;
      const held = s.inventory.count('biomass'); // room in the backpack for this plot (a run of plots fills the stack)
      if (held > 0) s.inventory.pay({ biomass: held });
      for (const [x, z, facing] of [[p.x + 0.5, p.z - 0.5, 0], [p.x + 0.5, p.z + p.size + 0.5, Math.PI], [p.x - 0.5, p.z + 0.5, Math.PI / 2], [p.x + p.size + 0.5, p.z + 0.5, -Math.PI / 2]]) {
        if (!g.bot.walker.walkable('g', Math.floor(x), Math.floor(z))) continue;
        g.bot.teleport('g', x, z);
        Object.assign(g.bot.pose, { roofId: 'g', x, z, facing });
        g.camera.turnTo((facing * 180) / Math.PI + 180 + 25, true);
        g.camera.zoomTo?.(1.7);
        g.redrawPlot(p.id);
        return { x, z, facing };
      }
      return null;
    }, { p, option });
    if (!where) {
      note(`${option}: nowhere to stand beside plot ${p.id}`);
      continue;
    }
    await page.waitForTimeout(2200);
    const prompt = await page.evaluate(() => document.querySelector('#prompt')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
    const frames = [];
    const shot = async (name, label) => {
      const path = `${dir}/${tag}-${name}.png`;
      await page.screenshot({ path, clip: CROP });
      frames.push({ path, label });
    };
    await page.screenshot({ path: `${dir}/${tag}-prompt-full.png` });
    await shot('a-ready', `${prompt || '(no prompt)'}`);
    if (!/\b(Gather|Prune) the /.test(prompt) || /full|not long ago/.test(prompt)) note(`${option}: prompt is "${prompt}"`);
    // the hold, a frame every so often
    const before = await page.evaluate(() => window.solarbloom.sim.inventory.count('biomass'));
    await page.keyboard.down('KeyE');
    const need = option === 'orchard' || option === 'arbour' || option === 'parklet' ? 1200 : 900;
    for (const i of [1, 2, 3]) {
      await page.waitForTimeout(i === 1 ? 200 : 250);
      const act = await page.evaluate(() => window.solarbloom.bot.visuals.acting ?? '');
      await shot(`b-hold-${i}`, `holding E · ${act}`);
    }
    await page.waitForTimeout(need - 700 + 250);
    await page.keyboard.up('KeyE');
    await page.waitForTimeout(500);
    const got = (await page.evaluate(() => window.solarbloom.sim.inventory.count('biomass'))) - before;
    if (got <= 0) note(`${option}: nothing gathered`);
    await shot('c-done', `done · +${got} Greens`);
    await page.waitForTimeout(1500);
    await shot('d-worked', 'just worked');
    // growing back: the clock moved on a quarter at a time (the art steps in quarters)
    for (const [i, share] of [[1, 0.3], [2, 0.55], [3, 0.8], [4, 1.01]]) {
      await page.evaluate(({ p, share }) => {
        const g = window.solarbloom;
        const s = g.sim;
        const regrow = 12 * 60; // GATHER.regrowDays (a quarter of a game day): 12 minutes
        for (let j = 0; j < p.size; j++) for (let i = 0; i < p.size; i++) {
          const id = `g:${p.x + i}:${p.z + j}`;
          if (s.state.salvage.clipped?.[id] !== undefined) s.state.salvage.clipped[id] = s.time + regrow * (1 - share);
        }
        g.redrawPlot(p.id);
      }, { p, share });
      await page.waitForTimeout(900);
      await shot(`e-grow-${i}`, i === 4 ? 'grown back' : `growing back · ${Math.round(share * 100)}%`);
    }
    const again = await page.evaluate(() => document.querySelector('#prompt')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
    strips.push({ option, prompt, again, got, frames });
  }
  // one strip per plot: the frames side by side with their labels, shot as a page
  for (const s of strips) {
    const imgs = s.frames.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(f.path).toString('base64')}"><figcaption>${f.label}</figcaption></figure>`).join('');
    const html = `<html><body style="margin:0;background:#f4efe4;font:600 15px system-ui;color:#2b3a2a"><h2 style="margin:10px 14px">${s.option}: ${s.prompt}</h2><div style="display:flex;flex-wrap:wrap;gap:8px;padding:0 10px 10px">${imgs}</div><style>figure{margin:0;width:300px}img{width:300px;display:block;border-radius:8px}figcaption{padding:4px 2px}</style></body></html>`;
    const sp = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await sp.setContent(html);
    await sp.screenshot({ path: `${dir}/strip-${s.option}.png`, fullPage: true });
    await sp.close();
  }
  if (errors.length) note(`page errors: ${errors.join(' | ')}`);
  writeFileSync(`${dir}/plot-work.json`, JSON.stringify({ strips: strips.map(({ frames, ...r }) => r), notes }, null, 1));
  console.log(JSON.stringify(strips.map(({ frames, ...r }) => r), null, 1));
} finally {
  await browser.close();
  server.httpServer.close();
}
