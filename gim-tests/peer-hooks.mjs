export function resolve(specifier, context, next) {
  if (specifier.startsWith('https://esm.sh/peerjs')) return { url: new URL('./peer-fake.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}