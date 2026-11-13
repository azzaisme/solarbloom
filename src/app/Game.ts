import * as pc from 'playcanvas';
import { Sfx } from '../audio/Sfx';
import { formatCost } from '../core/Economy';
import { createInitialState } from '../core/GameState';
import type { MachineData, ResourceKind, TileData } from '../core/types';
import { MACHINES } from '../data/machines';
import { TUNING } from '../data/tuning';
import { UPGRADE_BY_ID } from '../data/upgrades';
import { CAT_REWARD_NAMES } from '../gameplay/LuckyCatSystem';
import { Sim } from '../gameplay/Sim';
import { Butterflies } from '../rendering/Butterflies';
import { CameraController } from '../rendering/CameraController';
import { CatVisuals } from '../rendering/CatVisuals';
import { DroneVisuals } from '../rendering/DroneVisuals';
import { GridRenderer } from '../rendering/GridRenderer';
import { InputController } from '../rendering/InputController';
import { MachineVisuals } from '../rendering/MachineVisuals';
import { PALETTE } from '../rendering/Materials';
import { Overlays } from '../rendering/Overlays';
import { SceneBuilder, SLAB_TOP } from '../rendering/SceneBuilder';
import { initLowPoly } from '../rendering/Shapes';
import { Tweens } from '../rendering/Tween';
import { Vfx } from '../rendering/Vfx';
import { FlyText } from '../ui/Fly';
import { Hud, type Settings, type Tool } from '../ui/Hud';
import { EventBus } from './EventBus';
import { SaveService } from './SaveService';

const SETTINGS_KEY = 'solarbloom.settings';
const BLOOM_NAMES = ['', 'Fresh grass', 'Wildflowers', 'Full bloom'];

interface Pick {
  roofId: string;
  fx: number;
  fz: number;
  tile?: TileData;
}

function loadSettings(): Settings {
  const def: Settings = { sound: true, music: true, reducedMotion: false, hints: true, debug: false };
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
  readonly machines: MachineVisuals;
  readonly drones: DroneVisuals;
  readonly cat: CatVisuals;
  readonly butterflies: Butterflies;
  readonly vfx: Vfx;
  readonly overlays: Overlays;
  readonly hud: Hud;
  readonly fly: FlyText;
  readonly sfx = new Sfx();
  settings: Settings;

  private acc = 0;
  paused = false;
  private hiddenPause = false;
  speed = 1;
  private saveTimer = 0;
  private resetting = false;
  private pointer = { x: -1, y: -1, inside: false };
  private selected?: string;
  private inspectTimer = 0;
  private cinematic = false;
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

  constructor(canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    const loaded = this.saver.load();
    const state = loaded ?? createInitialState();
    this.sim = new Sim(state, this.bus);

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
    this.scene.build(state.rooftops);
    this.camera = new CameraController(this.app, this.tweens);
    this.grid = new GridRenderer(this.sim, this.scene.world, this.tweens, this.app.batcher ?? undefined);
    this.grid.build();
    this.machines = new MachineVisuals(this.sim, this.scene.world, this.tweens);
    this.machines.buildAll();
    this.drones = new DroneVisuals(this.sim, this.scene.world, this.tweens);
    this.drones.sync();
    this.cat = new CatVisuals(this.sim, this.scene.world, this.tweens);
    this.vfx = new Vfx(this.scene.world, this.app.graphicsDevice);
    this.butterflies = new Butterflies(this.sim, this.scene.world);
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
        skipCinematic: () => this.skipCinematic(),
        closeInspect: () => this.select(undefined),
        togglePause: () => this.setPaused(!this.paused),
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

    this.sim.cat.isAnchorVisible = (a) => this.anchorVisible(this.cat.anchorWorld(a));
    if (state.cat.active) this.cat.show(state.cat.active.anchorId, false);
    if (state.progression.coreActivated) {
      this.scene.restoreBuilding(true);
      this.machines.setCoreState('awake', true);
      this.camera.bounds.maxX = 20;
    } else if (this.sim.progression.coreReady()) this.machines.setCoreState('ready');

    this.wireEvents();
    new InputController(canvas, {
      hover: (x, y) => this.onHover(x, y),
      leave: () => this.onLeave(),
      click: (x, y, b) => this.onClick(x, y, b),
      pan: (dx, dy) => this.camera.pan(dx, dy),
      zoom: (f) => this.camera.zoomBy(f),
    });
    this.wireKeys();
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      this.hiddenPause = document.hidden;
      if (document.hidden) this.save();
    });
    window.addEventListener('beforeunload', () => this.save());

    this.app.on('update', (dt: number) => this.update(dt));
    this.app.start();
    if (!state.progression.introSeen && state.stats.tilesRestored === 0) this.hud.showIntro();
    else if (loaded) setTimeout(() => this.hud.toast('Welcome back! Your garden kept its shape. 🌱', '', 2.6), 400);
  }

  // ───────────────────────── settings / persistence ─────────────────────────

  private setSetting(k: keyof Settings, v: boolean) {
    this.settings[k] = v;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* private mode */
    }
    this.applySettings();
  }

  private applySettings() {
    const s = this.settings;
    this.sfx.setMuted(!s.sound);
    this.sfx.setMusic(s.music);
    const rm = s.reducedMotion;
    this.butterflies.reducedMotion = this.grid.reducedMotion = this.machines.reducedMotion = this.drones.reducedMotion = this.cat.reducedMotion = this.camera.reducedMotion = this.fly.reducedMotion = rm;
    this.vfx.density = rm ? 0.35 : 1;
    document.body.classList.toggle('reduced', rm);
    this.hud.settings = s;
    if (!s.debug) this.hud.setDebug(null);
  }

  save() {
    if (this.resetting) return;
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
      const map: Record<string, Tool> = { '1': 'inspect', '2': 'pulse', '3': 'solar', '4': 'condenser', '5': 'pollinator', '6': 'droneHub' };
      if (map[k]) this.selectTool(map[k]);
      else if (k === 'h') this.harvest();
      else if (k === 'u') this.hud.toggleUpgrades();
      else if (k === 'p') this.setPaused(!this.paused);
      else if (k === 'f3' || k === '`') {
        e.preventDefault();
        this.setSetting('debug', !this.settings.debug);
      } else if (k === 'escape') {
        if (this.hud.modalOpen) this.hud.openSettings(false);
        else if (this.hud.isUpgradesOpen) this.hud.toggleUpgrades(false);
        else if (this.selected) this.select(undefined);
        else this.selectTool('pulse');
      } else if (k === '+' || k === '=') this.camera.zoomBy(1.15);
      else if (k === '-') this.camera.zoomBy(1 / 1.15);
    });
  }

  pick(x: number, y: number): Pick | undefined {
    const { o, d } = this.camera.ray(x, y);
    let best: Pick | undefined;
    let bestT = Infinity;
    for (const r of this.sim.state.rooftops) {
      if (!r.unlocked && !r.preview) continue;
      if (Math.abs(d.y) < 1e-6) continue;
      const planeY = r.origin[1] + r.height + SLAB_TOP;
      const t = (planeY - o.y) / d.y;
      if (t < 0 || t >= bestT) continue;
      const lx = o.x + d.x * t - r.origin[0];
      const lz = o.z + d.z * t - r.origin[2];
      if (lx < 0 || lz < 0 || lx >= r.width || lz >= r.depth) continue;
      bestT = t;
      best = { roofId: r.id, fx: lx, fz: lz, tile: this.sim.grid.get(r.id, Math.floor(lx), Math.floor(lz)) };
    }
    return best;
  }

  private catHit(x: number, y: number): boolean {
    const p = this.cat.targetWorld();
    if (!p) return false;
    const s = this.camera.toScreen(p);
    const r = Math.max(26, 0.32 / this.camera.worldPerPixel());
    return Math.hypot(s.x - x, s.y - y) <= r;
  }

  private anchorVisible(p: pc.Vec3): boolean {
    const s = this.camera.toScreen(p);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (s.x < 40 || s.y < 40 || s.x > w - 40 || s.y > h - 40) return false;
    return !this.hud.blockedRects().some((r) => s.x > r.left - 16 && s.x < r.right + 16 && s.y > r.top - 16 && s.y < r.bottom + 16);
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
      this.hud.showTip(x, y, `<b>${roof.name}</b>${roof.unlocked ? 'The bridge is open — this rooftop becomes playable in the next update.' : 'Still grey and quiet. Awaken your Core to reach it.'}`);
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
      const ready = occ.type === 'core' && this.sim.progression.coreReady();
      this.hud.showTip(x, y, `<b>${MACHINES[occ.type].icon} ${MACHINES[occ.type].name}</b>${ready ? '<span class="ok">Ready! Click to awaken.</span>' : 'Click to inspect'}`);
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
    if (chk.ok) {
      const verb = t.ground === 'restored' ? `Nurture → ${BLOOM_NAMES[t.bloom + 1]}` : 'Pulse';
      action = `<span class="ok">${verb}: ${formatCost(chk.cost)}</span>`;
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
        return `+${rate.toFixed(2)}🌿/s${zone ? ' (garden ×2)' : ''}${t.bloom >= TUNING.restore.maxBloom ? ' · full bloom ✓' : ''}`;
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
    const p = this.pick(x, y);
    if (!p || !p.tile) {
      this.select(undefined);
      return;
    }
    const roof = this.sim.grid.roof(p.roofId)!;
    if (roof.preview) {
      this.hud.showFail(roof.unlocked ? 'Greenhouse Tower opens in the next update 🌉' : 'Awaken the Core to reach this rooftop', x, y);
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
      if (occ.type === 'core' && this.sim.progression.coreReady()) {
        this.sim.progression.activateCore();
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
      case 'condenser':
        return g.tilesNear(m, TUNING.condenser.radius);
      case 'pollinator':
        return g.tilesNear(m, this.sim.upgrades.pollinatorReach);
      case 'droneHub':
        return g.tilesNear(m, TUNING.drone.hubRadius);
      default:
        return [];
    }
  }

  private select(id: string | undefined) {
    this.selected = id;
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
        extra = `<p class="stat">⚡ ${out.toFixed(1)} energy/s${boosted ? ' · 🌸 bloom boost!' : ''}${s.production.frenzyActive() ? ' · 🐱 Frenzy ×3' : ''}</p><p>Restore tiles right next to it for a 5 s ×2 boost.</p>${this.upgradeButton('solarArray')}`;
        break;
      }
      case 'condenser': {
        const near = s.grid.tilesNear(m, TUNING.condenser.radius);
        const mossy = near.filter((t) => t.ground === 'prepared').length;
        extra = `<p class="stat">💧 +1 water/s</p><p class="stat">🌱 Irrigates a mossy neighbour every ${TUNING.condenser.irrigateEvery}s for ${TUNING.condenser.irrigateWater}💧 (${mossy} waiting)</p>`;
        break;
      }
      case 'pollinator': {
        const zone = s.grid.tilesNear(m, s.upgrades.pollinatorReach);
        const mossy = zone.filter((t) => t.ground === 'prepared').length;
        const green = zone.filter((t) => t.ground === 'restored').length;
        extra = `<p class="stat">🌸 Zone radius ${s.upgrades.pollinatorReach} · ${green}/${zone.length} blooming (×2 🌿)</p><p class="stat">✨ ${mossy} mossy tiles ready to chain</p><p>Restore any tile in the zone: the bloom leaps to mossy neighbours.</p>${this.upgradeButton('pollinatorReach')}`;
        break;
      }
      case 'droneHub': {
        const ds = s.state.drones.filter((d) => d.hubId === m.id);
        const label = { working: 'restoring a tile', travelling: 'flying to a job', napping: 'napping — nothing to do in range', waitingEnergy: 'waiting for energy ⚡' } as const;
        extra = ds
          .map((d, i) => `<p class="stat">🛸 Drone ${i + 1}${d.expiresAt ? ' (party!)' : ''}: ${label[s.drones.statusOf(d)]} · ${d.jobs} jobs</p>`)
          .join('') + `<p>Works within ${TUNING.drone.hubRadius} tiles, paying the normal pulse cost.</p>${this.upgradeButton('droneSpeed')}`;
        break;
      }
      case 'core': {
        const reqs = s.progression.requirements();
        extra = s.state.progression.coreActivated
          ? '<p class="stat">✨ Awake. The building breathes again.</p>'
          : `<ul style="margin:6px 0;padding-left:18px;font-size:12.5px">${reqs.map((r) => `<li>${r.done ? '✅' : '⬜'} ${r.label}</li>`).join('')}</ul><p>Awakening costs ${formatCost(TUNING.core.cost)}.</p>`;
        break;
      }
    }
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

  private flyGain(kind: ResourceKind, amount: number, from?: { x: number; y: number }) {
    const src = from ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.fly.spawn(kind, amount, src, this.hud.resourceRect(kind), () => this.hud.flashResource(kind, 'flash'));
  }

  private wireEvents() {
    const b = this.bus;
    const s = this.sim;
    b.on('tile.restoring', ({ tile, source }) => {
      this.grid.refresh(tile, true);
      const p = this.tileVec(tile);
      if (source === 'pulse') {
        this.vfx.ring(p, PALETTE.eyeCyan, 1.1, 0.55);
        this.vfx.burst(p, 6, { up: 1.5, speed: 1.4, size: 0.05 });
        this.sfx.pulse();
      } else if (source === 'broad') this.vfx.ring(p, PALETTE.eyeCyan, 0.8, 0.45);
      else if (source === 'condenser') this.vfx.ring(p, PALETTE.water, 0.8, 0.5);
      else if (source === 'drone') this.vfx.ring(p, PALETTE.leafFin, 0.8, 0.5);
    });
    b.on('tile.restored', ({ tile, source }) => {
      this.grid.refresh(tile, true);
      const p = this.tileVec(tile);
      this.vfx.burst(p, source === 'chain' || source === 'mega' ? 10 : 14, { up: 2.6, size: 0.07 });
      if (source !== 'chain' && source !== 'mega' && this.clock - this.lastRestoreSound > 0.06) {
        this.lastRestoreSound = this.clock;
        this.sfx.restored(this.restoreSoundIdx++);
      }
      for (const n of s.grid.neighbors(tile)) this.grid.refresh(n, true); // neighbours may have softened
      if (this.selected) this.inspectTimer = 0;
    });
    b.on('tile.prepared', ({ tile }) => {
      this.grid.refresh(tile, true);
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
        pollinator: '🌸 Pollinator Garden planted! Restore mossy tiles in its zone to start a Bloom Chain.',
        droneHub: '🛸 Drone Hub built! Your drone can handle the small jobs now.',
      };
      if (first && msg[machine.type]) this.hud.toast(msg[machine.type]!, 'gold', 4);
    });
    b.on('chain.step', ({ tileId, fromTileId, combo }) => {
      const a = s.grid.byTileId(fromTileId);
      const t = s.grid.byTileId(tileId);
      if (a && t) this.vfx.arc(this.tileVec(a), this.tileVec(t), combo >= 5 ? PALETTE.pink : PALETTE.flowerCore, 0.5);
      if (combo >= 2) this.hud.combo(combo);
      this.sfx.bloom(combo);
    });
    b.on('chain.ended', ({ combo, bonus }) => {
      if (combo < 2) return;
      this.hud.combo(combo);
      this.hud.feed(`🌸 Bloom chain ×${combo}${bonus ? ` · +${bonus}🌿 bonus` : ''}`);
      this.sfx.chainEnd(combo);
      if (combo >= 5) {
        this.hud.toast(`🌸 BLOOM ×${combo}!${bonus ? `<small>Chain bonus +${bonus} 🌿</small>` : ''}`, 'gold', 2.6);
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
    b.on('action.failed', ({ reason }) => {
      this.hud.showFail(reason, this.pointer.x, this.pointer.y);
      this.sfx.error();
      if (reason.includes('⚡')) {
        this.hud.flashResource('energy', 'short');
        if (s.state.time >= s.state.harvestReadyAt) this.hud.nudge('#harvestBtn', 5);
      }
      if (reason.includes('💧')) this.hud.flashResource('water', 'short');
      if (reason.includes('🌿')) this.hud.flashResource('biomass', 'short');
    });
    b.on('upgrade.purchased', ({ id, level }) => {
      const def = UPGRADE_BY_ID[id];
      this.hud.toast(`${def.icon} ${def.name} ${['I', 'II', 'III', 'IV', 'V'][level - 1]}<small>${def.describe(level)}</small>`, 'gold', 2.6);
      this.machines.refreshUpgrades();
      this.sfx.coin();
      for (const m of s.state.machines) {
        if ((id === 'solarArray' && m.type === 'solar') || (id === 'droneSpeed' && m.type === 'droneHub') || (id === 'pollinatorReach' && m.type === 'pollinator')) {
          const w = this.machines.worldOf(m);
          this.vfx.burst(new pc.Vec3(w[0], w[1] + 0.4, w[2]), 12, { up: 2.5 });
        }
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
    b.on('cat.found', ({ reward, summary }) => {
      const p = this.cat.targetWorld();
      if (p) {
        this.lastCatPos = p.clone();
        this.vfx.burst(p, 40, { up: 4, speed: 2, size: 0.07, life: 1.4 });
        this.vfx.ring(p, PALETTE.gold, 1.6, 0.8);
      }
      this.cat.hide(true);
      this.sfx.meow();
      setTimeout(() => this.sfx.fanfare(), 250);
      this.hud.toast(`🐱 Lucky Cat Found!<small>${CAT_REWARD_NAMES[reward]} — ${summary}</small>`, 'cat', 4.5);
      this.save();
    });
    b.on('buff.started', ({ seconds }) => this.hud.feed(`☀️ Solar Frenzy ×3 for ${Math.round(seconds)}s`));
    b.on('harvest', () => this.sfx.coin());
    b.on('rooftop.coreReady', () => {
      this.machines.setCoreState('ready');
      this.hud.toast('✨ The Rooftop Core is humming!<small>Click it (or the button) to awaken the building.</small>', 'gold', 5);
      this.sfx.chainEnd(10);
    });
    b.on('rooftop.coreRestored', () => this.playCoreSequence());
  }

  private lastCatPos?: pc.Vec3;

  // ───────────────────────── core sequence ─────────────────────────

  private playCoreSequence() {
    this.cinematic = true;
    this.select(undefined);
    this.overlays.hideFrame();
    this.overlays.hideGhost();
    this.hud.hideTip();
    const roof = this.sim.grid.roof('r1')!;
    this.hud.cinematic(true, `${roof.name} lives again!`);
    this.machines.setCoreState('awake');
    this.sfx.fanfare();
    const core = this.machines.coreWorld();
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
    this.camera.bounds.maxX = 20;
    this.scene.restoreBuilding(false, () => this.camera.focus(9.5, 0.4, 0.5, 0.62, 2.6));
    this.cinematicEnd = () => {
      if (!this.cinematic) return;
      this.cinematic = false;
      this.hud.cinematic(false);
      this.hud.toast('🌉 A bridge to the Greenhouse Tower!<small>Your rooftop now produces +25% biomass. Rooftop 2 opens in the next update.</small>', 'gold', 6);
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

  private update(rawDt: number) {
    const dt = Math.min(rawDt, TUNING.maxFrameDt);
    this.clock += dt;
    this.adaptQuality(rawDt);
    if (!this.paused && !this.hiddenPause && !this.hud.modalOpen) {
      this.acc += dt * this.speed;
      let n = 0;
      while (this.acc >= TUNING.simStep && n < 20) {
        this.sim.tick(TUNING.simStep);
        this.acc -= TUNING.simStep;
        n++;
      }
    }
    this.tweens.update(dt);
    this.scene.update(dt);
    this.grid.update(dt);
    this.machines.update(dt);
    this.drones.update(dt);
    this.cat.update(dt);
    this.butterflies.update(dt);
    this.vfx.update(dt);
    // First-tile beacon until the player restores something.
    if (this.sim.state.progression.tutorialStep === 0 && !this.hud.introOpen && !this.cinematic) {
      const tiles = this.sim.grid.roof('r1')!.tiles;
      const t = tiles.find((x) => x.ground === 'prepared' && !x.occupantId) ?? tiles.find((x) => x.ground === 'polluted' && !x.blocked && !x.occupantId);
      if (t) this.overlays.showBeacon('r1', t.x, t.z);
    } else this.overlays.hideBeacon();
    this.overlays.update(dt);
    this.camera.update(dt);
    this.hud.update(dt);
    this.sfx.layers = Math.min(3, Math.floor(this.sim.progression.restoredCount('r1') / 12));
    this.sfx.update(dt);

    if (this.selected) {
      this.inspectTimer -= dt;
      if (this.inspectTimer <= 0) {
        this.inspectTimer = 0.3;
        this.renderInspect();
      }
    }
    if (this.sim.state.cat.active && !this.paused) {
      this.meowTimer -= dt;
      if (this.meowTimer <= 0) {
        this.meowTimer = 30 + Math.random() * 20;
        this.sfx.meow(true);
      }
    }
    // Roof 2 world label
    const r2 = this.sim.grid.roof('r2');
    if (r2 && r2.unlocked && !this.cinematic) {
      const sp = this.camera.toScreen(new pc.Vec3(r2.origin[0] + r2.width / 2, r2.origin[1] + r2.height + 2.2, r2.origin[2] + r2.depth / 2));
      this.hud.worldLabel('roof2Label', `🌱 ${r2.name}<small>Rooftop 2 · next update</small>`, sp.x, sp.y);
    } else this.hud.worldLabel('roof2Label', null);

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
            `chains ${this.sim.chains.activeRuns} queued ${this.sim.chains.pendingSteps}\n` +
            `drones ${st.drones.length}  machines ${st.machines.length}\n` +
            `cat ${st.cat.active ? st.cat.active.anchorId : `next ${st.cat.firstSpawned ? st.cat.nextSpawnAt.toFixed(0) : 'first'}`}\n` +
            `restored ${this.sim.progression.restoredCount('r1')} full ${this.sim.progression.fullBloomCount('r1')}`,
        );
      }
    }
  }
}
