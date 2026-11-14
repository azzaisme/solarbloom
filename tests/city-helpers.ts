import type { Sim } from '../src/gameplay/Sim';

/** Marks an area's specialty action (City 09.1) as done, for tests about other things. */
export function meetSpecialty(sim: Sim, id: string) {
  const st = sim.state.areas[id];
  if (st) st.spec = 1e6;
}
