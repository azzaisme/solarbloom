// P7-E29: saves tree gallery shots.   node tools/tree-gallery/shoot.mjs <outDir> [query …]
// e.g. node tools/tree-gallery/shoot.mjs /tmp/out "stage=3&lod=1" "stage=3&lod=0&view=iso"
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [out = 'tree-gallery', ...queries] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { port: 4214, strictPort: true }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
try {
  for (const qs of queries.length ? queries : ['stage=3&lod=1']) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 700 } });
    page.on('pageerror', (e) => console.error('page error:', e));
    await page.goto(`http://localhost:4214/tools/tree-gallery/index.html?${qs}`);
    await page.waitForFunction(() => window.ready, null, { timeout: 300_000 });
    const info = await page.evaluate(() => window.treeInfo);
    const name = qs.replace(/[&=]/g, '_');
    await page.locator('#c').screenshot({ path: `${out}/${name}.png` });
    console.log(name, JSON.stringify(info));
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
