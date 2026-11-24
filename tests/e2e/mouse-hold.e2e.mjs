// Player feedback: "the controls on desktop seemed geared for mobile: I had to press Esc to click on menus".
// In bloombot's view on desktop the cursor now stays free by default: a left click on the world acts and never takes the
// mouse, so a HUD button can be clicked straight after; holding the right mouse button captures the mouse for looking
// and letting go frees it. The older click-to-capture look is Settings › Accessibility › Mouse look › Always.
// Pointer lock itself is spied on (headless Chromium may refuse a real lock). Run after `vite build`.
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = Number(process.env.PORT ?? 4243);
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(600000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // count lock requests and releases; pretend the lock was granted so the release path runs as in a real browser
  await page.addInitScript(() => {
    window.__lock = { req: 0, exit: 0 };
    let locked = null;
    Object.defineProperty(Document.prototype, 'pointerLockElement', { get: () => locked, configurable: true });
    HTMLCanvasElement.prototype.requestPointerLock = function () {
      window.__lock.req++;
      locked = this;
      document.dispatchEvent(new Event('pointerlockchange'));
      return Promise.resolve();
    };
    Document.prototype.exitPointerLock = function () {
      window.__lock.exit++;
      locked = null;
      document.dispatchEvent(new Event('pointerlockchange'));
    };
  });
  await page.goto(`http://localhost:${PORT}/?slot=1&new=1&gfx=low`);
  await page.waitForFunction(() => window.solarbloom?.bot && window.solarbloom.loadSteps?.().models === 1, null, { timeout: 240000, polling: 500 });
  // the loading screen covers everything until the first view is complete
  await page.waitForFunction(() => { const l = document.getElementById('loading'); return !l || l.hidden || l.classList.contains('gone'); }, null, { timeout: 600000, polling: 1000 });
  await page.waitForTimeout(2500);
  const canvas = await page.evaluate(() => {
    const r = window.solarbloom.app.graphicsDevice.canvas.getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.55 };
  });
  const lock = () => page.evaluate(() => ({ ...window.__lock, locked: !!document.pointerLockElement }));

  // 1. a left click on the world: acts, never captures
  await page.mouse.click(canvas.x, canvas.y);
  await page.waitForTimeout(300);
  let l = await lock();
  check(l.req === 0 && !l.locked, `a left click on the world leaves the cursor free (${JSON.stringify(l)})`);

  // the HUD is clickable straight away: the element under a HUD button is the button, not a locked canvas
  const hudFree = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && x.getBoundingClientRect().width > 0);
    if (!b) return 'no button';
    const r = b.getBoundingClientRect();
    const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !document.pointerLockElement && (under === b || b.contains(under)) ? 'ok' : 'blocked';
  });
  check(hudFree === 'ok', `a HUD button can be clicked right after (${hudFree})`);

  // 2. hold the right button: captured while held, free again on release
  await page.mouse.move(canvas.x, canvas.y);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(200);
  l = await lock();
  check(l.req === 1 && l.locked, `holding the right button captures the mouse for looking (${JSON.stringify(l)})`);
  const yaw0 = await page.evaluate(() => window.solarbloom.camera.yaw);
  await page.evaluate(() => window.solarbloom.app.graphicsDevice.canvas.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', movementX: 120, movementY: 0, bubbles: true })));
  await page.waitForTimeout(300);
  const yaw1 = await page.evaluate(() => window.solarbloom.camera.yaw);
  check(Math.abs(yaw1 - yaw0) > 1, `moving the mouse while held turns the view (${yaw0.toFixed(1)} → ${yaw1.toFixed(1)})`);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(200);
  l = await lock();
  check(l.exit >= 1 && !l.locked, `letting go frees the mouse at once (${JSON.stringify(l)})`);

  // 3. the older behaviour, chosen in Settings: a click takes the mouse
  await page.evaluate(() => window.solarbloom.setSetting?.('mouseMode', 'capture') ?? (window.solarbloom.settings.mouseMode = 'capture'));
  await page.mouse.click(canvas.x, canvas.y);
  await page.waitForTimeout(300);
  l = await lock();
  check(l.locked, `Mouse look › Always: a click captures the mouse, as before (${JSON.stringify(l)})`);
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
