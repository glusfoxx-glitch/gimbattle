/**
 * Écran de fin de manche : podium, tableau des scores (K.O. / morts) et changement de perso.
 * DOM construit une fois ; rempli à chaque message « results » de l'hôte.
 */
import { BRAWLERS } from '../shared/brawlers.js';
import { TEAM_CSS, TEAM_NAMES, ROUND_DRAW, ROUND_END_PAUSE_MS } from '../shared/constants.js';

/**
 * @typedef {{slot:number,name:string,brawler:number,team:number,kills:number,deaths:number}} ResultRow
 * @typedef {{winner:number,scoreA:number,scoreB:number,players:ResultRow[]}} Results
 */

/** Classement : plus de K.O. d'abord, puis moins de morts, puis emplacement (stable). @param {ResultRow[]} rows */
export function rankPlayers(rows) {
  return rows.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.slot - b.slot);
}

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class ResultsScreen {
  /** @param {(brawler: number) => void} onPick */
  constructor(onPick) {
    this.onPick = onPick;
    this.root = el('section', 'results');
    this.root.hidden = true;
    this.root.setAttribute('aria-live', 'polite');
    const card = el('div', 'results-card');
    this.title = el('h2', 'results-title');
    this.score = el('p', 'results-score hand');
    this.podium = el('div', 'podium');
    this.table = el('table', 'score-table');
    const pickTitle = el('h3', 'results-sub hand', 'Changer de perso pour la prochaine manche');
    this.picks = el('div', 'pick-grid');
    /** @type {HTMLButtonElement[]} */
    this.pickButtons = BRAWLERS.map((b) => {
      const btn = /** @type {HTMLButtonElement} */ (el('button', 'pick-opt', b.name));
      btn.type = 'button';
      btn.style.setProperty('--accent', b.accent);
      btn.addEventListener('click', () => { this.setPicked(b.id); this.onPick(b.id); });
      this.picks.append(btn);
      return btn;
    });
    this.countdown = el('p', 'results-count');
    const close = /** @type {HTMLButtonElement} */ (el('button', 'results-close', 'Voir l’arène'));
    close.type = 'button';
    close.addEventListener('click', () => this.hide());
    card.append(this.title, this.score, this.podium, this.table, pickTitle, this.picks, this.countdown, close);
    this.root.append(card);
    document.body.append(this.root);
    this.timer = 0;
    this.endsAt = 0;
    this.onHide = () => {};
  }

  get visible() { return !this.root.hidden; }

  /** @param {number} id */
  setPicked(id) {
    this.pickButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === id)));
  }

  /** @param {Results} res @param {number} localSlot */
  show(res, localSlot) {
    this.title.textContent = res.winner === ROUND_DRAW ? 'Égalité !' : `Victoire des ${TEAM_NAMES[res.winner]} !`;
    this.title.style.color = res.winner === ROUND_DRAW ? '' : TEAM_CSS[res.winner];
    this.score.textContent = `${TEAM_NAMES[0]} ${res.scoreA} – ${res.scoreB} ${TEAM_NAMES[1]}`;
    const ranked = rankPlayers(res.players);
    this.podium.replaceChildren();
    const order = [1, 0, 2]; // 2e à gauche, 1er au centre, 3e à droite
    for (const rank of order) {
      const r = ranked[rank];
      if (!r) continue;
      const step = el('div', `podium-step podium-${rank + 1}`);
      step.style.setProperty('--team', TEAM_CSS[r.team]);
      step.append(el('span', 'podium-name', r.name), el('span', 'podium-hero', BRAWLERS[r.brawler].name),
        el('span', 'podium-kd', `${r.kills} K.O. · ${r.deaths} morts`), el('span', 'podium-block', String(rank + 1)));
      this.podium.append(step);
    }
    this.table.replaceChildren();
    const head = el('tr');
    for (const h of ['#', 'Joueur', 'Perso', 'K.O.', 'Morts']) head.append(el('th', '', h));
    this.table.append(head);
    ranked.forEach((r, i) => {
      const tr = el('tr', r.slot === localSlot ? 'is-me' : '');
      tr.style.setProperty('--team', TEAM_CSS[r.team]);
      tr.append(el('td', '', String(i + 1)), el('td', 'player-cell', r.name), el('td', '', BRAWLERS[r.brawler].name),
        el('td', '', String(r.kills)), el('td', '', String(r.deaths)));
      this.table.append(tr);
    });
    const me = res.players.find((p) => p.slot === localSlot);
    this.setPicked(me ? me.brawler : -1);
    this.endsAt = performance.now() + ROUND_END_PAUSE_MS;
    this.tickCountdown();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tickCountdown(), 250);
    this.root.hidden = false;
  }

  tickCountdown() {
    const s = Math.max(0, Math.ceil((this.endsAt - performance.now()) / 1000));
    this.countdown.textContent = `Nouvelle manche dans ${s} s`;
  }

  hide() {
    clearInterval(this.timer);
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.onHide();
  }
}
