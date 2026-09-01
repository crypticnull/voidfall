// v2: v1 was full of nonsense times and kill counts accumulated while building. Bumping the
// key abandons that data everywhere at once — including packaged builds — instead of
// relying on each machine being cleared by hand.
const STORAGE_KEY = 'duskfallSurvivors.leaderboard.v2';
const MAX_ENTRIES = 10;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

function sortEntries(list) {
  return list.slice().sort((a, b) => (b.stage || 1) - (a.stage || 1) || b.time - a.time || b.kills - a.kills);
}

export function getEntries() { return sortEntries(load()); }

export function recordRun({ time, kills, level, className, victory, stage }) {
  const list = load();
  list.push({ time, kills, level, className, victory, stage, date: Date.now() });
  const trimmed = sortEntries(list).slice(0, MAX_ENTRIES);
  save(trimmed);
  return trimmed;
}

export function clearEntries() { save([]); }
