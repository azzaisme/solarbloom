# Sunlit Glass: the E23.11 UI

The approved design boards are in [ui-sunlit-glass/](ui-sunlit-glass/) (HTML, open in a browser; `sb.css` is the
design's stylesheet). The owner reviewed them on the design canvas before the build.

## The idea

- **Light frosted paper over the painted world**, dark green ink. Nunito everywhere; Fredoka only for the wordmark.
- **Four colours, one meaning each**:
  - leaf: act, focus, growing;
  - sun: charge and power;
  - sky: water;
  - clay: "not yet" and careful choices.
- **Materials are shape-coded** (Scrap a hexagon, Copper a ring, Glass a diamond…), so colour is never the only cue.
- **Five calm parts while walking**:
  - the objective (top left);
  - charge, the only meter (top right);
  - the painted minimap with the clock and weather (bottom left);
  - one prompt (bottom centre);
  - toasts (bottom right).
  - Above the toasts sits a quiet shortcut dock: Backpack, Map, Menu, each with its button picture.
- **One panel shell**:
  - Centre sheets pause the game: backpack, build menu, craft, settings.
  - Machine cards dock on the right and keep the world in view.
  - Every panel ends in an action bar that names its buttons with the pictures of the device in use.
- **Focus is a leaf ring** on every screen. A pad never needs the mouse; the mouse never needs a pad.
- **Destructive choices** (start over, delete) open an are-you-sure dialog:
  - the safe button is picked first;
  - the destructive one needs a one-second hold.

## Build mode on a pad

| Button | Building / decorating |
|---|---|
| A | place; aimed at a placed decoration, pick it up. Hold and move the right stick to lay a run |
| Right stick | moves the build cursor over the ground (build mode looks down from above) |
| Click right stick | Fill: a drag covers the whole patch (on / off) |
| LB / RB | turn the piece |
| D-pad left / right | previous / next hotbar slot |
| D-pad up | view: off → power → water |
| RT | remove mode |
| Y | the build menu (all builds; pin to a slot) |
| B | stop building |

Walking keeps its own d-pad jobs (eat, pin, backpack).

## Tokens

All colours are tokens in the first `:root` of `src/ui/styles.css`; `tests/hud-contrast.test.ts` checks AA contrast.
The older token names (`--glass`, `--text`, `--gold`, `--edge`) remain as aliases on the new palette.
