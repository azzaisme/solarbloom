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
 * Look 1.2: golden-hour key light. A low warm sun casts long shadows toward the lower left. Numbers live in
 * data/look.ts.
 */
export class SceneBuilder {
  readonly world: pc.Entity;
  sun!: pc.Entity;
  fill!: pc.Entity;

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
    scene.ambientLight = color('#8a90a3');
    this.applyLights();
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
    f.color = color('#b9d7ff');
    f.intensity = 0.35;
    this.fill.setEulerAngles(40, 220, 0);
  }

  update(_dt: number) {}
}
