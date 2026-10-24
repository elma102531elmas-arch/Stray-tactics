// Persistent storage for projects and asset blobs.
//   IndexedDBStorage  – real browser persistence (large blobs, survives reloads)
//   MemoryStorage     – same interface, used by Node unit tests and as a fallback when IndexedDB is blocked
// Keys:  blobs: `${projectId}/${assetId}/${path}`   projects: projectId   autosave: projectId

export class MemoryStorage {
  constructor() { this.kind = 'memory'; this.blobs = new Map(); this.projects = new Map(); this.auto = new Map(); this.backups = new Map(); }
  async putBlob(key, blob) { this.blobs.set(key, blob); }
  async getBlob(key) { return this.blobs.get(key) || null; }
  async deleteBlob(key) { this.blobs.delete(key); }
  async listBlobKeys(prefix = '') { return [...this.blobs.keys()].filter((k) => k.startsWith(prefix)); }
  async putProject(id, json) { this.projects.set(id, { json, time: Date.now() }); }
  async getProject(id) { return this.projects.get(id)?.json ?? null; }
  async listProjects() { return [...this.projects.entries()].map(([id, v]) => ({ id, time: v.time, name: safeName(v.json) })); }
  async deleteProject(id) { this.projects.delete(id); this.auto.delete(id); }
  async putAutosave(id, json) { this.auto.set(id, { json, time: Date.now() }); }
  async getAutosave(id) { return this.auto.get(id) || null; }
  async clearAutosave(id) { this.auto.delete(id); }
  async putBackup(id, json) { const l = this.backups.get(id) || []; l.unshift({ json, time: Date.now() }); this.backups.set(id, l.slice(0, 10)); }
  async listBackups(id) { return (this.backups.get(id) || []).map((b, i) => ({ index: i, time: b.time })); }
  async getBackup(id, index) { return this.backups.get(id)?.[index]?.json ?? null; }
  async estimate() { let n = 0; for (const b of this.blobs.values()) n += b.size || b.byteLength || 0; return { usage: n, quota: Infinity }; }
}

function safeName(json) { try { return JSON.parse(json).meta?.name || 'Untitled'; } catch { return 'Untitled'; } }

const DB = 'saint-marrow-studio';
const VERSION = 1;

export class IndexedDBStorage {
  constructor() { this.kind = 'indexeddb'; this.dbp = null; }
  _db() {
    if (this.dbp) return this.dbp;
    this.dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ['blobs', 'projects', 'autosave', 'backups']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('IndexedDB is unavailable: ' + (req.error?.message || 'unknown error')));
      req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab.'));
    });
    return this.dbp;
  }
  async _tx(store, mode, fn) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      let result;
      Promise.resolve(fn(tx.objectStore(store))).then((r) => { result = r; }).catch(reject);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted (quota exceeded?)'));
    });
  }
  _req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  putBlob(key, blob) { return this._tx('blobs', 'readwrite', (s) => this._req(s.put(blob, key))); }
  getBlob(key) { return this._tx('blobs', 'readonly', (s) => this._req(s.get(key))).then((v) => v || null); }
  deleteBlob(key) { return this._tx('blobs', 'readwrite', (s) => this._req(s.delete(key))); }
  listBlobKeys(prefix = '') {
    return this._tx('blobs', 'readonly', (s) => this._req(s.getAllKeys())).then((keys) => keys.filter((k) => String(k).startsWith(prefix)));
  }
  putProject(id, json) { return this._tx('projects', 'readwrite', (s) => this._req(s.put({ json, time: Date.now() }, id))); }
  getProject(id) { return this._tx('projects', 'readonly', (s) => this._req(s.get(id))).then((v) => v?.json ?? null); }
  async listProjects() {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const out = [];
      const tx = db.transaction('projects', 'readonly');
      const req = tx.objectStore('projects').openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out.push({ id: c.key, time: c.value.time, name: safeName(c.value.json) }); c.continue(); } };
      tx.oncomplete = () => resolve(out.sort((a, b) => b.time - a.time));
      tx.onerror = () => reject(tx.error);
    });
  }
  async deleteProject(id) { await this._tx('projects', 'readwrite', (s) => this._req(s.delete(id))); await this.clearAutosave(id); }
  putAutosave(id, json) { return this._tx('autosave', 'readwrite', (s) => this._req(s.put({ json, time: Date.now() }, id))); }
  getAutosave(id) { return this._tx('autosave', 'readonly', (s) => this._req(s.get(id))).then((v) => v || null); }
  clearAutosave(id) { return this._tx('autosave', 'readwrite', (s) => this._req(s.delete(id))); }
  async putBackup(id, json) {
    const cur = (await this._tx('backups', 'readonly', (s) => this._req(s.get(id)))) || [];
    cur.unshift({ json, time: Date.now() });
    return this._tx('backups', 'readwrite', (s) => this._req(s.put(cur.slice(0, 10), id)));
  }
  async listBackups(id) { const l = (await this._tx('backups', 'readonly', (s) => this._req(s.get(id)))) || []; return l.map((b, i) => ({ index: i, time: b.time })); }
  async getBackup(id, index) { const l = (await this._tx('backups', 'readonly', (s) => this._req(s.get(id)))) || []; return l[index]?.json ?? null; }
  async estimate() { try { return await navigator.storage.estimate(); } catch { return { usage: 0, quota: 0 }; } }
}

export function createStorage() {
  if (typeof indexedDB === 'undefined') return new MemoryStorage();
  return new IndexedDBStorage();
}
