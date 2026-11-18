// E23.6.6 (#470): overgrowth. Vines and plants that grow over what bloombot has built: along power lines between
// poles, round pipe runs, and up machines, chests, benches, walls and ruins. All data, no rules: starting values.

import type { ItemCost, Unlock } from './crafting';

/** What overgrowth can grow on. */
export type OvergrowthHost = 'line' | 'pipe' | 'machine' | 'decor' | 'ruin';

export type OvergrowthKind = 'ivy' | 'moss' | 'clematis' | 'morningGlory' | 'climbingRose' | 'wisteria' | 'hangingBasket';

export interface OvergrowthDef {
  id: OvergrowthKind;
  name: string;
  /** short icon for text */
  icon: string;
  /** leaf and flower colours (the generated sprigs pick from these) */
  leaf: string;
  flower?: string;
  /** what it grows on */
  hosts: OvergrowthHost[];
  /** cuttings or seeds from plants grown */
  cost: ItemCost;
  unlock: Unlock;
  /** how the sprigs sit: a creeping mat, a climbing vine, hanging trails, or a basket under a line */
  habit: 'mat' | 'climb' | 'drape' | 'basket';
}

export const OVERGROWTH: OvergrowthDef[] = [
  { id: 'ivy', name: 'Ivy', icon: '🌿', leaf: '#3f7a3a', hosts: ['line', 'pipe', 'machine', 'decor', 'ruin'], cost: { seeds: 2 }, unlock: { home: true }, habit: 'climb' },
  { id: 'moss', name: 'Moss', icon: '🟩', leaf: '#6f9a45', hosts: ['line', 'pipe', 'machine', 'decor', 'ruin'], cost: { seeds: 1 }, unlock: { home: true }, habit: 'mat' },
  { id: 'clematis', name: 'Clematis', icon: '🌸', leaf: '#4c7f3c', flower: '#9b6fd0', hosts: ['line', 'pipe', 'machine', 'decor', 'ruin'], cost: { seeds: 3 }, unlock: { research: 'dc-clematis' }, habit: 'climb' },
  { id: 'morningGlory', name: 'Morning glory', icon: '🌺', leaf: '#4f8a3e', flower: '#5a8ee0', hosts: ['line', 'pipe', 'machine', 'decor', 'ruin'], cost: { seeds: 3 }, unlock: { research: 'dc-morningGlory' }, habit: 'drape' },
  { id: 'climbingRose', name: 'Climbing rose', icon: '🌹', leaf: '#3d6e36', flower: '#d8485a', hosts: ['line', 'pipe', 'machine', 'decor', 'ruin'], cost: { seeds: 4 }, unlock: { find: 'c-elderGrove-2' }, habit: 'climb' },
  { id: 'wisteria', name: 'Wisteria', icon: '💜', leaf: '#5a8a46', flower: '#b38be0', hosts: ['line', 'pipe', 'machine', 'decor', 'ruin'], cost: { seeds: 5 }, unlock: { research: 'dc-wisteria' }, habit: 'drape' },
  { id: 'hangingBasket', name: 'Hanging basket', icon: '🧺', leaf: '#4a8040', flower: '#f0a04a', hosts: ['line', 'pipe', 'machine', 'decor', 'ruin'], cost: { seeds: 3, planks: 1 }, unlock: { find: 'c-saltwind-1' }, habit: 'basket' },
];

export const OVERGROWTH_BY_ID: Record<OvergrowthKind, OvergrowthDef> = Object.fromEntries(OVERGROWTH.map((o) => [o.id, o])) as Record<OvergrowthKind, OvergrowthDef>;

export const OVERGROWTH_TUNING = {
  /** game days from a sprout to full (a game day is 48 minutes of play) */
  growDays: 1,
  daySeconds: 2880,
  /** a sprig every this many tiles along a line or pipe run, and per tile of a machine's edge */
  sprigsPerTile: 3,
  /** at most this many sprigs on one host, and triangles for all of it (the Deck preset's budget: one draw call) */
  maxSprigs: 48,
  maxTris: 160000,
  /** how it is drawn: a pole's top, a line's sag at its middle, a pipe's top, a machine's and a decoration's height
   *  per tile of footprint (all in tiles above the ground) */
  poleTop: 1.6,
  lineSag: 0.35,
  pipeTop: 0.18,
  machineHeight: 0.9,
  decorHeight: 0.6,
};
