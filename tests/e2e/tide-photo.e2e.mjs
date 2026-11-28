// Run with node tests/e2e/tide-photo.e2e.mjs. Exercises the Photo Mode capture on both rendering paths.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { port: 4259, strictPort: true }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://localhost:4259/tests/e2e/fixtures/tide-photo.html');
  await page.waitForFunction(() => typeof window.shoot === 'function');
  const low = await page.evaluate(() => window.shoot(false));
  const post = await page.evaluate(() => window.shoot(true, 0.48));
  for (const [name, result] of Object.entries({ low, post })) {
    assert(result.normals > 12, `${name} should have varied normals, got ${result.normals}`);
    assert(result.depth > 8, `${name} should have varied depths, got ${result.depth}`);
    assert.match(result.image, /^data:image\/jpeg;base64,/);
  }
  assert.notEqual(low.image, post.image);
  assert(await page.evaluate((image) => window.keep(image), low.image));
  if (process.env.SHOTS_DIR) {
    mkdirSync(process.env.SHOTS_DIR, { recursive: true });
    writeFileSync(`${process.env.SHOTS_DIR}/photo.png`, Buffer.from(low.photo.split(',')[1], 'base64'));
    writeFileSync(`${process.env.SHOTS_DIR}/sketch.jpg`, Buffer.from(low.image.split(',')[1], 'base64'));
  }
  await page.reload();
  await page.waitForFunction(() => typeof window.saved === 'function');
  const saved = await page.evaluate(() => window.saved());
  assert.equal(saved.image, low.image);
  assert.equal(saved.photo, 'first');
  assert.deepEqual(errors, []);
  console.log('Photo sketches captured real models with and without post-processing and loaded the exact first page after reload.');
} finally {
  await browser.close();
  await server.close();
}
