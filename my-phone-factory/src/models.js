/* =========================================================
   ENGINEERING & PHYSICS MODELS
   Everything the market, reviewers and live demos see comes
   from these functions — there are no scripted outcomes.
   ========================================================= */
const M = {};
M.TIERS = ['budget', 'mid', 'premium', 'flagship'];
M.TI = { budget: 0, mid: 1, premium: 2, flagship: 3 };

M.interp = (table, x) => { // table: [[x,y],...] sorted
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) if (x <= table[i][0]) { const [x0, y0] = table[i - 1], [x1, y1] = table[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return table[table.length - 1][1];
};
M.ramNeed = (fy) => M.interp([[2010, 0.25], [2011, 0.5], [2012, 1], [2013, 1.5], [2014, 2], [2015, 3], [2017, 4], [2019, 6], [2021, 8], [2024, 12], [2027, 16], [2030, 24], [2034, 32]], fy);
M.stoNeed = (fy) => 16 * Math.pow(1.3, fy - 2010);
M.idealSize = (fy) => Math.min(6.5, 3.6 + 0.26 * (fy - 2010));
M.idealThick = (fy) => Math.max(7.4, 10.5 - 0.22 * (fy - 2010));
M.snap = (arr, v) => arr.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), arr[0]);
M.newest = (arr, ok) => { let best = null; for (const x of arr) if (ok(x)) best = x; return best; };

/* ---------- semiconductor physics ---------- */
M.waferPrice = (node, fy, foundry) => {
  const age = Math.max(0, fy - node.year);
  return node.wafer * (foundry ? foundry.price : 1) * Math.max(0.45, 1 - 0.07 * age) * (1 + 0.5 * Math.exp(-age / 0.7));
};
M.D0 = (node, fy) => 0.07 + 0.45 * Math.exp(-Math.max(0, fy - node.year) / 1.4);
M.maskCost = (node, fy) => node.mask * Math.max(0.4, 1 - 0.08 * Math.max(0, fy - node.year));
M.dpw = (a) => Math.max(1, Math.floor(Math.PI * 150 * 150 / a - Math.PI * 300 / Math.sqrt(2 * a)));
M.nodeIdx = (id) => D.nodes.findIndex((n) => n.id === id);
M.foundryNodes = (fy, foundry) => D.nodes.filter((n) => fy >= n.year + foundry.lead);

/* chip: {node, foundry, cpuGen, cpuCustom, big, bigClk, little, littleClk, l2, l3, gpuGen, gpuCustom, gpuCores, gpuClk,
          npuGen, npuUnits, ispGen, modemGen, memTypes:[], memBus}
   opts: {dvfs, sram, chiplet, ipreuse, ownFab:{extraD0}} */
M.chipStats = (c, fy, opts = {}) => {
  const node = D.node(c.node), cg = D.cpuGens[c.cpuGen - 1], gg = D.gpuGens[c.gpuGen - 1];
  const ng = D.npuGens[c.npuGen || 0], ig = D.ispGens[c.ispGen - 1], mg = D.modems[c.modemGen || 0];
  const foundry = D.foundries.find((f) => f.id === (c.foundry || 'formosa')) || D.foundries[0];
  const cacheMul = 1 + 0.04 * U.log2(1 + c.l2 * 4 / Math.max(1, c.big)) + 0.03 * U.log2(1 + c.l3);
  const ipc = cg.ipc * (c.cpuCustom ? 1.1 : 1) * cacheMul;
  const lipc = cg.ipc * 0.45 * cacheMul;
  const single = 300 * ipc * c.bigClk;
  const nC = c.big + c.little;
  const multi = 300 * (c.big * ipc * c.bigClk + c.little * lipc * c.littleClk) * Math.max(0.7, 1 - 0.025 * (nC - 1));
  const dv = opts.dvfs ? 0.92 : 1;
  const pBig = cg.P * (c.cpuCustom ? 0.9 : 1) * node.E * c.bigClk * Math.pow(c.bigClk / node.fNom, 1.6) * dv;
  const pLit = c.little ? cg.P * 0.14 * node.E * c.littleClk * Math.pow(c.littleClk / node.fNom, 1.6) * dv : 0;
  const cpuPeak = c.big * pBig + c.little * pLit;
  const gNom = 0.33 * node.fNom;
  const gflops = c.gpuCores * gg.fl * (c.gpuCustom ? 1.12 : 1) * c.gpuClk;
  const gpuPeak = gg.P / (c.gpuCustom ? 1.12 : 1) * node.E * c.gpuCores * c.gpuClk * Math.pow(c.gpuClk / gNom, 1.6) * dv;
  const tops = (ng.tops || 0) * (c.npuUnits || 0);
  const npuPeak = tops * 0.12 * node.E / 0.43;
  const sramF = opts.sram ? 0.8 : 1;
  let T = c.big * cg.T * (c.cpuCustom ? 1.15 : 1) + c.little * cg.T * 0.22 + (c.l2 + c.l3) * 50 * sramF + c.gpuCores * gg.T + (c.npuUnits || 0) * (ng.T || 0) + ig.T + (c.modemGen ? mg.T : 0) + 60 + 15 * c.cpuGen;
  T *= 1.1 + 0.13 * (c.cpuGen - 1);
  const area = T / node.dens;
  const D0 = M.D0(node, fy) + (opts.extraD0 || 0);
  const ocLoss = Math.max(0, c.bigClk / (node.fNom) - 1) * 1.6 + Math.max(0, c.gpuClk / (gNom * 1.15) - 1) * 1.2;
  const yld = Math.max(0.05, Math.exp(-(area / 100) * (opts.chiplet ? 0.6 : 1) * D0) * (1 - Math.min(0.6, ocLoss)));
  const dpw = M.dpw(area);
  const wafer = M.waferPrice(node, fy, foundry) * (opts.ownFab ? 0.38 : 1);
  const dieCost = wafer / (dpw * yld);
  let royalty = 0;
  if (!c.cpuCustom) royalty += 0.4 + dieCost * 0.02;
  if (!c.gpuCustom) royalty += 0.25;
  const unitCost = dieCost + 1.5 + area * 0.015 + royalty;
  const nodeComplex = 1 + M.nodeIdx(c.node) * 0.45;
  const designRP = Math.round((300 + T * 0.35 * nodeComplex) * (opts.ipreuse ? 0.75 : 1));
  return {
    node, cg, gg, ng, ig, mg, ipc, single, multi, cpuPeak, pBig, pLit, gflops, gpuPeak, tops, npuPeak,
    transistors: T * 1e6, area, D0, yield: yld, dpw, wafer, dieCost, unitCost, royalty, designRP,
    mask: M.maskCost(node, fy), maxBig: node.fNom * 1.15, maxLit: node.fNom * 0.8, maxGpu: gNom * 1.3, gNom,
    rt: !!gg.rt, nC,
  };
};

/* ---------- merchant SoC market ---------- */
M.vendors = [
  { id: 'quantic', name: 'Quantic', code: 'Q', tiers: ['budget', 'mid', 'premium', 'flagship'], q: 1.0, mk: 1.0 },
  { id: 'mediacore', name: 'MediaCore', code: 'Helio', tiers: ['budget', 'mid', 'premium', 'flagship'], q: 0.95, mk: 0.85 },
  { id: 'exyra', name: 'Exyra', code: 'X', tiers: ['mid', 'premium', 'flagship'], q: 0.97, mk: 0.95 },
  { id: 'unicell', name: 'Unicell', code: 'UC', tiers: ['budget', 'mid'], q: 0.86, mk: 0.75 },
];
M.genSoC = (y, tier, vq = 1, vendor = null) => {
  const ti = M.TI[tier];
  const ay = y - [2.6, 1.6, 0.8, 0][ti] - (1 - vq) * 8;
  const node = M.newest(D.nodes, (n) => n.year <= ay) || D.nodes[0];
  const cg = M.newest(D.cpuGens, (g) => g.year + 0.4 <= ay) || D.cpuGens[0];
  const gg = M.newest(D.gpuGens, (g) => g.year + 0.3 <= ay) || D.gpuGens[0];
  const ng = (ti >= 2 || ay >= 2020) ? (M.newest(D.npuGens, (g) => g.g && g.year <= ay) || D.npuGens[0]) : D.npuGens[0];
  const ig = M.newest(D.ispGens, (g) => g.year <= ay) || D.ispGens[0];
  const mg = M.newest(D.modems, (g) => g.g && g.year <= ay - 0.3) || D.modems[1];
  const g = cg.g;
  const big = g === 1 ? [1, 2, 2, 2][ti] : g === 2 ? [2, 2, 4, 4][ti] : g >= 7 ? [2, 3, 4, 6][ti] : [2, 4, 4, 4][ti];
  const little = g >= 3 ? (g >= 7 && ti === 3 ? 2 : [4, 4, 4, 4][ti]) : 0;
  const bigClk = +(node.fNom * [0.8, 0.88, 0.94, 1.02][ti] * (0.94 + 0.06 * vq)).toFixed(2);
  const gNom = 0.33 * node.fNom;
  const gpuCores = Math.round([2, 4, 6, 8][ti] * (g >= 5 ? 1.3 : 1) * (g >= 8 ? 1.25 : 1));
  const rams = D.ram.filter((r) => r.year <= Math.max(2008, ay + 0.4)).slice(-3).map((r) => r.id);
  const c = {
    node: node.id, foundry: 'formosa', cpuGen: g, cpuCustom: false, big, bigClk, little, littleClk: +(node.fNom * 0.65).toFixed(2),
    l2: +(0.25 * big * Math.pow(2, (g - 1) / 3)).toFixed(2), l3: g >= 4 ? +([0, 1, 2, 4][ti] * (1 + (g - 4) * 0.6)).toFixed(1) : 0,
    gpuGen: gg.g, gpuCustom: false, gpuCores, gpuClk: +(gNom * [0.75, 0.85, 0.95, 1.0][ti]).toFixed(2),
    npuGen: ng.g, npuUnits: ng.g ? [1, 1, 2, 4][ti] : 0, ispGen: ig.g, modemGen: mg.g, memTypes: rams, memBus: [32, 32, 64, 64][ti],
  };
  const st = M.chipStats(c, Math.max(y, node.year + 0.3));
  const markup = [1.5, 1.8, 2.1, 2.4][ti] * (vendor ? vendor.mk : 1);
  c.price = Math.max(4, +(st.unitCost * markup + [1, 3, 6, 10][ti] * Math.pow(1.06, y - 2010)).toFixed(2));
  c.tier = tier;
  return c;
};
M._socCache = {};
M.socMarket = (fy) => {
  const y = Math.floor(fy), out = [];
  for (let yy = y - 3; yy <= y; yy++) {
    if (yy < 2009) continue;
    if (!M._socCache[yy]) {
      const list = [];
      M.vendors.forEach((v, vi) => v.tiers.forEach((tier, ti) => {
        if (v.id === 'mediacore' && tier === 'flagship' && yy < 2019) return;
        const c = M.genSoC(yy + 0.05, tier, v.q, v);
        const num = { budget: 2, mid: 5, premium: 7, flagship: 9 }[tier];
        c.id = 'soc_' + v.id + '_' + yy + '_' + tier;
        c.name = v.name + ' ' + v.code + num + (v.id === 'quantic' ? ' Gen ' + (yy - 2008) : '-' + yy);
        c.vendor = v.name; c.rel = yy + 0.04 + vi * 0.03 + ti * 0.05;
        list.push(c);
      }));
      M._socCache[yy] = list;
    }
    M._socCache[yy].forEach((c) => { if (c.rel <= fy) out.push(c); });
  }
  return out;
};
M.socPrice = (c, fy) => c.price * Math.max(0.45, 1 - 0.13 * Math.max(0, fy - c.rel));

/* ---------- component costs (USD) ---------- */
M.ramPerGB = (type, fy) => { const t = D.ramT(type); const base = Math.max(0.32, 18 * Math.pow(0.8, fy - 2010)); return base * (1 + 0.8 * Math.exp(-Math.max(0, fy - t.year) / 1.2)) * (1 + 0.08 * Math.max(0, fy - t.year - 6)) * (t.lp ? 1 : 0.72); };
M.stoPerGB = (type, fy) => { const t = D.stoT(type); return Math.max(0.025, 1.8 * Math.pow(0.74, fy - 2010)) * t.prem * (1 + 0.5 * Math.exp(-Math.max(0, fy - t.year))); };
M.dispPerIn2 = (type, fy) => { const t = D.dispT(type); const age = Math.max(0, fy - Math.max(2010, t.year)); return t.cost * Math.max(0.2, Math.pow(0.85, age)) * (1 + 0.6 * Math.exp(-Math.max(0, fy - t.year))); };
M.whCost = (chem, fy) => Math.max(0.18, 0.9 * Math.pow(0.92, fy - 2010)) * D.batT(chem).prem;

/* ---------- availability (player or rival context) ----------
   ctx = { fy, has(techId) } */
M.ok = (ctx, item) => (!item.tech || ctx.has(item.tech)) && (!item.year || item.year <= ctx.fy + 0.01);
M.okRam = (ctx, r) => r.year <= ctx.fy + 0.01 && (!r.tech || ctx.has(r.tech));
M.okSto = (ctx, s) => s.year <= ctx.fy + 0.01 && (!s.tech || ctx.has(s.tech));
M.okDisp = (ctx, d) => d.year <= ctx.fy + 0.01 && (!d.tech || ctx.has(d.tech));

/* ---------- PHONE STATS ----------
   p: design. ctx: {fy, has, sw (software override), ecosystem} */
M.phoneStats = (p, fy, ctx) => {
  const has = ctx.has;
  const c = p.chip, cs = M.chipStats(c, Math.max(fy, c.rel || fy), ctx.chipOpts || {});
  const disp = D.dispT(p.disp.type), res = D.resT(p.disp.res), bez = D.bezelT(p.disp.bezel);
  const mat = D.matT(p.body.mat), chem = D.batT(p.bat.chem), sensor = D.sensorT(p.cam.sensor);
  const ram = D.ramT(p.ram.type), sto = D.stoT(p.sto.type), cool = D.cooling.find((x) => x.id === p.body.cooling) || D.cooling[0];
  const fold = p.form === 'fold', rugged = p.form === 'rugged';
  const yr = fy;
  // --- geometry
  let aspect = bez.aspect;
  if (p.disp.bezel === 'b169') aspect = res.id === 'hvga' ? 1.5 : res.id === 'wvga' ? 5 / 3 : 16 / 9;
  if (fold) aspect = 1.15;
  const d = p.disp.size;
  const sw_in = d / Math.sqrt(1 + aspect * aspect), sh_in = sw_in * aspect;
  const area_in2 = sw_in * sh_in;
  const side = { b169: 4.5, b189: 3, notch: 2.2, punch: 1.8, udc: 1.5, true: 1.0 }[bez.id] + (rugged ? 3 : 0);
  const stb = bez.id === 'b169' ? Math.min(0.72, 0.56 + 0.022 * Math.max(0, yr - 2010)) : bez.stb;
  let bodyW = sw_in * 25.4 + 2 * side, bodyH = (sw_in * 25.4 * sh_in * 25.4 / (stb - (rugged ? 0.08 : 0))) / bodyW;
  if (fold) { bodyW = sw_in * 25.4 / 2 + 4; bodyH = sh_in * 25.4 + 10; }
  const wh = p.bat.mah * 3.85 / 1000;
  const batVol = wh / chem.whl * 1e6; // mm3
  const foot = bodyW * bodyH * 0.55 * (fold ? 2 : 1);
  const batT = batVol / foot;
  let thick = Math.max(3.4, 5.2 - 0.08 * (yr - 2010)) + batT;
  if (fold) thick = thick * 1.9 + 0.8;
  if (rugged) thick += 4.2;
  if (p.body.cooling === 'fan') thick += 1.6;
  if (p.body.jack && thick < 7) thick += 0.35;
  const bump = 0.3 + sensor.area / 40 + (p.cam.extras.includes('peri') ? 0.6 : 0);
  const vol = bodyW * bodyH * thick / 1000;
  const weight = 15 + vol * 1.85 * mat.wt * (rugged ? 1.28 : 1) * (fold ? 1.05 : 1) + (p.body.cooling === 'fan' ? 9 : 0);
  // --- display
  const pxW = res.w, pxH = Math.round(res.w * aspect * (fold ? 0.95 : 1));
  const mp = pxW * pxH / 1e6;
  const ppi = Math.sqrt(pxW * pxW + pxH * pxH) / d;
  const nits = Math.min(disp.nits * 2, disp.nits * (1 + 0.04 * Math.max(0, yr - disp.year)));
  const sizeFit = Math.max(0.6, 1 - 0.13 * Math.abs((fold ? 6.4 : d) - M.idealSize(yr)));
  const dispAbs = 100 * disp.q * (0.6 + 0.4 * Math.min(1.2, ppi / 450)) * (1 + 0.18 * U.log2(p.disp.hz / 60)) * (0.9 + 0.1 * Math.min(1.5, nits / 1000)) * sizeFit * (fold ? 1.12 : 1);
  // --- memory
  const bus = Math.min(p.ram.bus, c.memBus);
  const bw = ram.mts * bus / 8 / 1000; // GB/s
  const memOK = c.memTypes.includes(p.ram.type);
  const ramScore = Math.min(1.35, Math.pow(p.ram.gb / M.ramNeed(yr), 0.5));
  // --- performance
  const bwReq = cs.gflops * 0.025 + cs.multi * 0.0004;
  const bwF = Math.min(1, Math.pow(bw / Math.max(0.1, bwReq), 0.5));
  const gpuEff = cs.gflops * bwF;
  const boost = p.benchBoost && has('benchboost') ? 1.15 : 1;
  const perfIdx = Math.pow(cs.single, 0.35) * Math.pow(cs.multi, 0.25) * Math.pow(Math.max(0.5, gpuEff), 0.4) * (0.75 + 0.25 * ramScore) * (memOK ? 1 : 0.6);
  const bench = {
    single: Math.round(cs.single * boost), multi: Math.round(cs.multi * boost), gpu: Math.round(gpuEff * 12 * boost),
    ai: Math.round(cs.tops * 110 * boost), mem: Math.round(bw * 1000), sto: sto.read,
  };
  bench.total = Math.round((bench.single * 40 + bench.multi * 12 + bench.gpu * 18 + bench.ai * 6 + bench.mem * 2 + bench.sto * 20) / 10);
  // --- thermal
  const surf = 2 * bodyW * bodyH / 100 * (fold ? 1.6 : 1);
  const dissip = 0.022 * surf * mat.cond * cool.k * (rugged && p.body.cooling !== 'fan' ? 0.85 : 1) * (1 + 0.02 * Math.max(0, thick - 8));
  const pDisplay = area_in2 * disp.pw * (1 + 0.25 * U.log2(p.disp.hz / 60)) * (p.disp.type === 'ltpo' || p.disp.type === 'micro' ? 0.8 : 1) * (1 + 0.08 * U.log2(Math.max(0.1, mp) / 0.4));
  const gamePower = 0.35 * cs.cpuPeak + cs.gpuPeak + pDisplay + 0.3;
  const sustained = Math.min(1, Math.pow(dissip / gamePower, 0.75)) * (has('gamemode') ? 1.04 : 1);
  // --- battery
  const modem = c.modemGen ? D.modems[c.modemGen] : D.modems[p.modem || 0];
  const integrated = !!c.modemGen;
  let socAvg = (0.1 + 0.035 * cs.cpuPeak + 0.02 * cs.gpuPeak) * (c.little ? 0.75 : 1);
  if (has('batt_opt')) socAvg *= 0.85;
  if (has('batt_opt2')) socAvg *= 0.85;
  const ramP = ram.pj * bw * 0.0008;
  const pAvg = pDisplay + socAvg + modem.P * (integrated ? 0.85 : 1) + 0.22 + ramP;
  const sot = wh / pAvg;
  const standby = wh / (0.03 + modem.P * 0.08) / 24;
  const chargeW = p.bat.charge;
  const chargeMin = wh / (chargeW * 0.85) * 60 * 1.25 + 8;
  const batIdx = sot * (1 + 0.06 * U.log2(chargeW / 5)) * (p.bat.wless !== 'none' ? 1.04 : 1);
  // --- camera
  const isp = cs.ig;
  const effMP = Math.min(p.cam.mp, isp.maxMP);
  const light = Math.pow(sensor.area / 15.5, 0.5);
  const detail = Math.pow(Math.min(1, effMP / 12), 0.35) * (effMP >= 48 ? 1.06 : 1);
  const npuF = 1 + Math.min(0.15, cs.tops / 300);
  const comp = (has('comp_photo') ? 1.1 : 1) * (has('ai_photo') && cs.tops >= 8 ? 1.1 : 1) * npuF;
  const camDay = 50 * isp.q * Math.pow(light, 0.6) * detail * comp;
  const camNight = 40 * isp.q * light * (p.cam.ois ? 1.25 : 1) * (has('night') ? 1.35 : 1) * comp;
  const vidF = 1 + 0.08 * (isp.g - 1);
  const camVideo = 45 * isp.q * (p.cam.ois ? 1.2 : 1) * Math.pow(light, 0.4) * vidF;
  const camZoom = 30 + (p.cam.extras.includes('tele') ? 25 : 0) + (p.cam.extras.includes('peri') ? 40 : 0) + Math.pow(effMP / 12, 0.3) * 10;
  const camSelfie = 20 + Math.sqrt(p.cam.front || 0) * 8;
  const versatility = (p.cam.extras.includes('ultra') ? 8 : 0) + (p.cam.extras.includes('macro') ? 0.5 : 0);
  const camScore = camDay * 0.35 + camNight * 0.25 + camVideo * 0.2 + camZoom * 0.1 + camSelfie * 0.1 + versatility;
  // --- build & design
  const thinFit = U.clamp(1 - (thick - M.idealThick(yr)) / 5, 0, 1.2);
  const wtFit = U.clamp(1 - (weight - (110 + area_in2 * 5)) / 120, 0, 1.15);
  const ipPts = { none: 0, ip67: 6, ip68: 9 }[p.body.ip] + (rugged ? 10 : 0);
  const durab = (has('glass2') ? 4 : 0) + (has('glass3') ? 4 : 0) + (rugged ? 12 : 0);
  const buildAbs = mat.prem * 45 + thinFit * 15 + wtFit * 8 + stb * 18 + ipPts + durab + (fold ? 14 : 0) - (rugged ? 10 : 0);
  // --- software
  let swAbs;
  if (ctx.sw != null) swAbs = ctx.sw;
  else {
    swAbs = p.os === 'own' ? 52 + (has('os_own2') ? 10 : 0) + (has('os_own3') ? 10 : 0) : 55;
    ['os_skin1', 'os_skin2', 'os_skin3'].forEach((t) => { if (has(t)) swAbs += 8; });
    if (has('os_updates')) swAbs += 6;
    if (has('stability')) swAbs += 3;
    if (has('stability2')) swAbs += 3;
  }
  // --- features
  let feat = 10 + { none: 0, fp: 8, ufp: 10, face: 12 }[p.body.bio] + (yr >= 2011 ? 3 : 0)
    + { none: 0, qi: 6, qi2: 8, rev: 10 }[p.bat.wless] + U.log2(chargeW / 5) * 4 + (p.body.stereo ? 4 : 0) + (has('haptics') ? 3 : 0)
    + (p.body.jack ? 3 : 0) + (p.body.sd ? 3 : 0) + (has('voice') ? 4 : 0) + (has('secure') ? 4 : 0) + (p.bat.wless === 'rev' ? 2 : 0);
  if (has('ai_assist') && cs.tops >= 10) feat += 15;
  else if (yr >= 2024) feat -= 6; // AI era: no assistant feels dated
  const connect = modem.g ? Math.log10(modem.mbps) * 25 : 0;
  // --- BOM
  const socCost = p.chipSource === 'own' ? (p.chipUnitCost || cs.unitCost) : M.socPrice(c, fy);
  const modemCost = integrated ? 0 : (modem.g ? modem.cost * Math.max(0.5, Math.pow(0.9, Math.max(0, fy - modem.year))) : 0);
  const ramCost = p.ram.gb * M.ramPerGB(p.ram.type, fy) + 1;
  const stoCost = p.sto.gb * M.stoPerGB(p.sto.type, fy) + 1;
  const resF = 1 + 0.08 * U.log2(mp / 0.15), hzF = Math.pow(p.disp.hz / 60, 0.25);
  const dispCost = area_in2 * M.dispPerIn2(p.disp.type, fy) * resF * hzF * (fold ? 2.4 : 1) + 3 + (fold ? 60 : 0) + (has('glass3') ? 3 : has('glass2') ? 1.5 : 0.5);
  const batCost = wh * M.whCost(p.bat.chem, fy) + 1 + chargeW * 0.05 + { none: 0, qi: 4, qi2: 6, rev: 8 }[p.bat.wless];
  const camDecl = Math.max(0.35, Math.pow(0.92, fy - 2010));
  let camCost = (sensor.area * 0.25 * (1 + p.cam.mp / 60) + 2) * camDecl + (p.cam.ois ? 3 : 0) + 0.5 + (p.cam.front || 0) * 0.15;
  p.cam.extras.forEach((e) => { const x = D.extraCams.find((q) => q.id === e); if (x) camCost += x.cost * camDecl * 1.4; });
  const bodyCost = mat.cost * Math.max(0.5, Math.pow(0.96, fy - 2010)) * (fold ? 1.6 : 1) + (rugged ? 8 : 0) + { graphite: 0.5, vc: 3, graphene: 5, fan: 7 }[cool.id]
    + { none: 0, fp: 3, ufp: 6, face: 12 }[p.body.bio] + (p.body.stereo ? 2 : 0.6) + (has('haptics') ? 1.5 : 0.5) + (p.body.jack ? 0.5 : 0) + (p.body.sd ? 0.4 : 0) + { none: 0, ip67: 2, ip68: 3 }[p.body.ip];
  const misc = 12 * (1 + 0.03 * (fy - 2010)) + 4 + (p.os === 'open' ? 1.5 : 0);
  const bomParts = { soc: socCost, modem: modemCost, ram: ramCost, storage: stoCost, display: dispCost, battery: batCost, camera: camCost, body: bodyCost, misc };
  const supply = ctx.supply || 1;
  Object.keys(bomParts).forEach((k) => (bomParts[k] *= supply));
  const bom = U.sum(Object.values(bomParts));
  // --- validation
  const issues = [];
  if (!memOK) issues.push('Chip memory controller does not support ' + ram.name + '.');
  if (p.ram.gb > ram.maxGB) issues.push(ram.name + ' tops out at ' + ram.maxGB + ' GB.');
  if (p.cam.mp > isp.maxMP) issues.push('The chip\'s ISP only supports ' + isp.maxMP + 'MP sensors.');
  if (!c.modemGen && !(p.modem > 0)) issues.push('No cellular modem! Add a discrete modem.');
  if (thick > 14 && !rugged) issues.push('Too thick to sell (' + thick.toFixed(1) + ' mm).');
  return {
    cs, bodyW, bodyH, thick, weight, bump, stb, aspect, sw_in, sh_in, area_in2, pxW, pxH, mp, ppi, nits,
    dispAbs, bw, ramScore, gpuEff, perfIdx, bench, dissip, gamePower, sustained, pDisplay, socAvg, pAvg, wh, sot, standby, chargeMin, batIdx,
    cam: { day: camDay, night: camNight, video: camVideo, zoom: camZoom, selfie: camSelfie, score: camScore, effMP, video_res: isp.video },
    buildAbs, swAbs, feat, connect, modem, integrated, bomParts, bom, issues, rt: cs.rt,
  };
};

/* ---------- quality vs. the market frontier ---------- */
M.W = { perf: 0.24, camera: 0.18, display: 0.15, battery: 0.15, build: 0.1, software: 0.1, features: 0.05, connect: 0.03 };
M.K = { perf: 0.33, camera: 0.42, display: 0.75, battery: 0.85, build: 0.85, software: 0.9, features: 0.6, connect: 0.25 };
M.subOf = (st) => ({ perf: st.perfIdx, camera: st.cam.score, display: st.dispAbs, battery: st.batIdx, build: Math.max(1, st.buildAbs), software: st.swAbs, features: st.feat, connect: Math.max(1, st.connect) });
M._refCache = {};
M.ref = (fy) => {
  const key = Math.floor(fy * 4) / 4;
  if (!M._refCache[key]) {
    const ctx = { fy: key, has: (id) => (D.tech[id] ? D.tech[id].year <= key : true), sw: 80 + Math.min(12, (key - 2010) * 0.6) };
    const p = M.genPhone(key, 'flagship', { tech: 1, focus: 'balanced' });
    const st = M.phoneStats(p, key, ctx);
    M._refCache[key] = M.subOf(st);
  }
  return M._refCache[key];
};
M.quality = (st, fy) => {
  const ref = M.ref(fy), sub = M.subOf(st), s = {};
  let q = 0;
  Object.keys(M.W).forEach((k) => { s[k] = U.clamp(1 + M.K[k] * U.log2(Math.max(1e-6, sub[k]) / ref[k]), 0, 1.3); q += M.W[k] * s[k]; });
  return { q: 100 * q, s };
};

/* ---------- product generator (rivals & the frontier reference) ---------- */
M.genPhone = (fy, tier, prof = {}) => {
  const ti = M.TI[tier];
  const tech = prof.tech ?? 1;
  const lag = [2.4, 1.5, 0.7, 0][ti] + (1 - tech) * 6;
  const ay = fy - lag;
  const ctx = { fy: ay, has: (id) => (D.tech[id] ? D.tech[id].year <= ay : true) };
  const chip = M.genSoC(Math.max(2009, fy - [1.2, 0.8, 0.5, 0.15][ti]), tier, tech);
  chip.rel = fy - 0.2;
  const ramT = M.newest(D.ram, (r) => r.lp && chip.memTypes.includes(r.id)) || D.ramT(chip.memTypes[0]);
  const ramGB = Math.min(ramT.maxGB, M.snap(D.ramSizes, M.ramNeed(ay) * [0.55, 0.8, 1, 1.25][ti] * (prof.focus === 'performance' ? 1.3 : 1)));
  const stoT = M.newest(D.storage, (s) => M.okSto(ctx, s)) || D.storage[0];
  const stoGB = M.snap(D.stoSizes, M.stoNeed(ay) * [0.25, 0.5, 1, 1.6][ti]);
  const dispT = M.newest(D.dispTypes, (d) => M.okDisp(ctx, d) && (ti >= 2 || d.id !== 'micro')) || D.dispTypes[0];
  const dType = ti === 0 && dispT.id !== 'tn' ? (M.newest(D.dispTypes.slice(0, D.dispTypes.indexOf(dispT)), (d) => M.okDisp(ctx, d)) || dispT) : dispT;
  const resList = D.resolutions.filter((r) => M.ok(ctx, r));
  const res = resList[Math.max(0, resList.length - 1 - [2, 1, 0, 0][ti])] || D.resolutions[0];
  const hzList = D.refresh.filter((r) => M.ok(ctx, r));
  const hz = hzList[Math.max(0, hzList.length - 1 - [2, 1, 1, 0][ti] + (prof.focus === 'performance' ? 1 : 0))] || hzList[0];
  const bezList = D.bezels.filter((b) => M.ok(ctx, b));
  const bez = bezList[Math.max(0, bezList.length - 1 - [1, 1, 0, 0][ti])] || D.bezels[0];
  const chem = M.newest(D.batChem, (b) => M.ok(ctx, b)) || D.batChem[0];
  const mah = Math.round((1300 + 230 * (ay - 2010)) * [1.0, 1.0, 1.0, 1.05][ti] * (prof.focus === 'battery' ? 1.22 : 1) / 50) * 50;
  const chList = D.charging.filter((x) => M.ok(ctx, x));
  const charge = chList[Math.max(0, chList.length - 1 - [2, 1, 0, 0][ti])].w;
  const wl = ti >= 2 ? (M.newest(D.wireless, (w) => M.ok(ctx, w)) || D.wireless[0]).id : 'none';
  const isp = D.ispGens[chip.ispGen - 1];
  const mpList = D.camMP.filter((x) => M.ok(ctx, x) && x.mp <= isp.maxMP);
  const mp = mpList[Math.max(0, mpList.length - 1 - [1, 1, 0, 0][ti])].mp;
  const senList = D.sensors.filter((x) => M.ok(ctx, x));
  const sensor = senList[Math.max(0, senList.length - 1 - [3, 2, 1, 0][ti] + (prof.focus === 'camera' ? 1 : 0))] || D.sensors[0];
  const extras = [];
  if (ti >= 1 && ctx.has('cam_dual')) extras.push('ultra');
  if (ti >= 2 && ctx.has('cam_tele')) extras.push('tele');
  if (ti >= 3 && ctx.has('cam_peri')) extras.push('peri');
  if (ti <= 1 && ay >= 2018) extras.push('macro');
  const front = (M.newest(D.frontMP, (f) => f.year <= ay - [2, 1, 0, 0][ti]) || D.frontMP[1]).mp;
  const matList = D.materials.filter((m) => M.ok(ctx, m));
  const mat = matList[Math.max(0, Math.min(matList.length - 1, [0, 1, 2, 4][ti]))] || D.materials[0];
  const ip = ti >= 2 ? (M.newest(D.ipRatings, (x) => M.ok(ctx, x)) || D.ipRatings[0]).id : 'none';
  const bios = D.biometrics.filter((x) => M.ok(ctx, x));
  const bio = ti === 0 ? (ay >= 2015 && ctx.has('bio_fp') ? 'fp' : 'none') : (bios[bios.length - 1] || D.biometrics[0]).id;
  const cools = D.cooling.filter((x) => M.ok(ctx, x) && x.id !== 'fan');
  const cooling = ti >= 2 ? cools[cools.length - 1].id : 'graphite';
  const modem = chip.modemGen ? 0 : (M.newest(D.modems, (m) => m.g && m.year <= ay) || D.modems[1]).g;
  return {
    form: 'bar', chip, chipSource: 'market', modem,
    ram: { type: ramT.id, gb: ramGB, bus: chip.memBus }, sto: { type: stoT.id, gb: stoGB },
    disp: { type: dType.id, size: +(M.idealSize(ay) * [0.95, 1.0, 1.02, 1.05][ti]).toFixed(1), res: res.id, hz: hz.hz, bezel: bez.id },
    bat: { chem: chem.id, mah, charge, wless: wl },
    cam: { mp, sensor: sensor.id, ois: ti >= 1 && ctx.has('cam_ois'), extras, front },
    body: { mat: mat.id, ip, bio, cooling, jack: ay < 2017 || ti === 0, sd: ti <= 1, stereo: ti >= 2 && ctx.has('stereo') },
    os: 'open', benchBoost: false,
  };
};

/* ---------- simulated tests (used by Test Lab, keynote & reviewers) ---------- */
// Thermal + FPS session. returns samples & summary. All physics, plus small frame-time jitter.
M.gameSession = (st, game, preset, opts = {}) => {
  const has = opts.has || (() => false);
  const minutes = opts.minutes || 20, dt = 5; // seconds per step
  const amb = opts.ambient ?? 25;
  const C = st.weight * 0.85; // J/°C
  const k = st.dissip / 20;
  const throttleAt = has('thermal') ? 42.5 : 45.5;
  const gmode = has('gamemode') ? 1.08 : 1;
  const pf = Math.pow(Math.min(st.mp, 2.4) / 0.92, 0.5);
  const load = game.load * preset.m * pf;
  const rtF = game.rt && !st.rt ? 0.35 : 1;
  const ramF = opts.ramGB < game.ram ? 0.72 : 1;
  const hzCap = Math.min(game.cap, opts.hz || 60);
  let T = amb + 6, th = 1, overheated = false, maxT = T;
  const samples = [];
  for (let t = 0; t <= minutes * 60; t += dt) {
    const fpsGPU = st.gpuEff * th / load * gmode * rtF;
    const fpsCPU = st.cs.single * Math.min(1, th * 1.1) / game.cpu * 60;
    let fps = Math.min(fpsGPU, fpsCPU, hzCap) * ramF;
    const util = Math.min(1, fps / Math.max(1, Math.min(fpsGPU, fpsCPU)) + 0.02);
    const P = (0.35 * st.cs.cpuPeak + st.cs.gpuPeak) * th * th * util + st.pDisplay + 0.3;
    T += (P - k * (T - amb)) * dt / C;
    if (T > throttleAt) th = Math.max(0.25, th - (has('thermal') ? 0.05 : 0.02) * (T - throttleAt));
    else if (T < throttleAt - 1.5) th = Math.min(1, th + 0.02);
    if (!has('thermal') && T > throttleAt + 1) T += 0.08; // late reaction overshoot
    maxT = Math.max(maxT, T);
    if (T >= 48.5) overheated = true;
    const jitter = 1 + (Math.sin(t * 1.7) * 0.02 + (Math.random() - 0.5) * 0.04) * (ramF < 1 ? 4 : 1);
    samples.push({ t, fps: Math.max(1, fps * jitter), T, th });
  }
  const fpsArr = samples.map((s) => s.fps).sort((a, b) => a - b);
  return {
    samples, avg: U.avg(samples, (s) => s.fps), low: fpsArr[Math.floor(fpsArr.length * 0.05)], peak: fpsArr[fpsArr.length - 1],
    maxT, overheated, stutter: ramF < 1, rtFallback: rtF < 1, first: samples[2].fps, last: samples[samples.length - 1].fps,
  };
};
M.batteryRun = (st) => {
  const curve = []; const h = st.sot;
  for (let i = 0; i <= 20; i++) curve.push({ h: h * i / 20, pct: 100 - i * 5 });
  return { sot: h, standby: st.standby, chargeMin: st.chargeMin, curve };
};
// Camera app crash risk for a live demo (0..1)
M.crashRisk = (p, st, has, rehearsal = 0) => {
  let r = 0.05 + (has('stability') ? 0 : 0.09) + (has('stability2') ? -0.03 : 0.02);
  if (p.cam.mp > st.cs.ig.maxMP * 0.8) r += 0.05;
  if (p.os === 'own' && !has('os_own2')) r += 0.07;
  if (p.chipSource === 'own') r += 0.03;
  r -= rehearsal * 0.012;
  return U.clamp(r, 0.01, 0.4);
};
