// Workspaces (centre tabs) other than the always-present Scene view. Each: { id, label, fill?, create(app, el, shell) -> {show?, hide?} }
import materials from './materials.js';
import assets from './assets.js';

export const workspaceFactories = [assets, materials];
