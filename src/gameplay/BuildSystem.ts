import type { BuildableType, GroundState, MachineData } from '../core/types';
import { MACHINES, machineName } from '../data/machines';
import { AREA_TYPES, type AreaType } from '../data/city';
import { GROUND, machinesRemoved } from '../core/GameState';
import { MATERIALS, STORE, type MaterialCost } from '../data/salvage';
import { regionById, regionPond } from '../core/OldCityLayout';
import { isMainlandCell } from '../core/Mainland';
import type { MaterialId } from '../core/types';
import { isMaterial, itemDef } from '../data/items';
import type { Sim } from './Sim';

/** E19.2: what building over a decoration says (a decoration is free and instant to remove). */
export const DECOR_IN_WAY = 'A decoration is here: remove it first';

export interface PlacementCheck {
  ok: boolean;
  reason?: string;
  /** true when the spot is fine and only materials are missing */
  spotOk: boolean;
}

export class BuildSystem {
  constructor(private sim: Sim) {}

  /** E21.3: the recipe for a machine (undefined: it can't be built). */
  recipe(type: BuildableType): MaterialCost | undefined {
    // E23.6.1: a machine with a crafting-table recipe is built from it (components and materials)
    return this.sim.crafting.machineRecipe(type)?.cost;
  }

  /** E21.3: the fountain tier that unlocks a machine (99: a Keeper, research or a find opens it). */
  recipeTier(type: BuildableType): number {
    const u = this.sim.crafting.machineRecipe(type)?.unlock;
    return u && 'tier' in u ? u.tier : 99;
  }

  /** E21.3: a machine is locked until its fountain tier, and nothing else (E23.1.1: the one rule set). */
  isUnlocked(type: BuildableType) {
    // E23.6.1: every machine is built from its crafting-table recipe and unlocks where it says
    const cr = this.sim.crafting.machineRecipe(type);
    return !!cr && this.sim.crafting.unlocked(cr.unlock);
  }

  /** Short reason a machine is still locked (hotbar label). */
  lockLabel(type: BuildableType): string {
    const cr = this.sim.crafting.machineRecipe(type);
    return cr ? this.sim.crafting.unlockLabel(cr.unlock) : `🔒 Fountain tier ${this.recipeTier(type)}`;
  }

  /** Copies of a type standing now (a merged machine counts once). */
  count(type: BuildableType) {
    return this.sim.state.machines.filter((m) => m.type === type && !m.starter).length;
  }

  /**
   * Phase 5 E13: copies ever built (prices count these). Before the first merge or build this is the copies
   * standing, which also covers saves and tests that place machines directly.
   */
  built(type: BuildableType): number {
    return this.sim.state.stats.built?.[type] ?? this.count(type);
  }

  /** Starts the lifetime counts from what stands now (before anything is built or merged away). */
  ensureBuiltCounts(): Record<string, number> {
    const st = this.sim.state.stats;
    if (!st.built) {
      st.built = {};
      for (const m of this.sim.state.machines) if (!m.starter && m.type !== 'core') st.built[m.type] = (st.built[m.type] ?? 0) + 1;
    }
    return st.built;
  }

  /** Why a footprint can't be built on (edge, fog, vent, occupied, drone target, growing, wrong ground), if it can't. */
  footprintProblem(roofId: string, x: number, z: number, size: number, allowed: GroundState[]): string | undefined {
    const s = this.sim;
    const cells = s.grid.footprint(roofId, x, z, size);
    if (cells.some((c) => !c)) return 'Too close to the edge';
    // E21.24: every tile of a footprint on one terrace, none on a ramp or stair
    if (cells.some((c) => c!.ramp || c!.level !== cells[0]!.level)) return 'Needs level ground';
    for (const c of cells) {
      if (!c) continue;
      if (!s.areas.isClear(c) && !s.areas.canTouch(c)) return 'Lost in the fog — clear the ground here first';
      if (c.blocked) return 'A rusty vent is in the way';
      // E23.5.4.6: a Keeper's pond is water (silted or restored): build beside it, never in it
      if (c.roofId === GROUND && regionPond(c.x, c.z, s.state.layers.find((l) => l.kind === 'ground')?.dryPonds)) return 'That’s a Keeper’s pond: build beside it';
      if (c.occupantId) {
        const m = s.occupant(c);
        return m ? `${machineName(m)} is already here` : DECOR_IN_WAY; // E19.2: a decoration (free and instant to remove)
      }
      if (s.drones.isReserved(c.id)) return 'Your drone is about to work here';
      if (c.ground === 'growing') return 'Let it finish growing first';
      if (!allowed.includes(c.ground)) return 'Needs restored or mossy ground — pulse it first';
    }
    return undefined;
  }

  /** Converts a cursor cell into the footprint anchor so the ghost centres on the pointer. */
  anchorFor(type: BuildableType, fx: number, fz: number): { x: number; z: number } {
    const size = MACHINES[type].size;
    return { x: Math.floor(fx - size / 2 + 0.5), z: Math.floor(fz - size / 2 + 0.5) };
  }

  /** E21.3: the recipe as text for the tray: material icons with have / need (the store counts near a way into it). */
  costLabel(type: BuildableType): string {
    const r = this.recipe(type);
    if (!r) return '';
    return this.sim.inventory
      .describe(r)
      .map((p) => `${p.icon}${Math.min(p.have, p.need)}/${p.need}`)
      .join(' ');
  }

  /** Can the recipe be paid right now (from the pack and the store within reach)? */
  affordable(type: BuildableType): boolean {
    const r = this.recipe(type);
    return !!r && this.sim.inventory.canPay(r);
  }

  /**
   * E21.3: what is missing from a recipe, naming the region it comes from once that region has been seen
   * ("Needs Copper — Mast Row").
   */
  missingLabel(type: BuildableType): string | undefined {
    const r = this.recipe(type);
    if (!r) return undefined;
    const m = this.sim.inventory.shortfall(r);
    if (!m) return undefined;
    if (m === 'biomass') return 'Needs more Biomass 🌿 — gather it from restored ground';
    // E23.6.1: a component is made at the crafting table (no region to name)
    if (!isMaterial(m)) return `Needs ${itemDef(m).name} ${itemDef(m).icon} — make it at the crafting table`;
    return `Needs ${MATERIALS[m].name} ${MATERIALS[m].icon}${this.whereFrom(m)}`;
  }

  /** " — Mast Row" once a region holding the material has been seen (revealed), else nothing; a place outside the regions always (steel's industrial ruins). */
  whereFrom(m: MaterialId): string {
    if (MATERIALS[m].place) return ` — ${MATERIALS[m].place}`;
    for (const home of MATERIALS[m].home) {
      if (home === 'park' || home === 'backstreet') continue;
      const r = regionById(home);
      if (r && this.sim.state.areas[r.id]) return ` — ${r.name}`;
    }
    return MATERIALS[m].home.includes('park') ? ' — the park' : '';
  }

  /** E21.3: placement: the tier lock, the recipe, the chest limit. */
  check(type: BuildableType, roofId: string, x: number, z: number): PlacementCheck {
    const s = this.sim;
    const def = MACHINES[type];
    const fail = (reason: string, spotOk = false): PlacementCheck => ({ ok: false, reason, spotOk });
    const recipe = this.recipe(type);
    if (!recipe) return fail(`${def.name} is not built in the Old City`);
    if (!this.isUnlocked(type)) {
      const cr = s.crafting.machineRecipe(type);
      return fail(cr ? `Not known yet: ${s.crafting.unlockLabel(cr.unlock).replace('🔒 ', '')}` : `${def.name} is not built in the Old City`);
    }
    const roof = s.grid.roof(roofId);
    if (!roof || !roof.unlocked || roof.preview) return fail('This rooftop is not reachable yet');
    // E23.8.3.2: the mainland's big machines stand only past the causeway
    if (def.mainlandOnly && (roofId !== GROUND || !isMainlandCell(x) || !isMainlandCell(x + def.size - 1))) return fail(`${def.name}: only on the mainland`);
    if (type === 'chest' && s.machinesOfType('chest').length >= STORE.maxChests) return fail(`At most ${STORE.maxChests} Storage Chests`);
    if (roofId === GROUND && def.areaTypes) {
      const t = AREA_TYPES[s.areas.info(s.areas.map.areaOfCell(x, z)).type];
      if (!def.areaTypes.includes(t.type)) return fail(`Only grows in a ${def.areaTypes.map((a) => AREA_TYPES[a as AreaType].name.toLowerCase()).join(' or ')} area`);
    }
    const why = this.footprintProblem(roofId, x, z, def.size, def.allowedGround) ?? s.water.placeProblem(type, roofId, x, z); // E23.4.2: a pump on a bank
    if (why) return fail(why);
    if (!s.inventory.canPay(recipe)) return fail(this.missingLabel(type) ?? 'Missing materials', true);
    return { ok: true, spotOk: true };
  }

  /**
   * E21.3: removes a machine the player built: the whole recipe comes back, to the backpack
   * and anything over a stack to the store. False for landmarks and the starter panel.
   */
  remove(id: string): boolean {
    const s = this.sim;
    const m = s.machine(id);
    if (!m || m.type === 'core' || m.starter) return false;
    const recipe = this.recipe(m.type as BuildableType);
    for (const t of s.grid.footprint(m.roofId, m.x, m.z, m.size)) if (t && t.occupantId === m.id) t.occupantId = undefined;
    s.grid.unindexMachine(m);
    if (m.type === 'droneHub') {
      s.automation.hubRemoved(m.id); // E23.6.4: couriers' baskets come back before the drones go
      s.drones.removeHub(m.id);
    }
    s.state.machines = s.state.machines.filter((q) => q.id !== m.id);
    machinesRemoved();
    if (recipe) s.inventory.refund(recipe);
    s.bus.emit('machine.removed', { machine: m });
    return true;
  }

  place(type: BuildableType, roofId: string, x: number, z: number): MachineData | undefined {
    const s = this.sim;
    const chk = this.check(type, roofId, x, z);
    if (!chk.ok) {
      s.bus.emit('action.failed', { reason: chk.reason! });
      return undefined;
    }
    s.inventory.pay(this.recipe(type)!);
    const built = this.ensureBuiltCounts();
    built[type] = (built[type] ?? 0) + 1;
    const def = MACHINES[type];
    const m: MachineData = { id: s.newId('m'), type, roofId, x, z, size: def.size, boostUntil: 0, timer: 0, charge: 0 };
    s.state.machines.push(m);
    for (const c of s.grid.footprint(roofId, x, z, def.size)) if (c) c.occupantId = m.id;
    s.grid.indexMachine(m);
    s.bus.emit('machine.built', { machine: m });
    s.cat.relocateIfBlocked(); // the Lucky Cat never blocks a build: it hops to another nook
    if (type === 'droneHub') s.drones.spawn(m); // more drones (upgrade) are topped up by DroneSystem
    return m;
  }
}
