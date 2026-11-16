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
4. **Exposure:** `LOOK.exposure` (`scene.exposure`), currently 1.0.
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
| Sun (key) | `#ffd29a` | 3.1 | 34° elevation; light travels toward world (−0.25, 0.97), so shadows fall to the lower left of the default view. PCF shadows, 2048² (1024² on Low). |
| Fill | `#8fb4ff` | 0.42 | From the side opposite the sun, from above; no shadows. |
| Sky and ground | zenith `#5d8fd6`, horizon `#cfd9e3`, ground `#7a6a48` | 0.85 | A 32² cubemap prefiltered into `scene.envAtlas`. It provides all ambient light (the flat ambient is black) and the reflections on glossy materials. Rebuilt after a lost WebGL context. |
| Rim | `#ffc98a` | 0.8, power 3 | A view-dependent term added to the standard emissive chunk for lit materials, tinted by the surface albedo, stronger on the sun side. |

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
- **Bloom:** intensity 0.08 with a scene-referred threshold of 1.5. Sunlit surfaces peak around 1.0–1.3, so only
  emissives (see the emissive budget below) glow. Checked: the dead park with bloom on and off differs by at most
  1/255 on a few pixels.
- **SSAO (High tier):** CameraFrame SSAO, combined into the final colour, 12 samples, blurred. Its radius is in world
  units (a tile is 1), set every frame to 0.12 × the world height in view, clamped to 0.6–2: tight contact
  shadows under bushes, benches and machines up close, soft grounding around buildings and trees at the overview.
  It adds a depth prepass (about +50 draw calls in the park shots). Baked vertex occlusion for phones without SSAO
  is not done yet: it means darkening the bases of tufts, stems and props where `ChunkRenderer` and the foliage
  generators write vertex colours, which the parallel E16 vegetation work is rewriting; it should follow E16.
- **Grading and vignette:** in the compose pass: contrast, saturation, a tint, and HDR-aware shadows / highlights /
  vibrance (`colorEnhance`). Two looks in `LOOK.grade`: `warm` (restored: warm tint, a little more contrast,
  highlights held down) and `dead` (cool tint, desaturated). The game blends them by the restoration of the area
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

Scene-referred brightness is `linear(colour) × intensity`, before exposure and tone mapping. Bloom starts at 1.5
and is strong by about 3. Ordinary lit surfaces stay at or below about 1.3 and must not be emissive.

| Element | How it glows | Rendered intensity |
| --- | --- | --- |
| Any standard material authored as a glow (`mat(…, { emissive, emissiveIntensity >= 1 })`): drone eyes (2), drone spray beam (1), machine lights and rings (1–1.6), orbs, relay and hub rings, Vfx rings (1.5) and arcs (2) | `glow()` in `Materials.ts` multiplies by `LOOK.emissive.gain` | × 4 (so 4–8) |
| Emissive tints below 1 (solar boost 0.6, water accents 0.3–0.6, gold trims 0.25, the tap beacon 0.6) | unchanged | < 1, never blooms |
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
