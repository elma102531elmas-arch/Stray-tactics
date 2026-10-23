// Touch (floating joystick + look pad + buttons) and keyboard/mouse input.
import { CFG } from '../settings.js';

const KEYMAP = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyC: 'crouch', ControlLeft: 'crouch', KeyF: 'flash', KeyE: 'use', KeyR: 'reload',
  KeyQ: 'weapon', Digit1: 'w1', Digit2: 'w2', Digit3: 'w3', Digit4: 'w4', KeyH: 'heal', KeyG: 'medkit', Tab: 'journal', Escape: 'pause',
  KeyP: 'pause', KeyV: 'aim', KeyT: 'chat', KeyB: 'battery',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.move = { x: 0, y: 0 };
    this.lookDX = 0; this.lookDY = 0;
    this.held = {};
    this.pressed = new Set();
    this.released = new Set();
    this.enabled = false;
    this.touchMode = false;
    this.sprintLock = false;
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.looks = new Map(); // touch id -> {x,y}
    this.btnTouches = new Map(); // touch id -> act
    this.keys = {};
    this.pointerLocked = false;
    this.bindKeyboard();
    this.bindMouse();
  }

  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.code === 'Tab') e.preventDefault();
      if (!this.keys[e.code]) this.press(a);
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      this.keys[e.code] = false;
      this.release(a);
    });
    window.addEventListener('blur', () => { this.keys = {}; this.held = {}; this.move.x = this.move.y = 0; });
  }

  bindMouse() {
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touchMode) return;
      if (!this.pointerLocked) { this.lockPointer(); return; }
      if (e.button === 0) this.press('fire');
      if (e.button === 2) this.press('aim');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.release('fire');
      if (e.button === 2) this.release('aim');
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === c;
      this.lockedAt = performance.now();
      if (!this.pointerLocked && this.enabled && !this.touchMode) this.onUnlock && this.onUnlock();
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      // Chrome sometimes reports one huge bogus delta (the sudden 180° snap); drop it
      let dx = e.movementX, dy = e.movementY;
      if (performance.now() - (this.lockedAt || 0) < 250) return;
      if (Math.abs(dx) > 220 || Math.abs(dy) > 220) return;
      this.lookDX += dx * 0.0022 * CFG.sens;
      this.lookDY += dy * 0.0022 * CFG.sens;
    });
    c.addEventListener('wheel', (e) => { if (this.enabled) this.press(e.deltaY > 0 ? 'wnext' : 'wprev'); }, { passive: true });
  }

  lockPointer() {
    if (this.touchMode) return;
    try { let r; try { r = this.canvas.requestPointerLock({ unadjustedMovement: true }); } catch (e2) { r = this.canvas.requestPointerLock(); } if (r && r.catch) r.catch(() => { try { this.canvas.requestPointerLock(); } catch (e3) { /* ignore */ } }); } catch (e) { /* not available */ }
  }
  unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }

  // Touch UI. layer = full-screen element; buttons have data-act.
  bindTouch(layer, joyBase, joyKnob, onAnyTouch) {
    this.layer = layer; this.joyBase = joyBase; this.joyKnob = joyKnob;
    const R = () => 58 * CFG.hudScale;
    const start = (e) => {
      if (!this.enabled) return;
      this.touchMode = true;
      onAnyTouch && onAnyTouch();
      for (const t of e.changedTouches) {
        const el = t.target.closest ? t.target.closest('[data-act]') : null;
        if (el) {
          const act = el.dataset.act;
          this.btnTouches.set(t.identifier, { act, el, x: t.clientX, y: t.clientY, look: el.dataset.look === '1' });
          el.classList.add('down');
          if (el.dataset.toggle === '1') this.press(act);
          else this.press(act);
          continue;
        }
        if (t.clientX < window.innerWidth * 0.42 && this.joy.id === null) {
          this.joy.id = t.identifier;
          this.joy.ox = t.clientX; this.joy.oy = t.clientY;
          this.joy.x = 0; this.joy.y = 0;
          this.showJoy(true);
        } else {
          this.looks.set(t.identifier, { x: t.clientX, y: t.clientY, t0: performance.now(), sx: t.clientX, sy: t.clientY });
        }
      }
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.enabled) return;
      const sens = 0.0042 * CFG.sens;
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          let dx = t.clientX - this.joy.ox, dy = t.clientY - this.joy.oy;
          const r = R();
          const d = Math.hypot(dx, dy);
          // sprint lock when pushed hard forward
          this.sprintLock = dy < -r * 1.25 && Math.abs(dx) < r * 0.8;
          if (d > r) { dx = dx / d * r; dy = dy / d * r; }
          this.joy.x = dx / r; this.joy.y = dy / r;
          this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
          this.joyBase.classList.toggle('sprint', this.sprintLock);
          continue;
        }
        const lk = this.looks.get(t.identifier);
        if (lk) {
          this.lookDX += (t.clientX - lk.x) * sens;
          this.lookDY += (t.clientY - lk.y) * sens;
          lk.x = t.clientX; lk.y = t.clientY;
          continue;
        }
        const bt = this.btnTouches.get(t.identifier);
        if (bt && bt.look) {
          this.lookDX += (t.clientX - bt.x) * sens;
          this.lookDY += (t.clientY - bt.y) * sens;
          bt.x = t.clientX; bt.y = t.clientY;
        }
      }
      e.preventDefault();
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          this.joy.id = null; this.joy.x = 0; this.joy.y = 0; this.sprintLock = false;
          this.showJoy(false);
          continue;
        }
        const lk = this.looks.get(t.identifier);
        if (lk) {
          // quick tap on the look side counts as "use" (handy for doors and items)
          if (performance.now() - lk.t0 < 220 && Math.hypot(t.clientX - lk.sx, t.clientY - lk.sy) < 12) this.press('tapUse');
          this.looks.delete(t.identifier);
          continue;
        }
        const bt = this.btnTouches.get(t.identifier);
        if (bt) {
          bt.el.classList.remove('down');
          this.release(bt.act);
          this.btnTouches.delete(t.identifier);
        }
      }
    };
    layer.addEventListener('touchstart', start, { passive: false });
    layer.addEventListener('touchmove', move, { passive: false });
    layer.addEventListener('touchend', end);
    layer.addEventListener('touchcancel', end);
  }

  showJoy(on) {
    if (!this.joyBase) return;
    if (on) {
      this.joyBase.style.left = this.joy.ox + 'px';
      this.joyBase.style.top = this.joy.oy + 'px';
      this.joyBase.classList.add('active');
    } else {
      this.joyBase.classList.remove('active', 'sprint');
      this.joyKnob.style.transform = 'translate(0px,0px)';
    }
  }

  press(a) { if (!this.held[a]) this.pressed.add(a); this.held[a] = true; }
  release(a) { if (this.held[a]) this.released.add(a); this.held[a] = false; }

  frame() {
    let mx = 0, my = 0;
    if (this.keys.KeyA || this.keys.ArrowLeft) mx -= 1;
    if (this.keys.KeyD || this.keys.ArrowRight) mx += 1;
    if (this.keys.KeyW || this.keys.ArrowUp) my -= 1;
    if (this.keys.KeyS || this.keys.ArrowDown) my += 1;
    if (this.joy.id !== null) { mx = this.joy.x; my = this.joy.y; }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    this.move.x = mx; this.move.y = my;
    const out = {
      mx, my,
      lookDX: this.lookDX * (CFG.invertY ? 1 : 1),
      lookDY: this.lookDY * (CFG.invertY ? -1 : 1),
      pressed: this.pressed, released: this.released, held: this.held,
      sprint: !!this.held.sprint || this.sprintLock,
    };
    this.lookDX = 0; this.lookDY = 0;
    this.pressed = new Set();
    this.released = new Set();
    return out;
  }

  reset() {
    this.held = {}; this.pressed = new Set(); this.released = new Set(); this.lookDX = this.lookDY = 0;
    this.joy.id = null; this.looks.clear(); this.btnTouches.clear(); this.showJoy(false);
    document.querySelectorAll('[data-act].down').forEach((e) => e.classList.remove('down'));
  }
}
