// E23.9.3 (#404): the Great Bloom ending. Words and numbers only (gameplay/EndingSystem, app/Ending).
//
// The last fountain delivery (tier 5) carries the Heart Seed and the Star Lens. The island blooms, wildlife floods
// back, the Long Causeway rises (E23.8.3's MainlandSystem; its cells are MAINLAND.causeway in data/mainland) toward the
// still-fogged mainland, and the maker's last page finds bloombot. No lights or people answer from the mainland: it is
// for the world and its wildlife.

export const ENDING = {
  /** the letterbox title while the island blooms */
  title: 'The Great Bloom',
  /** seconds of bloom across the landmarks (one after another, from the fountain outward) */
  bloomSeconds: 6,
  /** seconds the camera rests on the causeway as it rises */
  causewaySeconds: 5,
  /** after the Great Bloom, more animals are about: their caps are multiplied by this */
  wildlifeCapMult: 2,
  /**
   * The fog lifts along the causeway's own rows, from this cell east to where the causeway starts: Clock Plaza's
   * east edge (its chunks end at x = 79) through the backstreets to the shore, so the way to the mainland is open.
   */
  clearFromX: 64,
  /** the first bloom: the fountain, at the middle of the park */
  fountain: { x: 8, z: 8 },
  /** where the camera looks while the island blooms: the island's middle, just north of the park, from the farthest zoom */
  overview: { x: 8, z: -8 },
};
