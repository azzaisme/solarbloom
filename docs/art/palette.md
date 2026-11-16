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
| Limestone | light | `#e0d0db` | `#bea497` | `#ddd2bf` | `stone.light` |
| | mid | `#e8c6bf` | `#bfa3a8` | `#c4b7a1` | `stone.mid` |
| | dark | `#6c646d` | `#47454a` | `#9a8d79` | `stone.dark` |
| Paving | slab (4 tones) | `#a18a8c` | `#7b6d76` | `#cdbfa8` `#c4b59d` `#d4c7b1` `#bcad95` | `paving.slabs` |
| | grout | `#4b4243` | `#3f3738` | `#7d705f` | `paving.grout` |
| | crack | | | `#5e5347` | `paving.crack` |
| Grass | sunlit | `#b1cf2c` | `#9dae1b` | `#9cba48` | `lawn.sunlit` |
| | mid (tile tones) | `#8b9d14` | `#748911` | `#86ad3e` `#8fb443` `#7ba23a` `#96b84a` `#719a37` | `lawn.tones` |
| | shadow | `#4a6011` | `#374a0d` | `#3f6a2e` (cool, dark, never grey) | `lawn.shadow` |
| | dry tips | `#cac523` | `#a9ac1a` | `#c2bf5c` | `lawn.dryTip` |
| Moss | | `#a4a83b` | `#5a5e17` | `#8a9a45` | `lawn.moss` |
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
| prepared | dark soil with moss dots |
| growing | dark soil with bright young tufts |
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
| skyline stone (cream) | `stone` | `#e9e1cf` |
| skyline greenery (terraces) | `green` | `#a9c98a` (not lime) |
| skyline glass (pale blue) | `glass` | `#bcd6e4` |
| gameplay fog of war | `ChunkRenderer.buildFog` sheets | keep the cool grey (`#aab0b8` lower, `#bac0c6` upper, as rendered): darker than the haze (L\* ~71 vs ~90) and opposite in temperature, so it reads as gloomy fog, never as sky |

Look 1's haze (`look.ts` `haze.color`, `#e9dcc4` on its branch) should converge on the same horizon colour, or
be the golden-hour grade of it.
