import * as THREE from 'three';

const NOISE3 = /* glsl */ `
float hash31(vec3 p){ p = fract(p * vec3(.1031,.1030,.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(hash31(i), hash31(i+vec3(1,0,0)), f.x), mix(hash31(i+vec3(0,1,0)), hash31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i+vec3(0,0,1)), hash31(i+vec3(1,0,1)), f.x), mix(hash31(i+vec3(0,1,1)), hash31(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 5.1; a *= .5; } return s; }
`;

export const RING = { center: new THREE.Vector3(0, 1.3, -0.75), radius: 1.46 };

const H0 = 0.5;                     // nominal flame height (m)
const HW = 0.2;                     // flame billboard half-width (m), room for the glow and the sway
const MAX_WAVES = 6;
// the arch of fire runs from the water on one side, over the top, to the water on the other
const A0 = THREE.MathUtils.degToRad(-60), A1 = THREE.MathUtils.degToRad(240);

// cheap smooth 1D noise for the CPU side (flicker, draught); deterministic so stills are repeatable
const h1 = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const vn1 = (x) => { const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f); return h1(i) * (1 - s) + h1(i + 1) * s; };

// Prabha-mandala: the aureole of cosmic fire framing the dancer. No vessel and no fuel: the ring is a band of
// living light, and the fire grows from it. The tongues keep the iconographic rhythm (evenly set, radiating
// outward) but behave as fire does: they rise, lick, tear off at the tip, flicker and lean in the air.
export function createRing({ quality }) {
  const group = new THREE.Group();
  group.position.copy(RING.center);
  const R = RING.radius;
  const u = {
    uTime: { value: 0 }, uIntensity: { value: 0.5 }, uPulse: { value: 0 }, uR: { value: R },
    uCore: { value: new THREE.Color() }, uFlame: { value: new THREE.Color() }, uTip: { value: new THREE.Color() },
    uWaves: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4(0, 0, 99, 0)) },   // angle, strength, age
  };

  const NF = quality === 'low' ? 36 : quality === 'medium' ? 46 : 54;
  const step = (A1 - A0) / NF;
  const flames = Array.from({ length: NF }, (_, i) => {
    const a = A0 + (i + 0.5) * step + (h1(i * 3.71 + 0.4) - 0.5) * 0.5 * step;
    return {
      a, seed: h1(i * 7.13 + 2.1),
      // alternate large and small tongues, as in the cast aureoles, with some natural variety on top
      scale: (i % 2 ? 0.72 : 1.0) * (0.8 + 0.45 * h1(i * 5.31 + 1.7)),
      base: new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0.012),
      radial: new THREE.Vector3(Math.cos(a), Math.sin(a), 0),
      h: H0, bright: 1, gust: 0, lean: new THREE.Vector3(),
    };
  });

  // ------------------------------------------------------------------ the band of living light
  const bandU = { uTime: u.uTime, uCore: u.uCore, uFlame: u.uFlame, uWaves: u.uWaves, uPower: { value: 1 } };
  const band = new THREE.Mesh(new THREE.TorusGeometry(R, 0.042, 12, 420), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: bandU,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying float vFace;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uPower; uniform vec3 uCore, uFlame; uniform vec4 uWaves[${MAX_WAVES}];
      varying vec2 vUv; varying float vFace;
      ${NOISE3}
      void main(){
        float a = vUv.x * 6.2832, t = uTime;
        vec2 c = vec2(cos(a), sin(a));
        // currents of light streaming round the ring in both directions, braided through each other
        float f1 = fbm3(vec3(c * 7., vUv.y * 1.5 + t * .35) + vec3(t * .9, -t * .7, 0.));
        float f2 = fbm3(vec3(c * 19., vUv.y * 3. - t * .6) + vec3(-t * 1.6, t * 1.3, 5.));
        float flow = .28 + smoothstep(.42, .8, f1) * 1.2 + smoothstep(.5, .85, f2) * .8;
        // a stamp sends a pulse of light running up both sides from where the foot struck
        float wv = 0.;
        for (int i = 0; i < ${MAX_WAVES}; i++) {
          vec4 w = uWaves[i];
          float da = abs(mod(a - w.x + 3.14159, 6.28318) - 3.14159);
          float k = (da - w.z * 5.5) / .3;
          wv += w.y * exp(-k * k) * exp(-w.z * 1.3);
        }
        // (MSAA can extrapolate the varying slightly below zero at the silhouette; pow() of that is NaN)
        float face = clamp(vFace, 0., 1.);
        float core = pow(face, 1.4);
        vec3 col = mix(uFlame, uCore * 1.15 + .1, core * smoothstep(.3, 1.2, flow)) * (flow + wv * 2.) * (.3 + core * 1.1) * uPower;
        gl_FragColor = vec4(max(col, 0.) * smoothstep(0., .3, face), 1.);
      }`,
  }));
  band.renderOrder = 1;
  group.add(band);

  // ------------------------------------------------------------------ the sheet of fire the tongues grow out of
  // one continuous burning skirt along the band, so the tongues are joined at the root and only break apart higher up
  const skirtU = { uTime: u.uTime, uR: u.uR, uCore: u.uCore, uFlame: u.uFlame, uTip: u.uTip, uWaves: u.uWaves, uPower: { value: 1 } };
  const skirt = new THREE.Mesh(new THREE.RingGeometry(R - 0.08, R + 0.42, 360, 6), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: skirtU,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uR, uPower; uniform vec3 uCore, uFlame, uTip; uniform vec4 uWaves[${MAX_WAVES}]; varying vec2 vP;
      ${NOISE3}
      void main(){
        float r = length(vP), x = r - uR;
        vec2 c = vP / r;
        float arch = smoothstep(-.93, -.84, c.y);              // the fire ends at the water
        if (arch <= 0.) { gl_FragColor = vec4(0., 0., 0., 1.); return; }
        float t = uTime, a = atan(vP.y, vP.x);
        float wv = 0.;
        for (int i = 0; i < ${MAX_WAVES}; i++) {
          vec4 w = uWaves[i];
          float da = abs(mod(a - w.x + 3.14159, 6.28318) - 3.14159);
          float k = (da - w.z * 5.5) / .5;
          wv += w.y * exp(-k * k) * exp(-w.z * 1.3);
        }
        // fire streaming outward off the band; its ragged top edge is where the tongues break free
        float n = fbm3(vec3(c * 13., x * 7. - t * 2.4) + vec3(t * .15, -t * .2, 0.));
        float n2 = vnoise(vec3(c * 34., x * 16. - t * 3.8));
        float hgt = (.06 + .2 * n * n + .06 * wv) * (.8 + .3 * uPower);
        float d = x >= 0. ? 1. - x / hgt + (n2 - .5) * .5 : exp(x * 45.);
        float a1 = smoothstep(0., .22, d) * arch;
        float T = clamp(d, 0., 1.) * (.55 + .5 * n2) * (.8 + .3 * uPower);
        vec3 col = mix(uTip, uFlame, .35) * smoothstep(.0, .16, T);
        col = mix(col, uFlame, smoothstep(.1, .4, T));
        col = mix(col, uCore, smoothstep(.38, .75, T));
        gl_FragColor = vec4(col * a1 * (.25 + 1.1 * T * T), 1.);
      }`,
  }));
  skirt.position.z = 0.006;
  skirt.renderOrder = 1;
  group.add(skirt);

  // ------------------------------------------------------------------ fire
  const quad = new THREE.PlaneGeometry(2, 1, 1, 14).translate(0, 0.5, 0);
  const instBase = new THREE.InstancedBufferAttribute(new Float32Array(NF * 3), 3);
  const instSeed = new THREE.InstancedBufferAttribute(new Float32Array(NF), 1);
  const instDyn = new THREE.InstancedBufferAttribute(new Float32Array(NF * 4), 4).setUsage(THREE.DynamicDrawUsage);   // h, bright, lean.xy
  const instDyn2 = new THREE.InstancedBufferAttribute(new Float32Array(NF * 4), 4).setUsage(THREE.DynamicDrawUsage);  // lean.z
  flames.forEach((f, i) => { f.base.toArray(instBase.array, i * 3); instSeed.array[i] = f.seed; });
  const fg = new THREE.InstancedBufferGeometry();
  fg.index = quad.index;
  fg.setAttribute('position', quad.attributes.position);
  fg.setAttribute('aBase', instBase); fg.setAttribute('aSeed', instSeed);
  fg.setAttribute('aDyn', instDyn); fg.setAttribute('aDyn2', instDyn2);
  fg.instanceCount = NF;
  // cylindrical billboard: stays upright and turns about the vertical to face whichever camera renders it
  // (the water's reflection camera included), so the flames hold up when the camera orbits
  const fire = new THREE.Mesh(fg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: u,
    vertexShader: /* glsl */ `
      attribute vec3 aBase; attribute float aSeed; attribute vec4 aDyn; attribute vec4 aDyn2;
      varying vec2 vF; varying float vSeed, vBright, vEdge;
      void main(){
        vec3 base = (modelMatrix * vec4(aBase, 1.)).xyz;
        vec3 toCam = cameraPosition - base; toCam.y = 0.;
        vec3 right = normalize(cross(vec3(0., 1., 0.), toCam + vec3(1e-4, 0., 1e-4)));
        float h = aDyn.x;
        float v = mix(-.12, 1.5, position.y);                  // flame-space height: 0 at the root, 1 at the nominal tip
        float fw = .068 * sqrt(h / ${H0.toFixed(2)});              // half-width of the flame body (m)
        vec3 lean = vec3(aDyn.z, aDyn.w, aDyn2.x);
        float vv = max(v, 0.);
        vec3 wp = base + vec3(0., v * h, 0.) + right * position.x * ${HW.toFixed(2)} + lean * h * vv * vv;
        vF = vec2(position.x * ${HW.toFixed(2)} / fw, v);
        vEdge = ${HW.toFixed(2)} / fw;
        vSeed = aSeed; vBright = aDyn.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uCore, uFlame, uTip;
      varying vec2 vF; varying float vSeed, vBright, vEdge;
      ${NOISE3}
      void main(){
        float x = vF.x, v = vF.y;
        float t = uTime + vSeed * 31.7;
        // the gas accelerates as it rises, so its features stretch out towards the tip
        float vy = v * 2.3 / (1. + .9 * max(v, 0.));
        vec3 q = vec3(x * .42, vy * 1.7 - t * 2.6, t * .55 + vSeed * 7.);
        // the whole tongue wavers, more so towards the tip
        float sway = (vnoise(q) - .5) * (.35 + 3.4 * v * v) + (vnoise(q * 2.3 + 4.) - .5) * 1.1 * v;
        float xs = x + sway;
        // body: broad at the root, where it merges with its neighbours, tapering to a point
        float prof = (1. + .55 * (1. - smoothstep(.0, .32, v))) * pow(clamp(1. - (v - .18) / .9, 0., 1.), .85);
        float body = 1. - abs(xs) / (prof + .08);
        // licking turbulence decides the outline; it dominates near the tip, tearing off tongues and detached licks
        float n = fbm3(vec3(xs * 1.05, vy * 3.2 - t * 4.3, t * .9 + vSeed * 3.));
        float dens = body + (n - .5) * (.9 + 2.6 * v) - smoothstep(.6, 1.4, v) * 1.1;
        float a = smoothstep(0., .1, dens) * smoothstep(-.1, .02, v);
        // temperature: hottest at the root, cooling outward and upward
        float cone = exp(-xs * xs * 2.6) * exp(-abs(v - .08) * 4.);
        float T = min((pow(clamp(dens, 0., 1.), 1.4) * (1. - .62 * smoothstep(.0, 1.1, v)) * .78 + .32 * cone) * vBright, 1.05);
        // divine fire: the cool edge stays golden-amber rather than sooty red
        vec3 col = mix(uTip, uFlame, .35) * smoothstep(.0, .16, T);
        col = mix(col, uFlame, smoothstep(.1, .4, T));
        col = mix(col, uCore, smoothstep(.38, .7, T));
        col = mix(col, uCore * 1.3 + .22, smoothstep(.72, 1.05, T));
        vec3 e = col * a * (.3 + 1.4 * T * T);
        // soft halo of light around the tongue (the bloom pass adds the rest)
        float halo = exp(-length(vec2(x * .3, (v - .32) * 1.7)) * 2.6) * smoothstep(-.12, .0, v) * smoothstep(1.5, .9, v) * smoothstep(vEdge, vEdge * .55, abs(x));
        e += uFlame * halo * .03 * vBright;
        gl_FragColor = vec4(e, 1.);
      }`,
  }));
  fire.frustumCulled = false;
  fire.renderOrder = 2;
  group.add(fire);

  // ------------------------------------------------------------------ corona: light streaming out from the ring
  const glowU = { uGlow: { value: new THREE.Color() }, uR: u.uR, uTime: u.uTime };
  const corona = new THREE.Mesh(new THREE.RingGeometry(R - 0.5, R + 1.7, 200, 6), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: glowU,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uGlow; uniform float uR, uTime; varying vec2 vP;
      ${NOISE3}
      void main(){
        float r = length(vP), s = vP.y / r;
        vec2 c = vP / r;
        float x = r - uR;
        float base = exp(-abs(x) * (x > 0. ? 2.3 : 7.)) * smoothstep(-.98, -.82, s);
        if (base < .01) { gl_FragColor = vec4(0., 0., 0., 1.); return; }
        // fine rays drifting outward and slowly turning, like an eclipse corona
        float rays = fbm3(vec3(c * 9., x * .8 - uTime * .22) + vec3(uTime * .02, 0., 0.));
        rays = smoothstep(.35, .8, rays);
        float g = base * (.5 + 1.3 * rays * smoothstep(-.05, .35, x));
        gl_FragColor = vec4(uGlow * g, 1.);
      }`,
  }));
  corona.position.z = -0.03;
  corona.renderOrder = 0;
  group.add(corona);

  // ------------------------------------------------------------------ the cosmos glimpsed through the ring
  const cosmosU = { uTime: u.uTime, uR: u.uR, uNeb: { value: new THREE.Color() }, uNebA: { value: new THREE.Color() }, uNebB: { value: new THREE.Color() }, uGold: u.uFlame, uAmt: { value: 1 } };
  const cosmos = new THREE.Mesh(new THREE.CircleGeometry(R - 0.03, 120), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: cosmosU,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uR, uAmt; uniform vec3 uNeb, uNebA, uNebB, uGold; varying vec2 vP;
      ${NOISE3}
      void main(){
        float r = length(vP) / uR;
        // strongest towards the rim, thinning (not vanishing) behind the dancer
        float rim = (.1 + .9 * smoothstep(.35, .95, r)) * (1. - smoothstep(.97, 1., r));
        vec3 col = vec3(0.);
        {
          float n1 = fbm3(vec3(vP * 1.3, uTime * .015));
          float n2 = vnoise(vec3(vP * 3.1 + 9., uTime * .025));
          float neb = smoothstep(.36, .85, n1 * .8 + n2 * .35);
          // clouds drift through violet, magenta and the hall's teal; gold where the fire's light reaches in
          float hueN = vnoise(vec3(vP * .9 + 20., uTime * .01));
          vec3 hue = mix(uNebA, uNebB, smoothstep(.3, .72, hueN));
          hue = mix(hue, uNeb, smoothstep(.55, .85, n2) * .45);
          hue = mix(hue, uGold, smoothstep(.82, 1., r) * .45);
          // a faint veil: the hues are there, but only as a glimpse behind the fire
          float knot = smoothstep(.62, .9, n1);
          col = hue * neb * rim * (.11 + .14 * knot);
        }
        // sparse twinkling stars
        vec2 g = vP * 26.; vec2 id = floor(g);
        float hs = hash31(vec3(id, 3.));
        float tw = .5 + .5 * sin(uTime * (1. + 3. * hash31(vec3(id, 7.))) + hs * 60.);
        float star = step(.982, hs) * smoothstep(.22, .0, length(fract(g) - .5)) * tw;
        col += vec3(1., .93, .82) * star * (.25 + .75 * rim) * .9;
        gl_FragColor = vec4(col * uAmt, 1.);
      }`,
  }));
  cosmos.position.z = -0.06;
  cosmos.renderOrder = -1;
  group.add(cosmos);

  // ------------------------------------------------------------------ sparks: thrown up from the tongues, or carried round the ring
  const NE = quality === 'low' ? 600 : quality === 'medium' ? 1200 : 1900;
  const seeds = new Float32Array(NE * 4);
  for (let i = 0; i < NE * 4; i++) seeds[i] = Math.random();
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NE * 3), 3));
  eg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const tipsU = { value: Array.from({ length: NF }, () => new THREE.Vector4()) };   // group-local tip, w = gust
  const eu = { uTime: u.uTime, uIntensity: u.uIntensity, uPulse: u.uPulse, uR: u.uR, uTips: tipsU, uCore: u.uCore, uTip: u.uTip, uColor: { value: new THREE.Color() }, uScale: { value: 1 }, uDrift: { value: new THREE.Vector2() } };
  const embers = new THREE.Points(eg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: eu,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; uniform float uTime, uIntensity, uPulse, uScale, uR; uniform vec4 uTips[${NF}]; uniform vec2 uDrift;
      varying float vA, vL;
      void main(){
        vec4 tip = uTips[int(min(aSeed.y * ${NF}., ${NF - 1}.))];
        float power = min(uIntensity + uPulse * .3, 1.25);
        vec3 p;
        float life, gate;
        if (aSeed.z > .62) {
          // carried round the ring on its current, drifting slowly outward
          float rate = .08 + .1 * aSeed.w;
          life = fract(uTime * rate + aSeed.x);
          float dir = aSeed.x > .5 ? 1. : -1.;
          float ang = ${A0.toFixed(4)} + aSeed.y * ${(A1 - A0).toFixed(4)} + dir * life * (.6 + .9 * aSeed.w);
          float rr = uR + .03 + (.08 + .55 * aSeed.w * aSeed.w) * life;
          p = vec3(cos(ang) * rr, sin(ang) * rr + life * .15, (aSeed.y - .5) * .25 * life);
          gate = clamp((.3 + .5 * power - fract(aSeed.x * 7.31 + aSeed.w)) * 5., 0., 1.) * smoothstep(-1.32, -1.15, p.y);
        } else {
          // thrown up from a tongue: a buoyant climb that slows as the spark cools, wandering on the eddies
          float rate = .22 + .3 * aSeed.z;
          life = fract(uTime * rate + aSeed.x);
          float age = life / rate;
          float v0 = (.7 + 1.3 * aSeed.w) * (.7 + .5 * power + .8 * tip.w);
          p = tip.xyz;
          p.y += v0 * (1. - exp(-age * 1.1)) / 1.1;
          p.x += sin(age * (1.3 + aSeed.z * 2.) + aSeed.x * 40.) * .1 * age + uDrift.x * age + (aSeed.w - .5) * .3 * age;
          p.z += cos(age * (1.1 + aSeed.w * 2.) + aSeed.y * 30.) * .08 * age + uDrift.y * age;
          // a few always; a stamp's gust (tip.w) throws up a shower from the tongues it reaches
          gate = clamp((.2 + .3 * power + 1.6 * tip.w - fract(aSeed.x * 7.31 + aSeed.w)) * 5., 0., 1.);
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        float tw = .6 + .4 * sin(uTime * (6. + aSeed.x * 9.) + aSeed.y * 50.);
        vA = smoothstep(0., .05, life) * pow(1. - life, 1.4) * tw * gate;
        vL = life;
        gl_PointSize = uScale * (1.1 + 2.6 * aSeed.z * aSeed.z) * (1. - life * .55) / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uCore, uTip; varying float vA, vL;
      void main(){
        float a = smoothstep(.5, .0, length(gl_PointCoord - .5));
        // cools from white-gold through ember to a dull glow
        vec3 c = mix(uCore * 1.5 + .2, uColor, smoothstep(0., .3, vL));
        c = mix(c, mix(uTip, uColor, .4), smoothstep(.4, .95, vL));
        gl_FragColor = vec4(c * a * a * vA * 2.4, 1.);
      }`,
  }));
  embers.frustumCulled = false;
  embers.renderOrder = 4;
  group.add(embers);

  // ------------------------------------------------------------------ drifting luminous motes filling the hall
  const NM = quality === 'low' ? 300 : 900;
  const mp = new Float32Array(NM * 3), ms = new Float32Array(NM * 4);
  for (let i = 0; i < NM; i++) { mp[i * 3] = (Math.random() - 0.5) * 22; mp[i * 3 + 1] = Math.random() * 9; mp[i * 3 + 2] = -14 + Math.random() * 20; for (let k = 0; k < 4; k++) ms[i * 4 + k] = Math.random(); }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 4));
  const mu = { uTime: u.uTime, uColor: { value: new THREE.Color() }, uScale: eu.uScale, uIntensity: u.uIntensity, uLevel: { value: 1 } };
  const motes = new THREE.Points(mg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: mu,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; uniform float uTime, uScale, uIntensity; varying float vA;
      void main(){
        vec3 p = position;
        p.y = mod(p.y + uTime * (.04 + .12 * aSeed.x) * (.5 + uIntensity), 9.);
        p.x += sin(uTime * .2 + aSeed.y * 30.) * .5; p.z += cos(uTime * .17 + aSeed.z * 30.) * .5;
        vec4 mv = viewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        vA = (.25 + .75 * aSeed.w) * (.5 + .5 * sin(uTime * (1. + aSeed.x * 2.) + aSeed.z * 40.)) * smoothstep(0., .6, p.y) * smoothstep(9., 6., p.y);
        gl_PointSize = uScale * (1. + 2.5 * aSeed.w) / -mv.z;
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uLevel; varying float vA; void main(){ float a = smoothstep(.5, 0., length(gl_PointCoord - .5)); gl_FragColor = vec4(uColor * a * a * vA * .55 * uLevel, 1.); }`,
  }));
  motes.frustumCulled = false;

  // ------------------------------------------------------------------ simulation
  const state = { pulse: 0, spin: 0, waves: [] };
  const light = { left: 1, right: 1, top: 1, total: 1 };
  const _w = new THREE.Vector3(), _d = new THREE.Vector3();
  const TAU = Math.PI * 2;

  return {
    group, motes, uniforms: u, flames, light,
    /** brightness of the drifting motes (1 = normal); lowered while the flower shower owns the air */
    set motesLevel(k) { mu.uLevel.value = k; },
    /** a stamp: overall flare plus, when `position` is given, a gust that runs up both sides of the ring from the nearest point */
    pulse(s, position) {
      state.pulse = Math.min(2.2, state.pulse + s);
      if (position) {
        const a0 = Math.atan2(position.y - RING.center.y, position.x - RING.center.x);
        state.waves.push({ a0, s, age: 0, x: position.x, z: position.z });
        if (state.waves.length > MAX_WAVES) state.waves.shift();
      }
    },
    /** `spin`: the dancer's turning rate (rad/s, +y); `wind`: the choreography's wind level */
    update(time, dt, palette, intensity, pixelScale, { spin = 0, wind = 0.2 } = {}) {
      state.pulse *= Math.exp(-dt * 1.7);
      // the air in the hall only follows the spin slowly, and keeps turning a little after it stops
      state.spin += (THREE.MathUtils.clamp(spin, -12, 12) - state.spin) * (1 - Math.exp(-dt * 1.8));
      for (const w of state.waves) w.age += dt;
      state.waves = state.waves.filter((w) => w.age < 2.5);
      u.uWaves.value.forEach((v, i) => { const w = state.waves[i]; if (w) v.set(w.a0, w.s, w.age, 0); else v.set(0, 0, 99, 0); });
      u.uTime.value = time;
      u.uIntensity.value = intensity;
      u.uPulse.value = state.pulse;
      u.uCore.value.copy(palette.ringCore); u.uFlame.value.copy(palette.ringFlame); u.uTip.value.copy(palette.ringTip);
      const power = Math.min(intensity + state.pulse * 0.3, 1.25);
      const sway = 1 + wind * 1.5;
      // a slow common draught through the hall
      const gx = (vn1(time * 0.23) - 0.5) * 0.18 * sway, gz = (vn1(time * 0.19 + 40) - 0.5) * 0.1 * sway;
      let sl = 0, nl = 0, sr = 0, nr = 0, st = 0, nt = 0, sa = 0;
      const c = RING.center;
      flames.forEach((f, i) => {
        const sd = f.seed * 97, t = time;
        // flicker: a slow breathing plus a fast stutter, independent per tongue
        const fl = 0.7 + 0.38 * vn1(t * 4.1 + sd) + 0.14 * vn1(t * 12.7 + sd * 1.7);
        // gust: wave fronts running up the ring from where the foot struck
        let g = state.pulse * 0.12;
        _d.set(0, 0, 0);
        for (const w of state.waves) {
          let da = Math.abs(f.a - w.a0) % TAU; if (da > Math.PI) da = TAU - da;
          const k = w.s * Math.exp(-(((da - w.age * 5.5) / 0.5) ** 2)) * Math.exp(-w.age * 1.3);
          g += k;
          // pushes the tongue away from the stamp
          _w.set(f.base.x + c.x - w.x, f.base.y + c.y, f.base.z + c.z - w.z).normalize();
          _d.addScaledVector(_w, k);
        }
        g = 1 - Math.exp(-g);                    // a tongue can only flare so far, however hard the stamp
        f.gust = g;
        f.h = H0 * f.scale * (0.62 + 0.42 * power) * (0.86 + 0.28 * vn1(t * 1.2 + sd * 3)) * (1 + 0.45 * g) * (0.92 + 0.16 * fl);
        f.bright = fl * (0.74 + 0.2 * Math.min(power, 1)) * (1 + 0.3 * g);
        // lean: radiating outward from the ring (the aureole), own eddies, the hall draught,
        // the swirl dragged round by the spin, and the gust
        const px = f.base.x + c.x, pz = f.base.z + c.z;
        f.lean.copy(f.radial).multiplyScalar(0.32).add(_w.set(
          gx + (vn1(t * 0.7 + sd) - 0.5) * 0.22 * sway + state.spin * pz * 0.045,
          0,
          gz + (vn1(t * 0.6 + sd + 17) - 0.5) * 0.12 * sway - state.spin * px * 0.045,
        )).addScaledVector(_d, 0.28);
        f.lean.y = Math.max(f.lean.y, -0.12);
        const lm = f.lean.length();
        if (lm > 0.75) f.lean.multiplyScalar(0.75 / lm);
        const i4 = i * 4;
        instDyn.array[i4] = f.h; instDyn.array[i4 + 1] = f.bright; instDyn.array[i4 + 2] = f.lean.x; instDyn.array[i4 + 3] = f.lean.y;
        instDyn2.array[i4] = f.lean.z;
        tipsU.value[i].set(f.base.x + f.lean.x * f.h * 0.6, f.base.y + f.h * 0.75 + f.lean.y * f.h * 0.6, f.base.z + f.lean.z * f.h * 0.6, g);
        // the flicker that reaches the scene lights (relative to a steady flame)
        const out = (fl / 0.96) * (1 + 0.3 * g) * (1 + 0.45 * g);
        sa += out;
        if (f.base.x < -0.5) { sl += out; nl++; }
        if (f.base.x > 0.5) { sr += out; nr++; }
        if (f.base.y > 0.9) { st += out; nt++; }
      });
      instDyn.needsUpdate = instDyn2.needsUpdate = true;
      light.left = sl / nl; light.right = sr / nr; light.top = st / nt; light.total = sa / NF;
      bandU.uPower.value = (0.5 + 0.25 * power) * (0.85 + 0.15 * light.total);
      skirtU.uPower.value = power * (0.85 + 0.15 * light.total);
      glowU.uGlow.value.copy(palette.ringFlame).lerp(palette.ringCore, 0.3).multiplyScalar(0.045 * (0.7 + 0.5 * power) * light.total);
      cosmosU.uNeb.value.copy(palette.water);
      cosmosU.uNebA.value.copy(palette.nebA); cosmosU.uNebB.value.copy(palette.nebB);
      cosmosU.uAmt.value = 0.7 + 0.4 * intensity;
      eu.uColor.value.copy(palette.ember);
      eu.uScale.value = pixelScale;
      eu.uDrift.value.set(gx * 0.6 + state.spin * 0.02, gz * 0.6);
      mu.uColor.value.copy(palette.water).lerp(palette.ember, 0.35);
      return state.pulse;
    },
  };
}
