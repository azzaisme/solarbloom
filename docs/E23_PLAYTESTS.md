# E23 playtests

E23.10.3 (#407): the owner plays each milestone of epic #354 before the next layer goes on. Each milestone gets a
build on `testing` and these notes. Tick what holds, and write down anything that felt off, however small: the
next layer is planned from these.

Play on a new game each time (old saves are dropped). Play part of each session with a gamepad and part with
keyboard and mouse.

## Every milestone

- [ ] Cozy wins: nothing that ran out felt like a loss. Nothing went back to dead ground, no crop died, nothing built was lost.
- [ ] Bloombot was never stranded. At zero charge it could still walk home.
- [ ] The only number on screen was bloombot's charge.
- [ ] Nothing felt idle: no counters ticking up, no waiting for a number, no progress while the game was closed.
- [ ] The world showed what was wrong (dark machines, low water, wilting planters) without a toast or tooltip. New
      ideas got one short introduction the first time, and never again.
- [ ] No hint of the Lucky Cats anywhere (pulse ripple, animals, HUD).
- [ ] Every new object had a real model. Note any stand-in.
- [ ] Every new panel worked with the gamepad alone.
- [ ] Notes: the moment I enjoyed most, the moment I was bored, the moment I was confused.

## Milestone A: the home loop

Charge (E23.2.1), the loaded pulse (E23.2.2), planters, crops and compost (E23.5.1–E23.5.3), the crafting table
(E23.6.1), the grid's first pieces (E23.3.1–E23.3.3) and the day (E23.7.1).

- [ ] A full charge lasted about 10 minutes of active play. Walking felt free; pulsing and sprinting felt like spending.
- [ ] I topped up by eating, by meditating at a charger and by sleeping, and each felt different (slow, fast, full).
- [ ] At zero charge the low-power walk was clearly a slower, sleepier bloombot, not a game over.
- [ ] The load wheel was quick to use, and each load (nothing, seeds, fertiliser) grew something I could tell apart.
      An empty load still fired.
- [ ] I gathered biomass by hand and chose what to do with each armful (eat it, compost it).
- [ ] A planter grew food over game days. A dry planter wilted and came back when watered.
- [ ] The compost bin turned biomass and scraps into compost, then fertiliser.
- [ ] I crafted components and a machine at the crafting table without needing help.
- [ ] I laid power poles, built a charger and saw the grid reach a new spot. Short on power, machines switched off one
      at a time and came back by themselves.
- [ ] A whole day and night passed in one session (48 minutes). At night solar stopped and I could tell.
- [ ] Sitting on a bench eased the camera out and felt calm. Standing up put the camera back.
- [ ] Notes:

## Milestone B: the island

The rest of the island, in region-unlock order (E23.8.2): Keepers, power and water across regions, the farm's wider
set, research, drones and automation, weather and salvage.

- [ ] Each Keeper handed over its region's unlock, and I wanted the next one.
- [ ] Each region felt different: its material, strength and special crop.
- [ ] Water: ponds and reservoirs went down with use and came back with rain. Near empty water the land faded to plain
      ground, and greened again when refilled.
- [ ] I fed a far planter by pump and pipe, and by gravity from higher ground.
- [ ] A desalination plant kept a farm going through a dry spell, at a cost I could feel on the grid.
- [ ] A fed Bio Digester carried the grid through a night.
- [ ] Every kind of weather happened, each helped one thing and challenged another, and the forecast was worth checking.
- [ ] A storm destroyed nothing. A pole tripped by lightning reset with one press.
- [ ] Salvage piles refilled over a few days and after storms, so finished regions were worth revisiting.
- [ ] Research unlocked something I wanted.
- [ ] Drones that ran short finished their job, docked and started again by themselves.
- [ ] I automated a job I'd done by hand a few times, with no conveyor belts.
- [ ] Wildlife came to sit with me, more and closer in more diverse places. At least one animal became a friend and
      travelled with me; swapping companions worked.
- [ ] The maker's journal and the Keepers told me why I was doing this.
- [ ] Notes:

## Milestone C: the mainland and the ending

The endless mainland sandbox (E23.8.3), the Great Bloom ending (E23.9.3) and the proof (E23.10).

- [ ] The Great Bloom felt like an ending: wildlife flooded back, and it was the maker's wish carried out.
- [ ] Afterwards the mainland opened as a sandbox, and I wanted to build there.
- [ ] I built a large system on the mainland (power, water and a farm together) and it ran without me.
- [ ] An Assembler line kept a build supplied with components.
- [ ] A fully automated farm ran a game day with no input.
- [ ] Performance held up with a big build.
- [ ] The whole game played from waking up to the Great Bloom with no idle mechanics, on a gamepad and on keyboard
      and mouse.
- [ ] Notes:

## Automated proof

Run before each milestone build: `npm test` (the gentle-failure suite, `tests/e23-gentle-failure.test.ts`, is in it)
and `npm run bot:oldcity` (the walking bot on seeds 7 and 21: never 3 minutes with nothing to do, never stranded).
