# Solarbloom — Drone Visual Redesign

**Target:** Existing PlayCanvas + TypeScript game  
**Scope:** Refine the existing drone asset, materials, animation and effects to match the latest Solarbloom reference render. Preserve gameplay and the isometric grid.

## 1. Art direction

The drone should look like an adorable premium ceramic designer toy brought to life: clean, rounded hard-surface geometry, warm white shell, golden trim, bright green leaf ears, and expressive cyan eyes. It should be immediately recognizable at normal isometric gameplay zoom.

The supplied base model already has the correct silhouette and concept. Do not replace it with a humanoid robot or introduce unnecessary mechanical complexity. The latest generated turnaround is the visual target; its studio lighting is not a requirement for the in-game renderer.

## Epic D01 — Geometry and silhouette

- [ ] Retain the spherical body but compress its vertical dimension by approximately 10%, producing a slightly squat, rounded egg-like silhouette.
- [ ] Make the upper shell visually dominant; retain a smaller champagne-colored lower shell.
- [ ] Enlarge the face by approximately 20–25% relative to the existing face, prioritizing width. Use a broad rounded oval/rounded rectangle that follows the body curvature.
- [ ] Thicken the gold face bezel and round its cross-section. Keep the face inset slightly behind the bezel.
- [ ] Retain the gold equatorial band; give it a subtle raised profile and rounded edges. Avoid an oversized belt.
- [ ] Add a small gold status button above the face, as shown in the reference.
- [ ] Retain the dark navy circular top cap with a slim gold rim.
- [ ] Shorten the antenna by roughly 30% relative to the original. Give it a thicker, softly rounded navy tip, cream/gold segmented shaft, and slight backward tilt (approximately 10–15 degrees).
- [ ] Replace thin realistic leaves with two chunky, broad, gently curved lime-green leaf ears. Use a single central vein and a few simplified secondary veins. Round the tips and edges slightly; preserve a recognizable leaf shape.
- [ ] Add short green stems and dark rounded mounting sockets at the upper sides of the shell. Angle the leaves outward and upward, with mild asymmetry permitted during animation.
- [ ] Retain the central underside thruster and add two smaller angled auxiliary thrusters. Each should have a short cream or champagne housing and rounded cyan luminous nozzle.
- [ ] Add one small recessed side vent/status panel with a few cyan indicator marks. Keep other shell details minimal.
- [ ] Bevel visible hard edges; ensure smooth normals, no faceting, intersecting surfaces or visible gaps.

**Acceptance:** Front, three-quarter, side and rear views remain consistent; face and leaf ears dominate the silhouette; all three thrusters are identifiable; the asset reads clearly at gameplay zoom.

## Epic D02 — Materials and palette

Use physically based materials with satin ceramic/plastic surfaces rather than dark reflective metal. Values below are suggested starting points in sRGB hex; tune against the game lighting. Roughness is listed in conventional PBR terms; if the existing material API uses glossiness, convert appropriately (glossiness ≈ 1 − roughness).

| Surface | Color | Roughness | Metalness |
|---|---|---:|---:|
| Upper shell | `#F5F3E8` | 0.30 | 0.00 |
| Lower shell | `#BEBBA7` | 0.35 | 0.15 |
| Gold trim and bezel | `#E8BA40` | 0.28 | 0.55 |
| Face glass / navy cap | `#101D26` | 0.18 | 0.00 |
| Leaf ears | `#A5D94D` | 0.50 | 0.00 |
| Leaf veins | `#589D32` | 0.55 | 0.00 |
| Eyes / nozzle emission | `#71F5FF` | 0.25 | 0.00 |

- [ ] Upper shell must remain visibly warm white from every angle, including shadowed sides. Do not compensate for inadequate lighting by making the entire shell emissive.
- [ ] Lower shell should be warmer and darker than the upper shell, not black.
- [ ] Gold should read as soft warm yellow-gold rather than mirror chrome or orange plastic.
- [ ] Face should be dark glossy navy glass with restrained, broad reflections; expressions must remain legible.
- [ ] Leaf ears should be bright fresh green with softly shaded thickness, not thin dark metallic surfaces.
- [ ] Use localized cyan emissive materials for eyes, thrusters and side indicators. Avoid excessive glow washing out their shapes.
- [ ] Share materials across drones where possible; avoid unnecessary unique textures or per-instance material clones.

**Acceptance:** Drone matches the reference's cream/gold/lime/cyan palette in actual gameplay lighting; no dark metallic-looking upper shell; highlights remain soft and readable.

## Epic D03 — Facial expressions

Use a single reusable face surface with an expression atlas, shader parameters or another lightweight implementation supported by the existing project. Do not model separate eye geometry for every expression unless justified.

| Expression | Visual | Trigger |
|---|---|---|
| Happy | Two upward cyan arcs | Default idle / successful restoration |
| Focused | Two rounded vertical cyan bars | Searching or travelling to a target |
| Excited | Two four-point cyan stars | Bloom Chain milestone, Lucky Cat, Frenzy entry |
| Working | Upward chevron eyes and tiny activity bars | Preparing or performing a task |
| Restoring | Happy/working eyes; optional brighter glow | Active restoration beam |
| Sleeping | Two downward-facing curved closed eyes, optional small Z marks | Extended inactivity |

- [ ] Increase eye spacing and stroke thickness sufficiently for the default camera distance.
- [ ] Use clean rounded strokes and a crisp emissive core with a subtle halo.
- [ ] Add occasional short blinks; avoid constant rapid changes.
- [ ] Drive expressions from existing drone/game events. Priority: special celebration > restoring > travelling > idle/sleeping. Return to the correct underlying state after a celebration.
- [ ] No expression should alter gameplay state or task timing.

**Acceptance:** All six expressions can be previewed and are distinguishable at normal zoom; restoring and celebrating do not leave the face stuck in an incorrect state.

## Epic D04 — Animation and personality

Use pivot-based animation or the existing animation system. Suggested hierarchy (adapt to current asset conventions):

```text
DroneRoot (gameplay position)
  VisualRoot (hover, tilt, squash)
    Body
    Face
    AntennaPivot
    LeafLeftPivot
    LeafRightPivot
    ThrusterCenter
    ThrusterLeft
    ThrusterRight
    BeamOrigin
```

- [ ] Idle: soft hovering bob, roughly 0.03–0.06 body diameters in amplitude over a 1.5–2.5 second cycle; occasional leaf twitch and blink.
- [ ] Travel: gently tilt forward around 8–15 degrees according to velocity; leaves lag behind with subtle spring motion.
- [ ] Working: stabilize above target and lean slightly toward it; animate cyan thruster intensity.
- [ ] Successful restoration: short joyful bounce (about 0.3–0.5 seconds) and happy eyes.
- [ ] Bloom Frenzy: excited star eyes on entry, slightly faster bob/leaf movement, enhanced gold/cyan accents; do not obscure the face.
- [ ] Lucky Cat discovery: brief excited wiggle or bounce, without interrupting assigned tasks.
- [ ] Sleep: reduced bob amplitude and dimmer indicators; resume smoothly when assigned work.
- [ ] Randomize idle phase per drone to avoid synchronized hovering.
- [ ] Keep simulation position, tile selection, collision/picking and task completion independent of decorative animation. Respect pause and reduced-motion settings.

**Acceptance:** Transitions are smooth; drones never snap, clip into the ground or change their gameplay target due to animation; multiple drones look individual rather than synchronized.

## Epic D05 — Restoration effects and game juice

- [ ] Emit a short tapered cyan restoration beam from an underside/front-facing emitter toward the target tile, not from the eyes.
- [ ] Reference effect: translucent cone/streams of cyan light with small travelling luminous particles and soft ground sparkles.
- [ ] Keep the beam visually anchored to both emitter and target as the drone moves.
- [ ] On confirmed tile restoration, show a small bloom burst, sprouts/flowers popping up, and the existing resource reward feedback. Do not award resources again from the VFX callback.
- [ ] Add subtle hovering/working hum, soft restoration chime and short success sound if the current audio system supports these. Limit simultaneous sounds and avoid repetitive loud cues.
- [ ] Add modest golden highlights and richer particles for Frenzy and major chain milestones, not every ordinary task.
- [ ] Pool particles, beams and transient effects; clean up on task cancellation, destruction, pause or district change.

**Acceptance:** Restoration is immediately understandable from the isometric camera; effects feel rewarding without obscuring the grid, other drones or the Hidden Lucky Cat.

## Epic D06 — PlayCanvas integration and lighting

- [ ] Inspect the actual drone entity, asset pipeline, materials, renderer, animation and task state code before implementation. Reuse current architecture rather than adding a parallel drone system.
- [ ] If the model is imported, update the source asset and export using the project's existing supported format (prefer GLB/glTF where appropriate). If procedural, update the current mesh/material construction directly.
- [ ] Verify pivots, axis conventions, face orientation, scale, beam origin and bounding volumes after import. Preserve gameplay footprint and selection behavior.
- [ ] Use soft warm directional daylight and sufficiently bright neutral/cool sky ambient lighting or environment reflections. Apply subtle ambient occlusion at seams and sockets if available.
- [ ] Prefer existing scene-wide lighting; do not add a dedicated real-time light per drone. Do not globally change the park lighting solely to fix the drone.
- [ ] Use restrained bloom on emissive elements if supported by the existing rendering pipeline; provide a clean no-bloom fallback.
- [ ] Retain all resource production, restoration logic, upgrade tiers, drone speed, save IDs and existing progression. This epic is visual/UX work, not economy rebalancing.
- [ ] Verify existing saves load correctly and previously placed hubs spawn the redesigned drone without migration unless genuinely required.

## Epic D07 — Performance and validation

- [ ] Establish a baseline with the old model on the same scene/device before replacing it.
- [ ] Test one drone, a normal active swarm, and a stress case of 50–100 drones if supported by the game. Measure frame time and draw calls, not just subjective smoothness.
- [ ] Use shared meshes/materials, atlas textures, batching or instancing where compatible with the existing renderer. Consider LOD or simplified distant effects if profiling identifies a bottleneck.
- [ ] As an initial budget, aim for roughly 2,000–5,000 triangles per near drone, adjusting to actual visual needs and profiling. This is a proposal, not a measured requirement.
- [ ] Reduce distant particle counts and expression/animation update frequency where appropriate. Keep important drone movement readable.
- [ ] Validate desktop and mobile browser rendering at actual gameplay camera angles and zoom levels.
- [ ] Capture front, three-quarter, side and rear preview renders, an expression sheet, and a real in-game restoration screenshot for comparison to the supplied concept.
- [ ] Confirm no regression in task completion, resource rewards, grid interactions, pause/resume or save/load.

## Implementation order

1. D01 geometry and D02 materials: establish the look before adding effects.
2. D06 integration and lighting: verify the model in the actual park.
3. D03 expressions and D04 animation: give it personality.
4. D05 restoration effects: add satisfying gameplay feedback.
5. D07 profiling and final validation.

Keep the game playable after each step. Do not replace unrelated game assets or implement new gameplay systems as part of this redesign.

## Definition of done

The drone looks like the latest Solarbloom concept: warm ceramic shell, large friendly cyan face framed in gold, bright chunky leaf ears, short antenna, small luminous thrusters and a joyful hovering personality. It is recognizable in the existing isometric grid, clearly communicates its working state, and makes tile restoration feel more satisfying. The redesign preserves simulation behavior and performs acceptably on target devices.

## Claude kickoff prompt

Read this specification and compare the supplied original drone turnaround, in-game reference crop and latest redesigned turnaround. Inspect the existing PlayCanvas code and asset pipeline first. Implement D01 through D07 in the recommended order, reusing the current drone model and gameplay systems. Start with geometry and materials; validate the appearance inside the actual game before implementing facial animation and effects. Keep the original drone available for comparison until the redesign passes acceptance criteria. Report the files changed, screenshots, performance measurements and any deviations from this specification. Do not claim visual parity from code changes alone.

## Notes on scope and assumptions

The geometry percentages, material values, animation timings and triangle budgets are proposed tuning targets based on visual comparison, not measured properties of the original asset. The actual source mesh and PlayCanvas code have not been inspected. The latest generated image is concept art, not an exact orthographic modeling blueprint; prioritize coherent geometry and in-game readability over incidental differences between its views.
