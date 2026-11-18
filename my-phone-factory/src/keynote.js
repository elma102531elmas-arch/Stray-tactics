/* =========================================================
   KEYNOTE — interactive 3D stage, live demos, crowd, replay
   ========================================================= */
const KN = { active: false, s: null };
KN.SEG = {
  open: { spot: 'center', name: '👋 Opening', min: 3 },
  reveal: { spot: 'center', name: '✨ Reveal the phone', min: 4 },
  guest: { spot: 'center', name: '🌟 Bring out the guest', min: 6, cond: (s) => s.plan.guest !== 'none' },
  onemore: { spot: 'center', name: '🎁 One more thing…', min: 6, cond: (s) => !!s.plan.extraId },
  close: { spot: 'center', name: '🙏 Closing', min: 2 },
  specs: { spot: 'screen', name: '📊 Show specs', min: 8 },
  compare: { spot: 'screen', name: '⚔️ Compare with rivals', min: 6 },
  bench: { spot: 'screen', name: '⚡ Live benchmark', min: 5 },
  trailer: { spot: 'screen', name: '🎬 Play trailer', min: 3, cond: (s) => s.plan.trailer !== 'none' },
  game: { spot: 'demo', name: '🎮 Gaming demo', min: 9 },
  camera: { spot: 'demo', name: '📷 Camera demo', min: 6 },
  battery: { spot: 'demo', name: '🔋 Battery test', min: 5 },
  price: { spot: 'podium', name: '💲 Price & availability', min: 4 },
};
KN.SPOTNAME = { center: 'Center stage', screen: 'Giant screen', demo: 'Demo table', podium: 'Podium' };
KN.TONES = { humble: { pos: 0.78, neg: 0.8, exp: -0.05, label: 'Humble' }, confident: { pos: 1, neg: 1, exp: 0, label: 'Confident' }, hype: { pos: 1.3, neg: 1.6, exp: 0.09, label: 'Hype' } };

/* ---------------- setup ---------------- */
KN.buildDOM = () => {
  const root = $('#keynote');
  root.innerHTML = '<canvas id="kCanvas"></canvas><div id="kTop"><div class="kPanel kMeter"><div class="lbl"><span>CROWD</span><span id="kMoodV">50</span></div><div class="bar" id="kMood"><i></i></div></div><div class="kPanel kMeter"><div class="lbl"><span>TIME</span><span id="kClock">0/45</span></div><div class="bar" id="kTime"><i></i></div></div><div class="grow"></div><button class="btn sm" id="kEnd" data-a="kEnd">⏹ End</button></div>' +
    '<div id="kFeed"></div><div id="kCaption"></div><div id="kHint" class="hidden"></div><div id="kActions"></div><div id="kJoy"><div class="knob"></div></div><div id="kChoice"></div><div id="kReplayBar" class="hidden"></div>';
  root.classList.add('on');
  KN.cv = $('#kCanvas'); KN.x = KN.cv.getContext('2d');
  // joystick
  const joy = $('#kJoy'), knob = joy.querySelector('.knob');
  KN.joy = { x: 0, y: 0 };
  const setJ = (e) => { const r = joy.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); const m = Math.hypot(dx, dy), max = r.width / 2 - 10; if (m > max) { dx *= max / m; dy *= max / m; } KN.joy = { x: dx / max, y: dy / max }; knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; if (KN.s) KN.s.target = null; };
  joy.onpointerdown = (e) => { joy.setPointerCapture(e.pointerId); setJ(e); };
  joy.onpointermove = (e) => { if (e.buttons || e.pointerType === 'touch') setJ(e); };
  joy.onpointerup = joy.onpointercancel = () => { KN.joy = { x: 0, y: 0 }; knob.style.transform = ''; };
  KN.cv.onpointerdown = (e) => KN.tapWalk(e);
  KN.keys = {};
  KN.kd = (e) => { KN.keys[e.key.toLowerCase()] = true; if (KN.s && KN.s.mode === 'live' && (e.key === 'Enter' || e.key === 'e')) { const b = $('#kActions .btn.pri'); if (b) b.click(); } if (KN.s && KN.s.mode === 'replay' && e.key === ' ') { e.preventDefault(); UI.A.kPlay(); } };
  KN.ku = (e) => { KN.keys[e.key.toLowerCase()] = false; };
  window.addEventListener('keydown', KN.kd); window.addEventListener('keyup', KN.ku);
  KN.resize = () => { const dpr = Math.min(2, window.devicePixelRatio || 1); KN.cv.width = innerWidth * dpr; KN.cv.height = innerHeight * dpr; KN.dpr = dpr; };
  window.addEventListener('resize', KN.resize); KN.resize();
};
KN.teardown = () => {
  KN.active = false; cancelAnimationFrame(KN.raf);
  window.removeEventListener('keydown', KN.kd); window.removeEventListener('keyup', KN.ku); window.removeEventListener('resize', KN.resize);
  const root = $('#keynote'); root.classList.remove('on'); root.innerHTML = '';
  KN.s = null;
};
KN.lookOf = (p) => { const st = S.stats(p); return { d: { disp: { bezel: p.design.disp.bezel }, form: p.design.form, body: { mat: p.design.body.mat, bio: p.design.body.bio }, cam: { extras: p.design.cam.extras.slice(), sensor: p.design.cam.sensor } }, st: { bodyW: st.bodyW, bodyH: st.bodyH, sw_in: st.sw_in, sh_in: st.sh_in, bump: st.bump }, color: p.color, name: p.name }; };
KN.common = (plan, look) => {
  const stage = EV.find(EV.stages, plan.stage), venue = EV.find(EV.venues, plan.venue);
  const seed = U.hashStr(plan.name + plan.venue + plan.cap);
  const rng = U.srng(seed);
  const rows = [];
  const nRows = U.clamp(Math.round(Math.cbrt(plan.cap) * 0.9), 2, 8);
  const perCap = Math.ceil(plan.cap / nRows);
  for (let i = 0; i < nRows; i++) {
    const z = -1.6 - i * 0.95, half = Math.min(stage.w / 2 + 2 + i * 0.9, 1.2 + perCap * 0.33);
    const per = Math.max(3, Math.min(perCap, Math.round(half * 2 / 0.62)));
    const ppl = [];
    for (let j = 0; j < per; j++) { const x = -half + (j + 0.5) * (2 * half / per) + (rng() - 0.5) * 0.12; if (plan.arch === 'thrust' && Math.abs(x) < 1.5 && i < 4) continue; ppl.push({ x, h: 1.08 + rng() * 0.14, hair: rng() < 0.5 ? '#1a1410' : rng() < 0.5 ? '#3b2a1a' : '#7a6a55', shirt: 'hsl(' + Math.floor(rng() * 360) + ',' + Math.floor(20 + rng() * 40) + '%,' + Math.floor(18 + rng() * 22) + '%)', ph: rng() * 6.28, cheer: rng() }); }
    rows.push({ z, ppl });
  }
  const skin = ['#f1c9a5', '#d9a77a', '#a8754b', '#7a4e2d', '#f5d6c0'][seed % 5];
  return { plan, look, stage, venue, W: stage.w, Dd: stage.d, rows, seed, skin, outfit: EV.find(EV.outfits, plan.outfit), bg: EV.find(EV.backgrounds, plan.bg), light: EV.find(EV.lights, plan.light),
    spots: { center: [0, 1.5], screen: [0, stage.d - 1.0], demo: [-stage.w / 2 + 1.7, 1.9], podium: [stage.w / 2 - 1.7, 1.9] }, logo: G.co.logo, coName: G.co.name };
};
KN.start = (plan) => {
  const p = S.phoneById(plan.phoneId);
  const st = S.stats(p);
  const look = KN.lookOf(p);
  const c = KN.common(plan, look);
  const s = Object.assign(c, {
    mode: 'live', id: U.uid('ev'), phoneId: p.id, st, real: 0, clock: 0, idle: 0, lastSeg: 0,
    pres: { x: 0, z: c.Dd * 0.5, dir: 1, walk: 0, talk: 0, phase: 0 }, target: null, busy: false, choice: false, ended: false,
    mood: 0, peak: 0, expect: 0.5, done: {}, impacts: [], failures: [], claims: {}, rec: { frames: [], events: [] }, q: [], lastFrame: -1, camX: 0, guest: false, priceFinal: null, avail: plan.avail,
  });
  const v = c.venue;
  s.mood = U.clamp(42 + v.prestige * 10 + EV.find(EV.lights, plan.light).mood + EV.find(EV.music, plan.music).mood + EV.find(EV.archs, plan.arch).mood + U.sum(plan.fx, (id) => EV.find(EV.effects, id).mood) * 0.5 + p.hype / 5 + (G.rep - 30) / 6 + G.staff.mkt * 0.15, 15, 80);
  s.peak = s.mood; s.expect = U.clamp(0.4 + p.hype / 250 + G.rep / 300, 0.3, 0.8);
  s.ambient = 25 + s.light.heat;
  if (plan.extraId) { const [k, id] = plan.extraId.split(':'); s.extra = { kind: k, id }; }
  s.rec.plan = plan; s.rec.look = look;
  KN.s = s; KN.active = true;
  KN.buildDOM();
  KN.ev('screen', { kind: 'logo', data: {} });
  KN.ev('cap', { text: '🎤 Welcome to ' + plan.name + '! Walk to the glowing spots to present.' });
  KN.updateActions();
  KN.last = performance.now();
  KN.loop();
};

/* ---------------- recording helpers ---------------- */
KN.ev = (e, o) => { const s = KN.s; const ev = Object.assign({ t: Math.round(s.real), e }, o); s.rec.events.push(ev); if (e === 'post') KN.renderFeed(); return ev; };
KN.say = (text) => { KN.ev('cap', { text }); SFX.click(); };
KN.screen = (kind, data = {}) => KN.ev('screen', { kind, data });
KN.post = (r, seg) => {
  const s = KN.s, N = s.look.name;
  const pos = ['🔥🔥🔥', G.co.name + ' is cooking', 'ok I need the ' + N, 'take my money 💸', 'this is actually insane', 'W keynote', N + ' looks so clean', 'didn\'t expect this from ' + G.co.name];
  const neg = ['mid', 'yikes 😬', 'is that it?', 'boring…', 'my phone from 3 years ago does this', 'L', 'who asked for this', 'zzz'];
  const neu = ['hmm ok', 'interesting', 'waiting for reviews', 'not bad not great'];
  const spec = { overheat: ['IT OVERHEATED ON STAGE 💀', '🔥 hot phone summer'], lowfps: ['slideshow gaming 😂', (s.fps || 18) + ' FPS lmaooo'], crash: ['camera crash speedrun 😂', 'live demo curse strikes again'], cheat: ['caught cheating LIVE', 'bench mode exposed 💀'], awkward: ['that was so awkward 😬'] };
  const list = spec[seg] || (r > 0.25 ? pos : r < -0.15 ? neg : neu);
  const n = U.clamp(Math.round(1 + Math.abs(r) * 3), 1, 3);
  for (let i = 0; i < n; i++) KN.after(300 + i * 700, () => KN.ev('post', { u: MED.user(), m: U.pick(list) }));
};
KN.q = (ms, fn) => KN.after(ms, fn);
KN.after = (ms, fn) => KN.s.q.push({ at: KN.s.real + ms, fn });

/* ---------------- impacts & reactions ---------------- */
KN.impact = (r, seg, toneId) => {
  const s = KN.s, tone = KN.TONES[toneId || 'confident'];
  r = U.clamp(r - (s.expect - 0.5) * 0.4, -1, 1);
  r *= r >= 0 ? tone.pos : tone.neg;
  r = U.clamp(r, -1, 1);
  s.expect = U.clamp(s.expect + tone.exp, 0.2, 0.95);
  if (toneId === 'hype') s.claims.hypeTalk = true;
  const d = r * 14 * (r > 0 ? 1 - s.mood / 135 : 1);
  s.mood = U.clamp(s.mood + d, 0, 100); s.peak = Math.max(s.peak, s.mood);
  s.impacts.push({ seg, r });
  let kind = r > 0.55 && s.mood > 68 ? 'ovation' : r > 0.3 ? 'cheer' : r > 0.08 ? 'applause' : r > -0.08 ? 'polite' : r > -0.3 ? 'silence' : 'boo';
  if (['crash', 'lowfps'].includes(seg)) kind = 'laugh';
  if (seg === 'overheat') kind = 'gasp';
  KN.ev('react', { kind, r: +r.toFixed(2) });
  ({ ovation: () => SFX.cheer(1), cheer: () => SFX.cheer(0.7), applause: () => SFX.applause(0.45), polite: () => SFX.applause(0.15), silence: () => {}, boo: () => SFX.boo(), laugh: () => SFX.laugh(), gasp: () => SFX.gasp() })[kind]();
  KN.post(r, seg);
  return r;
};
KN.fail = (kind) => { const s = KN.s; if (!s.failures.includes(kind)) s.failures.push(kind); };

/* ---------------- choices ---------------- */
KN.ask = (title, opts, cb) => {
  const s = KN.s; s.choice = true;
  const box = $('#kChoice');
  box.innerHTML = '<div class="box"><div class="kPanel" style="font-weight:800">' + title + '</div>' + opts.map((o, i) => '<button class="opt" data-i="' + i + '">' + (o.tone ? '<div class="tone">' + KN.TONES[o.tone].label + '</div>' : '') + o.text + (o.sub ? '<div class="tiny" style="opacity:.6;margin-top:2px">' + o.sub + '</div>' : '') + '</button>').join('') + '</div>';
  box.classList.add('on');
  box.querySelectorAll('.opt').forEach((b) => (b.onclick = () => { SFX.click(); box.classList.remove('on'); box.innerHTML = ''; s.choice = false; KN.last = performance.now(); cb(opts[+b.dataset.i]); }));
};
KN.lines = (h, c, y) => [{ tone: 'humble', text: '“' + h + '”' }, { tone: 'confident', text: '“' + c + '”' }, { tone: 'hype', text: '“' + y + '”' }];

/* ---------------- segments ---------------- */
KN.rivalPool = () => G.rivals.filter((r) => r.alive).flatMap((r) => r.phones);
KN.sk = (k) => KN.s.st.qual.s[k];
KN.run = (id) => {
  const s = KN.s; if (s.busy || s.ended) return;
  const seg = KN.SEG[id];
  s.busy = true; s.done[id] = true; KN.updateActions();
  const N = s.look.name, plan = s.plan, p = S.phoneById(s.phoneId), st = s.st;
  const finish = (ms) => KN.after(ms, () => { s.busy = false; s.pres.talk = 0; s.lastSeg = s.clock; KN.updateActions(); });
  const talk = (ms) => { s.pres.talk = 1; s.segClock = { left: seg.min, until: s.real + ms }; };
  const F = {
    open() {
      KN.ask('Opening words', KN.lines('Thank you all for coming. We\'re a small team with a big dream.', 'Today, we\'re going to show you something special.', 'Today, we change the smartphone industry. Forever.'), (o) => {
        talk(4200); KN.say(o.text); KN.screen('title', { text: plan.name, sub: G.co.name }); KN.ev('fx', { fx: 'sweep' });
        const r = 0.12 + s.venue.prestige * 0.15 + (s.light.mood + EV.find(EV.music, plan.music).mood) / 40 + (G.rep - 30) / 220 + (plan.music === 'band' ? 0.15 : 0);
        KN.after(3200, () => KN.impact(r, 'open', o.tone)); finish(4200);
      });
    },
    reveal() {
      KN.ask('How do you reveal it?', KN.lines('Here it is: the ' + N + '.', 'Introducing… the ' + N + '.', N + '. Nothing else comes close.'), (o) => {
        talk(8000); KN.ev('lights', { v: 0 }); KN.screen('black'); KN.say('…');
        KN.after(1300, () => { SFX.whoosh(); KN.screen('reveal', {}); if (plan.fx.includes('co2')) KN.ev('fx', { fx: 'co2' }); if (plan.light === 'holo') KN.ev('fx', { fx: 'holo' }); });
        KN.after(4300, () => { KN.say(o.text); SFX.boom(); KN.ev('lights', { v: 1 }); if (plan.fx.includes('pyro')) KN.ev('fx', { fx: 'pyro' }); });
        const fold = p.design.form === 'fold' ? 0.35 : 0;
        const r = (KN.sk('build') - 0.85) * 1.6 + (KN.sk('display') - 0.85) * 1.0 + fold + EV.find(EV.trailers, plan.trailer).q * 0.1 + (plan.fx.includes('pyro') ? 0.08 : 0) + (s.done.specs || s.done.price ? -0.2 : 0.06);
        KN.after(5600, () => KN.impact(U.clamp(r, -1, 1), 'reveal', o.tone)); finish(7600);
      });
    },
    specs() {
      const ref = M.ref(S.fy());
      const items = [
        { k: 'chip', t: '⚡ Chipset', v: 'QuantaBench ' + U.num(st.bench.total), r: (KN.sk('perf') - 0.9) * 2.2 },
        { k: 'display', t: '🖥️ Display', v: p.design.disp.size + '" ' + D.dispT(p.design.disp.type).name + ' ' + p.design.disp.hz + 'Hz', r: (KN.sk('display') - 0.9) * 2.4 },
        { k: 'camera', t: '📷 Camera', v: p.design.cam.mp + 'MP · ' + (1 + p.design.cam.extras.length) + ' lenses', r: (KN.sk('camera') - 0.9) * 2.2 },
        { k: 'battery', t: '🔋 Battery', v: U.num(p.design.bat.mah) + ' mAh · ' + st.sot.toFixed(1) + ' h', r: (KN.sk('battery') - 0.9) * 2.4 },
        { k: 'memory', t: '💾 Memory', v: p.design.ram.gb + ' GB RAM · ' + p.design.sto.gb + ' GB', r: (st.ramScore - 0.95) * 1.8 },
        { k: 'build', t: '🧱 Design', v: st.thick.toFixed(1) + ' mm · ' + st.weight.toFixed(0) + ' g', r: (KN.sk('build') - 0.9) * 2.4 },
        { k: 'network', t: '📶 Network', v: st.modem.name, r: (KN.sk('connect') - 0.9) * 2.5 },
        { k: 'software', t: '💻 Software', v: p.design.os === 'own' ? G.co.name.split(' ')[0] + ' OS' : 'OpenMobile + your UI', r: (KN.sk('software') - 0.9) * 2.4 },
        { k: 'ai', t: '🤖 AI engine', v: st.cs.tops ? st.cs.tops.toFixed(0) + ' TOPS' : 'none', r: st.cs.tops ? U.clamp(0.3 * U.log2(st.cs.tops / Math.max(1, M.genSoC(S.fy(), 'flagship').npuUnits * (D.npuGens[M.genSoC(S.fy(), 'flagship').npuGen] || { tops: 1 }).tops)) + 0.2, -1, 1) : -0.6 },
      ];
      KN.askMulti('Pick up to 4 specs to highlight', items, 4, (sel) => {
        KN.ask('How do you present them?', KN.lines('Here are the numbers.', 'The specs speak for themselves.', 'These are the best specs ever put in a phone.'), (o) => {
          const per = 2000; talk(sel.length * per + 1200); KN.say(o.text);
          sel.forEach((it, i) => KN.after(i * per, () => { KN.screen('specs', { t: it.t, v: it.v, good: it.r > 0.05 ? 1 : it.r < -0.2 ? -1 : 0 }); if (it.r > 0.3) KN.ev('react', { kind: 'applause', r: 0.2 }); else if (it.r < -0.25) KN.ev('react', { kind: 'silence', r: -0.2 }); }));
          const r = U.clamp(U.avg(sel, (x) => U.clamp(x.r, -1, 1)), -1, 1) + (sel.length >= 3 ? 0.05 : 0);
          KN.after(sel.length * per + 200, () => KN.impact(r, 'specs', o.tone)); finish(sel.length * per + 1200);
        });
      });
    },
    compare() {
      const pool = KN.rivalPool().slice().sort((a, b) => Math.abs(Math.log(a.price / p.price)) - Math.abs(Math.log(b.price / p.price))).slice(0, 4);
      if (!pool.length) { s.busy = false; return; }
      KN.ask('Compare against which rival?', pool.map((ph) => ({ text: ph.name, sub: S.rivalDef(ph.rival).name + ' · ' + U.money(ph.price), ph })), (o) => {
        KN.ask('Which charts do you show?', [{ text: 'All metrics — honest comparison', sub: 'Safe, credible', v: 'all' }, { text: 'Only the charts where we win', sub: 'Looks better… if nobody notices', v: 'cherry' }], (o2) => {
          const rv = o.ph, rs = rv.st;
          const rows = [['CPU', st.bench.single, rs.bench.single, 1], ['GPU', st.bench.gpu, rs.bench.gpu, 1], ['Battery', +st.sot.toFixed(1), +rs.sot.toFixed(1), 1], ['Camera', Math.round(st.cam.score), Math.round(rs.cam.score), 1], ['Price', p.price, rv.price, -1]];
          const wins = rows.map((x) => (x[3] > 0 ? x[1] > x[2] * 1.02 : x[1] < x[2] * 0.98));
          const losses = rows.map((x) => (x[3] > 0 ? x[1] < x[2] * 0.98 : x[1] > x[2] * 1.02));
          const shown = o2.v === 'cherry' ? rows.filter((x, i) => wins[i]) : rows;
          talk(5200); KN.say('Let\'s see how the ' + N + ' stacks up against the ' + rv.name + '.');
          KN.screen('compare', { me: N, rv: rv.name, rows: shown.map((x) => [x[0], x[1], x[2], x[3]]) });
          let r = (U.sum(wins, (w) => (w ? 1 : 0)) - U.sum(losses, (l) => (l ? 1 : 0))) / 5 * 0.9;
          if (o2.v === 'cherry') { r = Math.max(0.1, U.sum(wins, (w) => (w ? 1 : 0)) / 5); if (U.chance(0.25 + plan.press / 1500 + plan.analysts / 800)) { KN.after(3500, () => KN.say('😬 Someone shouts: “Show us the other benchmarks!”')); r -= 0.55; } }
          if (p.design.benchBoost && S.has('benchboost') && U.chance(0.15)) { KN.fail('cheat'); r = -0.9; KN.after(3800, () => KN.say('😱 A journalist points out the numbers come from Benchmark Boost mode…')); }
          KN.after(4300, () => KN.impact(U.clamp(r, -1, 1), s.failures.includes('cheat') ? 'cheat' : 'compare', 'confident')); finish(5400);
        });
      });
    },
    bench() {
      KN.ask('Run QuantaBench live', KN.lines('Let\'s see how it does.', 'Watch this.', 'Prepare to be amazed.'), (o) => {
        const boost = p.design.benchBoost && S.has('benchboost');
        const all = KN.rivalPool().map((ph) => ({ n: ph.name, v: ph.st.bench.total, price: ph.price })).concat([{ n: N, v: st.bench.total, me: 1, price: p.price }]).sort((a, b) => b.v - a.v);
        const near = all.filter((x) => x.me || Math.abs(Math.log(x.price / p.price)) < 0.45);
        const pct = 1 - near.findIndex((x) => x.me) / Math.max(1, near.length - 1);
        const rank = all.findIndex((x) => x.me);
        talk(5600); KN.say(o.text);
        const rows = all.slice(Math.max(0, rank - 2), rank + 3).map((x) => [x.n, x.v, x.me ? 1 : 0]);
        KN.screen('bench', { rows, rank: rank + 1, of: all.length });
        let r = (pct - 0.45) * 1.7 + (rank === 0 ? 0.25 : 0);
        if (boost && U.chance(0.12 + plan.analysts / 1000)) { KN.fail('cheat'); r = -0.9; KN.after(4200, () => KN.say('😱 The crowd notices the benchmark app was detected and boosted…')); }
        KN.after(4400, () => KN.impact(U.clamp(r, -1, 1), s.failures.includes('cheat') ? 'cheat' : 'bench', o.tone)); finish(5800);
      });
    },
    game() {
      const games = D.games.filter((g) => g.year <= S.year());
      KN.ask('Which game do you demo?', games.slice(-4).reverse().map((g) => ({ text: g.name, sub: g.genre + ' · ' + g.year + (g.year >= S.year() - 1 ? ' · brand new & demanding' : ''), g })), (o) => {
        KN.ask('Graphics settings', D.gfxPresets.map((pr) => ({ text: pr.name, sub: pr.id === 'ultra' ? 'Most impressive — if it holds up' : pr.id === 'low' ? 'Safe, but the crowd will notice' : '', pr })), (o2) => {
          KN.ask('What do you say?', KN.lines('Let\'s play a little.', 'Smooth as butter.', 'Max settings. ' + Math.min(p.design.disp.hz, o.g.cap) + ' FPS. Watch this.'), (o3) => {
            const res = M.gameSession(st, o.g, o2.pr, { has: S.has, hz: p.design.disp.hz, ramGB: p.design.ram.gb, minutes: 10, ambient: s.ambient });
            const series = res.samples.filter((x, i) => i % 3 === 0).map((x) => [Math.round(x.fps), +x.T.toFixed(1)]);
            talk(8200); KN.say(o3.text);
            KN.screen('game', { g: o.g.name, preset: o2.pr.name, series, over: res.overheated ? 1 : 0, hz: Math.min(p.design.disp.hz, o.g.cap) });
            const target = Math.min(p.design.disp.hz, o.g.cap);
            let r, tag = 'game';
            if (res.overheated) { r = -0.9; tag = 'overheat'; KN.fail('overheat'); KN.after(6000, () => KN.say('🔥 “Device temperature too high.” The phone shuts the game down.')); }
            else if (res.avg >= target * 0.93 && target >= 90) r = 0.9;
            else if (res.avg >= 55) r = 0.55;
            else if (res.avg >= 40) r = 0.15;
            else if (res.avg >= 28) r = -0.25;
            else { r = -0.7; tag = 'lowfps'; KN.fail('lowfps'); s.fps = Math.round(res.low); KN.after(5000, () => KN.say('😬 The frame rate drops to ' + Math.round(res.low) + ' FPS…')); }
            if (res.stutter) r -= 0.2;
            if (res.rtFallback) r -= 0.2;
            if (r > 0) r += o2.pr.id === 'ultra' ? 0.15 : o2.pr.id === 'low' ? -0.12 : 0;
            if (r > 0 && EV.find(EV.guests, plan.guest).gaming) r += 0.15;
            s.claims.fps = Math.round(res.avg);
            KN.after(7600, () => KN.impact(U.clamp(r, -1, 1), tag, o3.tone)); finish(8400);
          });
        });
      });
    },
    camera() {
      const ref = M.ref(S.fy());
      KN.ask('Camera demo', [{ text: 'Snap the audience live — in stage lighting', sub: 'Uses night performance · risky', v: 'night', live: 1 }, { text: 'Zoom into the back row live', sub: 'Uses zoom performance · risky', v: 'zoom', live: 1 }, { text: 'Show sample photos from our team', sub: 'Safe, less impressive', v: 'day', live: 0 }], (o) => {
        KN.ask('What do you say?', KN.lines('Let\'s take a quick picture.', 'This camera sees in the dark.', 'The best camera ever made. Let me prove it.'), (o2) => {
          talk(6000); KN.say(o2.text);
          const sub = st.cam[o.v];
          const refPh = M.phoneStats(M.genPhone(S.fy(), 'flagship', { tech: 1 }), S.fy(), { fy: S.fy(), has: () => true, sw: 80 }).cam[o.v];
          let r = U.clamp(1.6 * U.log2(sub / refPh) + 0.35, -1, 1) * (o.live ? 1.15 : 0.7);
          const crash = o.live && U.chance(M.crashRisk(p.design, st, S.has, plan.rehearsal));
          if (!crash) { KN.screen('camera', { score: Math.round(sub), mode: o.v }); KN.after(4200, () => KN.impact(r, 'camera', o2.tone)); finish(6000); return; }
          KN.screen('camera', { crashed: 1, mode: o.v }); KN.fail('crash');
          KN.after(1800, () => { KN.say('😳 “Camera has stopped responding.”'); KN.impact(-0.45, 'crash', 'confident');
            KN.after(1500, () => KN.ask('The camera app crashed live! What now?', [{ text: '😄 Make a joke about it', sub: 'Charm your way out', v: 'joke' }, { text: '🔁 Try again', sub: 'Could work…', v: 'retry' }, { text: '➡️ Move on quickly', v: 'move' }], (o3) => {
              if (o3.v === 'joke') { const ok = U.chance(0.6); KN.say(ok ? '“Well… at least you know it\'s live!” 😄' : '“Uh… that\'s a feature.” (nobody laughs)'); KN.after(1200, () => KN.impact(ok ? 0.3 : -0.2, 'joke', 'humble')); finish(2400); }
              else if (o3.v === 'retry') { const ok = U.chance(0.55); KN.say('Let\'s try that again…'); KN.after(1500, () => { if (ok) { KN.screen('camera', { score: Math.round(sub), mode: o.v }); KN.after(1800, () => KN.impact(r * 0.6, 'camera', 'humble')); } else { KN.screen('camera', { crashed: 1, mode: o.v }); KN.after(800, () => KN.impact(-0.6, 'crash', 'confident')); } }); finish(4200); }
              else { KN.say('Moving on!'); KN.screen('logo'); finish(1200); }
            }));
          });
        });
      });
    },
    battery() {
      const pool = KN.rivalPool().map((ph) => ph.st.sot).sort((a, b) => a - b);
      const med = pool[Math.floor(pool.length / 2)] || 6, best = pool[pool.length - 1] || 8;
      KN.ask('What do you claim?', [{ text: '“It easily lasts all day.”', v: med, tone: 'humble' }, { text: '“Two full days on a charge.”', v: med * 1.6, tone: 'confident' }, { text: '“The longest battery life of any phone. Ever.”', v: best * 1.02, tone: 'hype' }], (o) => {
        const rows = KN.rivalPool().slice().sort((a, b) => b.st.sot - a.st.sot).slice(0, 3).map((ph) => [ph.name, +ph.st.sot.toFixed(1), 0]).concat([[N, +st.sot.toFixed(1), 1]]).sort((a, b) => b[1] - a[1]);
        talk(5200); KN.say(o.text); KN.screen('battery', { rows, claim: o.text });
        s.claims.battery = +o.v.toFixed(1);
        const truthful = st.sot >= o.v * 0.97;
        let r = (KN.sk('battery') - 0.9) * 2.4 + (truthful ? 0.12 : 0.05);
        KN.after(4200, () => KN.impact(U.clamp(r, -1, 1), 'battery', o.tone)); finish(5400);
      });
    },
    trailer() {
      const tq = EV.find(EV.trailers, plan.trailer).q;
      talk(7000); KN.ev('lights', { v: 0.25 }); KN.say('Roll the film.');
      KN.screen('trailer', { q: tq, tag: U.pick(['Built different.', 'Power. Redefined.', 'See more. Do more.', 'The future fits in your pocket.']) });
      if (plan.fx.includes('drones')) KN.ev('fx', { fx: 'drones' });
      KN.after(6400, () => { KN.ev('lights', { v: 1 }); KN.impact(tq * 0.8 - 0.1 + (EV.find(EV.guests, plan.guest).trailer ? 0.12 : 0), 'trailer', 'confident'); }); finish(7200);
    },
    guest() {
      const g = EV.find(EV.guests, plan.guest);
      talk(6000); KN.say('Please welcome… ' + g.name + '!'); KN.screen('guest', { name: g.name }); KN.ev('guest', { on: 1 });
      const awk = U.chance(0.06);
      KN.after(2500, () => KN.impact(awk ? -0.3 : g.p + (plan.guest === 'popstar' ? 0.2 : 0), awk ? 'awkward' : 'guest', 'confident'));
      if (awk) { KN.fail('awkward'); KN.after(3000, () => KN.say('😬 The guest forgets your company\'s name…')); }
      KN.after(5600, () => KN.ev('guest', { on: 0 })); finish(6000);
    },
    price() {
      KN.askPrice((price, avail, tone) => {
        s.priceFinal = price; s.avail = avail;
        talk(4600); KN.say(tone === 'hype' ? 'And the best part? ' + U.money(price) + '.' : 'The ' + N + ' starts at ' + U.money(price) + '.');
        KN.screen('price', { price, avail: avail ? 'Preorder today · ships ' + U.dateStr(G.t + avail) : 'Available today' });
        const pst = S.stats(p); const fair = S.fairPrice(pst.qual.q);
        let r = U.log2(fair / price) * 1.7 + 0.12 - (s.done.reveal ? 0 : 0.3) + (!avail && (G.inventory[p.id] || 0) > 0 ? 0.1 : 0) - (avail >= 2 ? 0.06 : 0);
        s.priceReaction = r;
        KN.after(2600, () => KN.impact(U.clamp(r, -1, 1), 'price', tone)); finish(4600);
      });
    },
    onemore() {
      const ex = s.extra; let label = '', r = 0.4;
      if (ex.kind === 'phone') { const ep = S.phoneById(ex.id); label = ep ? ep.name : 'Another phone'; if (ep) r = (S.stats(ep).qual.q - 55) / 40; }
      else if (ex.kind === 'chip') { const c = S.chipById(ex.id); label = (c ? c.name : 'Our chip') + ' — designed in-house'; r = 0.55 + (G.chips.filter((x) => x.revealed).length ? 0 : 0.2); }
      else { label = G.co.name.split(' ')[0] + ' OS — our own operating system'; r = 0.5; }
      talk(6800); KN.ev('lights', { v: 0.2 }); KN.say('Oh… and one more thing.'); KN.screen('onemore', { label });
      KN.after(2600, () => { KN.ev('lights', { v: 1 }); SFX.boom(); });
      KN.after(3600, () => KN.impact(U.clamp(r * 1.2, -1, 1), 'onemore', 'confident')); finish(6800);
    },
    close() {
      KN.ask('Closing words', KN.lines('Thank you so much for being here.', 'Thank you — and see you next year!', 'This is just the beginning. Thank you!'), (o) => {
        talk(4600); KN.say(o.text); KN.screen('thanks');
        if (plan.fx.includes('confetti')) KN.ev('fx', { fx: 'confetti' });
        if (plan.fx.includes('pyro')) KN.ev('fx', { fx: 'pyro' });
        if (plan.fx.includes('drones')) KN.ev('fx', { fx: 'drones' });
        const r = 0.1 + (plan.fx.includes('confetti') ? 0.12 : 0) + (s.mood - 50) / 200;
        KN.after(2400, () => KN.impact(r, 'close', o.tone));
        KN.after(4800, () => KN.end());
      });
    },
  };
  F[id]();
};
KN.askMulti = (title, items, max, cb) => {
  const s = KN.s; s.choice = true; const box = $('#kChoice'); const sel = new Set();
  const draw = () => {
    box.innerHTML = '<div class="box"><div class="kPanel" style="font-weight:800">' + title + ' <span class="tiny" style="opacity:.6">(' + sel.size + '/' + max + ')</span></div>' + items.map((it, i) => '<button class="opt" data-i="' + i + '" style="' + (sel.has(i) ? 'border-color:#3ee6ff;background:rgba(62,230,255,.15)' : '') + '">' + it.t + ' <span class="tiny" style="opacity:.7">— ' + U.esc(it.v) + '</span></button>').join('') + '<button class="btn pri full mt12" id="kMultiOk" ' + (sel.size ? '' : 'disabled') + '>Present these</button></div>';
    box.querySelectorAll('.opt').forEach((b) => (b.onclick = () => { const i = +b.dataset.i; if (sel.has(i)) sel.delete(i); else if (sel.size < max) sel.add(i); draw(); }));
    const ok = $('#kMultiOk'); if (ok) ok.onclick = () => { box.classList.remove('on'); box.innerHTML = ''; s.choice = false; KN.last = performance.now(); cb([...sel].map((i) => items[i])); };
  };
  box.classList.add('on'); draw();
};
KN.askPrice = (cb) => {
  const s = KN.s, p = S.phoneById(s.phoneId); s.choice = true; const box = $('#kChoice');
  let price = p.price, avail = s.plan.avail || 0;
  const st = S.stats(p), fair = S.fairPrice(st.qual.q);
  const draw = () => {
    box.innerHTML = '<div class="box"><div class="kPanel"><b>Final price & availability</b><div class="tiny" style="opacity:.7">Unit cost ' + U.money(st.bom) + ' · planned ' + U.money(p.price) + '</div>' +
      '<div style="font-size:30px;font-weight:900;text-align:center;margin:8px 0" id="kPv">' + U.money(price) + '</div><input type="range" id="kPr" min="' + Math.round(p.price * 0.75) + '" max="' + Math.round(p.price * 1.25) + '" step="10" value="' + price + '">' +
      '<div class="seg mt8">' + [[0, 'Available today'], [1, 'Ships next month'], [2, 'Ships in 2 months']].map(([v, n]) => '<button class="' + (avail === v ? 'on' : '') + '" data-av="' + v + '">' + n + '</button>').join('') + '</div><div class="tiny mt8" style="opacity:.7">In stock: ' + U.num(G.inventory[p.id] || 0) + '. Preorders let you build stock — but momentum fades.</div></div>' +
      KN.lines('', '', '').map((o) => '<button class="opt" data-t="' + o.tone + '"><div class="tone">' + KN.TONES[o.tone].label + '</div>' + (o.tone === 'humble' ? 'Announce it plainly' : o.tone === 'confident' ? 'Announce it proudly' : 'Build it up before the reveal') + '</button>').join('') + '</div>';
    $('#kPr').oninput = (e) => { price = Math.round(+e.target.value / 10) * 10 - 1; $('#kPv').textContent = U.money(price); };
    box.querySelectorAll('[data-av]').forEach((b) => (b.onclick = () => { avail = +b.dataset.av; draw(); }));
    box.querySelectorAll('.opt').forEach((b) => (b.onclick = () => { box.classList.remove('on'); box.innerHTML = ''; s.choice = false; KN.last = performance.now(); cb(price, avail, b.dataset.t); }));
  };
  box.classList.add('on'); draw();
};

/* ---------------- end of event ---------------- */
UI.A.kEnd = () => {
  const s = KN.s; if (!s) return;
  if (s.mode === 'replay') { KN.teardown(); UI.render(); return; }
  if (s.ended || s.busy || s.choice) return;
  KN.ask('End the event now?', [{ text: '⏹ Yes, wrap it up', v: 1 }, { text: '↩️ No, keep presenting', v: 0 }], (o) => { if (o.v) KN.end(); });
};
KN.end = () => {
  const s = KN.s; if (s.ended) return;
  s.ended = true; s.busy = true; KN.updateActions();
  if (!s.done.reveal) { s.mood -= 12; s.failures.push('noreveal'); }
  const avgImp = U.avg(s.impacts, (x) => x.r);
  const segs = Object.keys(s.done).length;
  const over = Math.max(0, s.clock - s.plan.duration);
  const score = U.clamp(0.58 * s.mood + 0.22 * s.peak + 18 * avgImp + 2 * Math.min(6, segs) - 5 * s.failures.filter((f) => f !== 'noreveal').length - over * 0.3 - (s.failures.includes('noreveal') ? 15 : 0), 0, 100);
  s.rec.frames.push(KN.frame());
  const res = { id: s.id, plan: s.plan, score, failures: s.failures.filter((f) => f !== 'noreveal'), claims: s.claims, priceFinal: s.priceFinal, avail: s.avail, priceReaction: s.priceReaction, fps: s.fps, extra: s.extra && s.done.onemore ? s.extra : null,
    replay: { plan: s.plan, look: s.look, frames: s.rec.frames, events: s.rec.events, dur: Math.round(s.real), coName: G.co.name, logo: G.co.logo } };
  const ev = EV.apply(res);
  const box = $('#kChoice'); s.choice = true;
  box.innerHTML = '<div class="box"><div class="kPanel"><div style="text-align:center"><div class="tiny" style="letter-spacing:2px;opacity:.6">EVENT OVER</div><div style="font-size:44px;font-weight:900;color:' + MED.scoreColor(score / 10) + '">' + score.toFixed(0) + '<span style="font-size:18px;opacity:.6">/100</span></div><div>' + U.esc(ev.summary) + '</div></div>' +
    '<div class="grid2 mt12"><div class="kpi"><div class="l">Crowd mood</div><div class="v">' + s.mood.toFixed(0) + '</div></div><div class="kpi"><div class="l">Peak</div><div class="v">' + s.peak.toFixed(0) + '</div></div><div class="kpi"><div class="l">Watched live</div><div class="v">' + U.num(ev.viewers) + '</div></div><div class="kpi"><div class="l">Preorders</div><div class="v">' + U.num(ev.preorders) + '</div></div></div>' +
    (ev.headlines || []).map((h) => '<div class="headline mt12" style="font-size:15px">' + U.esc(h.text) + ' <span class="tiny mute">— ' + h.outlet + '</span></div>').join('') + '</div>' +
    '<button class="opt" id="kGoMedia">📰 See the reviews & reactions</button><button class="opt" id="kGoReplay">▶ Watch the replay</button><button class="opt" id="kGoExit">🏢 Back to HQ</button></div>';
  box.classList.add('on');
  $('#kGoMedia').onclick = () => { KN.teardown(); UI.tab = 'launch'; UI.render(); MED.tab = 'news'; MED.show(S.phoneById(ev.phoneId), ev.id); };
  $('#kGoReplay').onclick = () => { KN.teardown(); KN.replay(ev); };
  $('#kGoExit').onclick = () => { KN.teardown(); UI.tab = 'hq'; UI.render(true); };
};

/* ---------------- replay ---------------- */
KN.replay = (ev) => {
  const rp = ev.replay;
  const c = KN.common(rp.plan, rp.look);
  c.logo = rp.logo || G.co.logo; c.coName = rp.coName || G.co.name;
  KN.s = Object.assign(c, { mode: 'replay', rec: { frames: rp.frames, events: rp.events }, real: 0, dur: rp.dur, playing: true, speed: 1, camX: 0, q: [], evName: ev.name });
  KN.active = true;
  KN.buildDOM();
  $('#kJoy').classList.add('hidden'); $('#kActions').innerHTML = '';
  $('#kEnd').textContent = '✕ Close';
  const bar = $('#kReplayBar'); bar.classList.remove('hidden');
  bar.innerHTML = '<button class="btn sm" data-a="kPlay" id="kPlayB">⏸</button><input type="range" id="kScrub" min="0" max="' + rp.dur + '" value="0" step="100"><button class="btn sm" data-a="kSpeed" id="kSpd">1×</button>';
  $('#kScrub').oninput = (e) => { KN.s.real = +e.target.value; KN.renderFeed(); };
  KN.last = performance.now(); KN.loop();
};
UI.A.kPlay = () => { const s = KN.s; if (!s) return; if (s.real >= s.dur) s.real = 0; s.playing = !s.playing; $('#kPlayB').textContent = s.playing ? '⏸' : '▶'; };
UI.A.kSpeed = () => { const s = KN.s; s.speed = s.speed === 1 ? 2 : s.speed === 2 ? 4 : 1; $('#kSpd').textContent = s.speed + '×'; };

/* ---------------- main loop ---------------- */
KN.frame = () => { const s = KN.s, p = s.pres; return [Math.round(s.real), +p.x.toFixed(2), +p.z.toFixed(2), p.dir, p.walk ? 1 : 0, p.talk, Math.round(s.mood), +s.clock.toFixed(1)]; };
KN.hud = (mood, clock, dur) => {
  const m = $('#kMood i'); if (m) { m.style.width = mood + '%'; m.style.background = mood > 66 ? '#3ddc84' : mood > 40 ? '#ffb648' : '#ff4d6a'; $('#kMoodV').textContent = Math.round(mood); }
  const tm = $('#kTime i'); if (tm) { tm.style.width = Math.min(100, clock / dur * 100) + '%'; tm.style.background = clock > dur ? '#ff4d6a' : ''; $('#kClock').textContent = Math.floor(clock) + '/' + dur + 'm'; }
};
KN.loop = () => {
  if (!KN.active) return;
  const now = performance.now(); let dt = Math.min(0.05, (now - KN.last) / 1000); KN.last = now;
  const s = KN.s;
  if (s.mode === 'live') { if (!s.choice) KN.update(dt); }
  else if (s.playing) { s.real = Math.min(s.dur, s.real + dt * 1000 * s.speed); if (s.real >= s.dur) { s.playing = false; $('#kPlayB').textContent = '▶'; } const sc = $('#kScrub'); if (sc) sc.value = s.real; if (Math.floor(s.real / 300) !== s._fp) { s._fp = Math.floor(s.real / 300); KN.renderFeed(); } }
  try { KN.draw(KN.view()); } catch (e) { console.error(e); }
  KN.raf = requestAnimationFrame(KN.loop);
};
KN.update = (dt) => {
  const s = KN.s, p = s.pres;
  s.real += dt * 1000;
  // timed actions
  const due = s.q.filter((x) => x.at <= s.real); s.q = s.q.filter((x) => x.at > s.real); due.forEach((x) => x.fn());
  // movement
  let mx = KN.joy.x, mz = -KN.joy.y;
  const k = KN.keys;
  if (k.arrowleft || k.a) mx = -1; if (k.arrowright || k.d) mx = 1; if (k.arrowup || k.w) mz = 1; if (k.arrowdown || k.s) mz = -1;
  if (s.target && !s.busy) { const dx = s.target[0] - p.x, dz = s.target[1] - p.z, m = Math.hypot(dx, dz); if (m < 0.15) s.target = null; else { mx = dx / m; mz = dz / m; } }
  const moving = !s.busy && !s.ended && (Math.abs(mx) > 0.08 || Math.abs(mz) > 0.08);
  if (moving) {
    const sp = 2.6, m = Math.max(1, Math.hypot(mx, mz));
    p.x += mx / m * sp * dt; p.z += mz / m * sp * dt * 0.8;
    const thrust = s.plan.arch === 'thrust';
    p.x = U.clamp(p.x, -s.W / 2 + 0.6, s.W / 2 - 0.6);
    p.z = U.clamp(p.z, thrust && Math.abs(p.x) < 1 ? -2.6 : 0.45, s.Dd - 0.6);
    if (Math.abs(mx) > 0.1) p.dir = mx > 0 ? 1 : -1;
    p.phase += dt * 9;
  }
  p.walk = moving ? 1 : 0;
  // world clock
  if (s.segClock && s.real < s.segClock.until) { const rate = s.segClock.left / ((s.segClock.until - s.real) / 1000 + 0.001); const adv = Math.min(s.segClock.left, rate * dt); s.clock += adv; s.segClock.left -= adv; }
  else if (!s.busy && !s.ended) {
    s.clock += dt / 1.4;
    if (s.clock - s.lastSeg > 3) { s.mood = Math.max(0, s.mood - dt / 1.4 * 0.7); if (!s._restless) { s._restless = 1; KN.say('😴 The audience is getting restless… present something!'); } } else s._restless = 0;
  }
  if (s.clock > s.plan.duration) { s.mood = Math.max(0, s.mood - dt / 1.4 * 1.2); if (!s._over) { s._over = 1; KN.say('⌚ You\'re over time — people are checking their watches.'); } if (s.clock > s.plan.duration * 1.5 && !s.ended && !s.busy) { KN.say('🚪 People start leaving. The event is over.'); KN.end(); } }
  // record
  if (s.real - s.lastFrame >= 100) { s.lastFrame = s.real; s.rec.frames.push(KN.frame()); }
  // HUD
  KN.hud(s.mood, s.clock, s.plan.duration);
  const spot = KN.nearSpot();
  if (spot !== s._spot) { s._spot = spot; KN.updateActions(); }
};
KN.nearSpot = () => { const s = KN.s, p = s.pres; let best = null, bd = 1.4; Object.keys(s.spots).forEach((k) => { const [x, z] = s.spots[k]; const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = k; } }); return best; };
KN.updateActions = () => {
  const s = KN.s; if (!s || s.mode !== 'live') return;
  const el = $('#kActions'), hint = $('#kHint');
  if (s.ended) { el.innerHTML = ''; hint.classList.add('hidden'); return; }
  if (s.busy) { el.innerHTML = ''; hint.textContent = '🎙️ Presenting…'; hint.classList.remove('hidden'); return; }
  const spot = s._spot;
  const avail = (sp) => Object.keys(KN.SEG).filter((id) => KN.SEG[id].spot === sp && !s.done[id] && (!KN.SEG[id].cond || KN.SEG[id].cond(s)));
  let html = '';
  if (spot) {
    const ids = avail(spot);
    hint.textContent = '📍 ' + KN.SPOTNAME[spot] + (ids.length ? ' — choose what to present' : ' — nothing left to do here');
    html = ids.map((id, i) => '<button class="btn ' + (i === 0 ? 'pri' : '') + '" data-a="kSeg" data-v="' + id + '">' + KN.SEG[id].name + '</button>').join('');
  } else {
    hint.textContent = '🚶 Walk to a glowing spot (joystick, arrows/WASD or tap the stage)';
    html = Object.keys(s.spots).filter((sp) => avail(sp).length).map((sp) => '<button class="btn sm" data-a="kGoto" data-v="' + sp + '">→ ' + KN.SPOTNAME[sp] + ' (' + avail(sp).length + ')</button>').join('');
  }
  hint.classList.remove('hidden');
  el.innerHTML = html;
};
UI.A.kSeg = (el) => KN.run(el.dataset.v);
UI.A.kGoto = (el) => { const s = KN.s; s.target = s.spots[el.dataset.v].slice(); };
KN.tapWalk = (e) => {
  const s = KN.s; if (!s || s.mode !== 'live' || s.busy || s.choice || s.ended) return;
  const P = KN.proj; if (!P) return;
  const sy = e.clientY, sx = e.clientX;
  if (sy <= P.hy + 2) return;
  const dz = P.f * (P.camY - 1.1) / (sy - P.hy);
  const Z = P.camZ + dz, X = P.camX + (sx - P.cx) * dz / P.f;
  if (Z < -3 || Z > s.Dd + 1) return;
  s.target = [U.clamp(X, -s.W / 2 + 0.6, s.W / 2 - 0.6), U.clamp(Z, 0.45, s.Dd - 0.6)];
};
KN.renderFeed = () => {
  const s = KN.s; const el = $('#kFeed'); if (!el || !s) return;
  const posts = s.rec.events.filter((e) => e.e === 'post' && e.t <= s.real).slice(-5);
  el.innerHTML = posts.map((p) => '<div class="post"><b>@' + U.esc(p.u) + '</b> ' + U.esc(p.m) + '</div>').join('');
};

/* ---------------- view state (shared by live & replay) ---------------- */
KN.view = () => {
  const s = KN.s, t = s.real, evs = s.rec.events;
  let pres;
  if (s.mode === 'live') pres = s.pres;
  else {
    const fr = s.rec.frames; let lo = 0, hi = fr.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fr[mid][0] <= t) lo = mid; else hi = mid - 1; }
    const a = fr[lo] || [0, 0, s.Dd / 2, 1, 0, 0, 50], b = fr[Math.min(fr.length - 1, lo + 1)] || a;
    const k = b[0] > a[0] ? U.clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 0;
    pres = { x: U.lerp(a[1], b[1], k), z: U.lerp(a[2], b[2], k), dir: a[3], walk: a[4], talk: a[5], phase: t / 1000 * 9 };
    s.mood = a[6]; KN.hud(a[6], a[7] || 0, s.plan.duration);
  }
  let screen = { kind: 'logo', data: {}, t: 0 }, react = null, cap = null, lights = 1, lightT = 0, guest = 0;
  const fx = [];
  for (const e of evs) {
    if (e.t > t) break;
    if (e.e === 'screen') screen = e;
    else if (e.e === 'react') react = e;
    else if (e.e === 'cap') cap = e;
    else if (e.e === 'lights') { lights = e.v; lightT = e.t; }
    else if (e.e === 'fx') fx.push(e);
    else if (e.e === 'guest') guest = e.on;
  }
  const capEl = $('#kCaption');
  if (capEl) { const show = cap && t - cap.t < 4800; capEl.style.opacity = show ? 1 : 0; if (show && capEl._t !== cap.t) { capEl._t = cap.t; capEl.textContent = cap.text; } }
  return { t, pres, screen, react, lights, lightT, fx, guest, mood: s.mood };
};

/* ---------------- renderer ---------------- */
KN.draw = (v) => {
  const s = KN.s, x = KN.x, dpr = KN.dpr || 1;
  const W = KN.cv.width / dpr, Hh = KN.cv.height / dpr;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const t = v.t / 1000;
  // camera
  const f = Math.min(W * 1.32, Hh * 0.95);
  const camZ = -8.2 - (s.Dd - 5.5) * 0.45 - (W > Hh ? 1 : 0), camY = 3.2;
  const targetX = U.clamp(v.pres.x * 0.55, -s.W / 2 + 2, s.W / 2 - 2);
  s.camX = s.mode === 'live' ? U.lerp(s.camX, targetX, 0.06) : targetX;
  const cx = W / 2, hy = Hh * (W > Hh ? 0.48 : 0.4);
  const P = (X, Y, Z) => { const dz = Math.max(0.3, Z - camZ); return [cx + f * (X - s.camX) / dz, hy - f * (Y - camY) / dz, f / dz]; };
  KN.proj = { f, camZ, camY, camX: s.camX, cx, hy };
  // light level with smooth transitions
  const lt = U.clamp((v.t - v.lightT) / 900, 0, 1);
  const prevL = v.lights === 1 ? 0 : 1;
  const L = U.lerp(prevL, v.lights, lt);
  const amb = 0.25 + 0.75 * L;
  // --- background
  const ven = s.venue;
  const bgG = x.createLinearGradient(0, 0, 0, Hh);
  if (ven.kind === 'stadium') { bgG.addColorStop(0, '#02030a'); bgG.addColorStop(0.5, '#0b1530'); bgG.addColorStop(1, '#05070c'); }
  else if (ven.kind === 'garage') { bgG.addColorStop(0, '#1a110c'); bgG.addColorStop(1, '#0a0705'); }
  else { bgG.addColorStop(0, R.shade(ven.wall, 0.6)); bgG.addColorStop(0.6, ven.wall); bgG.addColorStop(1, '#030407'); }
  x.fillStyle = bgG; x.fillRect(0, 0, W, Hh);
  KN.drawVenue(x, P, s, t, amb, W, Hh, hy);
  // --- giant screen
  const sw = Math.min(s.W * 0.78, 4 + s.W * 0.55), sh = sw * 9 / 16, sz = s.Dd + 0.35, sy0 = 2.3;
  const [x0, y0] = P(-sw / 2, sy0 + sh, sz), [x1, y1] = P(sw / 2, sy0, sz);
  x.fillStyle = '#000'; x.fillRect(x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12);
  x.save(); x.beginPath(); x.rect(x0, y0, x1 - x0, y1 - y0); x.clip();
  KN.drawScreen(x, x0, y0, x1 - x0, y1 - y0, v.screen, v.t - v.screen.t, s);
  x.restore();
  x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 2; x.strokeRect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6);
  // screen glow on stage
  x.save(); x.globalCompositeOperation = 'lighter'; const gg = x.createRadialGradient((x0 + x1) / 2, y1, 10, (x0 + x1) / 2, y1, (x1 - x0) * 0.9); gg.addColorStop(0, 'rgba(120,160,255,0.10)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gg; x.fillRect(0, 0, W, Hh); x.restore();
  // --- stage
  KN.drawStage(x, P, s, t, amb);
  // hotspots
  if (s.mode === 'live' && !s.ended) Object.keys(s.spots).forEach((k) => {
    const [hx, hz] = s.spots[k];
    const avail = Object.keys(KN.SEG).some((id) => KN.SEG[id].spot === k && !s.done[id] && (!KN.SEG[id].cond || KN.SEG[id].cond(s)));
    const [px, py, sc] = P(hx, 1.11, hz);
    const pulse = 0.6 + 0.4 * Math.sin(t * 4 + hx);
    x.save(); x.globalCompositeOperation = 'lighter'; x.beginPath(); x.ellipse(px, py, sc * 0.75, sc * 0.2, 0, 0, 7); x.fillStyle = avail ? 'rgba(62,230,255,' + 0.22 * pulse + ')' : 'rgba(255,255,255,0.05)'; x.fill(); x.strokeStyle = avail ? 'rgba(62,230,255,' + 0.7 * pulse + ')' : 'rgba(255,255,255,0.12)'; x.lineWidth = 2; x.stroke(); x.restore();
    if (avail) { x.fillStyle = 'rgba(190,245,255,0.9)'; x.font = '700 ' + Math.max(9, sc * 0.18) + 'px sans-serif'; x.textAlign = 'center'; x.fillText(KN.SPOTNAME[k].toUpperCase(), px, k === 'screen' ? py - sc * 0.3 : py + sc * 0.42); }
  });
  // props + presenter + guest + audience sorted by depth
  const items = [];
  const [dx, dz] = s.spots.demo, [pdx, pdz] = s.spots.podium;
  items.push({ z: dz + 0.35, f: () => KN.drawTable(x, P, dx, dz + 0.35, s) });
  items.push({ z: pdz + 0.3, f: () => KN.drawPodium(x, P, pdx + 0.5, pdz + 0.3) });
  items.push({ z: v.pres.z, f: () => KN.drawPerson(x, P, v.pres, s.skin, s.outfit, s.look.color, t, 1) });
  if (v.guest) items.push({ z: 1.6, f: () => KN.drawPerson(x, P, { x: v.pres.x + 1.4, z: 1.6, dir: -1, walk: 0, talk: 1, phase: 0 }, '#c8956b', { c: '#7a1f3d', l: '#2a1520' }, '#7a1f3d', t, 0.97) });
  s.rows.forEach((row, ri) => items.push({ z: row.z, f: () => KN.drawRow(x, P, row, ri, v, t, amb) }));
  items.sort((a, b) => b.z - a.z).forEach((it) => it.f());
  // light beams (additive, over everything but audience heads already drawn)
  KN.drawBeams(x, P, s, v, t, L);
  // fx particles
  KN.drawFx(x, P, s, v, t, W, Hh);
  // reaction emojis
  if (v.react) KN.drawEmojis(x, v.react, (v.t - v.react.t) / 1000, W, Hh);
  // darkness overlay for lights out
  if (L < 1) { x.fillStyle = 'rgba(0,0,0,' + (0.62 * (1 - L)) + ')'; x.fillRect(0, 0, W, Math.max(y0 - 8, 0)); x.fillRect(0, y1 + 8, W, Hh); x.fillRect(0, y0 - 8, Math.max(0, x0 - 8), y1 - y0 + 16); x.fillRect(x1 + 8, y0 - 8, W, y1 - y0 + 16); }
  // vignette
  const vg = x.createRadialGradient(W / 2, Hh * 0.45, Math.min(W, Hh) * 0.3, W / 2, Hh / 2, Math.max(W, Hh) * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)'); x.fillStyle = vg; x.fillRect(0, 0, W, Hh);
  if (s.mode === 'replay') { x.fillStyle = 'rgba(255,60,80,0.9)'; x.font = '800 12px sans-serif'; x.textAlign = 'left'; x.fillText('● REPLAY · ' + (s.evName || ''), 12, Hh - 70); }
};
KN.drawVenue = (x, P, s, t, amb, W, Hh, hy) => {
  const k = s.venue.kind;
  if (k === 'garage') {
    // brick wall
    const [wx0, wy0] = P(-s.W, 9, s.Dd + 0.6), [wx1, wy1] = P(s.W, 0, s.Dd + 0.6);
    x.fillStyle = '#4a2c20'; x.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
    x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 1;
    for (let yy = wy0; yy < wy1; yy += 9) { x.beginPath(); x.moveTo(wx0, yy); x.lineTo(wx1, yy); x.stroke(); for (let xx = wx0 + ((yy / 9) % 2) * 9; xx < wx1; xx += 18) { x.beginPath(); x.moveTo(xx, yy); x.lineTo(xx, yy + 9); x.stroke(); } }
  } else if (k === 'stadium' || k === 'arena' || k === 'sphere') {
    // tiered stands with phone lights
    const rng = U.srng(s.seed);
    for (let i = 0; i < 6; i++) { const z = s.Dd + 4 + i * 3, y = 3 + i * 2.2; const [ax, ay] = P(-60, y, z), [bx] = P(60, y, z); x.fillStyle = 'rgba(30,40,70,' + (0.35 - i * 0.04) + ')'; x.fillRect(ax, ay, bx - ax, 3 + i); }
    x.save(); x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 260; i++) { const xx = rng() * W, yy = hy * (0.15 + rng() * 0.75); const tw = 0.5 + 0.5 * Math.sin(t * (1 + rng() * 3) + i); x.fillStyle = 'rgba(255,240,200,' + (0.15 + 0.35 * tw) * (KN.s.mood / 100) + ')'; x.fillRect(xx, yy, 1.6, 1.6); }
    x.restore();
    if (k === 'sphere') { x.save(); x.globalCompositeOperation = 'lighter'; const g = x.createRadialGradient(W / 2, hy * 0.2, 10, W / 2, hy * 0.2, W); g.addColorStop(0, 'hsla(' + ((t * 20) % 360) + ',90%,60%,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, W, hy * 1.2); x.restore(); }
  } else if (k === 'theater') {
    const [ax, ay] = P(-s.W / 2 - 2.5, 9, s.Dd + 0.4), [bx, by] = P(-s.W / 2 - 0.3, 0, 0.2);
    const [cx2] = P(s.W / 2 + 0.3, 9, s.Dd + 0.4), [dx2] = P(s.W / 2 + 2.5, 0, 0.2);
    x.fillStyle = '#5a0f18'; x.fillRect(ax, ay, bx - ax, by - ay); x.fillRect(cx2, ay, dx2 - cx2, by - ay);
    x.fillStyle = 'rgba(255,200,120,0.25)'; for (let i = 0; i < 10; i++) { x.fillRect(ax + (bx - ax) * i / 10, ay, 2, by - ay); x.fillRect(cx2 + (dx2 - cx2) * i / 10, ay, 2, by - ay); }
  } else {
    // hall: trusses
    x.strokeStyle = 'rgba(120,130,150,0.35)'; x.lineWidth = 2;
    [-1, 1].forEach((side) => { const [a, b] = P(side * (s.W / 2 + 0.8), 9, s.Dd), [c, d] = P(side * (s.W / 2 + 0.8), 0, s.Dd); x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke(); });
    const [a, b] = P(-s.W / 2 - 1, 8.2, s.Dd - 1), [c] = P(s.W / 2 + 1, 8.2, s.Dd - 1); x.beginPath(); x.moveTo(a, b); x.lineTo(c, b); x.stroke();
  }
};
KN.drawStage = (x, P, s, t, amb) => {
  const W = s.W, D = s.Dd, top = 1.1;
  const quad = (pts, fill) => { x.beginPath(); pts.forEach(([X, Y, Z], i) => { const [px, py] = P(X, Y, Z); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath(); x.fillStyle = fill; x.fill(); };
  const c = R.shade('#1d2333', 0.6 + amb * 0.6);
  quad([[-W / 2, top, 0], [W / 2, top, 0], [W / 2, top, D], [-W / 2, top, D]], c);
  // floor reflection stripe
  const [ax, ay] = P(0, top, D * 0.5); const g = x.createRadialGradient(ax, ay, 4, ax, ay, 260); g.addColorStop(0, 'rgba(120,160,255,' + 0.12 * amb + ')'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fill();
  quad([[-W / 2, 0, 0], [W / 2, 0, 0], [W / 2, top, 0], [-W / 2, top, 0]], '#0b0e16');
  // LED edge
  const [l0x, l0y] = P(-W / 2, top, 0), [l1x] = P(W / 2, top, 0);
  x.fillStyle = 'hsla(' + ((t * 30) % 360) + ',80%,60%,' + (0.35 + 0.3 * amb) + ')'; x.fillRect(l0x, l0y - 1, l1x - l0x, 3);
  if (s.plan.arch === 'thrust') { quad([[-1, top, -2.8], [1, top, -2.8], [1, top, 0], [-1, top, 0]], R.shade('#1d2333', 0.7 + amb * 0.5)); quad([[-1, 0, -2.8], [1, 0, -2.8], [1, top, -2.8], [-1, top, -2.8]], '#0b0e16'); }
  if (s.plan.arch === 'tiered') { quad([[-W / 2, top + 0.4, D - 2], [W / 2, top + 0.4, D - 2], [W / 2, top + 0.4, D], [-W / 2, top + 0.4, D]], R.shade('#252c40', 0.6 + amb * 0.6)); quad([[-W / 2, top, D - 2], [W / 2, top, D - 2], [W / 2, top + 0.4, D - 2], [-W / 2, top + 0.4, D - 2]], '#10131c'); }
  if (s.plan.arch === 'round') { const [cx2, cy2, sc] = P(0, top, D / 2); x.beginPath(); x.ellipse(cx2, cy2, sc * W * 0.42, sc * D * 0.12, 0, 0, 7); x.strokeStyle = 'rgba(62,230,255,0.4)'; x.lineWidth = 2; x.stroke(); }
  if (s.plan.arch === 'cube') { x.strokeStyle = 'hsla(' + ((t * 40) % 360) + ',90%,65%,0.7)'; x.lineWidth = 2; const c3 = [[-2.5, top + 4, 1.5], [2.5, top + 4, 1.5], [2.5, top + 4, 4], [-2.5, top + 4, 4]]; x.beginPath(); c3.forEach(([X, Y, Z], i) => { const [px, py] = P(X, Y, Z); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath(); x.stroke(); c3.forEach(([X, Y, Z]) => { const [a1, b1] = P(X, Y, Z), [a2, b2] = P(X, Y + 1.5, Z); x.beginPath(); x.moveTo(a1, b1); x.lineTo(a2, b2); x.stroke(); }); }
};
KN.drawTable = (x, P, X, Z, s) => {
  const [a, b, sc] = P(X, 1.1, Z);
  x.fillStyle = '#2a3142'; x.fillRect(a - sc * 0.6, b - sc * 0.95, sc * 1.2, sc * 0.95);
  x.fillStyle = '#3d4760'; x.fillRect(a - sc * 0.66, b - sc * 1.0, sc * 1.32, sc * 0.08);
  x.fillStyle = s.look.color; x.fillRect(a - sc * 0.1, b - sc * 1.22, sc * 0.2, sc * 0.22);
  x.fillStyle = 'rgba(62,230,255,0.6)'; x.fillRect(a - sc * 0.08, b - sc * 1.2, sc * 0.16, sc * 0.18);
};
KN.drawPodium = (x, P, X, Z) => { const [a, b, sc] = P(X, 1.1, Z); x.fillStyle = '#1b2130'; x.beginPath(); x.moveTo(a - sc * 0.32, b); x.lineTo(a + sc * 0.32, b); x.lineTo(a + sc * 0.4, b - sc * 1.1); x.lineTo(a - sc * 0.4, b - sc * 1.1); x.closePath(); x.fill(); x.fillStyle = '#3ee6ff'; x.fillRect(a - sc * 0.4, b - sc * 1.12, sc * 0.8, sc * 0.04); };
KN.drawPerson = (x, P, p, skin, outfit, brand, t, scaleH) => {
  const [a, b, sc] = P(p.x, 1.1, p.z);
  const u = sc * scaleH; // 1 meter in px
  const sw = p.walk ? Math.sin(p.phase) : 0;
  const shirt = outfit.c || brand;
  // shadow
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.ellipse(a, b, u * 0.32, u * 0.07, 0, 0, 7); x.fill();
  // legs
  x.strokeStyle = outfit.l; x.lineCap = 'round'; x.lineWidth = u * 0.14;
  x.beginPath(); x.moveTo(a - u * 0.08, b - u * 0.9); x.lineTo(a - u * 0.08 + sw * u * 0.18, b - u * 0.03); x.stroke();
  x.beginPath(); x.moveTo(a + u * 0.08, b - u * 0.9); x.lineTo(a + u * 0.08 - sw * u * 0.18, b - u * 0.03); x.stroke();
  // torso
  x.fillStyle = shirt; R.rr(x, a - u * 0.2, b - u * 1.5, u * 0.4, u * 0.66, u * 0.1); x.fill();
  // arms
  const gest = p.talk ? Math.sin(t * 5) * 0.5 + 0.5 : 0;
  x.strokeStyle = shirt; x.lineWidth = u * 0.11;
  x.beginPath(); x.moveTo(a - u * 0.19, b - u * 1.42); x.lineTo(a - u * 0.28 - sw * u * 0.08, b - u * 1.05 + (p.dir < 0 ? -gest * u * 0.35 : 0)); x.stroke();
  x.beginPath(); x.moveTo(a + u * 0.19, b - u * 1.42); x.lineTo(a + u * 0.28 + sw * u * 0.08 + (p.dir > 0 ? gest * u * 0.12 : 0), b - u * 1.05 - (p.dir > 0 ? gest * u * 0.4 : 0)); x.stroke();
  // head
  x.fillStyle = skin; x.beginPath(); x.arc(a + p.dir * u * 0.02, b - u * 1.66, u * 0.13, 0, 7); x.fill();
  x.fillStyle = '#1a1410'; x.beginPath(); x.arc(a + p.dir * u * 0.02, b - u * 1.7, u * 0.13, Math.PI * 1.05, Math.PI * 1.95); x.fill();
  // headset mic
  x.strokeStyle = '#ddd'; x.lineWidth = Math.max(1, u * 0.015); x.beginPath(); x.moveTo(a + p.dir * u * 0.12, b - u * 1.66); x.lineTo(a + p.dir * u * 0.08, b - u * 1.58); x.stroke();
};
KN.drawRow = (x, P, row, ri, v, t, amb) => {
  const react = v.react, rt = react ? (v.t - react.t) / 1000 : 99;
  const kind = react && rt < 4.2 ? react.kind : 'idle';
  const fade = U.clamp(1 - (rt - 3) / 1.2, 0, 1);
  row.ppl.forEach((pp, i) => {
    let up = 0, arms = 0, stand = 0, phone = 0;
    const ph = pp.ph + t * 2;
    if (kind === 'ovation') { stand = fade; up = Math.abs(Math.sin(ph * 2.2)) * 0.12 * fade; arms = fade; phone = pp.cheer > 0.6 ? fade : 0; }
    else if (kind === 'cheer') { up = Math.abs(Math.sin(ph * 2.5)) * 0.08 * fade; arms = pp.cheer > 0.4 ? fade : 0; phone = pp.cheer > 0.8 ? fade : 0; }
    else if (kind === 'applause') { arms = pp.cheer > 0.5 ? 0.35 * fade : 0; up = Math.abs(Math.sin(ph * 6)) * 0.015 * fade; }
    else if (kind === 'laugh') { up = Math.abs(Math.sin(ph * 5)) * 0.04 * fade; }
    else if (kind === 'boo') { arms = pp.cheer < 0.25 ? 0.25 * fade : 0; }
    else if (kind === 'gasp') { up = 0.03 * fade; }
    const y = pp.h + stand * 0.5 + up;
    const [a, b, sc] = P(pp.x, y, row.z);
    if (b - sc * 0.4 > KN.cv.height / (KN.dpr || 1) + 40) return;
    const lit = 0.35 + amb * 0.4;
    // shoulders
    x.fillStyle = R.shade('#20283a', lit + 0.15);
    x.beginPath(); x.ellipse(a, b + sc * 0.2, sc * 0.24, sc * 0.17, 0, Math.PI, 0); x.fill(); x.fillRect(a - sc * 0.24, b + sc * 0.2, sc * 0.48, sc * 0.6);
    if (arms > 0) { x.strokeStyle = R.shade('#20283a', lit + 0.2); x.lineWidth = sc * 0.07; x.lineCap = 'round'; const wave = Math.sin(ph * 3) * 0.08; x.beginPath(); x.moveTo(a - sc * 0.2, b + sc * 0.15); x.lineTo(a - sc * (0.28 + wave), b - sc * 0.35 * arms); x.stroke(); x.beginPath(); x.moveTo(a + sc * 0.2, b + sc * 0.15); x.lineTo(a + sc * (0.28 - wave), b - sc * 0.35 * arms); x.stroke(); if (phone) { x.fillStyle = '#fffbe0'; x.fillRect(a + sc * 0.24, b - sc * 0.48 * arms, sc * 0.06, sc * 0.1); x.save(); x.globalCompositeOperation = 'lighter'; x.fillStyle = 'rgba(255,250,210,0.18)'; x.beginPath(); x.arc(a + sc * 0.27, b - sc * 0.44 * arms, sc * 0.18, 0, 7); x.fill(); x.restore(); } }
    // head (back of head)
    x.fillStyle = R.shade(pp.hair, lit + 0.2); x.beginPath(); x.arc(a, b - sc * 0.02, sc * 0.11, 0, 7); x.fill();
  });
};
KN.drawBeams = (x, P, s, v, t, L) => {
  const kind = s.light.id;
  const n = { basic: 2, theatre: 4, concert: 6, laser: 6, holo: 8 }[kind] || 2;
  const hz = s.plan.fx.includes('haze') ? 1.7 : 1;
  x.save(); x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const lx = -s.W / 2 + (i + 0.5) * s.W / n, ly = 8.4, lz = s.Dd - 1.2;
    const follow = i % 3 === 0 || kind === 'basic';
    const tx = follow ? v.pres.x : Math.sin(t * 0.7 + i) * s.W * 0.35, tz = follow ? v.pres.z : 1.5 + Math.cos(t * 0.5 + i) * 1.2;
    const [ax, ay] = P(lx, ly, lz), [bx, by, sc] = P(tx, 1.1, tz);
    const hue = kind === 'basic' ? 40 : kind === 'theatre' ? (i % 2 ? 210 : 40) : (t * 40 + i * 50) % 360;
    const a = (follow ? 0.13 : 0.08) * hz * (follow ? 1 : L);
    const g = x.createLinearGradient(ax, ay, bx, by); g.addColorStop(0, 'hsla(' + hue + ',90%,75%,' + a * 1.6 + ')'); g.addColorStop(1, 'hsla(' + hue + ',90%,70%,' + a * 0.4 + ')');
    x.fillStyle = g; x.beginPath(); x.moveTo(ax - 2, ay); x.lineTo(ax + 2, ay); x.lineTo(bx + sc * 0.7, by); x.lineTo(bx - sc * 0.7, by); x.closePath(); x.fill();
    x.beginPath(); x.ellipse(bx, by, sc * 0.75, sc * 0.18, 0, 0, 7); x.fillStyle = 'hsla(' + hue + ',90%,75%,' + a * 1.2 + ')'; x.fill();
    x.fillStyle = 'hsla(' + hue + ',90%,85%,0.9)'; x.beginPath(); x.arc(ax, ay, 2.5, 0, 7); x.fill();
  }
  if (kind === 'laser' || kind === 'holo') {
    for (let i = 0; i < 8; i++) { const ang = Math.sin(t * 0.9 + i) * 0.9; const [ax, ay] = P(0, 7.5, s.Dd); x.strokeStyle = 'hsla(' + (kind === 'laser' ? 130 : (t * 60 + i * 40) % 360) + ',100%,60%,' + 0.25 * L * hz + ')'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(ax, ay); x.lineTo(ax + Math.sin(ang) * 2000, ay + Math.cos(ang) * 900); x.stroke(); }
  }
  x.restore();
};
KN.drawFx = (x, P, s, v, t, W, Hh) => {
  v.fx.forEach((e) => {
    const et = (v.t - e.t) / 1000; const rng = U.srng(e.t + 7);
    if (e.fx === 'confetti' && et < 7) { for (let i = 0; i < 160; i++) { const cx2 = rng() * W, sp = 60 + rng() * 120, y = -20 + et * sp + Math.sin(et * 3 + i) * 10; if (y > Hh) continue; x.fillStyle = 'hsl(' + Math.floor(rng() * 360) + ',90%,60%)'; x.save(); x.translate(cx2 + Math.sin(et * 2 + i) * 20, y); x.rotate(et * 4 + i); x.fillRect(-3, -1.5, 6, 3); x.restore(); } }
    if (e.fx === 'pyro' && et < 2.6) { x.save(); x.globalCompositeOperation = 'lighter'; [-1, 1].forEach((side) => { const [a, b, sc] = P(side * (s.W / 2 - 0.5), 1.1, 0.3); for (let i = 0; i < 70; i++) { const ang = -Math.PI / 2 + (rng() - 0.5) * 0.7, sp = (4 + rng() * 6) * sc / 6; const px = a + Math.cos(ang) * sp * et * 6, py = b + Math.sin(ang) * sp * et * 6 + et * et * 40; x.fillStyle = 'rgba(255,' + Math.floor(150 + rng() * 100) + ',60,' + (1 - et / 2.6) + ')'; x.fillRect(px, py, 2.5, 2.5); } }); x.restore(); }
    if (e.fx === 'co2' && et < 3) { [-1, 1].forEach((side) => { const [a, b, sc] = P(side * (s.W / 2 - 1), 1.1, 0.3); const g = x.createLinearGradient(a, b, a, b - sc * 5); g.addColorStop(0, 'rgba(255,255,255,' + 0.5 * (1 - et / 3) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.beginPath(); x.moveTo(a - sc * 0.1, b); x.lineTo(a + sc * 0.1, b); x.lineTo(a + sc * 0.6, b - sc * 5 * Math.min(1, et * 3)); x.lineTo(a - sc * 0.6, b - sc * 5 * Math.min(1, et * 3)); x.fill(); }); }
    if (e.fx === 'drones' && et < 10) { x.save(); x.globalCompositeOperation = 'lighter'; const k = Math.min(1, et / 3); for (let i = 0; i < 90; i++) { const ang = i / 90 * Math.PI * 2; const tx = Math.cos(ang) * 1.4, ty = Math.sin(ang) * 2.6; const rx = (rng() - 0.5) * 16, ry = rng() * 4; const X = U.lerp(rx, tx, k), Y = 9 + U.lerp(ry, ty, k); const [a, b] = P(X, Y, s.Dd + 2); x.fillStyle = 'hsla(' + (190 + i) + ',100%,70%,0.9)'; x.fillRect(a, b, 2, 2); } x.restore(); }
    if (e.fx === 'holo' && et < 7) { const [a, b, sc] = P(0, 3.6, 2.4); x.save(); x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.5 * Math.min(1, et) * Math.min(1, (7 - et)); x.translate(a, b); x.scale(Math.cos(et * 1.4), 1); const scale = sc * 0.012; R.drawPhone(x, 0, 0, scale, s.look.d, s.look.st, Math.cos(et * 1.4) > 0 ? 'front' : 'back', { color: s.look.color, glow: 'rgba(62,230,255,0.9)' }); x.restore(); }
    if (e.fx === 'sweep' && et < 2.5) { x.save(); x.globalCompositeOperation = 'lighter'; const xx = (et / 2.5) * W * 1.4 - W * 0.2; const g = x.createLinearGradient(xx - 80, 0, xx + 80, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(160,220,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, W, Hh); x.restore(); }
  });
};
KN.EMO = { ovation: ['👏', '🔥', '🙌', '😍'], cheer: ['👏', '🔥', '🙌'], applause: ['👏'], polite: ['👏'], silence: ['😐', '🤔'], boo: ['👎', '😒', '🥱'], laugh: ['😂', '🤣'], gasp: ['😱', '🔥'] };
KN.drawEmojis = (x, react, et, W, Hh) => {
  if (et > 3.2) return;
  const list = KN.EMO[react.kind] || ['👏'];
  const n = { ovation: 26, cheer: 18, applause: 8, polite: 3, silence: 4, boo: 10, laugh: 14, gasp: 10 }[react.kind] || 4;
  const rng = U.srng(react.t + 3);
  x.font = '22px sans-serif'; x.textAlign = 'center';
  for (let i = 0; i < n; i++) { const sx = rng() * W, delay = rng() * 0.8, tt = et - delay; if (tt < 0) continue; const y = Hh - 40 - tt * (90 + rng() * 80); x.globalAlpha = U.clamp(1 - tt / 2.4, 0, 1); x.fillText(list[Math.floor(rng() * list.length)], sx + Math.sin(tt * 3 + i) * 12, y); }
  x.globalAlpha = 1;
};

/* ---------------- giant screen content ---------------- */
KN.logoImg = null; KN.logoKey = '';
KN.getLogo = (logo) => { const key = JSON.stringify(logo); if (KN.logoKey !== key) { KN.logoKey = key; KN.logoImg = new Image(); KN.logoImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(UI.logoSVG(logo, 200).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')); } return KN.logoImg; };
KN.drawScreen = (x, X, Y, W, Hh, scr, ms, s) => {
  const t = ms / 1000, bg = s.bg, d = scr.data || {};
  const A = bg.a || R.shade(s.logo.color, 0.25), B = bg.b || s.logo.color, ink = bg.ink;
  const g = x.createLinearGradient(X, Y, X + W, Y + Hh); g.addColorStop(0, A); g.addColorStop(1, B);
  x.fillStyle = scr.kind === 'black' || scr.kind === 'reveal' || scr.kind === 'trailer' || scr.kind === 'game' || scr.kind === 'onemore' ? '#000' : g; x.fillRect(X, Y, W, Hh);
  const cx = X + W / 2, cy = Y + Hh / 2, fs = Hh / 10;
  const txt = (s2, y, size, col = ink, wt = 800, alpha = 1) => { x.globalAlpha = alpha; x.fillStyle = col; x.font = wt + ' ' + Math.max(6, size) + 'px -apple-system,Segoe UI,Arial'; x.textAlign = 'center'; x.fillText(s2, cx, y); x.globalAlpha = 1; };
  const fadeIn = U.clamp(t / 0.5, 0, 1);
  switch (scr.kind) {
    case 'logo': case 'thanks': {
      const img = KN.getLogo(s.logo); const sz = Hh * 0.42;
      if (img.complete && img.naturalWidth) x.drawImage(img, cx - sz / 2, Y + Hh * 0.16, sz, sz);
      txt(s.coName, Y + Hh * 0.78, fs * 0.9, ink, 900); if (scr.kind === 'thanks') txt('Thank you', Y + Hh * 0.92, fs * 0.6, ink, 600, fadeIn);
      else txt(s.plan.name, Y + Hh * 0.9, fs * 0.55, ink, 600, 0.7);
      break;
    }
    case 'title': txt(d.text, cy, fs * 1.3, ink, 900, fadeIn); txt(d.sub, cy + fs * 1.2, fs * 0.6, ink, 500, fadeIn * 0.8); break;
    case 'black': break;
    case 'reveal': {
      const glow = x.createRadialGradient(cx, cy, 5, cx, cy, W * 0.6); glow.addColorStop(0, 'rgba(100,150,255,' + 0.35 * U.clamp(t / 2, 0, 1) + ')'); glow.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = glow; x.fillRect(X, Y, W, Hh);
      const lk = s.look; const scale = Hh * 0.72 / lk.st.bodyH;
      const ang = t < 3.2 ? (t / 3.2) * Math.PI * 2 + Math.PI : Math.PI * 2;
      const cs = Math.cos(ang);
      x.save(); x.translate(cx - (t > 3.2 ? W * 0.14 * U.clamp((t - 3.2) / 0.8, 0, 1) : 0), cy); x.scale(Math.max(0.05, Math.abs(cs)), 1);
      R.drawPhone(x, 0, 0, scale, lk.d, lk.st, cs > 0 ? 'front' : 'back', { color: lk.color, glow: 'rgba(120,170,255,0.6)', logo: (s.logo.letter || '').slice(0, 1) });
      x.restore();
      if (t > 3.4) { const a = U.clamp((t - 3.4) / 0.8, 0, 1); x.globalAlpha = a; x.fillStyle = '#fff'; x.font = '900 ' + fs * 1.1 + 'px -apple-system,Segoe UI,Arial'; x.textAlign = 'left'; x.fillText(lk.name, cx + W * 0.04, cy); x.font = '500 ' + fs * 0.45 + 'px sans-serif'; x.fillStyle = 'rgba(200,220,255,0.8)'; x.fillText('by ' + s.coName, cx + W * 0.04, cy + fs * 0.8); x.globalAlpha = 1; }
      break;
    }
    case 'specs': { txt(d.t, Y + Hh * 0.3, fs * 0.8, ink, 700, fadeIn * 0.8); const col = d.good > 0 ? '#3ddc84' : d.good < 0 ? '#ff8a8a' : ink; txt(d.v, Y + Hh * 0.58, fs * 1.15 * Math.min(1, 26 / Math.max(10, d.v.length)), col, 900, fadeIn); break; }
    case 'compare': {
      txt(s.look.name + '  vs  ' + d.rv, Y + Hh * 0.13, fs * 0.6, ink, 800);
      const rows = d.rows, rh = Hh * 0.75 / Math.max(1, rows.length), pr = U.clamp(t / 2, 0, 1);
      rows.forEach(([lab, me, rv, dir], i) => {
        const y = Y + Hh * 0.2 + i * rh, mx = Math.max(me, rv) || 1; const meWin = dir > 0 ? me >= rv : me <= rv;
        x.fillStyle = ink; x.globalAlpha = 0.7; x.font = '600 ' + fs * 0.42 + 'px sans-serif'; x.textAlign = 'left'; x.fillText(lab, X + W * 0.04, y + rh * 0.55); x.globalAlpha = 1;
        const bw = W * 0.6;
        x.fillStyle = meWin ? '#3ddc84' : '#8a97ad'; x.fillRect(X + W * 0.24, y + rh * 0.12, bw * me / mx * pr, rh * 0.3);
        x.fillStyle = 'rgba(167,116,255,0.8)'; x.fillRect(X + W * 0.24, y + rh * 0.48, bw * rv / mx * pr, rh * 0.3);
        x.fillStyle = ink; x.font = '700 ' + fs * 0.32 + 'px sans-serif'; x.textAlign = 'right'; x.fillText(lab === 'Price' ? U.money(me) : U.num(me), X + W * 0.97, y + rh * 0.38); x.fillText(lab === 'Price' ? U.money(rv) : U.num(rv), X + W * 0.97, y + rh * 0.74);
      });
      break;
    }
    case 'bench': {
      txt('⚡ QuantaBench — live', Y + Hh * 0.13, fs * 0.6, ink, 800);
      const pr = U.clamp(t / 3.4, 0, 1), rows = d.rows, mx = Math.max(...rows.map((r) => r[1]));
      rows.forEach(([n, val, me], i) => {
        const y = Y + Hh * 0.22 + i * Hh * 0.14, grow = me ? pr : 1;
        x.fillStyle = me ? '#ff6a3d' : 'rgba(255,255,255,0.25)'; x.fillRect(X + W * 0.32, y, W * 0.58 * val / mx * grow, Hh * 0.09);
        x.fillStyle = ink; x.font = (me ? '800 ' : '500 ') + fs * 0.36 + 'px sans-serif'; x.textAlign = 'right'; x.fillText(n.length > 18 ? n.slice(0, 17) + '…' : n, X + W * 0.3, y + Hh * 0.07);
        x.textAlign = 'left'; x.fillText(U.num(Math.round(val * grow)), X + W * 0.33 + W * 0.58 * val / mx * grow + 4, y + Hh * 0.07);
      });
      if (pr >= 1) txt('#' + d.rank + ' of ' + d.of + ' phones', Y + Hh * 0.95, fs * 0.5, '#ffb648', 800);
      break;
    }
    case 'game': {
      const series = d.series, idx = Math.min(series.length - 1, Math.floor(t / 7 * series.length)); const [fps, temp] = series[Math.max(0, idx)];
      const over = d.over && idx >= series.length - 2;
      const frameT = Math.floor(t * Math.max(1, fps)) / Math.max(1, fps);
      // procedural racing scene, rendered at the simulated frame rate
      const sky = x.createLinearGradient(X, Y, X, Y + Hh * 0.5); sky.addColorStop(0, '#ff7a59'); sky.addColorStop(1, '#3a1a5a'); x.fillStyle = sky; x.fillRect(X, Y, W, Hh * 0.5);
      x.fillStyle = '#1a1030'; x.fillRect(X, Y + Hh * 0.5, W, Hh * 0.5);
      for (let i = 0; i < 12; i++) { const zz = ((i / 12 + frameT * 0.9) % 1); const yy = Y + Hh * 0.5 + zz * zz * Hh * 0.5; const ww = W * 0.02 + zz * zz * W * 0.9; x.fillStyle = i % 2 ? '#ff2d9a' : '#3ee6ff'; x.fillRect(cx - ww / 2, yy, ww * 0.04, Math.max(1, zz * 6)); x.fillRect(cx + ww / 2 - ww * 0.04, yy, ww * 0.04, Math.max(1, zz * 6)); }
      for (let i = 0; i < 8; i++) { const zz = ((i / 8 + frameT * 1.3) % 1); x.fillStyle = 'rgba(255,255,255,' + zz + ')'; x.fillRect(cx - 2, Y + Hh * 0.5 + zz * zz * Hh * 0.5, 4, zz * 18); }
      const carX = cx + Math.sin(frameT * 1.7) * W * 0.12;
      x.fillStyle = '#ffd36b'; x.beginPath(); x.moveTo(carX - W * 0.07, Y + Hh * 0.9); x.lineTo(carX + W * 0.07, Y + Hh * 0.9); x.lineTo(carX + W * 0.05, Y + Hh * 0.8); x.lineTo(carX - W * 0.05, Y + Hh * 0.8); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(X + 4, Y + 4, W * 0.36, Hh * 0.2);
      x.textAlign = 'left'; x.font = '900 ' + fs * 0.9 + 'px monospace'; x.fillStyle = fps >= 55 ? '#3ddc84' : fps >= 30 ? '#ffb648' : '#ff4d6a'; x.fillText(fps + ' FPS', X + 10, Y + fs * 1.0);
      x.font = '700 ' + fs * 0.4 + 'px monospace'; x.fillStyle = temp > 45 ? '#ff4d6a' : '#ddd'; x.fillText(temp.toFixed(1) + '°C · ' + d.preset, X + 10, Y + fs * 1.6);
      x.fillStyle = '#fff'; x.textAlign = 'right'; x.font = '800 ' + fs * 0.42 + 'px sans-serif'; x.fillText(d.g, X + W - 8, Y + fs * 0.6);
      if (over) { x.fillStyle = 'rgba(160,0,20,0.75)'; x.fillRect(X, Y, W, Hh); txt('⚠ Device temperature too high', cy, fs * 0.75, '#fff', 900); txt('App closed to cool down', cy + fs, fs * 0.45, '#fff', 500); }
      break;
    }
    case 'camera': {
      if (d.crashed) { x.fillStyle = '#111'; x.fillRect(X, Y, W, Hh); x.fillStyle = '#2a2f3a'; R.rr(x, cx - W * 0.3, cy - Hh * 0.22, W * 0.6, Hh * 0.44, 12); x.fill(); txt('Camera has stopped', cy - fs * 0.3, fs * 0.6, '#fff', 800); txt('Close app', cy + fs * 0.8, fs * 0.45, '#3ee6ff', 700); break; }
      const q = U.clamp(d.score / 120, 0.05, 1.2), rng = U.srng(77);
      const night = d.mode === 'night';
      x.fillStyle = night ? '#0a0812' : '#87b6e8'; x.fillRect(X, Y, W, Hh);
      const rows = d.mode === 'zoom' ? 2 : 4;
      for (let r = 0; r < rows; r++) for (let i = 0; i < 14; i++) { const hx = X + (i + 0.5) * W / 14 + (rng() - 0.5) * 6, hy2 = Y + Hh * (0.35 + r * 0.17), rr = (Hh * 0.06) * (1 + r * 0.25) * (d.mode === 'zoom' ? 2.2 : 1); x.fillStyle = night ? '#2a2030' : '#3a3040'; x.beginPath(); x.arc(hx, hy2, rr, 0, 7); x.fill(); x.fillStyle = night ? '#1c1828' : '#283048'; x.fillRect(hx - rr * 1.3, hy2 + rr * 0.8, rr * 2.6, rr * 2); }
      if (night) { x.save(); x.globalCompositeOperation = 'lighter'; for (let i = 0; i < 5; i++) { const g2 = x.createRadialGradient(X + W * (0.1 + i * 0.2), Y, 2, X + W * (0.1 + i * 0.2), Y, Hh * 0.6); g2.addColorStop(0, 'rgba(255,200,120,0.4)'); g2.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g2; x.fillRect(X, Y, W, Hh); } x.restore(); }
      const noise = U.clamp((1 - q) * (night ? 0.9 : 0.4), 0, 0.9);
      const nr = U.srng(91); for (let i = 0; i < 1400 * noise; i++) { x.fillStyle = 'rgba(' + (nr() < 0.5 ? '255,255,255' : '0,0,0') + ',' + noise * 0.5 + ')'; x.fillRect(X + nr() * W, Y + nr() * Hh, 2, 2); }
      if (night && q < 0.6) { x.fillStyle = 'rgba(0,0,0,' + (0.6 - q) * 0.8 + ')'; x.fillRect(X, Y, W, Hh); }
      x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(X, Y + Hh - fs * 0.9, W, fs * 0.9); x.fillStyle = '#fff'; x.font = '700 ' + fs * 0.4 + 'px sans-serif'; x.textAlign = 'left'; x.fillText('📷 Shot live on ' + s.look.name + ' · ' + d.mode + ' · score ' + d.score, X + 8, Y + Hh - fs * 0.3);
      break;
    }
    case 'battery': {
      txt('🔋 Screen-on battery life', Y + Hh * 0.13, fs * 0.6, ink, 800);
      const mx = Math.max(...d.rows.map((r) => r[1])), pr = U.clamp(t / 2, 0, 1);
      d.rows.forEach(([n, h, me], i) => { const y = Y + Hh * 0.22 + i * Hh * 0.16; x.fillStyle = me ? '#3ddc84' : 'rgba(255,255,255,0.25)'; x.fillRect(X + W * 0.34, y, W * 0.52 * h / mx * pr, Hh * 0.1); x.fillStyle = ink; x.font = (me ? '800 ' : '500 ') + fs * 0.36 + 'px sans-serif'; x.textAlign = 'right'; x.fillText(n.length > 18 ? n.slice(0, 17) + '…' : n, X + W * 0.32, y + Hh * 0.075); x.textAlign = 'left'; x.fillText((h * pr).toFixed(1) + ' h', X + W * 0.35 + W * 0.52 * h / mx * pr + 4, y + Hh * 0.075); });
      break;
    }
    case 'price': { txt(s.look.name, Y + Hh * 0.28, fs * 0.7, ink, 700, fadeIn); const sc2 = 0.6 + 0.4 * U.clamp((t - 0.6) / 0.5, 0, 1); txt(U.money(d.price), Y + Hh * 0.6, fs * 2.2 * sc2, ink, 900, U.clamp((t - 0.6) / 0.4, 0, 1)); txt(d.avail, Y + Hh * 0.82, fs * 0.5, ink, 600, U.clamp((t - 1.2) / 0.5, 0, 1)); break; }
    case 'trailer': {
      const q = d.q, lk = s.look, scale = Hh * (0.6 + q * 0.4) / lk.st.bodyH;
      const shot = Math.floor(t / 1.6) % 4;
      x.save(); x.translate(cx + Math.sin(t * 0.6) * W * 0.1, cy); x.rotate(Math.sin(t * 0.4) * 0.25 * q); x.scale(1 + t * 0.03, 1 + t * 0.03);
      R.drawPhone(x, 0, 0, scale, lk.d, lk.st, shot % 2 ? 'front' : 'back', { color: lk.color, glow: 'rgba(255,255,255,0.4)' });
      x.restore();
      const sweep = (t * 0.7) % 1; const sg = x.createLinearGradient(X + W * sweep - 60, 0, X + W * sweep + 60, 0); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,' + 0.25 * q + ')'); sg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = sg; x.fillRect(X, Y, W, Hh);
      if (q > 0.5) { const rng = U.srng(5); x.save(); x.globalCompositeOperation = 'lighter'; for (let i = 0; i < 60 * q; i++) { x.fillStyle = 'rgba(160,200,255,' + 0.5 * rng() + ')'; x.fillRect(X + ((rng() * W + t * 40 * (1 + rng())) % W), Y + rng() * Hh, 2, 2); } x.restore(); }
      x.fillStyle = 'rgba(0,0,0,1)'; x.fillRect(X, Y, W, Hh * 0.1); x.fillRect(X, Y + Hh * 0.9, W, Hh * 0.1);
      if (t > 4.2) txt(d.tag, Y + Hh * 0.82, fs * 0.8, '#fff', 900, U.clamp((t - 4.2) / 0.6, 0, 1));
      break;
    }
    case 'guest': txt('Please welcome', cy - fs * 0.6, fs * 0.55, ink, 500, fadeIn); txt(d.name, cy + fs * 0.6, fs * 1.0, ink, 900, U.clamp((t - 0.5) / 0.5, 0, 1)); break;
    case 'onemore': { txt('One more thing…', cy - (t > 2.5 ? fs * 0.8 : 0), fs * 0.9, '#fff', 300, fadeIn); if (t > 2.5) txt(d.label, cy + fs * 0.6, fs * 0.75, '#3ee6ff', 900, U.clamp((t - 2.5) / 0.6, 0, 1)); break; }
  }
};
