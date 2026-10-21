/**
 * Règles de combat communes : requêtes de cibles, dégâts, soins, effets (ralenti, étourdi, projection), K.O. et score.
 * Uniquement exécuté par le serveur (autorité), mais pur : aucune horloge ni aléatoire caché.
 */
import {
  BOT_REF_BASE, MAX_PLAYERS, MAX_BOTS, TEAM_BOTS, SUPER_MAX, RESPAWN_MS, ROUND_PHASE_PLAYING,
  SCORE_PER_PLAYER_KO, SCORE_PER_BOT_KO, EVENT, COLLISION_EPSILON,
} from './constants.js';
import { BRAWLERS } from './brawlers.js';
import { emitEvent, getEntity } from './world.js';

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {import('./world.js').Bot} Bot */

export const QUERY_ENEMIES = 0;
export const QUERY_ALLIES = 1;

/**
 * @typedef {Object} EffectSource
 * @property {number} slowFactor @property {number} slowMs @property {number} stunMs @property {number} knockback
 */

/**
 * Remplit world.queryRefs avec les cibles dont le cercle touche (x, y, radius).
 * Les joueurs en l'air (saut) ou morts sont ignorés ; les profs ne se ciblent jamais entre eux.
 * @param {World} world @param {number} team  Équipe de l'attaquant.
 * @param {number} x @param {number} y @param {number} radius
 * @param {number} mode QUERY_ENEMIES | QUERY_ALLIES
 * @param {number} excludeRef
 * @returns {number} Nombre de cibles.
 */
export function queryTargets(world, team, x, y, radius, mode, excludeRef) {
  let count = 0;
  const refs = world.queryRefs;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = world.players[i];
    if (!p.active || p.dead || p.leapMs > 0 || p.ref === excludeRef) continue;
    const isAlly = p.team === team;
    if (mode === QUERY_ENEMIES ? isAlly : !isAlly) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    const reach = radius + p.radius;
    if (dx * dx + dy * dy <= reach * reach) refs[count++] = p.ref;
  }
  if (mode === QUERY_ENEMIES && team !== TEAM_BOTS) {
    for (let i = 0; i < MAX_BOTS; i++) {
      const b = world.bots[i];
      if (!b.active || b.ref === excludeRef) continue;
      const dx = b.x - x;
      const dy = b.y - y;
      const reach = radius + b.radius;
      if (dx * dx + dy * dy <= reach * reach) refs[count++] = b.ref;
    }
  }
  world.queryCount = count;
  return count;
}

/**
 * Applique ralenti, étourdissement et projection. Le ralenti le plus fort l'emporte.
 * @param {Player|Bot} target @param {EffectSource} def @param {number} dirX @param {number} dirY
 */
export function applyEffects(target, def, dirX, dirY) {
  if (def.slowMs > 0) {
    if (target.slowMs <= 0 || def.slowFactor < target.slowFactor) target.slowFactor = def.slowFactor;
    if (def.slowMs > target.slowMs) target.slowMs = def.slowMs;
  }
  if (def.stunMs > 0 && def.stunMs > target.stunMs) target.stunMs = def.stunMs;
  if (def.knockback > 0) {
    target.kbVX += dirX * def.knockback;
    target.kbVY += dirY * def.knockback;
  }
}

/**
 * Crédite l'attaquant : charge de super proportionnelle aux dégâts et sortie du mode « hors combat ».
 * @param {World} world @param {number} sourceRef @param {number} amount
 */
function creditAttacker(world, sourceRef, amount) {
  if (sourceRef >= MAX_PLAYERS) return;
  const p = world.players[sourceRef];
  if (!p.active) return;
  p.outOfCombatMs = 0;
  const chargeDamage = BRAWLERS[p.brawlerId].superChargeDamage;
  if (chargeDamage > 0) p.superCharge = Math.min(SUPER_MAX, p.superCharge + amount / chargeDamage);
}

/**
 * @param {World} world @param {Player|Bot} target @param {number} targetRef @param {number} sourceRef
 */
function knockOut(world, target, targetRef, sourceRef) {
  target.hp = 0;
  const victimIsPlayer = targetRef < BOT_REF_BASE;
  if (victimIsPlayer) {
    const p = /** @type {Player} */ (target);
    p.dead = true;
    p.respawnMs = RESPAWN_MS;
    p.deaths++;
    p.dashMs = 0;
    p.dashing = false;
    p.kbVX = 0;
    p.kbVY = 0;
  } else {
    target.active = false;
  }
  emitEvent(world, EVENT.KO, sourceRef, targetRef, 0, target.x, target.y, 0, 0);
  if (sourceRef >= MAX_PLAYERS) return;
  const killer = world.players[sourceRef];
  if (!killer.active) return;
  if (victimIsPlayer && target.team !== killer.team) {
    world.scores[killer.team] += SCORE_PER_PLAYER_KO;
    killer.kills++;
  } else if (!victimIsPlayer) {
    world.scores[killer.team] += SCORE_PER_BOT_KO;
    killer.kills++;
  }
}

/**
 * Inflige des dégâts. Refusé hors manche, sur un mort, un joueur protégé (réapparition) ou en l'air.
 * @param {World} world @param {number} targetRef @param {number} amount @param {number} sourceRef
 * @returns {boolean} true si les dégâts ont été appliqués.
 */
export function damageEntity(world, targetRef, amount, sourceRef) {
  if (world.roundPhase !== ROUND_PHASE_PLAYING || amount <= 0) return false;
  const target = getEntity(world, targetRef);
  if (target === null || !target.active) return false;
  if (targetRef < BOT_REF_BASE) {
    const p = /** @type {Player} */ (target);
    if (p.dead || p.shieldMs > 0 || p.leapMs > 0) return false;
    p.outOfCombatMs = 0;
  }
  target.hp -= amount;
  emitEvent(world, EVENT.HIT, sourceRef, targetRef, 0, target.x, target.y, Math.round(amount), 0);
  creditAttacker(world, sourceRef, amount);
  if (target.hp <= 0) knockOut(world, target, targetRef, sourceRef);
  return true;
}

/**
 * @param {World} world @param {number} targetRef @param {number} amount @param {number} sourceRef
 */
export function healEntity(world, targetRef, amount, sourceRef) {
  if (targetRef >= MAX_PLAYERS || amount <= 0) return;
  const p = world.players[targetRef];
  if (!p.active || p.dead || p.hp >= p.maxHp) return;
  const healed = Math.min(amount, p.maxHp - p.hp);
  p.hp += healed;
  emitEvent(world, EVENT.HEAL, sourceRef, targetRef, 0, p.x, p.y, Math.round(healed), 0);
}

/**
 * Dégâts de zone circulaire avec projection depuis le centre (explosion, onde de choc, atterrissage, coup de ventre).
 * @param {World} world @param {number} sourceRef @param {number} team
 * @param {number} x @param {number} y @param {number} radius
 * @param {EffectSource} effects @param {number} damage @param {number} fallbackAngle Direction de projection si la cible est pile au centre.
 */
export function hitArea(world, sourceRef, team, x, y, radius, effects, damage, fallbackAngle) {
  const count = queryTargets(world, team, x, y, radius, QUERY_ENEMIES, sourceRef);
  for (let i = 0; i < count; i++) {
    const ref = world.queryRefs[i];
    const target = /** @type {Player|Bot} */ (getEntity(world, ref));
    let dx = target.x - x;
    let dy = target.y - y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > COLLISION_EPSILON) { dx /= len; dy /= len; } else { dx = Math.cos(fallbackAngle); dy = Math.sin(fallbackAngle); }
    if (damageEntity(world, ref, damage, sourceRef)) applyEffects(target, effects, dx, dy);
  }
}
