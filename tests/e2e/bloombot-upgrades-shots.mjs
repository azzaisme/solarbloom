// #624 (E25): five new Bloombot upgrades, in a real game at 1280 × 800 and 150% interface size (the Deck). Checks and shots:
//   - the crafting table's Upgrade tab with Quick hands, Keen eye, Sun soak, Lantern and Lucky pulse for sale;
//   - Bloombot's page in the backpack: the new rows, and Lantern's next level;
//   - midnight in the park without and with Lantern level 2 (a real light of its own, spreading round it);
//   - the minimap at Keen eye level 3: the piles with something left show as gold dots, the caches as squares;
//   - a pulse at Keen eye level 3 (its ripple reaches 19 tiles), and a lucky pulse's line.
// Shots go to docs/review/e25-624/ (SHOTS_DIR overrides).
//   npm run build && GPU=1 node tests/e2e/bloombot-upgrades-shots.mjs
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.env.SHOTS_DIR ?? 'docs/review/e25-624';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4269);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

/** Sets the light clock to a fraction of the day (0.3 morning, 0.83 midnight), sunny. */
const sky = (f) =>
  page.evaluate((f) => {
    const s = window.solarbloom.sim;
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
    s.lights.dark = s.power.sky().dark;
  }, f);
const levels = (l) =>
  page.evaluate((l) => {
    const sv = window.solarbloom.sim.state.salvage;
    Object.assign(sv.research.levels, l);
  }, l);

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
    sv.research.done.push('rb-cells', 'rb-efficiency', 'rb-sprint', 'rb-pulse', 'rb-backpack', 'rb-hands', 'rb-eye', 'rb-soak', 'rb-lantern', 'rb-lucky');
    for (const [m, n] of [['gears', 20], ['scrap', 30], ['wire', 10], ['copper', 20], ['glassPane', 12], ['sunstone', 12], ['seeds', 40], ['batteryCell', 2]]) g.sim.inventory.addToStore(m, n);
    const [fx, fz] = g.sim.areas.info('park').landmark;
    g.bot.teleport('g', fx - 2.5, fz + 4.5);
  });
  await sky(0.3);
  await levels({ quickHands: 1, keenEye: 2 });
  await page.waitForTimeout(1500);

  // ── 1. the crafting table's Upgrade tab ──
  await page.evaluate(() => {
    window.solarbloom.hud.craft.open();
    window.solarbloom.hud.craft.show('upgrade');
  });
  await page.waitForTimeout(600);
  const table = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#craftScreen *')].find((e) => e.children.length < 4 && /Quick hands/.test(e.textContent ?? ''));
    el?.scrollIntoView({ block: 'start' });
    return document.querySelector('#craftScreen')?.innerText.replace(/\s+/g, ' ') ?? '';
  });
  for (const n of ['Quick hands', 'Keen eye', 'Sun soak', 'Lantern', 'Lucky pulse']) check(table.includes(n), `the Upgrade tab offers ${n}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/1-table-new-upgrades.png` });
  await page.evaluate(() => window.solarbloom.hud.craft.close());
  await page.waitForTimeout(400);

  // ── 2. Bloombot's page ──
  await page.evaluate(() => {
    window.solarbloom.hud.toggleBackpack(true);
    window.solarbloom.hud.backpack.show('bloombot', true);
  });
  await page.waitForTimeout(600);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#bpScreen .bb-row')].map((r) => `${r.querySelector('.bb-name')?.textContent} · ${r.querySelector('.bb-state')?.textContent}`));
  check(rows.some((r) => /Quick hands · Level 1 of 3/.test(r)) && rows.some((r) => /Keen eye · Level 2 of 3/.test(r)) && rows.some((r) => /Lantern · .*(of 2|Ready|level)/i.test(r)), `the new rows show with their levels (${rows.join(' | ')})`);
  await page.evaluate(() => {
    const r = [...document.querySelectorAll('#bpScreen .bb-row')].find((x) => /Lantern/.test(x.textContent));
    r?.scrollIntoView({ block: 'center' });
    r?.click();
  });
  await page.waitForTimeout(400);
  const detail = await page.evaluate(() => document.querySelector('#bpScreen .bb-detail')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  check(/own light at night/.test(detail) && /make level 1/.test(detail), `Lantern says what it does and what level 1 takes ("${detail}")`);
  await page.screenshot({ path: `${out}/2-page-lantern.png` });
  // Quick hands with Nimble hands (the park's third milestone) grown: Quick hands shows its prying time only
  await levels({ quickHands: 2 });
  await page.evaluate(() => {
    window.solarbloom.sim.state.progression.parkGrowth = 3;
    window.solarbloom.hud.backpack.show('bloombot', true);
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const r = [...document.querySelectorAll('#bpScreen .bb-row')].find((x) => /Quick hands/.test(x.textContent));
    r?.scrollIntoView({ block: 'center' });
    r?.click();
  });
  await page.waitForTimeout(400);
  const now = await page.evaluate(() => document.querySelector('#bpScreen .bb-detail .bb-now')?.textContent ?? '');
  check(now === 'Right now prying rubble open takes 1.2 seconds.', `Quick hands shows how long prying takes at level 2 ("${now}")`);
  await page.evaluate(() => {
    for (const e of document.querySelectorAll('#bpScreen .bb-detail, #bpScreen .bb-detail *')) e.scrollTop = 0;
    let e = document.querySelector('#bpScreen .bb-detail');
    while (e) {
      if (e.scrollHeight > e.clientHeight && getComputedStyle(e).overflowY !== 'visible') e.scrollTop = 0;
      e = e.parentElement;
    }
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/2b-page-quick-hands.png` });
  await page.evaluate(() => window.solarbloom.hud.toggleBackpack(false));
  await page.waitForTimeout(400);

  // ── 3. midnight, without and with Lantern ──
  await page.evaluate(() => {
    const g = window.solarbloom;
    const [fx, fz] = g.sim.areas.info('park').landmark;
    g.bot.teleport('g', fx + 7.5, fz + 7.5);
    g.bot.pose.facing = Math.PI * 0.25;
    g.camera.turnTo(45 + 180, true);
  });
  await sky(0.83);
  await levels({ lantern: 0 });
  await page.waitForTimeout(2500);
  const none = await page.evaluate(() => window.solarbloom.bot.visuals.lanternLight ?? null);
  check(none === null, 'no light of its own before Lantern');
  await page.screenshot({ path: `${out}/3-night-no-lantern.png` });
  await levels({ lantern: 2 });
  await page.waitForTimeout(800);
  const lit = await page.evaluate(() => window.solarbloom.bot.visuals.lanternLight ?? null);
  check(!!lit && lit.range === 7 && lit.intensity > 0.4, `Lantern level 2: a light reaching 7 tiles at night (${JSON.stringify(lit)})`);
  await page.screenshot({ path: `${out}/4-night-lantern-2.png` });
  await sky(0.3);
  await page.waitForTimeout(800);
  const day = await page.evaluate(() => window.solarbloom.bot.visuals.lanternLight ?? null);
  check(day === null, 'by day the lantern is off');

  // ── 4. Keen eye level 3: piles and caches on the minimap ──
  await levels({ keenEye: 3 });
  await page.waitForTimeout(1600); // the map repaints on a timer
  const mm = await page.locator('#minimap').boundingBox();
  await page.screenshot({ path: `${out}/5-minimap-keen-eye.png`, clip: { x: mm.x - 10, y: mm.y - 10, width: mm.width + 20, height: mm.height + 20 } });
  await levels({ keenEye: 2 });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/5b-minimap-before.png`, clip: { x: mm.x - 10, y: mm.y - 10, width: mm.width + 20, height: mm.height + 20 } });
  await levels({ keenEye: 3 });

  // ── 5. a pulse at Keen eye 3, lucky ──
  await levels({ luckyPulse: 1 });
  const pulsed = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const b = g.bot.pose;
    const t = s.areas.tiles('park').filter((t) => t.ground !== 'restored' && s.restoration.checkPulse(t).ok).sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
    const next = s.rng.next.bind(s.rng);
    let n = 0;
    s.rng.next = () => (n++ < 3 ? [0, 0.1, 0.9][n - 1] : next()); // this one pulse is lucky: 3 Seeds
    s.charge.refillForTest();
    s.pulseLoad.introduced(); // the load wheel's one-time introduction is for another shot
    const before = s.inventory.count('seeds');
    const ok = s.restoration.pulse(t.id);
    s.rng.next = next;
    return { ok, got: s.inventory.count('seeds') - before, radius: s.upgrades.rippleRadius };
  });
  check(pulsed.ok && pulsed.got === 3 && pulsed.radius === 19, `a lucky pulse found 3 Seeds, its ripple reaching 19 tiles (${JSON.stringify(pulsed)})`);
  await page.waitForTimeout(500);
  const toasts = await page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((e) => e.textContent).join(' | '));
  check(/Lucky! The pulse dug up 3 Seeds/.test(toasts), `its line says so ("${toasts}")`);
  await page.screenshot({ path: `${out}/6-lucky-pulse.png` });
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
