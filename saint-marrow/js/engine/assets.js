// Loads photo-scanned PBR textures and CC0 props (Poly Haven), builds the material library.
import * as THREE from '../../lib/three.module.js';
import { GLTFLoader } from '../../lib/GLTFLoader.js';
import { MeshoptDecoder } from '../../lib/meshopt_decoder.module.js';

const TEX_DIR = 'assets/tex/';
const MODEL_DIR = 'assets/models/';

export const TEXTURE_SETS = [
  'long_white_tiles', 'peeling_painted_wall', 'decrepit_wallpaper', 'dirty_tiles', 'old_linoleum_flooring_01',
  'concrete_floor_worn_001', 'concrete_wall_006', 'polystyrene', 'wood_peeling_paint_weathered', 'wood_floor_worn',
  'rusty_metal_02', 'green_metal_rust', 'mud_forest', 'forest_ground_06', 'road_damaged', 'red_bricks_04', 'pine_bark',
  'waffle_pique_cotton',
];

export const MODELS = [
  'service_pistol', 'bolt_action_rifle_7_62', 'small_plastic_torch', 'crowbar_01', 'old_gas_mask', 'old_bed_frame', 'vintage_day_bed',
  'wheelchair_01', 'large_iron_gate', 'power_box_01', 'mounted_fluorescent_lights', 'caged_hanging_light', 'industrial_wall_lamp',
  'street_rat', 'dead_tree_trunk', 'covered_car', 'drawer_cabinet', 'metal_trash_can', 'medical_box', 'medical_tape', 'ammo_box',
  'clipboard', 'portable_cassette_player', 'vintage_radio_transceiver', 'bolt_cutters_01', 'metal_jerrycan', 'portable_generator',
  'painted_wooden_cabinet', 'painted_wooden_nightstand', 'metal_office_desk', 'steel_frame_shelves_02', 'metal_stool_01', 'metal_stool_02',
  'cardboard_box_01', 'wooden_crate_01', 'Barrel_01', 'trashbag', 'WetFloorSign_01', 'korean_fire_extinguisher_01', 'street_lamp_01',
  'metal_tool_chest', 'vintage_crutches_01', 'security_camera_01', 'wall_clock', 'Television_01', 'hand_truck', 'worn_metal_rack',
  'vintage_suitcase', 'painted_wooden_chair_01', 'painted_wooden_table', 'painted_wooden_bench', 'old_tyre', 'utility_box_01',
  'security_light', 'plastic_monobloc_chair_01', 'old_military_crate', 'propane_tank',
];

export class Assets {
  constructor(renderer) {
    this.renderer = renderer;
    this.texLoader = new THREE.TextureLoader();
    this.gltf = new GLTFLoader();
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
    this.tex = {};
    this.models = {};
    this.mats = {};
    this.aniso = 4;
    this.envIntensity = 0.12;
  }

  async loadAll(onProgress) {
    const jobs = [];
    for (const n of TEXTURE_SETS) jobs.push(() => this.loadTexSet(n));
    for (const m of MODELS) jobs.push(() => this.loadModel(m));
    let done = 0;
    const total = jobs.length;
    // limited parallelism keeps mobile memory spikes down
    const queue = jobs.slice();
    const worker = async () => {
      while (queue.length) {
        const j = queue.shift();
        try { await j(); } catch (e) { console.warn('asset failed', e); }
        done++;
        onProgress && onProgress(done / total);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  }

  loadTex(url, srgb) {
    return new Promise((res) => {
      this.texLoader.load(url, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = this.aniso;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        res(t);
      }, undefined, () => res(null));
    });
  }

  async loadTexSet(name) {
    const [map, nor, arm] = await Promise.all([
      this.loadTex(TEX_DIR + name + '_diff.webp', true),
      this.loadTex(TEX_DIR + name + '_nor.webp', false),
      this.loadTex(TEX_DIR + name + '_arm.webp', false),
    ]);
    this.tex[name] = { map, nor, arm };
  }

  async loadModel(name) {
    let g;
    if (window.__GLB_JSON__) {
      // hosts that cannot serve .glb get each model as base64 inside a .json file
      const r = await fetch(MODEL_DIR + name + '.glb.json');
      const { b64 } = await r.json();
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      g = await this.gltf.parseAsync(buf.buffer, MODEL_DIR);
    } else g = await this.gltf.loadAsync(MODEL_DIR + name + '.glb');
    const root = g.scene;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        const m = o.material;
        if (m) {
          m.envMapIntensity = this.envIntensity;
          if (m.map) m.map.anisotropy = this.aniso;
          // Poly Haven props are authored clean; darken slightly to sit in a dirty hospital
          if (m.color) m.color.multiplyScalar(0.9);
        }
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    this.models[name] = { root, box };
  }

  // Returns a fresh instance sharing geometry/material.
  model(name) {
    const m = this.models[name];
    if (!m) {
      const ph = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x555555 }));
      ph.position.y = 0.2;
      const g = new THREE.Group(); g.add(ph); return g;
    }
    return m.root.clone(true);
  }
  modelBox(name) { return this.models[name] ? this.models[name].box : new THREE.Box3(new THREE.Vector3(-0.2, 0, -0.2), new THREE.Vector3(0.2, 0.4, 0.2)); }

  // Build (and cache) a PBR material from a texture set. Repeat is in metres per tile.
  mat(name, opts = {}) {
    const key = name + JSON.stringify(opts);
    if (this.mats[key]) return this.mats[key];
    const t = this.tex[name] || {};
    const m = new THREE.MeshStandardMaterial({
      map: t.map || null,
      normalMap: opts.noNormal ? null : (t.nor || null),
      aoMap: t.arm || null,
      roughnessMap: t.arm || null,
      metalnessMap: opts.metal ? (t.arm || null) : null,
      roughness: opts.rough ?? 1,
      metalness: opts.metal ? 1 : 0,
      color: new THREE.Color(opts.color ?? 0xffffff),
      envMapIntensity: opts.env ?? this.envIntensity,
      side: opts.side ?? THREE.FrontSide,
    });
    if (m.normalMap) m.normalScale.set(opts.normalScale ?? 1, opts.normalScale ?? 1);
    m.aoMapIntensity = opts.ao ?? 1;
    if (opts.vertexColors) m.vertexColors = true;
    this.mats[key] = m;
    return m;
  }
}
