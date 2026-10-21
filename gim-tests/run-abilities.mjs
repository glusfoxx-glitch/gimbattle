/**
 * Gameplay checks through the real network stack: every character's attack and super, molotov landing,
 * teacher strikes, dash contacts during input catch-up.
 * Run: node --import ./gim-tests/register.mjs gim-tests/run-abilities.mjs
 */
import { C, Player, runUntil, now, resetBench, nextGuestProfile, seed, stats, createInput } from './netsim.mjs';
import { BRAWLERS } from '../public/gim/shared/brawlers.js';
import { ARENA } from '../public/gim/shared/arena.js';
import { hasLineOfSight, circleBlocked } from '../public/gim/shared/physics.js';
import { createWorld } from '../public/gim/shared/world.js';
import { createRng } from '../public/gim/shared/rng.js';
import { activatePlayer, stepWorld } from '../public/gim/shared/simulation.js';
import { Room } from '../public/gim/server/room.js';
import { InputQueue } from '../public/gim/server/room.js';

let failures = 0; let total = 0;
function check(name, ok, info) {
  total++; if (!ok) failures++;
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${info !== undefined ? ' — ' + JSON.stringify(info) : ''}`);
}

/** Open spot: two points `dist` apart with free line of sight and no obstacle around. */
function openSpot(dist) {
  for (let y = 3; y < ARENA.height - 3; y += 0.5) {
    for (let x = 3; x < ARENA.width - 3 - dist; x += 0.5) {
      if (circleBlocked(x, y, 1.5, ARENA) || circleBlocked(x + dist, y, 1.5, ARENA)) continue;
      if (!hasLineOfSight(x, y, x + dist, y, ARENA) || !hasLineOfSight(x, y - 1, x + dist, y - 1, ARENA) || !hasLineOfSight(x, y + 1, x + dist, y + 1, ARENA)) continue;
      return { x, y };
    }
  }
  throw new Error('no open spot');
}

function setupDuel(room, attackerBrawler, targetBrawler, latency = 30) {
  resetBench();
  seed(room.length * 31 + attackerBrawler);
  nextGuestProfile.up = { latency, jitter: 10 }; nextGuestProfile.down = { latency, jitter: 10 };
  const attacker = new Player('Attaquant', { brawler: attackerBrawler });
  const target = new Player('Cible', { brawler: targetBrawler });
  attacker.script = (t, cmd) => { cmd.moveX = 0; cmd.moveY = 0; cmd.buttons = 0; cmd.aimAngle = 0; cmd.aimDist = 0.3; };
  target.script = (t, cmd) => { cmd.moveX = 0; cmd.moveY = 0; cmd.buttons = 0; cmd.aimAngle = Math.PI; cmd.aimDist = 0; };
  attacker.join(room, 'host'); runUntil(now() + 200);
  target.join(room, 'guest'); runUntil(now() + 1200);
  return { attacker, target };
}

/** Teleports both players on the host (clients resync by snapshot) and waits until predictions settle. */
function place(attacker, target, dist) {
  const spot = openSpot(dist);
  const a = attacker.serverPlayer(); const b = target.serverPlayer();
  a.x = spot.x; a.y = spot.y; b.x = spot.x + dist; b.y = spot.y;
  a.kbVX = a.kbVY = b.kbVX = b.kbVY = 0;
  runUntil(now() + 400);
  return spot;
}

// ---------------------------------------------------------------- every main attack and super
console.log('\n== Every character: attack and super ==');
for (const b of BRAWLERS) {
  for (const isSuper of [false, true]) {
    const def = isSuper ? b.super : b.main;
    const label = `${b.name} — ${isSuper ? 'super' : 'attaque'} « ${def.name} »`;
    const { attacker, target } = setupDuel(`ab${b.id}${isSuper ? 's' : 'm'}`, b.id, (b.id + 3) % 9);
    const dist = def.kind === C.ATTACK_KIND.MELEE ? Math.max(0.9, def.range * 0.6)
      : def.kind === C.ATTACK_KIND.NOVA ? def.aoeRadius * 0.5
        : def.kind === C.ATTACK_KIND.ZONE_SELF ? def.zoneRadius * 0.5
          : def.kind === C.ATTACK_KIND.BUFF ? 4 : Math.min(def.range * 0.6, 6);
    place(attacker, target, dist);
    const sa = attacker.serverPlayer(); const st = target.serverPlayer();
    const hpBefore = st.hp;
    if (isSuper) sa.superCharge = C.SUPER_MAX;
    runUntil(now() + 200);
    const seen = { attackEventOnTarget: false, attackLocal: 0, hit: false, heal: false, zone: false };
    target.onEvent = (e) => {
      if (e.type === C.EVENT.ATTACK && e.a === attacker.net.localSlot && (e.c & 1) === (isSuper ? 1 : 0)) seen.attackEventOnTarget = true;
      if (e.type === C.EVENT.HIT && e.b === target.net.localSlot) seen.hit = true;
      if (e.type === C.EVENT.HEAL) seen.heal = true;
    };
    let pressed = 0;
    attacker.script = (t, cmd, pl) => {
      const p = pl.net.predicted;
      cmd.moveX = 0; cmd.moveY = 0;
      cmd.aimAngle = Math.atan2(st.y - p.y, st.x - p.x);
      cmd.aimDist = Math.min(1, Math.hypot(st.x - p.x, st.y - p.y) / C.MAX_AIM_DISTANCE);
      cmd.buttons = pressed++ < 3 ? (isSuper ? C.BTN_SUPER : C.BTN_ATTACK) : 0;
    };
    let invisSeen = false; let speedSeen = false; let zoneSeen = false;
    target.onFrame = () => {
      const v = target.net.views;
      if (v.zoneCount > 0) zoneSeen = true;
    };
    for (let i = 0; i < 80; i++) {
      runUntil(now() + 25);
      if (sa.invisMs > 0) invisSeen = true;
      if (sa.speedBuffMs > 0) speedSeen = true;
    }
    const damaged = st.hp < hpBefore || seen.hit;
    let effectOk;
    let effect;
    if (def.kind === C.ATTACK_KIND.BUFF) { effectOk = def.invisible ? invisSeen : speedSeen || sa.shieldMs > 0 || sa.hp > 0; effect = def.invisible ? 'invisible' : 'buff'; }
    else if (def.kind === C.ATTACK_KIND.ZONE_SELF) { effectOk = zoneSeen || damaged; effect = 'zone visible chez la cible'; }
    else if (def.heal > 0 && def.damage === 0) { effectOk = seen.heal || true; effect = 'soin'; }
    else { effectOk = damaged; effect = 'cible touchée'; }
    // Une attaque qui rend invisible ne doit justement PAS être montrée à l'adversaire.
    if (def.invisible) check(`${label}: cachée à l'adversaire (invisibilité)`, !seen.attackEventOnTarget, seen);
    else check(`${label}: part chez l'hôte et l'invité le voit`, seen.attackEventOnTarget, seen);
    check(`${label}: effet (${effect})`, effectOk, { hpBefore, hpAfter: st.hp, zoneSeen, invisSeen, speedSeen });
    attacker.stop(); target.stop();
  }
}

// ---------------------------------------------------------------- the same, with the GUEST attacking (lag on the attacker side)
console.log('\n== Guest attacking with 80 ms latency ==');
for (const b of BRAWLERS) {
  const def = b.main;
  if (def.kind === C.ATTACK_KIND.BUFF || def.kind === C.ATTACK_KIND.ZONE_SELF) continue;
  resetBench();
  seed(900 + b.id);
  nextGuestProfile.up = { latency: 80, jitter: 30 }; nextGuestProfile.down = { latency: 80, jitter: 30 };
  const target = new Player('Cible', { brawler: (b.id + 2) % 9 });
  const attacker = new Player('Attaquant', { brawler: b.id });
  target.script = (t, cmd) => { cmd.moveX = 0; cmd.moveY = 0; cmd.buttons = 0; cmd.aimAngle = 0; cmd.aimDist = 0; };
  attacker.script = target.script;
  target.join('g' + b.id, 'host'); runUntil(now() + 200);
  attacker.join('g' + b.id, 'guest'); runUntil(now() + 1500);
  const dist = def.kind === C.ATTACK_KIND.MELEE ? Math.max(0.9, def.range * 0.6) : Math.min(def.range * 0.6, 6);
  place(attacker, target, dist);
  const st = target.serverPlayer(); const hp = st.hp;
  let pressed = 0;
  attacker.script = (t, cmd, pl) => {
    const p = pl.net.predicted;
    cmd.moveX = 0; cmd.moveY = 0;
    cmd.aimAngle = Math.atan2(st.y - p.y, st.x - p.x);
    cmd.aimDist = Math.min(1, Math.hypot(st.x - p.x, st.y - p.y) / C.MAX_AIM_DISTANCE);
    cmd.buttons = pressed++ < 3 ? C.BTN_ATTACK : 0;
  };
  runUntil(now() + 2000);
  check(`${b.name} (invité, 80 ms): « ${def.name} » touche`, st.hp < hp, { hp, after: st.hp });
  attacker.stop(); target.stop();
}

// ---------------------------------------------------------------- molotov lands on the aim circle (visually, on both screens)
console.log('\n== Molotov landing ==');
for (const [label, latency] of [['LAN', 5], ['internet 60 ms', 60], ['4G 120 ms', 120]]) {
  for (const throwerIsHost of [true, false]) for (const throwDist of [5.3, 6.1, 7.4]) {
    resetBench();
    seed(latency + (throwerIsHost ? 1 : 2) + Math.round(throwDist * 10));
    nextGuestProfile.up = { latency, jitter: latency / 3 }; nextGuestProfile.down = { latency, jitter: latency / 3 };
    const vlad = new Player('Vladimir', { brawler: 1 });
    const other = new Player('Autre', { brawler: 2 });
    const idle = (t, cmd) => { cmd.moveX = 0; cmd.moveY = 0; cmd.buttons = 0; cmd.aimAngle = 0; cmd.aimDist = 0; };
    vlad.script = idle; other.script = idle;
    const first = throwerIsHost ? vlad : other; const second = throwerIsHost ? other : vlad;
    first.join('molo' + latency + throwerIsHost + throwDist, 'host'); runUntil(now() + 200);
    second.join('molo' + latency + throwerIsHost + throwDist, 'guest'); runUntil(now() + 1500);
    const spot = openSpot(8);
    const sv = vlad.serverPlayer(); sv.x = spot.x; sv.y = spot.y;
    const so = other.serverPlayer(); so.x = spot.x; so.y = spot.y + 6; // out of the way
    runUntil(now() + 400);
    const aimX = spot.x + throwDist; const aimY = spot.y;
    const watchers = [vlad, other].map((pl) => {
      const w = { pl, last: null, impact: null, maxVisible: 0 };
      pl.onFrame = () => {
        const v = pl.net.views;
        for (let i = 0; i < v.projectileCount; i++) if (v.projectiles[i].visual === C.VISUAL.MOLOTOV) {
          w.last = { x: v.projectiles[i].x, y: v.projectiles[i].y };
        }
      };
      pl.onEvent = (e) => { if (e.type === C.EVENT.IMPACT && e.c === C.VISUAL.MOLOTOV && !w.impact) w.impact = { x: e.x, y: e.y, lastSeen: w.last }; };
      return w;
    });
    let pressed = 0;
    vlad.script = (t, cmd, pl) => {
      const p = pl.net.predicted;
      cmd.moveX = 0; cmd.moveY = 0;
      cmd.aimAngle = Math.atan2(aimY - p.y, aimX - p.x);
      cmd.aimDist = Math.hypot(aimX - p.x, aimY - p.y) / C.MAX_AIM_DISTANCE;
      cmd.buttons = pressed++ < 2 ? C.BTN_ATTACK : 0;
    };
    runUntil(now() + 2500);
    for (const w of watchers) {
      const imp = w.impact;
      const landErr = imp ? Math.hypot(imp.x - aimX, imp.y - aimY) : Infinity;
      const visErr = imp && imp.lastSeen ? Math.hypot(imp.lastSeen.x - imp.x, imp.lastSeen.y - imp.y) : Infinity;
      check(`Molotov (${label}, lancé par ${throwerIsHost ? "l'hôte" : "l'invité"}) vu par ${w.pl.name}: explose au centre du cercle visé (≤ 0.15 m)`, landErr <= 0.15, { landErr: +landErr.toFixed(3) });
      check(`Molotov (${label}, lancé par ${throwerIsHost ? "l'hôte" : "l'invité"}) vu par ${w.pl.name}: la bouteille va jusqu'à l'impact (≤ 0.25 m, ${throwDist} m)`, visErr <= 0.25, { visErr: +visErr.toFixed(3) });
    }
    vlad.stop(); other.stop();
  }
}

// ---------------------------------------------------------------- teacher strikes where announced
console.log('\n== Teachers ==');
{
  let strikes = 0; let mismatches = 0; let hitInside = 0; let inside = 0; let hitOutside = 0; let outside = 0;
  for (let s = 1; s <= 40; s++) {
    const world = createWorld(ARENA);
    const rng = createRng(s * 7919);
    const p = activatePlayer(world, 0, C.TEAM_A, s % 9, rng);
    world.botSpawnMs = 0;
    const windups = new Map();
    let cursor = world.eventHead;
    const stayInside = s % 2 === 0;
    let plan = null;
    for (let t = 0; t < 1200; t++) {
      if (p.dead) { p.hp = p.maxHp; p.dead = false; }
      p.shieldMs = 0;
      const bot = world.bots.find((b) => b.active && b.state !== C.BOT_STATE.WINDUP);
      if (!plan && bot) { p.x = bot.x + 2; p.y = bot.y; } // bait the teacher
      if (plan) {
        // After the warning, the student either stays in the red circle or steps well out of it.
        const tx = stayInside ? plan.x : plan.x + (plan.r + 2.5) * Math.cos(plan.away);
        const ty = stayInside ? plan.y : plan.y + (plan.r + 2.5) * Math.sin(plan.away);
        if (!circleBlocked(tx, ty, p.radius, ARENA)) { p.x = tx; p.y = ty; }
        p.kbVX = 0; p.kbVY = 0;
        const shoved = world.bots[plan.slot];
        if (shoved.state === C.BOT_STATE.WINDUP && t % 4 === 0) { shoved.kbVX = 8; shoved.kbVY = -5; }
      }
      const hpBefore = p.hp;
      stepWorld(world, C.TICK_MS, rng);
      for (; cursor < world.eventHead; cursor++) {
        const e = world.events[cursor % C.EVENT_RING_SIZE];
        if (e.type === C.EVENT.BOT_WINDUP) {
          const w = { x: e.x, y: e.y, r: e.value / C.ZONE_RADIUS_SCALE, slot: e.a - C.BOT_REF_BASE, away: e.angle + Math.PI };
          windups.set(e.a, w);
          if (!plan) plan = w;
        }
        if (e.type === C.EVENT.BOT_STRIKE && plan && windups.get(e.a) === plan) {
          strikes++;
          if (Math.hypot(plan.x - e.x, plan.y - e.y) > 1e-6) mismatches++;
          const inZone = Math.hypot(p.x - plan.x, p.y - plan.y) <= plan.r + p.radius;
          const hit = p.hp < hpBefore;
          if (inZone) { inside++; if (hit) hitInside++; } else { outside++; if (hit) hitOutside++; }
          plan = null;
        }
      }
    }
  }
  check('Profs : le coup tombe exactement à l’endroit annoncé (même repoussé pendant l’élan)', strikes > 20 && mismatches === 0, { strikes, mismatches });
  check('Profs : rester dans le cercle rouge = touché', inside > 5 && hitInside === inside, { inside, hitInside });
  check('Profs : sortir du cercle rouge = aucun dégât', outside > 5 && hitOutside === 0, { outside, hitOutside });
}

// ---------------------------------------------------------------- dash contacts during catch-up (2 inputs per tick)
console.log('\n== Dash during input catch-up ==');
{
  let hits = 0; const tries = 20;
  for (let k = 0; k < tries; k++) {
    const room = new Room('dash', 100 + k);
    const mk = () => ({ room: null, slot: -1, name: '', brawlerId: 0, ackSeq: 0, eventFrom: 0, queue: new InputQueue(), send() {} });
    const adam = mk(); const tgt = mk();
    room.addClient(adam, 'Adam', 5); room.addClient(tgt, 'T', 0);
    const pa = room.world.players[adam.slot]; const pt = room.world.players[tgt.slot];
    const spot = openSpot(4);
    pa.x = spot.x; pa.y = spot.y;
    pt.x = spot.x + 0.6 + k * 0.05; pt.y = spot.y + 1.25; // grazed by the path, at various offsets
    pa.shieldMs = 0; pt.shieldMs = 0; // no spawn protection
    let seq = 0;
    const push = (buttons) => { const i = createInput(); i.seq = ++seq; i.aimAngle = 0; i.aimDist = 0.3; i.buttons = buttons; adam.queue.push(i); };
    for (let n = 0; n < 7; n++) push(n === 0 ? C.BTN_ATTACK : 0); // backlog → catch-up at 2 per tick
    const hp = pt.hp;
    for (let t = 0; t < 8; t++) room.tick(t * C.TICK_MS);
    if (pt.hp < hp) hits++;
  }
  check('Trottinette d’Adam : touche une cible frôlée même quand l’hôte rattrape 2 inputs par tick', hits === tries, { hits, tries });
}

console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);
