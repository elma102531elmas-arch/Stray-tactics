// Workspaces (centre tabs) other than the always-present Scene view. Each: { id, label, fill?, create(app, el, shell) -> {show?, hide?} }
import assets from './assets.js';
import materials from './materials.js';
import events from './events.js';
import enemies from './enemies.js';
import weapons from './weapons.js';

export const workspaceFactories = [events, enemies, weapons, assets, materials];
