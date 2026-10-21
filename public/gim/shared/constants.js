/**
 * Toutes les constantes du jeu, partagées par le client et le serveur.
 * Règle : aucun nombre « magique » dans la logique ; s'il faut régler quelque chose, c'est ici.
 * Unités : mètres, millisecondes, radians (sauf mention contraire).
 */

// ============================================================================
// TEMPS
// ============================================================================
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_RATE;
/** Tolérance sur les minuteries : évite qu'un arrondi flottant décale une recharge d'un tick entre client et serveur. */
export const TIMER_EPSILON_MS = 0.5;
/** Nombre max de ticks rattrapés d'un coup par le serveur après un gel du processus. */
export const MAX_CATCHUP_TICKS = 10;
/** Plafond du delta de frame côté client : évite l'emballement au retour d'un onglet inactif. */
export const MAX_FRAME_DELTA_MS = 250;
export const MS_PER_SECOND = 1000;
/**
 * Zéro « flottant » pour initialiser les champs numériques non entiers des objets pré-alloués.
 * V8 fixe la représentation d'un champ à sa première écriture : un champ né à 0 (petit entier) qui reçoit
 * ensuite 1.5 fait migrer toutes les instances, et les écritures peuvent finir « emballées » (une allocation
 * par écriture, donc du GC à chaque tick). -0 n'est pas un petit entier pour V8 : le champ naît « double ».
 */
export const FLOAT_ZERO = -0;

// ============================================================================
// ARÈNE (coordonnées : x vers la droite, y vers le bas de l'écran, origine au coin haut-gauche)
// ============================================================================
export const ARENA_WIDTH = 40;
export const ARENA_HEIGHT = 26;
export const WALL_THICKNESS = 1;
export const WALL_HEIGHT = 1.6;
export const NAV_CELL_SIZE = 1;
/** Marge ajoutée autour des obstacles dans la grille de navigation des profs (≈ rayon d'un prof). */
export const NAV_INFLATE = 0.5;
export const NAV_UNREACHED = -1;
/** Petites itérations de résolution : 2 passes suffisent à sortir proprement des coins. */
export const COLLISION_ITERATIONS = 2;
export const COLLISION_EPSILON = 1e-6;

export const OBSTACLE_RECT = 1;
export const OBSTACLE_CIRCLE = 2;
export const OBSTACLE_LOOK = Object.freeze({ TABLE: 1, LOCKER: 2, PILLAR: 3, DESK: 4 });
export const TABLE_HEIGHT = 0.8;
export const LOCKER_HEIGHT = 2.1;
export const PILLAR_HEIGHT = 3.2;
export const DESK_HEIGHT = 0.9;

// ============================================================================
// CAPACITÉS (tout est pré-alloué à ces tailles)
// ============================================================================
export const MAX_PLAYERS = 12;
export const MAX_BOTS = 6;
export const MAX_PROJECTILES = 192;
export const MAX_ZONES = 24;
export const EVENT_RING_SIZE = 256;
export const MAX_EVENTS_PER_SNAPSHOT = 64;
export const MAX_INPUT_QUEUE = 30;

/** Références d'entité compactes (1 octet) : 0..63 = joueurs, 64..127 = profs. */
export const REF_NONE = 255;
export const BOT_REF_BASE = 64;

// ============================================================================
// ÉQUIPES & PARTIE
// ============================================================================
export const TEAM_A = 0;
export const TEAM_B = 1;
export const TEAM_BOTS = 2;
export const TEAM_COUNT = 2;
export const TEAM_NAMES = Object.freeze(['BLEUS', 'ROUGES', 'PROFS']);

export const ROUND_DURATION_MS = 180000;
export const ROUND_END_PAUSE_MS = 6000;
export const ROUND_PHASE_PLAYING = 0;
export const ROUND_PHASE_ENDED = 1;
export const ROUND_DRAW = 2;
export const SCORE_PER_PLAYER_KO = 1;
export const SCORE_PER_BOT_KO = 1;

// ============================================================================
// JOUEURS
// ============================================================================
export const RESPAWN_MS = 3000;
export const SPAWN_SHIELD_MS = 1500;
export const SUPER_MAX = 1;
export const REGEN_DELAY_MS = 3000;
export const REGEN_FRACTION_PER_SEC = 0.08;
/** Amortissement exponentiel des projections (1/s) : plus grand = recul plus court. */
export const KNOCKBACK_DAMPING = 7;
export const KNOCKBACK_MIN_SPEED = 0.05;
/** Distance de visée maximale transmise par le client (normalisée 0..1 sur cette valeur). */
export const MAX_AIM_DISTANCE = 12;
export const AUTO_AIM_RANGE_FACTOR = 1.3;
/** Rayon de contact ajouté pour les attaques « en fonçant » (trottinette, charge de prof). */
export const CONTACT_MARGIN = 0.2;
export const HALF = 0.5;
export const TWO_PI = Math.PI * 2;

// ============================================================================
// ZONES AU SOL
// ============================================================================
export const ZONE_TICK_MS = 250;

// ============================================================================
// PROFS (BOTS)
// ============================================================================
export const BOT_FIRST_SPAWN_MS = 8000;
export const BOT_SPAWN_INTERVAL_MS = 11000;
export const BOTS_BASE_COUNT = 1;
export const BOTS_PER_PLAYER = 0.5;
export const BOT_RETARGET_TICKS = 10;
export const NAV_UPDATE_TICKS = 6;
/** En dessous de cette distance et en ligne de vue, le prof fonce droit (plus fluide que la grille). */
export const BOT_DIRECT_CHASE_DIST = 7;
export const BOT_SEPARATION_STRENGTH = 0.5;
/** Un prof qui charge dans un mur reste sonné : récompense l'esquive. */
export const BOT_WALL_STUN_MS = 1400;
export const BOT_TURN_RATE = 8;

// ============================================================================
// ENTRÉES (boutons en champ de bits, actions renvoyées par la simulation)
// ============================================================================
export const BTN_ATTACK = 1;
export const BTN_SUPER = 2;
export const BTN_AUTO_AIM = 4;
export const BTN_VALID_MASK = 7;

export const ACTION_FIRED_MAIN = 1;
export const ACTION_FIRED_SUPER = 2;
export const ACTION_LEAP_LANDED = 4;

/** Bits d'état d'un joueur envoyés dans les snapshots. */
export const PF_DEAD = 1;
export const PF_STUNNED = 2;
export const PF_SLOWED = 4;
export const PF_SPEED = 8;
export const PF_INVISIBLE = 16;
export const PF_BLIND = 32;
export const PF_SHIELD = 64;
export const PF_DASH = 128;
export const PF_AIRBORNE = 256;
export const PF_TEAM_B = 512;

/** Bits d'état d'un prof. */
export const BF_STUNNED = 1;
export const BF_SLOWED = 2;
export const BF_BLIND = 4;

// ============================================================================
// TYPES D'ATTAQUES, VISUELS, ÉVÉNEMENTS
// ============================================================================
export const ATTACK_KIND = Object.freeze({
  PROJECTILE: 1, LOB: 2, MELEE: 3, BEAM: 4, DASH: 5, NOVA: 6, ZONE_SELF: 7, BUFF: 8, LEAP: 9,
});
export const VISUAL = Object.freeze({
  NONE: 0, CHOUCROUTE: 1, MOLOTOV: 2, VINYL: 3, BRIOCHE: 4, BOBINE: 5, BILLET: 6, ELECTRIC: 7,
});
export const PROJECTILE_VISUAL_COUNT = 8;
export const ZONE_VISUAL = Object.freeze({ NONE: 0, FIRE: 1, GAS: 2, PERFUME: 3 });
export const ZONE_VISUAL_COUNT = 4;

export const EVENT = Object.freeze({
  HIT: 1, HEAL: 2, KO: 3, ATTACK: 4, IMPACT: 5, LAND: 6, RESPAWN: 7,
  BOT_SPAWN: 8, BOT_WINDUP: 9, BOT_STRIKE: 10, ROUND_END: 11, ROUND_START: 12,
});

export const BOT_BEHAVIOR = Object.freeze({ MELEE: 1, CHARGE: 2 });
export const BOT_STATE = Object.freeze({ IDLE: 0, CHASE: 1, WINDUP: 2, CHARGE: 3, RECOVER: 4 });

// ============================================================================
// RÉSEAU
// ============================================================================
export const MSG = Object.freeze({ INPUT: 1, PING: 2, SNAPSHOT: 10, PONG: 11 });
export const INPUT_MESSAGE_BYTES = 13;
export const PING_MESSAGE_BYTES = 9;
export const PONG_MESSAGE_BYTES = 17;
export const MAX_BINARY_MESSAGE_BYTES = 32;
export const MAX_TEXT_MESSAGE_BYTES = 256;
/** Garde-fou bas niveau de `ws` : une trame plus grosse coupe la connexion. */
export const WS_MAX_PAYLOAD_BYTES = 1024;
export const SNAPSHOT_BUFFER_BYTES = 16384;
export const RATE_LIMIT_BURST = 60;
export const RATE_LIMIT_PER_SEC = 45;
export const MAX_SEQ_JUMP = 900;
/** Au-delà de ce retard d'inputs en file, le serveur en traite 2 par tick pour rattraper. */
export const INPUT_CATCHUP_THRESHOLD = 4;
/** File d'inputs vide : le serveur attend l'input en retard pendant ce nombre de ticks avant d'avancer « à vide ». */
export const INPUT_STARVE_GRACE_TICKS = 6;
export const INVALID_LOG_INTERVAL_MS = 5000;
/** Après un retour au menu, les inputs encore en vol pendant ce délai sont ignorés sans être journalisés. */
export const LEAVE_GRACE_MS = 2000;
export const MAX_NAME_LENGTH = 16;
export const MAX_ROOM_LENGTH = 16;
export const DEFAULT_ROOM = 'gim';
export const DEFAULT_PORT = 3000;
export const MAX_ROOMS = 16;

/** Quantifications (entiers sur le fil) */
export const POS_SCALE = 100;
export const ANGLE_QUANT_MAX = 65535;
export const MOVE_QUANT = 127;
export const AIM_DIST_QUANT = 255;
export const PERCENT_SCALE = 100;
export const PROGRESS_QUANT = 255;
export const ZONE_RADIUS_SCALE = 20;
export const BEAM_LENGTH_SCALE = 100;
export const UINT16_MAX = 65535;
export const UINT8_MAX = 255;
export const NET_ID_MASK = 0xffff;

/** Three.js : servi depuis client/vendor/ s'il a été téléchargé (npm run vendor), sinon redirigé vers le CDN. */
export const THREE_VERSION = '0.170.0';
export const THREE_CDN_BASE = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/`;

export const PING_INTERVAL_MS = 1000;
export const INTERP_DELAY_MS = 100;
/** Délai d'interpolation adaptatif (réseau qui saccade) : jamais au-delà. */
export const MAX_INTERP_DELAY_MS = 250;
export const CLOCK_SMOOTHING = 0.1;
export const CLOCK_SNAP_THRESHOLD_MS = 250;
export const MAX_EXTRAPOLATION_MS = 100;
export const SNAPSHOT_BUFFER_SIZE = 32;
export const PENDING_INPUT_CAPACITY = 128;
export const RECONNECT_DELAY_MS = 2000;

// ============================================================================
// RENDU 3D
// ============================================================================
export const CAMERA_FOV = 40;
export const CAMERA_NEAR = 0.5;
export const CAMERA_FAR = 200;
/** Position de la caméra relative au joueur : en hauteur et en arrière (vers le bas de l'écran). */
export const CAMERA_HEIGHT = 18;
export const CAMERA_BACK = 10;
/** Sur écran étroit (portrait), on recule la caméra pour voir au moins cette largeur de terrain. */
export const CAMERA_MIN_VISIBLE_WIDTH = 16;
export const CAMERA_DAMPING = 7;
export const CAMERA_AIM_LEAD = 2.2;
export const SHAKE_DECAY = 7;
export const SHAKE_MAX = 0.7;
export const SHAKE_FREQUENCY = 47;
export const SHAKE_HIT_TAKEN = 0.28;
export const SHAKE_KO = 0.45;
export const SHAKE_IMPACT = 0.15;
export const SHAKE_FIRE = 0.05;
export const HIT_FLASH_MS = 110;
export const RECOIL_MS = 140;
export const RECOIL_DISTANCE = 0.18;
export const ATTACK_ANIM_MS = 260;
export const CORRECTION_SMOOTHING = 14;
export const CORRECTION_SNAP_DIST = 2.5;

export const MAX_DPR_DESKTOP = 2;
export const MAX_DPR_MOBILE = 1.5;
export const PROJECTILE_HEIGHT = 0.9;
export const LOB_HEIGHT = 2.6;
export const LEAP_HEIGHT = 3.4;
export const BEAM_HEIGHT = 1.1;
export const LABEL_HEIGHT = 2.3;
export const WALK_CYCLE_SPEED = 2.6;
export const WALK_SWING = 0.7;
export const WALK_BOB = 0.06;
export const IDLE_BREATH_SPEED = 2.2;
export const IDLE_BREATH = 0.02;
export const MODEL_CACHE_PER_SLOT = 9;
export const INVISIBLE_ALLY_OPACITY = 0.35;
export const SHIELD_PULSE_SPEED = 6;

export const MAX_PARTICLES = 800;
export const MAX_DAMAGE_NUMBERS = 48;
export const MAX_SWING_EFFECTS = 12;
export const MAX_BEAM_EFFECTS = 8;
export const MAX_RING_EFFECTS = 16;
export const MAX_TELEGRAPHS = 8;
export const MAX_PROJECTILE_INSTANCES = 96;
export const PARTICLE_GRAVITY = 9;
export const PARTICLE_DRAG = 2;
export const SWING_EFFECT_MS = 200;
export const BEAM_EFFECT_MS = 160;
export const RING_EFFECT_MS = 380;
export const DAMAGE_NUMBER_LIFE_MS = 800;
export const DAMAGE_NUMBER_RISE = 1.4;
export const ZONE_PUFFS = 6;
export const ZONE_EMBER_CHANCE = 0.35;
export const PROJECTILE_SPIN = 9;

export const TEAM_COLORS = Object.freeze([0x3d8bff, 0xff4d5e, 0xffa62b]);
/** Anneau doré sous son propre perso : on se repère tout de suite dans la mêlée. */
export const LOCAL_RING_COLOR = 0xffe14d;
export const AIM_COLOR = 0xffffff;
export const AIM_SUPER_COLOR = 0xffd23f;
export const AIM_OPACITY = 0.22;
export const AIM_LINE_WIDTH = 0.5;
/** Le canvas WebGL sert de « tableau noir » derrière le menu. */
export const MENU_BG_COLOR = 0x1e3b2f;
export const PREVIEW_BG_COLOR = 0x24493a;
export const CONNECT_TIMEOUT_MS = 15000;
export const PREVIEW_SPIN_SPEED = 0.6;
export const PREVIEW_ATTACK_EVERY_S = 2.5;
export const TEAM_CSS = Object.freeze(['#3d8bff', '#ff4d5e', '#ffa62b']);
export const HEAL_CSS = '#4ade80';
export const DAMAGE_CSS = '#ffffff';
export const BG_COLOR = 0x1d2433;
export const FLOOR_COLOR_A = '#d9cfb8';
export const FLOOR_COLOR_B = '#cfc4ab';
export const FLOOR_LINE_COLOR = '#b8ab8f';
export const FLOOR_TEXTURE_PX_PER_M = 32;
export const WALL_COLOR = 0x6b7a99;
export const WALL_TOP_COLOR = 0x8a98b8;

// ============================================================================
// HUD (pixels CSS)
// ============================================================================
export const HUD_MARGIN = 12;
export const HUD_FONT = '700 14px system-ui, sans-serif';
export const HUD_FONT_SMALL = '600 11px system-ui, sans-serif';
export const HUD_FONT_BIG = '800 22px system-ui, sans-serif';
export const HUD_FONT_HUGE = '900 40px system-ui, sans-serif';
export const HUD_FONT_DAMAGE = '900 18px system-ui, sans-serif';
export const HEALTH_BAR_WIDTH = 54;
export const HEALTH_BAR_HEIGHT = 7;
export const HEALTH_BAR_OFFSET_Y = 14;
export const KILL_FEED_SIZE = 4;
export const KILL_FEED_LIFE_MS = 5000;
export const KILL_FEED_LINE = 20;
export const DEBUG_LINE = 16;
export const BLIND_VISIBLE_RADIUS = 0.16;
export const FPS_SMOOTHING = 0.05;
export const MAX_CACHED_NUMBER = 9999;

// ============================================================================
// COMMANDES TACTILES
// ============================================================================
export const JOYSTICK_RADIUS_PX = 58;
export const JOYSTICK_KNOB_PX = 26;
export const JOYSTICK_DEADZONE_PX = 10;
export const TAP_MAX_MS = 220;
export const ATTACK_LATCH_MS = 350;
export const SUPER_BUTTON_RADIUS_PX = 40;
/** Position du bouton super : fraction de la largeur/hauteur de l'écran. */
export const SUPER_BUTTON_X = 0.87;
export const SUPER_BUTTON_Y = 0.52;
export const JOYSTICK_LEFT_HOME_X = 0.14;
export const JOYSTICK_RIGHT_HOME_X = 0.8;
export const JOYSTICK_HOME_Y = 0.78;

// ============================================================================
// AUDIO
// ============================================================================
export const MASTER_VOLUME = 0.45;
export const MAX_AUDIO_VOICES = 14;
export const AUDIO_SYNTH_RATE = 22050;
