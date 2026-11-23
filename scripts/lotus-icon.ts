// Writes the Solarbloom lotus (src/rendering/Emblem.ts lotusSvg) into index.html as the page's icon, so the icon,
// the title's badge and the waymark's emblem are one lotus. Run after changing the lotus:
//   npx vite-node scripts/lotus-icon.ts
// tests/waymark.test.ts fails while the icon and the lotus differ.
import { readFileSync, writeFileSync } from 'node:fs';
import { lotusSvg } from '../src/rendering/Emblem';

export const lotusIconHref = () => 'data:image/svg+xml,' + encodeURIComponent(lotusSvg());

const html = readFileSync('index.html', 'utf8');
const out = html.replace(/<link rel="icon" href="[^"]*" \/>/, `<link rel="icon" href="${lotusIconHref()}" />`);
if (!/<link rel="icon" href="[^"]*" \/>/.test(html)) throw new Error('index.html has no icon link');
writeFileSync('index.html', out);
console.log(out === html ? 'icon already the lotus' : 'icon updated to the lotus');
