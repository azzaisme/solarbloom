import { describe, expect, it } from 'vitest';
import { Bindings } from '../src/app/Bindings';
import { GOLDEN_HOUR, PHOTO_FILTERS, PHOTO_WEATHERS, PhotoMode, type PhotoState } from '../src/app/PhotoMode';
import { createInitialState } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';

/** a camera that remembers nothing (E19.4.1's framing test covers the camera) */
const camera = () => ({ snapshot: () => ({}) as never, restore: () => {}, pitchOffset: 0, maxZoom: 4.2, held: false, zoomBy: () => {}, pan: () => {}, orbit: () => {}, recentre: () => {} });

function setup(realHour = 13.25) {
  const out = { filter: '', bar: undefined as PhotoState | undefined };
  const photo = new PhotoMode(
    {
      camera: camera(),
      setHudHidden: () => {},
      setDof: () => {},
      capture: () => {},
      render: (s) => (out.bar = s),
      clockHour: () => realHour,
      setFilter: (css) => (out.filter = css),
    },
    new Bindings(undefined, { oldCity: true }),
  );
  return { photo, out };
}

describe('E23.7.3: photo mode sets the time and the weather', () => {
  it('a time slider and an hour step show their own time of day; outside photo mode there is none', () => {
    const { photo, out } = setup();
    photo.setHour(9);
    expect(photo.lightOverride()).toBeUndefined(); // not open: nothing changes the view
    photo.enter();
    expect(photo.lightOverride()).toBeUndefined(); // the real time until a time is picked
    photo.setHour(18);
    expect(photo.lightOverride()).toBeCloseTo(0.5, 6); // 18:00 is halfway through the day (06:00 is dawn)
    expect(out.bar?.hour).toBe(18);
    photo.setHour(undefined);
    photo.action('pinNext'); // G / d-pad right: the next hour from the real time
    expect(photo.hour).toBe(14);
    for (let i = 0; i < 22; i++) photo.action('pinNext');
    expect(photo.hour).toBe(12);
    photo.action('pinNext'); // a full turn comes back to the real time
    expect(photo.hour).toBeUndefined();
  });

  it('the weather picker has sun, golden hour, cloud, rain, wind, storm and fog; golden hour sets the evening', () => {
    const { photo } = setup();
    photo.enter();
    expect(photo.weatherOverride()).toBeUndefined();
    const seen: string[] = [];
    for (let i = 0; i < PHOTO_WEATHERS.length; i++) {
      photo.action('map');
      seen.push(photo.weather);
      if (photo.weather === 'golden') {
        expect(photo.weatherOverride()).toBe('sunny');
        expect(photo.hour).toBe(GOLDEN_HOUR);
      }
    }
    expect(seen).toEqual(['sunny', 'golden', 'cloudy', 'rain', 'wind', 'storm', 'fog', 'now']);
  });

  it('filters go over the view and the picture', () => {
    const { photo, out } = setup();
    photo.enter();
    photo.action('removeMode');
    expect(photo.filter).toBe('warm');
    expect(out.filter).toBe(PHOTO_FILTERS.warm.css);
  });

  it('leaving restores the real time and weather, and takes the filter away', () => {
    const { photo, out } = setup();
    photo.enter();
    photo.setHour(2);
    photo.setWeather('storm');
    photo.setFilter('mono');
    photo.exit();
    expect([photo.lightOverride(), photo.weatherOverride(), photo.hour, photo.weather, photo.filter, out.filter]).toEqual([undefined, undefined, undefined, 'now', 'none', '']);
    photo.enter();
    expect(photo.lightOverride()).toBeUndefined(); // the next visit starts from the real sky
  });

  it('nothing set in photo mode changes the game: the sim never sees it', () => {
    const sim = new Sim(createInitialState(9, 'oldcity'));
    sim.advance(5);
    const before = JSON.stringify(sim.state);
    const day = [sim.clock.dayFraction(), sim.weather.kind(), sim.clock.solarFactor()];
    const { photo } = setup();
    photo.enter();
    photo.setHour(23);
    photo.setWeather('storm');
    photo.setFilter('vivid');
    expect(JSON.stringify(sim.state)).toBe(before);
    expect([sim.clock.dayFraction(), sim.weather.kind(), sim.clock.solarFactor()]).toEqual(day);
  });
});
