/**
 * E22.10 (#348): plain words and few numbers. Every player-facing string written for the game lives here,
 * with the list of words the screen does not use under them (docs/E22_CONTROLS_UI.md, "Plain words, few
 * numbers"). tests/bloombot-words.test.ts scans these strings, and the HUD's text, for them.
 *
 * Writing rules: a verb and a thing a new player already knows; no abbreviations; a region or Keeper by name;
 * one sentence per card or toast. A count only for things gathered or restored by hand, as "12 of 20".
 */

/**
 * A banned phrase's name, its words joined here: the text pass reads this file's own literals, and a phrase written
 * whole would flag the very list that bans it.
 */
const phrase = (...words: string[]) => words.join(' ');

/** Words (and patterns) never on screen, each with what to say instead where there is one. */
export const BANNED: readonly { word: string; re: RegExp; instead?: string }[] = [
  { word: 'rate', re: /\brates?\b/i },
  { word: '/min', re: /\/\s*min\b/i },
  { word: '/s', re: /\/\s*s\b/i },
  { word: phrase('per', 'second'), re: /\bper second\b/i },
  { word: 'cap', re: /\bcaps?\b/i },
  { word: 'overflow', re: /\boverflow(s|ed|ing)?\b/i },
  { word: phrase('reward', 'at'), re: /\breward at\b/i },
  { word: 'frontier', re: /\bfrontiers?\b/i },
  { word: 'sealed', re: /\bsealed\b/i },
  { word: 'specialty', re: /\bspecialt(y|ies)\b/i },
  { word: 'permit', re: /\bpermits?\b/i },
  { word: 'tier', re: /\btiers?\b/i },
  { word: 'combo', re: /\bcombos?\b/i },
  { word: 'multiplier', re: /\bmultipliers?\b/i },
  { word: '×N', re: /[×x]\s?\d+(\.\d+)?\b|\b\d+(\.\d+)?\s?×/ },
  { word: 'buff', re: /\bbuffs?\b/i },
  { word: 'Frenzy', re: /\bfrenzy\b/i },
  { word: phrase('full', 'bloom'), re: /\bfull[- ]bloom\b/i, instead: 'in flower' },
  { word: 'biomass', re: /\bbiomass\b/i, instead: 'Greens' },
  { word: 'node', re: /\bnodes?\b/i },
  { word: 'seam', re: /\bseams?\b/i },
  { word: 'old-city', re: /\bold[- ]city\b/i },
  { word: 'classic', re: /\bclassic\b/i },
  // Text pass (the golden rule, docs/design/PLAIN_WORDS.md): system words a player was never shown
  { word: 'tile', re: /\btiles?\b/i, instead: 'ground' },
  { word: 'chain', re: /\bchains?\b/i, instead: 'the flowers spread' },
  { word: 'grid', re: /\bgrid\b/i, instead: 'power lines' },
  { word: 'network', re: /\bnetworks?\b/i, instead: 'power lines' },
  { word: 'stack', re: /\bstacks?\b/i, instead: "can't carry any more" },
  { word: 'cache', re: /\bcaches?\b/i, instead: 'a buried box' },
  { word: 'radius', re: /\bradius\b/i, instead: 'nearby' },
  { word: 'zone', re: /\bzones?\b/i, instead: 'around it' },
  { word: 'superstructure', re: /\bsuperstructures?\b/i, instead: 'a big machine' },
  { word: 'merge', re: /\bmerg(e|es|ed|ing)\b/i, instead: 'join' },
  { word: 'hotbar', re: /\bhotbar\b/i, instead: 'the build bar' },
  { word: 'debug', re: /\bdebug\b/i },
  { word: 'overlay', re: /\boverlays?\b/i, instead: 'view' },
  { word: 'restoration', re: /\brestorations?\b/i, instead: 'turning green' },
  { word: 'role', re: /\broles?\b/i, instead: 'job' },
  { word: phrase('in', 'range'), re: /\b(in|out of) range\b/i, instead: 'nearby' },
  { word: 'recharge', re: /\brecharg(e|es|ed|ing)\b/i, instead: 'rests for a moment' },
  { word: 'click', re: /\b(click|clicks|clicked|clicking|tap|taps|tapped|tapping)\b/i, instead: 'press' },
  { word: 'N s', re: /\b\d+(\.\d+)?\s?s\b/, instead: 'a few seconds' },
  { word: 'Interact', re: /\bInteract\b/, instead: '{interact}' },
  { word: phrase('as', 'usual'), re: /\bas usual\b/i },
];

/** The banned words in a piece of text (empty when it reads plainly). Markup is ignored. */
export function bannedIn(text: string): string[] {
  const plain = text.replace(/<[^>]*>/g, ' ');
  return BANNED.filter((b) => b.re.test(plain)).map((b) => b.word);
}

/** A rate written as "/" ("+71/min", "3/s"). */
export const RATE_SLASH = /[+−-]?\d[\d.,]*\s*[kKmMbB]?\s*(?:[a-zA-Z]+\s*)?\/\s*(min|s|sec|second|minute|h|hour)\b/;

/**
 * Rewrites game text where a plain word exists (biomass → Greens, full bloom → in flower) and
 * drops rates and multipliers ("+71/min", "×3"). Text that would still need a banned word is left for E21 to
 * hide (Frenzy, tiers, merges belong to classic play).
 */
export function plainWords(text: string): string {
  return text
    .replace(/\bbiomass\b/g, 'Greens')
    .replace(/\bBiomass\b/g, 'Greens')
    .replace(/\bfull[- ]bloom\b/gi, 'in flower')
    .replace(new RegExp(`\\s*(·\\s*)?${RATE_SLASH.source}`, 'g'), '')
    .replace(/\s*[×x]\d+(\.\d+)?\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The resources' names on screen (biomass is "Greens"). */
export const RESOURCE_NAME = { energy: 'Energy', water: 'Water', biomass: 'Greens' } as const;

/**
 * A line that names a control as `{interact}` (an Action in braces), filled with the player's own key or button.
 * The goal card and the hint line use it, so a card line can say what to press without knowing the device.
 */
export const withKeys = (text: string, keyFor: (a: never) => string) => text.replace(/\{(\w+)\}/g, (_, a: string) => keyFor(a as never));

/**
 * Text pass (the golden rule: say which key, and what the player will see): any string from anywhere (a Keeper's
 * line, a refusal, a machine card) may say "Press {pulse}" or "hold {interact}"; the HUD fills in the player's own
 * key or pad button as it draws. Only real action names are replaced, so other braces pass through untouched.
 */
export function fillKeys(text: string, keyFor: (a: string) => string, isAction: (a: string) => boolean): string {
  return text.indexOf('{') < 0 ? text : text.replace(/\{(\w+)\}/g, (m, a: string) => (isAction(a) ? keyFor(a) : m));
}

/** Old-city strings: the objective card, the gauges, the prompt's refusals, the menu and the loading tips. */
export const WORDS = {
  /** #620: Bloombot grows (a short moment when it happens) */
  bloombot: {
    learned: { pry: 'Bloombot can pry rubble out of the way now', hover: 'Bloombot can hover over deep water now', climb: 'Bloombot can climb onto the roofs now', glide: 'Bloombot can glide down from the roofs now' } as Record<string, string>,
    upgraded: (name: string, level: number, max: number) => `Bloombot got better: ${name}, level ${level} of ${max}`,
    /** E25 (#626): a move's second level, from the workshop */
    levelTwo: { pry: 'Bloombot can pry open heavy vault doors now', hover: 'Bloombot can hover far out over the sea now', climb: 'Bloombot can climb low walls with no ladder now', glide: 'Bloombot can glide much further now' } as Record<string, string>,
    /** #622: the park reached a milestone */
    park: (name: string, does: string) => `The park helped Bloombot grow: ${name}<small>${does}</small>`,
    /** #625: a Keeper woke and taught Bloombot its knack */
    knack: (keeper: string, name: string, does: string) => `${keeper} taught Bloombot a knack: ${name}<small>${does}</small>`,
    /** #624 Lucky pulse: what a pulse turned up (already in the backpack) */
    lucky: (n: number, what: string) => `Lucky! The pulse dug up ${n} ${what}`,
  },
  objective: {
    restore: 'Bring the park back to life around the fountain',
    flower: 'Get the park in flower round the fountain',
    build: (thing: string) => `Build a ${thing} in the park`,
    plant: (thing: string) => `Plant a ${thing} in the park`,
    wakeFountain: 'Wake the fountain',
    wake: (landmark: string, region: string) => `Wake the ${landmark} in the ${region}`,
    clear: (region: string) => `Bring the ${region} back to life`,
    explore: 'Walk out into the city and see what wakes next',
    /**
     * #605: the fountain's next step as the goal: step 1 wakes it; later steps go by their own name, the one the
     * fountain's panel shows ("Light on the roofs"), always one line. `nextLead` says what that name is.
     */
    fountain: (step: number, name: string) => (step === 1 ? 'Wake the fountain' : name),
    /** #620: before the move line on a later step, so its name reads as the fountain's */
    nextLead: "The fountain's next step.",
    /** #605: the goal when everything it wants is there */
    fountainReady: (step: number) => (step === 1 ? 'The fountain has all it needs. Walk up to it and press {interact} to wake it.' : 'The fountain has all it needs. Walk up to it and press {interact}.'),
    /** #605: what the step brings, in a few plain words */
    /** #620: each step names the move it teaches (the verb the Bloombot page names it by) and what it's for */
    why: {
      pry: 'Bloombot learns to pry open rubble',
      hover: 'Bloombot learns to hover over deep water',
      climb: 'Bloombot learns to climb onto the roofs',
      glide: 'Bloombot learns to glide off the roofs',
      bloom: 'The whole city comes back into flower',
    },
    /** #605: after the fountain wakes, until the first pry: the goal is the rubble nearest bloombot */
    /** the region's name isn't known yet: the rubble is what the player can see */
    pry: 'Pry open the rubble',
    pryWhy: 'Another robot like Bloombot is asleep on the other side',
    pryNext: 'Hold {interact} beside the rubble to pry it open.',
    /** #605 / #608: the park's part of a fountain step */
    park: 'Park',
    landmarks: 'Landmarks awake',
    /** #605: the card's button that points the way */
    showWhere: 'Show me where',
    /** #613: resting at home (the fountain or the house), shown while it charges */
    charging: 'Charging up',
    /** #605: Show me where with nowhere to point */
    nowhere: 'Nothing to point at just now',
    /** a count, only for things gathered or restored by hand */
    count: (n: number, of: number) => `${n} of ${of}`,
  },
  /** #632: Show me where's trail, when it can't go all the way: what stops it, and what to do about it */
  trail: {
    stops: 'The path stops here',
    hidden: "Bloombot can't get any further this way yet. The card at the top says what to do next.",
    water: "The water's too deep to wade here. Bloombot learns to hover over water at the fountain later on.",
    level: "That's up on a roof, and Bloombot can't get up there from here yet. The card at the top says what to do next.",
    blocked: 'Something is in the way. Walk a little closer and press Show me where again.',
    /** a shut way in that bloombot can open already */
    openNow: 'Walk up to it. Bloombot can open it now.',
  },
  gauges: {
    energy: 'Energy',
    water: 'Water',
    low: (what: string) => `${what} is running low`,
  },
  refused: {
    backpackFull: 'Backpack full',
    tooFar: 'Too far: walk closer',
    needs: (what: string) => `Needs ${what}`,
  },
  /** #782: decorating, from the fountain's first step */
  decor: {
    /** the first decoration, a gift: what it is, then how to put it down (the key named) */
    gift: (icon: string, name: string) =>
      `${icon} A gift for the house: ${name}<small>Press {buildMenu} and find it under Decorations, then set it down on green ground by the house. Put down as many as you like: they’re free.</small>`,
  },
  /** #782: the house grows */
  house: {
    /** the fountain's first step: the house can be mended now */
    canMend: '🏡 The old shed can be mended now<small>Walk up to its front wall, beside the door, and press {interact} to see what it needs.</small>',
    /** Go home (the Home's gift): Bloombot is on its doorstep */
    home: '🏡 Home again<small>Bloombot is on its own doorstep.</small>',
    /** a level reached: its name, what it brings, and that there is an inside to go into */
    grew: (name: string, gives: string, decor: number, first = false, goHome = false) =>
      `🏡 Bloombot’s house is a ${String(name).toLowerCase()} now<small>${first ? 'Walk up to the door and press {interact} to go inside. ' : ''}${gives}, and room inside for ${decor} decorations.${goHome ? ' To go home from anywhere, press {menu} and choose Go home.' : ''}</small>`,
    /** what a level brings, as one line ("A bed, a storage chest, a radio by the window") */
    gives: (gives: readonly string[] | string) => [gives].flat().map((g, i) => (i ? g[0].toLowerCase() + g.slice(1) : g)).join(', '),
  },
  toasts: {
    controlsReset: 'The controls changed in this update, so your own keys are back to the defaults.',
    saved: 'Saved',
    padLost: 'The controller was disconnected',
    noRequests: 'No requests to pin yet',
  },
};

/** E22.12: one plain line under the loading bar, from these twenty. `{pulse}` and the like become the player's own keys (Loading.ts). */
export const TIPS: readonly string[] = [
  'Walk up to something and press {interact} to use it, open it or say hello.',
  'The words at the bottom of the screen show what {interact} will do right now.',
  'Press {pulse} on grey ground to bring it back to life.',
  'Press {pulse} on green ground again and it bursts into flower.',
  'Press {backpack} to open your backpack: what you carry, your requests and your journal.',
  'Press {map} to see every place you have woken.',
  'Energy and water fill up again on their own.',
  'When your Charge runs low, press {eat} for a snack.',
  'Choose a request in your backpack and it stays at the top of the screen.',
  'Press {buildMenu} to open the build menu: machines, storage and decorations.',
  'While you build, press {rotate} to turn a piece before you put it down.',
  'Walk up to a landmark that hums and wake it.',
  'Little drones keep tending the ground you have turned green.',
  'Hold {interact} beside a pile of old things to dig through it.',
  'The game pauses while the menu or the backpack is open.',
  'Every key and button can be changed in Settings.',
  'Settings can make the text bigger and the colours stronger.',
  'Photo mode is in the menu.',
  'Wake the landmark in each part of the city, and everything around it wakes too.',
  'There is no rush: the city waits for you.',
];
