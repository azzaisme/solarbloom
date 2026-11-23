/**
 * P7-E32 (#718): the distant ruined city round the island (rendering/Ruins.ts). Pure scenery: generated once from
 * `seed`, never saved, never read by the simulation.
 *
 * The scene fog ends 64–88 units past the camera target and the far clip a little after it, so the ruins can't stand
 * in the world at their real distance. They are built at their real size and place (world units, round `centre`) and
 * drawn in their own layer right after the world's opaque pass, with every vertex slid along its own ray from the
 * camera onto a plane where the distance above the horizon has gone wholly to haze: on screen each silhouette is
 * exactly where the real one would be, while by depth the visible world hides them and the haze-coloured distance
 * doesn't. Their distance
 * fade is baked into vertex colours toward the sky's horizon colour (read from Sky each time the light or haze moves).
 *
 * Directions are compass bearings in degrees from `centre`: 0 is +z (south, the open sea beyond Saltwind Beach),
 * 90 is +x (east, the mainland), 180 is −z (north), 270 is −x (west).
 */
export const RUINS = {
  on: true,
  seed: 0x5b1e7,
  /** the island's middle (world x, z): bearings and radii are measured from here */
  centre: [8, 8] as [number, number],
  /** the thinnest any part is, as a share of its band's distance (~0.25°: thinner is lost and leaves crossbars floating) */
  minThin: 0.0045,
  /**
   * the depth the ruins are drawn at, as a share of where the horizon haze is full (Ruins.update): a little short of
   * it, since the haze is measured along each ray and the depth along the view (they part toward the screen's edges)
   */
  depth: 0.85,
  /** azimuth slices per layer: each is its own mesh so the camera culls the ones behind it */
  sectors: 6,
  /**
   * The three bands of the horizon, far first (they are drawn in this order). `radius`: distance from the centre;
   * `fade`: how far toward the horizon colour the band is mixed by day (atmospheric perspective: blue, not milky);
   * `scale`: size of its structures; `density`: structures per 10° of coast it stands on; `land`: the coast's
   * plateau height range under it.
   */
  layers: [
    // P7-E32 (lead review): the bands step back in value (near clearly darker and bluer than the sky, far faint), and
    // stand on real land: low coasts rising to mesas, highest under the near band
    { name: 'far', radius: [470, 520] as [number, number], fade: 0.5, scale: 1.0, density: 1.0, land: [2, 12] as [number, number] },
    { name: 'mid', radius: [330, 370] as [number, number], fade: 0.3, scale: 0.75, density: 1.0, land: [2, 11] as [number, number] },
    { name: 'near', radius: [215, 240] as [number, number], fade: 0.1, scale: 0.62, density: 0.75, land: [2, 13] as [number, number] },
  ],
  /**
   * Coasts per layer: [from°, to°] bearings. The mainland fills the east; the north and west have broken coasts; the
   * south (the open sea past the jetty) stays open between two headlands, with only a far, faint shore across it.
   */
  coasts: {
    far: [[25, 120], [150, 215], [240, 300], [325, 350]],
    // headlands either side of the south frame the open sea past the jetty (it stays open from 345° to 15°)
    mid: [[22, 135], [165, 200], [228, 262], [318, 342]],
    near: [[40, 112], [182, 206], [276, 292], [322, 336]],
  } as Record<'far' | 'mid' | 'near', [number, number][]>,
  /** what stands on the coasts (relative weights per layer) */
  kinds: {
    // fewer, bigger, more distinctive pieces up close (arches, jagged towers, ruined domes); thin frames and turbines
    // only in the middle distance, where they read as a skyline detail
    far: { tower: 3, spire: 2, aqueduct: 2, block: 3, dome: 2, frame: 0, turbine: 0, viaduct: 0 },
    mid: { tower: 3, spire: 2, aqueduct: 3, block: 1, dome: 2, frame: 0, turbine: 1, viaduct: 1 },
    near: { tower: 3, spire: 1, aqueduct: 4, block: 1, dome: 2, frame: 0, turbine: 0, viaduct: 0 },
  } as Record<'far' | 'mid' | 'near', Record<'tower' | 'spire' | 'aqueduct' | 'block' | 'dome' | 'frame' | 'turbine' | 'viaduct', number>>,
  /** waterfalls off the near band's highest cliffs (at most this many, where the cliff is at least `minHeight`) */
  falls: { count: 3, minHeight: 8, colour: '#e4f0f6' },
  /** how far the land's face toward the island leans back per unit of height (0 a sheer cliff): hills, not slabs */
  slope: { far: 3, mid: 2, near: 0.7 } as Record<'far' | 'mid' | 'near', number>,
  /** albedos as seen (sRGB): weathered ivory stone, darker stone, rusted metal, old panels, dry plateau and cliff */
  colours: {
    stone: '#c4bcab',
    stoneDark: '#9a9486',
    metal: '#8c7a68',
    panel: '#5f7286',
    landTop: '#a39c82',
    cliff: '#a9a08c',
    moss: '#7f9468',
  },
  /**
   * Baked light: sun (key light's colour, `sun` strength on faces turned to it) over a sky ambient (`ambient` by
   * day, `ambientNight` by night). The light's direction and colour are read from the scene's sun each recolour.
   */
  // the day ambient is the sky's cool blue (`dayTint`), so shaded faces read blue-grey against the pale horizon
  light: { sun: 0.6, ambient: 0.5, ambientNight: 0.3, dayTint: '#93acd8', nightTint: '#6d80b8' },
  /**
   * Height fog on the distance: low ground fades further toward the horizon colour than high ground, so the coasts'
   * feet melt into the sea haze and the towers stand clear of it. `strength` is the extra fade at sea level, easing
   * off with height over `height` units.
   */
  heightFog: { strength: 0.25, height: 3 },
  /** by night the bands fade less (dark blue silhouettes against the moonlit sky) */
  nightFade: 0.55,
  /** a few tiny warm lights on the near and mid ruins by night (not every structure lit) */
  lamps: { count: 7, colour: '#ffc27a', size: 0.9, from: 0.45 },
  /** while the city is fogged (Sky.clarity 0), the bands fade this much further toward the horizon */
  foggedFade: 0.15,
} as const;

export type RuinLayerName = 'far' | 'mid' | 'near';
export type RuinKind = keyof (typeof RUINS.kinds)['far'];
