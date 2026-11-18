// E23.9.3 (#404): the Great Bloom ending. Words and numbers only (gameplay/EndingSystem, app/Ending).
//
// The last fountain delivery (tier 5) carries the Heart Seed and the Star Lens. The island blooms, wildlife floods
// back, the maker's last page finds bloombot, and the Long Causeway rises out of the sea toward the still-fogged
// mainland. No lights or people answer from it: the mainland is for the world and its wildlife (E23.8.3).

/**
 * The Long Causeway: from the east shore of the island, past Clock Plaza, along z = 0, to the mainland's edge
 * (chunk x = 9, tile 144; E21 §7). Cells, inclusive. Before the Great Bloom it lies broken under the sea; after it,
 * it stands at the island's base level and can be walked.
 */
export const CAUSEWAY = {
  x0: 109,
  x1: 143,
  z0: -1,
  z1: 1,
  /** its deck stands level with the island's streets */
  level: 1,
  /** spans drawn along it (each one the causeway-span model, stretched to fit) */
  spans: 5,
  /** the span that lies broken until the Great Bloom (0 = the island end) */
  brokenSpan: 2,
  /** where the mainland begins: the first cell past its end */
  mainlandX: 144,
};

export const ENDING = {
  /** the letterbox title while the island blooms */
  title: 'The Great Bloom',
  /** seconds of bloom across the landmarks (one after another, from the fountain outward) */
  bloomSeconds: 6,
  /** seconds the camera rests on the causeway as it rises */
  causewaySeconds: 5,
  /** after the Great Bloom, more animals are about: their caps are multiplied by this */
  wildlifeCapMult: 2,
};
