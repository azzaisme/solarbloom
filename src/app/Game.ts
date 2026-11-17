import { big, fmt, type Big } from '../core/Big';
import { HOME } from '../gameplay/ProgressionSystem';
import * as pc from 'playcanvas';
import { BIRD_VOICES, Sfx } from '../audio/Sfx';
import { treeSpot, treeStage } from '../rendering/TreePlacement';
import { formatCost, formatPriceHtml, RES_ICON } from '../core/Economy';
import { PARK } from '../core/Areas';
import { createInitialState, GROUND } from '../core/GameState';
import { AREA_TYPES } from '../data/city';
import { distToFootprint } from '../core/Grid';
import type { BuildableType, DroneRole, LayerData, MachineData, ResourceKind, TileData } from '../core/types';
import { BUILDABLE, MACHINES, TIER2, TIER3, machineIcon, machineName } from '../data/machines';
import { TUNING } from '../data/tuning';
import { UPGRADE_BY_ID } from '../data/upgrades';
import type { ChainEvent } from '../gameplay/BloomChainSystem';
import { CAT_REWARD_NAMES } from '../gameplay/LuckyCatSystem';
import { WORLD_EVENT_INFO } from '../gameplay/WorldEventSystem';
import type { OfflineReport } from '../gameplay/OfflineSystem';
import { Sim } from '../gameplay/Sim';
import { Butterflies } from '../rendering/Butterflies';
import { Birds } from '../rendering/Birds';
import { Clouds } from '../rendering/Clouds';
import { Fauna } from '../rendering/Fauna';
import { EcoBadge } from '../ui/EcoBadge';
import { createModels } from '../rendering/Models';
import { CameraController, ORBIT, PLAY_TILT } from '../rendering/CameraController';
import { setLeafTier, setTreeCursor } from '../rendering/Foliage';
import { detailTextures } from '../rendering/DetailTex';
import { Pollinators } from '../rendering/Pollinators';
import { CatVisuals } from '../rendering/CatVisuals';
import { DroneVisuals } from '../rendering/DroneVisuals';
import { ChunkRenderer, MeshBuilder, SINK } from '../rendering/ChunkRenderer';
import { MACHINE_MODELS } from '../rendering/MachineVisuals';
import type { HoloShape } from '../rendering/Hologram';
import { TransitionRenderer } from '../rendering/transitions/TransitionRenderer';
import { CultivatorVisuals } from '../rendering/CultivatorVisuals';
import { ProgressRings } from '../rendering/transitions/ProgressRings';
import { areaPanelHtml } from '../ui/AreaPanel';
import { upgradeHighlights } from '../gameplay/UpgradeEffects';
import { GridRenderer } from '../rendering/GridRenderer';
import { InputController } from '../rendering/InputController';
import { MachineVisuals } from '../rendering/MachineVisuals';
import { PALETTE } from '../rendering/Materials';
import { Overlays } from '../rendering/Overlays';
import { SceneBuilder, SLAB_TOP } from '../rendering/SceneBuilder';
import { Sky } from '../rendering/Sky';
import { Skyline } from '../rendering/Skyline';
import { CLOSE_VIEW_REACH, HAZE } from '../data/sky';
import { droneTapRadius, pickDrone, pickLayers } from '../core/Picking';
import { ChainSummary, VfxBudget } from '../ui/ChainSummary';
import { relayLinkId } from '../gameplay/RelaySystem';
import { initLowPoly } from '../rendering/Shapes';
import { LookController } from '../rendering/LookController';
import { DECK, detectTier, lowerTier, onSteamDeck, urlDeck, urlTier, type GfxSetting } from '../rendering/Quality';
import type { GfxTier } from '../data/look';
import { TileFx } from '../rendering/TileFx';
import { Tweens } from '../rendering/Tween';
import { Vfx } from '../rendering/Vfx';
import { FlyText } from '../ui/Fly';
import { decorType, Hud, machineTool, superType, type Settings, type Tool } from '../ui/Hud';
import { BOT } from '../gameplay/Walker';
import { SuperSystem } from '../gameplay/SuperSystem';
import { ROLE_INFO, ROLES } from '../gameplay/DroneRoles';
import type { MergePlan } from '../gameplay/MergeSystem';
import { EventBus } from './EventBus';
import { BotController } from './BotController';
import { type Action, Bindings, BUILD_DIGITS, keyLabel, padLabel } from './Bindings';
import { BloombotVisuals } from '../rendering/BloombotVisuals';
import { Minimap } from '../ui/Minimap';
import { PadFocus } from '../ui/PadFocus';
import { Cozy } from '../gameplay/Cozy';
import { DECOR_GEN, DECOR_OPTION, DECOR_OPTIONS, PLOT_OPTIONS } from '../data/cozy';
import { chunkKey } from '../core/Grid';
import type { Decoration } from '../core/Decor';
import type { PlotSpot } from '../core/Plots';
import { type LoadResult, SaveService } from './SaveService';
import { calmHud, parseSettings, potterPace, SETTINGS_KEY } from './Settings';
import { padStick, PHOTO_TILT, PhotoMode } from './PhotoMode';
import { PhotoBar, saveCanvasPng } from '../ui/PhotoBar';
import { LOOK } from '../data/look';

const BLOOM_NAMES = ['', 'Fresh grass', 'Wildflowers', 'Thriving (full bloom)', 'Radiant'];
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Bloombot: the camera zoom of the close default view (G.3), and how near counts as "within reach". */
const BOT_ZOOM = 3.2;
/**
 * E19.2 (#245, "Building and placing"): build mode is Satisfactory-style. With something to build in hand (a
 * machine, a core, a decoration) the camera stays in the close view; a hologram sits where you aim, snapped to the
 * grid, within DECOR_GEN.reach tiles of bloombot, red where it can't go. The mouse aims while it is over the world
 * and was moved in the last MOUSE_AIM_MS; otherwise (pad, keys) the aim is the tile in front of bloombot.
 */
const MOUSE_AIM_MS = 8000;
/** the shortest time between two quarter turns from the mouse wheel (a trackpad sends many small wheel events) */
const WHEEL_TURN_MS = 140;
/** Bloombot: how far in the camera may come (the cursor view stops at 1.9). */
const BOT_MAX_ZOOM = 4.2;
const BOT_REACH = 1.6;
/** Bloombot is the game; `?cursor=1` keeps the old click-to-act play for tests that drive tiles directly. */
const botMode = () => typeof location === 'undefined' || new URLSearchParams(location.search).get('cursor') !== '1';
type ActResult = 'pulse' | 'build' | 'select' | 'wake' | 'none';

interface Pick {
  roofId: string;
  fx: number;
  fz: number;
  tile?: TileData;
}

function loadSettings(): Settings {
  const rm = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY), rm);
  } catch {
    return parseSettings(null, rm);
  }
}

/** Glue between the headless Sim, PlayCanvas rendering, DOM HUD, input, audio and persistence. */
/** E19.1: the message when a build would cover a chosen plot. */
const PLOT_IN_WAY = 'A plot is here: clear it first (it’s free)';
/** E19.2: a build aimed beyond bloombot's reach */
const TOO_FAR = 'Too far: walk closer';

export class Game {
  readonly app: pc.Application;
  readonly bus = new EventBus();
  readonly saver = new SaveService();
  readonly sim: Sim;
  readonly tweens = new Tweens();
  readonly scene: SceneBuilder;
  /** Look 1: lighting, post-processing and graphics quality. */
  readonly look: LookController;
  readonly camera: CameraController;
  private sky!: Sky;
  private skyline!: Skyline;
  readonly grid: GridRenderer;
  /** The city ground (streamed chunk meshes + fog). */
  readonly chunks: ChunkRenderer;
  /** Look 6.12: living transitions (every tile change plays as a process). */
  readonly transitions: TransitionRenderer;
  /** Look 6.9: Cultivator tillers. */
  readonly tillers: CultivatorVisuals;
  /** Look 6.10: progress rings on tiles mid-process (near zoom). */
  readonly rings: ProgressRings;
  private stageSoundAt = 0;
  readonly machines: MachineVisuals;
  readonly drones: DroneVisuals;
  readonly cat: CatVisuals;
  readonly butterflies: Butterflies;
  /** Look 3.16: bees, hoverflies, drifting leaves and falling blossom */
  readonly pollinators: Pollinators;
  private birds: Birds;
  /** Puffy clouds between the camera and the city when zoomed out. */
  private clouds: Clouds;
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
  /** when the pointer last moved over the world (bloombot's front-tile preview yields to the mouse for a moment) */
  private pointerAt = -1e9;
  /** Bloombot (#234): the player character. Off with `?cursor=1` (e2e tests that click tiles directly). */
  readonly bot?: BotController;
  /** true while the front-tile preview (not the pointer) is drawing the hover tooltip */
  private previewFromBot = false;
  private botPreviewAt = 0;
  private botPreviewKey = '';
  private keyMapShown: 'keys' | 'pad' = 'keys';
  /** Bloombot (G.16): the controls map, rebindable in Settings */
  readonly bindings = new Bindings();
  /** Bloombot (G.14): the round map at the bottom left */
  private minimap?: Minimap;
  /** E19.4.1 (#260): photo mode and its controls bar */
  private photo!: PhotoMode;
  private photoBar!: PhotoBar;
  /** E19 (#245): plot choices and unlocks (cosmetic; never read by the sim) */
  private cozy!: Cozy;
  /** E19.1.2: the plot the picker is open for, and the option it's previewing there */
  private pickerPlot?: PlotSpot;
  private plotPreview?: { id: string; option: string };
  private cozyCheckAt = 0;
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
    // Look 4.7: the sky behind everything (its own layer, drawn first).
    this.sky = new Sky(this.app, this.scene.sun);
    this.camera.cam.layers = [this.sky.layer.id, this.sky.clearLayer.id, ...this.camera.cam.layers];
    // Look 4.8: the distant terraced city behind the play area (in the sky's layer, drawn before the world).
    this.skyline = new Skyline(this.app, this.sky.layer, this.scene.sun.up);
    this.look = new LookController(this.app, this.scene, this.camera);
    this.look.atmosphere.isLit = (x, z) => this.sim.grid.get(GROUND, x, z)?.ground === 'restored';
    this.syncView();
    this.grid = new GridRenderer(this.sim, this.scene.world, this.tweens, this.app.batcher ?? undefined);
    this.chunks = new ChunkRenderer(this.sim, this.scene.world, this.app.graphicsDevice);
    this.transitions = new TransitionRenderer(this.sim);
    this.chunks.transitions = this.transitions;
    this.cozy = new Cozy(this.sim);
    this.chunks.plots = { look: (p) => this.plotLook(p) };
    this.chunks.decor = { inChunk: (cx, cz) => this.decorInChunk(cx, cz) }; // E19.2
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
    this.grid.streaming = this.city; // City 07 (#8): rooftop clusters stream with the view
    this.grid.build();
    this.machines = new MachineVisuals(this.sim, this.scene.world, this.tweens, this.app.batcher ?? undefined);
    // City 07 (#8): in the city, machine models stream with the view; a landmark streaming in takes its area's state.
    this.machines.streaming = this.city;
    this.machines.landmarkState = (m) => {
      const s = this.sim;
      const id = s.areas.areaOf({ roofId: m.roofId, x: m.x, z: m.z });
      if (!id || id === PARK) return s.state.progression.coreActivated ? 'awake' : s.progression.coreReady() ? 'ready' : 'dormant';
      if (s.areas.fog(id) === 'cleared') return 'awake';
      return s.areas.ready(id) ? 'ready' : 'dormant';
    };
    this.machines.buildAll();
    this.drones = new DroneVisuals(this.sim, this.scene.world, this.tweens, this.app);
    this.drones.onTrail = (p) => this.vfx.trail(p);
    // Drone redesign D05: the restoration beam's travelling motes and ground sparkles (pooled particles).
    this.drones.onBeamMote = (a, b, hex) => this.vfx.mote(a, b, hex);
    this.drones.onBeamSparkle = (at, hex) => this.vfx.burst(at, 2, { up: 0.9, speed: 0.6, size: 0.035, life: 0.6, gravity: 2.5, hex });
    this.drones.sync();
    this.cat = new CatVisuals(this.sim, this.scene.world, this.tweens);
    this.vfx = new Vfx(this.scene.world, this.app.graphicsDevice);
    this.tillers = new CultivatorVisuals(this.sim, this.scene.world, this.vfx);
    this.rings = new ProgressRings(this.sim, this.scene.world);
    // Look 3.19: the hand-built models load in the background; until then (or with ?models=classic) everything keeps
    // its procedural look. Once they're in, what was already drawn is rebuilt with them.
    const models = createModels(this.app);
    models.onReady = () => {
      this.chunks.markAll();
      this.skyline.useModels(models);
      this.machines.rebuildAll();
      this.tillers.rebuildAll();
      this.cat.rebuildAll();
    };
    this.birds = new Birds(this.scene.world);
    this.clouds = new Clouds(this.scene.world, this.app.graphicsDevice, this.scene.sun.up);
    this.butterflies = new Butterflies(this.sim, this.scene.world, this.app.batcher!.addGroup('butterflies', true, 400).id);
    this.pollinators = new Pollinators(this.sim, this.scene.world, this.app.batcher!.addGroup('pollinators', true, 400).id);
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
        chooseRole: (key) => {
          const [hubId, role, slot, index] = key.split('|');
          if (slot === 'drone') this.sim.roles.chooseForDrone(hubId, Number(index), role === '-' ? undefined : (role as DroneRole));
          else this.sim.roles.choose(hubId, role as DroneRole, Number(slot) || 1);
          this.renderInspect();
        },
        buyUpgrade: (key) => {
          const [id, target] = key.split('|');
          if (target === '*') this.sim.upgrades.purchaseAll(id);
          else this.sim.upgrades.purchase(id, target || undefined);
        },
        activateCore: () => {
          // Bloombot (G.17): bloombot walks to the fountain and wakes it there.
          const f = this.bot && this.sim.state.machines.find((m) => m.type === 'core' && this.sim.areas.areaOf(m) === PARK);
          if (f) this.botWake(f);
          else this.sim.progression.activateCore();
        },
        newGame: () => this.newGame(),
        photoMode: () => this.photo.enter(),
        setSetting: (k, v) => this.setSetting(k, v),
        activateFrenzy: () => this.sim.frenzy.activate(),
        findCat: () => this.findCat(),
        keyFor: (a) => this.hudKey(a),
        goHome: (attention) => (attention ? this.focusNextArea() : this.focusArea(PARK)),
        setVolume: (k, v) => this.setVolume(k, v),
        setGraphics: (v) => this.setGraphics(v),
        skipCinematic: () => this.skipCinematic(),
        closeInspect: () => this.select(undefined),
        inspectAt: (id) => {
          const m = this.sim.machine(id);
          if (!m) return;
          const w = this.machines.worldOf(m);
          this.camera.glide(w[0], 0, w[2], Math.max(this.camera.zoom, 1));
          this.selectTool('inspect');
          this.select(id);
        },
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
          if (!m || !this.landmarkReady(m)) return;
          if (this.bot) this.botWake(m);
          else this.wakeLandmark(m);
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
    if (botMode()) {
      const visuals = new BloombotVisuals(this.app, this.scene.world);
      visuals.reducedMotion = !!this.settings.reducedMotion;
      Object.assign(this, { bindings: new Bindings({ keys: this.settings.keys, pad: this.settings.pad }) });
      const bot = new BotController(this.sim, this.camera, visuals, this.bindings);
      this.bot = bot;
      this.overlays.holo.eye = (out) => visuals.eyeWorld(out);
      this.overlays.holo.sink = () => new MeshBuilder();
      bot.walker.solid = (r, x, z) => this.cozy.solidAt(r, x, z); // E19: solid plot options block like machines (a decoration blocks through its tile)
      bot.frozen = () => this.cinematic || this.paused || this.hud.modalOpen || visuals.busy === 'assemble' || !!this.photo?.active;
      bot.onZoom = (f) => this.photo?.active && this.photo.zoom(f); // the right stick zooms only in photo mode
      bot.onPad = (a) => this.doAction(a);
      bot.onButton = (i) => this.padListener?.(i);
      const focus = new PadFocus(this.hud.root);
      bot.padCapture = (i) => !this.padListener && focus.button(i);
      // The right stick turns the view (sideways) and tilts it (up and down): a 3D orbit around bloombot. Zoom
      // belongs to photo mode (above), where up and down zoom instead.
      bot.onTurn = (deg) => this.camera.orbit(deg);
      bot.onTilt = (deg) => !this.photo?.active && this.camera.tilt(deg);
      this.hud.setKeyMap('keys', this.bindings);
      // G.17: phones and tablets are not supported for now (bloombot needs keys or a gamepad). A Steam Deck has its
      // gamepad built in, and Gaming Mode often shows no mouse at all, so it never gets this note.
      const touchOnly = !this.deck && typeof matchMedia !== 'undefined' && !matchMedia('(any-pointer: fine)').matches && navigator.maxTouchPoints > 0;
      if (touchOnly) setTimeout(() => this.hud.toast('Solarbloom needs a keyboard or a gamepad for now<small>Phones and tablets will be supported again later. Connect a controller to play.</small>', 'gold', 12), 900);
      this.hud.renderControls(this.bindings, (kind, done) => this.listenForBinding(kind, done), () => this.saveBindings());
      this.minimap = new Minimap(this.sim, this.hud.root, (id) => {
        const m = this.sim.state.machines.find((q) => q.id === id);
        return !!m && this.landmarkReady(m);
      });
      const [bx, , bz] = bot.world();
      this.camera.maxZoom = BOT_MAX_ZOOM;
      this.camera.target.set(bx, 0, bz);
      this.camera.glide(bx, 0, bz, BOT_ZOOM);
    }
    this.createPhotoMode();
    new InputController(canvas, {
      hover: (x, y) => this.onHover(x, y),
      leave: () => this.onLeave(),
      click: (x, y, b) => this.onClick(x, y, b),
      pan: (dx, dy, x, y) => {
        if (this.bot && !this.photo?.active) {
          // Bloombot in play: the camera follows bloombot and never pans. Any drag turns and tilts the view
          // around it instead (grab the world: drag right turns the view left, drag down raises the camera).
          if (!this.cinematic) {
            this.camera.orbit(-dx * ORBIT.yawPerPx);
            this.camera.tilt(dy * ORBIT.tiltPerPx);
          }
          return;
        }
        this.lastPanAt = performance.now();
        this.camera.pan(dx, dy, x, y);
      },
      // Bloombot: a right-button drag turns and tilts the view around bloombot (photo mode's drag pans, and its
      // right-button drag does this within photo mode's own tilt range).
      orbit: (dx, dy) => {
        if (!this.bot || this.cinematic) return false;
        this.camera.orbit(-dx * ORBIT.yawPerPx);
        this.camera.tilt(dy * ORBIT.tiltPerPx, this.photo?.active ? PHOTO_TILT : PLAY_TILT);
        return true;
      },
      // Bloombot: the camera's distance is fixed; the wheel turns what you're building (E19.2).
      zoom: (f, x, y) => (this.photo?.active ? this.photo.zoom(f) : this.bot ? this.wheelTurn(f) : this.camera.zoomBy(f, x, y)),
      // A quick, strong pinch-out snaps to the city overview (one gesture from anywhere).
      pinchEnd: (f, ms) => {
        if (!this.bot && this.city && !this.cinematic && f < 0.6 && ms < 450) this.camera.glide(this.camera.target.x, 0, this.camera.target.z, this.camera.minZoom);
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
      const how = `Walk with ${this.hudKey('up')}${this.hudKey('left')}${this.hudKey('down')}${this.hudKey('right')} and press ${this.hudKey('pulse')} to pulse the grey tile in front of you.`;
      setTimeout(() => this.hud.toast(`🌱 Welcome to Solarbloom<small>This park is dead and grey. ${how}</small>`, 'gold', 6), 600);
    }
    else if (offline) {
      this.saveNow();
      setTimeout(() => this.hud.toast(offlineToast(offline, 'Welcome back!'), 'gold', 6), 400);
    } else if (loaded) setTimeout(() => this.hud.toast('Welcome back! Your garden kept its shape. 🌱', '', 2.6), 400);
  }

  // ───────────────────────── settings / persistence ─────────────────────────

  /** Look 1.11: the graphics tier in effect (from the URL, the setting, or Auto). */
  gfxTier: GfxTier = 'high';
  /** Auto's current tier: detected once, then stepped down by adaptQuality when frames stay slow. */
  private autoTier?: GfxTier;

  private setGraphics(v: GfxSetting) {
    if (v === 'auto') this.autoTier = undefined; // detect afresh
    this.setSetting('gfx', v);
  }

  /** Steam Deck (#243): is the Deck preset in effect (chosen, forced by the URL, or Auto on a Deck)? */
  deck = false;
  private resolveDeck(): boolean {
    if (urlTier()) return false;
    if (urlDeck()) return true;
    const s = this.settings.gfx ?? 'auto';
    return s === 'deck' || (s === 'auto' && onSteamDeck(this.app.graphicsDevice));
  }

  private resolveTier(): GfxTier {
    const forced = urlTier();
    if (forced) return forced;
    if (this.deck) return DECK.tier;
    const s = this.settings.gfx ?? 'auto';
    if (s === 'deck') return DECK.tier;
    if (s !== 'auto') return s;
    this.autoTier ??= detectTier(this.app.graphicsDevice);
    return this.autoTier;
  }

  private brookScan = 0;
  /**
   * Puts the brook's 3D emitter at the clean (restored) water around the view, weighted toward the closest
   * tiles; how much water there is sets its level. No clean water nearby: the brook fades out.
   */
  private placeBrook() {
    const f = this.camera.target;
    const R = 14;
    let w = 0, x = 0, z = 0;
    for (let tz = Math.floor(f.z - R); tz <= f.z + R; tz++) {
      for (let tx = Math.floor(f.x - R); tx <= f.x + R; tx++) {
        const t = this.sim.grid.get(GROUND, tx, tz);
        if (!t || t.blocked || t.occupantId || t.feature !== 'water' || t.ground !== 'restored') continue;
        const d = Math.hypot(tx + 0.5 - f.x, tz + 0.5 - f.z);
        if (d >= R) continue;
        const k = (1 - d / R) ** 2;
        w += k;
        x += k * (tx + 0.5);
        z += k * (tz + 0.5);
      }
    }
    if (w > 0) this.sfx.setBrook(Math.min(1, w / 3), x / w, 0, z / w);
    else this.sfx.setBrook(0, 0, 0, 0);
  }

  /**
   * 3D birds: up to BIRD_VOICES grown trees (stage 2+) nearest the view, at least 4 tiles apart so the voices
   * spread round the listener, each placed in its crown and louder the bigger the tree.
   */
  private placeBirds() {
    const f = this.camera.target;
    const R = 16;
    const found: { x: number; y: number; z: number; d: number; amount: number }[] = [];
    const h = this.sim.grid.layer(GROUND)?.height ?? 0;
    for (let tz = Math.floor(f.z - R); tz <= f.z + R; tz++) {
      for (let tx = Math.floor(f.x - R); tx <= f.x + R; tx++) {
        const t = this.sim.grid.get(GROUND, tx, tz);
        if (!t || t.feature === 'water') continue;
        const stage = treeStage(t);
        if (!stage || stage < 2) continue;
        const area = this.sim.areas.areaOf(t);
        const spot = area ? treeSpot(t, this.sim.areas.info(area).type) : undefined;
        if (!spot) continue;
        const d = Math.hypot(tx + 0.5 - f.x, tz + 0.5 - f.z);
        if (d >= R) continue;
        found.push({ x: tx + 0.5, y: h + 1.4 * spot.scale * (stage / 4), z: tz + 0.5, d, amount: (stage - 1) / 3 });
      }
    }
    found.sort((a, b) => a.d - b.d);
    const picked: typeof found = [];
    for (const c of found) {
      if (picked.length >= BIRD_VOICES) break;
      if (picked.every((q) => Math.hypot(q.x - c.x, q.z - c.z) >= 4)) picked.push(c);
    }
    this.sfx.setBirds(picked);
  }

  private setVolume(k: 'sfxVolume' | 'musicVolume', v: number) {
    this.settings[k] = Math.max(0, Math.min(100, v));
    this.setSetting('sound', this.settings.sound);
  }

  private setSetting(k: keyof Settings, v: boolean | string | number) {
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
    this.look.highContrast = !!s.highContrast;
    // Look 5.11: HUD glass without live blur (cheaper on phones). Look 1's Low graphics tier can set it too.
    document.body.classList.toggle('solid-glass', !!s.lowVfx);
    const rm = s.reducedMotion;
    this.look.lowVfx = !!s.lowVfx;
    this.look.reducedMotion = rm;
    this.deck = this.resolveDeck();
    this.gfxTier = this.resolveTier();
    // Steam Deck preset: three-quarter resolution and 1024 shadows on top of its tier.
    this.look.shadowCap = this.deck ? DECK.shadowRes : undefined;
    const dpr = this.deck ? DECK.renderScale : Math.min(window.devicePixelRatio || 1, 2);
    if (dpr !== this.maxDpr) {
      this.maxDpr = dpr;
      this.app.graphicsDevice.maxPixelRatio = dpr;
      this.app.resizeCanvas();
    }
    this.look.setTier(this.gfxTier);
    this.hud.gfxTier = this.gfxTier;
    this.hud.gfxDeck = this.deck;
    this.hud.setUiScale(s.uiScale ?? 100);
    // Phase 5 E16's fauna caps (TUNING.ecosystem.caps) follow the graphics tier.
    this.faunaTier = this.gfxTier;
    this.tileFx.reducedMotion = this.birds.reducedMotion = this.clouds.reducedMotion = this.butterflies.reducedMotion = this.grid.reducedMotion = this.machines.reducedMotion = this.drones.reducedMotion = this.cat.reducedMotion = this.camera.reducedMotion = this.fly.reducedMotion = rm;
    if (this.chunks) this.chunks.reducedMotion = rm;
    if (this.overlays) this.overlays.holo.reducedMotion = rm;
    if (this.transitions) {
      // Look 6: reduced motion keeps the timings with simpler visuals; detail follows the quality tier (Look 1's
      // setting when it lands, the "fewer effects" switch until then).
      this.transitions.reducedMotion = rm;
      if (this.tillers) this.tillers.reducedMotion = rm;
      const tier = (this as { gfxTier?: 'low' | 'medium' | 'high' }).gfxTier ?? (s.lowVfx ? 'low' : 'high');
      if (this.transitions.tier !== tier) {
        this.transitions.tier = tier;
        this.chunks?.markAll();
      }
    }
    this.vfx.density = rm ? 0.35 : s.lowVfx ? 0.45 : 1;
    this.vfx.reducedMotion = rm;
    this.cat.softSparkle = rm || s.lowVfx;
    this.machines.wispsPerSecond = s.lowVfx ? 2 : 5;
    // Look 3: surface detail, the leaf pattern and foliage density follow Look 1's graphics tier.
    detailTextures.setTier(this.gfxTier);
    setLeafTier(this.gfxTier);
    if (this.chunks) this.chunks.setDetail(this.deck ? DECK.detail : this.gfxTier);
    if (this.chunks && this.chunks.lowFog !== !!s.lowFog) {
      this.chunks.lowFog = !!s.lowFog;
      this.chunks.markAll();
    }
    document.body.classList.toggle('reduced', rm);
    // E19.4.2 / E20.7: the calm HUD is the default; E19.4.3: the potter-about pace. Both presentation only.
    document.body.classList.toggle('calm', calmHud(s));
    document.body.classList.toggle('potter', potterPace(s));
    this.hud.settings = s;
    if (!s.debug) this.hud.setDebug(null);
  }

  private saving = false;
  /** Autosave: compressed, off the frame (the next idle moment). Unload uses the plain synchronous save. */
  save() {
    if (this.resetting || this.saving) return;
    this.bot?.save();
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
    this.bot?.save();
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
    if (decorType(t)) this.lastDecor = t as `decor:${string}`;
    this.buildKey = '';
    this.sfx.click();
    this.hud.setTool(t);
    this.overlays.hideGhost();
    this.overlays.hideRadius();
    this.overlays.showGrid(t !== 'inspect' && t !== 'pulse');
    if (t !== 'inspect') this.select(undefined);
    if (this.pointer.inside) this.onHover(this.pointer.x, this.pointer.y);
  }

  /** E19.4.1 (#260): photo mode, wired to the camera, bloombot, the HUD and the look. */
  private createPhotoMode() {
    const b = this.bot;
    this.photoBar = new PhotoBar((a) => this.photo.action(a), (a) => this.hudKey(a));
    this.photo = new PhotoMode(
      {
        camera: this.camera,
        bot: b && {
          get following() {
            return b.following;
          },
          set following(v: boolean) {
            b.following = v;
          },
          setVisible: (v) => (b.visuals.root.enabled = v),
          pose: () => void b.visuals.play('cheer'),
        },
        setHudHidden: (hidden) => {
          document.body.classList.toggle('photo', hidden);
          if (hidden) {
            // Nothing of the game's own pointers in the picture: the hover frame, ghost, reach ring, grid, beacon.
            this.overlays.hideFrame();
            this.overlays.hideGhost();
            this.overlays.hideRadius();
            this.overlays.showGrid(false);
            this.overlays.hideBeacon();
            this.hud.hideTip();
          } else {
            const t = this.hud.currentTool;
            this.overlays.showGrid(t !== 'inspect' && t !== 'pulse');
            this.botPreviewKey = ''; // the front-tile preview draws again
          }
        },
        setDof: (on) => this.look.setPhotoDof(on),
        capture: () => this.savePicture(),
        render: (st) => this.photoBar.render(st),
        stick: () => padStick(),
      },
      this.bindings,
    );
    window.addEventListener('keyup', (e) => this.photo.key(e.code, false));
    window.addEventListener('blur', () => this.photo.clearKeys());
  }

  /**
   * E19.4.1: saves the canvas as a PNG, right after the next frame is drawn (the drawing buffer is only readable
   * then). The HUD is DOM over the canvas, so it is never in the picture. Where the canvas is see-through (no
   * post-processing), the haze colour fills in behind it.
   */
  private savePicture() {
    this.app.once('frameend', () => saveCanvasPng(this.app.graphicsDevice.canvas as HTMLCanvasElement, LOOK.haze.color));
    this.photoBar.flashNow();
    this.sfx.click();
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (this.keyListener) {
        e.preventDefault();
        this.keyListener(e.code);
        return;
      }
      if (this.bot && this.photo.active) {
        // E19.4.1: photo mode reads the same map with its own meanings (PhotoMode); held keys pan.
        this.photo.key(e.code, true);
        const a = this.bindings.actionForCode(e.code);
        if (a === 'backpack' || a === 'debug' || e.code.startsWith('Arrow')) e.preventDefault();
        if (!a || (e.repeat && a !== 'zoomIn' && a !== 'zoomOut' && a !== 'prevTool' && a !== 'nextTool')) return;
        if (a === 'debug') this.doAction(a);
        else this.photo.action(a);
        return;
      }
      if (this.bot) {
        // Bloombot's map (docs/BLOOMBOT_EPIC.md §7), rebindable; build tools stay on the number row.
        const slot = BUILD_DIGITS.indexOf(e.code as (typeof BUILD_DIGITS)[number]);
        const tools: Tool[] = ['solar', 'condenser', 'pollinator', 'droneHub', 'motherTree', 'reservoirGarden', 'relay', 'cultivator'];
        if (slot >= 0) return this.selectTool(tools[slot]);
        const a = this.bindings.actionForCode(e.code);
        if (!a) return;
        if (a === 'backpack' || a === 'debug') e.preventDefault();
        if (e.repeat && a !== 'zoomIn' && a !== 'zoomOut') return;
        this.doAction(a);
        return;
      }
      const k = e.key.toLowerCase();
      const map: Record<string, Tool> = { '1': 'inspect', '2': 'pulse', '3': 'solar', '4': 'condenser', '5': 'pollinator', '6': 'droneHub', '7': 'motherTree', '8': 'reservoirGarden', '9': 'relay', '0': 'cultivator' };
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
      } else if (k === 'escape') this.escape();
      else if (k === '+' || k === '=') this.camera.zoomBy(1.15);
      else if (k === '-') this.camera.zoomBy(1 / 1.15);
    });
  }

  /** Bloombot: one action from a key or a gamepad button. Movement and sprint are read by BotController. */
  private doAction(a: Action) {
    if ((this.photo.active && a !== 'debug') || a === 'photo') {
      if (!this.cinematic || this.photo.active) this.photo.action(a);
    } else if (a === 'pulse') this.botAct();
    else if (a === 'interact') this.botInteract();
    else if (a === 'tray') this.hud.toggleTray();
    else if (a === 'cancel') this.escape();
    else if (a === 'harvest') this.harvest();
    else if (a === 'upgrades') this.hud.toggleUpgrades();
    else if (a === 'backpack') this.hud.toggleBackpack();
    // E19.2: on the pad the bumpers turn a decoration in hand (they cycle tools otherwise)
    else if ((a === 'prevTool' || a === 'nextTool') && this.bot?.lastInput === 'pad' && this.turnable()) this.turnBuild(a === 'nextTool' ? 1 : -1);
    else if (a === 'prevTool') this.cycleTool(-1);
    else if (a === 'nextTool') this.cycleTool(1);
    else if (a === 'zoomIn') (this.photo?.active ? this.photo.zoom(1.15) : this.turnBuild(1));
    else if (a === 'zoomOut') (this.photo?.active ? this.photo.zoom(1 / 1.15) : this.turnBuild(-1));
    else if (a === 'overview') this.toggleOverview();
    else if (a === 'pause') this.setPaused(!this.paused);
    else if (a === 'frenzy') this.sim.frenzy.activate();
    else if (a === 'nextArea') this.focusNextArea();
    else if (a === 'home') this.focusArea(PARK);
    else if (a === 'recentre') this.camera.recentre();
    else if (a === 'debug') this.setSetting('debug', !this.settings.debug);
  }

  /** G.16: the rebinding screen waits for one key or button. */
  private keyListener?: (code: string) => void;
  private padListener?: (button: number) => void;
  private listenForBinding(kind: 'key' | 'pad', done: (code: string | number | undefined) => void) {
    const finish = (v: string | number | undefined) => {
      this.keyListener = undefined;
      this.padListener = undefined;
      done(v);
    };
    this.keyListener = (code) => finish(code === 'Escape' ? undefined : kind === 'key' ? code : undefined);
    if (kind === 'pad') this.padListener = (i) => finish(i);
  }

  private saveBindings() {
    const saved = this.bindings.save();
    this.settings.keys = saved.keys;
    this.settings.pad = saved.pad;
    this.setSetting('keys', saved.keys as unknown as string);
    this.hud.setKeyMap(this.bot?.lastInput ?? 'keys', this.bindings);
    this.hud.renderControls(this.bindings, (kind, done) => this.listenForBinding(kind, done), () => this.saveBindings());
    this.botPreviewKey = '';
  }

  private escape() {
    if (this.mergeSel) this.cancelMerge();
    else if (this.hud.modalOpen) this.hud.openSettings(false);
    else if (this.hud.isUpgradesOpen) this.hud.toggleUpgrades(false);
    else if (this.hud.trayOpen) this.hud.toggleTray(false);
    else if (this.hud.plotPickerOpen) this.hud.closePlotPicker();
    else if (this.hud.backpackOpen) this.hud.toggleBackpack(false);
    else if (this.selected) this.select(undefined);
    else if (this.bot?.walking) this.bot.cancelWalk();
    else this.selectTool('pulse');
  }

  /**
   * Bloombot: 1 / 2 and the bumpers step through the tools: Pulse, Inspect, then every machine that's unlocked
   * (and any Superstructure Core waiting to be placed), so a gamepad can build without opening the tray.
   */
  private cycleTool(step: number) {
    const tools: Tool[] = ['pulse', 'inspect'];
    for (const t of BUILDABLE) if (this.sim.build.isUnlocked(t)) tools.push(t);
    for (const btn of this.hud.root.querySelectorAll<HTMLElement>('#buildTray .super[data-tool]')) if (!btn.hidden) tools.push(btn.dataset.tool as Tool);
    // E19.2: the decoration last held, then the remove tool. With a decoration in hand the keys step through every
    // decoration earned (so the keyboard alone can choose one); on the pad the bumpers turn it and the tray chooses.
    const cur = this.hud.currentTool;
    const decor = [...this.hud.root.querySelectorAll<HTMLElement>('#buildTray .decor[data-tool^="decor:"]')].filter((b) => !b.hidden).map((b) => b.dataset.tool as Tool);
    tools.push(...(decorType(cur) ? decor : [this.lastDecor]), 'remove');
    const i = Math.max(0, tools.indexOf(cur));
    this.selectTool(tools[(i + step + tools.length) % tools.length]);
  }

  /** E19.2: build mode is having something in hand to build or remove (a machine, a core, a decoration, remove). */
  private building(t: Tool = this.hud.currentTool): boolean {
    return !!this.bot && t !== 'inspect' && t !== 'pulse';
  }
  /** the overview (M) is showing; walking, or M again, leaves it */
  private overviewOn = false;
  /** E19.2: the decoration the tool cycle offers (the last one held) */
  private lastDecor: `decor:${string}` = 'decor:bench';
  /** E19.2: how a decoration in hand is turned, in quarter turns (kept between placements, as in Satisfactory) */
  private buildRot = 0;
  private wheelAt = 0;

  /** Is what's in hand something that turns (a decoration)? */
  private turnable(): boolean {
    return !!this.bot && !!decorType(this.hud.currentTool);
  }

  /** E19.2: a quarter turn of the decoration in hand (wheel, + / -, or the pad's bumpers). */
  private turnBuild(step: number) {
    if (!this.turnable() || this.cinematic || this.hud.modalOpen) return;
    this.buildRot = (this.buildRot + (step > 0 ? 1 : 3)) % 4;
    this.buildKey = '';
    this.sfx.click();
  }

  private wheelTurn(factor: number) {
    const now = performance.now();
    if (factor === 1 || now - this.wheelAt < WHEEL_TURN_MS) return;
    this.wheelAt = now;
    this.turnBuild(factor > 1 ? 1 : -1);
  }

  /** Bloombot: hold the camera at the close view's distance (E19.2: building no longer pulls it back). */
  private updateBotZoom() {
    const b = this.bot;
    if (!b || this.cinematic) return;
    if (this.overviewOn && b.speed > 0.05) this.overviewOn = false; // walking leaves the overview
    if (this.overviewOn || !b.following) return; // the overview, or a camera-only fly-to, keeps its own zoom
    const want = BOT_ZOOM;
    if (Math.abs(this.camera.zoomTarget - want) > 1e-3) this.camera.zoomTo(want);
  }

  /** Bloombot (G.3): M or the View button: out to the city overview, and back to the close view. */
  private toggleOverview() {
    const c = this.camera;
    const out = !this.overviewOn;
    this.overviewOn = out;
    const t = this.bot ? this.bot.world() : [c.target.x, 0, c.target.z];
    c.glide(t[0], 0, t[2], out ? c.minZoom : BOT_ZOOM);
    if (!out && this.bot) this.bot.following = true;
  }

  /** E20.2 (#285): an action's key or pad button as plain text, as the player last used them. */
  private hudKey(a: Action): string {
    return this.bot?.lastInput === 'pad' ? padLabel(this.bindings.pad[a]) : keyLabel(this.bindings.keys[a][0] ?? '');
  }

  /** A key or button name for hints: the pointer's "Click", or bloombot's key / pad button. */
  private press(key: 'E' | 'Q', bot = this.previewFromBot): string {
    if (!bot) return 'Select'; // the internal cursor path (bots, dev tools)
    const a: Action = key === 'E' ? 'pulse' : 'interact';
    if (this.bot?.lastInput === 'pad') return `<kbd>${padLabel(this.bindings.pad[a])}</kbd>`;
    return `<kbd>${keyLabel(this.bindings.keys[a][0] ?? '')}</kbd>`;
  }

  /** The tile in front of bloombot as a pick. */
  private frontPick(): Pick | undefined {
    const b = this.bot;
    if (!b) return undefined;
    const f = b.front();
    const tile = this.sim.grid.get(b.pose.roofId, f.x, f.z);
    if (!tile) return undefined;
    return { roofId: b.pose.roofId, fx: f.x + 0.5, fz: f.z + 0.5, tile };
  }

  /** Where a tile is on screen (CSS pixels), for tooltips and fails anchored to it. */
  private botTileScreen(t: TileData): { x: number; y: number } {
    const v = this.camera.toScreen(this.tileVec(t, SLAB_TOP + 0.6));
    return { x: v.x, y: v.y };
  }

  private botAnim(r: ActResult) {
    const v = this.bot?.visuals;
    if (!v) return;
    if (r === 'pulse') {
      v.play('pulse');
      this.drones.companionReact('pulse');
    }
    else if (r === 'build') v.play('assemble');
    else if (r === 'select' || r === 'wake') v.play('interact');
  }

  /** Bloombot (G.4): E / A: the current tool on the tile in front (Inspect pulses; build tools build). */
  private botAct() {
    if (!this.bot || this.cinematic || this.paused || this.hud.modalOpen || this.bot.visuals.busy === 'assemble') return;
    const aim = this.building() ? this.buildAim() : undefined; // E19.2: build mode acts where the hologram is
    const p = aim ? aim.p : this.frontPick();
    if (!p || !p.tile) return;
    this.bot.following = true;
    const tool = this.hud.currentTool === 'inspect' ? 'pulse' : this.hud.currentTool;
    const sc = aim ?? this.botTileScreen(p.tile);
    this.botAnim(this.actAt(p, sc.x, sc.y, tool, false));
    this.botPreviewKey = '';
    this.buildKey = '';
  }

  /** Bloombot (G.5): Q / X: say hello to a cat within reach, wake or inspect what's in front, or read the tile. */
  private botInteract() {
    const b = this.bot;
    if (!b || this.cinematic || this.paused || this.hud.modalOpen) return;
    const [wx, , wz] = b.world();
    for (const id of this.cat.ids()) {
      const v = this.cat.targetWorld(id);
      if (v && Math.hypot(v.x - wx, v.z - wz) < BOT_REACH + 0.6) {
        b.pose.facing = Math.atan2(v.x - wx, v.z - wz);
        this.claimingCat = id;
        this.sim.cat.claim(id);
        this.claimingCat = undefined;
        b.visuals.play('cheer');
        return;
      }
    }
    const lift = this.liftAhead();
    if (lift) {
      this.rideLift(lift);
      return;
    }
    const aim = this.building() ? this.buildAim() : undefined;
    const p = aim ? aim.p : this.frontPick();
    if (!p || !p.tile) return;
    const occ = this.sim.occupant(p.tile);
    const sc = aim ?? this.botTileScreen(p.tile);
    // E19.2: a decoration in front (or aimed at) is picked up into bloombot's hands, to place again (a move)
    if (this.cozy.decorOf(p.tile.occupantId)) {
      this.botAnim(this.removeDecorAt(p, sc.x, sc.y, true));
      return;
    }
    if (occ) {
      this.botAnim(this.actAt(p, sc.x, sc.y, 'inspect', false));
      return;
    }
    this.select(undefined);
    const plot = this.openablePlot(p.roofId, p.tile.x, p.tile.z);
    if (plot) {
      b.visuals.play('interact');
      this.openPlotPicker(plot);
      return;
    }
    this.hud.showTip(sc.x, sc.y, `<b>${this.tileTitle(p.tile)}</b>${this.tileDetail(p.tile)}${this.pawHint(p.tile)}${this.plotLine(p.roofId, p.tile)}`);
  }

  /** G.13: the rooftop whose building stands on this ground cell. */
  private roofOver(x: number, z: number): LayerData | undefined {
    return this.sim.grid.clusterRoofs.find((l) => x >= l.origin[0] && x < l.origin[0] + l.width && z >= l.origin[2] && z < l.origin[2] + l.depth);
  }

  /**
   * G.13: a lift in front of bloombot: the wall of a building that carries a rooftop (going up), or the edge of
   * the rooftop it stands on (going down).
   */
  private liftAhead(): { up?: LayerData; down?: { x: number; z: number } } | undefined {
    const b = this.bot;
    if (!b) return undefined;
    const f = b.front();
    if (b.pose.roofId === GROUND) {
      const g = this.sim.grid.layer(GROUND)!;
      const roof = this.roofOver(f.x + g.origin[0], f.z + g.origin[2]);
      return roof ? { up: roof } : undefined;
    }
    const r = this.sim.grid.layer(b.pose.roofId)!;
    if (r.cluster && !this.sim.grid.inBounds(r.id, f.x, f.z)) {
      const g = this.sim.grid.layer(GROUND)!;
      return { down: { x: r.origin[0] + f.x - g.origin[0] + 0.5, z: r.origin[2] + f.z - g.origin[2] + 0.5 } };
    }
    return undefined;
  }

  private rideLift(lift: { up?: LayerData; down?: { x: number; z: number } }) {
    const b = this.bot!;
    if (lift.up) {
      const r = lift.up;
      if (r.preview || !this.sim.grid.isPlayable(r.id)) {
        const f = b.front();
        const t = this.sim.grid.get(GROUND, f.x, f.z);
        const sc = t ? this.botTileScreen(t) : { x: innerWidth / 2, y: innerHeight / 2 };
        this.hud.showFail(this.lockedReason(r.id), sc.x, sc.y);
        return;
      }
      const [wx, , wz] = b.world();
      const x = Math.min(r.width - 0.5, Math.max(0.5, wx - r.origin[0]));
      const z = Math.min(r.depth - 0.5, Math.max(0.5, wz - r.origin[2]));
      b.ride(r.id, x, z);
    } else if (lift.down) b.ride(GROUND, lift.down.x, lift.down.z);
    this.sfx.click();
  }

  /** G.17: a wake button sends bloombot to the landmark; it wakes it on arrival (as Q would). */
  private botWake(m: MachineData) {
    const b = this.bot!;
    const go = b.goTo(m.roofId, m.x, m.z, m.size, () => {
      if (!this.landmarkReady(m)) return;
      b.visuals.play('interact');
      this.wakeLandmark(m);
    });
    if (go) {
      this.hud.toast(`Bloombot is on its way to wake it`, '', 2.2);
      const [x, y, z] = b.world();
      this.camera.glide(x, y - SLAB_TOP, z, Math.max(this.camera.zoom, BOT_ZOOM * 0.8));
    } else this.hud.toast(m.roofId !== b.pose.roofId ? 'Ride the rooftop lift first: bloombot has to be there to wake it' : "Bloombot can't find a way there yet", '', 3);
  }

  /** G.12: is this landmark awake (its area cleared), so bloombot can travel to it from the overview? */
  private landmarkWoken(m: MachineData): boolean {
    const id = this.sim.areas.areaOf(m);
    return !!id && this.sim.areas.fog(id) === 'cleared';
  }

  /** Bloombot (G.11): a click walks to the clicked thing, then does what the click would have done. */
  private botClick(x: number, y: number) {
    const b = this.bot!;
    const catId = this.catHit(x, y);
    if (catId) {
      const v = this.cat.targetWorld(catId) ?? new pc.Vec3(b.world()[0], 0, b.world()[2]);
      const l = this.sim.grid.layer(b.pose.roofId)!;
      const claim = () => {
        this.claimingCat = catId;
        this.sim.cat.claim(catId);
        this.claimingCat = undefined;
        b.visuals.play('cheer');
      };
      if (!b.goTo(b.pose.roofId, Math.floor(v.x - l.origin[0]), Math.floor(v.z - l.origin[2]), 1, claim)) this.hud.showFail("Bloombot can't reach that cat from here", x, y);
      return;
    }
    // E19.2: build mode builds where you aim, within reach; bloombot doesn't walk there
    if (this.building()) {
      const p = this.pick(x, y);
      if (!p?.tile) return;
      if (p.roofId !== b.pose.roofId) this.hud.showFail(TOO_FAR, x, y);
      else this.botAnim(this.actAt(p, x, y, this.hud.currentTool, false));
      this.buildKey = '';
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
    const tool = this.hud.currentTool;
    // Another layer: reading a tile is fine from anywhere, but acting needs bloombot there (the lift, G.13).
    if (p.roofId !== b.pose.roofId || this.sim.grid.roof(p.roofId)?.preview) {
      if (this.hud.currentTool === 'inspect') this.actAt(p, x, y);
      else this.hud.showFail(this.sim.grid.roof(p.roofId)?.preview ? this.lockedReason(p.roofId) : b.pose.roofId === GROUND ? 'Ride a rooftop lift up there first' : 'Ride the lift down to the street first', x, y);
      return;
    }
    const occ = this.sim.occupant(p.tile);
    // G.12: from the overview, a woken landmark is a travel stop: bloombot hops there and the view comes back.
    if (this.overviewOn && occ?.type === 'core' && this.landmarkWoken(occ)) {
      b.teleport(occ.roofId, occ.x + occ.size / 2, occ.z + occ.size + 0.6);
      const [tx, ty, tz] = b.world();
      this.overviewOn = false;
      this.camera.glide(tx, ty - SLAB_TOP, tz, BOT_ZOOM);
      b.visuals.play('cheer');
      return;
    }
    // E19.1.2: inspecting a plot (or clicking a chosen one) walks to it and opens its picker
    const spot = !occ ? this.cozy.spotAt(p.roofId, p.tile.x, p.tile.z) : undefined;
    const plot = spot && (tool === 'inspect' || this.cozy.shown(spot)) ? this.openablePlot(p.roofId, p.tile.x, p.tile.z) : undefined;
    if (plot) {
      const go = b.goTo(p.roofId, plot.x, plot.z, plot.size, () => {
        b.visuals.play('interact');
        this.openPlotPicker(plot);
      });
      if (!go) this.hud.showFail("Bloombot can't find a way there", x, y);
      return;
    }
    if (tool === 'inspect' && !occ) {
      this.actAt(p, x, y); // reading a tile needs no walk
      return;
    }
    // What the action covers: a machine's footprint, a build ghost's footprint, or the one tile.
    let rect = { x: p.tile.x, z: p.tile.z, size: 1 };
    if (occ && !this.mergeSel) rect = { x: occ.x, z: occ.z, size: occ.size };
    else if (superType(tool) || machineTool(tool)) {
      const st = superType(tool);
      const a = st ? this.sim.supers.anchorFor(st, p.fx, p.fz) : this.sim.build.anchorFor(tool as BuildableType, p.fx, p.fz);
      rect = { x: a.x, z: a.z, size: st ? TIER3[st]!.size : MACHINES[tool as BuildableType].size };
    }
    const tile = p.tile;
    const go = b.goTo(p.roofId, rect.x, rect.z, rect.size, () => {
      const sc = this.botTileScreen(tile);
      this.botAnim(this.actAt(p, sc.x, sc.y, tool, false));
    });
    if (!go) this.hud.showFail("Bloombot can't find a way there", x, y);
  }

  private pointerRecent(): boolean {
    return this.pointer.inside && performance.now() - this.pointerAt < 1500;
  }

  /** Bloombot (G.4): highlight the tile in front and preview what E would do there (yields to an active mouse). */
  private updateBotPreview() {
    if (!this.bot) return;
    if (this.bot.lastInput !== this.keyMapShown) {
      this.keyMapShown = this.bot.lastInput;
      if (this.photo.active) this.photoBar.render(this.photo.state); // its key names follow the device too
      this.hud.setKeyMap(this.bot.lastInput, this.bindings);
    }
    if (this.cinematic || this.photo.active) return;
    if (this.updateBuildPreview()) return; // E19.2: build mode aims the hologram itself
    if (this.pointerRecent()) return;
    const p = this.frontPick();
    const now = performance.now();
    const key = `${this.bot.pose.roofId}:${this.bot.front().x},${this.bot.front().z}|${p?.roofId}:${p?.tile?.x},${p?.tile?.z}|${this.hud.currentTool}|${p?.tile?.ground}|${p?.tile?.bloom}|${this.bot.lastInput}`;
    if (key === this.botPreviewKey && now - this.botPreviewAt < 400) return;
    this.botPreviewKey = key;
    this.botPreviewAt = now;
    const lift = this.liftAhead();
    if (lift) {
      const [bx, by, bz] = this.bot.world();
      const v = this.camera.toScreen(new pc.Vec3(bx, by + 1.1, bz));
      const sc = p?.tile ? this.botTileScreen(p.tile) : { x: v.x, y: v.y };
      this.overlays.hideGhost();
      if (p?.tile) this.overlays.showFrame(p.roofId, p.tile.x, p.tile.z, 1, 'info');
      else this.overlays.hideFrame();
      const up = lift.up;
      const k = this.press('Q', true);
      const what = up ? (up.preview ? `<span class="bad">${this.lockedReason(up.id)}</span>` : `<span class="ok">${k} Ride up to the rooftop</span>`) : `<span class="ok">${k} Ride down to the street</span>`;
      this.hud.showTip(sc.x, sc.y, `<b>Rooftop lift</b>${what}`);
      return;
    }
    if (!p?.tile) {
      this.previewAt(undefined, 0, 0);
      return;
    }
    const sc = this.botTileScreen(p.tile);
    this.previewFromBot = true;
    try {
      this.previewAt(p, sc.x, sc.y);
    } finally {
      this.previewFromBot = false;
    }
  }

  pick(x: number, y: number): Pick | undefined {
    const { o, d } = this.camera.ray(x, y);
    // The endless ground only once it's playable (the rooftop campaign shows it as scenery).
    const layers = this.sim.grid.allLayers.filter((l) => l.kind === 'raised' || l.unlocked);
    const hit = pickLayers(layers, o, d);
    if (!hit) return undefined;
    // Look 4.9: unrevealed areas are drawn SINK lower. A ray that lands on one at the city level carries on
    // down to the sunk ground; if it ends under the revealed terrace instead, it hit the facade (nothing).
    if (hit.layerId === GROUND && this.city && this.sunkAt(hit.fx, hit.fz)) {
      const y = this.sim.grid.layer(GROUND)!.height + SLAB_TOP - SINK;
      const t = (y - o.y) / d.y;
      const fx = o.x + d.x * t;
      const fz = o.z + d.z * t;
      if (!this.sunkAt(fx, fz)) return undefined;
      return { roofId: GROUND, fx, fz, tile: this.sim.grid.get(GROUND, Math.floor(fx), Math.floor(fz)) };
    }
    return { roofId: hit.layerId, fx: hit.fx, fz: hit.fz, tile: this.sim.grid.get(hit.layerId, Math.floor(hit.fx), Math.floor(hit.fz)) };
  }

  /** Look 4.9: how far unrevealed ground is drawn below the city (tests read it). */
  readonly sinkDepth = SINK;

  /** Look 4.9: a city cell drawn sunk (its area not revealed yet). */
  sunkAt(x: number, z: number): boolean {
    return this.sim.areas.fog(this.sim.areas.map.areaOfCell(Math.floor(x), Math.floor(z))) === 'hidden';
  }

  /** See-through trees: 0..1, eases in while the cursor rests on the world and out when it leaves or pans. */
  private treeFade = 0;
  private updateTreeCursor(dt: number) {
    const c = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    const w = c.clientWidth, h = c.clientHeight;
    // Bloombot (G.3): when the mouse is idle, see through to bloombot instead of the cursor.
    let ptr: { x: number; y: number; inside: boolean } = this.pointer;
    if (this.bot && !this.pointerRecent()) {
      const [bx, by, bz] = this.bot.world();
      const v = this.camera.toScreen(new pc.Vec3(bx, by + 0.45, bz));
      ptr = { x: v.x, y: v.y, inside: true };
    }
    const on = ptr.inside && !this.cinematic && performance.now() - this.lastPanAt > 120;
    this.treeFade += ((on ? 1 : 0) - this.treeFade) * Math.min(1, dt * (on ? 10 : 6));
    // See-through skyscrapers: one between the camera and the middle of the view (or the cursor) fades out.
    const keep = [{ x: w / 2, y: h / 2, depth: this.camera.dist }];
    if (on) {
      const { o, d } = this.camera.ray(ptr.x, ptr.y);
      const t = d.y < -1e-3 ? -o.y / d.y : 400;
      const f = this.camera.entity.forward;
      keep.push({ x: ptr.x, y: ptr.y, depth: d.x * t * f.x + d.y * t * f.y + d.z * t * f.z + (o.x - this.camera.entity.getPosition().x) * f.x + (o.y - this.camera.entity.getPosition().y) * f.y + (o.z - this.camera.entity.getPosition().z) * f.z });
    }
    if (w && h && !this.cinematic) this.chunks.fadeTowers(dt, this.camera.cam, keep);
    if (this.treeFade < 0.002 || !w || !h) return setTreeCursor(0, 0, 0, 0, w || 1, h || 1);
    const { o, d } = this.camera.ray(ptr.x, ptr.y);
    // The ground under the cursor (or far away if the ray misses it) as a view depth.
    const t = d.y < -1e-3 ? -o.y / d.y : 400;
    const cam = this.camera.entity;
    const fwd = cam.forward;
    const p = cam.getPosition();
    const depth = (o.x + d.x * t - p.x) * fwd.x + (o.y + d.y * t - p.y) * fwd.y + (o.z + d.z * t - p.z) * fwd.z;
    setTreeCursor((ptr.x / w) * 2 - 1, 1 - (ptr.y / h) * 2, depth, this.treeFade, w, h);
  }

  private moodT = 0;
  private moodSet = false;

  /**
   * Look 1.7: the grade follows the restoration of the area under the camera (a cleared area is fully warm; a
   * fogged one warms as its tiles come back toward the landmark's need), so progress reads as the light returning.
   */
  private updateMood(dt: number) {
    this.moodT -= dt;
    if (this.moodT > 0) return;
    this.moodT = 0.5;
    const s = this.sim;
    const t = this.camera.target;
    const id = s.areas.areaOf({ roofId: GROUND, x: Math.floor(t.x), z: Math.floor(t.z) });
    let mood = 0;
    if (id) {
      const fog = s.areas.fog(id);
      if (fog === 'cleared') mood = 1;
      else if (fog !== 'hidden') mood = Math.min(1, s.areas.counts(id).restored / s.areas.need(id));
    }
    this.look.moodTarget = mood;
    if (!this.moodSet) this.look.snapMood();
    this.moodSet = true;
  }

  /**
   * Haze and shadow reach follow the zoom-dependent camera (its distance changes with the zoom). Look 4.5/4.7:
   * the haze reaches a little less far close up, its colour is the sky's horizon colour so the ground fades
   * into the sky, and both grey while the city is fogged.
   */
  private syncView() {
    const c = this.camera;
    const n = c.nearness();
    c.hazeStart = HAZE.start[0] + (HAZE.start[1] - HAZE.start[0]) * n;
    c.hazeEnd = HAZE.end[0] + (HAZE.end[1] - HAZE.end[0]) * n;
    if (this.bot) {
      // G.18: past the old default zoom, lower tiers pull the haze (and so the far clip) in.
      const close = Math.min(1, Math.max(0, c.zoom - 1) / 0.9);
      const reach = this.deck ? DECK.closeReach : (CLOSE_VIEW_REACH[this.gfxTier as keyof typeof CLOSE_VIEW_REACH] ?? 1);
      c.hazeEnd *= 1 - (1 - reach) * close;
    }
    this.app.scene.fog.start = c.fogDepth(c.dist + c.hazeStart);
    this.app.scene.fog.end = c.fogDepth(c.dist + c.hazeEnd);
    if (this.sky) {
      const [r, g, b] = this.sky.hazeColour();
      this.app.scene.fog.color.set(r, g, b, 1);
      c.cam.clearColor = new pc.Color(r, g, b, 1);
    }
    const sun = this.scene.sun.light;
    if (sun) sun.shadowDistance = c.shadowDistance();
  }

  /** Look 4.7: how clear the sky is (0 grey … 1 clear): the park's stage, then each woken area. */
  private skyClarity(): number {
    const p = this.sim.progression;
    const park = this.city ? Math.max(0, p.parkStage()) / 4 : 0;
    const k = park * 0.4 + Math.min(1, this.sim.areas.clearedCount() / 8) * 0.6;
    return k * k * (3 - 2 * k) * 0.85 + 0.15;
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

  /**
   * Look 4.11 (#155): the visible ground as the frustum's footprint (a trapezoid reaching toward the horizon)
   * and its bounding rectangle. Each screen corner's ray meets the (sunk) ground, but never further than the
   * haze reaches: past it everything is the haze colour, so nothing there needs streaming.
   */
  private groundRect() {
    const c = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const cam = this.camera;
    const reach = cam.dist + cam.hazeEnd + 8; // from the camera, along the ground
    const floor = -SINK;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    const poly: [number, number][] = [];
    for (const [sx, sy] of [[0, 0], [w, 0], [w, h], [0, h]]) {
      const { o, d } = cam.ray(sx, sy);
      const flat = Math.max(1e-6, Math.hypot(d.x, d.z));
      const cap = reach / flat;
      const t = d.y < -1e-3 ? Math.min(cap, (floor - o.y) / d.y) : cap;
      const x = o.x + d.x * t;
      const z = o.z + d.z * t;
      poly.push([x, z]);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    // Never stream an unbounded amount at extreme zoom-out.
    const cx = cam.target.x;
    const cz = cam.target.z;
    const R = 90;
    return { x0: Math.max(x0, cx - R), x1: Math.min(x1, cx + R), z0: Math.max(z0, cz - R), z1: Math.min(z1, cz + R), poly };
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
      const sp = this.camera.onScreen(p);
      if (sp) pts.push({ id: d.id, x: sp.x, y: sp.y });
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
      const s = this.camera.onScreen(p);
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * The 🐾 chip. E20.1 (#284): the cat has to be found, so the chip never moves the camera: it says which way the
   * paw prints lead from bloombot (or the view), and what the cat hides beside. The meow already comes from there.
   */
  private findCat() {
    const s = this.sim;
    const spot = s.cat
      .spots()
      .filter((c) => s.cat.hinted(c))
      .sort((a, b) => a.spawnedAt - b.spawnedAt)[0];
    const a = spot && s.cat.anchor(spot.anchorId);
    if (!spot || !a) return;
    const p = this.cat.anchorWorld(a);
    const [fx, , fz] = this.bot ? this.bot.world() : [this.camera.target.x, 0, this.camera.target.z];
    this.hud.feed(`🐾 Paw prints lead ${compass(p.x - fx, p.z - fz)}, ${a.hint}…`);
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
    const s = this.camera.onScreen(p, 0);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!s || s.x < 40 || s.y < 40 || s.x > w - 40 || s.y > h - 40) return 'offscreen';
    // E20.1 (#284): in the close view, a spot far from bloombot is small and hazy: it counts as out of sight.
    if (this.bot) {
      const [bx, , bz] = this.bot.world();
      if (Math.hypot(p.x - bx, p.z - bz) > TUNING.cat.inViewTiles) return 'offscreen';
    }
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
    this.pointerAt = performance.now();
    if (this.cinematic || this.photo.active) return;
    if (this.building()) {
      document.body.style.cursor = '';
      return; // E19.2: build mode previews from the frame loop (updateBuildPreview), wherever the pointer is
    }
    if (this.catHit(x, y)) {
      this.overlays.hideFrame();
      this.overlays.hideGhost();
      this.hud.showTip(x, y, `<b>🐱 …is that a cat?</b>Go and say hello!`);
      document.body.style.cursor = 'pointer';
      return;
    }
    if (this.droneHit(x, y)) {
      this.overlays.hideFrame();
      this.overlays.hideGhost();
      this.hud.showTip(x, y, `<b>🛸 Drone</b>Press ${this.hudKey('interact')} beside it to see its work area and current job`);
      document.body.style.cursor = 'pointer';
      return;
    }
    document.body.style.cursor = '';
    this.previewAt(this.pick(x, y), x, y);
  }

  /** The hover preview for a tile (ghost, pulse footprint, frame and tooltip), from the pointer or bloombot. */
  /** E19: the build hologram's shape for a machine type: its model, or a footprint block. */
  private holoShape(type: MachineData['type'], size: number): HoloShape {
    const m = MACHINE_MODELS[type];
    return m ? { kind: 'model', name: m[0], scale: m[1] * (size > 1 ? 1.3 : 1) } : { kind: 'block', height: type === 'motherTree' ? 1.1 : size > 2 ? 1.2 : 0.45 };
  }

  private previewAt(p: Pick | undefined, x: number, y: number) {
    if (this.hud.plotPickerOpen) return; // the picker's hologram owns the preview while it's open
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
    const dk = decorType(tool);
    if (dk) return this.previewDecor(p, x, y, dk);
    if (tool === 'remove') return this.previewRemove(p, x, y);
    const st = superType(tool);
    if (st) {
      // Phase 5 E14: placing a Superstructure Core: footprint ghost, reach, and the whole build's price first.
      const a = this.sim.supers.anchorFor(st, p.fx, p.fz);
      const d = TIER3[st]!;
      const chk = { ...this.sim.supers.check(st, p.roofId, a.x, a.z) };
      if (chk.ok && !this.inReach(p.roofId, a.x, a.z, d.size)) Object.assign(chk, { ok: false, reason: TOO_FAR });
      this.overlays.showGhost(p.roofId, a.x, a.z, d.size, chk.ok, 0.3, this.bot ? this.holoShape(st, d.size) : undefined);
      this.overlays.showRadius(this.sim.grid.tilesNear({ roofId: p.roofId, x: a.x, z: a.z, size: d.size }, 2), chk.ok ? 'ok' : 'info');
      const stages = chk.costs.map((c, i) => `${SuperSystem.stageName(i)} ${formatCost(c)}`).join('<br>');
      this.hud.showTip(
        x,
        y,
        `<b>${d.icon} ${d.name}</b>${d.blurb}. ${d.ability}.<br><small>${stages}<br>Total ${formatCost(this.sim.supers.totalCost(chk.costs))} · prices fixed once placed</small><br>${chk.ok ? `<span class="ok">${this.press('E')} to lay the foundation</span>` : `<span class="bad">${chk.reason}</span>`}`,
      );
      return;
    }
    if (machineTool(tool)) {
      const bt = tool;
      const a = this.sim.build.anchorFor(bt, p.fx, p.fz);
      const chk = { ...this.sim.build.check(bt, p.roofId, a.x, a.z) };
      const def = MACHINES[bt];
      if (chk.ok && this.cozy.plotUnder(p.roofId, a.x, a.z, def.size)) Object.assign(chk, { ok: false, spotOk: false, reason: PLOT_IN_WAY });
      if ((chk.ok || chk.spotOk) && !this.inReach(p.roofId, a.x, a.z, def.size)) Object.assign(chk, { ok: false, spotOk: false, reason: TOO_FAR });
      this.overlays.showGhost(p.roofId, a.x, a.z, def.size, chk.ok || chk.spotOk, def.size === 2 ? 0.35 : 0.5, this.bot ? this.holoShape(bt, def.size) : undefined);
      this.overlays.showRadius(this.radiusTiles({ type: bt, roofId: p.roofId, x: a.x, z: a.z, size: def.size }), chk.ok ? 'ok' : 'info');
      this.hud.showTip(
        x,
        y,
        `<b>${def.icon} ${def.name}</b>${def.blurb}<br>${this.mergeHint(bt, p.roofId, a.x, a.z, def.size)}${chk.ok ? `<span class="ok">${this.press('E')} to build · ${formatCost(chk.cost)}</span>` : `<span class="bad">${chk.reason}</span>`}`,
      );
      return;
    }
    this.overlays.hideGhost();
    const occ = this.sim.occupant(t);
    const dec = this.cozy.decorOf(t.occupantId);
    if (dec) {
      // E19.2: a decoration: Q picks it up to move it (the remove tool removes it)
      const o = DECOR_OPTION[dec.kind];
      this.overlays.showFrame(t.roofId, t.x, t.z, 1, 'info');
      this.overlays.hideRadius();
      this.hud.showTip(x, y, `<b>${o?.icon ?? ''} ${o?.name ?? 'Decoration'}</b>${this.previewFromBot ? `<span class="ok">${this.press('Q')} to pick it up and move it</span>` : 'A decoration'}`);
      return;
    }
    if (occ) {
      this.overlays.showFrame(occ.roofId, occ.x, occ.z, occ.size, 'info');
      const ready = occ.type === 'core' && this.landmarkReady(occ);
      const area = occ.type === 'core' ? this.sim.areas.areaOf(occ) : undefined;
      const ct = area ? { icon: AREA_TYPES[this.sim.areas.info(area).type].icon, name: this.sim.areas.info(area).landmarkName } : undefined;
      const boost = (occ.overchargeUntil ?? 0) > this.sim.time ? '<br><span class="ok">⚡ Boosted: next trigger +1</span>' : '';
      this.hud.showTip(x, y, `<b>${ct?.icon ?? machineIcon(occ)} ${ct?.name ?? machineName(occ)}</b>${ready ? `<span class="ok">Ready! ${this.press('Q')} to awaken.</span>` : `${this.press('Q')} to inspect`}${boost}`);
      return;
    }
    if (tool === 'inspect') {
      const plot = this.cozy.spotAt(t.roofId, t.x, t.z);
      if (plot && (this.cozy.ready(plot) || this.cozy.shown(plot))) this.overlays.showFrame(t.roofId, plot.x, plot.z, plot.size, 'hover');
      else this.overlays.showFrame(t.roofId, t.x, t.z, 1, 'hover');
      this.hud.showTip(x, y, `<b>${this.tileTitle(t)}</b>${this.tileDetail(t)}${this.pawHint(t)}${this.plotLine(t.roofId, t)}`);
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
    this.hud.showTip(x, y, `<b>${this.tileTitle(t)}</b>${this.tileDetail(t)}${action ? '<br>' + action : ''}${this.plotLine(t.roofId, t)}`);
  }

  // ───────────── E19.2: build mode and decorations ─────────────

  private buildKey = '';
  private buildAt = 0;

  /** Does the mouse aim builds (over the world, moved lately, and the pad isn't what was used last)? */
  private mouseAims(): boolean {
    return this.pointer.inside && this.bot?.lastInput !== 'pad' && performance.now() - this.pointerAt < MOUSE_AIM_MS;
  }

  /** Where a build is aimed, and where on screen to say so: the pointer's tile, or the tile in front of bloombot. */
  private buildAim(): { p?: Pick; x: number; y: number } {
    if (this.mouseAims()) return { p: this.pick(this.pointer.x, this.pointer.y), x: this.pointer.x, y: this.pointer.y };
    const p = this.frontPick();
    const sc = p?.tile ? this.botTileScreen(p.tile) : { x: innerWidth / 2, y: innerHeight / 2 };
    return { p, x: sc.x, y: sc.y };
  }

  /** Is a footprint within bloombot's reach, on its layer? (Always, without bloombot.) */
  private inReach(roofId: string, x: number, z: number, size: number): boolean {
    const b = this.bot;
    if (!b) return true;
    if (b.pose.roofId !== roofId) return false;
    return Math.hypot(b.pose.x - (x + size / 2), b.pose.z - (z + size / 2)) <= DECOR_GEN.reach + (size - 1) / 2;
  }

  /** Words for turning what's in hand, for the input used last. */
  private turnHint(): string {
    if (!this.bot) return '';
    if (this.bot.lastInput === 'pad') return `${padLabel(this.bindings.pad.prevTool)} / ${padLabel(this.bindings.pad.nextTool)} to turn`;
    return `wheel or ${keyLabel(this.bindings.keys.zoomOut[0] ?? '')} / ${keyLabel(this.bindings.keys.zoomIn[0] ?? '')} to turn`;
  }

  /** Build mode's preview, every frame: the hologram where you aim (true while building). */
  private updateBuildPreview(): boolean {
    if (!this.building() || this.cinematic || this.hud.modalOpen || this.hud.plotPickerOpen) return false;
    const b = this.bot!;
    const { p, x, y } = this.buildAim();
    const t = p?.tile;
    const key = `${this.hud.currentTool}|${this.buildRot}|${p?.roofId}:${t?.x},${t?.z}|${t?.ground}|${t?.occupantId}|${Math.round(b.pose.x * 4)},${Math.round(b.pose.z * 4)}|${b.lastInput}|${Math.round(x)},${Math.round(y)}`;
    const now = performance.now();
    if (key === this.buildKey && now - this.buildAt < 400) return true;
    this.buildKey = key;
    this.buildAt = now;
    this.previewFromBot = true;
    try {
      this.previewAt(p, x, y);
    } finally {
      this.previewFromBot = false;
    }
    return true;
  }

  private previewDecor(p: Pick, x: number, y: number, kind: string) {
    const t = p.tile!;
    const o = DECOR_OPTION[kind];
    const why = this.decorProblem(kind, p.roofId, t.x, t.z);
    this.overlays.hideRadius();
    this.overlays.showGhost(p.roofId, t.x, t.z, 1, !why, 0.4, this.bot ? { kind: 'decor', decor: kind, rot: this.buildRot } : undefined);
    const how = `${this.press('E')} to place${this.bot ? ` · ${this.turnHint()}` : ''}`;
    this.hud.showTip(x, y, `<b>${o?.icon ?? ''} ${o?.name ?? kind}</b>${o?.blurb ?? ''} <small>${o?.solid ? 'Solid' : 'Walk over it'} · free</small><br>${why ? `<span class="bad">${why}</span>` : `<span class="ok">${how}</span>`}`);
  }

  private previewRemove(p: Pick, x: number, y: number) {
    const t = p.tile!;
    const d = this.cozy.decorOf(t.occupantId);
    this.overlays.hideRadius();
    if (!d) {
      this.overlays.hideGhost();
      this.overlays.showFrame(p.roofId, t.x, t.z, 1, 'hover');
      this.hud.showTip(x, y, '<b>🧹 Remove</b>Aim at a decoration to remove it or pick it up');
      return;
    }
    const o = DECOR_OPTION[d.kind];
    const far = !this.inReach(p.roofId, t.x, t.z, 1);
    // the decoration aimed at lights up red: removing it is free and instant
    this.overlays.showGhost(p.roofId, t.x, t.z, 1, false, 0.4, this.bot ? { kind: 'decor', decor: d.kind, rot: d.rot } : undefined);
    const how = far ? `<span class="bad">${TOO_FAR}</span>` : `<span class="ok">${this.press('E')} to remove${this.bot ? ` · ${this.press('Q')} to pick it up and move it` : ''}</span>`;
    this.hud.showTip(x, y, `<b>${o?.icon ?? ''} ${o?.name ?? d.kind}</b>${how}`);
  }

  /** Why a decoration in hand can't go here (the tile's rules, reach, and not on top of bloombot if it's solid). */
  private decorProblem(kind: string, roofId: string, x: number, z: number): string | undefined {
    const why = this.cozy.canDecorate(kind, roofId, x, z);
    if (why) return why;
    if (!this.inReach(roofId, x, z, 1)) return TOO_FAR;
    const b = this.bot;
    if (b && DECOR_OPTION[kind]?.solid && b.pose.roofId === roofId && Math.abs(b.pose.x - (x + 0.5)) < 0.5 + BOT.radius && Math.abs(b.pose.z - (z + 0.5)) < 0.5 + BOT.radius) return 'Bloombot is standing there';
    return undefined;
  }

  /** Places the decoration in hand on a tile (free); it stays in hand for the next one. */
  private placeDecorAt(p: Pick, x: number, y: number, kind: string): ActResult {
    const t = p.tile!;
    const why = this.decorProblem(kind, p.roofId, t.x, t.z) ?? this.cozy.placeDecor(kind, this.buildRot, p.roofId, t.x, t.z);
    if (why) {
      this.hud.showFail(why, x, y);
      return 'none';
    }
    this.chunks.markTile(t);
    this.sfx.build();
    this.vfx.burst(this.tileVec(t, SLAB_TOP + 0.2), 8, { up: 1.6, size: 0.04, life: 0.8 });
    this.buildKey = '';
    return 'select';
  }

  /** Removes the decoration on a tile (free, instant); with `pickUp` it goes into bloombot's hands, turned as it was. */
  private removeDecorAt(p: Pick, x: number, y: number, pickUp: boolean): ActResult {
    const t = p.tile!;
    const d = this.cozy.decorOf(t.occupantId);
    if (!d) {
      this.hud.showFail('Aim at a decoration', x, y);
      return 'none';
    }
    if (!this.inReach(p.roofId, t.x, t.z, 1)) {
      this.hud.showFail(TOO_FAR, x, y);
      return 'none';
    }
    this.cozy.removeDecor(d.roofId, d.x, d.z);
    this.chunks.markTile(t);
    this.vfx.burst(this.tileVec(t, SLAB_TOP + 0.2), 6, { up: 1.2, size: 0.035, life: 0.6 });
    const o = DECOR_OPTION[d.kind];
    if (pickUp && o) {
      this.buildRot = d.rot;
      this.selectTool(`decor:${d.kind}`);
      this.hud.toast(`${o.icon} ${o.name} in hand<small>Aim where it goes and press ${this.hudKey('pulse')}. ${this.hudKey('cancel')} puts it away.</small>`, '', 2.6);
    } else this.sfx.click();
    this.buildKey = '';
    return 'select';
  }

  /** The decorations of one ground chunk, for the chunk renderer. */
  private decorInChunk(cx: number, cz: number): Decoration[] {
    const keys = this.sim.grid.decorInChunk(chunkKey(GROUND, cx, cz));
    if (!keys.length) return [];
    return keys.flatMap((k) => this.cozy.decorByKey(k) ?? []);
  }

  /**
   * E19.2 dev and perf helper: decorates restored, free ground in the revealed city, every `every`-th tile, cycling
   * through every decoration and turn (all unlocked); `null` clears them all. Returns how many stand afterwards.
   */
  fillDecor(every: number | null = 5): number {
    const cz = (this.sim.state.cozy ??= {});
    if (every === null) for (const d of this.cozy.decorations()) this.cozy.removeDecor(d.roofId, d.x, d.z);
    else {
      cz.decorUnlocked = DECOR_OPTIONS.filter((o) => !('start' in o.unlock)).map((o) => o.id);
      let i = 0;
      let n = 0;
      for (const id of this.sim.areas.revealed())
        for (const t of this.sim.areas.tiles(id)) {
          if (t.ground !== 'restored' || t.occupantId || i++ % Math.max(1, every) !== 0) continue;
          const o = DECOR_OPTIONS[n % DECOR_OPTIONS.length];
          if (!this.cozy.placeDecor(o.id, Math.floor(n / DECOR_OPTIONS.length) % 4, GROUND, t.x, t.z)) n++;
        }
    }
    this.chunks.markAll();
    return this.cozy.decorCount();
  }

  // ───────────── E19.1: plots ─────────────

  /** What the renderer draws on a plot: the option being previewed or chosen, the waiting look, or nothing. */
  private plotLook(p: PlotSpot): string | null | undefined {
    if (this.pickerPlot?.id === p.id) return null; // the picker's hologram shows the choice; the plot waits under it
    const shown = this.cozy.shown(p);
    if (shown) return shown.id;
    if (this.cozy.choice(p.id)) return undefined; // a machine stands on it
    return this.cozy.ready(p) ? null : undefined;
  }

  /** A plot at this cell that can be opened now (ready, or already chosen). */
  private openablePlot(roofId: string, x: number, z: number): PlotSpot | undefined {
    const p = this.cozy.spotAt(roofId, x, z);
    return p && (this.cozy.ready(p) || this.cozy.shown(p)) ? p : undefined;
  }

  /** A line for a tile's tooltip when it's part of a plot: what Q does there, or what the plot waits for. */
  private plotLine(roofId: string, t: TileData): string {
    const p = this.cozy.spotAt(roofId, t.x, t.z);
    if (!p || this.sim.areas.fog(p.areaId) === 'hidden') return '';
    const chosen = this.cozy.shown(p);
    const k = this.press('Q', true);
    if (chosen) return `<br><span class="ok">${chosen.icon} ${chosen.name} · ${k} to change it</span>`;
    if (this.cozy.ready(p)) return `<br><span class="ok">🌱 An empty plot · ${k} to choose what it becomes</span>`;
    if (this.cozy.choice(p.id)) return '';
    return '<br><small>🌱 A plot: restore all four tiles to choose what it becomes</small>';
  }

  /** E19.1.2: opens the picker for a plot (bloombot is beside it). */
  private openPlotPicker(p: PlotSpot) {
    this.hud.hideTip();
    const info = this.sim.areas.info(p.areaId);
    const choices = this.cozy.choices(p);
    const current = this.cozy.choice(p.id)?.id;
    this.pickerPlot = p;
    this.chunks.markPlot(p);
    this.hud.openPlotPicker(
      {
        title: current ? `🌱 A plot by the ${info.landmarkName}` : '🌱 An empty plot',
        sub: `${AREA_TYPES[info.type].name} · free to choose and change any time`,
        current,
        choices: choices.map((c) => ({ id: c.option.id, name: c.option.name, icon: c.option.icon, blurb: c.option.blurb, solid: c.option.solid, unlocked: c.unlocked, fresh: c.fresh, hint: c.hint })),
      },
      {
        onPreview: (id) => this.previewPlot(p, id ?? current), // off an option: back to what's chosen
        onChoose: (id) => this.choosePlot(p, id),
        onClose: () => {
          this.previewPlot(p, undefined);
          this.pickerPlot = undefined;
          this.chunks.markPlot(p);
        },
      },
    );
    this.cozy.seen(choices.filter((c) => c.fresh).map((c) => c.option.id)); // the "new" marker shows this once
    if (current) this.previewPlot(p, current);
    this.sfx.click();
  }

  private previewPlot(p: PlotSpot, option: string | undefined) {
    const next = option ? { id: p.id, option } : undefined;
    if (this.plotPreview?.id === next?.id && this.plotPreview?.option === next?.option) return;
    this.plotPreview = next;
    // E19: the option bloombot is considering is projected over the plot as a hologram
    if (next && this.bot) {
      this.hud.hideTip();
      this.overlays.showGhost(GROUND, p.x, p.z, p.size, true, 0.5, { kind: 'plot', plot: p, option: next.option });
    } else this.overlays.hideGhost();
  }

  private choosePlot(p: PlotSpot, option: string | undefined) {
    const why = this.cozy.choose(p.id, option);
    if (why) {
      this.hud.showFail(why);
      return;
    }
    this.plotPreview = undefined;
    this.hud.closePlotPicker();
    this.chunks.markPlot(p);
    this.sfx.click();
    const o = option ? this.cozy.choice(p.id) : undefined;
    this.hud.toast(o ? `${o.icon} ${o.name} it is<small>Change it any time: it's free.</small>` : '🌱 The plot is empty again', '', 2.4);
    if (this.bot) {
      this.bot.visuals.play(o ? 'cheer' : 'interact');
      if (o?.solid) this.bot.walker.settle(this.bot.pose); // never left standing inside it
    }
  }

  /**
   * E19.1.5: dev and perf helper. Restores every plot in the revealed city and gives each an option (all options
   * unlocked, round-robin, or `only` for every plot); `null` clears them all. Returns how many plots it set.
   */
  fillPlots(only?: string | null): number {
    const st = this.sim.state;
    const cz = (st.cozy ??= {});
    cz.unlocked = PLOT_OPTIONS.filter((o) => !('start' in o.unlock)).map((o) => o.id);
    let n = 0;
    for (const id of this.sim.areas.revealed())
      for (const p of this.cozy.spots(id)) {
        for (let j = 0; j < p.size; j++)
          for (let i = 0; i < p.size; i++) {
            const t = this.sim.grid.get(GROUND, p.x + i, p.z + j);
            if (!t || t.occupantId || t.blocked || t.ground === 'restored') continue;
            t.ground = 'restored';
            t.pollution = 0;
            t.bloom = Math.max(1, t.bloom);
            this.sim.grid.touch(t);
          }
        if (only === null) {
          this.cozy.choose(p.id, undefined);
          continue;
        }
        const opts = this.cozy.choices(p).filter((c) => c.unlocked);
        const pick = only ? opts.find((c) => c.option.id === only) : opts[n % Math.max(1, opts.length)];
        if (pick && !this.cozy.choose(p.id, pick.option.id)) n++;
      }
    this.chunks.markAll();
    return n;
  }

  /** E19.1.3: every plot option id (review shots). */
  plotOptionIds(): string[] {
    return PLOT_OPTIONS.map((o) => o.id);
  }

  /** E19.1.4: new plot options earned (checked about once a second): one toast each. */
  private checkCozyUnlocks() {
    if (this.clock < this.cozyCheckAt) return;
    this.cozyCheckAt = this.clock + 1;
    for (const o of this.cozy.checkUnlocks()) this.hud.toast(`${o.icon} New plot option: ${o.name}<small>${o.blurb} Look for empty plots in restored ground.</small>`, 'gold', 4.5);
    for (const o of this.cozy.checkDecorUnlocks()) this.hud.toast(`${o.icon} New decoration: ${o.name}<small>${o.blurb} It’s in the Build tray (${this.hudKey('tray')}), free to place.</small>`, 'gold', 4.5);
    // The picker closes if bloombot wanders off.
    const pp = this.pickerPlot;
    if (pp && this.bot) {
      const [bx, , bz] = this.bot.world();
      if (Math.hypot(bx - (pp.x + pp.size / 2), bz - (pp.z + pp.size / 2)) > 4.5 || this.bot.pose.roofId !== GROUND) this.hud.closePlotPicker();
    }
  }

  /** Look 6.10: the name of the stage a tile's transition is in (inspect panel). */
  private stageName(t: TileData): string | undefined {
    const tr = t.tr;
    if (!tr) return undefined;
    const p = this.transitions.progress(t);
    if (p >= 1) return undefined;
    const S = TUNING.transitions.restoreStages;
    switch (tr.k) {
      case 'restore':
        return p < S.fracture[1] ? '💥 Slab fracturing' : p < S.heave[1] ? '🪨 Roots heaving the slab' : p < S.crumble[1] ? '🟫 Crumbling into soil' : p < S.knit[0] ? '🌱 Seedlings unfurling' : '🌿 Turf knitting';
      case 'bloom':
        return '🌸 Growing in';
      case 'moss':
        return '🍃 Moss creeping in';
      case 'soften':
        return '🧱 Softening';
      case 'unblock':
        return '🪨 Crumbling away';
    }
  }

  private tileDetail(t: TileData): string {
    if (t.blocked) return 'Nothing grows here.';
    const zone = this.sim.production.inPollinatorZone(t);
    switch (t.ground) {
      case 'polluted': {
        const left = this.sim.cultivators.remaining(t);
        if (left !== undefined) return `🚜 The Cultivator is softening this slab — ${Math.ceil(left)} s to bloom. Pulse it to knock it along.`;
        return `Pollution ${Math.round(t.pollution)}% — restoring neighbours softens it into moss.`;
      }
      case 'prepared':
        return zone ? '🌸 Inside a garden zone — may set off a Bloom Chain!' : 'Ready to bloom — cheaper to restore.';
      case 'growing':
        return `${this.stageName(t) ?? 'Roots are breaking through'} — ${Math.max(1, Math.ceil(t.growthRemainingSec))} s`;
      case 'restored': {
        const rate = this.sim.production.tileBiomassRate(t);
        const lush = (t.lushUntil ?? 0) > this.sim.time ? ` · 💧 lush ${Math.ceil(t.lushUntil! - this.sim.time)} s` : '';
        const st = this.stageName(t);
        const left = t.tr ? Math.ceil(t.tr.t0 + t.tr.d - this.sim.time) : 0;
        const proc = st && left > 0 ? ` · ${st} (${left} s)` : '';
        return `+${rate.toFixed(2)}🌿/s${zone ? ' (garden ×2)' : ''}${lush}${proc}${t.bloom >= TUNING.restore.maxBloom ? ' · radiant ✦' : t.bloom >= TUNING.restore.fullBloom ? ' · full bloom ✓' : ''}`;
      }
    }
  }

  private onClick(x: number, y: number, button: number) {
    if (button !== 0 || this.cinematic || this.photo.active) return;
    if (this.hud.isUpgradesOpen && window.innerWidth < 760) {
      this.hud.toggleUpgrades(false);
      return;
    }
    if (this.bot) {
      this.botClick(x, y);
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
    this.actAt(p, x, y);
  }

  /**
   * What a click on a tile does with a tool (the cursor path), and what bloombot does when it acts on a tile.
   * `x, y` is where on screen to show a failure. Returns what happened, for bloombot's animation.
   */
  private actAt(p: Pick, x: number, y: number, tool: Tool = this.hud.currentTool, hover = true): ActResult {
    if (!p.tile) return 'none';
    const roof = this.sim.grid.roof(p.roofId)!;
    if (roof.preview) {
      this.hud.showFail(this.lockedReason(roof.id), x, y);
      return 'none';
    }
    const t = p.tile;
    const dk = decorType(tool);
    if (dk) return this.placeDecorAt(p, x, y, dk);
    if (tool === 'remove') return this.removeDecorAt(p, x, y, false);
    const st = superType(tool);
    if (st) {
      const a = this.sim.supers.anchorFor(st, p.fx, p.fz);
      if (!this.inReach(p.roofId, a.x, a.z, TIER3[st]!.size)) {
        this.hud.showFail(TOO_FAR, x, y);
        return 'none';
      }
      if (this.cozy.plotUnder(p.roofId, a.x, a.z, TIER3[st]!.size)) {
        this.hud.showFail(PLOT_IN_WAY, x, y);
        return 'none';
      }
      const m = this.sim.supers.place(st, p.roofId, a.x, a.z);
      if (m) {
        this.selectTool('pulse');
        this.select(m.id);
      }
      return m ? 'build' : 'none';
    }
    if (machineTool(tool)) {
      const bt = tool;
      const a = this.sim.build.anchorFor(bt, p.fx, p.fz);
      if (!this.inReach(p.roofId, a.x, a.z, MACHINES[bt].size)) {
        this.hud.showFail(TOO_FAR, x, y);
        return 'none';
      }
      if (this.cozy.plotUnder(p.roofId, a.x, a.z, MACHINES[bt].size)) {
        this.hud.showFail(PLOT_IN_WAY, x, y);
        return 'none';
      }
      const m = this.sim.build.place(bt, p.roofId, a.x, a.z);
      if (m) {
        this.selectTool('pulse');
        this.select(m.id);
      }
      return m ? 'build' : 'none';
    }
    const occ = this.sim.occupant(t);
    if (occ && this.mergeSel) {
      const plan = this.sim.merge.plan(this.mergeSel.anchor, this.mergeSel.partners);
      if (occ.id === this.mergeSel.anchor || (plan && plan.partners.some((p) => p.id === occ.id))) return 'none';
      const ids = plan && this.sim.merge.swap(plan, occ.id);
      if (ids) {
        this.mergeSel = { anchor: this.mergeSel.anchor, partners: ids };
        this.sfx.click();
        this.showMergeHighlights();
        this.renderInspect();
        return 'select';
      }
    }
    if (occ) {
      if (occ.type === 'core' && this.landmarkReady(occ)) {
        this.wakeLandmark(occ);
        return 'wake';
      }
      this.select(occ.id);
      return 'select';
    }
    if (tool === 'inspect') {
      this.select(undefined);
      return 'none';
    }
    this.select(undefined);
    if (this.cozy.decorOf(t.occupantId)) {
      // E19.2: like a machine's tile, a decoration's isn't pulsed (Q picks it up)
      this.hud.showFail(this.bot ? `A decoration stands here: ${this.hudKey('interact')} picks it up` : 'A decoration stands here', x, y);
      return 'none';
    }
    const ok = this.sim.restoration.pulse(t.id);
    if (hover) this.onHover(x, y);
    return ok ? 'pulse' : 'none';
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
      case 'cultivator': // Look 6.8: its work radius (wider with Fog Seeker)
        return g.tilesNear(m, 'id' in m ? this.sim.cultivators.radius(m as MachineData) : TUNING.cultivator.radius);
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
        ? `<span class="ok">✨ Beside your ${yours}: merge ${TUNING.merge.count} ${name}s here (this one too) and the new ${t2.name} completes a ${t3.icon} ${t3.name} core</span><br>`
        : `✨ Beside your ${yours}: merge ${TUNING.merge.count} ${name}s here (this one too) and ${TUNING.merge.count} touching ${t2.name}s make a ${t3.icon} ${t3.name} core<br>`)
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
    const swap = plan.options.length > 2 ? `<p>Pick another highlighted ${esc(plan.fromName)} to swap it in.</p>` : '';
    return (
      `<div class="merge"><b>🔀 ${TUNING.merge.count} × ${esc(plan.fromName)} → ${t2.icon} ${esc(plan.toName)}</b>` +
      `<p class="gain">Output ${plan.before} → ${plan.after} (+${Math.round((plan.after / plan.before - 1) * 100)}%) · ${esc(t2.blurb)}</p>` +
      `<p>💰 ${plan.free ? 'Free: your first ' + esc(plan.fromName) + ' merge' : 'Fee ' + formatCost(plan.fee)} · 🧩 Frees ${freed} tile${freed === 1 ? '' : 's'}</p>` +
      (plan.core ? `<p>✨ All three leave the grid as a Superstructure Core: place it anywhere (${TIER3[m.type]!.size}×${TIER3[m.type]!.size}), then build it in three stages.</p>` : '') +
      lost +
      this.mergeRolesText(plan) +
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

  /** E18: what a drone of this role is doing, in words. */
  private droneLabel(role: DroneRole, status: 'working' | 'travelling' | 'napping' | 'waitingEnergy'): string {
    const work: Record<DroneRole, string> = {
      restorer: 'restoring a tile',
      gardener: 'watering tiles',
      scout: 'pushing back the fog',
      courier: 'delivering charge',
      spark: 'sparking a chain',
      harvester: 'harvesting lost income',
    };
    const idle: Record<DroneRole, string> = {
      restorer: 'napping — nothing to do in range',
      gardener: 'napping — nothing in reach can grow',
      scout: 'napping — nothing left to restore in reach',
      courier: 'napping — no machine needs charge yet',
      spark: 'resting — one chain per 30 s, or no garden cluster in reach',
      harvester: 'resting — no store is full',
    };
    const wait = role === 'gardener' || role === 'courier' ? 'waiting for water 💧 or energy ⚡' : 'waiting for energy ⚡';
    return status === 'working' ? work[role] : status === 'travelling' ? 'flying to a job' : status === 'napping' ? idle[role] : wait;
  }

  /**
   * E18: the hub's role picker: every role with its icon, one-line job and refit price, "Owned" or why it's locked.
   * A Fleet Hub has a second slot (half its drones); a Megahub can set each drone's role.
   */
  private rolePicker(m: MachineData): string {
    const s = this.sim;
    const r = s.roles;
    const row = (slot: number, current: DroneRole) =>
      ROLES.map((role) => {
        const st = r.check(m.id, role, slot);
        const owned = r.owns(m, role);
        const on = role === current;
        const note = on ? 'In use' : owned ? 'Owned' : st.reason && !st.reason.startsWith('Need ') ? esc(st.reason) : formatPriceHtml(st.price, s.econ.shortfall(st.price));
        return `<button class="role-btn${on ? ' on' : ''}" data-role="${m.id}|${role}|${slot}" ${on || (!owned && !st.ok) ? 'disabled' : ''} aria-pressed="${on}" title="${esc(ROLE_INFO[role].job)}"><span class="ri">${ROLE_INFO[role].icon}</span><span class="rn">${ROLE_INFO[role].name}</span><span class="rp">${note}</span></button>`;
      }).join('');
    const tier = m.tier ?? 1;
    const current = r.roleOf(m);
    let html = `<div class="roles"><p class="rh">Role${tier >= 2 ? ' · slot 1' : ''}: <b>${ROLE_INFO[current].icon} ${ROLE_INFO[current].name}</b> — ${esc(ROLE_INFO[current].job)}</p><div class="role-row">${row(1, current)}</div>`;
    if (tier === 2) {
      const second = m.role2 ?? current;
      html += `<p class="rh">Slot 2 (half the drones): <b>${ROLE_INFO[second].icon} ${ROLE_INFO[second].name}</b></p><div class="role-row">${row(2, second)}</div>`;
    }
    if (tier >= 3) {
      const ds = s.state.drones.filter((d) => d.hubId === m.id).slice(0, TUNING.super.megahub.drones);
      html += ds
        .map((_d, i) => {
          const mine = m.droneRoles?.[i] ?? undefined;
          const opts = ROLES.filter((x) => r.owns(m, x) || r.check(m.id, x).ok)
            .map((x) => `<button class="role-btn mini${mine === x ? ' on' : ''}" data-role="${m.id}|${x}|drone|${i}" ${mine === x ? 'disabled' : ''} title="${ROLE_INFO[x].name}">${ROLE_INFO[x].icon}</button>`)
            .join('');
          return `<p class="rh">Drone ${i + 1}: ${mine ? ROLE_INFO[mine].name : 'hub role'} ${mine ? `<button class="role-btn mini" data-role="${m.id}|-|drone|${i}">↺</button>` : ''}</p><div class="role-row">${opts}</div>`;
        })
        .join('');
    }
    const reach = current === 'scout' ? r.scoutReach(m) : s.upgrades.droneRadius(m);
    html += `<p>Works within ${reach} tiles (highlighted). ${esc(ROLE_INFO[current].upgrades)}. A new role is a one-time refit; switching back to a role this hub owns is free.</p></div>`;
    return html;
  }

  /** E18.8: what a hub merge does to roles, said before confirming. */
  private mergeRolesText(plan: MergePlan): string {
    const r = plan.roles;
    if (!r) return '';
    const name = (x: DroneRole) => `${ROLE_INFO[x].icon} ${ROLE_INFO[x].name}`;
    const owned = r.owned.length ? ` · keeps refits: ${r.owned.map((x) => ROLE_INFO[x].name).join(', ')}` : '';
    if (plan.core) return `<p>🛸 The Megahub keeps ${name(r.slot1)}${owned}; set each of its drones' roles once it's built.</p>`;
    return `<p>🛸 Roles: slot 1 ${name(r.slot1)}${r.slot2 ? `, slot 2 ${name(r.slot2)} (half the drones each)` : ' (all drones)'}${owned}</p>`;
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
    return `<div class="card" style="margin-top:8px"><span class="ci">${def.icon}</span><span class="cn">${def.name} <em>Lv ${lvl}</em></span><button class="buy" data-buy="${id}|${m.id}" ${st.ok ? '' : 'disabled'}>${formatPriceHtml(st.price, u.short(st))}</button>${allBtn}<span class="cd2">${def.describe(lvl + 1)}</span></div>`;
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
        extra = ds
          .map((d, i) => {
            const role = s.roles.roleFor(d, m);
            return `<p class="stat">${ROLE_INFO[role].icon} Drone ${i + 1}${d.expiresAt ? ' (party!)' : ''}: ${this.droneLabel(role, s.drones.statusOf(d))} · ${d.jobs} jobs</p>`;
          })
          .join('') +
          this.rolePicker(m) +
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
    if ((m.overchargeUntil ?? 0) > s.time) extra = `<p class="stat boost">⚡ Boosted by your pulse — next trigger +1 (${Math.ceil(m.overchargeUntil! - s.time)} s)</p>` + extra;
    this.hud.renderInspect(this.hud.machineHtml(m, extra));
  }

  // ───────────────────────── events → presentation ─────────────────────────

  private tileScreen(tileId: string): { x: number; y: number } | undefined {
    const t = this.sim.grid.byTileId(tileId);
    if (!t) return undefined;
    const [x, y, z] = this.sim.grid.tileWorld(t);
    // Behind the camera or far off screen: the number flies from the default spot instead.
    const s = this.camera.onScreen(new pc.Vec3(x, y + 0.3, z), 0);
    return s && { x: s.x, y: s.y };
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
      if (areaId !== PARK) this.hud.toast(`✨ ${s.areas.info(areaId).landmarkName} is ready to wake!<small>Walk up and press ${this.hudKey('interact')} to clear this ${AREA_TYPES[s.areas.info(areaId).type].name.toLowerCase()}'s fog.</small>`, 'gold', 4);
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
        this.vfx.burst(p, 8, { up: 1.1, speed: 1.6, size: 0.045, life: 0.6, hex: PALETTE.debris });
        if (!this.settings.reducedMotion) this.camera.shake(0.035);
        this.sfx.at(p, (q) => q.pulse());
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
      this.vfx.restoreBloom(p, manual ? 1 : 0.6); // Look 3.14: sparkles, a shockwave and drifting petals
      // Drone redesign D05: a drone's restore ends in a small bloom burst (petals above, plus a cyan puff and a
      // leaf-green ring). Visual only: the reward was paid by the sim.
      if (source === 'drone') {
        this.vfx.burst(p, 4, { up: 1.3, speed: 0.8, size: 0.04, life: 0.7, hex: PALETTE.eyeCyan });
        this.vfx.ring(p, PALETTE.leafFin, 1.0, 0.6);
      }
      if (manual && this.clock - this.lastRestoreSound > 0.06) {
        this.lastRestoreSound = this.clock;
        this.sfx.at(p, (q) => q.restored(this.restoreSoundIdx++));
      }
      for (const n of s.grid.neighbors(tile)) this.grid.refresh(n, true); // neighbours may have softened
      if (this.selected) this.inspectTimer = 0;
    });
    b.on('tile.softened', ({ tile }) => this.tileFx.flash(tile, '#7fcf5a', 0.22, 0.5, 0.1));
    // Look 6.10: a tap on a tile mid-process: a satisfying knock (crack burst, a tiny shake, a crack sound).
    b.on('tile.knocked', ({ tile }) => {
      const p = this.tileVec(tile);
      this.vfx.burst(p, 7, { up: 1.2, speed: 1.2, size: 0.04, life: 0.5, hex: PALETTE.debris });
      this.vfx.ring(p, '#c8ffa8', 0.6, 0.25);
      if (!this.settings.reducedMotion) this.camera.shake(0.02);
      this.sfx.at(p, (q) => q.stage('crack'));
    });
    // Look 6.10: each restore stage has its own sound as it plays (rate-limited, so chains layer, never roar).
    const stageSounds = (tile: TileData) => {
      const tr = tile.tr;
      if (!tr || tr.k !== 'restore' || Math.abs(tr.t0 - s.time) > 0.3) return;
      const now = performance.now();
      if (now - this.stageSoundAt < 150) return;
      this.stageSoundAt = now;
      const S = TUNING.transitions.restoreStages;
      const at = (share: number, kind: Parameters<typeof this.sfx.stage>[0]) => this.tweens.add(0.01, () => {}, { delay: Math.max(0, tr.t0 + tr.d * share - s.time), done: () => this.sfx.at(this.tileVec(tile), (q) => q.stage(kind)) });
      at(0, 'crack');
      at(S.heave[0] + 0.02, 'grind');
      at(S.heave[0] + 0.1, 'creak');
      at(S.crumble[0] + 0.05, 'thud');
      at(S.sprout[0] + 0.02, 'sprout');
      at(S.knit[0] + 0.05, 'rustle');
    };
    b.on('tile.restoring', ({ tile }) => stageSounds(tile));
    b.on('tile.restored', ({ tile, source }) => source !== 'pulse' && source !== 'broad' && stageSounds(tile));
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
      this.sfx.at(p, (q) => q.nurture(level));
    });
    b.on('resource.gain', ({ kind, amount, tileId, reason }) => {
      if (amount.lt(0.05)) return;
      let from = tileId ? this.tileScreen(tileId) : undefined;
      if (!from && reason === 'cat') {
        const c = this.cat.targetWorld(this.claimingCat) ?? this.lastCatPos;
        const sp = c && this.camera.onScreen(c, 0);
        if (sp) from = { x: sp.x, y: sp.y };
      }
      if (!from && reason === 'harvest') {
        const panel = s.state.machines.find((m) => m.type === 'solar');
        if (panel) {
          const w = this.machines.worldOf(panel);
          const sp = this.camera.onScreen(new pc.Vec3(w[0], w[1] + 0.6, w[2]), 0);
          if (sp) from = { x: sp.x, y: sp.y };
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
      this.sfx.at(p, (q) => q.build());
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
        this.sfx.at(p, (q) => q.build());
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
      if (areas >= 6 && !potterPace(this.settings)) this.hud.toast(`🌸 A city-wide bloom! ×${combo}<small>It swept across ${areas} areas.</small>`, 'gold', 3);
      this.tileFx.release(`chain${chainId}`);
      if (crossings > 0) this.hud.feed(`📡 Chain crossed ${crossings} Bloom Relay link${crossings > 1 ? 's' : ''}`);
      if (combo < 2) return;
      const ms = milestonePct ? ` · ×${combo >= 20 ? 20 : combo >= 10 ? 10 : 5} milestone +${Math.round(milestonePct * 100)}%` : '';
      this.hud.combo(combo, `+${fmt(total)}🌿${energy.gte(1) ? ` +${fmt(energy)}⚡` : ''} earned${ms}`);
      this.hud.feed(`🌸 Bloom chain ×${combo}${bonus.gte(1) ? ` · +${fmt(bonus)}🌿 bonus` : ''}`);
      this.sfx.chainEnd(combo);
      if (combo >= 5 && !potterPace(this.settings)) {
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
    b.on('drone.jobStarted', ({ droneId }) => {
      const d = s.state.drones.find((x) => x.id === droneId);
      const w = d && this.sim.drones.worldOf(d);
      this.sfx.at(w && { x: w[0], y: w[1], z: w[2] }, (q) => q.drone(d?.role));
    });
    b.on('drone.roleChanged', () => {
      this.drones.sync(); // drones between jobs take their new look now; the rest as they finish
      this.renderInspect();
    });
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
      this.sfx.at(p, (q) => q.meow());
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
    b.on('buff.started', ({ seconds }) => this.hud.feed(`☀️ Solar Surge ×${TUNING.cat.frenzyMult} for ${Math.round(seconds)}s`));
    b.on('harvest', () => this.sfx.coin());
    b.on('rooftop.coreReady', () => {
      this.machines.setCoreState('ready');
      this.hud.toast(`✨ The Rooftop Core is humming!<small>Walk up and press ${this.hudKey('interact')} (or use the button) to awaken the building.</small>`, 'gold', 5);
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
      this.sfx.at(p, (q) => q.pulse());
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
      if (tr) this.hud.chainBreakdown(this.chainSummary.breakdown(tr.chainId)); // Look 5.5: the combo panel's lines
    }
    if (!tr || tr.total < 20 || this.frontAt > 0 || this.settings.reducedMotion) return;
    this.frontAt = 0.3;
    this.vfx.ring(new pc.Vec3(tr.fx, 0.12, tr.fz), tr.total >= 100 ? '#ff5fb8' : '#ffd25e', 3.2, 0.6);
  }

  private presentChainEvent(ev: ChainEvent, combo: number) {
    const s = this.sim;
    // Camera follows big chains (setting): glide toward the wave front now and then, never against the player.
    if (this.settings.followChains && !potterPace(this.settings) && combo >= 20 && !this.cinematic) {
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
        this.sfx.at(this.tileVec(t), (q) => q.bloom(combo));
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
        this.sfx.at(t && this.tileVec(t), (q) => q.bloom(combo));
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
        this.sfx.at(to, (q) => q.pulse());
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
        // Look 4.6: never behind the camera or past the haze; sized by distance close up.
        const sp = this.camera.onScreen(new pc.Vec3(a.landmark[0] + 1, 2.4, a.landmark[1] + 1), 50);
        if (!sp) continue;
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
        this.hud.worldLabel(key, html, sp.x, sp.y, ready || zoomedOut, zoomedOut ? 1 : sp.scale);
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
    this.bot?.visuals.play('cheer');
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
    } else if (this.slowFor > 3 && (this.settings.gfx ?? 'auto') === 'auto' && !urlTier() && !this.deck && this.gfxTier !== 'low') {
      // Look 1.11: already at the lowest resolution and still slow: Auto steps down a graphics tier.
      this.autoTier = lowerTier(this.gfxTier);
      this.applySettings();
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
    if (!this.paused && !this.hiddenPause && !this.hud.modalOpen && !this.photo.frozen) {
      if (rawDt > TUNING.maxFrameDt && !this.hiddenAt) this.awayFor(Math.min(rawDt, 30) - TUNING.maxFrameDt); // a hitch
      this.runSim(dt);
    }
    this.tweens.update(dt);
    this.scene.update(dt);
    this.grid.update(dt);
    const rect = view;
    if (rect) this.grid.stream(rect);
    this.transitions.sync(this.sim.time + Math.min(this.acc, TUNING.simStep));
    if (rect) this.chunks.update(dt, rect, this.camera.target, this.camera.zoom);
    detailTextures.step(); // Look 3.1: builds the detail maps a slice per frame after first paint
    const camP = this.camera.entity.getPosition();
    detailTextures.setCamera(camP.x, camP.y, camP.z);
    this.machines.update(dt, rect);
    this.tillers.update(this.paused || this.hiddenPause || this.photo.frozen ? 0 : dt);
    this.rings.update(this.camera.zoom, this.camera.target);
    // Look 6.10: a working tiller near the view hums.
    if (!this.paused && this.camera.zoom > 0.9) {
      const f = this.camera.target;
      const tiller = this.sim.cultivators.working().find((t) => Math.abs(t.x - f.x) < 10 && Math.abs(t.z - f.z) < 8);
      if (tiller) this.sfx.at(this.tileVec(tiller), (q) => q.stage('hum'));
    }
    // 3D audio: the listener rides the camera; the brook sits at the clean water near the view.
    const camE = this.camera.entity;
    this.sfx.setListener(camE.getPosition(), camE.forward, camE.up);
    this.brookScan -= dt;
    if (this.brookScan <= 0) {
      this.brookScan = 0.25;
      this.placeBrook();
      this.placeBirds();
    }
    this.drones.update(this.paused || this.hiddenPause || this.photo.frozen ? 0 : dt); // drone personality freezes with the game
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
    this.pollinators.enabled = !this.settings.reducedMotion && !ChunkRenderer.still;
    this.pollinators.quality = quality;
    this.pollinators.update(dt, near);
    this.birds.resident = eco.has('birds');
    this.clouds.happy = eco.has('birds'); // the sky wakes up with the songbirds: sleepy faces on a couple of clouds
    this.birds.update(dt, this.camera.goalPoint, this.sim.progression.parkStage() >= 2 || this.birds.resident);
    this.fauna.update(dt, near, { quality, reducedMotion: this.settings.reducedMotion, fireflies: !!this.settings.fireflies && !this.settings.highContrast });
    this.eco?.update(dt);
    this.tileFx.update(dt);
    this.frameNo++;
    this.updateChainPresentation(dt);
    if (!this.cinematic) this.checkCozyUnlocks();
    this.vfx.update(dt);
    // First-tile beacon until the player restores something.
    if (this.sim.state.progression.tutorialStep === 0 && !this.hud.introOpen && !this.cinematic && !this.photo.active) {
      const tiles = this.sim.progression.tilesFor(HOME);
      const t = tiles.find((x) => x.ground === 'prepared' && !x.occupantId) ?? tiles.find((x) => x.ground === 'polluted' && !x.blocked && !x.occupantId);
      if (t) this.overlays.showBeacon(t.roofId, t.x, t.z);
    } else this.overlays.hideBeacon();
    this.overlays.update(dt);
    if (this.bot) {
      this.bot.update(this.hiddenPause ? 0 : dt);
      this.photo.update(dt);
      this.updateBotZoom();
      this.updateBotPreview();
      this.minimap?.update(dt, this.bot.pose);
      const [cx, cy, cz] = this.bot.world();
      this.drones.companion = { x: cx, y: cy, z: cz, facing: this.bot.pose.facing };
    }
    this.camera.update(dt);
    this.sky.clarity += (this.skyClarity() - this.sky.clarity) * Math.min(1, dt * 0.8);
    this.sky.reducedMotion = this.settings.reducedMotion;
    this.sky.update(dt, this.camera.entity.getPosition(), this.camera.cam.farClip);
    this.skyline.clarity = this.sky.clarity;
    this.skyline.reducedMotion = this.settings.reducedMotion;
    this.skyline.update(dt, this.camera.target, this.camera.entity.getPosition(), this.camera.dist, this.camera.nearness(), this.camera.yaw, this.camera.hazeEnd, this.camera.cam.farClip);
    this.syncView();
    {
      const c = this.camera;
      const cv = this.app.graphicsDevice.canvas as HTMLCanvasElement;
      this.clouds.update(dt, { zoom: c.zoom, yaw: c.yaw, dist: c.dist, viewHeight: c.viewHeight, aspect: cv.clientWidth / Math.max(1, cv.clientHeight), position: c.entity.getPosition(), forward: c.entity.forward });
    }
    this.updateMood(dt);
    this.look.update(dt);
    this.updateTreeCursor(dt);
    this.hud.update(dt);
    const restored = this.sim.progression.restoredCount(HOME);
    this.sfx.layers = Math.min(3, Math.floor(restored / 12));
    this.sfx.life = Math.min(1, restored / 48);
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
        const spots = this.sim.cat.spots();
        // The hint meow comes from where a cat actually hides, so a listener can turn toward it.
        this.sfx.at(this.cat.targetWorld(spots[Math.floor(Math.random() * spots.length)].id), (q) => q.meow(true));
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
  lines.push(`<small>Your garden kept growing at half pace${capped}: ${got.join(' ') || 'nothing new'}${r.droneJobs ? ` · drones restored ${r.restored} and nurtured ${r.grown} tiles` : ''}${r.cultivated ? ` · your cultivators broke up ${r.cultivated} slab${r.cultivated === 1 ? '' : 's'}` : ''}${lost.length ? ` · ${lost.join(' ')} didn't fit in storage` : ''}</small>`);
  return lines.join('');
}

/** A superstructure's locked stage price (saved as strings) as a cost. */
function fromCostStrings(c: Partial<Record<ResourceKind, string>>): import('../core/types').Cost {
  const o: import('../core/types').Cost = {};
  for (const k of ['energy', 'water', 'biomass'] as const) if (c[k] !== undefined) o[k] = big(c[k]);
  return o;
}

/** E20.1: a rough direction in words, north up as on the minimap (north is -z, east is +x). */
export function compass(dx: number, dz: number): string {
  if (Math.hypot(dx, dz) < 2) return 'right here';
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return names[((Math.round(deg / 45) % 8) + 8) % 8];
}
