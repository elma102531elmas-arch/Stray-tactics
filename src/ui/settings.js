// Settings modal: graphics (quality, FPS cap, render scale, dynamic res,
// bloom, FOV), controls, crosshair, audio. Changes apply live.
import { settings, saveSettings, QUALITY_PRESETS, preset } from '../core/settings.js';
import { el } from '../core/util.js';
import { audio } from '../game/audio.js';

export function openSettings(app, onClose) {
  const root = el('div', { class: 'modal show' });
  const panel = el('div', { class: 'panel settings' });
  root.appendChild(panel);
  const tabs = ['Graphics', 'Controls', 'Crosshair', 'Audio'];
  let current = 'Graphics';
  const tabBar = el('div', { class: 'tabs' });
  const body = el('div', { class: 'tab-body' });
  const needsReload = el('div', { class: 'note' });
  panel.append(el('div', { class: 'panel-head' }, el('h2', {}, 'SETTINGS'), el('button', { class: 'x', onclick: () => close() }, '✕')), tabBar, body, needsReload);

  const row = (label, ctrl, hint) => el('div', { class: 'row' }, el('label', {}, label, hint ? el('small', {}, hint) : ''), ctrl);
  const seg = (opts, value, onPick) => {
    const w = el('div', { class: 'seg' });
    opts.forEach(([v, l]) => { const b = el('button', { class: v === value ? 'on' : '', onclick: () => { [...w.children].forEach((x) => x.classList.remove('on')); b.classList.add('on'); onPick(v); } }, l); w.appendChild(b); });
    return w;
  };
  const slider = (min, max, step, value, onInput, fmt = (v) => v) => {
    const out = el('span', { class: 'val' }, fmt(value));
    const s = el('input', { type: 'range', min, max, step, value });
    s.addEventListener('input', () => { out.textContent = fmt(+s.value); onInput(+s.value); });
    return el('div', { class: 'slider' }, s, out);
  };
  const toggle = (value, onPick) => seg([[true, 'ON'], [false, 'OFF']], value, onPick);
  const apply = () => { saveSettings(); app.applySettings(); };

  const pages = {
    Graphics: () => [
      row('Quality preset', seg(Object.entries(QUALITY_PRESETS).map(([k, v]) => [k, v.label]), settings.quality, (v) => { settings.quality = v; apply(); needsReload.textContent = 'Texture resolution / baked lighting quality change applies on next map load.'; }),
        'Low/Medium: static shadows · High/Ultra: dynamic shadows + bloom'),
      row('FPS limit', seg([[30, '30'], [60, '60'], [90, '90'], [120, '120'], [144, '144'], [0, 'MAX']], settings.fpsCap, (v) => { settings.fpsCap = v; apply(); }), 'Browsers cannot exceed your screen refresh rate'),
      row('Render scale', slider(0.5, 1.5, 0.05, settings.renderScale, (v) => { settings.renderScale = v; apply(); }, (v) => Math.round(v * 100) + '%')),
      row('Dynamic resolution', toggle(settings.dynamicRes, (v) => { settings.dynamicRes = v; apply(); }), 'Lowers resolution automatically to hold the FPS target'),
      row('Bloom / color grading', seg([[null, 'AUTO'], [true, 'ON'], [false, 'OFF']], settings.bloomOverride, (v) => { settings.bloomOverride = v; apply(); })),
      row('Field of view', slider(60, 105, 1, settings.fov, (v) => { settings.fov = v; apply(); }, (v) => v + '°')),
      row('Weapon FOV', slider(45, 75, 1, settings.vmFov, (v) => { settings.vmFov = v; apply(); }, (v) => v + '°')),
      row('Weapon position', slider(-1, 1, 0.1, settings.vmOffsetX, (v) => { settings.vmOffsetX = v; apply(); }, (v) => v.toFixed(1))),
      row('Show FPS', toggle(settings.showFps, (v) => { settings.showFps = v; apply(); })),
    ],
    Controls: () => [
      row('Mouse sensitivity', slider(0.1, 4, 0.05, settings.sens, (v) => { settings.sens = v; apply(); }, (v) => v.toFixed(2))),
      row('Scope sensitivity', slider(0.2, 2, 0.05, settings.scopeSens, (v) => { settings.scopeSens = v; apply(); }, (v) => v.toFixed(2))),
      row('Touch sensitivity', slider(0.2, 3, 0.05, settings.touchSens, (v) => { settings.touchSens = v; apply(); }, (v) => v.toFixed(2))),
      row('Invert Y', toggle(settings.invertY, (v) => { settings.invertY = v; apply(); })),
      row('Bot difficulty', seg([['easy', 'EASY'], ['normal', 'NORMAL'], ['hard', 'HARD']], settings.botDifficulty, (v) => { settings.botDifficulty = v; apply(); })),
    ],
    Crosshair: () => {
      const c = settings.crosshair;
      const prev = el('div', { class: 'ch-preview' }, el('div', { class: 'crosshair static' }, ...[0, 1, 2, 3, 4].map(() => el('i'))));
      const draw = () => {
        const b = prev.firstChild.children, g = c.gap, L = c.size, T = c.thick;
        const set = (e, x, y, w, h) => Object.assign(e.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', background: c.color, boxShadow: c.outline ? '0 0 0 1px rgba(0,0,0,.85)' : 'none' });
        set(b[0], -T / 2, -g - L, T, L); set(b[1], -T / 2, g, T, L); set(b[2], -g - L, -T / 2, L, T); set(b[3], g, -T / 2, L, T); set(b[4], -T / 2, -T / 2, T, T); b[4].style.display = c.dot ? 'block' : 'none';
      };
      const upd = (k) => (v) => { c[k] = v; draw(); apply(); };
      const color = el('input', { type: 'color', value: c.color }); color.addEventListener('input', () => upd('color')(color.value));
      setTimeout(draw, 0);
      return [prev, row('Color', color), row('Size', slider(2, 20, 1, c.size, upd('size'))), row('Gap', slider(0, 16, 1, c.gap, upd('gap'))), row('Thickness', slider(1, 6, 1, c.thick, upd('thick'))),
        row('Center dot', toggle(c.dot, upd('dot'))), row('Outline', toggle(c.outline, upd('outline'))), row('Dynamic (spread)', toggle(c.dynamic, upd('dynamic')))];
    },
    Audio: () => [row('Master volume', slider(0, 1, 0.01, settings.volume, (v) => { settings.volume = v; audio.setVolume(v); saveSettings(); }, (v) => Math.round(v * 100) + '%'))],
  };
  const render = () => {
    tabBar.innerHTML = '';
    tabs.forEach((t) => tabBar.appendChild(el('button', { class: t === current ? 'on' : '', onclick: () => { current = t; render(); } }, t.toUpperCase())));
    body.innerHTML = '';
    pages[current]().forEach((r) => body.appendChild(r));
  };
  render();
  const close = () => { root.remove(); saveSettings(); onClose && onClose(); };
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  document.getElementById('ui').appendChild(root);
  void preset;
  return root;
}
