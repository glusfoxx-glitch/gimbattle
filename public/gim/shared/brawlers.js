/**
 * Données d'équilibrage des élèves jouables (« brawlers »).
 * Ajouter ou rééquilibrer un personnage = modifier ce fichier uniquement :
 * la simulation ne connaît que des TYPES d'attaques génériques (ATTACK_KIND) et lit leurs paramètres ici.
 * Le bloc `look` décrit l'apparence 3D (silhouette, couleurs, accessoires) : ajuste-le librement.
 */
import { ATTACK_KIND, VISUAL, ZONE_VISUAL } from './constants.js';

/** Codes d'apparence (lus par client/models.js). */
export const HAIR = Object.freeze({ NONE: 0, SHORT: 1, SPIKY: 2, LONG: 3, CURLY: 4, SIDE: 5, BUZZ: 6 });
export const HAT = Object.freeze({ NONE: 0, CHAPKA: 1, TOQUE: 2, HEADPHONES: 3, CAP: 4 });
export const BEARD = Object.freeze({ NONE: 0, FULL: 1, LONG: 2, STUBBLE: 3 });
export const HAND_PROP = Object.freeze({
  NONE: 0, ROLLING_PIN: 1, PHONE: 2, CIGARETTE_BATON: 3, BOTTLE: 4, VINYL: 5, COIL: 6, BILLS: 7, BOWL: 8,
});
export const FEET_PROP = Object.freeze({ NONE: 0, SCOOTER: 1 });

/**
 * @typedef {Object} AttackDef
 * @property {number} kind            ATTACK_KIND.*
 * @property {string} name
 * @property {string} description
 * @property {number} damage
 * @property {number} range           Portée (m) : distance de tir, allonge, distance de dash/saut.
 * @property {number} cooldownMs      Attaque principale uniquement.
 * @property {number} speed           Vitesse des projectiles (m/s).
 * @property {number} radius          Rayon des projectiles (m).
 * @property {number} count           Nombre de projectiles par tir.
 * @property {number} spreadRad       Ouverture totale de l'éventail.
 * @property {number} visual          VISUAL.*
 * @property {number} slowFactor      Multiplicateur de vitesse infligé (1 = aucun).
 * @property {number} slowMs
 * @property {number} stunMs
 * @property {number} knockback       Vitesse de projection (m/s).
 * @property {number} heal            Soin sur un allié touché.
 * @property {number} arcRad          Ouverture d'un coup au corps-à-corps.
 * @property {number} beamWidth
 * @property {number} dashMs
 * @property {number} leapMs
 * @property {number} lobMs           Durée de vol d'un lancer en cloche.
 * @property {number} aoeRadius       Rayon d'explosion / onde de choc / atterrissage.
 * @property {number} zoneVisual      ZONE_VISUAL.*
 * @property {number} zoneRadius
 * @property {number} zoneMs
 * @property {number} zoneDps
 * @property {boolean} zoneFollowsOwner
 * @property {number} zoneBlindMs
 * @property {number} buffMs
 * @property {number} speedMultiplier
 * @property {boolean} invisible
 */

/** @type {AttackDef} */
const DEFAULT_ATTACK = Object.freeze({
  kind: ATTACK_KIND.PROJECTILE, name: '', description: '', damage: 0, range: 0, cooldownMs: 0,
  speed: 0, radius: 0.3, count: 1, spreadRad: 0, visual: VISUAL.NONE,
  slowFactor: 1, slowMs: 0, stunMs: 0, knockback: 0, heal: 0, arcRad: 0, beamWidth: 0,
  dashMs: 0, leapMs: 0, lobMs: 0, aoeRadius: 0,
  zoneVisual: ZONE_VISUAL.NONE, zoneRadius: 0, zoneMs: 0, zoneDps: 0, zoneFollowsOwner: false, zoneBlindMs: 0,
  buffMs: 0, speedMultiplier: 1, invisible: false,
});

/**
 * Complète une attaque avec les valeurs par défaut : toutes les attaques ont la même forme,
 * ce qui garde les boucles de simulation monomorphes (rapides) et sans test d'existence.
 * @param {Partial<AttackDef>} fields
 * @returns {AttackDef}
 */
function attack(fields) {
  return Object.freeze({ ...DEFAULT_ATTACK, ...fields });
}

/**
 * @typedef {Object} Look
 * @property {number} height  @property {number} build  @property {number} belly
 * @property {number} skin  @property {number} hair  @property {number} hairStyle
 * @property {number} top  @property {number} bottom  @property {number} shoes
 * @property {number} hat  @property {number} hatColor
 * @property {number} beard  @property {number} beardColor
 * @property {number} handScale  @property {number} handProp  @property {number} propColor
 * @property {number} feetProp  @property {boolean} freckles  @property {boolean} apron
 * @property {number} neckForward
 */

/** @type {Look} */
const DEFAULT_LOOK = Object.freeze({
  height: 1, build: 1, belly: 0, skin: 0xf1c8a8, hair: 0x3b2a20, hairStyle: HAIR.SHORT,
  top: 0x4466aa, bottom: 0x2d3142, shoes: 0x222222, hat: HAT.NONE, hatColor: 0x222222,
  beard: BEARD.NONE, beardColor: 0x3b2a20, handScale: 1, handProp: HAND_PROP.NONE, propColor: 0xffffff,
  feetProp: FEET_PROP.NONE, freckles: false, apron: false, neckForward: 0,
});

/**
 * @param {Partial<Look>} fields
 * @returns {Look}
 */
export function look(fields) {
  return Object.freeze({ ...DEFAULT_LOOK, ...fields });
}

/**
 * @typedef {Object} BrawlerDef
 * @property {number} id
 * @property {string} name
 * @property {string} role
 * @property {string} accent           Couleur d'interface (CSS).
 * @property {number} hp
 * @property {number} speed            m/s
 * @property {number} radius           Rayon de collision (m) : suit le gabarit.
 * @property {number} superRechargeMs  Recharge passive complète de la super.
 * @property {number} superChargeDamage Dégâts à infliger pour remplir la super (0 = temps seul).
 * @property {AttackDef} main
 * @property {AttackDef} super
 * @property {Look} look
 */

/** @type {readonly BrawlerDef[]} */
export const BRAWLERS = Object.freeze([
  Object.freeze({
    id: 0, name: 'Théo', role: 'Le Colosse alsacien', accent: '#f2c14e',
    hp: 4200, speed: 4.7, radius: 0.62, superRechargeMs: 15000, superChargeDamage: 3000,
    main: attack({
      kind: ATTACK_KIND.PROJECTILE, name: 'Lancer de choucroute',
      description: "Balance une poignée de choucroute qui colle aux semelles : l'ennemi touché est ralenti.",
      damage: 560, range: 7.5, cooldownMs: 700, speed: 13, radius: 0.4, visual: VISUAL.CHOUCROUTE,
      slowFactor: 0.55, slowMs: 1500,
    }),
    super: attack({
      kind: ATTACK_KIND.ZONE_SELF, name: 'Pet fumant',
      description: 'Libère un nuage toxique et lacrymogène : les ennemis dedans sont aveuglés et perdent des PV en continu.',
      range: 3.2, zoneVisual: ZONE_VISUAL.GAS, zoneRadius: 3.2, zoneMs: 5000, zoneDps: 420, zoneBlindMs: 900,
    }),
    look: look({
      height: 1.14, build: 1.3, belly: 0.25, skin: 0xf3cfb3, hair: 0xe9c46a, hairStyle: HAIR.SHORT,
      top: 0x2f7d4a, bottom: 0x3a3a48, handProp: HAND_PROP.BOWL, propColor: 0xe8dc8a,
    }),
  }),
  Object.freeze({
    id: 1, name: 'Vladimir', role: "L'Incendiaire à chapka", accent: '#e85d2a',
    hp: 3400, speed: 5.0, radius: 0.55, superRechargeMs: 12000, superChargeDamage: 2800,
    main: attack({
      kind: ATTACK_KIND.LOB, name: 'Cocktail Molotov',
      description: 'Lance une bouteille en cloche par-dessus les obstacles : elle explose et laisse une flaque de feu.',
      damage: 420, range: 8, cooldownMs: 2000, lobMs: 650, aoeRadius: 1.6, visual: VISUAL.MOLOTOV,
      zoneVisual: ZONE_VISUAL.FIRE, zoneRadius: 1.7, zoneMs: 2400, zoneDps: 480,
    }),
    super: attack({
      kind: ATTACK_KIND.BUFF, name: 'Poliakov speed',
      description: 'Boit le cocktail cul sec : +60 % de vitesse de déplacement pendant 5 secondes.',
      buffMs: 5000, speedMultiplier: 1.6,
    }),
    look: look({
      height: 1.0, build: 1.0, skin: 0xf1d0b8, hair: 0xf0d58c, hairStyle: HAIR.SHORT,
      top: 0x7a1f1f, bottom: 0x2b2b33, hat: HAT.CHAPKA, hatColor: 0x6b4a2f,
      handProp: HAND_PROP.BOTTLE, propColor: 0x3f8f4f,
    }),
  }),
  Object.freeze({
    id: 2, name: 'Nolan', role: 'Le DJ longue portée', accent: '#8b5cf6',
    hp: 3000, speed: 5.0, radius: 0.55, superRechargeMs: 15000, superChargeDamage: 3200,
    main: attack({
      kind: ATTACK_KIND.PROJECTILE, name: 'Lancer de vinyles',
      description: 'Envoie deux disques vinyles très loin : la plus longue portée de la classe.',
      damage: 380, range: 11, cooldownMs: 750, speed: 17, radius: 0.32, count: 2, spreadRad: 0.1, visual: VISUAL.VINYL,
    }),
    super: attack({
      kind: ATTACK_KIND.NOVA, name: 'Bass Drop',
      description: 'Lâche les basses : une onde de choc blesse et projette tous les ennemis autour de lui.',
      damage: 1000, range: 4, aoeRadius: 4, knockback: 14,
    }),
    look: look({
      height: 1.24, build: 0.92, skin: 0xe8bf9f, hair: 0x3b2a20, hairStyle: HAIR.SPIKY,
      top: 0x1f1b2e, bottom: 0x3b3b52, hat: HAT.HEADPHONES, hatColor: 0x8b5cf6,
      handProp: HAND_PROP.VINYL, propColor: 0x111111,
    }),
  }),
  Object.freeze({
    id: 3, name: 'Mathéo', role: 'Le Boulanger', accent: '#f4a259',
    hp: 3900, speed: 5.2, radius: 0.56, superRechargeMs: 13000, superChargeDamage: 3000,
    main: attack({
      kind: ATTACK_KIND.MELEE, name: 'Coup de rouleau',
      description: 'Un grand coup de rouleau à pâtisserie au corps-à-corps, qui repousse.',
      damage: 800, range: 2.3, cooldownMs: 700, arcRad: 1.75, knockback: 7,
    }),
    super: attack({
      kind: ATTACK_KIND.PROJECTILE, name: 'Fournée de brioches',
      description: 'Lance 3 brioches en éventail : elles blessent les ennemis et soignent les alliés touchés.',
      damage: 520, heal: 800, range: 8, speed: 12, radius: 0.4, count: 3, spreadRad: 0.32, visual: VISUAL.BRIOCHE,
    }),
    look: look({
      height: 1.0, build: 1.05, skin: 0xf6d5c0, hair: 0x6b4a2f, hairStyle: HAIR.SHORT,
      top: 0xf5f5f0, bottom: 0xdedbd2, hat: HAT.TOQUE, hatColor: 0xffffff, apron: true,
      handProp: HAND_PROP.ROLLING_PIN, propColor: 0xc8955c,
    }),
  }),
  Object.freeze({
    id: 4, name: 'Mohammed', role: 'Le Mastodonte', accent: '#ff8c1a',
    hp: 5000, speed: 4.2, radius: 0.8, superRechargeMs: 14000, superChargeDamage: 3200,
    main: attack({
      kind: ATTACK_KIND.BEAM, name: 'Snap de tana',
      description: "Dégaine son iPhone 18 orange : le flash du snap frappe instantanément le premier ennemi dans l'axe.",
      damage: 720, range: 8.5, cooldownMs: 950, beamWidth: 0.45,
    }),
    super: attack({
      kind: ATTACK_KIND.ZONE_SELF, name: 'Parfum de haaarbi',
      description: "Se parfume d'un spray de luxe : un nuage entêtant le suit et blesse en continu tout ennemi trop proche.",
      range: 3, zoneVisual: ZONE_VISUAL.PERFUME, zoneRadius: 3, zoneMs: 5000, zoneDps: 600, zoneFollowsOwner: true,
    }),
    look: look({
      height: 1.12, build: 1.55, belly: 0.55, skin: 0xc68e62, hair: 0x1d1a18, hairStyle: HAIR.CURLY,
      top: 0x111111, bottom: 0x2e3a52, beard: BEARD.STUBBLE, beardColor: 0x1d1a18,
      handProp: HAND_PROP.PHONE, propColor: 0xff8c1a,
    }),
  }),
  Object.freeze({
    id: 5, name: 'Adam', role: 'Le Fou de la trottinette', accent: '#22c55e',
    hp: 3000, speed: 6.1, radius: 0.5, superRechargeMs: 10000, superChargeDamage: 2600,
    main: attack({
      kind: ATTACK_KIND.DASH, name: 'Tabouzi trotinette',
      description: 'Fonce en trottinette sur 4,5 m : tout ennemi fauché perd des PV et est étourdi 2 secondes.',
      damage: 600, range: 4.5, cooldownMs: 1900, dashMs: 300, stunMs: 2000,
    }),
    super: attack({
      kind: ATTACK_KIND.PROJECTILE, name: 'Pluie de billets',
      description: 'Fait pleuvoir une liasse de billets à courte portée : plein de petits dégâts très rapides.',
      damage: 350, range: 5, speed: 15, radius: 0.26, count: 8, spreadRad: 0.85, visual: VISUAL.BILLET,
    }),
    look: look({
      height: 0.84, build: 0.95, skin: 0xc99068, hair: 0x221c18, hairStyle: HAIR.SIDE,
      top: 0x16a34a, bottom: 0x1f2937, hat: HAT.CAP, hatColor: 0x111827,
      handProp: HAND_PROP.BILLS, propColor: 0x4caf50, feetProp: FEET_PROP.SCOOTER,
    }),
  }),
  Object.freeze({
    id: 6, name: 'Ibrahima', role: 'Les Mains géantes', accent: '#0ea5e9',
    hp: 4600, speed: 5.0, radius: 0.62, superRechargeMs: 14000, superChargeDamage: 3200,
    main: attack({
      kind: ATTACK_KIND.MELEE, name: 'Baffe géante',
      description: "Une baffe monumentale : la plus grande allonge au corps-à-corps, et l'ennemi est projeté.",
      damage: 1000, range: 3.4, cooldownMs: 1000, arcRad: 1.3, knockback: 10,
    }),
    super: attack({
      kind: ATTACK_KIND.LEAP, name: 'Super Saut',
      description: 'Bondit dans les airs (intouchable) et retombe sur la zone visée : gros dégâts et étourdissement.',
      damage: 1300, range: 9, leapMs: 750, aoeRadius: 2.6, stunMs: 600, knockback: 8,
    }),
    look: look({
      height: 1.26, build: 1.12, skin: 0x5a3825, hair: 0x111111, hairStyle: HAIR.BUZZ,
      top: 0x0e7490, bottom: 0x1e293b, handScale: 2.1,
    }),
  }),
  Object.freeze({
    id: 7, name: 'Yann', role: 'Le Sidérurgiste', accent: '#94a3b8',
    hp: 3700, speed: 5.0, radius: 0.58, superRechargeMs: 30000, superChargeDamage: 0,
    main: attack({
      kind: ATTACK_KIND.PROJECTILE, name: 'Coup de bobine',
      description: "Lance une lourde bobine d'acier ArcelorMittal qui écrase et repousse.",
      damage: 880, range: 7, cooldownMs: 1050, speed: 10, radius: 0.48, knockback: 8, visual: VISUAL.BOBINE,
    }),
    super: attack({
      kind: ATTACK_KIND.BUFF, name: 'Peur des femmes',
      description: 'Disparaît totalement pendant 5 secondes : invisible pour les ennemis et les profs, mais impossible de tirer pendant ce temps. Recharge : 30 s.',
      buffMs: 5000, invisible: true,
    }),
    look: look({
      height: 1.15, build: 1.0, skin: 0xf2cdb1, hair: 0x5a3a22, hairStyle: HAIR.SHORT, freckles: true,
      top: 0x475569, bottom: 0x1e3a5f, handProp: HAND_PROP.COIL, propColor: 0x9ca3af,
    }),
  }),
  Object.freeze({
    id: 8, name: 'Clément', role: 'Le Fouetteur électrique', accent: '#facc15',
    hp: 3400, speed: 5.2, radius: 0.55, superRechargeMs: 15000, superChargeDamage: 3200,
    main: attack({
      kind: ATTACK_KIND.MELEE, name: 'Coup de fouet capillaire',
      description: 'Fouette avec sa longue chevelure : bonne allonge et coup très rapide.',
      damage: 720, range: 3.5, cooldownMs: 600, arcRad: 1.0, knockback: 3,
    }),
    super: attack({
      kind: ATTACK_KIND.PROJECTILE, name: 'Électrocution Schneider',
      description: "Décharge électrique qui immobilise l'ennemi touché pendant 2 secondes.",
      damage: 450, range: 8.5, speed: 18, radius: 0.38, stunMs: 2000, visual: VISUAL.ELECTRIC,
    }),
    look: look({
      height: 1.0, build: 1.0, skin: 0xefc8a8, hair: 0x6b4a2b, hairStyle: HAIR.LONG,
      top: 0x3f6212, bottom: 0x292524,
    }),
  }),
]);

export const BRAWLER_COUNT = BRAWLERS.length;

/**
 * Attaque principale ou super d'un brawler (évite les accès par chaîne dans les boucles).
 * @param {number} brawlerId @param {boolean} isSuper
 * @returns {AttackDef}
 */
export function getAttack(brawlerId, isSuper) {
  const b = BRAWLERS[brawlerId];
  return isSuper ? b.super : b.main;
}
