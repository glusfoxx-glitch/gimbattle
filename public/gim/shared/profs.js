import { BOT_BEHAVIOR } from './constants.js';

export const PROFS = Object.freeze([
  Object.freeze({
    id: 0,
    name: 'Adam',
    role: 'Surveillant Principal',
    accent: '#ff4d5e',
    hp: 4500,
    speed: 3.2,
    radius: 0.6,
    damage: 1200,
    range: 2.2,
    windupMs: 800,
    cooldownMs: 2000,
    stunMs: 1600, // <-- Réduit à 1,6 seconde
    behavior: BOT_BEHAVIOR.MELEE,
    description: "Assène un coup de règle géante qui paralyse net quiconque s'approche trop près.",
  }),
  // ... (garde les autres profs si présents)
]);

export const PROF_COUNT = PROFS.length;
