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
// Where a Dev Tools Save lands when the game is running as a packaged exe. It cannot go back
// into the repo the way the dev server writes tuning/skill-tuning.json — a portable build
// unpacks to a temp directory and its own files are inside a read-only asar — so it goes to
// userData, which is stable across launches and survives the temp dir being thrown away.
//
// This exists because balance work done in a release used to be a dead end. The values were
// safe in localStorage, but localStorage is per-origin: the exe (127.0.0.1:41893) and the
// testing browser (localhost:8791) keep separate copies and a build running in Node can read
// neither. Tuning in the exe and then rebuilding would bake the OLD numbers straight over the
// top of the session's work, silently. A plain JSON file is what makes that recoverable.
// Two files, matching the two the dev server writes into the repo — skills bake into skills.js,
// player and enemy stats into classes.js and enemies.js.
const TUNING_FILES = {
  '/tuning': 'skill-tuning.json',
  '/entity-tuning': 'entity-tuning.json',
};
function tuningFile(route) {
  return path.join(app.getPath('userData'), TUNING_FILES[route]);
}

function startServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);

      // The one write the game is allowed to make. Matches the dev server's endpoint so the
      // page needs no branch of its own — publishTune() posts the same body to both.
      if (req.method === 'POST' && TUNING_FILES[urlPath]) {
        const dest = tuningFile(urlPath);
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          // A Save is a few hundred bytes. Anything wildly beyond that is not our payload,
          // and an unbounded accumulator on an open socket is not worth leaving lying around.
          if (body.length > 1e6) { req.destroy(); }
        });
        req.on('end', () => {
          try {
            // Parse before writing, so a malformed body cannot replace a good file with junk
            // that the next build would then fail to bake.
            const parsed = JSON.parse(body);
            fs.writeFile(dest, JSON.stringify(parsed, null, 2), (err) => {
              if (err) { res.writeHead(500); res.end('write failed'); return; }
              res.writeHead(200, { 'Content-Type': 'text/plain' });
              res.end(dest);
            });
          } catch {
            res.writeHead(400); res.end('bad json');
          }
        });
        return;
      }
      // The matching READ. The game now loads its tuning from this file rather than from
      // localStorage, so the exe has exactly one store instead of a localStorage authority plus
      // a write-only JSON export that could — and repeatedly did — drift apart from it.
      // A missing file is an empty store, not an error: a fresh install has never saved anything.
      if (req.method === 'GET' && TUNING_FILES[urlPath]) {
        fs.readFile(tuningFile(urlPath), 'utf8', (err, data) => {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(err ? '{}' : data);
        });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405); res.end('Method not allowed'); return;
      }

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
    title: 'Voidfall Survivors',
    // Created fullscreen because borderless is the default (src/settings.js). The renderer still
    // pushes the saved mode once it loads, so a player who chose windowed gets it — but the
    // COMMON path now opens straight into borderless instead of painting a 1600x900 window and
    // resizing it a beat later, which read as the game flinching on every launch.
    fullscreen: true,
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
