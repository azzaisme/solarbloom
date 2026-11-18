// Look 4 (#148, #150, #154): camera maths under the perspective view.
//  - a drag keeps the ground point under the pointer fixed (top, middle and bottom of the screen, every band)
//  - wheel / pinch zoom keeps the ground under the cursor fixed while it eases in
//  - the camera can't be panned so the visible edges leave the bounds (plus the allowed slack)
//  - world points behind the camera are reported as hidden (labels never draw there)
// Run after `vite build`.
import { createRequire } from 'node:module';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const server = await preview({ preview: { port: 4198, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
let checks = 0;
const check = (ok, msg) => {
  checks++;
  if (!ok) {
    failures++;
    console.error('  ✗', msg);
  }
};

try {
  for (const [name, width, height] of [['desktop', 1280, 800], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:4198/?slot=1');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.solarbloom);
    if (await page.locator('#introGo').isVisible()) await page.click('#introGo');

    for (const zoom of [0.3, 0.6, 1, 1.4, 1.9]) {
      const r = await page.evaluate(
        ({ zoom, width, height }) => {
          const g = window.solarbloom;
          const c = g.camera;
          c.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
          c.glide(8, 0, 8, zoom);
          for (let i = 0; i < 200; i++) c.update(0.05);
          const out = { pan: [], zoom: [] };
          // Drag at three heights on screen: the ground that was under the pointer is under it afterwards.
          for (const fy of [0.25, 0.5, 0.85]) {
            const x = width * 0.5;
            const y = height * fy;
            const before = c.groundAt(x, y);
            if (!before) continue;
            for (const [dx, dy] of [[30, 0], [0, 25], [-20, -30]]) {
              c.pan(dx, dy, x + dx, y + dy);
              const after = c.groundAt(x + dx, y + dy);
              out.pan.push({ fy, err: after ? Math.hypot(after.x - before.x, after.z - before.z) : 99 });
              c.pan(-dx, -dy, x, y);
            }
          }
          // Zoom toward a point off centre: the ground under it stays put once the zoom settles.
          for (const [fx, fy, f] of [[0.25, 0.7, 1.3], [0.75, 0.4, 0.8]]) {
            const x = width * fx;
            const y = height * fy;
            const before = c.groundAt(x, y);
            if (!before) continue;
            c.zoomBy(f, x, y);
            for (let i = 0; i < 120; i++) c.update(0.05);
            const after = c.groundAt(x, y);
            const clamped = c.zoom <= c.minZoom + 1e-6 || c.zoom >= c.maxZoom - 1e-6;
            out.zoom.push({ fx, fy, clamped, err: after ? Math.hypot(after.x - before.x, after.z - before.z) : 99, wpp: c.worldPerPixel() });
          }
          return out;
        },
        { zoom, width, height },
      );
      for (const p of r.pan) check(p.err < 0.05, `${name} z${zoom}: drag at ${p.fy} of the height moved the ground ${p.err.toFixed(3)}`);
      for (const z of r.zoom)
        if (!z.clamped) check(z.err < Math.max(0.05, z.wpp * 3), `${name} z${zoom}: zoom toward (${z.fx}, ${z.fy}) drifted ${z.err.toFixed(3)}`);
    }

    // Bounds: pan hard in every direction; the visible ground edges stay within the bounds + slack.
    const b = await page.evaluate(() => {
      const g = window.solarbloom;
      const c = g.camera;
      const out = [];
      const B = { minX: -24, maxX: 40, minZ: -24, maxZ: 40 };
      for (const zoom of [0.5, 1, 1.9]) {
        c.bounds = { ...B };
        c.glide(8, 0, 8, zoom);
        for (let i = 0; i < 200; i++) c.update(0.05);
        const cv = g.app.graphicsDevice.canvas;
        const w = cv.clientWidth;
        const h = cv.clientHeight;
        for (const [dx, dy] of [[4000, 0], [-4000, 0], [0, 4000], [0, -4000], [3000, 3000]]) {
          for (let i = 0; i < 40; i++) c.pan(dx / 40, dy / 40, w / 2 + dx / 40, h / 2 + dy / 40);
          for (let i = 0; i < 40; i++) c.update(0.05);
          let worst = 0;
          const e = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
          for (const [sx, sy] of [[0, h], [w, h], [0, h / 2], [w, h / 2], [w / 2, h], [0, 0], [w, 0], [w / 2, 0]]) {
            const p = c.groundAt(sx, sy, c.dist * 2.5);
            if (!p) continue;
            e.x0 = Math.min(e.x0, p.x); e.x1 = Math.max(e.x1, p.x); e.z0 = Math.min(e.z0, p.z); e.z1 = Math.max(e.z1, p.z);
            worst = Math.max(worst, B.minX - p.x, p.x - B.maxX, B.minZ - p.z, p.z - B.maxZ);
          }
          // A view wider than the bounds (+ slack) on an axis centres on them instead: allow its overhang.
          const over = Math.max(0, (e.x1 - e.x0 - (B.maxX - B.minX)) / 2, (e.z1 - e.z0 - (B.maxZ - B.minZ)) / 2);
          worst = Math.min(worst, Math.max(0, worst - over));
          const t = c.target;
          const span = Math.min(B.maxX - B.minX, B.maxZ - B.minZ);
          out.push({ zoom, dx, dy, worst, slack: c.edgeSlack, inside: t.x >= B.minX && t.x <= B.maxX && t.z >= B.minZ && t.z <= B.maxZ, span });
        }
      }
      return out;
    });
    for (const r of b) {
      check(r.inside, `${name} z${r.zoom}: pan (${r.dx}, ${r.dy}) left the target outside the bounds`);
      check(r.worst <= r.slack + 0.6, `${name} z${r.zoom}: pan (${r.dx}, ${r.dy}) shows ${r.worst.toFixed(2)} past the bounds (slack ${r.slack})`);
    }

    // Labels: a point behind the camera is never on screen.
    const behind = await page.evaluate(() => {
      const g = window.solarbloom;
      const c = g.camera;
      if (!c.onScreen) return undefined; // added with #150
      c.glide(8, 0, 8, 1.9);
      for (let i = 0; i < 200; i++) c.update(0.05);
      const p = c.entity.getPosition();
      const f = c.entity.forward;
      const V = c.target.constructor;
      const back = new V(p.x - f.x * 5, p.y - f.y * 5, p.z - f.z * 5);
      return { behind: c.onScreen(back), front: c.onScreen(new V(8, 0, 8)) };
    });
    if (behind) {
      check(!behind.behind, `${name}: a point behind the camera was reported on screen`);
      check(!!behind.front, `${name}: the target point was reported off screen`);
    }

    check(!errors.length, `${name}: page errors ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`camera e2e: ${checks - failures}/${checks} checks pass`);
process.exit(failures ? 1 : 0);
