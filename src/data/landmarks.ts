/**
 * P7-E31 (#717): environmental landmarks and guided exploration.
 *
 * - The hierarchy (#748): one major focal landmark per region (the park's is the fountain), its medium destinations
 *   (the Keeper's home, the lookout, a vault) and small story props (caches, journal pages). Read from the layout
 *   data; nothing new is placed or saved.
 * - The stages (#751): a landmark reads ruined, then restoring as its region greens toward the landmark's need, then
 *   thriving once it is woken. The stage is a pure function of goals the game already has (#753): the region's
 *   restored tiles against its need, and the wake itself. No new resource.
 * - The look (#750, #752): one material language for every landmark's dressing (ivory stone, gold, timber, lantern
 *   glass, living green), placed only inside the landmark's own 2×2 footprint or on water nobody walks (#754).
 *
 * Every number the renderer uses lives here (LANDMARK_LOOK), so it is tunable and tested.
 */
import { PARK } from '../core/Areas';
import { KEEPERS, REGIONS, type RegionDef } from './oldcity';
import { VAULTS } from './moveSpots';

export type LandmarkTier = 'major' | 'medium' | 'small';
export type DestinationKind = 'landmark' | 'fountain' | 'keeper' | 'lookout' | 'vault' | 'cache' | 'page';

export interface Destination {
  /** region id ('park' for the park's fountain) */
  region: string;
  tier: LandmarkTier;
  kind: DestinationKind;
  name: string;
  x: number;
  z: number;
}

/** What each kind of destination counts as. */
export const DESTINATION_TIER: Record<DestinationKind, LandmarkTier> = {
  landmark: 'major',
  fountain: 'major',
  keeper: 'medium',
  lookout: 'medium',
  vault: 'medium',
  cache: 'small',
  page: 'small',
};

/** The park's fountain: the start's first goal and the park's focal point (its 2×2 at (7, 7); core/Areas). */
export const PARK_FOUNTAIN = { x: 7, z: 7, name: 'the fountain' };

function inRegion(r: RegionDef, x: number, z: number): boolean {
  const c = r.chunks;
  return x >= c.x0 * 16 && x < (c.x1 + 1) * 16 && z >= c.z0 * 16 && z < (c.z1 + 1) * 16;
}

/** #748: every destination on the island, by region and tier. Derived from the layout data, so it never drifts. */
export function landmarkHierarchy(): Destination[] {
  const out: Destination[] = [{ region: PARK, tier: 'major', kind: 'fountain', name: PARK_FOUNTAIN.name, x: PARK_FOUNTAIN.x, z: PARK_FOUNTAIN.z }];
  const add = (r: RegionDef, kind: DestinationKind, name: string, x: number, z: number) => out.push({ region: r.id, tier: DESTINATION_TIER[kind], kind, name, x, z });
  for (const r of REGIONS) {
    add(r, 'landmark', r.landmark.name, r.landmark.x, r.landmark.z);
    const k = KEEPERS.find((kp) => kp.id === r.keeper);
    if (k) add(r, 'keeper', `${k.name}'s home`, k.x, k.z);
    add(r, 'lookout', `${r.name} lookout`, r.lookout.x, r.lookout.z);
    for (const v of VAULTS) if (inRegion(r, v.x, v.z)) add(r, 'vault', `${r.name} vault`, v.x, v.z);
    for (const c of r.caches) add(r, 'cache', 'a buried box', c.x, c.z);
    for (const p of r.pages) add(r, 'page', 'a journal page', p.x, p.z);
  }
  return out;
}

export type LandmarkStage = 'ruined' | 'restoring' | 'thriving';

/**
 * #751: how far a landmark has come back. `restored` / `need` are the region's own counts (core/Areas), `awake` is
 * the wake (its fog cleared). `k` runs 0 → 1 through the restoring stage, and is 1 once thriving.
 */
export function landmarkStage(awake: boolean, restored: number, need: number): { stage: LandmarkStage; k: number } {
  if (awake) return { stage: 'thriving', k: 1 };
  const f = need > 0 ? Math.max(0, Math.min(1, restored / need)) : 0;
  if (f < LANDMARK_LOOK.restoringFrom) return { stage: 'ruined', k: 0 };
  // restoring: k eases from a first visible step up to just short of thriving (the wake does the rest)
  const t = (f - LANDMARK_LOOK.restoringFrom) / (1 - LANDMARK_LOOK.restoringFrom);
  return { stage: 'restoring', k: LANDMARK_LOOK.restoringK[0] + (LANDMARK_LOOK.restoringK[1] - LANDMARK_LOOK.restoringK[0]) * t };
}

/** A lantern post in a landmark's dressing: footprint-local position (tile units from its centre). */
export interface LanternSpot {
  x: number;
  z: number;
  /** post height (world units, to the lantern's hook) */
  h: number;
}

export interface LandmarkDress {
  /** lantern posts: inside the footprint (|x|, |z| ≤ footprintHalf) */
  lanterns: LanternSpot[];
  /** ivy patches on the model: footprint-local centres and radius */
  ivy: { x: number; y: number; z: number; r: number }[];
  /** flower pots at the front: footprint-local */
  pots: { x: number; z: number }[];
  /** paving slabs under the model: footprint-local rectangle half-size */
  apron?: { hx: number; hz: number };
  /** a beacon on water off the footprint (Sea Lock): offset from the footprint centre, and on what */
  beacon?: { dx: number; dz: number; scale: number; rock: number };
  /** the lock's moving parts (node names in its model): gate leaves swing open, the gear turns */
  lock?: { leaves: [string, string]; open: number; gear: string; gearSpin: number };
}

/** The footprint: 2×2 tiles round its centre, so anything inside stays within ±1 (less a margin). */
export const FOOTPRINT_HALF = 1;

export const LANDMARK_LOOK = {
  /** below this share of its need restored, the landmark reads ruined */
  restoringFrom: 0.15,
  /** the restoring look's range (k) from its first visible step to the wake */
  restoringK: [0.25, 0.7] as [number, number],
  /**
   * The model's ruined look: its palette drained toward its own grey (`ruinDesat`), darkened (`ruinDark`) and
   * nudged to a dusty warm grey (`ruinTint`), with less gloss. Thriving is the model's own palette. (A plain
   * multiply turned the sandstone muddy brown.)
   */
  ruinDesat: 0.75,
  ruinDark: 0.72,
  ruinTint: [1, 0.97, 0.93] as [number, number, number],
  ruinGloss: 0.5,
  /** lantern glass: emissive intensity while restoring (a faint ember) and thriving */
  lanternGlow: { restoring: 0.35, thriving: 1.6 },
  /** the beacon's lamp when the landmark thrives (emissive intensity) */
  beaconGlow: 2.2,
  /** the wake (#753): seconds for the stone to wash clean, lanterns to light one after another, the gate to open */
  wake: { wash: 1.8, lanternDelay: 0.5, lanternStep: 0.35, open: 2.4, openDelay: 0.8 },
  /** the generic dressing every landmark shares */
  base: {
    lanterns: [
      { x: -0.82, z: 0.82, h: 0.9 },
      { x: 0.82, z: 0.82, h: 0.9 },
    ],
    ivy: [],
    pots: [
      { x: -0.5, z: 0.86 },
      { x: 0.5, z: 0.86 },
    ],
  } as LandmarkDress,
  /** per landmark kind (data/oldcity landmark.kind): what it adds or changes */
  kinds: {
    // #749: the start region's landmark. The lock-gate model (±0.94 across, ±0.53 deep at its scale) faces the sea;
    // lanterns stand in front of its piers, ivy climbs the piers, its leaves open and the gear turns when it wakes,
    // and its beacon (the sea-lock-light model, unused until now) stands on a rock at the canal's mouth.
    sealock: {
      lanterns: [
        { x: -0.84, z: 0.8, h: 1.0 },
        { x: 0.84, z: 0.8, h: 1.0 },
      ],
      // ivy up the outer corners of the piers' sea faces, thickest low down (it climbs from the sand)
      ivy: [
        { x: -0.8, y: 0.28, z: 0.52, r: 0.2 },
        { x: -0.82, y: 0.62, z: 0.52, r: 0.16 },
        { x: -0.78, y: 0.95, z: 0.52, r: 0.12 },
        { x: 0.82, y: 0.3, z: 0.52, r: 0.19 },
        { x: 0.8, y: 0.6, z: 0.52, r: 0.13 },
        { x: -0.94, y: 0.35, z: 0.1, r: 0.15 },
      ],
      pots: [],
      apron: { hx: 0.98, hz: 0.98 },
      // in the canal beside the lock (x −3…0 at z 42–44 is water, walked by nobody), so from the start the lock
      // shows as a gate and a light together
      beacon: { dx: 2.75, dz: 2.25, scale: 0.34, rock: 0.42 },
      lock: { leaves: ['leaf_left', 'leaf_right'], open: 78, gear: 'gear', gearSpin: 50 },
    },
  } as Record<string, Partial<LandmarkDress>>,
};

/** The dressing for one landmark kind: the shared base with its kind's own parts over it. */
export function landmarkDress(kind: string): LandmarkDress {
  return { ...LANDMARK_LOOK.base, ...(LANDMARK_LOOK.kinds[kind] ?? {}) };
}
