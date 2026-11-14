import './ui/styles.css';
import { Game } from './app/Game';
import { SaveService } from './app/SaveService';

const canvas = document.getElementById('app') as HTMLCanvasElement;
// Saves are compressed, so loading is asynchronous; the game boots once the save is read.
new SaveService()
  .loadResultAsync()
  .then((lr) => {
    const game = new Game(canvas, lr);
    (window as unknown as { solarbloom: Game }).solarbloom = game;
    requestAnimationFrame(() => document.getElementById('boot')?.classList.add('gone'));
  })
  .catch((err) => {
    console.error(err);
    const boot = document.getElementById('boot');
    if (boot) boot.textContent = 'Solarbloom needs WebGL to grow. Please try another browser.';
  });
