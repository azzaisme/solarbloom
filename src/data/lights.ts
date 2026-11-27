/**
 * E23.3.5 (#471): night lighting. Lights are decorations: crafted, then placed in decoration mode. They come on by
 * themselves as the sun goes down (and in fog and storms), fading in, and go off at dawn. No switch, no menu.
 *
 * Three ways to power one:
 * - `grid`: placed within reach of a pole (or touching a grid machine). First in the shed order: on a short grid
 *   they dim, then go out gently, and come back when power returns.
 * - `solar`: its own tiny panel and battery, so it works anywhere with no grid. Dimmer, and shorter-lived after a
 *   cloudy day (its battery filled less).
 * - `glow`: glow-pods, grown from a bioluminescent plant. No power at all.
 *
 * `line` lights are hung on a power pole: they string along every link from that pole to the next.
 * All numbers are starting values for tuning.
 */

import type { CozyUnlock } from './cozy';

export type LightPower = 'grid' | 'solar' | 'glow';

/** What a light costs at the crafting table (component and material ids, E23.6.1). */
export type LightCost = Partial<Record<'wire' | 'glassPane' | 'sunCell' | 'planks' | 'scrap' | 'seeds' | 'copper' | 'glass', number>>;

export interface LightDef {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  power: LightPower;
  /** hung on a power pole's lines instead of standing on a tile */
  line?: boolean;
  /** how bright at full power (0..1): warm and low */
  brightness: number;
  /** height of the glowing part above the ground (tiles); for line lights, how far apart the bulbs hang */
  bulbY: number;
  /** line lights: tiles between bulbs along a line */
  spacing?: number;
  /** #851: where the glowing part sits off the tile's middle, facing its front (tiles), and its size (tiles) */
  bulbAt?: [number, number];
  bulbSize?: [number, number, number];
  /** the glow's colour, a PALETTE.light.lamps key */
  tone: 'warm' | 'amber' | 'rose' | 'cream' | 'green';
  /** walk-blocking, like any decoration */
  solid: boolean;
  /** grid draw (W) at full brightness; line lights: per bulb */
  draw?: number;
  cost: LightCost;
  /** starting set, a cache find, or Decor research (E23.6.2) */
  unlock: CozyUnlock;
}

export const LIGHTS: LightDef[] = [
  // On the poles and lines
  { id: 'festoon', name: 'Festoon bulbs', icon: '💡', blurb: 'Round warm bulbs strung between the power poles.', power: 'grid', line: true, brightness: 0.9, bulbY: 0, spacing: 1.1, tone: 'warm', solid: false, draw: 0.04, cost: { wire: 2, glassPane: 1 }, unlock: { start: true } },
  { id: 'fairylights', name: 'Fairy lights', icon: '✨', blurb: 'Tiny lights along the lines, like dew.', power: 'grid', line: true, brightness: 0.75, bulbY: 0, spacing: 0.35, tone: 'cream', solid: false, draw: 0.01, cost: { wire: 3 }, unlock: { research: 'dc-lights' } },
  { id: 'paperlanterns', name: 'Paper lanterns', icon: '🏮', blurb: 'Soft paper lanterns hung along the lines.', power: 'grid', line: true, brightness: 0.8, bulbY: 0, spacing: 1.8, tone: 'rose', solid: false, draw: 0.05, cost: { wire: 1, planks: 1, seeds: 1 }, unlock: { find: 'c-oldMarket-2' } },
  { id: 'glasslanterns', name: 'Glass lanterns', icon: '🏮', blurb: 'Old glass lanterns hanging from the lines.', power: 'grid', line: true, brightness: 0.85, bulbY: 0, spacing: 3, tone: 'amber', solid: false, draw: 0.08, cost: { wire: 1, glassPane: 2 }, unlock: { find: 'c-mastRow-2' } },
  // Free-standing
  { id: 'lamppost', name: 'Lamp post', icon: '💡', blurb: 'An old iron street lamp. It needs a power line.', power: 'grid', brightness: 1, bulbY: 1.02, tone: 'warm', solid: true, draw: 0.5, cost: { scrap: 3, wire: 1, glassPane: 1 }, unlock: { find: 'c-mastRow-1' } },
  // Old saves' lamp posts become this (they were placed before lamp posts needed a pole), so nothing goes dark.
  { id: 'solarlamppost', name: 'Solar lamp post', icon: '🔆', blurb: 'An old iron street lamp with a little sun panel on top. It needs no power line.', power: 'solar', brightness: 0.8, bulbY: 1.02, tone: 'warm', solid: true, cost: { scrap: 3, glassPane: 1, sunCell: 1 }, unlock: { find: 'c-mastRow-1' } },
  { id: 'pathlight', name: 'Path light', icon: '💡', blurb: 'A low bollard light for the edge of a path. It needs a power line.', power: 'grid', brightness: 0.8, bulbY: 0.36, tone: 'warm', solid: true, draw: 0.2, cost: { scrap: 2, wire: 1, glassPane: 1 }, unlock: { start: true } },
  { id: 'lantern', name: 'Garden lantern', icon: '🏮', blurb: 'A little lantern with its own sun cell. It needs no power line.', power: 'solar', brightness: 0.6, bulbY: 0.22, tone: 'amber', solid: false, cost: { glassPane: 1, scrap: 1, sunCell: 1 }, unlock: { start: true } },
  { id: 'solarstake', name: 'Solar garden light', icon: '🔆', blurb: 'A stake light with a tiny panel on top. It needs no power line.', power: 'solar', brightness: 0.5, bulbY: 0.3, tone: 'cream', solid: false, cost: { sunCell: 1, scrap: 1 }, unlock: { start: true } },
  { id: 'uplight', name: 'Uplight', icon: '🔦', blurb: 'A ground light that washes a tree or a landmark in light from below. It needs a power line.', power: 'grid', brightness: 0.85, bulbY: 0.08, tone: 'cream', solid: false, draw: 0.3, cost: { scrap: 1, wire: 1, glassPane: 1 }, unlock: { research: 'dc-lights' } },
  { id: 'porchlight', name: 'Wall light', icon: '💡', blurb: 'A bracket lamp on a stone post, for the house and the ruins. It needs a power line.', power: 'grid', brightness: 0.85, bulbY: 1.05, tone: 'warm', solid: true, draw: 0.3, cost: { scrap: 2, wire: 1, glassPane: 1 }, unlock: { find: 'c-saltwind-1' } },
  // #851: was "Table lamp"; renamed so it never sits in the tray beside the room's own Table lamp (same id: saves keep it)
  { id: 'tablelight', name: 'Patio lamp', icon: '💡', blurb: 'A little table with a lamp on it. It needs a power line.', power: 'grid', brightness: 0.7, bulbY: 0.62, tone: 'warm', solid: true, draw: 0.2, cost: { planks: 2, wire: 1, glassPane: 1 }, unlock: { research: 'dc-lights' } },
  { id: 'glowpod', name: 'Glow-pods', icon: '🌱', blurb: 'A plant that glows softly at night all by itself, with no power at all.', power: 'glow', brightness: 0.55, bulbY: 0.25, tone: 'green', solid: false, cost: { seeds: 3 }, unlock: { start: true } },
];

/**
 * #851: lamps made for a room. Kept out of LIGHTS (that list makes the outdoor lights' decorations and their recipes);
 * their decorations are in data/cozy with the other indoor pieces. `glow` power: no power line, so a lamp glows at full
 * brightness as night falls wherever it stands, inside the house or out. (The room's own wall lamp lights the room day
 * and night as before: rendering/HouseInterior.) Their `cost` is unused: how each is earned is data/crafting's (#852).
 */
export const ROOM_LIGHTS: LightDef[] = [
  { id: 'floorlamp', name: 'Floor lamp', icon: '🪔', blurb: 'A tall lamp with a cloth shade that glows warm at night.', power: 'glow', brightness: 0.95, bulbY: 1.08, bulbSize: [0.36, 0.26, 0.36], tone: 'warm', solid: true, cost: {}, unlock: { start: true } },
  { id: 'tablelamp', name: 'Table lamp', icon: '🕯️', blurb: 'A little lamp on a little table, for reading by.', power: 'glow', brightness: 0.8, bulbY: 0.66, bulbAt: [0.06, -0.04], bulbSize: [0.24, 0.18, 0.24], tone: 'cream', solid: true, cost: {}, unlock: { start: true } },
];

export const LIGHT: Record<string, LightDef> = Object.fromEntries([...LIGHTS, ...ROOM_LIGHTS].map((l) => [l.id, l]));

export const LIGHTING = {
  /**
   * E23.7.5: the light lamps really cast. Each lit lamp is a point light at its bulb with inverse-square falloff
   * and no shadows. PlayCanvas' falloff is 16 / (d² + 1), so at `intensity` 0.5 a full-brightness lamp lights the
   * ground a tile away about as brightly as the sun (LOOK's 3.4) and fades to a glow by three tiles; `range` (tiles)
   * is where it ends. `minHeight` is the lowest a light shines from (a ground light's pool would be a pinprick
   * otherwise). `max` real lights at once go to the lit lamps nearest the view (`maxLow` on the low graphics tier).
   * Line lights get one real light per `lineEvery` tiles of bulbs, at `linePower`; glow-pods glow faintly.
   */
  /**
   * E23.7.5: the lit bulb. `glow` is its emissive at the dimmest and at full brightness, authored as a glow (Look 1.9:
   * 1 and above is scaled into the bloom range), so a lit lamp's head shines and blooms. `cover` scales the lit bulb a
   * little past the lamp's unlit glass (DecorArt), so the glass reads as lit, not as a dull shape around a light.
   */
  bulb: { glow: [1, 3] as [number, number], cover: 1.15 },
  cast: { intensity: 0.5, range: 5, minHeight: 0.55, max: 48, maxLow: 24, lineEvery: 2.2, linePower: 0.7, glowPower: 0.4 },
  /** seconds a light takes to fade in at dusk (or out at dawn), on top of the sky's own twilight */
  fadeSeconds: 4,
  /** a solar light: its panel at full sun (W), its battery (W·s) and its lamp's draw (W) */
  // On E23.7's clock a sunny day gives ~1,608 full-sun seconds and a night ~1,075 dark ones. A sunny day charges
  // ~400 W·s; the night uses ~365 at 0.34 W, so it lasts till dawn. After a cloudy day (−20%: ~320) it runs out about
  // two minutes before dawn and dims.
  solar: { panel: 0.25, capacity: 410, rate: 1, draw: 0.34 },
  /** how close to a pole a line light can be placed, measured from the aimed tile to the pole (tiles) */
  poleReach: 1.6,
  /** fireflies and moths: how many lights near the view gather them, and how many each */
  insects: { lights: 12, perLight: 3 },
  /** Lights placed before E23.3.5 (old saves): lamp posts become solar lamp posts, and they and lanterns start with
   * a full battery, so nothing the player built goes dark on its first night. */
  legacy: { lamppost: 'solarlamppost', charged: ['lantern', 'solarlamppost'] },
};
