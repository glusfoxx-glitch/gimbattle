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
  RATE_LIMIT_BURST, RATE_LIMIT_PER_SEC, INVALID_LOG_INTERVAL_MS, MS_PER_SECOND, LEAVE_GRACE_MS, MAX_PLAYERS,
} from '../shared/constants.js';
import {
  ByteReader, ByteWriter, decodeInput, decodePing, encodePong, takeBytes, parseClientText, makeError, makeLobby,
} from '../shared/protocol.js';
import { createInput } from '../shared/simulation.js';
import { Room, InputQueue } from '../server/room.js';

const PEER_PREFIX = 'gimbattle-v1-';
/** Invité : délai avant de retenter une mise en relation restée bloquée, et nombre d'essais. */
// Un téléphone en 4G (souvent un iPhone) passe par un relais et met parfois plus de 6 s : on lui laisse le temps.
const GUEST_ATTEMPT_TIMEOUT_MS = 11000;
const GUEST_CONNECT_ATTEMPTS = 4;
/** Serveurs STUN/TURN : plusieurs adresses, dont un relais TURN joignable par TCP pour les réseaux mobiles stricts. */
const PEER_OPTIONS = {
  config: {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    ],
    sdpSemantics: 'unified-plan',
  },
};

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
    /** Salon d'attente : la partie ne démarre que quand l'hôte clique sur Lancer. */
    this.lobby = true;
    /** @type {ClientConn[]} */
    this.members = [];
    /** @type {ClientConn|null} */
    this.hostClient = null;
    this.settings = { minutes: 3, map: 0 };
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
    const index = this.members.indexOf(client);
    if (index >= 0) {
      this.members.splice(index, 1);
      this.broadcastLobby();
    }
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
    if (msg.t === 'pick') {
      if (this.lobby) {
        if (this.members.includes(client)) { client.brawlerId = msg.brawler; this.broadcastLobby(); }
      } else {
        this.room.pickBrawler(client, msg.brawler);
      }
      return;
    }
    if (msg.t === 'settings') {
      if (!this.lobby || client !== this.hostClient) { client.reject("réglages réservés à l'hôte"); return; }
      this.settings = { minutes: msg.minutes, map: msg.map };
      this.broadcastLobby();
      return;
    }
    if (msg.t === 'start') {
      if (!this.lobby || client !== this.hostClient) { client.reject("lancement réservé à l'hôte"); return; }
      this.startGame();
      return;
    }
    this.leave(client);
    if (msg.t === 'leave') return;
    if (this.lobby) {
      if (this.members.length >= MAX_PLAYERS) { client.send(makeError(`Partie pleine : ${MAX_PLAYERS} joueurs maximum.`)); return; }
      client.name = msg.name;
      client.brawlerId = msg.brawler;
      this.members.push(client);
      this.broadcastLobby();
      return;
    }
    if (this.room.addClient(client, msg.name, msg.brawler) < 0) {
      client.send(makeError(`Partie pleine : ${MAX_PLAYERS} joueurs maximum.`));
    }
  }

  broadcastLobby() {
    if (!this.lobby) return;
    const players = this.members.map((m) => ({ id: m.id, name: m.name, brawler: m.brawlerId }));
    const hostId = this.hostClient !== null ? this.hostClient.id : -1;
    for (const m of this.members) m.send(makeLobby(m.id, hostId, players, this.settings));
  }

  /** L'hôte lance : réglages appliqués, ordre tiré au sort (équipes aléatoires), tout le monde entre en même temps. */
  startGame() {
    this.lobby = false;
    this.room.configure(this.settings.minutes, this.settings.map);
    const order = this.members.slice();
    this.members = [];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    const now = performance.now();
    this.lastLoop = now;
    this.simTime = now;
    this.accumulator = 0;
    for (const m of order) this.room.addClient(m, m.name, m.brawlerId);
  }

  loop() {
    if (!this.running) return;
    this.step();
    this.timer = setTimeout(() => this.loop(), Math.max(0, TICK_MS - this.accumulator));
  }

  step() {
    if (!this.running) return;
    const now = performance.now();
    if (this.lobby) { this.lastLoop = now; return; }
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
  const peer = new Peer(PEER_PREFIX + room, PEER_OPTIONS);

  peer.on('open', () => {
    // PeerJS émet aussi open après une reconnexion au service de rendez-vous.
    // Ne jamais remplacer le monde auquel les invités sont déjà connectés.
    if (closed || server !== null) return;
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
    const retired = peer;
    peer = null;
    conn = null;
    if (retired !== null) retired.destroy();
    if (opened) socket.onclose();
    else socket.onfail(message);
  };

  // Une mise en relation WebRTC reste parfois bloquée sans erreur (environ 1 fois sur 6 en test) :
  // si le canal ne s'ouvre pas vite, on recommence avec une connexion neuve au lieu d'attendre indéfiniment.
  const attempt = () => {
    attempts++;
    const p = new Peer(PEER_OPTIONS);
    peer = p;
    const retry = (/** @type {string} */ message) => {
      if (closed || opened || peer !== p) return;
      if (retryTimer !== null) clearTimeout(retryTimer);
      peer = null;
      conn = null;
      p.destroy();
      if (attempts < GUEST_CONNECT_ATTEMPTS) attempt();
      else fail(message);
    };
    retryTimer = setTimeout(() => retry('La connexion à la partie a échoué. Réessaie dans un instant.'), GUEST_ATTEMPT_TIMEOUT_MS);

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
      c.on('close', () => {
        if (peer !== p || closed) return;
        if (opened) fail("L'hôte a fermé la partie.");
        else retry('La connexion à la partie a échoué.');
      });
      c.on('error', () => {
        if (peer !== p || closed) return;
        if (opened) fail('La connexion à la partie a échoué.');
        else retry('La connexion à la partie a échoué.');
      });
    });
    p.on('error', (/** @type {any} */ err) => {
      if (peer !== p) return;
      // Une fois en jeu, seule la fermeture du canal compte (le service de mise en relation peut tomber sans gêner).
      if (closed || opened) return;
      if (['peer-unavailable', 'browser-incompatible', 'unavailable-id', 'invalid-id'].includes(err?.type)) fail(describePeerError(err));
      else retry(describePeerError(err));
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
    const retired = peer;
    peer = null;
    conn = null;
    if (retired !== null) retired.destroy();
  };
  return socket;
}
