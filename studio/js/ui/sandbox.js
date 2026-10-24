// Runs approved plugin/script code in a sandbox and brokers its calls to the editor.
//
//   Studio page ──postMessage──▶ <iframe sandbox="allow-scripts" srcdoc> (opaque origin, its own CSP) ──▶ Worker (plugin code)
//
//  • The iframe has NO same-origin access (no DOM, cookies, localStorage, IndexedDB of the Studio) and its CSP is
//    `default-src 'none'; connect-src 'none'; …`, which the Worker inherits: fetch, XHR, WebSocket, importScripts() and import() fail.
//  • Inside the worker, network/storage/worker globals are deleted before the plugin code is compiled, so even tricks that reach the
//    global object (`(()=>{}).constructor('return this')()`) find nothing.
//  • The worker can only ask the editor to do things through postMessage RPC. The editor (core/plugins.js ApiRouter) checks every call against the
//    permissions the user approved; the sandbox is NOT what stops a plugin from editing your map, the permission check is.
//  • Time limits: a loop that never ends blocks only the worker; the editor notices the missing reply, removes the iframe (which kills the
//    worker) and reports a timeout. Memory is NOT limited (see docs/KNOWN_LIMITATIONS.md).
//
// Honest limits: this is a best-effort browser sandbox. It does not defend against browser bugs, memory exhaustion or CPU use inside the time
// limit, and approving a plugin you have not read is still a risk. Only approve code you have read or trust.

import { jsonSafe, LIMITS } from '../core/plugins.js';

/** Source of the worker. Runs inside the sandbox; deliberately small and dependency-free. */
export const WORKER_SRC = String.raw`
'use strict';
const post = self.postMessage.bind(self), listen = self.addEventListener.bind(self);
const SCRUB = ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','Worker','SharedWorker','indexedDB','IDBFactory','IDBDatabase','caches','CacheStorage','BroadcastChannel','WebTransport','navigator','location','Notification','postMessage','close','Response','Request','Headers','FormData','XMLHttpRequestUpload','BackgroundFetchManager','MessageChannel','MessagePort','WebSocketStream','FileReaderSync','BarcodeDetector','RTCPeerConnection','WebAssembly'];
for (let o = self; o; o = Object.getPrototypeOf(o)) for (const n of SCRUB) {
  try { delete o[n]; } catch (e) {}
  try { if (n in o) Object.defineProperty(o, n, { value: undefined, writable: false, configurable: false }); } catch (e) {}
}
const pending = new Map(); let nextId = 1;
const rpc = (method, args) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); post({ t: 'rpc', id, method, args }); });
const commands = new Map(); let validator = null;
const build = (names, prefix) => { const root = {}; for (const full of names) { const parts = full.split('.'); let o = root; for (const p of parts.slice(0, -1)) o = (o[p] = o[p] || {}); o[parts.at(-1)] = (...a) => rpc((prefix || '') + full, a); } return root; };
const fmt = (v) => { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { return String(v); } };
const con = { log: (...a) => rpc('log', ['info', a.map(fmt).join(' ')]), info: (...a) => rpc('log', ['info', a.map(fmt).join(' ')]), warn: (...a) => rpc('log', ['warn', a.map(fmt).join(' ')]), error: (...a) => rpc('log', ['error', a.map(fmt).join(' ')]) };
let ready = false;
listen('message', async (e) => {
  const m = e.data;
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'rpc-result') { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); if (m.ok) p.resolve(m.value); else { const err = new Error(m.error && m.error.message || 'failed'); err.name = m.error && m.error.name || 'Error'; p.reject(err); } return; }
  try {
    if (m.t === 'init' && !ready) {
      ready = true;
      const api = build(m.api || [], ''), game = build(m.game || [], 'game.');
      api.command = (label, fn) => { if (typeof label !== 'string' || typeof fn !== 'function') throw new TypeError('api.command(label, fn)'); commands.set(label, fn); return rpc('ui.register', [label]); };
      api.validator = (fn) => { if (typeof fn !== 'function') throw new TypeError('api.validator(fn)'); validator = fn; return rpc('ui.validator', []); };
      api.log = (level, text) => rpc('log', [level, fmt(text)]);
      const ctx = Object.freeze(JSON.parse(JSON.stringify(m.ctx || {})));
      const AsyncFunction = (async () => {}).constructor;
      const fn = new AsyncFunction('api', 'game', 'ctx', 'console', '"use strict";\n' + m.code);
      post({ t: 'compiled' });
      await fn(api, game, ctx, con);
      post({ t: 'ready', commands: [...commands.keys()], validator: !!validator });
    } else if (m.t === 'invoke') {
      const f = commands.get(m.label); if (!f) throw new Error('No such command: ' + m.label);
      const v = await f(...(m.args || []));
      post({ t: 'done', id: m.id, value: v === undefined ? null : v });
    } else if (m.t === 'validate') {
      if (!validator) { post({ t: 'done', id: m.id, value: [] }); return; }
      post({ t: 'done', id: m.id, value: await validator() });
    }
  } catch (err) { post({ t: 'error', id: m.id || 0, name: (err && err.name) || 'Error', message: String(err && err.message || err).slice(0, 500) }); }
});
post({ t: 'booted' });
`;

const RELAY_SRC = (worker) => `
const W = ${JSON.stringify(worker)};
let worker = null;
const up = (m) => parent.postMessage(m, '*');
addEventListener('message', (e) => {
  if (e.source !== parent) return;
  const m = e.data;
  if (m && m.t === 'start' && !worker) {
    try {
      worker = new Worker(URL.createObjectURL(new Blob([W], { type: 'text/javascript' })));
      worker.onmessage = (ev) => up(ev.data);
      worker.onerror = (ev) => { ev.preventDefault(); up({ t: 'crash', message: String(ev.message || 'worker error').slice(0, 500) }); };
    } catch (err) { up({ t: 'crash', message: String(err && err.message || err) }); }
  } else if (worker) worker.postMessage(m);
});
up({ t: 'relay-ready' });
`;

const MAX_INFLIGHT = 200;

export class SandboxError extends Error { constructor(msg, kind = 'error') { super(msg); this.name = 'SandboxError'; this.kind = kind; } }

export class Sandbox {
  /**
   * opts: { code, api: [method names], game: [method names], ctx, onRpc(method, args) -> Promise<value>, onCrash?(reason) }
   * onRpc may throw; the error name/message is relayed to the code (PermissionError, ApiError …).
   */
  constructor({ code, api = [], game = [], ctx = {}, onRpc, onCrash = null, maxMessages = LIMITS.callsPerRun * 4 }) {
    this.opts = { code, api, game, ctx, onRpc, onCrash, maxMessages };
    this.state = 'new'; this.messages = 0; this.inflight = 0; this.waiters = new Map(); this.nextId = 1; this.registered = []; this.hasValidator = false;
  }

  /** Create the sandbox and run the code's top level. Resolves with { commands, validator } or rejects (timeout / error / crash). */
  start(timeoutMs = LIMITS.timeoutMs.load) {
    if (this.state !== 'new') throw new Error('Sandbox already started.');
    this.state = 'starting';
    const nonce = 'n' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    const csp = `default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval'; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');               // no allow-same-origin: opaque origin, no access to the Studio
    frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1; frame.title = 'plugin sandbox';
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-10px;top:-10px;visibility:hidden';
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><script nonce="${nonce}">${RELAY_SRC(WORKER_SRC).replace(/<\/script/gi, '<\\/script')}<\/script>`;
    this.frame = frame;
    this._onMsg = (e) => { if (e.source === frame.contentWindow) this._message(e.data); };
    window.addEventListener('message', this._onMsg);
    document.body.appendChild(frame);
    return new Promise((resolve, reject) => {
      this._startWaiter = { resolve, reject };
      this._deadline = performance.now() + timeoutMs; this._deadlineWhat = `did not finish starting within ${timeoutMs / 1000} s`;
      this._timer = setTimeout(() => this.kill(`did not finish starting within ${timeoutMs / 1000} s`, 'timeout'), timeoutMs);
    });
  }

  _post(m) { try { this.frame.contentWindow.postMessage(m, '*'); } catch { /* frame gone */ } }

  _message(m) {
    if (this.state === 'killed' || !m || typeof m !== 'object' || typeof m.t !== 'string') return;
    if (this._deadline && performance.now() > this._deadline) { this.kill(this._deadlineWhat || 'took too long and was stopped', 'timeout'); return; }      // timers can be starved by a message flood, so check the clock here too
    if (++this.messages > this.opts.maxMessages) { this.kill('sent too many messages', 'flood'); return; }
    switch (m.t) {
      case 'relay-ready': this._post({ t: 'start' }); break;
      case 'booted': this._post({ t: 'init', code: this.opts.code, api: this.opts.api, game: this.opts.game, ctx: this.opts.ctx }); break;
      case 'compiled': break;
      case 'ready': clearTimeout(this._timer); this._deadline = 0; this.state = 'ready'; this.registered = Array.isArray(m.commands) ? m.commands.filter((x) => typeof x === 'string') : []; this.hasValidator = !!m.validator; this._startWaiter?.resolve({ commands: this.registered, validator: this.hasValidator }); this._startWaiter = null; break;
      case 'rpc': this._rpc(m); break;
      case 'done': { const w = this.waiters.get(m.id); if (w) { this.waiters.delete(m.id); clearTimeout(w.timer); this._deadline = 0; try { w.resolve(jsonSafe(m.value)); } catch (e) { w.reject(new SandboxError(e.message)); } } break; }
      case 'error': {
        const err = new SandboxError(`${m.name || 'Error'}: ${String(m.message || '').slice(0, 500)}`);
        const w = this.waiters.get(m.id);
        if (w) { this.waiters.delete(m.id); clearTimeout(w.timer); w.reject(err); }
        else if (this._startWaiter) { clearTimeout(this._timer); this._startWaiter.reject(err); this._startWaiter = null; this.kill(err.message, 'error'); }
        break;
      }
      case 'crash': this.kill(String(m.message || 'the worker crashed'), 'crash'); break;
      default: break;                                                                              // unknown message types are ignored
    }
  }

  async _rpc(m) {
    if (typeof m.id !== 'number' || typeof m.method !== 'string' || m.method.length > 60 || !Array.isArray(m.args)) return;    // malformed: ignore
    // honest code waits for each answer; a flood of unanswered requests is an attack on the editor's event loop, so stop it early
    if (++this.inflight > MAX_INFLIGHT) { this.inflight--; this.kill(`sent more than ${MAX_INFLIGHT} requests without waiting for answers`, 'flood'); return; }
    let reply;
    try { reply = { t: 'rpc-result', id: m.id, ok: true, value: await this.opts.onRpc(m.method, m.args) }; }
    catch (e) { reply = { t: 'rpc-result', id: m.id, ok: false, error: { name: String(e.name || 'Error').slice(0, 40), message: String(e.message || e).slice(0, 500) } }; }
    this.inflight--;
    if (this.state !== 'killed') this._post(reply);
  }

  /** Run a registered command (plugins). Resolves with its (JSON) result; a timeout kills the sandbox. */
  invoke(label, args = [], timeoutMs = LIMITS.timeoutMs.command) {
    return this._request({ t: 'invoke', label, args }, timeoutMs);
  }
  validate(timeoutMs = LIMITS.timeoutMs.validate) { return this._request({ t: 'validate' }, timeoutMs); }
  _request(msg, timeoutMs) {
    if (this.state !== 'ready') return Promise.reject(new SandboxError(`The sandbox is ${this.state}.`));
    const id = this.nextId++;
    this._deadline = performance.now() + timeoutMs; this._deadlineWhat = `took longer than ${timeoutMs / 1000} s and was stopped`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.kill(`took longer than ${timeoutMs / 1000} s and was stopped`, 'timeout'), timeoutMs);
      this.waiters.set(id, { resolve, reject, timer });
      this._post({ ...msg, id });
    });
  }

  /** Remove the iframe (this terminates the worker, even if it is stuck in a loop) and fail everything pending. */
  kill(reason = 'stopped', kind = 'stopped') {
    if (this.state === 'killed') return;
    const was = this.state; this.state = 'killed'; this.reason = reason; this.killKind = kind;
    clearTimeout(this._timer);
    window.removeEventListener('message', this._onMsg);
    this.frame?.remove(); this.frame = null;
    const err = new SandboxError(reason, kind);
    for (const [, w] of this.waiters) { clearTimeout(w.timer); w.reject(err); }
    this.waiters.clear();
    this._startWaiter?.reject(err); this._startWaiter = null;
    if (kind !== 'stopped') this.opts.onCrash?.(reason, kind, was);
  }
  get alive() { return this.state === 'ready' || this.state === 'starting'; }
}
