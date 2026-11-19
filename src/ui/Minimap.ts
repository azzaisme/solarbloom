import { REGIONS } from '../data/oldcity';
import { GROUND } from '../core/GameState';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';

/**
 * Bloombot (G.14): the round map at the bottom left, as in the owner's mock. North (−z) is up and bloombot's
 * arrow sits in the middle. It is painted from tile and area state into a small 2D canvas a few times a second,
 * never by rendering the scene again, so it costs no draw calls.
 */
const CELLS = 56; // cells across the map
const PX = 3; // canvas pixels per cell
const EVERY = 0.25; // seconds between repaints

/** Map colours: chosen to read on the dark glass, by what a cell is. */
const C = {
  fog: [28, 33, 44],
  frontier: [92, 96, 102],
  dead: [150, 142, 128],
  growing: [150, 176, 98],
  restored: [96, 178, 92],
  bloom: [70, 160, 84],
  water: [86, 160, 206],
  solid: [74, 70, 66],
  machine: [240, 236, 222],
  road: [124, 120, 114],
} as const;

export interface MinimapView {
  roofId: string;
  /** bloombot's position (layer cells) and facing (radians, 0 = +z) */
  x: number;
  z: number;
  facing: number;
}

export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private img?: ImageData;
  private arrow: HTMLElement;
  private t = EVERY;

  constructor(
    private sim: Sim,
    parent: HTMLElement,
    /** landmarks that want attention right now (ready to wake) */
    private ready: (id: string) => boolean,
  ) {
    const el = document.createElement('div');
    el.id = 'minimap';
    el.className = 'panel';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Map around bloombot, north up');
    el.innerHTML = `<canvas width="${CELLS * PX}" height="${CELLS * PX}"></canvas><span class="mm-n" aria-hidden="true">N</span><span class="mm-arrow" aria-hidden="true"></span><span class="mm-rim" hidden></span>`;
    parent.appendChild(el);
    this.el = el;
    this.canvas = el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d');
    this.arrow = el.querySelector('.mm-arrow')!;
    document.body.classList.add('has-minimap');
  }

  private colour(t: TileData | undefined, hidden: boolean): readonly number[] {
    if (hidden || !t) return C.fog;
    if (t.occupantId) return C.machine;
    if (t.feature === 'water') return C.water;
    if (t.blocked || t.feature === 'building') return C.solid;
    if (t.ground === 'restored') return t.bloom >= 2 ? C.bloom : C.restored;
    if (t.ground === 'growing') return C.growing;
    if (t.feature === 'road') return C.road;
    return C.dead;
  }

  update(dt: number, v: MinimapView) {
    // The arrow turns every frame; the cells repaint a few times a second.
    this.arrow.style.transform = `translate(-50%, -50%) rotate(${180 - (v.facing * 180) / Math.PI}deg)`;
    this.t += dt;
    if (this.t < EVERY || !this.ctx) return;
    this.t = 0;
    this.rim();
    const W = CELLS * PX;
    this.img ??= this.ctx.createImageData(W, W);
    const d = this.img.data;
    const g = this.sim.grid;
    const areas = this.sim.areas;
    const x0 = Math.floor(v.x) - CELLS / 2;
    const z0 = Math.floor(v.z) - CELLS / 2;
    const ground = v.roofId === GROUND;
    const fogOf = new Map<string, string>();
    for (let j = 0; j < CELLS; j++)
      for (let i = 0; i < CELLS; i++) {
        const cx = x0 + i;
        const cz = z0 + j;
        let hidden = false;
        let frontier = false;
        if (ground) {
          const a = areas.map.areaOfCell(cx, cz);
          let f = fogOf.get(a);
          if (f === undefined) fogOf.set(a, (f = areas.fog(a)));
          hidden = f === 'hidden';
          frontier = f === 'frontier';
        } else if (!g.inBounds(v.roofId, cx, cz)) hidden = true;
        // peek, not get: the map must never generate chunks.
        const t = hidden ? undefined : g.peek(v.roofId, cx, cz);
        const c = frontier && t && t.ground !== 'restored' && !t.occupantId ? C.frontier : this.colour(t, hidden);
        // E21.24: terraces shade by level (higher is lighter), with a dark line along each cliff's foot
        const lv = t?.level;
        const shade = lv === undefined ? 1 : 0.82 + 0.09 * lv;
        const cliffW = t && lv !== undefined && !t.ramp && ((g.peek(v.roofId, cx - 1, cz)?.level ?? lv) > lv + 0.5);
        const cliffN = t && lv !== undefined && !t.ramp && ((g.peek(v.roofId, cx, cz - 1)?.level ?? lv) > lv + 0.5);
        for (let py = 0; py < PX; py++)
          for (let px = 0; px < PX; px++) {
            const k = ((j * PX + py) * W + i * PX + px) * 4;
            const line = (cliffW && px === 0) || (cliffN && py === 0) ? 0.45 : 1;
            d[k] = Math.min(255, c[0] * shade * line);
            d[k + 1] = Math.min(255, c[1] * shade * line);
            d[k + 2] = Math.min(255, c[2] * shade * line);
            d[k + 3] = 255;
          }
      }
    this.ctx.putImageData(this.img, 0, 0);
    // E21.9: Mast Row's reward shows every Old City landmark beacon (amber), Observatory Hill's every cache
    if (this.sim.landmarks.has('beacons') && v.roofId === GROUND)
      for (const r of REGIONS) {
        if (areas.fog(r.id) !== 'hidden') continue;
        const i = r.landmark.x + 1 - x0;
        const j = r.landmark.z + 1 - z0;
        if (i < 0 || j < 0 || i > CELLS || j > CELLS) continue;
        this.ctx.beginPath();
        this.ctx.arc(i * PX, j * PX, 4, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgb(232, 168, 64)';
        this.ctx.fill();
      }
    if (this.sim.landmarks.has('starLens') && v.roofId === GROUND)
      for (const c of REGIONS.flatMap((r) => r.caches)) {
        if (this.sim.state.salvage?.caches.includes(c.id)) continue;
        const i = c.x + 0.5 - x0;
        const j = c.z + 0.5 - z0;
        if (i < 0 || j < 0 || i > CELLS || j > CELLS) continue;
        this.ctx.fillStyle = 'rgb(240, 220, 150)';
        this.ctx.fillRect(i * PX - 2, j * PX - 2, 4, 4);
      }
    // Landmarks: gold when awake, a white ring when ready to wake (it needs you).
    for (const m of this.sim.state.machines) {
      if (m.type !== 'core' || m.roofId !== v.roofId) continue;
      const i = m.x + m.size / 2 - x0;
      const j = m.z + m.size / 2 - z0;
      if (i < 0 || j < 0 || i > CELLS || j > CELLS) continue;
      const id = areas.areaOf(m);
      const awake = !!id && areas.fog(id) === 'cleared';
      this.ctx.beginPath();
      this.ctx.arc(i * PX, j * PX, 5, 0, Math.PI * 2);
      this.ctx.fillStyle = awake ? 'rgb(244, 196, 72)' : 'rgb(120, 112, 100)';
      this.ctx.fill();
      if (!awake && this.ready(m.id)) {
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = 'rgb(255, 255, 255)';
        this.ctx.stroke();
      }
    }
  }

  /**
   * E22.5: the clock and the weather on the map's rim. E23.7.1: the clock is the light clock (the real time in
   * "follow my clock" mode); the weather (E23.7.2) is shown when it exists. Read only.
   */
  private rim() {
    const rim = this.el.querySelector<HTMLElement>('.mm-rim');
    if (!rim) return;
    const c = this.sim.clock;
    const w = this.sim.weather.label();
    const text = `${String(c.hour()).padStart(2, '0')}:${String(c.minute()).padStart(2, '0')}${w ? ` ${w}` : ''}`;
    rim.hidden = !text;
    if (rim.textContent !== text) rim.textContent = text;
    rim.setAttribute('aria-label', text ? `Time ${text}` : '');
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
