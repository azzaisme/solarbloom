// Build mode as a top-down builder: with something in hand to build the camera lifts to look down on the ground,
// the mouse pointer picks the square, holding Place and moving lays a run (straight, or with one corner), and with
// Fill on the whole patch. Footpaths and roads are laid this way, and lifted with Remove. Checks each with the real
// mouse and keyboard, and takes review shots into docs/review/build-view/.
//
//   npm run test:build-view                                        (builds, then serves the build)
//   BASE=http://localhost:5173 node tests/e2e/build-view.e2e.mjs    (against a running dev server)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/build-view';
mkdirSync(out, { recursive: true });
const server = process.env.BASE ? undefined : await preview({ preview: { port: 4199, strictPort: true }, logLevel: 'silent' });
const base = process.env.BASE ?? 'http://localhost:4199';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const run = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 1200) => page.waitForTimeout(ms);
/** Waits until the ground has been redrawn (a software-rendered browser takes a while over it). */
const drawn = async () => {
  await page.waitForFunction(() => window.solarbloom.chunks.pending === 0, null, { timeout: 60_000 }).catch(() => {});
  await settle(400);
};
const shot = async (file) => {
  await page.screenshot({ path: `${out}/${file}` });
  console.log('shot', file);
};

await startGame(page, base);
await page.addStyleTag({ content: '#toasts, .toast, #fail { display: none !important; }' });

// Green, open park ground west of the fountain, bloombot in the middle of it, the build tools handed over.
const home = await run(() => {
  const g = window.solarbloom;
  for (const t of g.sim.areas.tiles('park')) {
    if (t.blocked || t.feature === 'water') continue;
    t.ground = 'restored';
    t.pollution = 0;
    t.bloom = Math.max(1, t.bloom);
    g.sim.grid.touch(t);
  }
  g.sim.state.salvage.tier = Math.max(g.sim.state.salvage.tier, 1);
  // a patch of open lawn 4 squares by 2 (the park's lawns are small pockets between its paths and beds)
  const open = (x, z) => {
    const t = g.sim.grid.get('g', x, z);
    return !!t && !t.blocked && !t.occupantId && (t.feature ?? 'lawn') === 'lawn' && !g.cozy.plotUnder('g', x, z, 1);
  };
  let best;
  for (let z = 9; z < 16 && !best; z++)
    for (let x = 4; x < 16 && !best; x++) {
      let ok = true;
      for (let dz = 0; dz < 2 && ok; dz++) for (let dx = 0; dx < 4 && ok; dx++) ok = open(x + dx, z + dz);
      if (ok) best = { x, z };
    }
  if (!best) return null;
  g.bot.teleport('g', best.x + 2, best.z + 1);
  g.bot.pose.facing = Math.PI / 2;
  g.bot.following = true;
  g.chunks.markAll();
  return best;
});
if (!home) {
  console.log('FAIL no open block of lawn to build on');
  process.exit(1);
}
console.log('open block', JSON.stringify(home));
await settle(1500);

// 1. Walking: the chase view. Something in hand: the camera lifts to look down.
const walking = await run(() => ({ pitch: window.solarbloom.camera.pitch, build: window.solarbloom.camera.building }));
check(!walking.build && walking.pitch < 40, `walking keeps the chase view (pitch ${walking.pitch.toFixed(0)}°)`);
await shot('1-walking.png');
await run(() => window.solarbloom.selectTool('footpath'));
await settle(1800);
const up = await run(() => ({ pitch: window.solarbloom.camera.pitch, build: window.solarbloom.camera.building, cls: document.querySelector('#hud').classList.contains('build-view'), locked: !!document.pointerLockElement }));
check(up.build && up.pitch > 65, `with a footpath in hand the camera looks down (pitch ${up.pitch.toFixed(0)}°)`);
check(up.cls && !up.locked, 'the pointer is free in the build view');

/** Where a ground square's middle is on screen. */
const screenOf = (x, z) =>
  run(([x, z]) => {
    const g = window.solarbloom;
    const t = g.sim.grid.get('g', x, z);
    const v = g.camera.toScreen(g.tileVec(t, 0.1));
    return { x: v.x, y: v.y };
  }, [x, z]);
const laid = () => run(() => ({ footpath: window.solarbloom.sim.paths.count('footpath'), road: window.solarbloom.sim.paths.count('road') }));
const aimed = () => run(() => { const t = window.solarbloom.buildAim().p?.tile; return t ? [t.x, t.z] : null; });

// 2. The pointer picks the square.
const a = { x: home.x, z: home.z };
let s = await screenOf(a.x, a.z);
await page.mouse.move(s.x, s.y);
await settle(400);
check(JSON.stringify(await aimed()) === JSON.stringify([a.x, a.z]), `the hologram sits on the square under the pointer (${a.x}, ${a.z})`);
await shot('2-build-view.png');

// 3. One press lays one square.
await page.mouse.down();
await page.mouse.up();
await settle(600);
check((await laid()).footpath === 1, 'a press lays one footpath square');

// 4. Hold and move: a straight run.
const b = { x: a.x + 3, z: a.z };
await page.mouse.down();
s = await screenOf(b.x, b.z);
await page.mouse.move(s.x, s.y, { steps: 8 });
await settle(500);
const shown = await run(() => window.solarbloom.overlays.dragShown);
check(shown === 3, `the run shows its squares before it is laid (${shown} new, the first already there)`);
await shot('3-drag-run.png');
await page.mouse.up();
await drawn();
check((await laid()).footpath === 4, `letting go lays the run (${(await laid()).footpath} squares)`);
await shot('4-run-laid.png');

// 5. Remove lifts a run, and the grass comes back.
await page.keyboard.press('KeyX');
await settle(300);
s = await screenOf(a.x, a.z);
await page.mouse.move(s.x, s.y);
await page.mouse.down();
s = await screenOf(b.x, b.z);
await page.mouse.move(s.x, s.y, { steps: 8 });
await settle(400);
await page.mouse.up();
await drawn();
const lifted = await run(([a]) => ({ n: window.solarbloom.sim.paths.count('footpath'), f: window.solarbloom.sim.grid.get('g', a.x, a.z).feature, saved: !!window.solarbloom.sim.state.laid }), [a]);
check(lifted.n === 0 && (lifted.f ?? 'lawn') === 'lawn' && !lifted.saved, 'Remove, dragged, lifts the footpath: the lawn is back and the save holds none');

// 6. A run with one corner (no diagonal step).
await run(() => window.solarbloom.selectTool('road'));
await settle(400);
const c0 = { x: a.x, z: a.z };
const c1 = { x: a.x + 2, z: a.z + 1 };
s = await screenOf(c0.x, c0.z);
await page.mouse.move(s.x, s.y);
await page.mouse.down();
s = await screenOf(c1.x, c1.z);
await page.mouse.move(s.x, s.y, { steps: 8 });
await settle(400);
await page.mouse.up();
await settle(800);
const corner = await run(([c0, c1]) => {
  const g = window.solarbloom;
  const on = (x, z) => g.sim.paths.kindAt(x, z) === 'road';
  let n = 0;
  for (let x = c0.x; x <= c1.x; x++) n += on(x, c0.z) ? 1 : 0;
  for (let z = c0.z + 1; z <= c1.z; z++) n += on(c1.x, z) ? 1 : 0;
  return { n, total: g.sim.paths.count('road') };
}, [c0, c1]);
check(corner.total === 4 && corner.n === 4, `a drag off the row turns one corner (${corner.total} road squares, ${corner.n} on the run)`);

// 7. Esc drops a drag: nothing is laid, and what is in hand stays.
const before = await laid();
s = await screenOf(a.x, a.z + 1);
await page.mouse.move(s.x, s.y);
await page.mouse.down();
s = await screenOf(a.x + 1, a.z + 1);
await page.mouse.move(s.x, s.y, { steps: 5 });
await settle(300);
await page.keyboard.press('Escape');
await page.mouse.up();
await settle(500);
const after = await laid();
check(after.road === before.road && after.footpath === before.footpath, 'Esc drops the run: nothing laid');
check((await run(() => window.solarbloom.hud.currentTool)) === 'road', 'and the road stays in hand');

// 8. Fill: the whole patch between the ends.
await page.keyboard.press('KeyF');
await settle(300);
check(await run(() => window.solarbloom.fillOn), 'F turns Fill on');
const f0 = { x: a.x, z: a.z };
const f1 = { x: a.x + 3, z: a.z + 1 };
s = await screenOf(f0.x, f0.z);
await page.mouse.move(s.x, s.y);
await page.mouse.down();
s = await screenOf(f1.x, f1.z);
await page.mouse.move(s.x, s.y, { steps: 8 });
await settle(500);
await shot('5-fill.png');
await page.mouse.up();
await drawn();
check((await laid()).road === 8, `with Fill on the whole patch is laid (${(await laid()).road} road squares)`);
await shot('6-filled.png');
await page.keyboard.press('KeyF');
await settle(200);
check(!(await run(() => window.solarbloom.fillOn)), 'F turns Fill off again');

// 9. Saved: what is laid is in the save.
const saved = await run(() => JSON.parse(JSON.stringify(window.solarbloom.sim.state.laid ?? {})));
check(Array.isArray(saved.road) && saved.road.length === 8 && !saved.footpath, `the save holds what is laid (${saved.road?.length} road squares, no footpath)`);

// 10. Leaving build mode: back down to the chase view.
await page.keyboard.press('Escape');
await drawn();
await settle(1400);
const down = await run(() => ({ pitch: window.solarbloom.camera.pitch, build: window.solarbloom.camera.building, tool: window.solarbloom.hud.currentTool }));
check(!down.build && down.pitch < 40 && down.tool === 'pulse', `Esc puts it away and the chase view is back (pitch ${down.pitch.toFixed(0)}°)`);
await shot('7-walking-with-road.png');

// 11. Keys alone: the square in front of bloombot is the aim, and holding Space while walking away lays a run.
await run(([home]) => {
  const g = window.solarbloom;
  g.bot.teleport('g', home.x + 0.5, home.z + 0.5);
  g.bot.pose.facing = Math.PI / 2; // facing +x, along the first row
  g.pointer.inside = false;
  g.selectTool('footpath');
}, [home]);
await settle(1500);
const front = await aimed();
check(JSON.stringify(front) === JSON.stringify([home.x + 1, home.z]), `without the mouse the aim is the square in front of bloombot (${front})`);
await page.keyboard.down('Space');
await settle(200);
await run(() => (window.solarbloom.cursor = { x: 2.6, z: 0 })); // (as the pad's right stick would leave it)
await settle(500);
await page.keyboard.up('Space');
await settle(600);
check((await laid()).footpath === 3, `holding Space while the aim moves lays a run, over the road (${(await laid()).footpath} footpath squares)`);
await shot('8-keys-run.png');

// 12. A pad: the right stick moves the build cursor (it no longer turns the view), A held lays a run, and a click
// of the right stick turns Fill on and off.
await run(([home]) => {
  const g = window.solarbloom;
  for (const k of ['footpath', 'road']) for (const q of [...(g.sim.state.laid?.[k] ?? [])]) g.sim.paths.lift(...q.split(',').map(Number));
  g.chunks.markAll();
  const pad = { id: 'virtual pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  navigator.getGamepads = () => [pad, null, null, null];
  window.__pad = pad;
  g.bot.teleport('g', home.x + 0.5, home.z + 0.5);
  g.bot.pose.facing = Math.PI / 2;
  g.cursor = undefined;
  g.selectTool('footpath');
}, [home]);
const button = (i, down) => run(([i, down]) => Object.assign(window.__pad.buttons[i], { pressed: down, value: down ? 1 : 0 }), [i, down]);
const stick = (x, y) => run(([x, y]) => { window.__pad.axes[2] = x; window.__pad.axes[3] = y; }, [x, y]);
/** Pushes the right stick the way that moves the build cursor along +x on the ground, until it rests on a square. */
const cursorTo = async (x, z) => {
  for (let i = 0; i < 80; i++) {
    const at = await run(() => { const g = window.solarbloom; return g.cursor ? { x: g.bot.pose.x + g.cursor.x, z: g.bot.pose.z + g.cursor.z, yaw: g.camera.yaw } : { x: g.bot.pose.x, z: g.bot.pose.z, yaw: g.camera.yaw }; });
    const dx = x + 0.5 - at.x, dz = z + 0.5 - at.z;
    if (Math.hypot(dx, dz) < 0.25) break;
    const yr = (at.yaw * Math.PI) / 180;
    // the ground's (dx, dz) as the stick's right and up
    const rx = dx * Math.cos(yr) - dz * Math.sin(yr), ry = -dx * Math.sin(yr) - dz * Math.cos(yr);
    const m = Math.max(1, Math.hypot(rx, ry) / 0.6);
    await stick(rx / m, -ry / m);
    await page.waitForTimeout(60);
  }
  await stick(0, 0);
  await settle(200);
};
await settle(1200);
const yaw0 = await run(() => window.solarbloom.camera.yaw);
await stick(0.9, 0);
await settle(500);
await stick(0, 0);
const moved = await run(() => ({ yaw: window.solarbloom.camera.yaw, cursor: window.solarbloom.cursor, input: window.solarbloom.bot.lastInput }));
check(Math.abs(moved.yaw - yaw0) < 0.5 && !!moved.cursor && moved.input === 'pad', 'on a pad the right stick moves the build cursor and the view stays still');
await cursorTo(home.x + 1, home.z);
check(JSON.stringify(await aimed()) === JSON.stringify([home.x + 1, home.z]), 'the build cursor rests on the square it was moved to');
await button(0, true);
await settle(250);
await cursorTo(home.x + 3, home.z);
await shot('9-pad-run.png');
await button(0, false);
await drawn();
check((await laid()).footpath === 3, `A held while the cursor moves lays a run (${(await laid()).footpath} footpath squares)`);
await button(11, true);
await settle(200);
await button(11, false);
await settle(200);
check(await run(() => window.solarbloom.fillOn), 'a click of the right stick turns Fill on');
await button(11, true);
await settle(200);
await button(11, false);
await settle(200);
check(!(await run(() => window.solarbloom.fillOn)), 'and off again');

// 13. Grass over paving (a market floor, a plaza, a walk): a drag turns a run of the park's own paving to lawn,
// and Remove gives the paving back.
const walk = await run(() => {
  const g = window.solarbloom;
  navigator.getGamepads = () => [];
  const ok = (x, z) => !g.sim.paths.layProblem('grass', 'g', x, z) && !g.cozy.plotUnder('g', x, z, 1);
  for (let z = 2; z < 16; z++)
    for (let x = 2; x < 14; x++) {
      if (ok(x, z) && ok(x + 1, z) && ok(x + 2, z)) {
        g.bot.teleport('g', x + 1.5, z + 1.5);
        g.cursor = undefined;
        g.selectTool('grass');
        return { x, z, at: [g.bot.pose.x, g.bot.pose.z] };
      }
    }
  return null;
});
check(!!walk, `the park has a run of paving to green (${JSON.stringify(walk)})`);
if (walk) {
  // the view glides over to where bloombot now stands: wait until the ground is still under the pointer
  for (let k = 0, was = { x: -1, y: -1 }; k < 40; k++) {
    await settle(300);
    const now = await screenOf(walk.x, walk.z);
    if (Math.hypot(now.x - was.x, now.y - was.y) < 0.2) break;
    was = now;
  }
  s = await screenOf(walk.x, walk.z);
  await page.mouse.move(s.x, s.y);
  await settle(300);
  await shot('10-paving.png');
  await page.mouse.down();
  s = await screenOf(walk.x + 2, walk.z);
  await page.mouse.move(s.x, s.y, { steps: 8 });
  await settle(400);
  await page.mouse.up();
  await drawn();
  const green = await run(([w]) => [0, 1, 2].map((i) => window.solarbloom.sim.grid.get('g', w.x + i, w.z).feature), [walk]);
  check(green.every((f) => f === 'lawn') && (await run(() => window.solarbloom.sim.paths.count('grass'))) === 3, `a drag of grass turns the paving to lawn (${green})`);
  await shot('11-grass-over-paving.png');
  await page.keyboard.press('KeyX');
  await settle(300);
  s = await screenOf(walk.x, walk.z);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  s = await screenOf(walk.x + 2, walk.z);
  await page.mouse.move(s.x, s.y, { steps: 8 });
  await settle(400);
  await page.mouse.up();
  await drawn();
  const back = await run(([w]) => [0, 1, 2].map((i) => window.solarbloom.sim.grid.get('g', w.x + i, w.z).feature), [walk]);
  check(back.every((f) => f === 'paving'), `Remove gives the paving back (${back})`);
}

await browser.close();
server?.httpServer.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
