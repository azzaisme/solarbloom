// Desktop wrapper for the Steam Deck build (#243): shows the built game (dist/) full screen.
// The game is served from app://solarbloom/ instead of file://, so its fetches (models, textures) work and the
// save in localStorage always belongs to the same origin.
const { app, BrowserWindow, ipcMain, net, powerMonitor, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');

// The user data folder is named after this: ~/.config/Solarbloom on Linux (saves live in its saves/ folder).
app.setName('Solarbloom');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

// Saves: one file per key in <user data>/saves, written to a temporary file and renamed so a crash or a
// suspend mid-write never leaves half a save.
const savesDir = () => path.join(app.getPath('userData'), 'saves');
const saveFile = (key) => path.join(savesDir(), `${key.replace(/[^a-zA-Z0-9._-]/g, '_')}.sav`);
ipcMain.on('sb:deck', (e) => {
  e.returnValue = process.env.SteamDeck === '1' || process.argv.includes('--deck');
});
ipcMain.on('sb:save-get', (e, key) => {
  try {
    e.returnValue = fs.readFileSync(saveFile(key), 'utf8');
  } catch {
    e.returnValue = null;
  }
});
ipcMain.on('sb:save-set', (e, key, value) => {
  try {
    fs.mkdirSync(savesDir(), { recursive: true });
    const file = saveFile(key);
    fs.writeFileSync(`${file}.tmp`, value, 'utf8');
    fs.renameSync(`${file}.tmp`, file);
    e.returnValue = '';
  } catch (err) {
    e.returnValue = String(err && err.message ? err.message : err);
  }
});
ipcMain.on('sb:quit', () => app.quit());
ipcMain.on('sb:save-remove', (e, key) => {
  try {
    fs.rmSync(saveFile(key), { force: true });
  } catch {
    /* nothing to remove */
  }
  e.returnValue = null;
});

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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.setMenuBarVisibility(false);
  // The game opens no other pages: block new windows and navigation away from it.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://solarbloom/')) e.preventDefault();
  });
  win.loadURL('app://solarbloom/');
  // E22.11: the game pauses while the Deck (or computer) sleeps.
  powerMonitor.on('suspend', () => win.webContents.send('sb:power', 'suspend'));
  powerMonitor.on('resume', () => win.webContents.send('sb:power', 'resume'));
});

app.on('window-all-closed', () => app.quit());
