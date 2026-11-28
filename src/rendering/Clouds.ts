import * as pc from 'playcanvas';
import { group } from './Shapes';
import { color, PALETTE } from './Materials';
import { layerCloudMaterial, setCloudLayer, shadowCloudMaterial } from './PaintedClouds';

const smooth = (a: number, b: number, x: number) => {
  const t = pc.math.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const SHADOW_Y = 0.35; // just over the ground slabs: flat ground and low props darken, buildings stand out of it

/**
 * #painted-clouds: the clouds over the zoomed-out view. Seen from high up the sky is out of shot, so the painted
 * cloud field (PaintedClouds) is laid as a thin sheet high over the city, between the camera and the ground, and
 * casts its soft shadow on the ground below (offset along the sun). It follows the view, anchored to the world, so
 * panning slides under it; it fades in as you zoom out and is gone close up. One draw each, nothing per cloud.
 *
 * (It replaced a handful of puffy 3D clouds with their own little showers, which read as props over the city.)
 * Purely cosmetic: never picked; still with reduced motion (the drift is the sky's).
 */
export class Clouds {
  private root: pc.Entity;
  private sheet: pc.Entity;
  private shadow: pc.Entity;
  private device: pc.GraphicsDevice;
  private center = new pc.Vec3();
  /** E23.7.2: the weather's wind, 0 … 1 (kept for Game; the sky's drift carries the wind) */
  gust = 0;
  reducedMotion = false;
  /** zoom at/above which there are no clouds, and at/below which they are full */
  showBelow = 0.62;
  fullBelow = 0.34;

  constructor(parent: pc.Entity, device: pc.GraphicsDevice, _sunUp: pc.Vec3) {
    this.device = device;
    this.root = group(parent, 'clouds');
    this.root.enabled = false;
    this.sheet = new pc.Entity('cloudSheet');
    this.sheet.addComponent('render', { type: 'plane', material: layerCloudMaterial(device), castShadows: false, receiveShadows: false });
    this.root.addChild(this.sheet);
    this.shadow = new pc.Entity('cloudSheetShadow');
    this.shadow.addComponent('render', { type: 'plane', material: shadowCloudMaterial(device, color(PALETTE.sky.cloudShadow)), castShadows: false, receiveShadows: false });
    this.root.addChild(this.shadow);
  }

  /** Follows the camera: `zoom`, its position and forward, the distance to the target and the view height there. */
  update(_dt: number, cam: { zoom: number; yaw: number; dist: number; viewHeight: number; aspect: number; position: pc.Vec3; forward: pc.Vec3 }) {
    const k = 1 - smooth(this.fullBelow, this.showBelow, cam.zoom);
    if (k <= 0.001) {
      this.root.enabled = false;
      return;
    }
    this.root.enabled = true;
    const vh = cam.viewHeight;
    // the sheet: level, a little in front of the target (well past the near clip), wide enough to fill the view
    const depth = cam.dist - vh * 1.25;
    this.center.copy(cam.forward).mulScalar(depth).add(cam.position);
    const span = vh * Math.max(1, cam.aspect) * 6;
    this.sheet.setPosition(this.center.x, this.center.y, this.center.z);
    this.sheet.setLocalScale(span, 1, span);
    // its shadow on the ground, under the whole view
    this.shadow.setPosition(this.center.x, SHADOW_Y, this.center.z);
    this.shadow.setLocalScale(span * 1.5, 1, span * 1.5);
    setCloudLayer(this.device, k, Math.max(0, this.center.y - SHADOW_Y));
  }
}
