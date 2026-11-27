// #785 follow-up: close-up shots of the fruit tree model (ripe in summer, in flower in spring, overgrown, autumn) for a
// quick look after a model change. `vite build` first; SHOTS_DIR (default docs/review/785-look).
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame, QUIET_CSS } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/785-look';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4262);
const TIMEOUT = Number(process.env.E2E_TIMEOUT) || 240_000;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
  page.setDefaultTimeout(TIMEOUT);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const game = (fn, arg) => page.evaluate(({ src, arg }) => new Function('g', 's', 'arg', `return (${src})(g, s, arg)`)(window.solarbloom, window.solarbloom.sim, arg), { src: fn.toString(), arg });
  await startGame(page, `http://localhost:${PORT}`, { settings: { hints: false } });
  await page.addStyleTag({ content: `${QUIET_CSS} #loadWheel { display: none !important; }` });
  await wait(3000);
  // three trees side by side near Bloombot, on green ground
  const trees = await game((g, s) => {
    s.state.salvage.keepers.moss ??= { step: 'request1' };
    const bx = Math.floor(g.bot.pose.x), bz = Math.floor(g.bot.pose.z);
    for (let r = 2; r < 40; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const x0 = bx + dx, z0 = bz + dz;
          const cells = [];
          for (let i = -1; i < 6; i++) for (const z of [z0 - 1, z0, z0 + 1, z0 + 2]) cells.push([x0 + i, z]);
          if (!cells.every(([x, z]) => { const t = s.grid.get('g', x, z); return t && !t.blocked && !t.occupantId && t.feature !== 'water' && !s.salvage.pileAt(x, z); })) continue;
          for (const [x, z] of cells) s.restoration.complete(s.grid.get('g', x, z), 'pulse');
          const out = [];
          for (const i of [0, 2, 4]) {
            for (const [k, v] of Object.entries(s.build.recipe('orchard') ?? {})) s.inventory.add(k, v);
            const m = s.build.place('orchard', 'g', x0 + i, z0);
            if (!m) break;
            out.push({ id: m.id, x: m.x, z: m.z });
          }
          if (out.length === 3) return out;
        }
    return null;
  });
  if (!trees) throw new Error('no room for the trees');
  const shot = async (name, season, states) => {
    await game((g, s, { season, states, trees }) => {
      s.seasons.jumpTo(season);
      trees.forEach((t, i) => {
        s.state.salvage.extras[t.id] = states[i];
        g.crops.refresh(t.id);
      });
      const t = trees[1];
      g.bot.teleport('g', t.x + 0.5, t.z + 2.2);
      Object.assign(g.bot.pose, { roofId: 'g', x: t.x + 0.5, z: t.z + 2.2, facing: Math.PI });
      g.bot.walk = undefined;
      g.camera.turnTo(-20, true);
      g.zoomStep = 0;
    }, { season, states, trees });
    await wait(3500);
    await page.screenshot({ path: `${dir}/${name}.png`, timeout: TIMEOUT });
    // and a close crop of the middle tree's crown (at twice the pixels), to see the flowers and fruit themselves
    await page.screenshot({ path: `${dir}/${name}-close.png`, clip: { x: 400, y: 280, width: 300, height: 190 }, timeout: TIMEOUT });
    console.log(`  📷 ${dir}/${name}.png (+ close)`);
  };
  const ripe = { age: 3, sincePrune: 1, crops: 2, ready: 1 };
  const bare = { age: 3, sincePrune: 1, crops: 2 };
  const shaggy = { age: 8, sincePrune: 6, crops: 5, ready: 1, overgrownCrop: true };
  await shot('summer-bare-ripe-overgrown', 'summer', [bare, ripe, shaggy]);
  await shot('spring-in-flower', 'spring', [bare, bare, shaggy]);
  await shot('autumn-ripe', 'autumn', [ripe, ripe, shaggy]);
  // a macro shot of a tree in flower: the camera let go of Bloombot and pulled right in to the crown
  await game((g, s, { trees }) => {
    s.seasons.jumpTo('spring');
    const t = trees[1];
    s.state.salvage.extras[t.id] = { age: 3, sincePrune: 1, crops: 2 };
    g.crops.refresh(t.id);
    g.bot.following = false;
    g.camera.maxZoom = 14;
    g.camera.setZoom(14);
  }, { trees });
  await wait(3500);
  await page.screenshot({ path: `${dir}/spring-flowers-macro.png`, timeout: TIMEOUT });
  console.log(`  📷 ${dir}/spring-flowers-macro.png`);
  if (errors.length) throw new Error(errors.join(' | '));
  console.log('done');
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);
