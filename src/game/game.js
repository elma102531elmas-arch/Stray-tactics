// Match orchestration: Team Deathmatch vs bots, or Practice (free roam).
import * as THREE from 'three';
import { Player } from './player.js';
import { Bot, botName } from './bot.js';
import { Effects, matKind } from './effects.js';
import { HUD } from './hud.js';
import { NavGrid } from './nav.js';
import { input } from './input.js';
import { audio } from './audio.js';
import { damageFor } from './combat.js';
import { settings } from '../core/settings.js';
import { el, pick } from '../core/util.js';
import { TEAMS } from './character.js';
import { clsOf, PRIMARIES } from '../weapons/weapons.js';
import { profile } from '../core/profile.js';

// bots carry a mix of primaries (weights)
const BOT_GUNS = [['rifle', 30], ['m4', 25], ['smg', 16], ['shotgun', 9], ['sniper', 20]];
function botGun() { let r = Math.random() * 100; for (const [g, w] of BOT_GUNS) { if ((r -= w) < 0) return g; } return 'rifle'; }
void PRIMARIES;

export class Game {
  constructor(app, opts = {}) {
    this.app = app; this.renderer = app.renderer; this.world = app.world; this.vm = app.vm;
    this.opts = { mode: 'tdm', bots: 4, scoreLimit: 40, timeLimit: 300, difficulty: settings.botDifficulty, primary: settings.primary, ...opts };
    this.camera = app.camera;
    this.time = 0; this.score = [0, 0]; this.actors = []; this.bots = [];
    this.paused = false; this.over = false;
    this.respawns = [];
  }

  async start(onProgress) {
    const o = this.opts;
    this.ui = el('div', { class: 'game-ui' + (settings.isTouch ? ' touchmode' : '') }); document.getElementById('ui').appendChild(this.ui);
    this.hud = new HUD(this.ui);
    this.hud.buildRadarMap(this.world);
    if (!this.world.effects) this.world.effects = new Effects(this.world);
    this.effects = this.world.effects; this.effects.clear();
    onProgress && onProgress(0.3, 'Navigation');
    this.nav = this.world.nav || (this.world.nav = new NavGrid(this.world.collision, this.world.collision.bounds, 1));
    const myTeam = o.team ?? 0;
    this.player = new Player(this, settings.name || 'PLAYER', myTeam);
    this.player.setLoadout(o.loadout || { primary: o.primary || settings.primary || 'rifle', secondary: settings.secondary || 'pistol', knife: o.knife || 'knife' });
    this.player.skinFor = o.skinFor || null;
    this.actors.push(this.player);
    if (o.mode === 'tdm') {
      // o.bots = teammates; enemies = o.bots + 1  ->  5v5 by default
      const total = o.bots * 2 + 1;
      for (let i = 0; i < total; i++) {
        const team = i <= o.bots ? 1 - myTeam : myTeam;
        const b = new Bot(this, team, botName(), o.difficulty);
        await b.init(botGun());
        this.bots.push(b); this.actors.push(b);
        onProgress && onProgress(0.3 + 0.5 * (i + 1) / total, 'Spawning bots');
      }
    }
    this.vm.onEvent = (e) => this.onVmEvent(e);
    this.vm.visible = true;
    this.timeLeft = o.mode === 'tdm' ? o.timeLimit : Infinity;
    for (const a of this.actors) await this.spawn(a, true);
    input.enabled = true; input.reset();
    if (settings.isTouch) { input.buildTouch(this.ui); input.showTouch(true, false); }
    this.hud.message(o.mode === 'tdm' ? 'TEAM DEATHMATCH' : 'PRACTICE', o.mode === 'tdm' ? `First to ${o.scoreLimit} kills` : 'Free roam · test weapons, animations and maps', 2600);
    audio.play('go', { vol: 0.6 });
    this.pauseEl = this.buildPause();
    input.lock();
  }

  spawnPoint(team) {
    const sps = this.world.spawns.filter((s) => s.team === team);
    let list = sps.length ? sps : this.world.spawns;
    if (!list.length) { const c = new THREE.Vector3(); if (this.nav) this.nav.randomPoint(c); list = [{ pos: c, yaw: 0 }]; }
    // farthest from enemies among a few random picks
    let best = list[0], bestD = -1;
    for (let i = 0; i < 4; i++) {
      const s = pick(list); let dmin = 1e9;
      for (const a of this.actors) if (a.alive && a.team !== team) dmin = Math.min(dmin, a.pos.distanceTo(s.pos));
      for (const a of this.actors) if (a.alive && a.pos.distanceTo(s.pos) < 0.8) dmin = -1;
      if (dmin > bestD) { bestD = dmin; best = s; }
    }
    return best;
  }
  async spawn(a) {
    const sp = this.spawnPoint(a.team);
    if (a.isBot) a.spawn(sp); else { await a.spawn(sp); this.hud.hideDeath(); this.hud.weaponChanged(a); }
  }

  // ------------------------------------------------------------- combat
  onShot(shooter, origin, dir, res, def, extraPellet) {
    if (res.actor) {
      const dist = res.t;
      const dmg = damageFor(def, res.zone, dist);
      this.applyDamage(shooter, res.actor, dmg, res.zone, dir, def.id);
      this.effects.bloodHit(res.end, dir);
    } else if (res.normal) {
      this.effects.impact(res.end, res.normal, res.mat, { silent: !!extraPellet && Math.random() < 0.7 });
    }
    if (extraPellet) return;
    // hearing + radar spotting
    shooter.spottedT = this.time;
    for (const b of this.bots) if (b.team !== shooter.team && b.alive && b.pos.distanceTo(origin) < 38) b.hear(origin);
  }

  applyDamage(attacker, victim, dmg, zone, dir, weapon) {
    if (!victim.alive) return;
    if (attacker && attacker !== victim && attacker.team === victim.team) return; // no friendly fire
    const dealt = victim.takeDamage(dmg, attacker, zone, dir, weapon);
    if (!dealt) return;
    const head = zone === 'head';
    if (attacker && attacker.isLocal) {
      this.hud.hit(head, !victim.alive);
      audio.play(head ? 'headshot' : 'hit', { vol: head ? 0.75 : 0.5 });
    }
    if (!victim.alive) this.onKill(attacker, victim, weapon, head);
  }

  onKill(killer, victim, weapon, head) {
    victim.deaths++;
    if (killer && killer !== victim) { killer.kills++; if (head) killer.hs++; this.score[killer.team]++; }
    this.hud.killfeed(killer, victim, weapon, head);
    if (killer && killer.isLocal) { audio.play('kill', { vol: 0.55 }); this.hud.message(head ? 'HEADSHOT' : 'ELIMINATED', victim.name, 900); }
    if (victim.isLocal) {
      audio.play('death', { vol: 0.7 });
      this.deathCam = { t: 0, killer, from: this.camera.position.clone(), yaw: victim.yaw, pitch: victim.pitch };
      this.hud.showDeath(killer, weapon, head);
      this.vm.visible = false; victim.scoped = 0;
    }
    this.respawns.push({ actor: victim, t: this.time + (victim.isLocal ? 3.2 : 4 + Math.random() * 2) });
    if (this.opts.mode === 'tdm' && this.score[killer ? killer.team : 0] >= this.opts.scoreLimit) this.endMatch();
  }

  onVmEvent(e) {
    const p = this.player, cam = this.camera;
    switch (e.type) {
      case 'sound': {
        // weapon specific recordings first (pistol_magIn, sniper_boltBack...), then generic
        const cls = p.gun ? p.gun.def.cls : '';
        audio.play(audio.pick(cls + '_' + e.name, e.name), { vol: 0.7, reverb: 0.08 });
        break;
      }
      case 'ammo': p.giveAmmo(); break;
      case 'ammo1': p.giveShell(); break;
      case 'dropMag': {
        // vm-space -> world: the vm scene is camera-centred and world-oriented
        const m = e.matrix.clone(); const pos = new THREE.Vector3().setFromMatrixPosition(m).add(cam.position);
        m.setPosition(pos);
        const v = new THREE.Vector3(e.vel[0], e.vel[1], e.vel[2]).applyQuaternion(cam.quaternion).add(p.vel);
        const node = this.vm.active.nodes.mag;
        this.effects.dropMag(node, m, v);
        break;
      }
      case 'ejectShell': {
        const pos = e.pos.clone().add(cam.position);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        const v = right.multiplyScalar(1.6 + Math.random()).add(up.multiplyScalar(1.4 + Math.random())).add(p.vel);
        const cls = clsOf(e.kind);
        this.effects.shell(pos, v, cls === 'sniper' ? 1.5 : cls === 'pistol' ? 0.8 : cls === 'shotgun' ? 1.6 : 1);
        break;
      }
      default: break;
    }
  }

  // ------------------------------------------------------------- loop
  update(dt) {
    if (input.edge('lockLost') && !this.paused && !this.over) this.setPaused(true);
    if (input.edge('pause') && !this.over) this.setPaused(!this.paused);
    if (this.paused || this.over) { input.consumeLook(); return; }
    this.time += dt;
    if (this.opts.mode === 'tdm') { this.timeLeft -= dt; if (this.timeLeft <= 0) { this.endMatch(); return; } }
    const p = this.player;
    if (p.alive) { p.update(dt); p.update2(dt); }
    for (const b of this.bots) b.update(dt);
    // respawns
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      const r = this.respawns[i];
      if (r.actor.isLocal) this.hud.setRespawn(r.t - this.time);
      if (this.time >= r.t) { this.respawns.splice(i, 1); this.spawn(r.actor); if (r.actor.isLocal) { this.deathCam = null; this.vm.visible = true; } }
    }
    // spotting for radar (visible to the player)
    this._spotT = (this._spotT || 0) - dt;
    if (this._spotT <= 0 && p.alive) {
      this._spotT = 0.25;
      const eye = p.eye(new THREE.Vector3());
      for (const b of this.bots) if (b.alive && b.team !== p.team && b.pos.distanceTo(p.pos) < 70) { const h = b.eye(new THREE.Vector3()); if (this.world.collision.lineOfSight(eye, h)) b.spottedT = this.time; }
    }
    // death cam
    if (!p.alive && this.deathCam) {
      const d = this.deathCam; d.t += dt;
      const k = Math.min(1, d.t / 1.2);
      this.camera.position.copy(d.from).add(new THREE.Vector3(0, k * 1.6, 0)).add(new THREE.Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw)).multiplyScalar(k * 2.2));
      if (d.killer && d.killer.alive) { const kp = d.killer.eye ? d.killer.eye(new THREE.Vector3()) : d.killer.pos; this.camera.lookAt(kp); }
      else this.camera.rotation.set(-0.5 * k, d.yaw, 0, 'YXZ');
    }
    // viewmodel
    this.vm.sunVis += ((this._sunVisT ?? 1) - this.vm.sunVis) * Math.min(1, dt * 4);
    this._sunT = (this._sunT || 0) - dt;
    if (this._sunT <= 0) { this._sunT = 0.15; this._sunVisT = this.world.sunVisibility(this.camera.position); }
    this.vm.update(dt, p.vmCtx || {});
    this.world.update(dt);
    this.effects.update(dt, this.camera);
    audio.setListener(this.camera);
    this.renderer.damage = Math.max(0, this.renderer.damage - dt * 0.9);
    this.hud.update(dt, this);
    this.hud.scoreboard(this, input.scoreboard || this.boardToggle);
    if (input.edge('board')) this.boardToggle = !this.boardToggle;
    input.showTouch(settings.isTouch && p.alive && !this.paused, p.gun && !!p.gun.def.scope);
  }

  render() {
    const p = this.player;
    const showVm = this.vm.visible && p.alive && !p.scoped;
    this.vm.sync(this.camera, this.world, this.camera.aspect);
    this.renderer.render({ scene: this.world.scene, camera: this.camera }, showVm ? { scene: this.vm.scene, camera: this.vm.camera } : null);
  }

  // ------------------------------------------------------------- menus
  buildPause() {
    const box = el('div', { class: 'pause' },
      el('h2', {}, 'PAUSED'),
      el('button', { class: 'btn primary', onclick: () => this.setPaused(false) }, 'RESUME'),
      el('button', { class: 'btn', onclick: () => this.app.openSettings(() => {}) }, 'SETTINGS'),
      el('button', { class: 'btn ghost', onclick: () => this.quit() }, 'LEAVE MATCH'),
      el('p', { class: 'hint' }, settings.isTouch ? '' : 'WASD move · Mouse aim · LMB fire · RMB scope/stab · R reload · F inspect · 1/2/3 weapons · Space jump · Ctrl crouch · Shift walk · Tab score'));
    this.ui.appendChild(box);
    return box;
  }
  setPaused(on) {
    this.paused = on;
    this.pauseEl.classList.toggle('show', on);
    input.enabled = !on;
    if (on) input.unlock(); else input.lock();
  }
  endMatch() {
    if (this.over) return;
    this.over = true; input.enabled = false; input.unlock();
    const win = this.score[this.player.team] > this.score[1 - this.player.team], draw = this.score[0] === this.score[1];
    const mvp = [...this.actors].sort((a, b) => b.kills - a.kills)[0];
    const p = this.player;
    // match rewards (coins + XP) for Team Deathmatch
    let rewards = null;
    if (this.opts.mode === 'tdm') {
      const r = profile.reward({ result: draw ? 'draw' : win ? 'win' : 'loss', kills: p.kills, hs: p.hs, deaths: p.deaths });
      const coinEl = el('b', {}, '+0');
      rewards = el('div', { class: 'me-rewards' }, el('span', { class: 'ctag' }, el('i', { class: 'coin' }), coinEl), el('span', { class: 'me-xp' }, '+' + r.xp + ' XP'), r.levelUp ? el('span', { class: 'me-lvl' }, 'LEVEL ' + r.levelUp + '!') : null);
      // count the coins up
      const t0 = performance.now();
      const tick = () => { const u = Math.min(1, (performance.now() - t0) / 1200); coinEl.textContent = '+' + Math.round(r.coins * (1 - Math.pow(1 - u, 3))); if (u < 1 && coinEl.isConnected) requestAnimationFrame(tick); };
      setTimeout(() => { requestAnimationFrame(tick); audio.play(audio.pick('coins', 'kill'), { vol: 0.6 }); }, 500);
    }
    const box = el('div', { class: 'match-end show' },
      el('h1', { class: draw ? '' : win ? 'win' : 'lose' }, draw ? 'DRAW' : win ? 'VICTORY' : 'DEFEAT'),
      el('div', { class: 'me-score' }, el('b', { style: { color: TEAMS[0].color } }, this.score[0]), ' : ', el('b', { style: { color: TEAMS[1].color } }, this.score[1])),
      el('p', {}, 'MVP: ', el('b', {}, mvp.name), ` · ${mvp.kills} kills`),
      el('p', {}, `You: ${p.kills} kills · ${p.deaths} deaths · ${p.hs} headshots`),
      rewards,
      el('button', { class: 'btn primary', onclick: () => this.app.restartGame() }, 'PLAY AGAIN'),
      el('button', { class: 'btn ghost', onclick: () => this.quit() }, 'MAIN MENU'));
    this.ui.appendChild(box);
  }
  quit() { if (this.opts.onQuit) this.opts.onQuit(); else this.app.toLobby(); }
  destroy() {
    input.enabled = false; input.unlock(); input.showTouch(false);
    for (const b of this.bots) { this.world.dynamic.remove(b.char.group); }
    this.effects.clear();
    this.ui.remove();
    void matKind;
  }
}
