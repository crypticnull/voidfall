// Persistent meta-progression: gold earned across all runs plus the permanent
// upgrade levels bought in the shop. Stored in localStorage so it survives between
// runs and between launches of the program.
const STORAGE_KEY = 'duskfallSurvivors.meta.v3';

// Each upgrade grants `perLevel` of its stat per level, up to `max` levels. The cost
// of the next level is baseCost * costMult^(currentLevel), so upgrades get pricier as
// you invest. `pct: true` upgrades are shown/applied as percentages.
export const UPGRADES = [
  { id: 'moveSpeed', name: 'Fleet Boots', stat: 'Move Speed', perLevel: 0.04, pct: true, max: 8, baseCost: 40, costMult: 1.5 },
  { id: 'xpGain', name: 'Ancient Wisdom', stat: 'XP Gain', perLevel: 0.06, pct: true, max: 8, baseCost: 50, costMult: 1.5 },
  { id: 'critRate', name: 'Keen Eye', stat: 'Crit Chance', perLevel: 0.02, pct: true, max: 8, baseCost: 60, costMult: 1.55 },
  { id: 'projectiles', name: 'Split Soul', stat: 'Projectiles', perLevel: 1, pct: false, max: 3, baseCost: 250, costMult: 2.4 },
  { id: 'areaOfEffect', name: 'Wide Impact', stat: 'Area of Effect', perLevel: 0.08, pct: true, max: 6, baseCost: 80, costMult: 1.6 },
  { id: 'reroll', name: "Diviner's Token", stat: 'Level-Up Reroll', perLevel: 1, pct: false, max: 6, baseCost: 150, costMult: 1.7 },
  // Support slots start at 2 and climb to 6. Priced steeply and made the most expensive line
  // in the shop on purpose: a slot is permanent build room, not a percentage bump.
  { id: 'supportSlots', name: 'Reliquary Shelf', stat: 'Tome Slots', perLevel: 1, pct: false, max: 4, baseCost: 300, costMult: 2.0 },
  { id: 'musicPlayer', name: 'Wandering Bard', stat: 'Music Player', perLevel: 1, pct: false, max: 1, baseCost: 100, costMult: 1 },
];

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const d = raw ? JSON.parse(raw) : {};
    return { gold: d.gold || 0, upgrades: d.upgrades || {} };
  } catch {
    return { gold: 0, upgrades: {} };
  }
}

let meta = load();

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(meta)); } catch { /* storage unavailable */ }
}

export function getGold() { return meta.gold; }
export function addGold(n) { meta.gold += n; save(); }

export function getUpgradeLevel(id) { return meta.upgrades[id] || 0; }
export function setGold(n) { meta.gold = Math.max(0, Math.floor(n)); save(); }

// Wipes gold and every purchased upgrade — a brand-new-player state. Run history
// (the leaderboard) and saved skill tuning live elsewhere and are deliberately untouched.
export function resetMeta() {
  meta = { gold: 0, upgrades: {} };
  save();
}

// Cost of the next level, or null if already maxed.
export function upgradeCost(def) {
  const lvl = getUpgradeLevel(def.id);
  if (lvl >= def.max) return null;
  return Math.round(def.baseCost * Math.pow(def.costMult, lvl));
}

// Attempt to buy one level of an upgrade. Returns true on success.
export function buyUpgrade(id) {
  const def = UPGRADES.find((u) => u.id === id);
  if (!def) return false;
  const cost = upgradeCost(def);
  if (cost === null || meta.gold < cost) return false;
  meta.gold -= cost;
  meta.upgrades[id] = getUpgradeLevel(id) + 1;
  save();
  return true;
}

// Aggregate current upgrade effects, applied to the player each run.
export function upgradeBonuses() {
  const key = { moveSpeed: 'speedMult', xpGain: 'xpMult', critRate: 'critChance', projectiles: 'projectiles', areaOfEffect: 'areaMult', supportSlots: 'supportSlots' };
  const b = { speedMult: 0, xpMult: 0, critChance: 0, projectiles: 0, areaMult: 0, supportSlots: 0 };
  for (const def of UPGRADES) if (key[def.id]) b[key[def.id]] += def.perLevel * getUpgradeLevel(def.id);
  return b;
}
