export const peers = [];
export default class Peer {
  constructor() { this.handlers = {}; this.connections = []; this.disconnected = false; peers.push(this); }
  on(name, fn) { (this.handlers[name] ??= []).push(fn); }
  emit(name, value) { for (const fn of this.handlers[name] ?? []) fn(value); }
  connect() { const c = new PeerChannel(); this.connections.push(c); return c; }
  destroy() { this.destroyed = true; this.emit('error', { type: 'network' }); for (const c of this.connections) c.close(); }
  reconnect() { this.disconnected = false; this.emit('open'); }
}
export class PeerChannel {
  constructor() { this.handlers = {}; this.open = true; this.messages = []; }
  on(name, fn) { (this.handlers[name] ??= []).push(fn); }
  emit(name, value) { for (const fn of this.handlers[name] ?? []) fn(value); }
  send(data) { this.messages.push(data); }
  close() { this.open = false; this.emit('close'); }
}