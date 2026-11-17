// Desktop wrapper for the Steam Deck build (#243): shows the built game (dist/) full screen.
// The game is served from app://solarbloom/ instead of file://, so its fetches (models, textures) work and the
// save in localStorage always belongs to the same origin.
const { app, BrowserWindow, net, protocol } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    // Never serve anything outside dist/.
    if (file !== DIST && !file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const win = new BrowserWindow({
    width: 1280,
    height: 800, // the Steam Deck's screen
    fullscreen: !process.argv.includes('--windowed'),
    autoHideMenuBar: true,
    backgroundColor: '#0e2224',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  // The game opens no other pages: block new windows and navigation away from it.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://solarbloom/')) e.preventDefault();
  });
  win.loadURL('app://solarbloom/');
});

app.on('window-all-closed', () => app.quit());
