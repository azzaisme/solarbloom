import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import { DAY_LIGHT } from '../data/sky';
import { color } from './Materials';
import { waterLayer, worldLightLayers } from './WaterSurface';
import type { Tweens } from './Tween';

/** Tile surfaces sit slightly below the slabs so the gaps read as a soft grid. */
export { SLAB_TOP } from '../core/Picking';

/**
 * The static world: its root entity, the lights and the haze. The city itself (ground, buildings, rooftops,
 * machines) is drawn by ChunkRenderer, GridRenderer and MachineVisuals. (The fixed rooftop campaign's buildings,
 * bridges and skyline were removed with it, City 12.4.)
 *
 * Look 1: golden-hour lighting. A low warm sun casts long shadows toward the lower left; a cool fill comes from
 * the opposite side; ambient light comes from a tiny generated sky-and-ground environment (blue above, warm
 * bounce below), which also gives glossy surfaces their reflections. Numbers live in data/look.ts.
 */
export class SceneBuilder {
  readonly world: pc.Entity;
  sun!: pc.Entity;
  fill!: pc.Entity;
  private envSource?: pc.Texture;
  private envAtlas?: pc.Texture;

  constructor(
    private app: pc.AppBase,
    _tweens: Tweens,
  ) {
    this.world = new pc.Entity('world');
    app.root.addChild(this.world);
  }

  build() {
    const scene = this.app.scene;
    // Aerial perspective: the distant city fades into warm haze.
    scene.fog.type = pc.FOG_LINEAR;
    scene.fog.color = color(LOOK.haze.color);
    // Distances (from the camera) are converted to fog depth by Game once the camera exists.
    scene.fog.start = 46;
    scene.fog.end = 84;
    // E28.W01: the water's own layer exists before any light, so every world light can shine on it too
    waterLayer(this.app);
    const sun = new pc.Entity('sun');
    sun.addComponent('light', {
      type: 'directional',
      layers: worldLightLayers(),
      castShadows: true,
      shadowResolution: 2048,
      shadowDistance: 45,
      // Cascades and resolution follow the graphics tier (LookController.setTier).
      numCascades: 1,
      shadowType: pc.SHADOW_PCF3_32F,
    });
    this.app.root.addChild(sun);
    this.sun = sun;
    const fill = new pc.Entity('fill');
    fill.addComponent('light', { type: 'directional', castShadows: false, layers: worldLightLayers() });
    this.app.root.addChild(fill);
    this.fill = fill;
    this.applyLights();
    this.buildEnvironment();
    // A lost WebGL context loses the generated environment's pixels: rebuild it once the device is back.
    this.app.graphicsDevice.on('devicerestored', () => this.buildEnvironment());
  }

  /** Direction the sun's light travels (unit vector, pointing down). */
  sunDirection(out = new pc.Vec3()): pc.Vec3 {
    const S = LOOK.sun;
    const e = (S.elevation * Math.PI) / 180;
    const [hx, hz] = S.toward;
    const h = Math.hypot(hx, hz) || 1;
    return out.set((hx / h) * Math.cos(e), -Math.sin(e), (hz / h) * Math.cos(e)).normalize();
  }

  /** (Re)applies the light settings from LOOK (also used for live tuning). */
  applyLights() {
    const S = LOOK.sun;
    const sun = this.sun.light!;
    sun.color = color(S.color);
    sun.intensity = S.intensity;
    sun.shadowBias = S.shadowBias;
    sun.normalOffsetBias = S.normalOffsetBias;
    const d = this.sunDirection();
    // A directional light shines along its entity's −Y axis.
    this.sun.setRotation(new pc.Quat().setFromDirections(pc.Vec3.DOWN, d));
    const f = this.fill.light!;
    f.color = color(LOOK.fill.color);
    f.intensity = LOOK.fill.intensity;
    // The fill comes from the opposite side, higher up, so shadowed faces get a soft cool lift.
    const fd = new pc.Vec3(-d.x, -0.75, -d.z).normalize();
    this.fill.setRotation(new pc.Quat().setFromDirections(pc.Vec3.DOWN, fd));
    if (this.envAtlas) this.app.scene.skyboxIntensity = LOOK.env.intensity;
  }

  /**
   * Bakes ambient light from the sky and the ground: a 32² cubemap with a vertical gradient (zenith blue, a pale
   * horizon, warm ground bounce below), prefiltered into the scene's environment atlas. Ambient and glossy
   * reflections both come from it, so shadowed faces turn cool and undersides pick up warm bounce.
   */
  buildEnvironment() {
    const device = this.app.graphicsDevice;
    const E = LOOK.env;
    const N = 32;
    const NC = DAY_LIGHT.envNightColours;
    const n = this.envNight;
    const zen = new pc.Color().lerp(color(E.zenith).linear(), color(NC.zenith).linear(), n);
    const hor = new pc.Color().lerp(color(E.horizon).linear(), color(NC.horizon).linear(), n);
    const gnd = new pc.Color().lerp(color(E.ground).linear(), color(NC.ground).linear(), n);
    const levels: Uint8Array[] = [];
    const dir = new pc.Vec3();
    const mix = (a: pc.Color, b: pc.Color, t: number, k: number) => [a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t].map((v) => v * k);
    for (let face = 0; face < 6; face++) {
      const px = new Uint8Array(N * N * 4);
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const u = ((x + 0.5) / N) * 2 - 1;
          const v = ((y + 0.5) / N) * 2 - 1;
          // Cubemap face orientation (+X, −X, +Y, −Y, +Z, −Z), WebGL convention.
          switch (face) {
            case 0: dir.set(1, -v, -u); break;
            case 1: dir.set(-1, -v, u); break;
            case 2: dir.set(u, 1, v); break;
            case 3: dir.set(u, -1, -v); break;
            case 4: dir.set(u, -v, 1); break;
            default: dir.set(-u, -v, -1);
          }
          dir.normalize();
          const up = dir.y;
          // Sky: horizon → zenith quickly; ground: a darker warm bounce, a little lighter near the horizon.
          const c = up >= 0 ? mix(hor, zen, Math.pow(up, 0.6), 1) : mix(hor, gnd, Math.pow(-up, 0.35), 0.85);
          const i = (y * N + x) * 4;
          // Stored linear, scaled into 8 bits (the environment is ≤ 1 by construction).
          px[i] = Math.round(Math.min(1, c[0]) * 255);
          px[i + 1] = Math.round(Math.min(1, c[1]) * 255);
          px[i + 2] = Math.round(Math.min(1, c[2]) * 255);
          px[i + 3] = 255;
        }
      levels.push(px);
    }
    const keep = this.envAtlas ? this.app.scene.skyboxIntensity : undefined; // DayNight's, on a re-bake
    this.envSource?.destroy();
    this.envAtlas?.destroy();
    const cube = new pc.Texture(device, {
      name: 'look-sky-ground',
      cubemap: true,
      width: N,
      height: N,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: false,
      levels: [levels],
    });
    const lighting = pc.EnvLighting.generateLightingSource(cube, { size: 32 });
    cube.destroy();
    this.envSource = lighting;
    // 512: the size PlayCanvas lays the atlas out for. Smaller, its roughest reflection levels shrink to a few
    // pixels with a fraction of a pixel of seam padding, and the reflection map's wrap seam bleeds into a
    // lighter band down the middle of the screen whenever the camera looks along a world axis.
    this.envAtlas = pc.EnvLighting.generateAtlas(lighting, { size: 512 });
    const scene = this.app.scene;
    scene.envAtlas = this.envAtlas;
    if (keep === undefined) scene.skyboxIntensity = E.intensity;
    // Ambient comes from the environment now; the old flat ambient stays black so it doesn't add on top.
    scene.ambientLight = new pc.Color(0, 0, 0);
  }

  /** E23.7.5: how far into night the ambient environment is (0 day … 1 night), in DAY_LIGHT.envSteps steps. */
  private envNight = 0;

  /** Shift the ambient environment toward night's colours; re-bakes only when it crosses a step. */
  setEnvNight(night: number) {
    const steps = DAY_LIGHT.envSteps;
    const n = Math.round(Math.min(1, Math.max(0, night)) * steps) / steps;
    if (n === this.envNight) return;
    this.envNight = n;
    this.buildEnvironment();
  }

  update(_dt: number) {}
}
