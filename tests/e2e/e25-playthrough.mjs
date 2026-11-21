// E25 (#630) whole-epic playthrough check, as a first-time player would meet it. Not a pass/fail test: it plays a
// fresh save and a late save, shoots each moment, and writes every line the player reads (toasts, prompts, Keeper
// bubbles, the Bloombot page) to texts.json, plus measures (hold times, charge, lucky finds) to measures.json.
//   GPU=1 npm run play:e25   (or: npx vite build && GPU=1 node tests/e2e/e25-playthrough.mjs [outDir])
// A tool for a release check, not part of the quick suite or CI. It takes a few minutes.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/e25-playthrough';
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 4291);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const texts = [];
const measures = {};
const notes = [];
const note = (s) => {
  notes.push(s);
  console.log(`  ! ${s}`);
};

/** Hooks every toast, bubble and prompt the player sees into window.__seen. */
async function listen(page) {
  await page.evaluate(() => {
    const g = window.solarbloom;
    window.__seen = [];
    const was = g.hud.toast.bind(g.hud);
    g.hud.toast = (html, kind, secs) => {
      window.__seen.push({ kind: 'toast', text: html });
      return was(html, kind, secs);
    };
    g.sim.bus.on('keeper.said', (e) => window.__seen.push({ kind: 'bubble', keeper: e.keeperId, text: [...e.lines, ...(e.then ?? [])].join(' / ') }));
    g.sim.bus.on('action.failed', (e) => window.__seen.push({ kind: 'failed', text: e.reason }));
    let last = '';
    setInterval(() => {
      const p = document.querySelector('#prompt')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (p && p !== last) window.__seen.push({ kind: 'prompt', text: p });
      last = p;
      const o = document.querySelector('#obj')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (o && o !== window.__lastObj) window.__seen.push({ kind: 'goal', text: o });
      window.__lastObj = o;
    }, 200);
  });
}
async function harvest(page, where) {
  const seen = await page.evaluate(() => window.__seen.splice(0));
  for (const s of seen) texts.push({ where, ...s });
}
/** Every row of the Bloombot page with its detail, read by focusing each row. */
async function pageTexts(page, where) {
  const rows = await page.evaluate(() => {
    const out = [];
    for (const r of document.querySelectorAll('#bpScreen .bb-row')) {
      r.focus();
      out.push({ row: r.textContent.replace(/\s+/g, ' ').trim(), detail: document.querySelector('#bpScreen .bb-detail')?.textContent.replace(/\s+/g, ' ').trim() ?? '' });
    }
    return out;
  });
  for (const r of rows) texts.push({ where, kind: 'page', text: `${r.row} || ${r.detail}` });
  return rows;
}
const sky = (page, f) =>
  page.evaluate((f) => {
    const s = window.solarbloom.sim;
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
    s.lights.dark = s.power.sky().dark;
  }, f);
const stand = async (page, x, z, facing, wait = 1800) => {
  await page.evaluate(({ x, z, facing }) => {
    const g = window.solarbloom;
    g.bot.teleport('g', x, z);
    Object.assign(g.bot.pose, { x, z, facing });
    g.camera.turnTo((facing * 180) / Math.PI + 180, true);
  }, { x, z, facing });
  await page.waitForTimeout(wait);
};
const prompt = (page) => page.evaluate(() => document.querySelector('#prompt')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
/** Puts Bloombot beside the nearest salvage pile to (x, z), facing it. */
const besidePile = (page, x0, z0) =>
  page.evaluate(({ x0, z0 }) => {
    const g = window.solarbloom;
    for (let r = 0; r < 20; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          const x = x0 + dx;
          const z = z0 + dz;
          const pile = g.sim.salvage.pileAt(x, z);
          if (!pile || g.sim.salvage.left(pile.id) < 3) continue;
          for (const [ox, oz, facing] of [[0, 1, Math.PI], [0, -1, 0], [1, 0, -Math.PI / 2], [-1, 0, Math.PI / 2]]) {
            if (!g.bot.walker.walkable('g', x + ox, z + oz)) continue;
            g.bot.teleport('g', x + ox + 0.5, z + oz + 0.5);
            Object.assign(g.bot.pose, { roofId: 'g', x: x + ox + 0.5, z: z + oz + 0.5, facing });
            g.camera.turnTo((facing * 180) / Math.PI + 180, true);
            return { pile: pile.id, material: pile.material };
          }
        }
    return undefined;
  }, { x0, z0 });
/** Holds Interact until something is salvaged (or 8 s), returning seconds held and what Bloombot acted out. */
async function holdE(page, shotPath, until) {
  await page.evaluate(() => {
    window.__done = 0;
    window.__acts = [];
    const s = window.solarbloom.sim;
    for (const ev of ['pile.salvaged', 'biomass.gathered', 'gate.opened', 'cache.opened']) s.bus.on(ev, () => (window.__done ||= performance.now()));
  });
  const t0 = await page.evaluate(() => performance.now());
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(450);
  const acting = await page.evaluate(() => window.solarbloom.bot.visuals.acting ?? null);
  if (shotPath) await page.screenshot({ path: shotPath });
  await page.waitForFunction(until ?? (() => window.__done > 0), null, { timeout: 8000 }).catch(() => {});
  const t1 = await page.evaluate(() => window.__done || performance.now());
  await page.keyboard.up('KeyE');
  await page.waitForTimeout(600);
  return { secs: Math.round((t1 - t0) / 10) / 100, acting };
}

try {
  // ═══════════ A. a fresh save, on the Deck at 150% ═══════════
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.setDefaultTimeout(240_000);
    await startGame(page, `http://localhost:${port}`, { slot: 1, query: 'gfx=deck', settings: { uiScale: 150 } });
    await listen(page);
    await sky(page, 0.32);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${dir}/a01-start.png` });
    await harvest(page, 'fresh start');

    // the Bloombot page, before anything: Tab, then E onto its tab
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/a02-page-fresh.png` });
    await pageTexts(page, 'page, fresh');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // greening the park: each milestone as it comes (pulses by hand would take an hour; the sim greens tiles the way a
    // pulse does, and the game's own tick grants the milestone)
    for (const [n, tag] of [[20, 'a03'], [40, 'a04'], [60, 'a05']]) {
      await page.evaluate((n) => {
        const s = window.solarbloom.sim;
        const park = 'park';
        let have = s.areas.counts(park).restored;
        for (const t of s.areas.tiles(park)) {
          if (have >= n) break;
          if (t.ground === 'restored' || !s.restoration.checkPulse(t).ok) continue;
          t.ground = 'restored';
          t.pollution = 0;
          t.bloom = 1;
          s.grid.touch(t);
          have++;
        }
      }, n);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${dir}/${tag}-park-${n}.png` });
      // #662: toasts that came together wait their turn; a shot as each comes up
      for (const k of [1, 2]) {
        if (!(await page.evaluate(() => window.solarbloom.hud.toasts?.waiting?.().length ?? 0))) break;
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${dir}/${tag}-park-${n}-then-${k}.png` });
      }
      await harvest(page, `park ${n}`);
    }
    measures.parkStep = await page.evaluate(() => window.solarbloom.sim.parkGrowth.step);

    // Spreading pulse, for real: a pulse on dry ground beside Bloombot
    const spread = await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      const t = s.areas.tiles('park').find((t) => t.ground !== 'restored' && s.restoration.checkPulse(t).ok && s.restoration.spillTiles(t).length);
      if (!t) return null;
      g.bot.teleport('g', t.x + 0.5, t.z + 2.5);
      let extra = [];
      s.bus.on('pulse.fired', (e) => (extra = e.extra));
      s.restoration.pulse(t.id);
      return extra.length;
    });
    measures.spreadExtra = spread;
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${dir}/a06-spreading-pulse.png` });

    // a hold, with Nimble hands: salvage a park pile by holding E
    const pile = await besidePile(page, 8, 24);
    await page.evaluate(() => window.solarbloom.camera.zoomTo?.(1.9));
    await page.waitForTimeout(1600);
    if (pile) measures.salvageHoldNimble = await holdE(page, `${dir}/a07-hold-salvage.png`);
    await harvest(page, 'fresh, after the park');

    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/a08-page-park-grown.png` });
    await pageTexts(page, 'page, park grown');
    if (errors.length) note(`fresh: page errors: ${errors.join(' | ')}`);
    await page.close();
  }

  // ═══════════ B. a late save: the city open, the workshop busy ═══════════
  for (const [w, h, scale, label] of [
    [1280, 800, 150, 'deck150'],
    [1280, 800, 100, '1280x800'],
  ]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.setDefaultTimeout(240_000);
    await startGame(page, `http://localhost:${port}`, { slot: 2, query: scale === 150 ? 'gfx=deck' : '', settings: { uiScale: scale } });
    await listen(page);
    await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      const sv = s.state.salvage;
      s.pulseLoad.introduced();
      sv.tier = 4;
      for (const a of ['pry', 'hover', 'climb', 'glide']) if (!sv.abilities.includes(a)) sv.abilities.push(a);
      for (const r of ['mastRow', 'oldMarket', 'saltwind', 'elderGrove', 'cistern', 'clockPlaza', 'terraces', 'glasshouse', 'observatory', 'spireHeights']) s.gates.openRegion(r);
      for (const [x, z] of [[22, 47], [29, 21], [24, -10], [8, 48], [8, 55], [22, 54], [-8, 27]]) {
        const id = s.areas.map.areaOfCell(x, z);
        if (s.areas.fog(id) === 'hidden') s.gates.openRegion(id);
      }
      s.areas.clear('park', true);
      sv.keepers.pylon = { step: 'request1' };
      sv.keepers.moss = { step: 'settled' };
      sv.research ??= { analysed: [], done: [], running: [], levels: {} };
      sv.research.done.push('rb-cells', 'rb-efficiency', 'rb-sprint', 'rb-pulse', 'rb-backpack', 'rb-hands', 'rb-eye', 'rb-soak', 'rb-lantern', 'rb-lucky');
      Object.assign(sv.research.levels, { chargeCells: 3, chargeEfficiency: 2, sprint: 1, pulseRadius: 2, backpack: 3 });
      for (const [m, n] of [['gears', 60], ['scrap', 60], ['wire', 30], ['copper', 40], ['glassPane', 30], ['sunstone', 40], ['seeds', 80], ['batteryCell', 8], ['sunCell', 12], ['motor', 10]]) s.inventory.add(m, n);
      g.updateCityBounds?.();
    });
    await sky(page, 0.34);
    await page.waitForTimeout(2500);
    await harvest(page, `${label} late setup`);

    // ── the crafting table: Bigger charge to level 4 and 5, then each new upgrade's first level, by clicking ──
    await page.evaluate(() => {
      const g = window.solarbloom;
      const [hx, hz] = [g.sim.state.bot?.x ?? 0, g.sim.state.bot?.z ?? 0];
      g.hud.craft.open();
      g.hud.craft.show('upgrade');
      return [hx, hz];
    });
    await page.waitForTimeout(700);
    const clickUp = async (id) => {
      const b = await page.$(`#cr-up-${id}`);
      if (!b) return note(`${label}: no upgrade button for ${id}`);
      await b.scrollIntoViewIfNeeded();
      const dis = await b.getAttribute('aria-disabled');
      const off = await b.isDisabled();
      const lab = await b.getAttribute('aria-label');
      if (off || dis === 'true') {
        texts.push({ where: `${label} table button`, kind: 'button', text: `${id}: ${lab} (${off ? 'disabled' : 'aria-disabled'})` });
        const why = await page.evaluate(() => document.querySelector('#craftScreen .pn-detail, #craftScreen [role=status]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
        if (why) texts.push({ where: `${label} table, why`, kind: 'table', text: why });
        return off ? 'off' : dis;
      }
      await b.click({ timeout: 3000 });
      await page.waitForTimeout(400);
      return dis;
    };
    await page.$('#cr-up-chargeCells').then((b) => b?.scrollIntoViewIfNeeded());
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/b01-${label}-table-before.png` });
    for (const id of ['chargeCells', 'chargeCells', 'quickHands', 'quickHands', 'quickHands', 'keenEye', 'keenEye', 'keenEye', 'sunSoak', 'sunSoak', 'sunSoak', 'lantern', 'lantern', 'luckyPulse', 'luckyPulse', 'luckyPulse']) {
      const dis = await clickUp(id);
      if (dis === 'true' || dis === 'off') note(`${label}: ${id} could not be made (${dis})`);
    }
    measures[`${label}.levels`] = await page.evaluate(() => ({ ...window.solarbloom.sim.state.salvage.research.levels }));
    await page.$('#cr-up-quickHands').then((b) => b?.scrollIntoViewIfNeeded());
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/b02-${label}-table-after.png` });
    const tableText = await page.evaluate(() => document.querySelector('#craftScreen')?.innerText.replace(/\s+/g, ' ') ?? '');
    texts.push({ where: `${label} crafting table`, kind: 'table', text: tableText });
    await page.evaluate(() => window.solarbloom.hud.craft.close());
    await page.waitForTimeout(500);
    await harvest(page, `${label} upgrades made`);

    if (label === 'deck150') {
      // ── Quick hands (with Nimble hands): how long a dig takes now ──
      const p = await besidePile(page, 8, 24);
      await page.waitForTimeout(1800);
      if (p) measures.salvageHoldQuick3 = await holdE(page, `${dir}/b03-hold-salvage-quick.png`);
      measures.holdSeconds = await page.evaluate(() => ({ salvage: window.solarbloom.sim.upgrades.salvageHold, pry: window.solarbloom.sim.upgrades.pryHold, vault: window.solarbloom.sim.upgrades.vaultHold }));

      // ── Keen eye: a pulse lights up piles from further off ──
      await stand(page, 10.5, 14.5, 0);
      const glint = await page.evaluate(() => {
        const g = window.solarbloom;
        const s = g.sim;
        let targets = 0;
        s.bus.on('pulse.ripple', (e) => (targets = e.targets?.length ?? 0));
        const t = s.grid.get('g', 10, 16);
        if (t && t.ground !== 'restored') s.restoration.pulse(t.id);
        else {
          const d = s.areas.tiles('saltwind').find((x) => x.ground !== 'restored' && s.restoration.checkPulse(x).ok);
          if (d) {
            g.bot.teleport('g', d.x + 0.5, d.z + 1.5);
            s.restoration.pulse(d.id);
          }
        }
        return { targets, reach: s.upgrades.rippleRadius ?? null };
      });
      measures.keenEye = glint;
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${dir}/b04-keen-eye-pulse.png` });

      // ── Sun soak: standing still in open daylight, away from the fountain and the house (whose rest is quicker) ──
      measures.sunSoak = [];
      // day runs 0 to 2/3 of the clock: noon is about 0.33
      for (const [level, f] of [[3, 0.33], [3, 0.12], [3, 0.55], [2, 0.33], [1, 0.33]]) {
        await sky(page, f);
        await stand(page, 10.5, 26.5, Math.PI, 600);
        const m = await page.evaluate(async (level) => {
          const s = window.solarbloom.sim;
          s.state.salvage.research.levels.sunSoak = level;
          s.charge.drainForTest();
          await new Promise((r) => setTimeout(r, 2000)); // stand still long enough to count as still
          const c0 = s.charge.value();
          const real0 = performance.now();
          await new Promise((r) => setTimeout(r, 8000));
          const secs = (performance.now() - real0) / 1000;
          return {
            level,
            atHome: s.charge.atHome(),
            soaking: s.charge.soaking,
            sun: Math.round(s.clock.solarFactor() * 100) / 100,
            ratePerSec: Math.round(s.charge.sunSoakRate() * 1000) / 1000,
            gained8s: Math.round((s.charge.value() - c0) * 100) / 100,
            secs: Math.round(secs * 10) / 10,
            max: s.charge.max,
            fullFromEmptyMin: Math.round((s.charge.max / Math.max(1e-6, s.charge.sunSoakRate())) / 6) / 10,
            dayFraction: Math.round(s.clock.dayFraction() * 100) / 100,
          };
        }, level);
        measures.sunSoak.push(m);
      }
      await sky(page, 0.33);
      await page.screenshot({ path: `${dir}/b05-sun-soak.png` });
      await sky(page, 0.34);

      // ── Lucky pulse: 60 pulses on bare ground, what turns up ──
      measures.lucky = await page.evaluate(() => {
        const s = window.solarbloom.sim;
        const found = [];
        s.bus.on('pulse.lucky', (e) => found.push(e));
        const before = { seeds: s.inventory.count('seeds'), scrap: s.inventory.count('scrap') };
        let n = 0;
        for (const area of ['saltwind', 'mastRow', 'oldMarket', 'elderGrove']) {
          for (const t of s.areas.tiles(area)) {
            if (n >= 60) break;
            if (t.ground === 'restored' || !s.restoration.checkPulse(t).ok) continue;
            s.charge.sleep();
            if (s.restoration.pulse(t.id)) n++;
          }
        }
        return { pulses: n, events: found.length, seeds: s.inventory.count('seeds') - before.seeds, scrap: s.inventory.count('scrap') - before.scrap, chance: s.upgrades.luckyChance };
      });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${dir}/b06-lucky-after.png` });
      await harvest(page, 'new upgrades in use');

      // ── Lantern: night, with it ──
      await stand(page, 2.5, 6.5, Math.PI);
      await sky(page, 0.86);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${dir}/b07-lantern-night.png` });
      await sky(page, 0.34);

      // ── a knack: wake Tide by hand (pulse it, carry 5 of anything, press E) ──
      await stand(page, 10.5, 18.5, 0); // the cell in front is Tide's
      await page.evaluate(() => {
        const s = window.solarbloom.sim;
        s.keepers.pulse('tide');
        s.inventory.add('scrap', 5);
      });
      await page.waitForTimeout(800);
      const p1 = await prompt(page);
      texts.push({ where: 'by sleeping Tide', kind: 'prompt', text: p1 });
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${dir}/b08-tide-wakes.png` });
      await page.waitForTimeout(6000);
      await page.screenshot({ path: `${dir}/b09-tide-knack.png` });
      // #662: the knack's toast comes once Tide has finished talking, not under its bubble
      await page.waitForFunction(() => !document.querySelector('.oc-bubble:not([hidden])'), null, { timeout: 30_000 }).catch(() => note('Tide still talking after 30 s'));
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${dir}/b09b-tide-knack-toast.png` });
      measures.tideWoke = await page.evaluate(() => window.solarbloom.sim.keepers.step('tide'));
      await harvest(page, 'waking Tide');

      // ── the Stronger moves (level II), each for real with E ──
      const level2 = (a) =>
        page.evaluate((a) => {
          const s = window.solarbloom.sim;
          const id = s.research.moveProject(a).id;
          if (!s.state.salvage.research.done.includes(id)) s.state.salvage.research.done.push(id);
        }, a);
      const ride = async (name) => {
        const pr = await prompt(page);
        texts.push({ where: name, kind: 'prompt', text: pr });
        await page.keyboard.press('KeyE');
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${dir}/${name}-mid.png` });
        await page.waitForFunction(() => !window.solarbloom.bot.riding, null, { timeout: 15000 }).catch(() => note(`${name}: the trip never ended`));
        await page.waitForTimeout(1400);
        await page.screenshot({ path: `${dir}/${name}-landed.png` });
      };
      await stand(page, 8.5, 48.5, 0);
      texts.push({ where: 'jetty end, no Hover II', kind: 'prompt', text: await prompt(page) });
      await page.screenshot({ path: `${dir}/b10-hover-before.png` });
      await level2('hover');
      await page.waitForTimeout(400);
      await ride('b11-hover-sandbar');
      await stand(page, 22.5, 47.5, 0);
      await level2('climb');
      await level2('glide');
      await page.waitForTimeout(400);
      await ride('b12-glide-pier');
      await stand(page, 29.5, 21.5, Math.PI / 2);
      await ride('b13-climb-roof');
      await stand(page, 24.5, -9.5, Math.PI);
      texts.push({ where: 'vault, no Pry II', kind: 'prompt', text: await prompt(page) });
      await level2('pry');
      await page.waitForTimeout(400);
      measures.vaultHold = await holdE(page, `${dir}/b14-hold-pry-vault.png`, () => window.__done > 0 || !document.querySelector('#prompt')?.textContent?.includes('vault'));
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${dir}/b15-vault-open.png` });
      await harvest(page, 'stronger moves');

      // ── the third hold: gathering Greens ──
      const gat = await page.evaluate(() => {
        const g = window.solarbloom;
        const s = g.sim;
        for (const t of s.areas.tiles('park')) {
          if (!s.gather.canGather(t)) continue;
          if (t.bloom < 2) continue;
          for (const [ox, oz, f] of [[0, 1, Math.PI], [0, -1, 0], [1, 0, -Math.PI / 2], [-1, 0, Math.PI / 2]])
            if (g.bot.walker.walkable('g', t.x + ox, t.z + oz)) {
              g.bot.teleport('g', t.x + ox + 0.5, t.z + oz + 0.5);
              Object.assign(g.bot.pose, { x: t.x + ox + 0.5, z: t.z + oz + 0.5, facing: f });
              g.camera.turnTo((f * 180) / Math.PI + 180, true);
              return t.id;
            }
        }
        // none flowered yet: bloom one
        const t = s.areas.tiles('park').find((x) => x.ground === 'restored' && !x.occupantId && !x.blocked);
        t.bloom = 4;
        s.grid.touch(t);
        g.bot.teleport('g', t.x + 0.5, t.z + 1.5);
        Object.assign(g.bot.pose, { facing: Math.PI });
        return t.id;
      });
      await page.waitForTimeout(1800);
      texts.push({ where: 'by Greens', kind: 'prompt', text: await prompt(page) });
      measures.gatherHold = await holdE(page, `${dir}/b16-hold-gather.png`);
      measures.gatherTile = gat;
      await harvest(page, 'holds');
    }

    // ── the Bloombot page, every group, with its view of Bloombot ──
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/c01-${label}-page-top.png` });
    const rows = await pageTexts(page, `page late ${label}`);
    measures[`${label}.pageRows`] = rows.length;
    for (const id of ['bb-quickHands', 'bb-luckyPulse', 'bb-knack-tide', 'bb-knack-sluice', 'bb-spill']) {
      const el = await page.$(`#${id}`);
      if (!el) {
        note(`${label}: no page row #${id}`);
        continue;
      }
      await el.focus();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${dir}/c02-${label}-page-${id}.png` });
    }
    // the moves' second levels
    const mv = await page.$('#bb-pry2, [id^="bb-"][id$="2"]');
    if (mv) {
      await mv.focus();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${dir}/c03-${label}-page-move2.png` });
    }
    // pad-like: arrows from the top through every row, the focus always in view
    const lost = await page.evaluate(async () => {
      const out = [];
      for (const r of document.querySelectorAll('#bpScreen .bb-row')) {
        r.focus();
        const b = r.getBoundingClientRect();
        const sc = r.closest('.bb-main, .bb-list, [class*=scroll]')?.getBoundingClientRect();
        if (sc && (b.top < sc.top - 2 || b.bottom > sc.bottom + 2)) out.push(r.id);
      }
      return out;
    });
    if (lost.length) note(`${label}: rows out of view when focused: ${lost.join(', ')}`);
    await harvest(page, `${label} page`);
    if (errors.length) note(`${label}: page errors: ${errors.join(' | ')}`);
    await page.close();
  }
} finally {
  writeFileSync(`${dir}/texts.json`, JSON.stringify(texts, null, 1));
  writeFileSync(`${dir}/measures.json`, JSON.stringify({ measures, notes }, null, 1));
  console.log(JSON.stringify({ measures, notes }, null, 1));
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]).catch(() => {});
  server.httpServer.close();
}
