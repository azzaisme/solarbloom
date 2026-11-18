// E23.9.1 (#402): the maker's journal. The story thread, in his own hand.
//
// He is never seen. He built bloombot last, to give back what the old city took and to bring the island back for
// its wildlife. The pages are told in stages, and each stage is only reachable once bloombot gets that far:
//   arrival      the park: his first note ("Start with the park")
//   ring 1       how the old city ran, and what it took from the land
//   ring 2       how the fog came, and how everyone faded away
//   ring 3       his plan for the Great Bloom, and what he never finished
//   bloom        his last message, found when the Great Bloom happens (not on a post)
// Hopeful, never a lecture: the pages remember, the world shows.

export type JournalStage = 'arrival' | 'ring1' | 'ring2' | 'ring3' | 'bloom';

export const JOURNAL_STAGES: JournalStage[] = ['arrival', 'ring1', 'ring2', 'ring3', 'bloom'];

export interface JournalPage {
  id: string;
  stage: JournalStage;
  title: string;
  text: string;
}

/** The page bloombot is given when the Great Bloom happens (E23.9.3). */
export const LAST_PAGE = 'p-bloom';

/** Every page, in book order. The posts that hold them are placed in data/oldcity (the park and each region). */
export const JOURNAL: JournalPage[] = [
  // ── Arrival: the park ──
  {
    id: 'p-park-1',
    stage: 'arrival',
    title: 'Start with the park',
    text: 'Good morning, little one. If you are reading this, you woke up, and the boat found the jetty. Start with the park. The ground there still remembers how to grow. Wake one patch and the next will follow.',
  },
  {
    id: 'p-park-2',
    stage: 'arrival',
    title: 'A drawing of you',
    text: 'A pencil drawing of a small round robot holding a watering can, with a sparrow sitting on its head. Underneath, in his hand: "Bloombot. The last one. This one listens."',
  },

  // ── Ring 1: how the old city ran, and what it took ──
  {
    id: 'p-mastRow-1',
    stage: 'ring1',
    title: 'The mast',
    text: 'The mast told every machine in the city what to do, day and night. Pump more. Dig deeper. Burn what is left over. In all those years, nobody ever thought to tell it to stop.',
  },
  {
    id: 'p-mastRow-2',
    stage: 'ring1',
    title: 'About Pylon',
    text: 'Pylon passed the mast\'s orders down the line and never once asked where they came from. It is a good robot. It only ever did what it was told. Be patient with it.',
  },
  {
    id: 'p-oldMarket-1',
    stage: 'ring1',
    title: 'The price board',
    text: 'Water by the jar, soil by the sack, shade by the hour. Everything here had a price. When something ran out, we bought it from further away, until there was no further away left.',
  },
  {
    id: 'p-oldMarket-2',
    stage: 'ring1',
    title: 'Tally\'s ledger',
    text: 'Tally counted everything the market ever sold. There was never a column for what we gave back. I have drawn one in. It is empty, for now.',
  },
  {
    id: 'p-saltwind-1',
    stage: 'ring1',
    title: 'The tide table',
    text: 'The Sea Lock kept the canals full. We pumped the fresh water inland faster than the rain could bring it back, and every year the beach grew a little wider and a little quieter.',
  },
  {
    id: 'p-saltwind-2',
    stage: 'ring1',
    title: 'Under the jetty',
    text: 'I found a crab under the jetty today, the first in years. I left it alone. I think that was most of what it wanted.',
  },
  {
    id: 'p-elderGrove-1',
    stage: 'ring1',
    title: 'The Elder Tree',
    text: 'The grove was cut back a little every year to make room. The Elder Tree is all that is left of it, and it is still alive. Trees are patient. I am trying to learn that from it.',
  },
  {
    id: 'p-elderGrove-2',
    stage: 'ring1',
    title: 'Moss\'s list',
    text: 'Moss wrote this in big square letters and pinned it to the tree: "Water the stumps. Talk to the tree. Wait." I could not have put it better.',
  },

  // ── Ring 2: how the fog came, and how everyone faded away ──
  {
    id: 'p-cistern-1',
    stage: 'ring2',
    title: 'The dry basin',
    text: 'The cistern was the last water the city had. The week it ran dry, the fog rose out of the empty basin, thick and quiet, and it did not lift. I do not think it was angry. I think the land was tired.',
  },
  {
    id: 'p-cistern-2',
    stage: 'ring2',
    title: 'Sluice\'s map',
    text: 'Sluice drew me every pipe under the city. They all run the same way: out of the ground and into the machines. Not one of them leads back.',
  },
  {
    id: 'p-clockPlaza-1',
    stage: 'ring2',
    title: 'Twenty past four',
    text: 'The clock stopped at twenty past four, the day the fog reached the plaza. After that, people left a few at a time, for somewhere that still had water. Fewer came back each year, and then no one did.',
  },
  {
    id: 'p-clockPlaza-2',
    stage: 'ring2',
    title: 'Tock keeps time',
    text: 'Tock still winds the clock every Sunday, though it has not run in years. I asked it why. It said someone ought to keep the time until the time is worth keeping again.',
  },
  {
    id: 'p-terraces-1',
    stage: 'ring2',
    title: 'The roof gardens',
    text: 'Beans on the south roofs, herbs on the north. The roof gardens were the last green things in the city. When everyone had gone, Gable and I watered them for as long as the tanks held out.',
  },
  {
    id: 'p-terraces-2',
    stage: 'ring2',
    title: 'From the roofs',
    text: 'From up here I can see how far the fog goes. It is not an ending. It is the world closing its eyes for a while. I think it will open them again, if we are gentle with it.',
  },

  // ── Ring 3: his plan for the Great Bloom, and what he never finished ──
  {
    id: 'p-glasshouse-1',
    stage: 'ring3',
    title: 'The Heart Seed',
    text: 'Fern and I saved one seed of every plant the island ever grew and kept them warm under the glass. The Heart Seed. When the fountain is ready, it goes into the water, and the whole island remembers how to bloom.',
  },
  {
    id: 'p-glasshouse-2',
    stage: 'ring3',
    title: 'The bridge, half done',
    text: 'A drawing of the glasshouse bridge with its middle missing. The timber is stacked by the bank. In the margin: "For the hedgehogs. Finish before winter." Underneath, later, in a shakier hand: "Next winter, then."',
  },
  {
    id: 'p-observatory-1',
    stage: 'ring3',
    title: 'The Star Lens',
    text: 'Vega helped me grind the Star Lens. It gathers the morning sun into one bright point. With the Heart Seed and the Lens together, the fountain could wake the whole island at once. I have worked out everything except the time to do it.',
  },
  {
    id: 'p-observatory-2',
    stage: 'ring3',
    title: 'No lights tonight',
    text: 'No lights on the mainland again tonight. The fog lies over it like snow. One island first, and then the next. That is how it will have to go.',
  },
  {
    id: 'p-spireHeights-1',
    stage: 'ring3',
    title: 'Things I did not finish',
    text: 'The glasshouse bridge. The lifts on the Spire. The nesting boxes for the swallows. The old causeway. Saying a proper goodbye to the Keepers. I am leaving them to you, little one. Take your time. There is no hurry any more.',
  },
  {
    id: 'p-spireHeights-2',
    stage: 'ring3',
    title: 'The causeway',
    text: 'From the top of the Spire you can just see the old causeway, sunk under the bay. When the island blooms, it will rise. Where it leads after that, I never got to see. You will.',
  },

  // ── The Great Bloom: his last message ──
  {
    id: LAST_PAGE,
    stage: 'bloom',
    title: 'His last page',
    text: 'If this page has found you, the island is blooming. The bees are back, and the frogs in the fountain, and the swallows on the Spire. I built you to give back what we took, gently, with the world and never against it. You did. It was never for us. It was for them. There is more fog out there, and more ground that remembers how to grow. Go and see it, little one. Take your friends.',
  },
];

/** The pages by id (title and text), in book order. */
export const PAGES: Record<string, { title: string; text: string }> = Object.fromEntries(JOURNAL.map((p) => [p.id, { title: p.title, text: p.text }]));

/** A page's stage. */
export function pageStage(id: string): JournalStage | undefined {
  return JOURNAL.find((p) => p.id === id)?.stage;
}
