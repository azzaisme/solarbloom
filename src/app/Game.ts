import { big, fmt, type Big } from '../core/Big';
import { HOME } from '../gameplay/ProgressionSystem';
import * as pc from 'playcanvas';
import { Sfx } from '../audio/Sfx';
import { formatCost, RES_ICON } from '../core/Economy';
import { PARK } from '../core/Areas';
import { createInitialState, GROUND } from '../core/GameState';
import { AREA_TYPES } from '../data/city';
import { distToFootprint } from '../core/Grid';
import type { BuildableType, MachineData, ResourceKind, TileData } from '../core/types';
import { MACHINES, TIER2, TIER3, machineIcon, machineName } from '../data/machines';
import { TUNING } from '../data/tuning';
import { UPGRADE_BY_ID } from '../data/upgrades';
import type { ChainEvent } from '../gameplay/BloomChainSystem';
import { CAT_REWARD_NAMES } from '../gameplay/LuckyCatSystem';
import { WORLD_EVENT_INFO } from '../gameplay/WorldEventSystem';
import type { OfflineReport } from '../gameplay/OfflineSystem';
import { Sim } from '../gameplay/Sim';
import { Butterflies } from '../rendering/Butterflies';
import { Birds } from '../rendering/Birds';
import { Fauna } from '../rendering/Fauna';
import { EcoBadge } from '../ui/EcoBadge';
import { CameraController } from '../rendering/CameraController';
import { setTreeCursor } from '../rendering/Foliage';
import { CatVisuals } from '../rendering/CatVisuals';
import { DroneVisuals } from '../rendering/DroneVisuals';
import { ChunkRenderer } from '../rendering/ChunkRenderer';
import { TransitionRenderer } from '../rendering/transitions/TransitionRenderer';
import { areaPanelHtml } from '../ui/AreaPanel';
import { upgradeHighlights } from '../gameplay/UpgradeEffects';
import { GridRenderer } from '../rendering/GridRenderer';
import { InputController } from '../rendering/InputController';
import { MachineVisuals } from '../rendering/MachineVisuals';
import { PALETTE } from '../rendering/Materials';
import { Overlays } from '../rendering/Overlays';
import { SceneBuilder, SLAB_TOP } from '../rendering/SceneBuilder';
import { droneTapRadius, pickDrone, pickLayers } from '../core/Picking';
import { ChainSummary, VfxBudget } from '../ui/ChainSummary';
import { relayLinkId } from '../gameplay/RelaySystem';
import { initLowPoly } from '../rendering/Shapes';
import { TileFx } from '../rendering/TileFx';
import { Tweens } from '../rendering/Tween';
import { Vfx } from '../rendering/Vfx';
import { FlyText } from '../ui/Fly';
import { Hud, superType, type Settings, type Tool } from '../ui/Hud';
import { SuperSystem } from '../gameplay/SuperSystem';
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
  /** Look 6.12: living transitions (every tile change plays as a process). */
  readonly transitions: TransitionRenderer;
  readonly machines: MachineVisuals;
  readonly drones: DroneVisuals;
  readonly cat: CatVisuals;
  readonly butterflies: Butterflies;
  private birds: Birds;
  /** Phase 5 E16: cosmetic fauna (koi, robots, songbirds, sleeping cats, fireflies) and the biodiversity chip. */
  readonly fauna: Fauna;
  private eco!: EcoBadge;
  /**
   * Phase 5 E16: fauna caps tier (TUNING.ecosystem.caps). Hook for the graphics quality-tier selector (Look 1
   * lighting epic); until it sets this, "Fewer particles" means low and everything else high.
   */
  faunaTier?: 'low' | 'medium' | 'high';
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
    this.syncView();
    this.grid = new GridRenderer(this.sim, this.scene.world, this.tweens, this.app.batcher ?? undefined);
    this.chunks = new ChunkRenderer(this.sim, this.scene.world, this.app.graphicsDevice);
    this.transitions = new TransitionRenderer(this.sim);
    this.chunks.transitions = this.transitions;
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
    this.drones = new DroneVisuals(this.sim, this.scene.world, this.tweens, this.app);
    this.drones.onTrail = (p) => this.vfx.trail(p);
    // Drone redesign D05: the restoration beam's travelling motes and ground sparkles (pooled particles).
    this.drones.onBeamMote = (a, b, hex) => this.vfx.mote(a, b, hex);
    this.drones.onBeamSparkle = (at, hex) => this.vfx.burst(at, 2, { up: 0.9, speed: 0.6, size: 0.035, life: 0.6, gravity: 2.5, hex });
    this.drones.sync();
    this.cat = new CatVisuals(this.sim, this.scene.world, this.tweens);
    this.vfx = new Vfx(this.scene.world, this.app.graphicsDevice);
    this.birds = new Birds(this.scene.world);
    this.butterflies = new Butterflies(this.sim, this.scene.world, this.app.batcher!.addGroup('butterflies', true, 400).id);
    this.fauna = new Fauna(this.sim, this.scene.world, this.app.batcher ?? undefined);
    this.tileFx = new TileFx(this.sim, this.scene.world, this.app.graphicsDevice);
    this.machines.onWisp = (_m, at) => this.vfx.burst(at, 1, { up: 0.5, speed: 0.12, size: 0.035, life: 1.3, gravity: 0 }); // Phase 5 E16: running machines only
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
        // Phase 5 E12: "id" (global or cheapest machine), "id|machineId" (that machine) or "id|*" (Upgrade all).
        buyUpgrade: (key) => {
          const [id, target] = key.split('|');
          if (target === '*') this.sim.upgrades.purchaseAll(id);
          else this.sim.upgrades.purchase(id, target || undefined);
        },
        activateCore: () => this.sim.progression.activateCore(),
        newGame: () => this.newGame(),
        setSetting: (k, v) => this.setSetting(k, v),
        activateFrenzy: () => this.sim.frenzy.activate(),
        findCat: () => this.findCat(),
        setVolume: (k, v) => this.setVolume(k, v),
        skipCinematic: () => this.skipCinematic(),
        closeInspect: () => this.select(undefined),
        mergeAt: (id) => {
          const m = this.sim.machine(id);
          if (!m) return;
          const w = this.machines.worldOf(m);
          this.camera.glide(w[0], 0, w[2], Math.max(this.camera.zoom, 1));
          this.selectTool('pulse');
          this.select(id);
          this.startMerge();
        },
        superAction: (action, id) => {
          const s = this.sim.supers;
          if (action === 'stage') s.advance(id);
          else if (action === 'activate') s.activate(id);
          else {
            const m = this.sim.machine(id);
            if (m?.ability) s.setAuto(id, !m.ability.auto);
          }
          this.renderInspect();
        },
        merge: (action) => (action === 'start' ? this.startMerge() : action === 'confirm' ? this.confirmMerge() : this.cancelMerge()),
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
    this.eco = new EcoBadge(this.sim, (h, k, t) => this.hud.toast(h, k, t));
    this.hud.setTool('pulse');
    this.applySettings();

    this.sim.cat.anchorView = (a) => this.anchorView(this.cat.anchorWorld(a));
    for (const c of this.sim.cat.spots()) this.cat.show(c, false);
    // Phase 5 E15: world events act where the player is looking.
    this.sim.events.focus = () => ({ roofId: GROUND, x: this.camera.target.x, z: this.camera.target.z });
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
    this.sfx.frenzy = this.sim.frenzy.active(); // loaded mid-Frenzy
    // Phase 4 E10.1: no blocking welcome card. The first pulse works at once; a short note says what this is.
    if (!state.progression.introSeen && state.stats.tilesRestored === 0) {
      state.progression.introSeen = true;
      setTimeout(() => this.hud.toast('🌱 Welcome to Solarbloom<small>This park is dead and grey. Tap a grey tile to bring it back to life.</small>', 'gold', 5), 600);
    }
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
    this.tileFx.reducedMotion = this.birds.reducedMotion = this.butterflies.reducedMotion = this.grid.reducedMotion = this.machines.reducedMotion = this.drones.reducedMotion = this.cat.reducedMotion = this.camera.reducedMotion = this.fly.reducedMotion = rm;
    if (this.chunks) this.chunks.reducedMotion = rm;
    if (this.transitions) {
      // Look 6: reduced motion keeps the timings with simpler visuals; detail follows the quality tier (Look 1's
      // setting when it lands, the "fewer effects" switch until then).
      this.transitions.reducedMotion = rm;
      const tier = (this as { gfxTier?: 'low' | 'medium' | 'high' }).gfxTier ?? (s.lowVfx ? 'low' : 'high');
      if (this.transitions.tier !== tier) {
        this.transitions.tier = tier;
        this.chunks?.markAll();
      }
    }
    this.vfx.density = rm ? 0.35 : s.lowVfx ? 0.45 : 1;
    this.cat.softSparkle = rm || s.lowVfx;
    this.machines.wispsPerSecond = s.lowVfx ? 2 : 5;
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
      else if (k === 'q') this.sim.frenzy.activate();
      else if (k === 'p') this.setPaused(!this.paused);
      else if (k === 'f3' || k === '`') {
        e.preventDefault();
        this.setSetting('debug', !this.settings.debug);
      } else if (k === 'escape') {
        if (this.mergeSel) this.cancelMerge();
        else if (this.hud.modalOpen) this.hud.openSettings(false);
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

  /** See-through trees: 0..1, eases in while the cursor rests on the world and out when it leaves or pans. */
  private treeFade = 0;
  private updateTreeCursor(dt: number) {
    const c = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    const w = c.clientWidth, h = c.clientHeight;
    const on = this.pointer.inside && !this.cinematic && performance.now() - this.lastPanAt > 120;
    this.treeFade += ((on ? 1 : 0) - this.treeFade) * Math.min(1, dt * (on ? 10 : 6));
    if (this.treeFade < 0.002 || !w || !h) return setTreeCursor(0, 0, 0, 0, w || 1, h || 1);
    const { o, d } = this.camera.ray(this.pointer.x, this.pointer.y);
    // The ground under the cursor (or far away if the ray misses it) as a view depth.
    const t = d.y < -1e-3 ? -o.y / d.y : 400;
    const cam = this.camera.entity;
    const fwd = cam.forward;
    const p = cam.getPosition();
    const depth = (o.x + d.x * t - p.x) * fwd.x + (o.y + d.y * t - p.y) * fwd.y + (o.z + d.z * t - p.z) * fwd.z;
    setTreeCursor((this.pointer.x / w) * 2 - 1, 1 - (this.pointer.y / h) * 2, depth, this.treeFade, w, h);
  }

  /** Haze and shadow reach follow the zoom-dependent camera (its distance changes with the zoom). */
  private syncView() {
    const c = this.camera;
    this.app.scene.fog.start = c.fogDepth(c.dist + c.hazeStart);
    this.app.scene.fog.end = c.fogDepth(c.dist + c.hazeEnd);
    const sun = this.scene.sun.light;
    if (sun) sun.shadowDistance = c.shadowDistance();
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
      // A ray at or above the horizon (the low close-up view) reaches as far as streaming goes.
      const t = d.y < -1e-3 ? -o.y / d.y : 400;
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

  /**
   * Screen-space hit test for drones. Returns the nearest drone's id. Generous over open ground (like the cat),
   * but only about the drone's body when a machine or a placement footprint is under the pointer, so a drone
   * hovering beside a machine never takes the machine's tap (mouse and touch share this path).
   */
  private droneHit(x: number, y: number): string | undefined {
    const pts: { id: string; x: number; y: number }[] = [];
    for (const d of this.sim.state.drones) {
      const p = this.drones.worldPos(d.id);
      if (!p) continue;
      const sp = this.camera.toScreen(p);
      pts.push({ id: d.id, x: sp.x, y: sp.y });
    }
    if (!pts.length) return undefined;
    return pickDrone(pts, x, y, droneTapRadius(this.camera.worldPerPixel(), this.machineOrFootprintAt(x, y)));
  }

  /** A machine (or, with a build tool, a placement footprint) under the pointer: it gets the tap over nearby drones. */
  private machineOrFootprintAt(x: number, y: number): boolean {
    const tool = this.hud.currentTool;
    if (tool !== 'inspect' && tool !== 'pulse') return true;
    const t = this.pick(x, y)?.tile;
    return !!t && !!this.sim.occupant(t);
  }

  /** The cat under the pointer (Phase 5 E15: several can hide at once), by id. */
  private catHit(x: number, y: number): string | undefined {
    // Generous enough to tap, small enough that a tile next to the cat still gets its own click.
    const r = Math.max(20, 0.26 / this.camera.worldPerPixel());
    let best: string | undefined;
    let bestD = r;
    for (const id of this.cat.ids()) {
      const p = this.cat.targetWorld(id);
      if (!p) continue;
      const s = this.camera.toScreen(p);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  }

  /** Phase 5 E15: the 🐾 chip: glide to the longest-hiding hinted cat and say where it is (a hint, not a beacon). */
  private findCat() {
    const s = this.sim;
    const spot = s.cat
      .spots()
      .filter((c) => s.cat.hinted(c))
      .sort((a, b) => a.spawnedAt - b.spawnedAt)[0];
    const a = spot && s.cat.anchor(spot.anchorId);
    if (!spot || !a) return;
    const p = this.cat.anchorWorld(a);
    this.camera.focus(p.x, 0, p.z, Math.max(this.camera.zoom, 0.9), this.settings.reducedMotion ? 0.01 : 1.2);
    this.hud.feed(`🐾 Paw prints lead ${a.hint}…`);
  }

  /** Phase 5 E15 (inspect): a cat hiding within a few tiles leaves a note on the tile tooltip. */
  private pawHint(t: TileData): string {
    const s = this.sim;
    for (const c of s.cat.spots()) {
      const a = s.cat.anchor(c.anchorId);
      if (!a || a.roofId !== t.roofId) continue;
      if (Math.hypot(a.pos[0] - (t.x + 0.5), a.pos[2] - (t.z + 0.5)) <= 4) return '<br><span class="ok">🐾 Faint paw prints… a cat is hiding very close.</span>';
    }
    return '';
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
    const st = superType(tool);
    if (st) {
      // Phase 5 E14: placing a Superstructure Core: footprint ghost, reach, and the whole build's price first.
      const a = this.sim.supers.anchorFor(st, p.fx, p.fz);
      const chk = this.sim.supers.check(st, p.roofId, a.x, a.z);
      const d = TIER3[st]!;
      this.overlays.showGhost(p.roofId, a.x, a.z, d.size, chk.ok, 0.3);
      this.overlays.showRadius(this.sim.grid.tilesNear({ roofId: p.roofId, x: a.x, z: a.z, size: d.size }, 2), chk.ok ? 'ok' : 'info');
      const stages = chk.costs.map((c, i) => `${SuperSystem.stageName(i)} ${formatCost(c)}`).join('<br>');
      this.hud.showTip(
        x,
        y,
        `<b>${d.icon} ${d.name}</b>${d.blurb}. ${d.ability}.<br><small>${stages}<br>Total ${formatCost(this.sim.supers.totalCost(chk.costs))} · prices fixed once placed</small><br>${chk.ok ? '<span class="ok">Click to lay the foundation</span>' : `<span class="bad">${chk.reason}</span>`}`,
      );
      return;
    }
    if (tool !== 'inspect' && tool !== 'pulse') {
      const bt = tool as BuildableType;
      const a = this.sim.build.anchorFor(bt, p.fx, p.fz);
      const chk = this.sim.build.check(bt, p.roofId, a.x, a.z);
      const def = MACHINES[bt];
      this.overlays.showGhost(p.roofId, a.x, a.z, def.size, chk.ok || chk.spotOk, def.size === 2 ? 0.35 : 0.5);
      this.overlays.showRadius(this.radiusTiles({ type: bt, roofId: p.roofId, x: a.x, z: a.z, size: def.size }), chk.ok ? 'ok' : 'info');
      this.hud.showTip(
        x,
        y,
        `<b>${def.icon} ${def.name}</b>${def.blurb}<br>${this.mergeHint(bt, p.roofId, a.x, a.z, def.size)}${chk.ok ? `<span class="ok">Click to build · ${formatCost(chk.cost)}</span>` : `<span class="bad">${chk.reason}</span>`}`,
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
      this.hud.showTip(x, y, `<b>${ct?.icon ?? machineIcon(occ)} ${ct?.name ?? machineName(occ)}</b>${ready ? '<span class="ok">Ready! Click to awaken.</span>' : 'Click to inspect'}${boost}`);
      return;
    }
    if (tool === 'inspect') {
      this.overlays.showFrame(t.roofId, t.x, t.z, 1, 'hover');
      this.hud.showTip(x, y, `<b>${this.tileTitle(t)}</b>${this.tileDetail(t)}${this.pawHint(t)}`);
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
    const catId = this.catHit(x, y);
    if (catId) {
      this.claimingCat = catId;
      this.sim.cat.claim(catId);
      this.claimingCat = undefined;
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
    const st = superType(tool);
    if (st) {
      const a = this.sim.supers.anchorFor(st, p.fx, p.fz);
      const m = this.sim.supers.place(st, p.roofId, a.x, a.z);
      if (m) {
        this.selectTool('pulse');
        this.select(m.id);
      }
      return;
    }
    if (tool !== 'inspect' && tool !== 'pulse') {
      const bt = tool as BuildableType;
      const a = this.sim.build.anchorFor(bt, p.fx, p.fz);
      const m = this.sim.build.place(bt, p.roofId, a.x, a.z);
      if (m) {
        this.selectTool('pulse');
        this.select(m.id);
      }
      return;
    }
    const occ = this.sim.occupant(t);
    if (occ && this.mergeSel) {
      const plan = this.sim.merge.plan(this.mergeSel.anchor, this.mergeSel.partners);
      if (occ.id === this.mergeSel.anchor || (plan && plan.partners.some((p) => p.id === occ.id))) return;
      const ids = plan && this.sim.merge.swap(plan, occ.id);
      if (ids) {
        this.mergeSel = { anchor: this.mergeSel.anchor, partners: ids };
        this.sfx.click();
        this.showMergeHighlights();
        this.renderInspect();
        return;
      }
    }
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
        return g.tilesNear(m, this.sim.upgrades.pollinatorReach(m as MachineData)); // a ghost has no levels: base reach
      case 'droneHub':
        return g.tilesNear(m, this.sim.upgrades.droneRadius(m as MachineData));
      case 'motherTree':
        return g.tilesNear(m, this.sim.upgrades.treeRadius(m as MachineData));
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

  // ───────────── Phase 5 E13: merging ─────────────
  /** The merge being previewed: the anchor (the selected machine) and its two partners. */
  private mergeSel?: { anchor: string; partners: string[] };
  private mergeKeys: string[] = [];

  private startMerge() {
    const plan = this.selected ? this.sim.merge.plan(this.selected) : undefined;
    if (!plan || plan.partners.length < 2) return;
    this.mergeSel = { anchor: plan.anchor.id, partners: plan.partners.map((p) => p.id) };
    this.sfx.click();
    this.showMergeHighlights();
    this.renderInspect();
  }

  private cancelMerge(render = true) {
    if (!this.mergeSel) return;
    this.mergeSel = undefined;
    this.showMergeHighlights();
    if (render) this.renderInspect();
  }

  private confirmMerge() {
    const sel = this.mergeSel;
    if (!sel) return;
    const plan = this.sim.merge.plan(sel.anchor, sel.partners);
    this.cancelMerge(false);
    if (plan?.ok) this.sim.merge.commit(sel.anchor, sel.partners, plan.key, plan.fee);
    this.renderInspect();
  }

  /** Gold: the three that merge (the anchor brighter); pale blue: others you can tap to swap in. */
  private showMergeHighlights() {
    for (const k of this.mergeKeys) this.tileFx.release(k);
    this.mergeKeys = [];
    const sel = this.mergeSel;
    if (!sel) return;
    const plan = this.sim.merge.plan(sel.anchor, sel.partners);
    if (!plan) return;
    const mark = (m: MachineData, tone: string) => {
      for (const t of this.sim.grid.footprint(m.roofId, m.x, m.z, m.size)) {
        if (!t) continue;
        const k = `merge:${t.id}`;
        this.tileFx.hold(k, t, tone);
        this.mergeKeys.push(k);
      }
    };
    for (const o of plan.options) if (!plan.partners.includes(o)) mark(o, '#9fe8ff');
    for (const p of plan.partners) mark(p, '#ffd34d');
    mark(plan.anchor, '#fff1a0');
  }

  /** Phase 5 E13: a build tooltip line when this spot joins machines of the same kind. */
  private mergeHint(type: MachineData['type'], roofId: string, x: number, z: number, size: number): string {
    const n = this.sim.merge.groupIfPlaced(type, roofId, x, z, size);
    const t2 = TIER2[type];
    if (!t2) return '';
    const name = MACHINES[type].name;
    const line =
      n < 2
        ? ''
        : n >= TUNING.merge.count
          ? `<span class="ok">🔀 Completes a merge: ${TUNING.merge.count} ${name}s → ${t2.icon} ${t2.name}</span><br>`
          : `🔀 Touches a ${name}: one more alongside makes a ${t2.icon} ${t2.name}<br>`;
    // Pacing pass: point the way to a superstructure. A tier 2 merged here (tap this one to merge) lands beside the
    // tier 2s it touches; three touching tier 2s merge into a core.
    const t3 = TIER3[type];
    const beside = Math.min(this.sim.merge.tier2Beside(type, roofId, x, z, size), TUNING.merge.count - 1);
    if (!t3 || !beside) return line;
    const yours = beside > 1 ? `${beside} ${t2.name}s` : `${t2.name}`;
    return (
      line +
      (beside + 1 >= TUNING.merge.count
        ? `<span class="ok">✨ Beside your ${yours}: merge ${TUNING.merge.count} ${name}s here (tap this one) and the new ${t2.name} completes a ${t3.icon} ${t3.name} core</span><br>`
        : `✨ Beside your ${yours}: merge ${TUNING.merge.count} ${name}s here (tap this one) and ${TUNING.merge.count} touching ${t2.name}s make a ${t3.icon} ${t3.name} core<br>`)
    );
  }

  /** Phase 5 E14: a superstructure's card: construction stages, then its ability (charge, fire, automatic). */
  private superHtml(m: MachineData): string {
    const s = this.sim;
    const sup = s.supers;
    const d = TIER3[m.type];
    if (!d || (m.tier ?? 1) < 3) return '';
    if (m.project) {
      const st = m.project.stage;
      const steps = [0, 1, 2]
        .map((i) => `<li class="${i < st ? 'done' : i === st ? 'now' : ''}">${i < st ? '✓' : i === st ? '▶' : '○'} ${SuperSystem.stageName(i)}${i >= st ? ` · ${formatCost(sup.nextCost(m) && i === st ? sup.nextCost(m)! : fromCostStrings(m.project!.costs[i]))}` : ''}</li>`)
        .join('');
      const cost = sup.nextCost(m)!;
      const ok = s.econ.canAfford(cost);
      return `<div class="super"><b>🏗️ Building the ${esc(d.name)}</b><ul class="stages">${steps}</ul><p>${esc(d.blurb)}. ${esc(d.ability)}.</p><button class="merge-btn" data-super="stage|${m.id}" ${ok ? '' : 'disabled'}>${st === 2 ? '✨ Activate' : '🔧 Assemble'} · ${formatCost(cost)}</button>${ok ? '' : `<p class="why">Prices were fixed when you placed it: save up, there's no timer.</p>`}</div>`;
    }
    const a = m.ability ?? { charge: 0, used: 0 };
    const th = sup.threshold(m);
    const max = sup.maxCharge(m);
    const why = sup.blocked(m);
    const stored = Math.floor(a.charge / th);
    const sk = sup.kind(m);
    const charging =
      sk === 'megahub'
        ? 'Its own drones’ finished jobs charge it'
        : `Restorations within ${TUNING.super[sk as 'megaflower' | 'nexus' | 'treeOfLife'].reach} tiles and its own production charge it` +
          (sk === 'nexus' || sk === 'treeOfLife' ? `; with everything nearby grown, it pays ${TUNING.super.bountySeconds} s of biomass income instead` : '');
    return (
      `<div class="super"><b>${d.icon} ${esc(d.ability)}</b>` +
      `<div class="bar"><i style="width:${Math.min(100, (a.charge / max) * 100).toFixed(0)}%"></i></div>` +
      `<p>⚡ Charge ${Math.floor(a.charge)}/${max}${max > th ? ` · ${stored} stored` : ''} · ${charging}.${a.used ? ` Fired ${a.used}×.` : ''}</p>` +
      (why && why !== 'Charging' ? `<p class="why">${esc(why)}</p>` : '') +
      `<div class="row"><button class="merge-btn" data-super="activate|${m.id}" ${why ? 'disabled' : ''}>${why === 'Still running' ? '⏳ Running…' : '✨ Fire'}</button>` +
      (a.used ? `<button class="mode${a.auto ? ' on' : ''}" data-super="auto|${m.id}">${a.auto ? '🔁 Auto: on' : 'Auto: off'}</button>` : '') +
      `</div>${a.used ? '' : '<p class="sphint">Fire it once by hand to unlock automatic firing.</p>'}</div>`
    );
  }

  /** The merge section of a machine's inspect panel. */
  private mergeHtml(m: MachineData): string {
    const s = this.sim;
    if (!s.merge.canMerge(m)) return '';
    const sel = this.mergeSel?.anchor === m.id ? this.mergeSel : undefined;
    const plan = s.merge.plan(m.id, sel?.partners);
    if (!plan) return '';
    const t2 = (m.tier ?? 1) >= 2 ? { ...TIER3[m.type]!, blurb: `${TIER3[m.type]!.blurb}; ${TIER3[m.type]!.ability}` } : TIER2[m.type]!;
    if (!sel) {
      if (plan.partners.length < 2) return `<p class="sphint">🔀 Place ${TUNING.merge.count} ${esc(plan.fromName)}s touching edge to edge to merge them into a <b>${esc(plan.toName)}</b>.</p>`;
      return `<button class="merge-btn" data-merge="start">🔀 Merge ${TUNING.merge.count} → ${t2.icon} ${esc(plan.toName)}${plan.core ? ' core' : ''}</button>`;
    }
    const freed = plan.freed.length;
    const lost = plan.lost.map((l) => `<p class="loss">⚠️ ${esc(l.name)}: keeps Lv ${l.kept}, loses Lv ${l.lost.join(' and ')}</p>`).join('');
    const swap = plan.options.length > 2 ? `<p>Tap another highlighted ${esc(plan.fromName)} to swap it in.</p>` : '';
    return (
      `<div class="merge"><b>🔀 ${TUNING.merge.count} × ${esc(plan.fromName)} → ${t2.icon} ${esc(plan.toName)}</b>` +
      `<p class="gain">Output ${plan.before} → ${plan.after} (+${Math.round((plan.after / plan.before - 1) * 100)}%) · ${esc(t2.blurb)}</p>` +
      `<p>💰 ${plan.free ? 'Free: your first ' + esc(plan.fromName) + ' merge' : 'Fee ' + formatCost(plan.fee)} · 🧩 Frees ${freed} tile${freed === 1 ? '' : 's'}</p>` +
      (plan.core ? `<p>✨ All three leave the grid as a Superstructure Core: place it anywhere (${TIER3[m.type]!.size}×${TIER3[m.type]!.size}), then build it in three stages.</p>` : '') +
      lost +
      swap +
      (plan.ok ? '' : `<p class="why">${esc(plan.reason ?? '')}</p>`) +
      `<div class="row"><button data-merge="confirm" ${plan.ok ? '' : 'disabled'}>Merge</button><button data-merge="cancel">Cancel</button></div></div>`
    );
  }

  private select(id: string | undefined) {
    if (this.mergeSel && this.mergeSel.anchor !== id) this.cancelMerge(false);
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

  /** Phase 5 E12: this machine's own upgrade (per-machine levels), plus "all of this type" when there are several. */
  private upgradeButton(id: string, m: MachineData) {
    const def = UPGRADE_BY_ID[id];
    const u = this.sim.upgrades;
    if (def.available && !def.available(this.sim.state)) return '';
    const st = u.status(def, m);
    const lvl = u.levelOf(m, id);
    if (lvl >= def.maxLevel) return `<p class="stat">${def.icon} ${def.name}: MAX</p>`;
    const n = u.targets(def).length;
    const all = u.status(def);
    const allBtn = n > 1 ? `<button class="buy all" data-buy="${id}|*" ${all.ok ? '' : 'disabled'} title="Buys levels cheapest-first on every ${def.machine}">All ${n}</button>` : '';
    return `<div class="card" style="margin-top:8px"><span class="ci">${def.icon}</span><span class="cn">${def.name} <em>Lv ${lvl}</em></span><button class="buy" data-buy="${id}|${m.id}" ${st.ok ? '' : 'disabled'}>${fmt(st.cost)} 🌿</button>${allBtn}<span class="cd2">${def.describe(lvl + 1)}</span></div>`;
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
        extra = `<p class="stat">⚡ ${out.toFixed(1)} energy/s${boosted ? ' · 🌸 bloom boost!' : ''}${s.production.surgeActive() ? ` · 🐱 Solar Surge ×${TUNING.cat.frenzyMult}` : ''}</p><p>Restore tiles right next to it for a 5 s ×2 boost.</p>${this.upgradeButton('solarArray', m)}`;
        break;
      }
      case 'condenser': {
        const near = s.grid.tilesNear(m, TUNING.condenser.radius);
        const mossy = near.filter((t) => t.ground === 'prepared').length;
        const pct = Math.round(((m.charge ?? 0) / TUNING.condenser.threshold) * 100);
        extra = `<p class="stat">💧 +${s.upgrades.waterMult(m)} water/s</p><p class="stat">🌧️ Watering charge ${pct}% · ${mossy} dry tile${mossy === 1 ? '' : 's'} beside it</p><p>When full, it waters the dry soil next to it into bloom and starts a chain. ${mossy ? '' : 'Pulse a neighbour so moss appears beside it.'}</p>${this.upgradeButton('waterBloom', m)}`;
        break;
      }
      case 'pollinator': {
        const zone = s.grid.tilesNear(m, s.upgrades.pollinatorReach(m));
        const mossy = zone.filter((t) => t.ground === 'prepared').length;
        const green = zone.filter((t) => t.ground === 'restored').length;
        extra = `<p class="stat">🌸 Zone radius ${s.upgrades.pollinatorReach(m)} · ${green}/${zone.length} blooming (×${s.upgrades.gardenMult(m)} 🌿)</p><p class="stat">✨ ${mossy} mossy tiles ready to chain</p><p>Restore a tile right next to it: it pollinates another neighbour (up to ${s.upgrades.pollinatorTriggers}× per chain). Line gardens, panels and the Mother Tree up so chains jump between them.</p>${this.upgradeButton('pollinatorReach', m)}`;
        break;
      }
      case 'droneHub': {
        const ds = s.state.drones.filter((d) => d.hubId === m.id);
        const label = { working: 'restoring a tile', travelling: 'flying to a job', napping: 'napping — nothing to do in range', waitingEnergy: 'waiting for energy ⚡' } as const;
        extra = ds
          .map((d, i) => `<p class="stat">🛸 Drone ${i + 1}${d.expiresAt ? ' (party!)' : ''}: ${label[s.drones.statusOf(d)]} · ${d.jobs} jobs</p>`)
          .join('') +
          `<p>Works within ${s.upgrades.droneRadius(m)} tiles (highlighted), paying the normal pulse cost. Blue outlines show current jobs.</p>` +
          ['droneSpeed', 'droneRadius', 'secondDrone', 'droneSweep', 'chainIntel'].map((u) => this.upgradeButton(u, m)).join('');
        break;
      }
      case 'relay': {
        const linked = s.relays.linked(m);
        const ready = linked.filter((o) => s.relays.ready(relayLinkId(m, o))).length;
        extra = `<p class="stat">📡 Linked to ${linked.length} relay${linked.length === 1 ? '' : 's'} within ${s.relays.range(m)} tiles · ${ready} ready</p><p>Each pulse blooms ${s.relays.targets(m)} tiles around this relay when a chain arrives, and can pass it on. Links recharge for ${TUNING.relay.cooldown} s.${linked.length ? '' : ' <b>Build another Bloom Relay within range to link them.</b>'}</p>${this.upgradeButton('relayLens', m)}`;
        break;
      }
      case 'motherTree': {
        const pct = Math.round(((m.charge ?? 0) / TUNING.motherTree.threshold) * 100);
        extra = `<p class="stat">🌳 Charge ${m.charge ?? 0}/${TUNING.motherTree.threshold} (${pct}%)</p><p>Each restoration or new bloom within ${s.upgrades.treeRadius(m)} tiles adds charge. When full, it releases a Bloom Pulse over that whole area. Its own pulse can't recharge it.</p>${this.upgradeButton('treeResonance', m)}`;
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
    extra = this.superHtml(m) + extra + this.mergeHtml(m);
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
  private flyPending = new Map<ResourceKind, { amount: Big; at: number }>();

  private flyGain(kind: ResourceKind, amount: Big, from?: { x: number; y: number }) {
    const now = performance.now();
    const p = this.flyPending.get(kind) ?? { amount: big(0), at: -1e9 };
    p.amount = p.amount.add(amount);
    this.flyPending.set(kind, p);
    if (now - p.at < 120) return; // the next one carries the sum
    p.at = now;
    const total = p.amount;
    p.amount = big(0);
    const src = from ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.fly.spawn(kind, total, src, this.hud.resourceRect(kind), () => this.hud.flashResource(kind, 'flash'));
  }

  private wireEvents() {
    const b = this.bus;
    const s = this.sim;
    for (const ev of ['tile.restoring', 'tile.restored', 'tile.prepared', 'tile.softened', 'tile.nurtured', 'tile.lush', 'tile.knocked', 'tile.transition'] as const) b.on(ev, ({ tile }) => this.chunks.markTile(tile));
    // Phase 5: trees grow into their next stage with a bounce (restored → sapling, then with each bloom stage).
    b.on('tile.restored', ({ tile }) => this.chunks.growTree(tile, 0));
    b.on('tile.nurtured', ({ tile, level }) => this.chunks.growTree(tile, level - 1));
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
    b.on('fauna.unlocked', ({ id }) => this.eco?.arrived(id)); // Phase 5 E16 (cosmetic; pays nothing)
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
        // Look 6.4: the slab fractures under your tap: a short, punchy shake and a burst of grit.
        this.vfx.burst(p, 8, { up: 1.1, speed: 1.6, size: 0.045, life: 0.6, hex: '#b9ad97' });
        if (!this.settings.reducedMotion) this.camera.shake(0.035);
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
      this.vfx.burst(p, manual ? 14 : source === 'drone' ? 9 : source === 'condenser' ? 6 : 9, { up: manual ? 2.6 : source === 'drone' ? 2.2 : 1.8, size: manual ? 0.07 : 0.055 });
      // Drone redesign D05: a drone's restore ends in a small bloom burst (petals above, plus a cyan puff and a
      // leaf-green ring). Visual only: the reward was paid by the sim.
      if (source === 'drone') {
        this.vfx.burst(p, 4, { up: 1.3, speed: 0.8, size: 0.04, life: 0.7, hex: PALETTE.eyeCyan });
        this.vfx.ring(p, PALETTE.leafFin, 1.0, 0.6);
      }
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
      if (amount.lt(0.05)) return;
      let from = tileId ? this.tileScreen(tileId) : undefined;
      if (!from && reason === 'cat') {
        const c = this.cat.targetWorld(this.claimingCat) ?? this.lastCatPos;
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
    b.on('machine.built', ({ machine }) => {
      this.machines.add(machine, true);
      for (const t of s.grid.footprint(machine.roofId, machine.x, machine.z, machine.size)) if (t) this.grid.refresh(t, false);
      const w = this.machines.worldOf(machine);
      const p = new pc.Vec3(w[0], w[1], w[2]);
      this.vfx.ring(p, PALETTE.white, machine.size * 1.1, 0.6);
      this.vfx.burst(p, 16, { up: 3, size: 0.06 });
      this.camera.shake(0.05);
      this.sfx.build();
      if ((machine.tier ?? 1) >= 3) return; // a superstructure's foundation: its own messages (super.stage)
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
    // ───────────── Phase 5 E14: superstructures ─────────────
    b.on('core.created', ({ type, consumed }) => {
      for (const c of consumed)
        for (const t of s.grid.footprint(c.roofId, c.x, c.z, c.size))
          if (t) {
            this.grid.refresh(t, false);
            this.chunks.markTile(t);
          }
      const at = this.machines.worldOf(consumed[0]);
      for (const c of consumed) this.machines.remove(c.id, at);
      const p = new pc.Vec3(at[0], at[1], at[2]);
      this.sfx.powerUp();
      this.tweens.add(0.01, () => {}, {
        delay: 0.45,
        done: () => {
          this.vfx.ring(p, PALETTE.gold, 2.4, 0.9);
          this.vfx.burst(new pc.Vec3(p.x, p.y + 1, p.z), 44, { up: 5, speed: 2.6, size: 0.09, life: 1.4 });
          this.sfx.fanfare();
        },
      });
      const d = TIER3[type]!;
      this.hud.toast(`✨ ${esc(d.name)} Core!<small>Three merged into a Superstructure Core. Place it from the Build menu: ${esc(d.ability)}.</small>`, 'gold', 6);
      if (this.selected && consumed.some((c) => c.id === this.selected)) this.select(undefined);
    });
    b.on('super.stage', ({ machine, stage }) => {
      this.machines.superStage(machine, stage);
      for (const t of s.grid.footprint(machine.roofId, machine.x, machine.z, machine.size)) if (t) this.chunks.markTile(t);
      const d = TIER3[machine.type]!;
      const w = this.machines.worldOf(machine);
      const p = new pc.Vec3(w[0], w[1], w[2]);
      if (stage < 3) {
        this.vfx.ring(p, PALETTE.white, machine.size * 1.2, 0.6);
        this.sfx.build();
        this.hud.toast(`🏗️ ${esc(d.name)}: ${stage === 1 ? 'foundation laid' : 'assembled'}<small>Next: ${SuperSystem.stageName(stage)} · ${formatCost(s.supers.nextCost(machine)!)} (fixed price, no timer)</small>`, undefined, 3.5);
      } else {
        // Built: unfolding machinery, light spreading out in rings, a crescendo. The first one is an event.
        const first = (s.state.stats.supers ?? 0) === 1;
        if (first && !this.settings.reducedMotion) this.camera.glide(w[0], 0, w[2], Math.max(this.camera.zoom, 1.1));
        for (let i = 0; i < 4; i++)
          this.tweens.add(0.01, () => {}, { delay: 0.25 + i * 0.28, done: () => this.vfx.ring(p, i % 2 ? PALETTE.gold : '#ffffff', machine.size * (1.5 + i * 1.3), 1.1) });
        this.tweens.add(0.01, () => {}, { delay: 0.6, done: () => this.vfx.burst(new pc.Vec3(p.x, p.y + 1.5, p.z), 60, { up: 6, speed: 3, size: 0.1, life: 1.6 }) });
        this.sfx.powerUp();
        for (let i = 0; i < 3; i++) this.tweens.add(0.01, () => {}, { delay: 0.3 + i * 0.25, done: () => this.sfx.chainEnd(10 + i * 20) });
        this.tweens.add(0.01, () => {}, { delay: 1.1, done: () => this.sfx.fanfare() });
        this.camera.shake(0.12);
        this.hud.toast(
          `${d.icon} ${esc(d.name)} is alive!<small>${esc(d.blurb)}: ${TUNING.super.outputMult}× a single machine, permanently (three tier 2s were ${3 * TUNING.merge.solarMult}×), and every superstructure enriches all biomass. ${esc(d.ability)}: it charges as you play; fire it from its panel.</small>`,
          'gold',
          first ? 7 : 4.5,
        );
      }
      if (this.selected === machine.id) this.renderInspect();
    });
    b.on('super.ability', ({ machine, tiles, bounty }) => {
      this.machines.superPulse(machine.id);
      const w = this.machines.worldOf(machine);
      const p = new pc.Vec3(w[0], w[1], w[2]);
      const k = s.supers.kind(machine);
      const tone = k === 'megaflower' ? PALETTE.gold : k === 'nexus' ? PALETTE.water : k === 'treeOfLife' ? '#ffe27a' : PALETTE.eyeCyan;
      for (let i = 0; i < 3; i++) this.tweens.add(0.01, () => {}, { delay: i * 0.2, done: () => this.vfx.ring(p, tone, machine.size * (1.4 + i * 1.6), 0.9) });
      this.vfx.burst(new pc.Vec3(p.x, p.y + 1.2, p.z), 30, { up: 4, speed: 2.2, size: 0.08, life: 1.2 });
      this.sfx.powerUp();
      const d = TIER3[machine.type]!;
      const what = k === 'megaflower' ? `every panel ×${TUNING.super.megaflower.mult} for ${TUNING.super.megaflower.seconds} s` : k === 'megahub' ? `${TUNING.super.megahub.drones} swarm drones for ${TUNING.super.megahub.seconds} s` : bounty ? `everything nearby is grown: +${fmt(bounty)} 🌿` : `${tiles.length} tiles bloom`;
      this.hud.feed(`${d.icon} ${d.ability.split(':')[0]}! ${what}`);
      if (this.selected === machine.id) this.renderInspect();
    });
    b.on('machine.merged', ({ machine, consumed, fee, lost }) => {
      for (const c of consumed)
        for (const t of s.grid.footprint(c.roofId, c.x, c.z, c.size))
          if (t) {
            this.grid.refresh(t, false);
            this.chunks.markTile(t);
          }
      const land = this.machines.merged(machine, consumed);
      const w = this.machines.worldOf(machine);
      const p = new pc.Vec3(w[0], w[1], w[2]);
      for (const c of consumed) {
        const cw = this.machines.worldOf(c);
        this.vfx.arc(new pc.Vec3(cw[0], cw[1] + 0.4, cw[2]), new pc.Vec3(p.x, p.y + 0.6, p.z), PALETTE.gold);
      }
      this.sfx.powerUp();
      this.tweens.add(0.01, () => {}, {
        delay: land,
        done: () => {
          this.vfx.ring(p, PALETTE.gold, machine.size * 1.6, 0.8);
          this.vfx.ring(p, '#ffffff', machine.size * 2.4, 1.0);
          this.vfx.burst(new pc.Vec3(p.x, p.y + 0.8, p.z), 36, { up: 4, speed: 2.4, size: 0.08, life: 1.2 });
          this.camera.shake(0.08);
          this.sfx.fanfare();
        },
      });
      const t2 = TIER2[machine.type];
      const first = (s.state.stats.merges?.[machine.type] ?? 0) === 1;
      this.hud.toast(
        `${t2?.icon ?? '✨'} ${esc(machineName(machine))}!<small>${consumed.length + 1} ${esc(MACHINES[machine.type].name)}s → 1 · ${esc(t2?.blurb ?? '')}${fee.biomass ? ` · fee ${formatCost(fee)}` : first ? ' · first merge free' : ''}${lost.length ? ' · some upgrade levels merged away' : ''}</small>`,
        'gold',
        4,
      );
      if (this.selected === machine.id) this.renderInspect();
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
      for (let i = 0; i < 3; i++) this.tweens.add(0.01, () => {}, { delay: i * 0.18, done: () => this.vfx.ring(p, i % 2 ? PALETTE.gold : '#7cf7c8', (s.upgrades.treeRadius(m) + 1.2) * (0.6 + i * 0.25), 0.9) });
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
      this.hud.combo(combo, `+${fmt(total)}🌿${energy.gte(1) ? ` +${fmt(energy)}⚡` : ''} earned${ms}`);
      this.hud.feed(`🌸 Bloom chain ×${combo}${bonus.gte(1) ? ` · +${fmt(bonus)}🌿 bonus` : ''}`);
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
    b.on('frenzy.ready', () => {
      this.hud.feed('✨ Bloom Frenzy is ready: fire it whenever you like (Q)');
      this.sfx.powerUp();
    });
    b.on('frenzy.started', ({ seconds }) => {
      document.body.classList.add('frenzy');
      this.sfx.frenzy = true;
      this.hud.toast(`✨ BLOOM FRENZY! ${seconds}s<small>Pulse reach +${TUNING.frenzy.pulseTierBonus} tiers · biomass ×${TUNING.frenzy.biomassMult} · drones ×${TUNING.frenzy.droneSpeedMult}</small>`, 'gold', 3);
      this.sfx.fanfare();
      const g = this.camera.goalPoint;
      const c = new pc.Vec3(g.x, g.y, g.z);
      for (let i = 0; i < 3; i++) this.tweens.add(0.01, () => {}, { delay: i * 0.18, done: () => this.vfx.ring(c, i % 2 ? '#c8ff8a' : PALETTE.gold, 3 + i * 1.5, 0.8) });
    });
    b.on('frenzy.ended', () => {
      document.body.classList.remove('frenzy');
      this.sfx.frenzy = false;
      this.hud.feed('🌿 Bloom Frenzy is over: back to normal power');
    });
    b.on('area.step', ({ areaId, step, share, credited }) => {
      const a = s.areas.info(areaId);
      const got = (['biomass', 'energy', 'water'] as const).filter((k) => credited[k]?.gte(1)).map((k) => `+${fmt(credited[k]!)}${RES_ICON[k]}`).join(' ');
      this.hud.toast(`🌱 ${a.landmarkName}: ${Math.round(share * 100)}% of the way<small>${got}${step < TUNING.areaSteps.at.length ? '' : ' · the landmark is close'}</small>`, 'gold', 2.4);
      this.sfx.powerUp();
      this.hud.flashResource('biomass', 'flash');
    });
    b.on('milestone.reached', ({ at, credited, next }) => {
      const icons = { energy: '⚡', water: '💧', biomass: '🌿' } as const;
      const got = (Object.entries(credited) as [keyof typeof icons, Big][]).filter(([, v]) => v.gte(1)).map(([k, v]) => `+${fmt(v)}${icons[k]}`).join(' ');
      this.hud.toast(`🌱 ${at} tiles restored!<small>${got || 'Storage was full'}${next ? ` · next reward at ${next}` : ''}</small>`, 'gold', 2.6);
      this.sfx.powerUp();
      this.hud.flashResource('biomass', 'flash');
    });
    b.on('upgrade.purchased', ({ id, level, bulk, machineId }) => {
      if (id === 'droneSpeed') this.drones.restyle();
      this.machines.refreshUpgrades();
      if (bulk) return; // "Upgrade all" celebrates once, at the end (upgrade.bulk)
      const def = UPGRADE_BY_ID[id];
      this.celebrateUpgrade(id, `${def.icon} ${def.name} · level ${level}<small>${def.describe(level)}</small>`, machineId);
    });
    b.on('upgrade.bulk', ({ id, count }) => {
      const def = UPGRADE_BY_ID[id];
      this.celebrateUpgrade(id, `${def.icon} ${def.name} ×${count}<small>${count} level${count === 1 ? '' : 's'} bought across your ${def.machine ? MACHINES[def.machine].name : ''}s, cheapest first</small>`);
    });
    b.on('drone.spawned', ({ droneId }) => {
      const d = s.state.drones.find((x) => x.id === droneId);
      if (d) this.drones.add(d, true);
    });
    b.on('drone.despawned', ({ droneId }) => this.drones.remove(droneId));
    b.on('drone.jobStarted', () => this.sfx.drone());
    b.on('cat.spawned', ({ catId }) => {
      const spot = catId ? this.sim.cat.find(catId) : this.sim.state.cat.active;
      if (spot) this.cat.show(spot, true);
      this.meowTimer = 20;
      this.save();
    });
    b.on('cat.found', ({ reward, summary, extras, catId, variant }) => {
      const id = catId ?? this.cat.ids()[0];
      const p = id ? this.cat.targetWorld(id) : undefined;
      const rare = variant === 'golden' || variant === 'rainbow';
      if (p) {
        this.lastCatPos = p.clone();
        const soft = this.cat.softSparkle;
        this.vfx.burst(p, soft ? 12 : rare ? 60 : 40, { up: soft ? 2 : 4, speed: soft ? 1 : 2, size: soft ? 0.05 : 0.07, life: soft ? 1 : 1.4 });
        this.vfx.ring(p, PALETTE.gold, soft ? 0.9 : 1.6, 0.8);
        if (variant === 'rainbow') this.vfx.ring(p, PALETTE.pink, soft ? 1.1 : 2.2, 1);
      }
      if (id) this.cat.hide(id, true);
      this.hud.hideTip();
      this.sfx.meow();
      setTimeout(() => this.sfx.fanfare(), 250);
      // Rarer cats are named in words (and shaped differently), never told apart by colour alone.
      const label = variant === 'rainbow' ? '🌈 RAINBOW CAT FOUND!' : variant === 'golden' ? '👑 GOLDEN CAT FOUND!' : '🐱 LUCKY CAT FOUND!';
      this.hud.toast(label, 'cat', 2.4);
      const kind = variant === 'rainbow' ? 'Rainbow Cat: ' : variant === 'golden' ? 'Golden Cat: ' : '';
      this.hud.catReward(`${kind}${CAT_REWARD_NAMES[reward]}${extras ? ` + ${extras} saved-up harvest${extras > 1 ? 's' : ''}` : ''}`, summary);
      this.save();
    });
    b.on('cat.moved', ({ catId }) => {
      const spot = catId ? this.sim.cat.find(catId) : this.sim.state.cat.active;
      if (spot) this.cat.show(spot, true);
      this.save();
    });
    // Phase 5 E15: world events. A small banner (HUD) carries the effect and timer; these are the extras.
    b.on('world.started', ({ type, fallback }) => {
      const info = WORLD_EVENT_INFO[type];
      this.hud.feed(`${info.icon} ${info.name}${type === 'invasion' ? '' : `: ${info.effect}`}`);
      if (fallback) this.hud.feed(fallback);
      this.sfx.chainEnd(type === 'supernova' ? 8 : 5);
      if (type === 'invasion') this.sfx.meow(true);
      this.save();
    });
    b.on('world.wave', ({ tiles, fallback }) => {
      if (fallback) this.hud.feed(`🌧️ ${fallback}`);
      const t = tiles[0] ? this.sim.grid.byTileId(tiles[0]) : undefined;
      if (t) {
        const [x, y, z] = this.sim.grid.tileWorld(t);
        this.vfx.ring(new pc.Vec3(x, y + 0.1, z), PALETTE.water, this.cat.softSparkle ? 1.2 : 2.4, 0.9);
      }
    });
    b.on('world.tile', ({ type, tileId }) => {
      const t = this.sim.grid.byTileId(tileId);
      if (!t || this.cat.softSparkle) return;
      const [x, y, z] = this.sim.grid.tileWorld(t);
      const p = new pc.Vec3(x, y + 0.15, z);
      if (type === 'rain') this.vfx.ring(p, PALETTE.water, 0.6, 0.5);
      else this.vfx.burst(p, 6, { up: 1.6, speed: 0.6, size: 0.05, life: 1.1 });
    });
    b.on('world.ended', ({ type, done, fallback }) => {
      const info = WORLD_EVENT_INFO[type];
      // Only real progress is celebrated: a fallback already said what it paid instead.
      if (done > 0 && type !== 'invasion') this.hud.feed(`${info.icon} ${info.name}: ${type === 'migration' ? `${done} tiles grew` : `${done} tiles watered`}`);
      else if (type === 'supernova') this.hud.feed(`${info.icon} ${info.name} fades`);
      void fallback;
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
      const p = this.cat.targetWorld(this.sim.state.cat.active?.id);
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

  /** A purchase's moment: toast, coin, and sparkles where it changed the world (one machine, or all it affects). */
  private celebrateUpgrade(id: string, text: string, machineId?: string) {
    const s = this.sim;
    this.hud.toast(text, 'gold', 2.6);
    this.sfx.coin();
    const one = machineId ? s.machine(machineId) : undefined;
    const spots = (one ? [{ roofId: one.roofId, x: one.x + one.size / 2, z: one.z + one.size / 2 }] : upgradeHighlights(s, id))
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
  }

  private lastCatPos?: pc.Vec3;
  /** Phase 5 E15: the cat being claimed right now (its rewards fly from it). */
  private claimingCat?: string;
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
      this.hud.toast('🌫️ The fog rolls back!<small>The park now grows +25% biomass, and the fountain filled your ✨ Bloom Frenzy: fire it at the fog’s edge. Restore the areas around it and wake their landmarks.</small>', 'gold', 7);
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
  private runDistrictBloom(id: string, changed: number, reward: Partial<Record<'energy' | 'water' | 'biomass', Big>>, replay: boolean) {
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
    this.transitions.sync(this.sim.time + Math.min(this.acc, TUNING.simStep));
    if (rect) this.chunks.update(dt, rect, this.camera.target, this.camera.zoom);
    this.machines.update(dt, rect);
    this.drones.update(this.paused || this.hiddenPause ? 0 : dt); // drone personality freezes with the game
    this.cat.update(dt);
    // Phase 5 E16: fauna by unlock, capped per quality tier ("Fewer particles" = low).
    const eco = this.sim.ecosystem;
    const quality = this.faunaTier ?? (this.settings.lowVfx ? 'low' : 'high');
    this.butterflies.enabled = eco.has('butterflies');
    this.butterflies.cap = TUNING.ecosystem.caps[quality].butterflies;
    // Fauna live around where the camera looks (the ground rect of a low perspective view reaches far beyond it).
    const ct = this.camera.target;
    const near = rect ? { x0: ct.x - 12, x1: ct.x + 12, z0: ct.z - 12, z1: ct.z + 12 } : undefined;
    this.butterflies.update(dt, near);
    this.birds.resident = eco.has('birds');
    this.birds.update(dt, this.camera.goalPoint, this.sim.progression.parkStage() >= 2 || this.birds.resident);
    this.fauna.update(dt, near, { quality, reducedMotion: this.settings.reducedMotion, fireflies: !!this.settings.fireflies && !this.settings.highContrast });
    this.eco?.update(dt);
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
    this.syncView();
    this.updateTreeCursor(dt);
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
    if (this.sim.cat.spots().length && !this.paused) {
      // Phase 5 E15: paw prints appear beside a cat that has been hiding a while.
      for (const c of this.sim.cat.spots()) this.cat.setHint(c.id, this.sim.cat.hinted(c));
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
            `fauna ${Object.entries(this.fauna.active).map(([k, n]) => `${k[0]}${n}`).join(' ')} b${this.butterflies.count}  bio ${this.sim.ecosystem.score().score}\n` +
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
  const got = (['energy', 'water', 'biomass'] as const).filter((k) => r.credited[k].gte(1)).map((k) => `+${fmt(r.credited[k])}${icons[k]}`);
  const lost = (['energy', 'water', 'biomass'] as const).filter((k) => r.lost[k].gte(1)).map((k) => `${fmt(r.lost[k])}${icons[k]}`);
  const lines = [`🌙 ${title} (${away})`];
  const capped = r.away > r.seconds + 1 ? ` · counted up to ${Math.round(r.seconds / 3600)} h` : '';
  lines.push(`<small>Your garden kept growing at half pace${capped}: ${got.join(' ') || 'nothing new'}${r.droneJobs ? ` · drones restored ${r.restored} and nurtured ${r.grown} tiles` : ''}${lost.length ? ` · ${lost.join(' ')} didn't fit in storage` : ''}</small>`);
  return lines.join('');
}

/** A superstructure's locked stage price (saved as strings) as a cost. */
function fromCostStrings(c: Partial<Record<ResourceKind, string>>): import('../core/types').Cost {
  const o: import('../core/types').Cost = {};
  for (const k of ['energy', 'water', 'biomass'] as const) if (c[k] !== undefined) o[k] = big(c[k]);
  return o;
}
