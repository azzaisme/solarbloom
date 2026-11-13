# Solarbloom: progress

## Milestones

| | Milestone | Status |
|---|---|---|
| M0 | PlayCanvas + TS + Vite, ortho iso camera, lights, pan/zoom, pointer/touch picking, UI shell, FPS toggle | ✅ |
| M1 | 8×8 grid with polluted / prepared / growing / restored looks, hover, click-to-restore, animated transitions, resources, solar fail-safe, save/reload | ✅ |
| M2 | Passive production, build mode with ghost + occupancy, solar/condenser/pollinator, 7 upgrades with visible effects, inspect + radius | ✅ |
| M3 | Bounded deterministic chain queue, pollinator-driven chains, combo UI/arcs/sounds, duplicate/infinite guards with tests | ✅ |
| M4 | Drone Hub + cute drone, reservations, flight, automated restoration, speed upgrade, idle behaviour | ✅ |
| M5 | Lucky Cat: first cat at ~3–5 min, 7 hiding anchors, screen-space click target, all 5 reward types, persistence, no double rewards | ✅ |
| M6 | Core requirements + building restoration sequence, camera reveal of Rooftop 2 and bridge, contextual tutorial, audio, responsive layout, new game | ✅ |
| M7 | Rooftop 2 playable, relays, Mother Tree, more machines | ⏭ next |

Extra beyond the plan: **Nurture**. Pulsing a restored tile grows it through three bloom levels (grass → wildflowers → shrubs/trees). This keeps something useful to click after the roof is green, and gives the garden its lushness.

## Gaps filled after the first pass

- Faint tile grid while building; the ghost now has a coloured outline.
- Expandable 🔨 Build tray on phones (machine cards are always visible on wide screens).
- Game speed chip: 1× / 2× / 3×.
- Butterflies over restored tiles (up to 10, one per 5 restored tiles).
- Placement animation: foundation pops, shell unfolds with a quarter twist, the light switches on with a ripple and chime.
- Lucky Cat discovery panel: nooks found, reward types collected. Saved in the discovery log, and old saves load with an empty log.
- Automated pointer→tile test (`npm run test:e2e`): every on-screen tile at 5 points each, at 1280×800, 820×1180 and 390×844, zoom 0.6 / 1 / 1.8, plus a real mouse click and a hotbar click that must not touch the world. 2,778 checks pass.

## Phone playtest fixes

**Frame rate fell apart after lots of tapping.** Cause: every tile change rebuilt one dynamic batch holding *all* tile decoration (~300-vertex spheres), so each rebuild got slower as the garden grew. Measured on a 150-tap storm in headless Chromium: batch rebuilds took 11.2 s in total, average JS frame 165 ms, worst frame 9.2 s.
- Tiles now batch in small regions (4×2 tiles), so a tap only rebuilds its own region.
- Tile decoration uses low-poly meshes with baked vertex colours and one shared material, so each region draws in about one call.
- Up to 8 flying "+🌿" numbers at once (extras just flash the counter); no backdrop blur on touch devices.
- Adaptive resolution: render scale steps down after 1.5 s of slow frames and back up when there's headroom (shown in the F3 overlay).
- After: batch work 0.22 s in total, average frame 10 ms, worst frame 28 ms on the same storm; 150–230 draw calls.

**"Not clear what to do."**
- A welcome card for new players (three steps and the goal).
- A bouncing golden marker on the first tile to tap.
- Hints now use live numbers ("costs 20🌿 10⚡, you have 7🌿") and say exactly which button to tap.
- The control a hint refers to glows (on phones, the 🔨 Build button when the machine is in the tray). Harvest glows when you run out of energy.
- A "Next: …" line on the objective panel on phones, where the checklist is collapsed.

## Verified

- `npm test`: 32 tests pass (grid, economy, placement, chains, drones, lucky cat, save/progression, and a scripted first session that reaches the Core).
- `npm run build`: type-check and production build pass.
- Headless Chromium (SwiftShader): the page loads with **no console errors or warnings**. Restoring, building, the drone, inspect, the cat click and the full Core sequence (including Skip) were driven through the real canvas picker and checked in screenshots at 1280×800 and 390×844.
- Pointer → tile picking is covered by the automated e2e test above.
- Save → reload keeps tiles, machines, upgrades and the active cat.
- Draw calls: about 140 early game, about 300 with a full garden (static + dynamic batching).

## Known issues and notes

- Real-GPU frame rate hasn't been measured: the sandbox only has CPU WebGL (SwiftShader runs at about 1.5 fps). Batching and pooling are in place; profile on a phone next.
- Pacing comes from a scripted bot (about 4 min at one click every 3 s). Human playtests are needed; every number is in `src/data/tuning.ts`.
- The emoji used in HUD icons depend on the system emoji font.
- The playcanvas chunk is about 2.1 MB minified (559 kB gzip). Tree-shaking or code-splitting could reduce it.

## Next steps

1. Make Rooftop 2 playable: unlock its grid, add multi-roof camera navigation and an Energy Relay to carry chains across the bridge.
2. Mother Tree (stores bloom charge, releases a big pulse).
3. A Lucky Cat discovery log, more anchors on Rooftop 2.
4. Art pass: rounded meshes, instanced foliage, butterflies over restored tiles, softer shadows.
5. Human playtest and tuning pass; consider an optional 2× speed toggle.
