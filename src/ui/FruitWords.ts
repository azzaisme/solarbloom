import type { FruitPhase } from '../data/farmExtras';

/**
 * #785: what a fruit tree looks like, in words a player can check against the tree itself (docs/design/
 * PLAIN_WORDS.md). The same words in its panel, its hover tip and the Interact prompt.
 */
export const FRUIT_SAY: Record<FruitPhase, string> = {
  young: 'Still growing. Once it’s grown it flowers, then fruits every day.',
  bare: 'Picked clean. The branches rest a little, then flower again.',
  blossom: 'In flower. Little green fruit will set soon.',
  green: 'Small green fruit, swelling on the branches. Not ripe yet.',
  nearly: 'The fruit is colouring up. Nearly ripe.',
  ripe: 'Ripe fruit hangs from the branches, ready to pick.',
};

/** A short state for the Interact prompt while there's nothing to pick ("Look at the Fruit tree: in flower"). */
export const FRUIT_SHORT: Record<FruitPhase, string> = {
  young: 'still growing',
  bare: 'picked clean',
  blossom: 'in flower',
  green: 'green fruit',
  nearly: 'nearly ripe',
  ripe: 'ripe',
};

/** The tree's hover tip line: its state, then what to do (keys as `{interact}`, filled in by the HUD). */
export function fruitTip(phase: FruitPhase, overgrown: boolean): string {
  const what = phase === 'ripe' ? `<span class="ok">${FRUIT_SAY.ripe} Hold {interact} to pick it.</span>` : FRUIT_SAY[phase];
  return overgrown ? `${what}<br>It’s getting shaggy: prune it for Timber.` : what;
}
