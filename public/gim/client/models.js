/**
 * Modèles 3D procéduraux (primitives Three.js) : élèves, profs, projectiles, décor.
 * Aucun fichier externe : tout se remplace plus tard par des modèles glTF si besoin.
 *
 * Performance mobile : chaque partie rigide d'un personnage (tête, torse, bras, jambes) est FUSIONNÉE en une
 * seule géométrie à couleurs par sommet → ~10 appels de dessin par personnage au lieu de ~40.
 * Les géométries sont construites une fois par apparence puis partagées ; chaque instance n'a qu'un matériau
 * (flash d'impact et invisibilité se règlent en une seule écriture).
 * Construction = au chargement ou à l'arrivée d'un joueur (événement rare), jamais dans la boucle de rendu.
 */
import * as THREE from 'three';
import { HAIR, HAT, BEARD, HAND_PROP, FEET_PROP } from '../shared/brawlers.js';
import {
  VISUAL, PROJECTILE_VISUAL_COUNT, WALK_CYCLE_SPEED, WALK_SWING, WALK_BOB, IDLE_BREATH_SPEED, IDLE_BREATH,
  HIT_FLASH_MS, RECOIL_MS, RECOIL_DISTANCE, ATTACK_ANIM_MS, INVISIBLE_ALLY_OPACITY, SHIELD_PULSE_SPEED,
  LEAP_HEIGHT, HALF, FLOAT_ZERO, MS_PER_SECOND,
} from '../shared/constants.js';

/**
 * Proportions des modèles : données d'art regroupées ici (écart assumé à « tout dans constants.js » :
 * ce sont des dimensions de sculpture, pas des réglages de gameplay).
 */
const PART = Object.freeze({
  LEG_LENGTH: 0.55, LEG_RADIUS: 0.105, HIP_HALF: 0.12, FOOT_RADIUS: 0.12,
  TORSO_HEIGHT: 0.62, TORSO_WIDTH: 0.56, TORSO_DEPTH: 0.34,
  ARM_LENGTH: 0.5, ARM_RADIUS: 0.08, SHOULDER_IN: 0.04, HAND_RADIUS: 0.095,
  HEAD_RADIUS: 0.3, NECK: 0.05,
  EYE_RADIUS: 0.045, EYE_SPACING: 0.11, EYE_UP: 0.05, EYE_DEPTH: 0.27,
  BELLY_BASE: 0.24, BELLY_GROW: 0.16,
  DECK_HEIGHT: 0.16, WHEEL_RADIUS: 0.09,
  ARM_REST_SPREAD: 0.14, CRAWL_PITCH: 1.25, DASH_LEAN: 0.35, STUN_WOBBLE: 0.12,
  ATTACK_SWING: 1.9, SPEED_SMOOTHING: 10, TEAM_RING_SCALE: 1.25, SHIELD_SCALE: 1.6,
  STAR_ORBIT: 0.32, STAR_SIZE: 0.06, STAR_SPEED: 5, WALK_FULL_SPEED: 4,
});

const Q = Math.PI * HALF;
const limbGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
limbGeometry.translate(0, -HALF, 0); // pivot en haut : le membre pend depuis l'épaule ou la hanche

/** Primitives unitaires partagées (sources des fusions et de quelques meshes simples). */
const GEO = {
  sphere: new THREE.SphereGeometry(1, 14, 10),
  lowSphere: new THREE.SphereGeometry(1, 7, 5),
  hairCap: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
  hemisphere: new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI * HALF),
  lowerHemisphere: new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI * HALF, Math.PI * HALF),
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 14),
  cone: new THREE.ConeGeometry(1, 1, 10),
  band: new THREE.TorusGeometry(1, 0.12, 6, 16, Math.PI),
  torus: new THREE.TorusGeometry(1, 0.35, 8, 16),
  octa: new THREE.OctahedronGeometry(1),
  ring: new THREE.RingGeometry(0.82, 1, 36),
  circle: new THREE.CircleGeometry(1, 24),
  limb: limbGeometry,
};
GEO.ring.rotateX(-Q);
GEO.circle.rotateX(-Q);

const SHADOW_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
const STAR_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffe14d });
const SHIELD_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x7fe7ff, transparent: true, opacity: 0.22, depthWrite: false });
const SHIELD_BASE_OPACITY = 0.16;
const SHIELD_PULSE_OPACITY = 0.08;

const COLOR = Object.freeze({
  EYE: 0x111111, MOUTH: 0x6b2b2b, WHITE: 0xffffff, APRON: 0xeee6d2, FRECKLE: 0xb36a3c, METAL: 0x8a8f99,
  WHEEL: 0x222222, SCOOTER: 0x1f9d55, EMBER: 0xff6a00, RAG: 0xf5f0e0, LABEL: 0xd7263d, SAUERKRAUT: 0xe8dc8a,
});
const STAR_COUNT = 3;
const FRECKLE_COUNT = 6;
const CURL_COUNT = 9;
const SPIKE_COUNT = 5;

// ============================================================================
// FUSION DE PRIMITIVES COLORÉES
// ============================================================================

/**
 * @typedef {Object} ColoredPart
 * @property {THREE.BufferGeometry} geo @property {number} color
 * @property {number} x @property {number} y @property {number} z
 * @property {number} rx @property {number} ry @property {number} rz
 * @property {number} sx @property {number} sy @property {number} sz
 */

/**
 * @param {ColoredPart[]} list @param {THREE.BufferGeometry} geo @param {number} color
 * @param {number} sx @param {number} sy @param {number} sz @param {number} x @param {number} y @param {number} z
 * @param {number} [rx] @param {number} [ry] @param {number} [rz]
 */
function add(list, geo, color, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) {
  list.push({ geo, color, x, y, z, rx, ry, rz, sx, sy, sz });
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();

/**
 * Fusionne des primitives colorées en une géométrie unique (chargement uniquement).
 * @param {ColoredPart[]} parts
 * @returns {THREE.BufferGeometry}
 */
export function mergeColored(parts) {
  const prepared = [];
  let total = 0;
  for (const p of parts) {
    tmpEuler.set(p.rx, p.ry, p.rz);
    tmpQuat.setFromEuler(tmpEuler);
    tmpMatrix.compose(tmpPos.set(p.x, p.y, p.z), tmpQuat, tmpScale.set(p.sx, p.sy, p.sz));
    let g = p.geo.clone();
    g.applyMatrix4(tmpMatrix);
    if (g.index !== null) g = g.toNonIndexed();
    prepared.push({ g, color: p.color });
    total += g.attributes.position.count;
  }
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  let offset = 0;
  for (const { g, color } of prepared) {
    const count = g.attributes.position.count;
    positions.set(g.attributes.position.array, offset * 3);
    normals.set(g.attributes.normal.array, offset * 3);
    tmpColor.set(color);
    for (let i = 0; i < count; i++) {
      colors[(offset + i) * 3] = tmpColor.r;
      colors[(offset + i) * 3 + 1] = tmpColor.g;
      colors[(offset + i) * 3 + 2] = tmpColor.b;
    }
    offset += count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  out.computeBoundingSphere();
  return out;
}

// ============================================================================
// PERSONNAGES : géométries par apparence (mises en cache)
// ============================================================================

/** @typedef {import('../shared/brawlers.js').Look} Look */

/**
 * @typedef {Object} CharacterGeometry
 * @property {THREE.BufferGeometry} leg @property {THREE.BufferGeometry} torso
 * @property {THREE.BufferGeometry} armL @property {THREE.BufferGeometry} armR @property {THREE.BufferGeometry} head
 * @property {THREE.BufferGeometry|null} scooter
 * @property {number} topY @property {number} legLength @property {number} deck
 */

/** @param {ColoredPart[]} list @param {Look} look */
function addHair(list, look) {
  const r = PART.HEAD_RADIUS;
  const c = look.hair;
  if (look.hairStyle === HAIR.NONE) return;
  if (look.hairStyle === HAIR.SIDE) {
    add(list, GEO.sphere, c, r * 0.35, r * 0.32, r * 0.6, -r * 0.88, r * 0.15, -r * 0.1);
    add(list, GEO.sphere, c, r * 0.35, r * 0.32, r * 0.6, r * 0.88, r * 0.15, -r * 0.1);
    add(list, GEO.sphere, c, r * 0.85, r * 0.35, r * 0.4, 0, r * 0.1, -r * 0.8);
    return;
  }
  const s = look.hairStyle === HAIR.BUZZ ? 1.02 : 1.08;
  add(list, GEO.hairCap, c, r * s, r * s, r * s, 0, r * 0.04, -r * 0.05, -0.25, 0, 0);
  if (look.hairStyle === HAIR.SPIKY) {
    for (let i = 0; i < SPIKE_COUNT; i++) {
      const a = (i / SPIKE_COUNT) * Math.PI * 2;
      add(list, GEO.cone, c, r * 0.18, r * 0.5, r * 0.18, Math.cos(a) * r * 0.45, r * 0.95, Math.sin(a) * r * 0.45 - r * 0.1,
        Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    }
  } else if (look.hairStyle === HAIR.LONG) {
    add(list, GEO.box, c, r * 1.9, r * 2.4, r * 0.35, 0, -r * 0.55, -r * 0.82);
    add(list, GEO.box, c, r * 0.3, r * 1.9, r * 0.9, -r * 0.92, -r * 0.4, -r * 0.2);
    add(list, GEO.box, c, r * 0.3, r * 1.9, r * 0.9, r * 0.92, -r * 0.4, -r * 0.2);
  } else if (look.hairStyle === HAIR.CURLY) {
    for (let i = 0; i < CURL_COUNT; i++) {
      const a = (i / CURL_COUNT) * Math.PI * 2;
      add(list, GEO.lowSphere, c, r * 0.3, r * 0.3, r * 0.3, Math.cos(a) * r * 0.62, r * 0.72, Math.sin(a) * r * 0.62 - r * 0.08);
    }
  }
}

/** @param {ColoredPart[]} list @param {Look} look */
function addHat(list, look) {
  const r = PART.HEAD_RADIUS;
  const c = look.hatColor;
  if (look.hat === HAT.CHAPKA) {
    add(list, GEO.cylinder, c, r * 1.12, r * 0.75, r * 1.12, 0, r * 0.82, 0);
    add(list, GEO.box, c, r * 1.9, r * 0.35, r * 0.4, 0, r * 0.62, r * 0.85);
    add(list, GEO.box, c, r * 0.3, r * 0.9, r * 0.7, -r * 1.02, r * 0.1, 0);
    add(list, GEO.box, c, r * 0.3, r * 0.9, r * 0.7, r * 1.02, r * 0.1, 0);
  } else if (look.hat === HAT.TOQUE) {
    add(list, GEO.cylinder, c, r * 0.82, r * 1.1, r * 0.82, 0, r * 1.25, 0);
    add(list, GEO.sphere, c, r * 1.05, r * 0.55, r * 1.05, 0, r * 1.85, 0);
  } else if (look.hat === HAT.HEADPHONES) {
    add(list, GEO.band, c, r * 1.08, r * 1.08, r * 1.08, 0, r * 0.1, 0, 0, Q, 0);
    add(list, GEO.cylinder, COLOR.EYE, r * 0.38, r * 0.25, r * 0.38, -r * 1.05, 0, 0, 0, 0, Q);
    add(list, GEO.cylinder, COLOR.EYE, r * 0.38, r * 0.25, r * 0.38, r * 1.05, 0, 0, 0, 0, Q);
  } else if (look.hat === HAT.CAP) {
    add(list, GEO.hemisphere, c, r * 1.06, r * 0.8, r * 1.06, 0, r * 0.25, 0);
    add(list, GEO.box, c, r * 1.1, r * 0.08, r * 0.8, 0, r * 0.3, r * 0.95);
  }
}

/** @param {ColoredPart[]} list @param {Look} look */
function addFace(list, look) {
  const r = PART.HEAD_RADIUS;
  const e = PART.EYE_RADIUS;
  add(list, GEO.lowSphere, COLOR.EYE, e, e * 1.3, e, -PART.EYE_SPACING, PART.EYE_UP, PART.EYE_DEPTH);
  add(list, GEO.lowSphere, COLOR.EYE, e, e * 1.3, e, PART.EYE_SPACING, PART.EYE_UP, PART.EYE_DEPTH);
  add(list, GEO.box, COLOR.MOUTH, r * 0.3, r * 0.06, r * 0.05, 0, -r * 0.32, r * 0.97);
  if (look.beard === BEARD.LONG) {
    add(list, GEO.cone, look.beardColor, r * 0.75, r * 1.4, r * 0.6, 0, -r * 1.05, r * 0.45, Math.PI, 0, 0);
    add(list, GEO.box, look.beardColor, r * 0.9, r * 0.14, r * 0.2, 0, -r * 0.22, r * 0.92);
  } else if (look.beard === BEARD.FULL) {
    add(list, GEO.lowerHemisphere, look.beardColor, r * 1.04, r * 1.1, r * 1.04, 0, -r * 0.1, 0.02);
  } else if (look.beard === BEARD.STUBBLE) {
    add(list, GEO.lowerHemisphere, look.beardColor, r * 1.01, r * 0.75, r * 1.01, 0, -r * 0.18, 0.01);
  }
  if (!look.freckles) return;
  const halfCount = FRECKLE_COUNT * HALF;
  for (let i = 0; i < FRECKLE_COUNT; i++) {
    const side = i < halfCount ? -1 : 1;
    const k = i % halfCount;
    add(list, GEO.lowSphere, COLOR.FRECKLE, 0.014, 0.014, 0.014, side * (r * 0.42 + k * 0.035), -r * 0.08 - (k % 2) * 0.03, r * 0.94);
  }
}

/**
 * Accessoire tenu dans la main droite (coordonnées relatives à la main).
 * @param {ColoredPart[]} list @param {Look} look @param {number} hy Hauteur de la main dans le repère du bras.
 */
function addHandProp(list, look, hy) {
  const c = look.propColor;
  switch (look.handProp) {
    case HAND_PROP.ROLLING_PIN: add(list, GEO.cylinder, c, 0.07, 0.75, 0.07, 0, hy, 0.12, Q, 0, 0); break;
    case HAND_PROP.PHONE: add(list, GEO.box, c, 0.14, 0.26, 0.03, 0, hy + 0.05, 0.1); break;
    case HAND_PROP.CIGARETTE_BATON:
      add(list, GEO.cylinder, c, 0.06, 0.9, 0.06, 0, hy, 0.42, Q, 0, 0);
      add(list, GEO.cylinder, COLOR.EMBER, 0.064, 0.1, 0.064, 0, hy, 0.9, Q, 0, 0);
      break;
    case HAND_PROP.BOTTLE:
      add(list, GEO.cylinder, c, 0.08, 0.26, 0.08, 0, hy + 0.1, 0.06);
      add(list, GEO.cylinder, c, 0.03, 0.12, 0.03, 0, hy + 0.29, 0.06);
      add(list, GEO.box, COLOR.RAG, 0.05, 0.1, 0.05, 0, hy + 0.37, 0.06);
      break;
    case HAND_PROP.VINYL:
      add(list, GEO.cylinder, c, 0.24, 0.015, 0.24, 0, hy, 0.12);
      add(list, GEO.cylinder, COLOR.LABEL, 0.08, 0.02, 0.08, 0, hy, 0.12);
      break;
    case HAND_PROP.COIL: add(list, GEO.torus, c, 0.16, 0.16, 0.16, 0, hy, 0.12, 0, Q, 0); break;
    case HAND_PROP.BILLS: add(list, GEO.box, c, 0.22, 0.06, 0.12, 0, hy + 0.02, 0.1); break;
    case HAND_PROP.BOWL:
      add(list, GEO.cylinder, COLOR.WHITE, 0.14, 0.08, 0.14, 0, hy + 0.04, 0.1);
      add(list, GEO.sphere, COLOR.SAUERKRAUT, 0.12, 0.05, 0.12, 0, hy + 0.09, 0.1);
      break;
    default: break;
  }
}

/** @returns {THREE.BufferGeometry} */
function buildScooterGeometry() {
  /** @type {ColoredPart[]} */
  const list = [];
  add(list, GEO.box, COLOR.SCOOTER, 0.3, 0.06, 0.95, 0, PART.WHEEL_RADIUS * 1.5, 0);
  add(list, GEO.cylinder, COLOR.METAL, 0.03, 1.15, 0.03, 0, 0.7, 0.46, -0.12, 0, 0);
  add(list, GEO.cylinder, COLOR.METAL, 0.03, 0.6, 0.03, 0, 1.26, 0.53, 0, 0, Q);
  add(list, GEO.cylinder, COLOR.WHEEL, PART.WHEEL_RADIUS, 0.06, PART.WHEEL_RADIUS, 0, PART.WHEEL_RADIUS, -0.42, 0, 0, Q);
  add(list, GEO.cylinder, COLOR.WHEEL, PART.WHEEL_RADIUS, 0.06, PART.WHEEL_RADIUS, 0, PART.WHEEL_RADIUS, 0.42, 0, 0, Q);
  return mergeColored(list);
}

/** @type {Map<Look, CharacterGeometry>} */
const geometryCache = new Map();

/**
 * @param {Look} look
 * @returns {CharacterGeometry}
 */
function getCharacterGeometry(look) {
  const cached = geometryCache.get(look);
  if (cached !== undefined) return cached;
  /** @type {ColoredPart[]} */
  const leg = [];
  add(leg, GEO.limb, look.bottom, PART.LEG_RADIUS, PART.LEG_LENGTH, PART.LEG_RADIUS, 0, 0, 0);
  add(leg, GEO.sphere, look.shoes, PART.FOOT_RADIUS, PART.FOOT_RADIUS * 0.7, PART.FOOT_RADIUS * 1.4, 0, -PART.LEG_LENGTH, 0.04);

  /** @type {ColoredPart[]} */
  const torso = [];
  add(torso, GEO.box, look.top, PART.TORSO_WIDTH * (1 + look.belly * 0.15), PART.TORSO_HEIGHT, PART.TORSO_DEPTH, 0, PART.TORSO_HEIGHT * HALF, 0);
  if (look.belly > 0) {
    const s = PART.BELLY_BASE + look.belly * PART.BELLY_GROW;
    add(torso, GEO.sphere, look.top, s * 1.1, s, s, 0, PART.TORSO_HEIGHT * 0.38, PART.TORSO_DEPTH * 0.35);
  }
  if (look.apron) add(torso, GEO.box, COLOR.APRON, PART.TORSO_WIDTH * 0.8, PART.TORSO_HEIGHT * 1.1, 0.04, 0, PART.TORSO_HEIGHT * 0.38, PART.TORSO_DEPTH * HALF + 0.02);
  const neckForward = look.neckForward * PART.HEAD_RADIUS * 0.9;
  if (look.neckForward > 0) add(torso, GEO.cylinder, look.skin, 0.09, 0.32, 0.09, 0, PART.TORSO_HEIGHT + 0.06, neckForward * HALF, 0.9, 0, 0);

  const hs = PART.HAND_RADIUS * look.handScale;
  const handY = -PART.ARM_LENGTH - hs * HALF;
  /** @type {ColoredPart[]} */
  const armL = [];
  add(armL, GEO.limb, look.top, PART.ARM_RADIUS, PART.ARM_LENGTH, PART.ARM_RADIUS, 0, 0, 0);
  add(armL, GEO.sphere, look.skin, hs, hs, hs, 0, handY, 0);
  /** @type {ColoredPart[]} */
  const armR = [];
  add(armR, GEO.limb, look.top, PART.ARM_RADIUS, PART.ARM_LENGTH, PART.ARM_RADIUS, 0, 0, 0);
  add(armR, GEO.sphere, look.skin, hs, hs, hs, 0, handY, 0);
  addHandProp(armR, look, handY);

  /** @type {ColoredPart[]} */
  const head = [];
  add(head, GEO.sphere, look.skin, PART.HEAD_RADIUS, PART.HEAD_RADIUS * 1.02, PART.HEAD_RADIUS, 0, 0, 0);
  addFace(head, look);
  addHair(head, look);
  addHat(head, look);

  const deck = look.feetProp === FEET_PROP.SCOOTER ? PART.DECK_HEIGHT : 0;
  const result = {
    leg: mergeColored(leg), torso: mergeColored(torso), armL: mergeColored(armL), armR: mergeColored(armR),
    head: mergeColored(head), scooter: deck > 0 ? buildScooterGeometry() : null,
    topY: (PART.LEG_LENGTH + PART.TORSO_HEIGHT + PART.NECK + PART.HEAD_RADIUS * 2) * look.height + deck,
    legLength: PART.LEG_LENGTH + deck / look.height,
    deck,
  };
  geometryCache.set(look, result);
  return result;
}

/**
 * @typedef {Object} CharacterModel
 * @property {THREE.Group} root @property {THREE.Group} body @property {THREE.Group} hips @property {THREE.Group} torso
 * @property {THREE.Group} legL @property {THREE.Group} legR @property {THREE.Group} armL @property {THREE.Group} armR
 * @property {THREE.Group} head @property {THREE.Group} stars @property {THREE.Mesh} shield @property {THREE.Mesh} ring
 * @property {THREE.Mesh} shadow @property {THREE.Mesh|null} scooter
 * @property {THREE.MeshBasicMaterial} ringMaterial @property {THREE.MeshLambertMaterial} material
 * @property {number} topY @property {number} legLength @property {number} radius
 * @property {number} lastX @property {number} lastY @property {number} speed @property {number} walkPhase
 * @property {number} attackMs @property {number} recoilMs @property {number} flashMs @property {boolean} flashing
 * @property {boolean} invisible @property {number} crawl
 */

/**
 * @param {THREE.BufferGeometry} geometry @param {THREE.Material} material @param {THREE.Object3D} parent
 * @returns {THREE.Mesh}
 */
function attach(geometry, material, parent) {
  const mesh = new THREE.Mesh(geometry, material);
  parent.add(mesh);
  return mesh;
}

/**
 * Construit un personnage (élève ou prof) à partir de sa fiche d'apparence.
 * @param {Look} look @param {number} ringColor
 * @returns {CharacterModel}
 */
export function buildCharacter(look, ringColor) {
  const geo = getCharacterGeometry(look);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.set(look.build, look.height, look.build);
  root.add(body);
  const scooter = geo.scooter !== null ? attach(geo.scooter, material, root) : null;

  const hips = new THREE.Group();
  hips.position.y = geo.legLength;
  body.add(hips);
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.x = -PART.HIP_HALF;
  legR.position.x = PART.HIP_HALF;
  attach(geo.leg, material, legL);
  attach(geo.leg, material, legR);
  hips.add(legL, legR);

  const torso = new THREE.Group();
  hips.add(torso);
  attach(geo.torso, material, torso);
  const shoulderY = PART.TORSO_HEIGHT - PART.ARM_RADIUS;
  const shoulderX = PART.TORSO_WIDTH * HALF * (1 + look.belly * 0.15) + PART.ARM_RADIUS - PART.SHOULDER_IN;
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-shoulderX, shoulderY, 0);
  armR.position.set(shoulderX, shoulderY, 0);
  attach(geo.armL, material, armL);
  attach(geo.armR, material, armR);
  torso.add(armL, armR);

  const head = new THREE.Group();
  const neckForward = look.neckForward * PART.HEAD_RADIUS * 0.9;
  head.position.set(0, PART.TORSO_HEIGHT + PART.NECK + PART.HEAD_RADIUS - neckForward * 0.4, neckForward);
  head.rotation.x = look.neckForward * 0.35;
  attach(geo.head, material, head);
  torso.add(head);

  const stars = new THREE.Group();
  stars.position.y = geo.topY + 0.15;
  for (let i = 0; i < STAR_COUNT; i++) {
    const a = (i / STAR_COUNT) * Math.PI * 2;
    const star = attach(GEO.octa, STAR_MATERIAL, stars);
    star.scale.setScalar(PART.STAR_SIZE);
    star.position.set(Math.cos(a) * PART.STAR_ORBIT, 0, Math.sin(a) * PART.STAR_ORBIT);
  }
  stars.visible = false;
  root.add(stars);

  const ringMaterial = new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.9, depthWrite: false });
  const ring = attach(GEO.ring, ringMaterial, root);
  ring.position.y = 0.03;
  const shadow = attach(GEO.circle, SHADOW_MATERIAL, root);
  shadow.position.y = 0.02;
  const shield = attach(GEO.sphere, SHIELD_MATERIAL, root);
  shield.position.y = geo.topY * HALF;
  shield.visible = false;

  return {
    root, body, hips, torso, legL, legR, armL, armR, head, stars, shield, ring, shadow, scooter, ringMaterial, material,
    topY: geo.topY, legLength: geo.legLength, radius: HALF,
    lastX: NaN, lastY: NaN, speed: FLOAT_ZERO, walkPhase: FLOAT_ZERO, attackMs: FLOAT_ZERO, recoilMs: FLOAT_ZERO,
    flashMs: FLOAT_ZERO, flashing: false, invisible: false, crawl: FLOAT_ZERO,
  };
}

/**
 * Dimensionne l'anneau d'équipe et l'ombre sur le rayon de collision réel (on voit la vraie hitbox).
 * @param {CharacterModel} model @param {number} radius
 */
export function fitToRadius(model, radius) {
  model.radius = radius;
  const s = radius * PART.TEAM_RING_SCALE;
  model.ring.scale.set(s, 1, s);
  model.shadow.scale.set(radius, 1, radius);
  model.shield.scale.set(radius * PART.SHIELD_SCALE, model.topY * HALF + radius, radius * PART.SHIELD_SCALE);
}

/** @param {CharacterModel} model @param {number} color */
export function setRingColor(model, color) {
  model.ringMaterial.color.setHex(color);
}

/** @param {CharacterModel} model */
export function triggerAttack(model) {
  model.attackMs = ATTACK_ANIM_MS;
  model.recoilMs = RECOIL_MS;
}

/** @param {CharacterModel} model */
export function triggerFlash(model) {
  model.flashMs = HIT_FLASH_MS;
}

/**
 * Bascule l'apparence « invisible » (vue alliée ou de soi). Rare : la recompilation du matériau est acceptable.
 * @param {CharacterModel} model @param {boolean} invisible
 */
export function setInvisibleLook(model, invisible) {
  if (model.invisible === invisible) return;
  model.invisible = invisible;
  model.material.transparent = invisible;
  model.material.opacity = invisible ? INVISIBLE_ALLY_OPACITY : 1;
  model.material.needsUpdate = true;
}

/**
 * @typedef {Object} PoseInput
 * @property {number} x @property {number} y           Position simulation (m).
 * @property {number} sceneX @property {number} sceneZ Position scène.
 * @property {number} facing @property {number} air    0..1 progression d'un saut.
 * @property {boolean} stunned @property {boolean} dashing @property {boolean} shielded @property {number} crawlTarget
 * @property {number} dt @property {number} time
 */

/**
 * Animation procédurale : marche selon la vitesse réelle, coups, recul, étourdissement, saut, quatre pattes.
 * @param {CharacterModel} model @param {PoseInput} pose
 */
export function animateCharacter(model, pose) {
  const dt = pose.dt;
  if (Number.isNaN(model.lastX)) { model.lastX = pose.x; model.lastY = pose.y; }
  const dx = pose.x - model.lastX;
  const dy = pose.y - model.lastY;
  model.lastX = pose.x;
  model.lastY = pose.y;
  const instant = dt > 0 ? Math.sqrt(dx * dx + dy * dy) / dt : 0;
  model.speed += (instant - model.speed) * Math.min(1, PART.SPEED_SMOOTHING * dt);
  model.walkPhase += model.speed * WALK_CYCLE_SPEED * dt;
  const moving = Math.min(1, model.speed / PART.WALK_FULL_SPEED);

  model.root.position.set(pose.sceneX, 0, pose.sceneZ);
  model.root.rotation.y = Q - pose.facing;

  const air = Math.sin(pose.air * Math.PI);
  const swing = Math.sin(model.walkPhase) * WALK_SWING * moving;
  model.legL.rotation.x = swing;
  model.legR.rotation.x = -swing;

  model.attackMs = Math.max(0, model.attackMs - dt * MS_PER_SECOND);
  model.recoilMs = Math.max(0, model.recoilMs - dt * MS_PER_SECOND);
  const attack = model.attackMs / ATTACK_ANIM_MS;
  const attackSwing = attack > 0 ? Math.sin((1 - attack) * Math.PI) * PART.ATTACK_SWING : 0;

  model.crawl += (pose.crawlTarget - model.crawl) * Math.min(1, PART.SPEED_SMOOTHING * dt);
  const crawlPitch = model.crawl * PART.CRAWL_PITCH;
  model.torso.rotation.x = crawlPitch + (pose.dashing ? PART.DASH_LEAN : 0);
  model.armL.rotation.set(-swing * 0.6 - crawlPitch, 0, -PART.ARM_REST_SPREAD);
  model.armR.rotation.set(swing * 0.6 - attackSwing - crawlPitch, 0, PART.ARM_REST_SPREAD);
  model.head.rotation.y = 0;
  model.hips.position.y = model.legLength * (1 - model.crawl * 0.3);

  const breath = Math.sin(pose.time * IDLE_BREATH_SPEED) * IDLE_BREATH * (1 - moving);
  const bob = Math.abs(Math.sin(model.walkPhase)) * WALK_BOB * moving;
  const recoil = (model.recoilMs / RECOIL_MS) * RECOIL_DISTANCE;
  model.body.position.set(0, air * LEAP_HEIGHT + bob + breath, -recoil);
  model.body.rotation.z = pose.stunned ? Math.sin(pose.time * PART.STAR_SPEED * 2) * PART.STUN_WOBBLE : 0;
  if (model.scooter !== null) model.scooter.position.set(0, air * LEAP_HEIGHT + bob, -recoil);

  model.stars.visible = pose.stunned;
  if (pose.stunned) model.stars.rotation.y = pose.time * PART.STAR_SPEED;
  model.shield.visible = pose.shielded;
  if (pose.shielded) SHIELD_MATERIAL.opacity = SHIELD_BASE_OPACITY + SHIELD_PULSE_OPACITY * Math.sin(pose.time * SHIELD_PULSE_SPEED);
  const shadowScale = model.radius * (1 - air * HALF);
  model.shadow.scale.set(shadowScale, 1, shadowScale);
  updateFlash(model, dt);
}

/** @param {CharacterModel} model @param {number} dt */
function updateFlash(model, dt) {
  if (model.flashMs <= 0 && !model.flashing) return;
  model.flashMs = Math.max(0, model.flashMs - dt * MS_PER_SECOND);
  const f = model.flashMs / HIT_FLASH_MS;
  model.material.emissive.setRGB(f, f, f);
  model.flashing = model.flashMs > 0;
}

// ============================================================================
// PROJECTILES : une géométrie fusionnée par visuel (rendue en InstancedMesh)
// ============================================================================

/**
 * Géométrie de chaque type de projectile ; l'avant est l'axe +X local.
 * @returns {THREE.BufferGeometry[]} Indexé par VISUAL.*
 */
export function createProjectileGeometries() {
  const list = new Array(PROJECTILE_VISUAL_COUNT);
  const build = (/** @type {Array<[THREE.BufferGeometry, number, number, number, number, number, number, number, number, number, number]>} */ parts) => {
    /** @type {ColoredPart[]} */
    const colored = [];
    for (const [g, c, sx, sy, sz, x, y, z, rx, ry, rz] of parts) add(colored, g, c, sx, sy, sz, x, y, z, rx, ry, rz);
    return mergeColored(colored);
  };
  list[VISUAL.NONE] = build([[GEO.lowSphere, 0xffffff, 0.2, 0.2, 0.2, 0, 0, 0, 0, 0, 0]]);
  list[VISUAL.CHOUCROUTE] = build([
    [GEO.lowSphere, 0xf1e6a4, 0.3, 0.22, 0.28, 0, 0, 0, 0, 0, 0],
    [GEO.lowSphere, 0xe6d27a, 0.16, 0.14, 0.16, 0.14, 0.06, 0.08, 0, 0, 0],
    [GEO.lowSphere, 0xf6eec0, 0.17, 0.13, 0.15, -0.12, 0.05, -0.1, 0, 0, 0],
    [GEO.cylinder, 0xd9c46a, 0.025, 0.38, 0.025, 0.05, 0.12, 0, 0.6, 0, 1.1],
    [GEO.cylinder, 0xd9c46a, 0.025, 0.34, 0.025, -0.05, 0.1, 0.05, -0.4, 0.3, 0.7],
  ]);
  list[VISUAL.MOLOTOV] = build([
    [GEO.cylinder, 0x2f7d3a, 0.11, 0.3, 0.11, 0, 0, 0, 0, 0, Q],
    [GEO.cylinder, 0x2f7d3a, 0.045, 0.16, 0.045, 0.22, 0, 0, 0, 0, Q],
    [GEO.box, COLOR.RAG, 0.07, 0.07, 0.07, 0.33, 0, 0, 0, 0, 0],
    [GEO.cone, 0xff8a1f, 0.08, 0.16, 0.08, 0.43, 0, 0, 0, 0, -Q],
  ]);
  list[VISUAL.VINYL] = build([
    [GEO.cylinder, 0x141414, 0.34, 0.03, 0.34, 0, 0, 0, 0, 0, 0],
    [GEO.cylinder, COLOR.LABEL, 0.12, 0.036, 0.12, 0, 0, 0, 0, 0, 0],
  ]);
  list[VISUAL.BRIOCHE] = build([
    [GEO.sphere, 0xd98e2b, 0.3, 0.24, 0.3, 0, 0, 0, 0, 0, 0],
    [GEO.sphere, 0xe9a53f, 0.15, 0.13, 0.15, 0, 0.2, 0, 0, 0, 0],
  ]);
  list[VISUAL.BOBINE] = build([
    [GEO.torus, 0xa3a9b4, 0.32, 0.32, 0.5, 0, 0, 0, 0, 0, 0],
    [GEO.cylinder, 0x5c616b, 0.16, 0.3, 0.16, 0, 0, 0, Q, 0, 0],
  ]);
  list[VISUAL.BILLET] = build([
    [GEO.box, 0x4caf50, 0.38, 0.02, 0.2, 0, 0, 0, 0, 0, 0],
    [GEO.box, 0x2e7d32, 0.12, 0.01, 0.1, 0, 0.012, 0, 0, 0, 0],
  ]);
  list[VISUAL.ELECTRIC] = build([
    [GEO.octa, 0x9ff3ff, 0.3, 0.3, 0.3, 0, 0, 0, 0, 0, 0],
    [GEO.octa, 0xffffff, 0.18, 0.18, 0.18, 0, 0, 0, 0.6, 0.6, 0],
    [GEO.cone, 0x5ee9ff, 0.1, 0.4, 0.1, -0.3, 0, 0, 0, 0, Q],
  ]);
  return list;
}

/** Géométries partagées exposées au moteur de rendu (décor, indicateurs). */
export const SHARED_GEOMETRY = GEO;
