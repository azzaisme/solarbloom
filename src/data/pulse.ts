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
}

/** The wheel, in order. When the chosen load runs out, the pulse fires empty (never stuck). */
export const PULSE_LOADS: PulseLoadDef[] = [
  { id: 'none', name: 'Nothing', icon: '🌾', bloom: 1, biomass: 1, extraReach: 0 },
  { id: 'seeds', name: 'Seeds', icon: '🌼', item: 'seeds', plant: 'meadow', bloom: 2, biomass: 1.5, extraReach: 0 },
  { id: 'rare', name: 'Rare seed', icon: '🌷', item: 'rareSeed', plant: 'rare', bloom: 2, biomass: 1.5, extraReach: 0 },
  { id: 'fertiliser', name: 'Fertiliser', icon: '🌳', item: 'fertiliser', plant: 'grove', bloom: 3, biomass: 2, extraReach: 1 },
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
} as const;

/** Each region's rare plants (the look of a rare-seed pulse there); unlisted regions use `default`. */
export const RARE_PLANTS: Record<string, { name: string; flower: 'lavender' | 'sunflower' | 'cosmos' | 'daisy' | 'wild' }> = {
  default: { name: 'Wild orchids', flower: 'wild' },
  park: { name: 'Fountain lilies', flower: 'cosmos' },
  elderGrove: { name: 'Elder bluebells', flower: 'lavender' },
  saltwind: { name: 'Sea thrift', flower: 'daisy' },
  terraces: { name: 'Terrace sunflowers', flower: 'sunflower' },
};
