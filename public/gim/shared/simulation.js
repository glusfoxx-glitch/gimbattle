/**
 * Logique de jeu pure, partagée client/serveur.
 *
 * Deux niveaux :
 *  1. stepPlayerSelf()  — ce qui ne dépend que du joueur et de son input : minuteries, déplacement,
 *     dash, saut, bonus, décision de tirer. Le client l'exécute pour PRÉDIRE son propre perso,
 *     le serveur l'exécute pour faire autorité. Même fonction des deux côtés = réconciliation exacte.
 *  2. applyPlayerActions() / stepWorld() — ce qui touche les autres : projectiles, dégâts, zones,
 *     profs, manche. Exécuté uniquement par le serveur.
 *
 * Aucun accès au DOM, au réseau, à l'horloge ou à Math.random : dt et RNG arrivent en paramètres.
 */
import {
  ATTACK_KIND, BTN_ATTACK, BTN_SUPER, BTN_AUTO_AIM, ACTION_FIRED_MAIN, ACTION_FIRED_SUPER, ACTION_LEAP_LANDED,
  SUPER_MAX, TIMER_EPSILON_MS, KNOCKBACK_DAMPING, KNOCKBACK_MIN_SPEED, MAX_AIM_DISTANCE, AUTO_AIM_RANGE_FACTOR,
  MS_PER_SECOND, REF_NONE, BOT_REF_BASE, MAX_PLAYERS, MAX_BOTS, TEAM_A, TEAM_B, TEAM_BOTS, EVENT, ZONE_TICK_MS,
  ROUND_PHASE_PLAYING, ROUND_PHASE_ENDED, ROUND_DURATION_MS, ROUND_END_PAUSE_MS, ROUND_DRAW,
  SPAWN_SHIELD_MS, REGEN_DELAY_MS, REGEN_FRACTION_PER_SEC, BOT_FIRST_SPAWN_MS, NAV_UPDATE_TICKS, CONTACT_MARGIN,
  BEAM_LENGTH_SCALE, COLLISION_EPSILON, HALF, FLOAT_ZERO, HIDE_REVEAL_MS, HIDE_SEE_DISTANCE,
} from './constants.js';
import { inHideout } from './arena.js';
import { BRAWLERS, getAttack } from './brawlers.js';
import { resolveCircle, clamp, raycast, circleBlocked, distanceToSegmentSq, angleDelta, hasLineOfSight } from './physics.js';
import { emitEvent, getEntity } from './world.js';
import { queryTargets, applyEffects, damageEntity, healEntity, hitArea, QUERY_ENEMIES } from './combat.js';
import { stepBots, updateNav, spawnBotsIfNeeded, clearBots } from './bots.js';
import { nextInt } from './rng.js';

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {import('./world.js').Projectile} Projectile */
/** @typedef {import('./world.js').Zone} Zone */
/** @typedef {import('./arena.js').Arena} Arena */
/** @typedef {import('./brawlers.js').AttackDef} AttackDef */
/** @typedef {import('./brawlers.js').BrawlerDef} BrawlerDef */
/** @typedef {import('./rng.js').Rng} Rng */

/**
 * @typedef {Object} PlayerInput
 * @property {number} seq      Numéro croissant attribué par le client.
 * @property {number} moveX    Déplacement, vecteur de longueur ≤ 1.
 * @property {number} moveY
 * @property {number} aimAngle Radians.
 * @property {number} aimDist  0..1 de MAX_AIM_DISTANCE (lancers en cloche, saut).
 * @property {number} buttons  BTN_* en champ de bits.
 */

/** @returns {PlayerInput} */
export function createInput() {
  return { seq: 0, moveX: FLOAT_ZERO, moveY: FLOAT_ZERO, aimAngle: FLOAT_ZERO, aimDist: FLOAT_ZERO, buttons: 0 };
}

/** @param {PlayerInput} dst @param {PlayerInput} src */
export function copyInput(dst, src) {
  dst.seq = src.seq;
  dst.moveX = src.moveX;
  dst.moveY = src.moveY;
  dst.aimAngle = src.aimAngle;
  dst.aimDist = src.aimDist;
  dst.buttons = src.buttons;
}

// ============================================================================
// 1. PARTIE « SOI-MÊME » (prédite par le client)
// ============================================================================

/** @param {number} value @param {number} dtMs @returns {number} */
function decay(value, dtMs) {
  const v = value - dtMs;
  return v > 0 ? v : 0;
}

/** @param {Player} p @param {BrawlerDef} b @param {number} dtMs */
function tickPlayerTimers(p, b, dtMs) {
  p.attackCdMs = decay(p.attackCdMs, dtMs);
  p.stunMs = decay(p.stunMs, dtMs);
  p.slowMs = decay(p.slowMs, dtMs);
  if (p.slowMs === 0) p.slowFactor = 1;
  p.speedBuffMs = decay(p.speedBuffMs, dtMs);
  if (p.speedBuffMs === 0) p.speedMul = 1;
  p.invisMs = decay(p.invisMs, dtMs);
  p.blindMs = decay(p.blindMs, dtMs);
  p.shieldMs = decay(p.shieldMs, dtMs);
  p.superCharge = Math.min(SUPER_MAX, p.superCharge + (dtMs / b.superRechargeMs) * SUPER_MAX);
}

/**
 * @param {Player} p @param {BrawlerDef} b
 * @returns {number} Vitesse effective (m/s) après bonus et ralentissements.
 */
export function currentSpeed(p, b) {
  return b.speed * (p.speedBuffMs > 0 ? p.speedMul : 1) * (p.slowMs > 0 ? p.slowFactor : 1);
}

/**
 * Déplacement voulu + projection subie, puis résolution des collisions en une seule passe.
 * @param {Player} p @param {number} vx @param {number} vy @param {number} dtMs @param {Arena} arena
 * @returns {boolean} Contact avec un obstacle.
 */
function moveBody(p, vx, vy, dtMs, arena) {
  const dt = dtMs / MS_PER_SECOND;
  let dx = vx * dt;
  let dy = vy * dt;
  if (Math.abs(p.kbVX) + Math.abs(p.kbVY) > KNOCKBACK_MIN_SPEED) {
    dx += p.kbVX * dt;
    dy += p.kbVY * dt;
    const damp = Math.exp(-KNOCKBACK_DAMPING * dt);
    p.kbVX *= damp;
    p.kbVY *= damp;
  } else {
    p.kbVX = 0;
    p.kbVY = 0;
  }
  p.x += dx;
  p.y += dy;
  return resolveCircle(p, p.radius, arena);
}

/**
 * Le saut est une interpolation entre départ et arrivée : on ne collisionne qu'à l'atterrissage.
 * @param {Player} p @param {number} dtMs @param {Arena} arena
 * @returns {number} ACTION_LEAP_LANDED à l'atterrissage, sinon 0.
 */
function advanceLeap(p, dtMs, arena) {
  p.leapMs = decay(p.leapMs, dtMs);
  const t = 1 - p.leapMs / p.leapTotalMs;
  p.x = p.leapFromX + (p.leapToX - p.leapFromX) * t;
  p.y = p.leapFromY + (p.leapToY - p.leapFromY) * t;
  if (p.leapMs > 0) return 0;
  resolveCircle(p, p.radius, arena);
  return ACTION_LEAP_LANDED;
}

/**
 * @param {Player} p @param {number} dtMs @param {Arena} arena
 */
function advanceDash(p, dtMs, arena) {
  const step = Math.min(dtMs, p.dashMs);
  p.dashMs = decay(p.dashMs, dtMs);
  p.dashing = true;
  // Un dash qui percute un obstacle s'arrête net : pas de glissade le long du mur.
  if (moveBody(p, p.dashDirX * p.dashSpeed * (step / dtMs), p.dashDirY * p.dashSpeed * (step / dtMs), dtMs, arena)) p.dashMs = 0;
}

/**
 * Partie « soi-même » d'une attaque : dash, saut et bonus modifient le lanceur (donc se prédisent).
 * @param {Player} p @param {AttackDef} def @param {boolean} isSuper @param {PlayerInput} input @param {Arena} arena
 */
function startSelfPart(p, def, isSuper, input, arena) {
  const dirX = Math.cos(input.aimAngle);
  const dirY = Math.sin(input.aimAngle);
  if (def.kind === ATTACK_KIND.DASH) {
    p.dashMs = def.dashMs;
    p.dashDirX = dirX;
    p.dashDirY = dirY;
    p.dashSpeed = def.range / (def.dashMs / MS_PER_SECOND);
    p.dashIsSuper = isSuper;
    p.dashHitPlayers = 0;
    p.dashHitBots = 0;
  } else if (def.kind === ATTACK_KIND.LEAP) {
    const dist = clamp(input.aimDist * MAX_AIM_DISTANCE, 0, def.range);
    p.leapFromX = p.x;
    p.leapFromY = p.y;
    p.leapToX = clamp(p.x + dirX * dist, p.radius, arena.width - p.radius);
    p.leapToY = clamp(p.y + dirY * dist, p.radius, arena.height - p.radius);
    p.leapMs = def.leapMs;
    p.leapTotalMs = def.leapMs;
    p.leapIsSuper = isSuper;
  } else if (def.kind === ATTACK_KIND.BUFF) {
    if (def.speedMultiplier !== 1) { p.speedBuffMs = def.buffMs; p.speedMul = def.speedMultiplier; }
    if (def.invisible) p.invisMs = def.buffMs;
  }
}

/**
 * @param {Player} p @param {BrawlerDef} b @param {PlayerInput} input @param {Arena} arena
 * @returns {number} Drapeaux ACTION_*.
 */
function tryAttacks(p, b, input, arena) {
  if (p.dashMs > 0) return 0;
  if ((input.buttons & BTN_SUPER) !== 0 && p.superCharge >= SUPER_MAX) {
    p.superCharge = 0;
    p.shieldMs = 0;
    startSelfPart(p, b.super, true, input, arena);
    return ACTION_FIRED_SUPER;
  }
  // Invisible (Yann) : pas de tir tant que l'invisibilité dure.
  if ((input.buttons & BTN_ATTACK) !== 0 && p.attackCdMs <= TIMER_EPSILON_MS && p.invisMs <= 0) {
    p.attackCdMs = b.main.cooldownMs;
    p.shieldMs = 0;
    startSelfPart(p, b.main, false, input, arena);
    return ACTION_FIRED_MAIN;
  }
  return 0;
}

/**
 * Avance un joueur d'un pas fixe à partir d'un input. Fonction pure partagée (prédiction = autorité).
 * @param {Player} p @param {PlayerInput} input @param {number} dtMs @param {Arena} arena
 * @returns {number} Drapeaux ACTION_* (tir principal, super, atterrissage).
 */
export function stepPlayerSelf(p, input, dtMs, arena) {
  p.dashing = false;
  if (!p.active || p.dead) return 0;
  const b = BRAWLERS[p.brawlerId];
  tickPlayerTimers(p, b, dtMs);
  p.aimAngle = input.aimAngle;
  if (p.leapMs > 0) return advanceLeap(p, dtMs, arena);
  if (p.stunMs > 0) {
    p.dashMs = 0;
    moveBody(p, 0, 0, dtMs, arena);
    return 0;
  }
  if (p.dashMs > 0) {
    advanceDash(p, dtMs, arena);
  } else {
    const speed = currentSpeed(p, b);
    moveBody(p, input.moveX * speed, input.moveY * speed, dtMs, arena);
  }
  return tryAttacks(p, b, input, arena);
}

// ============================================================================
// 2. PARTIE MONDE (serveur uniquement)
// ============================================================================

/**
 * Tap court sur mobile : le SERVEUR choisit la cible la plus proche (le client ne décide de rien).
 * @param {World} world @param {Player} p @param {PlayerInput} input
 */
export function resolveAutoAim(world, p, input) {
  if ((input.buttons & BTN_AUTO_AIM) === 0 || !p.active || p.dead) return;
  const b = BRAWLERS[p.brawlerId];
  const def = (input.buttons & BTN_SUPER) !== 0 ? b.super : b.main;
  const range = (def.range > 0 ? def.range : MAX_AIM_DISTANCE) * AUTO_AIM_RANGE_FACTOR;
  let bestD2 = range * range;
  let bestX = 0;
  let bestY = 0;
  let found = false;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const t = world.players[i];
    if (!t.active || t.dead || t.team === p.team || t.invisMs > 0 || t.leapMs > 0) continue;
    const d2 = (t.x - p.x) * (t.x - p.x) + (t.y - p.y) * (t.y - p.y);
    if (d2 > HIDE_SEE_DISTANCE * HIDE_SEE_DISTANCE && isHidden(world, t)) continue;
    if (d2 < bestD2) { bestD2 = d2; bestX = t.x; bestY = t.y; found = true; }
  }
  for (let i = 0; i < MAX_BOTS; i++) {
    const t = world.bots[i];
    if (!t.active) continue;
    const d2 = (t.x - p.x) * (t.x - p.x) + (t.y - p.y) * (t.y - p.y);
    if (d2 < bestD2) { bestD2 = d2; bestX = t.x; bestY = t.y; found = true; }
  }
  if (!found) return;
  input.aimAngle = Math.atan2(bestY - p.y, bestX - p.x);
  input.aimDist = Math.min(1, Math.sqrt(bestD2) / MAX_AIM_DISTANCE);
}

/**
 * @param {World} world @param {Player} p @param {AttackDef} def
 */
function spawnProjectiles(world, p, def) {
  for (let i = 0; i < def.count; i++) {
    const angle = def.count > 1 ? p.aimAngle - def.spreadRad * HALF + (def.spreadRad * i) / (def.count - 1) : p.aimAngle;
    const pr = world.projectiles.acquire();
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    pr.ownerRef = p.ref;
    pr.team = p.team;
    pr.def = def;
    pr.x = p.x + dirX * p.radius * HALF;
    pr.y = p.y + dirY * p.radius * HALF;
    pr.prevX = p.x;
    pr.prevY = p.y;
    pr.vx = dirX * def.speed;
    pr.vy = dirY * def.speed;
    pr.speed = def.speed;
    pr.traveled = 0;
    pr.maxDist = def.range;
    pr.radius = def.radius;
    pr.visual = def.visual;
    pr.angle = angle;
    pr.isLob = false;
  }
}

/**
 * Lancer en cloche : la cible est le point visé (borné par la portée), on vole par-dessus les obstacles.
 * @param {World} world @param {Player} p @param {AttackDef} def @param {number} aimDist
 */
function spawnLob(world, p, def, aimDist) {
  const dist = clamp(aimDist * MAX_AIM_DISTANCE, 0, def.range);
  const pr = world.projectiles.acquire();
  pr.ownerRef = p.ref;
  pr.team = p.team;
  pr.def = def;
  pr.fromX = p.x;
  pr.fromY = p.y;
  pr.toX = clamp(p.x + Math.cos(p.aimAngle) * dist, 0, world.arena.width);
  pr.toY = clamp(p.y + Math.sin(p.aimAngle) * dist, 0, world.arena.height);
  pr.x = p.x;
  pr.y = p.y;
  pr.prevX = p.x;
  pr.prevY = p.y;
  pr.radius = def.radius;
  pr.visual = def.visual;
  pr.angle = p.aimAngle;
  pr.isLob = true;
  pr.lobMs = 0;
  // Un lancer court vole moins longtemps : sinon il semble flotter.
  pr.lobTotalMs = Math.max(def.lobMs * HALF, (def.lobMs * dist) / def.range);
}

/**
 * Coup au corps-à-corps en arc de cercle devant le joueur.
 * @param {World} world @param {Player} p @param {AttackDef} def
 */
function meleeArc(world, p, def) {
  const count = queryTargets(world, p.team, p.x, p.y, def.range, QUERY_ENEMIES, p.ref);
  for (let i = 0; i < count; i++) {
    const ref = world.queryRefs[i];
    const target = /** @type {Player} */ (getEntity(world, ref));
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dist = Math.max(COLLISION_EPSILON, Math.sqrt(dx * dx + dy * dy));
    // Tolérance angulaire élargie par la taille de la cible : on touche un gros prof par le bord.
    const tolerance = def.arcRad * HALF + Math.atan2(target.radius, dist);
    if (Math.abs(angleDelta(p.aimAngle, Math.atan2(dy, dx))) > tolerance) continue;
    if (!hasLineOfSight(p.x, p.y, target.x, target.y, world.arena)) continue;
    if (damageEntity(world, ref, def.damage, p.ref)) applyEffects(target, def, dx / dist, dy / dist);
  }
}

/**
 * Rayon instantané : touche le premier ennemi dans l'axe, s'arrête aux obstacles.
 * @param {World} world @param {Player} p @param {AttackDef} def
 * @returns {number} Longueur effective du rayon (pour l'affichage).
 */
function fireBeam(world, p, def) {
  const dirX = Math.cos(p.aimAngle);
  const dirY = Math.sin(p.aimAngle);
  const length = raycast(p.x, p.y, dirX, dirY, def.range, world.arena);
  const halfLength = length * HALF;
  const count = queryTargets(world, p.team, p.x + dirX * halfLength, p.y + dirY * halfLength, halfLength + def.beamWidth, QUERY_ENEMIES, p.ref);
  let bestRef = REF_NONE;
  let bestT = Infinity;
  for (let i = 0; i < count; i++) {
    const ref = world.queryRefs[i];
    const target = /** @type {Player} */ (getEntity(world, ref));
    const rx = target.x - p.x;
    const ry = target.y - p.y;
    const t = rx * dirX + ry * dirY;
    if (t < 0 || t > length + target.radius) continue;
    const perp2 = rx * rx + ry * ry - t * t;
    const reach = def.beamWidth + target.radius;
    if (perp2 <= reach * reach && t < bestT) { bestT = t; bestRef = ref; }
  }
  if (bestRef === REF_NONE) return length;
  const target = /** @type {Player} */ (getEntity(world, bestRef));
  if (damageEntity(world, bestRef, def.damage, p.ref)) applyEffects(target, def, dirX, dirY);
  return Math.min(length, bestT);
}

/**
 * @param {World} world @param {number} ownerRef @param {number} team @param {AttackDef} def @param {number} x @param {number} y
 */
function spawnZone(world, ownerRef, team, def, x, y) {
  const z = world.zones.acquire();
  z.ownerRef = ownerRef;
  z.team = team;
  z.def = def;
  z.x = x;
  z.y = y;
  z.radius = def.zoneRadius;
  z.remainingMs = def.zoneMs;
  z.totalMs = def.zoneMs;
  // Premier tick de dégâts immédiat : la zone « mord » dès son apparition.
  z.tickAccMs = ZONE_TICK_MS;
  z.visual = def.zoneVisual;
  z.followOwner = def.zoneFollowsOwner;
}

/**
 * @param {World} world @param {Player} p @param {AttackDef} def @param {boolean} isSuper @param {PlayerInput} input
 */
function performAttack(world, p, def, isSuper, input) {
  let value = 0;
  switch (def.kind) {
    case ATTACK_KIND.PROJECTILE: spawnProjectiles(world, p, def); break;
    case ATTACK_KIND.LOB: spawnLob(world, p, def, input.aimDist); break;
    case ATTACK_KIND.MELEE: meleeArc(world, p, def); break;
    case ATTACK_KIND.BEAM: value = Math.round(fireBeam(world, p, def) * BEAM_LENGTH_SCALE); break;
    case ATTACK_KIND.NOVA: hitArea(world, p.ref, p.team, p.x, p.y, def.aoeRadius, def, def.damage, p.aimAngle); break;
    case ATTACK_KIND.ZONE_SELF: spawnZone(world, p.ref, p.team, def, p.x, p.y); break;
    default: break; // DASH, LEAP, BUFF : déjà appliqués par stepPlayerSelf
  }
  const code = p.brawlerId * 2 + (isSuper ? 1 : 0);
  emitEvent(world, EVENT.ATTACK, p.ref, REF_NONE, code, p.x, p.y, value, p.aimAngle);
}

/**
 * Conséquences « monde » des actions renvoyées par stepPlayerSelf.
 * @param {World} world @param {Player} p @param {number} flags @param {PlayerInput} input
 */
export function applyPlayerActions(world, p, flags, input) {
  if (flags === 0) return;
  if ((flags & (ACTION_FIRED_SUPER | ACTION_FIRED_MAIN)) !== 0) p.revealMs = HIDE_REVEAL_MS;
  const b = BRAWLERS[p.brawlerId];
  if ((flags & ACTION_FIRED_SUPER) !== 0) performAttack(world, p, b.super, true, input);
  if ((flags & ACTION_FIRED_MAIN) !== 0) performAttack(world, p, b.main, false, input);
  if ((flags & ACTION_LEAP_LANDED) !== 0) {
    const def = getAttack(p.brawlerId, p.leapIsSuper);
    hitArea(world, p.ref, p.team, p.x, p.y, def.aoeRadius, def, def.damage, p.aimAngle);
    emitEvent(world, EVENT.LAND, p.ref, REF_NONE, p.brawlerId, p.x, p.y, 0, p.aimAngle);
  }
}

// ---------------------------------------------------------------------------- joueurs

/**
 * Caché dans une cachette (portemanteaux) et pas trahi par une attaque récente.
 * @param {World} world @param {Player} p @returns {boolean}
 */
export function isHidden(world, p) {
  return p.revealMs <= 0 && world.arena.hideouts.length > 0 && inHideout(world.arena, p.x, p.y);
}

/**
 * @param {World} world @param {Player} p @param {Rng} rng
 */
export function spawnPlayer(world, p, rng) {
  const b = BRAWLERS[p.brawlerId];
  const spawns = world.arena.teamSpawns[p.team];
  const spawn = spawns[nextInt(rng, spawns.length)];
  p.x = spawn.x;
  p.y = spawn.y;
  p.radius = b.radius;
  p.hp = b.hp;
  p.maxHp = b.hp;
  p.dead = false;
  p.respawnMs = 0;
  p.shieldMs = SPAWN_SHIELD_MS;
  p.attackCdMs = 0;
  p.stunMs = 0; p.slowMs = 0; p.slowFactor = 1; p.speedBuffMs = 0; p.speedMul = 1; p.invisMs = 0; p.blindMs = 0;
  p.dashMs = 0; p.dashing = false; p.leapMs = 0; p.kbVX = 0; p.kbVY = 0; p.outOfCombatMs = 0;
  p.aimAngle = p.team === TEAM_A ? 0 : Math.PI;
  resolveCircle(p, p.radius, world.arena);
  emitEvent(world, EVENT.RESPAWN, p.ref, REF_NONE, p.brawlerId, p.x, p.y, 0, p.aimAngle);
}

/**
 * @param {World} world @param {number} slot @param {number} team @param {number} brawlerId @param {Rng} rng
 * @returns {Player}
 */
export function activatePlayer(world, slot, team, brawlerId, rng) {
  const p = world.players[slot];
  p.active = true;
  p.team = team;
  p.brawlerId = brawlerId;
  p.kills = 0;
  p.deaths = 0;
  p.superCharge = 0;
  spawnPlayer(world, p, rng);
  return p;
}

/** @param {World} world @param {number} slot */
export function deactivatePlayer(world, slot) {
  const p = world.players[slot];
  p.active = false;
  p.dead = false;
  p.dashMs = 0;
  p.leapMs = 0;
}

/**
 * Contacts du dash (trottinette) : chaque cible n'est fauchée qu'une fois par dash.
 * @param {World} world @param {Player} p
 */
export function dashContacts(world, p) {
  const def = getAttack(p.brawlerId, p.dashIsSuper);
  const count = queryTargets(world, p.team, p.x, p.y, p.radius + CONTACT_MARGIN, QUERY_ENEMIES, p.ref);
  for (let i = 0; i < count; i++) {
    const ref = world.queryRefs[i];
    const isBot = ref >= BOT_REF_BASE;
    const bit = 1 << (isBot ? ref - BOT_REF_BASE : ref);
    if (((isBot ? p.dashHitBots : p.dashHitPlayers) & bit) !== 0) continue;
    if (isBot) p.dashHitBots |= bit; else p.dashHitPlayers |= bit;
    const target = /** @type {Player} */ (getEntity(world, ref));
    if (damageEntity(world, ref, def.damage, p.ref)) applyEffects(target, def, p.dashDirX, p.dashDirY);
  }
}

/**
 * @param {World} world @param {number} dtMs @param {Rng} rng
 */
function stepPlayersWorld(world, dtMs, rng) {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = world.players[i];
    if (!p.active) continue;
    if (p.dead) {
      p.respawnMs -= dtMs;
      if (p.respawnMs <= 0) spawnPlayer(world, p, rng);
      continue;
    }
    if (p.revealMs > 0) p.revealMs -= dtMs;
    if (p.dashing) dashContacts(world, p);
    if (p.hp < p.maxHp && world.roundPhase === ROUND_PHASE_PLAYING) {
      p.outOfCombatMs += dtMs;
      if (p.outOfCombatMs >= REGEN_DELAY_MS) {
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * REGEN_FRACTION_PER_SEC * (dtMs / MS_PER_SECOND));
      }
    }
  }
}

// ---------------------------------------------------------------------------- projectiles

/**
 * Cible touchée sur la trajectoire du tick (test segment) : la plus proche du point de départ.
 * Les brioches traversent les alliés en pleine santé pour ne pas « gâcher » le soin.
 * @param {World} world @param {Projectile} pr
 * @returns {number}
 */
function findProjectileTarget(world, pr) {
  let bestRef = REF_NONE;
  let bestD2 = Infinity;
  const canHeal = pr.def !== null && pr.def.heal > 0;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = world.players[i];
    if (!p.active || p.dead || p.leapMs > 0 || p.ref === pr.ownerRef) continue;
    const ally = p.team === pr.team;
    if (ally && (!canHeal || p.hp >= p.maxHp)) continue;
    const reach = p.radius + pr.radius;
    if (distanceToSegmentSq(p.x, p.y, pr.prevX, pr.prevY, pr.x, pr.y) > reach * reach) continue;
    const d2 = (p.x - pr.prevX) * (p.x - pr.prevX) + (p.y - pr.prevY) * (p.y - pr.prevY);
    if (d2 < bestD2) { bestD2 = d2; bestRef = p.ref; }
  }
  if (pr.team === TEAM_BOTS) return bestRef;
  for (let i = 0; i < MAX_BOTS; i++) {
    const b = world.bots[i];
    if (!b.active) continue;
    const reach = b.radius + pr.radius;
    if (distanceToSegmentSq(b.x, b.y, pr.prevX, pr.prevY, pr.x, pr.y) > reach * reach) continue;
    const d2 = (b.x - pr.prevX) * (b.x - pr.prevX) + (b.y - pr.prevY) * (b.y - pr.prevY);
    if (d2 < bestD2) { bestD2 = d2; bestRef = b.ref; }
  }
  return bestRef;
}

/**
 * @param {World} world @param {Projectile} pr @param {number} ref
 */
function projectileHit(world, pr, ref) {
  const def = /** @type {AttackDef} */ (pr.def);
  const target = /** @type {Player} */ (getEntity(world, ref));
  if (ref < MAX_PLAYERS && target.team === pr.team) {
    healEntity(world, ref, def.heal, pr.ownerRef);
  } else if (damageEntity(world, ref, def.damage, pr.ownerRef)) {
    applyEffects(target, def, pr.vx / pr.speed, pr.vy / pr.speed);
  }
  emitEvent(world, EVENT.IMPACT, pr.ownerRef, ref, pr.visual, pr.x, pr.y, 0, pr.angle);
}

/**
 * @param {World} world @param {Projectile} pr
 */
function lobImpact(world, pr) {
  const def = /** @type {AttackDef} */ (pr.def);
  hitArea(world, pr.ownerRef, pr.team, pr.x, pr.y, def.aoeRadius, def, def.damage, pr.angle);
  if (def.zoneMs > 0) spawnZone(world, pr.ownerRef, pr.team, def, pr.x, pr.y);
  emitEvent(world, EVENT.IMPACT, pr.ownerRef, REF_NONE, pr.visual, pr.x, pr.y, 0, pr.angle);
}

/**
 * @param {World} world @param {Projectile} pr @param {number} dtMs
 * @returns {boolean} true si le projectile doit disparaître.
 */
function stepProjectile(world, pr, dtMs) {
  if (pr.isLob) {
    pr.lobMs += dtMs;
    const t = Math.min(1, pr.lobMs / pr.lobTotalMs);
    pr.x = pr.fromX + (pr.toX - pr.fromX) * t;
    pr.y = pr.fromY + (pr.toY - pr.fromY) * t;
    if (t < 1) return false;
    lobImpact(world, pr);
    return true;
  }
  const dt = dtMs / MS_PER_SECOND;
  pr.prevX = pr.x;
  pr.prevY = pr.y;
  pr.x += pr.vx * dt;
  pr.y += pr.vy * dt;
  pr.traveled += pr.speed * dt;
  // Petit rayon contre les obstacles : un tir qui frôle un coin passe, c'est plus agréable à jouer.
  if (circleBlocked(pr.x, pr.y, pr.radius * HALF, world.arena)) {
    emitEvent(world, EVENT.IMPACT, pr.ownerRef, REF_NONE, pr.visual, pr.x, pr.y, 0, pr.angle);
    return true;
  }
  const ref = findProjectileTarget(world, pr);
  if (ref !== REF_NONE) {
    projectileHit(world, pr, ref);
    return true;
  }
  return pr.traveled >= pr.maxDist;
}

/** @param {World} world @param {number} dtMs */
function stepProjectiles(world, dtMs) {
  const pool = world.projectiles;
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const pr = /** @type {Projectile} */ (pool.active[i]);
    if (stepProjectile(world, pr, dtMs)) pool.release(pr);
  }
}

// ---------------------------------------------------------------------------- zones

/** @param {World} world @param {Zone} z */
function zoneTick(world, z) {
  const def = /** @type {AttackDef} */ (z.def);
  const damage = def.zoneDps * (ZONE_TICK_MS / MS_PER_SECOND);
  const count = queryTargets(world, z.team, z.x, z.y, z.radius, QUERY_ENEMIES, z.ownerRef);
  for (let i = 0; i < count; i++) {
    const ref = world.queryRefs[i];
    const target = /** @type {Player} */ (getEntity(world, ref));
    if (damageEntity(world, ref, damage, z.ownerRef) && def.zoneBlindMs > target.blindMs) target.blindMs = def.zoneBlindMs;
  }
}

/** @param {World} world @param {number} dtMs */
function stepZones(world, dtMs) {
  const pool = world.zones;
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const z = /** @type {Zone} */ (pool.active[i]);
    if (z.followOwner) {
      const owner = z.ownerRef < MAX_PLAYERS ? world.players[z.ownerRef] : null;
      if (owner === null || !owner.active || owner.dead) { pool.release(z); continue; }
      z.x = owner.x;
      z.y = owner.y;
    }
    z.tickAccMs += Math.min(dtMs, z.remainingMs);
    z.remainingMs -= dtMs;
    while (z.tickAccMs >= ZONE_TICK_MS && z.remainingMs > 0) {
      z.tickAccMs -= ZONE_TICK_MS;
      zoneTick(world, z);
    }
    if (z.remainingMs <= 0) pool.release(z);
  }
}

// ---------------------------------------------------------------------------- manche

/** @param {World} world */
function endRound(world) {
  world.roundPhase = ROUND_PHASE_ENDED;
  world.roundMs = ROUND_END_PAUSE_MS;
  const a = world.scores[TEAM_A];
  const b = world.scores[TEAM_B];
  const winner = a > b ? TEAM_A : b > a ? TEAM_B : ROUND_DRAW;
  world.projectiles.clear();
  world.zones.clear();
  emitEvent(world, EVENT.ROUND_END, REF_NONE, REF_NONE, winner, 0, 0, winner, 0);
}

/**
 * Nouvelle manche : scores à zéro, tout le monde réapparaît, les profs repartent.
 * @param {World} world @param {Rng} rng
 */
export function startRound(world, rng) {
  world.roundPhase = ROUND_PHASE_PLAYING;
  world.roundMs = world.roundDurationMs;
  world.scores.fill(0);
  world.projectiles.clear();
  world.zones.clear();
  clearBots(world);
  world.botSpawnMs = BOT_FIRST_SPAWN_MS;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = world.players[i];
    if (!p.active) continue;
    p.kills = 0;
    p.deaths = 0;
    p.superCharge = 0;
    spawnPlayer(world, p, rng);
  }
  emitEvent(world, EVENT.ROUND_START, REF_NONE, REF_NONE, 0, 0, 0, 0, 0);
}

/**
 * Avance tout ce qui ne dépend pas directement d'un input : à appeler APRÈS les stepPlayerSelf du tick.
 * @param {World} world @param {number} dtMs @param {Rng} rng
 */
export function stepWorld(world, dtMs, rng) {
  world.tick++;
  world.roundMs -= dtMs;
  if (world.roundMs <= 0) {
    if (world.roundPhase === ROUND_PHASE_PLAYING) endRound(world);
    else startRound(world, rng);
  }
  stepPlayersWorld(world, dtMs, rng);
  stepZones(world, dtMs);
  stepProjectiles(world, dtMs);
  if (world.roundPhase !== ROUND_PHASE_PLAYING) return;
  if (world.tick % NAV_UPDATE_TICKS === 0) updateNav(world);
  stepBots(world, dtMs);
  spawnBotsIfNeeded(world, dtMs, rng);
}

