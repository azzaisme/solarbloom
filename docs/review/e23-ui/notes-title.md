# E23.11 title, gardens, are-you-sure and loading: where it stands (paused)

Paused on the owner's request. Nothing committed. Every edit below is finished (no file is half-changed), but
**none of it has been type-checked, tested or looked at yet**. The one heavy job queued (`npx tsc --noEmit`) waited
behind another session's e2e for its whole time in the queue and was stopped before it ran.

## Done (written, not yet verified)

- `src/ui/Confirm.ts` + `src/ui/confirm.css` (new): the reusable are-you-sure dialog, exported as `Confirm` (and
  `confirmHold`, `holdProgress`). role=alertdialog, clay badge, title, the garden's picture and facts, the plain
  "goes for good, can't get it back" line. "Keep my garden" is primary and focused. The destructive button is clay
  and needs a ~1 s hold (Enter/Space, mouse press or pad A) with a filling ring; letting go early resets it. B/Esc
  back out. It traps Tab and the arrows itself, reads pad A for the hold, and a host forwards new pad presses through
  `pad(i)`. `result` resolves true only after a full hold.
- `src/ui/Title.ts`: rewritten to the boards. The left-third frosted strip has the leaf badge, the Fredoka wordmark,
  "Bring the island back to life" and Play/Settings/Quit (Quit only when the host can quit). There is no key-hint row.
  "Press any button" and the splash are kept, and the splash now shows the leaf badge and wordmark. "Your gardens":
  - three cards (picture, name, Day + time of day, Played, Fountain "Step N of 5", Last seen);
  - the last-played card is tagged and its Carry on is focused;
  - each card has Carry on, Rename, Start over and Delete;
  - an empty card says "Start a new garden";
  - an earlier-version card offers Start fresh and Delete;
  - the action-bar footer has Choose, Y Rename (pad) and a Back button;
  - the pad's Y renames the focused garden.
  Start over and Delete use Confirm, and Start over then asks the existing day-clock question. Rename still asks
  first, and the clock question is restyled as a plain dialog. Every old id is kept (#tPress, #tPlay, #tSettings,
  #tQuit, #tLoadN, #tRenameN, #tStartN, #tDeleteN, #tNameN, #tSaveNameN, #tYes/#tAlt/#tNo, #tConfirmText, #tBack,
  .t-side, .t-slot). The button pictures follow the device in use (new optional `TitleHost.padStyle`). The helpers
  `fountainText`, `dayText` and `factsLine` are exported.
- `src/ui/title.css`: rewritten in Sunlit Glass tokens: strip, buttons, cards, tag, facts, rename, plain dialog,
  high-contrast rules, and reduced motion (still backdrop, no pulse). The loading screen is restyled (paper card, leaf
  bar, "Tip" line, bloombot standing on the card, bot recoloured from tokens). The #saveLeaf rules are unchanged.
- `src/ui/Loading.ts`: same content, new markup. A head row holds the leaf badge and the step line; then the bar; then
  the tip. Bloombot sits inside the card.
- `src/app/SaveService.ts`: the header gains `steps` (fountain steps done) and `daypart`
  (morning/afternoon/evening/night). There is also a new exported `dayPartAt`. Older headers still show (they fall
  back to the `step` words).
- `src/app/Boot.ts`: one line, which passes `padStyle` to the Title host.
- `tests/save-slots.test.ts`: new tests for steps/daypart, `dayPartAt`, `fountainText`/`dayText`/`factsLine` (and
  their banned words) and `holdProgress`.
- `tests/e2e/title.e2e.mjs`: the old delete check (`#tYes` + "This can't be undone.") is replaced. The keys run now
  checks:
  - Keep is focused when the dialog opens;
  - a quick Enter keeps the garden;
  - Esc backs out;
  - a 350 ms hold does nothing;
  - a 1.4 s hold deletes.
  A new pad run checks Start over: a quick A keeps, holding A asks the clock question, and B backs out.
- `tests/e2e/e23-title-shots.mjs` (new): takes these shots into docs/review/e23-ui/ at 1600x900 and 1280x800
  (?gfx=deck):
  - press, menu, gardens, the dialog, the dialog mid-hold and rename;
  - the pad's pictures;
  - high contrast;
  - the clock question and loading.

## Left to do

1. `bash ~/.solarbloom/heavy.sh "e23-ui title: tsc" npx tsc --noEmit`: not run yet. Watch for the narrowing of
   `e.target` in `Title.key`'s rename-field branch.
2. Vitest: `tests/save-slots.test.ts` (and the quick suite) through heavy.sh: not run.
3. `vite build && node tests/e2e/title.e2e.mjs`, and `tests/e2e/fresh-start.e2e.mjs` (it reads `.t-slot` text and
   `#tConfirmText`'s parent): not run.
4. `vite build && node tests/e2e/e23-title-shots.mjs`, then look at every shot against Title/Saves/Confirm.dc.html
   and fix what differs. Likely things to check:
   - the three small buttons fitting in one row on a 330px card;
   - the tagline's contrast on the 42% strip;
   - the glyph sizes in the hold ring;
   - the cards at 150% UI scale.
5. A screen-reader note: the hold button can't be activated by a plain click. That is by design, but a screen-reader
   user may need another way.

## Broken right now

Nothing is known to be broken, but nothing is verified: no type check, unit test, e2e or screenshot has run on these
changes.
