import type { Sim } from '../gameplay/Sim';

type Suggestion = ReturnType<Sim['advisor']['suggest']>;

/**
 * E19.4.3 (#262): the advisor's next step for the objective card, or nothing under the potter-about pace. The
 * advisor is asked either way, so the pace stays a presentation choice only (E23.1.5: asking it has no effects).
 */
export function advisorStep(sim: Sim, potter: boolean): Suggestion | undefined {
  const g = sim.advisor.suggest();
  return potter ? undefined : g;
}

/** Resource amounts, rates, percentages and multipliers in a toast's detail line. */
const NUMBERS = /\d\s*(?:⚡|💧|🌿)|[+−]\s?\d|\/min|\/s\b|\d\s?%|×\s?\d/u;

/**
 * E19.4.2 / E20.7: the calm HUD's toast. The headline stays; a `<small>` detail line made of numbers (rewards,
 * bonuses, multipliers) is dropped, while a detail line that says what to do next is kept.
 */
export function calmToast(html: string): string {
  const i = html.indexOf('<small>');
  if (i < 0) return html;
  return NUMBERS.test(html.slice(i)) ? html.slice(0, i) : html;
}
