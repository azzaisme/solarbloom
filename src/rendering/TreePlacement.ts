import type { TileData } from '../core/types';
import type { Species, TreeStage } from './TreeGen';

/**
 * Phase 5 visual overhaul: which restorable tiles grow a tree, of which species. Looks only: deterministic from
 * the tile's position, so a tree never jumps between saves or rebuilds, and gameplay never reads it.
 *
 * Trees stand on natural ground (lawn, litter, clay); streets, plazas and markets get theirs in planters on a
 * share of paved tiles. A tree tile shows a sapling once restored and grows with the tile's bloom stage.
 */

const hash01 = (x: number, z: number, salt: number) => {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

interface Rule {
  share: number; // of eligible tiles
  planterShare?: number; // of paved tiles (in planters)
  species: [Species, number][];
}

const RULES: Record<string, Rule> = {
  park: { share: 0.16, species: [['oak', 5], ['cherry', 3], ['birch', 2]] },
  grove: { share: 0.3, species: [['oak', 4], ['pine', 4], ['birch', 2]] },
  canal: { share: 0.12, planterShare: 0.05, species: [['willow', 6], ['cherry', 3]] },
  reservoir: { share: 0.14, species: [['willow', 5], ['oak', 3]] },
  street: { share: 0.1, planterShare: 0.06, species: [['birch', 6], ['cherry', 4]] },
  plaza: { share: 0.1, planterShare: 0.07, species: [['birch', 5], ['cherry', 5]] },
  market: { share: 0.08, planterShare: 0.04, species: [['cherry', 5], ['birch', 4]] },
  rooftops: { share: 0.1, planterShare: 0.05, species: [['birch', 6], ['cherry', 4]] },
};

export interface TreeSpot {
  species: Species;
  variant: number;
  rot: number;
  scale: number;
  planter: boolean;
}

/** The tree this tile grows, if any (ignores its current state). */
export function treeSpot(t: Pick<TileData, 'x' | 'z' | 'feature' | 'blocked'>, areaType: string): TreeSpot | undefined {
  if (t.blocked) return undefined;
  const rule = RULES[areaType] ?? RULES.park;
  const f = t.feature ?? 'lawn';
  const natural = f === 'lawn' || f === 'litter' || f === 'clay';
  const planter = f === 'paving' && !!rule.planterShare;
  const share = natural ? rule.share : planter ? rule.planterShare! : 0;
  if (!(share > 0) || hash01(t.x, t.z, 1) >= share) return undefined;
  const total = rule.species.reduce((a, [, w]) => a + w, 0);
  let pick = hash01(t.x, t.z, 2) * total;
  let species = rule.species[0][0];
  for (const [sp, w] of rule.species) {
    if ((pick -= w) < 0) {
      species = sp;
      break;
    }
  }
  return {
    species,
    variant: Math.floor(hash01(t.x, t.z, 3) * 4),
    rot: hash01(t.x, t.z, 4) * Math.PI * 2,
    // Phase 6: on natural ground, about a third of the trees are big specimens (a crown about two tiles across,
    // like the reference); the rest stay ornamental, so the lawn and its flowers still show between them.
    scale: planter ? 0.86 + hash01(t.x, t.z, 5) * 0.22 : hash01(t.x, t.z, 6) < 0.34 ? 1.65 + hash01(t.x, t.z, 5) * 0.3 : 1.0 + hash01(t.x, t.z, 5) * 0.25,
    planter: !natural,
  };
}

/**
 * The growth stage a tile shows (undefined: nothing grows there yet). `bloom` is the stage the tile shows, which
 * low water nearby can fade (E23.4.4: pass `sim.water.bloomShown(t)`); it defaults to the tile's own.
 */
export function treeStage(t: Pick<TileData, 'ground' | 'bloom' | 'occupantId'>, bloom = t.bloom): TreeStage | undefined {
  if (t.ground !== 'restored' || t.occupantId) return undefined;
  return Math.max(1, Math.min(4, bloom || 1)) as TreeStage;
}
