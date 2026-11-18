import { SEA } from '../core/Areas';
import { onCauseway } from '../core/OldCityLayout';
import { CAUSEWAY } from '../data/ending';
import { TIERS } from '../data/salvage';
import type { Sim } from './Sim';

/** Every kind of wildlife the ecosystem knows (state.fauna). */
const WILDLIFE = ['butterflies', 'birds', 'koi', 'robots'] as const;

/**
 * E23.9.3 (#404): the Great Bloom. The last fountain delivery (tier 5) makes the whole island bloom: every kind of
 * wildlife arrives at once, the fog lifts off the way east to the Long Causeway, and the causeway rises (walkable
 * from now on). The maker's last page comes with it (JournalSystem). Bloomed is read from the fountain tier, so
 * there is nothing new to save; the one-off parts run once (`salvage.seen`).
 *
 * The mainland past the causeway is E23.8.3's: it listens for `ending.bloomed`, or reads `bloomed`.
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

  /** Can bloombot walk on this causeway cell? (Only after the Great Bloom.) */
  causewayOpen(x: number, z: number): boolean {
    return onCauseway(x, z) && this.bloomed;
  }

  /** The Great Bloom's one-off changes. Runs once; true the first time. */
  bloom(): boolean {
    const s = this.sim;
    if (!this.bloomed || !s.salvage.see('greatBloom')) return false;
    // wildlife floods back: every kind arrives now
    s.state.fauna = { ...Object.fromEntries(WILDLIFE.map((k) => [k, s.time])), ...(s.state.fauna ?? {}) };
    // the fog lifts off the way to the causeway (from Clock Plaza east to the shore)
    const ids = new Set<string>();
    for (let x = 64; x <= CAUSEWAY.x1; x++) for (let z = CAUSEWAY.z0; z <= CAUSEWAY.z1; z++) ids.add(s.areas.map.areaOfCell(x, z));
    for (const id of ids) {
      if (id === SEA || id.startsWith('out_') || s.areas.fog(id) === 'cleared') continue;
      s.gates.openRegion(id);
      s.areas.clear(id, true);
    }
    s.bus.emit('ending.bloomed', { causewayEnd: { x: CAUSEWAY.x1, z: 0 }, mainlandX: CAUSEWAY.mainlandX });
    return true;
  }
}
