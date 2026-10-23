// DOM user interface: menus, lobby, settings, HUD, touch controls, notes, keypad.
import { CFG, saveCfg, SAVE, QUALITY } from './settings.js';
import { t } from './i18n.js';
import { fmtTime, isTouch } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  drop: '<svg viewBox="0 0 24 24"><path d="M12 2C9 7 6 10.5 6 14a6 6 0 0 0 12 0c0-3.5-3-7-6-12z"/></svg>',
  bone: '<svg viewBox="0 0 24 24"><path d="M7 3a3 3 0 0 0-2.8 4.1A3 3 0 1 0 7.9 11L13 16.1a3 3 0 1 0 3.9 3.7A3 3 0 1 0 20.9 16l-5-5.1A3 3 0 1 0 12 7.2 3 3 0 0 0 7 3z"/></svg>',
  pill: '<svg viewBox="0 0 24 24"><path d="M4.2 13.6l9.4-9.4a5 5 0 0 1 7.1 7.1l-9.4 9.4a5 5 0 0 1-7.1-7.1zm2.1 2.1a2 2 0 0 0 2.8 2.8L13 14.7 10.2 11.9z"/></svg>',
  light: '<svg viewBox="0 0 24 24"><path d="M9 2h6v4l3 5v11H6V11l3-5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 4h4v16H7zM13 4h4v16h-4z"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 3h7a3 3 0 0 1 3 3v15a2 2 0 0 0-2-2H4zm16 0h-4a3 3 0 0 0-3 3v15a2 2 0 0 1 2-2h5z"/></svg>',
};

export class UI {
  constructor(game) {
    this.game = game;
    this.root = $('#ui');
    this.hud = $('#hud');
    this.screens = {};
    this.toasts = $('#toasts');
    this.subEl = $('#subtitle');
    this.subT = 0;
    this.objT = 0;
    this.lastObj = '';
    this.build();
  }

  // ---------------------------------------------------------------- screens
  build() {
    for (const s of document.querySelectorAll('.screen')) this.screens[s.id] = s;
    this.bindMenu();
    this.buildSettings();
    this.buildTouch();
    this.applyHudScale();
    this.translate();
  }

  translate() {
    document.documentElement.lang = CFG.lang;
    for (const e of document.querySelectorAll('[data-t]')) e.textContent = t(e.dataset.t);
    for (const e of document.querySelectorAll('[data-tp]')) e.placeholder = t(e.dataset.tp);
  }

  show(id) {
    for (const k in this.screens) this.screens[k].hidden = k !== id;
    this.current = id;
    if (id === 'menu') this.refreshMenu();
    if (id === 'chapters') this.buildChapters();
  }
  hideAll() { for (const k in this.screens) this.screens[k].hidden = true; this.current = null; }

  setLoading(p, label) {
    $('#loadFill').style.width = Math.round(p * 100) + '%';
    if (label) $('#loadLabel').textContent = label;
  }

  refreshMenu() {
    const c = $('#btnContinue');
    c.hidden = !SAVE.checkpoint;
    if (SAVE.checkpoint) c.querySelector('small').textContent = `${t('chapter')} ${SAVE.checkpoint.chapter} · ${t('ch' + SAVE.checkpoint.chapter)}`;
  }

  bindMenu() {
    const g = this.game;
    const on = (id, fn) => { const e = document.getElementById(id); if (e) e.addEventListener('click', (ev) => { g.audio.play('ui', { vol: 0.6 }); fn(ev); }); };
    on('btnSolo', () => g.startSolo(1));
    on('btnContinue', () => g.startSolo(SAVE.checkpoint.chapter, SAVE.checkpoint.inv));
    on('btnCoop', () => { this.show('coop'); $('#nameIn').value = CFG.name; $('#coopStatus').textContent = ''; });
    on('btnChapters', () => this.show('chapters'));
    on('btnSettings', () => { this.settingsBack = 'menu'; this.show('settings'); });
    for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', () => { g.audio.play('ui', { vol: 0.6 }); if (b.dataset.back === 'settings') { this.show(this.settingsBack || 'menu'); if (this.settingsBack === 'pause') this.show('pause'); } else if (b.dataset.back === 'lobby') g.leaveLobby(); else this.show(b.dataset.back); });
    on('btnHost', () => { this.saveName(); g.hostGame(); });
    on('btnJoin', () => { this.saveName(); const code = $('#codeIn').value.trim(); if (code.length < 4) { $('#coopStatus').textContent = t('joinFailed'); return; } g.joinGame(code); });
    on('btnLobbyStart', () => g.lobbyStart());
    on('btnResume', () => g.resume());
    on('btnPauseSettings', () => { this.settingsBack = 'pause'; this.show('settings'); });
    on('btnRestart', () => g.restartChapter());
    on('btnQuit', () => g.quitToMenu());
    on('btnJournal', () => this.openJournal());
    on('btnRetry', () => g.restartChapter());
    on('btnDeadQuit', () => g.quitToMenu());
    on('btnNext', () => g.nextChapter());
    on('btnEndMenu', () => g.quitToMenu());
    on('btnNoteClose', () => this.closeNote());
    on('btnJournalClose', () => { $('#journal').hidden = true; });
    $('#codeIn').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
    for (const b of document.querySelectorAll('#lobbyDiff button')) b.addEventListener('click', () => { if (!g.net.isHost) return; g.lobbyDiff = b.dataset.v; g.net.pushLobby(); });
    // keypad
    const pad = $('#keypadKeys');
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK']) {
      const b = el('button', 'key', k);
      b.addEventListener('click', () => this.keypadPress(k));
      pad.appendChild(b);
    }
    on('btnKeypadClose', () => this.closeKeypad());
    $('#pauseBtn').addEventListener('click', () => g.pause());
    $('#journalBtn').addEventListener('click', () => this.openJournal());
  }

  saveName() {
    const n = $('#nameIn').value.trim().slice(0, 16);
    if (n) { CFG.name = n; saveCfg(); }
  }

  buildChapters() {
    const list = $('#chapterList');
    list.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const lockedCh = i > SAVE.unlocked;
      const b = el('button', 'chapterBtn' + (lockedCh ? ' locked' : ''), `<span class="num">${String(i).padStart(2, '0')}</span><span class="nm">${esc(t('ch' + i))}</span><small>${lockedCh ? esc(t('locked')) : esc(t('ch' + i + 'sub'))}</small>`);
      b.disabled = lockedCh;
      b.addEventListener('click', () => { this.game.audio.play('ui', { vol: 0.6 }); this.game.startSolo(i); });
      list.appendChild(b);
    }
  }

  // ---------------------------------------------------------------- lobby
  lobby(m, isHost, code) {
    this.show('lobby');
    $('#lobbyCode').textContent = code || '-----';
    const ul = $('#lobbyPlayers');
    ul.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const p = m.players?.find((q) => q.slot === i);
      const li = el('li', p ? '' : 'empty', p ? `<span>${esc(p.name)}</span><small>${i === 0 ? 'HOST' : 'P' + (i + 1)}</small>` : '<span>—</span>');
      ul.appendChild(li);
    }
    const sel = $('#lobbyChapter');
    sel.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const b = el('button', (m.chapter === i ? 'active' : '') + (isHost && i > SAVE.unlocked ? ' dim' : ''), String(i));
      b.title = t('ch' + i);
      b.addEventListener('click', () => { if (!isHost) return; this.game.lobbyChapter = i; this.game.net.pushLobby(); });
      sel.appendChild(b);
    }
    $('#lobbyChapterName').textContent = t('ch' + (m.chapter || 1));
    for (const b of document.querySelectorAll('#lobbyDiff button')) b.classList.toggle('active', b.dataset.v === (m.diff || 'normal'));
    $('#btnLobbyStart').hidden = !isHost;
    $('#lobbyWait').hidden = isHost;
  }

  coopStatus(msg) { $('#coopStatus').textContent = msg; }

  // ---------------------------------------------------------------- settings
  buildSettings() {
    const box = $('#settingsBody');
    const g = this.game;
    const rows = [
      ['quality', 'seg', ['low', 'medium', 'high', 'ultra']],
      ['brightness', 'range', [0.6, 1.8, 0.05]],
      ['sensitivity', 'range', [0.3, 2.5, 0.05], 'sens'],
      ['aimSens', 'range', [0.2, 1.2, 0.05]],
      ['fov', 'range', [60, 100, 1]],
      ['volume', 'range', [0, 1, 0.05]],
      ['musicVol', 'range', [0, 1, 0.05], 'music'],
      ['blood', 'seg', ['high', 'low', 'off'], 'blood', { high: 'bloodHigh', low: 'bloodLow', off: 'bloodOff' }],
      ['hudScale', 'range', [0.7, 1.4, 0.05]],
      ['btnOpacity', 'range', [0.25, 1, 0.05]],
      ['invertY', 'toggle'],
      ['autoRes', 'toggle'],
      ['showFps', 'toggle'],
      ['language', 'seg', ['en', 'tr'], 'lang', { en: 'English', tr: 'Türkçe' }],
    ];
    if (CFG.brightness === undefined) CFG.brightness = 1;
    box.innerHTML = '';
    for (const [label, kind, opts, keyOverride, names] of rows) {
      const key = keyOverride || label;
      const row = el('div', 'setRow');
      row.appendChild(el('label', '', `<span data-t="${label}">${t(label)}</span>`));
      if (kind === 'seg') {
        const seg = el('div', 'seg');
        for (const o of opts) {
          const b = el('button', CFG[key] === o ? 'active' : '', names ? (names[o].length > 2 && t(names[o]) !== names[o] ? t(names[o]) : names[o]) : t(o));
          b.addEventListener('click', () => {
            CFG[key] = o; saveCfg();
            seg.querySelectorAll('button').forEach((x) => x.classList.remove('active')); b.classList.add('active');
            g.applySettings(key);
            if (key === 'lang') { this.translate(); this.buildSettings(); }
          });
          seg.appendChild(b);
        }
        row.appendChild(seg);
      } else if (kind === 'range') {
        const wrap = el('div', 'rng');
        const inp = el('input');
        inp.type = 'range'; inp.min = opts[0]; inp.max = opts[1]; inp.step = opts[2]; inp.value = CFG[key];
        inp.id = 'set_' + key;
        const val = el('span', 'val', fmtVal(CFG[key], key));
        inp.addEventListener('input', () => { CFG[key] = parseFloat(inp.value); val.textContent = fmtVal(CFG[key], key); g.applySettings(key); });
        inp.addEventListener('change', () => saveCfg());
        wrap.append(inp, val);
        row.appendChild(wrap);
      } else {
        const b = el('button', 'tog' + (CFG[key] ? ' active' : ''), CFG[key] ? t('on') : t('off'));
        b.addEventListener('click', () => { CFG[key] = !CFG[key]; saveCfg(); b.classList.toggle('active', CFG[key]); b.textContent = CFG[key] ? t('on') : t('off'); g.applySettings(key); });
        row.appendChild(b);
      }
      box.appendChild(row);
    }
    function fmtVal(v, k) { return k === 'fov' ? Math.round(v) + '°' : (Math.round(v * 100) / 100).toFixed(2).replace(/0$/, ''); }
  }

  applyHudScale() {
    document.documentElement.style.setProperty('--hud', CFG.hudScale);
    document.documentElement.style.setProperty('--btnA', CFG.btnOpacity);
  }

  // ---------------------------------------------------------------- touch controls
  buildTouch() {
    const layer = $('#touch');
    this.touchLayer = layer;
    if (!isTouch()) layer.classList.add('desktop');
  }
  setTouchVisible(on) { $('#touch').hidden = !on; }

  // ---------------------------------------------------------------- HUD
  showHud(on) { this.hud.hidden = !on; this.setTouchVisible(on); }

  updateHud(P, info) {
    const hp = Math.max(0, Math.ceil(P.hp));
    $('#hpNum').textContent = hp;
    $('#hpFill').style.width = hp + '%';
    $('#hpFill').classList.toggle('low', hp < 35);
    $('#stamFill').style.width = P.stamina + '%';
    $('#stam').classList.toggle('show', P.stamina < 99);
    $('#batFill').style.width = Math.round(P.battery * 100) + '%';
    $('#batFill').classList.toggle('low', P.battery < 0.2);
    $('#batCount').textContent = P.inv.battery ? '+' + P.inv.battery : '';
    $('#stBleed').hidden = !P.bleed;
    $('#stBleed').classList.toggle('heavy', P.bleed === 2);
    $('#stFract').hidden = !P.fracture;
    $('#stPill').hidden = !(P.painkiller > 0);
    // weapon / ammo
    const W = info.weapon;
    if (W && W.kind === 'gun') {
      $('#ammo').hidden = false;
      $('#ammoMag').textContent = P.mag[P.weapon];
      $('#ammoRes').textContent = P.inv[W.ammo];
      $('#ammo').classList.toggle('empty', P.mag[P.weapon] === 0);
    } else $('#ammo').hidden = true;
    $('#wpnName').textContent = P.weapon === 'none' ? t('light') : t(P.weapon);
    $('#healCount').textContent = (P.inv.bandage || 0) + (P.inv.medkit || 0) + (P.inv.painkillers || 0);
    // crosshair
    const ch = $('#cross');
    ch.hidden = P.weapon === 'none' || P.weapon === 'crowbar' && false || info.ads > 0.6;
    ch.style.setProperty('--gap', (4 + Math.min(14, P.speed * 3)) + 'px');
    // interaction prompt
    const ip = $('#prompt');
    const useBtn = $('#tUse');
    if (info.prompt) {
      ip.hidden = false;
      ip.querySelector('b').textContent = info.prompt;
      ip.querySelector('kbd').hidden = this.game.input.touchMode;
      useBtn.classList.add('ready');
      useBtn.querySelector('span').textContent = info.promptShort || info.prompt;
    } else { ip.hidden = true; useBtn.classList.remove('ready'); useBtn.querySelector('span').textContent = t('use'); }
    const hold = $('#hold');
    hold.hidden = !(info.hold > 0);
    if (info.hold > 0) hold.style.setProperty('--p', Math.round(info.hold * 100));
    // touch buttons state
    $('#tFire').classList.toggle('off', !W);
    $('#tAim').hidden = !(W && W.kind === 'gun');
    $('#tReload').hidden = !(W && W.kind === 'gun');
    $('#tLight').classList.toggle('on', P.flashOn);
    $('#tCrouch').classList.toggle('on', P.crouch);
    $('#tAim').classList.toggle('on', !!P.aimToggle);
    // downed / revive overlays
    $('#downed').hidden = !P.downed;
    if (P.downed) $('#bleedout').textContent = Math.ceil(P.bleedout);
    // objective fade
    if (this.objT > 0) { this.objT -= info.dt; $('#objective').classList.toggle('dim', this.objT <= 0); }
    if (this.subT > 0) { this.subT -= info.dt; if (this.subT <= 0) this.subEl.classList.remove('show'); }
    // damage direction
    const dd = $('#dmgDir');
    if (P.dmgDirT > 0) {
      const rel = P.dmgDir - P.yaw + Math.PI;
      dd.style.opacity = Math.min(1, P.dmgDirT);
      dd.style.transform = `translate(-50%,-50%) rotate(${-rel}rad)`;
    } else dd.style.opacity = 0;
    if (info.fps !== undefined) { $('#fps').hidden = !CFG.showFps; $('#fps').textContent = info.fps + ' fps'; }
    $('#scope').hidden = !(P.weapon === 'rifle' && info.ads > 0.85);
  }

  objective(text, chapterKey) {
    const o = $('#objective');
    o.querySelector('b').textContent = text;
    if (chapterKey) o.querySelector('small').textContent = t(chapterKey);
    if (text !== this.lastObj) { this.objT = 9; o.classList.remove('dim'); o.classList.remove('flash'); void o.offsetWidth; o.classList.add('flash'); }
    this.lastObj = text;
  }
  objectiveText(text) { $('#objective b').textContent = text; }

  subtitle(text, dur = 4) {
    this.subEl.textContent = text;
    this.subEl.classList.add('show');
    this.subT = dur;
  }

  toast(text, kind = '') {
    const e = el('div', 'toast ' + kind, esc(text));
    this.toasts.appendChild(e);
    setTimeout(() => e.classList.add('out'), 2600);
    setTimeout(() => e.remove(), 3200);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  team(list) {
    const box = $('#team');
    box.innerHTML = '';
    for (const p of list) {
      const d = el('div', 'tm' + (p.downed ? ' down' : '') + (p.dead ? ' dead' : ''), `<span>${esc(p.name)}</span><i style="width:${Math.max(0, p.hp)}%"></i>`);
      box.appendChild(d);
    }
  }

  chapterCard(n, key, sub) {
    const c = $('#chapterCard');
    c.querySelector('.n').textContent = `${t('chapter')} ${n}`;
    c.querySelector('.t').textContent = t(key);
    c.querySelector('.s').textContent = t(sub);
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
  }

  // ---------------------------------------------------------------- notes, journal, keypad
  openNote(titleKey, bodyKey, tape) {
    const n = $('#note');
    n.hidden = false;
    n.classList.toggle('tape', !!tape);
    n.querySelector('h3').textContent = t(titleKey);
    n.querySelector('.body').textContent = t(bodyKey);
    this.noteOpen = true;
  }
  closeNote() {
    $('#note').hidden = true;
    this.noteOpen = false;
    this.game.audio.stopSpeech();
    this.game.onNoteClosed();
  }
  openJournal() {
    const j = $('#journal');
    j.hidden = false;
    $('#jObjective').textContent = this.lastObj;
    const list = $('#jNotes');
    list.innerHTML = '';
    for (const n of this.game.journal) {
      const b = el('button', 'jn', esc(t(n + '_t')));
      b.addEventListener('click', () => { j.hidden = true; this.openNote(n + '_t', n, false); });
      list.appendChild(b);
    }
  }

  openKeypad(onSubmit) {
    this.keypadCb = onSubmit;
    this.keypadVal = '';
    $('#keypadDisp').textContent = '____';
    $('#keypad').hidden = false;
    this.keypadOpen = true;
  }
  keypadPress(k) {
    const g = this.game;
    g.audio.play('click', { vol: 0.5, rate: 1.4 });
    if (k === 'C') this.keypadVal = '';
    else if (k === 'OK') {
      const ok = this.keypadCb && this.keypadCb(this.keypadVal);
      if (ok) { this.closeKeypad(); return; }
      $('#keypadDisp').textContent = t('wrongCode');
      this.keypadVal = '';
      setTimeout(() => { if (this.keypadOpen) $('#keypadDisp').textContent = '____'; }, 900);
      return;
    } else if (this.keypadVal.length < 4) this.keypadVal += k;
    $('#keypadDisp').textContent = (this.keypadVal + '____').slice(0, 4);
  }
  closeKeypad() { $('#keypad').hidden = true; this.keypadOpen = false; this.game.onNoteClosed(); }

  // ---------------------------------------------------------------- end screens
  dead(sub) { $('#deadSub').textContent = sub || t('diedSub'); this.show('dead'); }
  chapterDone(stats, hasNext) {
    $('#statTime').textContent = fmtTime(stats.time);
    $('#statKills').textContent = stats.kills;
    $('#statDeaths').textContent = stats.deaths;
    $('#btnNext').hidden = !hasNext;
    this.show('done');
  }
  ending(stats) {
    $('#endText').textContent = t('ending');
    $('#endStats').textContent = `${t('time')} ${fmtTime(stats.time)} · ${t('kills')} ${stats.kills}`;
    this.show('end');
  }
}
