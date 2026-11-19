// E23.12.2 (#529): the rewards only a Lucky Cat gives, in the game. A cat found leaves a cat-only decoration (the
// reward panel says so, and it opens in decorate mode); all six placed in the park, near and far; the build tray's
// Decorate row with them; the crafting table listing them as made; and "Ripe all around" (planters growing near
// bloombot, then a cat found and every one of them ripe). Screenshots into docs/review/e23-12-2/.
//
//   npm run build && node tests/e2e/cat-rewards-shots.mjs      (serves the build)
//   BASE=http://localhost:5181 node tests/e2e/cat-rewards-shots.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/e23-12-2';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4391);
const server = process.env.BASE ? undefined : await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const base = process.env.BASE ?? `http://localhost:${port}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${what}`);
  if (!ok) failed++;
};
const shot = async (file) => {
  await page.screenshot({ path: `${out}/${file}` });
  console.log('shot', file);
};

await page.addInitScript(() => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.clear();
});
// a new garden straight in (?slot= skips the title)
await page.goto(`${base}/?slot=1`, { timeout: 180000, waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 180000 });
if (await page.locator('#introGo').isVisible().catch(() => false)) await page.click('#introGo');
await page.waitForTimeout(1500);

// The camera follows bloombot (third person): a shot stands bloombot in the middle of what it shows.
await page.evaluate(() => {
  window.aim = (x, z, zoom) => {
    const g = window.solarbloom;
    g.bot.teleport('g', x, z);
    g.camera.recentre();
    g.camera.zoomTo(zoom);
    for (let i = 0; i < 200; i++) g.camera.update(0.05);
    g.hud.hideTip();
  };
});

// The park grown, and a cat hiding a short walk from bloombot; bloombot walks up and finds it.
const found = await page.evaluate(() => {
  const g = window.solarbloom;
  const s = g.sim;
  for (const t of s.areas.tiles('park')) {
    if (t.blocked || t.occupantId || t.feature === 'water') continue;
    t.ground = 'restored';
    t.pollution = 0;
    t.bloom = Math.max(1, t.bloom);
    s.grid.touch(t);
  }
  s.production?.markDirty?.();
  g.chunks.markAll();
  s.state.cat.active = undefined;
  if (!s.cat.spawn()) return { ok: false };
  const a = s.cat.anchor(s.state.cat.active.anchorId);
  g.bot.teleport(a.roofId, a.pos[0] + 1.2, a.pos[2] + 1.2);
  g.camera.glide(a.pos[0], 0, a.pos[2], 1.4);
  for (let i = 0; i < 120; i++) g.camera.update(0.05);
  return { ok: true, anchor: a.id };
});
check(found.ok, 'a cat hides in the park');
await page.waitForTimeout(2500);
const first = await page.evaluate(() => {
  const g = window.solarbloom;
  const r = g.sim.cat.claim();
  return { type: r?.type, summary: r?.summary, made: g.sim.crafting.decorMade('catstatue') };
});
check(first.type === 'luckyHarvest' && /Lucky Cat statue to place in your gardens/.test(first.summary ?? ''), `the first cat: a Lucky Harvest and the statue (${first.summary})`);
check(first.made, 'the statue comes made');
await page.waitForTimeout(1200);
check(await page.locator('#catPanel').isVisible(), 'the reward panel shows');
check(/Lucky Cat statue/.test(await page.locator('#catPanelBody').innerText()), 'the panel names the statue');
await shot('cat-found-statue.png');
// the decoration's own note follows (checked about once a second)
await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /New decoration: Lucky Cat statue/.test(t.textContent ?? '')), null, { timeout: 15000 }).then(
  () => check(true, 'a "New decoration" note for the statue'),
  () => check(false, 'a "New decoration" note for the statue'),
);
await shot('cat-found-statue-note.png');

// More cats: each leaves the next piece, until all six are found.
const rest = await page.evaluate(() => {
  const g = window.solarbloom;
  const s = g.sim;
  const got = [];
  for (let i = 0; i < 7; i++) {
    s.state.cat.active = undefined;
    // any free hiding spot (the camera sits on the park, so the usual out-of-view pick finds none here)
    const spot = s.cat.candidates()[0];
    if (!spot || !s.cat.spawn(spot.id)) break;
    const r = s.cat.claim();
    got.push(r.summary);
  }
  return { got, all: ['catstatue', 'catbench', 'pawstones', 'catfountain', 'goldlantern', 'rainbowbunting'].every((id) => s.crafting.decorMade(id)) };
});
check(rest.all, 'six cats later, all six cat-only decorations are found');
check(rest.got.length === 7 && !/to place in your gardens/.test(rest.got[6]), `a cat after all six leaves only its reward (${rest.got[6]})`);

// The six placed in a row on the park's grass, near and far.
await page.addStyleTag({ content: '#toasts, .toast, #hint, #fail, #catPanel, #loadWheel, .load-wheel { display: none !important; }' });
const placed = await page.evaluate(() => {
  const g = window.solarbloom;
  const ids = ['catstatue', 'catbench', 'pawstones', 'catfountain', 'goldlantern', 'rainbowbunting'];
  // a tight ring round one free tile (bloombot stands in the middle: the camera follows it)
  const ok = (x, z) => !g.cozy.canDecorate('catstatue', 'g', x, z);
  let free = [];
  let centre;
  for (const t of g.sim.areas.tiles('park').sort((a, b) => Math.hypot(a.x - 9, a.z - 16) - Math.hypot(b.x - 9, b.z - 16))) {
    if (!ok(t.x, t.z)) continue;
    const ring = [[-2, -1], [0, -2], [2, -1], [-2, 1], [0, 2], [2, 1]].map(([dx, dz]) => [t.x + dx, t.z + dz]).filter(([x, z]) => ok(x, z));
    if (ring.length >= ids.length) {
      free = ring;
      centre = [t.x, t.z];
      break;
    }
  }
  window.__centre = centre;
  const why = ids.map((id, i) => free[i] && g.cozy.placeDecor(id, 0, 'g', free[i][0], free[i][1]));
  g.chunks.markAll();
  window.__gallery = free;
  return { n: why.filter((w) => w === undefined).length, why };
});
check(placed.n === 6, `all six placed free (${JSON.stringify(placed.why)})`);
const frame = async (zoom, file) => {
  await page.evaluate((zoom) => aim(window.__centre[0] + 0.5, window.__centre[1] + 0.5, zoom), zoom);
  await page.waitForTimeout(2500);
  await shot(file);
};
await frame(1.7, 'cat-decor-near.png');
await frame(0.5, 'cat-decor-far.png');

// Decorate mode lists them.
await page.evaluate(() => window.solarbloom.hud.toggleTray(true));
await page.waitForTimeout(800);
const tray = await page.evaluate(() =>
  ['catstatue', 'catbench', 'pawstones', 'catfountain', 'goldlantern', 'rainbowbunting'].filter((id) => {
    const b = document.querySelector(`#hotbar [data-tool="decor:${id}"]`);
    return b && !b.hidden;
  }),
);
check(tray.length === 6, `decorate mode shows all six (${tray.join(' ')})`);
await shot('decorate-tray.png');
await page.evaluate(() => window.solarbloom.hud.toggleTray(false));

// Ripe all around: three planters growing beside bloombot, then a cat.
const grow = await page.evaluate(() => {
  const g = window.solarbloom;
  const s = g.sim;
  s.state.salvage.keepers.tide ??= { step: 'settled' }; // the Planter box opens when Tide wakes (Saltwind Beach)
  s.water && (s.water.isWatered = () => true); // the shot is about ripening, not watering (tests/farm-planters has water)
  const beds = [];
  s.bot = { roofId: 'g', x: 8.5, z: 11.5 }; // by the fountain: the planks come from the store
  // free restored park ground, nearest the fountain first, two tiles apart
  const spots = s.areas.tiles('park').filter((t) => t.ground === 'restored' && !t.occupantId).sort((a, b) => Math.hypot(a.x - 9, a.z - 15) - Math.hypot(b.x - 9, b.z - 15));
  for (const t of spots) {
    if (beds.length >= 3) break;
    s.inventory.addToStore('planks', 3);
    if (!s.build.check('planter', 'g', t.x, t.z).ok) continue;
    const m = s.build.place('planter', 'g', t.x, t.z);
    if (!m) continue;
    s.inventory.add('seeds', 1);
    s.farm.plant(m, 'radish');
    beds.push(m.id);
  }
  // part-grown, so the beds show plants
  for (const id of beds) s.state.salvage.planters[id].grown = 0.35;
  g.chunks.markAll();
  const ms = beds.map((id) => s.machine(id));
  const cx = ms.reduce((a, m) => a + m.x + m.size / 2, 0) / ms.length;
  const cz = ms.reduce((a, m) => a + m.z + m.size / 2, 0) / ms.length;
  window.aim(cx, cz + 1.2, 1.7);
  s.bot = { roofId: 'g', x: cx, z: cz + 1.2 };
  return { beds, targets: s.cat.ripeTargets().length };
});
check(grow.beds.length === 3 && grow.targets === 3, `three planters growing near bloombot (${grow.beds.length}, ${grow.targets} to ripen)`);
await page.waitForTimeout(2500);
await shot('ripe-before.png');
await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent.includes('#catPanel') && s.remove()));
await page.addStyleTag({ content: '#toasts, .toast, #hint, #fail, #loadWheel { display: none !important; }' }); // the reward panel shows
const ripe = await page.evaluate(() => {
  const g = window.solarbloom;
  const s = g.sim;
  s.state.cat.active = undefined;
  s.cat.spawn(s.cat.candidates()[0]?.id);
  // this cat's roll lands on Ripe all around (each reward's odds are tested in tests/cat-decor)
  const roll = s.cat.rollReward;
  s.cat.rollReward = () => 'ripeAround';
  const r = s.cat.claim();
  s.cat.rollReward = roll;
  return { type: r?.type, summary: r?.summary, ripe: Object.keys(s.state.salvage.planters).map((id) => s.farm.look(s.machine(id)).ripe) };
});
check(ripe.type === 'ripeAround' && ripe.ripe.every(Boolean), `Ripe all around ripens all three (${ripe.summary})`);
await page.waitForTimeout(2500);
await shot('ripe-after.png');

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
console.log(failed ? `cat rewards: ${failed} check(s) failed` : 'cat rewards: all checks passed');
await browser.close();
server?.httpServer.close();
process.exit(failed ? 1 : 0);
