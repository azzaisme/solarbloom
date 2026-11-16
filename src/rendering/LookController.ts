import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import type { CameraController } from './CameraController';
import { installLookShaders, setLookRim } from './LookShaders';
import { color } from './Materials';
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

  constructor(
    private app: pc.AppBase,
    private scene: SceneBuilder,
    private camera: CameraController,
  ) {
    installLookShaders(app.graphicsDevice);
    // The generated environment is for lighting only: the sky behind the city is the page's CSS gradient.
    const cam = camera.cam;
    cam.layers = cam.layers.filter((id) => id !== pc.LAYERID_SKYBOX);
    this.apply();
  }

  /** Re-reads LOOK (live tuning). */
  apply() {
    this.scene.applyLights();
    this.rimColour = color(LOOK.rim.color);
    this.scene.sunDirection(this.toSun).mulScalar(-1);
  }

  update(_dt: number) {
    const R = LOOK.rim;
    setLookRim(this.app.graphicsDevice, this.rimColour, R.intensity, R.power, this.toSun, this.camera.entity.getPosition());
  }
}
