// E23.4 (#358): the water network, played headless. Run after `vite build`:
//   node tests/e2e/water-shots.mjs [outDir]
// Scenes (screenshots in outDir, default docs/review/water):
//   1 levels-half / levels-low: the park's pond drained to 50% and 20% (the bed creeps in from the banks)
//   2 fade-dry / fade-refilled: the pond empty (the lush banks fade to plain grass) and refilled (green again)
//   3 build-menu: the Old City's build menu (Q) with the Reservoir, Pump, Desalination Plant and Pipe
//   4 pump-dark / pump-running: a pump and a pipe line with no power (dry glasses), then with a panel (wet glasses)
//   5 gravity: a reservoir on Mast Row's terrace feeding a pipe down its stairs, no pump
//   6 desal: a desalination plant on the Landing's shore with its panels and a pipe inland
//   7 overlay: the Water view in build mode (if this build has it)
// Prints ✓/✗ checks and exits non-zero if any fails. Requires Playwright.
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/water';
mkdirSync(out, { recursive: true });
// other sessions run their own e2e servers at the same time: take the first free port from 4241 up
const server = await preview({ preview: { port: 4241, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
// the repo's virtual gamepad (tests/e2e/gamepad-driver.js), so the Water view is tried on the pad too
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
await page.addInitScript(`${driver}\ninstallVirtualPad(); window.padDriver = padDriver;`);
/** Press a virtual pad button for two drawn frames, release it for two. */
const press = (b) =>
  page.evaluate(async (b) => {
    const frames = (n) => new Promise((r) => (function f(k) { k ? requestAnimationFrame(() => f(k - 1)) : r(); })(n));
    window.__pad.buttons[b].pressed = true;
    window.__pad.buttons[b].value = 1;
    await frames(2);
    window.__pad.buttons[b].pressed = false;
    window.__pad.buttons[b].value = 0;
    await frames(2);
  }, b);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.setDefaultTimeout(240000);
await page.goto(`${base}/?slot=1&ui=oldcity`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 240000 });
await page.evaluate(() => window.solarbloom.pause.clear('blur'));

/** Lets the world settle after a move: chunks built and a few frames drawn. */
async function settle(ms = 2500) {
  await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 240000 });
  await page.waitForTimeout(ms);
}
const shot = async (name) => {
  // the build cursor's tooltip would cover what the shot is of
  await page.addStyleTag({ content: '#tip { visibility: hidden !important; }' });
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${out}/${name}.png`);
};
const run = (fn, arg) => page.evaluate(fn, arg);
/** Frames a spot from above (bloombot stood beside it: the explore camera follows it), then waits for the chunks. */
const frame = async (x, z, zoom, yaw = 0, ms = 6000, pitch = 0) => {
  await run(({ x, z, zoom, yaw, pitch }) => {
    const g = window.solarbloom;
    g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
    g.camera.minZoom = 0.12;
    if (g.bot) {
      g.bot.teleport('g', x + 0.5, z + 2.5);
      g.bot.following = false;
    }
    g.camera.glide(x, 0, z, zoom);
    g.camera.turnTo(yaw);
    if (pitch) g.camera.pitchBy(pitch); // positive looks down more (within the camera's 20°–60°)
    for (let i = 0; i < 300; i++) g.camera.update(0.05);
  }, { x, z, zoom, yaw, pitch });
  await settle(ms);
};

try {
  // The park restored and lush, its pond restored; Cistern Basin's Keeper awake (the water pieces unlock), materials.
  await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.areas.clear('park', true);
    s.state.salvage.tier = 2;
    s.state.salvage.keepers.sluice = { step: 'request1' }; // Cistern Basin: reservoirs, pumps, pipes, desalination
    s.state.salvage.keepers.tally = { step: 'request1' }; // Old Market: solar panels (E23.6.1's crafting table)
    // crafted parts (E23.6.1) for the recipes, and Pipes, one a tile
    s.state.salvage.pack = { scrap: 80, copper: 20, clay: 80, pipe: 60, wire: 30, glassPane: 40 };
    for (let z = -2; z < 18; z++)
      for (let x = -2; x < 18; x++) {
        const t = s.grid.get('g', x, z);
        if (!t || t.blocked) continue;
        t.ground = 'restored';
        t.pollution = 0;
        t.bloom = t.feature === 'water' ? 1 : 3;
        delete t.tr;
        s.grid.touch(t);
      }
    g.chunks.markAll();
    g.bot.teleport('g', 5.5, 14.5);
    s.bot = { roofId: 'g', x: 5.5, z: 14.5 };
  });
  await settle(9000);

  // 1: levels on the water
  const pond = await run(() => window.solarbloom.sim.water.bodyAt(window.solarbloom.sim.grid.get('g', 2, 11))?.id);
  check(pond === '1,10', `the park's pond is a body (${pond})`);
  await run((id) => {
    const w = window.solarbloom.sim.water;
    w.fill(id, 1e9);
    w.draw(id, w.body(id).capacity * 0.5);
  }, pond);
  await settle();
  await shot('1-levels-half');
  await run((id) => window.solarbloom.sim.water.draw(id, window.solarbloom.sim.water.body(id).capacity * 0.3), pond);
  await settle();
  await shot('1-levels-low');

  // 2: land fades around the empty pond, and greens up again
  await run((id) => window.solarbloom.sim.water.draw(id, 1e9), pond);
  await settle(3500);
  const faded = await run(() => {
    const s = window.solarbloom.sim;
    const t = s.grid.get('g', 6, 11);
    return { fade: s.water.fadeAt(t), bloom: t.bloom, ground: t.ground };
  });
  check(faded.fade > 0 && faded.bloom === 3 && faded.ground === 'restored', `the bank fades while the tile keeps its bloom (${JSON.stringify(faded)})`);
  await shot('2-fade-dry');
  await run((id) => window.solarbloom.sim.water.fill(id, 1e9), pond);
  await settle(3500);
  check((await run(() => window.solarbloom.sim.water.fadeAt(window.solarbloom.sim.grid.get('g', 6, 11)))) === 0, 'refilling greens it up');
  await shot('2-fade-refilled');

  // 3: the build menu (Q) shows the water pieces
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(800);
  const tray = await run(() => {
    const t = document.querySelector('#buildTray');
    const vis = (sel) => {
      const e = document.querySelector(sel);
      return !!e && e.getBoundingClientRect().width > 0;
    };
    return { open: t?.classList.contains('open'), reservoir: vis('#buildTray [data-tool="reservoir"]'), pump: vis('#buildTray [data-tool="pump"]'), desal: vis('#buildTray [data-tool="desalination"]'), pipe: vis('#buildTray [data-tool="pipe"]') };
  });
  check(tray.open && tray.reservoir && tray.pump && tray.pipe, `the build menu shows the water pieces (${JSON.stringify(tray)})`);
  await shot('3-build-menu');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  if (await run(() => window.solarbloom.hud.trayOpen)) await run(() => window.solarbloom.hud.toggleTray(false));

  // 4: a pump on the pond's bank and a pipe line, first without power, then with a panel beside it
  const built = await run(() => {
    const s = window.solarbloom.sim;
    s.bot = { roofId: 'g', x: 6.5, z: 12.5 };
    const pump = s.build.place('pump', 'g', 4, 11);
    const laid = [5, 6, 7, 8, 9, 10, 11].map((x) => s.water.pipes.lay('g', x, 11));
    return { pump: !!pump, laid: laid.every(Boolean) };
  });
  check(built.pump && built.laid, `pump built and pipe laid (${JSON.stringify(built)})`);
  // midday for the panels (the play-through is about the water, not the hour)
  await run(() => {
    const p = window.solarbloom.sim.power;
    const noon = { ...p.sky(), sun: 1, solar: 1 };
    p.skyOverride = () => noon;
  });
  await run(() => window.solarbloom.bot.teleport('g', 7.5, 13.5));
  await settle(3000);
  const dark = await run(() => {
    const s = window.solarbloom.sim;
    return { carries: s.water.pipes.carries(11, 11), watered: s.water.isWatered(s.grid.get('g', 11, 12)) };
  });
  check(!dark.carries && !dark.watered, `no power: the line is dry (${JSON.stringify(dark)})`);
  await shot('4-pump-dark');
  await run(() => window.solarbloom.sim.build.place('solar', 'g', 5, 10));
  await page.waitForFunction(() => window.solarbloom.sim.water.pipes.carries(11, 11), null, { timeout: 120000 });
  await settle(2500);
  const lit = await run(() => {
    const s = window.solarbloom.sim;
    const far = s.grid.get('g', 11, 12);
    const before = s.water.levelOf('1,10');
    const got = s.water.drawNear(far, 20);
    return { watered: s.water.isWatered(far), got, drained: before - s.water.levelOf('1,10') };
  });
  check(lit.watered && lit.got === 20 && lit.drained > 0, `a panel powers it: a tile 8 from the pond is fed and draws from it (${JSON.stringify(lit)})`);
  await shot('4-pump-running');

  // 5: gravity: a reservoir on Mast Row's level-2 terrace, a pipe down its stairs, no pump
  const grav = await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    // through Mast Row's barricade the way bloombot opens it (Pry), then its landmark woken
    if (!s.state.salvage.abilities.includes('pry')) s.state.salvage.abilities.push('pry');
    s.gates.open('g-mastRow');
    s.areas.clear('mastRow', true);
    for (let z = -26; z <= -16; z++)
      for (let x = 24; x <= 29; x++) {
        const t = s.grid.get('g', x, z);
        if (t && !t.blocked && t.feature !== 'water') Object.assign(t, { ground: 'restored', pollution: 0, bloom: Math.max(1, t.bloom) }), s.grid.touch(t);
      }
    g.chunks.markAll();
    s.bot = { roofId: 'g', x: 27.5, z: -26.5 };
    const r = s.build.place('reservoir', 'g', 25, -25);
    if (r) s.water.fill(`r:${r.id}`, 160);
    const laid = [-24, -23, -22, -21, -20, -19, -18].map((z) => s.water.pipes.lay('g', 27, z));
    g.bot.teleport('g', 26.5, -22.6);
    return { r: !!r, laid: laid.every(Boolean) };
  });
  check(grav.r && grav.laid, `terrace reservoir built and pipe laid down the stairs (${JSON.stringify(grav)})`);
  await page.waitForFunction(() => window.solarbloom.sim.water.pipes.carries(27, -18), null, { timeout: 120000 });
  // waking Mast Row's landmark plays its camera cinematic: wait for the camera to come back to bloombot
  await page.waitForFunction(() => !window.solarbloom.cinematic, null, { timeout: 240000 });
  await run(() => window.solarbloom.bot.teleport('g', 26.5, -22.6));
  await settle(5000);
  check(await run(() => window.solarbloom.sim.water.isWatered(window.solarbloom.sim.grid.get('g', 28, -17))), 'the street below the terrace is fed by gravity');
  await shot('5-gravity-tank');
  // beside the pipe where it runs down the stairs (it sits 10 cm over each tread on small sticks)
  await run(() => window.solarbloom.bot.teleport('g', 28.6, -19.2));
  await settle(4000);
  await shot('5-gravity-stairs');

  // 6: a desalination plant on the Landing's shore
  const desal = await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const fogged = (t) => s.areas.fog(s.areas.map.areaOfCell(t.x, t.z)) === 'hidden';
    const land = (t) => t && t.feature !== 'water' && !t.blocked && !t.occupantId && t.feature !== 'building' && !fogged(t);
    let spot;
    for (let z = 47; z >= 36 && !spot; z--)
      for (let x = 2; x <= 26 && !spot; x++) {
        const f = s.grid.footprint('g', x, z, 2);
        if (!f.every(land) || !f.some((t) => s.water.onShore(t))) continue;
        let ok = true;
        for (let k = 1; k <= 6; k++) if (!land(s.grid.get('g', x, z - k))) ok = false;
        if (ok) spot = { x, z };
      }
    if (!spot) return { spot: null };
    const { x, z } = spot;
    for (let dz = -7; dz <= 2; dz++)
      for (let dx = -2; dx <= 3; dx++) {
        const t = s.grid.get('g', x + dx, z + dz);
        if (land(t)) Object.assign(t, { ground: 'restored', pollution: 0, bloom: Math.max(1, t.bloom) }), s.grid.touch(t);
      }
    g.chunks.markAll();
    s.bot = { roofId: 'g', x: x + 0.5, z: z - 2.5 };
    const m = s.build.place('desalination', 'g', x, z);
    const panels = [[2, 0], [2, 1], [-1, 0], [-1, 1], [2, -1]].map(([dx, dz]) => s.build.place('solar', 'g', x + dx, z + dz)).filter(Boolean).length;
    const laid = [1, 2, 3, 4, 5, 6].map((k) => s.water.pipes.lay('g', x, z - k));
    g.bot.teleport('g', x + 1, z - 1.2);
    return { spot, built: !!m, panels, laid: laid.every(Boolean) };
  });
  check(desal.built && desal.panels >= 3 && desal.laid, `desalination plant on the shore with panels and a pipe (${JSON.stringify(desal)})`);
  if (desal.spot) {
    await page.waitForFunction(({ x, z }) => window.solarbloom.sim.water.pipes.carries(x, z - 6), desal.spot, { timeout: 120000 });
    await settle(4000);
    check(await run(() => window.solarbloom.sim.power.draw(window.solarbloom.sim.machinesOfType('desalination')[0]) >= 12), 'it is a heavy load on the grid');
    await shot('6-desal');
  }

  // 7: the Water view (build mode), when this build has it
  const hasView = await run(() => typeof window.solarbloom.toggleWaterView === 'function');
  if (hasView) {
    // the scene: the pump line from 4 now feeding a reservoir, a planter beside it (watered) and one far off (dry)
    const scene = await run(() => {
      const s = window.solarbloom.sim;
      const put = (type, x, z, size) => {
        if (s.grid.footprint('g', x, z, size).some((t) => !t || t.blocked || t.occupantId || t.feature === 'water' || s.water.pipes.has(t.x, t.z))) return null;
        const m = { id: s.newId('m'), type, roofId: 'g', x, z, size, boostUntil: 0, timer: 0, charge: 0 };
        s.state.machines.push(m);
        for (const t of s.grid.footprint('g', x, z, size)) t.occupantId = m.id;
        s.grid.indexMachine(m);
        return m;
      };
      const first = (type, size, spots) => spots.map(([x, z]) => put(type, x, z, size)).find(Boolean) ?? null;
      const tank = s.machinesOfType('reservoir').find((r) => r.x < 20 && r.z < 20) ?? first('reservoir', 2, [[10, 9], [12, 9], [9, 9]]);
      const wet = first('planter', 1, [[8, 12], [9, 12], [7, 12], [8, 10]]);
      const dry = first('planter', 1, [[13, 6], [12, 6], [13, 5], [12, 5], [11, 6]]);
      for (let i = 0; i < 3; i++) {
        s.power.tick(1);
        s.water.tick(1);
      }
      return { tank: tank?.id, wet: wet?.id, dry: dry?.id, ringed: window.solarbloom.waterOverlay.constructor.dryPlanters(s).map((m) => m.id) };
    });
    check(!!scene.tank && !!scene.wet && !!scene.dry && scene.ringed.includes(scene.dry) && !scene.ringed.includes(scene.wet), `a reservoir on the pump line, a watered planter by it and a dry one far off (${JSON.stringify(scene)})`);
    await frame(9.5, 8.5, 0.9, 0);
    await page.keyboard.press('KeyQ');
    await page.waitForTimeout(400);
    await page.click('#buildTray [data-tool="pipe"]');
    await page.waitForTimeout(400);
    await page.keyboard.press('KeyV');
    await settle(2500);
    check(await run(() => window.solarbloom.waterView), 'V turns the Water view on in build mode');
    // drawn on the next frame (slow headless): wait for the overlay and the holograms, up to 15 s
    await page.waitForFunction(() => window.solarbloom.waterOverlay.visible && window.solarbloom.machines.holos.water.parts.size > 0, null, { timeout: 15000 }).catch(() => {});
    await settle(1000);
    check(await run(() => window.solarbloom.waterOverlay.visible), 'the Water view is drawn');
    // E23.4.5: the running pump and the line it fills are blue holograms, in a dimmed world
    const holo = await run(() => {
      const g = window.solarbloom;
      const pump = g.sim.machinesOfType('pump')[0];
      return { parts: g.machines.holos.water.parts.size, pump: g.machines.holos.water.sig.split(',').includes(pump.id), pipes: g.pipes.wetParts.filter((mi) => mi.material === g.machines.holoMat('water')).length, dim: g.dayNight.dim };
    });
    check(holo.pump && holo.parts > 0 && holo.pipes > 0 && holo.dim > 0.5, `the pump and its line are blue holograms, the world dimmed (${JSON.stringify(holo)})`);
    await shot('7-overlay');
    // the build bar shows the Water view's slot, lit, with its key; the first-time line is saved with the game
    const bar = await run(() => {
      const el = document.querySelector('#buildbar .bslot.water');
      return { slot: !!el, on: !!el?.classList.contains('on'), key: !!el?.querySelector('.key')?.innerHTML.trim(), label: el?.querySelector('.sl')?.textContent.trim(), saved: window.solarbloom.sim.state.salvage.seen?.includes('tip:waterView') };
    });
    check(bar.slot && bar.on && bar.key && bar.label === 'Water' && bar.saved, `the build bar's Water slot, lit, with its key; the first-time line saved (${JSON.stringify(bar)})`);
    // the dry planter's red ring, closer
    const dryAt = await run((id) => { const m = window.solarbloom.sim.machine(id); return [m.x, m.z]; }, scene.dry);
    await frame(dryAt[0] + 0.5, dryAt[1] + 0.5, 1.4, 0, 4000, 40);
    await shot('7-dry-planter');
    await frame(9.5, 8.5, 0.9, 0, 3000, -40);
    // one view at a time: the Power view (O) turns the Water view off, and its holograms with it
    await page.keyboard.press('KeyO');
    await settle(1500);
    // the holograms swap on the next drawn frame (slow headless): wait for it, up to 10 s
    await page.waitForFunction(() => window.solarbloom.machines.holos.water.parts.size === 0 && window.solarbloom.machines.holos.power.parts.size > 0, null, { timeout: 10000 }).catch(() => {});
    const swap = await run(() => ({ water: window.solarbloom.waterView, parts: window.solarbloom.machines.holos.water.parts.size, power: window.solarbloom.machines.holos.power.parts.size }));
    check(!swap.water && swap.parts === 0 && swap.power > 0, `the Power view takes over: no blue left (${JSON.stringify(swap)})`);
    await page.keyboard.press('KeyV');
    await settle(1500);
    // the yellow goes on the next drawn frame (headless frames are slow): wait for it, up to 10 s
    await page.waitForFunction(() => window.solarbloom.machines.holos.power.parts.size === 0, null, { timeout: 10000 }).catch(() => {});
    const back = await run(() => ({ water: window.solarbloom.waterView, power: window.solarbloom.machines.holos.power.parts.size }));
    check(back.water && back.power === 0, `V brings the Water view back and the yellow goes (${JSON.stringify(back)})`);
    await press(14);
    await page.waitForTimeout(500);
    check(!(await run(() => window.solarbloom.waterView)), 'd-pad left turns it off (pad)');
    await press(14);
    await page.waitForTimeout(500);
    check(await run(() => window.solarbloom.waterView), 'd-pad left turns it back on (pad)');
    // Esc closes the build tray first, then puts the Pipe tool away (out of build mode)
    for (let i = 0; i < 3 && (await run(() => window.solarbloom.hud.currentTool)) !== 'pulse'; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    }
    check((await run(() => window.solarbloom.hud.currentTool)) === 'pulse', 'Esc leaves build mode');
    // the view follows on the next drawn frame (headless frames are slow): wait for it, up to 10 s
    const hidden = await page.waitForFunction(() => !window.solarbloom.waterOverlay.visible, null, { timeout: 10000 }).then(() => true, () => false);
    check(hidden, 'out of build mode the Water view is hidden');
    // the view over the terrace's gravity line and tank
    await run(() => (window.solarbloom.bot.following = true));
    await run(() => window.solarbloom.bot.teleport('g', 26.5, -22.6));
    await settle(3000);
    await run(() => window.solarbloom.selectTool('pipe'));
    await settle(2500);
    const tank = await page.waitForFunction(() => {
      const g = window.solarbloom;
      const r = g.sim.machinesOfType('reservoir').find((m) => m.z < 0); // the terrace's (Mast Row lies north)
      return !!r && g.machines.holos.water.sig.split(',').includes(r.id);
    }, null, { timeout: 10000 }).then(() => true, () => false);
    check(tank, 'the terrace tank holding water is a blue hologram');
    await shot('7-overlay-gravity');
    // the plant on the shore, making water, in the same blue
    if (desal.spot) {
      await frame(desal.spot.x + 1, desal.spot.z - 0.5, 1.4, 0, 4000);
      await shot('7-overlay-desal');
    }
  }
} catch (e) {
  failures.push(String(e));
  console.log('✗', e);
  await shot('error').catch(() => {});
} finally {
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
