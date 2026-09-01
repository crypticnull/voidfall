// `embercall` was this project's first name, two renames ago, and the key outlived both. Moved
// to the current namespace with the 0.6.6 save reset so there is exactly one prefix on disk.
//
// MIGRATED rather than abandoned, unlike the meta and leaderboard keys. Those were reset on
// purpose — old progress is balanced against a game that no longer exists. Settings are not
// progress: nobody wants their audio, display and controller choices wiped because the title
// changed. The old key is read once and carried over, then removed.
const STORAGE_KEY = 'voidfallSurvivors.settings.v1';
const LEGACY_KEY = 'embercall.settings.v1';
const defaults = {
  inputPromptMode: 'auto', // 'auto' | 'keyboard' | 'gamepad'
  activeGamepadId: null, // null = auto-pick; otherwise a specific Gamepad.id to prefer
  musicVolume: 1,
  sfxVolume: 0.45,
  // Borderless is the default: this is a fullscreen action game and a windowed launch is a
  // thing you have to fix every time. The Electron shell also CREATES its window fullscreen to
  // match (electron/main.js), so the common path has no resize flash on launch.
  displayMode: 'borderless', // 'windowed' | 'borderless' (borderless fullscreen)
  // Fraction of the window the game canvas actually renders at, then upscaled to fill it.
  // 1 is native. Lower trades sharpness for framerate WITHOUT widening the view: the drawing
  // code keeps working in window-sized coordinates and a base transform does the shrinking,
  // so a low setting is a fidelity choice and never a gameplay advantage.
  renderScale: 1,
  // Multiplier on every DOM overlay — HUD, menus, toasts. Independent of renderScale so the
  // text stays crisp at any resolution.
  uiScale: 1,
  // Dev Tools is hidden by default. It is a developer entrance, not a player feature, and it
  // was taking a full row on two menus that are otherwise short lists of things you actually
  // want. Revealed from Settings when it is needed.
  showDevTools: false,
  // The lower-left FPS / enemies / projectiles / effects readout. Off by default: it is a
  // diagnostic, and a permanent number in the corner is noise for anyone not chasing a frame
  // cost. It stayed on only because there was no way to turn it off.
  showPerfPanel: false,
  godMode: false,        // player takes no damage
  infiniteRerolls: false, // unlimited free level-up rerolls
  // Every shop upgrade read as maxed. Safe to persist because it is an overlay in meta.js and
  // never writes upgrade levels to the save — see setAllUpgrades there.
  allUpgrades: false,
};

function load() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      // One-time carry-over from the old namespace, then the old key is dropped so this only
      // ever happens once per machine.
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy !== null) {
        localStorage.setItem(STORAGE_KEY, legacy);
        localStorage.removeItem(LEGACY_KEY);
        raw = legacy;
      }
    }
    const d = raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
    // ---- one-time re-defaults ----
    // Changing a default only reaches people who have never touched settings; anyone who has
    // played once has the OLD value written to disk and would swear the change did nothing.
    // `settingsRev` lets a specific key be re-defaulted exactly once. Deliberately narrow: it
    // names the keys it resets rather than wiping the file, so nobody loses their audio,
    // controller or scale choices to a display-mode change.
    if ((d.settingsRev || 0) < SETTINGS_REV) {
      d.displayMode = defaults.displayMode;   // rev 1: windowed -> borderless
      d.settingsRev = SETTINGS_REV;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch { /* storage unavailable */ }
    }
    return d;
  } catch {
    return { ...defaults };
  }
}

// Bump to re-apply a changed default over saved settings ONCE. See the migration in load().
const SETTINGS_REV = 1;

let settings = load();

export function getSettings() { return settings; }

export function setSetting(key, value) {
  settings = { ...settings, [key]: value };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
