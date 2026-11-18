import type { MaterialId } from '../core/types';

/**
 * E22.6 (#343): material icons for the backpack and the build menu. Each has its own shape as well as its own
 * colour (nothing is told by colour alone): a brick stack, a seed, a coil, a log, a pane, a pot, a cog, a star.
 * Inline SVG on a 32-unit grid; colours are classes styled from tokens (and a colour-safe set, E22.8).
 */
const BODY: Record<MaterialId | 'biomass' | 'unknown', string> = {
  // Scrap: three stacked bricks
  scrap: `<rect x="4" y="18" width="11" height="8" rx="1.5"/><rect x="17" y="18" width="11" height="8" rx="1.5"/><rect x="10" y="8" width="12" height="8" rx="1.5"/>`,
  // Seeds: a seed with a sprout
  seeds: `<path d="M16 28 C8 28 6 20 10 14 C13 10 19 10 22 14 C26 20 24 28 16 28 Z"/><path d="M16 12 C16 6 20 3 26 4 C26 9 22 12 16 12 Z" class="mi-hi"/>`,
  // Copper: a coil of wire
  copper: `<ellipse cx="16" cy="9" rx="10" ry="4" class="mi-ring"/><ellipse cx="16" cy="16" rx="10" ry="4" class="mi-ring"/><ellipse cx="16" cy="23" rx="10" ry="4" class="mi-ring"/>`,
  // Timber: a log, end on
  timber: `<rect x="3" y="10" width="22" height="12" rx="6"/><circle cx="24" cy="16" r="6" class="mi-hi"/><circle cx="24" cy="16" r="2.4" class="mi-cut"/>`,
  // Glass: a pane, with a glint
  glass: `<path d="M16 3 L28 16 L16 29 L4 16 Z"/><path d="M11 13 L16 8 M9 17 L12 14" class="mi-line"/>`,
  // Clay: a pot
  clay: `<path d="M11 5 H21 V8 C27 11 28 22 22 27 H10 C4 22 5 11 11 8 Z"/><path d="M10 5 H22" class="mi-line"/>`,
  // Gears: a cog
  gears: `<path d="M14 3 h4 l1 4 l3 1.4 l3.6 -2 l2.8 2.8 l-2 3.6 l1.4 3 l4 1 v4 l-4 1 l-1.4 3 l2 3.6 l-2.8 2.8 l-3.6 -2 l-3 1.4 l-1 4 h-4 l-1 -4 l-3 -1.4 l-3.6 2 l-2.8 -2.8 l2 -3.6 l-1.4 -3 l-4 -1 v-4 l4 -1 l1.4 -3 l-2 -3.6 l2.8 -2.8 l3.6 2 l3 -1.4 Z" transform="translate(1.6 1.6) scale(.9)"/><circle cx="16" cy="16" r="4.5" class="mi-cut"/>`,
  // Sunstone: an eight-point star
  sunstone: `<path d="M16 2 L19 11 L28 8 L22 16 L28 24 L19 21 L16 30 L13 21 L4 24 L10 16 L4 8 L13 11 Z"/><circle cx="16" cy="16" r="3.4" class="mi-hi"/>`,
  // Greens (biomass): a leaf
  biomass: `<path d="M6 26 C4 12 14 4 28 4 C28 18 20 28 6 26 Z"/><path d="M7 25 C13 19 19 13 26 6" class="mi-line"/>`,
  // E23.5.1 Food: a carrot with its leaves
  food: `<path d="M9 27 C7 25 9 20 13 15 L19 9 L23 13 L17 19 C12 23 11 29 9 27 Z"/><path d="M20 8 C19 4 21 2 23 2 M22 10 C25 8 28 9 30 11 M21 9 C24 5 27 5 28 6" class="mi-line"/><path d="M12 20 L15 21 M15 16 L17 18" class="mi-line"/>`,
  // Compost: a heap with crumbs
  compost: `<path d="M3 26 C5 16 11 10 16 10 C21 10 27 16 29 26 Z"/><circle cx="12" cy="19" r="1.6" class="mi-hi"/><circle cx="19" cy="16" r="1.4" class="mi-hi"/><circle cx="21" cy="22" r="1.6" class="mi-hi"/><path d="M16 10 C16 7 18 5 21 5" class="mi-line"/>`,
  // Fertiliser: a tied sack with a drop on it
  fertiliser: `<path d="M11 6 H21 L19 10 C26 13 27 24 23 28 H9 C5 24 6 13 13 10 Z"/><path d="M12 10 H20" class="mi-line"/><path d="M16 15 C18 18 19 20 19 21.5 a3 3 0 0 1 -6 0 C13 20 14 18 16 15 Z" class="mi-hi"/>`,
  // E23.5.4.1 Honey: a round pot with a dipper
  honey: `<path d="M7 12 C5 20 8 28 16 28 C24 28 27 20 25 12 Z"/><path d="M6 12 H26" class="mi-line"/><path d="M19 4 L14 14" class="mi-line"/><circle cx="12" cy="20" r="2" class="mi-hi"/>`,
  // not found yet
  unknown: `<circle cx="16" cy="16" r="12" class="mi-ghost"/><path d="M12 13 a4 4 0 1 1 6 3.4 c-1.6 1 -2 1.8 -2 3.4" class="mi-line"/><circle cx="16" cy="24" r="1.4" class="mi-dot"/>`,
};

export type MaterialIconId = keyof typeof BODY;

/** A material's icon (decorative: the name is always beside it in text). */
export function materialIcon(id: MaterialIconId, size = 32): string {
  return `<svg class="mi mi-${id}" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false">${BODY[id]}</svg>`;
}

export const MATERIAL_ICON_IDS = Object.keys(BODY) as MaterialIconId[];
