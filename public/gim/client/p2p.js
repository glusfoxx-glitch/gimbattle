import Peer from 'https://esm.sh/peerjs@1.5.4?bundle-deps';
import {
  TICK_MS, MAX_CATCHUP_TICKS, MSG, MAX_BINARY_MESSAGE_BYTES, MAX_TEXT_MESSAGE_BYTES,
  RATE_LIMIT_BURST, RATE_LIMIT_PER_SEC, INVALID_LOG_INTERVAL_MS, MS_PER_SECOND, LEAVE_GRACE_MS, MAX_PLAYERS,
} from '../shared/constants.js';
import {
  ByteReader, ByteWriter, decodeInput, decodePing, encodePong, takeBytes, parseClientText, makeError, makeLobby,
} from '../shared/protocol.js';
import { createInput } from '../shared/simulation.js';
import { Room, InputQueue } from '../server/room.js';

const PEER_PREFIX = 'gimbattle-v1-';
const GUEST_ATTEMPT_TIMEOUT_MS = 11000;
const GUEST_CONNECT_ATTEMPTS = 4;

const PEER_OPTIONS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]
  }
};

function detach(data) { if (typeof data === 'string') return data; if (data instanceof ArrayBuffer) return data.slice(0); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); }
function normalizeIncoming(data) { if (typeof data === 'string' || data instanceof ArrayBuffer) return data; if (ArrayBuffer.isView(data)) return detach(data); return null; }
function blankSocket() { return { send() {}, close() {}, onopen() {}, onmessage() {}, onclose() {}, onfail() {} }; }
function describePeerError(err) { const type = err?.type ?? ''; if (type === 'unavailable-id') return 'Ce code est déjà utilisé par une autre partie. Choisis-en un autre.'; if (type === 'peer-unavailable') return "Aucune partie avec ce code. Vérifie le code ou demande à l'hôte de créer la partie."; if (type === 'browser-incompatible') return 'Ce navigateur ne gère pas WebRTC.'; if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') return 'Impossible de joindre le service de mise en relation. Vérifie ta connexion internet.'; return 'La connexion à la partie a échoué.'; }

class ClientConn {
  constructor(id, sendFn) {
    this.id = id; this.sendFn = sendFn; this.room = null; this.slot = -1; this.name = ''; this.brawlerId = 0;
    this.ackSeq = 0; this.eventFrom = 0; this.queue = new InputQueue(); this.tokens = RATE_LIMIT_BURST;
    this.lastRefill = performance.now(); this.invalidCount = 0; this.lastInvalidLog = -INVALID_LOG_INTERVAL_MS;
    this.leftAt = -Infinity; this.starveTicks = 0; this.inputDebt = 0;
  }
  consumeToken() { const now = performance.now(); this.tokens = Math.min(RATE_LIMIT_BURST, this.tokens + ((now - this.lastRefill) / MS_PER_SECOND) * RATE_LIMIT_PER_SEC); this.lastRefill = now; if (this.tokens < 1) return false; this.tokens -= 1; return true; }
  reject(reason) { this.invalidCount++; const now = performance.now(); if (now - this.lastInvalidLog < INVALID_LOG_INTERVAL_MS) return; console.warn(`[rejet] client #${this.id} : ${reason}`); this.lastInvalidLog = now; this.invalidCount = 0; }
  send(data) { this.sendFn(data); }
}

export class HostServer {
  constructor(roomId) {
    this.room = new Room(roomId, (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0); this.lobby = true; this.members = []; this.hostClient = null;
    this.settings = { minutes: 3, map: 0, gameMode: 0 };
    this.nextId = 1; this.reader = new ByteReader(MAX_BINARY_MESSAGE_BYTES); this.pongWriter = new ByteWriter(MAX_BINARY_MESSAGE_BYTES);
    this.scratchInput = createInput(); this.running = true; this.lastLoop = performance.now(); this.accumulator = 0; this.simTime = this.lastLoop;
    this.timer = null; this.ticker = null;
    try { const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${Math.max(1, Math.floor(TICK_MS / 4))});`], { type: 'text/javascript' })); this.ticker = new Worker(url); URL.revokeObjectURL(url); this.ticker.onmessage = () => this.step(); } catch { this.ticker = null; }
    if (this.ticker === null) this.loop();
  }
  createClient(sendFn) { return new ClientConn(this.nextId++, sendFn); }
  leave(client) { const index = this.members.indexOf(client); if (index >= 0) { this.members.splice(index, 1); this.broadcastLobby(); } if (client.room === null) return; client.room.removeClient(client); client.leftAt = performance.now(); }
  handleMessage(client, data) { if (!client.consumeToken()) { client.reject('limite de débit dépassée'); return; } if (typeof data === 'string') this.handleText(client, data); else this.handleBinary(client, new Uint8Array(data)); }
  handleBinary(client, data) {
    const reader = this.reader; if (data.length > MAX_BINARY_MESSAGE_BYTES || !reader.load(data) || reader.length === 0) { client.reject(`message binaire invalide`); return; }
    const type = reader.bytes[0];
    if (type === MSG.INPUT) { if (client.room === null) { if (performance.now() - client.leftAt > LEAVE_GRACE_MS) client.reject('input hors partie'); return; } const reason = decodeInput(reader, this.scratchInput) ?? client.queue.push(this.scratchInput); if (reason !== null) client.reject(reason); }
    else if (type === MSG.PING) { const clientTime = decodePing(reader); if (Number.isNaN(clientTime)) { client.reject('ping invalide'); return; } encodePong(this.pongWriter, clientTime, this.simTime + this.accumulator + (performance.now() - this.lastLoop)); client.send(takeBytes(this.pongWriter)); }
    else { client.reject(`type inconnu (${type})`); }
  }
  handleText(client, text) {
    if (text.length > MAX_TEXT_MESSAGE_BYTES) { client.reject(`texte trop long`); return; }
    const msg = parseClientText(text); if (msg === null) { client.reject('JSON invalide'); return; }
    if (msg.t === 'pick') { if (this.lobby) { if (this.members.includes(client)) { client.brawlerId = msg.brawler; this.broadcastLobby(); } } else { this.room.pickBrawler(client, msg.brawler); } return; }
    if (msg.t === 'settings') { if (!this.lobby || client !== this.hostClient) { client.reject("réservé à l'hôte"); return; } this.settings = { minutes: msg.minutes, map: msg.map, gameMode: msg.gameMode }; this.broadcastLobby(); return; }
    if (msg.t === 'start') { if (!this.lobby || client !== this.hostClient) { client.reject("réservé à l'hôte"); return; } this.startGame(); return; }
    this.leave(client); if (msg.t === 'leave') return;
    if (this.lobby) { if (this.members.length >= MAX_PLAYERS) { client.send(makeError(`Partie pleine.`)); return; } client.name = msg.name; client.brawlerId = msg.brawler; this.members.push(client); this.broadcastLobby(); return; }
    if (this.room.addClient(client, msg.name, msg.brawler) < 0) { client.send(makeError(`Partie pleine.`)); }
  }
  broadcastLobby() { if (!this.lobby) return; const players = this.members.map((m) => ({ id: m.id, name: m.name, brawler: m.brawlerId })); const hostId = this.hostClient !== null ? this.hostClient.id : -1; for (const m of this.members) m.send(makeLobby(m.id, hostId, players, this.settings)); }
  startGame() {
    this.lobby = false; this.room.configure(this.settings.minutes, this.settings.map, this.settings.gameMode);
    const order = this.members.slice(); this.members = [];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
    const now = performance.now(); this.lastLoop = now; this.simTime = now; this.accumulator = 0;
    for (const m of order) this.room.addClient(m, m.name, m.brawlerId);
  }
  loop() { if (!this.running) return; this.step(); this.timer = setTimeout(() => this.loop(), Math.max(0, TICK_MS - this.accumulator)); }
  step() {
    if (!this.running) return; const now = performance.now(); if (this.lobby) { this.lastLoop = now; return; }
    this.accumulator += now - this.lastLoop; this.lastLoop = now; let ticks = 0;
    while (this.accumulator >= TICK_MS && ticks < MAX_CATCHUP_TICKS) { this.simTime += TICK_MS; this.room.tick(this.simTime); this.accumulator -= TICK_MS; ticks++; }
    if (this.accumulator >= TICK_MS) this.accumulator = 0;
  }
  stop() { this.running = false; if (this.timer !== null) clearTimeout(this.timer); if (this.ticker !== null) this.ticker.terminate(); }
}

export function createHostSocket(room) {
  const socket = blankSocket(); let closed = false; let server = null; let self = null; const guests = new Set();
  const peer = new Peer(PEER_PREFIX + room, PEER_OPTIONS);
  peer.on('open', () => { if (closed || server !== null) return; server = new HostServer(room); self = server.createClient((data) => queueMicrotask(() => { if (!closed) socket.onmessage(data); })); server.hostClient = self; socket.onopen(); });
  peer.on('connection', (conn) => { if (closed || server === null) { conn.close(); return; } const host = server; const client = host.createClient((data) => { if (conn.open) conn.send(data); }); guests.add(conn); conn.on('data', (raw) => { const data = normalizeIncoming(raw); if (data !== null && !closed) host.handleMessage(client, data); }); const drop = () => { guests.delete(conn); host.leave(client); }; conn.on('close', drop); conn.on('error', drop); });
  peer.on('error', (err) => { if (closed) return; if (server === null) { closed = true; peer.destroy(); socket.onfail(describePeerError(err)); } });
  peer.on('disconnected', () => { if (!closed) setTimeout(() => { if (!closed && peer.disconnected) peer.reconnect(); }, 1000); });
  socket.send = (data) => { if (closed || server === null || self === null) return; server.handleMessage(self, detach(data)); };
  socket.close = () => { if (closed) return; closed = true; if (server !== null) server.stop(); for (const conn of guests) conn.close(); peer.destroy(); };
  return socket;
}

export function createGuestSocket(room) {
  const socket = blankSocket(); let closed = false; let opened = false; let conn = null; let peer = null; let retryTimer = null; let attempts = 0;
  const fail = (message) => { if (closed) return; closed = true; if (retryTimer !== null) clearTimeout(retryTimer); const retired = peer; peer = null; conn = null; if (retired !== null) retired.destroy(); if (opened) socket.onclose(); else socket.onfail(message); };
  const attempt = () => {
    attempts++; const p = new Peer(PEER_OPTIONS); peer = p;
    const retry = (message) => { if (closed || opened || peer !== p) return; if (retryTimer !== null) clearTimeout(retryTimer); peer = null; conn = null; p.destroy(); if (attempts < GUEST_CONNECT_ATTEMPTS) attempt(); else fail(message); };
    retryTimer = setTimeout(() => retry('La connexion à la partie a échoué.'), GUEST_ATTEMPT_TIMEOUT_MS);
    p.on('open', () => {
      if (closed || peer !== p) return; const c = p.connect(PEER_PREFIX + room, { reliable: true, serialization: 'raw' }); conn = c;
      c.on('open', () => { if (closed || peer !== p) return; if (retryTimer !== null) clearTimeout(retryTimer); opened = true; socket.onopen(); });
      c.on('data', (raw) => { if (peer !== p) return; const data = normalizeIncoming(raw); if (data !== null && !closed) socket.onmessage(data); });
      c.on('close', () => { if (peer !== p || closed) return; if (opened) fail("L'hôte a fermé la partie."); else retry('La connexion a échoué.'); });
      c.on('error', () => { if (peer !== p || closed) return; if (opened) fail('La connexion a échoué.'); else retry('La connexion a échoué.'); });
    });
    p.on('error', (err) => { if (peer !== p) return; if (closed || opened) return; if (['peer-unavailable', 'browser-incompatible', 'unavailable-id', 'invalid-id'].includes(err?.type)) fail(describePeerError(err)); else retry(describePeerError(err)); });
  };
  attempt();
  socket.send = (data) => { if (!closed && conn !== null && conn.open) conn.send(detach(data)); };
  socket.close = () => { if (closed) return; closed = true; if (retryTimer !== null) clearTimeout(retryTimer); const retired = peer; peer = null; conn = null; if (retired !== null) retired.destroy(); };
  return socket;
}
