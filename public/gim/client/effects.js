/**
 * Effets visuels éphémères : particules (un seul THREE.Points), coups au corps-à-corps, rayons,
 * ondes de choc et zones d'alerte des profs. Tout est pré-alloué dans des pools ; si un pool est plein,
 * l'effet le plus ancien est recyclé. Ce module lit l'état du jeu, il ne le modifie jamais.
 */
import * as THREE from 'three';
import { Pool } from '../shared/pool.js';
import {
  MAX_PARTICLES, MAX_SWING_EFFECTS, MAX_BEAM_EFFECTS, MAX_RING_EFFECTS, MAX_TELEGRAPHS, PARTICLE_GRAVITY,
  PARTICLE_DRAG, SWING_EFFECT_MS, BEAM_EFFECT_MS, ARENA_WIDTH, ARENA_HEIGHT, BEAM_HEIGHT, ATTACK_KIND,
  HALF, FLOAT_ZERO, MS_PER_SECOND, TWO_PI,
} from '../shared/constants.js';
import { BRAWLERS } from '../shared/brawlers.js';

const HALF_W = ARENA_WIDTH * HALF;
const HALF_H = ARENA_HEIGHT * HALF;
const COLOR_CHANNEL = 255;
const SWING_INNER = 0.3;
const SWING_SEGMENTS = 20;
const RING_SEGMENTS = 48;
const RING_INNER = 0.86;
const EFFECT_HEIGHT = 0.06;
const SWING_HEIGHT = 0.9;
const TELEGRAPH_MIN_OPACITY = 0.15;
const TELEGRAPH_MAX_OPACITY = 0.45;
const RING_START_SCALE = 0.2;
const BEAM_THICKNESS = 0.14;
const SPREAD_BIAS = 0.35;

const VERTEX_SHADER = `
attribute float size;
attribute float alpha;
attribute vec3 pcolor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = pcolor;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT_SHADER = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  gl_FragColor = vec4(vColor, vAlpha * (1.0 - smoothstep(0.08, 0.25, d)));
}`;

/**
 * @typedef {Object} Particle
 * @property {number} poolIndex @property {number} activeIndex @property {number} serial
 * @property {number} x @property {number} y @property {number} z
 * @property {number} vx @property {number} vy @property {number} vz
 * @property {number} life @property {number} maxLife @property {number} size
 * @property {number} r @property {number} g @property {number} b @property {number} gravity
 */

/** @returns {Particle} */
function createParticle() {
  return {
    poolIndex: 0, activeIndex: -1, serial: 0, x: FLOAT_ZERO, y: FLOAT_ZERO, z: FLOAT_ZERO,
    vx: FLOAT_ZERO, vy: FLOAT_ZERO, vz: FLOAT_ZERO, life: FLOAT_ZERO, maxLife: 1, size: FLOAT_ZERO,
    r: FLOAT_ZERO, g: FLOAT_ZERO, b: FLOAT_ZERO, gravity: FLOAT_ZERO,
  };
}

/**
 * @typedef {Object} MeshEffect
 * @property {number} poolIndex @property {number} activeIndex @property {number} serial
 * @property {THREE.Object3D} object @property {THREE.MeshBasicMaterial} material
 * @property {THREE.MeshBasicMaterial|null} material2
 * @property {number} lifeMs @property {number} totalMs @property {number} radius
 */

/**
 * @param {THREE.Scene} scene @param {THREE.BufferGeometry} geometry @param {boolean} additive
 * @returns {() => MeshEffect}
 */
function meshEffectFactory(scene, geometry, additive) {
  return () => {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return {
      poolIndex: 0, activeIndex: -1, serial: 0, object: mesh, material, material2: null,
      lifeMs: FLOAT_ZERO, totalMs: 1, radius: FLOAT_ZERO,
    };
  };
}

export class Effects {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.particles = new Pool(MAX_PARTICLES, createParticle);
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.alphas = new Float32Array(MAX_PARTICLES);
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('pcolor', this.colorAttr);
    geometry.setAttribute('size', this.sizeAttr);
    geometry.setAttribute('alpha', this.alphaAttr);
    geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER, transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 1 } },
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    /** Une géométrie d'arc par ouverture distincte (lue dans les données des élèves). */
    /** @type {Map<number, THREE.BufferGeometry>} */
    this.swingGeometries = new Map();
    for (const b of BRAWLERS) {
      for (const def of [b.main, b.super]) {
        if (def.kind !== ATTACK_KIND.MELEE || this.swingGeometries.has(def.arcRad)) continue;
        const g = new THREE.RingGeometry(SWING_INNER, 1, SWING_SEGMENTS, 1, -def.arcRad * HALF, def.arcRad);
        g.rotateX(-Math.PI * HALF);
        this.swingGeometries.set(def.arcRad, g);
      }
    }
    const fallbackSwing = new THREE.RingGeometry(SWING_INNER, 1, SWING_SEGMENTS, 1, -HALF, 1);
    fallbackSwing.rotateX(-Math.PI * HALF);
    const beamGeometry = new THREE.BoxGeometry(1, BEAM_THICKNESS, BEAM_THICKNESS);
    beamGeometry.translate(HALF, 0, 0);
    const ringGeometry = new THREE.RingGeometry(RING_INNER, 1, RING_SEGMENTS);
    ringGeometry.rotateX(-Math.PI * HALF);
    const discGeometry = new THREE.CircleGeometry(1, RING_SEGMENTS);
    discGeometry.rotateX(-Math.PI * HALF);

    this.swings = new Pool(MAX_SWING_EFFECTS, meshEffectFactory(scene, fallbackSwing, true));
    this.beams = new Pool(MAX_BEAM_EFFECTS, meshEffectFactory(scene, beamGeometry, true));
    this.rings = new Pool(MAX_RING_EFFECTS, meshEffectFactory(scene, ringGeometry, false));
    const telegraphFactory = meshEffectFactory(scene, discGeometry, false);
    const outlineFactory = meshEffectFactory(scene, ringGeometry, false);
    this.telegraphs = new Pool(MAX_TELEGRAPHS, () => {
      const item = telegraphFactory();
      const outline = outlineFactory();
      item.object.add(outline.object);
      outline.object.visible = true;
      outline.object.position.y = 0.005;
      item.material2 = outline.material;
      return item;
    });
  }

  /**
   * Taille apparente des particules : dépend de la hauteur du canvas et du champ de vision.
   * @param {number} pixelHeight @param {number} fovDeg
   */
  setViewport(pixelHeight, fovDeg) {
    this.material.uniforms.uScale.value = pixelHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /**
   * Gerbe de particules au point (x, y) du sol, à la hauteur `height`.
   * @param {number} x @param {number} y @param {number} height @param {number} count @param {number} color
   * @param {number} speed @param {number} size @param {number} lifeMs @param {number} gravityScale
   */
  burst(x, y, height, count, color, speed, size, lifeMs, gravityScale) {
    const r = ((color >> 16) & COLOR_CHANNEL) / COLOR_CHANNEL;
    const g = ((color >> 8) & COLOR_CHANNEL) / COLOR_CHANNEL;
    const b = (color & COLOR_CHANNEL) / COLOR_CHANNEL;
    for (let i = 0; i < count; i++) {
      const p = this.particles.acquire();
      const a = Math.random() * TWO_PI;
      const s = speed * (SPREAD_BIAS + Math.random() * (1 - SPREAD_BIAS));
      p.x = x; p.y = y; p.z = height;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.vz = speed * (SPREAD_BIAS + Math.random());
      p.maxLife = (lifeMs * (SPREAD_BIAS + Math.random())) / MS_PER_SECOND;
      p.life = p.maxLife;
      p.size = size * (SPREAD_BIAS + Math.random());
      p.r = r; p.g = g; p.b = b;
      p.gravity = gravityScale;
    }
  }

  /**
   * @param {number} x @param {number} y @param {number} angle @param {number} range @param {number} arcRad @param {number} color
   */
  swing(x, y, angle, range, arcRad, color) {
    const fx = this.swings.acquire();
    const mesh = /** @type {THREE.Mesh} */ (fx.object);
    mesh.geometry = this.swingGeometries.get(arcRad) ?? mesh.geometry;
    mesh.position.set(x - HALF_W, SWING_HEIGHT, y - HALF_H);
    mesh.rotation.set(0, -angle, 0);
    mesh.scale.set(range, 1, range);
    fx.material.color.setHex(color);
    fx.lifeMs = SWING_EFFECT_MS;
    fx.totalMs = SWING_EFFECT_MS;
    mesh.visible = true;
  }

  /**
   * @param {number} x @param {number} y @param {number} angle @param {number} length @param {number} color
   */
  beam(x, y, angle, length, color) {
    const fx = this.beams.acquire();
    const mesh = fx.object;
    mesh.position.set(x - HALF_W, BEAM_HEIGHT, y - HALF_H);
    mesh.rotation.set(0, -angle, 0);
    mesh.scale.set(Math.max(0.1, length), 1, 1);
    fx.material.color.setHex(color);
    fx.lifeMs = BEAM_EFFECT_MS;
    fx.totalMs = BEAM_EFFECT_MS;
    mesh.visible = true;
  }

  /**
   * Onde de choc qui s'élargit jusqu'à `radius`.
   * @param {number} x @param {number} y @param {number} radius @param {number} color @param {number} durationMs
   */
  shockwave(x, y, radius, color, durationMs) {
    const fx = this.rings.acquire();
    fx.object.position.set(x - HALF_W, EFFECT_HEIGHT, y - HALF_H);
    fx.material.color.setHex(color);
    fx.radius = radius;
    fx.lifeMs = durationMs;
    fx.totalMs = durationMs;
    fx.object.visible = true;
  }

  /**
   * Zone rouge annonçant le coup d'un prof : lisible = esquivable.
   * @param {number} x @param {number} y @param {number} radius @param {number} durationMs @param {number} color
   */
  telegraph(x, y, radius, durationMs, color) {
    const fx = this.telegraphs.acquire();
    fx.object.position.set(x - HALF_W, EFFECT_HEIGHT * HALF, y - HALF_H);
    fx.object.scale.set(radius, 1, radius);
    fx.material.color.setHex(color);
    if (fx.material2 !== null) fx.material2.color.setHex(color);
    fx.lifeMs = durationMs;
    fx.totalMs = durationMs;
    fx.object.visible = true;
  }

  /** @param {number} dt Secondes. */
  update(dt) {
    this.updateParticles(dt);
    const dtMs = dt * MS_PER_SECOND;
    this.fadePool(this.swings, dtMs);
    this.fadePool(this.beams, dtMs);
    this.updateRings(dtMs);
    this.updateTelegraphs(dtMs);
  }

  /** @param {number} dt */
  updateParticles(dt) {
    const pool = this.particles;
    const drag = Math.exp(-PARTICLE_DRAG * dt);
    let n = 0;
    for (let i = pool.activeCount - 1; i >= 0; i--) {
      const p = /** @type {Particle} */ (pool.active[i]);
      p.life -= dt;
      if (p.life <= 0) { pool.release(p); continue; }
      p.vz -= PARTICLE_GRAVITY * p.gravity * dt;
      p.vx *= drag; p.vy *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.z < 0) { p.z = 0; p.vz = 0; }
      const k = n * 3;
      this.positions[k] = p.x - HALF_W;
      this.positions[k + 1] = p.z;
      this.positions[k + 2] = p.y - HALF_H;
      this.colors[k] = p.r; this.colors[k + 1] = p.g; this.colors[k + 2] = p.b;
      this.sizes[n] = p.size;
      this.alphas[n] = p.life / p.maxLife;
      n++;
    }
    this.points.geometry.setDrawRange(0, n);
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  /** @param {Pool<MeshEffect>} pool @param {number} dtMs */
  fadePool(pool, dtMs) {
    for (let i = pool.activeCount - 1; i >= 0; i--) {
      const fx = /** @type {MeshEffect} */ (pool.active[i]);
      fx.lifeMs -= dtMs;
      if (fx.lifeMs <= 0) { fx.object.visible = false; pool.release(fx); continue; }
      fx.material.opacity = fx.lifeMs / fx.totalMs;
    }
  }

  /** @param {number} dtMs */
  updateRings(dtMs) {
    const pool = this.rings;
    for (let i = pool.activeCount - 1; i >= 0; i--) {
      const fx = /** @type {MeshEffect} */ (pool.active[i]);
      fx.lifeMs -= dtMs;
      if (fx.lifeMs <= 0) { fx.object.visible = false; pool.release(fx); continue; }
      const t = 1 - fx.lifeMs / fx.totalMs;
      const s = fx.radius * (RING_START_SCALE + (1 - RING_START_SCALE) * Math.sqrt(t));
      fx.object.scale.set(s, 1, s);
      fx.material.opacity = 1 - t;
    }
  }

  /** @param {number} dtMs */
  updateTelegraphs(dtMs) {
    const pool = this.telegraphs;
    for (let i = pool.activeCount - 1; i >= 0; i--) {
      const fx = /** @type {MeshEffect} */ (pool.active[i]);
      fx.lifeMs -= dtMs;
      if (fx.lifeMs <= 0) { fx.object.visible = false; pool.release(fx); continue; }
      const t = 1 - fx.lifeMs / fx.totalMs;
      fx.material.opacity = TELEGRAPH_MIN_OPACITY + (TELEGRAPH_MAX_OPACITY - TELEGRAPH_MIN_OPACITY) * t;
      if (fx.material2 !== null) fx.material2.opacity = 1;
    }
  }

  /** Vide tout (changement de partie). */
  clear() {
    this.particles.clear();
    const pools = [this.swings, this.beams, this.rings, this.telegraphs];
    for (const pool of pools) {
      for (let i = pool.activeCount - 1; i >= 0; i--) (/** @type {MeshEffect} */ (pool.active[i])).object.visible = false;
      pool.clear();
    }
  }
}
