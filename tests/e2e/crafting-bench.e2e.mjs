// #783: the crafting bench isn't the house any more. A workbench (a wooden table with tools) stands outside beside
// Bloombot's house from the very start of a new garden; walking up to it and pressing Interact opens crafting. In the
// real built game:
//  - a new garden: the workbench is there beside the house, on its own square, and Bloombot can't walk through it;
//  - standing in front of it, the prompt reads "Use the workbench" with the player's own key;
//  - pointing at it in the map view, the tip says what it is in plain words;
//  - pressing Interact opens crafting, titled "Workbench";
//  - facing the house's walls no longer opens crafting (the house keeps its radio and bed);
//  - an older save (from before the workbench) gets it too: beside the house on a free square, moving nothing the
//    player built there, and it opens crafting the same way.
// Screenshots go to SHOTS_DIR (default docs/review/783). Run after `vite build`.
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame, waitForGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/783';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4253);
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT = Number(process.env.E2E_TIMEOUT) || 240_000;

/** Bloombot in front of the workbench, facing it (its front square, as the game works it out). */
const standAtBench = (page) =>
  page.evaluate(() => {
    const g = window.solarbloom;
    const b = g.sim.bench.at;
    const f = g.sim.bench.front();
    g.bot.teleport('g', f.x + 0.5, f.z + 0.5);
    g.bot.faceToward(b.x + 0.5, b.z + 0.5);
  });
const promptText = (page) => page.evaluate(() => document.getElementById('prompt')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
const pressInteract = async (page) => {
  const key = await page.evaluate(() => window.solarbloom.bindings.keys.interact[0]);
  await page.keyboard.press(key.replace(/^Key/, ''));
};

/** Opens crafting at the workbench with Interact, checks the panel, takes a picture, and closes it. */
async function useBench(page, label, shot) {
  await standAtBench(page);
  await page.waitForFunction(() => window.solarbloom.interactTarget()?.id === 'craft:bench', null, { timeout: 60_000, polling: 250 }).catch(() => {});
  await wait(1500);
  const prompt = await promptText(page);
  check(/Use the workbench/.test(prompt) && !/\{/.test(prompt), `${label}: the prompt in front of it: "${prompt}"`);
  if (shot) await page.screenshot({ path: `${dir}/${shot}-prompt.png` });
  await pressInteract(page);
  const open = await page.waitForSelector('#craftScreen.open', { timeout: 30_000 }).then(() => true).catch(() => false);
  check(open, `${label}: pressing Interact opens crafting`);
  const title = await page.evaluate(() => document.getElementById('crTitle')?.textContent ?? '');
  check(title === 'Workbench', `${label}: the panel is the workbench ("${title}")`);
  if (shot) await page.screenshot({ path: `${dir}/${shot}-panel.png` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#craftScreen.open'), null, { timeout: 30_000 }).catch(() => {});
}

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(TIMEOUT);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, `http://localhost:${PORT}`, { query: 'gfx=low', settings: { hints: false } });
  await wait(3000);

  // ── a new garden: the workbench is outside, beside the house ──
  const s = await page.evaluate(() => {
    const g = window.solarbloom;
    const b = g.sim.bench.at;
    const t = b && g.sim.grid.get('g', b.x, b.z);
    return { b, occ: t?.occupantId, walk: b && g.bot.walker.walkable('g', b.x, b.z), facing: g.sim.bench.facing() };
  });
  check(!!s.b && s.b.x === 5 && s.b.z === 3, `a new garden has the workbench against the house's east wall (${JSON.stringify(s.b)})`);
  check(s.occ === 'workbench', `it stands on its own square (${s.occ})`);
  check(s.walk === false, 'Bloombot walks round it, not through it');

  // a good look at it: Bloombot a little way off, the camera on the bench and the house
  await page.evaluate(() => {
    const g = window.solarbloom;
    const b = g.sim.bench.at;
    g.bot.teleport('g', b.x + 2.5, b.z + 1.5);
    g.bot.faceToward(b.x + 0.5, b.z + 0.5);
  });
  await wait(2500);
  await page.screenshot({ path: `${dir}/new-garden-bench.png` });

  await useBench(page, 'a new garden', 'new-garden');

  // ── the house is a home: its walls don't open crafting any more ──
  const wall = await page.evaluate(async () => {
    const g = window.solarbloom;
    g.bot.teleport('g', 3.5, 5.5);
    g.bot.pose.facing = Math.PI; // north, at the house's front wall
    await new Promise((r) => setTimeout(r, 1200));
    return g.interactTarget()?.id;
  });
  check(wall !== 'craft:table' && wall !== 'craft:bench', `the house's wall doesn't open crafting (${wall})`);

  // ── the map view: pointing at it says what it is ──
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.bot.teleport('g', 10.5, 12.5);
    g.bot.pose.facing = 0;
  });
  await wait(1000);
  await page.evaluate(() => {
    const g = window.solarbloom;
    const b = g.sim.bench.at;
    g.toggleOverview();
    g.camera.glide(b.x + 0.5, 0, b.z + 0.5, 1.5); // the map view, brought in close over the house
  });
  await wait(6000); // the camera glides there over real frames
  // where the bench's square is on screen once the camera has settled: the point the game's own pointer pick reads as
  // that square (the same pick the hover uses)
  const tip = await page.evaluate(async () => {
    const g = window.solarbloom;
    const b = g.sim.bench.at;
    const at = () => {
      const v = g.camera.toScreen(g.tileVec(g.sim.grid.get('g', b.x, b.z)));
      return { x: v.x, y: v.y };
    };
    let p = at();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const q = at();
      const still = Math.hypot(q.x - p.x, q.y - p.y) < 1;
      p = q;
      if (still) break;
    }
    for (let r = 0; r <= 24; r += 2)
      for (let a = 0; a < (r ? 12 : 1); a++) {
        const x = p.x + Math.cos(a * Math.PI / 6) * r;
        const y = p.y + Math.sin(a * Math.PI / 6) * r;
        const hit = g.pick(x, y)?.tile;
        if (hit && hit.x === b.x && hit.z === b.z) return { x, y };
      }
    return p;
  });
  // hover there (each pointer move is a fresh hover), until the tip shows
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(tip.x + (i % 2 ? 0.5 : 0), tip.y);
    await wait(300);
    const shown = await page.evaluate(() => {
      const t = document.getElementById('tip');
      return !!t && getComputedStyle(t).display !== 'none' && /Workbench/.test(t.innerText);
    });
    if (shown) break;
  }
  const tipText = await page.evaluate(() => document.getElementById('tip')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
  check(/Workbench/.test(tipText) && /press/i.test(tipText) && !/\{/.test(tipText), `pointing at it in the map view: "${tipText}"`);
  // the tip shows while the pointer is fresh (a second and a half); this browser is slow to take a picture, so keep the
  // pointer counted as fresh for the picture
  await page.evaluate(() => (window.solarbloom.pointerAt = performance.now() + 60_000));
  await page.mouse.move(tip.x, tip.y + 0.5);
  await page.evaluate(() => (window.solarbloom.pointerAt = performance.now() + 60_000));
  await page.waitForFunction(() => getComputedStyle(document.getElementById('tip')).display !== 'none', null, { timeout: 10_000, polling: 100 }).catch(() => {});
  await page.screenshot({ path: `${dir}/map-tip.png` });
  await page.evaluate(() => window.solarbloom.toggleOverview());
  await page.mouse.move(5, 5);

  // ── an older save, from before the workbench, with a chest built where it would go ──
  await page.evaluate(() => window.solarbloom.saveNow());
  await page.evaluate(() => {
    const raw = localStorage.getItem('solarbloom.save.1');
    const st = JSON.parse(raw);
    delete st.salvage.bench;
    st.machines.push({ id: `m${st.nextId++}`, type: 'chest', roofId: 'g', x: 5, z: 3, size: 1, boostUntil: 0, timer: 0, charge: 0 });
    localStorage.setItem('solarbloom.save.2', JSON.stringify(st));
    const head = localStorage.getItem('solarbloom.save.1.head');
    if (head) localStorage.setItem('solarbloom.save.2.head', head);
  });
  await page.goto(`http://localhost:${PORT}/?slot=2&gfx=low`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
  await waitForGame(page);
  await wait(3000);
  const old = await page.evaluate(() => {
    const g = window.solarbloom;
    const b = g.sim.bench.at;
    const sh = { x: 2, z: 2, size: 3 };
    const beside = b && b.x >= sh.x - 1 && b.x <= sh.x + sh.size && b.z >= sh.z - 1 && b.z <= sh.z + sh.size;
    const chest = g.sim.state.machines.find((m) => m.type === 'chest' && m.x === 5 && m.z === 3);
    return { b, beside, chest: !!chest, occ: b && g.sim.grid.get('g', b.x, b.z)?.occupantId };
  });
  check(!!old.b && old.beside, `the older save has the workbench beside the house (${JSON.stringify(old.b)})`);
  check(old.chest && !(old.b.x === 5 && old.b.z === 3), 'on a free square: the chest built there stays where it was');
  check(old.occ === 'workbench', `on its own square (${old.occ})`);
  await page.evaluate(() => {
    const g = window.solarbloom;
    const b = g.sim.bench.at;
    const f = g.sim.bench.front();
    g.bot.teleport('g', f.x + 0.5 + (f.x - b.x) * 1.5, f.z + 0.5 + (f.z - b.z) * 1.5);
    g.bot.faceToward(b.x + 0.5, b.z + 0.5);
  });
  await wait(2500);
  await page.screenshot({ path: `${dir}/older-save-bench.png` });
  await useBench(page, 'an older save', 'older-save');
  // ── without the model files (models=classic), the same table and tools drawn by hand ──
  await page.goto(`http://localhost:${PORT}/?slot=2&gfx=low&models=classic`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
  await waitForGame(page);
  await wait(3000);
  await page.evaluate(() => {
    const g = window.solarbloom;
    const b = g.sim.bench.at;
    const f = g.sim.bench.front();
    g.bot.teleport('g', f.x + 0.5 + (f.x - b.x) * 1.5, f.z + 0.5 + (f.z - b.z) * 1.5);
    g.bot.faceToward(b.x + 0.5, b.z + 0.5);
  });
  await wait(2500);
  await page.screenshot({ path: `${dir}/drawn-by-hand.png` });
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
