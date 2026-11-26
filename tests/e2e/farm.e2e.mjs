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
const server = await preview({ preview: { port: 4254, strictPort: true }, logLevel: 'silent' });
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
  const path = `${out}/${String(++shot).padStart(2, '0')}-${name}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 80, timeout: 180_000 }); // swiftshader on a busy machine is slow
  console.log(`  📷 ${path}`);
};
/** Runs a function in the page with the game (`g`) and sim (`s`) in scope. */
const game = (fn, arg) => page.evaluate(({ src, arg }) => new Function('g', 's', 'arg', `return (${src})(g, s, arg)`)(window.solarbloom, window.solarbloom.sim, arg), { src: fn.toString(), arg });
const prompt = () => page.evaluate(() => document.querySelector('#prompt, .prompt')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
/** #571: the prompt as the next drawn frame leaves it. The game sets it once a frame, and frames can stall for 15 s
 * here (software rendering on a busy machine), so a plain read can still show the last target's prompt. */
const framePrompt = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(document.querySelector('#prompt, .prompt')?.innerText.replace(/\s+/g, ' ').trim() ?? '')))));
/** The prompt once a drawn frame shows it matching: waits up to 60 s, then gives whatever is shown. */
const promptFor = async (re, reface) => {
  const until = Date.now() + 60000;
  for (let k = 0; Date.now() < until; k++) {
    const t = await framePrompt();
    if (re.test(t)) return t;
    // something early in a fresh game can still turn bloombot: stand it on its spot facing the target again
    if (reface && k % 4 === 3) await reface();
    await page.waitForTimeout(500);
  }
  return prompt();
};
const panel = () => page.evaluate(() => (document.querySelector('#ocPanel.open') ? document.querySelector('#ocPanel')?.innerText.replace(/\s+/g, ' ').trim() : ''));
/** #571: the open panel's text once it matches (it opens on a later drawn frame): waits up to 10 s. */
const panelFor = async (re) => {
  for (let k = 0; k < 20; k++) {
    const t = await panel();
    if (re.test(t)) return t;
    await page.waitForTimeout(500);
  }
  return panel();
};
const pressE = async () => {
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);
};
const closePanel = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};
/** Stands bloombot on a tile facing a neighbouring one (a machine or ground), and waits for the prompt to settle. */
const face = async (x, z, tries = 3) => {
  const ok = await game(
    (g, s, { x, z }) => {
      for (const [dx, dz, facing] of [[0, 1, Math.PI], [0, -1, 0], [1, 0, -Math.PI / 2], [-1, 0, Math.PI / 2]]) {
        const t = s.grid.get('g', x + dx, z + dz);
        if (!t || t.blocked || t.occupantId || t.feature === 'water') continue;
        g.bot.pose.x = x + dx + 0.5;
        g.bot.pose.z = z + dz + 0.5;
        g.bot.pose.facing = facing;
        g.bot.walk = undefined; // a click that fell through a closing panel would walk it off the spot
        return true;
      }
      return false;
    },
    { x, z },
  );
  await page.waitForTimeout(900);
  // something early in a fresh game (the opening walk) can still move bloombot: set it again until it stays put
  const f = ok && (await game((g) => g.bot.front()));
  if (ok && (f.x !== x || f.z !== z) && tries > 0) {
    console.log(`  (bloombot moved off its spot, facing ${f.x},${f.z}; setting it again)`);
    return face(x, z, tries - 1);
  }
  return ok;
};
/** Moves the game clock on to the next mid-morning, so a shot is in daylight (the farm itself is not ticked). */
const morning = () =>
  game((g, s) => {
    const t = s.state.time;
    const f = s.clock.gameDayFraction();
    s.state.time = t + ((((0.3 - f) % 1) + 1) % 1) * 2880;
  });
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
  await page.goto('http://localhost:4254/?slot=1&new=1', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 900_000 });
  await page.waitForTimeout(2000);
  check(errors.length === 0, 'the game loads without errors');
  await game((g, s) => s.pulseLoad.introduced()); // seen in an earlier session: no introduction mid-test

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
          if (t && !t.blocked && !t.occupantId && t.feature !== 'water' && (t.level ?? 0) === level && ![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([ex, ez]) => s.salvage.pileAt(bx + dx + ex, bz + dz + ez))) open.push([bx + dx, bz + dz]);
        }
    for (const [x, z] of open) {
      const t = s.grid.get('g', x, z);
      s.restoration.complete(t, 'pulse');
      t.bloom = 2;
      s.grid.touch(t);
    }
    s.state.salvage.tier = 3;
    // the Keepers whose crafting-table recipes the farm uses: Tide (planters, bird box), Moss (hive, fruit tree),
    // Tock (digester), Fern (mushroom log)
    for (const id of ['tide', 'moss', 'tock', 'fern']) s.state.salvage.keepers[id] = { step: 'request1' };
    s.state.salvage.recipes = ['wormBin', 'fishPond', 'butterflyGarden', 'batBox'];
    for (const [k, v] of Object.entries({ scrap: 40, timber: 40, seeds: 30, biomass: 10, clay: 20, gears: 10, food: 6, compost: 3 })) s.inventory.add(k, v);
    return { at: [bx, bz], open };
  });
  // the load wheel's one-time introduction was seen already (it would sit over every shot)
  await game((g) => {
    g.hud.loadWheel.shown = 0;
  });
  check(lay.open.length >= 24, `restored a patch of ${lay.open.length} open tiles beside bloombot`);
  const spots = lay.open;

  // ── E23.5.1: gather clippings with a real hold of Interact ──
  // #571: Interact acts on what is right in front first (#581): gather where no salvage pile (the jetty's crate) is near
  // bloombot's spot, so a turn on the spot can't put a pile in front of it
  const clear = await game((g, s, { spots }) => spots.findIndex(([x, z]) => {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (s.salvage.pileAt(x + dx, z + dz)) return false;
    return true;
  }), { spots });
  const [gx, gz] = spots[Math.max(0, clear)];
  await face(gx, gz);
  check(/Gather Greens/.test(await promptFor(/Gather Greens/, () => face(gx, gz, 1))), `the prompt offers "Gather Greens" (${await prompt()})`);
  await snap('gather-prompt');
  const before = await game((g, s) => s.inventory.count('biomass'));
  // held like a player holds it, until the hold completes (slow software-rendered frames stretch it; 8 s at most)
  await page.keyboard.down('KeyE');
  for (let k = 0; k < 16 && (await game((g, s) => s.inventory.count('biomass'))) === before; k++) await page.waitForTimeout(500);
  await page.keyboard.up('KeyE');
  await page.waitForTimeout(400);
  const after = await game((g, s) => s.inventory.count('biomass'));
  check(after > before, `holding Interact gathers biomass (${before} → ${after})`);
  await snap('gathered');

  // ── E23.5.2: a planter, planted with the real panel ──
  const placed = await game((g, s, spots) => {
    for (const [k, v] of Object.entries({ biomass: 30, seeds: 10, planks: 40, scrap: 20, clay: 10, motor: 2, compost: 3 })) s.inventory.add(k, v);
    const want = ['planter', 'planter', 'compostBin', 'bioDigester', 'beehive', 'orchard', 'mushroomLog', 'birdBox', 'butterflyGarden', 'wormBin'];
    const got = {};
    // E23.4.1: the first planter goes by real fresh water (a canal or pond within reach), searching out from bloombot;
    // only the ground round it is restored to set the scene
    const bx = Math.floor(g.bot.pose.x);
    const bz = Math.floor(g.bot.pose.z);
    search: for (let r = 1; r <= 60; r++)
      for (let dx = -r; dx <= r; dx++)
        for (const dz of Math.abs(dx) === r ? [...Array(2 * r + 1).keys()].map((k) => k - r) : [-r, r]) {
          const t = s.grid.get('g', bx + dx, bz + dz);
          if (!t || t.blocked || t.occupantId || t.feature === 'water' || s.salvage.pileAt(t.x, t.z)) continue;
          const b = s.water.bodyNear(t);
          if (!b || s.water.levelOf(b.id) < 0.5) continue;
          for (let ex = -1; ex <= 1; ex++)
            for (let ez = -1; ez <= 1; ez++) {
              const u = s.grid.get('g', t.x + ex, t.z + ez);
              if (u && !u.blocked && u.feature !== 'water' && !u.occupantId) s.restoration.complete(u, 'pulse');
            }
          const m = s.build.place('planter', 'g', t.x, t.z);
          if (m) {
            got.planter = [{ id: m.id, x: t.x, z: t.z }];
            want.shift();
            break search;
          }
        }
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
  check(/Plant in the planter/.test(await promptFor(/Plant in the planter/)), `the prompt offers "Plant in the planter" (${await prompt()})`);
  await pressE();
  check(/empty planter/i.test(await panelFor(/empty planter/i)), 'Interact opens the planter panel');
  await snap('planter-panel');
  await page.locator('#ocPanel button[data-act=plant][data-arg=radish]').click();
  await page.waitForTimeout(400);
  check((await game((g, s, id) => s.farm.bed(id).crop, p.id)) === 'radish', 'planted a radish from the panel');
  await days(0.2);
  await snap('radish-sprouts');
  await days(0.5);
  await snap('radish-flowering');
  // ── E23.4.1: real water. A dry spell, then the canal it drinks from runs dry: it wilts and waits ──
  const drank = await game((g, s, id) => {
    const m = s.machine(id);
    const t = s.grid.get('g', m.x, m.z);
    const b = s.water.bodyNear(t);
    s.weather.forceForTest('sunny', 1e9); // no rain to water it
    return { watered: s.farm.isWatered(m), body: b?.id, level: b ? s.water.levelOf(b.id) : 0 };
  }, p.id);
  check(drank.watered && !!drank.body, `the bed drinks from real water nearby (${drank.body}, level ${drank.level.toFixed(2)})`);
  await game((g, s, b) => void s.water.draw(b, 1e9), drank.body);
  await page.waitForTimeout(4000); // the crop visuals re-check twice a game second; frames are slow under swiftshader
  const wilt = await game((g, s, { id, b }) => ({ ...s.farm.look(s.machine(id)), level: s.water.levelOf(b) }), { id: p.id, b: drank.body });
  check(wilt.wilting && !wilt.ripe && wilt.level < 0.08, `its water run dry (level ${wilt.level.toFixed(2)}), the radish wilts and stops`);
  await days(1); // a whole dry day: it waits, it never dies
  const waited = await game((g, s, id) => ({ crop: s.farm.bed(id).crop, grown: s.farm.bed(id).grown, wilting: s.farm.look(s.machine(id)).wilting }), p.id);
  check(waited.crop === 'radish' && waited.wilting, 'a dry day later it is still there, wilting and waiting');
  await morning();
  await face(p.x, p.z);
  await page.waitForTimeout(3000);
  await snap('radish-wilting'); // drooping by the drained canal
  await pressE();
  check(/water has run low/.test(await panelFor(/water has run low/)), `the panel says its water has run low (${(await panel()).slice(0, 90)})`);
  await snap('radish-wilting-panel');
  await closePanel();
  // the water comes back: it perks up and grows on
  await game((g, s, b) => void s.water.fill(b, 1e9), drank.body);
  await page.waitForTimeout(4000);
  const perked = await game((g, s, id) => s.farm.look(s.machine(id)), p.id);
  check(!perked.wilting && perked.rate > 0, `refilled, it perks up and grows again (rate ${perked.rate.toFixed(2)})`);
  await snap('radish-recovered'); // green again by the full canal
  await days(0.4);
  // grow on until ripe (likes unmet slow it: half rate per unmet like), at most two more days
  for (let k = 0; k < 8 && !(await game((g, s, id) => s.farm.look(s.machine(id)).ripe, p.id)); k++) await days(0.25);
  const lk = await game((g, s, id) => s.farm.look(s.machine(id)), p.id);
  await page.waitForTimeout(1500);
  check(lk.ripe && /Harvest Radish/.test(await promptFor(/Harvest Radish/)), `ripe: the prompt says "Harvest Radish" (${await prompt()}; progress ${lk.progress.toFixed(2)}, rate ${lk.rate.toFixed(2)})`);
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
  const binPanel = await panelFor(/Compost bin/i); // the HUD reskin's card title is "Compost Bin"
  check(/Compost bin/i.test(binPanel), `Interact opens the compost bin (${binPanel.slice(0, 60)})`);
  // food first (the bin holds 30 parts, and the backpack's biomass alone would fill it)
  await page.locator('#ocPanel button[data-act=fill][data-arg=food]').click();
  await page.waitForTimeout(300);
  await page.locator('#ocPanel button[data-act=fill][data-arg=biomass]').click();
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
  check(/Fed|Running/.test(await panelFor(/Fed|Running/)), `the digester takes biomass (${await panel()})`);
  await snap('digester-panel');
  await closePanel();
  await snap('digester');

  // ── E23.5.4: hives, fruit, mushrooms, homes ──
  await days(3.2);
  if (placed.beehive) {
    await face(placed.beehive[0].x, placed.beehive[0].z);
    check(/Harvest the Beehive/.test(await promptFor(/Harvest the Beehive/)), `bees settled by the flowers and made honey (${await prompt()})`);
    await snap('beehive');
    await pressE();
    await page.locator('#ocPanel button[data-act=honey]').click();
    await page.waitForTimeout(300);
    check((await game((g, s) => s.inventory.count('honey'))) > 0, 'took honey from the hive');
    await closePanel();
  }
  if (placed.orchard) {
    await face(placed.orchard[0].x, placed.orchard[0].z);
    check(/Pick the ripe fruit/.test(await promptFor(/Pick the ripe fruit/)), `the fruit tree has ripe fruit (${await prompt()})`);
    await snap('fruit-tree');
  }
  if (placed.mushroomLog) {
    const log = placed.mushroomLog[0];
    await face(log.x, log.z);
    await pressE();
    await page.locator('#ocPanel button[data-act=inoculate]').click().catch(() => {});
    await closePanel();
    await game((g, s) => {
      s.weather.forceForTest('fog', 1e9);
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

  // ── E23.5.4.6: a Keeper garden, watered by the rock pool beside Tide ──
  const pool = await game((g, s) => {
    const q = { x: 7, z: 16, w: 2, d: 3 }; // Saltwind's `ponds` in data/oldcity (tests/farm-extras checks every Keeper's)
    const tiles = [];
    for (let x = q.x; x < q.x + q.w; x++) for (let z = q.z; z < q.z + q.d; z++) tiles.push(s.grid.get('g', x, z));
    return { x: q.x + q.w - 1, z: q.z + 1, silted: tiles.every((t) => t.feature === 'water' && !t.blocked && t.ground !== 'restored' && !s.water.isFresh(t)), ids: tiles.map((t) => [t.x, t.z]) };
  });
  check(pool.silted, 'a silted rock pool lies beside Tide, dead until restored');
  await morning();
  await face(pool.x, pool.z);
  await page.waitForTimeout(2000);
  await snap('tide-pool-silted');
  // bloombot restores it: fresh water again
  await game((g, s, ids) => {
    for (const [x, z] of ids) s.restoration.complete(s.grid.get('g', x, z), 'pulse');
  }, pool.ids);
  const filled = await game((g, s, ids) => {
    const b = s.water.bodyAt(s.grid.get('g', ids[0][0], ids[0][1]));
    return b ? s.water.levelOf(b.id) : -1;
  }, pool.ids);
  check(filled > 0.5, `restored, the rock pool is fresh water (level ${filled.toFixed(2)})`);
  await page.waitForTimeout(3000);
  await snap('tide-pool-restored');
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
          if (!s.water.isWatered(t)) continue; // a spot the rock pool's water reaches
          s.inventory.add('planks', 3); // the Planter box's table recipe
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
    check(/Tide's garden/.test(await panelFor(/Tide's garden/)), `the planter panel shows Tide’s request (${(await panel()).slice(0, 80)})`);
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
    // a dry spell: the rock pool waters Tide's garden
    await game((g, s) => void s.weather.forceForTest('sunny', 1e9));
    check(await game((g, s, id) => !s.farm.look(s.machine(id)).wilting, garden.id), 'Tide’s garden drinks from the rock pool, no rain needed');
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
