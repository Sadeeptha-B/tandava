import * as THREE from 'three';

const NOISE3 = /* glsl */ `
float hash31(vec3 p){ p = fract(p * vec3(.1031,.1030,.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(hash31(i), hash31(i+vec3(1,0,0)), f.x), mix(hash31(i+vec3(0,1,0)), hash31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i+vec3(0,0,1)), hash31(i+vec3(1,0,1)), f.x), mix(hash31(i+vec3(0,1,1)), hash31(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 5.1; a *= .5; } return s; }
`;

export const RING = { center: new THREE.Vector3(0, 1.3, -0.75), radius: 1.46 };

// Prabha-mandala: the ring of cosmic fire framing the dancer.
export function createRing({ quality }) {
  const group = new THREE.Group();
  group.position.copy(RING.center);
  const R = RING.radius;
  const u = {
    uTime: { value: 0 }, uIntensity: { value: 0.5 }, uPulse: { value: 0 }, uR: { value: R },
    uCore: { value: new THREE.Color() }, uFlame: { value: new THREE.Color() }, uTip: { value: new THREE.Color() },
  };

  // flame band
  const band = new THREE.Mesh(new THREE.RingGeometry(R - 0.3, R + 1.25, 220, 6), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: u,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uIntensity, uPulse, uR; uniform vec3 uCore, uFlame, uTip; varying vec2 vP;
      ${NOISE3}
      void main(){
        float r = length(vP), x = r - uR;
        vec2 c = vP / r;
        float t = uTime;
        float power = min(uIntensity + uPulse * .3, 1.25);
        // flames are blown outward and slightly upward
        float lift = .5 + .5 * c.y;
        float n1 = fbm3(vec3(c * 5.5, x * 3.2 - t * (1.1 + power * .6)));
        float n2 = fbm3(vec3(c * 15., x * 8. - t * 2.4) + 7.);
        float n3 = fbm3(vec3(c * 34., x * 16. - t * 3.6) + 13.);
        float h = (.14 + 1.2 * n1 * n1) * (.45 + .6 * power) * (.75 + .5 * lift);
        float outer = x > 0. ? pow(clamp(1. - x / max(h, 1e-3), 0., 1.), 1.5) : 0.;
        float inner = x <= 0. ? exp(x * (26. - 10. * power)) : 0.;
        float body = (outer + inner * .8) * (.35 + .9 * n2) * (.6 + .6 * n3);
        float core = exp(-abs(x) * 55.);
        vec3 col = mix(uTip, uFlame, smoothstep(.02, .45, body));
        col = mix(col, uCore, smoothstep(.6, 1.4, body));
        col = col * min(body, 1.3) * (.95 + .45 * power) + uCore * core * (.7 + .6 * power);
        // filigree: fine bright threads woven through the flames
        float thread = smoothstep(.7, .98, n3) * exp(-abs(x - .06) * 9.);
        col += uCore * thread * .7 * power;
        gl_FragColor = vec4(col, 1.);
      }`,
  }));
  group.add(band);

  // bright thin core + two faint orbit lines
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
  const core = new THREE.Mesh(new THREE.TorusGeometry(R, 0.008, 6, 220), coreMat);
  group.add(core);
  const orbitMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const orbits = [0.955, 1.05].map((s, i) => {
    const o = new THREE.Mesh(new THREE.TorusGeometry(R * s, 0.004, 4, 200), orbitMat);
    o.rotation.set(0.05 * (i ? 1 : -1), 0.04 * (i ? -1 : 1), 0);
    group.add(o);
    return o;
  });

  // embers shed by the ring
  const NE = quality === 'low' ? 900 : quality === 'medium' ? 2000 : 3200;
  const seeds = new Float32Array(NE * 4);
  for (let i = 0; i < NE * 4; i++) seeds[i] = Math.random();
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NE * 3), 3));
  eg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const eu = { uTime: u.uTime, uIntensity: u.uIntensity, uPulse: u.uPulse, uR: u.uR, uColor: { value: new THREE.Color() }, uScale: { value: 1 } };
  const embers = new THREE.Points(eg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: eu,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; uniform float uTime, uIntensity, uPulse, uR, uScale; varying float vA;
      void main(){
        float rate = .12 + .2 * aSeed.z;
        float life = fract(uTime * rate + aSeed.x);
        float th = aSeed.y * 6.2832;
        vec2 c = vec2(cos(th), sin(th));
        float power = min(uIntensity + uPulse * .3, 1.25);
        vec3 p = vec3(c * (uR + .05), 0.);
        float rise = life * (1.0 + 2.6 * aSeed.z) * (.6 + power);
        p.xy += c * life * (.25 + .9 * aSeed.w);
        p.y += rise;
        p.x += sin(uTime * (.6 + aSeed.w) + aSeed.x * 40.) * .22 * life;
        p.z += (aSeed.w - .5) * 1.6 * life + cos(uTime * .8 + aSeed.y * 30.) * .15 * life;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        float tw = .6 + .4 * sin(uTime * (6. + aSeed.x * 9.) + aSeed.y * 50.);
        vA = smoothstep(0., .06, life) * pow(clamp(1. - life, 0., 1.), 1.6) * tw * (.35 + power) * step(aSeed.x, .35 + .65 * power);
        gl_PointSize = uScale * (1.2 + 3.2 * aSeed.z * aSeed.z) * (1. - life * .5) / -mv.z;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ vec2 d = gl_PointCoord - .5; float a = smoothstep(.5, .0, length(d)); gl_FragColor = vec4(uColor * a * a * vA * 2.4, 1.); }`,
  }));
  embers.frustumCulled = false;
  group.add(embers);

  // drifting luminous motes filling the hall
  const NM = quality === 'low' ? 300 : 900;
  const mp = new Float32Array(NM * 3), ms = new Float32Array(NM * 4);
  for (let i = 0; i < NM; i++) { mp[i * 3] = (Math.random() - 0.5) * 22; mp[i * 3 + 1] = Math.random() * 9; mp[i * 3 + 2] = -14 + Math.random() * 20; for (let k = 0; k < 4; k++) ms[i * 4 + k] = Math.random(); }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 4));
  const mu = { uTime: u.uTime, uColor: { value: new THREE.Color() }, uScale: eu.uScale, uIntensity: u.uIntensity };
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
    fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ float a = smoothstep(.5, 0., length(gl_PointCoord - .5)); gl_FragColor = vec4(uColor * a * a * vA * .55, 1.); }`,
  }));
  motes.frustumCulled = false;

  const state = { pulse: 0 };
  return {
    group, motes, uniforms: u,
    pulse(s) { state.pulse = Math.min(2.2, state.pulse + s); },
    update(time, dt, palette, intensity, pixelScale) {
      state.pulse *= Math.exp(-dt * 1.7);
      u.uTime.value = time;
      u.uIntensity.value = intensity;
      u.uPulse.value = state.pulse;
      u.uCore.value.copy(palette.ringCore); u.uFlame.value.copy(palette.ringFlame); u.uTip.value.copy(palette.ringTip);
      const k = 0.9 + intensity * 0.7 + state.pulse * 0.6;
      coreMat.color.copy(palette.ringCore).multiplyScalar(k);
      orbitMat.color.copy(palette.ringCore).multiplyScalar(0.8 + intensity);
      orbits[0].rotation.z = time * 0.05; orbits[1].rotation.z = -time * 0.035;
      eu.uColor.value.copy(palette.ember);
      eu.uScale.value = pixelScale;
      mu.uColor.value.copy(palette.water).lerp(palette.ember, 0.35);
      return state.pulse;
    },
  };
}
