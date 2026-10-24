// The `game` object that playtest scripts get (DOM-free). Every method names the permission it needs; ApiRouter enforces it.
// Scripts change the PLAYTEST world only — never the map (they have no scene.write permission by design).
import { ApiError } from './plugins.js';

export const DOORS = ['open', 'close', 'toggle', 'lock', 'unlock'];
export const LIGHTS = ['on', 'off', 'flicker'];

export function gameMethods(world) {
  const name = (v, what) => { if (typeof v !== 'string' || !v.trim() || v.length > 80) throw new ApiError(`${what} must be text of 1–80 characters.`); return v; };
  const prim = (v) => { if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) return typeof v === 'string' ? v.slice(0, 200) : v; throw new ApiError('Flags hold text, numbers or true/false.'); };
  const count = (v) => { const n = v === undefined ? 1 : +v; if (!Number.isInteger(n) || n < 1 || n > 999) throw new ApiError('count must be a whole number from 1 to 999.'); return n; };
  return {
    'game.say': ['game.write', (c, [text, seconds]) => { c.says = (c.says || 0) + 1; if (c.says > 10) throw new ApiError('A script can show at most 10 messages per run.'); world.message(String(text).slice(0, 300), Math.min(20, Math.max(0.5, +seconds || 4))); return null; }],
    'game.setFlag': ['game.write', (c, [n, v]) => { world.runtime.setFlag(name(n, 'Flag name'), prim(v)); return null; }],
    'game.getFlag': ['game.read', (c, [n]) => world.runtime.state.flags[name(n, 'Flag name')] ?? null],
    'game.flags': ['game.read', () => ({ ...world.runtime.state.flags })],
    'game.emit': ['game.write', (c, [n]) => { c.emits = (c.emits || 0) + 1; if (c.emits > 20) throw new ApiError('A script can emit at most 20 events per run.'); world.runtime.emit(name(n, 'Event name')); return null; }],
    'game.giveItem': ['game.write', (c, [item, n]) => { const it = name(item, 'Item'); world.inventory[it] = (world.inventory[it] || 0) + count(n); return world.inventory[it]; }],
    'game.takeItem': ['game.write', (c, [item, n]) => { const it = name(item, 'Item'); world.inventory[it] = Math.max(0, (world.inventory[it] || 0) - count(n)); return world.inventory[it]; }],
    'game.countItem': ['game.read', (c, [item]) => world.inventory[name(item, 'Item')] || 0],
    'game.door': ['game.write', (c, [id, action]) => { if (!DOORS.includes(action)) throw new ApiError(`Door action must be one of: ${DOORS.join(', ')}.`); return world.setDoor(name(id, 'Door id'), action); }],
    'game.doorState': ['game.read', (c, [id]) => { const d = world.doors.get(name(id, 'Door id')); return d ? { open: d.open, locked: d.locked || '' } : null; }],
    'game.light': ['game.write', (c, [group, action]) => { if (!LIGHTS.includes(action)) throw new ApiError(`Light action must be one of: ${LIGHTS.join(', ')}.`); world.lights[name(group, 'Light group')] = action; return null; }],
    'game.objective': ['game.write', (c, [text]) => { world.objective = String(text).slice(0, 200); return null; }],
    'game.player': ['game.read', () => { const p = world.player; return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, hp: p.hp }; }],
    'game.time': ['game.read', () => world.time],
  };
}
