/* =========================================================
   MEDIA — reviews, videos, tests, comments, social buzz
   ========================================================= */
const MED = {};
MED.outlets = [
  { name: 'TechPulse', focus: null, color: '#3ee6ff' }, { name: 'The Circuit', focus: 'perf', color: '#a774ff' },
  { name: 'GadgetGrid', focus: 'value', color: '#3ddc84' }, { name: 'PixelPeep', focus: 'camera', color: '#ffb648' },
  { name: 'FrameRate Lab', focus: 'gaming', color: '#ff4d6a' }, { name: 'Juice Lab', focus: 'battery', color: '#9be15d' },
  { name: 'MobileInsider', focus: 'build', color: '#ff7ad9' }, { name: 'Silicon Weekly', focus: 'chip', color: '#7aa2ff' },
];
MED.channels = [
  { name: 'TechWithTara', subs: 4.2e6, style: 'review' }, { name: 'UnboxPrime', subs: 9.1e6, style: 'unbox' }, { name: 'Dave Teardown', subs: 2.7e6, style: 'teardown' },
  { name: 'FPS Junkies', subs: 3.3e6, style: 'gaming' }, { name: 'Lens & Light', subs: 1.4e6, style: 'camera' }, { name: 'Budget Byte', subs: 2.1e6, style: 'value' },
  { name: 'SpeedTest Bros', subs: 5.5e6, style: 'versus' }, { name: 'Battery Bench', subs: 0.9e6, style: 'battery' },
];
MED.PRO = { perf: 'Blazing-fast performance', camera: 'Excellent cameras', display: 'Gorgeous display', battery: 'Outstanding battery life', build: 'Premium, beautiful design', software: 'Clean, smooth software', features: 'Packed with features', connect: 'Cutting-edge connectivity' };
MED.CON = { perf: 'Sluggish performance', camera: 'Mediocre cameras', display: 'Disappointing screen', battery: 'Weak battery life', build: 'Cheap-feeling build', software: 'Buggy, dated software', features: 'Missing key features', connect: 'Behind on network tech' };
MED.user = () => U.pick(['pixel', 'tech', 'droid', 'byte', 'neo', 'retro', 'mobile', 'gadget', 'turbo', 'silicon', 'captain', 'lazy', 'night', 'flash', 'quantum']) + U.pick(['_fan', 'guy', 'Queen', 'Lord', 'Nerd', 'Wizard', 'Cat', 'Fox', 'Panda', 'Owl', '_x', 'Bot']) + U.ri(1, 999);
MED.scoreColor = (v) => (v >= 8.5 ? '#3ddc84' : v >= 7 ? '#3ee6ff' : v >= 5 ? '#ffb648' : '#ff4d6a');

// core verdict model shared by all outlets
MED.verdict = (p, st, ev) => {
  const q = st.qual, fair = S.fairPrice(q.q), value = fair / p.price;
  const refs = S.segRefs(); const tier = S.tierOfPrice(p.price);
  const exp = refs[tier + 'Q'];
  let base = 5.4 + (q.q - exp) / 7 + U.log2(value) * 2.4;
  const flags = [];
  if (st.sustained < 0.6) { base -= 0.5; flags.push('hot'); }
  if (p.design.cam.extras.includes('macro')) flags.push('macro');
  if (st.weight > 225) flags.push('heavy');
  if (p.design.benchBoost && S.has('benchboost') && U.chance(0.6)) { base -= 1.8; flags.push('cheat'); }
  if (p.claims && p.claims.battery && st.sot < p.claims.battery) { base -= 0.8; flags.push('overclaim'); }
  if (p.claims && p.claims.hypeTalk && q.q < exp + 5) { base -= 0.4; flags.push('overhyped'); }
  if (ev && ev.failures.length) flags.push('eventfail');
  return { base, value, fair, flags, tier, exp };
};
MED.generateReviews = (p, ev) => {
  const st = S.stats(p), V = MED.verdict(p, st, ev);
  const q = st.qual.s;
  const n = ev ? U.clamp(2 + Math.round((ev.plan.press || 0) / 25), 3, 8) : U.clamp(2 + Math.round(G.rep / 20), 2, 6);
  const outlets = U.shuffle(MED.outlets.slice()).slice(0, n);
  const reviews = outlets.map((o) => {
    let sc = V.base;
    if (o.focus === 'value') sc += U.log2(V.value) * 1.2;
    else if (o.focus === 'gaming') sc += (q.perf - 0.9) * 3 + (st.sustained - 0.8) * 2 + (p.design.disp.hz >= 120 ? 0.4 : 0);
    else if (o.focus === 'chip') sc += (q.perf - 0.9) * 3 + (p.chipSource === 'own' ? 0.5 : 0);
    else if (o.focus && q[o.focus] != null) sc += (q[o.focus] - 0.9) * 3.5;
    sc = U.clamp(sc + U.gauss() * 0.35, 1, 10);
    sc = Math.round(sc * 10) / 10;
    const keys = Object.keys(q).sort((a, b) => q[b] - q[a]);
    const pros = keys.filter((k) => q[k] >= 0.98).slice(0, 2).map((k) => MED.PRO[k]);
    const cons = keys.slice().reverse().filter((k) => q[k] < 0.75).slice(0, 2).map((k) => MED.CON[k]);
    if (V.value > 1.3) pros.push('Incredible value for ' + U.money(p.price));
    if (V.value < 0.75) cons.push('Overpriced at ' + U.money(p.price));
    if (V.flags.includes('hot')) cons.push('Throttles and runs hot under load');
    if (V.flags.includes('macro')) cons.push('Pointless 2MP macro camera');
    if (V.flags.includes('heavy')) cons.push('Heavy (' + st.weight.toFixed(0) + ' g)');
    if (V.flags.includes('cheat')) cons.push('Caught boosting benchmark scores');
    if (V.flags.includes('overclaim')) cons.push('Battery life falls short of the keynote claims');
    if (p.design.body.jack && S.fy() > 2018) pros.push('Keeps the headphone jack');
    if (!pros.length) pros.push('Does the basics');
    if (!cons.length) cons.push('Nothing major');
    return { outlet: o.name, color: o.color, score: sc, headline: MED.headline(p, sc, V), pros: pros.slice(0, 3), cons: cons.slice(0, 3), verdict: MED.verdictLine(p, sc, V) };
  });
  p.reviews = reviews;
  p.reviewAvg = U.avg(reviews, (r) => r.score);
  p.media = MED.package(p, st, V, ev);
  if (V.flags.includes('cheat')) { G.rep = Math.max(0, G.rep - 4); S.news('🕵️ Reviewers catch ' + U.esc(p.name) + ' boosting benchmark scores. #BenchGate', 'bad'); }
  return reviews;
};
MED.headline = (p, sc, V) => {
  const N = p.name.toUpperCase(), n = p.name, P = U.money(p.price), T = { budget: 'budget phone', mid: 'mid-ranger', premium: 'premium phone', flagship: 'flagship' }[V.tier];
  if (sc >= 9.2) return U.pick([N + ' DESTROYS THE COMPETITION!', n + ' review: the new king of ' + T + 's', 'This is the best phone of ' + S.year() + '. Period.']);
  if (V.value > 1.4 && sc >= 7.5) return U.pick([n + ': how is this only ' + P + '?!', n + ' review: absurd value', 'The ' + n + ' makes ' + T + 's twice its price look silly']);
  if (sc >= 8.2) return U.pick([n + ' review: a near-perfect ' + T, G.co.name + ' has arrived', n + ' review: believe the hype']);
  if (sc >= 6.6) return U.pick([n + ' review: solid, but not spectacular', n + ' review: a safe bet', n + ' review: good, with a few compromises']);
  if (sc >= 5) return U.pick([n + ' review: hard to recommend at ' + P, n + ' review: so close, yet so far', n + ' review: the competition is better']);
  return p.price > 600 ? P + ' FOR THIS? THE WORST ' + T.toUpperCase() + ' OF THE YEAR!' : U.pick([n + ' review: skip it', n + ' review: a disappointing mess', 'Don\'t buy the ' + n]);
};
MED.verdictLine = (p, sc, V) => sc >= 8.5 ? 'An easy recommendation — ' + G.co.name + ' nailed it.' : sc >= 7 ? 'A strong ' + V.tier + ' option if you can live with the trade-offs.' : sc >= 5 ? 'There are better phones for ' + U.money(p.price) + '.' : 'Avoid. Spend your money elsewhere.';
MED.package = (p, st, V, ev) => {
  const rivalsAll = G.rivals.filter((r) => r.alive).flatMap((r) => r.phones);
  const near = rivalsAll.slice().sort((a, b) => Math.abs(Math.log(a.price / p.price)) - Math.abs(Math.log(b.price / p.price)));
  const rival = near[0];
  const avg = p.reviewAvg;
  const hype = p.hype;
  const reach = (G.regions[G.co.market].aware + 0.05) * (1 + hype / 40);
  const games = D.games.filter((g) => g.year <= S.year()).slice(-3);
  const gameTests = games.map((g) => { const r = M.gameSession(st, g, D.gfxPresets[2], { has: S.has, hz: p.design.disp.hz, ramGB: p.design.ram.gb, minutes: 15 }); return { game: g.name, avg: Math.round(r.avg), low: Math.round(r.low), maxT: +r.maxT.toFixed(1), over: r.overheated }; });
  const videos = U.shuffle(MED.channels.slice()).slice(0, 5).map((c) => {
    let title;
    if (c.style === 'unbox') title = p.name + ' Unboxing — First Impressions!';
    else if (c.style === 'versus') title = p.name + ' vs ' + (rival ? rival.name : 'the competition') + ' — SPEED TEST';
    else if (c.style === 'gaming') title = p.name + ' Gaming Test — ' + gameTests[gameTests.length - 1].game + ' at ' + gameTests[gameTests.length - 1].avg + ' FPS' + (gameTests[gameTests.length - 1].over ? ' (IT OVERHEATED 🔥)' : '');
    else if (c.style === 'camera') title = p.name + ' Camera Test vs ' + (rival ? rival.name : 'Flagships');
    else if (c.style === 'battery') title = p.name + ' Battery Drain Test: ' + st.sot.toFixed(1) + ' hours!';
    else if (c.style === 'teardown') title = 'What\'s inside the ' + p.name + '? Teardown';
    else if (c.style === 'value') title = avg >= 7.5 && V.value > 1.1 ? 'The ' + p.name + ' is the BEST VALUE phone right now' : 'Is the ' + p.name + ' worth ' + U.money(p.price) + '?';
    else title = avg >= 8 ? p.name + ' Review: I\'m Impressed.' : avg >= 6 ? p.name + ' Review: Watch Before You Buy!' : 'Don\'t buy the ' + p.name + '...';
    const views = Math.round(c.subs * U.rf(0.04, 0.12) * reach * (avg >= 8 || avg < 4.5 ? 1.8 : 1));
    return { channel: c.name, title, views, likes: Math.round(views * U.rf(0.02, 0.05) * (avg / 7)), mins: U.ri(8, 22) + ':' + String(U.ri(0, 59)).padStart(2, '0') };
  });
  const sentiment = U.clamp(0.5 + (avg - 6.5) / 6 + (V.value - 1) * 0.25 - (ev && ev.failures.length ? 0.12 : 0), 0.05, 0.97);
  const comments = [];
  for (let i = 0; i < 9; i++) {
    const r = Math.random();
    const P = U.money(p.price), RV = rival ? rival.name : 'my old phone';
    let t;
    if (r < sentiment * 0.85) t = U.pick(['Take my money! 💸', 'Finally a phone that gets it right.', P + ' is a steal for these specs.', 'Battery life looks insane.', 'This camera though 🔥', 'Switching from ' + RV + ' as soon as it\'s out.', 'Underdog brand cooking 🔥', 'The design is so clean.', 'Preordered. No regrets.']);
    else if (r < sentiment * 0.85 + 0.18) t = U.pick(['Wait for the reviews.', 'Looks nice, but who even are ' + G.co.name + '?', 'Decent specs. Price is ok I guess.', 'Will it get updates though?', 'Hmm, not bad.']);
    else t = U.pick([P + '?? lol no.', 'Another boring phone.', 'Throttles like crazy, pass.', 'My ' + RV + ' is still better.', 'That battery is tiny.', 'Benchmarks are fake, wake up.', 'Remember when phones were cheap?', 'The keynote was so cringe 😬']);
    comments.push({ user: MED.user(), text: t, likes: U.ri(0, 4000) });
  }
  if (ev && ev.failures.length) ev.failures.forEach((f) => comments.unshift({ user: MED.user(), text: { overheat: 'The phone literally overheated ON STAGE 💀', lowfps: 'that ' + (ev.fps || 18) + ' FPS demo lmao', crash: 'camera app crashed live 😂😂', cheat: 'caught cheating benchmarks live on stream, iconic', awkward: 'the guest segment was SO awkward' }[f] || 'that keynote fail tho', likes: U.ri(3000, 40000) }));
  const tag = '#' + p.name.replace(/[^A-Za-z0-9]/g, '');
  const memes = ev ? ev.failures.map((f) => ({ overheat: '#HotPhoneSummer', lowfps: '#' + (ev.fps || 18) + 'FPS', crash: '#CameraCrash', cheat: '#BenchGate', awkward: '#AwkwardKeynote' }[f])) : [];
  const ranks = rivalsAll.map((ph) => ({ name: ph.name, total: ph.st.bench.total, sot: ph.st.sot, cam: ph.st.cam.score, price: ph.price })).concat([{ name: p.name, total: st.bench.total, sot: st.sot, cam: st.cam.score, price: p.price, me: true }]);
  return {
    t: G.t, videos, comments: comments.slice(0, 10), gameTests,
    camera: { day: Math.round(st.cam.day), night: Math.round(st.cam.night), video: Math.round(st.cam.video), zoom: Math.round(st.cam.zoom), selfie: Math.round(st.cam.selfie), score: Math.round(st.cam.score) },
    battery: { sot: +st.sot.toFixed(1), rank: ranks.slice().sort((a, b) => b.sot - a.sot).findIndex((x) => x.me) + 1, n: ranks.length, charge: Math.round(st.chargeMin) },
    bench: ranks.sort((a, b) => b.total - a.total).slice(0, 10).concat(ranks.find((x) => x.me && ranks.indexOf(x) >= 10) ? [ranks.find((x) => x.me)] : []).map((x) => ({ name: x.name, total: x.total, me: !!x.me, price: x.price })),
    social: { tag, mentions: Math.round(2000 * reach * (1 + hype / 20) * U.rf(0.8, 1.3) * Math.pow(1.25, S.fy() - 2010)), sentiment, memes: memes.filter(Boolean), trending: hype > 45 || (ev && ev.score > 75) || memes.length > 0 },
    rival: rival ? rival.name : null,
  };
};

/* ---------- media viewer ---------- */
UI.A.showMedia = (el) => MED.show(S.phoneById(el.dataset.id), el.dataset.ev);
MED.show = (p, evId) => {
  if (!p || !p.media) return;
  const m = p.media;
  const ev = evId ? G.events.find((e) => e.id === evId) : null;
  const tab = MED.tab || 'news';
  let s = '<h2>📰 ' + U.esc(p.name) + ' in the media</h2><div class="subtabs">' + [['news', 'Reviews'], ['video', 'Videos'], ['tests', 'Tests'], ['bench', 'Rankings'], ['social', 'Social']].map(([k, n]) => '<button class="' + (tab === k ? 'on' : '') + '" data-a="medTab" data-v="' + k + '" data-id="' + p.id + '" data-ev="' + (evId || '') + '">' + n + '</button>').join('') + '</div>';
  if (tab === 'news') {
    if (ev && ev.headlines) s += ev.headlines.map((h) => '<div class="review"><div class="tiny mute">' + h.outlet + ' · event coverage</div><div class="headline">' + U.esc(h.text) + '</div></div>').join('');
    s += '<div class="row between mb8"><b>Average review score</b><span class="tag" style="color:' + MED.scoreColor(p.reviewAvg) + '">' + p.reviewAvg.toFixed(1) + ' / 10</span></div>';
    s += p.reviews.map((r) => '<div class="review"><div class="row top"><div class="score" style="background:' + MED.scoreColor(r.score) + '22;color:' + MED.scoreColor(r.score) + '">' + r.score.toFixed(1) + '</div><div class="grow"><div class="tiny mute">' + r.outlet + '</div><div class="headline">' + U.esc(r.headline) + '</div></div></div><div class="grid2 mt8 small"><div class="good">' + r.pros.map((x) => '+ ' + x).join('<br>') + '</div><div class="bad">' + r.cons.map((x) => '− ' + x).join('<br>') + '</div></div><div class="small mute mt8">' + r.verdict + '</div></div>').join('');
  } else if (tab === 'video') {
    s += m.videos.map((v, i) => '<div class="video"><div class="thumb" style="background:linear-gradient(135deg,' + p.color + ',hsl(' + i * 70 + ',70%,30%))"><div style="position:absolute;inset:0;display:grid;place-items:center;font-size:26px">📱</div><span class="dur">' + v.mins + '</span></div><div class="grow"><b class="small">' + U.esc(v.title) + '</b><div class="tiny mute">' + v.channel + ' · ' + U.num(v.views) + ' views · 👍 ' + U.num(v.likes) + '</div></div></div>').join('');
  } else if (tab === 'tests') {
    s += '<div class="card flat"><h3>🎮 Gaming (High, 15 min)</h3>' + m.gameTests.map((g) => H.stat(g.game, g.avg + ' FPS avg · ' + g.low + ' low · ' + g.maxT + '°C' + (g.over ? ' 🔥' : ''))).join('') + '</div>';
    s += '<div class="card flat"><h3>📷 Camera</h3>' + ['day', 'night', 'video', 'zoom', 'selfie'].map((k) => H.stat(k, m.camera[k])).join('') + H.stat('<b>Overall</b>', '<b>' + m.camera.score + '</b>') + '</div>';
    s += '<div class="card flat"><h3>🔋 Battery</h3>' + H.stat('Screen-on time', m.battery.sot + ' h') + H.stat('Rank', '#' + m.battery.rank + ' of ' + m.battery.n) + H.stat('Full charge', m.battery.charge + ' min') + '</div>';
  } else if (tab === 'bench') {
    s += '<table class="tbl"><tr><th>#</th><th>Phone</th><th class="r">QuantaBench</th><th class="r">Price</th></tr>' + m.bench.map((b, i) => '<tr class="' + (b.me ? 'me' : '') + '"><td>' + (i + 1) + '</td><td>' + U.esc(b.name) + '</td><td class="r">' + U.num(b.total) + '</td><td class="r">' + U.money(b.price) + '</td></tr>').join('') + '</table>';
  } else {
    s += '<div class="kpis">' + H.kpi('Mentions', U.num(m.social.mentions), m.social.tag) + H.kpi('Sentiment', U.pct(m.social.sentiment, 0), m.social.sentiment > 0.6 ? 'positive' : m.social.sentiment > 0.4 ? 'mixed' : 'negative', m.social.sentiment > 0.6 ? 'good' : m.social.sentiment < 0.4 ? 'bad' : '') + '</div>';
    if (m.social.trending) s += '<div class="tag gold">🔥 Trending: ' + m.social.tag + '</div> ';
    m.social.memes.forEach((t) => (s += '<span class="tag bad">😂 ' + t + '</span> '));
    if (ev && ev.preorders != null) s += '<div class="card flat mt12">' + H.stat('Preorders (first 48h)', U.num(ev.preorders)) + H.stat('Livestream viewers', U.num(ev.viewers)) + '</div>';
    s += '<div class="mt12">' + m.comments.map((c) => '<div class="comment"><div class="u">@' + c.user + '</div>' + U.esc(c.text) + ' <span class="tiny dim">👍 ' + U.num(c.likes) + '</span></div>').join('') + '</div>';
  }
  UI.modal(s);
};
UI.A.medTab = (el) => { MED.tab = el.dataset.v; MED.show(S.phoneById(el.dataset.id), el.dataset.ev || null); };
