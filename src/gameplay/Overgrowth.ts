import { GROUND } from '../core/GameState';
import { decorKey, parseDecorKey } from '../core/Decor';
import type { MachineData } from '../core/types';
import { OVERGROWTH, OVERGROWTH_BY_ID, OVERGROWTH_TUNING, type OvergrowthHost, type OvergrowthKind } from '../data/overgrowth';
import { itemDef } from '../data/items';
import type { Sim } from './Sim';

/** E23.3's grid, as far as overgrowth needs it: the pole-to-pole lines. */
interface PowerLike {
  networks?(): { links: [MachineData, MachineData][] }[];
}

/** One thing overgrowth can grow on. */
export interface Host {
  /** stable key in the save: `m:<machine id>`, `d:<decoration key>`, `r:<roof>:<x>,<z>`, `p:<x>,<z>`, `l:<pole>|<pole>` */
  key: string;
  kind: OvergrowthHost;
  /** for the renderer: the footprint, or the two ends of a line (pole tops), in layer cells */
  roofId: string;
  x: number;
  z: number;
  size: number;
  to?: { x: number; z: number; size: number };
}

/** A placed overgrowth: what grows, and since when (sim time). */
export interface Growth {
  kind: OvergrowthKind;
  t0: number;
}

/**
 * E23.6.6 (#470): overgrowth. In decoration mode bloombot lets nature grow over what it has built: vines along power
 * lines between poles, round pipe runs, and up machines, chests, decorations (benches, fences, walls) and ruins. Each
 * placement costs cuttings or seeds and comes back whole when removed. It starts as a sprout and fills out over a
 * game day. It never changes how anything works; each kind counts as plant variety where it grows.
 *
 * Power lines come from E23.3 (`sim.power.networks()` links) and pipe runs from E23.4 (`state.water.pipes`, "x,z"
 * keys); until those land, machines, decorations and ruins are the hosts there are.
 */
export class Overgrowth {
  constructor(private sim: Sim) {
    // a machine taken down gives its overgrowth back
    sim.bus.on('machine.removed', () => this.tidy());
  }

  private get st(): Record<string, Growth> | undefined {
    return this.sim.state.salvage?.overgrowth;
  }

  /** Every overgrowth placed, by host key. */
  all(): Record<string, Growth> {
    return this.st ?? {};
  }

  at(key: string): Growth | undefined {
    return this.st?.[key];
  }

  /** How far grown (0 a sprout … 1 full), over a game day. */
  growth(g: Growth): number {
    return Math.max(0, Math.min(1, (this.sim.time - g.t0) / (OVERGROWTH_TUNING.growDays * OVERGROWTH_TUNING.daySeconds)));
  }

  /** Kinds known now (from the start, research or finds). */
  known(): OvergrowthKind[] {
    return OVERGROWTH.filter((o) => this.sim.crafting.unlocked(o.unlock)).map((o) => o.id);
  }

  // ───────────── hosts ─────────────

  machineHost(m: MachineData): Host {
    return { key: `m:${m.id}`, kind: 'machine', roofId: m.roofId, x: m.x, z: m.z, size: m.size };
  }

  /** The power lines between poles (E23.3). */
  lines(): Host[] {
    const p = (this.sim as { power?: PowerLike }).power;
    const out: Host[] = [];
    for (const n of p?.networks?.() ?? [])
      for (const [a, b] of n.links) {
        const [u, v] = a.id < b.id ? [a, b] : [b, a];
        out.push({ key: `l:${u.id}|${v.id}`, kind: 'line', roofId: u.roofId, x: u.x, z: u.z, size: u.size, to: { x: v.x, z: v.z, size: v.size } });
      }
    return out;
  }

  /** Pipe tiles (E23.4: `state.water.pipes`, keyed "x,z"). */
  private pipeKeys(): string[] {
    const w = (this.sim.state as { water?: { pipes?: Record<string, unknown> | string[] } }).water;
    const p = w?.pipes;
    return !p ? [] : Array.isArray(p) ? p : Object.keys(p);
  }

  /** Is a decoration (E19.2) on this cell? */
  private decorOn(roofId: string, x: number, z: number): boolean {
    return !!this.sim.state.cozy?.decor?.[decorKey(roofId, x, z)];
  }

  /** The host on a cell: a machine, a decoration, a pipe, a ruin; or a power line passing over it. */
  hostAt(roofId: string, x: number, z: number): Host | undefined {
    const s = this.sim;
    const t = s.grid.peek(roofId, x, z);
    const m = t && s.occupant(t);
    if (m && m.type !== 'core') return this.machineHost(m);
    if (this.decorOn(roofId, x, z)) return { key: `d:${decorKey(roofId, x, z)}`, kind: 'decor', roofId, x, z, size: 1 };
    if (roofId === GROUND && this.pipeKeys().includes(`${x},${z}`)) return { key: `p:${x},${z}`, kind: 'pipe', roofId, x, z, size: 1 };
    if (t?.blocked && t.feature === 'obstacle') return { key: `r:${roofId}:${x},${z}`, kind: 'ruin', roofId, x, z, size: 1 };
    // a line passing over this cell (within half a tile of the straight run between two poles)
    for (const l of this.lines()) {
      if (l.roofId !== roofId || !l.to) continue;
      const ax = l.x + l.size / 2, az = l.z + l.size / 2, bx = l.to.x + l.to.size / 2, bz = l.to.z + l.to.size / 2;
      const px = x + 0.5, pz = z + 0.5;
      const dx = bx - ax, dz = bz - az;
      const k = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(ax + dx * k - px, az + dz * k - pz) <= 0.6 && k > 0.05 && k < 0.95) return l;
    }
    return undefined;
  }

  /** The host behind a saved key (undefined once the thing it grew on is gone). */
  host(key: string): Host | undefined {
    const s = this.sim;
    if (key.startsWith('m:')) {
      const m = s.machine(key.slice(2));
      return m ? this.machineHost(m) : undefined;
    }
    if (key.startsWith('d:')) {
      const at = parseDecorKey(key.slice(2));
      return at && this.decorOn(at.roofId, at.x, at.z) ? { key, kind: 'decor', roofId: at.roofId, x: at.x, z: at.z, size: 1 } : undefined;
    }
    if (key.startsWith('p:')) {
      const [x, z] = key.slice(2).split(',').map(Number);
      return this.pipeKeys().includes(`${x},${z}`) ? { key, kind: 'pipe', roofId: GROUND, x, z, size: 1 } : undefined;
    }
    if (key.startsWith('r:')) {
      const [roofId, xz] = key.slice(2).split(':');
      const [x, z] = xz.split(',').map(Number);
      return { key, kind: 'ruin', roofId, x, z, size: 1 };
    }
    return this.lines().find((l) => l.key === key);
  }

  // ───────────── placing ─────────────

  /** Why a kind can't grow on a host now, if it can't. */
  problem(kind: OvergrowthKind, host: Host | undefined): string | undefined {
    const def = OVERGROWTH_BY_ID[kind];
    if (!def || !this.sim.state.salvage) return 'Unknown plant';
    if (!host) return 'Nothing here for it to grow on';
    if (!def.hosts.includes(host.kind)) return `${def.name} doesn't grow there`;
    if (!this.sim.crafting.unlocked(def.unlock)) return `${def.name} is not known yet`;
    if (this.at(host.key)) return 'Something already grows here';
    const short = this.sim.inventory.shortfall(def.cost);
    if (short) return `Needs ${short === 'biomass' ? 'Greens' : itemDef(short).name}`;
    return undefined;
  }

  /** Plants a kind on a host, paying its cost. Returns why not, or undefined. */
  place(kind: OvergrowthKind, host: Host | undefined): string | undefined {
    const why = this.problem(kind, host);
    if (why) return why;
    if (!this.sim.inventory.pay(OVERGROWTH_BY_ID[kind].cost)) return 'Could not pay for it';
    const sv = this.sim.state.salvage!;
    const og = { ...(sv.overgrowth ?? {}), [host!.key]: { kind, t0: this.sim.time } };
    sv.overgrowth = Object.fromEntries(Object.keys(og).sort().map((k) => [k, og[k]])); // sorted: byte-identical saves
    this.sim.bus.emit('overgrowth.changed', { key: host!.key });
    return undefined;
  }

  /** Takes the overgrowth off a host; its cost comes back whole. */
  remove(key: string): Growth | undefined {
    const sv = this.sim.state.salvage;
    const g = sv?.overgrowth?.[key];
    if (!sv || !g) return undefined;
    delete sv.overgrowth![key];
    if (!Object.keys(sv.overgrowth!).length) delete sv.overgrowth;
    this.sim.inventory.refund(OVERGROWTH_BY_ID[g.kind].cost);
    this.sim.bus.emit('overgrowth.changed', { key });
    return g;
  }

  /** Overgrowth whose host has gone (a machine taken down): it comes back to bloombot. */
  tidy() {
    for (const key of Object.keys(this.st ?? {})) if (!this.host(key)) this.remove(key);
  }

  // ───────────── diversity ─────────────

  /** The kinds growing in an area (plant variety for its diversity, E23.2.4). */
  kindsIn(areaId: string): OvergrowthKind[] {
    const out = new Set<OvergrowthKind>();
    for (const [key, g] of Object.entries(this.all())) {
      const h = this.host(key);
      if (h && h.roofId === GROUND && this.sim.areas.areaOf({ roofId: GROUND, x: h.x, z: h.z }) === areaId) out.add(g.kind);
    }
    return [...out];
  }

  /** Every kind growing anywhere (the island's plant variety). */
  kinds(): OvergrowthKind[] {
    return [...new Set(Object.values(this.all()).map((g) => g.kind))];
  }
}
