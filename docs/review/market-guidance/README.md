# Market guidance before and after

In both captures, the Old Market gate is open and Bloombot has Tally’s restoration request. The baseline is Solarbloom testing at `071bcf9`. Both builds use the same camera positions and the classic model setting for software rendering.

| View | Before | After |
| --- | --- | --- |
| Fountain exit | [Trail to Tally](before-fountain-exit.png) | [Leaves drifting through the opening](drifting-fountain-exit.png) |
| Market square | [Paving at arrival](before-market-tiles.png) | [High-contrast restoration outlines](outlined-market-tiles.png) |

The [motion preview](drifting-leaves.gif) uses the game’s trail renderer on a small test path. The previous pass is available for comparison in the [flat trail](after-fountain-exit.png) and [faint tile outlines](after-market-tiles.png) captures.

The eye-level light pass adds a ribbon and soft star glints. Leaves form along the ribbon with independent random starting angles and drift down to the same walkable route.

- [Eye-level light in the game](eye-level-fountain-exit.png)
- [Animated ribbon and leaves in the test scene](eye-level-light.gif) · [still frame](eye-level-light-preview.png)
- [Previously, leaves drifted from above the route](drifting-fountain-exit.png)

The [capture script](../../../tests/e2e/guidance-review.mjs) records both views and checks that restoring a marked tile removes its outline. Set `ART_BASELINE=1` and `ART_BUILD` to the baseline build directory to capture the before views.
