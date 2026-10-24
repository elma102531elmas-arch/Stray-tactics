// Shared geometry helpers. Geometry is built with world-scale (metre) UVs by box projection of local
// positions, so material `tiling` (repeats per metre) never stretches when an object is resized and
// adjacent pieces of one wall tile continuously.

import * as THREE from '../../lib/three.module.js';
import { mergeGeometries } from '../../lib/BufferGeometryUtils.js';

/** Rewrite UVs of a (non-indexed or indexed) geometry from local positions + normals. */
export function boxProjectUVs(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = geo.attributes.uv || new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (nx >= ny && nx >= nz) uv.setXY(i, z, y);
    else if (ny >= nz) uv.setXY(i, x, z);
    else uv.setXY(i, x, y);
  }
  geo.setAttribute('uv', uv);
  return geo;
}

export function boxMinMax(min, max) {
  const sx = Math.max(1e-4, max[0] - min[0]), sy = Math.max(1e-4, max[1] - min[1]), sz = Math.max(1e-4, max[2] - min[2]);
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  return boxProjectUVs(g);
}

export function mergeBoxes(boxes) {
  if (!boxes.length) return new THREE.BufferGeometry();
  const geos = boxes.map((b) => boxMinMax(b.min, b.max));
  const m = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return m;
}

export function terrainGeometry(p) {
  const n = p.cells;
  const g = new THREE.PlaneGeometry(p.size, p.size, n, n);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  // PlaneGeometry rows run +Z -> -Z after rotation; map vertex (ix,iz) explicitly from coordinates instead of index order
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const ix = Math.round(((x + p.size / 2) / p.size) * n), iz = Math.round(((z + p.size / 2) / p.size) * n);
    pos.setY(i, p.heights ? p.heights[iz * (n + 1) + ix] || 0 : 0);
  }
  g.computeVertexNormals();
  boxProjectUVs(g);
  return g;
}

/** Wire box (12 edges) as LineSegments. */
export function wireBox(min, max, color = 0xffffff, opacity = 1) {
  const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  const e = new THREE.EdgesGeometry(g);
  g.dispose();
  return new THREE.LineSegments(e, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: true }));
}
