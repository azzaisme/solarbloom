// E22.12 (#350): splash → title → new game → play → quit to title → continue, with the keyboard alone and with the
// pad alone, at 1280 × 800. Also: nothing of the 3D world shows before the loading screen fades, the loading bar
// moves through real steps, no model or chunk pops in during the 5 s after the fade (two frames of the paused
// world are compared), a slot can be renamed and deleted (each confirmed), and the title keeps its frame rate.
// Screenshots go to docs/review/ui-title-*.png and ui-loading.png. Run after `vite build` (npm run test:title).
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const PAD = driver + '\ninstallVirtualPad(); window.padDriver = padDriver; window.installVirtualPad = installVirtualPad;';
const URL_ = 'http://localhost:4233/';
const server = await preview({ preview: { port: 4233, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

/**
 * #585: SLOW=<rate> runs the title's hold-to-confirm steps on a CPU slowed that many times (Chromium's throttling),
 * as on a busy machine: the hold counts frames of real time, at most 250 ms each, so a slow page takes longer to fill.
 */
async function slowDown(page) {
  if (!process.env.SLOW) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.SLOW) });
}

/**
 * #585: holds a hold-to-confirm button as a player does, watching the ring: down until `done` is true (at most
 * `ms`), then up. Not a fixed time: the dialog counts frames of real time (at most 250 ms each) and a window blur
 * counts as letting go, so a fixed press on a slow or busy page could end before the ring filled and leave the
 * script waiting on a result that never came. When it doesn't confirm, it prints the dialog as it stands.
 */
async function holdToConfirm(page, down, up, done, ms = 8000) {
  await down();
  const ok = await page.waitForFunction(done, null, { timeout: ms }).then(
    () => true,
    () => false,
  );
  if (!ok) {
    const was = await page.evaluate(() => {
      const g = document.querySelector('.cf-go');
      return { dialog: !!g, ring: g?.querySelector('.cf-ring')?.style.getPropertyValue('--p') || '0', label: g?.textContent ?? '', armed: !!g?.classList.contains('armed'), holding: !!g?.classList.contains('holding'), focus: document.activeElement?.className ?? '', windowFocus: document.hasFocus() };
    });
    console.log(`   the hold didn't confirm in ${ms / 1000} s: ${JSON.stringify(was)}`);
  }
  await up();
  return ok;
}

/** How different two screenshots are: the share of bytes that differ by more than a little (PNG decoded in the page). */
async function frameDiff(page, a, b) {
  return page.evaluate(
    async ([a, b]) => {
      const load = async (b64) => {
        const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(img.width, img.height);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height).data;
      };
      const [x, y] = [await load(a), await load(b)];
      let n = 0;
      for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 36) n++;
      return n / (x.length / 4);
    },
    [a.toString('base64'), b.toString('base64')],
  );
}

async function pressPad(page, b) {
  await page
    .evaluate(async (b) => {
      const frames = (n) => new Promise((r) => (function f(k) { k ? requestAnimationFrame(() => f(k - 1)) : r(); })(n));
      window.__pad.buttons[b].pressed = true;
      window.__pad.buttons[b].value = 1;
      await frames(2);
      window.__pad.buttons[b].pressed = false;
      window.__pad.buttons[b].value = 0;
      await frames(2);
    }, b)
    .catch(() => {}); // the page may leave mid-press
}

/** Moves the focus onto an element: with the d-pad (pad) or the arrow keys (keys), as a player would. */
async function moveTo(page, sel, dev) {
  for (let i = 0; i < 40; i++) {
    const dir = await page.evaluate((sel) => {
      const t = document.querySelector(sel);
      const c = document.activeElement;
      if (!t) return 'missing';
      if (c === t) return 'here';
      if (!c || c === document.body) return 'down';
      const a = c.getBoundingClientRect(), b = t.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      return Math.abs(dy) > 4 ? (dy > 0 ? 'down' : 'up') : dx > 0 ? 'right' : 'left';
    }, sel);
    if (dir === 'here') return true;
    if (dir === 'missing') return false;
    if (dev === 'pad') await pressPad(page, { up: 12, down: 13, left: 14, right: 15 }[dir]);
    else await page.keyboard.press({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[dir]);
    await page.waitForTimeout(40);
  }
  return false;
}
const go = (page, dev) => (dev === 'pad' ? pressPad(page, 0) : page.keyboard.press('Enter'));

try {
  for (const dev of ['keys', 'pad']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (dev === 'pad') await page.addInitScript(PAD);
    const T = (s) => `E22.12 ${dev}: ${s}`;

    // ── cold start: the splash, then the title; no game exists yet, so nothing of the world can show ──
    await page.goto(URL_);
    await page.waitForSelector('#splash');
    check(await page.evaluate(() => !window.solarbloom && !!document.querySelector('#splash .sp-logo')), T('the splash shows the logo, and no world exists behind it'));
    if (dev === 'keys') await page.screenshot({ path: `${dir}/ui-splash.png` });
    await page.waitForSelector('#tPress', { timeout: 6000 });
    check(await page.evaluate(() => !document.querySelector('#splash:not(.gone)')), T('the splash is gone within 2 s (or sooner, on any input)'));
    // the title keeps its frame rate (it draws no 3D)
    const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); (function f() { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(n / 2); })(); }));
    check(fps >= 30, T(`the title holds the Deck preset's 30 frames a second (${fps.toFixed(0)})`));
    if (dev === 'keys') await page.screenshot({ path: `${dir}/ui-title-press.png` });

    // ── "Press any button", then New game on slot 1 ──
    if (dev === 'pad') await pressPad(page, 0);
    else await page.keyboard.press('Space');
    await page.waitForSelector('#tPlay');
    check(await page.evaluate(() => [...document.querySelectorAll('.t-side button')].map((b) => b.id).join() === (document.querySelector('#tQuit') ? 'tPlay,tSettings,tQuit' : 'tPlay,tSettings')), T('the menu is Play and Settings'));
    check(await page.evaluate(() => { const r = document.querySelector('.t-side').getBoundingClientRect(); return Math.abs(r.width - innerWidth / 3) < 2 && r.left === 0; }), T('the panel covers the left third'));
    await page.screenshot({ path: `${dir}/ui-title-menu-${dev}.png` });
    check(await moveTo(page, '#tPlay', dev), T('reach Play'));
    await go(page, dev);
    await page.waitForSelector('#tStart1');
    check(await moveTo(page, '#tStart1', dev), T('reach slot 1'));
    if (dev === 'keys') await page.screenshot({ path: `${dir}/ui-title-slots.png` });
    await go(page, dev);

    // ── E23.7.1 (#446): a new garden asks how its days go; take the game's own day (the first answer, focused) ──
    await page.waitForSelector('#tYes');
    check(/How should the days go\?/.test(await page.evaluate(() => document.querySelector('#tConfirmText').textContent)), T('a new garden asks how the days go'));
    check(await page.evaluate(() => document.activeElement?.id === 'tYes' && /own day/.test(document.querySelector('#tYes').textContent) && /Follow my clock/.test(document.querySelector('#tAlt').textContent)), T("the game's own day is focused first, Follow my clock beside it"));
    if (dev === 'keys') await page.screenshot({ path: `${dir}/ui-title-clock.png` });
    check(await moveTo(page, '#tYes', dev), T("reach The game's own day"));
    await go(page, dev);

    // ── the loading screen covers everything until the first view is complete ──
    await page.waitForSelector('#loading:not(.gone):not([hidden])');
    const seen = new Set();
    let shot = false;
    for (;;) {
      const s = await page.evaluate(() => ({ now: Number(document.querySelector('#loading .ld-bar')?.getAttribute('aria-valuenow') ?? -1), gone: document.querySelector('#loading')?.classList.contains('gone'), tip: document.querySelector('#loading .ld-tip')?.textContent ?? '', game: !!window.solarbloom }));
      seen.add(s.now);
      if (!shot && s.now > 0 && dev === 'keys') {
        await page.screenshot({ path: `${dir}/ui-loading.png` });
        shot = true;
        check(s.tip.length > 10, T(`the loading screen shows a tip ("${s.tip}")`));
      }
      if (s.gone) break;
      await page.waitForTimeout(100);
    }
    check(seen.size >= 2 && Math.min(...seen) < 100 && Math.max(...seen) === 100, T(`the bar moved through real steps to 100 (${[...seen].sort((a, b) => a - b).join(', ')})`));
    const ready = await page.evaluate(() => {
      const g = window.solarbloom;
      g.pause.clear('blur');
      const s = g.loadSteps();
      // E23.2.6 / #561: third person fades in once the ground round bloombot (two chunks out) is drawn, then the rest
      // of the opening view (at most 8 s more), as loadSteps waits for
      return { s, pending: g.chunks.pendingNear(g.camera.target, 32), far: g.chunks.pending, loaded: g.chunks.loadedCount, device: g.bot.lastInput };
    });
    check(ready.s.models === 1 && ready.s.view === 1 && ready.pending === 0 && ready.loaded > 0, T(`the game faded in with the ground round bloombot complete (${ready.loaded} chunks, ${ready.pending} near and ${ready.far} in all still to draw)`));
    check(ready.device === (dev === 'pad' ? 'pad' : 'keys'), T(`the title's first input picked the glyph set (${ready.device})`));
    check(await page.evaluate(() => window.solarbloom.sim.clock.real === false), T("the new garden runs on the game's own day"));

    // ── nothing pops in during the 5 s after the fade: two frames of the paused world match ──
    await page.waitForTimeout(600); // the fade itself
    // the world's own time stops (streaming and model loading don't); the pause's dim is left out of the comparison
    await page.addStyleTag({ content: 'body.paused canvas#app { filter: none !important; transition: none !important; }' });
    await page.evaluate(() => window.solarbloom.setPaused(true));
    await page.waitForTimeout(700);
    const a = await page.screenshot();
    await page.waitForTimeout(5000);
    const b = await page.screenshot();
    const diff = await frameDiff(page, a, b);
    if (diff >= 0.003) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${dir}/ui-popin-${dev}-a.png`, a);
      writeFileSync(`${dir}/ui-popin-${dev}-b.png`, b);
    }
    check(diff < 0.003, T(`no model or chunk pops in during the first 5 s (${(diff * 100).toFixed(2)}% of the frame changed)`));
    await page.evaluate(() => window.solarbloom.setPaused(false));

    // ── play a little: walk, then quit to the title from the menu ──
    if (dev === 'pad') {
      await page.evaluate(() => (window.__pad.axes[1] = -1));
      await page.waitForTimeout(1500);
      await page.evaluate(() => (window.__pad.axes[1] = 0));
    } else {
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(1500);
      await page.keyboard.up('KeyW');
    }
    const before = await page.evaluate(() => ({ seed: window.solarbloom.sim.state.seed, time: window.solarbloom.sim.state.time }));
    if (dev === 'pad') await pressPad(page, 9);
    else await page.keyboard.press('Escape');
    await page.waitForSelector('#menu.open');
    check(await moveTo(page, '#menu-title', dev), T('reach Quit to title in the menu'));
    await Promise.all([page.waitForNavigation(), go(page, dev)]);
    await page.waitForSelector('#tPress');
    check(await page.evaluate(() => !document.querySelector('#splash') && !window.solarbloom), T('quitting lands on the title (no splash a second time)'));
    if (dev === 'pad') await pressPad(page, 0);
    else await page.keyboard.press('Space');
    await page.waitForSelector('#tPlay');
    const head = await page.evaluate(() => JSON.parse(localStorage.getItem('solarbloom.save.1.head')));
    check(head && head.name === 'Garden 1' && head.version >= 8 && !head.rules && head.played >= 0 && !!head.region && !!head.step, T(`slot 1 has its header (${JSON.stringify(head)})`));

    // ── Load game: the slot's card; rename and delete ask first (keyboard run) ──
    if (dev === 'keys') {
      await moveTo(page, '#tPlay', dev);
      await go(page, dev);
      await page.waitForSelector('#tLoad1');
      await page.screenshot({ path: `${dir}/ui-title-load.png` });
      await moveTo(page, '#tRename1', dev);
      await go(page, dev);
      await page.waitForSelector('#tName1');
      await page.keyboard.press('Control+A');
      await page.keyboard.type('Saltwind');
      await page.keyboard.press('Tab');
      await go(page, dev);
      await page.waitForSelector('#tYes');
      check(/Rename this garden to "Saltwind"\?/.test(await page.evaluate(() => document.querySelector('#tConfirmText').textContent)), T('renaming asks first'));
      await moveTo(page, '#tYes', dev);
      await go(page, dev);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('solarbloom.save.1.head')).name === 'Saltwind');
      check(true, T('the slot is renamed'));
      await page.keyboard.press('Escape'); // back to the menu
      await page.waitForSelector('#tPlay');
    }

    // ── Play, then Load: the same game, where it was left ──
    check(await moveTo(page, '#tPlay', dev), T('reach Play'));
    await go(page, dev);
    await page.waitForSelector('#tLoad1');
    check(await moveTo(page, '#tLoad1', dev), T('reach Load on slot 1'));
    await go(page, dev);
    await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
    const after = await page.evaluate(() => ({ seed: window.solarbloom.sim.state.seed, time: window.solarbloom.sim.state.time }));
    check(after.seed === before.seed && after.time >= before.time, T(`Load brings back the same game (time ${before.time.toFixed(1)} → ${after.time.toFixed(1)})`));

    // ── E23.11: delete opens the are-you-sure dialog: "Keep my garden" first, the delete only on a one-second hold
    //    (keyboard run, from a fresh title) ──
    if (dev === 'keys') {
      await page.goto(`${URL_}?title=1`);
      await page.waitForSelector('#tPress');
      await slowDown(page);
      await page.keyboard.press('Space');
      await page.waitForSelector('#tPlay');
      await moveTo(page, '#tPlay', dev);
      await go(page, dev);
      await page.waitForSelector('#tDelete1');
      const saved = () => page.evaluate(() => !!localStorage.getItem('solarbloom.save.1'));
      const dialog = () => page.evaluate(() => { const d = document.querySelector('[role=alertdialog]'); return d ? { title: d.querySelector('h2').textContent, focus: document.activeElement?.className ?? '' } : undefined; });
      await moveTo(page, '#tDelete1', dev);
      await go(page, dev);
      await page.waitForSelector('[role=alertdialog]');
      const d = await dialog();
      check(d?.title === 'Delete Saltwind?' && /cf-keep/.test(d.focus), T(`deleting asks first, with Keep my garden focused (${JSON.stringify(d)})`));
      await page.screenshot({ path: `${dir}/ui-title-confirm.png` });
      await page.keyboard.press('Enter'); // a quick Enter keeps the garden
      await page.waitForSelector('[role=alertdialog]', { state: 'detached' });
      check((await saved()) && (await page.evaluate(() => document.activeElement?.id)) === 'tDelete1', T('a quick Enter keeps the garden and goes back to Delete'));
      await go(page, dev);
      await page.waitForSelector('[role=alertdialog]');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[role=alertdialog]', { state: 'detached' });
      check((await saved()) && !!(await page.$('#tLoad1')), T('Esc backs out of the dialog, the garden kept'));
      await go(page, dev);
      await page.waitForSelector('[role=alertdialog]');
      check(await moveTo(page, '.cf-go', dev), T('reach Hold to delete'));
      await page.keyboard.down('Enter');
      await page.waitForTimeout(350);
      await page.keyboard.up('Enter');
      await page.waitForTimeout(200);
      check((await saved()) && !!(await page.$('[role=alertdialog]')), T('letting go early does nothing'));
      const deleted = await holdToConfirm(
        page,
        () => page.keyboard.down('Enter'),
        () => page.keyboard.up('Enter'),
        () => !localStorage.getItem('solarbloom.save.1') && !localStorage.getItem('solarbloom.save.1.head'),
      );
      if (deleted) await page.waitForSelector('#tStart1');
      check(deleted && (await page.evaluate(() => !document.querySelector('#tLoad1') && !document.querySelector('[role=alertdialog]'))), T('a one-second hold deletes it, and the slot is empty again'));
    }

    // ── E23.11: Start over on the pad: A on the dialog keeps; holding A on Hold to start over asks how the days go ──
    if (dev === 'pad') {
      await page.goto(`${URL_}?title=1`);
      await page.waitForSelector('#tPress');
      await slowDown(page);
      await pressPad(page, 0);
      await page.waitForSelector('#tPlay');
      await moveTo(page, '#tPlay', dev);
      await go(page, dev);
      await page.waitForSelector('#tStart1');
      check(await page.evaluate(() => document.activeElement?.id === 'tLoad1' && !!document.querySelector('.t-slot.latest #tLoad1')), T('the gardens open on Carry on of the last-played garden'));
      await moveTo(page, '#tStart1', dev);
      await go(page, dev);
      await page.waitForSelector('[role=alertdialog]');
      check(/^Start .+ over\?$/.test(await page.evaluate(() => document.querySelector('[role=alertdialog] h2').textContent)), T('Start over asks first'));
      await pressPad(page, 0); // A on Keep my garden
      await page.waitForSelector('[role=alertdialog]', { state: 'detached' });
      check(await page.evaluate(() => !!localStorage.getItem('solarbloom.save.1') && document.activeElement?.id === 'tStart1'), T('a quick A keeps the garden'));
      await go(page, dev);
      await page.waitForSelector('[role=alertdialog]');
      check(await moveTo(page, '.cf-go', dev), T('reach Hold to start over with the d-pad'));
      const asked = await holdToConfirm(
        page,
        () => page.evaluate(() => { window.__pad.buttons[0].pressed = true; window.__pad.buttons[0].value = 1; }),
        () => page.evaluate(() => { window.__pad.buttons[0].pressed = false; window.__pad.buttons[0].value = 0; }),
        () => /How should the days go\?/.test(document.querySelector('#tConfirmText')?.textContent ?? ''),
      );
      check(asked, T('holding A starts the garden over: it asks how the days go'));
      if (asked) await pressPad(page, 1); // B: back out before anything is cleared
      await page.waitForSelector('#tConfirmText', { state: 'detached' });
      check(await page.evaluate(() => !!localStorage.getItem('solarbloom.save.1')), T('B backs out of the question, the garden still there'));
    }
    check(!errors.length, T(`no page errors ${errors.join(' | ')}`));
    await page.close();
  }
} finally {
  // a clean exit: closing the browser can hang in software GL
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]).catch(() => {});
  server.httpServer.close();
}
if (failures.length) {
  console.error(`${failures.length} failed`);
  process.exit(1);
}
process.exit(0);
