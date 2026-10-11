// Procedural sky: rendered ONCE into a cubemap (zero per-frame cost) which is
// used both as the visible background and, via PMREM, as image-based lighting.
import * as THREE from 'three';

const skyVert = /* glsl */`
  varying vec3 vDir;
  void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;

const skyFrag = /* glsl */`
  uniform vec3 topColor, horizonColor, groundColor, sunDir, sunColor; uniform float cloudAmt, sunSize, hazeAmt;
  varying vec3 vDir;
  float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
  float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
  float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<6;i++){ s+=a*vn(p); p=p*2.03+vec2(17.1,9.7); a*=0.5; } return s; }
  void main(){
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(horizonColor, topColor, pow(clamp(h,0.0,1.0), 0.5));
    col = mix(col, groundColor, smoothstep(0.0, -0.18, h));
    float sd = max(dot(d, normalize(sunDir)), 0.0);
    // atmospheric glow around sun + horizon haze
    col += sunColor * (pow(sd, 6.0) * 0.25 + pow(sd, 48.0) * 0.6) * hazeAmt;
    col = mix(col, horizonColor * 1.08, exp(-abs(h) * 9.0) * 0.35 * hazeAmt);
    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.18);
      float n = fbm(uv * 1.6 + vec2(3.0, 1.0));
      float n2 = fbm(uv * 4.7 + vec2(n * 1.3));
      float c = smoothstep(0.52, 0.85, n * 0.75 + n2 * 0.35) * cloudAmt * smoothstep(0.0, 0.2, h);
      vec3 cloudCol = mix(horizonColor * 1.25, vec3(1.0, 0.97, 0.92) * 1.6, 0.6) * (0.75 + 0.6 * pow(sd, 4.0));
      col = mix(col, cloudCol, c);
    }
    float disk = smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.6, sd);
    col += sunColor * disk * 40.0;
    gl_FragColor = vec4(col, 1.0);
  }`;

export const DEFAULT_ATMOS = {
  sunDir: [0.55, 0.62, -0.42], // direction TO the sun
  sunColor: '#ffe2b8',
  sunIntensity: 3.4,
  skyTop: '#3f74b8',
  skyHorizon: '#c6d4de',
  skyGround: '#c4a47a',
  envIntensity: 0.8,
  fogColor: '#cfcdc4',
  fogDensity: 0.0058,
  clouds: 0.55,
  exposure: 1.0,
};

export function makeSkyMaterial(a) {
  return new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(a.skyTop) },
      horizonColor: { value: new THREE.Color(a.skyHorizon) },
      groundColor: { value: new THREE.Color(a.skyGround) },
      sunDir: { value: new THREE.Vector3(...a.sunDir).normalize() },
      sunColor: { value: new THREE.Color(a.sunColor) },
      cloudAmt: { value: a.clouds },
      sunSize: { value: 0.0009 },
      hazeAmt: { value: 1.0 },
    },
    vertexShader: skyVert, fragmentShader: skyFrag,
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
}

// Bakes sky -> cubemap -> PMREM. Returns {background, environment, dispose}
export function bakeSky(renderer, atmos) {
  const a = { ...DEFAULT_ATMOS, ...(atmos || {}) };
  const scene = new THREE.Scene();
  const mat = makeSkyMaterial(a);
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), mat);
  scene.add(box);
  // sunny ground bounce disc so the env map lights undersides warmly
  const cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cam = new THREE.CubeCamera(0.1, 100, cubeRT);
  const oldTarget = renderer.getRenderTarget();
  cam.update(renderer, scene);
  // environment: a softer version without the huge sun disk energy
  mat.uniforms.sunSize.value = 0.02;
  mat.uniforms.hazeAmt.value = 1.4;
  const envCubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
  const envCam = new THREE.CubeCamera(0.1, 100, envCubeRT);
  // tone down sun disk for IBL (direct sun comes from the directional light)
  const sunCol = mat.uniforms.sunColor.value.clone();
  mat.uniforms.sunColor.value.multiplyScalar(0.06);
  envCam.update(renderer, scene);
  mat.uniforms.sunColor.value.copy(sunCol);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(envCubeRT.texture);
  pmrem.dispose();
  envCubeRT.dispose();
  renderer.setRenderTarget(oldTarget);
  box.geometry.dispose(); mat.dispose();
  return {
    background: cubeRT.texture,
    environment: env.texture,
    atmos: a,
    dispose() { cubeRT.dispose(); env.dispose(); },
  };
}
