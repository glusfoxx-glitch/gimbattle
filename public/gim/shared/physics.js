/**
 * Géométrie de collision 2D (plan du sol). Fonctions pures, sans allocation.
 * Les corps sont des objets possédant au moins { x, y } ; on les modifie en place.
 */
import { OBSTACLE_RECT, COLLISION_ITERATIONS, COLLISION_EPSILON, TWO_PI } from './constants.js';

/** @typedef {import('./arena.js').Arena} Arena */
/** @typedef {import('./arena.js').Obstacle} Obstacle */
/** @typedef {{ x: number, y: number }} Body */

/**
 * @param {number} v @param {number} min @param {number} max
 * @returns {number}
 */
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/**
 * Écart angulaire signé ramené dans [-π, π].
 * @param {number} a @param {number} b
 * @returns {number}
 */
export function angleDelta(a, b) {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d < -Math.PI) d += TWO_PI;
  return d;
}

/**
 * @param {Body} body @param {number} radius @param {Obstacle} o
 * @returns {boolean}
 */
function pushOutRect(body, radius, o) {
  const nearX = clamp(body.x, o.minX, o.maxX);
  const nearY = clamp(body.y, o.minY, o.maxY);
  const dx = body.x - nearX;
  const dy = body.y - nearY;
  const d2 = dx * dx + dy * dy;
  if (d2 >= radius * radius) return false;
  if (d2 > COLLISION_EPSILON) {
    const d = Math.sqrt(d2);
    const push = (radius - d) / d;
    body.x += dx * push;
    body.y += dy * push;
    return true;
  }
  // Centre à l'intérieur du rectangle (téléportation, saut) : on sort par le bord le plus proche.
  const left = body.x - o.minX;
  const right = o.maxX - body.x;
  const top = body.y - o.minY;
  const bottom = o.maxY - body.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) body.x = o.minX - radius;
  else if (m === right) body.x = o.maxX + radius;
  else if (m === top) body.y = o.minY - radius;
  else body.y = o.maxY + radius;
  return true;
}

/**
 * @param {Body} body @param {number} radius @param {Obstacle} o
 * @returns {boolean}
 */
function pushOutCircle(body, radius, o) {
  const dx = body.x - o.cx;
  const dy = body.y - o.cy;
  const minDist = radius + o.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minDist * minDist) return false;
  if (d2 > COLLISION_EPSILON) {
    const d = Math.sqrt(d2);
    const push = (minDist - d) / d;
    body.x += dx * push;
    body.y += dy * push;
  } else {
    body.x = o.cx + minDist;
  }
  return true;
}

/**
 * @param {Body} body @param {number} radius @param {Arena} arena
 * @returns {boolean}
 */
export function clampToArena(body, radius, arena) {
  let hit = false;
  if (body.x < radius) { body.x = radius; hit = true; }
  else if (body.x > arena.width - radius) { body.x = arena.width - radius; hit = true; }
  if (body.y < radius) { body.y = radius; hit = true; }
  else if (body.y > arena.height - radius) { body.y = arena.height - radius; hit = true; }
  return hit;
}

/**
 * Sort un cercle des obstacles et le garde dans l'arène.
 * @param {Body} body @param {number} radius @param {Arena} arena
 * @returns {boolean} true s'il y a eu contact (utile pour stopper une charge ou un dash).
 */
export function resolveCircle(body, radius, arena) {
  let hit = false;
  const obstacles = arena.obstacles;
  for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration++) {
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (o.kind === OBSTACLE_RECT ? pushOutRect(body, radius, o) : pushOutCircle(body, radius, o)) hit = true;
    }
  }
  if (clampToArena(body, radius, arena)) hit = true;
  return hit;
}

/**
 * Le cercle (x, y, r) chevauche-t-il un obstacle ou sort-il de l'arène ?
 * @param {number} x @param {number} y @param {number} radius @param {Arena} arena
 * @returns {boolean}
 */
export function circleBlocked(x, y, radius, arena) {
  if (x < radius || y < radius || x > arena.width - radius || y > arena.height - radius) return true;
  const obstacles = arena.obstacles;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (o.kind === OBSTACLE_RECT) {
      const dx = x - clamp(x, o.minX, o.maxX);
      const dy = y - clamp(y, o.minY, o.maxY);
      if (dx * dx + dy * dy < radius * radius) return true;
    } else {
      const dx = x - o.cx;
      const dy = y - o.cy;
      const minDist = radius + o.r;
      if (dx * dx + dy * dy < minDist * minDist) return true;
    }
  }
  return false;
}

/**
 * @param {number} ox @param {number} oy @param {number} dx @param {number} dy @param {Obstacle} o
 * @returns {number} Distance d'entrée, Infinity si raté.
 */
function rayRect(ox, oy, dx, dy, o) {
  let tMin = 0;
  let tMax = Infinity;
  if (Math.abs(dx) < COLLISION_EPSILON) {
    if (ox < o.minX || ox > o.maxX) return Infinity;
  } else {
    let t1 = (o.minX - ox) / dx;
    let t2 = (o.maxX - ox) / dx;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return Infinity;
  }
  if (Math.abs(dy) < COLLISION_EPSILON) {
    if (oy < o.minY || oy > o.maxY) return Infinity;
  } else {
    let t1 = (o.minY - oy) / dy;
    let t2 = (o.maxY - oy) / dy;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return Infinity;
  }
  return tMin;
}

/**
 * @param {number} ox @param {number} oy @param {number} dx @param {number} dy @param {Obstacle} o
 * @returns {number}
 */
function rayCircle(ox, oy, dx, dy, o) {
  const fx = ox - o.cx;
  const fy = oy - o.cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - o.r * o.r;
  if (c <= 0) return 0;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

/**
 * Distance parcourue par un rayon (direction unitaire) avant de toucher un obstacle ou un mur.
 * @param {number} ox @param {number} oy @param {number} dx @param {number} dy
 * @param {number} maxDist @param {Arena} arena
 * @returns {number}
 */
export function raycast(ox, oy, dx, dy, maxDist, arena) {
  let best = maxDist;
  if (dx > COLLISION_EPSILON) best = Math.min(best, (arena.width - ox) / dx);
  else if (dx < -COLLISION_EPSILON) best = Math.min(best, -ox / dx);
  if (dy > COLLISION_EPSILON) best = Math.min(best, (arena.height - oy) / dy);
  else if (dy < -COLLISION_EPSILON) best = Math.min(best, -oy / dy);
  const obstacles = arena.obstacles;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const t = o.kind === OBSTACLE_RECT ? rayRect(ox, oy, dx, dy, o) : rayCircle(ox, oy, dx, dy, o);
    if (t < best) best = t;
  }
  return best < 0 ? 0 : best;
}

/**
 * Ligne de vue dégagée entre deux points ?
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {Arena} arena
 * @returns {boolean}
 */
export function hasLineOfSight(x0, y0, x1, y1, arena) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < COLLISION_EPSILON) return true;
  return raycast(x0, y0, dx / len, dy / len, len, arena) >= len - COLLISION_EPSILON;
}

/**
 * Distance au carré entre un point et un segment [A, B].
 * Sert aux projectiles rapides : on teste toute la trajectoire du tick, pas seulement le point d'arrivée.
 * @param {number} px @param {number} py @param {number} ax @param {number} ay @param {number} bx @param {number} by
 * @returns {number}
 */
export function distanceToSegmentSq(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = 0;
  if (len2 > COLLISION_EPSILON) t = clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1);
  const cx = ax + abx * t - px;
  const cy = ay + aby * t - py;
  return cx * cx + cy * cy;
}
