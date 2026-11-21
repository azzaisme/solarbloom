// Bloombot (G.7; #572 for E23's island): a new game played to the island's first goal, fountain step 1 ("Water
// returns", which wakes the park), with only a virtual gamepad: no mouse or keyboard events at all. The scripted
// player (tests/e2e/gamepad-driver.js) reads the game state to choose where to go and acts through
// navigator.getGamepads(): the stick to walk and turn, X to pulse, A held to salvage the Scrap and Seeds piles, A at
// the fountain to open its panel, the d-pad and A to press "Give all I have", B to close panels, pad 14 to eat.
//
// To finish in seconds, the page's frames are stepped by the script (30 per simulated second) rather than
// waiting for real time; every frame still reads the pad exactly as in play.
//
// Run with `npm run build && node tests/e2e/gamepad.e2e.mjs` (GPU=1 runs on the real GPU, d3d11; without it,
// SwiftShader). Requires Playwright + Chromium:
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
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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
    await page.goto('http://localhost:4211/?slot=1');
    await page.waitForFunction(() => window.solarbloom?.bot, null, { timeout: 180000 });
    // the player takes the pad once the loading screen has gone (the HUD is hidden until then)
    await page.waitForFunction(() => !document.body.classList.contains('loading-on'), null, { timeout: 300000 });
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
      // what fountain step 1 still wants, if it isn't done
      const f = g.sim.fountain;
      const t = g.sim.state.salvage.tier < 1 ? f.next() : undefined;
      const unmet = [];
      if (t) {
        for (const m of Object.keys(t.delivery)) if (m !== 'biomass' && f.remaining(m) > 0) unmet.push(`${m} ${f.given(m)} of ${t.delivery[m]}`);
        const c = f.condition(t);
        if (!c.done) unmet.push(`${c.label} ${c.have} of ${c.need}`);
      }
      return { ...d.state, minutes: +(g.sim.state.time / 60).toFixed(1), tier: g.sim.state.salvage.tier, foreign: window.__foreignInput ?? null, unmet };
    });
    // the step done by the pad alone: pulses (X), salvage holds and the fountain's panel (A), things handed in
    const ok = result.woke && result.tier >= 1 && result.pulses > 0 && result.salvaged > 0 && result.delivered > 0 && !result.foreign && !errors.length;
    console.log(`${ok ? '✓' : '✗'} ${vp.width}×${vp.height}: fountain step 1 ${result.woke ? 'done, the park awake' : 'NOT done'} after ${result.minutes} min: ${result.pulses} pulses, ${result.salvaged} salvaged, ${result.delivered} handed in${result.unmet.length ? `; unmet: ${result.unmet.join(', ')}` : ''}${result.foreign ? `; got a ${result.foreign} event` : ''}${errors.length ? `; errors: ${errors.join(' | ')}` : ''}`);
    if (!ok) {
      failed = true;
      console.log(['  what it went for:', ...result.trace.map((t) => `    ${t}`)].join('\n'));
    }
    await page.close();
  }
} finally {
  // a clean exit: closing the browser can hang in software GL
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]).catch(() => {});
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);
