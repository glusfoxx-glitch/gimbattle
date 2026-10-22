import { BRAWLERS, BRAWLER_COUNT } from '../shared/brawlers.js';
import { PROFS } from '../shared/profs.js';
import { ATTACK_KIND, MS_PER_SECOND, PERCENT_SCALE, DEFAULT_ROOM } from '../shared/constants.js';
import { sanitizeName, sanitizeRoom } from '../shared/protocol.js';

const STORAGE_NAME = 'gim.name';
const STORAGE_ROOM = 'gim.room';
const STORAGE_MODE = 'gim.mode';
const STORAGE_BRAWLER = 'gim.brawler';
const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

function readStore(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function writeStore(key, value) { try { localStorage.setItem(key, value); } catch {} }
function byId(id) { const el = document.getElementById(id); if (el === null) throw new Error(`Manquant: ${id}`); return el; }
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function seconds(ms) { return `${NUMBER.format(ms / MS_PER_SECOND)} s`; }

function attackFigures(def, brawler, isSuper) {
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
  constructor(onPlay, onSelect) {
    this.root = byId('menu');
    this.preview = byId('preview');
    this.nameInput = byId('name-input');
    this.roomInput = byId('room-input');
    this.btnHost = byId('btn-host');
    this.btnJoin = byId('btn-join');
    this.status = byId('menu-status');
    this.onSelect = onSelect;
    
    const stored = Number.parseInt(readStore(STORAGE_BRAWLER, '0'), 10);
    this.selected = Number.isInteger(stored) && stored >= 0 && stored < BRAWLER_COUNT ? stored : 0;
    this.viewingProf = false;
    this.viewedId = this.selected;
    this.previewRect = null;
    this.brawlerCards = [];
    this.profCards = [];

    this.nameInput.value = readStore(STORAGE_NAME, '');
    this.roomInput.value = readStore(STORAGE_ROOM, DEFAULT_ROOM);

    this.btnHost.addEventListener('click', (e) => { e.preventDefault(); this.onSelect(); this.submit(onPlay, 'host'); });
    this.btnJoin.addEventListener('click', (e) => { e.preventDefault(); this.onSelect(); this.submit(onPlay, 'join'); });

    this.maxHp = 0; this.maxSpeed = 0; this.maxRange = 0; this.maxProfDamage = 0;
    for (const b of BRAWLERS) { this.maxHp = Math.max(this.maxHp, b.hp); this.maxSpeed = Math.max(this.maxSpeed, b.speed); this.maxRange = Math.max(this.maxRange, b.main.range); }
    for (const p of PROFS) { this.maxHp = Math.max(this.maxHp, p.hp); this.maxSpeed = Math.max(this.maxSpeed, p.speed); this.maxProfDamage = Math.max(this.maxProfDamage, p.damage); }
    
    this.buildGrids();
    this.root.addEventListener('scroll', () => this.refreshRect(), { passive: true });
    this.render();
  }

  buildGrids() {
    const grid = byId('brawler-grid');
    BRAWLERS.forEach((b, id) => {
      const card = this.makeCard(b.name, b.role, b.accent);
      card.addEventListener('click', () => this.selectBrawler(id));
      grid.append(card); this.brawlerCards.push(card);
    });
    const profGrid = byId('prof-grid');
    PROFS.forEach((p, id) => {
      const card = this.makeCard(p.name, p.role, p.accent);
      card.addEventListener('click', () => this.viewProf(id));
      profGrid.append(card); this.profCards.push(card);
    });
  }

  makeCard(name, role, accent) {
    const card = el('button', 'card'); card.type = 'button'; card.style.setProperty('--accent', accent);
    card.append(el('span', 'dot'), el('span', 'card-name', name), el('span', 'card-role', role));
    return card;
  }

  selectBrawler(id) { this.selected = id; this.viewingProf = false; this.viewedId = id; writeStore(STORAGE_BRAWLER, String(id)); this.onSelect(); this.render(); }
  viewProf(id) { this.viewingProf = true; this.viewedId = id; this.onSelect(); this.render(); }

  submit(onPlay, mode) {
    const name = sanitizeName(this.nameInput.value);
    const room = sanitizeRoom(this.roomInput.value);
    this.nameInput.value = name; this.roomInput.value = room;
    writeStore(STORAGE_NAME, name); writeStore(STORAGE_ROOM, room); writeStore(STORAGE_MODE, mode);
    onPlay(name, this.selected, room, mode);
  }

  render() {
    this.brawlerCards.forEach((card, id) => card.setAttribute('aria-pressed', String(!this.viewingProf && id === this.selected)));
    this.profCards.forEach((card, id) => card.setAttribute('aria-pressed', String(this.viewingProf && id === this.viewedId)));
    if (this.viewingProf) this.renderProf(PROFS[this.viewedId]); else this.renderBrawler(BRAWLERS[this.viewedId]);
  }

  renderStats(rows) {
    const stats = byId('sel-stats'); stats.replaceChildren();
    for (const [label, value, max, text] of rows) {
      const bar = el('div', 'stat-bar'); const fill = el('div', 'stat-fill');
      fill.style.width = `${Math.round((value / max) * PERCENT_SCALE)}%`;
      bar.append(fill); stats.append(el('span', 'stat-label', label), bar, el('span', 'stat-value', text));
    }
  }

  renderAbility(prefix, name, description, figures) {
    byId(`${prefix}-block`).hidden = false; byId(`${prefix}-name`).textContent = name; byId(`${prefix}-desc`).textContent = description;
    const box = byId(`${prefix}-figures`); box.replaceChildren();
    for (const [label, value] of figures) {
      const span = el('span', ''); span.append(el('em', '', `${label} `), document.createTextNode(value)); box.append(span);
    }
  }

  renderBrawler(b) {
    byId('sel-name').textContent = b.name; byId('
