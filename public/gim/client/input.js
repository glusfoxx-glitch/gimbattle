/**
 * Entrées : clavier/souris (PC) et deux joysticks virtuels multitouch + bouton super (mobile).
 * Ce module ne produit QUE des commandes { moveX, moveY, aimAngle, aimDist, buttons } : il ne touche jamais à l'état du jeu.
 *
 * PC : déplacement par event.code (KeyW/A/S/D = ZQSD sur AZERTY, WASD sur QWERTY), visée souris, clic = tir,
 *      clic droit / Espace / E = super.
 * Mobile : joystick gauche = déplacement ; joystick droit = glisser puis relâcher pour un tir visé,
 *      tap court = tir auto-visé (cible choisie par le serveur) ; bouton SUPER = même principe.
 */
import {
  JOYSTICK_RADIUS_PX, JOYSTICK_DEADZONE_PX, TAP_MAX_MS, ATTACK_LATCH_MS, SUPER_BUTTON_RADIUS_PX, SUPER_BUTTON_X,
  SUPER_BUTTON_Y, JOYSTICK_LEFT_HOME_X, JOYSTICK_RIGHT_HOME_X, JOYSTICK_HOME_Y, BTN_ATTACK, BTN_SUPER, BTN_AUTO_AIM,
  MAX_AIM_DISTANCE, ACTION_FIRED_MAIN, ACTION_FIRED_SUPER, HALF, FLOAT_ZERO,
} from '../shared/constants.js';

/** Le bouton super accepte un appui un peu à côté : les pouces ne sont pas précis. */
const SUPER_HIT_FACTOR = 1.5;
const DEFAULT_TAP_DIST = 0.5;

/**
 * @typedef {Object} Stick
 * @property {boolean} active @property {number} id @property {number} originX @property {number} originY
 * @property {number} x @property {number} y @property {number} startTime @property {boolean} moved
 */

/** @returns {Stick} */
function createStick() {
  return { active: false, id: -1, originX: FLOAT_ZERO, originY: FLOAT_ZERO, x: FLOAT_ZERO, y: FLOAT_ZERO, startTime: FLOAT_ZERO, moved: false };
}

/**
 * @typedef {Object} AimContext
 * @property {number} playerX @property {number} playerY
 * @property {boolean} groundValid @property {number} groundX @property {number} groundY
 * @property {number} mainRange @property {number} superRange
 */

export class Input {
  /** @param {HTMLElement} target Élément qui reçoit les pointeurs (le canvas du HUD, plein écran). */
  constructor(target) {
    this.target = target;
    this.enabled = false;
    this.mode = 'mouse';
    this.up = false;
    this.down = false;
    this.left = false;
    this.right = false;
    this.mouseX = FLOAT_ZERO;
    this.mouseY = FLOAT_ZERO;
    this.mouseDown = false;
    this.hasMouse = false;
    this.moveStick = createStick();
    this.aimStick = createStick();
    this.superStick = createStick();
    this.attackLatchMs = FLOAT_ZERO;
    this.attackAim = FLOAT_ZERO;
    this.attackDist = FLOAT_ZERO;
    this.attackLocked = false;
    this.attackAuto = false;
    this.superLatchMs = FLOAT_ZERO;
    this.superAim = FLOAT_ZERO;
    this.superDist = FLOAT_ZERO;
    this.superLocked = false;
    this.superAuto = false;
    this.lastMoveAngle = FLOAT_ZERO;
    this.debugToggled = false;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.bind();
  }

  bind() {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.reset());
    const t = this.target;
    t.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    t.addEventListener('pointermove', (e) => this.onPointerMove(e));
    t.addEventListener('pointerup', (e) => this.onPointerUp(e));
    t.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    t.addEventListener('contextmenu', (e) => e.preventDefault());
    // Clic relâché hors de la fenêtre : sans ça, le tir continu resterait bloqué.
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.mouseDown = false;
    });
    // iOS : bloque le zoom par pincement même quand touch-action est ignoré.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  /** @param {boolean} enabled */
  setEnabled(enabled) {
    this.enabled = enabled;
    this.reset();
  }

  reset() {
    this.up = false; this.down = false; this.left = false; this.right = false;
    this.mouseDown = false;
    this.moveStick.active = false; this.aimStick.active = false; this.superStick.active = false;
    this.attackLatchMs = 0;
    this.superLatchMs = 0;
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
  }

  /** Centre du bouton super (pixels CSS) : utilisé aussi par le HUD pour le dessiner. */
  get superButtonX() { return this.width * SUPER_BUTTON_X; }
  get superButtonY() { return this.height * SUPER_BUTTON_Y; }
  get moveHomeX() { return this.width * JOYSTICK_LEFT_HOME_X; }
  get aimHomeX() { return this.width * JOYSTICK_RIGHT_HOME_X; }
  get homeY() { return this.height * JOYSTICK_HOME_Y; }

  /** @param {KeyboardEvent} e @param {boolean} pressed */
  onKey(e, pressed) {
    if (e.code === 'F3') {
      if (pressed) this.debugToggled = true;
      e.preventDefault();
      return;
    }
    if (!this.enabled) return;
    let handled = true;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.up = pressed; break;
      case 'KeyS': case 'ArrowDown': this.down = pressed; break;
      case 'KeyA': case 'ArrowLeft': this.left = pressed; break;
      case 'KeyD': case 'ArrowRight': this.right = pressed; break;
      case 'Space': case 'KeyE':
        if (pressed && !e.repeat) this.latchSuper(0, DEFAULT_TAP_DIST, false, false);
        break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }

  /** @param {PointerEvent} e */
  onPointerDown(e) {
    if (!this.enabled) return;
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      this.mode = 'mouse';
      this.hasMouse = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (e.button === 0) this.mouseDown = true;
      else if (e.button === 2) this.latchSuper(0, DEFAULT_TAP_DIST, false, false);
      return;
    }
    this.mode = 'touch';
    this.target.setPointerCapture(e.pointerId);
    const x = e.clientX;
    const y = e.clientY;
    const sdx = x - this.superButtonX;
    const sdy = y - this.superButtonY;
    const superReach = SUPER_BUTTON_RADIUS_PX * SUPER_HIT_FACTOR;
    if (sdx * sdx + sdy * sdy <= superReach * superReach && !this.superStick.active) {
      this.startStick(this.superStick, e.pointerId, this.superButtonX, this.superButtonY, x, y, e.timeStamp);
    } else if (x < this.width * HALF) {
      if (!this.moveStick.active) this.startStick(this.moveStick, e.pointerId, x, y, x, y, e.timeStamp);
    } else if (!this.aimStick.active) {
      this.startStick(this.aimStick, e.pointerId, x, y, x, y, e.timeStamp);
    }
  }

  /**
   * @param {Stick} s @param {number} id @param {number} ox @param {number} oy @param {number} x @param {number} y @param {number} time
   */
  startStick(s, id, ox, oy, x, y, time) {
    s.active = true; s.id = id; s.originX = ox; s.originY = oy; s.x = x; s.y = y; s.startTime = time; s.moved = false;
  }

  /** @param {PointerEvent} e */
  onPointerMove(e) {
    if (e.pointerType === 'mouse') {
      this.mode = 'mouse';
      this.hasMouse = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      return;
    }
    if (!this.enabled) return;
    const s = this.stickFor(e.pointerId);
    if (s === null) return;
    s.x = e.clientX;
    s.y = e.clientY;
    const dx = s.x - s.originX;
    const dy = s.y - s.originY;
    if (dx * dx + dy * dy > JOYSTICK_DEADZONE_PX * JOYSTICK_DEADZONE_PX) s.moved = true;
  }

  /** @param {PointerEvent} e */
  onPointerUp(e) {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.mouseDown = false;
      return;
    }
    const s = this.stickFor(e.pointerId);
    if (s === null) return;
    if (s === this.aimStick || s === this.superStick) this.releaseAim(s, e.timeStamp);
    s.active = false;
    s.id = -1;
  }

  /** @param {number} id @returns {Stick|null} */
  stickFor(id) {
    if (this.moveStick.active && this.moveStick.id === id) return this.moveStick;
    if (this.aimStick.active && this.aimStick.id === id) return this.aimStick;
    if (this.superStick.active && this.superStick.id === id) return this.superStick;
    return null;
  }

  /**
   * Relâcher un joystick de tir : visée manuelle s'il a été glissé, sinon tap = auto-visée.
   * @param {Stick} s @param {number} time
   */
  releaseAim(s, time) {
    const isSuper = s === this.superStick;
    if (s.moved) {
      const dx = s.x - s.originX;
      const dy = s.y - s.originY;
      const ratio = Math.min(1, Math.sqrt(dx * dx + dy * dy) / JOYSTICK_RADIUS_PX);
      if (isSuper) this.latchSuper(Math.atan2(dy, dx), ratio, true, false);
      else this.latchAttack(Math.atan2(dy, dx), ratio, true, false);
    } else if (time - s.startTime <= TAP_MAX_MS) {
      if (isSuper) this.latchSuper(this.lastMoveAngle, DEFAULT_TAP_DIST, false, true);
      else this.latchAttack(this.lastMoveAngle, DEFAULT_TAP_DIST, false, true);
    }
  }

  /**
   * Un tir demandé reste « armé » quelques centaines de ms : s'il tombe pendant la recharge, il part dès qu'elle finit.
   * @param {number} angle @param {number} ratio @param {boolean} locked @param {boolean} auto
   */
  latchAttack(angle, ratio, locked, auto) {
    this.attackLatchMs = ATTACK_LATCH_MS;
    this.attackAim = angle; this.attackDist = ratio; this.attackLocked = locked; this.attackAuto = auto;
  }

  /** @param {number} angle @param {number} ratio @param {boolean} locked @param {boolean} auto */
  latchSuper(angle, ratio, locked, auto) {
    this.superLatchMs = ATTACK_LATCH_MS;
    this.superAim = angle; this.superDist = ratio; this.superLocked = locked; this.superAuto = auto;
  }

  /** @param {number} dtMs */
  update(dtMs) {
    this.attackLatchMs = Math.max(0, this.attackLatchMs - dtMs);
    this.superLatchMs = Math.max(0, this.superLatchMs - dtMs);
  }

  /**
   * La prédiction a tiré : on désarme les tirs latchés correspondants.
   * @param {number} flags ACTION_*
   */
  consumeFired(flags) {
    if ((flags & ACTION_FIRED_MAIN) !== 0) this.attackLatchMs = 0;
    if ((flags & ACTION_FIRED_SUPER) !== 0) this.superLatchMs = 0;
  }

  /** @returns {boolean} Le joueur vise-t-il en ce moment (afficher le viseur au sol) ? */
  get aiming() {
    return this.mode === 'mouse' ? this.hasMouse : (this.aimStick.active && this.aimStick.moved) || (this.superStick.active && this.superStick.moved);
  }

  /** @returns {boolean} */
  get aimingSuper() {
    return this.mode === 'touch' && this.superStick.active && this.superStick.moved;
  }

  /**
   * Remplit la commande du tick.
   * @param {import('../shared/simulation.js').PlayerInput} cmd @param {AimContext} ctx
   */
  fillCommand(cmd, ctx) {
    this.fillMove(cmd);
    this.fillAim(cmd, ctx);
    let buttons = 0;
    if (this.mode === 'mouse' && this.mouseDown) buttons |= BTN_ATTACK;
    if (this.attackLatchMs > 0) {
      buttons |= BTN_ATTACK;
      if (this.attackAuto) buttons |= BTN_AUTO_AIM;
      if (this.attackLocked) { cmd.aimAngle = this.attackAim; cmd.aimDist = this.scaledDist(this.attackDist, ctx.mainRange); }
    }
    if (this.superLatchMs > 0) {
      buttons |= BTN_SUPER;
      if (this.superAuto) buttons |= BTN_AUTO_AIM;
      if (this.superLocked) { cmd.aimAngle = this.superAim; cmd.aimDist = this.scaledDist(this.superDist, ctx.superRange); }
    }
    cmd.buttons = buttons;
  }

  /** @param {import('../shared/simulation.js').PlayerInput} cmd */
  fillMove(cmd) {
    let mx = 0;
    let my = 0;
    const s = this.moveStick;
    if (s.active) {
      const dx = s.x - s.originX;
      const dy = s.y - s.originY;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > JOYSTICK_DEADZONE_PX) {
        const k = Math.min(1, len / JOYSTICK_RADIUS_PX) / len;
        mx = dx * k;
        my = dy * k;
      }
    } else {
      mx = (this.right ? 1 : 0) - (this.left ? 1 : 0);
      my = (this.down ? 1 : 0) - (this.up ? 1 : 0);
      const len = Math.sqrt(mx * mx + my * my);
      if (len > 1) { mx /= len; my /= len; }
    }
    cmd.moveX = mx;
    cmd.moveY = my;
    if (mx !== 0 || my !== 0) this.lastMoveAngle = Math.atan2(my, mx);
  }

  /**
   * @param {import('../shared/simulation.js').PlayerInput} cmd @param {AimContext} ctx
   */
  fillAim(cmd, ctx) {
    if (this.mode === 'mouse') {
      if (ctx.groundValid) {
        const dx = ctx.groundX - ctx.playerX;
        const dy = ctx.groundY - ctx.playerY;
        cmd.aimAngle = Math.atan2(dy, dx);
        cmd.aimDist = Math.min(1, Math.sqrt(dx * dx + dy * dy) / MAX_AIM_DISTANCE);
      }
      return;
    }
    const s = this.superStick.active && this.superStick.moved ? this.superStick : this.aimStick.active && this.aimStick.moved ? this.aimStick : null;
    if (s !== null) {
      const dx = s.x - s.originX;
      const dy = s.y - s.originY;
      cmd.aimAngle = Math.atan2(dy, dx);
      const ratio = Math.min(1, Math.sqrt(dx * dx + dy * dy) / JOYSTICK_RADIUS_PX);
      cmd.aimDist = this.scaledDist(ratio, s === this.superStick ? ctx.superRange : ctx.mainRange);
      return;
    }
    // Sans visée active, le perso regarde là où il marche.
    cmd.aimAngle = this.lastMoveAngle;
    cmd.aimDist = DEFAULT_TAP_DIST;
  }

  /**
   * Joystick à fond = portée maximale de l'attaque (et non MAX_AIM_DISTANCE) : la visée garde toute sa précision.
   * @param {number} ratio @param {number} range
   * @returns {number}
   */
  scaledDist(ratio, range) {
    return range > 0 ? Math.min(1, (ratio * range) / MAX_AIM_DISTANCE) : ratio;
  }

  /** @returns {boolean} F3 pressé depuis le dernier appel. */
  consumeDebugToggle() {
    const toggled = this.debugToggled;
    this.debugToggled = false;
    return toggled;
  }
}
