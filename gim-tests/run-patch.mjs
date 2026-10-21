/**
 * Patch d'équilibrage + écran de fin de manche : `node gim-tests/run-patch.mjs`.
 */
import assert from 'node:assert/strict';
import { TICK_MS, BTN_ATTACK, BTN_SUPER, TEAM_A, TEAM_B, ROUND_PHASE_ENDED, ROUND_PHASE_PLAYING, ROUND_END_PAUSE_MS, SUPER_MAX } from '../public/gim/shared/constants.js';
import { BRAWLERS } from '../public/gim/shared/brawlers.js';
import { PROFS } from '../public/gim/shared/profs.js';
import { ARENA } from '../public/gim/shared/arena.js';
import { createWorld } from '../public/gim/shared/world.js';
import { createRng } from '../public/gim/shared/rng.js';
import { createInput, stepPlayerSelf, activatePlayer } from '../public/gim/shared/simulation.js';
import { ACTION_FIRED_MAIN } from '../public/gim/shared/constants.js';
import { parseClientText, makePick } from '../public/gim/shared/protocol.js';
import { Room, InputQueue } from '../public/gim/server/room.js';
import { rankPlayers } from '../public/gim/client/results.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✔ ${name}`); }
const by = (n) => BRAWLERS.find((b) => b.name === n);

console.log('\nPatch persos + fin de manche\n');

test('Vladimir : molotov toutes les 2 s', () => assert.equal(by('Vladimir').main.cooldownMs, 2000));
test('Mathéo : dégâts 800', () => assert.equal(by('Mathéo').main.damage, 800));
test('Mohammed : 5000 PV', () => assert.equal(by('Mohammed').hp, 5000));
test('Adam : 3000 PV', () => assert.equal(by('Adam').hp, 3000));
test('Adam : étourdit 2 s', () => assert.equal(by('Adam').main.stunMs, 2000));
test('Adam : pluie de billets 350', () => assert.equal(by('Adam').super.damage, 350));
test('Clément : cheveux 3,5 m', () => assert.equal(by('Clément').main.range, 3.5));
test('Breuer : 3500 PV', () => assert.equal(PROFS.find((p) => p.name === 'Breuer').hp, 3500));

test('Yann ne tire pas en étant invisible, retire après', () => {
  const world = createWorld(ARENA);
  const yann = activatePlayer(world, 0, TEAM_A, by('Yann').id, createRng(1));
  yann.superCharge = SUPER_MAX;
  const input = createInput();
  input.buttons = BTN_SUPER;
  stepPlayerSelf(yann, input, TICK_MS, ARENA);
  assert.ok(yann.invisMs > 0, 'invisible');
  input.buttons = BTN_ATTACK;
  let fired = 0;
  while (yann.invisMs > 0) fired |= stepPlayerSelf(yann, input, TICK_MS, ARENA) & ACTION_FIRED_MAIN;
  assert.equal(fired, 0, 'aucun tir pendant l’invisibilité');
  assert.ok(stepPlayerSelf(yann, input, TICK_MS, ARENA) & ACTION_FIRED_MAIN, 'tire dès la fin');
});

test('message « pick » validé', () => {
  assert.deepEqual(parseClientText(makePick(3)), { t: 'pick', brawler: 3 });
  assert.equal(parseClientText('{"t":"pick","brawler":42}'), null);
});

function fakeClient() {
  const c = { slot: -1, name: '', brawlerId: 0, ackSeq: 0, eventFrom: 0, queue: new InputQueue(), room: null, sent: [] };
  c.send = (d) => { if (typeof d === 'string') c.sent.push(JSON.parse(d)); };
  return c;
}

test('fin de manche : tableau K.O./morts envoyé à tous, changement de perso seulement pendant la pause', () => {
  const room = new Room('t', 5);
  const a = fakeClient(); const b = fakeClient();
  room.addClient(a, 'Alice', 0); room.addClient(b, 'Bob', 1);
  assert.equal(room.pickBrawler(a, 4), false, 'refusé en pleine manche');
  room.world.players[a.slot].kills = 3; room.world.players[a.slot].deaths = 1;
  room.world.players[b.slot].kills = 1; room.world.players[b.slot].deaths = 3;
  room.world.roundMs = TICK_MS;
  room.tick(0);
  assert.equal(room.world.roundPhase, ROUND_PHASE_ENDED);
  for (const c of [a, b]) {
    const res = c.sent.find((m) => m.t === 'results');
    assert.ok(res, 'résultats reçus');
    const alice = res.players.find((p) => p.name === 'Alice');
    assert.equal(alice.kills, 3); assert.equal(alice.deaths, 1);
  }
  assert.equal(room.pickBrawler(a, 4), true);
  for (let t = 0; t < ROUND_END_PAUSE_MS / TICK_MS + 2; t++) room.tick(0);
  assert.equal(room.world.roundPhase, ROUND_PHASE_PLAYING);
  const p = room.world.players[a.slot];
  assert.equal(p.brawlerId, 4, 'Mohammed à la nouvelle manche');
  assert.equal(p.hp, 5000);
  assert.equal(p.kills, 0);
});

test('podium : plus de K.O. d’abord, puis moins de morts', () => {
  const r = rankPlayers([
    { slot: 0, kills: 2, deaths: 5 }, { slot: 1, kills: 4, deaths: 2 }, { slot: 2, kills: 2, deaths: 1 },
  ]);
  assert.deepEqual(r.map((x) => x.slot), [1, 2, 0]);
});

console.log(`\n${passed} test(s) réussi(s).\n`);
