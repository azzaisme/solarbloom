// E23.6.4 (#393) and E23.6.5 (#394): automation in the game, at 1280 × 800, on the keyboard alone and the pad alone,
// on the real grid (solar panels beside the hub and the Assembler) and in game time:
// - the jobs done by hand open it: things put in the store and taken out 8 times (the backpack), 12 Wire made at the
//   crafting table;
// - set down a supply crate and an Assembler from the build menu (Space or A places under the crosshair);
// - open the crate with Interact (E or A): the game pauses; put Copper in, set a courier route to another crate and
//   change what it carries, all with the arrows / d-pad and Enter / A; Esc / B closes it;
// - in the Assembler's panel, choose its input and output crates and Wire;
// - a Drone Hub on the Courier role flies the route by itself (seen close, mid-flight), and the Assembler crafts the
//   Copper into Wire in its output crate.
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
 * Places what is in hand with its corner at (x, z), aimed as in third person (#542): build mode places under the
 * crosshair, which rests a little ahead of bloombot, so bloombot steps until the ghost sits on the spot (as a player
 * walks the ghost over it), then Space or A places. The steps are moves to where bloombot stands next (the e2e's
 * own walking is not under test here). Returns whether something was built.
 */
async function place(page, dev, x, z) {
  await page.waitForFunction(() => window.solarbloom.bot.visuals.busy !== 'assemble', null, { timeout: 90000 }).catch(() => {});
  const aimed = await page.evaluate(async ({ x, z }) => {
    const g = window.solarbloom;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    if (!['crate', 'assembler'].includes(g.hud.currentTool)) return { ok: false, why: `${g.hud.currentTool} in hand` };
    const size = { crate: 1, assembler: 2 }[g.hud.currentTool];
    const cx = x + size / 2, cz = z + size / 2;
    const on = () => {
      const p = g.crosshairPick();
      const a = p && g.sim.build.anchorFor(g.hud.currentTool, p.fx, p.fz);
      return { ok: !!a && a.x === x && a.z === z, p };
    };
    // start two tiles short of the spot, on the side bloombot can stand
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const sx = cx + dx * (2 + (size - 1) / 2), sz = cz + dz * (2 + (size - 1) / 2);
      g.bot.cancelWalk();
      g.bot.teleport('g', sx, sz);
      if (Math.hypot(g.bot.pose.x - sx, g.bot.pose.z - sz) < 0.05) break;
    }
    let last;
    for (let i = 0; i < 12; i++) {
      for (let f = 0; f < 3; f++) await frame();
      const st = on();
      if (st.ok) {
        await frame();
        if (on().ok) return { ok: true };
        continue;
      }
      if (!st.p) break;
      last = [st.p.fx, st.p.fz];
      // step by how far the crosshair is from the spot's middle
      const nx = g.bot.pose.x + (cx - st.p.fx), nz = g.bot.pose.z + (cz - st.p.fz);
      g.bot.cancelWalk();
      g.bot.teleport('g', nx, nz);
    }
    return { ok: false, last, pose: [g.bot.pose.x, g.bot.pose.z] };
  }, { x, z });
  if (!aimed.ok) {
    console.log(`   place ${x},${z}: the crosshair never rested on it (${JSON.stringify(aimed)})`);
    return false;
  }
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
  const after = await page.evaluate(() => ({ n: window.solarbloom.sim.state.machines.length, fails: window.__fails, pack: window.solarbloom.sim.state.salvage.pack, limit: window.solarbloom.sim.inventory.stackLimit() }));
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
/** Takes a build from the build menu as a player does: Q (Y on the pad) opens it, the arrows / d-pad reach the card, Enter / A takes it. */
async function pick(page, dev, tool) {
  if (dev === 'pad') await pressPad(page, 3);
  else await page.keyboard.press('KeyQ');
  await page.waitForSelector('#buildTray.open', { timeout: 10000 }).catch(() => {});
  const ok = await moveTo(page, `#buildTray.open [data-tool="${tool}"]`, dev);
  if (ok) await go(page, dev);
  await page.waitForTimeout(300);
  return ok && (await page.evaluate(() => window.solarbloom.hud.currentTool)) === tool;
}
const go = (page, dev) => (dev === 'pad' ? pressPad(page, 0) : page.keyboard.press('Enter'));
const back = (page, dev) => (dev === 'pad' ? pressPad(page, 1) : page.keyboard.press('Escape'));
const interact = (page, dev) => (dev === 'pad' ? pressPad(page, 0) : page.keyboard.press('KeyE'));

async function open(dev) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (dev === 'pad') await page.addInitScript(PAD);
  await page.goto(`${base}/?slot=1&new=1&gfx=deck`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  // An Old City game further in: the Spire Heights Keeper met (the Assembler's region) and Tally (solar panels), the
  // park restored round (6..26, 8..24), materials for the builds, and a Drone Hub on the park's open ground west of
  // the fountain (x < 16: east of it is the plinth's edge), with solar panels beside it on the real grid (E23.3). No job
  // is done by hand yet: the test does them. The weather is held sunny so the panels' output does not hang on it.
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    const s = g.sim;
    const sv = s.state.salvage;
    sv.tier = 2;
    sv.keepers.atlas = { step: 'request1' };
    sv.keepers.tally = { step: 'request1' };
    s.weather.forceForTest('sunny', Infinity);
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
    // the hub's refit to a new role is paid in Biomass from the backpack (E23.1.4): the Courier's 80 fits once the
    // Roomier backpack research has two levels (stacks of 80)
    sv.research = { analysed: [], done: [], running: [], levels: { backpack: 2 } };
    // the hub and its panels are set down below from the store; what bloombot builds later it carries
    for (const type of ['droneHub', 'solar', 'solar']) for (const [k, v] of Object.entries(s.build.recipe(type))) s.inventory.addToStore(k, v);
    s.bot = { roofId: 'g', x: 10.5, z: 13.5 };
    g.bot.teleport('g', 10.5, 13.5);
    const hub = s.build.place('droneHub', 'g', 10, 10);
    let n = 0;
    for (const [x, z] of [[9, 10], [9, 11], [12, 10], [12, 11], [10, 12], [11, 12]]) if (n < 2 && s.build.place('solar', 'g', x, z)) n++;
    // (after those: a build pays from the backpack first)
    for (const type of ['crate', 'crate', 'crate', 'assembler', 'solar', 'solar']) for (const [k, v] of Object.entries(s.build.recipe(type))) s.inventory.add(k, v);
    s.inventory.add('biomass', 80);
    s.inventory.add('copper', 44); // 24 for the Wire made by hand at the table, 20 for the crate (two courier trips)
    return hub ? undefined : s.build.check('droneHub', 'g', 10, 10);
  }).then((why) => why && console.log(`   hub not placed: ${JSON.stringify(why)}`));
  await page.waitForTimeout(600);
  return { page, errors };
}

try {
  for (const dev of (process.env.DEVS ?? 'keys,pad').split(',')) {
    const { page, errors } = await open(dev);
    const T = (s) => `E23.6.4 ${dev}: ${s}`;
    const hand = () => page.evaluate(() => ({ carry: window.solarbloom.sim.automation.handCount('carry'), craft: window.solarbloom.sim.automation.handCount('craft') }));
    check((await hand()).carry === 0 && (await hand()).craft === 0, T('nothing done by hand yet'));
    check(await page.evaluate(() => !window.solarbloom.sim.build.isUnlocked('crate')), T('the Supply Crate is still locked'));
    // ── carrying by hand: things to and from the store, at the fountain, from the backpack (Tab / d-pad up) ──
    await page.evaluate(() => {
      const g = window.solarbloom, s = g.sim;
      const f = s.state.machines.find((m) => m.type === 'core' && s.areas.areaOf(m) === 'park');
      g.bot.teleport(f.roofId, f.x + f.size / 2, f.z + f.size + 1.6);
      g.bot.pose.facing = 0;
    });
    await page.waitForTimeout(400);
    if (dev === 'pad') await pressPad(page, 12);
    else await page.keyboard.press('Tab');
    await page.waitForSelector('#bpScreen.open');
    check(await moveTo(page, '#bpmat-copper', dev), T('the backpack: reach Copper'));
    await go(page, dev);
    for (let i = 0; i < 4; i++) {
      if (await moveTo(page, '#bp-put-1', dev)) await go(page, dev);
      if (await moveTo(page, '#bp-takeOut-1', dev)) await go(page, dev);
    }
    const carried = await hand();
    check(carried.carry === 8, T(`put Copper in the store and took it out, 8 times by hand (${carried.carry})`));
    await back(page, dev);
    await page.waitForTimeout(300);
    check(await page.evaluate(() => window.solarbloom.sim.build.isUnlocked('crate')), T('carrying by hand opened the Supply Crate'));
    // ── crafting by hand: 12 Wire at the table (Make 5, Make 5, Make 1, Make 1) ──
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.bot.teleport('g', 3.5, 5.5);
      g.bot.pose.facing = Math.PI;
    });
    await page.waitForTimeout(400);
    check((await page.evaluate(() => window.solarbloom.interactTarget()?.id)) === 'craft:table', T('at the shed: the crafting table'));
    await interact(page, dev);
    await page.waitForSelector('#craftScreen.open');
    check(await moveTo(page, '#crc-wire', dev), T('the table: reach Wire'));
    await go(page, dev);
    for (const n of [5, 5, 1, 1]) if (await moveTo(page, `#cr-make-${n}`, dev)) await go(page, dev);
    await page.waitForFunction(() => window.solarbloom.sim.automation.handCount('craft') >= 12, null, { timeout: 180000 }).catch(() => {});
    const crafted = await hand();
    check(crafted.craft === 12, T(`made 12 Wire at the table by hand (${crafted.craft})`));
    await back(page, dev);
    await page.waitForTimeout(300);
    check(await page.evaluate(() => window.solarbloom.sim.build.isUnlocked('assembler')), T('crafting by hand (with Spire Heights met) opened the Assembler'));
    // ── the hub: the Courier role is open now; pick it in its panel ──
    const hubAt = await page.evaluate(() => {
      const m = window.solarbloom.sim.machinesOfType('droneHub')[0];
      return m && { id: m.id, x: m.x, z: m.z, powered: window.solarbloom.sim.power.isPowered(m) };
    });
    check(hubAt?.powered, T(`the hub is on the real grid, powered by the panels beside it (${JSON.stringify(hubAt)})`));
    const hubId = hubAt?.id;
    await stand(page, hubAt.x, hubAt.z);
    const hubTarget = await page.evaluate(() => window.solarbloom.interactTarget()?.id);
    check(hubTarget === `m:${hubId}`, T(`facing the hub, Interact offers to look at it (${hubTarget})`));
    await interact(page, dev);
    await page.waitForSelector('#inspect.open', { timeout: 10000 }).catch(() => {});
    if (dev === 'keys') await page.waitForFunction(() => document.querySelector('#inspect.open')?.contains(document.activeElement), null, { timeout: 15000 }).catch(() => {});
    check(await moveTo(page, `[data-role="${hubId}|courier|1"]`, dev), T('Interact on the hub opens its panel; reach the Courier role there'));
    await page.screenshot({ path: `${dir}/ui-hub-courier-${dev}.png` });
    await go(page, dev);
    await page.waitForTimeout(200);
    await back(page, dev);
    await page.waitForTimeout(200);
    check(await page.evaluate(() => !document.querySelector('#inspect.open')), T('Esc / B closes the hub panel'));
    const hub = await page.evaluate(() => window.solarbloom.sim.machinesOfType('droneHub').map((m) => ({ id: m.id, x: m.x, z: m.z, role: window.solarbloom.sim.roles.roleOf(m) }))[0]);
    check(hub?.role === 'courier', T(`a Drone Hub on the Courier role (${JSON.stringify(hub)})`));
    // ── set down a crate (A) and an Assembler from the build menu ──
    check(await pick(page, dev, 'crate'), T('the Supply Crate is taken from the build menu'));
    const aAt = await page.evaluate(() => {
      const s = window.solarbloom.sim;
      return [[8, 14], [7, 13], [8, 13], [9, 14], [7, 12], [8, 12], [11, 13], [12, 13]].find(([x, z]) => s.build.check('crate', 'g', x, z).ok);
    });
    await place(page, dev, aAt[0], aAt[1]);
    check(await pick(page, dev, 'assembler'), T('the Assembler is taken from the build menu'));
    await place(page, dev, 12, 16);
    await back(page, dev); // nothing more to build: B / Esc puts it away
    await page.waitForTimeout(200);
    const built = await page.evaluate(() => {
      const s = window.solarbloom.sim;
      return { crates: s.machinesOfType('crate').map((m) => [m.x, m.z]), asm: s.machinesOfType('assembler').map((m) => [m.x, m.z]) };
    });
    check(built.crates.length === 1 && built.asm.length === 1, T(`a crate and an Assembler set down from the build menu (${JSON.stringify(built)})`));
    // two more crates beside the Assembler, and panels beside it on the grid (set down for the test: building is
    // under test above)
    const ids = await page.evaluate(() => {
      const s = window.solarbloom.sim;
      s.bot = { roofId: 'g', x: window.solarbloom.bot.pose.x, z: window.solarbloom.bot.pose.z };
      const a = s.machinesOfType('crate')[0];
      const m = s.machinesOfType('assembler')[0];
      const free = (type, x, z) => s.build.check(type, 'g', x, z).ok;
      const spot = (type, cands) => cands.find(([x, z]) => free(type, x, z));
      const bAt = spot('crate', [[m.x - 1, m.z], [m.x - 1, m.z + 1], [m.x, m.z - 1], [m.x, m.z + 2]]);
      const B = bAt && s.build.place('crate', 'g', bAt[0], bAt[1]);
      const cAt = spot('crate', [[m.x + 2, m.z + 2], [m.x + 3, m.z], [m.x + 2, m.z - 1], [m.x - 1, m.z + 2]]);
      const C = cAt && s.build.place('crate', 'g', cAt[0], cAt[1]);
      let n = 0;
      for (const [x, z] of [[m.x + 2, m.z], [m.x + 2, m.z + 1], [m.x, m.z + 2], [m.x + 1, m.z + 2], [m.x + 1, m.z - 1], [m.x, m.z - 1]]) if (n < 2 && free('solar', x, z) && s.build.place('solar', 'g', x, z)) n++;
      return { a: a?.id, b: B?.id, c: C?.id, asm: m?.id, panels: n };
    });
    check(ids.b && ids.c && ids.panels === 2, T(`two crates beside the Assembler, and two solar panels (${JSON.stringify(ids)})`));
    // ── open crate A with Interact: put the Copper in, send it to crate B ──
    const a = await page.evaluate((id) => window.solarbloom.sim.machine(id), ids.a);
    await stand(page, a.x, a.z);
    const prompt = await page.evaluate(() => window.solarbloom.interactTarget()?.id);
    check(prompt === `crate:${ids.a}`, T(`bloombot facing the crate offers to open it (${prompt})`));
    await interact(page, dev);
    await page.waitForSelector('#crateScreen.open', { timeout: 10000 }).catch(() => {});
    check(await page.evaluate(() => window.solarbloom.hud.crate.isOpen && window.solarbloom.paused), T('the crate opens and the game pauses'));
    check(await moveTo(page, '#ctitem-copper', dev), T('reach Copper'));
    await go(page, dev);
    check(await moveTo(page, '#ct-put-all', dev), T('reach "Put all of it in the crate"'));
    await go(page, dev);
    const moved = await page.evaluate((id) => ({ crate: window.solarbloom.sim.automation.count(id, 'copper'), pack: window.solarbloom.sim.inventory.count('copper'), live: document.querySelector('#crateScreen .bp-live').textContent }), ids.a);
    check(moved.crate === 20 && moved.pack === 0, T(`all the Copper is in the crate (${JSON.stringify(moved)})`));
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
    // the courier sets off as soon as the game runs again: hold it at home until the Assembler is set up
    await back(page, dev);
    await page.waitForTimeout(200);
    check(await page.evaluate(() => !window.solarbloom.hud.crate.isOpen && !window.solarbloom.paused), T('Esc / B closes it and the game runs again'));
    // ── the Assembler: its crates (B in, C out) and Wire, from its inspect panel ──
    const asmAt = await page.evaluate((id) => {
      const m = window.solarbloom.sim.machine(id);
      return { x: m.x, z: m.z };
    }, ids.asm);
    await stand(page, asmAt.x, asmAt.z);
    await interact(page, dev);
    await page.waitForSelector('#inspect.open', { timeout: 10000 }).catch(() => {});
    if (dev === 'keys') await page.waitForFunction(() => document.querySelector('#inspect.open')?.contains(document.activeElement), null, { timeout: 15000 }).catch(() => {});
    const io = () => page.evaluate((id) => {
      const s = window.solarbloom.sim, x = s.automation.io(s.machine(id));
      return { input: x.input?.id, output: x.output?.id };
    }, ids.asm);
    // the player chooses its crates: step "Takes from" until it is B, and "Puts in" until it is C
    for (let i = 0; i < 3 && (await io()).input !== ids.b; i++) if (await moveTo(page, `[data-asm-io="${ids.asm}|input"]`, dev)) await go(page, dev);
    for (let i = 0; i < 3 && (await io()).output !== ids.c; i++) if (await moveTo(page, `[data-asm-io="${ids.asm}|output"]`, dev)) await go(page, dev);
    const chosen = await io();
    check(chosen.input === ids.b && chosen.output === ids.c, T(`its panel sets which crate it takes from (B) and puts in (C) (${JSON.stringify(chosen)})`));
    const wireBtn = `[data-asm="${ids.asm}|wire"]`;
    check(await moveTo(page, wireBtn, dev), T('reach Wire in the Assembler panel'));
    await go(page, dev);
    check(await page.evaluate((id) => window.solarbloom.sim.automation.recipeOf(window.solarbloom.sim.machine(id)), ids.asm) === 'wire', T('the Assembler makes Wire'));
    await page.screenshot({ path: `${dir}/ui-assembler-${dev}.png` });
    await back(page, dev);
    await page.waitForTimeout(200);
    check(await page.evaluate(() => !document.querySelector('#inspect.open')), T('Esc / B closes the Assembler panel'));
    // ── the world runs in game time: a courier flies Copper from A to B (framed close, no panel), the Assembler makes
    //    Wire into C on grid power ──
    // bloombot stands a few tiles off the route's middle, facing it: the follow camera frames the courier close
    await page.evaluate(({ a, b }) => {
      const g = window.solarbloom, s = g.sim;
      const A = s.machine(a), B = s.machine(b);
      const mx = (A.x + B.x) / 2 + 0.5, mz = (A.z + B.z) / 2 + 0.5;
      for (const [dx, dz, f] of [[0, 3, Math.PI], [3, 0, -Math.PI / 2], [-3, 0, Math.PI / 2], [0, -3, 0]]) {
        g.bot.cancelWalk();
        g.bot.teleport('g', mx + dx, mz + dz);
        if (Math.hypot(g.bot.pose.x - mx - dx, g.bot.pose.z - mz - dz) < 0.05) {
          g.bot.pose.facing = f;
          break;
        }
      }
    }, ids);
    await page.keyboard.press('KeyC'); // recentre the camera behind bloombot
    const flying = await page
      .waitForFunction(
        () => {
          const g = window.solarbloom;
          const d = g.sim.state.drones.find((x) => x.cargo?.length);
          if (!d) return false;
          const a = g.sim.machine(g.sim.automation.routes()[0].from);
          const b = g.sim.machine(g.sim.automation.routes()[0].to);
          // halfway or so between the two crates
          const t = Math.hypot(d.px - (a.x + 0.5), d.pz - (a.z + 0.5)) / Math.hypot(b.x - a.x, b.z - a.z);
          return t > 0.3 && t < 0.75 && { px: d.px, pz: d.pz, cargo: d.cargo };
        },
        null,
        { timeout: 240000, polling: 'raf' },
      )
      .then((h) => h.jsonValue())
      .catch(() => undefined);
    check(!!flying, T(`a courier is seen flying a basket from crate A toward crate B (${JSON.stringify(flying)})`));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/ui-courier-flying-${dev}.png` });
    await page.waitForFunction((c) => (window.solarbloom.sim.automation.count(c, 'wire') ?? 0) >= 20, ids.c, { timeout: 600000 }).catch(() => {});
    const after = await page.evaluate(({ a, b, c, asm }) => {
      const s = window.solarbloom.sim, au = s.automation;
      return { a: au.contents(a), b: au.contents(b), c: au.contents(c), powered: s.power.isPowered(s.machine(asm)), why: au.assemblerProblem(s.machine(asm)) ?? 'working' };
    }, ids);
    check(!after.a.copper && after.c.wire === 20, T(`in game time, couriers carried the Copper and the Assembler made Wire on grid power (${JSON.stringify(after)})`));
    await page.evaluate((id) => {
      const g = window.solarbloom, m = g.sim.machine(id);
      g.camera.glide(m.x + 1, 0, m.z + 1, 1.7);
    }, ids.asm);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${dir}/ui-assembler-line-${dev}.png` });
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
