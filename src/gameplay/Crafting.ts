import type { BuildableType, ComponentId, SalvageState } from '../core/types';
import { COMPONENT_RECIPES, CRAFT, DECOR_RECIPES, MACHINE_RECIPES, type ComponentRecipe, type DecorRecipe, type MachineRecipe, type Unlock } from '../data/crafting';
import { KEEPERS, REGIONS } from '../data/oldcity';
import { itemDef } from '../data/items';
import { HAND_JOBS } from '../data/automation';
import type { Sim } from './Sim';

/**
 * E23.6.1 (#390): the crafting table. Components are made here: a craft pays its recipe from the backpack, then
 * the store (the table is in the house, within reach of it), and takes a few seconds. Crafts queue; the one in
 * hand counts down in game time (the table's panel also runs it while the game is paused for the panel). What a
 * craft makes goes to the backpack, anything over a stack to the store. Machines are paid for where they are
 * built (build mode reads `machineRecipe`), and removing one gives everything back.
 *
 * Unlocks: from the start (`home`), when a region's Keeper wakes, from research (E23.6.2) or from a cache.
 */
export class Crafting {
  constructor(private sim: Sim) {}

  private get sv(): SalvageState | undefined {
    return this.sim.state.salvage;
  }

  /** Is a recipe's unlock met? */
  unlocked(u: Unlock): boolean {
    const sv = this.sv;
    if (!sv) return false;
    if ('home' in u) return true;
    if ('keeper' in u) {
      const k = KEEPERS.find((x) => x.region === u.keeper);
      const st = k && sv.keepers[k.id];
      return !!st && st.step !== 'asleep';
    }
    if ('research' in u) return this.sim.research.done(u.research);
    if ('tier' in u) return sv.tier >= u.tier;
    if ('hand' in u) return !!this.sim.automation?.handDone(u.hand);
    if ('all' in u) return u.all.every((x) => this.unlocked(x));
    return sv.caches.includes(u.find);
  }

  /** Words for where a locked recipe comes from (for the table and the build menu). */
  unlockLabel(u: Unlock): string {
    if ('home' in u) return '';
    if ('keeper' in u) {
      const k = KEEPERS.find((x) => x.region === u.keeper);
      const r = REGIONS.find((x) => x.id === u.keeper);
      return `🔒 ${k?.name ?? 'A Keeper'}, ${r?.name ?? u.keeper}`;
    }
    if ('research' in u) return '🔒 Research';
    if ('tier' in u) return `🔒 Fountain tier ${u.tier}`;
    if ('hand' in u) {
      const job = HAND_JOBS[u.hand];
      return `🔒 ${job.name} (${this.sim.automation?.handCount(u.hand) ?? 0} of ${job.times})`;
    }
    if ('all' in u) return this.unlockLabel(u.all.find((x) => !this.unlocked(x)) ?? u.all[0]);
    return '🔒 Not found yet';
  }

  component(id: string): ComponentRecipe | undefined {
    return COMPONENT_RECIPES.find((r) => r.id === id);
  }

  /** The component recipes known now, in table order. */
  components(): ComponentRecipe[] {
    return COMPONENT_RECIPES.filter((r) => this.unlocked(r.unlock));
  }

  /**
   * E23.6.5: every recipe known now that makes an item (what an Assembler can make). Today those are the
   * components: a machine recipe builds a machine in the world and a decoration is made once, so neither is an item.
   */
  itemRecipes(): ComponentRecipe[] {
    return this.components();
  }

  /** E23.6.1: the recipe that builds a machine type (undefined: it keeps its E21.3 recipe). */
  machineRecipe(type: BuildableType): MachineRecipe | undefined {
    return MACHINE_RECIPES.find((r) => r.builds === type);
  }

  /** Every machine recipe known now (including the ones waiting for their machine to exist). */
  machines(): MachineRecipe[] {
    return MACHINE_RECIPES.filter((r) => this.unlocked(r.unlock));
  }

  decor(id: string): DecorRecipe | undefined {
    return DECOR_RECIPES.find((r) => r.id === id);
  }

  /** Decorations whose recipe is known now (made or not). */
  decorations(): DecorRecipe[] {
    return DECOR_RECIPES.filter((r) => this.unlocked(r.unlock));
  }

  /** Has a decoration been made at the table? (Then placing copies of it is free.) */
  decorMade(id: string): boolean {
    return !!this.sv?.decorMade?.includes(id);
  }

  /** Why a decoration can't be made now, if it can't. */
  decorProblem(id: string): string | undefined {
    const r = this.decor(id);
    if (!r || !this.sv) return 'Unknown recipe';
    if (this.decorMade(id)) return 'Already made: place it from the build menu';
    if (!this.unlocked(r.unlock)) return this.unlockLabel(r.unlock);
    const short = this.sim.inventory.shortfall(r.cost);
    if (short) return `Needs ${itemDef(short).name}`;
    return undefined;
  }

  /** Makes a decoration once (pays its recipe); it is bloombot's for good. True when made. */
  makeDecor(id: string): boolean {
    if (this.decorProblem(id)) return false;
    if (!this.sim.inventory.pay(this.decor(id)!.cost)) return false;
    const sv = this.sv!;
    sv.decorMade = [...(sv.decorMade ?? []), id].sort();
    return true;
  }

  /** The craft queue (read-only view). */
  queue(): readonly { id: string; n: number; left: number }[] {
    return this.sv?.craft ?? [];
  }

  /** How many crafts are queued in all. */
  queued(): number {
    return this.queue().reduce((a, j) => a + j.n, 0);
  }

  /** Why a component can't be crafted now, if it can't. */
  problem(id: string): string | undefined {
    const r = this.component(id);
    if (!r || !this.sv) return 'Unknown recipe';
    if (!this.unlocked(r.unlock)) return this.unlockLabel(r.unlock);
    if (this.queued() >= CRAFT.queue) return 'The table is busy';
    const short = this.sim.inventory.shortfall(r.cost);
    if (short) return `Needs ${itemDef(short).name}`;
    return undefined;
  }

  /**
   * Queues up to `times` crafts of a component, paying each now. Returns how many were queued (0 with a problem).
   */
  craft(id: string, times = 1): number {
    const r = this.component(id);
    if (!r) return 0;
    const sv = this.sv!;
    let n = 0;
    while (n < times && !this.problem(id)) {
      if (!this.sim.inventory.pay(r.cost)) break;
      const q = (sv.craft ??= []);
      const last = q[q.length - 1];
      if (last && last.id === id) last.n++;
      else q.push({ id, n: 1, left: r.seconds });
      n++;
    }
    if (n) this.sim.bus.emit('craft.queued', { id, n });
    return n;
  }

  /** Cancels a queued job: every craft not yet made is given back. */
  cancel(index: number): boolean {
    const q = this.sv?.craft;
    const j = q?.[index];
    const r = j && this.component(j.id);
    if (!q || !j || !r) return false;
    for (let i = 0; i < j.n; i++) this.sim.inventory.refund(r.cost);
    q.splice(index, 1);
    if (!q.length) delete this.sv!.craft;
    this.sim.bus.emit('craft.queued', { id: j.id, n: -j.n });
    return true;
  }

  /** Progress of the craft in hand (0..1), or undefined when the table is idle. */
  progress(): number | undefined {
    const j = this.queue()[0];
    const r = j && this.component(j.id);
    return r ? 1 - j.left / r.seconds : undefined;
  }

  /** Runs the table for `dt` seconds (the sim tick, and the panel while the game is paused for it). */
  work(dt: number) {
    const sv = this.sv;
    const q = sv?.craft;
    if (!q?.length) return;
    let t = dt;
    while (t > 0 && q.length) {
      const j = q[0];
      const r = this.component(j.id);
      if (!r) {
        q.shift();
        continue;
      }
      const step = Math.min(t, j.left);
      j.left -= step;
      t -= step;
      if (j.left > 1e-9) break;
      this.sim.inventory.refund({ [r.id]: r.makes } as Partial<Record<ComponentId, number>>);
      this.sim.bus.emit('craft.done', { id: r.id, made: r.makes });
      j.n--;
      if (j.n > 0) j.left = r.seconds;
      else q.shift();
    }
    if (!q.length) delete sv!.craft;
  }

  tick(dt: number) {
    this.work(dt);
  }
}
