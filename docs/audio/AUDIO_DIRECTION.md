# Phase 8 — Audio direction

**The world starts dead. As you restore it, you hear life return.**

## The rules the code enforces

1. **Local, not global.** The ambience follows the ground within 12 tiles of bloombot (or the view's focus in the
   overview), sampled 4×/s and smoothed over 5–12 s (`sampleArea`, `followArea`). The world's overall progress only
   colours the music; it never brings leaves or birds into a dead area.
2. **Dead is quiet, not oppressive.** Barren ground has a thin, high-passed dry wind (−24 LUFS master, played at
   ~0.2) and, every half minute or so, a far-off creak. No drones, no hum, long pauses.
3. **Life arrives in layers.** Leaves rustle once ground is restored (vegetation); a soft meadow bed by day and
   insects by night once it is well restored; bird *calls* (sparse one-shots, never a constant loop) from grown
   trees; water only where clean water exists, in 3D.
4. **One piece of music at a time, with rests.** Nothing plays before the first restoration. Then a piece plays
   through and is followed by 35–90 s of silence. Moods (quiet, garden, water, night) change the next piece; the
   playing one gives way only if a different mood has held for 40 s. Night softens the score with a low-pass;
   it does not cut to another track. Camera switches and small moves change nothing.
5. **One designed palette.** Synthesised sounds are soft felt-mallet notes on a pentatonic scale and shaped
   noise, all low-passed (no square or sawtooth waves). Recorded organic layers carry the physical sounds.
6. **Big is different, not louder.** Landmarks, areas and the Lucky Cat have their own cues; long chains add a
   pad and a swell and duck the music 1–3 dB for a few seconds. A limiter at the end keeps every stack unclipped.
7. **Repetition is controlled.** Family caps, cooldowns, no-repeat variation picks, and a "Fewer repeated
   sounds" setting that halves the busiest families and the wildlife rate.

## Stages (art direction)

| Stage | Local life | What you hear |
|---|---|---|
| Barren | < 0.08 | thin dry wind, rare distant creak, silence; no music before the first restoration |
| First Sprout | 0.08–0.25 | wind softening, the first rustle near the patch; the restoration motif |
| Recovering | 0.25–0.5 | leaves; occasional birds where trees have grown; the score begins after its rest |
| Thriving | 0.5–0.8 | meadow by day / insects by night, birds, brooks; wind in the background |
| Radiant | > 0.8 | the full, balanced living bed; music at its most open |

## Human-made

Recorded ambience and foley are human field recordings (CC0 / public domain, provenance in
`ASSET_MANIFEST.csv`). Music must be human-composed and human-performed. Designed sounds are written by hand in
`src/audio/Sfx.ts` (no generator).
