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

// The version this build was released as (the release workflow stamps package.json with it).
ipcMain.on('sb:version', (e) => {
  e.returnValue = app.getVersion();
});

/**
 * In-game updates (the Steam Deck build): on launch the game quietly checks the GitHub releases for a newer build,
 * downloads it in the background and tells the game when it is ready. It installs when the player chooses
 * "Restart to update", or on its own the next time the game closes. Only a packaged AppImage updates itself (it
 * replaces the file in place, ~/Applications/Solarbloom.AppImage, so the Steam shortcut keeps working); offline,
 * or anything going wrong, simply means no update this time: the game is never held up by it.
 */
let updater;
let updateReady;
function startUpdates(win) {
  if (!app.isPackaged || !process.env.APPIMAGE || process.argv.includes('--no-update')) return;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch {
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  updater.logger = null;
  updater.on('update-downloaded', (info) => {
    updateReady = info.version;
    if (!win.isDestroyed()) win.webContents.send('sb:update', updateReady);
  });
  updater.on('error', () => {
    /* offline or no release yet: try again next launch */
  });
  // a few seconds after launch, so the check never competes with loading the game
  setTimeout(() => updater.checkForUpdates().catch(() => {}), 8000);
}
// a page that loads later (the title after a reload) asks whether an update is already waiting
ipcMain.on('sb:update-ready', (e) => {
  e.returnValue = updateReady ?? null;
});
ipcMain.on('sb:update-restart', () => {
  if (updater && updateReady) updater.quitAndInstall(true, true);
});
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
  startUpdates(win);
});

app.on('window-all-closed', () => app.quit());
