import { fmt } from '../core/Big';
import { FAUNA, FAUNA_INFO, faunaGoal, type FaunaId } from '../gameplay/Ecosystem';
import type { Sim } from '../gameplay/Sim';
import { ICONS } from './Icons';

type Toast = (html: string, kind?: '' | 'gold' | 'cat', secs?: number) => void;

/**
 * Phase 5 E16: the biodiversity readout. A small chip in the objective panel's tool row (🌱 score) whose tap
 * shows the breakdown and what the next creature needs as a toast (nonblocking), plus the arrival toast when a
 * fauna kind unlocks. The score is display only: nothing is bought with it.
 */
export class EcoBadge {
  private el?: HTMLButtonElement;
  private num?: HTMLElement;
  private timer = 0;
  private shown = -1;

  constructor(
    private sim: Sim,
    private toast: Toast,
  ) {
    const tools = document.querySelector('#obj .tools');
    if (!tools) return;
    if (!document.getElementById('bioStyle')) {
      const st = document.createElement('style');
      st.id = 'bioStyle';
      st.textContent = '@keyframes bioPop{0%{transform:scale(1)}40%{transform:scale(1.25)}100%{transform:scale(1)}}#bioBtn.bio-pop{animation:bioPop .6s ease-out 2}body.reduced #bioBtn.bio-pop{animation:none}@media (max-width:360px){#bioScore{display:none}}'; // icon only on the narrowest phones (the objective keeps its count)
      document.head.appendChild(st);
    }
    const b = document.createElement('button');
    b.className = 'chip';
    b.id = 'bioBtn';
    b.setAttribute('aria-label', 'Biodiversity');
    b.innerHTML = `${ICONS.sprout} <span id="bioScore">0</span>`;
    b.addEventListener('click', () => this.explain());
    tools.insertBefore(b, tools.querySelector('#setBtn'));
    this.el = b;
    this.num = b.querySelector('#bioScore') as HTMLElement;
  }

  update(dt: number) {
    this.timer -= dt;
    if (this.timer > 0 || !this.el) return;
    this.timer = 1;
    const b = this.sim.ecosystem.score();
    if (b.score === this.shown) return;
    this.shown = b.score;
    this.num!.textContent = fmt(b.score);
    this.el.title = `Biodiversity ${fmt(b.score)} · ${b.rank}`;
  }

  /** A fauna kind arrived: a short toast and a little bounce on the chip. */
  arrived(id: FaunaId) {
    const f = FAUNA_INFO[id];
    this.toast(`${f.icon} ${f.name} have arrived!<small>${f.line} Biodiversity rises.</small>`, 'gold', 4.5);
    this.shown = -1;
    this.timer = 0;
    if (this.el) {
      this.el.classList.remove('bio-pop');
      void this.el.offsetWidth;
      this.el.classList.add('bio-pop');
    }
  }

  private explain() {
    const eco = this.sim.ecosystem;
    const b = eco.score();
    const p = b.parts;
    const have = eco.unlocked();
    const next = FAUNA.find((id) => !have.includes(id));
    const goal = next ? faunaGoal(next, eco.bio) : undefined;
    const lines = [
      `tiles ${fmt(p.stages)} · tree species ${eco.bio.species} · ground kinds ${eco.bio.features} · landmarks ${eco.bio.landmarks} · superstructures ${eco.bio.supers}`,
      have.length ? `living here: ${have.map((id) => FAUNA_INFO[id].icon).join(' ')}` : 'no creatures yet',
      next && goal ? `next: ${FAUNA_INFO[next].icon} ${FAUNA_INFO[next].name} at ${goal.need} ${goal.label} (${Math.min(goal.have, goal.need)}/${goal.need})` : 'every creature has arrived',
      b.next ? `${b.next.rank} at ${fmt(b.next.at)}` : '',
    ].filter(Boolean);
    this.toast(`🌱 Biodiversity ${fmt(b.score)} · ${b.rank}<small>${lines.join('<br>')}</small>`, '', 6);
  }
}
