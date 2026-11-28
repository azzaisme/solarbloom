import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import { POWER } from '../data/power';
import { DAY_LIGHT, SUN_MOON, TWILIGHT } from '../data/sky';
import { DAY } from '../data/time';
import { daylightAt, sunHeightAt } from '../gameplay/Clock';
import { color, PALETTE } from './Materials';
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
 * The sun's heading from noon, degrees, at `dayT` (0 sunrise … 0.5 noon … 1 sunset). The morning swings
 * DAY_LIGHT.swing; the afternoon swings on to DAY_LIGHT.setSwing by sunset (#sunsets: down over the open sea), the
 * extra easing in after `setFrom` of the afternoon and out again before sunset, with no kink anywhere.
 */
export function sunSwing(dayT: number): number {
  const L = DAY_LIGHT;
  const s = (dayT - 0.5) * 2;
  if (s <= 0) return s * L.swing;
  return s * L.swing + (L.setSwing - L.swing) * smooth((s - L.setFrom) / (1 - L.setFrom));
}

/**
 * #twilight: how much afterglow there is (0 … 1) with the sun's disc at `sunEl` degrees: in from TWILIGHT.rise above
 * the horizon, full from `peak` to `hold` below it, gone by `end`; heavy cloud mutes it.
 */
export function twilightAt(sunEl: number, overcast = 0): number {
  const T = TWILIGHT;
  const up = smooth((T.rise - sunEl) / (T.rise - T.peak));
  const down = 1 - smooth((T.hold - sunEl) / (T.hold - T.end));
  return up * down * (1 - overcast * T.cloud);
}

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
    twLight: new pc.Color(),
    twFill: new pc.Color(),
  };
  private q = new pc.Quat();
  private dir = new pc.Vec3();
  private fd = new pc.Vec3();
  private tmp = new pc.Color();
  private fillCol = new pc.Color();
  private viewLight = color(PALETTE.signal.power.viewLight);
  /** the unlit clouds' and fog sheets' tint now (warm at dusk, dim blue at night) */
  readonly cloudTint = new pc.Color(1, 1, 1);
  /** the rim light's share now (LookController multiplies by it) */
  rim = 1;
  /** daylight now, 0 … 1 (for anything that wants to glow at night) */
  light = 1;
  /** #563: daylight by the time of day alone, 0 (night) … 1 (day), ignoring cloud */
  daylight = 1;
  /** #sunsets: toward the sun's disc and the moon's (unit), and the sun disc's elevation in degrees */
  readonly sunAt = new pc.Vec3(0, 1, 0);
  readonly moonAt = new pc.Vec3(0, -1, 0);
  sunEl = 50;
  /** #sunsets: how much of a sunset (or sunrise) there is now, 0 … 1: the sun low, clear sky */
  sunset = 0;
  /** #sunsets: how much of the moon shows, 0 … 1 */
  moonShow = 0;
  /** #twilight: how much afterglow there is now, 0 … 1 (TWILIGHT) */
  twilight = 0;

  /**
   * #sunsets: the path of light the sea lays under the low sun or the moon: toward whichever shows more (blended
   * through the few seconds both are faint), how strong, and how warm (1: all sun).
   */
  pathOnWater(out: pc.Vec3): { toward: pc.Vec3; strength: number; warm: number } {
    const s = this.sunset * smooth((this.sunEl + 1.5) / 3); // gone once the disc has sunk
    const m = this.moonShow;
    const sum = s + m;
    if (sum <= 1e-4) return { toward: out.copy(this.moonAt), strength: 0, warm: 0 };
    out.set(0, 0, 0).add(this.sunAt.clone().mulScalar(s)).add(this.moonAt.clone().mulScalar(m)).normalize();
    return { toward: out, strength: Math.max(s, m), warm: s / sum };
  }
  /** E23.3.4: the Power view's dim, 0 … 1: the scene lights and the exposure ease down to POWER.view's `light` and
   * `exposure` shares. Glows that should stay bright multiply their emissive by `boost` to make up for the exposure. */
  dim = 0;

  /** The share of their strength the scene's lights keep under the Power view's dim (lamps follow it). */
  get lightShare(): number {
    return this.lightKeep;
  }

  private get lightKeep(): number {
    return 1 - this.dim * (1 - POWER.view.light);
  }

  /** #photo-2: photo mode's brightness: a multiplier on the exposure (1 in play; a stop up is 2). */
  exposureGain = 1;

  private get exposureKeep(): number {
    return 1 - this.dim * (1 - POWER.view.exposure);
  }

  /** What a glow multiplies its emissive by so the Power view's dim leaves it as bright as before. */
  get boost(): number {
    return 1 / this.exposureKeep;
  }

  constructor(
    private app: pc.AppBase,
    private scene: SceneBuilder,
    private sky: Sky,
  ) {
    this.reload();
  }

  /** P7-E27.7: re-reads the light colours from LOOK and DAY_LIGHT (construction, and live tuning via look.apply()). */
  reload() {
    this.base.sun = color(LOOK.sun.color);
    this.base.low = color(DAY_LIGHT.lowSunColour);
    this.base.moon = color(DAY_LIGHT.moonColour);
    this.base.fill = color(LOOK.fill.color);
    this.base.fillNight = color(DAY_LIGHT.fillNightColour);
    this.base.twLight = color(TWILIGHT.light);
    this.base.twFill = color(TWILIGHT.fill);
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
    this.daylight = day;
    const h = sunHeightAt(f);
    // The sun's path (low in the east, up to noon, low in the west; under the ground back east by night) and the
    // moon's (across the other side by night, back under by day). The key light blends from one to the other by
    // the daylight, so shadows swing round through twilight and never jump.
    const [hx, hz] = LOOK.sun.toward;
    const head = Math.atan2(hx, hz);
    const dayT = f < DAY.dayShare ? f / DAY.dayShare : 1 - (f - DAY.dayShare) / (1 - DAY.dayShare);
    const nightT = f >= DAY.dayShare ? (f - DAY.dayShare) / (1 - DAY.dayShare) : 1 - f / DAY.dayShare;
    const sunEl = lerp(L.sunLow, L.sunHigh, h);
    const sunAz = head + (sunSwing(dayT) * Math.PI) / 180;
    const moonEl = L.moonElevation * (0.4 + 0.6 * Math.sin(Math.PI * nightT));
    const moonAz = head + Math.PI * 0.85 + ((nightT - 0.5) * L.swing * Math.PI) / 180;
    const toDir = (elDeg: number, azR: number, out: pc.Vec3) => {
      const e = (elDeg * Math.PI) / 180;
      return out.set(Math.sin(azR) * Math.cos(e), -Math.sin(e), Math.cos(azR) * Math.cos(e));
    };
    // #sunsets: the sun and moon in the sky. The sun's disc keeps its heading but follows a true arc (on the horizon
    // at dawn and dusk, under it by night, slope unbroken); the moon's rides low along the moonlight's heading.
    const M = SUN_MOON.moon;
    this.sunEl = f < DAY.dayShare ? L.sunHigh * h : -L.sunHigh * ((1 - DAY.dayShare) / DAY.dayShare) * Math.sin(Math.PI * nightT);
    toDir(this.sunEl, sunAz, this.sunAt).mulScalar(-1);
    const moonDiscEl = f >= DAY.dayShare ? lerp(M.low, M.high, Math.sin(Math.PI * nightT)) : -M.high * Math.sin((Math.PI * f) / DAY.dayShare);
    toDir(moonDiscEl, moonAz, this.moonAt).mulScalar(-1);
    const S = SUN_MOON.sunset;
    this.sunset = (1 - smooth(this.sunEl / S.from)) * smooth((this.sunEl + S.under) / S.under) * (1 - oc);
    this.moonShow = smooth((1 - day - M.from) / (1 - M.from)) * (1 - oc * 0.9);
    this.sky.sunAt = this.sunAt;
    this.sky.moonAt = this.moonAt;
    this.sky.sunEl = this.sunEl;
    this.sky.sunset = this.sunset;
    this.sky.moonShow = this.moonShow;
    const tw = (this.twilight = twilightAt(this.sunEl, oc));
    this.sky.twilight = tw;
    const moonW = 1 - smooth(day * L.moonBlend);
    toDir(sunEl, sunAz, this.dir);
    toDir(moonEl, moonAz, this.fd);
    this.dir.lerp(this.dir, this.fd, moonW).normalize();
    this.scene.sun.setRotation(this.q.setFromDirections(pc.Vec3.DOWN, this.dir));
    // colour: warm when low, LOOK's golden hour in the middle of the day, moonlight at night
    const sunLight = this.scene.sun.light!;
    const warm = 1 - smooth(h / L.warmBelow);
    this.tmp.lerp(this.base.sun, this.base.low, warm);
    this.tmp.lerp(this.base.moon, this.tmp, day);
    // #twilight: the land goes dusky under a low pink light
    if (tw > 0) this.tmp.lerp(this.tmp, this.base.twLight, tw);
    // the Power view: the light goes cool and grey as it dims, so the world reads muted and the yellow grid pops
    if (this.dim > 0) this.tmp.lerp(this.tmp, this.viewLight, this.dim);
    sunLight.color = this.tmp.clone();
    // under cloud the sun all but goes: soft, shadowless light from the sky instead
    const sunI = lerp(L.moonIntensity, LOOK.sun.intensity, day) * (1 - oc * 0.88);
    const keep = this.lightKeep;
    sunLight.intensity = (sunI * (1 - tw * (1 - TWILIGHT.lightKeep)) + (m.flash ?? 0) * LOOK.sun.intensity * 0.8) * keep;
    // the fill keeps its own side, opposite the key light
    const fill = this.scene.fill.light!;
    this.fd.set(-this.dir.x, -0.75, -this.dir.z).normalize();
    this.scene.fill.setRotation(this.q.setFromDirections(pc.Vec3.DOWN, this.fd));
    this.fillCol.lerp(this.base.fillNight, this.base.fill, day);
    if (tw > 0) this.fillCol.lerp(this.fillCol, this.base.twFill, tw);
    if (this.dim > 0) this.fillCol.lerp(this.fillCol, this.viewLight, this.dim);
    fill.color = this.fillCol.clone();
    fill.intensity = lerp(L.fillNight, LOOK.fill.intensity, day) * (1 + oc * 0.6) * keep;
    this.scene.setEnvNight(1 - day, tw);
    this.app.scene.skyboxIntensity = lerp(L.envNight, LOOK.env.intensity, day) * (1 - oc * 0.1) * (1 - tw * (1 - TWILIGHT.envKeep)) * keep;
    // the rim's share of LOOK.rim.intensity: night's own strength by night
    this.rim = lerp(lerp(L.rimNight / Math.max(1e-6, LOOK.rim.intensity), 1, day), TWILIGHT.rimShare, tw) * (1 - oc * 0.5);
    // E23.7.5: night keeps the day's exposure: it is a blue moonlit look made of light and colour, not a darker picture
    this.app.scene.exposure = LOOK.exposure * (1 - oc * 0.22) * (1 + (m.flash ?? 0) * 0.5) * this.exposureKeep * this.exposureGain;
    // the sky: night, the warm band at dawn and dusk, and the weather's cloud
    this.sky.night = 1 - day;
    const edge = Math.min(Math.abs(f - DAY.dayShare), f, 1 - f); // distance to the nearer horizon
    this.sky.dusk = (1 - smooth(edge / (DAY.twilight * L.duskSpan))) * (1 - oc);
    this.sky.overcast = oc;
    // the unlit clouds: warm at dusk, dim blue at night, greyer under heavy cloud
    const n = 1 - day;
    const d = this.sky.dusk;
    const grey = 1 - oc * 0.25;
    this.cloudTint.set(lerp(1, L.cloudNight[0], n) * grey, lerp(lerp(1, 0.86, d), L.cloudNight[1], n) * grey, lerp(lerp(1, 0.8, d), L.cloudNight[2], n) * grey);
    const TC = TWILIGHT.cloudTint;
    if (tw > 0) this.cloudTint.set(lerp(this.cloudTint.r, TC[0] * grey, tw), lerp(this.cloudTint.g, TC[1] * grey, tw), lerp(this.cloudTint.b, TC[2] * grey, tw));
    this.cloudTint.mulScalar(keep); // the clouds and fog sheets are unlit: they take the lights' dim by hand
  }
}
