import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// HDR scene -> bloom -> filmic tone map, split-tone grade, vignette, grain.
export function createPost(renderer, scene, camera, { quality }) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.7, 0.5, 1.0);
  composer.addPass(bloom);
  const grade = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 0 }, uExposure: { value: 1.0 },
      uShadow: { value: new THREE.Color() }, uHigh: { value: new THREE.Color(1, 1, 1) }, uFlash: { value: 0 }, uGrain: { value: 0.035 },
      // heat haze over the fire ring: an affine map from screen uv to the ring plane (metres)
      uHaze: { value: 0 }, uHazeC: { value: new THREE.Vector2() }, uHazeA: { value: new THREE.Vector2() }, uHazeB: { value: new THREE.Vector2() },
      uHazeInv: { value: new THREE.Vector4() }, uHazeR: { value: 1 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uTime, uFade, uExposure, uFlash, uGrain; uniform vec3 uShadow, uHigh; varying vec2 vUv;
      uniform float uHaze, uHazeR; uniform vec2 uHazeC, uHazeA, uHazeB; uniform vec4 uHazeInv;
      vec3 aces(vec3 x){ return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
      float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 uv = vUv;
        if (uHaze > 0.) {
          // hot air rising off the flames: shimmer in the band just outside the ring, taller over the top of the arch
          vec2 d = uv - uHazeC;
          vec2 L = vec2(dot(uHazeInv.xy, d), dot(uHazeInv.zw, d));
          float r = length(L), s = L.y / max(r, 1e-3);
          float m = smoothstep(uHazeR - .02, uHazeR + .14, r) * (1. - smoothstep(uHazeR + .45, uHazeR + .75 + .55 * max(s, 0.), r)) * smoothstep(-.75, -.4, s);
          if (m > 0.) {
            vec2 q = L * vec2(14., 9.) - vec2(0., uTime * 3.2);
            vec2 o = vec2(vn(q), vn(q + vec2(5.2, 1.3))) - .5;
            o += .5 * (vec2(vn(q * 2.1 + 9.), vn(q * 2.1 + 3.7)) - .5);
            uv += (uHazeA * o.x + uHazeB * o.y) * m * uHaze;
          }
        }
        vec2 c = uv - .5;
        float r2 = dot(c, c);
        // gentle lens dispersion towards the corners
        vec2 off = c * r2 * .006;
        vec3 col = max(vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b), 0.);
        col *= uExposure * (1. + uFlash * .16);
        col = aces(col);
        // split toning: tinted shadows, warm highlights
        float l = dot(col, vec3(.2126, .7152, .0722));
        // half the tint is a floor (the hall stays turquoise), half follows the dark's own level so near forms can sit darker than the lit distance
        col += uShadow * (1. - smoothstep(0., .45, l)) * (.5 + .5 * smoothstep(0., .08, l));
        col *= mix(vec3(1.), uHigh, smoothstep(.4, 1., l));
        col = mix(vec3(l), col, 1.08);
        col *= 1. - smoothstep(.12, .78, r2) * .62;                      // vignette
        col = pow(max(col, 0.), vec3(1. / 2.2));
        col += (hash(vUv * 1000. + fract(uTime) * 61.) - .5) * uGrain;     // grain (also dithers the dark gradients)
        gl_FragColor = vec4(col * uFade, 1.);
      }`,
  });
  composer.addPass(grade);
  const gu = grade.uniforms;
  const _c = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3();
  const toUv = (v, out) => out.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
  return {
    /** heat haze over a vertical ring (centre, radius in metres, facing +z); strength in metres of apparent displacement */
    haze(camera, center, radius, strength) {
      _c.copy(center).project(camera);
      if (_c.z > 1) { gu.uHaze.value = 0; return; }
      toUv(_c, gu.uHazeC.value);
      _p.copy(center); _p.x += 1; _p.project(camera); toUv(_p, gu.uHazeA.value).sub(gu.uHazeC.value);
      _p.copy(center); _p.y += 1; _p.project(camera); toUv(_p, gu.uHazeB.value).sub(gu.uHazeC.value);
      const a = gu.uHazeA.value, b = gu.uHazeB.value, det = a.x * b.y - a.y * b.x;
      // fades out as the ring turns edge-on (the affine map degenerates)
      const facing = Math.abs(_n.subVectors(camera.position, center).normalize().z);
      if (Math.abs(det) < 1e-6 || facing < 0.2) { gu.uHaze.value = 0; return; }
      gu.uHazeInv.value.set(b.y / det, -b.x / det, -a.y / det, a.x / det);
      gu.uHazeR.value = radius;
      gu.uHaze.value = strength * THREE.MathUtils.smoothstep(facing, 0.2, 0.5);
    },
    composer, bloom, grade,
    setSize(w, h, pr) { composer.setPixelRatio(pr); composer.setSize(w, h); },
    render(dt) { composer.render(dt); },
  };
}
