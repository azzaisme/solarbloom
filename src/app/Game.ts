import { CHUNK } from '../core/Hash';
import { POWER } from '../data/power';
import { HOME } from '../gameplay/ProgressionSystem';
import * as pc from 'playcanvas';
import { BIRD_VOICES, Sfx } from '../audio/Sfx';
import { treeSpot, treeStage } from '../rendering/TreePlacement';
import { PARK } from '../core/Areas';
import { createInitialState, GROUND } from '../core/GameState';
import { AREA_TYPES } from '../data/city';
import { distToFootprint } from '../core/Grid';
import type { DroneRole, LayerData, MachineData, TileData } from '../core/types';
import { MACHINES, machineIcon, machineName } from '../data/machines';
import { MATERIALS, SALVAGE, TIERS } from '../data/salvage';
import { GATHER } from '../data/farm';
import { CROPS } from '../data/crops';
import { EXPLORE } from '../rendering/CameraController';
import { OLD_CITY, PARK_SET, REGIONS } from '../data/oldcity';
import { seaCell, setPieceAt } from '../core/OldCityLayout';
import { TUNING } from '../data/tuning';
import { LOAD_WHEEL, RIPPLE } from '../data/pulse';
import { REST } from '../data/rest';
import { Resting } from './Resting';
import { UPGRADE_BY_ID } from '../data/upgrades';
import type { ChainEvent } from '../gameplay/BloomChainSystem';
import { CAT_REWARD_NAMES } from '../gameplay/LuckyCatSystem';
import { Sim } from '../gameplay/Sim';
import { inSurge } from '../gameplay/PowerEnv';
import { Butterflies } from '../rendering/Butterflies';
import { Birds } from '../rendering/Birds';
import { Clouds } from '../rendering/Clouds';
import { CloudWall } from '../rendering/CloudWall';
import { Fauna } from '../rendering/Fauna';
import { EcoBadge } from '../ui/EcoBadge';
import { createModels } from '../rendering/Models';
import { CameraController } from '../rendering/CameraController';
import { setLeafTier, setTreeCursor } from '../rendering/Foliage';
import { detailTextures } from '../rendering/DetailTex';
import { Pollinators } from '../rendering/Pollinators';
import { CatVisuals } from '../rendering/CatVisuals';
import { DroneVisuals } from '../rendering/DroneVisuals';
import { WaterLevels } from '../rendering/WaterLevels';
import { ChunkRenderer, MeshBuilder, SINK } from '../rendering/ChunkRenderer';
import { MACHINE_MODELS } from '../rendering/MachineVisuals';
import type { HoloShape } from '../rendering/Hologram';
import { TransitionRenderer } from '../rendering/transitions/TransitionRenderer';
import { CultivatorVisuals } from '../rendering/CultivatorVisuals';
import { CropVisuals } from '../rendering/CropVisuals';
import { ProgressRings } from '../rendering/transitions/ProgressRings';
import { areaPanelHtml } from '../ui/AreaPanel';
import { upgradeHighlights } from '../gameplay/UpgradeEffects';
import { GridRenderer } from '../rendering/GridRenderer';
import { InputController } from '../rendering/InputController';
import { MachineVisuals } from '../rendering/MachineVisuals';
import { PALETTE } from '../rendering/Materials';
import { Overlays } from '../rendering/Overlays';
import { PowerLines } from '../rendering/PowerLines';
import { PowerOverlay } from '../rendering/PowerOverlay';
import { LightVisuals } from '../rendering/LightVisuals';
import { LIGHT, LIGHTING } from '../data/lights';
import { SceneBuilder, SLAB_TOP } from '../rendering/SceneBuilder';
import { Sky } from '../rendering/Sky';
import { Skyline } from '../rendering/Skyline';
import { CLOSE_VIEW_REACH, HAZE } from '../data/sky';
import { droneTapRadius, pickDrone, pickLayers, pickTerraced } from '../core/Picking';
import { heightAt, levelY } from '../core/Height';
import { ChainSummary, VfxBudget } from '../ui/ChainSummary';
import { relayLinkId } from '../gameplay/RelaySystem';
import { initLowPoly } from '../rendering/Shapes';
import { LookController } from '../rendering/LookController';
import { DECK, detectTier, lowerTier, onSteamDeck, urlDeck, urlTier, type GfxSetting } from '../rendering/Quality';
import type { GfxTier } from '../data/look';
import { TileFx } from '../rendering/TileFx';
import { Tweens } from '../rendering/Tween';
import { Vfx } from '../rendering/Vfx';
import { decorType, Hud, machineTool, type Settings, type Tool } from '../ui/Hud';
import { BOT } from '../gameplay/Walker';
import { ROLE_INFO, ROLES } from '../gameplay/DroneRoles';
import { EventBus } from './EventBus';
import { BotController } from './BotController';
import { type Action, Bindings, type Context, FIXED_KEY, keyLabel, migrateBindings, SLOTS } from './Bindings';
import { type Candidate, holdFor, pickTarget, promptText } from './Interact';
import type { PromptModel } from '../ui/Prompt';
import { Pause, runSimFrame } from './Pause';
import { Menu, type MenuHeader, type MenuItem } from '../ui/Menu';
import { type SettingKey, SettingsScreen } from '../ui/SettingsScreen';
import { settingsRows } from '../ui/SettingsRows';
import { BloombotVisuals } from '../rendering/BloombotVisuals';
import { Minimap } from '../ui/Minimap';
import { PadFocus } from '../ui/PadFocus';
import { OldCityController } from './OldCity';
import { KeeperVisuals } from '../rendering/KeeperVisuals';
import { Cozy } from '../gameplay/Cozy';
import { DECOR_GEN, DECOR_OPTION, DECOR_OPTIONS, PLOT_OPTIONS } from '../data/cozy';
import { chunkKey } from '../core/Grid';
import type { Decoration } from '../core/Decor';
import type { PlotSpot } from '../core/Plots';
import { type LoadResult, SaveService, type Slot } from './SaveService';
import { Loading, type LoadSteps } from '../ui/Loading';
import { ModelLibrary, useModels } from '../rendering/Models';
import { calmHud, parseSettings, potterPace, SETTINGS_KEY } from './Settings';
import { padStick, PhotoMode } from './PhotoMode';
import { PHOTO_FILTERS } from '../data/photo';
import { sceneNow } from './PhotoScene';
import { daylightAt } from '../gameplay/Clock';
import { GLOOMY } from '../gameplay/PowerEnv';
import { DayNight, type LightMoment } from '../rendering/DayNight';
import { NightFindVisuals } from '../rendering/NightFindVisuals';
import { NIGHT_FIND_GIVES } from '../data/time';
import { WEATHER, WEATHER_WORDS } from '../data/weather';
import { WeatherVisuals, type WeatherLook } from '../rendering/WeatherVisuals';
import { buildRadio } from '../rendering/HouseRadio';
import { PhotoBar, saveCanvasPng } from '../ui/PhotoBar';
import { HOTBAR_DEFAULT } from '../ui/Hotbar';
import { actionGlyph, GlyphTracker, padName, type PadStyle } from '../ui/Glyphs';
import { ControlsTable } from '../ui/ControlsTable';
import { crateName } from '../ui/CratePanel';
import { materialIcon } from '../ui/MaterialIcons';
import { AUTOMATION } from '../data/automation';
import { itemDef } from '../data/items';
import { pinNext } from '../ui/BackpackModel';
import { LOOK } from '../data/look';

const BLOOM_NAMES = ['', 'Fresh grass', 'Wildflowers', 'Thriving (full bloom)', 'Radiant'];
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Bloombot: the camera zoom of the close default view (G.3), and how near counts as "within reach". */
const BOT_ZOOM = 3.2;
/** E22.1: while a panel is open, these walking actions still reach the game (they close the panel they opened). */
const PANEL_TOGGLES = new Set<Action>(['backpack', 'map', 'buildMenu', 'menu']);
/**
 * E19.2 (#245, "Building and placing"): build mode is Satisfactory-style. With something to build in hand (a
 * machine, a core, a decoration) the camera stays in the close view; a hologram sits where you aim, snapped to the
 * grid, within DECOR_GEN.reach tiles of bloombot, red where it can't go. Third person: the aim is the crosshair in
 * the middle of the screen (`crosshairPick`), for mouse and pad alike. Only the cursor view (no bloombot) aims with
 * the pointer, while it is over the world and was moved in the last MOUSE_AIM_MS.
 */
const MOUSE_AIM_MS = 8000;
/** the shortest time between two quarter turns from the mouse wheel (a trackpad sends many small wheel events) */
const WHEEL_TURN_MS = 140;
/** Bloombot: how far in the camera may come (the cursor view stops at 1.9). */
const BOT_MAX_ZOOM = 4.3; // E21.22: the close step (EXPLORE.zoomSteps[0])
const BOT_REACH = 1.6;
/** Bloombot is the game; `?cursor=1` keeps the old click-to-act play for tests that drive tiles directly. */
const botMode = () => typeof location === 'undefined' || new URLSearchParams(location.search).get('cursor') !== '1';
type ActResult = 'pulse' | 'build' | 'select' | 'wake' | 'none';

/** E22.2: an Interact target with what it does, where it is, and the outline to draw round it. */
interface InteractTarget extends Candidate {
  run: () => void;
  /** E21: a hold the Old City controller runs itself (salvage 0.6 s, pry 2 s) */
  ocHold?: number;
  at?: TileData;
  frame?: { roofId: string; x: number; z: number; size: number };
}

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

/** E21: what dead ground is called in the Old City, by its feature */
const OLD_DEAD_NAME: Record<string, string> = { sand: 'Dead sand', paving: 'Cracked paving', road: 'Cracked road', lawn: 'Dead grass', litter: 'Dead leaf litter', clay: 'Cracked clay', water: 'Murky water' };

export class Game {
  readonly app: pc.Application;
  readonly bus = new EventBus();
  /** E22.12: this game's save slot */
  readonly saver: SaveService;
  readonly sim: Sim;
  readonly tweens = new Tweens();
  readonly scene: SceneBuilder;
  /** Look 1: lighting, post-processing and graphics quality. */
  readonly look: LookController;
  readonly camera: CameraController;
  private sky!: Sky;
  /** E23.7.1: day and night on screen (the light clock, or photo mode's own time) */
  private dayNight!: DayNight;
  /** E23.7.1.2: the title's "follow my clock" preference (new gardens), kept apart from the save's mode */
  private titleRealClock?: boolean;
  /** E23.7.1.3: glowing plants and night salvage */
  private nightFindVisuals!: NightFindVisuals;
  /** E23.7.2: rain, storms, fog and wind on screen */
  private weatherVisuals!: WeatherVisuals;
  private skyline!: Skyline;
  readonly grid: GridRenderer;
  /** The city ground (streamed chunk meshes + fog). */
  readonly chunks: ChunkRenderer;
  /** E23.4.1: water levels drawn on the water (the drained bed) */
  readonly waterLevels: WaterLevels;
  /** Look 6.12: living transitions (every tile change plays as a process). */
  readonly transitions: TransitionRenderer;
  /** Look 6.9: Cultivator tillers. */
  readonly tillers: CultivatorVisuals;
  /** E23.5.2: what grows in each planter. */
  readonly crops: CropVisuals;
  /** E23.3: the grid's cables. */
  readonly powerLines: PowerLines;
  /** E23.3.4: the Power overlay (build mode). */
  readonly powerOverlay: PowerOverlay;
  /** E23.3.5: night lights' glows, ground pools and insects. */
  readonly lightVisuals: LightVisuals;
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
  /** region unlocks: the wall of clouds around sealed areas */
  private cloudWall: CloudWall;
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
  readonly sfx = new Sfx();
  settings: Settings;

  /** simulated seconds not yet ticked (runSimFrame) */
  acc = 0;
  /** E22.11: one pause with reasons (menu, panel, blur, sleep, padLost); nothing in the world moves while set */
  readonly pause = new Pause();
  get paused(): boolean {
    return this.pause.paused;
  }
  /** Tools and tests freeze the game this way (no menu). */
  set paused(v: boolean) {
    this.pause.set('menu', v);
  }
  /** E22.11: the in-game menu and the shared Settings screen */
  menu!: Menu;
  settingsUi!: SettingsScreen;
  private padFocus?: PadFocus;
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
  private keyMapShown = '';
  /** E22.3: which glyph set is on screen (the setting, the last device used, the pad's family) */
  readonly glyphs = new GlyphTracker();
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
  /** E21: the Old City's panels and held actions */
  private oc?: OldCityController;
  /** E21.8: the Keepers */
  private keepers?: KeeperVisuals;
  /** E23.2.3: sitting on benches and meditating at chargers */
  private resting?: Resting;
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

  constructor(canvas: HTMLCanvasElement, lr: LoadResult = new SaveService().loadResult(), opts: { slot?: Slot; device?: 'keys' | 'pad'; realClock?: boolean } = {}) {
    this.saver = new SaveService(undefined, opts.slot ?? 1);
    this.saver.headerExtra = () => ({ region: this.regionName() });
    this.startDevice = opts.device ?? 'keys';
    this.settings = loadSettings();
    this.titleRealClock = this.settings.realClock;
    const loaded = lr.state;
    // E23.1.1: one rule set. Every new game is the Old City.
    const state = loaded ?? createInitialState(undefined);
    this.sim = new Sim(state, this.bus);
    // E23.7.1.2: a new game's choice of day (the game's own, or the real clock's); Settings shows the save's
    if (!loaded && opts.realClock) this.sim.clock.real = true;
    this.settings.realClock = this.sim.clock.real;

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
    this.dayNight = new DayNight(this.app, this.scene, this.sky);
    this.look.atmosphere.isLit = (x, z) => this.sim.grid.get(GROUND, x, z)?.ground === 'restored';
    this.syncView();
    this.grid = new GridRenderer(this.sim, this.scene.world, this.tweens, this.app.batcher ?? undefined);
    this.chunks = new ChunkRenderer(this.sim, this.scene.world, this.app.graphicsDevice);
    this.waterLevels = new WaterLevels(this.sim, this.scene.world, this.app.graphicsDevice, (tiles) => {
      for (const t of tiles) this.chunks.markTile(t);
    });
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
        2: '🪑 The benches are mended.<small>Halfway there: the birds will want to sit here again.</small>',
        3: '💡 The lamps are lit again!<small>The planter trees leaf out and bunting goes up on the bandstand.</small>',
      };
      if (lines[stage]) this.hud.toast(lines[stage], 'gold', 4);
      this.vfx.ring(new pc.Vec3(8, 0.3, 8), PALETTE.gold, 6, 1.0);
    };
    this.grid.streaming = this.city; // City 07 (#8): the city's chunks stream with the view
    this.grid.build();
    this.machines = new MachineVisuals(this.sim, this.scene.world, this.tweens, this.app.batcher ?? undefined);
    // City 07 (#8): in the city, machine models stream with the view; a landmark streaming in takes its area's state.
    this.machines.streaming = this.city;
    this.machines.landmarkState = (m) => {
      const s = this.sim;
      const id = s.areas.areaOf({ roofId: m.roofId, x: m.x, z: m.z });
      if (!id || id === PARK) return s.state.progression.coreActivated ? 'awake' : 'dormant'; // E21.6: the fountain wakes by its tiers
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
    this.crops = new CropVisuals(this.sim, this.scene.world);
    this.powerLines = new PowerLines(this.sim, this.scene.world, (m) => this.machines.worldOf(m as MachineData));
    this.lightVisuals = new LightVisuals(this.sim, this.scene.world, (m) => this.machines.worldOf(m as MachineData), this.app.batcher ?? undefined);
    this.powerOverlay = new PowerOverlay(this.sim, this.scene.world, (m) => this.machines.worldOf(m as MachineData), this.app.batcher ?? undefined);
    this.rings = new ProgressRings(this.sim, this.scene.world);
    // Look 3.19: the hand-built models load in the background; until then (or with ?models=classic) everything keeps
    // its procedural look. Once they're in, what was already drawn is rebuilt with them.
    const models = createModels(this.app);
    this.models = models;
    models.onReady = () => {
      this.chunks.markAll();
      this.skyline.useModels(models);
      this.machines.rebuildAll();
      this.tillers.rebuildAll();
      this.cat.rebuildAll();
    };
    this.birds = new Birds(this.scene.world);
    this.clouds = new Clouds(this.scene.world, this.app.graphicsDevice, this.scene.sun.up);
    this.cloudWall = new CloudWall(this.sim, this.scene.world, this.app.graphicsDevice, this.scene.sun.up, this.app.batcher ?? undefined);
    this.butterflies = new Butterflies(this.sim, this.scene.world, this.app.batcher!.addGroup('butterflies', true, 400).id);
    this.pollinators = new Pollinators(this.sim, this.scene.world, this.app.batcher!.addGroup('pollinators', true, 400).id);
    this.fauna = new Fauna(this.sim, this.scene.world, this.app.batcher ?? undefined);
    this.nightFindVisuals = new NightFindVisuals(this.sim, this.scene.world, (x, z) => this.groundY(x, z));
    this.weatherVisuals = new WeatherVisuals(this.app, this.scene.world);
    buildRadio(this.scene.world, (x, z) => this.groundY(x, z));
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
        chooseRole: (key) => {
          const [hubId, role, slot, index] = key.split('|');
          if (slot === 'drone') this.sim.roles.chooseForDrone(hubId, Number(index), role === '-' ? undefined : (role as DroneRole));
          else this.sim.roles.choose(hubId, role as DroneRole, Number(slot) || 1);
          this.renderInspect();
        },
        findCat: () => this.findCat(),
        keyFor: (a) => this.hudKey(a),
        goHome: (attention) => (attention ? this.focusNextArea() : this.focusArea(PARK)),
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
      },
      this.settings,
    );
    this.createMenu();
    // E22.10: the walking view is stripped to the place: plain words, two gauges, one objective.
    document.body.classList.add('oldcity');
    this.eco = new EcoBadge(this.sim, (h, k, t) => this.hud.toast(h, k, t));
    this.hud.setTool('pulse');
    this.applySettings();

    this.sim.cat.anchorView = (a) => this.anchorView(this.cat.anchorWorld(a));
    for (const c of this.sim.cat.spots()) this.cat.show(c, false);
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
    this.applyFountainLook(true); // E21.6

    this.wireEvents();
    this.cloudWall.sync();
    if (botMode()) {
      const visuals = new BloombotVisuals(this.app, this.scene.world);
      visuals.reducedMotion = !!this.settings.reducedMotion;
      // E22.1: bindings saved before the new map are reset once, with a notice.
      const st = this.settings;
      const mig = migrateBindings(st.keys || st.pad ? { v: st.bindingsV, keys: st.keys, pad: st.pad } : undefined);
      Object.assign(this, { bindings: new Bindings(mig.saved) });
      if (mig.reset) {
        this.saveBindings(false);
        setTimeout(() => this.hud.toast('Controls were updated. Your custom keys were reset.', '', 6), 900);
      }
      const bot = new BotController(this.sim, this.camera, visuals, this.bindings);
      this.bot = bot;
      this.overlays.holo.eye = (out) => visuals.eyeWorld(out);
      this.overlays.holo.sink = () => new MeshBuilder();
      bot.walker.solid = (r, x, z) => this.cozy.solidAt(r, x, z); // E19: solid plot options block like machines (a decoration blocks through its tile)
      bot.frozen = () => this.cinematic || this.paused || this.hud.modalOpen || visuals.busy === 'assemble' || !!this.photo?.active || !!this.oc?.busy;
      // E21.22: the right stick's up and down tilts the view (it zooms only in photo mode)
      bot.onZoom = (f) => (this.photo?.active ? this.photo.zoom(f) : this.camTurn(0, -(Math.log(f) / Math.log(1.8)) * 60));
      bot.onPad = (i) => {
        const a = this.resolveButton(i);
        if (a && a !== 'sprint') this.doAction(a);
      };
      // E22.4: the rebinding screen takes the next press; that press then does nothing else.
      bot.onButton = (i) => {
        if (!this.padListener) return;
        this.padListener(i);
        this.swallowPad = i;
      };
      this.keepers = new KeeperVisuals(this.sim, this.scene.world, this.app);
      this.keepers.reducedMotion = !!this.settings.reducedMotion;
      this.oc = new OldCityController(this.oldCityHost());
      this.resting = new Resting({
        sim: this.sim, bot, camera: this.camera, hud: this.hud, sfx: this.sfx, keepers: this.keepers,
        glyph: (a) => this.glyph(a),
        showFail: (msg, at) => {
          const sc = at ? this.botTileScreen(at) : undefined;
          this.hud.showFail(msg, sc?.x, sc?.y);
        },
      });
      this.oc.holdToAct = this.settings.holdToAct !== false; // E22.2: holds can be a single press
      // E22.5: material pick-ups stack in one toast at the bottom right ("+3 Copper", then "+6 Copper")
      this.sim.bus.on('pile.salvaged', (e) => this.hud.pickup(MATERIALS[e.material].name, e.got));
      this.sim.bus.on('buried.dug', (e) => this.hud.pickup(MATERIALS[e.material].name, e.n)); // E23.2.2.3
      this.sim.bus.on('biomass.gathered', (e) => e.by === 'bot' && this.hud.pickup(MATERIALS.biomass.name, e.got));
      this.sim.bus.on('planter.harvested', (e) => e.food > 0 && this.hud.pickup(MATERIALS.food.name, e.food));
      const focus = new PadFocus(this.hud.root);
      this.padFocus = focus;
      bot.padCapture = (i) => {
        if (this.swallowPad === i) {
          this.swallowPad = undefined;
          return true;
        }
        return !this.padListener && focus.button(i);
      };
      bot.onTurn = (deg) => this.camTurn(deg, 0);
      // E21.22: the exploration camera (pitch the player's, 0.15 s smoothing, never below the ground)
      this.camera.explore = true;
      this.chunks.fadeTo = 0.3; // E21.22: buildings between the camera and bloombot fade to 30%
      this.camera.ground = (x, z) => this.groundY(x, z);
      this.glyphs.deckBuild = !!desktopApi()?.deck;
      bot.lastInput = this.startDevice; // E22.12: the title's first input picked the glyph set
      this.hud.setKeyMap('keys', this.bindings);
      // G.17: phones and tablets are not supported for now (bloombot needs keys or a gamepad).
      const touchOnly = typeof matchMedia !== 'undefined' && !matchMedia('(any-pointer: fine)').matches && navigator.maxTouchPoints > 0;
      if (touchOnly) setTimeout(() => this.hud.toast('Solarbloom needs a keyboard or a gamepad for now<small>Phones and tablets will be supported again later. Connect a controller to play.</small>', 'gold', 12), 900);
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
        this.lastPanAt = performance.now();
        this.camera.pan(dx, dy, x, y);
      },
      // Bloombot: while the camera follows it, zoom about the middle of the view (bloombot), not the cursor.
      // Bloombot: a right-button drag turns the view around bloombot (a third of a degree per pixel).
      orbit: (dx, dy, button) => {
        if (!this.bot || this.cinematic || !this.bindings.keys.look.includes(`Mouse${button}`)) return false;
        this.camTurn(-dx * 0.35, dy * 0.25); // E21.22: dragging with the look button turns and tilts the view
        return true;
      },
      // Third person: the captured mouse turns and tilts the view directly (no button held).
      look: (dx, dy) => this.mouseLook(dx, dy),
      // Third person: a press on the world while the mouse is free captures it (and does nothing else).
      capture: () => this.captureMouse(),
      // Bloombot: the camera's distance is fixed; the wheel turns what you're building (E19.2).
      // E22.1: in build mode the wheel turns the piece (and the camera's zoom waits); otherwise it zooms.
      zoom: (f, x, y) => (this.photo?.active ? this.photo.zoom(f) : this.bot ? this.wheel(f) : this.camera.zoomBy(f, x, y)),
      // A quick, strong pinch-out snaps to the city overview (one gesture from anywhere).
      pinchEnd: (f, ms) => {
        if (this.city && !this.cinematic && f < 0.6 && ms < 450) this.camera.glide(this.camera.target.x, 0, this.camera.target.z, this.camera.minZoom);
      },
    });
    this.wireKeys();
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // E22.11: a window without focus pauses the game (setting, on by default). E23.1: a hidden page always does,
    // and the time away is never counted or caught up.
    const pauseOnBlur = () => this.settings.pauseOnBlur !== false;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.saveNow();
        // E23.1: a hidden page always waits, like a closed game; nothing is owed or paid back on return
        this.pause.set('hidden');
        if (pauseOnBlur()) this.pause.set('blur');
      } else {
        this.pause.clear('hidden');
        if (document.hasFocus()) this.pause.clear('blur');
      }
    });
    window.addEventListener('blur', () => pauseOnBlur() && this.pause.set('blur'));
    window.addEventListener('focus', () => this.pause.clear('blur'));
    // The pad in use disconnected: open the menu (resuming clears it). The Deck going to sleep pauses too.
    window.addEventListener('gamepaddisconnected', () => {
      if (this.bot?.lastInput !== 'pad' || this.menu.isOpen) return;
      this.openMenu();
      this.pause.set('padLost');
      this.menu.note('The controller was disconnected');
    });
    desktopApi()?.onPower?.((s) => this.pause.set('sleep', s === 'suspend'));
    this.pause.onChange = (p) => {
      document.body.classList.toggle('paused', p);
      // model animations (bloombot, the Keepers) run on the engine's own clock: it stops too
      this.app.timeScale = p ? 0 : 1;
      this.applyVolumes();
    };
    window.addEventListener('beforeunload', () => this.saveNow());

    this.app.on('update', (dt: number) => this.update(dt));
    this.app.start();
    // E23.1.1: a garden from an earlier version starts fresh, said calmly once, when the world is on screen. From the
    // title the new-garden question already said it (and cleared the slot); this is for a start with no title (?slot=)
    if (lr.scrapped) this.openingNotes.push(() => this.hud.toast('Starting fresh 🌱<small>Your garden was from an earlier version, so a new one begins here.</small>', '', 7));
    if (lr.backedUpAs) this.openingNotes.push(() => this.hud.toast(`Your old save couldn't be read by this version, so it was kept safely as a backup and a new garden started.<small>${lr.backedUpAs}</small>`, '', 8));
    else if (loaded) setTimeout(() => this.hud.toast('Welcome back! Your garden kept its shape. 🌱', '', 2.6), 400);
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
    this.placeSea();
  }

  /**
   * E21.12: the Old City's sea is heard from the nearest open water (the bay south of the park, and all round the
   * island): louder near the shore, from its direction.
   */
  private placeSea() {
    const f = this.camera.target;
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    for (let a = 0; a < 16; a++) {
      const dx = Math.sin((a * Math.PI) / 8);
      const dz = Math.cos((a * Math.PI) / 8);
      for (let r = 2; r < 60; r += 2) {
        const x = Math.floor(f.x + dx * r);
        const z = Math.floor(f.z + dz * r);
        if (!seaCell(x, z)) continue;
        if (r < best) [best, bx, bz] = [r, x + 0.5, z + 0.5];
        break;
      }
    }
    if (best < Infinity) this.sfx.setSea(Math.max(0.15, 1 - best / 60), bx, 0, bz);
    else this.sfx.setSea(0, 0, 0, 0);
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
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...this.settings, speed: undefined, realClock: this.titleRealClock }));
    } catch {
      /* private mode */
    }
    this.applySettings();
  }

  private applySettings() {
    const s = this.settings;
    this.applyVolumes();
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
    // E22.11: the paused world dims; it blurs too except on the Low and Deck presets (dim only).
    document.body.classList.toggle('no-blur', this.deck || this.gfxTier === 'low');
    this.hud.gfxTier = this.gfxTier;
    this.hud.gfxDeck = this.deck;
    this.hud.setUiScale(s.uiScale ?? 100);
    // Phase 5 E16's fauna caps (TUNING.ecosystem.caps) follow the graphics tier.
    this.faunaTier = this.gfxTier;
    this.tileFx.reducedMotion = this.birds.reducedMotion = this.clouds.reducedMotion = this.butterflies.reducedMotion = this.grid.reducedMotion = this.machines.reducedMotion = this.drones.reducedMotion = this.cat.reducedMotion = this.camera.reducedMotion = rm;
    if (this.chunks) this.chunks.reducedMotion = rm;
    if (this.overlays) this.overlays.holo.reducedMotion = rm;
    if (this.lightVisuals) this.lightVisuals.reducedMotion = rm;
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
    document.body.classList.toggle('details', !!s.showNumbers); // E22.10: "Show details" adds figures to the gauges
    this.glyphs.setting = s.glyphs ?? 'auto'; // E22.3
    if (this.oc) this.oc.holdToAct = s.holdToAct !== false; // E22.2
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
          if (ok) {
            this.saver.writeHeader(this.sim.state);
            this.showSaved();
          }
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
    if (this.saver.save(this.sim.state)) this.showSaved();
  }

  /** E22.12: a leaf in the corner for a second whenever the game saves. */
  private showSaved() {
    const leaf = this.hud.root.querySelector<HTMLElement>('#saveLeaf');
    if (!leaf) return;
    leaf.classList.add('on');
    window.clearTimeout(this.leafTimer);
    this.leafTimer = window.setTimeout(() => leaf.classList.remove('on'), 1000);
  }
  private leafTimer = 0;
  private models?: ModelLibrary;
  /** the device the title screen was driven with (it picks the first glyph set) */
  private startDevice: 'keys' | 'pad' = 'keys';
  private readyFrames = 0;
  private builtAt = performance.now();

  /**
   * E22.12: how far the game is from a complete first view, as the loading screen's real steps: the models, the
   * world (done once this exists), the chunks round bloombot built with those models, and a few frames drawn
   * with everything in place (shaders compiled).
   */
  /** Notes for the player that wait until the loading screen has faded (`shown`), so none expires unseen. */
  private openingNotes: (() => void)[] = [];

  /** E23.1.1: the loading screen has faded and the world is on screen: show the waiting notes. */
  shown() {
    const notes = this.openingNotes.splice(0);
    notes.forEach((n, i) => setTimeout(n, 400 + i * 600));
  }

  loadSteps(): LoadSteps {
    const m = this.models;
    const total = Math.max(1, ModelLibrary.names().length);
    // no models to wait for (?models=classic), or they never arrive: don't hold the game for ever
    const modelsDone = !m || m.ready || !useModels() || performance.now() - this.builtAt > 30000;
    const loaded = this.chunks.loadedCount;
    // Third person looks out to the horizon: the loading screen waits for the ground round bloombot (two chunks
    // out); the hazy distance streams in while playing.
    const pending = this.bot ? this.chunks.pendingNear(this.camera.target, CHUNK * 2) : this.chunks.pending;
    const view = loaded ? (loaded - pending) / loaded : 0;
    // the camera has settled on bloombot (its opening zoom is over), so the view that fades in is the view that stays
    const settled = Math.abs(this.camera.zoom - this.camera.zoomTarget) < 0.02;
    const viewDone = modelsDone && loaded > 0 && pending === 0 && settled;
    return { models: modelsDone ? 1 : Math.min(0.99, (m?.loaded.size ?? 0) / total), world: 1, view: viewDone ? 1 : Math.min(0.99, view * (modelsDone ? 1 : 0.5)), shaders: Math.min(1, this.readyFrames / 4) };
  }

  /** Freezes or unfreezes the game without the menu (tools, screenshots). */
  setPaused(p: boolean) {
    this.pause.set('menu', p);
  }

  /** E22.11: volumes, with world sound off and the music down to a quiet bed while paused. */
  private applyVolumes() {
    const s = this.settings;
    const quiet = this.pause.paused;
    this.sfx.setVolumes(quiet ? 0 : (s.sfxVolume ?? 100) / 100, ((s.musicVolume ?? 100) / 100) * (quiet ? 0.3 : 1));
  }

  // ───────────────────────── E22.11: the menu and Settings ─────────────────────────

  private createMenu() {
    this.settingsUi = new SettingsScreen(this.hud.root, {
      settings: this.settings,
      set: (k, v) => this.changeSetting(k, v),
      rows: (tab) => settingsRows(tab, { inGame: true, debug: !!this.settings.debug, autoLabel: this.autoLabel(), stats: this.hud.statsHtml() }),
      controls: (body) => this.renderControls(body),
      onClose: () => {
        this.cancelListen();
        if (this.menu.isOpen) this.menu.focus('settings');
      },
    });
    this.menu = new Menu(this.hud.root, { desktop: !!desktopApi()?.quit, header: () => this.menuHeader(), choose: (i) => this.menuChoose(i) });
    this.hud.modalCheck = () => this.menu.isOpen || this.settingsUi.isOpen;
  }

  /** "Auto (High)", "Auto (Steam Deck)": what Auto picked, beside it in Settings › Display. */
  private autoLabel(): string {
    return this.deck ? 'Auto (Steam Deck)' : `Auto (${this.gfxTier[0].toUpperCase()}${this.gfxTier.slice(1)})`;
  }

  /** One change from the Settings screen. */
  private changeSetting(k: SettingKey, v: boolean | number | string) {
    if (k === 'realClock') {
      // E23.7.1.2: the clock mode belongs to the save, not the settings file
      this.sim.clock.real = !!v;
      this.settings.realClock = !!v;
      return;
    }
    if (k === 'speed') {
      this.speed = Number(v) || 1;
      this.settings.speed = this.speed;
      return;
    }
    if (k === 'sfxVolume' || k === 'musicVolume') return this.setVolume(k, Number(v));
    if (k === 'gfx') {
      this.setGraphics(v as GfxSetting);
      this.settingsUi.refresh();
      return;
    }
    this.setSetting(k, v);
    if (k === 'debug') {
      if (!v) this.speed = 1; // fast-forward is a developer tool only
      this.settingsUi.refresh();
    }
  }

  /** Closes every panel and menu and puts the tool away (tests, scripted runs). */
  closeAll() {
    this.closeMenu();
    this.hud.toggleTray(false);
    this.hud.toggleBackpack(false);
    this.hud.craft.close();
    this.hud.crate.close();
    this.hud.closePlotPicker();
    if (this.hud.currentTool !== 'pulse') this.selectTool('pulse');
  }

  /** E22.11: a full-screen panel pauses the game while it is open (also called the moment one closes, so the next
   *  key press already reaches the game, however slow the frame). */
  private syncPanelPause() {
    this.pause.set('panel', this.hud.backpackOpen || this.hud.craft.isOpen || this.hud.crate.isOpen || this.settingsUi.isOpen || !!this.oc?.panel.isOpen);
  }

  private openMenu() {
    if (this.photo.active) this.photo.exit();
    this.hud.toggleTray(false);
    this.hud.hideTip();
    this.menu.open();
    this.pause.set('menu');
  }

  private closeMenu() {
    this.settingsUi.close();
    this.menu.close();
    this.pause.clear('menu', 'padLost');
    this.syncPanelPause();
  }

  /** Esc with nothing open, or Menu on the pad. */
  private toggleMenu() {
    if (this.menu.isOpen || this.settingsUi.isOpen) this.closeMenu();
    else this.openMenu();
  }

  /** E23.7.1.3: is a ground cell the house (its footprint or the cell at its door)? */
  private atHouse(f: { x: number; z: number }): boolean {
    const h = PARK_SET.shed;
    return (f.x >= h.x && f.x < h.x + h.size && f.z >= h.z && f.z < h.z + h.size) || (f.x === h.door[0] && f.z === h.door[1]);
  }

  /** E23.7.1.3: sleep in the house until morning: the screen dims, the clock skips the night, charge is full. */
  private sleeping = false;
  private sleep() {
    if (this.sleeping || !this.sim.clock.canSleep()) return;
    this.sleeping = true;
    let veil = document.getElementById('sleepVeil');
    if (!veil) {
      veil = document.createElement('div');
      veil.id = 'sleepVeil';
      document.body.appendChild(veil);
    }
    const v = veil;
    const fade = this.settings.reducedMotion ? 150 : 900;
    v.style.transitionDuration = `${fade}ms`;
    requestAnimationFrame(() => v.classList.add('on'));
    setTimeout(() => {
      this.sim.clock.sleep();
      this.save();
      setTimeout(() => {
        v.classList.remove('on');
        this.sleeping = false;
      }, fade + 300);
    }, fade);
  }

  /** E23.7.1: the moment the sky and light show: the light clock (photo mode may set its own, E23.7.3). */
  private lightMoment(): LightMoment {
    const wv = this.weatherVisuals;
    // E23.7.3: photo mode may show its own time of day (the game's clock doesn't move)
    return { f: sceneNow(this.sim, this.photo).f, overcast: wv?.overcast ?? 0, flash: wv?.lightning ?? 0 };
  }

  /** E23.7.2: the weather the screen shows (photo mode may pick its own, E23.7.3). */
  private weatherLook(): WeatherLook {
    return { kind: sceneNow(this.sim, this.photo).weather };
  }

  /**
   * E23.7.2.2 (#449): the forecast. An old radio on a crate by the house's door; by day, Interact listens to it and
   * it says tomorrow's weather (always the right one: the weather is fixed per game day).
   */
  /** E23.7.2.2: tomorrow's weather, from the radio. */
  private listenToRadio() {
    const k = this.sim.weather.forecast();
    this.hud.toast(WEATHER_WORDS[k].forecast, '', 5);
    this.sim.bus.emit('weather.forecast', { kind: k });
  }

  private menuHeader(): MenuHeader {
    return { name: this.saveName, region: this.regionName(), day: this.sim.clock.gameDay(), played: this.sim.time };
  }

  /** E22.12 names saves; until a slot has a name, this. */
  get saveName(): string {
    return this.saver.readHeader()?.name ?? `Garden ${this.saver.slot}`;
  }

  /** The region bloombot is in, by name. */
  private regionName(): string {
    const b = this.bot;
    const at = b ? b.world() : [this.camera.target.x, 0, this.camera.target.z];
    if (b && b.pose.roofId !== GROUND) return 'On a rooftop';
    const id = this.sim.areas.areaOf({ roofId: GROUND, x: Math.floor(at[0]), z: Math.floor(at[2]) });
    if (!id) return 'The city';
    const info = this.sim.areas.info(id);
    if (info.region) return this.sim.gates.regionById(info.region)?.name ?? 'The city'; // E21: a region by its own name
    return id === PARK ? 'The park' : AREA_TYPES[info.type].name;
  }

  private menuChoose(i: MenuItem) {
    switch (i) {
      case 'resume':
        return this.closeMenu();
      case 'backpack':
        this.closeMenu();
        this.hud.toggleBackpack(true);
        return this.syncPanelPause();
      case 'map':
        this.closeMenu();
        if (!this.overviewOn) this.toggleOverview();
        return;
      case 'photo':
        this.closeMenu();
        return this.photo.enter();
      case 'settings':
        return this.settingsUi.open();
      case 'save':
        this.saveNow();
        this.menu.note('Saved');
        return;
      case 'title':
        return this.quitToTitle();
      case 'desktop':
        this.saveNow();
        return desktopApi()?.quit?.();
    }
  }

  /** "Quit to title" saves first (nothing in the menu loses progress), then goes to the title screen. */
  quitToTitle() {
    // E22.12: the loading screen covers the way out, as it covered the way in.
    new Loading(!!this.settings.reducedMotion).show();
    this.saveNow();
    this.resetting = true; // nothing writes after this save
    setTimeout(() => (location.href = `${location.pathname}?title=1`), 60);
  }

  /** E22.4: Settings › Controls (src/ui/ControlsTable.ts). */
  private renderControls(body: HTMLElement) {
    new ControlsTable(body, {
      bindings: this.bindings,
      padStyle: () => {
        const st = this.glyphs.style;
        const set = this.settings.glyphs;
        return st !== 'keys' ? st : set === 'xbox' || set === 'ps' || set === 'deck' ? set : (this.glyphs.padType as PadStyle);
      },
      glyphSetting: () => this.settings.glyphs ?? 'auto',
      listen: (kind, done) => this.listenForBinding(kind, done),
      changed: () => this.saveBindings(),
    }).render();
  }

  /** the pad button the rebinding screen just took (it does nothing else) */
  private swallowPad?: number;
  private listenCleanup?: () => void;

  private cancelListen() {
    this.keyListener = undefined;
    this.padListener = undefined;
    this.listenCleanup?.();
    this.listenCleanup = undefined;
  }

  // ───────────────────────── tools & input ─────────────────────────

  private selectTool(t: Tool) {
    if (this.cinematic) return;
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
    this.photoBar = new PhotoBar(
      (a) => this.photo.action(a),
      (a) => this.hudKey(a),
      (h) => this.photo.setHour(h),
      () => this.sim.clock.hour() + this.sim.clock.minute() / 60,
    );
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
        clockHour: () => this.sim.clock.hour() + this.sim.clock.minute() / 60,
        setFilter: (css) => ((this.app.graphicsDevice.canvas as HTMLCanvasElement).style.filter = css),
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
    this.app.once('frameend', () => saveCanvasPng(this.app.graphicsDevice.canvas as HTMLCanvasElement, LOOK.haze.color, PHOTO_FILTERS[this.photo.filter].css));
    this.photoBar.flashNow();
    this.sfx.click();
  }

  /** E23.2.1: F / d-pad left: eat one snack (biomass or food) to recharge. */
  private eat() {
    const r = this.sim.charge.eat();
    if (typeof r === 'object') {
      this.bot?.visuals.play('interact');
      this.sfx.coin();
      return;
    }
    if (r === 'full') this.hud.showFail('Fully charged');
    else if (r === 'none') this.hud.showFail('Nothing to eat. Biomass or food recharges bloombot');
  }

  private wireKeys() {
    window.addEventListener('keyup', (e) => this.heldKeys.delete(e.code));
    window.addEventListener('blur', () => this.heldKeys.clear());
    window.addEventListener('keydown', (e) => {
      this.heldKeys.add(e.code);
      const field = (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') || e.target instanceof HTMLSelectElement;
      if (field && e.code !== FIXED_KEY) return;
      if (this.keyListener) {
        e.preventDefault();
        this.keyListener(e.code);
        return;
      }
      if (this.bot && this.photo.active) {
        // E19.4.1: photo mode reads the same map with its own meanings (PhotoMode); held keys pan.
        this.photo.key(e.code, true);
        const a = e.code === FIXED_KEY ? 'cancel' : this.bindings.actionForCode(e.code, ['build', 'world', 'any']);
        if (a === 'backpack' || a === 'debug' || e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
        if (!a || (e.repeat && a !== 'zoomCamera' && a !== 'rotate' && a !== 'rotateBack')) return;
        if (a === 'debug') this.doAction(a);
        else this.photo.action(a);
        return;
      }
      if (this.bot) {
        // E22.1: the epic's map (docs/E22_CONTROLS_UI.md), every action rebindable. Esc is back, or the menu.
        if (e.code === FIXED_KEY) {
          e.preventDefault();
          if (!e.repeat) this.escape();
          return;
        }
        // E22.11: in a panel the arrow keys move the focus ring, as the d-pad does.
        const dpad: Record<string, number> = { ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15 };
        // (on a tab, left and right change tab; up and down still leave the tab row)
        const onTab = !!(e.target as HTMLElement)?.closest?.('[role=tablist]') && (e.code === 'ArrowLeft' || e.code === 'ArrowRight');
        // E23.6.4: a machine's panel (a hub's roles, an Assembler's recipe) takes the arrows once its focus is in it
        const inInspect = !!this.selected && !!(document.activeElement as HTMLElement | null)?.closest?.('#inspect.open');
        if ((this.panelOpen() || inInspect) && dpad[e.code] !== undefined && this.padFocus && !onTab) {
          e.preventDefault();
          this.padFocus.button(dpad[e.code]);
          return;
        }
        // and Enter presses its focused button, as A does (the panel redraws as the world runs)
        if (inInspect && (e.code === 'Enter' || e.code === 'NumpadEnter') && this.padFocus) {
          e.preventDefault();
          this.padFocus.button(0);
          return;
        }
        const a = this.resolveKey(e.code);
        if (!a) return;
        if (a === 'backpack' || a === 'debug' || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
        if (e.repeat && a !== 'rotate' && a !== 'rotateBack') return;
        this.doAction(a);
        return;
      }
      const k = e.key.toLowerCase();
      const map: Record<string, Tool> = { '1': 'inspect', '2': 'pulse', '3': 'solar', '4': 'condenser', '5': 'pollinator', '6': 'droneHub', '7': 'motherTree', '8': 'reservoirGarden', '9': 'relay', '0': 'cultivator' };
      if (map[k]) this.selectTool(map[k]);
      else if (k === 'f') this.focusNextArea();
      else if (k === 'home') this.focusArea(PARK);
      else if (k === 'b') this.hud.toggleTray();
      else if (k === 'p') this.setPaused(!this.paused);
      else if (k === 'f3' || k === '`') {
        e.preventDefault();
        this.setSetting('debug', !this.settings.debug);
      } else if (k === 'escape') this.escape();
      else if (k === '+' || k === '=') this.camera.zoomBy(1.15);
      else if (k === '-') this.camera.zoomBy(1 / 1.15);
    });
  }

  /** Bloombot: one action from a key, mouse input or pad button. Movement and sprint are read by BotController. */
  private doAction(a: Action) {
    if ((this.photo.active && a !== 'debug') || a === 'photo') {
      if (!this.cinematic || this.photo.active) this.photo.action(a);
      return;
    }
    if (this.resting?.action(a)) return; // E23.2.3: sitting: Interact or Back stands, Pulse runs time faster
    const slot = SLOTS.indexOf(a as (typeof SLOTS)[number]);
    if (slot >= 0) return this.useSlot(slot);
    switch (a) {
      case 'pulse':
      case 'place':
        return this.botAct();
      case 'interact':
        return this.botInteract();
      case 'buildMenu':
        return this.hud.toggleTray();
      case 'cancel':
        return this.escape(true);
      case 'menu':
        return this.toggleMenu();
      case 'eat':
        return this.eat();
      case 'loadNext':
      case 'loadPrev':
        // E23.2.2: turn the pulse load wheel
        this.sim.pulseLoad.step(a === 'loadNext' ? 1 : -1);
        return this.hud.loadWheel.show();
      case 'backpack':
        this.hud.toggleBackpack();
        return this.syncPanelPause(); // paused from this very moment
      case 'rotate':
      case 'rotateBack':
        return this.turnBuild(a === 'rotate' ? 1 : -1);
      case 'removeMode':
        return this.selectTool(this.hud.currentTool === 'remove' ? 'pulse' : 'remove');
      case 'powerOverlay':
        return this.togglePowerView();
      case 'map':
        return this.toggleOverview();
      case 'zoomCamera':
        return this.cycleZoom();
      case 'sprintToggle':
        if (this.bot) this.bot.sprintLatched = !this.bot.sprintLatched;
        return;
      case 'pinNext':
        return this.pinNext();
      case 'recentre':
        return this.camera.recentre();
      case 'debug':
        return this.changeSetting('debug', !this.settings.debug);
      case 'prevTab':
      case 'nextTab':
        return this.panelTab(a === 'nextTab' ? 1 : -1);
    }
  }

  /** LB / RB, Q / E: the tabs of the panel on top. */
  private panelTab(dir: number) {
    if (this.settingsUi.isOpen) this.settingsUi.tab(dir, true);
    else if (this.hud.backpack.isOpen) this.hud.backpack.tab(dir, true);
    else if (this.hud.craft.isOpen) this.hud.craft.tab(dir, true);
  }

  /** E22.1: the input contexts in effect now (Bindings: an open panel, build mode, or walking). */
  private contexts(): Context[] {
    if (this.panelOpen()) return ['panel', 'any'];
    return this.building() ? ['build', 'world', 'any'] : ['world', 'any'];
  }

  /** A panel or menu that takes the input is open. */
  private panelOpen(): boolean {
    const h = this.hud;
    return h.modalOpen || h.backpackOpen || h.craft.isOpen || h.crate.isOpen || h.plotPickerOpen || h.trayOpen || !!this.oc?.panel.isOpen;
  }

  /** The action a key (or mouse input) means now. With a panel open, the key that opened it closes it again. */
  private resolveKey(code: string): Action | undefined {
    const ctx = this.contexts();
    const a = this.bindings.actionForCode(code, ctx);
    if (a || ctx[0] !== 'panel') return a;
    const w = this.bindings.actionForCode(code, ['world']);
    return w && this.togglesOpenPanel(w) ? w : undefined;
  }

  /** The key or button that opened the panel on top closes it again (Tab still moves the focus elsewhere). */
  private togglesOpenPanel(a: Action): boolean {
    if (!PANEL_TOGGLES.has(a)) return false;
    const h = this.hud;
    const open: Action | undefined = this.settingsUi.isOpen || this.menu.isOpen ? 'menu' : h.backpackOpen ? 'backpack' : h.trayOpen ? 'buildMenu' : undefined;
    return a === open;
  }

  private resolveButton(i: number): Action | undefined {
    const ctx = this.contexts();
    const a = this.bindings.actionForButton(i, ctx);
    if (a || ctx[0] !== 'panel') return a;
    const w = this.bindings.actionForButton(i, ['world']);
    return w && this.togglesOpenPanel(w) ? w : undefined;
  }

  /** E22.1: hotbar slots 1–9 take a pinned build card into bloombot's hands (again: put it away). */
  private useSlot(i: number) {
    const t = (this.settings.hotbar ?? HOTBAR_DEFAULT)[i] as Tool | '' | undefined;
    if (!t) {
      this.hud.toast(`Hotbar slot ${i + 1} is empty. Pin something to it from the build menu.`, '', 2.6);
      return;
    }
    if (machineTool(t) && !this.sim.build.isUnlocked(t)) {
      this.hud.showFail(this.sim.build.lockLabel(t));
      return;
    }
    this.selectTool(this.hud.currentTool === t ? 'pulse' : t);
  }

  /** E22.1: Pin the next request (E21's requests; until they exist there is nothing to pin). */
  private pinNext() {
    const r = pinNext(this.sim);
    this.hud.toast(r ? `Pinned: ${r.keeper}'s request<small>${esc(r.text)}</small>` : 'No requests to pin yet', '', 2.6);
  }

  /** The mouse wheel: turns the piece in build mode, otherwise zooms the camera (as bound). */
  private wheel(factor: number) {
    if (factor === 1) return;
    const now = performance.now();
    if (now - this.wheelAt < WHEEL_TURN_MS) return;
    const a = this.resolveKey('Wheel');
    if (a === 'rotate' || a === 'rotateBack') {
      this.wheelAt = now;
      this.turnBuild(factor > 1 ? 1 : -1);
    } else if (a === 'zoomCamera') {
      this.wheelAt = now;
      this.zoomStepBy(factor > 1 ? -1 : 1); // E21.22's zoom steps
    }
  }

  // ───────────── E21.22: the exploration camera ─────────────

  /** 0 close, 1 normal (today's), 2 far */
  private zoomStep = 1;
  /** seconds since the player last moved the camera, and how long bloombot has walked since */
  private camIdle = 99;
  private walkedFor = 0;
  private stillFor = 0;

  /** Steps the zoom (−1 closer, +1 further). */
  private zoomStepBy(step: number) {
    const next = Math.max(0, Math.min(EXPLORE.zoomSteps.length - 1, this.zoomStep + step));
    if (next === this.zoomStep) return;
    this.zoomStep = next;
    this.camIdle = 0;
    this.overviewOn = false;
    if (this.bot) this.bot.following = true;
    this.sfx.click();
  }

  /** E22.1: the pad's zoom button cycles the steps (close, normal, far, close…). */
  private cycleZoom() {
    if (!this.bot || this.cinematic) return;
    this.zoomStepBy(this.zoomStep >= EXPLORE.zoomSteps.length - 1 ? -this.zoomStep : 1);
  }

  /** The camera's speed and axes from the settings. */
  private camFactor(axis: 'x' | 'y'): number {
    const s = this.settings;
    return ((s.camSensitivity ?? 100) / 100) * ((axis === 'x' ? s.invertX : s.invertY) ? -1 : 1);
  }

  /** The player turned or tilted the view. */
  private camTurn(yawDeg: number, pitchDeg: number) {
    if (yawDeg) this.camera.orbit(yawDeg * this.camFactor('x'));
    if (pitchDeg) this.camera.pitchBy(pitchDeg * this.camFactor('y'));
    this.camIdle = 0;
  }

  // ───────────── Third person: the captured mouse ─────────────

  /** degrees the view turns (and tilts) per pixel of mouse movement, before the sensitivity setting */
  private static readonly MOUSE_DEG = { yaw: 0.16, pitch: 0.12 };
  /** pointer lock was refused (an embedded page, a test browser): clicks act as before */
  private lockRefused = false;
  /** shown the "click to look around" hint once */
  private lookHinted = false;

  private mouseCaptured(): boolean {
    return typeof document !== 'undefined' && !!document.pointerLockElement && document.pointerLockElement === this.app.graphicsDevice.canvas;
  }

  /** May the mouse be captured now (bloombot's walking view with nothing open on top)? */
  private mayCapture(): boolean {
    return !!this.bot && !this.cinematic && !this.paused && !this.photo?.active && !this.overviewOn && !this.panelOpen() && this.settings.mouseLook !== false;
  }

  /** A press on the free mouse: capture it for looking around. True when the press was used for that. */
  private captureMouse(): boolean {
    if (this.lockRefused || this.mouseCaptured() || !this.mayCapture()) return false;
    const c = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    if (!c.requestPointerLock) return false;
    try {
      const r = c.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => (this.lockRefused = true));
    } catch {
      this.lockRefused = true;
      return false;
    }
    return true;
  }

  /** The captured mouse moved: the view turns and tilts at once (a mouse wants no easing). */
  private mouseLook(dx: number, dy: number) {
    if (!this.bot || this.cinematic || this.photo?.active) return;
    this.bot.lastInput = 'keys'; // looking with the mouse: prompts show keys again
    const k = Game.MOUSE_DEG;
    this.camera.look(-dx * k.yaw * this.camFactor('x'), dy * k.pitch * this.camFactor('y'));
    this.camIdle = 0;
  }

  /** Per frame: lets go of the mouse when a panel, the menu, the map or a cinematic needs the pointer. */
  private updateMouseCapture() {
    if (this.mouseCaptured() && !this.mayCapture()) document.exitPointerLock?.();
    this.hud.root.classList.toggle('mouse-look', this.mouseCaptured());
    const aiming = !!this.bot && this.building() && !this.panelOpen() && !this.cinematic && !this.photo?.active && !this.overviewOn;
    this.hud.root.classList.toggle('aiming', aiming);
    this.camera.shoulderGoal = aiming ? 0.75 : 0; // building: over bloombot's shoulder, so the hologram is in view
    if (this.bot) this.bot.strafe = aiming; // aiming: bloombot faces where the camera looks and steps sideways
    if (!this.lookHinted && this.bot && this.mayCapture() && !this.mouseCaptured() && this.bot.lastInput === 'keys' && typeof matchMedia !== 'undefined' && matchMedia('(any-pointer: fine)').matches) {
      this.lookHinted = true;
      this.hud.toast('Press a mouse button over the world to look around with the mouse<small>Esc frees the mouse again.</small>', '', 5);
    }
  }

  /**
   * Per frame: the look-ahead, and the drift back behind bloombot after 3 s of walking with no camera input (a
   * setting). On a rooftop the view eases to the far step.
   */
  private updateExploreCamera(dt: number) {
    const b = this.bot;
    if (!b || this.cinematic || this.photo?.active) return;
    this.camIdle += dt;
    const moving = b.speed > 0.05;
    // walking time survives a frame's pause at a path corner; half a second standing still resets it
    this.stillFor = moving ? 0 : this.stillFor + dt;
    this.walkedFor = moving ? this.walkedFor + dt : this.stillFor > 0.5 ? 0 : this.walkedFor;
    const f = b.pose.facing;
    this.camera.setLead(moving && b.following ? Math.sin(f) * EXPLORE.lead : 0, moving && b.following ? Math.cos(f) * EXPLORE.lead : 0);
    // Third person, as action-platformers do: running, the camera swings in behind bloombot once the player has
    // left it alone for a moment (eased, faster the further round it is). Running at the camera never flips it
    // round, and aiming a build leaves it where it is.
    if (!this.settings.noRecentre && !this.building() && this.stillFor < 0.5 && this.camIdle >= EXPLORE.recentreAfter && this.walkedFor >= EXPLORE.recentreWalk) {
      const behind = (f * 180) / Math.PI + 180;
      const now = this.camera.heading;
      const diff = ((((behind - now) % 360) + 540) % 360) - 180;
      const rate = EXPLORE.recentreSpeed * Math.min(1, Math.abs(diff) / 45) * Math.min(1, b.speed / 2);
      const step = Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
      if (Math.abs(diff) > 0.5 && Math.abs(diff) < 150) this.camera.turnTo(now + step, true);
    }
  }

  /** G.16: the rebinding screen waits for one key or button. */
  private keyListener?: (code: string) => void;
  private padListener?: (button: number) => void;
  /**
   * E22.4: waits for one input for the rebinding screen. Keyboard column: a key, a mouse button or the wheel
   * (Esc cancels, Backspace clears). Gamepad column: a pad button (Menu or Esc cancels).
   */
  private listenForBinding(kind: 'key' | 'pad', done: (input: string | number | 'clear' | undefined) => void) {
    this.cancelListen();
    const finish = (v: string | number | 'clear' | undefined) => {
      this.cancelListen();
      done(v);
    };
    if (kind === 'key') {
      this.keyListener = (code) => finish(code === 'Escape' ? undefined : code === 'Backspace' ? 'clear' : code);
      // Mouse buttons and the wheel, from the next press (the click that chose the cell is already over).
      setTimeout(() => {
        if (!this.keyListener) return;
        const swallow = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
        };
        const md = (e: MouseEvent) => {
          swallow(e);
          window.addEventListener('click', swallow, { capture: true, once: true });
          window.addEventListener('contextmenu', swallow, { capture: true, once: true });
          finish(`Mouse${e.button}`);
        };
        const wh = (e: WheelEvent) => {
          swallow(e);
          finish('Wheel');
        };
        window.addEventListener('mousedown', md, { capture: true });
        window.addEventListener('wheel', wh, { capture: true, passive: false });
        this.listenCleanup = () => {
          window.removeEventListener('mousedown', md, { capture: true });
          window.removeEventListener('wheel', wh, { capture: true });
        };
      }, 0);
    } else {
      this.keyListener = (code) => code === 'Escape' && finish(undefined);
      this.padListener = (i) => finish(i === 9 ? undefined : i);
    }
  }

  private saveBindings(render = true) {
    const saved = this.bindings.save();
    this.settings.keys = saved.keys;
    this.settings.pad = saved.pad;
    this.settings.bindingsV = saved.v;
    this.setSetting('keys', saved.keys as unknown as string);
    if (!render) return;
    this.hud.setKeyMap(this.glyphs.style, this.bindings);
    this.botPreviewKey = '';
  }

  /** Esc / B: closes or puts away the nearest thing; with nothing to close, Esc (not B) opens the menu. */
  private escape(fromCancel = false) {
    if (this.settingsUi.isOpen) this.settingsUi.close();
    else if (this.menu.isOpen) this.closeMenu();
    else if (this.oc?.escape()) void 0; // E21: an Old City panel or a hold
    else if (this.resting?.active) this.resting.stand(); // E23.2.3: Back stands bloombot up before any menu
    else if (this.hud.trayOpen) this.hud.toggleTray(false);
    else if (this.hud.plotPickerOpen) this.hud.closePlotPicker();
    else if (this.hud.backpackOpen) this.hud.toggleBackpack(false);
    else if (this.hud.craft.isOpen) this.hud.craft.close();
    else if (this.hud.crate.isOpen) this.hud.crate.close();
    else if (this.selected) this.select(undefined);
    else if (this.bot?.walking) this.bot.cancelWalk();
    else if (this.hud.currentTool !== 'pulse') this.selectTool('pulse');
    else if (!fromCancel) this.openMenu();
    this.syncPanelPause();
  }

  /** E19.2: build mode is having something in hand to build or remove (a machine, a core, a decoration, remove). */
  private building(t: Tool = this.hud.currentTool): boolean {
    return !!this.bot && t !== 'inspect' && t !== 'pulse';
  }
  /** E23.3.4: the Power view is on (shown while building; it stays on for the next time you build). */
  private powerView = false;
  private togglePowerView() {
    if (!this.building()) return;
    this.powerView = !this.powerView;
    this.hud.buildBar.powerOn = this.powerView;
    this.hud.buildBar.render(this.hud.currentTool);
    // A new concept gets one short introduction, the first time only.
    if (this.powerView && !this.powerViewSeen) {
      this.powerViewSeen = true;
      this.hud.toast('Power view: each network glows in its own colour. Red means a machine has no power.', 'gold', 4);
    }
  }
  private powerViewSeen = false;
  /** where the pointer (or bloombot's cursor) is, for the Power view's highlight */
  private powerFocus?: { roofId: string; x: number; z: number };
  /** Machines on the grid that have power now: sources, batteries, poles and fed consumers (a dark one stays dark). */
  private poweredMachines(): Set<string> {
    const out = new Set<string>();
    for (const m of this.sim.state.machines) {
      const role = this.sim.power.roleOf(m);
      if (!role) continue;
      if (role.consumer && !this.sim.power.isPowered(m)) continue;
      if (role.pole && this.sim.power.isTripped(m)) continue;
      out.add(m.id);
    }
    return out;
  }
  /** the overview (M) is showing; walking, or M again, leaves it */
  private overviewOn = false;
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

  /** Bloombot: hold the camera at the close view's distance (E19.2: building no longer pulls it back). */
  private updateBotZoom() {
    const b = this.bot;
    if (!b || this.cinematic || this.resting?.active) return; // E23.2.3: sitting keeps its calm, wider view
    if (this.overviewOn && b.speed > 0.05) this.overviewOn = false; // walking leaves the overview
    if (this.overviewOn || !b.following) return; // the overview, or a camera-only fly-to, keeps its own zoom
    // E21.22: the chosen step; on a rooftop the view eases out to the far step
    const want = b.pose.roofId !== GROUND ? EXPLORE.zoomSteps[2] : EXPLORE.zoomSteps[this.zoomStep];
    if (Math.abs(this.camera.zoomTarget - want) > 1e-3) this.camera.zoomTo(want);
  }

  /** Bloombot (G.3): M or the View button: out to the city overview, and back to the close view. */
  private toggleOverview() {
    const c = this.camera;
    const out = !this.overviewOn;
    this.overviewOn = out;
    const t = this.bot ? this.bot.world() : [c.target.x, 0, c.target.z];
    c.glide(t[0], 0, t[2], out ? c.minZoom : EXPLORE.zoomSteps[this.zoomStep]);
    if (!out && this.bot) this.bot.following = true;
  }

  /** E20.2 (#285): an action's key or pad button as plain text, as the player last used them. */
  private hudKey(a: Action): string {
    const st = this.glyphs.style;
    return st !== 'keys' ? padName(st, this.bindings.pad[a]) || '—' : keyLabel(this.bindings.keys[a][0] ?? '');
  }

  /** Every key for an action ("Left mouse or Space"), or its pad button. */
  private hudKeys(a: Action): string {
    const st = this.glyphs.style;
    if (st !== 'keys') return padName(st, this.bindings.pad[a]) || '—';
    const ks = this.bindings.keys[a].map(keyLabel);
    return ks.length ? ks.slice(0, 2).join(' or ') : '—';
  }

  /** A key or button name for hints: the pointer's "Click", or bloombot's key / pad button. */
  private press(key: 'E' | 'Q', bot = this.previewFromBot): string {
    if (!bot) return 'Select'; // the internal cursor path (bots, dev tools)
    const a: Action = key === 'E' ? (this.building() && this.bot?.lastInput === 'pad' ? 'place' : 'pulse') : 'interact';
    if (this.glyphs.style !== 'keys') return `<kbd>${esc(this.hudKey(a))}</kbd>`;
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
      // The echo pulse: cyan rings leave the palms and travel to the tile in front (as in the reference image).
      const f = this.frontPick();
      if (f?.tile) {
        const to = this.tileVec(f.tile, SLAB_TOP + 0.25);
        setTimeout(() => this.vfx.palmWave(v.palmWorld(new pc.Vec3()), to), 140); // when the palms push out
      }
    }
    else if (r === 'build') v.play('assemble');
    else if (r === 'select' || r === 'wake') v.play('interact');
  }

  /**
   * E23.6.4: a machine's panel opened from the keyboard takes the focus, so the arrows and Enter reach its choices (a
   * hub's roles, an Assembler's recipe) as the d-pad and A do; Esc closes it and the arrows walk again.
   */
  private focusPanelForKeys() {
    if (this.bot?.lastInput === 'pad') return;
    // the panel draws with the HUD's next update: try for a few frames until its first control takes the focus
    let tries = 10;
    const go = () => {
      const el = document.querySelector('#inspect.open');
      if (el?.contains(document.activeElement)) return;
      if (el?.querySelector('button:not([disabled])')) this.padFocus?.button(13);
      else if (--tries > 0) requestAnimationFrame(go);
    };
    requestAnimationFrame(go);
  }

  /** Bloombot (G.4): E / A: the current tool on the tile in front (Inspect pulses; build tools build). */
  private botAct() {
    if (!this.bot || this.cinematic || this.paused || this.hud.modalOpen || this.bot.visuals.busy === 'assemble') return;
    if (this.oc && !this.building() && this.oc.pulse(this.bot.front())) return; // E21.8: a pulse stirs a sleeping Keeper
    const aim = this.building() ? this.buildAim() : undefined; // E19.2: build mode acts where the hologram is
    const p = aim ? aim.p : this.frontPick();
    if (!p || !p.tile) return;
    if (aim && p.roofId === this.bot.pose.roofId && !this.bot.walking) this.bot.pose.facing = Math.atan2(p.fx - this.bot.pose.x, p.fz - this.bot.pose.z); // turns to build
    this.bot.following = true;
    const tool = this.hud.currentTool === 'inspect' ? 'pulse' : this.hud.currentTool;
    const sc = aim ?? this.botTileScreen(p.tile);
    const r = this.actAt(p, sc.x, sc.y, tool, false);
    this.botAnim(r);
    if (r === 'select') this.focusPanelForKeys();
    this.botPreviewKey = '';
    this.buildKey = '';
  }

  /**
   * E22.2 (#339): Interact acts on the one target the prompt names (Interact.ts chooses it by the epic's priority,
   * nearest first). A refused action says why; a hold starts the ring instead (unless holds are single presses).
   */
  private botInteract() {
    const b = this.bot;
    if (!b || this.cinematic || this.paused || this.hud.modalOpen) return;
    const t = this.interactTarget();
    if (!t) return;
    if (t.refused) {
      const sc = t.at ? this.botTileScreen(t.at) : undefined;
      this.hud.showFail(t.refused, sc?.x, sc?.y);
      return;
    }
    const hold = holdFor(t, this.settings.holdToAct !== false);
    if (hold) {
      this.holding = { id: t.id, t: 0, need: hold };
      return;
    }
    t.run();
  }

  /** E22.2: a hold under way (Interact kept down on the same target until `need` seconds pass). */
  private holding?: { id: string; t: number; need: number };
  /** keys held down right now (for holds) */
  private heldKeys = new Set<string>();

  /** Is Interact still held (a key, or the pad button)? */
  private interactHeld(): boolean {
    if (this.bindings.keys.interact.some((k) => this.heldKeys.has(k))) return true;
    const btn = this.bindings.pad.interact;
    if (btn === undefined) return false;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    return [...pads].some((p) => p?.connected && p.buttons[btn]?.pressed);
  }

  private updateHold(dt: number, target: InteractTarget | undefined) {
    const h = this.holding;
    if (!h) return;
    if (!target || target.id !== h.id || !this.interactHeld() || this.paused) {
      this.holding = undefined;
      return;
    }
    h.t += dt;
    if (h.t >= h.need) {
      this.holding = undefined;
      target.run();
    }
  }

  /**
   * E22.2: everything Interact could act on now: a Lucky Cat within reach, the fog gate or rooftop lift ahead,
   * and what stands on the tile in front (or aimed at, in build mode): a landmark, a machine, a decoration, a plot.
   * E21 adds its kinds (Keepers, salvage, caches, doors, storage) here.
   */
  private interactCandidates(): InteractTarget[] {
    const b = this.bot;
    if (!b) return [];
    const out: InteractTarget[] = [];
    const [wx, , wz] = b.world();
    for (const id of this.cat.ids()) {
      const v = this.cat.targetWorld(id);
      if (!v) continue;
      const d = Math.hypot(v.x - wx, v.z - wz);
      if (d >= BOT_REACH + 0.6) continue;
      out.push({
        kind: 'cat', id: `cat:${id}`, verb: 'Say hello', name: '', distance: d,
        run: () => {
          b.pose.facing = Math.atan2(v.x - wx, v.z - wz);
          this.sim.cat.claim(id);
          b.visuals.play('cheer');
        },
      });
    }
    const f = b.front();
    const front = this.sim.grid.get(b.pose.roofId, f.x, f.z);
    const fd = Math.hypot(f.x + 0.5 - b.pose.x, f.z + 0.5 - b.pose.z);
    if (this.oc) out.push(...this.oldCityCandidates(f, front, fd));
    // Facing a sealed area's fog: nothing is bought (E23.1.5). Its gate opens by prying, repairing or waking, and
    // the prompt says what is in the way.
    const sealed = this.sealedAhead();
    if (sealed) {
      if (!out.some((c) => c.kind === 'gate'))
        out.push({ kind: 'gate', id: `seal:${sealed}`, verb: 'Look at', name: 'the clouds', distance: fd, at: front, refused: this.sim.areas.sealText(sealed).replace(/<[^>]*>/g, ''), run: () => {} });
    }
    const lift = this.liftAhead();
    if (lift) {
      const up = lift.up;
      out.push({
        kind: 'gate', id: `lift:${up?.id ?? 'down'}`, verb: up ? 'Ride up' : 'Ride down', name: up ? 'to the rooftop' : 'to the street', distance: fd, at: front,
        refused: up && (up.preview || !this.sim.grid.isPlayable(up.id)) ? this.lockedReason(up.id) : undefined,
        run: () => this.rideLift(lift),
      });
    }
    const aim = this.building() ? this.buildAim() : undefined;
    const p = aim ? aim.p : this.frontPick();
    if (!p?.tile) return out;
    const tile = p.tile;
    const sc = () => aim ?? this.botTileScreen(tile);
    const dist = Math.hypot(tile.x + 0.5 - b.pose.x, tile.z + 0.5 - b.pose.z);
    const occ = this.sim.occupant(tile);
    const dec = this.cozy.decorOf(tile.occupantId);
    if (this.resting && !aim) out.push(...this.resting.candidates(tile, dist)); // E23.2.3: benches and chargers
    // E23.2.2.3: a buried find the ripple revealed: dig it up
    const buried = !aim && tile.roofId === GROUND ? this.sim.buried.known(tile.x, tile.z) : undefined;
    if (buried) {
      const room = this.sim.inventory.room(buried.material) > 0;
      out.push({
        kind: 'cache', id: buried.id, verb: 'Dig up', name: `buried ${MATERIALS[buried.material].name}`, distance: dist, at: tile,
        refused: room ? undefined : 'Backpack full',
        run: () => {
          if (this.sim.buried.dig(tile.x, tile.z) > 0) this.bot?.visuals.play('interact');
        },
      });
    }
    if (dec) {
      out.push({
        kind: 'decoration', id: `decor:${tile.occupantId}`, verb: 'Pick up', name: DECOR_OPTION[dec.kind]?.name ?? 'the decoration', distance: dist, at: tile,
        run: () => this.botAnim(this.removeDecorAt(p, sc().x, sc().y, true)),
      });
    } else if (occ && !out.some((c) => c.id.endsWith(`:${occ.id}`))) {
      const area = occ.type === 'core' ? this.sim.areas.areaOf(occ) : undefined;
      const lmName = area === PARK ? 'the fountain' : area ? this.sim.areas.info(area).landmarkName : undefined;
      const ready = occ.type === 'core' && this.landmarkReady(occ);
      const tripped = this.sim.power.isTripped(occ); // E23.3: lightning tripped this pole; one press resets it
      out.push({
        kind: lmName ? 'landmark' : 'machine', id: `m:${occ.id}`, verb: ready ? 'Wake' : tripped ? 'Reset' : 'Look at', name: lmName ?? machineName(occ), distance: dist, at: tile,
        frame: { roofId: occ.roofId, x: occ.x, z: occ.z, size: occ.size },
        run: () => {
          if (this.sim.power.reset(occ)) return b.visuals.play('interact');
          const r = this.actAt(p, sc().x, sc().y, 'inspect', false);
          this.botAnim(r);
          if (r === 'select') this.focusPanelForKeys();
        },
      });
    } else {
      const plot = this.openablePlot(p.roofId, tile.x, tile.z);
      if (plot)
        out.push({
          kind: 'plot', id: `plot:${p.roofId}:${plot.x},${plot.z}`, verb: 'Choose what grows on', name: 'this plot', distance: dist, at: tile,
          frame: { roofId: p.roofId, x: plot.x, z: plot.z, size: plot.size },
          run: () => {
            this.select(undefined);
            b.visuals.play('interact');
            this.openPlotPicker(plot);
          },
        });
    }
    return out;
  }

  /**
   * E21 through E22.2's one prompt: a salvage pile, a Keeper, a lookout, a gate, the fountain, a sleeping landmark
   * or the store in front of bloombot. The Old City controller acts on them (and runs their holds).
   */
  private oldCityCandidates(f: { x: number; z: number }, front: TileData | undefined, fd: number): InteractTarget[] {
    const s = this.sim;
    const oc = this.oc!;
    const b = this.bot!;
    if (b.pose.roofId !== GROUND) return [];
    const occ = front ? s.occupant(front) : undefined;
    const run = () => void oc.interact(f, occ);
    const out: InteractTarget[] = [];
    // E23.7.1.3: a night find in front (glowing seeds, something glinting), and the house's bed from dusk
    const nf = s.nightFinds.at(f.x, f.z);
    if (nf) {
      const g = NIGHT_FIND_GIVES[nf.kind];
      out.push({ kind: 'salvage', id: `night:${nf.id}`, verb: g.verb, name: g.name, distance: fd, at: front, refused: s.nightFinds.problem(nf.id), run: () => void s.nightFinds.take(nf.id) });
    }
    // E23.6.1: the crafting table is in the house (the shed by the fountain) from the start. Facing the shed's walls
    // uses the table (listed first, so it wins the tie); the door in front of it is for the radio and the bed.
    const sh = PARK_SET.shed;
    if (f.x >= sh.x && f.x < sh.x + sh.size && f.z >= sh.z && f.z < sh.z + sh.size)
      out.push({
        kind: 'door', id: 'craft:table', verb: 'Use', name: 'the crafting table', distance: fd, at: front, frame: { roofId: GROUND, x: sh.x, z: sh.z, size: sh.size },
        run: () => {
          this.oc?.panel.close();
          this.hud.craft.open();
          this.syncPanelPause();
        },
      });
    // the house: its radio's forecast by day, its bed from dusk
    if (this.atHouse(f) && !s.clock.canSleep()) out.push({ kind: 'door', id: 'house:radio', verb: 'Listen to', name: 'the radio', distance: fd, at: front, run: () => this.listenToRadio() });
    if (this.atHouse(f) && s.clock.canSleep()) out.push({ kind: 'door', id: 'house:sleep', verb: 'Sleep', name: 'until morning', distance: fd, at: front, run: () => this.sleep() });
    const pile = s.salvage.pileAt(f.x, f.z);
    if (pile) out.push({ kind: 'salvage', id: `pile:${pile.id}`, verb: 'Salvage', name: MATERIALS[pile.material].name, distance: fd, at: front, ocHold: SALVAGE.holdSeconds, refused: s.salvage.problem(pile.id), run });
    const keeper = s.keepers.at(f.x, f.z);
    if (keeper && s.keepers.visible(keeper.id)) out.push({ kind: 'keeper', id: `keeper:${keeper.id}`, verb: keeper.id === 'tally' && s.landmarks.canTrade() ? 'Trade with' : 'Talk to', name: keeper.name, distance: fd, at: front, run });
    const page = s.journal.pageAt(f.x, f.z);
    if (page) out.push({ kind: 'cache', id: `page:${page}`, verb: 'Read', name: s.journal.found(page) ? 'the page again' : 'the page', distance: fd, at: front, run });
    const sp = setPieceAt(f.x, f.z);
    if (sp?.kind === 'lookout') out.push({ kind: 'gate', id: `lookout:${sp.id}`, verb: 'Look out', name: '', distance: fd, at: front, run });
    const gate = s.gates.gateAt(f.x, f.z);
    if (gate) out.push({ kind: 'gate', id: `gate:${gate.id}`, verb: gate.kind === 'barricade' ? 'Pry' : 'Repair', name: '', distance: fd, at: front, ocHold: gate.kind === 'barricade' ? SALVAGE.pryHoldSeconds : undefined, refused: s.gates.problem(gate), run });
    if (occ?.type === 'core' && s.areas.areaOf(occ) === PARK)
      out.push({ kind: 'landmark', id: `fountain:${occ.id}`, verb: 'Bring things to', name: 'the fountain', distance: fd, at: front, frame: { roofId: occ.roofId, x: occ.x, z: occ.z, size: occ.size }, run });
    else if (occ?.type === 'core') {
      const r = s.landmarks.regionAt(occ.x, occ.z);
      if (r && s.areas.fog(r.id) !== 'cleared') out.push({ kind: 'landmark', id: `lm:${occ.id}`, verb: 'Wake', name: `the ${r.landmark.name}`, distance: fd, at: front, frame: { roofId: occ.roofId, x: occ.x, z: occ.z, size: occ.size }, run });
      else if (s.inventory.accessPoints().some((p) => p.x === occ.x && p.z === occ.z && p.roofId === occ.roofId)) out.push({ kind: 'storage', id: `store:${occ.id}`, verb: 'Open', name: 'the store', distance: fd, at: front, frame: { roofId: occ.roofId, x: occ.x, z: occ.z, size: occ.size }, run });
    } else if (occ?.type === 'chest') out.push({ kind: 'storage', id: `chest:${occ.id}`, verb: 'Open', name: 'the chest', distance: fd, at: front, frame: { roofId: occ.roofId, x: occ.x, z: occ.z, size: occ.size }, run });
    // E23.5.2: a planter: Harvest when ripe, otherwise Plant in or Tend it
    if (occ?.type === 'planter') {
      const lk = s.farm.look(occ);
      out.push({ kind: 'machine', id: `planter:${occ.id}`, verb: lk.ripe ? 'Harvest' : lk.crop ? 'Tend' : 'Plant in', name: lk.ripe ? CROPS[lk.crop!].name : 'the planter', distance: fd, at: front, frame: { roofId: occ.roofId, x: occ.x, z: occ.z, size: occ.size }, run: () => oc.planter(occ) });
    }
    // E23.5.1: flowered, restored ground in front can be clipped for biomass
    if (!pile && s.gather.canGather(front))
      out.push({ kind: 'salvage', id: `gather:${front.id}`, verb: 'Gather', name: 'clippings', distance: fd, at: front, ocHold: GATHER.holdSeconds, refused: s.gather.problem(front), run: () => oc.gatherHold(front) });
    // E23.6.4: a supply crate opens its own panel (its things, and the courier routes from it)
    if (occ?.type === 'crate')
      out.push({
        kind: 'storage', id: `crate:${occ.id}`, verb: 'Open', name: 'the crate', distance: fd, at: front, frame: { roofId: occ.roofId, x: occ.x, z: occ.z, size: occ.size },
        run: () => {
          this.oc?.panel.close();
          this.hud.crate.open(occ);
          this.syncPanelPause();
        },
      });
    return out;
  }

  private interactTarget(): InteractTarget | undefined {
    return pickTarget(this.interactCandidates());
  }

  /** E22.3: an action's button as a glyph from the set in use (a rebound action shows its new input). */
  private glyph(a: Action): string {
    return actionGlyph(this.bindings, a, this.glyphs.style);
  }

  /** E22.2: the prompt for this frame: the Interact target (or why not), and Pulse when it also applies. */
  private promptModel(target: InteractTarget | undefined): PromptModel | undefined {
    if (this.resting?.active) return this.resting.prompt();
    const b = this.bot!;
    if (this.building()) {
      const tool = this.hud.currentTool;
      const dk = decorType(tool);
      const what = dk ? `Place ${DECOR_OPTION[dk]?.name ?? 'it'}` : tool === 'remove' ? 'Remove' : machineTool(tool) ? `Build the ${MACHINES[tool].name}` : '';
      return what ? { glyph: this.glyph(this.glyphs.style !== 'keys' ? 'place' : 'pulse'), text: what } : undefined;
    }
    const f = b.front();
    const t = this.sim.grid.get(b.pose.roofId, f.x, f.z);
    const chk = t && !t.occupantId ? this.sim.restoration.checkPulse(t) : undefined;
    const pulse = chk?.ok ? { glyph: this.glyph('pulse'), text: t!.ground === 'restored' ? 'Nurture' : 'Pulse' } : undefined;
    if (!target) return pulse ? { glyph: pulse.glyph, text: pulse.text } : undefined;
    const hold = holdFor(target, this.settings.holdToAct !== false) || (target.ocHold && this.settings.holdToAct !== false ? target.ocHold : 0);
    const h = this.holding;
    return {
      glyph: this.glyph('interact'),
      text: promptText(target),
      hold: hold > 0,
      progress: h && h.id === target.id ? h.t / h.need : target.ocHold ? (this.oc?.holdProgress() ?? 0) : 0,
      refused: target.refused,
      pulse,
    };
  }

  /** E21: what the Old City controller borrows from the game. */
  private oldCityHost() {
    return {
      sim: this.sim,
      hud: this.hud,
      bot: this.bot!,
      bindings: this.bindings,
      game: this,
      // E23.9.1: a page read from its post opens the journal at it
      openPage: (id: string) => {
        this.oc?.panel.close();
        this.hud.backpack.openPage(id);
        this.syncPanelPause();
      },
      // E22.6: the store opens as the backpack's Items grid with the store beside it
      openStorage: (title: string) => {
        this.oc?.panel.close();
        this.hud.backpack.open('items', title);
        this.syncPanelPause();
      },
      screenOf: (x: number, z: number) => {
        const t = this.sim.grid.get(this.bot!.pose.roofId, x, z);
        return t ? this.botTileScreen(t) : { x: innerWidth / 2, y: innerHeight / 2 };
      },
      sound: (name: string, material?: string) => {
        if (name === 'tier' || name === 'wake') this.sfx.fanfare();
        else if (name === 'deliver') this.sfx.coin();
        else if (name === 'pry') this.sfx.stage('crack');
        // a sound per material
        else if (name === 'salvage') this.sfx.stage(({ biomass: 'rustle', scrap: 'thud', seeds: 'rustle', copper: 'hum', timber: 'creak', glass: 'crack', clay: 'thud', gears: 'grind', sunstone: 'hum' } as const)[material as 'scrap'] ?? 'thud');
        else this.sfx.click();
      },
      vista: (x: number, z: number, secs: number, done: (seen: string[]) => void) => this.vista(x, z, secs, done),
      keeperScreen: (id: string) => {
        const p = this.keepers?.headWorld(id);
        const s = p && this.camera.onScreen(p, 20);
        return s ? { x: s.x, y: s.y } : undefined;
      },
      markTile: (x: number, z: number) => {
        const t = this.sim.grid.get(GROUND, x, z);
        if (t) this.chunks.markTile(t);
      },
    };
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

  /** Bloombot (G.11): from the map's overview only (third person has no cursor): travel, or walk to and act. */
  private botClick(x: number, y: number) {
    const b = this.bot!;
    const catId = this.catHit(x, y);
    if (catId) {
      const v = this.cat.targetWorld(catId) ?? new pc.Vec3(b.world()[0], 0, b.world()[2]);
      const l = this.sim.grid.layer(b.pose.roofId)!;
      const claim = () => {
        this.sim.cat.claim(catId);
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
    if (this.oc?.click(p.tile)) return; // E21.2: a pile: walk there and salvage it
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
    if (occ) rect = { x: occ.x, z: occ.z, size: occ.size };
    else if (machineTool(tool)) {
      const a = this.sim.build.anchorFor(tool, p.fx, p.fz);
      rect = { x: a.x, z: a.z, size: MACHINES[tool].size };
    }
    const tile = p.tile;
    const go = b.goTo(p.roofId, rect.x, rect.z, rect.size, () => {
      const sc = this.botTileScreen(tile);
      this.botAnim(this.actAt(p, sc.x, sc.y, tool, false));
    });
    if (!go) this.hud.showFail("Bloombot can't find a way there", x, y);
  }

  private pointerRecent(): boolean {
    if (this.bot && !this.overviewOn) return false;
    return this.pointer.inside && performance.now() - this.pointerAt < 1500;
  }

  /** Bloombot (G.4): highlight the tile in front and preview what E would do there (yields to an active mouse). */
  private updateBotPreview() {
    if (!this.bot) return;
    // E22.3: the glyph set follows the last device used; every glyph on screen swaps in the same frame.
    if (this.bot.lastInput !== this.glyphs.device) {
      this.glyphs.device = this.bot.lastInput;
      if (this.glyphs.device === 'pad') this.glyphs.sensePad(typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : undefined);
    }
    if (this.glyphs.style !== this.keyMapShown) {
      this.keyMapShown = this.glyphs.style;
      if (this.photo.active) this.photoBar.render(this.photo.state); // its key names follow the device too
      this.hud.setKeyMap(this.glyphs.style, this.bindings);
    }
    if (this.cinematic || this.photo.active || this.panelOpen()) {
      this.holding = undefined;
      this.hud.prompt.show(undefined);
      return;
    }
    // E22.2: one prompt, every frame (the hold ring fills smoothly); the target gets a soft outline.
    const target = this.interactTarget();
    this.updateHold(this.frameDt, target);
    this.hud.prompt.show(this.promptModel(target));
    if (this.updateBuildPreview()) return; // E19.2: build mode aims the hologram itself
    if (this.pointerRecent()) return;
    const p = this.frontPick();
    const now = performance.now();
    const key = `${this.bot.pose.roofId}:${this.bot.front().x},${this.bot.front().z}|${p?.roofId}:${p?.tile?.x},${p?.tile?.z}|${this.hud.currentTool}|${p?.tile?.ground}|${p?.tile?.bloom}|${this.bot.lastInput}|${target?.id}`;
    if (key === this.botPreviewKey && now - this.botPreviewAt < 400) return;
    this.botPreviewKey = key;
    this.botPreviewAt = now;
    if (target?.frame || (target && (target.kind === 'gate' || target.kind === 'cat'))) {
      // The target's soft outline; the prompt says the rest (no tooltip over the world).
      this.overlays.hideGhost();
      this.overlays.hideRadius();
      const fr = target.frame ?? (target.at && { roofId: target.at.roofId, x: target.at.x, z: target.at.z, size: 1 });
      if (fr && target.kind !== 'cat') this.overlays.showFrame(fr.roofId, fr.x, fr.z, fr.size, 'info');
      else this.overlays.hideFrame();
      this.hud.hideTip();
      return;
    }
    if (!p?.tile) {
      this.previewAt(undefined, 0, 0);
      return;
    }
    this.previewFromBot = true;
    try {
      this.previewAt(p, 0, 0);
    } finally {
      this.previewFromBot = false;
    }
    this.hud.hideTip(); // E22.2: walking, the prompt speaks; the frame and footprint stay
  }

  pick(x: number, y: number): Pick | undefined {
    const { o, d } = this.camera.ray(x, y);
    // The endless ground only once it's playable (the rooftop campaign shows it as scenery).
    const layers = this.sim.grid.allLayers.filter((l) => l.kind === 'raised' || l.unlocked);
    const hit = pickLayers(layers, o, d);
    if (!hit) return undefined;
    // E21.24: the Old City's terraces: the first ground the ray meets as drawn (terraces, slopes, sunk fog)
    if (hit.layerId === GROUND && this.sim.grid.terraced(GROUND)) {
      const l = this.sim.grid.layer(GROUND)!;
      const tp = pickTerraced(o, d, l.origin[1] + l.height + SLAB_TOP, (x, z) => heightAt(x, z) - (this.sunkAt(x, z) ? SINK / OLD_CITY.levelHeight : 0));
      return tp ? { roofId: GROUND, fx: tp.fx, fz: tp.fz, tile: this.sim.grid.get(GROUND, Math.floor(tp.fx), Math.floor(tp.fz)) } : undefined;
    }
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

  /** E21.24: world y of the ground's top under a point as drawn (terraces, slopes, fog sunk; the picking e2e reads it). */
  groundY(px: number, pz: number): number {
    const l = this.sim.grid.layer(GROUND)!;
    return l.origin[1] + l.height + SLAB_TOP + (this.sim.grid.terraced(GROUND) ? levelY(heightAt(px, pz)) : 0) - (this.city && this.sunkAt(px, pz) ? SINK : 0);
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
    // E21.22: and whatever stands between the camera and bloombot
    const through = this.bot ? (([x, y, z]) => new pc.Vec3(x, y + 0.45, z))(this.bot.world()) : undefined;
    // In the Old City every building can fade, so only the sight line to bloombot fades one: the view's middle and
    // the cursor would ghost whole blocks the player is just looking at.
    if (w && h && !this.cinematic) this.chunks.fadeTowers(dt, this.camera.cam, through ? [] : keep, through);
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
    // E23.7.2: fog (and rain) shorten the view
    const view = this.weatherVisuals?.view ?? 1;
    c.hazeStart *= view * view * view;
    c.hazeEnd *= view * view;
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
    const piece = this.sim.salvage.describe(t); // E21: Old City set pieces
    if (piece) return piece.title;
    if (t.blocked) return 'Rusty vent';
    switch (t.ground) {
      case 'polluted':
        return OLD_DEAD_NAME[t.feature ?? 'lawn'] ?? 'Dead ground';
      case 'prepared':
        return 'Mossy soil';
      case 'growing':
        return 'Sprouting…';
      case 'restored':
        return BLOOM_NAMES[t.bloom] ?? 'Garden';
    }
  }

  private onHover(x: number, y: number) {
    // Third person: bloombot's play has no cursor on the world (the map's overview aside); what bloombot faces,
    // or the build crosshair, is what the preview shows.
    if (this.bot && !this.overviewOn) return;
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
    this.powerFocus = p ? { roofId: p.roofId, x: p.fx, z: p.fz } : undefined; // E23.3.4: the Power view highlights the network here
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
        `<b>${def.icon} ${def.name}</b>${def.blurb}<br>${chk.ok ? `<span class="ok">${this.press('E')} to build</span>` : `<span class="bad">${chk.reason}</span>`}`,
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
    if (this.sim.salvage.describe(t)) action = '';
    else if (chk.ok) action = `<span class="ok">${t.ground === 'restored' ? 'Pulse to help it flower' : 'Pulse to bring it back'}</span>`;
    else if (chk.reason && !maxed) action = `<span class="bad">${chk.reason}</span>`;
    this.hud.showTip(x, y, `<b>${this.tileTitle(t)}</b>${this.tileDetail(t)}${action ? '<br>' + action : ''}${this.plotLine(t.roofId, t)}`);
  }

  // ───────────── E19.2: build mode and decorations ─────────────

  private buildKey = '';
  private buildAt = 0;

  /** Does the mouse aim builds (over the world, moved lately, and the pad isn't what was used last)? */
  private mouseAims(): boolean {
    return !this.bot && this.pointer.inside && performance.now() - this.pointerAt < MOUSE_AIM_MS;
  }

  /** Where a build is aimed, and where on screen to say so: the pointer's tile, or the tile in front of bloombot. */
  private buildAim(): { p?: Pick; x: number; y: number } {
    if (this.mouseAims()) return { p: this.pick(this.pointer.x, this.pointer.y), x: this.pointer.x, y: this.pointer.y };
    if (this.bot) {
      const p = this.crosshairPick();
      if (p?.tile) {
        const sc = this.botTileScreen(p.tile);
        return { p, x: sc.x, y: sc.y };
      }
    }
    const p = this.frontPick();
    const sc = p?.tile ? this.botTileScreen(p.tile) : { x: innerWidth / 2, y: innerHeight / 2 };
    return { p, x: sc.x, y: sc.y };
  }

  /**
   * Third person: where the build crosshair (the middle of the screen) meets bloombot's ground, kept between one
   * tile and the build reach from bloombot. Looking down places close, looking ahead places further; past the
   * reach (or at the sky, or onto another layer) the aim stops at the reach in the direction the camera faces.
   */
  private crosshairPick(): Pick | undefined {
    const b = this.bot;
    if (!b) return undefined;
    const c = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    const hit = c.clientWidth ? this.pick(c.clientWidth / 2, c.clientHeight / 2) : undefined;
    const reach = DECOR_GEN.reach - 0.5;
    let fx: number;
    let fz: number;
    if (hit && hit.roofId === b.pose.roofId) {
      fx = hit.fx;
      fz = hit.fz;
    } else {
      const f = this.camera.entity.forward;
      const l = Math.hypot(f.x, f.z) || 1;
      fx = b.pose.x + (f.x / l) * reach;
      fz = b.pose.z + (f.z / l) * reach;
    }
    let dx = fx - b.pose.x;
    let dz = fz - b.pose.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      dx = Math.sin(b.pose.facing);
      dz = Math.cos(b.pose.facing);
      d = 1;
    }
    const want = Math.min(reach, Math.max(1, d));
    fx = b.pose.x + (dx / d) * want;
    fz = b.pose.z + (dz / d) * want;
    const tile = this.sim.grid.get(b.pose.roofId, Math.floor(fx), Math.floor(fz));
    return tile ? { roofId: b.pose.roofId, fx, fz, tile } : undefined;
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
    if (this.glyphs.style !== 'keys') return `${this.hudKey('rotateBack')} / ${this.hudKey('rotate')} to turn`;
    return `${this.bindings.keys.rotate.map(keyLabel).join(' or ')} to turn`;
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
    const line = LIGHT[kind]?.line ? this.sim.lights.poleNear(p.roofId, t.x, t.z) : undefined;
    if (LIGHT[kind]?.line) {
      // a line light shows on the pole it would hang on
      this.overlays.hideGhost();
      if (line) this.overlays.showFrame(line.roofId, line.x, line.z, line.size, why ? 'bad' : 'ok');
      else this.overlays.showFrame(p.roofId, t.x, t.z, 1, 'bad');
    } else this.overlays.showGhost(p.roofId, t.x, t.z, 1, !why, 0.4, this.bot ? { kind: 'decor', decor: kind, rot: this.buildRot } : undefined);
    const how = line ? `${this.press('E')} to hang it on this pole` : `${this.press('E')} to place${this.bot ? ` · ${this.turnHint()}` : ''}`;
    const kindNote = LIGHT[kind]?.line ? 'On the pole’s lines' : o?.solid ? 'Solid' : 'Walk over it';
    this.hud.showTip(x, y, `<b>${o?.icon ?? ''} ${o?.name ?? kind}</b>${o?.blurb ?? ''} <small>${kindNote} · free</small><br>${why ? `<span class="bad">${why}</span>` : `<span class="ok">${how}</span>`}`);
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
    // E23.3.5: line lights hang on a power pole's lines (aim at the pole) instead of standing on a tile
    if (LIGHT[kind]?.line) {
      const o = DECOR_OPTION[kind];
      if (o && !this.cozy.isDecorUnlocked(o)) return `Unlocks when ${this.cozy.hint(o.unlock)}`;
      const hang = this.sim.lights.canHang(kind, roofId, x, z);
      if (hang) return hang;
      const pole = this.sim.lights.poleNear(roofId, x, z)!;
      return this.inReach(roofId, pole.x, pole.z, pole.size) ? undefined : TOO_FAR;
    }
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
    const line = !!LIGHT[kind]?.line;
    const why = this.decorProblem(kind, p.roofId, t.x, t.z) ?? (line ? this.sim.lights.hang(kind, p.roofId, t.x, t.z) : this.cozy.placeDecor(kind, this.buildRot, p.roofId, t.x, t.z));
    if (why) {
      this.hud.showFail(why, x, y);
      return 'none';
    }
    if (line) {
      this.sfx.build();
      this.vfx.burst(this.tileVec(t, SLAB_TOP + 1.0), 8, { up: 1.2, size: 0.04, life: 0.8 });
      this.buildKey = '';
      return 'select';
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
    // E21.3: the remove tool also takes down a machine, giving its whole recipe back
    const occ = !d && !pickUp ? this.sim.occupant(t) : undefined;
    // E23.3.5: a pole with lights on its lines: the lights come down first (the pole stays)
    const poleLights = !d ? this.sim.lights.onPole(this.sim.occupant(t)) : undefined;
    if (poleLights) {
      if (!this.inReach(p.roofId, t.x, t.z, 1)) {
        this.hud.showFail(TOO_FAR, x, y);
        return 'none';
      }
      this.sim.lights.unhang(this.sim.occupant(t));
      this.sfx.click();
      if (pickUp) this.selectTool(`decor:${poleLights}`);
      this.buildKey = '';
      return 'select';
    }
    if (occ && occ.type !== 'core' && !occ.starter) {
      if (!this.inReach(p.roofId, t.x, t.z, 1)) {
        this.hud.showFail(TOO_FAR, x, y);
        return 'none';
      }
      if (this.sim.build.remove(occ.id)) {
        this.machines.remove(occ.id);
        for (const c of this.sim.grid.footprint(occ.roofId, occ.x, occ.z, occ.size)) if (c) this.chunks.markTile(c);
        this.hud.toast(`${machineName(occ)} taken down<small>Everything it was built from is back in your backpack.</small>`, '', 2.4);
        return 'build';
      }
    }
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
    for (const o of this.cozy.checkDecorUnlocks()) this.hud.toast(`${o.icon} New decoration: ${o.name}<small>${o.blurb} It’s in the build menu (${this.hudKey('buildMenu')}), free to place.</small>`, 'gold', 4.5);
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
    const piece = this.sim.salvage.describe(t); // E21: Old City set pieces
    if (piece) return piece.detail;
    if (t.blocked) return 'Nothing grows here.';
    const zone = this.sim.production.inPollinatorZone(t);
    switch (t.ground) {
      case 'polluted': {
        const left = this.sim.cultivators.remaining(t);
        if (left !== undefined) return `🚜 The Cultivator is softening this slab — ${Math.ceil(left)} s to bloom. Pulse it to knock it along.`;
        return 'Dead and grey. A pulse brings it back.';
      }
      case 'prepared':
        return zone ? '🌸 Inside a garden zone — may set off a Bloom Chain!' : 'Ready to bloom — cheaper to restore.';
      case 'growing':
        return `${this.stageName(t) ?? 'Roots are breaking through'} — ${Math.max(1, Math.ceil(t.growthRemainingSec))} s`;
      case 'restored':
        return t.bloom >= TUNING.restore.fullBloom ? 'In flower.' : 'Alive again. Pulse it again to help it flower.';
    }
  }

  private onClick(x: number, y: number, button: number) {
    if (this.cinematic || this.photo.active) return;
    if (this.bot) {
      // E22.1: mouse buttons are bindable: the pulse button uses the tool on the aimed tile (walking there first if
      // it's out of reach); any other bound button does its action.
      // Third person: the pulse button acts on what bloombot faces (or, building, on the crosshair's hologram);
      // only the map's overview still takes a pointer (travel to a woken landmark).
      const a = this.resolveKey(`Mouse${button}`);
      if ((a === 'pulse' || a === 'place') && this.overviewOn) this.botClick(x, y);
      else if (a === 'pulse' || a === 'place') this.botAct();
      else if (a && a !== 'look') this.doAction(a);
      return;
    }
    if (button !== 0) return;
    const catId = this.catHit(x, y);
    if (catId) {
      this.sim.cat.claim(catId);
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

  /** E18: what a drone of this role is doing, in words. */
  private droneLabel(role: DroneRole, status: 'working' | 'travelling' | 'napping' | 'waitingEnergy'): string {
    const work: Record<DroneRole, string> = {
      restorer: 'restoring a tile',
      gardener: 'watering tiles',
      scout: 'pushing back the fog',
      courier: 'delivering charge',
      spark: 'sparking a chain',
      harvester: 'gathering biomass for the store',
    };
    const idle: Record<DroneRole, string> = {
      restorer: 'napping — nothing to do in range',
      gardener: 'napping — nothing in reach can grow',
      scout: 'napping — nothing left to restore in reach',
      courier: 'napping — no machine needs charge yet',
      spark: 'resting — one chain per 30 s, or no garden cluster in reach',
      harvester: 'napping — nothing in reach has flowered',
    };
    const wait = 'waiting at home — its hub has no power'; // E23.3.3: the only wait is the grid
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
        const note = on ? 'In use' : owned ? 'Owned' : st.reason && !st.reason.startsWith('Needs ') ? esc(st.reason) : `<span class="${st.ok ? '' : 'short'}">${st.price} Biomass</span>`;
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

  private renderInspect() {
    const m = this.sim.machine(this.selected);
    if (!m) return this.hud.renderInspect(null);
    const s = this.sim;
    let extra = '';
    switch (m.type) {
      case 'solar': {
        // E23.1.4: in words (no rates); what it makes goes into the grid
        const shining = s.power.output(m) > 0;
        const boosted = m.boostUntil > s.time;
        extra = `<p class="stat">${shining ? 'Shining into the grid' : 'Resting until the sun is up'}${boosted ? ' · a bloom beside it makes it shine brighter' : ''}${inSurge(s, m) ? ' · the Lucky Cat’s sunshine' : ''}</p><p>Restore tiles right next to it and it shines brighter for a few seconds.</p>`;
        break;
      }
      case 'condenser': {
        const near = s.grid.tilesNear(m, TUNING.condenser.radius);
        const mossy = near.filter((t) => t.ground === 'prepared').length;
        const pct = Math.round(((m.charge ?? 0) / TUNING.condenser.threshold) * 100);
        extra = `<p class="stat">🌧️ Watering charge ${pct}% · ${mossy} dry tile${mossy === 1 ? '' : 's'} beside it</p><p>When full, it waters the dry soil next to it into bloom and starts a chain. ${mossy ? '' : 'Pulse a neighbour so moss appears beside it.'}</p>`;
        break;
      }
      case 'pollinator': {
        const zone = s.grid.tilesNear(m, s.upgrades.pollinatorReach(m));
        const mossy = zone.filter((t) => t.ground === 'prepared').length;
        const green = zone.filter((t) => t.ground === 'restored').length;
        extra = `<p class="stat">🌸 Zone radius ${s.upgrades.pollinatorReach(m)} · ${green}/${zone.length} blooming (×${s.upgrades.gardenMult(m)} 🌿)</p><p class="stat">✨ ${mossy} mossy tiles ready to chain</p><p>Restore a tile right next to it: it pollinates another neighbour (up to ${s.upgrades.pollinatorTriggers}× per chain). Line gardens, panels and the Mother Tree up so chains jump between them.</p>`;
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
          this.rolePicker(m);
        break;
      }
      case 'relay': {
        const linked = s.relays.linked(m);
        const ready = linked.filter((o) => s.relays.ready(relayLinkId(m, o))).length;
        extra = `<p class="stat">📡 Linked to ${linked.length} relay${linked.length === 1 ? '' : 's'} within ${s.relays.range(m)} tiles · ${ready} ready</p><p>Each pulse blooms ${s.relays.targets(m)} tiles around this relay when a chain arrives, and can pass it on. Links recharge for ${TUNING.relay.cooldown} s.${linked.length ? '' : ' <b>Build another Bloom Relay within range to link them.</b>'}</p>`;
        break;
      }
      case 'motherTree': {
        const pct = Math.round(((m.charge ?? 0) / TUNING.motherTree.threshold) * 100);
        extra = `<p class="stat">🌳 Charge ${m.charge ?? 0}/${TUNING.motherTree.threshold} (${pct}%)</p><p>Each restoration or new bloom within ${s.upgrades.treeRadius(m)} tiles adds charge. When full, it releases a Bloom Pulse over that whole area. Its own pulse can't recharge it.</p>`;
        break;
      }
      case 'reservoirGarden': {
        const R = TUNING.neighbourhood.reservoir;
        const conds = s.state.machines.filter((x) => x.type === 'condenser' && x.roofId === m.roofId && distToFootprint(x.x, x.z, m.x, m.z, m.size) <= R.condenserRange).length;
        const dry = s.chains.overflowTargets(m, 99).length;
        extra = `<p class="stat">⛲ Basin ${Math.floor(m.charge ?? 0)}/${R.threshold} · ${conds} 💧 condenser${conds === 1 ? '' : 's'} within ${R.condenserRange} tiles fill it</p><p class="stat">🌱 ${dry} dry tile${dry === 1 ? '' : 's'} within ${R.radius} tiles (highlighted) · Overflow irrigates up to ${R.targets}</p><p>Each time a nearby Water Condenser fills its meter, the basin rises. Full → Overflow: the closest dry tiles burst into lush bloom.${conds ? '' : ' <b>Build a Water Condenser within 2 tiles to fill it.</b>'}</p>`;
        break;
      }
      // E23.6.4: a supply crate, and (E23.6.5) the Assembler and what it makes
      case 'crate': {
        const a = s.automation;
        const routes = a.routes().filter((r) => r.from === m.id || r.to === m.id).length;
        extra = `<p class="stat">🧺 ${crateName(s, m.id)} · ${a.load(m.id)} of ${AUTOMATION.crate.capacity} inside${routes ? ` · ${routes} courier route${routes === 1 ? '' : 's'}` : ''}</p>`;
        break;
      }
      case 'assembler': {
        const a = s.automation;
        const { input, output } = a.io(m);
        const recipe = a.recipeOf(m);
        const why = a.assemblerProblem(m);
        const io = input ? `<p class="stat">🧺 Takes from ${crateName(s, input.id)} · puts in ${crateName(s, output!.id)}</p>` : '';
        const picks = s.crafting
          .components()
          .map((r) => `<button class="role-btn${r.id === recipe ? ' on' : ''}" data-asm="${m.id}|${r.id}" aria-pressed="${r.id === recipe}"><span class="ri">${materialIcon(r.id, 22)}</span><span class="rn">${esc(itemDef(r.id).name)}</span></button>`)
          .join('');
        extra = `<p class="stat">${why ? esc(why) : `Making ${esc(itemDef(recipe!).name)}`}</p>${io}<p class="rh">What it makes</p><div class="role-row">${picks}${recipe ? `<button class="role-btn" data-asm="${m.id}|"><span class="rn">Stop</span></button>` : ''}</div>`;
        break;
      }
      case 'core': {
        // Every Core is an area landmark now (on the ground, or on a city rooftop).
        this.hud.renderInspect(this.landmarkHtml(m));
        return;
      }
    }
    if ((m.overchargeUntil ?? 0) > s.time) extra = `<p class="stat boost">⚡ Boosted by your pulse — next trigger +1 (${Math.ceil(m.overchargeUntil! - s.time)} s)</p>` + extra;
    this.hud.renderInspect(this.hud.machineHtml(m, extra));
  }

  // ───────────────────────── events → presentation ─────────────────────────

  private tileVec(t: TileData, up = SLAB_TOP): pc.Vec3 {
    const [x, y, z] = this.sim.grid.tileWorld(t);
    return new pc.Vec3(x, y + up, z);
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
    // E23.6.5: an Assembler's choice shows at once in its panel
    b.on('assembler.changed', ({ id }) => {
      if (this.selected === id) this.renderInspect();
    });
    b.on('area.revealed', ({ areaId }) => {
      this.chunks.markArea(areaId);
      const lm = s.areas.landmark(areaId);
      if (lm && !this.machines.view(lm.id)) this.machines.add(lm, true);
      this.updateCityBounds();
    });
    b.on('area.fogChanged', ({ areaId }) => this.chunks.markArea(areaId));
    b.on('area.unlocked', ({ areaId }) => {
      this.cloudWall.reducedMotion = !!this.settings.reducedMotion;
      this.cloudWall.sync(); // its wall rises and melts away
      this.chunks.markArea(areaId);
      for (const nb of s.areas.info(areaId).neighbours) this.chunks.markArea(nb); // soft fog edges
      const info = s.areas.info(areaId);
      // E21.5: an Old City region names itself; its backstreets open quietly
      if (info.region) this.hud.toast(`🔓 ${s.gates.regionById(info.region)!.name} is open!<small>The clouds lift. Find its Keeper and bring it back to life.</small>`, 'gold', 4);
      else if (!info.noLandmark) this.hud.toast(`🔓 ${AREA_TYPES[info.type].name} unlocked!<small>The fog lifts. Restore it to wake the ${info.landmarkName}.</small>`, 'gold', 4);
      if (!info.noLandmark) this.sfx.fanfare();
      this.save();
    });
    // a raised layer added to the world gets its roof drawn
    b.on('layer.added', ({ layerId }) => {
      const l = s.grid.layer(layerId);
      if (l) this.grid.addRoof(l);
    });
    b.on('area.ready', ({ areaId }) => {
      const lm = s.areas.landmark(areaId);
      if (lm) this.machines.setLandmarkState(lm.id, 'ready');
      if (areaId !== PARK) this.hud.toast(`✨ ${s.areas.info(areaId).landmarkName} is ready to wake!<small>Walk up and press ${this.hudKey('interact')} to clear this ${AREA_TYPES[s.areas.info(areaId).type].name.toLowerCase()}'s fog.</small>`, 'gold', 4);
    });
    b.on('area.cleared', ({ areaId }) => {
      this.onAreaCleared(areaId);
      this.cloudWall.sync(); // the newly sealed neighbours get their walls
    });
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
    // E23.2.2.3: the reveal ripple: a wide soft ring, then what it found glows for a few seconds (never a cat:
    // its targets come from the salvage data alone)
    b.on('pulse.ripple', ({ tileId, targets }) => {
      const t = s.grid.byTileId(tileId);
      if (!t) return;
      this.vfx.ring(this.tileVec(t), PALETTE[RIPPLE.tint], RIPPLE.radius, RIPPLE.ringSeconds);
      for (const g of targets) {
        const at = s.grid.get(GROUND, g.x, g.z);
        if (!at) continue;
        const d = Math.hypot(g.x - t.x, g.z - t.z);
        const hex = PALETTE[RIPPLE.found[g.kind]];
        for (let i = 0; i < RIPPLE.pings; i++)
          this.tweens.add(0.01, () => {}, {
            delay: RIPPLE.delayPerTile * d + i * (RIPPLE.seconds / RIPPLE.pings),
            done: () => (this.vfx.ring(this.tileVec(at), hex, RIPPLE.pingRadius, RIPPLE.pingSeconds), this.vfx.sparkles(this.tileVec(at), RIPPLE.sparkles, true)),
          });
      }
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
    b.on('chain.ended', ({ chainId, combo, crossings, areas }) => {
      if (areas >= 3) this.hud.feed(`🌸 Bloom chain ×${combo} swept ${areas} areas`);
      if (areas >= 6 && !potterPace(this.settings)) this.hud.toast(`🌸 A city-wide bloom! ×${combo}<small>It swept across ${areas} areas.</small>`, 'gold', 3);
      this.tileFx.release(`chain${chainId}`);
      if (crossings > 0) this.hud.feed(`📡 Chain crossed ${crossings} Bloom Relay link${crossings > 1 ? 's' : ''}`);
      if (combo < 2) return;
      this.hud.feed(`🌸 Bloom chain ×${combo}`);
      this.sfx.chainEnd(combo);
      if (combo >= 5 && !potterPace(this.settings)) {
        this.hud.toast(`🌸 BLOOM CHAIN ×${combo}!`, 'gold', 2.6);
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
    });
    b.on('upgrade.granted', ({ id, level, machineId }) => {
      if (id === 'droneSpeed') this.drones.restyle();
      this.machines.refreshUpgrades();
      const def = UPGRADE_BY_ID[id];
      this.celebrateUpgrade(id, `${def.icon} ${def.name} · level ${level}<small>${def.describe(level)}</small>`, machineId);
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
      this.hud.catReward(`${kind}${CAT_REWARD_NAMES[reward]}${extras ? ' + saved-up gifts' : ''}`, summary);
      this.save();
    });
    b.on('cat.moved', ({ catId }) => {
      const spot = catId ? this.sim.cat.find(catId) : this.sim.state.cat.active;
      if (spot) this.cat.show(spot, true);
      this.save();
    });
    b.on('cat.goldenRelay', () => this.machines.refreshUpgrades());
    // E23.2.1: the charge is a new concept: one short introduction the first time it runs out, then the meter shows it
    b.on('charge.empty', () => {
      const f = s.state.stats.firsts;
      if (f.chargeEmpty !== undefined) return;
      f.chargeEmpty = Math.round(s.time);
      this.hud.toast(`Out of charge<small>Bloombot walks slower and can't pulse. Press ${this.hudKeys('eat')} to eat biomass or food, or rest.</small>`, '', 6);
    });
    // E23.2.2.1: the load wheel is a new concept: one short introduction the first time bloombot carries something
    // to load (the ring shows with it); after that the wheel and the chip show it
    const introWheel = () => {
      if (!s.pulseLoad.introDue()) return;
      s.pulseLoad.introduced();
      this.hud.loadWheel.show(LOAD_WHEEL.introSeconds);
      this.hud.toast(`Bloombot can load its pulse<small>Press ${this.hudKeys('loadNext')} or ${this.hudKeys('loadPrev')} to choose what a pulse grows. Each loaded pulse uses one.</small>`, '', LOAD_WHEEL.introSeconds);
    };
    b.on('pack.changed', introWheel);
    introWheel();
    // E21.6: the Old City's fountain tiers: tier 1 is the water returning (the old fountain sequence); later tiers a toast
    // E21.22: the first time a region's gate opens, the camera rises for 2 s over it (a setting; off with reduced motion)
    b.on('gate.opened', ({ region }) => {
      const r = REGIONS.find((q) => q.id === region);
      if (!r || r.gate.opensRegion === false || this.settings.noVistas || this.settings.reducedMotion) return;
      if (!s.salvage.see(`vista:${region}`)) return;
      setTimeout(() => this.vista(r.landmark.x + 1, r.landmark.z + 1, 2, () => {}), 300);
    });
    b.on('fountain.tier', ({ tier }) => {
      this.applyFountainLook(false);
      this.celebrateTier(tier);
      if (tier === 1) return this.playCoreSequence();
      const t = TIERS[tier - 1];
      this.hud.toast(`⛲ ${t.name}!<small>${t.gives.join(' · ')}</small>`, 'gold', 6);
      this.sfx.fanfare();
      this.save();
    });
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
        this.sfx.at(t && this.tileVec(t), (q) => q.bloom(combo));
        break;
      }
      case 'CORRIDOR':
        if (from && to) {
          this.vfx.arc(from, to, '#7fe07a', 0.7);
          this.vfx.burst(to, 8, { up: 1.6, size: 0.05 });
        }
        break;
      case 'POLLINATE':
        if (from && to) {
          this.vfx.arc(from, to, PALETTE.pink, 0.6);
          this.vfx.burst(to, 6, { up: 1.2, size: 0.04, speed: 0.6 });
        }
        break;
      case 'PRODUCE_ENERGY':
        if (from && to) this.vfx.arc(from, to, PALETTE.gold, 0.5);
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
        break;
      }
      default:
        break;
    }
  }

  // ───────────────────────── core sequence ─────────────────────────

  /**
   * E21.24: a vista from a lookout: the camera pulls up and out over the city for `secs`, then returns to bloombot.
   * Any Cancel skips it; with reduced motion it cuts to the view and back (a still frame). `done` gets the Old City
   * regions whose landmark was on screen at the top of the view.
   */
  private vista(x: number, z: number, secs: number, done: (seen: string[]) => void, sweep = 0) {
    if (this.cinematic) return;
    const cam = this.camera;
    const before = { zoom: cam.zoom, yaw: cam.heading };
    const rm = !!this.settings.reducedMotion;
    this.cinematic = true;
    if (this.bot) this.bot.following = false;
    // look away from the park when far from it, toward the city centre when near it
    const toward = Math.atan2(x - 8, -(z - 8)) * (180 / Math.PI);
    cam.turnTo(Math.hypot(x - 8, z - 8) > 12 ? toward + 180 : before.yaw, rm);
    if (rm) cam.jumpZoom(0.35);
    cam.glide(x, 0, z, Math.max(cam.minZoom, 0.35));
    const seen = () => {
      const out: string[] = [];
      for (const r of REGIONS) {
        const t = this.sim.grid.get(GROUND, r.landmark.x, r.landmark.z);
        const y = t ? this.sim.grid.tileWorld(t)[1] + 3 : 3;
        if (cam.onScreen(new pc.Vec3(r.landmark.x + 1, y, r.landmark.z + 1), 0)) out.push(r.id);
      }
      return out;
    };
    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      done(seen());
      this.cinematic = false;
      cam.turnTo(before.yaw, rm);
      if (this.bot) {
        this.bot.following = true;
        const [bx, , bz] = this.bot.world();
        cam.glide(bx, 0, bz, before.zoom);
      }
      this.cinematicEnd = undefined;
    };
    this.cinematicEnd = end;
    // E21.12: a sweep turns the view past what's around (a still frame with reduced motion)
    if (sweep && !rm) {
      const from = cam.heading;
      this.tweens.add(secs, (k) => cam.turnTo(from + sweep * k));
    }
    this.tweens.add(0.01, () => {}, { delay: secs, done: end });
  }

  /** E21.6: the Old City fountain shows its tier (dry, trickle, flowing, lit, in bloom). */
  private applyFountainLook(instant: boolean) {
    const tier = this.sim.state.salvage?.tier ?? 0;
    const park = this.sim.areas.landmark(PARK);
    if (!park || tier < 1) return;
    this.machines.setFountainLook(park.id, TIERS[tier - 1].look, instant);
  }

  /** E21.6: a short celebration per tier: rings and sparks from the fountain, a fanfare. */
  private celebrateTier(tier: number) {
    const park = this.sim.areas.landmark(PARK);
    if (!park) return;
    const [x, y, z] = this.sim.grid.tileWorld(this.sim.grid.get(GROUND, park.x + 1, park.z + 1)!);
    const at = new pc.Vec3(x - 0.5, y + 0.3, z - 0.5);
    for (let i = 0; i < 2 + tier; i++)
      this.tweens.add(0.01, () => {}, {
        delay: i * 0.3,
        done: () => {
          this.vfx.ring(at, i % 2 ? PALETTE.gold : PALETTE.coreGlow, 2 + i * 1.6, 1.1);
          this.vfx.burst(new pc.Vec3(at.x, at.y + 1, at.z), 16, { up: 4, speed: 2, size: 0.07, life: 1.4 });
        },
      });
    this.sfx.fanfare();
  }

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
      this.hud.toast('⛲ Water returns!<small>Bloombot can Pry now, and build. Rubble blocks the avenues north, east and west: pry one open.</small>', 'gold', 7);
      // E21.12: a 4 s vista turning past the beacons around the park (skippable; a still with reduced motion)
      if (!this.settings.noVistas) setTimeout(() => this.vista(8, 8, 4, (seen) => seen.forEach((r) => this.sim.salvage.see(`beacon:${r}`)), 300), 200);
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
    return id !== PARK && this.sim.areas.ready(id); // E21.6: the fountain wakes by its tiers, at the fountain
  }

  private wakeLandmark(m: MachineData) {
    if (this.cinematic) return;
    const id = this.sim.areas.areaOf(m)!;
    // E21.9: a landmark is woken by bloombot's own delivery, by hand (the fountain by its tiers)
    if (id === PARK) this.oc?.openFountain();
    else if (this.sim.landmarks.interact(id) === 'woke') this.sfx.fanfare();
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
        if (a.noLandmark) continue; // E21: Old City backstreets carry no label
        const fog = s.areas.fog(id);
        const ready = id !== PARK && s.areas.ready(id);
        if (!ready && !zoomedOut) continue;
        // Look 4.6: never behind the camera or past the haze; sized by distance close up.
        const sp = this.camera.onScreen(new pc.Vec3(a.landmark[0] + 1, 2.4, a.landmark[1] + 1), 50);
        if (!sp) continue;
        // E21: an Old City region is labelled with its own name
        const def = a.region ? { ...AREA_TYPES[a.type], name: s.gates.regionById(a.region)!.name } : AREA_TYPES[a.type];
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

  /** Region unlocks: the sealed area just ahead of bloombot (the tile in front, or one more step), if any. */
  private sealedAhead(): string | undefined {
    const b = this.bot;
    if (!b || b.pose.roofId !== GROUND) return undefined;
    const f = b.front();
    const dx = Math.sign(Math.round(Math.sin(b.pose.facing)));
    const dz = Math.sign(Math.round(Math.cos(b.pose.facing)));
    for (const [x, z] of [[f.x, f.z], [f.x + dx, f.z + dz]]) {
      const id = this.sim.areas.map.areaOfCell(x, z);
      if (this.sim.areas.sealed(id)) return id;
    }
    return undefined;
  }

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

  /** Runs simulation ticks within the frame budget: the frame's own time (E23.1: nothing owed is ever paid back). */
  private runSim(dt: number) {
    const t0 = performance.now();
    runSimFrame(this.sim, this, dt, { pause: this.pause, speed: this.speed * (this.sim.rest.fast ? REST.fastTime : 1), step: TUNING.simStep, budgetMs: TUNING.frameSimBudgetMs });
    this.simMs = performance.now() - t0;
    this.simMsWorst = Math.max(this.simMsWorst, this.simMs);
  }

  /** this frame's dt (holds read it) */
  private frameDt = 0;
  private lastReal = 0;
  /**
   * Seconds of wall time since the last frame (the engine's dt is 0 while paused). Not clamped to a frame's worth:
   * the crafting table counts real seconds even when frames are slow, up to a second at a time (a long stall, such as
   * a hidden window, doesn't finish a queue at once).
   */
  private realDt(): number {
    const now = performance.now();
    const d = this.lastReal ? (now - this.lastReal) / 1000 : 0;
    this.lastReal = now;
    return Math.min(d, 1);
  }
  private update(rawDt: number) {
    if (!this.pause.paused) this.lastReal = performance.now();
    const dt = Math.min(rawDt, TUNING.maxFrameDt);
    this.frameDt = dt;
    this.clock += dt;
    this.adaptQuality(rawDt);
    // City 11.4: drones well outside the view fly by the clock (no per-tick moves); near ones fly for real.
    const view = this.city ? this.groundRect() : undefined;
    this.sim.drones.focus = view ? { x: (view.x0 + view.x1) / 2, z: (view.z0 + view.z1) / 2, radius: Math.hypot(view.x1 - view.x0, view.z1 - view.z0) / 2 + 24 } : undefined;
    // E22.11: a full-screen panel (the backpack, Settings) pauses the game while it is open.
    this.syncPanelPause();
    const paused = this.pause.paused;
    // E23.6.1: the table keeps working while its panel holds the game paused (the engine's clock is stopped then)
    this.hud.craft.update(paused ? this.realDt() : dt, paused);
    if (!paused && !this.photo.frozen) {
      this.runSim(dt);
    }
    /** the world's own time: nothing moves while paused (the camera, streaming and the HUD still run) */
    const wdt = paused ? 0 : dt;
    this.tweens.update(wdt);
    this.scene.update(wdt);
    this.grid.update(wdt);
    const rect = view;
    if (rect) this.grid.stream(rect);
    this.transitions.sync(this.sim.time + Math.min(this.acc, TUNING.simStep));
    if (rect) this.chunks.update(wdt, rect, this.camera.target, this.camera.zoom); // streams while paused; the wind and growth wait
    detailTextures.step(); // Look 3.1: builds the detail maps a slice per frame after first paint
    const camP = this.camera.entity.getPosition();
    detailTextures.setCamera(camP.x, camP.y, camP.z);
    this.machines.update(wdt, rect);
    this.powerLines.update();
    const powerOn = this.powerView && this.building();
    this.powerOverlay.show(powerOn);
    this.powerOverlay.update(wdt, this.powerFocus);
    // E23.7.5: lamps cast real light: fewer at once on the low tier, and they dim with the scene in the Power view
    this.lightVisuals.maxCast = this.gfxTier === 'low' ? LIGHTING.cast.maxLow : LIGHTING.cast.max;
    this.lightVisuals.share = this.dayNight.lightShare;
    // E23.7.5: photo mode's own time or weather lights the lamps as that hour would (on screen only)
    const ownScene = this.photo.lightOverride() !== undefined || this.photo.weatherOverride() !== undefined;
    if (ownScene) {
      const sc = sceneNow(this.sim, this.photo);
      this.lightVisuals.dark = Math.max(1 - daylightAt(sc.f), GLOOMY.has(sc.weather) ? 1 : 0);
    } else this.lightVisuals.dark = undefined;
    this.lightVisuals.update(wdt, this.camera.entity.getPosition());
    // E23.3.4: in the Power view, powered electrical machines become yellow holograms and the rest of the world darkens
    this.machines.powerHolo(powerOn ? this.poweredMachines() : undefined, wdt);
    const D = POWER.view.darken;
    const dimTo = powerOn ? D.night + (D.day - D.night) * this.dayNight.light : 0;
    const k = Math.min(1, wdt / POWER.view.fade);
    this.dayNight.dim = Math.abs(dimTo - this.dayNight.dim) < 1e-3 ? dimTo : this.dayNight.dim + (dimTo - this.dayNight.dim) * k;
    this.powerOverlay.setBoost(this.dayNight.boost);
    this.machines.setHoloBoost(this.dayNight.boost);
    this.tillers.update(paused || this.photo.frozen ? 0 : dt);
    this.crops.update(dt);
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
    this.drones.update(paused || this.photo.frozen ? 0 : dt); // drone personality freezes with the game
    this.cat.update(wdt);
    // Phase 5 E16: fauna by unlock, capped per quality tier ("Fewer particles" = low).
    const eco = this.sim.ecosystem;
    const quality = this.faunaTier ?? (this.settings.lowVfx ? 'low' : 'high');
    this.butterflies.enabled = eco.has('butterflies');
    this.butterflies.cap = TUNING.ecosystem.caps[quality].butterflies;
    // Fauna live around where the camera looks (the ground rect of a low perspective view reaches far beyond it).
    const ct = this.camera.target;
    const near = rect ? { x0: ct.x - 12, x1: ct.x + 12, z0: ct.z - 12, z1: ct.z + 12 } : undefined;
    this.butterflies.update(wdt, near);
    this.pollinators.enabled = !this.settings.reducedMotion && !ChunkRenderer.still;
    this.pollinators.quality = quality;
    this.pollinators.update(wdt, near);
    this.birds.resident = eco.has('birds');
    this.clouds.happy = eco.has('birds'); // the sky wakes up with the songbirds: sleepy faces on a couple of clouds
    this.birds.update(wdt, this.camera.goalPoint, this.sim.progression.parkStage() >= 2 || this.birds.resident);
    this.fauna.update(wdt, near, { quality, reducedMotion: this.settings.reducedMotion, fireflies: this.settings.fireflies !== false && !this.settings.highContrast && this.dayNight.light < 0.5, fog: WEATHER[this.weatherLook().kind].fogFinds });
    this.nightFindVisuals.reducedMotion = this.settings.reducedMotion;
    this.nightFindVisuals.update(wdt);
    this.eco?.update(wdt);
    this.tileFx.update(wdt);
    this.frameNo++;
    if (this.readyFrames < 4) {
      const s = this.loadSteps();
      this.readyFrames = s.models === 1 && s.view === 1 ? this.readyFrames + 1 : 0;
    }
    this.updateChainPresentation(wdt);
    if (!this.cinematic) this.checkCozyUnlocks();
    this.vfx.update(wdt);
    // First-tile beacon until the player restores something.
    if (this.sim.state.progression.tutorialStep === 0 && !this.hud.introOpen && !this.cinematic && !this.photo.active) {
      const tiles = this.sim.progression.tilesFor(HOME);
      const t = tiles.find((x) => x.ground === 'prepared' && !x.occupantId) ?? tiles.find((x) => x.ground === 'polluted' && !x.blocked && !x.occupantId);
      if (t) this.overlays.showBeacon(t.roofId, t.x, t.z);
    } else this.overlays.hideBeacon();
    this.overlays.update(dt);
    this.waterLevels.update();
    if (this.bot) {
      this.bot.update(wdt); // still reads the pad (the menu's focus ring), but nothing moves
      this.updateExploreCamera(wdt);
      this.updateMouseCapture();
      this.oc?.update(wdt);
      this.keepers?.update(wdt);
      this.resting?.update(wdt);
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
    {
      const wv = this.weatherVisuals;
      wv.reducedMotion = this.settings.reducedMotion;
      wv.lowVfx = !!this.settings.lowVfx;
      wv.update(wdt, this.weatherLook(), this.camera.target);
      this.sky.wind = wv.wind;
      this.clouds.gust = wv.wind;
    }
    this.dayNight.apply(this.lightMoment());
    this.look.rimShare = this.dayNight.rim;
    this.look.night = 1 - this.dayNight.light;
    this.chunks.fogTint.copy(this.dayNight.cloudTint);
    this.chunks.tintFog();
    this.sky.update(wdt, this.camera.entity.getPosition(), this.camera.cam.farClip);
    this.skyline.clarity = this.sky.clarity;
    this.skyline.reducedMotion = this.settings.reducedMotion;
    this.skyline.update(wdt, this.camera.target, this.camera.entity.getPosition(), this.camera.dist, this.camera.nearness(), this.camera.yaw, this.camera.hazeEnd, this.camera.cam.farClip);
    this.syncView();
    {
      const c = this.camera;
      const cv = this.app.graphicsDevice.canvas as HTMLCanvasElement;
      this.cloudWall.update(wdt);
      this.clouds.update(wdt, { zoom: c.zoom, yaw: c.yaw, dist: c.dist, viewHeight: c.viewHeight, aspect: cv.clientWidth / Math.max(1, cv.clientHeight), position: c.entity.getPosition(), forward: c.entity.forward });
    }
    this.updateMood(dt);
    this.look.update(dt);
    this.updateTreeCursor(dt);
    this.hud.update(dt);
    const restored = this.sim.progression.restoredCount(HOME);
    this.sfx.layers = Math.min(3, Math.floor(restored / 12));
    this.sfx.life = Math.min(1, restored / 48);
    this.sfx.update(wdt);

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

    if (!paused) this.saveTimer += dt; // E22.11: a pause writes nothing (savedAt doesn't move)
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

/** E22.11: what the desktop (Steam Deck) build's preload offers the page, if anything. */
export function desktopApi(): { quit?: () => void; onPower?: (cb: (state: 'suspend' | 'resume') => void) => void; deck?: boolean } | undefined {
  return (globalThis as { solarbloomDesktop?: { quit?: () => void; onPower?: (cb: (state: 'suspend' | 'resume') => void) => void; deck?: boolean } }).solarbloomDesktop;
}

/** E20.1: a rough direction in words, north up as on the minimap (north is -z, east is +x). */
export function compass(dx: number, dz: number): string {
  if (Math.hypot(dx, dz) < 2) return 'right here';
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return names[((Math.round(deg / 45) % 8) + 8) % 8];
}
