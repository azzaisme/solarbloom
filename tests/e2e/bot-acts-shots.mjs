// #628: review shots of Bloombot's acts, at the Steam Deck's size (1280 × 800, UI at 150%, the deck graphics), into
// docs/review/bot-acts/ (or argv[2]).
//   npx vite build && GPU=1 node tests/e2e/bot-acts-shots.mjs [outDir]
// For each act: one shot from the follow camera (behind Bloombot, as played) and a close side view, each part way
// through the act, plus a contact sheet of all of them (sheet-side.png, sheet-follow.png, made with Python's PIL
// when it is there). Fails on a page error or an act that never starts.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/bot-acts';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4215, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
const fail = (why) => {
  failed = true;
  console.error(`  ✗ ${why}`);
};
const ACTS = ['rummage', 'pry', 'gather', 'dig', 'plant', 'tend', 'harvest', 'repair', 'wake', 'greet', 'read', 'listen', 'look', 'reach'];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await startGame(page, 'http://localhost:4215', { slot: 3, query: 'gfx=deck', settings: { uiScale: 150, hints: false } });
  await page.addStyleTag({ content: 'body.photo #hud, body.photo #obj, body.photo #prompt { visibility: hidden !important; }' });
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (0.4 - s.clock.dayFraction()) * 2880;
    document.body.classList.add('photo');
  });
  /** Bloombot on the open beach path, facing `facing`, the camera at `yaw`, zoomed to `zoom` (past the usual closest for the close-ups). */
  const stand = async (facing, yaw, zoom) => {
    await page.evaluate(({ facing, yaw, zoom }) => {
      const g = window.solarbloom;
      Object.assign(g.bot.pose, { x: 8.5, z: 24.5, facing });
      g.camera.turnTo(yaw, true);
      g.camera.maxZoom = Math.max(g.camera.maxZoom, zoom);
      g.camera.zoomTo(zoom);
    }, { facing, yaw, zoom });
    await page.waitForTimeout(2200);
  };
  /** A square clip of `size` px centred on Bloombot's middle, as drawn now. */
  const around = (size) =>
    page.evaluate((size) => {
      const g = window.solarbloom;
      const p = g.bot.visuals.root.getPosition().clone();
      p.y += 0.42;
      const s = g.camera.cam.worldToScreen(p);
      // (worldToScreen gives CSS pixels: the canvas fills the window)
      const x = Math.round(Math.min(1280 - size, Math.max(0, s.x - size / 2)));
      const y = Math.round(Math.min(800 - size, Math.max(0, s.y - size / 2)));
      return { x, y, width: size, height: size };
    }, size);
  /**
   * The close-up (review only): just before each frame is drawn the camera is moved to `close` (metres from Bloombot:
   * side, up, out in front; negative out is behind it) and looks at its middle. null puts the game's camera back.
   */
  const closeUp = (close) =>
    page.evaluate((close) => {
      const g = window.solarbloom;
      if (window.__closeUp) g.app.off('prerender', window.__closeUp);
      window.__closeUp = undefined;
      if (!close) return;
      window.__closeUp = () => {
        const r = g.bot.visuals.root;
        const p = r.getPosition();
        const f = r.forward; // its front is the root's local +z, so forward (-z) points behind it
        const rt = r.right;
        const e = g.camera.cam.entity;
        e.setPosition(p.x - f.x * close[2] + rt.x * close[0], p.y + close[1], p.z - f.z * close[2] + rt.z * close[0]);
        e.lookAt(p.x, p.y + 0.42, p.z);
      };
      g.app.on('prerender', window.__closeUp);
    }, close);
  const views = [
    // the follow camera as played: behind Bloombot (its back to the camera), the crop around it
    { name: 'follow', facing: Math.PI, yaw: 360, zoom: 1.9, size: 340 },
    // close behind it and a little above
    { name: 'behind', facing: Math.PI, yaw: 360, zoom: 1.9, size: 520, close: [0.35, 1.25, -2.3] },
    // from its right side and a little in front
    { name: 'side', facing: Math.PI / 2, yaw: 360, zoom: 1.9, size: 520, close: [-2.1, 0.75, 0.9] },
  ];
  const clipFor = async (v) => (v.close ? { x: 640 - v.size / 2, y: 400 - v.size / 2, width: v.size, height: v.size } : await around(v.size));
  // the feet: how high the lower ankle stands above Bloombot's root, idle and part way through every act
  const idleFeet = await page.evaluate(() => window.solarbloom.bot.visuals.feetHeight());
  let lowestFeet = Infinity;
  let highestFeet = -Infinity;
  for (const v of views) {
    await stand(v.facing, v.yaw, v.zoom);
    await closeUp(v.close);
    for (const act of ACTS) {
      await page.evaluate((act) => window.solarbloom.bot.visuals.startAct(act, true), act);
      await page.waitForTimeout(450);
      const now = await page.evaluate(() => ({ acting: window.solarbloom.bot.visuals.acting, feet: window.solarbloom.bot.visuals.feetHeight() }));
      if (now.acting !== act) fail(`${act}: the act didn't start (acting: ${now.acting})`);
      lowestFeet = Math.min(lowestFeet, now.feet);
      highestFeet = Math.max(highestFeet, now.feet);
      await page.screenshot({ path: `${dir}/${v.name}-${act}.png`, clip: await clipFor(v) });
      await page.evaluate(() => window.solarbloom.bot.visuals.endAct(true));
      await page.waitForTimeout(700);
    }
    console.log(`  ✓ ${dir}/${v.name}-*.png`);
  }
  console.log(`  feet: idle ${idleFeet.toFixed(3)} above the root · during the acts ${lowestFeet.toFixed(3)} to ${highestFeet.toFixed(3)}`);
  if (highestFeet > idleFeet + 0.02) fail('an act lifted Bloombot off the ground');

  // Motion strips (and GIFs): frames through a loop and a half of the held acts and the planting, from the follow
  // camera's side of Bloombot (close behind it)
  await stand(Math.PI, 360, 1.9);
  await closeUp([0.35, 1.25, -2.3]);
  const STRIPS = ['rummage', 'pry', 'plant', 'tend'];
  for (const act of STRIPS) {
    await page.evaluate((act) => window.solarbloom.bot.visuals.startAct(act, true), act);
    await page.waitForTimeout(300);
    for (let f = 0; f < 10; f++) {
      await page.screenshot({ path: `${dir}/strip-${act}-${f}.png`, clip: { x: 640 - 230, y: 400 - 230, width: 460, height: 460 } });
      await page.waitForTimeout(90);
    }
    await page.evaluate(() => window.solarbloom.bot.visuals.endAct(true));
    await page.waitForTimeout(800);
  }
  await closeUp(null);

  // A hold for real: Salvage a pile by holding Interact. Bloombot rummages while it is held, the pile gives its
  // scrap when the ring fills, and the act finishes.
  const hold = await page.evaluate(() => {
    const g = window.solarbloom;
    for (let r = 1; r < 14; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          const x = 8 + dx;
          const z = 24 + dz;
          const pile = g.sim.salvage.pileAt(x, z);
          if (!pile) continue;
          for (const [ox, oz, facing] of [[0, 1, Math.PI], [0, -1, 0], [1, 0, -Math.PI / 2], [-1, 0, Math.PI / 2]]) {
            if (!g.bot.walker.walkable('g', x + ox, z + oz)) continue;
            Object.assign(g.bot.pose, { roofId: 'g', x: x + ox + 0.5, z: z + oz + 0.5, facing });
            g.camera.turnTo((facing * 180) / Math.PI + 180, true);
            return { pile: pile.id, material: pile.material, had: g.sim.inventory.count?.(pile.material) ?? 0 };
          }
        }
    return undefined;
  });
  if (!hold) fail('no salvage pile to hold on');
  else {
    await page.evaluate(() => window.solarbloom.camera.zoomTo(1.9));
    await page.waitForTimeout(2200);
    // count the act's effects as they fire (dust while it works, chips as it finishes)
    await page.evaluate(() => {
      const v = window.solarbloom.bot.visuals;
      const was = v.onBeat;
      window.__beats = [];
      v.onBeat = (b) => {
        window.__beats.push(b.beat);
        was?.(b);
      };
    });
    await page.keyboard.down('KeyE');
    await page.waitForTimeout(350);
    const mid = await page.evaluate(() => ({ acting: window.solarbloom.bot.visuals.acting, held: window.solarbloom.bot.visuals.actHeld }));
    await page.screenshot({ path: `${dir}/hold-salvage.png`, clip: await around(420) });
    await page.waitForTimeout(900);
    await page.keyboard.up('KeyE');
    await page.waitForTimeout(600);
    const after = await page.evaluate((m) => ({ acting: window.solarbloom.bot.visuals.acting, has: window.solarbloom.sim.inventory.count?.(m) ?? 0, beats: window.__beats }), hold.material);
    const ticks = after.beats.filter((b) => b === 'tick').length;
    const finishes = after.beats.filter((b) => b === 'finish').length;
    console.log(`  hold on ${hold.pile}: mid-hold ${mid.acting}${mid.held ? ' (held)' : ''} · after: ${after.acting ?? 'done'} · ${hold.material} ${hold.had} → ${after.has} · effects: ${ticks} while working, ${finishes} as it finished`);
    if (!ticks || finishes !== 1) fail('the hold should make dust while it works and one burst as it finishes');
    if (mid.acting !== 'rummage' || !mid.held) fail('holding Interact on a pile should rummage');
    if (after.acting) fail('the act should finish once the hold does');
    if (!(after.has > hold.had)) fail('the hold should salvage the pile');
    console.log(`  ✓ ${dir}/hold-salvage.png`);
  }

  if (errors.length) fail(`page errors:\n${errors.join('\n')}`);
} finally {
  await browser.close();
  server.httpServer.close();
}
try {
  const py = `
import sys, glob, os
from PIL import Image, ImageDraw
d, acts, strips = sys.argv[1], sys.argv[2].split(','), sys.argv[3].split(',')
for v in ('follow', 'behind', 'side'):
    ims = [Image.open(f'{d}/{v}-{a}.png') for a in acts]
    t = 220
    cols = 7
    sheet = Image.new('RGB', (cols * t, ((len(ims) + cols - 1) // cols) * (t + 22)), 'white')
    dr = ImageDraw.Draw(sheet)
    for i, (a, im) in enumerate(zip(acts, ims)):
        x, y = (i % cols) * t, (i // cols) * (t + 22)
        sheet.paste(im.convert('RGB').resize((t, t)), (x, y + 22))
        dr.text((x + 6, y + 5), a, fill='black')
    sheet.save(f'{d}/sheet-{v}.png')
for a in strips:
    files = sorted(glob.glob(f'{d}/strip-{a}-*.png'), key=lambda f: int(f.rsplit('-', 1)[1][:-4]))
    ims = [Image.open(f).convert('RGB') for f in files]
    t = 200
    strip = Image.new('RGB', (t * 5, t * 2), 'white')
    for i, im in enumerate(ims[:10]):
        strip.paste(im.resize((t, t)), ((i % 5) * t, (i // 5) * t))
    strip.save(f'{d}/strip-{a}.png')
    small = [im.resize((300, 300)) for im in ims]
    small[0].save(f'{d}/{a}.gif', save_all=True, append_images=small[1:], duration=110, loop=0)
    for f in files: os.remove(f)
`;
  execFileSync('python', ['-c', py, dir, ACTS.join(','), 'rummage,pry,plant,tend'], { stdio: 'inherit' });
  console.log(`  ✓ ${dir}/sheet-*.png, strip-*.png, *.gif`);
} catch (e) {
  console.log(`  (no contact sheets: ${e.message.split('\n')[0]})`);
}
process.exit(failed ? 1 : 0);
