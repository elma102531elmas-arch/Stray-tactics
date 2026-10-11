// Unified input: keyboard + mouse (pointer lock) on desktop, and a
// Standoff-style touch layout on phones (floating move stick, drag-to-look
// anywhere on the right, fire buttons that also let you aim while firing).
import { settings } from '../core/settings.js';
import { el } from '../core/util.js';

class Input {
  constructor() {
    this.keys = new Set();
    this.reset();
    this.enabled = false;
    this.pointerLocked = false;
    this.canvas = null;
    this.touchUI = null;
    this._bind();
  }
  reset() {
    this.moveX = 0; this.moveZ = 0; this.lookDX = 0; this.lookDY = 0;
    this.fire = false; this.fire2 = false; this.edges = new Set();
    this.touchMove = { x: 0, z: 0 }; this.touchFire = false; this.touchCrouch = false; this.touchJump = false;
  }
  edge(name) { if (this.edges.has(name)) { this.edges.delete(name); return true; } return false; }
  push(name) { this.edges.add(name); }
  consumeLook() { const x = this.lookDX, y = this.lookDY; this.lookDX = 0; this.lookDY = 0; return [x, y]; }
  down(code) { return this.keys.has(code); }

  attach(canvas) { this.canvas = canvas; }
  lock() { if (!settings.isTouch && this.canvas && !this.pointerLocked) { try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) { /* */ } }); } catch (e) { try { this.canvas.requestPointerLock(); } catch (e2) { /* */ } } } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  _bind() {
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
      if (!this.keys.has(e.code)) this.onKeyEdge(e.code);
      this.keys.add(e.code);
      if (this.enabled && ['Space', 'Tab', 'KeyF', 'ControlLeft'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.fire = false; this.fire2 = false; });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = !!document.pointerLockElement;
      if (!this.pointerLocked && this.enabled) this.push('lockLost');
    });
    addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      // ignore the occasional huge spike some browsers emit on lock
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.lookDX += e.movementX; this.lookDY += e.movementY;
    });
    addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.pointerLocked) return;
      if (e.button === 0) { this.fire = true; this.push('fire'); }
      if (e.button === 2) { this.fire2 = true; this.push('fire2'); }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.fire = false; if (e.button === 2) this.fire2 = false; });
    addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    addEventListener('wheel', (e) => { if (!this.enabled || !this.pointerLocked) return; this.push(e.deltaY > 0 ? 'next' : 'prev'); }, { passive: true });
  }
  onKeyEdge(code) {
    const map = { KeyR: 'reload', KeyF: 'inspect', Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', KeyQ: 'last', Escape: 'pause', KeyB: 'buy', Space: 'jump', KeyG: 'drop' };
    if (map[code]) this.push(map[code]);
  }

  // per-frame movement (desktop keys + touch stick)
  poll() {
    let x = 0, z = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) z -= 1;
    if (this.down('KeyS') || this.down('ArrowDown')) z += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    x += this.touchMove.x; z += this.touchMove.z;
    const l = Math.hypot(x, z); if (l > 1) { x /= l; z /= l; }
    this.moveX = x; this.moveZ = z;
    this.crouch = this.down('ControlLeft') || this.down('KeyC') || this.touchCrouch;
    this.walk = this.down('ShiftLeft') || this.down('ShiftRight');
    this.jumpHeld = this.down('Space') || this.touchJump;
    this.firing = this.fire || this.touchFire;
    this.scoreboard = this.down('Tab');
  }

  // ---------------------------------------------------------------- touch UI
  buildTouch(root, hooks) {
    if (this.touchUI) { this.touchUI.remove(); }
    const ui = el('div', { class: 'touch' });
    const stickBase = el('div', { class: 't-stick' }, el('div', { class: 't-knob' }));
    const btn = (cls, label, title) => el('div', { class: 't-btn ' + cls, title: title || '' }, label);
    const fireR = btn('t-fire', '', 'Fire'), fireL = btn('t-fire t-fire-l', '', 'Fire');
    const jump = btn('t-jump', '⤒'), crouch = btn('t-crouch', '⤓'), reload = btn('t-reload', '⟳'), scope = btn('t-scope', '◎'), inspect = btn('t-inspect', '✋'), pause = btn('t-pause', 'II'), board = btn('t-board', '☰');
    ui.append(stickBase, fireR, fireL, jump, crouch, reload, scope, inspect, pause, board);
    root.appendChild(ui);
    this.touchUI = ui; this.touchEls = { scope };
    const sens = () => 0.55 * settings.touchSens;
    const looks = new Map(); // touchId -> last pos
    let stickId = null, sx = 0, sy = 0;
    const R = 52;
    const setKnob = (dx, dy) => { stickBase.firstChild.style.transform = `translate(${dx}px,${dy}px)`; };
    const onStart = (e) => {
      for (const t of e.changedTouches) {
        const target = t.target.closest ? t.target.closest('.t-btn') : null;
        if (target) {
          if (target === fireR || target === fireL) { this.touchFire = true; this.push('fire'); looks.set(t.identifier, { x: t.clientX, y: t.clientY }); }
          else if (target === jump) { this.touchJump = true; this.push('jump'); }
          else if (target === crouch) { this.touchCrouch = !this.touchCrouch; crouch.classList.toggle('on', this.touchCrouch); }
          else if (target === reload) this.push('reload');
          else if (target === scope) this.push('fire2');
          else if (target === inspect) this.push('inspect');
          else if (target === pause) this.push('pause');
          else if (target === board) this.push('board');
          target.classList.add('down');
          continue;
        }
        if (t.clientX < innerWidth * 0.42 && stickId === null) {
          stickId = t.identifier; sx = t.clientX; sy = t.clientY;
          stickBase.style.left = (sx - 60) + 'px'; stickBase.style.top = (sy - 60) + 'px'; stickBase.classList.add('active');
        } else looks.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      e.preventDefault();
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - sx, dy = t.clientY - sy; const l = Math.hypot(dx, dy);
          if (l > R) { dx = dx / l * R; dy = dy / l * R; }
          setKnob(dx, dy); this.touchMove.x = dx / R; this.touchMove.z = dy / R;
          continue;
        }
        const lp = looks.get(t.identifier);
        if (lp) { this.lookDX += (t.clientX - lp.x) / sens() * 0.32; this.lookDY += (t.clientY - lp.y) / sens() * 0.32; lp.x = t.clientX; lp.y = t.clientY; }
      }
      e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this.touchMove.x = 0; this.touchMove.z = 0; setKnob(0, 0); stickBase.classList.remove('active'); }
        looks.delete(t.identifier);
        const target = t.target.closest ? t.target.closest('.t-btn') : null;
        if (target) {
          target.classList.remove('down');
          if (target === fireR || target === fireL) { const still = [...e.touches].some((x) => { const tg = x.target.closest && x.target.closest('.t-btn'); return tg === fireR || tg === fireL; }); if (!still) this.touchFire = false; }
          if (target === jump) this.touchJump = false;
        }
      }
    };
    ui.addEventListener('touchstart', onStart, { passive: false });
    ui.addEventListener('touchmove', onMove, { passive: false });
    ui.addEventListener('touchend', onEnd); ui.addEventListener('touchcancel', onEnd);
    void hooks;
    return ui;
  }
  showTouch(on, scopeVisible) {
    if (!this.touchUI) return;
    this.touchUI.style.display = on ? 'block' : 'none';
    if (this.touchEls) this.touchEls.scope.style.display = scopeVisible ? 'flex' : 'none';
  }
}

export const input = new Input();
