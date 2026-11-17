# E22: Controls and UI — one obvious button, one backpack, a HUD about the place

## Goal
The buttons and screens fit a game about exploring and restoring. One button does the obvious thing to whatever is in front of bloombot. One prompt says what that is. One backpack screen holds items, requests, the journal and collections, and everyone can read and use it. The HUD shows the place, not the economy.

This epic is the controls and screens for E21 (The Old City). E21 names actions; this epic gives them keys.

## Today's problems (`testing`, 18 Nov 2026)
- **Pulse is on E and Interact is on Q.** Games of this kind put Interact on E.
- **Interact is a queue of seven hidden priorities** (`Game.botInteract`), so the same key does unexpected things.
- **Build tools 3–0 cannot be rebound** (`BUILD_DIGITS`), and tools cycle on 1 / 2.
- **Too many top-level keys:** harvest, upgrades, Frenzy, next area, home and photo each have one.
- **Pad prompts have no glyphs** (noted in `docs/BLOOMBOT_EPIC.md`).
- **The backpack is read-only cards**, with no items, and the HUD is one 1,200-line file (`src/ui/Hud.ts`) built round resource rates.

## Decisions
1. **Interact** does the obvious thing to what is in front: salvage, talk, open, deliver, pry, climb, glide, enter. **Pulse** is the tool in bloombot's hands.
2. **One prompt** on screen at a time, showing the key or button and a verb ("E Salvage", "Hold E Pry", "E Talk to Pylon").
3. **Prompt priority**, nearest first within each: Lucky Cat → Keeper → salvage pile → cache or page → gate or ladder or perch → door → storage → landmark or fountain → machine → plot → nothing.
4. **Holds** (salvage 0.6 s, pry 2 s) can be switched to a single press in settings.
5. **Glyphs follow the last device used**: keyboard keys, Xbox, PlayStation or Steam Deck.
6. **Every action can be rebound**, the build number row included. Saved bindings from before are reset once, with a notice.
7. Frenzy, upgrades and next-area lose their default keys under old-city rules (E21 hides them); they keep them under classic rules.

## The new map

| Action | Keyboard and mouse | Gamepad |
|---|---|---|
| Move | W A S D, or click to walk | Left stick |
| Sprint | Shift (hold) | Left trigger (hold), or click left stick to toggle |
| Look | Hold right mouse and drag | Right stick |
| Zoom camera | Mouse wheel | D-pad down (cycles) |
| Recentre camera | C | Click right stick |
| Interact | E | A |
| Pulse / use tool / place | Left mouse, or Space | X (place is also A in build mode) |
| Build menu | Q | Y |
| Rotate piece (build mode) | R, or mouse wheel | LB / RB |
| Remove mode (build mode) | X | Right trigger |
| Hotbar slots | 1–9 | — (use the build menu) |
| Backpack | Tab, or I | D-pad up |
| Map | M | View |
| Harvest Sunlight | F | D-pad left |
| Pin next request | G | D-pad right |
| Back / cancel | Esc | B |
| Pause and settings | Esc with nothing open | Menu |
| Photo mode | P | In the pause menu |
| Tabs in a panel | Q / E, or click | LB / RB |
| Debug overlay | F3 | — |

In build mode the mouse wheel rotates the piece and the camera zoom is paused.

## The HUD

| Where | What |
|---|---|
| Top left | The objective card: one pinned request or the next fountain tier |
| Top right | Energy and water bars, and nothing else |
| Bottom left | Minimap, with the clock and weather icon on its rim |
| Bottom centre | The prompt, and above it the build hotbar only while build mode is open |
| Bottom right | Toasts, one at a time; material pick-ups stack as "+3 Copper" |

Nothing else is on screen while walking. Safe area: everything inside 1280 × 800 at 100%, 125% and 150% UI scale.

## The backpack screen
One full-screen panel with tabs: **Items**, **Requests**, **Journal**, **Collection** (cats, keepsakes, wildlife, landmarks), **Blueprints**.
- **Items:** a grid of materials. Each cell has an icon with its own shape as well as colour, the name in text, and "32 / 40". Selecting one shows where it comes from (once seen), what it is used for next, and how many are in the store.
- Text is at least 16 px at 100% scale; contrast at least 4.5:1; nothing is told by colour alone.
- Every cell and button can be reached with the keyboard alone and with the pad alone, with a visible focus ring, and has a screen-reader label ("Copper, 32 of 40 in backpack, 110 in store").
- The game pauses while it is open.

## Plain words, few numbers
The walking view today shows three resource bars with limits and rates ("23 / 60, +71/min"), a home chip, a wildlife count, pause and fast-forward buttons, a gear, an Upgrades button and an objective line reading "Restore tiles 14/130 · reward at 20". All of that goes.

- **No chips or buttons on the walking view.** Home is a travel point on the map; the wildlife count is in the backpack's Collection; pause and settings are in the menu; fast-forward is a developer tool only; Upgrades is the Workbench (E21).
- **Energy and water** are two small gauges (icon and bar, no numbers, no rates). Each fades out when full and unchanged for 5 s, and comes back when it changes or runs low. Biomass is not on the walking view.
- **The objective card is one plain sentence** about a thing and a place: "Bring 20 Scrap and 6 Seeds to the fountain", "Help Pylon: restore the tram stop". A count appears only for things I gather or restore by hand, as "12 of 20".
- **Numbers live in the backpack and the panels I open**, never over the world. Setting "Show details" (replaces "Show numbers") adds the figures to the two gauges for players who want them.
- **Words not used on screen under old-city rules:** rate, /min, per second, cap, overflow, reward at, frontier, sealed, specialty, permit, tier (each fountain step has a name), combo, multiplier, ×N, buff, Frenzy, full bloom (say "in flower"), biomass (say "Greens"), node, seam (say the place: "the Pipeworks"), old-city, classic. A test scans every HUD string for them.
- **Writing rules:** a verb and a thing a new player already knows; no abbreviations; a region or Keeper by name; one sentence per card or toast.

## Pause, and the in-game menu
- **A real pause.** Esc with nothing open, or Menu on the pad, stops the simulation, the clock, weather, helpers, animation and world sound; the world dims and blurs; music drops to a quiet bed. Nothing happens while paused.
- The game also pauses on its own when the window loses focus, when the Steam Deck sleeps, when a pad disconnects, and while any full-screen panel (backpack, map, storage, Workbench, house) is open. Setting: "Pause when the window is not in focus" (on).
- **The menu:** Resume · Backpack · Map · Photo mode · Settings · Save now · Quit to title (and Quit to desktop in the Deck build). Its header shows the save's name, the region bloombot is in, the day number and time played.
- **Settings** is one screen with tabs: Game, Controls, Display, Sound, Accessibility. It is the same screen from the title and from the menu.
- "Quit to title" saves first. There is no way to lose progress from the menu.

## Title, saves and loading
- **Splash:** the Solarbloom logo on a plain background for up to 2 s, skippable with any input.
- **Title screen:** the logo over a slow turn round a restored park (a fixed built-in scene, at dawn), with Continue · New game · Load game · Settings · Quit (Deck build). "Press any button" picks the glyph set.
- **Three save slots.** Each shows a name (editable), the day, time played, the fountain's step and the last region. The existing single save becomes slot 1. New game on a used slot asks first. Old-rules saves show a "Classic" tag.
- **Loading screen:** a painted still of the city, bloombot walking on the spot, a real progress bar (models, world, first view) and one line of plain text from a list of 20 tips. The game fades in only when the ground, models and textures round bloombot are ready, so nothing pops in. It shows for at least 0.5 s and the same screen covers "Quit to title".
- A small leaf icon in the corner shows when the game saves.

## Tasks
(See the issue list on the epic.)

## Done when
- A new game can be played to the first woken landmark with only a gamepad and with only keyboard and mouse, and every prompt shows the right glyph for the device in use.
- Every action can be rebound, conflicts are refused with a clear message, and "Reset to defaults" works.
- The backpack can be opened, read and used with a keyboard alone, a pad alone, at 150% scale and in high contrast.
- `npm run test:hud` and `npm run test:gamepad` pass at 1280 × 800.

## Out of scope
Touch controls, voice control, a full screen-reader narration of the 3D world, new HUD art beyond glyphs and material icons.
