// Phase 6: the play camera is a 3D orbit around bloombot. In play there is no pan and no zoom: any mouse drag
// (or the right stick) turns and tilts the view; the wheel turns a decoration, not the zoom. Photo mode is the
// only place the camera pans and zooms. Drives the real game with a mouse, keys and a fake gamepad, then again as a
// Steam Deck would run it: 1280×800, the Deck preset, a built-in gamepad and a touchscreen, no mouse.
// Run after `vite build`:  node tests/e2e/camera-orbit.e2e.mjs
import { createRequire } from 'node:module';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4222;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
let checks = 0;
const check = (ok, msg) => {
  checks++;
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures++;
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A fake gamepad the test drives through window.__pad (axes: left x, left y, right x, right y).
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    window.__pad = { id: 'test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
    navigator.getGamepads = () => [window.__pad];
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom && !!window.solarbloom.bot, null, { timeout: 90000 });
  if (await page.locator('#introGo').isVisible().catch(() => false)) await page.click('#introGo');
  // wait for the opening glide to finish, so "unchanged" means unchanged
  await page.waitForFunction(() => { const c = window.solarbloom.camera; return Math.abs(c.zoom - c.zoomTarget) < 1e-3; }, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const view = () =>
    page.evaluate(() => {
      const g = window.solarbloom;
      const c = g.camera;
      return { tx: c.target.x, tz: c.target.z, zoom: c.zoom, yaw: c.yaw, yawGoal: c.yawGoal, pitch: c.pitch, off: c.pitchOffset, bot: g.bot.world(), photo: !!g.photo.active };
    });
  const settle = async (ms = 1800) => page.waitForTimeout(ms);
  const drag = async (button, dx, dy) => {
    const m = page.mouse;
    await m.move(640, 360);
    await m.down({ button });
    const n = 12;
    for (let i = 1; i <= n; i++) await m.move(640 + (dx * i) / n, 360 + (dy * i) / n);
    await m.up({ button });
  };

  console.log('play (bloombot):');
  const v0 = await view();
  check(v0.off === 0 && v0.photo === false, `starts level: pitch offset ${v0.off}, photo mode off`);

  // A left-button drag turns the view and never pans or zooms it.
  await drag('left', 200, 0);
  await settle();
  const v1 = await view();
  check(near(v1.tx, v0.tx, 0.05) && near(v1.tz, v0.tz, 0.05), `left drag does not pan: target (${v1.tx.toFixed(2)}, ${v1.tz.toFixed(2)}) vs (${v0.tx.toFixed(2)}, ${v0.tz.toFixed(2)})`);
  check(near(v1.zoom, v0.zoom, 1e-3), `left drag does not zoom: ${v1.zoom.toFixed(3)} vs ${v0.zoom.toFixed(3)}`);
  check(near(v1.yawGoal - v0.yawGoal, -70, 0.5), `left drag of 200 px turned the view by ${(v1.yawGoal - v0.yawGoal).toFixed(1)}° (expected -70°)`);

  // Vertical drag tilts: down raises the camera, up lowers it, both stop at the play range.
  await drag('right', 0, 100);
  await settle();
  const v2 = await view();
  check(near(v2.off, 25, 0.5), `right drag down 100 px tilted by ${v2.off.toFixed(1)}° (expected +25°)`);
  check(near(v2.yawGoal, v1.yawGoal, 0.01), 'a straight vertical drag does not turn the view');
  await drag('right', 0, -300);
  await settle();
  const vLow = await view();
  check(near(vLow.off, -9, 0.01) && vLow.pitch >= 6, `dragging up stops at nearly level: offset ${vLow.off}, pitch ${vLow.pitch.toFixed(1)}°`);
  await drag('right', 0, 300);
  await settle();
  const vHigh = await view();
  check(near(vHigh.off, 58, 0.01) && vHigh.pitch <= 80, `dragging down stops at nearly overhead: offset ${vHigh.off}, pitch ${vHigh.pitch.toFixed(1)}°`);

  // The wheel and the zoom keys never zoom in play.
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -800);
  await page.keyboard.press('Equal');
  await page.keyboard.press('Minus');
  await settle(1200);
  const v3 = await view();
  check(near(v3.zoom, vHigh.zoom, 1e-3), `wheel and +/- leave the zoom alone: ${v3.zoom.toFixed(3)} vs ${vHigh.zoom.toFixed(3)}`);

  // Right stick: sideways turns, up lowers the camera, down raises it.
  await page.evaluate(() => (window.__pad.axes[3] = -1));
  await page.waitForTimeout(2500);
  await page.evaluate(() => (window.__pad.axes[3] = 0));
  const v4 = await view();
  check(v4.off < v3.off - 5, `right stick up lowered the camera: offset ${v3.off.toFixed(1)} → ${v4.off.toFixed(1)}`);
  await page.evaluate(() => (window.__pad.axes[3] = 1));
  await page.waitForTimeout(2500);
  await page.evaluate(() => (window.__pad.axes[3] = 0));
  const v5 = await view();
  check(v5.off > v4.off + 5, `right stick down raised the camera: offset ${v4.off.toFixed(1)} → ${v5.off.toFixed(1)}`);
  await page.evaluate(() => (window.__pad.axes[2] = 1));
  await page.waitForTimeout(2000);
  await page.evaluate(() => (window.__pad.axes[2] = 0));
  const v6 = await view();
  check(Math.abs(v6.yawGoal - v5.yawGoal) > 10, `right stick sideways turned the view by ${(v6.yawGoal - v5.yawGoal).toFixed(1)}°`);
  check(near(v6.zoom, v3.zoom, 1e-3), 'the right stick never zooms in play');

  // Recentre eases both the turn and the tilt back.
  await page.keyboard.press('KeyC');
  // eased per frame, and frames are slow in software rendering: wait for it rather than for a fixed time
  await page.waitForFunction(() => { const c = window.solarbloom.camera; return Math.abs(c.pitchOffset) < 0.05 && Math.abs(((c.yaw - 45) % 360 + 360) % 360) < 0.5; }, null, { timeout: 90000 }).catch(() => {});
  const v7 = await view();
  check(near(v7.off, 0, 0.05) && near(((v7.yaw - 45) % 360 + 360) % 360, 0, 0.5), `recentre returned the view: offset ${v7.off.toFixed(2)}, yaw ${v7.yaw.toFixed(1)}`);

  // Walking stays relative to the view at any turn and tilt, and the camera follows bloombot.
  await drag('left', 250, 0);
  await drag('right', 0, 80);
  await settle();
  const w0 = await view();
  await page.keyboard.down('KeyW');
  await page.waitForFunction((b) => { const p = window.solarbloom.bot.world(); return Math.hypot(p[0] - b[0], p[2] - b[2]) > 0.8; }, w0.bot, { timeout: 90000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  await settle(800);
  const w1 = await view();
  const mx = w1.bot[0] - w0.bot[0];
  const mz = w1.bot[2] - w0.bot[2];
  const len = Math.hypot(mx, mz);
  const yr = (w1.yaw * Math.PI) / 180;
  const align = len > 0.2 ? (mx * -Math.sin(yr) + mz * -Math.cos(yr)) / len : 0;
  check(len > 0.2, `bloombot walked ${len.toFixed(2)} tiles`);
  check(align > 0.9, `W walks away from the camera at any angle (alignment ${align.toFixed(2)})`);
  check(Math.hypot(w1.tx - w1.bot[0], w1.tz - w1.bot[2]) < 1.5, 'the camera follows bloombot while turned and tilted');

  console.log('photo mode:');
  await page.keyboard.press('KeyC');
  await page.waitForFunction(() => { const c = window.solarbloom.camera; return Math.abs(c.pitchOffset) < 0.05 && Math.abs(((c.yaw - 45) % 360 + 360) % 360) < 0.5; }, null, { timeout: 90000 }).catch(() => {});
  const p0 = await view();
  await page.keyboard.press('KeyO');
  await page.waitForTimeout(800);
  const p1 = await view();
  check(p1.photo === true, 'the photo key opens photo mode');
  await drag('left', 200, 0);
  await settle(1500);
  const p2 = await view();
  check(Math.hypot(p2.tx - p1.tx, p2.tz - p1.tz) > 0.5, `a drag pans in photo mode: target moved ${Math.hypot(p2.tx - p1.tx, p2.tz - p1.tz).toFixed(2)} tiles`);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -800);
  await settle(1500);
  const p3 = await view();
  check(p3.zoom > p2.zoom * 1.1, `the wheel zooms in photo mode: ${p2.zoom.toFixed(2)} → ${p3.zoom.toFixed(2)}`);
  await drag('right', 0, -300);
  await settle();
  const p4 = await view();
  check(near(p4.off, -16, 0.01), `a right drag tilts within photo mode's own range: offset ${p4.off}`);
  await page.keyboard.press('KeyO');
  await settle(1500);
  const p5 = await view();
  check(p5.photo === false, 'the photo key leaves photo mode');
  check(near(p5.zoom, p0.zoom, 1e-3) && near(p5.off, p0.off, 0.01) && near(p5.yawGoal, p0.yawGoal, 0.01), 'leaving photo mode puts the view back exactly');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await page.close();

  // ── Steam Deck: 1280×800, the Deck graphics preset, a built-in gamepad and a touchscreen, and (in Gaming Mode)
  // often no mouse at all. The camera has to work from the right stick and from a finger.
  console.log('steam deck (1280×800, Deck preset, gamepad + touchscreen, no mouse):');
  const touchOnly = () => {
    window.matchMedia = ((mm) => (q) =>
      /any-pointer:\s*fine/.test(q)
        ? { matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
        : mm(q))(window.matchMedia.bind(window));
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
  };
  const padInit = () => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    window.__pad = { id: 'Steam Deck Controller', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
    navigator.getGamepads = () => [window.__pad];
  };
  const open = async (query) => {
    const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    p.on('pageerror', (e) => errors.push(e.message));
    await p.addInitScript(touchOnly);
    await p.addInitScript(padInit);
    await p.goto(`http://localhost:${PORT}/${query}`);
    await p.evaluate(() => localStorage.clear());
    await p.reload();
    await p.waitForFunction(() => !!window.solarbloom && !!window.solarbloom.bot, null, { timeout: 90000 });
    if (await p.locator('#introGo').isVisible().catch(() => false)) await p.click('#introGo');
    await p.waitForFunction(() => { const c = window.solarbloom.camera; return Math.abs(c.zoom - c.zoomTarget) < 1e-3; }, null, { timeout: 60000 });
    return p;
  };
  const NOTE = 'needs a keyboard or a gamepad';

  // Control: the same touch-only browser without the Deck preset does get the "needs a keyboard or a gamepad" note,
  // so the Deck's missing note below means something.
  const phone = await open('');
  await phone.waitForTimeout(4000);
  check(await phone.evaluate((n) => document.body.innerText.includes(n), NOTE), 'control: a touch-only browser (not a Deck) shows the keyboard-or-gamepad note');
  await phone.close();

  const deck = await open('?gfx=deck');
  await deck.waitForTimeout(4000);
  check(await deck.evaluate(() => window.solarbloom.deck === true), 'the Deck preset is on');
  check(!(await deck.evaluate((n) => document.body.innerText.includes(n), NOTE)), 'a Deck never gets the keyboard-or-gamepad note');
  const dview = () => deck.evaluate(() => { const c = window.solarbloom.camera; return { tx: c.target.x, tz: c.target.z, zoom: c.zoom, yawGoal: c.yawGoal, off: c.pitchOffset }; });

  // The right stick orbits in any direction: a diagonal push turns and tilts at the same time.
  const d0 = await dview();
  await deck.evaluate(() => { window.__pad.axes[2] = 0.9; window.__pad.axes[3] = 0.9; }); // right and down
  await deck.waitForTimeout(3000);
  await deck.evaluate(() => { window.__pad.axes[2] = 0; window.__pad.axes[3] = 0; });
  const d1 = await dview();
  check(d1.yawGoal < d0.yawGoal - 5 && d1.off > d0.off + 5, `a diagonal stick push turns (${(d1.yawGoal - d0.yawGoal).toFixed(1)}°) and tilts (${(d1.off - d0.off).toFixed(1)}°) together`);
  await deck.evaluate(() => { window.__pad.axes[2] = 0.3; window.__pad.axes[3] = 1; }); // nearly straight down
  await deck.waitForTimeout(2500);
  await deck.evaluate(() => { window.__pad.axes[2] = 0; window.__pad.axes[3] = 0; });
  const d2 = await dview();
  check(near(d2.yawGoal, d1.yawGoal, 0.01), 'a push close to one axis stays on that axis (no sideways creep)');

  // A finger drag on the touchscreen turns the view; it never pans or zooms.
  const cdp = await deck.context().newCDPSession(deck);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', 640, 400);
  for (let i = 1; i <= 12; i++) await touch('touchMove', 640 + (200 * i) / 12, 400);
  await touch('touchEnd');
  await deck.waitForTimeout(1500);
  const d3 = await dview();
  check(near(d3.yawGoal - d2.yawGoal, -70, 1), `a 200 px finger drag turned the view by ${(d3.yawGoal - d2.yawGoal).toFixed(1)}° (expected -70°)`);
  check(near(d3.tx, d2.tx, 0.05) && near(d3.tz, d2.tz, 0.05) && near(d3.zoom, d2.zoom, 1e-3), 'a finger drag does not pan or zoom');
  check(errors.length === 0, `no page errors on the Deck run${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await deck.close();
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failures ? `\n${failures} of ${checks} checks failed` : `\nall ${checks} checks passed`);
process.exit(failures ? 1 : 0);
