import { ARENA_WIDTH, ARENA_HEIGHT, OBSTACLE_RECT, OBSTACLE_CIRCLE, OBSTACLE_LOOK, TABLE_HEIGHT, LOCKER_HEIGHT, PILLAR_HEIGHT, DESK_HEIGHT, SHELF_HEIGHT, HALF } from './constants.js';

function rect(look, x, y, w, h, height) { return Object.freeze({ kind: OBSTACLE_RECT, look, cx: x + w * HALF, cy: y + h * HALF, halfW: w * HALF, halfH: h * HALF, r: 0, minX: x, minY: y, maxX: x + w, maxY: y + h, height }); }
function circle(look, cx, cy, r, height) { return Object.freeze({ kind: OBSTACLE_CIRCLE, look, cx, cy, halfW: r, halfH: r, r, minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r, height }); }
function point(x, y) { return Object.freeze({ x, y }); }
function hideout(x, y, w, h) { return Object.freeze({ minX: x, minY: y, maxX: x + w, maxY: y + h }); }

const T = OBSTACLE_LOOK.TABLE; const L = OBSTACLE_LOOK.LOCKER; const P = OBSTACLE_LOOK.PILLAR; const D = OBSTACLE_LOOK.DESK; const S = OBSTACLE_LOOK.SHELF;

export const ARENA = Object.freeze({
  width: ARENA_WIDTH, height: ARENA_HEIGHT,
  obstacles: Object.freeze([
    circle(P, 14, 8, 0.7, PILLAR_HEIGHT), circle(P, 26, 8, 0.7, PILLAR_HEIGHT), circle(P, 14, 18, 0.7, PILLAR_HEIGHT), circle(P, 26, 18, 0.7, PILLAR_HEIGHT),
    rect(T, 18.4, 9.4, 3.2, 1.4, TABLE_HEIGHT), rect(T, 18.4, 15.2, 3.2, 1.4, TABLE_HEIGHT), rect(T, 7.6, 5, 3.2, 1.4, TABLE_HEIGHT), rect(T, 7.6, 19.6, 3.2, 1.4, TABLE_HEIGHT),
    rect(T, 29.2, 5, 3.2, 1.4, TABLE_HEIGHT), rect(T, 29.2, 19.6, 3.2, 1.4, TABLE_HEIGHT), rect(D, 11.4, 11.4, 1.4, 3.2, DESK_HEIGHT), rect(D, 27.2, 11.4, 1.4, 3.2, DESK_HEIGHT),
    rect(L, 5, 0, 0.9, 3.6, LOCKER_HEIGHT), rect(L, 34.1, 0, 0.9, 3.6, LOCKER_HEIGHT), rect(L, 5, 22.4, 0.9, 3.6, LOCKER_HEIGHT), rect(L, 34.1, 22.4, 0.9, 3.6, LOCKER_HEIGHT),
    rect(L, 19.4, 2.6, 1.2, 3.2, LOCKER_HEIGHT), rect(L, 19.4, 20.2, 1.2, 3.2, LOCKER_HEIGHT),
  ]),
  teamSpawns: Object.freeze([ Object.freeze([point(2.2, 9), point(2.2, 13), point(2.2, 17)]), Object.freeze([point(37.8, 9), point(37.8, 13), point(37.8, 17)]) ]),
  botSpawns: Object.freeze([point(12, 1), point(28, 1), point(12, 25), point(28, 25)]), hideouts: Object.freeze([]), id: 0,
});

export const ARENA_CDI = Object.freeze({
  width: ARENA_WIDTH, height: ARENA_HEIGHT,
  obstacles: Object.freeze([
    rect(S, 9, 3, 1, 5.5, SHELF_HEIGHT), rect(S, 30, 3, 1, 5.5, SHELF_HEIGHT), rect(S, 9, 17.5, 1, 5.5, SHELF_HEIGHT), rect(S, 30, 17.5, 1, 5.5, SHELF_HEIGHT),
    rect(S, 14.5, 6, 4, 1, SHELF_HEIGHT), rect(S, 21.5, 6, 4, 1, SHELF_HEIGHT), rect(S, 14.5, 19, 4, 1, SHELF_HEIGHT), rect(S, 21.5, 19, 4, 1, SHELF_HEIGHT),
    rect(T, 18.2, 11.8, 3.6, 2.4, TABLE_HEIGHT), rect(D, 5.5, 11.8, 1.4, 2.4, DESK_HEIGHT), rect(D, 33.1, 11.8, 1.4, 2.4, DESK_HEIGHT),
    circle(P, 13, 13, 0.6, PILLAR_HEIGHT), circle(P, 27, 13, 0.6, PILLAR_HEIGHT),
  ]),
  teamSpawns: Object.freeze([ Object.freeze([point(2.2, 9), point(2.2, 13), point(2.2, 17)]), Object.freeze([point(37.8, 9), point(37.8, 13), point(37.8, 17)]) ]),
  botSpawns: Object.freeze([point(6, 1), point(34, 1), point(6, 25), point(34, 25)]),
  hideouts: Object.freeze([ hideout(12, 1.2, 5, 3), hideout(23, 1.2, 5, 3), hideout(12, 21.8, 5, 3), hideout(23, 21.8, 5, 3), hideout(12.5, 8.5, 3, 2.5), hideout(24.5, 8.5, 3, 2.5), hideout(12.5, 15, 3, 2.5), hideout(24.5, 15, 3, 2.5) ]), id: 1,
});

export const ARENA_BR = Object.freeze({
  width: 80, height: 52,
  obstacles: Object.freeze([
    rect(L, 30, 20, 4, 12, LOCKER_HEIGHT), rect(L, 46, 20, 4, 12, LOCKER_HEIGHT), rect(T, 36, 24, 8, 4, TABLE_HEIGHT),
    circle(P, 20, 15, 1.5, PILLAR_HEIGHT), circle(P, 60, 15, 1.5, PILLAR_HEIGHT), circle(P, 20, 37, 1.5, PILLAR_HEIGHT), circle(P, 60, 37, 1.5, PILLAR_HEIGHT),
    rect(D, 15, 24, 2, 4, DESK_HEIGHT), rect(D, 63, 24, 2, 4, DESK_HEIGHT), rect(S, 38, 10, 4, 1.5, SHELF_HEIGHT), rect(S, 38, 40, 4, 1.5, SHELF_HEIGHT)
  ]),
  teamSpawns: Object.freeze([ Object.freeze(Array.from({length: 32}, (_, i) => point(40 + Math.cos((i / 32) * Math.PI * 2) * 32, 26 + Math.sin((i / 32) * Math.PI * 2) * 20))), Object.freeze([]) ]),
  botSpawns: Object.freeze([]),
  hideouts: Object.freeze([ hideout(10, 10, 8, 6), hideout(62, 10, 8, 6), hideout(10, 36, 8, 6), hideout(62, 36, 8, 6), hideout(36, 14, 8, 4), hideout(36, 34, 8, 4), hideout(24, 24, 4, 4), hideout(52, 24, 4, 4) ]), id: 2,
});

export const MAPS = Object.freeze([ARENA, ARENA_CDI, ARENA_BR]);
export function inHideout(arena, x, y) { const list = arena.hideouts; for (let i = 0; i < list.length; i++) { const h = list[i]; if (x >= h.minX && x <= h.maxX && y >= h.minY && y <= h.maxY) return true; } return false; }
