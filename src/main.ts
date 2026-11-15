import './ui/styles.css';
import './ui/garden.css';
import { Game } from './app/Game';
import { SaveService } from './app/SaveService';

const canvas = document.getElementById('app') as HTMLCanvasElement;
// Saves are compressed, so loading is asynchronous; the game boots once the save is read.
new SaveService()
  .loadResultAsync()
  .then(async (lr) => {
    const game = await Game.create(canvas, lr);
    (window as unknown as { solarbloom: Game }).solarbloom = game;
    // Debug tools (Phase 4 E00.5) exist only on the dev server; production builds drop this branch.
    if (import.meta.env.DEV) void import('./app/DevTools').then((m) => m.installDevTools(game));
    requestAnimationFrame(() => document.getElementById('boot')?.classList.add('gone'));
  })
  .catch((err) => {
    console.error(err);
    const boot = document.getElementById('boot');
    if (boot) boot.textContent = 'The garden could not load. Check your connection and reload; Solarbloom also needs WebGL.';
  });
