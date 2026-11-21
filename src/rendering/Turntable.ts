import * as pc from 'playcanvas';
import type { PartId, PartPiece } from '../data/botParts';
import { LOOK } from '../data/look';
import type { BloombotVisuals } from './BloombotVisuals';

/**
 * #629 (E25): a live look at Bloombot on its page. A small camera sees only Bloombot (its own layer, its own two
 * lights, a clear background) and renders into a texture; each frame's pixels are copied into a canvas on the page.
 * It is the real Bloombot, wearing its real parts. Choosing a row on the page turns the view to that row's part,
 * makes it glow softly, and shows what the next level adds as a see-through ghost.
 *
 * The world's camera never draws this layer, and this camera never draws the world: the page shows Bloombot alone
 * on the paper, the same by day or night.
 */

/** Where to look from for each part: yaw round Bloombot (0 in front, 180 behind), height and distance. */
const VIEW: Record<PartId, { yaw: number; up: number; far: number }> = {
  marks: { yaw: 180, up: 0.5, far: 1.15 },
  knacks: { yaw: 180, up: 0.5, far: 1.15 },
  cells: { yaw: 160, up: 0.62, far: 1.3 },
  pockets: { yaw: 145, up: 0.5, far: 1.4 },
  core: { yaw: 180, up: 0.45, far: 1.15 },
  panel: { yaw: 155, up: 0.7, far: 1.35 },
  lamp: { yaw: 130, up: 0.7, far: 1.4 },
  charm: { yaw: 215, up: 0.5, far: 1.2 },
  leaves: { yaw: 30, up: 0.85, far: 1.3 },
  bud: { yaw: 25, up: 0.85, far: 1.25 },
  lens: { yaw: 50, up: 0.72, far: 1.15 },
  collar: { yaw: 20, up: 0.6, far: 1.3 },
  hands: { yaw: 70, up: 0.4, far: 1.4 },
  cuffs: { yaw: 70, up: 0.4, far: 1.4 },
  feet: { yaw: 30, up: 0.15, far: 1.3 },
};
const WHOLE = { yaw: 30, up: 0.45, far: 2.1 };
/** drawn at twice the page canvas's size and scaled down: smooth edges */
const SS = 2;

export class Turntable {
  readonly layer: pc.Layer;
  private cam: pc.Entity;
  private lights: pc.Entity[] = [];
  private rt?: pc.RenderTarget;
  private tex?: pc.Texture;
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D | null;
  private img?: ImageData;
  /** the frame at full size, scaled down into the page's canvas (smooth edges without MSAA, which reads back empty) */
  private big?: HTMLCanvasElement;
  private bigCtx?: CanvasRenderingContext2D | null;
  private reading = false;
  private w = 0;
  private h = 0;
  /** the view now and the one it eases to */
  private yaw = WHOLE.yaw;
  private up = WHOLE.up;
  private far = WHOLE.far;
  private want = WHOLE;
  private t = 0;
  reducedMotion = false;
  /** the part in focus (glowing), and what its next level adds (the ghost) */
  focusPart?: PartId;
  focusName?: string;

  constructor(
    private app: pc.Application,
    private bot: () => BloombotVisuals | undefined,
  ) {
    const comp = app.scene.layers;
    this.layer = comp.getLayerByName('Turntable') ?? new pc.Layer({ name: 'Turntable' });
    if (!comp.getLayerByName('Turntable')) comp.push(this.layer);
    const cam = (this.cam = new pc.Entity('turntable-cam'));
    cam.addComponent('camera', { fov: 30, nearClip: 0.05, farClip: 20, clearColor: new pc.Color(0, 0, 0, 0), layers: [this.layer.id], priority: -10 });
    cam.camera!.toneMapping = LOOK.toneMapping;
    cam.camera!.gammaCorrection = pc.GAMMA_SRGB;
    cam.enabled = false;
    app.root.addChild(cam);
    // a warm key from the front left and above, a cool fill from behind: the same studio light day or night
    for (const [name, at, colour, intensity] of [
      ['turntable-key', [-35, 40], [1, 0.96, 0.88], 1.6],
      ['turntable-fill', [150, 25], [0.78, 0.86, 1], 0.7],
    ] as const) {
      const e = new pc.Entity(name);
      e.addComponent('light', { type: 'directional', castShadows: false, layers: [this.layer.id], color: new pc.Color(colour[0], colour[1], colour[2]), intensity });
      e.setEulerAngles(-at[1], at[0], 0);
      e.enabled = false;
      app.root.addChild(e);
      this.lights.push(e);
    }
  }

  /** Is it drawing into a canvas now? */
  get showing(): boolean {
    return !!this.canvas;
  }

  /** Starts drawing into `canvas` (sized by its own width and height attributes); `undefined` stops. */
  show(canvas: HTMLCanvasElement | undefined) {
    if (canvas === this.canvas) return;
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d');
    const on = !!canvas;
    this.cam.enabled = on;
    for (const l of this.lights) l.enabled = on;
    this.bot()?.showOnLayer(this.layer.id, on);
    if (!canvas) return;
    if (canvas.width * SS !== this.w || canvas.height * SS !== this.h || !this.rt) this.makeTarget(canvas.width * SS, canvas.height * SS);
    this.snap();
  }

  private makeTarget(w: number, h: number) {
    this.rt?.destroy();
    this.tex?.destroy();
    this.w = w;
    this.h = h;
    const device = this.app.graphicsDevice;
    this.tex = new pc.Texture(device, { name: 'turntable', width: w, height: h, format: pc.PIXELFORMAT_RGBA8, mipmaps: false, minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
    this.rt = new pc.RenderTarget({ colorBuffer: this.tex, depth: true, samples: 1 });
    this.cam.camera!.renderTarget = this.rt;
    this.img = new ImageData(w, h);
    this.big = document.createElement('canvas');
    this.big.width = w;
    this.big.height = h;
    this.bigCtx = this.big.getContext('2d');
  }

  /** Turns to a part (and makes it glow, its next level a ghost), or to the whole of Bloombot. */
  focus(part: PartId | undefined, name?: string, ghost: PartPiece[] = []) {
    this.focusPart = part;
    this.focusName = name;
    this.want = part ? VIEW[part] : WHOLE;
    this.bot()?.highlight(part, name, ghost, this.layer.id);
  }

  /** Jumps straight to the view wanted (no easing): for opening the page. */
  snap() {
    this.yaw = this.want.yaw;
    this.up = this.want.up;
    this.far = this.want.far;
  }

  /** The view it is easing to (tests). */
  get target() {
    return this.want;
  }

  private last = 0;
  /** Each frame, on the real clock (the game's stops while the page is open). */
  update() {
    const nowMs = performance.now();
    const dt = Math.min(0.1, this.last ? (nowMs - this.last) / 1000 : 0);
    this.last = nowMs;
    const v = this.bot();
    if (!this.canvas || !v || !this.rt) return;
    this.t += dt;
    // ease to the view wanted, then sway gently round it so Bloombot feels alive (still, with reduced motion)
    const k = 1 - Math.exp(-dt * 5);
    const dy = ((this.want.yaw - this.yaw + 540) % 360) - 180;
    this.yaw += dy * k;
    this.up += (this.want.up - this.up) * k;
    this.far += (this.want.far - this.far) * k;
    const sway = this.reducedMotion ? 0 : Math.sin(this.t * 0.5) * 14;
    const root = v.root;
    const p = root.getPosition();
    // round from straight in front of its face, which looks down its +z (the back of its forward); not its Euler y,
    // which flips past a quarter turn
    const f = root.forward;
    const round = (Math.atan2(-f.x, -f.z) * 180) / Math.PI + this.yaw + sway;
    const a = (round * Math.PI) / 180;
    const look = new pc.Vec3(p.x, p.y + this.up, p.z);
    this.cam.setPosition(look.x + Math.sin(a) * this.far, look.y + this.far * 0.18, look.z + Math.cos(a) * this.far);
    this.cam.lookAt(look);
    // the key and fill turn with the view, so the side looked at is always lit
    this.lights[0].setEulerAngles(-40, round - 35, 0);
    this.lights[1].setEulerAngles(-25, round + 150, 0);
    this.copy();
  }

  /** Copies the last frame's pixels into the page's canvas (one read in flight at a time; it never stalls a frame). */
  private copy() {
    if (this.reading || !this.tex || !this.rt || !this.img || !this.ctx) return;
    this.reading = true;
    const w = this.w;
    const h = this.h;
    this.tex
      .read(0, 0, w, h, { renderTarget: this.rt, frequent: true })
      .then((px) => {
        this.reading = false;
        if (!this.ctx || !this.canvas || !this.img || !this.big || !this.bigCtx || w !== this.w) return;
        const d = this.img.data;
        const src = px as Uint8Array;
        const row = w * 4;
        // the texture's rows run bottom up
        for (let y = 0; y < h; y++) d.set(src.subarray((h - 1 - y) * row, (h - y) * row), y * row);
        this.bigCtx.putImageData(this.img, 0, 0);
        const c = this.canvas;
        this.ctx.clearRect(0, 0, c.width, c.height);
        this.ctx.imageSmoothingQuality = 'high';
        this.ctx.drawImage(this.big, 0, 0, c.width, c.height);
      })
      .catch(() => (this.reading = false));
  }

  destroy() {
    this.show(undefined);
    this.cam.destroy();
    for (const l of this.lights) l.destroy();
    this.rt?.destroy();
    this.tex?.destroy();
  }
}
