// Runs in the game's page before it loads (sandboxed). Gives the game:
// - file saves in the user data folder (ready for Steam Cloud), through synchronous calls to the main process,
//   because the game's save layer is synchronous (it must finish inside page unload);
// - whether this is a Steam Deck;
// and hides the mouse cursor until the mouse is used.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('solarbloomDesktop', {
  deck: ipcRenderer.sendSync('sb:deck'),
  saves: {
    getItem: (k) => ipcRenderer.sendSync('sb:save-get', String(k)),
    setItem: (k, v) => {
      const err = ipcRenderer.sendSync('sb:save-set', String(k), String(v));
      if (err) throw new Error(err); // the game treats a throw as "storage refused the save"
    },
    removeItem: (k) => ipcRenderer.sendSync('sb:save-remove', String(k)),
  },
  // E22.11: the menu's "Quit to desktop", and pausing while the Deck sleeps.
  quit: () => ipcRenderer.send('sb:quit'),
  // the release this build is (for the title screen and Settings), and in-game updates
  version: ipcRenderer.sendSync('sb:version'),
  update: {
    ready: () => ipcRenderer.sendSync('sb:update-ready'),
    onReady: (cb) => ipcRenderer.on('sb:update', (_e, version) => cb(version)),
    restart: () => ipcRenderer.send('sb:update-restart'),
  },
  onPower: (cb) => ipcRenderer.on('sb:power', (_e, state) => cb(state)),
});

window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = 'html.sb-no-cursor, html.sb-no-cursor * { cursor: none !important; }';
  document.head.appendChild(style);
  const root = document.documentElement;
  let timer;
  const hide = () => root.classList.add('sb-no-cursor');
  hide();
  window.addEventListener(
    'mousemove',
    () => {
      root.classList.remove('sb-no-cursor');
      clearTimeout(timer);
      timer = setTimeout(hide, 4000);
    },
    { passive: true },
  );
});
