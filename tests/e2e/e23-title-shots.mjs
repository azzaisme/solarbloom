// E23.11 (Sunlit Glass): screenshots of the main menu, "Your gardens" and the are-you-sure dialog at 1600 × 900 and
// at the Deck's 1280 × 800 (?gfx=deck), with the keyboard's and the pad's button pictures, high contrast, a hold
// half-way, and the loading screen. Two gardens are seeded as headers (the cards read only headers).
// Run after `vite build`: node tests/e2e/e23-title-shots.mjs. Shots go to docs/review/e23-ui/title-*.png.
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/e23-ui';
mkdirSync(dir, { recursive: true });
const driver = readFileSync(new URL('./gamepad-driver.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const PAD = driver + '\ninstallVirtualPad();';
const PORT = 4237;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const now = Date.now();
const SEED = {
  'solarbloom.save.1': '{}',
  'solarbloom.save.1.head': JSON.stringify({ name: 'Hillside garden', day: 14, daypart: 'morning', played: 6 * 3600 + 20 * 60, step: 'Fountain: The pump turns', steps: 2, region: 'Tram stop', version: 8, savedAt: now }),
  'solarbloom.save.2': '{}',
  'solarbloom.save.2.head': JSON.stringify({ name: 'Sunny patch', day: 3, daypart: 'evening', played: 48 * 60, step: 'The fountain is dry', steps: 0, region: 'The workshop', version: 8, savedAt: now - 86400000 }),
};
const errors = [];

async function pressPad(page, b, ms = 2) {
  await page.evaluate(async ([b, ms]) => {
    const frames = (n) => new Promise((r) => (function f(k) { k ? requestAnimationFrame(() => f(k - 1)) : r(); })(n));
    window.__pad.buttons[b].pressed = true;
    await frames(ms);
    window.__pad.buttons[b].pressed = false;
    await frames(2);
  }, [b, ms]);
}

async function open(size, { pad = false, contrast = false, deck = false } = {}) {
  const page = await browser.newPage({ viewport: size });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(([seed, contrast]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    localStorage.setItem('solarbloom.settings', JSON.stringify(contrast ? { highContrast: true } : {}));
  }, [SEED, contrast]);
  if (pad) await page.addInitScript(PAD);
  await page.goto(`http://localhost:${PORT}/?title=1${deck ? '&gfx=deck' : ''}`);
  await page.waitForSelector('#tPress');
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const wake = async (page, pad) => (pad ? pressPad(page, 0) : page.keyboard.press('Space'));
const shot = async (page, name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${dir}/title-${name}.png` });
  console.log(`✓ ${dir}/title-${name}.png`);
};

try {
  for (const [size, tag, deck] of [[{ width: 1600, height: 900 }, '1600', false], [{ width: 1280, height: 800 }, 'deck', true]]) {
    const page = await open(size, { deck });
    await shot(page, `press-${tag}`);
    await wake(page, false);
    await page.waitForSelector('#tPlay');
    await shot(page, `menu-${tag}`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#tLoad1');
    await shot(page, `gardens-${tag}`);
    await page.focus('#tStart1');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role=alertdialog]');
    await shot(page, `confirm-${tag}`);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.down('Enter');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/title-confirm-holding-${tag}.png` });
    console.log(`✓ ${dir}/title-confirm-holding-${tag}.png`);
    await page.keyboard.up('Enter');
    await page.keyboard.press('Escape');
    // rename, inline on the card
    await page.focus('#tRename2');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#tName2');
    await shot(page, `rename-${tag}`);
    await page.close();
  }

  // the pad's pictures on the Deck: menu, gardens and dialog
  {
    const page = await open({ width: 1280, height: 800 }, { pad: true, deck: true });
    await wake(page, true);
    await page.waitForSelector('#tPlay');
    await shot(page, 'menu-deck-pad');
    await pressPad(page, 0);
    await page.waitForSelector('#tLoad1');
    await shot(page, 'gardens-deck-pad');
    await pressPad(page, 13);
    await pressPad(page, 15);
    await pressPad(page, 15);
    await pressPad(page, 0);
    await page.waitForSelector('[role=alertdialog]');
    await shot(page, 'confirm-deck-pad');
    await pressPad(page, 1);
    await page.close();
  }

  // high contrast
  {
    const page = await open({ width: 1280, height: 800 }, { contrast: true, deck: true });
    await wake(page, false);
    await page.waitForSelector('#tPlay');
    await shot(page, 'menu-deck-contrast');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#tLoad1');
    await shot(page, 'gardens-deck-contrast');
    await page.focus('#tDelete1');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role=alertdialog]');
    await shot(page, 'confirm-deck-contrast');
    await page.close();
  }

  // the empty slot's new garden question, then the loading screen
  {
    const page = await open({ width: 1280, height: 800 }, { deck: true });
    await wake(page, false);
    await page.waitForSelector('#tPlay');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#tStart3');
    await page.focus('#tStart3');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#tYes');
    await shot(page, 'clock-deck');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#loading:not(.gone):not([hidden])');
    await page.waitForFunction(() => Number(document.querySelector('#loading .ld-bar')?.getAttribute('aria-valuenow')) > 30, null, { timeout: 180000 });
    await page.screenshot({ path: `${dir}/title-loading-deck.png` });
    console.log(`✓ ${dir}/title-loading-deck.png`);
    await page.close();
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
if (errors.length) {
  console.error(`page errors: ${errors.join(' | ')}`);
  process.exit(1);
}
