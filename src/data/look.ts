import * as pc from 'playcanvas';

export type GfxTier = 'low' | 'medium' | 'high';

// Look 1 (lighting and post-processing): every rendering knob for the golden-hour look lives here, apart from
// gameplay tuning (tuning.ts), so the art pass can retune it without touching balance. In a dev build the live
// object is `window.solarbloom.look.cfg`: change a value, then call `window.solarbloom.look.apply()`.
// See docs/art/rendering.md for the pipeline these numbers are tuned against.

export const LOOK = {
  /** Look 1.2: the golden-hour key light. Elevation above the horizon and compass direction it shines toward. */
  sun: {
    // E27.1 (#679): was 3.4, which with the old ambient lit sunlit sand and grass three to four times past white
    // before tone mapping (most of a beach clipped). Now a sunlit pale surface lands just under white, and the
    // sun is about three times the shade's light, so shadows read
    color: '#ffdcaa',
    intensity: 2.1,
    elevation: 34,
    /**
     * Horizontal direction the light travels, as a world-space (x, z) vector. With the default camera yaw (45°)
     * this throws shadows toward the lower left of the screen, like the reference (sun behind, to the right).
     */
    toward: [-0.25, 0.97] as [number, number],
    /** Shadow bias tuned for 2048² maps over the zoom-dependent shadow distance. */
    shadowBias: 0.2,
    normalOffsetBias: 0.05,
  },
  /** Look 1.3: a cool, low fill from the side opposite the sun (no shadows). E27.1: a soft sky blue (was grey). */
  fill: { color: '#d0dcf0', intensity: 0.45 },
  /**
   * Look 1.3: ambient light from the sky above and the ground below, baked into a tiny environment atlas.
   * Colours are linear-ish sRGB hex; `intensity` scales the whole environment (ambient and reflections).
   */
  env: {
    // E27.1 (#679): a bluer sky and a lower strength (was 1.15 of a near-white horizon, which filled every shadow);
    // the ground's warm bounce keeps the shade side of ivory stone warm, not navy
    zenith: '#82aae0',
    horizon: '#dde3ea',
    ground: '#a08a62',
    intensity: 0.7,
  },
  /**
   * Look 1.3: a warm rim on silhouettes (a view-dependent term added in the standard shader), stronger on the
   * sun side, so flowers, the drone and machines pick up a bright edge against darker ground.
   */
  // Phase 6: stronger and more golden (was '#ffc98a', 0.8, power 3.0 on a plain 1 - N·V edge); see LookShaders
  // E27.1 (#679): softer and tighter (was 2.6, power 1.3): at that strength the gold edge lit half of every bush and
  // tuft, which is much of why the grass read fluorescent yellow-green
  rim: { color: '#ffd35c', intensity: 1.2, power: 2.2 },
  /**
   * Look 1.4: tone mapping and exposure. Khronos PBR Neutral keeps the palette's hues and saturation (ACES
   * bleached the greens and pinks toward yellow-white), and rolls highlights off so nothing clips.
   */
  toneMapping: pc.TONEMAP_NEUTRAL as number,
  exposure: 1.1,
  /**
   * Look 1.5: bloom on emissive and very bright pixels only. The threshold is scene-referred (before exposure and
   * tone mapping): glows are authored at 3 and above (Look 1.9). E27.1 (#679): was 1.15, under sunlit sand (about
   * 1.7), so pale ground bloomed by day and laid a warm veil over the picture; now only glows and sparkles bloom.
   * E23.7.5: `night` multiplies the intensity by deep night, so lamps, the pulse ring and glows wear soft halos
   * against the blue (by day it would wash the sunlit ground).
   */
  bloom: { intensity: 0.14, threshold: 1.8, blurLevel: 14, night: 2 },
  /**
   * Look 1.9: emissive budget (scene-referred, before exposure; bloom starts at 1.5). See docs/art/rendering.md.
   * `gain` multiplies every standard material authored as a glow (emissiveIntensity >= 1); weaker emissive tints
   * stay as they are and never bloom. `vertexGlow` is the glow of chunk geometry flagged in its vertex alpha (lit
   * lamps, Radiant flowers). `tile` drives restore-tile flashes and glows, `preview` the pulse footprint preview,
   * `particles` the burst and trail sparkles.
   */
  emissive: { gain: 4, vertexGlow: 4, tile: 4, preview: 3, particles: 2.5 },
  /**
   * Look 1.6: screen-space ambient occlusion for contact shadows (High tier). The radius is in world units (a tile
   * is 1): `radiusPerView` × the world height in view, clamped, so close-ups get tight contact shadows under
   * bushes and machines and the overview still shows grounding around buildings and trees.
   */
  ssao: { intensity: 1, power: 2, minAngle: 10, samples: 12, radiusPerView: 0.12, minRadius: 0.6, maxRadius: 2 },
  /**
   * Look 1.7: colour grading. `warm` is the restored look; `dead` is the fogged / unrestored mood. The game blends
   * between them by the restoration of the area in view (0 = dead, 1 = warm), so the light comes back as you
   * restore. Read every frame: live edits apply at once.
   */
  grade: {
    // E27.1 (#679): saturation 1.32 and vibrance 0.42 pushed the greens fluorescent, and lifted shadows flattened them
    warm: { brightness: 1.0, contrast: 1.06, saturation: 1.1, tint: '#fff4e4', shadows: 0.0, highlights: -0.15, vibrance: 0.15 },
    dead: { brightness: 0.97, contrast: 1.03, saturation: 0.82, tint: '#e9eef6', shadows: 0.0, highlights: -0.1, vibrance: 0.0 },
    /** High contrast (settings): a flatter grade with no vignette so outlines and text stay readable. */
    contrast: { brightness: 1.02, contrast: 1.0, saturation: 1.0, tint: '#ffffff', shadows: 0.2, highlights: -0.1, vibrance: 0.0 },
    /** Seconds for the mood to follow a change in restoration. */
    follow: 2.5,
  },
  /**
   * Look 1.8: depth of field (High tier). Focus is on the camera's goal point; the far blur starts `blurFrom` world
   * units beyond it (where the haze is already strong, so blur and haze rise together) and is complete one
   * `blurRamp` further. Near blur is off, so nothing in front of the focus is ever blurred.
   */
  dof: { blurFrom: 9, blurRamp: 18, blurRadius: 3, blurRings: 3, blurRingPoints: 4 },
  /**
   * Look 1.10: the warm golden haze toward the horizon (the linear fog; where it starts and ends follows the zoom,
   * see CameraController.hazeStart / hazeEnd). The camera clears to it when post-processing is on.
   */
  haze: { color: '#f4ecdc' },
  /**
   * E27.1 (#679): haze toward the horizon (LookShaders). With the skyline gone (#681) the far sea and coast sat in a
   * hard line against the sky from the low follow camera. Far surfaces within `band` degrees below the camera fade
   * into the haze colour, fully by `reach` of the way from where the depth fog starts to where it ends (nothing
   * nearer than the fog's start is touched), so the sea's edge and the far coast dissolve into the sky. The sky's
   * lowest `skyBand` degrees and the fog colour are matched to one colour (Sky.horizonSeen, fogMatchingSky).
   */
  horizon: {
    band: 6,
    reach: 0.45,
    strength: 1,
    /** how many degrees of sky above the horizon ease into the haze as the fogged distance shows it (Sky) */
    skyBand: 5,
  },
  /**
   * Look 1.10: drifting light motes and soft light shafts over restored ground near the camera's focus. Counts per
   * graphics tier; `lowVfx` and reduced motion turn the motes off, reduced motion freezes the shafts.
   */
  atmosphere: {
    motes: { high: 90, medium: 50, low: 0 },
    shafts: { high: 5, medium: 3, low: 0 },
    moteColor: '#ffe9a8',
    moteGlow: 3,
    moteSize: 0.05,
    shaftColor: '#ffd9a0',
    shaftGlow: 0.35,
    shaftWidth: 1.6,
    shaftLength: 7,
  },
  vignette: { intensity: 0, inner: 0.55, outer: 1.35, curvature: 0.6, color: '#2a1d14' },
  /**
   * Look 1.11: what each graphics tier turns on. High is for laptops and desktops (60 fps), Low for mid-range phones
   * (30 fps or better). Low has no post-processing: the camera tone-maps directly, so there is no grade, vignette,
   * bloom, SSAO or depth of field. Fauna caps per tier live in tuning.ts (E16).
   */
  tiers: {
    low: { post: false, samples: 1, shadowRes: 1024, shadowCascades: 1, softShadows: false, bloom: false, ssao: false, dof: false, rim: true, waterReflect: false },
    // #648: 4× MSAA on Medium too (and so on the Deck, which draws Medium at 0.75 scale): at 2× the long thin
    // edges of the retaining walls and their coping stepped visibly
    medium: { post: true, samples: 4, shadowRes: 2048, shadowCascades: 2, softShadows: false, bloom: true, ssao: false, dof: false, rim: true, waterReflect: false },
    high: { post: true, samples: 4, shadowRes: 4096, shadowCascades: 3, softShadows: true, bloom: true, ssao: true, dof: false, rim: true, waterReflect: true },
  } satisfies Record<GfxTier, TierSpec>,
  /**
   * #156: how the sun's shadow cascades split the shadow distance, 0 (even) … 1 (logarithmic: most detail near the
   * camera). The skyline and sky are unlit and cast no shadows, so the cascades only cover the playable terrace.
   */
  cascadeDistribution: 0.6,
  /**
   * #648: the Old City's retaining walls (ChunkRenderer.terrace), in metres. The coping runs straight along a wall
   * and only reaches past the tile where the wall ends or turns, so neighbouring stones never overlap in a notch.
   * Brick courses stand far enough off the face that their top edge is never thinner than a pixel.
   */
  wall: {
    /** the wall's thickness, centred on the tile edge */
    thick: 0.12,
    /** how far the coping reaches out over each face */
    copingLip: 0.03,
    copingHeight: 0.06,
    /** brick courses: one every `courseStep` up from `courseFrom` above the lower side's ground */
    courseFrom: 0.15,
    courseStep: 0.45,
    courseHeight: 0.06,
    /** how far a course stands proud of the face */
    courseProud: 0.03,
    /** how far the foot sinks below the lower side's ground or water */
    footSink: 0.25,
  },
  /**
   * E28.W01 (#694): the water (WaterSurface). One surface for every stretch of live water (the open sea, its
   * shallows, the beach's surf and restored pools), coloured by how far it is from land, with ripples, sun and moon
   * highlights, Fresnel reflections of the sky (and, on High, of the world itself) and foam that laps the shores and
   * curls round whatever stands in the water. Colours are sRGB hex (the shader works in linear). Lengths are in world
   * units, and one world unit is one tile (Bloombot stands about half of one).
   */
  water: {
    /** clear water right by the shore (shallow): turquoise */
    shallow: '#53c9cb',
    /** deep water, `deepAt` tiles from land and beyond: deep teal-blue (the colour blends smoothly between the two) */
    deep: '#176b83',
    /** the beach's surf while it is still dead: murky (restoring it clears it) */
    murky: '#6e877b',
    /** the sand seen through the shallows */
    bed: '#d3c08e',
    /** foam on the shore and round things in the water */
    foam: '#eef8f4',
    /** depth: the water deepens away from land (its distance to land stands in for depth), reaching `deep` by `deepAt` */
    deepAt: 5,
    /** the bed shows through the shallows, fading out by `bedReach` tiles from land, up to `bedShow` of the colour */
    bedReach: 1.4,
    bedShow: 0.5,
    /** light nets on the bed in the shallows (0 off) */
    caustics: 0.1,
    /**
     * The large waves: a few long, low waves, each its own direction (`angle`, degrees round from +x toward +z),
     * wavelength (`length`), height (`amp`, crest to rest), speed (`speed`, units a second) and `phase`. They move
     * the surface itself (the vertex shader) and its normal follows them exactly. They ease in over `shore` units from
     * the waterline, so the waterline at the shore, on the banks and under the jetty stays put.
     */
    waves: {
      shore: 2,
      list: [
        { angle: 24, length: 5.3, amp: 0.035, speed: 0.55, phase: 0 },
        { angle: 113, length: 3.9, amp: 0.026, speed: 0.46, phase: 2.1 },
        { angle: -17, length: 4.5, amp: 0.022, speed: 0.5, phase: 4.4 },
        { angle: 68, length: 3.1, amp: 0.016, speed: 0.42, phase: 1.3 },
      ],
      /** Under a deck built low over the water (the jetty, a bridge: WaterDisturbance's covers) the swell lies flat,
       * easing back in over this many tiles round it, so a wave never laps up over the planks. */
      coverEase: 1.5,
    },
    /**
     * Small ripples: two scrolling normal maps, each a tile of `size` units drifting toward `angle` at `speed`,
     * made of waves `min` to `max` units long, tilting the surface by up to about `strength`. `distort` bends where
     * they're read by the large waves' slope, so they never scroll as one rigid sheet. Mipmapped: far off they
     * average out, and how much they varied within a pixel widens the highlight instead of sparkling.
     */
    ripples: {
      maps: [
        { size: 3.3, angle: 35, speed: 0.11, seed: 11 },
        { size: 2.3, angle: 161, speed: 0.08, seed: 29 },
      ],
      min: 0.2,
      max: 0.8,
      strength: 0.16,
      distort: 0.35,
    },
    /**
     * Ripples round things standing in the water (rocks, the jetty's posts, a bridge's supports): every now and
     * then (`rate` a second each, at its own time) a ring runs out from one, `length` apart, `width` wide, reaching
     * `reach` units and tilting the surface by `strength`. The `max` nearest the camera are drawn.
     */
    disturb: { max: 16, rate: 0.16, reach: 1.4, length: 0.32, width: 0.3, strength: 0.18 },
    /** waves that follow the shore and the outline of anything in the water, travelling in toward it */
    lap: { reach: 1.6, length: 0.55, speed: 0.5, strength: 0.18 },
    /** foam: how far out it reaches (tiles), how many lines, how fast they travel in, how strong */
    foamLine: { reach: 0.5, lines: 2, speed: 0.3, strength: 0.8 },
    /** the surface: gloss (sharp sun highlights) and how strong the highlight is (kept off neon, little bloom) */
    gloss: 0.93,
    /**
     * Keeping far water calm: a large wave's slope fades out between `fadeFrom` and `fadeTo` pixels per wavelength
     * (finer than that it could only shimmer), and how much the normal varies within a pixel (the ripple maps'
     * own spread, plus the large waves') roughens the highlight by `variance`, so far glints merge into a soft sun or
     * moon path (specular anti-aliasing). The small ripples fade the same way (and hand their slope to that spread)
     * between `rippleFrom` and `rippleTo` pixels per typical ripple.
     */
    antiAlias: { variance: 3, fadeFrom: 5, fadeTo: 2.5, rippleFrom: 30, rippleTo: 12 },
    /**
     * Glints: crisp highlight shapes where the surface turns the sun or moon toward the eye. `cut` (how close to a
     * perfect mirror, as a cosine), `soft` (edge), `strength`. They widen and dim with the normal's spread in a pixel,
     * so far off they become the soft highlight rather than specks.
     */
    glint: { cut: 0.985, soft: 0.004, strength: 1.2 },
    specular: 0.18,
    /** Fresnel: reflectance looking straight down, how fast it rises toward grazing, and its cap */
    fresnel: { base: 0.04, power: 5, max: 0.6 },
    /** how strongly the sky's colours reflect (all tiers) */
    sky: 0.7,
    /** reflections take on this much of the water's own hue, so far water reads aqua (or navy) rather than the haze's grey */
    reflectTint: 0.6,
    /** the sky's blue light filling the water's own colour (the engine's sky light is off for water: it reflects its own way) */
    ambient: 0.55,
    /**
     * High only: a planar reflection of the world (buildings, the jetty, plants, lamps at night) at `scale` of the
     * screen's size, drawn as far as `far` tiles, mixed in by `strength` and broken up by the ripples (`distort`),
     * re-rendered `every` frames (2: every other frame; the water samples it with the view it was drawn from, so it
     * stays in place, a frame behind at most, which the ripples hide)
     */
    reflect: { strength: 0.7, scale: 0.5, far: 50, distort: 0.08, every: 2 },
    /** by night the water's own colour dims to `nightAlbedo` of the day's (the moon, sky and lamps do the rest) */
    nightAlbedo: 0.55,
    /** by night the water's colour turns to this moonlit navy (the approved night sea) */
    night: '#123a8f',
  },
  /**
   * E28.W02 (#695): where natural ground meets the water. Every land edge that opens onto water at its own level
   * slopes down under the surface as a bank whose width wanders with the shore's noise, so the waterline is never the
   * tile's straight side. Lengths are tiles.
   */
  shore: {
    /** how far past the tile's edge the waterline sits: between `min` and `max`, by the shore's noise */
    reach: { min: 0.08, max: 0.5 },
    /**
     * before it slopes, the land's own top carries on out past the tile's edge by between `min` and `max` (its own
     * noise), falling only `crown` across it: the edge of the lawn bulges and draws back instead of running straight
     */
    shelf: { min: 0, max: 0.3 },
    crown: 0.012,
    /**
     * the water's foam edge sits right on a bank's waterline; its colour by depth, its sand bed, its shore waves and its
     * foam lines follow only this share of the way the bank pulled the edge out (so the shallows follow the new outline
     * but a narrow canal isn't all foam)
     */
    waterPull: 0.35,
    /** a bank keeps to this share of the open water in front of it, so the two banks of a narrow channel never meet */
    room: 0.24,
    /** where the shore carries on past a built edge (paving, a road), the bank eases down to nothing over this long */
    taper: 0.5,
    /** sand beaches reach this much further (and so slope more gently) */
    beach: 1.3,
    /** the noise: one broad swell every `scale` tiles, with `fine` of a smaller wobble on top */
    noise: { scale: 2.2, fine: 0.45 },
    /** the bank's toe lies this far under the water's surface (so the waterline is where the slope meets it) */
    under: 0.07,
    /** the share of the bank's slope that is an even ramp (the rest is a rounded shoulder easing in and out) */
    shoulder: 0.35,
    /** bank mesh detail: points per tile of shore, rows across the bank, points round a rounded corner */
    segments: 8,
    rows: 5,
    arc: 8,
    /**
     * colours across the bank: the land's own top carries down `grassLine` of the way to the waterline (by its own
     * noise, so the grass line wanders), then earth, then a wet band
     */
    grassLine: { min: 0.1, max: 0.95 },
    /** restored banks: earth between the grass and the water */
    earth: '#7a6446',
    /** the wet band at the waterline, and the bed just under the water */
    wet: '#6f5c42',
    bed: '#7e7a5c',
    /** a sand beach: its wet sand at the waterline */
    wetSand: '#b49a6c',
    /** how wide the wet band is (share of the bank's width) */
    wetBand: 0.14,
    /** ambient occlusion where the bank meets the water: how much darker, and how wide (share of the bank's width) */
    ao: 0.32,
    aoWidth: 0.16,
    /** pebbles along each tile of shore, and the chance of a bigger rock half in the water */
    pebbles: 3,
    rock: 0.3,
    /** restored banks: chance of a stand of reeds in the shallows, grass tufts and flowers per tile of shore */
    reeds: 0.45,
    tufts: 3,
    /** restored banks: grass tufts along the lip of the bank (per tile of shore), so the lawn spills over its edge */
    fringe: 6,
    flowers: 0.5,
    /**
     * restored banks: the chance per tile of shore of a plant leaning out over the water (standing on the bank's top,
     * `inset` in from the edge, leaning by `lean` degrees), and its size
     */
    overhang: { chance: 0.22, inset: 0.12, lean: 26, scale: 0.62 },
  },
  /**
   * E28.W03 (#696): where a deck, a pier or a causeway meets the water (Bridges.ts). Lengths are tiles; colours are
   * [alive, dead] pairs where the ground beside them can be either.
   */
  bridge: {
    /** the bank under a deck is darkened by this share (its contact shadow), fading out over `soft` past the deck's edge */
    shade: 0.45,
    soft: 0.22,
    /**
     * the water under a deck (WaterSurface, by the decks' covers): its colour and the sky it reflects darkened by `shade`
     * from `inner` in under the deck's edge, fading out over `soft` past it
     */
    under: { shade: 0.55, inner: 0.3, soft: 0.35 },
    /**
     * a post's wet sleeve: from `sink` under the surface up to `height` above it, `grow` wider than the post, in `wet`,
     * with a thin line of weed (`weed`, `weedHeight` tall) where it meets the water
     */
    sleeve: { height: 0.07, sink: 0.04, grow: 0.01, wet: '#4b3b2d', weed: '#5d6440', weedHeight: 0.016 },
    /**
     * the worn stones a deck's land end sits on: `depth` across, `height` down into the bank from just under the deck,
     * `stones` to a tile of deck, in these colours; and a rounded boulder (`boulder` across) half sunk either side
     */
    sill: { depth: 0.18, height: 0.22, stones: 3, colours: ['#d3cab8', '#c2b9a6', '#dcd4c3'], boulder: 0.22 },
    /** the plank bridge's two beams under each tile of planks: their thickness, and how far either side of the middle */
    stringer: { size: 0.07, apart: 0.3 },
    /**
     * a wall standing in water: a wet band from the waterline up by `min` to `max` (wandering along it, `pieces` steps
     * to a tile), in `wet`, with a line of weed at the waterline
     */
    wall: { min: 0.12, max: 0.28, pieces: 5, wet: ['#b5a891', '#837d72'], weed: ['#6c7448', '#646652'], weedHeight: 0.04 },
  },
  /**
   * E28.W04 (#697): life in the water (WaterLife). Only on restored water: none on dead or murky water or the open sea,
   * and more of it as a restored shore blooms (`bloom` 0 … 4 adds `perBloom` to each chance). All of it rides the
   * waves (it reads the same swell the surface lifts by) and fades in with a restore. Lengths are tiles.
   */
  waterLife: {
    /** drawn within this many tiles of where the camera looks (nearest first, up to `max` of each kind) */
    radius: 20,
    max: { pad: 480, flower: 120, leaf: 96, fish: 120, fleck: 160, plant: 240, fall: 12, foam: 24, spray: 12, outlet: 12 },
    /**
     * lily pads, on restored fresh water (pools, ponds, canals; not the sea), gathered in patches (`patches` of the
     * water within `reach` of a bank, in patches about `patch` tiles across): `perTile` (+1 from `crowdFrom` bloom),
     * `size` across (min, max), riding the swell and turning slowly; a flower on the first pad from `flowerFrom` bloom
     */
    pads: { perTile: 3, crowdFrom: 3, reach: 1.6, patches: 0.45, patch: 3.5, size: [0.22, 0.34], turn: 0.04, colours: ['#3f7d36', '#356b33'], vein: '#5c9a40', flowerFrom: 2, flower: '#f58cb8', flowerCore: '#f0c43a' },
    /**
     * small fish in clear restored shallows (the surf and fresh water), drawn as dark shapes seen through the water:
     * a shoal of 1 … `shoal` per spot, `chance` per tile, at least `minDepth` from land, swimming lazy loops of up to
     * `range` at `speed` (tiles a second). Every `rise` seconds or so one rises and rings the surface (WaterDisturbance)
     */
    fish: { chance: 0.1, perBloom: 0.04, shoal: 3, minDepth: 0.45, range: 0.9, speed: 0.22, length: 0.15, colour: '#0d3a47', opacity: 0.38, nightOpacity: 0.14, rise: 11, ring: 0.7 },
    /** floating leaves near restored shores (within `reach` of land): a slow orbit of `orbit`, `size` long, in these colours */
    leaves: { chance: 0.06, perBloom: 0.02, reach: 1.6, orbit: 0.22, size: 0.075, turn: 0.05, colours: ['#a9a03c', '#c98a3a'] },
    /**
     * drifting flecks (pollen and seed fluff) on calm water near restored shores: each drifts `drift` tiles a second for
     * `life` seconds, fading in and out, `size` across, at `opacity` by day (`nightOpacity` by night)
     */
    flecks: { chance: 0.12, perBloom: 0.03, reach: 1.4, drift: 0.035, life: 14, size: 0.022, colour: '#f4ecd2', opacity: 0.6, nightOpacity: 0.15 },
    /** aquatic plants standing in the shallows of restored fresh water, within `reach` of a bank: arrowhead clumps `height` tall */
    plants: { chance: 0.12, perBloom: 0.04, reach: 0.8, height: 0.24, stalk: '#5c8a3e', leaf: '#6fa448' },
    /**
     * An outlet where the world already has one: a restored channel of fresh water that ends against ground a level or
     * more higher (the Saltwind canal's head under Elder Grove). A stone culvert `culvert` across (a ring of voussoirs
     * with a keystone, a dark barrel and a sill: WaterLife's CULVERT proportions), its mouth's middle at most `outlet`
     * over the water. The stream pours from the sill `width` wide and lands `lip` further out, its streaks (`tint`
     * between them, white in their cores) running down at `speed` (stream lengths a second), at `opacity`, with a
     * `sheen` that catches the sun. Where it lands: soft foam `foam` across, a puff of spray `spray` across, and rings
     * of `ring` strength. All of it is lit like the world (moonlit by night), with `glow` of its colour as light of its
     * own by day only, fading out with the daylight: nothing glows in the dark.
     */
    falls: { outlet: 0.42, culvert: 0.6, width: 0.28, lip: 0.2, speed: 1.4, colour: '#eaf8f5', tint: '#8fd3cc', opacity: 0.9, sheen: 0.55, glow: 0.3, foam: 0.62, spray: 0.3, ring: 2.4, stone: '#b3a998', mouth: '#1c1b19' },
  },
};

export interface TierSpec {
  /** E28.W01: a planar reflection of the world in the water */
  waterReflect: boolean;
  /** CameraFrame post-processing (off: the camera tone-maps directly) */
  post: boolean;
  /** MSAA samples of the HDR scene target */
  samples: number;
  /**
   * Size of the sun's whole shadow map. With 2+ cascades PlayCanvas packs them into a 2×2 atlas, so each cascade
   * gets half this per side (High: 3 × 2048²).
   */
  shadowRes: number;
  /** #156: sun shadow cascades, so mid-distance objects keep shadows without softening the near ones */
  shadowCascades: number;
  /** PCF5 (softer penumbra) instead of PCF3 */
  softShadows: boolean;
  bloom: boolean;
  ssao: boolean;
  dof: boolean;
  rim: boolean;
}

/**
 * #633: the Glow setting's steps (Settings › Display): a scale on bloom's strength. Normal (1) is the look the game
 * shipped with; Off turns the halo off but leaves the post stack (and lit windows and lamps themselves) as they are.
 */
export const GLOW_STEPS: readonly [value: string, label: string][] = [
  ['0', 'Off'],
  ['0.5', 'Soft'],
  ['1', 'Normal'],
  ['1.6', 'Strong'],
];

/** Bloom's strength for the tier (`on`), how far into night it is (0 … 1) and the Glow setting (#633). */
export function glowIntensity(on: boolean, night: number, glow = 1): number {
  const B = LOOK.bloom;
  return on ? B.intensity * (1 + (B.night - 1) * night) * Math.max(0, glow) : 0;
}
