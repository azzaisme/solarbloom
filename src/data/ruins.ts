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
    { name: 'far', radius: [470, 520] as [number, number], fade: 0.46, scale: 0.85, density: 1.6, land: [1, 10] as [number, number] },
    { name: 'mid', radius: [330, 370] as [number, number], fade: 0.3, scale: 0.55, density: 1.8, land: [0.5, 6] as [number, number] },
    { name: 'near', radius: [215, 240] as [number, number], fade: 0.17, scale: 0.36, density: 1.4, land: [0.3, 3] as [number, number] },
  ],
  /**
   * Coasts per layer: [from°, to°] bearings. The mainland fills the east; the north and west have broken coasts; the
   * south (the open sea past the jetty) stays open, with only a far, faint shore across it.
   */
  coasts: {
    far: [[25, 120], [150, 215], [240, 300], [325, 350]],
    mid: [[48, 135], [165, 200], [228, 262]],
    near: [[62, 112], [182, 206], [276, 292]],
  } as Record<'far' | 'mid' | 'near', [number, number][]>,
  /** what stands on the coasts (relative weights per layer) */
  kinds: {
    far: { tower: 3, spire: 2, aqueduct: 2, block: 3, frame: 1, turbine: 0, viaduct: 1 },
    mid: { tower: 3, spire: 2, aqueduct: 3, block: 2, frame: 1, turbine: 1, viaduct: 2 },
    near: { tower: 2, spire: 1, aqueduct: 2, block: 2, frame: 2, turbine: 2, viaduct: 1 },
  } as Record<'far' | 'mid' | 'near', Record<'tower' | 'spire' | 'aqueduct' | 'block' | 'frame' | 'turbine' | 'viaduct', number>>,
  /** albedos as seen (sRGB): weathered ivory stone, darker stone, rusted metal, old panels, dry plateau and cliff */
  colours: {
    stone: '#d6ccb8',
    stoneDark: '#a9a090',
    metal: '#8c7a68',
    panel: '#5f7286',
    landTop: '#b5aa8e',
    cliff: '#c4b69a',
    moss: '#97a07a',
  },
  /**
   * Baked light: sun (key light's colour, `sun` strength on faces turned to it) over a sky ambient (`ambient` by
   * day, `ambientNight` by night). The light's direction and colour are read from the scene's sun each recolour.
   */
  light: { sun: 0.55, ambient: 0.62, ambientNight: 0.3, nightTint: '#6d80b8' },
  /**
   * Height fog on the distance: low ground fades further toward the horizon colour than high ground, so the coasts'
   * feet melt into the sea haze and the towers stand clear of it. `strength` is the extra fade at sea level, easing
   * off with height over `height` units.
   */
  heightFog: { strength: 0.32, height: 6 },
  /** by night the bands fade less (dark blue silhouettes against the moonlit sky) */
  nightFade: 0.55,
  /** a few tiny warm lights on the near and mid ruins by night (not every structure lit) */
  lamps: { count: 7, colour: '#ffc27a', size: 0.9, from: 0.45 },
  /** while the city is fogged (Sky.clarity 0), the bands fade this much further toward the horizon */
  foggedFade: 0.15,
} as const;

export type RuinLayerName = 'far' | 'mid' | 'near';
export type RuinKind = keyof (typeof RUINS.kinds)['far'];
