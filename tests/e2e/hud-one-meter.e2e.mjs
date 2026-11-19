// E23.1.4 (#368): charge is the only meter on screen (epic rule 4). Plays a fresh game in a real browser, then a busy
// one (every tier open, a full backpack, machines built, drones out, a bloom chain, a Lucky Cat found), with "Show
// numbers" off and on, at phone and desktop size, and fails if anything else on screen reads like a resource meter:
//   - any visible meter, progress bar or `[data-res]` row other than the charge;
//   - any energy / water / biomass amount or rate in the HUD's text (a number beside ⚡ 💧 🌿 or those words, "/s",
//     "per second");
//   - the old resource bars or harvest button anywhere in the page.
// Screenshots go to docs/review/one-meter-*.png. Run after `vite build`.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4243, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

/** Everything on screen that could be a resource meter (runs in the page). */
function scan() {
  const shown = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (e.hidden || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const charge = document.querySelector('#chargeRow');
  const inCharge = (el) => !!charge && (el === charge || charge.contains(el));
  const meters = [...document.querySelectorAll('meter, progress, [role="meter"], [role="progressbar"], [data-res]')]
    .filter(shown)
    .filter((el) => !inCharge(el))
    .map((el) => el.id || el.className || el.tagName);
  const rows = [...document.querySelectorAll('#res > *')].filter(shown).map((el) => el.id || el.className);
  const old = ['#bars', '.bar-energy', '.bar-water', '#harvestBtn', '[data-res="energy"]', '[data-res="water"]', '[data-res="biomass"]'].filter((s) => document.querySelector(s));
  // The HUD's own text (menus the player opens on purpose, like the backpack, list items, not meters)
  const hudText = [...document.querySelectorAll('#hud > *, #res, #obj, #hotbar, #hint, #toasts, #combo, #chips, #feed, #quick, #inspect')]
    .filter(shown)
    .map((el) => el.innerText)
    .join('\n');
  const RATE = /(\d[\d.,]*\s*[kKmM]?\s*(⚡|💧|🌿))|((⚡|💧|🌿)\s*[+\-×]?\d)|\b(energy|water|biomass)\s*[:+\-×]?\s*\d|\d+(\.\d+)?\s*\/\s*s\b|per second|\/min\b/gi;
  const bad = [...new Set(hudText.match(RATE) ?? [])];
  return { meters, rows, old, bad, chargeShown: !!charge && shown(charge) };
}

async function busy(page) {
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const sv = s.state.salvage;
    sv.tier = Math.max(sv.tier, 4);
    for (const m of Object.keys(sv.pack).concat(['scrap', 'seeds', 'copper', 'timber', 'glass', 'clay', 'gears', 'sunstone', 'biomass', 'food'])) sv.pack[m] = 40;
    // restore a patch by the fountain and build on it, so the grid, drones and condensers run
    const b = s.state.bot;
    const near = s.grid.tilesOf('ground').filter((t) => !t.blocked && !t.occupantId && Math.hypot(t.x - b.x, t.z - b.z) < 9);
    for (const t of near) {
      t.ground = 'restored';
      t.bloom = Math.max(1, t.bloom);
      t.pollution = 0;
      s.grid.touch(t);
    }
    const place = (type) => {
      for (const t of near) if (!t.occupantId && s.build.place(type, t.roofId, t.x, t.z)) return true;
      return false;
    };
    for (const type of ['solar', 'solar', 'battery', 'condenser', 'droneHub', 'relay', 'pollinator']) place(type);
    s.advance(20);
    // a bloom chain and a Lucky Cat
    const dead = s.grid.tilesOf('ground').find((t) => !t.blocked && !t.occupantId && t.ground !== 'restored' && Math.hypot(t.x - b.x, t.z - b.z) < 14);
    if (dead) s.restoration.complete(dead, 'pulse');
    s.state.cat.found = Math.max(1, s.state.cat.found);
    s.state.cat.active = undefined;
    if (s.cat.spawn()) s.cat.claim();
  });
  await page.waitForTimeout(2500);
}

try {
  for (const [name, w, h] of [['desktop', 1280, 800], ['phone', 390, 844]]) {
    for (const numbers of [false, true]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.addInitScript((numbers) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.clear();
        if (numbers) localStorage.setItem('solarbloom.settings', JSON.stringify({ showNumbers: true }));
      }, numbers);
      await page.goto('http://localhost:4243/?slot=1', { timeout: 180_000, waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 180_000 });
      if (await page.locator('#introGo').isVisible().catch(() => false)) await page.click('#introGo');
      await page.waitForTimeout(1500);
      const tag = `${name}${numbers ? ' (numbers on)' : ''}`;
      for (const phase of ['fresh', 'busy']) {
        if (phase === 'busy') await busy(page);
        const r = await page.evaluate(scan);
        check(r.chargeShown, `${tag} ${phase}: the charge meter is on screen`);
        check(r.meters.length === 0, `${tag} ${phase}: no other meter (${r.meters.join(', ')})`);
        check(r.rows.every((x) => x === 'chargeRow'), `${tag} ${phase}: the resource strip holds only the charge (${r.rows.join(', ')})`);
        check(r.old.length === 0, `${tag} ${phase}: no old bars or harvest button (${r.old.join(', ')})`);
        check(r.bad.length === 0, `${tag} ${phase}: no resource amounts or rates in the HUD (${r.bad.join(' | ')})`);
        await page.screenshot({ path: `${dir}/one-meter-${name}${numbers ? '-numbers' : ''}-${phase}.png` });
      }
      check(errors.length === 0, `${tag}: no errors (${errors.join(' / ')})`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
if (failures.length) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('one meter: all checks passed');
