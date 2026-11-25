import type * as pc from 'playcanvas';
import { expect, it } from 'vitest';
import { GROUND } from '../src/core/GameState';
import { Overlays } from '../src/rendering/Overlays';
import { pavingOverlayLift } from '../src/rendering/PavingSurface';
import { SLAB_TOP } from '../src/rendering/SceneBuilder';
import { initLowPoly } from '../src/rendering/Shapes';
import { TileFx } from '../src/rendering/TileFx';
import { tileMarkerMesh } from '../src/rendering/TileMarker';
import { headlessApp, makeSim } from './helpers';

it('changes the primary marker with the action and keeps it above restored paving', () => {
  const { device, root, destroy } = headlessApp();
  try {
    initLowPoly(device);
    const sim = makeSim(7);
    const tile = sim.grid.get(GROUND, 8, 8)!;
    Object.assign(tile, { feature: 'paving', ground: 'restored', blocked: false });
    const overlays = new Overlays(sim, root);
    const { frame, frameMi, shimmer } = overlays as unknown as { frame: pc.Entity; frameMi: pc.MeshInstance; shimmer: pc.Entity };
    const styles = {
      hover: 'hover', info: 'selected', ok: 'valid', restore: 'restore', bad: 'invalid',
    } as const;
    for (const tone of ['hover', 'info', 'ok', 'restore', 'bad'] as const) {
      overlays.showFrame(tile.roofId, tile.x, tile.z, 1, tone);
      expect(frameMi.mesh).toBe(tileMarkerMesh(device, styles[tone]));
      const surface = sim.grid.tileWorld(tile)[1] + SLAB_TOP + pavingOverlayLift(sim.grid, tile);
      expect(frame.getPosition().y).toBeGreaterThan(surface);
      expect(shimmer.enabled).toBe(tone === 'restore');
    }
    overlays.showFrame(tile.roofId, tile.x, tile.z, 2, 'restore');
    overlays.reducedMotion = true;
    overlays.update(0.1);
    expect(frameMi.mesh).toBe(tileMarkerMesh(device, 'restore', 2));
    expect(shimmer.enabled).toBe(false);
  } finally {
    destroy();
  }
});

it('prioritizes the focused marker on a marked objective and shows gold again when focus leaves', () => {
  const { device, root, destroy } = headlessApp();
  try {
    initLowPoly(device);
    const sim = makeSim(7);
    const tile = sim.grid.get(GROUND, 8, 8)!;
    const fx = new TileFx(sim, root, device);
    const over = new Overlays(sim, root);
    const update = () => fx.showObjectiveTiles([tile], (t) => over.framesTile(t));
    update();
    const marker = root.findByName('objective-tile') as pc.Entity;
    expect(marker.render?.meshInstances[0].mesh).toBe(tileMarkerMesh(device, 'objective'));
    over.showFrame(tile.roofId, tile.x, tile.z, 1, 'restore');
    update();
    expect(marker.enabled).toBe(false);
    over.hideFrame();
    fx.reducedMotion = true;
    update();
    expect(marker.enabled).toBe(true);
    expect(marker.findByName('objective-shimmer')?.enabled).toBe(false);
    fx.showObjectiveTiles([]);
    expect(root.findByName('objective-tile')).toBeNull();
  } finally {
    destroy();
  }
});
