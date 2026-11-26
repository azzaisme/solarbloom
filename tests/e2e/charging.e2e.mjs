// #784: charging, in the real built game. The player must SEE Bloombot charging, whatever it charges from:
//  - sitting on a bench: the Charge meter stays on screen (the rest of the HUD fades), glows, and rises 2 a
//    second; sparkles rise from Bloombot; the chip low on screen reads "Charging up";
//  - standing still by the fountain: a slower trickle, the same signs;
//  - eating a snack (Food, the Eat key): +25;
//  - meditating at a powered Charger: the fastest of all; with no sun, the chip says the charger waits for sunshine.
// The order Charger > bench > fountain is checked from the game's own charge as it plays.
// Screenshots go to SHOTS_DIR (default docs/review/charging-784). Run after `vite build`.
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/charging-784';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4253);
const T = Number(process.env.E2E_TIMEOUT) || 240_000;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
  page.setDefaultTimeout(T);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, `http://localhost:${PORT}`, { query: 'gfx=low', settings: { hints: false } });
  await page.addStyleTag({ content: '#toasts, .toast { display: none !important; }' });
  await wait(2000);

  const until = (fn, arg, timeout = T) => page.waitForFunction(fn, arg, { timeout, polling: 250 }).then(() => true, () => false);
  /** The sim's clock, the charge, where it comes from, and what the screen shows of it. */
  const look = () =>
    page.evaluate(() => {
      const g = window.solarbloom;
      const row = document.getElementById('chargeRow');
      const res = document.getElementById('res');
      const tally = document.getElementById('tally');
      const shown = (el) => !!el && !el.hidden && Number(getComputedStyle(el).opacity) > 0.5 && el.getBoundingClientRect().width > 0;
      const bot = g.bot.seat ?? g.bot.pose;
      const sparkles = g.vfx.particles.filter((p) => p.active && p.glow >= 1 && Math.hypot(p.x - bot.x, p.z - bot.z) < 1.2).length;
      return {
        t: g.sim.state.time,
        v: g.sim.charge.value(),
        from: g.sim.charge.chargingFrom ?? null,
        meter: shown(row) && shown(res),
        glow: row.classList.contains('charging'),
        pct: row.querySelector('.pct').textContent,
        chip: shown(tally) ? document.getElementById('tallyText').textContent : '',
        sparkles,
        resting: document.body.classList.contains('resting'),
      };
    });
  /** The charge a second over `secs` of game time, from the game's own clock. */
  const rate = async (secs) => {
    const a = await look();
    await until((t) => window.solarbloom.sim.state.time >= t, a.t + secs);
    const b = await look();
    return (b.v - a.v) / (b.t - a.t);
  };
  /** Bloombot in front of a tile, facing it (from +z). */
  const before = (x, z) =>
    page.evaluate(({ x, z }) => {
      const g = window.solarbloom;
      g.bot.teleport('g', x, z + 1);
      g.bot.pose.x = x + 0.5;
      g.bot.pose.z = z + 1.6;
      g.bot.pose.facing = Math.PI;
    }, { x, z });
  /** A sparkle is short-lived: look a few times. */
  const sawSparkles = async () => {
    for (let i = 0; i < 12; i++) {
      if ((await look()).sparkles > 0) return true;
      await wait(150);
    }
    return false;
  };
  const key = async (code) => {
    await page.keyboard.press(code);
    await wait(400);
  };

  // ── a bench: mend it, sit, and watch the meter rise ──
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.state.charge.value = 20;
    s.inventory.add('scrap', 3);
  });
  await before(10, 6);
  check(await until(() => /Mend/.test(document.getElementById('prompt')?.innerText ?? '')), 'facing the old bench: the prompt offers to mend it');
  await key('KeyE');
  check(await until(() => /Sit on/.test(document.getElementById('prompt')?.innerText ?? '')), 'mended: the prompt offers to sit');
  await key('KeyE');
  check(await until(() => window.solarbloom.sim.rest.sitting?.kind === 'bench'), 'Bloombot sits on the bench');
  await until(() => window.solarbloom.sim.charge.chargingFrom === 'bench');
  await wait(1500);
  let s = await look();
  check(s.resting, 'sitting: the calm view (the rest of the HUD fades)');
  check(s.meter, `…but the Charge meter stays on screen (${s.pct})`);
  check(s.from === 'bench' && s.glow, `the meter glows while the bench charges Bloombot (from ${s.from})`);
  check(/Charging up/.test(s.chip), `the chip reads "${s.chip}"`);
  check(await sawSparkles(), 'sparkles rise from Bloombot on the bench');
  const bench = await rate(4);
  check(bench > 1.8 && bench < 2.2, `the bench gives 2 Charge a second (${bench.toFixed(2)})`);
  const p0 = Number(s.pct.replace(/\D/g, ''));
  await until((p) => Number(document.querySelector('#chargeRow .pct').textContent.replace(/\D/g, '')) >= p + 3, p0);
  s = await look();
  check(Number(s.pct.replace(/\D/g, '')) >= p0 + 3, `the meter visibly rises (${p0}% → ${s.pct})`);
  await page.evaluate(() => window.solarbloom.camera.jumpZoom(6));
  await wait(1200);
  await page.screenshot({ path: `${dir}/bench-charging.png` });
  await key('KeyE');
  check(await until(() => !window.solarbloom.sim.rest.sitting), 'E stands up again');

  // ── the fountain: stand still beside it ──
  const home = await page.evaluate(() => {
    const g = window.solarbloom;
    const core = g.sim.state.machines.find((m) => m.type === 'core' && g.sim.areas.areaOf(m) === 'park');
    g.sim.state.charge.value = 20;
    g.bot.teleport('g', core.x + core.size + 1, core.z + 1);
    return g.sim.charge.atHome();
  });
  check(home, 'Bloombot stands beside the fountain');
  check(await until(() => window.solarbloom.sim.charge.chargingFrom === 'home'), 'standing still a moment, the fountain charges it');
  // the teleport settles for a moment (a nudge restarts the stand-still wait): measure once it has stood a while
  await until(() => window.solarbloom.sim.charge.still > 3);
  await wait(300);
  s = await look();
  check(s.meter && s.glow, 'the meter glows by the fountain');
  check(/Charging up/.test(s.chip), `the chip reads "${s.chip}"`);
  check(await sawSparkles(), 'sparkles rise from Bloombot by the fountain');
  const still0 = await page.evaluate(() => window.solarbloom.sim.charge.still);
  const fountain = await rate(4);
  const still1 = await page.evaluate(() => window.solarbloom.sim.charge.still);
  check(still1 > still0, `Bloombot stood still the whole time it was measured (${still0.toFixed(1)} s → ${still1.toFixed(1)} s)`);
  check(fountain > 0.85 && fountain < 1.15 && fountain < bench, `the fountain gives 1 a second, slower than the bench (${fountain.toFixed(2)} vs ${bench.toFixed(2)})`);
  await page.evaluate(() => (window.solarbloom.zoomStep = 0));
  await wait(1500);
  await page.screenshot({ path: `${dir}/fountain-charging.png` });

  // ── a snack: Food gives +25 ──
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.bot.teleport('g', 30.5, 30.5); // away from home
    g.sim.state.charge.value = 20;
    const pack = g.sim.state.salvage.pack;
    for (const k of Object.keys(pack)) delete pack[k];
    pack.food = 2;
  });
  await wait(600);
  const before0 = (await look()).v;
  await key('KeyF');
  check(await until(() => window.solarbloom.sim.charge.eating?.id === 'food', undefined, 30_000), 'the Eat key eats some Food');
  s = await look();
  check(s.glow, 'the meter glows while eating');
  await page.screenshot({ path: `${dir}/eating.png` });
  await until(() => !window.solarbloom.sim.charge.eating);
  const ate = (await look()).v - before0;
  check(ate > 24 && ate < 26.5, `one Food gives +25 Charge (${ate.toFixed(1)})`);

  // ── a Charger: the fastest of all; with no sun, it says so ──
  const pad0 = await page.evaluate(() => {
    const g = window.solarbloom;
    const sim = g.sim;
    sim.power.skyOverride = () => ({ sun: 1, solar: 1, cloudy: false, wind: 0, dark: 0 });
    const at = (x, z) => sim.grid.get('g', x, z);
    const free = (x, z, lvl) => {
      const t = at(x, z);
      return !!t && !t.blocked && !t.occupantId && !t.prop && !t.ramp && t.feature !== 'water' && (t.level ?? 0) === lvl;
    };
    const spot = sim.areas.tiles('park').find((t) => t.x > 2 && t.z > 2 && [[0, 0], [-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1], [0, 2]].every(([dx, dz]) => free(t.x + dx, t.z + dz, t.level ?? 0)));
    const check = sim.build.check.bind(sim.build);
    const pay = sim.inventory.pay.bind(sim.inventory);
    sim.build.check = () => ({ ok: true, cost: {}, spotOk: true });
    sim.inventory.pay = () => true;
    const put = (type, x, z) => {
      const t = sim.grid.get('g', x, z);
      t.ground = 'restored';
      t.blocked = false;
      t.bloom = 1;
      t.pollution = 0;
      sim.grid.touch(t);
      return sim.build.place(type, 'g', x, z);
    };
    put('solar', spot.x - 1, spot.z);
    put('solar', spot.x + 1, spot.z);
    const m = put('charger', spot.x, spot.z);
    sim.build.check = check;
    sim.inventory.pay = pay;
    sim.state.charge.value = 20;
    return { x: spot.x, z: spot.z, id: m.id };
  });
  await before(pad0.x, pad0.z);
  check(await until(() => /Meditate/.test(document.getElementById('prompt')?.innerText ?? '')), 'facing the Charger: the prompt offers to meditate');
  await key('KeyE');
  check(await until(() => window.solarbloom.sim.rest.sitting?.kind === 'charger'), 'Bloombot meditates at the Charger');
  await page.evaluate(() => (window.solarbloom.sim.state.charge.value = 10));
  check(await until(() => window.solarbloom.sim.charge.chargingFrom === 'charger'), 'the powered Charger charges it');
  await wait(600);
  s = await look();
  check(s.meter && s.glow && /Charging up/.test(s.chip), `the meter stays, glows, and the chip reads "${s.chip}"`);
  check(await sawSparkles(), 'sparkles rise from Bloombot at the Charger');
  const charger = await rate(2);
  check(charger > bench * 4, `the Charger is the fastest (${charger.toFixed(2)} vs bench ${bench.toFixed(2)})`);
  check(charger > bench && bench > fountain, `the order holds: Charger ${charger.toFixed(2)} > bench ${bench.toFixed(2)} > fountain ${fountain.toFixed(2)}`);
  await page.evaluate(() => window.solarbloom.camera.jumpZoom(6));
  await wait(1200);
  await page.screenshot({ path: `${dir}/charger-charging.png` });
  // night falls on its panels: it says what it waits for
  await page.evaluate(() => {
    const sim = window.solarbloom.sim;
    sim.power.skyOverride = () => ({ sun: 0, solar: 0, cloudy: false, wind: 0, dark: 1 });
    sim.state.charge.value = 10;
  });
  check(await until(() => !window.solarbloom.sim.charge.chargingFrom), 'no sun on its panels: the Charger stops');
  check(await until(() => /waiting for sunshine/.test(document.getElementById('tallyText')?.textContent ?? '')), 'the chip says the charger is waiting for sunshine');
  s = await look();
  check(!s.glow, 'the meter stops glowing');
  await page.screenshot({ path: `${dir}/charger-no-sun.png` });

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.error(e);
  failures.push(String(e));
} finally {
  await browser.close();
  server.httpServer.close();
}
if (failures.length) {
  console.error(`\n${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall passed');
process.exit(0);
