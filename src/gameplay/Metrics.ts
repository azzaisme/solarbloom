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
