import * as pc from 'playcanvas';
import { color, PALETTE } from './Materials';
import type { Tweens } from './Tween';

/** Tile surfaces sit slightly below the slabs so the gaps read as a soft grid. */
export { SLAB_TOP } from '../core/Picking';

/**
 * The static world: its root entity, the sun and fill lights and the haze. The city itself (ground, buildings,
 * rooftops, machines) is drawn by ChunkRenderer, GridRenderer and MachineVisuals. (The fixed rooftop campaign's
 * buildings, bridges and skyline were removed with it, City 12.4.)
 */
export class SceneBuilder {
  readonly world: pc.Entity;
  sun!: pc.Entity;

  constructor(
    private app: pc.AppBase,
    _tweens: Tweens,
  ) {
    this.world = new pc.Entity('world');
    app.root.addChild(this.world);
  }

  build() {
    const scene = this.app.scene;
    scene.ambientLight = color(PALETTE.light.ambient);
    // Aerial perspective: the distant city fades into warm haze.
    scene.fog.type = pc.FOG_LINEAR;
    scene.fog.color = color(PALETTE.sky.fog);
    // Distances (from the camera) are converted to ortho depth by Game once the camera exists.
    scene.fog.start = 46;
    scene.fog.end = 84;
    const sun = new pc.Entity('sun');
    sun.addComponent('light', {
      type: 'directional',
      color: color(PALETTE.light.sun),
      intensity: 2.15,
      castShadows: true,
      shadowResolution: 2048,
      shadowDistance: 45,
      shadowBias: 0.25,
      normalOffsetBias: 0.04,
      numCascades: 1,
      shadowType: pc.SHADOW_PCF3_32F,
    });
    sun.setEulerAngles(48, 62, 0);
    this.app.root.addChild(sun);
    this.sun = sun;
    const fill = new pc.Entity('fill');
    fill.addComponent('light', { type: 'directional', color: color(PALETTE.light.fill), intensity: 0.35, castShadows: false });
    fill.setEulerAngles(40, 220, 0);
    this.app.root.addChild(fill);
  }

  update(_dt: number) {}
}
