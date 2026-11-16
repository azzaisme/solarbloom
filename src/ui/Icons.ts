/**
 * Look 5.2: the HUD's icon set, drawn to match docs/reference/target-look.png. Most icons are cream line art in
 * `currentColor` (so CSS turns them gold when active, or white with a soft glow on the hotbar) with a flat,
 * translucent tint of their hue inside; the three resources, the sun, the Pulse lotus and the frenzy flame are
 * solid colour glyphs like the reference's. 24×24 grid, round joins, no gradients (crisp at 1× and 2×).
 *
 * Gameplay and data strings still carry emoji as compact placeholders ("+12🌿", "🌸 Bloom chain"); the HUD
 * converts them to these icons at the DOM boundary (`iconize`), so no emoji ever reaches the screen and the
 * sim's text stays testable as plain strings. Every emoji used in src/ maps to a drawn icon (tests/icons.test.ts).
 */

type Hue = 'gold' | 'sun' | 'water' | 'leaf' | 'lotus' | 'pink' | 'cream' | 'steel' | 'wood' | 'violet' | 'red' | 'teal' | 'panel' | 'stone' | 'fog' | 'orange' | 'dark';

/** Each hue's flat tint (inside line icons) and the reference's accent colour (solid glyphs, accent lines). */
const HUES: Record<Hue, [tint: string, accent: string]> = {
  gold: ['#f6cc6e', '#ffd148'],
  sun: ['#ffd76a', '#ffcf3f'],
  water: ['#6fd0f6', '#7ad8f8'],
  leaf: ['#8fe06a', '#94e46e'],
  lotus: ['#b8f59a', '#c9ffa8'],
  pink: ['#ff9cc6', '#ff9cc6'],
  cream: ['#fff6e4', '#fff6e4'],
  steel: ['#cfe3ea', '#cfe3ea'],
  wood: ['#e7b072', '#e7b072'],
  violet: ['#c7a8ff', '#c7a8ff'],
  red: ['#ff8a7a', '#ff8a7a'],
  teal: ['#7fe8cc', '#7fe8cc'],
  panel: ['#7fb0ff', '#7fb0ff'],
  stone: ['#e2ddd2', '#e2ddd2'],
  fog: ['#dfe7ee', '#dfe7ee'],
  orange: ['#ffb46a', '#ffb46a'],
  dark: ['#10262b', '#10262b'],
};
/** Old dark-outline colours some bodies still pass to L(): drawn in the icon's line colour now. */
const OUTLINE = new Set(['#9a5f08', '#b8700a', '#11608f', '#1f6127', '#2a7a2c', '#93295d', '#7f6f54', '#3a5561', '#663f16', '#4f2c8f', '#86261a', '#10594a', '#18235c', '#585348', '#5c6a75', '#8c460a', '#0a171b', '#3a2a1a', '#3a2a00', '#a39d90']);

/** Kept for callers: the line style needs no shared defs any more. */
export function iconDefsMarkup(): string {
  return '';
}
export function installIconDefs(_doc?: Document) {}

const line = 'stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"';
/** Line art: a currentColor outline with a flat translucent tint (the dark visor stays opaque). */
const tint = (h: Hue) => `fill="${HUES[h][0]}" fill-opacity="${h === 'dark' ? 1 : h === 'panel' ? 0.55 : 0.32}" ${line}`;
const P = (d: string, h: Hue, extra = '') => `<path d="${d}" ${tint(h)}${extra}/>`;
const C = (cx: number, cy: number, r: number, h: Hue) => `<circle cx="${cx}" cy="${cy}" r="${r}" ${tint(h)}/>`;
const E = (cx: number, cy: number, rx: number, ry: number, h: Hue) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${tint(h)}/>`;
const R = (x: number, y: number, w: number, h: number, r: number, hue: Hue) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ${tint(hue)}/>`;
/** A line: in the icon's line colour, or an accent colour where the reference uses one (rays, signals). */
const L = (d: string, c: string, w = 1.7) => `<path d="${d}" fill="none" stroke="${OUTLINE.has(c) || c === '#fff' ? 'currentColor' : c}" stroke-width="${Math.max(w, 1.5)}" stroke-linecap="round" stroke-linejoin="round"/>`;
/** Solid colour glyphs (resources, sun, lotus, flame), with a thin white sheen. */
const S = (d: string, h: Hue) => `<path d="${d}" fill="${HUES[h][1]}"/>`;
const SH = (d: string) => `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1.3" stroke-linecap="round"/>`;
const HI = (_d: string) => '';
const svg = (body: string) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

function gearPath(cx: number, cy: number, ro: number, ri: number, n: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / n;
  for (let k = 0; k < n; k++) {
    const a = k * step;
    for (const [r, da] of [[ri, -step * 0.36], [ro, -step * 0.2], [ro, step * 0.2], [ri, step * 0.36]] as const)
      pts.push(`${(cx + r * Math.cos(a + da)).toFixed(2)} ${(cy + r * Math.sin(a + da)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}
const star5 = (cx: number, cy: number, ro: number, ri: number) => {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? ri : ro;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
};
const sparkle = (cx: number, cy: number, r: number) => {
  const q = r * 0.28;
  return `M${cx} ${cy - r}L${cx + q} ${cy - q}L${cx + r} ${cy}L${cx + q} ${cy + q}L${cx} ${cy + r}L${cx - q} ${cy + q}L${cx - r} ${cy}L${cx - q} ${cy - q}Z`;
};
const petals = (cx: number, cy: number, d: number, r: number, h: Hue, n = 5) =>
  Array.from({ length: n }, (_, k) => {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / n;
    return C(+(cx + d * Math.cos(a)).toFixed(2), +(cy + d * Math.sin(a)).toFixed(2), r, h);
  }).join('');
const rays = (cx: number, cy: number, r0: number, r1: number, c: string, n = 8) =>
  L(
    Array.from({ length: n }, (_, k) => {
      const a = (k * Math.PI * 2) / n;
      return `M${(cx + r0 * Math.cos(a)).toFixed(2)} ${(cy + r0 * Math.sin(a)).toFixed(2)}L${(cx + r1 * Math.cos(a)).toFixed(2)} ${(cy + r1 * Math.sin(a)).toFixed(2)}`;
    }).join(''),
    c,
    2,
  );

const LEAF = 'M19.5 3.5C11 3.5 5 7.8 5 14.2c0 2 .6 3.7 1.6 5 4.6-.3 12.9-3.6 12.9-15.7z';
const DROP = 'M12 2.5C9 7 5.5 10.6 5.5 14.6a6.5 6.5 0 0 0 13 0C18.5 10.6 15 7 12 2.5z';
const BOLT = 'M13.5 2 5 13.2h5.6L9.6 22 19 9.8h-5.7z';
const CLOUD = 'M6.8 16.5a3.8 3.8 0 0 1-.5-7.6 5.6 5.6 0 0 1 10.8-1.3 4.4 4.4 0 0 1 .4 8.9z';
const HOUSE = 'M4.5 11.2 12 4.6l7.5 6.6V20H4.5z';

const BODIES = {
  // Resources
  energy: S(BOLT, 'gold') + SH('M12.4 5 8.9 10'),
  water: S(DROP, 'water') + SH('M9 14.6a3 3 0 0 0 2.6 3'),
  biomass: S(LEAF, 'leaf') + `<path d="M4 21c3-5 7-8.6 11.5-11" fill="none" stroke="#2f7a2a" stroke-width="1.6" stroke-linecap="round"/>` + SH('M8.4 12.6c1.5-2.8 4-4.8 7.6-6.2'),
  // Tools and the hotbar (line art like the reference's tray)
  restore: P('M12 4.5 21 10l-9 5.5L3 10z', 'leaf') + L('M7.5 7.25l9 5.5M16.5 7.25l-9 5.5', '#fff') + L('M3 13l9 5.5 9-5.5', '#fff'),
  solarPanel: P('M4 6.5h16l-2 9H6z', 'panel') + L('M9.3 6.5l-.6 9M14.7 6.5l.6 9M5 11h14', '#fff', 1.3) + L('M12 15.5V20M8.5 20h7', '#fff'),
  condenser: R(6.5, 3.5, 11, 15, 3.2, 'steel') + R(9, 6.5, 6, 8.5, 2, 'water') + L('M5.5 20.5h13', '#fff'),
  pollinator: L('M12 21v-9', '#fff') + P('M12 17c-1.2-2.6-3.6-3.6-6-3 .8 2.6 3.2 3.6 6 3z', 'leaf') + P('M12 15.5c1.2-2.6 3.6-3.6 6-3-.8 2.6-3.2 3.6-6 3z', 'leaf') + petals(12, 7.5, 2.8, 2.3, 'pink') ,
  droneHub: L('M3.5 19.5h17', '#fff') + C(12, 11, 5.6, 'cream') + E(12, 11.4, 3.8, 2.2, 'dark') + `<circle cx="10.6" cy="11.4" r=".9" fill="#8fe9ff"/><circle cx="13.4" cy="11.4" r=".9" fill="#8fe9ff"/>` + P('M12 5.4c0-2 1.6-3.2 3.6-3 0 1.9-1.5 3.1-3.6 3z', 'leaf'),
  pulse: S('M3 15.4c3 4.2 15 4.2 18 0-4 1.8-14 1.8-18 0z', 'leaf') + S('M11.2 17.4C8 16.8 5.6 14.6 4.6 11.2 3.9 9 4 7.8 4.2 7.2c2.6.8 4.8 2.4 6 4.8.8 1.8 1.2 3.6 1 5.4z', 'lotus') + S('M12.8 17.4c3.2-.6 5.6-2.8 6.6-6.2.7-2.2.6-3.4.4-4-2.6.8-4.8 2.4-6 4.8-.8 1.8-1.2 3.6-1 5.4z', 'lotus') + `<path d="M12 3.5c2.6 2.9 3.2 6.1 3 8.7-.2 2.4-1.4 4.2-3 5.4-1.6-1.2-2.8-3-3-5.4-.2-2.6.4-5.8 3-8.7z" fill="#f4ffe8" stroke="#8fe06a" stroke-width="1"/>`,
  inspect: C(10.5, 10.5, 6, 'water') + L('M15 15l5.2 5.2', '#fff', 2.6),
  build: L('M11 11l8.5 8.5', '#fff', 2.6) + P('M3.8 8.2 9 3l4.4 4.4-5.2 5.2z', 'steel'),
  harvest: `<circle cx="12" cy="12" r="4.8" fill="#ffcf3f"/>` + rays(12, 12, 7.2, 9.8, '#ffcf3f'),
  upgrades: C(12, 12, 9, 'leaf') + L('M12 17V7.5M8 11.2 12 7.2l4 4', '#fff', 2),
  // Controls
  home: P(HOUSE, 'cream') + L('M2.8 11.6 12 3.6l9.2 8', '#fff', 2) + L('M10 20v-5h4v5', '#fff'),
  garden: P('M6.5 14h11l-1.5 6.5h-8z', 'wood') + P('M12 13.5c0-4.2-3-6.6-7-6 0 3.6 2.8 6.4 7 6z', 'leaf') + P('M12 12.5c0-3.6 2.6-6 6.4-5.6 0 3.4-2.6 5.8-6.4 5.6z', 'leaf'),
  settings: `<path d="${gearPath(12, 12, 10, 7.4, 8)}M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z" fill="currentColor" fill-rule="evenodd"/>`,
  pause: `<rect x="6" y="5" width="4.2" height="14" rx="1.4" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.4" fill="currentColor"/>`,
  play: `<path d="M7.5 4.8v14.4L19 12z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  fastForward: `<path d="M3.5 6v12l8.5-6zM12 6v12l8.5-6z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`,
  sun: `<circle cx="12" cy="12" r="4.8" fill="#ffcf3f"/>` + rays(12, 12, 7.2, 9.8, '#ffcf3f'),
  frenzy: S('M12 2.2c1 3.4 3.4 4.6 3.4 7.6a3.4 3.4 0 0 1-6.8 0c0-1.2.5-2.1 1.2-2.9-2.6 1.4-4.6 4.2-4.6 7.6a6.8 6.8 0 0 0 13.6 0c0-5.6-4.4-8.4-6.8-12.3z', 'gold') + SH('M8.4 13.4a3.6 3.6 0 0 0 1.4 3'),
  // The cat and its trail
  cat: P('M4.5 10.5 5 3.5l4.5 3.5h5L19 3.5l.5 7c0 5-3.3 9-7.5 9s-7.5-4-7.5-9z', 'cream') + `<path d="M6.3 6.2l.3 3 2-1.6zM17.7 6.2l-.3 3-2-1.6z" fill="#ffb3cf"/>` + L('M8 12.2q1.2-1.3 2.4 0M13.6 12.2q1.2-1.3 2.4 0', '#3a2a1a', 1.3) + `<path d="M11.2 14.2h1.6l-.8.9z" fill="#e8559a"/>` + L('M7 17.6q5 2.4 10 0', '#e0533f', 1.6) + C(12, 19.2, 1.2, 'gold'),
  paw: E(12, 15.5, 4.4, 3.8, 'pink') + C(6.6, 10.2, 1.9, 'pink') + C(9.6, 6.6, 1.9, 'pink') + C(14.4, 6.6, 1.9, 'pink') + C(17.4, 10.2, 1.9, 'pink'),
  // Nature
  sparkle: P(sparkle(10, 10, 7.5), 'gold') + P(sparkle(18.5, 17.5, 3.6), 'gold'),
  flower: petals(12, 12, 4.4, 3.6, 'pink') + C(12, 12, 2.6, 'gold'),
  whiteFlower: petals(12, 12, 4.4, 3.6, 'cream', 6) + C(12, 12, 2.6, 'gold'),
  sunflower: petals(12, 12, 6, 3, 'gold', 10) + C(12, 12, 4, 'wood'),
  sprout: E(12, 20.5, 6, 1.6, 'wood') + L('M12 20v-8', '#3a2a1a', 1.8) + P('M12 13C12 8.5 8.5 6 4 6.5c0 4.5 3.5 7 8 6.5z', 'leaf') + P('M12 11.5c0-4 3-6.5 8-6.5 0 4.5-3.5 7-8 6.5z', 'leaf'),
  tree: R(10.6, 13.5, 2.8, 7.5, 1, 'wood') + P('M12 2.8a5 5 0 0 0-4.6 3.1A4.6 4.6 0 0 0 4 10.4 4.6 4.6 0 0 0 8 15h8a4.6 4.6 0 0 0 4-4.6 4.6 4.6 0 0 0-3.4-4.4A5 5 0 0 0 12 2.8z', 'leaf') + HI('M8.6 7.6a3 3 0 0 1 2.6-2'),
  pine: R(10.8, 18, 2.4, 3.6, .8, 'wood') + P('M12 2 6.5 9.5h2.8L5 15h4l-4.5 4h15L15 15h4l-4.3-5.5h2.8z', 'teal'),
  fallLeaf: P(LEAF, 'orange') + L('M4 21c3-5 7-8.6 11.5-11', '#3a2a1a'),
  grain: L('M12 21V6', '#3a2a1a', 1.6) + E(9.6, 8.5, 1.6, 2.6, 'gold') + E(14.4, 8.5, 1.6, 2.6, 'gold') + E(9.6, 13, 1.6, 2.6, 'gold') + E(14.4, 13, 1.6, 2.6, 'gold') + E(12, 4.6, 1.5, 2.4, 'gold'),
  butterfly: P('M11.6 11.5C10 6.5 6.2 3.6 3.6 5s.6 6.8 8 6.5z', 'violet') + P('M12.4 11.5C14 6.5 17.8 3.6 20.4 5s-.6 6.8-8 6.5z', 'violet') + P('M11.5 12.5C7 13 4.6 16 6 18.4s4.8-.8 5.5-5.9z', 'pink') + P('M12.5 12.5c4.5.5 6.9 3.5 5.5 5.9s-4.8-.8-5.5-5.9z', 'pink') + L('M12 7v12', '#3a2a1a', 1.6),
  bird: P('M4 13c2-4.5 6-6.5 10.5-5.5L19 5l-1.6 4.4c1.2 1.4 1.6 3.2 1.2 5C17.6 18 13 20 8.6 18.6 6.2 17.8 4.6 15.8 4 13z', 'water') + C(15.2, 10.2, .9, 'dark') + P('M19.4 11.2 22 12l-2.6.8z', 'orange'),
  fish: P('M3.5 12c2.4-4 7-5.6 11-4.2L20.5 5v14l-6-2.8c-4 1.4-8.6-.2-11-4.2z', 'orange') + C(7.4, 11.2, 1, 'dark') + HI('M10 9.4c1.6-.4 3-.2 4.2.4'),
  moon: P('M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5z', 'sun'),
  rainbow: L('M3 18a9 9 0 0 1 18 0', '#ef6a5a', 2.2) + L('M5.6 18a6.4 6.4 0 0 1 12.8 0', '#f6cc6e', 2.2) + L('M8.2 18a3.8 3.8 0 0 1 7.6 0', '#7ad8f8', 2.2),
  wave: P('M2.5 15c2.4-2.6 4.8-2.6 7.2 0s4.8 2.6 7.2 0 3.6-2.6 4.6-1.6V20h-19z', 'water') + L('M3 10.5c2.2-2.2 4.4-2.2 6.6 0s4.4 2.2 6.6 0 4-2 5.2-1', '#3a2a1a', 1.6),
  fog: P(CLOUD, 'fog') + L('M4 19.5h10M9 21.8h10', '#3a2a1a', 1.6),
  rain: P(CLOUD, 'fog') + L('M8 19l-1 2.6M12 19l-1 2.6M16 19l-1 2.6', '#2ba0e0', 1.8),
  star: S(star5(12, 12.5, 9.6, 4.2), 'gold') + HI('M9.4 9.6 12 5.2'),
  burst: P('M12 2l2 5 5-2-2 5 5 2-5 2 2 5-5-2-2 5-2-5-5 2 2-5-5-2 5-2-2-5 5 2z', 'orange') + C(12, 12, 3.4, 'sun'),
  // Machines and the city
  fountain: P('M3.5 15h17l-2 5h-13z', 'stone') + L('M12 15V7M12 7c-3 0-5 3-5.5 6.5M12 7c3 0 5 3 5.5 6.5', '#2ba0e0', 1.6) + P('M12 2.6c-1.2 1.8-2 2.8-2 3.8a2 2 0 0 0 4 0c0-1-.8-2-2-3.8z', 'water'),
  relay: L('M8.5 21l3.5-8.5 3.5 8.5M9.6 18.2h4.8', '#3a2a1a', 1.6) + P('M4.2 8.8a7.6 7.6 0 0 0 11.3 6.4L7.6 4.2a7.6 7.6 0 0 0-3.4 4.6z', 'steel') + L('M15 4a5 5 0 0 1 5 5M15 7a2 2 0 0 1 2 2', '#f2a91e', 1.6),
  drone: C(12, 13, 7, 'cream') + E(12, 13.4, 4.8, 2.8, 'dark') + `<ellipse cx="10.2" cy="13.4" rx="1.1" ry="1.3" fill="#8fe9ff"/><ellipse cx="13.8" cy="13.4" rx="1.1" ry="1.3" fill="#8fe9ff"/>` + L('M12 6V4.6', '#3a2a1a', 1.4) + P('M12 4.8c0-2 1.6-3.2 3.8-3 0 2-1.6 3.2-3.8 3z', 'leaf'),
  rocket: P('M12 2.5c3 2.2 4.4 5.6 4.4 9.6l-1.6 4.4H9.2l-1.6-4.4c0-4 1.4-7.4 4.4-9.6z', 'steel') + C(12, 9.4, 1.9, 'water') + P('M9.6 17h4.8L12 21.6z', 'orange') + P('M7.6 12.1 4.8 15.6l3.4.6zM16.4 12.1l2.8 3.5-3.4.6z', 'red'),
  satellite: R(9.2, 9.2, 5.6, 5.6, 1.2, 'steel') + P('M2.5 6.5 6.5 2.5 9.8 5.8 5.8 9.8zM21.5 17.5l-4 4-3.3-3.3 4-4z', 'panel') + L('M7.8 7.8l1.6 1.6M14.6 14.6l1.6 1.6', '#3a2a1a', 1.4),
  crystal: P('M12 2.5l7 9.5-7 9.5-7-9.5z', 'teal') + L('M5 12h14M12 2.5l-3 9.5 3 9.5 3-9.5z', '#e2fff6', 0.9),
  vase: P('M9 3h6v2.2c0 1.2 3.8 2.6 3.8 7.6 0 4.4-2.8 8.2-6.8 8.2s-6.8-3.8-6.8-8.2c0-5 3.8-6.4 3.8-7.6z', 'orange') + L('M6.4 11.6h11.2', '#fff3d6', 1.2),
  building: R(5, 3.5, 14, 17.5, 1.6, 'steel') + `<g fill="#ffe7a3">${[6.5, 10.5, 14.5].flatMap((y) => [8, 11.2, 14.4].map((x) => `<rect x="${x}" y="${y}" width="1.8" height="2.2" rx=".4"/>`)).join('')}</g>` + R(10.6, 17.5, 2.8, 3.5, .6, 'wood'),
  road: P('M8.5 3h7L21 21H3z', 'stone') + L('M12 5v2.6M12 10.4v3M12 16.4v3', '#ffe7a3', 1.6),
  boat: P('M2.5 12.5h19l-3.4 5.6H5.9z', 'wood') + L('M14.5 3.5 9 17', '#3a2a1a', 1.6) + P('M8.2 19.4l1.6-3.8 2 .8-1.6 3.8z', 'wood'),
  basket: P('M3.5 10.5h17l-2 9.5H5.5z', 'wood') + L('M7 10.5a5 5 0 0 1 10 0', '#3a2a1a', 1.8) + L('M8 13.5l1 5M12 13.5v5M16 13.5l-1 5', '#fbe0b4', 1) + P('M14 8c0-2.4 1.6-4 4-4 0 2.4-1.6 4-4 4z', 'leaf'),
  lantern: L('M12 2v2', '#3a2a1a', 1.6) + R(9.5, 3.5, 5, 2, .6, 'gold') + E(12, 12, 6.5, 6.5, 'red') + R(9.5, 18.2, 5, 2, .6, 'gold') + L('M12 5.6v12.8M8 7.6c-1.2 2.6-1.2 6.2 0 8.8M16 7.6c1.2 2.6 1.2 6.2 0 8.8', '#ffd9cf', 1),
  // Status and actions
  lock: L('M8 11V8a4 4 0 0 1 8 0v3', '#3a2a1a', 2.4) + R(5.5, 10.5, 13, 10, 2.4, 'gold') + C(12, 15.4, 1.5, 'dark'),
  check: R(3.5, 3.5, 17, 17, 4.5, 'leaf') + L('M8 12.4l2.8 2.8L16.4 9', '#fff', 2.4),
  box: R(3.5, 3.5, 17, 17, 4.5, 'cream'),
  hourglass: L('M6 3h12M6 21h12', '#3a2a1a', 2) + P('M7.2 3.5h9.6c0 4.4-4.2 5.6-4.2 8.5s4.2 4.1 4.2 8.5H7.2c0-4.4 4.2-5.6 4.2-8.5S7.2 7.9 7.2 3.5z', 'cream') + P('M9.2 19.6c.6-2 2.8-2.4 2.8-4 0 1.6 2.2 2 2.8 4z', 'gold'),
  link: L('M10 14a4.2 4.2 0 0 1 0-6l2-2a4.2 4.2 0 0 1 6 6l-1.2 1.2', '#b8700a', 3) + L('M14 10a4.2 4.2 0 0 1 0 6l-2 2a4.2 4.2 0 0 1-6-6l1.2-1.2', '#b8700a', 3) + L('M10 14a4.2 4.2 0 0 1 0-6l2-2a4.2 4.2 0 0 1 6 6l-1.2 1.2M14 10a4.2 4.2 0 0 1 0 6l-2 2a4.2 4.2 0 0 1-6-6l1.2-1.2', '#ffd66b', 1.6),
  merge: L('M4 5.5h3.5l5 6.5M4 18.5h3.5l5-6.5M12.5 12H20', '#f6cc6e', 2.4) + P('M17 8.6l3.6 3.4-3.6 3.4z', 'gold') + C(4, 5.5, 1.8, 'leaf') + C(4, 18.5, 1.8, 'leaf') + C(10.5, 12, 1.8, 'leaf'),
  repeat: L('M5 11a7 7 0 0 1 12-4.8M19 13a7 7 0 0 1-12 4.8', '#7ad8f8', 2.4) + P('M17.8 2.8l.2 4.4-4.4-.2z', 'water') + P('M6.2 21.2 6 16.8l4.4.2z', 'water'),
  up: P('M12 3.5 19.5 11H15v9.5H9V11H4.5z', 'leaf') + HI('M12 6.6 9 9.6'),
  warning: P('M12 3 21.5 20h-19z', 'gold') + L('M12 9.5v5', '#3a2a00', 2.2) + `<circle cx="12" cy="17.2" r="1.2" fill="#3a2a00"/>`,
  question: C(12, 12, 9, 'cream') + L('M9.4 9.4a2.7 2.7 0 1 1 3.6 2.5c-.7.3-1 .8-1 1.6v.6', '#7f6f54', 2) + `<circle cx="12" cy="17.2" r="1.2" fill="#7f6f54"/>`,
  clipboard: R(4.5, 4, 15, 17.5, 2.2, 'wood') + R(6.5, 6.5, 11, 13, 1.2, 'cream') + R(9, 2.5, 6, 3, 1, 'steel') + L('M8.6 10.5h6.8M8.6 13.5h6.8M8.6 16.5h4.4', '#a39d90', 1.2),
  broom: L('M18.5 3.5 11 11', '#3a2a1a', 2.6) + L('M18.5 3.5 11 11', '#d79a55', 1.4) + P('M10.2 9.4l4.4 4.4-3.4 3.4c-1.6 1.6-4.4 2.6-7.6 3.2.6-3.2 1.6-6 3.2-7.6z', 'gold'),
  bench: P('M3.5 9.5h17v3h-17z', 'wood') + P('M3.5 13.8h17v2.4h-17z', 'wood') + L('M6 16.2V20M18 16.2V20M6 9.5V6M18 9.5V6', '#3a2a1a', 2),
  bulb: P('M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.8.6 1.3 1.6 1.3 2.6h5c0-1 .5-2 1.3-2.6A6.5 6.5 0 0 0 12 2.5z', 'sun') + R(9.4, 17, 5.2, 4.2, 1.4, 'steel') + HI('M9.4 6.8a3.6 3.6 0 0 1 2.4-1.6'),
  coins: P('M8 6.5h8l-1.4-3h-5.2zM12 6.5c5 0 8 4.2 8 8.2 0 3.6-3 5.8-8 5.8s-8-2.2-8-5.8c0-4 3-8.2 8-8.2z', 'gold') + L('M12 10v7.4M10 11.6h3.2a1.4 1.4 0 0 1 0 2.8h-2.4a1.4 1.4 0 0 0 0 2.8H14', '#9a5f08', 1.4),
  puzzle: P('M4 8h4a2.2 2.2 0 1 1 4 0h4v4a2.2 2.2 0 1 1 0 4v4H4z', 'leaf'),
  crown: P('M3.5 8l4.5 4 4-7 4 7 4.5-4-1.8 11H5.3z', 'gold') + C(12, 4.8, 1.3, 'red'),
  brain: P('M8.5 4.5a3.5 3.5 0 0 0-3.4 4.3A3.6 3.6 0 0 0 4.6 15a3.8 3.8 0 0 0 4.4 4.5c1.2 0 2.2-.6 3-1.4.8.8 1.8 1.4 3 1.4a3.8 3.8 0 0 0 4.4-4.5 3.6 3.6 0 0 0-.5-6.2 3.5 3.5 0 0 0-3.4-4.3c-1.4 0-2.6.7-3.5 1.6-.9-.9-2.1-1.6-3.5-1.6z', 'pink') + L('M12 6v12.4M8.6 10c1.2 0 2.4.8 3.4 2M15.4 10c-1.2 0-2.4.8-3.4 2', '#3a2a1a', 1.1),
  web: L('M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M18.7 5.3 5.3 18.7', '#3a2a1a', 1.1) + L('M12 6.5l3.9 1.6 1.6 3.9-1.6 3.9-3.9 1.6-3.9-1.6-1.6-3.9 1.6-3.9z', '#3a2a1a', 1.1),
  hand: P('M7.5 12.5V6a1.5 1.5 0 0 1 3 0v4.5V4.5a1.5 1.5 0 0 1 3 0v6V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6 7-2.4 0-4-1.4-5.2-3.4L3.6 14a1.6 1.6 0 0 1 2.6-1.8z', 'cream'),
  robot: L('M12 3.5v2.4', '#3a2a1a', 1.6) + C(12, 3, 1.3, 'red') + R(5, 6, 14, 10, 3, 'steel') + `<rect x="8" y="9.4" width="2.6" height="2.6" rx="1" fill="#8fe9ff"/><rect x="13.4" y="9.4" width="2.6" height="2.6" rx="1" fill="#8fe9ff"/>` + R(7.5, 16.5, 9, 4.5, 1.5, 'steel'),
  wrench: P('M14.5 3.5a5 5 0 0 0-4.6 6.9L3.8 16.5a1.9 1.9 0 0 0 2.7 2.7l6.1-6.1a5 5 0 0 0 6.9-4.6l-3 3-2.6-.5-.5-2.6z', 'steel'),
  crane: L('M7 21V3.5h12.5M7 7l4.5-3.5M17 3.5V9', '#d9a03a', 2) + R(15, 9, 4, 3.4, .8, 'wood') + P('M4 20.5h7v1.5H4z', 'stone'),
  crate: R(4, 6, 16, 14, 1.8, 'wood') + L('M4 11h16M12 6v14', '#3a2a1a', 1.2) + P('M4 6l2.4-2.5h11.2L20 6z', 'wood'),
  // Drone roles (E18; used by the role picker and over drones)
  roleRestorer: P('M12 8l8.5 4.6L12 17.2 3.5 12.6z', 'leaf') + P('M3.5 12.6v2.2l8.5 4.6 8.5-4.6v-2.2L12 17.2z', 'wood') + P(sparkle(12, 5, 4.2), 'gold'),
  roleGardener: P('M4.5 10h10v8.5a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2z', 'water') + L('M14.5 12l5-4.5', '#3a2a1a', 2.2) + L('M7 10a3 3 0 0 1 5 0', '#3a2a1a', 1.6) + L('M20.5 9.5v1.6M19 11.4v1.6M21.6 12v1.4', '#7ad8f8', 1.2),
  roleScout: C(7.4, 14.5, 4.4, 'steel') + C(16.6, 14.5, 4.4, 'steel') + C(7.4, 14.5, 2.2, 'water') + C(16.6, 14.5, 2.2, 'water') + P('M9.5 7h5v5h-5z', 'dark'),
  roleCourier: R(4, 7, 16, 13, 1.8, 'wood') + L('M4 11.4h16M12 7v13', '#fbe0b4', 1.4) + P('M7.5 7l2-3h5l2 3z', 'wood'),
  roleSpark: C(12, 12, 9, 'dark') + P('M13.2 4.5 7.2 12.8h4.2l-.8 6.7 6.2-8.6h-4.2z', 'gold'),
  roleHarvester: P('M3.5 11h17l-2 9H5.5z', 'wood') + P('M8 11c0-3.4 2-5.6 5-5.6 0 3.2-2 5.4-5 5.6z', 'leaf') + P('M12.4 10.4c.6-2.6 2.6-4 5-3.6-.6 2.4-2.6 3.8-5 3.6z', 'leaf') + L('M7 14.5h10', '#fbe0b4', 1.1),
} as const;
type BodyName = keyof typeof BODIES;
const body = (n: BodyName) => BODIES[n];

/** Named icons (the HUD's own controls, resources and categories). */
/**
 * The painted icons: the HUD's prominent icons are painted in klad (tools/icons/paint-icons.mjs) and shipped as
 * PNGs, 48 px for 1× screens and 96 px for 2×. They replace the line drawings of the same name; the rest (small
 * glyphs inside text, the solid white pause / fast-forward / gear) stay SVG.
 */
const PNG = import.meta.glob('./icons/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const PAINTED_AS: Partial<Record<BodyName, string>> = { sun: 'harvest' };
function painted(name: string, cls = 'icon painted'): string | undefined {
  const x2 = PNG[`./icons/${name}.png`];
  const x1 = PNG[`./icons/${name}@1x.png`];
  return x2 && x1 ? `<img class="${cls}" src="${x1}" srcset="${x2} 2x" alt="" aria-hidden="true" draggable="false">` : undefined;
}
export const ICONS = Object.fromEntries((Object.keys(BODIES) as BodyName[]).map((n) => [n, painted(PAINTED_AS[n] ?? n) ?? svg(body(n))])) as Record<BodyName, string>;
/** Which icons are painted (for tests and the icon sheet). */
export const PAINTED = (Object.keys(BODIES) as BodyName[]).filter((n) => !!painted(PAINTED_AS[n] ?? n));
export type IconName = BodyName;

/** The build tray's machine icons (machines' data still names them with an emoji). */
export const MACHINE_ICONS: Record<string, IconName> = {
  solar: 'solarPanel',
  condenser: 'condenser',
  pollinator: 'pollinator',
  droneHub: 'droneHub',
  motherTree: 'tree',
  reservoirGarden: 'fountain',
  relay: 'relay',
  core: 'sparkle',
};

/** Upgrade categories (groups in data/upgrades.ts). */
export const GROUP_ICONS: Record<string, IconName> = { Pulse: 'pulse', Machines: 'wrench', Drones: 'drone', Storage: 'crate', Networks: 'link', Fog: 'fog' };

/** E18 drone roles. */
export const ROLE_ICONS: Record<string, IconName> = {
  restorer: 'roleRestorer',
  gardener: 'roleGardener',
  scout: 'roleScout',
  courier: 'roleCourier',
  spark: 'roleSpark',
  harvester: 'roleHarvester',
};

/** Every emoji the game's strings use, drawn as one of the icons above. */
export const EMOJI_ICONS: Record<string, IconName> = {
  '⚡': 'energy', '💧': 'water', '🌿': 'biomass',
  '✨': 'sparkle', '🌸': 'flower', '💮': 'whiteFlower', '🌻': 'sunflower', '🌱': 'sprout', '🌳': 'tree', '🌲': 'pine', '🍂': 'fallLeaf', '🌾': 'grain',
  '☀': 'sun', '🌞': 'sun', '🔆': 'sun', '🌙': 'moon', '🌈': 'rainbow', '🌊': 'wave', '🌫': 'fog', '🌧': 'rain', '🌟': 'star', '💥': 'burst',
  '🦋': 'butterfly', '🐦': 'bird', '🐟': 'fish', '🐱': 'cat', '🐾': 'paw', '🤖': 'robot',
  '⛲': 'fountain', '📡': 'relay', '🛰': 'satellite', '🛸': 'drone', '🚀': 'rocket', '💠': 'crystal', '🏺': 'vase', '🏢': 'building', '🏙': 'building', '🗼': 'building',
  '🛣': 'road', '🛤': 'road', '🛶': 'boat', '🧺': 'basket', '🏮': 'lantern', '🏗': 'crane',
  '🔒': 'lock', '✅': 'check', '⬜': 'box', '⏳': 'hourglass', '🔗': 'link', '🔀': 'merge', '🔁': 'repeat', '⬆': 'up', '⚠': 'warning', '❔': 'question',
  '📋': 'clipboard', '🧹': 'broom', '🪑': 'bench', '💡': 'bulb', '💰': 'coins', '🧩': 'puzzle', '👑': 'crown', '🧠': 'brain', '🕸': 'web', '✋': 'hand',
  '⚙': 'settings', '🔧': 'wrench', '▶': 'play', '⏸': 'pause', '⏩': 'fastForward', '⏭': 'fastForward',
};

/** Emoji (with optional variation selector / ZWJ sequences). */
export const EMOJI_RE = /\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*/gu;
const HAS_EMOJI = /\p{Extended_Pictographic}/u;

/** The icon for one emoji (a sparkle for any the set doesn't know yet; tests keep that list empty). */
export function emojiIcon(e: string): string {
  const base = e.replace(/️/g, '').split('‍')[0];
  return ICONS[EMOJI_ICONS[base] ?? 'sparkle'];
}

export function hasEmoji(s: string): boolean {
  return HAS_EMOJI.test(s);
}

/**
 * HTML with every emoji drawn as an icon. Emoji inside tags (attribute values such as titles) are dropped,
 * not replaced, so markup stays valid.
 */
export function iconize(html: string): string {
  if (!HAS_EMOJI.test(html)) return html;
  return html
    .split(/(<[^>]*>)/)
    .map((seg, i) => (i % 2 ? seg.replace(EMOJI_RE, '') : seg.replace(EMOJI_RE, emojiIcon)))
    .join('');
}

/** Plain text for titles and aria labels: emoji removed, spacing tidied. */
export function plain(text: string): string {
  return HAS_EMOJI.test(text) ? text.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim() : text;
}

/**
 * Look 5.3: the Solarbloom mark: a lotus opening in front of a rising sun (cream petals, gold edges). Used by
 * the HUD logo, the intro card and the favicon (index.html carries the same drawing as a data URI).
 */
const MARK_BODY =
  rays(12, 9.5, 7.6, 10.4, '#ffd148', 9).replace('stroke-width="2"', 'stroke-width="1.6"') +
  `<circle cx="12" cy="9.5" r="5.6" fill="#ffd148"/>` +
  `<g fill="#fff6e4" stroke="#e0a83a" stroke-width="1" stroke-linejoin="round">` +
  `<path d="M2.6 15.6c3 4.4 15.8 4.4 18.8 0-4.2 1.9-14.6 1.9-18.8 0z" fill="#b8f59a" stroke="#5fae45"/>` +
  `<path d="M11.2 18.6C8 18 5.4 15.8 4.4 12.2c-.7-2.2-.6-3.4-.4-4 2.7.8 4.9 2.5 6.1 5 .8 1.8 1.2 3.6 1.1 5.4z"/>` +
  `<path d="M12.8 18.6c3.2-.6 5.8-2.8 6.8-6.4.7-2.2.6-3.4.4-4-2.7.8-4.9 2.5-6.1 5-.8 1.8-1.2 3.6-1.1 5.4z"/>` +
  `<path d="M12 5.2c2.7 3 3.3 6.4 3.1 9-.2 2.5-1.4 4.4-3.1 5.6-1.7-1.2-2.9-3.1-3.1-5.6-.2-2.6.4-6 3.1-9z"/></g>`;
export const LOGO_MARK = painted('mark', 'mark painted') ?? `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${MARK_BODY}</svg>`;
/** The favicon: the mark on its own (standalone SVG with the xmlns a browser needs outside the page). */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${MARK_BODY}</svg>`;
