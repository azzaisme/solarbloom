import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/GameState';
import { LOAD_WHEEL, PULSE_LOADS } from '../src/data/pulse';
import { Sim } from '../src/gameplay/Sim';
import type { Hud } from '../src/ui/Hud';
import { LoadWheel } from '../src/ui/LoadWheel';
import { readFileSync } from 'node:fs';

const hudCss = readFileSync(new URL('../src/ui/hud.css', import.meta.url), 'utf8');

/**
 * The load wheel on the Deck: while the ring is up, the arrow keys and the d-pad pick the load that way, the same
 * way the ring is drawn (hud.css), and the ring stays up. With the ring down they do their usual jobs.
 */

/** Which way each load sits on the ring, read from the CSS that draws it. */
function drawnAt(id: string): string {
  const m = new RegExp(`\\.lw-opt\\[data-load="${id}"\\] \\{ transform: translate([XY])\\((-?)\\d+px\\)`).exec(hudCss);
  expect(m, id).not.toBeNull();
  const [, axis, minus] = m!;
  return axis === 'Y' ? (minus ? 'up' : 'down') : minus ? 'left' : 'right';
}

describe('the load wheel takes the arrows and the d-pad', () => {
  it('each direction picks the load drawn that way, and every load has one', () => {
    const dirs = Object.entries(LOAD_WHEEL.directions);
    for (const [dir, id] of dirs) expect(drawnAt(id), id).toBe(dir);
    expect(new Set(dirs.map(([, id]) => id))).toEqual(new Set(PULSE_LOADS.map((l) => l.id)));
  });

  it('picks only while the ring is up, and keeps it up', () => {
    const sim = new Sim(createInitialState(7));
    const wheel = new LoadWheel({ sim } as unknown as Hud);
    expect(wheel.isOpen).toBe(false);
    expect(wheel.pick('right')).toBe(false); // the ring is down: the arrow walks, the d-pad does its own job
    expect(sim.pulseLoad.choice).toBe('none');
    wheel.show();
    wheel.update(LOAD_WHEEL.showSeconds - 0.1);
    expect(wheel.pick('right')).toBe(true);
    expect(sim.pulseLoad.choice).toBe('seeds');
    wheel.update(LOAD_WHEEL.showSeconds - 0.1); // picking kept it up
    expect(wheel.isOpen).toBe(true);
    expect(wheel.pick('left')).toBe(true);
    expect(sim.pulseLoad.choice).toBe('fertiliser');
    expect(wheel.pick('down')).toBe(true);
    expect(sim.pulseLoad.choice).toBe('rare');
    expect(wheel.pick('up')).toBe(true);
    expect(sim.pulseLoad.choice).toBe('none');
    wheel.update(LOAD_WHEEL.showSeconds + 0.1);
    expect(wheel.isOpen).toBe(false);
  });
});
