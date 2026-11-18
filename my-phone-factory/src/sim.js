/* =========================================================
   GAME STATE & MONTHLY SIMULATION
   ========================================================= */
let G = null;
const S = {};
S.VERSION = 3;
S.has = (id) => !!G && G.research.done[id] != null; // value is the month it finished (can be 0)
S.fy = () => U.fyear(G.t);
S.year = () => U.yearOf(G.t);
S.country = () => D.country(G.co.hq);
S.infl = () => D.inflation(S.fy());
S.diff = () => ({ relaxed: { bank: 1.4, inv: 1.3, cost: 0.95, rival: 0.98 }, realistic: { bank: 1, inv: 1, cost: 1, rival: 1 }, hardcore: { bank: 0.7, inv: 0.75, cost: 1.08, rival: 1.03 } }[G.difficulty] || { bank: 1, inv: 1, cost: 1, rival: 1 });

/* ---------------- new game ---------------- */
S.newGame = (o) => {
  const C = D.country(o.hq);
  G = {
    v: S.VERSION, t: 0, difficulty: o.difficulty || 'realistic', seed: Math.floor(Math.random() * 1e9),
    co: { name: o.name, logo: o.logo, hq: o.hq, market: o.market || C.region, strategy: o.strategy, category: o.category, spec: o.spec, ceo: o.ceo || 'You' },
    cash: 75000, rep: 4, invConf: 50, morale: 72, salaryLevel: 1, training: 0,
    staff: { hw: { junior: 0, mid: 0, senior: 0, principal: 0 }, sil: { junior: 0, mid: 0, senior: 0, principal: 0 }, sw: { junior: 0, mid: 0, senior: 0, principal: 0 }, mfg: { junior: 0, mid: 0, senior: 0, principal: 0 }, mkt: 0, sales: 0 },
    research: { done: {}, active: [] }, licenses: {},
    chips: [], phones: [], facilities: [{ id: U.uid('fac'), type: 'workshop', lines: 1, building: 0 }], fabs: [],
    inventory: {}, regions: {}, loans: [], patents: 0,
    equity: { shares: 1e7, founderShares: 1e7, public: false, price: 0, rounds: [], lastRound: -99 },
    ownBase: 0, installedBase: 0, lossCF: 0, contracts: { offers: [], active: [] }, offers: [],
    rivals: [], news: [], hist: [], events: [], ledger: S.blankLedger(), pending: [], flags: {}, milestones: {},
    world: { shortage: 0, ramSpike: 0, recession: 0, tariff: 0, nodeNews: {} }, insolvent: 0, gameOver: false,
    share: { player: 0, rivals: {} }, lastSales: {}, unitsTotal: 0, revenueTotal: 0, bestPhone: null,
  };
  if (o.spec === 'hw') G.staff.hw.junior = 2; else { G.staff.hw.junior = 1; G.staff[o.spec].junior = 1; }
  D.regionIds.forEach((r) => (G.regions[r] = { entered: r === G.co.market, entering: 0, retail: false, carrier: false, aware: r === G.co.market ? 0.015 : 0, mkt: 0 }));
  D.rivals.forEach((rv) => G.rivals.push({ id: rv.id, rep: rv.rep, alive: true, gen: 1, phones: [], presence: { ...rv.regions }, share: 0, reacted: {} }));
  // rivals' existing lineup
  G.rivals.forEach((r) => { const rv = S.rivalDef(r.id); if (rv.start <= 2010) S.rivalLaunch(r, 2009 + rv.month / 12, true); });
  S.news('🏁 ' + G.co.name + ' is founded in a tiny workshop in ' + C.name + '. $75,000 in the bank. The smartphone race has begun.', 'big');
  S.news('💡 Tip: design your first phone in the DESIGN tab with an off-the-shelf chip, then set up production in FACTORY.', 'tip');
  S.genContracts(true);
  return G;
};
S.blankLedger = () => ({ rev: { phones: 0, contracts: 0, chips: 0, foundry: 0, services: 0, patents: 0, other: 0 }, cost: { bom: 0, salaries: 0, facilities: 0, fabs: 0, marketing: 0, research: 0, tooling: 0, events: 0, interest: 0, taxes: 0, warranty: 0, royalties: 0, logistics: 0, overhead: 0, hiring: 0, expansion: 0, other: 0 }, units: 0, produced: 0, principal: 0, capital: 0 });
S.spend = (amt, cat) => { G.cash -= amt; G.ledger.cost[cat] = (G.ledger.cost[cat] || 0) + amt; };
S.earn = (amt, cat) => { G.cash += amt; G.ledger.rev[cat] = (G.ledger.rev[cat] || 0) + amt; };
S.news = (text, type = 'info') => { G.news.unshift({ t: G.t, text, type }); if (G.news.length > 120) G.news.length = 120; };
S.queue = (ev) => G.pending.push(ev);

/* ---------------- staff & RP ---------------- */
S.ENG = ['hw', 'sil', 'sw', 'mfg'];
S.headcount = (f) => (S.ENG.includes(f) ? U.sum(D.tiers, (t) => G.staff[f][t.id]) : G.staff[f]);
S.engineers = () => U.sum(S.ENG, S.headcount);
S.totalStaff = () => S.engineers() + G.staff.mkt + G.staff.sales;
S.salaryOf = (tierId) => D.tiers.find((t) => t.id === tierId).sal * S.country().wage * Math.pow(1.025, S.fy() - 2010) * G.salaryLevel * (G.co.strategy === 'lean' ? 0.88 : 1);
S.payroll = () => {
  let s = 0;
  S.ENG.forEach((f) => D.tiers.forEach((t) => (s += G.staff[f][t.id] * S.salaryOf(t.id))));
  s += (G.staff.mkt + G.staff.sales) * S.salaryOf('mid') * 0.85;
  return s;
};
S.fieldRP = () => {
  const out = {};
  const moraleF = 0.75 + 0.45 * G.morale / 100;
  S.ENG.forEach((f) => {
    let rp = U.sum(D.tiers, (t) => G.staff[f][t.id] * t.rp);
    if (G.co.spec === f) rp *= 1.2;
    if (G.co.strategy === 'tech') rp *= 1.15;
    out[f] = rp * moraleF;
  });
  return out;
};
S.researchSlots = () => Math.min(12, 2 + Math.floor(S.engineers() / 6));
S.hireCap = () => Math.max(3, Math.floor(S.totalStaff() * 0.12) + 2);
S.hire = (role, tier, n) => {
  if (S.ENG.includes(role)) {
    if (tier === 'senior' && G.rep < 12) return 'Seniors won\'t join an unknown startup yet (reputation 12+).';
    if (tier === 'principal' && G.rep < 32) return 'Principal engineers want an established brand (reputation 32+).';
  }
  G.flags.hiredThisMonth = G.flags.hiredThisMonth || 0;
  if (G.flags.hiredThisMonth + n > S.hireCap()) return 'Recruiting capacity this month: ' + (S.hireCap() - G.flags.hiredThisMonth) + ' more people.';
  const fee = S.salaryOf(S.ENG.includes(role) ? tier : 'mid') * 0.8 * n;
  if (G.cash < fee) return 'Not enough cash for recruiting fees (' + U.money(fee) + ').';
  S.spend(fee, 'hiring');
  if (S.ENG.includes(role)) G.staff[role][tier] += n; else G.staff[role] += n;
  G.flags.hiredThisMonth += n;
  return null;
};
S.fire = (role, tier, n) => {
  if (S.ENG.includes(role)) { n = Math.min(n, G.staff[role][tier]); G.staff[role][tier] -= n; } else { n = Math.min(n, G.staff[role]); G.staff[role] -= n; }
  if (n > 0) { const sev = S.salaryOf(S.ENG.includes(role) ? tier : 'mid') * n; S.spend(sev, 'salaries'); G.morale = Math.max(5, G.morale - n * (18 / Math.max(3, S.totalStaff()))); }
  return n;
};

/* ---------------- research ---------------- */
S.techState = (id) => {
  const t = D.tech[id];
  if (S.has(id)) return 'done';
  if (G.research.active.find((a) => a.id === id)) return 'active';
  if (!t.req.every((r) => S.has(r))) return 'locked';
  if (t.year - S.fy() > 4) return 'future';
  return 'available';
};
S.researchCost = (id) => {
  const t = D.tech[id], fy = S.fy();
  const ahead = t.year - fy;
  let mult = ahead > 0 ? Math.pow(1 + 0.9 * ahead, 1.8) : Math.max(0.4, 1 + 0.09 * ahead);
  return { rp: Math.round(t.rp * mult), cash: Math.round(t.cash * mult * S.diff().cost), mult, ahead };
};
S.startResearch = (id) => {
  const st = S.techState(id);
  if (st !== 'available') return 'Not available.';
  if (G.research.active.length >= S.researchSlots()) return 'All ' + S.researchSlots() + ' research slots are busy. Hire more engineers for more slots.';
  const c = S.researchCost(id);
  if (G.cash < c.cash) return 'Need ' + U.money(c.cash) + ' for prototypes & equipment.';
  S.spend(c.cash, 'research');
  G.research.active.push({ id, need: c.rp, prog: 0, cash: c.cash });
  return null;
};
S.cancelResearch = (id) => { G.research.active = G.research.active.filter((a) => a.id !== id); };
S.completeTech = (id, silent) => {
  G.research.done[id] = G.t;
  const t = D.tech[id];
  const pats = Math.ceil(t.w * 1.5);
  G.patents += pats;
  if (!silent) S.news('🔬 Research complete: <b>' + t.name + '</b> (+' + pats + ' patents). ' + t.desc, 'good');
  if (t.year > S.fy() + 0.5) { G.invConf = Math.min(100, G.invConf + 3); G.rep = Math.min(100, G.rep + 1); S.news('🚀 ' + G.co.name + ' beats the industry to ' + t.name + '!', 'big'); }
};

/* ---------------- RP allocation ---------------- */
S.workItems = () => {
  const items = [];
  G.research.active.forEach((a) => items.push({ kind: 'res', ref: a, fields: [D.tech[a.id].field], need: a.need - a.prog }));
  G.phones.filter((p) => p.status === 'dev').forEach((p) => items.push({ kind: 'phone', ref: p, fields: ['hw', 'sw'], need: p.devNeed - p.devProg }));
  G.chips.filter((c) => c.status === 'dev').forEach((c) => items.push({ kind: 'chip', ref: c, fields: ['sil'], need: c.devNeed - c.devProg }));
  return items;
};
S.allocateRP = (apply = true) => {
  const pools = S.fieldRP();
  const used = { hw: 0, sil: 0, sw: 0, mfg: 0 };
  // consulting contracts take their share first
  G.contracts.active.filter((c) => c.type === 'consult').forEach((c) => {
    const take = Math.min(pools[c.field], c.rpPerMonth);
    pools[c.field] -= take; used[c.field] += take;
    if (apply) c.delivered = (c.delivered || 0) + take;
  });
  const items = S.workItems();
  items.forEach((it) => (it.got = 0));
  S.ENG.forEach((f) => {
    const mine = items.filter((it) => it.fields.includes(f) && it.need > 0);
    let pool = pools[f];
    if (!mine.length) { // spill over at reduced efficiency
      const any = items.filter((it) => it.need - it.got > 0);
      if (any.length) { const share = pool * 0.4 / any.length; any.forEach((it) => { const g = Math.min(share, it.need - it.got); it.got += g; used[f] += g / 0.4; }); }
      return;
    }
    for (let pass = 0; pass < 3 && pool > 0.01; pass++) {
      const open = mine.filter((it) => it.need - it.got > 0.01);
      if (!open.length) break;
      const share = pool / open.length;
      open.forEach((it) => { const g = Math.min(share, it.need - it.got); it.got += g; pool -= g; used[f] += g; });
    }
  });
  if (apply) {
    items.forEach((it) => {
      if (it.kind === 'res') it.ref.prog += it.got;
      else if (it.kind === 'phone') it.ref.devProg += it.got;
      else if (it.kind === 'chip') it.ref.devProg += it.got;
    });
  }
  return { items, pools: S.fieldRP(), used };
};
S.eta = (need, perMonth) => (perMonth <= 0.01 ? '∞' : Math.ceil(need / perMonth) + ' mo');

/* ---------------- context for models ---------------- */
S.supplyMult = () => {
  let m = S.country().supply * S.diff().cost;
  if (S.has('scm1')) m *= 0.97; if (S.has('scm2')) m *= 0.96; if (S.has('scm3')) m *= 0.95;
  if (G.world.shortage > 0) m *= 1.18;
  if (G.world.tariff > 0 && (G.co.hq === 'cn')) m *= 1.06;
  if (G.flags.bulkDeal > G.t) m *= 0.95;
  return m;
};
S.chipOpts = () => ({ dvfs: S.has('dvfs'), sram: S.has('sram'), chiplet: S.has('chiplet'), ipreuse: S.has('ipreuse') });
S.ctx = () => ({ fy: S.fy(), has: S.has, supply: S.supplyMult(), chipOpts: S.chipOpts() });

/* ---------------- chips ---------------- */
S.chipById = (id) => G.chips.find((c) => c.id === id);
S.ownFabFor = (nodeId) => G.fabs.find((f) => f.node === nodeId && f.building <= 0);
S.chipUnitCost = (chip) => {
  const fab = S.ownFabFor(chip.spec.node);
  const opts = { ...S.chipOpts() };
  if (fab) { opts.ownFab = true; opts.extraD0 = Math.max(0, 0.35 - fab.exp * 0.012) * (S.has('qc3') ? 0.6 : 1); }
  return M.chipStats(chip.spec, S.fy(), opts).unitCost;
};
S.licenseNeeds = (spec) => {
  const need = [];
  if (!spec.cpuCustom) need.push(['cpu', spec.cpuGen]);
  if (!spec.gpuCustom) need.push(['gpu', spec.gpuGen]);
  if (spec.npuGen && !spec.npuCustom) need.push(['npu', spec.npuGen]);
  if (!spec.ispCustom) need.push(['isp', spec.ispGen]);
  return need.filter(([k, g]) => !G.licenses[k + g]);
};
S.tapeoutCost = (spec) => M.maskCost(D.node(spec.node), S.fy()) + U.sum(S.licenseNeeds(spec), ([k, g]) => D.licenseFee(k, g));
S.createChip = (spec, name) => {
  const st = M.chipStats(spec, S.fy(), S.chipOpts());
  const chip = { id: U.uid('chip'), name, spec: { ...spec, memTypes: spec.memTypes.slice() }, status: 'dev', devNeed: st.designRP, devProg: 0, created: G.t, sell: false, fabMonths: 0 };
  G.chips.push(chip);
  S.news('🧠 Chip project <b>' + U.esc(name) + '</b> started (' + D.node(spec.node).nm + ', ' + U.num(st.transistors / 1e6) + 'M transistors).', 'info');
  return chip;
};

/* ---------------- phones ---------------- */
S.phoneById = (id) => G.phones.find((p) => p.id === id);
S.resolveChip = (p) => {
  if (p.chipSource === 'own') { const c = S.chipById(p.chipId); return c ? { ...c.spec, rel: (c.readyT != null ? U.fyear(c.readyT) : S.fy()) } : null; }
  return p.chipSnap;
};
S.designOf = (p) => {
  const chip = S.resolveChip(p);
  const d = { ...p.design, chip, chipSource: p.chipSource };
  if (p.chipSource === 'own') { const c = S.chipById(p.chipId); d.chipUnitCost = c ? S.chipUnitCost(c) : 50; }
  return d;
};
S.stats = (p) => {
  if (p._c && p._c.t === G.t && p._c.v === p._v) return p._c.st;
  const d = S.designOf(p);
  const st = M.phoneStats(d, S.fy(), S.ctx());
  st.qual = M.quality(st, S.fy());
  p._c = { t: G.t, v: p._v, st };
  return st;
};
S.devRP = (design, chipSource) => {
  const fy = S.fy();
  const ti = M.TI[S.tierOfPrice(design.price || 200)] || 1;
  let rp = 22 * Math.pow(1.13, fy - 2010) * (1 + 0.35 * ti) * ({ bar: 1, rugged: 1.2, fold: 2.6 }[design.form] || 1);
  if (chipSource === 'own') rp *= 1.3;
  if (design.os === 'own') rp *= 1.25;
  return Math.round(rp);
};
S.toolingCost = (design) => {
  const m = D.matT(design.body.mat);
  return Math.round((14000 + m.cost * 900) * ({ bar: 1, rugged: 1.25, fold: 3.5 }[design.form] || 1) * S.infl() * S.diff().cost);
};
S.createPhone = (o) => {
  const p = { id: U.uid('ph'), name: o.name, color: o.color, accent: o.accent || '#ffffff', design: U.deep(o.design), chipSource: o.chipSource, chipId: o.chipId || null, chipSnap: o.chipSnap ? U.deep(o.chipSnap) : null,
    status: 'dev', devNeed: S.devRP(o.design, o.chipSource), devProg: 0, created: G.t, price: o.design.price, target: 0, auto: false, hype: 0, backlog: 0,
    sold: 0, revenue: 0, salesHist: [], reviews: null, reviewAvg: null, releaseT: null, announced: false, eventIds: [], _v: 1, claims: {} };
  delete p.design.price;
  const tool = S.toolingCost(o.design);
  S.spend(tool, 'tooling');
  G.phones.push(p);
  G.inventory[p.id] = 0;
  S.news('📐 Development of <b>' + U.esc(p.name) + '</b> started. Tooling & molds: ' + U.money(tool) + '.', 'info');
  return p;
};
S.tierOfPrice = (price) => {
  const refs = S.segRefs();
  let best = 'budget', bd = 1e9;
  M.TIERS.forEach((t) => { const d = Math.abs(Math.log(price / refs[t])); if (d < bd) { bd = d; best = t; } });
  return best;
};
M._segRefCache = {};
S.segRefs = (fyArg) => {
  const fy = Math.floor((fyArg ?? S.fy()) * 2) / 2;
  if (!M._segRefCache[fy]) {
    const o = {};
    M.TIERS.forEach((t, i) => {
      const p = M.genPhone(fy, t, { tech: 1 });
      const lag = [2.4, 1.5, 0.7, 0][i];
      const st = M.phoneStats(p, fy, { fy, has: (id) => (D.tech[id] ? D.tech[id].year <= fy - lag : true), sw: 72 });
      o[t] = Math.round(st.bom * [1.8, 1.9, 2.1, 2.4][i]);
      o[t + 'Q'] = M.quality(st, fy).q;
    });
    M._segRefCache[fy] = o;
  }
  return M._segRefCache[fy];
};
// fair price for a quality level at the current market
S.fairPrice = (q, fyArg) => {
  const r = S.segRefs(fyArg);
  const pts = M.TIERS.map((t) => [r[t + 'Q'], r[t]]).sort((a, b) => a[0] - b[0]);
  if (q <= pts[0][0]) return pts[0][1] * Math.max(0.35, 1 - (pts[0][0] - q) / 60);
  if (q >= pts[3][0]) return pts[3][1] * (1 + (q - pts[3][0]) / 25);
  for (let i = 1; i < 4; i++) if (q <= pts[i][0]) { const [q0, p0] = pts[i - 1], [q1, p1] = pts[i]; return Math.exp(Math.log(p0) + (Math.log(p1) - Math.log(p0)) * (q - q0) / Math.max(0.1, q1 - q0)); }
  return pts[3][1];
};
S.releasePhone = (p, opts = {}) => {
  // certification for every entered region
  const regs = D.regionIds.filter((r) => G.regions[r].entered);
  const cert = Math.round(9000 * regs.length * S.infl());
  S.spend(cert, 'tooling');
  p.status = 'onsale'; p.releaseT = G.t; p.launchPrice = p.price;
  if (!opts.silent) S.news('📦 <b>' + U.esc(p.name) + '</b> goes on sale at ' + U.money(p.price) + ' (' + regs.length + ' region' + (regs.length > 1 ? 's' : '') + ', certification ' + U.money(cert) + ').', 'good');
  if (!p.reviews) MED.generateReviews(p, null);
  if (!G.milestones.firstLaunch) { G.milestones.firstLaunch = G.t; S.news('🎉 Milestone: ' + G.co.name + '\'s very first phone is on the market!', 'big'); }
};

/* ---------------- facilities & capacity ---------------- */
S.autoMult = () => 1 + (S.has('auto1') ? 0.25 : 0) + (S.has('auto2') ? 0.25 : 0) + (S.has('auto3') ? 0.35 : 0) + (S.has('auto4') ? 0.35 : 0) + (S.has('auto5') ? 0.4 : 0);
S.labourMult = () => (S.has('auto3') ? 0.8 : 1) * (S.has('auto4') ? 0.8 : 1) * (S.has('auto5') ? 0.7 : 1);
S.defectMult = () => (S.has('qc1') ? 0.75 : 1) * (S.has('qc2') ? 0.7 : 1) * (S.has('qc3') ? 0.65 : 1) * (S.has('auto1') ? 0.9 : 1) * (S.has('auto2') ? 0.9 : 1) * (G.co.spec === 'mfg' ? 0.85 : 1) * (1 - Math.min(0.3, S.headcount('mfg') * 0.004));
S.capacity = () => {
  let cap = 0, defW = 0;
  G.facilities.filter((f) => f.building <= 0).forEach((f) => { const ft = D.facT(f.type); const c = f.lines * ft.lineCap * S.autoMult(); cap += c; defW += c * ft.defect; });
  return { cap: Math.floor(cap), defect: cap ? defW / cap * S.defectMult() : 0 };
};
S.facilityOpex = () => U.sum(G.facilities, (f) => { const ft = D.facT(f.type); return (ft.base * S.country().rent + f.lines * ft.lineOpex * S.country().wage * S.labourMult() * 0.6 + f.lines * ft.lineOpex * 0.4) * S.infl() * (f.building > 0 ? 0.3 : 1); });
S.buildFacility = (type) => {
  const ft = D.facT(type);
  const cost = ft.build * S.infl() * (0.6 + 0.4 * S.country().rent) * S.diff().cost;
  if (G.cash < cost) return 'Need ' + U.money(cost) + '.';
  S.spend(cost, 'expansion'); G.ledger.capital += cost;
  G.facilities.push({ id: U.uid('fac'), type, lines: 1, building: ft.months });
  S.news('🏗️ Construction of a new <b>' + ft.name + '</b> started (' + ft.months + ' months).', 'info');
  return null;
};
S.addLine = (facId) => {
  const f = G.facilities.find((x) => x.id === facId), ft = D.facT(f.type);
  if (f.lines >= ft.maxLines) return 'This facility is full.';
  const cost = ft.lineCost * S.infl() * S.diff().cost;
  if (G.cash < cost) return 'Need ' + U.money(cost) + '.';
  S.spend(cost, 'expansion'); G.ledger.capital += cost; f.lines++;
  return null;
};
S.sellFacility = (facId) => {
  const f = G.facilities.find((x) => x.id === facId), ft = D.facT(f.type);
  if (G.facilities.length <= 1) return 'You need at least one facility.';
  const val = (ft.build + f.lines * ft.lineCost) * 0.35 * S.infl();
  G.facilities = G.facilities.filter((x) => x !== f); S.earn(val, 'other');
  return null;
};
/* fabs */
S.fabCost = (nodeId, size) => D.node(nodeId).fab * Math.max(0.35, 1 - 0.06 * Math.max(0, S.fy() - D.node(nodeId).year)) * (size === 'pilot' ? 0.14 : 1) * S.diff().cost;
S.fabCapacity = (size) => (size === 'pilot' ? 3000 : 30000);
S.buildFab = (nodeId, size) => {
  const node = D.node(nodeId);
  if (!S.has(node.tech)) return 'Research the ' + node.nm + ' process first.';
  const cost = S.fabCost(nodeId, size);
  if (G.cash < cost) return 'Need ' + U.money(cost) + '.';
  S.spend(cost, 'expansion'); G.ledger.capital += cost;
  G.fabs.push({ id: U.uid('fab'), node: nodeId, size, wafers: S.fabCapacity(size), building: size === 'pilot' ? 12 : 24, exp: 0, cost, used: 0 });
  S.news('🏭 Ground broken on a ' + node.nm + ' ' + (size === 'pilot' ? 'pilot line' : 'mega-fab') + ' (' + U.money(cost) + ').', 'big');
  return null;
};
S.fabOpex = () => U.sum(G.fabs, (f) => f.cost * (f.building > 0 ? 0.002 : 0.009));

/* ---------------- regions & marketing ---------------- */
S.regionCost = (r, kind) => Math.round(D.regions[r].entry * S.infl() * { enter: 1, retail: 1.6, carrier: 2.8 }[kind]);
S.enterRegion = (r) => {
  const R = G.regions[r]; if (R.entered || R.entering) return 'Already there.';
  const c = S.regionCost(r, 'enter'); if (G.cash < c) return 'Need ' + U.money(c) + '.';
  S.spend(c, 'expansion'); R.entering = 2; S.news('🌍 Entering ' + D.regions[r].name + ': certification & logistics underway (2 months).', 'info');
  return null;
};
S.openChannel = (r, kind) => {
  const R = G.regions[r]; if (!R.entered) return 'Enter the region first.';
  if (kind === 'retail' && G.rep < 12) return 'Retail chains want reputation 12+.';
  if (kind === 'carrier' && G.rep < 30) return 'Carriers only sign brands with reputation 30+.';
  const c = S.regionCost(r, kind); if (G.cash < c) return 'Need ' + U.money(c) + '.';
  S.spend(c, 'expansion'); R[kind] = true;
  S.news('🤝 ' + (kind === 'retail' ? 'Retail partnership' : 'Carrier deal') + ' signed in ' + D.regions[r].name + '.', 'good');
  return null;
};
S.salesNeeded = () => U.sum(D.regionIds, (r) => (G.regions[r].retail ? 2 : 0) + (G.regions[r].carrier ? 3 : 0));
S.coverage = (r) => {
  const R = G.regions[r]; if (!R.entered) return 0;
  const need = S.salesNeeded(); const salesF = need ? Math.min(1, (G.staff.sales + 1) / need) : 1;
  return Math.min(1, 0.25 + ((R.retail ? 0.35 : 0) + (R.carrier ? 0.4 : 0)) * salesF);
};
S.channelMargin = (r) => { const R = G.regions[r]; const w = [[0.25, 0.06], [R.retail ? 0.35 : 0, 0.22], [R.carrier ? 0.4 : 0, 0.14]]; const tot = U.sum(w, (x) => x[0]); return U.sum(w, (x) => x[0] * x[1]) / tot; };
S.marketingTotal = () => U.sum(D.regionIds, (r) => G.regions[r].mkt || 0);

/* ---------------- finance ---------------- */
S.assets = () => U.sum(G.facilities, (f) => { const ft = D.facT(f.type); return (ft.build + f.lines * ft.lineCost) * 0.6; }) + U.sum(G.fabs, (f) => f.cost * 0.6) + U.sum(G.phones, (p) => (G.inventory[p.id] || 0) * (p._c ? p._c.st.bom : 50) * 0.7);
S.trailing = (key, n = 12) => U.sum(G.hist.slice(-n), (h) => h[key] || 0);
S.annualRevenue = () => { const n = Math.min(12, G.hist.length); return n ? S.trailing('rev', n) * 12 / n : 0; };
S.debt = () => U.sum(G.loans, (l) => l.left);
S.creditLimit = () => {
  const lim = (30000 * S.infl() + 0.35 * S.annualRevenue() + 0.3 * S.assets() + G.patents * 2000) * (0.5 + G.rep / 100) * (0.6 + G.invConf / 125) * S.diff().bank;
  return Math.max(0, lim - S.debt());
};
S.loanRate = () => U.clamp(0.06 + 0.1 * (1 - G.invConf / 100) + (G.rep < 20 ? 0.03 : 0) + (G.insolvent ? 0.1 : 0) + (S.fy() < 2016 ? 0.01 : 0), 0.035, 0.35);
S.takeLoan = (amount, months, emergency) => {
  amount = Math.round(amount);
  if (!emergency && amount > S.creditLimit()) return 'The bank won\'t lend more than ' + U.money(S.creditLimit()) + '.';
  const rate = S.loanRate() + (emergency ? 0.08 : 0);
  const r = rate / 12, pay = amount * r / (1 - Math.pow(1 + r, -months));
  G.loans.push({ id: U.uid('loan'), principal: amount, left: amount, rate, months, payment: pay, t: G.t, emergency: !!emergency });
  G.cash += amount;
  S.news((emergency ? '🚨 Emergency credit line: ' : '🏦 Loan taken: ') + U.money(amount) + ' at ' + U.pct(rate) + ' APR over ' + months + ' months.', emergency ? 'bad' : 'info');
  return null;
};
S.repayLoan = (id) => {
  const l = G.loans.find((x) => x.id === id); if (!l) return;
  if (G.cash < l.left) return 'Need ' + U.money(l.left) + '.';
  G.cash -= l.left; G.ledger.principal += l.left; G.loans = G.loans.filter((x) => x !== l); return null;
};
S.ownership = () => G.equity.founderShares / G.equity.shares;
S.valuation = () => {
  const ar = S.annualRevenue();
  const h = G.hist; const n = h.length;
  const recent = n >= 3 ? U.sum(h.slice(-3), (x) => x.rev) : 0, prior = n >= 15 ? U.sum(h.slice(-15, -12), (x) => x.rev) : 0;
  const growth = prior > 0 ? U.clamp(recent / prior - 1, -0.6, 3) : (recent > 0 ? 1 : 0);
  const profit = n ? S.trailing('profit', Math.min(12, n)) * 12 / Math.min(12, n) : 0;
  const margin = ar > 0 ? U.clamp(profit / ar, -0.5, 0.5) : 0;
  const mult = U.clamp(1.0 + growth * 1.6 + G.rep / 100 * 1.8 + margin * 6 + (G.ownBase > 1e7 ? 1 : 0), 0.4, 9) * (0.55 + G.invConf / 110);
  const tech = U.sum(Object.keys(G.research.done), (id) => D.tech[id].cash) * 0.8 + G.patents * 25000 * S.infl();
  const team = S.engineers() * 45000 * S.infl();
  const intangible = 250000 + tech + team + G.rep * G.rep * 400 * S.infl();
  const v = Math.max(intangible + G.cash - S.debt() + S.assets() * 0.8, ar * mult + G.cash - S.debt() + S.assets() * 0.4);
  return Math.max(50000, v);
};
S.stage = (v) => (G.equity.public ? 'Public' : v < 3e6 ? 'Angel' : v < 15e6 ? 'Seed' : v < 80e6 ? 'Series A' : v < 400e6 ? 'Series B' : v < 2e9 ? 'Series C' : 'Series D');
S.genOffers = () => {
  G.offers = G.offers.filter((o) => o.expires > G.t);
  if (G.equity.public || G.t - G.equity.lastRound < 6 || G.offers.length) return;
  const p = 0.12 + G.invConf / 300 + (G.milestones.firstLaunch ? 0.08 : 0);
  if (!U.chance(p * S.country().investor * S.diff().inv)) return;
  const v = S.valuation() * U.rf(0.75, 1.15) * S.country().investor * S.diff().inv * (G.co.strategy === 'tech' ? 1.12 : 1);
  const stage = S.stage(v);
  const raise = v * U.rf(0.12, 0.3);
  const names = { Angel: ['a group of angel investors', 'a former telecom executive', 'a local tech angel'], Seed: ['Ignition Ventures', 'Firstlight Capital', 'Seedwell Partners'], 'Series A': ['Northstar Ventures', 'Helix Capital', 'Blue Arc Partners'], 'Series B': ['Summit Growth', 'Atlas Venture Fund', 'Meridian Capital'], 'Series C': ['Titan Crossover Fund', 'Sovereign Tech Fund', 'Orbital Growth Equity'], 'Series D': ['Global Pension Alliance', 'MegaFund Vision', 'Pinnacle Late-Stage'] }[stage];
  G.offers.push({ id: U.uid('off'), who: U.pick(names), stage, pre: v, raise, pct: raise / (v + raise), expires: G.t + 2 });
  S.news('💼 Investment offer from <b>' + G.offers[0].who + '</b>: ' + U.money(raise) + ' for ' + U.pct(raise / (v + raise)) + ' (' + stage + ').', 'good');
};
S.acceptOffer = (id) => {
  const o = G.offers.find((x) => x.id === id); if (!o) return;
  const newShares = G.equity.shares * o.pct / (1 - o.pct);
  G.equity.shares += newShares; G.cash += o.raise; G.ledger.capital -= o.raise;
  G.equity.rounds.push({ t: G.t, stage: o.stage, who: o.who, raise: o.raise, pre: o.pre });
  G.equity.lastRound = G.t; G.offers = []; G.invConf = Math.min(100, G.invConf + 4);
  S.news('🤝 Closed ' + o.stage + ' round with ' + o.who + ': +' + U.money(o.raise) + '. Your stake: ' + U.pct(S.ownership()) + '.', 'big');
};
S.canIPO = () => !G.equity.public && (S.annualRevenue() > 400e6 * S.infl() || S.valuation() > 4e9) && G.t >= 36 && G.rep >= 40;
S.doIPO = () => {
  if (!S.canIPO()) return 'Not eligible yet: need $400M+ annual revenue or $4B+ valuation, reputation 40+, 3 years of history.';
  const v = S.valuation() * U.rf(0.95, 1.3) * (0.7 + G.invConf / 160);
  const pct = 0.15, raise = v * pct / (1 - pct) * 1;
  const newShares = G.equity.shares * pct / (1 - pct);
  G.equity.shares += newShares; G.cash += raise; G.equity.public = true; G.equity.price = (v + raise) / G.equity.shares; G.equity.mcap = v + raise;
  G.equity.priceHist = [{ t: G.t, p: G.equity.price }];
  G.equity.rounds.push({ t: G.t, stage: 'IPO', who: 'Public markets', raise, pre: v });
  G.milestones.ipo = G.t;
  S.news('🔔 IPO! ' + G.co.name + ' rings the bell, raising ' + U.money(raise) + ' at a ' + U.money(v + raise) + ' market cap.', 'big');
  return null;
};
S.companyValue = () => (G.equity.public ? G.equity.mcap : S.valuation());

/* ---------------- contracts ---------------- */
S.genContracts = (force) => {
  G.contracts.offers = G.contracts.offers.filter((c) => c.expires > G.t);
  if (G.contracts.offers.length >= 3) return;
  if (!force && !U.chance(0.55)) return;
  const fy = S.fy(), cap = S.capacity().cap, rp = S.fieldRP();
  const clients = ['TeleMart', 'Carrier One', 'Budgetfone', 'Nordic Mobile', 'Sunrise Telecom', 'Orbis Retail', 'Kestrel Mobile', 'Lumora', 'Vantage Digital', 'Pioneer Wireless', 'BlueSky Comms'];
  if (U.chance(0.55) && cap > 0) {
    const months = U.ri(1, 3);
    const units = Math.max(100, Math.round(cap * U.rf(0.3, 0.75) / 50) * 50);
    const pay = +(U.rf(4.5, 9) * S.infl()).toFixed(2);
    G.contracts.offers.push({ id: U.uid('con'), type: 'assembly', client: U.pick(clients), units, months, pay, expires: G.t + 2, desc: 'Assemble ' + U.num(units) + ' units/month for ' + months + ' month' + (months > 1 ? 's' : '') + ' (components supplied).' });
  } else {
    const f = U.weighted(S.ENG, (x) => rp[x] + 1);
    const per = Math.max(4, Math.round((rp[f] || 6) * U.rf(0.3, 0.7)));
    const months = U.ri(2, 4);
    const rate = Math.round(U.rf(260, 420) * Math.pow(1.07, fy - 2010));
    G.contracts.offers.push({ id: U.uid('con'), type: 'consult', field: f, client: U.pick(clients), rpPerMonth: per, months, rate, expires: G.t + 2, desc: D.FIELDS[f].name + ' consulting: ' + per + ' RP/month for ' + months + ' months.' });
  }
};
S.acceptContract = (id) => {
  const c = G.contracts.offers.find((x) => x.id === id); if (!c) return;
  G.contracts.offers = G.contracts.offers.filter((x) => x !== c);
  c.left = c.months; c.delivered = 0; G.contracts.active.push(c);
  S.news('📝 Contract accepted: ' + c.client + ' — ' + c.desc, 'info');
};

/* ---------------- rivals ---------------- */
S.rivalDef = (id) => D.rivals.find((r) => r.id === id);
S.rivalTech = (rv, fy) => M.interp(rv.arc, fy) * rv.tech * (G ? S.diff().rival : 1);
S.rivalSW = (rv, fy) => { let s = 70 + Math.min(18, (fy - 2010) * 1.1); if (rv.ownOS) s += 9; if (rv.legacyOS && fy > 2011.3) s -= Math.min(32, (fy - 2011.3) * 8); return s; };
S.RIVAL_NAMES = {
  nimbus: { flagship: (n) => 'Nimbus One ' + n, premium: (n) => 'Nimbus One ' + n + ' Lite' },
  vantage: { budget: (n) => 'Vantage A' + n, mid: (n) => 'Vantage M' + (n + 1) * 10, premium: (n) => 'Vantage Note ' + n, flagship: (n) => 'Vantage Prime S' + n },
  kestrel: { budget: (n) => 'Kestrel ' + n + '10', mid: (n) => 'Kestrel Lumen ' + n, premium: (n) => 'Kestrel N' + (n + 8) },
  orion: { mid: (n) => 'Orion Key ' + n, premium: (n) => 'Orion Bold ' + (n + 9) },
  xinghe: { budget: (n) => 'Xinghe Redstar ' + n, mid: (n) => 'Xinghe Note ' + n, flagship: (n) => 'Xinghe Mi ' + n },
  lumora: { budget: (n) => 'Lumora Y' + (n + 5), mid: (n) => 'Lumora Nova ' + n, premium: (n) => 'Lumora Mate ' + n, flagship: (n) => 'Lumora P' + n },
  bolt: { budget: (n) => 'Bolt Spark ' + n, mid: (n) => 'Bolt Volt ' + n },
};
S.rivalLaunch = (r, fy, initial) => {
  const rv = S.rivalDef(r.id);
  const techF = S.rivalTech(rv, fy);
  const created = [];
  rv.tiers.forEach((tier) => {
    const prof = { tech: techF, focus: rv.focus };
    const d = M.genPhone(fy, tier, prof);
    const lag = [2.4, 1.5, 0.7, 0][M.TI[tier]] + (1 - techF) * 6;
    const ay = fy - lag;
    const has = (id) => (D.tech[id] ? D.tech[id].year <= ay : true);
    const sw = S.rivalSW(rv, fy);
    const st = M.phoneStats(d, fy, { fy, has, sw });
    const price = Math.max(59, Math.round(st.bom * [1.8, 1.9, 2.1, 2.4][M.TI[tier]] * rv.priceMul / 10) * 10 - 1);
    const name = S.RIVAL_NAMES[r.id][tier](r.gen);
    const ph = { id: U.uid('rp'), rival: r.id, name, tier, design: d, price, launchPrice: price, launchFy: fy, ay, sw, st, color: rv.color, cut: 0 };
    r.phones.push(ph); created.push(ph);
  });
  r.gen++;
  // keep last 2 generations per tier
  r.phones = r.phones.filter((p) => fy - p.launchFy < 2.05);
  if (!initial && created.length) {
    const top = created[created.length - 1];
    S.news('📱 ' + rv.name + ' launches <b>' + top.name + '</b> at ' + U.money(top.price) + (created.length > 1 ? ' (+' + (created.length - 1) + ' more models)' : '') + '.', 'rival');
  }
};
S.rivalPhoneQ = (ph) => {
  if (ph._qt !== G.t) { ph._q = M.quality(ph.st, S.fy()); ph._qt = G.t; }
  return ph._q;
};

/* ---------------- market simulation ---------------- */
S.TYPES = [
  { id: 'general', share: 0.8, w: M.W },
  { id: 'gamer', share: 0.08, w: { perf: 0.38, camera: 0.05, display: 0.2, battery: 0.15, build: 0.05, software: 0.1, features: 0.04, connect: 0.03 } },
  { id: 'photo', share: 0.07, w: { perf: 0.12, camera: 0.45, display: 0.15, battery: 0.1, build: 0.08, software: 0.06, features: 0.02, connect: 0.02 } },
  { id: 'rugged', share: 0.05, w: { perf: 0.15, camera: 0.1, display: 0.1, battery: 0.3, build: 0.2, software: 0.07, features: 0.05, connect: 0.03 } },
];
S.regionShare = (r, fy) => { const t = U.clamp((fy - 2010) / 14, 0, 1); const tot = U.sum(D.regionIds, (k) => U.lerp(D.regions[k].s0, D.regions[k].s1, t)); return U.lerp(D.regions[r].s0, D.regions[r].s1, t) / tot; };
S.ecoFactor = () => { if (!S.has('os_own')) return 0; return U.clamp(Math.sqrt(G.ownBase / 4e7) * (S.has('appstore') ? 1 : 0.45) * (S.has('devprog') ? 1.5 : 1), 0, 1); };
S.marketProducts = () => {
  const prods = [];
  const fy = S.fy();
  G.rivals.filter((r) => r.alive).forEach((r) => {
    const rv = S.rivalDef(r.id);
    r.phones.forEach((ph) => {
      const q = S.rivalPhoneQ(ph);
      const age = (fy - ph.launchFy) * 12;
      let os = rv.ownOS ? 0.35 : 0;
      if (rv.legacyOS && fy > 2011.5) os -= Math.min(1.6, (fy - 2011.5) * 0.45);
      prods.push({ who: r.id, ph, price: ph.price, s: q.s, q: q.q, rep: r.rep / 100, hype: Math.max(0, 25 - age * 3), age, os, aware: (reg) => r.presence[reg] || 0, dist: (reg) => (r.presence[reg] > 0.02 ? 1 : 0), form: ph.design.form });
    });
  });
  G.phones.filter((p) => p.status === 'onsale' || (p.status === 'announced' && p.preorderOpen)).forEach((p) => {
    const st = S.stats(p);
    const eco = p.design.os === 'own' ? S.ecoFactor() : 0.5;
    const os = p.design.os === 'own' ? -1.7 * (1 - eco) + 0.45 * eco : 0;
    const age = p.status === 'onsale' ? G.t - p.releaseT : 0;
    prods.push({ who: 'player', p, price: p.price, s: st.qual.s, q: st.qual.q, rep: G.rep / 100, hype: p.hype, age, os, aware: (reg) => G.regions[reg].aware, dist: (reg) => S.coverage(reg), form: p.design.form, pre: p.status === 'announced' });
  });
  return prods;
};
S.runMarket = () => {
  const fy = S.fy(), y = S.year(), m = G.t % 12;
  const monthly = D.unitsPerYear(y) / 12 * D.season[m] * (G.world.recession > 0 ? 0.82 : 1);
  const refs = S.segRefs();
  const prods = S.marketProducts();
  prods.forEach((p) => { p.sales = 0; p.byReg = {}; });
  const brandUnits = {};
  const playerPriceF = G.co.strategy === 'premium' ? 0.85 : 1;
  D.regionIds.forEach((reg) => {
    const R = D.regions[reg];
    const regUnits = monthly * S.regionShare(reg, fy);
    D.segments.forEach((seg, si) => {
      const segUnits = regUnits * R.mix[si];
      const ref = refs[seg.id], expQ = refs[seg.id + 'Q'];
      S.TYPES.forEach((ty) => {
        const units = segUnits * ty.share;
        let tot = 0, rivalTot = 0;
        const ws = [];
        prods.forEach((pr) => {
          const lr = Math.log(pr.price / ref);
          const mem = Math.exp(-(lr * lr) / (2 * 0.36 * 0.36));
          if (mem < 0.015) return;
          const aw = pr.aware(reg) * pr.dist(reg);
          if (aw <= 0.0005) return;
          let qk = 0; Object.keys(ty.w).forEach((k) => (qk += ty.w[k] * pr.s[k])); qk *= 100;
          let u = 4.5 * (qk - expQ) / 100 - seg.elast * R.sens * (pr.who === 'player' ? playerPriceF : 1) * lr + (1.8 + 0.35 * si) * pr.rep + 1.2 * pr.hype / 100 - 0.035 * pr.age + pr.os;
          if (pr.form === 'rugged') u += ty.id === 'rugged' ? 2.2 : -0.6;
          if (pr.form === 'fold') u += ty.id === 'general' ? 0.25 : 0;
          if (pr.who === 'player' && reg === G.co.market) u += 0.25; // home advantage
          const w = mem * Math.exp(u) * aw;
          ws.push([pr, w]); tot += w; if (pr.who !== 'player') rivalTot += w;
        });
        const other = 0.3 * rivalTot + 0.02;
        ws.forEach(([pr, w]) => { const s = units * w / (tot + other); pr.sales += s; pr.byReg[reg] = (pr.byReg[reg] || 0) + s; });
      });
    });
  });
  let totalMarket = monthly;
  prods.forEach((pr) => { brandUnits[pr.who] = (brandUnits[pr.who] || 0) + pr.sales; });
  return { prods, brandUnits, totalMarket };
};

/* ---------------- the monthly tick ---------------- */
S.tick = () => {
  if (G.gameOver) return;
  const L = G.ledger;
  const fy = S.fy();
  const report = { completed: [], sales: {}, warnings: [] };
  // --- research & development
  S.allocateRP(true);
  G.research.active.slice().forEach((a) => { if (a.prog >= a.need - 0.01) { G.research.active = G.research.active.filter((x) => x !== a); S.completeTech(a.id); report.completed.push(a.id); } });
  G.phones.filter((p) => p.status === 'dev' && p.devProg >= p.devNeed - 0.01).forEach((p) => { p.status = 'ready'; S.news('✅ <b>' + U.esc(p.name) + '</b> development finished! Plan a launch event or release it quietly from the LAUNCH tab.', 'good'); report.completed.push(p.name); });
  G.chips.forEach((c) => {
    if (c.status === 'dev' && c.devProg >= c.devNeed - 0.01) {
      const cost = S.tapeoutCost(c.spec);
      if (G.cash >= cost) {
        S.spend(cost, 'research');
        S.licenseNeeds(c.spec).forEach(([k, g]) => (G.licenses[k + g] = true));
        c.status = 'fab'; c.fabMonths = 3; c.maskPaid = cost;
        S.news('📤 <b>' + U.esc(c.name) + '</b> taped out (' + U.money(cost) + ' masks & licenses). First silicon in 3 months.', 'good');
      } else if (!c.waitWarned) { c.waitWarned = true; S.news('⏸️ <b>' + U.esc(c.name) + '</b> is ready to tape out but needs ' + U.money(cost) + ' for masks & licenses.', 'bad'); }
    } else if (c.status === 'fab') {
      c.fabMonths--;
      if (c.fabMonths <= 0) {
        const bug = U.chance(0.12 + (S.has('ipreuse') ? -0.05 : 0) + (c.spec.cpuCustom ? 0.05 : 0));
        if (bug) { c.status = 'fab'; c.fabMonths = 3; const re = M.maskCost(D.node(c.spec.node), fy) * 0.35; S.spend(re, 'research'); S.news('🐞 Silicon bug found in <b>' + U.esc(c.name) + '</b>! Metal-layer respin: ' + U.money(re) + ', +3 months.', 'bad'); }
        else { c.status = 'ready'; c.readyT = G.t; G.patents += 5; S.news('🧠 <b>' + U.esc(c.name) + '</b> first silicon works! Your own chip is ready for phones.', 'big'); if (!G.milestones.firstChip) { G.milestones.firstChip = G.t; G.invConf = Math.min(100, G.invConf + 6); } }
      }
    }
  });
  // --- staff dynamics
  const trainF = 1 + Math.min(1.5, G.training / Math.max(1, S.engineers() * 400));
  S.ENG.forEach((f) => {
    const s = G.staff[f];
    const prom = (from, to, p) => { let n = 0; for (let i = 0; i < s[from]; i++) if (U.chance(p * trainF)) n++; s[from] -= n; s[to] += n; return n; };
    prom('senior', 'principal', 0.003); prom('mid', 'senior', 0.009); prom('junior', 'mid', 0.016);
    D.tiers.forEach((t) => { let q = 0; for (let i = 0; i < s[t.id]; i++) if (U.chance(0.004 + (G.morale < 40 ? 0.02 : 0) + (G.salaryLevel < 1 ? 0.008 : 0))) q++; if (q) { s[t.id] -= q; if (q >= 2 || t.id !== 'junior') S.news('👋 ' + q + ' ' + t.name.toLowerCase() + ' ' + D.FIELDS[f].name.toLowerCase() + ' engineer' + (q > 1 ? 's' : '') + ' quit.', 'bad'); } });
  });
  G.morale = U.clamp(G.morale + (G.salaryLevel - 1) * 8 + (62 - G.morale) * 0.05 + (G.training > 0 ? 0.8 : 0), 5, 100);
  G.flags.hiredThisMonth = 0;
  // --- facilities & fabs
  G.facilities.forEach((f) => { if (f.building > 0) { f.building--; if (f.building === 0) S.news('🏭 Your new <b>' + D.facT(f.type).name + '</b> is operational.', 'good'); } });
  G.fabs.forEach((f) => { if (f.building > 0) { f.building--; if (!f.building) S.news('🏭 ' + D.node(f.node).nm + ' fab is producing wafers!', 'big'); } else f.exp++; });
  // --- regions entering
  D.regionIds.forEach((r) => { const R = G.regions[r]; if (R.entering > 0) { R.entering--; if (!R.entering) { R.entered = true; R.aware = Math.max(R.aware, 0.005); S.news('🌍 You can now sell in <b>' + D.regions[r].name + '</b>.', 'good'); } } });
  // --- scheduled releases of announced phones
  G.phones.filter((p) => p.status === 'announced' && p.releaseAt <= G.t).forEach((p) => S.releasePhone(p));
  // --- production
  S.produce(report);
  // --- market & sales
  const mk = S.runMarket();
  S.applySales(mk, report);
  // --- operating costs are settled after this month's sales
  S.spend(S.payroll(), 'salaries');
  if (G.training > 0) S.spend(G.training, 'salaries');
  S.spend(S.facilityOpex(), 'facilities');
  S.spend(S.fabOpex(), 'fabs');
  // --- marketing & awareness
  S.updateBrand(mk);
  // --- contracts
  S.runContracts();
  // --- services, patents, chip sales, foundry
  S.otherIncome(mk);
  // --- loans
  G.loans.slice().forEach((l) => {
    const interest = l.left * l.rate / 12, principal = Math.min(l.left, l.payment - interest);
    S.spend(interest, 'interest'); G.cash -= principal; L.principal += principal; l.left -= principal;
    if (l.left <= 1) { G.loans = G.loans.filter((x) => x !== l); S.news('🏦 Loan fully repaid.', 'good'); }
  });
  // --- taxes
  const opProfit = U.sum(Object.values(L.rev)) - U.sum(Object.values(L.cost)) + L.cost.expansion;
  if (opProfit > 0) { const taxable = Math.max(0, opProfit - G.lossCF); G.lossCF = Math.max(0, G.lossCF - opProfit); if (taxable > 0) S.spend(taxable * S.country().tax, 'taxes'); } else G.lossCF += -opProfit;
  // --- rivals
  S.updateRivals(mk);
  // --- world
  S.worldEvents();
  // --- investors
  G.invConf = U.clamp(G.invConf + (50 - G.invConf) * 0.03, 0, 100);
  S.genOffers();
  S.genContracts(false);
  // --- history
  const rev = U.sum(Object.values(L.rev)), cost = U.sum(Object.values(L.cost)) - L.cost.expansion;
  const share = mk.brandUnits.player ? mk.brandUnits.player / mk.totalMarket : 0;
  G.share.player = share;
  if (G.equity.public) S.updateStock(rev - cost);
  const val = S.companyValue();
  G.hist.push({ t: G.t, cash: G.cash, rev, cost, profit: rev - cost, units: L.units, produced: L.produced, share, rep: G.rep, val, ledger: L, staff: S.totalStaff() });
  if (G.hist.length > 600) G.hist.shift();
  S.milestones(val, share);
  // --- insolvency
  if (G.cash < 0) {
    const lim = S.creditLimit();
    const need = -G.cash + 5000 * S.infl();
    if (lim >= need * 0.6) { S.takeLoan(need, 12, true); G.insolvent = 0; }
    else {
      G.insolvent++;
      if (G.insolvent >= 2) { G.gameOver = true; S.news('💀 ' + G.co.name + ' has gone bankrupt.', 'bad'); }
      else S.queue({ kind: 'insolvent' });
    }
  } else G.insolvent = 0;
  G.ledger = S.blankLedger();
  G.t++;
  // yearly news on nodes
  D.nodes.forEach((n) => { if (!G.world.nodeNews[n.id] && S.fy() >= n.year && n.year > 2010) { G.world.nodeNews[n.id] = 1; S.news('⚙️ Formosa Silicon begins mass production on <b>' + n.nm + '</b>.', 'industry'); } });
  if (G.t % 12 === 0) S.news('📅 Happy new year ' + S.year() + '! New chips from Quantic, MediaCore, Exyra and Unicell hit the market.', 'industry');
  return report;
};

// suppliers ship on net-30 terms: production may dip below zero cash, settled by this month's sales
S.supplierCredit = () => Math.max(12000 * S.infl(), U.avg(G.hist.slice(-3), (h) => h.ledger.rev.phones) * 0.6) * (G.rep < 5 ? 0.6 : 1);
S.produce = (report) => {
  const L = G.ledger;
  const { cap, defect } = S.capacity();
  let free = cap;
  // assembly contracts first
  G.contracts.active.filter((c) => c.type === 'assembly').forEach((c) => { const u = Math.min(free, c.units); free -= u; c.done = (c.done || 0) + u; c.thisMonth = u; });
  const ctx = S.ctx();
  G.phones.filter((p) => p.status !== 'dev' && p.status !== 'retired').forEach((p) => {
    let target = p.target || 0;
    if (p.auto) { const last = (p.salesHist[p.salesHist.length - 1] || {}).demand || 0; target = Math.max(0, Math.round(Math.max(last, p.backlog * 0.6) * 1.15 - (G.inventory[p.id] || 0) * 0.6)); }
    if (target <= 0 || free <= 0) return;
    const st = S.stats(p);
    const unit = st.bom;
    const affordable = Math.floor(Math.max(0, G.cash + S.supplierCredit()) / unit);
    let units = Math.min(target, free, affordable);
    if (units < target && affordable < target && !p._cashWarn) { report.warnings.push('Cash limited production of ' + p.name); }
    if (units <= 0) return;
    // own-chip supply through foundry/fab
    if (p.chipSource === 'own') { const c = S.chipById(p.chipId); if (c) { c.made = (c.made || 0) + units; } }
    free -= units;
    S.spend(units * unit, 'bom');
    const bad = Math.round(units * defect);
    G.inventory[p.id] = (G.inventory[p.id] || 0) + units - bad;
    p.defectRate = defect;
    L.produced += units - bad;
    p.producedTotal = (p.producedTotal || 0) + units - bad;
  });
  G.flags.lastCap = cap; G.flags.lastFree = free;
};

S.applySales = (mk, report) => {
  const L = G.ledger;
  mk.prods.filter((pr) => pr.who === 'player').forEach((pr) => {
    const p = pr.p;
    let demand = pr.sales;
    if (pr.pre) { // preorders accumulate until release
      p.backlog += demand * 0.7; p.preorders = (p.preorders || 0) + demand * 0.7;
      p.salesHist.push({ t: G.t, units: 0, demand: Math.round(demand), rev: 0, pre: true });
      return;
    }
    const want = demand + p.backlog;
    const inv = G.inventory[p.id] || 0;
    const sold = Math.floor(Math.min(want, inv));
    const fromBacklog = Math.min(p.backlog, sold);
    p.backlog = Math.max(0, (p.backlog - fromBacklog) * 0.75 + Math.max(0, demand - (sold - fromBacklog)) * 0.35);
    if (want > inv * 1.5 && want > 200 && !p._soldOutT) { p._soldOutT = G.t; p.hype = Math.min(100, p.hype + 6); S.news('🔥 <b>' + U.esc(p.name) + '</b> is SOLD OUT! Customers are waiting (' + U.num(want - inv) + ' units of unmet demand).', 'good'); }
    if (want <= inv) p._soldOutT = null;
    G.inventory[p.id] = inv - sold;
    // revenue by region share of demand
    let rev = 0;
    const tot = U.sum(Object.values(pr.byReg)) || 1;
    Object.keys(pr.byReg).forEach((r) => { rev += sold * (pr.byReg[r] / tot) * p.price * (1 - S.channelMargin(r)); });
    const royalty = sold * p.price * (G.patents >= 300 ? 0.01 : 0.022);
    const warranty = sold * (p.defectRate || 0.04) * 0.18 * 45 * S.infl();
    // freight, packaging, accessories, duties; plus support/admin/legal/IT overhead that scales with sales
    const logistics = sold * (6 * S.infl() + 0.05 * p.price) * (S.has('scm2') ? 0.9 : 1);
    const overhead = rev * 0.14 * (G.co.strategy === 'lean' ? 0.85 : 1);
    S.earn(rev, 'phones'); S.spend(royalty, 'royalties'); S.spend(warranty, 'warranty'); S.spend(logistics, 'logistics'); S.spend(overhead, 'overhead');
    p.sold += sold; p.revenue += rev; L.units += sold; G.unitsTotal += sold; G.revenueTotal += rev;
    G.installedBase = G.installedBase * (1 - 1 / 42) + sold;
    if (p.design.os === 'own') G.ownBase = G.ownBase * (1 - 1 / 42) + sold;
    p.salesHist.push({ t: G.t, units: sold, demand: Math.round(demand), rev });
    if (p.salesHist.length > 120) p.salesHist.shift();
    report.sales[p.id] = sold;
    p.lastByReg = pr.byReg;
  });
  // retired phones: liquidate
  G.phones.filter((p) => p.status === 'retired' && G.inventory[p.id] > 0).forEach((p) => { const u = G.inventory[p.id]; S.earn(u * p.price * 0.35, 'other'); G.inventory[p.id] = 0; S.news('🏷️ Liquidated ' + U.num(u) + ' leftover ' + U.esc(p.name) + ' units.', 'info'); });
  // hype decay
  G.phones.forEach((p) => { p.hype *= p.status === 'announced' ? 0.92 : 0.82; });
  // rivals unit share
  G.rivals.forEach((r) => { r.lastUnits = mk.brandUnits[r.id] || 0; r.share = r.lastUnits / mk.totalMarket; });
};

S.updateBrand = (mk) => {
  const mktF = 1 + Math.min(1, G.staff.mkt * 0.025);
  const womF = G.co.strategy === 'value' ? 1.3 : G.co.strategy === 'lean' ? 0.85 : 1;
  const regSales = {};
  mk.prods.filter((p) => p.who === 'player').forEach((pr) => Object.keys(pr.byReg).forEach((r) => (regSales[r] = (regSales[r] || 0) + pr.byReg[r])));
  const monthly = mk.totalMarket;
  D.regionIds.forEach((r) => {
    const R = G.regions[r];
    const spend = R.entered ? R.mkt || 0 : 0;
    if (spend > 0) S.spend(spend, 'marketing');
    const scale = D.regions[r].ad * 1e6 * S.infl();
    const ad = 0.12 * Math.sqrt(spend / scale) * mktF;
    const wom = (regSales[r] || 0) / (monthly * S.regionShare(r, S.fy())) * 2.5 * womF;
    R.aware = U.clamp(R.aware + (ad + wom) * (1 - R.aware) - 0.015 * R.aware, 0, 0.98);
  });
  // reputation drifts toward customer satisfaction
  const onsale = G.phones.filter((p) => p.status === 'onsale' && p.sold > 0);
  if (onsale.length) {
    let wsum = 0, ssum = 0;
    onsale.forEach((p) => {
      const st = S.stats(p), fair = S.fairPrice(st.qual.q);
      const sat = U.clamp(40 + (fair / p.price - 1) * 45 + (st.qual.q - 50) * 0.5 + ((p.reviewAvg || 6) - 6) * 6 - (p.defectRate || 0.05) * 150, 0, 100);
      const w = Math.max(1, (p.salesHist[p.salesHist.length - 1] || {}).units || 1);
      wsum += w; ssum += sat * w;
    });
    const target = ssum / wsum;
    const speed = 0.025 * (G.co.strategy === 'premium' ? 1.2 : 1) * (S.has('os_updates') ? 1.2 : 1) * (S.has('cloud') ? 1.15 : 1);
    G.rep = U.clamp(G.rep + (target - G.rep) * speed * (target > G.rep ? 1 : 0.6), 0, 100);
  } else G.rep = Math.max(0, G.rep - 0.05);
};

S.runContracts = () => {
  G.contracts.active.slice().forEach((c) => {
    c.left--;
    if (c.type === 'assembly') {
      const done = c.thisMonth || 0;
      const pay = done * c.pay; S.earn(pay, 'contracts');
      if (done < c.units * 0.98) { const pen = (c.units - done) * c.pay * 0.6; S.spend(pen, 'other'); S.news('⚠️ Missed ' + c.client + ' assembly quota by ' + U.num(c.units - done) + ' units. Penalty ' + U.money(pen) + '.', 'bad'); G.rep = Math.max(0, G.rep - 0.5); }
    } else {
      const del = c.delivered || 0; c.delivered = 0;
      S.earn(del * c.rate, 'contracts');
      if (del < c.rpPerMonth * 0.9) { S.news('⚠️ ' + c.client + ' consulting fell short (' + Math.round(del) + '/' + c.rpPerMonth + ' RP).', 'bad'); }
    }
    if (c.left <= 0) { G.contracts.active = G.contracts.active.filter((x) => x !== c); S.news('📝 Contract with ' + c.client + ' completed.', 'info'); }
  });
};

S.otherIncome = (mk) => {
  const infl = S.infl();
  if (S.has('appstore')) S.earn(G.ownBase * 0.22 * (S.has('cloud') ? 2 : 1) * infl, 'services');
  if (G.patents > 60 && G.flags.licensePatents) S.earn(G.patents * 120 * infl, 'patents');
  // external chip sales
  G.chips.filter((c) => c.status === 'ready' && c.sell).forEach((c) => {
    const tierChips = M.socMarket(S.fy());
    const st = M.chipStats(c.spec, S.fy(), S.chipOpts());
    const cost = S.chipUnitCost(c);
    const price = cost * 1.7;
    const best = U.maxBy(tierChips, (x) => { const s = M.chipStats(x, S.fy()); return Math.pow(s.single, 0.4) * Math.pow(s.gflops, 0.4) / Math.pow(M.socPrice(x, S.fy()), 0.6); });
    const bs = M.chipStats(best, S.fy());
    const rel = (Math.pow(st.single, 0.4) * Math.pow(st.gflops, 0.4) / Math.pow(price, 0.6)) / (Math.pow(bs.single, 0.4) * Math.pow(bs.gflops, 0.4) / Math.pow(M.socPrice(best, S.fy()), 0.6));
    const units = Math.max(0, mk.totalMarket * 0.02 * Math.pow(U.clamp(rel, 0, 2), 3) * (0.3 + G.rep / 100)) ;
    if (units > 100) { S.earn(units * price, 'chips'); S.spend(units * cost, 'bom'); c.extSold = (c.extSold || 0) + units; c.extLast = units; } else c.extLast = 0;
  });
  // fab spare capacity → foundry business
  G.fabs.filter((f) => f.building <= 0 && f.foundry).forEach((f) => {
    const node = D.node(f.node);
    const used = U.sum(G.chips.filter((c) => c.spec.node === f.node), (c) => { const st = M.chipStats(c.spec, S.fy()); const m = (c.made || 0); c.made = 0; return m / Math.max(1, st.dpw * st.yield); });
    const spare = Math.max(0, f.wafers - used);
    const demand = spare * U.clamp(0.25 + G.rep / 200 - Math.max(0, S.fy() - node.year - 4) * 0.05, 0.05, 0.9);
    const price = M.waferPrice(node, S.fy(), D.foundries[1]) * 0.85;
    S.earn(demand * price, 'foundry'); S.spend(demand * price * 0.45, 'fabs');
    f.lastFoundry = demand;
  });
};

S.updateRivals = (mk) => {
  const fy = S.fy(), m = G.t % 12;
  G.rivals.forEach((r) => {
    const rv = S.rivalDef(r.id);
    if (!r.alive) return;
    if (!r.started && fy >= rv.start) { r.started = true; if (rv.start > 2010) { S.rivalLaunch(r, fy, false); S.news('🆕 New competitor <b>' + rv.name + '</b> enters the smartphone market.', 'rival'); } }
    if (fy < rv.start) return;
    if (m === rv.month && G.t > 0) S.rivalLaunch(r, fy, false);
    // regional growth
    if (rv.grow && m === 0) D.regionIds.forEach((reg) => (r.presence[reg] = Math.min(0.95, (r.presence[reg] || 0) + rv.grow * (0.5 + Math.random()))));
    // reputation drift toward product quality
    const qs = r.phones.map((ph) => S.rivalPhoneQ(ph).q);
    if (qs.length) r.rep = U.clamp(r.rep + ((U.avg(qs) - 40) * 1.1 - r.rep) * 0.01, 5, 98);
    // exits
    if (rv.exitBelow && fy > 2014 && r.share < rv.exitBelow && U.chance(0.04)) { r.alive = false; S.news('🪦 <b>' + rv.name + '</b> exits the phone business after years of decline.', 'big'); }
    // price cuts with age
    r.phones.forEach((ph) => { const age = fy - ph.launchFy; if (age > 0.5 && ph.cut < 1) { ph.price = Math.round(ph.launchPrice * 0.88 / 10) * 10 - 1; ph.cut = 1; } else if (age > 1.1 && ph.cut < 2) { ph.price = Math.round(ph.launchPrice * 0.75 / 10) * 10 - 1; ph.cut = 2; } });
  });
  // rivals react to a hot player product
  G.phones.filter((p) => p.status === 'onsale').forEach((p) => {
    const st = S.stats(p);
    const t = S.tierOfPrice(p.price);
    const hot = p.hype > 55 || (p.salesHist.length && (p.salesHist[p.salesHist.length - 1].units / Math.max(1, mk.totalMarket)) > 0.01);
    if (!hot) return;
    const cands = G.rivals.filter((r) => r.alive && !r.reacted[p.id] && r.phones.some((ph) => ph.tier === t));
    if (!cands.length || !U.chance(0.35)) return;
    const r = U.pick(cands); r.reacted[p.id] = true;
    const ph = U.maxBy(r.phones.filter((x) => x.tier === t), (x) => x.launchFy);
    ph.price = Math.round(ph.price * 0.88 / 10) * 10 - 1; ph.launchPrice = Math.max(ph.price, ph.launchPrice * 0.9);
    S.news('⚔️ ' + S.rivalDef(r.id).name + ' responds to <b>' + U.esc(p.name) + '</b>: ' + ph.name + ' price cut to ' + U.money(ph.price) + '.', 'rival');
  });
};

S.updateStock = (profit) => {
  const fundamental = S.valuation();
  const prev = G.equity.mcap || fundamental;
  const drift = (fundamental - prev) / prev * 0.25;
  const noise = U.gauss() * 0.045;
  G.equity.mcap = Math.max(1e6, prev * (1 + drift + noise + (G.invConf - 50) / 2500));
  G.equity.price = G.equity.mcap / G.equity.shares;
  G.equity.priceHist.push({ t: G.t, p: G.equity.price });
  if (G.equity.priceHist.length > 400) G.equity.priceHist.shift();
};

S.milestones = (val, share) => {
  const ms = G.milestones;
  const hit = (k, text) => { if (!ms[k]) { ms[k] = G.t; S.news('🏆 Milestone: ' + text, 'big'); G.invConf = Math.min(100, G.invConf + 2); } };
  if (G.unitsTotal >= 1e4) hit('u10k', '10,000 phones sold!');
  if (G.unitsTotal >= 1e6) hit('u1m', 'ONE MILLION phones sold!');
  if (G.unitsTotal >= 1e8) hit('u100m', '100 million phones sold!');
  if (val >= 1e8) hit('v100m', G.co.name + ' is worth $100 million.');
  if (val >= 1e9) hit('v1b', 'UNICORN — $1 billion valuation!');
  if (val >= 1e11) hit('v100b', '$100 billion company.');
  if (val >= 1e12) hit('v1t', 'TRILLION-DOLLAR COMPANY. You built a legend.');
  if (share >= 0.01) hit('s1', '1% global smartphone market share.');
  if (share >= 0.1) hit('s10', '10% global market share — a top-tier brand.');
  const leader = U.maxBy(G.rivals.filter((r) => r.alive), (r) => r.share);
  if (leader && share > leader.share && share > 0.05) hit('top1', G.co.name + ' is the #1 smartphone maker in the world!');
};

/* ---------------- world events ---------------- */
S.worldEvents = () => {
  const W = G.world, fy = S.fy();
  ['shortage', 'ramSpike', 'recession', 'tariff'].forEach((k) => { if (W[k] > 0) W[k]--; });
  if (!G.flags.covid && fy >= 2020.17) { G.flags.covid = 1; W.recession = 6; S.news('🦠 A global pandemic shuts down stores worldwide. Smartphone demand collapses for months.', 'big'); }
  if (!G.flags.shortage21 && fy >= 2021) { G.flags.shortage21 = 1; W.shortage = 14; S.news('⚠️ The Great Chip Shortage: component costs surge across the industry.', 'big'); }
  if (!G.flags.tariff18 && fy >= 2018.5) { G.flags.tariff18 = 1; W.tariff = 18; S.news('🧾 Trade war: new tariffs on electronics between the US and China.', 'industry'); }
  if (U.chance(0.006)) { W.shortage = U.ri(4, 9); S.news('⚠️ Factory fire at a major supplier — component prices spike.', 'industry'); }
  if (U.chance(0.004) && fy > 2011) { W.recession = U.ri(4, 8); S.news('📉 Economic downturn: consumers delay phone upgrades.', 'industry'); }
  // company events
  const sold6 = U.sum(G.hist.slice(-6), (h) => h.units);
  if (sold6 > 2000 && U.chance(0.012 * (1 + U.avg(G.phones.filter((p) => p.status === 'onsale'), (p) => p.defectRate || 0.04) * 15))) S.queue({ kind: 'battery' });
  if (S.annualRevenue() > 2e7 * S.infl() && U.chance(0.012 * (1 + Math.max(0, 150 - G.patents) / 100))) S.queue({ kind: 'lawsuit' });
  if (S.headcount('hw') + S.headcount('sil') + S.headcount('sw') > 6 && U.chance(0.02)) S.queue({ kind: 'poach' });
  if (U.chance(0.02) && G.t > 6) S.queue({ kind: 'bulk' });
  if (U.chance(0.012) && G.t > 3) S.queue({ kind: 'grant' });
  if (G.phones.some((p) => p.status === 'onsale' && p.benchBoost) && U.chance(0.05)) S.queue({ kind: 'benchcaught' });
  if (G.phones.some((p) => p.status === 'onsale') && G.rep > 25 && U.chance(0.015)) S.queue({ kind: 'carrierdeal' });
};
S.EVENTS = {
  insolvent: () => ({ title: '🚨 Insolvency warning', text: 'You are out of cash and the banks won\'t extend more credit. If cash is still negative at the end of next month, ' + G.co.name + ' goes bankrupt. Cut costs, sell assets, raise money — now.', choices: [{ label: 'Understood', fn: () => {} }] }),
  battery: () => {
    const p = U.pick(G.phones.filter((x) => x.status === 'onsale')) || G.phones[0];
    const cost = Math.round(Math.max(20000, p.sold * 0.25 * 30 * S.infl()));
    return { title: '🔥 Battery swelling reports', text: 'Owners of the <b>' + U.esc(p.name) + '</b> post photos of swollen batteries. Your defect rate is ' + U.pct(p.defectRate || 0.05) + '. A voluntary recall would cost ~' + U.money(cost) + '.', choices: [
      { label: 'Recall & replace (' + U.money(cost) + ')', fn: () => { S.spend(cost, 'warranty'); G.rep = Math.max(0, G.rep - 2); S.news('🔁 ' + G.co.name + ' recalls ' + U.esc(p.name) + ' batteries. Customers appreciate the honesty.', 'info'); } },
      { label: 'Deny everything', fn: () => { if (U.chance(0.6)) { G.rep = Math.max(0, G.rep - 12); p.hype = 0; G.invConf -= 8; S.news('📰 SCANDAL: leaked memos show ' + G.co.name + ' knew about the battery defect. #BatteryGate trends worldwide.', 'bad'); } else S.news('🤐 The battery story fades away... this time.', 'info'); } },
    ] };
  },
  lawsuit: () => {
    const ar = S.annualRevenue(); const settle = Math.round(ar * U.rf(0.01, 0.03));
    const win = U.clamp(G.patents / (G.patents + 150) + 0.2, 0.2, 0.85);
    return { title: '⚖️ Patent lawsuit', text: 'A patent holding company claims your phones infringe 14 patents. Settle for ' + U.money(settle) + ', or fight in court (your ' + G.patents + ' patents give you a ' + U.pct(win, 0) + ' chance).', choices: [
      { label: 'Settle (' + U.money(settle) + ')', fn: () => S.spend(settle, 'other') },
      { label: 'Fight in court', fn: () => { S.spend(settle * 0.25, 'other'); if (U.chance(win)) { S.news('⚖️ Court rules in favour of ' + G.co.name + '! Patent claims dismissed.', 'good'); G.invConf += 3; } else { S.spend(settle * 2, 'other'); G.rep = Math.max(0, G.rep - 3); S.news('⚖️ ' + G.co.name + ' loses patent case, pays ' + U.money(settle * 2) + '.', 'bad'); } } },
    ] };
  },
  poach: () => {
    const f = U.pick(['hw', 'sil', 'sw'].filter((x) => S.headcount(x) > 0));
    const tier = ['principal', 'senior', 'mid'].find((t) => G.staff[f][t] > 0) || 'junior';
    const rival = U.pick(G.rivals.filter((r) => r.alive)); const cost = S.salaryOf(tier) * 6;
    return { title: '🎯 Talent poaching', text: S.rivalDef(rival.id).name + ' is trying to hire one of your ' + tier + ' ' + D.FIELDS[f].name.toLowerCase() + ' engineers.', choices: [
      { label: 'Counter-offer (' + U.money(cost) + ')', fn: () => { S.spend(cost, 'salaries'); G.morale = Math.min(100, G.morale + 2); } },
      { label: 'Let them go', fn: () => { G.staff[f][tier] = Math.max(0, G.staff[f][tier] - 1); G.morale -= 3; } },
    ] };
  },
  bulk: () => {
    const cost = Math.round(Math.max(15000 * S.infl(), U.avg(G.hist.slice(-3), (h) => h.ledger.cost.bom) * 1.2));
    return { title: '📦 Supplier bulk deal', text: 'A component distributor offers 5% off all components for 12 months for a ' + U.money(cost) + ' prepayment.', choices: [
      { label: 'Take the deal', fn: () => { if (G.cash < cost) return; S.spend(cost, 'other'); G.flags.bulkDeal = G.t + 12; S.news('📦 Bulk component deal signed: −5% BOM for 12 months.', 'good'); } },
      { label: 'Decline', fn: () => {} },
    ] };
  },
  grant: () => {
    const amt = Math.round(U.rf(30000, 200000) * S.infl() * (1 + G.rep / 50));
    return { title: '🏛️ Government innovation grant', text: 'The ' + S.country().name + ' innovation agency offers a ' + U.money(amt) + ' R&D grant — if you commit to keeping engineering jobs local.', choices: [
      { label: 'Accept', fn: () => { S.earn(amt, 'other'); G.flags.noLayoffs = G.t + 12; } }, { label: 'Decline', fn: () => {} },
    ] };
  },
  benchcaught: () => ({ title: '🕵️ Benchmark cheating exposed', text: 'Reviewers discovered your phones detect benchmark apps and boost clocks. The tech press is furious.', choices: [
    { label: 'Apologise & disable it', fn: () => { G.phones.forEach((p) => { p.benchBoost = false; p._v++; }); G.rep = Math.max(0, G.rep - 6); S.news('🙇 ' + G.co.name + ' apologises for benchmark manipulation.', 'bad'); } },
    { label: '"Everyone does it"', fn: () => { G.rep = Math.max(0, G.rep - 11); G.invConf -= 5; S.news('📰 #BenchGate: ' + G.co.name + ' refuses to apologise. Reviewers vow to test every phone with renamed benchmarks.', 'bad'); } },
  ] }),
  carrierdeal: () => {
    const p = U.maxBy(G.phones.filter((x) => x.status === 'onsale'), (x) => x.hype + S.stats(x).qual.q);
    const units = Math.round(U.rf(0.5, 2.5) * Math.max(1000, (p.salesHist.slice(-1)[0] || {}).units || 1000));
    const price = p.price * 0.72;
    return { title: '📶 Carrier bulk order', text: 'A carrier wants ' + U.num(units) + ' units of <b>' + U.esc(p.name) + '</b> at ' + U.money(price) + ' each, delivered from inventory now (you have ' + U.num(G.inventory[p.id] || 0) + ').', choices: [
      { label: 'Accept', fn: () => { const u = Math.min(units, G.inventory[p.id] || 0); G.inventory[p.id] -= u; S.earn(u * price, 'phones'); p.sold += u; G.unitsTotal += u; G.regions[G.co.market].aware = Math.min(0.98, G.regions[G.co.market].aware + 0.02); S.news('📶 Carrier order delivered: ' + U.num(u) + ' × ' + U.esc(p.name) + '.', 'good'); } },
      { label: 'Decline', fn: () => {} },
    ] };
  },
};

/* ---------------- saves ---------------- */
S.SLOTS = ['auto', 'slot1', 'slot2', 'slot3'];
S.serialize = () => JSON.stringify(G, (k, v) => (k === '_c' || k === '_q' || k === '_qt' ? undefined : v));
S.save = (slot = 'auto') => U.store.set('mpf_' + slot, S.serialize()) && U.store.set('mpf_meta_' + slot, JSON.stringify({ name: G.co.name, date: U.dateStr(G.t), val: S.companyValue(), saved: Date.now() }));
S.load = (slot = 'auto') => { const s = U.store.get('mpf_' + slot); if (!s) return false; G = JSON.parse(s); S.migrate(); return true; };
S.loadFromString = (s) => { G = JSON.parse(s); S.migrate(); };
S.meta = (slot) => { try { return JSON.parse(U.store.get('mpf_meta_' + slot)); } catch (e) { return null; } };
S.migrate = () => {
  G.pending = G.pending || []; G.flags = G.flags || {}; G.milestones = G.milestones || {};
  G.phones.forEach((p) => { p._v = p._v || 1; p.claims = p.claims || {}; p.eventIds = p.eventIds || []; });
};

/* ---------------- design templates for the player ---------------- */
S.availableSoCs = () => M.socMarket(S.fy()).slice().sort((a, b) => M.socPrice(a, S.fy()) - M.socPrice(b, S.fy()));
S.template = (kind = 'mid', chip = null) => {
  const fy = S.fy(), has = S.has, ctx = { fy, has };
  const tier = { budget: 'budget', mid: 'mid', rugged: 'budget', gaming: 'premium', camera: 'mid', flagship: 'flagship', premium: 'premium' }[kind] || 'mid';
  const ti = M.TI[tier];
  const socs = S.availableSoCs();
  if (!chip) {
    const pool = socs.filter((c) => c.tier === tier);
    const val = (c) => { const cs = M.chipStats(c, fy); return Math.pow(cs.single, 0.5) * Math.pow(cs.gflops, 0.3) / Math.pow(M.socPrice(c, fy), 0.55); };
    chip = (kind === 'gaming' ? U.maxBy(socs.filter((c) => c.tier !== 'flagship'), (c) => M.chipStats(c, fy).gflops) : U.maxBy(pool, val)) || socs[0];
  }
  const okR = D.ram.filter((r) => M.okRam(ctx, r) && chip.memTypes.includes(r.id));
  const ramT = U.maxBy(okR.filter((r) => r.lp), (r) => r.year) || okR[okR.length - 1] || D.ramT(chip.memTypes[0]);
  const ramGB = Math.min(ramT.maxGB, M.snap(D.ramSizes, M.ramNeed(fy) * [0.5, 0.75, 1, 1.25][ti] * (kind === 'gaming' ? 1.4 : 1)));
  const stoT = M.newest(D.storage, (x) => M.okSto(ctx, x)) || D.storage[0];
  const dispT = M.newest(D.dispTypes, (x) => M.okDisp(ctx, x)) || D.dispTypes[0];
  const dType = ti === 0 && dispT.id !== 'tn' ? (D.dispTypes.find((d) => d.id === 'ips' && M.okDisp(ctx, d)) || D.dispTypes[0]) : dispT;
  const resL = D.resolutions.filter((x) => M.ok(ctx, x));
  const res = resL[Math.max(0, resL.length - 1 - (ti === 0 ? 1 : 0))];
  const hzL = D.refresh.filter((x) => M.ok(ctx, x));
  const bezL = D.bezels.filter((x) => M.ok(ctx, x));
  const chem = M.newest(D.batChem, (x) => M.ok(ctx, x));
  const chL = D.charging.filter((x) => M.ok(ctx, x));
  const isp = D.ispGens[chip.ispGen - 1];
  const mpL = D.camMP.filter((x) => M.ok(ctx, x) && x.mp <= isp.maxMP);
  const senL = D.sensors.filter((x) => M.ok(ctx, x));
  const matL = D.materials.filter((x) => M.ok(ctx, x));
  const extras = [];
  if (ti >= 1 && has('cam_dual')) extras.push('ultra');
  if ((ti >= 2 || kind === 'camera') && has('cam_tele')) extras.push('tele');
  if (kind === 'camera' && has('cam_peri')) extras.push('peri');
  const coolL = D.cooling.filter((x) => M.ok(ctx, x) && (x.id !== 'fan' || kind === 'gaming'));
  const modem = chip.modemGen ? 0 : (M.newest(D.modems, (m) => m.g && m.year <= fy) || D.modems[1]).g;
  const d = {
    form: kind === 'rugged' ? 'rugged' : 'bar', modem,
    ram: { type: ramT.id, gb: ramGB, bus: Math.min(chip.memBus, ti >= 2 ? 64 : 32) }, sto: { type: stoT.id, gb: M.snap(D.stoSizes, M.stoNeed(fy) * [0.25, 0.5, 1, 1.6][ti]) },
    disp: { type: dType.id, size: +(M.idealSize(fy) * (kind === 'gaming' ? 1.05 : 1)).toFixed(1), res: res.id, hz: (kind === 'gaming' ? hzL[hzL.length - 1] : hzL[Math.max(0, hzL.length - 1 - (ti < 2 ? 1 : 0))]).hz, bezel: bezL[bezL.length - 1].id },
    bat: { chem: chem.id, mah: Math.round((1300 + 230 * (fy - 2010)) * (kind === 'rugged' ? 1.5 : kind === 'gaming' ? 1.2 : 1) / 50) * 50, charge: chL[chL.length - 1].w, wless: ti >= 2 ? (M.newest(D.wireless, (w) => M.ok(ctx, w)) || D.wireless[0]).id : 'none' },
    cam: { mp: mpL[mpL.length - 1].mp, sensor: senL[Math.max(0, senL.length - 1 - (ti === 0 ? 1 : 0))].id, ois: has('cam_ois') && ti >= 1, extras, front: (M.newest(D.frontMP, (f) => f.year <= fy) || D.frontMP[1]).mp },
    body: { mat: matL[Math.min(matL.length - 1, ti)].id, ip: kind === 'rugged' ? (has('ip68') ? 'ip68' : has('ip67') ? 'ip67' : 'none') : ti >= 2 ? (M.newest(D.ipRatings, (x) => M.ok(ctx, x)) || D.ipRatings[0]).id : 'none', bio: (M.newest(D.biometrics, (x) => M.ok(ctx, x)) || D.biometrics[0]).id, cooling: coolL[coolL.length - 1].id, jack: true, sd: ti <= 1, stereo: has('stereo') && (ti >= 2 || kind === 'gaming') },
    os: 'open', benchBoost: false,
  };
  const st = M.phoneStats({ ...d, chip, chipSource: 'market' }, fy, S.ctx());
  d.price = Math.max(79, Math.round(st.bom * (kind === 'budget' ? 1.7 : 1.9) / 10) * 10 - 1);
  return { design: d, chip };
};
