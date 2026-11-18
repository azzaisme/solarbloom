import { NIGHT_FIND_GIVES, NIGHT_FINDS, type NightFindDef } from '../data/time';
import type { Sim } from './Sim';

/**
 * E23.7.1.3 (#447): night-only finds: glowing plants and glinting salvage. Each is out from dusk to dawn (the light
 * clock, so in "follow my clock" mode they come out with the real night). One taken tonight is back the next night.
 * Fireflies, the third night find, are ambience (rendering/Fauna) and fly only at night.
 */
export class NightFinds {
  constructor(private sim: Sim) {}

  all(): readonly NightFindDef[] {
    return NIGHT_FINDS;
  }

  /** Out now: night, and not taken tonight. */
  visible(id: string): boolean {
    const c = this.sim.clock;
    if (!c.isNight() || !NIGHT_FINDS.some((f) => f.id === id)) return false;
    return this.sim.state.clock?.nights?.[id] !== this.night();
  }

  /** The finds out now. */
  out(): NightFindDef[] {
    return this.sim.clock.isNight() ? NIGHT_FINDS.filter((f) => this.visible(f.id)) : [];
  }

  /** The find on a ground cell, if one is out there. */
  at(x: number, z: number): NightFindDef | undefined {
    return this.out().find((f) => f.x === x && f.z === z);
  }

  /** Why it can't be taken (undefined: it can). */
  problem(id: string): string | undefined {
    const f = NIGHT_FINDS.find((n) => n.id === id);
    if (!f || !this.visible(id)) return 'Nothing here';
    const g = NIGHT_FIND_GIVES[f.kind];
    if (this.sim.state.salvage && this.sim.inventory.room(g.material) <= 0) return 'Your stack is full — put some in storage first';
    return undefined;
  }

  /** Takes a night find into the backpack. Returns the units taken. */
  take(id: string): number {
    const s = this.sim;
    const why = this.problem(id);
    if (why) {
      s.bus.emit('action.failed', { reason: why });
      return 0;
    }
    const f = NIGHT_FINDS.find((n) => n.id === id)!;
    const g = NIGHT_FIND_GIVES[f.kind];
    const n = s.state.salvage ? Math.min(g.n, s.inventory.room(g.material)) : 0;
    if (n > 0) s.inventory.add(g.material, n);
    const st = (s.state.clock ??= { offset: s.clock.gameSeconds() - s.state.time });
    (st.nights ??= {})[id] = this.night();
    s.bus.emit('night.found', { id, material: g.material, n, x: f.x, z: f.z });
    return n;
  }

  /**
   * Which night it is: the game day of the evening the night began. On the light clock: in "follow my clock" mode,
   * the real date's evening. Past midnight still counts as the evening before.
   */
  private night(): number {
    const c = this.sim.clock;
    if (c.real) {
      const d = c.now();
      // before dawn belongs to the evening before
      const back = d.getHours() < 6 ? 1 : 0;
      return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000) - back;
    }
    return c.gameDay();
  }
}
