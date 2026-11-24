import { appVersion, updates } from './version';
import type { Row, SettingsTab } from './SettingsScreen';
import { canFullScreen, isFullScreen, setFullScreen } from '../app/FullScreen';
import { GLOW_STEPS } from '../data/look';

/**
 * E22.11: what each Settings tab holds, shared by the title screen and the in-game menu. `inGame` adds what only
 * means something with a game running (its stats); `debug` shows the developer's game speed (fast-forward is a
 * developer tool only, E22.10).
 */
export interface RowContext {
  inGame: boolean;
  debug: boolean;
  /** "Auto (High)", "Auto (Steam Deck)" */
  autoLabel?: string;
  /** the game's stats block (HTML), in game only */
  stats?: string;
  /** #633: the graphics tier in use draws no glow (Low): the Glow row says so */
  glowOff?: boolean;
  /** whether the game's sound is running, in plain words (in game only) */
  sound?: string;
}

export function settingsRows(tab: SettingsTab, c: RowContext): Row[] {
  switch (tab) {
    case 'game':
      return [
        { kind: 'html', html: `<p class="set-version">Solarbloom version ${appVersion()}${updates.ready() ? ` · version ${updates.ready()} is ready: quit to the title screen and choose Restart to update` : ''}</p>` },
        { kind: 'check', key: 'hints', label: 'Tips on what to do next' },
        { kind: 'check', key: 'realClock', label: 'Follow my clock', hint: c.inGame ? 'The sky and the sun keep your local time; everything grows at the same pace' : 'New gardens offer to follow your local time first' },
        { kind: 'check', key: 'potter', label: 'Potter about', hint: 'Just wander: no tips or pointers, and the flowers spread more gently' },
        { kind: 'check', key: 'showNumbers', label: 'Show details', hint: 'Adds the figures to the energy and water gauges' },
        { kind: 'check', key: 'followChains', label: 'Camera follows the flowers when they spread far' },
        { kind: 'check', key: 'pauseOnBlur', label: 'Pause when the window is not in focus', defaultOn: true },
        // developer numbers in the corner: only once a developer has turned them on with their key (F3), so it can go off
        ...(c.debug ? [{ kind: 'check', key: 'debug', label: 'Developer numbers in the corner (F3)' } as Row] : []),
        ...(c.debug ? [{ kind: 'select', key: 'speed', label: 'Game speed (developer)', options: [['1', 'Normal'], ['2', 'Two times'], ['3', 'Three times']], fallback: '1', numeric: true } as Row] : []),
        ...(c.inGame && c.stats ? [{ kind: 'heading', label: 'Your garden so far' } as Row, { kind: 'html', html: c.stats } as Row] : []),
      ];
    case 'controls':
      return []; // drawn by the host (E22.4)
    case 'display':
      return [
        {
          kind: 'select',
          key: 'gfx',
          label: 'Graphics',
          options: [
            ['auto', c.autoLabel ?? 'Auto'],
            ['high', 'High'],
            ['deck', 'Steam Deck'],
            ['medium', 'Medium'],
            ['low', 'Low'],
          ],
          fallback: 'auto',
        },
        // #633: "Glow", not "bloom": in this game a bloom is a flower
        { kind: 'select', key: 'glow', label: 'Glow', hint: c.glowOff ? "Graphics is set to Low, so lights don't shine. Set Graphics higher, just above, to turn this on" : 'How much lamps and lit windows shine. Turn it down if they look too bright', options: [...GLOW_STEPS], fallback: '1', numeric: true },
        { kind: 'check', key: 'lowVfx', label: 'Fewer sparkles and drifting bits in the air' },
        { kind: 'check', key: 'lowFog', label: 'Simpler fog', hint: 'Helps the game run smoothly on small devices' },
        { kind: 'check', key: 'fireflies', label: 'Fireflies at night', defaultOn: true },
        // in a browser: the page's own full screen keeps Esc for the game (the browser's F11 takes Esc for itself)
        ...(canFullScreen() ? [{ kind: 'toggle', id: 'fullScreen', label: 'Full screen', hint: 'Press Esc to open the menu. Hold Esc down for a moment to leave full screen', get: isFullScreen, set: setFullScreen } as Row] : []),
      ];
    case 'sound':
      return [
        ...(c.sound ? [{ kind: 'html', html: `<p class="set-version">${c.sound}</p>` } as Row] : []),
        { kind: 'range', key: 'masterVolume', label: 'Master volume', min: 0, max: 100, step: 5, fallback: 100, unit: ' percent' },
        { kind: 'check', key: 'music', label: 'Music' },
        { kind: 'range', key: 'musicVolume', label: 'Music volume', min: 0, max: 100, step: 5, fallback: 100, unit: ' percent' },
        // Phase 8: the world's own sound (wind, leaves, water, birds) has its own level, apart from the effects
        { kind: 'range', key: 'ambienceVolume', label: 'World sounds volume', min: 0, max: 100, step: 5, fallback: 100, unit: ' percent' },
        { kind: 'check', key: 'sound', label: 'Sound effects' },
        { kind: 'range', key: 'sfxVolume', label: 'Effects volume', min: 0, max: 100, step: 5, fallback: 100, unit: ' percent' },
        { kind: 'range', key: 'uiVolume', label: 'Menu sounds volume', min: 0, max: 100, step: 5, fallback: 100, unit: ' percent' },
        { kind: 'check', key: 'reducedRepetitive', label: 'Fewer repeated sounds', hint: 'Birds sing a little less, and spreading flowers, drones and menu buttons sound less often' },
      ];
    case 'access':
      return [
        { kind: 'select', key: 'messageTime', label: 'How long messages stay on screen', hint: 'Tips and messages stay long enough to read; choose longer to take your time', options: [['1', 'Long enough to read'], ['1.6', 'Longer'], ['2.5', 'Much longer']], fallback: '1', numeric: true },
        { kind: 'select', key: 'uiScale', label: 'Text and interface size', options: [['100', '100%'], ['125', '125%'], ['150', '150%']], fallback: '100', numeric: true },
        { kind: 'check', key: 'highContrast', label: 'High contrast', hint: 'Stronger colours and clearer edges on the menus and cards' },
        { kind: 'check', key: 'reducedMotion', label: 'Reduced motion and effects', hint: 'Less shaking, flashing and bouncing on screen' },
        { kind: 'check', key: 'holdToAct', label: 'Hold the button to dig and pry', hint: 'Turn this off to dig out piles and pry rubble open with a single press', defaultOn: true },
        { kind: 'heading', label: 'Camera' },
        { kind: 'select', key: 'camSensitivity', label: 'Camera speed', options: [['50', 'Slow'], ['75', 'Gentle'], ['100', 'Normal'], ['150', 'Quick'], ['200', 'Fast']], fallback: '100', numeric: true },
        {
          kind: 'select',
          key: 'mouseMode',
          // the golden rule: say what the player will see happen, not what the code does
          label: 'Turning the camera with the mouse',
          hint: 'Hold to look: hold the right mouse button and move the mouse to turn the camera; let go and the mouse pointer is back for the menus. Mouse capture: press a mouse button on the world and the pointer disappears, so the mouse always turns the camera; press Esc to bring the pointer back',
          options: [
            ['hold', 'Hold to look'],
            ['capture', 'Mouse capture'],
          ],
          fallback: 'hold',
        },
        { kind: 'check', key: 'invertX', label: 'Invert camera left and right' },
        { kind: 'check', key: 'invertY', label: 'Invert camera up and down' },
        { kind: 'check', key: 'noRecentre', label: 'Keep the camera where I turn it', hint: 'The camera stays put instead of swinging back behind Bloombot' },
        { kind: 'check', key: 'noVistas', label: 'Stay with Bloombot when a new place opens' },
      ];
  }
}
