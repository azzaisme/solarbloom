import * as pc from 'playcanvas';
import { LOOK } from '../data/look';

/**
 * E28.W01 (#694): the planar reflection the water shows on High. A second camera, the main one mirrored in the sea's
 * surface, draws the sky and the world (not the water itself, which is on its own layer) into a half-size HDR
 * target before the main camera renders. Its near plane is tilted onto the water's surface (an oblique clip plane),
 * so nothing below the waterline (the sea bed, the banks' feet) shows in it. The water shader samples it at each
 * point's mirrored screen position, broken up by the ripples, and mixes it in by Fresnel (LOOK.water.reflect).
 *
 * Why planar: buildings, the jetty and plants stand right on the water and the camera looks along it, which is where
 * screen-space reflections lose what they need (it's off screen or behind the thing itself) and a sky probe shows
 * none of it. One plane suits this world: the sea and the surf lie at one height, and the few pools on other
 * terraces fall back to the sky's colours (the shader only uses the reflection near this plane's height).
 */
export class WaterReflection {
  readonly entity: pc.Entity;
  private cam: pc.CameraComponent;
  private target?: pc.RenderTarget;
  private texture?: pc.Texture;
  private viewInv = new pc.Mat4();
  private view = new pc.Mat4();
  private proj = new pc.Mat4();
  readonly viewProj = new pc.Mat4();
  private mirror = new pc.Mat4();
  private pos = new pc.Vec3();
  private on = false;
  private frame = 0;
  /** whether the texture holds a reflection yet (since it was last switched on or resized) */
  private drawn = false;
  /** the view the texture was last drawn from: what the water samples it with */
  readonly drawnViewProj = new pc.Mat4();

  constructor(
    private app: pc.AppBase,
    private main: pc.CameraComponent,
    layers: number[],
  ) {
    const e = new pc.Entity('water-reflect');
    e.addComponent('camera', {
      layers,
      priority: (main.priority ?? 0) - 1,
      clearColor: main.clearColor,
      nearClip: main.nearClip,
      farClip: main.farClip,
      fov: main.fov,
      // linear HDR out: the water adds it before the main camera's tone mapping
      toneMapping: pc.TONEMAP_NONE,
      gammaCorrection: pc.GAMMA_NONE,
      enabled: false,
    });
    this.cam = e.camera!;
    // the mirrored view has the opposite handedness: front faces wind the other way
    this.cam.flipFaces = true;
    this.cam.calculateTransform = (m: pc.Mat4) => {
      m.copy(this.viewInv);
    };
    this.cam.calculateProjection = (m: pc.Mat4) => {
      m.copy(this.proj);
    };
    app.root.addChild(e);
    this.entity = e;
    // PlayCanvas renders the sun's shadow map again for every camera that sees it: a second full shadow pass just for
    // a rippled reflection. Leave this camera out of that list; it draws first each frame, so it samples the shadow
    // map and cascade matrices (both the light's own) as the main camera left them a frame ago, and a mirrored view
    // sees the same depths, so its shadows still land where they should.
    const culler = (app.renderer as unknown as { culler?: Culler }).culler;
    if (culler && typeof culler.collectDirectionalShadowLights === 'function' && culler.cameraDirShadowLights instanceof Map) {
      const collect = culler.collectDirectionalShadowLights.bind(culler);
      culler.collectDirectionalShadowLights = (comp: unknown) => {
        collect(comp);
        culler.cameraDirShadowLights.delete(this.cam.camera);
      };
    }
  }

  /** The reflection's texture (when on and drawn). */
  get tex(): pc.Texture | undefined {
    return this.on && this.drawn ? this.texture : undefined;
  }

  /**
   * Per frame, after the main camera has moved: on or off, and the water plane's height. Sizes the target to
   * `LOOK.water.reflect.scale` of the screen and mirrors the main camera's view in the plane.
   */
  update(on: boolean, planeY: number) {
    if (on && !this.on) this.drawn = false;
    this.on = on;
    if (!on) {
      this.cam.enabled = false;
      return;
    }
    const d = this.app.graphicsDevice;
    const R = LOOK.water.reflect;
    const w = Math.max(16, Math.round(d.width * R.scale));
    const h = Math.max(16, Math.round(d.height * R.scale));
    if (!this.texture || this.texture.width !== w || this.texture.height !== h) {
      this.resize(w, h);
      this.drawn = false;
    }
    // drawn every `every` frames (always while it has nothing yet)
    const draw = !this.drawn || this.frame++ % Math.max(1, Math.round(R.every)) === 0;
    this.cam.enabled = draw;
    if (!draw) return;
    const mainCam = this.main;
    this.cam.fov = mainCam.fov;
    this.cam.nearClip = mainCam.nearClip;
    this.cam.farClip = Math.min(mainCam.farClip, R.far);
    // the mirror in y = planeY
    const M = this.mirror;
    M.setIdentity();
    M.data[5] = -1;
    M.data[13] = 2 * planeY;
    this.viewInv.mul2(M, mainCam.entity.getWorldTransform());
    this.view.copy(this.viewInv).invert();
    this.pos.copy(mainCam.entity.getPosition());
    this.pos.y = 2 * planeY - this.pos.y;
    this.entity.setPosition(this.pos);
    // the main camera's projection with the near plane tilted onto the water (Lengyel's oblique clip)
    const aspect = d.width / Math.max(1, d.height);
    this.proj.setPerspective(mainCam.fov, aspect, mainCam.nearClip, this.cam.farClip);
    obliqueClip(this.proj, this.view, planeY + 0.004);
    this.viewProj.mul2(this.proj, this.view);
    // this frame draws it: from now on the water samples it with this view
    this.drawnViewProj.copy(this.viewProj);
    this.drawn = true;
  }

  private resize(w: number, h: number) {
    this.target?.destroy();
    this.texture?.destroy();
    const d = this.app.graphicsDevice;
    const hdr = d.textureHalfFloatRenderable;
    this.texture = new pc.Texture(d, {
      name: 'water-reflect',
      width: w,
      height: h,
      format: hdr ? pc.PIXELFORMAT_RGBA16F : pc.PIXELFORMAT_RGBA8,
      mipmaps: false,
      minFilter: pc.FILTER_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE,
      addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    });
    this.target = new pc.RenderTarget({ colorBuffer: this.texture, depth: true, samples: 1 });
    this.cam.renderTarget = this.target;
  }

  destroy() {
    this.entity.destroy();
    this.target?.destroy();
    this.texture?.destroy();
  }
}

/** The part of the engine's culler the reflection reaches into (not public API; checked before use). */
interface Culler {
  collectDirectionalShadowLights(comp: unknown): void;
  cameraDirShadowLights: Map<unknown, unknown>;
}

/**
 * Tilts a perspective projection's near plane onto the world plane y = `y` (keeping what lies above it), given the
 * view matrix: Eric Lengyel's oblique near-plane clipping. Exported for tests.
 */
export function obliqueClip(proj: pc.Mat4, view: pc.Mat4, y: number) {
  // the plane (0, 1, 0, -y) in view space: transpose(inverse(view)) · plane = transpose(viewInv) · plane
  const inv = new pc.Mat4().copy(view).invert();
  const m = inv.data;
  const P = [0, 1, 0, -y];
  // (transpose(inv) · P)_i = Σ_j inv[j][i] · P_j, with column-major data: inv[row r][col c] = m[c * 4 + r]
  const C = [0, 1, 2, 3].map((i) => m[i * 4 + 0] * P[0] + m[i * 4 + 1] * P[1] + m[i * 4 + 2] * P[2] + m[i * 4 + 3] * P[3]);
  const p = proj.data;
  // q = inverse(proj) · (sgn(Cx), sgn(Cy), 1, 1), for a standard perspective matrix
  const qx = (Math.sign(C[0]) + p[8]) / p[0];
  const qy = (Math.sign(C[1]) + p[9]) / p[5];
  const qz = -1;
  const qw = (1 + p[10]) / p[14];
  const dot = C[0] * qx + C[1] * qy + C[2] * qz + C[3] * qw;
  if (Math.abs(dot) < 1e-9) return;
  const s = 2 / dot;
  p[2] = C[0] * s - p[3];
  p[6] = C[1] * s - p[7];
  p[10] = C[2] * s - p[11];
  p[14] = C[3] * s - p[15];
}
