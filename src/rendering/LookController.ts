import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import type { CameraController } from './CameraController';
import { Atmosphere } from './Atmosphere';
import { installLookShaders, setLookRim } from './LookShaders';
import { color } from './Materials';
import { PostFx } from './PostFx';
import type { SceneBuilder } from './SceneBuilder';

/**
 * Look 1: the single home of the golden-hour look at run time — lights, the rim term, tone mapping and the
 * CameraFrame post stack, the restoration mood grade and the graphics tier. Game owns one and calls `update`
 * every frame after the camera moves.
 */
export class LookController {
  /** The live tuning object (dev: edit, then call apply()). */
  readonly cfg = LOOK;
  private toSun = new pc.Vec3();
  private rimColour = new pc.Color();
  readonly post: PostFx;
  readonly atmosphere: Atmosphere;
  /** Look 1.7: restoration of the area in view, 0 (dead, fogged) … 1 (restored); the grade follows it. */
  moodTarget = 0;
  mood = 0;
  /** Settings: high contrast flattens the grade and drops the vignette so outlines and text stay readable. */
  highContrast = false;

  constructor(
    private app: pc.AppBase,
    private scene: SceneBuilder,
    private camera: CameraController,
  ) {
    installLookShaders(app.graphicsDevice);
    // The generated environment is for lighting only: the sky behind the city is the page's CSS gradient.
    const cam = camera.cam;
    cam.layers = cam.layers.filter((id) => id !== pc.LAYERID_SKYBOX);
    // Look 1.4: a linear HDR-ish workflow with a filmic curve. Colours are linear in the shaders (sRGB hex →
    // pow 2.2 for materials and vertex colours alike), lit, then ACES tone-mapped and sRGB-encoded on output.
    cam.toneMapping = LOOK.toneMapping;
    cam.gammaCorrection = pc.GAMMA_SRGB;
    this.post = new PostFx(app, cam);
    this.atmosphere = new Atmosphere(app.graphicsDevice, scene.world);
    this.apply();
  }

  /** Settings that thin the atmosphere: fewer effects, or no motion. */
  lowVfx = false;
  reducedMotion = false;

  applyAtmosphere() {
    const A = LOOK.atmosphere;
    const tier = 'high';
    this.atmosphere.reducedMotion = this.reducedMotion;
    this.atmosphere.setCounts(this.lowVfx || this.reducedMotion ? 0 : A.motes[tier], this.lowVfx ? 0 : A.shafts[tier]);
  }

  /** Jumps the mood straight to its target (a load, or a teleport across the city). */
  snapMood() {
    this.mood = this.moodTarget;
  }

  /** Re-reads LOOK (live tuning). */
  apply() {
    this.scene.applyLights();
    this.app.scene.exposure = LOOK.exposure;
    this.rimColour = color(LOOK.rim.color);
    this.scene.sunDirection(this.toSun).mulScalar(-1);
    this.app.scene.fog.color = color(LOOK.haze.color);
    this.post.apply({ post: true, bloom: true, ssao: true, dof: true, samples: 4 }, this.app.scene.fog.color);
    this.applyAtmosphere();
  }

  update(dt: number) {
    const cam = this.camera;
    const g = cam.goalPoint;
    const p = cam.entity.getPosition();
    const fwd = cam.entity.forward;
    const focus = (g.x - p.x) * fwd.x + (g.y - p.y) * fwd.y + (g.z - p.z) * fwd.z;
    this.post.follow(cam.viewHeight, focus);
    const G = LOOK.grade;
    this.mood += (this.moodTarget - this.mood) * (1 - Math.exp(-dt / Math.max(0.01, G.follow)));
    if (this.highContrast) this.post.grade(G.contrast, G.contrast, 0, 0);
    else this.post.grade(G.dead, G.warm, this.mood, LOOK.vignette.intensity);
    this.atmosphere.update(dt, g, Math.max(6, cam.viewHeight * 1.2), this.toSun, fwd);
    const R = LOOK.rim;
    setLookRim(this.app.graphicsDevice, this.rimColour, R.intensity, R.power, this.toSun, this.camera.entity.getPosition(), LOOK.emissive.vertexGlow);
  }
}
