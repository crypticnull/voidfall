// Persistent meta-progression: gold earned across all runs plus the permanent
// upgrade levels bought in the shop. Stored in localStorage so it survives between
// runs and between launches of the program.
// voidfallSurvivors.v1, not duskfallSurvivors.v4: the key namespace moves with the rename, and
// the break is deliberate. 0.6.6 rebuilt the tome curves, the enemy curves, the XP economy and
// the relic layer underneath it, so a save from before that is not a head start — it is a wallet
// balanced against a game that no longer exists. Abandoning the old key resets every machine at
// once rather than relying on each being cleared by hand.
import { SAVE_RESET_TOKEN } from './save-reset.js';

const STORAGE_KEY = 'voidfallSurvivors.meta.v1';

// Each upgrade grants `perLevel` of its stat per level, up to `max` levels. The cost
// of the next level is baseCost * costMult^(currentLevel), so upgrades get pricier as
// you invest. `pct: true` upgrades are shown/applied as percentages.
// PRICES ARE DERIVED FROM MEASURED INCOME, not chosen freehand. tools/gold-model.mjs computes
// what a stage-1 run pays using the game's own loot functions; as of this pricing:
//
//   FAIL  ≈ 15 gold   (dying at ~60% of stage 1 — the normal early outcome)
//   CLEAR ≈ 123 gold  (full stage + boss hoard + boss chest + a 45s horde rush)
//
// Chests are half that by design (see CHEST_GOLD in loot.js). They were briefly 81% of it, when
// switching stat-affix items off turned every chest into a coin hoard — one source drowning out
// the horde rush, the boss hoard and the per-kill coins together. Cutting chests to half the
// income moved the whole economy down with it, hence this sheet.
//
// The anchors are unchanged, only re-measured: a cheap stat line costs about one FAILED run, so
// every death still buys something; a tome slot costs about ONE CLEAR, so the first boss kill
// opens the shop's first real choice; the skill slot sits at ~1.4 clears as the chase above it.
// If the economy moves again — a new gold source, a chest-value change — re-run the model and
// re-derive the whole sheet. Never nudge one price in isolation.
export const UPGRADES = [
  { id: 'moveSpeed', name: 'Fleet Boots', stat: 'Move Speed', perLevel: 0.04, pct: true, max: 8, baseCost: 15, costMult: 1.5 },
  { id: 'xpGain', name: 'Ancient Wisdom', stat: 'XP Gain', perLevel: 0.06, pct: true, max: 8, baseCost: 18, costMult: 1.5 },
  { id: 'critRate', name: 'Keen Eye', stat: 'Crit Chance', perLevel: 0.02, pct: true, max: 8, baseCost: 20, costMult: 1.55 },
  { id: 'projectiles', name: 'Split Soul', stat: 'Projectiles', perLevel: 1, pct: false, max: 3, baseCost: 100, costMult: 2.4 },
  { id: 'areaOfEffect', name: 'Wide Impact', stat: 'Area of Effect', perLevel: 0.08, pct: true, max: 6, baseCost: 25, costMult: 1.6 },
  { id: 'reroll', name: "Diviner's Token", stat: 'Level-Up Reroll', perLevel: 1, pct: false, max: 6, baseCost: 60, costMult: 1.7 },
  // Support slots start at 3 and still climb to 6, so this line lost its cheapest rung to the
  // free baseline: three purchases, not four, and the ladder is the shifted one. At 125/250/500
  // a full shelf is roughly seven cleared runs — the longest single commitment in the shop,
  // which is right for permanent build room.
  { id: 'supportSlots', name: 'Reliquary Shelf', stat: 'Tome Slots', perLevel: 1, pct: false, max: 3, baseCost: 125, costMult: 2.0 },
  // Active skill gems: 3 by default, 5 fully invested. Priced at the rung each purchase
  // actually occupies, and still the dearest line PER LEVEL, because a skill slot is a whole
  // extra attack running for the entire run.
  { id: 'skillSlots', name: 'Rune Girdle', stat: 'Skill Slots', perLevel: 1, pct: false, max: 2, baseCost: 170, costMult: 2.2 },
  { id: 'musicPlayer', name: 'Wandering Bard', stat: 'Music Player', perLevel: 1, pct: false, max: 1, baseCost: 25, costMult: 1 },
];

const FRESH = () => ({ gold: 0, upgrades: {}, deaths: 0, kills: 0, resetToken: SAVE_RESET_TOKEN });

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const d = raw ? JSON.parse(raw) : {};
    // A save written under a DIFFERENT reset token is discarded, not migrated. This is what
    // makes `npm run wipe-saves` a guarantee rather than a hope: the wipe travels inside the
    // build, so it happens on first launch wherever that build runs — browser, exe, any
    // machine — without anyone having to find and delete a folder. See src/save-reset.js.
    if (d.resetToken !== SAVE_RESET_TOKEN) return FRESH();
    // `deaths` defaults to 0, so saves written before the counter existed load cleanly rather
    // than coming back undefined and rendering as "NaN" on the menu.
    return { gold: d.gold || 0, upgrades: d.upgrades || {}, deaths: d.deaths || 0,
             kills: d.kills || 0, resetToken: SAVE_RESET_TOKEN };
  } catch {
    return FRESH();
  }
}

let meta = load();
// Write immediately at startup so STORAGE matches what the game is running on. Without this a
// rejected save is only rejected in memory: the old blob sits in localStorage until something
// happens to trigger a write, so anything reading the raw key — a later migration, a debug
// session, me — still sees the gold and upgrades that were supposed to be gone.
save();

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(meta)); } catch { /* storage unavailable */ }
}

export function getGold() { return meta.gold; }
export function addGold(n) { meta.gold += n; save(); }

// Lifetime deaths across every character and every run. Deliberately kept HERE rather than
// derived from the leaderboard: that list is trimmed to its top 10 entries, so counting losses
// in it would cap at 10 and then go DOWN as better runs pushed older ones out.
export function getDeaths() { return meta.deaths; }
export function recordDeath() { meta.deaths += 1; save(); }

// Lifetime kills across every run — what the achievement tiers count against.
//
// NOT saved on every kill. A busy screen kills hundreds of things a second, and a localStorage
// write per kill would stall the frame; the count is held in memory and flushed on a timer, plus
// immediately at any real checkpoint (death, run end) so nothing meaningful is lost. Worst case
// a crash costs a couple of seconds of kills, which is the right trade for not writing to disk
// inside the hot loop.
const KILL_FLUSH_MS = 2000;
let killFlushTimer = null;

export function getKills() { return meta.kills; }

export function addKills(n = 1) {
  meta.kills += n;
  if (killFlushTimer) return;
  killFlushTimer = setTimeout(() => { killFlushTimer = null; save(); }, KILL_FLUSH_MS);
}

/** Write pending kills out now — call at a checkpoint rather than waiting for the timer. */
export function flushKills() {
  if (killFlushTimer) { clearTimeout(killFlushTimer); killFlushTimer = null; }
  save();
}

// ---------- Achievements ----------
// Deliberately data, not code: a tier list the UI renders and the game only ever appends to.
// Adding a track later (bosses felled, stages cleared, gold banked) means another entry here
// with its own `value` reader, and nothing else changes.
export const ACHIEVEMENTS = [
  {
    id: 'kills',
    name: 'Cull',
    desc: 'Enemies slain across every run.',
    tiers: [500, 5000, 25000, 100000, 1000000],
    rank: ['Gravedigger', 'Reaper', 'Butcher of the Dusk', 'Harbinger', 'The Voidfall'],
    value: () => meta.kills,
  },
];

/** A track's live state: how far along, which tiers are done, what is next. */
export function achievementState(a) {
  const v = a.value();
  const done = a.tiers.filter((t) => v >= t).length;
  const next = a.tiers[done];                 // undefined once every tier is taken
  const prev = done > 0 ? a.tiers[done - 1] : 0;
  return {
    value: v, done, next,
    complete: next === undefined,
    // Progress through the CURRENT tier, not through the whole list — the tiers are decades
    // apart, so a bar measured against the last one would sit at zero for most of a run.
    fraction: next === undefined ? 1 : Math.max(0, Math.min(1, (v - prev) / (next - prev))),
    rank: done > 0 ? a.rank[done - 1] : null,
  };
}

// ---------- Dev override: every upgrade at max ----------
// An OVERLAY, not a write. The obvious implementation — snapshot the levels, set them all to
// max, restore on toggle-off — puts the player's real purchases in a variable that only exists
// until the program closes. Crash, or quit with it still on, and the maxed levels are what is
// on disk and the snapshot is gone: their progress is silently overwritten by a testing switch.
//
// Reading through an overlay instead means meta.upgrades is never touched, so "revert to what
// it was before" is not a restore step that can fail — there is nothing to put back.
let allUpgrades = false;

export function getAllUpgrades() { return allUpgrades; }
export function setAllUpgrades(on) { allUpgrades = !!on; }

/** Levels actually bought and paid for, ignoring the override. */
function purchasedLevel(id) { return meta.upgrades[id] || 0; }

export function getUpgradeLevel(id) {
  if (allUpgrades) {
    const def = UPGRADES.find((u) => u.id === id);
    if (def) return def.max;
  }
  return purchasedLevel(id);
}
export function setGold(n) { meta.gold = Math.max(0, Math.floor(n)); save(); }

// Wipes gold, every purchased upgrade AND the death tally — a brand-new-player state. Run
// history (the leaderboard) and saved skill tuning live elsewhere and are deliberately
// untouched.
//
// Deaths used to be carried across on the grounds that a record of what happened is not a
// resource. That was the wrong call: the counter sits on the main menu beside the gold this
// wipes, so a "reset" that leaves it standing reads as a bug rather than as a principle.
//
// Rebuilding the object wholesale means any field added to the store must be repeated here —
// omitting `deaths` once left it undefined and the menu rendered "NaN", which the type
// checker caught.
export function resetMeta() {
  meta = FRESH();
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
  // purchasedLevel, not getUpgradeLevel: with the override on, the latter reports max and this
  // would bank max+1 into the save — the one way the overlay could still corrupt progress.
  // (upgradeCost already returns null while the override is on, so this is unreachable today;
  // it is written this way so it stays correct if that ever changes.)
  meta.upgrades[id] = purchasedLevel(id) + 1;
  save();
  return true;
}

/**
 * Grant one level of a random un-maxed upgrade for FREE — the Unspent Coin's cash-out.
 * Returns the granted upgrade's display name, or null when everything is already maxed.
 * Uses purchasedLevel for the same overlay-safety reason buyUpgrade does.
 */
export function grantRandomUpgradeLevel() {
  const open = UPGRADES.filter((u) => purchasedLevel(u.id) < u.max);
  if (!open.length) return null;
  const u = open[Math.floor(Math.random() * open.length)];
  meta.upgrades[u.id] = purchasedLevel(u.id) + 1;
  save();
  return u.name;
}

// Aggregate current upgrade effects, applied to the player each run.
export function upgradeBonuses() {
  const key = { moveSpeed: 'speedMult', xpGain: 'xpMult', critRate: 'critChance', projectiles: 'projectiles', areaOfEffect: 'areaMult', supportSlots: 'supportSlots', skillSlots: 'skillSlots' };
  const b = { speedMult: 0, xpMult: 0, critChance: 0, projectiles: 0, areaMult: 0, supportSlots: 0, skillSlots: 0 };
  for (const def of UPGRADES) if (key[def.id]) b[key[def.id]] += def.perLevel * getUpgradeLevel(def.id);
  return b;
}
