// E23.5 (#359): a play-through of the farm in headless Chromium, with screenshots at each key moment.
// `npx vite build && node tests/e2e/farm.e2e.mjs [outDir]`. Real key presses for Interact (E) and holds; the sim is
// only nudged to set the scene (restored ground, materials, a woken Keeper) and to pass game days quickly.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/farm';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4251, strictPort: true }, logLevel: 'silent' });
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
  await page.waitForTimeout(700);
  const path = `${out}/${String(++shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path, timeout: 180_000 }); // swiftshader on a busy machine is slow
  console.log(`  📷 ${path}`);
};
/** Runs a function in the page with the game (`g`) and sim (`s`) in scope. */
const game = (fn, arg) => page.evaluate(({ src, arg }) => new Function('g', 's', 'arg', `return (${src})(g, s, arg)`)(window.solarbloom, window.solarbloom.sim, arg), { src: fn.toString(), arg });
const prompt = () => page.evaluate(() => document.querySelector('#prompt, .prompt')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
const panel = () => page.evaluate(() => (document.querySelector('#ocPanel.open') ? document.querySelector('#ocPanel')?.innerText.replace(/\s+/g, ' ').trim() : ''));
const pressE = async () => {
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);
};
const holdE = async () => {
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(1100);
  await page.keyboard.up('KeyE');
  await page.waitForTimeout(400);
};
const closePanel = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};
/** Stands bloombot on a tile facing a neighbouring one (a machine or ground), and waits for the prompt to settle. */
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
/** Passes some game days for the farm systems (the rest of the world is left alone). */
const days = (n) =>
  game(
    (g, s, n) => {
      const steps = Math.round((n * 2880) / 30);
      for (let i = 0; i < steps; i++) {
        s.state.time += 30;
        s.farm.tick(30);
        s.compost.tick(30);
        s.farmExtras.tick(30);
      }
    },
    n,
  );

try {
  await page.goto('http://localhost:4251/?slot=1&new=1', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 900_000 });
  await page.waitForTimeout(2000);
  check(errors.length === 0, 'the game loads without errors');

  // The scene: a patch of restored, flowering ground around bloombot's start, a farm laid out on it, and materials.
  const lay = await game((g, s) => {
    const bx = Math.floor(g.bot.pose.x);
    const bz = Math.floor(g.bot.pose.z);
    const level = s.grid.get('g', bx, bz)?.level ?? 0;
    const open = [];
    for (let r = 1; r <= 8 && open.length < 60; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const t = s.grid.get('g', bx + dx, bz + dz);
          if (t && !t.blocked && !t.occupantId && t.feature !== 'water' && (t.level ?? 0) === level && !s.salvage.pileAt(bx + dx, bz + dz)) open.push([bx + dx, bz + dz]);
        }
    for (const [x, z] of open) {
      const t = s.grid.get('g', x, z);
      s.restoration.complete(t, 'pulse');
      t.bloom = 2;
      s.grid.touch(t);
    }
    s.state.salvage.tier = 3;
    s.state.salvage.keepers.moss = { step: 'request1' };
    s.state.salvage.keepers.tock = { step: 'request1' };
    s.state.salvage.recipes = ['wormBin', 'fishPond', 'butterflyGarden', 'batBox'];
    for (const [k, v] of Object.entries({ scrap: 40, timber: 40, seeds: 30, biomass: 10, clay: 20, gears: 10, food: 6, compost: 3 })) s.inventory.add(k, v);
    return { at: [bx, bz], open };
  });
  check(lay.open.length >= 24, `restored a patch of ${lay.open.length} open tiles beside bloombot`);
  const spots = lay.open;

  // ── E23.5.1: gather clippings with a real hold of Interact ──
  const [gx, gz] = spots[0];
  await face(gx, gz);
  check(/Gather clippings/.test(await prompt()), `the prompt offers "Gather clippings" (${await prompt()})`);
  await snap('gather-prompt');
  const before = await game((g, s) => s.inventory.count('biomass'));
  await holdE();
  const after = await game((g, s) => s.inventory.count('biomass'));
  check(after > before, `holding Interact gathers biomass (${before} → ${after})`);
  await snap('gathered');

  // ── E23.5.2: a planter, planted with the real panel ──
  const placed = await game((g, s, spots) => {
    for (const [k, v] of Object.entries({ biomass: 30, seeds: 10, timber: 20, scrap: 20, compost: 3 })) s.inventory.add(k, v);
    const want = ['planter', 'planter', 'compostBin', 'bioDigester', 'beehive', 'orchard', 'mushroomLog', 'birdBox', 'butterflyGarden', 'wormBin'];
    const got = {};
    let i = 2;
    for (const type of want) {
      for (; i < spots.length; i += 2) {
        const [x, z] = spots[i];
        const m = s.build.place(type, 'g', x, z);
        if (m) {
          (got[type] ??= []).push({ id: m.id, x, z });
          i += 2;
          break;
        }
      }
    }
    return got;
  }, spots);
  check(!!placed.planter?.length && !!placed.compostBin && !!placed.bioDigester, `built the farm: ${Object.keys(placed).join(', ')}`);
  const p = placed.planter[0];
  await face(p.x, p.z);
  check(/Plant in the planter/.test(await prompt()), `the prompt offers "Plant in the planter" (${await prompt()})`);
  await pressE();
  check(/empty planter/i.test(await panel()), 'Interact opens the planter panel');
  await snap('planter-panel');
  await page.locator('#ocPanel button[data-act=plant][data-arg=radish]').click();
  await page.waitForTimeout(400);
  check((await game((g, s, id) => s.farm.bed(id).crop, p.id)) === 'radish', 'planted a radish from the panel');
  await days(0.2);
  await snap('radish-sprouts');
  await days(0.5);
  await snap('radish-flowering');
  // no water: it wilts and waits
  await game((g, s) => {
    s.water = { isWatered: () => false };
  });
  await page.waitForTimeout(4000); // the crop visuals re-check twice a game second; frames are slow under swiftshader
  const wilt = await game((g, s, id) => s.farm.look(s.machine(id)), p.id);
  check(wilt.wilting && !wilt.ripe, 'without water the radish wilts and stops');
  await snap('radish-wilting');
  await game((g, s) => {
    delete s.water;
  });
  await days(0.4);
  check(/Harvest Radish/.test(await prompt()), `ripe: the prompt says "Harvest Radish" (${await prompt()})`);
  await snap('radish-ripe');
  const food0 = await game((g, s) => s.inventory.count('food'));
  await pressE();
  const food1 = await game((g, s) => s.inventory.count('food'));
  check(food1 > food0, `harvesting gives food (${food0} → ${food1})`);
  await snap('radish-harvested');

  // ── E23.5.3: the compost bin and the Bio Digester ──
  const bin = placed.compostBin[0];
  await face(bin.x, bin.z);
  await pressE();
  check(/Compost bin/.test(await panel()), 'Interact opens the compost bin');
  await page.locator('#ocPanel button[data-act=fill][data-arg=biomass]').click();
  await page.locator('#ocPanel button[data-act=fill][data-arg=food]').click();
  await page.waitForTimeout(300);
  await snap('compost-filled-panel');
  await closePanel();
  await snap('compost-heap');
  await days(2);
  await pressE();
  const fert0 = await game((g, s) => s.inventory.count('fertiliser'));
  await page.locator('#ocPanel button[data-act=take][data-arg=fertiliser]').click();
  await page.waitForTimeout(300);
  const fert1 = await game((g, s) => s.inventory.count('fertiliser'));
  check(fert1 > fert0, `two days later the bin gives fertiliser (${fert0} → ${fert1})`);
  await closePanel();
  await snap('compost-fertiliser');
  const dig = placed.bioDigester[0];
  await face(dig.x, dig.z);
  await game((g, s) => s.inventory.add('biomass', 20));
  await pressE();
  await page.locator('#ocPanel button[data-act=feed]').click();
  await page.waitForTimeout(300);
  check(/Fed|Running/.test(await panel()), `the digester takes biomass (${await panel()})`);
  await snap('digester-panel');
  await closePanel();
  await snap('digester');

  // ── E23.5.4: hives, fruit, mushrooms, homes ──
  await days(3.2);
  if (placed.beehive) {
    await face(placed.beehive[0].x, placed.beehive[0].z);
    check(/Harvest the Beehive/.test(await prompt()), `bees settled by the flowers and made honey (${await prompt()})`);
    await snap('beehive');
    await pressE();
    await page.locator('#ocPanel button[data-act=honey]').click();
    await page.waitForTimeout(300);
    check((await game((g, s) => s.inventory.count('honey'))) > 0, 'took honey from the hive');
    await closePanel();
  }
  if (placed.orchard) {
    await face(placed.orchard[0].x, placed.orchard[0].z);
    check(/Harvest the Fruit Tree/.test(await prompt()), `the fruit tree has fruit (${await prompt()})`);
    await snap('fruit-tree');
  }
  if (placed.mushroomLog) {
    const log = placed.mushroomLog[0];
    await face(log.x, log.z);
    await pressE();
    await page.locator('#ocPanel button[data-act=inoculate]').click().catch(() => {});
    await closePanel();
    await game((g, s) => {
      s.state.salvage.weather = { kind: 'mist', until: 1e9 };
    });
    await days(0.6);
    await snap('mushroom-log');
  }
  if (placed.butterflyGarden) {
    await face(placed.butterflyGarden[0].x, placed.butterflyGarden[0].z);
    const occ = await game((g, s, id) => s.farmExtras.occupied(s.machine(id)), placed.butterflyGarden[0].id);
    check(occ, 'butterflies moved into the butterfly garden');
    await snap('butterfly-garden');
  }
  if (placed.birdBox) {
    await face(placed.birdBox[0].x, placed.birdBox[0].z);
    await pressE();
    await snap('bird-box-panel');
    await closePanel();
  }

  // ── E23.5.4.6: a Keeper garden ──
  const garden = await game((g, s) => {
    const k = s.keepers.def('tide');
    s.state.salvage.keepers.tide = { step: 'request1' };
    for (let r = 1; r <= 4; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          const x = k.x + dx;
          const z = k.z + dz;
          const t = s.grid.get('g', x, z);
          if (!t || t.blocked || t.occupantId || t.feature === 'water') continue;
          s.restoration.complete(t, 'pulse');
          s.inventory.add('scrap', 6);
          s.inventory.add('biomass', 4);
          const m = s.build.place('planter', 'g', x, z);
          if (m) return { id: m.id, x, z, keeper: s.farmExtras.gardenOf(m) };
        }
    return undefined;
  });
  check(garden?.keeper === 'tide', 'a planter beside Tide is Tide’s garden');
  if (garden) {
    await face(garden.x, garden.z);
    await snap('keeper-asks');
    await pressE();
    check(/Tide's garden/.test(await panel()), `the planter panel shows Tide’s request (${(await panel()).slice(0, 80)})`);
    await snap('keeper-garden-panel');
    await page.locator('#ocPanel button[data-act=plant][data-arg=seaKale]').click().catch(async () => {
      await game((g, s, id) => {
        (s.state.salvage.crops ??= []).push('seaKale');
        s.inventory.add('seeds', 1);
        s.farm.plant(s.machine(id), 'seaKale');
      }, garden.id);
    });
    await closePanel();
    if (!(await game((g, s, id) => s.farm.bed(id).crop, garden.id))) {
      await game((g, s, id) => {
        (s.state.salvage.crops ??= []).push('seaKale');
        s.inventory.add('seeds', 1);
        s.farm.plant(s.machine(id), 'seaKale');
      }, garden.id);
    }
    await days(4);
    await pressE();
    await page.waitForTimeout(500);
    check(await game((g, s) => s.farm.knows('watercress')), 'growing sea kale for Tide gives watercress seeds');
    await snap('keeper-thanks');
  }
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} catch (e) {
  failures.push(String(e));
  console.error(e);
  await page.screenshot({ path: `${out}/zz-error.png`, timeout: 180_000 }).catch(() => {});
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failures.length ? `\n${failures.length} failed:\n- ${failures.join('\n- ')}` : '\nall farm checks passed');
process.exit(failures.length ? 1 : 0);
