// Photo mode 2 (#photo-2) with only a controller, as on a Steam Deck: no mouse or keyboard events at all.
// `npm run build` first, then `node tests/e2e/photo-pad.e2e.mjs [outDir]` (`npm run test:photo-pad` does both).
// A new game at the Deck's size and preset, with the desktop build's preload stood in for (so the Deck's glyphs
// show). A virtual standard gamepad (tests/e2e/gamepad-driver.js) opens photo mode from the pause menu, walks the
// panel with the d-pad, presses rows with A, uses the shortcuts on Y, RT, View and the bumpers, moves the camera
// with the sticks, takes a picture with X, saves one and dismisses one on the card, leaves with B, and finds the
// saved picture in the Backpack's Collection. Shots go to docs/review/photo-2/ (or argv[2]).
// CHROME_PATH: a Chromium to use in place of Playwright's own.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/photo-2';
mkdirSync(dir, { recursive: true });
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const server = await preview({ preview: { port: 4241, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.CHROME_PATH ? ['--headless', '--no-sandbox'] : [])],
});
let failed = false;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed = true;
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(300_000);
  // No pointer or key events may reach the page: fail if any do.
  await page.addInitScript(() => {
    for (const t of ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'wheel']) window.addEventListener(t, (e) => e.isTrusted && (window.__foreignInput = t), true);
    window.solarbloomDesktop = { deck: true }; // the Deck build's preload: its glyphs and preset
  });
  await page.addInitScript(driver + '\ninstallVirtualPad();');
  await page.goto('http://localhost:4241/?slot=1&gfx=deck');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((done) => {
      const r = indexedDB.deleteDatabase('solarbloom.photos');
      r.onsuccess = r.onerror = r.onblocked = done;
    });
  });
  await page.reload();
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  await page.waitForFunction(() => window.solarbloom.bot.visuals.busy !== 'assemble', null, { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: '.toast, #toasts { display: none !important; }' });
  // the pad, stepped a frame at a time so every press is read exactly once
  await page.evaluate(() => {
    const g = window.solarbloom;
    const pad = window.__pad;
    const set = (b, on) => {
      pad.buttons[b].pressed = on;
      pad.buttons[b].value = on ? 1 : 0;
    };
    window.tap = (b, times = 1) => {
      for (let i = 0; i < times; i++) {
        set(b, true);
        g.update(1 / 30);
        set(b, false);
        g.update(1 / 30);
      }
    };
    window.stick = (axes, frames) => {
      pad.axes = axes;
      for (let i = 0; i < frames; i++) g.update(1 / 30);
      pad.axes = [0, 0, 0, 0];
      g.update(1 / 30);
    };
  });
  const tap = (b, times = 1) => page.evaluate(([b, n]) => window.tap(b, n), [b, times]);
  const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, RT = 7, VIEW = 8, MENU = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
  const state = () => page.evaluate(() => {
    const g = window.solarbloom;
    const p = g.photo;
    const s = p.state;
    return {
      active: p.active, tab: s.tab, row: s.row, clean: s.clean, hideBot: s.hideBot, freeze: s.freeze, pose: p.pose, filter: p.filter, weather: p.weather, fov: g.camera.fovOverride,
      tilt: g.camera.pitchOffset, yaw: g.camera.snapshot().yawGoal, zoom: g.camera.zoomTarget, goal: [g.camera.goalPoint.x, g.camera.goalPoint.z], view: JSON.stringify(g.camera.snapshot()),
      shot: document.querySelector('#photoShot')?.classList.contains('on'), focus: document.activeElement?.dataset?.shot ?? document.activeElement?.textContent?.trim().slice(0, 30),
      best: g.photoAlbum.best.length, small: g.photoAlbum.others.length, style: g.glyphs.style, pick: p.rows('focus').find((r) => r.id === 'pick')?.off,
    };
  });
  const shot = async (name, wait = 1500) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${dir}/${name}.png` });
    console.log(`  ✓ ${dir}/${name}.png`);
  };
  await page.evaluate(() => window.stick([0, 0.6, 0, 0], 3)); // a nudge of the stick: the pad is in hand
  const before = await state();

  // in: Menu opens the pause menu; the d-pad finds "Photo mode"; A opens it
  await tap(MENU);
  await page.waitForSelector('#menu.open');
  let found = false;
  for (let i = 0; i < 12 && !found; i++) {
    found = await page.evaluate(() => /Photo mode/.test(document.activeElement?.textContent ?? ''));
    if (!found) await tap(DOWN);
  }
  check(found, 'the d-pad reaches "Photo mode" in the pause menu');
  await tap(A);
  let s = await state();
  check(s.active && s.style === 'deck', `A opens photo mode, with the Deck's glyphs (${s.style})`);
  const help = await page.locator('#photoBar .pb-help').textContent();
  check(/left stick/.test(help) && /d-pad/.test(help) && /A presses a row/.test(help), `the help line is the pad's: “${help}”`);
  check((await page.locator('#photoBar [data-glyph]').count()) > 0, 'rows with a button show its glyph');
  await shot('pad-1-panel');

  // the d-pad walks the panel: tabs left and right, rows up and down, a slider left and right
  await tap(RIGHT);
  s = await state();
  check(s.tab === 'focus' && s.row === -1, 'd-pad right on the tabs opens Focus');
  check(/mouse/.test(s.pick ?? ''), `"Pick a spot" says it needs a mouse (${s.pick})`);
  await tap(LEFT);
  await tap(DOWN);
  await tap(RIGHT, 3);
  s = await state();
  check(s.tab === 'view' && s.row === 0 && s.fov !== undefined, `d-pad down to the lens and right three times: a longer lens (${s.fov?.toFixed(0)}°)`);
  // A presses the row in hand: Bloombot hidden and back, then a pose
  await tap(UP);
  await tap(RIGHT, 3);
  await tap(DOWN);
  await tap(A);
  s = await state();
  check(s.tab === 'bot' && s.hideBot, 'on the Bloombot row, A hides bloombot');
  await tap(A);
  await tap(DOWN);
  await tap(A);
  s = await state();
  check(!s.hideBot && s.pose === 'cheer', 'A again brings it back, and A on the pose row strikes a pose');
  // the shortcuts: Y freezes, RT steps the filter, View the weather, the bumpers tilt
  await tap(Y);
  await tap(RT);
  await tap(VIEW);
  await tap(RB, 2);
  await tap(LB);
  s = await state();
  check(s.freeze && s.filter === 'warm' && s.weather === 'sunny' && s.tilt === 4, `Y freezes, RT picks a filter, View the weather, the bumpers tilt (${s.tilt}°)`);
  // the sticks: left pans, right turns and zooms
  const was = s;
  await page.evaluate(() => window.stick([1, 0, 0, 0], 20));
  await page.evaluate(() => window.stick([0, 0, 1, 0], 20));
  await page.evaluate(() => window.stick([0, 0, 0, -1], 20));
  s = await state();
  check(Math.hypot(s.goal[0] - was.goal[0], s.goal[1] - was.goal[1]) > 0.5, 'the left stick moves the camera');
  check(Math.abs(s.yaw - was.yaw) > 5, 'the right stick turns it');
  check(s.zoom !== was.zoom, 'and zooms it');
  // the panel hides from its own row, and any d-pad press brings it back
  await tap(UP, 3);
  await tap(RIGHT);
  await tap(DOWN, 4);
  await tap(A);
  s = await state();
  check(s.tab === 'frame' && s.clean, 'the last Frame row hides the panel');
  await tap(DOWN);
  s = await state();
  check(!s.clean, 'a d-pad press brings it back');
  await tap(RT, 5); // the filter round to none again, for the picture
  await tap(VIEW, 8);

  // X takes a picture: the card asks; the d-pad moves between its buttons; A saves
  await tap(X);
  await page.waitForSelector('#photoShot.on', { timeout: 180_000 });
  s = await state();
  check(s.focus === 'keep' && s.best === 0, 'X takes a picture: the card is up, Save in focus, nothing kept yet');
  await shot('pad-2-save-or-dismiss', 800);
  await tap(RIGHT);
  const moved = (await state()).focus;
  await tap(LEFT);
  check(moved === 'file' && (await state()).focus === 'keep', 'the d-pad moves between the card\'s buttons');
  await tap(X); // the shutter does nothing while the card is up
  await tap(A);
  await page.waitForFunction(() => !document.querySelector('#photoShot').classList.contains('on'));
  s = await state();
  check(s.best === 1 && s.active, 'A saves it to the album, and photo mode is still open');
  await tap(X);
  await page.waitForSelector('#photoShot.on', { timeout: 180_000 });
  await tap(B);
  s = await state();
  check(!s.shot && s.best === 1 && s.small === 0 && s.active, 'B dismisses the next one: nothing more is kept');

  // out: B leaves, and the view is exactly as it was
  await tap(B);
  s = await state();
  check(!s.active && s.view === before.view, 'B leaves photo mode and the camera is exactly as it was');

  // the album in the Backpack's Collection: the d-pad reaches the picture, A opens it
  await page.evaluate(() => window.solarbloom.hud.backpack.open('collection'));
  let onPhoto = false;
  for (let i = 0; i < 12 && !onPhoto; i++) {
    onPhoto = await page.evaluate(() => !!document.activeElement?.dataset?.album);
    if (!onPhoto) await tap(DOWN);
  }
  check(onPhoto, 'in Backpack › Collection the d-pad reaches the saved picture');
  await shot('pad-3-collection', 1000);
  await tap(A);
  check(await page.evaluate(() => !!document.querySelector('.bp-photo-view img')), 'A opens it');
  await shot('pad-4-collection-photo', 1000);
  check(!(await page.evaluate(() => window.__foreignInput ?? null)), 'no mouse or keyboard event reached the page');
  check(errors.length === 0, `no page errors${errors.length ? ':\n' + [...new Set(errors)].slice(0, 5).join('\n') : ''}`);
  await page.close();
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? 'photo-pad: FAILED' : 'photo-pad: ok');
process.exit(failed ? 1 : 0);
