import type { Grid } from '../core/Grid';
import type { TileData } from '../core/types';

export const RAISED_PAVING_LIFT = 0.03;
export const RESTORED_PATH_LIFT = 0.052;
const PAINT_LIFT = 0.006;
const SIDES = [-1, 1] as const;

const isPath = (tile: TileData | undefined): tile is TileData & { feature: "paving" } =>
  !!tile && tile.feature === 'paving' && !tile.blocked;

function pathLift(tile: TileData): number {
  return tile.ground === 'restored' ? RESTORED_PATH_LIFT + PAINT_LIFT : RAISED_PAVING_LIFT + PAINT_LIFT;
}

/** Clearance above the slab for raised bricks and paved corners spilling into neighbouring soil. */
export function pavingOverlayLift(grid: Pick<Grid, 'peek'>, tile: TileData | undefined): number {
  if (!tile) return 0;
  if (isPath(tile)) return pathLift(tile);
  if (tile.blocked || tile.occupantId || !['lawn', 'litter', 'clay'].includes(tile.feature ?? 'lawn')) return 0;
  for (const dx of SIDES) {
    const x = grid.peek(tile.roofId, tile.x + dx, tile.z);
    if (!isPath(x) || x.level !== tile.level) continue;
    for (const dz of SIDES) {
      const z = grid.peek(tile.roofId, tile.x, tile.z + dz);
      if (isPath(z) && z.level === tile.level) return RESTORED_PATH_LIFT + PAINT_LIFT;
    }
  }
  return 0;
}
