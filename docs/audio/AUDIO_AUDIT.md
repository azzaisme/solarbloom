# Phase 8 A01 — Audio audit (before)

Audit of the game as shipped at the start of Phase 8 (commit `796759b3`), against the tester's note: *"the audio
is kind of all over the place. The ambient sound is really grating. Then there are things that didn't have sound
effects."* Measurements: `ffmpeg ebur128` (integrated loudness, true peak) and an FFT band split
(`tools/audio` scratch analysis), plus the gain chain in the old `src/audio/Sfx.ts`.

## How the old mix was built

One `Sfx` class. Nine `<audio>` elements looped with `el.loop = true`, all playing **at once** from the first
gesture, levels set by the *global* restored-tile count (`life = restored / 48`, the same everywhere on the map):

| Bed | File | Length | Raw loudness | Gain in game | Bus | Effective (at speakers) |
|---|---|---:|---:|---|---|---:|
| Music "bed" | birds-wind-synth-v2.ogg | 253 s | −37.6 LUFS | 0.6–0.8 | music ×0.22 ×0.5 | ≈ −60 LUFS (inaudible) |
| Music "melody" | kalimba-think-id-stay-clean.ogg | **85 s** | −19.5 LUFS | 0.55–1.0 | music | ≈ −44 → −39 LUFS |
| "Wildlife" | birds-wind-ambient.ogg | 84 s | −31.6 LUFS | 0–1.1 | music | ≈ −50 LUFS |
| Dead wind | city-wind.ogg | 171 s | −10.7 LUFS | 0.056 | atmos ×0.5 | ≈ −42 LUFS |
| Dead hum | city-hum.ogg | **8.2 s** | −26.6 LUFS | 0.4 | atmos | ≈ −41 LUFS |
| Living water | water-flowing.ogg | **1.9 s** | −31.3 LUFS | 0–0.9 | atmos | ≈ −38 LUFS at full life |
| Insects | crickets.mp3 | 18.5 s | −47.7 LUFS | 0–**5.2 (+14 dB)** | atmos | ≈ −39 LUFS at full life |
| Sea (3D) | water-flowing.ogg (again) | 1.9 s | | 0–0.45 | atmos | near shores |
| Brook (3D) | brook.wav | 30 s | −17.2 LUFS | 0–0.3 | atmos | ≈ −34 LUFS, near clean water |
| Birds (3D ×3) | birds-trees.wav | 36 s | −18.5 LUFS | 0–0.35 each | sfx | constant, in three trees |

## Findings — the grating ambience (root causes)

1. **A 1.9-second hiss loop, everywhere, as loud as the music.** `water-flowing.ogg` is 1.88 s long with **58 % of
   its energy above 5 kHz** (spectral centroid 4.8 kHz). It played on the global atmos bus at up to 0.9 (≈ −38 LUFS,
   level with the music) once the park was half restored, *and* again as the 3D "sea". An `<audio>` element does
   not loop gaplessly, so it stuttered every 1.9 s. **This is the grating sound.** Removed.
2. **Crickets boosted +14 dB, by day.** The raw file is −47.7 LUFS with 35 % of its energy below 150 Hz (rumble and
   noise floor). A ×5.2 gain lifted the noise with the insects, and it played at noon as much as at midnight.
   Re-baked (high-pass 1.8 kHz, denoise, normalised) and now night-only, in restored ground only.
3. **A permanent 8-second drone.** `city-hum.ogg` (95 % below 500 Hz) looped for the whole early game — the
   "oppressive drone" the brief warns against. Removed: the dead world is now near-silence and thin wind.
4. **Three unrelated pieces of music at once.** The kalimba track (85 s), the synth bed (253 s) and the
   birds-and-wind piece (84 s) were layered permanently, in different keys and lengths, so they drifted against
   each other forever — "all over the place". The kalimba piece also carried most of its energy below 150 Hz.
   Now: one piece at a time, with rests (MusicDirector).
5. **Audible loop seams.** `city-wind.ogg` jumps by 0.27 (full scale) at its loop point, `brook.wav` by 0.065;
   with `<audio>` loops there was also a gap at each seam. Now every bed is baked with an equal-power crossfade
   and played as an `AudioBuffer` loop (bake report: seam step ≈ 1× an ordinary sample step).
6. **No local soundscape.** All beds followed the *global* restoration count, so a dead island next to a living one
   sounded the same, and the lush beds played over wasteland once the park elsewhere was green. Birdsong (the
   "wildlife" music bed) was on the music bus, heard everywhere.
7. **Bloom Chains climbed into a piercing register.** `bloomVoice` steps reached 32, i.e. six octaves above
   C5: pings at 8–30 kHz-intended pitches with an octave on top, every 60 ms. Now a bounded two-octave ladder with
   thickening chords and falling level (`chainTone`).
8. **Harsh designed timbres.** `square` and `sawtooth` oscillators for coins, builds, cracks, the Cultivator hum,
   drones and the cat, unfiltered. Now one felt-mallet palette, low-passed.
9. **No limiter, no buses beyond two.** Effects and atmos shared one switch; nothing protected against clipping.

## Missing sounds (prioritised)

| Priority | Event | Before | Now |
|---|---|---|---|
| P0 | Footsteps (grass, dirt, stone, wood, sand, water) | none | per foot plant, surface-aware |
| P0 | Restoration "life returns" (local ambience) | global only | local sampler + beds |
| P0 | Water only where it exists | global hiss | 3D brook/sea only |
| P0 | Landmark / area opened distinct | one fanfare for all | `landmark()` vs `areaOpen()` |
| P0 | Lucky Cat find signature | meow + generic fanfare | meow + playful run, golden/rainbow variants |
| P1 | Ruin creak in dead land | none | sparse one-shots (when a recording is present) |
| P1 | Bird calls from trees | 3 constant loops | sparse one-shots from grown trees |
| P1 | Interface sounds on their own bus | shared with effects | UI bus + volume |
| N/A | Bloom Frenzy | retired in E23.1.2 | — |

## Duplicate-loop check (camera switches, respawn, scene load)

Beds were created once in `unlock()` and never re-created, so camera switching did not stack loops; that is kept
(directors are created once; `unlock()` is idempotent). The new e2e test (`npm run test:audio`) asserts voice
counts stay within the pool.

## Licences of the old assets

All old files were CC0 from OpenGameArt with credits in `assets/raw/audio/*/CREDITS.md`. Nothing of unknown origin
was found. The new manifest is `docs/audio/ASSET_MANIFEST.csv`.
