import { $, esc, HudPart } from './HudPart';
import type { Sim } from '../gameplay/Sim';
import type { Place, Suggestion, SuggestionAction } from '../gameplay/Advisor';
import { nearestByFoot } from '../gameplay/Advisor';
import { WORDS, withKeys } from './words';
import { pinnedRequest as pinnedKeeper } from './BackpackModel';
import { MATERIALS } from '../data/salvage';
import { itemDef } from '../data/items';
import type { ItemId, MaterialId } from '../core/types';
import { earlyPowerHint, oldCityHint } from './OldCityGuide';
import { ITEMS, REGIONS, type RegionDef } from '../data/oldcity';

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
  /** #620: a few words before `why` that the card drops first when room is short ("The fountain's next step.") */
  lead?: string;
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
  patchKeeperId?: string;
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

/**
 * #605: the fountain step's parts: each material (handed in plus carried, so salvaging counts at once), its items,
 * and its own condition (the park, or landmarks).
 */
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
      // what is handed in plus what bloombot carries: salvaging counts the moment it lands in the backpack
      return { label: m.name, icon: m.icon, have: Math.min(need, f.given(k as MaterialId) + sim.inventory.available(k as MaterialId)), need };
    });
  const owned = sim.state.salvage?.items ?? [];
  // the Great Bloom's one-off finds (the Heart Seed, the Star Lens) are the Old City's own items, not crafted ones
  for (const i of t.items ?? []) {
    const d = ITEMS[i] ?? itemDef(i as ItemId);
    parts.push({ label: d?.name ?? i, icon: '✨', have: owned.includes(i) ? 1 : 0, need: 1 });
  }
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
  // after the fountain wakes, until the first pry: the rubble is the goal (the step after can wait)
  const rubble = firstRubble(sim);
  if (rubble) {
    const [x, z] = rubble.gate.cells[0];
    const urgent = advice && URGENT.has(advice.topic) ? next : undefined;
    return {
      text: W.pry,
      why: W.pryWhy,
      next: urgent?.next ?? W.pryNext,
      topic: urgent?.topic ?? 'keeper',
      where: urgent?.where ?? { kind: 'focus', x, z },
      place: urgent ? urgent.place : { kind: 'gate', name: `the rubble into ${rubble.name}` },
    };
  }
  const parts = fountainParts(sim);
  const progress = parts.reduce((a, p) => a + (p.need > 0 ? p.have / p.need : 1), 0) / Math.max(1, parts.length);
  return {
    text: W.fountain(t.tier, t.name),
    why: t.ability ? W.why[t.ability] : W.why.bloom,
    lead: t.tier > 1 ? W.nextLead : undefined,
    parts,
    progress,
    ...next,
    // everything is in: say so under the goal (unless something urgent is there)
    ...(f.canAdvance() && !(advice && URGENT.has(advice.topic)) ? { next: W.fountainReady(t.tier) } : {}),
  };
}

/**
 * #605: bloombot can pry and hasn't yet: the shut rubble nearest it that pry opens (the first Keeper's way in), so
 * the card leads there before the fountain's next step. Undefined once any rubble is pried.
 */
export function firstRubble(sim: Sim): RegionDef | undefined {
  const sv = sim.state.salvage;
  if (!sv?.abilities.includes('pry')) return undefined;
  const pry = REGIONS.filter((r) => r.gate.needs.ability === 'pry');
  if (pry.some((r) => sim.gates.isOpen(r.gate.id))) return undefined;
  // #644: the rubble bloombot can walk up to soonest (one it can't reach only if it can reach none)
  // (a pry gate's only other bar is charge: running low never changes the goal, it shows under it)
  return nearestByFoot(sim, pry, (r) => ({ x: r.gate.cells[0][0], z: r.gate.cells[0][1] }));
}

/**
 * #605: the one step under the goal: a shortage in the loop first (charge, power, water), then the pinned Keeper
 * request (E21.8, with its patch's count while it is restored by hand), then the advisor's step towards the fountain.
 * The farm's hint only ever comes last (never above the fountain's own step).
 */
function nextStep(sim: Sim, advice: Suggestion | undefined): Pick<Objective, 'next' | 'topic' | 'where' | 'place' | 'count' | 'patchKeeperId'> {
  if (advice && URGENT.has(advice.topic)) return { next: advice.text, topic: advice.topic, where: advice.action, place: advice.place };
  const power = earlyPowerHint(sim);
  if (power) return { next: power, topic: 'grid' };
  const pinned = pinnedKeeper(sim); // E22.6: the request the player pinned, else the first open one
  if (pinned) {
    const step = sim.keepers.step(pinned.id);
    if (step === 'request2') {
      const { restored, total } = sim.keepers.patch(pinned.id);
      const patch = sim.keepers.region(pinned.id).patch;
      const left = total - restored;
      return {
        next: `Restore ${patch.name.toLowerCase()} · ${left} ${left === 1 ? 'tile' : 'tiles'} left`,
        topic: 'keeper',
        where: { kind: 'focus', x: patch.x + Math.floor(patch.w / 2), z: patch.z + Math.floor(patch.d / 2) },
        place: { kind: 'spot', name: patch.name },
        patchKeeperId: pinned.id,
      };
    }
    const k = sim.keepers.def(pinned.id);
    return { next: pinned.text, topic: 'keeper', where: { kind: 'focus', x: k.x, z: k.z }, place: { kind: 'keeper', name: k.name } };
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
    if (o.why) this.set('objWhy', why, 'html', `${o.lead ? `<span class="olead">${esc(o.lead)} </span>` : ''}${esc(o.why)}`);
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
    if (o.next) this.set('objNext', $(r, '#objNext'), 'text', withKeys(o.next, (a) => this.cb.keyFor(a)));
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
    // #620: the card never sits on the minimap. Measured a few times a second (and on any change of what it says),
    // since a step's parts, a long next step or a bigger interface size can each make it taller.
    const shape = `${o.text}|${o.why ?? ''}|${o.parts?.length ?? 0}|${o.next ?? ''}|${innerWidth}x${innerHeight}`;
    if (shape !== this.fitShape || now - this.fitAt > 1000) {
      this.fitShape = shape;
      this.fitAt = now;
      this.fit();
    }
  }

  private fitShape = '';
  private fitAt = -Infinity;

  /**
   * #620: make room between the card and the minimap below it, in as few steps as it takes:
   *   1. tight: the line under the title drops its lead-in ("The fountain's next step.") and keeps to one line;
   *   2. the minimap tucks down, smaller, into its corner.
   * The card keeps its width: a tall card over the corner beats a wide one over the middle of the scene.
   * Each step is tried only if the one before still overlaps. The minimap's N badge stands above its disc, so it counts.
   */
  fit() {
    const card = this.root.querySelector<HTMLElement>('#obj');
    const map = this.root.querySelector<HTMLElement>('#minimap');
    if (!card) return;
    card.classList.remove('tight');
    map?.classList.remove('tuck');
    if (!map || map.hidden || map.offsetParent === null) return;
    const clear = () => {
      const c = card.getBoundingClientRect();
      const m = map.getBoundingClientRect();
      const n = map.querySelector<HTMLElement>('.mm-n')?.getBoundingClientRect();
      const top = Math.min(m.top, n && n.height > 0 ? n.top : m.top);
      return c.bottom + 6 <= top || c.right <= m.left || c.left >= m.right;
    };
    if (clear()) return;
    card.classList.add('tight');
    if (clear()) return;
    map.classList.add('tuck');
  }
}
