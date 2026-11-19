// E23.6.4 (#393) and E23.6.5 (#394): automation in the game, at 1280 × 800, on the keyboard alone and the pad alone.
// - set down a supply crate and an Assembler from the build menu (bloombot faces the tile; Space or A places);
// - open the crate with Interact (E or A): the game pauses; put Copper in, set a courier route to another crate and
//   change what it carries, all with the arrows / d-pad and Enter / A; Esc / B closes it;
// - a Drone Hub on the Courier role flies the route by itself; the Assembler beside the target crate, told to make
//   Wire in its panel, crafts into the crate beside it, on (stand-in) grid power.
// Screenshots go to SHOTS_DIR (default docs/review). Run after `vite build`, or against a dev server with BASE_URL.
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const PAD = driver + '\ninstallVirtualPad(); window.padDriver = padDriver; window.installVirtualPad = installVirtualPad;';
const port = Number(process.env.PORT ?? 4241);
const server = process.env.BASE_URL ? undefined : await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const base = process.env.BASE_URL ?? `http://localhost:${port}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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

/** Bloombot stands beside (x, z), facing it (the first free side). */
async function stand(page, x, z) {
  // the last build's assembly animation ends first (bloombot can't act while it plays)
  await page.waitForFunction(() => window.solarbloom.bot.visuals.busy !== 'assemble', null, { timeout: 90000 }).catch(() => {});
  await page.evaluate(({ x, z }) => {
    const g = window.solarbloom;
    g.bot.cancelWalk();
    for (const [dx, dz, f] of [[0, 1.1, Math.PI], [0, -1.1, 0], [1.1, 0, -Math.PI / 2], [-1.1, 0, Math.PI / 2]]) {
      const t = g.sim.grid.get('g', Math.floor(x + 0.5 + dx), Math.floor(z + 0.5 + dz));
      if (!t || t.occupantId || t.blocked) continue;
      g.bot.teleport('g', x + 0.5 + dx, z + 0.5 + dz);
      g.bot.pose.facing = f;
      const fr = g.bot.front();
      if (fr.x === x && fr.z === z) return;
    }
  }, { x, z });
  await page.waitForTimeout(300);
}

/**
 * Places what is in hand with its corner at (x, z), aimed as a player aims in third person (#542): build mode places
 * under the crosshair, so bloombot stands a step or two away and the view turns and tilts until the crosshair rests
 * on the spot, then Space or A places.
 * - pad: the right stick, frame by frame (as tests/e2e/gamepad-driver.js does);
 * - keyboard and mouse: mouse-look, through the handler the captured mouse calls (`Game.mouseLook`: a headless
 *   browser can't capture the pointer).
 * Returns whether it got aimed.
 */
async function place(page, dev, x, z) {
  await page.waitForFunction(() => window.solarbloom.bot.visuals.busy !== 'assemble', null, { timeout: 90000 }).catch(() => {});
  const aimed = await page.evaluate(async ({ x, z, dev }) => {
    const g = window.solarbloom;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const size = { crate: 1, assembler: 2 }[g.hud.currentTool] ?? 1;
    const cx = x + size / 2, cz = z + size / 2;
    const state = () => {
      const p = g.bot.pose;
      const aim = g.crosshairPick();
      const a = aim && g.sim.build.anchorFor(g.hud.currentTool, aim.fx, aim.fz);
      if (a && a.x === x && a.z === z) return { on: true };
      const tx = cx - p.x, tz = cz - p.z;
      const want = (Math.atan2(tx, tz) * 180) / Math.PI;
      const now = aim ? (Math.atan2(aim.fx - p.x, aim.fz - p.z) * 180) / Math.PI : g.camera.yaw + 180;
      return { on: false, yawErr: ((((want - now) % 360) + 540) % 360) - 180, distErr: (aim ? Math.hypot(aim.fx - p.x, aim.fz - p.z) : 0) - Math.hypot(tx, tz) };
    };
    for (const k of [2, 2.5, 1.6])
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const sx = cx + dx * (k + (size - 1) / 2), sz = cz + dz * (k + (size - 1) / 2);
        const t = g.sim.grid.get('g', Math.floor(sx), Math.floor(sz));
        if (!t || t.occupantId || t.blocked) continue;
        g.bot.cancelWalk();
        g.bot.teleport('g', sx, sz);
        if (Math.hypot(g.bot.pose.x - sx, g.bot.pose.z - sz) > 0.05) continue; // not somewhere bloombot stands
        let still = 0; // frames the crosshair has rested on the spot (the view eases: it must stay there)
        const t0 = performance.now();
        let last;
        // (a headless browser draws a frame a second or so: the steps are few and large, and settle over two frames)
        for (let i = 0; i < 40 && performance.now() - t0 < 90000; i++) {
          await frame();
          await frame();
          const st = state();
          if (st.on) {
            if (dev === 'pad') window.__pad.axes[2] = window.__pad.axes[3] = 0;
            if (++still >= 2) return true;
            continue;
          }
          still = 0;
          last = st;
          if (dev === 'pad') {
            window.__pad.axes[2] = Math.abs(st.yawErr) > 3 ? -Math.max(-1, Math.min(1, st.yawErr / 40)) * 0.6 : 0;
            window.__pad.axes[3] = Math.abs(st.yawErr) <= 25 ? Math.max(-1, Math.min(1, st.distErr)) * 0.5 : 0;
            continue;
          }
          // keyboard and mouse: the captured mouse's movement, through the game's own handler (Game.mouseLook); the
          // crosshair turns with the view, 0.16° a pixel
          g.mouseLook(-st.yawErr / 0.16, Math.abs(st.yawErr) <= 10 ? Math.max(-60, Math.min(60, st.distErr * 40)) : 0);
        }
        if (dev === 'pad') window.__pad.axes[2] = window.__pad.axes[3] = 0;
        console.log(`aim from ${sx},${sz}: ${JSON.stringify(last)}`);
      }
    return false;
  }, { x, z, dev });
  if (!aimed) {
    console.log(`   place ${x},${z}: the crosshair never rested on it`);
    return false;
  }
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => {
    const g = window.solarbloom;
    window.__fails = [];
    if (!g.hud.__failHook) {
      const o = g.hud.showFail.bind(g.hud);
      g.hud.showFail = (m, ...a) => (window.__fails.push(m), o(m, ...a));
      g.hud.__failHook = true;
    }
    return g.sim.state.machines.length;
  });
  if (dev === 'pad') await pressPad(page, 0);
  else await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ n: window.solarbloom.sim.state.machines.length, fails: window.__fails, tool: window.solarbloom.hud.currentTool, busy: window.solarbloom.bot.visuals.busy }));
  if (after.n === before) console.log(`   place ${x},${z}: aimed, but nothing was built (${JSON.stringify(after)})`);
  return after.n > before;
}

/** Moves the focus onto an element with the d-pad or the arrow keys, as a player would. */
async function moveTo(page, sel, dev) {
  for (let i = 0; i < 80; i++) {
    const dir = await page.evaluate((sel) => {
      const t = document.querySelector(sel);
      const c = document.activeElement;
      if (!t) return 'missing';
      if (c === t) return 'here';
      if (!c || c === document.body) return 'down';
      const a = c.getBoundingClientRect(), b = t.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      return Math.abs(dy) > 6 ? (dy > 0 ? 'down' : 'up') : dx > 0 ? 'right' : 'left';
    }, sel);
    if (dir === 'here') return true;
    if (dir === 'missing') break;
    if (dev === 'pad') await pressPad(page, { up: 12, down: 13, left: 14, right: 15 }[dir]);
    else await page.keyboard.press({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[dir]);
    await page.waitForTimeout(30);
  }
  console.log(`   moveTo ${sel}: stopped at ${await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}`);
  return false;
}
const go = (page, dev) => (dev === 'pad' ? pressPad(page, 0) : page.keyboard.press('Enter'));
const back = (page, dev) => (dev === 'pad' ? pressPad(page, 1) : page.keyboard.press('Escape'));
const interact = (page, dev) => (dev === 'pad' ? pressPad(page, 0) : page.keyboard.press('KeyE'));

async function open(dev) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.text().startsWith('aim from') && console.log(`   ${m.text()}`));
  if (dev === 'pad') await page.addInitScript(PAD);
  await page.goto(`${base}/?slot=1&new=1&gfx=deck`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  // An Old City game further in: things carried to the store and components made by hand (so crates, couriers and the
  // Assembler are open), the Spire Heights Keeper met, the park restored round (6..26, 8..24), materials in the
  // store, and a Drone Hub on the Courier role on the park's open ground west of the fountain (x < 16: east of it is the plinth's edge). The grid is a stand-in that is always on (E23.3's
  // poles are not laid in a test).
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    const s = g.sim;
    const sv = s.state.salvage;
    sv.tier = 2;
    sv.hand = { carry: 8, craft: 12 };
    sv.keepers.atlas = { step: 'request1' };
    Object.assign(s.power, { isPowered: () => true });
    for (let x = 6; x < 27; x++)
      for (let z = 8; z < 25; z++) {
        const t = s.grid.get('g', x, z);
        if (!t || t.occupantId) continue;
        t.blocked = false;
        t.feature = t.feature === 'water' ? 'lawn' : t.feature;
        t.ground = 'restored';
        t.pollution = 0;
        t.bloom = 2;
        s.grid.touch(t);
        g.chunks.markTile(t);
      }
    for (const type of ['crate', 'crate', 'crate', 'assembler', 'droneHub'])
      for (const [k, v] of Object.entries(s.build.recipe(type))) if (k !== 'biomass') s.inventory.add(k, v);
    s.inventory.add('copper', 40);
    // the hub's refit to a new role (E18) is paid from the Energy and Water gauges and, in the Old City, Biomass from
    // the backpack: the Courier's 80 fits once the Roomier backpack research has two levels (stacks of 80)
    for (const k of ['energy', 'water']) s.econ.add(k, 200);
    sv.research = { analysed: [], done: [], running: [], levels: { backpack: 2 } };
    s.inventory.add('biomass', 80);
    const why = s.build.check('droneHub', 'g', 10, 10);
    return s.build.place('droneHub', 'g', 10, 10) ? undefined : why;
  }).then((why) => why && console.log(`   hub not placed: ${JSON.stringify(why)}`));
  await page.waitForTimeout(600);
  return { page, errors };
}

try {
  for (const dev of (process.env.DEVS ?? 'keys,pad').split(',')) {
    const { page, errors } = await open(dev);
    const T = (s) => `E23.6.4 ${dev}: ${s}`;
    // the hub's panel: the Courier role is open (things were carried by hand); pick it with the arrows / d-pad
    // (Interact, E or A, on the hub: "Look at Drone Hub" opens its panel)
    const hubAt = await page.evaluate(() => {
      const m = window.solarbloom.sim.machinesOfType('droneHub')[0];
      return m && { id: m.id, x: m.x, z: m.z };
    });
    const hubId = hubAt?.id;
    await stand(page, hubAt.x, hubAt.z);
    const hubTarget = await page.evaluate(() => window.solarbloom.interactTarget()?.id);
    check(hubTarget === `m:${hubId}`, T(`facing the hub, Interact offers to look at it (${hubTarget})`));
    await interact(page, dev);
    await page.waitForSelector('#inspect.open', { timeout: 10000 }).catch(() => {});
    check(await moveTo(page, `[data-role="${hubId}|courier|1"]`, dev), T('Interact on the hub opens its panel; reach the Courier role there'));
    await page.screenshot({ path: `${dir}/ui-hub-courier-${dev}.png` });
    await go(page, dev);
    await page.waitForTimeout(200);
    await back(page, dev);
    await page.waitForTimeout(200);
    check(await page.evaluate(() => !document.querySelector('#inspect.open')), T('Esc / B closes the hub panel'));
    const hub = await page.evaluate(() => window.solarbloom.sim.machinesOfType('droneHub').map((m) => ({ id: m.id, x: m.x, z: m.z, role: window.solarbloom.sim.roles.roleOf(m) }))[0]);
    check(hub?.role === 'courier', T(`a Drone Hub on the Courier role (${JSON.stringify(hub)})`));
    // set down a crate (A) and an Assembler from the build menu
    await page.evaluate(() => window.solarbloom.selectTool('crate'));
    // crate A on the first level tile west of the hub (the park's steps and slopes are not level)
    const aAt = await page.evaluate(() => {
      const s = window.solarbloom.sim;
      return [[8, 14], [7, 13], [8, 13], [9, 14], [7, 12], [8, 12], [11, 13], [12, 13]].find(([x, z]) => s.build.check('crate', 'g', x, z).ok);
    });
    await place(page, dev, aAt[0], aAt[1]);
    await page.evaluate(() => window.solarbloom.selectTool('assembler'));
    await place(page, dev, 12, 16);
    await page.evaluate(() => window.solarbloom.selectTool('pulse'));
    const built = await page.evaluate(() => {
      const s = window.solarbloom.sim;
      return { crates: s.machinesOfType('crate').map((m) => [m.x, m.z]), asm: s.machinesOfType('assembler').map((m) => [m.x, m.z]) };
    });
    check(built.crates.length === 1 && built.asm.length === 1, T(`a crate and an Assembler set down from the build menu (${JSON.stringify(built)})`));
    // two more crates beside the Assembler: the nearer is what it uses (B), the other what it makes (C)
    const ids = await page.evaluate(() => {
      const s = window.solarbloom.sim;
      const a = s.machinesOfType('crate')[0];
      const m = s.machinesOfType('assembler')[0];
      const free = (x, z) => s.build.check('crate', 'g', x, z).ok;
      const spot = (cands) => cands.find(([x, z]) => free(x, z));
      const bAt = spot([[m.x - 1, m.z], [m.x - 1, m.z + 1], [m.x, m.z - 1], [m.x, m.z + 2]]);
      const B = bAt && s.build.place('crate', 'g', bAt[0], bAt[1]);
      const cAt = spot([[m.x + 2, m.z + 2], [m.x + 3, m.z], [m.x + 2, m.z - 1], [m.x - 1, m.z + 2]]);
      const C = cAt && s.build.place('crate', 'g', cAt[0], cAt[1]);
      return { a: a?.id, b: B?.id, c: C?.id, asm: m?.id, io: m && s.automation.io(m) && { input: s.automation.io(m).input?.id, output: s.automation.io(m).output?.id } };
    });
    check(ids.b && ids.c && ids.io?.input === ids.b && ids.io?.output === ids.c, T(`the Assembler takes from the crate beside it and puts in the next (${JSON.stringify(ids)})`));
    // open crate A with Interact
    const a = await page.evaluate((id) => window.solarbloom.sim.machine(id), ids.a);
    await stand(page, a.x, a.z);
    const prompt = await page.evaluate(() => window.solarbloom.interactTarget()?.id);
    check(prompt === `crate:${ids.a}`, T(`bloombot facing the crate offers to open it (${prompt})`));
    await interact(page, dev);
    await page.waitForSelector('#crateScreen.open', { timeout: 10000 }).catch(() => {});
    check(await page.evaluate(() => window.solarbloom.hud.crate.isOpen && window.solarbloom.paused), T('the crate opens and the game pauses'));
    // put all the Copper in
    check(await moveTo(page, '#ctitem-copper', dev), T('reach Copper'));
    await go(page, dev);
    check(await moveTo(page, '#ct-put-all', dev), T('reach "Put all of it in the crate"'));
    await go(page, dev);
    const moved = await page.evaluate((id) => ({ crate: window.solarbloom.sim.automation.count(id, 'copper'), pack: window.solarbloom.sim.inventory.count('copper'), live: document.querySelector('#crateScreen .bp-live').textContent }), ids.a);
    check(moved.crate === 40 && moved.pack === 0, T(`all the Copper is in the crate (${JSON.stringify(moved)})`));
    // a courier route to crate B, then carry Copper only
    check(await moveTo(page, `#ct-send-${ids.b}`, dev), T('reach "Send to" the crate by the Assembler'));
    await go(page, dev);
    const route = await page.evaluate(() => window.solarbloom.sim.automation.routes()[0]);
    check(route?.from === ids.a && route?.to === ids.b && route?.item === 'all', T(`a route from crate A to crate B, everything (${JSON.stringify(route)})`));
    if (route) {
      if (!(await page.evaluate((id) => document.activeElement?.id === `ct-item-${id}`, route.id))) await moveTo(page, `#ct-item-${route.id}`, dev);
      await go(page, dev);
      const item = await page.evaluate(() => window.solarbloom.sim.automation.routes()[0].item);
      check(item === 'copper', T(`pressing what it carries steps to Copper (${item})`));
    }
    await page.screenshot({ path: `${dir}/ui-crate-${dev}.png` });
    const fits = await page.evaluate(() => {
      const r = document.querySelector('#crateScreen .bp-card').getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    });
    check(fits, T('the crate panel fits 1280 × 800'));
    await back(page, dev);
    await page.waitForTimeout(200);
    check(await page.evaluate(() => !window.solarbloom.hud.crate.isOpen && !window.solarbloom.paused), T('Esc / B closes it and the game runs again'));
    // the Assembler: make Wire, from its inspect panel
    const asmAt = await page.evaluate((id) => {
      const m = window.solarbloom.sim.machine(id);
      return { x: m.x, z: m.z };
    }, ids.asm);
    await stand(page, asmAt.x, asmAt.z);
    await interact(page, dev);
    await page.waitForSelector('#inspect.open', { timeout: 10000 }).catch(() => {});
    const wireBtn = `[data-asm="${ids.asm}|wire"]`;
    check(await moveTo(page, wireBtn, dev), T('reach Wire in the Assembler panel'));
    await go(page, dev);
    check(await page.evaluate((id) => window.solarbloom.sim.automation.recipeOf(window.solarbloom.sim.machine(id)), ids.asm) === 'wire', T('the Assembler makes Wire'));
    // the world runs: couriers carry Copper to B; the Assembler makes Wire into C
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.bot.following = false;
      g.camera.glide(11, 0, 14, 1.2);
    });
    await page.waitForFunction((id) => window.solarbloom.sim.state.drones.some((d) => d.route), ids.a, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${dir}/ui-courier-flying-${dev}.png` });
    await page.evaluate(() => window.solarbloom.sim.advance(600));
    await page.waitForTimeout(1500);
    const after = await page.evaluate(({ a, b, c, asm }) => {
      const s = window.solarbloom.sim, au = s.automation;
      return { a: au.contents(a), b: au.contents(b), c: au.contents(c), why: au.assemblerProblem(s.machine(asm)) ?? 'working' };
    }, ids);
    check(!after.a.copper && (after.c.wire ?? 0) >= 20, T(`couriers carried the Copper and the Assembler made Wire (${JSON.stringify(after)})`));
    await page.screenshot({ path: `${dir}/ui-assembler-${dev}.png` });
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
