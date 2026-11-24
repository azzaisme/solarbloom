# Market guidance before and after

In both captures, the Old Market gate is open and Bloombot has Tally’s restoration request. The baseline is Solarbloom testing at `071bcf9`. Both builds use the same camera positions and the classic model setting for software rendering.

| View | Before | After |
| --- | --- | --- |
| Fountain exit | [Trail to Tally](before-fountain-exit.png) | [Gold leaves through the opening](after-fountain-exit.png) |
| Market square | [Paving at arrival](before-market-tiles.png) | [Remaining tiles outlined](after-market-tiles.png) |

The [capture script](../../../tests/e2e/guidance-review.mjs) records both views and checks that restoring a marked tile removes its outline. Set `ART_BASELINE=1` and `ART_BUILD` to the baseline build directory to capture the before views.
