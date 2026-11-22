# Rendering pipeline (Look 1)

How Solarbloom turns palette hex values into pixels, so palette and asset work (Look 2 onward) is tuned against
the final output, not against raw hex. All numbers live in `src/data/look.ts`; run-time code is in
`src/rendering/LookController.ts`, `SceneBuilder.ts` (lights) and `LookShaders.ts`.

## Colour pipeline (Look 1.4)

1. **Authoring:** colours are sRGB hex (`PALETTE` in `Materials.ts`, tree and foliage generators).
2. **Linearisation:** every path uses the same curve, `pow(c, 2.2)`:
   - standard materials: the engine's `Color.linear()` on `diffuse` and `emissive`;
   - vertex-coloured meshes (chunks, tufts, flowers, props, trees, particles): `lin()` in `ChunkRenderer.ts` and
     the equivalent in `Shapes.ts`, `TreeGen.ts` and `Vfx.ts`, stored as 8-bit linear with `vertexColorGamma`
     off.

   `tests/look.test.ts` checks that `lin()` and `Color.linear()` agree for every palette colour, so the same
   hex looks identical on a chunk and on a standard material. The 8-bit linear store has coarse steps in very dark
   colours; no palette colour is dark enough for it to show.
3. **Lighting** in linear space: the sun, the fill, the sky-and-ground environment and the rim (below).
4. **Exposure:** `LOOK.exposure` (`scene.exposure`), currently 1.1. Night keeps it (E23.7.5).
5. **Tone mapping:** Khronos **PBR Neutral** (`TONEMAP_NEUTRAL`). It keeps the palette's hues and saturation up
   to bright values and rolls highlights off smoothly. ACES was tried first: it bleached the greens and the
   blossom pinks toward yellow-white.
6. **Output:** sRGB encoding (`GAMMA_SRGB`).

With post-processing on (Medium and High), steps 4 to 6 run in the `CameraFrame` compose pass after bloom, SSAO,
depth of field and grading. On Low the camera tone-maps and encodes directly, so the curve is the same.

What this means for palette work: a mid-tone hex lit by the full sun comes out about as bright as authored; in
shadow it lands at roughly 40% (about 2.5:1) and shifts cool. Nothing except emissive glows should get near white.
Before Look 1, about 20% of the pixels in the machine-cluster shot had a channel clipped at 255; with this
pipeline, none do.

## Lights (Look 1.2, 1.3)

| Light | Colour | Intensity | Notes |
| --- | --- | --- | --- |
| Sun (key) | `#ffdcaa` | 2.1 | Follows the day's arc (`DayNight`, 8° at the horizon to 50° at noon); light travels toward world (−0.25, 0.97) at its middle, so shadows fall to the lower left of the default view. PCF shadows, cascaded per tier. |
| Fill | `#d0dcf0` | 0.45 | A soft sky blue from the side opposite the sun, from above; no shadows. |
| Sky and ground | zenith `#82aae0`, horizon `#dde3ea`, ground `#a08a62` | 0.7 | A 32² cubemap prefiltered into `scene.envAtlas`. It provides all ambient light (the flat ambient is black) and the reflections on glossy materials. The ground's warm bounce keeps the shade side of ivory stone warm. Rebuilt after a lost WebGL context. |
| Rim | `#ffd35c` | 1.2, power 2.2 | A view-dependent term added to the standard emissive chunk for lit materials, tinted by the surface albedo, stronger on the sun side. |

**E27.1 (#679), sunlit not washed out.** By E26 the lights had crept up to a 3.4 sun, a 1.15 environment with a
near-white horizon, a 2.6 rim at power 1.3 and a grade at saturation 1.32 / vibrance 0.42. Sunlit sand and grass
landed three to four times past white before tone mapping: up to 60% of a beach shot clipped, the bloom threshold
(1.15) sat under sunlit ground so the whole beach bloomed into a warm veil, the rim lit half of every tuft gold and
the grade pushed the greens fluorescent. Bloom was not the cause (with it off, the beach still clipped 54%). The
fix is in the light, not the materials: the sun and the ambient come down together, keeping the sun about three
times the shade's light so shadows read, and the ambient turns a soft blue. A pale sunlit surface now lands just
under white. Night's moon, fill, ambient and rim are their own strengths in `DAY_LIGHT` (no longer shares of the
day's), so the moonlit night is unchanged. `tests/e2e/sunlit-shots.mjs` shoots the same follow-camera spots at
five times of day on High and on the Deck and measures clipping, light-and-shade spread and green saturation.

Measured on the restored park (`shots:look`, `full-desktop`): lit grass about `(138, 209, 68)` and shadowed grass
about `(15, 73, 46)`, so a 2.9:1 brightness gap on screen, with the shadow tilted toward blue (blue/red 3.1 in
shadow vs 0.5 in sun).

## Post-processing (Look 1.5 onward)

The main camera has a PlayCanvas `CameraFrame` (`src/rendering/PostFx.ts`), the one home for post effects. The
scene renders to an HDR target (11-11-10 float, 4× MSAA because the canvas's own antialiasing doesn't reach an
offscreen target), then the effects run, then the compose pass applies exposure, tone mapping and sRGB output.

- **Background:** the canvas is transparent over the CSS sky, but no sky is in view at any zoom. With post on, the
  camera clears to the haze colour, so the HDR target needs no alpha.
- **Resizing and the adaptive pixel ratio:** CameraFrame sizes its targets from the canvas every frame. A lost
  WebGL context is handled by the engine (targets are recreated); the generated environment is rebuilt by
  `SceneBuilder` on `devicerestored`.
- **Bloom:** intensity 0.14 (twice that by deep night) with a scene-referred threshold of 1.8. Sunlit surfaces
  peak around 1.7 (pale sand), so only emissives (see the emissive budget below) glow. Checked (E27.1): noon on the
  beach with bloom on and off clips 0.6% and 0.4% of the picture.
- **SSAO (High tier):** CameraFrame SSAO, combined into the final colour, 12 samples, blurred. Its radius is in world
  units (a tile is 1), set every frame to 0.12 × the world height in view, clamped to 0.6–2: tight contact
  shadows under bushes, benches and machines up close, soft grounding around buildings and trees at the overview.
  It adds a depth prepass (about +50 draw calls in the park shots). Baked vertex occlusion for phones without SSAO
  is not done yet: it means darkening the bases of tufts, stems and props where `ChunkRenderer` and the foliage
  generators write vertex colours, which the parallel E16 vegetation work is rewriting; it should follow E16.
- **Grading and vignette:** in the compose pass: contrast, saturation, a tint, and HDR-aware shadows / highlights /
  vibrance (`colorEnhance`). Two looks in `LOOK.grade`: `warm` (restored: warm tint, a little more contrast,
  highlights held down, saturation 1.1 and vibrance 0.15 so the greens stay natural) and `dead` (cool tint, desaturated). The game blends them by the restoration of the area
  under the camera (`Game.updateMood`: a cleared area is 1, a fogged one rises toward 1 as restored tiles approach
  its landmark's need), easing over 2.5 s, so restoring reads as the light coming back. A soft warm-brown vignette
  (0.32) frames the view. **High contrast** uses a flat grade with lifted shadows and no vignette.
- **Live tuning:** `LOOK` is read every frame for the grade, vignette, SSAO and rim. In a dev build,
  `solarbloom.look.cfg.grade.warm.saturation = 1.2` applies at once; light and bloom changes need
  `solarbloom.look.apply()`. No rebuild either way.
- **Depth of field (High tier):** far blur only (near blur off, so nothing between the camera and the focus is
  ever blurred). Focus is the view depth of the camera's goal point; blur starts 9 world units beyond it, where
  the linear haze is already strong, and is complete 18 units further, so haze and blur rise together. The
  playable area around the goal stays sharp at every zoom; the blur reaches the hazy, unrevealed city at the top
  of the view. Radius 3, 3 rings of 4 points, the cheap (not high-quality) path.

## Emissive budget (Look 1.9)

Scene-referred brightness is `linear(colour) × intensity`, before exposure and tone mapping. Bloom starts at 1.8
and is strong by about 3. Ordinary lit surfaces stay at or below about 1.7 (sunlit sand, the palest ground) and must
not be emissive. (E27.1: the threshold was 1.15, under sunlit ground, so the beach bloomed by day.)

| Element | How it glows | Rendered intensity |
| --- | --- | --- |
| Any standard material authored as a glow (`mat(…, { emissive, emissiveIntensity >= 1 })`): drone eyes (2), drone spray beam (1), machine lights and rings (1–1.6), orbs, relay and hub rings, Vfx rings (1.5) and arcs (2) | `glow()` in `Materials.ts` multiplies by `LOOK.emissive.gain` | × 4 (so 4–8) |
| Emissive tints below 1 (solar boost 0.6, water accents 0.3–0.6, gold trims 0.25, the tap beacon 0.6) | unchanged | < 1, never blooms |
| Drone (#211): eyes, thrusters, vent 1.6; beam outer cone 1.1, inner stream 2.2 (blended at 0.2 / 0.32 opacity); eye screen 0.55 asleep / 1.3 / 2.1 restoring (`faceMat`, same `glow()` rule) | `mat()` gain, and `glow()` in `faceMat` | 6.4; 4.4 / 8.8; 0.55 / 5.2 / 8.4 |
| E16 fireflies (2.2), machine wisps | `mat()` gain | 8.8 |
| The awake core / landmark | `coreMat` at `glow(1.2)` | 4.8 |
| The ready-to-wake landmark | gold pulse 0.4–0.9 (a hint, not a glow) | < 1 |
| Condenser tank | emissive 1 (was 0.4) | 4 |
| Restore-tile flashes, the restore-target glow, the chain hold outline (`TileFx`) | `LOOK.emissive.tile` on the unlit overlay, blended at its opacity | 4 |
| Pulse footprint preview (`Overlays.showRadius`) | `LOOK.emissive.preview`, blended at 0.45 | 3 |
| Sparkle particles (bursts, Frenzy, mega-bloom, drone trails) | the particle's own colour, `LOOK.emissive.particles` | 2.5 |
| Lit lamps (park stage 3), Radiant flowers and their ground glow | vertex alpha in chunk meshes (`MeshBuilder.add(…, glow)`), × `LOOK.emissive.vertexGlow` | lamp globe 4; flowers 1.8; ground pools 0.3–0.5 |
| Solar panel glints | sun specular on the glossy glass plus environment reflection, no emissive | — |

New content: author a glow at `emissiveIntensity: 1` (or more) and let the gain bring it into bloom; keep tints
below 1. For geometry merged into chunks, pass a `glow` of 0–1 to `MeshBuilder.add`. Bright unlit overlays that are
UI (selection frames, ghost previews) stay at intensity 1 and don't bloom.

## Atmosphere (Look 1.10)

- **Haze:** the linear fog is a warm golden `#e9dcc4` (was a flat blue-grey `#bcd9e6`). It still starts and ends at
  the zoom-dependent distances in `CameraController` (`hazeStart` 6, `hazeEnd` 44 past the target), and the camera
  clears to it when post is on. The gameplay fog over unrevealed areas is a separate mesh and is unchanged.
- **The horizon (E27.1, after #683 took the skyline away):** from the low follow camera, the whole far sea and the
  far coast squeeze into a few rows of pixels under the horizon, long before the depth fog has caught up, and the
  same haze colour reached the screen two ways: the fog colour is decoded to linear by the engine, while the sky
  dome's vertex colours and the clear colour go out as given. At night the fogged sea landed on 51,72,124 against a
  sky of 110,131,171, so a hard line. Two fixes, both in `LOOK.horizon`:
  - *Horizon haze* (`LookShaders`, in the fog chunk of every standard material): far surfaces within `band` (6°)
    below the camera fade into the fog colour, fully by `reach` (0.45) of the way into the depth fog, nothing nearer
    than where the fog starts. The far sea's edge and the far coast dissolve over a band instead of a pixel.
  - *One horizon colour*: by night the fog colour is encoded (`fogMatchingSky`) so it lands on the sky as seen; by day
    the sky's lowest `skyBand` (5°) and the clear colour take the haze as the fog shows it (`Sky.horizonSeen`),
    so the day's distance doesn't pale. Measured looking out to sea (`sunlit-shots`, the biggest step in brightness
    from one row to the next across the horizon): 43–59 at dusk and midnight before, 9–12 after, at any hour.
- **The sea's colour (E27.1):** the open sea and its shallows are slabs on the living surface. Their authored deep
  blues (#2f6f8a …) only read as the owner's bright, clear aqua because the old light and grade overdrove them; under
  the true sunlit light they went a dull grey-teal. They're now authored brighter by `SEA_LIFT` (Water.ts, 2.6 / 2.2 /
  2.1 per linear channel), and the surface takes that lift back out as night falls (`uTrSea`, `seaTintAt`), so the
  moonlit sea lands exactly on the colours the approved night was tuned with. The sea's slabs carry feature code 8
  (`FEATURE.sea`) so the surface knows which ones to tint. Checked in `sunlit-shots`: the noon sea must stay a clear
  aqua.
- **The water (E28.W01, #694):** one surface and one material (`WaterSurface.ts`) for every stretch of live water:
  the open sea and its shelf, the water under the jetty, the beach's surf (murky while dead, clear once restored) and
  restored pools and ponds. The slabs stay underneath as the bed and the restoration state; the surface is a 4×4 grid
  per tile (one quad on far chunks) a hair above them, on its own **Water** layer just after the world. Each vertex
  carries its distance to land (following the rounded shore corners) and its clarity, which blends across tile
  corners so murky and clear water never step at a border. From those the shader draws:
  - colour by depth, `LOOK.water.shallow` → `mid` → `deep` (turquoise to blue-teal), with the sand bed and faint
    light nets through the clear shallows;
  - drifting ripples (six waves on a noise-bent field so they never form a checker, the finer ones fading with
    distance), waves that follow the shore and anything standing in the water, and broken foam lines lapping in;
  - the engine's sun, fill, lamps and lantern on those normals (every world light also lights the Water layer:
    `worldLightLayers()`), with a soft-capped highlight (`gloss`, `specular`) that sparkles without blooming;
  - Fresnel reflection (`fresnel`): little looking down, more toward the horizon, capped at 0.6. The sky's colours
    on every tier; on High a planar reflection of the world (`WaterReflection.ts`). Reflections take a little of the
    water's own hue (`reflectTint`) so far water reads aqua (or navy at night), not haze grey. The sky also fills the
    water's colour with blue light (`ambient`), since the engine's own sky light is off for it;
  - night: the colour turns `night` navy and dims to `nightAlbedo`; the moon and the lamps glint on it.
- **Why a planar reflection:** buildings, the jetty and plants stand right on the water, and the camera looks along
  it. Screen-space reflection loses what it needs there (it's off screen or behind the thing itself) and a probe
  shows none of it. A second camera mirrors the main one in the sea's plane and draws the sky and the world (not
  the Water layer) into a half-size HDR target; its near plane is tilted onto the water (Lengyel's oblique clip) so
  nothing under the waterline shows. Only water at the sea's height uses it; pools on other terraces keep the sky
  colours. It costs a second world pass, so it's High only (`TierSpec.waterReflect`), never on Deck, and off while
  the loading screen warms shaders up. Two things keep it cheap: it's drawn every other frame (`reflect.every`; the
  water samples it with the view it was drawn from, so it never slides), and it skips PlayCanvas's per-camera sun
  shadow pass, reusing the shadow map the main camera left (WaterReflection's constructor). At the start that's
  about 160 extra draw calls on the frames that draw it.
- **Cost on High (E28.W01, sea spot at noon, 1080p, median of three runs):** frame time 7.3 → 9.5 ms median, draw
  calls 516 → 639 on average. The shader skips the caustics where no bed shows and the foam noise away from shore.
- **The shore (E28.W02, #695):** natural ground (lawn, earth, sand, clay; not paving, roads, buildings, ramps or decks)
  doesn't stop at its tile's straight side where it meets water at its own level. `Shore.ts` works out the runs of
  each land tile's outline that open onto water (round its rounded corners too, and fanning round square ones), and
  `ChunkRenderer.shore` builds a bank under each run, into the chunk's ground mesh (no extra draw calls):
  - first a **shelf**: the land's own top carries on out past the edge by `LOOK.shore.shelf` (0 to 0.3 tiles, its
    own noise), so the edge of the lawn bulges and draws back;
  - then a **slope** down to its toe `under` below the surface, meeting the water `reach` out (by the shore noise; a
    sand beach `beach` times further, more gently). A bank keeps to `room` of the open water in front of it, so the
    two banks of a narrow channel never close it, and where the shore carries on past a built edge (paving, a road)
    it eases down to nothing over `taper` instead of stopping in a step;
  - coloured from the lawn's own mottled colour at that very point (`turfAt`), carrying down the bank by
    `grassLine` (its own noise), through `earth` and a `wet` band at the waterline, darker there (`ao`);
  - dressed, seeded by position: pebbles and the odd rock along the waterline; on restored banks reeds standing in
    the shallows, a fringe of grass on the lip, tufts and flowers on the slope, and now and then a shrub on the top of
    the bank leaning out over the water (`overhang`; its foot stays on the tile, `leanGeo` only leans what grows
    above). Every piece stands exactly on the bank's triangles (`bankHeight`).
  
  Everything is decided by world position, so two tiles sharing a corner build the same bank there and the shore runs
  on with no seam. The water's distance to land (`waterDistance`) is pulled out by the same shelf and slope
  (`waterlineAt`), and each water vertex also carries how far it was pulled (the alpha channel, `encodeWater`). The
  foam's contact edge sits right on the bank's waterline; the colour by depth, the sand bed, the shore waves and the
  foam lines follow only `waterPull` of the pull, so the shallows trace the new outline but a narrow canal keeps its
  clear turquoise middle. None of it is solid: the tiles, paths, collision, the line of sight and saves are unchanged.
- **A sunny sky (E27.1):** the follow camera sees only the lowest 15° or so of sky. With the dome's blue starting at
  25°, all it showed was the warm glow band, which tone mapping turned a flat grey-white, so a sunny day read as
  overcast. `SKY_BANDS` (data/sky.ts) now puts the warm band in the lowest 3° and the blue by 12°. The dome eases back
  to the old bands (`SKY_BANDS_NIGHT`) as night falls, so the approved night sky is unchanged. The fogged half of each
  `SKY` pair (a new game, `Sky.clarity` near 0.15) keeps a soft blue too; restoring the city still clears it to the
  full blue. `sunlit-shots` fails if the noon sky has no blue.
- **Motes:** warm light specks (`#ffe9a8`, glow 3, so they catch a little bloom) that drift on slow noise, rise
  gently and fade in and out over 4–10 s. They only spawn above restored tiles near the camera's focus. One
  instanced draw call. High 90, Medium 50, Low none; off with *Fewer particles* and with reduced motion.
- **Light shafts:** a few long soft cards slanting down along the sun from restored ground, turned about their own
  axis to face the camera, additive with their alpha fading to the edges and ends, breathing in and out over
  9–17 s. They fade when seen along the light. One instanced draw call. High 5, Medium 3, Low none; off with
  *Fewer particles*; frozen with reduced motion.
- CameraFrame's raymarched volumetric fog could give real shadowed shafts, but it marches the shadow map per
  pixel, which is too expensive for the phone budget; the cards cost almost nothing.

## Graphics tiers (Look 1.11)

Settings → **Graphics**: Auto (default), High, Medium, Low (phones), saved with the other settings. `?gfx=…` in
the URL forces a tier for a session (tests, perf runs, support).

| | Low | Medium | High |
| --- | --- | --- | --- |
| Post-processing (CameraFrame) | off: the camera tone-maps | on, 2× MSAA | on, 4× MSAA |
| Bloom, grading, vignette | — | yes | yes |
| SSAO, depth of field | — | — | yes |
| Sun shadows | 1024², PCF3 | 2048², PCF3 | 2048², PCF5 (softer) |
| Rim light | yes | yes | yes |
| Motes / shafts | 0 / 0 | 50 / 3 | 90 / 5 |
| Fauna caps (E16, `TUNING.ecosystem.caps`) | low | medium | high |

*Fewer particles* also caps the sun's shadow map at 1024² and turns the motes and shafts off; reduced motion turns
the motes off and freezes the shafts. Low keeps the same lights, shadows, rim and tone curve, so the look holds; it
loses the grade (so the dead-to-restored mood shift too), the vignette and the glow halos.

**Auto** starts from the device (`Quality.detectTier`): software renderers and phones start Low (big phones with 8+
cores and 6+ GB start Medium), tablets Medium, computers High (Medium with 2 cores or 2 GB). At run time the
existing adaptive pixel ratio drops resolution first when frames run slower than 40 fps; once it is at 1× and frames
are still slow for 3 s, Auto steps down one tier. Choosing Auto again re-detects.

Foliage density per tier (Look 3) is not wired yet: there is no density knob to switch until Look 3 adds one.
