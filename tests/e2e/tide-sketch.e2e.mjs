// Run with node tests/e2e/tide-sketch.e2e.mjs. The isolated PlayCanvas scene keeps the test focused on the
// real viewer, renderer and Collection while leaving the main world's shader warmup to the title playtest.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { port: 4258, strictPort: true }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /shader|framebuffer/i.test(message.text())) errors.push(message.text());
  });
  await page.goto('http://localhost:4258/tests/e2e/fixtures/tide-sketch.html');
  await page.waitForFunction(() => typeof window.tide === 'function');
  await page.evaluate(() => window.tide());
  await page.getByRole('button', { name: 'Show me your sketches' }).press('Enter');
  const img = page.locator('#ocPanel .sketch-page img');
  const original = await img.getAttribute('src');
  const note = await page.locator('#ocPanel figcaption').innerText();
  assert.match(original, /^data:image\/jpeg;base64,/);
  const darkPixels = await img.evaluate(async (image) => {
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data.filter((value, i) => i % 4 === 0 && value < 145).length;
  });
  assert(darkPixels > 100 && darkPixels < 30000, `Expected pencil marks on paper, got ${darkPixels} dark pixels`);
  if (process.env.SHOTS_DIR) {
    mkdirSync(process.env.SHOTS_DIR, { recursive: true });
    await page.screenshot({ path: `${process.env.SHOTS_DIR}/tide-sketch-viewer.png` });
    writeFileSync(`${process.env.SHOTS_DIR}/tide-sketch-live.jpg`, Buffer.from(original.split(',')[1], 'base64'));
  }
  await page.getByRole('button', { name: 'Save to Collection', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Saved to Collection' }).waitFor();
  await page.getByRole('button', { name: 'Show another' }).press('Enter');
  assert.notEqual(await img.getAttribute('src'), original, 'Tide draws a different page on another opening');
  await page.getByRole('button', { name: 'Back to Tide' }).press('Enter');
  assert.equal(await page.locator(':focus').getAttribute('data-act'), 'sketch');

  // The kept photo must open even if a model is no longer available to render.
  await page.route('**/*.glb', (route) => route.abort());
  await page.reload();
  await page.evaluate(() => window.collection());
  await page.getByRole('button', { name: /Frog on a lily pad/ }).press('Enter');
  assert.equal(await page.locator('#bpBody .sketch-page img').getAttribute('src'), original);
  assert.equal(await page.locator('#bpBody figcaption').innerText(), note);
  await page.getByRole('button', { name: 'Back to Collection' }).press('Enter');
  await page.getByRole('button', { name: /Frog on a lily pad/ }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Tide drew two different pages. The Collection reopened the exact saved image and note after reload.');
} finally {
  await browser.close();
  await server.close();
}
