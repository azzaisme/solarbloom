import type { LinkState, MachineData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

/** A link between two Bloom Relays: `relay:<lower id>|<higher id>`. */
export function relayLinkId(a: MachineData, b: MachineData): string {
  const [x, y] = [a.id, b.id].sort((p, q) => (Number(p.slice(1)) || 0) - (Number(q.slice(1)) || 0));
  return `relay:${x}|${y}`;
}

/**
 * City 10.4: buildable Bloom Relays. Any two relays within range link up (range measured between their centres
 * in world space, so relays on the ground and on raised rooftops link too). Each link carries a chain at most
 * once per chain, then recharges; links are found from the relays themselves, so building or upgrading
 * never needs bookkeeping.
 */
export class RelaySystem {
  constructor(private sim: Sim) {}

  range(): number {
    return TUNING.relay.range + TUNING.relay.rangePerLevel * this.sim.upgrades.level('relayLens');
  }

  targets(): number {
    return TUNING.relay.targets + this.sim.upgrades.level('relayLens');
  }

  /** World-space centre of a relay (x, z). */
  centre(m: MachineData): [number, number] {
    const l = this.sim.grid.layer(m.roofId);
    const o = l?.origin ?? [0, 0, 0];
    return [o[0] + m.x + m.size / 2, o[2] + m.z + m.size / 2];
  }

  distance(a: MachineData, b: MachineData): number {
    const [ax, az] = this.centre(a);
    const [bx, bz] = this.centre(b);
    return Math.hypot(ax - bx, az - bz);
  }

  /** The relays a relay links to (in range), nearest first, deterministic. */
  linked(m: MachineData): MachineData[] {
    const R = this.range();
    return this.sim
      .machinesOfType('relay')
      .filter((o) => o !== m && this.sim.grid.isPlayable(o.roofId) && this.distance(m, o) <= R + 1e-9)
      .sort((a, b) => this.distance(m, a) - this.distance(m, b) || (Number(a.id.slice(1)) || 0) - (Number(b.id.slice(1)) || 0));
  }

  state(id: string): LinkState {
    return (this.sim.state.links[id] ??= { built: true, builtAt: this.sim.time, readyAt: 0, crossings: 0 });
  }

  ready(id: string): boolean {
    return this.sim.time >= (this.sim.state.links[id]?.readyAt ?? 0) - 1e-9;
  }

  /** The other end of a link, seen from one relay. */
  otherEnd(linkId: string, from: string): MachineData | undefined {
    const [a, b] = linkId.slice('relay:'.length).split('|');
    return this.sim.machine(a === from ? b : a);
  }
}
