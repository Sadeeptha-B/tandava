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
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uTime, uFade, uExposure, uFlash, uGrain; uniform vec3 uShadow, uHigh; varying vec2 vUv;
      vec3 aces(vec3 x){ return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
      float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
      void main(){
        vec2 c = vUv - .5;
        float r2 = dot(c, c);
        // gentle lens dispersion towards the corners
        vec2 off = c * r2 * .006;
        vec3 col = max(vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b), 0.);
        col *= uExposure * (1. + uFlash * .16);
        col = aces(col);
        // split toning: tinted shadows, warm highlights
        float l = dot(col, vec3(.2126, .7152, .0722));
        col += uShadow * (1. - smoothstep(0., .45, l));
        col *= mix(vec3(1.), uHigh, smoothstep(.4, 1., l));
        col = mix(vec3(l), col, 1.08);
        col *= 1. - smoothstep(.12, .78, r2) * .62;                      // vignette
        col = pow(max(col, 0.), vec3(1. / 2.2));
        col += (hash(vUv * 1000. + fract(uTime) * 61.) - .5) * uGrain;     // grain (also dithers the dark gradients)
        gl_FragColor = vec4(col * uFade, 1.);
      }`,
  });
  composer.addPass(grade);
  return {
    composer, bloom, grade,
    setSize(w, h, pr) { composer.setPixelRatio(pr); composer.setSize(w, h); },
    render(dt) { composer.render(dt); },
  };
}
