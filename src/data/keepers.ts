// E23.9.2 (#403, #454–#463): the Keepers as friends. All words and numbers, no rules (gameplay/KeeperSystem).
//
// The Keepers are the other robots, bloombot's friends and the only characters. Each one did a job for the old city
// that only took, and each remembers it. Restoring its region shows it the new way. Its arc runs in four beats:
//   taker    on waking: what it remembers doing for the old city
//   turning  its patch comes back (request 2 done): it notices something it never saw before
//   tender   its landmark wakes: it does its old job the new way, with the world and not against it
//   friend   after three gifts it likes: it says so, and gives bloombot its region's keepsake
// Its mechanical requests (what it asks for, its landmark's delivery) stay in data/oldcity KEEPERS.

import { gameDays, gameHours, gameMinutes } from './time';
import type { MaterialCost } from './salvage';

export type ArcBeat = 'taker' | 'turning' | 'tender' | 'friend';
export const ARC_BEATS: ArcBeat[] = ['taker', 'turning', 'tender', 'friend'];

export interface KeeperStory {
  /** one line, for the Friends list */
  personality: string;
  /** the four beats, one or two lines each */
  arc: Record<ArcBeat, string[]>;
  /**
   * Gifts it loves, best first: item ids. Crops from the farm (E23.5) count once they exist as backpack items; until
   * then only the ones the backpack knows are offered. Every Keeper also loves a tomato (FRIENDSHIP.everyoneLikes).
   */
  likes: string[];
  /** what it says when handed a gift */
  thanks: string;
  /** what it gives back on the first gift (its region's material) */
  giftBack: MaterialCost;
  /** what it says when talked to as a friend (one line, in turn) */
  chatter: string[];
}

/** Starting values for friendship. */
export const FRIENDSHIP = {
  /** gifts a Keeper likes before it calls bloombot a friend */
  giftsToFriend: 3,
  /** a Keeper takes one gift a game day (E23.7's clock) */
  giftEverySeconds: gameDays(1),
  /** every Keeper's favourite, whatever else it likes */
  everyoneLikes: 'tomato',
  /** E23.5 crops count as gifts: each harvest keeps one of its crop for a friend, up to this many of each */
  basketMax: 5,
};

/**
 * Keepers help out: a settled Keeper tends its region, bringing one restored tile near it one bloom step on (never
 * past full bloom) every so often; a friend does it twice as often. Starting values.
 */
export const KEEPER_HELP = {
  /** time between a settled Keeper's tending: one game hour (about 24 tiles a game day) */
  tendEverySeconds: gameHours(1),
  /** a friend tends this many times as often */
  friendMult: 2,
  /** how far from where it sleeps a Keeper wanders and tends, in tiles */
  radius: 8,
  /** a wandering Keeper heads home when bloombot comes this close to it, so it can be talked to */
  comeHomeTiles: 6,
  /** with bloombot this close (talking to it), a Keeper waits to set off to tend until bloombot steps away */
  talkTiles: 1.6,
  /** how fast a Keeper walks, in tiles a second (bloombot strolls at about 2) */
  walkSpeed: 0.7,
  /** time a Keeper spends tending a tile once it gets there (a little over a game minute) */
  tendSeconds: gameMinutes(1.25),
  /** how close to a cell's centre counts as there, in tiles */
  arriveTiles: 0.05,
  /** while tending, a Keeper leans over its tile this many degrees, bobbing this much */
  tendLean: 24,
  tendBob: 7,
};

export const KEEPER_STORIES: Record<string, KeeperStory> = {
  pylon: {
    personality: 'Eager and loyal, a little loud. Learning to listen instead of passing on orders.',
    arc: {
      taker: ['I passed on the mast\'s orders all day long. Pump more. Dig deeper. I never once asked why.'],
      turning: ['The tram stop is green! Nobody ordered that. It just grew.'],
      tender: ['The mast is humming again, but not with orders. Listen: wind, gulls, the weather coming in.'],
      friend: ['I used to tell things what to do. Now I listen, and pass on what I hear.', 'Thank you, friend. Here, this was the stop\'s old sign.'],
    },
    likes: ['sunflower', 'copper'],
    thanks: 'For me? Nobody ever gave me anything that wasn\'t an order!',
    giftBack: { gears: 5 },
    chatter: ['The swallows are back on the wires. I counted eleven!', 'Wind from the sea today. Rain by evening, I think.', 'I don\'t miss the orders. I thought I would.'],
  },
  tally: {
    personality: 'Fussy and exact, counts everything. Learning that some things are worth more given away.',
    arc: {
      taker: ['Water by the jar, soil by the sack. When it ran out, we bought it from further away.'],
      turning: ['You brought the square back and didn\'t charge me a thing. That doesn\'t add up. I like it.'],
      tender: ['I\'ve opened a new column in my ledger: what we give back. It\'s filling up nicely.'],
      friend: ['No charge, ever, for a friend. Write that down. Actually, I already have.', 'Take the market scales. They never weighed anything fairly. You will.'],
    },
    likes: ['radish', 'glass', 'pear'], // #785: its region's fruit
    thanks: 'A gift? I\'ll need a new column for this.',
    giftBack: { copper: 5 },
    chatter: ['A sparrow took a crumb off my counter today. I let it.', 'Three bees, two butterflies, one beetle. Business is good.', 'The ledger balances. First time in years.'],
  },
  tide: {
    personality: 'Slow and calm, says very little. Learning to let the water come and go.',
    arc: {
      taker: ['We held the sea out and pumped the sweet water inland. The beach grew wide, and quiet.'],
      turning: ['A crab walked over my foot this morning. I had forgotten they did that.'],
      tender: ['This time the lock lets the water come and go. In, and out. As it likes.'],
      friend: ['Sit with me a while. The sea does the talking.', 'Friends don\'t need much more than that. Take the bell.'],
    },
    likes: ['seaKale', 'timber', 'lemon'], // #785: its region's fruit
    thanks: 'Oh. Thank you. That is kind.',
    giftBack: { glass: 5 },
    chatter: ['Low tide. Good for crabs.', 'The gulls came back. Loud. I don\'t mind.', 'Rain upriver. It will reach us.'],
  },
  moss: {
    personality: 'Sleepy and gentle. Learning that waiting can be a kind of work.',
    arc: {
      taker: ['I trimmed the grove back every year to make room. The room filled with nothing.'],
      turning: ['The stumps are sprouting. I did nothing but wait. Was that all they wanted?'],
      tender: ['I will not cut anything any more. I will water, and talk to the tree, and wait.'],
      friend: ['You are like the tree. Patient. Come and sit in the shade whenever you like.', 'Take this lamp. It is shaped like an acorn. Mm.'],
    },
    likes: ['potato', 'seeds', 'apple'], // #785: Elder Grove's fruit trees bear apples
    thanks: 'Mm. For me? Thank you, little one.',
    giftBack: { timber: 5 },
    chatter: ['A hedgehog sleeps under the roots. Shh.', 'The tree said good morning. In its way.', 'Mm. Mushrooms after the rain.'],
  },
  sluice: {
    personality: 'Anxious and exact. Learning that water comes back if you let it.',
    arc: {
      taker: ['Every pipe I kept ran one way: out of the ground. I drained the basin dry. I was told to.'],
      turning: ['It rained on the spillway and the water ran back into the basin. Back! I didn\'t know it could.'],
      tender: ['Now it runs down, and comes back with the rain. Round and round. I only keep the way clear.'],
      friend: ['I worry less with you around. The water knows its way. So do you.', 'Take the old jug. It should be full, and now it can be.'],
    },
    likes: ['watercress', 'clay'],
    thanks: 'For me? Are you sure? Thank you. Thank you.',
    giftBack: { copper: 5 },
    chatter: ['The frogs are back. Very loud. Very good.', 'The level\'s fine. I checked. Twice.', 'Rain tomorrow, maybe. I hope so.'],
  },
  tock: {
    personality: 'Punctual and fussy, always in a hurry. Learning to keep time with the seasons.',
    arc: {
      taker: ['I kept the whole city running to the minute, faster every year. Nobody stopped to look up.'],
      turning: ['A flower opened in the plaza today and took all morning about it. I watched the whole thing.'],
      tender: ['The clock runs again, but I\'ve set it by the sun and the seasons. No more hurrying.'],
      friend: ['Time with a friend never runs short. I\'ve checked. Take as long as you like.', 'Here, the cuckoo clock. It\'s always a little late. I like that now.'],
    },
    likes: ['lettuce', 'gears'],
    thanks: 'Right on time. Thank you!',
    giftBack: { glass: 5 },
    chatter: ['The bees are early today. Good for them.', 'Sunset at about… whenever it likes.', 'I wound the clock and forgot to look at it. Lovely.'],
  },
  gable: {
    personality: 'Cheerful and busy, always building. Learning to leave some roofs to the birds.',
    arc: {
      taker: ['We built over every roof and forced the gardens with heaters, winter and summer. The roofs never rested.'],
      turning: ['Swallows are nesting under the eaves. They didn\'t ask. They just came.'],
      tender: ['Half the roofs for beans, half left wild for the birds. The sun does the heating.'],
      friend: ['Best view in the city, and the best company. Come up any time, friend.', 'Take the weathercock. It always knows where the wind is going.'],
    },
    likes: ['beans', 'sunstone', 'peach'], // #785: its region's fruit
    thanks: 'Ha! Lovely. Thank you!',
    giftBack: { seeds: 5 },
    chatter: ['Twelve swallow nests and counting!', 'The north roofs went wild. I love them.', 'You can see the sea from every roof. Did you know?'],
  },
  fern: {
    personality: 'Shy and careful. Learning to open the glass and let the world in.',
    arc: {
      taker: ['I kept every plant under glass, safe from the weather and the bugs. Safe from everything.'],
      turning: ['A bee got in through a broken pane, and the tomatoes set fruit. I didn\'t know they needed it.'],
      tender: ['I open the panes every morning now. The bees come in, and the plants go out.'],
      friend: ['You\'re the first friend I\'ve had who isn\'t a plant. I\'m glad it\'s you.', 'This terrarium is for you. Leave the lid off.'],
    },
    likes: ['flowers', 'herbs', 'glass'],
    thanks: 'Oh! For me? Thank you. Sorry. Thank you.',
    giftBack: { seeds: 5 },
    chatter: ['The lavender\'s out. The bees are very happy about it.', 'I left a window open for the moths.', 'The seedlings are hardier now. So am I.'],
  },
  vega: {
    personality: 'Dreamy and far away. Learning to look at what is right here.',
    arc: {
      taker: ['I spent years searching the sky for somewhere better. I never looked at what was under my feet.'],
      turning: ['There are glow-worms in the grass up here. I never noticed. I was always looking up.'],
      tender: ['The telescope points down the hill now as often as up. There is plenty to see.'],
      friend: ['Of everything I charted, the best thing I found was here. You, and this hill.', 'Take the orrery. It shows where we are. Here is enough.'],
    },
    likes: ['moonflower', 'glass'],
    thanks: 'For me? How lovely. Thank you.',
    giftBack: { copper: 5 },
    chatter: ['A comet tonight, maybe. Or a moth. Both are nice.', 'The owls are back on the hill.', 'I used to look for lights out there. Now I count the stars, and the fireflies.'],
  },
  atlas: {
    personality: 'Big, proud and tired. Learning to set things down and rest.',
    arc: {
      taker: ['We built higher every year because the ground was used up. I carried all of it, floor by floor.'],
      turning: ['The square is green, and I didn\'t have to lift a thing. The ground did it by itself.'],
      tender: ['The lifts run on sunlight now, and the top floors belong to the swallows. I carry less. I like it.'],
      friend: ['I held up a city for years. It turns out a bench is better. Sit with me, friend.', 'Take the old lift dial. I won\'t be needing it.'],
    },
    likes: ['pumpkin', 'gears'],
    thanks: 'For me? That is very kind. Thank you.',
    giftBack: { sunstone: 5 },
    chatter: ['Swallows on the forty-first floor. No rent.', 'I took the stairs today. Slowly. Nice view.', 'The causeway is down there, under the bay. Waiting.'],
  },
};
