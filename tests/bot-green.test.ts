import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../src/rendering/Palette';

/**
 * #631: Bloombot's colour is a light, warm leaf green (it was cyan): its eyes and trim glow, the pulse's waves and
 * rings, the reveal ripple and the build hologram. Light enough that the pulse still reads on restored grass.
 */

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luma = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe("#631: Bloombot's own colour is green", () => {
  it('its glow, its pulse, the ripple and the hologram are greens, not cyans (green leads, blue trails red)', () => {
    for (const [name, hex] of Object.entries({ botGlow: PALETTE.botGlow, botPulse: PALETTE.botPulse, ripple: PALETTE.ripple, holo: PALETTE.signal.holo })) {
      const [r, g, b] = rgb(hex);
      expect(g, name).toBeGreaterThan(r);
      expect(g, name).toBeGreaterThan(b);
      expect(b, `${name}: no blue lean`).toBeLessThanOrEqual(r);
    }
  });

  it('the pulse is lighter than any restored grass, so its rings show on the lawn', () => {
    const grass = (PALETTE.grass as readonly string[]).map(luma);
    expect(luma(PALETTE.botPulse)).toBeGreaterThan(Math.max(...grass) + 40);
  });

  it('the visor sheet, the loading screen and the palette agree on the one green', () => {
    const [r, g, b] = rgb(PALETTE.botGlow);
    expect(read('../assets/tools/bloombot_faces.py')).toContain(`EYE = (${r}, ${g}, ${b}, 255)`);
    expect(read('../src/ui/styles.css')).toContain(`--bot-glow: ${PALETTE.botGlow};`);
    expect(read('../src/ui/title.css')).toMatch(/\.lb-eye \{[^}]*var\(--bot-glow\)/);
    expect(read('../src/ui/title.css')).toMatch(/\.lb-ear \{[^}]*var\(--bot-glow\)/);
  });

  it("the pulse code draws in Bloombot's green, and its trim glow is recoloured when the model loads", () => {
    const game = read('../src/app/Game.ts');
    expect(game).toContain('this.vfx.ring(p, PALETTE.botPulse, 1.1, 0.55)');
    expect(read('../src/rendering/Vfx.ts')).toContain('palmWave(from: pc.Vec3, to: pc.Vec3, hex: string = PALETTE.botPulse)');
    const bot = read('../src/rendering/BloombotVisuals.ts');
    expect(bot).toContain("old?.name !== 'bloombot_glow'");
    expect(bot).toContain('color(PALETTE.botGlow)');
  });
});
