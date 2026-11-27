// #859 (epic #845): the Home's fireplace and reading nook, played. The house grows to the Home with the real delivery
// and Bloombot goes in by the front door; at the fire the real key sits it down on the hearth, Charge comes back at the
// fire's rate (and twice that with Gable's Easy rest), and the real key stands it up; by night the fire lights its
// corner; at the reading nook the real key opens the journal on the pages found. Screenshots go to SHOTS_DIR
// (default docs/review/859). Run after `vite build`.
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';
import { grow, keyOf, press, shot as shotIn, visit, wait, walkTo } from './lib/house.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/859';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4254);
const LONG = Number(process.env.E2E_TIMEOUT) || 240_000;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const shot = (page, file) => shotIn(page, dir, file);
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const HOME = ['fireplace', 'nook'];
/** Sets the time of day (a share of the day: 0.4 a morning). */
const timeOfDay = (page, f) =>
  page.evaluate((f) => {
    const s = window.solarbloom.sim;
    (s.state.clock ??= { offset: 0 }).offset += (((f - s.clock.dayFraction() + 1) % 1) * 2880);
  }, f);
/** Charge a second by the fire, over `secs` of game time (from near empty). */
const rate = async (page, secs) => {
  const a = await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.state.charge.value = 5;
    return { v: s.charge.value(), t: s.time };
  });
  await page.waitForFunction(([t0, secs]) => window.solarbloom.sim.time >= t0 + secs, [a.t, secs], { timeout: LONG, polling: 250 });
  const b = await page.evaluate(() => ({ v: window.solarbloom.sim.charge.value(), t: window.solarbloom.sim.time, from: window.solarbloom.sim.charge.chargingFrom }));
  return { perSecond: (b.v - a.v) / (b.t - a.t), from: b.from };
};

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(LONG);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, `http://localhost:${PORT}`, { query: 'gfx=low', settings: { hints: false, noVistas: true } });
  await wait(2000);
  await page.evaluate(() => {
    const sv = window.solarbloom.sim.state.salvage;
    sv.tier = Math.max(1, sv.tier);
    for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone']) sv.store[m] = 999;
    // two journal pages found, for the nook
    sv.pages = ['p-park-1', 'p-park-2'];
  });
  await timeOfDay(page, 0.4);
  await wait(1500);

  // the House has neither; the Home brings both, in its main room
  await grow(page, 3);
  check(await page.evaluate((ids) => !window.solarbloom.sim.house.furniture().some((f) => ids.includes(f.id)), HOME), 'the House has no fireplace or reading nook');
  await grow(page, 4);
  const pieces = await page.evaluate((ids) => window.solarbloom.sim.house.furniture().filter((f) => ids.includes(f.id)).map((f) => `${f.id}@${f.x},${f.z}:${window.solarbloom.sim.house.roomAt(f.x, f.z)?.id}`), HOME);
  check(pieces.length === 2 && pieces.every((p) => p.endsWith(':main')), `the Home brings the fireplace and the reading nook, in the main room (${pieces.join(' ')})`);
  await shot(page, '4-home-from-door.png');

  // the fire: its prompt; the real key sits Bloombot on the hearth
  const fire = await visit(page, 'fireplace');
  check(fire.ok && /Sit by the fire/.test(fire.text), `walks to the fire: "${fire.text}"`);
  await press(page, await keyOf(page, 'interact'));
  await page.waitForFunction(() => window.solarbloom.sim.rest.sitting?.kind === 'fire', null, { timeout: 60_000, polling: 250 }).catch(() => {});
  const sat = await page.evaluate(() => ({ kind: window.solarbloom.sim.rest.sitting?.kind, x: window.solarbloom.bot.pose.x, z: window.solarbloom.bot.pose.z, f: window.solarbloom.sim.house.furniture().find((p) => p.id === 'fireplace') }));
  check(sat.kind === 'fire' && Math.floor(sat.x) === sat.f.x + sat.f.w && sat.z >= sat.f.z && sat.z < sat.f.z + sat.f.d, `the real key sits Bloombot on the hearth (${sat.kind} at ${sat.x.toFixed(2)},${sat.z.toFixed(2)})`);
  await wait(3000);
  const plain = await rate(page, 4);
  check(Math.abs(plain.perSecond - 3) < 0.35 && plain.from === 'fire', `Charge comes back at 3 a second by the fire (${plain.perSecond.toFixed(2)}/s, from ${plain.from})`);
  await shot(page, '4-by-the-fire.png');
  const sitting = await page.evaluate(() => document.getElementById('prompt')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
  check(/Stand up/.test(sitting), `sitting, the prompt says: "${sitting}"`);
  // Gable's Easy rest doubles it
  await page.evaluate(() => (window.solarbloom.sim.state.salvage.keepers.gable = { step: 'request1' }));
  const gable = await rate(page, 3);
  check(Math.abs(gable.perSecond - 6) < 0.6, `with Gable's Easy rest, twice that (${gable.perSecond.toFixed(2)}/s)`);
  await page.evaluate(() => delete window.solarbloom.sim.state.salvage.keepers.gable);
  await press(page, await keyOf(page, 'interact'));
  await page.waitForFunction(() => !window.solarbloom.sim.rest.sitting, null, { timeout: 30_000, polling: 250 }).catch(() => {});
  check(await page.evaluate(() => !window.solarbloom.sim.rest.sitting), 'the real key stands Bloombot up again');

  // by day the fire burns softly; by night it is the warmest light in its corner
  const day = await page.evaluate(() => window.solarbloom.houseInside.fireLight());
  await timeOfDay(page, 0.9);
  await wait(4000);
  const night = await page.evaluate(() => ({ ...window.solarbloom.houseInside.fireLight(), isNight: window.solarbloom.sim.clock.isNight(), base: window.solarbloom.houseInside.fireIntensity() }));
  const f = sat.f;
  check(!!day && night.on && night.isNight && night.base > day.intensity * 1.5 && Math.abs(night.x - (f.x + 0.63)) < 0.2 && night.z > f.z && night.z < f.z + f.d && night.range >= 4, `the fire lights its corner at night (light at ${night.x?.toFixed(2)},${night.z?.toFixed(2)}, reach ${night.range}, by day ${day?.intensity.toFixed(2)}, by night ${night.base.toFixed(2)})`);
  await walkTo(page, f.x + 3, f.z + 1, f.x, f.z + 1);
  await shot(page, '4-fire-night.png');
  // and sitting by it at night
  await visit(page, 'fireplace');
  await press(page, await keyOf(page, 'interact'));
  await page.waitForFunction(() => window.solarbloom.sim.rest.sitting?.kind === 'fire', null, { timeout: 60_000, polling: 250 }).catch(() => {});
  await wait(3500);
  await shot(page, '4-by-the-fire-night.png');
  // the flames: one tongue each, flickering out of step (heights now and a moment later)
  const f1 = await page.evaluate(() => window.solarbloom.houseInside.flames());
  await wait(400);
  const f2 = await page.evaluate(() => window.solarbloom.houseInside.flames());
  check(f1.length === 5 && f1.some((h, i) => Math.abs(h - f2[i]) > 0.005) && new Set(f1.map((h) => h.toFixed(3))).size > 3, `the flames flicker, each tongue its own height (${f1.map((h) => h.toFixed(2)).join(', ')} → ${f2.map((h) => h.toFixed(2)).join(', ')})`);
  // a close look from the follow camera, Bloombot sitting by the fire
  await page.evaluate(() => window.solarbloom.camera.zoomTo(window.solarbloom.camera.maxZoom));
  await wait(3000);
  await shot(page, '4-fire-night-close.png');
  await press(page, await keyOf(page, 'interact'));
  await page.waitForFunction(() => !window.solarbloom.sim.rest.sitting, null, { timeout: 30_000, polling: 250 }).catch(() => {});
  await timeOfDay(page, 0.4);
  await wait(3000);

  // the reading nook: its prompt; the real key opens the journal on the pages found
  const nook = await visit(page, 'nook');
  check(nook.ok && /Read in the reading nook/.test(nook.text), `walks to the reading nook: "${nook.text}"`);
  await shot(page, '4-nook.png');
  await press(page, await keyOf(page, 'interact'));
  await page.waitForSelector('#bpScreen.open', { timeout: 30_000 }).catch(() => {});
  const journal = await page.evaluate(() => (document.querySelector('#bpScreen.open') ? document.querySelector('#bpScreen').innerText.replace(/\s+/g, ' ') : ''));
  const titles = await page.evaluate(() => [...document.querySelectorAll('.bp-page:not(.unseen)')].map((b) => b.textContent));
  check(/2 of \d+ pages found/.test(journal) && titles.length === 2 && /Page 1:/.test(journal), `the nook opens the journal on the pages found (${titles.join(' | ')})`);
  await shot(page, '4-nook-journal.png');
  await page.keyboard.press('Escape');
  await wait(800);
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  console.error(e);
  failures.push(String(e));
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
