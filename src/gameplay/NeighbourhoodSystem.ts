import { formatCost } from '../core/Economy';
import { isRestorable } from '../core/GameState';
import type { Cost, LinkState } from '../core/types';
import { LINK_BY_ID, LINKS, ROOF_BY_ID, ROOFTOPS, type RoofLinkDef } from '../data/rooftops';
import { MACHINES } from '../data/machines';
import { TUNING } from '../data/tuning';
import type { Requirement } from './ProgressionSystem';
import type { Sim } from './Sim';

const N = TUNING.neighbourhood;

/** What the objective panel shows after the Seed's Core wakes: one clear next goal at a time. */
export interface HoodObjective {
  step: 'link1' | 'core2' | 'link2' | 'core3' | 'bloom' | 'done';
  title: string;
  roofId: string;
  items: Requirement[];
  action?: { kind: 'link' | 'core' | 'bloom' | 'replay'; id: string; label: string; ok: boolean; reason?: string };
}

/**
 * Phase 3 progression across rooftops: bridges (links), relays, the Reservoir and Canopy Cores, and
 * the one-time Neighbourhood Bloom. All costs/thresholds come from TUNING.neighbourhood and data/rooftops.
 */
export class NeighbourhoodSystem {
  constructor(private sim: Sim) {}

  link(id: string): LinkState | undefined {
    return this.sim.state.links[id];
  }

  isBuilt(id: string) {
    return !!this.sim.state.links[id]?.built;
  }

  builtLinks(): RoofLinkDef[] {
    return LINKS.filter((l) => this.isBuilt(l.id));
  }

  /** Links touching a rooftop that are built (for relays, drone dispatch, focus). */
  linksOf(roofId: string): RoofLinkDef[] {
    return this.builtLinks().filter((l) => l.from === roofId || l.to === roofId);
  }

  coreAwake(roofId: string) {
    const p = this.sim.state.progression;
    return roofId === 'r1' ? p.coreActivated : !!p.cores?.[roofId];
  }

  /** The link can be built now (its prerequisite Core is awake). Costs are checked separately. */
  linkAvailable(id: string) {
    const l = LINK_BY_ID[id];
    return !!l && !this.isBuilt(id) && this.coreAwake(l.requiresCore);
  }

  linkCost(id: string): Cost {
    return { ...LINK_BY_ID[id].cost };
  }

  linkStatus(id: string): { ok: boolean; reason?: string; cost: Cost } {
    const l = LINK_BY_ID[id];
    const cost = this.linkCost(id);
    if (!l) return { ok: false, reason: 'Unknown bridge', cost };
    if (this.isBuilt(id)) return { ok: false, reason: 'Already built', cost };
    if (!this.coreAwake(l.requiresCore)) return { ok: false, reason: `Awaken the ${this.coreName(l.requiresCore)} first`, cost };
    const fb = this.bloomMilestone(id);
    if (fb && fb.have < fb.need) return { ok: false, reason: `Grow ${fb.need} tiles on ${fb.roofName} to full bloom (${fb.have}/${fb.need})`, cost };
    const e = this.sim.econ;
    const tooBig = (Object.keys(cost) as (keyof Cost)[]).find((k) => (cost[k] ?? 0) > e.cap(k));
    if (tooBig) return { ok: false, reason: 'Needs more storage — try Seed Vault', cost };
    if (!e.canAfford(cost)) return { ok: false, reason: `Need ${formatCost(cost)}`, cost };
    return { ok: true, cost };
  }

  /** Builds a bridge + relay: the far rooftop becomes playable. Never resets anything. */
  buildLink(id: string): boolean {
    const s = this.sim;
    const st = this.linkStatus(id);
    if (!st.ok) {
      s.bus.emit('action.failed', { reason: st.reason ?? 'Unavailable' });
      return false;
    }
    s.econ.spend(st.cost);
    const l = LINK_BY_ID[id];
    s.state.links[id] = { built: true, builtAt: s.time, readyAt: s.time, crossings: 0 };
    for (const roofId of [l.from, l.to]) {
      const r = s.grid.roof(roofId);
      if (r) {
        r.unlocked = true;
        r.preview = false;
      }
    }
    s.upgrades.applyCaps();
    s.production.markDirty();
    s.bus.emit('link.built', { linkId: id, roofId: l.to });
    return true;
  }

  /** A link's full-bloom milestone, counted over the near roof's open garden tiles. */
  bloomMilestone(id: string): { roofId: string; roofName: string; have: number; need: number } | undefined {
    const fb = LINK_BY_ID[id]?.requiresFullBloom;
    if (!fb) return undefined;
    const r = this.sim.grid.roof(fb.roofId);
    if (!r) return undefined;
    const open = r.tiles.filter((t) => isRestorable(t, this.sim.state.machines) && !t.occupantId);
    const have = open.filter((t) => t.ground === 'restored' && t.bloom >= TUNING.restore.maxBloom).length;
    return { roofId: fb.roofId, roofName: r.name, have, need: Math.max(1, Math.ceil(open.length * fb.share)) };
  }

  // ───────────── relays ─────────────

  relayCooldown() {
    return this.sim.upgrades.level('relay2') > 0 ? N.relay.cooldownRelay2 : N.relay.cooldown;
  }

  relayTargets() {
    return this.sim.upgrades.level('relay2') > 0 ? N.relay.targetsRelay2 : N.relay.targets;
  }

  relayReady(id: string) {
    const l = this.link(id);
    return !!l?.built && this.sim.time >= l.readyAt - 1e-9;
  }

  // ───────────── rooftop cores (Reservoir, Canopy) ─────────────

  coreName(roofId: string) {
    return roofId === 'r1' ? 'Rooftop Core' : roofId === 'r2' ? 'Old Cistern' : roofId === 'r3' ? 'Elder Tree' : 'Core';
  }

  restoredCount(roofId: string) {
    return this.sim.progression.restoredCount(roofId);
  }

  restorableCount(roofId: string) {
    return this.sim.progression.restorableCount(roofId);
  }

  coreCost(roofId: string): Cost {
    if (roofId === 'r2') return { ...N.cores.r2.cost };
    if (roofId === 'r3') return { ...N.cores.r3.cost };
    return { ...TUNING.core.cost };
  }

  requirements(roofId: string): Requirement[] {
    const s = this.sim;
    const n = this.restoredCount(roofId);
    if (roofId === 'r2') {
      const c = N.cores.r2;
      const gardens = s.state.machines.some((m) => m.type === 'reservoirGarden' && m.roofId === 'r2');
      const ov = s.state.progression.overflows ?? 0;
      return [
        { label: `Restore Reservoir tiles ${Math.min(n, c.restoredTiles)}/${c.restoredTiles}`, done: n >= c.restoredTiles },
        { label: `Build a ${MACHINES.reservoirGarden.name}`, done: gardens },
        { label: `Trigger a Reservoir Overflow ${Math.min(ov, c.overflows)}/${c.overflows}`, done: ov >= c.overflows },
      ];
    }
    if (roofId === 'r3') {
      const c = N.cores.r3;
      const b = s.state.progression.canopyBursts ?? 0;
      return [
        { label: `Restore Canopy tiles ${Math.min(n, c.restoredTiles)}/${c.restoredTiles}`, done: n >= c.restoredTiles },
        { label: `Release Canopy Bursts ${Math.min(b, c.bursts)}/${c.bursts}`, done: b >= c.bursts },
      ];
    }
    return s.progression.requirements();
  }

  coreReady(roofId: string) {
    if (roofId === 'r1') return this.sim.progression.coreReady();
    return this.sim.grid.isPlayable(roofId) && !this.coreAwake(roofId) && this.requirements(roofId).every((r) => r.done);
  }

  activateRoofCore(roofId: string): boolean {
    const s = this.sim;
    if (roofId === 'r1') return s.progression.activateCore();
    if (this.coreAwake(roofId)) return false;
    if (!this.coreReady(roofId)) {
      s.bus.emit('action.failed', { reason: `The ${this.coreName(roofId)} is still dormant — check the objective list` });
      return false;
    }
    const cost = this.coreCost(roofId);
    if (!s.econ.spend(cost)) {
      s.bus.emit('action.failed', { reason: `Awakening needs ${formatCost(cost)}` });
      return false;
    }
    s.state.progression.cores = { ...s.state.progression.cores, [roofId]: true };
    s.production.markDirty();
    // The next bridge (if any) is revealed.
    for (const l of LINKS) if (l.requiresCore === roofId) {
      const r = s.grid.roof(l.to);
      if (r) r.unlocked = true;
    }
    s.bus.emit('roof.coreAwake', { roofId });
    return true;
  }

  // ───────────── Neighbourhood Bloom ─────────────

  allCoresAwake() {
    return ROOFTOPS.every((r) => !r.core || this.coreAwake(r.id));
  }

  bloomReady() {
    return this.allCoresAwake() && LINKS.every((l) => this.isBuilt(l.id)) && this.sim.state.progression.neighbourhoodBloomAt < 0;
  }

  /** One-time reward + the city-wide bloom. Restores leftover dead ground but never touches machines. */
  neighbourhoodBloom(): boolean {
    const s = this.sim;
    if (!this.bloomReady()) {
      if (s.state.progression.neighbourhoodBloomAt >= 0) return false;
      s.bus.emit('action.failed', { reason: 'Awaken all three rooftop Cores and build both bridges first' });
      return false;
    }
    s.state.progression.neighbourhoodBloomAt = s.time; // claimed first: reloading can never pay twice
    const restored: string[] = [];
    for (const r of s.state.rooftops) {
      if (!s.grid.isPlayable(r.id)) continue;
      for (const t of r.tiles) {
        if (!isRestorable(t, s.state.machines) || t.occupantId) continue;
        if (t.ground === 'restored') continue;
        t.ground = 'restored';
        t.bloom = Math.max(1, t.bloom);
        t.pollution = 0;
        t.growthRemainingSec = 0;
        t.growSource = undefined;
        restored.push(t.id);
      }
    }
    s.state.stats.tilesRestored += restored.length;
    s.upgrades.applyCaps();
    const got: Cost = {};
    for (const k of ['energy', 'water', 'biomass'] as const) got[k] = s.econ.add(k, N.bloom.reward[k]);
    s.production.markDirty();
    s.bus.emit('neighbourhood.bloom', { restored, reward: got });
    return true;
  }

  /** Extra storage from unlocked rooftops and the Neighbourhood Bloom (added to Seed Vault's share). */
  capBonus(): number {
    const s = this.sim;
    const extraRoofs = ROOFTOPS.filter((r) => r.id !== 'r1' && s.grid.isPlayable(r.id)).length;
    return extraRoofs * N.roofCapBonus + (s.state.progression.neighbourhoodBloomAt >= 0 ? N.bloom.capBonus : 0);
  }

  objective(): HoodObjective {
    const link = (id: string, title: string, roofId: string): HoodObjective => {
      const st = this.linkStatus(id);
      const l = LINK_BY_ID[id];
      const fbm = this.bloomMilestone(id);
      const milestoneOpen = !!fbm && fbm.have < fbm.need;
      return {
        step: id === 'seed-reservoir' ? 'link1' : 'link2',
        title,
        roofId: milestoneOpen ? fbm!.roofId : roofId,
        items: [
          ...(fbm ? [{ label: `Grow ${fbm.roofName} tiles to full bloom ${Math.min(fbm.have, fbm.need)}/${fbm.need}`, done: fbm.have >= fbm.need }] : []),
          { label: `Build the ${l.name} (${formatCost(st.cost)})`, done: false },
        ],
        action: { kind: 'link', id, label: `🌉 Build the ${l.name} · ${formatCost(st.cost)}`, ok: st.ok, reason: st.reason },
      };
    };
    const core = (roofId: string, title: string): HoodObjective => {
      const ready = this.coreReady(roofId);
      return {
        step: roofId === 'r2' ? 'core2' : 'core3',
        title,
        roofId,
        items: this.requirements(roofId),
        action: ready ? { kind: 'core', id: roofId, label: `✨ Awaken the ${this.coreName(roofId)} · ${formatCost(this.coreCost(roofId))}`, ok: this.sim.econ.canAfford(this.coreCost(roofId)) } : undefined,
      };
    };
    if (!this.isBuilt('seed-reservoir')) return link('seed-reservoir', '🌉 Reach the Reservoir', 'r2');
    if (!this.coreAwake('r2')) return core('r2', '💧 Wake the Old Cistern');
    if (!this.isBuilt('seed-canopy')) return link('seed-canopy', '🌉 Reach the Canopy', 'r3');
    if (!this.coreAwake('r3')) return core('r3', '🌳 Wake the Elder Tree');
    if (this.bloomReady())
      return {
        step: 'bloom',
        title: '🌸 The Neighbourhood Bloom',
        roofId: 'r1',
        items: [{ label: 'Every rooftop is awake and connected', done: true }],
        action: { kind: 'bloom', id: 'bloom', label: '🌸 Activate the Neighbourhood Bloom', ok: true },
      };
    const full = ROOFTOPS.reduce((a, r) => a + this.sim.progression.fullBloomCount(r.id), 0);
    const total = ROOFTOPS.reduce((a, r) => a + this.restorableCount(r.id), 0);
    return {
      step: 'done',
      title: '✨ The neighbourhood lives',
      roofId: 'r1',
      items: [
        { label: 'Neighbourhood Bloom', done: true },
        { label: `Grow every tile to full bloom (${full}/${total})`, done: full >= total },
        { label: 'A new district glows on the horizon…', done: false },
      ],
      action: { kind: 'replay', id: 'replay', label: '🎬 Replay the Neighbourhood Bloom', ok: true },
    };
  }

  roofDef(id: string) {
    return ROOF_BY_ID[id];
  }
}
