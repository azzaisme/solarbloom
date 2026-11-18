import { SEA } from '../core/Areas';
import { isMainlandArea } from '../core/Mainland';
import { ENDING } from '../data/ending';
import { MAINLAND } from '../data/mainland';
import { TIERS } from '../data/salvage';
import type { Sim } from './Sim';

/** Every kind of wildlife the ecosystem knows (state.fauna). */
const WILDLIFE = ['butterflies', 'birds', 'koi', 'robots'] as const;

/**
 * E23.9.3 (#404): the Great Bloom. The last fountain delivery makes the whole island bloom: every kind of wildlife
 * arrives at once, the fog lifts off the way east to the Long Causeway, and the causeway rises (E23.8.3's
 * MainlandSystem raises it and reveals the landing district). The maker's last page comes with it (JournalSystem).
 * Bloomed is read from the fountain tier, so there is nothing new to save; the one-off parts run once.
 */
export class EndingSystem {
  constructor(private sim: Sim) {
    sim.bus.on('fountain.tier', ({ tier }) => {
      if (tier >= TIERS.length) this.bloom();
    });
  }

  /** Has the Great Bloom happened? */
  get bloomed(): boolean {
    return (this.sim.state.salvage?.tier ?? 0) >= TIERS.length;
  }

  /** The Great Bloom's one-off changes. Runs once; true the first time. */
  bloom(): boolean {
    const s = this.sim;
    if (!this.bloomed || !s.salvage.see('greatBloom')) return false;
    // wildlife floods back: every kind arrives now
    s.state.fauna = { ...Object.fromEntries(WILDLIFE.map((k) => [k, s.time])), ...(s.state.fauna ?? {}) };
    // the fog lifts off the way to the causeway, along its own rows
    const c = MAINLAND.causeway;
    const ids = new Set<string>();
    for (let x = ENDING.clearFromX; x < c.x0; x++) for (let z = c.z0; z <= c.z1; z++) ids.add(s.areas.map.areaOfCell(x, z));
    for (const id of ids) {
      if (id === SEA || id.startsWith('out_') || isMainlandArea(id) || s.areas.fog(id) === 'cleared') continue;
      s.gates.openRegion(id);
      s.areas.clear(id, true);
    }
    // the causeway rises and the landing district comes out of the cloud (E23.8.3)
    s.mainland.open();
    s.bus.emit('ending.bloomed', { causewayEnd: { x: c.x1, z: c.z0 }, mainlandX: MAINLAND.minChunkX * 16 });
    return true;
  }
}
