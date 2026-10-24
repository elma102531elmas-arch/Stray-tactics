// PluginManager: the only place that starts plugin/script code. Nothing here runs on load, import or project open —
// a record must be APPROVED (reviewed by the user in this browser, code hash + permissions matching) before start()/runScript() will launch a sandbox.

import { download } from './dom.js';
import { confirmBox } from './dialogs.js';
import { Sandbox } from './sandbox.js';
import { Approvals, ApiRouter, ApiError, editorApi, commitOps, jsonSafe, LIMITS, KIND_PERMISSIONS, validateRecord } from '../core/plugins.js';

const STORE_KEY = 'smstudio.approvals';
let memory = {};
const store = {
  get() { try { const v = JSON.parse(localStorage.getItem(STORE_KEY)); if (v && typeof v === 'object') return v; } catch { /* blocked or corrupt */ } return memory; },
  set(o) { memory = o; try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch { /* blocked: approvals last for this session */ } },
};
const EDITOR_NAMES = ['log', 'notify', 'scene.find', 'scene.get', 'scene.selection', 'scene.create', 'scene.update', 'scene.remove', 'project.get', 'download'];

export class PluginManager {
  constructor(app) {
    this.app = app; app.plugins = this;
    this.approvals = new Approvals(store);
    this.running = new Map();                 // record id -> { record, sandbox, granted, ctx, commands, actionIds }
    this.state = new Map();                   // record id -> { status, message }
    this.console = [];
    this.router = editorApi(app, { download: (rec, name, text) => this.askDownload(rec, name, text) });
    this.router.define('log', '', (ctx, [level, text]) => { ctx.logs = (ctx.logs || 0) + 1; if (ctx.logs <= LIMITS.logsPerRun) this.print(['info', 'warn', 'error'].includes(level) ? level : 'info', ctx.record, String(text).slice(0, 2000)); return null; });
    this.router.define('ui.register', 'ui.menu', (ctx, [label]) => { if (typeof label !== 'string' || !label.trim() || label.length > 80) throw new ApiError('Command labels must be 1–80 characters.'); if (ctx.registered.length >= 30) throw new ApiError('At most 30 commands per plugin.'); ctx.registered.push(label); return null; });
    this.router.define('ui.validator', 'ui.validate', (ctx) => { ctx.validator = true; return null; });
    app.on('project', () => { this.stopAll(); this.state.clear(); this.console = []; app.emit('plugins'); });
  }

  // ------------------------------------------------------------------ records
  list(kind) { const d = this.app.project.data; return Object.values(kind === 'script' ? d.scripts || {} : d.plugins || {}).filter((r) => r && typeof r === 'object' && r.id); }
  find(kind, idOrName) { return this.list(kind).find((r) => r.id === idOrName) || this.list(kind).find((r) => r.name === idOrName) || null; }
  projectId() { return this.app.project.meta.id; }
  async status(rec) {
    const run = this.running.get(rec.id);
    if (run?.sandbox.alive) return { state: 'running' };
    const bad = validateRecord(rec).filter((m) => m.severity === 'error');
    if (bad.length) return { state: 'invalid', message: bad[0].message };
    const a = await this.approvals.status(this.projectId(), rec);
    const st = this.state.get(rec.id);
    if (a.state === 'approved' && st?.status === 'failed') return { state: 'failed', message: st.message };
    return a;
  }
  granted(rec) { return new Set((rec.permissions || []).filter((p) => (KIND_PERMISSIONS[rec.kind] || []).includes(p))); }
  print(level, rec, text) {
    const line = { t: Date.now(), level, plugin: rec.name, id: rec.id, text };
    this.console.push(line); if (this.console.length > 500) this.console.shift();
    this.app.emit('plugins-console', line);
    if (level !== 'info') this.app.log(level === 'error' ? 'error' : 'warn', `[${rec.name}] ${text}`);
  }
  fail(rec, message) { this.state.set(rec.id, { status: 'failed', message }); this.print('error', rec, message); this.app.emit('plugins'); }

  // ------------------------------------------------------------------ plugins (editor extensions)
  async start(rec) {
    const st = await this.approvals.status(this.projectId(), rec);
    if (st.state !== 'approved') throw new ApiError(st.state === 'changed' ? 'This plugin changed since you approved it. Review it again.' : 'This plugin has not been approved. Review and approve it first.');
    this.stop(rec.id);
    const granted = this.granted(rec);
    const run = { record: rec, granted, ctx: { record: rec, granted, ops: [], calls: 0, registered: [], validator: false }, commands: [], actionIds: [] };
    run.sandbox = new Sandbox({
      code: rec.code, api: EDITOR_NAMES, ctx: { plugin: rec.name },
      onRpc: (method, args) => this.router.call(run.ctx, method, args),
      onCrash: (reason, kind) => { this.fail(rec, `Stopped: ${reason}`); this.unregister(run); this.running.delete(rec.id); },
    });
    this.running.set(rec.id, run);
    this.state.delete(rec.id);
    try { await run.sandbox.start(LIMITS.timeoutMs.load); }
    catch (e) { this.running.delete(rec.id); run.sandbox.kill('failed to start', 'stopped'); this.fail(rec, e.message); throw e; }
    if (run.ctx.ops?.length) { this.print('warn', rec, 'Changes made while loading are ignored — make them inside a command.'); }
    run.commands = run.ctx.registered.filter((l) => run.sandbox.registered.includes(l));
    for (const label of run.commands) {
      const id = `plugin:${rec.id}:${label}`;
      this.app.register({ id, label: `${rec.name}: ${label}`, menu: 'Plugins', group: rec.id, run: () => this.runCommand(rec.id, label) });
      run.actionIds.push(id);
    }
    this.app.emit('actions'); this.app.emit('plugins');
    this.print('info', rec, `Started (${run.commands.length} command${run.commands.length === 1 ? '' : 's'}${run.sandbox.hasValidator ? ', validator' : ''}). Permissions: ${[...granted].join(', ') || 'none'}.`);
    return run;
  }
  unregister(run) { for (const id of run.actionIds) this.app.actions.delete(id); run.actionIds = []; this.app.emit('actions'); }
  stop(id) {
    const run = this.running.get(id); if (!run) return;
    this.running.delete(id); run.sandbox.kill('stopped by you', 'stopped'); this.unregister(run);
    this.print('info', run.record, 'Stopped.'); this.app.emit('plugins');
  }
  stopAll() { for (const id of [...this.running.keys()]) this.stop(id); }

  async runCommand(id, label) {
    const run = this.running.get(id); if (!run?.sandbox.alive) { this.app.toast('That plugin is not running.', 'error'); return; }
    run.ctx = { record: run.record, granted: run.granted, ops: [], calls: 0, registered: run.ctx.registered, validator: run.ctx.validator };
    const t0 = performance.now();
    try {
      await run.sandbox.invoke(label, [], LIMITS.timeoutMs.command);
      const n = commitOps(this.app, run.ctx, `Plugin “${run.record.name}”: ${label}`);
      this.print('info', run.record, `“${label}” finished in ${Math.round(performance.now() - t0)} ms${n ? `, ${n} change${n === 1 ? '' : 's'} applied (one undo step)` : ''}.`);
    } catch (e) {
      this.print('error', run.record, `“${label}” failed: ${e.message}. No changes were applied.`);
      this.app.toast(`${run.record.name}: ${e.message}`, 'error');
    }
  }

  /** Issues contributed by running plugins that hold ui.validate. Never throws; a misbehaving validator is reported as one issue. */
  async validate() {
    const out = [];
    for (const run of this.running.values()) {
      if (!run.sandbox.alive || !run.sandbox.hasValidator || !run.granted.has('ui.validate')) continue;
      run.ctx = { record: run.record, granted: run.granted, ops: [], calls: 0, registered: run.ctx.registered, validator: true };
      try {
        const list = await run.sandbox.validate(LIMITS.timeoutMs.validate);
        for (const i of (Array.isArray(list) ? list : []).slice(0, 200)) {
          if (!i || typeof i.message !== 'string') continue;
          out.push({ code: `plugin:${run.record.name}`, severity: ['error', 'warn', 'info'].includes(i.severity) ? i.severity : 'warn', message: `[${run.record.name}] ${i.message.slice(0, 300)}`, nodes: (Array.isArray(i.nodes) ? i.nodes : []).filter((n) => typeof n === 'string' && this.app.scene.has(n)).slice(0, 20), source: 'plugin' });
        }
      } catch (e) { out.push({ code: `plugin:${run.record.name}`, severity: 'warn', message: `[${run.record.name}] its validator failed: ${e.message}`, nodes: [] }); }
    }
    return out;
  }

  // ------------------------------------------------------------------ scripts (run inside the playtest)
  /**
   * Run one script to completion. methods = { 'game.say': ['game.write', fn(ctx, args)], ... } supplied by the playtest.
   * Resolves { ok, ms } — failures never throw into the playtest; they are logged and returned.
   */
  async runScript(rec, { ctx = {}, methods = {} } = {}) {
    const st = await this.approvals.status(this.projectId(), rec);
    if (st.state !== 'approved') { const msg = st.state === 'changed' ? `Script “${rec.name}” changed since you approved it, so it was not run.` : `Script “${rec.name}” has not been approved, so it was not run. Open the Plugins tab to review it.`; this.print('warn', rec, msg); return { ok: false, skipped: true, message: msg }; }
    const granted = this.granted(rec);
    const router = new ApiRouter();
    for (const n of ['log', 'scene.find', 'scene.get']) router.methods.set(n, this.router.methods.get(n));
    for (const [name, [perm, fn]] of Object.entries(methods)) router.define(name, perm, fn);
    const rpcCtx = { record: rec, granted, calls: 0 };
    const sb = new Sandbox({ code: rec.code, api: ['log', 'scene.find', 'scene.get'], game: Object.keys(methods).map((n) => n.replace(/^game\./, '')), ctx: jsonSafe(ctx), onRpc: (m, a) => router.call(rpcCtx, m, a) });
    const t0 = performance.now();
    try { await sb.start(LIMITS.timeoutMs.script); this.print('info', rec, `Ran in ${Math.round(performance.now() - t0)} ms.`); return { ok: true, ms: performance.now() - t0 }; }
    catch (e) { this.print('error', rec, `Failed: ${e.message}`); return { ok: false, message: e.message }; }
    finally { sb.kill('finished', 'stopped'); }
  }

  // ------------------------------------------------------------------ downloads asked for by plugins: always confirmed by the user
  async askDownload(rec, name, text) {
    const ok = await confirmBox('Plugin wants to save a file', `“${rec.name}” wants to save a file named “${name}” (${(text.length / 1024).toFixed(1)} KB).\n\nThe file is not written anywhere until you confirm; your browser will then ask where to save it.`, { ok: 'Save file' });
    if (ok) download(name, text, 'text/plain');
    return ok;
  }
}
