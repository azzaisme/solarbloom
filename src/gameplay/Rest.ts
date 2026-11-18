import { decorKey } from '../core/Decor';
import { GROUND } from '../core/GameState';
import type { KeeperStep, MachineData } from '../core/types';
import { CHARGE } from '../data/charge';
import { KEEPERS } from '../data/oldcity';
import { REST } from '../data/rest';
import type { Sim } from './Sim';

/** A bench bloombot can sit on: an old park bench (a generated prop) or one placed as a decoration. */
export interface Bench {
  id: string;
  x: number;
  z: number;
  kind: 'old' | 'placed';
  /** which way its seat faces (radians, 0 = +z, as bloombot's facing): the bench model's back is on its -z side */
  facing: number;
}

const STEPS: KeeperStep[] = ['asleep', 'request1', 'request2', 'landmark', 'settled'];

/**
 * E23.2.3 (#373): stopping to enjoy the world. Bloombot sits on a bench (a trickle of charge comes back) or
 * meditates at a charger (fast, free, on the grid). Old park benches are broken until mended; placed ones are
 * ready. Sitting is never saved: a loaded game always starts standing. While sitting the world may run faster
 * (`fast`); the game reads it. Keepers who are friends may sit beside bloombot on a bench.
 */
export class RestSystem {
  /** where bloombot sits now (undefined: standing) */
  sitting?: { kind: 'bench'; bench: Bench } | { kind: 'charger'; machineId: string };
  /** "let time run faster" while sitting */
  fast = false;

  constructor(private sim: Sim) {}

  private get mended(): string[] {
    return (this.sim.state.rest ??= { mended: [] }).mended;
  }

  /** The bench on a ground tile, if any. */
  benchAt(x: number, z: number): Bench | undefined {
    const t = this.sim.grid.peek(GROUND, x, z);
    if (!t) return undefined;
    if (t.prop === 'bench') return { id: `bench:${x}:${z}`, x, z, kind: 'old', facing: 0 }; // old benches are drawn unturned
    const d = this.sim.state.cozy?.decor?.[decorKey(GROUND, x, z)];
    if (d && d.split('@')[0] === 'bench') return { id: `bench:${x}:${z}`, x, z, kind: 'placed', facing: (-Number(d.split('@')[1] ?? 0) * Math.PI) / 2 }; // as DecorArt turns it
    return undefined;
  }

  /** Can bloombot sit on it (placed benches always; old ones once mended)? */
  usable(b: Bench): boolean {
    return b.kind === 'placed' || this.mended.includes(b.id);
  }

  /** Mends an old bench with a little scrap. Why not, or undefined when done. */
  mend(b: Bench): string | undefined {
    if (this.usable(b)) return undefined;
    if (!this.sim.inventory.pay(REST.mendCost)) return 'Needs a little Scrap to mend';
    this.mended.push(b.id);
    this.sim.grid.touch(this.sim.grid.get(GROUND, b.x, b.z)!);
    this.sim.bus.emit('bench.mended', { benchId: b.id, x: b.x, z: b.z });
    return undefined;
  }

  sitOnBench(b: Bench): boolean {
    if (!this.usable(b)) return false;
    this.sitting = { kind: 'bench', bench: b };
    this.sim.bus.emit('rest.sat', { kind: 'bench' });
    return true;
  }

  /** E23.3.3: sits cross-legged at a charger and meditates while it charges. */
  meditate(m: MachineData): boolean {
    this.sitting = { kind: 'charger', machineId: m.id };
    this.sim.bus.emit('rest.sat', { kind: 'charger' });
    return true;
  }

  stand() {
    if (!this.sitting) return;
    this.sitting = undefined;
    this.fast = false;
    this.sim.bus.emit('rest.stood', {});
  }

  /**
   * Is a charger giving charge now? E23.3's grid decides for any machine it has a role for (a charger on a network
   * with power). E23.3.3 registers the charger's role; until it does, a charger counts as powered.
   */
  powered(m: MachineData): boolean {
    const p = this.sim.power;
    return p.roleOf(m) ? p.isPowered(m) : true;
  }

  /**
   * Keepers who are friends, nearest first: one may sit beside bloombot. Friendship is E23.9.2's
   * (`sim.keepers.isFriend`); until that lands, a Keeper whose story has settled counts. Only a Keeper the world
   * shows (its region out of the fog) can come and sit.
   */
  friends(x: number, z: number): string[] {
    const sv = this.sim.state.salvage;
    if (!sv) return [];
    const from = STEPS.indexOf(REST.friendFrom);
    const keepers = this.sim.keepers as unknown as { isFriend?(id: string): boolean };
    return KEEPERS.filter((k) => this.sim.keepers.visible(k.id))
      .filter((k) => keepers.isFriend?.(k.id) ?? STEPS.indexOf(sv.keepers[k.id]?.step ?? 'asleep') >= from)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))
      .map((k) => k.id);
  }

  tick(dt: number) {
    const s = this.sitting;
    if (!s) return;
    if (s.kind === 'bench') this.sim.charge.recharge(CHARGE.benchPerSecond * dt, 'bench');
    else {
      const m = this.sim.machine(s.machineId);
      if (!m) return this.stand();
      if (this.powered(m)) this.sim.charge.recharge(CHARGE.meditatePerSecond * dt, 'charger');
    }
  }
}
