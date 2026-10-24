// Select tool: click to select, shift/ctrl-click to toggle, drag empty space for a marquee,
// drag a selected object to slide it over the work plane (grid-snapped).

import * as THREE from '../../lib/three.module.js';
import { setTransforms } from '../core/commands.js';
import { nodeWorldAABB } from '../core/geometry.js';

export class SelectTool {
  constructor() { this.id = 'select'; this.cursor = 'default'; this.state = null; }

  activate() { this.vp.sceneView.setHover(null); }
  deactivate() { this._hideMarquee(); this.vp.sceneView.setHover(null); this.state = null; }

  hover(info) {
    const hit = this.vp.pick(info.ev.clientX, info.ev.clientY);
    this.vp.sceneView.setHover(hit ? hit.id : null);
    this.vp.canvas.style.cursor = hit ? 'pointer' : 'default';
  }

  pointerDown(info) {
    const hit = this.vp.pick(info.ev.clientX, info.ev.clientY);
    this.state = { x: info.ev.clientX, y: info.ev.clientY, hit, mode: 'pending', add: info.shift || info.ctrl, info };
  }

  pointerMove(info) {
    const s = this.state;
    if (!s) return;
    const dist = Math.hypot(info.ev.clientX - s.x, info.ev.clientY - s.y);
    if (s.mode === 'pending' && dist > 4) {
      const app = this.app;
      if (s.hit && app.selection.includes(s.hit.id) && !s.add && !app.scene.isLocked(s.hit.id)) this._beginMove(s, info);
      else s.mode = 'marquee';
    }
    if (s.mode === 'marquee') this._marquee(s, info);
    else if (s.mode === 'move') this._move(s, info);
  }

  pointerUp(info) {
    const s = this.state; this.state = null;
    if (!s) return;
    const app = this.app;
    if (s.mode === 'pending') {
      if (s.hit) app.select([s.hit.id], s.add ? { toggle: true } : {});
      else if (!s.add) app.select([]);
    } else if (s.mode === 'marquee') {
      const ids = this._marqueeIds(s, info);
      this._hideMarquee();
      app.select(ids, s.add ? { add: true } : {});
    } else if (s.mode === 'move') this._endMove(s);
  }

  // ------------------------------------------------------------ marquee
  _marquee(s, info) {
    const el = this._marqueeEl();
    const r = this.vp.canvas.getBoundingClientRect();
    const x0 = Math.min(s.x, info.ev.clientX) - r.left, y0 = Math.min(s.y, info.ev.clientY) - r.top;
    const w = Math.abs(info.ev.clientX - s.x), h = Math.abs(info.ev.clientY - s.y);
    Object.assign(el.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: h + 'px' });
  }
  _marqueeEl() {
    if (!this.el) { this.el = document.createElement('div'); this.el.className = 'marquee'; this.vp.container.appendChild(this.el); }
    return this.el;
  }
  _hideMarquee() { if (this.el) this.el.style.display = 'none'; }
  _marqueeIds(s, info) {
    const vp = this.vp, scene = this.app.scene;
    const r = vp.canvas.getBoundingClientRect();
    const rect = { x0: Math.min(s.x, info.ev.clientX) - r.left, x1: Math.max(s.x, info.ev.clientX) - r.left, y0: Math.min(s.y, info.ev.clientY) - r.top, y1: Math.max(s.y, info.ev.clientY) - r.top };
    const out = [];
    const v = new THREE.Vector3();
    scene.walk((n) => {
      if (!scene.isVisible(n.id)) return false;
      if (n.type === 'group' || scene.isLocked(n.id)) return;
      const c = nodeWorldAABB(scene, n.id, vp.app.project.geoCtx).getCenter(v);
      c.project(vp.camera);
      if (c.z < -1 || c.z > 1) return;
      const x = ((c.x + 1) / 2) * r.width, y = ((1 - c.y) / 2) * r.height;
      if (x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1) out.push(n.id);
    });
    return out;
  }

  // ------------------------------------------------------------ drag-move on the work plane
  _beginMove(s, info) {
    const app = this.app, scene = app.scene;
    const ids = app.topSelection().filter((id) => !scene.isLocked(id));
    const y = s.hit.point.y;
    const p0 = this.vp.groundPoint(info.ev.clientX, info.ev.clientY, y);
    if (!p0 || !ids.length) { s.mode = 'marquee'; return; }
    s.mode = 'move';
    s.move = { y, p0, nodes: ids.map((id) => ({ id, from: JSON.parse(JSON.stringify(scene.get(id).t)), world: scene.worldMatrix(id).clone() })) };
    s.moved = false;
  }
  _move(s, info) {
    const m = s.move, scene = this.app.scene;
    const p = this.vp.groundPoint(info.ev.clientX, info.ev.clientY, m.y);
    if (!p) return;
    const d = p.clone().sub(m.p0);
    // snap so the PRIMARY object's origin lands on the grid
    const first = m.nodes.at(-1);
    const o = new THREE.Vector3().setFromMatrixPosition(first.world);
    const target = this.vp.snap(o.clone().add(d), info.ctrl);
    d.copy(target.sub(o)); d.y = 0;
    for (const n of m.nodes) {
      const w = n.world.clone(); w.setPosition(new THREE.Vector3().setFromMatrixPosition(n.world).add(d));
      scene.setTransform(n.id, scene.localTransformFromWorld(scene.get(n.id).parent, w));
    }
    s.moved = true;
    this.vp.sceneView.refreshOutlines();
  }
  _endMove(s) {
    if (!s.moved) return;
    const scene = this.app.scene;
    const items = s.move.nodes.map((n) => ({ id: n.id, from: n.from, t: JSON.parse(JSON.stringify(scene.get(n.id).t)) }));
    this.app.exec(setTransforms(items, { label: items.length > 1 ? `Move ${items.length} objects` : 'Move' }));
  }
}
