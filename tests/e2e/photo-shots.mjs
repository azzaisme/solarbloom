// Photo mode 2 (#photo-2): headless review shots and checks, in docs/review/photo-2/ (or argv[2]).
// `npm run build` first (or this runs on whatever dist/ holds), then `node tests/e2e/photo-shots.mjs [outDir]`
// (`npm run shots:photo` does both). A new game on the high tier at desktop size, and at Steam Deck size
// (1280 × 800, ?gfx=deck): every tab of the panel, worked with the real keys and mouse (arrow keys walk the rows,
// a slider is dragged, "Pick a spot" is pressed on the picture), a square double-size picture saved and measured,
// and the view, the look and the HUD checked back as they were after leaving.
// CHROME_PATH: a Chromium to use in place of Playwright's own.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/photo-2';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4239, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.CHROME_PATH ? ['--headless', '--no-sandbox'] : [])],
});
const SIZES = [
  { name: 'desktop', width: 1920, height: 1080, query: '&gfx=high' },
  { name: 'deck', width: 1280, height: 800, query: '&gfx=deck' },
];
let failed = false;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed = true;
};
/** a PNG's size, from its header */
const pngSize = (file) => {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
try {
  for (const size of process.env.QUICK ? SIZES.slice(0, 1) : SIZES) {
    console.log(size.name);
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.setDefaultTimeout(300_000);
    await page.goto(`http://localhost:4239/?slot=1${size.query}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
    await page.waitForFunction(() => window.solarbloom.bot.visuals.busy !== 'assemble', null, { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.addStyleTag({ content: '.toast, #toasts { display: none !important; }' });
    const shot = async (name, wait = 2500) => {
      await page.waitForTimeout(wait);
      await page.screenshot({ path: `${dir}/${name}-${size.name}.png` });
      console.log(`  ✓ ${dir}/${name}-${size.name}.png`);
    };
    const state = () => page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.photo.state;
      const c = document.querySelector('canvas');
      return {
        active: g.photo.active, tab: s.tab, row: s.row, frame: s.frame, picking: s.picking, focus: g.photo.focus, fov: g.camera.fovOverride, roll: g.camera.roll,
        camFov: g.camera.cam.fov, gain: g.dayNight.exposureGain, vignette: g.look.photoVignette, hud: !document.body.classList.contains('photo'), canvas: [c.width, c.height],
        view: JSON.stringify(g.camera.snapshot()),
      };
    });
    const before = await state();

    // in: the photo key; the panel sits in the bottom left corner, clear of the middle of the picture
    await page.keyboard.press('KeyP');
    await page.evaluate(() => (window.solarbloom.photo.freeze = true));
    await page.waitForSelector('#photoBar.on');
    const box = await page.locator('#photoBar').boundingBox();
    check(box.x + box.width < size.width * 0.5 && box.y >= 0 && box.y + box.height <= size.height, `the panel fits in the left half of the screen (${Math.round(box.width)} × ${Math.round(box.height)} at ${Math.round(box.x)}, ${Math.round(box.y)})`);
    await shot('1-view');

    // the arrow keys walk the panel: down to the lens, right for a longer lens; then the lean is dragged with the mouse
    await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    let s = await state();
    check(s.row === 0 && s.fov !== undefined && Math.abs(s.camFov - s.fov) < 0.01, `six steps right on the lens row: the camera's field of view is ${s.fov?.toFixed(0)}°`);
    const lean = await page.locator('[data-set="roll"]').boundingBox();
    await page.mouse.move(lean.x + lean.width / 2, lean.y + lean.height / 2);
    await page.mouse.down();
    await page.mouse.move(lean.x + lean.width * 0.3, lean.y + lean.height / 2, { steps: 6 });
    await page.mouse.up();
    s = await state();
    check(s.roll < -5, `dragging the lean slider left leans the horizon (${s.roll}°)`);
    check(await page.evaluate(() => document.activeElement === document.body), 'the slider gives the keys back when the mouse lets go');
    await shot('2-long-lens-lean');
    await page.locator('[data-adj="resetView"]').click();
    s = await state();
    check(s.fov === undefined && s.roll === 0, 'Reset puts the view on its own lens, level');

    // focus: strong blur, then "Pick a spot" and a press on the far ground: the press sets the focus and saves nothing
    await page.locator('[data-tab="focus"]').click();
    await page.evaluate(() => window.solarbloom.photo.setValue('blur', 0.9));
    await shot('3-focus-near');
    await page.locator('[data-adj="pick"]').click();
    check((await state()).picking, '"Pick a spot" waits for a press on the picture');
    let saved = 0;
    page.on('download', () => saved++);
    await page.mouse.click(size.width * 0.72, size.height * 0.4);
    await page.waitForTimeout(800);
    s = await state();
    check(!s.picking && s.focus > 1 && saved === 0, `the press set the focus ${s.focus?.toFixed(1)} tiles away and saved no picture`);
    await shot('4-focus-far');
    await page.evaluate(() => {
      const p = window.solarbloom.photo;
      p.adjust('pick'); // back to the middle
      p.setValue('blur', 0.3);
    });

    // light: golden hour, brighter, dark corners
    await page.locator('[data-tab="light"]').click();
    await page.evaluate(() => {
      const p = window.solarbloom.photo;
      p.setWeather('golden');
      p.setValue('ev', 0.5);
      p.setValue('vignette', 0.7);
    });
    s = await state();
    check(Math.abs(s.gain - Math.pow(2, 0.5)) < 1e-6 && s.vignette === 0.7, 'brightness is half a stop up and the vignette is on');
    await shot('5-light');

    // bloombot: turned to the camera, a held face, a pose
    await page.locator('[data-tab="bot"]').click();
    await page.locator('[data-adj="faceCamera"]').click();
    await page.locator('[data-adj="face"][data-dir="1"]').click();
    await page.locator('[data-adj="face"][data-dir="1"]').click();
    await page.waitForTimeout(1500);
    await page.locator('[data-adj="pose"][data-dir="1"]').click();
    await shot('6-bloombot', 900);

    // the frame: a square with thirds, saved at double size; the picture is the square alone, twice the screen's pixels
    await page.locator('[data-tab="frame"]').click();
    await page.evaluate(() => {
      const p = window.solarbloom.photo;
      p.frame = 'square';
      p.grid = 'thirds';
      p.size = 'double';
      p.setTab('frame');
    });
    await shot('7-frame');
    const down = page.waitForEvent('download', { timeout: 180_000 });
    await page.keyboard.press('Space');
    const file = `${dir}/8-saved-square-double-${size.name}.png`;
    await (await down).saveAs(file);
    const [pw, ph] = pngSize(file);
    const side = Math.min(before.canvas[0], before.canvas[1]) * 2;
    check(pw === ph && Math.abs(pw - side) <= 2, `the saved picture is a ${pw} × ${ph} square (the screen draws ${before.canvas.join(' × ')})`);
    await page.waitForTimeout(1500);
    s = await state();
    check(s.canvas[0] === before.canvas[0] && s.canvas[1] === before.canvas[1], 'the screen is back at its own size after the big picture');

    // out: the view, the look and the HUD are exactly as they were
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const after = await state();
    check(!after.active && after.hud, 'Esc leaves photo mode and the HUD is back');
    check(after.view === before.view, 'the camera is exactly as it was');
    check(after.fov === undefined && after.roll === 0 && after.gain === 1 && after.vignette === undefined, 'the lens, lean, brightness and vignette are the game\'s own again');
    await page.evaluate(() => {
      const p = window.solarbloom.photo;
      p.frame = 'screen';
      p.grid = 'none';
      p.size = 'screen';
    });
    check(errors.length === 0, `no page errors${errors.length ? ':\n' + [...new Set(errors)].slice(0, 5).join('\n') : ''}`);
    await page.close();
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? 'photo-shots: FAILED' : 'photo-shots: ok');
process.exit(failed ? 1 : 0);
