import { GROUND } from '../core/GameState';
import { regionById, setPieceAt } from '../core/OldCityLayout';
import type { GateDef, RegionDef } from '../data/oldcity';
import { REGIONS } from '../data/oldcity';
import { MATERIALS } from '../data/salvage';
import type { Sim } from './Sim';

/**
 * E21.5 (§6, §7): what is in the way. Under old-city rules a region opens because bloombot cleared its gate, never
 * because something was bought. Gates open for good (`salvage.opened`):
 * - a barricade needs Pry (held Interact, 2 s);
 * - deep water needs Hover (Walker refuses gate water without it);
 * - the lock bridge rises when the Sea Lock wakes (Hover also crosses);
 * - the broken bridge is a repair delivery;
 * - a climb gate needs Climb, a cliff a Glide perch.
 * Opening a gate opens its region (unless it only shuts off part of an open region) and every backstreet beside it.
 */
export class GateSystem {
  constructor(private sim: Sim) {
    sim.bus.on('landmark.woken', ({ region }) => {
      // the Sea Lock's reward: the lock bridge to Clock Plaza rises
      for (const r of REGIONS) if (r.gate.kind === 'lockBridge' && r.gate.needs.landmark === region) this.open(r.gate.id, true);
    });
  }

  get on(): boolean {
    return !!this.sim.state.salvage;
  }

  isOpen(id: string): boolean {
    return !!this.sim.state.salvage?.opened.includes(id);
  }

  /** The region whose gate this is. */
  regionOf(g: GateDef): RegionDef {
    return REGIONS.find((r) => r.gate.id === g.id)!;
  }

  /** The gate standing on a cell (still shut), if any. */
  gateAt(x: number, z: number): GateDef | undefined {
    const sp = setPieceAt(x, z);
    return sp?.kind === 'gate' && !this.isOpen(sp.gate.id) ? sp.gate : undefined;
  }

  private has(ability: string | undefined): boolean {
    return !!ability && !!this.sim.state.salvage?.abilities.includes(ability as 'pry');
  }

  /** Why a gate can't be opened now (its prompt), or undefined. */
  problem(g: GateDef): string | undefined {
    if (!this.on) return 'Nothing to open here';
    if (this.isOpen(g.id)) return 'Already open';
    const n = g.needs;
    if (g.kind === 'lockBridge') return n.landmark && this.sim.areas.fog(n.landmark) === 'cleared' ? undefined : this.has('hover') ? undefined : g.blocked;
    if (n.repair) return this.sim.inventory.canPay(n.repair) ? undefined : `${g.blocked}${this.missing(n.repair)}`;
    if (n.ability && !this.has(n.ability)) return g.blocked;
    return undefined;
  }

  private missing(cost: Record<string, number | undefined>): string {
    const m = this.sim.inventory.shortfall(cost);
    return m && m !== 'biomass' ? ` (short of ${MATERIALS[m].name})` : '';
  }

  /** Opens a gate for good. `free`: a reward (the lock bridge) — no check. */
  open(id: string, free = false): boolean {
    const s = this.sim;
    const r = REGIONS.find((q) => q.gate.id === id);
    if (!r || !this.on || this.isOpen(id)) return false;
    const g = r.gate;
    if (!free) {
      const why = this.problem(g);
      if (why) {
        s.bus.emit('action.failed', { reason: why });
        return false;
      }
      if (g.needs.repair && !s.inventory.pay(g.needs.repair)) return false;
    }
    s.state.salvage!.opened.push(id);
    // its rubble or bridge deck becomes open ground (saved as an entry fix)
    for (const [x, z] of g.cells) {
      const t = s.grid.get(GROUND, x, z);
      if (!t || !t.blocked) continue;
      t.blocked = false;
      t.unblocked = true;
      s.transitions.unblock(t);
      s.grid.touch(t);
    }
    if (g.opensRegion !== false) this.openRegion(r.id);
    s.bus.emit('gate.opened', { gateId: id, region: r.id });
    return true;
  }

  /** A region opens: its seal lifts, and so does every backstreet beside it. */
  openRegion(id: string) {
    const s = this.sim;
    const a = s.areas;
    const unseal = (aid: string) => {
      const st = s.state.areas[aid];
      if (st && !st.sealed) return;
      if (st) {
        st.sealed = undefined;
        st.price = undefined;
        st.unlockedAt = s.time;
        st.revealedAt = s.time;
      } else s.state.areas[aid] = { fog: 'frontier', revealedAt: s.time, unlockedAt: s.time };
      a.afterUnseal(aid);
      s.bus.emit('area.unlocked', { areaId: aid });
    };
    unseal(id);
    for (const nb of a.info(id).neighbours) if (nb.startsWith('bs_')) unseal(nb);
  }

  regionById = regionById;
}
