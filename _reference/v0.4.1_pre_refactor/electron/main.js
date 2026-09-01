const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT_DIR = path.normalize(path.join(__dirname, '..'));

// Fixed loopback port so the page origin (http://127.0.0.1:PORT) stays identical
// across launches. localStorage — which backs the leaderboard and settings — is
// scoped to that origin, so a stable port is what lets saved data survive a quit.
const PORT = 41893;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  // Every format the music scanner accepts (see AUDIO_EXT in src/audio.js). Serving one of
  // these as octet-stream leaves playback to content sniffing, which is not dependable —
  // a track would simply never start, with nothing in the console to say why.
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

// Serves the game's static files over http://127.0.0.1 instead of file:// —
// Chromium blocks ES module `import` fetches on the file: origin (no CORS
// headers possible there), so a plain BrowserWindow.loadFile() would fail
// on the game's `<script type="module">` entry point.
function startServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let filePath = path.normalize(path.join(rootDir, urlPath === '/' ? '/index.html' : urlPath));
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    // Prefer the fixed port for stable storage; if it's momentarily held (e.g. a
    // previous instance still closing), fall back to an ephemeral port so the game
    // still launches rather than hard-failing.
    server.once('error', () => server.listen(0, '127.0.0.1', () => resolve(server)));
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

let mainWindow;
let server;

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  server = await startServer(ROOT_DIR);
  const { port } = server.address();

  mainWindow = new BrowserWindow({
    title: 'Duskfall Survivors',
    width: 1600,
    height: 900,
    autoHideMenuBar: true,
    backgroundColor: '#070504',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}/index.html`);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow.loadURL(`http://127.0.0.1:${port}/index.html`);
  });
});

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('app-quit', () => app.quit());

// Toggle between normal windowed and borderless fullscreen (fills the whole screen).
ipcMain.on('set-display-mode', (_e, mode) => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(mode === 'borderless');
});
