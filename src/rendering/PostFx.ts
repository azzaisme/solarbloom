import * as pc from 'playcanvas';
import { LOOK, type TierSpec } from '../data/look';

export interface GradeValues {
  brightness: number;
  contrast: number;
  saturation: number;
  tint: string;
  shadows: number;
  highlights: number;
  vibrance: number;
}

/** Which post effects run: a graphics tier's spec (Look 1.11). */
export type PostSpec = Pick<TierSpec, 'post' | 'bloom' | 'ssao' | 'dof' | 'samples'>;

/**
 * Look 1.5: the CameraFrame post-processing stack on the main camera, the single home for post effects: the
 * scene renders to an HDR target, SSAO, bloom, depth of field, colour grading and vignette run on it, and
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
    const A = LOOK.ssao;
    f.ssao.type = spec.ssao ? pc.SSAOTYPE_COMBINE : pc.SSAOTYPE_NONE;
    f.ssao.intensity = A.intensity;
    f.ssao.power = A.power;
    f.ssao.minAngle = A.minAngle;
    f.ssao.samples = A.samples;
    f.ssao.blurEnabled = true;
    const D = LOOK.dof;
    f.dof.enabled = spec.dof;
    f.dof.nearBlur = false;
    f.dof.highQuality = false;
    f.dof.blurRadius = D.blurRadius;
    f.dof.blurRings = D.blurRings;
    f.dof.blurRingPoints = D.blurRingPoints;
    f.update();
  }

  /**
   * Per frame, before grade(): effect parameters that follow the camera. SSAO's radius scales with the world height
   * in view; depth of field focuses at `focus` (view depth of the camera's goal point) and blurs only beyond it.
   */
  follow(viewHeight: number, focus: number) {
    const f = this.frame;
    if (!f) return;
    if (f.ssao.type !== pc.SSAOTYPE_NONE) {
      const A = LOOK.ssao;
      f.ssao.radius = Math.min(A.maxRadius, Math.max(A.minRadius, A.radiusPerView * viewHeight));
    }
    if (f.dof.enabled) {
      // CameraFrame's far blur starts at focus + range / 2 and is full by focus + 1.5 × range.
      const D = LOOK.dof;
      const range = D.blurRamp;
      f.dof.focusRange = range;
      f.dof.focusDistance = focus + D.blurFrom - range / 2;
    }
  }

  private tint = new pc.Color();
  private vColour = new pc.Color();
  private warm = new pc.Color();
  private dead = new pc.Color();

  /**
   * Look 1.7: the grade (contrast, saturation, tint, and HDR-aware shadows / highlights / vibrance) blended
   * between two looks by `k` (0 = a, 1 = b), and the vignette. Both run in the compose pass.
   */
  grade(a: GradeValues, b: GradeValues, k: number, vignette: number) {
    const f = this.frame;
    if (!f) return;
    const m = (x: number, y: number) => x + (y - x) * k;
    f.grading.enabled = true;
    f.grading.brightness = m(a.brightness, b.brightness);
    f.grading.contrast = m(a.contrast, b.contrast);
    f.grading.saturation = m(a.saturation, b.saturation);
    this.dead.fromString(a.tint);
    this.warm.fromString(b.tint);
    this.tint.lerp(this.dead, this.warm, k);
    f.grading.tint = this.tint;
    f.colorEnhance.enabled = true;
    f.colorEnhance.shadows = m(a.shadows, b.shadows);
    f.colorEnhance.highlights = m(a.highlights, b.highlights);
    f.colorEnhance.vibrance = m(a.vibrance, b.vibrance);
    const V = LOOK.vignette;
    f.vignette.intensity = vignette;
    f.vignette.inner = V.inner;
    f.vignette.outer = V.outer;
    f.vignette.curvature = V.curvature;
    this.vColour.fromString(V.color);
    f.vignette.color = this.vColour;
    // CameraFrame reads its settings only in update(); this runs once per frame, after follow().
    f.update();
  }

  destroy() {
    this.frame?.destroy();
    this.frame = undefined;
  }
}
