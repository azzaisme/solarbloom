// Bloombot (G.7): a new game played to waking the park fountain with only a virtual gamepad: no mouse or
// keyboard events at all. The scripted player (tests/e2e/gamepad-driver.js) reads the game state to choose
// where to go and acts through navigator.getGamepads(): the stick to walk and turn, X to pulse, Y and the d-pad
// to pick a machine from the build menu, A to place it, A (Interact) to wake the fountain, the d-pad to harvest.
//
// To finish in seconds, the page's frames are stepped by the script (30 per simulated second) rather than
// waiting for real time; every frame still reads the pad exactly as in play.
//
// Run with `npm run build && node tests/e2e/gamepad.e2e.mjs`. Requires Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const server = await preview({ preview: { port: 4211, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  for (const vp of [
    { width: 1280, height: 800 },
    { width: 1280, height: 720 },
  ]) {
    const page = await browser.newPage({ viewport: vp });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // No pointer or key events may reach the page: fail if any do.
    await page.addInitScript(() => {
      for (const t of ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'wheel']) window.addEventListener(t, (e) => e.isTrusted && (window.__foreignInput = t), true);
    });
    await page.addInitScript(driver + '\ninstallVirtualPad(); window.padDriver = padDriver; window.installVirtualPad = installVirtualPad;');
    page.setDefaultTimeout(180000);
    // the scripted player knows the classic park (E22.9 brings an Old City run)
    await page.goto('http://localhost:4211/?slot=1');
    await page.waitForFunction(() => window.solarbloom?.bot, null, { timeout: 180000 });
    const result = await page.evaluate(async () => {
      const g = window.solarbloom;
      // eslint-disable-next-line no-undef
      const d = padDriver(g);
      const maxFrames = 30 * 60 * 25; // 25 simulated minutes
      for (let i = 0; i < maxFrames && !d.state.woke; i++) {
        d.tick();
        g.update(1 / 30);
        if (i % 3000 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      return { ...d.state, minutes: +(g.sim.state.time / 60).toFixed(1), foreign: window.__foreignInput ?? null, unmet: g.sim.progression.requirements().filter((r) => !r.done).map((r) => r.label) };
    });
    // E22.1: the first pulse and the first Interact use the new buttons (X and A).
    const ok = result.woke && result.pulses > 0 && result.interacts > 0 && !result.foreign && !errors.length;
    console.log(`${ok ? '✓' : '✗'} ${vp.width}×${vp.height}: fountain ${result.woke ? 'woken' : 'NOT woken'} after ${result.minutes} min, ${result.pulses} pulses, ${result.built ?? 0} machines${result.unmet.length ? `; unmet: ${result.unmet.join(', ')}` : ''}${result.foreign ? `; got a ${result.foreign} event` : ''}${errors.length ? `; errors: ${errors.join(' | ')}` : ''}`);
    if (!ok) failed = true;
    await page.close();
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);
