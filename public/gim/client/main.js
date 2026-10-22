import {
  TICK_MS, MAX_FRAME_DELTA_MS, MS_PER_SECOND, MAX_PLAYERS, MAX_PARTICLES, BOT_REF_BASE, REF_NONE, EVENT,
  ATTACK_KIND, VISUAL, ZONE_VISUAL, BTN_AUTO_AIM, BTN_SUPER, ACTION_FIRED_MAIN, ACTION_FIRED_SUPER, TEAM_A,
  TEAM_BOTS, TEAM_CSS, TEAM_NAMES, ROUND_DRAW, BEAM_LENGTH_SCALE, ZONE_RADIUS_SCALE, RING_EFFECT_MS, BEAM_HEIGHT,
  SHAKE_FIRE, SHAKE_HIT_TAKEN, SHAKE_KO, SHAKE_IMPACT, HEAL_CSS, DAMAGE_CSS, SUPER_MAX, PROJECTILE_HEIGHT,
  CONNECT_TIMEOUT_MS, PF_DEAD, HALF, FLOAT_ZERO, MODE_BR
} from '../shared/constants.js';
import { ResultsScreen } from './results.js';
import { Lobby } from './lobby.js';
import { BRAWLERS, BRAWLER_COUNT } from '../shared/brawlers.js';
import { PROFS } from '../shared/profs.js';
import { raycast } from '../shared/physics.js';
import { createInput } from '../shared/simulation.js';
import { Renderer } from './renderer.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { AudioSystem, SOUND } from './audio.js';
import { Menu } from './menu.js';

const STATE_MENU = 0; const STATE_CONNECTING = 1; const STATE_PLAYING = 2; const DAMAGE_TAKEN_CSS = '#ff6b6b'; const NEAR_SHAKE_DISTANCE = 8;
const ACCENTS = BRAWLERS.map((b) => Number.parseInt(b.accent.slice(1), 16)); const PROF_ACCENTS = PROFS.map((p) => Number.parseInt(p.accent.slice(1), 16));
const PROF_ENTER_TEXT = PROFS.map((p) => `${p.name} entre en classe !`); const WINNER_TEXT = [`Victoire des ${TEAM_NAMES[0]} !`, `Victoire des ${TEAM_NAMES[1]} !`, 'Égalité !'];
const IMPACT_COLORS = Object.freeze([0xffffff, 0xf1e6a4, 0xff8a1f, 0x222222, 0xe9a53f, 0xb8bec9, 0x4caf50, 0x7ff3ff]); const ZONE_PUFF_COLORS = Object.freeze([0xffffff, 0xff7a1a, 0xb5d65a, 0xffc6ec]);
const glCanvas = document.getElementById('gl'); const hudCanvas = document.getElementById('hud'); const menuButton = document.getElementById('menu-btn');
const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

function fatal(message) { const box = document.getElementById('boot-error'); box.textContent = message; box.hidden = false; window.gimReady = true; }
let renderer; try { renderer = new Renderer(glCanvas, isTouch); } catch (err) { fatal("Erreur WebGL."); throw err; }
const input = new Input(hudCanvas); input.mode = isTouch ? 'touch' : 'mouse';
const hud = new Hud(hudCanvas, renderer, input); const net = new Net(); const audio = new AudioSystem(); const effects = renderer.effects;
const menu = new Menu(startGame, () => { audio.unlock(); audio.play(SOUND.SELECT); });
const lobby = new Lobby((id) => { net.pick(id); menu.selectBrawler(id); }, (minutes, map, gameMode) => net.sendSettings(minutes, map, gameMode), () => net.start(), () => { net.leave(); backToMenu('', false); });

let state = STATE_MENU; let lastFrame = performance.now(); let accumulator = FLOAT_ZERO; let superWasReady = false; let lastLocalFireAt = -Infinity; const LOCAL_FIRE_MATCH_MS = 1500;
let connectTimer = null; const cmd = createInput(); const ground = { x: FLOAT_ZERO, y: FLOAT_ZERO };
const aimContext = { playerX: FLOAT_ZERO, playerY: FLOAT_ZERO, groundValid: false, groundX: FLOAT_ZERO, groundY: FLOAT_ZERO, mainRange: FLOAT_ZERO, superRange: FLOAT_ZERO };
const aimState = { visible: false, x: FLOAT_ZERO, y: FLOAT_ZERO, angle: FLOAT_ZERO, dist: FLOAT_ZERO, isSuper: false, brawlerId: 0 };
const debugInfo = { ping: FLOAT_ZERO, serverTick: 0, pendingInputs: 0, correction: FLOAT_ZERO, particles: 0, particleCapacity: MAX_PARTICLES, drawCalls: 0 };

let spectateRef = -1; // Pour le mode Spectateur BR

function startGame(name, brawler, room, mode) {
  audio.unlock(); audio.play(SOUND.CLICK);
  if (isTouch) { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {}); screen.orientation?.lock?.('landscape')?.catch(() => {}); }
  state = STATE_CONNECTING; menu.setBusy(true); menu.setStatus(mode === 'host' ? `Création de la partie « ${room} »…` : `Connexion à la partie « ${room} »…`, false);
  net.join(name, brawler, room, mode);
  if (connectTimer !== null) clearTimeout(connectTimer);
  connectTimer = setTimeout(() => { if (state !== STATE_CONNECTING) return; net.leave(); backToMenu("La connexion n’a pas abouti.", true); }, CONNECT_TIMEOUT_MS);
}

function backToMenu(message, isError) { state = STATE_MENU; lobby.hide(); results.hide(); input.setEnabled(false); hud.wipe(); menuButton.hidden = true; document.body.classList.remove('playing'); menu.show(); menu.setStatus(message, isError); }

net.onWelcome = (slot, team) => {
  if (connectTimer !== null) clearTimeout(connectTimer);
  state = STATE_PLAYING; accumulator = 0; superWasReady = false; spectateRef = -1;
  menu.hide(); lobby.hide(); hud.clear(); effects.clear(); input.setEnabled(true); menuButton.hidden = false; document.body.classList.add('playing');
  if (net.views.gameMode !== MODE_BR) hud.showBanner(team === TEAM_A ? 'Équipe BLEUE' : 'Équipe ROUGE', "Mets K.O. l'équipe adverse…", TEAM_CSS[team], performance.now());
  else hud.showBanner("BATTLE ROYALE", "Chacun pour soi. Survis !", "#ffd23f", performance.now());
};

net.onLobby = (data) => { if (connectTimer !== null) clearTimeout(connectTimer); state = STATE_MENU; input.setEnabled(false); menu.hide(); lobby.show(data, net.room); };
const results = new ResultsScreen((id) => { net.pick(id); menu.selectBrawler(id); });
results.onHide = () => { if (state === STATE_PLAYING) input.setEnabled(true); };
net.onResults = (res) => { if (state !== STATE_PLAYING) return; input.setEnabled(false); results.show(res, net.localSlot); spectateRef = -1; };
net.onError = (message) => { if (connectTimer !== null) clearTimeout(connectTimer); backToMenu(message, true); };
net.onClose = () => { if (state !== STATE_MENU) backToMenu("Connexion perdue.", true); };
menuButton.addEventListener('click', () => { net.leave(); backToMenu('', false); });
window.addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) audio.toggleMute(); });

// CLIC SPECTATEUR BR
window.addEventListener('pointerdown', (e) => {
  if (state === STATE_PLAYING && net.views.gameMode === MODE_BR && net.views.localSlot >= 0) {
    const p = net.views.players[net.views.localSlot];
    if (p && (p.flags & PF_DEAD) !== 0) {
      // Trouver le prochain joueur vivant
      let found = false;
      for (let i = 1; i <= MAX_PLAYERS; i++) {
        const nextId = (Math.max(0, spectateRef) + i) % MAX_PLAYERS;
        if (net.views.players[nextId].active && (net.views.players[nextId].flags & PF_DEAD) === 0) {
          spectateRef = nextId;
          found = true;
          break;
        }
      }
      if (!found) spectateRef = -1;
    }
  }
});

function onResize() { renderer.resize(); hud.resize(); input.resize(); menu.refreshRect(); }
window.addEventListener('resize', onResize); window.addEventListener('orientationchange', onResize);
new ResizeObserver(() => menu.refreshRect()).observe(menu.preview); document.fonts?.ready.then(() => menu.refreshRect());

function headHeight(ref) { return ref < MAX_PLAYERS ? renderer.playerTop(ref) : renderer.botTop(ref - BOT_REF_BASE); }
function colorOfRef(ref) { if (ref === REF_NONE) return '#ffffff'; if (ref >= MAX_PLAYERS) return TEAM_CSS[TEAM_BOTS]; return net.views.gameMode === MODE_BR ? '#ff4d5e' : TEAM_CSS[net.roster[ref].team]; }
function sound(id, x, y, isLocal, rate = 1) { if (isLocal) audio.play(id, false, rate); else audio.playAt(id, x, y, rate); }
function nearLocal(x, y) { if (net.views.localSlot < 0) return false; const p = net.views.players[net.views.localSlot]; const dx = p.x - x; const dy = p.y - y; return dx * dx + dy * dy < NEAR_SHAKE_DISTANCE * NEAR_SHAKE_DISTANCE; }

function attackFx(def, brawlerId, x, y, angle, value, isLocal) {
  const accent = ACCENTS[brawlerId]; const cos = Math.cos(angle); const sin = Math.sin(angle);
  switch (def.kind) {
    case ATTACK_KIND.MELEE: effects.swing(x, y, angle, def.range, def.arcRad, accent); sound(SOUND.SWOOSH, x, y, isLocal); break;
    case ATTACK_KIND.BEAM: { const length = isLocal ? raycast(x, y, cos, sin, def.range, net.arena) : value / BEAM_LENGTH_SCALE; effects.beam(x, y, angle, length, 0xffb347); effects.burst(x + cos * length, y + sin * length, BEAM_HEIGHT, 8, 0xfff2b0, 3, 0.3, 300, HALF); sound(SOUND.SNAP, x, y, isLocal); break; }
    case ATTACK_KIND.NOVA: effects.shockwave(x, y, def.aoeRadius, accent, RING_EFFECT_MS * 1.5); effects.burst(x, y, HALF, 24, accent, 7, 0.35, 500, HALF); sound(SOUND.BASS, x, y, isLocal); if (isLocal || nearLocal(x, y)) renderer.addShake(SHAKE_KO); break;
    case ATTACK_KIND.DASH: effects.burst(x, y, 0.2, 12, 0xcfc4ab, 3, 0.35, 400, 0.2); sound(SOUND.DASH, x, y, isLocal); break;
    case ATTACK_KIND.LEAP: effects.burst(x, y, 0.2, 16, 0xcfc4ab, 4, 0.4, 500, 0.2); sound(SOUND.JUMP, x, y, isLocal); break;
    case ATTACK_KIND.BUFF: if (def.invisible) { effects.burst(x, y, 1, 22, 0x9aa0a6, 2.5, 0.5, 700, -0.05); sound(SOUND.VANISH, x, y, isLocal); } else { effects.burst(x, y, 1.2, 18, 0xffe14d, 3, 0.3, 600, -0.1); sound(SOUND.DRINK, x, y, isLocal); } break;
    case ATTACK_KIND.ZONE_SELF: effects.burst(x, y, HALF, 20, ZONE_PUFF_COLORS[def.zoneVisual], 3, 0.6, 800, -0.05); sound(def.zoneVisual === ZONE_VISUAL.GAS ? SOUND.FART : SOUND.SPRAY, x, y, isLocal); break;
    default: effects.burst(x + cos * HALF, y + sin * HALF, PROJECTILE_HEIGHT, 5, accent, 2, 0.25, 220, 0); if (def.visual === VISUAL.ELECTRIC) sound(SOUND.ZAP, x, y, isLocal); else if (def.visual === VISUAL.VINYL) sound(SOUND.SHOOT, x, y, isLocal); else if (def.visual === VISUAL.BILLET) sound(SOUND.SHOOT, x, y, isLocal, 1.5); else sound(SOUND.THROW, x, y, isLocal, def.visual === VISUAL.BOBINE ? 0.7 : 1); break;
  }
  if (isLocal) renderer.addShake(SHAKE_FIRE);
}

function attackWithVisual(b, visual) { if (b.main.visual === visual) return b.main; if (b.super.visual === visual) return b.super; return null; }
function leapAttack(b) { return b.super.kind === ATTACK_KIND.LEAP ? b.super : b.main; }

function impactFx(e) {
  const visual = e.c < IMPACT_COLORS.length ? e.c : VISUAL.NONE;
  if (visual === VISUAL.NONE && e.a >= BOT_REF_BASE) { effects.burst(e.x, e.y, HALF, 20, 0xcfc4ab, 4, 0.45, 600, HALF); effects.shockwave(e.x, e.y, 1.6, 0xffffff, RING_EFFECT_MS); audio.playAt(SOUND.STOMP, e.x, e.y); if (nearLocal(e.x, e.y)) renderer.addShake(SHAKE_IMPACT); return; }
  effects.burst(e.x, e.y, PROJECTILE_HEIGHT, visual === VISUAL.MOLOTOV ? 18 : 9, IMPACT_COLORS[visual], 3, 0.28, 380, 1);
  const def = e.a < MAX_PLAYERS ? attackWithVisual(BRAWLERS[net.roster[e.a].brawler], visual) : null;
  if (def !== null && def.aoeRadius > 0) { effects.burst(e.x, e.y, HALF, 8, 0xffffff, 4, 0.18, 300, 1); effects.shockwave(e.x, e.y, def.aoeRadius, IMPACT_COLORS[visual], RING_EFFECT_MS); audio.playAt(visual === VISUAL.MOLOTOV ? SOUND.GLASS : SOUND.STOMP, e.x, e.y); if (nearLocal(e.x, e.y)) renderer.addShake(SHAKE_IMPACT); } else if (visual === VISUAL.ELECTRIC) { audio.playAt(SOUND.ZAP, e.x, e.y); }
}

function handleEvent(e) {
  const local = net.views.localSlot; const now = performance.now();
  switch (e.type) {
    case EVENT.HIT: { renderer.flashRef(e.b); const takenByMe = e.b === local; hud.addDamage(e.x, e.y, headHeight(e.b), e.value, takenByMe ? DAMAGE_TAKEN_CSS : DAMAGE_CSS); effects.burst(e.x, e.y, 1, 5, 0xffffff, 3, 0.22, 250, 1); if (takenByMe) { renderer.addShake(SHAKE_HIT_TAKEN); audio.play(SOUND.HURT); } else sound(SOUND.HIT, e.x, e.y, e.a === local); break; }
    case EVENT.HEAL: hud.addDamage(e.x, e.y, headHeight(e.b), e.value, HEAL_CSS); effects.burst(e.x, e.y, 1, 10, 0x4ade80, 2, 0.3, 600, -0.2); sound(SOUND.HEAL, e.x, e.y, e.b === local || e.a === local); break;
    case EVENT.KO: { const color = e.b < MAX_PLAYERS ? ACCENTS[net.roster[e.b].brawler] : PROF_ACCENTS[net.views.bots[e.b - BOT_REF_BASE].type]; effects.burst(e.x, e.y, 1, 34, color, 6, 0.45, 800, 1); effects.shockwave(e.x, e.y, 2, 0xffffff, RING_EFFECT_MS); sound(SOUND.KO, e.x, e.y, e.b === local || e.a === local); hud.addKill(e.a === REF_NONE ? '' : net.nameOf(e.a), colorOfRef(e.a), net.nameOf(e.b), colorOfRef(e.b), now); if (e.b === local) { renderer.addShake(SHAKE_KO); if (e.a !== REF_NONE) hud.showToast(`Mis K.O. par ${net.nameOf(e.a)}`, now, MS_PER_SECOND * 2); } break; }
    case EVENT.ATTACK: { if (e.a >= MAX_PLAYERS) break; const brawlerId = e.c >> 1; if (brawlerId >= BRAWLER_COUNT) break; if (e.a === local && now - lastLocalFireAt < LOCAL_FIRE_MATCH_MS) break; const b = BRAWLERS[brawlerId]; renderer.attackAnimRef(e.a); attackFx((e.c & 1) === 1 ? b.super : b.main, brawlerId, e.x, e.y, e.angle, e.value, false); break; }
    case EVENT.IMPACT: impactFx(e); break;
    case EVENT.LAND: { const def = leapAttack(BRAWLERS[e.c < BRAWLER_COUNT ? e.c : 0]); effects.shockwave(e.x, e.y, def.aoeRadius, 0xffffff, RING_EFFECT_MS * 1.4); effects.burst(e.x, e.y, 0.2, 26, 0xcfc4ab, 6, 0.45, 600, HALF); sound(SOUND.LAND, e.x, e.y, e.a === local); if (e.a === local || nearLocal(e.x, e.y)) renderer.addShake(SHAKE_KO); break; }
    case EVENT.RESPAWN: effects.burst(e.x, e.y, 1, 16, 0x7fe7ff, 2.5, 0.3, 600, -0.2); break;
    case EVENT.BOT_SPAWN: if (e.c < PROFS.length) hud.showToast(PROF_ENTER_TEXT[e.c], now, MS_PER_SECOND * 2.5); effects.burst(e.x, e.y, 1, 20, 0xffa62b, 3, 0.4, 600, 0); audio.play(SOUND.BELL, true); break;
    case EVENT.BOT_WINDUP: { if (e.c >= PROFS.length) break; const prof = PROFS[e.c]; const radius = e.value > 0 ? e.value / ZONE_RADIUS_SCALE : prof.radius * 1.6; effects.telegraph(e.x, e.y, radius, prof.windupMs, 0xff3b3b); audio.playAt(SOUND.WARN, e.x, e.y); break; }
    case EVENT.BOT_STRIKE: effects.shockwave(e.x, e.y, e.value / ZONE_RADIUS_SCALE, 0xff3b3b, RING_EFFECT_MS); effects.burst(e.x, e.y, 0.3, 14, 0xcfc4ab, 4, 0.35, 450, HALF); audio.playAt(SOUND.STOMP, e.x, e.y); if (nearLocal(e.x, e.y)) renderer.addShake(SHAKE_IMPACT); break;
    case EVENT.ROUND_END: { 
      let bannerTitle = WINNER_TEXT[e.c <= ROUND_DRAW ? e.c : ROUND_DRAW];
      if (net.views.gameMode === MODE_BR && e.c !== ROUND_DRAW) {
        // En BR, l'équipe gagnante est l'id du joueur + 10 (envoyé dans l'évent ROUND_END)
        const winnerSlot = e.c - 10;
        bannerTitle = `Victoire de ${net.roster[winnerSlot]?.name || "l'élève"} !`;
      }
      hud.showBanner(bannerTitle, 'Tableau des scores', e.c === ROUND_DRAW ? '#ffffff' : '#ffd23f', now, MS_PER_SECOND * 5); 
      audio.play(SOUND.FANFARE); break; 
    }
    case EVENT.ROUND_START: results.hide(); hud.showBanner('Nouvelle manche !', net.views.gameMode === MODE_BR ? 'Survis à la zone' : 'Les scores repartent à zéro', '#ffffff', now); audio.play(SOUND.READY); break;
    default: break;
  }
}
net.onEvent = handleEvent;

function onLocalActions(flags) {
  lastLocalFireAt = performance.now(); const p = net.predicted; const b = BRAWLERS[p.brawlerId];
  if ((flags & ACTION_FIRED_SUPER) !== 0) { renderer.attackAnimRef(net.localSlot); attackFx(b.super, p.brawlerId, p.x, p.y, p.aimAngle, 0, true); }
  if ((flags & ACTION_FIRED_MAIN) !== 0) { renderer.attackAnimRef(net.localSlot); attackFx(b.main, p.brawlerId, p.x, p.y, p.aimAngle, 0, true); }
}

function fixedStep() {
  input.update(TICK_MS); const p = net.predicted; const b = BRAWLERS[p.brawlerId];
  aimContext.playerX = p.x; aimContext.playerY = p.y; aimContext.groundValid = input.mode === 'mouse' && input.hasMouse && renderer.screenToGround(input.mouseX, input.mouseY, ground); aimContext.groundX = ground.x; aimContext.groundY = ground.y; aimContext.mainRange = b.main.range; aimContext.superRange = b.super.range;
  input.fillCommand(cmd, aimContext);
  if ((cmd.buttons & BTN_AUTO_AIM) !== 0) net.estimateAutoAim(cmd, (cmd.buttons & BTN_SUPER) !== 0);
  const flags = net.fixedTick(cmd);
  if (flags !== 0) { input.consumeFired(flags); onLocalActions(flags); }
}

function updateAimState() {
  const views = net.views; const local = views.localSlot >= 0 ? views.players[views.localSlot] : null;
  aimState.visible = local !== null && (local.flags & PF_DEAD) === 0 && input.aiming;
  if (local === null) return;
  aimState.x = local.x; aimState.y = local.y; aimState.angle = cmd.aimAngle; aimState.dist = cmd.aimDist; aimState.isSuper = input.aimingSuper; aimState.brawlerId = local.brawlerId;
}

function updateSuperReady() {
  const ready = net.hasSelf && net.predicted.superCharge >= SUPER_MAX;
  if (ready && !superWasReady) audio.play(SOUND.READY); superWasReady = ready;
}

function frame(now) {
  const deltaMs = Math.min(now - lastFrame, MAX_FRAME_DELTA_MS); lastFrame = now; const dt = deltaMs / MS_PER_SECOND; const time = now / MS_PER_SECOND;
  if (input.consumeDebugToggle()) hud.debug = !hud.debug;
  if (state === STATE_PLAYING) {
    accumulator += deltaMs; while (accumulator >= TICK_MS) { fixedStep(); accumulator -= TICK_MS; }
    net.update(now, accumulator / TICK_MS, dt); const views = net.views;
    if (views.localSlot >= 0) { const me = views.players[views.localSlot]; audio.setListener(me.x, me.y); }
    updateAimState(); updateSuperReady();
    renderer.renderGame(views, dt, time, aimState, spectateRef);
    debugInfo.ping = net.rtt; debugInfo.serverTick = views.serverTick; debugInfo.pendingInputs = net.pendingCount; debugInfo.correction = net.lastCorrection; debugInfo.particles = effects.particles.activeCount; debugInfo.drawCalls = renderer.drawCalls();
    hud.draw(views, net.roster, net.predicted.superCharge, net.predicted.respawnMs, dt, now, debugInfo, spectateRef);
  } else { renderer.renderPreview(dt, time, menu.previewRect, menu.viewingProf, menu.viewedId); }
  requestAnimationFrame(frame);
}

menu.show(); menu.setStatus(isTouch ? 'Conseil : joue en mode paysage.' : '', false); requestAnimationFrame(frame);
window.gimNet = net; window.gimReady = true;
