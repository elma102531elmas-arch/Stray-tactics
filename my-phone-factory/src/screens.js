/* =========================================================
   MANAGEMENT SCREENS
   ========================================================= */
const H = {}; // html helpers
H.kpi = (l, v, d = '', cls = '') => '<div class="kpi"><div class="l">' + l + '</div><div class="v ' + cls + '">' + v + '</div><div class="d">' + d + '</div></div>';
H.stat = (k, v) => '<div class="stat"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
H.title = (icon, t, sub) => '<div class="ptitle"><div style="font-size:26px">' + icon + '</div><div><h2>' + t + '</h2>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div></div>';
H.statusTag = (p) => ({ dev: '<span class="tag warn">In development</span>', ready: '<span class="tag acc">Ready to launch</span>', announced: '<span class="tag vio">Announced</span>', onsale: '<span class="tag good">On sale</span>', retired: '<span class="tag">Retired</span>' }[p.status] || '');
H.phoneIcon = (p) => '<div class="ic" style="background:' + p.color + '22;border-color:' + p.color + '66">📱</div>';
H.histSeries = (key, n = 36, f = (x) => x) => G.hist.slice(-n).map((h) => [h.t, f(h[key])]);

/* ================= HQ ================= */
UI.pages.hq = () => {
  const h = G.hist[G.hist.length - 1] || { rev: 0, profit: 0, units: 0 };
  const burn = U.avg(G.hist.slice(-3), (x) => x.profit);
  const runway = !G.hist.length ? 'starting capital' : burn < 0 ? (G.cash / -burn).toFixed(1) + ' mo runway' : 'cash-flow positive';
  const al = UI.alerts().list;
  let s = H.title('🏢', 'Headquarters', U.esc(G.co.name) + ' · ' + S.country().flag + ' ' + S.country().name + ' · ' + U.dateStr(G.t));
  if (al.length) s += '<div class="card">' + al.map(([c, t, tab]) => '<div class="row" style="padding:5px 0;cursor:pointer" data-a="go" data-t="' + tab + '"><span class="tag ' + c + '">' + (c === 'bad' ? '!' : c === 'good' ? '✓' : '•') + '</span><span class="grow small">' + t + '</span><span class="dim">›</span></div>').join('') + '</div>';
  s += '<div class="kpis">' +
    H.kpi('Cash', U.money(G.cash), runway, G.cash < 0 ? 'bad' : '') +
    H.kpi('Last month', U.money(h.profit), 'revenue ' + U.money(h.rev), h.profit >= 0 ? 'good' : 'bad') +
    H.kpi('Phones sold', U.num(h.units), U.num(G.unitsTotal) + ' all-time') +
    H.kpi('Market share', U.pct(G.share.player, 3), 'of ' + U.num(D.unitsPerYear(S.year()) / 12) + '/mo global') +
    H.kpi('Reputation', G.rep.toFixed(0) + '<span class="small mute">/100</span>', U.stars(G.rep)) +
    H.kpi('Company value', U.money(S.companyValue()), S.stage(S.companyValue()) + ' · you own ' + U.pct(S.ownership(), 1)) +
    H.kpi('Team', S.totalStaff(), S.engineers() + ' engineers') +
    H.kpi('Capacity', U.num(S.capacity().cap) + '/mo', 'defects ' + U.pct(S.capacity().defect)) + '</div>';
  // products
  const prods = G.phones.filter((p) => p.status !== 'retired');
  s += '<div class="card"><h3>📱 Product line <span class="r"><button class="btn sm pri" data-a="go" data-t="design">+ New phone</button></span></h3>';
  if (!prods.length) s += '<div class="empty"><div class="e">📐</div>No phones yet. Your first design is waiting.<div class="mt12"><button class="btn pri" data-a="newPhone">Design your first phone</button></div></div>';
  else s += '<div class="list">' + prods.map((p) => {
    const last = p.salesHist[p.salesHist.length - 1];
    const sub = p.status === 'dev' ? 'Development ' + Math.round(p.devProg / p.devNeed * 100) + '%' : p.status === 'onsale' ? U.num(last ? last.units : 0) + ' sold last month · stock ' + U.num(G.inventory[p.id] || 0) : p.status === 'announced' ? 'Preorders ' + U.num(p.preorders || 0) + ' · stock ' + U.num(G.inventory[p.id] || 0) : 'Stock ' + U.num(G.inventory[p.id] || 0);
    return '<div class="it" style="cursor:pointer" data-a="phoneInfo" data-id="' + p.id + '">' + H.phoneIcon(p) + '<div class="grow"><div class="row"><b class="ellip">' + U.esc(p.name) + '</b>' + H.statusTag(p) + '</div><div class="small mute">' + U.money(p.price) + ' · ' + sub + '</div></div>' + (p.hype > 5 ? '<span class="tag gold">🔥 ' + p.hype.toFixed(0) + '</span>' : '') + '</div>';
  }).join('') + '</div>';
  s += '</div>';
  if (G.hist.length > 1) {
    s += '<div class="card"><h3>📈 Cash & revenue</h3>' + UI.chart([{ name: 'Cash', color: '#3ee6ff', data: H.histSeries('cash'), fill: true }, { name: 'Revenue', color: '#3ddc84', data: H.histSeries('rev') }, { name: 'Costs', color: '#ff4d6a', data: H.histSeries('cost') }], { fmt: (v) => U.money(v, 0), legend: true, xlab: U.dateStr }) + '</div>';
  }
  s += '<div class="card"><h3>📰 News</h3><div class="news">' + G.news.slice(0, 30).map((n) => '<div class="n ' + n.type + '"><div class="t">' + U.dateStr(n.t) + '</div>' + n.text + '</div>').join('') + '</div></div>';
  return s;
};

/* ================= R&D ================= */
UI.rndFilter = 'all';
UI.pages.rnd = () => {
  const alloc = S.allocateRP(false);
  const pools = alloc.pools;
  let s = H.title('🔬', 'Research & Development', S.engineers() + ' engineers · ' + G.research.active.length + '/' + S.researchSlots() + ' research slots · ' + G.patents + ' patents');
  s += '<div class="card"><h3>⚡ Monthly research output</h3><div class="grid2">' + S.ENG.map((f) => '<div class="specTile"><div class="k">' + D.FIELDS[f].icon + ' ' + D.FIELDS[f].name + '</div><div class="v" style="color:' + D.FIELDS[f].color + '">' + pools[f].toFixed(0) + ' RP</div><div class="tiny mute">' + U.plural(S.headcount(f), 'engineer') + '</div></div>').join('') + '</div></div>';
  // active work
  const items = alloc.items;
  s += '<div class="card"><h3>🛠️ Active projects</h3>';
  if (!items.length) s += '<div class="empty"><div class="e">😴</div>Nothing in progress — your engineers are idle.</div>';
  items.forEach((it) => {
    const ref = it.ref;
    const name = it.kind === 'res' ? D.tech[ref.id].name : it.kind === 'phone' ? '📱 ' + ref.name + ' (phone)' : '🧠 ' + ref.name + ' (chip design)';
    const prog = it.kind === 'res' ? ref.prog / ref.need : ref.devProg / ref.devNeed;
    const need = it.kind === 'res' ? ref.need - ref.prog : ref.devNeed - ref.devProg;
    s += '<div class="techItem active"><div class="row between"><div class="nm grow ellip">' + U.esc(name) + '</div><span class="tag acc">' + it.got.toFixed(0) + ' RP/mo</span></div>' + UI.bar(prog) +
      '<div class="row between small mute mt8"><span>' + Math.round(need) + ' RP left · ETA ' + S.eta(need, it.got) + '</span>' + (it.kind === 'res' ? '<button class="btn xs bad" data-a="cancelRes" data-id="' + ref.id + '">Cancel</button>' : '') + '</div></div>';
  });
  s += '</div>';
  // tech tree
  const flt = UI.rndFilter;
  s += '<div class="seg mb8">' + [['all', 'All']].concat(Object.keys(D.FIELDS).map((f) => [f, D.FIELDS[f].icon + ' ' + D.FIELDS[f].name])).map(([id, n]) => '<button class="' + (flt === id ? 'on' : '') + '" data-a="rndFlt" data-f="' + id + '">' + n + '</button>').join('') +
    '<button class="' + (UI.rndShowDone ? 'on' : '') + '" data-a="rndDone">' + (UI.rndShowDone ? '✓ ' : '') + 'Show completed</button></div>';
  const cats = {};
  D.techs.forEach((t) => {
    if (flt !== 'all' && t.field !== flt) return;
    const st = S.techState(t.id);
    if (st === 'done' && !UI.rndShowDone) return;
    if (st === 'active') return;
    (cats[t.cat] = cats[t.cat] || []).push([t, st]);
  });
  Object.keys(cats).forEach((cat) => {
    const list = cats[cat].sort((a, b) => ({ available: 0, locked: 1, future: 2, done: 3 }[a[1]] - { available: 0, locked: 1, future: 2, done: 3 }[b[1]]) || a[0].year - b[0].year).slice(0, 14);
    s += '<div class="card"><h3>' + cat + '</h3>' + list.map(([t, st]) => {
      const c = S.researchCost(t.id);
      const ahead = c.ahead > 0.05 ? '<span class="tag warn">' + c.ahead.toFixed(1) + ' yrs ahead · ×' + c.mult.toFixed(1) + '</span>' : c.mult < 0.95 ? '<span class="tag good">mature −' + Math.round((1 - c.mult) * 100) + '%</span>' : '';
      const req = t.req.filter((r) => !S.has(r)).map((r) => D.tech[r].name);
      const fp = pools[t.field] / Math.max(1, G.research.active.filter((a) => D.tech[a.id].field === t.field).length + 1);
      return '<div class="techItem ' + st + '"><div class="row between top"><div class="grow"><div class="nm"><span class="fieldDot" style="background:' + D.FIELDS[t.field].color + '"></span> ' + t.name + ' <span class="tiny dim">' + Math.floor(t.year) + '</span></div><div class="small mute">' + t.desc + '</div>' +
        (req.length ? '<div class="tiny warn mt8">Requires: ' + req.join(', ') + '</div>' : '') + (st === 'future' ? '<div class="tiny dim mt8">Too far ahead of the industry (> 4 years).</div>' : '') + '</div></div>' +
        (st === 'done' ? '<div class="tiny good mt8">✓ Researched ' + U.dateStr(G.research.done[t.id]) + '</div>' : '<div class="row between mt8 wrap"><div class="small"><b>' + U.num(c.rp) + ' RP</b> · <b>' + U.money(c.cash) + '</b> ' + ahead + (st === 'available' ? ' <span class="tiny mute">~' + S.eta(c.rp, fp) + '</span>' : '') + '</div>' +
          (st === 'available' ? '<button class="btn sm pri" data-a="startRes" data-id="' + t.id + '">Research</button>' : '') + '</div>') + '</div>';
    }).join('') + '</div>';
  });
  return s;
};
UI.A.rndFlt = (el) => { UI.rndFilter = el.dataset.f; UI.render(); };
UI.A.rndDone = () => { UI.rndShowDone = !UI.rndShowDone; UI.render(); };
UI.A.startRes = (el) => { if (!UI.err(S.startResearch(el.dataset.id))) { UI.toast('🔬 Research started: ' + D.tech[el.dataset.id].name, 'good'); UI.render(); } };
UI.A.cancelRes = (el) => UI.confirm('Cancel research?', 'Progress and the money spent on prototypes will be lost.', () => S.cancelResearch(el.dataset.id), 'Cancel research', 'bad');

/* ================= FACTORY ================= */
UI.pages.factory = () => {
  const cap = S.capacity();
  let s = H.title('🏭', 'Manufacturing', U.num(cap.cap) + ' units/month capacity · defect rate ' + U.pct(cap.defect));
  s += UI.subtabs('factory', [['prod', 'Production'], ['fac', 'Facilities'], ['fab', 'Chip fabs'], ['con', 'Contracts' + (G.contracts.offers.length ? ' (' + G.contracts.offers.length + ')' : '')]]);
  const sub = UI.cur('factory', 'prod');
  if (sub === 'prod') {
    const used = G.flags.lastCap != null ? G.flags.lastCap - G.flags.lastFree : 0;
    s += '<div class="card"><h3>⚙️ Capacity</h3>' + UI.bar(cap.cap ? used / cap.cap : 0) + '<div class="small mute mt8">Last month used ' + U.num(used) + ' of ' + U.num(G.flags.lastCap || cap.cap) + '. Assembly contracts are produced first. Components are paid for up-front (suppliers give you up to ' + U.money(S.supplierCredit()) + ' of short-term credit).</div></div>';
    const ps = G.phones.filter((p) => ['ready', 'announced', 'onsale'].includes(p.status));
    if (!ps.length) s += '<div class="card empty"><div class="e">🏭</div>No phones ready for production yet. Finish developing a phone first.</div>';
    ps.forEach((p) => {
      const st = S.stats(p);
      const last = p.salesHist[p.salesHist.length - 1] || {};
      s += '<div class="card"><div class="row between"><div class="row">' + H.phoneIcon(p) + '<div><b>' + U.esc(p.name) + '</b> ' + H.statusTag(p) + '<div class="small mute">Unit cost ' + U.money(st.bom) + ' · price ' + U.money(p.price) + ' · margin ' + U.pct(1 - st.bom / p.price, 0) + '</div></div></div></div>' +
        '<div class="grid3 mt12"><div class="specTile"><div class="k">In stock</div><div class="v">' + U.num(G.inventory[p.id] || 0) + '</div></div><div class="specTile"><div class="k">Demand/mo</div><div class="v">' + U.num(last.demand || 0) + '</div></div><div class="specTile"><div class="k">Backlog</div><div class="v">' + U.num(p.backlog || 0) + '</div></div></div>' +
        '<div class="field mt12"><label>Monthly production target <span class="v">' + (p.auto ? 'AUTO' : U.num(p.target || 0) + ' units · ' + U.money((p.target || 0) * st.bom)) + '</span></label>' +
        '<div class="row"><input type="range" min="0" max="' + Math.max(100, Math.ceil(cap.cap / 50) * 50) + '" step="' + (cap.cap > 20000 ? 1000 : 50) + '" value="' + (p.target || 0) + '" data-in="prodTarget" data-id="' + p.id + '" ' + (p.auto ? 'disabled' : '') + '><input type="number" style="width:110px" value="' + (p.target || 0) + '" data-ch="prodTargetN" data-id="' + p.id + '" ' + (p.auto ? 'disabled' : '') + '></div></div>' +
        '<label class="chk"><input type="checkbox" ' + (p.auto ? 'checked' : '') + ' data-ch="prodAuto" data-id="' + p.id + '"> Auto-production (match demand, keep a small buffer)</label></div>';
    });
  } else if (sub === 'fac') {
    G.facilities.forEach((f) => {
      const ft = D.facT(f.type);
      s += '<div class="card"><div class="row between"><div><b>' + ft.name + '</b> ' + (f.building > 0 ? '<span class="tag warn">Under construction · ' + f.building + ' mo</span>' : '') + '<div class="small mute">' + f.lines + '/' + ft.maxLines + ' lines · ' + U.num(f.lines * ft.lineCap * S.autoMult()) + ' units/mo · base defects ' + U.pct(ft.defect) + '</div></div></div>' +
        '<div class="row wrap mt12"><button class="btn sm pri" data-a="addLine" data-id="' + f.id + '" ' + (f.lines >= ft.maxLines ? 'disabled' : '') + '>+ ' + (f.type === 'workshop' ? 'Workstation' : 'Line') + ' (' + U.money(ft.lineCost * S.infl()) + ')</button>' + (G.facilities.length > 1 ? '<button class="btn sm bad" data-a="sellFac" data-id="' + f.id + '">Sell</button>' : '') + '</div></div>';
    });
    s += '<div class="card"><h3>🏗️ Build a new facility</h3>' + D.facilities.filter((f) => f.id !== 'workshop').map((ft) => {
      const cost = ft.build * S.infl() * (0.6 + 0.4 * S.country().rent) * S.diff().cost;
      return '<div class="techItem"><div class="row between"><div><b>' + ft.name + '</b><div class="small mute">' + ft.maxLines + ' lines × ' + U.num(ft.lineCap) + ' units · ' + ft.months + ' months to build · opex from ' + U.money(ft.base * S.country().rent * S.infl()) + '/mo</div></div><button class="btn sm" data-a="buildFac" data-v="' + ft.id + '">' + U.money(cost) + '</button></div></div>';
    }).join('') + '<div class="small mute">Facility opex this month: ' + U.money(S.facilityOpex()) + '</div></div>';
  } else if (sub === 'fab') {
    s += '<div class="card"><h3>🧪 Semiconductor fabs</h3><p class="small mute">Designing chips ≠ making them. Without a fab you pay foundries per wafer. A fab cuts wafer cost by ~60% and lets you sell spare capacity — but costs billions and burns cash every month.</p>';
    if (!G.fabs.length) s += '<div class="empty small">No fabs yet.</div>';
    G.fabs.forEach((f) => { const n = D.node(f.node); s += '<div class="techItem"><div class="row between"><div><b>' + n.nm + ' ' + (f.size === 'pilot' ? 'pilot line' : 'mega-fab') + '</b> ' + (f.building > 0 ? '<span class="tag warn">Building · ' + f.building + ' mo</span>' : '<span class="tag good">Running ' + f.exp + ' mo</span>') + '<div class="small mute">' + U.num(f.wafers) + ' wafers/mo · opex ' + U.money(f.cost * 0.009) + '/mo' + (f.lastFoundry ? ' · foundry customers ' + U.num(f.lastFoundry) + ' wafers' : '') + '</div></div></div><label class="chk"><input type="checkbox" ' + (f.foundry ? 'checked' : '') + ' data-ch="fabFoundry" data-id="' + f.id + '"> Sell spare capacity as a foundry</label></div>'; });
    const nodes = D.nodes.filter((n) => S.has(n.tech));
    s += '<hr class="sep"><b class="small">Build a fab</b>' + (nodes.length ? nodes.map((n) => '<div class="row between mt8"><span>' + n.nm + '</span><span class="row"><button class="btn sm" data-a="buildFab" data-n="' + n.id + '" data-s="pilot">Pilot ' + U.money(S.fabCost(n.id, 'pilot')) + '</button><button class="btn sm" data-a="buildFab" data-n="' + n.id + '" data-s="mega">Mega ' + U.money(S.fabCost(n.id, 'mega')) + '</button></span></div>').join('') : '<div class="small mute mt8">Research <b>Semiconductor Process Engineering</b> and a <b>Fab Process</b> node in R&D → Manufacturing first.</div>') + '</div>';
  } else {
    s += '<div class="card"><h3>📝 Contract offers</h3><p class="small mute">OEM assembly and engineering consulting keep the lights on — but they eat capacity and engineering time.</p>';
    if (!G.contracts.offers.length) s += '<div class="empty small">No offers right now. New offers arrive most months.</div>';
    G.contracts.offers.forEach((c) => {
      const val = c.type === 'assembly' ? c.units * c.months * c.pay : c.rpPerMonth * c.months * c.rate;
      s += '<div class="techItem"><div class="row between top"><div class="grow"><b>' + c.client + '</b> <span class="tag">' + (c.type === 'assembly' ? '🏭 Assembly' : D.FIELDS[c.field].icon + ' Consulting') + '</span><div class="small mute">' + c.desc + '</div><div class="small">Pays ' + (c.type === 'assembly' ? U.money(c.pay) + '/unit' : U.money(c.rate) + '/RP') + ' · total ≈ <b class="good">' + U.money(val) + '</b> · expires ' + U.dateStr(c.expires) + '</div></div><button class="btn sm pri" data-a="acceptCon" data-id="' + c.id + '">Accept</button></div></div>';
    });
    s += '</div><div class="card"><h3>⏳ Active contracts</h3>' + (G.contracts.active.length ? G.contracts.active.map((c) => '<div class="stat"><span class="k">' + c.client + ' · ' + c.desc + '</span><span class="v">' + c.left + ' mo left</span></div>').join('') : '<div class="small mute">None.</div>') + '</div>';
  }
  return s;
};
UI.I.prodTarget = (el) => { const p = S.phoneById(el.dataset.id); p.target = +el.value; const n = el.parentElement.querySelector('input[type=number]'); if (n) n.value = el.value; const lab = el.closest('.field').querySelector('.v'); if (lab) lab.textContent = U.num(p.target) + ' units · ' + U.money(p.target * S.stats(p).bom); };
UI.C.prodTarget = () => UI.render();
UI.C.prodTargetN = (el) => { const p = S.phoneById(el.dataset.id); p.target = Math.max(0, Math.round(+el.value || 0)); UI.render(); };
UI.C.prodAuto = (el) => { const p = S.phoneById(el.dataset.id); p.auto = el.checked; UI.render(); };
UI.A.addLine = (el) => { if (!UI.err(S.addLine(el.dataset.id))) { UI.toast('🔧 Capacity added.', 'good'); UI.render(); } };
UI.A.sellFac = (el) => UI.confirm('Sell facility?', 'You recover ~35% of its value.', () => UI.err(S.sellFacility(el.dataset.id)), 'Sell', 'bad');
UI.A.buildFac = (el) => { const ft = D.facT(el.dataset.v); UI.confirm('Build ' + ft.name + '?', 'Construction takes ' + ft.months + ' months.', () => UI.err(S.buildFacility(el.dataset.v)), 'Build'); };
UI.A.buildFab = (el) => UI.confirm('Build a ' + D.node(el.dataset.n).nm + ' fab?', 'Cost: ' + U.money(S.fabCost(el.dataset.n, el.dataset.s)) + '. Running costs are huge — make sure you have the volume.', () => UI.err(S.buildFab(el.dataset.n, el.dataset.s)), 'Build fab', 'gold');
UI.C.fabFoundry = (el) => { const f = G.fabs.find((x) => x.id === el.dataset.id); f.foundry = el.checked; };
UI.A.acceptCon = (el) => { S.acceptContract(el.dataset.id); UI.toast('📝 Contract accepted.', 'good'); UI.render(); };

/* ================= MARKET ================= */
UI.pages.market = () => {
  let s = H.title('🌍', 'Markets', 'Global smartphone market: ' + U.num(D.unitsPerYear(S.year())) + ' units/year');
  s += UI.subtabs('market', [['reg', 'Regions'], ['prod', 'My products'], ['rivals', 'Competitors'], ['share', 'Market share']]);
  const sub = UI.cur('market', 'reg');
  if (sub === 'reg') {
    s += '<div class="card small mute">Awareness × coverage decides how many buyers even consider your phones. Marketing builds awareness; retail & carrier deals expand coverage (and need sales staff: you have ' + G.staff.sales + ', deals need ' + S.salesNeeded() + ').</div>';
    D.regionIds.forEach((r) => {
      const R = G.regions[r], RD = D.regions[r];
      const units = D.unitsPerYear(S.year()) / 12 * S.regionShare(r, S.fy());
      s += '<div class="card"><div class="row between"><div><b>' + RD.name + '</b> ' + (r === G.co.market ? '<span class="tag acc">Home market</span>' : '') + (R.entered ? '<span class="tag good">Selling</span>' : R.entering ? '<span class="tag warn">Entering · ' + R.entering + ' mo</span>' : '') + '<div class="small mute">' + U.num(units) + ' phones/mo · price sensitivity ' + RD.sens + '×</div></div>' +
        (!R.entered && !R.entering ? '<button class="btn sm pri" data-a="enterReg" data-r="' + r + '">Enter ' + U.money(S.regionCost(r, 'enter')) + '</button>' : '') + '</div>';
      if (R.entered) {
        s += '<div class="grid2 mt12"><div><div class="tiny mute">Awareness ' + U.pct(R.aware) + '</div>' + UI.bar(R.aware) + '</div><div><div class="tiny mute">Coverage ' + U.pct(S.coverage(r), 0) + '</div>' + UI.bar(S.coverage(r), 'good') + '</div></div>' +
          '<div class="row wrap mt12"><span class="tag good">🛒 Online</span>' + (R.retail ? '<span class="tag good">🏬 Retail</span>' : '<button class="btn xs" data-a="channel" data-r="' + r + '" data-k="retail">+ Retail ' + U.money(S.regionCost(r, 'retail')) + '</button>') + (R.carrier ? '<span class="tag good">📶 Carriers</span>' : '<button class="btn xs" data-a="channel" data-r="' + r + '" data-k="carrier">+ Carriers ' + U.money(S.regionCost(r, 'carrier')) + '</button>') + '</div>' +
          '<div class="field mt12"><label>Marketing budget <span class="v">' + U.money(R.mkt || 0) + '/mo</span></label><input type="range" min="0" max="' + UI.mktMax(r) + '" step="' + UI.mktStep(r) + '" value="' + (R.mkt || 0) + '" data-in="mkt" data-r="' + r + '" data-ch="mktDone"></div>';
      }
      s += '</div>';
    });
  } else if (sub === 'prod') {
    const ps = G.phones.filter((p) => p.status === 'onsale' || p.status === 'announced');
    if (!ps.length) s += '<div class="card empty"><div class="e">🛍️</div>Nothing on sale yet.</div>';
    ps.forEach((p) => {
      const st = S.stats(p), fair = S.fairPrice(st.qual.q);
      const last = p.salesHist[p.salesHist.length - 1] || {};
      s += '<div class="card"><div class="row between"><div class="row">' + H.phoneIcon(p) + '<div><b>' + U.esc(p.name) + '</b> ' + H.statusTag(p) + '<div class="small mute">Quality ' + st.qual.q.toFixed(0) + ' · fair price ≈ ' + U.money(fair) + ' · ' + S.tierOfPrice(p.price) + ' segment</div></div></div><button class="btn sm" data-a="phoneInfo" data-id="' + p.id + '">Details</button></div>' +
        '<div class="grid3 mt12"><div class="specTile"><div class="k">Last month</div><div class="v">' + U.num(last.units || 0) + '</div></div><div class="specTile"><div class="k">Total sold</div><div class="v">' + U.num(p.sold) + '</div></div><div class="specTile"><div class="k">Revenue</div><div class="v">' + U.money(p.revenue) + '</div></div></div>' +
        (p.salesHist.length > 1 ? UI.chart([{ name: 'Sold', color: '#3ddc84', data: p.salesHist.map((h) => [h.t, h.units]) }, { name: 'Demand', color: '#a774ff', data: p.salesHist.map((h) => [h.t, h.demand]) }], { h: 120, legend: true, xlab: U.dateStr }) : '') +
        '<div class="field mt12"><label>Retail price <span class="v">' + U.money(p.price) + ' · margin ' + U.pct(1 - st.bom / p.price, 0) + '</span></label><div class="row"><input type="number" value="' + p.price + '" min="29" step="10" data-ch="price" data-id="' + p.id + '"><button class="btn sm" data-a="priceCut" data-id="' + p.id + '" data-v="0.9">−10%</button><button class="btn sm" data-a="priceCut" data-id="' + p.id + '" data-v="1.1">+10%</button></div></div>' +
        '<div class="row mt8"><button class="btn sm bad" data-a="retire" data-id="' + p.id + '">Discontinue</button></div></div>';
    });
  } else if (sub === 'rivals') {
    const alive = G.rivals.slice().sort((a, b) => b.share - a.share);
    alive.forEach((r) => {
      const rv = S.rivalDef(r.id);
      if (!r.started && S.fy() < rv.start) return;
      s += '<div class="card"><div class="row between"><div class="row"><div class="ic" style="width:14px;height:14px;border-radius:50%;background:' + rv.color + '"></div><b>' + rv.name + '</b>' + (r.alive ? '' : ' <span class="tag bad">Exited</span>') + '</div><div class="small">share <b>' + U.pct(r.share, 1) + '</b> · rep ' + r.rep.toFixed(0) + '</div></div>';
      if (r.alive) s += '<div class="scrollx mt8"><table class="tbl"><tr><th>Model</th><th>Tier</th><th class="r">Price</th><th class="r">Quality</th><th class="r">Bench</th></tr>' + r.phones.slice().sort((a, b) => b.price - a.price).map((ph) => '<tr><td>' + ph.name + '</td><td>' + ph.tier + '</td><td class="r">' + U.money(ph.price) + '</td><td class="r">' + S.rivalPhoneQ(ph).q.toFixed(0) + '</td><td class="r">' + U.num(ph.st.bench.total) + '</td></tr>').join('') + '</table></div>';
      s += '</div>';
    });
  } else {
    const rows = G.rivals.filter((r) => r.alive).map((r) => [S.rivalDef(r.id).name, r.share, S.rivalDef(r.id).color]).concat([[G.co.name, G.share.player, G.co.logo.color]]).sort((a, b) => b[1] - a[1]);
    const other = Math.max(0, 1 - U.sum(rows, (x) => x[1]));
    s += '<div class="card"><h3>🥧 Global unit share (last month)</h3>' + rows.concat([['Others', other, '#3a4458']]).map(([n, v, c]) => '<div class="scorebar"><span class="k ellip" ' + (n === G.co.name ? 'style="color:var(--acc);font-weight:800"' : '') + '>' + U.esc(n) + '</span><div class="bar"><i style="width:' + (v * 100).toFixed(2) + '%;background:' + c + '"></i></div><span class="v">' + U.pct(v, 1) + '</span></div>').join('') + '</div>';
    if (G.hist.length > 1) s += '<div class="card"><h3>📈 Your share</h3>' + UI.chart([{ name: 'Share %', color: '#3ee6ff', data: H.histSeries('share', 60, (v) => v * 100), fill: true }], { fmt: (v) => v.toFixed(2) + '%', xlab: U.dateStr }) + '</div>';
  }
  return s;
};
UI.mktMax = (r) => Math.max(20000, Math.round(D.regions[r].ad * 2e6 * S.infl() * Math.min(1, 0.02 + S.companyValue() / 1e9) / 1000) * 1000);
UI.mktStep = (r) => Math.max(500, Math.round(UI.mktMax(r) / 100 / 500) * 500);
UI.I.mkt = (el) => { G.regions[el.dataset.r].mkt = +el.value; el.closest('.field').querySelector('.v').textContent = U.money(+el.value) + '/mo'; };
UI.C.mktDone = () => UI.renderHUD();
UI.A.enterReg = (el) => UI.confirm('Enter ' + D.regions[el.dataset.r].name + '?', 'Certification, legal entity and logistics cost ' + U.money(S.regionCost(el.dataset.r, 'enter')) + ' and take 2 months. Each phone also needs certification per region at release.', () => UI.err(S.enterRegion(el.dataset.r)), 'Enter market');
UI.A.channel = (el) => UI.confirm('Open ' + el.dataset.k + ' channel?', 'Setup cost ' + U.money(S.regionCost(el.dataset.r, el.dataset.k)) + '. ' + (el.dataset.k === 'retail' ? 'Retailers take ~22% margin and need 2 sales staff.' : 'Carriers take ~14% margin and need 3 sales staff.'), () => UI.err(S.openChannel(el.dataset.r, el.dataset.k)), 'Sign deal');
UI.C.price = (el) => { const p = S.phoneById(el.dataset.id); UI.setPrice(p, Math.max(29, Math.round(+el.value))); };
UI.A.priceCut = (el) => { const p = S.phoneById(el.dataset.id); UI.setPrice(p, Math.max(29, Math.round(p.price * +el.dataset.v / 10) * 10 - 1)); };
UI.setPrice = (p, v) => {
  if (p.status === 'onsale' && v < p.price * 0.75 && G.t - p.releaseT < 4) { G.rep = Math.max(0, G.rep - 1.5); UI.toast('😠 Early buyers are angry about the steep price cut.', 'bad'); }
  p.price = v; p._v++; UI.render();
};
UI.A.retire = (el) => UI.confirm('Discontinue this phone?', 'Remaining stock will be liquidated at ~35% of price next month.', () => { const p = S.phoneById(el.dataset.id); p.status = 'retired'; p.target = 0; p.auto = false; }, 'Discontinue', 'bad');

/* ================= FINANCE ================= */
UI.pages.finance = () => {
  const v = S.companyValue();
  let s = H.title('💰', 'Finance', 'Valuation ' + U.money(v) + ' · stage ' + S.stage(v) + ' · you own ' + U.pct(S.ownership()));
  s += UI.subtabs('finance', [['pl', 'Profit & loss'], ['loans', 'Bank'], ['inv', 'Investors' + (G.offers.length ? ' (1)' : '')]].concat(G.equity.public ? [['stock', 'Stock']] : []));
  const sub = UI.cur('finance', 'pl');
  const h = G.hist[G.hist.length - 1];
  if (sub === 'pl') {
    s += '<div class="kpis">' + H.kpi('Annual revenue', U.money(S.annualRevenue()), 'run-rate') + H.kpi('12-mo profit', U.money(S.trailing('profit')), '', S.trailing('profit') >= 0 ? 'good' : 'bad') + H.kpi('Debt', U.money(S.debt()), G.loans.length + ' loans') + H.kpi('Investor confidence', G.invConf.toFixed(0), U.stars(G.invConf)) + '</div>';
    if (h) {
      const L = h.ledger;
      const revRows = Object.keys(L.rev).filter((k) => L.rev[k]).map((k) => H.stat(k, '<span class="good">' + U.money(L.rev[k]) + '</span>')).join('');
      const costRows = Object.keys(L.cost).filter((k) => L.cost[k]).sort((a, b) => L.cost[b] - L.cost[a]).map((k) => H.stat(k + (k === 'expansion' ? ' (capex)' : ''), '<span class="bad">' + U.money(L.cost[k]) + '</span>')).join('');
      s += '<div class="card"><h3>🧾 ' + U.dateStr(h.t) + '</h3><div class="grid2"><div><div class="tiny mute mb8">REVENUE</div>' + (revRows || '<div class="small dim">—</div>') + '</div><div><div class="tiny mute mb8">COSTS</div>' + (costRows || '<div class="small dim">—</div>') + '</div></div>' +
        '<hr class="sep">' + H.stat('Operating profit', '<b class="' + (h.profit >= 0 ? 'good' : 'bad') + '">' + U.money(h.profit) + '</b>') + H.stat('Loan principal repaid', U.money(L.principal)) + '</div>';
    }
    s += '<div class="card"><h3>📊 Monthly profit</h3>' + UI.chart([{ name: 'Profit', color: '#3ddc84', bars: true, data: H.histSeries('profit', 48) }], { fmt: (x) => U.money(x, 0), xlab: U.dateStr }) + '</div>';
    s += '<div class="card"><h3>📈 Company value</h3>' + UI.chart([{ name: 'Value', color: '#a774ff', data: H.histSeries('val', 120), fill: true }], { fmt: (x) => U.money(x, 0), xlab: U.dateStr }) + '</div>';
  } else if (sub === 'loans') {
    const lim = S.creditLimit();
    s += '<div class="card"><h3>🏦 Credit</h3>' + H.stat('Available credit', U.money(lim)) + H.stat('Interest rate', U.pct(S.loanRate()) + ' APR') + H.stat('Outstanding debt', U.money(S.debt())) +
      '<div class="field mt12"><label>Loan amount <span class="v" id="loanV">' + U.money(Math.min(lim, UI.loanAmt || lim / 2)) + '</span></label><input type="range" min="0" max="' + Math.max(1000, Math.floor(lim)) + '" step="' + Math.max(1000, Math.round(lim / 100)) + '" value="' + Math.min(lim, UI.loanAmt || lim / 2) + '" data-in="loanAmt"></div>' +
      '<div class="seg">' + [12, 24, 48, 84].map((m) => '<button class="' + ((UI.loanTerm || 24) === m ? 'on' : '') + '" data-a="loanTerm" data-v="' + m + '">' + m + ' months</button>').join('') + '</div>' +
      '<button class="btn pri full mt12" data-a="takeLoan" ' + (lim < 1000 ? 'disabled' : '') + '>Borrow</button></div>';
    s += '<div class="card"><h3>📃 Loans</h3>' + (G.loans.length ? G.loans.map((l) => '<div class="techItem"><div class="row between"><div><b>' + U.money(l.left) + '</b> left of ' + U.money(l.principal) + (l.emergency ? ' <span class="tag bad">emergency</span>' : '') + '<div class="small mute">' + U.pct(l.rate) + ' APR · ' + U.money(l.payment) + '/mo</div></div><button class="btn sm" data-a="repay" data-id="' + l.id + '">Repay now</button></div></div>').join('') : '<div class="small mute">No loans.</div>') + '</div>';
  } else if (sub === 'inv') {
    s += '<div class="kpis">' + H.kpi('Valuation', U.money(v), S.stage(v)) + H.kpi('Your stake', U.pct(S.ownership()), U.money(v * S.ownership())) + H.kpi('Patents', G.patents, G.flags.licensePatents ? 'licensing' : '') + H.kpi('Confidence', G.invConf.toFixed(0), '') + '</div>';
    s += '<div class="card"><h3>💼 Offers</h3>' + (G.offers.length ? G.offers.map((o) => '<div class="techItem active"><b>' + o.who + '</b> <span class="tag vio">' + o.stage + '</span><div class="mt8">Invest <b class="good">' + U.money(o.raise) + '</b> for <b>' + U.pct(o.pct) + '</b> of the company</div><div class="small mute">Pre-money valuation ' + U.money(o.pre) + ' · expires ' + U.dateStr(o.expires) + '</div><div class="row mt8"><button class="btn sm" data-a="declineOffer">Decline</button><button class="btn sm pri" data-a="acceptOffer" data-id="' + o.id + '">Accept</button></div></div>').join('') : '<div class="small mute">No offers right now. Investors watch your growth, reputation and launches. A new round is possible every 6 months.</div>') + '</div>';
    s += '<div class="card"><h3>🔔 IPO</h3>' + (G.equity.public ? '<div class="good">Listed since ' + U.dateStr(G.milestones.ipo) + '.</div>' : '<div class="small mute">Requires $400M+ annual revenue (inflation-adjusted) or $4B+ valuation, reputation 40+ and 3 years of history.</div><button class="btn gold full mt12" data-a="ipo" ' + (S.canIPO() ? '' : 'disabled') + '>Go public</button>') + '</div>';
    s += '<div class="card"><h3>📜 Patent licensing</h3><label class="chk"><input type="checkbox" ' + (G.flags.licensePatents ? 'checked' : '') + ' data-ch="licPat" ' + (G.patents > 60 ? '' : 'disabled') + '> License my patents to the industry (needs 60+ patents)</label></div>';
    s += '<div class="card"><h3>🧾 Funding history</h3>' + (G.equity.rounds.length ? G.equity.rounds.map((r) => H.stat(U.dateStr(r.t) + ' · ' + r.stage + ' · ' + r.who, U.money(r.raise))).join('') : '<div class="small mute">Bootstrapped so far.</div>') + '</div>';
  } else {
    s += '<div class="kpis">' + H.kpi('Share price', U.money(G.equity.price), '') + H.kpi('Market cap', U.money(G.equity.mcap), '') + H.kpi('Your stake', U.money(G.equity.mcap * S.ownership()), U.pct(S.ownership())) + '</div>';
    s += '<div class="card"><h3>📈 Stock</h3>' + UI.chart([{ name: 'Price', color: '#3ddc84', data: G.equity.priceHist.map((x) => [x.t, x.p]), fill: true }], { fmt: (x) => U.money(x), xlab: U.dateStr }) + '</div>';
  }
  return s;
};
UI.I.loanAmt = (el) => { UI.loanAmt = +el.value; $('#loanV').textContent = U.money(+el.value); };
UI.A.loanTerm = (el) => { UI.loanTerm = +el.dataset.v; UI.render(); };
UI.A.takeLoan = () => { const amt = Math.min(S.creditLimit(), UI.loanAmt || S.creditLimit() / 2); if (!UI.err(S.takeLoan(amt, UI.loanTerm || 24))) { UI.toast('🏦 ' + U.money(amt) + ' borrowed.', 'good'); UI.loanAmt = 0; UI.render(); } };
UI.A.repay = (el) => { if (!UI.err(S.repayLoan(el.dataset.id))) UI.render(); };
UI.A.acceptOffer = (el) => { S.acceptOffer(el.dataset.id); SFX.ding(); UI.render(); };
UI.A.declineOffer = () => { G.offers = []; G.equity.lastRound = G.t - 3; UI.render(); };
UI.A.ipo = () => UI.confirm('Go public?', 'You will sell ~15% of the company to public markets. From now on, your share price reacts to every result.', () => UI.err(S.doIPO()), 'Ring the bell 🔔', 'gold');
UI.C.licPat = (el) => { G.flags.licensePatents = el.checked; };

/* ================= TEAM ================= */
UI.pages.team = () => {
  const rp = S.fieldRP();
  let s = H.title('👥', 'Team', S.totalStaff() + ' people · payroll ' + U.money(S.payroll()) + '/mo · hiring capacity ' + Math.max(0, S.hireCap() - (G.flags.hiredThisMonth || 0)) + ' this month');
  s += '<div class="card"><h3>😊 Culture</h3><div class="grid2"><div><div class="tiny mute">Morale ' + G.morale.toFixed(0) + '/100 · output ×' + (0.75 + 0.45 * G.morale / 100).toFixed(2) + '</div>' + UI.bar(G.morale / 100, G.morale < 40 ? 'bad' : G.morale < 60 ? 'warn' : 'good') + '</div><div><div class="tiny mute">Salary level</div><div class="seg">' + [[0.9, 'Low'], [1, 'Market'], [1.15, 'Generous'], [1.3, 'Top']].map(([v, n]) => '<button class="' + (G.salaryLevel === v ? 'on' : '') + '" data-a="salLvl" data-v="' + v + '">' + n + '</button>').join('') + '</div></div></div>' +
    '<div class="field mt12"><label>Training budget <span class="v">' + U.money(G.training) + '/mo</span></label><input type="range" min="0" max="' + Math.max(2000, Math.round(S.engineers() * 1500 / 500) * 500) + '" step="250" value="' + G.training + '" data-in="training" data-ch="trainingDone"></div><div class="tiny mute">Training speeds up promotions (junior → mid → senior → principal).</div></div>';
  S.ENG.forEach((f) => {
    const fd = D.FIELDS[f];
    s += '<div class="card"><h3>' + fd.icon + ' ' + D.roles[f].name + ' <span class="r small" style="color:' + fd.color + '">' + rp[f].toFixed(0) + ' RP/mo</span></h3>' +
      D.tiers.map((t) => '<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><div><b>' + t.name + '</b> <span class="tag">' + G.staff[f][t.id] + '</span><div class="tiny mute">' + t.rp + ' RP · ' + U.money(S.salaryOf(t.id)) + '/mo</div></div><div class="row"><button class="btn xs bad" data-a="fire" data-r="' + f + '" data-t="' + t.id + '" ' + (G.staff[f][t.id] ? '' : 'disabled') + '>−</button><button class="btn xs pri" data-a="hire" data-r="' + f + '" data-t="' + t.id + '" data-n="1">+1</button><button class="btn xs" data-a="hire" data-r="' + f + '" data-t="' + t.id + '" data-n="5">+5</button></div></div>').join('') + '</div>';
  });
  ['mkt', 'sales'].forEach((f) => {
    s += '<div class="card"><h3>' + D.roles[f].icon + ' ' + D.roles[f].name + ' <span class="r small">' + G.staff[f] + '</span></h3><div class="small mute">' + (f === 'mkt' ? 'Each marketer makes ad spend 2.5% more effective (up to 2×) and improves launch events.' : 'Retail deals need 2 sales staff each and carrier deals need 3, or coverage suffers.') + ' Salary ' + U.money(S.salaryOf('mid') * 0.85) + '/mo.</div><div class="row mt8"><button class="btn sm bad" data-a="fire" data-r="' + f + '" data-t="mid" ' + (G.staff[f] ? '' : 'disabled') + '>−1</button><button class="btn sm pri" data-a="hire" data-r="' + f + '" data-t="mid" data-n="1">+1</button><button class="btn sm" data-a="hire" data-r="' + f + '" data-t="mid" data-n="5">+5</button></div></div>';
  });
  return s;
};
UI.A.salLvl = (el) => { G.salaryLevel = +el.dataset.v; UI.render(); };
UI.I.training = (el) => { G.training = +el.value; el.closest('.field').querySelector('.v').textContent = U.money(G.training) + '/mo'; };
UI.C.trainingDone = () => UI.render();
UI.A.hire = (el) => { if (!UI.err(S.hire(el.dataset.r, el.dataset.t, +el.dataset.n))) { UI.toast('🤝 Hired ' + el.dataset.n + '.', 'good'); UI.render(); } };
UI.A.fire = (el) => {
  if (G.flags.noLayoffs > G.t) { UI.toast('You accepted a grant that forbids layoffs until ' + U.dateStr(G.flags.noLayoffs) + '.', 'bad'); return; }
  UI.confirm('Let one person go?', 'Severance costs one month of salary and hurts morale.', () => S.fire(el.dataset.r, el.dataset.t, 1), 'Let go', 'bad');
};
