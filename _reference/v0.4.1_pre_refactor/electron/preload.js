const { contextBridge, ipcRenderer } = require('electron');

// Exposes a minimal, safe surface to the game's renderer code — no direct
// Node/IPC access, just a single one-way "quit the app" call.
contextBridge.exposeInMainWorld('electronAPI', {
  quit: () => ipcRenderer.send('app-quit'),
  setDisplayMode: (mode) => ipcRenderer.send('set-display-mode', mode), // 'windowed' | 'borderless'
});
