import type { CatRewardType } from '../core/types';
import { CAT_ANCHORS, type CatAnchor } from '../data/rooftops';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

export interface CatReward {
  type: CatRewardType;
  summary: string;
}

export const CAT_REWARD_NAMES: Record<CatRewardType, string> = {
  luckyHarvest: 'Lucky Harvest',
  solarFrenzy: 'Solar Frenzy',
  megaBloom: 'Mega Bloom',
  droneParty: 'Drone Party',
  jackpot: 'JACKPOT',
};

/**
 * Hidden Lucky Cat: spawning, claiming and rewards. Visual hiding/VFX live in the renderer.
 * `isAnchorVisible` can be injected by the renderer to veto anchors that are off-screen or under HUD.
 */
export class LuckyCatSystem {
  isAnchorVisible: (a: CatAnchor) => boolean = () => true;

  constructor(private sim: Sim) {}

  anchor(id: string | undefined): CatAnchor | undefined {
    return CAT_ANCHORS.find((a) => a.id === id);
  }

  candidates(): CatAnchor[] {
    const s = this.sim;
    return CAT_ANCHORS.filter((a) => {
      const roof = s.grid.roof(a.roofId);
      if (!roof || !roof.unlocked || roof.preview) return false;
      if (a.needsFreeTile) {
        const t = s.grid.get(a.roofId, a.needsFreeTile[0], a.needsFreeTile[1]);
        if (!t || t.occupantId) return false;
      }
      return this.isAnchorVisible(a);
    });
  }

  restoredCount() {
    return this.sim.progression.restoredCount('r1');
  }

  tick() {
    const c = this.sim.state.cat;
    const t = this.sim.time;
    if (c.active) return;
    if (!c.firstSpawned) {
      const ready = (t >= TUNING.cat.firstMinTime && this.restoredCount() >= TUNING.cat.firstMinRestored) || t >= TUNING.cat.firstForceTime;
      if (ready) this.spawn();
    } else if (c.nextSpawnAt >= 0 && t >= c.nextSpawnAt) {
      this.spawn();
    }
  }

  spawn(anchorId?: string): boolean {
    const c = this.sim.state.cat;
    if (c.active) return false;
    const cands = this.candidates();
    const a = anchorId ? cands.find((x) => x.id === anchorId) : cands.length ? this.sim.rng.pick(cands) : undefined;
    if (!a) {
      c.nextSpawnAt = this.sim.time + 10;
      return false;
    }
    c.active = { anchorId: a.id, spawnedAt: this.sim.time };
    c.firstSpawned = true;
    c.nextSpawnAt = -1;
    this.sim.bus.emit('cat.spawned', { anchorId: a.id });
    return true;
  }

  /** Summary for the discovery panel. */
  discoveries() {
    const log = this.sim.state.cat.log ?? [];
    const spots = new Set(log.map((e) => e.anchorId));
    const rewards: Partial<Record<CatRewardType, number>> = {};
    for (const e of log) rewards[e.reward] = (rewards[e.reward] ?? 0) + 1;
    return {
      found: this.sim.state.cat.found,
      anchors: CAT_ANCHORS.filter((a) => this.sim.grid.roof(a.roofId)).map((a) => ({ id: a.id, hint: a.hint, found: spots.has(a.id) })),
      rewards,
    };
  }

  rollReward(): CatRewardType {
    const hasHub = this.sim.state.machines.some((m) => m.type === 'droneHub');
    const table: [CatRewardType, number][] = [
      ['luckyHarvest', 35],
      ['solarFrenzy', 30],
      ['megaBloom', 20],
      ['droneParty', hasHub ? 10 : 0],
      ['jackpot', 5],
    ];
    const total = table.reduce((a, [, w]) => a + w, 0);
    let r = this.sim.rng.next() * total;
    for (const [type, w] of table) {
      if ((r -= w) < 0) return type;
    }
    return 'luckyHarvest';
  }

  /** Claims the active cat exactly once. Returns undefined if there is no cat. */
  claim(): CatReward | undefined {
    const s = this.sim;
    const c = s.state.cat;
    const active = c.active;
    if (!active) return undefined;
    c.active = undefined; // clear first: a second click can never pay twice
    const first = c.found === 0;
    c.found++;
    s.state.stats.catsFound++;
    const hidden = Math.min(1, (s.time - active.spawnedAt) / TUNING.cat.hiddenBonusCapSec);
    const mult = 1 + TUNING.cat.hiddenBonusMax * hidden;
    const type: CatRewardType = first ? 'luckyHarvest' : this.rollReward();
    const summary = this.apply(type, mult);
    c.lastReward = type;
    c.log = [...(c.log ?? []), { anchorId: active.anchorId, reward: type, at: s.time }];
    c.nextSpawnAt = s.time + s.rng.range(TUNING.cat.laterMin, TUNING.cat.laterMax);
    s.bus.emit('cat.found', { anchorId: active.anchorId, reward: type, summary });
    return { type, summary };
  }

  private apply(type: CatRewardType, mult: number): string {
    const s = this.sim;
    const parts: string[] = [];
    const harvest = () => {
      const rate = s.production.rates().biomass;
      const amt = Math.max(TUNING.cat.harvestMin, rate * TUNING.cat.harvestSeconds) * mult;
      const got = s.econ.add('biomass', amt);
      const w = s.econ.add('water', 10 * mult);
      const e = s.econ.add('energy', 15 * mult);
      if (got) s.bus.emit('resource.gain', { kind: 'biomass', amount: got, reason: 'cat' });
      if (w) s.bus.emit('resource.gain', { kind: 'water', amount: w, reason: 'cat' });
      if (e) s.bus.emit('resource.gain', { kind: 'energy', amount: e, reason: 'cat' });
      parts.push(`+${Math.floor(got)}🌿 +${Math.floor(w)}💧 +${Math.floor(e)}⚡`);
    };
    const frenzy = () => {
      const secs = TUNING.cat.frenzySeconds * mult;
      const existing = s.state.buffs.find((b) => b.type === 'solarFrenzy');
      if (existing) existing.until = Math.max(existing.until, s.time) + secs;
      else s.state.buffs.push({ type: 'solarFrenzy', until: s.time + secs });
      s.bus.emit('buff.started', { type: 'solarFrenzy', seconds: secs });
      parts.push(`Solar ×${TUNING.cat.frenzyMult} for ${Math.round(secs)} s`);
    };
    const mega = () => {
      const ok = s.chains.startMega(Math.round(TUNING.cat.megaBloomTiles * mult));
      parts.push(ok ? 'A free Mega Bloom!' : 'Everything is already blooming!');
      if (!ok) harvest();
    };
    const party = () => {
      const hub = s.state.machines.find((m) => m.type === 'droneHub');
      if (!hub) return harvest();
      s.drones.spawn(hub, TUNING.cat.dronePartySeconds * mult);
      s.drones.spawn(hub, TUNING.cat.dronePartySeconds * mult);
      parts.push(`2 party drones for ${Math.round(TUNING.cat.dronePartySeconds * mult)} s`);
    };
    switch (type) {
      case 'luckyHarvest':
        harvest();
        break;
      case 'solarFrenzy':
        frenzy();
        break;
      case 'megaBloom':
        mega();
        break;
      case 'droneParty':
        party();
        break;
      case 'jackpot':
        harvest();
        mega();
        frenzy();
        break;
    }
    return parts.join(' · ');
  }
}
