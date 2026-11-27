// E23.2.3 (#373): benches and meditating at chargers. All data, no rules: starting values for tuning.
// The charge each gives back per second lives with the charge (data/charge.ts: benchPerSecond, meditatePerSecond).
import type { MaterialCost } from './salvage';

export const REST = {
  /** mending an old park bench (it is broken until then) */
  mendCost: { scrap: 3 } as MaterialCost,
  /** "let time run faster" while sitting: the world runs this many times as fast (a game day is 48 minutes) */
  fastTime: 4,
  /** the calm view: the camera eases out to this zoom (1 = the usual follow) */
  calmZoom: 0.55,
  /**
   * E23.2.4: while sitting the player may zoom in this close (beyond the usual close step, 4.3), to look at the
   * animals that come to visit; standing puts the usual limit back
   */
  visitZoom: 7,
  /** the calm view turns this many degrees a second round bloombot */
  orbitDegPerSecond: 2.5,
  /**
   * Where bloombot and a friend sit on a bench (world units from its middle): bloombot `out` forward of the bench's
   * middle and `raise` above the plain seated height (0: it then settles onto the seat from its real surface, `settle`), the friend `friendOut`; bloombot `along` to one end when a
   * friend joins, the friend `friend` to the other end. An animal coming to sit beside it (E23.2.4, when no friend
   * has the place) takes the other end too: `visitorAlong` along, `visitorOut` forward, facing out (a long one further
   * forward still, so its back end stays off the backrest's face, `backFace` behind the middle); one longer than
   * `depth` would hang off the seat, so it settles on the ground beside the bench. Bloombot's round body (about 0.48 across, its backpack
   * behind) is deeper than the seat (0.29: from the backrest's face, 0.13 behind the middle, to the front edge,
   * 0.16 ahead of it), so its front overhangs the edge; it sits right back against the backrest with its legs out
   * over the edge (REST.legSwing; `settle` brings it forward just clear of the backrest; seen from all four sides in
   * tests/e2e/rest-e23.mjs shots 11, 11d, 11e).
   */
  seat: { out: 0.19, raise: 0, friendOut: 0.04, along: 0.14, friend: 0.24, visitorOut: 0.1, visitorAlong: 0.25, backFace: 0.125, depth: 0.3 },
  /**
   * The bench's footprint about its tile's middle (bench.glb at 0.58: its iron ends `along` each way, the backrest
   * `back` behind, the seat's front edge `front` ahead), which animals on the ground keep off.
   */
  benchFoot: { along: 0.43, back: 0.2, front: 0.16 },
  /**
   * The bench's solid parts about its tile's middle on the ground, facing +z (bench.glb at 0.58, read from the model
   * as tests/e2e/wildlife-e23.mjs reads it): x across, y up, z ahead, each [min, max]. Animals on bloombot keep out of
   * them as well as out of bloombot (one on its arm right by the iron end).
   */
  benchSolids: [
    { x: [-0.389, 0.389], y: [0.22, 0.273], z: [-0.116, 0.146] }, // the seat
    { x: [-0.389, 0.389], y: [0.348, 0.504], z: [-0.191, -0.121] }, // the backrest
    { x: [0.4, 0.424], y: [0.078, 0.578], z: [-0.175, 0.18] }, // the iron ends
    { x: [-0.424, -0.4], y: [0.078, 0.578], z: [-0.175, 0.18] },
  ],
  /** meditating: bloombot sits this far out from the charger pad's edge (inside the pad's reach, POWER.charger) */
  padGap: 0.35,
  /**
   * meditating: bloombot's root sits this high above the ground on the charger pad (the pad's glowing top is at 0.1,
   * MachineVisuals.charger). #576: the cross-legged clip (#482) sits on its root, its lowest point right at it as it
   * breathes (measured from its skinned surface on the GPU: at 0.175 it floated 7.2 cm over the pad until it had
   * settled), so a hair over the top; `settle` takes it the rest of the way.
   */
  padTop: 0.103,
  /**
   * On a bench bloombot sits right back, its backpack against the backrest, and its short legs stick out over the
   * seat's front edge, as a toddler's do on a grown-up bench: its shins are raised `lift` degrees forward from
   * hanging (its thighs are too short for its knees to reach the edge, so hanging straight down they would go through
   * the front of the seat; from about 55 degrees up they clear it). It swings them, one up as the other goes down:
   * up to `degrees` each way at `perSecond` swings a second, the swing growing and settling every `driftSeconds` so it
   * now and then nearly stops (`calmest`: the smallest share of the full swing). No swing with reduced motion, and
   * none while something sits in its lap (the swing dies away at `settle` a second); the legs stay out.
   */
  legSwing: { lift: 70, degrees: 15, perSecond: 0.75, driftSeconds: 11, calmest: 0.2, settle: 3 },
  /**
   * Sitting, bloombot settles onto what it sits on (the seat, the pad) from its real skinned surface
   * (BloombotVisuals.settle), so its underside touches it rather than floating over it or sinking in. From `after`
   * seconds into the pose (once it has bent into it) it takes a first look and eases there (`ease` a second, for
   * `easeFor` seconds); then, holding still, it looks every `watchEvery` seconds across `cycle` seconds (a whole
   * breath and leg swing: the by-hand breathing is 2π/1.6, about 3.9 s; a leg swing is 1/0.75 s, and it grows and
   * calms over legSwing.driftSeconds, 11 s; #576: watched for less, a lively swing it missed took a knee off the seat's
   * front lip, or a shin back into it, after it had settled) and comes up by the most any look
   * needed, so it never dips in between; it watches again until that is within a `hair`, at most `passes` times, then
   * holds. It rests `gap` above the top (on a bench its body and thighs do; its shins and feet hang over the front
   * edge: anything they carry `hangShare` of, the knees too), and comes forward just far enough that nothing of its
   * back is in the backrest and no shin is in the seat's slab; never more than `most` from where the pose put it.
   * #576: on a bench it starts `bench.up` higher and `bench.out` further forward than the sit clip's hips put it
   * (`seatLift`; hips are not its underside, and its backpack needs room before the backrest), about where it
   * settles with its legs out (REST.legSwing; measured in the game: about 0.08 up, 0.073 out), so it is on the seat as it sits down
   * (the sit-down clip takes 4.7 s, and the first look waits for its blend into the seated loop) and the looks only
   * fine-tune it; a little short of it, as it only ever comes forward.
   */
  settle: { after: 1.2, ease: 6, easeFor: 0.8, cycle: 11, watchEvery: 0.15, hair: 0.002, passes: 3, hangShare: 0.15, gap: 0.003, most: 0.2, bench: { up: 0.065, out: 0.05 } },
  /**
   * Getting onto a bench and off it, in step with bloombot's clips. It walks to the cell in front of the bench, then
   * steps (at `walk` cells a second) to `step` in front of where it will sit, clear of the seat's front edge with its
   * backpack. The sit-down clip turns it round on the spot, then its hips come down from `down[0]` to `down[1]`
   * seconds in (read from bloombot.glb: Hips at standing height until about 2.3 s, seated by about 3.3 s): only then
   * does it come back onto the seat and up to its height, so it never stands inside the bench. Standing up is the
   * same backwards: the stand-up clip's hips rise from `up[0]` to `up[1]` seconds in, and it comes forward off the
   * seat and down to the ground with them, then walks back to where it stood.
   */
  onto: { step: 0.25, walk: 1.2, down: [2.3, 3.35] as const, up: [1.5, 2.7] as const },
  /** the music swells to this share above its level while sitting */
  musicSwell: 0.6,
  /**
   * Until E23.9.2's friendship lands (`sim.keepers.isFriend`), a Keeper counts as a friend once its story is settled.
   * (Friendship, three gifts it loves after it settles, is what earns a seat beside bloombot.)
   */
  friendFrom: 'settled' as const,
  /** the park bench's seat, world units above the ground (the model's seat at 0.46, drawn at 0.58) */
  benchSeat: 0.27,
};

/**
 * Bloombot's sitting clips (E23.10.2.5, e23-proof's art pass, #482): sit down, sit, stand up; meditate cross-legged.
 * In `sit` the hips are `seatHips` metres above the feet (model metres, before bloombot's 0.95 scale), so on a bench
 * bloombot is lifted by the seat's height less that, and its short legs dangle.
 */
export const BOT_CLIPS = { sitDown: 'sit-down', sit: 'sit', standUp: 'stand-up', meditate: 'meditate', seatHips: 0.203 } as const;

/** How far to lift bloombot so its hips rest on a seat `seat` world units high (`scale`: bloombot's model scale). */
export function seatLift(seat: number, scale: number): number {
  return Math.max(0, seat - BOT_CLIPS.seatHips * scale);
}

/**
 * How far onto the seat bloombot is `t` seconds into a clip whose hips move between `window[0]` and `window[1]`
 * seconds (REST.onto): 0 before, 1 after, eased between.
 */
export function seatRamp(t: number, window: readonly [number, number]): number {
  const k = Math.max(0, Math.min(1, (t - window[0]) / (window[1] - window[0])));
  return k * k * (3 - 2 * k);
}

/**
 * Where bloombot's feet are drawn while it gets onto a seat: `share` of the way (REST.onto, seatRamp) from the spot
 * `step` in front of the seat back onto the seat itself (x, z), facing out along `facing`.
 */
export function seatFeet(seat: { x: number; z: number; facing: number }, step: number, share: number): { x: number; z: number } {
  const back = step * (1 - share);
  return { x: seat.x + Math.sin(seat.facing) * back, z: seat.z + Math.cos(seat.facing) * back };
}
