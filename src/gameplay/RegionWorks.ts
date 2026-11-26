import { GROUND } from '../core/GameState';
import { distToFootprint } from '../core/Grid';
import { regionById } from '../core/OldCityLayout';
import type { MachineData } from '../core/types';
import { TUNING } from '../data/tuning';
import { WORKS, worksOf, type WorksDef } from '../data/works';
import type { PowerNode } from './PowerGrid';
import type { Sim } from './Sim';

/** The power grid's type for a works piece (a load it carries until the works run). */
export const WORKS_NODE = 'regionWorks';

/** What a works piece is waiting for, as the region's progress bar and the objective card show it. */
export interface WorksStatus {
  def: WorksDef;
  running: boolean;
  /** the share of the load the power reaching it covers now (power works; 0 with none), for the prompt */
  power?: { have: number; need: number };
}

/**
 * #787 (point 4): a region's works (data/works): a dark machine, a dry channel or seized machinery beside its
 * landmark, which can't wake until the works run (LandmarkSystem.problem). Only building makes them run: power
 * reaching the piece (it is a load on the power lines, joined like any machine), water (a Water Condenser nearby, or a
 * pipe carrying water beside it) or drones (a Drone Hub whose drones reach it, with power to fly, and the job asked).
 *
 * Once running they run for good (`salvage.works`, by region id): nothing is lost if the panel is later moved, and a
 * cloudy day or the night never undoes them. A region whose landmark is already awake counts as running, so an older
 * save keeps every region it has opened and finished. Checked every TUNING.works.checkSeconds while the region is in
 * view (not under fog), in data order, so it is deterministic.
 */
export class RegionWorks {
  private nodes = new Map<string, PowerNode>();
  private wait = 0;
  /** which works were waiting at the last check: the power lines are rebuilt when that changes (a region comes into view) */
  private seen = '';

  constructor(private sim: Sim) {
    for (const w of WORKS) if ('power' in w.need) this.nodes.set(w.region, { id: `works:${w.region}`, type: WORKS_NODE, roofId: GROUND, x: w.x, z: w.z, size: 1, charge: 0 } as PowerNode);
    sim.power.register(WORKS_NODE, { consumer: { shed: 'charger', draw: (m) => TUNING.works.power[m.id.slice('works:'.length)] ?? 0 } });
    // only works still waiting draw: once running they leave the power lines (nothing more to power)
    sim.power.addNodes(() => [...this.nodes.entries()].filter(([r]) => this.waiting(r)).map(([, n]) => n));
  }

  def(region: string): WorksDef | undefined {
    return worksOf(region);
  }

  /** Does this region's landmark wait on its works? */
  gated(region: string): boolean {
    return !!worksOf(region);
  }

  /** The works run (or the region has none, or its landmark already woke: older saves). */
  running(region: string): boolean {
    if (!worksOf(region)) return true;
    return !!this.sim.state.salvage?.works?.includes(region) || this.sim.areas.fog(region) === 'cleared';
  }

  /** Still dark and in view: the works the player can do something about now. */
  private waiting(region: string): boolean {
    return !this.running(region) && this.sim.areas.fog(region) !== 'hidden';
  }

  /** The power node of a power works (tests and the power view). */
  node(region: string): PowerNode | undefined {
    return this.nodes.get(region);
  }

  status(region: string): WorksStatus | undefined {
    const def = worksOf(region);
    if (!def) return undefined;
    const running = this.running(region);
    if (!('power' in def.need)) return { def, running };
    const need = TUNING.works.power[region] ?? 0;
    const n = this.nodes.get(region)!;
    const net = running ? undefined : this.sim.power.networkOf(n);
    return { def, running, power: { have: running ? need : Math.min(need, net ? net.supply : 0), need } };
  }

  /**
   * What the piece's prompt says while it is dark: what is wrong, then what to build and where. Undefined when it
   * runs (the prompt then says what the player sees).
   */
  problem(region: string): string | undefined {
    const def = worksOf(region);
    if (!def || this.running(region)) return undefined;
    const st = this.status(region)!;
    // power that reaches it but not enough yet: say so in a few words, not watts
    if (st.power && st.power.have > 0) return `${def.dark} Some power reaches it, but not enough yet. ${def.how}`;
    return `${def.dark} ${def.how}`;
  }

  /** Do the works have what they need right now? */
  met(def: WorksDef): boolean {
    const s = this.sim;
    const n = def.need;
    if ('power' in n) {
      const node = this.nodes.get(def.region)!;
      return !!s.power.networkOf(node) && s.power.servedShare(node) >= 1;
    }
    if ('condenser' in n) return s.machinesOfType('condenser').some((m) => built(m) && m.roofId === GROUND && distToFootprint(def.x, def.z, m.x, m.z, m.size) <= TUNING.works.condenserReach);
    if ('pipe' in n) {
      const R = TUNING.works.pipeReach;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if ((dx || dz) && s.water.pipes.carries(def.x + dx, def.z + dz)) return true;
      return false;
    }
    return s.machinesOfType('droneHub').some(
      (h) =>
        built(h) &&
        h.roofId === GROUND &&
        distToFootprint(def.x, def.z, h.x, h.z, h.size) <= s.drones.radius(h) &&
        s.power.isPowered(h) &&
        s.state.drones.some((d) => d.hubId === h.id && (!n.job || s.roles.roleFor(d, h) === n.job)),
    );
  }

  tick(dt: number) {
    if (!this.sim.state.salvage) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = TUNING.works.checkSeconds;
    const now = WORKS.filter((w) => this.waiting(w.region)).map((w) => w.region).join(',');
    if (now !== this.seen) {
      this.seen = now;
      this.sim.power.invalidate();
    }
    for (const w of WORKS) if (this.waiting(w.region) && this.met(w)) this.start(w.region);
  }

  /** The works run, for good: the piece lights up and the landmark can wake. */
  start(region: string): boolean {
    const s = this.sim;
    const def = worksOf(region);
    if (!def || this.running(region) || !s.state.salvage) return false;
    const list = (s.state.salvage.works ??= []);
    list.push(region);
    list.sort((a, b) => WORKS.findIndex((w) => w.region === a) - WORKS.findIndex((w) => w.region === b));
    s.power.invalidate(); // its load leaves the power lines
    const t = s.grid.get(GROUND, def.x, def.z);
    if (t) s.grid.touch(t); // redraw it running
    s.bus.emit('works.running', { region, x: def.x, z: def.z });
    return true;
  }

  /** The region a works piece belongs to, for the name in toasts. */
  regionName(region: string): string {
    return regionById(region)?.name ?? region;
  }
}

const built = (m: MachineData) => !m.project || m.project.stage >= 3;
