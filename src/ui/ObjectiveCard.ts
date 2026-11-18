import type { Cost } from '../core/types';
import type { BuildableType } from '../core/types';
import { Economy, formatCost, KINDS } from '../core/Economy';
import { fmt } from '../core/Big';
import { SEED_CORE_MACHINES } from '../gameplay/ProgressionSystem';
import { $, esc, HudPart } from './HudPart';
import { advisorStep } from './Pace';
import type { Tool } from './Hud';
import { AREA_TYPES } from '../data/city';
import { MACHINES } from '../data/machines';
import type { Sim } from '../gameplay/Sim';
import type { Suggestion } from '../gameplay/Advisor';
import { HOME } from '../gameplay/ProgressionSystem';
import { TUNING } from '../data/tuning';
import { WORDS } from './words';
import { pinnedRequest as pinnedKeeper } from './BackpackModel';
import { MATERIALS } from '../data/salvage';
import type { MaterialId } from '../core/types';
import { oldCityHint, oldCityObjective as oldCityCard } from './OldCityGuide';

/**
 * E22.10 (#348) / E22.5 (#342): the objective card (top left). Under old-city rules it is one plain sentence about
 * a thing and a place: the pinned request (E21), or else the next step at the fountain or in the city. A count
 * appears only for things gathered or restored by hand, as "12 of 20".
 */
export interface Objective {
  text: string;
  /** "12 of 20", only for things done by hand */
  count?: string;
}

/** E21's pinned request, if its state exists and one is pinned (read only; E21 owns the shape). */
export function pinnedRequest(state: object): { text: string; have?: number; need?: number } | undefined {
  const reqs = (state as { requests?: unknown }).requests;
  const list = Array.isArray(reqs) ? reqs : reqs && typeof reqs === 'object' ? Object.values(reqs as Record<string, unknown>) : [];
  for (const r of list as { pinned?: boolean; text?: string; have?: number; need?: number }[]) if (r && r.pinned && typeof r.text === 'string') return { text: r.text, have: r.have, need: r.need };
  return undefined;
}

/** E23.1.5: the advisor's topics that come before any request: a shortage in the loop the player should see now. */
const URGENT = new Set<Suggestion['topic']>(['charge', 'grid', 'water', 'farm']);

/**
 * The sentence. E23.1.5: under the calm HUD the hint strip is hidden, so the advisor speaks through this line: a
 * shortage in the loop first, then the pinned request, then the fountain, and its next step once the fountain is
 * done. `advice` is the advisor's current suggestion (the card asks for it twice a second; tests may leave it out).
 */
export function objectiveSentence(sim: Sim, advice: Suggestion | undefined = sim.oldCity ? sim.advisor.suggest() : undefined): Objective {
  const W = WORDS.objective;
  if (sim.oldCity) {
    if (advice && URGENT.has(advice.topic)) return { text: advice.text };
    // E21.8: the pinned Keeper request (with a count only while its patch is restored by hand)
    const pinned = pinnedKeeper(sim); // E22.6: the request the player pinned, else the first open one
    if (pinned) {
      const step = sim.keepers.step(pinned.id);
      const p = step === 'request2' ? sim.keepers.patch(pinned.id) : undefined;
      return { text: pinned.text, count: p ? W.count(Math.min(p.restored, p.total), p.total) : undefined };
    }
    // E21.6: the fountain's next step, by its name: what it still wants, then its own condition
    const f = sim.fountain;
    const t = f.next();
    if (!t) return { text: advice?.text ?? W.explore };
    const want = (Object.keys(t.delivery) as (MaterialId | 'biomass')[])
      .map((k) => [k, k === 'biomass' ? t.delivery[k]! : f.remaining(k as MaterialId)] as const)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k === 'biomass' ? 'Greens' : MATERIALS[k as MaterialId].name}`);
    if (want.length) return { text: `Bring ${want.length > 1 ? `${want.slice(0, -1).join(', ')} and ${want[want.length - 1]}` : want[0]} to the fountain` };
    const c = f.condition(t);
    if (!c.done) return { text: c.label, count: W.count(Math.min(c.have, c.need), c.need) };
    return { text: `${t.name}: the fountain is ready` };
  }
  const pin = pinnedRequest(sim.state);
  if (pin) return { text: pin.text, count: pin.need ? W.count(Math.min(pin.have ?? 0, pin.need), pin.need) : undefined };
  const p = sim.progression;
  if (!sim.state.progression.coreActivated) {
    const g = p.homeIsPark ? TUNING.park : TUNING.core; // the same goals ProgressionSystem counts
    const n = p.restoredCount(HOME);
    if (n < g.restoredTiles) return { text: W.restore, count: W.count(n, g.restoredTiles) };
    const full = p.fullBloomCount(HOME);
    if (full < g.fullBloomTiles) return { text: W.flower, count: W.count(full, g.fullBloomTiles) };
    for (const t of ['solar', 'condenser', 'pollinator', 'droneHub'] as const) if (!p.built(t)) return { text: W.build(MACHINES[t].name) };
    if (!p.built('motherTree')) return { text: W.plant(MACHINES.motherTree.name) };
    return { text: W.wakeFountain };
  }
  const id = sim.areas.nextGoal();
  if (!id) return { text: W.explore };
  const a = sim.areas.info(id);
  const region = AREA_TYPES[a.type].name.toLowerCase();
  if (sim.areas.ready(id)) return { text: W.wake(a.landmarkName, region) };
  const c = sim.areas.counts(id);
  const need = sim.areas.need(id);
  return { text: W.clear(region), count: W.count(Math.min(c.restored, need), need) };
}

/** Resource emoji inside game strings (drawn as icons by `iconize`). */
const RES_EMOJI = { energy: '⚡', water: '💧', biomass: '🌿' } as const;

/**
 * E22.5 (#342): the objective card, top left, with the tutorial hint and the advisor's suggestion (classic
 * rules). Under old-city rules the card is one sentence (oldCityObjective) and the hint strip is not shown.
 */
export class ObjectiveCard extends HudPart {
  private hintDismissedStep = -1;

  wire() {
    const r = this.root;
    $(r, '#coreBtn').addEventListener('click', () => this.cb.activateCore());
    $(r, '#hint button').addEventListener('click', () => {
      this.hintDismissedStep = this.sim.state.progression.tutorialStep;
      $(r, '#hint').classList.add('hide');
    });
    $(r, '#objToggle').addEventListener('click', () => {
      const open = $(r, '#obj').classList.toggle('expanded');
      const t = $(r, '#objToggle');
      t.setAttribute('aria-expanded', String(open));
      t.setAttribute('aria-label', open ? 'Hide objective details' : 'Show objective details');
    });
    $(r, '#obj').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const wk = t.closest<HTMLButtonElement>('[data-wake]');
      if (wk && !wk.disabled) this.cb.wake(wk.dataset.wake!);
      const fo = t.closest<HTMLButtonElement>('[data-focus]');
      if (fo) {
        const [x, z] = fo.dataset.focus!.split(',').map(Number);
        this.cb.focusTile(x, z);
        if (fo.dataset.tool) this.cb.selectTool(fo.dataset.tool as Tool);
      }
      if (t.closest('[data-harvest]')) this.cb.harvest();
      const ia = t.closest<HTMLButtonElement>('[data-inspect-at]');
      if (ia) this.cb.inspectAt(ia.dataset.inspectAt!);
      const db = t.closest<HTMLButtonElement>('[data-district]');
      if (db && !db.disabled) this.cb.districtBloom(db.dataset.district!, db.dataset.replay === '1');
      if (fo || wk || db || ia || t.closest('[data-upg]') || t.closest('[data-harvest]')) this.suggestionAt = -1;
    });
  }

  private nudgeUntil = 0;
  private nudgeSel = '';
  /** Briefly highlight a control (e.g. Harvest when energy runs out). */
  nudge(sel: string, secs = 4) {
    if (this.settings.potter) return; // E19.4.3: the potter-about pace never nudges
    this.nudgeSel = sel;
    this.nudgeUntil = performance.now() + secs * 1000;
  }

  /** "24/80🌿" for what's short, or the plain cost when affordable. */
  private costShort(cost: Cost): string {
    const s = this.sim;
    if (s.econ.canAfford(cost)) return formatCost(cost);
    return KINDS.filter((k) => Economy.part(cost, k).gt(s.econ.get(k)))
      .map((k) => `${fmt(s.econ.get(k))}/${fmt(Economy.part(cost, k).ceil())}${RES_EMOJI[k]}`)
      .join(' ');
  }


  /** The current tutorial hint, written from live numbers, plus the control it refers to. */
  private hintFor(step: number): { text: string; target?: string } {
    const s = this.sim;
    const n = s.progression.restoredCount(HOME);
    // Phase 4 E02.3: one short line each, written from live numbers ("Build a Drone Hub · 24/80🌿").
    const build = (t: BuildableType, why: string) => ({
      text: `${why} Build a ${MACHINES[t].icon} ${MACHINES[t].name} · ${this.costShort(s.build.cost(t))}`,
      target: `#buildTray [data-tool="${t}"]`,
    });
    switch (step) {
      case 0:
        return { text: `Walk up to a grey tile and press ${this.cb.keyFor('pulse')} to bring it back to life ✨` };
      case 1:
      case 2: {
        if (step === 1) return { text: `Green tiles grow 🌿. Restore a few more · ${n}/4` };
        return build('solar', 'Steady energy:');
      }
      case 3:
        return build('condenser', 'Steady water:');
      case 4:
        return build('pollinator', 'Plants help each other:');
      case 5:
        return { text: 'Restore a tile next to your 🌸 garden for a Bloom Chain' };
      case 6:
        return build('droneHub', 'Let drones help:');
      case 7: {
        const full = s.progression.fullBloomCount(HOME);
        const missing = SEED_CORE_MACHINES.filter((t) => !s.progression.built(t));
        if (missing.length) return build(missing[0], 'The fountain needs it:');
        const g = TUNING.park;
        return n < g.restoredTiles
          ? { text: `Restore the park · ${n}/${g.restoredTiles}`, target: '#obj' }
          : { text: `Pulse green tiles until they're in full bloom · ${full}/${g.fullBloomTiles}`, target: '#obj' };
      }
      case 8:
        return { text: `The fountain is ready: walk up and press ${this.cb.keyFor('interact')}, or use ✨ Wake the fountain`, target: '#coreBtn' };
      default:
        return this.hoodHint();
    }
  }

  /** The city objective after the fountain: the next area to clear. Returns the "Next:" line. */
  private suggestionAt = -1;
  private suggestionBtn = '';
  /** The advisor's next step as a button (recomputed twice a second; it scans the fog edge). */
  private suggestionHtml(): string {
    const now = performance.now();
    if (now - this.suggestionAt < 500) return this.suggestionBtn;
    this.suggestionAt = now;
    const g = advisorStep(this.sim, !!this.settings.potter);
    if (!g) return (this.suggestionBtn = '');
    const a = g.action;
    const attr =
      a.kind === 'wake' ? `data-wake="${a.machineId}"` : a.kind === 'focus' ? `data-focus="${a.x + (a.layer ? (this.sim.grid.layer(a.layer)?.origin[0] ?? 0) : 0)},${a.z + (a.layer ? (this.sim.grid.layer(a.layer)?.origin[2] ?? 0) : 0)}"` : 'disabled';
    this.suggestionBtn = `<p class="sugg">${esc(g.text)}</p><button class="act" ${attr}>${esc(g.label)}</button>`;
    return this.suggestionBtn;
  }

  private cityObjective(): string {
    const s = this.sim;
    const id = s.areas.nextGoal();
    const objList = $(this.root, '#objList');
    if (!id) {
      this.set('objTitle', $(this.root, '#objTitle'), 'text', '🌫️ Push back the fog');
      this.set('objList', objList, 'html', '');
      this.set('objAct', $(this.root, '#objAct'), 'html', this.suggestionHtml());
      return '';
    }
    const a = s.areas.info(id);
    const def = AREA_TYPES[a.type];
    const c = s.areas.counts(id);
    const need = s.areas.need(id);
    const pct = Math.min(100, Math.round((c.restored / Math.max(1, need)) * 100));
    const cleared = s.areas.revealed().filter((x) => s.areas.fog(x) === 'cleared').length;
    this.set('objTitle', $(this.root, '#objTitle'), 'text', `${def.icon} Clear the ${def.name.toLowerCase()}`);
    this.set('objPct', $(this.root, '#objPct'), 'text', `${a.landmarkName}: ${Math.min(c.restored, need)}/${need} tiles · ${cleared} area${cleared === 1 ? '' : 's'} cleared`);
    this.set('objBar', $(this.root, '#objBar'), 'width', `${pct}%`);
    const ready = s.areas.ready(id);
    const fr = s.advisor.nearestFrontier();
    const frontier = fr && fr.areaId !== id && !this.settings.potter ? `<li><span class="ck">·</span>Nearest frontier: the ${esc(fr.name.toLowerCase())}, ${fr.distance} block${fr.distance === 1 ? '' : 's'} out (${Math.round(fr.share * 100)}% restored)</li>` : '';
    this.set(
      'objList',
      objList,
      'html',
      `<li class="${c.restored >= need ? 'done' : ''}"><span class="ck">${c.restored >= need ? '✓' : ''}</span>Restore ${need} tiles of the ${esc(def.name.toLowerCase())} (next to clear ground first)</li>` +
        `<li><span class="ck"></span>Wake the ${esc(a.landmarkName)}</li>${frontier}`,
    );
    // The suggested next step sits outside the checklist, so it stays visible when the list is collapsed.
    this.set('objAct', $(this.root, '#objAct'), 'html', this.suggestionHtml());
    if (ready) return '';
    return `Next: restore the ${def.name.toLowerCase()} (${Math.min(c.restored, need)}/${need})`;
  }

  /** After the fountain: hints follow the city objective. */
  private hoodHint(): { text: string; target?: string } {
    const s = this.sim;
    {
      const id = s.areas.nextGoal();
      if (!id) return { text: 'The fog is gone from everything you can reach. Keep growing your gardens.' };
      const a = s.areas.info(id);
      return s.areas.ready(id)
        ? { text: `The ${a.landmarkName} is ready. Wake it to clear this area's fog and reveal what lies beyond.`, target: '#objAct [data-wake]' }
        : { text: `The fog recedes tile by tile: restore tiles touching clear ground. Drones, chains and Wide Pulse all help push it back.` };
    }
    return { text: 'Restore the park and wake its fountain.' };
  }

  update() {
    const s = this.sim;
    // Objective
    const p = s.progression;
    const restored = p.restoredCount(HOME);
    const total = p.restorableCount(HOME);
    const pct = Math.round((restored / Math.max(1, total)) * 100);
    let hoodNext = '';
    // E21.8 / E21.12: the Old City pins one request (a Keeper's, else the next fountain step)
    const ocard = s.oldCity ? oldCityCard(s) : undefined;
    if (ocard) {
      this.set('objTitle', $(this.root, '#objTitle'), 'text', ocard.title);
      this.set('objPct', $(this.root, '#objPct'), 'text', ocard.pct);
      this.set('objBar', $(this.root, '#objBar'), 'width', `${Math.round(ocard.bar * 100)}%`);
      this.set('objList', $(this.root, '#objList'), 'html', ocard.list.map((r) => `<li class="${r.done ? 'done' : ''}"><span class="ck">${r.done ? '✓' : ''}</span>${esc(r.label)}</li>`).join(''));
      this.set('objAct', $(this.root, '#objAct'), 'html', '');
      hoodNext = ocard.next;
    } else if (s.state.progression.coreActivated) {
      hoodNext = this.cityObjective();
    } else {
      this.set('objAct', $(this.root, '#objAct'), 'html', p.homeIsPark ? this.suggestionHtml() : '');
      const nm = p.nextMilestone();
      this.set('objPct', $(this.root, '#objPct'), 'text', `${restored}/${total} park tiles${nm ? ` · next reward at ${nm.at} 🌱` : ''}`);
      this.set('objBar', $(this.root, '#objBar'), 'width', `${pct}%`);
      const reqs = p.requirements();
      const html = reqs.map((r) => `<li class="${r.done ? 'done' : ''}"><span class="ck">${r.done ? '✓' : ''}</span>${esc(r.label)}</li>`).join('');
      this.set('objList', $(this.root, '#objList'), 'html', html);
    }
    const ready = p.coreReady();
    // Look 5.8: the card's checkbox ticks (with a flourish) once the current goal is ready to complete.
    const goal = s.state.progression.coreActivated ? s.areas.nextGoal() : undefined;
    const done = ocard ? ocard.done : s.state.progression.coreActivated ? !!goal && s.areas.ready(goal) : ready;
    this.set('objDone', $(this.root, '#obj'), 'cls', done ? '1' : '0', 'done');
    this.set('objDoneLabel', $(this.root, '#objCheck'), 'title', done ? 'Ready: complete it now' : 'Not done yet');
    $(this.root, '#objCheck').setAttribute('aria-label', done ? 'Ready to complete' : 'Not done yet');
    const coreBtn = $(this.root, '#coreBtn');
    this.set('coreBtn', coreBtn, 'cls', ready ? '1' : '0', 'show');
    this.set('coreBtnText', coreBtn, 'text', `✨ ${p.homeIsPark ? 'Wake the fountain' : 'Awaken the Core'} · ${formatCost(TUNING.core.cost)}`);

    if (this.hud.oldCity) this.updateOldCity();

    // Hint
    const step = s.state.progression.tutorialStep;
    const hint = $(this.root, '#hint');
    const h = s.oldCity ? oldCityHint(s, step, (a) => this.cb.keyFor(a)) : this.hintFor(step); // E21.12
    const showHint = this.settings.hints && !this.settings.potter && step !== this.hintDismissedStep && !this.hud.introOpen;
    this.set('hintText', $(this.root, '#hintText'), 'text', h.text);
    this.set('hintShow', hint, 'cls', showHint ? '0' : '1', 'hide');
    // Glow the control the hint talks about (or a temporary nudge). On phones, machine cards live in the Build tray.
    let target = this.settings.potter ? '' : performance.now() < this.nudgeUntil ? this.nudgeSel : this.settings.hints ? (h.target ?? '') : '';
    const tray = $(this.root, '#buildTray');
    if (target.startsWith('#buildTray') && !tray.classList.contains('open')) target = '#buildToggle';
    if (this.last.get('nudgeTarget') !== target) {
      this.root.querySelectorAll('.nudge').forEach((e) => e.classList.remove('nudge'));
      if (target) this.root.querySelector(target)?.classList.add('nudge');
      this.last.set('nudgeTarget', target);
    }
    // "Next:" line (visible on phones, where the checklist is collapsed)
    const nextReq = s.state.progression.coreActivated ? undefined : p.requirements().find((r) => !r.done);
    const nm = s.state.progression.coreActivated ? undefined : p.nextMilestone();
    const nextText = ocard || s.state.progression.coreActivated ? hoodNext : ready ? 'Next: wake the fountain ✨' : nextReq ? `Next: ${nextReq.label}${nm && nextReq.label.startsWith('Restore') ? ` · 🌱 reward at ${nm.at}` : ''}` : '';
    // "Next:" is dropped on phones (CSS), so the goal itself fits on one line.
    this.set('objNext', $(this.root, '#objNext'), 'html', nextText.startsWith('Next: ') ? `<span class="nx">Next: </span>${esc(nextText.slice(6))}` : esc(nextText));

  }

  /** E22.10: the old-city sentence. */
  private advice?: Suggestion;
  private adviceAt = -Infinity;
  private updateOldCity() {
    // E23.1.5: the advisor is asked at most twice a second (it scans tiles)
    const now = performance.now();
    if (now - this.adviceAt > 500) {
      this.adviceAt = now;
      this.advice = this.sim.advisor.suggest();
    }
    const o = objectiveSentence(this.sim, this.advice);
    this.set('objTitle', $(this.root, '#objTitle'), 'html', `${esc(o.text)}${o.count ? ` <span class="ocount">${esc(o.count)}</span>` : ''}`);
  }
}
