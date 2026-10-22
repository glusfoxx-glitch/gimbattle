import {
  MAX_PLAYERS, MAX_INPUT_QUEUE, INPUT_CATCHUP_THRESHOLD, TICK_MS, SNAPSHOT_INTERVAL_MS, SNAPSHOT_BUFFER_BYTES,
  TEAM_A, TEAM_B, MAX_SEQ_JUMP, INPUT_STARVE_GRACE_TICKS, ROUND_PHASE_ENDED, ROUND_DRAW,
  MAP_COUNT, MAP_MODE_ALL, MS_PER_SECOND, ROUND_END_PAUSE_MS, MODE_TDM, MODE_BR, STORM_SHRINK_SPEED, STORM_SAFE_RADIUS,
} from '../shared/constants.js';
import { ARENA, MAPS } from '../shared/arena.js';
import { createWorld, countTeam, setWorldArena } from '../shared/world.js';
import { createRng, nextInt } from '../shared/rng.js';
import { BRAWLER_COUNT } from '../shared/brawlers.js';
import {
  createInput, copyInput, stepPlayerSelf, applyPlayerActions, stepWorld, resolveAutoAim, activatePlayer, deactivatePlayer,
  dashContacts,
} from '../shared/simulation.js';
import { ByteWriter, encodeSnapshot, takeBytes, makeWelcome, makeRoster, makeResults, makeTeam } from '../shared/protocol.js';

export class InputQueue {
  constructor() {
    this.items = new Array(MAX_INPUT_QUEUE);
    for (let i = 0; i < MAX_INPUT_QUEUE; i++) this.items[i] = createInput();
    this.head = 0; this.count = 0; this.lastReceivedSeq = 0;
  }
  reset() { this.head = 0; this.count = 0; this.lastReceivedSeq = 0; }
  push(input) {
    if (input.seq <= this.lastReceivedSeq) return 'séquence rejouée';
    if (input.seq > this.lastReceivedSeq + MAX_SEQ_JUMP) return 'saut de séquence';
    if (this.count >= MAX_INPUT_QUEUE) return "file pleine";
    copyInput(this.items[(this.head + this.count) % MAX_INPUT_QUEUE], input);
    this.count++; this.lastReceivedSeq = input.seq; return null;
  }
  shift() { const item = this.items[this.head]; this.head = (this.head + 1) % MAX_INPUT_QUEUE; this.count--; return item; }
}

export class Room {
  constructor(id, seed) {
    this.id = id; this.world = createWorld(ARENA); this.rng = createRng(seed);
    this.clients = new Array(MAX_PLAYERS).fill(null); this.clientCount = 0;
    this.snapshotAccMs = 0; this.rosterDirty = false;
    this.writer = new ByteWriter(SNAPSHOT_BUFFER_BYTES); this.neutralInput = createInput();
    this.ctx = { viewer: null, ackSeq: 0, serverTime: 0, eventFrom: 0 };
    this.mapMode = 0; this.nextMapId = 0;
  }

  configure(minutes, mapMode, gameMode) {
    const w = this.world;
    w.roundDurationMs = minutes * 60 * MS_PER_SECOND;
    w.roundMs = w.roundDurationMs;
    w.gameMode = gameMode;
    this.mapMode = mapMode;
    
    if (w.gameMode === MODE_BR) {
      this.nextMapId = 2;
    } else {
      this.nextMapId = this.pickMap(-1);
      if (this.nextMapId === 2) this.nextMapId = 0;
    }
    setWorldArena(w, MAPS[this.nextMapId]);
  }

  pickMap(current) {
    if (this.mapMode !== MAP_MODE_ALL) return Math.min(this.mapMode, MAP_COUNT - 1);
    if (current < 0) return nextInt(this.rng, MAP_COUNT);
    return (current + 1 + nextInt(this.rng, MAP_COUNT - 1)) % MAP_COUNT;
  }

  prepareNextRound() {
    const w = this.world;
    
    if (w.gameMode === MODE_BR) {
      this.nextMapId = 2;
      w.stormRadius = 100;
      w.stormX = w.arena.width / 2;
      w.stormY = w.arena.height / 2;
    } else {
      this.nextMapId = this.pickMap(w.arena.id);
      if (this.nextMapId === 2) this.nextMapId = 0;
    }
    
    setWorldArena(w, MAPS[this.nextMapId]);
    const slots = [];
    for (let i = 0; i < MAX_PLAYERS; i++) if (this.clients[i] !== null) slots.push(i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = nextInt(this.rng, i + 1);
      const tmp = slots[i]; slots[i] = slots[j]; slots[j] = tmp;
    }
    const first = nextInt(this.rng, 2) === 0 ? TEAM_A : TEAM_B;
    slots.forEach((slot, i) => {
      const p = w.players[slot];
      if (w.gameMode === MODE_BR) {
        p.team = 10 + slot;
        p.brawlerId = nextInt(this.rng, BRAWLER_COUNT);
      } else {
        p.team = i % 2 === 0 ? first : 1 - first;
      }
      this.clients[slot]?.send(makeTeam(p.team));
    });
    this.rosterDirty = true;
  }

  addClient(client, name, brawlerId) {
    const slot = this.clients.indexOf(null);
    if (slot < 0) return -1;
    let team = TEAM_A;
    if (this.world.gameMode === MODE_BR) {
      team = 10 + slot;
      brawlerId = nextInt(this.rng, BRAWLER_COUNT);
    } else {
      team = countTeam(this.world, TEAM_A) <= countTeam(this.world, TEAM_B) ? TEAM_A : TEAM_B;
    }
    
    this.clients[slot] = client; this.clientCount++;
    client.room = this; client.slot = slot; client.name = name; client.brawlerId = brawlerId;
    client.ackSeq = 0; client.starveTicks = 0; client.inputDebt = 0; client.queue.reset();
    client.eventFrom = this.world.eventHead;
    activatePlayer(this.world, slot, team, brawlerId, this.rng);
    client.send(makeWelcome(slot, team, this.id));
    this.rosterDirty = true;
    return slot;
  }

  removeClient(client) {
    if (client.room !== this || client.slot < 0) return;
    deactivatePlayer(this.world, client.slot);
    this.clients[client.slot] = null; this.clientCount--;
    client.slot = -1; client.room = null; this.rosterDirty = true;
  }

  processInputs(client) {
    const p = this.world.players[client.slot]; const queue = client.queue;
    if (queue.count === 0) {
      client.starveTicks = (client.starveTicks ?? 0) + 1;
      if (client.starveTicks <= INPUT_STARVE_GRACE_TICKS) { client.inputDebt = Math.min(INPUT_STARVE_GRACE_TICKS, (client.inputDebt ?? 0) + 1); return; }
      client.inputDebt = 0; const neutral = this.neutralInput;
      neutral.moveX = 0; neutral.moveY = 0; neutral.buttons = 0; neutral.aimAngle = p.aimAngle; neutral.aimDist = 0;
      applyPlayerActions(this.world, p, stepPlayerSelf(p, neutral, TICK_MS, this.world.arena), neutral);
      return;
    }
    client.starveTicks = 0; let steps = 1;
    if (queue.count > INPUT_CATCHUP_THRESHOLD) steps = 2;
    else if ((client.inputDebt ?? 0) > 0 && queue.count > 1) steps = 2;
    if (steps === 2 && (client.inputDebt ?? 0) > 0) client.inputDebt--;
    for (let s = 0; s < steps && queue.count > 0; s++) {
      const input = queue.shift();
      resolveAutoAim(this.world, p, input);
      const flags = stepPlayerSelf(p, input, TICK_MS, this.world.arena);
      applyPlayerActions(this.world, p, flags, input);
      client.ackSeq = input.seq;
      if (s < steps - 1 && p.dashing && !p.dead) dashContacts(this.world, p);
    }
  }

  checkBRWinCondition() {
    if (this.world.gameMode !== MODE_BR || this.world.roundPhase === ROUND_PHASE_ENDED) return;
    if (this.world.roundMs > this.world.roundDurationMs - 3000) return;
    
    let aliveCount = 0;
    let lastAliveTeam = ROUND_DRAW;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = this.world.players[i];
      if (p.active && !p.dead) {
        aliveCount++;
        lastAliveTeam = p.team;
      }
    }
    
    if (aliveCount <= 1) {
      this.world.roundPhase = ROUND_PHASE_ENDED;
      this.world.roundMs = ROUND_END_PAUSE_MS;
      this.world.scores[0] = lastAliveTeam;
      this.broadcastResults(lastAliveTeam);
    }
  }

  tick(serverTime) {
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const client = this.clients[i];
      if (client !== null) this.processInputs(client);
    }
    const phaseBefore = this.world.roundPhase;
    if (phaseBefore === ROUND_PHASE_ENDED && this.world.roundMs - TICK_MS <= 0) this.prepareNextRound();
    
    stepWorld(this.world, TICK_MS, this.rng);
    
    if (this.world.gameMode === MODE_BR && this.world.roundPhase !== ROUND_PHASE_ENDED) {
      this.world.stormRadius = Math.max(STORM_SAFE_RADIUS, this.world.stormRadius - STORM_SHRINK_SPEED * (TICK_MS / MS_PER_SECOND));
      this.checkBRWinCondition();
    }
    
    if (phaseBefore !== ROUND_PHASE_ENDED && this.world.roundPhase === ROUND_PHASE_ENDED && this.world.gameMode !== MODE_BR) {
      this.broadcastResults();
    }
    
    if (this.rosterDirty) this.broadcastRoster();
    this.snapshotAccMs += TICK_MS;
    if (this.snapshotAccMs >= SNAPSHOT_INTERVAL_MS) {
      this.snapshotAccMs -= SNAPSHOT_INTERVAL_MS;
      this.sendSnapshots(serverTime);
    }
  }

  sendSnapshots(serverTime) {
    const ctx = this.ctx; ctx.serverTime = serverTime;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const client = this.clients[i]; if (client === null) continue;
      ctx.viewer = this.world.players[client.slot]; ctx.ackSeq = client.ackSeq; ctx.eventFrom = client.eventFrom;
      client.eventFrom = encodeSnapshot(this.writer, this.world, ctx);
      client.send(takeBytes(this.writer));
    }
    ctx.viewer = null;
  }

  pickBrawler(client, brawlerId) {
    if (client.room !== this || client.slot < 0 || this.world.roundPhase !== ROUND_PHASE_ENDED || this.world.gameMode === MODE_BR) return false;
    client.brawlerId = brawlerId; this.world.players[client.slot].brawlerId = brawlerId; this.rosterDirty = true; return true;
  }

  broadcastResults(brWinnerTeam = -1) {
    const w = this.world;
    const players = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const c = this.clients[i]; if (c === null) continue;
      const p = w.players[c.slot];
      players.push({ slot: c.slot, name: c.name, brawler: p.brawlerId, team: p.team, kills: p.kills, deaths: p.deaths });
    }
    
    let winner = ROUND_DRAW;
    if (w.gameMode === MODE_BR) {
      winner = brWinnerTeam;
    } else {
      const a = w.scores[TEAM_A]; const b = w.scores[TEAM_B];
      winner = a > b ? TEAM_A : b > a ? TEAM_B : ROUND_DRAW;
    }
    
    this.nextMapId = this.world.gameMode === MODE_BR ? 2 : this.pickMap(w.arena.id);
    const message = makeResults(winner, w.scores[TEAM_A], w.scores[TEAM_B], players, this.nextMapId, ROUND_END_PAUSE_MS);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const c = this.clients[i]; if (c !== null) c.send(message);
    }
  }

  broadcastRoster() {
    this.rosterDirty = false; const players = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const c = this.clients[i];
      if (c !== null) players.push({ slot: c.slot, name: c.name, brawler: c.brawlerId, team: this.world.players[c.slot].team });
    }
    const message = makeRoster(players);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const c = this.clients[i]; if (c !== null) c.send(message);
    }
  }
}
