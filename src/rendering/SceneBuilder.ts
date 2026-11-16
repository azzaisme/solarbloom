import * as pc from 'playcanvas';
import { color } from './Materials';
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
    scene.ambientLight = color('#8a90a3');
    // Aerial perspective: the distant city fades into warm haze.
    scene.fog.type = pc.FOG_LINEAR;
    scene.fog.color = color('#bcd9e6');
    // Distances (from the camera) are converted to ortho depth by Game once the camera exists.
    scene.fog.start = 46;
    scene.fog.end = 84;
    const sun = new pc.Entity('sun');
    sun.addComponent('light', {
      type: 'directional',
      color: color('#ffe6bd'),
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
    fill.addComponent('light', { type: 'directional', color: color('#b9d7ff'), intensity: 0.35, castShadows: false });
    fill.setEulerAngles(40, 220, 0);
    this.app.root.addChild(fill);
  }

  /**
   * Phase 5 E16: optional warm dusk. Only the light changes (warmer, lower sun, rosier haze); nothing in the game
   * depends on it. Fireflies come with it (Fauna).
   */
  setDusk(on: boolean) {
    const scene = this.app.scene;
    const l = this.sun?.light;
    if (!l) return;
    l.color = color(on ? '#ffc58f' : '#ffe6bd');
    l.intensity = on ? 1.75 : 2.15;
    scene.ambientLight = color(on ? '#8f8396' : '#8a90a3');
    scene.fog.color = color(on ? '#e6c9bb' : '#bcd9e6');
    this.sun.setEulerAngles(on ? 30 : 48, 62, 0);
  }

  update(_dt: number) {}
}
