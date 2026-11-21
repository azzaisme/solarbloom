import { KNACK_TUNING as T, KNACKS, type KnackDef, type KnackKeeper } from '../data/bloombot';
import type { Sim } from './Sim';

/**
 * #625 (E25): what the Keepers taught Bloombot. Each Keeper teaches one knack as it wakes (`keeper.step` from asleep to
 * its first request), and it is Bloombot's from then on. Nothing new is saved: a knack is there while its Keeper is
 * awake, which it stays, so an old save's woken Keepers have taught theirs already, quietly. The systems a knack
 * changes read the getters here (charge, chargers, resting, salvage, gathering, the Mega Pulse, planters, the
 * backpack); the Keeper says its `taught` line as it wakes (KeeperSystem.interact).
 */
export class Knacks {
  constructor(private readonly sim: Sim) {
    sim.bus.on('keeper.step', ({ keeperId, step }) => {
      if (step === 'request1' && KNACKS.some((k) => k.keeper === keeperId)) sim.bus.emit('bloombot.knack', { keeper: keeperId });
    });
  }

  /** Has Bloombot learned this Keeper's knack (is the Keeper awake)? */
  has(keeper: KnackKeeper): boolean {
    const st = this.sim.state.salvage?.keepers?.[keeper];
    return !!st && st.step !== 'asleep';
  }

  /** The knack a Keeper teaches. */
  of(keeper: string): KnackDef | undefined {
    return KNACKS.find((k) => k.keeper === keeper);
  }

  /** The Keepers whose knacks Bloombot has, in map order (Bloombot wears one bead each). */
  list(): KnackKeeper[] {
    return KNACKS.filter((k) => this.has(k.keeper)).map((k) => k.keeper);
  }

  /** Quick charge (Pylon): a charger's rate, as a share. */
  get charger(): number {
    return this.has('pylon') ? T.charger : 1;
  }

  /** Eye for value (Tally): one extra piece on this dig? Counts the dig (call once per salvage). */
  extraDig(): number {
    if (!this.has('tally')) return 0;
    const sv = this.sim.state.salvage!;
    sv.digs = ((sv.digs ?? 0) + 1) % T.digEvery;
    return sv.digs === 0 ? 1 : 0;
  }

  /** Beachcomber (Tide): how fast dug piles refill, as a share. */
  get refill(): number {
    return this.has('tide') ? T.refill : 1;
  }

  /** Green thumb (Moss): Greens per gather by Bloombot, as a share. */
  get gather(): number {
    return this.has('moss') ? T.gather : 1;
  }

  /** What one pulse adds to the Mega Pulse (Good timing, Tock). */
  get mega(): number {
    return this.has('tock') ? T.mega : 1;
  }

  /** Easy rest (Gable): resting at home or on a bench, as a share. */
  get rest(): number {
    return this.has('gable') ? T.rest : 1;
  }

  /** Warm hands (Fern): crop growth, as a share. */
  get crops(): number {
    return this.has('fern') ? T.crops : 1;
  }

  /** Strong back (Atlas): more of each thing in the backpack. */
  get carry(): number {
    return this.has('atlas') ? T.carry : 0;
  }

  /** What a use of charge costs, as a share: Float along (Sluice) for running, Starlight (Vega) at night. */
  chargeFactor(use: 'pulse' | 'sprint' | string): number {
    let k = 1;
    if (use === 'sprint' && this.has('sluice')) k *= T.run;
    if ((use === 'sprint' || use === 'pulse') && this.has('vega') && this.sim.clock?.isNight()) k *= T.night;
    return k;
  }
}
