/**
 * Multijoueur pair-à-pair (WebRTC) : remplace le serveur Node + WebSocket de la version locale.
 *
 * - L'HÔTE fait tourner dans son navigateur exactement la même logique que server/server.js :
 *   un salon autoritaire (server/room.js), la boucle à pas fixe, la validation des messages et la limite de débit.
 *   Son propre client y est branché par une « prise » locale en mémoire.
 * - Les INVITÉS se connectent à l'hôte par un DataChannel WebRTC (fiable et ordonné, comme TCP/WebSocket).
 *   Le code de salon sert d'identifiant de rendez-vous (signalisation via le service public PeerJS).
 */
import Peer from 'https://esm.sh/peerjs@1.5.4?bundle-deps';
import {
  TICK_MS, MAX_CATCHUP_TICKS, MSG, MAX_BINARY_MESSAGE_BYTES, MAX_TEXT_MESSAGE_BYTES,
  RATE_LIMIT_BURST, RATE_LIMIT_PER_SEC, INVALID_LOG_INTERVAL_MS, MS_PER_SECOND, LEAVE_GRACE_MS,
} from '../shared/constants.js';
import {
  ByteReader, ByteWriter, decodeInput, decodePing, encodePong, takeBytes, parseClientText, makeError,
} from '../shared/protocol.js';
import { createInput } from '../shared/simulation.js';
import { Room, InputQueue } from '../server/room.js';

const PEER_PREFIX = 'gimbattle-v1-';
/** Invité : délai avant de retenter une mise en relation restée bloquée, et nombre d'essais. */
const GUEST_ATTEMPT_TIMEOUT_MS = 6000;
const GUEST_CONNECT_ATTEMPTS = 3;

/**
 * @typedef {Object} P2PSocket
 * @property {(data: ArrayBuffer|ArrayBufferView|string) => void} send
 * @property {() => void} close
 * @property {() => void} onopen
 * @property {(data: ArrayBuffer|string) => void} onmessage
 * @property {() => void} onclose
 * @property {(message: string) => void} onfail
 */

/** @param {ArrayBuffer|ArrayBufferView|string} data @returns {ArrayBuffer|string} Copie indépendante (le client réutilise ses tampons). */
function detach(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return data.slice(0);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

/** @param {unknown} data @returns {ArrayBuffer|string|null} */
function normalizeIncoming(data) {
  if (typeof data === 'string' || data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return detach(data);
  return null;
}

/** @returns {P2PSocket} */
function blankSocket() {
  return { send() {}, close() {}, onopen() {}, onmessage() {}, onclose() {}, onfail() {} };
}

/** @param {any} err @returns {string} */
function describePeerError(err) {
  const type = err?.type ?? '';
  if (type === 'unavailable-id') return 'Ce code est déjà utilisé par une autre partie. Choisis-en un autre.';
  if (type === 'peer-unavailable') return "Aucune partie avec ce code. Vérifie le code ou demande à l'hôte de créer la partie.";
  if (type === 'browser-incompatible') return 'Ce navigateur ne gère pas WebRTC.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') return 'Impossible de joindre le service de mise en relation. Vérifie ta connexion internet.';
  return 'La connexion à la partie a échoué.';
}

// ============================================================================
// HÔTE : port navigateur de server/server.js (un seul salon)
// ============================================================================

class ClientConn {
  /** @param {number} id @param {(data: ArrayBuffer|string) => void} sendFn */
  constructor(id, sendFn) {
    this.id = id;
    this.sendFn = sendFn;
    /** @type {Room|null} */
    this.room = null;
    this.slot = -1;
    this.name = '';
    this.brawlerId = 0;
    this.ackSeq = 0;
    this.eventFrom = 0;
    this.queue = new InputQueue();
    this.tokens = RATE_LIMIT_BURST;
    this.lastRefill = performance.now();
    this.invalidCount = 0;
    this.lastInvalidLog = -INVALID_LOG_INTERVAL_MS;
    this.leftAt = -Infinity;
    this.starveTicks = 0;
    this.inputDebt = 0;
  }
  consumeToken() {
    const now = performance.now();
    this.tokens = Math.min(RATE_LIMIT_BURST, this.tokens + ((now - this.lastRefill) / MS_PER_SECOND) * RATE_LIMIT_PER_SEC);
    this.lastRefill = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  /** @param {string} reason */
  reject(reason) {
    this.invalidCount++;
    const now = performance.now();
    if (now - this.lastInvalidLog < INVALID_LOG_INTERVAL_MS) return;
    console.warn(`[rejet] client #${this.id} : ${reason} — ${this.invalidCount} message(s) ignoré(s)`);
    this.lastInvalidLog = now;
    this.invalidCount = 0;
  }
  /** @param {ArrayBuffer|string} data */
  send(data) { this.sendFn(data); }
}

export class HostServer {
  /** @param {string} roomId */
  constructor(roomId) {
    this.room = new Room(roomId, (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0);
    this.nextId = 1;
    this.reader = new ByteReader(MAX_BINARY_MESSAGE_BYTES);
    this.pongWriter = new ByteWriter(MAX_BINARY_MESSAGE_BYTES);
    this.scratchInput = createInput();
    this.running = true;
    this.lastLoop = performance.now();
    this.accumulator = 0;
    /** Horloge de simulation : avance d'exactement TICK_MS par tick (snapshots datés sans doublon, même en rattrapage). */
    this.simTime = this.lastLoop;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this.timer = null;
    /** @type {Worker|null} */
    this.ticker = null;
    // Horloge dans un Worker : régulière même si l'onglet de l'hôte est chargé ou en arrière-plan
    // (les minuteurs de la page sont ralentis par le navigateur, ce qui faisait « glisser » les persos).
    try {
      const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${Math.max(1, Math.floor(TICK_MS / 4))});`], { type: 'text/javascript' }));
      this.ticker = new Worker(url);
      URL.revokeObjectURL(url);
      this.ticker.onmessage = () => this.step();
    } catch {
      this.ticker = null;
    }
    if (this.ticker === null) this.loop();
  }

  /** @param {(data: ArrayBuffer|string) => void} sendFn @returns {ClientConn} */
  createClient(sendFn) {
    return new ClientConn(this.nextId++, sendFn);
  }

  /** @param {ClientConn} client */
  leave(client) {
    if (client.room === null) return;
    client.room.removeClient(client);
    client.leftAt = performance.now();
  }

  /** @param {ClientConn} client @param {ArrayBuffer|string} data */
  handleMessage(client, data) {
    if (!client.consumeToken()) { client.reject('limite de débit dépassée'); return; }
    if (typeof data === 'string') this.handleText(client, data);
    else this.handleBinary(client, new Uint8Array(data));
  }

  /** @param {ClientConn} client @param {Uint8Array} data */
  handleBinary(client, data) {
    const reader = this.reader;
    if (data.length > MAX_BINARY_MESSAGE_BYTES || !reader.load(data) || reader.length === 0) {
      client.reject(`message binaire de ${data.length} octets`);
      return;
    }
    const type = reader.bytes[0];
    if (type === MSG.INPUT) {
      if (client.room === null) {
        if (performance.now() - client.leftAt > LEAVE_GRACE_MS) client.reject('input hors partie');
        return;
      }
      const reason = decodeInput(reader, this.scratchInput) ?? client.queue.push(this.scratchInput);
      if (reason !== null) client.reject(reason);
    } else if (type === MSG.PING) {
      const clientTime = decodePing(reader);
      if (Number.isNaN(clientTime)) { client.reject('ping invalide'); return; }
      encodePong(this.pongWriter, clientTime, this.simTime + this.accumulator + (performance.now() - this.lastLoop));
      client.send(takeBytes(this.pongWriter));
    } else {
      client.reject(`type de message inconnu (${type})`);
    }
  }

  /** @param {ClientConn} client @param {string} text */
  handleText(client, text) {
    if (text.length > MAX_TEXT_MESSAGE_BYTES) { client.reject(`texte de ${text.length} octets`); return; }
    const msg = parseClientText(text);
    if (msg === null) { client.reject('JSON invalide ou schéma incorrect'); return; }
    if (msg.t === 'pick') { this.room.pickBrawler(client, msg.brawler); return; }
    this.leave(client);
    if (msg.t === 'leave') return;
    if (this.room.addClient(client, msg.name, msg.brawler) < 0) {
      client.send(makeError('Partie pleine : 12 joueurs maximum.'));
    }
  }

  loop() {
    if (!this.running) return;
    this.step();
    this.timer = setTimeout(() => this.loop(), Math.max(0, TICK_MS - this.accumulator));
  }

  step() {
    if (!this.running) return;
    const now = performance.now();
    this.accumulator += now - this.lastLoop;
    this.lastLoop = now;
    let ticks = 0;
    while (this.accumulator >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      this.simTime += TICK_MS;
      this.room.tick(this.simTime);
      this.accumulator -= TICK_MS;
      ticks++;
    }
    if (this.accumulator >= TICK_MS) this.accumulator = 0;
  }

  stop() {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.ticker !== null) this.ticker.terminate();
  }
}

/**
 * Crée la partie : réserve le code de salon, lance le salon local et accepte les invités.
 * @param {string} room @returns {P2PSocket}
 */
export function createHostSocket(room) {
  const socket = blankSocket();
  let closed = false;
  /** @type {HostServer|null} */
  let server = null;
  /** @type {ClientConn|null} */
  let self = null;
  /** @type {Set<any>} */
  const guests = new Set();
  const peer = new Peer(PEER_PREFIX + room);

  peer.on('open', () => {
    if (closed) return;
    server = new HostServer(room);
    // Le client de l'hôte reçoit les messages du salon en différé (comme par le réseau, sans réentrance).
    self = server.createClient((data) => queueMicrotask(() => { if (!closed) socket.onmessage(data); }));
    socket.onopen();
  });

  peer.on('connection', (conn) => {
    if (closed || server === null) { conn.close(); return; }
    const host = server;
    const client = host.createClient((data) => { if (conn.open) conn.send(data); });
    guests.add(conn);
    conn.on('data', (raw) => {
      const data = normalizeIncoming(raw);
      if (data !== null && !closed) host.handleMessage(client, data);
    });
    const drop = () => { guests.delete(conn); host.leave(client); };
    conn.on('close', drop);
    conn.on('error', drop);
  });

  peer.on('error', (err) => {
    if (closed) return;
    if (server === null) {
      closed = true;
      peer.destroy();
      socket.onfail(describePeerError(err));
    } else {
      console.warn('[p2p hôte]', err?.type ?? err);
    }
  });
  // Perte du service de mise en relation : les invités déjà connectés continuent à jouer ; on retente pour les nouveaux.
  peer.on('disconnected', () => { if (!closed) setTimeout(() => { if (!closed && peer.disconnected) peer.reconnect(); }, 1000); });

  socket.send = (data) => {
    if (closed || server === null || self === null) return;
    server.handleMessage(self, detach(data));
  };
  socket.close = () => {
    if (closed) return;
    closed = true;
    if (server !== null) server.stop();
    for (const conn of guests) conn.close();
    peer.destroy();
  };
  return socket;
}

// ============================================================================
// INVITÉ
// ============================================================================

/**
 * Rejoint la partie hébergée sous ce code.
 * @param {string} room @returns {P2PSocket}
 */
export function createGuestSocket(room) {
  const socket = blankSocket();
  let closed = false;
  let opened = false;
  /** @type {any} */
  let conn = null;
  /** @type {any} */
  let peer = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let retryTimer = null;
  let attempts = 0;

  const fail = (/** @type {string} */ message) => {
    if (closed) return;
    closed = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    if (peer !== null) peer.destroy();
    if (opened) socket.onclose();
    else socket.onfail(message);
  };

  // Une mise en relation WebRTC reste parfois bloquée sans erreur (environ 1 fois sur 6 en test) :
  // si le canal ne s'ouvre pas vite, on recommence avec une connexion neuve au lieu d'attendre indéfiniment.
  const attempt = () => {
    attempts++;
    const p = new Peer();
    peer = p;
    retryTimer = setTimeout(() => {
      if (closed || opened || peer !== p) return;
      p.destroy();
      if (attempts < GUEST_CONNECT_ATTEMPTS) attempt();
      else fail('La connexion à la partie a échoué. Réessaie dans un instant.');
    }, GUEST_ATTEMPT_TIMEOUT_MS);

    p.on('open', () => {
      if (closed || peer !== p) return;
      const c = p.connect(PEER_PREFIX + room, { reliable: true, serialization: 'raw' });
      conn = c;
      c.on('open', () => {
        if (closed || peer !== p) return;
        if (retryTimer !== null) clearTimeout(retryTimer);
        opened = true;
        socket.onopen();
      });
      c.on('data', (/** @type {unknown} */ raw) => {
        if (peer !== p) return;
        const data = normalizeIncoming(raw);
        if (data !== null && !closed) socket.onmessage(data);
      });
      c.on('close', () => { if (peer === p && opened) fail("L'hôte a fermé la partie."); });
      c.on('error', () => { if (peer === p && opened) fail('La connexion à la partie a échoué.'); });
    });
    p.on('error', (/** @type {any} */ err) => {
      if (peer !== p) return;
      // Une fois en jeu, seule la fermeture du canal compte (le service de mise en relation peut tomber sans gêner).
      if (opened && err?.type !== 'peer-unavailable') return;
      fail(describePeerError(err));
    });
  };
  attempt();

  socket.send = (data) => {
    if (!closed && conn !== null && conn.open) conn.send(detach(data));
  };
  socket.close = () => {
    if (closed) return;
    closed = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    if (peer !== null) peer.destroy();
  };
  return socket;
}
