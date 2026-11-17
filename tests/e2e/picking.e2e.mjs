// End-to-end pointer → tile picking test across screen sizes and zoom levels.
// Run with `npm run test:e2e` (builds first). Requires Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
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

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'phone', width: 390, height: 844 },
];
const ZOOMS = [0.6, 1, 1.8];
// Offsets inside a tile (fractions of a tile) — corners as well as the centre.
const OFFSETS = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.2], [0.2, 0.85], [0.85, 0.85]];

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
// Bloombot (G.17): this checks pointer picking itself, so it runs the internal cursor path.
const url = 'http://localhost:4179/?cursor=1';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
let checks = 0;
const fail = (msg) => {
  failures++;
  console.error('  ✗', msg);
};

try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.solarbloom);
    if (await page.locator('#introGo').isVisible()) await page.click('#introGo');
    // The city ground, focused at a few spots (the park and its surroundings), at each zoom.
    for (const [fx, fz] of [[8, 8], [24, -10], [-12, 20]]) {
      // On the phone, also at both zoom limits (the far overview and the closest view).
      for (const zoom of vp.name === 'phone' ? [...ZOOMS, 0.22, 1.9] : ZOOMS) {
        const res = await page.evaluate(
          ({ zoom, OFFSETS, fx, fz }) => {
            const g = window.solarbloom;
            const V = g.camera.target.constructor;
            g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
            g.camera.glide(fx, 0, fz, zoom);
            for (let i = 0; i < 200; i++) g.camera.update(0.05);
            const out = [];
            for (let z = fz - 14; z < fz + 14; z++)
              for (let x = fx - 14; x < fx + 14; x++) {
                const t = g.sim.grid.get('g', x, z);
                for (const [ox, oz] of OFFSETS) {
                  // Look 4.9: unrevealed ground is drawn sunk; it's only seen where the city doesn't hide it.
                  const sunk = g.sunkAt(x + ox, z + oz);
                  const s = g.camera.toScreen(new V(x + ox, 0.08 - (sunk ? g.sinkDepth : 0), z + oz));
                  if (s.x < 0 || s.y < 0 || s.x > innerWidth || s.y > innerHeight) continue;
                  if (sunk) {
                    const { o, d } = g.camera.ray(s.x, s.y);
                    const k = (0.08 - o.y) / d.y;
                    if (!g.sunkAt(o.x + d.x * k, o.z + d.z * k)) continue; // behind the raised city's edge
                  }
                  const p = g.pick(s.x, s.y);
                  out.push({ want: t.id, got: p?.tile?.id ?? null, sameRoof: true });
                }
              }
            if (!out.length) out.push({ want: 'camera', got: JSON.stringify([g.camera.target, g.camera.zoom]), sameRoof: false });
            return out;
          },
          { zoom, OFFSETS, fx, fz },
        );
        checks += res.length;
        const bad = res.filter((r) => r.want !== r.got);
        if (res.length === 1 && res[0].want === 'camera') fail(`${vp.name} (${fx},${fz}) zoom ${zoom}: no tiles on screen, camera ${res[0].got}`);
        if (bad.length) fail(`${vp.name} (${fx},${fz}) zoom ${zoom}: ${bad.length}/${res.length} mispicked, e.g. ${JSON.stringify(bad[0])}`);
      }
    }
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.camera.glide(8, 0, 8, 1);
      for (let i = 0; i < 200; i++) g.camera.update(0.05);
    });
    await page.waitForTimeout(1500); // let the HUD catch up (world labels follow the camera)
    // A real mouse click at a tile's screen position must pulse exactly that tile.
    await page.evaluate(() => window.solarbloom.camera.setZoom(1));
    const target = await page.evaluate(() => {
      const g = window.solarbloom;
      g.paused = true; // keep state still while we inspect it
      const V = g.camera.target.constructor;
      const s = g.camera.toScreen(new V(2.5, 0.08, 4.5));
      return { x: s.x, y: s.y };
    });
    await page.mouse.click(target.x, target.y);
    const clicked = await page.evaluate(() => window.solarbloom.sim.grid.get('g', 2, 4).ground);
    checks++;
    if (clicked !== 'growing') {
      const why = await page.evaluate(({ x, y }) => {
        const g = window.solarbloom;
        const el = document.elementFromPoint(x, y);
        return { pick: g.pick(x, y)?.tile?.id, el: el?.id || el?.className, res: g.sim.state.resources, tool: g.hud.currentTool };
      }, target);
      fail(`${vp.name}: real click on g:2:4 left it '${clicked}' ${JSON.stringify(why)}`);
    }
    // Phase 5 E16: fauna never take a tap. With every creature unlocked around a lush park, the tile under each
    // actor picks as that tile, and a real click on a songbird's spot nurtures the lawn under it.
    await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      const st = s.state;
      for (const t of s.areas.tiles('park')) {
        if (t.blocked || t.occupantId || t.ground === 'restored') continue;
        if (t.ground !== 'growing') s.restoration.complete(t, 'pulse');
        t.ground = 'restored';
        t.growthRemainingSec = 0;
        t.bloom = 2;
        s.grid.touch(t);
      }
      const D = st.resources.biomass.constructor;
      st.caps.energy = new D(1e6);
      st.caps.water = new D(1e6);
      for (const k of ['energy', 'water', 'biomass']) st.resources[k] = new D(1e6);
      st.progression.coreActivated = true;
      st.fauna = { butterflies: 0, birds: 0, koi: 0, robots: 0 };
      g.chunks.markAll();
      g.paused = false;
    });
    // Fauna re-plan once a second of frames; software rendering can be slow, so wait for them rather than a fixed time.
    await page.waitForFunction(() => Object.values(window.solarbloom.fauna.active).some((n) => n > 0), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
    const fauna = await page.evaluate(() => {
      const g = window.solarbloom;
      g.paused = true;
      const V = g.camera.target.constructor;
      const out = [];
      for (const [kind, pool] of Object.entries(g.fauna.pools))
        for (const a of pool) {
          if (!a.used) continue;
          const p = a.root.getPosition();
          const s = g.camera.toScreen(new V(p.x, 0.08, p.z));
          if (s.x < 0 || s.y < 0 || s.x > innerWidth || s.y > innerHeight) continue;
          out.push({ kind, x: s.x, y: s.y, want: `g:${Math.floor(p.x)}:${Math.floor(p.z)}`, got: g.pick(s.x, s.y)?.tile?.id ?? null });
        }
      return out;
    });
    checks += fauna.length;
    if (!fauna.length) fail(`${vp.name}: no fauna on screen to test ${await page.evaluate(() => { const g = window.solarbloom; return JSON.stringify({ active: g.fauna.active, eco: g.sim.ecosystem.unlocked(), city: !!g.city, t: g.camera.target, z: g.camera.zoom, paused: g.paused, modal: g.hud.modalOpen }); })}`);
    // a hair inside a tile edge can round either way; the actor's own tile or an edge neighbour both mean "not the actor"
    const wrong = fauna.filter((f) => f.got === null || f.got.split(':').slice(1).some((v, i) => Math.abs(Number(v) - Number(f.want.split(':')[i + 1])) > 1));
    if (wrong.length) fail(`${vp.name}: ${wrong.length}/${fauna.length} taps on fauna missed the ground, e.g. ${JSON.stringify(wrong[0])}`);
    const bird = fauna.find((f) => f.kind === 'groundBirds' && f.got === f.want);
    if (bird) {
      const before = await page.evaluate((id) => window.solarbloom.sim.grid.byTileId(id).bloom, bird.want);
      await page.mouse.click(bird.x, bird.y);
      const after = await page.evaluate((id) => window.solarbloom.sim.grid.byTileId(id).bloom, bird.want);
      checks++;
      if (!(after > before)) fail(`${vp.name}: a real click on a songbird at ${bird.want} didn't nurture its tile (${before} → ${after})`);
    }
    // Clicking the HUD must never act on the world underneath.
    const before = await page.evaluate(() => JSON.stringify(window.solarbloom.sim.state.resources));
    const box = await page.locator('#hotbar').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 4);
    const after = await page.evaluate(() => JSON.stringify(window.solarbloom.sim.state.resources));
    checks++;
    if (before !== after) fail(`${vp.name}: clicking the hotbar changed resources`);
    // Regression (found by merge.e2e in E14): a drone hovering beside a machine took taps meant for the machine
    // (drones have a generous tap radius). A tap on a machine's footprint selects the machine; a tap right on the
    // drone still selects the drone's hub. Mouse and touch alike.
    const dronePick = await page.evaluate(async () => {
      const g = window.solarbloom;
      const s = g.sim;
      const V = g.camera.target.constructor;
      const B = s.state.resources.energy.constructor;
      s.state.resources.biomass = new B(1e9);
      s.state.caps.energy = new B(1e6); s.state.caps.water = new B(1e6);
      s.state.resources.energy = new B(1e6); s.state.resources.water = new B(1e6);
      let m;
      for (let z = 6; z < 14 && !m; z++) for (let x = 4; x < 14 && !m; x++) if (s.build.check('solar', 'g', x, z).ok) m = s.build.place('solar', 'g', x, z);
      if (!m) return { error: 'no room for a panel' };
      g.selectTool('pulse');
      const [wx, wy, wz] = s.grid.tileWorld(s.grid.get('g', m.x, m.z));
      g.camera.glide(wx, 0, wz, 1);
      for (let i = 0; i < 200; i++) g.camera.update(0.05);
      const c = g.app.graphicsDevice.canvas;
      const r = c.getBoundingClientRect();
      const tap = g.camera.toScreen(new V(wx, wy + 0.08, wz));
      // One drone (not this panel's) hovers just beside the tap point on screen: inside the old generous radius,
      // outside the drone's own body. The others are kept out of the way.
      const drone = s.state.drones.find((d) => d.hubId !== m.id);
      const off = Math.max(26, 0.35 / g.camera.worldPerPixel()) * 0.7;
      const ray = g.camera.ray(tap.x + off * 0.6, tap.y - off * 0.8);
      const t = (wy + 0.9 - ray.o.y) / ray.d.y;
      const dp = new V(ray.o.x + ray.d.x * t, ray.o.y + ray.d.y * t, ray.o.z + ray.d.z * t);
      g.drones.worldPos = (id) => (id === drone.id ? dp : undefined);
      const ds = g.camera.toScreen(dp);
      return { id: m.id, hub: drone.hubId, tap: { x: tap.x + r.left, y: tap.y + r.top }, drone: { x: ds.x + r.left, y: ds.y + r.top }, occupant: s.occupant(g.pick(tap.x, tap.y)?.tile)?.id };
    });
    if (dronePick.error) fail(`${vp.name}: ${dronePick.error}`);
    else {
      if (dronePick.occupant !== dronePick.id) fail(`${vp.name}: the tap point isn't on the panel's footprint (${dronePick.occupant})`);
      const selectedAfter = async (fn) => {
        await page.evaluate(() => window.solarbloom.select(undefined));
        await fn();
        await page.waitForTimeout(150);
        return page.evaluate(() => window.solarbloom.selected);
      };
      const touchTap = (p) => page.evaluate(({ x, y }) => {
        const c = window.solarbloom.app.graphicsDevice.canvas;
        const ev = (type) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true, button: 0 }));
        ev('pointerdown');
        ev('pointerup');
      }, p);
      for (const [how, fn] of [
        ['mouse', (p) => page.mouse.click(p.x, p.y)],
        ['touch', touchTap],
      ]) {
        checks += 2;
        const onPanel = await selectedAfter(() => fn(dronePick.tap));
        if (onPanel !== dronePick.id) fail(`${vp.name}: ${how} tap on a panel with a drone beside it selected ${onPanel} instead of ${dronePick.id}`);
        const onDrone = await selectedAfter(() => fn(dronePick.drone));
        if (onDrone !== dronePick.hub) fail(`${vp.name}: ${how} tap right on a drone selected ${onDrone} instead of its hub ${dronePick.hub}`);
      }
      await page.evaluate(() => {
        const g = window.solarbloom;
        delete g.drones.worldPos; // back to the prototype method
        g.select(undefined);
      });
    }
    // Regression: when the last tile using a colour (e.g. all moss) disappears, shared meshes must survive.
    await page.evaluate(() => {
      const s = window.solarbloom.sim;
      for (const t of s.progression.tilesFor('home')) if (t.ground === 'prepared') s.restoration.complete(t, 'pulse');
      for (const t of s.progression.tilesFor('home')) if (t.ground === 'polluted' && !t.blocked) { t.ground = 'prepared'; t.pollution = 0; window.solarbloom.chunks.markTile(t); break; }
    });
    await page.waitForTimeout(1500);
    if (errors.length) fail(`${vp.name}: page errors: ${errors.join(' | ')}`);
    console.log(`  ${failures ? '·' : '✓'} ${vp.name} ${vp.width}×${vp.height}`);
    if (vp.name === 'phone') {
      // A quick two-finger pinch-out snaps to the city overview.
      const snapped = await page.evaluate(async () => {
        const g = window.solarbloom;
        g.camera.setZoom(1.2);
        const c = g.app.graphicsDevice.canvas;
        const r = c.getBoundingClientRect();
        const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 1 }));
        const cx = r.width / 2;
        const cy = r.height / 2;
        ev('pointerdown', 1, cx - 150, cy);
        ev('pointerdown', 2, cx + 150, cy);
        for (let i = 1; i <= 6; i++) {
          const half = 150 - i * 20;
          ev('pointermove', 1, cx - half, cy);
          ev('pointermove', 2, cx + half, cy);
          await new Promise((res) => setTimeout(res, 16));
        }
        ev('pointerup', 2, cx + 30, cy);
        ev('pointerup', 1, cx - 30, cy);
        for (let i = 0; i < 300; i++) g.camera.update(0.05);
        return g.camera.zoom;
      });
      checks++;
      if (snapped > 0.25) fail(`phone: a quick pinch-out left the camera at zoom ${snapped.toFixed(2)} instead of the overview`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(failures ? `\n${failures} failure(s) in ${checks} checks` : `\nAll ${checks} picking checks passed`);
process.exit(failures ? 1 : 0);
