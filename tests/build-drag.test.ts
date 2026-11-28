import { describe, expect, it } from 'vitest';
import { dragsAsRun } from '../src/app/BuildDrag';

/**
 * #875 in the top-down build view: holding Place and moving lays a run (Fill: a patch) of what is in hand. A piece of
 * the house's furniture is one of a kind, so it never drags: Place puts it down whole where it is aimed.
 */
describe('what drags as a run in the build view', () => {
  it('a piece of the house’s furniture never drags, whichever way it is turned', () => {
    for (const id of ['bed', 'radio', 'chest', 'desk', 'table'])
      for (const rot of [0, 1, 2, 3]) expect(dragsAsRun(`furniture:${id}`, rot)).toBe(false);
  });

  it('a one-square piece (the radio, the chest) still doesn’t, though a one-square decoration does', () => {
    expect(dragsAsRun('decor:pot', 0)).toBe(true);
    expect(dragsAsRun('decor:sidetable', 0)).toBe(true);
    expect(dragsAsRun('furniture:radio', 0)).toBe(false);
    expect(dragsAsRun('furniture:chest', 0)).toBe(false);
  });

  it('runs are for pipes, the ground, Remove and one-square decorations, never for big ones', () => {
    expect(dragsAsRun('pipe', 0)).toBe(true);
    expect(dragsAsRun('footpath', 0)).toBe(true);
    expect(dragsAsRun('road', 0)).toBe(true);
    expect(dragsAsRun('grass', 0)).toBe(true);
    expect(dragsAsRun('remove', 0)).toBe(true);
    expect(dragsAsRun('decor:diningtable', 0)).toBe(false);
    expect(dragsAsRun('decor:diningtable', 1)).toBe(false);
    expect(dragsAsRun('pulse', 0)).toBe(false);
    expect(dragsAsRun('inspect', 0)).toBe(false);
  });
});
