/**
 * Carte de l'arène : une salle de classe fermée par des murs.
 * Disposition symétrique gauche/droite (équité entre BLEUS et ROUGES) et haut/bas.
 * Les obstacles bloquent déplacements, tirs droits et rayons ; les lancers en cloche passent par-dessus.
 */
import {
  ARENA_WIDTH, ARENA_HEIGHT, OBSTACLE_RECT, OBSTACLE_CIRCLE, OBSTACLE_LOOK,
  TABLE_HEIGHT, LOCKER_HEIGHT, PILLAR_HEIGHT, DESK_HEIGHT, HALF,
} from './constants.js';

/**
 * @typedef {Object} Obstacle
 * @property {number} kind    OBSTACLE_RECT | OBSTACLE_CIRCLE
 * @property {number} look    OBSTACLE_LOOK.*
 * @property {number} cx
 * @property {number} cy
 * @property {number} halfW
 * @property {number} halfH
 * @property {number} r
 * @property {number} minX
 * @property {number} minY
 * @property {number} maxX
 * @property {number} maxY
 * @property {number} height  Hauteur visuelle (m).
 */

/**
 * @typedef {Object} SpawnPoint
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} Arena
 * @property {number} width
 * @property {number} height
 * @property {readonly Obstacle[]} obstacles
 * @property {readonly (readonly SpawnPoint[])[]} teamSpawns
 * @property {readonly SpawnPoint[]} botSpawns
 */

/**
 * @param {number} look
 * @param {number} x  Coin haut-gauche
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} height
 * @returns {Obstacle}
 */
function rect(look, x, y, w, h, height) {
  return Object.freeze({
    kind: OBSTACLE_RECT, look, cx: x + w * HALF, cy: y + h * HALF, halfW: w * HALF, halfH: h * HALF,
    r: 0, minX: x, minY: y, maxX: x + w, maxY: y + h, height,
  });
}

/**
 * @param {number} look
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} height
 * @returns {Obstacle}
 */
function circle(look, cx, cy, r, height) {
  return Object.freeze({
    kind: OBSTACLE_CIRCLE, look, cx, cy, halfW: r, halfH: r, r,
    minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r, height,
  });
}

/** @param {number} x @param {number} y @returns {SpawnPoint} */
function point(x, y) {
  return Object.freeze({ x, y });
}

const T = OBSTACLE_LOOK.TABLE;
const L = OBSTACLE_LOOK.LOCKER;
const P = OBSTACLE_LOOK.PILLAR;
const D = OBSTACLE_LOOK.DESK;

/** @type {Arena} */
export const ARENA = Object.freeze({
  width: ARENA_WIDTH,
  height: ARENA_HEIGHT,
  obstacles: Object.freeze([
    // Piliers porteurs
    circle(P, 14, 8, 0.7, PILLAR_HEIGHT),
    circle(P, 26, 8, 0.7, PILLAR_HEIGHT),
    circle(P, 14, 18, 0.7, PILLAR_HEIGHT),
    circle(P, 26, 18, 0.7, PILLAR_HEIGHT),
    // Tables du centre : un couloir libre au milieu pour les duels
    rect(T, 18.4, 9.4, 3.2, 1.4, TABLE_HEIGHT),
    rect(T, 18.4, 15.2, 3.2, 1.4, TABLE_HEIGHT),
    // Tables latérales
    rect(T, 7.6, 5, 3.2, 1.4, TABLE_HEIGHT),
    rect(T, 7.6, 19.6, 3.2, 1.4, TABLE_HEIGHT),
    rect(T, 29.2, 5, 3.2, 1.4, TABLE_HEIGHT),
    rect(T, 29.2, 19.6, 3.2, 1.4, TABLE_HEIGHT),
    // Bureaux de prof devant chaque camp : couverture proche du point d'apparition
    rect(D, 11.4, 11.4, 1.4, 3.2, DESK_HEIGHT),
    rect(D, 27.2, 11.4, 1.4, 3.2, DESK_HEIGHT),
    // Casiers contre les murs et au centre
    rect(L, 5, 0, 0.9, 3.6, LOCKER_HEIGHT),
    rect(L, 34.1, 0, 0.9, 3.6, LOCKER_HEIGHT),
    rect(L, 5, 22.4, 0.9, 3.6, LOCKER_HEIGHT),
    rect(L, 34.1, 22.4, 0.9, 3.6, LOCKER_HEIGHT),
    rect(L, 19.4, 2.6, 1.2, 3.2, LOCKER_HEIGHT),
    rect(L, 19.4, 20.2, 1.2, 3.2, LOCKER_HEIGHT),
  ]),
  teamSpawns: Object.freeze([
    Object.freeze([point(2.2, 9), point(2.2, 13), point(2.2, 17)]),
    Object.freeze([point(37.8, 9), point(37.8, 13), point(37.8, 17)]),
  ]),
  // Les profs entrent par les « portes » du haut et du bas
  botSpawns: Object.freeze([point(12, 1), point(28, 1), point(12, 25), point(28, 25)]),
});
