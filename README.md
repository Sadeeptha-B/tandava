# Shiva — Tandava

A real-time, cinematic web experience of Shiva performing the Tandava: a four-armed Nataraja dancing a
continuous 48-second cycle inside a ring of fire, over shallow reflective water, in a fog-bound temple hall.
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
| Character asset | `tools/build-character.mjs` | MakeHuman base mesh + macro/detail morphs (muscular male, sculpted face), Catmull-Clark subdivision, rear arm pair cloned from the shoulder joint down with its own bone chain, six sparse facial morphs. 74k vertices, 121 bones. |
| Face | `src/character/face.js` | Expression keyed to the dance: eyes closed in stillness, opening through the awakening, widest at the landing; brow gathers as the dance builds; a faint smile in the afterglow; breath and slow blinks. |
| Rig | `src/character/rig.js` | Analytic solver: two-bone IK for legs, direction-driven arms, swing/twist split onto MakeHuman's twist bones (pivot-compensated), hinge-safe elbows, mudra finger poses, rate-limited "spotting" head. |
| Choreography engine | `src/character/choreo.js` | Beat-timed keys per channel, monotone cubic interpolation (planted feet stay planted), `hit` easing for stamps, weight-based balance, automatic hip drop so legs never over-stretch, successive joint lag for follow-through, impact spring, foot-contact events. |
| The dance | `src/character/tandava.js` | 80 beats at 100 BPM: **A** awakening → aramandi → Nataraja pose; **B** stamps, lunges, knee lifts, rechaka (torso circles), accelerating footwork; **C** pivot spin → leap → landing stamp; **D** return. Loops seamlessly (the 360° turn is unwrapped across the seam). |
| Secondary motion | `verlet.js`, `hair.js`, `garment.js`, `ornaments.js` | Hair in three layers (swept-back locks over the scalp from the hairline, coiled topknot, ~90 simulated free locks). One Verlet solver for the locks, tiger-skin panels, sashes and the rudraksha mala, colliding with body capsules fitted to the mesh; wind field driven by the dance. |
| Look | `materials.js`, `src/stage/*`, `src/fx/*` | Procedural skin (ash, tripundra, third eye, blue throat, brows, kohl) and eyes, planar-reflection water with impact ripples, fire ring shader, GPU embers, CPU splash/flame particles, HDR bloom + filmic grade. |
| Audio | `src/audio.js` | Entirely synthesised in Web Audio (drone, damaru, tala pulse, stamp hits) — no samples, nothing to license. |
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
  (paused on the Nataraja pose) exercised in headless Edge; roughly 45–55 fps at 1600×900 on integrated Intel Iris Xe
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
