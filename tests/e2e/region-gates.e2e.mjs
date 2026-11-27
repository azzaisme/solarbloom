// #787 (point 4): building is needed in most regions. In the real built game:
//  - Mast Row's landmark waits on its works: the junction box beside the Signal Mast is dark;
//  - standing at it, the prompt says what is wrong and what to build where ("Build a Solar Panel right beside it"),
//    with the player's own key and no placeholders left; the objective card's next step names the same goal, and the
//    region's progress bar (shown on arriving in the region) says "Needs power";
//  - a Solar Panel built beside it (the real build) wakes it: a toast says so, the box lights up, the bar says
//    "Powered", the prompt no longer refuses, and the Signal Mast is ready to wake;
//  - the garden saves it running, and a reload keeps it running;
//  - every other region's works piece, dark and then running (the gallery shots).
// Screenshots go to SHOTS_DIR (default docs/review/787). Run after `vite build`:
//   node tests/e2e/region-gates.e2e.mjs
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame, waitForGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/787';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4253);
const server = await preview({ preview: { port: PORT, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const TIMEOUT = Number(process.env.E2E_TIMEOUT) || 240_000;
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(TIMEOUT);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, base, { query: 'gfx=low', settings: { hints: false } });
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));
  await wait(2000);
  const run = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name) => {
    await page.screenshot({ path: `${dir}/${name}.png` });
    console.log(`  ${dir}/${name}.png`);
  };
  /** Frames a spot (Bloombot's follow camera off), then waits for the chunks to draw. */
  const frame = async (x, z, zoom, yaw = 0, ms = 6000) => {
    await run(({ x, z, zoom, yaw }) => {
      const g = window.solarbloom;
      g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
      g.camera.minZoom = 0.12;
      g.bot.following = false;
      g.camera.glide(x, 0, z, zoom);
      g.camera.turnTo(yaw);
      for (let i = 0; i < 300; i++) g.camera.update(0.05);
    }, { x, z, zoom, yaw });
    await wait(ms);
  };
  /** Waits (up to a while: the software-rendered page is slow) until an element's text matches, then returns it. */
  const until = async (sel, re, ms = 120_000) => {
    await page.waitForFunction(([sel, src]) => new RegExp(src).test(document.querySelector(sel)?.innerText.replace(/\s+/g, ' ') ?? ''), [sel, re.source], { timeout: ms, polling: 250 }).catch(() => {});
    return text(sel);
  };
  /** Waits until a toast with this text is up (one shows at a time, so it may wait its turn). */
  const toastWith = (s, ms = 180_000) =>
    page
      .waitForFunction((s) => [...document.querySelectorAll('.toast')].some((t) => t.innerText.replace(/\s+/g, ' ').includes(s)), s, { timeout: ms, polling: 200 })
      .then(() => true)
      .catch(() => false);
  /** Walks out of the region to the park, then back beside the piece: the region's card shows on arriving. */
  const arrive = async ({ x, z }) => {
    await run(() => window.solarbloom.bot.teleport('g', 8.5, 8.5));
    await wait(2500);
    await run(({ x, z }) => {
      const g = window.solarbloom;
      g.bot.teleport('g', x + 1.5, z + 0.5);
      g.bot.faceToward(x + 0.5, z + 0.5);
    }, { x, z });
  };
  const text = (sel) => run((sel) => document.querySelector(sel)?.innerText.replace(/\s+/g, ' ').trim() ?? '', sel);

  // ── Mast Row: open past its rubble, its Keeper asking for the landmark, the sun at noon ──
  const w = await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const sv = s.state.salvage;
    sv.tier = 1;
    sv.abilities = ['prune'];
    s.areas.clear('park', true);
    s.gates.open('g-mastRow', true);
    sv.keepers.pylon = { step: 'landmark' };
    sv.pack = { ...sv.pack, scrap: 40 };
    const noon = { ...s.power.sky(), sun: 1, solar: 1 };
    s.power.skyOverride = () => noon;
    const def = s.works.def('mastRow');
    // the region turned green (so only the works stand in the landmark's way), the ground round the box to build on
    for (const t of s.areas.tiles('mastRow'))
      if (!t.blocked && !t.occupantId && t.feature !== 'water') Object.assign(t, { ground: 'restored', pollution: 0, bloom: Math.max(1, t.bloom) }), s.grid.touch(t);
    g.chunks.markAll();
    // stand beside it (east), facing it
    g.bot.teleport('g', def.x + 1.5, def.z + 0.5);
    g.bot.faceToward(def.x + 0.5, def.z + 0.5);
    return { x: def.x, z: def.z, how: def.how, goal: def.goal, running: def.running, name: def.name };
  });
  await arrive(w);
  const arrival = await until('#regionArrival', /Needs power/);
  check(/Mast Row/.test(arrival) && /Needs power/.test(arrival), `the region's progress bar on arriving: "${arrival}"`);
  let st = await run(() => ({ running: window.solarbloom.sim.works.running('mastRow'), ready: window.solarbloom.sim.areas.ready('mastRow'), problem: window.solarbloom.sim.landmarks.problem('mastRow') }));
  check(!st.running && !st.ready, `Mast Row's works are dark and its landmark is not ready (${JSON.stringify(st)})`);
  check(/junction box is dark/.test(st.problem ?? ''), `the Signal Mast refuses to wake, saying why: "${st.problem}"`);
  let prompt = await until('#prompt', /Solar Panel/);
  check(prompt.includes(`Look at ${w.name}`) && prompt.includes('Solar Panel') && !/\{/.test(prompt), `the prompt at the box: "${prompt}"`);
  const next = await text('#objNext');
  check(next.includes(w.goal), `the objective card's next step: "${next}"`);
  await shot('1-mastrow-dark-prompt');
  await frame(w.x + 0.5, w.z + 0.5, 1.6, 30);
  await shot('2-junction-dark');

  // ── build a Solar Panel right beside it (the build's own checks and cost) ──
  const built = await run(({ x, z }) => {
    const s = window.solarbloom.sim;
    for (const [dx, dz] of [[-1, 0], [0, -1], [0, 1], [-1, -1]]) {
      if (s.build.check('solar', 'g', x + dx, z + dz).ok) return s.build.place('solar', 'g', x + dx, z + dz)?.id ?? null;
    }
    return null;
  }, w);
  check(!!built, `a Solar Panel built beside the box (${built})`);
  await page.waitForFunction(() => window.solarbloom.sim.works.running('mastRow'), null, { timeout: TIMEOUT, polling: 500 });
  await wait(500);
  await shot('3-junction-running');
  const toasted = await toastWith(w.running);
  const toast = await run(() => [...document.querySelectorAll('.toast')].map((t) => t.innerText.replace(/\s+/g, ' ')).join(' | '));
  check(toasted && !/\{/.test(toast), `the toast: "${toast.slice(0, 160)}"`);
  await shot('4-junction-running-toast');
  st = await run(() => ({ running: window.solarbloom.sim.works.running('mastRow'), ready: window.solarbloom.sim.areas.ready('mastRow'), problem: window.solarbloom.sim.landmarks.problem('mastRow') ?? '', saved: window.solarbloom.sim.state.salvage.works }));
  check(st.running && st.ready && !st.problem && JSON.stringify(st.saved) === '["mastRow"]', `running for good, saved, and the landmark no longer waits on it (${JSON.stringify(st)})`);
  // back beside it: the prompt no longer refuses
  await run(({ x, z }) => {
    const g = window.solarbloom;
    g.bot.following = true;
    g.bot.teleport('g', x + 1.5, z + 0.5);
    g.bot.faceToward(x + 0.5, z + 0.5);
  }, w);
  prompt = await until('#prompt', /Look at/);
  await wait(1500);
  prompt = await text('#prompt');
  check(prompt.includes(`Look at ${w.name}`) && !/Solar Panel right beside/.test(prompt), `the prompt now: "${prompt}"`);
  await arrive(w);
  const arrivalNow = await until('#regionArrival', /Powered/);
  check(/Powered/.test(arrivalNow), `the region's progress bar now: "${arrivalNow}"`);
  await shot('5-mastrow-powered-bar');

  // ── saved running: a reload keeps it running ──
  await run(() => window.solarbloom.saveNow?.());
  await page.goto(`${base}/?slot=1&gfx=low`);
  await waitForGame(page, TIMEOUT);
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));
  await wait(2000);
  st = await run(() => ({ running: window.solarbloom.sim.works.running('mastRow'), other: window.solarbloom.sim.works.running('oldMarket') }));
  check(st.running && !st.other, `after a reload Mast Row's works still run, Old Market's still wait (${JSON.stringify(st)})`);

  // ── the gallery: every other works piece, dark and then running ──
  await page.addStyleTag({ content: '#toasts, .toast { display: none !important; }' });
  const list = await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.state.salvage.abilities = ['prune', 'hover', 'climb', 'glide'];
    const noon = { ...s.power.sky(), sun: 1, solar: 1 };
    s.power.skyOverride = () => noon;
    const out = [];
    for (const r of ['oldMarket', 'saltwind', 'cistern', 'clockPlaza', 'terraces', 'glasshouse', 'observatory', 'spireHeights']) {
      s.gates.openRegion(r);
      const d = s.works.def(r);
      out.push({ region: r, x: d.x, z: d.z, look: d.look });
    }
    g.chunks.markAll();
    return out;
  });
  for (const p of list) {
    await frame(p.x + 0.5, p.z + 0.5, 1.9, 30, 7000);
    const dark = await run((r) => !window.solarbloom.sim.works.running(r), p.region);
    check(dark, `${p.region}: its ${p.look} is dark`);
    await shot(`g-${p.region}-dark`);
    await run((r) => window.solarbloom.sim.works.start(r), p.region);
    await wait(3500);
    const on = await run((r) => window.solarbloom.sim.works.running(r), p.region);
    check(on, `${p.region}: running`);
    await shot(`g-${p.region}-running`);
  }
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  console.error(e);
  failures.push(String(e));
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
