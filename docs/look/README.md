# Look comparison shots

`npm run shots:look` (Look 1.1, issue #108) renders fixed scenes of the game next to the target reference
(`docs/reference/target-look.png`) so every Look change can show before and after.

| Scene | What it shows |
| --- | --- |
| `dead` | the dead park at default zoom |
| `half` | half the park restored, a pulse growing at the front, the next pulse's preview |
| `full` | the whole park restored, the fountain awake |
| `machines` | two solar panels and a condenser around the core, close up |
| `drone` | the drone spraying a tile, close up |
| `mid`, `far` | the restored park at mid zoom (0.7) and the far overview (0.42) |

Each scene is shot at 1280×800 (`-desktop`) and 390×844 (`-phone`), as a side-by-side JPEG:
the game on the left, the reference on the right.

## Determinism

The page runs on Playwright's fake clock, paused, and only moves when the script advances it, one 1/60 s frame
at a time. `Math.random` is seeded before the game loads and the game boots and loads its assets with the clock
frozen, so the sun, wind, particles and drones are identical every run. Each rendered frame ends with a 1-pixel
readback, so the screenshot is the final frame. `metrics.json` holds a hash of each raw screenshot. Two runs of
the baseline build gave identical images for 11 of the 14 shots; in the other three (`full-*`, `machines-desktop`,
`far-desktop`), a few dozen isolated sparkle pixels differ (particle bursts from the whole park blooming at once),
and nothing else.

## Numbers

`metrics.json` records, per shot, the real wall time per rendered frame and the engine's draw calls. These come
from headless Chromium with SwiftShader (software GL) on the machine running the script: they are useful to
compare builds with each other, not as device frame rates.

## Folders

- `baseline/`: before Look 1 (commit 0164ddc lighting).
- `<story>/`: after each Look story (subsets of the scenes for intermediate stories).
- `current/`: the default output of `npm run shots:look` (not committed).

Usage:

```bash
npm run shots:look
node tests/e2e/look-shots.mjs <folder>
LOOK_SCENES=half,machines LOOK_SIZES=desktop node tests/e2e/look-shots.mjs <folder>
LOOK_QUERY=gfx=low node tests/e2e/look-shots.mjs <folder>
```
