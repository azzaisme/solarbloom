import { HOME } from '../gameplay/ProgressionSystem';
import * as pc from 'playcanvas';
import { Sfx } from '../audio/Sfx';
import { formatCost } from '../core/Economy';
import { PARK } from '../core/Areas';
import { createInitialState, GROUND } from '../core/GameState';
import { AREA_TYPES } from '../data/city';
import { distToFootprint } from '../core/Grid';
import type { MachineData, ResourceKind, TileData } from '../core/types';
import { MACHINES } from '../data/machines';
import { TUNING } from '../data/tuning';
import { UPGRADE_BY_ID } from '../data/upgrades';
import type { ChainEvent } from '../gameplay/BloomChainSystem';
import { CAT_REWARD_NAMES } from '../gameplay/LuckyCatSystem';
import type { OfflineReport } from '../gameplay/OfflineSystem';
import { Sim } from '../gameplay/Sim';
import { Butterflies } from '../rendering/Butterflies';
import { CameraController } from '../rendering/CameraController';
import { CatVisuals } from '../rendering/CatVisuals';
import { DroneVisuals } from '../rendering/DroneVisuals';
import { ChunkRenderer } from '../rendering/ChunkRenderer';
import { areaPanelHtml } from '../ui/AreaPanel';
import { upgradeHighlights } from '../gameplay/UpgradeEffects';
import { GridRenderer } from '../rendering/GridRenderer';
import { InputController } from '../rendering/InputController';
import { MachineVisuals } from '../rendering/MachineVisuals';
import { PALETTE } from '../rendering/Materials';
import { Overlays } from '../rendering/Overlays';
import { SceneBuilder, SLAB_TOP } from '../rendering/SceneBuilder';
import { pickLayers } from '../core/Picking';
import { ChainSummary, VfxBudget } from '../ui/ChainSummary';
import { relayLinkId } from '../gameplay/RelaySystem';
import { initLowPoly } from '../rendering/Shapes';
import { TileFx } from '../rendering/TileFx';
import { Tweens } from '../rendering/Tween';
import { Vfx } from '../rendering/Vfx';
import { FlyText } from '../ui/Fly';
import { Hud, type Settings, type Tool } from '../ui/Hud';
import { EventBus } from './EventBus';
import { type LoadResult, SaveService } from './SaveService';

const SETTINGS_KEY = 'solarbloom.settings';
const BLOOM_NAMES = ['', 'Fresh grass', 'Wildflowers', 'Thriving (full bloom)', 'Radiant'];
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

interface Pick {
  roofId: string;
  fx: number;
  fz: number;
  tile?: TileData;
}

function loadSettings(): Settings {
  const def: Settings = { sound: true, music: true, reducedMotion: false, hints: true, debug: false, lowVfx: false, lowFog: false, followChains: false };
  try {
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) def.reducedMotion = true;
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch {
    return def;
  }
}

/** Glue between the headless Sim, PlayCanvas rendering, DOM HUD, input, audio and persistence. */
export class Game {
  readonly app: pc.Application;
  readonly bus = new EventBus();
  readonly saver = new SaveService();
  readonly sim: Sim;
  readonly tweens = new Tweens();
  readonly scene: SceneBuilder;
  readonly camera: CameraController;
  readonly grid: GridRenderer;
  /** The city ground (streamed chunk meshes + fog). */
  readonly chunks: ChunkRenderer;
  readonly machines: MachineVisuals;
  readonly drones: DroneVisuals;
  readonly cat: CatVisuals;
  readonly butterflies: Butterflies;
  readonly tileFx: TileFx;
  readonly vfx: Vfx;
  readonly overlays: Overlays;
  readonly hud: Hud;
  readonly fly: FlyText;
  readonly sfx = new Sfx();
  settings: Settings;

  private acc = 0;
  paused = false;
  private hiddenPause = false;
  /** City 06.5: simulated seconds still owed after a hitch or a hidden tab, run within the frame budget. */
  catchUpDebt = 0;
  private hiddenAt = 0;
  /** Simulation milliseconds spent in the last frame, and the worst since the counter was reset (perf harness). */
  simMs = 0;
  simMsWorst = 0;
  speed = 1;
  private saveTimer = 0;
  private resetting = false;
  private pointer = { x: -1, y: -1, inside: false };
  private selected?: string;
  private inspectTimer = 0;
  private cinematic = false;
  private specialtyToasted = new Set<string>();
  private cinematicEnd?: () => void;
  private meowTimer = 35;
  private restoreSoundIdx = 0;
  private lastRestoreSound = 0;
  private solarFeedAt = new Map<string, number>();
  private fpsAcc = { t: 0, n: 0, fps: 0 };
  private clock = 0;
  private slowFor = 0;
  private fastFor = 0;
  private maxDpr = 2;

  constructor(canvas: HTMLCanvasElement, lr: LoadResult = new SaveService().loadResult()) {
    this.settings = loadSettings();
    const loaded = lr.state;
    const state = loaded ?? createInitialState();
    this.sim = new Sim(state, this.bus);
    // Phase 4 E01: time away since the last save earns bounded offline progress (before anything renders).
    // A clock that went backwards earns nothing; the result is saved right away so a reload can't count it twice.
    const awayMs = loaded?.savedAt !== undefined ? Date.now() - loaded.savedAt : 0;
    const offline = awayMs > 0 ? this.sim.offline.apply(awayMs / 1000) : undefined;

    this.app = new pc.Application(canvas, {
      graphicsDeviceOptions: { antialias: true, alpha: true, powerPreference: 'high-performance' },
    });
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.maxDpr = Math.min(window.devicePixelRatio || 1, 2);
    this.app.graphicsDevice.maxPixelRatio = this.maxDpr;
    window.addEventListener('resize', () => this.app.resizeCanvas());

    initLowPoly(this.app.graphicsDevice);
    this.scene = new SceneBuilder(this.app, this.tweens);
    this.scene.build();
    this.camera = new CameraController(this.app, this.tweens);
    this.app.scene.fog.start = this.camera.fogDepth(46);
    this.app.scene.fog.end = this.camera.fogDepth(84);
    this.grid = new GridRenderer(this.sim, this.scene.world, this.tweens, this.app.batcher ?? undefined);
    this.chunks = new ChunkRenderer(this.sim, this.scene.world, this.app.graphicsDevice);
    this.chainSummary = new ChainSummary(this.sim);
    // City 05.2: the park cheers up in stages as you restore it.
    this.chunks.onParkStage = (stage) => {
      const lines: Record<number, string> = {
        1: '🧹 The park paths are swept clean.<small>A quarter of the way to waking the fountain.</small>',
        2: '🪑 The benches are mended.<small>Halfway there: people will want to sit here again.</small>',
        3: '💡 The lamps are lit again!<small>The planter trees leaf out and bunting goes up on the bandstand.</small>',
      };
      if (lines[stage]) this.hud.toast(lines[stage], 'gold', 4);
      this.vfx.ring(new pc.Vec3(8, 0.3, 8), PALETTE.gold, 6, 1.0);
    };
    this.grid.build();
    this.machines = new MachineVisuals(this.sim, this.scene.world, this.tweens, this.app.batcher ?? undefined);
    this.machines.buildAll();
    this.drones = new DroneVisuals(this.sim, this.scene.world, this.tweens);
    this.drones.onTrail = (p) => this.vfx.trail(p);
    this.drones.sync();
    this.cat = new CatVisuals(this.sim, this.scene.world, this.tweens);
    this.vfx = new Vfx(this.scene.world, this.app.graphicsDevice);
    this.butterflies = new Butterflies(this.sim, this.scene.world, this.app.batcher!.addGroup('butterflies', true, 400).id);
    this.tileFx = new TileFx(this.sim, this.scene.world, this.app.graphicsDevice);
    this.machines.onActivated = (_m, at) => {
      this.vfx.ring(at, PALETTE.gold, 1.3, 0.55);
      this.vfx.burst(new pc.Vec3(at.x, at.y + 0.5, at.z), 10, { up: 2.5, size: 0.05 });
      this.sfx.powerUp();
    };
    this.overlays = new Overlays(this.sim, this.scene.world);

    this.hud = new Hud(
      this.sim,
      {
        selectTool: (t) => this.selectTool(t),
        harvest: () => this.harvest(),
        buyUpgrade: (id) => this.sim.upgrades.purchase(id),
        activateCore: () => this.sim.progression.activateCore(),
        newGame: () => this.newGame(),
        setSetting: (k, v) => this.setSetting(k, v),
        setVolume: (k, v) => this.setVolume(k, v),
        skipCinematic: () => this.skipCinematic(),
        closeInspect: () => this.select(undefined),
        togglePause: () => this.setPaused(!this.paused),
        districtBloom: (id, replay) => this.playDistrictBloom(id, replay),
        openArea: (id) => this.openArea(id),
        setAreaMode: (id, mode) => {
          if (this.sim.areas.setMode(id, mode)) {
            this.inspectTimer = 0;
            this.save();
          }
        },
        focusTile: (x, z) => {
          if (this.cinematic) return;
          this.camera.glide(x + 0.5, 0, z + 0.5, Math.max(this.camera.zoom, 0.9));
          const t = this.sim.grid.get(GROUND, x, z);
          if (t) this.vfx.ring(this.tileVec(t), PALETTE.gold, 1.2, 0.9);
          this.selectTool?.('pulse');
        },
        wake: (id) => {
          const m = this.sim.machine(id);
          if (m && this.landmarkReady(m)) this.wakeLandmark(m);
        },
        cycleSpeed: () => {
          this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 3 : 1;
          this.hud.toast(this.speed === 1 ? '▶ Normal speed' : `⏩ ${this.speed}× speed`, '', 1.4);
          return this.speed;
        },
      },
      this.settings,
    );
    this.fly = new FlyText(this.hud.root);
    this.hud.setTool('pulse');
    this.applySettings();

    this.sim.cat.anchorView = (a) => this.anchorView(this.cat.anchorWorld(a));
    if (state.cat.active) this.cat.show(state.cat.active.anchorId, false);
    {
      this.camera.minZoom = 0.22; // the city overview
      this.updateCityBounds();
      this.camera.target.set(8, 0, 8);
      this.camera.glide(8, 0, 8);
      for (const id of this.sim.areas.revealed()) {
        const lm = this.sim.areas.landmark(id);
        if (lm && this.sim.areas.fog(id) === 'cleared') this.machines.setLandmarkState(lm.id, 'awake', true);
      }
    }
    if (state.progression.coreActivated) this.machines.setCoreState('awake', true);
    else if (this.sim.progression.coreReady()) this.machines.setCoreState('ready');

    this.wireEvents();
    new InputController(canvas, {
      hover: (x, y) => this.onHover(x, y),
      leave: () => this.onLeave(),
      click: (x, y, b) => this.onClick(x, y, b),
      pan: (dx, dy) => {
        this.lastPanAt = performance.now();
        this.camera.pan(dx, dy);
      },
      zoom: (f) => this.camera.zoomBy(f),
      // A quick, strong pinch-out snaps to the city overview (one gesture from anywhere).
      pinchEnd: (f, ms) => {
        if (this.city && !this.cinematic && f < 0.6 && ms < 450) this.camera.glide(this.camera.target.x, 0, this.camera.target.z, this.camera.minZoom);
      },
    });
    this.wireKeys();
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      this.hiddenPause = document.hidden;
      if (document.hidden) {
        this.hiddenAt = performance.now();
        this.saveNow();
      } else if (this.hiddenAt) {
        this.awayFor((performance.now() - this.hiddenAt) / 1000);
        this.hiddenAt = 0;
      }
    });
    window.addEventListener('beforeunload', () => this.saveNow());

    this.app.on('update', (dt: number) => this.update(dt));
    this.app.start();
    if (lr.scrapped) setTimeout(() => this.hud.toast('A new city awaits — older gardens were cleared for this update. 🌱', '', 7), 400);
    if (lr.backedUpAs) setTimeout(() => this.hud.toast(`Your old save couldn't be read by this version, so it was kept safely as a backup and a new rooftop started.<small>${lr.backedUpAs}</small>`, '', 8), 400);
    if (!state.progression.introSeen && state.stats.tilesRestored === 0) this.hud.showIntro();
    else if (offline) {
      this.saveNow();
      setTimeout(() => this.hud.toast(offlineToast(offline, 'Welcome back!'), 'gold', 6), 400);
    } else if (loaded) setTimeout(() => this.hud.toast('Welcome back! Your garden kept its shape. 🌱', '', 2.6), 400);
  }

  // ───────────────────────── settings / persistence ─────────────────────────

  private setVolume(k: 'sfxVolume' | 'musicVolume', v: number) {
    this.settings[k] = Math.max(0, Math.min(100, v));
    this.setSetting('sound', this.settings.sound);
  }

  private setSetting(k: keyof Settings, v: boolean) {
    (this.settings as unknown as Record<string, unknown>)[k] = v;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* private mode */
    }
    this.applySettings();
  }

  private applySettings() {
    const s = this.settings;
    this.sfx.setVolumes((s.sfxVolume ?? 100) / 100, (s.musicVolume ?? 100) / 100);
    this.sfx.setMuted(!s.sound);
    this.sfx.setMusic(s.music);
    document.body.classList.toggle('contrast', !!s.highContrast);
    const rm = s.reducedMotion;
    this.tileFx.reducedMotion = this.butterflies.reducedMotion = this.grid.reducedMotion = this.machines.reducedMotion = this.drones.reducedMotion = this.cat.reducedMotion = this.camera.reducedMotion = this.fly.reducedMotion = rm;
    this.vfx.density = rm ? 0.35 : s.lowVfx ? 0.45 : 1;
    this.cat.softSparkle = rm || s.lowVfx;
    // Quality: lighter shadows with fewer effects.
    const sun = this.scene.sun.light;
    if (sun) sun.shadowResolution = s.lowVfx ? 1024 : 2048;
    if (this.chunks && this.chunks.lowFog !== !!s.lowFog) {
      this.chunks.lowFog = !!s.lowFog;
      this.chunks.markAll();
    }
    document.body.classList.toggle('reduced', rm);
    this.hud.settings = s;
    if (!s.debug) this.hud.setDebug(null);
  }

  private saving = false;
  /** Autosave: compressed, off the frame (the next idle moment). Unload uses the plain synchronous save. */
  save() {
    if (this.resetting || this.saving) return;
    this.saving = true;
    const seq = ++this.saveSeq;
    const run = () =>
      void this.saver
        .serializeCompressed(this.sim.state)
        .then((data) => {
          // A newer synchronous save (unload) or a New Game wins over this one.
          if (this.resetting || seq !== this.saveSeq) return;
          const ok = this.saver.write(data);
          if (!ok && !this.warnedStorage) {
            this.warnedStorage = true;
            this.hud.toast("Couldn't save your garden: this browser's storage is full or blocked.", '', 6);
          }
        })
        .finally(() => (this.saving = false));
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(run, { timeout: 2000 });
    else setTimeout(run, 0);
  }
  private warnedStorage = false;
  private saveSeq = 0;

  /** Immediate, uncompressed save for page unload (no time to compress). */
  saveNow() {
    if (this.resetting) return;
    this.saveSeq++;
    this.saver.save(this.sim.state);
  }

  private newGame() {
    this.resetting = true;
    this.saver.clear();
    location.reload();
  }

  private setPaused(p: boolean) {
    this.paused = p;
    this.hud.setPaused(p);
    this.hud.toast(p ? '⏸ Paused — the garden waits for you' : '▶ Back to blooming', '', 1.6);
  }

  // ───────────────────────── tools & input ─────────────────────────

  private selectTool(t: Tool) {
    if (this.cinematic) return;
    this.sfx.click();
    this.hud.setTool(t);
    this.overlays.hideGhost();
    this.overlays.hideRadius();
    this.overlays.showGrid(t !== 'inspect' && t !== 'pulse');
    if (t !== 'inspect') this.select(undefined);
    if (this.pointer.inside) this.onHover(this.pointer.x, this.pointer.y);
  }

  private harvest() {
    if (this.sim.harvestSun()) {
      const starter = this.sim.state.machines.find((m) => m.type === 'solar');
      if (starter) {
        const p = this.machines.worldOf(starter);
        this.vfx.burst(new pc.Vec3(p[0], p[1] + 0.4, p[2]), 14, { up: 3, size: 0.07 });
        this.vfx.ring(new pc.Vec3(p[0], p[1], p[2]), PALETTE.gold, 1.4);
      }
    }
  }

  private wireKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      const map: Record<string, Tool> = { '1': 'inspect', '2': 'pulse', '3': 'solar', '4': 'condenser', '5': 'pollinator', '6': 'droneHub', '7': 'motherTree', '8': 'reservoirGarden', '9': 'relay' };
      if (map[k]) this.selectTool(map[k]);
      else if (k === 'h') this.harvest();
      else if (k === 'f') this.focusNextArea();
      else if (k === 'home') this.focusArea(PARK);
      else if (k === 'u') this.hud.toggleUpgrades();
      else if (k === 'b') this.hud.toggleTray();
      else if (k === 'p') this.setPaused(!this.paused);
      else if (k === 'f3' || k === '`') {
        e.preventDefault();
        this.setSetting('debug', !this.settings.debug);
      } else if (k === 'escape') {
        if (this.hud.modalOpen) this.hud.openSettings(false);
        else if (this.hud.isUpgradesOpen) this.hud.toggleUpgrades(false);
        else if (this.hud.trayOpen) this.hud.toggleTray(false);
        else if (this.selected) this.select(undefined);
        else this.selectTool('pulse');
      } else if (k === '+' || k === '=') this.camera.zoomBy(1.15);
      else if (k === '-') this.camera.zoomBy(1 / 1.15);
    });
  }

  pick(x: number, y: number): Pick | undefined {
    const { o, d } = this.camera.ray(x, y);
    // The endless ground only once it's playable (the rooftop campaign shows it as scenery).
    const layers = this.sim.grid.allLayers.filter((l) => l.kind === 'raised' || l.unlocked);
    const hit = pickLayers(layers, o, d);
    if (!hit) return undefined;
    return { roofId: hit.layerId, fx: hit.fx, fz: hit.fz, tile: this.sim.grid.get(hit.layerId, Math.floor(hit.fx), Math.floor(hit.fz)) };
  }

  /** The game is in the city (the park and beyond), not the legacy rooftop layout. */
  get city(): boolean {
    return this.sim.progression.homeIsPark;
  }

  /** Pan bounds: revealed areas plus a margin (the fog beyond is visible, the far city is not). */
  private updateCityBounds() {
    const ids = this.sim.areas.revealed();
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const id of ids)
      for (const [cx, cz] of this.sim.areas.info(id).chunks) {
        x0 = Math.min(x0, cx * 16);
        x1 = Math.max(x1, cx * 16 + 16);
        z0 = Math.min(z0, cz * 16);
        z1 = Math.max(z1, cz * 16 + 16);
      }
    this.camera.bounds = { minX: x0 - 8, maxX: x1 + 8, minZ: z0 - 8, maxZ: z1 + 8 };
  }

  /** Visible ground rectangle (world x/z) from the four screen corners. */
  private groundRect() {
    const c = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    const w = c.clientWidth;
    const h = c.clientHeight;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [sx, sy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const { o, d } = this.camera.ray(sx, sy);
      if (Math.abs(d.y) < 1e-6) continue;
      const t = -o.y / d.y;
      const x = o.x + d.x * t;
      const z = o.z + d.z * t;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    // Never stream an unbounded amount at extreme zoom-out.
    const cx = this.camera.target.x;
    const cz = this.camera.target.z;
    const R = 90;
    return { x0: Math.max(x0, cx - R), x1: Math.min(x1, cx + R), z0: Math.max(z0, cz - R), z1: Math.min(z1, cz + R) };
  }

  /** Screen-space hit test for drones (generous target, like the cat). Returns the drone id. */
  private droneHit(x: number, y: number): string | undefined {
    const r = Math.max(26, 0.35 / this.camera.worldPerPixel());
    for (const d of this.sim.state.drones) {
      const p = this.drones.worldPos(d.id);
      if (!p) continue;
      const sp = this.camera.toScreen(p);
      if (Math.hypot(sp.x - x, sp.y - y) <= r) return d.id;
    }
    return undefined;
  }

  private catHit(x: number, y: number): boolean {
    const p = this.cat.targetWorld();
    if (!p) return false;
    const s = this.camera.toScreen(p);
    // Generous enough to tap, small enough that a tile next to the cat still gets its own click.
    const r = Math.max(20, 0.26 / this.camera.worldPerPixel());
    return Math.hypot(s.x - x, s.y - y) <= r;
  }

  /** On screen and clear of the HUD, off screen (reachable by panning) or covered by a HUD panel. */
  private anchorView(p: pc.Vec3): 'visible' | 'offscreen' | 'covered' {
    const s = this.camera.toScreen(p);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (s.x < 40 || s.y < 40 || s.x > w - 40 || s.y > h - 40) return 'offscreen';
    return this.hud.blockedRects().some((r) => s.x > r.left - 16 && s.x < r.right + 16 && s.y > r.top - 16 && s.y < r.bottom + 16) ? 'covered' : 'visible';
  }

  private onLeave() {
    this.pointer.inside = false;
    this.overlays.hideFrame();
    this.overlays.hideGhost();
    if (!this.selected) this.overlays.hideRadius();
    this.hud.hideTip();
  }

  private tileTitle(t: TileData): string {
    if (t.blocked) return 'Rusty vent';
    switch (t.ground) {
      case 'polluted':
        return 'Cracked concrete';
      case 'prepared':
        return 'Mossy soil';
      case 'growing':
        return 'Sprouting…';
      case 'restored':
        return BLOOM_NAMES[t.bloom] ?? 'Garden';
    }
  }

  private onHover(x: number, y: number) {
    this.pointer = { x, y, inside: true };
    if (this.cinematic) return;
    if (this.catHit(x, y)) {
      this.overlays.hideFrame();
      this.overlays.hideGhost();
      this.hud.showTip(x, y, `<b>🐱 …is that a cat?</b>Click it!`);
      document.body.style.cursor = 'pointer';
      return;
    }
    if (this.droneHit(x, y)) {
      this.overlays.hideFrame();
      this.overlays.hideGhost();
      this.hud.showTip(x, y, `<b>🛸 Drone</b>Click to see its work area and current job`);
      document.body.style.cursor = 'pointer';
      return;
    }
    document.body.style.cursor = '';
    const p = this.pick(x, y);
    const tool = this.hud.currentTool;
    if (!p || !p.tile) {
      this.overlays.hideFrame();
      this.overlays.hideGhost();
      if (!this.selected) this.overlays.hideRadius();
      this.hud.hideTip();
      return;
    }
    const roof = this.sim.grid.roof(p.roofId)!;
    if (roof.preview) {
      this.overlays.hideFrame();
      this.overlays.hideGhost();
      this.hud.showTip(x, y, `<b>🔒 ${roof.name}</b>${this.lockedReason(roof.id)}`);
      return;
    }
    const t = p.tile;
    if (tool !== 'inspect' && tool !== 'pulse') {
      const a = this.sim.build.anchorFor(tool, p.fx, p.fz);
      const chk = this.sim.build.check(tool, p.roofId, a.x, a.z);
      const def = MACHINES[tool];
      this.overlays.showGhost(p.roofId, a.x, a.z, def.size, chk.ok || chk.spotOk, def.size === 2 ? 0.35 : 0.5);
      this.overlays.showRadius(this.radiusTiles({ type: tool, roofId: p.roofId, x: a.x, z: a.z, size: def.size }), chk.ok ? 'ok' : 'info');
      this.hud.showTip(
        x,
        y,
        `<b>${def.icon} ${def.name}</b>${def.blurb}<br>${chk.ok ? `<span class="ok">Click to build · ${formatCost(chk.cost)}</span>` : `<span class="bad">${chk.reason}</span>`}`,
      );
      return;
    }
    this.overlays.hideGhost();
    const occ = this.sim.occupant(t);
    if (occ) {
      this.overlays.showFrame(occ.roofId, occ.x, occ.z, occ.size, 'info');
      const ready = occ.type === 'core' && this.landmarkReady(occ);
      const area = occ.type === 'core' ? this.sim.areas.areaOf(occ) : undefined;
      const ct = area ? { icon: AREA_TYPES[this.sim.areas.info(area).type].icon, name: this.sim.areas.info(area).landmarkName } : undefined;
      const boost = (occ.overchargeUntil ?? 0) > this.sim.time ? '<br><span class="ok">⚡ Boosted: next trigger +1</span>' : '';
      this.hud.showTip(x, y, `<b>${ct?.icon ?? MACHINES[occ.type].icon} ${ct?.name ?? MACHINES[occ.type].name}</b>${ready ? '<span class="ok">Ready! Click to awaken.</span>' : 'Click to inspect'}${boost}`);
      return;
    }
    if (tool === 'inspect') {
      this.overlays.showFrame(t.roofId, t.x, t.z, 1, 'hover');
      this.hud.showTip(x, y, `<b>${this.tileTitle(t)}</b>${this.tileDetail(t)}`);
      return;
    }
    const chk = this.sim.restoration.checkPulse(t);
    const maxed = t.ground === 'restored' && t.bloom >= TUNING.restore.maxBloom;
    this.overlays.showFrame(t.roofId, t.x, t.z, 1, chk.ok ? 'ok' : maxed || t.ground === 'growing' ? 'hover' : 'bad');
    let action = '';
    // Phase 4 E03.1: preview exactly which tiles this pulse will restore.
    const fp = chk.ok && t.ground !== 'restored' ? this.sim.restoration.footprint(t) : [];
    if (fp.length) this.overlays.showRadius([t, ...fp.map((f) => f.tile)], 'ok');
    else if (!this.selected) this.overlays.hideRadius();
    if (chk.ok) {
      const verb = t.ground === 'restored' ? `Nurture → ${BLOOM_NAMES[t.bloom + 1]}` : this.sim.restoration.nextIsOvercharged() ? '🌟 Overcharged pulse' : 'Pulse';
      action = `<span class="ok">${verb}: ${formatCost(chk.cost)}${fp.length ? ` · restores ${fp.length + 1} tiles` : ''}</span>`;
    } else if (chk.reason && !maxed) action = `<span class="bad">${chk.reason}</span>`;
    this.hud.showTip(x, y, `<b>${this.tileTitle(t)}</b>${this.tileDetail(t)}${action ? '<br>' + action : ''}`);
  }

  private tileDetail(t: TileData): string {
    if (t.blocked) return 'Nothing grows here.';
    const zone = this.sim.production.inPollinatorZone(t);
    switch (t.ground) {
      case 'polluted':
        return `Pollution ${Math.round(t.pollution)}% — restoring neighbours softens it into moss.`;
      case 'prepared':
        return zone ? '🌸 Inside a garden zone — may set off a Bloom Chain!' : 'Ready to bloom — cheaper to restore.';
      case 'growing':
        return 'Almost there…';
      case 'restored': {
        const rate = this.sim.production.tileBiomassRate(t);
        const lush = (t.lushUntil ?? 0) > this.sim.time ? ` · 💧 lush ${Math.ceil(t.lushUntil! - this.sim.time)} s` : '';
        return `+${rate.toFixed(2)}🌿/s${zone ? ' (garden ×2)' : ''}${lush}${t.bloom >= TUNING.restore.maxBloom ? ' · radiant ✦' : t.bloom >= TUNING.restore.fullBloom ? ' · full bloom ✓' : ''}`;
      }
    }
  }

  private onClick(x: number, y: number, button: number) {
    if (button !== 0 || this.cinematic) return;
    if (this.hud.isUpgradesOpen && window.innerWidth < 760) {
      this.hud.toggleUpgrades(false);
      return;
    }
    if (this.catHit(x, y)) {
      this.sim.cat.claim();
      return;
    }
    const droneId = this.droneHit(x, y);
    if (droneId) {
      const d = this.sim.state.drones.find((q) => q.id === droneId);
      if (d) this.select(d.hubId);
      this.sfx.drone();
      return;
    }
    const p = this.pick(x, y);
    if (!p || !p.tile) {
      this.select(undefined);
      return;
    }
    const roof = this.sim.grid.roof(p.roofId)!;
    if (roof.preview) {
      this.hud.showFail(this.lockedReason(roof.id), x, y);
      return;
    }
    const tool = this.hud.currentTool;
    const t = p.tile;
    if (tool !== 'inspect' && tool !== 'pulse') {
      const a = this.sim.build.anchorFor(tool, p.fx, p.fz);
      const m = this.sim.build.place(tool, p.roofId, a.x, a.z);
      if (m) {
        this.selectTool('pulse');
        this.select(m.id);
      }
      return;
    }
    const occ = this.sim.occupant(t);
    if (occ) {
      if (occ.type === 'core' && this.landmarkReady(occ)) {
        this.wakeLandmark(occ);
        return;
      }
      this.select(occ.id);
      return;
    }
    if (tool === 'inspect') {
      this.select(undefined);
      return;
    }
    this.select(undefined);
    this.sim.restoration.pulse(t.id);
    this.onHover(x, y);
  }

  private radiusTiles(m: { type: MachineData['type']; roofId: string; x: number; z: number; size: number }): TileData[] {
    const g = this.sim.grid;
    switch (m.type) {
      case 'solar':
        return g.tilesNear(m, 1);
      case 'condenser': {
        // Its own watering reach, plus any Reservoir Garden it fills (so the link is visible).
        const R = TUNING.neighbourhood.reservoir;
        const gardens = this.sim.state.machines.filter((x) => x.type === 'reservoirGarden' && x.roofId === m.roofId && distToFootprint(x.x, x.z, m.x, m.z, m.size) <= R.condenserRange);
        return [...g.tilesNear(m, TUNING.condenser.radius), ...gardens.map((x) => g.get(x.roofId, x.x, x.z)!)];
      }
      case 'pollinator':
        return g.tilesNear(m, this.sim.upgrades.pollinatorReach);
      case 'droneHub':
        return g.tilesNear(m, this.sim.upgrades.droneRadius);
      case 'motherTree':
        return g.tilesNear(m, this.sim.upgrades.treeRadius);
      case 'reservoirGarden':
        return g.tilesNear(m, TUNING.neighbourhood.reservoir.radius);
      case 'relay': {
        // Its zone, plus every relay it links to (so the network shows).
        const linked = 'id' in m ? this.sim.relays.linked(m as MachineData) : [];
        return [...g.tilesNear(m, TUNING.relay.zoneRadius), ...linked.map((o) => g.get(o.roofId, o.x, o.z)!)];
      }
      case 'core':
        return this.sim.chains.isElder(m) ? g.tilesNear(m, this.sim.chains.canopyBurstRadius(m)) : [];
      default:
        return [];
    }
  }

  private taskKeys: string[] = [];
  /** While a Drone Hub is selected, outline each drone's current target tile. */
  private showDroneTasks() {
    const m = this.sim.machine(this.selected);
    const targets = m?.type === 'droneHub' ? this.sim.state.drones.filter((d) => d.hubId === m.id && d.targetTileId).map((d) => d.targetTileId!) : [];
    const keys = targets.map((t) => `task:${t}`);
    if (keys.join() === this.taskKeys.join()) return;
    for (const k of this.taskKeys) this.tileFx.release(k);
    this.taskKeys = keys;
    for (const t of targets) {
      const tile = this.sim.grid.byTileId(t);
      if (tile) this.tileFx.hold(`task:${t}`, tile, '#6ff3ff');
    }
  }

  private select(id: string | undefined) {
    this.selected = id;
    this.showDroneTasks();
    const m = this.sim.machine(id);
    if (!m) {
      this.hud.renderInspect(null);
      this.overlays.hideRadius();
      return;
    }
    this.overlays.showRadius(this.radiusTiles(m));
    this.renderInspect();
  }

  private upgradeButton(id: string) {
    const def = UPGRADE_BY_ID[id];
    const st = this.sim.upgrades.status(def);
    const lvl = this.sim.upgrades.level(id);
    if (lvl >= def.maxLevel) return `<p class="stat">${def.icon} ${def.name}: MAX</p>`;
    return `<div class="card" style="margin-top:8px"><span class="ci">${def.icon}</span><span class="cn">${def.name}</span><button class="buy" data-buy="${id}" ${st.ok ? '' : 'disabled'}>${st.cost} 🌿</button><span class="cd2">${def.describe(lvl + 1)}</span></div>`;
  }

  private renderInspect() {
    const m = this.sim.machine(this.selected);
    if (!m) return this.hud.renderInspect(null);
    const s = this.sim;
    let extra = '';
    switch (m.type) {
      case 'solar': {
        const out = s.production.solarOutput(m);
        const boosted = m.boostUntil > s.time;
        extra = `<p class="stat">⚡ ${out.toFixed(1)} energy/s${boosted ? ' · 🌸 bloom boost!' : ''}${s.production.surgeActive() ? ` · 🐱 Solar Surge ×${TUNING.cat.frenzyMult}` : ''}</p><p>Restore tiles right next to it for a 5 s ×2 boost.</p>${this.upgradeButton('solarArray')}`;
        break;
      }
      case 'condenser': {
        const near = s.grid.tilesNear(m, TUNING.condenser.radius);
        const mossy = near.filter((t) => t.ground === 'prepared').length;
        const pct = Math.round(((m.charge ?? 0) / TUNING.condenser.threshold) * 100);
        extra = `<p class="stat">💧 +1 water/s</p><p class="stat">🌧️ Watering charge ${pct}% · ${mossy} dry tile${mossy === 1 ? '' : 's'} beside it</p><p>When full, it waters the dry soil next to it into bloom and starts a chain. ${mossy ? '' : 'Pulse a neighbour so moss appears beside it.'}</p>${this.upgradeButton('waterBloom')}`;
        break;
      }
      case 'pollinator': {
        const zone = s.grid.tilesNear(m, s.upgrades.pollinatorReach);
        const mossy = zone.filter((t) => t.ground === 'prepared').length;
        const green = zone.filter((t) => t.ground === 'restored').length;
        extra = `<p class="stat">🌸 Zone radius ${s.upgrades.pollinatorReach} · ${green}/${zone.length} blooming (×2 🌿)</p><p class="stat">✨ ${mossy} mossy tiles ready to chain</p><p>Restore a tile right next to it: it pollinates another neighbour (up to ${TUNING.pollinator.triggersPerChain}× per chain). Line gardens, panels and the Mother Tree up so chains jump between them.</p>${this.upgradeButton('pollinatorReach')}`;
        break;
      }
      case 'droneHub': {
        const ds = s.state.drones.filter((d) => d.hubId === m.id);
        const label = { working: 'restoring a tile', travelling: 'flying to a job', napping: 'napping — nothing to do in range', waitingEnergy: 'waiting for energy ⚡' } as const;
        extra = ds
          .map((d, i) => `<p class="stat">🛸 Drone ${i + 1}${d.expiresAt ? ' (party!)' : ''}: ${label[s.drones.statusOf(d)]} · ${d.jobs} jobs</p>`)
          .join('') +
          `<p>Works within ${s.upgrades.droneRadius} tiles (highlighted), paying the normal pulse cost. Blue outlines show current jobs.</p>` +
          ['droneSpeed', 'droneRadius', 'chainIntel', 'secondDrone'].map((u) => this.upgradeButton(u)).join('');
        break;
      }
      case 'relay': {
        const linked = s.relays.linked(m);
        const ready = linked.filter((o) => s.relays.ready(relayLinkId(m, o))).length;
        extra = `<p class="stat">📡 Linked to ${linked.length} relay${linked.length === 1 ? '' : 's'} within ${s.relays.range()} tiles · ${ready} ready</p><p>Each pulse blooms ${s.relays.targets()} tiles around the far relay, which can pass it on. Links recharge for ${TUNING.relay.cooldown} s.${linked.length ? '' : ' <b>Build another Bloom Relay within range to link them.</b>'}</p>`;
        break;
      }
      case 'motherTree': {
        const pct = Math.round(((m.charge ?? 0) / TUNING.motherTree.threshold) * 100);
        extra = `<p class="stat">🌳 Charge ${m.charge ?? 0}/${TUNING.motherTree.threshold} (${pct}%)</p><p>Each restoration or new bloom within ${s.upgrades.treeRadius} tiles adds charge. When full, it releases a Bloom Pulse over that whole area. Its own pulse can't recharge it.</p>${this.upgradeButton('treeResonance')}`;
        break;
      }
      case 'reservoirGarden': {
        const R = TUNING.neighbourhood.reservoir;
        const conds = s.state.machines.filter((x) => x.type === 'condenser' && x.roofId === m.roofId && distToFootprint(x.x, x.z, m.x, m.z, m.size) <= R.condenserRange).length;
        const dry = s.chains.overflowTargets(m, 99).length;
        const net = s.canals.of(m);
        const canal = net
          ? `<p class="stat">🛶 On a canal: ${net.gardens.length} garden${net.gardens.length === 1 ? '' : 's'} · ${net.condensers.length} condenser${net.condensers.length === 1 ? '' : 's'} share its water</p><p>Condensers along the canal fill the emptiest basin on it, and when this basin overflows it also spills at the connected garden with the most dry ground (once per chain).</p>`
          : m.roofId === GROUND
            ? '<p>Build it beside clean canal water to join a canal network.</p>'
            : '';
        extra = canal + `<p class="stat">⛲ Basin ${Math.floor(m.charge ?? 0)}/${R.threshold} · ${conds} 💧 condenser${conds === 1 ? '' : 's'} within ${R.condenserRange} tiles fill it</p><p class="stat">🌱 ${dry} dry tile${dry === 1 ? '' : 's'} within ${R.radius} tiles (highlighted) · Overflow irrigates up to ${R.targets}</p><p>Each time a nearby Water Condenser fills its meter, the basin rises. Full → Overflow: the closest dry tiles burst into lush bloom (×${R.lushMult} 🌿 for ${R.lushSeconds} s).${conds ? '' : ' <b>Build a Water Condenser within 2 tiles to fill it.</b>'}</p>`;
        break;
      }
      case 'core': {
        // Every Core is an area landmark now (on the ground, or on a city rooftop).
        this.hud.renderInspect(this.landmarkHtml(m));
        return;
      }
    }
    if ((m.overchargeUntil ?? 0) > s.time) extra = `<p class="stat" style="color:#1d8fb0">⚡ Boosted by your pulse — next trigger +1 (${Math.ceil(m.overchargeUntil! - s.time)} s)</p>` + extra;
    this.hud.renderInspect(this.hud.machineHtml(m, extra));
  }

  // ───────────────────────── events → presentation ─────────────────────────

  private tileScreen(tileId: string): { x: number; y: number } | undefined {
    const t = this.sim.grid.byTileId(tileId);
    if (!t) return undefined;
    const [x, y, z] = this.sim.grid.tileWorld(t);
    const s = this.camera.toScreen(new pc.Vec3(x, y + 0.3, z));
    return { x: s.x, y: s.y };
  }

  private tileVec(t: TileData, up = SLAB_TOP): pc.Vec3 {
    const [x, y, z] = this.sim.grid.tileWorld(t);
    return new pc.Vec3(x, y + up, z);
  }

  /** Gains waiting to fly, per resource: big chains coalesce into a few numbers instead of hundreds. */
  private flyPending = new Map<ResourceKind, { amount: number; at: number }>();

  private flyGain(kind: ResourceKind, amount: number, from?: { x: number; y: number }) {
    const now = performance.now();
    const p = this.flyPending.get(kind) ?? { amount: 0, at: -1e9 };
    p.amount += amount;
    this.flyPending.set(kind, p);
    if (now - p.at < 120) return; // the next one carries the sum
    p.at = now;
    const total = p.amount;
    p.amount = 0;
    const src = from ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.fly.spawn(kind, total, src, this.hud.resourceRect(kind), () => this.hud.flashResource(kind, 'flash'));
  }

  private wireEvents() {
    const b = this.bus;
    const s = this.sim;
    for (const ev of ['tile.restoring', 'tile.restored', 'tile.prepared', 'tile.softened', 'tile.nurtured'] as const) b.on(ev, ({ tile }) => this.chunks.markTile(tile));
    b.on('machine.built', ({ machine }) => {
      for (const t of s.grid.footprint(machine.roofId, machine.x, machine.z, machine.size)) if (t) this.chunks.markTile(t);
    });
    b.on('area.revealed', ({ areaId }) => {
      this.chunks.markArea(areaId);
      const lm = s.areas.landmark(areaId);
      if (lm && !this.machines.view(lm.id)) this.machines.add(lm, true);
      this.updateCityBounds();
    });
    b.on('area.fogChanged', ({ areaId }) => this.chunks.markArea(areaId));
    // City 12.1: rooftop clusters appear with their area and come alive when a Bloom Relay reaches them.
    b.on('layer.added', ({ layerId }) => {
      const l = s.grid.layer(layerId);
      if (l) this.grid.addRoof(l);
    });
    b.on('layer.unlocked', ({ layerId }) => {
      const l = s.grid.layer(layerId);
      if (!l?.cluster) return;
      this.grid.clusterBuilding(l);
      for (const t of s.grid.tilesOf(l.id)) this.grid.refresh(t, false);
      const c = new pc.Vec3(l.origin[0] + l.width / 2, l.height + 0.3, l.origin[2] + l.depth / 2);
      this.vfx.ring(c, '#9ff7ff', Math.max(l.width, l.depth) * 0.7, 1.0);
      this.sfx.powerUp();
      this.hud.toast(`📡 The relay reaches the rooftop!<small>${l.name}: restore its tiles and wake the Rooftop Core.</small>`, 'gold', 4);
    });
    b.on('area.ready', ({ areaId }) => {
      const lm = s.areas.landmark(areaId);
      if (lm) this.machines.setLandmarkState(lm.id, 'ready');
      if (areaId !== PARK) this.hud.toast(`✨ ${s.areas.info(areaId).landmarkName} is ready to wake!<small>Click it to clear this ${AREA_TYPES[s.areas.info(areaId).type].name.toLowerCase()}'s fog.</small>`, 'gold', 4);
    });
    b.on('area.cleared', ({ areaId }) => this.onAreaCleared(areaId));
    // City 09.1: the landmark's specialty action is done (the wake itself has its own toast once ready).
    b.on('area.specialty', ({ areaId, met }) => {
      if (!met || s.areas.ready(areaId) || this.specialtyToasted.has(areaId)) return;
      this.specialtyToasted.add(areaId);
      this.hud.toast(`✓ ${s.areas.info(areaId).landmarkName}: specialty done!<small>Restore the rest of its share to wake it.</small>`, 'gold', 3.5);
    });
    b.on('tile.restoring', ({ tile, source }) => {
      this.grid.refresh(tile, true);
      const p = this.tileVec(tile);
      if (source === 'pulse') {
        this.vfx.ring(p, PALETTE.eyeCyan, 1.1, 0.55);
        this.vfx.burst(p, 6, { up: 1.5, speed: 1.4, size: 0.05 });
        this.sfx.pulse();
      } else if (source === 'broad') this.vfx.ring(p, PALETTE.eyeCyan, 0.8, 0.45);
      else if (source === 'condenser') this.vfx.ring(p, PALETTE.water, 0.8, 0.5);
      else if (source === 'overflow') this.vfx.ring(p, '#a8ecff', 0.9, 0.5);
      else if (source === 'drone') this.vfx.ring(p, PALETTE.leafFin, 0.8, 0.5);
    });
    b.on('mega.ready', () => {
      this.hud.toast('💥 Mega Pulse charged!<small>Your next pulse sets off a city-scale bloom from that tile.</small>', 'gold', 4);
      this.hud.nudge('[data-tool="pulse"]', 4);
    });
    b.on('mega.released', ({ tileId, budget }) => {
      const t = s.grid.byTileId(tileId);
      if (t) for (let i = 0; i < 4; i++) this.tweens.add(0.01, () => {}, { delay: i * 0.18, done: () => this.vfx.ring(this.tileVec(t), i % 2 ? PALETTE.gold : PALETTE.coreGlow, 3 + i * 3, 1.1) });
      this.camera.shake?.(0.25);
      this.hud.feed(`💥 Mega Pulse: up to ${budget} tiles bloom outward`);
    });
    b.on('pulse.fired', ({ tileId, extra, overcharged }) => {
      const t = s.grid.byTileId(tileId);
      if (!t) return;
      const p = this.tileVec(t);
      if (!overcharged) {
        // Phase 4 E03.2: a restore already rings (tile.restoring); a nurture tap answers with its own quick ring,
        // and a Wide Pulse adds one ring spanning its whole footprint.
        if (t.ground === 'restored') this.vfx.ring(p, '#ffe9a0', 0.8, 0.22);
        else if (extra.length) this.vfx.ring(p, '#c8ffa8', 1.4 + 0.25 * Math.min(8, extra.length), 0.25);
        return;
      }
      this.vfx.ring(p, PALETTE.gold, 2.8, 0.8);
      this.tweens.add(0.01, () => {}, { delay: 0.15, done: () => this.vfx.ring(p, '#fff3a0', 2.2, 0.7) });
      this.vfx.burst(p, 30, { up: 3.5, speed: 2.2, size: 0.07 });
      this.camera.shake(0.07);
      this.sfx.chainEnd(5);
      this.hud.feed('🌟 OVERCHARGE! Everything within 2 tiles blooms');
    });
    b.on('tile.restored', ({ tile, source }) => {
      this.grid.refresh(tile, true);
      const p = this.tileVec(tile);
      // Player actions get the full burst; automation (drones, machines, chains) is quieter.
      const manual = source === 'pulse' || source === 'broad';
      this.vfx.burst(p, manual ? 14 : source === 'drone' || source === 'condenser' ? 6 : 9, { up: manual ? 2.6 : 1.8, size: manual ? 0.07 : 0.055 });
      if (manual && this.clock - this.lastRestoreSound > 0.06) {
        this.lastRestoreSound = this.clock;
        this.sfx.restored(this.restoreSoundIdx++);
      }
      for (const n of s.grid.neighbors(tile)) this.grid.refresh(n, true); // neighbours may have softened
      if (this.selected) this.inspectTimer = 0;
    });
    b.on('tile.softened', ({ tile }) => this.tileFx.flash(tile, '#7fcf5a', 0.22, 0.5, 0.1));
    b.on('tile.prepared', ({ tile }) => {
      this.grid.refresh(tile, true);
      this.tileFx.flash(tile, '#6cc24a', 0.35, 0.7, 0.1);
      this.vfx.burst(this.tileVec(tile), 3, { up: 1, size: 0.04, speed: 0.6 });
    });
    b.on('tile.nurtured', ({ tile, level }) => {
      this.grid.refresh(tile, true);
      const p = this.tileVec(tile, 0.3);
      this.vfx.burst(p, 12 + level * 4, { up: 2.4, size: 0.07 });
      this.vfx.ring(this.tileVec(tile), PALETTE.pink, 0.9, 0.5);
      this.sfx.nurture(level);
    });
    b.on('resource.gain', ({ kind, amount, tileId, reason }) => {
      if (amount < 0.05) return;
      let from = tileId ? this.tileScreen(tileId) : undefined;
      if (!from && reason === 'cat') {
        const c = this.cat.targetWorld() ?? this.lastCatPos;
        if (c) {
          const sp = this.camera.toScreen(c);
          from = { x: sp.x, y: sp.y };
        }
      }
      if (!from && reason === 'harvest') {
        const panel = s.state.machines.find((m) => m.type === 'solar');
        if (panel) {
          const w = this.machines.worldOf(panel);
          const sp = this.camera.toScreen(new pc.Vec3(w[0], w[1] + 0.6, w[2]));
          from = { x: sp.x, y: sp.y };
        }
      }
      this.flyGain(kind, amount, from);
    });
    b.on('resource.full', ({ kind }) => {
      if (kind === 'biomass') this.hud.feed('🌿 Biomass storage full — spend it or build a Seed Vault');
    });
    b.on('machine.built', ({ machine }) => {
      this.machines.add(machine, true);
      for (const t of s.grid.footprint(machine.roofId, machine.x, machine.z, machine.size)) if (t) this.grid.refresh(t, false);
      const w = this.machines.worldOf(machine);
      const p = new pc.Vec3(w[0], w[1], w[2]);
      this.vfx.ring(p, PALETTE.white, machine.size * 1.1, 0.6);
      this.vfx.burst(p, 16, { up: 3, size: 0.06 });
      this.camera.shake(0.05);
      this.sfx.build();
      const first = s.state.machines.filter((m) => m.type === machine.type && !m.starter).length === 1;
      const msg: Partial<Record<MachineData['type'], string>> = {
        solar: '☀️ Solar Panel online! More energy, more pulses.',
        condenser: '💧 Water Condenser online — water now flows on its own.',
        pollinator: '🌸 Pollinator Garden planted! Restore a tile right next to it to start a Bloom Chain.',
        droneHub: '🛸 Drone Hub built! Your drone can handle the small jobs now. The Mother Tree is unlocked too 🌳',
        motherTree: '🌳 Mother Tree planted! Restore tiles around it to charge its Bloom Pulse.',
        relay: '📡 Bloom Relay built! Build another within range: a bloom beside one sends a pulse to the other.',
        reservoirGarden: '⛲ Reservoir Garden built! Water Condensers within 2 tiles fill its basin — full basin = Overflow.',
      };
      if (first && msg[machine.type]) this.hud.toast(msg[machine.type]!, 'gold', 4);
    });
    b.on('chain.started', ({ chainId, originTileId }) => {
      const o = s.grid.byTileId(originTileId);
      if (o) this.tileFx.hold(`chain${chainId}`, o);
    });
    b.on('chain.event', ({ event: ev, combo }) => this.presentChainEvent(ev, combo));
    b.on('chain.fastForward', () => this.hud.feed('⏩ Huge chain! Fast-forwarding the rest…'));
    b.on('tree.discharged', ({ machineId }) => {
      const m = s.machine(machineId);
      if (!m) return;
      const w = this.machines.worldOf(m);
      const p = new pc.Vec3(w[0], w[1], w[2]);
      for (let i = 0; i < 3; i++) this.tweens.add(0.01, () => {}, { delay: i * 0.18, done: () => this.vfx.ring(p, i % 2 ? PALETTE.gold : '#7cf7c8', (s.upgrades.treeRadius + 1.2) * (0.6 + i * 0.25), 0.9) });
      this.vfx.burst(new pc.Vec3(p.x, p.y + 1.4, p.z), 30, { up: 4, speed: 2.2, size: 0.08, life: 1.3 });
      this.machines.pulseTree(machineId);
      this.camera.shake(0.08);
      this.sfx.chainEnd(10);
      if (!s.state.stats.firsts.treePulse || s.state.stats.firsts.treePulse === Math.round(s.time)) this.hud.toast('🌳 Mother Tree Bloom Pulse!<small>Everything around it bursts into life.</small>', 'gold', 3);
    });
    b.on('chain.ended', ({ chainId, combo, bonus, total, milestonePct, energy, crossings, areas }) => {
      if (areas >= 3) this.hud.feed(`🌸 Bloom chain ×${combo} swept ${areas} areas`);
      if (areas >= 6) this.hud.toast(`🌸 A city-wide bloom! ×${combo}<small>It swept across ${areas} areas.</small>`, 'gold', 3);
      this.tileFx.release(`chain${chainId}`);
      if (crossings > 0) this.hud.feed(`📡 Chain crossed ${crossings} Bloom Relay link${crossings > 1 ? 's' : ''}`);
      if (combo < 2) return;
      const ms = milestonePct ? ` · ×${combo >= 20 ? 20 : combo >= 10 ? 10 : 5} milestone +${Math.round(milestonePct * 100)}%` : '';
      this.hud.combo(combo, `+${Math.round(total)}🌿${energy >= 1 ? ` +${Math.round(energy)}⚡` : ''} earned${ms}`);
      this.hud.feed(`🌸 Bloom chain ×${combo}${bonus ? ` · +${bonus}🌿 bonus` : ''}`);
      this.sfx.chainEnd(combo);
      if (combo >= 5) {
        this.hud.toast(`🌸 BLOOM CHAIN ×${combo}!${bonus ? `<small>Chain bonus +${bonus} 🌿${ms}</small>` : ''}`, 'gold', 2.6);
        this.camera.shake(0.04);
      }
    });
    b.on('solar.boost', ({ machineId }) => {
      const m = s.machine(machineId);
      if (!m) return;
      const w = this.machines.worldOf(m);
      this.vfx.ring(new pc.Vec3(w[0], w[1] + 0.3, w[2]), PALETTE.gold, 0.7, 0.5);
      if ((this.solarFeedAt.get(machineId) ?? -99) < this.clock - 4) {
        this.solarFeedAt.set(machineId, this.clock);
        this.hud.feed('☀️ Blooming neighbour — solar ×2 for 5s');
      }
    });
    b.on('action.failed', ({ reason, tileId }) => {
      const ft = tileId ? s.grid.byTileId(tileId) : undefined;
      if (ft) this.grid.shake(ft);
      this.hud.showFail(reason, this.pointer.x, this.pointer.y);
      this.sfx.error();
      if (reason.includes('⚡')) {
        this.hud.flashResource('energy', 'short');
        if (s.state.time >= s.state.harvestReadyAt) this.hud.nudge('#harvestBtn', 5);
      }
      if (reason.includes('💧')) this.hud.flashResource('water', 'short');
      if (reason.includes('🌿')) this.hud.flashResource('biomass', 'short');
    });
    b.on('milestone.reached', ({ at, credited, next }) => {
      const icons = { energy: '⚡', water: '💧', biomass: '🌿' } as const;
      const got = (Object.entries(credited) as [keyof typeof icons, number][]).filter(([, v]) => v >= 1).map(([k, v]) => `+${Math.round(v)}${icons[k]}`).join(' ');
      this.hud.toast(`🌱 ${at} tiles restored!<small>${got || 'Storage was full'}${next ? ` · next reward at ${next}` : ''}</small>`, 'gold', 2.6);
      this.sfx.powerUp();
      this.hud.flashResource('biomass', 'flash');
    });
    b.on('upgrade.purchased', ({ id, level }) => {
      const def = UPGRADE_BY_ID[id];
      this.hud.toast(`${def.icon} ${def.name} ${['I', 'II', 'III', 'IV', 'V'][level - 1]}<small>${def.describe(level)}</small>`, 'gold', 2.6);
      this.machines.refreshUpgrades();
      this.sfx.coin();
      // Show where it changed the world: the machines, landmarks or fog it affects (nearest the view first).
      const spots = upgradeHighlights(s, id)
        .map((p) => ({ p, d: Math.hypot(p.x - this.camera.target.x, p.z - this.camera.target.z) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 24);
      for (const { p } of spots) {
        const r = s.grid.roof(p.roofId);
        if (!r) continue;
        this.vfx.burst(new pc.Vec3(r.origin[0] + p.x, r.origin[1] + r.height + 0.5, r.origin[2] + p.z), 12, { up: 2.5 });
      }
      if (this.selected) this.inspectTimer = 0;
      this.save();
    });
    b.on('drone.spawned', ({ droneId }) => {
      const d = s.state.drones.find((x) => x.id === droneId);
      if (d) this.drones.add(d, true);
    });
    b.on('drone.despawned', ({ droneId }) => this.drones.remove(droneId));
    b.on('drone.jobStarted', () => this.sfx.drone());
    b.on('cat.spawned', ({ anchorId }) => {
      this.cat.show(anchorId, true);
      this.meowTimer = 20;
      this.save();
    });
    b.on('cat.found', ({ reward, summary, extras }) => {
      const p = this.cat.targetWorld();
      if (p) {
        this.lastCatPos = p.clone();
        const soft = this.cat.softSparkle;
        this.vfx.burst(p, soft ? 12 : 40, { up: soft ? 2 : 4, speed: soft ? 1 : 2, size: soft ? 0.05 : 0.07, life: soft ? 1 : 1.4 });
        this.vfx.ring(p, PALETTE.gold, soft ? 0.9 : 1.6, 0.8);
      }
      this.cat.hide(true);
      this.hud.hideTip();
      this.sfx.meow();
      setTimeout(() => this.sfx.fanfare(), 250);
      this.hud.toast('🐱 LUCKY CAT FOUND!', 'cat', 2.4);
      this.hud.catReward(`${CAT_REWARD_NAMES[reward]}${extras ? ` + ${extras} saved-up harvest${extras > 1 ? 's' : ''}` : ''}`, summary);
      this.save();
    });
    b.on('cat.moved', ({ anchorId }) => {
      this.cat.show(anchorId, true);
      this.save();
    });
    b.on('cat.goldenRelay', () => {
      this.hud.feed(
        `🐱✨ Golden Relay: your next green corridor hop blooms ${this.sim.state.relayBonus} extra tiles`,
      );
    });
    b.on('cat.stash', () => {
      // A soft hint that something lucky is still waiting, never a pointer.
      this.sfx.meow(true);
      const p = this.cat.targetWorld();
      if (p) this.vfx.burst(p, 6, { up: 1.5, size: 0.04, speed: 0.4 });
    });
    b.on('buff.started', ({ seconds }) => this.hud.feed(`☀️ Solar Surge ×${TUNING.cat.frenzyMult} for ${Math.round(seconds)}s`));
    b.on('harvest', () => this.sfx.coin());
    b.on('rooftop.coreReady', () => {
      this.machines.setCoreState('ready');
      this.hud.toast('✨ The Rooftop Core is humming!<small>Click it (or the button) to awaken the building.</small>', 'gold', 5);
      this.sfx.chainEnd(10);
    });
    b.on('rooftop.coreRestored', () => this.playCoreSequence());
    // City 10.4: a pulse arcs from one Bloom Relay to the next, landing as a ring.
    b.on('relay.city', ({ from, to, travel }) => {
      const a = this.posOf(from);
      const b2 = this.posOf(to);
      if (!a || !b2) return;
      this.machines.splash(from);
      this.vfx.arc(new pc.Vec3(a.x, a.y + 1.2, a.z), new pc.Vec3(b2.x, b2.y + 1.2, b2.z), '#9ff7ff', travel);
      this.tweens.add(0.01, () => {}, { delay: travel, done: () => {
        this.vfx.ring(new pc.Vec3(b2.x, b2.y + 0.05, b2.z), '#9ff7ff', 2.2, 0.6);
        this.machines.splash(to);
      } });
    });
    b.on('machine.boosted', ({ machineId }) => {
      const m = s.machine(machineId);
      if (!m) return;
      const w = this.machines.worldOf(m);
      this.vfx.ring(new pc.Vec3(w[0], w[1] + 0.05, w[2]), '#6ff3ff', 0.9 * m.size, 0.5);
      if (this.clock - this.lastBoostFeed > 6) {
        this.lastBoostFeed = this.clock;
        this.hud.feed(`⚡ Pulse boost: ${MACHINES[m.type].name} — its next trigger gets +1`);
      }
      if (this.selected === machineId) this.inspectTimer = 0;
    });
    b.on('machine.boostUsed', ({ machineId }) => {
      const m = s.machine(machineId);
      if (!m) return;
      const w = this.machines.worldOf(m);
      this.vfx.ring(new pc.Vec3(w[0], w[1] + 0.05, w[2]), PALETTE.gold, 1.3 * m.size, 0.6);
      this.vfx.burst(new pc.Vec3(w[0], w[1] + 0.5, w[2]), 10, { up: 2, size: 0.06 });
    });
    b.on('reservoir.fill', ({ machineId, from }) => {
      const a = this.posOf(from);
      const b2 = this.posOf(machineId);
      if (a && b2) this.vfx.arc(a, b2, PALETTE.water, 0.6);
      if (b2) this.vfx.burst(b2, 4, { up: 1, size: 0.04, speed: 0.4 });
    });
    // City 10.3: water runs along the canal, tile by tile, from one machine to another.
    b.on('canal.flow', ({ from, to, path, kind }) => {
      const step = Math.min(0.04, 1.6 / Math.max(1, path.length));
      path.forEach((id, i) => {
        const t = s.grid.byTileId(id);
        if (!t) return;
        this.tileFx.flash(t, '#f2fdff', kind === 'overflow' ? 0.85 : 0.55, 0.55, i * step);
        if (kind === 'overflow' && i % 3 === 0) this.tweens.add(0.01, () => {}, { delay: i * step, done: () => this.vfx.burst(this.tileVec(t), 3, { up: 1.2, size: 0.045, speed: 0.6 }) });
      });
      const a = this.posOf(from);
      const b2 = this.posOf(to);
      if (b2) this.tweens.add(0.01, () => {}, { delay: path.length * step, done: () => this.vfx.burst(b2, kind === 'overflow' ? 14 : 5, { up: 1.6, size: 0.05, speed: 0.8 }) });
      if (a && !path.length && b2) this.vfx.arc(a, b2, PALETTE.water, 0.6);
    });
    b.on('reservoir.overflow', ({ machineId }) => {
      const p = this.posOf(machineId);
      this.machines.splash(machineId);
      if (p) {
        for (let i = 0; i < 3; i++) this.tweens.add(0.01, () => {}, { delay: i * 0.15, done: () => this.vfx.ring(p, i % 2 ? '#a8ecff' : PALETTE.water, 1.4 + i * 0.9, 0.7) });
        this.vfx.burst(new pc.Vec3(p.x, p.y + 0.3, p.z), 24, { up: 3.2, speed: 1.6, size: 0.07 });
      }
      this.sfx.pulse();
      this.camera.shake(0.04);
      if ((s.state.progression.overflows ?? 0) <= 1) this.hud.toast(`⛲ Reservoir Overflow!<small>Water spills into the dry planters: they bloom lush (×${TUNING.neighbourhood.reservoir.lushMult} 🌿 for a while).</small>`, 'gold', 3.5);
      else this.hud.feed('⛲ Overflow! Dry tiles burst into lush bloom');
    });
    b.on('canopy.burst', ({ machineId, radius, gardens }) => {
      const p = this.posOf(machineId);
      this.machines.burstTree(machineId);
      if (p) {
        const base = new pc.Vec3(p.x, p.y - 0.2, p.z);
        for (let i = 0; i < 4; i++) this.tweens.add(0.01, () => {}, { delay: i * 0.18, done: () => this.vfx.ring(base, i % 2 ? PALETTE.gold : '#7cf7c8', (radius + 1.2) * (0.5 + i * 0.25), 0.9) });
        this.vfx.burst(new pc.Vec3(p.x, p.y + 2.2, p.z), 36, { up: 4.2, speed: 2.4, size: 0.09, life: 1.4 });
        for (const g of gardens) {
          const gp = this.posOf(g);
          if (gp) this.vfx.arc(p, gp, PALETTE.pink, 0.7);
        }
      }
      this.camera.shake(0.09);
      this.sfx.chainEnd(10);
      if ((s.state.progression.canopyBursts ?? 0) <= 1) this.hud.toast(`🌳 Canopy Burst!<small>The Elder Tree releases its charge.${gardens.length ? ` ${gardens.length} 🌸 garden${gardens.length > 1 ? 's' : ''} carried it further!` : ' 🌸 Gardens inside its reach would carry it further.'}</small>`, 'gold', 3.5);
      else this.hud.feed(`🌳 Canopy Burst${gardens.length ? ` · amplified by ${gardens.length} garden${gardens.length > 1 ? 's' : ''}` : ''}`);
    });
    b.on('district.ready', ({ districtId }) =>
      this.hud.toast(`🌸 ${this.sim.districts.title(districtId)} is ready to bloom!<small>${TUNING.district.minAwake} neighbouring landmarks are awake. Open any of its areas to set off the district bloom.</small>`, 'gold', 5),
    );
    b.on('district.bloom', (e) => {
      if (!e.replay) this.save(); // claimed before any presentation: a reload can never pay twice
      this.runDistrictBloom(e.districtId, e.restored.length + e.lusher.length, e.reward, e.replay);
    });
  }

  private lastCatPos?: pc.Vec3;
  /** World position of a tile or machine id (chain sources/targets can be either). */
  private posOf(id: string | undefined, _towardRoof?: string): pc.Vec3 | undefined {
    if (!id) return undefined;
    const t = this.sim.grid.byTileId(id);
    if (t) return this.tileVec(t);
    const m = this.sim.machine(id);
    if (!m) return undefined;
    const w = this.machines.worldOf(m);
    return new pc.Vec3(w[0], w[1] + 0.25, w[2]);
  }

  /** Replays one deterministic chain event as light, motion and sound. */
  private lastPanAt = 0;
  private followAt = 0;
  /** City 10.6: per-area chain summaries, the wave front and a per-frame VFX budget. */
  private chainSummary!: ChainSummary;
  private vfxBudget = new VfxBudget(18);
  private frameNo = 0;
  private frontAt = 0;
  private summaryAt = 0;

  /** Wave front ring and per-area summary lines for the biggest running chain (throttled). */
  private updateChainPresentation(dt: number) {
    this.frontAt -= dt;
    this.summaryAt -= dt;
    const tr = this.chainSummary.biggest();
    if (this.summaryAt <= 0) {
      this.summaryAt = 0.25;
      this.hud.chainAreas(tr && tr.total >= 12 && tr.perArea.size > 1 ? this.chainSummary.lines(tr) : []);
    }
    if (!tr || tr.total < 20 || this.frontAt > 0 || this.settings.reducedMotion) return;
    this.frontAt = 0.3;
    this.vfx.ring(new pc.Vec3(tr.fx, 0.12, tr.fz), tr.total >= 100 ? '#ff5fb8' : '#ffd25e', 3.2, 0.6);
  }

  private presentChainEvent(ev: ChainEvent, combo: number) {
    const s = this.sim;
    // Camera follows big chains (setting): glide toward the wave front now and then, never against the player.
    if (this.settings.followChains && combo >= 20 && !this.cinematic) {
      const now = performance.now();
      const tr = this.chainSummary.tracks.get(ev.chainId);
      if (tr && this.city && now - this.followAt > 1500 && now - this.lastPanAt > 4000) {
        this.followAt = now;
        this.camera.glide(tr.fx, 0, tr.fz); // the smoothed wave front, not each bloom
      }
    }
    // Huge chains: beyond the per-frame budget, events only flash their tile (no arcs or bursts).
    if (combo >= 30 && !this.vfxBudget.take(this.frameNo)) {
      const t = s.grid.byTileId(ev.target);
      if (t && (ev.type === 'RESTORE' || ev.type === 'GROW' || ev.type === 'LUSH')) {
        this.tileFx.flash(t, combo >= 100 ? '#ff5fb8' : '#ffb81f', 0.45, 0.9);
        this.sfx.bloom(combo);
      }
      if (combo >= 2) this.hud.combo(combo);
      return;
    }
    const targetRoof = s.grid.byTileId(ev.target)?.roofId;
    const from = this.posOf(ev.source, targetRoof);
    const to = this.posOf(ev.target);
    const wave = combo >= 10 ? '#ff5fb8' : combo >= 5 ? '#ffb81f' : '#38d94a';
    switch (ev.type) {
      case 'RESTORE':
      case 'GROW':
      case 'LUSH': {
        const t = s.grid.byTileId(ev.target);
        if (t && ev.type === 'LUSH') this.vfx.burst(this.tileVec(t, 0.3), 8, { up: 1.6, size: 0.06 });
        if (t) this.tileFx.flash(t, wave, 0.45, 0.9);
        if (from && to && ev.cause !== 'motherTree' && ev.cause !== 'canopy')
          this.vfx.arc(from, to, ev.cause === 'overflow' ? PALETTE.water : ev.cause === 'relay' ? PALETTE.coreGlow : combo >= 5 ? PALETTE.pink : PALETTE.flowerCore, 0.5);
        if (combo >= 2) this.hud.combo(combo);
        this.sfx.bloom(combo);
        break;
      }
      case 'CORRIDOR':
        if (from && to) {
          this.vfx.arc(from, to, '#7fe07a', 0.7);
          this.vfx.burst(to, 8, { up: 1.6, size: 0.05 });
        }
        if (combo >= 2) this.hud.combo(combo);
        break;
      case 'POLLINATE':
        if (from && to) {
          this.vfx.arc(from, to, PALETTE.pink, 0.6);
          this.vfx.burst(to, 6, { up: 1.2, size: 0.04, speed: 0.6 });
        }
        break;
      case 'PRODUCE_ENERGY':
        if (from && to) this.vfx.arc(from, to, PALETTE.gold, 0.5);
        if (combo >= 2) this.hud.combo(combo);
        break;
      case 'PRODUCE_WATER':
        if (to) this.vfx.ring(to, PALETTE.water, 1.4, 0.6);
        this.sfx.pulse();
        break;
      case 'CHARGE':
        if (from && to && !this.settings.reducedMotion) this.vfx.arc(from, to, '#7cf7c8', 0.35);
        break;
      case 'RELAY': {
        // A Bloom Relay pulse arrives (the arc itself is drawn on relay.city).
        const dest = this.sim.relays.otherEnd(ev.target, ev.source ?? '');
        const arrive = this.posOf(dest?.id);
        if (arrive) this.vfx.burst(new pc.Vec3(arrive.x, arrive.y + 1, arrive.z), 16, { up: 2.5, size: 0.07 });
        this.sfx.chainEnd(Math.min(10, 3 + combo));
        if (combo >= 2) this.hud.combo(combo);
        break;
      }
      default:
        break;
    }
  }

  // ───────────────────────── core sequence ─────────────────────────

  private playCoreSequence() {
    this.cinematic = true;
    this.select(undefined);
    this.overlays.hideFrame();
    this.overlays.hideGhost();
    this.hud.hideTip();
    const park = this.sim.areas.landmark(PARK);
    this.hud.cinematic(true, 'The fountain flows again!');
    if (park) this.machines.setLandmarkState(park.id, 'awake');
    else this.machines.setCoreState('awake');
    this.sfx.fanfare();
    const core = park ? this.machines.coreWorld(GROUND, park.id) : this.machines.coreWorld();
    const cp = core ? new pc.Vec3(core[0], core[1], core[2]) : new pc.Vec3(1, 1.5, 1);
    const base = new pc.Vec3(cp.x, 0.1, cp.z);
    this.camera.shake(0.12);
    for (let i = 0; i < 5; i++)
      this.tweens.add(0.01, () => {}, {
        delay: i * 0.35,
        done: () => {
          this.vfx.ring(base, i % 2 ? PALETTE.gold : PALETTE.coreGlow, 3 + i * 2.2, 1.2);
          this.vfx.burst(cp, 24, { up: 4.5, speed: 2.4, size: 0.08, life: 1.5 });
        },
      });
    this.tweens.add(0.01, () => {}, { delay: 2.2, done: () => this.camera.focus(8, 0, 8, Math.max(this.camera.minZoom, 0.5), 2.4) });
    this.cinematicEnd = () => {
      if (!this.cinematic) return;
      this.cinematic = false;
      this.hud.cinematic(false);
      this.hud.toast('🌫️ The fog rolls back!<small>The park now grows +25% biomass. Restore the areas around it — tiles next to clear ground first — and wake their landmarks.</small>', 'gold', 7);
      this.save();
    };
    this.tweens.add(0.01, () => {}, { delay: TUNING.core.sequenceSeconds, done: () => this.cinematicEnd?.() });
    this.save();
  }

  private skipCinematic() {
    if (!this.cinematic) return;
    for (let i = 0; i < 4; i++) this.tweens.update(10);
    this.cinematicEnd?.();
  }

  // ───────────────────────── the city ─────────────────────────

  /** A landmark Core (on the ground or a city rooftop) that can be woken now. */
  private landmarkReady(m: MachineData): boolean {
    const id = this.sim.areas.areaOf(m)!;
    return id === PARK ? this.sim.progression.coreReady() : this.sim.areas.ready(id);
  }

  private wakeLandmark(m: MachineData) {
    if (this.cinematic) return;
    const id = this.sim.areas.areaOf(m)!;
    if (id === PARK) this.sim.progression.activateCore();
    else this.sim.areas.clear(id);
  }

  private landmarkHtml(m: MachineData): string {
    return areaPanelHtml(this.sim, this.sim.areas.areaOf(m)!, m.id);
  }

  /** Opens an area's panel (from its label in the overview): selects its landmark and flies there. */
  private openArea(id: string) {
    const lm = this.sim.areas.landmark(id);
    if (!lm) return;
    this.select(lm.id);
    this.focusArea(id);
  }

  /** Flies the camera to an area's landmark (never during a cinematic; player input takes over). */
  private focusArea(id: string) {
    if (this.cinematic) return;
    const [x, z] = this.sim.areas.info(id).landmark;
    this.camera.glide(x + 1, 0, z + 1, Math.max(this.camera.zoom, 0.8));
  }

  private attentionIndex = 0;
  /** F: cycle through areas that need attention (landmark ready, then fog in progress). */
  private focusNextArea() {
    const s = this.sim;
    const open = s.areas.revealed().filter((id) => s.areas.fog(id) !== 'cleared' && id !== PARK);
    const list = [...open.filter((id) => s.areas.ready(id)), ...open.filter((id) => !s.areas.ready(id)).sort((a, b) => s.areas.share(b) - s.areas.share(a))];
    if (!list.length) return this.focusArea(PARK);
    this.focusArea(list[this.attentionIndex++ % list.length]);
  }

  /** Labels over revealed city areas: a ready landmark always; names and progress when zoomed out. */
  private updateAreaLabels() {
    const s = this.sim;
    const show = this.city && !this.cinematic && !this.hud.introOpen;
    const zoomedOut = this.camera.zoom < 0.6;
    const live = new Set<string>();
    if (show) {
      const c = this.app.graphicsDevice.canvas as HTMLCanvasElement;
      // Overview icons: a chain blooming there now, and where you've found the Lucky Cat.
      const chaining = zoomedOut ? s.chains.activeAreas() : new Set<string>();
      const catAreas = new Set<string>();
      if (zoomedOut)
        for (const e of s.state.cat.log ?? []) {
          const a = s.cat.anchor(e.anchorId);
          if (a?.roofId === GROUND && a.needsFreeTile) {
            const ar = s.areas.areaOf({ roofId: GROUND, x: a.needsFreeTile[0], z: a.needsFreeTile[1] });
            if (ar) catAreas.add(ar);
          }
        }
      for (const id of s.areas.revealed()) {
        const a = s.areas.info(id);
        const fog = s.areas.fog(id);
        const ready = id !== PARK && s.areas.ready(id);
        if (!ready && !zoomedOut) continue;
        const sp = this.camera.toScreen(new pc.Vec3(a.landmark[0] + 1, 2.4, a.landmark[1] + 1));
        if (sp.x < -50 || sp.y < -50 || sp.x > c.clientWidth + 50 || sp.y > c.clientHeight + 50) continue;
        const def = AREA_TYPES[a.type];
        const key = `areaLabel-${id}`;
        live.add(key);
        const lm = s.areas.landmark(id);
        let html: string;
        const icons = `${chaining.has(id) ? ' 🔗' : ''}${catAreas.has(id) ? ' 🐱' : ''}`;
        if (ready && lm) html = `✨ ${esc(a.landmarkName)}<button data-wake="${lm.id}">Wake it</button>`;
        else if (fog === 'cleared') html = `<span data-area="${id}">${def.icon} ${esc(id === PARK ? 'The Park' : def.name)}${icons}<small>clear${a.authored ? ' · ' + esc(a.landmarkName) : ''}</small></span>`;
        else html = `<span data-area="${id}">${def.icon} ${esc(def.name)}${icons}<small>🌫️ ${Math.min(100, Math.round((s.areas.counts(id).restored / s.areas.need(id)) * 100))}%</small></span>`;
        // Zoomed out, every label is a button to its area's panel.
        this.hud.worldLabel(key, html, sp.x, sp.y, ready || zoomedOut);
      }
    }
    for (const key of this.areaLabels) if (!live.has(key)) this.hud.worldLabel(key, null);
    this.areaLabels = live;
  }
  private areaLabels = new Set<string>();

  private onAreaCleared(id: string) {
    const s = this.sim;
    this.chunks.markArea(id, true);
    for (const nb of s.areas.info(id).neighbours) this.chunks.markArea(nb);
    this.updateCityBounds();
    if (id === PARK) return; // the fountain has its own finale
    const lm = s.areas.landmark(id);
    if (lm) {
      this.machines.setLandmarkState(lm.id, 'awake');
      const w = this.machines.coreWorld(GROUND, lm.id);
      if (w) {
        const p = new pc.Vec3(w[0], 0.1, w[2]);
        for (let i = 0; i < 3; i++) this.tweens.add(0.01, () => {}, { delay: i * 0.25, done: () => this.vfx.ring(p, i % 2 ? PALETTE.gold : PALETTE.coreGlow, 4 + i * 4, 1.2) });
        this.vfx.burst(new pc.Vec3(w[0], w[1], w[2]), 30, { up: 4, speed: 2.2, size: 0.08, life: 1.4 });
      }
    }
    this.sfx.fanfare();
    this.camera.shake(0.06);
    const a = s.areas.info(id);
    const fresh = a.neighbours.filter((n) => s.areas.fog(n) === 'frontier').length;
    this.hud.toast(`🌫️ The fog lifts from the ${AREA_TYPES[a.type].name.toLowerCase()}!<small>${a.landmarkName} wakes${fresh ? ` · ${fresh} new area${fresh > 1 ? 's' : ''} emerge from the gloom` : ''}.</small>`, 'gold', 4.5);
    this.save();
  }

  // ───────────────────────── district blooms (City 10.7) ─────────────────────────

  private playDistrictBloom(id: string, replay: boolean) {
    if (this.cinematic) return;
    if (replay) this.sim.districts.replay(id);
    else this.sim.districts.bloom(id);
  }

  /**
   * A district bloom on screen: the camera pulls back over the district, each awake landmark sends out a ring,
   * a green wave rolls outward over its cleared areas, then the reward. Skippable; a replay changes nothing.
   */
  private runDistrictBloom(id: string, changed: number, reward: Partial<Record<'energy' | 'water' | 'biomass', number>>, replay: boolean) {
    const s = this.sim;
    const at = (delay: number, fn: () => void) => this.tweens.add(0.01, () => {}, { delay, done: fn });
    const awake = s.districts.members(id).filter((a) => s.areas.fog(a) === 'cleared');
    if (!awake.length) return;
    const name = s.districts.title(id);
    this.cinematic = true;
    this.select(undefined);
    this.overlays.hideFrame();
    this.overlays.hideGhost();
    this.hud.hideTip();
    this.hud.cinematic(true, replay ? `${name}: the district bloom` : `${name} blooms!`);
    this.sfx.fanfare();
    const lms = awake.map((a) => s.areas.info(a).landmark);
    const cx = lms.reduce((a, l) => a + l[0] + 1, 0) / lms.length;
    const cz = lms.reduce((a, l) => a + l[1] + 1, 0) / lms.length;
    this.camera.focus(cx, 0, cz, Math.max(this.camera.minZoom, 0.3), 1.8);
    // 1. Every awake landmark rings out, nearest the middle first.
    lms.forEach((l, i) => {
      const p = new pc.Vec3(l[0] + 1, 0.1, l[1] + 1);
      at(0.6 + Math.min(1.6, Math.hypot(l[0] - cx, l[1] - cz) * 0.02) + i * 0.05, () => {
        this.vfx.ring(p, i % 2 ? PALETTE.gold : PALETTE.coreGlow, 5, 1.1);
        this.vfx.burst(new pc.Vec3(p.x, 1.5, p.z), 16, { up: 3, size: 0.08 });
      });
    });
    // 2. The green wave: the ground re-renders lusher, area by area, outward from the middle.
    awake.forEach((a) => {
      const [ax, az] = s.areas.info(a).landmark;
      at(2.4 + Math.min(2.6, Math.hypot(ax - cx, az - cz) * 0.03), () => {
        if (!replay) this.chunks.markArea(a, true);
        const tiles = s.areas.tiles(a);
        for (let i = 0; i < tiles.length; i += 23) {
          const t = tiles[i];
          if (t.blocked || t.occupantId) continue;
          this.tileFx.flash(t, '#38d94a', 0.5, 0.9, (i % 7) * 0.05);
        }
      });
    });
    // 3. Reward.
    at(5.6, () => {
      const c = new pc.Vec3(cx, 0.4, cz);
      for (let k = 0; k < 4; k++) at(k * 0.2, () => this.vfx.ring(c, k % 2 ? PALETTE.gold : PALETTE.coreGlow, 10 + k * 6, 1.2));
      this.vfx.burst(new pc.Vec3(cx, 3, cz), 60, { up: 5, speed: 3, size: 0.09, life: 1.6 });
      this.camera.shake(0.1);
      this.sfx.chainEnd(8);
      if (!replay) (['biomass', 'water', 'energy'] as const).forEach((k, i) => reward[k] && at(i * 0.15, () => this.flyGain(k, reward[k]!)));
    });
    this.cinematicEnd = () => {
      if (!this.cinematic) return;
      this.cinematic = false;
      this.hud.cinematic(false);
      if (!replay) {
        // A skip lands every tile at once.
        for (const a of awake) this.chunks.markArea(a, true);
        this.hud.toast(`🌸 ${name} is in full bloom!<small>${changed} tiles grew lusher · +${reward.biomass ?? 0}🌿 +${reward.water ?? 0}💧 +${reward.energy ?? 0}⚡. Your machines are just as you left them.</small>`, 'gold', 6);
      }
      this.save();
    };
    at(TUNING.district.seconds, () => this.cinematicEnd?.());
  }

  private lastBoostFeed = -99;
  private boostPulseT = 0;
  /** A soft cyan ring keeps pulsing on machines your taps have boosted. */
  /** Why a raised layer can't be played yet (city rooftops wait for a Bloom Relay). */
  private lockedReason(_id: string): string {
    return `Out of reach: build a 📡 Bloom Relay on the street within ${this.sim.relays.range()} tiles of this rooftop.`;
  }

  private updateBoostRings(dt: number) {
    this.boostPulseT -= dt;
    if (this.boostPulseT > 0) return;
    this.boostPulseT = 1.1;
    for (const m of this.sim.state.machines) {
      if ((m.overchargeUntil ?? 0) <= this.sim.time) continue;
      const w = this.machines.worldOf(m);
      this.vfx.ring(new pc.Vec3(w[0], w[1] + 0.05, w[2]), '#6ff3ff', 0.75 * m.size, 0.8);
    }
  }

  // ───────────────────────── frame loop ─────────────────────────

  /** Drops render resolution when frames are slow for a while, and restores it when there's headroom. */
  private adaptQuality(rawDt: number) {
    if (document.hidden || rawDt > 0.5) return;
    const dev = this.app.graphicsDevice;
    if (rawDt > 1 / 40) {
      this.slowFor += rawDt;
      this.fastFor = 0;
    } else if (rawDt < 1 / 55) {
      this.fastFor += rawDt;
      this.slowFor = Math.max(0, this.slowFor - rawDt);
    }
    if (this.slowFor > 1.5 && dev.maxPixelRatio > 1) {
      dev.maxPixelRatio = Math.max(1, dev.maxPixelRatio - 0.25);
      this.app.resizeCanvas();
      this.slowFor = 0;
    } else if (this.fastFor > 8 && dev.maxPixelRatio < this.maxDpr) {
      dev.maxPixelRatio = Math.min(this.maxDpr, dev.maxPixelRatio + 0.25);
      this.app.resizeCanvas();
      this.fastFor = 0;
    }
  }

  /**
   * City 06.5: time passed without frames (a hidden tab, a long hitch) is owed to the simulation, up to a cap,
   * and paid back a few milliseconds per frame so no frame stalls.
   */
  awayFor(seconds: number) {
    if (!(seconds > 0)) return;
    const C = TUNING.catchUp;
    // Phase 4 E01: time beyond what the live catch-up covers becomes offline progress (reduced, bounded).
    const beyond = seconds - Math.max(0, C.maxSeconds - this.catchUpDebt);
    if (beyond > 0) {
      const r = this.sim.offline.apply(beyond);
      if (r) {
        this.hud.toast(offlineToast(r, 'While you were away'), 'gold', 6);
        this.saveNow();
      }
    }
    const was = this.catchUpDebt;
    this.catchUpDebt = Math.min(C.maxSeconds, this.catchUpDebt + seconds);
    if (was < C.toastFrom && this.catchUpDebt >= C.toastFrom) {
      const m = Math.round(this.catchUpDebt / 60);
      this.hud.toast(`⏩ Catching up${m >= 1 ? ` ${m} min` : ''}…<small>Your city kept growing while you were away.</small>`, '', 3);
    }
  }

  /** Runs simulation ticks within the frame budget: the frame's own time first, then any catch-up owed. */
  private runSim(dt: number) {
    const budget = TUNING.catchUp.frameBudgetMs;
    const t0 = performance.now();
    this.acc += dt * this.speed;
    let n = 0;
    while (this.acc >= TUNING.simStep && (n === 0 || performance.now() - t0 < budget)) {
      this.sim.tick(TUNING.simStep);
      this.acc -= TUNING.simStep;
      n++;
    }
    // More owed than the budget allows (a slow device at high speed): carry it as catch-up, not a backlog.
    if (this.acc > 1) {
      this.catchUpDebt = Math.min(TUNING.catchUp.maxSeconds, this.catchUpDebt + this.acc - TUNING.simStep);
      this.acc = TUNING.simStep;
    }
    while (this.catchUpDebt >= TUNING.simStep && performance.now() - t0 < budget) {
      this.sim.tick(TUNING.simStep);
      this.catchUpDebt -= TUNING.simStep;
    }
    if (this.catchUpDebt < TUNING.simStep) this.catchUpDebt = 0;
    this.simMs = performance.now() - t0;
    this.simMsWorst = Math.max(this.simMsWorst, this.simMs);
  }

  private update(rawDt: number) {
    const dt = Math.min(rawDt, TUNING.maxFrameDt);
    this.clock += dt;
    this.adaptQuality(rawDt);
    // City 11.4: drones well outside the view fly by the clock (no per-tick moves); near ones fly for real.
    const view = this.city ? this.groundRect() : undefined;
    this.sim.drones.focus = view ? { x: (view.x0 + view.x1) / 2, z: (view.z0 + view.z1) / 2, radius: Math.hypot(view.x1 - view.x0, view.z1 - view.z0) / 2 + 24 } : undefined;
    if (!this.paused && !this.hiddenPause && !this.hud.modalOpen) {
      if (rawDt > TUNING.maxFrameDt && !this.hiddenAt) this.awayFor(Math.min(rawDt, 30) - TUNING.maxFrameDt); // a hitch
      this.runSim(dt);
    }
    this.tweens.update(dt);
    this.scene.update(dt);
    this.grid.update(dt);
    const rect = this.city ? this.groundRect() : undefined;
    if (rect) this.chunks.update(dt, rect, this.camera.target, this.camera.zoom);
    this.machines.update(dt, rect);
    this.drones.update(dt);
    this.cat.update(dt);
    this.butterflies.update(dt);
    this.tileFx.update(dt);
    this.frameNo++;
    this.updateChainPresentation(dt);
    this.vfx.update(dt);
    // First-tile beacon until the player restores something.
    if (this.sim.state.progression.tutorialStep === 0 && !this.hud.introOpen && !this.cinematic) {
      const tiles = this.sim.progression.tilesFor(HOME);
      const t = tiles.find((x) => x.ground === 'prepared' && !x.occupantId) ?? tiles.find((x) => x.ground === 'polluted' && !x.blocked && !x.occupantId);
      if (t) this.overlays.showBeacon(t.roofId, t.x, t.z);
    } else this.overlays.hideBeacon();
    this.overlays.update(dt);
    this.camera.update(dt);
    this.hud.update(dt);
    this.sfx.layers = Math.min(3, Math.floor(this.sim.progression.restoredCount(HOME) / 12));
    this.sfx.update(dt);

    if (this.selected) {
      this.inspectTimer -= dt;
      if (this.inspectTimer <= 0) {
        this.inspectTimer = 0.3;
        this.renderInspect();
        this.showDroneTasks();
      }
    }
    if (this.sim.state.cat.active && !this.paused) {
      this.meowTimer -= dt;
      if (this.meowTimer <= 0) {
        this.meowTimer = 30 + Math.random() * 20;
        this.sfx.meow(true);
      }
    }
    this.updateAreaLabels();
    this.updateBoostRings(dt);

    this.saveTimer += dt;
    if (this.saveTimer >= TUNING.autosaveSeconds) {
      this.saveTimer = 0;
      this.save();
    }
    if (this.settings.debug) {
      this.fpsAcc.t += rawDt;
      this.fpsAcc.n++;
      if (this.fpsAcc.t >= 0.5) {
        this.fpsAcc.fps = this.fpsAcc.n / this.fpsAcc.t;
        this.fpsAcc.t = 0;
        this.fpsAcc.n = 0;
        const st = this.sim.state;
        this.hud.setDebug(
          `FPS ${this.fpsAcc.fps.toFixed(0)}  dpr ${this.app.graphicsDevice.maxPixelRatio}  sim ${st.time.toFixed(1)}s ×${this.speed}\n` +
            `draw calls ${this.app.stats.drawCalls.total} (budget 400)  chunks ${this.chunks?.loadedCount ?? 0}\n` +
            `chains ${this.sim.chains.activeRuns} queued ${this.sim.chains.pendingSteps}\n` +
            `drones ${st.drones.length}  machines ${st.machines.length}\n` +
            `cat ${st.cat.active ? st.cat.active.anchorId : `next ${st.cat.firstSpawned ? st.cat.nextSpawnAt.toFixed(0) : 'first'}`}\n` +
            `restored ${this.sim.progression.restoredCount(HOME)} full ${this.sim.progression.fullBloomCount(HOME)}`,
        );
      }
    }
  }
}

/** "While you were away" summary for the offline report (Phase 4 E01). */
export function offlineToast(r: OfflineReport, title: string): string {
  const h = Math.floor(r.away / 3600);
  const m = Math.round((r.away % 3600) / 60);
  const away = h ? `${h} h ${m} min` : `${m} min`;
  const icons = { energy: '⚡', water: '💧', biomass: '🌿' } as const;
  const fmt = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
  const got = (['energy', 'water', 'biomass'] as const).filter((k) => r.credited[k] >= 1).map((k) => `+${fmt(r.credited[k])}${icons[k]}`);
  const lost = (['energy', 'water', 'biomass'] as const).filter((k) => r.lost[k] >= 1).map((k) => `${fmt(r.lost[k])}${icons[k]}`);
  const lines = [`🌙 ${title} (${away})`];
  const capped = r.away > r.seconds + 1 ? ` · counted up to ${Math.round(r.seconds / 3600)} h` : '';
  lines.push(`<small>Your garden kept growing at half pace${capped}: ${got.join(' ') || 'nothing new'}${r.droneJobs ? ` · drones restored ${r.restored} and nurtured ${r.grown} tiles` : ''}${lost.length ? ` · ${lost.join(' ')} didn't fit in storage` : ''}</small>`);
  return lines.join('');
}
