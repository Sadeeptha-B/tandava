# Shiva — Tandava

A real-time, cinematic web experience of Shiva performing the Tandava: a four-armed Nataraja dancing a
continuous 53-second cycle inside a ring of fire, over shallow reflective water, in a fog-bound temple hall.
The brief is in [docs/brief.md](docs/brief.md).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # production bundle in dist/
npm run preview    # serve the bundle
```

The character asset (`public/assets/shiva.bin` + `shiva.json`) is committed-ready. To rebuild it from source:

```bash
npm run assets:fetch   # downloads the CC0 MakeHuman base mesh, rig and morph targets
npm run assets:build   # morph -> subdivide -> four arms -> quantised binary
```

### Controls

Controls fade in on pointer movement and hide again when idle.

| | Key |
|---|---|
| Pause / resume | `Space` |
| Sound on / off (starts muted) | `M` |
| Cinematic ↔ interactive orbit camera | `C` |
| Fullscreen | `F` |
| Fire / Both / Water look | `1` `2` `3` |

URL options: `?el=fire|water|both`, `?q=low|medium|high` (override the automatic quality tier).

## Deploy to GitHub Pages

The [deployment workflow](.github/workflows/deploy-pages.yml) builds and publishes `dist/` on every push
to `main`. It can also be run manually from **Actions > Deploy to GitHub Pages > Run workflow**.

1. In the repository's **Settings > Pages > Build and deployment**, set **Source** to **GitHub Actions**.
2. Push the workflow to `main` (or run it manually after enabling Pages).
3. Open the site URL shown in the workflow's `github-pages` deployment environment.
   For this repository, the default URL is <https://sadeeptha-b.github.io/tandava/>.

The workflow uses Node.js 24, `npm ci` and the committed character assets in `public/assets/`; it does not
need to fetch or rebuild the MakeHuman source assets. Vite's base URL is taken from the Pages configuration,
so the bundle works under the repository path and also supports a configured custom domain. No additional
repository secrets are needed; deployment uses GitHub's built-in `GITHUB_TOKEN`.

To check the repository-path build locally:

```bash
npm run build -- --base /tandava/
npm run preview -- --base /tandava/  # http://localhost:4173/tandava/
```

## Rendering strategy and trade-offs

The brief asks for the strategy to be chosen deliberately between real-time 3D, pre-rendered video and a hybrid.

**Chosen: fully real-time 3D (Three.js / WebGL 2).** No DCC tool (Blender) or licensed Shiva character or
Tandava motion capture was available, so a pre-rendered film-quality loop could not be produced honestly. What
*could* be built to a credible standard was a properly rigged, anatomically real body driven by authored
choreography, with everything else (hair, cloth, water, fire, light) reacting to that motion live.

- **Gained:** the effects are caused by the dance rather than laid over it — foot contacts are detected from
  the animation and drive ripples, spray, sparks, ring flare, cloth gusts and drum hits; the flame in the palm
  lights the body and leaves a trail; the camera can be orbited; three elemental looks share one scene.
- **Given up:** offline-render fidelity. Skin, hair and cloth are good real-time approximations, not film VFX.
  See *Known limitations*.

## How it is built

| Area | Files | Notes |
|---|---|---|
| Character asset | `tools/build-character.mjs` | MakeHuman base mesh + macro/detail morphs (athletic heroic build, ~8 heads tall: shoulders ~2.8 heads across the deltoids, chest:waist ~1.6, longer neck, upper arm longer than forearm; a lean, elegant, clean-shaven face with an angular jaw and cheekbones that are present but not jutting), Catmull-Clark subdivision, a build-time sharpening pass that defines the muscle forms plus a baked cavity term for the shader, rear arm pair cloned from the shoulder joint down with its own bone chain, six sparse facial morphs. 74k vertices, 121 bones. |
| Face | `src/character/face.js` | Expression keyed to the dance: eyes closed in stillness, opening through the awakening and following the hands through the storytelling passage, widest at the landing; brow gathers as the dance builds; a faint smile in the afterglow; breath and slow blinks. |
| Rig | `src/character/rig.js` | Analytic solver: two-bone IK for legs, direction-driven arms, swing/twist split onto MakeHuman's twist bones (pivot-compensated), hinge-safe elbows, mudra finger poses, rate-limited "spotting" head. |
| Choreography engine | `src/character/choreo.js` | Beat-timed keys per channel, monotone cubic interpolation (planted feet stay planted), `hit` easing for stamps, weight-based balance, automatic hip drop so legs never over-stretch, successive joint lag for follow-through, impact spring, foot-contact events. |
| The dance | `src/character/tandava.js` | 88 beats at 100 BPM: **A** awakening → aramandi → a storytelling passage (nritya) in which the hands depict Ganga descending into the jata, the crescent moon, the serpent and Shiva's own sign (mrigashirsha with tripataka) → Nataraja pose; **B** stamps, lunges, knee lifts, rechaka (torso circles), accelerating footwork; **C** pivot spin → a three-fold phrase (tihai), "ta ka – DHIM" three times with accents on beats 5 and 7 and then sam, the last DHIM being the leap's landing (beat 72); **D** return. The 88 beats are eleven cycles of Adi tala (4+2+2). Loops seamlessly (the 360° turn is unwrapped across the seam). |
| Secondary motion | `verlet.js`, `hair.js`, `garment.js`, `ornaments.js`, `sash.js`, `surface.js` | Hair: a sleek base coat of flat ribbons, swept up into a coiled topknot (gold and pearl band) on top and back from the temple and sideburn over the top of the ear at the sides, with hair lying flat from the forehead corner down each temple; a loose clump at each temple that curves back and falls just in front of the ear; flattened locks of varied width riding on the coat, sweeping back over the ears and falling down the back, with an irregular strand texture; locks over each shoulder framing the face; back locks mixing clumps and matted ropes. A face guard keeps every lock out of the face. One Verlet solver drives the hair, tiger-skin panels, sashes, rudraksha mala and pearl strand, colliding with body capsules fitted to the mesh; wind field driven by the dance. The diagonal tiger-skin sash is projected onto the body's triangles and skinned with the blended weights of the skin beneath it, so it deforms with the skin and never lets the pectorals through. The mala and pearl strand are laid onto the skin at bind time (so they are long enough to go over the chest), collide with a CPU-skinned sampling of the chest, shoulder and neck skin, and are held loosely to their draped shape so the spin cannot fling them down the back. A bronze girdle with a jewelled medallion holds the knee-length tiger-skin skirt. Chest and leg colliders fit themselves to the mesh, so ornaments and cloth stay on the skin when the body recipe changes. |
| Look | `materials.js`, `src/stage/*`, `src/fx/*` | Procedural blue skin (ash, cavity shading, tripundra, third eye, blue throat, brows, kohl) and eyes; gold armbands with ruby crests and bangles; planar-reflection water with impact ripples, GPU embers, CPU splash/flame particles, HDR bloom + filmic grade. The prabha-mandala (`src/fx/ring.js`) has no vessel or fuel: it is a band of living light with currents streaming round it, from which ~50 tongues of fire grow, alternating large and small, joined at the root by a continuous sheet of fire and breaking apart higher up. Each tongue is a camera-facing billboard (upright, turning only about the vertical) that rises while radiating outward, licks and tears off at the tip, and is coloured by temperature. The tongues lean in the hall's draught and in the swirl the spin drags round, and a stamp sends a gust and a pulse of light running up the ring from the nearest point. Around it: a slowly turning corona, a faint nebula (violet and magenta drifting through the hall's teal; per-look hues in `palette.js`) and stars glimpsed inside the ring, sparks thrown up from the tongues or carried round the ring, heat haze in the post pass, and scene rim lights that flicker with the tongues nearest them. Small ornaments sit on a detail layer that the reflection and shadow passes skip. |
| Audio | `src/audio.js` | Entirely synthesised in Web Audio (drone, damaru, Adi tala pulse accented on 1, 5 and 7, stamp hits) — no samples, nothing to license. |
| Dev tools | `lab.html`, `tools/shot.mjs` | Pose lab with contact sheets and a numerical motion audit; headless screenshot helper. |

Iconography followed: damaru in the rear right hand, agni in the rear left, front right in abhaya, front left in
gaja-hasta toward the raised left foot; serpent, crescent moon, jata with topknot, tripundra and third eye,
rudraksha, tiger skin. The dwarf Apasmara is omitted because the figure travels and leaps rather than standing
on one spot.

## Verification done

- **Motion audit** (`lab.analyze()` in `lab.html`): over the whole loop at 120 Hz — 0 mm IK miss on planted feet,
  no hand/torso/head/thigh penetration flags, planted-foot drift only during lift-off/landing transitions,
  no rotation discontinuities (fastest joint is the intentional damaru wrist tremolo), seamless loop wrap.
- **Visual review** of contact sheets every half beat and full-pipeline stills at key moments, in all three looks,
  landscape and portrait.
- **Runtime:** production build succeeds; UI buttons, keyboard shortcuts, audio toggle, reduced-motion start
  (paused on the Nataraja pose) exercised in headless Edge; roughly 40–54 fps at 1600×900 on integrated Intel Iris Xe (varies run to run)
  (medium tier, resolution governor active).

## Known limitations and what remains

Stated plainly, as the brief asks:

1. **Choreography is hand-authored, not captured.** It uses Nataraja iconography and Bharatanatyam-derived
   vocabulary, and is physically consistent, but it has not been reviewed by a dancer and lacks the nuance of
   motion capture (fine footwork, hasta transitions, true facial abhinaya — the face uses six blended expression shapes). The proper next step is a mocap session
   with a classical dancer, retargeted onto this rig — the engine accepts any pose source.
2. **Reviewed as stills and numbers, not as moving video.** Timing and feel were tuned from frame sequences and
   velocity/acceleration metrics. Watch it in motion and expect to want timing adjustments.
3. **Audio has not been listened to.** It runs without errors and is synchronised to the beat and stamp
   events by construction, but balance and timbre are untuned.
4. **Fidelity is real-time, not film.** No scanned/sculpted likeness, no skin textures or subsurface
   scattering, linear-blend skinning (visible at extreme shoulder poses, especially where the two arm pairs
   share a shoulder), strand-tube hair rather than a groom, simple cloth that can clip in extreme poses,
   occasional soft-shadow artefacts on the chest. Closing this gap means a bespoke sculpt with textures and
   corrective shapes, and either a heavier real-time pipeline or an offline-rendered loop (the brief's
   Approach B/C).
5. **Browser coverage.** Only Chromium (Edge) on one Windows laptop was tested. Safari, Firefox and real mobile
   devices are untested; the low-quality tier exists but is unverified on hardware.

## Licences

- Body mesh, rig, weights and morph targets: [MakeHuman](https://github.com/makehumancommunity/makehuman) assets,
  **CC0 1.0** (`assets-src/makehuman/LICENSE.ASSETS.md`).
- [three.js](https://threejs.org): MIT.
- Everything else in this repository (code, shaders, choreography, synthesised audio) is original to this project.
