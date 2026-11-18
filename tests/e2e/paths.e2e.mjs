// E23.6.7 (#472): paths in the game, with the Deck preset (?gfx=deck), at 1280 × 800, on the keyboard alone and the
// pad alone (bloombot faces the tile; Space or A acts, R or RB turns):
// - draw a curved path through three points (the same spot again lays it), wider with a turn;
// - reshape it: pick up its middle point and put it down elsewhere; take it away with the remove tool, everything back;
// - break up a stretch of old paving and restore it with a pulse; reroute a park path round it;
// - paths follow the land's height and blend at the edges (the decal's edge colour, moss and flowers creeping on as it
//   ages), and a region full of paths stays
//   within the Deck preset's draw calls (450): all paths are one draw call.
// Screenshots go to SHOTS_DIR (default docs/review). Run after `vite build` (npm run test:paths), or BASE_URL.
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const PAD = driver + '\ninstallVirtualPad(); window.padDriver = padDriver; window.installVirtualPad = installVirtualPad;';
const server = process.env.BASE_URL ? undefined : await preview({ preview: { port: 4239, strictPort: true }, logLevel: 'silent' });
const base = process.env.BASE_URL ?? 'http://localhost:4239';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const LIMIT = 450;
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

async function pressPad(page, b) {
  await page.evaluate(async (b) => {
    const frames = (n) => new Promise((r) => (function f(k) { k ? requestAnimationFrame(() => f(k - 1)) : r(); })(n));
    window.__pad.buttons[b].pressed = true;
    window.__pad.buttons[b].value = 1;
    await frames(2);
    window.__pad.buttons[b].pressed = false;
    window.__pad.buttons[b].value = 0;
    await frames(2);
  }, b);
}

/** Bloombot stands beside (x, z) facing it (the first free side); then Space or A. */
async function at(page, dev, x, z) {
  await page.evaluate(({ x, z }) => {
    const g = window.solarbloom;
    for (const [dx, dz, f] of [[0, 1.1, Math.PI], [0, -1.1, 0], [1.1, 0, -Math.PI / 2], [-1.1, 0, Math.PI / 2]]) {
      g.bot.teleport('g', x + 0.5 + dx, z + 0.5 + dz);
      g.bot.pose.facing = f;
      const fr = g.bot.front();
      if (fr.x === x && fr.z === z) return;
    }
  }, { x, z });
  await page.waitForFunction(() => window.solarbloom.bot.visuals.busy !== 'assemble', null, { timeout: 90000 }).catch(() => {});
  if (dev === 'keys') {
    await page.evaluate(() => window.solarbloom.onLeave()); // keyboard alone: build mode aims in front of bloombot
    await page.keyboard.press('Space');
  } else await pressPad(page, 0);
  await page.waitForTimeout(200);
}
const turn = (page, dev) => (dev === 'pad' ? pressPad(page, 5) : page.keyboard.press('KeyR'));
const tool = (page, t) => page.evaluate((t) => window.solarbloom.selectTool(t), t);

async function open(dev) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (dev === 'pad') await page.addInitScript(PAD);
  await page.goto(`${base}/?slot=1&new=1&gfx=deck`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  // the park, restored round (6..24, 10..26), Scrap in the backpack and the store, an old paved stretch at z = 24
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    const s = g.sim;
    s.state.salvage.tier = 1;
    s.inventory.add('scrap', 40);
    s.inventory.addToStore('scrap', 400);
    for (let x = 6; x < 25; x++)
      for (let z = 10; z < 27; z++) {
        const t = s.grid.get('g', x, z);
        if (!t || t.blocked || t.occupantId) continue;
        t.ground = 'restored';
        t.pollution = 0;
        t.bloom = 2;
        s.grid.touch(t);
        g.chunks.markTile(t);
      }
    for (const x of [10, 11, 12, 13]) {
      const t = s.grid.get('g', x, 24);
      t.feature = 'paving';
      t.ground = 'polluted';
      t.pollution = 60;
      s.grid.touch(t);
      g.chunks.markTile(t);
    }
  });
  await page.waitForTimeout(600);
  return { page, errors };
}

try {
  for (const dev of ['keys', 'pad']) {
    const { page, errors } = await open(dev);
    const T = (s) => `E23.6.7 ${dev}: ${s}`;
    const scrap = () => page.evaluate(() => window.solarbloom.sim.inventory.count('scrap') + window.solarbloom.sim.inventory.stored('scrap'));
    const before = await scrap();
    // draw: three points, wider by one turn, then the last spot again lays it
    await tool(page, 'path:gravel');
    await turn(page, dev);
    for (const [x, z] of [[9, 14], [14, 18], [19, 14]]) await at(page, dev, x, z);
    await at(page, dev, 19, 14);
    const laid = await page.evaluate(() => window.solarbloom.sim.paths.all().map((p) => ({ id: p.id, pts: p.pts, w: p.w })));
    check(laid.length === 1 && laid[0].pts.length === 3 && laid[0].w === 2, T(`a curved path through three points, a step wider (${JSON.stringify(laid)})`));
    const curved = await page.evaluate(() => window.solarbloom.sim.paths.onPath(14.5, 18.5) && window.solarbloom.sim.paths.onPath(11.5, 16.8));
    check(curved, T('the path follows a smooth curve between its points'));
    check((await scrap()) < before, T('laying it takes its gravel (Scrap)'));
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.bot.following = false;
      g.camera.glide(14, 0, 17, 1.2);
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${dir}/ui-path-laid-${dev}.png` });
    // moss and flowers creep onto its edges as it ages (two game days)
    await page.evaluate(() => (window.solarbloom.sim.state.time += 2880 * 2.05));
    await page.waitForFunction(() => !!window.solarbloom.pathArt.creepEntity, null, { timeout: 120000 }).catch(() => {});
    check(await page.evaluate(() => !!window.solarbloom.pathArt.creepEntity), T('moss and flowers creep onto its edges as it ages'));
    await page.screenshot({ path: `${dir}/ui-path-crept-${dev}.png` });
    // reshape: pick up the middle point and put it down three tiles further on
    await tool(page, 'pathEdit');
    await at(page, dev, 14, 18);
    await at(page, dev, 14, 21);
    const moved = await page.evaluate(() => window.solarbloom.sim.paths.all()[0]?.pts[1]);
    check(moved?.[0] === 14.5 && moved?.[1] === 21.5, T(`reshaped: the middle point moved (${JSON.stringify(moved)})`));
    // depave: break up the old paving, then restore it with a pulse
    await tool(page, 'depave');
    for (const x of [10, 11, 12, 13]) await at(page, dev, x, 24);
    const dep = await page.evaluate(() => [10, 11, 12, 13].map((x) => window.solarbloom.sim.grid.get('g', x, 24).feature));
    check(dep.every((f) => f === 'lawn'), T(`a stretch of old paving broken up (${dep.join(', ')})`));
    await tool(page, 'pulse');
    await at(page, dev, 11, 24);
    await page.waitForTimeout(1500);
    const g24 = await page.evaluate(() => window.solarbloom.sim.grid.get('g', 11, 24).ground);
    check(g24 !== 'polluted', T(`the broken-up ground can be restored with a pulse (${g24})`));
    // reroute: a park path round the broken-up stretch, in stepping stones
    await tool(page, 'path:steppingStones');
    for (const [x, z] of [[8, 25], [12, 22], [16, 25]]) await at(page, dev, x, z);
    await at(page, dev, 16, 25);
    const n = await page.evaluate(() => window.solarbloom.sim.paths.all().length);
    check(n === 2, T('a park path rerouted round it'));
    // height and edges: the decal sits on the ground at every vertex, its edges in the edge colour
    const fit = await page.evaluate(() => {
      const g = window.solarbloom;
      const mi = g.pathArt.entity?.render?.meshInstances?.[0];
      return { tris: g.pathArt.tris, hasMesh: !!mi };
    });
    check(fit.hasMesh && fit.tris > 0, T(`the paths are drawn as one ground decal (${fit.tris} triangles)`));
    // remove: everything back
    await tool(page, 'remove');
    const ids = await page.evaluate(() => window.solarbloom.sim.paths.all().map((p) => p.id));
    for (let k = 0; k < 6 && (await page.evaluate(() => window.solarbloom.sim.paths.all().length)); k++) {
      const pt = await page.evaluate(() => {
        const p = window.solarbloom.sim.paths.all()[0];
        const [x, z] = p.pts[0];
        return [Math.floor(x), Math.floor(z)];
      });
      await at(page, dev, pt[0], pt[1]);
    }
    const left = await page.evaluate(() => window.solarbloom.sim.paths.all().length);
    check(left === 0 && ids.length === 2, T('the remove tool takes the paths away (points first, then the path)'));
    check((await scrap()) === before, T(`everything they took came back (${before} Scrap)`));
    if (dev === 'keys') {
      // a region full of paths in the Deck preset: one draw call for all of them
      const draws = async () => {
        const d = [];
        for (let k = 0; k < 8; k++) {
          await page.evaluate(() => window.solarbloom.camera.orbit(45));
          await page.waitForTimeout(250);
          d.push(await page.evaluate(() => window.solarbloom.app.stats.drawCalls.total));
        }
        d.sort((a, b) => a - b);
        return d[Math.floor(d.length / 2)];
      };
      const without = await draws();
      const many = await page.evaluate(() => {
        const s = window.solarbloom.sim;
        let laid = 0;
        for (let z = 11; z < 26; z += 3) if (s.paths.add([[6.5, z + 0.5], [15.5, z + 1.5], [23.5, z + 0.5]], z % 2, 'gravel').id) laid++;
        for (let x = 7; x < 24; x += 4) if (s.paths.add([[x + 0.5, 10.5], [x + 1.5, 26.5]], 0, 'steppingStones').id) laid++;
        return laid;
      });
      await page.waitForTimeout(1500);
      const withPaths = await draws();
      await page.screenshot({ path: `${dir}/ui-paths-region.png` });
      const tris = await page.evaluate(() => window.solarbloom.pathArt.tris);
      check(withPaths <= LIMIT && withPaths - without <= 2, T(`a region full of paths (${many}) in the Deck preset: ${withPaths} draw calls (was ${without}, limit ${LIMIT}), ${tris} triangles`));
    }
    check(errors.length === 0, T(`no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`));
    await page.context().close();
  }
} finally {
  await browser.close();
  await server?.close();
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
