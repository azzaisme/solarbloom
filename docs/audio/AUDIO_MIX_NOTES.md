# Phase 8 — Mix notes

Starting points for human listening tests, not final presets. All levels in `src/audio/AudioMath.ts`
(`BUS_TRIM`, `bedLevels`) and the bake targets in `tools/audio/bake.py`.

## Gain staging

| Stage | Target | Where |
|---|---|---|
| Baked music | −19 to −21 LUFS integrated (piano dynamics hold it there under the ceiling) | `bake.py` `kind='music'` |
| Baked beds | −24 to −26 LUFS (shore −29: its waves are peaky, compensated in `setSea`) | `bake.py` `kind='loop'` |
| Baked one-shots | peak −4 to −9 dBFS by family (footsteps quietest) | `bake.py` `peak=` |
| File ceiling | −1.3 dBFS before encoding → ≤ −1 dBFS decoded (Vorbis overshoot) | `normalise()` |
| Bus trims at 100 % | music 0.55, ambience 1.0, sfx 0.5, ui 0.32 | `BUS_TRIM` |
| Output limiter | DynamicsCompressor, threshold −4 dB, ratio 20, attack 3 ms, release 250 ms | `AudioDirector.unlock` |
| Music duck | −1 to −3 dB, 1.2–4 s hold, ~0.9 s recovery | `duckFor`, `AudioDirector.duck` |
| Night | music low-pass 16 kHz → 3.8 kHz as night falls (tau 3 s) | `AudioDirector.setNight` |

## Measured in the running game (headless Chromium, `npm run test:audio`)

RMS at the output, after the limiter, averaged over 9–14 s:

| Situation | Output RMS | What plays |
|---|---:|---|
| Dead ground, no music (before the first restoration) | **−44 dB** | thin wind only |
| Dead ground with a nocturne | −31.6 dB | wind + music |
| Restored, thriving patch with a nocturne | **−25.3 dB** | music, leaves 0.18, meadow 0.11, wind 0.05, bird calls every ~6 s |
| 50-bloom chain + landmark cue + coins + drones at once | peak **−10.4 dBFS** | 9 voices at the most (pool 24) |
| Page hidden | −120 dB | master at 0 |

So the restored world is ~6 dB fuller than dead ground with the same music, and the loudest stack of rewards
stays ~10 dB under full scale: the limiter never had to work in that test.

## Ambience vs music

The spec asks for ambience ~6–12 dB under the music in restored exploration. With baked music at ~−20 LUFS and
the music bus at 0.55 (−5 dB), music sits around −25 LUFS; the thriving beds (leaves 0.18 → −15 dB, meadow 0.11 →
−19 dB, on beds at −25 LUFS) land around −38 to −42 LUFS each, i.e. roughly 10–15 dB under. Water rises above that
only when you walk up to it (3D, refDistance 6 m).

## To check by ear (not possible headless)

- Headphones and speakers at modest volume, 30 min each (A09).
- Mono fold-down: the 3D sources use HRTF; check nothing vanishes in mono.
- Whether the leaves bed's brightness is comfortable on laptop speakers (low-passed to 5.5 kHz with a −3 dB dip at
  3.5 kHz).
- Bird-call rate in a big grove (max ~1 call / 4.5 s).
