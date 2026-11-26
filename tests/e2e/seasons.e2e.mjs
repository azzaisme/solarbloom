// #830: the seasons in the real game. Checks, on the built game:
//  - a new garden starts on the first day of spring, and the map's season pill says so in plain words;
//  - each season looks different (blossom in spring, summer's green, autumn's gold and red with leaves drifting down,
//    winter's bare trees, frost and light snow), with a warm toast as each new season arrives;
//  - sleeping through the last night of a season wakes Bloombot in the next one;
//  - the season saves and loads, and a garden saved before seasons existed starts a fresh spring;
//  - Cozy Mode: winter's grey days never slow the solar panels;
//  - the Low graphics setting: winter (with snow falling) costs about the same to draw as summer.
// Screenshots of every season go to SHOTS_DIR (default docs/review/830). Run after `vite build`.
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame, waitForGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/830';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4253);
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT = Number(process.env.E2E_TIMEOUT) || 240_000;

/** Greens the park with its trees fully grown, and looks at its trees. */
const greenPark = (page) =>
  page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    for (const t of s.areas.tiles('park')) {
      if (!s.restoration.isEligible(t)) continue;
      s.restoration.complete(t, 'pulse');
      t.bloom = 3 + ((t.x + t.z) % 2);
      t.treeAt = undefined; // grown, not saplings
      s.grid.touch(t);
    }
    s.state.progression.coreActivated = true;
    s.areas.clear('park', true);
    g.chunks.markAll();
    g.bot.teleport('g', 10.5, 9.5);
    g.camera.glide(12, 0, 10, 1);
  });

const seasonNow = (page) =>
  page.evaluate(() => {
    const g = window.solarbloom;
    const n = g.sim.seasons.now();
    return {
      ...n,
      day: g.sim.clock.gameDay(),
      pill: document.querySelector('#minimap .mm-season')?.innerText.trim() ?? '',
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()),
      look: g.seasonNow,
      weather: g.sim.weather.kind(),
      flakes: g.weatherVisuals.flakesShown,
    };
  });

/** Average frame time (ms) over `ms` of real time. */
const frameMs = (page, ms) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        const t0 = performance.now();
        let n = 0;
        const step = () => {
          n++;
          if (performance.now() - t0 < ms) requestAnimationFrame(step);
          else done((performance.now() - t0) / n);
        };
        requestAnimationFrame(step);
      }),
    ms,
  );

/** Moves the year to `season` (day `day`) with a fixed weather, and lets the world settle. */
async function goTo(page, season, day, weather, settle = 9000) {
  await page.evaluate(
    ([season, day, weather]) => {
      const g = window.solarbloom;
      g.sim.seasons.jumpTo(season, day);
      g.sim.weather.forceForTest(weather, 1e6);
    },
    [season, day, weather],
  );
  await wait(settle);
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, `http://localhost:${PORT}`, { settings: { hints: false } });
  await wait(3000);
  // every toast the game shows, as it appears (several can queue, so a single look could miss one)
  const watchToasts = (p) =>
    p.evaluate(() => {
      window.__toasts = [];
      new MutationObserver(() => {
        for (const t of document.querySelectorAll('.toast')) {
          const text = t.innerText.replace(/\s+/g, ' ').trim();
          if (text && !window.__toasts.includes(text)) window.__toasts.push(text);
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  /** Waits (up to 40 s of real time) for a toast matching `re`; its text, or '' */
  const toastSeen = (p, re) =>
    p.waitForFunction((src) => window.__toasts.find((t) => new RegExp(src).test(t)), re.source, { timeout: 40_000, polling: 250 }).then((h) => h.jsonValue()).catch(() => '');
  await watchToasts(page);

  // ── a new garden starts in spring ──
  let s = await seasonNow(page);
  check(s.season === 'spring' && s.year === 1, `a new garden starts in spring, year 1 (${s.season}, year ${s.year}, game day ${s.day})`);
  check(/Spring, day 1 of 3/.test(s.pill) && !/[{}]/.test(s.pill), `the map's season pill says it in plain words: "${s.pill}"`);

  await greenPark(page);
  await wait(9000);

  // ── each season: its look, its toast, its pill ──
  const seasons = [
    ['summer', 'sunny', /Summer has come/],
    ['autumn', 'wind', /Autumn is turning the leaves/],
    ['winter', 'snow', /Winter has settled in/],
    ['spring', 'rain', /Spring is here/],
  ];
  const looks = {};
  for (const [season, weather, toast] of seasons) {
    await goTo(page, season, 2, weather, 500);
    s = await seasonNow(page);
    check(s.season === season, `jumped to ${season}`);
    const seen = await toastSeen(page, toast);
    check(!!seen && !/[{}]/.test(seen), `a warm toast greets ${season}: "${seen}"`);
    await page.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.innerText)), toast.source, { timeout: 20_000 }).catch(() => {});
    await page.screenshot({ path: `${dir}/${season}-arrives.png` });
    await wait(7000); // the toast fades and the world settles
    s = await seasonNow(page);
    looks[season] = s.look;
    const cap = season[0].toUpperCase() + season.slice(1);
    check(s.pill.includes(`${cap}, day 2 of 3`), `the pill reads "${s.pill}"`);
    await page.addStyleTag({ content: '#toasts, .toast { display: none !important; }' });
    await page.screenshot({ path: `${dir}/${season}.png` });
    await page.evaluate(() => document.querySelectorAll('style').forEach((st) => st.textContent.includes('#toasts, .toast') && st.remove()));
  }
  const L = looks;
  check(L.spring.blossom > 0.3 && L.summer.blossom === 0, `spring blossoms (${L.spring.blossom.toFixed(2)}), summer doesn't`);
  check(L.autumn.autumn > 0.6 && L.autumn.leafFall > L.summer.leafFall * 2, `autumn turns the leaves (${L.autumn.autumn.toFixed(2)}) and many more fall (${L.autumn.leafFall} vs ${L.summer.leafFall})`);
  check(L.winter.bare > 0.7 && L.winter.frost > 0.2, `winter: bare branches (${L.winter.bare.toFixed(2)}) and frost (${L.winter.frost.toFixed(2)})`);
  check(L.summer.grass === 0 && L.autumn.grass > 0.4 && L.winter.grass > 0.4, 'the grass shifts in autumn and winter, and is its own green in summer');

  // snow falls in winter; autumn leaves drift down
  await goTo(page, 'winter', 2, 'snow', 6000);
  s = await seasonNow(page);
  check(s.weather === 'snow' && s.flakes > 50, `snow falls in winter (${s.flakes} flakes)`);
  await page.screenshot({ path: `${dir}/winter-snowfall.png` });
  await goTo(page, 'autumn', 2, 'wind', 2000);
  const leaves = await page.waitForFunction(
    () => window.solarbloom.vfx.particles.filter((p) => p.active && p.leaf && p.color[0] > p.color[1]).length,
    null,
    { timeout: 120_000, polling: 500 },
  ).then((h) => h.jsonValue()).catch(() => 0);
  check(leaves > 0, `autumn leaves drift down in gold and red (${leaves} falling now)`);
  await page.screenshot({ path: `${dir}/autumn-leaves-falling.png` });

  // the weather follows the seasons (each day's kind is picked from its season's odds)
  const wx = await page.evaluate(() => {
    const g = window.solarbloom;
    const st = g.sim.state.seasons.startDay;
    const count = {};
    for (let y = 0; y < 30; y++)
      for (let d = 0; d < 12; d++) {
        const day = st + y * 12 + d + 12; // skip the first year's day 1
        const season = g.sim.seasons.seasonOnDay(day);
        const k = g.sim.weather.kindOn(day);
        count[season] ??= {};
        count[season][k] = (count[season][k] ?? 0) + 1;
      }
    return count;
  });
  const share = (season, k) => (wx[season][k] ?? 0) / Object.values(wx[season]).reduce((a, b) => a + b, 0);
  check(!wx.spring.snow && !wx.summer.snow && !wx.autumn.snow && (wx.winter.snow ?? 0) > 0, `snow only in winter (${JSON.stringify(wx.winter)})`);
  check(share('spring', 'rain') > share('summer', 'rain') && share('summer', 'sunny') > share('winter', 'sunny') && share('autumn', 'wind') > share('summer', 'wind'), 'spring showers, summer sun, autumn wind');
  check(!wx.winter.storm, 'no storms in winter');

  // ── sleeping through the last night of a season wakes Bloombot in the next one ──
  await page.evaluate(() => (window.__toasts = []));
  const slept = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.seasons.jumpTo('summer', 3);
    const f = s.clock.gameDayFraction();
    (s.state.clock ??= { offset: 0.06 * 2880 }).offset += (0.75 - f) * 2880; // evening
    s.tick(0.1);
    const before = s.seasons.season();
    const ok = s.clock.sleep();
    return { ok, before, after: s.seasons.season(), day: s.seasons.dayOfSeason() };
  });
  check(slept.ok && slept.before === 'summer' && slept.after === 'autumn' && slept.day === 1, `sleeping through summer's last night wakes to autumn, day 1 (${JSON.stringify(slept)})`);
  check(!!(await toastSeen(page, /Autumn is turning the leaves/)), 'and autumn gets its toast');

  // ── saves and loads ──
  await goTo(page, 'winter', 3, 'snow', 1000);
  const saved = await page.evaluate(async () => {
    const g = window.solarbloom;
    await g.saveNow?.();
    return g.sim.seasons.now();
  });
  await page.goto(`http://localhost:${PORT}/?slot=1`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
  await waitForGame(page, TIMEOUT);
  await wait(2000);
  s = await seasonNow(page);
  check(s.season === saved.season && s.year === saved.year && Math.abs(s.progress - saved.progress) < 0.02, `a reload keeps the season (${saved.season} → ${s.season}, ${saved.progress.toFixed(3)} → ${s.progress.toFixed(3)})`);
  check(/Winter, day 3 of 3/.test(s.pill), `the pill after reloading: "${s.pill}"`);

  // a garden from before seasons: no season saved, ten days in, loads as a fresh spring
  await page.evaluate(async () => {
    const g = window.solarbloom;
    (g.sim.state.clock ??= { offset: 0.06 * 2880 }).offset += 9 * 2880;
    delete g.sim.state.seasons;
    await g.saveNow?.();
  });
  await page.goto(`http://localhost:${PORT}/?slot=1`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
  await waitForGame(page, TIMEOUT);
  await wait(2000);
  s = await seasonNow(page);
  check(s.season === 'spring' && s.pill.includes('Spring, day 1 of 3') && s.day > 9, `a garden saved before seasons starts a fresh spring (game day ${s.day}: "${s.pill}")`);
  await page.screenshot({ path: `${dir}/older-garden-fresh-spring.png` });

  // ── Cozy Mode: winter never slows the panels ──
  const cozy = await page.evaluate(() => {
    const g = window.solarbloom;
    g.sim.seasons.jumpTo('winter', 2);
    g.sim.weather.forceForTest('fog', 1e6);
    g.settings.cozyMode = false;
    g.applySettings();
    const off = g.sim.weather.effects().solar;
    g.settings.cozyMode = true;
    g.applySettings();
    const on = g.sim.weather.effects().solar;
    g.sim.seasons.jumpTo('summer', 2);
    const summer = g.sim.weather.effects().solar;
    return { off, on, summer };
  });
  check(cozy.on >= 0.8 && cozy.off < cozy.on && cozy.summer === cozy.off, `Cozy Mode keeps a foggy winter day's panels up (${cozy.off} → ${cozy.on}; summer fog stays ${cozy.summer})`);
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await context.close();

  // ── the Low graphics setting (the Steam Deck's): winter costs about what summer does ──
  const low = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  low.setDefaultTimeout(TIMEOUT);
  const lowErrors = [];
  low.on('pageerror', (e) => lowErrors.push(e.message));
  await startGame(low, `http://localhost:${PORT}`, { query: 'gfx=low', settings: { hints: false } });
  await wait(3000);
  await greenPark(low);
  await wait(9000);
  const ms = {};
  for (const [season, weather] of [['summer', 'sunny'], ['winter', 'snow'], ['autumn', 'wind'], ['summer', 'sunny']]) {
    await goTo(low, season, 2, weather, 6000);
    const t = await frameMs(low, 6000);
    ms[season] = Math.min(ms[season] ?? Infinity, t);
    await low.addStyleTag({ content: '#toasts, .toast { display: none !important; }' });
    await low.screenshot({ path: `${dir}/low-${season}.png` });
  }
  console.log(`  frame time on Low (software rendering): ${Object.entries(ms).map(([k, v]) => `${k} ${v.toFixed(1)} ms`).join(', ')}`);
  check(ms.winter < ms.summer * 1.35 && ms.autumn < ms.summer * 1.35, 'on Low, winter (with snow) and autumn draw within a third of summer\'s frame time');
  await goTo(low, 'winter', 2, 'snow', 5000);
  const lowFlakes = await low.evaluate(() => window.solarbloom.weatherVisuals.flakesShown);
  check(lowFlakes > 0 && lowFlakes < 300, `Low draws fewer snowflakes (${lowFlakes})`);
  check(lowErrors.length === 0, `no page errors on Low (${lowErrors.slice(0, 3).join(' | ')})`);
} catch (e) {
  failures.push(String(e?.stack ?? e));
  console.error(e);
} finally {
  await browser.close();
  await server.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall seasons checks passed');
process.exit(failures.length ? 1 : 0);
