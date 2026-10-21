/**
 * Interface en jeu dessinée sur un canvas 2D par-dessus la 3D : barres de vie, noms, chiffres de dégâts,
 * score et chrono, fil des K.O., bannières, joysticks tactiles, jauge de super, overlay de debug (F3).
 * Aucun élément DOM créé pendant la partie, aucune chaîne construite par frame (textes pré-calculés ou mis en cache).
 */
import { Pool } from '../shared/pool.js';
import {
  MAX_PLAYERS, MAX_BOTS, MAX_DAMAGE_NUMBERS, DAMAGE_NUMBER_LIFE_MS, DAMAGE_NUMBER_RISE, TEAM_CSS, TEAM_NAMES,
  TEAM_A, TEAM_B, TEAM_BOTS, DAMAGE_CSS, HUD_MARGIN, HUD_FONT, HUD_FONT_SMALL, HUD_FONT_BIG, HUD_FONT_HUGE,
  HUD_FONT_DAMAGE, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT, HEALTH_BAR_OFFSET_Y, KILL_FEED_SIZE, KILL_FEED_LIFE_MS,
  KILL_FEED_LINE, DEBUG_LINE, BLIND_VISIBLE_RADIUS, FPS_SMOOTHING, MAX_CACHED_NUMBER, ROUND_DURATION_MS, MAX_ROUND_DURATION_MS,
  ROUND_PHASE_ENDED, RESPAWN_MS, JOYSTICK_RADIUS_PX, JOYSTICK_KNOB_PX, SUPER_BUTTON_RADIUS_PX, SUPER_MAX,
  PF_DEAD, PF_INVISIBLE, PF_BLIND, BOT_STATE, MS_PER_SECOND, HALF, TWO_PI, FLOAT_ZERO,
} from '../shared/constants.js';
import { PROFS } from '../shared/profs.js';

/** @typedef {import('./net.js').Views} Views */
/** @typedef {import('./renderer.js').Renderer} Renderer */
/** @typedef {import('./input.js').Input} Input */

const SECONDS_PER_MINUTE = 60;
const TEXT_OUTLINE = 4;
const LOCAL_CSS = '#ffe14d';
const BAR_BG = 'rgba(0,0,0,0.55)';
const PANEL_BG = 'rgba(10,14,24,0.62)';
const LABEL_GAP = 6;
const BANNER_DEFAULT_MS = 3000;
const SUPER_READY_CSS = '#ffd23f';
const STICK_BASE_ALPHA = 0.18;
const STICK_IDLE_ALPHA = 0.08;
const LOW_HP_RATIO = 0.3;
const LOW_HP_CSS = '#ff6b6b';
const WINDUP_CSS = '#ff3b3b';
const DEBUG_VALUE_X = 120;
const DEBUG_WIDTH = 220;
const DEBUG_ROWS = 13;
const MAX_DPR_HUD = 3;
const CM_PER_M = 100;
const DAMAGE_POP_SCALE = 0.35;

/**
 * @typedef {Object} DamageNumber
 * @property {number} poolIndex @property {number} activeIndex @property {number} serial
 * @property {number} x @property {number} y @property {number} height @property {string} text
 * @property {string} color @property {number} lifeMs
 */

/**
 * @typedef {Object} FeedEntry
 * @property {number} timeMs @property {string} killer @property {string} victim
 * @property {string} killerColor @property {string} victimColor @property {number} killerWidth @property {number} victimWidth
 */

/**
 * @typedef {Object} DebugInfo
 * @property {number} ping @property {number} serverTick @property {number} pendingInputs @property {number} correction
 * @property {number} particles @property {number} particleCapacity @property {number} drawCalls
 */

export class Hud {
  /**
   * @param {HTMLCanvasElement} canvas @param {Renderer} renderer @param {Input} input
   */
  constructor(canvas, renderer, input) {
    this.canvas = canvas;
    this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    this.renderer = renderer;
    this.input = input;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.debug = false;
    this.fps = 60;
    this.screen = { x: FLOAT_ZERO, y: FLOAT_ZERO };
    this.damage = new Pool(MAX_DAMAGE_NUMBERS, () => ({
      poolIndex: 0, activeIndex: -1, serial: 0, x: FLOAT_ZERO, y: FLOAT_ZERO, height: FLOAT_ZERO, text: '', color: DAMAGE_CSS, lifeMs: FLOAT_ZERO,
    }));
    /** @type {FeedEntry[]} */
    this.feed = [];
    for (let i = 0; i < KILL_FEED_SIZE; i++) this.feed.push({ timeMs: -Infinity, killer: '', victim: '', killerColor: '', victimColor: '', killerWidth: 0, victimWidth: 0 });
    this.feedHead = 0;
    this.bannerText = '';
    this.bannerSub = '';
    this.bannerColor = '#ffffff';
    this.bannerUntil = -Infinity;
    this.toastText = '';
    this.toastUntil = -Infinity;
    /** Chaînes pré-calculées : aucune concaténation pendant la partie. */
    /** @type {(string|undefined)[]} */
    this.numbers = new Array(MAX_CACHED_NUMBER + 1);
    /** @type {string[]} */
    this.timerTexts = [];
    for (let s = 0; s <= MAX_ROUND_DURATION_MS / MS_PER_SECOND; s++) {
      const sec = s % SECONDS_PER_MINUTE;
      this.timerTexts.push(`${Math.floor(s / SECONDS_PER_MINUTE)}:${sec < 10 ? '0' : ''}${sec}`);
    }
    /** @type {string[]} */
    this.respawnTexts = [];
    for (let s = 0; s <= Math.ceil(RESPAWN_MS / MS_PER_SECOND); s++) this.respawnTexts.push(`Retour en jeu dans ${s}…`);
    this.vignette = document.createElement('canvas');
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR_HUD);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.buildVignette();
  }

  /** Voile d'aveuglement (nuage lacrymogène) pré-rendu une fois par taille d'écran. */
  buildVignette() {
    const v = this.vignette;
    v.width = this.width;
    v.height = this.height;
    const ctx = /** @type {CanvasRenderingContext2D} */ (v.getContext('2d'));
    const r = Math.min(this.width, this.height);
    const g = ctx.createRadialGradient(this.width * HALF, this.height * HALF, r * BLIND_VISIBLE_RADIUS, this.width * HALF, this.height * HALF, r * 0.7);
    g.addColorStop(0, 'rgba(60,80,20,0)');
    g.addColorStop(0.4, 'rgba(60,80,20,0.85)');
    g.addColorStop(1, 'rgba(30,40,10,0.97)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /**
   * Entier → chaîne, avec cache paresseux (une allocation par valeur distincte, puis plus jamais).
   * @param {number} n
   * @returns {string}
   */
  numberText(n) {
    const v = n < 0 ? 0 : n > MAX_CACHED_NUMBER ? MAX_CACHED_NUMBER : Math.round(n);
    let s = this.numbers[v];
    if (s === undefined) { s = String(v); this.numbers[v] = s; }
    return s;
  }

  // ==========================================================================
  // ÉVÉNEMENTS (appelés par main.js)
  // ==========================================================================

  /**
   * @param {number} x @param {number} y @param {number} height @param {number} value @param {string} color
   */
  addDamage(x, y, height, value, color) {
    const d = this.damage.acquire();
    d.x = x; d.y = y; d.height = height; d.text = this.numberText(value); d.color = color; d.lifeMs = DAMAGE_NUMBER_LIFE_MS;
  }

  /**
   * @param {string} killer @param {string} killerColor @param {string} victim @param {string} victimColor @param {number} now
   */
  addKill(killer, killerColor, victim, victimColor, now) {
    const e = this.feed[this.feedHead];
    this.feedHead = (this.feedHead + 1) % KILL_FEED_SIZE;
    this.ctx.font = HUD_FONT;
    e.timeMs = now; e.killer = killer; e.victim = victim; e.killerColor = killerColor; e.victimColor = victimColor;
    // Mesures faites ici (événement rare) plutôt qu'à chaque frame.
    e.killerWidth = killer.length > 0 ? this.ctx.measureText(killer).width : 0;
    e.victimWidth = this.ctx.measureText(victim).width;
  }

  /**
   * @param {string} text @param {string} sub @param {string} color @param {number} now @param {number} [durationMs]
   */
  showBanner(text, sub, color, now, durationMs = BANNER_DEFAULT_MS) {
    this.bannerText = text; this.bannerSub = sub; this.bannerColor = color; this.bannerUntil = now + durationMs;
  }

  /** @param {string} text @param {number} now @param {number} durationMs */
  showToast(text, now, durationMs) {
    this.toastText = text;
    this.toastUntil = now + durationMs;
  }

  /** Efface le canvas (retour au menu : il ne doit rien rester par-dessus le tableau noir). */
  wipe() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  clear() {
    this.damage.clear();
    for (let i = 0; i < KILL_FEED_SIZE; i++) this.feed[i].timeMs = -Infinity;
    this.bannerUntil = -Infinity;
    this.toastUntil = -Infinity;
  }

  // ==========================================================================
  // DESSIN
  // ==========================================================================

  /**
   * @param {Views} views @param {import('./net.js').RosterEntry[]} roster @param {number} superCharge
   * @param {number} respawnMs @param {number} dt @param {number} now @param {DebugInfo} debugInfo
   */
  draw(views, roster, superCharge, respawnMs, dt, now, debugInfo) {
    const ctx = this.ctx;
    if (dt > 0) this.fps += (1 / dt - this.fps) * FPS_SMOOTHING;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.lineJoin = 'round';
    const local = views.localSlot >= 0 ? views.players[views.localSlot] : null;
    if (local !== null && (local.flags & PF_BLIND) !== 0) ctx.drawImage(this.vignette, 0, 0, this.width, this.height);
    this.drawPlayerLabels(views, roster);
    this.drawBotLabels(views);
    this.drawDamage(dt);
    this.drawScore(views);
    this.drawFeed(now);
    if (local !== null && (local.flags & PF_DEAD) !== 0) this.drawCenterText(this.respawnTexts[Math.max(0, Math.ceil(respawnMs / MS_PER_SECOND))] ?? '', HUD_FONT_BIG, '#ffffff', this.height * 0.35);
    if (now < this.bannerUntil) this.drawBanner();
    if (now < this.toastUntil) this.drawCenterText(this.toastText, HUD_FONT, '#ffd6a0', this.height * 0.2);
    if (this.input.mode === 'touch') this.drawTouchControls(superCharge);
    else this.drawSuperMeter(superCharge);
    if (this.debug) this.drawDebug(views, debugInfo);
  }

  /**
   * Texte avec contour sombre : lisible sur n'importe quel fond.
   * @param {string} text @param {number} x @param {number} y @param {string} color
   */
  outlined(text, x, y, color) {
    const ctx = this.ctx;
    ctx.lineWidth = TEXT_OUTLINE;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /**
   * @param {number} cx @param {number} cy @param {number} ratio @param {string} color
   */
  healthBar(cx, cy, ratio, color) {
    const ctx = this.ctx;
    const x = cx - HEALTH_BAR_WIDTH * HALF;
    ctx.fillStyle = BAR_BG;
    ctx.fillRect(x - 1, cy - 1, HEALTH_BAR_WIDTH + 2, HEALTH_BAR_HEIGHT + 2);
    ctx.fillStyle = ratio < LOW_HP_RATIO ? LOW_HP_CSS : color;
    ctx.fillRect(x, cy, HEALTH_BAR_WIDTH * Math.max(0, Math.min(1, ratio)), HEALTH_BAR_HEIGHT);
  }

  /** @param {Views} views @param {import('./net.js').RosterEntry[]} roster */
  drawPlayerLabels(views, roster) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = HUD_FONT_SMALL;
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const v = views.players[slot];
      if (!v.active || (v.flags & PF_DEAD) !== 0) continue;
      const top = this.renderer.playerTop(slot) + v.air * 3;
      if (!this.renderer.worldToScreen(v.x, top, v.y, this.screen)) continue;
      const isLocal = slot === views.localSlot;
      const color = isLocal ? LOCAL_CSS : TEAM_CSS[v.team];
      ctx.globalAlpha = (v.flags & PF_INVISIBLE) !== 0 ? HALF : 1;
      this.healthBar(this.screen.x, this.screen.y - HEALTH_BAR_OFFSET_Y, v.hp / v.maxHp, color);
      const name = roster[slot].active ? roster[slot].name : '';
      this.outlined(name, this.screen.x, this.screen.y - HEALTH_BAR_OFFSET_Y - LABEL_GAP * HALF, color);
    }
    ctx.globalAlpha = 1;
  }

  /** @param {Views} views */
  drawBotLabels(views) {
    const ctx = this.ctx;
    for (let slot = 0; slot < MAX_BOTS; slot++) {
      const v = views.bots[slot];
      if (!v.active) continue;
      if (!this.renderer.worldToScreen(v.x, this.renderer.botTop(slot), v.y, this.screen)) continue;
      ctx.font = HUD_FONT_SMALL;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      this.healthBar(this.screen.x, this.screen.y - HEALTH_BAR_OFFSET_Y, v.hp / v.maxHp, TEAM_CSS[TEAM_BOTS]);
      this.outlined(PROFS[v.type].name, this.screen.x, this.screen.y - HEALTH_BAR_OFFSET_Y - LABEL_GAP * HALF, TEAM_CSS[TEAM_BOTS]);
      if (v.state === BOT_STATE.WINDUP) {
        ctx.font = HUD_FONT_HUGE;
        this.outlined('!', this.screen.x, this.screen.y - HEALTH_BAR_OFFSET_Y * 2.5, WINDUP_CSS);
      }
    }
  }

  /** @param {number} dt */
  drawDamage(dt) {
    const ctx = this.ctx;
    const pool = this.damage;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = HUD_FONT_DAMAGE;
    for (let i = pool.activeCount - 1; i >= 0; i--) {
      const d = /** @type {DamageNumber} */ (pool.active[i]);
      d.lifeMs -= dt * MS_PER_SECOND;
      if (d.lifeMs <= 0) { pool.release(d); continue; }
      const t = 1 - d.lifeMs / DAMAGE_NUMBER_LIFE_MS;
      if (!this.renderer.worldToScreen(d.x, d.height + t * DAMAGE_NUMBER_RISE, d.y, this.screen)) continue;
      ctx.globalAlpha = Math.min(1, (d.lifeMs / DAMAGE_NUMBER_LIFE_MS) * 2);
      const pop = 1 + DAMAGE_POP_SCALE * Math.max(0, 1 - t * 4);
      ctx.setTransform(this.dpr * pop, 0, 0, this.dpr * pop, this.screen.x * this.dpr, this.screen.y * this.dpr);
      this.outlined(d.text, 0, 0, d.color);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
  }

  /** @param {Views} views */
  drawScore(views) {
    const ctx = this.ctx;
    const cx = this.width * HALF;
    const y = HUD_MARGIN;
    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(cx - 150, y, 300, 46);
    ctx.textBaseline = 'top';
    ctx.font = HUD_FONT_BIG;
    ctx.textAlign = 'right';
    this.outlined(this.numberText(views.scoreA), cx - 40, y + 4, TEAM_CSS[TEAM_A]);
    ctx.textAlign = 'left';
    this.outlined(this.numberText(views.scoreB), cx + 40, y + 4, TEAM_CSS[TEAM_B]);
    ctx.textAlign = 'center';
    const seconds = Math.max(0, Math.min(this.timerTexts.length - 1, Math.ceil(views.roundMs / MS_PER_SECOND)));
    this.outlined(views.roundPhase === ROUND_PHASE_ENDED ? '—' : this.timerTexts[seconds], cx, y + 4, '#ffffff');
    ctx.font = HUD_FONT_SMALL;
    ctx.textAlign = 'right';
    this.outlined(TEAM_NAMES[TEAM_A], cx - 82, y + 9, TEAM_CSS[TEAM_A]);
    ctx.textAlign = 'left';
    this.outlined(TEAM_NAMES[TEAM_B], cx + 82, y + 9, TEAM_CSS[TEAM_B]);
    if (views.localSlot >= 0) {
      ctx.textAlign = 'center';
      this.outlined(views.localTeam === TEAM_A ? 'Ton équipe : BLEUS' : 'Ton équipe : ROUGES', cx, y + 30, TEAM_CSS[views.localTeam]);
    }
  }

  /** @param {number} now */
  drawFeed(now) {
    const ctx = this.ctx;
    ctx.font = HUD_FONT;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    let line = 0;
    for (let k = 1; k <= KILL_FEED_SIZE; k++) {
      const e = this.feed[(this.feedHead - k + KILL_FEED_SIZE) % KILL_FEED_SIZE];
      if (now - e.timeMs > KILL_FEED_LIFE_MS) continue;
      const y = HUD_MARGIN + line * KILL_FEED_LINE;
      const arrow = 22;
      let x = this.width - HUD_MARGIN - e.victimWidth - arrow - e.killerWidth;
      if (e.killerWidth > 0) { this.outlined(e.killer, x, y, e.killerColor); x += e.killerWidth; }
      this.outlined(' ✖ ', x, y, '#ffffff');
      this.outlined(e.victim, x + arrow, y, e.victimColor);
      line++;
    }
  }

  /** @param {string} text @param {string} font @param {string} color @param {number} y */
  drawCenterText(text, font, color, y) {
    const ctx = this.ctx;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.outlined(text, this.width * HALF, y, color);
  }

  drawBanner() {
    this.drawCenterText(this.bannerText, HUD_FONT_HUGE, this.bannerColor, this.height * 0.42);
    if (this.bannerSub.length > 0) this.drawCenterText(this.bannerSub, HUD_FONT, '#ffffff', this.height * 0.42 + 40);
  }

  /** @param {number} superCharge */
  drawSuperMeter(superCharge) {
    const ctx = this.ctx;
    const w = 220;
    const h = 12;
    const x = this.width * HALF - w * HALF;
    const y = this.height - HUD_MARGIN - h - 18;
    const ready = superCharge >= SUPER_MAX;
    ctx.fillStyle = BAR_BG;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = ready ? SUPER_READY_CSS : '#c9a227';
    ctx.fillRect(x, y, w * Math.min(1, superCharge / SUPER_MAX), h);
    ctx.font = HUD_FONT_SMALL;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    this.outlined(ready ? 'SUPER PRÊTE ! (clic droit / Espace)' : 'SUPER', this.width * HALF, y - 4, ready ? SUPER_READY_CSS : '#dddddd');
  }

  /**
   * @param {number} cx @param {number} cy @param {number} kx @param {number} ky @param {number} alpha @param {string} label
   */
  stick(cx, cy, kx, ky, alpha, label) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, JOYSTICK_RADIUS_PX, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = Math.min(1, alpha * 3);
    ctx.beginPath();
    ctx.arc(kx, ky, JOYSTICK_KNOB_PX, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (label.length > 0) {
      ctx.font = HUD_FONT_SMALL;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      this.outlined(label, cx, cy + JOYSTICK_RADIUS_PX + 12, 'rgba(255,255,255,0.7)');
    }
  }

  /**
   * @param {import('./input.js').Stick} s @param {number} homeX @param {string} label
   */
  drawStick(s, homeX, label) {
    if (!s.active) {
      this.stick(homeX, this.input.homeY, homeX, this.input.homeY, STICK_IDLE_ALPHA, label);
      return;
    }
    let dx = s.x - s.originX;
    let dy = s.y - s.originY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > JOYSTICK_RADIUS_PX) { dx *= JOYSTICK_RADIUS_PX / len; dy *= JOYSTICK_RADIUS_PX / len; }
    this.stick(s.originX, s.originY, s.originX + dx, s.originY + dy, STICK_BASE_ALPHA, '');
  }

  /** @param {number} superCharge */
  drawTouchControls(superCharge) {
    const ctx = this.ctx;
    const input = this.input;
    this.drawStick(input.moveStick, input.moveHomeX, 'BOUGER');
    this.drawStick(input.aimStick, input.aimHomeX, 'TIRER');
    const bx = input.superButtonX;
    const by = input.superButtonY;
    const ready = superCharge >= SUPER_MAX;
    ctx.globalAlpha = ready ? 0.9 : 0.45;
    ctx.fillStyle = 'rgba(20,20,30,0.8)';
    ctx.beginPath();
    ctx.arc(bx, by, SUPER_BUTTON_RADIUS_PX, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = SUPER_READY_CSS;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(bx, by, SUPER_BUTTON_RADIUS_PX - 3, -Math.PI * HALF, -Math.PI * HALF + TWO_PI * Math.min(1, superCharge / SUPER_MAX));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = HUD_FONT_SMALL;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.outlined('SUPER', bx, by, ready ? SUPER_READY_CSS : '#bbbbbb');
    const s = input.superStick;
    if (s.active && s.moved) {
      let dx = s.x - s.originX;
      let dy = s.y - s.originY;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > JOYSTICK_RADIUS_PX) { dx *= JOYSTICK_RADIUS_PX / len; dy *= JOYSTICK_RADIUS_PX / len; }
      ctx.fillStyle = SUPER_READY_CSS;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(bx + dx, by + dy, JOYSTICK_KNOB_PX * 0.8, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /**
   * @param {string} label @param {string} value @param {number} row
   */
  debugRow(label, value, row) {
    const ctx = this.ctx;
    const y = HUD_MARGIN + 60 + row * DEBUG_LINE;
    ctx.fillStyle = '#9fb3c8';
    ctx.fillText(label, HUD_MARGIN + 8, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(value, HUD_MARGIN + 8 + DEBUG_VALUE_X, y);
  }

  /** @param {Views} views @param {DebugInfo} info */
  drawDebug(views, info) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(HUD_MARGIN, HUD_MARGIN + 54, DEBUG_WIDTH, DEBUG_ROWS * DEBUG_LINE + 12);
    ctx.font = HUD_FONT_SMALL;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let players = 0;
    for (let i = 0; i < MAX_PLAYERS; i++) if (views.players[i].active) players++;
    let bots = 0;
    for (let i = 0; i < MAX_BOTS; i++) if (views.bots[i].active) bots++;
    let row = 0;
    this.debugRow('FPS', this.numberText(this.fps), row++);
    this.debugRow('Ping (ms)', this.numberText(info.ping), row++);
    this.debugRow('Tick serveur', this.numberText(info.serverTick % (MAX_CACHED_NUMBER + 1)), row++);
    this.debugRow('Joueurs', this.numberText(players), row++);
    this.debugRow('Profs', this.numberText(bots), row++);
    this.debugRow('Projectiles', this.numberText(views.projectileCount), row++);
    this.debugRow('Zones', this.numberText(views.zoneCount), row++);
    this.debugRow('Particules', this.numberText(info.particles), row++);
    this.debugRow('Pool particules', this.numberText(info.particleCapacity), row++);
    this.debugRow('Chiffres dégâts', this.numberText(this.damage.activeCount), row++);
    this.debugRow('Inputs non confirmés', this.numberText(info.pendingInputs), row++);
    this.debugRow('Correction (cm)', this.numberText(info.correction * CM_PER_M), row++);
    this.debugRow('Appels de dessin', this.numberText(info.drawCalls), row++);
  }
}
