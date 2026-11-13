import './ui/styles.css';
import { Game } from './app/Game';

const canvas = document.getElementById('app') as HTMLCanvasElement;
try {
  const game = new Game(canvas);
  (window as unknown as { solarbloom: Game }).solarbloom = game;
  requestAnimationFrame(() => document.getElementById('boot')?.classList.add('gone'));
} catch (err) {
  console.error(err);
  const boot = document.getElementById('boot');
  if (boot) boot.textContent = 'Solarbloom needs WebGL to grow. Please try another browser.';
}
