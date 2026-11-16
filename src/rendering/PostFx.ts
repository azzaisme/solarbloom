import * as pc from 'playcanvas';
import { LOOK } from '../data/look';

/** Which post effects run (Look 1.11 maps graphics tiers onto this). */
export interface PostSpec {
  /** CameraFrame on: HDR scene target, effects, tone mapping in the compose pass. Off: the camera tone-maps. */
  post: boolean;
  bloom: boolean;
  /** MSAA samples of the HDR scene target (the canvas's own antialiasing doesn't apply to it) */
  samples: number;
}

/**
 * Look 1.5: the CameraFrame post-processing stack on the main camera, the single home for post effects: the
 * scene renders to an HDR target, bloom (and later SSAO, depth of field, grading and vignette) run on it, and
 * the compose pass applies exposure, tone mapping and sRGB output. With post off, the camera itself tone-maps,
 * so the image keeps the same curve.
 *
 * The canvas is transparent (the sky is a CSS gradient behind it), but no sky is in view at any zoom: the city
 * floor fills the frame and fades into the haze. With post on, the camera clears to the haze colour, so the HDR
 * target can use the cheap 11-11-10 float format, which has no alpha. CameraFrame follows canvas resizes (the
 * adaptive device pixel ratio included) on its own, and the engine recreates its render targets after a lost
 * context.
 */
export class PostFx {
  frame?: pc.CameraFrame;
  private clearWas?: pc.Color;

  constructor(
    private app: pc.AppBase,
    private camera: pc.CameraComponent,
  ) {}

  get enabled(): boolean {
    return !!this.frame;
  }

  apply(spec: PostSpec, haze: pc.Color) {
    const cam = this.camera;
    if (!spec.post) {
      if (this.frame) {
        this.frame.destroy();
        this.frame = undefined;
        if (this.clearWas) cam.clearColor = this.clearWas;
      }
      cam.toneMapping = LOOK.toneMapping;
      cam.gammaCorrection = pc.GAMMA_SRGB;
      return;
    }
    if (!this.frame) {
      this.clearWas = cam.clearColor.clone();
      this.frame = new pc.CameraFrame(this.app, cam);
    }
    cam.clearColor = new pc.Color(haze.r, haze.g, haze.b, 1);
    const f = this.frame;
    f.rendering.toneMapping = LOOK.toneMapping;
    f.rendering.samples = spec.samples;
    const B = LOOK.bloom;
    f.bloom.intensity = spec.bloom ? B.intensity : 0;
    f.bloom.threshold = B.threshold;
    f.bloom.blurLevel = B.blurLevel;
    f.update();
  }

  destroy() {
    this.frame?.destroy();
    this.frame = undefined;
  }
}
