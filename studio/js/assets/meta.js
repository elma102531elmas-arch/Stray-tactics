// Pure helpers for asset metadata (DOM-free, unit-tested).
//   meta.rawBounds  bounds of the file as authored; meta.bounds is what the scene uses: rawBounds * scale + pivot.

export function rawBoundsOf(meta) { return meta.rawBounds || meta.bounds; }

export function effectiveBounds(meta) {
  const raw = rawBoundsOf(meta);
  if (!raw) return null;
  const s = meta.scale || 1, p = meta.pivot || [0, 0, 0];
  const f = (a) => a.map((v, i) => Math.round((v * s + p[i]) * 10000) / 10000);
  return { min: f(raw.min), max: f(raw.max) };
}

/** Returns a new meta with scale/pivot applied and bounds refreshed. */
export function withTransform(meta, { scale, pivot }) {
  const out = { ...meta, rawBounds: rawBoundsOf(meta) };
  if (scale !== undefined) out.scale = scale;
  if (pivot !== undefined) out.pivot = pivot;
  out.bounds = effectiveBounds(out);
  return out;
}

export const PIVOT_PRESETS = {
  origin: { label: 'Keep authored origin', calc: () => [0, 0, 0] },
  bottomCenter: { label: 'Bottom centre', calc: (m) => { const r = rawBoundsOf(m), s = m.scale || 1; return [-(r.min[0] + r.max[0]) / 2 * s, -r.min[1] * s, -(r.min[2] + r.max[2]) / 2 * s]; } },
  center: { label: 'Centre of bounds', calc: (m) => { const r = rawBoundsOf(m), s = m.scale || 1; return [-(r.min[0] + r.max[0]) / 2 * s, -(r.min[1] + r.max[1]) / 2 * s, -(r.min[2] + r.max[2]) / 2 * s]; } },
};

/** Node props a freshly placed instance of this asset starts with. Existing instances are never changed by asset edits. */
export function placementProps(meta) {
  const props = { asset: meta.id };
  if (meta.collision && meta.collision !== 'auto-box') props.collision = meta.collision;
  if (meta.collision === 'custom' && meta.colliderCenter && meta.colliderSize) { props.colliderCenter = [...meta.colliderCenter]; props.colliderSize = [...meta.colliderSize]; }
  if (meta.attachedSounds?.length) props.sounds = JSON.parse(JSON.stringify(meta.attachedSounds));
  if (meta.interaction) props.interaction = JSON.parse(JSON.stringify(meta.interaction));
  if (meta.materialOverrides && Object.keys(meta.materialOverrides).length) props.materialOverrides = { ...meta.materialOverrides };
  return props;
}

/** Suggest which material slot each texture file belongs to from its name (diff/albedo -> map, nor -> normal, arm/orm -> packed ...). */
export function guessSlot(name) {
  const n = name.toLowerCase();
  if (/(^|[_\-. ])(nor|norm|normal|nrm|nor_gl)([_\-. ]|$)/.test(n)) return 'normalMap';
  if (/(^|[_\-. ])(arm|orm|rma|packed)([_\-. ]|$)/.test(n)) return 'ormMap';
  if (/(^|[_\-. ])(emis|emissive|emit|glow)([_\-. ]|$)/.test(n)) return 'emissiveMap';
  if (/(^|[_\-. ])(alpha|opacity|mask)([_\-. ]|$)/.test(n)) return 'alphaMap';
  if (/(^|[_\-. ])(diff|diffuse|albedo|basecolor|base_color|color|col)([_\-. ]|$)/.test(n)) return 'map';
  return null;
}
export function guessTextureSet(images) {
  const out = {};
  for (const m of images) { const slot = guessSlot(m.name); if (slot && !out[slot]) out[slot] = m.id; }
  return out;
}
