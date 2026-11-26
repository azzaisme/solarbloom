// #782: decorating the house starts at the fountain's first step. In the real game:
//  - a new garden has no gift and the Flower pot is still to be made at the table;
//  - handing the fountain its first delivery (the real "Give all") wakes it, and after the fountain's moment a gold
//    toast gives the first decoration, the Flower pot, saying how to put it down with the player's own key;
//  - the pot is on a free button of the build bar, and the build menu (opened with the player's key) opens on it,
//    under Decorations, free to place;
//  - taken into Bloombot's hands, it goes down on green ground by the house (twice: as many as you like);
//  - the gift is saved: a reload gives nothing again;
//  - an older garden already past the first step (saved before the gift) gets it once on load, and only once.
// Screenshots go to SHOTS_DIR (default docs/review/782). Run after `vite build`.
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame, waitForGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/782';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4248);
const LONG = Number(process.env.E2E_TIMEOUT) || 240_000;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()).join(' | '));
const keyOf = (page, action) => page.evaluate((a) => window.solarbloom.bindings.keys[a].find((k) => !/^Mouse/.test(k)), action);
const press = async (page, code) => page.keyboard.press(code.replace(/^Key/, '').replace(/^Digit/, ''));

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(LONG);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, `http://localhost:${PORT}`, { query: 'gfx=low', settings: { hints: false, noVistas: true } });
  await wait(2000);

  let s = await page.evaluate(() => {
    const g = window.solarbloom;
    return { tier: g.sim.state.salvage.tier, gift: g.sim.state.salvage.decorGift ?? null, made: g.sim.crafting.decorMade('pot'), locked: !!g.hud.buildMenu && g.sim.crafting.decorMade('pot') === false };
  });
  check(s.tier === 0 && s.gift === null && !s.made, `a new garden: no gift yet, the Flower pot still to be made (tier ${s.tier}, gift ${s.gift})`);

  // The park's part of the first step (green ground) is set up directly; the delivery is the real one.
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    let n = 0;
    for (const t of s.areas.tiles('park')) {
      if (n >= 80) break;
      if (t.blocked || t.occupantId || t.feature === 'water') continue;
      t.ground = 'restored';
      t.pollution = 0;
      t.bloom = Math.max(1, t.bloom);
      s.grid.touch(t);
      n++;
    }
    const sv = s.state.salvage;
    sv.pack.scrap = (sv.pack.scrap ?? 0) + 20;
    sv.pack.seeds = (sv.pack.seeds ?? 0) + 6;
    g.chunks.markAll();
  });
  const given = await page.evaluate(() => window.solarbloom.sim.fountain.giveAll());
  check(given > 0, `the fountain takes its first delivery (${given} handed in)`);
  await page.waitForFunction(() => window.solarbloom.sim.state.salvage.tier >= 1, null, { timeout: LONG, polling: 500 });
  check(true, 'the fountain reaches its first step');
  // the fountain's own moment plays first; the gift waits for it
  const during = await page.evaluate(() => ({ cine: window.solarbloom.cinematic, gift: window.solarbloom.sim.state.salvage.decorGift ?? null }));
  console.log('  during the fountain’s moment:', JSON.stringify(during));
  check(!during.cine || during.gift === null, 'no gift while the fountain’s moment is playing');
  await page.waitForFunction(() => !window.solarbloom.cinematic, null, { timeout: LONG, polling: 500 });
  await page.waitForFunction(() => window.solarbloom.sim.state.salvage.decorGift === 'pot', null, { timeout: LONG, polling: 500 });
  check(true, 'the Flower pot is given once the fountain’s moment is over');
  await page.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some((t) => /gift for the house/i.test(t.innerText)), null, { timeout: LONG, polling: 300 });
  const t = await toasts(page);
  const giftToast = t.split(' | ').find((x) => /gift for the house/i.test(x)) ?? '';
  const bmKey = await page.evaluate(() => window.solarbloom.hudKey('buildMenu'));
  console.log(`  toast: "${giftToast}"`);
  check(/Flower pot/.test(giftToast) && /Decorations/.test(giftToast) && /by the house/.test(giftToast), 'the toast says what it is and where to put it');
  check(!/[{}]/.test(giftToast) && giftToast.includes(bmKey.replace(/<[^>]*>/g, '').trim() || '§'), `…and names the player’s own key (${bmKey.replace(/<[^>]*>/g, '')}), no {placeholders}`);
  await page.screenshot({ path: `${dir}/gift-toast.png` });
  // after it, once, the house's own hint: it can be mended now
  const mend = await page
    .waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some((t) => /can be mended now/i.test(t.innerText)), null, { timeout: LONG, polling: 300 })
    .then(() => true)
    .catch(() => false);
  const mt = (await toasts(page)).split(' | ').find((x) => /can be mended now/i.test(x)) ?? '';
  check(mend && !/[{}]/.test(mt) && /press [A-Z]/i.test(mt), `then the house's hint: "${mt}"`);

  s = await page.evaluate(() => {
    const g = window.solarbloom;
    return { slots: g.hud.buildBar.slots(), made: g.sim.crafting.decorMade('pot'), unlocked: g.sim.state.cozy?.decorUnlocked ?? [] };
  });
  check(s.made, 'the Flower pot comes made (free to place)');
  check(s.slots.includes('decor:pot'), `it is on a free button of the build bar (${s.slots.map((x, i) => `${i + 1}:${x || '·'}`).join(' ')})`);
  await wait(1500);
  const after = await toasts(page);
  check(!/New decoration: Flower pot/.test(after), 'no second "New decoration" toast for the same pot');

  // The build menu, opened with the player's key, shows the pot under Decorations
  await press(page, await keyOf(page, 'buildMenu'));
  await page.waitForFunction(() => document.querySelector('#buildMenu')?.classList.contains('open'), null, { timeout: 30_000 });
  await wait(800);
  const menu = await page.evaluate(() => ({
    tab: document.querySelector('#buildMenu [role=tab][aria-selected=true]')?.textContent?.trim(),
    sel: document.querySelector('#buildMenu [data-tool][aria-selected=true], #buildMenu [data-tool].sel, #buildMenu [data-tool][aria-pressed=true]')?.getAttribute('data-tool') ?? null,
    detail: document.querySelector('#bmDetail')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
  }));
  console.log('  menu:', JSON.stringify(menu).slice(0, 240));
  check(menu.tab === 'Decorations', `the build menu opens on Decorations (${menu.tab})`);
  check(/Flower pot/.test(menu.detail) && /Free to place/.test(menu.detail), 'with the Flower pot shown, free to place');
  await page.screenshot({ path: `${dir}/build-menu.png` });
  await page.click('#buildMenu [data-do="take"]');
  await wait(800);
  const inHand = await page.evaluate(() => window.solarbloom.hud.currentTool);
  check(inHand === 'decor:pot', `"Build" puts it in Bloombot's hands (${inHand})`);

  // Put it down by the house: stand near the door, see where the pot's hologram aims (the game's own aim: the view's
  // heading, within reach), make that ground green, and press the key
  const door = await page.evaluate(() => {
    const g = window.solarbloom;
    const t = g.sim.grid.get('g', 4, 5);
    t.ground = 'restored';
    g.sim.grid.touch(t);
    return g.cozy.canDecorate('pot', 'g', 4, 5) ?? '';
  });
  check(/door of the house clear/.test(door), `the house's door stays clear ("${door}")`);
  const placeKey = await keyOf(page, 'pulse');
  const spots = [];
  for (const [sx, sz] of [[2.5, 7.5], [5.5, 7.5]]) {
    // the ground all round the spot green, so wherever the hologram settles is good ground
    await page.evaluate(([x, z]) => {
      const g = window.solarbloom;
      for (let j = -4; j <= 4; j++)
        for (let i = -4; i <= 4; i++) {
          const t = g.sim.grid.get('g', Math.floor(x) + i, Math.floor(z) + j);
          if (!t || t.blocked || t.occupantId || t.feature === 'water') continue;
          t.ground = 'restored';
          t.pollution = 0;
          g.sim.grid.touch(t);
          g.chunks.markTile(t);
        }
      g.bot.teleport('g', x, z);
      g.bot.following = true;
      g.bot.lastInput = 'keys';
      g.pointer.inside = false;
      g.camera.recentre?.();
    }, [sx, sz]);
    await wait(4000);
    const before = await page.evaluate(() => window.solarbloom.cozy.decorations().map((d) => d.key));
    await press(page, placeKey);
    await page.waitForFunction((n) => window.solarbloom.cozy.decorCount() > n, before.length, { timeout: 60_000, polling: 300 }).catch(() => {});
    const added = await page.evaluate((before) => window.solarbloom.cozy.decorations().filter((d) => !before.includes(d.key)).map((d) => [d.x, d.z])[0] ?? null, before);
    if (added) spots.push(added);
    else console.log('  no pot at', sx, sz, await page.evaluate(() => document.querySelector('.fail, #fail, .tip')?.textContent ?? ''));
  }
  const placed = await page.evaluate((spots) => spots.map(([x, z]) => window.solarbloom.cozy.decorAt('g', x, z)?.kind ?? null), spots);
  if (!placed.every((k) => k === 'pot') || spots.length < 2)
    console.log(
      '  why:',
      JSON.stringify(
        await page.evaluate((spots) => {
          const g = window.solarbloom;
          return { tool: g.hud.currentTool, fail: document.querySelector('.fail, #fail, .tip')?.textContent ?? '', each: spots.map(([x, z]) => ({ x, z, can: g.cozy.canDecorate('pot', 'g', x, z) ?? 'ok', why: g.decorProblem?.('pot', 'g', x, z) ?? 'ok' })), bot: g.bot.pose };
        }, spots),
      ),
    );
  check(spots.every(([x, z]) => Math.max(Math.abs(x - 4), Math.abs(z - 5)) <= 4), `both aimed by the house (${JSON.stringify(spots)})`);
  check(spots.length === 2 && placed.every((k) => k === 'pot'), `two Flower pots stand by the house (${placed.join(', ')})`);
  await page.evaluate(([x, z]) => {
    const g = window.solarbloom;
    g.selectTool('inspect');
    g.bot.teleport('g', x + 1.5, z + 2.5);
    g.bot.faceToward(3.5, 3.5);
    g.camera.recentre?.();
  }, spots[0]);
  await wait(3000);
  await page.screenshot({ path: `${dir}/pots-by-the-house.png` });

  // saved: a reload gives nothing again
  await page.evaluate(() => window.solarbloom.saveNow?.());
  await page.goto(`http://localhost:${PORT}/?slot=1&gfx=low`);
  await waitForGame(page);
  await wait(4000);
  s = await page.evaluate(() => ({ gift: window.solarbloom.sim.state.salvage.decorGift, pots: window.solarbloom.cozy.decorations().filter((d) => d.kind === 'pot').length }));
  const t2 = await toasts(page);
  check(s.gift === 'pot' && s.pots === 2 && !/gift for the house/i.test(t2), `after a reload: the gift stays given, the pots stay, no second toast (${s.pots} pots)`);

  // An older garden past the first step, saved before the gift: it gets the gift once on load
  await page.evaluate(() => {
    const g = window.solarbloom;
    const sv = g.sim.state.salvage;
    sv.tier = 2;
    delete sv.decorGift;
    sv.decorMade = (sv.decorMade ?? []).filter((d) => d !== 'pot');
    if (g.sim.state.cozy?.decorUnlocked) g.sim.state.cozy.decorUnlocked = g.sim.state.cozy.decorUnlocked.filter((d) => d !== 'pot');
    for (const d of g.cozy.decorations()) g.cozy.removeDecor(d.roofId, d.x, d.z);
    g.setSetting('hotbar', g.hud.buildBar.slots().map((x) => (x === 'decor:pot' ? '' : x)));
    g.cozyCheckAt = Infinity; // no gift before the save (as an older build saved it)
    g.saveNow?.();
  });
  const saved = await page.evaluate(() => {
    const raw = Object.keys(localStorage).filter((k) => /slot/i.test(k)).map((k) => localStorage.getItem(k) ?? '').join('');
    return { hasGift: /decorGift/.test(raw) };
  });
  console.log('  older save written:', JSON.stringify(saved));
  await page.goto(`http://localhost:${PORT}/?slot=1&gfx=low`);
  await waitForGame(page);
  await page.waitForFunction(() => window.solarbloom.sim.state.salvage.decorGift === 'pot', null, { timeout: LONG, polling: 500 }).catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some((t) => /gift for the house/i.test(t.innerText)), null, { timeout: LONG, polling: 300 }).catch(() => {});
  s = await page.evaluate(() => ({ gift: window.solarbloom.sim.state.salvage.decorGift ?? null, made: window.solarbloom.sim.crafting.decorMade('pot'), tier: window.solarbloom.sim.state.salvage.tier }));
  const t3 = await toasts(page);
  check(s.gift === 'pot' && s.made && /gift for the house/i.test(t3), `an older garden at step ${s.tier} gets the Flower pot on load, with its toast`);
  await page.screenshot({ path: `${dir}/older-save-gift.png` });
  await page.evaluate(() => window.solarbloom.saveNow?.());
  await page.goto(`http://localhost:${PORT}/?slot=1&gfx=low`);
  await waitForGame(page);
  await wait(4000);
  const t4 = await toasts(page);
  check(!/gift for the house/i.test(t4), 'and only once: the next load gives nothing');
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
