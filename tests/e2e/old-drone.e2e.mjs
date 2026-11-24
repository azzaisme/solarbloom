// The park's old drone sleeps on its old solar lamp in a new garden (the owner: "don't start with a drone already
// going"), until the player walks up to the lamp and wakes it with Interact. In the real game:
//  - a new garden: the old drone is asleep on its lamp, does no work, and doesn't follow Bloombot around;
//  - standing at the lamp, the prompt reads "Wake the old drone" with the player's own key;
//  - pressing Interact wakes it: a toast says so, it starts working and keeps Bloombot company;
//  - the garden saves it awake, and a reload keeps it awake.
// Screenshots go to SHOTS_DIR (default docs/review/old-drone). Run after `vite build` (npm run test:old-drone).
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame, waitForGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/old-drone';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4247);
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(Number(process.env.E2E_TIMEOUT) || 240_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, `http://localhost:${PORT}`, { query: 'gfx=low', settings: { hints: false } });
  await wait(3000);

  const state = () =>
    page.evaluate(() => {
      const g = window.solarbloom;
      const d = g.sim.state.drones.find((x) => x.old);
      return { asleep: g.sim.drones.oldAsleep, status: d && g.sim.drones.statusOf(d), jobs: g.sim.state.stats.droneJobs, companion: g.drones.companionId(), oldId: d?.id };
    });
  let s = await state();
  check(s.asleep && s.status === 'asleep', `a new garden: the old drone is asleep on its lamp (${s.status})`);
  check(s.companion !== s.oldId, 'it does not follow Bloombot around while asleep');
  await wait(8000);
  s = await state();
  check(s.jobs === 0, `…and does no work at all (${s.jobs} jobs after a while)`);

  // walk up to the lamp: stand beside it, facing it
  await page.evaluate(() => {
    const g = window.solarbloom;
    const lamp = g.sim.machine(g.sim.drones.oldHomeId());
    const spots = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dz]) => [lamp.x + 0.5 + dx, lamp.z + 0.5 + dz]);
    const [x, z] = spots.find(([x, z]) => { const t = g.sim.grid.get(lamp.roofId, Math.floor(x), Math.floor(z)); return t && !t.blocked && !t.occupantId; }) ?? spots[0];
    g.bot.teleport(lamp.roofId, x, z);
    g.bot.faceToward(lamp.x + 0.5, lamp.z + 0.5);
  });
  await wait(2500);
  const prompt = await page.evaluate(() => document.getElementById('prompt')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
  check(/Wake the old drone/.test(prompt) && !/\{/.test(prompt), `the prompt at the lamp: "${prompt}"`);
  await page.screenshot({ path: `${dir}/asleep-at-the-lamp.png` });

  // press Interact (the player's key)
  const key = await page.evaluate(() => window.solarbloom.bindings.keys.interact[0]);
  await page.keyboard.press(key.replace(/^Key/, ''));
  await wait(1500);
  s = await state();
  check(!s.asleep, 'pressing Interact wakes it');
  const toast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | '));
  check(/old drone wakes up/i.test(toast) && !/\{/.test(toast), `the toast: "${toast.slice(0, 120)}"`);
  await page.screenshot({ path: `${dir}/woken.png` });
  // the game's clock runs slower than real time in a software-rendered browser: wait for its first job
  await page.waitForFunction(() => window.solarbloom.sim.state.stats.droneJobs > 0, null, { timeout: 180_000, polling: 1000 }).catch(() => {});
  s = await state();
  check(s.jobs > 0, `it starts tending the ground (${s.jobs} jobs)`);
  check(s.companion === s.oldId, 'and now keeps Bloombot company');

  // saved awake: a reload keeps it awake
  await page.evaluate(() => window.solarbloom.saveNow?.());
  await page.goto(`http://localhost:${PORT}/?slot=1&gfx=low`);
  await waitForGame(page);
  await wait(2000);
  s = await state();
  check(!s.asleep, 'after a reload it is still awake');
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
