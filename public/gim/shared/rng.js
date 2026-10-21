/**
 * Générateur pseudo-aléatoire déterministe (mulberry32).
 * La simulation ne touche jamais Math.random() : on lui passe cet état en paramètre,
 * ce qui rend une partie rejouable à l'identique à partir d'une graine.
 */

/**
 * @typedef {Object} Rng
 * @property {number} state  Entier 32 bits non signé.
 */

/**
 * @param {number} seed
 * @returns {Rng}
 */
export function createRng(seed) {
  return { state: seed >>> 0 };
}

/**
 * @param {Rng} rng
 * @returns {number} Valeur dans [0, 1).
 */
export function nextRandom(rng) {
  rng.state = (rng.state + 0x6d2b79f5) | 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * @param {Rng} rng
 * @param {number} count
 * @returns {number} Entier dans [0, count).
 */
export function nextInt(rng, count) {
  return Math.floor(nextRandom(rng) * count);
}
