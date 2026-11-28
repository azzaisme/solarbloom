import { decorSize } from '../data/cozy';
import { LIGHT } from '../data/lights';
import { decorType, furnitureType, laidTool, type Tool } from '../ui/Hud';

/**
 * Build mode's drag: can what is in hand be laid as a run (or, with Fill on, a patch) by holding Place and moving?
 * A pipe, a footpath, road or grass, a one-square decoration, or Remove. Pure, so the game and the tests agree.
 *
 * #875: a piece of the house's furniture never drags, Fill or not. There is only one of each piece, so a run of it
 * means nothing: Place puts it down whole on the square aimed at, as a single press, and the hand is free again.
 */
export function dragsAsRun(tool: Tool, rot: number): boolean {
  if (furnitureType(tool)) return false;
  if (tool === 'pipe' || tool === 'remove' || laidTool(tool)) return true;
  const dk = decorType(tool);
  if (!dk || LIGHT[dk]?.line) return false;
  const [w, d] = decorSize(dk, rot);
  return w === 1 && d === 1;
}
