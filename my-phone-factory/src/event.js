/* =========================================================
   LAUNCH EVENTS — planning, costs, outcomes
   ========================================================= */
const EV = {};
EV.venues = [
  { id: 'garage', name: 'Garage Studio', cap: 40, cost: 2500, prestige: 0.1, wall: '#3a2a22', kind: 'garage' },
  { id: 'loft', name: 'Co-working Loft', cap: 120, cost: 9000, prestige: 0.2, wall: '#2b2f38', kind: 'loft' },
  { id: 'hotel', name: 'Hotel Ballroom', cap: 500, cost: 55000, prestige: 0.35, wall: '#3a2032', kind: 'hall' },
  { id: 'theater', name: 'Historic Theater', cap: 1800, cost: 180000, prestige: 0.5, wall: '#3b1218', kind: 'theater' },
  { id: 'convention', name: 'Convention Center', cap: 6000, cost: 1.1e6, prestige: 0.65, wall: '#141a26', kind: 'hall' },
  { id: 'arena', name: 'Concert Arena', cap: 18000, cost: 5.5e6, prestige: 0.8, wall: '#0b0e18', kind: 'arena' },
  { id: 'stadium', name: 'Stadium', cap: 65000, cost: 22e6, prestige: 0.9, wall: '#0a1020', kind: 'stadium' },
  { id: 'sphere', name: 'Immersive LED Sphere', cap: 17000, cost: 38e6, prestige: 1.0, wall: '#05060c', kind: 'sphere', year: 2023 },
];
EV.cities = [
  { id: 'sf', name: 'San Francisco', r: 'na', m: 1.35 }, { id: 'ny', name: 'New York', r: 'na', m: 1.4 }, { id: 'lon', name: 'London', r: 'eu', m: 1.3 },
  { id: 'ber', name: 'Berlin', r: 'eu', m: 1.05 }, { id: 'par', name: 'Paris', r: 'eu', m: 1.2 }, { id: 'ist', name: 'Istanbul', r: 'eu', m: 0.7 },
  { id: 'dxb', name: 'Dubai', r: 'mea', m: 1.1 }, { id: 'sha', name: 'Shanghai', r: 'cn', m: 0.95 }, { id: 'szx', name: 'Shenzhen', r: 'cn', m: 0.8 },
  { id: 'sel', name: 'Seoul', r: 'eas', m: 1.0 }, { id: 'tyo', name: 'Tokyo', r: 'eas', m: 1.25 }, { id: 'bom', name: 'Mumbai', r: 'in', m: 0.55 },
  { id: 'sao', name: 'São Paulo', r: 'latam', m: 0.7 }, { id: 'sin', name: 'Singapore', r: 'sea', m: 1.15 },
];
EV.stages = [{ id: 'small', name: 'Small', w: 9, d: 5.5, m: 1 }, { id: 'medium', name: 'Medium', w: 14, d: 7, m: 2.2 }, { id: 'large', name: 'Large', w: 20, d: 9, m: 4 }, { id: 'mega', name: 'Mega', w: 30, d: 12, m: 7 }];
EV.archs = [{ id: 'flat', name: 'Flat stage', m: 1, mood: 0 }, { id: 'thrust', name: 'Thrust runway', m: 1.3, mood: 2 }, { id: 'tiered', name: 'Tiered platforms', m: 1.2, mood: 1 }, { id: 'round', name: 'In-the-round', m: 1.5, mood: 3 }, { id: 'cube', name: 'Floating LED cube', m: 2.2, mood: 5, year: 2018 }];
EV.streams = [
  { id: 'web', name: 'Company website', cost: 1000, v: 1, year: 2010 }, { id: 'videohub', name: 'VideoHub', cost: 5000, v: 3, year: 2010 },
  { id: 'livecast', name: 'LiveCast', cost: 8000, v: 1.5, year: 2011 }, { id: 'social', name: 'SocialLive', cost: 6000, v: 2, year: 2016 },
  { id: 'clips', name: 'ShortClips', cost: 10000, v: 2.5, year: 2019 }, { id: 'tv', name: 'TechNet TV broadcast', cost: 150000, v: 4, year: 2010 },
];
EV.guests = [
  { id: 'none', name: 'No guest', cost: 0, p: 0 }, { id: 'blogger', name: 'Local tech blogger', cost: 2000, p: 0.08 }, { id: 'youtuber', name: 'Star tech YouTuber', cost: 30000, p: 0.2 },
  { id: 'esports', name: 'Pro esports team', cost: 150000, p: 0.25, gaming: true }, { id: 'athlete', name: 'World-famous athlete', cost: 1.5e6, p: 0.38 },
  { id: 'director', name: 'Hollywood director', cost: 3e6, p: 0.4, trailer: true }, { id: 'popstar', name: 'Global pop star (live)', cost: 8e6, p: 0.6 },
];
EV.lights = [{ id: 'basic', name: 'Basic', cost: 2000, heat: 0.5, mood: 0 }, { id: 'theatre', name: 'Theatrical', cost: 25000, heat: 1.5, mood: 2 }, { id: 'concert', name: 'Concert rig', cost: 250000, heat: 3, mood: 4 }, { id: 'laser', name: 'Laser show', cost: 900000, heat: 4, mood: 6 }, { id: 'holo', name: 'Holographic', cost: 3e6, heat: 5, mood: 8, year: 2022 }];
EV.music = [{ id: 'none', name: 'None', cost: 0, mood: 0 }, { id: 'stock', name: 'Stock tracks', cost: 500, mood: 1 }, { id: 'dj', name: 'Live DJ', cost: 15000, mood: 2 }, { id: 'orch', name: 'Orchestra', cost: 300000, mood: 4 }, { id: 'band', name: 'Famous band', cost: 2e6, mood: 7 }];
EV.effects = [{ id: 'haze', name: 'Haze', cost: 3000, mood: 1 }, { id: 'confetti', name: 'Confetti finale', cost: 8000, mood: 2 }, { id: 'co2', name: 'CO₂ jets', cost: 60000, mood: 2 }, { id: 'pyro', name: 'Pyrotechnics', cost: 120000, mood: 3, minVenue: 4 }, { id: 'drones', name: 'Drone light show', cost: 400000, mood: 4, year: 2016 }, { id: 'ar', name: 'AR overlays (stream)', cost: 250000, mood: 3, year: 2020 }];
EV.backgrounds = [{ id: 'white', name: 'Minimal White', a: '#f4f6fa', b: '#c9d2e3', ink: '#0b1020' }, { id: 'space', name: 'Deep Space', a: '#05061a', b: '#1b1650', ink: '#ffffff' }, { id: 'neon', name: 'Neon Grid', a: '#0a0220', b: '#ff2d9a', ink: '#ffffff' }, { id: 'aurora', name: 'Aurora', a: '#022a2a', b: '#3ddc84', ink: '#ffffff' }, { id: 'brand', name: 'Brand Gradient', a: null, b: null, ink: '#ffffff' }];
EV.demos = [{ id: 'none', name: 'No hands-on area', cost: 0, q: 0 }, { id: 'small', name: 'Small hands-on area', cost: 10000, q: 0.4 }, { id: 'large', name: 'Large demo zone', cost: 80000, q: 0.7 }, { id: 'exp', name: 'Experience pavilion', cost: 500000, q: 1 }];
EV.trailers = [{ id: 'none', name: 'No trailer', cost: 0, q: 0 }, { id: 'basic', name: 'Basic product video', cost: 8000, q: 0.3 }, { id: 'pro', name: 'Agency production', cost: 120000, q: 0.6 }, { id: 'cine', name: 'Cinematic', cost: 1.5e6, q: 0.85 }, { id: 'holly', name: 'Hollywood blockbuster', cost: 8e6, q: 1 }];
EV.outfits = [{ id: 'turtle', name: 'Black turtleneck', c: '#15171c', l: '#2a2f3a' }, { id: 'hoodie', name: 'Hoodie', c: '#3a4a66', l: '#1d2433' }, { id: 'suit', name: 'Sharp suit', c: '#20283a', l: '#11151f' }, { id: 'leather', name: 'Leather jacket', c: '#0c0c0c', l: '#2b2b2b' }, { id: 'tee', name: 'Brand T-shirt', c: null, l: '#2a3348' }];
EV.find = (list, id) => list.find((x) => x.id === id) || list[0];
EV.avail = (x) => !x.year || x.year <= S.fy();

EV.newPlan = (phoneId) => {
  const p = S.phoneById(phoneId);
  const homeCity = { na: 'sf', eu: G.co.hq === 'tr' ? 'ist' : G.co.hq === 'de' ? 'ber' : 'lon', cn: 'szx', in: 'bom', eas: G.co.hq === 'jp' ? 'tyo' : 'sel', sea: 'sin', latam: 'sao', mea: 'dxb' }[G.co.market] || 'sf';
  const cheap = G.cash < 2e5;
  return {
    phoneId, extraId: null, name: (G.co.name.split(' ')[0] || 'MY').toUpperCase() + ' NEXT ' + S.year(), city: homeCity, venue: cheap ? 'garage' : 'hotel', stage: 'small', arch: 'flat', cap: cheap ? 40 : 300,
    streams: ['web', 'videohub'], ads: 0, press: cheap ? 5 : 30, analysts: 0, retail: 0, devs: 0, guest: 'none', duration: 45, light: cheap ? 'basic' : 'theatre', music: 'stock', fx: [], bg: 'space', demo: 'small', rehearsal: 1, trailer: 'basic', outfit: 'turtle', avail: 0,
  };
};
EV.cost = (pl) => {
  const city = EV.find(EV.cities, pl.city), v = EV.find(EV.venues, pl.venue), st = EV.find(EV.stages, pl.stage), ar = EV.find(EV.archs, pl.arch);
  const inf = S.infl() * city.m;
  const items = [];
  const add = (k, c) => { if (c > 0) items.push([k, Math.round(c)]); };
  add('Venue · ' + v.name, v.cost * inf);
  add('Stage (' + st.name + ', ' + ar.name + ')', 3000 * st.m * ar.m * (0.5 + v.prestige * 2) * inf);
  add('Seating & logistics', pl.cap * 15 * inf);
  add('Live streaming', U.sum(pl.streams, (id) => EV.find(EV.streams, id).cost) * S.infl());
  add('Advertising campaign', pl.ads);
  add('Press travel & hosting', pl.press * 400 * inf);
  add('Analysts', pl.analysts * 600 * inf);
  add('Retail & carrier partners', pl.retail * 500 * inf);
  add('Developer invites', pl.devs * 150 * inf);
  add('Special guest', EV.find(EV.guests, pl.guest).cost * S.infl());
  add('Lighting', EV.find(EV.lights, pl.light).cost * inf);
  add('Music', EV.find(EV.music, pl.music).cost * inf);
  pl.fx.forEach((id) => { const f = EV.find(EV.effects, id); add('Effect · ' + f.name, f.cost * inf); });
  add('Hands-on area', EV.find(EV.demos, pl.demo).cost * inf);
  add('Rehearsals (' + pl.rehearsal + ' days)', pl.rehearsal * v.cost * 0.08 * inf);
  add('Trailer production', EV.find(EV.trailers, pl.trailer).cost * S.infl());
  add('Duration (' + pl.duration + ' min crew time)', (pl.duration / 45) * 1500 * (0.5 + v.prestige * 4) * inf);
  return { items, total: U.sum(items, (x) => x[1]) };
};
EV.viewers = (pl) => {
  const aw = U.avg(D.regionIds.filter((r) => G.regions[r].entered), (r) => G.regions[r].aware) || 0.01;
  const yr = Math.pow(1.22, Math.min(16, S.fy() - 2010));
  const base = U.sum(pl.streams, (id) => EV.find(EV.streams, id).v) * 9000 * (aw + 0.015) * yr * (1 + G.rep / 40);
  const ads = Math.sqrt(1 + pl.ads / (40000 * S.infl()));
  const guest = 1 + EV.find(EV.guests, pl.guest).p * 2;
  return Math.round(base * ads * guest);
};
EV.extras = (pl) => {
  const list = [];
  G.phones.filter((p) => p.status === 'ready' && p.id !== pl.phoneId).forEach((p) => list.push(['phone:' + p.id, '📱 ' + p.name]));
  G.chips.filter((c) => c.status === 'ready' && !c.revealed).forEach((c) => list.push(['chip:' + c.id, '🧠 ' + c.name + ' chip']));
  if (S.has('os_own') && !G.flags.osRevealed) list.push(['os:1', '💻 ' + G.co.name.split(' ')[0] + ' OS']);
  return list;
};

/* ---------------- Launch page ---------------- */
UI.pages.launch = () => {
  if (UI.plan) return EV.planner();
  let s = H.title('🎤', 'Launch Center', 'Reveal phones on stage or release them quietly');
  const ready = G.phones.filter((p) => p.status === 'ready');
  s += '<div class="card"><h3>✅ Ready to launch</h3>';
  if (!ready.length) s += '<div class="empty"><div class="e">⏳</div>No finished phones yet. Phones in development appear here when engineering completes.</div>';
  ready.forEach((p) => {
    const st = S.stats(p);
    s += '<div class="techItem"><div class="row between"><div class="row">' + H.phoneIcon(p) + '<div><b>' + U.esc(p.name) + '</b><div class="small mute">' + U.money(p.price) + ' · Quality ' + st.qual.q.toFixed(0) + ' · stock ' + U.num(G.inventory[p.id] || 0) + '</div></div></div></div>' +
      '<div class="row wrap mt12"><button class="btn pri" data-a="planEvent" data-id="' + p.id + '">🎤 Plan a launch event</button><button class="btn" data-a="quietRelease" data-id="' + p.id + '">📦 Quiet release</button><button class="btn" data-a="labPhone" data-id="' + p.id + '">🧪 Test first</button></div>' +
      ((G.inventory[p.id] || 0) < 100 ? '<div class="tiny warn mt8">Tip: build up stock in FACTORY before launching, or early demand will be wasted.</div>' : '') + '</div>';
  });
  s += '</div>';
  const ann = G.phones.filter((p) => p.status === 'announced');
  if (ann.length) s += '<div class="card"><h3>📣 Announced · preorders open</h3>' + ann.map((p) => '<div class="stat"><span class="k">' + U.esc(p.name) + ' · ships ' + U.dateStr(p.releaseAt) + '</span><span class="v">' + U.num(p.preorders || 0) + ' preorders · stock ' + U.num(G.inventory[p.id] || 0) + '</span></div>').join('') + '</div>';
  s += '<div class="card"><h3>🎬 Past events</h3>';
  if (!G.events.length) s += '<div class="small mute">No events yet. Your first keynote could change everything — or nothing.</div>';
  G.events.slice().reverse().forEach((e) => {
    s += '<div class="techItem"><div class="row between"><div><b>' + U.esc(e.name) + '</b><div class="small mute">' + U.dateStr(e.t) + ' · ' + U.esc(e.venueName) + ', ' + U.esc(e.cityName) + ' · ' + U.money(e.cost) + '</div></div><span class="tag" style="color:' + MED.scoreColor(e.score / 10) + '">' + e.score.toFixed(0) + '/100</span></div>' +
      '<div class="small mt8">' + U.esc(e.summary || '') + '</div><div class="row wrap mt8">' + (e.replay ? '<button class="btn sm" data-a="replay" data-id="' + e.id + '">▶ Watch replay</button>' : '<span class="tiny dim">Replay archived</span>') + (S.phoneById(e.phoneId) && S.phoneById(e.phoneId).media ? '<button class="btn sm" data-a="showMedia" data-id="' + e.phoneId + '" data-ev="' + e.id + '">📰 Coverage</button>' : '') + '</div></div>';
  });
  s += '</div>';
  return s;
};
UI.A.quietRelease = (el) => {
  const p = S.phoneById(el.dataset.id);
  UI.confirm('Quiet release?', 'No event, no hype: the phone simply goes on sale. Fewer reviewers will cover it. Certification for your ' + D.regionIds.filter((r) => G.regions[r].entered).length + ' region(s) costs ' + U.money(9000 * D.regionIds.filter((r) => G.regions[r].entered).length * S.infl()) + '.', () => { S.releasePhone(p); UI.toast('📦 ' + U.esc(p.name) + ' is on sale.', 'good'); }, 'Release');
};
UI.A.planEvent = (el) => { UI.plan = EV.newPlan(el.dataset.id); UI.render(true); };
UI.A.cancelPlan = () => { UI.plan = null; UI.render(true); };
EV.planner = () => {
  const pl = UI.plan, p = S.phoneById(pl.phoneId);
  const cost = EV.cost(pl), v = EV.find(EV.venues, pl.venue);
  const sel = (k, list, fmt) => '<select data-ch="plSet" data-k="' + k + '">' + H.opts(list.map((x) => [x.id, x.name + (fmt ? fmt(x) : ''), !EV.avail(x)]), pl[k]) + '</select>';
  const rng = (k, min, max, step, label, f) => '<div class="field"><label>' + label + ' <span class="v" id="pl_' + k + '">' + f(pl[k]) + '</span></label><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + pl[k] + '" data-in="plRange" data-k="' + k + '" data-ch="plRangeDone"></div>';
  const inf = S.infl();
  let s = '<div class="ptitle"><button class="btn sm" data-a="cancelPlan">✕</button><div class="grow"><h2>Plan launch event</h2><div class="sub">Revealing <b>' + U.esc(p.name) + '</b></div></div></div><div class="designer"><div>';
  s += '<div class="card"><h3>🎟️ The event</h3><div class="field"><label>Event name</label><input type="text" maxlength="32" value="' + U.esc(pl.name) + '" data-in="plName"></div>' +
    '<div class="grid2"><div class="field"><label>City</label>' + sel('city', EV.cities, (c) => ' (' + D.regions[c.r].name.split(' ')[0] + ')') + '</div><div class="field"><label>Venue</label>' + sel('venue', EV.venues, (x) => ' · ' + U.num(x.cap) + ' seats') + '</div>' +
    '<div class="field"><label>Stage size</label>' + sel('stage', EV.stages) + '</div><div class="field"><label>Stage architecture</label>' + sel('arch', EV.archs) + '</div>' +
    '<div class="field"><label>Presentation duration</label><select data-ch="plSet" data-k="duration">' + H.opts([30, 45, 60, 90, 120].map((m) => [m, m + ' minutes']), pl.duration) + '</select></div><div class="field"><label>Presenter outfit</label>' + sel('outfit', EV.outfits) + '</div></div>' +
    rng('cap', 10, v.cap, Math.max(10, Math.round(v.cap / 100)), 'Audience capacity', (x) => U.num(x) + ' seats') + '</div>';
  s += '<div class="card"><h3>📡 Reach</h3><div class="field"><label>Live streaming platforms</label><div class="seg">' + EV.streams.map((x) => '<button class="' + (pl.streams.includes(x.id) ? 'on' : '') + '" data-a="plToggle" data-k="streams" data-v="' + x.id + '" ' + (EV.avail(x) ? '' : 'disabled') + '>' + x.name + ' · ' + U.money(x.cost * inf) + '</button>').join('') + '</div></div>' +
    rng('ads', 0, Math.max(50000, Math.round(Math.min(5e7, Math.max(G.cash, 1e5)) / 1000) * 1000), 1000, 'Advertising campaign', (x) => U.money(x)) +
    '<div class="tiny mute">Expected livestream audience: <b>' + U.num(EV.viewers(pl)) + '</b> viewers</div></div>';
  s += '<div class="card"><h3>✉️ Invitations</h3>' + rng('press', 0, 500, 5, 'Press & journalists', (x) => x + ' (more reviews)') + rng('analysts', 0, 200, 5, 'Financial analysts', (x) => x + ' (investor confidence)') + rng('retail', 0, 200, 5, 'Retailers & carriers', (x) => x + ' (awareness)') + rng('devs', 0, 1000, 25, 'App developers', (x) => x + (S.has('os_own') ? ' (ecosystem)' : '')) +
    '<div class="field"><label>Special guest</label>' + sel('guest', EV.guests, (x) => (x.cost ? ' · ' + U.money(x.cost * inf) : '')) + '</div></div>';
  s += '<div class="card"><h3>💡 Production</h3><div class="grid2"><div class="field"><label>Lighting</label>' + sel('light', EV.lights, (x) => ' · ' + U.money(x.cost * inf)) + '</div><div class="field"><label>Music</label>' + sel('music', EV.music, (x) => (x.cost ? ' · ' + U.money(x.cost * inf) : '')) + '</div>' +
    '<div class="field"><label>Screen background</label>' + sel('bg', EV.backgrounds) + '</div><div class="field"><label>Demo area</label>' + sel('demo', EV.demos, (x) => (x.cost ? ' · ' + U.money(x.cost * inf) : '')) + '</div>' +
    '<div class="field"><label>Product trailer</label>' + sel('trailer', EV.trailers, (x) => (x.cost ? ' · ' + U.money(x.cost * inf) : '')) + '</div></div>' +
    '<div class="field"><label>Stage effects</label><div class="seg">' + EV.effects.map((x) => '<button class="' + (pl.fx.includes(x.id) ? 'on' : '') + '" data-a="plToggle" data-k="fx" data-v="' + x.id + '" ' + (EV.avail(x) && (!x.minVenue || EV.venues.indexOf(v) >= x.minVenue) ? '' : 'disabled') + '>' + x.name + '</button>').join('') + '</div></div>' +
    rng('rehearsal', 0, 10, 1, 'Rehearsal days', (x) => x + ' days (fewer demo failures)') +
    '<div class="tiny mute">Stage lights heat the room by ~' + EV.find(EV.lights, pl.light).heat + '°C — hot phones throttle sooner in live demos.</div></div>';
  const ex = EV.extras(pl);
  s += '<div class="card"><h3>✨ "One more thing…"</h3><select data-ch="plSet" data-k="extraId">' + H.opts([['', 'Nothing extra']].concat(ex), pl.extraId || '') + '</select><div class="tiny mute mt8">Surprise the audience with a second product.</div></div>';
  s += '</div><div class="side"><div class="card glow"><h3>💵 Budget</h3>' + cost.items.map(([k, c]) => H.stat(k, U.money(c))).join('') + '<hr class="sep">' + H.stat('<b>Total</b>', '<b class="' + (cost.total > G.cash ? 'bad' : '') + '">' + U.money(cost.total) + '</b>') +
    '<div class="tiny mute">Cash available: ' + U.money(G.cash) + '</div>' +
    '<button class="btn gold full big mt12" data-a="startEvent" ' + (cost.total > G.cash ? 'disabled' : '') + '>🎤 Go on stage</button>' +
    '<div class="tiny mute mt8">You will control the CEO on a live stage. Walk to glowing spots to present. Demos are simulated from your phone\'s real specs — they can fail.</div></div></div></div>';
  return s;
};
UI.C.plSet = (el) => { const v = el.value; UI.plan[el.dataset.k] = isNaN(+v) || v === '' ? (v || null) : +v; if (el.dataset.k === 'venue') { const ven = EV.find(EV.venues, v); UI.plan.cap = Math.min(UI.plan.cap, ven.cap); UI.plan.fx = UI.plan.fx.filter((id) => !EV.find(EV.effects, id).minVenue || EV.venues.indexOf(ven) >= EV.find(EV.effects, id).minVenue); } UI.render(); };
UI.I.plRange = (el) => { UI.plan[el.dataset.k] = +el.value; };
UI.C.plRangeDone = () => UI.render();
UI.I.plName = (el) => { UI.plan.name = el.value; };
UI.A.plToggle = (el) => { const arr = UI.plan[el.dataset.k], i = arr.indexOf(el.dataset.v); if (i >= 0) arr.splice(i, 1); else arr.push(el.dataset.v); UI.render(); };
UI.A.startEvent = () => {
  const pl = UI.plan, cost = EV.cost(pl);
  if (cost.total > G.cash) { UI.err('Not enough cash.'); return; }
  S.spend(cost.total, 'events');
  pl.costTotal = cost.total;
  UI.plan = null; UI.stopAuto();
  KN.start(pl);
};

/* ---------------- Outcome ---------------- */
EV.apply = (res) => {
  const pl = res.plan, p = S.phoneById(pl.phoneId);
  const city = EV.find(EV.cities, pl.city), v = EV.find(EV.venues, pl.venue);
  const attendees = Math.round(pl.cap * U.clamp(0.4 + G.rep / 120 + p.hype / 200 + (pl.ads > 0 ? 0.15 : 0), 0.3, 1));
  const viewers = Math.round(EV.viewers(pl) * (0.7 + res.score / 160));
  const reach = attendees * 3 + viewers + pl.press * 25000 * (0.4 + G.rep / 100);
  const reachF = Math.log10(1 + reach / 1000) / 3; // ~0..1.5
  const sc = res.score;
  // hype & awareness
  p.hype = U.clamp(p.hype + (sc - 35) * 0.9 * (0.5 + reachF), 0, 100);
  const globalBoost = reachF * Math.max(0, sc - 30) / 100 * 0.06;
  D.regionIds.forEach((r) => { const R = G.regions[r]; if (R.entered || R.entering) R.aware = U.clamp(R.aware + globalBoost * (1 - R.aware) + (r === city.r ? 0.04 * reachF * sc / 100 : 0) + pl.retail * 0.00008, 0, 0.98); });
  // reputation & investors
  const repD = (sc - 55) / 11 - res.failures.length * 1.2;
  G.rep = U.clamp(G.rep + repD, 0, 100);
  G.invConf = U.clamp(G.invConf + (sc - 50) / 6 + pl.analysts * 0.01 * (sc > 50 ? 1 : -1), 0, 100);
  if (S.has('os_own')) G.ownBase += pl.devs * 400;
  // extra product
  if (res.extra) { if (res.extra.kind === 'chip') { const c = S.chipById(res.extra.id); if (c) c.revealed = true; } if (res.extra.kind === 'os') G.flags.osRevealed = true; if (res.extra.kind === 'phone') { const ep = S.phoneById(res.extra.id); if (ep) { ep.hype = U.clamp(ep.hype + sc * 0.5, 0, 100); EV.schedule(ep, pl.avail); } } }
  // claims & release
  p.claims = res.claims || {};
  p.eventIds.push(res.id);
  EV.schedule(p, res.avail ?? pl.avail);
  if (res.priceFinal) { p.price = res.priceFinal; p._v++; }
  // preorders & coverage
  const st = S.stats(p);
  const preorders = Math.round((viewers * 0.004 + attendees * 0.05) * U.clamp(sc / 60, 0.1, 2) * (S.fairPrice(st.qual.q) / p.price) * (p.status === 'announced' ? 1 : 0.6));
  if (p.status === 'announced') { p.backlog += preorders; p.preorders = (p.preorders || 0) + preorders; }
  res.preorders = preorders; res.viewers = viewers; res.attendees = attendees;
  res.headlines = EV.headlines(p, res);
  MED.generateReviews(p, res);
  // competitor responses
  if (sc >= 78) { const r = U.pick(G.rivals.filter((x) => x.alive)); S.news('🗣️ ' + S.rivalDef(r.id).name + '\'s CEO on <b>' + U.esc(p.name) + '</b>: "' + U.pick(['Nobody needs that.', 'We are not worried.', 'Interesting. We\'ll see how it sells.', 'Imitation is the sincerest form of flattery.']) + '"', 'rival'); }
  // record
  const ev = { id: res.id, t: G.t, name: pl.name, phoneId: p.id, cost: pl.costTotal, score: sc, venueName: v.name, cityName: city.name, failures: res.failures, preorders, viewers, attendees, headlines: res.headlines, replay: res.replay,
    summary: (sc >= 80 ? 'Standing ovations. ' : sc >= 60 ? 'Warm reception. ' : sc >= 40 ? 'Mixed reactions. ' : 'A painful event. ') + U.num(viewers) + ' watched live, ' + U.num(preorders) + ' preorders.' + (res.failures.length ? ' Fails: ' + res.failures.join(', ') + '.' : '') };
  G.events.push(ev);
  G.events.forEach((e, i) => { if (i < G.events.length - 6) e.replay = null; });
  S.news('🎤 <b>' + U.esc(pl.name) + '</b>: ' + ev.summary + ' Event score ' + sc.toFixed(0) + '/100.', sc >= 60 ? 'big' : sc < 40 ? 'bad' : 'info');
  S.save('auto');
  return ev;
};
EV.schedule = (p, avail) => {
  if (p.status === 'onsale') return;
  if (!avail) S.releasePhone(p, { silent: false });
  else { p.status = 'announced'; p.preorderOpen = true; p.releaseAt = G.t + avail; S.news('📣 <b>' + U.esc(p.name) + '</b> announced — ships ' + U.dateStr(p.releaseAt) + '. Preorders are open.', 'good'); }
};
EV.headlines = (p, res) => {
  const out = [], N = p.name, sc = res.score;
  const outlets = U.shuffle(['TechPulse', 'The Circuit', 'GadgetGrid', 'MobileInsider', 'Daily Byte', 'Global Business Times']);
  if (res.failures.includes('overheat')) out.push('Live demo disaster: ' + N + ' overheats on stage');
  if (res.failures.includes('lowfps')) out.push(N + ' gaming demo stutters to ' + (res.fps || 18) + ' FPS in front of thousands');
  if (res.failures.includes('crash')) out.push('Awkward! Camera app crashes during ' + G.co.name + ' keynote');
  if (res.failures.includes('cheat')) out.push('Audience catches ' + G.co.name + ' gaming benchmarks — live');
  if (sc >= 85) out.push(U.pick([G.co.name + ' stuns the industry with ' + N, 'The keynote everyone is talking about', N + ' steals the show']));
  else if (sc >= 65) out.push(U.pick([G.co.name + ' unveils ' + N + ': here\'s everything announced', N + ' is official — and it looks promising']));
  else if (sc >= 45) out.push(U.pick([N + ' launch: solid phone, forgettable show', G.co.name + '\'s event left us wanting more']));
  else out.push(U.pick(['Was that it? ' + G.co.name + '\'s keynote falls flat', G.co.name + ' launch event: a masterclass in how not to launch a phone']));
  if (res.priceReaction != null && res.priceReaction < -0.4) out.push(U.money(res.priceFinal || p.price) + ' for the ' + N + '? Fans are not happy');
  if (res.priceReaction != null && res.priceReaction > 0.5) out.push('At ' + U.money(res.priceFinal || p.price) + ', the ' + N + ' is a steal');
  return out.slice(0, 4).map((t, i) => ({ outlet: outlets[i % outlets.length], text: t }));
};
UI.A.replay = (el) => { const e = G.events.find((x) => x.id === el.dataset.id); if (e && e.replay) KN.replay(e); };
