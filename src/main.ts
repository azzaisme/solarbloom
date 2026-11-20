import './ui/styles.css';
import './ui/hud.css';
import './ui/build.css';
import './ui/panels.css';
import './ui/title.css';
import { boot } from './app/Boot';

const canvas = document.getElementById('app') as HTMLCanvasElement;
// E22.12: splash → title → loading → the game (src/app/Boot.ts). Saves are compressed, so loading is asynchronous.
boot(canvas).catch((err) => {
  console.error(err);
  document.getElementById('loading')?.remove();
  const el = document.getElementById('boot');
  if (el) {
    el.classList.remove('gone');
    el.textContent = 'Solarbloom needs WebGL to grow. Please try another browser.';
  }
});
