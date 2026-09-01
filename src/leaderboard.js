// Bumping this key abandons old data everywhere at once — including packaged builds — instead
// of relying on each machine being cleared by hand. Done twice now: once when v1 filled with
// nonsense times accumulated while building, and again at the Voidfall rename, where the
// difficulty and XP curves changed enough that old times are not comparable to new ones.
import { SAVE_RESET_TOKEN } from './save-reset.js';

const STORAGE_KEY = 'voidfallSurvivors.leaderboard.v1';
const MAX_ENTRIES = 10;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const d = raw ? JSON.parse(raw) : null;
    // Stored as { token, entries } so the board answers to the same reset token the meta save
    // does — a wipe that cleared gold but left ten old times behind is not a wipe. A bare array
    // is a pre-token save and is therefore discarded, which is the correct behaviour for one.
    if (!d || Array.isArray(d) || d.token !== SAVE_RESET_TOKEN) return [];
    return Array.isArray(d.entries) ? d.entries : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: SAVE_RESET_TOKEN, entries: list }));
  } catch { /* storage unavailable */ }
}

// Normalise storage to the current token at startup, for the same reason meta.js does: a
// rejected board is otherwise only rejected in memory, and the old entries sit in localStorage
// until someone finishes a run. Writing the accepted (possibly empty) list once makes what is
// on disk match what the game is actually using.
save(load());

function sortEntries(list) {
  return list.slice().sort((a, b) => (b.stage || 1) - (a.stage || 1) || b.time - a.time || b.kills - a.kills);
}

export function getEntries() { return sortEntries(load()); }

export function recordRun({ time, kills, level, className, classId, victory, stage, endlessWave }) {
  const list = load();
  // classId is what the leaderboard's run portraits are drawn from. It was being passed in by
  // the caller and silently dropped here, so every stored entry lacked it.
  // endlessWave records how deep past the Sovereign a run went; 0 (or absent, on old entries)
  // means the run ended inside the campaign.
  list.push({ time, kills, level, className, classId, victory, stage, endlessWave: endlessWave || 0, date: Date.now() });
  const trimmed = sortEntries(list).slice(0, MAX_ENTRIES);
  save(trimmed);
  return trimmed;
}

export function clearEntries() { save([]); }
