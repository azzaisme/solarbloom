// E23.2.2 (#372): the loaded pulse. What you load decides what grows; the load is used up. All data, no rules.
import type { PlantKind } from '../core/types';

export type PulseLoadId = 'none' | 'seeds' | 'rare' | 'fertiliser';

export interface PulseLoadDef {
  id: PulseLoadId;
  name: string;
  /** short icon for the wheel */
  icon: string;
  /** the backpack item one pulse uses (none: free). E23.5 adds fertiliser; E23.8 hands out rare seeds. */
  item?: string;
  /** what grows on every tile the pulse (and any chain it sets off) restores */
  plant?: PlantKind;
  /** the bloom stage a tile grown this way reaches at once (1 = plain grass) */
  bloom: number;
  /** biomass a restored tile gives, times this */
  biomass: number;
  /** pulse reach in extra tiers (data/tuning pulseTiers) */
  extraReach: number;
  /** E23.2.2.2: how many pollinators a tile grown this way draws (bees and hoverflies over it; the ecosystem counts them) */
  pollinators: number;
  /** E23.2.2.2: draws rare pollinators too (hawk-moths), found nowhere else */
  rarePollinators?: boolean;
}

/** The wheel, in order. When the chosen load runs out, the pulse fires empty (never stuck). */
export const PULSE_LOADS: PulseLoadDef[] = [
  { id: 'none', name: 'Nothing', icon: '🌾', bloom: 1, biomass: 1, extraReach: 0, pollinators: 0 },
  { id: 'seeds', name: 'Seeds', icon: '🌼', item: 'seeds', plant: 'meadow', bloom: 2, biomass: 1.5, extraReach: 0, pollinators: 2 },
  { id: 'rare', name: 'Rare seed', icon: '🌷', item: 'rareSeed', plant: 'rare', bloom: 2, biomass: 1.5, extraReach: 0, pollinators: 2, rarePollinators: true },
  { id: 'fertiliser', name: 'Fertiliser', icon: '🌳', item: 'fertiliser', plant: 'grove', bloom: 3, biomass: 2, extraReach: 1, pollinators: 4 },
];
export const PULSE_LOAD: Record<PulseLoadId, PulseLoadDef> = Object.fromEntries(PULSE_LOADS.map((l) => [l.id, l])) as Record<PulseLoadId, PulseLoadDef>;

/** What grows from each plant kind (biomass and look are read from the load that grew it). */
export const PLANT_LOAD: Record<PlantKind, PulseLoadId> = { meadow: 'seeds', rare: 'rare', grove: 'fertiliser' };

/** E23.2.2.3: the reveal ripple every pulse sends out. */
export const RIPPLE = {
  /** reach in tiles, from the pulsed tile */
  radius: 7,
  /** how long what it found stays lit, seconds */
  seconds: 4,
  /** the wide ring from the pulsed tile: how long it takes to spread, seconds */
  ringSeconds: 0.9,
  /** each thing found: how many times it rings while lit, how wide (tiles), and the delay per tile of distance */
  pings: 3,
  pingRadius: 0.7,
  pingSeconds: 0.9,
  delayPerTile: 0.06,
  sparkles: 5,
  /** the colours, as PALETTE names: the ripple itself, and what it found by kind */
  tint: 'ripple',
  found: { salvage: 'ripple', buried: 'ripple', cache: 'gold', page: 'ripplePage' },
} as const;

/** E23.2.2.1: the load wheel on screen. */
export const LOAD_WHEEL = {
  /** seconds the ring stays up after the wheel turns */
  showSeconds: 1.6,
  /** the one-time introduction, the first time bloombot carries something to load: the ring and its note stay this long */
  introSeconds: 7,
} as const;

/** Each region's rare plants (the look of a rare-seed pulse there); unlisted regions use `default`. */
export interface RarePlant {
  name: string;
  /** the flower model it grows */
  flower: 'lavender' | 'sunflower' | 'cosmos' | 'daisy' | 'wild';
  /** its bloom colour (tints the flower heads) */
  tint: string;
  /** how tall it stands, times a usual flower */
  height: number;
}

/** E23.2.2.2: each region's rare plants (the look of a rare-seed pulse there). The park and the backstreets too. */
export const RARE_PLANTS: Record<string, RarePlant> = {
  park: { name: 'Fountain lilies', flower: 'cosmos', tint: '#f6f1ff', height: 1.2 },
  backstreet: { name: 'Alley poppies', flower: 'wild', tint: '#e5533b', height: 1.0 },
  mastRow: { name: 'Copper foxgloves', flower: 'lavender', tint: '#d9874a', height: 1.5 },
  oldMarket: { name: 'Market marigolds', flower: 'daisy', tint: '#f2a21c', height: 1.0 },
  saltwind: { name: 'Sea thrift', flower: 'daisy', tint: '#f3a6c4', height: 0.8 },
  elderGrove: { name: 'Elder bluebells', flower: 'lavender', tint: '#5f7fe0', height: 1.1 },
  cistern: { name: 'Water irises', flower: 'lavender', tint: '#7a5fd1', height: 1.4 },
  clockPlaza: { name: 'Clockface asters', flower: 'cosmos', tint: '#b78be8', height: 1.1 },
  terraces: { name: 'Terrace sunflowers', flower: 'sunflower', tint: '#f7c531', height: 1.3 },
  glasshouse: { name: 'Glasshouse orchids', flower: 'wild', tint: '#e86fd0', height: 1.2 },
  observatory: { name: 'Star lilies', flower: 'cosmos', tint: '#fff6c9', height: 1.25 },
  spireHeights: { name: 'Spire roses', flower: 'wild', tint: '#c2304e', height: 1.15 },
};
/** Ground outside every region (a fallback that never shows in play: every walkable area has its own). */
export const RARE_PLANT_DEFAULT: RarePlant = RARE_PLANTS.park;

/**
 * E23.2.2.3: buried finds. Seeds and salvage lie buried in open ground across the island, about one tile in
 * `oneIn`. Nothing shows until a pulse's ripple (or the fox, E23.2.5) reveals one; from then a little mound marks
 * it until bloombot digs it up (Interact). Never on or beside a Lucky Cat's nook (open ground only, away from props).
 */
export const BURIED = {
  oneIn: 45,
  /** what one holds: seeds most often */
  finds: [
    { material: 'seeds' as const, n: 2, weight: 7 },
    { material: 'scrap' as const, n: 3, weight: 3 },
  ],
};
