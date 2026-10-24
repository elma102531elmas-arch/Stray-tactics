// Project container + versioned file format.
//   project.scene : SceneModel (the map)
//   project.data  : plain JSON for everything else (materials, assets manifest, events, sequences, ...)
// The on-disk/exported JSON is { format, version, meta, data, scene }.

import { SceneModel } from './scene.js';
import { uid, deepClone, isObj } from './util.js';
import { makeAssetLookup } from './builtin.js';
import { audioSettingsAssets, defaultAudioData } from './audio.js';
import { defaultStory } from './story.js';

export const FORMAT = 'saint-marrow-studio-project';
export const FORMAT_VERSION = 1;
export const STUDIO_VERSION = '0.1.0';

export function defaultSettings() {
  return {
    grid: { size: 0.5, snap: true },
    rotSnap: 15, rotSnapOn: false,
    scaleSnap: 0.1, scaleSnapOn: false,
    surfaceSnap: false,
    units: 'm',
  };
}

export function defaultEnvironment() {
  return {
    mapSize: [64, 64],
    fog: { color: '#0b0d10', density: 0.045 },
    ambient: { color: '#6a7684', groundColor: '#2a241e', intensity: 1.0 },
    exposure: 1.0,
    clearColor: '#0b0d10',
    outdoor: false,
    moon: { enabled: false, color: '#8fa3c8', intensity: 0.6, direction: [-0.4, 0.8, -0.6] },
    rain: false,
    reverb: 'room',
    ceilingHeight: 3,
  };
}

export function newProjectData() {
  return {
    environment: defaultEnvironment(),
    settings: defaultSettings(),
    materials: {},
    assets: {},
    libraries: {},
    prefabs: {},
    events: { graphs: {}, flags: {}, variables: {} },
    sequences: {},
    enemies: {},
    story: defaultStory(),
    plugins: {},
    scripts: {},
    weapons: {},
    audio: defaultAudioData(),
    issues: [],
    importReport: null,
  };
}

export class Project {
  constructor(name = 'Untitled map') {
    this.meta = { id: uid('proj'), name, created: new Date().toISOString(), modified: new Date().toISOString(), studioVersion: STUDIO_VERSION };
    this.scene = new SceneModel();
    this.data = newProjectData();
  }
  get ctx() { return { scene: this.scene, data: this.data, project: this }; }
  /** Context passed to geometry helpers (asset bounds lookup). */
  get geoCtx() { return { assets: makeAssetLookup(this.data.assets) }; }

  toJSON() {
    this.meta.modified = new Date().toISOString();
    return { format: FORMAT, version: FORMAT_VERSION, meta: deepClone(this.meta), data: deepClone(this.data), scene: this.scene.toJSON() };
  }

  static fromJSON(json) {
    const migrated = migrate(json);
    const p = new Project(migrated.meta?.name);
    p.meta = { ...p.meta, ...deepClone(migrated.meta || {}) };
    p.data = { ...newProjectData(), ...deepClone(migrated.data || {}) };
    // fill sub-objects added in later minor revisions
    p.data.environment = { ...defaultEnvironment(), ...p.data.environment };
    p.data.settings = { ...defaultSettings(), ...p.data.settings };
    p.scene = SceneModel.fromJSON(migrated.scene);
    return p;
  }
}

/** Upgrade older files to FORMAT_VERSION. Throws a readable error for files we cannot read. */
export const migrations = {
  // 0 -> 1: early prototype files stored `sceneNodes` and had no version field.
  0: (j) => {
    const out = { ...j, version: 1 };
    if (j.sceneNodes && !j.scene) { out.scene = { nodes: j.sceneNodes }; delete out.sceneNodes; }
    out.data = out.data || {};
    return out;
  },
};

export function migrate(json) {
  if (!isObj(json)) throw new Error('This is not a Saint Marrow Studio project (the file is not a JSON object).');
  if (json.format && json.format !== FORMAT) throw new Error(`Unrecognised file format "${json.format}". Expected "${FORMAT}".`);
  let v = typeof json.version === 'number' ? json.version : 0;
  if (v > FORMAT_VERSION) throw new Error(`This project was saved with a newer Studio (format v${v}). This version can read up to v${FORMAT_VERSION}. Update Saint Marrow Studio to open it.`);
  let cur = deepClone(json);
  while (v < FORMAT_VERSION) {
    const fn = migrations[v];
    if (!fn) throw new Error(`No migration available from project format v${v}.`);
    cur = fn(cur);
    v = cur.version;
  }
  if (!cur.scene || !Array.isArray(cur.scene.nodes)) throw new Error('The project file has no scene data.');
  return cur;
}

/** Collect every asset id referenced by the project (scene nodes, materials, sequences, scripts). */
export function referencedAssets(project) {
  const refs = new Map(); // assetId -> [where]
  const add = (id, where) => { if (id && typeof id === 'string') { if (!refs.has(id)) refs.set(id, []); refs.get(id).push(where); } };
  project.scene.walk((n) => {
    for (const [k, v] of Object.entries(n.props)) {
      if (typeof v === 'string' && (k === 'asset' || k === 'texture' || k === 'model' || k.startsWith('snd') || k === 'sndOpen')) add(v, `${n.name}.${k}`);
    }
    for (const s of n.props.sounds || []) add(s?.asset, `${n.name}.sounds`);
  });
  for (const [id, m] of Object.entries(project.data.materials)) {
    for (const k of ['map', 'normalMap', 'ormMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap']) add(m[k], `material ${m.name || id}.${k}`);
  }
  for (const [id, where] of audioSettingsAssets(project.data)) add(id, `audio ${where}`);
  for (const [id, seq] of Object.entries(project.data.sequences)) {
    for (const t of seq.tracks || []) for (const c of t.clips || []) if (c.asset) add(c.asset, `sequence ${seq.name || id}`);
  }
  return refs;
}
