import { KEEPERS } from './oldcity';
// #627 (E25): Bloombot's parts. Every upgrade, move, park growth and (from #625) Keeper knack shows on Bloombot as
// a part, and every level changes it, so you can tell how far a Bloombot has come at a glance. Data only: the pieces
// are built from primitive shapes in Bloombot's own materials (rendering/BloombotVisuals draws them). Positions were
// placed by eye in the browser from the follow camera and close up.

/** A part of Bloombot (the page's rows name the part they change, so the turntable can light it). */
export type PartId = 'marks' | 'knacks' | 'leaves' | 'cells' | 'pockets' | 'feet' | 'core' | 'hands' | 'lens' | 'panel' | 'lamp' | 'charm' | 'bud' | 'collar' | 'cuffs';

/** Bloombot's own materials (the GLB's `bloombot_*`), and one of ours: the solar panel's dark blue glass. */
export type BotMat = 'leaf' | 'glow' | 'fabric' | 'gold' | 'glass' | 'bulb' | 'dark' | 'champagne' | 'canvas' | 'shell' | 'solar';

/** The bones a piece can ride (it moves and turns with its bone). */
export type BotBone = 'head_end' | 'Head' | 'headfront' | 'neck' | 'Spine02' | 'LeftHand' | 'RightHand' | 'LeftFoot' | 'RightFoot';

export interface PartPiece {
  /** unique; `grow-<part>-…` */
  name: string;
  part: PartId;
  shape: 'sphere' | 'capsule' | 'box' | 'torus' | 'cylinder' | 'cone';
  mat: BotMat;
  bone: BotBone;
  /** from the bone, in Bloombot's own frame (x right, y up, z forward; world units) */
  at: [number, number, number];
  /** its turn in Bloombot's frame (degrees) */
  euler: [number, number, number];
  scale: [number, number, number];
  /** a colour over its material (#629: a knack's bead takes its Keeper's tint) */
  tint?: string;
}

/** What Bloombot has grown into: everything its parts are drawn from. */
export interface BotGrowth {
  /** the moves learned, in the order the fountain teaches them (pry, hover, climb, glide) */
  moves: readonly string[];
  /** research upgrade levels by id (data/research RESEARCH_UPGRADES) */
  levels: Readonly<Record<string, number>>;
  /** park milestones reached, 0 to 3 (#622) */
  park: number;
  /** #625: the Keeper knacks learned, by id, in the order learned (a mark each; none until #625 lands) */
  knacks?: readonly string[];
}

/** The part each research upgrade grows. */
export const UPGRADE_PART: Record<string, PartId> = {
  chargeCells: 'cells',
  chargeEfficiency: 'core',
  sprint: 'feet',
  pulseRadius: 'leaves',
  backpack: 'pockets',
  quickHands: 'hands',
  keenEye: 'lens',
  sunSoak: 'panel',
  lantern: 'lamp',
  luckyPulse: 'charm',
};

/** Each move's mark on the back of the pack, in a row: a shape that says the move. */
const MOVE_MARK: Record<string, Pick<PartPiece, 'shape' | 'euler' | 'scale'>> = {
  pry: { shape: 'box', euler: [0, 0, 45], scale: [0.026, 0.026, 0.012] }, // a diamond: a wedge's point
  hover: { shape: 'cylinder', euler: [90, 0, 0], scale: [0.032, 0.01, 0.032] }, // a disc: a ripple on water
  climb: { shape: 'cone', euler: [-90, 0, 0], scale: [0.03, 0.03, 0.012] }, // a peak: upward
  glide: { shape: 'sphere', euler: [0, 0, 0], scale: [0.046, 0.018, 0.012] }, // a wing
};
export const MOVE_ORDER = ['pry', 'hover', 'climb', 'glide'] as const;

/** where the pack's back face is, from Spine02 (Bloombot's frame) */
const BACK = -0.305;

export function botParts(g: BotGrowth): PartPiece[] {
  const out: PartPiece[] = [];
  const lvl = (id: string) => Math.max(0, g.levels[id] ?? 0);
  const add = (part: PartId, name: string, shape: PartPiece['shape'], mat: BotMat, bone: BotBone, at: PartPiece['at'], euler: PartPiece['euler'], scale: PartPiece['scale']) =>
    out.push({ name: `grow-${part}-${name}`, part, shape, mat, bone, at, euler, scale });
  const sides = [
    ['l', -1],
    ['r', 1],
  ] as const;

  // ── moves: a mark each on the back of the pack, across the top, in the warm glow of the lamp's bulb (gold reads as
  // dull tan on the pack's shaded back) ──
  MOVE_ORDER.forEach((m, i) => {
    if (!g.moves.includes(m)) return;
    const k = MOVE_MARK[m];
    add('marks', m, k.shape, 'bulb', 'Spine02', [-0.075 + i * 0.05, 0.125, BACK], k.euler, k.scale);
  });

  // ── #625 knacks: a small bead each below the moves, two rows of five (one per Keeper), in its Keeper's own colour ──
  (g.knacks ?? []).slice(0, 10).forEach((id, i) => {
    add('knacks', id, 'sphere', 'champagne', 'Spine02', [-0.06 + (i % 5) * 0.03, 0.085 - Math.floor(i / 5) * 0.025, BACK], [0, 0, 0], [0.016, 0.016, 0.01]);
    const tint = KEEPERS.find((k) => k.id === id)?.tint;
    if (tint) out[out.length - 1].tint = tint;
  });

  // ── Gentler on charge: a gauge low on the back of the pack, a glowing bar a level ──
  for (let i = 0; i < Math.min(5, lvl('chargeEfficiency')); i++) add('core', `${i}`, 'box', 'glow', 'Spine02', [-0.048 + i * 0.024, 0.025, BACK], [0, 0, 0], [0.012, 0.024, 0.008]);

  // ── Wider pulse: a leaf by the sprout a level (front corners, back corners, straight back); from level 3 an
  // antenna behind the sprout that grows taller at 4 and 5, its tip glowing ──
  const yaw = [40, -40, 140, -140, 180];
  for (let i = 0; i < Math.min(5, lvl('pulseRadius')); i++) {
    const a = (yaw[i] * Math.PI) / 180;
    add('leaves', `${i}`, 'sphere', 'leaf', 'head_end', [Math.sin(a) * 0.07, 0.1, Math.cos(a) * 0.07], [-35, yaw[i], 0], [0.05, 0.013, 0.11]);
  }
  const pr = lvl('pulseRadius');
  if (pr >= 3) {
    // upright behind the sprout (a capsule stands on its own y): 6, 8.5, then 11 hundredths tall
    const h = 0.06 + (pr - 3) * 0.025;
    add('leaves', 'antenna', 'capsule', 'dark', 'head_end', [0.045, 0.1 + h / 2, -0.07], [0, 0, 0], [0.016, h, 0.016]);
    add('leaves', 'antenna-tip', 'sphere', 'glow', 'head_end', [0.045, 0.1 + h + 0.012, -0.07], [0, 0, 0], [0.032, 0.032, 0.032]);
  }

  // ── Bigger charge: a glowing cell on top of the pack a level (#623: the 4th and 5th lower at the ends, tipped) ──
  const cells: { at: PartPiece['at']; tilt: number }[] = [
    { at: [-0.06, 0.17, -0.25], tilt: 0 },
    { at: [0, 0.17, -0.25], tilt: 0 },
    { at: [0.06, 0.17, -0.25], tilt: 0 },
    { at: [0.115, 0.15, -0.25], tilt: -25 },
    { at: [-0.115, 0.15, -0.25], tilt: 25 },
  ];
  for (let i = 0; i < Math.min(cells.length, lvl('chargeCells')); i++) add('cells', `${i}`, 'capsule', 'glow', 'Spine02', cells[i].at, [0, 0, cells[i].tilt], [0.032, 0.045, 0.032]);

  // ── Roomier backpack: a pocket a level: left side, right side, the bottom, then a small one high on each side ──
  const pockets: { at: PartPiece['at']; size: PartPiece['scale'] }[] = [
    { at: [0.15, -0.02, -0.2], size: [0.04, 0.085, 0.08] },
    { at: [-0.15, -0.02, -0.2], size: [0.04, 0.085, 0.08] },
    { at: [0, -0.12, -0.24], size: [0.13, 0.045, 0.055] },
    { at: [0.15, 0.08, -0.2], size: [0.036, 0.05, 0.065] },
    { at: [-0.15, 0.08, -0.2], size: [0.036, 0.05, 0.065] },
  ];
  for (let i = 0; i < Math.min(pockets.length, lvl('backpack')); i++) add('pockets', `${i}`, 'box', 'fabric', 'Spine02', pockets[i].at, [0, 0, 0], pockets[i].size);

  // ── Longer stride: the feet: soles, then gold ankle bands, heel fins, toe caps, a glowing stripe ──
  const st = lvl('sprint');
  for (const [s, x] of sides) {
    const foot = s === 'l' ? 'LeftFoot' : 'RightFoot';
    if (st >= 1) add('feet', `sole-${s}`, 'box', 'dark', foot, [0, -0.075, 0.03], [0, 0, 0], [0.085, 0.022, 0.15]);
    if (st >= 2) add('feet', `band-${s}`, 'torus', 'gold', foot, [0, 0.005, 0], [0, 0, 0], [0.085, 0.07, 0.085]);
    if (st >= 3) add('feet', `fin-${s}`, 'box', 'champagne', foot, [x * 0.0, -0.035, -0.05], [20, 0, 0], [0.014, 0.045, 0.05]);
    if (st >= 4) add('feet', `toe-${s}`, 'sphere', 'champagne', foot, [0, -0.05, 0.095], [0, 0, 0], [0.07, 0.04, 0.05]);
    if (st >= 5) add('feet', `stripe-${s}`, 'box', 'glow', foot, [x * 0.044, -0.06, 0.03], [0, 0, 0], [0.008, 0.012, 0.12]);
  }

  // ── Quick hands: a gold stud on the back of each hand a level ──
  for (let i = 0; i < Math.min(3, lvl('quickHands')); i++)
    for (const [s] of sides) add('hands', `stud-${s}-${i}`, 'sphere', 'gold', s === 'l' ? 'LeftHand' : 'RightHand', [0, 0.035, -0.02 + i * 0.03], [0, 0, 0], [0.022, 0.022, 0.022]);

  // ── Keen eye: a lens at the side of the visor: a gold rim, then its glass glows, then one on the other side too ──
  const ke = lvl('keenEye');
  const lens = (s: 'l' | 'r', x: number) => {
    add('lens', `rim-${s}`, 'torus', 'gold', 'headfront', [x * 0.13, 0.0, -0.02], [0, 0, 90], [0.05, 0.05, 0.05]);
    add('lens', `glass-${s}`, 'cylinder', ke >= 2 ? 'bulb' : 'glass', 'headfront', [x * 0.135, 0.0, -0.02], [0, 0, 90], [0.04, 0.008, 0.04]);
  };
  if (ke >= 1) lens('r', 1);
  if (ke >= 3) lens('l', -1);

  // ── Sun soak: a solar panel on a stalk above the pack: a small one, a wider one, then wings either side ──
  const ss = lvl('sunSoak');
  if (ss >= 1) {
    add('panel', 'post', 'capsule', 'dark', 'Spine02', [0, 0.2, -0.31], [0, 0, 0], [0.012, 0.06, 0.012]);
    add('panel', 'main', 'box', 'solar', 'Spine02', [0, 0.235, -0.31], [-25, 0, 0], [ss >= 2 ? 0.11 : 0.07, 0.006, 0.05]);
  }
  if (ss >= 3) for (const [s, x] of sides) add('panel', `wing-${s}`, 'box', 'solar', 'Spine02', [x * 0.088, 0.228, -0.31], [-25, 0, x * -20], [0.05, 0.006, 0.04]);

  // ── Lantern: a little lamp on a crook over the right shoulder; at level 2 it's bigger, with a gold cage ──
  const la = lvl('lantern');
  if (la >= 1) {
    add('lamp', 'crook', 'capsule', 'dark', 'Spine02', [0.11, 0.23, -0.26], [0, 0, -12], [0.012, 0.13, 0.012]);
    const b = la >= 2 ? 0.062 : 0.046;
    add('lamp', 'bulb', 'sphere', 'bulb', 'Spine02', [0.125, 0.3, -0.24], [0, 0, 0], [b, b * 1.2, b]);
    if (la >= 2) add('lamp', 'cage', 'torus', 'gold', 'Spine02', [0.125, 0.3, -0.24], [0, 0, 0], [0.075, 0.06, 0.075]);
  }

  // ── Lucky pulse: a clover charm hanging on the pack's left side: two leaves, three, then four ──
  const lp = lvl('luckyPulse');
  if (lp >= 1) {
    add('charm', 'stem', 'capsule', 'dark', 'Spine02', [-0.16, 0.1, -0.27], [0, 0, 0], [0.006, 0.05, 0.006]);
    for (let i = 0; i < Math.min(4, lp + 1); i++) {
      const a = (i * 360) / Math.min(4, lp + 1) + 45;
      const r = (a * Math.PI) / 180;
      add('charm', `leaf-${i}`, 'sphere', 'leaf', 'Spine02', [-0.16 + Math.cos(r) * 0.016, 0.065 + Math.sin(r) * 0.016, -0.275], [0, 0, a], [0.026, 0.018, 0.008]);
    }
  }

  // ── #622: what greening the park grew: a glowing bud at the sprout's tip, a gold collar, gold cuffs ──
  if (g.park >= 1) add('bud', 'tip', 'sphere', 'glow', 'head_end', [0, 0.13, 0], [0, 0, 0], [0.04, 0.05, 0.04]);
  if (g.park >= 2) add('collar', 'ring', 'torus', 'gold', 'neck', [0, 0.02, 0], [0, 0, 0], [0.3, 0.1, 0.3]);
  if (g.park >= 3) for (const [s] of sides) add('cuffs', s, 'torus', 'gold', s === 'l' ? 'LeftHand' : 'RightHand', [0, 0, 0], [0, 0, 90], [0.17, 0.1, 0.17]);

  return out;
}

/** A stamp of what's drawn: the visuals rebuild only when it changes. */
export function growthKey(g: BotGrowth): string {
  return JSON.stringify([g.moves, Object.entries(g.levels).filter(([, v]) => v > 0).sort(), g.park, g.knacks ?? []]);
}

/** Where the Lantern's light sits, from Spine02: its bulb. */
export const LAMP_AT: [number, number, number] = [0.125, 0.3, -0.24];

/**
 * #629: what a row of Bloombot's page would grow next, as a growth: a move learned, an upgrade's next level, the
 * next park milestone. Undefined when there's nothing more (the top level, a move had, a milestone reached).
 */
export function nextGrowth(g: BotGrowth, row: { kind: string; id: string; level?: number; max?: number }): BotGrowth | undefined {
  if (row.kind === 'move') return g.moves.includes(row.id) ? undefined : { ...g, moves: [...g.moves, row.id] };
  if (row.kind === 'upgrade') {
    const now = g.levels[row.id] ?? 0;
    if (row.max !== undefined && now >= row.max) return undefined;
    return { ...g, levels: { ...g.levels, [row.id]: now + 1 } };
  }
  if (row.kind === 'park') {
    const step = PARK_STEPS[row.id];
    return step && g.park < step ? { ...g, park: step } : undefined;
  }
  if (row.kind === 'knack') {
    const k = pieceOf(row)!;
    return (g.knacks ?? []).includes(k) ? undefined : { ...g, knacks: [...(g.knacks ?? []), k] };
  }
  return undefined;
}
/** #629: which of a part's pieces a page row is (a move's mark, also for its second level; a knack's bead, named by its Keeper), if just one */
export function pieceOf(row: { kind: string; id: string }): string | undefined {
  if (row.kind === 'move2') return row.id.replace(/2$/, ''); // E25 (#626): a move's second level, on its mark
  return row.kind === 'move' ? row.id : row.kind === 'knack' ? row.id.replace(/^knack-/, '') : undefined;
}
const PARK_STEPS: Record<string, number> = { spill: 1, thrift: 2, quick: 3 };

/** #629: the pieces `next` adds or changes over `now` (the turntable draws them as a see-through ghost). */
export function partsAdded(now: BotGrowth, next: BotGrowth | undefined): PartPiece[] {
  if (!next) return [];
  const have = new Map(botParts(now).map((p) => [p.name, JSON.stringify([p.at, p.scale, p.shape, p.euler])]));
  return botParts(next).filter((p) => have.get(p.name) !== JSON.stringify([p.at, p.scale, p.shape, p.euler]));
}
