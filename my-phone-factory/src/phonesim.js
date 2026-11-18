/* =========================================================
   TEST LAB — fully interactive phone simulator
   ========================================================= */
const PS = { id: null, app: null, anim: null, game: null, preset: 'high', camMode: 'day' };
PS.phones = () => G.phones.filter((p) => S.resolveChip(p));
UI.A.labPhone = (el) => { PS.id = el.dataset.id; PS.app = null; UI.close(); UI.tab = 'design'; UI.sub.design = 'lab'; UI.draft = null; UI.chipDraft = null; UI.render(true); };
PS.page = () => {
  const ps = PS.phones();
  if (!ps.length) return '<div class="card empty"><div class="e">🧪</div>Design a phone first — then put it through benchmarks, games, camera and battery tests here.</div>';
  if (!ps.find((p) => p.id === PS.id)) PS.id = ps[ps.length - 1].id;
  const p = S.phoneById(PS.id), st = S.stats(p), d = S.designOf(p);
  const w = Math.min(300, window.innerWidth - 60);
  const scrW = w - 24, scrH = Math.round(scrW * Math.min(2.25, st.aspect));
  let s = '<div class="card"><div class="row"><select data-ch="psPick">' + H.opts(ps.map((x) => [x.id, x.name + ' (' + x.status + ')']), PS.id) + '</select></div><div class="tiny mute mt8">Everything here runs the same simulation reviewers, buyers and live keynote demos use. Prototypes can be tested before launch.</div></div>';
  s += '<div class="phoneWrap"><div class="phoneShell" style="width:' + w + 'px;background:linear-gradient(145deg,' + R.shade(p.color, 1.25) + ',' + R.shade(p.color, 0.45) + ')"><div class="phoneScreen" id="psScreen" style="height:' + scrH + 'px">' +
    '<div class="psStatus"><span>' + U.MONTHS[G.t % 12] + ' ' + (G.t % 28 + 1) + '</span><span>' + st.modem.name.replace('Gigabit ', '').split(' ')[0] + ' ▮▮▮ ' + Math.round(st.sot) + 'h</span></div><div id="psBody"></div></div></div></div>';
  UI.after.push(() => PS.show());
  return s;
};
UI.C.psPick = (el) => { PS.id = el.value; PS.app = null; PS.stop(); UI.render(); };
PS.stop = () => { if (PS.anim) cancelAnimationFrame(PS.anim); PS.anim = null; };
PS.APPS = [
  { id: 'bench', name: 'QuantaBench', i: '⚡', bg: 'linear-gradient(135deg,#ff6a3d,#ff2d7a)' },
  { id: 'game', name: 'Game Lab', i: '🎮', bg: 'linear-gradient(135deg,#6a5cff,#00c2ff)' },
  { id: 'camera', name: 'Camera', i: '📷', bg: 'linear-gradient(135deg,#2b2f3a,#565e70)' },
  { id: 'battery', name: 'Battery', i: '🔋', bg: 'linear-gradient(135deg,#1fbf75,#9be15d)' },
  { id: 'specs', name: 'About', i: 'ℹ️', bg: 'linear-gradient(135deg,#3a4a66,#1b2333)' },
  { id: 'store', name: 'App Store', i: '🛍️', bg: 'linear-gradient(135deg,#0fb5c9,#2f5bff)' },
  { id: 'msg', name: 'Messages', i: '💬', bg: 'linear-gradient(135deg,#3ddc84,#1aa35a)' },
  { id: 'web', name: 'Browser', i: '🌐', bg: 'linear-gradient(135deg,#ffb648,#ff6a00)' },
];
PS.show = () => {
  PS.stop();
  const body = $('#psBody'); if (!body) return;
  const p = S.phoneById(PS.id);
  const scr = $('#psScreen');
  scr.style.background = 'linear-gradient(160deg,' + R.shade(p.color, 0.9) + ' 0%, #1b1240 55%, #05070c 100%)';
  if (!PS.app) {
    body.innerHTML = '<div class="psHome">' + PS.APPS.map((a) => '<div class="psApp" data-a="psOpen" data-v="' + a.id + '"><div class="ai" style="background:' + a.bg + '">' + a.i + '</div>' + a.name + '</div>').join('') + '</div>';
    return;
  }
  body.innerHTML = '<div class="psView"><button class="back" data-a="psHome">‹ Home</button><div id="psApp"></div></div>';
  PS['app_' + PS.app]();
};
UI.A.psOpen = (el) => { PS.app = el.dataset.v; PS.show(); };
UI.A.psHome = () => { PS.app = null; PS.show(); };
PS.canvas = (id, h) => '<canvas id="' + id + '" style="width:100%;height:' + h + 'px;display:block;border-radius:10px;background:#0b1020"></canvas>';
PS.ctx = (id) => { const cv = $('#' + id); const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; const x = cv.getContext('2d'); x.scale(dpr, dpr); return [x, cv.clientWidth, cv.clientHeight]; };

/* ---- benchmark ---- */
PS.app_bench = () => {
  const p = S.phoneById(PS.id), st = S.stats(p);
  $('#psApp').innerHTML = '<div style="text-align:center;margin-top:6px"><div style="font-weight:900;font-size:18px">⚡ QuantaBench 10</div><div class="tiny" style="opacity:.6">CPU · GPU · AI · Memory · Storage</div></div>' + PS.canvas('psB', 200) + '<button class="psBtn" data-a="psBenchRun">Run benchmark</button><div id="psBRes" class="tiny mt8"></div>';
  PS.drawBench(0, st);
};
PS.drawBench = (prog, st) => {
  const [x, W, Hh] = PS.ctx('psB');
  const keys = [['single', 'CPU 1-core'], ['multi', 'CPU multi'], ['gpu', 'GPU'], ['ai', 'AI'], ['mem', 'Memory'], ['sto', 'Storage']];
  const ref = M.phoneStats(M.genPhone(S.fy(), 'flagship', { tech: 1 }), S.fy(), { fy: S.fy(), has: () => true, sw: 80 }).bench;
  keys.forEach(([k, n], i) => {
    const y = 14 + i * 31, f = U.clamp(prog * 6 - i, 0, 1);
    x.fillStyle = '#8a97ad'; x.font = '10px sans-serif'; x.fillText(n, 8, y);
    x.fillStyle = '#1b2333'; x.fillRect(8, y + 4, W - 16, 10);
    const v = st.bench[k] * f, w = Math.min(1.2, st.bench[k] / ref[k]) / 1.2 * (W - 16) * f;
    const g = x.createLinearGradient(8, 0, W, 0); g.addColorStop(0, '#ff6a3d'); g.addColorStop(1, '#ff2d7a'); x.fillStyle = g; x.fillRect(8, y + 4, w, 10);
    x.fillStyle = '#fff'; x.font = 'bold 10px sans-serif'; x.textAlign = 'right'; x.fillText(f > 0 ? U.num(v) : '', W - 8, y); x.textAlign = 'left';
  });
};
UI.A.psBenchRun = () => {
  const p = S.phoneById(PS.id), st = S.stats(p);
  const t0 = performance.now();
  const step = () => {
    const prog = Math.min(1, (performance.now() - t0) / 3600);
    PS.drawBench(prog, st);
    if (prog < 1) PS.anim = requestAnimationFrame(step);
    else {
      const all = G.rivals.filter((r) => r.alive).flatMap((r) => r.phones.map((ph) => [ph.name, ph.st.bench.total])).concat([[p.name + ' ★', st.bench.total]]).sort((a, b) => b[1] - a[1]);
      const rank = all.findIndex((a) => a[0] === p.name + ' ★') + 1;
      $('#psBRes').innerHTML = '<div style="font-size:22px;font-weight:900;text-align:center">' + U.num(st.bench.total) + '</div><div style="text-align:center;opacity:.7">Rank #' + rank + ' of ' + all.length + ' phones on sale' + (p.design.benchBoost && S.has('benchboost') ? ' · <span style="color:#ffb648">boost mode active</span>' : '') + '</div>' + all.slice(Math.max(0, rank - 3), rank + 2).map((a) => '<div style="display:flex;justify-content:space-between;' + (a[0].endsWith('★') ? 'color:#3ee6ff;font-weight:800' : '') + '"><span>' + U.esc(a[0]) + '</span><span>' + U.num(a[1]) + '</span></div>').join('');
    }
  };
  PS.stop(); step();
};

/* ---- gaming ---- */
PS.app_game = () => {
  const avail = D.games.filter((g) => g.year <= S.year() + 0.5);
  if (!PS.game || !avail.find((g) => g.id === PS.game)) PS.game = avail[avail.length - 1].id;
  $('#psApp').innerHTML = '<div style="font-weight:900;font-size:16px;margin-top:4px">🎮 Game Lab</div><select class="psSel" data-ch="psGame">' + H.opts(avail.map((g) => [g.id, g.name + ' (' + g.year + ', ' + g.genre + ')']), PS.game) + '</select>' +
    '<select class="psSel" data-ch="psPreset">' + H.opts(D.gfxPresets.map((p) => [p.id, p.name + ' graphics']), PS.preset) + '</select>' + PS.canvas('psG', 170) + '<button class="psBtn" data-a="psGameRun">▶ Play for 20 minutes</button><div id="psGRes" class="tiny mt8"></div>';
  PS.drawGame(null, 0);
};
UI.C.psGame = (el) => { PS.game = el.value; };
UI.C.psPreset = (el) => { PS.preset = el.value; };
PS.drawGame = (res, prog) => {
  const [x, W, Hh] = PS.ctx('psG');
  x.fillStyle = '#0b1020'; x.fillRect(0, 0, W, Hh);
  const p = S.phoneById(PS.id), hz = p.design.disp.hz;
  const maxF = Math.max(60, hz);
  x.strokeStyle = 'rgba(255,255,255,0.07)'; x.fillStyle = '#5b6880'; x.font = '9px sans-serif';
  [30, 60, 90, 120, 144].filter((v) => v <= maxF).forEach((v) => { const y = Hh - 14 - v / maxF * (Hh - 30); x.beginPath(); x.moveTo(24, y); x.lineTo(W, y); x.stroke(); x.fillText(v, 2, y + 3); });
  if (!res) return;
  const n = Math.max(1, Math.floor(res.samples.length * prog));
  const sx = (i) => 24 + i / (res.samples.length - 1) * (W - 28);
  x.lineWidth = 2; x.strokeStyle = '#3ee6ff'; x.beginPath();
  res.samples.slice(0, n).forEach((s, i) => { const y = Hh - 14 - Math.min(s.fps, maxF) / maxF * (Hh - 30); i ? x.lineTo(sx(i), y) : x.moveTo(sx(i), y); }); x.stroke();
  x.strokeStyle = '#ff6a3d'; x.lineWidth = 1.5; x.beginPath();
  res.samples.slice(0, n).forEach((s, i) => { const y = Hh - 14 - (s.T - 20) / 35 * (Hh - 30); i ? x.lineTo(sx(i), y) : x.moveTo(sx(i), y); }); x.stroke();
  const cur = res.samples[n - 1];
  x.fillStyle = '#fff'; x.font = 'bold 22px sans-serif'; x.fillText(Math.round(cur.fps) + ' FPS', 30, 26);
  x.font = 'bold 12px sans-serif'; x.fillStyle = cur.T > 45 ? '#ff4d6a' : '#ffb648'; x.fillText(cur.T.toFixed(1) + '°C', 30, 42);
  x.fillStyle = '#8a97ad'; x.font = '9px sans-serif'; x.fillText(Math.round(cur.t / 60) + ' min', W - 34, Hh - 3);
};
UI.A.psGameRun = () => {
  const p = S.phoneById(PS.id), st = S.stats(p);
  const game = D.games.find((g) => g.id === PS.game), preset = D.gfxPresets.find((g) => g.id === PS.preset);
  const res = M.gameSession(st, game, preset, { has: S.has, hz: p.design.disp.hz, ramGB: p.design.ram.gb });
  const t0 = performance.now();
  const step = () => {
    const prog = Math.min(1, (performance.now() - t0) / 5000);
    PS.drawGame(res, prog);
    if (prog < 1) PS.anim = requestAnimationFrame(step);
    else $('#psGRes').innerHTML = '<b>Average ' + res.avg.toFixed(0) + ' FPS</b> · 1% low ' + res.low.toFixed(0) + ' · peak temp ' + res.maxT.toFixed(1) + '°C<br>' + (res.overheated ? '<span style="color:#ff4d6a">🔥 Overheated — the game was force-closed.</span>' : res.last < res.first * 0.8 ? '<span style="color:#ffb648">Thermal throttling: ' + res.first.toFixed(0) + ' → ' + res.last.toFixed(0) + ' FPS</span>' : '<span style="color:#3ddc84">Stable performance.</span>') + (res.stutter ? '<br><span style="color:#ffb648">Not enough RAM — stutters.</span>' : '') + (res.rtFallback ? '<br><span style="color:#ffb648">No hardware ray tracing — software fallback.</span>' : '');
  };
  PS.stop(); step();
};

/* ---- camera ---- */
PS.app_camera = () => {
  $('#psApp').innerHTML = '<div style="margin-top:2px">' + PS.canvas('psC', 230) + '</div><div class="row mt8" style="gap:4px">' + ['day', 'night', 'zoom', 'selfie'].map((m) => '<button class="psBtn" style="margin:0;padding:6px;font-size:11px;' + (PS.camMode === m ? '' : 'background:#1b2333') + '" data-a="psCam" data-v="' + m + '">' + m + '</button>').join('') + '</div><div id="psCRes" class="tiny mt8"></div>';
  PS.drawPhoto();
};
UI.A.psCam = (el) => { PS.camMode = el.dataset.v; PS.app_camera(); };
PS.drawPhoto = () => {
  const p = S.phoneById(PS.id), st = S.stats(p);
  const [x, W, Hh] = PS.ctx('psC');
  const mode = PS.camMode;
  const sub = { day: st.cam.day, night: st.cam.night, zoom: st.cam.zoom, selfie: st.cam.selfie }[mode];
  const qual = U.clamp(sub / 120, 0.05, 1.2);
  const rng = U.srng(42);
  // scene
  const night = mode === 'night';
  const sky = x.createLinearGradient(0, 0, 0, Hh);
  sky.addColorStop(0, night ? '#05061a' : '#5fb3ff'); sky.addColorStop(0.7, night ? '#1b1640' : '#ffd8a8'); sky.addColorStop(1, night ? '#0a0a14' : '#f2a65a');
  x.fillStyle = sky; x.fillRect(0, 0, W, Hh);
  if (night) { x.fillStyle = '#fff'; for (let i = 0; i < 40; i++) x.fillRect(rng() * W, rng() * Hh * 0.5, 1, 1); x.beginPath(); x.arc(W * 0.78, Hh * 0.18, 12, 0, 7); x.fillStyle = '#f5f3d6'; x.fill(); }
  else { x.beginPath(); x.arc(W * 0.8, Hh * 0.2, 16, 0, 7); x.fillStyle = '#fff6c9'; x.fill(); }
  const zoomF = mode === 'zoom' ? 2.2 : 1;
  for (let i = 0; i < 14; i++) {
    const bw = (18 + rng() * 26) * zoomF, bh = (40 + rng() * 120) * zoomF, bx = (i * 26 - (zoomF - 1) * W * 0.5) % (W + 60) - 20;
    x.fillStyle = night ? '#0d0f1d' : R.shade('#3a4a66', 0.7 + rng() * 0.5); x.fillRect(bx, Hh - bh, bw, bh);
    for (let wy = Hh - bh + 6; wy < Hh - 4; wy += 7 * zoomF) for (let wx = bx + 3; wx < bx + bw - 3; wx += 6 * zoomF) if (rng() < (night ? 0.45 : 0.25)) { x.fillStyle = night ? '#ffd36b' : '#cfe6ff'; x.fillRect(wx, wy, 2.5 * zoomF, 3 * zoomF); }
  }
  if (mode === 'selfie') { x.fillStyle = '#f0c8a0'; x.beginPath(); x.arc(W / 2, Hh * 0.55, 42, 0, 7); x.fill(); x.fillStyle = '#2b1a10'; x.beginPath(); x.arc(W / 2, Hh * 0.47, 44, Math.PI, 0); x.fill(); x.fillStyle = '#222'; x.fillRect(W / 2 - 18, Hh * 0.53, 8, 5); x.fillRect(W / 2 + 10, Hh * 0.53, 8, 5); x.fillStyle = '#c0504d'; x.fillRect(W / 2 - 12, Hh * 0.64, 24, 4); }
  // optical degradation driven by the camera sub-score
  const blur = Math.max(0, (1 - qual) * 3.5);
  if (blur > 0.3) { x.filter = 'blur(' + blur.toFixed(1) + 'px)'; x.drawImage(x.canvas, 0, 0, x.canvas.width, x.canvas.height, 0, 0, W, Hh); x.filter = 'none'; }
  const noise = Math.max(0, (1 - qual) * (night ? 0.7 : 0.35));
  if (noise > 0.02) { const img = x.getImageData(0, 0, x.canvas.width, x.canvas.height); const dd = img.data; for (let i = 0; i < dd.length; i += 4) { const n = (Math.random() - 0.5) * 255 * noise; dd[i] += n; dd[i + 1] += n * (0.8 + Math.random() * 0.4); dd[i + 2] += n; } x.putImageData(img, 0, 0); }
  if (night && qual < 0.5) { x.fillStyle = 'rgba(0,0,0,' + (0.5 - qual) + ')'; x.fillRect(0, 0, W, Hh); }
  x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, Hh - 18, W, 18); x.fillStyle = '#fff'; x.font = 'bold 10px sans-serif';
  x.fillText((mode === 'selfie' ? p.design.cam.front : st.cam.effMP) + 'MP · ' + mode.toUpperCase() + ' · score ' + sub.toFixed(0), 6, Hh - 6);
  $('#psCRes').innerHTML = 'Overall camera score <b>' + st.cam.score.toFixed(0) + '</b> · day ' + st.cam.day.toFixed(0) + ' · night ' + st.cam.night.toFixed(0) + ' · video ' + st.cam.video.toFixed(0) + ' (' + st.cam.video_res + ') · zoom ' + st.cam.zoom.toFixed(0) + ' · selfie ' + st.cam.selfie.toFixed(0);
};

/* ---- battery ---- */
PS.app_battery = () => {
  const p = S.phoneById(PS.id), st = S.stats(p);
  $('#psApp').innerHTML = '<div style="font-weight:900;font-size:16px;margin-top:4px">🔋 Battery lab</div>' + PS.canvas('psBat', 170) + '<button class="psBtn" data-a="psBatRun">Run drain test</button><div class="tiny mt8">' + U.num(p.design.bat.mah) + ' mAh · ' + st.wh.toFixed(1) + ' Wh · average draw ' + st.pAvg.toFixed(2) + ' W (display ' + st.pDisplay.toFixed(2) + ' W, chip ' + st.socAvg.toFixed(2) + ' W, modem ' + st.modem.P.toFixed(2) + ' W)<br>Standby ' + st.standby.toFixed(1) + ' days · 0→100% in ' + st.chargeMin.toFixed(0) + ' min at ' + p.design.bat.charge + ' W</div><div id="psBatRes" class="mt8"></div>';
  PS.drawBat(0, st);
};
PS.drawBat = (prog, st) => {
  const [x, W, Hh] = PS.ctx('psBat');
  const maxH = Math.max(12, Math.ceil(st.sot / 2) * 2 + 2);
  x.strokeStyle = 'rgba(255,255,255,0.07)'; x.fillStyle = '#5b6880'; x.font = '9px sans-serif';
  for (let h = 0; h <= maxH; h += 2) { const px = 22 + h / maxH * (W - 30); x.beginPath(); x.moveTo(px, 8); x.lineTo(px, Hh - 16); x.stroke(); x.fillText(h + 'h', px - 5, Hh - 4); }
  const rivals = G.rivals.filter((r) => r.alive).flatMap((r) => r.phones).sort((a, b) => b.st.sot - a.st.sot).slice(0, 3);
  rivals.forEach((ph) => { x.strokeStyle = 'rgba(167,116,255,0.5)'; x.lineWidth = 1; x.beginPath(); x.moveTo(22, 8); x.lineTo(22 + ph.st.sot / maxH * (W - 30), Hh - 16); x.stroke(); });
  const end = st.sot * prog;
  x.strokeStyle = '#3ddc84'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(22, 8); x.lineTo(22 + end / maxH * (W - 30), 8 + (Hh - 24) * prog); x.stroke();
  x.fillStyle = '#fff'; x.font = 'bold 18px sans-serif'; x.fillText(Math.round(100 - prog * 100) + '%', W - 64, 28);
};
UI.A.psBatRun = () => {
  const p = S.phoneById(PS.id), st = S.stats(p);
  const t0 = performance.now();
  const step = () => {
    const prog = Math.min(1, (performance.now() - t0) / 3500);
    PS.drawBat(prog, st);
    if (prog < 1) PS.anim = requestAnimationFrame(step);
    else {
      const all = G.rivals.filter((r) => r.alive).flatMap((r) => r.phones.map((ph) => [ph.name, ph.st.sot])).concat([[p.name + ' ★', st.sot]]).sort((a, b) => b[1] - a[1]);
      const rank = all.findIndex((a) => a[0].endsWith('★')) + 1;
      $('#psBatRes').innerHTML = '<div style="font-size:20px;font-weight:900">' + st.sot.toFixed(1) + ' h screen-on</div><div class="tiny" style="opacity:.7">#' + rank + ' of ' + all.length + ' phones on the market (purple: top rivals)</div>';
    }
  };
  PS.stop(); step();
};

/* ---- about / misc ---- */
PS.app_specs = () => {
  const p = S.phoneById(PS.id), st = S.stats(p), d = S.designOf(p);
  $('#psApp').innerHTML = '<div style="font-weight:900;font-size:16px;margin:4px 0 8px">About phone</div><div class="tiny" style="line-height:1.9">' +
    [['Model', U.esc(p.name)], ['OS', d.os === 'own' ? U.esc(G.co.name.split(' ')[0]) + ' OS ' + (S.has('os_own3') ? '3' : S.has('os_own2') ? '2' : '1') : 'OpenMobile ' + (S.year() - 2007)], ['Chip', U.esc(d.chip.name || (S.chipById(p.chipId) || {}).name || '')], ['RAM', d.ram.gb + ' GB'], ['Storage', d.sto.gb + ' GB'], ['Display', d.disp.size + '" ' + st.pxW + '×' + st.pxH], ['Battery', U.num(d.bat.mah) + ' mAh'], ['Camera', d.cam.mp + ' MP'], ['Weight', st.weight.toFixed(0) + ' g'], ['Serial', 'MPF' + p.id.slice(-6).toUpperCase()]].map(([k, v]) => '<div style="display:flex;justify-content:space-between;border-bottom:1px solid #1f2a3d"><span style="opacity:.6">' + k + '</span><span>' + v + '</span></div>').join('') + '</div>';
};
PS.app_store = () => {
  const p = S.phoneById(PS.id);
  const own = p.design.os === 'own';
  const apps = own ? Math.round(2000 + S.ecoFactor() * 2e6) : Math.round(80000 * Math.pow(1.6, Math.min(10, S.fy() - 2010)));
  $('#psApp').innerHTML = '<div style="font-weight:900;font-size:16px;margin:4px 0">🛍️ ' + (own ? U.esc(G.co.name.split(' ')[0]) + ' Store' : 'AppVerse') + '</div><div class="tiny" style="opacity:.7">' + U.num(apps) + ' apps available</div>' + ['Chirper', 'PhotoGram', 'MapQuest Go', 'StreamBox', 'Pocket Birds', 'CloudNotes', 'RideNow', 'Banky'].map((a, i) => '<div style="display:flex;align-items:center;gap:8px;margin-top:8px"><div style="width:34px;height:34px;border-radius:9px;background:hsl(' + i * 45 + ',70%,50%)"></div><div style="flex:1"><b>' + a + '</b><div class="tiny" style="opacity:.6">' + (own && S.ecoFactor() < 0.3 && i > 2 ? 'Not available on this platform' : 'Free') + '</div></div></div>').join('');
};
PS.app_msg = () => { $('#psApp').innerHTML = '<div style="font-weight:900;font-size:16px;margin:4px 0 8px">💬 Messages</div>' + [['Mom', 'Is this the new phone you made?? 😍'], ['Lead engineer', 'Thermals look ' + (S.stats(S.phoneById(PS.id)).sustained > 0.85 ? 'great' : 'scary') + '.'], ['Investor', 'When is the launch event?'], ['Supplier', 'Your component order shipped.']].map(([u, m]) => '<div style="padding:7px 0;border-bottom:1px solid #1f2a3d"><b>' + u + '</b><div class="tiny" style="opacity:.75">' + m + '</div></div>').join(''); };
PS.app_web = () => {
  const p = S.phoneById(PS.id), st = S.stats(p);
  const load = (3.2 * Math.pow(0.85, S.fy() - 2010) * 1000 / Math.pow(st.cs.single, 0.8) * (st.modem.mbps < 50 ? 1.6 : 1)).toFixed(2);
  $('#psApp').innerHTML = '<div style="font-weight:900;font-size:16px;margin:4px 0">🌐 Browser</div><div style="background:#111827;border-radius:8px;padding:6px;font-size:11px;opacity:.8">techpulse.news/' + U.esc(p.name.toLowerCase().replace(/\s+/g, '-')) + '</div><div style="margin-top:10px;font-family:Georgia,serif;font-weight:900;font-size:15px">' + (p.reviews && p.reviews[0] ? U.esc(p.reviews[0].headline) : 'Leaked: ' + U.esc(G.co.name) + ' prepares a new phone') + '</div><div class="tiny mt8" style="opacity:.6">Page loaded in ' + load + ' s over ' + st.modem.name + '</div>';
};
