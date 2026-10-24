// A small code editor for plugin/script text: line numbers, syntax highlighting from acorn's tokenizer, auto-indent, Tab handling,
// error/warning markers in the gutter. Deliberately simple (a transparent <textarea> over a highlighted <pre>) so it is easy to audit.
import * as acorn from '../../lib/acorn.mjs';
import { h, esc } from './dom.js';

const BUILTINS = new Set(['api', 'game', 'ctx', 'console']);

/** Highlighted HTML for `code`. Never throws: where the tokenizer gives up the rest is shown plain. */
export function highlight(code) {
  const segs = [];
  try {
    for (const t of acorn.tokenizer(code, { ecmaVersion: 'latest', allowHashBang: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, onComment: (block, text, start, end) => segs.push({ start, end, cls: 'c' }) })) {
      const l = t.type.label;
      let cls = '';
      if (t.type.keyword || l === 'true' || l === 'false' || l === 'null') cls = 'k';
      else if (l === 'string' || l === 'template' || l === '`') cls = 's';
      else if (l === 'num') cls = 'd';
      else if (l === 'regexp') cls = 'r';
      else if (l === 'name') cls = BUILTINS.has(code.slice(t.start, t.end)) ? 'b' : '';
      if (cls) segs.push({ start: t.start, end: t.end, cls });
    }
  } catch { /* tokenizer error: keep what we have */ }
  segs.sort((a, b) => a.start - b.start);
  let out = '', pos = 0;
  for (const s of segs) { if (s.start < pos) continue; out += esc(code.slice(pos, s.start)) + `<span class="ce-${s.cls}">${esc(code.slice(s.start, s.end))}</span>`; pos = s.end; }
  return out + esc(code.slice(pos));
}

export class CodeEditor {
  /** opts: { value, readOnly, onChange(value), minHeight } */
  constructor(container, { value = '', readOnly = false, onChange = null, height = '100%' } = {}) {
    this.onChange = onChange; this.findings = [];
    this.gutter = h('div', { class: 'ce-gutter', 'aria-hidden': 'true' });
    this.code = h('code');
    this.pre = h('pre', { class: 'ce-hl', 'aria-hidden': 'true' }, this.code);
    this.ta = h('textarea', { class: 'ce-ta', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off', 'aria-label': 'Code', readonly: readOnly });
    this.el = h('div', { class: 'ce' + (readOnly ? ' ro' : ''), style: { height } }, this.gutter, h('div', { class: 'ce-body' }, this.pre, this.ta));
    container.appendChild(this.el);
    this.ta.value = value; this.paint();
    this.ta.addEventListener('input', () => { this.paint(); this.onChange?.(this.ta.value); });
    this.ta.addEventListener('scroll', () => { this.pre.scrollTop = this.ta.scrollTop; this.pre.scrollLeft = this.ta.scrollLeft; this.gutter.scrollTop = this.ta.scrollTop; });
    this.ta.addEventListener('keydown', (e) => this.key(e));
  }

  get value() { return this.ta.value; }
  setValue(v) { this.ta.value = v; this.paint(); }
  focus() { this.ta.focus(); }

  paint() {
    const v = this.ta.value;
    this.code.innerHTML = highlight(v) + '\n';                                   // trailing newline keeps the last empty line scrollable
    const n = v.split('\n').length, marks = new Map();
    for (const f of this.findings) { const cur = marks.get(f.line); const rank = { error: 4, danger: 3, warn: 2, info: 1 }; if (!cur || rank[f.severity] > rank[cur]) marks.set(f.line, f.severity); }
    this.gutter.replaceChildren(...Array.from({ length: n }, (_, i) => h('div', { class: 'ce-ln' + (marks.has(i + 1) ? ' m-' + marks.get(i + 1) : ''), title: this.findings.filter((f) => f.line === i + 1).map((f) => f.message).join('\n') }, String(i + 1))));
    this.gutter.scrollTop = this.ta.scrollTop;
  }
  setFindings(list) { this.findings = list || []; this.paint(); }
  goto(line) {
    const lines = this.ta.value.split('\n'); let pos = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) pos += lines[i].length + 1;
    this.ta.focus(); this.ta.setSelectionRange(pos, pos + (lines[line - 1]?.length || 0));
    this.ta.scrollTop = Math.max(0, (line - 4) * 18);
  }

  key(e) {
    e.stopPropagation();                                                          // typing must never trigger editor shortcuts
    if (this.ta.readOnly) return;
    const ta = this.ta, a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
    const edit = (start, end, text, selStart = start + text.length, selEnd = selStart) => { ta.setRangeText(text, start, end, 'end'); ta.setSelectionRange(selStart, selEnd); this.paint(); this.onChange?.(ta.value); };
    if (e.key === 'Tab') {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', a - 1) + 1;
      if (a === b && !e.shiftKey) { edit(a, b, '  '); return; }
      const end = b, block = v.slice(ls, end), lines = block.split('\n');
      const out = e.shiftKey ? lines.map((l) => l.replace(/^ {1,2}/, '')) : lines.map((l) => '  ' + l);
      const text = out.join('\n'); edit(ls, end, text, ls, ls + text.length);
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', a - 1) + 1, indent = /^[ \t]*/.exec(v.slice(ls, a))[0];
      const before = v.slice(ls, a).trimEnd(), after = v.slice(b);
      const open = /[{[(]$/.test(before), close = /^[\]})]/.test(after.trimStart()) && open;
      const ins = '\n' + indent + (open ? '  ' : '') + (close ? '\n' + indent : '');
      edit(a, b, ins, a + 1 + indent.length + (open ? 2 : 0));
    }
  }
}
