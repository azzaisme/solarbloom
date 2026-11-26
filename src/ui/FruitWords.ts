import type { FruitPhase, OrchardSeasonRule } from '../data/farmExtras';
import { FRUITS, type FruitId } from '../data/fruit';

/**
 * #785: what a fruit tree looks like, in words a player can check against the tree itself (docs/design/
 * PLAIN_WORDS.md). The same words in its panel, its hover tip and the Interact prompt. Each tree names its own fruit
 * (apples, pears, peaches, lemons), and says what the season is doing to it (#830).
 */
export function fruitSay(kind: FruitId, phase: FruitPhase, rule: OrchardSeasonRule = { ripens: true, blossom: true }): string {
  const f = FRUITS[kind];
  const Some = f.plural[0].toUpperCase() + f.plural.slice(1);
  switch (phase) {
    case 'young':
      return rule.ripens || !rule.first
        ? `A young ${f.name.toLowerCase()} tree, still growing. Once it’s grown it flowers, then bears ${f.plural}.`
        : `A young ${f.name.toLowerCase()} tree, still growing. It rests through the winter and bears its first ${f.plural} in spring.`;
    case 'bare':
      if (!rule.ripens) return rule.first ? `Resting for the winter. In spring it flowers and bears its first ${f.plural}.` : `Resting for the winter. It flowers again in spring, and ${f.plural} come in summer.`;
      return rule.blossom ? 'Picked clean. The branches rest a little, then flower again.' : `Picked clean. New ${f.plural} will set again soon.`;
    case 'blossom':
      return rule.ripens ? `In flower. Little green ${f.plural} will set soon.` : `In flower for the spring. ${Some} come in summer.`;
    case 'green':
      return `Small green ${f.plural}, swelling on the branches. Not ripe yet.`;
    case 'nearly':
      return `The ${f.plural} are colouring up. Nearly ripe.`;
    case 'ripe':
      return `Ripe ${f.plural} hang from the branches, ready to pick.`;
  }
}

/** A short state for the Interact prompt while there's nothing to pick ("Look at the Fruit Tree: green pears"). */
export function fruitShort(kind: FruitId, phase: FruitPhase, rule: OrchardSeasonRule = { ripens: true, blossom: true }): string {
  const p = FRUITS[kind].plural;
  return { young: 'still growing', bare: rule.ripens ? 'picked clean' : 'resting for the winter', blossom: 'in flower', green: `green ${p}`, nearly: `${p} nearly ripe`, ripe: `ripe ${p}` }[phase];
}

/** The tree's hover tip line: its state, then what to do (keys as `{interact}`, filled in by the HUD). */
export function fruitTip(kind: FruitId, phase: FruitPhase, overgrown: boolean, cozy: boolean, rule?: OrchardSeasonRule): string {
  const say = fruitSay(kind, phase, rule);
  const what = phase === 'ripe' ? `<span class="ok">${say} Hold {interact} to pick them.</span>` : say;
  if (!overgrown) return what;
  return `${what}<br>${cozy ? 'It’s getting shaggy: prune it for Timber.' : 'It’s getting shaggy and will fruit less until it’s pruned for Timber.'}`;
}
