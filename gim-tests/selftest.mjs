/**
 * Auto-test sans navigateur : `npm test`.
 * Vérifie la simulation (invariants, déterminisme), la validation des messages et la réconciliation
 * (le client qui rejoue ses inputs retombe exactement sur l'état du serveur).
 */
import assert from 'node:assert/strict';
import {
  TICK_MS, MAX_PLAYERS, BTN_ATTACK, BTN_SUPER, BTN_AUTO_AIM, TEAM_A, TEAM_B, MSG, INPUT_MESSAGE_BYTES,
  SNAPSHOT_BUFFER_BYTES, MAX_BINARY_MESSAGE_BYTES, MAX_PROJECTILES, MAX_ZONES, ROUND_DURATION_MS,
} from '../public/gim/shared/constants.js';
import { ARENA } from '../public/gim/shared/arena.js';
import { BRAWLERS, BRAWLER_COUNT } from '../public/gim/shared/brawlers.js';
import { createWorld, createPlayer } from '../public/gim/shared/world.js';
import { createRng, nextRandom } from '../public/gim/shared/rng.js';
import {
  createInput, stepPlayerSelf, applyPlayerActions, stepWorld, activatePlayer, resolveAutoAim, copyInput,
} from '../public/gim/shared/simulation.js';
import {
  ByteWriter, ByteReader, encodeInput, decodeInput, encodeSnapshot, decodeSnapshot, createSnapshot, parseClientText,
} from '../public/gim/shared/protocol.js';

let passed = 0;
/** @param {string} name @param {() => void} fn */
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✔ ${name}`);
}

/**
 * Partie automatique : joueurs aux inputs pseudo-aléatoires (RNG de test séparé).
 * @param {number} seed @param {number} ticks
 */
function runMatch(seed, ticks) {
  const world = createWorld(ARENA);
  const rng = createRng(seed);
  const inputRng = createRng(seed + 1);
  const players = [];
  for (let i = 0; i < 8; i++) players.push(activatePlayer(world, i, i % 2 === 0 ? TEAM_A : TEAM_B, i % BRAWLER_COUNT, rng));
  const input = createInput();
  const stats = { hits: 0, kos: 0, botsSeen: 0, maxProjectiles: 0, maxZones: 0 };
  for (let t = 0; t < ticks; t++) {
    for (const p of players) {
      input.seq = t + 1;
      const a = nextRandom(inputRng) * Math.PI * 2;
      input.moveX = Math.cos(a) * 0.9;
      input.moveY = Math.sin(a) * 0.9;
      input.aimAngle = nextRandom(inputRng) * Math.PI * 2;
      input.aimDist = nextRandom(inputRng);
      input.buttons = BTN_ATTACK | (nextRandom(inputRng) < 0.05 ? BTN_SUPER : 0) | (nextRandom(inputRng) < 0.3 ? BTN_AUTO_AIM : 0);
      resolveAutoAim(world, p, input);
      applyPlayerActions(world, p, stepPlayerSelf(p, input, TICK_MS, ARENA), input);
    }
    const before = world.eventHead;
    stepWorld(world, TICK_MS, rng);
    for (let id = Math.max(0, before - 256); id < world.eventHead; id++) {
      const e = world.events[id % 256];
      if (e.id < before) continue;
      if (e.type === 1) stats.hits++;
      if (e.type === 3) stats.kos++;
    }
    stats.maxProjectiles = Math.max(stats.maxProjectiles, world.projectiles.activeCount);
    stats.maxZones = Math.max(stats.maxZones, world.zones.activeCount);
    for (const b of world.bots) if (b.active) stats.botsSeen++;
    for (const p of players) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'position finie');
      assert.ok(p.x >= 0 && p.x <= ARENA.width && p.y >= 0 && p.y <= ARENA.height, 'joueur dans l’arène');
      assert.ok(p.hp <= p.maxHp, 'PV ≤ max');
    }
    for (const b of world.bots) {
      if (!b.active) continue;
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), 'prof position finie');
    }
  }
  return { world, stats };
}

/** @param {import('../public/gim/shared/world.js').World} world */
function hashWorld(world) {
  let h = 0;
  const mix = (v) => { h = (Math.imul(h ^ Math.round(v * 1000), 2654435761) >>> 0); };
  for (const p of world.players) { mix(p.x); mix(p.y); mix(p.hp); }
  for (const b of world.bots) { mix(b.active ? 1 : 0); mix(b.x); mix(b.y); mix(b.hp); }
  mix(world.scores[0]); mix(world.scores[1]); mix(world.eventHead);
  return h;
}

console.log('\nGIM BATTLE — auto-tests\n');

test('données : 9 élèves complets', () => {
  assert.equal(BRAWLER_COUNT, 9);
  for (const b of BRAWLERS) {
    assert.ok(b.hp > 0 && b.speed > 0 && b.radius > 0, b.name);
    assert.ok(b.main.name.length > 0 && b.super.name.length > 0, b.name);
    assert.ok(Object.isFrozen(b) && Object.isFrozen(b.main), 'données gelées');
  }
});

test('partie de 2 minutes : invariants, combats, profs', () => {
  const { stats } = runMatch(42, 3600);
  assert.ok(stats.hits > 50, `touches : ${stats.hits}`);
  assert.ok(stats.kos > 0, `K.O. : ${stats.kos}`);
  assert.ok(stats.botsSeen > 0, 'des profs sont apparus');
  assert.ok(stats.maxProjectiles <= MAX_PROJECTILES && stats.maxZones <= MAX_ZONES, 'pools bornés');
  console.log(`      (${stats.hits} touches, ${stats.kos} K.O., max ${stats.maxProjectiles} projectiles)`);
});

test('déterminisme : même graine → même partie', () => {
  assert.equal(hashWorld(runMatch(7, 900).world), hashWorld(runMatch(7, 900).world));
});

test('fin de manche puis nouvelle manche', () => {
  const { world } = runMatch(3, Math.ceil(ROUND_DURATION_MS / TICK_MS) + 10);
  assert.equal(world.roundPhase, 1, 'manche terminée');
});

test('validation input : vecteur renormalisé, angle NaN rejeté, boutons inconnus rejetés', () => {
  const w = new ByteWriter(MAX_BINARY_MESSAGE_BYTES);
  const r = new ByteReader(MAX_BINARY_MESSAGE_BYTES);
  const input = createInput();
  const out = createInput();
  input.seq = 5; input.moveX = 1; input.moveY = 1; input.aimAngle = 1.2; input.buttons = BTN_ATTACK;
  encodeInput(w, input);
  assert.equal(w.offset, INPUT_MESSAGE_BYTES);
  r.load(new Uint8Array(w.buffer, 0, w.offset));
  assert.equal(decodeInput(r, out), null);
  assert.ok(Math.hypot(out.moveX, out.moveY) <= 1 + 1e-9, 'longueur ≤ 1');
  input.aimAngle = NaN;
  encodeInput(w, input);
  r.load(new Uint8Array(w.buffer, 0, w.offset));
  assert.notEqual(decodeInput(r, out), null, 'NaN rejeté');
  input.aimAngle = 0;
  encodeInput(w, input);
  w.view.setUint8(INPUT_MESSAGE_BYTES - 1, 0xff);
  r.load(new Uint8Array(w.buffer, 0, w.offset));
  assert.notEqual(decodeInput(r, out), null, 'boutons rejetés');
  r.load(new Uint8Array([MSG.INPUT, 1, 2]));
  assert.notEqual(decodeInput(r, out), null, 'message tronqué rejeté');
  assert.equal(parseClientText('{"t":"join","brawler":99}'), null);
  assert.equal(parseClientText('pas du json'), null);
  const join = /** @type {import('../public/gim/shared/protocol.js').JoinRequest} */ (parseClientText('{"t":"join","brawler":2,"name":"<b>Zoé\\u0000</b>","room":"Salle 12!"}'));
  assert.equal(join.name, 'bZoé/b');
  assert.equal(join.room, 'salle12');
});

test('réconciliation : rejouer les inputs en attente = état serveur', () => {
  const world = createWorld(ARENA);
  const rng = createRng(11);
  const server = activatePlayer(world, 0, TEAM_A, 5, rng); // Adam : dash, le cas le plus délicat
  activatePlayer(world, 1, TEAM_B, 0, rng);
  const inputRng = createRng(99);
  /** @type {import('../public/gim/shared/simulation.js').PlayerInput[]} */
  const history = [];
  const w = new ByteWriter(SNAPSHOT_BUFFER_BYTES);
  const r = new ByteReader(SNAPSHOT_BUFFER_BYTES);
  const snap = createSnapshot();
  const predicted = createPlayer(0);
  for (let t = 1; t <= 300; t++) {
    const input = createInput();
    input.seq = t;
    input.moveX = Math.cos(t * 0.05); input.moveY = Math.sin(t * 0.07) * 0.6;
    input.aimAngle = nextRandom(inputRng) * 6.28; input.aimDist = 0.5;
    input.buttons = t % 17 === 0 ? BTN_ATTACK : 0;
    history.push(input);
    applyPlayerActions(world, server, stepPlayerSelf(server, input, TICK_MS, ARENA), input);
    stepWorld(world, TICK_MS, rng);
  }
  // Snapshot reçu après l'input 300 ; le client a déjà envoyé (et prédit) les 30 suivants.
  const ackSeq = 300;
  encodeSnapshot(w, world, { viewer: server, ackSeq, serverTime: 0, eventFrom: 0 });
  r.load(new Uint8Array(w.buffer, 0, w.offset));
  assert.ok(decodeSnapshot(r, snap), 'snapshot décodé');
  const s = snap.self;
  Object.assign(predicted, { active: true, brawlerId: s.brawlerId, team: s.team, radius: BRAWLERS[s.brawlerId].radius,
    x: s.x, y: s.y, kbVX: s.kbVX, kbVY: s.kbVY, hp: s.hp, dead: s.dead, attackCdMs: s.attackCdMs, superCharge: s.superCharge,
    stunMs: s.stunMs, slowMs: s.slowMs, slowFactor: s.slowFactor, speedBuffMs: s.speedBuffMs, speedMul: s.speedMul,
    invisMs: s.invisMs, blindMs: s.blindMs, shieldMs: s.shieldMs, dashMs: s.dashMs, dashDirX: s.dashDirX, dashDirY: s.dashDirY,
    dashSpeed: s.dashSpeed, leapMs: s.leapMs, leapTotalMs: s.leapTotalMs, leapFromX: s.leapFromX, leapFromY: s.leapFromY,
    leapToX: s.leapToX, leapToY: s.leapToY });
  const pending = [];
  for (let t = 301; t <= 330; t++) {
    const input = createInput();
    copyInput(input, history[(t - 1) % history.length]);
    input.seq = t;
    pending.push(input);
    applyPlayerActions(world, server, stepPlayerSelf(server, input, TICK_MS, ARENA), input);
    stepWorld(world, TICK_MS, rng);
  }
  for (const input of pending) stepPlayerSelf(predicted, input, TICK_MS, ARENA);
  const error = Math.hypot(predicted.x - server.x, predicted.y - server.y);
  assert.ok(error < 0.02, `écart de prédiction ${error.toFixed(4)} m`);
  console.log(`      (écart après 30 inputs rejoués : ${error.toExponential(2)} m)`);
});

test('emplacements joueurs : capacité', () => {
  assert.ok(MAX_PLAYERS >= 2);
});

console.log(`\n${passed} test(s) réussi(s).\n`);
