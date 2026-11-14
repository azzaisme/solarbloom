import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

/** Records the playtest numbers from the Round 2 plan into the save (shown in Settings). */
export class Metrics {
  constructor(private sim: Sim) {
    const b = sim.bus;
    b.on('upgrade.purchased', () => this.first('upgrade'));
    b.on('machine.built', ({ machine }) => this.first(machine.type));
    b.on('cat.found', () => this.first('cat'));
    b.on('tree.discharged', () => this.first('treePulse'));
    b.on('rooftop.coreRestored', () => this.first('core'));
    b.on('link.built', ({ linkId }) => this.first(`bridge:${linkId}`));
    b.on('roof.coreAwake', ({ roofId }) => this.first(`core:${roofId}`));
    b.on('neighbourhood.bloom', () => this.first('neighbourhoodBloom'));
    b.on('area.cleared', ({ areaId }) => {
      if (areaId === 'park') return;
      (sim.state.stats.areaTimes ??= []).push(Math.round(sim.time));
      const n = sim.areas.clearedCount();
      for (const k of [1, 5, 10, 25, 50, 100]) if (n >= k) this.first(`areas${k}`);
    });
  }

  first(key: string) {
    const f = this.sim.state.stats.firsts;
    if (f[key] === undefined) f[key] = Math.round(this.sim.time);
  }

  onChain(effects: number) {
    this.sim.state.stats.chainEffects += effects;
    if (effects >= 5) this.first('chain5');
    if (effects >= 10) this.first('chain10');
    if (effects >= 20) this.first('chain20');
  }

  /**
   * A plain-text summary of this game's playtest numbers (Settings → Playtest timings → Copy). Local only.
   */
  summary(): string {
    const s = this.sim;
    const st = s.state.stats;
    const f = st.firsts ?? {};
    const mmss = (t?: number) => (t === undefined ? '—' : `${Math.floor(t / 60)}:${String(Math.round(t) % 60).padStart(2, '0')}`);
    const times = st.areaTimes ?? [];
    const gaps = times.map((t, i) => t - (i ? times[i - 1] : (s.state.progression.coreActivatedAt >= 0 ? s.state.progression.coreActivatedAt : 0)));
    const hours = s.time / 3600;
    const lines = [
      'Solarbloom playtest timings',
      `Play time ${mmss(s.time)} · fountain ${mmss(s.state.progression.coreActivated ? s.state.progression.coreActivatedAt : undefined)}`,
      `Areas cleared ${times.length} · ${hours > 0.05 ? (times.length / hours).toFixed(1) : '—'} per hour · fastest ${gaps.length ? mmss(Math.min(...gaps)) : '—'} · slowest ${gaps.length ? mmss(Math.max(...gaps)) : '—'}`,
      `Time to each area: ${times.length ? times.slice(0, 20).map((t, i) => `#${i + 1} ${mmss(t)}`).join(', ') + (times.length > 20 ? ` … #${times.length} ${mmss(times[times.length - 1])}` : '') : '—'}`,
      `Biggest chain ×${st.maxCombo} · chains ${st.chains} · big chains by you ${st.bigChains?.player ?? 0} / automation ${st.bigChains?.auto ?? 0}`,
      `Lucky Cats found ${st.catsFound} · first ${mmss(f.cat)}`,
      `First upgrade ${mmss(f.upgrade)} · Drone Hub ${mmss(f.droneHub)} · Mother Tree ${mmss(f.motherTree)}`,
      `Time with nothing to do ${Math.round(st.stuckSeconds)} s`,
    ];
    return lines.join('\n');
  }

  /** "Unable to act": can't afford even a mossy-tile pulse, Harvest is cooling down, and nothing is buyable. */
  tick(dt: number) {
    const s = this.sim;
    const minPulse = TUNING.pulse.prepared.energy * s.upgrades.pulseEnergyMult;
    if (s.econ.get('energy') >= minPulse && s.econ.get('water') >= 1) return;
    if (s.time >= s.state.harvestReadyAt) return;
    if (s.upgrades.all().some((u) => s.upgrades.status(u).ok)) return;
    s.state.stats.stuckSeconds += dt;
  }
}
