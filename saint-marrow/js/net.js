// Peer-to-peer co-op over PeerJS (WebRTC data channels). The host is authoritative for monsters,
// doors, pickups and story; everyone simulates their own body and sends it ~15 times a second.
const PREFIX = 'saintmarrow-v1-';
export const MAX_PLAYERS = 4;

export class Net {
  constructor(game) {
    this.game = game;
    this.peer = null;
    this.isHost = false;
    this.online = false;
    this.slot = 0;
    this.code = '';
    this.conns = new Map();   // host: peerId -> {conn, slot, name}
    this.hostConn = null;     // client
    this.players = [];        // [{slot, name}]
  }

  available() { return typeof window.Peer !== 'undefined'; }

  status() {
    if (window.__peerFailed) return 'peerFailed';
    if (!this.available()) return 'peerLoading';
    return null;
  }

  makeCode() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += c[(Math.random() * c.length) | 0];
    return s;
  }

  host(name, cb) {
    this.close();
    this.isHost = true;
    this.slot = 0;
    this.code = this.makeCode();
    this.players = [{ slot: 0, name }];
    const peer = new window.Peer(PREFIX + this.code, { debug: 0 });
    this.peer = peer;
    peer.on('open', () => { this.online = true; cb && cb('open'); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') { this.code = this.makeCode(); this.host(name, cb); return; }
      cb && cb('error', e.type);
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        if (this.conns.size >= MAX_PLAYERS - 1) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
        if (this.game.lockJoins) { conn.send({ t: 'busy' }); setTimeout(() => conn.close(), 300); return; }
        const used = new Set(this.players.map((p) => p.slot));
        let slot = 1; while (used.has(slot)) slot++;
        const info = { conn, slot, name: 'Player' };
        this.conns.set(conn.peer, info);
        conn.on('data', (m) => this.onData(m, info));
        conn.on('close', () => this.dropClient(conn.peer));
        conn.on('error', () => this.dropClient(conn.peer));
      });
    });
  }

  join(code, name, cb) {
    this.close();
    this.isHost = false;
    this.code = code.toUpperCase().trim();
    const peer = new window.Peer(undefined, { debug: 0 });
    this.peer = peer;
    let opened = false;
    const timeout = setTimeout(() => { if (!opened) cb && cb('error', 'timeout'); }, 15000);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
      this.hostConn = conn;
      conn.on('open', () => {
        opened = true;
        clearTimeout(timeout);
        this.online = true;
        conn.send({ t: 'hello', name, ver: 1 });
        cb && cb('open');
      });
      conn.on('data', (m) => this.onData(m, null));
      conn.on('close', () => { if (this.online) this.game.onHostLost(); this.online = false; });
      conn.on('error', () => { cb && cb('error', 'conn'); });
    });
    peer.on('error', (e) => { clearTimeout(timeout); cb && cb('error', e.type); });
  }

  dropClient(peerId) {
    const info = this.conns.get(peerId);
    if (!info) return;
    this.conns.delete(peerId);
    this.players = this.players.filter((p) => p.slot !== info.slot);
    this.broadcast({ t: 'left', slot: info.slot });
    this.game.onPlayerLeft(info.slot);
    this.pushLobby();
  }

  onData(m, info) {
    if (!m || typeof m !== 'object') return;
    if (this.isHost && info) {
      if (m.t === 'hello') {
        info.name = String(m.name || 'Player').slice(0, 16);
        this.players.push({ slot: info.slot, name: info.name });
        info.conn.send({ t: 'welcome', slot: info.slot, code: this.code });
        this.pushLobby();
        this.game.onPlayerJoined(info.slot, info.name);
        return;
      }
      // relay player state and chat to everyone else
      if (m.t === 'ps') { m.slot = info.slot; this.broadcast(m, info.conn.peer); this.game.onNet(m, info.slot); return; }
      if (m.t === 'chat') { m.slot = info.slot; this.broadcast(m, info.conn.peer); }
      this.game.onNet(m, info.slot);
      return;
    }
    // client
    if (m.t === 'welcome') { this.slot = m.slot; this.game.onWelcome(m); return; }
    if (m.t === 'full') { this.game.onJoinRefused('full'); return; }
    if (m.t === 'busy') { this.game.onJoinRefused('busy'); return; }
    if (m.t === 'lobby') { this.players = m.players; this.game.onLobby(m); return; }
    this.game.onNet(m, m.slot ?? 0);
  }

  pushLobby() {
    if (!this.isHost) return;
    const m = { t: 'lobby', players: this.players, chapter: this.game.lobbyChapter, diff: this.game.lobbyDiff };
    this.broadcast(m);
    this.game.onLobby(m);
  }

  send(m) {
    if (!this.online) return;
    try {
      if (this.isHost) this.broadcast(m);
      else if (this.hostConn && this.hostConn.open) this.hostConn.send(m);
    } catch (e) { /* channel closing */ }
  }

  sendTo(slot, m) {
    for (const info of this.conns.values()) if (info.slot === slot && info.conn.open) { try { info.conn.send(m); } catch (e) { /* ignore */ } }
  }

  broadcast(m, exceptPeer) {
    for (const [id, info] of this.conns) {
      if (id === exceptPeer || !info.conn.open) continue;
      try { info.conn.send(m); } catch (e) { /* ignore */ }
    }
  }

  close() {
    this.online = false;
    try { if (this.hostConn) this.hostConn.close(); } catch (e) { /* ignore */ }
    for (const info of this.conns.values()) { try { info.conn.close(); } catch (e) { /* ignore */ } }
    this.conns.clear();
    this.hostConn = null;
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
    this.peer = null;
    this.players = [];
  }
}
