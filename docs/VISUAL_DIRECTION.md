# Solarbloom visual direction (Phase 7: The Living Landscape)

The shared art brief every Phase 7 workstream follows. Specification: `SOLARBLOOM_PHASE_7_LIVING_LANDSCAPE_EPICS.md`
(epics E27–E32; in this repo those ids collide with the earlier E27 lighting and E28 water issues, so Phase 7 work is
tagged **P7-E27 … P7-E32**). Visual target: [`docs/reference/p7-target.webp`](reference/p7-target.webp).

> *Less visual noise. More beauty, depth and intention.*

## What the target shows (and what we take from it)

| Quality in the reference | What it means for Solarbloom |
|---|---|
| A clear blue sky with a few cohesive cumulus banks; a soft warm glow near the sun only | The sky is blue overhead and pale only at the very horizon. No yellow-white veil over the playfield, no ball clouds |
| Warm key light, cool shade, strong dappled shadows under trees | One strong sun, 35–50° up. Shaded sides ~25–45% darker than lit sides and cooler. Trees cast real shade |
| Rich but natural greens; ivory stone, warm timber, gold accents | Grass mid-green (not lime/fluorescent); sand pale and warm, not orange; stone ivory with visible bevels |
| Large trees with layered canopies framing the view (a big oak in the foreground, a pink blossom tree mid-ground, a lone tree on an island) | A canopy layer: several big trees per restored district, placed to frame paths and water, plus blossom accents |
| Calm lawns, with flowers in beds along edges, rocks and water | Planting zones: open lawn is mostly grass; flowers cluster at path edges, around landmarks and banks, in 2–3 colours per bed |
| Turquoise water, lily pads, reeds, rounded rocks on the banks | Keep the E28 water. Shores get reeds/lilies/rocks, not flowers in the water |
| Stepped terraces, stairs, a raised garden edge; distant cliffs with waterfalls | Some relief: terraces and raised beds, distant cliffs and a showcase waterfall where water really falls |
| A distant ruined city of arches, aqueducts and broken towers fading into blue haze | A layered ruined skyline beyond the playable island, readable silhouettes fading with distance (blue, not milky) |
| A cute robot on a readable path, with a bridge leading on | Bloombot, paths, bridges and prompts stay legible: tall plants never hide them |

## Palette anchors (sRGB)

- Sun `#FFF0D6` (warm ivory; golden hour may go warmer), shade/sky fill `#C8DDF2`.
- Sky zenith ~`#5E9EE6`, upper ~`#8EC3F0`, horizon haze ~`#D8E6F0` (cool and pale, not cream).
- Grass lit ~ RGB (110–150, 170–200, 60–90) on screen; shade cooler and darker.
- Ivory stone ~`#EDE6D6`; timber `#9A6438`; gold accents `#D9A441`.
- Dead ground: warm grey-tan, desaturated; sand pale `#E2CFA4`-ish on screen, never saturated orange.

## Rules

1. Calibrate light before judging any other colour (P7-E27 first).
2. No fixing by adding: never solve a bland area with more flowers, glow, bloom or saturation.
3. Barren stays barren: no bright vegetation on unrestored tiles. The restored-vs-dead contrast must stay strong.
4. Deterministic: every decorative choice is a pure function of the cell / seed. Nothing cosmetic is saved or read
   by the simulation.
5. Gameplay geometry is sacred: grid X/Z, tile ids, walkability, levels, ramps, picking and saves are unchanged
   unless a story explicitly calls for it and tests it.
6. Config, not constants: tunables live in `src/data/look.ts`, `src/data/sky.ts` or a Phase 7 config block.
7. Desktop High is the benchmark; Medium/Low must still work and must not get slower.
