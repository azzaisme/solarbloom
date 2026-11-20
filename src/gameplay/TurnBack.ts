import { mainlandClosedAt } from '../core/Mainland';
import { MAINLAND_CLOSED } from '../data/mainland';

/**
 * Island release: bloombot at the closed causeway (data/mainland `MAINLAND.open`). Heading into it, bloombot turns
 * round and walks a short way back towards the island, whatever the keys or stick say for that moment, so it reads
 * as a gentle turn and never as pressing against a wall. The card ("More coming soon") shows once per approach: it
 * comes back only after bloombot has walked away from the causeway.
 */
export class TurnBack {
  private left = 0;
  private dx = 0;
  private dz = 0;
  private armed = true;

  /** Is bloombot turning back right now (steering ignored)? */
  get active(): boolean {
    return this.left > 0;
  }

  /** Each frame, before steering: while turning back, the direction bloombot walks (unit vector), else undefined. */
  tick(dt: number): { x: number; z: number } | undefined {
    if (this.left <= 0) return undefined;
    this.left -= dt;
    return { x: this.dx, z: this.dz };
  }

  /**
   * After a step heading (dirX, dirZ) from (px, pz): if that heads into the closed causeway, the turn back starts.
   * True when the card should show (the first time this approach).
   */
  bump(px: number, pz: number, dirX: number, dirZ: number): boolean {
    const l = Math.hypot(dirX, dirZ);
    if (l < 1e-6 || this.left > 0) return false;
    const ax = Math.floor(px + (dirX / l) * MAINLAND_CLOSED.probe);
    const az = Math.floor(pz + (dirZ / l) * MAINLAND_CLOSED.probe);
    if (!mainlandClosedAt(ax, az)) {
      if (!this.armed && !this.near(px, pz)) this.armed = true; // walked away: the next approach shows the card again
      return false;
    }
    this.dx = -dirX / l;
    this.dz = -dirZ / l;
    this.left = MAINLAND_CLOSED.turnSeconds;
    const card = this.armed;
    this.armed = false;
    return card;
  }

  /** Is a closed cell within `rearmCells` of bloombot? */
  private near(px: number, pz: number): boolean {
    const R = MAINLAND_CLOSED.rearmCells;
    const cx = Math.floor(px);
    const cz = Math.floor(pz);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (mainlandClosedAt(cx + dx, cz + dz)) return true;
    return false;
  }
}
