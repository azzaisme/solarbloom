import type { GameState } from '../core/types';

/**
 * E22: which rule set a game plays by. E21 adds `GameState.rules` ('oldcity' or 'classic'); until it lands every
 * game is classic. Presentation reads this through `isOldCity` only, so E22's old-city-only changes (the
 * stripped walking view, plain words, keys that lose their default) switch on by themselves when E21 does.
 *
 * `?ui=oldcity` (or `?ui=classic`) previews one rule set's presentation without touching the save: it is a
 * view setting for reviews and the e2e harness, never written to the state.
 */
export type Rules = 'oldcity' | 'classic';

let override: Rules | undefined;

/** Forces a rule set's presentation (tests, the `?ui=` preview). `undefined` follows the state again. */
export function setRulesView(r: Rules | undefined) {
  override = r;
}

export function rulesOf(state?: Pick<GameState, 'version'> | object): Rules {
  if (override) return override;
  return (state as { rules?: string } | undefined)?.rules === 'oldcity' ? 'oldcity' : 'classic';
}

/** True when the game plays by old-city rules (E21). False for every game until E21 adds the field. */
export function isOldCity(state?: object): boolean {
  return rulesOf(state) === 'oldcity';
}

/** Reads `?ui=oldcity|classic` once (browser only). */
export function rulesViewFromUrl() {
  if (typeof location === 'undefined') return;
  const v = new URLSearchParams(location.search).get('ui');
  if (v === 'oldcity' || v === 'classic') setRulesView(v);
}
