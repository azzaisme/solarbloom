import * as pc from 'playcanvas';
import { detailTextures, type DetailLayer } from './DetailTex';

export const PALETTE = {
  concrete: ['#8d9196', '#7f8489', '#979a9e', '#868a8f'],
  concreteDark: '#5d6166',
  crack: '#3f4347',
  debris: '#6d7176',
  weed: '#7a8a5c',
  soil: '#8a6a4b',
  soilDark: '#6f533a',
  moss: '#7fa35a',
  grass: ['#69bf4a', '#74c64f', '#5fb446'],
  grassTuft: ['#4fae3a', '#5fbf43', '#86d45a'],
  flower: ['#ff7eb6', '#ffd23f', '#b48cff', '#ffffff', '#ff9a5a'],
  flowerCore: '#ffe28a',
  stem: '#3f9a3a',
  shrub: ['#3e9e46', '#4fb04f', '#2f8a3e'],
  trunk: '#8b6243',
  white: '#f4f1ea',
  whiteWarm: '#fbf6ec',
  // Drone redesign (docs/art/SOLARBLOOM_DRONE_REDESIGN.md, D02): warm ceramic shell, soft gold, navy glass, lime leaves.
  shell: '#f5f3e8',
  shellLow: '#bebba7',
  panel: '#1e3a6b',
  panelGlint: '#3a6fb8',
  gold: '#e8ba40',
  glass: '#7fd6f0',
  water: '#4cc3ea',
  darkFace: '#101d26',
  eyeCyan: '#71f5ff',
  leafFin: '#a5d94d',
  leafVein: '#589d32',
  facadeGrey: '#a3a6aa',
  facadeDark: '#7d8085',
  window: '#3b4652',
  windowLit: '#ffe6a6',
  parapet: '#9a9ea2',
  parapetClean: '#f2efe8',
  vent: '#8a7d70',
  rust: '#a0623c',
  coreDormant: '#6f747a',
  coreGlow: '#7cf7c8',
  cat: '#fbfaf7',
  catRed: '#e2483c',
  pink: '#ff8fbf',
  skyline: ['#b9d6e6', '#acc9dc', '#c4dce8', '#a5c3d6'],
  skylineGreen: '#a8d3a0',
  bridge: '#eeeae2',

  // Look 3 (#105) surfaces, foliage and props. Placeholder values (what Look 3 shipped with); Look 2 owns the retune.
  /** E16 turf by stage (index 1 Restored … 4 Radiant), three shades each */
  stageGrass: [[], ['#9fd46a', '#a6d871', '#97cd62'], ['#69bf4a', '#74c64f', '#5fb446'], ['#4fae45', '#58b74a', '#48a640'], ['#79c24d', '#82c853', '#74bd49']] as string[][],
  /** grass blades by stage (0 dead weeds … 4 Radiant): base and tip */
  bladeBase: ['#646a44', '#3d7023', '#2e7023', '#267023', '#387023'],
  bladeTip: ['#b4ad74', '#bcdf77', '#88d345', '#79d345', '#9ad345'],
  flowerDaisy: ['#ffffff', '#fff4c9', '#ffe066'],
  flowerCosmos: ['#ff7eb6', '#e0479e', '#ffc1dc', '#ff9a5a'],
  flowerLavender: ['#9a78e0', '#b48cff', '#7f8ce8'],
  flowerSunflower: ['#ffd23f', '#ffb52e'],
  flowerWild: ['#ffffff', '#ffd23f', '#8fb8ff', '#ff9fd0'],
  flowerCentre: '#ffcf3a',
  sunflowerDisc: '#6b3f1f',
  bud: '#5aa045',
  stemDark: '#2f6e2b',
  stemLeaf: '#4f9a3a',
  stemLeafLight: '#86c45a',
  /** leafy shrubs: base, lit, shade */
  shrubLeaf: ['#368028', '#82d039', '#183f1c'],
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
  brass: '#d9a441',
  paveAlive: ['#e9e4d8', '#e2dccd', '#efe9dd', '#d9d2c3'],
  paveDead: ['#9a9890', '#8f8d86', '#a3a097', '#8a877f'],
  paveSwept: ['#b4b1a8', '#aaa79e', '#bdbab1'],
  /** grout / dirt between slabs: restored, dead */
  grout: ['#a59d8c', '#5f5b52'],
  stoneCream: '#ece4d2',
  stoneCreamTop: '#f7f1e4',
  stoneDead: '#a49d90',
  soilDry: '#9a8466',
  railRust: '#8f5434',
  railCopper: '#b97a4a',
  /** parapet wall: restored, dead, dead coping */
  parapetWall: ['#e6dcc8', '#8f8a80', '#a19c91'],
  wood: '#a67a4e',
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
  lanternMetal: '#3f4246',
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
  // Look 3.7 trees: each species' canopy as [base, light, dark] at the two ends of its range (a tree mixes
  // between them by variant), bark, blossom and the bits at the foot of a sapling
  treeLeaf: {
    oak: [['#357425', '#6ec030', '#13391d'], ['#25742a', '#48c030', '#133928']],
    cherry: [['#e89cc2', '#f1bbcf', '#c15c99'], ['#e89cae', '#f1bbc1', '#c15c7e']],
    birch: [['#578628', '#a3d039', '#1c4319'], ['#418628', '#80d039', '#194320']],
    pine: [['#2f744d', '#42bd5b', '#1c4032'], ['#2f745b', '#42bd73', '#1c4039']],
    willow: [['#5b8f32', '#a0d04e', '#20481e'], ['#488f32', '#86d04e', '#1e4823']],
  } as Record<string, string[][]>,
  treeBark: { oak: '#72533b', cherry: '#6a4339', birch: '#eeece7', pine: '#5d4232', willow: '#745c44' } as Record<string, string>,
  birchEye: '#3f3831',
  /** cherry blossom clumps: base, light, dark */
  treeBlossom: ['#f3e8eb', '#f7f7f7', '#e0b8c7'],
  treeMulch: '#543926',
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
  scaffold: '#c9a77a',
  scaffoldRail: '#d8b98d',
  sunflowerGlow: '#ffcf4a',
  seedFace: '#8a5a1c',
  treeOrb: '#fff3b0',
  lanternGlow: '#ffe27a',
  waterSwirl: '#bff6ff',
  waterSwirlGlow: '#7fe8ff',
  waterBubble: '#e6fbff',
  relayGlow: '#9ff7ff',
  canopyTop: '#5fc25a',
  coreCrystalDormant: '#8a9097',
  emissiveOff: '#000000',
  fountainStone: '#8f8b82',
  gaugeDormant: '#6e7a80',
  basinDark: '#4a463f',
  cisternStone: '#8a8478',
  cisternBand: '#7a6553',
  cisternDark: '#3d3a35',
  elderBark: '#7d6a58',
  elderCrystal: '#55604f',
  elderGround: '#6b6156',
  gardenWaterGlow: '#1a6f8a',
  lilyPad: '#5fb24a',
  bloomPale: '#fff6c2',
  mist: '#d8f4ff',
};
// Blooming turf is the base grass, so a retune of `grass` carries into it.
PALETTE.stageGrass[2] = PALETTE.grass;

const cache = new Map<string, pc.StandardMaterial>();

export interface MatOpts {
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  gloss?: number;
  metal?: number;
  unlit?: boolean;
  doubleSided?: boolean;
  /** Look 3.1: a world-space detail layer (stone, metal, bark, plaster) over the flat colour. */
  detail?: DetailLayer;
}

export function color(hex: string): pc.Color {
  const c = new pc.Color();
  c.fromString(hex);
  return c;
}

/** Shared, cached material. Never create materials per frame. */
export function mat(hex: string, o: MatOpts = {}): pc.StandardMaterial {
  const key = hex + JSON.stringify(o);
  let m = cache.get(key);
  if (m) return m;
  m = new pc.StandardMaterial();
  m.diffuse = color(hex);
  m.useMetalness = true;
  m.metalness = o.metal ?? 0;
  m.gloss = o.gloss ?? 0.35;
  if (o.emissive) {
    m.emissive = color(o.emissive);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  if (o.unlit) {
    m.useLighting = false;
    m.emissive = color(hex);
    m.diffuse = new pc.Color(0, 0, 0);
  }
  if (o.opacity !== undefined && o.opacity < 1) {
    m.opacity = o.opacity;
    m.blendType = pc.BLEND_NORMAL;
    m.depthWrite = false;
  }
  if (o.doubleSided) m.cull = pc.CULLFACE_NONE;
  if (o.detail && !o.unlit) detailTextures.apply(m, o.detail);
  m.update();
  cache.set(key, m);
  return m;
}

/** A private (uncached) material for things that animate their colour, like the Core. */
export function uniqueMat(hex: string, o: MatOpts = {}): pc.StandardMaterial {
  const m = mat(hex, o).clone() as pc.StandardMaterial;
  if (o.detail && !o.unlit) detailTextures.apply(m, o.detail);
  m.update();
  return m;
}
