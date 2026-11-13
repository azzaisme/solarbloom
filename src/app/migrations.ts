import { buildRoof, placeRoofFixtures, SAVE_VERSION } from '../core/GameState';
import { Rng } from '../core/Rng';
import type { GameState } from '../core/types';
import { ROOFTOPS } from '../data/rooftops';

/**
 * Save-format migrations, oldest first. Each step upgrades a save in place by one version.
 * Missing top-level fields are filled from a fresh state afterwards, so steps only handle
 * nested data that a shallow merge can't fix.
 */
const STEPS: Record<number, (s: GameState) => void> = {
  // v1 (Round 1) → v2 (Round 2): machines gain a charge meter; the cat gains a stash counter.
  1: (s) => {
    for (const m of s.machines) (m as { charge?: number }).charge ??= 0;
    (s.cat as { stash?: number }).stash ??= 0;
    s.cat.log ??= [];
  },
  // v2 (Round 2) → v3 (Phase 3): three rooftops. The Seed (r1) is kept exactly as it was, tile ids and all.
  // Round 2's r2 was a never-playable 6×6 preview, so it is rebuilt from the new Reservoir layout; r3 is new.
  2: (s) => {
    const rng = new Rng((s.seed ^ 0x9e3779b9) >>> 0); // separate stream: the game's own rng state is untouched
    const coreAwake = !!s.progression?.coreActivated;
    for (const def of ROOFTOPS) {
      if (def.id === 'r1') continue;
      const old = s.rooftops.find((r) => r.id === def.id);
      const playable = old && old.unlocked && !old.preview;
      if (playable) continue; // never happens for Round 2 saves, but never wipe a playable roof
      const fresh = buildRoof(def, rng);
      if (def.id === 'r2' && coreAwake) fresh.unlocked = true; // revealed by the Seed's Core
      s.rooftops = s.rooftops.filter((r) => r.id !== def.id);
      s.machines = s.machines.filter((m) => m.roofId !== def.id);
      s.drones = s.drones.filter((d) => s.machines.some((m) => m.id === d.hubId));
      s.rooftops.push(fresh);
      placeRoofFixtures(s, def);
    }
    const order = ROOFTOPS.map((r) => r.id);
    s.rooftops.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const p = s.progression as GameState['progression'];
    p.cores = { ...(p.cores ?? {}), ...(coreAwake ? { r1: true } : {}) };
    p.overflows ??= 0;
    p.canopyBursts ??= 0;
    p.neighbourhoodBloomAt ??= -1;
    s.links ??= {};
    s.relayBonus ??= 0;
  },
};

export function migrate(s: GameState) {
  while (s.version < SAVE_VERSION) {
    STEPS[s.version]?.(s);
    s.version++;
  }
}
