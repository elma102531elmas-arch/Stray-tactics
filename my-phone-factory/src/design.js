/* =========================================================
   DESIGN STUDIO — phone renderer, phone designer, chip designer
   ========================================================= */
const R = {};
R.rr = (x, X, Y, W, Hh, r) => { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + Hh, r); x.arcTo(X + W, Y + Hh, X, Y + Hh, r); x.arcTo(X, Y + Hh, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); };
R.shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255; r = U.clamp(Math.round(r * f), 0, 255); g = U.clamp(Math.round(g * f), 0, 255); b = U.clamp(Math.round(b * f), 0, 255); return 'rgb(' + r + ',' + g + ',' + b + ')'; };
// Draw a phone (front or back) centred at cx,cy. s = pixels per mm.
R.drawPhone = (x, cx, cy, s, d, st, view = 'front', o = {}) => {
  const W = st.bodyW * s, Hh = st.bodyH * s, X = cx - W / 2, Y = cy - Hh / 2;
  const rad = Math.min(W, Hh) * (d.disp.bezel === 'b169' ? 0.13 : 0.16);
  const col = o.color || '#3a4a66', mat = d.body.mat;
  x.save();
  // shadow
  x.shadowColor = 'rgba(0,0,0,0.5)'; x.shadowBlur = 24 * (o.glow ? 1.5 : 1); x.shadowOffsetY = 10;
  if (o.glow) x.shadowColor = o.glow;
  R.rr(x, X, Y, W, Hh, rad);
  const g = x.createLinearGradient(X, Y, X + W, Y + Hh);
  if (view === 'back') {
    const sh = mat === 'plastic' ? [1.05, 0.9] : mat === 'alu' ? [1.25, 0.8] : mat === 'glass' || mat === 'steel' || mat === 'ti' ? [1.45, 0.7] : [1.3, 0.85];
    g.addColorStop(0, R.shade(col, sh[0])); g.addColorStop(0.55, col); g.addColorStop(1, R.shade(col, sh[1]));
  } else { g.addColorStop(0, R.shade(col, 0.55)); g.addColorStop(1, R.shade(col, 0.35)); }
  x.fillStyle = g; x.fill(); x.shadowColor = 'transparent';
  // frame highlight
  x.lineWidth = Math.max(1, s * 0.6); x.strokeStyle = mat === 'steel' ? '#e6e9ef' : mat === 'ti' ? '#b9b4ab' : R.shade(col, 1.5); x.stroke();
  if (d.form === 'rugged') { x.lineWidth = s * 3; x.strokeStyle = '#1b1f27'; R.rr(x, X + s, Y + s, W - 2 * s, Hh - 2 * s, rad * 0.9); x.stroke(); }
  if (view === 'front') {
    const sw = st.sw_in * 25.4 * s * (d.form === 'fold' ? 0.5 : 1), shh = st.sh_in * 25.4 * s;
    const sx = cx - sw / 2, sy = cy - shh / 2 + (d.disp.bezel === 'b169' ? -Hh * 0.0 : 0);
    const srad = d.disp.bezel === 'b169' ? 2 * s : rad * 0.82;
    R.rr(x, sx, sy, sw, shh, srad);
    if (o.screen) { x.save(); x.clip(); o.screen(x, sx, sy, sw, shh); x.restore(); }
    else {
      const wg = x.createLinearGradient(sx, sy, sx + sw, sy + shh);
      wg.addColorStop(0, o.wall1 || '#1b2a5a'); wg.addColorStop(0.6, o.wall2 || '#5a2a7a'); wg.addColorStop(1, '#0a0f1c');
      x.fillStyle = wg; x.fill();
      x.fillStyle = 'rgba(255,255,255,0.85)'; x.font = '700 ' + Math.max(8, sw * 0.16) + 'px sans-serif'; x.textAlign = 'center';
      x.fillText('9:41', cx, sy + shh * 0.25);
    }
    // camera cutouts
    x.fillStyle = '#000';
    if (d.disp.bezel === 'notch') { R.rr(x, cx - sw * 0.22, sy - 1, sw * 0.44, s * 5.5, s * 2.5); x.fill(); }
    else if (d.disp.bezel === 'punch') { x.beginPath(); x.arc(cx, sy + s * 4, s * 1.6, 0, 7); x.fill(); }
    else if (d.disp.bezel === 'b169') { R.rr(x, cx - s * 5, Y + (sy - Y) / 2 - s, s * 10, s * 1.6, s); x.fillStyle = '#222'; x.fill(); x.beginPath(); x.arc(cx, sy + shh + (Y + Hh - sy - shh) / 2, Math.min(s * 4.5, (Y + Hh - sy - shh) * 0.35), 0, 7); x.strokeStyle = '#555'; x.lineWidth = s * 0.5; x.stroke(); }
    if (d.form === 'fold') { x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 1; x.beginPath(); x.moveTo(cx, sy); x.lineTo(cx, sy + shh); x.stroke(); }
  } else {
    // camera module
    const n = 1 + d.cam.extras.length;
    const lens = Math.max(2.4, Math.sqrt(D.sensorT(d.cam.sensor).area) * 0.9 + 3) * s;
    const cols = n <= 2 ? 1 : 2, rows = Math.ceil(n / cols);
    const mw = cols * lens * 2.3 + s * 4, mh = rows * lens * 2.3 + s * 4;
    const mx = X + s * 6, my = Y + s * 6;
    if (n > 1 || st.bump > 1.2) { R.rr(x, mx, my, mw, mh, Math.min(mw, mh) * 0.28); x.fillStyle = 'rgba(0,0,0,0.28)'; x.fill(); x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 1; x.stroke(); }
    for (let i = 0; i < n; i++) {
      const lx = mx + s * 2 + lens * 1.15 + (i % cols) * lens * 2.3, ly = my + s * 2 + lens * 1.15 + Math.floor(i / cols) * lens * 2.3;
      const big = i === 0 ? 1 : 0.82;
      x.beginPath(); x.arc(lx, ly, lens * big, 0, 7); x.fillStyle = '#0a0b0e'; x.fill(); x.strokeStyle = '#3b4250'; x.lineWidth = s * 0.7; x.stroke();
      const lg = x.createRadialGradient(lx - lens * 0.3, ly - lens * 0.3, 1, lx, ly, lens * 0.7 * big); lg.addColorStop(0, '#5b7cff'); lg.addColorStop(0.4, '#1a1f44'); lg.addColorStop(1, '#05060a');
      x.beginPath(); x.arc(lx, ly, lens * 0.62 * big, 0, 7); x.fillStyle = lg; x.fill();
    }
    x.beginPath(); x.arc(mx + mw + s * 3, my + s * 4, s * 1.5, 0, 7); x.fillStyle = '#fff6d6'; x.fill();
    if (o.logo) { x.save(); x.globalAlpha = 0.55; x.fillStyle = '#fff'; x.font = '900 ' + W * 0.16 + 'px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(o.logo, cx, cy + Hh * 0.05); x.restore(); }
    if (d.body.bio === 'fp') { x.beginPath(); x.arc(cx, cy - Hh * 0.12, s * 4.5, 0, 7); x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = s; x.stroke(); }
  }
  // gloss
  if (view === 'back' && ['glass', 'steel', 'ti', 'ceramic'].includes(mat)) { x.save(); R.rr(x, X, Y, W, Hh, rad); x.clip(); const gl = x.createLinearGradient(X, Y, X + W * 0.6, Y + Hh * 0.6); gl.addColorStop(0, 'rgba(255,255,255,0.22)'); gl.addColorStop(0.45, 'rgba(255,255,255,0.02)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gl; x.fillRect(X, Y, W, Hh); x.restore(); }
  x.restore();
  return { X, Y, W, H: Hh };
};
R.preview = (id, d, st, color, logo) => {
  UI.after.push(() => {
    const cv = document.getElementById(id); if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), Wc = cv.clientWidth, Hc = cv.clientHeight;
    cv.width = Wc * dpr; cv.height = Hc * dpr; const x = cv.getContext('2d'); x.scale(dpr, dpr);
    const s = Math.min((Hc - 30) / st.bodyH, (Wc / 2 - 24) / st.bodyW);
    R.drawPhone(x, Wc * 0.28, Hc / 2, s, d, st, 'front', { color });
    R.drawPhone(x, Wc * 0.72, Hc / 2, s, d, st, 'back', { color, logo });
  });
  return '<canvas id="' + id + '" style="width:100%;height:240px"></canvas>';
};

/* ---------- Design page router ---------- */
UI.pages.design = () => {
  if (UI.draft) return UI.phoneDesigner();
  if (UI.chipDraft) return UI.chipDesigner();
  let s = H.title('📐', 'Design Studio', 'Phones, chips and the test lab');
  s += UI.subtabs('design', [['phones', '📱 Phones'], ['chips', '🧠 Chips'], ['lab', '🧪 Test lab'], ['soc', '🛒 Chip market']]);
  const sub = UI.cur('design', 'phones');
  if (sub === 'phones') {
    s += '<div class="card glow"><div class="row between"><div><b>New phone design</b><div class="small mute">Start from a template matching a category, then tune every component.</div></div></div><div class="seg mt12">' + D.categories.map((c) => '<button data-a="newPhone" data-k="' + c.id + '">' + c.name + '</button>').join('') + '</div></div>';
    const ps = G.phones.slice().reverse();
    if (!ps.length) s += '<div class="card empty"><div class="e">📱</div>No designs yet.</div>';
    ps.forEach((p) => {
      const st = S.stats(p);
      s += '<div class="card"><div class="row between"><div class="row">' + H.phoneIcon(p) + '<div><b>' + U.esc(p.name) + '</b> ' + H.statusTag(p) + '<div class="small mute">' + U.money(p.price) + ' · Q ' + st.qual.q.toFixed(0) + ' · ' + U.esc(S.resolveChip(p) ? (p.chipSource === 'own' ? S.chipById(p.chipId).name : p.chipSnap.name) : '?') + '</div></div></div></div>' +
        (p.status === 'dev' ? UI.bar(p.devProg / p.devNeed) + '<div class="tiny mute mt8">Development ' + Math.round(p.devProg) + '/' + p.devNeed + ' RP</div>' : '') +
        '<div class="row wrap mt12"><button class="btn sm" data-a="phoneInfo" data-id="' + p.id + '">Spec sheet</button><button class="btn sm" data-a="labPhone" data-id="' + p.id + '">🧪 Test</button><button class="btn sm" data-a="iterate" data-id="' + p.id + '">♻️ New version</button></div></div>';
    });
  } else if (sub === 'chips') {
    if (!S.has('soc')) s += '<div class="card"><h3>🔒 Chip design locked</h3><p class="small mute">Research <b>SoC Integration Fundamentals</b> (Silicon) to design your own processors. Until then, buy chips from Quantic, MediaCore, Exyra and Unicell.</p><button class="btn sm" data-a="go" data-t="rnd">Go to R&D</button></div>';
    else s += '<div class="card glow row between"><div><b>New chip design</b><div class="small mute">Licensed cores today, custom silicon tomorrow.</div></div><button class="btn pri" data-a="newChip">+ Design SoC</button></div>';
    G.chips.slice().reverse().forEach((c) => {
      const st = M.chipStats(c.spec, S.fy(), S.chipOpts());
      const tag = { dev: '<span class="tag warn">Designing</span>', fab: '<span class="tag vio">At the fab · ' + c.fabMonths + ' mo</span>', ready: '<span class="tag good">Ready</span>' }[c.status];
      s += '<div class="card"><div class="row between"><div><b>🧠 ' + U.esc(c.name) + '</b> ' + tag + '<div class="small mute">' + D.node(c.spec.node).nm + ' · ' + c.spec.big + '+' + c.spec.little + ' cores @ ' + c.spec.bigClk + ' GHz · GPU ' + st.gflops.toFixed(0) + ' GFLOPS · ' + st.area.toFixed(0) + ' mm² · unit cost ' + U.money(S.chipUnitCost(c)) + '</div></div></div>' +
        (c.status === 'dev' ? UI.bar(c.devProg / c.devNeed) + '<div class="tiny mute mt8">' + Math.round(c.devProg) + '/' + c.devNeed + ' RP · tape-out cost ' + U.money(S.tapeoutCost(c.spec)) + '</div>' : '') +
        (c.status === 'ready' ? '<label class="chk"><input type="checkbox" ' + (c.sell ? 'checked' : '') + ' data-ch="chipSell" data-id="' + c.id + '"> Sell this chip to other phone makers' + (c.extLast ? ' · ' + U.num(c.extLast) + ' units last month' : '') + '</label>' : '') + '</div>';
    });
  } else if (sub === 'lab') {
    s += PS.page();
  } else {
    s += '<div class="card"><h3>🛒 Merchant SoCs available now</h3><div class="scrollx"><table class="tbl"><tr><th>Chip</th><th>Node</th><th>CPU</th><th class="r">Single</th><th class="r">GPU</th><th>Modem</th><th class="r">Price</th></tr>' +
      S.availableSoCs().slice().sort((a, b) => b.rel - a.rel || b.price - a.price).map((c) => { const st = M.chipStats(c, S.fy()); return '<tr><td><b>' + c.name + '</b><div class="tiny mute">' + c.tier + ' · ' + U.dateStr(Math.round((c.rel - 2010) * 12)) + '</div></td><td>' + D.node(c.node).nm + '</td><td>' + c.big + (c.little ? '+' + c.little : '') + '×' + c.bigClk + 'G</td><td class="r">' + st.single.toFixed(0) + '</td><td class="r">' + st.gflops.toFixed(0) + '</td><td>' + (D.modems[c.modemGen] || {}).name + '</td><td class="r">' + U.money(M.socPrice(c, S.fy())) + '</td></tr>'; }).join('') + '</table></div></div>';
  }
  return s;
};
UI.C.chipSell = (el) => { S.chipById(el.dataset.id).sell = el.checked; };

/* ---------- Phone designer ---------- */
UI.A.newPhone = (el) => {
  const kind = (el && el.dataset.k) || G.co.category;
  const tp = S.template(kind);
  const n = G.phones.length + 1;
  UI.draft = { name: (G.co.name.split(' ')[0] || 'Phone') + ' ' + ({ budget: 'Lite', mid: 'One', rugged: 'Rock', gaming: 'Blaze', camera: 'Lens', flagship: 'Ultra' }[kind] || 'One') + ' ' + n, color: G.co.logo.color, chipSource: 'market', chipSnap: tp.chip, chipId: null, design: tp.design };
  UI.tab = 'design'; UI.render(true);
};
UI.A.iterate = (el) => {
  const p = S.phoneById(el.dataset.id);
  const d = U.deep(p.design); d.price = p.price;
  const base = p.name.replace(/\s*\d+$/, '');
  const num = (p.name.match(/(\d+)$/) || [0, 1])[1];
  UI.draft = { name: base + ' ' + (+num + 1), color: p.color, chipSource: p.chipSource, chipId: p.chipId, chipSnap: p.chipSnap, design: d };
  UI.fixDraft(); UI.tab = 'design'; UI.close(); UI.render(true);
};
UI.draftChip = () => (UI.draft.chipSource === 'own' ? (S.chipById(UI.draft.chipId) || {}).spec : UI.draft.chipSnap);
UI.draftDesign = () => {
  const dr = UI.draft, chip = UI.draftChip();
  const d = { ...dr.design, chip: dr.chipSource === 'own' ? { ...chip, rel: S.fy() } : chip, chipSource: dr.chipSource };
  if (dr.chipSource === 'own') d.chipUnitCost = S.chipUnitCost(S.chipById(dr.chipId));
  return d;
};
UI.fixDraft = () => {
  const d = UI.draft.design, chip = UI.draftChip(), ctx = { fy: S.fy(), has: S.has };
  if (!chip) return;
  const rams = D.ram.filter((r) => M.okRam(ctx, r) && chip.memTypes.includes(r.id));
  if (!rams.find((r) => r.id === d.ram.type)) d.ram.type = (rams[rams.length - 1] || D.ramT(chip.memTypes[0])).id;
  const rt = D.ramT(d.ram.type); if (d.ram.gb > rt.maxGB) d.ram.gb = rt.maxGB;
  d.ram.bus = Math.min(d.ram.bus, chip.memBus);
  const isp = D.ispGens[chip.ispGen - 1]; if (d.cam.mp > isp.maxMP) d.cam.mp = U.maxBy(D.camMP.filter((m) => m.mp <= isp.maxMP && M.ok(ctx, m)), (m) => m.mp).mp;
  if (chip.modemGen) d.modem = 0; else if (!d.modem) d.modem = (M.newest(D.modems, (m) => m.g && m.year <= S.fy()) || D.modems[1]).g;
  const sz = { bar: [3.2, 7.2], rugged: [4, 6.8], fold: [7, 8.2] }[d.form];
  d.disp.size = U.clamp(d.disp.size, sz[0], sz[1]);
  if (d.form === 'fold' && !['amoled2', 'ltpo', 'micro'].includes(d.disp.type)) d.disp.type = D.dispTypes.filter((t) => M.okDisp(ctx, t) && t.q >= 0.86).map((t) => t.id).pop() || d.disp.type;
};
H.opts = (list, cur) => list.map(([v, label, dis]) => '<option value="' + v + '" ' + (String(v) === String(cur) ? 'selected' : '') + (dis ? ' disabled' : '') + '>' + label + '</option>').join('');
H.sel = (key, list, cur) => '<select data-ch="dset" data-k="' + key + '">' + H.opts(list, cur) + '</select>';
H.lk = (tech) => (tech && !S.has(tech) ? ' 🔒' : '');
UI.phoneDesigner = () => {
  UI.fixDraft();
  const dr = UI.draft, d = dr.design, fy = S.fy(), ctx = { fy, has: S.has };
  const chip = UI.draftChip();
  let s = '<div class="ptitle"><button class="btn sm" data-a="cancelDraft">✕</button><div class="grow"><h2>Phone designer</h2><div class="sub">Every choice changes cost, performance, heat, weight and battery life.</div></div></div>';
  s += '<div class="designer"><div>';
  // identity
  s += '<div class="card"><h3>🏷️ Identity</h3><div class="field"><label>Model name</label><input type="text" maxlength="30" value="' + U.esc(dr.name) + '" data-in="dName"></div>' +
    '<div class="row"><div class="field grow"><label>Colour</label><div class="row"><input type="color" value="' + dr.color + '" data-in="dColor"><div class="colorPick">' + ['#1c1f26', '#e9ecf2', '#2f5bff', '#ff3b5c', '#3ddc84', '#b9a07a', '#7b4dff', '#0fb5c9'].map((c) => '<button style="background:' + c + '" data-a="dColorP" data-v="' + c + '"></button>').join('') + '</div></div></div></div>' +
    '<div class="field"><label>Form factor</label><div class="seg">' + D.forms.map((f) => '<button class="' + (d.form === f.id ? 'on' : '') + '" data-a="dForm" data-v="' + f.id + '" ' + (f.tech && !S.has(f.tech) ? 'disabled' : '') + '>' + f.name + H.lk(f.tech) + '</button>').join('') + '</div></div></div>';
  // chip
  const socs = S.availableSoCs();
  const own = G.chips.filter((c) => c.status === 'ready');
  s += '<div class="card"><h3>🧠 Chipset (SoC)</h3><div class="seg mb8"><button class="' + (dr.chipSource === 'market' ? 'on' : '') + '" data-a="dChipSrc" data-v="market">Buy from suppliers</button><button class="' + (dr.chipSource === 'own' ? 'on' : '') + '" data-a="dChipSrc" data-v="own" ' + (own.length ? '' : 'disabled') + '>Own chips' + (own.length ? '' : ' 🔒') + '</button></div>';
  if (dr.chipSource === 'market') s += '<select data-ch="dSoc">' + H.opts(socs.slice().sort((a, b) => b.rel - a.rel).map((c) => [c.id, c.name + ' — ' + D.node(c.node).nm + ', ' + (c.big + c.little) + (c.big + c.little > 1 ? ' cores' : ' core') + ' — ' + U.money(M.socPrice(c, fy))]), chip.id) + '</select>';
  else s += '<select data-ch="dOwnChip">' + H.opts(own.map((c) => [c.id, c.name + ' — ' + D.node(c.spec.node).nm + ' — ' + U.money(S.chipUnitCost(c))]), dr.chipId) + '</select>';
  if (chip) { const cs = M.chipStats(chip, fy, S.chipOpts()); s += '<div class="grid3 mt8"><div class="specTile"><div class="k">CPU single</div><div class="v">' + cs.single.toFixed(0) + '</div></div><div class="specTile"><div class="k">GPU</div><div class="v">' + cs.gflops.toFixed(0) + ' GF</div></div><div class="specTile"><div class="k">AI</div><div class="v">' + cs.tops.toFixed(1) + ' TOPS</div></div></div><div class="tiny mute mt8">ISP up to ' + cs.ig.maxMP + 'MP · ' + cs.ig.video + ' · memory: ' + chip.memTypes.map((m) => D.ramT(m).name).join(', ') + ' · ' + chip.memBus + '-bit · modem: ' + (chip.modemGen ? D.modems[chip.modemGen].name + ' (integrated)' : 'none — needs discrete') + '</div>'; }
  if (chip && !chip.modemGen) s += '<div class="field mt12"><label>Discrete modem</label>' + H.sel('modem', D.modems.filter((m) => m.g && m.year <= fy + 0.01).map((m) => [m.g, m.name + ' (' + U.money(m.cost * Math.max(0.5, Math.pow(0.9, Math.max(0, fy - m.year)))) + ', ' + m.P + 'W)']), d.modem) + '</div>';
  s += '</div>';
  // memory
  const rams = D.ram.filter((r) => r.year <= fy + 0.01);
  s += '<div class="card"><h3>💾 Memory & storage</h3><div class="grid2"><div class="field"><label>RAM type</label>' + H.sel('ram.type', rams.map((r) => [r.id, r.name + H.lk(r.tech) + (chip && !chip.memTypes.includes(r.id) ? ' (unsupported)' : ''), (r.tech && !S.has(r.tech)) || (chip && !chip.memTypes.includes(r.id))]), d.ram.type) + '</div>' +
    '<div class="field"><label>Capacity</label>' + H.sel('ram.gb', D.ramSizes.filter((g) => g <= D.ramT(d.ram.type).maxGB).map((g) => [g, (g < 1 ? g * 1024 + ' MB' : g + ' GB') + ' · ' + U.money(g * M.ramPerGB(d.ram.type, fy))]), d.ram.gb) + '</div>' +
    '<div class="field"><label>Bus width</label>' + H.sel('ram.bus', [16, 32, 64].map((b) => [b, b + '-bit' + (b > (chip ? chip.memBus : 64) ? ' (chip max ' + chip.memBus + ')' : ''), chip && b > chip.memBus]), d.ram.bus) + '</div>' +
    '<div class="field"><label>Storage type</label>' + H.sel('sto.type', D.storage.filter((x) => x.year <= fy + 0.01).map((x) => [x.id, x.name + H.lk(x.tech), x.tech && !S.has(x.tech)]), d.sto.type) + '</div>' +
    '<div class="field"><label>Storage</label>' + H.sel('sto.gb', D.stoSizes.map((g) => [g, (g >= 1024 ? g / 1024 + ' TB' : g + ' GB') + ' · ' + U.money(g * M.stoPerGB(d.sto.type, fy))]), d.sto.gb) + '</div></div></div>';
  // display
  const sz = { bar: [3.2, 7.2], rugged: [4, 6.8], fold: [7, 8.2] }[d.form];
  s += '<div class="card"><h3>🖥️ Display</h3><div class="grid2"><div class="field"><label>Panel</label>' + H.sel('disp.type', D.dispTypes.filter((x) => x.year <= fy + 0.01).map((x) => [x.id, x.name + H.lk(x.tech), x.tech && !S.has(x.tech)]), d.disp.type) + '</div>' +
    '<div class="field"><label>Resolution</label>' + H.sel('disp.res', D.resolutions.filter((x) => x.year <= fy + 0.01).map((x) => [x.id, x.name + ' (' + x.w + 'p)' + H.lk(x.tech), x.tech && !S.has(x.tech)]), d.disp.res) + '</div>' +
    '<div class="field"><label>Refresh rate</label>' + H.sel('disp.hz', D.refresh.map((x) => [x.hz, x.hz + ' Hz' + H.lk(x.tech), x.tech && !S.has(x.tech)]), d.disp.hz) + '</div>' +
    '<div class="field"><label>Bezel design</label>' + H.sel('disp.bezel', D.bezels.map((x) => [x.id, x.name + H.lk(x.tech), x.tech && !S.has(x.tech)]), d.disp.bezel) + '</div></div>' +
    '<div class="field"><label>Screen size <span class="v" id="vSize">' + d.disp.size.toFixed(1) + '"</span></label><input type="range" min="' + sz[0] + '" max="' + sz[1] + '" step="0.1" value="' + d.disp.size + '" data-in="dRange" data-k="disp.size" data-ch="dRangeDone"></div></div>';
  // battery
  const maxMah = d.form === 'rugged' ? 12000 : d.form === 'fold' ? 6000 : 7500;
  s += '<div class="card"><h3>🔋 Battery & charging</h3><div class="field"><label>Capacity <span class="v" id="vMah">' + U.num(d.bat.mah) + ' mAh</span></label><input type="range" min="800" max="' + maxMah + '" step="50" value="' + d.bat.mah + '" data-in="dRange" data-k="bat.mah" data-ch="dRangeDone"></div>' +
    '<div class="grid2"><div class="field"><label>Chemistry</label>' + H.sel('bat.chem', D.batChem.filter((x) => x.year <= fy + 0.01).map((x) => [x.id, x.name + ' (' + x.whl + ' Wh/L)' + H.lk(x.tech), x.tech && !S.has(x.tech)]), d.bat.chem) + '</div>' +
    '<div class="field"><label>Wired charging</label>' + H.sel('bat.charge', D.charging.map((x) => [x.w, x.w + ' W' + H.lk(x.tech), (x.tech && !S.has(x.tech)) || (x.year && x.year > fy)]), d.bat.charge) + '</div>' +
    '<div class="field"><label>Wireless</label>' + H.sel('bat.wless', D.wireless.map((x) => [x.id, x.name + H.lk(x.tech), x.tech && !S.has(x.tech)]), d.bat.wless) + '</div></div></div>';
  // camera
  const isp = chip ? D.ispGens[chip.ispGen - 1] : D.ispGens[0];
  s += '<div class="card"><h3>📷 Cameras</h3><div class="grid2"><div class="field"><label>Main sensor resolution</label>' + H.sel('cam.mp', D.camMP.map((x) => [x.mp, x.mp + ' MP' + H.lk(x.tech) + (x.mp > isp.maxMP ? ' (ISP max ' + isp.maxMP + ')' : ''), (x.tech && !S.has(x.tech)) || x.mp > isp.maxMP]), d.cam.mp) + '</div>' +
    '<div class="field"><label>Sensor size</label>' + H.sel('cam.sensor', D.sensors.map((x) => [x.id, x.name + H.lk(x.tech), x.tech && !S.has(x.tech)]), d.cam.sensor) + '</div>' +
    '<div class="field"><label>Front camera</label>' + H.sel('cam.front', D.frontMP.filter((x) => x.year <= fy).map((x) => [x.mp, x.mp ? x.mp + ' MP' : 'None']), d.cam.front) + '</div></div>' +
    '<label class="chk"><input type="checkbox" data-ch="dChk" data-k="cam.ois" ' + (d.cam.ois ? 'checked' : '') + ' ' + (S.has('cam_ois') ? '' : 'disabled') + '> Optical image stabilization' + H.lk('cam_ois') + '</label>' +
    D.extraCams.map((e) => '<label class="chk"><input type="checkbox" data-ch="dExtra" data-v="' + e.id + '" ' + (d.cam.extras.includes(e.id) ? 'checked' : '') + ' ' + ((e.tech && !S.has(e.tech)) || (e.year && e.year > fy) ? 'disabled' : '') + '> ' + e.name + H.lk(e.tech) + '</label>').join('') + '</div>';
  // body
  s += '<div class="card"><h3>🧱 Body & features</h3><div class="grid2"><div class="field"><label>Material</label>' + H.sel('body.mat', D.materials.map((x) => [x.id, x.name + H.lk(x.tech), x.tech && !S.has(x.tech)]), d.body.mat) + '</div>' +
    '<div class="field"><label>Water resistance</label>' + H.sel('body.ip', D.ipRatings.map((x) => [x.id, x.name + H.lk(x.tech), x.tech && !S.has(x.tech)]), d.body.ip) + '</div>' +
    '<div class="field"><label>Biometrics</label>' + H.sel('body.bio', D.biometrics.map((x) => [x.id, x.name + H.lk(x.tech), x.tech && !S.has(x.tech)]), d.body.bio) + '</div>' +
    '<div class="field"><label>Cooling</label>' + H.sel('body.cooling', D.cooling.map((x) => [x.id, x.name + H.lk(x.tech), x.tech && !S.has(x.tech)]), d.body.cooling) + '</div></div>' +
    '<label class="chk"><input type="checkbox" data-ch="dChk" data-k="body.jack" ' + (d.body.jack ? 'checked' : '') + '> 3.5mm headphone jack</label><label class="chk"><input type="checkbox" data-ch="dChk" data-k="body.sd" ' + (d.body.sd ? 'checked' : '') + '> microSD slot</label>' +
    '<label class="chk"><input type="checkbox" data-ch="dChk" data-k="body.stereo" ' + (d.body.stereo ? 'checked' : '') + ' ' + (S.has('stereo') ? '' : 'disabled') + '> Stereo speakers' + H.lk('stereo') + '</label></div>';
  // software
  s += '<div class="card"><h3>💻 Software</h3><div class="seg"><button class="' + (d.os === 'open' ? 'on' : '') + '" data-a="dOS" data-v="open">OpenMobile OS (licensed)</button><button class="' + (d.os === 'own' ? 'on' : '') + '" data-a="dOS" data-v="own" ' + (S.has('os_own') ? '' : 'disabled') + '>' + U.esc(G.co.name.split(' ')[0]) + ' OS' + H.lk('os_own') + '</button></div>' +
    '<div class="tiny mute mt8">' + (d.os === 'own' ? 'Own OS: no license fee and a loyal ecosystem — but buyers hate an empty app store. Ecosystem strength: ' + U.pct(S.ecoFactor(), 0) + '.' : 'OpenMobile is free with a small per-unit app-store certification fee. Customize it with UI skin research.') + '</div>' +
    (S.has('benchboost') ? '<label class="chk"><input type="checkbox" data-ch="dChk" data-k="benchBoost" ' + (d.benchBoost ? 'checked' : '') + '> <span class="warn">Benchmark Boost Mode (+15% scores, risk of scandal)</span></label>' : '') + '</div>';
  s += '</div><div class="side" id="dSide">' + UI.designerSide() + '</div></div>';
  return s;
};
UI.designerSide = () => {
  const dr = UI.draft, d = UI.draftDesign();
  if (!d.chip) return '<div class="card">Select a chip.</div>';
  const st = M.phoneStats(d, S.fy(), S.ctx());
  const q = M.quality(st, S.fy());
  const price = dr.design.price;
  const fair = S.fairPrice(q.q);
  const tier = S.tierOfPrice(price);
  const devRP = S.devRP(dr.design, dr.chipSource), tool = S.toolingCost(dr.design);
  const rpm = S.fieldRP(); const pm = rpm.hw + rpm.sw + 0.4 * (rpm.sil + rpm.mfg);
  let s = '<div class="card glow">' + R.preview('dPrev', d, st, dr.color, (G.co.logo.letter || '').slice(0, 1)) +
    '<div class="row between mt8"><b>' + U.esc(dr.name) + '</b><span class="tag ' + (q.q >= 80 ? 'good' : q.q >= 55 ? 'acc' : 'warn') + '">Quality ' + q.q.toFixed(0) + '</span></div>' +
    '<div class="grid3 mt12"><div class="specTile"><div class="k">Unit cost</div><div class="v">' + U.money(st.bom) + '</div></div><div class="specTile"><div class="k">Price</div><div class="v">' + U.money(price) + '</div></div><div class="specTile"><div class="k">Margin</div><div class="v ' + (price > st.bom * 1.25 ? 'good' : 'bad') + '">' + U.pct(1 - st.bom / price, 0) + '</div></div></div>' +
    '<div class="field mt12"><label>Retail price <span class="v">' + U.money(price) + ' · ' + tier + '</span></label><input type="range" min="49" max="2499" step="10" value="' + price + '" data-in="dPrice" data-ch="dRangeDone"><div class="tiny mute">Market\'s fair price for this quality: ≈ ' + U.money(fair) + '</div></div>';
  s += Object.keys(M.W).map((k) => '<div class="scorebar"><span class="k">' + { perf: 'Performance', camera: 'Camera', display: 'Display', battery: 'Battery', build: 'Design', software: 'Software', features: 'Features', connect: 'Network' }[k] + '</span>' + UI.bar(q.s[k] / 1.3, q.s[k] >= 0.95 ? 'good' : q.s[k] < 0.6 ? 'bad' : '') + '<span class="v">' + Math.round(q.s[k] * 100) + '</span></div>').join('');
  s += '<hr class="sep">' + H.stat('Size', st.bodyW.toFixed(1) + ' × ' + st.bodyH.toFixed(1) + ' × ' + st.thick.toFixed(1) + ' mm') + H.stat('Weight', st.weight.toFixed(0) + ' g') + H.stat('Screen', d.disp.size + '" · ' + st.pxW + '×' + st.pxH + ' · ' + st.ppi.toFixed(0) + ' ppi') +
    H.stat('QuantaBench', U.num(st.bench.total) + ' <span class="tiny mute">(1-core ' + st.bench.single + ')</span>') + H.stat('Sustained perf', U.pct(Math.min(1, st.sustained), 0) + (st.sustained < 0.7 ? ' 🔥' : '')) +
    H.stat('Battery life', st.sot.toFixed(1) + ' h screen-on · ' + st.chargeMin.toFixed(0) + ' min charge') + H.stat('Camera score', st.cam.score.toFixed(0)) +
    H.stat('Development', devRP + ' RP (~' + S.eta(devRP, pm) + ')') + H.stat('Tooling & molds', U.money(tool));
  s += st.issues.map((i) => '<div class="issue mt8">⚠️ ' + i + '</div>').join('');
  s += '<details class="mt8"><summary class="small mute">Bill of materials</summary>' + Object.keys(st.bomParts).map((k) => H.stat(k, U.money(st.bomParts[k]))).join('') + '</details>';
  s += '<button class="btn pri full big mt12" data-a="startPhone" ' + (st.issues.length ? 'disabled' : '') + '>🚀 Start development (' + U.money(tool) + ')</button></div>';
  return s;
};
UI.refreshSide = () => { const el = $('#dSide'); if (el) { el.innerHTML = UI.designerSide(); UI.flushAfter(); } };
UI.setPath = (obj, path, v) => { const ks = path.split('.'); let o = obj; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; };
UI.C.dset = (el) => { const v = el.value; UI.setPath(UI.draft.design, el.dataset.k, isNaN(+v) || v === '' ? v : +v); UI.fixDraft(); UI.render(); };
UI.C.dChk = (el) => { UI.setPath(UI.draft.design, el.dataset.k, el.checked); UI.refreshSide(); };
UI.C.dExtra = (el) => { const ex = UI.draft.design.cam.extras; const i = ex.indexOf(el.dataset.v); if (el.checked && i < 0) ex.push(el.dataset.v); if (!el.checked && i >= 0) ex.splice(i, 1); UI.refreshSide(); };
UI.I.dRange = (el) => { UI.setPath(UI.draft.design, el.dataset.k, +el.value); const lab = el.dataset.k === 'disp.size' ? $('#vSize') : $('#vMah'); if (lab) lab.textContent = el.dataset.k === 'disp.size' ? (+el.value).toFixed(1) + '"' : U.num(+el.value) + ' mAh'; clearTimeout(UI._rt); UI._rt = setTimeout(UI.refreshSide, 60); };
UI.C.dRangeDone = () => UI.refreshSide();
UI.I.dPrice = (el) => { UI.draft.design.price = +el.value; clearTimeout(UI._rt); UI._rt = setTimeout(UI.refreshSide, 60); };
UI.I.dName = (el) => { UI.draft.name = el.value; };
UI.I.dColor = (el) => { UI.draft.color = el.value; clearTimeout(UI._rt); UI._rt = setTimeout(UI.refreshSide, 60); };
UI.A.dColorP = (el) => { UI.draft.color = el.dataset.v; UI.render(); };
UI.A.dForm = (el) => { UI.draft.design.form = el.dataset.v; if (el.dataset.v === 'fold') UI.draft.design.disp.size = 7.6; UI.fixDraft(); UI.render(); };
UI.A.dOS = (el) => { UI.draft.design.os = el.dataset.v; UI.render(); };
UI.A.dChipSrc = (el) => { const dr = UI.draft; dr.chipSource = el.dataset.v; if (dr.chipSource === 'own') { const c = G.chips.find((x) => x.status === 'ready'); dr.chipId = c ? c.id : null; } else if (!dr.chipSnap) dr.chipSnap = S.availableSoCs()[0]; UI.fixDraft(); UI.render(); };
UI.C.dSoc = (el) => { UI.draft.chipSnap = U.deep(S.availableSoCs().find((c) => c.id === el.value)); UI.fixDraft(); UI.render(); };
UI.C.dOwnChip = (el) => { UI.draft.chipId = el.value; UI.fixDraft(); UI.render(); };
UI.A.cancelDraft = () => { UI.draft = null; UI.render(true); };
UI.A.startPhone = () => {
  const dr = UI.draft;
  const tool = S.toolingCost(dr.design);
  if (G.cash < tool) { UI.err('You need ' + U.money(tool) + ' for tooling & molds.'); return; }
  if (!dr.name.trim()) { UI.err('Give your phone a name.'); return; }
  const p = S.createPhone({ name: dr.name.trim(), color: dr.color, design: dr.design, chipSource: dr.chipSource, chipId: dr.chipId, chipSnap: dr.chipSource === 'market' ? dr.chipSnap : null });
  UI.draft = null; SFX.ding();
  UI.toast('📐 ' + U.esc(p.name) + ' is in development (' + p.devNeed + ' RP).', 'good');
  UI.sub.design = 'phones'; UI.render(true);
};

/* ---------- Phone spec sheet modal ---------- */
UI.A.phoneInfo = (el) => {
  const p = S.phoneById(el.dataset.id); if (!p) return;
  const st = S.stats(p), d = S.designOf(p), c = st.cs;
  const last = p.salesHist[p.salesHist.length - 1] || {};
  let s = '<h2>' + U.esc(p.name) + ' ' + H.statusTag(p) + '</h2>' + R.preview('piPrev', d, st, p.color, (G.co.logo.letter || '').slice(0, 1)) +
    '<div class="grid3 mt8"><div class="specTile"><div class="k">Price</div><div class="v">' + U.money(p.price) + '</div></div><div class="specTile"><div class="k">Quality</div><div class="v">' + st.qual.q.toFixed(0) + '</div></div><div class="specTile"><div class="k">Reviews</div><div class="v">' + (p.reviewAvg ? p.reviewAvg.toFixed(1) + '/10' : '—') + '</div></div></div>';
  s += '<div class="card flat mt12"><h3>Spec sheet</h3>' +
    H.stat('Chipset', U.esc(p.chipSource === 'own' ? S.chipById(p.chipId).name : p.chipSnap.name) + ' · ' + D.node(d.chip.node).nm) +
    H.stat('CPU', d.chip.big + '× ' + d.chip.bigClk + ' GHz' + (d.chip.little ? ' + ' + d.chip.little + '× ' + d.chip.littleClk + ' GHz' : '') + ' · Gen ' + d.chip.cpuGen) +
    H.stat('GPU', c.gflops.toFixed(0) + ' GFLOPS' + (c.rt ? ' · ray tracing' : '')) + H.stat('AI engine', c.tops ? c.tops.toFixed(1) + ' TOPS' : 'none') +
    H.stat('Memory', (d.ram.gb < 1 ? d.ram.gb * 1024 + ' MB ' : d.ram.gb + ' GB ') + D.ramT(d.ram.type).name + ' · ' + st.bw.toFixed(1) + ' GB/s') + H.stat('Storage', d.sto.gb + ' GB ' + D.stoT(d.sto.type).name) +
    H.stat('Display', d.disp.size + '" ' + D.dispT(d.disp.type).name + ' · ' + st.pxW + '×' + st.pxH + ' · ' + d.disp.hz + ' Hz · ' + st.nits.toFixed(0) + ' nits') +
    H.stat('Battery', U.num(d.bat.mah) + ' mAh ' + D.batT(d.bat.chem).name + ' · ' + d.bat.charge + ' W') +
    H.stat('Cameras', d.cam.mp + ' MP ' + D.sensorT(d.cam.sensor).name + (d.cam.ois ? ' OIS' : '') + (d.cam.extras.length ? ' + ' + d.cam.extras.join(', ') : '') + ' · front ' + d.cam.front + ' MP') +
    H.stat('Body', D.matT(d.body.mat).name + ' · ' + st.thick.toFixed(1) + ' mm · ' + st.weight.toFixed(0) + ' g' + (d.body.ip !== 'none' ? ' · ' + d.body.ip.toUpperCase() : '')) +
    H.stat('Network', st.modem.name + (st.integrated ? ' (integrated)' : '')) + H.stat('OS', d.os === 'own' ? G.co.name.split(' ')[0] + ' OS' : 'OpenMobile OS') + '</div>';
  s += '<div class="card flat"><h3>Tested</h3>' + H.stat('QuantaBench', U.num(st.bench.total)) + H.stat('Battery (screen-on)', st.sot.toFixed(1) + ' h') + H.stat('Camera score', st.cam.score.toFixed(0)) + H.stat('Sustained performance', U.pct(Math.min(1, st.sustained), 0)) + H.stat('Unit cost', U.money(st.bom)) + '</div>';
  if (p.status !== 'dev') s += '<div class="card flat"><h3>Business</h3>' + H.stat('Sold', U.num(p.sold)) + H.stat('Revenue', U.money(p.revenue)) + H.stat('Last month', U.num(last.units || 0) + ' sold / ' + U.num(last.demand || 0) + ' demand') + H.stat('Stock', U.num(G.inventory[p.id] || 0)) + H.stat('Hype', p.hype.toFixed(0)) + '</div>';
  s += '<div class="row wrap mt12">' + (p.reviews && p.reviews.length ? '<button class="btn" data-a="showMedia" data-id="' + p.id + '">📰 Reviews & media</button>' : '') + '<button class="btn" data-a="labPhone" data-id="' + p.id + '">🧪 Test lab</button><button class="btn" data-a="iterate" data-id="' + p.id + '">♻️ New version</button>' + (p.status === 'ready' ? '<button class="btn pri" data-a="go" data-t="launch">🎤 Launch</button>' : '') + '</div>';
  UI.modal(s);
};

/* ---------- Chip designer ---------- */
UI.A.newChip = () => {
  const fy = S.fy();
  const base = U.deep(M.genSoC(fy, 'mid', 1));
  base.foundry = 'formosa'; base.cpuCustom = false; base.gpuCustom = false; base.npuCustom = false; base.ispCustom = false;
  base.modemGen = 0;
  UI.chipDraft = { name: (G.co.name.split(' ')[0] || 'Core').slice(0, 10) + ' S' + (G.chips.length + 1), spec: base };
  UI.fixChip(); UI.tab = 'design'; UI.render(true);
};
UI.chipOpts = () => {
  const fy = S.fy(), sp = UI.chipDraft.spec;
  const foundry = D.foundries.find((f) => f.id === sp.foundry);
  const nodes = M.foundryNodes(fy, foundry).concat(G.fabs.filter((f) => f.building <= 0).map((f) => D.node(f.node))).filter((n, i, a) => a.indexOf(n) === i);
  const cpu = []; D.cpuGens.forEach((g) => { if (g.year + 0.4 <= fy) cpu.push([g.g + ':0', 'Gen ' + g.g + ' · licensed (' + U.money(D.licenseFee('cpu', g.g)) + (G.licenses['cpu' + g.g] ? ' ✓' : '') + ')']); if (S.has('cpu' + g.g)) cpu.push([g.g + ':1', 'Gen ' + g.g + ' · CUSTOM']); });
  const gpu = []; D.gpuGens.forEach((g) => { if (g.year + 0.3 <= fy) gpu.push([g.g + ':0', 'Gen ' + g.g + ' · licensed' + (G.licenses['gpu' + g.g] ? ' ✓' : '')]); if (S.has('gpu' + g.g)) gpu.push([g.g + ':1', 'Gen ' + g.g + ' · CUSTOM']); });
  const npu = [['0:0', 'None']]; D.npuGens.slice(1).forEach((g) => { if (g.year <= fy) npu.push([g.g + ':0', 'Gen ' + g.g + ' · licensed']); if (S.has('npu' + g.g)) npu.push([g.g + ':1', 'Gen ' + g.g + ' · CUSTOM']); });
  const isp = []; D.ispGens.forEach((g) => { if (g.year <= fy) isp.push([g.g + ':0', 'Gen ' + g.g + ' · licensed (' + g.maxMP + 'MP)']); if (S.has('isp' + g.g)) isp.push([g.g + ':1', 'Gen ' + g.g + ' · CUSTOM (' + g.maxMP + 'MP)']); });
  const modem = [[0, 'None (phones use a discrete modem)']].concat(D.modems.slice(1).filter((m) => S.has('modem' + m.g)).map((m) => [m.g, m.name + ' · in-house']));
  return { nodes, cpu, gpu, npu, isp, modem };
};
UI.fixChip = () => {
  const sp = UI.chipDraft.spec, o = UI.chipOpts();
  if (!o.nodes.find((n) => n.id === sp.node)) sp.node = (o.nodes[o.nodes.length - 1] || D.nodes[2]).id;
  const pick = (list, g, custom, setG, setC) => { const key = g + ':' + (custom ? 1 : 0); if (!list.find((x) => x[0] === key)) { const last = list[list.length - 1]; const [lg, lc] = last[0].split(':'); setG(+lg); setC(lc === '1'); } };
  pick(o.cpu, sp.cpuGen, sp.cpuCustom, (v) => (sp.cpuGen = v), (v) => (sp.cpuCustom = v));
  pick(o.gpu, sp.gpuGen, sp.gpuCustom, (v) => (sp.gpuGen = v), (v) => (sp.gpuCustom = v));
  pick(o.npu, sp.npuGen || 0, sp.npuCustom, (v) => (sp.npuGen = v), (v) => (sp.npuCustom = v));
  pick(o.isp, sp.ispGen, sp.ispCustom, (v) => (sp.ispGen = v), (v) => (sp.ispCustom = v));
  if (sp.modemGen && !S.has('modem' + sp.modemGen)) sp.modemGen = 0;
  const node = D.node(sp.node), cg = D.cpuGens[sp.cpuGen - 1];
  sp.big = U.clamp(sp.big, 1, cg.maxBig);
  const littleOK = sp.cpuGen >= 3 && (!sp.cpuCustom || S.has('bigLittle'));
  sp.little = littleOK ? U.clamp(sp.little, 0, sp.cpuGen >= 7 ? 6 : 4) : 0;
  sp.bigClk = U.clamp(sp.bigClk, 0.3, +(node.fNom * 1.15).toFixed(2));
  sp.littleClk = U.clamp(sp.littleClk, 0.3, +(node.fNom * 0.8).toFixed(2));
  sp.gpuClk = U.clamp(sp.gpuClk, 0.1, +(0.33 * node.fNom * 1.3).toFixed(2));
  sp.gpuCores = U.clamp(sp.gpuCores, 1, 24);
  if (!sp.npuGen) sp.npuUnits = 0; else sp.npuUnits = U.clamp(sp.npuUnits || 1, 1, 8);
  sp.memTypes = sp.memTypes.filter((m) => D.ramT(m).year <= S.fy() + 0.5);
  if (!sp.memTypes.length) sp.memTypes = [U.maxBy(D.ram.filter((r) => r.year <= S.fy() && r.lp), (r) => r.year).id];
};
UI.chipDesigner = () => {
  UI.fixChip();
  const cd = UI.chipDraft, sp = cd.spec, o = UI.chipOpts(), fy = S.fy();
  const node = D.node(sp.node);
  const rng = (k, min, max, step, label, unit) => '<div class="field"><label>' + label + ' <span class="v">' + sp[k] + unit + '</span></label><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + sp[k] + '" data-in="cRange" data-k="' + k + '" data-ch="cRangeDone"></div>';
  const cs = (k, list, cur) => '<select data-ch="cSel" data-k="' + k + '">' + H.opts(list, cur) + '</select>';
  let s = '<div class="ptitle"><button class="btn sm" data-a="cancelChip">✕</button><div class="grow"><h2>Chip designer</h2><div class="sub">Designing a chip is not the same as making it: you pay masks at tape-out and wafers at a foundry.</div></div></div><div class="designer"><div>';
  s += '<div class="card"><h3>🏷️ Project</h3><div class="field"><label>Chip name</label><input type="text" value="' + U.esc(cd.name) + '" data-in="cName"></div>' +
    '<div class="grid2"><div class="field"><label>Foundry</label>' + cs('foundry', D.foundries.map((f) => [f.id, f.name]), sp.foundry) + '<div class="tiny mute">' + D.foundries.find((f) => f.id === sp.foundry).desc + '</div></div>' +
    '<div class="field"><label>Process node</label>' + cs('node', o.nodes.map((n) => [n.id, n.nm + (S.ownFabFor(n.id) ? ' (own fab)' : '')]), sp.node) + '<div class="tiny mute">' + node.dens + ' MTr/mm² · masks ' + U.money(M.maskCost(node, fy)) + '</div></div></div></div>';
  s += '<div class="card"><h3>⚙️ CPU</h3><div class="field"><label>Core architecture</label>' + cs('cpu', o.cpu, sp.cpuGen + ':' + (sp.cpuCustom ? 1 : 0)) + '</div>' +
    rng('big', 1, D.cpuGens[sp.cpuGen - 1].maxBig, 1, 'Performance cores', '') + rng('bigClk', 0.3, +(node.fNom * 1.15).toFixed(2), 0.01, 'Performance clock', ' GHz') +
    (sp.cpuGen >= 3 && (!sp.cpuCustom || S.has('bigLittle')) ? rng('little', 0, sp.cpuGen >= 7 ? 6 : 4, 1, 'Efficiency cores', '') + rng('littleClk', 0.3, +(node.fNom * 0.8).toFixed(2), 0.01, 'Efficiency clock', ' GHz') : '<div class="tiny mute mb8">Efficiency cores need a Gen 3+ architecture' + (sp.cpuCustom ? ' and big.LITTLE research' : '') + '.</div>') +
    rng('l2', 0.25, 16, 0.25, 'L2 cache (total)', ' MB') + rng('l3', 0, 32, 0.5, 'L3 / system cache', ' MB') + '</div>';
  s += '<div class="card"><h3>🎮 GPU · 🤖 AI · 📷 ISP · 📶 Modem</h3><div class="field"><label>GPU architecture</label>' + cs('gpu', o.gpu, sp.gpuGen + ':' + (sp.gpuCustom ? 1 : 0)) + '</div>' +
    rng('gpuCores', 1, 24, 1, 'GPU cores', '') + rng('gpuClk', 0.1, +(0.33 * node.fNom * 1.3).toFixed(2), 0.01, 'GPU clock', ' GHz') +
    '<div class="field"><label>Neural engine</label>' + cs('npu', o.npu, (sp.npuGen || 0) + ':' + (sp.npuCustom ? 1 : 0)) + '</div>' + (sp.npuGen ? rng('npuUnits', 1, 8, 1, 'NPU units', '') : '') +
    '<div class="field"><label>Image signal processor</label>' + cs('isp', o.isp, sp.ispGen + ':' + (sp.ispCustom ? 1 : 0)) + '</div>' +
    '<div class="field"><label>Integrated modem</label>' + cs('modemGen', o.modem, sp.modemGen) + '</div></div>';
  s += '<div class="card"><h3>🧩 Memory controller</h3><div class="seg">' + D.ram.filter((r) => r.year <= fy + 0.5).map((r) => '<button class="' + (sp.memTypes.includes(r.id) ? 'on' : '') + '" data-a="cMem" data-v="' + r.id + '">' + r.name + '</button>').join('') + '</div><div class="field mt12"><label>Bus width</label><div class="seg">' + [16, 32, 64].map((b) => '<button class="' + (sp.memBus === b ? 'on' : '') + '" data-a="cBus" data-v="' + b + '">' + b + '-bit</button>').join('') + '</div></div></div>';
  s += '</div><div class="side" id="cSide">' + UI.chipSide() + '</div></div>';
  return s;
};
UI.chipSide = () => {
  const cd = UI.chipDraft, sp = cd.spec, fy = S.fy();
  const st = M.chipStats(sp, fy, { ...S.chipOpts(), ownFab: !!S.ownFabFor(sp.node) });
  const tape = S.tapeoutCost(sp);
  const rpm = S.fieldRP(); const pm = rpm.sil + 0.4 * (rpm.hw + rpm.sw + rpm.mfg);
  const best = U.maxBy(S.availableSoCs(), (c) => c.rel + (c.tier === 'flagship' ? 1 : 0));
  const bs = best ? M.chipStats(best, fy) : null;
  return '<div class="card glow"><h3>📊 Simulated silicon</h3>' +
    '<div class="grid2"><div class="specTile"><div class="k">Die area</div><div class="v">' + st.area.toFixed(1) + ' mm²</div></div><div class="specTile"><div class="k">Transistors</div><div class="v">' + U.num(st.transistors) + '</div></div>' +
    '<div class="specTile"><div class="k">Yield</div><div class="v ' + (st.yield < 0.5 ? 'bad' : st.yield < 0.75 ? 'warn' : 'good') + '">' + U.pct(st.yield, 0) + '</div></div><div class="specTile"><div class="k">Unit cost</div><div class="v">' + U.money(st.unitCost) + '</div></div></div>' +
    '<hr class="sep">' + H.stat('CPU single-core', st.single.toFixed(0) + (bs ? ' <span class="tiny mute">vs ' + bs.single.toFixed(0) + ' best</span>' : '')) + H.stat('CPU multi-core', st.multi.toFixed(0) + (bs ? ' <span class="tiny mute">vs ' + bs.multi.toFixed(0) + '</span>' : '')) +
    H.stat('GPU', st.gflops.toFixed(0) + ' GFLOPS' + (bs ? ' <span class="tiny mute">vs ' + bs.gflops.toFixed(0) + '</span>' : '')) + H.stat('AI', st.tops.toFixed(1) + ' TOPS') +
    H.stat('Peak CPU power', st.cpuPeak.toFixed(2) + ' W') + H.stat('Peak GPU power', st.gpuPeak.toFixed(2) + ' W') + H.stat('IPC', st.ipc.toFixed(2)) + H.stat('Dies per wafer', st.dpw + ' · defect density ' + st.D0.toFixed(2) + '/cm²') + H.stat('Wafer price', U.money(st.wafer)) +
    '<hr class="sep">' + H.stat('Design effort', U.num(st.designRP) + ' RP (~' + S.eta(st.designRP, pm) + ')') + H.stat('Tape-out (masks + licenses)', U.money(tape)) +
    (S.licenseNeeds(sp).length ? '<div class="tiny mute">New licenses: ' + S.licenseNeeds(sp).map(([k, g]) => k.toUpperCase() + ' Gen ' + g).join(', ') + '</div>' : '') +
    '<button class="btn pri full big mt12" data-a="startChip">🧠 Start chip design</button><div class="tiny mute mt8">Design is free to start. Masks & licenses are paid at tape-out, then ~3 months to first silicon (bugs happen).</div></div>';
};
UI.refreshChip = () => { const el = $('#cSide'); if (el) el.innerHTML = UI.chipSide(); };
UI.I.cRange = (el) => { UI.chipDraft.spec[el.dataset.k] = +el.value; el.closest('.field').querySelector('.v').textContent = el.value + ({ bigClk: ' GHz', littleClk: ' GHz', gpuClk: ' GHz', l2: ' MB', l3: ' MB' }[el.dataset.k] || ''); clearTimeout(UI._ct); UI._ct = setTimeout(UI.refreshChip, 50); };
UI.C.cRangeDone = () => UI.refreshChip();
UI.I.cName = (el) => { UI.chipDraft.name = el.value; };
UI.C.cSel = (el) => {
  const sp = UI.chipDraft.spec, k = el.dataset.k, v = el.value;
  if (['cpu', 'gpu', 'npu', 'isp'].includes(k)) { const [g, c] = v.split(':'); sp[k + 'Gen'] = +g; sp[k + 'Custom'] = c === '1'; if (k === 'npu' && +g && !sp.npuUnits) sp.npuUnits = 2; }
  else sp[k] = isNaN(+v) ? v : +v;
  UI.fixChip(); UI.render();
};
UI.A.cMem = (el) => { const sp = UI.chipDraft.spec, i = sp.memTypes.indexOf(el.dataset.v); if (i >= 0) { if (sp.memTypes.length > 1) sp.memTypes.splice(i, 1); } else if (sp.memTypes.length < 3) sp.memTypes.push(el.dataset.v); else UI.toast('A controller supports up to 3 memory types.'); UI.render(); };
UI.A.cBus = (el) => { UI.chipDraft.spec.memBus = +el.dataset.v; UI.render(); };
UI.A.cancelChip = () => { UI.chipDraft = null; UI.render(true); };
UI.A.startChip = () => { const cd = UI.chipDraft; S.createChip(cd.spec, cd.name.trim() || 'Chip'); UI.chipDraft = null; UI.sub.design = 'chips'; SFX.ding(); UI.render(true); };
