import type { WeatherKind } from '../data/weather';
import type { Sim } from '../gameplay/Sim';
import type { PhotoMode } from './PhotoMode';

/**
 * E23.7.3 (#397): what the screen shows of the sky: the time of day (a day fraction) and the weather. Photo mode's
 * own choices win while it is open; otherwise it is the game's light clock and weather. The game draws the sky,
 * light, rain and fog from this alone, and it only ever reads the sim: nothing set in photo mode reaches the game.
 */
export function sceneNow(sim: Sim, photo: Pick<PhotoMode, 'lightOverride' | 'weatherOverride'> | undefined): { f: number; weather: WeatherKind } {
  return { f: photo?.lightOverride() ?? sim.clock.dayFraction(), weather: photo?.weatherOverride() ?? sim.weather.kind() };
}
