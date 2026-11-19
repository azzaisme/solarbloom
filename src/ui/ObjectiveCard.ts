import { $, esc, HudPart } from './HudPart';
import type { Sim } from '../gameplay/Sim';
import type { Suggestion } from '../gameplay/Advisor';
import { WORDS } from './words';
import { pinnedRequest as pinnedKeeper } from './BackpackModel';
import { MATERIALS } from '../data/salvage';
import type { MaterialId } from '../core/types';
import { oldCityHint, oldCityObjective as oldCityCard } from './OldCityGuide';

/**
 * E22.10 (#348) / E22.5 (#342): the objective card (top left). It is one plain sentence about a thing and a place:
 * the pinned request (E21), or else the next step at the fountain or in the city. A count appears only for things
 * gathered or restored by hand, as "12 of 20".
 */
export interface Objective {
  text: string;
  /** "12 of 20", only for things done by hand */
  count?: string;
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

/**
 * E22.5 (#342): the objective card, with the hint strip under it. The card pins one request (a Keeper's, else the
 * next fountain tier); the hint strip walks the first fifteen minutes, then carries the advisor's next step (E23.1.5).
 */
export class ObjectiveCard extends HudPart {
  private hintDismissedStep = -1;
  private advice?: Suggestion;
  private adviceAt = -Infinity;

  wire() {
    const r = this.root;
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
    // E21.8 / E21.12: one pinned request (a Keeper's, else the next fountain step)
    const ocard = oldCityCard(s);
    this.set('objTitle', $(this.root, '#objTitle'), 'text', ocard.title);
    this.set('objPct', $(this.root, '#objPct'), 'text', ocard.pct);
    this.set('objBar', $(this.root, '#objBar'), 'width', `${Math.round(ocard.bar * 100)}%`);
    this.set('objList', $(this.root, '#objList'), 'html', ocard.list.map((r) => `<li class="${r.done ? 'done' : ''}"><span class="ck">${r.done ? '✓' : ''}</span>${esc(r.label)}</li>`).join(''));
    this.set('objAct', $(this.root, '#objAct'), 'html', '');
    // Look 5.8: the card's checkbox ticks (with a flourish) once the current goal is ready to complete.
    this.set('objDone', $(this.root, '#obj'), 'cls', ocard.done ? '1' : '0', 'done');
    this.set('objDoneLabel', $(this.root, '#objCheck'), 'title', ocard.done ? 'Ready: complete it now' : 'Not done yet');
    $(this.root, '#objCheck').setAttribute('aria-label', ocard.done ? 'Ready to complete' : 'Not done yet');
    // E22.10: the plain sentence (E23.1.5: the advisor is asked at most twice a second; it scans tiles)
    const now = performance.now();
    if (now - this.adviceAt > 500) {
      this.adviceAt = now;
      this.advice = s.advisor.suggest();
    }
    const o = objectiveSentence(s, this.advice);
    this.set('objTitle', $(this.root, '#objTitle'), 'html', `${esc(o.text)}${o.count ? ` <span class="ocount">${esc(o.count)}</span>` : ''}`);

    // Hint: the first fifteen minutes, then the advisor (E21.12, E23.1.5)
    const step = s.state.progression.tutorialStep;
    const hint = $(this.root, '#hint');
    const h = oldCityHint(s, step, (a) => this.cb.keyFor(a));
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
    // "Next:" line (visible on phones, where the checklist is collapsed). "Next:" is dropped on phones (CSS).
    const nextText = ocard.next;
    this.set('objNext', $(this.root, '#objNext'), 'html', nextText.startsWith('Next: ') ? `<span class="nx">Next: </span>${esc(nextText.slice(6))}` : esc(nextText));
  }
}
