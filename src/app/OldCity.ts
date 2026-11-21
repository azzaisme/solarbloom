import type { Action, Bindings } from './Bindings';
import type { BotController } from './BotController';
import type { Sim } from '../gameplay/Sim';
import type { Hud } from '../ui/Hud';
import type { MachineData, MaterialId } from '../core/types';
import { GROUND } from '../core/GameState';
import { MATERIALS, SALVAGE } from '../data/salvage';
import { itemDef } from '../data/items';
import { GATHER } from '../data/farm';
import { crossName, CROPS, type CropId } from '../data/crops';
import { planterHtml } from '../ui/PlanterPanel';
import { compostHtml, digesterHtml } from '../ui/CompostPanel';
import { extraHtml } from '../ui/ExtrasPanel';
import type { TileData } from '../core/types';
import { flyUp, fountainHtml, OldCityPanel, SpeechBubble, storageAct, storageHtml, tradeHtml } from '../ui/OldCityPanel';
import { PARK } from '../core/Areas';
import { setPieceAt } from '../core/OldCityLayout';
import { MOVE_LEVELS } from '../data/moveSpots';
import { MoveSpots, type MoveTrip } from '../gameplay/MoveSpots';

/** What the game lends the Old City controller (kept small, so Game.ts changes little). */
export interface OldCityHost {
  sim: Sim;
  hud: Hud;
  bot: BotController;
  bindings: Bindings;
  /** where a tile is on screen, for prompts anchored to it */
  screenOf(x: number, z: number): { x: number; y: number };
  /** E22.6: opens the store as the backpack screen's storage grid (the plain panel otherwise) */
  openStorage?(title: string): void;
  /** E23.9.1: opens the backpack's journal at a page */
  openPage?(id: string): void;
  /** plays a sound by name, if the game has it */
  sound(name: 'click' | 'salvage' | 'pry' | 'deliver' | 'tier' | 'wake', material?: MaterialId): void;
  /** redraws the ground tile at a cell */
  markTile(x: number, z: number): void;
  /** E21.8: where a Keeper's head is on screen (undefined: not drawn) */
  keeperScreen(id: string): { x: number; y: number } | undefined;
  /**
   * E21.24 / E21.22: the camera rises over a spot for `secs` and comes back (skippable; a still frame with reduced
   * motion); `done` gets the regions whose landmark was on screen.
   */
  vista(x: number, z: number, secs: number, done: (seen: string[]) => void): void;
}

/**
 * E21: the game side of the Old City — opening its panels, holding Interact at piles and barricades, keeping the
 * sim told where bloombot stands. Everything that changes the game goes through the Sim; this only reads input
 * and draws panels.
 */
export class OldCityController {
  readonly panel: OldCityPanel;
  /** E21.8: what the last Keeper to speak said */
  readonly bubble: SpeechBubble;
  private speaker?: string;
  /** a held Interact in progress (salvage, pry): what, how long so far, how long it needs */
  private hold?: { kind: string; t: number; need: number; done: () => void; padHeld: boolean };
  private keysDown = new Set<string>();

  constructor(private host: OldCityHost) {
    this.panel = new OldCityPanel(host.hud.root);
    this.bubble = new SpeechBubble(host.hud.root);
    host.sim.bus.on('keeper.said', ({ keeperId, lines }) => {
      this.speaker = keeperId;
      this.bubble.say(host.sim.keepers.def(keeperId).name, lines);
    });
    host.sim.bus.on('keeper.step', ({ keeperId, step }) => {
      if (step === 'request1') host.sound('wake');
      const k = host.sim.keepers.def(keeperId);
      host.markTile(k.x, k.z);
    });
    window.addEventListener('keydown', (e) => this.keysDown.add(e.code));
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.code));
    window.addEventListener('blur', () => this.keysDown.clear());
    host.sim.bus.on('pile.salvaged', (e) => {
      host.markTile(e.x, e.z);
      const sc = host.screenOf(e.x, e.z);
      flyUp(host.hud.root, `+${e.got} ${MATERIALS[e.material].icon} ${MATERIALS[e.material].name}`, sc.x, sc.y);
      host.sound('salvage', e.material);
      this.panel.refresh();
    });
    host.sim.bus.on('biomass.gathered', (e) => {
      if (e.by !== 'bot') return; // a Harvester drone's clippings go quietly to the store
      const sc = host.screenOf(e.x, e.z);
      flyUp(host.hud.root, `+${e.got} ${MATERIALS.biomass.icon} ${MATERIALS.biomass.name}`, sc.x, sc.y);
      host.sound('salvage', 'biomass');
    });
    host.sim.bus.on('planter.harvested', (e) => {
      const m = host.sim.machine(e.machineId);
      if (!m) return;
      const sc = host.screenOf(m.x, m.z);
      const parts = (['food', 'biomass', 'seeds'] as const).filter((k) => e[k] > 0).map((k) => `+${e[k]} ${MATERIALS[k].icon}`);
      flyUp(host.hud.root, parts.join('  '), sc.x, sc.y);
      host.sound('salvage', 'seeds');
    });
    host.sim.bus.on('farm.harvested', (e) => {
      const m = host.sim.machine(e.machineId);
      if (!m) return;
      const sc = host.screenOf(m.x, m.z);
      flyUp(host.hud.root, `+${e.n} ${MATERIALS[e.item].icon} ${MATERIALS[e.item].name}`, sc.x, sc.y);
    });
    host.sim.bus.on('garden.fulfilled', (e) => {
      const r = e.reward;
      const got = r.kind === 'seeds' ? `${CROPS[r.crop].name} seeds` : r.kind === 'items' ? `${r.n} Seeds` : r.kind === 'recipe' ? `the ${r.name} recipe` : `a ${r.name} to place`;
      this.sim.bus.emit('keeper.said', { keeperId: e.keeperId, lines: [`Thank you. Here: ${got}.`] });
      host.sound('deliver');
    });
    // a newly built planter beside a woken Keeper: the Keeper asks for what it would like grown there
    host.sim.bus.on('machine.built', (e) => {
      if (e.machine?.type === 'planter') this.gardenAsk(e.machine);
    });
    host.sim.bus.on('seeds.found', (e) => {
      const c = CROPS[e.crop as CropId];
      if (c) host.hud.toast(`${c.icon} ${c.name} seeds<small>Plant them in a planter.</small>`, '', 5);
    });
    // E23.6.2: a crossbreed found at a harvest
    host.sim.bus.on('cross.found', (e) => {
      const c = CROPS[e.a as CropId];
      if (c) host.hud.toast(`${c.icon} ${crossName(e.a as CropId, e.b as CropId)}<small>A new cross. Plant it in a planter.</small>`, '', 5);
    });
    // E23.7.4: a pile coming back (slowly, or blown in by a storm) is redrawn at its new size
    host.sim.bus.on('pile.refilled', (e) => host.markTile(e.x, e.z));
    host.sim.bus.on('fountain.tier', () => this.panel.close());
    host.sim.bus.on('pack.full', (e) => host.hud.toast(`You can't carry more ${itemDef(e.material).name}<small>Put some away at the fountain or in a chest.</small>`, '', 2.6));
  }

  get sim(): Sim {
    return this.host.sim;
  }

  /** Is the Interact button still down (keyboard or pad)? */
  private interactHeld(): boolean {
    const b = this.host.bindings;
    if (b.isDown('interact' as Action, this.keysDown)) return true;
    const i = b.pad.interact;
    if (i === undefined || typeof navigator === 'undefined' || !navigator.getGamepads) return false;
    return [...navigator.getGamepads()].some((gp) => !!gp?.buttons[i]?.pressed);
  }

  /** True while a panel is open or a hold is running (bloombot stands still). */
  get busy(): boolean {
    return this.panel.isOpen || !!this.hold;
  }

  /**
   * Starts a held Interact: it completes after `need` seconds if Interact stays down (a click-to-walk arrival
   * completes it without holding). Moving away or letting go cancels it.
   */
  /** E22.2: false turns holds into a single press (the hold then runs to the end without the button). */
  holdToAct = true;

  startHold(kind: string, need: number, done: () => void, viaClick = false) {
    this.hold = { kind, t: 0, need, done, padHeld: !viaClick && this.holdToAct };
    this.host.bot.visuals.play('assemble');
  }

  /** Per frame: tells the sim where bloombot is, runs a hold. */
  update(dt: number) {
    const p = this.host.bot.pose;
    this.sim.bot = { roofId: p.roofId, x: p.x, z: p.z };
    this.bubble.place(this.speaker ? this.host.keeperScreen(this.speaker) : undefined);
    const h = this.hold;
    if (!h) return;
    if (h.padHeld && !this.interactHeld() && h.t > 0.12) {
      this.hold = undefined;
      return;
    }
    h.t += dt;
    if (h.t >= h.need) {
      this.hold = undefined;
      h.done();
    }
  }

  /** 0–1 of the hold in progress, for a ring on the HUD (undefined when none). */
  holdProgress(): number | undefined {
    return this.hold ? Math.min(1, this.hold.t / this.hold.need) : undefined;
  }

  /** Closes the panel (Cancel). True when it was open. */
  escape(): boolean {
    if (this.hold) {
      this.hold = undefined;
      return true;
    }
    if (!this.panel.isOpen) return false;
    this.panel.close();
    return true;
  }

  /**
   * Interact with something in front of bloombot. Returns true when the Old City handled it (the game then does
   * nothing else).
   */
  interact(front: { x: number; z: number }, occupant?: MachineData): boolean {
    const onGround = this.host.bot.pose.roofId === GROUND;
    const pile = onGround ? this.sim.salvage.pileAt(front.x, front.z) : undefined;
    if (pile) {
      this.salvageHold(pile.id, front, false);
      return true;
    }
    // E21.8: a Keeper: wake it, hand over what it asks for, or hear it
    const keeper = onGround ? this.sim.keepers.at(front.x, front.z) : undefined;
    // E21.9: once the Market Hall is awake, Tally trades any 3 of one material for 1 of another
    // E23.9.2: Tally's panel offers both, trading and (when bloombot carries something it loves) a gift: one press
    // never gives anything away by surprise
    if (keeper && keeper.id === 'tally' && this.sim.landmarks.canTrade()) {
      this.openTrade();
      return true;
    }
    if (keeper && this.sim.keepers.visible(keeper.id)) {
      const r = this.sim.keepers.interact(keeper.id);
      if (r === 'gave' || r === 'done' || r === 'woke') this.host.sound('deliver');
      this.host.bot.visuals.play('interact');
      return true;
    }
    // E23.9.1: a page of the maker's journal: keep it and read it (again, if it was read before)
    const page = onGround ? this.sim.journal.pageAt(front.x, front.z) : undefined;
    if (page) {
      this.host.sound('click');
      this.sim.journal.read(page);
      this.host.openPage?.(page);
      this.host.bot.visuals.play('interact');
      return true;
    }
    // E21.24: a lookout: a short vista over the city; every landmark beacon in view counts as seen
    const sp = onGround ? setPieceAt(front.x, front.z) : undefined;
    if (sp?.kind === 'lookout') {
      this.host.sound('click');
      this.sim.salvage.see(`lookout:${sp.id}`);
      this.host.vista(front.x + 0.5, front.z + 0.5, 3, (seen) => {
        for (const r of seen) this.sim.salvage.see(`beacon:${r}`);
      });
      return true;
    }
    // E21.5: a gate: Pry a barricade (hold 2 s), repair a bridge, or hear what it needs
    const gate = onGround ? this.sim.gates.gateAt(front.x, front.z) : undefined;
    if (gate) {
      const why = this.sim.gates.problem(gate);
      const sc = this.host.screenOf(front.x, front.z);
      if (why) this.host.hud.showFail(why, sc.x, sc.y);
      else if (gate.kind === 'barricade')
        this.startHold('pry', SALVAGE.pryHoldSeconds, () => {
          if (this.sim.gates.open(gate.id)) {
            this.host.sound('pry');
            for (const [x, z] of gate.cells) this.host.markTile(x, z);
          }
        });
      else if (this.sim.gates.open(gate.id)) {
        this.host.sound('deliver');
        for (const [x, z] of gate.cells) this.host.markTile(x, z);
      }
      return true;
    }
    // E25 (#626): a sealed vault (Pry II holds Interact to force it), a stash, a trip a level II move takes
    const vault = onGround ? this.sim.moves.vaultAt(front.x, front.z) : undefined;
    if (vault) {
      const why = this.sim.moves.vaultProblem(vault);
      if (why) {
        const sc = this.host.screenOf(front.x, front.z);
        this.host.hud.showFail(why, sc.x, sc.y);
      } else
        this.startHold('pry', MOVE_LEVELS.vaultHoldSeconds, () => {
          const got = this.sim.moves.openVault(vault.id);
          if (!got) return;
          this.host.sound('pry');
          this.host.markTile(vault.x, vault.z);
          this.host.hud.toast(`The vault door gives<small>Inside: ${MoveSpots.words(got)}</small>`, 'gold', 4);
        });
      return true;
    }
    const stash = onGround ? this.sim.moves.stashAt(front.x, front.z) : undefined;
    if (stash) {
      const got = this.sim.moves.openStash(stash.id);
      if (got) {
        this.host.sound('deliver');
        this.host.markTile(stash.x, stash.z);
        this.host.bot.visuals.play('interact');
        this.host.hud.toast(`Someone left these here<small>${MoveSpots.words(got)}</small>`, 'gold', 4);
      }
      return true;
    }
    const trip = onGround ? this.tripAhead(front) : undefined;
    if (trip) {
      this.takeTrip(trip, front);
      return true;
    }
    // E21.6: the fountain opens its delivery panel (with a way to the store)
    if (occupant?.type === 'core' && this.sim.areas.areaOf(occupant) === PARK) {
      this.openFountain();
      return true;
    }
    // E21.9: a landmark still asleep: hand over its delivery (only when the region is ready)
    if (occupant?.type === 'core') {
      const r = this.sim.landmarks.regionAt(occupant.x, occupant.z);
      if (r && this.sim.areas.fog(r.id) !== 'cleared') {
        const res = this.sim.landmarks.interact(r.id);
        if (res) this.host.sound(res === 'woke' ? 'wake' : 'deliver');
        this.host.bot.visuals.play('interact');
        return true;
      }
    }
    if (occupant && (occupant.type === 'chest' || this.isStoreLandmark(occupant))) {
      this.openStorage();
      return true;
    }
    void front;
    return false;
  }

  /** E25 (#626): the trip Bloombot could take from where it stands, facing `front` (MoveSpots). */
  tripAhead(front: { x: number; z: number }): MoveTrip | undefined {
    const b = this.host.bot;
    if (b.pose.roofId !== GROUND) return undefined;
    return this.sim.moves.tripFrom([Math.floor(b.pose.x), Math.floor(b.pose.z)], [front.x, front.z], (x, z) => b.walker.walkable(GROUND, x, z));
  }

  /** E25 (#626): hovers, climbs or glides there (or says why not). */
  takeTrip(t: MoveTrip, front: { x: number; z: number }) {
    const why = this.sim.moves.tripProblem(t);
    if (why) {
      const sc = this.host.screenOf(front.x, front.z);
      this.host.hud.showFail(why, sc.x, sc.y);
      return;
    }
    if (!this.sim.moves.takeTrip(t)) return;
    const b = this.host.bot;
    const style = t.move === 'climb' ? 'climb' : t.move === 'glide' ? 'glide' : 'hover';
    const tiles = Math.hypot(t.to[0] + 0.5 - b.pose.x, t.to[1] + 0.5 - b.pose.z);
    this.host.sound('click');
    b.travel(t.to[0], t.to[1], style, MOVE_LEVELS.tripSeconds + MOVE_LEVELS.tripSecondsPerTile * tiles, MOVE_LEVELS.tripArc[style]);
  }

  /**
   * E21.8: Pulse on the tile in front: a sleeping Keeper stirs. True when the Old City handled it (the game then
   * does nothing else).
   */
  pulse(front: { x: number; z: number }): boolean {
    if (this.host.bot.pose.roofId !== GROUND) return false;
    const keeper = this.sim.keepers.at(front.x, front.z);
    if (!keeper || !this.sim.keepers.visible(keeper.id)) return false;
    // E23.9.2: a settled Keeper only chats when pulsed: nothing is handed over without Interact
    if (!this.sim.keepers.pulse(keeper.id)) {
      if (this.sim.keepers.step(keeper.id) === 'settled') this.sim.keepers.chat(keeper.id);
      else this.sim.keepers.interact(keeper.id);
    }
    this.host.bot.visuals.play('pulse');
    return true;
  }

  /** Salvage a pile: hold Interact 0.6 s (a click-to-walk arrival needs no hold). */
  private salvageHold(id: string, at: { x: number; z: number }, viaClick: boolean) {
    const why = this.sim.salvage.problem(id);
    if (why) {
      const sc = this.host.screenOf(at.x, at.z);
      this.host.hud.showFail(why, sc.x, sc.y);
      return;
    }
    this.startHold('salvage', this.sim.parkGrowth.salvageHold, () => this.sim.salvage.salvage(id), viaClick);
  }

  /** E23.5.2: a planter: harvest a ripe bed straight away, otherwise open its panel (plant, feed, extras). */
  planter(m: MachineData) {
    const f = this.sim.farm;
    if (f.look(m).ripe) {
      f.harvest(m);
      this.host.bot.visuals.play('interact');
      return;
    }
    this.host.sound('click');
    this.panel.open(
      () => planterHtml(this.sim, m),
      (act, arg) => {
        // a crossbreed's arg is its two parents, 'a+b' (E23.6.2)
        const [crop, cross] = (arg ?? '').split('+') as [CropId, CropId | undefined];
        if (act === 'plant' && f.plant(m, crop, cross)) {
          this.host.sound('salvage', 'seeds');
          this.panel.close();
        } else if (act === 'harvest') {
          f.harvest(m);
          this.panel.close();
        } else if (act === 'feed' && f.feed(m)) this.host.sound('deliver');
        else if (act === 'extra' && f.addExtra(m, arg as 'trellis' | 'flooded')) this.host.sound('deliver');
      },
    );
  }

  /** E23.5.3: a compost bin's panel. */
  compostBin(m: MachineData) {
    const c = this.sim.compost;
    this.host.sound('click');
    this.panel.open(
      () => compostHtml(this.sim, m),
      (act, arg) => {
        const n = act === 'fill' ? c.fill(m, arg as 'biomass' | 'food') : act === 'take' ? c.take(m, arg as 'compost' | 'fertiliser') : act === 'return' ? c.returnCompost(m) : 0;
        if (n > 0) this.host.sound(act === 'take' ? 'salvage' : 'deliver', act === 'take' ? 'seeds' : undefined);
      },
    );
  }

  /** E23.5.3: a Bio Digester's panel. */
  digester(m: MachineData) {
    this.host.sound('click');
    this.panel.open(
      () => digesterHtml(this.sim, m),
      (act) => {
        if (act === 'feed' && this.sim.compost.feed(m) > 0) this.host.sound('deliver');
      },
    );
  }

  /** E23.5.4: a hive, pond, fruit tree, mushroom log, worm bin or wildlife home's panel. */
  extra(m: MachineData) {
    const x = this.sim.farmExtras;
    this.host.sound('click');
    this.panel.open(
      () => extraHtml(this.sim, m),
      (act) => {
        const n =
          act === 'honey' ? x.takeHoney(m) : act === 'pick' ? x.pick(m) : act === 'prune' ? x.prune(m) : act === 'mushrooms' ? x.pickMushrooms(m) : act === 'inoculate' ? +x.inoculate(m) : act === 'worms' ? +x.feedWorms(m) : 0;
        if (n > 0) this.host.sound(act === 'inoculate' || act === 'worms' ? 'deliver' : 'salvage', 'seeds');
      },
    );
  }

  /** E21.8 + E23.5.4.6: a Keeper asks for its garden crop once a planter stands in its garden. */
  gardenAsk(m: MachineData) {
    const keeper = this.sim.farmExtras.gardenOf(m);
    const req = keeper ? this.sim.farmExtras.request(keeper) : undefined;
    if (keeper && req) this.sim.bus.emit('keeper.said', { keeperId: keeper, lines: [req.ask] });
  }

  /** E23.5.1: clip restored ground for biomass: hold Interact 0.6 s, like salvaging. */
  gatherHold(t: TileData) {
    const why = this.sim.gather.problem(t);
    if (why) {
      const sc = this.host.screenOf(t.x, t.z);
      this.host.hud.showFail(why, sc.x, sc.y);
      return;
    }
    this.startHold('gather', GATHER.holdSeconds, () => this.sim.gather.gather(t));
  }

  /**
   * A click on a tile: a pile walks bloombot there and salvages it. True when handled.
   */
  click(tile: { roofId: string; x: number; z: number }): boolean {
    if (tile.roofId !== GROUND) return false;
    const pile = this.sim.salvage.pileAt(tile.x, tile.z);
    if (!pile) return false;
    const b = this.host.bot;
    const go = b.goTo(GROUND, pile.x, pile.z, 1, () => this.salvageHold(pile.id, pile, true));
    if (!go) {
      const sc = this.host.screenOf(pile.x, pile.z);
      this.host.hud.showFail("Bloombot can't find a way there", sc.x, sc.y);
    }
    return true;
  }

  /** A woken landmark (or the fountain) is a way into the store. */
  private isStoreLandmark(m: MachineData): boolean {
    if (m.type !== 'core') return false;
    return this.sim.inventory.accessPoints().some((p) => p.x === m.x && p.z === m.z && p.roofId === m.roofId);
  }

  /** E21.9: Tally's trade panel: pick what to give (3) and what to get (1). */
  openTrade() {
    let give: MaterialId | undefined;
    this.host.sound('click');
    this.panel.open(
      () => tradeHtml(this.sim, give),
      (act, arg) => {
        if (act === 'gift') {
          if (this.sim.keepers.interact('tally') === 'gave') this.host.sound('deliver');
          return;
        }
        if (act === 'give') give = arg as MaterialId;
        else if (act === 'get' && give && this.sim.landmarks.trade(give, arg as MaterialId)) this.host.sound('deliver');
      },
    );
  }

  openFountain() {
    this.host.sound('click');
    this.panel.open(
      () => fountainHtml(this.sim),
      (act) => {
        if (act === 'storage') return this.openStorage('Storage at the fountain');
        if (act === 'giveAll' && this.sim.fountain.giveAll() > 0) this.host.sound('deliver');
      },
    );
  }

  openStorage(title = 'Storage') {
    this.host.sound('click');
    if (this.host.openStorage) return this.host.openStorage(title); // E22.6: the backpack's storage grid
    this.panel.open(
      () => storageHtml(this.sim, title),
      (act, arg) => storageAct(this.sim, act, arg),
    );
  }
}
