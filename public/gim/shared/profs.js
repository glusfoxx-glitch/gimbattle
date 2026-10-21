/**
 * Données des profs (bots IA). Comme pour les élèves, tout l'équilibrage est ici :
 * l'IA ne connaît que deux comportements génériques (MELEE et CHARGE) paramétrés par ces valeurs.
 * Les champs slowFactor/slowMs/stunMs/knockback ont les mêmes noms que dans AttackDef :
 * la fonction d'application des effets est commune aux élèves et aux profs.
 */
import { BOT_BEHAVIOR } from './constants.js';
import { look, HAIR, BEARD, HAND_PROP } from './brawlers.js';

/**
 * @typedef {Object} ProfDef
 * @property {number} id @property {string} name @property {string} role @property {string} description
 * @property {string} accent
 * @property {number} hp @property {number} radius @property {number} speed @property {number} behavior
 * @property {number} detectRange   Distance de déclenchement de l'attaque.
 * @property {number} windupMs      Temps d'annonce avant le coup (laisse le temps d'esquiver).
 * @property {number} damage @property {number} knockback @property {number} stunMs
 * @property {number} slowFactor @property {number} slowMs
 * @property {number} strikeRadius @property {number} strikeOffset
 * @property {number} chargeSpeed @property {number} chargeMs
 * @property {number} recoverMs @property {number} cooldownMs
 * @property {import('./brawlers.js').Look} look
 */

/** @type {readonly ProfDef[]} */
export const PROFS = Object.freeze([
  Object.freeze({
    id: 0, name: 'Tarquinio', role: 'Le Taureau barbu', accent: '#b45309',
    description: 'Repère un élève, se met à quatre pattes et charge droit devant. Esquive sur le côté : s\'il percute un mur, il reste sonné.',
    hp: 4200, radius: 0.85, speed: 3.1, behavior: BOT_BEHAVIOR.CHARGE,
    detectRange: 9, windupMs: 450, damage: 1100, knockback: 12, stunMs: 0, slowFactor: 1, slowMs: 0,
    strikeRadius: 0, strikeOffset: 0, chargeSpeed: 9, chargeMs: 1300, recoverMs: 900, cooldownMs: 2500,
    look: look({
      height: 1.15, build: 1.45, belly: 0.6, skin: 0xe9b995, hair: 0x2b1d14, hairStyle: HAIR.SHORT,
      top: 0x7c2d12, bottom: 0x3f3f46, beard: BEARD.LONG, beardColor: 0x2b1d14,
    }),
  }),
  Object.freeze({
    id: 1, name: 'Breuer', role: 'Le Lent Dévastateur', accent: '#7c3aed',
    description: 'Petit, très lent et fragile, mais son coup de ventre au corps-à-corps est dévastateur. Éloigne-toi dès qu\'il prend son élan !',
    hp: 1700, radius: 0.7, speed: 1.9, behavior: BOT_BEHAVIOR.MELEE,
    detectRange: 1.5, windupMs: 750, damage: 1900, knockback: 9, stunMs: 0, slowFactor: 1, slowMs: 0,
    strikeRadius: 2, strikeOffset: 0, chargeSpeed: 0, chargeMs: 0, recoverMs: 600, cooldownMs: 1700,
    look: look({
      height: 0.8, build: 1.2, belly: 1, skin: 0xf0c9a6, hair: 0x9ca3af, hairStyle: HAIR.SIDE,
      top: 0x1e40af, bottom: 0x374151,
    }),
  }),
  Object.freeze({
    id: 2, name: 'Gilet', role: 'Le Cou Penché', accent: '#0f766e',
    description: 'Cou tendu vers l\'avant, matraque-cigarette à la main : vitesse moyenne et coups très rapides.',
    hp: 2600, radius: 0.55, speed: 4.3, behavior: BOT_BEHAVIOR.MELEE,
    detectRange: 1.4, windupMs: 180, damage: 340, knockback: 2, stunMs: 0, slowFactor: 1, slowMs: 0,
    strikeRadius: 1.1, strikeOffset: 0.8, chargeSpeed: 0, chargeMs: 0, recoverMs: 150, cooldownMs: 450,
    look: look({
      height: 1.05, build: 0.9, skin: 0xedc4a0, hair: 0x4b5563, hairStyle: HAIR.SHORT, neckForward: 1,
      top: 0x0f766e, bottom: 0x1f2937, handProp: HAND_PROP.CIGARETTE_BATON, propColor: 0xf5f5f5,
    }),
  }),
]);

export const PROF_COUNT = PROFS.length;
