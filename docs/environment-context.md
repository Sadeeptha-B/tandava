# Environment work: context for continuing

Hand-off for the ongoing improvement of the backdrop and surroundings (everything except the dancer, the ring
and the particles). Read this, [brief.md](brief.md) section 4 and the README before changing the stage.
State as of commit `e726894` ("Improvements to atmosphere, column lighting and caustics, wider halls").

## Ground rules from the brief and the user

- **Shiva is the focal point; the background stays restrained.** Each addition must read as atmosphere, not as
  a competing subject. The user asked for "elegant, but not too over the top" and has approved restraint at every
  step (the gopuram is deliberately barely visible).
- **Change in increments and show results.** The user wants to stop at key points with before/after stills
  (all three looks: `both`, `fire`, `water`) and approve each step before the next. Don't commit unless asked.
- **Performance matters.** The target is integrated Intel Iris Xe at the medium tier. Prefer closed-form maths
  in existing shaders over ray marching or extra passes. Gate anything heavy by `quality` (`low|medium|high`).
- **Hue.** "Both" is the brief's preferred synthesis: golden fire against a deep turquoise world. Mixing gold
  scatter into teal fog over a large area turns it grey. Keep warm light close to its source.

## What was built (in place now)

### 1. Shared atmosphere: [src/stage/atmosphere.js](../src/stage/atmosphere.js)

- `installAtmosphere()` (called at the top of `main.js`) replaces three.js's `fog_*` shader chunks. Every
  built-in material with `fog: true` now runs `atmoApply(col, worldPos)`, which does three things:
  - exp2 fog whose density thickens towards the water (`atmoTau`, closed-form height integral);
  - a fog colour that brightens towards the far end of the hall (`atmoFogColor`, an "aperture" lobe along
    −z), so near forms sit dark and distant ones fade into light;
  - the ring's fire scattered by the fog (`atmoRing`: 8 inverse-square points on the ring, closed-form line
    integral, one `atan2` per point). The scatter is held back for rays seen *through* the ring's opening, so
    the gold forms a corona *outside* the ring and the dancer and nebula stay clear. Rays passing far from the
    ring skip the loop.
- `ATMO_GLSL` is the same code as a string, for custom `ShaderMaterial`s (water, sky, gopuram).
- `attachAtmosphere(scene)` (called just before `renderer.compile`) wraps each fogged material's
  `onBeforeCompile` to inject the shared `atmoUniforms`, and suffixes its `customProgramCacheKey` (`|atmo`).
  **Materials created after that call will not get the uniforms.** Call it again on new objects, or spread
  `atmoUniforms` into their uniforms yourself.
- `updateAtmosphere(palette, ringPower)` runs each frame from `main.js`.
- Knobs: `atmoUniforms.uAtmo = (1.6, 1.4, 14, 1.2)`. These are mist height scale (m), low-mist boost, ring
  scatter gain and ring scatter falloff (1/m). Density comes from `scene.fog.density` (0.03).

**Pitfalls already hit:**
- `Reflector` *clones* its uniforms, so shared uniform objects must be re-linked after construction:
  `Object.assign(water.material.uniforms, atmoUniforms)`.
- `new THREE.Color()` defaults to **white**. A cloned or unlinked colour uniform turns the water white.

### 2. Grade: [src/stage/post.js](../src/stage/post.js)

The split-tone shadow tint used to be a constant additive floor that flattened every dark to the same teal.
Half of it is still a floor; the other half follows the pixel's own level
(`* (.5 + .5 * smoothstep(0., .08, l))`).

### 3. Stage: [src/stage/environment.js](../src/stage/environment.js)

- **Water** (`Reflector`, custom shader) uses `atmoApply`. Impact ripples are in `uImpacts` (`MAX_IMPACTS = 8`;
  `addImpact` is called on each stamp from `main.js`).
- **Stone material** (`stone`, `MeshStandardMaterial` + `onBeforeCompile`):
  - **Weathering:** triplanar noise plus fine grain (uses `dFdx`/`dFdy` for the facing).
  - **Masonry joints:** coursed joints only where the vertex attribute `aMono` is 0. Carved monoliths
    (columns, beams) set `aMono = 1` via `markMonolith()`.
  - **Ring as a light:** 8 points, inverse-square, colour `uRingLight`. It fades up the shafts so light pools
    around the dancer.
  - **Caustics:** a two-layer drifting Voronoi-edge network on **side-facing** surfaces just above the
    waterline, coloured by `uCaustic`. They speed up with `uEnergy` and flare when a stamp ripple reaches the
    stone (the same `uImpacts` front, 2.3 m/s).
  - **Strengths:** `env.gains = { ringLight: 700, caustic: 45 }`, read in `main.js` each frame. The stone base
    colour is warm neutral `0x201d1a`, so gold light reads gold and the fog supplies the teal.
- **Columns:**
  - `templeColumn()` builds a Dravidian pillar 19.2 m tall (`COL_TOP`): moulded square base with a rounded roll
    (kumuda), a square lower block, a slender tapering octagonal shaft, a turned capital (pot, neck, cushion,
    lotus flare), a thin square abacus, a neck block and a stepped three-tier rolled bracket (taranga potika).
  - Sections are built with `revolve(profile, sides, flat)`: a `[radius, y]` profile; `flat` makes polygonal
    sections whose faces sit at that radius; normals are smoothed along the profile except at creases; the
    output is non-indexed position + normal.
  - Placement: `HALL = { inner: 11, outer: 20, bay: 10 }`, 9 bays from z = −1 to −81. The outer row is scaled
    1.25. Widened at the user's request so the space feels expansive; the near columns now sit outside the
    cinematic frame.
- **Beams:** `templeBeam(z0, z1)`, one continuous beam per *inner* row, with a curved overhanging cornice
  (kapota). The outer rows have no beam.
- **Sky:** `SKY_GLSL` defines `skyBase(d)`, shared by the sky sphere and the gopuram.
- **Gopuram:** `gopuram()`, at (0, −0.5, −98), simplified to stepped tiers with cornice lines on a plain block,
  under a barrel-vault crown (984 vertices). Its unlit `ShaderMaterial`:
  - the fog is capped at `uSilhouette = 0.8`, so the upper tiers stay a faint dark outline;
  - below about 15 m it fades fully into `skyBase` (`smoothstep(1., 15., y + noise)`), so it doesn't read as
    separate from the colonnade.
  - **The user explicitly chose this exact look.** Don't make it more prominent without asking. Base mouldings,
    corner shrines and finials were removed because they weren't visible (verified by pixel diff).
- **Debug handles:** `env.tower`, `env.stone`, `env.gains`, and `window.__tandava.atmo` (`atmoUniforms`).

### 4. Wiring: [src/main.js](../src/main.js)

Search for `installAtmosphere`, `attachAtmosphere`, `updateAtmosphere`, `env.uniforms.uRingLight` and
`env.uniforms.uCaustic`. The ring's power is `ringPower * ring.light.total` (it flickers with the flames).
Lamps and petals: search for `lamps.` and `petals.` (created after `env`/`particles`, updated after `env.update`
and after `updateAtmosphere`, cleared in `__seek`, gusted from `onStamp`).

### 5. Ripples on the CPU: [src/stage/ripples.js](../src/stage/ripples.js)

`rippleAt(impacts, time, x, z, out)` mirrors the water shader's stamp fronts for things that float: heave `h`,
slope `sx`/`sz`, outward push `px`/`pz`. It uses the caustics' broad swell envelope (it carries further than the
crest). `env.impacts` is the live `uImpacts` array. `WATER_Y = 0.018`.

### 6. Floating oil lamps: [src/stage/lamps.js](../src/stage/lamps.js)

- **Placement** (`placeLamps`, seeded, deterministic): four lanes each side (x ≈ 5.6, 8.2, 14.4, 17.0, jittered),
  z from +5 to −65. Rejected: within 3 m of the ring, near columns, closer than 0.75 m to another lamp, and inside
  the wedge seen through the ring from the cinematic camera (`|x| / (6.5 − z) < ~0.25`), so the dancer and nebula
  stay clear. Acceptance rises with distance. 70 / 130 / 170 lamps for low / medium / high.
- **Bowl:** a `LatheGeometry` diya, `InstancedMesh`, `MeshStandardMaterial` (fogged through the atmosphere). Its
  inside and rim glow with the lamp's own flicker (`aSeed`, `lampFlick`).
- **Flame:** one instanced upright billboard per lamp: teardrop flame + soft halo, additive, dimmed by
  `atmoTau`. Distant flames are kept ≥ ~2 px tall and dimmed by the same factor, so they don't shimmer.
  Colour is the palette's new `lamp` key (gold in `both`/`fire`, pale cyan in `water`, following the look).
- **Motion:** stamp fronts heave and tilt them (`rippleAt`), push them outward, and a weak spring brings them back
  (~16 s period). A slow wander and faint heave keep them alive between stamps.
- Both meshes are on layer 0, so the reflection doubles them. Debug: `__tandava.lamps.lamps` (positions, offsets).

### 7. Flower shower: [src/fx/petals.js](../src/fx/petals.js)

- **Trigger:** `beatPos` crossing `landingBeat` (61). Deterministic under `__seek` as long as `pre` covers the
  crossing (e.g. `__seek(69, 8)`). One shower per loop.
- **Readability (second pass, after the user found the first version read as specks among the embers and
  motes):** fewer and bigger, pink-majority, shaded rather than glowing, slower and swinging, plus a near layer.
- **Flowers:** 70 / 120 / 160 in two `InstancedMesh`es sharing one material and one simulation. 60% are boat-shaped
  lotus petals 6–8 cm long, pale at the base (`aGrad`) and pink toward the tip (pale to deep, leaning magenta so
  they stay pink, not salmon, in the ring's gold light). 40% are whole five-petal jasmine flowers, 3.4–4.6 cm
  across, with a yellow-green heart.
- **Release:** over about 2.4 s (front-loaded), from 3.5–4.6 m (above the frame) over a 3.4 m disc round the
  dancer. 12% start 2.2–3.6 m in front of the camera, to either side of the dancer, so a few fall large past the
  lens.
- **Falling:** lotus petals swing along their own line in slow, wide arcs (~0.5–0.75 m/s down, slowing at the
  ends of each swing), tilting hardest at the ends; 35% tumble end over end. Jasmine flowers fall faster, face up,
  spinning and wobbling. Pushed by `performer.fx.wind` (outward breath and an updraft near the dancer) and the
  swirl from `spin` (smoothed, so it lingers). `gust()` on each stamp. They part round a capsule at the hips. A
  petal crossing the fire's arc chars, glows ember and shrinks (`aBurn`).
- **Lighting:** lit normally, plus a cool sky term (`uSky`) that depends on the facing (`(.1 + .9 * up²)`) and a
  glint as a face turns toward the light. So they flicker light and dark as they rock, which neither the motes nor
  the embers do. A trace of warm translucency near the ring (`uTrans`).
- **On the water:** they ride `rippleAt` (heave, tilt, drift), then sink through the opaque surface in 1.2 s. All
  are gone by beat ~78.5 (deadline `beats − 3.5`).
- When idle, `count = 0`. The meshes stay "visible" so the shader compiles in the warm-up (no hitch at the
  landing). Debug: `__tandava.petals.stats()` → [idle, waiting, falling, floating, burning].
- **Video capture:** `window.__step(dt)` advances the live simulation one frame and renders it. A recorder
  (puppeteer, `__seek` then `__step` + screenshot per frame, then ffmpeg) is the way to review motion. Keep the
  script outside the project.

- **Motes give way:** `petals.air` is the smoothed fraction of petals in flight. `main.js` sets
  `ring.motesLevel = 1 − 0.8 × petals.air` (a `uLevel` uniform on the motes in [ring.js](../src/fx/ring.js)).
  The motes fall to about 22% around beat 68 and are back near full by beat 78.

Interleaved A/B (3 runs each, 1600×900, `motion=1`): no measurable frame-rate cost; within run-to-run noise.

### 8. Sky stars (was the "square motes" bug)

The hard-edged pale squares seen near the camera were **not the motes**: hiding motes, embers and particles left
them in place, and hiding `env.sky` removed them. `SKY_GLSL`'s stars lit a whole cell of a ~1° angular grid,
about 30 px at 1600×900. They showed mostly in the water's reflection of the sky and in gaps between columns. Each
star is now a soft gaussian point at a random spot in its cell, at least ~1 px across (`fwidth`), dimmed as it
grows so it doesn't shimmer at low resolution.

## Remaining work (the original five-point plan)

| # | Area | Status | Remaining |
|---|---|---|---|
| 1 | Fog and light structure | Done | Optional: a weaker corona in the `water` look (it reads slightly hazy). |
| 2 | Temple silhouettes | Mostly done | Temple-tank steps down into the water along the sides; optionally a beam on the outer rows. |
| 3 | Things in and on the water | Caustics, lamps done (awaiting approval) | Stone paving faintly visible under the shallow water near the dais. |
| 4 | Environment following the dance | Flower shower done, second pass for readability (awaiting approval) | See below. |
| 5 | Lens and depth layers | Not started | Light rays from the ring, slight depth of field, dark out-of-focus foreground shapes. |

Lamps (section 6) and the flower shower (section 7) were built to the agreed design and are waiting for the
user's review. Open choices: lamp colour in the `water` look (currently follows the look's cool flame), lamp
density, and the number of petals. The mote dimming during the shower and the star fix (section 8) are done.

### Then

- **Environment following the dance:**
  - **Awakening:** the hall near-dark.
  - **Rhythmic section:** the ring reveals the hall; dust falls from the beams on hard stamps.
  - **Spin, leap, landing:** fog parts or walls fade into stars for a few beats.
  - **Return:** the hall closes back in.
  - Drive it from `performer.beatPos` (0–80 beats, 100 BPM), `performer.intensity` (keys in
    [tandava.js](../src/character/tandava.js) `c.intensityKeys`, peak near beat 61) and the `onStamp` events.
- **Lens and depth layers:**
  - a half-resolution light-ray pass from the ring, blocked by the dancer;
  - subtle depth of field;
  - one or two dark, out-of-focus foreground shapes.
  - Run the expensive parts at the `high` tier only, or at half resolution.
- **README:** the "Look" row and *Known limitations* don't yet describe the atmosphere, columns or gopuram.
  Update them when this work settles.

## How to verify (workflow that worked)

- **Dev server:** `npx vite --port 5173 --strictPort`. It's often already running; check with a request first.
- **Screenshots:** `node tools/shot.mjs <out.png> "<query>" [w] [h] ["js expression"]`.
  - Run it from the **PowerShell tool**; Edge won't launch from the Bash tool.
  - Write output to the session scratchpad, **never inside the project** (Vite's watcher crashes).
  - Python isn't installed. Use Edit, sed or bash heredocs for edits, and ffmpeg (`~/scoop/shims/ffmpeg.exe`)
    for `hstack`/`vstack` grids. Use `vstack=inputs=N` for more than two rows.
- **Standard views** (beat 30 is a good wide-armed pose; also check 42 and 47.5 for ripples, 74 for the ending):
  - Cinematic: `beat=30&el=both` (repeat for `fire` and `water`).
  - Wide: `beat=30&el=both&zoom=0.45`.
  - Custom camera, as the expression argument:
    `(()=>{__seek(30); const t=__tandava; t.camera.position.set(3,1.2,14); t.camera.lookAt(0,9,-40); t.camera.updateMatrixWorld(); t.post.render(0); return 'ok'})()`
    (that one looks down the hall at the gopuram).
  - To inspect dark geometry, add `t.post.grade.uniforms.uExposure.value=3.5;` before rendering.
  - To try parameters without editing code, set `__tandava.env.gains.*` or `__tandava.atmo.uAtmo.value.*`
    before `__seek`. Values that `main.js` rewrites each frame (colours, `uRingLight`) must be changed at their
    source.
- **Before/after:** `git stash -q` → render → `git stash pop -q`. Untracked new files stay in place, so make sure
  the stashed state doesn't import them.
- **Frame rate:** absolute fps on this laptop swings from 9 to 37 between runs. Compare **interleaved** A/B runs
  (current, original, current, original…, three each) using a 6-second `requestAnimationFrame` count after a
  4-second warm-up, at 1600×900 with `motion=1`. Steps 1–2 cost about 7% measured that way.
- **Equivalence checks:** ffmpeg `blend=all_mode=difference,signalstats` gives the mean pixel difference.
  Values under about 0.1 (on 0–255) mean visually identical.
