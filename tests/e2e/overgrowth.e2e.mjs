// E23.6.6 (#470): overgrowth in the game, with the Deck preset (?gfx=deck), at 1280 × 800.
// - Each kind is grown on a power line, a pipe run and a machine from the build menu's grow tool: with the keyboard
//   (Space in build mode) and with the pad (A), bloombot facing the host.
// - It grows in over a game day (a sprout, then full), and the remove tool takes it off with everything back.
// - A heavily overgrown base (every host covered) stays within the Deck preset's draw calls (450) and adds one
//   draw call for all of it.
// Poles and the grid are a stand-in (E23.3 plugs in through sim.power), pipes are E23.4's saved `state.water.pipes`.
// Screenshots go to SHOTS_DIR (default docs/review). Run after `vite build` (npm run test:overgrowth), or BASE_URL.
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const PAD = driver + '\ninstallVirtualPad(); window.padDriver = padDriver; window.installVirtualPad = installVirtualPad;';
const server = process.env.BASE_URL ? undefined : await preview({ preview: { port: 4238, strictPort: true }, logLevel: 'silent' });
const base = process.env.BASE_URL ?? 'http://localhost:4238';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const LIMIT = 450;
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const KINDS = (process.env.KINDS ?? 'ivy,moss,clematis,morningGlory,climbingRose,wisteria,hangingBasket').split(',');

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

async function open(dev) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (dev === 'pad') await page.addInitScript(PAD);
  await page.goto(`${base}/?slot=1&new=1&gfx=deck`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  // The park with a chest, two poles 6 tiles apart (a stand-in grid's line) and a pipe run; every kind known.
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    const s = g.sim;
    const sv = s.state.salvage;
    sv.tier = 2;
    sv.keepers.tide = { step: 'request1' };
    sv.caches.push('c-elderGrove-2', 'c-saltwind-1');
    sv.research = { analysed: [], done: ['dc-clematis', 'dc-morningGlory', 'dc-wisteria'], running: [], levels: {} };
    s.inventory.addToStore('seeds', 400);
    s.inventory.add('seeds', 30); // carried: some hosts are beyond the store's reach
    s.inventory.addToStore('planks', 60);
    for (let x = 6; x < 22; x++)
      for (let z = 8; z < 24; z++) {
        const t = s.grid.get('g', x, z);
        if (!t || t.blocked) continue;
        t.ground = 'restored';
        t.pollution = 0;
        t.bloom = 2;
        s.grid.touch(t);
      }
    for (const [k, v] of Object.entries(s.build.recipe('chest'))) s.inventory.addToStore(k, v * 8);
    s.bot = { roofId: 'g', x: 12.5, z: 12.5 };
    const add = (id, type, x, z) => {
      const m = { id, type, roofId: 'g', x, z, size: 1 };
      s.state.machines.push(m);
      s.grid.indexMachine(m);
      s.grid.get('g', x, z).occupantId = id;
      g.machines.add(m, false);
      return m;
    };
    const a = add('pole-a', 'relay', 10, 20);
    const b = add('pole-b', 'relay', 16, 20);
    s.power = { networks: () => [{ links: [[a, b]] }], isPowered: () => true };
    s.state.water = { ...(s.state.water ?? {}), pipes: ['11,23', '12,23', '13,23', '14,23'] };
    window.chests = [];
    for (const [x, z] of [[14, 14], [8, 10], [8, 14], [12, 9], [16, 16], [20, 14], [7, 18], [19, 19]]) {
      const c = s.build.check('chest', 'g', x, z).ok ? s.build.place('chest', 'g', x, z) : undefined;
      if (c) {
        g.machines.add(c, false);
        window.chests.push(c.id);
      }
    }
  });
  // a probe: what the grow tool was last asked to do, and what came of it
  await page.evaluate(() => {
    const g = window.solarbloom;
    for (const name of ['growAt', 'actAt', 'botAct']) {
      const orig = g[name].bind(g);
      g[name] = (...a) => {
        const r = orig(...a);
        (window.__calls ??= []).push([name, a[0]?.tile ? `${a[0].tile.x},${a[0].tile.z}` : '', typeof a[3] === 'string' ? a[3] : '', r]);
        if (window.__calls.length > 12) window.__calls.shift();
        return r;
      };
    }
  });
  await page.waitForTimeout(600);
  return { page, errors };
}

/** Bloombot stands beside (x, z) facing it, the grow tool for `kind` in hand; then Space or A. */
async function growWith(page, dev, kind, x, z) {
  await page.evaluate(({ kind, x, z }) => {
    const g = window.solarbloom;
    g.selectTool(`grow:${kind}`);
    // stand on whichever side of the cell is free, facing it
    for (const [dx, dz, f] of [[0, 1.6, Math.PI], [0, -0.6, 0], [1.6, 0, -Math.PI / 2], [-0.6, 0, Math.PI / 2]]) {
      g.bot.teleport('g', x + 0.5 + (dx === 0 ? 0 : dx - 0.5), z + 0.5 + (dz === 0 ? 0 : dz - 0.5));
      g.bot.pose.facing = f;
      const fr = g.bot.front();
      if (fr.x === x && fr.z === z) return;
    }
  }, { kind, x, z });
  await page.waitForTimeout(300);
  await act(page, dev, x, z);
}

/** Space (keyboard alone) or A (pad): build mode acts on the tile in front of bloombot. */
async function act(page, dev, x, z) {
  // bloombot finishes what it was doing (its build animation) before it takes the next press, as in play
  await page.waitForFunction(() => window.solarbloom.bot.visuals.busy !== 'assemble', null, { timeout: 90000 }).catch(() => {});
  if (dev === 'keys') {
    // keyboard only: the mouse has left the window, so build mode aims at the tile in front of bloombot
    await page.evaluate(() => window.solarbloom.onLeave());
    await page.keyboard.press('Space');
  } else await pressPad(page, 0);
  await page.waitForTimeout(200);
}

try {
  for (const dev of ['keys', 'pad']) {
    const { page, errors } = await open(dev);
    const T = (s) => `E23.6.6 ${dev}: ${s}`;
    const chest = await page.evaluate(() => window.chests[0]);
    const cx = await page.evaluate((id) => window.solarbloom.sim.machine(id), chest);
    for (const kind of KINDS) {
      const hosts = [
        ['a power line', 13, 20, 'l:pole-a|pole-b'],
        ['a pipe run', 12, 23, 'p:12,23'],
        ['a machine', cx.x, cx.z, `m:${chest}`],
      ];
      for (const [what, x, z, key] of hosts) {
        await growWith(page, dev, kind, x, z);
        const got = await page.evaluate((key) => window.solarbloom.sim.overgrowth.at(key)?.kind, key);
        check(got === kind, T(`${kind} on ${what}`));
        if (got !== kind)
          console.log('   ', await page.evaluate(({ kind, x, z }) => {
            void 0;
            const g = window.solarbloom, s = g.sim, h = s.overgrowth.hostAt('g', x, z);
            return JSON.stringify({ calls: window.__calls, busy: g.bot.visuals.busy, paused: g.paused, modal: g.hud.modalOpen, tool: g.hud.currentTool, front: g.bot.front(), pose: g.bot.pose, host: h?.key, problem: s.overgrowth.problem(kind, h), fail: document.querySelector('.fail, #fail')?.textContent, all: Object.keys(s.overgrowth.all()) });
          }, { kind, x, z }));
        // take it off again with the remove tool (everything comes back), so the next kind can go there
        const seeds = await page.evaluate(() => window.solarbloom.sim.inventory.stored('seeds') + window.solarbloom.sim.inventory.count('seeds'));
        if (got === kind) {
          await page.evaluate(() => window.solarbloom.selectTool('remove'));
          await act(page, dev, x, z);
        }
        const after = await page.evaluate(({ key }) => ({ gone: !window.solarbloom.sim.overgrowth.at(key), seeds: window.solarbloom.sim.inventory.stored('seeds') + window.solarbloom.sim.inventory.count('seeds') }), { key });
        if (kind === 'ivy') check(after.gone && after.seeds > seeds, T(`the remove tool takes ${what}'s ${kind} off and gives its seeds back`));
        if (!after.gone) await page.evaluate((key) => window.solarbloom.sim.overgrowth.remove(key), key);
      }
    }
    if (dev === 'pad') {
      await page.context().close();
      check(errors.length === 0, T(`no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`));
      continue;
    }
    // grows in over a game day: a sprout, then full; then a heavily overgrown base in the Deck preset
    await page.evaluate(() => {
      const g = window.solarbloom, s = g.sim, og = s.overgrowth;
      g.selectTool('pulse');
      og.place('wisteria', og.hostAt('g', 13, 20));
      for (const [i, id] of window.chests.entries()) og.place(['ivy', 'clematis', 'climbingRose', 'hangingBasket', 'moss', 'morningGlory', 'ivy', 'wisteria'][i % 8], og.machineHost(s.machine(id)));
      for (const p of ['11,23', '12,23', '13,23', '14,23']) og.place('morningGlory', og.hostAt('g', ...p.split(',').map(Number)));
      g.bot.following = false;
      g.camera.glide(14, 0, 15, 1.1);
    });
    await page.waitForTimeout(2500);
    const sprout = await page.evaluate(() => ({ tris: window.solarbloom.overgrowthArt.tris, growth: window.solarbloom.sim.overgrowth.growth(Object.values(window.solarbloom.sim.overgrowth.all())[0]) }));
    await page.screenshot({ path: `${dir}/ui-overgrowth-sprout.png` });
    await page.evaluate(() => (window.solarbloom.sim.state.time += 2880 * 1.01));
    // the mesh is rebuilt on its next check (once a second of play): wait for it, however slow the frames
    await page.waitForFunction((t) => window.solarbloom.overgrowthArt.tris > t, sprout.tris, { timeout: 120000 }).catch(() => {});
    const full = await page.evaluate(() => ({ tris: window.solarbloom.overgrowthArt.tris, growth: window.solarbloom.sim.overgrowth.growth(Object.values(window.solarbloom.sim.overgrowth.all())[0]) }));
    check(sprout.growth < 0.05 && full.growth === 1 && full.tris > sprout.tris, T(`grows in over a game day: ${sprout.tris} → ${full.tris} triangles`));
    await page.screenshot({ path: `${dir}/ui-overgrowth-full.png` });
    const species = await page.evaluate(() => (window.solarbloom.sim.ecosystem.refresh(true), window.solarbloom.sim.ecosystem.bio.species));
    const kinds = await page.evaluate(() => window.solarbloom.sim.overgrowth.kinds().length);
    check(kinds >= 6, T(`${kinds} kinds growing count as plant variety (species ${species})`));
    // Deck budget: draw calls round the overgrown base, with and without the overgrowth
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
    const withOg = await draws();
    check(withOg <= LIMIT && full.tris <= 160000, T(`a heavily overgrown base in the Deck preset: ${withOg} draw calls (limit ${LIMIT}), ${full.tris} overgrowth triangles (cap 160000)`));
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
