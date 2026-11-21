import { $, esc, HudPart } from './HudPart';
import type { Sim } from '../gameplay/Sim';
import type { Place, Suggestion, SuggestionAction } from '../gameplay/Advisor';
import { WORDS } from './words';
import { pinnedRequest as pinnedKeeper } from './BackpackModel';
import { MATERIALS } from '../data/salvage';
import { itemDef } from '../data/items';
import type { ItemId, MaterialId } from '../core/types';
import { oldCityHint } from './OldCityGuide';

/**
 * E22.10 (#348) / E22.5 (#342): the objective card (top left). #605 (E24): the goal stays on top for as long as the
 * fountain has a step to go: what it is, what it brings, and every part of it from the start (materials and park
 * together, each "12 of 20"). Under it, one next step: a shortage in the loop, else the pinned Keeper request, else
 * the advisor's step towards the fountain. A count appears only for things gathered or restored by hand.
 */
export interface Objective {
  /** the goal, one plain line */
  text: string;
  /** #605: what the goal brings ("Bloombot learns to pry open rubble") */
  why?: string;
  /** #605: every part of the goal, each counted ("Scrap 4 of 20", "Park 12 of 60") */
  parts?: ObjectivePart[];
  /** "12 of 20", only for things done by hand (a goal with no parts) */
  count?: string;
  /** how far along the goal is, 0..1 (the card's thin bar) */
  progress?: number;
  /** #605: the next step under the goal: a shortage, a request or the advisor's step (never replacing the goal) */
  next?: string;
  /** the next step's topic (a 'charge' shortage turns the badge to sun) */
  topic?: Suggestion['topic'];
  /** #605: where "Show me where" points for the next step */
  where?: SuggestionAction;
  /** #605 / #609: what it points at ("the fountain", "Tally"): ui/GoalSpot.ts turns where + place into the goal spot */
  place?: Place;
}

export interface ObjectivePart {
  /** "Scrap", "Park" */
  label: string;
  icon?: string;
  have: number;
  need: number;
}

/** E23.1.5: the advisor's topics that come before any request: a shortage in the loop the player should see now. #605: the farm is never one of them. */
const URGENT = new Set<Suggestion['topic']>(['charge', 'grid', 'water']);

/** #605: the fountain step's parts: what it still wants handed in, and its own condition (the park, or landmarks). */
export function fountainParts(sim: Sim): ObjectivePart[] {
  const f = sim.fountain;
  const t = f.next();
  if (!t) return [];
  const W = WORDS.objective;
  const parts: ObjectivePart[] = (Object.keys(t.delivery) as (MaterialId | 'biomass')[])
    .filter((k) => k !== 'biomass')
    .map((k) => {
      const m = MATERIALS[k as MaterialId];
      const need = t.delivery[k] ?? 0;
      return { label: m.name, icon: m.icon, have: Math.min(need, f.given(k as MaterialId)), need };
    });
  const owned = sim.state.salvage?.items ?? [];
  for (const i of t.items ?? []) parts.push({ label: itemDef(i as ItemId).name, icon: itemDef(i as ItemId).icon, have: owned.includes(i) ? 1 : 0, need: 1 });
  const c = f.condition(t);
  parts.push({ label: t.needs.parkTiles !== undefined ? W.park : W.landmarks, icon: t.needs.parkTiles !== undefined ? '🌿' : '✨', have: Math.min(c.have, c.need), need: c.need });
  return parts;
}

/**
 * The sentence. E23.1.5: the advisor speaks through it (the hint strip is hidden under the calm HUD): a shortage in
 * the loop first, then the pinned request, then the fountain, and the advisor's next step once the fountain is done.
 * `advice` is the advisor's current suggestion (the card asks for it twice a second; tests may leave it out).
 */
export function objectiveSentence(sim: Sim, advice: Suggestion | undefined = sim.advisor.suggest()): Objective {
  const W = WORDS.objective;
  const next = nextStep(sim, advice);
  const f = sim.fountain;
  const t = f.next();
  // after the last step: the advisor's step is the goal (nothing is left to wait under)
  if (!t) return { text: advice?.text ?? W.explore, topic: advice?.topic, where: advice?.action, place: advice?.place };
  const parts = fountainParts(sim);
  const progress = parts.reduce((a, p) => a + (p.need > 0 ? p.have / p.need : 1), 0) / Math.max(1, parts.length);
  return {
    text: f.canAdvance() ? W.fountainReady(t.tier) : W.fountain(t.tier, t.name),
    why: t.ability ? W.why[t.ability] : W.why.bloom,
    parts,
    progress,
    ...next,
  };
}

/**
 * #605: the one step under the goal: a shortage in the loop first (charge, power, water), then the pinned Keeper
 * request (E21.8, with its patch's count while it is restored by hand), then the advisor's step towards the fountain.
 * The farm's hint only ever comes last (never above the fountain's own step).
 */
function nextStep(sim: Sim, advice: Suggestion | undefined): Pick<Objective, 'next' | 'topic' | 'where' | 'place' | 'count'> {
  if (advice && URGENT.has(advice.topic)) return { next: advice.text, topic: advice.topic, where: advice.action, place: advice.place };
  const pinned = pinnedKeeper(sim); // E22.6: the request the player pinned, else the first open one
  if (pinned) {
    const step = sim.keepers.step(pinned.id);
    const p = step === 'request2' ? sim.keepers.patch(pinned.id) : undefined;
    const k = sim.keepers.def(pinned.id);
    return { next: p ? `${pinned.text} (${WORDS.objective.count(Math.min(p.restored, p.total), p.total)})` : pinned.text, topic: 'keeper', where: { kind: 'focus', x: k.x, z: k.z }, place: { kind: 'keeper', name: k.name } };
  }
  const step = sim.advisor.fountainStep() ?? advice;
  return step ? { next: step.text, topic: step.topic, where: step.action, place: step.place } : {};
}

/**
 * E22.5 (#342) / E23.11: the objective card, top left (docs/art/ui-sunlit-glass/Walk.dc.html): a leaf badge with a
 * pin, the goal in one plain sentence and, when it counts things done by hand, a thin bar and "12 of 20". A shortage
 * of charge turns the badge to sun with a battery (WalkPad.dc.html). The card also carries the nudge glow (the first
 * steps point at it, and the game can nudge a control for a moment).
 */
export class ObjectiveCard extends HudPart {
  private advice?: Suggestion;
  /** #605: the card as last drawn (Show me where goes where its next step points) */
  current?: Objective;
  private hintTarget = '';
  private adviceAt = -Infinity;

  static template(): string {
    return `<div id="obj" class="sg-card" role="region" aria-label="Objective">
      <span class="sg-badge" id="objBadge" aria-hidden="true"><span class="sg-ic i-pin"></span></span>
      <div class="otx">
        <h3 id="objTitle">Wake the fountain</h3>
        <p class="owhy" id="objWhy" hidden></p>
        <ul class="oparts" id="objParts" aria-label="What it needs" hidden></ul>
        <div class="oprog" id="objProg" hidden><span class="sg-bar" aria-hidden="true"><i id="objBar"></i></span><span class="ocn" id="objCount"></span></div>
        <div class="onext" id="objNextRow" hidden><p id="objNext"></p><button type="button" class="owhere" id="objWhere" hidden></button></div>
      </div>
    </div>`;
  }

  /** #605: the card's Show me where, by mouse (the key and the pad button come through the game's input) */
  bind() {
    $(this.root, '#objWhere').addEventListener('click', () => this.showWhere());
  }

  /** #605: point the way to the card's next step (the "Show me where" action or button). */
  showWhere(): boolean {
    return this.cb.showWhere();
  }

  private nudgeUntil = 0;
  private nudgeSel = '';
  /** Briefly highlight a control. */
  nudge(sel: string, secs = 4) {
    if (this.settings.potter) return; // E19.4.3: the potter-about pace never nudges
    this.nudgeSel = sel;
    this.nudgeUntil = performance.now() + secs * 1000;
  }

  update() {
    const s = this.sim;
    // E22.10: the plain sentence (E23.1.5: the advisor is asked at most twice a second; it scans tiles). The first
    // steps' guide is asked as often, for the control it points at.
    const now = performance.now();
    if (now - this.adviceAt > 500) {
      this.adviceAt = now;
      this.advice = s.advisor.suggest();
      this.hintTarget = oldCityHint(s, s.state.progression.tutorialStep, (a) => this.cb.keyFor(a)).target ?? '';
    }
    const o = objectiveSentence(s, this.advice);
    this.current = o;
    const r = this.root;
    this.set('objTitle', $(r, '#objTitle'), 'text', o.text);
    // #605: what the goal brings, and every part of it, counted from the start
    const why = $(r, '#objWhy');
    if (why.hidden !== !o.why) why.hidden = !o.why;
    if (o.why) this.set('objWhy', why, 'text', o.why);
    const parts = $(r, '#objParts');
    if (parts.hidden !== !o.parts?.length) parts.hidden = !o.parts?.length;
    if (o.parts?.length)
      this.set(
        'objParts',
        parts,
        'html',
        o.parts
          .map((p) => `<li class="${p.have >= p.need ? 'done' : ''}" data-part="${esc(p.label)}"><span class="oi" aria-hidden="true">${p.have >= p.need ? '✓' : (p.icon ?? '')}</span>${esc(p.label)} <b>${WORDS.objective.count(p.have, p.need)}</b></li>`)
          .join(''),
      );
    // the thin bar: the whole goal (its parts), or the one count a goal without parts has
    const bar = o.parts?.length ? o.progress : o.count ? o.progress : undefined;
    const prog = $(r, '#objProg');
    if (prog.hidden !== (bar === undefined)) prog.hidden = bar === undefined;
    if (bar !== undefined) {
      this.set('objCount', $(r, '#objCount'), 'text', o.parts?.length ? '' : (o.count ?? ''));
      this.set('objBar', $(r, '#objBar'), 'width', `${Math.round(Math.max(0, Math.min(1, bar)) * 100)}%`);
    }
    // #605: the next step under the goal, with "Show me where" when it has a place
    const row = $(r, '#objNextRow');
    if (row.hidden !== !o.next) row.hidden = !o.next;
    if (o.next) this.set('objNext', $(r, '#objNext'), 'text', o.next);
    const where = $(r, '#objWhere');
    const canShow = o.where?.kind === 'focus' || o.where?.kind === 'wake';
    if (where.hidden !== !canShow) where.hidden = !canShow;
    if (canShow) this.set('objWhere', where, 'html', `${this.cb.glyph('showWhere')}<span>${WORDS.objective.showWhere}</span>`);
    // charge running low: the sun badge with a battery
    const low = o.topic === 'charge';
    if (this.last.get('objBadge') !== String(low)) {
      this.last.set('objBadge', String(low));
      const badge = $(r, '#objBadge');
      badge.classList.toggle('sun', low);
      badge.innerHTML = `<span class="sg-ic ${low ? 'i-cell' : 'i-pin'}"></span>`;
    }
    // Glow the control the first steps talk about (or a temporary nudge).
    const target = this.settings.potter ? '' : now < this.nudgeUntil ? this.nudgeSel : this.settings.hints ? this.hintTarget : '';
    if (this.last.get('nudgeTarget') !== target) {
      r.querySelectorAll('.nudge').forEach((e) => e.classList.remove('nudge'));
      if (target) r.querySelector(target)?.classList.add('nudge');
      this.last.set('nudgeTarget', target);
    }
  }
}
