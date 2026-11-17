import { ceilBig, Decimal } from '../core/Big';
import { formatCost } from '../core/Economy';
import { machinesRemoved } from '../core/GameState';
import type { Cost, MachineData, TileData } from '../core/types';
import { MAX_MERGE_TIER, isMergeable, machineName, tierOf } from '../data/machines';
import { TUNING } from '../data/tuning';
import { UPGRADES } from '../data/upgrades';
import type { Sim } from './Sim';

/**
 * Phase 5 E13: merging. Three tier-1 machines of one type whose footprints touch edge to edge (diagonal contact
 * alone doesn't count) become one tier-2 machine on the anchor's footprint. The other two footprints are freed;
 * the tiles underneath keep their restoration and bloom.
 *
 * A merge is planned (preview) and then committed as one transaction. The commit re-validates everything, so a
 * stale preview (a partner gone, moved tier, or unaffordable) and a repeated tap change nothing.
 *
 * Rules agreed for E13: starter machines never merge; the merged machine keeps the highest level of each upgrade
 * among the three (the preview lists what's lost); the first merge of each type is free, later ones cost about
 * 20 s of steady biomass income; prices of new machines count lifetime builds, so merging never makes building
 * cheaper. Tier 2 is the top until E14 adds superstructures.
 */

export interface LostLevels {
  upgrade: string;
  name: string;
  /** level kept on the merged machine */
  kept: number;
  /** levels on the other machines that disappear */
  lost: number[];
}

export interface MergePlan {
  ok: boolean;
  reason?: string;
  anchor: MachineData;
  /** the two machines that merge into the anchor */
  partners: MachineData[];
  /** E18.8: Drone Hubs: the merged hub's role slots (a core keeps slot 1 for the Megahub) */
  roles?: { slot1: import('../core/types').DroneRole; slot2?: import('../core/types').DroneRole; owned: import('../core/types').DroneRole[] };
  /** every machine the anchor could merge with (connected, same type and tier): tap one to swap it in */
  options: MachineData[];
  fee: Cost;
  free: boolean;
  fromName: string;
  toName: string;
  /** output index: three tier-1 machines = 3, the tier 2 = TUNING.merge.solarMult */
  before: number;
  after: number;
  lost: LostLevels[];
  /** Phase 5 E14: three tier 2s make a Superstructure Core (all three leave the grid; the core is placed later) */
  core: boolean;
  /** tiles freed (the partners' footprints; all three for a core) */
  freed: TileData[];
  /** identifies this exact merge for commit (anchor, partners, tiers) */
  key: string;
}

/** Footprints share an edge (not just a corner). */
export function edgeAdjacent(a: MachineData, b: MachineData): boolean {
  if (a.roofId !== b.roofId) return false;
  const overlapX = a.x < b.x + b.size && b.x < a.x + a.size;
  const overlapZ = a.z < b.z + b.size && b.z < a.z + a.size;
  return (overlapX && (a.z + a.size === b.z || b.z + b.size === a.z)) || (overlapZ && (a.x + a.size === b.x || b.x + b.size === a.x));
}

/** Three machines form one orthogonally connected cluster. */
function connected3(a: MachineData, b: MachineData, c: MachineData): boolean {
  const ab = edgeAdjacent(a, b), ac = edgeAdjacent(a, c), bc = edgeAdjacent(b, c);
  return (ab ? 1 : 0) + (ac ? 1 : 0) + (bc ? 1 : 0) >= 2;
}

export class MergeSystem {
  constructor(private sim: Sim) {}

  /** Can this machine take part in a merge at all (type, tier, not a starter)? */
  canMerge(m: MachineData | undefined): boolean {
    return !!m && isMergeable(m.type) && !m.starter && tierOf(m) <= MAX_MERGE_TIER && !m.project;
  }

  private sameKind(a: MachineData, b: MachineData) {
    return a.type === b.type && tierOf(a) === tierOf(b) && a.roofId === b.roofId;
  }

  /** Mergeable machines touching this one edge to edge. */
  neighbours(m: MachineData): MachineData[] {
    const out: MachineData[] = [];
    for (const o of this.sim.grid.machinesNear(m.roofId, m.x, m.z, m.size + 1))
      if (o !== m && this.canMerge(o) && this.sameKind(m, o) && edgeAdjacent(m, o) && !out.includes(o)) out.push(o);
    return out;
  }

  /** Every machine reachable from the anchor through same-kind edge contacts (the anchor first). */
  cluster(anchor: MachineData, limit = 64): MachineData[] {
    const out = [anchor];
    const seen = new Set([anchor.id]);
    for (let i = 0; i < out.length && out.length < limit; i++)
      for (const n of this.neighbours(out[i]))
        if (!seen.has(n.id)) {
          seen.add(n.id);
          out.push(n);
        }
    return out;
  }

  /**
   * Placement guidance: how many tier-1 machines of this type would form one connected group if one were placed
   * here (itself included). 3 or more means a merge becomes possible.
   */
  groupIfPlaced(type: MachineData['type'], roofId: string, x: number, z: number, size: number): number {
    if (!isMergeable(type)) return 0;
    const ghost: MachineData = { id: '?', type, roofId, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
    const seen = new Set<string>();
    for (const o of this.sim.grid.machinesNear(roofId, x, z, size + 1))
      if (this.canMerge(o) && o.type === type && tierOf(o) === 1 && edgeAdjacent(ghost, o) && !seen.has(o.id)) for (const c of this.cluster(o, 8)) seen.add(c.id);
    return 1 + seen.size;
  }

  /**
   * Pacing pass: core guidance. How many tier-2 machines of this type a footprint here would touch, counting the
   * whole connected group of tier 2s it joins (0 if none). Three touching tier 2s merge into a superstructure core.
   */
  tier2Beside(type: MachineData['type'], roofId: string, x: number, z: number, size: number): number {
    if (!isMergeable(type) || MAX_MERGE_TIER < 2) return 0;
    const ghost: MachineData = { id: '?', type, roofId, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
    const seen = new Set<string>();
    for (const o of this.sim.grid.machinesNear(roofId, x, z, size + 1))
      if (this.canMerge(o) && o.type === type && tierOf(o) === 2 && edgeAdjacent(ghost, o) && !seen.has(o.id)) for (const c of this.cluster(o, 8)) seen.add(c.id);
    return seen.size;
  }

  /** True if the machine is in a cluster of at least three (for highlights and the advisor). */
  hasMerge(m: MachineData): boolean {
    if (!this.canMerge(m)) return false;
    const n = this.neighbours(m);
    if (n.length >= 2) return true;
    return n.length === 1 && this.neighbours(n[0]).length >= 2;
  }

  /** Clusters ready to merge, one representative each (advisor, highlights). */
  ready(limit = 8): MachineData[][] {
    const out: MachineData[][] = [];
    const seen = new Set<string>();
    for (const m of this.sim.state.machines) {
      if (seen.has(m.id) || !this.canMerge(m)) continue;
      const c = this.cluster(m);
      for (const x of c) seen.add(x.id);
      if (c.length >= TUNING.merge.count) {
        out.push(c);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /** The two partners nearest the anchor that keep the three connected. */
  private autoPartners(anchor: MachineData): MachineData[] {
    const d = (m: MachineData) => Math.hypot(m.x + m.size / 2 - anchor.x - anchor.size / 2, m.z + m.size / 2 - anchor.z - anchor.size / 2);
    const first = this.neighbours(anchor).sort((a, b) => d(a) - d(b) || (a.id < b.id ? -1 : 1));
    if (!first.length) return [];
    const b = first[0];
    const second = [...first.slice(1), ...this.neighbours(b)].filter((m) => m !== anchor && m !== b);
    second.sort((x, y) => d(x) - d(y) || (x.id < y.id ? -1 : 1));
    return second.length ? [b, second[0]] : [b];
  }

  /** Merge counter key: per type for tier 1 → 2, per type and tier above (the first of each is free). */
  static countKey(type: MachineData['type'], fromTier: number) {
    return fromTier <= 1 ? type : `${type}:${fromTier}`;
  }

  /** The fee for the next merge of this type and tier (free for the first). */
  fee(type: MachineData['type'], fromTier = 1): { fee: Cost; free: boolean } {
    const s = this.sim;
    if (!(s.state.stats.merges?.[MergeSystem.countKey(type, fromTier)] ?? 0)) return { fee: {}, free: true };
    const rate = s.production.rates(true).biomass;
    const v = Decimal.max(TUNING.merge.minFee, ceilBig(rate.mul(TUNING.merge.feeSeconds)));
    return { fee: { biomass: v }, free: false };
  }

  /**
   * The merge the anchor would make. `partners` (two ids) picks them; otherwise the two nearest connected ones.
   * Always returns a plan; `ok` says whether it can be committed now.
   */
  plan(anchorId: string, partnerIds?: string[]): MergePlan | undefined {
    const s = this.sim;
    const anchor = s.machine(anchorId);
    if (!anchor) return undefined;
    const fail = (reason: string, partners: MachineData[] = [], options: MachineData[] = []): MergePlan => ({
      ok: false,
      reason,
      anchor,
      partners,
      options,
      fee: {},
      free: false,
      fromName: machineName(anchor),
      toName: machineName({ type: anchor.type, tier: tierOf(anchor) + 1 }),
      core: tierOf(anchor) >= MAX_MERGE_TIER,
      before: 0,
      after: 0,
      lost: [],
      freed: [],
      key: '',
    });
    if (!isMergeable(anchor.type)) return fail(`${machineName(anchor)}s don't merge`);
    if (anchor.starter) return fail('The starter machine stays as it is');
    if (anchor.project || tierOf(anchor) > MAX_MERGE_TIER) return fail(`${machineName(anchor)} is a superstructure: the top tier`);
    const options = this.cluster(anchor).slice(1);
    let partners: MachineData[];
    if (partnerIds) {
      partners = partnerIds.map((id) => s.machine(id)).filter((m): m is MachineData => !!m);
      if (partners.length !== 2 || new Set(partnerIds).size !== 2 || partnerIds.includes(anchor.id)) return fail('Pick two other machines', partners, options);
      if (!partners.every((p) => this.canMerge(p) && this.sameKind(anchor, p))) return fail(`All three must be ${machineName(anchor)}s`, partners, options);
      if (!connected3(anchor, partners[0], partners[1])) return fail('The three must touch edge to edge (corners don’t count)', partners, options);
    } else partners = this.autoPartners(anchor);
    if (partners.length < 2) return fail(`Place ${TUNING.merge.count} ${machineName(anchor)}s touching edge to edge to merge them`, partners, options);
    const { fee, free } = this.fee(anchor.type, tierOf(anchor));
    const core = tierOf(anchor) >= MAX_MERGE_TIER;
    // Upgrade levels: the merged machine keeps the highest of each; the rest are listed as lost.
    const lost: LostLevels[] = [];
    const all = [anchor, ...partners];
    for (const u of UPGRADES) {
      if (u.machine !== anchor.type) continue;
      const lv = all.map((m) => m.upg?.[u.id] ?? 0);
      const kept = Math.max(...lv);
      if (!kept) continue;
      const rest = [...lv];
      rest.splice(rest.indexOf(kept), 1);
      const gone = rest.filter((x) => x > 0);
      if (gone.length) lost.push({ upgrade: u.id, name: u.name, kept, lost: gone });
    }
    const freed: TileData[] = [];
    for (const p of core ? [anchor, ...partners] : partners) for (const t of s.grid.footprint(p.roofId, p.x, p.z, p.size)) if (t) freed.push(t);
    const plan: MergePlan = {
      ok: true,
      anchor,
      partners,
      options,
      fee,
      free,
      fromName: machineName(anchor),
      toName: machineName({ type: anchor.type, tier: tierOf(anchor) + 1 }),
      core,
      // Output index: tier 1 = 1, tier 2 = 4, tier 3 = 18.
      before: TUNING.merge.count * (core ? TUNING.merge.solarMult : 1),
      after: core ? TUNING.super.outputMult : TUNING.merge.solarMult,
      lost,
      freed,
      ...(anchor.type === 'droneHub' ? { roles: s.roles.mergeRoles(anchor, partners) } : {}),
      key: `${anchor.id}>${tierOf(anchor)}|${partners.map((p) => `${p.id}>${tierOf(p)}`).sort().join(',')}`,
    };
    if (!s.econ.canAfford(fee)) return { ...plan, ok: false, reason: `Need ${formatCost(fee)}` };
    return plan;
  }

  /** Swaps a tapped machine into the plan, keeping the three connected (returns the new partner ids). */
  swap(plan: MergePlan, tappedId: string): string[] | undefined {
    const t = this.sim.machine(tappedId);
    if (!t || t === plan.anchor || plan.partners.includes(t) || !plan.options.includes(t)) return undefined;
    const [p0, p1] = plan.partners;
    if (p1 && connected3(plan.anchor, p0, t)) return [p0.id, t.id];
    if (p0 && p1 && connected3(plan.anchor, p1, t)) return [p1.id, t.id];
    // Not reachable with either current partner: the tapped one plus whichever neighbour links it.
    const link = this.neighbours(t).find((n) => n !== plan.anchor && this.sameKind(plan.anchor, n) && connected3(plan.anchor, n, t));
    return link ? [link.id, t.id] : undefined;
  }

  /**
   * Commits a previewed merge as one transaction. `key` must match a fresh plan for the same machines; the fee
   * charged never exceeds the one previewed. Returns the merged machine, or undefined (nothing changed).
   */
  commit(anchorId: string, partnerIds: string[], key: string, previewFee?: Cost): MachineData | undefined {
    const s = this.sim;
    const plan = this.plan(anchorId, partnerIds);
    if (!plan || !plan.ok || plan.key !== key) {
      s.bus.emit('action.failed', { reason: plan?.reason ?? 'That merge is no longer possible' });
      return undefined;
    }
    let fee = plan.fee;
    if (previewFee?.biomass !== undefined && fee.biomass !== undefined && new Decimal(previewFee.biomass).lt(fee.biomass)) fee = { biomass: previewFee.biomass };
    if (!s.econ.spend(fee)) {
      s.bus.emit('action.failed', { reason: `Need ${formatCost(fee)}` });
      return undefined;
    }
    const { anchor, partners } = plan;
    s.build.ensureBuiltCounts(); // prices keep counting the merged-away copies
    // Upgrades: highest level of each.
    const upg: Record<string, number> = { ...(anchor.upg ?? {}) };
    for (const p of partners) for (const [k, v] of Object.entries(p.upg ?? {})) upg[k] = Math.max(upg[k] ?? 0, v);
    // Free the partners' footprints (tiles keep their state), their index entries and drones. A core merge takes
    // the anchor too: the three become a stored Superstructure Core (placed later, so a merge never needs room).
    const leaving = plan.core ? [anchor, ...partners] : partners;
    const gone = new Set(leaving.map((p) => p.id));
    for (const p of leaving) {
      for (const t of s.grid.footprint(p.roofId, p.x, p.z, p.size)) if (t && t.occupantId === p.id) t.occupantId = undefined;
      s.grid.unindexMachine(p);
      s.drones.removeHub(p.id);
    }
    s.state.machines = s.state.machines.filter((m) => !gone.has(m.id));
    machinesRemoved();
    const stats = s.state.stats;
    const ck = MergeSystem.countKey(anchor.type, tierOf(anchor));
    stats.merges = { ...(stats.merges ?? {}), [ck]: (stats.merges?.[ck] ?? 0) + 1 };
    if (plan.core) {
      // E18.8: a hub core keeps slot 1's role and every refit for the Megahub.
      const r = plan.roles;
      const roles = r && (r.slot1 !== 'restorer' || r.owned.length) ? { ...(r.slot1 !== 'restorer' ? { role: r.slot1 } : {}), ...(r.owned.length ? { roles: r.owned } : {}) } : {};
      s.state.cores = [...(s.state.cores ?? []), { type: anchor.type, ...(Object.keys(upg).length ? { upg } : {}), ...roles }];
      s.upgrades.version++;
      for (const m of leaving) s.production.markNear(m.roofId, m.x, m.z, m.size);
      s.production.markDirty();
      if (stats.firsts.firstCore === undefined) stats.firsts.firstCore = s.time;
      s.bus.emit('core.created', { type: anchor.type, consumed: leaving, fee, lost: plan.lost });
      return anchor;
    }
    anchor.tier = tierOf(anchor) + 1;
    if (Object.keys(upg).length) anchor.upg = upg;
    if (plan.roles) {
      // E18.8: a Fleet Hub has two role slots; refits owned by any of the three carry over.
      if (plan.roles.owned.length) anchor.roles = plan.roles.owned;
      if (plan.roles.slot2) anchor.role2 = plan.roles.slot2;
    }
    anchor.charge = Math.max(anchor.charge, ...partners.map((p) => p.charge));
    anchor.boostUntil = Math.max(anchor.boostUntil, ...partners.map((p) => p.boostUntil));
    s.upgrades.version++; // per-machine caches (drone reach, production sums)
    for (const m of [anchor, ...partners]) s.production.markNear(m.roofId, m.x, m.z, m.size);
    s.production.markDirty();
    if (stats.firsts.firstMerge === undefined) stats.firsts.firstMerge = s.time;
    s.bus.emit('machine.merged', { machine: anchor, consumed: partners, fee, lost: plan.lost });
    return anchor;
  }
}
