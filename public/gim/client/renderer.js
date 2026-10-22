import * as THREE from 'three';
import {
  ARENA_WIDTH, ARENA_HEIGHT, WALL_THICKNESS, WALL_HEIGHT, OBSTACLE_RECT, OBSTACLE_LOOK, TABLE_HEIGHT, DESK_HEIGHT,
  LOCKER_HEIGHT, MAX_PLAYERS, MAX_BOTS, MAX_ZONES, PROJECTILE_VISUAL_COUNT, MAX_PROJECTILE_INSTANCES,
  CAMERA_FOV, CAMERA_NEAR, CAMERA_FAR, CAMERA_HEIGHT, CAMERA_BACK, CAMERA_MIN_VISIBLE_WIDTH, CAMERA_DAMPING,
  CAMERA_AIM_LEAD, SHAKE_DECAY, SHAKE_MAX, SHAKE_FREQUENCY, MAX_DPR_DESKTOP, MAX_DPR_MOBILE, PROJECTILE_HEIGHT,
  LOB_HEIGHT, PROJECTILE_SPIN, ZONE_PUFFS, ZONE_EMBER_CHANCE, ZONE_VISUAL, VISUAL, TEAM_COLORS, TEAM_BOTS,
  LOCAL_RING_COLOR, BG_COLOR, WALL_COLOR, WALL_TOP_COLOR, FLOOR_COLOR_A, FLOOR_COLOR_B, FLOOR_LINE_COLOR,
  FLOOR_TEXTURE_PX_PER_M, PF_DEAD, PF_STUNNED, PF_INVISIBLE, PF_SHIELD, PF_DASH, BF_STUNNED, BOT_STATE,
  BOT_BEHAVIOR, ATTACK_KIND, AIM_COLOR, AIM_SUPER_COLOR, AIM_OPACITY, AIM_LINE_WIDTH, MAX_AIM_DISTANCE,
  PREVIEW_SPIN_SPEED, PREVIEW_ATTACK_EVERY_S, MENU_BG_COLOR, PREVIEW_BG_COLOR, BOT_REF_BASE, HALF, TWO_PI, FLOAT_ZERO, MODE_BR,
} from '../shared/constants.js';
import { ARENA, MAPS, inHideout } from '../shared/arena.js';
import { BRAWLERS, BRAWLER_COUNT } from '../shared/brawlers.js';
import { PROFS, PROF_COUNT } from '../shared/profs.js';
import { buildCharacter, fitToRadius, setRingColor, animateCharacter, triggerAttack, triggerFlash, setInvisibleLook, createProjectileGeometries, mergeColored, SHARED_GEOMETRY } from './models.js';
import { Effects } from './effects.js';

const HALF_W = ARENA_WIDTH * HALF; const HALF_H = ARENA_HEIGHT * HALF;
const DECOR = Object.freeze({
  WOOD: 0xc69c6d, WOOD_DARK: 0x8b5e34, WOOD_TOP: 0xd9b382, LEG: 0x4b5563, LOCKER: 0x4a6fa5, LOCKER_LINE: 0x2c4470,
  CONCRETE: 0xd6d3cc, CONCRETE_BASE: 0xa8a29e, OUTSIDE: 0x161b26, BOARD: 0x1f4d3a, BOARD_FRAME: 0x7a5230,
  TABLE_TOP: 0.08, TABLE_LEG: 0.07, TABLE_INSET: 0.15, LOCKER_DOOR: 0.6, PILLAR_BASE: 0.25,
  BOARD_WIDTH: 9, BOARD_HEIGHT: 1.1, BOARD_Y: 1.0, HEMI: 1.5, SUN: 2.0, SUN_X: -10, SUN_Y: 24, SUN_Z: 12,
  SPAWN_TINT: 4, CENTER_CIRCLE: 3, DOOR_HALF: 1.2, DOOR_DEPTH: 0.6, SHELF: 0x6b4423, SHELF_BOARD: 0x8a5a30, RUG: 0x3a2f4f, RACK: 0x3b3b3b,
});
const BOOK_COLORS = Object.freeze([0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xe67e22, 0xecf0f1]);
const COAT_COLORS = Object.freeze([0x2c3e50, 0x7f8c8d, 0x8e2b2b, 0x1f5f3f, 0x34495e, 0xa0522d, 0x5d3a7a, 0x2e4053]);
const COAT_SPACING = 0.55; const COAT_HEIGHT = 1.45;
const ZONE_STYLE = Object.freeze([ null, Object.freeze({ disc: 0xff5a1f, discOpacity: 0.38, rim: 0xffb02e, puff: 0xff8a3d, puffOpacity: 0, particle: 0xff7a1a }), Object.freeze({ disc: 0x8fbf2a, discOpacity: 0.22, rim: 0xc5e86c, puff: 0xa8cf4f, puffOpacity: 0.42, particle: 0xb5d65a }), Object.freeze({ disc: 0xff7ac8, discOpacity: 0.2, rim: 0xffb3e1, puff: 0xffc6ec, puffOpacity: 0.32, particle: 0xffd1f0 }), ]);
const ZONE_PUFF_SIZE = 0.38; const ZONE_PUFF_ORBIT = 0.55; const ZONE_PUFF_SPEED = 0.7; const ZONE_PUFF_HEIGHT = 0.6;
const EMBER_SPEED = 1.2; const EMBER_SIZE = 0.22; const EMBER_LIFE_MS = 700; const TRAIL_CHANCE = 0.5;

export class Renderer {
  constructor(canvas, isMobile) {
    this.isMobile = isMobile;
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? MAX_DPR_MOBILE : MAX_DPR_DESKTOP));
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(BG_COLOR);
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
    this.zoom = 1; this.camTarget = new THREE.Vector3(0, 0, 0); this.camGoal = new THREE.Vector3(0, 0, 0);
    this.shake = FLOAT_ZERO; this.shakeTime = FLOAT_ZERO;
    this.addLights(this.scene);
    this.arena = ARENA; this.arenaGroup = new THREE.Group(); this.scene.add(this.arenaGroup);
    this.buildArena(); this.effects = new Effects(this.scene);
    this.playerCache = new Map(); this.playerShown = new Array(MAX_PLAYERS).fill(null); this.pendingAttack = new Float64Array(MAX_PLAYERS);
    this.botCache = new Map(); this.botShown = new Array(MAX_BOTS).fill(null);
    this.poseInput = { x: FLOAT_ZERO, y: FLOAT_ZERO, sceneX: FLOAT_ZERO, sceneZ: FLOAT_ZERO, facing: FLOAT_ZERO, air: FLOAT_ZERO, stunned: false, dashing: false, shielded: false, crawlTarget: FLOAT_ZERO, dt: FLOAT_ZERO, time: FLOAT_ZERO, };
    
    const stormGeo = new THREE.CylinderGeometry(1, 1, 40, 64, 1, true);
    this.stormMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.4, side: THREE.BackSide, depthWrite: false });
    this.stormMesh = new THREE.Mesh(stormGeo, this.stormMat);
    this.stormMesh.visible = false;
    this.scene.add(this.stormMesh);

    this.buildProjectiles(); this.buildZones(); this.buildAimIndicator(); this.buildPreview();
    this.raycaster = new THREE.Raycaster(); this.ndc = new THREE.Vector2(); this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3(); this.projected = new THREE.Vector3(); this.dummy = new THREE.Object3D(); this.dummy.rotation.order = 'YXZ';
    this.viewWidth = 1; this.viewHeight = 1; this.resize();
  }

  addLights(scene) { scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, DECOR.HEMI)); const sun = new THREE.DirectionalLight(0xffffff, DECOR.SUN); sun.position.set(DECOR.SUN_X, DECOR.SUN_Y, DECOR.SUN_Z); scene.add(sun); }

  createFloorTexture() {
    const px = FLOOR_TEXTURE_PX_PER_M; const canvas = document.createElement('canvas'); canvas.width = this.arena.width * px; canvas.height = this.arena.height * px;
    const ctx = canvas.getContext('2d'); const cdi = this.arena.hideouts.length > 0;
    for (let y = 0; y < this.arena.height; y++) { for (let x = 0; x < this.arena.width; x++) { ctx.fillStyle = cdi ? ((x + y) % 2 === 0 ? '#5d7fa6' : '#56789e') : (x + y) % 2 === 0 ? FLOOR_COLOR_A : FLOOR_COLOR_B; ctx.fillRect(x * px, y * px, px, px); } }
    ctx.strokeStyle = FLOOR_LINE_COLOR; ctx.lineWidth = 1;
    for (let x = 0; x <= this.arena.width; x++) { ctx.beginPath(); ctx.moveTo(x * px, 0); ctx.lineTo(x * px, canvas.height); ctx.stroke(); }
    for (let y = 0; y <= this.arena.height; y++) { ctx.beginPath(); ctx.moveTo(0, y * px); ctx.lineTo(canvas.width, y * px); ctx.stroke(); }
    if (this.arena.id !== 2) { 
      ctx.fillStyle = 'rgba(61,139,255,0.18)'; ctx.fillRect(0, 0, DECOR.SPAWN_TINT * px, canvas.height);
      ctx.fillStyle = 'rgba(255,77,94,0.18)'; ctx.fillRect(canvas.width - DECOR.SPAWN_TINT * px, 0, DECOR.SPAWN_TINT * px, canvas.height);
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = px * 0.12;
      ctx.beginPath(); ctx.moveTo(canvas.width * HALF, 0); ctx.lineTo(canvas.width * HALF, canvas.height); ctx.stroke();
      ctx.beginPath(); ctx.arc(canvas.width * HALF, canvas.height * HALF, DECOR.CENTER_CIRCLE * px, 0, TWO_PI); ctx.stroke();
    }
    for (const h of this.arena.hideouts) {
      ctx.fillStyle = 'rgba(40,24,60,0.55)'; ctx.fillRect(h.minX * px, h.minY * px, (h.maxX - h.minX) * px, (h.maxY - h.minY) * px);
      ctx.strokeStyle = 'rgba(245,230,99,0.8)'; ctx.setLineDash([px * 0.3, px * 0.2]); ctx.lineWidth = px * 0.08;
      ctx.strokeRect(h.minX * px, h.minY * px, (h.maxX - h.minX) * px, (h.maxY - h.minY) * px); ctx.setLineDash([]);
    }
    for (const door of this.arena.botSpawns) {
      const dx = (door.x - DECOR.DOOR_HALF) * px; const dy = door.y < this.arena.height * HALF ? 0 : canvas.height - DECOR.DOOR_DEPTH * px;
      for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 === 0 ? '#f5c518' : '#222'; ctx.fillRect(dx + (i * DECOR.DOOR_HALF * 2 * px) / 6, dy, (DECOR.DOOR_HALF * 2 * px) / 6, DECOR.DOOR_DEPTH * px); }
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; return texture;
  }

  createBoardTexture() {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128; const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1f4d3a'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 46px "Comic Sans MS", cursive'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('GIM BATTLE — interro surprise : survivre', canvas.width * HALF, canvas.height * HALF);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  }

  buildArena() {
    const aw = this.arena.width; const ah = this.arena.height; const hw = aw * HALF; const hh = ah * HALF;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(aw, ah), new THREE.MeshLambertMaterial({ map: this.createFloorTexture() }));
    floor.rotation.x = -Math.PI * HALF; this.arenaGroup.add(floor);
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(aw * 4, ah * 4), new THREE.MeshBasicMaterial({ color: DECOR.OUTSIDE }));
    outside.rotation.x = -Math.PI * HALF; outside.position.y = -0.02; this.arenaGroup.add(outside);

    const G = SHARED_GEOMETRY; const parts = []; const push = (geo, color, sx, sy, sz, x, y, z) => { parts.push({ geo, color, x, y, z, rx: 0, ry: 0, rz: 0, sx, sy, sz }); };
    const T = WALL_THICKNESS;
    push(G.box, WALL_COLOR, aw + T * 2, WALL_HEIGHT, T, 0, WALL_HEIGHT * HALF, -hh - T * HALF); push(G.box, WALL_COLOR, aw + T * 2, WALL_HEIGHT, T, 0, WALL_HEIGHT * HALF, hh + T * HALF);
    push(G.box, WALL_COLOR, T, WALL_HEIGHT, ah, -hw - T * HALF, WALL_HEIGHT * HALF, 0); push(G.box, WALL_COLOR, T, WALL_HEIGHT, ah, hw + T * HALF, WALL_HEIGHT * HALF, 0);
    push(G.box, WALL_TOP_COLOR, aw + T * 2, 0.1, T, 0, WALL_HEIGHT, -hh - T * HALF); push(G.box, WALL_TOP_COLOR, aw + T * 2, 0.1, T, 0, WALL_HEIGHT, hh + T * HALF);
    push(G.box, WALL_TOP_COLOR, T, 0.1, ah, -hw - T * HALF, WALL_HEIGHT, 0); push(G.box, WALL_TOP_COLOR, T, 0.1, ah, hw + T * HALF, WALL_HEIGHT, 0);
    if (this.arena.id !== 2) push(G.box, DECOR.BOARD_FRAME, DECOR.BOARD_WIDTH + 0.2, DECOR.BOARD_HEIGHT + 0.2, 0.05, 0, DECOR.BOARD_Y, -hh + 0.02);
    for (const o of this.arena.obstacles) this.addObstacleParts(o, push, hw, hh);
    this.arena.hideouts.forEach((h, i) => this.addHideoutParts(h, i, push, hw, hh));
    const decor = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.arenaGroup.add(decor);

    if (this.arena.id !== 2) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(DECOR.BOARD_WIDTH, DECOR.BOARD_HEIGHT), new THREE.MeshBasicMaterial({ map: this.createBoardTexture() }));
      board.position.set(0, DECOR.BOARD_Y, -hh + 0.05); this.arenaGroup.add(board);
    }
  }

  setArena(arena) {
    if (arena === undefined || arena === this.arena) return;
    this.arena = arena;
    for (const child of this.arenaGroup.children.slice()) {
      this.arenaGroup.remove(child); const mesh = child; mesh.geometry?.dispose(); const mat = mesh.material; mat?.map?.dispose(); mat?.dispose();
    }
    this.buildArena();
  }

  addHideoutParts(h, index, push, hw, hh) {
    const G = SHARED_GEOMETRY; const w = h.maxX - h.minX; const d = h.maxY - h.minY;
    const cols = Math.max(1, Math.floor(w / COAT_SPACING)); const rows = Math.max(1, Math.floor(d / COAT_SPACING));
    let n = index * 7;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        n++; const x = h.minX + (c + 0.5) * (w / cols) - hw + ((n * 37) % 7 - 3) * 0.02; const z = h.minY + (r + 0.5) * (d / rows) - hh + ((n * 53) % 7 - 3) * 0.02;
        const height = COAT_HEIGHT - ((n * 29) % 5) * 0.06; push(G.box, COAT_COLORS[n % COAT_COLORS.length], 0.46, height, 0.4, x, height * HALF, z);
      }
    }
    for (let r = 0; r < rows; r++) { const z = h.minY + (r + 0.5) * (d / rows) - hh; push(G.box, DECOR.RACK, w, 0.05, 0.05, h.minX + w * HALF - hw, COAT_HEIGHT + 0.08, z); }
  }

  addObstacleParts(o, push, hw, hh) {
    const G = SHARED_GEOMETRY; const x = o.cx - hw; const z = o.cy - hh;
    if (o.kind !== OBSTACLE_RECT) { push(G.cylinder, DECOR.CONCRETE, o.r, o.height, o.r, x, o.height * HALF, z); push(G.cylinder, DECOR.CONCRETE_BASE, o.r * 1.15, DECOR.PILLAR_BASE, o.r * 1.15, x, DECOR.PILLAR_BASE * HALF, z); return; }
    const w = o.halfW * 2; const d = o.halfH * 2;
    if (o.look === OBSTACLE_LOOK.TABLE) {
      push(G.box, DECOR.WOOD, w, DECOR.TABLE_TOP, d, x, TABLE_HEIGHT - DECOR.TABLE_TOP * HALF, z); const legH = TABLE_HEIGHT - DECOR.TABLE_TOP; const ix = o.halfW - DECOR.TABLE_INSET; const iz = o.halfH - DECOR.TABLE_INSET;
      for (let sx = -1; sx <= 1; sx += 2) { for (let sz = -1; sz <= 1; sz += 2) push(G.box, DECOR.LEG, DECOR.TABLE_LEG, legH, DECOR.TABLE_LEG, x + sx * ix, legH * HALF, z + sz * iz); }
    } else if (o.look === OBSTACLE_LOOK.SHELF) {
      const height = o.height; push(G.box, DECOR.SHELF, w, height, d, x, height * HALF, z); const long = Math.max(w, d); const books = Math.max(2, Math.floor(long / 0.22));
      for (let level = 0; level < 4; level++) {
        const y = 0.25 + level * (height - 0.3) / 4; push(G.box, DECOR.SHELF_BOARD, w + 0.04, 0.04, d + 0.04, x, y - 0.03, z);
        for (let i = 0; i < books; i++) {
          const t = -long * HALF + (long * (i + 0.5)) / books; const bh = 0.24 + ((i * 7 + level * 3) % 4) * 0.03; const color = BOOK_COLORS[(i * 3 + level * 5) % BOOK_COLORS.length];
          if (d >= w) push(G.box, color, w + 0.06, bh, long / books * 0.8, x, y + bh * HALF, z + t); else push(G.box, color, long / books * 0.8, bh, x + t, y + bh * HALF, z);
        }
      }
    } else if (o.look === OBSTACLE_LOOK.DESK) { push(G.box, DECOR.WOOD_DARK, w, DESK_HEIGHT, d, x, DESK_HEIGHT * HALF, z); push(G.box, DECOR.WOOD_TOP, w + 0.1, 0.06, d + 0.1, x, DESK_HEIGHT, z);
    } else {
      push(G.box, DECOR.LOCKER, w, LOCKER_HEIGHT, d, x, LOCKER_HEIGHT * HALF, z); const long = Math.max(w, d); const doors = Math.max(1, Math.round(long / DECOR.LOCKER_DOOR));
      for (let i = 1; i < doors; i++) { const t = -long * HALF + (long * i) / doors; if (d >= w) { push(G.box, DECOR.LOCKER_LINE, w + 0.02, LOCKER_HEIGHT * 0.92, 0.03, x, LOCKER_HEIGHT * HALF, z + t); } else { push(G.box, DECOR.LOCKER_LINE, 0.03, LOCKER_HEIGHT * 0.92, d + 0.02, x + t, LOCKER_HEIGHT * HALF, z); } }
    }
  }

  buildProjectiles() {
    const geometries = createProjectileGeometries(); const lit = new THREE.MeshLambertMaterial({ vertexColors: true }); const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.projectileMeshes = new Array(PROJECTILE_VISUAL_COUNT); this.projectileCounts = new Int32Array(PROJECTILE_VISUAL_COUNT);
    for (let v = 0; v < PROJECTILE_VISUAL_COUNT; v++) {
      const mesh = new THREE.InstancedMesh(geometries[v], v === VISUAL.ELECTRIC ? glow : lit, MAX_PROJECTILE_INSTANCES);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.frustumCulled = false; this.scene.add(mesh); this.projectileMeshes[v] = mesh;
    }
  }

  buildZones() {
    this.zoneSlots = new Array(MAX_ZONES);
    for (let i = 0; i < MAX_ZONES; i++) {
      const group = new THREE.Group(); const discMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }); const rimMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }); const puffMat = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false });
      const disc = new THREE.Mesh(SHARED_GEOMETRY.circle, discMat); disc.position.y = 0.04; const rim = new THREE.Mesh(SHARED_GEOMETRY.ring, rimMat); rim.position.y = 0.05; group.add(disc, rim);
      const puffs = new Array(ZONE_PUFFS); for (let k = 0; k < ZONE_PUFFS; k++) { puffs[k] = new THREE.Mesh(SHARED_GEOMETRY.lowSphere, puffMat); group.add(puffs[k]); }
      group.visible = false; this.scene.add(group); this.zoneSlots[i] = { group, discMat, rimMat, puffMat, puffs, visual: -1 };
    }
  }

  buildAimIndicator() {
    const lineGeo = new THREE.PlaneGeometry(1, 1); lineGeo.rotateX(-Math.PI * HALF); lineGeo.translate(HALF, 0, 0);
    this.aimMaterial = new THREE.MeshBasicMaterial({ color: AIM_COLOR, transparent: true, opacity: AIM_OPACITY, depthWrite: false });
    this.aimLine = new THREE.Mesh(lineGeo, this.aimMaterial); this.aimArea = new THREE.Mesh(SHARED_GEOMETRY.circle, this.aimMaterial);
    this.aimLine.position.y = 0.07; this.aimArea.position.y = 0.075; this.aimLine.visible = false; this.aimArea.visible = false; this.scene.add(this.aimLine, this.aimArea);
  }

  buildPreview() {
    this.previewScene = new THREE.Scene(); this.previewScene.background = new THREE.Color(PREVIEW_BG_COLOR); this.addLights(this.previewScene);
    this.previewCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 50); this.previewCamera.position.set(0, 1.7, 5.2); this.previewCamera.lookAt(0, 1.05, 0);
    const pedestal = new THREE.Mesh(SHARED_GEOMETRY.cylinder, new THREE.MeshLambertMaterial({ color: 0x3a5f4c })); pedestal.scale.set(1.2, 0.2, 1.2); pedestal.position.y = -0.1; this.previewScene.add(pedestal);
    this.turntable = new THREE.Group(); this.previewScene.add(this.turntable);
    this.previewBrawlers = []; this.previewProfs = [];
    for (const b of BRAWLERS) this.previewBrawlers.push(this.createPreviewModel(b.look, b.radius, Number.parseInt(b.accent.slice(1), 16)));
    for (const p of PROFS) this.previewProfs.push(this.createPreviewModel(p.look, p.radius, TEAM_COLORS[TEAM_BOTS]));
    this.previewAttackTimer = FLOAT_ZERO; this.previewAspect = 0;
  }

  createPreviewModel(look, radius, color) { const model = buildCharacter(look, color); fitToRadius(model, radius); model.root.visible = false; this.turntable.add(model.root); return model; }

  getPlayerModel(slot, brawlerId) {
    const key = slot * BRAWLER_COUNT + brawlerId; let model = this.playerCache.get(key);
    if (model === undefined) { const def = BRAWLERS[brawlerId]; model = buildCharacter(def.look, TEAM_COLORS[0]); fitToRadius(model, def.radius); model.root.visible = false; this.scene.add(model.root); this.playerCache.set(key, model); }
    return model;
  }

  getBotModel(slot, type) {
    const key = slot * PROF_COUNT + type; let model = this.botCache.get(key);
    if (model === undefined) { const def = PROFS[type]; model = buildCharacter(def.look, TEAM_COLORS[TEAM_BOTS]); fitToRadius(model, def.radius); model.root.visible = false; this.scene.add(model.root); this.botCache.set(key, model); }
    return model;
  }

  modelForRef(ref) { if (ref < MAX_PLAYERS) return this.playerShown[ref]; const slot = ref - BOT_REF_BASE; return slot >= 0 && slot < MAX_BOTS ? this.botShown[slot] : null; }
  flashRef(ref) { const model = this.modelForRef(ref); if (model !== null) triggerFlash(model); }
  attackAnimRef(ref) { const model = this.modelForRef(ref); if (model !== null) triggerAttack(model); else if (ref < MAX_PLAYERS) this.pendingAttack[ref] = performance.now(); }
  addShake(amount) { this.shake = Math.min(SHAKE_MAX, this.shake + amount); }

  renderGame(views, dt, time, aim, spectateRef = -1) {
    this.setArena(MAPS[views.mapId]);
    
    if (views.gameMode === MODE_BR && views.stormRadius < 200) {
      this.stormMesh.visible = true;
      this.stormMesh.position.set(views.stormX - (this.arena.width * HALF), 20, views.stormY - (this.arena.height * HALF));
      this.stormMesh.scale.set(views.stormRadius, 1, views.stormRadius);
    } else {
      this.stormMesh.visible = false;
    }

    this.updateCamera(views, dt, aim, spectateRef);
    this.updatePlayers(views, dt, time);
    this.updateBots(views, dt, time);
    this.updateProjectiles(views, time);
    this.updateZones(views, time);
    this.updateAim(aim);
    this.effects.update(dt);
    this.webgl.setScissorTest(false);
    this.webgl.setViewport(0, 0, this.viewWidth, this.viewHeight);
    this.webgl.render(this.scene, this.camera);
  }

  updateCamera(views, dt, aim, spectateRef) {
    let target = null;
    if (spectateRef >= 0 && spectateRef < MAX_PLAYERS) {
      target = views.players[spectateRef];
    } else if (views.localSlot >= 0) {
      target = views.players[views.localSlot];
    }
    
    if (target !== null && target.active) {
      const lead = aim.visible ? CAMERA_AIM_LEAD : 0;
      this.camGoal.set(target.x - (this.arena.width * HALF) + Math.cos(target.aim) * lead, 0, target.y - (this.arena.height * HALF) + Math.sin(target.aim) * lead);
    }
    
    this.camTarget.lerp(this.camGoal, 1 - Math.exp(-CAMERA_DAMPING * dt));
    this.shakeTime += dt; this.shake *= Math.exp(-SHAKE_DECAY * dt);
    const sx = Math.sin(this.shakeTime * SHAKE_FREQUENCY) * this.shake; const sz = Math.cos(this.shakeTime * SHAKE_FREQUENCY * 1.3) * this.shake;
    this.camera.position.set(this.camTarget.x + sx, CAMERA_HEIGHT * this.zoom, this.camTarget.z + CAMERA_BACK * this.zoom + sz);
    this.camera.lookAt(this.camTarget.x + sx, 0, this.camTarget.z + sz);
  }

  pose(model, x, y, facing, air, stunned, dashing, shielded, crawl, dt, time) {
    const hw = this.arena.width * HALF; const hh = this.arena.height * HALF;
    const p = this.poseInput; p.x = x; p.y = y; p.sceneX = x - hw; p.sceneZ = y - hh; p.facing = facing; p.air = air;
    p.stunned = stunned; p.dashing = dashing; p.shielded = shielded; p.crawlTarget = crawl; p.dt = dt; p.time = time;
    animateCharacter(model, p);
  }

  updatePlayers(views, dt, time) {
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const v = views.players[slot]; const shown = this.playerShown[slot];
      if (!v.active || (v.flags & PF_DEAD) !== 0) { if (shown !== null) { shown.root.visible = false; this.playerShown[slot] = null; } continue; }
      const model = this.getPlayerModel(slot, v.brawlerId);
      if (shown !== model) { if (shown !== null) shown.root.visible = false; model.root.visible = true; model.lastX = NaN; this.playerShown[slot] = model; }
      if (this.pendingAttack[slot] > 0) { if (performance.now() - this.pendingAttack[slot] < 300) triggerAttack(model); this.pendingAttack[slot] = 0; }
      
      let ringColor;
      if (slot === views.localSlot) { ringColor = LOCAL_RING_COLOR; } else if (views.gameMode === MODE_BR) { ringColor = 0xff4d5e; } else { ringColor = TEAM_COLORS[v.team]; }
      setRingColor(model, ringColor);
      
      setInvisibleLook(model, (v.flags & PF_INVISIBLE) !== 0 || (this.arena.hideouts.length > 0 && inHideout(this.arena, v.x, v.y)));
      this.pose(model, v.x, v.y, v.aim, v.air, (v.flags & PF_STUNNED) !== 0, (v.flags & PF_DASH) !== 0, (v.flags & PF_SHIELD) !== 0, 0, dt, time);
    }
  }

  updateBots(views, dt, time) {
    for (let slot = 0; slot < MAX_BOTS; slot++) {
      const v = views.bots[slot]; const shown = this.botShown[slot];
      if (!v.active) { if (shown !== null) { shown.root.visible = false; this.botShown[slot] = null; } continue; }
      const model = this.getBotModel(slot, v.type);
      if (shown !== model) { if (shown !== null) shown.root.visible = false; model.root.visible = true; model.lastX = NaN; this.botShown[slot] = model; }
      const charging = PROFS[v.type].behavior === BOT_BEHAVIOR.CHARGE && (v.state === BOT_STATE.WINDUP || v.state === BOT_STATE.CHARGE);
      this.pose(model, v.x, v.y, v.angle, 0, (v.flags & BF_STUNNED) !== 0, false, false, charging ? 1 : 0, dt, time);
    }
  }

  updateProjectiles(views, time) {
    const hw = this.arena.width * HALF; const hh = this.arena.height * HALF;
    const counts = this.projectileCounts; counts.fill(0); const d = this.dummy;
    for (let i = 0; i < views.projectileCount; i++) {
      const pr = views.projectiles[i]; const v = pr.visual < PROJECTILE_VISUAL_COUNT ? pr.visual : VISUAL.NONE; const index = counts[v];
      if (index >= MAX_PROJECTILE_INSTANCES) continue; counts[v] = index + 1;
      const height = pr.lob > 0 ? PROJECTILE_HEIGHT + Math.sin(pr.lob * Math.PI) * LOB_HEIGHT : PROJECTILE_HEIGHT;
      const spin = time * PROJECTILE_SPIN + pr.id;
      d.position.set(pr.x - hw, height, pr.y - hh);
      if (v === VISUAL.VINYL) d.rotation.set(0, -pr.angle + spin, 0); else if (v === VISUAL.BOBINE || v === VISUAL.MOLOTOV) d.rotation.set(0, -pr.angle, -spin); else if (v === VISUAL.BILLET || v === VISUAL.CHOUCROUTE) d.rotation.set(Math.sin(spin) * 0.8, -pr.angle + spin * 0.3, Math.cos(spin) * 0.5); else d.rotation.set(0, -pr.angle, 0);
      d.updateMatrix(); this.projectileMeshes[v].setMatrixAt(index, d.matrix);
      this.projectileMeshes[v].visible = true;
      if ((v === VISUAL.MOLOTOV || v === VISUAL.ELECTRIC) && Math.random() < TRAIL_CHANCE) { this.effects.burst(pr.x, pr.y, height, 1, v === VISUAL.MOLOTOV ? 0xff8a1f : 0x7ff3ff, EMBER_SPEED * HALF, EMBER_SIZE, EMBER_LIFE_MS * HALF, 0); }
    }
    for (let v = 0; v < PROJECTILE_VISUAL_COUNT; v++) { 
      const mesh = this.projectileMeshes[v]; 
      mesh.count = counts[v]; 
      if (counts[v] > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.visible = true;
      } else {
        mesh.visible = false;
      }
    }
  }

  updateZones(views, time) {
    const hw = this.arena.width * HALF; const hh = this.arena.height * HALF;
    for (let i = 0; i < MAX_ZONES; i++) {
      const slot = this.zoneSlots[i];
      if (i >= views.zoneCount) { slot.group.visible = false; continue; }
      const z = views.zones[i]; const style = ZONE_STYLE[z.visual];
      if (style === null || style === undefined) { slot.group.visible = false; continue; }
      if (slot.visual !== z.visual) { slot.visual = z.visual; slot.discMat.color.setHex(style.disc); slot.rimMat.color.setHex(style.rim); slot.puffMat.color.setHex(style.puff); }
      const fade = Math.min(1, z.life * 4); slot.discMat.opacity = style.discOpacity * fade; slot.rimMat.opacity = fade; slot.puffMat.opacity = style.puffOpacity * fade;
      slot.group.visible = true; slot.group.position.set(z.x - hw, 0, z.y - hh); slot.group.scale.set(z.radius, 1, z.radius);
      const showPuffs = style.puffOpacity > 0;
      for (let k = 0; k < ZONE_PUFFS; k++) {
        const puff = slot.puffs[k]; puff.visible = showPuffs; if (!showPuffs) continue;
        const a = (k / ZONE_PUFFS) * TWO_PI + time * ZONE_PUFF_SPEED * (k % 2 === 0 ? 1 : -1); const orbit = ZONE_PUFF_ORBIT * (0.6 + 0.4 * Math.sin(time + k));
        puff.position.set(Math.cos(a) * orbit, ZONE_PUFF_HEIGHT + 0.15 * Math.sin(time * 2 + k), Math.sin(a) * orbit); puff.scale.set(ZONE_PUFF_SIZE, ZONE_PUFF_SIZE * z.radius, ZONE_PUFF_SIZE);
      }
      if (Math.random() < ZONE_EMBER_CHANCE) { const a = Math.random() * TWO_PI; const r = Math.random() * z.radius; this.effects.burst(z.x + Math.cos(a) * r, z.y + Math.sin(a) * r, 0.1, 1, style.particle, EMBER_SPEED, EMBER_SIZE, EMBER_LIFE_MS, z.visual === 1 ? -0.1 : -0.02); }
    }
  }

  updateAim(aim) {
    if (!aim.visible) { this.aimLine.visible = false; this.aimArea.visible = false; return; }
    const hw = this.arena.width * HALF; const hh = this.arena.height * HALF;
    const b = BRAWLERS[aim.brawlerId]; const def = aim.isSuper ? b.super : b.main;
    this.aimMaterial.color.setHex(aim.isSuper ? AIM_SUPER_COLOR : AIM_COLOR);
    const sx = aim.x - hw; const sz = aim.y - hh;
    this.aimLine.visible = false; this.aimArea.visible = false;
    switch (def.kind) {
      case ATTACK_KIND.LOB:
      case ATTACK_KIND.LEAP: { const dist = Math.min(def.range, aim.dist * MAX_AIM_DISTANCE); this.aimArea.visible = true; this.aimArea.position.set(sx + Math.cos(aim.angle) * dist, 0.075, sz + Math.sin(aim.angle) * dist); this.aimArea.scale.set(def.aoeRadius, 1, def.aoeRadius); this.showAimLine(sx, sz, aim.angle, dist, AIM_LINE_WIDTH * HALF); break; }
      case ATTACK_KIND.NOVA:
      case ATTACK_KIND.ZONE_SELF: { const r = def.kind === ATTACK_KIND.NOVA ? def.aoeRadius : def.zoneRadius; this.aimArea.visible = true; this.aimArea.position.set(sx, 0.075, sz); this.aimArea.scale.set(r, 1, r); break; }
      case ATTACK_KIND.BUFF: break;
      default: this.showAimLine(sx, sz, aim.angle, def.range, def.kind === ATTACK_KIND.MELEE ? def.range * Math.sin(def.arcRad * HALF) * 2 : Math.max(AIM_LINE_WIDTH, def.radius * 2)); break;
    }
  }

  showAimLine(sx, sz, angle, length, width) { this.aimLine.visible = true; this.aimLine.position.set(sx, 0.07, sz); this.aimLine.rotation.set(0, -angle, 0); this.aimLine.scale.set(Math.max(0.1, length), 1, width); }

  renderPreview(dt, time, rect, isProf, id) {
    this.webgl.setScissorTest(false); this.webgl.setViewport(0, 0, this.viewWidth, this.viewHeight); this.webgl.setClearColor(MENU_BG_COLOR, 1); this.webgl.clear();
    if (rect === null || rect.width < 1 || rect.height < 1) return;
    const list = isProf ? this.previewProfs : this.previewBrawlers; const selected = list[id];
    for (let i = 0; i < this.previewBrawlers.length; i++) this.previewBrawlers[i].root.visible = false;
    for (let i = 0; i < this.previewProfs.length; i++) this.previewProfs[i].root.visible = false;
    if (selected === undefined) return;
    selected.root.visible = true; this.turntable.rotation.y += PREVIEW_SPIN_SPEED * dt; this.previewAttackTimer += dt;
    if (this.previewAttackTimer > PREVIEW_ATTACK_EVERY_S) { this.previewAttackTimer = 0; triggerAttack(selected); }
    const crawl = isProf && PROFS[id].behavior === BOT_BEHAVIOR.CHARGE ? HALF * (1 + Math.sin(time)) : 0;
    this.pose(selected, this.arena.width * HALF, this.arena.height * HALF, Math.PI * HALF, 0, false, false, false, crawl, dt, time);
    const aspect = rect.width / rect.height; if (aspect !== this.previewAspect) { this.previewAspect = aspect; this.previewCamera.aspect = aspect; this.previewCamera.updateProjectionMatrix(); }
    const y = this.viewHeight - rect.y - rect.height;
    this.webgl.setScissorTest(true); this.webgl.setScissor(rect.x, y, rect.width, rect.height); this.webgl.setViewport(rect.x, y, rect.width, rect.height); this.webgl.render(this.previewScene, this.previewCamera); this.webgl.setScissorTest(false);
  }

  screenToGround(screenX, screenY, out) {
    this.ndc.set((screenX / this.viewWidth) * 2 - 1, -(screenY / this.viewHeight) * 2 + 1); this.raycaster.setFromCamera(this.ndc, this.camera);
    if (this.raycaster.ray.intersectPlane(this.groundPlane, this.hit) === null) return false;
    out.x = this.hit.x + (this.arena.width * HALF); out.y = this.hit.z + (this.arena.height * HALF); return true;
  }

  worldToScreen(x, height, y, out) {
    const v = this.projected.set(x - (this.arena.width * HALF), height, y - (this.arena.height * HALF)).project(this.camera); if (v.z > 1) return false;
    out.x = (v.x + 1) * HALF * this.viewWidth; out.y = (1 - v.y) * HALF * this.viewHeight; return true;
  }

  playerTop(slot) { const m = this.playerShown[slot]; return m === null ? 2 : m.topY; }
  botTop(slot) { const m = this.botShown[slot]; return m === null ? 2 : m.topY; }
  resize() {
    const w = window.innerWidth; const h = window.innerHeight; this.viewWidth = w; this.viewHeight = h; this.webgl.setSize(w, h, true);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const vfov = (CAMERA_FOV * Math.PI) / 180; const hfov = 2 * Math.atan(Math.tan(vfov * HALF) * this.camera.aspect); const distance = Math.hypot(CAMERA_HEIGHT, CAMERA_BACK);
    const visibleWidth = 2 * distance * Math.tan(hfov * HALF); this.zoom = Math.max(1, CAMERA_MIN_VISIBLE_WIDTH / visibleWidth);
    this.effects.setViewport(h * this.webgl.getPixelRatio(), CAMERA_FOV);
  }
  drawCalls() { return this.webgl.info.render.calls; }
}
