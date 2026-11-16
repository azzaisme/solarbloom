/**
 * Look 2: the one place colours live (docs/art/palette.md). Pure data, no engine imports, so geometry builders
 * (TreeGen) and tests can read it. Renderers take every colour from here; tests/palette-lint.test.ts enforces it.
 *
 * Families are named swatches with variants. The flat keys at the bottom (`concrete`, `grass`, `flower`, `gold`…)
 * are the pre-Look-2 names, kept as aliases so code written against them keeps working.
 */

const stone = {
  /** limestone: planters, plinths, fountain basins, clean parapets */
  light: '#e9e4d8',
  cream: '#f2ece0',
  white: '#f4f1ea',
  bright: '#fdfbf6',
  warm: '#d8d1c0',
  sand: '#cfc8b8',
  mid: '#b8b4aa',
  grey: '#a7a39a',
  dark: '#9d998f',
  shadow: '#7f7b72',
  pebble: '#b6b2a8',
};

const paving = {
  /** restored slab (one tone per slab is picked from `slabs`) */
  alive: '#e9e4d8',
  slabs: ['#e9e4d8', '#e9e4d8', '#e9e4d8', '#e9e4d8'] as string[],
  /** swept but not yet restored */
  swept: '#b4b1a8',
  grout: '#6d6a62',
  crack: '#5f5c55',
  /** raised border where restored paving meets lawn */
  border: '#fdfbf6',
  roadLine: '#c9c38f',
};

/** Tile ground by feature: dead (polluted) tones, three per feature. */
const ground = {
  dead: {
    lawn: ['#8a7b5f', '#837357', '#91825f'],
    paving: ['#9a9890', '#8f8d86', '#a3a097'],
    road: ['#55585c', '#4e5155', '#5b5e62'],
    water: ['#4e5a52', '#475249', '#56625a'],
    clay: ['#bda78a', '#b29c7f', '#c6b195'],
    litter: ['#867c6a', '#7c7261', '#908571'],
    obstacle: ['#7d7b74', '#76746d', '#85837b'],
    building: ['#8d8a82', '#86837b', '#94918a'],
  } as Record<string, string[]>,
  /** restored ground that isn't lawn ('' = use the stage grass) */
  alive: { lawn: '', paving: '#e9e4d8', road: '', water: '#5cc6e6', clay: '', litter: '', obstacle: '#d9d4c8' } as Record<string, string>,
  /** prepared / growing water tiles */
  wetSoil: '#4f7f86',
  /** dead water surface scum */
  scum: '#3e4a43',
  /** dead debris on unrestored ground */
  debrisStreak: '#5f5c55',
  leafLitter: ['#6b5a45', '#8a6b3f', '#7a4f32'],
};

/** Rooftop dead looks (GridRenderer): sun-baked clay and withered leaf litter (concrete uses the legacy keys). */
const roof = {
  reservoir: { base: ['#bda78a', '#b29c7f', '#c6b195', '#a99377'], dark: '#97806a', crack: '#6e5a48', debris: '#8a7560' },
  canopy: { base: ['#867c6a', '#7c7261', '#908571', '#776d5d'], dark: '#655c4e', crack: '#4e463b', debris: '#6b5a45' },
};

const lawn = {
  /** fresh restored grass tones (per tile) */
  tones: ['#69bf4a', '#74c64f', '#5fb446'],
  /** grass by bloom stage: index 1 Restored … 4 Radiant */
  stage: [[], ['#9fd46a', '#a6d871', '#97cd62'], ['#69bf4a', '#74c64f', '#5fb446'], ['#4fae45', '#58b74a', '#48a640'], ['#79c24d', '#82c853', '#74bd49']] as string[][],
  tuft: ['#4fae3a', '#5fbf43', '#86d45a'],
  youngTuft: ['#8cc95a', '#97d062', '#a9da74'],
  /** trimmed darker edge where lawn meets paving */
  edge: '#3f8f3a',
  moss: '#7fa35a',
  sprout: '#79a957',
  clover: '#9be07a',
  weed: '#7a8a5c',
  weedDry: '#86965f',
  weedDark: '#7d8a5c',
};

const flowers = {
  /** the bed mix (legacy order: pink, yellow, lavender, white, orange) */
  mix: ['#ff7eb6', '#ffd23f', '#b48cff', '#ffffff', '#ff9a5a'],
  pink: '#ff7eb6',
  blush: '#ff9fd0',
  rose: '#ff9fb8',
  pastelPink: '#ffb3d9',
  red: '#ff6b6b',
  orange: '#ff9a5a',
  yellow: '#ffd23f',
  sunflower: '#ffc93c',
  pastelYellow: '#fff2a8',
  lavender: '#b48cff',
  lavenderDeep: '#9a7be0',
  purple: '#8f6fd6',
  blue: '#8fb8ff',
  white: '#ffffff',
  core: '#ffe28a',
  daisyCore: '#ffc93c',
  sunflowerCore: '#6b4423',
  petalShade: '#e88aa8',
  stem: '#3f9a3a',
  stemSoft: '#6c9a5a',
  /** Radiant: luminous gold flowers and their ground glow */
  radiant: ['#ffe066', '#fff6c2'],
  radiantDisc: '#fff1b8',
  /** far level of detail: the gold disc on a Radiant tile */
  radiantFar: '#ffe9a0',
  /** tall spikes on Thriving tiles */
  spikes: ['#b48cff', '#ff7eb6', '#8fb8ff', '#ffffff'],
};

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
  shrub: ['#3e9e46', '#4fb04f', '#2f8a3e'],
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
  rust: '#a0623c',
  bronze: '#8a5a1c',
  vent: '#8a7d70',
};

/** Machine and drone shells (drone redesign D02: warm ceramic shell, soft gold, navy glass). */
const plastic = {
  shell: '#f5f3e8',
  shellLow: '#bebba7',
  cream: '#f2ece0',
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
  panel: '#1e3a6b',
  glint: '#3a6fb8',
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
  wallsDead: ['#a19d93', '#9a8f80', '#8f969a', '#a8a093', '#97928a'],
  wallsAlive: ['#f4f1e8', '#eef2ea', '#f6efe4', '#e9f1f0', '#f3f0f5'],
  wallDead: '#9d978c',
  wallAlive: '#f1ede3',
  roofDead: '#7d7a73',
  roofGarden: '#7cc576',
  gardenBed: '#6fbf5e',
  glassDead: '#4b4f54',
  glassAlive: '#9fd6e8',
  parapetDead: '#7f7b72',
  parapetAlive: '#e2ddd0',
  tank: '#6e655a',
  facade: '#a3a6aa',
  facadeDark: '#7d8085',
  window: '#3b4652',
  windowLit: '#ffe6a6',
  parapet: '#9a9ea2',
  parapetClean: '#f2efe8',
};

/** Park props: benches, gazebo, stalls, lamps. */
const props = {
  benchWood: '#b9824f',
  benchFrame: '#3f7a52',
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
  produce: ['#ff9a5a', '#8be06b', '#ffd23f'],
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
  /** linear distance fog (SceneBuilder; Look 4 owns the sky block) */
  fog: '#bcd9e6',
  zenith: '#7fb8e8',
  horizon: '#e9eef0',
  haze: '#bcd9e6',
  skyline: ['#b9d6e6', '#acc9dc', '#c4dce8', '#a5c3d6'],
  skylineGreen: '#a8d3a0',
  bridge: '#eeeae2',
  /** gameplay fog of war: greys ground toward this */
  fogOfWar: '#9a9a9a',
};

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
};

/** Scene lights (Look 1 owns lighting; on its branch these move to src/data/look.ts). */
const light = {
  ambient: '#8a90a3',
  sun: '#ffe6bd',
  fill: '#b9d7ff',
};

const pure = {
  white: '#ffffff',
  black: '#000000',
  clear: '#00000000',
};

const families = { stone, paving, ground, roof, lawn, flowers, leaf, wood, soil, metal, plastic, trim, solar, aqua, glow, building, props, core, sky, fauna, signal, light, pure };

export const PALETTE = {
  ...families,
  // ───── legacy names (pre-Look 2), kept as aliases ─────
  concrete: ['#8d9196', '#7f8489', '#979a9e', '#868a8f'],
  concreteDark: '#5d6166',
  crack: '#3f4347',
  debris: '#6d7176',
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
  white: stone.white,
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
};
