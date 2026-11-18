// E23.2 (#356): a headless play-through of bloombot's charge, the loaded pulse and the reveal ripple, driven by real
// key presses where there is a key for it. `node tests/e2e/bloombot-e23.mjs [outDir]` after `vite build`.
// Writes JPEG screenshots at the key moments and prints what each shows; fails on page errors or broken checks.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/e23-2';
mkdirSync(out, { recursive: true });
// any free port: other sessions run previews on this machine too
// DIST: serve a copied build (so the working tree can move on while this runs)
const server = await preview({ root: process.cwd(), build: { outDir: process.env.DIST ?? 'dist' }, preview: { port: 4251 + Math.floor(Math.random() * 400), strictPort: false }, logLevel: 'silent' });
const URL0 = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const checks = [];
const check = (ok, what) => {
  checks.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};
const shots = [];
async function shot(page, name, what) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 82 });
  shots.push(`${name}.jpg: ${what}`);
}
/** Waits (up to 60 s) for a condition in the page; false when it never came. */
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 60000 }).then(() => true, () => false);
const key = async (page, code) => {
  await page.keyboard.press(code);
  await page.waitForTimeout(250);
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${URL0}?slot=1&new=1`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');

  // ── E23.2.1: the charge meter, full, low and empty; eating with F ──
  const meter = () => page.evaluate(() => ({ cls: document.getElementById('chargeRow').className, txt: document.getElementById('chargeRow').innerText.replace(/\s+/g, ' ').trim() }));
  check((await meter()).txt.includes('100%'), 'a new game starts with a full charge');
  await page.evaluate(() => (window.solarbloom.sim.state.charge.value = 14));
  check(await until(page, () => document.getElementById('chargeRow').classList.contains('low')), 'the meter warms when low');
  await shot(page, '01-charge-low', 'the Charge pill at the top of the resource strip, low (14%), warm border');
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.state.charge.value = 0.4;
    s.charge.use('pulse');
  });
  check(await until(page, () => document.getElementById('chargeRow').classList.contains('empty')), 'at zero the meter goes grey');
  await shot(page, '02-charge-empty', 'out of charge: the grey meter and the one-time "Out of charge" note');
  await page.evaluate(() => window.solarbloom.sim.econ.add('biomass', 3));
  await key(page, 'KeyF');
  const ateOk = await until(page, () => window.solarbloom.sim.charge.value >= 5.9 && !window.solarbloom.sim.charge.eating);
  const ate = await page.evaluate(() => window.solarbloom.sim.charge.value);
  check(ateOk, `F ate a snack: charge came back to ${ate.toFixed(1)}`);

  // ── E23.2.2.1: the load wheel on the keyboard ──
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.state.charge.value = 100;
    s.inventory.add('seeds', 6);
    s.state.salvage.pack.rareSeed = 2;
    s.state.salvage.pack.fertiliser = 2;
    s.econ.add('energy', 1e5);
    s.econ.add('water', 1e5);
  });
  await key(page, 'KeyV');
  check((await page.evaluate(() => window.solarbloom.sim.pulseLoad.choice)) === 'seeds', 'V turns the wheel to Seeds');
  await shot(page, '03-load-wheel', 'the load wheel above the prompt: Seeds lit; the chip under the charge says Seeds');
  await key(page, 'KeyZ');
  check((await page.evaluate(() => window.solarbloom.sim.pulseLoad.choice)) === 'none', 'Z turns it back to Nothing');

  // ── E23.2.2.2: pulse with each load, by Space on the tile in front ──
  const grown = await page.evaluate(async () => {
    const g = window.solarbloom;
    const s = g.sim;
    const dead = s.areas.tiles('park').filter((t) => t.ground === 'polluted' && !t.blocked && !t.occupantId && s.restoration.checkPulse(t).ok);
    const row = dead.find((t) => [0, 6, 12].every((dx) => dead.some((o) => o.x === t.x + dx && o.z === t.z)));
    return row ? [0, 6, 12].map((dx) => ({ x: row.x + dx, z: row.z })) : [];
  });
  check(grown.length === 3, 'three dead park tiles in a row to pulse');
  const loads = ['seeds', 'rare', 'fertiliser'];
  for (let i = 0; i < 3; i++) {
    const c = grown[i];
    await page.evaluate(({ c, load }) => {
      const g = window.solarbloom;
      g.sim.pulseLoad.choose(load);
      g.bot.teleport('g', c.x, c.z + 1);
      g.bot.pose.x = c.x + 0.5;
      g.bot.pose.z = c.z + 1.5;
      g.bot.pose.facing = Math.PI; // facing the tile
    }, { c, load: loads[i] });
    await page.waitForTimeout(300);
    await key(page, 'Space');
  }
  // let the restore transitions play out (the plants are drawn once a tile has finished turning)
  await until(page, (cs) => cs.every((c) => { const t = window.solarbloom.sim.grid.get('g', c.x, c.z); return t?.ground === 'restored' && !t.tr; }), grown);
  const plants = await page.evaluate((cs) => cs.map((c) => window.solarbloom.sim.grid.get('g', c.x, c.z)?.plant ?? 'none'), grown);
  check(plants.join() === 'meadow,rare,grove', `each load grew its own plant: ${plants.join(', ')}`);
  const left = await page.evaluate(() => ({ ...window.solarbloom.sim.state.salvage.pack }));
  check(left.seeds === 5 && left.rareSeed === 1 && left.fertiliser === 1, 'each pulse used one unit of its load');
  await page.evaluate((c) => {
    const g = window.solarbloom;
    g.bot.teleport('g', c.x, c.z + 8); // out of the way, behind the camera
    g.camera.turnTo(0, true); // looking along the row's normal: the three plots left to right
    g.bot.following = false;
    g.camera.focus(c.x + 0.5, 0, c.z + 0.5, 1.1, 0.01);
  }, grown[1]);
  await page.waitForTimeout(2500);
  await shot(page, '04-loads-grown', 'left to right: a wildflower meadow (seeds), the region\'s rare flowers, a young tree in shrubs over a bigger patch (fertiliser)');

  // ── E23.2.2.3: the ripple reveals a buried find; a mound shows; Interact digs it up ──
  const dug = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const finds = s.buried.near(8, 8, 30);
    for (const f of finds) {
      const t = s.areas.tiles('park').concat(s.areas.tiles('saltwind')).find((q) => q.ground === 'polluted' && !q.blocked && !q.occupantId && s.restoration.checkPulse(q).ok && Math.hypot(q.x - f.x, q.z - f.z) <= 6 && Math.hypot(q.x - f.x, q.z - f.z) >= 2);
      if (!t) continue;
      s.pulseLoad.choose('none');
      s.restoration.pulse(t.id);
      return { f, known: !!s.buried.known(f.x, f.z) };
    }
    return undefined;
  });
  check(!!dug?.known, 'a pulse near a buried find revealed it');
  if (dug) {
    const f = dug.f;
    const faced = await page.evaluate((f) => {
      // stand on a free side of the mound, facing it
      const g = window.solarbloom;
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const t = g.sim.grid.get('g', f.x + dx, f.z + dz);
        if (!t || t.blocked || t.occupantId) continue;
        g.bot.following = true;
        g.bot.teleport('g', f.x + dx, f.z + dz);
        g.bot.pose.x = f.x + dx + 0.5;
        g.bot.pose.z = f.z + dz + 0.5;
        g.bot.pose.facing = Math.atan2(-dx, -dz);
        const fr = g.bot.front();
        if (fr.x === f.x && fr.z === f.z) {
          g.camera.turnTo(45, true);
          return true;
        }
      }
      return false;
    }, f);
    check(faced, 'bloombot stands facing the mound');
    await shot(page, '05-buried-mound', `a revealed buried find (${f.material}): a mound of turned earth with a sprout; the prompt says Dig up`);
    const prompt = await page.evaluate(() => document.getElementById('prompt')?.innerText ?? '');
    check(/Dig up/.test(prompt), `the prompt offers to dig: "${prompt.replace(/\s+/g, ' ')}"`);
    const before = await page.evaluate((m) => window.solarbloom.sim.inventory.count(m), f.material);
    await key(page, 'KeyE');
    await page.waitForTimeout(400);
    const after = await page.evaluate((m) => window.solarbloom.sim.inventory.count(m), f.material);
    check(after === before + f.n, `E dug it up: ${f.material} ${before} → ${after}`);
    await shot(page, '06-buried-dug', 'dug up: the mound is gone and a pick-up toast shows');
  }
  await page.close();
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(shots.map((s) => `  ${s}`).join('\n'));
console.log(checks.join('\n'));
if (errors.length) {
  console.log('PAGE ERRORS:\n' + errors.join('\n'));
  process.exitCode = 1;
}
