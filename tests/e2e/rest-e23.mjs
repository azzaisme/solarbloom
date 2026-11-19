// E23.2.3 (#373): a headless play-through of resting: an old bench broken until mended, sitting with the keyboard
// and with a gamepad (A sits, B stands, never the pause menu), Esc standing up rather than opening the menu, the cheer
// guard, a friend Keeper beside bloombot, a placed bench picked up while sitting, and meditating at a real charger on
// the grid. `node tests/e2e/rest-e23.mjs [outDir]` after `vite build` (DIST=<dir> serves a copied build; GPU=1 uses
// the graphics card; GFX=low|medium|high picks the tier, High by default).
// Writes JPEG screenshots at the key moments and prints what each shows; fails on page errors or broken checks.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/e23-2-3';
mkdirSync(out, { recursive: true });
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const server = await preview({ root: process.cwd(), build: { outDir: process.env.DIST ?? 'dist' }, preview: { port: 4251 + Math.floor(Math.random() * 400), strictPort: false }, logLevel: 'silent' });
const URL0 = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const checks = [];
const check = (ok, what) => {
  checks.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};
const shots = [];
/** A still view: the ground redrawn, no camera move, then the picture. */
async function shot(page, name, what) {
  for (let i = 0; i < 4; i++) if (await until(page, () => window.solarbloom.chunks.pending === 0 && !window.solarbloom.camera.cinematic)) break;
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 84 });
  shots.push(`${name}.jpg: ${what}`);
}
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 60000 }).then(() => true, () => false);
const key = async (page, code) => {
  await page.keyboard.press(code);
  await page.waitForTimeout(300);
};
/** A pad button held for a few frames, then let go (the game reads the pad each frame). */
const pad = async (page, b) => {
  await page.evaluate((b) => {
    window.__pad.buttons[b].pressed = true;
    window.__pad.buttons[b].value = 1;
  }, b);
  await page.waitForTimeout(400);
  await page.evaluate((b) => {
    window.__pad.buttons[b].pressed = false;
    window.__pad.buttons[b].value = 0;
  }, b);
  await page.waitForTimeout(400);
};
const PAD_A = 0;
const PAD_B = 1;
const sitting = (page) => page.evaluate(() => window.solarbloom.sim.rest.sitting?.kind ?? null);
const menuOpen = (page) => page.evaluate(() => window.solarbloom.menu.isOpen);
/** Bloombot in front of a tile, facing it (from +z). */
const before = (page, x, z) =>
  page.evaluate(({ x, z }) => {
    const g = window.solarbloom;
    g.bot.following = true;
    g.bot.teleport('g', x, z + 1);
    g.bot.pose.x = x + 0.5;
    g.bot.pose.z = z + 1.6;
    g.bot.pose.facing = Math.PI;
  }, { x, z });
/** Close in from a little to the side: the close zoom step when standing, the calm view's zoom when sitting. */
const close = (page, yaw = 20, zoom = 6) =>
  page.evaluate(({ yaw, zoom }) => {
    const g = window.solarbloom;
    g.camera.turnTo(yaw, true);
    if (g.sim.rest.sitting) g.camera.jumpZoom(zoom);
    else g.zoomStep = 0;
  }, { yaw, zoom });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(driver + '\ninstallVirtualPad();');
  await page.goto(`${URL0}?slot=1&new=1&gfx=${process.env.GFX ?? 'high'}`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
  console.log('renderer', await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; }));
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.state.charge.value = 30;
    s.inventory.add('scrap', 3);
  });

  // ── an old park bench: broken until mended ──
  const bench = { x: 10, z: 6 };
  await before(page, bench.x, bench.z);
  check(await until(page, () => /Mend/.test(document.getElementById('prompt')?.innerText ?? '')), 'facing an old bench, the prompt offers to mend it');
  await close(page, 35);
  await shot(page, '10-bench-broken', 'an old park bench before mending: sunk and sagging, a slat fallen out onto the ground, a snapped foot, moss on the seat and rust on the iron ends');
  await key(page, 'KeyE');
  check(await until(page, (b) => window.solarbloom.sim.rest.usable(window.solarbloom.sim.rest.benchAt(b.x, b.z)), bench), 'E mends it for 3 Scrap');
  await close(page, 35);
  await shot(page, '10b-bench-mended', 'the same bench mended: whole again');

  // ── sitting with the gamepad: A sits, B stands (never the pause menu) ──
  await page.evaluate(() => (window.solarbloom.zoomStep = 1));
  await pad(page, PAD_A);
  check(await until(page, () => window.solarbloom.sim.rest.sitting?.kind === 'bench'), 'pad A sits on the mended bench');
  check(await until(page, () => document.body.classList.contains('resting')), 'the HUD fades away while sitting');
  await page.waitForTimeout(2500);
  await shot(page, '11-bench-sitting', 'sitting on the bench: the calm, wider view turning slowly, the HUD gone, only the prompt; legs bent along the seat, hips on it');
  await close(page, 30, 5);
  await shot(page, '11b-bench-sitting-close', 'close up: bloombot seated on the bench, thighs along the seat and shins hanging');
  // the cheer guard: a standing gesture while seated is refused, and bloombot stays down on the seat
  const guard = await page.evaluate(async () => {
    const g = window.solarbloom;
    const y0 = g.bot.visuals.root.children.find((c) => c.name === 'bloombot-model')?.getLocalPosition().y;
    const len = g.bot.visuals.play('cheer');
    await new Promise((r) => setTimeout(r, 1200));
    const y1 = g.bot.visuals.root.children.find((c) => c.name === 'bloombot-model')?.getLocalPosition().y;
    return { len, y0, y1, sitting: g.sim.rest.sitting?.kind };
  });
  check(guard.len === 0 && guard.sitting === 'bench' && Math.abs(guard.y1 - guard.y0) < 0.03, `no cheer while seated: it stays on the seat (play → ${guard.len}, y ${guard.y0?.toFixed(3)} → ${guard.y1?.toFixed(3)})`);
  await shot(page, '11c-bench-cheer-guard', 'a cheer asked for while seated: refused, bloombot stays sitting');
  await pad(page, PAD_B);
  check(await until(page, () => !window.solarbloom.sim.rest.sitting && !document.body.classList.contains('resting')), 'pad B stands bloombot up and the HUD comes back');
  check(!(await menuOpen(page)), 'pad B while sitting does not open the pause menu');

  // ── Esc (Back on the keyboard) stands up before any menu ──
  await before(page, bench.x, bench.z);
  await key(page, 'KeyE');
  check(await until(page, () => window.solarbloom.sim.rest.sitting?.kind === 'bench'), 'E sits again');
  await key(page, 'Escape');
  check(await until(page, () => !window.solarbloom.sim.rest.sitting), 'Esc stands bloombot up');
  check(!(await menuOpen(page)), 'Esc while sitting does not open the pause menu');

  // ── a friend Keeper sits beside bloombot ──
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.state.salvage.keepers.pylon = { step: 'settled' };
    s.state.areas.mastRow = { ...(s.state.areas.mastRow ?? { revealedAt: 0 }), fog: 'cleared' };
  });
  await page.waitForTimeout(800);
  await before(page, bench.x, bench.z);
  await key(page, 'KeyE');
  check(await until(page, () => window.solarbloom.resting?.friend === 'Pylon'), 'a friend Keeper (Pylon) sits beside bloombot');
  check(await until(page, () => !!window.solarbloom.keepers?.views?.get('pylon')?.rig), "Pylon's model has loaded");
  await page.waitForTimeout(1500);
  await close(page, 20, 6);
  await shot(page, '13-bench-friend', 'close up: bloombot and Pylon sitting side by side on the bench');
  await key(page, 'KeyE');
  check(await until(page, () => !window.solarbloom.sim.rest.sitting), 'E stands again');

  // ── a placed bench picked up while sitting on it ──
  const spot = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const f = s.state.machines.find((m) => m.type === 'core' && s.areas.areaOf(m) === 'park');
    const x = f.x + 1;
    const z = f.z + f.size + 4;
    const t = s.grid.get('g', x, z);
    t.blocked = false;
    s.state.cozy ??= {};
    s.state.cozy.decor ??= {};
    s.state.cozy.decor[`g|${x}|${z}`] = 'bench@0';
    s.grid.touch(t);
    return { x, z };
  });
  await before(page, spot.x, spot.z);
  await page.evaluate((p) => window.solarbloom.resting.sitBench(window.solarbloom.sim.rest.benchAt(p.x, p.z)), spot);
  check(await until(page, () => window.solarbloom.sim.rest.sitting?.kind === 'bench'), 'sitting on a placed bench');
  await page.evaluate((p) => {
    const s = window.solarbloom.sim;
    delete s.state.cozy.decor[`g|${p.x}|${p.z}`];
    s.grid.touch(s.grid.get('g', p.x, p.z));
  }, spot);
  check(await until(page, () => !window.solarbloom.sim.rest.sitting && !window.solarbloom.bot.seat && !document.body.classList.contains('resting')), 'the bench picked up: bloombot stands, the HUD and view come back');

  // ── meditating at a real charger on the grid ──
  const pad0 = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.power.skyOverride = () => ({ sun: 1, solar: 1, cloudy: false, wind: 0, dark: 0 }); // clear noon for the panels
    // an open, level spot in the park: the pad, a panel either side, and room in front to sit
    const at = (x, z) => s.grid.get('g', x, z);
    const free = (x, z, lvl) => {
      const t = at(x, z);
      return !!t && !t.blocked && !t.occupantId && !t.prop && !t.ramp && t.feature !== 'water' && (t.level ?? 0) === lvl;
    };
    const spot = s.areas.tiles('park').find((t) => t.x > 2 && t.z > 2 && [[0, 0], [-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1], [0, 2]].every(([dx, dz]) => free(t.x + dx, t.z + dz, t.level ?? 0)));
    const x = spot.x;
    const z = spot.z;
    // built for real (placement checks and recipes bypassed: this is a look test, the rules have unit tests)
    const check = s.build.check.bind(s.build);
    const pay = s.inventory.pay.bind(s.inventory);
    s.build.check = () => ({ ok: true, cost: {}, spotOk: true });
    s.inventory.pay = () => true;
    const put = (type, x, z) => {
      const t = s.grid.get('g', x, z);
      t.ground = 'restored';
      t.blocked = false;
      t.bloom = 1;
      t.pollution = 0;
      s.grid.touch(t);
      return s.build.place(type, 'g', x, z);
    };
    put('solar', x - 1, z);
    put('solar', x + 1, z);
    const m = put('charger', x, z);
    s.build.check = check;
    s.inventory.pay = pay;
    s.state.charge.value = 20;
    return { x, z, id: m.id };
  });
  await before(page, pad0.x, pad0.z);
  check(await until(page, () => /Meditate/.test(document.getElementById('prompt')?.innerText ?? '')), 'facing the charger, the prompt offers to meditate');
  await key(page, 'KeyE');
  check(await until(page, () => window.solarbloom.sim.rest.sitting?.kind === 'charger'), 'E sits down to meditate at the charger');
  check(await page.evaluate((id) => window.solarbloom.sim.chargers.docked()?.id === id, pad0.id), 'bloombot is docked at the pad');
  const c0 = await page.evaluate(() => window.solarbloom.sim.charge.value());
  check(await until(page, (c0) => window.solarbloom.sim.charge.value() > c0 + 2, c0), 'the powered pad charges bloombot while it meditates');
  await page.waitForTimeout(1500);
  await close(page, 160, 5); // from in front: bloombot faces the pad
  await shot(page, '15-meditate', 'meditating at a powered charger: cross-legged at the pad, eyes closed, the pad lit');
  await pad(page, PAD_B);
  check(await until(page, () => !window.solarbloom.sim.rest.sitting), 'pad B stands up from meditating');
  check(!(await menuOpen(page)), 'and does not open the pause menu');
  await page.close();
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(checks.join('\n'));
console.log(shots.map((s) => `  ${s}`).join('\n'));
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  process.exitCode = 1;
}
