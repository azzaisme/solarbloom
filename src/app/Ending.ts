import { CAUSEWAY, ENDING } from '../data/ending';
import { LAST_PAGE } from '../data/journal';
import { REGIONS } from '../data/oldcity';

/** What the Great Bloom borrows from the game (kept small, so Game.ts changes little). */
export interface EndingHost {
  /** the letterbox and its title */
  cinematic(on: boolean, title?: string): void;
  /** rings and petals rising from a ground cell */
  bloomAt(x: number, z: number, i: number): void;
  fanfare(): void;
  /** the camera rises over the whole island (on), or comes back down to bloombot (off) */
  overview(on: boolean): void;
  /** the view's pan bounds take in what is newly reachable (the causeway) */
  bounds(): void;
  /** the camera rises over a spot for `secs` and comes back (a still frame with reduced motion) */
  vista(x: number, z: number, secs: number, done: () => void): void;
  /** redraws the ground tile at a cell */
  markTile(x: number, z: number): void;
  /** opens the backpack's journal at a page */
  openPage(id: string): void;
  /** runs `fn` after `secs` of game time */
  after(secs: number, fn: () => void): void;
  save(): void;
}

/**
 * E23.9.3 (#404): the Great Bloom as it plays. The sim has already done its part (EndingSystem: wildlife, the fog, the
 * causeway walkable; JournalSystem: his last page kept). Here: the island blooms landmark by landmark from the
 * fountain outward; then the camera rests on the Long Causeway as it rises toward the mainland, where no light
 * answers; then the journal opens at his last page. No toast, no lecture.
 */
export function playGreatBloom(host: EndingHost) {
  host.cinematic(true, ENDING.title);
  host.fanfare();
  host.bounds();
  host.overview(true);
  host.bloomAt(8, 8, 0);
  // from the fountain outward: the regions in ring order
  const order = [...REGIONS].sort((a, b) => a.ring - b.ring || a.n - b.n);
  const step = ENDING.bloomSeconds / (order.length + 1);
  order.forEach((r, i) => host.after(step * (i + 1), () => host.bloomAt(r.landmark.x, r.landmark.z, i + 1)));
  host.after(ENDING.bloomSeconds, () => {
    host.cinematic(false);
    host.overview(false);
    // the causeway rises: its spans redraw standing (the sim made them walkable at the delivery)
    for (let x = CAUSEWAY.x0; x <= CAUSEWAY.x1; x++) host.markTile(x, CAUSEWAY.z0);
    host.vista((CAUSEWAY.x0 + CAUSEWAY.x1) / 2, 0.5, ENDING.causewaySeconds, () => {});
  });
  // his last page, whatever the camera did (a skipped or refused vista still ends here)
  host.after(ENDING.bloomSeconds + ENDING.causewaySeconds + 1, () => {
    host.openPage(LAST_PAGE);
    host.save();
  });
}
