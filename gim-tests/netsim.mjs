/**
 * Simulated multiplayer bench: real Room/HostServer (host browser) + real Net clients,
 * driven by a virtual clock with configurable latency, jitter, stalls and frame rates.
 * Run: node --import ./gim-tests/register.mjs gim-tests/run-netsim.mjs
 */

// ---------------------------------------------------------------- virtual clock + event queue
let NOW = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => NOW }, configurable: true, writable: true });
globalThis.Worker = class { constructor() {} terminate() {} };
globalThis.queueMicrotask = globalThis.queueMicrotask ?? ((fn) => Promise.resolve().then(fn));

/** @type {{t:number, seq:number, fn:() => void}[]} */
let heap = [];
let heapSeq = 0;
function schedule(t, fn) {
  heap.push({ t, seq: heapSeq++, fn });
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p].t < heap[i].t || (heap[p].t === heap[i].t && heap[p].seq < heap[i].seq)) break;
    [heap[p], heap[i]] = [heap[i], heap[p]];
    i = p;
  }
}
function pop() {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      const less = (a, b) => heap[a].t < heap[b].t || (heap[a].t === heap[b].t && heap[a].seq < heap[b].seq);
      if (l < heap.length && less(l, m)) m = l;
      if (r < heap.length && less(r, m)) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      i = m;
    }
  }
  return top;
}
export function runUntil(t) {
  while (heap.length > 0 && heap[0].t <= t) {
    const e = pop();
    NOW = e.t;
    e.fn();
  }
  NOW = t;
}
export const now = () => NOW;

// ---------------------------------------------------------------- deterministic random
let rngState = 12345;
export function seed(s) { rngState = s >>> 0 || 1; }
export function rand() {
  rngState ^= rngState << 13; rngState >>>= 0;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5; rngState >>>= 0;
  return rngState / 4294967296;
}

// ---------------------------------------------------------------- game modules (after the clock)
const C = await import('../public/gim/shared/constants.js');
const { HostServer } = await import('../public/gim/client/p2p.js');
const { Net } = await import('../public/gim/client/net.js');
const { createInput } = await import('../public/gim/shared/simulation.js');
export { C, HostServer, Net, createInput };

export const stats = { rejected: 0, warnings: [] };
console.warn = (...args) => { stats.rejected++; if (stats.warnings.length < 20) stats.warnings.push(args.join(' ')); };

/**
 * Ordered reliable link (like the WebRTC data channel): each message arrives after latency + jitter,
 * never before the previous one. Optional stall windows hold everything.
 */
export class Link {
  constructor({ latency = 0, jitter = 0, stalls = [] } = {}) {
    this.latency = latency; this.jitter = jitter; this.stalls = stalls; this.last = 0;
  }
  send(deliver) {
    let t = NOW + this.latency + rand() * this.jitter;
    for (const [a, b] of this.stalls) if (t >= a && t < b) t = b;
    t = Math.max(t, this.last);
    this.last = t;
    schedule(t, deliver);
  }
}

/** @type {Map<string, any>} */
export const hosts = new Map();

/** Host server with its tick source (the worker in the browser) driven by the virtual clock. */
export function startHost(room, { tickEvery = C.TICK_MS / 4, stalls = [] } = {}) {
  const server = new HostServer(room);
  const h = { server, room, links: [], stopped: false };
  const tick = () => {
    if (h.stopped) return;
    server.step();
    let next = NOW + tickEvery;
    for (const [a, b] of stalls) if (next >= a && next < b) next = b;
    schedule(next, tick);
  };
  schedule(NOW + tickEvery, tick);
  hosts.set(room, h);
  return h;
}

function blank() { return { send() {}, close() {}, onopen() {}, onmessage() {}, onclose() {}, onfail() {} }; }
function detach(d) {
  if (typeof d === 'string') return d;
  if (d instanceof ArrayBuffer) return d.slice(0);
  return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
}

/** Network profile used by the next guest socket created by Net.connect. */
export const nextGuestProfile = { up: {}, down: {} };

globalThis.__gimSockets = {
  host(room) {
    const socket = blank();
    const h = startHost(room);
    let closed = false;
    const self = h.server.createClient((data) => schedule(NOW, () => { if (!closed) socket.onmessage(data); }));
    schedule(NOW + 5, () => socket.onopen());
    socket.send = (data) => { if (!closed) h.server.handleMessage(self, detach(data)); };
    socket.close = () => { closed = true; h.stopped = true; h.server.stop(); };
    h.self = self;
    return socket;
  },
  guest(room) {
    const socket = blank();
    const h = hosts.get(room);
    if (!h) { schedule(NOW + 50, () => socket.onfail('no room')); return socket; }
    const up = new Link(nextGuestProfile.up);
    const down = new Link(nextGuestProfile.down);
    let closed = false;
    const client = h.server.createClient((data) => down.send(() => { if (!closed) socket.onmessage(data); }));
    schedule(NOW + 60, () => socket.onopen());
    socket.send = (data) => { if (closed) return; const d = detach(data); up.send(() => { if (!h.stopped) h.server.handleMessage(client, d); }); };
    socket.close = () => { closed = true; up.send(() => h.server.leave(client)); };
    return socket;
  },
};

/**
 * Browser-like player: rAF frames (with jitter), fixed 30 Hz steps exactly like main.js, scripted controls.
 */
export class Player {
  constructor(name, { fps = 60, frameJitter = 2, brawler = 0, script } = {}) {
    this.name = name; this.fps = fps; this.frameJitter = frameJitter; this.brawler = brawler;
    this.net = new Net();
    this.cmd = createInput();
    this.acc = 0;
    this.last = NOW;
    this.running = false;
    this.corrections = [];
    this.welcomed = false;
    this.errors = [];
    this.frameStalls = [];
    this.script = script ?? ((t, cmd) => { const a = Math.floor(t / 700) * 2.1; cmd.moveX = Math.cos(a); cmd.moveY = Math.sin(a); cmd.aimAngle = Math.atan2(cmd.moveY, cmd.moveX); cmd.buttons = 0; });
    const net = this.net;
    const orig = net.reconcile.bind(net);
    net.reconcile = (s) => { const had = net.hasSelf; orig(s); if (had) this.corrections.push(net.lastCorrection); };
    net.onWelcome = () => { this.welcomed = true; this.acc = 0; };
    net.onError = (m) => this.errors.push(m);
    net.onClose = () => this.errors.push('closed');
    net.onEvent = (e) => { this.events = (this.events ?? 0) + 1; if (this.onEvent) this.onEvent(e); };
  }
  join(room, mode) {
    this.net.join(this.name, this.brawler, room, mode);
    if (!this.running) { this.running = true; this.last = NOW; schedule(NOW, () => this.frame()); }
  }
  leave() { this.net.leave(); this.welcomed = false; }
  frame() {
    if (!this.running) return;
    const t = NOW;
    const delta = Math.min(t - this.last, C.MAX_FRAME_DELTA_MS);
    this.last = t;
    if (this.welcomed) {
      this.acc += delta;
      while (this.acc >= C.TICK_MS) {
        this.script(t, this.cmd, this);
        this.net.fixedTick(this.cmd);
        this.acc -= C.TICK_MS;
      }
      this.net.update(t, this.acc / C.TICK_MS, delta / 1000);
      if (this.onFrame) this.onFrame(t);
    }
    let next = t + 1000 / this.fps + (rand() - 0.5) * this.frameJitter;
    for (const [a, b] of this.frameStalls) if (next >= a && next < b) next = b;
    schedule(next, () => this.frame());
  }
  stop() { this.running = false; }
  serverPlayer() {
    const h = [...hosts.values()].find((x) => !x.stopped && x.server.room.clients.some((c) => c && c.name === this.name));
    return h ? h.server.room.world.players[this.net.localSlot] : null;
  }
}

export function resetBench() {
  heap = []; NOW += 1000; hosts.clear(); stats.rejected = 0; stats.warnings.length = 0;
}

export function summarize(list) {
  if (list.length === 0) return { n: 0, avg: 0, max: 0, p95: 0, over10cm: 0, over50cm: 0 };
  const s = [...list].sort((a, b) => a - b);
  return {
    n: s.length,
    avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
    p95: +s[Math.floor(s.length * 0.95)].toFixed(3),
    max: +s[s.length - 1].toFixed(3),
    over10cm: s.filter((x) => x > 0.1).length,
    over50cm: s.filter((x) => x > 0.5).length,
  };
}
