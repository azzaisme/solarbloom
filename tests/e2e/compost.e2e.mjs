// E23.5.3 (#388): a play-through of the compost bin and the Bio Digester in headless Chromium, with screenshots.
// `npx vite build && node tests/e2e/compost.e2e.mjs [outDir]`. The crafting table is opened for real, the panels are
// driven with real key presses and clicks; the sim is only nudged to set the scene (restored ground, materials, woken
// Keepers) and to bring on the night.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/compost';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4252, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const errors = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

const page = await browser.newPage({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180_000);
page.on('pageerror', (e) => errors.push(String(e)));
let shot = 0;
const snap = async (name) => {
  await page.waitForTimeout(800);
  const path = `${out}/${String(++shot).padStart(2, '0')}-${name}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 80, timeout: 180_000 });
  console.log(`  📷 ${path}`);
};
/** Runs a function in the page with the game (`g`) and sim (`s`) in scope. */
const game = (fn, arg) => page.evaluate(({ src, arg }) => new Function('g', 's', 'arg', `return (${src})(g, s, arg)`)(window.solarbloom, window.solarbloom.sim, arg), { src: fn.toString(), arg });
const prompt = () => page.evaluate(() => document.querySelector('#prompt, .prompt')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
const panel = () => page.evaluate(() => (document.querySelector('#ocPanel.open') ? document.querySelector('#ocPanel')?.innerText.replace(/\s+/g, ' ').trim() : ''));
const pressE = async () => {
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(600);
};
const closePanel = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
};
/** Stands bloombot beside a tile, facing it, and waits for the prompt to settle. */
const face = async (x, z) => {
  const ok = await game(
    (g, s, { x, z }) => {
      for (const [dx, dz, facing] of [[0, 1, Math.PI], [0, -1, 0], [1, 0, -Math.PI / 2], [-1, 0, Math.PI / 2]]) {
        const t = s.grid.get('g', x + dx, z + dz);
        if (!t || t.blocked || t.occupantId || t.feature === 'water') continue;
        g.bot.pose.x = x + dx + 0.5;
        g.bot.pose.z = z + dz + 0.5;
        g.bot.pose.facing = facing;
        return true;
      }
      return false;
    },
    { x, z },
  );
  await page.waitForTimeout(900);
  return ok;
};

try {
  await page.goto('http://localhost:4252/?slot=1&new=1', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 900_000 });
  await page.waitForTimeout(2000);
  check(errors.length === 0, 'the game loads without errors');

  // The scene: restored ground around bloombot, Tock (the digester) and Pylon (poles and chargers) awake, materials.
  const lay = await game((g, s) => {
    const bx = Math.floor(g.bot.pose.x);
    const bz = Math.floor(g.bot.pose.z);
    const level = s.grid.get('g', bx, bz)?.level ?? 0;
    const open = new Set();
    for (let dx = -8; dx <= 8; dx++)
      for (let dz = -8; dz <= 8; dz++) {
        const t = s.grid.get('g', bx + dx, bz + dz);
        if (t && !t.blocked && !t.occupantId && t.feature !== 'water' && (t.level ?? 0) === level && !s.salvage.pileAt(bx + dx, bz + dz)) open.add(`${bx + dx},${bz + dz}`);
      }
    for (const k of open) {
      const [x, z] = k.split(',').map(Number);
      const t = s.grid.get('g', x, z);
      s.restoration.complete(t, 'pulse');
      t.bloom = 2;
      s.grid.touch(t);
    }
    s.state.salvage.tier = 3;
    s.state.salvage.keepers.tock = { step: 'request1' };
    s.state.salvage.keepers.pylon = { step: 'request1' };
    for (const [k, v] of Object.entries({ planks: 12, scrap: 30, clay: 10, motor: 4, wire: 8, biomass: 40 })) s.inventory.add(k, v);
    // three tiles in an L (pole, digester, charger) with open ground round them, and a fourth for the bin
    const has = (x, z) => open.has(`${x},${z}`);
    let site;
    for (const k of open) {
      const [x, z] = k.split(',').map(Number);
      if (Math.abs(x - bx) + Math.abs(z - bz) < 3) continue;
      if (has(x + 1, z) && has(x, z + 1) && has(x + 1, z + 1) && has(x - 1, z) && has(x, z - 1) && has(x + 3, z) && has(x + 3, z + 1) && has(x, z + 2)) {
        site = [x, z];
        break;
      }
    }
    return { open: open.size, site };
  });
  check(lay.open >= 40 && !!lay.site, `restored ${lay.open} open tiles and found a site (${lay.site})`);
  const [sx, sz] = lay.site;

  // ── the crafting table lists the compost bin and the Bio Digester ──
  await game((g) => {
    g.hud.craft.open();
    g.syncPanelPause?.();
  });
  await page.waitForTimeout(800);
  const table = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  check(/Compost bin/i.test(table) && /Bio Digester/i.test(table), 'the crafting table lists the Compost bin and the Bio Digester');
  await snap('crafting-table');
  await page.keyboard.press('Escape'); // closed like a player closes it (the game unpauses)
  await page.waitForTimeout(600);
  check(!(await game((g) => g.paused ?? false)), 'the game runs again once the table is closed');

  // ── built from their table recipes (the build tool pays the recipe) ──
  const built = await game(
    (g, s, { sx, sz }) => {
      const before = { planks: s.inventory.count('planks'), motor: s.inventory.count('motor') };
      const bin = s.build.place('compostBin', 'g', sx + 3, sz);
      const pole = s.build.place('relay', 'g', sx, sz);
      const dig = s.build.place('bioDigester', 'g', sx + 1, sz);
      const charger = s.build.place('charger', 'g', sx, sz + 1);
      return {
        bin: bin && { id: bin.id, x: bin.x, z: bin.z },
        dig: dig && { id: dig.id, x: dig.x, z: dig.z },
        charger: charger && { id: charger.id, x: charger.x, z: charger.z },
        pole: !!pole,
        paid: { planks: before.planks - s.inventory.count('planks'), motor: before.motor - s.inventory.count('motor') },
      };
    },
    { sx, sz },
  );
  check(!!built.bin && !!built.dig && !!built.charger && built.pole, 'built a compost bin, a power pole, a Bio Digester and a charger');
  check(built.paid.planks >= 4 && built.paid.motor === 2, `paid the table recipes (planks ${built.paid.planks}, motors ${built.paid.motor})`);

  // ── fill the bin from its panel ──
  await face(built.bin.x, built.bin.z);
  check(/compost bin/i.test(await prompt()), `the prompt offers the compost bin (${await prompt()})`);
  await pressE();
  check(/Compost Bin/i.test(await panel()), 'the compost bin panel opens');
  await page.click('#ocPanel [data-act="fill"][data-arg="biomass"]');
  await page.waitForTimeout(600);
  const inBin = await game((g, s, id) => s.compost.bin(s.machine(id)).feed ?? 0, built.bin.id);
  check(inBin > 0, `biomass went into the bin (${inBin})`);
  await snap('bin-filled');
  await closePanel();

  // ── feed the digester from its panel, by day: the grid needs nothing, so it waits ──
  await face(built.dig.x, built.dig.z);
  await pressE();
  check(/Bio Digester/i.test(await panel()), 'the Bio Digester panel opens');
  await page.click('#ocPanel [data-act="feed"]');
  await page.waitForTimeout(600);
  const fed = await game((g, s, id) => s.compost.fuel(s.machine(id)), built.dig.id);
  check(fed > 0, `the digester took biomass (${fed})`);
  await snap('digester-fed');
  await closePanel();

  // ── night: bloombot sits at the charger, the digester carries it ──
  await game(
    (g, s, c) => {
      s.state.time = 0;
      const f0 = s.clock.gameDayFraction();
      s.state.time = ((((0.75 - f0) % 1) + 1) % 1) * 2880; // the middle of the game night
      g.bot.pose.x = c.x + 0.5;
      g.bot.pose.z = c.z + 1.3; // at the pad's edge
      g.bot.pose.facing = 0;
      s.charge.drainForTest();
    },
    built.charger,
  );
  await page.waitForTimeout(6000);
  const night = await game(
    (g, s, { dig, charger }) => {
      const d = s.machine(dig.id);
      const c = s.machine(charger.id);
      return { night: s.clock.gameIsNight(), mood: s.compost.mood(d), supplying: s.compost.supplying(d), charging: s.chargers.charging(c), powered: s.power.isPowered(c), fuel: s.compost.fuel(d) };
    },
    built,
  );
  check(night.night, 'it is night on the game clock');
  check(night.mood === 'running' && night.supplying > 0, `the digester is running (${night.mood}, ${night.supplying.toFixed(2)} W)`);
  check(night.powered, `the charger is powered at night (charging: ${night.charging})`);
  await snap('night-digester-powers-charger');
  await face(built.dig.x, built.dig.z);
  await pressE();
  check(/Running/i.test(await panel()), `the panel says it is running (${await panel()})`);
  await snap('night-digester-panel');
  await closePanel();
} catch (e) {
  failures.push(String(e));
  console.error(e);
}
check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
await browser.close();
await server.close();
if (failures.length) {
  console.log(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else console.log('\nall checks passed');
