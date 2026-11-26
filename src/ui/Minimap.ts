import { PARK_SET, REGIONS, type RegionDef } from '../data/oldcity';
import { WAYMARK } from '../data/waymark';
import { GROUND } from '../core/GameState';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import type { GoalSpot } from './GoalSpot';
import { regionProgress } from './RegionProgress';

/**
 * Bloombot (G.14) / E23.11: the round map at the bottom left, painted like the Sunlit Glass board
 * (docs/art/ui-sunlit-glass/Walk.dc.html): a white rim, soft grass, wide sandy paths with a darker edge, water,
 * bush clusters and flowers where the ground is lush, little pink roofs on buildings, the dead ground in orange-red
 * earth and the fog pale. North (−z) is up and bloombot's orange chevron sits in the middle; the N badge on top and
 * the clock and weather on the rim.
 *
 * It is painted from tile and area state into a small 2D canvas, never by rendering the scene again (no draw
 * calls). The cells repaint when bloombot crosses a cell or after a moment; between repaints the painted map
 * slides under the chevron so walking is smooth. The paper grain is made once and reused.
 *
 * E24 (#609): the way is marked. The current goal carries the goal card's own pin (a gold badge; on the rim,
 * pointing the way, when it is off the map), every way into a shut region is drawn as a little barricade, and the
 * regions behind them show through the fog, hatched, from the very start: the player sees the locked doors early.
 */
const CELLS = 56; // cells across the visible disc
const M = CELLS + 2; // cells painted (one spare each side, so the map can slide by a fraction of a cell)
const RES = 4; // canvas pixels per cell
const VIEW = 178; // the disc's size in CSS pixels
const CELL_CSS = VIEW / CELLS;
const EVERY = 0.5; // seconds between repaints while standing still (state changes: restored ground, machines)

/** The map's paint: CSS tokens (`--mm-*` in styles.css), read once. */
const TOKENS = ['rim', 'grass', 'grass-hi', 'dead', 'dead-2', 'path', 'path-edge', 'water', 'water-hi', 'bush', 'bush-hi', 'roof', 'wall', 'fog', 'edge', 'flower', 'flower-2', 'flower-3', 'cliff', 'landmark', 'landmark-off', 'cache', 'pile', 'ring', 'grain', 'sealed', 'sealed-line', 'gate', 'gate-ink'] as const;
type Paint = Record<(typeof TOKENS)[number], string>;
type RGB = [number, number, number];

function readPaint(): Paint {
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : undefined;
  const p = {} as Paint;
  for (const t of TOKENS) p[t] = cs?.getPropertyValue(`--mm-${t}`).trim() || 'gray';
  return p;
}

/** A colour string to RGB (hex or rgb(); the tokens are written that way). */
function rgb(c: string): RGB {
  const h = /^#([0-9a-f]{6})$/i.exec(c);
  if (h) return [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)) as RGB;
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) return m[1].split(',').slice(0, 3).map((x) => Number(x.trim())) as RGB;
  return [128, 128, 128];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** What a cell is drawn as. */
const K = { Fog: 0, Frontier: 1, Dead: 2, Growing: 3, Grass: 4, Lush: 5, Bush: 6, Water: 7, Path: 8, Building: 9, Rock: 10, Machine: 11, Sealed: 12 } as const;
type Kind = (typeof K)[keyof typeof K];

export interface MinimapView {
  roofId: string;
  /** bloombot's position (layer cells) and facing (radians, 0 = +z) */
  x: number;
  z: number;
  facing: number;
}

/**
 * E24 (#609): where the goal's pin sits on the disc (CSS px from its top left), and whether it waits on the rim
 * (the goal is off the map). Undefined when there is nothing to pin: no goal, another layer, or bloombot is there.
 */
export function pinAt(v: MinimapView, goal: GoalSpot | undefined): { x: number; y: number; edge: boolean } | undefined {
  if (!goal || goal.roofId !== v.roofId || Math.hypot(goal.x - v.x, goal.z - v.z) <= WAYMARK.near) return undefined;
  const half = VIEW / 2;
  let dx = (goal.x - v.x) * CELL_CSS;
  let dy = (goal.z - v.z) * CELL_CSS;
  const r = Math.hypot(dx, dy);
  // the N badge (top) and the clock (bottom) sit over the rim: the pin keeps further in there
  const max = half - WAYMARK.rimInset - WAYMARK.rimBadges * Math.abs(dy / Math.max(r, 1e-6)) ** 6;
  const edge = r > max;
  if (edge) {
    dx *= max / r;
    dy *= max / r;
  }
  return { x: half + dx, y: half + dy, edge };
}

/** E24 (#609): the regions still shut behind their gates (each gate drawn on the map, the region hatched). */
export function shutRegions(sim: Sim): RegionDef[] {
  return REGIONS.filter((r) => !sim.gates.isOpen(r.gate.id));
}

/** Weather kinds to the rim's little icon. */
const WX: Record<string, string> = { sunny: 'i-sun', cloudy: 'i-cloud', rain: 'i-rain', wind: 'i-wind', storm: 'i-storm', fog: 'i-fog' };

export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  /** one pixel per cell: the ground's colours, scaled up smoothly into soft painted patches */
  private base: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D | null;
  private img?: ImageData;
  /** the paper grain over the paint (made once) */
  private grain?: HTMLCanvasElement;
  private kinds = new Uint8Array(M * M);
  private paint: Paint;
  private col: Record<'fog' | 'dead' | 'grass' | 'lush' | 'water' | 'path' | 'wall' | 'rock' | 'frontier' | 'growing' | 'sealed', RGB>;
  private bot: SVGElement;
  private wx: HTMLElement;
  private time: HTMLElement;
  private rimEl: HTMLElement;
  private t = EVERY;
  private x0 = NaN;
  private z0 = NaN;
  private roof = '';
  /** E24 (#609): the goal's pin, and what it is called (for the map's label) */
  private pin: HTMLElement;
  private pinName = '';

  constructor(
    private sim: Sim,
    parent: HTMLElement,
    /** landmarks that want attention right now (ready to wake) */
    private ready: (id: string) => boolean,
  ) {
    const el = document.createElement('div');
    el.id = 'minimap';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Map around bloombot, north up');
    const px = M * RES;
    el.innerHTML =
      `<div class="mm-disc"><canvas class="mm-map" width="${px}" height="${px}" style="width:${(M * CELL_CSS).toFixed(2)}px;height:${(M * CELL_CSS).toFixed(2)}px"></canvas>` +
      `<span class="mm-shadow" aria-hidden="true"></span>` +
      `<span class="mm-goal" hidden aria-hidden="true"><span class="sg-ic i-pin"></span></span>` +
      `<svg class="mm-bot" viewBox="-17 -17 34 34" aria-hidden="true"><defs><linearGradient id="mmArrow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="mm-a1"/><stop offset="1" class="mm-a2"/></linearGradient></defs>` +
      `<path class="mm-fill" d="M0 -15 L14 12 L0 5 L-14 12 Z" fill="url(#mmArrow)" stroke-width="4" stroke-linejoin="round" paint-order="stroke"/>` +
      `<path class="mm-ink" d="M0 -15 L14 12 L0 5 L-14 12 Z" fill="none" stroke-width="1.6" stroke-linejoin="round"/></svg></div>` +
      `<span class="mm-n" aria-hidden="true">N</span>` +
      `<span class="mm-rim" hidden><span class="sg-ic s mm-wx" aria-hidden="true"></span><span class="mm-time"></span></span>`;
    parent.appendChild(el);
    this.el = el;
    this.canvas = el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = M;
    this.bctx = this.base.getContext('2d');
    this.bot = el.querySelector('.mm-bot')!;
    this.rimEl = el.querySelector('.mm-rim')!;
    this.wx = el.querySelector('.mm-wx')!;
    this.time = el.querySelector('.mm-time')!;
    this.pin = el.querySelector('.mm-goal')!;
    this.paint = readPaint();
    const p = this.paint;
    const dead = rgb(p.dead);
    const grass = rgb(p.grass);
    const fog = rgb(p.fog);
    this.col = {
      fog,
      frontier: mix(fog, dead, 0.45),
      dead,
      growing: mix(dead, grass, 0.55),
      grass,
      lush: rgb(p['grass-hi']),
      water: rgb(p.water),
      path: rgb(p.path),
      wall: rgb(p.wall),
      rock: rgb(p['dead-2']),
      sealed: rgb(p.sealed),
    };
    document.body.classList.add('has-minimap');
  }

  private kind(t: TileData | undefined, hidden: boolean, frontier: boolean, sealed: boolean): Kind {
    if (hidden || !t) return sealed ? K.Sealed : K.Fog;
    if (t.occupantId) return K.Machine;
    if (t.feature === 'water') return K.Water;
    if (t.feature === 'building') return K.Building;
    if (frontier && t.ground !== 'restored') return K.Frontier;
    if (t.blocked) return t.ground === 'restored' ? K.Bush : K.Rock;
    if (t.feature === 'road' || t.feature === 'paving') return K.Path;
    if (t.ground === 'restored') return t.plant === 'grove' || t.bloom >= 3 ? K.Bush : t.bloom >= 2 || t.plant ? K.Lush : K.Grass;
    if (t.ground === 'growing') return K.Growing;
    return K.Dead;
  }

  private baseColour(k: number): RGB {
    const c = this.col;
    switch (k) {
      case K.Fog:
        return c.fog;
      case K.Sealed:
        return c.sealed;
      case K.Frontier:
        return c.frontier;
      case K.Growing:
        return c.growing;
      case K.Grass:
      case K.Bush:
        return c.grass;
      case K.Lush:
        return c.lush;
      case K.Water:
        return c.water;
      case K.Path:
        return c.path;
      case K.Building:
      case K.Machine:
        return c.wall;
      case K.Rock:
        return c.rock;
      default:
        return c.dead;
    }
  }

  update(dt: number, v: MinimapView, goal?: GoalSpot) {
    // The chevron turns every frame and the painted map slides under it; the cells repaint on a new cell or a timer.
    this.bot.style.transform = `rotate(${180 - (v.facing * 180) / Math.PI}deg)`;
    this.placePin(v, goal);
    const x0 = Math.floor(v.x) - CELLS / 2 - 1;
    const z0 = Math.floor(v.z) - CELLS / 2 - 1;
    this.canvas.style.transform = `translate(${(VIEW / 2 - (v.x - x0) * CELL_CSS).toFixed(2)}px, ${(VIEW / 2 - (v.z - z0) * CELL_CSS).toFixed(2)}px)`;
    this.t += dt;
    if (this.t < EVERY && x0 === this.x0 && z0 === this.z0 && v.roofId === this.roof) return;
    this.t = 0;
    this.x0 = x0;
    this.z0 = z0;
    this.roof = v.roofId;
    this.rim();
    this.repaint(v.roofId, x0, z0);
  }

  private repaint(roofId: string, x0: number, z0: number) {
    const ctx = this.ctx;
    const bctx = this.bctx;
    if (!ctx || !bctx) return;
    const g = this.sim.grid;
    const areas = this.sim.areas;
    const ground = roofId === GROUND;
    const fogOf = new Map<string, string>();
    // E24 (#609): the regions still shut behind their gates show through the fog from the start
    const shut = new Set<string>(ground ? shutRegions(this.sim).filter((r) => r.gate.opensRegion !== false).map((r) => r.id) : []);
    let anySealed = false;
    const kinds = this.kinds;
    const tiles: (TileData | undefined)[] = new Array(M * M);
    this.img ??= bctx.createImageData(M, M);
    const d = this.img.data;
    for (let j = 0; j < M; j++)
      for (let i = 0; i < M; i++) {
        const cx = x0 + i;
        const cz = z0 + j;
        let hidden = false;
        let frontier = false;
        let sealed = false;
        if (ground) {
          const a = areas.map.areaOfCell(cx, cz);
          sealed = shut.has(a);
          let f = fogOf.get(a);
          if (f === undefined) fogOf.set(a, (f = areas.fog(a)));
          hidden = f === 'hidden';
          frontier = f === 'frontier';
        } else if (!g.inBounds(roofId, cx, cz)) hidden = true;
        // peek, not get: the map must never generate chunks.
        const t = hidden ? undefined : g.peek(roofId, cx, cz);
        const k = this.kind(t, hidden, frontier, sealed);
        if (k === K.Sealed) anySealed = true;
        const n = j * M + i;
        kinds[n] = k;
        tiles[n] = t;
        const c = this.baseColour(k);
        // E21.24: terraces shade by level (higher is lighter)
        const shade = t?.level === undefined ? 1 : 0.86 + 0.07 * t.level;
        const q = n * 4;
        d[q] = Math.min(255, c[0] * shade);
        d[q + 1] = Math.min(255, c[1] * shade);
        d[q + 2] = Math.min(255, c[2] * shade);
        d[q + 3] = 255;
      }
    bctx.putImageData(this.img, 0, 0);
    // the ground: one pixel per cell, scaled up smoothly into soft patches
    const W = M * RES;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.base, 0, 0, W, W);
    const p = this.paint;
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= M || j >= M ? K.Fog : kinds[j * M + i]);
    const cx = (i: number) => (i + 0.5) * RES;

    // E24 (#609): the shut regions, hatched, so they read as "not yet" rather than as more fog. The stripes are laid
    // by world cell (x + z), so they hold still as the map slides.
    if (anySealed) {
      ctx.strokeStyle = p['sealed-line'];
      ctx.lineWidth = 1.1;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (let j = 0; j < M; j++)
        for (let i = 0; i < M; i++) {
          if (kinds[j * M + i] !== K.Sealed || (((x0 + i + z0 + j) % 3) + 3) % 3 !== 0) continue;
          ctx.moveTo(i * RES, (j + 1) * RES);
          ctx.lineTo((i + 1) * RES, j * RES);
        }
      ctx.stroke();
    }

    // paths: wide sandy lanes with a darker edge (each path cell joins its path neighbours)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [colour, w] of [
      [p['path-edge'], RES * 1.25],
      [p.path, RES * 0.92],
    ] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (let j = 0; j < M; j++)
        for (let i = 0; i < M; i++) {
          if (kinds[j * M + i] !== K.Path) continue;
          ctx.moveTo(cx(i), cx(j));
          ctx.lineTo(cx(i) + 0.01, cx(j));
          if (at(i + 1, j) === K.Path) ctx.lineTo(cx(i + 1), cx(j));
          if (at(i, j + 1) === K.Path) {
            ctx.moveTo(cx(i), cx(j));
            ctx.lineTo(cx(i), cx(j + 1));
          }
        }
      ctx.stroke();
    }

    // water: soft round edges with a lighter middle
    ctx.fillStyle = p.water;
    ctx.beginPath();
    for (let n = 0; n < M * M; n++) if (kinds[n] === K.Water) this.dot(ctx, cx(n % M), cx((n / M) | 0), RES * 0.78);
    ctx.fill();
    ctx.fillStyle = p['water-hi'];
    ctx.beginPath();
    for (let j = 0; j < M; j++)
      for (let i = 0; i < M; i++)
        if (kinds[j * M + i] === K.Water && at(i - 1, j) === K.Water && at(i + 1, j) === K.Water && at(i, j - 1) === K.Water && at(i, j + 1) === K.Water) this.dot(ctx, cx(i) - 0.5, cx(j) - 0.5, RES * 0.6);
    ctx.fill();

    // buildings: cream walls with a pink roof (the roof steps in from the outer walls); machines as little kiosks
    for (let j = 0; j < M; j++)
      for (let i = 0; i < M; i++) {
        const k = kinds[j * M + i];
        if (k !== K.Building && k !== K.Machine) continue;
        const x = i * RES;
        const y = j * RES;
        ctx.fillStyle = p.wall;
        ctx.fillRect(x, y, RES, RES);
        if (k === K.Machine) {
          ctx.strokeStyle = p.edge;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, RES - 1, RES - 1);
          continue;
        }
        const e = RES * 0.28;
        const l = at(i - 1, j) === K.Building ? 0 : e;
        const r = at(i + 1, j) === K.Building ? 0 : e;
        const tp = at(i, j - 1) === K.Building ? 0 : e;
        const b = at(i, j + 1) === K.Building ? 0 : e;
        ctx.fillStyle = p.roof;
        ctx.fillRect(x + l, y + tp, RES - l - r, RES - tp - b);
      }

    // lush ground: bush clusters and flowers, placed by each tile's own seed so they hold still between repaints
    ctx.fillStyle = p.bush;
    ctx.beginPath();
    for (let n = 0; n < M * M; n++) if (kinds[n] === K.Bush) this.dot(ctx, cx(n % M), cx((n / M) | 0), RES * 0.85);
    ctx.fill();
    ctx.fillStyle = p['bush-hi'];
    ctx.beginPath();
    for (let n = 0; n < M * M; n++) if (kinds[n] === K.Bush) this.dot(ctx, cx(n % M) - RES * 0.22, cx((n / M) | 0) - RES * 0.22, RES * 0.36);
    ctx.fill();
    const flowers = [p.flower, p['flower-2'], p['flower-3']];
    for (let f = 0; f < 3; f++) {
      ctx.fillStyle = flowers[f];
      ctx.beginPath();
      for (let n = 0; n < M * M; n++) {
        const t = tiles[n];
        if (kinds[n] !== K.Lush || !t || t.variant % 3 !== f || (t.variant >> 2) % 2) continue;
        this.dot(ctx, cx(n % M) + ((t.variant % 5) - 2) * 0.4, cx((n / M) | 0) + ((t.variant % 7) - 3) * 0.3, RES * 0.22);
      }
      ctx.fill();
    }
    // dead ground: darker clods here and there
    ctx.fillStyle = p['dead-2'];
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let n = 0; n < M * M; n++) {
      const t = tiles[n];
      if (kinds[n] === K.Dead && t && t.variant % 9 === 0) this.dot(ctx, cx(n % M), cx((n / M) | 0), RES * 0.4);
    }
    ctx.fill();
    ctx.globalAlpha = 1;

    // E21.24: a soft line along each cliff's foot
    ctx.strokeStyle = p.cliff;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let j = 0; j < M; j++)
      for (let i = 0; i < M; i++) {
        const t = tiles[j * M + i];
        const lv = t?.level;
        if (!t || lv === undefined || t.ramp) continue;
        if ((g.peek(roofId, x0 + i - 1, z0 + j)?.level ?? lv) > lv + 0.5) {
          ctx.moveTo(i * RES, j * RES);
          ctx.lineTo(i * RES, (j + 1) * RES);
        }
        if ((g.peek(roofId, x0 + i, z0 + j - 1)?.level ?? lv) > lv + 0.5) {
          ctx.moveTo(i * RES, j * RES);
          ctx.lineTo((i + 1) * RES, j * RES);
        }
      }
    ctx.stroke();

    // the paper grain
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.16;
    ctx.drawImage(this.grainTexture(W), 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    this.marks(ctx, roofId, x0, z0);
  }

  /** A shut way in: a short plank bar across the way, with two dark cross planks. `across`: lying east–west. */
  private barricade(ctx: CanvasRenderingContext2D, x: number, y: number, across: boolean) {
    const p = this.paint;
    const L = 15;
    const T = 7;
    const w = across ? L : T;
    const h = across ? T : L;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 2);
    ctx.fillStyle = p.gate;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = p['gate-ink'];
    ctx.stroke();
    ctx.beginPath();
    ctx.lineWidth = 1.3;
    const a = across ? L * 0.3 : T * 0.3;
    const b = across ? T * 0.3 : L * 0.3;
    ctx.moveTo(x - a, y - b);
    ctx.lineTo(x + a, y + b);
    ctx.moveTo(x - a, y + b);
    ctx.lineTo(x + a, y - b);
    ctx.stroke();
  }

  /**
   * E24 (#609): the goal's pin, every frame (it slides with the map). On the map it stands on the goal; off the map it
   * waits on the rim in the goal's direction. Under bloombot's chevron (arrived) it hides.
   */
  private placePin(v: MinimapView, goal: GoalSpot | undefined) {
    const pin = this.pin;
    const at = pinAt(v, goal);
    if (pin.hidden === !!at) pin.hidden = !at;
    const name = at ? goal!.name : '';
    if (name !== this.pinName) {
      this.pinName = name;
      this.el.setAttribute('aria-label', name ? `Map around bloombot, north up. The pin marks ${name}.` : 'Map around bloombot, north up');
    }
    if (!at) return;
    pin.classList.toggle('edge', at.edge);
    // a place to rest wears the goal card's low-charge badge: the sun with a battery
    const rest = goal!.kind === 'rest';
    if (pin.classList.contains('rest') !== rest) {
      pin.classList.toggle('rest', rest);
      pin.innerHTML = `<span class="sg-ic ${rest ? 'i-cell' : 'i-pin'}"></span>`;
    }
    pin.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
  }

  private dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  /** The paper grain: speckled noise, made once. */
  private grainTexture(w: number): HTMLCanvasElement {
    if (this.grain) return this.grain;
    const c = document.createElement('canvas');
    c.width = c.height = w;
    const gx = c.getContext('2d');
    if (gx) {
      const img = gx.createImageData(w, w);
      const [r, g, b] = rgb(this.paint.grain);
      let seed = 1234567;
      for (let q = 0; q < img.data.length; q += 4) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const a = (seed >> 8) & 255;
        img.data[q] = r;
        img.data[q + 1] = g;
        img.data[q + 2] = b;
        img.data[q + 3] = a < 150 ? 0 : a;
      }
      gx.putImageData(img, 0, 0);
    }
    return (this.grain = c);
  }

  /** Landmarks (sun gold when awake, a white ring when ready to wake), the beacons, the caches and the shut ways in. */
  private marks(ctx: CanvasRenderingContext2D, roofId: string, x0: number, z0: number) {
    const areas = this.sim.areas;
    const p = this.paint;
    const inside = (i: number, j: number) => i >= 0 && j >= 0 && i <= M && j <= M;
    // E24 (#609): every way into a shut region, from the start, fog or no fog: a little barricade of planks
    if (roofId === GROUND)
      for (const r of shutRegions(this.sim)) {
        const xs = r.gate.cells.map((c) => c[0]);
        const zs = r.gate.cells.map((c) => c[1]);
        const gx0 = Math.min(...xs) - x0;
        const gz0 = Math.min(...zs) - z0;
        const gw = Math.max(...xs) - Math.min(...xs) + 1;
        const gd = Math.max(...zs) - Math.min(...zs) + 1;
        if (!inside(gx0 + gw / 2, gz0 + gd / 2)) continue;
        this.barricade(ctx, (gx0 + gw / 2) * RES, (gz0 + gd / 2) * RES, gw >= gd);
      }
    // E21.9: Mast Row's reward shows every Old City landmark beacon (amber), Observatory Hill's every cache
    if (this.sim.landmarks.has('beacons') && roofId === GROUND)
      for (const r of REGIONS) {
        if (areas.fog(r.id) !== 'hidden') continue;
        const i = r.landmark.x + 1 - x0;
        const j = r.landmark.z + 1 - z0;
        if (!inside(i, j)) continue;
        ctx.beginPath();
        ctx.arc(i * RES, j * RES, 5, 0, Math.PI * 2);
        ctx.fillStyle = p.landmark;
        ctx.fill();
      }
    // #624: Keen eye at its last level shows every pile with something left in it (a small gold dot) and every unopened
    // cache, in the park and the regions already open (a shut region stays a hatched mystery)
    const keen = !!this.sim.upgrades?.findsOnMap;
    const open = keen ? REGIONS.filter((r) => this.sim.gates.isOpen(r.gate.id)) : [];
    if (keen && roofId === GROUND)
      for (const pile of [...PARK_SET.piles, ...open.flatMap((r) => r.piles)]) {
        if (this.sim.salvage.left(pile.id) <= 0) continue;
        const i = pile.x + 0.5 - x0;
        const j = pile.z + 0.5 - z0;
        if (!inside(i, j)) continue;
        ctx.beginPath();
        ctx.arc(i * RES, j * RES, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = p.pile;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = p['dead-2'];
        ctx.stroke();
      }
    if ((keen || this.sim.landmarks.has('starLens')) && roofId === GROUND)
      for (const c of (this.sim.landmarks.has('starLens') ? REGIONS : open).flatMap((r) => r.caches)) {
        if (this.sim.state.salvage?.caches.includes(c.id)) continue;
        const i = c.x + 0.5 - x0;
        const j = c.z + 0.5 - z0;
        if (!inside(i, j)) continue;
        ctx.fillStyle = p.cache;
        ctx.strokeStyle = p['dead-2'];
        ctx.lineWidth = 1;
        ctx.fillRect(i * RES - 3, j * RES - 3, 6, 6);
        ctx.strokeRect(i * RES - 3, j * RES - 3, 6, 6);
      }
    for (const m of this.sim.state.machines) {
      if (m.type !== 'core' || m.roofId !== roofId) continue;
      const i = m.x + m.size / 2 - x0;
      const j = m.z + m.size / 2 - z0;
      if (!inside(i, j)) continue;
      const id = areas.areaOf(m);
      const awake = !!id && areas.fog(id) === 'cleared';
      ctx.beginPath();
      ctx.arc(i * RES, j * RES, 6, 0, Math.PI * 2);
      ctx.fillStyle = awake ? p.landmark : p['landmark-off'];
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = p.ring;
      if (awake || this.ready(m.id)) ctx.stroke();
      if (id && areas.fog(id) !== 'hidden') {
        const { green, target, complete } = regionProgress(this.sim, id);
        const x = i * RES, y = j * RES;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.strokeStyle = p['landmark-off'];
        ctx.lineWidth = 4;
        ctx.stroke();
        if (green > 0) {
          ctx.beginPath();
          ctx.arc(x, y, 10, -Math.PI / 2, (green / target) * Math.PI * 2 - Math.PI / 2);
          ctx.strokeStyle = p['grass-hi'];
          ctx.stroke();
        }
        if (complete) {
          ctx.beginPath();
          ctx.moveTo(x - 3.5, y);
          ctx.lineTo(x - 1, y + 2.5);
          ctx.lineTo(x + 4, y - 3);
          ctx.strokeStyle = p.ring;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
  }

  /**
   * E22.5: the clock and the weather on the map's rim. E23.7.1: the clock is the light clock (the real time in
   * "follow my clock" mode); the weather (E23.7.2) is shown when it exists, with its little picture. Read only.
   */
  private rim() {
    const c = this.sim.clock;
    const w = this.sim.weather.label();
    const kind = this.sim.weather.kind();
    const time = `${String(c.hour()).padStart(2, '0')}:${String(c.minute()).padStart(2, '0')}`;
    const text = w ? `${time} · ${w}` : time;
    if (this.time.textContent !== text) {
      this.time.textContent = text;
      this.rimEl.setAttribute('aria-label', `Time ${time}${w ? `, ${w}` : ''}`);
    }
    if (this.rimEl.hidden) this.rimEl.hidden = false;
    const icon = kind === 'sunny' && c.isNight() ? 'i-moon' : (WX[kind] ?? 'i-sun');
    if (!this.wx.classList.contains(icon)) this.wx.className = `sg-ic s mm-wx ${icon}`;
  }

  set visible(on: boolean) {
    this.el.hidden = !on;
    document.body.classList.toggle('has-minimap', on);
  }

  destroy() {
    this.el.remove();
    document.body.classList.remove('has-minimap');
  }
}
