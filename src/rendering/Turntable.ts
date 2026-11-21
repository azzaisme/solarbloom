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

/**
 * Where to look from for each part: yaw round Bloombot (0 in front of its face, 180 behind), the height looked at and
 * the distance. Bloombot always reads as itself: the whole of it for the big parts, its head and body (never cut at
 * the chest) for the small ones on its pack and head, so a mark, a bead or the lamp is big enough to see.
 */
const AT = (yaw: number, up = 0.5, far = 2.05) => ({ yaw, up, far });
const VIEW: Record<PartId, { yaw: number; up: number; far: number }> = {
  marks: AT(180, 0.45, 1.65),
  knacks: AT(180, 0.42, 1.65),
  cells: AT(165, 0.5, 1.75),
  pockets: AT(140, 0.45, 1.75),
  core: AT(180, 0.45, 1.65),
  panel: AT(160, 0.55, 1.7),
  lamp: AT(125, 0.6, 1.65),
  charm: AT(220, 0.45, 1.65),
  leaves: AT(25, 0.62, 1.6),
  bud: AT(20, 0.62, 1.6),
  lens: AT(40, 0.65, 1.5),
  collar: AT(15, 0.6, 1.6),
  hands: AT(65, 0.45),
  cuffs: AT(65, 0.45),
  feet: AT(30, 0.42),
};
const WHOLE = AT(30);
/** the studio's sky light (a share of its day strength) and a touch of even ambient */
const STUDIO_SKY = 0.9;
const STUDIO_AMBIENT = new Float32Array([0.06, 0.06, 0.06]); // linear
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
      ['turntable-key', [-35, 40], [1, 0.97, 0.92], 1.6],
      ['turntable-fill', [150, 25], [0.8, 0.88, 1], 0.8],
    ] as const) {
      const e = new pc.Entity(name);
      e.addComponent('light', { type: 'directional', castShadows: false, layers: [this.layer.id], color: new pc.Color(colour[0], colour[1], colour[2]), intensity });
      e.setEulerAngles(-at[1], at[0], 0);
      e.enabled = false;
      app.root.addChild(e);
      this.lights.push(e);
    }
    // The world's look is worked out for the world's camera: its golden rim light (LookShaders) edges whatever turns
    // edge-on to that camera on the sun's side, and the sky's light dims at night. While this camera draws its layer,
    // those shader values are its own (the rim from this camera, towards the key light; the sky at its day strength),
    // and set back after, so Bloombot looks the same on the page whichever way it faces out there, by day or night.
    const scope = app.graphicsDevice.scope;
    const ids = ['look_camPos', 'look_rimDir', 'skyboxIntensity', 'light_globalAmbient'].map((n) => scope.resolve(n));
    const mine = (cam: pc.CameraComponent, layer: pc.Layer) => cam === this.cam.camera && layer === this.layer;
    const kept: unknown[] = [];
    const camPos = new Float32Array(3);
    const rimDir = new Float32Array(3);
    this.studio = [
      app.scene.on('prerender:layer', (cam: pc.CameraComponent, layer: pc.Layer) => {
        if (!mine(cam, layer)) return;
        ids.forEach((id, k) => (kept[k] = id.value && typeof id.value === 'object' ? Array.from(id.value as ArrayLike<number>) : id.value));
        const c = this.cam.getPosition();
        camPos.set([c.x, c.y, c.z]);
        const up = this.lights[0].up; // the key shines down its -y: towards the key is its +y
        rimDir.set([up.x, up.y, up.z]);
        ids[0].setValue(camPos);
        ids[1].setValue(rimDir);
        ids[2].setValue(LOOK.env.intensity * STUDIO_SKY);
        ids[3].setValue(STUDIO_AMBIENT);
      }),
      app.scene.on('postrender:layer', (cam: pc.CameraComponent, layer: pc.Layer) => {
        if (!mine(cam, layer)) return;
        ids.forEach((id, k) => {
          const v = kept[k];
          if (v !== undefined) id.setValue(Array.isArray(v) ? new Float32Array(v) : (v as number));
        });
      }),
    ];
  }
  private studio: pc.EventHandle[] = [];

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
    this.fit(canvas);
    if (!this.rt) this.makeTarget(canvas.width * SS, canvas.height * SS);
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
    this.fit(this.canvas);
    this.t += dt;
    // the chosen part's glow and its ghost breathe, so they catch the eye even small
    v.pulseHighlight(this.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(this.t * 3.2));
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
    // the key and fill turn with the view, so the side looked at is always lit: the key from above and to the left of
    // the camera, a soft rim from behind on the right. A directional light shines down its -y: aim -z, then tip it.
    this.aim(this.lights[0], look, round - 40, 45);
    this.aim(this.lights[1], look, round + 160, 20);
    this.copy();
  }

  /** Points a directional light at `look` from round `yaw` (degrees, as the camera) and `rise` degrees up. */
  private aim(e: pc.Entity, look: pc.Vec3, yaw: number, rise: number) {
    const a = (yaw * Math.PI) / 180;
    const r = (rise * Math.PI) / 180;
    e.setPosition(look.x + Math.sin(a) * Math.cos(r), look.y + Math.sin(r), look.z + Math.cos(a) * Math.cos(r));
    e.lookAt(look);
    e.rotateLocal(90, 0, 0);
  }

  /** Sizes the canvas's pixels to its box on the page (above the words, or a square beside them), its long side 480. */
  private fit(c: HTMLCanvasElement) {
    const cw = c.clientWidth;
    const ch = c.clientHeight;
    if (cw < 8 || ch < 8) return;
    const k = 480 / Math.max(cw, ch);
    const w = Math.round(cw * k);
    const h = Math.round(ch * k);
    if (w !== c.width || h !== c.height) {
      c.width = w;
      c.height = h;
    }
    if (w * SS !== this.w || h * SS !== this.h) this.makeTarget(w * SS, h * SS);
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
    for (const h of this.studio) h.off();
    this.cam.destroy();
    for (const l of this.lights) l.destroy();
    this.rt?.destroy();
    this.tex?.destroy();
  }
}
