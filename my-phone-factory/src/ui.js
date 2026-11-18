/* =========================================================
   UI SHELL — routing, HUD, modals, toasts, charts, setup
   ========================================================= */
const UI = { tab: 'hq', sub: {}, speed: 0, timer: null, after: [], A: {}, I: {}, C: {}, pages: {}, busy: false };
UI.TABS = [
  { id: 'hq', name: 'HQ', i: '🏢' }, { id: 'rnd', name: 'R&D', i: '🔬' }, { id: 'design', name: 'Design', i: '📐' },
  { id: 'factory', name: 'Factory', i: '🏭' }, { id: 'market', name: 'Market', i: '🌍' }, { id: 'finance', name: 'Finance', i: '💰' },
  { id: 'team', name: 'Team', i: '👥' }, { id: 'launch', name: 'Launch', i: '🎤' },
];

/* ---------- event delegation ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = UI.A[el.dataset.a];
  if (fn) { e.preventDefault(); SFX.click(); fn(el, e); }
});
document.addEventListener('input', (e) => { const el = e.target.closest('[data-in]'); if (el && UI.I[el.dataset.in]) UI.I[el.dataset.in](el, e); });
document.addEventListener('change', (e) => { const el = e.target.closest('[data-ch]'); if (el && UI.C[el.dataset.ch]) UI.C[el.dataset.ch](el, e); });
document.addEventListener('keydown', (e) => {
  if (KN && KN.active) return;
  if (e.key === 'Escape' && $('#modalRoot').classList.contains('on')) UI.close();
  if (e.key === ' ' && G && !$('#modalRoot').classList.contains('on') && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); UI.next(); }
});

/* ---------- toasts & modals ---------- */
UI.toast = (msg, type = '') => {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.innerHTML = msg;
  const box = $('#toasts'); box.appendChild(t); while (box.children.length > 3) box.firstChild.remove(); setTimeout(() => t.remove(), type === 'bad' ? 4200 : 3000);
  if (type === 'bad') SFX.error();
};
UI.err = (msg) => { if (msg) UI.toast('⚠️ ' + msg, 'bad'); return !!msg; };
UI.modal = (html, opts = {}) => {
  const root = $('#modalRoot');
  root.innerHTML = '<div class="scrim" data-a="' + (opts.locked ? '' : 'closeModal') + '"></div><div class="sheet">' + (opts.locked ? '' : '<button class="btn sm x" data-a="closeModal">✕</button>') + html + '</div>';
  root.classList.add('on');
  UI.modalOpen = true; UI.onClose = opts.onClose || null;
  UI.flushAfter();
};
UI.close = () => { const r = $('#modalRoot'); r.classList.remove('on'); r.innerHTML = ''; UI.modalOpen = false; const f = UI.onClose; UI.onClose = null; if (f) f(); };
UI.A.closeModal = () => UI.close();
UI.confirm = (title, text, yes, label = 'Confirm', cls = 'pri') => {
  UI._yes = yes;
  UI.modal('<h2>' + title + '</h2><p class="mute">' + text + '</p><div class="row mt16"><button class="btn grow" data-a="closeModal">Cancel</button><button class="btn ' + cls + ' grow" data-a="confirmYes">' + label + '</button></div>');
};
UI.A.confirmYes = () => { const f = UI._yes; UI.close(); if (f) f(); UI.render(); };

/* ---------- logo ---------- */
UI.logoSVG = (logo, size = 36) => {
  const c = logo.color || '#3ee6ff', bg = logo.bg || '#0c111a', L = U.esc((logo.letter || '?').slice(0, 2));
  const shapes = {
    circle: '<circle cx="50" cy="50" r="40" fill="' + c + '"/>',
    square: '<rect x="12" y="12" width="76" height="76" rx="20" fill="' + c + '"/>',
    hex: '<polygon points="50,8 88,29 88,71 50,92 12,71 12,29" fill="' + c + '"/>',
    diamond: '<polygon points="50,6 94,50 50,94 6,50" fill="' + c + '"/>',
    leaf: '<path d="M50 8 C88 14 92 60 50 92 C8 60 12 14 50 8Z" fill="' + c + '"/>',
    bolt: '<polygon points="58,4 18,56 46,56 38,96 84,40 54,40" fill="' + c + '"/>',
  };
  const dark = ['#e8ecf1', '#ffd23f', '#3ddc84', '#00c2ff'].includes(c);
  return '<svg viewBox="0 0 100 100" width="' + size + '" height="' + size + '"><rect width="100" height="100" rx="24" fill="' + bg + '"/>' + (shapes[logo.shape] || shapes.circle) +
    '<text x="50" y="' + (logo.shape === 'bolt' ? 78 : 63) + '" text-anchor="middle" font-family="Arial Black,Arial" font-weight="900" font-size="' + (L.length > 1 ? 30 : 40) + '" fill="' + (dark ? '#0c111a' : '#ffffff') + '"' + (logo.shape === 'bolt' ? ' opacity="0"' : '') + '>' + L + '</text></svg>';
};

/* ---------- charts ---------- */
UI.chartId = 0;
UI.chart = (series, opts = {}) => {
  const id = 'ch' + (++UI.chartId);
  UI.after.push(() => UI.drawChart($('#' + id), series, opts));
  return '<canvas class="chart" id="' + id + '" style="height:' + (opts.h || 160) + 'px"></canvas>';
};
UI.drawChart = (cv, series, opts) => {
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const x = cv.getContext('2d'); x.scale(dpr, dpr);
  const pad = { l: 46, r: 8, t: 10, b: 20 };
  const all = series.flatMap((s) => s.data.map((d) => d[1]));
  if (!all.length) { x.fillStyle = '#5b6880'; x.font = '12px sans-serif'; x.fillText('No data yet', W / 2 - 30, H / 2); return; }
  let mn = Math.min(0, ...all), mx = Math.max(...all, opts.min ?? 0);
  if (mx === mn) mx = mn + 1;
  const xs = series.flatMap((s) => s.data.map((d) => d[0]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 1);
  const px = (v) => pad.l + (v - x0) / (x1 - x0) * (W - pad.l - pad.r), py = (v) => pad.t + (1 - (v - mn) / (mx - mn)) * (H - pad.t - pad.b);
  x.strokeStyle = 'rgba(255,255,255,0.06)'; x.fillStyle = '#5b6880'; x.font = '10px sans-serif'; x.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const v = mn + (mx - mn) * i / 4, y = py(v); x.beginPath(); x.moveTo(pad.l, y); x.lineTo(W - pad.r, y); x.stroke(); x.fillText((opts.fmt || U.num)(v), 2, y + 3); }
  if (mn < 0) { x.strokeStyle = 'rgba(255,255,255,0.25)'; x.beginPath(); x.moveTo(pad.l, py(0)); x.lineTo(W - pad.r, py(0)); x.stroke(); }
  if (opts.xlab) { x.fillStyle = '#5b6880'; x.fillText(opts.xlab(x0), pad.l, H - 4); const t = opts.xlab(x1); x.fillText(t, W - pad.r - x.measureText(t).width, H - 4); }
  series.forEach((s) => {
    if (s.bars) {
      const bw = Math.max(1, (W - pad.l - pad.r) / Math.max(1, s.data.length) - 1);
      s.data.forEach(([a, b]) => { x.fillStyle = b >= 0 ? (s.color || '#3ee6ff') : '#ff4d6a'; const y0 = py(0), y = py(b); x.fillRect(px(a) - bw / 2, Math.min(y, y0), bw, Math.abs(y - y0)); });
      return;
    }
    x.strokeStyle = s.color || '#3ee6ff'; x.lineWidth = s.w || 2; x.beginPath();
    s.data.forEach(([a, b], i) => (i ? x.lineTo(px(a), py(b)) : x.moveTo(px(a), py(b))));
    x.stroke();
    if (s.fill) { x.lineTo(px(s.data[s.data.length - 1][0]), py(mn)); x.lineTo(px(s.data[0][0]), py(mn)); x.closePath(); const g = x.createLinearGradient(0, pad.t, 0, H); g.addColorStop(0, s.color + '55'); g.addColorStop(1, s.color + '00'); x.fillStyle = g; x.fill(); }
  });
  if (opts.legend) { let lx = pad.l + 4; series.forEach((s) => { x.fillStyle = s.color; x.fillRect(lx, pad.t, 8, 8); x.fillStyle = '#c9d4e5'; x.fillText(s.name, lx + 11, pad.t + 8); lx += x.measureText(s.name).width + 24; }); }
};
UI.flushAfter = () => { const a = UI.after; UI.after = []; requestAnimationFrame(() => a.forEach((f) => { try { f(); } catch (e) { console.error(e); } })); };
UI.bar = (v, cls = '') => '<div class="bar ' + cls + '"><i style="width:' + U.clamp(v * 100, 0, 100).toFixed(1) + '%"></i></div>';

/* ---------- HUD & nav ---------- */
UI.renderHUD = () => {
  const h = G.hist[G.hist.length - 1];
  const prof = h ? h.profit : 0;
  $('#hud').innerHTML = '<div class="logo">' + UI.logoSVG(G.co.logo, 36) + '</div>' +
    '<div class="co"><div class="nm">' + U.esc(G.co.name) + '</div><div class="dt">' + U.dateStr(G.t) + ' · ⭐ ' + G.rep.toFixed(0) + ' · ' + U.money(S.companyValue(), 1) + '</div></div>' +
    '<div class="cash"><div class="v ' + (G.cash < 0 ? 'bad' : '') + '">' + U.money(G.cash) + '</div><div class="s ' + (prof >= 0 ? 'good' : 'bad') + '">' + (h ? (prof >= 0 ? '▲ ' : '▼ ') + U.money(Math.abs(prof)) + '/mo' : 'cash') + '</div></div>' +
    '<button class="hudbtn" data-a="menu" title="Menu">☰</button>';
  const alerts = UI.alerts();
  $('#nav').innerHTML = UI.TABS.map((t) => '<button class="' + (UI.tab === t.id ? 'on' : '') + '" data-a="tab" data-t="' + t.id + '"><span class="i">' + t.i + '</span>' + t.name + (alerts.tabs[t.id] ? '<span class="dot"></span>' : '') + '</button>').join('');
  $('#nextBtn').innerHTML = G.gameOver ? '💀 BANKRUPT' : '▶ NEXT MONTH <span class="sub">' + U.dateStr(G.t + 1) + '</span>';
  $('#speedBtn').classList.toggle('on', UI.speed > 0);
  $('#speedBtn').textContent = UI.speed ? '⏸' : '⏩';
};
UI.alerts = () => {
  const tabs = {}, list = [];
  if (!G) return { tabs, list };
  const rp = S.allocateRP(false);
  const idle = S.ENG.filter((f) => rp.pools[f] > 0 && !rp.items.some((it) => it.fields.includes(f)));
  if (G.research.active.length < S.researchSlots() && S.engineers() > 0) { tabs.rnd = 1; if (G.research.active.length === 0 && !G.phones.some((p) => p.status === 'dev') && !G.chips.some((c) => c.status === 'dev')) list.push(['bad', 'Your engineers are idle! Start research or a phone project.', 'rnd']); }
  if (idle.length && rp.items.length) list.push(['warn', 'Some ' + idle.map((f) => D.FIELDS[f].name).join(', ') + ' engineers have no matching project (working at 40% elsewhere).', 'rnd']);
  const ready = G.phones.filter((p) => p.status === 'ready');
  if (ready.length) { tabs.launch = 1; list.push(['good', ready.length + ' phone' + (ready.length > 1 ? 's are' : ' is') + ' ready to launch!', 'launch']); }
  const sale = G.phones.filter((p) => p.status === 'onsale' || p.status === 'ready' || p.status === 'announced');
  const noProd = sale.filter((p) => !p.auto && !(p.target > 0));
  if (noProd.length) { tabs.factory = 1; list.push(['warn', noProd.map((p) => U.esc(p.name)).join(', ') + ': no production planned.', 'factory']); }
  const out = G.phones.filter((p) => p.status === 'onsale' && (G.inventory[p.id] || 0) < 1 && p.backlog > 50);
  if (out.length) list.push(['bad', 'Out of stock: ' + out.map((p) => U.esc(p.name)).join(', ') + '. Increase production!', 'factory']);
  const burn = U.avg(G.hist.slice(-3), (h) => h.profit);
  if (burn < 0 && G.cash / -burn < 4) { tabs.finance = 1; list.push(['bad', 'Runway: ~' + Math.max(0, G.cash / -burn).toFixed(1) + ' months of cash left at the current burn rate.', 'finance']); }
  if (G.offers.length) { tabs.finance = 1; list.push(['good', 'Investor offer waiting: ' + U.money(G.offers[0].raise) + ' for ' + U.pct(G.offers[0].pct) + '.', 'finance']); }
  if (G.contracts.offers.length && G.t < 48) tabs.factory = tabs.factory || 0;
  if (!G.phones.length && G.t > 0) list.push(['warn', 'You have no phones in development. Head to DESIGN to start your first one.', 'design']);
  return { tabs, list };
};
UI.A.tab = (el) => { UI.tab = el.dataset.t; UI.render(true); };
UI.A.sub = (el) => { UI.sub[el.dataset.p] = el.dataset.s; UI.render(); };
UI.A.go = (el) => { UI.tab = el.dataset.t; if (el.dataset.s) UI.sub[el.dataset.t] = el.dataset.s; UI.render(true); };
UI.subtabs = (page, items) => {
  const cur = UI.sub[page] || items[0][0];
  return '<div class="subtabs">' + items.map(([id, nm]) => '<button class="' + (cur === id ? 'on' : '') + '" data-a="sub" data-p="' + page + '" data-s="' + id + '">' + nm + '</button>').join('') + '</div>';
};
UI.cur = (page, def) => UI.sub[page] || def;

UI.render = (resetScroll) => {
  if (!G) return;
  UI.renderHUD();
  const main = $('#main'), y = main.scrollTop;
  const fn = UI.pages[UI.tab];
  try { $('#page').innerHTML = fn ? fn() : ''; } catch (e) { console.error(e); $('#page').innerHTML = '<div class="card bad">Render error: ' + U.esc(e.message) + '</div>'; }
  main.scrollTop = resetScroll ? 0 : y;
  UI.flushAfter();
};

/* ---------- turn flow ---------- */
UI.next = () => {
  if (!G || UI.busy || UI.modalOpen) return;
  if (G.gameOver) { UI.gameOver(); return; }
  UI.busy = true;
  const before = G.cash;
  let rep;
  try { rep = S.tick(); } catch (e) { console.error(e); UI.toast('Simulation error: ' + e.message, 'bad'); }
  UI.busy = false;
  S.save('auto');
  const h = G.hist[G.hist.length - 1];
  if (h) UI.toast('📅 ' + U.dateStr(h.t) + ': revenue ' + U.money(h.rev) + ', profit <b class="' + (h.profit >= 0 ? 'good' : 'bad') + '">' + U.money(h.profit) + '</b>' + (h.units ? ', ' + U.num(h.units) + ' phones sold' : ''), h.profit >= 0 ? 'good' : '');
  if (rep && rep.completed.length) SFX.ding();
  UI.render();
  UI.processPending();
  if (G.gameOver) { UI.stopAuto(); UI.gameOver(); }
};
UI.processPending = () => {
  if (UI.modalOpen || !G.pending.length) return;
  UI.stopAuto();
  const ev = G.pending.shift();
  const def = S.EVENTS[ev.kind] && S.EVENTS[ev.kind](ev);
  if (!def) return UI.processPending();
  UI._evChoices = def.choices;
  UI.modal('<h2>' + def.title + '</h2><p>' + def.text + '</p><div class="col mt12">' + def.choices.map((c, i) => '<button class="btn ' + (i ? '' : 'pri') + ' full" data-a="evChoice" data-i="' + i + '">' + c.label + '</button>').join('') + '</div>', { locked: true });
};
UI.A.evChoice = (el) => { const c = UI._evChoices[+el.dataset.i]; UI.close(); c.fn(); S.save('auto'); UI.render(); UI.processPending(); };
UI.stopAuto = () => { UI.speed = 0; clearInterval(UI.timer); UI.timer = null; if (G) UI.renderHUD(); };
UI.A.speed = () => {
  if (UI.speed) { UI.stopAuto(); return; }
  UI.speed = 1; UI.renderHUD();
  UI.timer = setInterval(() => { if (UI.modalOpen || UI.busy || (KN && KN.active)) return; if (G.phones.some((p) => p.status === 'ready') && !UI._warnedReady) { UI._warnedReady = true; UI.stopAuto(); UI.toast('⏸ Auto-play paused: a phone is ready to launch.'); return; } UI.next(); }, 1600);
};
UI.A.next = () => UI.next();
UI.gameOver = () => {
  const v = G.hist.length ? G.hist[G.hist.length - 1] : null;
  UI.modal('<div class="center"><div style="font-size:56px">💀</div><h2>' + U.esc(G.co.name) + ' is bankrupt</h2><p class="mute">Founded Jan 2010 · Closed ' + U.dateStr(G.t) + '</p>' +
    '<div class="grid2 mt12"><div class="kpi"><div class="l">Phones sold</div><div class="v">' + U.num(G.unitsTotal) + '</div></div><div class="kpi"><div class="l">Lifetime revenue</div><div class="v">' + U.money(G.revenueTotal) + '</div></div>' +
    '<div class="kpi"><div class="l">Peak reputation</div><div class="v">' + Math.round(Math.max(...G.hist.map((h) => h.rep), 0)) + '</div></div><div class="kpi"><div class="l">Peak value</div><div class="v">' + U.money(Math.max(...G.hist.map((h) => h.val), 0)) + '</div></div></div>' +
    '<p class="small mute mt12">Every giant has failed at least once. Learn, and try again.</p><div class="row mt12"><button class="btn grow" data-a="menuLoad">Load a save</button><button class="btn pri grow" data-a="newGame">New company</button></div></div>', { locked: true });
};

/* ---------- menu, saves ---------- */
UI.A.menu = () => {
  const slots = S.SLOTS.map((s) => { const m = S.meta(s); return '<div class="it"><div class="ic">💾</div><div class="grow"><b>' + (s === 'auto' ? 'Autosave' : 'Slot ' + s.slice(4)) + '</b><div class="small mute">' + (m ? U.esc(m.name) + ' · ' + m.date + ' · ' + U.money(m.val) : 'Empty') + '</div></div>' + (s !== 'auto' ? '<button class="btn sm" data-a="saveSlot" data-s="' + s + '">Save</button>' : '') + (m ? '<button class="btn sm" data-a="loadSlot" data-s="' + s + '">Load</button>' : '') + '</div>'; }).join('');
  UI.modal('<h2>☰ Menu</h2><div class="list">' + slots + '</div><hr class="sep"><div class="grid2"><button class="btn" data-a="exportSave">⬇ Export save</button><button class="btn" data-a="importSave">⬆ Import save</button>' +
    '<button class="btn" data-a="toggleSound">' + (SFX.on ? '🔊 Sound on' : '🔇 Sound off') + '</button><button class="btn" data-a="help">❓ How to play</button></div><hr class="sep"><button class="btn bad full" data-a="newGameAsk">Start a new company</button><p class="tiny dim center mt12">MY PHONE FACTORY · difficulty: ' + G.difficulty + '</p>');
};
UI.A.saveSlot = (el) => { S.save(el.dataset.s); UI.toast('💾 Saved.', 'good'); UI.A.menu(); };
UI.A.loadSlot = (el) => { if (S.load(el.dataset.s)) { UI.close(); UI.boot(); UI.toast('Loaded ' + U.esc(G.co.name) + '.', 'good'); } };
UI.A.menuLoad = () => { UI.close(); UI.A.menu(); };
UI.A.toggleSound = () => { SFX.on = !SFX.on; U.store.set('mpf_sound', SFX.on ? '1' : '0'); UI.A.menu(); };
UI.A.exportSave = () => {
  const blob = new Blob([S.serialize()], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (G.co.name || 'company').replace(/\W+/g, '_') + '_' + U.dateStr(G.t).replace(' ', '_') + '.mpf.json'; a.click();
};
UI.A.importSave = () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => { const f = inp.files[0]; if (!f) return; f.text().then((t) => { try { S.loadFromString(t); UI.close(); UI.boot(); UI.toast('Save imported.', 'good'); } catch (e) { UI.toast('Invalid save file.', 'bad'); } }); };
  inp.click();
};
UI.A.newGameAsk = () => UI.confirm('Start over?', 'Your current company stays in its save slot (autosave will be overwritten once you play).', () => UI.showSetup(), 'New company', 'bad');
UI.A.newGame = () => { UI.close(); UI.showSetup(); };
UI.A.help = () => UI.modal('<h2>❓ How to play</h2><div class="small" style="line-height:1.6">' +
  '<p><b>Goal:</b> grow a 2-person workshop into a global smartphone empire. Each turn is one month. There is no shortcut — one bad bet can bankrupt you.</p>' +
  '<p><b>1. Design</b> (📐): pick an off-the-shelf chip, memory, display, battery, cameras and body. Every number is simulated: performance, heat, battery life, cost, weight.</p>' +
  '<p><b>2. Develop</b>: engineers turn research points (RP) into phones, chips and new technologies (🔬). Hire more people in 👥 Team.</p>' +
  '<p><b>3. Produce</b> (🏭): set monthly production. Components are paid up-front. More lines and factories = more capacity. Take OEM contracts for early cash.</p>' +
  '<p><b>4. Launch</b> (🎤): release quietly or stage a live keynote. Walk your CEO around the stage, reveal the phone, run live demos — which can fail, because they are simulated!</p>' +
  '<p><b>5. Sell</b> (🌍): enter regions, sign retail & carrier deals, buy marketing. Buyers compare your phones with every rival model on quality, price, brand and hype.</p>' +
  '<p><b>6. Finance</b> (💰): loans, investors, IPO. Watch your runway. Two months of negative cash with no credit = bankruptcy.</p>' +
  '<p><b>Long term:</b> design your own SoCs, build fabs, develop your own OS and app store, and chase the trillion-dollar valuation.</p></div>');

/* ---------- setup wizard ---------- */
UI.setup = null;
UI.showSetup = () => {
  UI.stopAuto();
  UI.setup = UI.setup || { name: 'Nova Mobile', ceo: '', logo: { shape: 'hex', color: '#00c2ff', letter: 'N' }, hq: 'cn', market: null, strategy: 'value', category: 'budget', spec: 'hw', difficulty: 'realistic' };
  $('#setup').classList.remove('hidden'); $('#app').classList.add('hidden');
  UI.renderSetup();
};
UI.renderSetup = () => {
  const s = UI.setup, C = D.country(s.hq);
  const mkt = s.market || C.region;
  const opt = (k, items, cols = 'grid2') => '<div class="' + cols + '">' + items.map((it) => '<button class="optCard ' + (s[k] === it.id ? 'on' : '') + '" data-a="setPick" data-k="' + k + '" data-v="' + it.id + '"><div class="h">' + (it.flag ? it.flag + ' ' : '') + U.esc(it.name) + '</div><div class="d">' + U.esc(it.desc || '') + '</div></button>').join('') + '</div>';
  const has = U.store.get('mpf_auto');
  $('#setup').innerHTML = '<div class="wrap">' +
    '<div class="brandTitle"><div class="t1">📱 MY PHONE</div><div class="t2">FACTORY</div><div class="t3">Ultimate smartphone empire simulator · January 2010 · $75,000 · 2 engineers</div></div>' +
    (has && G == null ? '<div class="card glow center"><b>Continue your company?</b><div class="small mute">' + (S.meta('auto') ? U.esc(S.meta('auto').name) + ' · ' + S.meta('auto').date : '') + '</div><button class="btn pri big full mt12" data-a="continue">▶ Continue</button></div>' : '') +
    '<div class="card"><h3>🏷️ Your company</h3><div class="row top" style="gap:14px"><div id="setupLogo">' + UI.logoSVG(s.logo, 84) + '</div><div class="grow">' +
    '<div class="field"><label>Company name</label><input type="text" maxlength="28" value="' + U.esc(s.name) + '" data-in="setName"></div>' +
    '<div class="field"><label>Logo letter(s)</label><input type="text" maxlength="2" value="' + U.esc(s.logo.letter) + '" data-in="setLetter"></div></div></div>' +
    '<div class="field"><label>Logo shape</label><div class="logoPick">' + D.logoShapes.map((sh) => '<button class="' + (s.logo.shape === sh ? 'on' : '') + '" data-a="setShape" data-v="' + sh + '">' + UI.logoSVG({ ...s.logo, shape: sh }, 36) + '</button>').join('') + '</div></div>' +
    '<div class="field"><label>Brand colour</label><div class="colorPick">' + D.logoColors.map((c) => '<button class="' + (s.logo.color === c ? 'on' : '') + '" style="background:' + c + '" data-a="setColor" data-v="' + c + '"></button>').join('') + '</div></div></div>' +
    '<div class="card"><h3>🌐 Headquarters</h3>' + opt('hq', D.countries, 'grid2') +
    '<div class="small mute mt8">Wages ×' + C.wage + ' · Tax ' + U.pct(C.tax, 0) + ' · Component costs ×' + C.supply + ' · Investor access ×' + C.investor + '</div></div>' +
    '<div class="card"><h3>🛒 First market</h3><div class="seg">' + D.regionIds.map((r) => '<button class="' + (mkt === r ? 'on' : '') + '" data-a="setMarket" data-v="' + r + '">' + D.regions[r].name + '</button>').join('') + '</div><div class="small mute mt8">You start selling online here. Price sensitivity: ' + D.regions[mkt].sens + '× · ' + (mkt === C.region ? 'Home market bonus ✓' : 'Foreign market: no home-advantage bonus') + '</div></div>' +
    '<div class="card"><h3>♟️ Company strategy</h3>' + opt('strategy', D.strategies) + '</div>' +
    '<div class="card"><h3>📱 Starting product category</h3>' + opt('category', D.categories) + '</div>' +
    '<div class="card"><h3>🔬 Research specialization</h3>' + opt('spec', D.specializations) + '</div>' +
    '<div class="card"><h3>⚖️ Difficulty</h3><div class="seg">' + [['relaxed', 'Relaxed'], ['realistic', 'Realistic'], ['hardcore', 'Hardcore']].map(([id, n]) => '<button class="' + (s.difficulty === id ? 'on' : '') + '" data-a="setPick" data-k="difficulty" data-v="' + id + '">' + n + '</button>').join('') + '</div><div class="small mute mt8">Realistic is the intended experience: it is genuinely hard. Relaxed gives friendlier banks and investors.</div></div>' +
    '<button class="btn pri big full" data-a="startGame">🚀 Found ' + U.esc(s.name) + '</button><div class="tiny dim center mt12">Progress autosaves every month on this device.</div></div>';
};
UI.A.setPick = (el) => { UI.setup[el.dataset.k] = el.dataset.v; if (el.dataset.k === 'hq') UI.setup.market = null; UI.renderSetup(); };
UI.A.setMarket = (el) => { UI.setup.market = el.dataset.v; UI.renderSetup(); };
UI.A.setShape = (el) => { UI.setup.logo.shape = el.dataset.v; UI.renderSetup(); };
UI.A.setColor = (el) => { UI.setup.logo.color = el.dataset.v; UI.renderSetup(); };
UI.I.setName = (el) => { UI.setup.name = el.value || 'My Phone Co'; if (!UI.setup._letterSet) UI.setup.logo.letter = (UI.setup.name.trim()[0] || 'P').toUpperCase(); $('#setupLogo').innerHTML = UI.logoSVG(UI.setup.logo, 84); };
UI.I.setLetter = (el) => { UI.setup._letterSet = true; UI.setup.logo.letter = el.value.toUpperCase(); $('#setupLogo').innerHTML = UI.logoSVG(UI.setup.logo, 84); };
UI.A.continue = () => { if (S.load('auto')) UI.boot(); };
UI.A.startGame = () => {
  const s = UI.setup;
  S.newGame({ ...s, market: s.market || D.country(s.hq).region });
  UI.tab = 'hq'; UI.sub = {};
  S.save('auto');
  UI.boot();
  setTimeout(() => UI.A.help(), 300);
};
UI.boot = () => {
  $('#setup').classList.add('hidden'); $('#app').classList.remove('hidden');
  UI.render(true);
  if (G.gameOver) UI.gameOver();
  else UI.processPending();
};
UI.init = () => {
  SFX.on = U.store.get('mpf_sound') !== '0';
  $('#nextBtn').addEventListener('click', () => UI.next());
  $('#speedBtn').addEventListener('click', () => UI.A.speed());
  UI.showSetup();
};
