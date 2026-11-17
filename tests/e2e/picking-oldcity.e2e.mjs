// E21.24: pointer → tile picking on the Old City's terraces: the park's stairs to the beach, Mast Row's tram
// embankment and its ramp, the beach below the park, at three zooms. A point hidden behind a higher terrace (the ray
// meets ground before it reaches the point) is skipped: the visible tile is what should be picked there.
// Run with `npm run test:e2e` (builds first).
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
const ZOOMS = [0.6, 1, 1.8];
const OFFSETS = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.2], [0.2, 0.85], [0.85, 0.85]];
const SPOTS = [[8, 14], [26, -22], [8, 26], [27, -27]];

const server = await preview({ preview: { port: 4181, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
let checks = 0;
let hidden = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4181/?cursor=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  const rules = await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.state.areas.mastRow = { fog: 'thinning', revealedAt: 0 };
    window.solarbloom.chunks.markAll();
    return s.state.rules;
  });
  if (rules !== 'oldcity') throw new Error('expected an Old City');
  for (const [fx, fz] of SPOTS)
    for (const zoom of ZOOMS) {
      const res = await page.evaluate(
        ({ zoom, OFFSETS, fx, fz }) => {
          const g = window.solarbloom;
          const V = g.camera.target.constructor;
          g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
          g.camera.glide(fx, 0, fz, zoom);
          for (let i = 0; i < 200; i++) g.camera.update(0.05);
          const out = [];
          let hidden = 0;
          for (let z = fz - 10; z < fz + 10; z++)
            for (let x = fx - 10; x < fx + 10; x++) {
              const t = g.sim.grid.get('g', x, z);
              if (!t) continue;
              for (const [ox, oz] of OFFSETS) {
                const px = x + ox;
                const pz = z + oz;
                const y = g.groundY(px, pz);
                const s = g.camera.toScreen(new V(px, y, pz));
                if (s.x < 4 || s.y < 4 || s.x > innerWidth - 4 || s.y > innerHeight - 4) continue;
                // hidden behind higher ground? (the ray dips under the ground before reaching the point)
                const { o, d } = g.camera.ray(s.x, s.y);
                const tEnd = (y - o.y) / d.y;
                let blocked = false;
                for (let k = 0; k < 400 && !blocked; k++) {
                  const tt = (tEnd * k) / 400;
                  if (tEnd - tt < 0.06) break;
                  if (o.y + d.y * tt < g.groundY(o.x + d.x * tt, o.z + d.z * tt) - 1e-3) blocked = true;
                }
                if (blocked) {
                  hidden++;
                  continue;
                }
                const p = g.pick(s.x, s.y);
                out.push({ want: t.id, got: p?.tile?.id ?? null });
              }
            }
          return { out, hidden };
        },
        { zoom, OFFSETS, fx, fz },
      );
      hidden += res.hidden;
      for (const r of res.out) {
        checks++;
        if (r.want !== r.got) {
          failures++;
          if (failures < 20) console.error(`  ✗ at ${fx},${fz} zoom ${zoom}: wanted ${r.want}, picked ${r.got}`);
        }
      }
    }
  if (errors.length) {
    failures++;
    console.error('  ✗ page errors:', errors.slice(0, 3));
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
// a point exactly on a tile edge can round either way: allow 0.5% of checks, as the flat picking test does
const allowed = Math.floor(checks * 0.005);
console.log(`Old City picking: ${checks} checks, ${hidden} hidden behind terraces, ${failures} wrong (allowed ${allowed})`);
if (!checks || failures > allowed) process.exit(1);
