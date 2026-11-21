// #623 (E25): levels 4 and 5 of the Bloombot upgrades, in a real game at 1280 × 800 and 150% interface size (the
// Deck). Checks and shots:
//   - the crafting table's Upgrade tab with levels 4 and 5 for sale, priced in late materials;
//   - Bloombot's page in the backpack: "Level 4 of 5", a level 5 at the top, and what the next level takes;
//   - Bloombot from behind and the front at full growth: five glowing cells and five pockets.
// Shots go to docs/review/e25-623/ (SHOTS_DIR overrides).
//   npm run build && GPU=1 node tests/e2e/bloombot-levels-shots.mjs
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.env.SHOTS_DIR ?? 'docs/review/e25-623';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4268);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

/** A close look at Bloombot from behind or in front (photo mode, its bar hidden). */
async function closeUp(page, side) {
  await page.evaluate((side) => {
    const g = window.solarbloom;
    if (!g.photo.active) g.photo.enter();
    if (!g.photo.clean) g.photo.action('backpack');
    g.bot.pose.facing = 0;
    g.camera.jumpZoom(g.camera.maxZoom);
    g.camera.turnTo(side === 'back' ? 180 + 30 : 0 + 25, true);
    g.camIdle = 0;
  }, side);
  await page.waitForTimeout(900);
}

/** A close crop around Bloombot. */
async function botShot(page, path) {
  const c = await page.evaluate(() => {
    const g = window.solarbloom;
    const p = g.bot.visuals.root.getPosition().clone();
    p.y += 0.45;
    return g.camera.toScreen(p);
  });
  const vw = page.viewportSize();
  const x = Math.max(0, Math.min(vw.width - 480, c.x - 240));
  const y = Math.max(0, Math.min(vw.height - 480, c.y - 240));
  await page.screenshot({ path, clip: { x, y, width: 480, height: 480 }, scale: 'css' });
}

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`http://localhost:${port}/?slot=1&new=1&gfx=deck`);
  await page.waitForFunction(() => window.solarbloom?.bot?.visuals?.loaded && document.querySelector('#loading')?.classList.contains('gone'));
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.pause.clear('blur');
    g.hud.setUiScale(150);
    const sv = g.sim.state.salvage;
    sv.tier = Math.max(sv.tier, 1);
    sv.keepers.pylon = { step: 'request1' }; // the table researches once a Keeper is awake
    sv.research ??= { analysed: [], done: [], running: [], levels: {} };
    sv.research.done.push('rb-cells', 'rb-efficiency', 'rb-sprint', 'rb-pulse', 'rb-backpack');
    // a late game: two at the top, two on level 4, one on level 3; enough late things to buy the next levels
    Object.assign(sv.research.levels, { chargeCells: 5, backpack: 5, sprint: 4, chargeEfficiency: 4, pulseRadius: 3 });
    for (const [m, n] of [['sunCell', 12], ['sunstone', 30], ['motor', 8]]) g.sim.inventory.addToStore(m, n);
    const [fx, fz] = g.sim.areas.info('park').landmark;
    g.bot.teleport('g', fx - 2.5, fz + 4.5);
  });
  await page.waitForTimeout(1500);

  // ── 1. the crafting table's Upgrade tab ──
  await page.evaluate(() => {
    window.solarbloom.hud.craft.open();
    window.solarbloom.hud.craft.show('upgrade');
  });
  await page.waitForTimeout(600);
  const table = await page.evaluate(() => document.querySelector('#craftScreen')?.innerText.replace(/\s+/g, ' ') ?? '');
  check(/Wider pulse/.test(table) && /Sun cell/.test(table), `the Upgrade tab offers Wider pulse level 4 in Sun cells ("${table.slice(0, 400)}…")`);
  await page.screenshot({ path: `${out}/1-table-upgrades.png` });
  await page.evaluate(() => window.solarbloom.hud.craft.close());
  await page.waitForTimeout(400);

  // ── 2. Bloombot's page ──
  await page.evaluate(() => {
    window.solarbloom.hud.toggleBackpack(true);
    window.solarbloom.hud.backpack.show('bloombot', true);
  });
  await page.waitForTimeout(600);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#bpScreen .bb-row')].map((r) => `${r.querySelector('.bb-name')?.textContent} · ${r.querySelector('.bb-state')?.textContent}`));
  const ups = rows.slice(4);
  check(ups.length === 5 && ups.every((r) => / of 5$| · Top level$/.test(r)), `every upgrade counts to five (${ups.join(' | ')})`);
  check(ups.some((r) => /Bigger charge · Level 5 of 5|Bigger charge · Top level/.test(r)) && ups.some((r) => /Longer stride · Level 4 of 5/.test(r)), `levels 4 and 5 show on the page (${ups.join(' | ')})`);
  // Wider pulse, on level 3: its detail says what level 4 takes
  await page.evaluate(() => [...document.querySelectorAll('#bpScreen .bb-row')].find((r) => /Wider pulse/.test(r.textContent))?.click());
  await page.waitForTimeout(400);
  const detail = await page.evaluate(() => document.querySelector('#bpScreen .bb-detail')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  check(/make level 4/.test(detail) && /Sun cell/.test(detail) && /Sunstone/.test(detail), `Wider pulse's next level asks for late things ("${detail}")`);
  await page.screenshot({ path: `${out}/2-page-wider-pulse.png` });
  await page.evaluate(() => window.solarbloom.hud.toggleBackpack(false));
  await page.waitForTimeout(400);

  // ── 3. Bloombot at full growth: five cells, five pockets ──
  await page.waitForFunction(() => window.solarbloom.bot.visuals.growthPieces.filter((p) => p.name.startsWith('grow-cell')).length === 5, null, { timeout: 10000 }).catch(() => {});
  const pieces = await page.evaluate(() => window.solarbloom.bot.visuals.growthPieces.map((p) => p.name));
  check(pieces.filter((n) => n.startsWith('grow-cell')).length === 5 && pieces.filter((n) => n.startsWith('grow-pocket')).length === 5, `it wears five cells and five pockets (${pieces.join(', ')})`);
  await closeUp(page, 'back');
  await botShot(page, `${out}/3-bloombot-full-back.png`);
  await closeUp(page, 'front');
  await botShot(page, `${out}/4-bloombot-full-front.png`);
  await page.evaluate(() => window.solarbloom.photo.exit());
  check(!errors.length, `no page errors ${errors.join(' | ')}`);
} catch (e) {
  failed++;
  console.log('✗', e);
  await page.screenshot({ path: `${out}/x-error.png` }).catch(() => {});
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failed ? `${failed} failed` : 'all good');
process.exit(failed ? 1 : 0);
