/**
 * Sons 100 % synthétisés (aucun fichier audio) : les échantillons sont calculés une fois au chargement,
 * puis copiés dans des AudioBuffer au premier geste de l'utilisateur (règle d'autoplay des navigateurs).
 * Jouer un son crée un AudioBufferSourceNode : c'est un nœud à usage unique imposé par Web Audio (limite connue).
 */
import { AUDIO_SYNTH_RATE, MASTER_VOLUME, MAX_AUDIO_VOICES, TWO_PI, HALF } from '../shared/constants.js';

export const SOUND = Object.freeze({
  THROW: 0, SHOOT: 1, SWOOSH: 2, SLAP: 3, SNAP: 4, DASH: 5, BASS: 6, DRINK: 7, VANISH: 8, JUMP: 9, LAND: 10,
  HIT: 11, HURT: 12, KO: 13, HEAL: 14, FART: 15, GLASS: 16, SPRAY: 17, BELL: 18, WARN: 19, STOMP: 20, ZAP: 21,
  CLICK: 22, SELECT: 23, FANFARE: 24, READY: 25, COUNT: 26,
});

const WAVE = Object.freeze({ SINE: 0, SQUARE: 1, SAW: 2, TRIANGLE: 3 });
const DEFAULT_ATTACK_S = 0.004;
const DEFAULT_RELEASE_S = 0.06;
const NEAR_DISTANCE = 9;
const MAX_HEARING_DISTANCE = 24;
const FAR_VOLUME = 0.35;

/** @param {number} seconds @returns {Float32Array} */
function buffer(seconds) {
  return new Float32Array(Math.ceil(seconds * AUDIO_SYNTH_RATE));
}

/** @param {number} t @param {number} dur @param {number} attack @param {number} release @returns {number} */
function envelope(t, dur, attack, release) {
  if (t < attack) return t / attack;
  const remaining = dur - t;
  return remaining < release ? Math.max(0, remaining / release) : 1;
}

/** @param {number} wave @param {number} phase 0..1 @returns {number} */
function oscillator(wave, phase) {
  switch (wave) {
    case WAVE.SQUARE: return phase < HALF ? 1 : -1;
    case WAVE.SAW: return phase * 2 - 1;
    case WAVE.TRIANGLE: return 1 - 4 * Math.abs(phase - HALF);
    default: return Math.sin(phase * TWO_PI);
  }
}

/**
 * Ajoute une note à fréquence glissante (exponentielle) avec enveloppe.
 * @param {Float32Array} buf @param {number} start @param {number} dur @param {number} f0 @param {number} f1
 * @param {number} wave @param {number} vol @param {number} [attack] @param {number} [release] @param {number} [vibrato]
 */
function tone(buf, start, dur, f0, f1, wave, vol, attack = DEFAULT_ATTACK_S, release = DEFAULT_RELEASE_S, vibrato = 0) {
  const first = Math.floor(start * AUDIO_SYNTH_RATE);
  const count = Math.min(Math.floor(dur * AUDIO_SYNTH_RATE), buf.length - first);
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / AUDIO_SYNTH_RATE;
    const f = f0 * Math.pow(f1 / f0, t / dur) * (1 + vibrato * Math.sin(t * 40));
    phase = (phase + f / AUDIO_SYNTH_RATE) % 1;
    buf[first + i] += oscillator(wave, phase) * vol * envelope(t, dur, attack, release);
  }
}

/**
 * Bruit filtré passe-bas (smooth faible = sourd, smooth élevé = brillant).
 * @param {Float32Array} buf @param {number} start @param {number} dur @param {number} vol @param {number} smooth
 * @param {number} [attack] @param {number} [release]
 */
function noise(buf, start, dur, vol, smooth, attack = DEFAULT_ATTACK_S, release = DEFAULT_RELEASE_S) {
  const first = Math.floor(start * AUDIO_SYNTH_RATE);
  const count = Math.min(Math.floor(dur * AUDIO_SYNTH_RATE), buf.length - first);
  let last = 0;
  for (let i = 0; i < count; i++) {
    const t = i / AUDIO_SYNTH_RATE;
    last += (Math.random() * 2 - 1 - last) * smooth;
    buf[first + i] += last * vol * envelope(t, dur, attack, release);
  }
}

/** @returns {Float32Array[]} Tous les sons, indexés par SOUND.* */
function synthesizeAll() {
  const s = new Array(SOUND.COUNT);
  let b;
  b = buffer(0.22); noise(b, 0, 0.2, 0.5, 0.12, 0.03, 0.12); tone(b, 0, 0.18, 320, 180, WAVE.TRIANGLE, 0.2); s[SOUND.THROW] = b;
  b = buffer(0.12); tone(b, 0, 0.1, 700, 240, WAVE.SQUARE, 0.18); noise(b, 0, 0.03, 0.4, 0.8); s[SOUND.SHOOT] = b;
  b = buffer(0.2); noise(b, 0, 0.18, 0.45, 0.25, 0.04, 0.1); s[SOUND.SWOOSH] = b;
  b = buffer(0.12); noise(b, 0, 0.05, 0.9, 0.9, 0.001, 0.04); tone(b, 0, 0.1, 200, 80, WAVE.SINE, 0.5); s[SOUND.SLAP] = b;
  b = buffer(0.16); noise(b, 0, 0.02, 0.7, 0.9, 0.001, 0.01); noise(b, 0.06, 0.03, 0.7, 0.9, 0.001, 0.02); tone(b, 0.02, 0.08, 2200, 1600, WAVE.SINE, 0.25); s[SOUND.SNAP] = b;
  b = buffer(0.32); tone(b, 0, 0.3, 110, 280, WAVE.SAW, 0.2, 0.01, 0.1); noise(b, 0, 0.3, 0.2, 0.2); s[SOUND.DASH] = b;
  b = buffer(0.95); tone(b, 0, 0.9, 170, 32, WAVE.SINE, 0.9, 0.005, 0.3); noise(b, 0, 0.25, 0.5, 0.08, 0.005, 0.2); s[SOUND.BASS] = b;
  b = buffer(0.6);
  for (let i = 0; i < 3; i++) tone(b, i * 0.09, 0.07, 320, 200, WAVE.SINE, 0.35);
  for (let i = 0; i < 4; i++) tone(b, 0.3 + i * 0.065, 0.07, 440 * Math.pow(1.26, i), 440 * Math.pow(1.26, i), WAVE.SQUARE, 0.12);
  s[SOUND.DRINK] = b;
  b = buffer(0.45); noise(b, 0, 0.4, 0.35, 0.06, 0.02, 0.3); tone(b, 0, 0.4, 900, 180, WAVE.SINE, 0.2, 0.01, 0.3); s[SOUND.VANISH] = b;
  b = buffer(0.25); tone(b, 0, 0.22, 200, 760, WAVE.SQUARE, 0.15); s[SOUND.JUMP] = b;
  b = buffer(0.35); tone(b, 0, 0.32, 130, 38, WAVE.SINE, 0.8); noise(b, 0, 0.18, 0.5, 0.1); s[SOUND.LAND] = b;
  b = buffer(0.09); noise(b, 0, 0.05, 0.6, 0.6, 0.001, 0.04); tone(b, 0, 0.07, 320, 150, WAVE.SQUARE, 0.15); s[SOUND.HIT] = b;
  b = buffer(0.18); tone(b, 0, 0.16, 240, 110, WAVE.SINE, 0.5); noise(b, 0, 0.08, 0.4, 0.3); s[SOUND.HURT] = b;
  b = buffer(0.6); tone(b, 0, 0.55, 420, 70, WAVE.SAW, 0.25, 0.005, 0.2); noise(b, 0, 0.3, 0.3, 0.15); s[SOUND.KO] = b;
  b = buffer(0.3); tone(b, 0, 0.14, 620, 900, WAVE.SINE, 0.3); tone(b, 0.1, 0.18, 900, 1250, WAVE.SINE, 0.25); s[SOUND.HEAL] = b;
  b = buffer(0.7); tone(b, 0, 0.65, 95, 62, WAVE.SQUARE, 0.22, 0.02, 0.2, 0.08); noise(b, 0, 0.6, 0.3, 0.05, 0.02, 0.3); s[SOUND.FART] = b;
  b = buffer(0.4); noise(b, 0, 0.15, 0.6, 0.95, 0.001, 0.12); tone(b, 0, 0.12, 3200, 3000, WAVE.SINE, 0.15); tone(b, 0.03, 0.15, 4300, 4100, WAVE.SINE, 0.1); noise(b, 0.05, 0.35, 0.35, 0.08, 0.05, 0.25); s[SOUND.GLASS] = b;
  b = buffer(0.6); noise(b, 0, 0.55, 0.3, 0.75, 0.03, 0.2); s[SOUND.SPRAY] = b;
  b = buffer(1.1);
  for (let i = 0; i < 22; i++) { tone(b, i * 0.045, 0.04, 1250, 1250, WAVE.SQUARE, 0.08); tone(b, i * 0.045, 0.04, 1870, 1870, WAVE.SINE, 0.06); }
  s[SOUND.BELL] = b;
  b = buffer(0.3); tone(b, 0, 0.08, 880, 880, WAVE.SQUARE, 0.14); tone(b, 0.14, 0.08, 880, 880, WAVE.SQUARE, 0.14); s[SOUND.WARN] = b;
  b = buffer(0.4); tone(b, 0, 0.35, 95, 30, WAVE.SINE, 0.9); noise(b, 0, 0.2, 0.5, 0.12); s[SOUND.STOMP] = b;
  b = buffer(0.28);
  for (let i = 0; i < 7; i++) tone(b, i * 0.035, 0.035, 300 + Math.random() * 1500, 200 + Math.random() * 900, WAVE.SAW, 0.18, 0.001, 0.01);
  noise(b, 0, 0.25, 0.2, 0.9); s[SOUND.ZAP] = b;
  b = buffer(0.04); tone(b, 0, 0.03, 1200, 1100, WAVE.SQUARE, 0.12); s[SOUND.CLICK] = b;
  b = buffer(0.1); tone(b, 0, 0.09, 520, 820, WAVE.SINE, 0.25); s[SOUND.SELECT] = b;
  b = buffer(1.0);
  const notes = [523, 659, 784, 1047];
  for (let i = 0; i < notes.length; i++) tone(b, i * 0.14, i === notes.length - 1 ? 0.5 : 0.13, notes[i], notes[i], WAVE.TRIANGLE, 0.3);
  s[SOUND.FANFARE] = b;
  b = buffer(0.25); tone(b, 0, 0.1, 880, 880, WAVE.SINE, 0.25); tone(b, 0.1, 0.13, 1320, 1320, WAVE.SINE, 0.25); s[SOUND.READY] = b;
  return s;
}

export class AudioSystem {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    /** @type {AudioBuffer[]} */
    this.buffers = [];
    /** @type {GainNode|null} */
    this.master = null;
    /** @type {GainNode|null} */
    this.near = null;
    /** @type {GainNode|null} */
    this.far = null;
    this.voices = 0;
    this.muted = false;
    this.listenerX = 0;
    this.listenerY = 0;
    this.raw = synthesizeAll();
    // Fonction créée une seule fois : pas de closure par son joué.
    this.onVoiceEnded = () => { this.voices = Math.max(0, this.voices - 1); };
  }

  /** À appeler dans un gestionnaire de clic/tap (déverrouillage de l'audio par le navigateur). */
  unlock() {
    if (this.ctx !== null) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtor = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (AudioCtor === undefined) return;
    const ctx = new AudioCtor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    this.master.connect(ctx.destination);
    this.near = ctx.createGain();
    this.near.connect(this.master);
    this.far = ctx.createGain();
    this.far.gain.value = FAR_VOLUME;
    this.far.connect(this.master);
    for (const samples of this.raw) {
      const buf = ctx.createBuffer(1, samples.length, AUDIO_SYNTH_RATE);
      buf.getChannelData(0).set(samples);
      this.buffers.push(buf);
    }
  }

  /** @returns {boolean} Nouvel état « muet ». */
  toggleMute() {
    this.muted = !this.muted;
    if (this.master !== null) this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    return this.muted;
  }

  /** @param {number} x @param {number} y */
  setListener(x, y) {
    this.listenerX = x;
    this.listenerY = y;
  }

  /**
   * @param {number} id SOUND.* @param {boolean} [far] @param {number} [rate] Vitesse de lecture (variété).
   */
  play(id, far = false, rate = 1) {
    const ctx = this.ctx;
    if (ctx === null || ctx.state !== 'running' || this.voices >= MAX_AUDIO_VOICES || this.buffers.length === 0) return;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers[id];
    src.playbackRate.value = rate;
    src.connect(far ? /** @type {GainNode} */ (this.far) : /** @type {GainNode} */ (this.near));
    src.onended = this.onVoiceEnded;
    src.start();
    this.voices++;
  }

  /**
   * Son spatialisé simplement : proche = fort, loin = atténué, très loin = inaudible.
   * @param {number} id @param {number} x @param {number} y @param {number} [rate]
   */
  playAt(id, x, y, rate = 1) {
    const dx = x - this.listenerX;
    const dy = y - this.listenerY;
    const d2 = dx * dx + dy * dy;
    if (d2 > MAX_HEARING_DISTANCE * MAX_HEARING_DISTANCE) return;
    this.play(id, d2 > NEAR_DISTANCE * NEAR_DISTANCE, rate);
  }
}
