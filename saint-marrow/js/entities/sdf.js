// Signed-distance-field sculpting → Surface Nets mesh → smooth skinning.
// Creatures are described as smooth unions of tapered capsules / ellipsoids attached to bones,
// which gives one continuous organic surface instead of box-shaped body parts.
import * as THREE from '../../lib/three.module.js';

export const smin = (a, b, k) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
export const smax = (a, b, k) => -smin(-a, -b, k);

// Round cone (capsule with different radii) between a and b.
export function sdRoundCone(px, py, pz, a, b, r1, r2) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

export function sdEllipsoid(px, py, pz, c, r) {
  const x = (px - c[0]) / r[0], y = (py - c[1]) / r[1], z = (pz - c[2]) / r[2];
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const x1 = x / r[0], y1 = y / r[1], z1 = z / r[2];
  const k1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1);
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
}

// prim: {type:'cone'|'ell', a,b,r1,r2 | c,r, bone, k (blend), sub (subtract), noise}
export function evalPrim(p, x, y, z) {
  if (p.type === 'cone') return sdRoundCone(x, y, z, p.a, p.b, p.r1, p.r2);
  if (p.type === 'plane') return (x - p.o[0]) * p.n[0] + (y - p.o[1]) * p.n[1] + (z - p.o[2]) * p.n[2];
  return sdEllipsoid(x, y, z, p.c, p.r);
}

function primBounds(p) {
  const pad = (p.k || 0) + 0.02;
  if (p.type === 'plane') return [-1e3, -1e3, -1e3, 1e3, 1e3, 1e3];
  if (p.type === 'cone') {
    const r = Math.max(p.r1, p.r2) + pad;
    return [Math.min(p.a[0], p.b[0]) - r, Math.min(p.a[1], p.b[1]) - r, Math.min(p.a[2], p.b[2]) - r, Math.max(p.a[0], p.b[0]) + r, Math.max(p.a[1], p.b[1]) + r, Math.max(p.a[2], p.b[2]) + r];
  }
  const r = p.r;
  return [p.c[0] - r[0] - pad, p.c[1] - r[1] - pad, p.c[2] - r[2] - pad, p.c[0] + r[0] + pad, p.c[1] + r[1] + pad, p.c[2] + r[2] + pad];
}

// Rasterise primitives into a distance grid, then extract a surface with naive Surface Nets.
export function buildSurface(prims, voxel, opts = {}) {
  let bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    if (p.sub || p.inter) continue;
    const b = primBounds(p);
    for (let i = 0; i < 3; i++) { bb[i] = Math.min(bb[i], b[i]); bb[i + 3] = Math.max(bb[i + 3], b[i + 3]); }
  }
  if (opts.clip) for (let i = 0; i < 6; i++) bb[i] = i < 3 ? Math.max(bb[i], opts.clip[i]) : Math.min(bb[i], opts.clip[i]);
  const ox = bb[0] - voxel * 2, oy = bb[1] - voxel * 2, oz = bb[2] - voxel * 2;
  const nx = Math.ceil((bb[3] - bb[0]) / voxel) + 5, ny = Math.ceil((bb[4] - bb[1]) / voxel) + 5, nz = Math.ceil((bb[5] - bb[2]) / voxel) + 5;
  const N = nx * ny * nz;
  const F = new Float32Array(N).fill(1);
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  for (const p of prims) {
    const b = primBounds(p);
    const i0 = Math.max(0, Math.floor((b[0] - ox) / voxel)), i1 = Math.min(nx - 1, Math.ceil((b[3] - ox) / voxel));
    const j0 = Math.max(0, Math.floor((b[1] - oy) / voxel)), j1 = Math.min(ny - 1, Math.ceil((b[4] - oy) / voxel));
    const k0 = Math.max(0, Math.floor((b[2] - oz) / voxel)), k1 = Math.min(nz - 1, Math.ceil((b[5] - oz) / voxel));
    for (let k = k0; k <= k1; k++) {
      const z = oz + k * voxel;
      for (let j = j0; j <= j1; j++) {
        const y = oy + j * voxel;
        let o = idx(i0, j, k);
        for (let i = i0; i <= i1; i++, o++) {
          const x = ox + i * voxel;
          let d = evalPrim(p, x, y, z);
          if (p.noise) d += p.noise(x, y, z);
          if (p.sub) F[o] = smax(F[o], -d, p.k || 0);
          else if (p.inter) F[o] = smax(F[o], d, p.k || 0);
          else F[o] = smin(F[o], d, p.k ?? 0.03);
        }
      }
    }
  }
  if (opts.post) {
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const o = idx(i, j, k);
      F[o] = opts.post(F[o], ox + i * voxel, oy + j * voxel, oz + k * voxel);
    }
  }
  // Surface nets
  const vmap = new Int32Array(N).fill(-1);
  const pos = [];
  const cornerOff = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const [a, b, d] = cornerOff[c];
      cv[c] = F[idx(i + a, j + b, k + d)];
      if (cv[c] < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [e0, e1] of edges) {
      const a = cv[e0], b = cv[e1];
      if ((a < 0) === (b < 0)) continue;
      const t = a / (a - b);
      const p0 = cornerOff[e0], p1 = cornerOff[e1];
      sx += p0[0] + (p1[0] - p0[0]) * t; sy += p0[1] + (p1[1] - p0[1]) * t; sz += p0[2] + (p1[2] - p0[2]) * t;
      cnt++;
    }
    vmap[idx(i, j, k)] = pos.length / 3;
    pos.push(ox + (i + sx / cnt) * voxel, oy + (j + sy / cnt) * voxel, oz + (k + sz / cnt) * voxel);
  }
  const ind = [];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = F[idx(i, j, k)];
    const inside = a < 0;
    // x edge
    { const b = F[idx(i + 1, j, k)]; if ((b < 0) !== inside) quad(vmap[idx(i, j - 1, k - 1)], vmap[idx(i, j, k - 1)], vmap[idx(i, j, k)], vmap[idx(i, j - 1, k)], inside); }
    { const b = F[idx(i, j + 1, k)]; if ((b < 0) !== inside) quad(vmap[idx(i - 1, j, k - 1)], vmap[idx(i - 1, j, k)], vmap[idx(i, j, k)], vmap[idx(i, j, k - 1)], inside); }
    { const b = F[idx(i, j, k + 1)]; if ((b < 0) !== inside) quad(vmap[idx(i - 1, j - 1, k)], vmap[idx(i, j - 1, k)], vmap[idx(i, j, k)], vmap[idx(i - 1, j, k)], inside); }
  }
  function quad(a, b, c, d, flip) {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) ind.push(a, b, c, a, c, d); else ind.push(a, c, b, a, d, c);
  }
  const P = new Float32Array(pos);
  // Laplacian smoothing to remove voxel stair-stepping
  const it = opts.smooth ?? 2;
  if (it > 0) {
    const nV = P.length / 3;
    const adj = new Array(nV);
    for (let v = 0; v < nV; v++) adj[v] = [];
    for (let t = 0; t < ind.length; t += 3) {
      const a = ind[t], b = ind[t + 1], c = ind[t + 2];
      adj[a].push(b, c); adj[b].push(a, c); adj[c].push(a, b);
    }
    const tmp = new Float32Array(P.length);
    for (let s = 0; s < it; s++) {
      for (let v = 0; v < nV; v++) {
        const n = adj[v];
        if (!n.length) { tmp[v * 3] = P[v * 3]; tmp[v * 3 + 1] = P[v * 3 + 1]; tmp[v * 3 + 2] = P[v * 3 + 2]; continue; }
        let x = 0, y = 0, z = 0;
        for (const u of n) { x += P[u * 3]; y += P[u * 3 + 1]; z += P[u * 3 + 2]; }
        const l = 0.5;
        tmp[v * 3] = P[v * 3] * (1 - l) + (x / n.length) * l;
        tmp[v * 3 + 1] = P[v * 3 + 1] * (1 - l) + (y / n.length) * l;
        tmp[v * 3 + 2] = P[v * 3 + 2] * (1 - l) + (z / n.length) * l;
      }
      P.set(tmp);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setIndex(ind);
  g.computeVertexNormals();
  return g;
}

// Skin weights from distance to each bone's primitives.
export function skinGeometry(geo, prims, boneIndex, sigma = 0.025) {
  const P = geo.attributes.position;
  const n = P.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const boneOf = prims.filter((p) => !p.sub && p.bone !== undefined);
  const nb = Object.keys(boneIndex).length;
  const acc = new Float32Array(nb);
  for (let v = 0; v < n; v++) {
    const x = P.getX(v), y = P.getY(v), z = P.getZ(v);
    acc.fill(0);
    let bestD = Infinity, bestB = 0;
    for (const p of boneOf) {
      const d = evalPrim(p, x, y, z);
      const b = boneIndex[p.bone];
      if (b === undefined) continue;
      const w = Math.exp(-Math.max(0, d) / (p.sigma || sigma)) * (p.w ?? 1);
      if (w > acc[b]) acc[b] = w;
      if (d < bestD) { bestD = d; bestB = b; }
    }
    // top 4
    const top = [];
    for (let b = 0; b < nb; b++) if (acc[b] > 1e-4) top.push([acc[b], b]);
    top.sort((a, b) => b[0] - a[0]);
    if (!top.length) top.push([1, bestB]);
    let s = 0;
    for (let k = 0; k < 4 && k < top.length; k++) s += top[k][0];
    for (let k = 0; k < 4; k++) {
      if (k < top.length) { si[v * 4 + k] = top[k][1]; sw[v * 4 + k] = top[k][0] / s; }
    }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}

// Triplanar detail + bump for skinned creature materials (rest-pose coordinates, so no swimming).
export function applyTriplanar(mat, detailMap, opts = {}) {
  const scale = opts.scale ?? 6.0;
  const bump = opts.bump ?? 0.012;
  const wet = opts.wet ?? 0;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tDetail = { value: detailMap };
    sh.uniforms.uDScale = { value: scale };
    sh.uniforms.uBump = { value: bump };
    sh.uniforms.uWound = { value: opts.wounds || [] };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest; varying vec3 vRestN; attribute float aWet; varying float vWet;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position; vRestN = normal; vWet = aWet;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tDetail; uniform float uDScale, uBump; varying vec3 vRest; varying vec3 vRestN; varying float vWet;
        float triH(vec3 p, vec3 w){ return texture2D(tDetail, p.zy*uDScale).r*w.x + texture2D(tDetail, p.xz*uDScale).r*w.y + texture2D(tDetail, p.xy*uDScale).r*w.z; }
        vec3 triC(vec3 p, vec3 w){ return texture2D(tDetail, p.zy*uDScale).rgb*w.x + texture2D(tDetail, p.xz*uDScale).rgb*w.y + texture2D(tDetail, p.xy*uDScale).rgb*w.z; }
        vec3 perturbN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
          vec3 vSigmaX = normalize(dFdx(surf_pos)); vec3 vSigmaY = normalize(dFdy(surf_pos)); vec3 vN = surf_norm;
          vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX); float fDet = dot(vSigmaX, R1) * faceDirection;
          vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2); return normalize(abs(fDet) * surf_norm - vGrad); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 tw = pow(abs(normalize(vRestN)), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
        vec3 dc = triC(vRest, tw);
        diffuseColor.rgb *= dc * 1.1;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float hh = triH(vRest, tw);
        normal = perturbN(-vViewPosition, normal, vec2(dFdx(hh), dFdy(hh)) * uBump * 60.0, faceDirection);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (0.85 + (1.0 - dc.r) * 0.6), 0.05, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.18, vWet);`);
  };
  mat.customProgramCacheKey = () => 'tri' + scale + '_' + bump + '_' + wet;
  return mat;
}
