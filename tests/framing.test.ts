import * as pc from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { Bindings } from '../src/app/Bindings';
import { PhotoMode, PHOTO, type PhotoState } from '../src/app/PhotoMode';
import { SaveService } from '../src/app/SaveService';
import { calmHud, parseSettings, potterPace } from '../src/app/Settings';
import type { Sim } from '../src/gameplay/Sim';
import { CameraController } from '../src/rendering/CameraController';
import { advisorStep, calmToast } from '../src/ui/Pace';
import { runBot } from './bots';

// E19.4 (#259): softer framing. Photo mode (#260), the calm HUD (#261, the default since E20.7 #290) and the
// potter-about pace (#262) are presentation only.

describe('E20.7: calm is the default', () => {
  it('a new game starts calm, with "Show numbers" off and the potter-about pace off', () => {
    const s = parseSettings(null);
    expect(s.showNumbers).toBeFalsy();
    expect(calmHud(s)).toBe(true);
    expect(potterPace(s)).toBe(false);
  });

  it('settings saved before the calm HUD existed (never chose) load calm and keep everything else', () => {
    const old = JSON.stringify({ sound: false, music: true, reducedMotion: false, hints: true, debug: false, lowVfx: true, uiScale: 125, keys: { pulse: ['KeyF'] } });
    const s = parseSettings(old);
    expect(calmHud(s)).toBe(true);
    expect([s.sound, s.lowVfx, s.uiScale, s.keys?.pulse]).toEqual([false, true, 125, ['KeyF']]);
  });

  it('a player who chose "Show numbers" keeps it; unreadable settings fall back to calm', () => {
    expect(calmHud(parseSettings(JSON.stringify({ showNumbers: true })))).toBe(false);
    expect(calmHud(parseSettings(JSON.stringify({ showNumbers: false })))).toBe(true);
    expect(calmHud(parseSettings('{not json'))).toBe(true);
    expect(calmHud(parseSettings('null'))).toBe(true);
  });
});

describe('E19.4.2: calm toasts', () => {
  it('drop detail lines made of numbers and keep the ones that say what to do', () => {
    expect(calmToast('🌱 24 tiles restored!<small>+30🌿 +12💧 · next reward at 40</small>')).toBe('🌱 24 tiles restored!');
    expect(calmToast('🌸 BLOOM CHAIN ×12!<small>Chain bonus +40 🌿</small>')).toBe('🌸 BLOOM CHAIN ×12!');
    const how = '✨ The Rooftop Core is humming!<small>Walk up and press <kbd>Q</kbd> to awaken the building.</small>';
    expect(calmToast(how)).toBe(how);
    expect(calmToast('▶ Back to blooming')).toBe('▶ Back to blooming');
  });
});

describe('E19.4.3: the potter-about pace is presentation only', () => {
  /** A pacing bot run that also does what the HUD does each second: ask the advisor, under one pace or the other. */
  function run(potter: boolean) {
    let last: Sim | undefined;
    const shown: boolean[] = [];
    SaveService.clock = () => 0;
    const report = runBot({
      seed: 7,
      minutes: 9,
      roles: true,
      onSecond: (sim) => {
        last = sim;
        shown.push(!!advisorStep(sim, potter));
        sim.advisor.suggest();
        sim.advisor.nearestFrontier();
      },
    });
    return { report, save: new SaveService(undefined).serialize(last!.state), shown };
  }

  it('the same inputs give an identical game state and the same pacing numbers, potter on or off', () => {
    const off = run(false);
    const on = run(true);
    expect(off.shown.some(Boolean)).toBe(true); // the advisor had things to say...
    expect(on.shown.some(Boolean)).toBe(false); // ...and potter kept them all off screen
    expect(JSON.stringify(on.report)).toBe(JSON.stringify(off.report));
    expect(on.save).toBe(off.save);
  }, 120_000);
});

/** A real CameraController without a graphics device: only the drawing (`apply`) and screen maths are stubbed. */
function camera(): CameraController {
  const c = Object.create(CameraController.prototype) as CameraController;
  const fields = {
    target: new pc.Vec3(10, 0, 12),
    goal: new pc.Vec3(10, 0, 12),
    yaw: 45,
    yawGoal: 45,
    zoom: 3.2,
    zoomGoal: 3.2,
    minZoom: 0.22,
    maxZoom: 4.2,
    pitchOffset: 0,
    follow: 7,
    held: false,
    cinematic: false,
    reducedMotion: false,
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    edgeSlack: 6,
    pitch: 24,
    viewHeight: 2,
    apply() {},
    worldPerPixel: () => 0.01,
    footprint: () => ({ x0: -5, x1: 5, z0: -5, z1: 5 }),
    groundAt: () => undefined,
  };
  Object.assign(c, fields);
  return c;
}

describe('E19.4.1: photo mode', () => {
  function setup() {
    const cam = camera();
    const hud = { hidden: false, dof: false, bar: undefined as PhotoState | undefined, shots: 0 };
    const bot = { following: true, visible: true, poses: 0, setVisible: (v: boolean) => (bot.visible = v), pose: () => bot.poses++ };
    const photo = new PhotoMode(
      {
        camera: cam,
        bot,
        setHudHidden: (h) => (hud.hidden = h),
        setDof: (on) => (hud.dof = on),
        capture: () => hud.shots++,
        render: (s) => (hud.bar = s),
      },
      new Bindings(),
    );
    return { cam, hud, bot, photo };
  }

  it('hides the HUD, loosens the camera, and leaving restores the camera and HUD exactly', () => {
    const { cam, hud, bot, photo } = setup();
    const before = cam.snapshot();
    photo.action('photo');
    expect([photo.active, hud.hidden, hud.dof, bot.following, cam.held]).toEqual([true, true, true, false, true]);
    expect(bot.poses).toBe(1); // bloombot strikes a pose, and stays in the picture by default
    expect(bot.visible).toBe(true);
    expect(cam.maxZoom).toBe(PHOTO.maxZoom); // closer than play allows

    // Frame a shot: pan away from bloombot, zoom freely, turn and tilt.
    photo.key('KeyW', true);
    photo.key('KeyD', true);
    for (let i = 0; i < 30; i++) photo.update(1 / 30);
    photo.key('KeyW', false);
    photo.key('KeyD', false);
    for (let i = 0; i < 20; i++) photo.action('zoomCamera');
    photo.action('rotate');
    photo.action('rotate');
    cam.orbit(70);
    expect(cam.goalPoint.distance(new pc.Vec3(10, 0, 12))).toBeGreaterThan(2);
    expect(cam.zoomTarget).toBeGreaterThan(4.2);
    expect(cam.pitchOffset).toBe(2 * PHOTO.tiltStep);
    // The game's own camera moves leave the view alone while framing.
    cam.glide(0, 0, 0, 1);
    cam.track(0, 0, 0);
    expect(cam.goalPoint.x).not.toBe(0);

    photo.action('interact'); // hide bloombot
    expect(bot.visible).toBe(false);
    photo.action('cancel');
    expect(cam.snapshot()).toEqual(before);
    expect([photo.active, hud.hidden, hud.dof, bot.following, bot.visible, hud.bar]).toEqual([false, false, false, true, true, undefined]);
  });

  it('freezes the game while framing only when asked, and saves a picture', () => {
    const { hud, photo } = setup();
    photo.enter();
    expect(photo.frozen).toBe(false);
    photo.action('buildMenu');
    expect(photo.frozen).toBe(true);
    expect(hud.bar?.freeze).toBe(true);
    photo.action('pulse');
    expect(hud.shots).toBe(1);
    photo.action('photo'); // the photo key leaves too
    expect(photo.frozen).toBe(false); // never frozen outside photo mode
    photo.action('map');
    expect(photo.active).toBe(false);
  });

  it('a hidden bloombot stays hidden the next time, and comes back on leaving', () => {
    const { bot, photo } = setup();
    photo.enter();
    photo.action('interact');
    photo.exit();
    expect(bot.visible).toBe(true);
    photo.enter();
    expect(bot.visible).toBe(false);
    expect(bot.poses).toBe(1); // no pose while hidden
    photo.exit();
    expect(bot.visible).toBe(true);
  });
});
