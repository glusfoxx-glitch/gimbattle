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
    stunMs: 2000,
    behavior: BOT_BEHAVIOR.MELEE,
    description: "Assène un coup de règle géante qui paralyse net quiconque s'approche trop près.",
  }),
  Object.freeze({
    id: 1,
    name: 'Béatrice',
    role: 'Prof de Maths',
    accent: '#ffa62b',
    hp: 3400,
    speed: 3.5,
    radius: 0.55,
    damage: 900,
    range: 3.0,
    windupMs: 600,
    cooldownMs: 1500,
    stunMs: 0,
    behavior: BOT_BEHAVIOR.MELEE,
    description: "Balance des équerres traçantes à effet de zone pour recadrer les élèves indisciplinés.",
  }),
  Object.freeze({
    id: 2,
    name: 'Charles',
    role: 'Prof de Physique',
    accent: '#3d8bff',
    hp: 3800,
    speed: 3.0,
    radius: 0.6,
    damage: 1400,
    range: 3.5,
    windupMs: 1000,
    cooldownMs: 2500,
    stunMs: 0,
    behavior: BOT_BEHAVIOR.CHARGE,
    description: "Projète un flux d'énergie instable issu de ses expériences de thermodynamique.",
  })
]);

export const PROF_COUNT = PROFS.length;
