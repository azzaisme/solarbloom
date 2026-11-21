import type { Row, SettingsTab } from './SettingsScreen';
import { canFullScreen, isFullScreen, setFullScreen } from '../app/FullScreen';

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
}

export function settingsRows(tab: SettingsTab, c: RowContext): Row[] {
  switch (tab) {
    case 'game':
      return [
        { kind: 'check', key: 'hints', label: 'Tutorial hints' },
        { kind: 'check', key: 'realClock', label: 'Follow my clock', hint: c.inGame ? 'The sky and the sun keep your local time; everything grows at the same pace' : 'New gardens offer to follow your local time first' },
        { kind: 'check', key: 'potter', label: 'Potter about', hint: 'No nudges or tips, and gentler chains' },
        { kind: 'check', key: 'showNumbers', label: 'Show details', hint: 'Adds the figures to the energy and water gauges' },
        { kind: 'check', key: 'followChains', label: 'Camera follows big chains' },
        { kind: 'check', key: 'pauseOnBlur', label: 'Pause when the window is not in focus', defaultOn: true },
        { kind: 'check', key: 'debug', label: 'Debug overlay (F3)' },
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
        { kind: 'check', key: 'lowVfx', label: 'Fewer particles and softer sparkles' },
        { kind: 'check', key: 'lowFog', label: 'Simple fog (faster on small devices)' },
        { kind: 'check', key: 'fireflies', label: 'Fireflies at night', defaultOn: true },
        // in a browser: the page's own full screen keeps Esc for the game (the browser's F11 takes Esc for itself)
        ...(canFullScreen() ? [{ kind: 'toggle', id: 'fullScreen', label: 'Full screen', hint: 'Esc stays with the game. Hold Esc to leave full screen', get: isFullScreen, set: setFullScreen } as Row] : []),
      ];
    case 'sound':
      return [
        { kind: 'check', key: 'sound', label: 'Sound effects' },
        { kind: 'range', key: 'sfxVolume', label: 'Effects volume', min: 0, max: 100, step: 5, fallback: 100, unit: ' percent' },
        { kind: 'check', key: 'music', label: 'Music' },
        { kind: 'range', key: 'musicVolume', label: 'Music volume', min: 0, max: 100, step: 5, fallback: 100, unit: ' percent' },
      ];
    case 'access':
      return [
        { kind: 'select', key: 'uiScale', label: 'Text and interface size', options: [['100', '100%'], ['125', '125%'], ['150', '150%']], fallback: '100', numeric: true },
        { kind: 'check', key: 'highContrast', label: 'High contrast' },
        { kind: 'check', key: 'reducedMotion', label: 'Reduced motion and effects' },
        { kind: 'check', key: 'holdToAct', label: 'Hold to act', hint: 'Off: one press salvages or pries', defaultOn: true },
        { kind: 'heading', label: 'Camera' },
        { kind: 'select', key: 'camSensitivity', label: 'Camera speed', options: [['50', 'Slow'], ['75', 'Gentle'], ['100', 'Normal'], ['150', 'Quick'], ['200', 'Fast']], fallback: '100', numeric: true },
        { kind: 'check', key: 'mouseLook', label: 'Look around with the mouse', hint: 'Press a mouse button over the world to take the mouse; Esc frees it', defaultOn: true },
        { kind: 'check', key: 'invertX', label: 'Invert camera left and right' },
        { kind: 'check', key: 'invertY', label: 'Invert camera up and down' },
        { kind: 'check', key: 'noRecentre', label: 'Keep the view where I turn it' },
        { kind: 'check', key: 'noVistas', label: 'Skip the view when a new place opens' },
      ];
  }
}
