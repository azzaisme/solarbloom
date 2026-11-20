import { $, HudPart } from './HudPart';
import type { Sim } from '../gameplay/Sim';
import type { Suggestion } from '../gameplay/Advisor';
import { WORDS } from './words';
import { pinnedRequest as pinnedKeeper } from './BackpackModel';
import { MATERIALS } from '../data/salvage';
import type { MaterialId } from '../core/types';
import { oldCityHint } from './OldCityGuide';

/**
 * E22.10 (#348) / E22.5 (#342): the objective card (top left). It is one plain sentence about a thing and a place:
 * the pinned request (E21), or else the next step at the fountain or in the city. A count appears only for things
 * gathered or restored by hand, as "12 of 20".
 */
export interface Objective {
  text: string;
  /** "12 of 20", only for things done by hand */
  count?: string;
  /** how far along the count is, 0..1 (the card's thin bar) */
  progress?: number;
  /** the advisor's topic when the advisor speaks (a 'charge' shortage turns the badge to sun) */
  topic?: Suggestion['topic'];
}

/** E23.1.5: the advisor's topics that come before any request: a shortage in the loop the player should see now. */
const URGENT = new Set<Suggestion['topic']>(['charge', 'grid', 'water', 'farm']);

/**
 * The sentence. E23.1.5: the advisor speaks through it (the hint strip is hidden under the calm HUD): a shortage in
 * the loop first, then the pinned request, then the fountain, and the advisor's next step once the fountain is done.
 * `advice` is the advisor's current suggestion (the card asks for it twice a second; tests may leave it out).
 */
export function objectiveSentence(sim: Sim, advice: Suggestion | undefined = sim.advisor.suggest()): Objective {
  const W = WORDS.objective;
  if (advice && URGENT.has(advice.topic)) return { text: advice.text, topic: advice.topic };
  // E21.8: the pinned Keeper request (with a count only while its patch is restored by hand)
  const pinned = pinnedKeeper(sim); // E22.6: the request the player pinned, else the first open one
  if (pinned) {
    const step = sim.keepers.step(pinned.id);
    const p = step === 'request2' ? sim.keepers.patch(pinned.id) : undefined;
    return { text: pinned.text, count: p ? W.count(Math.min(p.restored, p.total), p.total) : undefined, progress: p && p.total > 0 ? Math.min(p.restored, p.total) / p.total : undefined };
  }
  // E21.6: the fountain's next step, by its name: what it still wants, then its own condition
  const f = sim.fountain;
  const t = f.next();
  if (!t) return { text: advice?.text ?? W.explore, topic: advice?.topic };
  const want = (Object.keys(t.delivery) as (MaterialId | 'biomass')[])
    .map((k) => [k, k === 'biomass' ? t.delivery[k]! : f.remaining(k as MaterialId)] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k === 'biomass' ? 'Greens' : MATERIALS[k as MaterialId].name}`);
  if (want.length) return { text: `Bring ${want.length > 1 ? `${want.slice(0, -1).join(', ')} and ${want[want.length - 1]}` : want[0]} to the fountain` };
  const c = f.condition(t);
  if (!c.done) return { text: c.label, count: W.count(Math.min(c.have, c.need), c.need), progress: c.need > 0 ? Math.min(c.have, c.need) / c.need : 0 };
  return { text: `${t.name}: the fountain is ready` };
}

/**
 * E22.5 (#342) / E23.11: the objective card, top left (docs/art/ui-sunlit-glass/Walk.dc.html): a leaf badge with a
 * pin, the goal in one plain sentence and, when it counts things done by hand, a thin bar and "12 of 20". A shortage
 * of charge turns the badge to sun with a battery (WalkPad.dc.html). The card also carries the nudge glow (the first
 * steps point at it, and the game can nudge a control for a moment).
 */
export class ObjectiveCard extends HudPart {
  private advice?: Suggestion;
  private hintTarget = '';
  private adviceAt = -Infinity;

  static template(): string {
    return `<div id="obj" class="sg-card" role="region" aria-label="Objective">
      <span class="sg-badge" id="objBadge" aria-hidden="true"><span class="sg-ic i-pin"></span></span>
      <div class="otx">
        <h3 id="objTitle">Wake the fountain</h3>
        <div class="oprog" id="objProg" hidden><span class="sg-bar" aria-hidden="true"><i id="objBar"></i></span><span class="ocn" id="objCount"></span></div>
      </div>
    </div>`;
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
    const r = this.root;
    this.set('objTitle', $(r, '#objTitle'), 'text', o.text);
    const prog = $(r, '#objProg');
    if (prog.hidden !== !o.count) prog.hidden = !o.count;
    if (o.count) {
      this.set('objCount', $(r, '#objCount'), 'text', o.count);
      this.set('objBar', $(r, '#objBar'), 'width', `${Math.round(Math.max(0, Math.min(1, o.progress ?? 0)) * 100)}%`);
    }
    // charge running low: the sun badge with a battery
    const low = o.topic === 'charge';
    if (this.last.get('objBadge') !== String(low)) {
      this.last.set('objBadge', String(low));
      const badge = $(r, '#objBadge');
      badge.classList.toggle('sun', low);
      badge.innerHTML = `<span class="sg-ic ${low ? 'i-cell' : 'i-pin'}"></span>`;
    }
    // Glow the control the first steps talk about (or a temporary nudge).
    let target = this.settings.potter ? '' : now < this.nudgeUntil ? this.nudgeSel : this.settings.hints ? this.hintTarget : '';
    const tray = r.querySelector('#buildTray');
    if (target.startsWith('#buildTray') && tray && !tray.classList.contains('open')) target = '#buildToggle';
    if (this.last.get('nudgeTarget') !== target) {
      r.querySelectorAll('.nudge').forEach((e) => e.classList.remove('nudge'));
      if (target) r.querySelector(target)?.classList.add('nudge');
      this.last.set('nudgeTarget', target);
    }
  }
}
