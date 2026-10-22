import { BRAWLERS } from '../shared/brawlers.js';
import { MAP_NAMES, ROUND_DURATION_CHOICES_MIN } from '../shared/constants.js';

function node(tag, cls, text) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Lobby {
  constructor(onPick, onSettings, onStart, onLeave) {
    this.root = node('main', 'lobby');
    this.root.hidden = true;
    const header = node('header', 'lobby-header');
    const brand = node('img', 'lobby-logo');
    brand.src = 'logo.png'; brand.alt = 'GIM Battle';
    const heading = node('div', '');
    heading.append(node('p', 'hand lobby-eyebrow', 'Salon d’attente'));
    this.code = node('h1', 'lobby-code'); heading.append(this.code);
    const leave = node('button', 'results-close', 'Quitter');
    leave.type = 'button'; leave.addEventListener('click', onLeave);
    header.append(brand, heading, leave);
    const content = node('div', 'lobby-content');
    const roster = node('section', 'lobby-roster');
    this.count = node('h2', 'hand section-title');
    this.players = node('ul', 'lobby-players');
    roster.append(this.count, this.players);
    const settings = node('section', 'lobby-settings');
    settings.append(node('h2', 'hand section-title', 'La prochaine partie'));
    const durationLabel = node('label', 'field', 'Durée de la manche');
    this.duration = node('select', 'lobby-select');
    this.duration.setAttribute('aria-label', 'Durée de la manche');
    for (const minutes of ROUND_DURATION_CHOICES_MIN) {
      const opt = node('option', '', `${minutes} minute${minutes > 1 ? 's' : ''}`);
      opt.value = String(minutes); this.duration.append(opt);
    }
    durationLabel.append(this.duration);
    const mapLabel = node('label', 'field', 'Carte');
    this.map = node('select', 'lobby-select'); this.map.setAttribute('aria-label', 'Carte');
    [...MAP_NAMES, 'Les deux · alternance'].forEach((name, i) => {
      const opt = node('option', '', name); opt.value = String(i); this.map.append(opt);
    });
    mapLabel.append(this.map);
    const changed = () => onSettings(Number(this.duration.value), Number(this.map.value));
    this.duration.addEventListener('change', changed); this.map.addEventListener('change', changed);
    this.authority = node('p', 'lobby-authority');
    this.start = node('button', 'play', 'Lancer la partie'); this.start.type = 'button';
    this.start.addEventListener('click', onStart);
    settings.append(durationLabel, mapLabel, this.authority, this.start);
    content.append(roster, settings);
    const picks = node('section', 'lobby-picks');
    picks.append(node('h2', 'hand section-title', 'Ton personnage'));
    const grid = node('div', 'lobby-pick-grid');
    this.buttons = BRAWLERS.map((b) => {
      const btn = node('button', 'card', b.name); btn.type = 'button';
      btn.addEventListener('click', () => onPick(b.id)); grid.append(btn); return btn;
    });
    picks.append(grid);
    this.root.append(header, content, picks); document.body.append(this.root);
  }
  show(data, room) {
    this.code.textContent = `Code : ${room}`;
    this.count.textContent = `${data.players.length} joueur${data.players.length > 1 ? 's' : ''}`;
    this.players.replaceChildren();
    for (const p of data.players) {
      const row = node('li', p.id === data.you ? 'lobby-player is-me' : 'lobby-player');
      row.append(node('strong', '', `${p.name}${p.id === data.you ? ' · toi' : ''}`),
        node('span', '', BRAWLERS[p.brawler].name), node('span', 'lobby-host', p.id === data.host ? 'Hôte' : 'Prêt'));
      this.players.append(row);
    }
    const host = data.you === data.host;
    this.duration.value = String(data.minutes); this.map.value = String(data.map);
    this.duration.disabled = !host; this.map.disabled = !host;
    this.start.hidden = !host;
    this.authority.textContent = host ? '' : 'En attente du lancement par l’hôte';
    const me = data.players.find(p => p.id === data.you);
    this.buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === me?.brawler)));
    this.root.hidden = false;
  }
  hide() { this.root.hidden = true; }
}