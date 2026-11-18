import * as THREE from 'three';
import { Character } from './character/character.js';
import { attachSecondary } from './character/secondary.js';
import { createEnvironment } from './stage/environment.js';
import { Palette } from './stage/palette.js';
import { createPost } from './stage/post.js';
import { createCameraRig } from './stage/camera.js';
import { createRing, RING } from './fx/ring.js';
import { createParticles } from './fx/particles.js';
import { createAudio } from './audio.js';
import { createUI } from './ui.js';

const q = new URLSearchParams(location.search);
const still = q.has('still') || q.has('beat') || q.has('sheet');
const reducedMotion = !q.has('motion') && matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
let quality = q.get('q') ?? (coarse || Math.min(innerWidth, innerHeight) < 600 ? 'low' : (navigator.hardwareConcurrency ?? 8) <= 4 ? 'medium' : 'high');

const canvas = document.getElementById('stage');
const veil = document.getElementById('veil');
const titleEl = document.getElementById('title');

function fail(message) {
  const f = document.getElementById('fallback');
  f.hidden = false;
  f.innerHTML = `<div><p style="letter-spacing:.5em">SHIVA — TANDAVA</p><p style="opacity:.7;max-width:34rem">${message}</p></div>`;
  veil.classList.add('lifted');
  window.__ready = true;
}

async function start() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 unavailable');
  } catch (e) {
    return fail('This experience renders the dance in real time and needs WebGL 2. Please open it in a current desktop browser with hardware acceleration enabled.');
  }
  // integrated / software GPUs start one tier down (the resolution governor still adapts from there)
  if (!q.has('q') && quality === 'high') {
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/Intel|UHD|Iris|SwiftShader|llvmpipe|Mali|Adreno|PowerVR/i.test(gpu) && !/Arc/i.test(gpu)) quality = 'medium';
  }
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const basePR = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : quality === 'medium' ? 1.25 : 1);
  let prScale = 1;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.03);
  const camera = new THREE.PerspectiveCamera(31, innerWidth / innerHeight, 0.1, 600);
  camera.layers.enable(1); // small ornaments (see secondary.js)
  camera.position.set(0, 1.1, 7);

  const palette = new Palette(['fire', 'water', 'both'].includes(q.get('el')) ? q.get('el') : 'both');
  const env = createEnvironment({ quality });
  env.setFogDensity(scene.fog.density);
  scene.add(env.group);
  const ring = createRing({ quality });
  scene.add(ring.group, ring.motes);
  const particles = createParticles({ quality });
  scene.add(particles.group);

  // ---- lights -------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.55);
  const key = new THREE.DirectionalLight(0xffffff, 1.0);       // soft frontal key so face and torso read
  key.position.set(3.6, 3.2, 3.6);
  const fill = new THREE.DirectionalLight(0xffffff, 1.1);      // cool bounce from the water, front-left
  fill.position.set(-4.5, 0.6, 3.2);
  const back = new THREE.DirectionalLight(0xffffff, 3.2);      // the ring as a broad back light
  back.position.set(0, 2.2, -5);
  const rims = [[-RING.radius - 0.3, 1.5, -1.3], [RING.radius + 0.3, 1.5, -1.3], [0, RING.center.y + RING.radius + 0.4, -1.2]].map((p) => {
    const l = new THREE.PointLight(0xffffff, 30, 14, 2);
    l.position.set(...p);
    return l;
  });
  const shaft = new THREE.SpotLight(0xffffff, 150, 30, 0.3, 0.85, 1.6);
  shaft.position.set(0.6, 12, 2.2);
  shaft.target.position.set(0, 0.9, 0);
  shaft.castShadow = quality !== 'low';
  shaft.shadow.mapSize.setScalar(quality === 'high' ? 2048 : 1024);
  shaft.shadow.camera.near = 6; shaft.shadow.camera.far = 16;
  shaft.shadow.bias = -0.0003; shaft.shadow.normalBias = 0.035; shaft.shadow.focus = 0.72; shaft.shadow.radius = 4;
  const flameLight = new THREE.PointLight(0xffffff, 3, 6, 2);
  const impactLight = new THREE.PointLight(0xffffff, 0, 10, 2);
  scene.add(hemi, key, fill, back, ...rims, shaft, shaft.target, flameLight, impactLight);

  // ---- the dancer -----------------------------------------------------------
  const character = await Character.create();
  const dress = attachSecondary(character);
  scene.add(character.group);
  character.group.traverse((o) => { if (o.isMesh) { o.receiveShadow = quality !== 'low' && !o.isInstancedMesh; } });
  const performer = character.performer;
  const flameHand = character.rig.hands.L2, flameBone = character.body.byName['wrist.L2'];
  const flameLocal = flameHand.palmCenter.clone().multiplyScalar(0.85).addScaledVector(flameHand.palm0, 0.05);
  const flamePos = new THREE.Vector3();
  const _rimCool = new THREE.Color();

  const post = createPost(renderer, scene, camera, { quality });
  const rig = createCameraRig(camera, canvas, { reducedMotion });
  const audio = createAudio();

  const state = { paused: false, audio: false, camera: 'cinematic', element: palette.name };
  let time = 0, flash = 0, fade = still ? 1 : 0, introT = 0, prevYaw = 0;
  const _fwd = new THREE.Vector3();

  performer.onStamp((e) => {
    env.addImpact(e.position.x, e.position.z, time, e.strength);
    particles.stamp(e.position, e.strength, reducedMotion);
    ring.pulse(e.strength * 0.9, e.position);
    rig.impact(e.strength);
    flash = Math.max(flash, e.strength > 0.8 ? 0.7 : e.strength * 0.2);
    impactLight.position.set(e.position.x, 0.35, e.position.z + 0.3);
    impactLight.userData.v = Math.max(impactLight.userData.v ?? 0, e.strength);
    audio.stamp(e.strength);
  });

  const pixelScale = () => renderer.getDrawingBufferSize(new THREE.Vector2()).y * 0.0115;

  function step(dt) {
    time += dt;
    palette.update(dt);
    const P = palette.cur;
    character.update(time, dt);
    const I = performer.intensity;

    flamePos.copy(flameLocal).applyMatrix4(flameBone.matrixWorld);
    particles.flame(flamePos, performer.fx.flame, dt);
    particles.update(dt, P);
    // the dancer's turning rate drags the air (and the ring's flames) round with it
    _fwd.set(0, 0, 1).applyQuaternion(performer.pose.hipsRot);
    const yaw = Math.atan2(_fwd.x, _fwd.z);
    let dYaw = yaw - prevYaw; prevYaw = yaw;
    dYaw -= Math.round(dYaw / (2 * Math.PI)) * 2 * Math.PI;
    const spin = dt > 1e-3 ? dYaw / dt : 0;
    const pulse = ring.update(time, dt, P, 0.25 + 0.6 * I, pixelScale(), { spin, wind: performer.fx.wind });
    env.update(time, dt, P, camera, I * 0.6 + pulse * 0.25);

    // lights follow the elements and the dance
    scene.fog.color.copy(P.fog);
    hemi.color.copy(P.fill); hemi.intensity = 0.06;
    key.color.copy(P.key); key.intensity = 0.4 + 0.06 * I;
    fill.color.copy(P.fill); fill.intensity = 0.3;
    const ringPower = 0.5 + 0.32 * I + pulse * 0.25;
    // the ring's lights flicker with the lamps nearest them (left, right, top)
    back.color.copy(P.rim); back.intensity = 2.4 * ringPower * ring.light.total;
    rims.forEach((l, i) => { l.color.copy(P.rim); l.intensity = 26 * ringPower * [ring.light.left, ring.light.right, ring.light.top][i]; });
    shaft.color.copy(P.shaft); shaft.intensity = 44 + 10 * I;
    const flick = 0.8 + 0.2 * Math.sin(time * 23) * Math.sin(time * 17.3) + 0.1 * Math.sin(time * 41);
    flameLight.color.copy(P.flame); flameLight.position.copy(flamePos).y += 0.08;
    flameLight.intensity = (0.8 + 3.6 * performer.fx.flame) * flick;
    impactLight.userData.v = (impactLight.userData.v ?? 0) * Math.exp(-dt * 6);
    impactLight.color.copy(P.shock); impactLight.intensity = impactLight.userData.v * 4.5;
    dress.skin.userData.uniforms.uThirdEye.value = 0.2 + 0.7 * I + pulse * 0.8;
    dress.skin.userData.uniforms.uEmber.value.copy(P.flame);
    dress.eyeMat.userData.uniforms.uGlow.value = 0.03 * I + pulse * 0.1;
    // hair rim: warm from the ring behind, cool from the water light, so the jata reads against the dark hall
    dress.hair.rim.copy(P.fill).multiplyScalar(0.09 + 0.03 * I).add(_rimCool.copy(P.rim).multiplyScalar(0.025));
    dress.eyeMat.userData.uniforms.uEmber.value.copy(P.flame);

    rig.update(time, dt, performer);
    camera.updateMatrixWorld();
    post.haze(camera, RING.center, RING.radius, reducedMotion ? 0 : 0.012 * (0.8 + 0.4 * I + 0.3 * pulse));
    flash *= Math.exp(-dt * 4.5);
    const g = post.grade.uniforms;
    g.uTime.value = time; g.uFlash.value = reducedMotion ? 0 : flash;
    g.uShadow.value.copy(P.gradeShadow); g.uHigh.value.copy(P.gradeHigh);
    post.bloom.strength = 0.5 + 0.04 * I;
    audio.update(performer);
  }

  function resize() {
    const w = innerWidth, h = innerHeight, pr = basePR * prScale;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pr);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();
  rig.snap();

  // ---- UI ---------------------------------------------------------------------
  const ui = createUI({
    state,
    onPause() { state.paused = !state.paused; audio.suspend(state.paused); ui.sync(); },
    async onAudio() { state.audio = await audio.toggle(); ui.sync(); },
    onCamera() { state.camera = state.camera === 'cinematic' ? 'interactive' : 'cinematic'; rig.setMode(state.camera); ui.sync(); },
    onElement(id) { state.element = id; palette.set(id); ui.sync(); },
    onFullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); },
  });
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  // ---- loop -----------------------------------------------------------------
  let last = performance.now(), frames = 0, acc = 0;
  function frame(now) {
    const raw = (now - last) / 1000;
    last = now;
    const dt = Math.min(raw, 0.05);
    if (!state.paused) step(dt);
    else if (state.camera === 'interactive') rig.controls.update();
    if (!still) {
      introT += raw;
      fade = Math.min(1, fade + raw / 3.2);
      if (introT > 0.9 && introT < 6.2) titleEl.classList.add('show'); else titleEl.classList.remove('show');
    }
    post.grade.uniforms.uFade.value = fade * fade * (3 - 2 * fade);
    post.render(dt);
    // resolution governor: trade pixels for smoothness
    if (!still && !state.paused) {
      frames++; acc += raw;
      if (frames >= 90) {
        const avg = acc / frames;
        if (avg > 1 / 45 && prScale > 0.6) { prScale = Math.max(0.6, prScale - 0.12); resize(); }
        else if (avg < 1 / 58 && prScale < 1) { prScale = Math.min(1, prScale + 0.06); resize(); }
        frames = 0; acc = 0;
      }
    }
  }

  // warm-up: compile shaders before the reveal
  step(1 / 60);
  renderer.compile(scene, camera);

  // ---- dev / capture hooks ------------------------------------------------------
  window.__tandava = { character, performer, palette, rig, camera, renderer, scene, state, particles, env, ring, post };
  window.__seek = (beat, pre = 3) => {
    const t1 = beat * character.choreo.beat, t0 = t1 - pre;
    particles.clear(); env.clearImpacts();
    time = t0;
    character.seek(t0, 1);
    palette.snap();
    for (let t = t0; t < t1 - 1e-6; t += 1 / 60) step(1 / 60);
    rig.snap();
    step(1e-4);
    if (q.get('focus') === 'head' || q.get('focus') === 'chest') {
      // dev: portrait framing on the face (or on the chest, for the necklaces and sash)
      const fb = character.body.byName[q.get('focus') === 'chest' ? 'spine01' : 'head'];
      const h = new THREE.Vector3().setFromMatrixPosition(fb.matrixWorld);
      const d = +(q.get('dist') ?? 1.15);
      if (q.has('yaw')) {
        // yaw in degrees around the head from its own facing direction (90 = the figure's left profile)
        const f = new THREE.Vector3(0, 0, 1).transformDirection(fb.matrixWorld).setY(0).normalize();
        f.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(+q.get('yaw')));
        camera.position.set(h.x + f.x * d, h.y + 0.1, h.z + f.z * d);
      } else camera.position.set(h.x + d * 0.28, h.y + 0.1, h.z + d);
      camera.lookAt(h.x, h.y + 0.08, h.z);
    }
    post.grade.uniforms.uFade.value = 1;
    post.render(0);
    return `beat ${performer.beatPos.toFixed(2)} particles ${particles.alive}`;
  };

  if (q.has('sheet')) {
    // dev: contact sheet of several beats rendered through the full pipeline
    const beats = q.get('sheet').split(',').map(Number), cols = +(q.get('cols') ?? 3), rows = Math.ceil(beats.length / cols);
    const cv = document.createElement('canvas');
    cv.width = innerWidth; cv.height = innerHeight;
    cv.style.cssText = 'position:fixed;inset:0;z-index:10';
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d'), tw = innerWidth / cols, th = innerHeight / rows;
    ctx.font = '13px monospace'; ctx.fillStyle = '#fff';
    state.paused = true;
    rig.state.zoom = +(q.get('zoom') ?? 1);
    beats.forEach((b, i) => {
      window.__seek(b, +(q.get('pre') ?? 2.5));
      const x = (i % cols) * tw, y = Math.floor(i / cols) * th;
      ctx.drawImage(canvas, x, y, tw, th);
      ctx.fillText(String(b), x + 6, y + 16);
    });
    veil.classList.add('lifted'); veil.style.transition = 'none';
    window.__ready = true;
    return;
  }
  if (still) {
    state.paused = true;
    rig.state.zoom = +(q.get('zoom') ?? 1);
    window.__seek(+(q.get('beat') ?? 11.4));
    veil.classList.add('lifted');
    veil.style.transition = 'none';
    ui.sync();
  } else {
    if (reducedMotion) { window.__seek(12.6); state.paused = true; fade = 1; ui.sync(); ui.poke(); }
    else { time = 0; character.seek(0, 0.5); particles.clear(); env.clearImpacts(); }
    requestAnimationFrame(() => veil.classList.add('lifted'));
  }
  renderer.setAnimationLoop((now) => { if (!still) frame(now); });
  window.__ready = true;
}

start().catch((e) => { console.error(e); fail('Something went wrong while preparing the scene. Please reload the page.'); });
