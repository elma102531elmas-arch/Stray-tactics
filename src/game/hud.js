// DOM HUD: score bar + timer, radar, killfeed, crosshair, hit/damage
// indicators, HP, ammo, weapon icons, scope overlay, scoreboard, death screen.
import * as THREE from 'three';
import { el } from '../core/util.js';
import { settings } from '../core/settings.js';
import { buildWorldWeapon } from '../weapons/models.js';
import { TEAMS } from './character.js';
import { WEAPONS } from '../weapons/weapons.js';

// render white silhouettes of the real weapon models for UI icons
const ICONS = {};
export async function makeWeaponIcons(renderer) {
  const W = 256, H = 96;
  const rt = new THREE.WebGLRenderTarget(W, H);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.19, -0.19, 0.01, 10);
  cam.position.set(2, 0, 0); cam.lookAt(0, 0, 0);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const id of ['rifle', 'sniper', 'pistol', 'knife']) {
    const m = await buildWorldWeapon(id);
    m.material = mat;
    const box = new THREE.Box3().setFromObject(m); const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const s = Math.min(0.94 / size.z, 0.34 / size.y);
    m.scale.setScalar(s); m.position.set(0, -c.y * s, -c.z * s);
    scene.add(m);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam); renderer.setRenderTarget(prev);
    const px = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d'); const id2 = x.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) { const s0 = ((H - 1 - y) * W + i) * 4, d0 = (y * W + i) * 4; const a = px[s0 + 3]; id2.data[d0] = 255; id2.data[d0 + 1] = 255; id2.data[d0 + 2] = 255; id2.data[d0 + 3] = a; }
    x.putImageData(id2, 0, 0);
    ICONS[id] = cv.toDataURL();
    scene.remove(m);
  }
  renderer.setClearColor(0x000000, 1);
  rt.dispose();
  return ICONS;
}
export const weaponIcon = (id) => ICONS[id] || '';

export class HUD {
  constructor(root) {
    this.root = el('div', { class: 'hud' });
    root.appendChild(this.root);
    const r = this.root;
    this.top = el('div', { class: 'hud-top' },
      this.sA = el('div', { class: 'score s0' }, '0'), this.timer = el('div', { class: 'timer' }, '5:00'), this.sB = el('div', { class: 'score s1' }, '0'));
    this.radar = el('canvas', { class: 'radar', width: 180, height: 180 });
    this.feed = el('div', { class: 'killfeed' });
    this.cross = el('div', { class: 'crosshair' }, ...[0, 1, 2, 3, 4].map(() => el('i')));
    this.hitm = el('div', { class: 'hitmarker' }, ...[0, 1, 2, 3].map(() => el('i')));
    this.dmgWrap = el('div', { class: 'dmg-ind' });
    this.center = el('div', { class: 'center-msg' });
    this.hp = el('div', { class: 'hp' }, el('span', { class: 'hp-ico' }, '✚'), this.hpNum = el('b', {}, '100'), el('div', { class: 'hp-bar' }, this.hpFill = el('i')));
    this.ammoBox = el('div', { class: 'ammo' }, this.wIcon = el('img', { class: 'w-icon', alt: '' }), el('div', { class: 'ammo-nums' }, this.mag = el('b', {}, '30'), el('span', {}, ' / '), this.res = el('span', { class: 'res' }, '90')), this.wName = el('div', { class: 'w-name' }, ''));
    this.slots = el('div', { class: 'slots' });
    this.scope = el('div', { class: 'scope' }, el('div', { class: 'scope-ring' }), el('i', { class: 'h' }), el('i', { class: 'v' }));
    this.board = el('div', { class: 'scoreboard' });
    this.death = el('div', { class: 'death' });
    this.fps = el('div', { class: 'fps' });
    this.reloadBar = el('div', { class: 'reload-bar' }, el('i'));
    r.append(this.top, this.radar, this.feed, this.cross, this.hitm, this.dmgWrap, this.center, this.hp, this.ammoBox, this.slots, this.scope, this.board, this.death, this.fps, this.reloadBar);
    this.rctx = this.radar.getContext('2d');
    this.spreadPx = 0;
    this.applyCrosshair();
    this.hitT = 0;
  }
  show(on) { this.root.style.display = on ? 'block' : 'none'; }
  destroy() { this.root.remove(); }

  applyCrosshair() {
    const c = settings.crosshair;
    const bars = this.cross.children;
    for (let i = 0; i < 5; i++) {
      const b = bars[i];
      b.style.background = c.color;
      b.style.boxShadow = c.outline ? '0 0 0 1px rgba(0,0,0,.85)' : 'none';
    }
    bars[4].style.display = c.dot ? 'block' : 'none';
    this.layoutCrosshair(0);
  }
  layoutCrosshair(extra) {
    const c = settings.crosshair, b = this.cross.children, g = c.gap + (c.dynamic ? extra : 0), L = c.size, T = c.thick;
    const set = (e, x, y, w, h) => { e.style.left = x + 'px'; e.style.top = y + 'px'; e.style.width = w + 'px'; e.style.height = h + 'px'; };
    set(b[0], -T / 2, -g - L, T, L); set(b[1], -T / 2, g, T, L); set(b[2], -g - L, -T / 2, L, T); set(b[3], g, -T / 2, L, T); set(b[4], -T / 2, -T / 2, T, T);
  }

  buildRadarMap(world) {
    const b = world.map.bounds; const pad = 6;
    this.mapMin = { x: b[0] - pad, z: b[1] - pad };
    const PPM = 3;
    const w = Math.ceil((b[2] - b[0] + pad * 2) * PPM), h = Math.ceil((b[3] - b[1] + pad * 2) * PPM);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    x.fillStyle = 'rgba(30,26,20,0.55)'; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(205,190,160,0.30)'; x.fillRect(pad * PPM, pad * PPM, (b[2] - b[0]) * PPM, (b[3] - b[1]) * PPM);
    for (const c of world.collision.colliders) {
      if (c.maxY < 0.9 || c.minY > 2.5) continue;
      x.save(); x.translate((c.cx - this.mapMin.x) * PPM, (c.cz - this.mapMin.z) * PPM); x.rotate(-c.yaw);
      x.fillStyle = c.maxY > 3 ? 'rgba(20,18,15,0.9)' : 'rgba(60,54,44,0.85)';
      if (c.type === 'cyl') { x.beginPath(); x.arc(0, 0, c.r * PPM, 0, Math.PI * 2); x.fill(); } else x.fillRect(-c.hx * PPM, -c.hz * PPM, c.hx * 2 * PPM, c.hz * 2 * PPM);
      x.restore();
    }
    this.radarMap = cv; this.PPM = PPM;
  }
  drawRadar(game) {
    const x = this.rctx, me = game.player, S = 180, R = S / 2;
    x.clearRect(0, 0, S, S);
    x.save(); x.beginPath(); x.arc(R, R, R - 2, 0, Math.PI * 2); x.clip();
    x.fillStyle = 'rgba(10,12,14,0.55)'; x.fillRect(0, 0, S, S);
    const zoom = 1.25;
    x.translate(R, R); x.rotate(me.yaw); x.scale(zoom, zoom);
    if (this.radarMap) x.drawImage(this.radarMap, -(me.pos.x - this.mapMin.x) * this.PPM, -(me.pos.z - this.mapMin.z) * this.PPM);
    for (const a of game.actors) {
      if (a === me || !a.alive) continue;
      const friend = a.team === me.team;
      if (!friend && game.time - (a.spottedT || -10) > 1.6) continue;
      const px = (a.pos.x - me.pos.x) * this.PPM, pz = (a.pos.z - me.pos.z) * this.PPM;
      x.fillStyle = friend ? TEAMS[me.team].color : '#ff3b3b';
      x.beginPath(); x.arc(px, pz, 3.6 / zoom, 0, Math.PI * 2); x.fill();
    }
    x.restore();
    // player arrow
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(R, R - 7); x.lineTo(R + 5, R + 5); x.lineTo(R, R + 2); x.lineTo(R - 5, R + 5); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 2; x.beginPath(); x.arc(R, R, R - 2, 0, Math.PI * 2); x.stroke();
  }

  weaponChanged(p) {
    const g = p.gun, d = g.def;
    this.wIcon.src = weaponIcon(d.id); this.wName.textContent = d.name;
    this.ammo(p);
    this.slots.innerHTML = '';
    [['primary', '1'], ['pistol', '2'], ['knife', '3']].forEach(([s, k]) => {
      const gg = p.guns[s]; if (!gg) return;
      const b = el('div', { class: 'slot' + (p.slot === s ? ' on' : '') }, el('span', {}, k), el('img', { src: weaponIcon(gg.def.id), alt: '' }));
      b.addEventListener('click', () => p.equip(s)); b.addEventListener('touchstart', (e) => { e.preventDefault(); p.equip(s); }, { passive: false });
      this.slots.appendChild(b);
    });
  }
  ammo(p) {
    const g = p.gun, d = g.def;
    if (d.melee) { this.mag.textContent = '∞'; this.res.textContent = ''; this.ammoBox.classList.remove('low'); return; }
    this.mag.textContent = g.mag; this.res.textContent = g.reserve;
    this.ammoBox.classList.toggle('low', g.mag <= Math.ceil(d.mag * 0.2));
  }
  shotFired(spread) { this.spreadPx = Math.min(40, this.spreadPx + spread * 400 + 2); }
  hit(head, kill) {
    this.hitm.className = 'hitmarker show' + (head ? ' head' : '') + (kill ? ' kill' : '');
    this.hitT = 0.18;
  }
  damaged(p, attacker, dir) {
    if (!attacker || !attacker.pos) return;
    const d = attacker.pos.clone().sub(p.pos);
    const ang = Math.atan2(d.x, -d.z) + p.yaw; // relative to view
    const ind = el('i', { style: { transform: `rotate(${ang}rad)` } });
    this.dmgWrap.appendChild(ind);
    setTimeout(() => ind.remove(), 900);
  }
  killfeed(killer, victim, weapon, head) {
    const kc = killer ? TEAMS[killer.team].color : '#bbb', vc = TEAMS[victim.team].color;
    const row = el('div', { class: 'kf' + (killer && killer.isLocal || victim.isLocal ? ' me' : '') },
      killer ? el('b', { style: { color: kc } }, killer.name) : '',
      el('img', { src: weaponIcon(weapon) || '', alt: '' }),
      head ? el('span', { class: 'hs' }, '⌖') : '',
      el('b', { style: { color: vc } }, victim.name));
    this.feed.appendChild(row);
    setTimeout(() => { row.classList.add('out'); setTimeout(() => row.remove(), 400); }, 5000);
    while (this.feed.children.length > 5) this.feed.firstChild.remove();
  }
  message(txt, sub, ms = 1800) {
    this.center.innerHTML = '';
    this.center.append(el('h2', {}, txt), sub ? el('p', {}, sub) : '');
    this.center.classList.add('show');
    clearTimeout(this._mt); this._mt = setTimeout(() => this.center.classList.remove('show'), ms);
  }
  showDeath(killer, weapon, head, t) {
    this.death.innerHTML = '';
    this.death.append(el('div', { class: 'd-title' }, 'ELIMINATED'), killer ? el('div', { class: 'd-by' }, 'by ', el('b', { style: { color: TEAMS[killer.team].color } }, killer.name), el('img', { src: weaponIcon(weapon), alt: '' }), head ? ' ⌖ HEADSHOT' : '') : '', this.respawnTxt = el('div', { class: 'd-resp' }, ''));
    this.death.classList.add('show');
  }
  hideDeath() { this.death.classList.remove('show'); }
  setRespawn(t) { if (this.respawnTxt) this.respawnTxt.textContent = 'Respawn in ' + Math.max(0, t).toFixed(1); }
  scoreboard(game, on) {
    if (!on) { this.board.classList.remove('show'); return; }
    this.board.innerHTML = '';
    for (const team of [0, 1]) {
      const T = TEAMS[team];
      const rows = game.actors.filter((a) => a.team === team).sort((a, b) => b.kills - a.kills);
      const tbl = el('div', { class: 'sb-team' }, el('div', { class: 'sb-head', style: { color: T.color } }, el('b', {}, T.name), el('span', {}, game.score[team] + ' kills')),
        el('div', { class: 'sb-row sb-cols' }, el('span', {}, 'Player'), el('span', {}, 'K'), el('span', {}, 'D'), el('span', {}, 'HS')),
        ...rows.map((a) => el('div', { class: 'sb-row' + (a.isLocal ? ' me' : '') + (a.alive ? '' : ' dead') }, el('span', {}, a.name + (a.isBot ? ' 🤖' : '')), el('span', {}, a.kills), el('span', {}, a.deaths), el('span', {}, a.hs))));
      this.board.appendChild(tbl);
    }
    this.board.classList.add('show');
  }

  update(dt, game) {
    const p = game.player;
    this.hpNum.textContent = Math.ceil(p.hp); this.hpFill.style.width = p.hp + '%';
    this.hp.classList.toggle('low', p.hp < 30);
    this.sA.textContent = game.score[0]; this.sB.textContent = game.score[1];
    const tl = Math.max(0, game.timeLeft); this.timer.textContent = Math.floor(tl / 60) + ':' + String(Math.floor(tl % 60)).padStart(2, '0');
    this.spreadPx *= Math.exp(-dt * 7);
    const g = p.gun;
    const moveSpread = g && !g.def.melee ? Math.min(30, (Math.hypot(p.vel.x, p.vel.z) / 5.4) * g.def.moveSpread * 300 + (p.st.onGround ? 0 : 18)) : 0;
    this.layoutCrosshair(this.spreadPx + moveSpread);
    const scoped = p.scoped > 0;
    this.scope.classList.toggle('show', scoped);
    this.cross.style.display = scoped || (g && g.def.scope && !scoped && false) ? 'none' : 'block';
    if (g && g.def.kind === 'sniper' && !scoped) this.cross.style.opacity = '0.0'; else this.cross.style.opacity = '1';
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.hitm.className = 'hitmarker'; }
    if (g && g.reloading) { this.reloadBar.style.display = 'block'; const tot = (g.reloadEnd - (g.reloadStart || g.reloadEnd - 2)); this.reloadBar.firstChild.style.width = Math.min(100, (1 - (g.reloadEnd - game.time) / Math.max(0.1, tot)) * 100) + '%'; }
    else this.reloadBar.style.display = 'none';
    this.drawRadar(game);
    if (settings.showFps) { const s = game.renderer.stats; this.fps.textContent = s.fps + ' FPS · ' + s.frameMs.toFixed(1) + 'ms · ' + Math.round(game.renderer.dynScale * 100) + '%'; this.fps.style.display = 'block'; }
    else this.fps.style.display = 'none';
    void WEAPONS;
  }
}
