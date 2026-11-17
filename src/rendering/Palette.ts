/**
 * Look 2: the one place colours live (docs/art/palette.md). Pure data, no engine imports, so geometry builders
 * (TreeGen) and tests can read it. Renderers take every colour from here; tests/palette-lint.test.ts enforces it.
 *
 * Families are named swatches with variants. The flat keys at the bottom (`concrete`, `grass`, `flower`, `gold`…)
 * are the pre-Look-2 names, kept as aliases so code written against them keeps working.
 */

const stone = {
  /** Look 2.3: warm limestone (palette.md) for planters, plinths, basins, statues and clean parapets */
  light: '#d6d0c6',
  cream: '#dfdad2',
  white: '#e6e2da',
  bright: '#e9e5de',
  warm: '#cac4b9',
  sand: '#c0baae',
  mid: '#b0a99e',
  grey: '#9c968d',
  dark: '#8f887e',
  shadow: '#77716a',
  pebble: '#aca69d',
};

const paving = {
  /** restored slab; each slab takes one of `slabs` by hash, set in darker grout */
  alive: '#b4afa5',
  slabs: ['#b4afa5', '#aba69b', '#bab6ac', '#a4a095'] as string[],
  /** swept but not yet restored */
  swept: '#9d978c',
  grout: '#766f67',
  crack: '#58534d',
  /** raised border where restored paving meets lawn */
  border: '#dfdad2',
  roadLine: '#b9b19a',
  /** Look 2.5: a restored road keeps its (cleaner) surface */
  roadAlive: '#696662',
  /** City 16.6: arterials are a shade darker and carry a double centre line and edge lines */
  arterialAlive: '#5d5a56',
  roadEdgeLine: '#d9d3c5',
  /** kerbs on a road's open sides: dead, then restored */
  kerbDead: '#6e6961',
  kerb: '#cac4b9',
  /** bridges over canals: deck (dead, restored) and rail */
  bridgeDeckDead: '#6b5d50',
  bridgeDeck: '#9c8268',
  bridgeRail: '#4b4641',
};

/** Tile ground by feature: dead (polluted) tones, three per feature. */
const ground = {
  dead: {
    lawn: ['#968d7c', '#8e8574', '#9d9484'],
    paving: ['#8a8276', '#827a6f', '#91897d'],
    road: ['#58554f', '#514e49', '#5e5b55'],
    water: ['#4e5a52', '#475249', '#56625a'],
    clay: ['#ae9c84', '#a49279', '#b8a68d'],
    litter: ['#7f7563', '#776d5c', '#877c69'],
    obstacle: ['#837b70', '#7b7368', '#8b8377'],
    building: ['#90887c', '#898175', '#978f83'],
  } as Record<string, string[]>,
  /** restored ground that isn't lawn ('' = use the stage grass) */
  alive: { lawn: '', paving: '#b4afa5', road: '#6c675e', water: '#5cc6e6', clay: '', litter: '', obstacle: '#d6d0c6' } as Record<string, string>,
  /**
   * Look 2.9: prepared and growing must read apart for every vision type, so they differ in lightness, not just
   * in their small details: prepared is dark tilled soil, growing a lighter olive soil hazed with sprouts.
   */
  prepared: '#5f4733',
  growing: '#6a6536',
  /** prepared / growing water tiles */
  wetSoil: '#4f7f86',
  /** dead water surface scum */
  scum: '#3e4a43',
  /** dead debris on unrestored ground */
  debrisStreak: '#5e564b',
  leafLitter: ['#6b5d4a', '#7d6648', '#6e5240'],
  /** Look 2.6: weathering on dead ground: rust streaks, dirt patches */
  rustStreak: '#7d5a44',
  dirt: '#6f6352',
};

/** Rooftop dead looks (GridRenderer): sun-baked clay and withered leaf litter (concrete uses the legacy keys). */
const roof = {
  reservoir: { base: ['#bda78a', '#b29c7f', '#c6b195', '#a99377'], dark: '#97806a', crack: '#6e5a48', debris: '#8a7560' },
  canopy: { base: ['#867c6a', '#7c7261', '#908571', '#776d5d'], dark: '#655c4e', crack: '#4e463b', debris: '#6b5a45' },
};

const lawn = {
  /** Look 2.2: slightly golden, less saturated greens (palette.md). Fresh restored grass, picked per tile by noise. */
  tones: ['#77ad3e', '#80b443', '#6da23a', '#87b84a', '#649a37'],
  /** large sunlit / shaded patches pull the tile tone toward these */
  sunlit: '#8dba48',
  shadow: '#376a2e',
  dryTip: '#b7c25c',
  /**
   * Grass by bloom stage: index 1 Restored … 4 Radiant. Each stage keeps its own brightness so stages read apart:
   * young grass is light and yellow-green, Blooming mid, Thriving deep, Radiant warm and golden.
   */
  stage: [
    [],
    ['#9cc463', '#a5c96a', '#93bd5c', '#accd72', '#91b75a'],
    ['#77ad3e', '#80b443', '#6da23a', '#87b84a', '#649a37'],
    ['#538f34', '#5c973a', '#4c872f', '#639c3f', '#47802c'],
    ['#80ae3a', '#8ab440', '#77a636', '#92b946', '#6f9e33'],
  ] as string[][],
  /** tufts: darker base, lighter tips (MeshBuilder.tip) */
  tuft: ['#4a7f2c', '#538a31', '#5f9337'],
  tuftTip: ['#9ac55a', '#a7c964', '#b7c25c'],
  youngTuft: ['#79ab4c', '#82b254', '#8db85c'],
  youngTuftTip: ['#b9d282', '#c1d58a', '#c9d38c'],
  /** trimmed darker edge where lawn meets paving */
  edge: '#457a2c',
  moss: '#7f9a45',
  sprout: '#73a046',
  clover: '#96c25e',
  /** dead-state weeds: dry and dusty, never fresh green */
  weed: '#8a8a5a',
  weedDry: '#9a9460',
  weedDark: '#6f7550',
};

const flowers = {
  /** the bed mix in legacy order (pink, yellow, lavender, white, orange); pick with flowerPick() for the weighted mix */
  mix: ['#f2689f', '#f9d23a', '#a983d6', '#f8f6ee', '#ee8a2c'],
  /** Look 2.4 (palette.md): hot pink and magenta lead, then white, lavender and purple, yellow, a little orange */
  pink: '#f2689f',
  magenta: '#d63d84',
  blush: '#f58cb8',
  rose: '#f59ab5',
  pastelPink: '#f9b6d2',
  red: '#e8574f',
  orange: '#ee8a2c',
  yellow: '#f9d23a',
  sunflower: '#f6c22e',
  pastelYellow: '#fbeaa0',
  lavender: '#a983d6',
  lavenderDeep: '#9270cc',
  purple: '#7d58b5',
  blue: '#8fa8e8',
  white: '#f8f6ee',
  /** centres: generic, daisy (yellow on white), sunflower (dark brown) */
  core: '#f0c43a',
  daisyCore: '#f0d22e',
  sunflowerCore: '#6b4219',
  petalShade: '#d9789c',
  stem: '#4f8a32',
  stemSoft: '#6c9a4f',
  /** Radiant: luminous gold flowers and their ground glow */
  radiant: ['#ffe066', '#fff6c2'],
  radiantDisc: '#fff1b8',
  /** far level of detail: the gold disc on a Radiant tile */
  radiantFar: '#ffe9a0',
  /** tall spikes on Thriving tiles (lupins, foxgloves) */
  spikes: ['#a983d6', '#f2689f', '#7d58b5', '#f8f6ee'],
};;

const leaf = {
  light: '#7fb35a',
  mid: '#5fb24a',
  bright: '#5fc25a',
  dark: '#4f9a4a',
  stalk: '#4f9a3c',
  deep: '#3f8f3a',
  forest: '#3f7a52',
  dusk: '#3f6b4a',
  lime: '#7fd36a',
  teal: '#4fb0ad',
  shrub: ['#4f8a35', '#5f9a3c', '#3f7a2e'],
  /** Look 2.2: leaf hue ranges (HSL degrees) per tree species, warmer and more varied than one lime green */
  hue: { oak: [92, 112], birch: [78, 94], willow: [82, 98], pine: [130, 146], cherry: [330, 346], shrub: [80, 112] } as Record<string, [number, number]>,
  shrubTip: '#5fbf43',
  ivy: '#4f9a4a',
};

const wood = {
  pale: '#d8b98d',
  light: '#c9a77a',
  mid: '#b9824f',
  twig: '#b48a5a',
  stake: '#d8c07a',
  crate: '#9a8a70',
  trunk: '#8b6243',
  dark: '#6e5a48',
  bark: '#6b5a45',
  deep: '#5f4d3d',
  post: '#5a4636',
};

const soil = {
  base: '#8a6a4b',
  dark: '#6f533a',
  mud: '#6b5a45',
};

const metal = {
  dark: '#3f4246',
  mid: '#4a4c50',
  iron: '#5b5d60',
  grey: '#6f7175',
  slate: '#6e7a80',
  steel: '#8a9097',
  drain: '#3d3a35',
  rust: '#8a5a40',
  bronze: '#8a5a1c',
  vent: '#8a7d70',
};

/** Machine and drone shells (drone redesign D02: warm ceramic shell, soft gold, navy glass). */
const plastic = {
  shell: '#f5f3e8',
  shellLow: '#bebba7',
  /** Look 2.8: machine shells, cream plastic with slight gloss (surface('shell')) */
  cream: '#f1ede4',
  warm: '#fbf6ec',
  lantern: '#f6efdc',
  aged: '#d9cbb0',
  agedLow: '#9a8a70',
  agedLeaf: '#b5a27e',
  agedVein: '#7d6e50',
  agedDark: '#8a7a60',
  face: '#101d26',
  visor: '#1d2633',
};

const trim = {
  gold: '#e8ba40',
  brass: '#d9a441',
  amber: '#ffcf4a',
  bronzeAged: '#a88f5a',
  goldLow: '#7a5a10',
  goldGlow: '#a07a20',
};

const solar = {
  /** Look 2.8: deep navy cells with a lighter grid */
  panel: '#233f7a',
  glint: '#4f6fbf',
  navy: '#24406e',
};

const aqua = {
  water: '#4cc3ea',
  glass: '#7fd6f0',
  deep: '#2aa6d6',
  abyss: '#1a6f8a',
  pale: '#9fe3f5',
  mist: '#d8f4ff',
  pipe: '#5aa3c9',
  surface: '#7fd0f0',
  foam: '#a8ecff',
  teal: '#6fe3e0',
};

/** Emissive and glow tints (keep intensities 1–2; Look 1 blooms anything at 1 or above). */
const glow = {
  warm: '#fff1b8',
  gold: '#ffd34d',
  amber: '#ffe27a',
  cream: '#ffe9a0',
  honey: '#ffe9a3',
  lamp: '#ffe58a',
  firefly: '#fff3a0',
  fireflyCore: '#ffe066',
  sun: '#fff3b0',
  sunDark: '#e7b54a',
  panel: '#ffd56a',
  cyan: '#6fd3ff',
  cyanPale: '#9ff7ff',
  cyanSoft: '#a8ecff',
  eye: '#71f5ff',
  eyeSoft: '#6ff3ff',
  beam: '#d8fdff',
  star: '#8fe3ff',
  mint: '#7cf7c8',
  mintPale: '#b6ffe0',
  jade: '#8ff0c2',
  pink: '#ff9ccf',
  halo: '#ff9de2',
  orange: '#ffb347',
  lampBulb: '#fff1b8',
  gem: { solar: '#ffd34d', condenser: '#6fe3ff', pollinator: '#ff9ccf', droneHub: '#8ff0c2' } as Record<string, string>,
};

const building = {
  wallsDead: ['#a29a8c', '#9a8f80', '#958f86', '#a8a093', '#97908a'],
  wallsAlive: ['#efe8da', '#ebe6d8', '#f1e8d8', '#e6e8dc', '#efe9e0'],
  wallDead: '#9d958a',
  wallAlive: '#ece4d4',
  roofDead: '#7f786e',
  roofGarden: '#7cc576',
  gardenBed: '#6fbf5e',
  glassDead: '#4b4f54',
  glassAlive: '#9fd6e8',
  parapetDead: '#80786c',
  parapetAlive: '#ddd2bf',
  tank: '#6e655a',
  facade: '#aea596',
  facadeDark: '#857d72',
  window: '#3b4652',
  windowLit: '#ffe6a6',
  parapet: '#a8a195',
  parapetClean: '#ece4d4',
};

/** Park props: benches, gazebo, stalls, lamps. */
const props = {
  benchWood: '#b98a63',
  benchFrame: '#5a4a3e',
  benchRotten: '#6e5a48',
  benchRottenLow: '#5f4d3d',
  benchRustFrame: '#5b5d60',
  gazeboBase: ['#cfc8b8', '#e6dfcf'],
  gazeboPost: ['#a9a293', '#f3efe4'],
  gazeboRoof: ['#7d6656', '#a8714c', '#d2553f'],
  gazeboFinial: ['#8f8160', '#e8c04f'],
  bunting: ['#ff6f91', '#ffd25e', '#6fd3ff', '#8be06b', '#c38bff'],
  lampToppled: '#8d8a78',
  stallDead: '#9a8a70',
  stallAlive: '#c9a77a',
  awning: ['#b5655a', '#5a7fb5'],
  produce: ['#ee8a2c', '#8fb443', '#f9d23a'],
  mushroom: '#e2483c',
  mushroomStem: '#f4efe6',
  bin: '#6b7378',
  binAlive: '#5aa3c9',
  bollard: '#6f7175',
  pillar: '#b8b4aa',
  pillarCap: '#9d998f',
  planterDead: '#9d978a',
  planterSoilDead: '#7d6a55',
  rockMoss: '#7fb35a',
};

/** Superstructure cores and machine bases. */
const core = {
  dormant: '#6f747a',
  glow: '#7cf7c8',
  steel: '#8a9097',
  slate: '#6e7a80',
  moss: '#55604f',
  base: '#8f8b82',
  baseWarm: '#8a8478',
  baseEarth: '#7d6a58',
  plinth: '#6b6156',
  ring: '#7a6553',
  deck: '#4a463f',
  orbOn: '#b6ffe0',
  orbOff: '#3f6b4a',
};

const sky = {
  /**
   * Look 2.7 (palette.md): a clear zenith blue over a pale warm horizon. The haze is the horizon colour, so distant
   * ground fades into the sky with no blue-grey seam. Look 4's sky block (src/data/sky.ts, [fogged, clear] pairs)
   * carries the live values; these are the clear ones it should match.
   */
  zenith: '#78afe6',
  /** Zoomed-out puffy clouds between the camera and the city: bright tops, a cool belly, sleepy faces */
  cloud: '#ffffff',
  /** baked soft shading: warm sunlit tops, lavender-blue shade, a cooler belly, a bright silver rim */
  cloudSun: '#fff4e2',
  cloudShade: '#c6d0f2',
  cloudBelly: '#d6ddf6',
  cloudRim: '#ffffff',
  cloudFace: '#4a4f63',
  cloudSparkle: '#ffffff',
  cloudRain: '#7cc4f2',
  cloudShadow: '#2f3a5c',
  cloudBlush: '#ffb3c7',
  upper: '#a4cdee',
  horizon: '#e6e2d4',
  haze: '#e6e2d4',
  /** linear distance fog (SceneBuilder, until Look 4's sky sets the fog from its haze) */
  fog: '#e6e2d4',
  /** distant terraced towers: pale blue, cream and green */
  skyline: ['#bcd6e4', '#e9e1cf', '#c4dce8', '#d8ccb6'],
  skylineGreen: '#a9c98a',
  bridge: '#eeeae2',
  /**
   * gameplay fog of war (the fog sheets in ChunkRenderer.buildFog, Look 4's curtains): a cool gloomy grey, darker
   * than the warm haze (L* ~71 vs ~90) and opposite in temperature, so it never reads as sky. Lower and upper sheet.
   */
  fogOfWar: ['#aab0b8', '#bac0c6'],
};;

const fauna = {
  catTabby: ['#9a948c', '#6f6a63'],
  catGinger: ['#e59a4f', '#c9773a'],
  catTuxedo: ['#2f2f35', '#f4f1ea'],
  koi: '#ff8a3d',
  koiPatch: '#e84a2a',
  birds: ['#6f8fd6', '#e58b4f', '#9a7b5a', '#f2d24a'],
  breast: '#f4efe6',
  beak: '#f0a23a',
  eye: '#2b2b33',
  body: '#3b3b45',
  gull: '#f4efe6',
  gullBeak: '#ffb347',
  butterflyBlue: '#8fd3ff',
  pond: '#4cc3ea',
  helperArm: '#4fa3c9',
  wheel: '#5d6166',
  cat: '#fbfaf7',
  catRed: '#e2483c',
  catBlanket: '#6b5a4a',
};

/** Overlays: hover frames, placement tones, the beacon. */
const signal = {
  hover: '#ffffff',
  ok: '#7dff9a',
  bad: '#ff6b6b',
  info: '#fff0a0',
  gridLine: '#1d3640',
  beacon: '#ffc428',
  beaconGlow: '#ffb000',
  beaconPool: '#fff3a0',
  /** E19: the build hologram bloombot projects */
  holo: '#5fe8ff',
};

/** Scene lights (Look 1 owns lighting; on its branch these move to src/data/look.ts). */
const light = {
  ambient: '#8a90a3',
  sun: '#ffe6bd',
  fill: '#b9d7ff',
};

/**
 * Look 2.8: shared surface definitions for machines and props (colour plus gloss and metalness), read through
 * surface() in Materials.ts so every machine material is one cached definition. Tuned for Look 1's key light:
 * plastic has a soft sheen, trims a metallic highlight, solar cells a sharp glint. The drone keeps its own
 * redesign materials (DroneVisuals); these sit around it: same soft gold, same cream family.
 */
const surfaces = {
  shell: { hex: '#f1ede4', gloss: 0.62, metal: 0 },
  trim: { hex: '#e8ba40', gloss: 0.72, metal: 0.55 },
  banner: { hex: '#f5b23c', gloss: 0.3, metal: 0 },
  solar: { hex: '#233f7a', gloss: 0.85, metal: 0.2 },
  glass: { hex: '#9fe2f8', gloss: 0.9, metal: 0 },
  rust: { hex: '#8a5a40', gloss: 0.25, metal: 0.4 },
  wood: { hex: '#b98a63', gloss: 0.2, metal: 0 },
  visor: { hex: '#101d26', gloss: 0.8, metal: 0 },
};

const pure = {
  white: '#ffffff',
  black: '#000000',
  clear: '#00000000',
};

/** Look 4.9: the kerb and retaining wall where the revealed city drops to a sunk (unrevealed) area. [alive, fogged] pairs. */
const retaining = {
  stone: ['#e7decb', '#a8a196'],
  coping: ['#f3eee2', '#b3ada2'],
  plinth: ['#cfc4ae', '#8f897f'],
  rail: '#7c6f5e',
  glass: ['#9fd6e8', '#596067'],
  sill: ['#f6f1e6', '#a49e93'],
  cornice: ['#efe7d6', '#a7a196'],
  pilaster: ['#ddd3bf', '#9d978c'],
  balcony: ['#efe7d6', '#a49e93'],
  vine: ['#4f9a4a', '#5aa94f'],
};

/** E19 (#245): the cozy city's plots (and later decorations): warm wood, striped canvas, play colours. */
const cozy = {
  kerb: '#e3dccb',
  stake: '#c9a77a',
  string: '#f1ede4',
  bedSoil: '#5f4733',
  deck: '#c69c6d',
  deckDark: '#8f6a48',
  canvas: ['#f2689f', '#f9d23a', '#7fc8e8', '#9fd27a'] as string[],
  canvasWhite: '#fbf6ec',
  table: '#f1ede4',
  play: ['#e8574f', '#f9d23a', '#5aa3c9', '#7cc26a'] as string[],
  sand: '#ecd9a6',
  boat: ['#e8574f', '#5aa3c9', '#f6c22e'] as string[],
  reed: '#8db85c',
  reedHead: '#7d5a3a',
  iris: '#7d58b5',
  blanket: ['#e8574f', '#f8f6ee'] as string[],
  basket: '#b48a5a',
  thatch: '#a5855a',
  moss: '#6f9a45',
  glass: '#bfe9f5',
  frame: '#f4f1ea',
  fruit: ['#e8574f', '#f6c22e', '#ee8a2c'] as string[],
  veg: ['#ee8a2c', '#4f8a32', '#a983d6'] as string[],
  rose: ['#f59ab5', '#e8574f', '#f8f6ee'] as string[],
  metal: '#5b6670',
  waterShallow: '#7fd0f0',
};

const families = { cozy, retaining, stone, paving, ground, roof, lawn, flowers, leaf, wood, soil, metal, plastic, trim, solar, aqua, glow, building, props, core, sky, fauna, signal, light, surfaces, pure };

export const PALETTE = {
  ...families,
  // ───── legacy names (pre-Look 2), kept as aliases ─────
  concrete: ['#9a9286', '#8f877b', '#a39b8f', '#958d81'],
  concreteDark: '#6b6358',
  crack: '#4a433b',
  debris: '#7a7166',
  weed: lawn.weed,
  soil: soil.base,
  soilDark: soil.dark,
  moss: lawn.moss,
  grass: lawn.tones,
  grassTuft: lawn.tuft,
  flower: flowers.mix,
  flowerCore: flowers.core,
  stem: flowers.stem,
  shrub: leaf.shrub,
  trunk: wood.trunk,
  white: '#f4f1ea',
  whiteWarm: plastic.warm,
  shell: plastic.shell,
  shellLow: plastic.shellLow,
  panel: solar.panel,
  panelGlint: solar.glint,
  gold: trim.gold,
  glass: aqua.glass,
  water: aqua.water,
  darkFace: plastic.face,
  eyeCyan: glow.eye,
  leafFin: '#a5d94d',
  leafVein: '#589d32',
  facadeGrey: building.facade,
  facadeDark: building.facadeDark,
  window: building.window,
  windowLit: building.windowLit,
  parapet: building.parapet,
  parapetClean: building.parapetClean,
  vent: metal.vent,
  rust: metal.rust,
  coreDormant: core.dormant,
  coreGlow: core.glow,
  cat: fauna.cat,
  catRed: fauna.catRed,
  pink: '#ff8fbf',
  skyline: sky.skyline,
  skylineGreen: sky.skylineGreen,
  bridge: sky.bridge,
  // Look 3 (#105) surfaces, foliage and props. Flat keys the Look 3 builders read; where a Look 2 swatch fits they point at it.
  /** E16 turf by stage (index 1 Restored … 4 Radiant), three shades each */
  stageGrass: lawn.stage,
  /** grass blades by stage (0 dead weeds … 4 Radiant): base and tip */
  bladeBase: ['#646a44', lawn.youngTuft[0], lawn.tuft[2], lawn.tuft[0], lawn.tuft[1]],
  bladeTip: [lawn.weedDry, lawn.youngTuftTip[0], lawn.tuftTip[0], lawn.tuftTip[1], lawn.dryTip],
  flowerDaisy: [flowers.white, flowers.pastelYellow, flowers.pastelPink],
  flowerCosmos: [flowers.pink, flowers.magenta, flowers.blush, flowers.orange],
  flowerLavender: [flowers.lavender, flowers.lavenderDeep, flowers.purple],
  flowerSunflower: [flowers.sunflower, flowers.yellow],
  flowerWild: [flowers.white, flowers.yellow, flowers.blue, flowers.rose],
  flowerCentre: flowers.core,
  sunflowerDisc: flowers.sunflowerCore,
  bud: '#5aa045',
  stemDark: '#2f6e2b',
  stemLeaf: leaf.stalk,
  stemLeafLight: leaf.light,
  /** leafy shrubs: base, lit, shade */
  shrubLeaf: [leaf.shrub[2], leaf.shrubTip, '#183f1c'],
  bougainvillea: ['#e0479e', '#ff7eb6', '#ff9fd0', '#f45d8a'],
  twig: ['#6b4a32', '#7d5a3c'],
  /** ivy: stem, leaf, leaf tip (dry: the same, dead) */
  vine: ['#4e7a34', '#468f2d', '#82ce3b'],
  vineDry: ['#6b5a45', '#8f7c4d', '#ac8053'],
  vineFlower: ['#ff7eb6', '#ffffff', '#ff9fd0', '#ffd23f'],
  banner: ['#f2b13a', '#f5c04a', '#eaa233'],
  bannerFaded: '#a89a80',
  bannerEmblem: '#fff3d0',
  bannerEmblemFaded: '#c8bea8',
  poleWood: ['#5d4a3a', '#6e5a48'],
  goldDull: '#8f8160',
  lampGlow: '#fff1b8',
  brass: trim.brass,
  paveAlive: paving.slabs,
  paveDead: ground.dead.paving,
  paveSwept: ['#b4b1a8', '#aaa79e', '#bdbab1'],
  /** grout / dirt between slabs: restored, dead */
  grout: ['#a59d8c', '#5f5b52'],
  stoneCream: stone.cream,
  stoneCreamTop: stone.bright,
  stoneDead: stone.dark,
  soilDry: '#9a8466',
  railRust: '#8f5434',
  railCopper: '#b97a4a',
  /** parapet wall: restored, dead, dead coping */
  parapetWall: ['#e6dcc8', '#8f8a80', '#a19c91'],
  woodPlank: wood.mid,
  woodDead: '#7d6a55',
  terracotta: '#c76b45',
  terracottaDead: '#9a6a52',
  acUnit: ['#e9e4d8', '#a7a49c'],
  grille: '#3a3f45',
  bricks: ['#a8573c', '#b5654a', '#93503a'],
  /** rubble shades, then light and dark */
  rubble: ['#8f8d86', '#7d7b74', '#9a9890', '#b4b1a8', '#5f5c55'],
  ventMetal: ['#c9c4b8', '#7d7a73'],
  stoneBlock: ['#d9d1c0', '#9a9890'],
  mossLight: '#a5c86a',
  mossDark: '#5a7f3f',
  lanternMetal: metal.dark,
  catShade: '#d9d6cf',
  catEar: '#ffc1dc',
  mural: ['#a5d94d', '#7fb35a', '#e8ba40', '#cfe6a0'],
  rock: '#a7a39a',
  rockMoss: '#7fb35a',
  radiantGlow: '#fff1b8',
  bee: '#f2b630',
  hoverfly: '#d98a2b',
  insectDark: '#2b2620',
  insectWing: '#eef6ff',
  leafDrift: ['#a8743c', '#8f9a3a', '#c98f3c'],
  petalFall: ['#ffd1e6', '#ffffff', '#ffb3d1'],
  birchEye: '#3f3831',
  /** cherry blossom clumps: base, light, dark */
  treeBlossom: ['#f3e8eb', '#f7f7f7', '#e0b8c7'],
  /** leaves that fall from each species' crown (Pollinators); pines drop nothing */
  treeLeafFall: {
    oak: ['#6ea83a', '#a8b83f', '#c98f3c'],
    birch: ['#b8cf4a', '#e0c24a', '#9cc23f'],
    willow: ['#8fbf4a', '#b5cf62', '#c7b85a'],
  } as Record<string, string[]>,
  // Look 3.12 machines
  orbLit: '#b6ffe0',
  orbDark: '#3f6b4a',
  panelBoostGlow: '#ffd56a',
  machineMetal: '#b7bcc3',
  panelGrid: '#d6dfeb',
  waterGlow: '#2aa6d6',
  gemSolar: '#ffd34d',
  gemWater: '#6fe3ff',
  gemGarden: '#ff9ccf',
  gemDrone: '#8ff0c2',
  bloomPink: '#ffb3d9',
  bloomCream: '#fff2a8',
  scaffold: wood.light,
  scaffoldRail: wood.pale,
  sunflowerGlow: '#ffcf4a',
  seedFace: metal.bronze,
  treeOrb: '#fff3b0',
  lanternGlow: '#ffe27a',
  waterSwirl: '#bff6ff',
  waterSwirlGlow: '#7fe8ff',
  waterBubble: '#e6fbff',
  relayGlow: '#9ff7ff',
  canopyTop: leaf.bright,
  coreCrystalDormant: metal.steel,
  emissiveOff: pure.black,
  fountainStone: '#8f8b82',
  gaugeDormant: metal.slate,
  basinDark: '#4a463f',
  cisternStone: '#8a8478',
  cisternBand: '#7a6553',
  cisternDark: metal.drain,
  elderBark: '#7d6a58',
  elderCrystal: '#55604f',
  elderGround: '#6b6156',
  gardenWaterGlow: '#1a6f8a',
  lilyPad: leaf.mid,
  bloomPale: '#fff6c2',
  mist: '#d8f4ff',
};

// ───── colour helpers (pure) ─────

const hexCache = new Map<string, string>();
/** Mixes two #rrggbb colours in sRGB, k in 0–1 (quantised to 1/16 so vertex-colour caches stay small). */
export function mixHex(a: string, b: string, k: number): string {
  const q = Math.round(Math.max(0, Math.min(1, k)) * 16);
  if (q === 0) return a;
  if (q === 16) return b;
  const key = a + b + q;
  let out = hexCache.get(key);
  if (!out) {
    const A = parseInt(a.slice(1, 7), 16);
    const B = parseInt(b.slice(1, 7), 16);
    const ch = (sh: number) => Math.round(((A >> sh) & 255) + ((((B >> sh) & 255) - ((A >> sh) & 255)) * q) / 16);
    out = '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
    hexCache.set(key, out);
  }
  return out;
}

const hash2 = (x: number, z: number, salt: number) => {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
/** Smooth value noise in 0–1 (bilinear over a hashed lattice, smoothstepped). */
export function valueNoise(x: number, z: number, salt = 0): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi, salt);
  const b = hash2(xi + 1, zi, salt);
  const c = hash2(xi, zi + 1, salt);
  const d = hash2(xi + 1, zi + 1, salt);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Look 2.2: the grass colour of a tile at (x, z) for a bloom stage (1–4). Three levels of variation:
 * a tone per tile chosen by hash (no `variant % n` pattern), soft large patches (sunlit / shaded lawns, about
 * 7 tiles across), and a faint second octave so neighbouring tiles never match exactly. Shade goes cool and dark
 * (toward `lawn.shadow`), never grey.
 */
export function grassTone(stage: number, x: number, z: number): string {
  const tones = lawn.stage[Math.max(1, Math.min(4, stage | 0))];
  const base = tones[Math.floor(hash2(x, z, 11) * tones.length) % tones.length];
  const patch = valueNoise(x / 7, z / 7, 23) * 0.75 + valueNoise(x / 2.5, z / 2.5, 29) * 0.25;
  // 0.5 is neutral; above leans sunlit, below leans into cool shade.
  return patch >= 0.5 ? mixHex(base, lawn.sunlit, (patch - 0.5) * 0.6) : mixHex(base, lawn.shadow, (0.5 - patch) * 0.55);
}

/** Look 2.4: the weighted flower mix: 40% pink (25 hot pink, 15 magenta), 20% white, 20% purple, 15% yellow, 5% orange. */
const FLOWER_WEIGHTS: [string, number][] = [
  [flowers.pink, 0.25],
  [flowers.magenta, 0.15],
  [flowers.white, 0.2],
  [flowers.lavender, 0.12],
  [flowers.purple, 0.08],
  [flowers.yellow, 0.15],
  [flowers.orange, 0.05],
];
/** A flower colour from the weighted mix for u in 0–1. */
export function flowerPick(u: number): string {
  let acc = 0;
  for (const [c, w] of FLOWER_WEIGHTS) {
    acc += w;
    if (u < acc) return c;
  }
  return flowers.pink;
}

/**
 * Look 2.4: the colour of flower clump `c` on the tile at (x, z). Beds read as drifts, not confetti: the main colour
 * comes from low-frequency noise (neighbouring tiles share it, drifts are about five tiles across), and only about one
 * clump in eight takes an accent colour instead.
 */
export function flowerAt(x: number, z: number, c = 0): string {
  if (hash2(x * 3 + c, z * 7 - c, 71) < 0.12) return flowerPick(hash2(x, z, 73 + c));
  // Rank-equalise the noise (value noise bunches around 0.5) so the drift mix keeps the weights.
  const n = valueNoise(x / 5, z / 5, 79);
  const u = n < 0.5 ? 2 * n * n : 1 - 2 * (1 - n) * (1 - n);
  return flowerPick(u);
}

/** The centre colour for a petal colour: yellow on white daisies, dark brown on sunflowers, warm gold otherwise. */
export function flowerCentre(petal: string): string {
  if (petal === flowers.white) return flowers.daisyCore;
  if (petal === flowers.yellow || petal === flowers.sunflower) return flowers.sunflowerCore;
  return flowers.core;
}
