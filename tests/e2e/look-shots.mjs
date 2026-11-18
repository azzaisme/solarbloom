// Look 1.1: the look comparison harness (`npm run shots:look`), the baseline for every Look epic.
//
// Captures fixed scenes (dead park, half-restored park with a pulse in progress, fully restored park, a machine
// cluster, the drone mid-spray, mid and far zoom) at 1280×800 and 390×844,
// each next to the target reference (docs/reference/target-look.png) as a side-by-side image, and records draw
// calls and frame time per scene.
//
// Deterministic: Math.random is seeded before the game loads, and the page runs on Playwright's fake clock, so
// every frame is exactly 1/60 s of game time and the sun, particles, wind and drones are identical run to run.
// Rendering is headless SwiftShader (software), so frame times measure the runner, not a real GPU.
//
//   npm run shots:look                    → docs/look/current/*.jpg + docs/look/current/metrics.json
//   node tests/e2e/look-shots.mjs <tag>   → docs/look/<tag>/ (e.g. baseline, 1.2-key-light)
//   LOOK_SCENES=dead,full LOOK_SIZES=desktop node tests/e2e/look-shots.mjs <tag>   (a subset, quicker)
//   LOOK_QUERY='gfx=low' …                 (the page URL's query; default gfx=high, the High graphics tier)
//   LOOK_RAW=1 …                           (also keep the raw PNG of each shot, for diffing)
//   LOOK_EVAL='g.look…' …                  (JavaScript run in the page after each scene's setup, `g` = the game)
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const tag = process.argv[2] ?? 'current';
const out = `docs/look/${tag}`;
mkdirSync(out, { recursive: true });
const PORT = 4211;
// High by default: Auto would pick Low under SwiftShader (a software renderer).
const query = `?${process.env.LOOK_QUERY ?? 'gfx=high'}`;
const FRAME = 1000 / 60;

const SIZES = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
};

/**
 * Each scene: a setup run in the page against a fresh, seeded game (`g` is window.solarbloom), how long to let
 * it run on the fake clock before the shot, and an optional `until` condition (checked every few frames).
 */
const SCENES = {
  dead: {
    title: 'Dead park',
    setup: `g.camera.glide(8, 0, 8, 1); return {};`,
    settle: 1500,
  },
  half: {
    title: 'Half-restored park, pulse in progress',
    setup: `
      const s = g.sim, st = s.state;
      const B = st.resources.energy.constructor;
      st.caps.energy = new B(1e6); st.caps.water = new B(1e6);
      st.resources.energy = new B(1e6); st.resources.water = new B(1e6); st.resources.biomass = new B(1e6);
      const tiles = s.areas.tiles('park').filter((t) => !t.blocked && !t.occupantId && t.ground !== 'restored');
      tiles.sort((a, b) => Math.hypot(a.x - 3, a.z - 3) - Math.hypot(b.x - 3, b.z - 3));
      const half = Math.floor(tiles.length / 2);
      tiles.slice(0, half).forEach((t, i) => { t.ground = 'restored'; t.bloom = 1 + ((t.x * 3 + t.z * 5) % 3); t.pollution = 0; s.grid.touch(t); });
      // Pulse Reach 2 so the pulse covers a visible patch at the restoration front.
      const reach = s.upgrades.all().find((u) => /reach/i.test(u.id));
      if (reach) st.upgrades[reach.id] = 2;
      const front = tiles[half + 6];
      g.chunks.markAll();
      g.camera.glide(front.x + 0.5, 0, front.z + 0.5, 1.1);
      return { pulseAt: front.id };`,
    // The pulse fires after the world settles, then the shot lands mid-growth.
    after: `s => { const t = s.pulseAt; g.sim.restoration.pulse(t); const tile = g.sim.grid.byTileId(t); const next = g.sim.areas.tiles('park').find((x) => x.ground === 'polluted' && Math.hypot(x.x - tile.x, x.z - tile.z) > 4 && Math.hypot(x.x - tile.x, x.z - tile.z) < 6); if (next) g.overlays.showRadius([next, ...g.sim.restoration.footprint(next).map((f) => f.tile)], 'ok'); }`,
    settle: 1200,
    afterSettle: 700,
  },
  full: {
    title: 'Fully restored park',
    setup: `
      const s = g.sim;
      for (const t of s.areas.tiles('park')) {
        if (!s.restoration.isEligible(t)) continue;
        s.restoration.complete(t, 'pulse');
        t.bloom = 1 + ((t.x * 3 + t.z * 5) % 4);
        s.grid.touch(t);
      }
      s.state.progression.coreActivated = true;
      s.areas.clear('park', true);
      g.chunks.markAll();
      g.camera.glide(8, 0, 8, 1);
      return {};`,
    settle: 3000,
  },
  machines: {
    title: 'Machine cluster (solar, condenser, core)',
    setup: `
      const s = g.sim, st = s.state;
      const B = st.resources.energy.constructor;
      st.caps.energy = new B(1e6); st.caps.water = new B(1e6);
      st.resources.energy = new B(1e6); st.resources.water = new B(1e6); st.resources.biomass = new B(1e6);
      for (const t of s.areas.tiles('park')) if (s.restoration.isEligible(t)) { s.restoration.complete(t, 'pulse'); t.bloom = 2 + ((t.x + t.z) % 2); s.grid.touch(t); }
      st.progression.coreActivated = true;
      s.areas.clear('park', true);
      const core = st.machines.find((m) => m.type === 'core');
      const cx = core ? core.x + core.size / 2 : 8, cz = core ? core.z + core.size / 2 : 8;
      const near = s.areas.tiles('park').sort((a, b) => Math.hypot(a.x + 0.5 - cx, a.z + 0.5 - cz) - Math.hypot(b.x + 0.5 - cx, b.z + 0.5 - cz));
      const built = [];
      for (const type of ['solar', 'condenser', 'solar']) {
        const t = near.find((t) => s.build.check(type, 'g', t.x, t.z).ok);
        if (t && s.build.place(type, 'g', t.x, t.z)) built.push([t.x, t.z]);
      }
      const xs = [cx, ...built.map((b) => b[0] + 0.5)], zs = [cz, ...built.map((b) => b[1] + 0.5)];
      g.chunks.markAll();
      g.camera.glide(xs.reduce((a, b) => a + b) / xs.length, 0, zs.reduce((a, b) => a + b) / zs.length, 1.6);
      return { built: built.length };`,
    settle: 3000,
  },
  drone: {
    title: 'Drone mid-spray',
    setup: `g.camera.glide(8, 0, 8, 1.5); return {};`,
    // Wait until a drone is spraying, then frame it.
    until: `() => g.sim.state.drones.some((d) => d.mode === 'working')`,
    after: `() => { const d = g.sim.state.drones.find((d) => d.mode === 'working'); const p = g.drones.worldPos(d.id); g.camera.glide(p.x, 0, p.z, 1.75); for (let i = 0; i < 240; i++) g.camera.update(0.05); }`,
    settle: 400,
    afterSettle: 300,
  },
  roles: {
    // E18.5: one drone of each role at work (roles read by shape: parts, eyes and work effect).
    title: 'Drone roles at work (Restorer, Gardener, Scout, Courier, Spark, Harvester)',
    setup: `
      const s = g.sim, st = s.state;
      const B = st.resources.energy.constructor;
      st.caps.energy = new B(1e6); st.caps.water = new B(1e6);
      st.resources.energy = new B(1e6); st.resources.water = new B(1e6); st.resources.biomass = new B(1e6);
      const park = s.areas.tiles('park');
      park.forEach((t, i) => { if (s.restoration.isEligible(t) && i % 3) { s.restoration.complete(t, 'pulse'); t.bloom = 1 + ((t.x + t.z) % 2); s.grid.touch(t); } });
      st.progression.coreActivated = true;
      s.areas.clear('park', true);
      const at = (type) => { const t = park.find((t) => s.build.check(type, 'g', t.x, t.z).ok); return t && s.build.place(type, 'g', t.x, t.z) ? st.machines[st.machines.length - 1] : undefined; };
      for (const type of ['condenser', 'motherTree', 'pollinator', 'pollinator', 'pollinator', 'solar']) at(type);
      const roles = ['restorer', 'gardener', 'scout', 'courier', 'spark', 'harvester'];
      for (const r of roles) { const h = at('droneHub'); if (h && r !== 'restorer') { h.roles = [r]; h.role = r; } }
      st.caps.energy = new B(400); st.resources.energy = new B(400); // a full store, so the Harvester works too
      g.chunks.markAll();
      g.camera.glide(8, 0, 8, 1.15);
      return {};`,
    until: `() => new Set(g.sim.state.drones.filter((d) => d.mode === 'working' || d.mode === 'flying').map((d) => g.sim.roles.roleFor(d, g.sim.machine(d.hubId)))).size >= 4`,
    settle: 2500,
  },
  mid: {
    title: 'Mid zoom (restored park)',
    setup: `
      const s = g.sim;
      for (const t of s.areas.tiles('park')) if (s.restoration.isEligible(t)) { s.restoration.complete(t, 'pulse'); t.bloom = 1 + ((t.x * 3 + t.z * 5) % 4); s.grid.touch(t); }
      s.state.progression.coreActivated = true;
      s.areas.clear('park', true);
      g.chunks.markAll();
      g.camera.glide(8, 0, 8, 0.7);
      return {};`,
    settle: 3000,
  },
  far: {
    title: 'Far zoom (restored park, city beyond)',
    setup: `
      const s = g.sim;
      for (const t of s.areas.tiles('park')) if (s.restoration.isEligible(t)) { s.restoration.complete(t, 'pulse'); t.bloom = 1 + ((t.x * 3 + t.z * 5) % 4); s.grid.touch(t); }
      s.state.progression.coreActivated = true;
      s.areas.clear('park', true);
      g.chunks.markAll();
      g.camera.glide(8, 0, 8, 0.42);
      return {};`,
    settle: 3500,
  },
};

const pick = (env, all) => (env ? env.split(',').filter((k) => all[k]) : Object.keys(all));
const sceneKeys = pick(process.env.LOOK_SCENES, SCENES);
const sizeKeys = pick(process.env.LOOK_SIZES, SIZES);

/** A seeded Math.random (mulberry32), installed before any game script runs. */
const SEED_SCRIPT = `(() => { let a = 0x5eed1e5; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const metrics = { tag, query, renderer: 'headless Chromium, SwiftShader (software GL)', when: new Date().toISOString(), shots: {} };
const target = `data:image/png;base64,${readFileSync('docs/reference/target-look.png').toString('base64')}`;

/** Advances the fake clock in frame steps until `cond` holds (or `maxMs` of game time passes). */
async function runUntil(page, cond, maxMs, step = 100) {
  for (let t = 0; t < maxMs; t += step) {
    if (await page.evaluate(cond)) return true;
    await page.clock.runFor(step);
  }
  return page.evaluate(cond);
}

async function shoot(sceneKey, sizeKey) {
  const scene = SCENES[sceneKey];
  const size = SIZES[sizeKey];
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${sceneKey}/${sizeKey}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${sceneKey}/${sizeKey} console: ${m.text()}`));
  await page.addInitScript(SEED_SCRIPT);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  // The fake clock flows in real time after install unless paused: pause it so time moves only by runFor.
  await page.clock.install({ time: new Date('2026-06-21T16:30:00') });
  await page.clock.pauseAt(new Date('2026-06-21T16:30:01'));
  await page.goto(`http://localhost:${PORT}/${query ? query + '&' : '?'}slot=1`);
  // Boot with the fake clock frozen (the save loads through promises, not timers), so the game always starts
  // at the same fake time; only then do frames begin.
  let booted = false;
  for (let i = 0; i < 300 && !booted; i++) {
    booted = await page.evaluate(() => !!window.solarbloom);
    if (!booted) await new Promise((r) => setTimeout(r, 100));
  }
  if (!booted) throw new Error(`${sceneKey}/${sizeKey}: game did not boot`);
  // Let every asset finish loading (real time, clock still frozen) before anything moves.
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({ content: '#hud, #toasts, .toast, #intro, #boot, #tip, .tip, #labels, .area-label { display: none !important; }' });
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
  // Settling only needs the update loop; skip rendering until the last frames (SwiftShader frames are slow).
  const render = (on) => page.evaluate((on) => (window.solarbloom.app.autoRender = on), on);
  await render(false);
  await page.clock.runFor(500);
  const state = await page.evaluate(`(() => { const g = window.solarbloom; ${scene.setup} })()`);
  if (process.env.LOOK_EVAL) await page.evaluate(`(() => { const g = window.solarbloom; ${process.env.LOOK_EVAL} })()`);
  await page.clock.runFor(scene.settle);
  if (scene.until && !(await runUntil(page, `(() => { const g = window.solarbloom; return (${scene.until})(); })()`, 60000, 250))) throw new Error(`${sceneKey}/${sizeKey}: scene condition never held`);
  if (scene.after) {
    await page.evaluate(`(() => { const g = window.solarbloom; (${scene.after})(${JSON.stringify(state)}); })()`);
    await page.clock.runFor(scene.afterSettle ?? 500);
  }
  // Every rendered frame ends with a 1-pixel readback, so SwiftShader finishes it before the next one: frame
  // times are real, and the screenshot is the last frame rather than whatever the GPU process had got to.
  await page.evaluate(() => {
    const app = window.solarbloom.app;
    const gl = app.graphicsDevice.gl;
    const px = new Uint8Array(4);
    app.on('frameend', () => gl && gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px));
  });
  await render(true);
  await page.clock.runFor(10 * FRAME);
  // Measure: real wall time for 30 frames on the fake clock (each one renders), and the engine's draw calls.
  const N = 30;
  const t0 = performance.now();
  await page.clock.runFor(N * FRAME);
  const frameMs = (performance.now() - t0) / N;
  const stats = await page.evaluate(() => {
    const g = window.solarbloom;
    const c = g.app.graphicsDevice.canvas;
    return { simTime: +g.sim.time.toFixed(2), restored: g.sim.areas.counts('park').restored, drawCalls: g.app.stats.drawCalls.total, triangles: g.app.stats.frame.triangles, canvas: [c.width, c.height], tier: g.gfxTier ?? 'n/a' };
  });
  const png = await page.screenshot({ type: 'png' });
  const name = `${sceneKey}-${sizeKey}`;
  if (process.env.LOOK_RAW) writeFileSync(`${out}/${name}.png`, png);
  // The side-by-side: the shot on the left, the target on the right, at the same height.
  const side = await page.evaluate(
    async ({ shot, target, title, label }) => {
      const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
      const [a, b] = await Promise.all([load(shot), load(target)]);
      const H = 800;
      const wa = Math.round((a.width / a.height) * H);
      const wb = Math.round((b.width / b.height) * H);
      const bar = 58;
      const cv = document.createElement('canvas');
      cv.width = wa + wb + 12;
      cv.height = H + bar;
      const x = cv.getContext('2d');
      x.fillStyle = '#111';
      x.fillRect(0, 0, cv.width, cv.height);
      x.drawImage(a, 0, bar, wa, H);
      x.drawImage(b, wa + 12, bar, wb, H);
      x.fillStyle = '#fff';
      x.font = 'bold 20px sans-serif';
      x.fillText(`${title} · ${label}`, 10, 24);
      x.font = '16px sans-serif';
      x.fillText('Solarbloom', 10, 48);
      x.fillText('Target (reference)', wa + 22, 48);
      return cv.toDataURL('image/jpeg', 0.86);
    },
    { shot: `data:image/png;base64,${png.toString('base64')}`, target, title: scene.title, label: tag },
  );
  writeFileSync(`${out}/${name}.jpg`, Buffer.from(side.split(',')[1], 'base64'));
  const hash = createHash('sha1').update(png).digest('hex').slice(0, 12);
  metrics.shots[name] = { scene: scene.title, size: `${size.width}x${size.height}`, frameMs: +frameMs.toFixed(1), ...stats, sha1: hash };
  console.log(`  ${name.padEnd(17)} frame ${frameMs.toFixed(0).padStart(4)} ms · draw calls ${String(stats.drawCalls).padStart(4)} · ${hash}`);
  await ctx.close();
}

try {
  for (const s of sceneKeys) for (const z of sizeKeys) await shoot(s, z);
} finally {
  await browser.close();
  server.httpServer.close();
}
writeFileSync(`${out}/metrics.json`, JSON.stringify(metrics, null, 2) + '\n');
console.log(`wrote ${Object.keys(metrics.shots).length} shots to ${out}/`);
if (errors.length) {
  console.error(`ERRORS:\n${errors.join('\n')}`);
  process.exit(1);
}
