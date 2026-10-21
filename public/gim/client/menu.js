/**
 * Menu d'avant-partie : trombinoscope des 9 élèves, fiche (stats + capacités) et aperçu 3D tournant.
 * Tout le DOM est construit UNE fois au démarrage à partir des données (brawlers.js / profs.js) :
 * ajouter un élève dans les données l'ajoute automatiquement ici.
 */
import { BRAWLERS, BRAWLER_COUNT } from '../shared/brawlers.js';
import { PROFS } from '../shared/profs.js';
import { ATTACK_KIND, MS_PER_SECOND, PERCENT_SCALE, DEFAULT_ROOM } from '../shared/constants.js';
import { sanitizeName, sanitizeRoom } from '../shared/protocol.js';

/** @typedef {import('../shared/brawlers.js').AttackDef} AttackDef */
/** @typedef {import('../shared/brawlers.js').BrawlerDef} BrawlerDef */

const STORAGE_NAME = 'gim.name';
const STORAGE_ROOM = 'gim.room';
const STORAGE_MODE = 'gim.mode';
const STORAGE_BRAWLER = 'gim.brawler';
const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** @param {string} key @param {string} fallback @returns {string} */
function readStore(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

/** @param {string} key @param {string} value */
function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch { /* navigation privée : on s'en passe */ }
}

/** @param {string} id @returns {HTMLElement} */
function byId(id) {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`Élément #${id} manquant dans index.html`);
  return el;
}

/**
 * @param {string} tag @param {string} className @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className.length > 0) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {number} ms @returns {string} */
function seconds(ms) {
  return `${NUMBER.format(ms / MS_PER_SECOND)} s`;
}

/**
 * Chiffres clés d'une attaque, déduits des données (jamais recopiés à la main).
 * @param {AttackDef} def @param {BrawlerDef} brawler @param {boolean} isSuper
 * @returns {Array<[string, string]>} Paires [libellé, valeur].
 */
function attackFigures(def, brawler, isSuper) {
  /** @type {Array<[string, string]>} */
  const out = [];
  if (def.damage > 0) out.push(['Dégâts', def.count > 1 ? `${NUMBER.format(def.damage)} × ${def.count}` : NUMBER.format(def.damage)]);
  if (def.zoneDps > 0) out.push(['Zone', `${NUMBER.format(def.zoneDps)} / s pendant ${seconds(def.zoneMs)}`]);
  if (def.heal > 0) out.push(['Soin allié', NUMBER.format(def.heal)]);
  if (def.slowMs > 0) out.push(['Ralentit', `${Math.round((1 - def.slowFactor) * PERCENT_SCALE)} % pendant ${seconds(def.slowMs)}`]);
  if (def.stunMs > 0) out.push(['Étourdit', seconds(def.stunMs)]);
  if (def.zoneBlindMs > 0) out.push(['Aveugle', 'dans le nuage']);
  if (def.speedMultiplier !== 1) out.push(['Vitesse', `+${Math.round((def.speedMultiplier - 1) * PERCENT_SCALE)} % pendant ${seconds(def.buffMs)}`]);
  if (def.invisible) out.push(['Invisible', seconds(def.buffMs)]);
  if (def.range > 0 && def.kind !== ATTACK_KIND.BUFF) out.push(['Portée', `${NUMBER.format(def.range)} m`]);
  if (!isSuper) out.push(['Recharge', seconds(def.cooldownMs)]);
  else out.push(['Charge', brawler.superChargeDamage > 0 ? `${seconds(brawler.superRechargeMs)} ou plus vite en touchant` : seconds(brawler.superRechargeMs)]);
  return out;
}

export class Menu {
  /**
   * @param {(name: string, brawler: number, room: string, mode: string) => void} onPlay
   * @param {() => void} onSelect Son de sélection.
   */
  constructor(onPlay, onSelect) {
    this.root = byId('menu');
    this.preview = byId('preview');
    this.nameInput = /** @type {HTMLInputElement} */ (byId('name-input'));
    this.roomInput = /** @type {HTMLInputElement} */ (byId('room-input'));
    this.modeInput = /** @type {HTMLInputElement} */ (byId('mode-input'));
    /** @type {HTMLButtonElement[]} */
    this.modeButtons = Array.from(this.root.querySelectorAll('.mode-opt'));
    this.playButton = /** @type {HTMLButtonElement} */ (byId('play-btn'));
    this.status = byId('menu-status');
    this.onSelect = onSelect;
    const stored = Number.parseInt(readStore(STORAGE_BRAWLER, '0'), 10);
    this.selected = Number.isInteger(stored) && stored >= 0 && stored < BRAWLER_COUNT ? stored : 0;
    this.viewingProf = false;
    this.viewedId = this.selected;
    /** @type {DOMRect|null} */
    this.previewRect = null;
    /** @type {HTMLButtonElement[]} */
    this.brawlerCards = [];
    /** @type {HTMLButtonElement[]} */
    this.profCards = [];

    this.nameInput.value = readStore(STORAGE_NAME, '');
    this.roomInput.value = readStore(STORAGE_ROOM, DEFAULT_ROOM);
    this.setMode(readStore(STORAGE_MODE, 'host') === 'join' ? 'join' : 'host');
    for (const button of this.modeButtons) {
      button.addEventListener('click', () => { this.setMode(button.dataset.mode === 'join' ? 'join' : 'host'); this.onSelect(); });
    }
    this.maxHp = 0;
    this.maxSpeed = 0;
    this.maxRange = 0;
    this.maxProfDamage = 0;
    for (const b of BRAWLERS) {
      this.maxHp = Math.max(this.maxHp, b.hp);
      this.maxSpeed = Math.max(this.maxSpeed, b.speed);
      this.maxRange = Math.max(this.maxRange, b.main.range);
    }
    for (const p of PROFS) {
      this.maxHp = Math.max(this.maxHp, p.hp);
      this.maxSpeed = Math.max(this.maxSpeed, p.speed);
      this.maxProfDamage = Math.max(this.maxProfDamage, p.damage);
    }
    this.buildGrids();
    // En portrait le menu défile : le cadre d'aperçu bouge, on remesure sa position.
    this.root.addEventListener('scroll', () => this.refreshRect(), { passive: true });
    byId('join-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit(onPlay);
    });
    this.render();
  }

  buildGrids() {
    const grid = byId('brawler-grid');
    BRAWLERS.forEach((b, id) => {
      const card = this.makeCard(b.name, b.role, b.accent);
      card.addEventListener('click', () => this.selectBrawler(id));
      grid.append(card);
      this.brawlerCards.push(card);
    });
    const profGrid = byId('prof-grid');
    PROFS.forEach((p, id) => {
      const card = this.makeCard(p.name, p.role, p.accent);
      card.addEventListener('click', () => this.viewProf(id));
      profGrid.append(card);
      this.profCards.push(card);
    });
  }

  /**
   * @param {string} name @param {string} role @param {string} accent
   * @returns {HTMLButtonElement}
   */
  makeCard(name, role, accent) {
    const card = /** @type {HTMLButtonElement} */ (el('button', 'card'));
    card.type = 'button';
    card.style.setProperty('--accent', accent);
    card.append(el('span', 'dot'), el('span', 'card-name', name), el('span', 'card-role', role));
    return card;
  }

  /** @param {number} id */
  selectBrawler(id) {
    this.selected = id;
    this.viewingProf = false;
    this.viewedId = id;
    writeStore(STORAGE_BRAWLER, String(id));
    this.onSelect();
    this.render();
  }

  /** @param {number} id */
  viewProf(id) {
    this.viewingProf = true;
    this.viewedId = id;
    this.onSelect();
    this.render();
  }

  /**
   * Choix « Créer / Rejoindre » : deux gros boutons bien visibles (le menu déroulant passait inaperçu, surtout sur mobile).
   * @param {'host'|'join'} mode
   */
  setMode(mode) {
    this.modeInput.value = mode;
    for (const button of this.modeButtons) {
      const on = button.dataset.mode === mode;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    this.roomInput.placeholder = mode === 'join' ? "code de l'hôte" : 'ton code';
    this.refreshPlayLabel();
  }

  refreshPlayLabel() {
    if (this.playButton === undefined || this.selected === undefined) return;
    const name = BRAWLERS[this.selected].name;
    this.playButton.textContent = this.modeInput.value === 'join' ? `Rejoindre avec ${name}` : `Créer avec ${name}`;
  }

  /** @param {(name: string, brawler: number, room: string, mode: string) => void} onPlay */
  submit(onPlay) {
    const name = sanitizeName(this.nameInput.value);
    const room = sanitizeRoom(this.roomInput.value);
    this.nameInput.value = name;
    this.roomInput.value = room;
    writeStore(STORAGE_NAME, name);
    writeStore(STORAGE_ROOM, room);
    const mode = this.modeInput.value === 'join' ? 'join' : 'host';
    writeStore(STORAGE_MODE, mode);
    onPlay(name, this.selected, room, mode);
  }

  render() {
    this.brawlerCards.forEach((card, id) => card.setAttribute('aria-pressed', String(!this.viewingProf && id === this.selected)));
    this.profCards.forEach((card, id) => card.setAttribute('aria-pressed', String(this.viewingProf && id === this.viewedId)));
    this.refreshPlayLabel();
    if (this.viewingProf) this.renderProf(PROFS[this.viewedId]);
    else this.renderBrawler(BRAWLERS[this.viewedId]);
  }

  /**
   * @param {Array<[string, number, number, string]>} rows Libellé, valeur, max, texte.
   */
  renderStats(rows) {
    const stats = byId('sel-stats');
    stats.replaceChildren();
    for (const [label, value, max, text] of rows) {
      const bar = el('div', 'stat-bar');
      const fill = el('div', 'stat-fill');
      fill.style.width = `${Math.round((value / max) * PERCENT_SCALE)}%`;
      bar.append(fill);
      stats.append(el('span', 'stat-label', label), bar, el('span', 'stat-value', text));
    }
  }

  /**
   * @param {string} prefix @param {string} name @param {string} description @param {Array<[string, string]>} figures
   */
  renderAbility(prefix, name, description, figures) {
    byId(`${prefix}-block`).hidden = false;
    byId(`${prefix}-name`).textContent = name;
    byId(`${prefix}-desc`).textContent = description;
    const box = byId(`${prefix}-figures`);
    box.replaceChildren();
    for (const [label, value] of figures) {
      const span = el('span', '');
      span.append(el('em', '', `${label} `), document.createTextNode(value));
      box.append(span);
    }
  }

  /** @param {BrawlerDef} b */
  renderBrawler(b) {
    byId('sel-name').textContent = b.name;
    byId('sel-role').textContent = b.role;
    this.renderStats([
      ['PV', b.hp, this.maxHp, NUMBER.format(b.hp)],
      ['Vitesse', b.speed, this.maxSpeed, `${NUMBER.format(b.speed)} m/s`],
      ['Portée', b.main.range, this.maxRange, `${NUMBER.format(b.main.range)} m`],
    ]);
    this.renderAbility('main', b.main.name, b.main.description, attackFigures(b.main, b, false));
    this.renderAbility('super', b.super.name, b.super.description, attackFigures(b.super, b, true));
  }

  /** @param {import('../shared/profs.js').ProfDef} p */
  renderProf(p) {
    byId('sel-name').textContent = p.name;
    byId('sel-role').textContent = p.role;
    this.renderStats([
      ['PV', p.hp, this.maxHp, NUMBER.format(p.hp)],
      ['Vitesse', p.speed, this.maxSpeed, `${NUMBER.format(p.speed)} m/s`],
      ['Dégâts', p.damage, this.maxProfDamage, NUMBER.format(p.damage)],
    ]);
    this.renderAbility('main', 'Comportement', p.description, [['Annonce son coup', seconds(p.windupMs)], ['Récupère', seconds(p.cooldownMs)]]);
    byId('super-block').hidden = true;
  }

  /** Mémorise la zone d'aperçu (appelé au redimensionnement, pas à chaque frame : getBoundingClientRect alloue). */
  refreshRect() {
    this.previewRect = this.root.hidden ? null : this.preview.getBoundingClientRect();
  }

  show() {
    this.root.hidden = false;
    this.setBusy(false);
    this.refreshRect();
  }

  hide() {
    this.root.hidden = true;
    this.previewRect = null;
  }

  /** @param {string} text @param {boolean} isError */
  setStatus(text, isError) {
    this.status.textContent = text;
    this.status.classList.toggle('error', isError);
  }

  /** @param {boolean} busy */
  setBusy(busy) {
    this.playButton.disabled = busy;
  }
}
