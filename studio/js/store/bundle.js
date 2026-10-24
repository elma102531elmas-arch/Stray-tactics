// Project bundles (.smproj): a zip containing manifest.json, project.json and every imported asset file.
// Plain JSON (no binary assets) is also supported for diffing / version control.
import { zipSync, unzipSync, strToU8, strFromU8 } from '../../lib/fflate.module.js';
import { Project, FORMAT, FORMAT_VERSION, STUDIO_VERSION, migrate } from '../core/project.js';
import { sha256Hex } from '../core/util.js';

export const BUNDLE_EXT = '.smproj';
const safePath = (p) => !p.startsWith('/') && !p.split('/').includes('..') && !p.includes('\\');

export function projectToJSON(project) { return JSON.stringify(project.toJSON(), null, 1); }
export function projectFromJSON(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('The file is not valid JSON: ' + e.message); }
  return Project.fromJSON(j);
}

export async function exportBundle(project, storage, { onProgress } = {}) {
  const files = {};
  const manifest = { format: 'saint-marrow-studio-bundle', version: 1, projectFormat: FORMAT_VERSION, studioVersion: STUDIO_VERSION, created: new Date().toISOString(), name: project.meta.name, assets: [] };
  const json = project.toJSON();
  files['project.json'] = strToU8(JSON.stringify(json, null, 1));
  const missing = [];
  let i = 0;
  const assets = Object.values(project.data.assets);
  for (const a of assets) {
    const entry = { id: a.id, files: [], hash: a.hash };
    for (const f of a.files || [a.path]) {
      const blob = await storage.getBlob(`${project.meta.id}/${a.id}/${f}`);
      if (!blob) { missing.push(`${a.name}: ${f}`); continue; }
      const buf = new Uint8Array(await blob.arrayBuffer());
      files[`assets/${a.id}/${f}`] = [buf, { level: 0 }];
      entry.files.push(f);
    }
    manifest.assets.push(entry);
    onProgress?.(++i / assets.length);
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 1));
  const zipped = zipSync(files, { level: 6 });
  return { blob: new Blob([zipped], { type: 'application/zip' }), missing, bytes: zipped.length };
}

/** Returns { project, assetFilesStored, warnings }. Throws a readable Error for unusable files. */
export async function importBundle(input, storage) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  // plain JSON project?
  if (u8[0] === 0x7b /* { */) return { project: projectFromJSON(strFromU8(u8)), assetFilesStored: 0, warnings: ['Plain JSON project: it contains no imported asset files.'] };
  let entries;
  try { entries = unzipSync(u8); } catch (e) { throw new Error('This is not a valid Saint Marrow bundle (not a zip file or it is damaged): ' + e.message); }
  if (!entries['project.json']) throw new Error('The bundle has no project.json — it is not a Saint Marrow Studio project.');
  let manifest = null;
  if (entries['manifest.json']) { try { manifest = JSON.parse(strFromU8(entries['manifest.json'])); } catch { /* ignore broken manifest */ } }
  if (manifest && manifest.version > 1) throw new Error(`The bundle was written by a newer Studio (bundle v${manifest.version}). Please update Saint Marrow Studio.`);
  const project = projectFromJSON(strFromU8(entries['project.json']));
  const warnings = [];
  let stored = 0;
  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith('assets/')) continue;
    if (!safePath(path)) { warnings.push(`Skipped unsafe path "${path}".`); continue; }
    const key = `${project.meta.id}/${path.slice('assets/'.length)}`;
    await storage.putBlob(key, new Blob([data]));
    stored++;
  }
  // verify hashes of main files so corrupted bundles are reported, not silently used
  for (const a of Object.values(project.data.assets)) {
    const main = entries[`assets/${a.id}/${a.path}`];
    if (!main) { warnings.push(`Asset "${a.name}" is listed in the project but its file is missing from the bundle.`); continue; }
    if (a.hash && (await sha256Hex(main)) !== a.hash) warnings.push(`Asset "${a.name}" does not match its recorded checksum (the file changed or is damaged).`);
  }
  return { project, assetFilesStored: stored, warnings };
}
