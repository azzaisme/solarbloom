# Phase 8 — Audio event map

Every game event with a sound, where it is triggered, and what plays. Families set caps and cooldowns
(`FAMILIES` in `src/audio/AudioMath.ts`); priority: events/cat (5) > UI, build, restore (4) > economy, chain (3) >
stage, footstep (2) > drone, wildlife (1). The pool holds 24 voices; when it is full only priority ≥ 4 starts.
"Recorded" means a human recording is used when its file is in the build, with the designed sound as fallback.

| Group | Event | Trigger (Game.ts) | `Sfx` method | Bus | Family | Treatment |
|---|---|---|---|---|---|---|
| Movement | Footfall | `BloombotVisuals.onFootfall` (foot plant in the walk clip) → `footfall()` | `footstep(surface)` | sfx 3D | footstep (2, 0.12 s) | grass / dirt / stone / wood (decks) / sand / water (wading); recorded variations, no repeats |
| Restoration | Pulse | `tile.restoring` (source pulse) | `pulse()` | sfx 3D | restore | breathy rising whoosh + low glide |
| Restoration | Tile restored (by hand) | `tile.restored` (manual) | `restored(n)` | sfx 3D | restore | soil + leaf (recorded) + mallet note climbing the scale |
| Restoration | Tile grows a stage | `tile.nurtured` | `nurture(level)` | sfx 3D | restore | leaf unfolding + two-note rise |
| Restoration | Transition stages | tile transition timeline | `stage(crack/grind/creak/thud/sprout/rustle)` | sfx 3D | stage | rate-limited per stage |
| Restoration | Life returns | — (continuous) | `SoundscapeDirector` | ambience | — | local beds rise over 5–12 s |
| Chains | Each bloom | chain events (RESTORE/GROW/LUSH) | `bloom(combo)` | sfx 3D | chain | aggregated ladder within two octaves, chords thicken, softer when fast |
| Chains | Chain lands | `chain.ended`, mega, Mother Tree, relay | `chainEnd(combo)` | sfx | event | resolved chord; ≥10: pad + swell + music duck 1–3 dB |
| Economy | Spend / upgrade / deliver | `celebrateUpgrade`, deliveries, crafting | `coin()` | sfx | economy | two mallet notes; quick repeats soften |
| Building | Place / merge | build placement, decor | `build()` | sfx | build | wooden knock, latch, settling notes |
| Building | Machine wakes | `machines.onActivated` | `powerUp()` | sfx | build | rising hum into a bright note |
| Automation | Drone sets off | drone jobs | `drone(role)` | sfx 3D | drone (0.4 s per role) | one quiet chirp per role |
| Automation | Cultivator working near view | frame loop | `stage('hum')` | sfx 3D | stage (1.2 s) | low soft hum, proximity-bound |
| Water | Clean water near | 0.25 s scan `placeBrook` | `setBrook` | ambience 3D | — | brook loop at the water's centroid |
| Water | Sea near | `placeSea` | `setSea` | ambience 3D | — | shore wash at the nearest open water |
| Wildlife | Bird calls | `placeBirds` → perches; `birdRate` | SoundscapeDirector | ambience 3D | wildlife | one-shot calls from grown trees, by day, rate by habitat |
| Wildlife | Ruin creak | `creakRate` | SoundscapeDirector | ambience 3D | wildlife | rare, 18–32 m away, dead ground only |
| Milestone | Goal done (waymark pulse) | `waymark.onPulse` | `bloomPulse()` | sfx 3D | event | swell + rising chord, small duck |
| Milestone | Area unlocked | `area.unlocked` | `areaOpen()` | sfx | event | airy triad, small duck |
| Milestone | Landmark woken, fountain tier, core, tier/wake | several | `landmark()` (`fanfare()`) | sfx | event (3 s) | pad chord + rising phrase, duck −3 dB ~4 s |
| Discoveries | Lucky Cat found | `cat.found` | `catFound(variant)` | sfx 3D | event + cat | meow + skipping run; golden: upper octave; rainbow: shimmer chord |
| Discoveries | Hint meow | timer, from a hiding spot | `meow(true)` | sfx 3D | cat | quiet, 30–50 s apart |
| UI | Confirm / select | menus, buttons | `click()` | ui | ui (0.035 s) | one soft mallet tick |
| UI | Invalid action | `showFail`, errors | `error()` | ui | ui (0.25 s) | two falling notes |
| Music | Score | `moodFor` (4 Hz) | MusicDirector | music | — | one piece at a time, rests, mood hold 40 s, night low-pass |
| Music | Bench sit swell | `Resting` | `swell(by)` | music | — | opens the score a little |
| N/A | Bloom Frenzy | retired in E23.1.2 | — | — | — | — |
| Intentional silence | Objective skybeam | — | — | — | — | no waypoint ping: the goal pulse plays on arrival only |
