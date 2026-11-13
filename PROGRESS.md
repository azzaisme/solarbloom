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

## Verified

- `npm test`: 32 tests pass (grid, economy, placement, chains, drones, lucky cat, save/progression, and a scripted first session that reaches the Core).
- `npm run build`: type-check and production build pass.
- Headless Chromium (SwiftShader): the page loads with **no console errors or warnings**. Restoring, building, the drone, inspect, the cat click and the full Core sequence (including Skip) were driven through the real canvas picker and checked in screenshots at 1280×800 and 390×844.
- Pointer → tile picking was checked at desktop and phone sizes.
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
