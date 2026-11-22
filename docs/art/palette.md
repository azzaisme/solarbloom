# Solarbloom palette (Look 2)

The colour spec for the art-direction epic (#102, Look 2 #104). Sampled from
[`docs/reference/target-look.png`](../reference/target-look.png); the code lives in
[`src/rendering/Palette.ts`](../../src/rendering/Palette.ts) and is re-exported as `PALETTE` from `Materials.ts`.
`tests/palette-lint.test.ts` fails if any file in `src/rendering` uses a hex colour that isn't in the palette.

## How to read this

- **Lit / shadow** are what the reference *renders*: the 80th and 20th luminance percentile of each masked region
  (`python tests/art/sample_reference.py`, needs Pillow and numpy). They include the reference's golden-hour light
  and its mauve-blue shadows, so they are warmer and more saturated than a surface's own colour.
- **Game** is the albedo we author in `Palette.ts`. It is the lit sample with the light taken out (less yellow, a
  little less saturated), so that under Look 1's warm key light and Neutral tone mapping it lands near the lit sample.
  Shadows come from lighting (Look 1's cool fill and SSAO), not from separate shadow colours, except where a mesh
  bakes its own shading into vertex colours (grass tufts, tree crowns).
- Swatch strip: [`palette-reference-swatches.png`](palette-reference-swatches.png) (lit left, shadow right).

## Swatches

| Family | Swatch | Lit (ref) | Shadow (ref) | Game | `PALETTE` key |
|---|---|---|---|---|---|
| Limestone | light | `#e0d0db` | `#bea497` | `#d6d0c6` | `stone.light` |
| | mid | `#e8c6bf` | `#bfa3a8` | `#b0a99e` | `stone.mid` |
| | dark | `#6c646d` | `#47454a` | `#8f887e` | `stone.dark` |
| Paving | slab (4 tones) | `#a18a8c` | `#7b6d76` | `#b4afa5` `#aba69b` `#bab6ac` `#a4a095` | `paving.slabs` |
| | grout | `#4b4243` | `#3f3738` | `#766f67` | `paving.grout` |
| | crack | | | `#58534d` | `paving.crack` |
| Grass | sunlit | `#b1cf2c` | `#9dae1b` | `#8dba48` | `lawn.sunlit` |
| | mid (tile tones) | `#8b9d14` | `#748911` | `#77ad3e` `#80b443` `#6da23a` `#87b84a` `#649a37` | `lawn.tones` |
| | shadow | `#4a6011` | `#374a0d` | `#376a2e` (cool, dark, never grey) | `lawn.shadow` |
| | dry tips | `#cac523` | `#a9ac1a` | `#b7c25c` | `lawn.dryTip` |
| Moss | | `#a4a83b` | `#5a5e17` | `#7f9a45` | `lawn.moss` |
| Flowers | hot pink | `#f470a8` | `#cc4481` | `#f2689f` | `flowers.pink` |
| | magenta | `#d73d84` | `#b42a65` | `#d63d84` | `flowers.magenta` |
| | lavender | `#b17fd7` | `#7c56b5` | `#a983d6` | `flowers.lavender` |
| | purple | | | `#7d58b5` | `flowers.purple` |
| | sunflower yellow | `#fce20f` | `#e1bd0b` | `#f9d23a` | `flowers.yellow` |
| | sunflower centre | `#714416` | `#5f320c` | `#6b4219` | `flowers.sunflowerCore` |
| | white daisy | `#fcfdf6` | `#fcf4eb` | `#f8f6ee` | `flowers.white` |
| | daisy centre | `#f0d91a` | `#dfcb1e` | `#f0d22e` | `flowers.daisyCore` |
| | orange | `#ee8c1e` | `#d27726` | `#ee8a2c` | `flowers.orange` |
| Leaves | light | `#6f8013` | `#626f02` | `#7ea83e` | `leaf.light` |
| | dark | `#203109` | `#162304` | `#2f5a26` | `leaf.dark` |
| Wood | crate / trunk | `#c69277` | `#815740` | `#b98a63` / `#7a573d` | `wood.light`, `wood.trunk` |
| Rusty metal | | `#7d5642` | `#4e2f23` | `#8a5a40` | `metal.rust` |
| Cream plastic | machine shells | `#f3f1ec` | `#b5a6a8` | `#f1ede4` | `plastic.cream` |
| Gold / amber | banners, trims | `#fbb73e` | `#f29f28` | `#f5b23c` banner, `#e8ba40` trim | `trim.banner`, `trim.gold` |
| Solar navy | cells | `#6b74c2` | `#52599c` | `#233f7a`, grid `#5a74c0` | `solar.panel`, `solar.glint` |
| Glass cyan | | `#ade9fc` | `#85d0f5` | `#9fe2f8` | `aqua.glass` |
| Sky | zenith | `#a9d3fc` | `#a7d2fc` | `#78afe6` | `sky.zenith` |
| | horizon | `#c4e0fc` | `#b0d3fc` | `#e6e2d4` | `sky.horizon` |
| Haze | distant towers | `#c8c4d0` | `#9eaabf` | `#e6e2d4` (= horizon) | `sky.haze` |

The drone keeps the redesign's colours (PR #211, `docs/art/SOLARBLOOM_DRONE_REDESIGN.md`): ceramic shell
`#f5f3e8`, soft gold trim `#e8ba40` on every role, cyan glow `#71f5ff` for eyes, thrusters and vent only, navy
glass `#1e3a6b`. Role accents stay on the hub ring and role icon. The rest of the palette is fitted around them.

## Screen coverage

Measured on the reference with `tests/art/colour.py` families (HUD masked out):

| Family | Reference | Target for a fully restored park (gameplay camera) |
|---|---|---|
| green (grass, leaves, shrubs) | 19% | 35–50%, never above ~50% |
| stone (limestone, paving, concrete) | 44% | 25–40% |
| flowers (pink, purple, yellow, white, orange) | ~11% | 8–15%, pink leading |
| gold, wood, rust, cream (props, machines) | ~11% | 5–10% |
| cyan / blue (sky, water, glass) | 9% | whatever the camera sees |

The reference's camera sees a lot of building and sky; the game's top-down camera sees mostly ground, so the
target allows more green, but green is one family among several, not the screen.

## Flower mix

Weighted, not cycled: **40% pink** (hot pink and magenta), **20% white**, **20% purple** (lavender and purple),
**15% yellow**, **5% orange**. A clump picks one main colour and only occasionally an accent, so beds read as drifts.

## Restoration states

Readability is gameplay. Each state must differ in **brightness and texture**, not hue alone:

| State | Look |
|---|---|
| fog-covered | greyed toward the fog-of-war colour and dimmed, under the fog sheet |
| dead | warm grey weathered stone, darker and much less saturated than restored, with dry weeds, rust and debris |
| prepared | dark tilled soil `#5f4733` with moss dots |
| growing | lighter olive sprouting soil `#6a6536` with young tufts |
| restored (stage 1) | light young grass, short tufts |
| blooming (stage 2) | grass with tight one-colour flower clusters |
| thriving (stage 3) | deep grass with shrubs, spikes or a tree |
| radiant (stage 4) | golden glow disc and luminous flowers |

Restored paving stays stone (cleaner and lighter than dead, with moss and small flowers in the cracks), obstacles
become stone planters and plinths, roads keep their surface with green at the edges.

## Sky, haze and fog targets (#125)

Look 4 owns the sky block (`src/data/sky.ts` on its branch: `[fogged, clear]` pairs) and Look 1 the haze;
these are the clear values to set there (`PALETTE.sky` holds the same values).

| What | `SKY` key | Clear value |
|---|---|---|
| sky zenith | `zenith` | `#78afe6` |
| about 25° up | `upper` | `#a4cdee` |
| warm band above the horizon | `glow` | `#f6e2c0` |
| horizon, haze, scene fog | `haze` | `#e6e2d4` (pale and warm; the ground fades into it, no blue-grey seam) |
| cloud shade | `cloudShade` | `#dde3ee` |
| gameplay fog of war | `ChunkRenderer.buildFog` sheets | keep the cool grey (`#aab0b8` lower, `#bac0c6` upper, as rendered): darker than the haze (L\* ~71 vs ~90) and opposite in temperature, so it reads as gloomy fog, never as sky |

Look 1's haze (`look.ts` `haze.color`, `#e9dcc4` on its branch) should converge on the same horizon colour, or
be the golden-hour grade of it.

## Calibration under Look 1 (#127)

Calibrated against Look 1's branch (`claude/look1-lighting-0f6196`: Neutral tone mapping, warm key, grade, High
tier) merged locally onto this branch, with `npm run shots:look2` (`LOOK_QUERY=gfx=high`). Look 1's warm key and
grade warm every albedo a second time, so the first-pass values were too yellow and too peach. Changes:

- **Grass** (all `lawn` greens, tufts, edge, moss): hue +8°. Rendered median went from hue 63 to **69** (reference
  grass mid: 68).
- **Stone and paving**: saturation halved, slabs darkened, so paving renders as warm grey stone with mauve shade
  like the reference, not peach (rendered slab value 0.94 → ~0.85). Restored slabs (`#b4afa5`) stay clearly above
  dead paving (`#8a8276`); the swept state sits between (`#9d978c`).
- **Prepared vs growing**: they rendered as the same bare soil (ΔE 3.6 with normal vision, under 1.5 for protanopia
  and deuteranopia). They now differ in lightness: prepared `#5f4733`, growing `#6a6536`; dead lawn is a lighter dusty
  `#968d7c`. Ground lightness ladder: prepared L\*32 < growing ~43 < dead ~58 < Blooming 66 < Restored 79.

### Colour-blind check

`python tests/art/cvd.py <shot> <grid> [states.json]` simulates protanopia, deuteranopia and tritanopia (Machado
2009, full severity) and measures the median colour of each tile-state block in the states shot. Smallest colour
difference between any two states, under Look 1 (High):

| Vision | min ΔE (pair) |
|---|---|
| normal | 21.8 (prepared / growing) |
| protanopia | 14.9 (prepared / Radiant) |
| deuteranopia | 11.6 (Restored / Blooming) |
| tritanopia | 13.9 (Thriving / Radiant) |

Before the prepared/growing fix the worst pair was 0.9. Hue is never the only cue: stages also differ in lightness
and shape (moss dots, tufts, flower clusters, shrubs and trees, the Radiant glow disc and gold flowers). Fog-covered
ground is desaturated under cool grey sheets in every simulation; boosted tiles are an additive glow (a brightness
cue). Grids: `docs/review/look2/after-look1/*-cvd.png` and `docs/review/look2/after/*-cvd.png`.

### Coverage (done-when)

`python tests/art/coverage.py`, fully restored park ("full" shot, bloom stages mixed), see
`docs/review/look2/*/coverage.txt`:

| | green | stone | yellow-gold | largest 30° hue bin |
|---|---|---|---|---|
| before, park crop | 58% | 17% (+17% pale cream) | 2% | 39% |
| after under Look 1, park crop | 36% | 38% | 10% | 34% |
| after under Look 1, whole frame | 27% | 60% | 5% | 24% |
| after, current renderer (no Look 1), park crop | 48% | 41% | <1% | 42% |
| after, current renderer, whole frame | 33% | 61% | <1% | 28% |

On the current renderer (before Look 1 merges) the park crop sits at 48% green: right at the limit. Look 1's warm
light pushes part of the grass into the yellow-gold family, which is where the calibrated numbers come from.

Open: flowers cover ~3% of the screen, under the 8–15% target. The colours and drifts are right but the flower
meshes are small; bigger beds belong to Look 3's foliage work.
