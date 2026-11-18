// A district bloom from the area panel: before/after screenshots, once-only, skippable, replay changes nothing (City 10.7).
import { createRequire } from 'node:module';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await preview({ preview: { port: 4191, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const SHOTS = process.env.SHOTS; // folder for review screenshots
let ok = true;
const fail = (m) => { ok = false; console.error('  ✗', m); };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:4191/?rules=classic');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  if (await page.locator('#introGo').isVisible()) await page.click('#introGo');
  const info = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.state.progression.coreActivated = true;
    s.areas.clear('park', true);
    const d = s.districts.districtOf('park');
    const members = new Set(s.districts.members(d));
    const done = ['park'];
    while (done.length < 5) {
      const next = done.flatMap((a) => s.areas.info(a).neighbours).find((a) => members.has(a) && !done.includes(a));
      if (!next) break;
      s.areas.clear(next, true);
      done.push(next);
    }
    // Half-restored ground in the awake areas, so the bloom has something to change.
    for (const a of done) s.areas.tiles(a).forEach((t, i) => {
      if (t.blocked || t.occupantId || i % 3) return;
      t.ground = 'restored'; t.bloom = 1; t.pollution = 0; s.grid.touch(t);
    });
    const [x, z] = s.areas.info(done[1]).landmark;
    g.camera.glide(x + 1, 0, z + 1, 0.45);
    for (let i = 0; i < 200; i++) g.camera.update(0.05);
    return { d, area: done[1], machines: JSON.stringify(s.state.machines) };
  });
  await page.waitForTimeout(2500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/district-before.png` });
  await page.evaluate((a) => window.solarbloom.openArea(a), info.area);
  await page.waitForTimeout(400);
  const btn = page.locator(`#inspect.open [data-district="${info.d}"]:not([data-replay])`);
  if (!(await btn.count())) fail('no district bloom button in the area panel');
  else {
    await btn.waitFor({ state: "visible" });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/district-panel.png` });
    await btn.click();
    await page.waitForTimeout(3500);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/district-wave.png` });
    await page.waitForTimeout(5500);
    const after = await page.evaluate(() => {
      const g = window.solarbloom;
      return { cine: document.querySelector('#cine')?.classList.contains('on') ?? false, claimed: g.sim.districts.claimed(g.sim.districts.districtOf('park')), machines: JSON.stringify(g.sim.state.machines), saved: !!localStorage.length };
    });
    if (!after.claimed) fail('district not claimed');
    else console.log('  ✓ the bloom is claimed');
    if (after.machines !== info.machines) fail('machines changed');
    else console.log('  ✓ machines untouched');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/district-after.png` });
    // Replay: the panel offers it, and it changes nothing; Skip ends it.
    const res = await page.evaluate((a) => { window.solarbloom.openArea(a); const s = window.solarbloom.sim.state; return JSON.stringify([s.districts, s.stats.tilesRestored, s.machines]); }, info.area);
    await page.waitForTimeout(300);
    const rp = page.locator(`#inspect.open [data-district="${info.d}"][data-replay="1"]`);
    if (!(await rp.count())) fail('no replay button');
    else {
      await rp.click();
      await page.waitForTimeout(1200);
      await page.click('#skipBtn');
      await page.waitForTimeout(400);
      const r2 = await page.evaluate(() => { const s = window.solarbloom.sim.state; return JSON.stringify([s.districts, s.stats.tilesRestored, s.machines]); });
      if (r2 !== res) fail('replay changed the game');
      else console.log('  ✓ replay is skippable and changes nothing');
    }
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(ok ? 0 : 1);
