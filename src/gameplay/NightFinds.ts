import { NIGHT_FIND_GIVES, NIGHT_FINDS, type NightFindDef } from '../data/time';
import type { Sim } from './Sim';

/**
 * E23.7.1.3 (#447): night-only finds: glowing plants and glinting salvage. Each is out whenever the sky is dark (the
 * light clock, so in "follow my clock" mode they come out with the real night), and one that's taken is back the next
 * game day. In "follow my clock" mode that is the best for the player: fresh finds every 48 minutes of play, shown
 * whenever it's dark, so nobody waits a whole real day for them.
 * Fireflies, the third night find, are ambience (rendering/Fauna) and fly only at night.
 */
export class NightFinds {
  constructor(private sim: Sim) {}

  all(): readonly NightFindDef[] {
    return NIGHT_FINDS;
  }

  /** Is its time now: night for night finds, fog (E23.7.2) for fog finds? */
  private due(f: NightFindDef): boolean {
    return f.when === 'fog' ? !!this.sim.weather?.effects().fogFinds : this.sim.clock.isNight();
  }

  /** Out now: its time (night, or fog), and not taken this night (or this foggy day). */
  visible(id: string): boolean {
    const f = NIGHT_FINDS.find((n) => n.id === id);
    if (!f || !this.due(f)) return false;
    return this.sim.state.clock?.nights?.[id] !== this.stamp(f);
  }

  /** The finds out now. */
  out(): NightFindDef[] {
    return NIGHT_FINDS.filter((f) => this.visible(f.id));
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
    (st.nights ??= {})[id] = this.stamp(f);
    s.bus.emit('night.found', { id, material: g.material, n, x: f.x, z: f.z });
    return n;
  }

  /**
   * The game day a find was taken on: it is back the next game day, in both clock modes. (A game night belongs to
   * the day whose evening it began on: the game day only turns at dawn.)
   */
  private stamp(_f: NightFindDef): number {
    return this.sim.clock.gameDay();
  }
}
