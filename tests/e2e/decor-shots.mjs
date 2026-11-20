// E19.2 (#254): every decoration near and at the far level of detail, the Build tray's Decorate row, and build
// mode (bloombot projecting the decoration in hand, and the remove tool lighting one up). Screenshots into
// docs/review/e19-decor/.
//
//   npm run shots:decor                         (builds, then serves the build)
//   BASE=http://localhost:5181 node tests/e2e/decor-shots.mjs   (against a running dev server)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/e19-decor';
mkdirSync(out, { recursive: true });
const server = process.env.BASE ? undefined : await preview({ preview: { port: 4197, strictPort: true }, logLevel: 'silent' });
const base = process.env.BASE ?? 'http://localhost:4197';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const quiet = () => page.addStyleTag({ content: '#toasts, .toast, #hint, #fail { display: none !important; }' });

await page.goto(`${base}/`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => !!window.solarbloom?.bot);
if (await page.locator('#introGo').isVisible()) await page.click('#introGo');
await quiet();

// A gallery: every decoration in two rows on restored park ground, turned to face the camera.
const ids = await page.evaluate(() => {
  const g = window.solarbloom;
  for (const t of g.sim.areas.tiles('park')) {
    if (t.blocked || t.occupantId || t.feature === 'water') continue;
    t.ground = 'restored';
    t.pollution = 0;
    t.bloom = Math.max(1, t.bloom);
    g.sim.grid.touch(t);
  }
  g.sim.production.markDirty();
  const all = ['bench', 'lantern', 'pot', 'flowerbed', 'stones', 'trough', 'birdbath', 'lamppost', 'bunting', 'cratestack', 'barrel', 'rug', 'topiary', 'catstatue'];
  g.sim.state.cozy = { ...(g.sim.state.cozy ?? {}), decorUnlocked: all.slice(4) };
  // free tiles in a band beside the fountain, in order
  const free = [];
  for (let z = 4; z <= 14 && free.length < all.length; z += 2)
    for (let x = 2; x <= 14 && free.length < all.length; x++) if (!g.cozy.canDecorate('bench', 'g', x, z)) free.push([x, z]);
  all.forEach((id, i) => free[i] && g.cozy.placeDecor(id, 0, 'g', free[i][0], free[i][1]));
  g.chunks.markAll();
  window.__gallery = free;
  return all.filter((id, i) => free[i]);
});
console.log('placed', ids.length, ids.join(' '));

const frame = async (zoom, file) => {
  await page.evaluate((zoom) => {
    const g = window.solarbloom;
    g.bot.following = false;
    const f = window.__gallery;
    const cx = f.reduce((s, p) => s + p[0], 0) / f.length + 0.5;
    const cz = f.reduce((s, p) => s + p[1], 0) / f.length + 0.5;
    g.bot.teleport('g', cx - 5, cz + 6);
    g.camera.glide(cx, 0, cz, zoom);
    for (let i = 0; i < 200; i++) g.camera.update(0.05);
    g.hud.hideTip();
  }, zoom);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${file}` });
  console.log('shot', file);
};
await frame(1.5, 'decor-near.png');
await frame(0.42, 'decor-far.png');

// The build menu on its Decorations tab (E23.11: #buildMenu).
await page.evaluate(async () => {
  const g = window.solarbloom;
  g.hud.toggleTray(true);
  for (let i = 0; i < 8 && document.querySelector('#buildMenu [role=tab][aria-selected=true]')?.textContent !== 'Decorations'; i++) g.hud.buildMenu.tab(1);
});
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/tray.png` });
await page.evaluate(() => window.solarbloom.hud.toggleTray(false));

// Build mode: bloombot holds a lamp post and projects it on the tile in front (keys/pad aim).
const hold = async (tool, file, setup) => {
  await page.evaluate(
    ([tool, setup]) => {
      const g = window.solarbloom;
      const [x, z] = window.__gallery[0];
      g.bot.teleport('g', x + 0.5, z + 1.5);
      g.bot.pose.facing = Math.PI; // facing −z, towards the gallery's first decoration
      g.bot.following = true;
      g.bot.lastInput = 'keys';
      g.pointer.inside = false;
      if (setup === 'clearFront') g.cozy.removeDecor('g', x, z), g.chunks.markAll();
      g.selectTool(tool);
      g.camera.recentre?.();
    },
    [tool, setup],
  );
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${file}` });
  console.log('shot', file);
};
await hold('remove', 'remove-mode.png');
await hold('decor:lamppost', 'build-hologram.png', 'clearFront');

await browser.close();
server?.httpServer.close();
