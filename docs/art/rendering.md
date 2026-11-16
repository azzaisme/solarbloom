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
- **Bloom:** intensity 0.03 with a scene-referred threshold of 1.6. Sunlit surfaces peak around 1.0–1.3, so only
  emissives authored at 2 or above glow (see the emissive budget). Checked: the dead park with bloom on and off
  differs by at most 1/255 on a few pixels.
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
