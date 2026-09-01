// Ambient declarations for things the browser/Electron provide but the standard DOM lib
// doesn't describe. Type-checking only — this file ships nothing and is never imported.

interface Window {
  /** Legacy Safari prefix, still probed for by ensureCtx(). */
  webkitAudioContext?: typeof AudioContext;
  /** Injected by electron/preload.js; absent when running in a plain browser. */
  electronAPI?: {
    quit?: () => void;
    setDisplayMode?: (mode: string) => void;
    [key: string]: any;
  };
}
