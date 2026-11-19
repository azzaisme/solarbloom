import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import { DAY_LIGHT } from '../data/sky';
import { DAY } from '../data/time';
import { daylightAt, sunHeightAt } from '../gameplay/Clock';
import { tintClouds } from './Clouds';
import { color } from './Materials';
import type { SceneBuilder } from './SceneBuilder';
import type { Sky } from './Sky';

/** What the light looks like at a moment: the light clock's fraction and, from E23.7.2, how overcast it is. */
export interface LightMoment {
  /** day fraction (0 dawn … 2/3 dusk … 1) */
  f: number;
  /** 0 clear … 1 heavy cloud (storm) */
  overcast?: number;
  /** a lightning flash, 0 … 1 (E23.7.2) */
  flash?: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/**
 * E23.7.1 (#395): day and night on screen. Every frame it turns the key light along the sun's arc (or the moon's),
 * sets the light's colour and strength, the fill, the ambient environment and the rim, and tells the sky how far
 * into dusk or night it is. The sky, the fog and the sun disc all follow from there. Presentation only: it reads
 * the light clock (or photo mode's own time, E23.7.3) and changes nothing in the game.
 */
export class DayNight {
  private base = {
    sun: new pc.Color(),
    low: new pc.Color(),
    moon: new pc.Color(),
    fill: new pc.Color(),
    fillNight: new pc.Color(),
  };
  private q = new pc.Quat();
  private dir = new pc.Vec3();
  private fd = new pc.Vec3();
  private tmp = new pc.Color();
  private fillCol = new pc.Color();
  /** the unlit clouds' and fog sheets' tint now (warm at dusk, dim blue at night) */
  readonly cloudTint = new pc.Color(1, 1, 1);
  /** the rim light's share now (LookController multiplies by it) */
  rim = 1;
  /** daylight now, 0 … 1 (for anything that wants to glow at night) */
  light = 1;
  /** E23.3.4: the Power view's dim, 0 … 1 of `POWER.view.darken`: the lit world darkens, glows and unlit marks don't */
  dim = 0;

  constructor(
    private app: pc.AppBase,
    private scene: SceneBuilder,
    private sky: Sky,
  ) {
    this.base.sun = color(LOOK.sun.color);
    this.base.low = color(DAY_LIGHT.lowSunColour);
    this.base.moon = color(DAY_LIGHT.moonColour);
    this.base.fill = color(LOOK.fill.color);
    this.base.fillNight = color(DAY_LIGHT.fillNightColour);
  }

  /** Daylight (0 … 1) at a moment, overcast dimming it a little. */
  static lightAt(m: LightMoment): number {
    return daylightAt(m.f) * (1 - (m.overcast ?? 0) * 0.35);
  }

  apply(m: LightMoment) {
    const L = DAY_LIGHT;
    const f = m.f;
    const oc = m.overcast ?? 0;
    const day = daylightAt(f);
    this.light = day * (1 - oc * 0.35);
    const h = sunHeightAt(f);
    // The sun's path (low in the east, up to noon, low in the west; under the ground back east by night) and the
    // moon's (across the other side by night, back under by day). The key light blends from one to the other by
    // the daylight, so shadows swing round through twilight and never jump.
    const [hx, hz] = LOOK.sun.toward;
    const head = Math.atan2(hx, hz);
    const dayT = f < DAY.dayShare ? f / DAY.dayShare : 1 - (f - DAY.dayShare) / (1 - DAY.dayShare);
    const nightT = f >= DAY.dayShare ? (f - DAY.dayShare) / (1 - DAY.dayShare) : 1 - f / DAY.dayShare;
    const sunEl = lerp(L.sunLow, L.sunHigh, h);
    const sunAz = head + ((dayT - 0.5) * 2 * L.swing * Math.PI) / 180;
    const moonEl = L.moonElevation * (0.4 + 0.6 * Math.sin(Math.PI * nightT));
    const moonAz = head + Math.PI * 0.85 + ((nightT - 0.5) * L.swing * Math.PI) / 180;
    const toDir = (elDeg: number, azR: number, out: pc.Vec3) => {
      const e = (elDeg * Math.PI) / 180;
      return out.set(Math.sin(azR) * Math.cos(e), -Math.sin(e), Math.cos(azR) * Math.cos(e));
    };
    const moonW = 1 - smooth(day * 1.6);
    toDir(sunEl, sunAz, this.dir);
    toDir(moonEl, moonAz, this.fd);
    this.dir.lerp(this.dir, this.fd, moonW).normalize();
    this.scene.sun.setRotation(this.q.setFromDirections(pc.Vec3.DOWN, this.dir));
    // colour: warm when low, LOOK's golden hour in the middle of the day, moonlight at night
    const sunLight = this.scene.sun.light!;
    const warm = 1 - smooth(h / 0.45);
    this.tmp.lerp(this.base.sun, this.base.low, warm);
    this.tmp.lerp(this.base.moon, this.tmp, day);
    sunLight.color = this.tmp.clone();
    // under cloud the sun all but goes: soft, shadowless light from the sky instead
    const sunI = LOOK.sun.intensity * lerp(L.moonShare, 1, day) * (1 - oc * 0.88);
    const keep = 1 - this.dim;
    sunLight.intensity = (sunI + (m.flash ?? 0) * LOOK.sun.intensity * 0.8) * keep;
    // the fill keeps its own side, opposite the key light
    const fill = this.scene.fill.light!;
    this.fd.set(-this.dir.x, -0.75, -this.dir.z).normalize();
    this.scene.fill.setRotation(this.q.setFromDirections(pc.Vec3.DOWN, this.fd));
    fill.color = this.fillCol.lerp(this.base.fillNight, this.base.fill, day).clone();
    fill.intensity = LOOK.fill.intensity * lerp(L.fillNight, 1, day) * (1 + oc * 0.6) * keep;
    this.app.scene.skyboxIntensity = LOOK.env.intensity * lerp(L.envNight, 1, day) * (1 - oc * 0.1) * keep;
    this.rim = lerp(L.rimNight, 1, day) * (1 - oc * 0.5);
    this.app.scene.exposure = LOOK.exposure * lerp(L.exposureNight, 1, day) * (1 - oc * 0.22) * (1 + (m.flash ?? 0) * 0.5);
    // the sky: night, the warm band at dawn and dusk, and the weather's cloud
    this.sky.night = 1 - day;
    const edge = Math.min(Math.abs(f - DAY.dayShare), f, 1 - f); // distance to the nearer horizon
    this.sky.dusk = (1 - smooth(edge / (DAY.twilight * 2))) * (1 - oc);
    this.sky.overcast = oc;
    // the unlit clouds: warm at dusk, dim blue at night, greyer under heavy cloud
    const n = 1 - day;
    const d = this.sky.dusk;
    const grey = 1 - oc * 0.25;
    this.cloudTint.set(lerp(1, L.cloudNight[0], n) * grey, lerp(lerp(1, 0.86, d), L.cloudNight[1], n) * grey, lerp(lerp(1, 0.8, d), L.cloudNight[2], n) * grey);
    this.cloudTint.mulScalar(keep);
    tintClouds(this.cloudTint.r, this.cloudTint.g, this.cloudTint.b);
  }
}
