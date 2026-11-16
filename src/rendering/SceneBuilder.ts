import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import { color } from './Materials';
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
    scene.fog.color = color('#bcd9e6');
    // Distances (from the camera) are converted to fog depth by Game once the camera exists.
    scene.fog.start = 46;
    scene.fog.end = 84;
    const sun = new pc.Entity('sun');
    sun.addComponent('light', {
      type: 'directional',
      castShadows: true,
      shadowResolution: 2048,
      shadowDistance: 45,
      numCascades: 1,
      shadowType: pc.SHADOW_PCF3_32F,
    });
    this.app.root.addChild(sun);
    this.sun = sun;
    const fill = new pc.Entity('fill');
    fill.addComponent('light', { type: 'directional', castShadows: false });
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
    const zen = color(E.zenith).linear();
    const hor = color(E.horizon).linear();
    const gnd = color(E.ground).linear();
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
    this.envAtlas = pc.EnvLighting.generateAtlas(lighting, { size: 128 });
    const scene = this.app.scene;
    scene.envAtlas = this.envAtlas;
    scene.skyboxIntensity = E.intensity;
    // Ambient comes from the environment now; the old flat ambient stays black so it doesn't add on top.
    scene.ambientLight = new pc.Color(0, 0, 0);
  }

  update(_dt: number) {}
}
