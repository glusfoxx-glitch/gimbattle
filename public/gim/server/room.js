/**
 * Un salon = un monde simulé + ses clients. Le serveur fait autorité :
 * il consomme UN input par client et par tick (comme le client qui prédit), simule, puis diffuse les snapshots.
 */
import {
  MAX_PLAYERS, MAX_INPUT_QUEUE, INPUT_CATCHUP_THRESHOLD, TICK_MS, SNAPSHOT_INTERVAL_MS, SNAPSHOT_BUFFER_BYTES,
  TEAM_A, TEAM_B, MAX_SEQ_JUMP, INPUT_STARVE_GRACE_TICKS, ROUND_PHASE_ENDED, ROUND_DRAW,
} from '../shared/constants.js';
import { ARENA } from '../shared/arena.js';
import { createWorld, countTeam } from '../shared/world.js';
import { createRng } from '../shared/rng.js';
import {
  createInput, copyInput, stepPlayerSelf, applyPlayerActions, stepWorld, resolveAutoAim, activatePlayer, deactivatePlayer,
  dashContacts,
} from '../shared/simulation.js';
import { ByteWriter, encodeSnapshot, takeBytes, makeWelcome, makeRoster, makeResults } from '../shared/protocol.js';

/** @typedef {import('../shared/simulation.js').PlayerInput} PlayerInput */

/**
 * File circulaire d'inputs pré-alloués (aucune allocation à la réception).
 */
export class InputQueue {
  constructor() {
    /** @type {PlayerInput[]} */
    this.items = new Array(MAX_INPUT_QUEUE);
    for (let i = 0; i < MAX_INPUT_QUEUE; i++) this.items[i] = createInput();
    this.head = 0;
    this.count = 0;
    this.lastReceivedSeq = 0;
  }
  reset() {
    this.head = 0;
    this.count = 0;
    this.lastReceivedSeq = 0;
  }
  /**
   * @param {PlayerInput} input
   * @returns {string|null} Raison du rejet, null si accepté.
   */
  push(input) {
    if (input.seq <= this.lastReceivedSeq) return 'séquence rejouée ou désordonnée';
    if (input.seq > this.lastReceivedSeq + MAX_SEQ_JUMP) return 'saut de séquence suspect';
    if (this.count >= MAX_INPUT_QUEUE) return "file d'inputs pleine (débit trop élevé)";
    copyInput(this.items[(this.head + this.count) % MAX_INPUT_QUEUE], input);
    this.count++;
    this.lastReceivedSeq = input.seq;
    return null;
  }
  /** @returns {PlayerInput} */
  shift() {
    const item = this.items[this.head];
    this.head = (this.head + 1) % MAX_INPUT_QUEUE;
    this.count--;
    return item;
  }
}

/**
 * @typedef {Object} RoomClient
 * @property {number} slot @property {string} name @property {number} brawlerId
 * @property {number} ackSeq @property {number} eventFrom @property {InputQueue} queue
 * @property {Room|null} room
 * @property {(data: ArrayBuffer|string) => void} send
 */

export class Room {
  /**
   * @param {string} id @param {number} seed
   */
  constructor(id, seed) {
    this.id = id;
    this.world = createWorld(ARENA);
    this.rng = createRng(seed);
    /** @type {(RoomClient|null)[]} */
    this.clients = new Array(MAX_PLAYERS).fill(null);
    this.clientCount = 0;
    this.snapshotAccMs = 0;
    this.rosterDirty = false;
    this.writer = new ByteWriter(SNAPSHOT_BUFFER_BYTES);
    this.neutralInput = createInput();
    /** @type {import('../shared/protocol.js').SnapshotContext} */
    this.ctx = { viewer: null, ackSeq: 0, serverTime: 0, eventFrom: 0 };
  }

  /**
   * Ajoute un joueur dans l'équipe la moins remplie.
   * @param {RoomClient} client @param {string} name @param {number} brawlerId
   * @returns {number} Emplacement attribué, -1 si le salon est plein.
   */
  addClient(client, name, brawlerId) {
    const slot = this.clients.indexOf(null);
    if (slot < 0) return -1;
    const team = countTeam(this.world, TEAM_A) <= countTeam(this.world, TEAM_B) ? TEAM_A : TEAM_B;
    this.clients[slot] = client;
    this.clientCount++;
    client.room = this;
    client.slot = slot;
    client.name = name;
    client.brawlerId = brawlerId;
    client.ackSeq = 0;
    client.starveTicks = 0;
    client.inputDebt = 0;
    client.queue.reset();
    client.eventFrom = this.world.eventHead;
    activatePlayer(this.world, slot, team, brawlerId, this.rng);
    client.send(makeWelcome(slot, team, this.id));
    this.rosterDirty = true;
    return slot;
  }

  /** @param {RoomClient} client */
  removeClient(client) {
    if (client.room !== this || client.slot < 0) return;
    deactivatePlayer(this.world, client.slot);
    this.clients[client.slot] = null;
    this.clientCount--;
    client.slot = -1;
    client.room = null;
    this.rosterDirty = true;
  }

  /**
   * Consomme les inputs d'un client.
   * Le temps du joueur avance AVEC ses inputs (exactement comme sa prédiction locale) :
   * - file vide pendant un court instant (gigue réseau) : on attend l'input en retard au lieu d'inventer un pas
   *   « immobile » que le client n'a pas prédit (c'était la cause des téléportations / persos qui reculent) ;
   *   la dette est rattrapée dès que les inputs arrivent (2 par tick) ;
   * - file vide trop longtemps (onglet en arrière-plan, déconnexion) : pas à vide, le temps continue ;
   * - file trop longue : on rattrape à 2 inputs par tick pour résorber la latence accumulée.
   * @param {RoomClient} client
   */
  processInputs(client) {
    const p = this.world.players[client.slot];
    const queue = client.queue;
    if (queue.count === 0) {
      client.starveTicks = (client.starveTicks ?? 0) + 1;
      if (client.starveTicks <= INPUT_STARVE_GRACE_TICKS) {
        client.inputDebt = Math.min(INPUT_STARVE_GRACE_TICKS, (client.inputDebt ?? 0) + 1);
        return;
      }
      client.inputDebt = 0;
      const neutral = this.neutralInput;
      neutral.moveX = 0;
      neutral.moveY = 0;
      neutral.buttons = 0;
      neutral.aimAngle = p.aimAngle;
      neutral.aimDist = 0;
      applyPlayerActions(this.world, p, stepPlayerSelf(p, neutral, TICK_MS, this.world.arena), neutral);
      return;
    }
    client.starveTicks = 0;
    let steps = 1;
    if (queue.count > INPUT_CATCHUP_THRESHOLD) steps = 2;
    else if ((client.inputDebt ?? 0) > 0 && queue.count > 1) steps = 2;
    if (steps === 2 && (client.inputDebt ?? 0) > 0) client.inputDebt--;
    for (let s = 0; s < steps && queue.count > 0; s++) {
      const input = queue.shift();
      resolveAutoAim(this.world, p, input);
      const flags = stepPlayerSelf(p, input, TICK_MS, this.world.arena);
      applyPlayerActions(this.world, p, flags, input);
      client.ackSeq = input.seq;
      // Pas supplémentaire : on vérifie les contacts du dash à mi-chemin (sinon une cible frôlée est ratée).
      if (s < steps - 1 && p.dashing && !p.dead) dashContacts(this.world, p);
    }
  }

  /** @param {number} serverTime */
  tick(serverTime) {
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const client = this.clients[i];
      if (client !== null) this.processInputs(client);
    }
    const phaseBefore = this.world.roundPhase;
    stepWorld(this.world, TICK_MS, this.rng);
    if (phaseBefore !== ROUND_PHASE_ENDED && this.world.roundPhase === ROUND_PHASE_ENDED) this.broadcastResults();
    if (this.rosterDirty) this.broadcastRoster();
    this.snapshotAccMs += TICK_MS;
    if (this.snapshotAccMs >= SNAPSHOT_INTERVAL_MS) {
      this.snapshotAccMs -= SNAPSHOT_INTERVAL_MS;
      this.sendSnapshots(serverTime);
    }
  }

  /** @param {number} serverTime */
  sendSnapshots(serverTime) {
    const ctx = this.ctx;
    ctx.serverTime = serverTime;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const client = this.clients[i];
      if (client === null) continue;
      ctx.viewer = this.world.players[client.slot];
      ctx.ackSeq = client.ackSeq;
      ctx.eventFrom = client.eventFrom;
      client.eventFrom = encodeSnapshot(this.writer, this.world, ctx);
      client.send(takeBytes(this.writer));
    }
    ctx.viewer = null;
  }

  /**
   * Changement de perso, autorisé seulement pendant l'écran de fin de manche (appliqué à la réapparition).
   * @param {RoomClient} client @param {number} brawlerId
   * @returns {boolean}
   */
  pickBrawler(client, brawlerId) {
    if (client.room !== this || client.slot < 0 || this.world.roundPhase !== ROUND_PHASE_ENDED) return false;
    client.brawlerId = brawlerId;
    this.world.players[client.slot].brawlerId = brawlerId;
    this.rosterDirty = true;
    return true;
  }

  broadcastResults() {
    const w = this.world;
    const a = w.scores[TEAM_A];
    const b = w.scores[TEAM_B];
    const players = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const c = this.clients[i];
      if (c === null) continue;
      const p = w.players[c.slot];
      players.push({ slot: c.slot, name: c.name, brawler: p.brawlerId, team: p.team, kills: p.kills, deaths: p.deaths });
    }
    const message = makeResults(a > b ? TEAM_A : b > a ? TEAM_B : ROUND_DRAW, a, b, players);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const c = this.clients[i];
      if (c !== null) c.send(message);
    }
  }

  broadcastRoster() {
    this.rosterDirty = false;
    /** @type {import('../shared/protocol.js').RosterEntry[]} */
    const players = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const c = this.clients[i];
      if (c !== null) players.push({ slot: c.slot, name: c.name, brawler: c.brawlerId, team: this.world.players[c.slot].team });
    }
    const message = makeRoster(players);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const c = this.clients[i];
      if (c !== null) c.send(message);
    }
  }
}
