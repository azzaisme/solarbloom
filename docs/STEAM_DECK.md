# Solarbloom on a Steam Deck

The Steam Deck build (#243) is the web game wrapped with Electron as a Linux AppImage. Every merge of `testing`
into `main` publishes one as a GitHub release (`.github/workflows/release-steamdeck.yml`).

## Install

1. On the Deck, switch to **Desktop Mode** (Steam button → Power → Switch to Desktop).
2. From the latest release, download `Solarbloom-<version>-steamdeck.AppImage` and `add-to-steam.sh`.
3. Open Konsole and run:

   ```bash
   bash ~/Downloads/add-to-steam.sh ~/Downloads/Solarbloom-*-steamdeck.AppImage
   ```

   It copies the game to `~/Applications/Solarbloom.AppImage` and adds it to Steam as a non-Steam game.
4. Return to Gaming Mode. Solarbloom is under Library → Non-Steam.

To update, download the new AppImage and run the script again.

## What the build does differently

- **Full screen at 1280×800**, with the mouse cursor hidden until the mouse (or a trackpad) moves.
- **The Deck graphics preset**, picked automatically on a Deck (Settings → Graphics shows "Auto (Steam Deck)";
  it can be chosen by hand on any machine, or forced with `?gfx=deck`):

  | Setting | Deck preset |
  |---|---|
  | Render scale | 0.75 (960×600 on the Deck's screen) |
  | Post-processing | Bloom and grading on; no ambient occlusion, no depth of field |
  | Anti-aliasing | 2× MSAA |
  | Shadows | 1024² |
  | Flowers, tufts, near tree detail | The Low tier's thinner set |
  | Close-view reach | 70% of the full haze distance |

- **Saves are files**: `~/.config/Solarbloom/saves/*.sav`, written to a temporary file and renamed so a suspend
  mid-save can't leave half a file. A save from browser storage is imported the first time. Point Steam Cloud
  (when the game has a Steam app id) at that folder.
- **Interface size** (Settings): 100, 125 or 150%.

## Controls

The game reads the Deck as a standard gamepad, so Steam Input's built-in **Gamepad** template works as it is:
left stick to walk, A to pulse, X to interact, Y for the build tray, B to cancel, right trigger to sprint,
bumpers to change tool, right stick to zoom, View for the overview, Menu to pause, and the d-pad for the
backpack, harvest and upgrades. Buttons can be rebound in Settings → Controls. A custom Steam Input template is
not shipped yet.

## Test checklist (on a real Deck)

Record the result of each on the issue (#243, #244).

- [ ] The AppImage starts from Gaming Mode, full screen, with no cursor showing.
- [ ] Cold start to standing in the park takes under 15 seconds.
- [ ] Settings → Graphics shows "Auto (Steam Deck)".
- [ ] A new game can be played to waking the fountain with the Deck's controls only.
- [ ] Every panel opens, can be moved through with the d-pad and closes with B: build tray, upgrades, backpack,
      settings, an area panel.
- [ ] Text is readable at 100%; try 125% and 150% and check nothing overlaps or leaves the screen.
- [ ] Restored park, close default view, a ×300 chain running and drones working: 30 fps or better (turn on the
      debug overlay with Settings → Debug, or Steam's performance overlay; attach a frame-time log).
- [ ] Suspend (power button) for a minute and resume: the game continues and nothing is lost.
- [ ] Quit from the Steam menu, start again: the save loads with bloombot where it was.
- [ ] `~/.config/Solarbloom/saves/` holds the save file.

## Building one yourself (Linux)

```bash
npm ci
```

```bash
npm run package:deck
```

The AppImage lands in `release/`. `npm run desktop` opens the built game in a window on any OS; add `-- --deck`
to try the Deck preset.
