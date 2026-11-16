// Look 6 (#169): frame strips of living transitions. Each strip holds the visual clock at fixed progress points of
// one transition (deterministic frames, no timing luck) and stitches them side by side. Fails on page or console
// errors (a shader that doesn't compile). Run after `vite build`: `node tests/e2e/look6-shots.mjs [outDir]`.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/look6';
const only = process.argv[3];
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4198, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const W = 1280, H = 800;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`page: ${e}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto('http://localhost:4198/?gfx=high');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  await page.waitForTimeout(1000);
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
  // A small living patch in the park to work from; HUD hidden so the ground shows.
  const base = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    document.querySelectorAll('#hud, .hud, #toolbar, #topbar, #side, #feed, #toasts').forEach((e) => (e.style.visibility = 'hidden'));
    const [fx, fz] = s.areas.info('park').landmark;
    const free = s.areas.tiles('park').filter((t) => s.restoration.isEligible(t) && !t.occupantId && (t.feature ?? 'lawn') === 'lawn');
    free.sort((a, b) => Math.hypot(a.x - fx - 6, a.z - fz) - Math.hypot(b.x - fx - 6, b.z - fz));
    const c = free[0];
    return { x: c.x, z: c.z };
  });

  async function hold(t) {
    await page.evaluate((t) => (window.solarbloom.transitions.hold = t), t);
    await page.waitForTimeout(450);
  }
  async function focus(x, z, zoom) {
    await page.evaluate(([x, z, zoom]) => {
      const g = window.solarbloom;
      g.camera.maxZoom = 4;
      g.camera.glide(x + 0.5, 0, z + 0.5, zoom);
      for (let i = 0; i < 200; i++) g.camera.update(0.05);
    }, [x, z, zoom]);
    await page.waitForTimeout(600);
  }
  /** Runs `setup` in the page (it starts transitions and returns their t0 and duration), then shoots frames. */
  async function strip(name, label, setup, ps, opts = {}) {
    if (only && only !== name) return;
    const zoom = opts.zoom ?? 2.6;
    await page.evaluate(() => (window.solarbloom.paused = false));
    const info = await page.evaluate(setup, base);
    await focus(info.fx ?? base.x, info.fz ?? base.z, zoom);
    await page.evaluate(() => (window.solarbloom.paused = true));
    const cw = opts.w ?? 420, ch = opts.h ?? 300;
    const shots = [];
    for (const p of ps) {
      await hold(info.t0 + p * info.d);
      const buf = await page.screenshot({ clip: { x: (W - cw) / 2, y: (H - ch) / 2 + (opts.dy ?? 30), width: cw, height: ch } });
      shots.push({ p, b64: buf.toString('base64') });
    }
    await page.evaluate(() => (window.solarbloom.transitions.hold = undefined));
    const html = `<html><body style="margin:0;background:#1d2421;font:13px system-ui;color:#e8efe9">
      <div style="padding:6px 10px">${label}</div><div style="display:flex;gap:4px;padding:0 4px 4px">${shots
        .map((s) => `<div><img src="data:image/png;base64,${s.b64}" style="display:block;width:${cw}px"><div style="text-align:center;padding:2px">${Math.round(s.p * info.d * 10) / 10} s</div></div>`)
        .join('')}</div></body></html>`;
    const sp = await browser.newPage({ viewport: { width: shots.length * (cw + 4) + 4, height: ch + 60 } });
    await sp.setContent(html);
    await sp.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    await sp.close();
    console.log('wrote', `${dir}/${name}.png`);
  }

  // Living neighbours for the patch (west side), so creep and cracks come in from there.
  await page.evaluate((b) => {
    const s = window.solarbloom.sim;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -3; dx <= -2; dx++) {
      const t = s.grid.get('g', b.x + dx, b.z + dz);
      if (t && s.restoration.isEligible(t)) s.restoration.complete(t, 'pulse');
    }
    s.advance(20); // their own transitions finish
    window.solarbloom.chunks.markAll();
  }, base);
  await page.waitForTimeout(800);

  await strip('restore-pulse', 'Pulse on a mossy tile: fracture → heave → crumble to soil → seedlings → turf knits (12 s; the sim restores at 0.8 s as before)', (b) => {
    const g = window.solarbloom, s = g.sim;
    const t = s.grid.get('g', b.x, b.z);
    t.ground = 'prepared'; t.pollution = 0; s.grid.touch(t);
    s.state.resources.energy = s.state.caps.energy; s.state.resources.water = s.state.caps.water;
    s.restoration.pulse(t.id);
    const tr = t.tr;
    s.advance(1); // the sim restores it (0.8 s) while the visual is still early in the sequence
    g.chunks.markTile(t);
    return { t0: tr.t0, d: tr.d };
  }, [0, 0.03, 0.12, 0.22, 0.4, 0.55, 0.75, 0.9, 1.0]);

  await strip('restore-chain', 'Chain step (fast variant): the tile counts at once; the fracture flashes on the restore frame, the rest plays out over 5 s', (b) => {
    const g = window.solarbloom, s = g.sim;
    const t = s.grid.get('g', b.x, b.z + 1);
    t.ground = 'polluted'; t.pollution = 70; s.grid.touch(t);
    s.restoration.complete(t, 'chain');
    g.chunks.markTile(t);
    return { t0: t.tr.t0, d: t.tr.d, fx: t.x, fz: t.z };
  }, [0, 0.02, 0.06, 0.2, 0.45, 0.7, 1.0]);

  await strip('soften-moss', 'Concrete softening (pollution 100 → 40, 3 s) then moss creep from the living side (6 s), along the crack lines', (b) => {
    const g = window.solarbloom, s = g.sim;
    const t = s.grid.get('g', b.x, b.z - 1);
    t.ground = 'prepared'; t.pollution = 0; s.grid.touch(t);
    s.transitions.begin(t, 'moss', 6, { from: 60, dir: 2 });
    g.chunks.markTile(t);
    const u = s.grid.get('g', b.x + 1, b.z - 1);
    u.ground = 'polluted'; u.pollution = 40; s.grid.touch(u);
    s.transitions.begin(u, 'soften', 6, { from: 100, dir: 2 });
    g.chunks.markTile(u);
    return { t0: t.tr.t0, d: 6, fx: t.x, fz: t.z };
  }, [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1.0]);

  await strip('bloom', 'Nurture steps grow in: 1 → 2 (3 s), 2 → 3 (4 s), 3 → 4 Radiant (5 s), side by side', (b) => {
    const g = window.solarbloom, s = g.sim;
    let t0 = 0;
    for (let i = 0; i < 3; i++) {
      const t = s.grid.get('g', b.x - 3, b.z - 1 + i);
      t.bloom = 1 + i; s.grid.touch(t);
      s.restoration.grow(t, undefined, 'player');
      s.transitions.begin(t, 'bloom', 5, { from: t.bloom - 1 });
      t0 = t.tr.t0;
      g.chunks.markTile(t);
    }
    return { t0, d: 5, fx: b.x - 3, fz: b.z };
  }, [0, 0.15, 0.3, 0.5, 0.7, 0.9, 1.0]);

  await strip('lush', 'Lush: the wet mask soaks in (2.5 s), then dries back over the last 10 s before the bonus ends (25 s)', (b) => {
    const g = window.solarbloom, s = g.sim;
    const ids = [];
    for (let dz = -1; dz <= 1; dz++) {
      const t = s.grid.get('g', b.x - 2, b.z + dz);
      s.transitions.lush(t, s.time + 25);
      g.chunks.markTile(t);
      ids.push(t.id);
    }
    return { t0: s.time, d: 25, fx: b.x - 2, fz: b.z };
  }, [0, 0.04, 0.1, 0.5, 0.7, 0.85, 0.95, 1.0]);

  await strip('ground-types', 'Each ground type reclaims its own way (restore, 8 s): paving · road · water · clay · litter, left to right', (b) => {
    const g = window.solarbloom, s = g.sim;
    const feats = ['paving', 'road', 'water', 'clay', 'litter'];
    let t0 = 0;
    feats.forEach((f, i) => {
      const t = s.grid.get('g', b.x - 2 + i, b.z + 2);
      t.feature = f; // presentation only (features are generated, never saved)
      t.ground = 'polluted'; t.pollution = 90; t.bloom = 0; s.grid.touch(t);
      s.restoration.complete(t, 'drone');
      s.transitions.begin(t, 'restore', 8, { from: 90, dir: 2 });
      t0 = t.tr.t0;
      g.chunks.markTile(t);
    });
    return { t0, d: 8, fx: b.x, fz: b.z + 2 };
  }, [0, 0.1, 0.3, 0.5, 0.7, 0.85, 1.0], { zoom: 1.9, w: 560 });

  await strip('area-wave', 'An area clears: the ground un-greys and props wake in a wave from the landmark while the fog rolls back as a front (about 3 s)', () => {
    const g = window.solarbloom, s = g.sim;
    const id = s.areas.info('park').neighbours[0];
    const st = s.state.areas[id] ?? (s.state.areas[id] = { fog: 'frontier', revealedAt: s.time });
    st.fog = 'cleared';
    st.clearedAt = s.time;
    g.chunks.markArea(id, true);
    for (const nb of s.areas.info(id).neighbours) g.chunks.markArea(nb);
    const [lx, lz] = s.areas.info(id).landmark;
    return { t0: g.transitions.time, d: 4, fx: lx, fz: lz };
  }, [0, 0.15, 0.3, 0.5, 0.75, 1.0], { zoom: 0.8, w: 640, h: 400 });

  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
  await server.close();
}
void readFileSync; void writeFileSync; void resolve;
