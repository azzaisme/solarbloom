// E23.1.1 (#365): a garden from an earlier version starts fresh, calmly. Two old saves sit in the slots: slot 1 with
// an old header (the title marks it "Earlier version" and offers Start fresh), slot 2 with a current header over an
// old save (loading it drops it and the game says so in one gentle line). Both end in a new Old City game, with no
// errors on the console. Screenshots go to docs/review/fresh-start-*.png. Run after `vite build`.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const URL_ = 'http://localhost:4241/';
const server = await preview({ preview: { port: 4241, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

// A minimal save from the classic idle game (v7) and its pre-E23 header.
const oldSave = JSON.stringify({ version: 7, seed: 42, rules: 'classic', time: 900, layers: [], machines: [], resources: { energy: '120', water: '40', biomass: '5e9' } });
const oldHead = JSON.stringify({ name: 'Garden 1', played: 900, step: 'The fountain is awake', region: 'The park', rules: 'classic', savedAt: 1 });
const sneakyHead = JSON.stringify({ name: 'Garden 2', played: 60, step: 'The fountain is dry', region: 'The park', version: 8, savedAt: 2 });

try {
  for (const run of ['title', 'load']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.addInitScript(
      ([s, h1, h2, run]) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.clear();
        localStorage.setItem('solarbloom.save.1', s);
        localStorage.setItem('solarbloom.save.1.head', h1);
        if (run === 'load') {
          localStorage.setItem('solarbloom.save.2', s);
          localStorage.setItem('solarbloom.save.2.head', h2);
        }
      },
      [oldSave, oldHead, sneakyHead, run],
    );
    await page.goto(URL_);
    await page.waitForSelector('#tPress', { timeout: 60_000 });
    await page.keyboard.press('Space');
    await page.waitForSelector('#tPlay');
    await page.click('#tPlay');
    await page.waitForSelector('#tLoad1');
    const card = await page.evaluate(() => document.querySelector('#tLoad1').closest('.t-slot').textContent);
    check(/Earlier version/.test(card) && /starts fresh/.test(card) && /Start fresh/.test(card), `${run}: slot 1 says it is from an earlier version and offers Start fresh ("${card.trim().replace(/\s+/g, ' ')}")`);
    check(!(await page.$('#tRename1')), `${run}: an old garden can't be renamed or loaded, only started fresh or deleted`);
    await page.screenshot({ path: `${dir}/fresh-start-${run}-title.png` });
    const target = run === 'title' ? '#tLoad1' : '#tLoad2';
    if (run === 'title') {
      // Start fresh is a new garden: it asks about the day clock first, like any new garden (E23.7.1)
      await page.click(target);
      await page.waitForSelector('#tConfirmText', { timeout: 30_000 });
      const q = await page.evaluate(() => document.querySelector('#tConfirmText').textContent);
      check(/How should the days go/.test(q) && !!(await page.$('#tAlt')), `title: Start fresh asks the day-clock question ("${q}")`);
      await Promise.all([page.waitForNavigation({ timeout: 60_000 }).catch(() => {}), page.click('#tYes')]);
    } else await Promise.all([page.waitForNavigation({ timeout: 60_000 }).catch(() => {}), page.click(target)]);
    await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 180_000 });
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => ({ version: window.solarbloom.sim.state.version, time: window.solarbloom.sim.state.time, oldCity: !!window.solarbloom.sim.state.salvage && !('rules' in window.solarbloom.sim.state), toasts: [...document.querySelectorAll('#toasts *, .toast')].map((t) => t.textContent).join(' | ') }));
    check(st.oldCity && st.version === 8 && st.time < 60, `${run}: a new Old City game (version ${st.version}, ${st.time.toFixed(1)} s in)`);
    if (run === 'load') check(/Starting fresh/.test(st.toasts) && /earlier version/.test(st.toasts), `load: one calm note says it starts fresh ("${st.toasts}")`);
    else check(!/Starting fresh/.test(st.toasts), 'title: no note after choosing Start fresh (the card already said it)');
    await page.screenshot({ path: `${dir}/fresh-start-${run}-game.png` });
    check(errors.length === 0, `${run}: no errors (${errors.join(' / ')})`);
    await page.close();
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
if (failures.length) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('fresh start: all checks passed');
