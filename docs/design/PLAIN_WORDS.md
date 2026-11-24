# Plain words — how Solarbloom talks to the player

**The golden rule: a player doesn't know what they are doing, but they can see things.**
Every line says what they will *see* happen, or what to *do* (which key, where to look). Never a system idea they
were never shown.

**And it still sounds like a person.** Solarbloom is a calm, warm game. The text is a friendly voice beside you,
not an instruction manual: short, kind, a little poetic where there's room ("The clouds lift"), never clinical.
Plain does not mean robotic.

## The voice

- Second person, present tense, gentle: "Turn the ground beside it green and the flowers spread from there."
- Lead with what happens or what to do, then (if there's room) the small pleasure of it.
- One idea per toast or card. A second idea gets its own line, or waits.
- Name the key: write `{pulse}`, `{interact}`, `{eat}`, `{buildMenu}`, `{backpack}`… (any action id from
  `src/app/Bindings.ts`). The HUD fills in the player's own key or pad button ("Press E", "Press Ⓐ").
  Game.ts may also use `this.hudKey('pulse')` as before.
- Never "click" or "tap" (keyboard and gamepad players). Say "press".
- Numbers only for things you count by hand ("3 of 5"). No "s" for seconds ("a few seconds", "nearly done"),
  no ×3, no +1 per level, no tile distances ("right next to it", "nearby", "in the lit-up area").
- Keep personality and names the player can see: Bloombot, Greens, Charge, the Keepers by name, machines by the
  names in the build menu (Solar Panel, Drone Hub, Bloom Relay, Water Condenser…), drone jobs (Courier, Spark…).

## One name for each thing

| Don't say (system word) | Say (what the player sees) |
|---|---|
| tile, tiles | ground, a patch of ground, the square in front of Bloombot |
| restore, restored, restoration | turn green, bring back to life, green ground |
| mossy / polluted / prepared | grey ground, mossy ground (both are visible) |
| chain, Bloom Chain, combo | the flowers spread, a wave of flowers |
| grid, network, linked, line (power) | joined by power lines, the machines it powers |
| radius, range, reach, zone | nearby, around it, right next to it, the lit-up area |
| stack ("stack is full") | Bloombot can't carry any more |
| store, storage (shared) | your chests (anything in one chest can be taken from any chest) |
| cache | a buried box |
| hub (alone) | its Drone Hub, its home |
| role | job |
| dock / docked | home, waiting at home |
| merge, superstructure | join, a big machine |
| hotbar, slot | the build bar, button 1–9 |
| Hover (for sprint) | Hover to move faster |
| Interact (as a word) | the key: `{interact}` |
| "Pulse it" with no key | "Press {pulse}" |
| overlay, debug | (hide developer things; say "the water view", "the power view") |
| recharge, cooldown | rests for a moment |
| biomass, clippings | Greens |

## Before → after

| Before | After |
|---|---|
| Restorations inside its zone spread to mossy neighbours: Bloom Chains! | Turn the ground beside it green and the flowers spread to the mossy ground around it. |
| Slumped against a lamp post. Give it a pulse to stir it. | Slumped against a lamp post, fast asleep. Stand beside it and press {pulse} to stir it. |
| Your Greens stack is full: leave some in the storage at the fountain | Bloombot can't carry any more Greens. Leave some in a chest. |
| Esc frees it | Press Esc to bring the mouse pointer back. |
| Out of charge. Eat something, rest or find a charger | Out of Charge: press {eat} for a snack, or sit on a bench to rest. |

`tests/bloombot-words.test.ts` enforces the banned words (`BANNED` in `src/ui/words.ts`) across every file with
player text.
