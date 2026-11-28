import { describe, expect, it } from 'vitest';
import { Bindings } from '../src/app/Bindings';
import { PHOTO, PHOTO_TABS, PhotoMode, type PhotoLook, type PhotoState } from '../src/app/PhotoMode';
import { focalLength, focusFromSlider, focusToSlider, frameRect, PHOTO_FRAMES, PHOTO_LENS, type PhotoFace, type PhotoPose } from '../src/data/photo';

// Photo mode 2 (#photo-2): the lens, the focus, the light, bloombot's poses and the frame, as a panel of rows.
// Presentation only: PhotoMode steers a camera and a host, and never the game.

function setup(opts: { post?: boolean; seated?: boolean; pointer?: boolean } = {}) {
  const cam = { snapshot: () => ({}) as never, restore: () => {}, pitchOffset: 0, maxZoom: 4.2, held: false, fov: 50, fovOverride: undefined as number | undefined, roll: 0, zoomBy: () => {}, pan: () => {}, orbit: () => {}, recentre: () => {} };
  const out = { bar: undefined as PhotoState | undefined, look: undefined as PhotoLook | undefined, looks: 0, shots: 0, depth: 7.5 as number | undefined, poses: [] as PhotoPose[], faces: [] as PhotoFace[], facing: [] as boolean[], visible: true };
  const photo = new PhotoMode(
    {
      camera: cam,
      bot: {
        following: true,
        setVisible: (v) => (out.visible = v),
        pose: () => {},
        play: (p) => out.poses.push(p),
        setFace: (f) => out.faces.push(f),
        faceCamera: (on) => out.facing.push(on),
        seated: !!opts.seated,
      },
      setHudHidden: () => {},
      setDof: () => {},
      capture: () => out.shots++,
      render: (s) => (out.bar = s),
      clockHour: () => 13.25,
      setLook: (l) => {
        out.look = l;
        out.looks++;
      },
      focusAt: () => out.depth,
      hasPost: () => opts.post ?? true,
      hasPointer: () => opts.pointer ?? true,
    },
    new Bindings(),
  );
  return { photo, cam, out };
}
const row = (s: PhotoState | undefined, id: string) => s!.rows.find((r) => r.id === id)!;

describe('#photo-2: the panel', () => {
  it('has five tabs of rows; up and down choose a row, left and right change it, and on the tabs change tab', () => {
    const { photo, out } = setup();
    photo.enter();
    expect(PHOTO_TABS.map((t) => t.id)).toEqual(['view', 'focus', 'light', 'bot', 'frame']);
    expect([out.bar?.tab, out.bar?.row]).toEqual(['view', -1]); // it opens on the tabs
    expect(out.bar?.rows.map((r) => r.id)).toEqual(['lens', 'roll', 'tilt', 'resetView']);
    photo.nav('right');
    expect(out.bar?.tab).toBe('focus');
    photo.nav('left');
    photo.nav('left'); // round to the last
    expect(out.bar?.tab).toBe('frame');
    photo.nav('down');
    expect(out.bar?.row).toBe(0);
    photo.nav('right'); // the shape row: the next shape
    expect(out.bar?.frame).toBe('wide');
    photo.nav('left');
    photo.nav('left'); // and round the other way
    expect(out.bar?.frame).toBe('cinema');
    for (let i = 0; i < 9; i++) photo.nav('down');
    expect(out.bar?.row).toBe(3); // it stops on the last row
    for (let i = 0; i < 9; i++) photo.nav('up');
    expect(out.bar?.row).toBe(-1); // and back on the tabs
  });

  it('a hidden panel comes back at the first press, which changes nothing else', () => {
    const { photo, out } = setup();
    photo.enter();
    photo.action('backpack');
    expect(out.bar?.clean).toBe(true);
    photo.nav('right');
    expect([out.bar?.clean, out.bar?.tab]).toEqual([false, 'view']);
  });

  it('every row has words for what it is set to, and the old shortcuts still name their rows', () => {
    const { photo } = setup();
    photo.enter();
    const shortcuts: Record<string, string> = {};
    for (const t of PHOTO_TABS)
      for (const r of photo.rows(t.id)) {
        expect(r.label.length).toBeGreaterThan(0);
        expect(r.text.length).toBeGreaterThan(0);
        if (r.kind === 'slider') expect(r.value).toBeGreaterThanOrEqual(r.min!);
        if (r.kind === 'slider') expect(r.value).toBeLessThanOrEqual(r.max!);
        if (r.action) shortcuts[r.id] = r.action;
      }
    expect(shortcuts).toEqual({ tilt: 'rotate', resetView: 'recentre', dof: 'eat', hour: 'pinNext', weather: 'map', filter: 'removeMode', hideBot: 'interact', freeze: 'buildMenu', clean: 'backpack' });
  });

  it('A (or Enter) presses the row in hand: a toggle, a button or a choice; on the tabs or a slider it keeps its own meaning', () => {
    const { photo, out } = setup();
    photo.enter();
    expect(photo.pressRow()).toBe(false); // on the tabs
    photo.nav('down'); // the lens: a slider
    expect(photo.pressRow()).toBe(false);
    photo.setTab('bot');
    photo.nav('up');
    photo.nav('up');
    photo.nav('down'); // the first row: bloombot in the picture or not
    expect(photo.pressRow()).toBe(true);
    expect([out.bar?.hideBot, out.visible]).toEqual([true, false]);
    photo.pressRow();
    photo.nav('down'); // the pose: a choice steps on
    expect(photo.pressRow()).toBe(true);
    expect(out.poses).toEqual(['cheer']);
    photo.setTab('frame');
    for (let i = 0; i < 5; i++) photo.nav('down'); // the last row: hide the panel
    expect(photo.pressRow()).toBe(true);
    expect(out.bar?.clean).toBe(true);
    expect(photo.pressRow()).toBe(false); // hidden: A is its shortcut again
    photo.exit();
    expect(photo.pressRow()).toBe(false);
  });

  it('Tide’s lesson has no panel to walk', () => {
    const { photo, out } = setup();
    photo.enter(true);
    photo.nav('right');
    photo.setTab('frame');
    expect([out.bar?.tab, out.bar?.row]).toEqual(['view', -1]);
  });
});

describe('#photo-2: the lens', () => {
  it('the lens slider runs from wide to long, leans the horizon, and leaving puts the view’s own lens back', () => {
    const { photo, cam, out } = setup();
    photo.enter();
    expect(row(out.bar, 'lens').text).toBe(`${focalLength(50)} mm`); // the view's own lens until one is chosen
    expect(cam.fovOverride).toBeUndefined();
    photo.setValue('lens', PHOTO_LENS.fovMax); // far right: the longest lens, the narrowest view
    expect(cam.fovOverride).toBe(PHOTO_LENS.fovMin);
    photo.setValue('lens', -999); // held within its range: the widest
    expect(cam.fovOverride).toBe(PHOTO_LENS.fovMax);
    expect(focalLength(PHOTO_LENS.fovMin)).toBeGreaterThan(focalLength(PHOTO_LENS.fovMax));
    photo.setValue('roll', 17);
    expect([cam.roll, row(out.bar, 'roll').text]).toEqual([17, '+17°']);
    photo.setValue('roll', 0.3); // near level snaps level
    expect([cam.roll, row(out.bar, 'roll').text]).toEqual([0, 'Level']);
    photo.setValue('roll', -30);
    photo.setValue('tilt', 999);
    expect(cam.pitchOffset).toBe(PHOTO.tiltMax);
    photo.adjust('resetView');
    expect([cam.fovOverride, cam.roll, cam.pitchOffset]).toEqual([undefined, 0, 0]);
    photo.setValue('lens', 60);
    photo.setValue('roll', 9);
    photo.exit();
    expect([cam.fovOverride, cam.roll]).toEqual([undefined, 0]);
    photo.enter();
    expect([photo.fov, photo.roll]).toEqual([undefined, 0]); // the next visit starts on the view's own lens, level
  });

  it('a step left or right moves a slider a notch', () => {
    const { photo, cam } = setup();
    photo.enter();
    photo.nav('down'); // the lens row
    photo.nav('right');
    expect(cam.fovOverride).toBe(50 - 4); // a notch longer
    photo.nav('down');
    photo.nav('left');
    expect(cam.roll).toBe(-5);
  });
});

describe('#photo-2: focus, brightness and the vignette', () => {
  it('the look goes to the host as it is set, and leaving gives the game its own look back', () => {
    const { photo, out } = setup();
    photo.enter();
    expect(out.look).toEqual({ dof: true, focus: undefined, blur: 0.3, ev: 0, vignette: 0 });
    photo.setValue('blur', 0.8);
    photo.setValue('ev', 1.2);
    photo.setValue('vignette', 0.6);
    photo.setValue('focus', focusToSlider(12));
    expect(out.look?.blur).toBe(0.8);
    expect(out.look?.ev).toBe(1.2);
    expect(out.look?.vignette).toBe(0.6);
    expect(out.look?.focus).toBeCloseTo(12, 6);
    photo.setValue('ev', 0.03); // near nothing is nothing
    expect([out.look?.ev, row({ ...out.bar!, rows: photo.rows('light') }, 'ev').text]).toEqual([0, 'As it is']);
    photo.exit();
    expect(out.look).toBeUndefined();
    photo.enter();
    // the blur's strength is kept for the session; the focus, brightness and vignette are for one visit
    expect(out.look).toEqual({ dof: true, focus: undefined, blur: 0.8, ev: 0, vignette: 0 });
  });

  it('the focus slider covers its range in even ratios', () => {
    expect(focusFromSlider(0)).toBeCloseTo(PHOTO_LENS.focusMin, 9);
    expect(focusFromSlider(1)).toBeCloseTo(PHOTO_LENS.focusMax, 9);
    expect(focusFromSlider(0.5)).toBeCloseTo(Math.sqrt(PHOTO_LENS.focusMin * PHOTO_LENS.focusMax), 9);
    for (const d of [0.6, 2, 9.5, 60]) expect(focusFromSlider(focusToSlider(d))).toBeCloseTo(d, 9);
  });

  it('“Pick a spot”: the next press on the picture sets the focus there and saves nothing; then it offers the middle again', () => {
    const { photo, out } = setup();
    photo.enter();
    photo.setTab('focus');
    expect(row(out.bar, 'pick').text).toBe('Pick a spot');
    photo.adjust('pick');
    expect(out.bar?.picking).toBe(true);
    photo.action('pulse'); // the press that would save a picture
    expect([out.shots, out.bar?.picking, out.look?.focus]).toEqual([0, false, 7.5]);
    expect(row(out.bar, 'focus').text).toBe('7.5 tiles');
    photo.action('pulse');
    expect(out.shots).toBe(1); // the next press saves as usual
    expect(row(out.bar, 'pick').text).toBe('Back to the middle');
    photo.adjust('pick');
    expect(out.look?.focus).toBeUndefined();
    // a press on the sky finds nothing: the focus stays where it was
    photo.adjust('pick');
    out.depth = undefined;
    photo.action('pulse');
    expect([out.bar?.picking, out.look?.focus, out.shots]).toEqual([false, undefined, 1]);
    // far spots are held within the lens's range
    photo.adjust('pick');
    out.depth = 500;
    photo.action('pulse');
    expect(out.look?.focus).toBe(PHOTO_LENS.focusMax);
  });

  it('“Pick a spot” needs a pointer: with a pad in hand the row says so and does nothing', () => {
    const { photo, out } = setup({ pointer: false });
    photo.enter();
    photo.setTab('focus');
    expect(row(out.bar, 'pick').off).toBe('This needs a mouse: use the slider above');
    photo.adjust('pick');
    expect(out.bar?.picking).toBe(false);
    photo.setValue('focus', 0.5); // the slider still sets the focus
    expect(out.look?.focus).toBeGreaterThan(0);
  });

  it('with the blur off its rows wait, and without post-processing the blur and vignette say why', () => {
    const { photo, out } = setup();
    photo.enter();
    photo.action('eat'); // blur off
    photo.setTab('focus');
    expect(row(out.bar, 'blur').off).toBe('Turn the blur on first');
    const was = out.look?.blur;
    photo.setValue('blur', 1);
    photo.adjust('pick');
    expect([out.look?.blur, out.bar?.picking]).toEqual([was, false]);

    const low = setup({ post: false });
    low.photo.enter();
    for (const id of ['dof', 'focus', 'pick', 'blur'] as const) expect(low.photo.rows('focus').find((r) => r.id === id)?.off).toBe('Needs Medium graphics or better');
    expect(low.photo.rows('light').find((r) => r.id === 'vignette')?.off).toBe('Needs Medium graphics or better');
    expect(low.photo.rows('light').find((r) => r.id === 'ev')?.off).toBeUndefined(); // brightness is the exposure: every tier has it
    low.photo.setValue('vignette', 1);
    expect(low.out.look?.vignette).toBe(0);
  });
});

describe('#photo-2: bloombot', () => {
  it('strikes a pose, holds a face through it, turns to the camera, and is itself again on leaving', () => {
    const { photo, out } = setup();
    photo.enter();
    photo.adjust('pose');
    expect(out.poses).toEqual(['cheer']);
    photo.adjust('face');
    photo.adjust('face');
    expect(out.faces).toEqual(['happy', 'surprised']);
    photo.adjust('pose'); // the clip brings its own face: the chosen one is put back
    expect(out.poses).toEqual(['cheer', 'wave']);
    expect(out.faces).toEqual(['happy', 'surprised', 'surprised']);
    photo.adjust('faceCamera');
    expect(out.facing).toEqual([true]);
    photo.exit();
    expect(out.facing).toEqual([true, false]); // back the way it faced
    expect(out.faces.at(-1)).toBe('auto');
    photo.enter();
    expect([photo.pose, photo.face, photo.faceCamera]).toEqual(['stand', 'auto', false]);
  });

  it('a hidden or seated bloombot takes no pose', () => {
    const hidden = setup();
    hidden.photo.enter();
    hidden.photo.action('interact');
    hidden.photo.adjust('pose');
    hidden.photo.adjust('face');
    hidden.photo.adjust('faceCamera');
    expect([hidden.out.poses, hidden.out.faces, hidden.out.facing]).toEqual([[], [], []]);
    const seated = setup({ seated: true });
    seated.photo.enter();
    seated.photo.adjust('pose');
    seated.photo.adjust('faceCamera');
    seated.photo.adjust('face'); // a face is fine on a bench
    expect([seated.out.poses, seated.out.facing, seated.out.faces]).toEqual([[], [], ['happy']]);
  });
});

describe('#photo-2: the frame', () => {
  it('the shape, guides, picture size and open tab are kept for the session', () => {
    const { photo, out } = setup();
    photo.enter();
    photo.setTab('frame');
    photo.adjust('frame');
    photo.adjust('grid');
    photo.adjust('size');
    expect([out.bar?.frame, out.bar?.grid, photo.pictureScale]).toEqual(['wide', 'thirds', 2]);
    photo.exit();
    photo.enter();
    expect([out.bar?.frame, out.bar?.grid, photo.pictureScale, out.bar?.tab]).toEqual(['wide', 'thirds', 2, 'frame']);
  });

  it('the saved picture is the biggest centred box of the shape, in whole pixels inside the view', () => {
    expect(frameRect(1920, 1080, 0)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(frameRect(1920, 1080, 1)).toEqual({ x: 420, y: 0, w: 1080, h: 1080 });
    expect(frameRect(1920, 1080, 9 / 16)).toEqual({ x: 656, y: 0, w: 608, h: 1080 });
    expect(frameRect(1280, 800, 21 / 9)).toEqual({ x: 0, y: 125, w: 1280, h: 549 });
    for (const f of Object.values(PHOTO_FRAMES))
      for (const [w, h] of [[1920, 1080], [1280, 800], [3840, 2160], [801, 1203], [3, 2]]) {
        const r = frameRect(w, h, f.ratio);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(w);
        expect(r.y + r.h).toBeLessThanOrEqual(h);
        expect(r.w === w || r.h === h).toBe(true); // it touches the view on one axis
        if (f.ratio && w > 100) expect(Math.abs(r.w / r.h - f.ratio)).toBeLessThan(0.01);
      }
  });
});
