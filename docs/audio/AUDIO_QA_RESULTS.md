# Phase 8 — Audio QA results and epic report

Branch `claude/loving-bohr-fzyjdf`. "Tested" below means run in the built game (headless Chromium,
`npm run test:audio`) or by unit tests (`npm test`, `tests/audio.test.ts`), unless it says *by ear*. No human
listening test has been done yet: that is the main open item (A09).

## Automated results

| Check | Result |
|---|---|
| Unit suite (`npm test`, 140 files) | 1416 passed, 2 skipped |
| `tests/audio.test.ts` (sampler, stages, beds, moods, limiter, chain ladder, manifest, seams, peaks) | 19 / 19 |
| `npm run test:audio` (real game, see below) | 18 / 18 on the Chopin stand-in build; re-run on the final score in progress |
| Bake report: every loop's seam step | 0.26–1.04 × an ordinary sample step (inaudible) |
| Bake report: every file's decoded peak | ≤ −1.0 dBFS |

`npm run test:audio` in the built game, new garden:

- silent before the first gesture; music silent before the player's own first restoration ("the world waits");
- dead ground: wind only, no leaves/meadow/insects/birds (≈ −44 dB RMS with no sea nearby);
- restore 373 tiles round bloombot: life glides up over ~10 s to "thriving" (0.65); leaves 0.18, meadow 0.11,
  wind down from 0.15 to 0.05, bird calls every ~6 s; output −33.5 → −26.2 dB RMS (fuller, never a wall);
- teleport 60 tiles into wasteland: 2 s later life still 0.65 (fades behind), then barren 0.00, wind back;
- 50-bloom chain + landmark + coins + drones: ≤ 10 voices (pool 24), peak −8.5 dBFS after the limiter;
- hidden page: −120 dB; back: fades in.
- Capture: `docs/audio/captures/dead-to-living-60s.ogg` (restoration at 0:17), log `dead-to-living.json`.

## Epic report

```text
Epic: A01 Audio audit & grating-ambience removal
Status: Done
Files: docs/audio/AUDIO_AUDIT.md, src/audio/Sfx.ts (rewritten)
Assets: removed water-flowing.ogg (1.9 s hiss loop) and city-hum.ogg (drone) from the build; crickets re-baked
Events: inventory in AUDIO_AUDIT.md and AUDIO_EVENT_MAP.md
Listening: measured (LUFS, spectrum, seams); not yet by ear
Remaining: human confirmation that nothing grates over 15 min

Epic: A02 Central architecture & mix controls
Status: Done
Files: src/audio/AudioDirector.ts, AudioMath.ts, AudioAssets.ts, AudioDebugHUD.ts, src/app/Pause.ts, src/ui/SettingsRows.ts, Hud.ts
Events: all routed through Sfx → director (families, caps, cooldowns, priorities, 24-voice pool, limiter)
Tests: buses/limits unit tests; e2e voice and peak checks; hidden-tab silence; autoplay unlock
Settings: Master, Music, World sounds, Effects, Menu sounds; Fewer repeated sounds; all persisted with the settings
Debug: ?audiodebug or Shift+F9; window.__audio()

Epic: A03 Human-made long-form soundtrack
Status: Partial (awaiting the owner's approval of the six pieces)
Assets: shakuhachi, two harp pieces, veena raga, Dvořák Romanza, Schubert Andante — CC0 / PD, verified on archive.org
Behaviour: one piece at a time, played through, 35–90 s rests; mood hold 40 s before a crossfade; no restart on
  camera or small moves; night low-pass; restoration opens the level; big moments duck 1–3 dB
Remaining: owner listening; no intro/outro stems or intensity stems exist for these recordings (not needed for
  through-played pieces); Satie dropped at the owner's request (too associated with another game)

Epic: A04 Dead-to-living dynamic soundscape (signature)
Status: Done (pending ears)
Files: src/audio/SoundscapeDirector.ts, AudioMath.ts (sampleArea, followArea, bedLevels, stageOf), Game.senseSoundscape
Behaviour: local 12-tile sampler 4×/s, smoothed 5–12 s; five stages; wind → leaves → meadow/insects → bird calls;
  water only where clean water is; sea stiller by dead land; world progress never adds life to a dead area;
  restored from the save (it reads the grid)
Evidence: e2e above; 60 s capture

Epic: A05 Interaction foley & missing-sound coverage
Status: Done (soil handling remains a designed sound)
Assets: recorded footsteps (grass, dirt, stone, wood, sand; water wading designed), leaf rustles, a real cat
Events: AUDIO_EVENT_MAP.md
Remaining: by-ear check that footfalls line up with the walk clip's foot plants

Epic: A06 Signature celebration audio
Status: Done
Behaviour: bounded Bloom Chain ladder (two octaves, chords thicken, softer when fast), chain landing with duck,
  landmark vs area-open cues, Lucky Cat find with golden/rainbow variants; Bloom Frenzy N/A (retired in E23.1.2)

Epic: A07 Spatial environmental sound
Status: Done for water, birds, creaks, effects; partial for machines
Behaviour: HRTF 3D sources; listener glides (no channel jumps on camera cuts); brook at clean water, sea at the
  nearest shore, bird calls from grown trees; Cultivator hum proximity-bound
Remaining: no recorded machine/drone loops (drones keep short designed chirps by choice); no ruin-creak recording
  yet (the scheduler is in place and silent without one)

Epic: A08 Asset pipeline & rights
Status: Done
Files: tools/audio/bake.py, tools/audio/manifest.py, docs/audio/ASSET_MANIFEST.csv, CREDITS.md, LICENCE_EVIDENCE.md
Rule enforced by tests: every shipped file has a manifest row with creator, source and licence
Residual risks: LICENCE_EVIDENCE.md (Public Domain Mark items; Iwashimizu EU term to 31 Dec 2026; recordist-
  dedicated harp recordings; Content ID on PD classical)

Epic: A09 Playtesting, mixing & final QA
Status: Partial — automated QA done; human listening tests not yet done
Remaining: 30 min headphones + 30 min speakers; mono check; small external session with the playtest questions
```

## Sourcing: rejected (for the record)

Satie Gymnopédies (owner's call), Clair de lune and other very famous pieces; Commons files mislabelled public
domain but actually CC BY / BY-SA; generated or DAW-only "CC0" tracks with no evidence of a performer; uploads that
re-host commercial recordings under a Public Domain Mark; walking-sound packs re-hosting Pixabay/SoundBible files.
