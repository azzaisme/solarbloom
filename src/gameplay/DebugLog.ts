import type { ResourceKind } from '../core/types';
import type { Sim } from './Sim';

/**
 * Phase 4 E00.4: a local, in-memory log of gameplay events for tuning and debugging. Nothing leaves the
 * browser and nothing personal is recorded: just sim times, event names and small numbers. Tile
 * transitions are counted, not logged one by one, so a ×1,000 chain can't flush the log.
 */
export interface LogEntry {
  /** sim time (s) */
  t: number;
  type: string;
  data?: Record<string, number | string | boolean>;
}

export class DebugLog {
  /** The most recent entries (a ring: the oldest drop off past `max`). */
  readonly entries: LogEntry[] = [];
  max = 2000;
  /** Every logged event type, plus tile transitions by source ('tile.pulse', 'tile.drone', …). */
  readonly counts: Record<string, number> = {};
  /** Resources produced while that storage was already full (lost to the cap), since the session began. */
  readonly overflow: Record<ResourceKind, number> = { energy: 0, water: 0, biomass: 0 };

  constructor(private sim: Sim) {
    const b = sim.bus;
    b.on('pulse.fired', ({ extra, overcharged }) => this.push('pulse.cast', { extra: extra.length, overcharged }));
    b.on('tile.restored', ({ source }) => this.count(`tile.${source}`));
    b.on('tile.nurtured', ({ level }) => this.count(`tile.bloom${level}`));
    b.on('chain.ended', ({ combo, total, starter, areas }) => this.push('chain.resolved', { combo, total: Math.round(total), starter, areas }));
    b.on('upgrade.purchased', ({ id, level }) => this.push('upgrade.purchased', { id, level }));
    b.on('machine.built', ({ machine }) => this.push('machine.built', { type: machine.type, id: machine.id }));
    b.on('cat.found', ({ reward, extras }) => this.push('cat.found', { reward, extras }));
    b.on('cat.spawned', ({ anchorId }) => this.push('cat.spawned', { anchorId }));
    b.on('resource.full', ({ kind }) => this.push('resource.full', { kind }));
    b.on('harvest', ({ amount }) => this.push('harvest', { amount: Math.round(amount) }));
    b.on('tree.discharged', () => this.push('tree.discharged'));
    b.on('mega.ready', () => this.push('mega.ready'));
    b.on('milestone.reached', ({ at }) => this.push('milestone', { id: `park${at}` }));
    b.on('rooftop.coreReady', () => this.push('milestone', { id: 'fountainReady' }));
    b.on('rooftop.coreRestored', () => this.push('milestone', { id: 'fountain' }));
    b.on('area.cleared', ({ areaId }) => this.push('milestone', { id: `area:${areaId}` }));
    b.on('district.bloom', ({ districtId }) => this.push('milestone', { id: `district:${districtId}` }));
    b.on('action.failed', ({ reason }) => this.push('action.failed', { reason }));
  }

  private count(key: string) {
    this.counts[key] = (this.counts[key] ?? 0) + 1;
  }

  push(type: string, data?: LogEntry['data']) {
    this.count(type);
    this.entries.push({ t: Math.round(this.sim.time * 10) / 10, type, data });
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
  }

  /** Called by the Economy when income is lost to a full store. */
  onOverflow(kind: ResourceKind, amount: number) {
    this.overflow[kind] += amount;
  }

  /** Entries of one type (newest last). */
  of(type: string): LogEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  /** One JSON object per line, for copying out of the dev console. */
  dump(): string {
    return this.entries.map((e) => JSON.stringify(e)).join('\n');
  }
}
