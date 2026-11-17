# Bloombot: the player character

Epic #234. Decisions agreed with the owner on 17 Nov 2026 (decision record on #235). This doc is the rulebook
for every G issue; when an issue and this doc disagree, this doc wins until it is changed.

Solarbloom is **a restoration game first, not an idle game**. The player is **bloombot**, a small robot that
walks through the ruined city and does the restoring and building itself.

Reference images: [the character sheet](reference/bloombot-sheet.png) and
[the gameplay mock](reference/bloombot-mock.png).

## 1. Bloombot

- **Name:** bloombot. The sheet's "Reson, the Echo Gardener" is the design brief, not the name.
- **Look:** as the sheet. Ivory ceramic shell, champagne panels, gold trim, cyan glow, two leaves and a striped
  antenna, visor face, chest speaker, echo palms, gardening pack. Same family as the drone, and it catches the
  golden rim light.
- **Faces:** happy, surprised and wink, swapped on the visor the way the drone's are.
- **Moves by walking** on its legs.
- **Build path:** generated, rigged and animated in Meshy, then rebuilt in Blender to fit that rig (#264, #236).
  The game gains skinned animation for the first time.
- **Animations:** idle, walk, sprint, pulse, assemble, wade, interact, cheer and the lift ride.
- **Detail levels:** a near and a far version inside an agreed triangle budget, plus a flat marker for the
  overview and the minimap.

## 2. Mode and input

- **Bloombot is the game.** Every new game starts with bloombot, on every device.
- **Cursor play is removed for players** (#271). The cursor path stays in the code, unchanged, for the pacing
  bots, the soak test and the determinism tests. It is the reference that proves bloombot changed no numbers.
- **Targets are desktop and Steam Deck.** Phones and tablets are dropped for now; touch comes back as a later
  issue. The Look 5 phone layout stays in the code but is no longer tested against.
- **A click on the ground** makes bloombot walk there (path finding, #265) and use the current tool on arrival.

## 3. The world

| Thing | Walkable? |
|---|---|
| Revealed ground, dead or restored | Yes |
| Paths, plazas, lawn | Yes |
| Water (canals, ponds) | Yes, wading at reduced speed |
| Hidden fog (unrevealed areas) | No |
| Obstacles (rubble, pillars, crates, stumps…) | No |
| Machines and landmarks | No |
| Cozy plot options and decorations (#245) | Each is marked flat (walkable) or solid (blocks) |
| Rooftops | Only by the lift (#267), from a door on the building once its rooftop is unlocked |

Rules that must always hold (tested in #237):

- Bloombot never stands in hidden fog, inside a machine or obstacle, or off the ground.
- If something becomes solid under bloombot (a machine is built, a plot turns solid), it is pushed to the
  nearest walkable tile.
- Its position (layer, x, z, facing) is in the save. Reloading puts it back exactly where it was.
- Old saves load with bloombot at the fountain.

## 4. Tools

**Everything acts on the tile in front of bloombot** (the "target tile"), shown by a highlight. The target tile
is the walkable or buildable tile one step ahead along bloombot's facing.

- **Pulse:** lands on the target tile. Pulse Reach, Overcharge and Mega Pulse keep today's shapes, centred on that
  tile, so the tile counts and costs are exactly today's.
- **Build:** a ghost preview on the target tile (footprint anchored there). On press, the machine exists in the
  simulation immediately, exactly as today. Bloombot then plays an assembly animation for about 1.5 s. **The wait
  is seen, not counted.**
- **Inspect, wake and the Lucky Cat:** stand close and use the interact prompt. Landmarks, machines, rooftop
  doors and cats show a prompt when in range.
- **Harvest, upgrades, Frenzy:** unchanged, from keys and buttons.

## 5. Camera and travel

- **Default view:** the close, low view from the mock, following bloombot.
- **The view turns around bloombot** (changed 17 Nov 2026; it was a fixed angle): the right stick sideways, or a
  right-button drag, turns it a full circle; C or a right stick click recentres it. The light was composed for
  the default angle, so other angles look flatter.
- **Fixed distance, no zoom in play** (owner, 17 Nov 2026). The camera stays at the close view's distance.
- **Build mode stays close** (E19.2, replacing #280's pull-back and zoom). With something to build in hand (a
  machine, a superstructure core, a decoration, or the remove tool) the camera keeps the close view. A hologram
  sits where you aim, snapped to the grid, within 3.6 tiles of bloombot, red with a reason where it can't go. The
  mouse aims with a free pointer (while it's over the world and was moved in the last 8 s); the pad and the keys
  aim at the tile in front of bloombot. The mouse wheel, + / - and (on the pad) the bumpers turn a decoration a
  quarter turn; E / A places it, and it stays in hand for the next one.
- **The overview** stays on its own key (M / View) and is left by pressing it again or by walking.
- **Lower quality tiers** keep the same camera with a shorter view distance and thicker haze (#272).
- **Overview, fly-to and Home move the camera only.** Bloombot stays where it is, and the camera returns to it.
- **Covering distance:** sprint (#266), and travel from the overview to any landmark already woken.

## 6. HUD

- **New, from the mock:** a minimap (bottom left, north up, bloombot's arrow), a backpack (unlocked plot options,
  decorations and discoveries) and objectives worded by district, with a progress bar.
- **Style:** the default stays Look 5 dark glass (#107). The mock's light panels become the calm HUD option (#261).
- Every panel shows controller prompts when a gamepad was the last input (#242).

## 7. Controls

| Action | Keyboard and mouse | Gamepad | Today |
|---|---|---|---|
| Move | WASD, or click a tile | Left stick | (none) |
| Sprint | Shift | Right trigger | (none) |
| Pulse / confirm | E | A | click with tool 2 |
| Interact / inspect | Q | X | click with tool 1 |
| Build tray | B (machines on 3–0) | Y | B, 3–0 |
| Cancel / close | Esc | B | Esc |
| Harvest | F | D-pad left | H |
| Upgrades | U | D-pad right | U |
| Backpack | Tab | D-pad up | (new) |
| Cycle tools | 1 / 2 | Bumpers | 1 = inspect, 2 = pulse |
| Turn a decoration (build mode) | Mouse wheel, + / - | Bumpers (while one is in hand) | (none) |
| Remove / move a decoration | Remove tool + E; Q picks it up | Remove tool + A; X picks it up | (none) |
| Turn the view | Right-button drag | Right stick left / right | (none) |
| Recentre the view | C | Right stick click | (none) |
| Overview | M | View | (none) |
| Settings / pause | P | Menu | P |
| Bloom Frenzy | R | (to agree) | Q |
| Go to the area that needs you | N | (to agree) | F |
| Back to the park | Home | (none) | Home |
| Debug overlay | F3 or ` | (none) | F3 or ` |

Confirmed by the owner on 17 Nov 2026 (#235). Frenzy, "go to the area" and Harvest move because the mock
takes Q and F for Inspect and Harvest.

Notes for implementers:

- Tab must call `preventDefault` so it doesn't move browser focus.
- Movement keys are read by `KeyboardEvent.code`, not `key`, so WASD works on AZERTY and other layouts.
- Rebinding (#270) stores bindings by action name, so this table is the default map only.

## 8. What reads a pointer today, and what it reads instead

| Code (main, 17 Nov 2026) | Today | With bloombot |
|---|---|---|
| `src/rendering/InputController.ts` | pointer down / move / up, drag pan, pinch, wheel | Click becomes a walk target; drag pan and pinch go; wheel zooms toward the screen centre |
| `Game.pick(x, y)` (`src/app/Game.ts`) | camera ray from the pointer to a tile | Kept for click-to-walk. Tools use `bloombot.target()` instead |
| `Game.wireKeys()` | the "Today" column of §7 | The new map in §7, through a binding table (#270) |
| `Overlays` (ghost and hover previews) | follow the hovered tile | Follow the target tile |
| Pulse preview | under the cursor | Centred on the target tile |
| See-through trees and towers (`Game.updateTreeCursor`) | fade around the cursor and the screen centre | Fade whatever stands between the camera and bloombot |
| Lucky Cat (`Game.catHit`) | click near the cat | Interact prompt within reach |
| Landmark wake (`wake` callback in `Game`) | click a ready landmark | Interact prompt within reach |
| Drone tap (`Picking.pickDrone`) | click a drone to inspect | Interact prompt within reach |
| Tile tooltip (hover) | follows the pointer | Shown for the target tile, anchored above it |
| `CameraController` | pans freely, follows drags | Follows bloombot; free pan only in the overview |

## 9. Rules that don't move

- **No economy or pacing changes.** Tile counts, costs, rates and unlock order stay as they are.
- **The idle side stays as it is:** drones, offline earnings and hands-off play. Rebalancing toward helpers is
  a later epic, once bloombot is playable.
- **The same seed and inputs through the internal cursor path give byte-identical saves** to before this epic.
- The drone becomes bloombot's companion in looks only (#241).

## 10. Order

1. This doc and the reference images (#235).
2. Skinned animation pipeline (#264) alongside walking (#237), which can start with a stand-in model.
3. The bloombot model (#236), the follow camera (#238) and view distance (#272).
4. Pulse in front (#239). **Playable from here.**
5. Build, inspect, wake and the cat (#240); click to walk (#265); sprint and landmark travel (#266); the lift
   (#267).
6. Minimap (#268), backpack (#269), the key map and rebinding (#270), the drone companion (#241).
7. Full controller support (#242).
8. Cursor play removed for players (#271), once everything can be done with bloombot.
9. Steam Deck build (#243) and the owner's feel pass on a Deck (#244).

## 11. Elsewhere

- **#234's "done when"** is updated: the byte-identical check runs on the internal cursor path.
- **Phone targets** in the city epic (#1, #56, #74, #99) are parked while phones are dropped.
- **Look 4 (#106) and the draw-call budget (#8):** a default view with the horizon in shot needs its own view
  distance and budget work (#272). The overview is already over 400 draw calls.
- **The cozy city epic (#245)** comes after this one, so plots, decorations and the backpack are designed for
  bloombot once.

## 12. Status (17 Nov 2026, branch `bloombot-g1`)

| Issue | State |
|---|---|
| #235 G.0 design | This doc, the images, keys confirmed |
| #264 G.10 skinned animation | Done: `BloombotVisuals`, pipeline in `docs/art/bloombot-pipeline.md`. Leak test not run (needs Playwright) |
| #236 G.1 model | Generated, rigged, animated, Blender pass, faces. Waiting on the owner's look sign-off. No LOD1 yet |
| #237 G.2 walking | Done, tests in `tests/bloombot-walk.test.ts` |
| #238 G.3 follow camera | Done: close low view (zoom 3.2) by default, see-through to bloombot |
| #272 G.18 view distance | Close-view reach per tier and a perf-harness phase; real-laptop and 1,000-area runs still to do |
| #239 G.4 pulse in front | Done |
| #240 G.5 build, inspect, wake, cat | Done; assembly is a 1.5 s animation, the machine exists from the press |
| #265 G.11 click to walk | Done (A*, capped search) |
| #266 G.12 sprint, landmark travel | Done |
| #267 G.13 rooftop lift | Done: face a rooftop's building, Q rides up; face out over a roof edge, Q rides down |
| #268 G.14 minimap | Done; HUD e2e not run here |
| #269 G.15 backpack | Discoveries now; plots and decorations arrive with #245 |
| #270 G.16 key map, rebinding | Done, tests in `tests/bindings.test.ts` |
| #241 G.6 drone companion | Done (looks only) |
| #242 G.7 controller | Pad play, focus navigation, `tests/e2e/gamepad.e2e.mjs`; text button labels, not glyph SVGs yet |
| #271 G.17 bloombot for everyone | Done in code; GitHub notes on #56, #74, #99 not posted |
| #243 G.8 Steam Deck build | Not started |
| #244 G.9 owner playtest | Owner |
