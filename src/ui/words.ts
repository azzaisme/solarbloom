/**
 * E22.10 (#348): plain words and few numbers. Every player-facing string written for the game lives here,
 * with the list of words the screen does not use under them (docs/E22_CONTROLS_UI.md, "Plain words, few
 * numbers"). tests/bloombot-words.test.ts scans these strings, and the HUD's text, for them.
 *
 * Writing rules: a verb and a thing a new player already knows; no abbreviations; a region or Keeper by name;
 * one sentence per card or toast. A count only for things gathered or restored by hand, as "12 of 20".
 */

/** Words (and patterns) never on screen, each with what to say instead where there is one. */
export const BANNED: readonly { word: string; re: RegExp; instead?: string }[] = [
  { word: 'rate', re: /\brates?\b/i },
  { word: '/min', re: /\/\s*min\b/i },
  { word: '/s', re: /\/\s*s\b/i },
  { word: 'per second', re: /\bper second\b/i },
  { word: 'cap', re: /\bcaps?\b/i },
  { word: 'overflow', re: /\boverflow(s|ed|ing)?\b/i },
  { word: 'reward at', re: /\breward at\b/i },
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
  { word: 'full bloom', re: /\bfull[- ]bloom\b/i, instead: 'in flower' },
  { word: 'biomass', re: /\bbiomass\b/i, instead: 'Greens' },
  { word: 'node', re: /\bnodes?\b/i },
  { word: 'seam', re: /\bseams?\b/i },
  { word: 'old-city', re: /\bold[- ]city\b/i },
  { word: 'classic', re: /\bclassic\b/i },
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

/** Old-city strings: the objective card, the gauges, the prompt's refusals, the menu and the loading tips. */
export const WORDS = {
  objective: {
    restore: 'Bring the park back to life around the fountain',
    flower: 'Get the park in flower round the fountain',
    build: (thing: string) => `Build a ${thing} in the park`,
    plant: (thing: string) => `Plant a ${thing} in the park`,
    wakeFountain: 'Wake the fountain',
    wake: (landmark: string, region: string) => `Wake the ${landmark} in the ${region}`,
    clear: (region: string) => `Bring the ${region} back to life`,
    explore: 'Walk out into the city and see what wakes next',
    /** #605: the fountain's next step as the goal: step 1 wakes it, later steps go by the fountain panel's name */
    fountain: (step: number, name: string) => (step === 1 ? 'Wake the fountain' : `Fountain step ${step}: ${name}`),
    /** #605: the goal when everything it wants is there */
    fountainReady: (step: number) => (step === 1 ? 'The fountain has all it needs. Go and wake it.' : 'The fountain has all it needs. Walk up to it for its next step.'),
    /** #605: what the step brings, in a few plain words */
    why: {
      pry: 'Bloombot learns to pry open rubble',
      hover: 'Bloombot learns to hover over deep water',
      climb: 'Bloombot learns to climb onto the roofs',
      glide: 'Bloombot learns to glide from the roof edges',
      bloom: 'The whole city comes back into flower',
    },
    /** #605: after the fountain wakes, until the first pry: the goal is the rubble nearest bloombot */
    pry: (_region: string) => 'Pry open the rubble at the edge of the park',
    pryWhy: 'A robot sleeps on the other side, and it can help you',
    pryNext: 'Walk up to the rubble and pry it open. Show me where leads you there.',
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
  toasts: {
    controlsReset: 'The controls changed in this update, so your own keys are back to the defaults.',
    saved: 'Saved',
    padLost: 'The controller was disconnected',
    noRequests: 'No requests to pin yet',
  },
};

/** E22.12: one plain line under the loading bar, from these twenty. */
export const TIPS: readonly string[] = [
  'Interact does the obvious thing to whatever is in front of bloombot.',
  'The prompt at the bottom says what Interact will do.',
  'Pulse a grey tile to bring it back to life.',
  'Pulse a green tile again to help it flower.',
  'Your backpack holds what you carry, your requests and your journal.',
  'The map shows every place you have woken.',
  'Energy and water fill up again on their own.',
  'Harvest Sunlight when energy runs low.',
  'Pin a request to keep it at the top of the screen.',
  'Open the build menu to make machines, storage and decorations.',
  'Turn a piece in build mode before you place it.',
  'Walk up to a landmark that hums and wake it.',
  'Helpers keep working the ground you have restored.',
  'Hold Interact beside a pile of old things to salvage it.',
  'The game pauses while the menu or the backpack is open.',
  'Every key and button can be changed in Settings.',
  'Settings can make the text bigger and the colours stronger.',
  'Photo mode is in the menu.',
  'Each region wakes when its landmark wakes.',
  'There is no rush: the city waits for you.',
];
