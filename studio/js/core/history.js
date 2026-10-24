// Undo/redo. Every mutation of project data or the scene is a Command executed here.
//   Command = { label, do(ctx), undo(ctx), mergeKey?, mergeWith?(prevCmd) -> bool }
// Consecutive commands with the same mergeKey inside MERGE_MS are folded together so
// dragging a slider or typing a number produces a single undo step.

import { Emitter } from './util.js';

const MERGE_MS = 900;
const LIMIT = 500;

export class History extends Emitter {
  constructor(ctx) {
    super();
    this.ctx = ctx;
    this.undoStack = [];
    this.redoStack = [];
    this._tx = null;
    this._lastTime = 0;
    this.revision = 0;      // increments on every do/undo/redo (dirty tracking)
    this.savedRevision = 0;
  }

  get dirty() { return this.revision !== this.savedRevision; }
  markSaved() { this.savedRevision = this.revision; this.emit('change'); }
  clear() { this.undoStack = []; this.redoStack = []; this._tx = null; this.revision = 0; this.savedRevision = 0; this.emit('change'); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack.at(-1)?.label || ''; }
  get redoLabel() { return this.redoStack.at(-1)?.label || ''; }

  exec(cmd, { now = Date.now() } = {}) {
    const result = cmd.do(this.ctx);
    cmd.result = result;
    this.revision++;
    if (this._tx) { this._tx.cmds.push(cmd); this.emit('change'); return result; }
    const prev = this.undoStack.at(-1);
    if (prev && cmd.mergeKey && prev.mergeKey === cmd.mergeKey && now - this._lastTime < MERGE_MS && prev.mergeWith?.(cmd)) {
      // folded into prev; prev.undo already restores the original state
    } else {
      this.undoStack.push(cmd);
      if (this.undoStack.length > LIMIT) this.undoStack.shift();
    }
    this._lastTime = now;
    this.redoStack = [];
    this.emit('change');
    return result;
  }

  /** Group several commands into one undo step. */
  transaction(label, fn) {
    this.begin(label);
    try { return fn(); } finally { this.end(); }
  }
  begin(label) {
    if (this._tx) { this._tx.depth++; return; }
    this._tx = { label, cmds: [], depth: 1 };
  }
  end() {
    const tx = this._tx;
    if (!tx) return;
    if (--tx.depth > 0) return;
    this._tx = null;
    if (!tx.cmds.length) return;
    const cmds = tx.cmds;
    const batch = {
      label: tx.label,
      do: (ctx) => { for (const c of cmds) c.do(ctx); },
      undo: (ctx) => { for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo(ctx); },
    };
    this.undoStack.push(batch);
    this.redoStack = [];
    this.emit('change');
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo(this.ctx);
    this.revision--;
    this.redoStack.push(cmd);
    this.emit('change');
    this.emit('undo', cmd);
    return true;
  }
  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.do(this.ctx);
    this.revision++;
    this.undoStack.push(cmd);
    this.emit('change');
    this.emit('redo', cmd);
    return true;
  }
}
