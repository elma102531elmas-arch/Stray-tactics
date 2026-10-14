// Player profile + economy: coins, XP/levels, skin inventory, cases with drop
// odds, equipped skins and loadout. Persisted in localStorage.
import { store } from './settings.js';
import { SKINS, RARITIES, RARITY_ORDER, condition } from '../weapons/skins.js';
import { WEAPONS, PRIMARIES, SECONDARIES, KNIVES } from '../weapons/weapons.js';

export const START_COINS = 1500;
export const REWARDS = { win: 300, loss: 120, draw: 180, kill: 15, headshot: 5, xpWin: 120, xpLoss: 60, xpKill: 12 };

// default drop odds (%), Standoff/CS style
export const ODDS = { rare: 72, epic: 19, legendary: 6, arcane: 2.2, gold: 0.8 };

export const CASES = {
  origin: {
    name: 'Origin Case', price: 250, tint: ['#ffb43c', '#7a3d0c'],
    items: ['rifle_sand', 'rifle_carbon', 'm4_urban', 'sniper_forest', 'smg_desert', 'shotgun_rust', 'pistol_blue', 'pistol_candy', 'deagle_camo',
      'rifle_tiger', 'm4_ocean', 'sniper_frost', 'smg_toxic', 'deagle_marble',
      'rifle_neon', 'sniper_web', 'pistol_dopp', 'knife_fade',
      'rifle_fire', 'sniper_dragon', 'deagle_gold',
      'karambit_vanilla', 'butterfly_vanilla', 'm9_vanilla', 'karambit_fade', 'butterfly_marble', 'm9_dopp'],
  },
  inferno: {
    name: 'Inferno Case', price: 400, tint: ['#ff5a2a', '#5a0a0a'],
    items: ['rifle_carbon', 'm4_urban', 'smg_desert', 'shotgun_rust', 'deagle_camo', 'pistol_candy',
      'm4_ocean', 'smg_toxic', 'deagle_marble', 'rifle_tiger',
      'm4_gold', 'smg_royal', 'pistol_dopp', 'rifle_neon',
      'm4_hyper', 'shotgun_lava', 'rifle_fire',
      'karambit_dopp', 'karambit_tiger', 'butterfly_web', 'butterfly_damascus', 'm9_blue', 'm9_dopp'],
  },
  blade: {
    name: 'Blade Case', price: 1000, tint: ['#e4ae39', '#2a1c4a'], odds: { rare: 55, epic: 25, legendary: 12, arcane: 5, gold: 3 },
    items: ['rifle_sand', 'sniper_forest', 'smg_desert', 'deagle_camo', 'pistol_blue',
      'rifle_tiger', 'sniper_frost', 'deagle_marble',
      'm4_gold', 'smg_royal', 'sniper_web', 'knife_fade',
      'rifle_fire', 'm4_hyper', 'sniper_dragon', 'deagle_gold', 'shotgun_lava',
      'karambit_vanilla', 'karambit_fade', 'karambit_dopp', 'karambit_tiger', 'butterfly_vanilla', 'butterfly_marble', 'butterfly_web', 'butterfly_damascus', 'm9_vanilla', 'm9_dopp', 'm9_blue'],
  },
};

const KEY = 'profile';
const fresh = () => ({ v: 1, coins: START_COINS, xp: 0, inv: [], equip: {}, loadout: { primary: 'rifle', secondary: 'pistol', knife: 'knife' }, stats: { matches: 0, wins: 0, kills: 0, deaths: 0, hs: 0, opened: 0 } });

// wear buckets like CS: FN 3%, MW 24%, FT 33%, WW 24%, BS 16%
const WEAR_BUCKETS = [[0, 0.07, 3], [0.07, 0.15, 24], [0.15, 0.38, 33], [0.38, 0.45, 24], [0.45, 1, 16]];
function rollWear() {
  let r = Math.random() * 100;
  for (const [a, b, w] of WEAR_BUCKETS) { if ((r -= w) < 0) return +(a + Math.random() * (b - a)).toFixed(5); }
  return 0.3;
}
function weighted(obj) {
  const e = Object.entries(obj); let r = Math.random() * e.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of e) { if ((r -= w) < 0) return k; }
  return e[0][0];
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const level = (xp) => {
  let lv = 1, need = 500, left = xp;
  while (left >= need) { left -= need; lv++; need = 500 + (lv - 1) * 150; }
  return { level: lv, xp: left, need, frac: left / need };
};

class Profile {
  constructor() {
    const d = store.get(KEY, null);
    this.d = d && d.v === 1 ? { ...fresh(), ...d, loadout: { ...fresh().loadout, ...(d.loadout || {}) }, stats: { ...fresh().stats, ...(d.stats || {}) } } : fresh();
    this.d.inv = this.d.inv.filter((it) => SKINS[it.skin]);
    this.listeners = new Set();
  }
  save() { store.set(KEY, this.d); for (const f of this.listeners) f(this); }
  onChange(f) { this.listeners.add(f); return () => this.listeners.delete(f); }

  get coins() { return this.d.coins; }
  get level() { return level(this.d.xp); }
  get inventory() { return this.d.inv; }
  item(id) { return this.d.inv.find((it) => it.uid === id) || null; }

  // ------------------------------------------------------------ items
  itemValue(it) {
    const s = SKINS[it.skin]; if (!s) return 0;
    return Math.round(RARITIES[s.rarity].sell * (s.p === 'none' ? 1 : condition(it.wear).mul));
  }
  itemWeapon(it) { return SKINS[it.skin] ? SKINS[it.skin].weapon : null; }
  rollCase(caseId) {
    const c = CASES[caseId]; if (!c) return null;
    const odds = c.odds || ODDS;
    let rar = weighted(odds);
    let pool = c.items.filter((id) => SKINS[id] && SKINS[id].rarity === rar);
    // case without that rarity: step down until something exists
    for (let i = RARITY_ORDER.indexOf(rar); !pool.length && i > 0; i--) { rar = RARITY_ORDER[i - 1]; pool = c.items.filter((id) => SKINS[id] && SKINS[id].rarity === rar); }
    const skin = pool[Math.floor(Math.random() * pool.length)];
    return { uid: uid(), skin, wear: SKINS[skin].p === 'none' ? 0 : rollWear(), seed: Math.floor(Math.random() * 1000), t: Date.now(), from: caseId };
  }
  // pay and roll; the item is added to the inventory immediately
  openCase(caseId) {
    const c = CASES[caseId];
    if (!c || this.d.coins < c.price) return null;
    const it = this.rollCase(caseId);
    this.d.coins -= c.price;
    this.d.inv.unshift(it);
    this.d.stats.opened++;
    this.save();
    return it;
  }
  sell(id) {
    const it = this.item(id); if (!it) return 0;
    const v = this.itemValue(it);
    this.d.inv = this.d.inv.filter((x) => x !== it);
    for (const k in this.d.equip) if (this.d.equip[k] === id) delete this.d.equip[k];
    // sold the last copy of the selected knife: back to the default one
    if (!this.ownsKnife(this.d.loadout.knife)) this.d.loadout.knife = 'knife';
    this.d.coins += v;
    this.save();
    return v;
  }
  isEquipped(id) { return Object.values(this.d.equip).includes(id); }
  equipItem(id) {
    const it = this.item(id); if (!it) return;
    const w = this.itemWeapon(it);
    this.d.equip[w] = id;
    // equipping a gun/knife skin also puts that weapon into its loadout slot
    const slot = WEAPONS[w] && WEAPONS[w].slot;
    if (slot === 'primary') this.d.loadout.primary = w;
    else if (slot === 'pistol') this.d.loadout.secondary = w;
    else if (slot === 'knife') this.d.loadout.knife = w;
    this.save();
  }
  unequip(weapon) { delete this.d.equip[weapon]; if (KNIVES.includes(weapon) && weapon !== 'knife' && this.d.loadout.knife === weapon) this.d.loadout.knife = 'knife'; this.save(); }

  // ------------------------------------------------------------ loadout
  ownsKnife(kind) { return kind === 'knife' || this.d.inv.some((it) => this.itemWeapon(it) === kind); }
  loadout() {
    const l = this.d.loadout;
    return {
      primary: PRIMARIES.includes(l.primary) ? l.primary : 'rifle',
      secondary: SECONDARIES.includes(l.secondary) ? l.secondary : 'pistol',
      knife: KNIVES.includes(l.knife) && this.ownsKnife(l.knife) ? l.knife : 'knife',
    };
  }
  setLoadout(slot, kind) {
    if (slot === 'knife') {
      if (!this.ownsKnife(kind)) return false;
      // a knife you own but have not picked a skin for: use the first owned one
      if (kind !== 'knife' && !this.item(this.d.equip[kind])) { const it = this.d.inv.find((x) => this.itemWeapon(x) === kind); if (it) this.d.equip[kind] = it.uid; }
    }
    this.d.loadout[slot] = kind; this.save(); return true;
  }
  // skin descriptor for the viewmodel ({id, wear, seed}) or null
  skinFor(kind) {
    const it = this.item(this.d.equip[kind]);
    return it ? { id: it.skin, wear: it.wear, seed: it.seed } : null;
  }
  equippedItem(kind) { return this.item(this.d.equip[kind]); }

  // ------------------------------------------------------------ matches
  reward({ result, kills = 0, hs = 0, deaths = 0 }) {
    const R = REWARDS;
    const coins = (result === 'win' ? R.win : result === 'draw' ? R.draw : R.loss) + kills * R.kill + hs * R.headshot;
    const xp = (result === 'win' ? R.xpWin : R.xpLoss) + kills * R.xpKill;
    const before = level(this.d.xp).level;
    this.d.coins += coins; this.d.xp += xp;
    const st = this.d.stats; st.matches++; if (result === 'win') st.wins++; st.kills += kills; st.deaths += deaths; st.hs += hs;
    const after = level(this.d.xp).level;
    // level-up bonus
    const bonus = after > before ? (after - before) * 200 : 0;
    this.d.coins += bonus;
    this.save();
    return { coins: coins + bonus, xp, levelUp: after > before ? after : 0, bonus };
  }
  reset() { this.d = fresh(); this.save(); }
}

export const profile = new Profile();
