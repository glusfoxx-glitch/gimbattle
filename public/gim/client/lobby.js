import { BRAWLERS } from '../shared/brawlers.js';
import { MAP_NAMES, ROUND_DURATION_CHOICES_MIN, MODE_TDM, MODE_BR } from '../shared/constants.js';

function node(tag, cls, text) { const e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; }

export class Lobby {
  constructor(onPick, onSettings, onStart, onLeave) {
    this.root = node('main', 'lobby'); this.root.hidden = true;
    const header = node('header', 'lobby-header');
    const brand = node('img', 'lobby-logo'); brand.src = 'logo.png'; brand.alt = 'GIM Battle';
    const heading = node('div', ''); heading.append(node('p', 'hand lobby-eyebrow', 'Salon d’attente'));
    this.code = node('h1', 'lobby-code'); heading.append(this.code);
    const leave = node('button', 'results-close', 'Quitter'); leave.type = 'button'; leave.addEventListener('click', onLeave);
    header.append(brand, heading, leave);
    
    const content = node('div', 'lobby-content');
    const roster = node('section', 'lobby-roster');
    this.count = node('h2', 'hand section-title');
    this.players = node('ul', 'lobby-players');
    roster.append(this.count, this.players);
    
    const settings = node('section', 'lobby-settings');
    settings.append(node('h2', 'hand section-title', 'La prochaine partie'));
    
    const modeLabel = node('label', 'field', 'Mode de jeu');
    this.gameMode = node('select', 'lobby-select');
    this.gameMode.append(node('option', '', 'Match à Mort (Bleus vs Rouges)')); this.gameMode.lastChild.value = String(MODE_TDM);
    this.gameMode.append(node('option', '', 'Battle Royale (Chacun pour soi)')); this.gameMode.lastChild.value = String(MODE_BR);
    modeLabel.append(this.gameMode);

    this.durationLabel = node('label', 'field', 'Durée de la manche');
    this.duration = node('select', 'lobby-select');
    for (const minutes of ROUND_DURATION_CHOICES_MIN) { const opt = node('option', '', `${minutes} minute${minutes > 1 ? 's' : ''}`); opt.value = String(minutes); this.duration.append(opt); }
    this.durationLabel.append(this.duration);
    
    this.mapLabel = node('label', 'field', 'Carte');
    this.map = node('select', 'lobby-select');
    this.mapLabel.append(this.map);
    
    this.isHost = false;
    const changed = () => {
      const isBR = Number(this.gameMode.value) === MODE_BR;
      if (isBR) {
        this.root.classList.add('br-theme');
        this.map.innerHTML = '<option value="2">Grande Cour (Exclusif BR)</option>';
        this.map.disabled = true; this.durationLabel.style.opacity = '0.5'; this.duration.disabled = true;
        this.pickTitle.textContent = 'Personnages aléatoires !';
      } else {
        this.root.classList.remove('br-theme');
        this.map.innerHTML = '';
        [...MAP_NAMES].slice(0, 2).forEach((name, i) => { const opt = node('option', '', name); opt.value = String(i); this.map.append(opt); });
        const optAll = node('option', '', 'Les 2 · alternance'); optAll.value = '3'; this.map.append(optAll);
        this.map.disabled = !this.isHost; this.durationLabel.style.opacity = '1'; this.duration.disabled = !this.isHost;
        this.pickTitle.textContent = 'Ton personnage';
      }
      if (this.isHost) onSettings(Number(this.duration.value), Number(this.map.value), Number(this.gameMode.value));
    };
    
    this.duration.addEventListener('change', changed); this.map.addEventListener('change', changed); this.gameMode.addEventListener('change', changed);
    
    this.authority = node('p', 'lobby-authority');
    this.start = node('button', 'play', 'Lancer la partie'); this.start.type = 'button'; this.start.addEventListener('click', onStart);
    settings.append(modeLabel, this.durationLabel, this.mapLabel, this.authority, this.start);
    content.append(roster, settings);
    
    const picks = node('section', 'lobby-picks');
    this.pickTitle = node('h2', 'hand section-title', 'Ton personnage');
    picks.append(this.pickTitle);
    const grid = node('div', 'lobby-pick-grid');
    this.buttons = BRAWLERS.map((b) => { const btn = node('button', 'card', b.name); btn.type = 'button'; btn.addEventListener('click', () => onPick(b.id)); grid.append(btn); return btn; });
    picks.append(grid); this.picksSection = picks;
    
    this.root.append(header, content, picks); document.body.append(this.root);
    this.changedCallback = changed;
  }

  show(data, room) {
    this.isHost = data.you === data.host;
    this.code.textContent = `Code : ${room}`;
    this.count.textContent = `${data.players.length} joueur${data.players.length > 1 ? 's' : ''}`;
    this.players.replaceChildren();
    for (const p of data.players) {
      const isMe = p.id === data.you; const row = node('li', isMe ? 'lobby-player is-me' : 'lobby-player');
      row.append(node('strong', '', `${p.name}${isMe ? ' · toi' : ''}`), node('span', '', data.gameMode === MODE_BR ? 'Aléatoire' : BRAWLERS[p.brawler].name), node('span', 'lobby-host', p.id === data.host ? 'Hôte' : 'Prêt'));
      this.players.append(row);
    }
    
    this.duration.value = String(data.minutes); this.gameMode.value = String(data.gameMode);
    this.changedCallback(); 
    if (data.gameMode !== MODE_BR) this.map.value = String(data.map);
    
    this.gameMode.disabled = !this.isHost; this.start.hidden = !this.isHost;
    this.authority.textContent = this.isHost ? '' : 'En attente du lancement par l’hôte';
    
    if (data.gameMode === MODE_BR) {
      this.picksSection.hidden = true;
    } else {
      this.picksSection.hidden = false;
      const me = data.players.find(p => p.id === data.you);
      this.buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === me?.brawler)));
    }
    this.root.hidden = false;
  }
  hide() { this.root.hidden = true; }
}
