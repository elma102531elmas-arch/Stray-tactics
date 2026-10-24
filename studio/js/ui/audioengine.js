// Web Audio engine used by the Audio Studio ("Listen") and the playtest. The RULES (distance curves, occlusion, zones, footsteps,
// reverb impulses, bus mute/solo) live in core/audio.js and are unit-tested; this file only turns them into Web Audio nodes:
//
//   voice ─ gain (distance × occlusion × volume) ─ low-pass (occlusion) ─ panner ─┬─ bus[sfx|ambience|music|voice] ─┐
//                                                                                 └─ send ─ reverb ─ wet ──────────┤
//   master ← muffle low-pass (zones) ← pre ←────────────────────────────────────────────────────────────────────────┘
//
// Loudness is applied by us (one implementation, tested); the PannerNode only pans (its own attenuation is switched off).

import * as THREE from '../../lib/three.module.js';
import { audioContext } from './audioctx.js';
import { BUS_IDS, audioSettings, busLevels, hearSource, impulseResponse, reverbParams, REVERB_PRESETS, pickFootstep } from '../core/audio.js';

const TC = 0.03;                       // seconds: smoothing for every parameter change (no zipper noise, no clicks)
const D2R = Math.PI / 180;

export class AudioEngine {
  constructor(app, { ctx = null } = {}) {
    this.app = app; this.ac = ctx || audioContext(app);
    const ac = this.ac;
    this.master = ac.createGain();
    this.muffle = ac.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000;
    this.pre = ac.createGain();
    this.pre.connect(this.muffle); this.muffle.connect(this.master); this.master.connect(ac.destination);
    this.masterMeter = this._meter(this.master);
    this.buses = {};
    for (const b of BUS_IDS) { const g = ac.createGain(); g.connect(this.pre); this.buses[b] = { gain: g, meter: this._meter(g) }; }
    // reverb: every voice sends into `send`; the convolver's impulse is swapped (crossfaded) when the reverb preset changes
    this.send = ac.createGain();
    this.conv = ac.createConvolver(); this.wet = ac.createGain(); this.wet.gain.value = 0;
    this.send.connect(this.conv); this.conv.connect(this.wet); this.wet.connect(this.pre);
    this.preset = 'none'; this._irCache = new Map();
    this.voices = new Map();            // key -> voice
    this.loops = { ambience: null, music: null };
    this.timeSec = 0; this.stats = { started: 0, oneShots: 0, footsteps: 0, failed: [] };
    this.settings = audioSettings(app.project.data);
    this.listener = { pos: new THREE.Vector3(), yaw: 0 };
    this.zonesState = { ambience: null, music: null, muffle: 0, reverb: 'none' };
    this.applySettings(this.settings, true);
  }

  _meter(node) { const a = this.ac.createAnalyser(); a.fftSize = 512; node.connect(a); return { an: a, buf: new Float32Array(a.fftSize) }; }
  /** RMS level 0–1 of a bus ('master' for the final mix). */
  level(bus = 'master') {
    const m = bus === 'master' ? this.masterMeter : this.buses[bus]?.meter; if (!m) return 0;
    m.an.getFloatTimeDomainData(m.buf);
    let s = 0; for (const v of m.buf) s += v * v;
    return Math.sqrt(s / m.buf.length);
  }

  // ------------------------------------------------------------------ mixer
  applySettings(settings = audioSettings(this.app.project.data), immediate = false) {
    this.settings = settings;
    const t = this.ac.currentTime, set = (param, v) => (immediate ? (param.value = v) : param.setTargetAtTime(v, t, TC));
    set(this.master.gain, settings.master);
    const lv = busLevels(settings);
    for (const b of BUS_IDS) set(this.buses[b].gain.gain, lv[b]);
    this.setReverb(this.preset, true);                       // overrides may have changed
  }

  /** Switch the room reverb. Impulses are generated once per parameter set (deterministic, see core/audio.js). */
  setReverb(preset, force = false) {
    const p = reverbParams(this.settings, preset || 'none');
    const key = JSON.stringify([preset, p]);
    if (!force && preset === this.preset && key === this._irKey) return;
    this.preset = preset || 'none'; this._irKey = key;
    const t = this.ac.currentTime;
    if (!(p.decay > 0) || p.wet <= 0) { this.wet.gain.setTargetAtTime(0, t, 0.15); return; }
    let buf = this._irCache.get(key);
    if (!buf) {
      const ir = impulseResponse(p, this.ac.sampleRate, 1);
      buf = this.ac.createBuffer(2, ir.length, this.ac.sampleRate); buf.copyToChannel(ir.channels[0], 0); buf.copyToChannel(ir.channels[1], 1);
      this._irCache.set(key, buf);
    }
    this.wet.gain.setTargetAtTime(0, t, 0.05);                // duck, swap the impulse, bring the new reverb up (no click)
    setTimeout(() => { this.conv.buffer = buf; this.wet.gain.setTargetAtTime(p.wet, this.ac.currentTime, 0.15); }, 90);
    this.reverbWet = p.wet;
  }
  setMuffle(hz) { this.zonesState.muffle = hz || 0; this.muffle.frequency.setTargetAtTime(hz > 0 ? hz : 20000, this.ac.currentTime, 0.1); }

  setListener(pos, yawDeg = 0) {
    this.listener.pos.copy(pos); this.listener.yaw = yawDeg;
    const L = this.ac.listener, t = this.ac.currentTime;
    const set = (param, v) => { if (param) param.setValueAtTime(v, t); };
    set(L.positionX, pos.x); set(L.positionY, pos.y); set(L.positionZ, pos.z);
    set(L.forwardX, -Math.sin(yawDeg * D2R)); set(L.forwardY, 0); set(L.forwardZ, -Math.cos(yawDeg * D2R)); set(L.upX, 0); set(L.upY, 1); set(L.upZ, 0);
    if (!L.positionX && L.setPosition) { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(-Math.sin(yawDeg * D2R), 0, -Math.cos(yawDeg * D2R), 0, 1, 0); }
  }

  // ------------------------------------------------------------------ voices
  async _buffer(assetId) { return this.app.assets.loadAudio(assetId, this.ac); }

  /** A positional (or flat, when pos is null) one-shot or loop. Returns the voice; `gain` is the per-voice loudness (before bus/master). */
  async playVoice(key, assetId, { bus = 'sfx', loop = false, pos = null, volume = 1, rate = 1, send = 0.3, startAt = 0, gain: gain0 = 0, onEnd = null } = {}) {
    if (this.voices.has(key)) this.stopVoice(key, 0.02);
    let buffer;
    try { buffer = await this._buffer(assetId); } catch (e) { this.stats.failed.push({ asset: assetId, message: e.message }); return null; }
    if (this.voices.has(key)) return this.voices.get(key);             // a second call raced us
    const ac = this.ac, src = ac.createBufferSource(); src.buffer = buffer; src.loop = loop; src.playbackRate.value = rate;
    const gain = ac.createGain(); gain.gain.value = gain0;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000;
    let last = lp, panner = null;
    src.connect(gain); gain.connect(lp);
    if (pos) {
      panner = ac.createPanner(); panner.panningModel = 'equalpower'; panner.distanceModel = 'linear'; panner.rolloffFactor = 0;       // pan only
      panner.refDistance = 1; panner.maxDistance = 10000;
      if (panner.positionX) { panner.positionX.value = pos.x; panner.positionY.value = pos.y; panner.positionZ.value = pos.z; } else panner.setPosition(pos.x, pos.y, pos.z);
      lp.connect(panner); last = panner;
    }
    last.connect(this.buses[bus]?.gain || this.buses.sfx.gain);
    const snd = ac.createGain(); snd.gain.value = send; last.connect(snd); snd.connect(this.send);
    const voice = { key, assetId, bus, loop, pos: pos ? pos.clone() : null, src, gain, lp, panner, snd, volume, target: gain0, cutoff: 20000, ended: false, startedAt: this.timeSec };
    src.onended = () => { voice.ended = true; if (this.voices.get(key) === voice) this.voices.delete(key); try { src.disconnect(); gain.disconnect(); lp.disconnect(); panner?.disconnect(); snd.disconnect(); } catch { /* already disconnected */ } onEnd?.(voice); };
    src.start(0, startAt);
    this.voices.set(key, voice); this.stats.started++;
    return voice;
  }
  setVoice(voice, { gain, cutoff, send, tc = TC }) {
    const t = this.ac.currentTime;
    if (gain !== undefined) { voice.target = gain; voice.gain.gain.setTargetAtTime(gain, t, tc); }
    if (cutoff !== undefined) { voice.cutoff = cutoff; voice.lp.frequency.setTargetAtTime(cutoff, t, 0.05); }
    if (send !== undefined) voice.snd.gain.setTargetAtTime(send, t, TC);
  }
  stopVoice(key, fade = 0.05) {
    const v = this.voices.get(key); if (!v) return;
    this.voices.delete(key);
    const t = this.ac.currentTime; v.gain.gain.cancelScheduledValues(t); v.gain.gain.setTargetAtTime(0, t, Math.max(0.005, fade / 3));
    try { v.src.stop(t + fade + 0.05); } catch { /* already stopped */ }
  }
  stopAll() { for (const k of [...this.voices.keys()]) this.stopVoice(k, 0.03); this.loops = { ambience: null, music: null }; }

  /** One-shot at the sfx bus (or another). `at` = world position for panning/attenuation, else heard flat. */
  async playOneShot(assetId, { bus = 'sfx', volume = 1, rate = 1, at = null, props = null } = {}) {
    this.stats.oneShots++;
    const key = `oneshot:${this.stats.oneShots}`;
    const v = await this.playVoice(key, assetId, { bus, volume, rate, pos: at, gain: volume });
    if (v) v.target = volume;
    return v;
  }
  async playFootstep(assetId, surface) {
    this.stats.footsteps++;
    const level = 0.7 + Math.random() * 0.2;
    const v = await this.playVoice(`step:${this.stats.footsteps}`, assetId, { bus: 'sfx', rate: 0.94 + Math.random() * 0.12, send: 0.15, gain: level });
    if (v) v.surface = surface;
    return v;
  }

  // ------------------------------------------------------------------ scene audio (sources + zones)
  /** audio = core collectAudio() result. Sources start by themselves (autoplay), on their event, or at random intervals. */
  loadScene(audio) {
    this.audio = audio; this.sourceState = new Map();
    for (const s of audio.sources) this.sourceState.set(s.id, { src: s, nextAt: 0, played: false, starting: false, byEvent: false });
  }
  fireEvent(name) {
    for (const st of this.sourceState?.values() || []) if (st.src.props.playOnEvent === name && st.src.props.asset) { st.byEvent = true; st.played = false; }
  }

  /**
   * Per-frame driver: listener, loudness/occlusion of every source, zone loops, reverb and muffling.
   * world = CollisionWorld (occlusion), zones = core zonesAt() result, reverb = preset name, isEnabled(node) = runtime enable/disable.
   */
  update(dt, { pos, yaw = 0, world, zones = null, reverb = null, isEnabled = () => true, rng = Math.random } = {}) {
    this.timeSec += dt;
    this.setListener(pos, yaw);
    const flat = { ...this.settings, master: 1, mute: {}, solo: '', buses: { sfx: 1, ambience: 1, music: 1, voice: 1 } };       // bus nodes apply bus/master themselves
    for (const st of this.sourceState?.values() || []) {
      const s = st.src, p = s.props, key = 'src:' + s.id;
      if (!p.asset || !isEnabled(s.node)) { if (this.voices.has(key)) this.stopVoice(key, 0.1); continue; }
      const eligible = p.autoplay || st.byEvent, random = p.interval > 0 && !p.loop;
      if (eligible && !this.voices.has(key) && !st.starting) {
        let go = false;
        if (random) { if (this.timeSec >= st.nextAt) { go = true; st.nextAt = this.timeSec + p.interval * (0.5 + rng()); } }
        else if (p.loop || !st.played) { go = true; st.played = true; }
        if (go) {
          st.starting = true;
          this.playVoice(key, p.asset, { bus: p.bus, loop: !!p.loop, pos: new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z), volume: p.volume, rate: p.pitch || 1, send: p.reverbSend ?? 0.3 }).then(() => { st.starting = false; });
        }
      }
      const v = this.voices.get(key);
      if (v) {
        const hear = hearSource(s, pos, world, flat);
        this.setVoice(v, { gain: hear.attenuation * hear.occlusionGain * p.volume, cutoff: hear.cutoff, send: p.reverbSend ?? 0.3 });
      }
    }
    if (zones) this._zones(zones);
    if (reverb) this.setReverb(reverb);
  }

  /** Ambience and music loops follow the winning zone of their kind, crossfading over the zone's fade time. */
  _zones(z) {
    for (const kind of ['ambience', 'music']) {
      const w = z[kind], cur = this.loops[kind];
      if (w && cur && w.id === cur.zoneId) { const v = this.voices.get(cur.key); if (v) this.setVoice(v, { gain: w.props.volume ?? 1, tc: Math.max(0.03, (w.props.fade ?? 1.5) / 3) }); continue; }
      if (cur) { this._retire(cur.key, cur.fade); this.loops[kind] = null; }
      if (!w) continue;
      const key = `zone:${kind}:${w.id}`, fade = w.props.fade ?? 1.5;
      this.loops[kind] = { zoneId: w.id, key, fade, name: w.name };
      this.playVoice(key, w.props.asset, { bus: kind, loop: true, send: 0.2, gain: 0 }).then((v) => {
        if (!v) return;
        if (this.loops[kind]?.key !== key) { this._retire(key, 0.1); return; }          // the listener left this zone while the sound was loading
        this.setVoice(v, { gain: w.props.volume ?? 1, tc: Math.max(0.03, fade / 3) });
      });
    }
    this.setMuffle(z.muffle?.props.muffle || 0);
  }
  _retire(key, fade = 1) {
    const v = this.voices.get(key); if (!v) return;
    this.voices.delete(key);
    const t = this.ac.currentTime; v.gain.gain.cancelScheduledValues(t); v.gain.gain.setTargetAtTime(0, t, Math.max(0.02, fade / 4));
    try { v.src.stop(t + fade + 0.3); } catch { /* ended */ }
  }

  /** What the tests and the Audio tab can inspect without touching Web Audio parameters. */
  snapshot() {
    return {
      state: this.ac.state, reverb: this.preset, muffle: this.zonesState.muffle, loops: { ambience: this.loops.ambience?.name || null, music: this.loops.music?.name || null },
      voices: [...this.voices.values()].map((v) => ({ key: v.key, asset: v.assetId, bus: v.bus, loop: v.loop, gain: v.target, cutoff: v.cutoff, positional: !!v.pos })),
      stats: { ...this.stats },
    };
  }

  dispose() {
    this.stopAll();
    setTimeout(() => { try { this.master.disconnect(); } catch { /* gone */ } }, 300);
  }
}

export { REVERB_PRESETS, pickFootstep };
