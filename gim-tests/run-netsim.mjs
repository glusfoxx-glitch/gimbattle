import assert from 'node:assert/strict';
import { C, Player, runUntil, now, resetBench, summarize, stats, nextGuestProfile, seed, rand, hosts } from './netsim.mjs';

let failures = 0;
const results = [];
function check(name, ok, info) {
  results.push({ name, ok, info });
  if (!ok) failures++;
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${info ? ' — ' + JSON.stringify(info) : ''}`);
}

/** Two players (host + guest) moving for `ms`; returns measurements. */
function duel({ room, ms = 7000, up = {}, down = {}, hostOpts = {}, guestOpts = {}, setup }) {
  resetBench();
  seed(room.length * 977 + 3);
  nextGuestProfile.up = up;
  nextGuestProfile.down = down;
  const host = new Player('Hote', hostOpts);
  const guest = new Player('Invite', guestOpts);
  setup?.(host, guest);
  host.join(room, 'host');
  runUntil(now() + 200);
  guest.join(room, 'guest');
  runUntil(now() + 1500);
  host.corrections.length = 0; guest.corrections.length = 0;
  const remote = { hostSeesGuest: [], guestSeesHost: [], hostMissing: 0, guestMissing: 0, frames: 0 };
  const sample = (viewer, target, key, missKey) => {
    const sp = target.serverPlayer();
    if (!sp || sp.dead || !viewer.net.joined) return;
    const v = viewer.net.views.players[target.net.localSlot];
    if (!v.active) { remote[missKey]++; return; }
    remote[key].push(Math.hypot(v.x - sp.x, v.y - sp.y));
  };
  host.onFrame = () => { remote.frames++; sample(host, guest, 'hostSeesGuest', 'hostMissing'); };
  guest.onFrame = () => sample(guest, host, 'guestSeesHost', 'guestMissing');
  const rejectedBefore = stats.rejected;
  runUntil(now() + ms);
  const out = {
    host: summarize(host.corrections), guest: summarize(guest.corrections),
    hostSeesGuest: summarize(remote.hostSeesGuest), guestSeesHost: summarize(remote.guestSeesHost),
    hostMissing: remote.hostMissing, guestMissing: remote.guestMissing,
    rejected: stats.rejected - rejectedBefore, warnings: stats.warnings.slice(0, 3),
    errors: [...host.errors, ...guest.errors],
  };
  host.stop(); guest.stop();
  return out;
}

function report(name, r, { maxGuestOver10 = 0.05, maxRemoteAvg = 1.2 } = {}) {
  const hostFrac = r.host.n ? r.host.over10cm / r.host.n : 0;
  const guestFrac = r.guest.n ? r.guest.over10cm / r.guest.n : 0;
  check(`${name}: no rejected inputs`, r.rejected === 0, r.rejected ? r.warnings : undefined);
  check(`${name}: no connection errors`, r.errors.length === 0, r.errors.length ? r.errors : undefined);
  check(`${name}: host prediction stays on server (corrections >10cm ≤ ${maxGuestOver10 * 100}%)`, hostFrac <= maxGuestOver10, r.host);
  check(`${name}: guest prediction stays on server (corrections >10cm ≤ ${maxGuestOver10 * 100}%)`, guestFrac <= maxGuestOver10, r.guest);
  check(`${name}: host always sees guest`, r.hostMissing === 0 && r.hostSeesGuest.n > 0, { missing: r.hostMissing });
  check(`${name}: guest always sees host`, r.guestMissing === 0 && r.guestSeesHost.n > 0, { missing: r.guestMissing });
  check(`${name}: host's view of guest is near real time (avg error ≤ ${maxRemoteAvg} m)`, r.hostSeesGuest.avg <= maxRemoteAvg, r.hostSeesGuest);
  check(`${name}: guest's view of host is near real time (avg error ≤ ${maxRemoteAvg} m)`, r.guestSeesHost.avg <= maxRemoteAvg, r.guestSeesHost);
}

console.log('\n== Network scenarios ==');
report('LAN', duel({ room: 'lan', up: { latency: 3, jitter: 2 }, down: { latency: 3, jitter: 2 } }));
report('Internet 40ms±30', duel({ room: 'internet', up: { latency: 40, jitter: 30 }, down: { latency: 40, jitter: 30 } }));
report('Bad 4G 90ms±90 + freezes', duel({
  room: 'bad4g', ms: 9000,
  up: { latency: 90, jitter: 90, stalls: [[now() + 4000, now() + 4300]] },
  down: { latency: 90, jitter: 90, stalls: [[now() + 6000, now() + 6400]] },
}), { maxGuestOver10: 0.1, maxRemoteAvg: 2.0 });
report('Guest at 30 fps with uneven frames', duel({ room: 'lowfps', up: { latency: 30, jitter: 10 }, down: { latency: 30, jitter: 10 }, guestOpts: { fps: 30, frameJitter: 14 } }));
report('Host at 144 Hz, guest at 75 Hz', duel({ room: 'hz', up: { latency: 25, jitter: 8 }, down: { latency: 25, jitter: 8 }, hostOpts: { fps: 144, frameJitter: 1 }, guestOpts: { fps: 75, frameJitter: 3 } }));
report('Host tab busy (frames freeze 400 ms)', duel({
  room: 'hostbusy', up: { latency: 30, jitter: 10 }, down: { latency: 30, jitter: 10 },
  setup: (h) => { h.frameStalls = [[now() + 4000, now() + 4400]]; },
}), { maxGuestOver10: 0.08 });

// ---------------------------------------------------------------- rejoin after a long game (sequence numbers)
console.log('\n== Leave and rejoin ==');
{
  resetBench();
  nextGuestProfile.up = { latency: 30, jitter: 10 }; nextGuestProfile.down = { latency: 30, jitter: 10 };
  const host = new Player('Hote');
  const guest = new Player('Invite');
  host.join('first', 'host'); runUntil(now() + 200);
  guest.join('first', 'guest'); runUntil(now() + 45000); // > 900 inputs
  guest.leave(); host.leave();
  runUntil(now() + 500);
  // The former guest now hosts a new game; the former host joins it.
  guest.join('second', 'host'); runUntil(now() + 300);
  host.join('second', 'guest');
  const rejectedBefore = stats.rejected;
  runUntil(now() + 1500);
  const p1 = guest.serverPlayer(); const p2 = host.serverPlayer();
  const a = { x: p1.x, y: p1.y }; const b = { x: p2.x, y: p2.y };
  guest.corrections.length = 0; host.corrections.length = 0;
  runUntil(now() + 3000);
  const moved1 = Math.hypot(p1.x - a.x, p1.y - a.y); const moved2 = Math.hypot(p2.x - b.x, p2.y - b.y);
  check('Rejoin: no inputs rejected in the new game', stats.rejected - rejectedBefore === 0, stats.warnings.slice(0, 2));
  check('Rejoin: new host really moves on the server', moved1 > 1, { moved: +moved1.toFixed(2) });
  check('Rejoin: new guest really moves on the server', moved2 > 1, { moved: +moved2.toFixed(2) });
  check('Rejoin: no rubber-banding after rejoin', summarize(guest.corrections).over50cm === 0 && summarize(host.corrections).over50cm === 0,
    { host: summarize(guest.corrections), guest: summarize(host.corrections) });
  host.stop(); guest.stop();
}

// ---------------------------------------------------------------- guest tab hidden then back
console.log('\n== Guest tab in background ==');
{
  const r = duel({
    room: 'hidden', ms: 8000, up: { latency: 30, jitter: 10 }, down: { latency: 30, jitter: 10 },
    setup: (h, g) => { g.frameStalls = [[now() + 4000, now() + 6000]]; },
  });
  check('Background tab: no rejected inputs', r.rejected === 0, r.warnings);
  check('Background tab: connection kept', r.errors.length === 0, r.errors);
  check('Background tab: host keeps seeing guest', r.hostMissing === 0);
}

// ---------------------------------------------------------------- 6 players, everyone sees everyone
console.log('\n== 6 players ==');
{
  resetBench();
  const players = [];
  const host = new Player('P0'); players.push(host);
  host.join('six', 'host'); runUntil(now() + 200);
  for (let i = 1; i < 6; i++) {
    nextGuestProfile.up = { latency: 20 + i * 15, jitter: 5 + i * 6 }; nextGuestProfile.down = { latency: 20 + i * 15, jitter: 5 + i * 6 };
    const p = new Player('P' + i, { brawler: i % 9 });
    players.push(p); p.join('six', 'guest'); runUntil(now() + 100);
  }
  runUntil(now() + 2000);
  let missing = 0; let samples = 0;
  for (const v of players) v.onFrame = () => {
    for (const t of players) {
      if (t === v) continue;
      const sp = t.serverPlayer();
      if (!sp || sp.dead || sp.invisMs > 0) continue;
      samples++;
      if (!v.net.views.players[t.net.localSlot].active) missing++;
    }
  };
  runUntil(now() + 6000);
  check('6 players: everyone sees everyone', missing === 0 && samples > 0, { missing, samples });
  check('6 players: teams balanced', Math.abs(players.filter((p) => p.net.localTeam === 0).length - 3) === 0);
  check('6 players: no rejected inputs', stats.rejected === 0, stats.warnings.slice(0, 2));
  for (const p of players) p.stop();
}

// ---------------------------------------------------------------- long match with teachers and attacks
console.log('\n== Long match with attacks and teachers (60 s) ==');
{
  const attackScript = (t, cmd) => {
    const a = Math.floor(t / 900) * 2.3;
    cmd.moveX = Math.cos(a); cmd.moveY = Math.sin(a); cmd.aimAngle = Math.atan2(Math.sin(a + 1), Math.cos(a + 1)); cmd.aimDist = 0.6;
    cmd.buttons = (Math.floor(t / 400) % 3 === 0 ? C.BTN_ATTACK : 0) | (Math.floor(t / 3000) % 4 === 0 ? C.BTN_SUPER : 0);
  };
  for (let b = 0; b < 9; b++) {
    const r = duel({
      room: 'long' + b, ms: 20000, up: { latency: 35, jitter: 20 }, down: { latency: 35, jitter: 20 },
      hostOpts: { brawler: b, script: attackScript }, guestOpts: { brawler: (b + 4) % 9, script: attackScript },
    });
    check(`Brawlers ${b} vs ${(b + 4) % 9}: no rejected inputs / errors`, r.rejected === 0 && r.errors.length === 0, { rejected: r.rejected, errors: r.errors });
    // Hits, knockback and stuns legitimately move a player without prediction: only large unexplained snaps count.
    const snapsH = r.host.over50cm; const snapsG = r.guest.over50cm;
    check(`Brawlers ${b} vs ${(b + 4) % 9}: few large corrections (≤2% >50cm)`, snapsH <= Math.max(2, r.host.n * 0.02) && snapsG <= Math.max(2, r.guest.n * 0.02), { host: r.host, guest: r.guest });
  }
}

console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
