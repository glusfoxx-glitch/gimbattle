// Node loader hooks for the game test bench:
// - remote https imports (PeerJS from esm.sh) are replaced by an inert stub;
// - net.js gets a simulated transport instead of the real WebRTC sockets.
const PEER_STUB = 'data:text/javascript,export default class Peer { on() {} destroy() {} }';
const SOCKET_STUB = new URL('./socket-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('https://')) return { url: PEER_STUB, shortCircuit: true };
  if (specifier === './p2p.js' && context.parentURL?.endsWith('/client/net.js')) return { url: SOCKET_STUB, shortCircuit: true };
  return next(specifier, context);
}
