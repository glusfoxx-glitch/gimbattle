import {
  TICK_MS, SNAPSHOT_BUFFER_SIZE, SNAPSHOT_BUFFER_BYTES, PENDING_INPUT_CAPACITY, INPUT_MESSAGE_BYTES,
  PING_MESSAGE_BYTES, PING_INTERVAL_MS, INTERP_DELAY_MS, MAX_INTERP_DELAY_MS, EVENT, CLOCK_SMOOTHING, CLOCK_SNAP_THRESHOLD_MS,
  CORRECTION_SMOOTHING, CORRECTION_SNAP_DIST, MAX_PLAYERS, MAX_BOTS, MAX_PROJECTILES, MAX_ZONES, MSG, REF_NONE,
  NET_ID_MASK, PROGRESS_QUANT, TEAM_A, TEAM_B, PF_DEAD, PF_STUNNED, PF_SLOWED, PF_SPEED, PF_INVISIBLE, PF_BLIND,
  PF_SHIELD, PF_DASH, PF_AIRBORNE, PF_TEAM_B, AUTO_AIM_RANGE_FACTOR, MAX_AIM_DISTANCE, BOT_REF_BASE, HALF, FLOAT_ZERO, MODE_BR, MODE_TDM
} from '../shared/constants.js';
import { ARENA, MAPS } from '../shared/arena.js';
import { BRAWLERS, BRAWLER_COUNT } from '../shared/brawlers.js';
import { PROFS } from '../shared/profs.js';
import { createPlayer } from '../shared/world.js';
import { createInput, copyInput, stepPlayerSelf } from '../shared/simulation.js';
import { angleDelta } from '../shared/physics.js';
import {
  ByteReader, ByteWriter, encodeInput, encodePing, decodePong, decodeSnapshot, createSnapshot, makeJoin, makeLeave, makePick, makeSettings, makeStart,
  parseServerText, sanitizeName,
} from '../shared/protocol.js';
import { createHostSocket, createGuestSocket } from './p2p.js';

function fill(n, factory) { const arr = new Array(n); for (let i = 0; i < n; i++) arr[i] = factory(); return arr; }
function lerp(a, b, t) { return a + (b - a) * t; }
function airFromQuant(z) { return z === 0 ? 0 : (z - 1) / (PROGRESS_QUANT - 1); }

export class Net {
  constructor() {
    this.ws = null; this.mode = ''; this.room = ''; this.connected = false; this.joined = false; this.hasSelf = false;
    this.localSlot = -1; this.localTeam = TEAM_A; this.pendingJoin = null;
    this.reader = new ByteReader(SNAPSHOT_BUFFER_BYTES); this.inputWriter = new ByteWriter(INPUT_MESSAGE_BYTES);
    this.inputBytes = new Uint8Array(this.inputWriter.buffer, 0, INPUT_MESSAGE_BYTES);
    this.pingWriter = new ByteWriter(PING_MESSAGE_BYTES); this.pingBytes = new Uint8Array(this.pingWriter.buffer, 0, PING_MESSAGE_BYTES);
    this.pong = { clientTime: FLOAT_ZERO, serverTime: FLOAT_ZERO };
    this.snapshots = fill(SNAPSHOT_BUFFER_SIZE, createSnapshot); this.snapWrite = 0; this.snapCount = 0; this.latest = null;
    this.predicted = createPlayer(0); this.prevX = FLOAT_ZERO; this.prevY = FLOAT_ZERO; this.corrX = FLOAT_ZERO; this.corrY = FLOAT_ZERO; this.lastCorrection = FLOAT_ZERO;
    this.pending = fill(PENDING_INPUT_CAPACITY, createInput); this.pendingHead = 0; this.pendingCount = 0; this.seq = 0;
    this.clockOffset = FLOAT_ZERO; this.clockInit = false; this.clockReady = false; this.rtt = FLOAT_ZERO; this.lastPingAt = -Infinity;
    this.interpDelay = INTERP_DELAY_MS; this.arrivalMean = FLOAT_ZERO; this.arrivalJitter = FLOAT_ZERO;
    this.lobStartX = new Float32Array(NET_ID_MASK + 1); this.lobStartY = new Float32Array(NET_ID_MASK + 1);
    this.lobStartT = new Float32Array(NET_ID_MASK + 1).fill(-1); this.lobStartAt = new Float64Array(NET_ID_MASK + 1);
    this.views = {
      players: fill(MAX_PLAYERS, () => ({ active: false, brawlerId: 0, team: TEAM_A, x: FLOAT_ZERO, y: FLOAT_ZERO, aim: FLOAT_ZERO, hp: FLOAT_ZERO, maxHp: 1, flags: 0, air: FLOAT_ZERO })),
      bots: fill(MAX_BOTS, () => ({ active: false, type: 0, x: FLOAT_ZERO, y: FLOAT_ZERO, angle: FLOAT_ZERO, hp: FLOAT_ZERO, maxHp: 1, state: 0, flags: 0 })),
      projectiles: fill(MAX_PROJECTILES, () => ({ id: 0, visual: 0, x: FLOAT_ZERO, y: FLOAT_ZERO, angle: FLOAT_ZERO, lob: FLOAT_ZERO })),
      projectileCount: 0, zones: fill(MAX_ZONES, () => ({ id: 0, visual: 0, x: FLOAT_ZERO, y: FLOAT_ZERO, radius: FLOAT_ZERO, life: FLOAT_ZERO })), zoneCount: 0,
      roundPhase: 0, mapId: 0, roundMs: FLOAT_ZERO, scoreA: 0, scoreB: 0, localSlot: -1, localTeam: TEAM_A, serverTick: 0,
      gameMode: MODE_TDM, stormRadius: 1000, stormX: 0, stormY: 0
    };
    this.idToIndex = new Int16Array(NET_ID_MASK + 1).fill(-1);
    this.roster = fill(MAX_PLAYERS, () => ({ active: false, name: '', brawler: 0, team: TEAM_A }));
    this.onEvent = () => {}; this.onWelcome = () => {}; this.onError = () => {}; this.onClose = () => {}; this.onResults = () => {}; this.onLobby = () => {};
    this.arena = ARENA; this.inLobby = false; this.stats = { snapshots: 0, bytes: 0, corrupted: 0 };
  }

  connect(mode, room) {
    if (this.ws !== null) this.ws.close();
    const ws = mode === 'host' ? createHostSocket(room) : createGuestSocket(room);
    ws.onopen = () => { if (this.ws !== ws) return; this.connected = true; if (this.pendingJoin !== null) ws.send(this.pendingJoin); };
    ws.onmessage = (data) => { if (this.ws === ws) this.handleMessage(data); };
    ws.onfail = (message) => { if (this.ws !== ws) return; this.ws = null; this.connected = false; this.pendingJoin = null; this.resetSession(); this.onError(message); };
    ws.onclose = () => { if (this.ws !== ws) return; this.connected = false; this.resetSession(); this.ws = null; this.onClose(); };
    this.ws = ws; this.mode = mode; this.room = room;
  }

  join(name, brawler, room, mode) {
    this.pendingJoin = makeJoin(name, brawler, room); this.joined = false;
    if (this.connected && this.ws !== null && this.mode === mode && this.room === room) this.ws.send(this.pendingJoin);
    else this.connect(mode, room);
  }

  pick(brawler) { if (this.connected && (this.joined || this.inLobby) && this.ws !== null) this.ws.send(makePick(brawler)); }
  sendSettings(minutes, map, gameMode) { if (this.connected && this.inLobby && this.ws !== null) this.ws.send(makeSettings(minutes, map, gameMode)); }
  start() { if (this.connected && this.inLobby && this.ws !== null) this.ws.send(makeStart()); }
  leave() { this.pendingJoin = null; const ws = this.ws; this.ws = null; this.connected = false; if (ws !== null) { ws.send(makeLeave()); ws.close(); } this.resetSession(); }

  resetSession() {
    this.joined = false; this.inLobby = false; this.hasSelf = false; this.localSlot = -1; this.pendingCount = 0; this.pendingHead = 0;
    this.seq = 0; this.clockInit = false; this.clockReady = false; this.lastPingAt = -Infinity;
    this.interpDelay = INTERP_DELAY_MS; this.arrivalMean = 0; this.arrivalJitter = 0; this.corrX = 0; this.corrY = 0;
    this.snapCount = 0; this.latest = null; this.views.localSlot = -1;
    for (let i = 0; i < MAX_PLAYERS; i++) this.views.players[i].active = false;
    for (let i = 0; i < MAX_BOTS; i++) this.views.bots[i].active = false;
    this.views.projectileCount = 0; this.views.zoneCount = 0;
  }

  handleMessage(data) {
    if (typeof data === 'string') { this.handleText(data); return; }
    this.stats.bytes += data.byteLength;
    if (!this.reader.load(new Uint8Array(data)) || this.reader.length === 0) return;
    const type = this.reader.bytes[0];
    if (type === MSG.SNAPSHOT) this.receiveSnapshot();
    else if (type === MSG.PONG && decodePong(this.reader, this.pong)) this.receivePong();
  }

  handleText(text) {
    const msg = parseServerText(text); if (msg === null) return;
    if (msg.t === 'welcome' && Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < MAX_PLAYERS) {
      this.resetSession(); this.inLobby = false; this.joined = true; this.localSlot = msg.slot;
      this.localTeam = msg.team; this.onWelcome(this.localSlot, this.localTeam);
    } else if (msg.t === 'roster' && Array.isArray(msg.players)) {
      for (let i = 0; i < MAX_PLAYERS; i++) this.roster[i].active = false;
      for (const entry of msg.players) {
        if (entry === null || typeof entry !== 'object' || !Number.isInteger(entry.slot) || entry.slot < 0 || entry.slot >= MAX_PLAYERS) continue;
        const r = this.roster[entry.slot]; r.active = true; r.name = sanitizeName(entry.name);
        r.brawler = Number.isInteger(entry.brawler) && entry.brawler >= 0 && entry.brawler < BRAWLER_COUNT ? entry.brawler : 0;
        r.team = entry.team;
      }
    } else if (msg.t === 'team' && this.joined) {
      this.localTeam = msg.team;
    } else if (msg.t === 'lobby' && Array.isArray(msg.players)) {
      this.inLobby = true; const players = [];
      for (const e of msg.players) {
        if (e === null || typeof e !== 'object' || !Number.isInteger(e.id)) continue;
        players.push({ id: e.id, name: sanitizeName(e.name), brawler: Number.isInteger(e.brawler) && e.brawler >= 0 && e.brawler < BRAWLER_COUNT ? e.brawler : 0 });
      }
      this.onLobby({
        you: Number(msg.you), host: Number(msg.host), players,
        minutes: Number.isInteger(msg.minutes) ? msg.minutes : 3, map: Number.isInteger(msg.map) ? msg.map : 0,
        gameMode: Number.isInteger(msg.gameMode) ? msg.gameMode : 0
      });
    } else if (msg.t === 'results' && Array.isArray(msg.players)) {
      const players = [];
      for (const e of msg.players) {
        if (e === null || typeof e !== 'object' || !Number.isInteger(e.slot) || e.slot < 0 || e.slot >= MAX_PLAYERS) continue;
        players.push({
          slot: e.slot, name: sanitizeName(e.name), brawler: Number.isInteger(e.brawler) && e.brawler >= 0 && e.brawler < BRAWLER_COUNT ? e.brawler : 0,
          team: e.team, kills: Number.isInteger(e.kills) && e.kills >= 0 ? e.kills : 0, deaths: Number.isInteger(e.deaths) && e.deaths >= 0 ? e.deaths : 0,
        });
      }
      this.onResults({ winner: Number.isInteger(msg.winner) ? msg.winner : 2, scoreA: Number(msg.scoreA) || 0, scoreB: Number(msg.scoreB) || 0, players, nextMap: Number.isInteger(msg.nextMap) ? msg.nextMap : 0, pauseMs: Number(msg.pauseMs) || 0 });
    } else if (msg.t === 'error' && typeof msg.message === 'string') {
      this.onError(msg.message);
    }
  }

  receiveSnapshot() {
    const slot = this.snapshots[this.snapWrite];
    if (this.snapCount === SNAPSHOT_BUFFER_SIZE && !slot.eventsDispatched) this.dispatchEvents(slot);
    let ok = false; try { ok = decodeSnapshot(this.reader, slot); } catch { ok = false; }
    if (!ok) { this.stats.corrupted++; return; }
    this.stats.snapshots++; this.snapWrite = (this.snapWrite + 1) % SNAPSHOT_BUFFER_SIZE;
    if (this.snapCount < SNAPSHOT_BUFFER_SIZE) this.snapCount++;
    this.latest = slot;
    if (MAPS[slot.mapId] !== undefined) this.arena = MAPS[slot.mapId];
    const now = performance.now();
    if (!this.clockInit) { this.clockInit = true; this.clockOffset = slot.serverTime - now; }
    else if (this.clockReady) {
      const late = now + this.clockOffset - slot.serverTime;
      this.arrivalMean += (late - this.arrivalMean) * 0.05; this.arrivalJitter += (Math.abs(late - this.arrivalMean) - this.arrivalJitter) * 0.05;
    }
    for (let i = 0; i < slot.eventCount; i++) { const e = slot.events[i]; if (e.type === EVENT.BOT_WINDUP) { this.onEvent(e); e.type = 0; } }
    if (this.joined && slot.selfSlot === this.localSlot) this.reconcile(slot);
  }

  reconcile(s) {
    const p = this.predicted; const oldX = p.x; const oldY = p.y; this.applySelf(s);
    while (this.pendingCount > 0 && this.pending[this.pendingHead].seq <= s.ackSeq) { this.pendingHead = (this.pendingHead + 1) % PENDING_INPUT_CAPACITY; this.pendingCount--; }
    for (let i = 0; i < this.pendingCount; i++) { stepPlayerSelf(p, this.pending[(this.pendingHead + i) % PENDING_INPUT_CAPACITY], TICK_MS, this.arena); }
    if (!this.hasSelf) { this.hasSelf = true; this.prevX = p.x; this.prevY = p.y; this.corrX = 0; this.corrY = 0; return; }
    const ex = oldX - p.x; const ey = oldY - p.y; const err2 = ex * ex + ey * ey; this.lastCorrection = Math.sqrt(err2);
    if (err2 > CORRECTION_SNAP_DIST * CORRECTION_SNAP_DIST) { this.corrX = 0; this.corrY = 0; this.prevX = p.x; this.prevY = p.y; } else { this.corrX += ex; this.corrY += ey; this.prevX -= ex; this.prevY -= ey; }
  }

  applySelf(s) {
    const p = this.predicted; const v = s.self; const b = BRAWLERS[v.brawlerId];
    p.active = true; p.slot = this.localSlot; p.ref = this.localSlot; p.brawlerId = v.brawlerId; p.team = v.team;
    p.radius = b.radius; p.maxHp = b.hp; p.hp = v.hp; p.dead = v.dead; p.respawnMs = v.respawnMs;
    p.x = v.x; p.y = v.y; p.kbVX = v.kbVX; p.kbVY = v.kbVY; p.attackCdMs = v.attackCdMs; p.superCharge = v.superCharge;
    p.stunMs = v.stunMs; p.slowMs = v.slowMs; p.slowFactor = v.slowFactor; p.speedBuffMs = v.speedBuffMs; p.speedMul = v.speedMul;
    p.invisMs = v.invisMs; p.blindMs = v.blindMs; p.shieldMs = v.shieldMs;
    p.dashMs = v.dashMs; p.dashDirX = v.dashDirX; p.dashDirY = v.dashDirY; p.dashSpeed = v.dashSpeed; p.dashIsSuper = v.dashIsSuper;
    p.leapMs = v.leapMs; p.leapTotalMs = v.leapTotalMs; p.leapFromX = v.leapFromX; p.leapFromY = v.leapFromY; p.leapToX = v.leapToX; p.leapToY = v.leapToY; p.leapIsSuper = v.leapIsSuper;
    p.kills = v.kills; p.deaths = v.deaths;
  }

  receivePong() {
    const now = performance.now(); const rtt = now - this.pong.clientTime; if (rtt < 0) return;
    const sample = this.pong.serverTime + rtt * HALF - now;
    if (!this.clockReady || Math.abs(sample - this.clockOffset) > CLOCK_SNAP_THRESHOLD_MS) { this.clockOffset = sample; this.clockReady = true; this.clockInit = true; this.rtt = rtt; }
    else { this.clockOffset += (sample - this.clockOffset) * CLOCK_SMOOTHING; this.rtt += (rtt - this.rtt) * CLOCK_SMOOTHING * 2; }
  }

  fixedTick(cmd) {
    if (!this.joined || !this.connected || this.ws === null) return 0;
    if (this.pendingCount === PENDING_INPUT_CAPACITY) { this.pendingHead = (this.pendingHead + 1) % PENDING_INPUT_CAPACITY; this.pendingCount--; }
    const input = this.pending[(this.pendingHead + this.pendingCount) % PENDING_INPUT_CAPACITY];
    this.pendingCount++; copyInput(input, cmd); input.seq = ++this.seq;
    encodeInput(this.inputWriter, input); this.ws.send(this.inputBytes);
    if (!this.hasSelf) return 0;
    this.prevX = this.predicted.x; this.prevY = this.predicted.y;
    return stepPlayerSelf(this.predicted, input, TICK_MS, this.arena);
  }

  estimateAutoAim(cmd, isSuper) {
    if (!this.hasSelf) return; const p = this.predicted; const b = BRAWLERS[p.brawlerId]; const def = isSuper ? b.super : b.main;
    const range = (def.range > 0 ? def.range : MAX_AIM_DISTANCE) * AUTO_AIM_RANGE_FACTOR;
    let best = range * range; let tx = 0; let ty = 0; let found = false;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const v = this.views.players[i];
      if (!v.active || i === this.localSlot || v.team === p.team || (v.flags & (PF_DEAD | PF_AIRBORNE)) !== 0) continue;
      const d2 = (v.x - p.x) * (v.x - p.x) + (v.y - p.y) * (v.y - p.y);
      if (d2 < best) { best = d2; tx = v.x; ty = v.y; found = true; }
    }
    for (let i = 0; i < MAX_BOTS; i++) {
      const v = this.views.bots[i]; if (!v.active) continue;
      const d2 = (v.x - p.x) * (v.x - p.x) + (v.y - p.y) * (v.y - p.y);
      if (d2 < best) { best = d2; tx = v.x; ty = v.y; found = true; }
    }
    if (!found) return; cmd.aimAngle = Math.atan2(ty - p.y, tx - p.x); cmd.aimDist = Math.min(1, Math.sqrt(best) / MAX_AIM_DISTANCE);
  }

  update(now, alpha, dt) {
    if (this.connected && this.ws !== null && now - this.lastPingAt >= PING_INTERVAL_MS) { this.lastPingAt = now; encodePing(this.pingWriter, now); this.ws.send(this.pingBytes); }
    const decay = Math.exp(-CORRECTION_SMOOTHING * dt); this.corrX *= decay; this.corrY *= decay;
    const latest = this.latest; if (latest === null) return;
    const views = this.views;
    views.roundPhase = latest.roundPhase; views.mapId = latest.mapId; views.roundMs = latest.roundMs;
    views.scoreA = latest.scoreA; views.scoreB = latest.scoreB; views.serverTick = latest.tick;
    views.gameMode = latest.gameMode; views.stormRadius = latest.stormRadius; views.stormX = latest.stormX; views.stormY = latest.stormY;
    const wanted = Math.min(MAX_INTERP_DELAY_MS, Math.max(INTERP_DELAY_MS, INTERP_DELAY_MS + Math.max(0, this.arrivalMean) + this.arrivalJitter * 2));
    this.interpDelay += (wanted - this.interpDelay) * Math.min(1, dt * 2);
    const renderTime = now + this.clockOffset - this.interpDelay;
    this.interpolate(renderTime); this.overrideLocal(alpha, latest);
  }

  interpolate(renderTime) {
    const oldest = (this.snapWrite - this.snapCount + SNAPSHOT_BUFFER_SIZE) % SNAPSHOT_BUFFER_SIZE;
    let a = null; let b = null;
    for (let i = 0; i < this.snapCount; i++) {
      const s = this.snapshots[(oldest + i) % SNAPSHOT_BUFFER_SIZE];
      if (s.serverTime <= renderTime) { a = s; if (!s.eventsDispatched) this.dispatchEvents(s); } else { b = s; break; }
    }
    if (a === null) a = b; if (b === null) b = a; if (a === null || b === null) return;
    const span = b.serverTime - a.serverTime; const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - a.serverTime) / span)) : 1;
    this.interpolatePlayers(a, b, t); this.interpolateBots(a, b, t); this.interpolateProjectiles(a, b, t); this.interpolateZones(a, b, t);
  }

  dispatchEvents(s) { s.eventsDispatched = true; for (let i = 0; i < s.eventCount; i++) this.onEvent(s.events[i]); }

  interpolatePlayers(a, b, t) {
    const views = this.views.players;
    for (let i = 0; i < MAX_PLAYERS; i++) views[i].active = false;
    for (let i = 0; i < b.playerCount; i++) {
      const bp = b.players[i]; const v = views[bp.slot]; let ap = null;
      for (let k = 0; k < a.playerCount; k++) if (a.players[k].slot === bp.slot) { ap = a.players[k]; break; }
      if (ap !== null && ap.brawlerId === bp.brawlerId) {
        v.x = lerp(ap.x, bp.x, t); v.y = lerp(ap.y, bp.y, t); v.aim = ap.aim + angleDelta(ap.aim, bp.aim) * t; v.air = lerp(airFromQuant(ap.z), airFromQuant(bp.z), t);
      } else { v.x = bp.x; v.y = bp.y; v.aim = bp.aim; v.air = airFromQuant(bp.z); }
      v.active = true; v.brawlerId = bp.brawlerId; 
      
      if (b.gameMode === MODE_BR) {
        v.team = 10 + bp.slot; // Fake team to make them all enemies
      } else {
        v.team = (bp.flags & PF_TEAM_B) !== 0 ? TEAM_B : TEAM_A;
      }
      
      v.hp = bp.hp; v.maxHp = BRAWLERS[bp.brawlerId].hp; v.flags = bp.flags;
    }
  }

  interpolateBots(a, b, t) {
    const views = this.views.bots; for (let i = 0; i < MAX_BOTS; i++) views[i].active = false;
    for (let i = 0; i < b.botCount; i++) {
      const bb = b.bots[i]; if (bb.type >= PROFS.length) continue; const v = views[bb.slot]; let ab = null;
      for (let k = 0; k < a.botCount; k++) if (a.bots[k].slot === bb.slot) { ab = a.bots[k]; break; }
      if (ab !== null && ab.type === bb.type) { v.x = lerp(ab.x, bb.x, t); v.y = lerp(ab.y, bb.y, t); v.angle = ab.angle + angleDelta(ab.angle, bb.angle) * t; } else { v.x = bb.x; v.y = bb.y; v.angle = bb.angle; }
      v.active = true; v.type = bb.type; v.hp = bb.hp; v.maxHp = PROFS[bb.type].hp; v.state = bb.state; v.flags = bb.flags;
    }
  }

  interpolateProjectiles(a, b, t) {
    const lookup = this.idToIndex; for (let i = 0; i < a.projectileCount; i++) lookup[a.projectiles[i].id] = i;
    const views = this.views.projectiles; const startT = this.lobStartT;
    for (let i = 0; i < b.projectileCount; i++) {
      const bp = b.projectiles[i];
      if (bp.lob > 0 && (startT[bp.id] < 0 || b.serverTime - this.lobStartAt[bp.id] > 3000)) { startT[bp.id] = bp.lob; this.lobStartAt[bp.id] = b.serverTime; this.lobStartX[bp.id] = bp.x; this.lobStartY[bp.id] = bp.y; }
      const v = views[i]; const index = lookup[bp.id];
      if (index >= 0) { const ap = a.projectiles[index]; v.x = lerp(ap.x, bp.x, t); v.y = lerp(ap.y, bp.y, t); v.lob = bp.lob > 0 ? lerp(ap.lob, bp.lob, t) : 0; } else { v.x = bp.x; v.y = bp.y; v.lob = bp.lob; }
      v.id = bp.id; v.visual = bp.visual; v.angle = bp.angle;
    }
    let count = b.projectileCount; for (let i = 0; i < b.projectileCount; i++) lookup[b.projectiles[i].id] = -2;
    for (let i = 0; i < a.projectileCount && count < views.length; i++) {
      const ap = a.projectiles[i]; if (lookup[ap.id] === -2 || ap.lob <= 0) continue;
      const v = views[count++]; v.x = ap.x; v.y = ap.y; v.lob = ap.lob > 0 ? lerp(ap.lob, 1, t) : 0;
      const t0 = startT[ap.id];
      if (ap.lob > 0 && t0 >= 0 && ap.lob - t0 > 0.05) { const k = (1 - t0) / (ap.lob - t0); const endX = this.lobStartX[ap.id] + (ap.x - this.lobStartX[ap.id]) * k; const endY = this.lobStartY[ap.id] + (ap.y - this.lobStartY[ap.id]) * k; v.x = lerp(ap.x, endX, t); v.y = lerp(ap.y, endY, t); }
      v.id = ap.id; v.visual = ap.visual; v.angle = ap.angle;
    }
    this.views.projectileCount = count;
    for (let i = 0; i < a.projectileCount; i++) lookup[a.projectiles[i].id] = -1;
    for (let i = 0; i < b.projectileCount; i++) lookup[b.projectiles[i].id] = -1;
  }

  interpolateZones(a, b, t) {
    const lookup = this.idToIndex; for (let i = 0; i < a.zoneCount; i++) lookup[a.zones[i].id] = i;
    const views = this.views.zones;
    for (let i = 0; i < b.zoneCount; i++) {
      const bz = b.zones[i]; const v = views[i]; const index = lookup[bz.id];
      if (index >= 0) { const az = a.zones[index]; v.x = lerp(az.x, bz.x, t); v.y = lerp(az.y, bz.y, t); v.life = lerp(az.life, bz.life, t); } else { v.x = bz.x; v.y = bz.y; v.life = bz.life; }
      v.id = bz.id; v.visual = bz.visual; v.radius = bz.radius;
    }
    this.views.zoneCount = b.zoneCount; for (let i = 0; i < a.zoneCount; i++) lookup[a.zones[i].id] = -1;
  }

  overrideLocal(alpha, latest) {
    const views = this.views; views.localSlot = this.joined && this.hasSelf ? this.localSlot : -1; views.localTeam = this.localTeam;
    if (views.localSlot < 0) return;
    const p = this.predicted; const v = views.players[this.localSlot]; v.active = true;
    v.x = lerp(this.prevX, p.x, alpha) + this.corrX; v.y = lerp(this.prevY, p.y, alpha) + this.corrY;
    v.aim = p.aimAngle; v.brawlerId = p.brawlerId; v.team = p.team; v.hp = latest.self.hp; v.maxHp = p.maxHp;
    v.air = p.leapMs > 0 ? 1 - p.leapMs / p.leapTotalMs : 0;
    let f = 0; if (p.dead) f |= PF_DEAD; if (p.stunMs > 0) f |= PF_STUNNED; if (p.slowMs > 0) f |= PF_SLOWED; if (p.speedBuffMs > 0) f |= PF_SPEED;
    if (p.invisMs > 0) f |= PF_INVISIBLE; if (p.blindMs > 0) f |= PF_BLIND; if (p.shieldMs > 0) f |= PF_SHIELD; if (p.dashMs > 0) f |= PF_DASH;
    if (p.leapMs > 0) f |= PF_AIRBORNE; if (p.team === TEAM_B) f |= PF_TEAM_B; v.flags = f;
  }

  nameOf(ref) {
    if (ref < MAX_PLAYERS) return this.roster[ref].active ? this.roster[ref].name : '???';
    if (ref === REF_NONE) return ''; const bot = this.views.bots[ref - BOT_REF_BASE]; return bot !== undefined ? PROFS[bot.type].name : 'Prof';
  }
}
