// Phase 4 E11: a 15-minute session in the real page (production build): a scripted player taps, builds, buys,
// fires Bloom Frenzy and claims cats while the renderer runs. Fails on any page error; reports frame times.
import { createRequire } from 'node:module';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await preview({ preview: { port: 4200, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let result;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('http://localhost:4200/?slot=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  result = await page.evaluate(async (minutes) => {
    const g = window.solarbloom;
    const s = g.sim;
    const order = ['solar', 'condenser', 'pollinator', 'droneHub', 'pollinator', 'motherTree', 'solar'];
    let next = 0;
    const frames = [];
    let last = performance.now();
    const steps = minutes * 600;
    for (let i = 0; i < steps; i++) {
      if (i % 30 === 0) {
        const want = order[next];
        if (want && s.build.isUnlocked(want) && s.inventory.canPay(s.build.recipe(want) ?? {})) {
          const spot = s.areas.tiles('park').find((t) => s.build.check(want, 'g', t.x, t.z).ok);
          if (spot && s.build.place(want, 'g', spot.x, spot.z)) next++;
        }
        const sug = s.advisor.suggest();
        if (sug.action.kind === 'focus') s.restoration.pulse(s.grid.get(sug.action.layer ?? 'g', sug.action.x, sug.action.z).id);
        else if (sug.action.kind === 'wake') {
          const m = s.machine(sug.action.machineId);
          const id = s.areas.areaOf(m);
          if (id === 'park') s.progression.activateCore();
          else s.areas.clear(id);
        } else if (sug.action.kind === 'build') s.build.place(sug.action.type, 'g', sug.action.x, sug.action.z);
        if (s.state.cat.active) s.cat.claim();
      }
      s.tick();
      // Let the renderer draw a frame every ~2 s of sim time (events reach the VFX and HUD).
      if (i % 20 === 19) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        frames.push(now - last);
        last = now;
      }
    }
    frames.sort((a, b) => a - b);
    return {
      fountain: s.state.progression.coreActivated ? Math.round(s.state.progression.coreActivatedAt) : -1,
      areas: s.areas.clearedCount?.() ?? 0,
      cats: s.state.cat.found,
      tiles: s.state.stats.tilesRestored,
      medianFrameMs: Math.round(frames[Math.floor(frames.length / 2)]),
      p95FrameMs: Math.round(frames[Math.floor(frames.length * 0.95)]),
    };
  }, Number(process.env.SESSION_MINUTES ?? 15));
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(JSON.stringify(result));
if (errors.length) {
  console.error(`page errors:\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('15-minute session: no page errors');
