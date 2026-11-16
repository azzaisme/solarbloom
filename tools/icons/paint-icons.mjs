// Look 5.2 (redo): paints the HUD's main icons in klad (https://github.com/klad-app/klad) and exports them as
// PNGs to src/ui/icons/ (<name>.png at 96 px for 2×, <name>@1x.png at 48 px). The script is the source of
// truth: it rebuilds every bundle from scratch each run.
//
//   node tools/icons/paint-icons.mjs [workDir] [only,these,names]
//
// Needs the `klad` CLI (KLAD=path/to/klad, or klad on PATH). Each icon is a set of parts, back to front; each
// part gets its own flats, a clipped multiply shade and screen rim (`klad light`), and tapered ink (`klad ink`),
// so a part in front covers the outlines behind it. Then white highlights, accent lines, and a group with a
// soft glow and a small drop shadow. Shapes are written on a 24-unit grid and mapped onto the 128 px canvas.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const KLAD = process.env.KLAD ?? 'klad';
const work = resolve(process.argv[2] ?? 'tmp/icons');
const only = process.argv[3]?.split(',');
const out = resolve('src/ui/icons');
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });

const SIZE = 128;
const K = 4.667; // 24 units -> 112 px, 8 px margin for the glow
const O = 8;
const k = (cmd, ...args) => execFileSync(KLAD, [cmd, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const apply = (bundle, ops) => execFileSync(KLAD, ['apply', bundle], { input: ops.map((o) => JSON.stringify(o)).join('\n'), encoding: 'utf8' });

/** Maps an absolute SVG path (M L H V C S Q T Z) from the 24 grid onto the canvas. */
function map(d) {
  const toks = d.match(/[MLHVCSQTZmlhvcsqtz]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const outT = [];
  let cmd = '';
  let i = 0;
  for (const t of toks) {
    if (/[A-Za-z]/.test(t)) {
      if (t !== t.toUpperCase()) throw new Error(`relative command ${t} in ${d}`);
      cmd = t;
      i = 0;
      outT.push(t);
      continue;
    }
    const n = Number(t);
    const isX = cmd === 'H' ? true : cmd === 'V' ? false : i % 2 === 0;
    outT.push(+(O + K * n).toFixed(2));
    if (!isX && cmd !== 'V' && cmd !== 'H') {
      /* y of a pair */
    }
    i++;
  }
  return outT.join(' ');
}
const P = (d) => ({ type: 'path', d: map(d) });
const C = (cx, cy, r, ry = r) => ({ type: 'ellipse', cx: +(O + K * cx).toFixed(2), cy: +(O + K * cy).toFixed(2), rx: +(K * r).toFixed(2), ry: +(K * ry).toFixed(2) });
const star = (cx, cy, ro, ri, n, rot = -Math.PI / 2) => {
  const pts = [];
  for (let j = 0; j < n * 2; j++) {
    const r = j % 2 ? ri : ro;
    const a = rot + (j * Math.PI) / n;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
};

// Colours (lit, shade, ink) per material.
const M = {
  gold: { color: '#ffd23a', shade: '#d4600e', ink: '#6e3600', rim: '#fff6c8' },
  amber: { color: '#ffb53a', shade: '#c8420c', ink: '#6a2a00', rim: '#ffe9b0' },
  water: { color: '#56c8f5', shade: '#1650b0', ink: '#0a3a70', rim: '#e6fbff' },
  glass: { color: '#9fe6ff', shade: '#2a7cc8', ink: '#0a3a70', rim: '#ffffff' },
  leaf: { color: '#7ad84e', shade: '#1d6a3a', ink: '#163f1a', rim: '#efffd0' },
  leafDeep: { color: '#4fb43e', shade: '#164f34', ink: '#163f1a', rim: '#d8ffb8' },
  lotus: { color: '#c4f7a0', shade: '#3f9a5a', ink: '#1d5a2a', rim: '#ffffff' },
  petal: { color: '#f4ffe8', shade: '#6fbf7e', ink: '#2a6a36', rim: '#ffffff' },
  pink: { color: '#ff9cc8', shade: '#b0306e', ink: '#6a1440', rim: '#fff0f6' },
  cream: { color: '#fff4e0', shade: '#8a7aa8', ink: '#4a3a2a', rim: '#ffffff' },
  steel: { color: '#d4e2e8', shade: '#3e5a78', ink: '#22303c', rim: '#ffffff' },
  wood: { color: '#d99456', shade: '#6a2e1a', ink: '#3a1a0a', rim: '#ffe0b8' },
  clay: { color: '#e8805a', shade: '#8a2a2a', ink: '#4a140a', rim: '#ffd8c0' },
  panel: { color: '#4a7cf0', shade: '#1a2470', ink: '#101a4a', rim: '#cfe0ff' },
  dark: { color: '#20363e', shade: '#05121a', ink: '#05121a', rim: '#5a7a88' },
  stone: { color: '#e4ded2', shade: '#6a6080', ink: '#3a3428', rim: '#ffffff' },
  red: { color: '#ff6a52', shade: '#8a1a2a', ink: '#4a0a10', rim: '#ffd8d0' },
};
const part = (mat, shapes, extra = {}) => ({ ...M[mat], ...extra, shapes });

const ICONS = {
  energy: { glow: '#ffc53a', parts: [part('gold', [P('M13.5 1.5 L4.5 13.4 L10.4 13.4 L9.3 22.5 L19.5 9.6 L13.4 9.6 Z')], { depth: 18 })], hi: ['M12.2 4.4 L7.8 10.6'] },
  water: { glow: '#5fd0ff', parts: [part('water', [P('M12 2 C9 6.8 5 10.6 5 14.8 C5 18.6 8.1 21.6 12 21.6 C15.9 21.6 19 18.6 19 14.8 C19 10.6 15 6.8 12 2 Z')], { depth: 20 })], hi: ['M8.4 14.2 C8.2 16.4 9.4 18.2 11.2 18.8'] },
  biomass: { glow: '#8fe36a', parts: [part('leaf', [P('M20 3 C11 3 4.5 7.6 4.5 14.4 C4.5 16.5 5.1 18.3 6.2 19.7 C11.1 19.4 20 15.9 20 3 Z')], { depth: 18 })], lines: [{ d: 'M3.6 21.4 C7 16 11.2 12 16.6 8', color: '#163f1a', w: 4 }], hi: ['M8.6 13.4 C10 10.6 12.6 8.4 16 7'] },
  pulse: {
    glow: '#a8ff86',
    parts: [
      part('leafDeep', [P('M2 15.4 C5 20.4 19 20.4 22 15.4 C17.6 17.6 6.4 17.6 2 15.4 Z')], { depth: 6 }),
      part('lotus', [P('M11.2 18 C7.8 17.4 5 15 4 11.4 C3.3 9.2 3.4 7.8 3.6 7 C6.4 7.8 8.8 9.6 10 12.2 C10.8 14 11.3 16 11.2 18 Z'), P('M12.8 18 C16.2 17.4 19 15 20 11.4 C20.7 9.2 20.6 7.8 20.4 7 C17.6 7.8 15.2 9.6 14 12.2 C13.2 14 12.7 16 12.8 18 Z')], { depth: 10 }),
      part('petal', [P('M12 2.6 C14.8 5.8 15.5 9.2 15.3 12 C15.1 14.6 13.8 16.6 12 18 C10.2 16.6 8.9 14.6 8.7 12 C8.5 9.2 9.2 5.8 12 2.6 Z')], { depth: 10 }),
    ],
    hi: ['M11.6 5.6 C10.6 7.6 10.4 9.6 10.6 11.6'],
  },
  inspect: {
    glow: '#ffd56a',
    parts: [part('wood', [P('M14 15.4 L15.4 14 L21.4 20 L20 21.4 Z')], { depth: 4 }), part('gold', [C(10, 10, 7)], { depth: 8 }), part('glass', [C(10, 10, 4.8)], { depth: 10 })],
    hi: ['M7.4 8.8 C7.8 7.6 8.8 6.8 10 6.6'],
  },
  build: {
    glow: '#ffd56a',
    parts: [part('wood', [P('M10.2 12.4 L11.8 10.8 L21 20 L19.4 21.6 Z')], { depth: 4 }), part('steel', [P('M3 8.4 L8.6 2.8 L13.6 7.8 L11.6 9.8 L10.6 8.8 L8 11.4 L9 12.4 L8 13.4 Z')], { depth: 10 })],
    hi: ['M5 8.2 L8.6 4.6'],
  },
  harvest: { glow: '#ffcf3f', parts: [part('amber', [P(star(12, 12, 10.6, 6.6, 10))], { depth: 8 }), part('gold', [C(12, 12, 5.4)], { depth: 12 })], hi: ['M9.4 10.6 C9.8 9.4 10.8 8.6 12 8.4'] },
  upgrades: { glow: '#8fe36a', parts: [part('leaf', [C(12, 12, 9.6)], { depth: 16 }), part('cream', [P('M12 5 L18 11.2 L14.4 11.2 L14.4 18 L9.6 18 L9.6 11.2 L6 11.2 Z')], { depth: 6 })] },
  home: {
    glow: '#ffd56a',
    parts: [part('cream', [P('M5 11.2 L12 5 L19 11.2 L19 20.6 L5 20.6 Z')], { depth: 10 }), part('clay', [P('M2.4 11.8 L12 3 L21.6 11.8 L19.9 13.6 L12 6.4 L4.1 13.6 Z')], { depth: 4 }), part('wood', [P('M10 20.6 L10 15 L14 15 L14 20.6 Z')], { depth: 4 })],
  },
  garden: {
    glow: '#8fe36a',
    parts: [
      part('leaf', [P('M12 13.4 C12 8.8 8.8 6.2 4.4 6.8 C4.4 10.8 7.4 13.8 12 13.4 Z'), P('M12 12.4 C12 8.4 14.8 5.8 19 6.2 C19 10 16.2 12.6 12 12.4 Z')], { depth: 8 }),
      part('clay', [P('M6.2 13.6 L17.8 13.6 L16.2 21 L7.8 21 Z')], { depth: 8 }),
      part('clay', [P('M5.2 12 L18.8 12 L18.8 14.6 L5.2 14.6 Z')], { depth: 3 }),
    ],
  },
  restore: {
    glow: '#8fe36a',
    parts: [part('wood', [P('M2.6 10 L12 15.6 L12 19.4 L2.6 13.8 Z'), P('M12 15.6 L21.4 10 L21.4 13.8 L12 19.4 Z')], { depth: 4 }), part('leaf', [P('M12 4.4 L21.4 10 L12 15.6 L2.6 10 Z')], { depth: 6 }), part('gold', [P(star(18.6, 4.2, 3.4, 1, 4))], { depth: 2 })],
    lines: [{ d: 'M7.3 7.2 L16.7 12.8 M16.7 7.2 L7.3 12.8', color: '#e8ffd6', w: 3 }],
  },
  solarPanel: {
    glow: '#7fb0ff',
    parts: [part('steel', [P('M11 12.6 L13 12.6 L13 19.6 L11 19.6 Z'), P('M7.6 19 L16.4 19 L16.4 21.2 L7.6 21.2 Z')], { depth: 3 }), part('panel', [P('M2.6 8.6 L15.4 4.6 L21.4 11.2 L8.6 15.2 Z')], { depth: 8 })],
    lines: [{ d: 'M6.9 7.3 L12.9 13.9 M11.2 6 L17.2 12.6 M5.6 11.9 L18.4 7.9', color: '#bcd4ff', w: 2.6 }],
  },
  condenser: {
    glow: '#5fd0ff',
    parts: [part('stone', [P('M5.2 18.4 L18.8 18.4 L18.8 21.2 L5.2 21.2 Z')], { depth: 3 }), part('steel', [P('M6.8 6 C6.8 4.2 8.2 3.2 12 3.2 C15.8 3.2 17.2 4.2 17.2 6 L17.2 17.4 C17.2 19 15.8 19.8 12 19.8 C8.2 19.8 6.8 19 6.8 17.4 Z')], { depth: 10 }), part('water', [P('M9 7.4 L15 7.4 L15 15.8 L9 15.8 Z')], { depth: 6 })],
    hi: ['M10.2 8.8 L10.2 13.6'],
  },
  pollinator: {
    glow: '#ff9cc8',
    parts: [part('leaf', [P('M12 17.4 C10.8 14.6 8.2 13.6 5.6 14.2 C6.4 17 9 18 12 17.4 Z'), P('M12 15.8 C13.2 13 15.8 12 18.4 12.6 C17.6 15.4 15 16.4 12 15.8 Z')], { depth: 4 }), part('pink', [C(12, 4.4, 2.8), C(15.4, 6.9, 2.8), C(14.1, 10.9, 2.8), C(9.9, 10.9, 2.8), C(8.6, 6.9, 2.8)], { depth: 5 }), part('gold', [C(12, 8, 2.2)], { depth: 3 })],
    lines: [{ d: 'M12 21.6 L12 11', color: '#1d5a2a', w: 4 }],
    linesFirst: true,
  },
  droneHub: {
    glow: '#8fe9ff',
    parts: [part('stone', [C(12, 19.4, 9.4, 2.6)], { depth: 3 }), part('leaf', [P('M12 6 C12 3.6 13.8 2.2 16.4 2.4 C16.4 4.8 14.6 6.2 12 6 Z')], { depth: 2 }), part('cream', [C(12, 11.6, 6)], { depth: 10 }), part('dark', [C(12, 12, 4.2, 2.6)], { depth: 2 })],
    dots: [{ cx: 10.4, cy: 12, r: 0.95, color: '#8fe9ff' }, { cx: 13.6, cy: 12, r: 0.95, color: '#8fe9ff' }],
  },
  tree: {
    glow: '#8fe36a',
    parts: [part('wood', [P('M10.6 13 L13.4 13 L13.8 21.6 L10.2 21.6 Z')], { depth: 3 }), part('leafDeep', [C(7.6, 10.6, 4.4), C(16.4, 10.6, 4.4)], { depth: 6 }), part('leaf', [C(12, 6.8, 5.2), C(12, 12.4, 4.6)], { depth: 8 })],
  },
  fountain: {
    glow: '#5fd0ff',
    parts: [part('water', [P('M12 2 C10.6 4 9.8 5.2 9.8 6.4 C9.8 7.6 10.8 8.6 12 8.6 C13.2 8.6 14.2 7.6 14.2 6.4 C14.2 5.2 13.4 4 12 2 Z')], { depth: 3 }), part('stone', [P('M3 15 L21 15 L19 20.8 L5 20.8 Z')], { depth: 6 }), part('water', [P('M4.6 15 L19.4 15 L18.8 16.8 L5.2 16.8 Z')], { depth: 2 })],
    lines: [{ d: 'M12 15 L12 9 M12 10 C9 10 7 12.4 6.4 15 M12 10 C15 10 17 12.4 17.6 15', color: '#2ba0e0', w: 3.4 }],
    linesFirst: true,
  },
  relay: {
    glow: '#ffd56a',
    parts: [
      part('wood', [P('M8 21.8 L10.8 12.4 L12.8 12.4 L15.6 21.8 L13.8 21.8 L11.8 15.4 L9.8 21.8 Z')], { depth: 3 }),
      part('steel', [P('M3.4 9.4 C3.4 14.4 7.6 18 12.6 17.2 L6.6 4.4 C4.6 5.6 3.4 7.4 3.4 9.4 Z')], { depth: 8 }),
      part('gold', [C(9.6, 11.4, 1.6)], { depth: 2 }),
    ],
    lines: [{ d: 'M14.6 3.2 C17.6 3.2 20.4 6 20.4 9 M14.6 6.4 C16 6.4 17.2 7.6 17.2 9', color: '#ffc53a', w: 4.4 }],
  },
  frenzy: {
    glow: '#ffb53a',
    parts: [part('amber', [P('M12 1.6 C13.2 5.4 15.8 6.8 15.8 10 C15.8 12 14.1 13.6 12 13.6 C9.9 13.6 8.2 12 8.2 10 C8.2 8.8 8.7 7.8 9.4 7 C6.6 8.6 4.6 11.4 4.6 15 C4.6 19 7.9 22.2 12 22.2 C16.1 22.2 19.4 19 19.4 15 C19.4 9 14.6 6 12 1.6 Z')], { depth: 14 }), part('gold', [P('M12 12.6 C13.8 14.6 15.2 15.8 15.2 17.8 C15.2 19.6 13.8 20.8 12 20.8 C10.2 20.8 8.8 19.6 8.8 17.8 C8.8 15.8 10.2 14.6 12 12.6 Z')], { depth: 4 })],
  },
  cat: {
    glow: '#ff9cc8',
    parts: [part('cream', [P('M4.2 10.6 L4.8 3 L9.6 6.8 L14.4 6.8 L19.2 3 L19.8 10.6 C19.8 15.8 16.4 19.8 12 19.8 C7.6 19.8 4.2 15.8 4.2 10.6 Z')], { depth: 12 }), part('pink', [P('M6 5.6 L6.4 8.8 L8.4 7.2 Z'), P('M18 5.6 L17.6 8.8 L15.6 7.2 Z')], { depth: 1, ink: null })],
    lines: [
      { d: 'M7.8 12.2 C8.6 11.2 9.8 11.2 10.4 12.2 M13.6 12.2 C14.2 11.2 15.4 11.2 16.2 12.2', color: '#3a2a1a', w: 3.6 },
      { d: 'M6.8 17.6 C9.8 19.6 14.2 19.6 17.2 17.6', color: '#e0402e', w: 5 },
    ],
    dots: [{ cx: 12, cy: 14.4, r: 0.8, color: '#e8559a' }, { cx: 12, cy: 19.6, r: 1.3, color: '#ffd23a' }],
  },
  paw: { glow: '#ff9cc8', parts: [part('pink', [C(12, 15.6, 4.8, 4.1), C(6.2, 10, 2.1, 2.4), C(9.6, 6, 2.1, 2.5), C(14.4, 6, 2.1, 2.5), C(17.8, 10, 2.1, 2.4)], { depth: 5 })] },
  sparkle: { glow: '#ffd56a', parts: [part('gold', [P(star(10, 10, 8.6, 2.4, 4)), P(star(18.6, 17.6, 4, 1.2, 4))], { depth: 6 })] },
  mark: {
    glow: '#ffd56a',
    parts: [
      part('amber', [P(star(12, 9.6, 9.8, 6.8, 9))], { depth: 4 }),
      part('gold', [C(12, 9.6, 5.6)], { depth: 8 }),
      part('leafDeep', [P('M2.2 15.8 C5.2 20.6 18.8 20.6 21.8 15.8 C17.6 17.9 6.4 17.9 2.2 15.8 Z')], { depth: 4 }),
      part('cream', [P('M11.2 18.8 C8 18.2 5.4 16 4.4 12.4 C3.7 10.2 3.8 9 4 8.2 C6.7 9 8.9 10.7 10.1 13.2 C10.9 15 11.3 16.8 11.2 18.8 Z'), P('M12.8 18.8 C16 18.2 18.6 16 19.6 12.4 C20.3 10.2 20.2 9 20 8.2 C17.3 9 15.1 10.7 13.9 13.2 C13.1 15 12.7 16.8 12.8 18.8 Z')], { depth: 8 }),
      part('cream', [P('M12 5 C14.7 8 15.3 11.4 15.1 14 C14.9 16.5 13.7 18.4 12 19.6 C10.3 18.4 9.1 16.5 8.9 14 C8.7 11.4 9.3 8 12 5 Z')], { depth: 8 }),
    ],
  },
};

function build(name, spec) {
  const b = join(work, `${name}.klad`);
  if (existsSync(b)) rmSync(b, { recursive: true, force: true });
  k('new', b, '--width', String(SIZE), '--height', String(SIZE));
  // Layers: a hidden sketch, then a group holding every part's layer set, the accent lines and the highlights.
  const layerOps = [{ op: 'add', layer: { kind: 'vector', name: 'sketch', visible: false } }, { op: 'add', layer: { kind: 'group', name: 'icon' } }];
  const ids = apply(b, layerOps).match(/\b[ln]\d+\b/g);
  const [sketch, group] = ids;
  const want = [];
  if (spec.linesFirst) want.push(['accent', {}]);
  spec.parts.forEach((p, i) => {
    want.push([`p${i}-flats`, {}], [`p${i}-shade`, { clip: true, blend: 'multiply' }], [`p${i}-rim`, { clip: true, blend: 'screen' }], [`p${i}-ink`, {}]);
  });
  if (!spec.linesFirst) want.push(['accent', {}]);
  want.push(['hi', {}]);
  const L = {};
  for (const [nm, props] of want) {
    const r = apply(b, [{ op: 'add', layer: { kind: 'paint', name: nm }, in: group }]);
    L[nm] = r.match(/\bl\d+\b/)[0];
    for (const [key, v] of Object.entries(props)) k('set', b, L[nm], `${key}=${v}`);
  }
  // Shapes, flats, light and ink, part by part.
  const ops = [];
  spec.parts.forEach((p, i) => {
    const sids = p.shapes.map((s, j) => {
      const id = `p${i}s${j}`;
      ops.push({ op: 'add', node: { id, ...s }, in: sketch, frame: 0 });
      return id;
    });
    for (const id of sids) ops.push({ op: 'fill', layer: L[`p${i}-flats`], shape: id, color: p.color });
    ops.push({ op: 'light', from: sids, light: [-1, -1], shade: L[`p${i}-shade`], rim: L[`p${i}-rim`], depth: p.depth ?? 10, soft: 3, rimWidth: 4, shadeColor: p.shade, rimColor: p.rim, shadeOpacity: 0.85, rimOpacity: 0.9 });
    if (p.ink) ops.push({ op: 'ink', layer: L[`p${i}-ink`], from: sids, weight: p.inkW ?? 5, light: [-1, -1], color: p.ink, wobble: 0.4 });
  });
  for (const l of spec.lines ?? []) for (const d of l.d.split(/(?=M)/)) ops.push({ op: 'stroke', layer: L.accent, brush: 'ink', size: l.w, color: l.color, path: map(d.trim()), taper: [6, 10] });
  for (const d of spec.hi ?? []) ops.push({ op: 'stroke', layer: L.hi, brush: 'soft', size: 6, color: '#ffffff', path: map(d), pressure: [0.3, 1, 0.2] });
  for (const d of spec.dots ?? []) ops.push({ op: 'add', node: { id: `dot${ops.length}`, ...C(d.cx, d.cy, d.r) }, in: sketch, frame: 0 }, { op: 'fill', layer: L.hi, shape: `dot${ops.length}`, color: d.color });
  apply(b, ops);
  k('set', b, group, `effects=${JSON.stringify([{ shadow: { x: 0, y: 3, radius: 4, color: '#0a1a1c88' } }, { glow: { radius: 10, strength: 0.75, color: spec.glow } }])}`);
  k('export', b, '--layer', group, '--scale', '0.75', '-o', join(out, `${name}.png`));
  k('export', b, '--layer', group, '--scale', '0.375', '-o', join(out, `${name}@1x.png`));
  return b;
}

for (const [name, spec] of Object.entries(ICONS)) {
  if (only && !only.includes(name)) continue;
  try {
    build(name, spec);
    console.log(`painted ${name}`);
  } catch (e) {
    console.error(`failed ${name}: ${e.stderr || e.message}`);
    process.exitCode = 1;
  }
}
