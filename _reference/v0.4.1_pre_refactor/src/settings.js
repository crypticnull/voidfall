const STORAGE_KEY = 'embercall.settings.v1';
const defaults = {
  inputPromptMode: 'auto', // 'auto' | 'keyboard' | 'gamepad'
  activeGamepadId: null, // null = auto-pick; otherwise a specific Gamepad.id to prefer
  musicVolume: 1,
  sfxVolume: 0.45,
  displayMode: 'windowed', // 'windowed' | 'borderless' (borderless fullscreen)
  godMode: false,        // player takes no damage
  infiniteRerolls: false, // unlimited free level-up rerolls
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

let settings = load();

export function getSettings() { return settings; }

export function setSetting(key, value) {
  settings = { ...settings, [key]: value };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
