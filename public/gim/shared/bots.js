/**
 * IA des profs : poursuite du joueur visible le plus proche, puis attaque annoncée (temps d'élan)
 * pour que les élèves aient toujours une chance d'esquiver.
 * Navigation : champ de distances (BFS multi-sources depuis tous les joueurs) sur une grille
 * pré-allouée, recalculé quelques fois par seconde. Chaque prof descend simplement le gradient.
 */
import {
  MAX_PLAYERS, MAX_BOTS, REF_NONE, TEAM_BOTS, BOT_STATE, BOT_BEHAVIOR, EVENT, NAV_CELL_SIZE, NAV_UNREACHED,
  BOT_RETARGET_TICKS, BOT_DIRECT_CHASE_DIST, BOT_SEPARATION_STRENGTH, BOT_WALL_STUN_MS, BOT_TURN_RATE,
  BOT_SPAWN_INTERVAL_MS, BOTS_BASE_COUNT, BOTS_PER_PLAYER, CONTACT_MARGIN, KNOCKBACK_DAMPING,
  KNOCKBACK_MIN_SPEED, MS_PER_SECOND, ZONE_RADIUS_SCALE, COLLISION_EPSILON, HALF,
} from './constants.js';
import { PROFS, PROF_COUNT } from './profs.js';
import { resolveCircle, hasLineOfSight, angleDelta } from './physics.js';
import { emitEvent, countActivePlayers } from './world.js';
import { queryTargets, damageEntity, applyEffects, hitArea, QUERY_ENEMIES } from './combat.js';
import { nextInt } from './rng.js';

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Bot} Bot */
/** @typedef {import('./profs.js').ProfDef} ProfDef */
/** @typedef {import('./rng.js').Rng} Rng */

/** Vecteur temporaire réutilisé (aucune allocation par tick). */
const steer = { x: 0, y: 0 };
const UNREACHABLE_DISTANCE = 32767;

/**
 * @param {import('./world.js').NavGrid} nav @param {number} x @param {number} y
 * @returns {number} Index de cellule, -1 hors grille.
 */
function cellIndex(nav, x, y) {
  const col = Math.floor(x / NAV_CELL_SIZE);
  const row = Math.floor(y / NAV_CELL_SIZE);
  if (col < 0 || row < 0 || col >= nav.cols || row >= nav.rows) return -1;
  return row * nav.cols + col;
}

/**
 * @param {World} world @param {number} ref
 * @returns {boolean}
 */
function isValidTarget(world, ref) {
  if (ref === REF_NONE || ref >= MAX_PLAYERS) return false;
  const p = world.players[ref];
  return p.active && !p.dead && p.invisMs <= 0 && p.leapMs <= 0;
}

/**
 * Recalcule le champ de distances vers les joueurs ciblables.
 * @param {World} world
 */
export function updateNav(world) {
  const nav = world.nav;
  const dist = nav.dist;
  const queue = nav.queue;
  dist.fill(NAV_UNREACHED);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!isValidTarget(world, i)) continue;
    const p = world.players[i];
    const cell = cellIndex(nav, p.x, p.y);
    if (cell >= 0 && dist[cell] === NAV_UNREACHED) {
      dist[cell] = 0;
      queue[tail++] = cell;
    }
  }
  while (head < tail) {
    const cell = queue[head++];
    const col = cell % nav.cols;
    const row = (cell - col) / nav.cols;
    const next = dist[cell] + 1;
    if (col > 0) tail = visit(nav, cell - 1, next, tail);
    if (col < nav.cols - 1) tail = visit(nav, cell + 1, next, tail);
    if (row > 0) tail = visit(nav, cell - nav.cols, next, tail);
    if (row < nav.rows - 1) tail = visit(nav, cell + nav.cols, next, tail);
  }
}

/**
 * @param {import('./world.js').NavGrid} nav @param {number} cell @param {number} distance @param {number} tail
 * @returns {number} Nouvelle fin de file.
 */
function visit(nav, cell, distance, tail) {
  if (nav.blocked[cell] === 1 || nav.dist[cell] !== NAV_UNREACHED) return tail;
  nav.dist[cell] = distance;
  nav.queue[tail] = cell;
  return tail + 1;
}

/**
 * Direction vers la cellule voisine la plus proche d'un joueur. Écrit dans `steer`.
 * @param {World} world @param {number} x @param {number} y
 * @returns {boolean} false si aucun chemin.
 */
function navDirection(world, x, y) {
  const nav = world.nav;
  const cell = cellIndex(nav, x, y);
  if (cell < 0) return false;
  const col = cell % nav.cols;
  const row = (cell - col) / nav.cols;
  let best = nav.dist[cell] >= 0 ? nav.dist[cell] : UNREACHABLE_DISTANCE;
  let bestCol = -1;
  let bestRow = -1;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= nav.cols || nr >= nav.rows) continue;
      const n = nr * nav.cols + nc;
      if (nav.blocked[n] === 1) continue;
      // Diagonale interdite si elle « coupe » un coin d'obstacle.
      if (dr !== 0 && dc !== 0 && (nav.blocked[row * nav.cols + nc] === 1 || nav.blocked[nr * nav.cols + col] === 1)) continue;
      const d = nav.dist[n];
      if (d >= 0 && d < best) { best = d; bestCol = nc; bestRow = nr; }
    }
  }
  if (bestCol < 0) return false;
  const dx = (bestCol + HALF) * NAV_CELL_SIZE - x;
  const dy = (bestRow + HALF) * NAV_CELL_SIZE - y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < COLLISION_EPSILON) return false;
  steer.x = dx / len;
  steer.y = dy / len;
  return true;
}

/**
 * @param {World} world @param {Bot} bot
 * @returns {number} Référence du joueur visible le plus proche.
 */
function findTarget(world, bot) {
  if (bot.blindMs > 0) return REF_NONE;
  let bestRef = REF_NONE;
  let bestD2 = Infinity;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!isValidTarget(world, i)) continue;
    const p = world.players[i];
    const dx = p.x - bot.x;
    const dy = p.y - bot.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; bestRef = i; }
  }
  return bestRef;
}

/** @param {number} value @param {number} dtMs @returns {number} */
function decay(value, dtMs) {
  const v = value - dtMs;
  return v > 0 ? v : 0;
}

/**
 * @param {World} world @param {Bot} bot @param {ProfDef} type @param {number} angle
 */
function startWindup(world, bot, type, angle) {
  bot.state = BOT_STATE.WINDUP;
  bot.stateMs = type.windupMs;
  bot.angle = angle;
  const cx = bot.x + Math.cos(angle) * type.strikeOffset;
  const cy = bot.y + Math.sin(angle) * type.strikeOffset;
  // Le coup tombe exactement là où il a été annoncé (même si le prof est repoussé pendant la préparation).
  bot.strikeX = cx;
  bot.strikeY = cy;
  emitEvent(world, EVENT.BOT_WINDUP, bot.ref, REF_NONE, type.id, cx, cy, Math.round(type.strikeRadius * ZONE_RADIUS_SCALE), angle);
}

/**
 * @param {World} world @param {Bot} bot @param {ProfDef} type
 */
function finishWindup(world, bot, type) {
  if (type.behavior === BOT_BEHAVIOR.CHARGE) {
    bot.state = BOT_STATE.CHARGE;
    bot.stateMs = type.chargeMs;
    bot.chargeDirX = Math.cos(bot.angle);
    bot.chargeDirY = Math.sin(bot.angle);
    bot.hitPlayers = 0;
    return;
  }
  const cx = bot.strikeX;
  const cy = bot.strikeY;
  hitArea(world, bot.ref, TEAM_BOTS, cx, cy, type.strikeRadius, type, type.damage, bot.angle);
  emitEvent(world, EVENT.BOT_STRIKE, bot.ref, REF_NONE, type.id, cx, cy, Math.round(type.strikeRadius * ZONE_RADIUS_SCALE), bot.angle);
  enterRecover(bot, type);
}

/** @param {Bot} bot @param {ProfDef} type */
function enterRecover(bot, type) {
  bot.state = BOT_STATE.RECOVER;
  bot.stateMs = type.recoverMs;
  bot.cooldownMs = type.cooldownMs;
}

/**
 * Charge de Tarquinio : chaque élève n'est percuté qu'une fois par charge (masque de bits).
 * @param {World} world @param {Bot} bot @param {ProfDef} type
 */
function chargeContacts(world, bot, type) {
  const count = queryTargets(world, TEAM_BOTS, bot.x, bot.y, bot.radius + CONTACT_MARGIN, QUERY_ENEMIES, REF_NONE);
  for (let i = 0; i < count; i++) {
    const ref = world.queryRefs[i];
    const bit = 1 << ref;
    if ((bot.hitPlayers & bit) !== 0) continue;
    bot.hitPlayers |= bit;
    const target = world.players[ref];
    if (damageEntity(world, ref, type.damage, bot.ref)) applyEffects(target, type, bot.chargeDirX, bot.chargeDirY);
  }
}

/**
 * Poursuite : choisit la cible, déclenche l'attaque si possible, sinon calcule la vitesse voulue.
 * @param {World} world @param {Bot} bot @param {ProfDef} type
 */
function chase(world, bot, type) {
  steer.x = 0;
  steer.y = 0;
  if (bot.blindMs > 0) { bot.targetRef = REF_NONE; bot.state = BOT_STATE.IDLE; return; }
  bot.retargetTicks--;
  if (bot.retargetTicks <= 0 || !isValidTarget(world, bot.targetRef)) {
    bot.targetRef = findTarget(world, bot);
    bot.retargetTicks = BOT_RETARGET_TICKS;
  }
  steer.x = 0;
  steer.y = 0;
  if (bot.targetRef === REF_NONE) { bot.state = BOT_STATE.IDLE; return; }
  bot.state = BOT_STATE.CHASE;
  const target = world.players[bot.targetRef];
  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  const los = hasLineOfSight(bot.x, bot.y, target.x, target.y, world.arena);
  if (bot.cooldownMs <= 0) {
    const meleeReady = type.behavior === BOT_BEHAVIOR.MELEE && dist <= type.detectRange + target.radius && los;
    const chargeReady = type.behavior === BOT_BEHAVIOR.CHARGE && dist <= type.detectRange && los;
    if (meleeReady || chargeReady) { startWindup(world, bot, type, angle); return; }
  }
  if ((los && dist < BOT_DIRECT_CHASE_DIST) || !navDirection(world, bot.x, bot.y)) {
    if (dist > COLLISION_EPSILON) { steer.x = dx / dist; steer.y = dy / dist; }
  }
}

/**
 * @param {World} world @param {Bot} bot @param {number} dtMs
 */
function stepBot(world, bot, dtMs) {
  const type = PROFS[bot.type];
  bot.stunMs = decay(bot.stunMs, dtMs);
  bot.slowMs = decay(bot.slowMs, dtMs);
  if (bot.slowMs === 0) bot.slowFactor = 1;
  bot.blindMs = decay(bot.blindMs, dtMs);
  bot.cooldownMs = decay(bot.cooldownMs, dtMs);
  bot.stateMs = decay(bot.stateMs, dtMs);
  const dt = dtMs / MS_PER_SECOND;
  let chargeEnds = false;
  let vx = 0;
  let vy = 0;
  if (bot.stunMs > 0) {
    if (bot.state === BOT_STATE.CHARGE || bot.state === BOT_STATE.WINDUP) enterRecover(bot, type);
  } else if (bot.state === BOT_STATE.WINDUP) {
    if (bot.stateMs <= 0) finishWindup(world, bot, type);
  } else if (bot.state === BOT_STATE.CHARGE) {
    vx = bot.chargeDirX * type.chargeSpeed;
    vy = bot.chargeDirY * type.chargeSpeed;
    if (bot.stateMs <= 0) chargeEnds = true;
  } else if (bot.state === BOT_STATE.RECOVER) {
    if (bot.stateMs <= 0) bot.state = BOT_STATE.CHASE;
  } else {
    chase(world, bot, type);
    const speed = type.speed * (bot.slowMs > 0 ? bot.slowFactor : 1);
    vx = steer.x * speed;
    vy = steer.y * speed;
    if (vx !== 0 || vy !== 0) bot.angle += angleDelta(bot.angle, Math.atan2(vy, vx)) * Math.min(1, BOT_TURN_RATE * dt);
  }
  if (Math.abs(bot.kbVX) + Math.abs(bot.kbVY) > KNOCKBACK_MIN_SPEED) {
    vx += bot.kbVX;
    vy += bot.kbVY;
    const damp = Math.exp(-KNOCKBACK_DAMPING * dt);
    bot.kbVX *= damp;
    bot.kbVY *= damp;
  } else {
    bot.kbVX = 0;
    bot.kbVY = 0;
  }
  bot.x += vx * dt;
  bot.y += vy * dt;
  const hitWall = resolveCircle(bot, bot.radius, world.arena);
  if (bot.state === BOT_STATE.CHARGE) {
    chargeContacts(world, bot, type);
    if (hitWall) {
      bot.stunMs = BOT_WALL_STUN_MS;
      enterRecover(bot, type);
      emitEvent(world, EVENT.IMPACT, bot.ref, REF_NONE, 0, bot.x, bot.y, 0, bot.angle);
    } else if (chargeEnds) {
      enterRecover(bot, type);
    }
  }
}

/**
 * Les profs se repoussent entre eux pour ne pas s'empiler sur la même case.
 * @param {World} world
 */
function separateBots(world) {
  for (let i = 0; i < MAX_BOTS; i++) {
    const a = world.bots[i];
    if (!a.active) continue;
    for (let j = i + 1; j < MAX_BOTS; j++) {
      const b = world.bots[j];
      if (!b.active) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minDist = a.radius + b.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minDist * minDist || d2 < COLLISION_EPSILON) continue;
      const d = Math.sqrt(d2);
      const push = (minDist - d) * HALF * BOT_SEPARATION_STRENGTH / d;
      a.x -= dx * push; a.y -= dy * push;
      b.x += dx * push; b.y += dy * push;
      resolveCircle(a, a.radius, world.arena);
      resolveCircle(b, b.radius, world.arena);
    }
  }
}

/**
 * @param {World} world @param {number} dtMs
 */
export function stepBots(world, dtMs) {
  for (let i = 0; i < MAX_BOTS; i++) {
    const bot = world.bots[i];
    if (bot.active) stepBot(world, bot, dtMs);
  }
  separateBots(world);
}

/**
 * Choisit le type de prof le moins représenté (égalités départagées par le RNG) pour varier les menaces.
 * @param {World} world @param {Rng} rng
 * @returns {number}
 */
function pickProfType(world, rng) {
  const start = nextInt(rng, PROF_COUNT);
  let bestType = start;
  let bestCount = Infinity;
  for (let k = 0; k < PROF_COUNT; k++) {
    const t = (start + k) % PROF_COUNT;
    let count = 0;
    for (let i = 0; i < MAX_BOTS; i++) if (world.bots[i].active && world.bots[i].type === t) count++;
    if (count < bestCount) { bestCount = count; bestType = t; }
  }
  return bestType;
}

/**
 * @param {World} world @param {Rng} rng
 */
function spawnBot(world, rng) {
  let bot = null;
  for (let i = 0; i < MAX_BOTS; i++) if (!world.bots[i].active) { bot = world.bots[i]; break; }
  if (bot === null) return;
  const type = PROFS[pickProfType(world, rng)];
  const spawn = world.arena.botSpawns[nextInt(rng, world.arena.botSpawns.length)];
  bot.active = true;
  bot.type = type.id;
  bot.x = spawn.x;
  bot.y = spawn.y;
  bot.radius = type.radius;
  bot.hp = type.hp;
  bot.maxHp = type.hp;
  bot.angle = spawn.y < world.arena.height * HALF ? Math.PI * HALF : -Math.PI * HALF;
  bot.state = BOT_STATE.IDLE;
  bot.stateMs = 0;
  bot.cooldownMs = type.cooldownMs;
  bot.targetRef = REF_NONE;
  bot.retargetTicks = 0;
  bot.stunMs = 0; bot.slowMs = 0; bot.slowFactor = 1; bot.blindMs = 0;
  bot.kbVX = 0; bot.kbVY = 0; bot.hitPlayers = 0;
  resolveCircle(bot, bot.radius, world.arena);
  emitEvent(world, EVENT.BOT_SPAWN, bot.ref, REF_NONE, type.id, bot.x, bot.y, 0, bot.angle);
}

/**
 * Fait entrer des profs à intervalle régulier, plus nombreux quand la classe est pleine.
 * @param {World} world @param {number} dtMs @param {Rng} rng
 */
export function spawnBotsIfNeeded(world, dtMs, rng) {
  const players = countActivePlayers(world);
  if (players === 0) return;
  world.botSpawnMs -= dtMs;
  if (world.botSpawnMs > 0) return;
  world.botSpawnMs = BOT_SPAWN_INTERVAL_MS;
  const maxBots = Math.min(MAX_BOTS, Math.floor(BOTS_BASE_COUNT + players * BOTS_PER_PLAYER));
  let alive = 0;
  for (let i = 0; i < MAX_BOTS; i++) if (world.bots[i].active) alive++;
  if (alive < maxBots) spawnBot(world, rng);
}

/** @param {World} world */
export function clearBots(world) {
  for (let i = 0; i < MAX_BOTS; i++) world.bots[i].active = false;
}
