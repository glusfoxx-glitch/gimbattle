import { MAX_PLAYERS, MAX_BOTS, MAX_PROJECTILES, MAX_ZONES, EVENT_RING_SIZE, TEAM_A, TEAM_BOTS, TEAM_COUNT, BOT_REF_BASE, REF_NONE, ROUND_PHASE_PLAYING, ROUND_DURATION_MS, BOT_FIRST_SPAWN_MS, BOT_STATE, NAV_CELL_SIZE, NAV_INFLATE, NAV_UNREACHED, HALF, FLOAT_ZERO, MODE_TDM } from './constants.js';
import { Pool } from './pool.js'; import { circleBlocked } from './physics.js';

export function createPlayer(slot) { return { slot, ref: slot, active: false, team: TEAM_A, brawlerId: 0, x: FLOAT_ZERO, y: FLOAT_ZERO, radius: HALF, aimAngle: FLOAT_ZERO, hp: FLOAT_ZERO, maxHp: 1, dead: false, respawnMs: FLOAT_ZERO, shieldMs: FLOAT_ZERO, attackCdMs: FLOAT_ZERO, superCharge: FLOAT_ZERO, stunMs: FLOAT_ZERO, slowMs: FLOAT_ZERO, slowFactor: 1, speedBuffMs: FLOAT_ZERO, speedMul: 1, invisMs: FLOAT_ZERO, blindMs: FLOAT_ZERO, dashMs: FLOAT_ZERO, dashDirX: FLOAT_ZERO, dashDirY: FLOAT_ZERO, dashSpeed: FLOAT_ZERO, dashIsSuper: false, dashing: false, dashHitPlayers: 0, dashHitBots: 0, leapMs: FLOAT_ZERO, leapTotalMs: 1, leapFromX: FLOAT_ZERO, leapFromY: FLOAT_ZERO, leapToX: FLOAT_ZERO, leapToY: FLOAT_ZERO, leapIsSuper: false, kbVX: FLOAT_ZERO, kbVY: FLOAT_ZERO, outOfCombatMs: FLOAT_ZERO, kills: 0, deaths: 0, revealMs: FLOAT_ZERO, }; }
export function createBot(slot) { return { slot, ref: BOT_REF_BASE + slot, active: false, team: TEAM_BOTS, type: 0, x: FLOAT_ZERO, y: FLOAT_ZERO, radius: HALF, angle: FLOAT_ZERO, hp: FLOAT_ZERO, maxHp: 1, state: BOT_STATE.IDLE, stateMs: FLOAT_ZERO, cooldownMs: FLOAT_ZERO, targetRef: REF_NONE, retargetTicks: 0, stunMs: FLOAT_ZERO, slowMs: FLOAT_ZERO, slowFactor: 1, blindMs: FLOAT_ZERO, kbVX: FLOAT_ZERO, kbVY: FLOAT_ZERO, chargeDirX: FLOAT_ZERO, chargeDirY: FLOAT_ZERO, strikeX: FLOAT_ZERO, strikeY: FLOAT_ZERO, hitPlayers: 0, leapMs: FLOAT_ZERO, }; }
function createProjectile() { return { poolIndex: 0, activeIndex: -1, serial: 0, ownerRef: REF_NONE, team: TEAM_A, def: null, x: FLOAT_ZERO, y: FLOAT_ZERO, prevX: FLOAT_ZERO, prevY: FLOAT_ZERO, vx: FLOAT_ZERO, vy: FLOAT_ZERO, speed: FLOAT_ZERO, traveled: FLOAT_ZERO, maxDist: FLOAT_ZERO, radius: FLOAT_ZERO, visual: 0, angle: FLOAT_ZERO, isLob: false, lobMs: FLOAT_ZERO, lobTotalMs: 1, fromX: FLOAT_ZERO, fromY: FLOAT_ZERO, toX: FLOAT_ZERO, toY: FLOAT_ZERO, }; }
function createZone() { return { poolIndex: 0, activeIndex: -1, serial: 0, ownerRef: REF_NONE, team: TEAM_A, def: null, x: FLOAT_ZERO, y: FLOAT_ZERO, radius: FLOAT_ZERO, remainingMs: FLOAT_ZERO, totalMs: 1, tickAccMs: FLOAT_ZERO, visual: 0, followOwner: false, }; }
function createEvent() { return { id: -1, type: 0, a: REF_NONE, b: REF_NONE, c: 0, x: FLOAT_ZERO, y: FLOAT_ZERO, value: FLOAT_ZERO, angle: FLOAT_ZERO }; }

function createNavGrid(arena) {
  const cols = Math.ceil(arena.width / NAV_CELL_SIZE); const rows = Math.ceil(arena.height / NAV_CELL_SIZE); const blocked = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) { for (let col = 0; col < cols; col++) { const cx = (col + HALF) * NAV_CELL_SIZE; const cy = (row + HALF) * NAV_CELL_SIZE; blocked[row * cols + col] = circleBlocked(cx, cy, NAV_INFLATE, arena) ? 1 : 0; } }
  return { cols, rows, blocked, dist: new Int16Array(cols * rows).fill(NAV_UNREACHED), queue: new Int32Array(cols * rows) };
}

export function createWorld(arena) {
  const players = new Array(MAX_PLAYERS); for (let i = 0; i < MAX_PLAYERS; i++) players[i] = createPlayer(i);
  const bots = new Array(MAX_BOTS); for (let i = 0; i < MAX_BOTS; i++) bots[i] = createBot(i);
  const events = new Array(EVENT_RING_SIZE); for (let i = 0; i < EVENT_RING_SIZE; i++) events[i] = createEvent();
  return { arena, tick: 0, players, bots, projectiles: new Pool(MAX_PROJECTILES, createProjectile), zones: new Pool(MAX_ZONES, createZone), events, eventHead: 0, scores: new Int32Array(TEAM_COUNT), roundPhase: ROUND_PHASE_PLAYING, roundMs: ROUND_DURATION_MS, botSpawnMs: BOT_FIRST_SPAWN_MS, roundDurationMs: ROUND_DURATION_MS, nav: createNavGrid(arena), queryRefs: new Int32Array(MAX_PLAYERS + MAX_BOTS), queryCount: 0, gameMode: MODE_TDM, stormRadius: 1000, stormX: 0, stormY: 0 };
}
export function setWorldArena(world, arena) { if (world.arena === arena) return; world.arena = arena; world.nav = createNavGrid(arena); }
export function emitEvent(world, type, a, b, c, x, y, value, angle) { const e = world.events[world.eventHead % EVENT_RING_SIZE]; e.id = world.eventHead++; e.type = type; e.a = a; e.b = b; e.c = c; e.x = x; e.y = y; e.value = value; e.angle = angle; }
export function getEntity(world, ref) { if (ref < BOT_REF_BASE) return ref < MAX_PLAYERS ? world.players[ref] : null; const slot = ref - BOT_REF_BASE; return slot < MAX_BOTS ? world.bots[slot] : null; }
export function countActivePlayers(world) { let n = 0; for (let i = 0; i < MAX_PLAYERS; i++) if (world.players[i].active) n++; return n; }
export function countTeam(world, team) { let n = 0; for (let i = 0; i < MAX_PLAYERS; i++) if (world.players[i].active && world.players[i].team === team) n++; return n; }
