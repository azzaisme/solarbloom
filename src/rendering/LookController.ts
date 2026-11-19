import * as pc from 'playcanvas';
import { type GfxTier, LOOK } from '../data/look';
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
  /** Look 1.11: the graphics tier in effect. */
  tier: GfxTier = 'high';
  /** Look 1.7: restoration of the area in view, 0 (dead, fogged) … 1 (restored); the grade follows it. */
  moodTarget = 0;
  mood = 0;
  /** E23.7.1: the rim's share by the time of day (DayNight sets it: weaker at night) */
  rimShare = 1;
  /** E23.7.5: how far into night it is, 0 … 1 (DayNight): bloom grows at night */
  night = 0;
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

  /** Steam Deck (#243): an upper limit on the shadow map size, whatever the tier asks for. */
  shadowCap?: number;

  /** Look 1.11: switches shadow quality, the post stack and the atmosphere to a graphics tier. */
  setTier(tier: GfxTier) {
    this.tier = tier;
    const T = LOOK.tiers[tier];
    const sun = this.scene.sun.light!;
    // "Fewer effects" keeps one small shadow map: split into cascades it would blur every one of them.
    sun.shadowResolution = Math.min(this.shadowCap ?? Infinity, this.lowVfx ? Math.min(1024, T.shadowRes) : T.shadowRes);
    sun.numCascades = this.lowVfx ? 1 : T.shadowCascades;
    sun.cascadeDistribution = LOOK.cascadeDistribution;
    sun.shadowType = T.softShadows ? pc.SHADOW_PCF5_32F : pc.SHADOW_PCF3_32F;
    // E19.4.1 (#260): photo mode brings depth of field back (Phase 6 set it aside for play) where post runs.
    this.post.apply(this.photoDof ? { ...T, dof: true } : T, this.app.scene.fog.color);
    this.applyAtmosphere();
  }

  /** E19.4.1: depth of field for photo mode (tiers with post-processing only; Low has no post stack). */
  photoDof = false;
  setPhotoDof(on: boolean) {
    if (this.photoDof === on) return;
    this.photoDof = on;
    this.setTier(this.tier);
  }

  applyAtmosphere() {
    const A = LOOK.atmosphere;
    const tier = this.tier;
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
    this.setTier(this.tier);
  }

  update(dt: number) {
    const cam = this.camera;
    const g = cam.goalPoint;
    const p = cam.entity.getPosition();
    const fwd = cam.entity.forward;
    const focus = (g.x - p.x) * fwd.x + (g.y - p.y) * fwd.y + (g.z - p.z) * fwd.z;
    this.post.follow(cam.viewHeight, focus);
    this.post.setNight(this.night);
    const G = LOOK.grade;
    this.mood += (this.moodTarget - this.mood) * (1 - Math.exp(-dt / Math.max(0.01, G.follow)));
    if (this.highContrast) this.post.grade(G.contrast, G.contrast, 0, 0);
    else this.post.grade(G.dead, G.warm, this.mood, LOOK.vignette.intensity);
    this.atmosphere.update(dt, g, Math.max(6, cam.viewHeight * 1.2), this.toSun, fwd);
    const R = LOOK.rim;
    setLookRim(this.app.graphicsDevice, this.rimColour, LOOK.tiers[this.tier].rim ? R.intensity * this.rimShare : 0, R.power, this.toSun, this.camera.entity.getPosition(), LOOK.emissive.vertexGlow);
  }
}
