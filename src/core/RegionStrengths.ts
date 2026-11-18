// E23.8.1 (#399): region strengths. The lookup other systems use: power (wind, sun), water (springs), the farm
// (soil), crafting (machinery), weather (shelter), salvage and trade. Data is in data/oldcity (REGION_STRENGTHS).

import { REGION_STRENGTHS, STRENGTH_MACHINES, type RegionId, type StrengthKind } from '../data/oldcity';
import { regionOfCell } from './OldCityLayout';

/** The multiplier a strength gives at a cell: 1 outside its regions (the park, backstreets, the sea). */
export function strengthAt(x: number, z: number, kind: StrengthKind): number {
  const r = regionOfCell(Math.floor(x), Math.floor(z));
  return r ? strengthOf(r.id, kind) : 1;
}

/** The multiplier a strength gives in a region (1 if the region doesn't have it). */
export function strengthOf(region: RegionId, kind: StrengthKind): number {
  return REGION_STRENGTHS[region].strengths[kind] ?? 1;
}

/** Does the cell have this strength at all? For the yes/no strengths: shelter (ignore weather), water (free refill). */
export function hasStrength(x: number, z: number, kind: StrengthKind): boolean {
  return strengthAt(x, z, kind) > 1;
}

/** The strengths a machine id matches (most have one; none for a machine no strength boosts). */
export function strengthsOfMachine(machine: string): StrengthKind[] {
  return (Object.keys(STRENGTH_MACHINES) as StrengthKind[]).filter((k) => STRENGTH_MACHINES[k].includes(machine));
}

/** Output multiplier for a machine at a cell: its best matching strength there, or 1. */
export function machineStrengthAt(machine: string, x: number, z: number): number {
  let best = 1;
  for (const k of strengthsOfMachine(machine)) best = Math.max(best, strengthAt(x, z, k));
  return best;
}
