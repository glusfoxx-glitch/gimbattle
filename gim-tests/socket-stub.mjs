// Stand-in for client/p2p.js inside net.js during simulated tests: the bench installs the factory.
export function createHostSocket(room) {
  return globalThis.__gimSockets.host(room);
}
export function createGuestSocket(room) {
  return globalThis.__gimSockets.guest(room);
}
