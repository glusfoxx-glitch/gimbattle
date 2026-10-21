/**
 * Protocole réseau : messages binaires compacts (inputs, ping, snapshots) et JSON validés (rares : join, roster).
 * C'est le SEUL module autorisé à allouer pour la sérialisation (chaînes JSON, tranche finale du snapshot).
 * Toutes les valeurs reçues sont considérées hostiles : bornes, finitude et tailles sont vérifiées.
 */
import {
  MSG, MAX_PLAYERS, MAX_BOTS, MAX_PROJECTILES, MAX_ZONES, MAX_EVENTS_PER_SNAPSHOT, EVENT_RING_SIZE, REF_NONE,
  POS_SCALE, ANGLE_QUANT_MAX, MOVE_QUANT, AIM_DIST_QUANT, PERCENT_SCALE, PROGRESS_QUANT, ZONE_RADIUS_SCALE,
  UINT16_MAX, UINT8_MAX, NET_ID_MASK, TWO_PI, BTN_VALID_MASK, INPUT_MESSAGE_BYTES, PING_MESSAGE_BYTES,
  PONG_MESSAGE_BYTES, MAX_NAME_LENGTH, MAX_ROOM_LENGTH, DEFAULT_ROOM, TEAM_B, TEAM_BOTS,
  PF_DEAD, PF_STUNNED, PF_SLOWED, PF_SPEED, PF_INVISIBLE, PF_BLIND, PF_SHIELD, PF_DASH, PF_AIRBORNE, PF_TEAM_B,
  BF_STUNNED, BF_SLOWED, BF_BLIND, EVENT, FLOAT_ZERO,
} from './constants.js';
import { BRAWLER_COUNT } from './brawlers.js';

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {import('./simulation.js').PlayerInput} PlayerInput */

const LITTLE_ENDIAN = true;
const INT16_MIN = -32768;
const INT16_MAX = 32767;
const INT8_INVALID = -128;
const MAX_ABS_ANGLE = 4 * Math.PI;

// ============================================================================
// LECTURE / ÉCRITURE BINAIRE (objets réutilisables, aucune allocation par message)
// ============================================================================

export class ByteWriter {
  /** @param {number} capacity */
  constructor(capacity) {
    this.buffer = new ArrayBuffer(capacity);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }
  reset() { this.offset = 0; }
  /** @param {number} v */ u8(v) { this.view.setUint8(this.offset, v); this.offset += 1; }
  /** @param {number} v */ i8(v) { this.view.setInt8(this.offset, v); this.offset += 1; }
  /** @param {number} v */ u16(v) { this.view.setUint16(this.offset, v, LITTLE_ENDIAN); this.offset += 2; }
  /** @param {number} v */ i16(v) { this.view.setInt16(this.offset, v, LITTLE_ENDIAN); this.offset += 2; }
  /** @param {number} v */ u32(v) { this.view.setUint32(this.offset, v, LITTLE_ENDIAN); this.offset += 4; }
  /** @param {number} v */ f32(v) { this.view.setFloat32(this.offset, v, LITTLE_ENDIAN); this.offset += 4; }
  /** @param {number} v */ f64(v) { this.view.setFloat64(this.offset, v, LITTLE_ENDIAN); this.offset += 8; }
}

export class ByteReader {
  /** @param {number} capacity Taille du tampon interne (copie des messages reçus). */
  constructor(capacity) {
    this.buffer = new ArrayBuffer(capacity);
    this.bytes = new Uint8Array(this.buffer);
    this.view = new DataView(this.buffer);
    this.offset = 0;
    this.length = 0;
  }
  /**
   * Copie le message dans le tampon interne : la vue DataView reste la même (pas d'allocation).
   * @param {Uint8Array} source
   * @returns {boolean} false si le message dépasse la capacité.
   */
  load(source) {
    if (source.byteLength > this.bytes.byteLength) return false;
    this.bytes.set(source);
    this.offset = 0;
    this.length = source.byteLength;
    return true;
  }
  /** @param {number} count @returns {boolean} */
  has(count) { return this.offset + count <= this.length; }
  u8() { const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
  i8() { const v = this.view.getInt8(this.offset); this.offset += 1; return v; }
  u16() { const v = this.view.getUint16(this.offset, LITTLE_ENDIAN); this.offset += 2; return v; }
  i16() { const v = this.view.getInt16(this.offset, LITTLE_ENDIAN); this.offset += 2; return v; }
  u32() { const v = this.view.getUint32(this.offset, LITTLE_ENDIAN); this.offset += 4; return v; }
  f32() { const v = this.view.getFloat32(this.offset, LITTLE_ENDIAN); this.offset += 4; return v; }
  f64() { const v = this.view.getFloat64(this.offset, LITTLE_ENDIAN); this.offset += 8; return v; }
}

// ============================================================================
// QUANTIFICATION
// ============================================================================

/** @param {number} v @returns {number} */
function quantPos(v) {
  const q = Math.round(v * POS_SCALE);
  return q < INT16_MIN ? INT16_MIN : q > INT16_MAX ? INT16_MAX : q;
}

/** @param {number} a @returns {number} */
function quantAngle(a) {
  let n = a % TWO_PI;
  if (n < 0) n += TWO_PI;
  return Math.round((n / TWO_PI) * ANGLE_QUANT_MAX);
}

/** @param {number} q @returns {number} */
function dequantAngle(q) {
  return (q / ANGLE_QUANT_MAX) * TWO_PI;
}

/** @param {number} v @param {number} max @returns {number} */
function clampUint(v, max) {
  const r = Math.round(v);
  return r < 0 ? 0 : r > max ? max : r;
}

/** @param {number} v @returns {number} */
function clampInt16(v) {
  const r = Math.round(v);
  return r < INT16_MIN ? INT16_MIN : r > INT16_MAX ? INT16_MAX : r;
}

// ============================================================================
// INPUT (client → serveur)
// ============================================================================

/**
 * @param {ByteWriter} w @param {PlayerInput} input
 */
export function encodeInput(w, input) {
  w.reset();
  w.u8(MSG.INPUT);
  w.u32(input.seq >>> 0);
  w.i8(Math.round(input.moveX * MOVE_QUANT));
  w.i8(Math.round(input.moveY * MOVE_QUANT));
  w.f32(input.aimAngle);
  w.u8(clampUint(input.aimDist * AIM_DIST_QUANT, AIM_DIST_QUANT));
  w.u8(input.buttons & BTN_VALID_MASK);
}

/**
 * Décode ET valide un input. Le vecteur de déplacement est renormalisé (longueur ≤ 1) :
 * un client modifié ne peut pas aller plus vite en envoyant (1, 1).
 * @param {ByteReader} r @param {PlayerInput} out
 * @returns {string|null} Raison du rejet, ou null si valide.
 */
export function decodeInput(r, out) {
  if (r.length !== INPUT_MESSAGE_BYTES) return 'taille input';
  r.offset = 1;
  const seq = r.u32();
  const mx = r.i8();
  const my = r.i8();
  const aim = r.f32();
  const aimDist = r.u8();
  const buttons = r.u8();
  if (mx === INT8_INVALID || my === INT8_INVALID) return 'déplacement hors bornes';
  if (!Number.isFinite(aim) || Math.abs(aim) > MAX_ABS_ANGLE) return 'angle invalide';
  if ((buttons & ~BTN_VALID_MASK) !== 0) return 'boutons inconnus';
  let moveX = mx / MOVE_QUANT;
  let moveY = my / MOVE_QUANT;
  const len = Math.sqrt(moveX * moveX + moveY * moveY);
  if (len > 1) { moveX /= len; moveY /= len; }
  out.seq = seq;
  out.moveX = moveX;
  out.moveY = moveY;
  out.aimAngle = aim;
  out.aimDist = aimDist / AIM_DIST_QUANT;
  out.buttons = buttons;
  return null;
}

// ============================================================================
// PING / PONG (mesure de latence et estimation de l'horloge serveur)
// ============================================================================

/** @param {ByteWriter} w @param {number} clientTime */
export function encodePing(w, clientTime) {
  w.reset();
  w.u8(MSG.PING);
  w.f64(clientTime);
}

/**
 * @param {ByteReader} r
 * @returns {number} Heure client renvoyée telle quelle, NaN si invalide.
 */
export function decodePing(r) {
  if (r.length !== PING_MESSAGE_BYTES) return NaN;
  r.offset = 1;
  const t = r.f64();
  return Number.isFinite(t) ? t : NaN;
}

/** @param {ByteWriter} w @param {number} clientTime @param {number} serverTime */
export function encodePong(w, clientTime, serverTime) {
  w.reset();
  w.u8(MSG.PONG);
  w.f64(clientTime);
  w.f64(serverTime);
}

/**
 * @typedef {Object} PongData
 * @property {number} clientTime @property {number} serverTime
 */

/**
 * @param {ByteReader} r @param {PongData} out
 * @returns {boolean}
 */
export function decodePong(r, out) {
  if (r.length !== PONG_MESSAGE_BYTES) return false;
  r.offset = 1;
  out.clientTime = r.f64();
  out.serverTime = r.f64();
  return Number.isFinite(out.clientTime) && Number.isFinite(out.serverTime);
}

// ============================================================================
// SNAPSHOT (serveur → client), un par destinataire
// ============================================================================

/** @param {Player} p @returns {number} */
function playerFlags(p) {
  let f = 0;
  if (p.dead) f |= PF_DEAD;
  if (p.stunMs > 0) f |= PF_STUNNED;
  if (p.slowMs > 0) f |= PF_SLOWED;
  if (p.speedBuffMs > 0) f |= PF_SPEED;
  if (p.invisMs > 0) f |= PF_INVISIBLE;
  if (p.blindMs > 0) f |= PF_BLIND;
  if (p.shieldMs > 0) f |= PF_SHIELD;
  if (p.dashMs > 0) f |= PF_DASH;
  if (p.leapMs > 0) f |= PF_AIRBORNE;
  if (p.team === TEAM_B) f |= PF_TEAM_B;
  return f;
}

/** @param {Player} p @returns {number} */
function leapProgress(p) {
  if (p.leapMs <= 0) return 0;
  return 1 + clampUint((1 - p.leapMs / p.leapTotalMs) * (PROGRESS_QUANT - 1), PROGRESS_QUANT - 1);
}

/**
 * État complet du joueur destinataire : tout ce dont la prédiction a besoin pour rejouer ses inputs.
 * @param {ByteWriter} w @param {Player} p
 */
function writeSelf(w, p) {
  w.f32(p.x); w.f32(p.y); w.f32(p.kbVX); w.f32(p.kbVY);
  w.f32(p.hp); w.u8(p.dead ? 1 : 0); w.f32(p.respawnMs);
  w.f32(p.attackCdMs); w.f32(p.superCharge);
  w.f32(p.stunMs); w.f32(p.slowMs); w.u8(clampUint(p.slowFactor * PERCENT_SCALE, UINT8_MAX));
  w.f32(p.speedBuffMs); w.u8(clampUint(p.speedMul * PERCENT_SCALE, UINT8_MAX));
  w.f32(p.invisMs); w.f32(p.blindMs); w.f32(p.shieldMs);
  w.f32(p.dashMs); w.f32(p.dashDirX); w.f32(p.dashDirY); w.f32(p.dashSpeed); w.u8(p.dashIsSuper ? 1 : 0);
  w.f32(p.leapMs); w.f32(p.leapTotalMs); w.f32(p.leapFromX); w.f32(p.leapFromY);
  w.f32(p.leapToX); w.f32(p.leapToY); w.u8(p.leapIsSuper ? 1 : 0);
  w.u8(p.team); w.u8(p.brawlerId); w.u16(clampUint(p.kills, UINT16_MAX)); w.u16(clampUint(p.deaths, UINT16_MAX));
}

/**
 * Un joueur invisible n'est PAS envoyé à ses ennemis : un client triché ne peut pas le révéler.
 * @param {Player} p @param {number} viewerTeam @param {World} world @param {Player|null} viewer
 * @returns {boolean}
 */
function isVisibleTo(p, viewerTeam, world, viewer) {
  if (p.team === viewerTeam) return true;
  if (p.invisMs > 0) return false;
  // Caché dans les portemanteaux : seul un ennemi tout proche le voit (comme les buissons de Brawl Stars).
  if (p.revealMs > 0 || world.arena.hideouts.length === 0 || !inHideout(world.arena, p.x, p.y)) return true;
  if (viewer === null || !viewer.active || viewer.dead) return false;
  const dx = viewer.x - p.x;
  const dy = viewer.y - p.y;
  return dx * dx + dy * dy <= HIDE_SEE_DISTANCE * HIDE_SEE_DISTANCE;
}

/**
 * @param {ByteWriter} w @param {World} world @param {number} viewerTeam
 */
function writePlayers(w, world, viewerTeam, viewer) {
  const countOffset = w.offset;
  w.u8(0);
  let count = 0;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = world.players[i];
    if (!p.active || !isVisibleTo(p, viewerTeam, world, viewer)) continue;
    w.u8(p.slot); w.u8(p.brawlerId); w.i16(quantPos(p.x)); w.i16(quantPos(p.y));
    w.u16(quantAngle(p.aimAngle)); w.u16(clampUint(p.hp, UINT16_MAX)); w.u16(playerFlags(p)); w.u8(leapProgress(p));
    count++;
  }
  w.view.setUint8(countOffset, count);
}

/** @param {ByteWriter} w @param {World} world */
function writeBots(w, world) {
  const countOffset = w.offset;
  w.u8(0);
  let count = 0;
  for (let i = 0; i < MAX_BOTS; i++) {
    const b = world.bots[i];
    if (!b.active) continue;
    let flags = 0;
    if (b.stunMs > 0) flags |= BF_STUNNED;
    if (b.slowMs > 0) flags |= BF_SLOWED;
    if (b.blindMs > 0) flags |= BF_BLIND;
    w.u8(b.slot); w.u8(b.type); w.i16(quantPos(b.x)); w.i16(quantPos(b.y));
    w.u16(quantAngle(b.angle)); w.u16(clampUint(b.hp, UINT16_MAX)); w.u8(b.state); w.u8(flags);
    count++;
  }
  w.view.setUint8(countOffset, count);
}

/** @param {ByteWriter} w @param {World} world */
function writeProjectiles(w, world) {
  const pool = world.projectiles;
  const count = Math.min(pool.activeCount, UINT8_MAX);
  w.u8(count);
  for (let i = 0; i < count; i++) {
    const pr = /** @type {import('./world.js').Projectile} */ (pool.active[i]);
    w.u16(pr.serial & NET_ID_MASK); w.u8(pr.visual); w.i16(quantPos(pr.x)); w.i16(quantPos(pr.y));
    w.u16(quantAngle(pr.angle));
    w.u8(pr.isLob ? 1 + clampUint((pr.lobMs / pr.lobTotalMs) * (PROGRESS_QUANT - 1), PROGRESS_QUANT - 1) : 0);
  }
}

/** @param {ByteWriter} w @param {World} world */
function writeZones(w, world) {
  const pool = world.zones;
  w.u8(pool.activeCount);
  for (let i = 0; i < pool.activeCount; i++) {
    const z = /** @type {import('./world.js').Zone} */ (pool.active[i]);
    w.u16(z.serial & NET_ID_MASK); w.u8(z.visual); w.i16(quantPos(z.x)); w.i16(quantPos(z.y));
    w.u8(clampUint(z.radius * ZONE_RADIUS_SCALE, UINT8_MAX));
    w.u8(clampUint((z.remainingMs / z.totalMs) * PROGRESS_QUANT, PROGRESS_QUANT));
  }
}

/**
 * @param {ByteWriter} w @param {World} world @param {number} fromId @param {number} viewerTeam
 * @returns {number} Identifiant du prochain événement à envoyer.
 */
function writeEvents(w, world, fromId, viewerTeam, viewer) {
  let start = Math.max(fromId, world.eventHead - EVENT_RING_SIZE, world.eventHead - MAX_EVENTS_PER_SNAPSHOT);
  const countOffset = w.offset;
  w.u8(0);
  let count = 0;
  for (let id = start; id < world.eventHead; id++) {
    const e = world.events[id % EVENT_RING_SIZE];
    // Une attaque d'un ennemi invisible ne doit pas trahir sa position.
    if (e.type === EVENT.ATTACK && e.a < MAX_PLAYERS && !isVisibleTo(world.players[e.a], viewerTeam, world, viewer)) continue;
    // Pareil pour un joueur invisible touché ou soigné : l'événement donnerait sa position exacte.
    if ((e.type === EVENT.HIT || e.type === EVENT.HEAL) && e.b < MAX_PLAYERS && !isVisibleTo(world.players[e.b], viewerTeam, world, viewer)) continue;
    w.u8(e.type); w.u8(e.a); w.u8(e.b); w.u8(e.c);
    w.i16(quantPos(e.x)); w.i16(quantPos(e.y)); w.i16(clampInt16(e.value)); w.u16(quantAngle(e.angle));
    count++;
  }
  w.view.setUint8(countOffset, count);
  start = world.eventHead;
  return start;
}

/**
 * @typedef {Object} SnapshotContext
 * @property {Player|null} viewer   Joueur destinataire (null s'il est encore dans le menu).
 * @property {number} ackSeq        Dernier input traité pour ce destinataire.
 * @property {number} serverTime
 * @property {number} eventFrom     Premier événement pas encore envoyé à ce destinataire.
 */

/**
 * Écrit le snapshot d'un destinataire dans `w`.
 * @param {ByteWriter} w @param {World} world @param {SnapshotContext} ctx
 * @returns {number} Nouvelle valeur de eventFrom pour ce destinataire.
 */
export function encodeSnapshot(w, world, ctx) {
  w.reset();
  w.u8(MSG.SNAPSHOT);
  w.u32(world.tick >>> 0);
  w.f64(ctx.serverTime);
  w.u32(ctx.ackSeq >>> 0);
  w.u8(world.roundPhase);
  w.u8(world.arena.id);
  w.u32(clampUint(world.roundMs, 0xffffffff));
  w.u16(clampUint(world.scores[0], UINT16_MAX));
  w.u16(clampUint(world.scores[1], UINT16_MAX));
  const viewer = ctx.viewer;
  const viewerTeam = viewer !== null && viewer.active ? viewer.team : TEAM_BOTS;
  if (viewer !== null && viewer.active) {
    w.u8(viewer.slot);
    writeSelf(w, viewer);
  } else {
    w.u8(REF_NONE);
  }
  writePlayers(w, world, viewerTeam);
  writeBots(w, world);
  writeProjectiles(w, world);
  writeZones(w, world);
  return writeEvents(w, world, ctx.eventFrom, viewerTeam);
}

/**
 * Tranche du tampon à envoyer : une petite allocation par message, volontairement isolée ici
 * (la lib `ws` peut garder une référence au tampon jusqu'à l'envoi effectif, on ne peut donc pas le réutiliser).
 * @param {ByteWriter} w
 * @returns {ArrayBuffer}
 */
export function takeBytes(w) {
  return w.buffer.slice(0, w.offset);
}

// ---------------------------------------------------------------------------- décodage côté client

/**
 * @typedef {Object} SelfState
 * @property {number} x @property {number} y @property {number} kbVX @property {number} kbVY
 * @property {number} hp @property {boolean} dead @property {number} respawnMs
 * @property {number} attackCdMs @property {number} superCharge
 * @property {number} stunMs @property {number} slowMs @property {number} slowFactor
 * @property {number} speedBuffMs @property {number} speedMul @property {number} invisMs @property {number} blindMs
 * @property {number} shieldMs @property {number} dashMs @property {number} dashDirX @property {number} dashDirY
 * @property {number} dashSpeed @property {boolean} dashIsSuper @property {number} leapMs @property {number} leapTotalMs
 * @property {number} leapFromX @property {number} leapFromY @property {number} leapToX @property {number} leapToY
 * @property {boolean} leapIsSuper @property {number} team @property {number} brawlerId
 * @property {number} kills @property {number} deaths
 */

/**
 * @typedef {Object} NetPlayer
 * @property {number} slot @property {number} brawlerId @property {number} x @property {number} y
 * @property {number} aim @property {number} hp @property {number} flags @property {number} z
 */
/**
 * @typedef {Object} NetBot
 * @property {number} slot @property {number} type @property {number} x @property {number} y
 * @property {number} angle @property {number} hp @property {number} state @property {number} flags
 */
/**
 * @typedef {Object} NetProjectile
 * @property {number} id @property {number} visual @property {number} x @property {number} y
 * @property {number} angle @property {number} lob  0 = tir droit, sinon progression 0..1 du vol.
 */
/**
 * @typedef {Object} NetZone
 * @property {number} id @property {number} visual @property {number} x @property {number} y
 * @property {number} radius @property {number} life  Fraction de durée restante.
 */
/**
 * @typedef {Object} NetEvent
 * @property {number} type @property {number} a @property {number} b @property {number} c
 * @property {number} x @property {number} y @property {number} value @property {number} angle
 */

/**
 * @typedef {Object} Snapshot
 * @property {number} tick @property {number} serverTime @property {number} ackSeq
 * @property {number} roundPhase @property {number} mapId @property {number} roundMs @property {number} scoreA @property {number} scoreB
 * @property {number} selfSlot @property {SelfState} self
 * @property {number} playerCount @property {NetPlayer[]} players
 * @property {number} botCount @property {NetBot[]} bots
 * @property {number} projectileCount @property {NetProjectile[]} projectiles
 * @property {number} zoneCount @property {NetZone[]} zones
 * @property {number} eventCount @property {NetEvent[]} events
 * @property {boolean} eventsDispatched
 */

/**
 * @template T
 * @param {number} n @param {() => T} factory
 * @returns {T[]}
 */
function fill(n, factory) {
  const arr = new Array(n);
  for (let i = 0; i < n; i++) arr[i] = factory();
  return arr;
}

/** @returns {Snapshot} Structure pré-allouée, remplie en place à chaque réception. */
export function createSnapshot() {
  return {
    tick: 0, serverTime: FLOAT_ZERO, ackSeq: 0, roundPhase: 0, mapId: 0, roundMs: FLOAT_ZERO, scoreA: 0, scoreB: 0, selfSlot: REF_NONE,
    self: {
      x: FLOAT_ZERO, y: FLOAT_ZERO, kbVX: FLOAT_ZERO, kbVY: FLOAT_ZERO, hp: FLOAT_ZERO, dead: false, respawnMs: FLOAT_ZERO, attackCdMs: FLOAT_ZERO, superCharge: FLOAT_ZERO,
      stunMs: FLOAT_ZERO, slowMs: FLOAT_ZERO, slowFactor: 1, speedBuffMs: FLOAT_ZERO, speedMul: 1, invisMs: FLOAT_ZERO, blindMs: FLOAT_ZERO, shieldMs: FLOAT_ZERO,
      dashMs: FLOAT_ZERO, dashDirX: FLOAT_ZERO, dashDirY: FLOAT_ZERO, dashSpeed: FLOAT_ZERO, dashIsSuper: false, leapMs: FLOAT_ZERO, leapTotalMs: 1,
      leapFromX: FLOAT_ZERO, leapFromY: FLOAT_ZERO, leapToX: FLOAT_ZERO, leapToY: FLOAT_ZERO, leapIsSuper: false, team: 0, brawlerId: 0, kills: 0, deaths: 0,
    },
    playerCount: 0, players: fill(MAX_PLAYERS, () => ({ slot: 0, brawlerId: 0, x: FLOAT_ZERO, y: FLOAT_ZERO, aim: FLOAT_ZERO, hp: FLOAT_ZERO, flags: 0, z: 0 })),
    botCount: 0, bots: fill(MAX_BOTS, () => ({ slot: 0, type: 0, x: FLOAT_ZERO, y: FLOAT_ZERO, angle: FLOAT_ZERO, hp: FLOAT_ZERO, state: 0, flags: 0 })),
    projectileCount: 0, projectiles: fill(MAX_PROJECTILES, () => ({ id: 0, visual: 0, x: FLOAT_ZERO, y: FLOAT_ZERO, angle: FLOAT_ZERO, lob: FLOAT_ZERO })),
    zoneCount: 0, zones: fill(MAX_ZONES, () => ({ id: 0, visual: 0, x: FLOAT_ZERO, y: FLOAT_ZERO, radius: FLOAT_ZERO, life: FLOAT_ZERO })),
    eventCount: 0, events: fill(MAX_EVENTS_PER_SNAPSHOT, () => ({ type: 0, a: 0, b: 0, c: 0, x: FLOAT_ZERO, y: FLOAT_ZERO, value: 0, angle: FLOAT_ZERO })),
    eventsDispatched: false,
  };
}

/** @param {ByteReader} r @param {SelfState} s */
function readSelf(r, s) {
  s.x = r.f32(); s.y = r.f32(); s.kbVX = r.f32(); s.kbVY = r.f32();
  s.hp = r.f32(); s.dead = r.u8() === 1; s.respawnMs = r.f32();
  s.attackCdMs = r.f32(); s.superCharge = r.f32();
  s.stunMs = r.f32(); s.slowMs = r.f32(); s.slowFactor = r.u8() / PERCENT_SCALE;
  s.speedBuffMs = r.f32(); s.speedMul = r.u8() / PERCENT_SCALE;
  s.invisMs = r.f32(); s.blindMs = r.f32(); s.shieldMs = r.f32();
  s.dashMs = r.f32(); s.dashDirX = r.f32(); s.dashDirY = r.f32(); s.dashSpeed = r.f32(); s.dashIsSuper = r.u8() === 1;
  s.leapMs = r.f32(); s.leapTotalMs = r.f32(); s.leapFromX = r.f32(); s.leapFromY = r.f32();
  s.leapToX = r.f32(); s.leapToY = r.f32(); s.leapIsSuper = r.u8() === 1;
  s.team = r.u8(); s.brawlerId = r.u8(); s.kills = r.u16(); s.deaths = r.u16();
  if (s.brawlerId >= BRAWLER_COUNT) s.brawlerId = 0;
  if (!(s.leapTotalMs > 0)) s.leapTotalMs = 1;
}

/**
 * Lit un nombre d'éléments en le bornant à la capacité pré-allouée.
 * @param {ByteReader} r @param {number} capacity
 * @returns {number} -1 si le message est corrompu.
 */
function readCount(r, capacity) {
  if (!r.has(1)) return -1;
  const n = r.u8();
  return n > capacity ? -1 : n;
}

/**
 * Décode un snapshot dans une structure pré-allouée.
 * @param {ByteReader} r @param {Snapshot} s
 * @returns {boolean} false si le message est corrompu (on l'ignore alors entièrement).
 */
export function decodeSnapshot(r, s) {
  r.offset = 1;
  s.tick = r.u32(); s.serverTime = r.f64(); s.ackSeq = r.u32();
  s.roundPhase = r.u8(); s.mapId = r.u8(); s.roundMs = r.u32(); s.scoreA = r.u16(); s.scoreB = r.u16();
  s.selfSlot = r.u8();
  if (s.selfSlot !== REF_NONE) readSelf(r, s.self);
  let n = readCount(r, MAX_PLAYERS);
  if (n < 0) return false;
  for (let i = 0; i < n; i++) {
    const p = s.players[i];
    p.slot = r.u8(); p.brawlerId = r.u8(); p.x = r.i16() / POS_SCALE; p.y = r.i16() / POS_SCALE;
    p.aim = dequantAngle(r.u16()); p.hp = r.u16(); p.flags = r.u16(); p.z = r.u8();
    if (p.slot >= MAX_PLAYERS || p.brawlerId >= BRAWLER_COUNT) return false;
  }
  s.playerCount = n;
  n = readCount(r, MAX_BOTS);
  if (n < 0) return false;
  for (let i = 0; i < n; i++) {
    const b = s.bots[i];
    b.slot = r.u8(); b.type = r.u8(); b.x = r.i16() / POS_SCALE; b.y = r.i16() / POS_SCALE;
    b.angle = dequantAngle(r.u16()); b.hp = r.u16(); b.state = r.u8(); b.flags = r.u8();
    if (b.slot >= MAX_BOTS) return false;
  }
  s.botCount = n;
  n = readCount(r, MAX_PROJECTILES);
  if (n < 0) return false;
  for (let i = 0; i < n; i++) {
    const pr = s.projectiles[i];
    pr.id = r.u16(); pr.visual = r.u8(); pr.x = r.i16() / POS_SCALE; pr.y = r.i16() / POS_SCALE;
    pr.angle = dequantAngle(r.u16());
    const lob = r.u8();
    pr.lob = lob === 0 ? 0 : (lob - 1) / (PROGRESS_QUANT - 1);
  }
  s.projectileCount = n;
  n = readCount(r, MAX_ZONES);
  if (n < 0) return false;
  for (let i = 0; i < n; i++) {
    const z = s.zones[i];
    z.id = r.u16(); z.visual = r.u8(); z.x = r.i16() / POS_SCALE; z.y = r.i16() / POS_SCALE;
    z.radius = r.u8() / ZONE_RADIUS_SCALE; z.life = r.u8() / PROGRESS_QUANT;
  }
  s.zoneCount = n;
  n = readCount(r, MAX_EVENTS_PER_SNAPSHOT);
  if (n < 0) return false;
  for (let i = 0; i < n; i++) {
    const e = s.events[i];
    e.type = r.u8(); e.a = r.u8(); e.b = r.u8(); e.c = r.u8();
    e.x = r.i16() / POS_SCALE; e.y = r.i16() / POS_SCALE; e.value = r.i16(); e.angle = dequantAngle(r.u16());
  }
  s.eventCount = n;
  s.eventsDispatched = false;
  return r.offset <= r.length;
}

// ============================================================================
// MESSAGES TEXTE (JSON) : rares, donc lisibles plutôt que compacts
// ============================================================================

/**
 * @typedef {Object} JoinRequest
 * @property {'join'} t @property {string} name @property {number} brawler @property {string} room
 */
/** @typedef {{ t: 'leave' }} LeaveRequest */

/**
 * Nettoie un pseudo : caractères de contrôle retirés, longueur bornée, valeur par défaut.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeName(value) {
  if (typeof value !== 'string') return 'Élève';
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  return clean.length > 0 ? clean : 'Élève';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeRoom(value) {
  if (typeof value !== 'string') return DEFAULT_ROOM;
  const clean = value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, MAX_ROOM_LENGTH);
  return clean.length > 0 ? clean : DEFAULT_ROOM;
}

/**
 * Valide un message texte venant d'un client. Tout champ inattendu ou mal typé = rejet.
 * @param {string} text
 * @returns {JoinRequest|LeaveRequest|{t:'pick',brawler:number}|null}
 */
export function parseClientText(text) {
  /** @type {any} */
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.t === 'leave') return { t: 'leave' };
  if (data.t === 'pick') {
    if (!Number.isInteger(data.brawler) || data.brawler < 0 || data.brawler >= BRAWLER_COUNT) return null;
    return { t: 'pick', brawler: data.brawler };
  }
  if (data.t === 'start') return { t: 'start' };
  if (data.t === 'settings') {
    if (!ROUND_DURATION_CHOICES_MIN.includes(data.minutes)) return null;
    if (!Number.isInteger(data.map) || data.map < 0 || data.map > MAP_MODE_BOTH) return null;
    return { t: 'settings', minutes: data.minutes, map: data.map };
  }
  if (data.t !== 'join') return null;
  if (!Number.isInteger(data.brawler) || data.brawler < 0 || data.brawler >= BRAWLER_COUNT) return null;
  return { t: 'join', name: sanitizeName(data.name), brawler: data.brawler, room: sanitizeRoom(data.room) };
}

/** @param {string} name @param {number} brawler @param {string} room @returns {string} */
export function makeJoin(name, brawler, room) {
  return JSON.stringify({ t: 'join', name, brawler, room });
}

/** Changement de perso pendant l'écran de fin de manche. @param {number} brawler @returns {string} */
export function makePick(brawler) {
  return JSON.stringify({ t: 'pick', brawler });
}

/**
 * Tableau des scores de fin de manche.
 * @param {number} winner @param {number} scoreA @param {number} scoreB
 * @param {{slot:number,name:string,brawler:number,team:number,kills:number,deaths:number}[]} players
 * @returns {string}
 */
export function makeResults(winner, scoreA, scoreB, players) {
  return JSON.stringify({ t: 'results', winner, scoreA, scoreB, players });
}

/** Hôte : lance la partie depuis le salon d'attente. @returns {string} */
export function makeStart() {
  return JSON.stringify({ t: 'start' });
}

/** Hôte : réglages de la partie. @param {number} minutes @param {number} map @returns {string} */
export function makeSettings(minutes, map) {
  return JSON.stringify({ t: 'settings', minutes, map });
}

/**
 * État du salon d'attente envoyé à chacun (you = son identifiant, host = celui de l'hôte).
 * @param {number} you @param {number} host @param {{id:number,name:string,brawler:number}[]} players
 * @param {{minutes:number,map:number}} settings
 * @returns {string}
 */
export function makeLobby(you, host, players, settings) {
  return JSON.stringify({ t: 'lobby', you, host, players, minutes: settings.minutes, map: settings.map });
}

/** Nouvelle équipe après le tirage au sort de début de manche. @param {number} team @returns {string} */
export function makeTeam(team) {
  return JSON.stringify({ t: 'team', team });
}

/** @returns {string} */
export function makeLeave() {
  return JSON.stringify({ t: 'leave' });
}

/**
 * @typedef {Object} RosterEntry
 * @property {number} slot @property {string} name @property {number} brawler @property {number} team
 */

/** @param {number} slot @param {number} team @param {string} room @returns {string} */
export function makeWelcome(slot, team, room) {
  return JSON.stringify({ t: 'welcome', slot, team, room });
}

/** @param {RosterEntry[]} players @returns {string} */
export function makeRoster(players) {
  return JSON.stringify({ t: 'roster', players });
}

/** @param {string} message @returns {string} */
export function makeError(message) {
  return JSON.stringify({ t: 'error', message });
}

/**
 * Message texte serveur → client (le client vérifie quand même la forme : défense en profondeur).
 * @param {string} text
 * @returns {any|null}
 */
export function parseServerText(text) {
  try {
    const data = JSON.parse(text);
    return data !== null && typeof data === 'object' && typeof data.t === 'string' ? data : null;
  } catch {
    return null;
  }
}
