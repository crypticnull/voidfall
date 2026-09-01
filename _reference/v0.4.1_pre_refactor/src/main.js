import { rand, randInt, clamp, dist, dist2, normalize, pick, pickWeighted, shuffle } from './utils.js';
import { CLASSES } from './classes.js';
import { SKILLS, SKILL_ORDER, rollUpgradeTier, rollSupportLevels, rollStatMult,
  rollSkillUpgrade, SKILL_ATTRS, INFUSIONS, estimateSkillDps,
  TUNE_META, tuneDefaults, resetTune, resetAllTunes, skillCooldown,
  saveTune, applyStoredTunes } from './skills.js';
import { SUPPORTS, SUPPORT_ORDER } from './supports.js';
import { ENEMY_TYPES, ENEMY_ORDER, DESERT_ENEMY_ORDER, UNDERWORLD_ENEMY_ORDER,
  poolForTime, difficultyMult, spawnIntervalFor, makeBoss } from './enemies.js';
import { rollItem, applyItem, rollChestReward } from './loot.js';
import { pollGamepad, listConnectedPads } from './gamepad.js';
import { getSettings, setSetting } from './settings.js';
import { drawSprite, drawSpriteRotated, facingDir, spriteHasFacing, onSpriteArtLoaded,
  spriteContent, spriteFrameIndex, handDrawnSpriteIds, spriteAspect } from './sprites.js';
import { initAudio, resumeAudio, setSfxVolume, setMusicVolume, play, playMusic,
  MUSIC_TRACK_LIST, onTrackChange } from './audio.js';
import { getGold, addGold, setGold, resetMeta, getUpgradeLevel, upgradeCost, buyUpgrade,
  upgradeBonuses, UPGRADES } from './meta.js';
import { getEntries, recordRun, clearEntries } from './leaderboard.js';
import { STAGES } from './stages.js';
import { BUILD_LABEL } from './version.js';
import * as ui from './ui.js';

const canvas = document.getElementById('game');
const ctx2d = canvas.getContext('2d');
ctx2d.imageSmoothingEnabled = false;

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; ctx2d.imageSmoothingEnabled = false; }
window.addEventListener('resize', resize);
resize();

// ---------- visual helpers: grimy hand-drawn look instead of clean vector shapes ----------
function makeBlobPoints(radius, seedCount = 9, jitter = 0.24) {
  const pts = [];
  for (let i = 0; i < seedCount; i++) {
    const a = (i / seedCount) * Math.PI * 2;
    const r = radius * (1 - jitter / 2 + Math.random() * jitter);
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

let floorPattern = null;
// Builds a seamless 128px floor tile. A shared chunky pixel-dither grain underlies a
// per-stage motif — graveyard mud & dead grass, desert wind ripples, underworld
// cracked flagstones with glowing veins — so each realm reads distinct up close.
// Hand-drawn floor tiles, loaded once and reused. Kept separate from the sprite system: these
// are CanvasPatterns tiled over the whole arena, not entities with frames and facings.
const BEAM_EMBER_CAP = 16; // live embers per Solar Ray beam
const FLOOR_TILE_SCALE = 3; // hand-drawn tiles render 3x their source size
// Period of the current floor pattern, in world pixels. The floor scrolls by offsetting a
// repeating fill, and that offset has to wrap on the pattern's OWN size — wrapping on a
// constant that no longer matches (128 vs a 192px hand-drawn tile) makes the whole floor
// jump sideways every time it wraps, which reads as the ground sliding under the player.
let floorPatternSize = 128;
const floorTileCache = new Map();
function floorTileFor(stageDef) {
  const src = stageDef.floorTile;
  if (!src) return null;
  let entry = floorTileCache.get(src);
  if (!entry) {
    entry = { img: new Image(), ready: false };
    entry.img.onload = () => {
      entry.ready = true;
      // The pattern may have been built from the fallback before this resolved, so rebuild
      // the live one now rather than waiting for the next stage change.
      floorPattern = makeFloorPattern(STAGES[currentStage] || stageDef);
    };
    entry.img.src = src;
    floorTileCache.set(src, entry);
  }
  return entry.ready ? entry.img : null;
}

function makeFloorPattern(stageDef) {
  const tileImg = floorTileFor(stageDef);
  if (tileImg) {
    // Record the true period: the scroll offset below must wrap on THIS, not on a constant.
    floorPatternSize = tileImg.width * FLOOR_TILE_SCALE;
    // Drawn at FLOOR_TILE_SCALE so a 64px tile reads at its intended size on screen rather
    // than as fine noise. Scaled into the pattern canvas (not via a pattern transform) so
    // nearest-neighbour applies and the pixels stay crisp blocks.
    const c = document.createElement('canvas');
    c.width = tileImg.width * FLOOR_TILE_SCALE;
    c.height = tileImg.height * FLOOR_TILE_SCALE;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    // Contrast is applied to the ART, before any dimming. contrast() pivots around mid-grey,
    // so a value below 1 lifts the darks and pulls back the highlights — which is what keeps
    // a dimmed tile from crushing its shadows into flat black.
    if (stageDef.floorTileContrast !== undefined) g.filter = `contrast(${stageDef.floorTileContrast})`;
    g.drawImage(tileImg, 0, 0, c.width, c.height);
    g.filter = 'none';
    // Optional per-stage knock-down. Tiles are authored independently and can land at wildly
    // different exposures — the desert sand reads ~4.5x brighter than the graveyard cobbles —
    // which the warm torch glow on top then pushes further. Black at alpha d multiplies the
    // art by (1 - d), so this darkens without shifting hue the way a colour tint would.
    if (stageDef.floorTileDim) {
      g.fillStyle = `rgba(0,0,0,${stageDef.floorTileDim})`;
      g.fillRect(0, 0, c.width, c.height);
    }
    return ctx2d.createPattern(c, 'repeat');
  }
  floorPatternSize = 128; // the procedural fallback tile is 128px square
  const [sr, sg, sb] = stageDef.floorSpeck;
  const B = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const speck = (amt, a) => `rgba(${B(sr + amt)},${B(sg + amt * 0.8)},${B(sb + amt * 0.6)},${a})`;
  const ri = (n) => (Math.random() * n) | 0;
  const tile = document.createElement('canvas');
  tile.width = 128; tile.height = 128;
  const t = tile.getContext('2d');
  t.imageSmoothingEnabled = false;

  // Base fill + a chunky pixel-dither of shaded flecks for grain.
  t.fillStyle = stageDef.floorBase;
  t.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 240; i++) {
    const s = 1 + ri(2);
    t.fillStyle = speck(Math.random() * 30 - 15, Math.random() * 0.4 + 0.14);
    t.fillRect(ri(128), ri(128), s, s);
  }

  if (stageDef.id === 'graveyard') {
    for (let i = 0; i < 5; i++) { t.fillStyle = 'rgba(0,0,0,0.12)'; t.fillRect(ri(120), ri(120), 10 + ri(14), 7 + ri(10)); }
    for (let i = 0; i < 12; i++) { const x = ri(128), y = ri(128); t.fillStyle = '#463d31'; t.fillRect(x, y, 3, 2); t.fillStyle = '#5c5142'; t.fillRect(x, y, 1, 1); }
    for (let i = 0; i < 16; i++) {
      const x = ri(128), y = ri(128);
      t.strokeStyle = 'rgba(74,92,52,0.5)'; t.lineWidth = 1; t.beginPath();
      t.moveTo(x, y); t.lineTo(x - 1, y - 4); t.moveTo(x + 1, y); t.lineTo(x + 2, y - 5); t.moveTo(x + 2, y); t.lineTo(x + 2, y - 3);
      t.stroke();
    }
    for (let i = 0; i < 5; i++) { t.strokeStyle = 'rgba(0,0,0,0.3)'; t.lineWidth = 1; t.beginPath(); let x = ri(128), y = ri(128); t.moveTo(x, y); for (let j = 0; j < 4; j++) { x += (Math.random() - 0.5) * 32; y += (Math.random() - 0.5) * 32; t.lineTo(x, y); } t.stroke(); }
  } else if (stageDef.id === 'desert') {
    for (let i = 0; i < 7; i++) {
      const y = i * 18 + ri(6);
      t.strokeStyle = speck(22, 0.22); t.lineWidth = 2; t.beginPath();
      for (let x = 0; x <= 128; x += 6) { const yy = y + Math.sin(x * 0.16 + i) * 2.6; if (x === 0) t.moveTo(x, yy); else t.lineTo(x, yy); }
      t.stroke();
      t.strokeStyle = 'rgba(0,0,0,0.12)'; t.lineWidth = 1; t.beginPath();
      for (let x = 0; x <= 128; x += 6) { const yy = y + 2.4 + Math.sin(x * 0.16 + i) * 2.6; if (x === 0) t.moveTo(x, yy); else t.lineTo(x, yy); }
      t.stroke();
    }
    for (let i = 0; i < 10; i++) { const x = ri(128), y = ri(128); t.fillStyle = '#8a7048'; t.fillRect(x, y, 3, 2); t.fillStyle = '#ab9062'; t.fillRect(x, y, 1, 1); }
  } else {
    // Underworld cracked flagstones (brick-offset seams that tile cleanly).
    t.strokeStyle = 'rgba(0,0,0,0.4)'; t.lineWidth = 2;
    for (let row = 0; row < 128; row += 32) {
      t.beginPath(); t.moveTo(0, row); t.lineTo(128, row); t.stroke();
      const off = ((row / 32) % 2) * 32;
      for (let x = off; x <= 128; x += 64) { t.beginPath(); t.moveTo(x, row); t.lineTo(x, row + 32); t.stroke(); }
    }
    t.strokeStyle = 'rgba(130,120,145,0.16)'; t.lineWidth = 1;
    for (let row = 0; row < 128; row += 32) { t.beginPath(); t.moveTo(0, row + 1.5); t.lineTo(128, row + 1.5); t.stroke(); }
    for (let i = 0; i < 3; i++) {
      t.strokeStyle = 'rgba(120,217,90,0.4)'; t.lineWidth = 1; t.beginPath();
      let x = ri(128), y = ri(128); t.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += (Math.random() - 0.5) * 26; y += (Math.random() - 0.5) * 26; t.lineTo(x, y); }
      t.stroke();
    }
    for (let i = 0; i < 14; i++) { t.fillStyle = Math.random() < 0.5 ? 'rgba(140,230,110,0.5)' : 'rgba(150,110,210,0.45)'; t.fillRect(ri(128), ri(128), 1, 1); }
  }
  return ctx2d.createPattern(tile, 'repeat');
}
floorPattern = makeFloorPattern(STAGES[0]);

const ARENA_RADIUS = 1500; // half-extent of the square arena (spans ±ARENA_RADIUS on each axis)
const BOSS_TIME = 300; // seconds of survival that summon the boss
const KILL_THRESHOLD = 500; // per-stage kills that summon the boss early
// Hard ceiling on live enemies. Past this the sim (collision, rendering, and especially the
// per-death sound effects) degrades badly, so spawning holds until the arena thins out.
// Bosses are exempt — one must always be able to appear.
const MAX_ENEMIES = 1024;
// Projectiles and effects are spawned in bursts (fanned shots, per-hit VFX) and were the two
// uncapped pools. Oldest entries are dropped first so the newest action stays visible.
const MAX_PROJECTILES = 512;
// Deepest chain of forks a single shot may produce: 3 levels, so at most 8 endpoints.
const MAX_FORK_DEPTH = 3;
const MAX_EFFECTS = 512;
const MAX_DMG_NUMBERS = 256; // floating hit numbers alive at once
// XP economy: chance a kill drops an orb, and what each orb is worth relative to the
// enemy's xp value. Their product (0.25 x 2.5 = 0.625) is the net XP rate vs. one orb
// per kill at face value.
const XP_DROP_CHANCE = 0.25;
const XP_ORB_MULT = 2.5;

// Tomes (support gems) held at once, before any shop upgrades.
const SUPPORT_SLOTS_BASE = 2;
// Chests and silver keys are switched off while power is rebalanced around the level-up
// screen alone. The loot tiers in loot.js stay intact — flip this back to true to restore
// drops, the key counter and the opening sequence exactly as they were.
const CHESTS_ENABLED = false;

// ---------- Global difficulty curve ----------
// One exponential curve now governs the whole run, not just endless. It is measured in
// "position", a continuous number that runs 0..1..2..3 across the three stages and keeps
// counting through endless waves — so the difficulty ramp does not restart or jump at a
// stage boundary the way per-stage multipliers do.
//
// The curve is two exponential segments joined at CURVE_MID — the middle of stage 3 — so it
// can be pinned at two points instead of one:
//
//   position 0 .. CURVE_MID     1x            ->  CURVE_AT_MID   (the opening ramp)
//   position CURVE_MID onward   CURVE_AT_MID  ->  CURVE_TARGETS  over CURVE_SPAN positions
//
// Splitting it this way means the opening ramp can be raised WITHOUT inflating the late game:
// CURVE_TARGETS stays an absolute multiplier reached at position CURVE_MID + CURVE_SPAN, so
// endless sits where it did before rather than being multiplied up by the new early values.
//
// Speed is deliberately the gentlest: past roughly 2x, enemies outrun the player and the
// game stops being readable rather than getting harder.
const CURVE_MID = 2.5; // halfway through stage 3 (stage index 2, half elapsed)
const CURVE_SPAN = 10; // positions from CURVE_MID to the far targets
const CURVE_AT_MID = {
  hp: 2,          // by mid stage 3: double health
  damage: 1.5,    // ...half again the damage
  speed: 1.3,     // ...30% faster
  spawnRate: 3,   // ...and arriving 3x as fast
};
const CURVE_TARGETS = {
  hp: 14,       // 14x the health
  damage: 6,    // ...6x the damage
  speed: 1.8,   // ...80% faster
  spawnRate: 5, // ...and arriving 5x as fast
};

// How far through the current stage we are, by whichever gate will summon the boss first.
function stageFraction() {
  return clamp(Math.max(stageElapsed / BOSS_TIME, stageKills / KILL_THRESHOLD), 0, 1);
}

// Continuous difficulty position. Endless picks up exactly where stage 3 left off — wave 1
// starts at position 3.0, the same value the stage ends on, so there is no discontinuity.
function difficultyPosition() {
  const frac = stageFraction();
  if (beatFinalBoss) return STAGES.length + Math.max(0, endlessWave - 1) + frac;
  return currentStage + frac;
}

// A stage's enemy stat multipliers, defaulted — a stage only has to name what it changes.
const STAGE_STATS_DEFAULT = { hp: 1, damage: 1, speed: 1, spawnRate: 1 };
function stageEnemyStats(stage = STAGES[currentStage]) {
  return { ...STAGE_STATS_DEFAULT, ...(stage && stage.enemyStats) };
}

function curveScale(stat, pos = difficultyPosition()) {
  if (pos <= 0) return 1;
  const mid = CURVE_AT_MID[stat];
  // First half: climb from 1x to the mid-stage-3 value.
  if (pos < CURVE_MID) return Math.pow(mid, pos / CURVE_MID);
  // Beyond that: carry on from the mid value toward the far target, which stays absolute.
  return mid * Math.pow(CURVE_TARGETS[stat] / mid, (pos - CURVE_MID) / CURVE_SPAN);
}
// Stat nodes carry a BASE value that the rolled rarity scales, so a Unique "Vitality" is
// worth several times a Common one. `label` renders the rolled value for the card.
const STAT_NODES = [
  { id: 'vitality', name: 'Vitality', color: '#8a2e22', base: 30, round: 1,
    label: (v) => `+${v} Maximum Life`, apply(p, v) { p.maxHp += v; p.hp += v; } },
  { id: 'swiftfoot', name: 'Swift Foot', color: '#5c7a3d', base: 8, round: 1,
    label: (v) => `+${v}% Movement Speed`, apply(p, v) { p.speedMult += v / 100; } },
  { id: 'ironskin', name: 'Iron Skin', color: '#5a5a5e', base: 5, round: 1,
    label: (v) => `+${v} Armor`, apply(p, v) { p.armor += v; } },
  { id: 'recovery', name: 'Recovery', color: '#2f6e5c', base: 0.6, round: 0.1,
    label: (v) => `+${v} Life Regen / s`, apply(p, v) { p.hpRegen += v; } },
  { id: 'greed', name: "Grave Robber's Greed", color: '#a8842f', base: 25, round: 1,
    label: (v) => `+${v}% Pickup Radius`, apply(p, v) { p.pickupRadiusMult += v / 100; } },
  { id: 'might', name: 'Might', color: '#a8501f', base: 12, round: 1,
    label: (v) => `+${v}% Global Damage`, apply(p, v) { p.itemDamageMult += v / 100; } },
  { id: 'fortune', name: 'Fortune', color: '#c9a227', base: 8, round: 1,
    // Rarity applies to every roll in the game — chest loot AND level-up card tiers.
    label: (v) => `+${v}% Rarity (loot & upgrades)`, apply(p, v) { p.rarityMult *= 1 + v / 100; } },
];
// Rounds a rolled stat value to that node's granularity (whole numbers, or 0.1 for regen).
function roundStat(node, v) {
  const step = node.round || 1;
  return Math.max(step, Math.round(v / step) * step).toFixed(step < 1 ? 1 : 0) * 1;
}

let state = 'START';
let player, enemies, projectiles, effects, minions, pickups, dmgNumbers, toasts, bloodDecals, decorObjects;
// `elapsed` is the cumulative run clock shown in the HUD and recorded to the leaderboard —
// it never resets between stages. `stageElapsed` is a separate, hidden per-stage clock that
// drives pacing: the enemy-tier unlocks, the spawn-rate ramp, and the boss's 5-minute
// guaranteed-arrival contingency.
let elapsed, stageElapsed, kills, stageKills, nextId, spawnTimer, bossSpawned, boss, pendingLevelUps, rerollsLeft;
// Killing the final boss doesn't end the run — it flips into endless survival. `beatFinalBoss`
// is what marks the run as a victory on the leaderboard; `endlessWave` counts the boss cycles
// cleared after that point and drives the escalating difficulty.
let beatFinalBoss = false;
let endlessWave = 0;
// Silver keys held this run. Persist across stages; reset to 0 on new run / death / victory / quit.
let keyCount = 0;
// Gold gathered during the current run — forfeited (subtracted from meta) if the player dies.
// Gold earned since the last boss kill. Felling any boss BANKS everything earned so far
// (zeroing this), so dying only ever forfeits what you've gathered since that checkpoint.
// Once the final boss is down the forfeit stops entirely — endless gold is yours to keep.
let unbankedGold = 0;

// "Final boss" is always the boss of the last stage that exists, so adding stages later
// automatically moves the goalpost without touching any of the rules keyed off it.
function isFinalStage() { return currentStage >= STAGES.length - 1; }
let currentStage = 0;
let shakeAmount = 0;
let shakeOffset = { x: 0, y: 0 };
let settingsReturnState = 'START';
let lastInputDevice = 'keyboard';
let appliedInputMode = null;
// Mouse-aim: the player is always drawn at screen center, so the cursor's offset from
// center gives the world-space facing direction. `mouseAimActive` gates this until the
// mouse has actually moved so we don't snap to a stale (0,0) corner on load.
const mousePos = { x: 0, y: 0 };
let mouseAimActive = false;
window.addEventListener('mousemove', (e) => {
  mousePos.x = e.clientX; mousePos.y = e.clientY;
  mouseAimActive = true;
  lastInputDevice = 'keyboard';
});
const keys = new Set();

// True while focus is in a field the user is typing into. Menu navigation and movement keys
// must stand aside completely: arrows move the caret, Enter commits, digits are digits, and
// letters must not leak into the movement key set.
function isTypingTarget(el) {
  return !!el && el.tagName === 'INPUT' && (el.type === 'number' || el.type === 'text');
}

window.addEventListener('keydown', (e) => {
  if (isTypingTarget(document.activeElement)) {
    // Escape leaves the field rather than closing the menu behind it.
    if (e.key === 'Escape') { document.activeElement.blur(); e.preventDefault(); }
    return;
  }
  keys.add(e.key.toLowerCase());
  lastInputDevice = 'keyboard';
  const lower = e.key.toLowerCase();
  // Esc or P toggles pause during play.
  if (state === 'PLAYING' && (e.key === 'Escape' || lower === 'p')) { openPause(); e.preventDefault(); return; }
  if (state === 'PAUSED' && lower === 'p') { closePause(); e.preventDefault(); return; }
  // Arrow/Enter/Escape drive whatever menu overlay is open (no-op during play).
  if (keyboardMenuNav(e)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

let gp = null;
// Browsers freeze a gamepad's axis values while the window is unfocused and don't
// refresh them until the stick physically moves again — so releasing the stick while
// switched away leaves a stale non-zero reading that makes the character drift on
// return. When focus is lost we flag the stick to be ignored until it reports neutral
// once, proving the reading is live again.
let gpAxesStale = false;
window.addEventListener('blur', () => { gpAxesStale = true; });
document.addEventListener('visibilitychange', () => { if (document.hidden) gpAxesStale = true; });
// Debounce the controller pause toggle: some Start/Menu buttons send rapid double-edges
// (contact bounce), which would open then instantly re-close the pause menu. Ignore repeat
// toggles within this window so one physical press = one toggle.
let lastPauseToggle = 0;
const PAUSE_TOGGLE_COOLDOWN = 300;
let gpBadgeId = null;
let gpFocusOverlay = null;
let gpLastScrolledTo = null; // last element auto-scrolled to, so it only happens on change
let gpFocusRow = 0;
let gpFocusCol = 0;
// Overlays with a natural "cancel" action mapped to the gamepad B button.
// Class select and level-up have no back action (a choice there is mandatory).
const BACK_ACTIONS = {
  pauseMenu: () => closePause(),
  settingsMenu: () => closeSettings(),
  confirmDialog: () => closeConfirm(false), // B / Esc declines
  devMenu: () => closeDevTools(), // returns to whichever menu opened it
  leaderboardMenu: () => closeLeaderboard(),
  unlocksMenu: () => closeUnlocks(),
  shopMenu: () => closeShop(),
  classSelect: () => showMainMenu(),
  sandboxMenu: () => (sandboxLive ? closeSandboxLive() : closeSandbox()),
  endScreen: () => showMainMenu(), // B on the results screen returns to the main menu
};

// Debounced left-stick-as-d-pad for menu navigation: fires one step per push past the
// threshold, then re-arms once that axis returns near neutral. Reads raw axes (not gp.move,
// which has d-pad merged in) so a d-pad tap and a stick tilt can't double-fire a step.
const gpStickArmed = { x: true, y: true };
function stickAxisStep(value, axisKey) {
  if (Math.abs(value) < 0.3) { gpStickArmed[axisKey] = true; return 0; }
  if (!gpStickArmed[axisKey] || Math.abs(value) < 0.5) return 0;
  gpStickArmed[axisKey] = false;
  return value > 0 ? 1 : -1;
}

// Groups an overlay's buttons into visual rows (by vertical position) and sorts each row
// left-to-right, so d-pad up/down can move between rows and left/right/stick within a row —
// works for any layout (single row of cards, stacked settings rows) without per-overlay code.
function computeNavGrid(buttons) {
  const rows = [];
  for (const btn of buttons) {
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    // Group buttons whose tops are close into one row. The threshold is generous so a tall
    // button beside a short one (e.g. Play Again vs Main Menu) still counts as the same row —
    // otherwise the stick's up/down would oscillate between them and focus couldn't settle.
    let row = rows.find((row) => Math.abs(row.y - r.top) < 26);
    if (!row) { row = { y: r.top, items: [] }; rows.push(row); }
    row.items.push({ btn, x: cx });
  }
  rows.sort((a, b) => a.y - b.y);
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows;
}

function updateGamepadMenuNav() {
  const overlay = document.querySelector('.overlay:not(.hidden)');
  if (!overlay) { gpFocusOverlay = null; return; }
  if (!gp) return;
  if (gp.justPressed[1]) { const back = BACK_ACTIONS[overlay.id]; if (back) { back(); return; } }
  // Right stick smoothly scrolls the tallest scrollable region in this overlay.
  const rsY = gp.rawAxes[3] || 0;
  if (Math.abs(rsY) > 0.18) {
    // The overlay itself is a candidate: Dev Tools scrolls at that level rather than inside
    // its panel, so without this the right stick would find nothing to move there.
    const scroller = [overlay, overlay.querySelector('.overlayInner'),
      ...overlay.querySelectorAll('.unlocksBody, .sandboxBody, .leaderboardList, .settingsList')]
      .filter(Boolean).find((el) => el.scrollHeight > el.clientHeight + 1);
    if (scroller) scroller.scrollTop += rsY * 14;
  }
  const buttons = Array.from(overlay.querySelectorAll('button, .gpSlider'));
  if (!buttons.length) return;
  const grid = computeNavGrid(buttons);
  if (overlay !== gpFocusOverlay) { gpFocusOverlay = overlay; gpFocusRow = 0; gpFocusCol = 0; gpLastScrolledTo = null; }
  gpFocusRow = Math.min(gpFocusRow, grid.length - 1);
  gpFocusCol = Math.min(gpFocusCol, grid[gpFocusRow].items.length - 1);

  const stepX = stickAxisStep(gp.rawAxes[0] || 0, 'x');
  const stepY = stickAxisStep(gp.rawAxes[1] || 0, 'y');
  const navLeft = gp.justPressed[14] || gp.justPressed[4] || stepX < 0;
  const navRight = gp.justPressed[15] || gp.justPressed[5] || stepX > 0;
  const focusedEl = grid[gpFocusRow].items[gpFocusCol].btn;
  if (focusedEl.classList.contains('gpSlider')) {
    const range = focusedEl.querySelector('input[type="range"]');
    if (range && (navLeft || navRight)) {
      // Bumpers nudge a single step for fine control; d-pad/stick move a coarse chunk, so a
      // wide range (say travel speed, 20-1400) doesn't take a hundred presses to cross.
      const fine = gp.justPressed[4] || gp.justPressed[5];
      nudgeRange(range, navRight ? 1 : -1, fine);
    }
  } else {
    const items = grid[gpFocusRow].items;
    const cols = items.length;
    const dir = navRight ? 1 : navLeft ? -1 : 0;
    // The class strip turns instead of wrapping. Its row is [prev, ...cards, next], so
    // stepping off the last card used to land on the far arrow and then wrap to the other
    // end — which yanked the view back across the whole row. Now the carousel rotates by one
    // and the highlight stays put, so holding a direction keeps turning it indefinitely.
    const leavingStrip = dir !== 0
      && isClassCard(focusedEl)
      && !isClassCard((items[gpFocusCol + dir] || {}).btn);
    if (leavingStrip) {
      ui.rotateClassCarousel(dir);
    } else if (dir !== 0) {
      gpFocusCol = (gpFocusCol + dir + cols) % cols;
    }
  }
  if (gp.justPressed[12] || stepY < 0) moveNavRow(grid, -1);
  if (gp.justPressed[13] || stepY > 0) moveNavRow(grid, 1);

  buttons.forEach((b) => b.classList.remove('gpFocused'));
  const focused = grid[gpFocusRow].items[gpFocusCol].btn;
  focused.classList.add('gpFocused');
  // Only scroll when the focus actually moves. This runs every frame a pad is connected, so
  // scrolling unconditionally dragged the view back to the focused control the instant the
  // user scrolled anywhere with the mouse — the wheel appeared to be stuck.
  if (focused !== gpLastScrolledTo) {
    focused.scrollIntoView({ block: 'nearest' });
    gpLastScrolledTo = focused;
  }
  if (gp.justPressed[0] && !focused.classList.contains('gpSlider')) focused.click();
}

const isClassCard = (el) => !!el && el.classList && el.classList.contains('classCard');

// Steps a range input by its own granularity rather than a fixed amount — these sliders
// span everything from 0.05s cooldowns to 1400px travel speeds, so one hardcoded delta
// can't serve them all. Coarse is ~1/25th of the range, snapped to the input's step.
function nudgeRange(range, dir, fine) {
  const min = Number(range.min), max = Number(range.max);
  const step = Number(range.step) || 1;
  const coarse = Math.max(step, Math.round(((max - min) / 25) / step) * step);
  const next = Number(range.value) + dir * (fine ? step : coarse);
  // Snap to the step grid so values stay clean (0.35 rather than 0.3499999).
  const snapped = Math.round((clamp(next, min, max) - min) / step) * step + min;
  range.value = Number(snapped.toFixed(4));
  range.dispatchEvent(new Event('input', { bubbles: true }));
}

function moveNavRow(grid, dir) {
  const curX = grid[gpFocusRow].items[gpFocusCol].x;
  gpFocusRow = clamp(gpFocusRow + dir, 0, grid.length - 1);
  let bestI = 0, bestD = Infinity;
  grid[gpFocusRow].items.forEach((it, i) => { const d = Math.abs(it.x - curX); if (d < bestD) { bestD = d; bestI = i; } });
  gpFocusCol = bestI;
}

// Keyboard equivalent of the gamepad menu grid nav: arrows move focus (or nudge a
// focused slider), Enter/Space activates, Escape runs the overlay's back action.
// Shares the gpFocus* state so keyboard and controller stay in sync. Returns true
// if the key was consumed by a menu.
function keyboardMenuNav(e) {
  const overlay = document.querySelector('.overlay:not(.hidden)');
  if (!overlay) return false;
  if (e.key === 'Escape') { const back = BACK_ACTIONS[overlay.id]; if (back) { back(); return true; } return false; }
  const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '];
  if (!navKeys.includes(e.key)) return false;
  const buttons = Array.from(overlay.querySelectorAll('button, .gpSlider'));
  if (!buttons.length) return false;
  const grid = computeNavGrid(buttons);
  if (overlay !== gpFocusOverlay) { gpFocusOverlay = overlay; gpFocusRow = 0; gpFocusCol = 0; gpLastScrolledTo = null; }
  gpFocusRow = Math.min(gpFocusRow, grid.length - 1);
  gpFocusCol = Math.min(gpFocusCol, grid[gpFocusRow].items.length - 1);
  const focusedEl = grid[gpFocusRow].items[gpFocusCol].btn;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
if (focusedEl.classList.contains('gpSlider')) {
      const range = focusedEl.querySelector('input[type="range"]');
      // Shift makes arrow keys step finely, matching the bumpers on a controller.
      if (range) nudgeRange(range, e.key === 'ArrowRight' ? 1 : -1, e.shiftKey);
    } else {
      const items = grid[gpFocusRow].items;
      const cols = items.length;
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      // Same rule as the pad: stepping off the end of the class strip turns it rather than
      // wrapping focus to the opposite side of the row.
      if (isClassCard(focusedEl) && !isClassCard((items[gpFocusCol + dir] || {}).btn)) {
        ui.rotateClassCarousel(dir);
      } else {
        gpFocusCol = (gpFocusCol + dir + cols) % cols;
      }
    }
  } else if (e.key === 'ArrowUp') { moveNavRow(grid, -1); }
  else if (e.key === 'ArrowDown') { moveNavRow(grid, 1); }
  else if (e.key === 'Enter' || e.key === ' ') { if (!focusedEl.classList.contains('gpSlider')) focusedEl.click(); }
  buttons.forEach((b) => b.classList.remove('gpFocused'));
  const kFocused = grid[gpFocusRow].items[gpFocusCol].btn;
  kFocused.classList.add('gpFocused');
  kFocused.scrollIntoView({ block: 'nearest' });
  return true;
}

function xpForLevel(level) { return Math.round(9 + level * 6.5); }

function createPlayer(classDef) {
  const up = upgradeBonuses(); // permanent shop upgrades folded into the starting build
  return {
    x: 0, y: 0, radius: PLAYER_BASE_RADIUS * (PLAYER_SPRITE_HEIGHT / PLAYER_SPRITE_SOURCE_HEIGHT),
    baseSpeed: classDef.base.speed, speedMult: 1 + up.speedMult,
    maxHp: classDef.base.maxHp, hp: classDef.base.maxHp, hpRegen: classDef.base.hpRegen, armor: classDef.base.armor,
    critChance: classDef.base.critChance + up.critChance, critMult: classDef.base.critMult,
    pickupRadiusMult: 1, basePickupRadius: 75,
    itemDamageMult: 1, itemCooldownMult: 1, xpGainMult: 1 + up.xpMult,
    level: 1, xp: 0, xpToNext: xpForLevel(1),
    activeSkills: [{ id: classDef.startSkill, level: 1, cd: 0 }],
    skillCap: 4, // max active skill gems; Legendary chests raise this by +1 (stacking)
    rarityMult: 1, // magic-find: Rare chests' rarity-boost reward raises this (×1.05, stacking)
    // Tomes occupy a limited number of slots — 2 to start, up to 6 via the shop. The cap is
    // what forces a choice: without it every tome was eventually collected and they stacked
    // into the dominant source of power.
    supportCap: SUPPORT_SLOTS_BASE + up.supportSlots,
    supports: {},
    facing: { x: 1, y: 0 },
    classId: classDef.id, className: classDef.name, classColor: classDef.color,
  };
}

// `skill` layers that gem's own tiered-upgrade bonuses (damage, projectiles, elemental
// infusion) on top of the player's global mods, so each gem scales independently.
// computeMods allocates a fresh object and walks every support on each call, and the hot
// paths below run it once per minion and once per skill every frame. Cached for the duration
// of a frame; the result is only ever read, never mutated, so sharing it is safe.
let modsCacheFrame = -1;
const modsCache = new Map();
function computeModsCached(p, skill) {
  if (modsCacheFrame !== frameId) { modsCache.clear(); modsCacheFrame = frameId; }
  const key = skill || p;
  let m = modsCache.get(key);
  if (m === undefined) { m = computeMods(p, skill); modsCache.set(key, m); }
  return m;
}

function computeMods(p, skill) {
  const up = upgradeBonuses();
  const mods = {
    damageMult: p.itemDamageMult, cooldownMult: p.itemCooldownMult, areaMult: 1 + up.areaMult,
    projectileBonus: up.projectiles, pierceBonus: 0, chainBonus: 0, forkBonus: 0, critChance: 0, lifeLeech: 0,
    durationMult: 1, sizeMult: 1,
  };
  for (const [id, lvl] of Object.entries(p.supports)) SUPPORTS[id].apply(mods, lvl);
  if (skill) {
    const b = skill.bonus;
    if (b) {
      if (b.damageMult) mods.damageMult *= 1 + b.damageMult;
      if (b.areaMult) mods.areaMult *= 1 + b.areaMult;
      if (b.sizeMult) mods.sizeMult *= 1 + b.sizeMult;
      if (b.durationMult) mods.durationMult *= 1 + b.durationMult;
      if (b.cooldownMult) mods.cooldownMult *= Math.max(0.1, 1 - b.cooldownMult);
      if (b.projectileBonus) mods.projectileBonus += b.projectileBonus;
      if (b.pierceBonus) mods.pierceBonus += b.pierceBonus;
      if (b.chainBonus) mods.chainBonus += b.chainBonus;
      if (b.forkBonus) mods.forkBonus += b.forkBonus;
    }
    if (skill.infusion) mods.infusion = skill.infusion;
  }
  return mods;
}

function resetGame(classDef) {
  player = createPlayer(classDef);
  enemies = []; projectiles = []; effects = []; minions = []; pickups = []; dmgNumbers = []; toasts = []; bloodDecals = [];
  elapsed = 0; stageElapsed = 0; kills = 0; stageKills = 0; nextId = 1; spawnTimer = 0; bossSpawned = false; boss = null; pendingLevelUps = 0;
  beatFinalBoss = false; endlessWave = 0;
  // The dev max-skills toggle is per-run: a new run starts from the real loadout, and a
  // snapshot taken in the previous run must not be restorable into this one.
  maxSkillsOn = false; preMaxLoadout = null;
  sandboxMode = false; // startSandboxRun turns it back on after resetGame
  rerollsLeft = getUpgradeLevel('reroll'); // reroll allowance for this run, from the shop upgrade
  keyCount = 0; // fresh run starts with no keys
  unbankedGold = 0; // gold since the last boss checkpoint (forfeited on death)
  shakeAmount = 0; shakeOffset = { x: 0, y: 0 };
  currentStage = 0;
  floorPattern = makeFloorPattern(STAGES[currentStage]);
  scatterDecor(STAGES[currentStage]);
  playMusic('stage1');
  ui.showStageCard(STAGES[0].name, STAGES[0].flavor || '');
}

function advanceStage() {
  currentStage++;
  const stageDef = STAGES[currentStage];
  enemies = []; projectiles = []; effects = []; pickups = []; bloodDecals = [];
  // The run clock (`elapsed`) deliberately carries over — only the per-stage pacing resets.
  stageElapsed = 0; stageKills = 0; spawnTimer = 0; bossSpawned = false; boss = null;
  // Health carries over from the previous stage — no free heal on transition.
  floorPattern = makeFloorPattern(stageDef);
  scatterDecor(stageDef);
  playMusic('stage' + (currentStage + 1));
  ui.showStageCard(stageDef.name, stageDef.flavor || 'The horde regroups in a new land.');
}

function spawnBlood(x, y, scale = 1) {
  bloodDecals.push({ x, y, points: makeBlobPoints(14 * scale, 6, 0.55), rot: rand(0, Math.PI * 2) });
  if (bloodDecals.length > 150) bloodDecals.shift();
}

// Purely decorative background set-dressing — no collision, no gameplay effect.
// Scattered once per stage and drawn at reduced opacity so it stays behind the action.
function scatterDecor(stageDef) {
  decorObjects = [];
  const count = 24;
  const lim = ARENA_RADIUS - 120;
  for (let i = 0; i < count; i++) {
    decorObjects.push({
      x: rand(-lim, lim), y: rand(-lim, lim),
      type: pick(stageDef.decor), scale: rand(0.75, 1.35), rot: rand(0, Math.PI * 2),
    });
  }
}

// ---------- main menu / pause / settings / leaderboard ----------
function showMainMenu() {
  state = 'MAINMENU';
  document.getElementById('classSelect').classList.add('hidden');
  document.getElementById('hud').classList.add('hidden');
  ui.showMainMenu(getGold());
  playMusic('mainMenu');
}
function openPause() {
  state = 'PAUSED';
  // Sandbox-only entry point: a normal run has no scenario to edit.
  const sb = document.getElementById('pauseSandboxBtn');
  if (sb) sb.classList.toggle('hidden', !sandboxMode);
  refreshPauseStats();
  ui.showPauseMenu();
}

// Builds the pause-screen readouts: everything currently modifying the player, and everything
// currently modifying the horde. Values are shown relative to baseline so it's obvious at a
// glance what's been gained (green) or lost (red).
function refreshPauseStats() {
  if (!player) return;
  const m = computeMods(player);
  const pct = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
  const playerRows = [
    ['Max Life', Math.round(player.maxHp), player.maxHp > 100],
    ['Armor', player.armor, player.armor > 0],
    ['Move Speed', pct(player.speedMult - 1), player.speedMult > 1],
    ['Skill Damage', pct(m.damageMult - 1), m.damageMult > 1],
    ['Cooldown', pct(m.cooldownMult - 1), m.cooldownMult < 1],
    ['Area / Size', pct(m.areaMult - 1), m.areaMult > 1],
    ['Duration', pct(m.durationMult - 1), m.durationMult > 1],
    ['Projectiles', `+${m.projectileBonus}`, m.projectileBonus > 0],
    ['Pierce', `+${m.pierceBonus}`, m.pierceBonus > 0],
    ['Chain', `+${m.chainBonus}`, m.chainBonus > 0],
    ['Forks', `+${m.forkBonus}`, m.forkBonus > 0],
    ['Crit Chance', pct((player.critChance || 0) + (m.critChance || 0)), true],
    ['Crit Damage', `x${(player.critMult || 1).toFixed(2)}`, true],
    ['Life Leech', pct(m.lifeLeech || 0), (m.lifeLeech || 0) > 0],
    ['Pickup Radius', pct(player.pickupRadiusMult - 1), player.pickupRadiusMult > 1],
    ['Rarity', pct((player.rarityMult || 1) - 1), (player.rarityMult || 1) > 1],
    ['Skill Slots', `${player.activeSkills.length} / ${player.skillCap || 4}`, true],
  ];
  // Tomes, listed by name and level. They no longer appear on the HUD, so this is the only
  // place to see which ones are actually stacked — and unlike the aggregate rows above, it
  // shows *which* tomes produced those numbers. The slot count is shown even at zero: an
  // empty shelf is information now that it is capped.
  const owned = SUPPORT_ORDER.filter((id) => (player.supports[id] || 0) > 0);
  const cap = player.supportCap || SUPPORT_SLOTS_BASE;
  playerRows.push(['<b>Tomes</b>', `${owned.length} / ${cap} slots`, null]);
  if (owned.length) {
    for (const id of owned) {
      playerRows.push([
        `<span style="color:${SUPPORTS[id].color}">◆</span> ${SUPPORTS[id].name}`,
        `Lv ${player.supports[id]}`, true,
      ]);
    }
  }
  // Per-gem readout lives in its own panel so it can't crowd out the player stats above.
  // Each active gem gets a DPS line plus a line naming its tiered-upgrade bonuses.
  const skillBlocks = [];
  let totalDps = 0;
  for (const s of player.activeSkills) {
    const sm = computeMods(player, s);
    const { dps, targets, control } = estimateSkillDps(s, sm, player);
    totalDps += dps;
    const val = control
      ? '<span class="dpsCtl">control</span>'
      : `<b class="dpsVal">${Math.round(dps).toLocaleString()}</b> <span class="dpsUnit">dps</span>${targets > 1 ? ` <span class="dpsTgt">x${targets}</span>` : ''}`;

    const bits = [];
    const b = s.bonus || {};
    if (b.damageMult) bits.push(pct(b.damageMult));
    if (b.areaMult) bits.push(`${pct(b.areaMult)} area`);
    if (b.sizeMult) bits.push(`${pct(b.sizeMult)} size`);
    if (b.durationMult) bits.push(`${pct(b.durationMult)} dur`);
    if (b.cooldownMult) bits.push(`-${Math.round(b.cooldownMult * 100)}% cd`);
    if (b.projectileBonus) bits.push(`+${b.projectileBonus} proj`);
    if (b.pierceBonus) bits.push(`+${b.pierceBonus} pierce`);
    if (b.chainBonus) bits.push(`+${b.chainBonus} chain`);
    if (b.forkBonus) bits.push(`+${b.forkBonus} fork`);
    if (s.infusion) bits.push(`<span style="color:${INFUSIONS[s.infusion].color}">${INFUSIONS[s.infusion].name}</span>`);
    // Each gem is one self-contained block so its name/DPS line and its bonus line always
    // stay together, whatever column count the grid resolves to.
    skillBlocks.push(
      `<div class="skillBlock" style="border-left-color:${SKILLS[s.id].color}">` +
        `<div class="skillBlockTop"><span class="skillBlockName">${SKILLS[s.id].name}` +
        `<span class="skillBlockLv">Lv ${s.level}</span></span><span class="skillBlockDps">${val}</span></div>` +
        `<div class="skillBlockMods">${bits.length ? bits.join(' · ') : 'no upgrades yet'}</div>` +
      `</div>`
    );
  }

  const stage = STAGES[currentStage];
  const waveHp = curveScale('hp'), waveDmg = curveScale('damage'), waveSpd = curveScale('speed');
  const waveRate = curveScale('spawnRate');
  const enemyRows = [
    ['Stage', beatFinalBoss ? `Endless — Wave ${endlessWave}` : `${currentStage + 1} — ${stage.name}`, false],
    ['Stage Health', `x${stageEnemyStats().hp.toFixed(2)}`, false],
    ['Stage Damage', `x${stageEnemyStats().damage.toFixed(2)}`, false],
    ['Stage Speed', `x${stageEnemyStats().speed.toFixed(2)}`, false],
    ['Stage Spawn Rate', `x${stageEnemyStats().spawnRate.toFixed(2)}`, false],
    ['Ramp (this stage)', `x${difficultyMult(stageElapsed).toFixed(2)}`, false],
    ['Curve Position', `${difficultyPosition().toFixed(2)} / ${CURVE_MID} at mid stage 3`, false],
    ['Curve Health', `x${waveHp.toFixed(2)}`, false],
    ['Curve Damage', `x${waveDmg.toFixed(2)}`, false],
    ['Curve Speed', `x${waveSpd.toFixed(2)}`, false],
    ['Curve Spawn Rate', `x${waveRate.toFixed(2)}`, false],
    ['Live Enemies', `${enemies.length} / ${MAX_ENEMIES}`, false],
    ['Kills (stage)', `${stageKills} / ${KILL_THRESHOLD}`, false],
  ];
  const render = (id, rows) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = rows.map(([k, v, good]) =>
      `<div class="statLine"><span class="k">${k}</span><span class="v${good === true ? ' up' : good === false ? '' : ''}">${v}</span></div>`
    ).join('');
  };
  render('playerStats', playerRows);
  render('enemyStats', enemyRows);
  const skillEl = document.getElementById('skillStats');
  if (skillEl) {
    skillEl.innerHTML = skillBlocks.length
      ? skillBlocks.join('') +
        `<div class="skillTotal"><span>Combined</span>` +
        `<span><b class="dpsVal">${Math.round(totalDps).toLocaleString()}</b> <span class="dpsUnit">dps</span></span></div>`
      : '<div class="skillBlockMods">No active skills.</div>';
  }
}
function closePause() { ui.hidePauseMenu(); state = 'PLAYING'; }

function openLeaderboard() {
  state = 'LEADERBOARD';
  ui.hideMainMenu();
  ui.showLeaderboard(getEntries(), drawRunPortrait);
}
function closeLeaderboard() {
  ui.hideLeaderboard();
  state = 'MAINMENU';
  ui.showMainMenu(getGold());
}

function openUnlocks() {
  state = 'UNLOCKS';
  ui.hideMainMenu();
  ui.showUnlocks(
    SKILL_ORDER.map((id) => SKILLS[id]),
    SUPPORT_ORDER.map((id) => ({ id, ...SUPPORTS[id] })), // id carried through: it keys the tome icon
  );
}
function closeUnlocks() {
  ui.hideUnlocks();
  state = 'MAINMENU';
  ui.showMainMenu(getGold());
}

function refreshShop() {
  const rows = UPGRADES.map((def) => ({
    id: def.id, name: def.name, stat: def.stat,
    level: getUpgradeLevel(def.id), max: def.max,
    effect: def.pct ? `+${Math.round(def.perLevel * 100)}% ${def.stat}` : `+${def.perLevel} ${def.stat}`,
    cost: upgradeCost(def),
  }));
  ui.showShop(getGold(), rows, (id) => { if (buyUpgrade(id)) play('itemPickup'); else play('uiClick'); refreshShop(); });
}
function openShop() {
  state = 'SHOP';
  ui.hideMainMenu();
  refreshShop();
}
function closeShop() {
  ui.hideShop();
  state = 'MAINMENU';
  ui.showMainMenu(getGold());
}

// Dev cheat: every skill gem and tome at max level. A toggle, not a one-shot — switching it
// off restores the loadout the run actually had, so a maxed build can be compared against the
// real one without restarting. The snapshot is deep enough to survive levelling while it is on.
// True for a sandbox run: suppresses the wave spawner, the boss clock and stage advance.
let sandboxMode = false;
let maxSkillsOn = false;
let preMaxLoadout = null;

function devMaxSkills() {
  if (!player) { ui.showToast('Max Skills', 'Start a run first.', '#c94a3f'); return; }
  if (maxSkillsOn) {
    if (preMaxLoadout) {
      player.activeSkills = preMaxLoadout.skills.map((s) => ({ ...s }));
      player.supports = { ...preMaxLoadout.supports };
    }
    preMaxLoadout = null;
    maxSkillsOn = false;
    ui.showToast('Max Skills', 'Off — original loadout restored.', '#8a7d68');
    return;
  }
  preMaxLoadout = {
    skills: player.activeSkills.map((s) => ({ ...s })),
    supports: { ...player.supports },
  };
  for (const id of SKILL_ORDER) {
    const ex = player.activeSkills.find((s) => s.id === id);
    const lvl = devSkillMaxLevel(id);
    if (ex) ex.level = lvl;
    else player.activeSkills.push({ id, level: lvl, cd: 0 });
  }
  for (const id of SUPPORT_ORDER) player.supports[id] = 5; // tomes are uncapped in dev; 5 is a sane default
  maxSkillsOn = true;
  play('levelUp');
  ui.showToast('Max Skills', 'All gems granted at max level.', '#e6c14e');
}

// Ceiling for dev-granted skill levels. Skills nominally cap at maxLevel, but nothing stops
// a level climbing past it, and a "true maximum" is unbounded — enough stacked levels will
// take the game down. 5 is the designed top end, so dev grants stop there.
const DEV_MAX_SKILL_LEVEL = 5;

function devSkillMaxLevel(id) { return Math.min(DEV_MAX_SKILL_LEVEL, SKILLS[id].maxLevel); }

// Equips or unequips a skill at base level. Any number can be active at once — the normal
// skill cap is deliberately bypassed so combinations can be tested freely.
function devToggleSkill(id) {
  if (!player) { ui.showToast('Skills', 'Start a run first.', '#c94a3f'); return; }
  const i = player.activeSkills.findIndex((s) => s.id === id);
  if (i >= 0) {
    player.activeSkills.splice(i, 1);
    play('uiClick');
  } else {
    player.activeSkills.push({ id, level: 1, cd: 0 });
    play('levelUp');
  }
}

// MAX is a toggle between max level and base. Pressing it on an unequipped skill equips it
// straight at max, so it doubles as a one-click "give me this at full power".
function devToggleMaxSkill(id) {
  if (!player) { ui.showToast('Skills', 'Start a run first.', '#c94a3f'); return; }
  const max = devSkillMaxLevel(id);
  const s = player.activeSkills.find((x) => x.id === id);
  if (!s) {
    player.activeSkills.push({ id, level: max, cd: 0 });
    play('levelUp');
  } else if (s.level >= max) {
    s.level = 1;            // already maxed — drop back to base, staying equipped
    play('uiClick');
  } else {
    s.level = max;
    play('levelUp');
  }
}

// The Dev Tools screen. Cheats, the skill toggle grid, and a live-tuning box per skill.
// Only the stats a skill actually declares in its `tune` block get sliders, so nothing
// irrelevant appears for skills that don't use a given parameter.
// Saved skill tunings, kept separately from settings so a corrupt entry can be cleared
// without losing the player's audio/controller preferences.
const TUNE_STORE_KEY = 'duskfallSurvivors.skillTuning.v1';

function loadStoredTunes() {
  try {
    const raw = localStorage.getItem(TUNE_STORE_KEY);
    if (raw) applyStoredTunes(JSON.parse(raw));
  } catch { /* unreadable or malformed — fall back to shipped defaults */ }
}

function persistTune(id) {
  const saved = saveTune(id);
  if (!saved) return;
  let all = {};
  try { all = JSON.parse(localStorage.getItem(TUNE_STORE_KEY) || '{}'); } catch { all = {}; }
  all[id] = saved;
  try { localStorage.setItem(TUNE_STORE_KEY, JSON.stringify(all)); } catch { /* storage full/disabled */ }
}

function storedTunes() {
  try { return JSON.parse(localStorage.getItem(TUNE_STORE_KEY) || '{}'); } catch { return {}; }
}

function clearStoredTunes() {
  try { localStorage.removeItem(TUNE_STORE_KEY); } catch { /* nothing to clear */ }
}

loadStoredTunes(); // before any skill casts, so saved values are live from the first frame

// Restores a brand-new-player state for testing: no gold, no shop upgrades, no cheats, no
// keys, and any in-progress run abandoned.
//
// Deliberately preserved: the leaderboard (your run history) and saved skill tuning (your
// balance work). Neither is something a "fresh start" needs cleared, and both are real work
// that would be painful to lose to a stray click.
// Styled confirmation dialog. Replaces window.confirm, which can't be driven by a controller
// and looks nothing like the rest of the game. Yes = A / Enter, No = B / Esc.
let confirmAccept = null;
function askConfirm(message, onYes) {
  confirmAccept = onYes;
  ui.showConfirm(message);
}
function closeConfirm(accepted) {
  const fn = confirmAccept;
  confirmAccept = null;
  ui.hideConfirm();
  if (accepted && fn) fn();
}

function zeroItOut() {
  resetMeta();                       // gold + purchased upgrades
  setSetting('godMode', false);
  setSetting('infiniteRerolls', false);
  keyCount = 0;
  player = null;                     // drop any run in progress
  state = 'MAINMENU';
  ui.hidePauseMenu();
  ui.hideDevTools();
  showMainMenu();
  ui.showToast('Zeroed Out', 'Gold, upgrades, keys and cheats cleared. Leaderboard and skill tuning kept.', '#e6c14e');
}

function devSkillList() {
  return SKILL_ORDER.map((id) => {
    const def = SKILLS[id];
    const tune = def.tune || {};
    const stats = Object.keys(tune)
      .filter((k) => TUNE_META[k])
      .map((k) => ({ key: k, value: tune[k], ...TUNE_META[k] }));
    const owned = player && player.activeSkills.find((s) => s.id === id);
    return {
      id, name: def.name, color: def.color, icon: def.icon, stats,
      active: !!owned,
      maxed: !!owned && owned.level >= devSkillMaxLevel(id),
    };
  });
}

let devReturnState = 'PAUSED';

function openDevTools() {
  // Only capture the return state on a genuine open. Re-entering while already open — a
  // double click, or a mouse click and controller A landing in the same frame — would
  // otherwise record DEVTOOLS as the place to go back to, and closing would then restore a
  // state with no menu on screen at all: a black screen with no way out.
  if (state !== 'DEVTOOLS') devReturnState = state;
  state = 'DEVTOOLS';
  renderDevTools();
}

function renderDevTools() {
  // Run-only sections key off where we came from, not the current state.
  const inRun = devReturnState === 'PAUSED' && !!player;
  // Reachable from both the pause menu and the main menu — hide whichever we came from.
  ui.hidePauseMenu();
  ui.hideMainMenu();
  ui.showDevTools(
    { godMode: getSettings().godMode, infiniteRerolls: getSettings().infiniteRerolls, skillList: devSkillList(), inRun, maxSkills: maxSkillsOn },
    {
      onToggleGod: () => { setSetting('godMode', !getSettings().godMode); refreshDevTools(); },
      onToggleRerolls: () => { setSetting('infiniteRerolls', !getSettings().infiniteRerolls); refreshDevTools(); },
      onMaxSkills: () => { devMaxSkills(); refreshDevTools(); },
      onToggleSkill: (id) => { devToggleSkill(id); refreshDevTools(); },
      onMaxSkill: (id) => { devToggleMaxSkill(id); refreshDevTools(); },
      // Live edit: writing straight into the skill's tune block takes effect on the next cast.
      onTune: (id, key, value) => { if (SKILLS[id] && SKILLS[id].tune) SKILLS[id].tune[key] = value; },
      onGrantGold: (n) => {
        addGold(n); // HUD refreshes each frame; the menu re-reads gold when shown
        ui.showToast('Gold', `+${n.toLocaleString()} gold (${getGold().toLocaleString()} total).`, '#e6c14e');
        refreshDevTools();
      },
      onGrantKeys: (n) => {
        if (!player) { ui.showToast('Keys', 'Start a run first.', '#c94a3f'); return; }
        keyCount += n;
        ui.showToast('Keys', `+${n} silver key${n > 1 ? 's' : ''}.`, '#cdd3dd');
        refreshDevTools();
      },
      onZeroOut: () => askConfirm(
        'Are you sure you want to zero out all your progress?',
        zeroItOut,
      ),
      onResetSkill: (id) => { resetTune(id); refreshDevTools(); },
      onSaveSkill: (id) => {
        persistTune(id);
        ui.showToast('Saved', `${SKILLS[id].name} values are now its defaults.`, SKILLS[id].color);
      },
    },
  );
}
// Repaint in place — no state round-trip, so a refresh can't disturb the return state.
function refreshDevTools() { if (state === 'DEVTOOLS') renderDevTools(); }

function closeDevTools() {
  ui.hideDevTools();
  // Never restore to DEVTOOLS or anything unexpected; the main menu is always a safe landing.
  const back = (devReturnState === 'PAUSED' && player) ? 'PAUSED' : 'MAINMENU';
  state = back;
  if (back === 'PAUSED') ui.showPauseMenu();
  else showMainMenu();
}

function refreshSettingsMenu() {
  ui.showSettingsMenu(
    {
      inputPromptMode: getSettings().inputPromptMode, connectedPads: listConnectedPads(),
      activeGamepadId: getSettings().activeGamepadId,
      musicVolume: getSettings().musicVolume, sfxVolume: getSettings().sfxVolume,
      displayMode: getSettings().displayMode, musicUnlocked: getUpgradeLevel('musicPlayer') > 0, musicTracks: MUSIC_TRACK_LIST,
    },
    (mode) => { setSetting('inputPromptMode', mode); refreshSettingsMenu(); },
    (padId) => { setSetting('activeGamepadId', padId); refreshSettingsMenu(); },
    (v) => { setSetting('musicVolume', v); setMusicVolume(v); },
    (v) => { setSetting('sfxVolume', v); setSfxVolume(v); },
    {},
    {
      onSelectDisplayMode: (mode) => { setSetting('displayMode', mode); applyDisplayMode(); refreshSettingsMenu(); },
      onPlayTrack: (id) => { playMusic(id); },
    },
  );
}

// Push the saved display mode to the Electron shell (no-op in a plain browser).
function applyDisplayMode() {
  if (window.electronAPI && window.electronAPI.setDisplayMode) {
    window.electronAPI.setDisplayMode(getSettings().displayMode);
  }
}
function openSettings(returnState) {
  settingsReturnState = returnState;
  if (returnState === 'START') document.getElementById('classSelect').classList.add('hidden');
  else if (returnState === 'MAINMENU') ui.hideMainMenu();
  else ui.hidePauseMenu();
  state = 'SETTINGS';
  refreshSettingsMenu();
}
function closeSettings() {
  ui.hideSettingsMenu();
  if (settingsReturnState === 'START') { state = 'START'; document.getElementById('classSelect').classList.remove('hidden'); }
  else if (settingsReturnState === 'MAINMENU') { state = 'MAINMENU'; ui.showMainMenu(getGold()); }
  else { state = 'PAUSED'; ui.showPauseMenu(); }
}

function quitToMenu() {
  ui.hidePauseMenu();
  showMainMenu();
}

function quitGame() {
  if (window.electronAPI) window.electronAPI.quit();
  else window.close();
}

// ---------- world API passed into skill/AI code ----------
// ---------- enemy spatial grid ----------
// Every proximity query used to scan the whole roster. With the caps at 512 projectiles and
// 1024 enemies that is ~500k distance tests a frame, and forks/chains multiply the number of
// queries. A uniform grid rebuilt once per frame turns each query into a scan of just the
// cells the search radius touches.
const GRID_CELL = 128;
const grid = new Map();
let gridFrame = -1;
// Largest live enemy radius. A point query must widen by this much, or it could miss a big
// enemy whose centre sits outside the search radius while its body still overlaps it.
let gridMaxRadius = 48;

const cellKey = (cx, cy) => cx * 100000 + cy;

function rebuildGrid() {
  if (gridFrame === frameId) return; // once per frame, on first query
  gridFrame = frameId;
  grid.clear();
  gridMaxRadius = 0;
  for (const e of enemies) {
    if (e.dead) continue;
    if (e.radius > gridMaxRadius) gridMaxRadius = e.radius;
    const k = cellKey(Math.floor(e.x / GRID_CELL), Math.floor(e.y / GRID_CELL));
    const cell = grid.get(k);
    if (cell) cell.push(e); else grid.set(k, [e]);
  }
}

// Calls `fn` for every living enemy in the cells overlapping the search circle. Callers still
// do their own precise distance test — this only narrows the candidate set.
function forEachNear(x, y, range, fn) {
  rebuildGrid();
  const minX = Math.floor((x - range) / GRID_CELL), maxX = Math.floor((x + range) / GRID_CELL);
  const minY = Math.floor((y - range) / GRID_CELL), maxY = Math.floor((y + range) / GRID_CELL);
  for (let cx = minX; cx <= maxX; cx++) {
    for (let cy = minY; cy <= maxY; cy++) {
      const cell = grid.get(cellKey(cx, cy));
      if (!cell) continue;
      for (const e of cell) if (!e.dead) fn(e);
    }
  }
}

function findNearest(x, y, range = Infinity, exclude = null) {
  let best = null, bestD = range * range;
  // An unbounded search can't be gridded, and it's rare (only a few skills use Infinity).
  if (!Number.isFinite(range)) {
    for (const e of enemies) {
      if (e.dead || (exclude && exclude.has(e.id))) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d <= bestD) { bestD = d; best = e; }
    }
    return best;
  }
  forEachNear(x, y, range, (e) => {
    if (exclude && exclude.has(e.id)) return;
    const d = dist2(x, y, e.x, e.y);
    if (d <= bestD) { bestD = d; best = e; }
  });
  return best;
}
// The `count` nearest living enemies within `range`, nearest first. Keeps a small sorted
// buffer rather than sorting the whole roster — the caller runs this every frame.
const _nearestBuf = [];
function nearestN(x, y, range, count) {
  const r2 = range * range;
  _nearestBuf.length = 0;
  forEachNear(x, y, range, (e) => {
    const d2 = dist2(x, y, e.x, e.y);
    if (d2 > r2) return;
    if (_nearestBuf.length < count) {
      _nearestBuf.push({ e, d2 });
      for (let i = _nearestBuf.length - 1; i > 0 && _nearestBuf[i].d2 < _nearestBuf[i - 1].d2; i--) {
        const t = _nearestBuf[i]; _nearestBuf[i] = _nearestBuf[i - 1]; _nearestBuf[i - 1] = t;
      }
    } else if (d2 < _nearestBuf[count - 1].d2) {
      _nearestBuf[count - 1] = { e, d2 };
      for (let i = count - 1; i > 0 && _nearestBuf[i].d2 < _nearestBuf[i - 1].d2; i--) {
        const t = _nearestBuf[i]; _nearestBuf[i] = _nearestBuf[i - 1]; _nearestBuf[i - 1] = t;
      }
    }
  });
  return _nearestBuf.map((x2) => x2.e);
}

function enemiesInRange(x, y, range) {
  const r2 = range * range;
  const out = [];
  forEachNear(x, y, range, (e) => { if (dist2(x, y, e.x, e.y) <= r2) out.push(e); });
  return out;
}
function countMinions(type) { return minions.filter((m) => !m.dead && m.type === type).length; }

// Damage numbers were the one unbounded pool. A wide multi-hit skill can generate thousands
// per second — Solar Ray at +18 projectiles sweeping a packed crowd is ~19 beams x every
// enemy they cross, several times a second — and at 0.7s of life they all overlap into an
// unreadable smear that costs more to draw than the fight itself. Capped like projectiles and
// effects; at the ceiling the OLDEST is dropped so the freshest hits are the ones shown.
function spawnDamageNumber(x, y, amount, isCrit, color) {
  if (dmgNumbers.length >= MAX_DMG_NUMBERS) dmgNumbers.shift();
  dmgNumbers.push({ x: x + rand(-6, 6), y, text: String(amount), isCrit, color: color || (isCrit ? '#c9a227' : '#c9bfa8'), t: 0, life: 0.7 });
}

function damageEnemy(enemy, baseDamage, mods, opts = {}) {
  if (enemy.dead) return;
  // Sandbox punching bags: still show numbers and take knockback, just never die — so a
  // damage test runs against a constant target count instead of thinning as it goes.
  if (enemy.invulnerable) {
    spawnDamageNumber(enemy.x, enemy.y - enemy.radius, Math.round(baseDamage), false);
    return;
  }
  let dmg = baseDamage;
  const totalCrit = clamp((player.critChance || 0) + (mods.critChance || 0), 0, 0.75);
  let isCrit = false;
  if (Math.random() < totalCrit) { dmg *= player.critMult; isCrit = true; }
  enemy.hp -= dmg;
  spawnDamageNumber(enemy.x, enemy.y - enemy.radius, Math.round(dmg), isCrit);
  if (mods.lifeLeech) player.hp = Math.min(player.maxHp, player.hp + dmg * mods.lifeLeech);
  if (opts.knockback && !enemy.isBoss) {
    const n = normalize(enemy.x - player.x, enemy.y - player.y);
    enemy.x += n.x * opts.knockback * 0.2; enemy.y += n.y * opts.knockback * 0.2;
  }
  if (mods && mods.infusion && !enemy.dead) applyInfusion(enemy, mods.infusion, dmg, mods);
  if (enemy.hp <= 0 && !enemy.dead) killEnemy(enemy);
}

// Elemental infusion granted by a Legendary/Unique gem upgrade. Rides along on every hit the
// infused skill lands, scaling off that hit's damage so strong skills infuse harder.
function applyInfusion(e, kind, dmg, mods) {
  // Strip the infusion before re-entering damageEnemy so a shock arc can't chain infinitely.
  const plain = { ...mods, infusion: null };
  // Every infused hit marks its landing spot with that element's own burst, so effect-based
  // skills (Flamethrower, Solar Ray, Ninja Stars) read as infused too, not just projectiles.
  // Throttled per enemy: tick-based skills land ~10 hits/sec on every foe in range, which
  // would spawn effects far faster than they expire. The damage is unaffected — only the
  // visual is rate-limited, and at 8/sec it still reads as continuous.
  const nowMs = performance.now();
  if (!e.infusionVfxAt || nowMs - e.infusionVfxAt > 125) {
    e.infusionVfxAt = nowMs;
    spawnEffect({ kind: 'infusionHit', infusion: kind, x: e.x, y: e.y, radius: e.radius || 12,
      seed: Math.random() * 10, duration: 0.34 });
  }
  if (kind === 'frost') applySlow(e, 0.55, 1400);
  else if (kind === 'burning') applyBurn(e, dmg * 0.35, 3, plain);
  else if (kind === 'poison') applyPoison(e, dmg * 0.3, 6, plain);
  else if (kind === 'shock') {
    const near = findNearest(e.x, e.y, 225, new Set([e.id])); // x1.5 with the AoE pass
    if (near) {
      damageEnemy(near, dmg * 0.4, plain, {});
      spawnEffect({ kind: 'shockArc', x: e.x, y: e.y, tx: near.x, ty: near.y, duration: 0.16 });
    }
  }
}

// Burn status: a light damage-over-time that lingers on the enemy after it leaves the flame.
// Applying it refreshes the duration and keeps the stronger damage.
function applyBurn(e, dps, durationSec, mods) {
  const until = performance.now() + durationSec * 1000;
  if (!e.burnUntil || until > e.burnUntil) e.burnUntil = until;
  e.burnDps = Math.max(e.burnDps || 0, dps);
  e.burnMods = mods || {};
  if (e.burnTickTimer === undefined) e.burnTickTimer = 0.5;
}

// Poison status: like burn, but weaker per tick and far longer-lasting (6s base). Unlike burn
// it STACKS — each application adds a stack (up to POISON_MAX_STACKS) and refreshes the timer,
// so sustained exposure ramps the damage up.
const POISON_MAX_STACKS = 8;
function applyPoison(e, dps, durationSec, mods) {
  const now = performance.now();
  const active = e.poisonUntil && e.poisonUntil > now;
  e.poisonStacks = active ? Math.min(POISON_MAX_STACKS, (e.poisonStacks || 0) + 1) : 1;
  e.poisonUntil = now + durationSec * 1000; // re-applying always refreshes the full duration
  e.poisonDps = Math.max(active ? (e.poisonDps || 0) : 0, dps);
  e.poisonDuration = durationSec; // remembered so a death-spread carries the same duration
  e.poisonMods = mods || {};
  if (e.poisonTickTimer === undefined) e.poisonTickTimer = 0.5;
}

// When a poisoned enemy dies the plague jumps to the nearest foe in a small radius, carrying
// its damage and a FULL fresh duration. Un-poisoned foes are preferred so the plague keeps
// finding new hosts, but an already-poisoned one is a valid fallback — re-applying restarts
// its timer (and adds a stack), which is what keeps a chain reaction rolling through a pack
// that's already drenched instead of dying out for lack of a clean target.
const POISON_SPREAD_RADIUS = 165; // x1.5 with the AoE pass
function spreadPoisonFrom(src) {
  const now = performance.now();
  let fresh = null, freshD = POISON_SPREAD_RADIUS;
  let any = null, anyD = POISON_SPREAD_RADIUS;
  for (const e of enemies) {
    if (e.dead || e === src) continue;
    const d = dist(src.x, src.y, e.x, e.y);
    if (d >= POISON_SPREAD_RADIUS) continue;
    if (d < anyD) { anyD = d; any = e; }
    const poisoned = e.poisonUntil && e.poisonUntil > now;
    if (!poisoned && d < freshD) { freshD = d; fresh = e; }
  }
  const target = fresh || any;
  if (!target) return;
  applyPoison(target, src.poisonDps || 1, src.poisonDuration || 6, src.poisonMods);
  spawnEffect({ kind: 'poisonBurst', x: src.x, y: src.y, radius: POISON_SPREAD_RADIUS * 0.5, duration: 0.4 });
}

function tickPoison(e, dt) {
  if (!e.poisonUntil || e.poisonUntil <= performance.now()) { e.poisonStacks = 0; return; }
  e.poisonTickTimer = (e.poisonTickTimer === undefined ? 0.5 : e.poisonTickTimer) - dt;
  if (e.poisonTickTimer <= 0) {
    damageEnemy(e, e.poisonDps * (e.poisonStacks || 1) * 0.5, e.poisonMods || {}, {}); // 0.5s of stacked DoT
    e.poisonTickTimer = 0.5;
  }
}

// Apply/refresh a slow, always keeping the stronger (lower) factor while active.
function applySlow(e, factor, durMs) {
  const now = performance.now();
  const active = e.slowUntil && e.slowUntil > now;
  e.slowFactor = active ? Math.min(e.slowFactor, factor) : factor;
  e.slowUntil = Math.max(active ? e.slowUntil : now, now + durMs);
}

// Ice Shards on-hit: slow the foe and stack freeze buildup (no HP damage). At 100 buildup the
// enemy freezes solid; bosses accumulate nothing and only take the slow.
function applyIceHit(e, p) {
  applySlow(e, p.slowFactor, p.slowDuration);
  if (e.isBoss) return;                                  // bosses can be slowed, never frozen
  if (e.frozenUntil && e.frozenUntil > performance.now()) return; // already frozen: no buildup
  e.freezeBuildup = (e.freezeBuildup || 0) + p.freezeAmount;
  if (e.freezeBuildup >= 100) {
    e.freezeBuildup = 0;
    e.frozenUntil = performance.now() + p.freezeDurationMs;
  }
}

function tickBurn(e, dt) {
  if (!e.burnUntil || e.burnUntil <= performance.now()) return;
  e.burnTickTimer = (e.burnTickTimer === undefined ? 0.5 : e.burnTickTimer) - dt;
  if (e.burnTickTimer <= 0) {
    damageEnemy(e, e.burnDps * 0.5, e.burnMods || {}, {}); // 0.5s worth of the per-second burn
    e.burnTickTimer = 0.5;
  }
}

function killEnemy(enemy) {
  enemy.dead = true;
  // A poisoned corpse bursts, infecting the nearest healthy foe close by.
  if (enemy.poisonUntil && enemy.poisonUntil > performance.now()) spreadPoisonFrom(enemy);
  if (enemy.frozenUntil && enemy.frozenUntil > performance.now()) spawnIceShatter(enemy.x, enemy.y, enemy.radius);
  spawnBlood(enemy.x, enemy.y, enemy.radius / 15);
  if (enemy.isBoss) {
    kills++;
    play('bossDie');
    // Bosses drop a locked chest (guaranteed Epic tier or better), plus a key to open it.
    if (CHESTS_ENABLED) pickups.push({ id: nextId++, kind: 'chest', x: enemy.x, y: enemy.y, radius: 32, reward: rollChestReward('epic', player.rarityMult), dead: false });
    pickups.push({ id: nextId++, kind: 'key', x: enemy.x + rand(-30, 30), y: enemy.y + rand(-30, 30), radius: 8, dead: false });
    // Bosses drop a hoard of gold, scattered so it reads as a reward burst. It's flagged
    // `banked` so the kill's own reward counts as part of this checkpoint — picking it up
    // never puts it back at risk, even though it lands after the bank below.
    for (let i = 0; i < 8; i++) {
      pickups.push({ id: nextId++, kind: 'gold', gold: 5, banked: true, x: enemy.x + rand(-40, 40), y: enemy.y + rand(-40, 40), radius: 6, dead: false });
    }
    unbankedGold = 0; // felling ANY boss banks the gold earned up to this point
    if (!isFinalStage()) advanceStage();
    else onBossDefeated();
    return;
  }
  kills++;
  stageKills++;
  play('enemyDie');
  // Sandbox drops nothing: XP would level the player mid-test and silently change the very
  // build being measured, and banked gold from a contrived scenario should not reach the shop.
  if (sandboxMode) return;
  // Not every kill drops an orb any more. One in four does, each worth 2.5x — so the field is
  // far less littered (which was most of the visual noise AND the pickup cost at high kill
  // rates), while total XP lands at ~62% of what it was. The two knobs are independent: change
  // DROP_CHANCE for clutter, ORB_MULT for how fast levels come.
  if (Math.random() < XP_DROP_CHANCE) {
    pickups.push({
      id: nextId++, kind: 'xp', x: enemy.x + rand(-8, 8), y: enemy.y + rand(-8, 8),
      xp: Math.max(1, Math.round(enemy.xp * XP_ORB_MULT)), radius: 7, dead: false,
    });
  }
  // Gold pays out at 20% of its former rate. The fractional part resolves by chance so
  // low-xp enemies average out correctly rather than being floored up to a full coin.
  const goldValue = enemy.xp * 0.12;
  const goldAmt = Math.floor(goldValue) + (Math.random() < goldValue % 1 ? 1 : 0);
  // 0.5 gate halves how often gold drops; the potion roll lives inside, so its rate halves too.
  if (goldAmt > 0 && Math.random() < 0.5) {
    pickups.push({ id: nextId++, kind: 'gold', gold: goldAmt, x: enemy.x + rand(-8, 8), y: enemy.y + rand(-8, 8), radius: 5, dead: false });
    // Rare red health potion — 1/3 of the gold rate, then 60% rarer still.
    if (Math.random() < (1 / 3) * 0.4) {
      pickups.push({ id: nextId++, kind: 'health', heal: 0.3, x: enemy.x + rand(-10, 10), y: enemy.y + rand(-10, 10), radius: 7, dead: false });
    }
  }
  // Locked treasure chests replace the old direct item drops, at half the old rate (0.08 -> 0.04).
  // The reward inside is rolled now and revealed when a key opens it.
  if (CHESTS_ENABLED && Math.random() < 0.012) {
    pickups.push({ id: nextId++, kind: 'chest', x: enemy.x, y: enemy.y, radius: 30, reward: rollChestReward(null, player.rarityMult), dead: false });
  }
  // Silver keys drop rarely to open those chests.
  if (CHESTS_ENABLED && Math.random() < 0.00968) {
    pickups.push({ id: nextId++, kind: 'key', x: enemy.x + rand(-10, 10), y: enemy.y + rand(-10, 10), radius: 10, dead: false });
  }
  if (enemy.splits) {
    const base = ENEMY_TYPES[enemy.spriteId];
    for (let i = 0; i < 2; i++) {
      enemies.push({
        ...base, id: nextId++, spriteId: enemy.spriteId, x: enemy.x + rand(-14, 14), y: enemy.y + rand(-14, 14),
        radius: base.radius * 0.6, hp: base.hp * 0.4, maxHp: base.hp * 0.4, splits: false, dead: false, hitCd: 0,
      });
    }
  }
}

const world = { findNearest, enemiesInRange, countMinions, damageEnemy, spawnProjectile, spawnEffect, spawnMinion, playSfx: play };
// Removes entries failing `keep`, preserving order, without allocating a new array.
function compact(arr, keep) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[w++] = arr[i];
  arr.length = w;
}

function spawnProjectile(opts) {
  const p = { id: nextId++, hitSet: new Set(), dead: false, forks: 0, childChain: 0,
    mods: { damageMult: 1, lifeLeech: 0, critChance: 0 }, ...opts };
  // Forks branch geometrically — each level doubles the projectile count, so an uncapped
  // Forking stack reaches thousands. Capped centrally so every skill and every forked child
  // inherits the limit without each needing to remember it.
  p.forks = Math.min(p.forks || 0, MAX_FORK_DEPTH);
  projectiles.push(p);
}
function spawnEffect(opts) { effects.push({ id: nextId++, t: 0, dead: false, ...opts }); }

// Chest-opening celebration: a fountain of gold coins sprays upward while a radiant light
// spins around the opened chest, then the whole thing fades out.
function spawnChestBurst(x, y) {
  const coins = [];
  for (let i = 0; i < 20; i++) {
    const a = -Math.PI / 2 + rand(-1.0, 1.0); // mostly upward, fanned out
    const sp = rand(110, 260);
    coins.push({
      x: rand(-4, 4), y: rand(-8, -2),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(30, 110),
      rot: rand(0, Math.PI * 2), spin: rand(-11, 11),
      r: rand(2.4, 4), life: rand(0.6, 0.95),
    });
  }
  spawnEffect({ kind: 'chestBurst', x, y, duration: 0.95, coins });
}

// Frozen enemy killed: burst the ice casing into a spray of tiny (harmless) crystal shards.
function spawnIceShatter(x, y, r) {
  const shards = [];
  const n = 10 + Math.floor(Math.random() * 7);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = rand(40, 170);
    shards.push({
      x: rand(-r * 0.5, r * 0.5), y: rand(-r * 0.5, r * 0.5),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(10, 60),
      rot: rand(0, Math.PI * 2), spin: rand(-12, 12),
      sz: 1.4 + Math.random() * 2.4, life: rand(0.35, 0.7),
    });
  }
  spawnEffect({ kind: 'iceShatter', x, y, duration: 0.72, shards });
}

// A Flame Walk patch slowly widens over its lifetime, up to +100% of its (already bonus-boosted)
// base radius. Used for both its damage reach and its visual.
// Each blade drags a tail of after-images: sampling the ring's path at earlier times places
// them exactly where the blade *was*, so the tail curves correctly along the orbit and the
// pulse. Every echo is a live hitbox in its own right.
const NINJA_ECHO_COUNT = 3;
const NINJA_ECHO_STEP = 0.07; // seconds of lag between a blade and its next echo

// World positions of a ninjastars ring at time `at` (defaults to now). The pulse eases out to
// maxRadius and back to innerRadius once per pulsePeriod (cosine, so it lingers at both ends).
function ninjaStarPositions(fx, at) {
  const t = Math.max(0, at === undefined ? fx.t : at);
  const phase = (t % fx.pulsePeriod) / fx.pulsePeriod;
  const pulse = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2); // 0 -> 1 -> 0
  const r = fx.innerRadius + (fx.maxRadius - fx.innerRadius) * pulse;
  const out = [];
  for (let i = 0; i < fx.count; i++) {
    const a = t * fx.spin + (i / fx.count) * Math.PI * 2;
    out.push({ x: fx.x + Math.cos(a) * r, y: fx.y + Math.sin(a) * r, a });
  }
  return out;
}

function burningGroundRadius(fx) {
  return fx.radius * (1 + 1 * clamp(fx.t / fx.duration, 0, 1));
}
function spawnMinion(opts) { minions.push({ id: nextId++, hp: 0, dead: false, atkTimer: 0, ...opts }); }

// A fiery blast with flash, shockwave, flung embers and a screen kick — used when a
// fireball detonates on impact.
function spawnExplosion(x, y, radius) {
  spawnEffect({ kind: 'explosion', x, y, radius: radius * 1.15, duration: 0.42, seed: Math.random() * Math.PI * 2 });
  // Each blast adds a small kick, but explosion-driven shake caps at 3 blasts' worth so
  // a barrage of fireballs can't stack it into a violent quake. Never lowers shake that
  // a bigger source (e.g. taking damage) has already applied.
  const boom = 2;
  shakeAmount = Math.max(shakeAmount, Math.min(shakeAmount + boom, boom * 3));
  play('fireballHit');
}

// ---------- gameplay update ----------
function applyDamageToPlayer(raw) {
  // Two independent switches: the dev-tools cheat, and the sandbox's own per-scenario flag.
  // Kept separate so enabling it for a measurement cannot survive into a real run.
  if (getSettings().godMode || player.godMode) return;
  const reduced = Math.max(1, Math.round(raw - player.armor * 0.6));
  player.hp -= reduced;
  spawnDamageNumber(player.x, player.y - player.radius, reduced, false, '#c94a3f');
  shakeAmount = Math.min(16, shakeAmount + reduced * 0.5);
  if (player.hp <= 0) { player.hp = 0; triggerGameOver(); }
}

// Enemies close to a standoff ring rather than to the target's exact centre. Without it a
// crowd converges on one point and stacks into a single unreadable pile sitting on top of the
// player. The ring sits INSIDE the contact range (see MELEE_STANDOFF), so they still touch the
// hitbox and still deal contact damage — they just stop short of occupying the same pixel.
const MELEE_STANDOFF = 0.7; // fraction of the target's radius they will not push past

function moveToward(e, target, speed, dt) {
  const dx = target.x - e.x, dy = target.y - e.y;
  const n = normalize(dx, dy);
  // Facing is set from the direction to the target even when holding position, so a stopped
  // enemy still looks at the player rather than freezing mid-turn.
  if (Math.abs(n.x) > 0.05) e.facingLeft = n.x < 0;
  e.dirX = n.x; e.dirY = n.y; // kept for picking the side/front/back sprite view
  const stop = e.radius + (target.radius || 0) * MELEE_STANDOFF;
  const d = Math.hypot(dx, dy);
  if (d <= stop) return; // already at the ring: hold, don't burrow into the target
  // Never overshoot the ring in a single step, or a fast enemy would jitter across it.
  const stepLen = Math.min(speed * dt, d - stop);
  e.x += n.x * stepLen; e.y += n.y * stepLen;
}

// How hard bodies push out of each other, and how far apart they aim to sit as a fraction of
// their combined radii. Under 1 so they still touch and overlap slightly — a crowd should look
// packed, just not stacked on one pixel.
const SEPARATION_STRENGTH = 26;
const SEPARATION_SPACING = 0.85;

// A crowd chasing one target crosses the side/front/back threshold on the same frame, so every
// sprite flips at once and the flip sweeps through the pack as a visible ripple. Each enemy
// therefore holds a pending turn for its own small delay before committing. The delay is
// derived from the enemy's id rather than re-rolled, so a given body turns consistently and
// the spread across the crowd is stable instead of shimmering.
// Window: 0.175s to 0.35s — the whole range doubled, keeping the same 2:1 shape so the crowd
// stays evenly spread rather than clustering at one end. The floor is the part that breaks up
// the synchronised front edge; the ceiling is how long a body may keep its old facing while
// already walking the new one, which at 0.35s is deliberately loose and unhurried.
const TURN_LAG_MIN = 0.175;
const TURN_LAG_SPAN = 0.175;

function updateFacing(e, dt) {
  const want = facingDir(e.dirX || 0, e.dirY || 0);
  if (e.viewDir === undefined) { e.viewDir = want; return; } // first frame: no lag to hide
  if (want === e.viewDir) { e.turnPending = null; return; }  // drifted back: cancel the turn
  if (e.turnPending !== want) {
    e.turnPending = want;
    // Deterministic per body, spread across the window.
    e.turnTimer = TURN_LAG_MIN + ((e.id * 0.6180339887) % 1) * TURN_LAG_SPAN;
  }
  e.turnTimer -= dt;
  if (e.turnTimer <= 0) { e.viewDir = want; e.turnPending = null; }
}

function separateFrom(e, dt) {
  const reach = e.radius * 2 * SEPARATION_SPACING;
  let px = 0, py = 0, n = 0;
  forEachNear(e.x, e.y, reach, (o) => {
    if (o === e || n >= 6) return; // cap the neighbours considered: cost, and 6 is plenty to unstack
    const want = (e.radius + o.radius) * SEPARATION_SPACING;
    const dx = e.x - o.x, dy = e.y - o.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= want * want) return;
    const d = Math.sqrt(d2) || 0.01;
    // Two bodies at the exact same point have no direction to separate along; give them one.
    const ux = d2 < 0.001 ? Math.cos(e.id) : dx / d;
    const uy = d2 < 0.001 ? Math.sin(e.id) : dy / d;
    const overlap = (want - d) / want; // 0 at the edge, 1 dead centre
    px += ux * overlap; py += uy * overlap; n++;
  });
  if (!n) return;
  e.x += (px / n) * SEPARATION_STRENGTH * dt;
  e.y += (py / n) * SEPARATION_STRENGTH * dt;
}

function updateEnemy(e, dt) {
  if (e.dead) return;
  tickBurn(e, dt);
  if (e.dead) return;
  tickPoison(e, dt);
  if (e.dead) return;
  if (e.frozenUntil && e.frozenUntil > performance.now()) return; // frozen solid: no move / no attack
  if (e.isBoss) { updateBoss(e, dt); return; }
  updateFacing(e, dt);

  // Crowd separation: nudge apart from whoever is overlapping. Without it a horde converging
  // on one target collapses into a single stack — the same problem the player standoff solved,
  // but between enemies. Deliberately gentle and capped: it is a readability nudge, not a
  // physics solve, and it must not fight the pathing or cost much at 200+ bodies.
  separateFrom(e, dt);

  // Sandbox "ignores you" enemies stand where they were placed: still damageable, still
  // rendered and animated, but no pathing — so a formation stays a formation.
  if (e.sandboxPassive) return;
  const slowed = e.slowUntil && e.slowUntil > performance.now();
  const speed = e.speed * (slowed ? e.slowFactor : 1);
  let target = player, td = dist(e.x, e.y, player.x, player.y);
  for (const m of minions) {
    if (m.dead) continue;
    const d = dist(e.x, e.y, m.x, m.y);
    if (d < td) { td = d; target = m; }
  }
  if (e.ranged) {
    e.shootTimer = (e.shootTimer || 0) - dt;
    const pd = dist(e.x, e.y, player.x, player.y);
    if (pd <= e.range) {
      if (e.shootTimer <= 0) {
        const n = normalize(player.x - e.x, player.y - e.y);
        spawnProjectile({
          x: e.x, y: e.y, vx: n.x * e.projSpeed, vy: n.y * e.projSpeed, radius: e.projRadius || 5, life: 3,
          color: e.projColor || '#a89e83', damage: e.damage, enemyOwned: true, isArrow: e.projStyle !== 'orb',
        });
        e.shootTimer = e.shootCd;
      }
      if (pd > e.range * 0.6) moveToward(e, target, speed * 0.6, dt);
    } else moveToward(e, target, speed, dt);
  } else {
    moveToward(e, target, speed, dt);
  }
  e.hitCd = (e.hitCd || 0) - dt;
  if (e.hitCd <= 0 && dist(e.x, e.y, target.x, target.y) <= e.radius + target.radius) {
    if (target === player) applyDamageToPlayer(e.damage);
    else { target.hp -= e.damage; spawnDamageNumber(target.x, target.y, e.damage, false, '#c9756f'); if (target.hp <= 0) target.dead = true; }
    e.hitCd = e.contactCd;
  }
}

function updateBoss(e, dt) {
  if (e.slamState === 'telegraph') {
    e.slamTimer -= dt;
    if (e.slamTimer <= 0) {
      if (dist(player.x, player.y, e.x, e.y) <= e.slamRadius) applyDamageToPlayer(e.damage * 1.7);
      e.slamState = 'idle'; e.slamCdTimer = e.slamCd;
    }
    return;
  }
  e.slamCdTimer = (e.slamCdTimer === undefined ? e.slamCd : e.slamCdTimer) - dt;
  moveToward(e, player, e.speed, dt);
  e.hitCd = (e.hitCd || 0) - dt;
  if (e.hitCd <= 0 && dist(e.x, e.y, player.x, player.y) <= e.radius + player.radius) {
    applyDamageToPlayer(e.damage); e.hitCd = e.contactCd;
  }
  if (e.slamCdTimer <= 0) { e.slamState = 'telegraph'; e.slamTimer = e.slamTelegraph; e.slamX = player.x; e.slamY = player.y; }
}

// Skeleton hit-and-run tuning. He darts in for one heavy strike, then immediately
// disengages instead of standing in the enemy trading blows.
const MINION_DASH_SPEED = 660;   // charge-in speed
const MINION_BACK_SPEED = 430;   // disengage speed
const MINION_STANDOFF = 104;     // hover distance held between strikes
const MINION_RETREAT_TIME = 0.32;

function updateMinion(m, dt) {
  if (m.dead) return;
  stepMinion(m, dt);
  // Keep minions inside the arena, exactly as the player is clamped. An unbounded minion
  // wanders past the wall and drags the horde out with it, since enemies chase the nearest
  // target — which is what made the arena appear to leak.
  const mLim = ARENA_RADIUS - (m.radius || 14);
  m.x = clamp(m.x, -mLim, mLim);
  m.y = clamp(m.y, -mLim, mLim);
}

// Minions hunt whatever is nearest to *them*, which lets a chain of kills walk one clean off
// the screen. Past MINION_LEASH they abandon the fight and sprint back; they only re-engage
// once inside MINION_REGROUP. The gap between the two stops them flickering in and out of
// combat at the boundary.
const MINION_LEASH = 430;
const MINION_REGROUP = 190;
const MINION_RETURN_SPEED = 1.45; // hurries back rather than strolling

function stepMinion(m, dt) {
  const pdx = player.x - m.x, pdy = player.y - m.y;
  const playerDist = Math.hypot(pdx, pdy);
  if (playerDist > MINION_LEASH) m.returning = true;
  else if (playerDist < MINION_REGROUP) m.returning = false;

  if (m.returning) {
    m.facingLeft = pdx < 0;
    moveToward(m, player, m.speed * MINION_RETURN_SPEED, dt);
    // Reset the attack cycle so he doesn't arrive mid-dash at a target he's abandoned.
    m.state = 'wait';
    m.atkTimer = 0;
    return;
  }

  // Always retarget to whatever is closest right now, so a kill mid-dash redirects him.
  const target = findNearest(m.x, m.y, 650);

  if (!target) {
    // Nothing to fight — regroup on the player.
    m.state = 'wait';
    if (dist(m.x, m.y, player.x, player.y) > 70) moveToward(m, player, m.speed, dt);
    return;
  }

  const dx = target.x - m.x, dy = target.y - m.y;
  const d = Math.hypot(dx, dy) || 1;
  // Face the target at all times, including while backing away from it.
  m.facingLeft = dx < 0;

  // The gap between strikes tracks the player's live cooldown mods, so haste speeds the
  // skeleton up the same way it speeds up cast skills.
  const cdMult = m.skillRef ? computeModsCached(player, m.skillRef).cooldownMult : 1;
  const restCd = Math.max(0.12, m.atkCd * cdMult);

  switch (m.state || 'wait') {
    case 'dash': {
      moveToward(m, target, MINION_DASH_SPEED, dt);
      if (d <= m.atkRange + target.radius) {
        // One big hit, then bail out immediately.
        damageEnemy(target, m.damage, { damageMult: 1, lifeLeech: 0, critChance: 0 }, { knockback: 40 });
        play('slashHit');
        m.state = 'retreat';
        m.stateTimer = MINION_RETREAT_TIME;
      }
      break;
    }
    case 'retreat': {
      m.stateTimer -= dt;
      // Back off along the reverse of the approach vector.
      m.x -= (dx / d) * MINION_BACK_SPEED * dt;
      m.y -= (dy / d) * MINION_BACK_SPEED * dt;
      if (m.stateTimer <= 0) { m.state = 'wait'; m.atkTimer = restCd; }
      break;
    }
    default: { // 'wait' — hold the standoff ring until the next strike is ready
      m.atkTimer -= dt;
      if (d > MINION_STANDOFF * 1.35) moveToward(m, target, m.speed, dt);
      else if (d < MINION_STANDOFF * 0.75) {
        m.x -= (dx / d) * m.speed * 0.7 * dt;
        m.y -= (dy / d) * m.speed * 0.7 * dt;
      }
      if (m.atkTimer <= 0) m.state = 'dash';
      break;
    }
  }
}

function updateProjectile(p, dt) {
  // Curving shots (bones) rotate their velocity each frame, with the turn rate decaying so
  // the flight straightens out — the result reads as an arc toward the target.
  if (p.curve) {
    const a = p.curve * dt;
    const c = Math.cos(a), s = Math.sin(a);
    const vx = p.vx * c - p.vy * s;
    p.vy = p.vx * s + p.vy * c;
    p.vx = vx;
    p.curve *= Math.pow(0.02, dt); // decays fast; most of the bend happens early
  }
  p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
  if (p.life <= 0) {
    // A thrown flask shatters where it lands, leaving a lingering poison pool.
    if (p.isFlask) {
      spawnEffect({ kind: 'poisonPuddle', x: p.x, y: p.y, radius: p.puddleRadius, duration: p.puddleDuration, tickInterval: 0.4, poisonDps: p.poisonDps, poisonDur: p.poisonDur, mods: p.mods });
    } else if (p.isFire) {
      spawnExplosion(p.x, p.y, p.aoeRadius || 46);
    }
    p.dead = true; return;
  }
  if (p.enemyOwned) {
    if (dist(p.x, p.y, player.x, player.y) <= p.radius + player.radius) { applyDamageToPlayer(p.damage); p.dead = true; }
    return;
  }
  if (p.isFlask) return; // flasks fly over foes and only break on landing
  // The hot one: this used to test every projectile against every enemy. Narrowed to the grid
  // cells the projectile overlaps, widened by the largest live enemy radius so a big body is
  // never missed just because its centre sits outside the search circle.
  const near = enemiesInRange(p.x, p.y, p.radius + gridMaxRadius);
  for (const e of near) {
    if (e.dead || p.hitSet.has(e.id)) continue;
    if (dist(p.x, p.y, e.x, e.y) > p.radius + e.radius) continue;
    p.hitSet.add(e.id);
    if (p.damage > 0) damageEnemy(e, p.damage, p.mods, {});
    if (p.isIce) applyIceHit(e, p);
    if (p.aoeRadius) {
      for (const other of enemiesInRange(e.x, e.y, p.aoeRadius)) {
        if (other.id === e.id || p.hitSet.has(other.id)) continue;
        p.hitSet.add(other.id);
        damageEnemy(other, p.damage * 0.6, p.mods, {});
      }
      if (p.isFire) spawnExplosion(e.x, e.y, p.aoeRadius);
      p.dead = true;
    } else if (p.forks > 0) {
      // Forking splits the projectile in two at the point of impact. Each half continues
      // outward at an angle with its own chain budget, so a forked shot covers a spread of
      // targets rather than one ricochet path. Checked before chaining because the fork
      // consumes the parent — it becomes its children.
      forkProjectile(p, e);
      p.dead = true;
    } else if (p.chain > 0) {
      p.chain--;
      const next = findNearest(e.x, e.y, p.chainRange || 225, p.hitSet);
      if (next) {
        const speed = Math.hypot(p.vx, p.vy);
        const n = normalize(next.x - e.x, next.y - e.y);
        p.vx = n.x * speed; p.vy = n.y * speed; p.x = e.x; p.y = e.y;
        p.curve = 0;              // ricochets fly straight at the next target
        p.life = Math.max(p.life, 0.7); // ...and get enough life left to actually reach it
      } else p.dead = true;
    } else if (p.pierce > 0) {
      p.pierce--;
    } else {
      p.dead = true;
    }
    break;
  }
}

// Splits a projectile in two at an impact point. Children inherit damage and visuals but get
// their own chain budget and one fewer fork, so higher fork counts branch out geometrically
// instead of running away without limit.
const FORK_SPREAD = 32 * Math.PI / 180; // how far each half veers off the parent's heading

function forkProjectile(p, hitEnemy) {
  const speed = Math.hypot(p.vx, p.vy) || 1;
  const baseAng = Math.atan2(p.vy, p.vx);
  for (const side of [-1, 1]) {
    if (projectiles.length >= MAX_PROJECTILES) break; // respect the global ceiling
    const ang = baseAng + side * FORK_SPREAD;
    spawnProjectile({
      ...p,
      id: nextId++,
      // Fresh hit set holding only the enemy just struck, so each half can find its own
      // targets without instantly re-hitting the one that spawned it.
      hitSet: new Set([hitEnemy.id]),
      dead: false,
      x: hitEnemy.x, y: hitEnemy.y,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      forks: p.forks - 1,
      chain: p.childChain || 0,
      curve: 0,                     // forked halves fly straight
      life: Math.max(p.life, 0.7),  // ...with enough life left to reach something
    });
  }
}

// Perpendicular distance from point (px,py) to the segment (ax,ay)-(bx,by).
function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// Effects spawned together (Ice Nova's staggered frost patches, a burst of Flame Walk
// ground) would otherwise tick in lockstep and pile every enemy scan onto the same frame.
// A random starting phase spreads that work across the tick window instead.
function initialTickPhase(fx) {
  return Math.random() * (fx.tickInterval || 0.25);
}

function updateEffect(fx, dt) {
  // Staggered placement: a delayed effect trails the player until its delay elapses,
  // then locks at the player's position (used by Flame Walk's spaced patches).
  if (fx.delay !== undefined && fx.delay > 0) {
    fx.delay -= dt;
    fx.x = player.x; fx.y = player.y;
    if (fx.delay > 0) return;
  }
  fx.t += dt;
  if (fx.follow) { fx.x = player.x; fx.y = player.y; }
  if (fx.kind === 'poison' || fx.kind === 'poisonPuddle' || fx.kind === 'burningGround') {
    // All ground-hazard effects tick damage to everything standing in their radius. Burning
    // ground slowly widens its reach over its lifetime (up to +100%).
    fx.tickTimer = (fx.tickTimer === undefined ? initialTickPhase(fx) : fx.tickTimer) - dt;
    if (fx.tickTimer <= 0) {
      const tickR = fx.kind === 'burningGround' ? burningGroundRadius(fx) : fx.radius;
      for (const e of enemiesInRange(fx.x, fx.y, tickR)) {
        // Poison zones no longer damage directly — they apply the stacking poison debuff,
        // which carries the damage (weaker per tick, but it lingers well past the pool).
        if (fx.poisonDps) applyPoison(e, fx.poisonDps, fx.poisonDur, fx.mods);
        else damageEnemy(e, fx.damagePerTick, fx.mods, {});
        if (fx.burnDps && !e.dead) applyBurn(e, fx.burnDps, fx.burnDur, fx.mods); // Flame Walk sets foes ablaze
      }
      fx.tickTimer = fx.tickInterval;
    }
  } else if (fx.kind === 'frostGround') {
    // Frosted ground doesn't damage — it keeps chilling (slowing) foes standing in it.
    fx.tickTimer = (fx.tickTimer === undefined ? initialTickPhase(fx) : fx.tickTimer) - dt;
    if (fx.tickTimer <= 0) {
      const now = performance.now();
      for (const e of enemiesInRange(fx.x, fx.y, fx.radius)) {
        if (!e.slowUntil || now + fx.slowDurationMs > e.slowUntil) e.slowUntil = now + fx.slowDurationMs;
        e.slowFactor = fx.slowFactor;
      }
      fx.tickTimer = fx.tickInterval;
    }
  } else if (fx.kind === 'ninjastars') {
    // A ring of shuriken orbiting the player, pulsing between a constant inner radius and
    // the (scalable) outer one once per pulsePeriod. Each star damages what it sweeps over.
    // The star count is re-derived every frame so a Quantity tome picked up
    // mid-spin adds its blade immediately instead of waiting for the next cast.
    if (fx.baseCount !== undefined) fx.count = fx.baseCount + computeModsCached(player, fx.skillRef).projectileBonus;
    fx.tickTimer = (fx.tickTimer === undefined ? initialTickPhase(fx) : fx.tickTimer) - dt;
    if (fx.tickTimer <= 0) {
      // The blade and each of its echoes land their own separate damage instance.
      for (let k = 0; k <= NINJA_ECHO_COUNT; k++) {
        for (const p of ninjaStarPositions(fx, fx.t - k * NINJA_ECHO_STEP)) {
          for (const e of enemiesInRange(p.x, p.y, fx.starRadius)) damageEnemy(e, fx.damagePerTick, fx.mods, {});
        }
      }
      fx.tickTimer = fx.tickInterval;
    }
  } else if (fx.kind === 'flamethrower') {
    // A sustained cone of fire in the player's aim direction; tick damage + burn to foes in it.
    fx.dir = Math.atan2(player.facing.y, player.facing.x); // sweeps live with the player's aim
    // Spray actual flame particles out of the nozzle each frame; each keeps the velocity it was
    // launched with, so the stream trails correctly as you sweep.
    if (!fx.particles) fx.particles = [];
    if (fx.t < fx.duration - 0.05) {
      for (let i = 0; i < 6; i++) {
        const a = fx.dir + rand(-fx.halfAngle, fx.halfAngle);
        const sp = (fx.range / 0.42) * rand(0.65, 1.15); // travels ~range over its life
        const ml = rand(0.3, 0.5);
        fx.particles.push({ x: fx.x, y: fx.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: ml, maxLife: ml, sz: rand(3, 6) });
      }
    }
    for (const p of fx.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= (1 - 2.2 * dt); p.vy *= (1 - 2.2 * dt); // drag so they slow and billow
      p.life -= dt;
    }
    fx.particles = fx.particles.filter((p) => p.life > 0);
    fx.tickTimer = (fx.tickTimer === undefined ? initialTickPhase(fx) : fx.tickTimer) - dt;
    if (fx.tickTimer <= 0) {
      const dx0 = Math.cos(fx.dir), dy0 = Math.sin(fx.dir);
      for (const e of enemies) {
        if (e.dead) continue;
        const ex = e.x - fx.x, ey = e.y - fx.y;
        const d = Math.hypot(ex, ey);
        if (d > fx.range + e.radius) continue;
        const dot = d > 0 ? (ex / d) * dx0 + (ey / d) * dy0 : 1;
        if (Math.acos(Math.max(-1, Math.min(1, dot))) <= fx.halfAngle) {
          damageEnemy(e, fx.damagePerTick, fx.mods, {});
          if (!e.dead) applyBurn(e, fx.burnDps, fx.burnDur, fx.mods);
        }
      }
      fx.tickTimer = fx.tickInterval;
    }
  } else if (fx.kind === 'electroField') {
    // Pick the up-to-maxTargets nearest DISTINCT foes in range each frame — one tether
    // per enemy, never doubling up. Then fork chains onward through foes not already
    // tethered or chained, so no enemy is ever hit by two arcs of the same cast.
    // Insertion-select the N nearest instead of filtering and fully sorting every enemy each
    // frame. Same result, but no intermediate arrays and no O(n log n) sort.
    const primaries = nearestN(player.x, player.y, fx.range, fx.maxTargets);
    fx.targets = primaries.map((e) => ({ x: e.x, y: e.y, id: e.id }));
    // Each tether can run several independent chains outward — one plus however many forks.
    // links[i] is therefore a list of branches, each an array of points walking away from
    // that primary. `claimed` is shared across all of them so no foe is ever struck twice
    // by the same cast.
    fx.links = [];
    const branches = 1 + (fx.fork || 0);
    if (fx.chain > 0) {
      const claimed = new Set(primaries.map((e) => e.id));
      for (const primary of primaries) {
        const paths = [];
        for (let b = 0; b < branches; b++) {
          let prev = primary; const pts = [];
          for (let c = 0; c < fx.chain; c++) {
            let nn = null, nb = Infinity;
            for (const e of enemies) {
              if (e.dead || claimed.has(e.id)) continue;
              const d = dist(prev.x, prev.y, e.x, e.y);
              if (d <= 210 && d < nb) { nb = d; nn = e; } // x1.5 with the AoE pass
            }
            if (!nn) break;
            claimed.add(nn.id); pts.push({ x: nn.x, y: nn.y, id: nn.id }); prev = nn;
          }
          if (pts.length) paths.push(pts);
        }
        fx.links.push(paths);
      }
    }
    fx.tickTimer = (fx.tickTimer === undefined ? initialTickPhase(fx) : fx.tickTimer) - dt;
    if (fx.tickTimer <= 0) {
      for (const e of primaries) damageEnemy(e, fx.damagePerTick, fx.mods, {});
      for (const paths of fx.links) for (const pts of paths) for (const cp of pts) {
        const e = enemies.find((en) => en.id === cp.id && !en.dead);
        if (e) damageEnemy(e, fx.damagePerTick * 0.7, fx.mods, {});
      }
      fx.tickTimer = fx.tickInterval;
    }
  } else if (fx.kind === 'firebeam') {
    // Stay locked to the current target while it lives and is in range; otherwise
    // snap to the nearest foe still in range, and fizzle out if none remain.
    // Hold a direct reference rather than searching by id: `enemies.find(...)` ran once per
    // beam per frame, so at +18 projectiles against a large horde it was ~20 linear scans of
    // the whole array every frame. Re-acquisition goes through the spatial grid for the same
    // reason — the old fallback was a second full scan, and it fired constantly in exactly the
    // case that hurts, when beams kill their target and immediately need a new one.
    let target = fx.target;
    if (!target || target.dead || dist(player.x, player.y, target.x, target.y) > fx.range) {
      target = findNearest(player.x, player.y, fx.range);
      fx.target = target;
      if (target) fx.targetId = target.id;
    }
    if (!target) { fx.dead = true; return; }
    fx.tx = target.x; fx.ty = target.y;
    fx.tickTimer = (fx.tickTimer === undefined ? initialTickPhase(fx) : fx.tickTimer) - dt;
    if (fx.tickTimer <= 0) {
      const halfW = fx.width * 0.5;
      for (const e of enemies) {
        if (e.dead) continue;
        if (pointSegDist(e.x, e.y, fx.x, fx.y, fx.tx, fx.ty) <= halfW + e.radius) damageEnemy(e, fx.damagePerTick, fx.mods, {});
      }
      fx.tickTimer = fx.tickInterval;
    }
    // Embers thrown off the contact sphere. Capped and pooled in place — this runs every
    // frame for every active beam, so it must not allocate per frame.
    if (!fx.embers) fx.embers = [];
    fx.emberTimer = (fx.emberTimer === undefined ? 0 : fx.emberTimer) - dt;
    if (fx.emberTimer <= 0) {
      // Per-BEAM cap, so the real cost scales with projectile count: at +18 projectiles this
      // is 19 beams' worth at once, which is where the total starts to matter.
      for (let i = 0; i < 2 && fx.embers.length < BEAM_EMBER_CAP; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = 45 + Math.random() * 105;
        fx.embers.push({
          x: fx.tx, y: fx.ty,
          vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 40, // biased upward, like sparks
          t: 0, life: 0.3 + Math.random() * 0.4, sz: 1.4 + Math.random() * 2.4,
        });
      }
      fx.emberTimer = 0.035;
    }
    for (const em of fx.embers) {
      em.t += dt;
      em.x += em.vx * dt; em.y += em.vy * dt;
      em.vy += 70 * dt;      // gravity pulls the sparks back down
      em.vx *= 0.96;         // and they lose lateral speed as they burn out
    }
    compact(fx.embers, (em) => em.t < em.life);
  } else if (fx.kind === 'chestBurst') {
    for (const c of fx.coins) {
      c.vy += 540 * dt;              // gravity pulls the sprayed coins back down
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.rot += c.spin * dt;
      c.life -= dt;
    }
  } else if (fx.kind === 'iceShatter') {
    for (const s of fx.shards) {
      s.vy += 430 * dt;             // gravity on the flung shards
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.rot += s.spin * dt;
      s.life -= dt;
    }
  }
  if (fx.t >= fx.duration) fx.dead = true;
}

function updatePickup(pk, dt) {
  const pr = player.basePickupRadius * player.pickupRadiusMult;
  const d = dist(pk.x, pk.y, player.x, player.y);
  // Locked chests are heavy — they don't get vacuumed in; you walk onto them.
  if (d < pr && pk.kind !== 'chest') {
    const n = normalize(player.x - pk.x, player.y - pk.y);
    const pull = 500 + (1 - Math.min(1, d / pr)) * 900;
    pk.x += n.x * pull * dt; pk.y += n.y * pull * dt;
  }
  if (d < player.radius + pk.radius) {
    if (pk.kind === 'chest') {
      // Opens only if a key is available; otherwise the chest stays put until you have one.
      if (keyCount > 0) {
        keyCount--;
        pk.dead = true;
        play('jackpot');
        spawnChestBurst(pk.x, pk.y);
        const rw = pk.reward;
        if (rw.special === 'skillUnlock') {
          player.skillCap = (player.skillCap || 4) + 1; // stacks with each legendary
          pendingLevelUps++;                            // free level-up, auto-shown next update
          ui.showToast(`${rw.tierName}!`, 'Free level-up · +1 active skill slot', rw.color);
        } else {
          applyItem(player, rw.item);
          ui.showToast(`${rw.tierName} — ${rw.item.name}`, rw.item.affixes.map((a) => a.label).join(' • '), rw.color);
        }
      }
      return;
    }
    pk.dead = true;
    if (pk.kind === 'xp') { play('xpPickup', pk.xp); gainXp(pk.xp); }
    else if (pk.kind === 'gold') { play('goldPickup'); addGold(pk.gold); if (!pk.banked) unbankedGold += pk.gold; }
    else if (pk.kind === 'health') { play('heal'); player.hp = Math.min(player.maxHp, player.hp + Math.round(player.maxHp * pk.heal)); }
    else if (pk.kind === 'key') { keyCount++; play('keyPickup'); ui.showToast('Silver Key', 'Walk into a locked chest to open it.', '#cdd3dd'); }
  }
}

function gainXp(amount) {
  player.xp += amount * (player.xpGainMult || 1);
  let leveled = false;
  while (player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    player.level++;
    player.xpToNext = xpForLevel(player.level);
    pendingLevelUps++;
    leveled = true;
  }
  if (leveled) play('levelUp');
}

// How deep this run is, 0..1 — drives which upgrade tiers are available. Takes the better
// of elapsed time and stage reached, so rushing ahead unlocks the richer tiers as readily as
// grinding does, and endless play sits at full unlock.
function upgradeProgress() {
  if (beatFinalBoss) return 1;
  const byTime = clamp(elapsed / 540, 0, 1);                                  // ~9 min to full
  const byStage = clamp(currentStage / Math.max(1, STAGES.length - 1), 0, 1);
  return Math.max(byTime, byStage * 0.85);
}

function generateCards() {
  const pool = [];
  const known = player.activeSkills.map((s) => s.id);
  if (known.length < (player.skillCap || 4)) {
    for (const id of SKILL_ORDER) {
      if (known.includes(id)) continue;
      const def = SKILLS[id];
      if (def.minStage !== undefined && currentStage < def.minStage) continue; // stage-gated skills
      pool.push({ type: 'skill-new', id, weight: def.rarity !== undefined ? def.rarity : 3 });
    }
  }
  for (const s of player.activeSkills) {
    if (s.level >= SKILLS[s.id].maxLevel) continue;
    // Each offered level-up rolls its own rarity, biased by the player's Item Rarity stat,
    // then rolls which of THIS skill's parameters the upgrade improves.
    const tier = rollUpgradeTier(player.rarityMult || 1, upgradeProgress());
    const up = rollSkillUpgrade(tier, SKILLS[s.id], s.infusion);
    pool.push({ type: 'skill-level', id: s.id, weight: 2.2, tier, up, infusion: up.infusion });
  }
  // Tomes fill a limited shelf. Once it is full, only the tomes already carried are offered —
  // deepening what you chose rather than adding to it, which is where the sacrifice bites.
  const tomesHeld = SUPPORT_ORDER.filter((id) => (player.supports[id] || 0) > 0).length;
  const shelfFull = tomesHeld >= (player.supportCap || SUPPORT_SLOTS_BASE);
  for (const id of SUPPORT_ORDER) {
    const lvl = player.supports[id] || 0;
    if (lvl === 0 && shelfFull) continue;
    // A tome whose effect is capped stops being offered at that cap — otherwise it keeps
    // taking a card slot to sell a level that does nothing.
    const tomeMax = SUPPORTS[id].maxLevel;
    if (tomeMax !== undefined && lvl >= tomeMax) continue;
    const tier = rollUpgradeTier(player.rarityMult || 1, upgradeProgress());
    pool.push({ type: 'support', id, weight: lvl === 0 ? 2 : 1, tier, levels: rollSupportLevels(tier) });
  }
  for (const node of STAT_NODES) {
    const tier = rollUpgradeTier(player.rarityMult || 1, upgradeProgress());
    pool.push({ type: 'stat', id: node.id, weight: 1, tier, value: roundStat(node, node.base * rollStatMult(tier)) });
  }

  const chosen = [];
  const bag = pool.slice();
  while (chosen.length < 3 && bag.length) {
    const item = pickWeighted(bag.map((c) => [c, c.weight]));
    chosen.push(item);
    const idx = bag.indexOf(item);
    bag.splice(idx, 1);
  }
  return chosen.map(describeCard);
}

function describeCard(card) {
  const t = card.tier;
  if (card.type === 'skill-new') {
    const def = SKILLS[card.id];
    return { ...card, title: def.name, subtitle: 'NEW SKILL', desc: def.desc, color: def.color };
  }
  if (card.type === 'skill-level') {
    const s = player.activeSkills.find((x) => x.id === card.id);
    const def = SKILLS[card.id];
    if (!t || !card.up) return { ...card, title: `${def.name} +1`, subtitle: 'SKILL', desc: def.desc, color: def.color };
    // Spell out every parameter this roll improved.
    const parts = card.up.rolls.map((r) => SKILL_ATTRS[r.attr].fmt(r.value));
    if (card.up.proj) parts.push(`+${card.up.proj} projectile${card.up.proj > 1 ? 's' : ''}`);
    if (card.up.infusion) parts.push(`<b>${INFUSIONS[card.up.infusion].name} infusion</b> — ${INFUSIONS[card.up.infusion].desc}`);
    return {
      ...card, title: `${def.name} +1`,
      subtitle: `${t.name.toUpperCase()} SKILL · Lv ${s.level} → ${s.level + 1}`,
      desc: parts.join(' · '), color: t.color,
    };
  }
  if (card.type === 'support') {
    const def = SUPPORTS[card.id];
    const lvl = player.supports[card.id] || 0;
    const n = card.levels || 1;
    const sub = t ? `${t.name.toUpperCase()} TOME` : 'TOME';
    return {
      ...card, title: n > 1 ? `${def.name} +${n}` : def.name,
      subtitle: `${sub} · Lv ${lvl} → ${lvl + n}`,
      desc: def.desc, color: t ? t.color : def.color,
    };
  }
  const def = STAT_NODES.find((n) => n.id === card.id);
  const val = card.value !== undefined ? card.value : def.base;
  return {
    ...card, title: def.name,
    subtitle: t ? `${t.name.toUpperCase()} STAT UP` : 'STAT UP',
    desc: def.label(val), color: t ? t.color : def.color,
  };
}

function applyCard(card) {
  if (card.type === 'skill-new') {
    // Guard against a card being applied twice (double input, or a stale card left in the
    // DOM). generateCards() already filters these out, but a duplicate gem would then cast
    // independently — which reads in-game as projectiles multiplying without limit.
    if (player.activeSkills.some((x) => x.id === card.id)) return;
    if (player.activeSkills.length >= (player.skillCap || 4)) return;
    player.activeSkills.push({ id: card.id, level: 1, cd: 0 });
  }
  else if (card.type === 'skill-level') {
    const s = player.activeSkills.find((x) => x.id === card.id);
    if (!s || s.level >= SKILLS[s.id].maxLevel) return;
    s.level++;
    if (card.up) {
      s.bonus = s.bonus || {};
      for (const r of card.up.rolls) {
        const k = SKILL_ATTRS[r.attr].key;
        s.bonus[k] = (s.bonus[k] || 0) + r.value;
      }
      if (card.up.proj) s.bonus.projectileBonus = (s.bonus.projectileBonus || 0) + card.up.proj;
      if (card.up.infusion) s.infusion = card.up.infusion;
    }
  }
  else if (card.type === 'support') player.supports[card.id] = (player.supports[card.id] || 0) + (card.levels || 1);
  else {
    const node = STAT_NODES.find((n) => n.id === card.id);
    node.apply(player, card.value !== undefined ? card.value : node.base);
  }
}

function showLevelUpStep() {
  // `render` lets the reroll button re-draw a fresh set of cards in place, spending one
  // of this run's rerolls (granted by the Diviner's Token shop upgrade).
  const render = () => {
    // One pick per shown card set. Without this latch a double input (or a click landing on
    // a stale card still in the DOM) applies a second card and burns another queued level-up,
    // costing the player a reward they earned.
    let picked = false;
    ui.showLevelUp(generateCards(), (card) => {
      if (picked) return;
      picked = true;
      applyCard(card);
      // Belt-and-braces: never let the queue go negative, or the debt would silently
      // swallow later level-up screens until it climbed back to zero.
      pendingLevelUps = Math.max(0, pendingLevelUps - 1);
      if (pendingLevelUps > 0) showLevelUpStep();
      else { ui.hideLevelUp(); state = 'PLAYING'; }
    }, {
      available: getSettings().infiniteRerolls || getUpgradeLevel('reroll') > 0,
      left: getSettings().infiniteRerolls ? Infinity : rerollsLeft,
      onReroll: () => {
        if (getSettings().infiniteRerolls) { play('uiClick'); render(); }        // dev cheat: free
        else if (rerollsLeft > 0) { rerollsLeft--; play('uiClick'); render(); }
      },
    });
  };
  render();
}

function triggerGameOver() {
  state = 'GAMEOVER';
  play('playerDeath');
  // Beating the final boss makes all further gold permanent; otherwise death costs you
  // only what you'd gathered since the last boss you felled.
  if (!beatFinalBoss) addGold(-Math.min(unbankedGold, getGold()));
  unbankedGold = 0;
  playMusic('mainMenu');
  // A run counts as a victory if the final boss was ever felled, even though play continued.
  recordRun({ time: elapsed, kills, level: player.level, className: player.className, classId: player.classId, victory: beatFinalBoss, stage: currentStage + 1 });
  ui.showEndScreen({ victory: beatFinalBoss, time: elapsed, level: player.level, kills, stage: currentStage + 1 }, startClassSelect, showMainMenu);
}
// The final boss falling flips the run into endless survival rather than ending it: the run
// is flagged a victory (for the leaderboard mark) and play continues until you die, so the
// recorded time becomes an honest "how long could you last" number.
function onBossDefeated() {
  play('victory');
  if (!beatFinalBoss) {
    beatFinalBoss = true;
    ui.showStageCard('The Sovereign Falls', 'Endless — survive as long as you can.');
  } else {
    ui.showStageCard(`Wave ${endlessWave} Survived`, 'The horde does not relent.');
  }
  endlessWave++;
  // Start the next boss cycle in place — same stage, harder everything.
  stageElapsed = 0; stageKills = 0; spawnTimer = 0; bossSpawned = false; boss = null;
}

function trySpawnEnemy() {
  const pool = poolForTime(stageElapsed, STAGES[currentStage].enemyPool);
  const id = pick(pool);
  const type = ENEMY_TYPES[id];
  const ang = rand(0, Math.PI * 2);
  const spawnDist = Math.max(canvas.width, canvas.height) * 0.62 + 60;
  let x = player.x + Math.cos(ang) * spawnDist;
  let y = player.y + Math.sin(ang) * spawnDist;
  const eLim = ARENA_RADIUS - 40;
  x = clamp(x, -eLim, eLim); y = clamp(y, -eLim, eLim);
  // Endless waves ratchet the whole roster up on an exponential curve, each stat separately.
  // Three layers, deliberately kept separate so each can be tuned without disturbing the
  // others: the global curve (how the whole game escalates), the per-stage time ramp (how this
  // stage escalates as it runs), and the stage's own stat multipliers (how this stage differs
  // from the baseline). HP and damage used to share a single per-stage number, so they could
  // not be moved independently, and there was no per-stage speed control at all.
  const st = stageEnemyStats();
  const ramp = difficultyMult(stageElapsed);
  const hp = type.hp * ramp * curveScale('hp') * st.hp;
  enemies.push({
    ...type, id: nextId++, spriteId: id, x, y, hp, maxHp: hp,
    damage: Math.round(type.damage * (0.7 + ramp * 0.3) * curveScale('damage') * st.damage),
    speed: type.speed * curveScale('speed') * st.speed,
    dead: false, hitCd: 0,
  });
}

function spawnBoss() {
  const stageDef = STAGES[currentStage];
  boss = {
    ...makeBoss(player.level, stageDef.boss), id: nextId++, spriteId: stageDef.boss.spriteId,
    x: player.x + rand(-1, 1) * 500, y: player.y - 600, dead: false, hitCd: 0, slamState: 'idle',
  };
  const bLim = ARENA_RADIUS - 80;
  boss.x = clamp(boss.x, -bLim, bLim); boss.y = clamp(boss.y, -bLim, bLim);
  // Bosses ride the same curve as the roster, so a stage-2 boss is already meaningfully
  // tougher than a stage-1 one without needing its own separate scaling table.
  boss.maxHp = Math.round(boss.maxHp * curveScale('hp'));
  boss.hp = boss.maxHp;
  boss.damage = Math.round(boss.damage * curveScale('damage'));
  boss.speed = boss.speed * curveScale('speed');
  enemies.push(boss);
  bossSpawned = true;
  play('bossSpawn');
  const bossLabel = endlessWave > 0 ? `${stageDef.boss.name} — Wave ${endlessWave + 1}` : stageDef.boss.name;
  ui.showToast(bossLabel, 'A boss draws near…', stageDef.boss.color);
}

// ---------- main loop ----------
function updateGamepadBadge(allPads) {
  const gpBadge = document.getElementById('gamepadStatus');
  gpBadge.classList.toggle('hidden', state !== 'START' && state !== 'SETTINGS');
  if (gp) {
    if (gpBadgeId === null) gpBadge.classList.add('connected');
    gpBadgeId = gp.id;
    const heldButtons = gp.buttons.map((p, i) => (p ? i : null)).filter((i) => i !== null);
    const others = allPads.filter((p) => p.id !== gp.id).map((p) => `  (also seen: ${p.id}, mapping: ${p.mapping || '(none)'})`).join('\n');
    gpBadge.textContent = `🎮 active: ${gp.id}\nmapping: ${gp.mapping || '(none)'}\naxes: [${gp.rawAxes.map((a) => a.toFixed(2)).join(', ')}]\nheld buttons: [${heldButtons.join(', ')}]${others ? '\n' + others : ''}`;
  } else {
    gpBadgeId = null;
    gpBadge.classList.remove('connected');
    gpBadge.textContent = '🎮 No controller detected — press a button on it';
  }
}

function updateInputModeTracking() {
  if (gp) {
    const active = gp.justPressed.some(Boolean) || Math.hypot(gp.move.x, gp.move.y) > 0.05 || Math.hypot(gp.aim.x, gp.aim.y) > 0.05;
    if (active) lastInputDevice = 'gamepad';
  }
  const mode = getSettings().inputPromptMode;
  const effective = mode === 'auto' ? lastInputDevice : mode;
  if (effective !== appliedInputMode) { appliedInputMode = effective; ui.applyInputMode(effective); }
}

let lastPadsSignature = '';
function refreshSettingsMenuIfPadsChanged() {
  if (state !== 'SETTINGS') return;
  const sig = listConnectedPads().map((p) => p.id).join('|');
  if (sig !== lastPadsSignature) { lastPadsSignature = sig; refreshSettingsMenu(); }
}

let lastTime = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);

  gp = pollGamepad(getSettings().activeGamepadId);
  if (gp && gpAxesStale) {
    // Wait for the stick (and both stick-derived vectors) to settle at neutral before
    // trusting gamepad input again; until then, treat it as no input.
    if (Math.hypot(gp.move.x, gp.move.y) < 0.15 && Math.hypot(gp.aim.x, gp.aim.y) < 0.15) {
      gpAxesStale = false;
    } else {
      gp.move.x = 0; gp.move.y = 0; gp.aim.x = 0; gp.aim.y = 0;
      gp.rawAxes = gp.rawAxes.map(() => 0);
    }
  }
  updateGamepadBadge(listConnectedPads());
  updateInputModeTracking();

  if (state === 'PLAYING') {
    if (gp && (gp.justPressed[9] || gp.justPressed[8]) && performance.now() - lastPauseToggle > PAUSE_TOGGLE_COOLDOWN) {
      lastPauseToggle = performance.now(); openPause(); // Start or View/Back
    }
    update(dt);
    render();
  } else {
    const menuArtBehind = state === 'MAINMENU' || state === 'LEADERBOARD' || state === 'SHOP' || state === 'UNLOCKS' || (state === 'SETTINGS' && settingsReturnState === 'MAINMENU');
    const pausedBehind = state === 'PAUSED' || (state === 'SETTINGS' && settingsReturnState === 'PAUSED');
    if (menuArtBehind) renderMainMenuArt();
    else if (state === 'LEVELUP' || pausedBehind) render();
    if (pausedBehind) drawPauseDim();
    if (state === 'PAUSED' && gp && (gp.justPressed[9] || gp.justPressed[8]) && performance.now() - lastPauseToggle > PAUSE_TOGGLE_COOLDOWN) {
      lastPauseToggle = performance.now(); closePause();
    }
    if (state === 'SETTINGS') refreshSettingsMenuIfPadsChanged();
    updateGamepadMenuNav();
  }
  updatePerfBox(now);
  requestAnimationFrame(frame);
}

// ---- TEMPORARY perf readout (FPS + live enemy count). Delete with its markup/CSS. ----
// FPS is counted over a rolling 250ms window rather than from a single frame delta, so the
// number is readable instead of flickering every frame.
let frameId = 0; // bumped once per update; scopes the per-frame mods cache
let frostStackDim = 1; // see the frostGround note in the update loop
let perfFrames = 0;
let perfWindowStart = 0;
let perfFps = 0;
function updatePerfBox(now) {
  perfFrames++;
  if (now - perfWindowStart >= 250) {
    perfFps = Math.round((perfFrames * 1000) / (now - perfWindowStart));
    perfFrames = 0; perfWindowStart = now;
  }
  const fpsEl = document.getElementById('perfFps');
  const enEl = document.getElementById('perfEnemies');
  if (!fpsEl || !enEl) return;
  fpsEl.textContent = perfFps;
  fpsEl.className = 'perfVal' + (perfFps < 30 ? ' bad' : perfFps < 50 ? ' warn' : '');
  const live = state === 'PLAYING' || state === 'PAUSED' || state === 'LEVELUP';
  const n = live ? enemies.length : 0;
  enEl.textContent = n;
  enEl.className = 'perfVal' + (n >= MAX_ENEMIES ? ' bad' : n > MAX_ENEMIES * 0.75 ? ' warn' : '');
  // Projectiles and effects are uncapped (unlike enemies), so surface them here — a runaway
  // build shows up as one of these climbing without settling.
  const prEl = document.getElementById('perfProj');
  const fxEl = document.getElementById('perfFx');
  if (prEl) {
    const np = live ? projectiles.length : 0;
    prEl.textContent = np;
    prEl.className = 'perfVal' + (np >= MAX_PROJECTILES ? ' bad' : np > MAX_PROJECTILES * 0.75 ? ' warn' : '');
  }
  if (fxEl) {
    const nf = live ? effects.length : 0;
    fxEl.textContent = nf;
    fxEl.className = 'perfVal' + (nf >= MAX_EFFECTS ? ' bad' : nf > MAX_EFFECTS * 0.75 ? ' warn' : '');
  }
}

// Pixel-art main title. Everything is drawn to a low-res offscreen canvas, then upscaled
// nearest-neighbor so the (still-gothic) fonts and the blocky gold frame read as pixel art.
function renderTitleArt() {
  const cv = document.getElementById('titleCanvas');
  if (!cv) return;
  const PIX = 3, W = 600, H = 244;
  const sw = Math.round(W / PIX), sh = Math.round(H / PIX);
  cv.width = W; cv.height = H;
  const off = document.createElement('canvas'); off.width = sw; off.height = sh;
  const o = off.getContext('2d');
  o.imageSmoothingEnabled = false;
  o.clearRect(0, 0, sw, sh);

  const gold = '#c9a227', goldDim = '#7e611b', goldHi = '#f0d98a', dark = '#2a1a08';
  // Warm backing glow.
  const bg = o.createRadialGradient(sw / 2, sh * 0.5, 3, sw / 2, sh * 0.5, sw * 0.62);
  bg.addColorStop(0, 'rgba(58,38,15,0.6)');
  bg.addColorStop(1, 'rgba(18,11,5,0)');
  o.fillStyle = bg; o.fillRect(0, 0, sw, sh);

  // Blocky pixel frame with bevel + inner keyline.
  const fx0 = 3, fy0 = 3, fw = sw - 6, fh = sh - 6;
  o.fillStyle = dark; o.fillRect(fx0 - 1, fy0 - 1, fw + 2, fh + 2);
  o.fillStyle = gold;
  o.fillRect(fx0, fy0, fw, 2); o.fillRect(fx0, fy0 + fh - 2, fw, 2);
  o.fillRect(fx0, fy0, 2, fh); o.fillRect(fx0 + fw - 2, fy0, 2, fh);
  o.fillStyle = goldHi; o.fillRect(fx0, fy0, fw, 1); o.fillRect(fx0, fy0, 1, fh);
  o.fillStyle = goldDim; o.fillRect(fx0, fy0 + fh - 1, fw, 1); o.fillRect(fx0 + fw - 1, fy0, 1, fh);
  const ix = fx0 + 3, iy = fy0 + 3, iw = fw - 6, ih = fh - 6;
  o.fillStyle = goldDim;
  o.fillRect(ix, iy, iw, 1); o.fillRect(ix, iy + ih - 1, iw, 1);
  o.fillRect(ix, iy, 1, ih); o.fillRect(ix + iw - 1, iy, 1, ih);

  // Jeweled corner studs.
  const gem = (gx, gy) => {
    o.fillStyle = gold; o.fillRect(gx - 2, gy - 2, 5, 5);
    o.fillStyle = '#8a1f1a'; o.fillRect(gx - 1, gy - 1, 3, 3);
    o.fillStyle = '#d15a4d'; o.fillRect(gx, gy, 1, 1);
    o.fillStyle = goldHi; o.fillRect(gx - 2, gy - 2, 1, 1);
  };
  gem(fx0 + 1, fy0 + 1); gem(fx0 + fw - 2, fy0 + 1); gem(fx0 + 1, fy0 + fh - 2); gem(fx0 + fw - 2, fy0 + fh - 2);

  // DUSKFALL — the gothic font, outlined and gold, sized to fit.
  o.textAlign = 'center'; o.textBaseline = 'alphabetic'; o.lineJoin = 'round';
  let fs = 36; o.font = `${fs}px 'Pirata One', serif`;
  while (o.measureText('DUSKFALL').width > sw - 26 && fs > 10) { fs -= 1; o.font = `${fs}px 'Pirata One', serif`; }
  const dy = Math.round(sh * 0.52);
  o.strokeStyle = dark; o.lineWidth = 3; o.strokeText('DUSKFALL', sw / 2, dy);
  const tg = o.createLinearGradient(0, dy - fs * 0.82, 0, dy + 2);
  tg.addColorStop(0, '#f7e79c'); tg.addColorStop(0.5, '#e6c14e'); tg.addColorStop(1, '#a8842f');
  o.fillStyle = tg; o.fillText('DUSKFALL', sw / 2, dy);

  // Divider bars + gem, vertically centered in the gap between the two words; the gem sits
  // centered on the line (dvy), with SURVIVORS an equal step below.
  const dvy = dy + 6;
  o.fillStyle = gold; o.fillRect(sw / 2 - 48, dvy, 32, 1); o.fillRect(sw / 2 + 16, dvy, 32, 1);
  o.fillStyle = '#8a1f1a'; o.fillRect(sw / 2 - 2, dvy - 2, 4, 4); o.fillStyle = '#d15a4d'; o.fillRect(sw / 2 - 1, dvy - 1, 2, 2);
  // Same pixel face as the section headings, not the gothic serif. Press Start 2P is far
  // wider per glyph than Cinzel was, so the size is fitted to the frame rather than fixed —
  // at a hardcoded 11px the word ran past the border on narrower canvases.
  try { o.letterSpacing = '1px'; } catch (e) { /* older engines ignore */ }
  let fs2 = 11;
  o.font = `${fs2}px 'Press Start 2P', 'Pixelify Sans', monospace`;
  while (o.measureText('SURVIVORS').width > sw - 34 && fs2 > 5) {
    fs2 -= 0.5;
    o.font = `${fs2}px 'Press Start 2P', 'Pixelify Sans', monospace`;
  }
  // Sits lower than the old serif did: Press Start 2P has a much taller cap height and no
  // descender room built into its baseline, so at the previous offset its caps clipped the
  // divider rule above it.
  const sy = dvy + 19;
  o.strokeStyle = dark; o.lineWidth = 2; o.strokeText('SURVIVORS', sw / 2, sy);
  o.fillStyle = '#e6c14e'; o.fillText('SURVIVORS', sw / 2, sy);
  try { o.letterSpacing = '0px'; } catch (e) { /* noop */ }

  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(off, 0, 0, sw, sh, 0, 0, W, H);
}

// Render the title once its fonts are ready (fall back to an immediate draw).
function ensureTitleArt() {
  renderTitleArt();
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load("36px 'Pirata One'"), document.fonts.load("11px 'Press Start 2P'")])
      .then(renderTitleArt).catch(() => {});
  }
}

function renderMainMenuArt() {
  ctx2d.fillStyle = '#050403';
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2, cy = canvas.height * 0.62;

  ctx2d.save();
  ctx2d.beginPath(); ctx2d.arc(cx, cy, Math.max(canvas.width, canvas.height), 0, Math.PI * 2); ctx2d.clip();
  const fpm = floorPatternSize;
  ctx2d.translate(((cx % fpm) + fpm) % fpm, ((cy % fpm) + fpm) % fpm);
  ctx2d.fillStyle = floorPattern;
  ctx2d.fillRect(-fpm, -fpm, canvas.width + fpm * 2, canvas.height + fpm * 2);
  ctx2d.restore();

  const glow = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, Math.max(canvas.width, canvas.height) * 0.7);
  glow.addColorStop(0, 'rgba(10,6,3,0)');
  glow.addColorStop(0.55, 'rgba(10,6,3,0.25)');
  glow.addColorStop(1, 'rgba(4,2,1,0.88)');
  ctx2d.fillStyle = glow;
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);

  drawArtCarousel();
}

// The menu backdrop: every piece of hand-drawn animated art, marching across the screen.
//
// The cast is whatever `handDrawnSpriteIds()` reports, so new artwork joins on its own — there
// is no list here to keep in sync. Figures walk in from one side and pass behind the menu
// panel, so the empty space either side of it does the showing.
//
// One lane only. A second, smaller lane higher up used to add depth, but at this figure size
// it just crowded the frame. The array shape is kept so a lane can be added back in one line.
const CAROUSEL_LANES = [
  // Height is deliberately an exact multiple of the 64px source art. Sprites that snap to a
  // whole-number scale and the zombie (which sets `fitExact` and does not snap) then land on
  // the same size — ask for 439 and the snapping ones round to 448 while the zombie stays 439.
  // alpha 1: fully opaque. Depth is carried by SIZE, not by fading — a translucent character
  // reads as a ghost rather than as a distant one.
  { yFrac: 0.5, height: 448, alpha: 1, speed: 114.28, dir: -1 },
];

// ---- the unseen drum -------------------------------------------------------------------
// The cast is spaced evenly around a vertical cylinder rather than along a flat line. Only the
// near face is drawn, so a figure swings out from the far edge, grows as it rounds toward the
// viewer, and shrinks away again as it leaves. Three cues sell it together, and all three are
// needed — any one alone still reads flat:
//   1. x = sin(angle): figures sweep quickly past centre and crowd toward the edges.
//   2. scale = f(cos(angle)): nearest at centre, smallest at the rim.
//   3. paint order back-to-front, so a nearer figure overlaps one behind it.
const DRUM_RADIUS_FRAC = 0.56; // horizontal reach as a fraction of canvas width
const DRUM_MIN_SCALE = 0.5;    // size at the far rim relative to full size at centre
const DRUM_LIFT = 0.06;        // nearer figures sit slightly lower, as if closer to the eye

let carouselIds = [];
let carouselDirty = true;

function drawArtCarousel() {
  if (carouselDirty) { carouselIds = handDrawnSpriteIds(); carouselDirty = false; }
  // Art loads asynchronously, so the very first frames can have nothing to show. Keep the old
  // procedural line-up as the backdrop until the real art is in, rather than an empty stage.
  if (!carouselIds.length) {
    ctx2d.save();
    ctx2d.globalAlpha = 0.5;
    drawSprite(ctx2d, 'boss', canvas.width / 2, canvas.height * 0.2, Math.min(240, canvas.height * 0.36), false);
    ctx2d.restore();
    drawSprite(ctx2d, 'wraith', canvas.width * 0.1, canvas.height * 0.3, 90, false);
    drawSprite(ctx2d, 'bat', canvas.width * 0.85, canvas.height * 0.32, 50, true);
    drawSprite(ctx2d, 'zombie', canvas.width * 0.16, canvas.height * 0.72, 78, false);
    drawSprite(ctx2d, 'skeletonArcher', canvas.width * 0.82, canvas.height * 0.74, 84, true);
    return;
  }

  const t = performance.now() / 1000;
  const cx = canvas.width / 2;
  const radius = canvas.width * DRUM_RADIUS_FRAC;
  const n = carouselIds.length;

  for (let li = 0; li < CAROUSEL_LANES.length; li++) {
    const lane = CAROUSEL_LANES[li];
    const y = canvas.height * lane.yFrac;
    // Angular speed derived from the old linear one, so the pace past centre is unchanged.
    const spin = (t * lane.speed * lane.dir) / radius;

    // Collect first, paint second: the drum only looks solid if nearer figures cover farther
    // ones, and that ordering is not the same as the order they sit in the cast.
    const shown = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + spin;
      const depth = Math.cos(ang); // +1 nearest the viewer, -1 on the hidden far face
      if (depth <= 0) continue;    // far face: behind the drum, not drawn
      const x = cx + Math.sin(ang) * radius;
      // Sizing by height alone breaks on wide art: a quadruped at 448px tall would be ~775px
      // across. Cap the WIDTH at the lane height too, so a long low animal comes out long and
      // low instead of enormous — which also makes it read as shorter than the people.
      const aspect = spriteAspect(carouselIds[i]) || 1;
      const full = Math.min(lane.height, lane.height / aspect);
      const scale = DRUM_MIN_SCALE + (1 - DRUM_MIN_SCALE) * depth;
      const h = full * scale;
      // Ground line drops slightly as a figure comes forward, the way a nearer object sits
      // lower in frame; the (lane.height - h) term keeps short figures on that same line.
      const feetY = y + (lane.height - h) / 2 + lane.height * DRUM_LIFT * depth;
      shown.push({ i, x, y: feetY, h, depth });
    }
    shown.sort((a, b) => a.depth - b.depth); // farthest painted first

    ctx2d.save();
    ctx2d.globalAlpha = lane.alpha;
    for (const f of shown) {
      // Side art is drawn facing right, so mirror it when the lane travels left.
      // Each figure gets its own walk-cycle phase; in lockstep the line-up looks mechanical.
      const phase = (f.i * 137 + li * 61) % 1000;
      // exactScale: the drum changes a figure's size every frame, and the default whole-number
      // snapping would quantise that into visible steps rather than a smooth approach.
      drawSprite(ctx2d, carouselIds[f.i], f.x, f.y, f.h, lane.dir < 0, 'side', phase, true);
    }
    ctx2d.restore();
  }
}

function update(dt) {
  elapsed += dt; stageElapsed += dt;

  shakeAmount = Math.max(0, shakeAmount - 40 * dt);
  shakeOffset = shakeAmount > 0 ? { x: rand(-1, 1) * shakeAmount, y: rand(-1, 1) * shakeAmount } : { x: 0, y: 0 };

  let mx = 0, my = 0;
  if (keys.has('w') || keys.has('arrowup')) my -= 1;
  if (keys.has('s') || keys.has('arrowdown')) my += 1;
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
  if (keys.has('d') || keys.has('arrowright')) mx += 1;
  if (gp) { mx += gp.move.x; my += gp.move.y; }
  mx = clamp(mx, -1, 1); my = clamp(my, -1, 1);
  const n = normalize(mx, my);
  const speed = player.baseSpeed * player.speedMult;
  player.x += n.x * speed * dt;
  player.y += n.y * speed * dt;
  const pLim = ARENA_RADIUS - player.radius;
  player.x = clamp(player.x, -pLim, pLim);
  player.y = clamp(player.y, -pLim, pLim);
  // Facing priority: gamepad right stick > mouse cursor (kb/mouse play) > movement.
  if (gp && (gp.aim.x !== 0 || gp.aim.y !== 0)) {
    player.facing = normalize(gp.aim.x, gp.aim.y);
  } else if (lastInputDevice === 'keyboard' && mouseAimActive) {
    const dx = mousePos.x - canvas.width / 2, dy = mousePos.y - canvas.height / 2;
    if (dx !== 0 || dy !== 0) player.facing = normalize(dx, dy);
  } else if (n.x !== 0 || n.y !== 0) {
    player.facing = n;
  }

  player.hp = Math.min(player.maxHp, player.hp + player.hpRegen * dt);

  for (const s of player.activeSkills) {
    // A summon whose cap has just risen fills the new slot at once. Without this, picking up
    // a +1 leaves the extra skeleton missing until the next cast — up to a full 7s wait.
    const def = SKILLS[s.id];
    if (def.minionCap) {
      const cap = def.minionCap(s.level, computeModsCached(player, s));
      if (s.minionCap !== undefined && cap > s.minionCap) s.cd = 0;
      s.minionCap = cap;
    }
    s.cd = (s.cd || 0) - dt;
    if (s.cd <= 0) {
      const mods = computeMods(player, s);
      SKILLS[s.id].cast({ player, level: s.level, mods, world, facing: player.facing, skill: s });
      s.cd = skillCooldown(s.id) * mods.cooldownMult;
    }
  }

  // The horde never lets up — enemies keep pouring in through the boss fight so the kill
  // count can keep climbing for the leaderboard.
  // The respawn pad. `armed` means the player has to leave and step back on: standing in it
  // would otherwise refill the field every frame.
  if (sandboxMode && sandboxButton) {
    const d = dist(player.x, player.y, sandboxButton.x, sandboxButton.y);
    const touching = d <= sandboxButton.radius + player.radius;
    if (touching && sandboxButton.armed) {
      sandboxButton.armed = false;
      enemies = [];
      spawnSandboxEnemies();
      play('levelUp');
      ui.showToast('Respawned', 'The chosen formation returns.', '#c94a3f');
    } else if (!touching) {
      sandboxButton.armed = true;
    }
  }

  // Sandbox places its own enemies once and never adds to them — the whole point is a load
  // that stays fixed while something is measured against it. Only the DIRECTOR is skipped
  // here; everything below still has to run or the scenario would sit frozen.
  if (!sandboxMode) {
    spawnTimer -= dt;
    // Accumulate rather than reset so short intervals don't lose spawns to frame time;
    // the guard keeps a long frame from dumping the whole horde at once.
    let spawnGuard = 0;
    while (spawnTimer <= 0 && spawnGuard++ < 10) {
      // At the ceiling, hold spawning entirely. Zeroing the timer (rather than letting it run
      // further negative) stops a spawn debt building up, which would otherwise dump a huge
      // burst the instant the count dipped back under the cap.
      if (enemies.length >= MAX_ENEMIES) { spawnTimer = 0; break; }
      trySpawnEnemy();
      // Endless waves shorten the gap between spawns on the same exponential curve as the
      // stat ramp — without it the horde thinned out over time, because a stronger player
      // cleared each spawn faster than the fixed interval could replace it.
      spawnTimer += spawnIntervalFor(stageElapsed) / (stageEnemyStats().spawnRate * curveScale('spawnRate'));
    }
    // The boss is the ONLY way a stage ends — the timer just keeps counting the round's
    // run time; the boss arrives once THIS stage's hidden clock hits BOSS_TIME (or its kills do).
    if (!bossSpawned && (stageElapsed >= BOSS_TIME || stageKills >= KILL_THRESHOLD)) spawnBoss();
  }

  for (const e of enemies) updateEnemy(e, dt);
  for (const m of minions) updateMinion(m, dt);
  for (const p of projectiles) updateProjectile(p, dt);
  frameId++; // new frame — per-frame caches (mods) become stale here
  for (const fx of effects) updateEffect(fx, dt);
  // Frost patches composite over one another, so a stack of them (Ice Nova with +projectile
  // lays several) blows out to near-white. Dim each patch as more become active so the
  // combined wash stays close to what a single patch looks like.
  let frostLive = 0;
  for (const fx of effects) if (fx.kind === 'frostGround' && !(fx.delay > 0)) frostLive++;
  frostStackDim = 1 / Math.sqrt(Math.max(1, frostLive));
  for (const pk of pickups) updatePickup(pk, dt);
  for (const d of dmgNumbers) { d.t += dt; d.y -= 38 * dt; }

  // Compact in place rather than rebuilding six arrays every frame — at a few hundred live
  // entities that was several thousand allocations a second feeding the collector.
  compact(enemies, (e) => !e.dead);
  compact(minions, (m) => !m.dead);
  compact(projectiles, (p) => !p.dead);
  compact(effects, (fx) => !fx.dead);
  if (effects.length > MAX_EFFECTS) effects.splice(0, effects.length - MAX_EFFECTS);
  if (projectiles.length > MAX_PROJECTILES) projectiles.splice(0, projectiles.length - MAX_PROJECTILES);
  compact(pickups, (pk) => !pk.dead);
  compact(dmgNumbers, (d) => d.t < d.life);

  if (pendingLevelUps > 0 && state === 'PLAYING') { state = 'LEVELUP'; showLevelUpStep(); return; }

  ui.updateHUD({
    hp: player.hp, maxHp: player.maxHp, xp: player.xp, xpToNext: player.xpToNext, level: player.level,
    elapsed, bossSpawned, bossHp: boss ? boss.hp : 0, bossMaxHp: boss ? boss.maxHp : 0,
    bossName: boss ? boss.name : '', stage: currentStage + 1, stageName: STAGES[currentStage].name,
    endlessWave: beatFinalBoss ? endlessWave : 0, gold: getGold(), keys: keyCount, chestsEnabled: CHESTS_ENABLED,
    kills, skills: player.activeSkills.map((s) => ({ ...s, def: SKILLS[s.id] })),
    supports: Object.entries(player.supports).map(([id, lvl]) => ({ def: SUPPORTS[id], lvl })),
  });
}

function worldToScreen(x, y) {
  return { x: x - player.x + canvas.width / 2 + shakeOffset.x, y: y - player.y + canvas.height / 2 + shakeOffset.y };
}

function render() {
  ctx2d.save();
  drawArenaFloor();

  for (const d of decorObjects) drawDecor(d);
  if (sandboxMode && sandboxButton) drawSandboxButton();
  for (const b of bloodDecals) drawBlood(b);
  for (const pk of pickups) drawPickup(pk);
  for (const fx of effects) drawEffect(fx);
  for (const e of enemies) drawEnemy(e);
  for (const m of minions) drawMinion(m);
  drawPlayer();
  for (const p of projectiles) drawProjectile(p);
  for (const d of dmgNumbers) drawDamageNumber(d);
  drawTorchlight();
  ctx2d.restore();
  applyBloom();
}

// Bloom post-process: additively composite a blurred, contrast-crushed copy of the frame so
// bright things (fire, lightning, ice, torchlight, explosions, gems) glow. This runs only
// inside world rendering, so the DOM menus/HUD panels are never touched.
let bloomCanvas = null, bloomCtx = null;
function applyBloom() {
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return;
  const bw = Math.max(1, Math.round(w * 0.5)), bh = Math.max(1, Math.round(h * 0.5)); // half-res for speed
  if (!bloomCanvas) { bloomCanvas = document.createElement('canvas'); bloomCtx = bloomCanvas.getContext('2d'); }
  if (bloomCanvas.width !== bw || bloomCanvas.height !== bh) { bloomCanvas.width = bw; bloomCanvas.height = bh; }
  // Crush the darks (high contrast leaves mostly the bright pixels) and blur into a soft glow.
  bloomCtx.clearRect(0, 0, bw, bh);
  bloomCtx.filter = 'contrast(1.6) brightness(1.12) blur(3px)';
  bloomCtx.drawImage(canvas, 0, 0, w, h, 0, 0, bw, bh);
  bloomCtx.filter = 'none';
  // Add the glow back over the scene (additive — dark areas contribute ~nothing).
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  ctx2d.globalAlpha = 0.55;
  ctx2d.imageSmoothingEnabled = true;
  ctx2d.drawImage(bloomCanvas, 0, 0, bw, bh, 0, 0, w, h);
  ctx2d.restore(); // restores composite/alpha and imageSmoothingEnabled(false) for crisp sprites
}

function drawArenaFloor() {
  const stageDef = STAGES[currentStage];
  ctx2d.fillStyle = '#050403';
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);
  const c = worldToScreen(0, 0);
  const half = ARENA_RADIUS;
  const x0 = c.x - half, y0 = c.y - half, size = half * 2;

  ctx2d.save();
  ctx2d.beginPath(); ctx2d.rect(x0, y0, size, size); ctx2d.clip();
  const fp = floorPatternSize;
  ctx2d.translate(((c.x % fp) + fp) % fp, ((c.y % fp) + fp) % fp);
  ctx2d.fillStyle = floorPattern;
  ctx2d.fillRect(-fp, -fp, canvas.width + fp * 2, canvas.height + fp * 2);
  ctx2d.restore();

  // Vignette toward the arena edges, clipped to the square.
  ctx2d.save();
  ctx2d.beginPath(); ctx2d.rect(x0, y0, size, size); ctx2d.clip();
  const falloff = ctx2d.createRadialGradient(c.x, c.y, half * 0.5, c.x, c.y, half * 1.15);
  falloff.addColorStop(0, 'rgba(0,0,0,0)');
  falloff.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx2d.fillStyle = falloff;
  ctx2d.fillRect(x0, y0, size, size);
  ctx2d.restore();

  // Boundary walls.
  ctx2d.strokeStyle = stageDef.boundaryOuter; ctx2d.lineWidth = 10;
  ctx2d.strokeRect(x0, y0, size, size);
  ctx2d.strokeStyle = stageDef.boundaryInner; ctx2d.lineWidth = 3;
  ctx2d.strokeRect(x0 + 6, y0 + 6, size - 12, size - 12);
}

function drawTorchlight() {
  const [tr, tg, tb] = STAGES[currentStage].glowTint;
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const r = Math.min(canvas.width, canvas.height) * 0.56;
  const glow = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, r);
  glow.addColorStop(0, `rgba(${tr},${tg},${tb},0)`);
  glow.addColorStop(0.55, `rgba(${tr},${tg},${tb},0)`);
  glow.addColorStop(1, `rgba(${Math.round(tr * 0.6)},${Math.round(tg * 0.6)},${Math.round(tb * 0.6)},0.55)`);
  ctx2d.fillStyle = glow;
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);
}

// Graveyard headstones and crosses: pale weathered granite with a lit top edge.
const GRAVE_STONE = '#8c8676';
const GRAVE_STONE_LIT = '#b3ac99';

// The respawn pad: a big red disc you walk onto. Drawn dimmer while disarmed (you are standing
// on it) so it is obvious why a second press is doing nothing.
function drawSandboxButton() {
  const b = sandboxButton;
  const s = worldToScreen(b.x, b.y);
  ctx2d.save();
  ctx2d.globalAlpha = b.armed ? 1 : 0.45;
  ctx2d.beginPath(); ctx2d.arc(s.x, s.y + 6, b.radius, 0, Math.PI * 2);
  ctx2d.fillStyle = 'rgba(0,0,0,0.5)'; ctx2d.fill();          // base shadow
  ctx2d.beginPath(); ctx2d.arc(s.x, s.y, b.radius, 0, Math.PI * 2);
  ctx2d.fillStyle = '#8a1f1a'; ctx2d.fill();                   // rim
  ctx2d.beginPath(); ctx2d.arc(s.x, s.y, b.radius - 7, 0, Math.PI * 2);
  ctx2d.fillStyle = b.armed ? '#d1352b' : '#7a2a24'; ctx2d.fill(); // face
  ctx2d.beginPath(); ctx2d.arc(s.x, s.y - 5, b.radius - 16, Math.PI * 1.1, Math.PI * 1.9);
  ctx2d.strokeStyle = 'rgba(255,255,255,0.28)'; ctx2d.lineWidth = 4; ctx2d.stroke(); // highlight
  ctx2d.fillStyle = '#1a0d0a';
  ctx2d.font = "700 17px 'Press Start 2P', 'Pixelify Sans', monospace";
  ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle';
  ctx2d.fillText('SPAWN', s.x, s.y + 1);
  ctx2d.fillStyle = '#f2d9a0';
  ctx2d.fillText('SPAWN', s.x, s.y);
  ctx2d.restore();
}

function drawDecor(d) {
  const s = worldToScreen(d.x, d.y);
  if (s.x < -60 || s.x > canvas.width + 60 || s.y < -60 || s.y > canvas.height + 60) return;
  ctx2d.save();
  ctx2d.translate(s.x, s.y);
  ctx2d.rotate(d.rot * 0.06);
  ctx2d.scale(d.scale, d.scale);
  // Raised from 0.55: the hand-drawn floor tiles carry far more detail than the flat
  // procedural grain they replaced, and decor at the old opacity disappeared into them.
  ctx2d.globalAlpha = 0.72;
  if (d.type === 'tombstone') {
    // Pale weathered stone rather than the old near-brown, for the same reason — it has to
    // read as a separate object sitting ON the cobbles, not as part of their pattern.
    ctx2d.fillStyle = GRAVE_STONE;
    ctx2d.beginPath();
    ctx2d.moveTo(-8, 14); ctx2d.lineTo(-8, -6); ctx2d.quadraticCurveTo(-8, -14, 0, -14);
    ctx2d.quadraticCurveTo(8, -14, 8, -6); ctx2d.lineTo(8, 14); ctx2d.closePath(); ctx2d.fill();
    // Darker engraving + a lit top edge, so it reads as carved rather than as a flat blob.
    ctx2d.strokeStyle = 'rgba(0,0,0,0.45)'; ctx2d.lineWidth = 1; ctx2d.beginPath();
    ctx2d.moveTo(-4, -2); ctx2d.lineTo(2, -8); ctx2d.stroke();
    ctx2d.fillStyle = GRAVE_STONE_LIT; ctx2d.fillRect(-8, -13, 16, 1.5);
  } else if (d.type === 'cross') {
    ctx2d.fillStyle = GRAVE_STONE;
    ctx2d.fillRect(-2, -14, 4, 26); ctx2d.fillRect(-8, -8, 16, 4);
    ctx2d.fillStyle = GRAVE_STONE_LIT;
    ctx2d.fillRect(-2, -14, 4, 1.5); ctx2d.fillRect(-8, -8, 16, 1.5);
  } else if (d.type === 'pillar') {
    ctx2d.fillStyle = '#8a6f42';
    ctx2d.fillRect(-7, -18, 14, 10); ctx2d.fillRect(-9, -8, 18, 8); ctx2d.fillRect(-6, 0, 12, 10);
    ctx2d.fillStyle = 'rgba(0,0,0,0.25)'; ctx2d.fillRect(-7, -18, 14, 3);
  } else if (d.type === 'obelisk') {
    ctx2d.fillStyle = '#8a6f42';
    ctx2d.beginPath();
    ctx2d.moveTo(-6, 16); ctx2d.lineTo(-5, -18); ctx2d.lineTo(0, -26); ctx2d.lineTo(5, -18); ctx2d.lineTo(6, 16);
    ctx2d.closePath(); ctx2d.fill();
  } else if (d.type === 'rubble') {
    ctx2d.fillStyle = '#6b5636';
    ctx2d.beginPath(); ctx2d.arc(-6, 4, 6, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.beginPath(); ctx2d.arc(4, 6, 8, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.beginPath(); ctx2d.arc(8, -3, 4.5, 0, Math.PI * 2); ctx2d.fill();
  } else if (d.type === 'skull') {
    ctx2d.fillStyle = '#8a8478';
    ctx2d.beginPath(); ctx2d.arc(0, -2, 8, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.fillRect(-5, 4, 10, 6);
    ctx2d.fillStyle = 'rgba(0,0,0,0.5)';
    ctx2d.beginPath(); ctx2d.arc(-3, -2, 1.8, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.beginPath(); ctx2d.arc(3, -2, 1.8, 0, Math.PI * 2); ctx2d.fill();
  } else if (d.type === 'ribcage') {
    ctx2d.strokeStyle = '#7a746a'; ctx2d.lineWidth = 2.4;
    for (let i = 0; i < 4; i++) {
      ctx2d.beginPath();
      ctx2d.arc(0, -6 + i * 5, 9, Math.PI * 0.15, Math.PI * 0.85);
      ctx2d.stroke();
    }
  } else if (d.type === 'bones') {
    ctx2d.strokeStyle = '#7a746a'; ctx2d.lineWidth = 3; ctx2d.lineCap = 'round';
    ctx2d.beginPath(); ctx2d.moveTo(-10, -8); ctx2d.lineTo(10, 8); ctx2d.stroke();
    ctx2d.beginPath(); ctx2d.moveTo(-10, 8); ctx2d.lineTo(10, -8); ctx2d.stroke();
  }
  ctx2d.restore();
}

function hpBar(sx, sy, w, ratio, color) {
  ctx2d.fillStyle = 'rgba(0,0,0,0.6)'; ctx2d.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 7);
  ctx2d.fillStyle = color; ctx2d.fillRect(sx - w / 2, sy, w * clamp(ratio, 0, 1), 5);
}

function drawEnemy(e) {
  const s = worldToScreen(e.x, e.y);
  if (s.x < -80 || s.x > canvas.width + 80 || s.y < -80 || s.y > canvas.height + 80) return;
  if (e.isBoss && e.slamState === 'telegraph') {
    const p = 1 - e.slamTimer / e.slamTelegraph;
    const n = parseInt(e.color.slice(1), 16);
    ctx2d.strokeStyle = `rgba(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff},${0.35 + 0.5 * p})`;
    ctx2d.lineWidth = 3;
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, e.slamRadius, 0, Math.PI * 2); ctx2d.stroke();
  }
  // Floating enemies hover and bob instead of planting on the ground.
  if (e.floats) {
    s.y += Math.sin(performance.now() / 320 + e.id) * 4 - 6;
    // warm firelight cast onto the ground beneath the flames
    const g = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, e.radius * 3);
    g.addColorStop(0, 'rgba(255,150,50,0.28)');
    g.addColorStop(1, 'rgba(200,70,20,0)');
    ctx2d.save(); ctx2d.globalCompositeOperation = 'lighter';
    ctx2d.fillStyle = g; ctx2d.beginPath(); ctx2d.arc(s.x, s.y, e.radius * 3, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.restore();
  }
  drawSprite(ctx2d, e.spriteId, s.x, s.y, e.radius * (e.isBoss ? 2.8 : 3.8) * MONSTER_SPRITE_SCALE, e.facingLeft,
    e.viewDir || 'side');
  const nowMs = performance.now();
  if (e.poisonUntil && e.poisonUntil > nowMs) drawPoisonStatus(s.x, s.y, e.radius, e);
  if (e.burnUntil && e.burnUntil > nowMs) drawBurningStatus(s.x, s.y, e.radius);
  if (e.frozenUntil && e.frozenUntil > nowMs) drawFrozenStatus(s.x, s.y, e);
  else if (e.slowUntil && e.slowUntil > nowMs) drawFrostStatus(s.x, s.y, e.radius);
  if (e.hp < e.maxHp) hpBar(s.x, s.y - e.radius - 12, e.isBoss ? 70 : e.radius * 2.2, e.hp / e.maxHp, e.isBoss ? '#a13328' : '#7a1f1a');
  if (e.isBoss) { ctx2d.fillStyle = '#c98d85'; ctx2d.font = '12px Cinzel, serif'; ctx2d.textAlign = 'center'; ctx2d.fillText(e.name, s.x, s.y - e.radius - 20); }
}

// Small flame tongues licking up off a burning enemy.
// Poisoned foes get a purple tint over their sprite plus a persistent cloud of drifting
// toxic motes. Denser as poison stacks build.
function drawPoisonStatus(sx, sy, r, e) {
  const tm = performance.now() / 1000;
  const stacks = Math.max(1, e.poisonStacks || 1);
  ctx2d.save();
  // purple overlay wash on the body
  ctx2d.globalCompositeOperation = 'source-atop';
  const wash = ctx2d.createRadialGradient(sx, sy, 0, sx, sy, r * 1.4);
  const strength = Math.min(0.5, 0.2 + stacks * 0.045);
  wash.addColorStop(0, `rgba(150,60,190,${strength})`);
  wash.addColorStop(1, `rgba(96,30,140,${strength * 0.6})`);
  ctx2d.fillStyle = wash;
  ctx2d.beginPath(); ctx2d.arc(sx, sy, r * 1.4, 0, Math.PI * 2); ctx2d.fill();
  ctx2d.restore();
  // drifting cloud motes around it
  ctx2d.save();
  const motes = 4 + Math.min(6, stacks);
  for (let i = 0; i < motes; i++) {
    const a = (i / motes) * Math.PI * 2 + tm * 0.7 + i;
    const bob = Math.sin(tm * 2 + i * 1.7);
    const rad = r * (0.85 + 0.25 * Math.sin(tm * 1.3 + i));
    const px = sx + Math.cos(a) * rad;
    const py = sy + Math.sin(a) * rad * 0.6 - bob * 3 - r * 0.2;
    const sz = 2 + 1.6 * Math.abs(Math.sin(tm * 1.6 + i * 2.1));
    const g = ctx2d.createRadialGradient(px, py, 0, px, py, sz * 2.2);
    g.addColorStop(0, 'rgba(190,110,225,0.5)');
    g.addColorStop(1, 'rgba(120,40,170,0)');
    ctx2d.fillStyle = g;
    ctx2d.beginPath(); ctx2d.arc(px, py, sz * 2.2, 0, Math.PI * 2); ctx2d.fill();
  }
  ctx2d.restore();
}

function drawBurningStatus(sx, sy, r) {
  const tm = performance.now() / 1000;
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const fxp = sx + Math.sin(tm * 6 + i * 2.1) * r * 0.5;
    const fyp = sy - r * 0.55 - i * 3 + Math.sin(tm * 9 + i) * 2;
    const h = 6 + 4 * Math.abs(Math.sin(tm * 12 + i * 2));
    const g = ctx2d.createRadialGradient(fxp, fyp, 0, fxp, fyp, h);
    g.addColorStop(0, 'rgba(255,230,150,0.55)');
    g.addColorStop(0.5, 'rgba(240,120,40,0.35)');
    g.addColorStop(1, 'rgba(200,40,20,0)');
    ctx2d.fillStyle = g;
    ctx2d.beginPath(); ctx2d.ellipse(fxp, fyp, h * 0.45, h * 0.85, 0, 0, Math.PI * 2); ctx2d.fill();
  }
  ctx2d.restore();
}

// Little ice-crystal glints around a chilled/slowed enemy.
function drawFrostStatus(sx, sy, r) {
  const tm = performance.now() / 600;
  ctx2d.save();
  ctx2d.strokeStyle = 'rgba(190,230,248,0.55)'; ctx2d.lineWidth = 1.4;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + tm * 0.3;
    const cx = sx + Math.cos(a) * r * 0.7, cy = sy + Math.sin(a) * r * 0.6;
    ctx2d.beginPath();
    ctx2d.moveTo(cx - 2.5, cy); ctx2d.lineTo(cx + 2.5, cy);
    ctx2d.moveTo(cx, cy - 2.5); ctx2d.lineTo(cx, cy + 2.5);
    ctx2d.stroke();
  }
  ctx2d.restore();
}

// Build one jagged, faceted ice-crystal shape — an irregular outer polygon plus a web of
// interior facet lines. Randomized so every frozen enemy looks different.
function makeIceCrystal(r) {
  const n = 8 + Math.floor(Math.random() * 4); // 8–11 outer points
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.22, 0.22);
    const rad = r * (0.74 + Math.random() * 0.6); // uneven radii = angular/jagged silhouette
    pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad });
  }
  // Interior nodes the facets radiate from.
  const nodes = [{ x: rand(-r * 0.14, r * 0.14), y: rand(-r * 0.14, r * 0.14) }];
  const extra = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < extra; i++) nodes.push({ x: rand(-r * 0.42, r * 0.42), y: rand(-r * 0.42, r * 0.42) });
  const facets = [];
  for (const node of nodes) {
    const start = Math.floor(Math.random() * n);
    for (let k = 0; k < n; k += 2 + Math.floor(Math.random() * 2)) {
      const v = pts[(start + k) % n];
      facets.push([node.x, node.y, v.x, v.y]);
    }
  }
  for (let i = 0; i < nodes.length - 1; i++) facets.push([nodes[i].x, nodes[i].y, nodes[i + 1].x, nodes[i + 1].y]);
  return { pts, facets };
}

// An angular crystal of ice encasing a frozen enemy; its shape is generated once per freeze
// (cached on the enemy) so it stays stable while frozen but differs between enemies.
function drawFrozenStatus(sx, sy, e) {
  if (e.iceShapeFor !== e.frozenUntil) { e.iceShape = makeIceCrystal(e.radius * 1.5); e.iceShapeFor = e.frozenUntil; }
  const c = e.iceShape;
  ctx2d.save();
  ctx2d.translate(sx, sy);
  ctx2d.beginPath();
  c.pts.forEach((p, i) => (i ? ctx2d.lineTo(p.x, p.y) : ctx2d.moveTo(p.x, p.y)));
  ctx2d.closePath();
  ctx2d.fillStyle = 'rgba(155,210,238,0.44)';
  ctx2d.fill();
  ctx2d.lineJoin = 'round';
  ctx2d.strokeStyle = 'rgba(230,247,255,0.9)'; ctx2d.lineWidth = 1.6; // crisp crystal outline
  ctx2d.stroke();
  ctx2d.strokeStyle = 'rgba(255,255,255,0.38)'; ctx2d.lineWidth = 1;  // interior facets
  ctx2d.beginPath();
  for (const f of c.facets) { ctx2d.moveTo(f[0], f[1]); ctx2d.lineTo(f[2], f[3]); }
  ctx2d.stroke();
  ctx2d.restore();
}

function drawMinion(m) {
  const s = worldToScreen(m.x, m.y);
  drawSprite(ctx2d, 'skeletonMinion', s.x, s.y, 46 * MONSTER_SPRITE_SCALE, m.facingLeft);
  hpBar(s.x, s.y - 22, 22, m.hp / m.maxHp, '#6b8a52');
}

// Characters render 50% larger than their 64px source art. This is a 1.5x scale, so source
// pixels no longer map 1:1 — accepted deliberately in favour of the bigger on-screen read.
const PLAYER_SPRITE_SOURCE_HEIGHT = 64;
const PLAYER_SPRITE_HEIGHT = 96;

// The hitbox is derived from the sprite scale rather than hard-coded, so scaling the art can
// never again leave the hitbox behind (it did: art went 64->96 while radius stayed 14, which
// silently shrank the player's hitbox from 44% of the sprite to 29%). Enemies get this for
// free because their sprite is drawn *from* radius; the player's sprite is a fixed height.
const PLAYER_BASE_RADIUS = 14;

// Monsters 50% up from their original radius * 3.8 (2.8 for bosses), matching the player's
// bump so relative proportions hold. Independent of PLAYER_SPRITE_HEIGHT on purpose — tying
// the two together meant changing one silently resized the other.
const MONSTER_SPRITE_SCALE = 1.5;

function drawPlayer() {
  const s = worldToScreen(player.x, player.y);
  const dir = facingDir(player.facing.x, player.facing.y);
  drawSprite(ctx2d, player.classId, s.x, s.y, PLAYER_SPRITE_HEIGHT, player.facing.x < 0, dir);
}

function drawFireball(sx, sy, vx, vy, radius) {
  const speed = Math.hypot(vx, vy) || 1;
  const dirX = -vx / speed, dirY = -vy / speed;
  for (let i = 3; i >= 1; i--) {
    const t = i / 3;
    const tx = sx + dirX * i * radius * 1.6;
    const ty = sy + dirY * i * radius * 1.6;
    ctx2d.globalAlpha = 0.32 * (1 - t * 0.55);
    ctx2d.fillStyle = i > 1.5 ? '#5c1f10' : '#d97a35';
    ctx2d.beginPath(); ctx2d.arc(tx, ty, radius * (1 - t * 0.45), 0, Math.PI * 2); ctx2d.fill();
  }
  ctx2d.globalAlpha = 1;

  ctx2d.save();
  ctx2d.translate(sx, sy);
  const flicker = Math.sin(performance.now() / 55 + sx) * 0.2;
  ctx2d.fillStyle = '#a13328';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + flicker;
    const len = radius * (1.3 + (i % 2) * 0.35);
    ctx2d.beginPath();
    ctx2d.moveTo(Math.cos(a - 0.28) * radius * 0.6, Math.sin(a - 0.28) * radius * 0.6);
    ctx2d.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx2d.lineTo(Math.cos(a + 0.28) * radius * 0.6, Math.sin(a + 0.28) * radius * 0.6);
    ctx2d.closePath();
    ctx2d.fill();
  }
  const grad = ctx2d.createRadialGradient(0, 0, 0, 0, 0, radius * 1.15);
  grad.addColorStop(0, '#fff3c4');
  grad.addColorStop(0.35, '#ffb347');
  grad.addColorStop(0.7, '#e8641f');
  grad.addColorStop(1, '#7a1f0f');
  ctx2d.fillStyle = grad;
  ctx2d.beginPath(); ctx2d.arc(0, 0, radius, 0, Math.PI * 2); ctx2d.fill();
  ctx2d.restore();
}

function jaggedPolyline(x1, y1, x2, y2, segments, jitter, perpX, perpY) {
  const pts = [{ x: x1, y: y1 }];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const off = (Math.random() - 0.5) * jitter;
    pts.push({ x: x1 + (x2 - x1) * t + perpX * off, y: y1 + (y2 - y1) * t + perpY * off });
  }
  pts.push({ x: x2, y: y2 });
  return pts;
}

// A crackling arc between two points. Every source of regularity is randomised so no two
// arcs share a silhouette: spacing between kinks, which side each kink falls on, how far it
// throws, and where the occasional big spike lands.
// Reused across calls: an electro field with forks draws hundreds of arcs a frame, and a
// fresh point array for each was thousands of short-lived objects per second. The buffer
// grows to the high-water mark and is then reused; callers consume it before the next call.
const _zigBuf = [];
let _zigLen = 0;
function zigPush(x, y) {
  const slot = _zigBuf[_zigLen];
  if (slot) { slot.x = x; slot.y = y; } else { _zigBuf[_zigLen] = { x, y }; }
  _zigLen++;
}

function zigzagPolyline(x1, y1, x2, y2, segments, amp, perpX, perpY) {
  _zigLen = 0;
  zigPush(x1, y1);
  const dx = x2 - x1, dy = y2 - y1;
  let side = Math.random() < 0.5 ? 1 : -1;
  let t = 0;
  while (true) {
    // Uneven gaps between kinks — evenly spaced ones read as a machined sawtooth.
    const step = (1 / segments) * (0.5 + Math.random() * 1.0);
    t += step;
    if (t >= 0.97) break;
    // Usually cross to the other side, but not always; the occasional run of two kinks on
    // the same side is what stops it looking like a repeating pattern.
    if (Math.random() < 0.78) side = -side;
    // Taper toward both ends so the arc anchors cleanly on the caster and the target
    // instead of jumping sideways the instant it leaves them.
    const taper = Math.sin(Math.PI * t);
    const spike = Math.random() < 0.16 ? 1.9 : 1;   // rare oversized kink
    const off = side * amp * taper * spike * (0.3 + Math.random() * 0.85);
    // Nudge along the axis too, so kinks don't land on a predictable rhythm.
    const tt = t + (Math.random() - 0.5) * 0.3 * step;
    zigPush(x1 + dx * tt + perpX * off, y1 + dy * tt + perpY * off);
  }
  zigPush(x2, y2);
  // A live view of the buffer, valid only until the next zigzagPolyline call.
  return { length: _zigLen, buf: _zigBuf };
}

function strokePolyline(pts) {
  // Accepts either a plain point array or the reusable zigzag buffer view.
  if (pts && pts.buf) {
    const { buf, length } = pts;
    ctx2d.beginPath();
    ctx2d.moveTo(buf[0].x, buf[0].y);
    for (let i = 1; i < length; i++) ctx2d.lineTo(buf[i].x, buf[i].y);
    ctx2d.stroke();
    return;
  }
  ctx2d.beginPath();
  ctx2d.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx2d.lineTo(pts[i].x, pts[i].y);
  ctx2d.stroke();
}

function drawLightningBolt(sx, sy, vx, vy, radius) {
  const speed = Math.hypot(vx, vy) || 1;
  const dirX = vx / speed, dirY = vy / speed;
  const perpX = -dirY, perpY = dirX;
  const len = 96; // a long, streaking bolt rather than a short spark
  const tailX = sx - dirX * len * 0.45, tailY = sy - dirY * len * 0.45;
  const headX = sx + dirX * len * 0.55, headY = sy + dirY * len * 0.55;
  const main = jaggedPolyline(tailX, tailY, headX, headY, 11, radius * 2.4, perpX, perpY);

  ctx2d.save();
  ctx2d.shadowColor = '#6fd0ff';
  ctx2d.lineCap = 'round';
  ctx2d.strokeStyle = 'rgba(58,150,255,0.55)';
  ctx2d.lineWidth = 5;
  strokePolyline(main);
  ctx2d.strokeStyle = '#eaf6ff';
  ctx2d.lineWidth = 1.8;
  strokePolyline(main);

  const mid = main[Math.floor(main.length / 2)];
  const forkSign = Math.random() > 0.5 ? 1 : -1;
  const forkEnd = { x: mid.x + perpX * radius * 3 * forkSign + dirX * 8, y: mid.y + perpY * radius * 3 * forkSign + dirY * 8 };
  const fork = jaggedPolyline(mid.x, mid.y, forkEnd.x, forkEnd.y, 3, radius, perpX, perpY);
  ctx2d.strokeStyle = 'rgba(150,215,255,0.55)'; ctx2d.lineWidth = 1.3;
  strokePolyline(fork);
  ctx2d.restore();
}

// ---------- cheap glow ----------
// shadowBlur forces a full blur pass per draw call, which at ~200 live projectiles and
// effects was costing more than everything else combined. These pre-render one soft radial
// glow per colour/size and blit it, turning a blur pass into a single drawImage.
function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

const glowCache = new Map();
function glowSprite(rgb, radius) {
  const r = Math.max(2, Math.round(radius));
  const key = `${rgb}|${r}`;
  let c = glowCache.get(key);
  if (!c) {
    const size = r * 2;
    c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, `rgba(${rgb},0.55)`);
    grad.addColorStop(0.45, `rgba(${rgb},0.22)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    glowCache.set(key, c);
  }
  return c;
}

// Additive so overlapping glows build up the way the old shadow did.
function drawGlow(sx, sy, rgb, radius) {
  const spr = glowSprite(rgb, radius);
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  ctx2d.drawImage(spr, sx - spr.width / 2, sy - spr.height / 2);
  ctx2d.restore();
}

// ---------- elemental infusion visuals ----------
// Each infusion gets its own thematic look so an infused gem reads differently at a glance:
// a clinging aura on every projectile it fires, and a distinct burst where its hits land.
const INFUSION_VIS = {
  frost:   { core: '#eaf9ff', glow: '#7fd4f2', deep: '#3f8fbc' },
  shock:   { core: '#f2fbff', glow: '#5ac8f0', deep: '#2a7fc0' },
  burning: { core: '#ffd48c', glow: '#ff7a1f', deep: '#c0421f' },
  poison:  { core: '#e6b0f5', glow: '#a95ec0', deep: '#5e2a78' },
};

// Aura that rides along on an infused projectile. Motion is derived from time + the
// projectile id so each shot animates independently without storing extra state.
function drawInfusionAura(sx, sy, kind, seed, scale = 1) {
  const v = INFUSION_VIS[kind];
  if (!v) return;
  const t = performance.now() / 1000;
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';

  if (kind === 'frost') {
    // Slow-orbiting hex crystals with a cold halo.
    ctx2d.fillStyle = `rgba(127,212,242,0.20)`;
    ctx2d.beginPath(); ctx2d.arc(sx, sy, 9 * scale, 0, Math.PI * 2); ctx2d.fill();
    for (let i = 0; i < 3; i++) {
      const a = t * 1.6 + seed + (i * Math.PI * 2) / 3;
      const rx = sx + Math.cos(a) * 8 * scale, ry = sy + Math.sin(a) * 8 * scale;
      ctx2d.fillStyle = i === 0 ? v.core : v.glow;
      ctx2d.beginPath();
      for (let k = 0; k < 6; k++) {
        const ha = (k / 6) * Math.PI * 2 + a;
        const hr = 2.4 * scale;
        k ? ctx2d.lineTo(rx + Math.cos(ha) * hr, ry + Math.sin(ha) * hr)
          : ctx2d.moveTo(rx + Math.cos(ha) * hr, ry + Math.sin(ha) * hr);
      }
      ctx2d.closePath(); ctx2d.fill();
    }
  } else if (kind === 'shock') {
    // Short jagged sparks flicking out at stuttering angles.
    ctx2d.strokeStyle = v.glow; ctx2d.lineWidth = 1.4 * scale;
    for (let i = 0; i < 4; i++) {
      const flick = Math.floor(t * 22 + seed * 7 + i * 3);
      const a = (flick % 12) / 12 * Math.PI * 2 + i;
      const len = (4 + (flick % 3) * 2.4) * scale;
      ctx2d.beginPath();
      ctx2d.moveTo(sx, sy);
      ctx2d.lineTo(sx + Math.cos(a) * len * 0.55 - Math.sin(a) * 2, sy + Math.sin(a) * len * 0.55 + Math.cos(a) * 2);
      ctx2d.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
      ctx2d.stroke();
    }
  } else if (kind === 'burning') {
    // Embers peeling upward off the projectile.
    for (let i = 0; i < 4; i++) {
      const ph = ((t * 2.2 + seed + i * 0.27) % 1);
      const ex = sx + Math.sin((seed + i) * 5 + ph * 6) * 4.5 * scale;
      const ey = sy - ph * 13 * scale;
      const a = (1 - ph) * 0.85;
      ctx2d.fillStyle = ph < 0.4 ? `rgba(255,212,140,${a})` : `rgba(255,122,31,${a})`;
      ctx2d.beginPath(); ctx2d.arc(ex, ey, (2.1 - ph * 1.4) * scale, 0, Math.PI * 2); ctx2d.fill();
    }
    ctx2d.fillStyle = 'rgba(255,122,31,0.22)';
    ctx2d.beginPath(); ctx2d.arc(sx, sy, 7 * scale, 0, Math.PI * 2); ctx2d.fill();
  } else if (kind === 'poison') {
    // Fat bubbles welling up and popping.
    for (let i = 0; i < 3; i++) {
      const ph = ((t * 1.5 + seed + i * 0.34) % 1);
      const bx = sx + Math.cos(seed * 3 + i * 2.1) * 5 * scale;
      const by = sy - ph * 10 * scale;
      const a = (1 - ph) * 0.8;
      ctx2d.fillStyle = `rgba(169,94,192,${a})`;
      ctx2d.beginPath(); ctx2d.arc(bx, by, (1.5 + ph * 2.2) * scale, 0, Math.PI * 2); ctx2d.fill();
      ctx2d.fillStyle = `rgba(230,176,245,${a * 0.8})`;
      ctx2d.beginPath(); ctx2d.arc(bx - 0.7 * scale, by - 0.7 * scale, 0.7 * scale, 0, Math.PI * 2); ctx2d.fill();
    }
    ctx2d.fillStyle = 'rgba(94,42,120,0.28)';
    ctx2d.beginPath(); ctx2d.arc(sx, sy, 7.5 * scale, 0, Math.PI * 2); ctx2d.fill();
  }
  ctx2d.restore();
}

// Screen-space visibility test. drawEnemy already culled; projectiles and effects did not,
// so forked shots scattered across the arena were paying full draw cost while off-screen.
function onScreen(sx, sy, margin) {
  return sx >= -margin && sx <= canvas.width + margin
      && sy >= -margin && sy <= canvas.height + margin;
}

// Worst-case screen reach of an effect, so wide ones (beams, novas, ground patches) aren't
// culled while part of them is still visible.
function effectReach(fx) {
  return Math.max(fx.radius || 0, fx.range || 0, fx.maxRadius || 0, fx.width || 0, 90) + 60;
}

// Bone Throw's femur is drawn twice its original length. Purely visual — the projectile's
// collision radius is unchanged, so this does not quietly widen its hitbox.
const BONE_LENGTH_MULT = 2;

function drawProjectile(p) {
  const s = worldToScreen(p.x, p.y);
  // Generous margin: arrows and bones are drawn stretched well past their own radius.
  if (!onScreen(s.x, s.y, (p.radius || 6) * 4 + 60)) return;
  // Drawn first so it sits behind the projectile art as a clinging aura.
  if (p.mods && p.mods.infusion) drawInfusionAura(s.x, s.y, p.mods.infusion, p.id % 17, p.sizeScale || 1);
  if (p.isArrow) {
    drawSpriteRotated(ctx2d, 'arrow', s.x, s.y, 9 * (p.sizeScale || 1), Math.atan2(p.vy, p.vx), 1.75);
    return;
  }
  if (p.isFlask) {
    drawGlow(s.x, s.y, '154,79,176', 13);
    ctx2d.save();
    ctx2d.translate(s.x, s.y);
    ctx2d.rotate(performance.now() / 110 + p.id);
    ctx2d.fillStyle = '#3a1a48'; ctx2d.fillRect(-2.6, -1.5, 5.2, 6.5); // glass body
    ctx2d.fillStyle = '#9a4fb0'; ctx2d.fillRect(-2, -0.5, 4, 5); // liquid
    ctx2d.fillStyle = '#c98af0'; ctx2d.fillRect(-1.6, 0.5, 1.4, 3); // shine
    ctx2d.fillStyle = '#2a1236'; ctx2d.fillRect(-1.2, -4, 2.4, 2.6); // neck
    ctx2d.fillStyle = '#7a5a3a'; ctx2d.fillRect(-1.3, -4.8, 2.6, 1); // cork
    ctx2d.restore();
    return;
  }
  if (p.isFire) {
    drawFireball(s.x, s.y, p.vx, p.vy, p.radius);
    return;
  }
  if (p.isLightning) {
    drawLightningBolt(s.x, s.y, p.vx, p.vy, p.radius);
    return;
  }
  if (p.isBone) {
    drawGlow(s.x, s.y, '230,220,190', 11);
    // A tumbling femur — knobbed at both ends, spinning end over end as it arcs.
    // Drawn FROM the collision radius rather than a separate hardcoded size: the bone spins,
    // so its swept shape is a circle of its half-length, and that is exactly p.radius. The two
    // previously had independent sizes and had drifted apart.
    const half = p.radius;          // half-length == collision radius
    const r = half / 2.1;           // the proportions below were authored against this
    ctx2d.save();
    ctx2d.translate(s.x, s.y);
    ctx2d.rotate(performance.now() / 42 + p.id);
    ctx2d.fillStyle = '#cfc4a8';
    ctx2d.fillRect(-r * 0.34, -half, r * 0.68, half * 2);     // shaft
    ctx2d.beginPath();                                        // knobbed ends
    ctx2d.arc(-r * 0.4, -half, r * 0.52, 0, Math.PI * 2);
    ctx2d.arc(r * 0.4, -half, r * 0.52, 0, Math.PI * 2);
    ctx2d.arc(-r * 0.4, half, r * 0.52, 0, Math.PI * 2);
    ctx2d.arc(r * 0.4, half, r * 0.52, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.fillStyle = '#ece2c8';                              // lit edge
    ctx2d.fillRect(-r * 0.34, -half, r * 0.24, half * 2);
    ctx2d.restore();
    return;
  }
  if (p.isIce) {
    drawGlow(s.x, s.y, '191,234,255', p.radius * 3);
    const r = p.radius;
    ctx2d.save();
    ctx2d.translate(s.x, s.y); ctx2d.rotate(Math.atan2(p.vy, p.vx));
    ctx2d.fillStyle = '#cdeeff'; // crystalline shard pointing along travel
    ctx2d.beginPath();
    ctx2d.moveTo(r * 2.1, 0); ctx2d.lineTo(0, -r * 0.85); ctx2d.lineTo(-r * 1.1, 0); ctx2d.lineTo(0, r * 0.85);
    ctx2d.closePath(); ctx2d.fill();
    ctx2d.fillStyle = 'rgba(255,255,255,0.75)';
    ctx2d.beginPath();
    ctx2d.moveTo(r * 2.1, 0); ctx2d.lineTo(0, -r * 0.35); ctx2d.lineTo(-r * 0.5, 0); ctx2d.closePath(); ctx2d.fill();
    ctx2d.restore();
    return;
  }
  drawGlow(s.x, s.y, hexToRgb(p.color || '#ffffff'), p.radius * 2.6);
  ctx2d.save();
  ctx2d.fillStyle = p.color || '#fff';
  ctx2d.beginPath(); ctx2d.arc(s.x, s.y, p.radius, 0, Math.PI * 2); ctx2d.fill();
  ctx2d.restore();
}

// Scythe: a crescent blade on a haft carving a half-circle. Distinct from the sword sweep —
// the blade is a curved arc rather than a straight bar, it trails a longer sickly-green smear,
// and the haft is drawn back through the pivot so it reads as a long-handled weapon.
function drawScytheSweep(cx, cy, dir, arc, radius, prog) {
  const startA = dir - arc / 2;
  const curA = startA + arc * prog;
  const innerR = radius * 0.14;
  const outerR = radius * 1.02;
  ctx2d.save();

  // Trailing smear from the start edge to the blade's current angle.
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, outerR, startA, curA);
  ctx2d.arc(cx, cy, innerR, curA, startA, true);
  ctx2d.closePath();
  const g = ctx2d.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
  g.addColorStop(0, 'rgba(120,160,90,0)');
  g.addColorStop(0.65, 'rgba(140,190,100,0.12)');
  g.addColorStop(1, 'rgba(205,240,170,0.30)');
  ctx2d.fillStyle = g;
  ctx2d.fill();

  // Bright leading edge riding just behind the blade.
  const fade = 1 - prog * 0.3;
  ctx2d.strokeStyle = `rgba(226,255,200,${0.85 * fade})`;
  ctx2d.lineWidth = 3.5;
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, outerR * 0.97, curA - 0.3, curA);
  ctx2d.stroke();

  const rx = Math.cos(curA), ry = Math.sin(curA);
  const px = -ry, py = rx;

  // Haft: runs from behind the pivot out to where the blade is mounted.
  const hx0 = cx - rx * innerR * 1.6, hy0 = cy - ry * innerR * 1.6;
  const hx1 = cx + rx * outerR * 0.82, hy1 = cy + ry * outerR * 0.82;
  ctx2d.strokeStyle = '#6b4f2e';
  ctx2d.lineWidth = 3.2; ctx2d.lineCap = 'round';
  ctx2d.beginPath(); ctx2d.moveTo(hx0, hy0); ctx2d.lineTo(hx1, hy1); ctx2d.stroke();
  ctx2d.strokeStyle = '#8a6a41'; ctx2d.lineWidth = 1.2;
  ctx2d.beginPath(); ctx2d.moveTo(hx0, hy0); ctx2d.lineTo(hx1, hy1); ctx2d.stroke();

  // Crescent blade: swept forward of the haft, tapering to a point at the tip.
  const sweep = 0.62;                      // how far around the arc the crescent spans
  const bladeR = outerR * 0.99;
  const a0 = curA - sweep * 0.15;          // heel, just ahead of the haft
  const a1 = curA + sweep;                 // tip, leading the swing
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, bladeR, a0, a1);       // outer cutting edge
  ctx2d.arc(cx, cy, bladeR * 0.80, a1, a0, true); // inner edge, closing the crescent
  ctx2d.closePath();
  ctx2d.fillStyle = '#cfd8e4';
  ctx2d.fill();
  // Honed edge along the outer curve.
  ctx2d.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx2d.lineWidth = 1.5;
  ctx2d.beginPath(); ctx2d.arc(cx, cy, bladeR, a0, a1); ctx2d.stroke();

  ctx2d.restore();
}

function drawSwordSlash(cx, cy, dir, arc, radius, prog) {
  // A blade sweeps from one edge of the arc to the other over the effect's life,
  // trailing a bright crescent smear behind it so it reads as a physical slash.
  const startA = dir - arc / 2;
  const curA = startA + arc * prog;
  const innerR = radius * 0.18;
  const outerR = radius * 1.02;
  ctx2d.save();

  // Swept smear behind the blade (from the start edge to the blade's current angle).
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, outerR, startA, curA);
  ctx2d.arc(cx, cy, innerR, curA, startA, true);
  ctx2d.closePath();
  const g = ctx2d.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(232,180,90,0.10)');
  g.addColorStop(1, 'rgba(255,240,210,0.28)');
  ctx2d.fillStyle = g;
  ctx2d.fill();

  // Bright leading edge just behind the blade tip.
  const fade = 1 - prog * 0.35;
  ctx2d.strokeStyle = `rgba(255,250,235,${0.85 * fade})`;
  ctx2d.lineWidth = 3;
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, outerR * 0.98, curA - 0.22, curA);
  ctx2d.stroke();

  // The blade itself, oriented along the current sweep angle.
  const rx = Math.cos(curA), ry = Math.sin(curA);
  const px = -ry, py = rx;
  const bx = cx + rx * innerR, by = cy + ry * innerR;
  const tx = cx + rx * outerR, ty = cy + ry * outerR;
  const th = 4.5;
  ctx2d.beginPath();
  ctx2d.moveTo(bx + px * th, by + py * th);
  ctx2d.lineTo(tx + px * 1.2, ty + py * 1.2);
  ctx2d.lineTo(tx - px * 1.2, ty - py * 1.2);
  ctx2d.lineTo(bx - px * th, by - py * th);
  ctx2d.closePath();
  ctx2d.fillStyle = '#d7dde8';
  ctx2d.fill();
  ctx2d.strokeStyle = 'rgba(255,255,255,0.9)'; ctx2d.lineWidth = 1.4;
  ctx2d.beginPath(); ctx2d.moveTo(bx, by); ctx2d.lineTo(tx, ty); ctx2d.stroke();
  // Crossguard near the hilt.
  const gx = cx + rx * (innerR + 3), gy = cy + ry * (innerR + 3);
  ctx2d.strokeStyle = '#8a6a2f'; ctx2d.lineWidth = 3;
  ctx2d.beginPath();
  ctx2d.moveTo(gx + px * 7, gy + py * 7);
  ctx2d.lineTo(gx - px * 7, gy - py * 7);
  ctx2d.stroke();
  ctx2d.restore();
}

// Solar Ray: a hard, straight laser rather than a wandering flame ribbon, matching its icon.
// Layered strokes build the beam from a wide outer haze to a white-hot core; the contact
// point carries a fiery sphere that throws embers while it burns.
function drawFireBeam(x1, y1, x2, y2, width, time, intensity, embers) {
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  ctx2d.lineCap = 'round';

  // Fast, shallow flicker — the beam should feel powered and steady, not fluttering.
  const I = intensity * (0.9 + 0.1 * Math.sin(time * 40));

  const beam = (w, col) => {
    ctx2d.strokeStyle = col;
    ctx2d.lineWidth = Math.max(1, w);
    ctx2d.beginPath();
    ctx2d.moveTo(x1, y1);
    ctx2d.lineTo(x2, y2);
    ctx2d.stroke();
  };
  beam(width * 1.9, `rgba(255,80,18,${0.16 * I})`);   // outer haze
  beam(width * 1.1, `rgba(255,140,40,${0.36 * I})`);  // body
  beam(width * 0.58, `rgba(255,205,110,${0.62 * I})`); // hot inner
  beam(width * 0.22, `rgba(255,252,240,${0.95 * I})`); // white core

  // Muzzle flare where it leaves the caster.
  const mz = ctx2d.createRadialGradient(x1, y1, 0, x1, y1, width * 1.1);
  mz.addColorStop(0, `rgba(255,245,215,${0.75 * I})`);
  mz.addColorStop(0.5, `rgba(255,160,50,${0.35 * I})`);
  mz.addColorStop(1, 'rgba(255,110,20,0)');
  ctx2d.fillStyle = mz;
  ctx2d.beginPath(); ctx2d.arc(x1, y1, width * 1.1, 0, Math.PI * 2); ctx2d.fill();

  // Fiery sphere at the point of contact, pulsing as it burns.
  const pulse = 1 + 0.14 * Math.sin(time * 26);
  const r = width * 1.6 * pulse;
  const sp = ctx2d.createRadialGradient(x2, y2, 0, x2, y2, r);
  sp.addColorStop(0, `rgba(255,255,250,${0.95 * I})`);
  sp.addColorStop(0.3, `rgba(255,225,140,${0.8 * I})`);
  sp.addColorStop(0.62, `rgba(255,140,40,${0.5 * I})`);
  sp.addColorStop(1, 'rgba(220,60,10,0)');
  ctx2d.fillStyle = sp;
  ctx2d.beginPath(); ctx2d.arc(x2, y2, r, 0, Math.PI * 2); ctx2d.fill();
  // A tight white core keeps the contact point reading as the hottest thing on screen.
  ctx2d.fillStyle = `rgba(255,255,245,${0.9 * I})`;
  ctx2d.beginPath(); ctx2d.arc(x2, y2, width * 0.34 * pulse, 0, Math.PI * 2); ctx2d.fill();

  // Embers flung off the contact sphere.
  if (embers) {
    for (const em of embers) {
      const k = 1 - em.t / em.life;
      const e = worldToScreen(em.x, em.y);
      ctx2d.fillStyle = k > 0.55
        ? `rgba(255,240,190,${k * I})`
        : `rgba(255,${Math.round(90 + 90 * k)},30,${k * I})`;
      ctx2d.beginPath(); ctx2d.arc(e.x, e.y, em.sz * (0.4 + 0.6 * k), 0, Math.PI * 2); ctx2d.fill();
    }
  }
  ctx2d.restore();
}

function drawEffect(fx) {
  const s = worldToScreen(fx.x, fx.y);
  // Two-point effects (beams, arcs) can have an off-screen origin and a visible far end, so
  // they're only culled when both ends are out of view.
  if (!onScreen(s.x, s.y, effectReach(fx))) {
    if (fx.tx === undefined) return;
    const b = worldToScreen(fx.tx, fx.ty);
    if (!onScreen(b.x, b.y, effectReach(fx))) return;
  }
  const life = clamp(1 - fx.t / fx.duration, 0, 1);
  if (fx.kind === 'scythe') {
    drawScytheSweep(s.x, s.y, fx.dir, fx.angle, fx.radius, clamp(fx.t / fx.duration, 0, 1));
  } else if (fx.kind === 'slash') {
    drawSwordSlash(s.x, s.y, fx.dir, fx.angle, fx.radius, clamp(fx.t / fx.duration, 0, 1));
  } else if (fx.kind === 'firebeam') {
    const b = worldToScreen(fx.tx, fx.ty);
    const fade = fx.t > fx.duration - 0.15 ? clamp((fx.duration - fx.t) / 0.15, 0, 1) : 1;
    drawFireBeam(s.x, s.y, b.x, b.y, fx.width, performance.now() / 1000, fade, fx.embers);
  } else if (fx.kind === 'ninjastars') {
    // Four-pointed steel shuriken, each spinning fast on its own axis as the ring orbits.
    const fade = fx.t > fx.duration - 0.3 ? clamp((fx.duration - fx.t) / 0.3, 0, 1) : 1;
    // Draw the faint echo tail first (oldest → newest), then the solid blade on top.
    const layers = [];
    for (let k = NINJA_ECHO_COUNT; k >= 1; k--) {
      layers.push({ t: fx.t - k * NINJA_ECHO_STEP, alpha: 0.5 - 0.11 * (k - 1), scale: 1 - 0.13 * k });
    }
    layers.push({ t: fx.t, alpha: 1, scale: 1 });
    for (const layer of layers) {
    for (const p of ninjaStarPositions(fx, layer.t)) {
      const sp = worldToScreen(p.x, p.y);
      const r = fx.starRadius * layer.scale;
      ctx2d.save();
      ctx2d.globalAlpha = fade * layer.alpha;
      ctx2d.translate(sp.x, sp.y);
      ctx2d.rotate(fx.t * 22 + p.a); // rapid individual spin
      ctx2d.fillStyle = '#c2cbd6';
      ctx2d.beginPath();
      for (let k = 0; k < 6; k++) {          // six-pointed shuriken
        const a0 = (k / 6) * Math.PI * 2;
        ctx2d.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
        const a1 = a0 + Math.PI / 6;         // inner notch between each point
        ctx2d.lineTo(Math.cos(a1) * r * 0.38, Math.sin(a1) * r * 0.38);
      }
      ctx2d.closePath(); ctx2d.fill();
      ctx2d.fillStyle = '#8a94a2';           // shaded underside
      ctx2d.beginPath(); ctx2d.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx2d.fill();
      ctx2d.fillStyle = '#2b241b';           // centre hole
      ctx2d.beginPath(); ctx2d.arc(0, 0, r * 0.13, 0, Math.PI * 2); ctx2d.fill();
      ctx2d.restore();
    }
    }
  } else if (fx.kind === 'flamethrower') {
    // Render the sprayed flame particles: each grows and cools (white → orange → red) as it
    // ages, then fades. Additive blending makes overlapping particles read as a fiery stream.
    const fade = fx.t < 0.12 ? fx.t / 0.12 : 1;
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'lighter';
    for (const p of (fx.particles || [])) {
      const lp = clamp(p.life / p.maxLife, 0, 1); // 1 fresh -> 0 dead
      const age = 1 - lp;
      const sp = worldToScreen(p.x, p.y);
      const r = p.sz * (0.6 + age * 1.7);
      const a = lp * fade;
      const g = ctx2d.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
      g.addColorStop(0, age < 0.4 ? `rgba(255,255,225,${0.55 * a})` : `rgba(255,180,70,${0.5 * a})`);
      g.addColorStop(0.5, `rgba(255,115,30,${0.4 * a})`);
      g.addColorStop(1, 'rgba(150,30,10,0)');
      ctx2d.fillStyle = g;
      ctx2d.beginPath(); ctx2d.arc(sp.x, sp.y, r, 0, Math.PI * 2); ctx2d.fill();
    }
    ctx2d.restore();
  } else if (fx.kind === 'chestBurst') {
    // Jackpot! Radiant rotating light + an opened chest + a fountain of gold coins.
    const p = clamp(fx.t / fx.duration, 0, 1);
    const glow = clamp(1 - p, 0, 1);
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'lighter';
    const rays = 12, rot = fx.t * 4.5;
    const baseLen = 30 + 8 * Math.sin(fx.t * 12);
    for (let i = 0; i < rays; i++) {
      const a = rot + (i / rays) * Math.PI * 2;
      const ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux;
      const len = baseLen * (i % 2 === 0 ? 1 : 0.6);
      ctx2d.fillStyle = `rgba(255,228,140,${0.3 * glow})`;
      ctx2d.beginPath();
      ctx2d.moveTo(s.x + px * 2.6, s.y + py * 2.6);
      ctx2d.lineTo(s.x + ux * len, s.y + uy * len);
      ctx2d.lineTo(s.x - px * 2.6, s.y - py * 2.6);
      ctx2d.closePath(); ctx2d.fill();
    }
    const rg = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, 34);
    rg.addColorStop(0, `rgba(255,240,185,${0.55 * glow})`);
    rg.addColorStop(1, 'rgba(255,220,120,0)');
    ctx2d.fillStyle = rg;
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, 34, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.globalCompositeOperation = 'source-over';
    drawOpenChest(s.x, s.y, glow);
    for (const c of fx.coins) {
      const cl = clamp(c.life / 0.9, 0, 1);
      if (cl <= 0) continue;
      const cx = s.x + c.x, cy = s.y + c.y;
      const wob = 0.3 + 0.7 * Math.abs(Math.cos(c.rot)); // fake spin — the coin edge thins
      ctx2d.save();
      ctx2d.globalAlpha = cl;
      ctx2d.fillStyle = '#e8b43c';
      ctx2d.beginPath(); ctx2d.ellipse(cx, cy, c.r * wob, c.r, 0, 0, Math.PI * 2); ctx2d.fill();
      ctx2d.fillStyle = '#f9e196';
      ctx2d.beginPath(); ctx2d.ellipse(cx - c.r * 0.15, cy - c.r * 0.2, c.r * wob * 0.5, c.r * 0.55, 0, 0, Math.PI * 2); ctx2d.fill();
      ctx2d.restore();
    }
    ctx2d.restore();
  } else if (fx.kind === 'iceShatter') {
    // A burst of tiny icy shards flung from a shattered frozen enemy (purely cosmetic).
    for (const sh of fx.shards) {
      const cl = clamp(sh.life / 0.7, 0, 1);
      if (cl <= 0) continue;
      ctx2d.save();
      ctx2d.globalAlpha = cl;
      ctx2d.translate(s.x + sh.x, s.y + sh.y); ctx2d.rotate(sh.rot);
      ctx2d.fillStyle = '#cdeeff';
      const z = sh.sz;
      ctx2d.beginPath(); ctx2d.moveTo(0, -z * 1.7); ctx2d.lineTo(z, z); ctx2d.lineTo(-z, z); ctx2d.closePath();
      ctx2d.fill();
      ctx2d.fillStyle = 'rgba(255,255,255,0.7)';
      ctx2d.beginPath(); ctx2d.moveTo(0, -z * 1.7); ctx2d.lineTo(z * 0.4, 0); ctx2d.lineTo(-z * 0.4, 0); ctx2d.closePath();
      ctx2d.fill();
      ctx2d.restore();
    }
  } else if (fx.kind === 'ring') {
    // Ice Nova: an expanding frost shockwave with a chilly fill and radiating ice shards.
    const p = 1 - life;
    const r = fx.radius * (0.4 + 0.6 * p);
    ctx2d.save();
    const g = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    g.addColorStop(0, `rgba(180,230,245,${0.18 * life})`);
    g.addColorStop(0.7, `rgba(120,180,210,${0.1 * life})`);
    g.addColorStop(1, 'rgba(120,180,210,0)');
    ctx2d.fillStyle = g;
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.strokeStyle = `rgba(120,175,205,${0.5 * life})`; ctx2d.lineWidth = 6;
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r * 0.96, 0, Math.PI * 2); ctx2d.stroke();
    ctx2d.strokeStyle = `rgba(224,246,255,${0.85 * life})`; ctx2d.lineWidth = 2.5;
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r, 0, Math.PI * 2); ctx2d.stroke();
    const shards = 10, rot = fx.t * 1.5;
    ctx2d.fillStyle = `rgba(214,242,255,${0.8 * life})`;
    for (let i = 0; i < shards; i++) {
      const a = rot + (i / shards) * Math.PI * 2;
      const ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux;
      const bx = s.x + ux * r * 0.72, by = s.y + uy * r * 0.72;
      const tx = s.x + ux * (r + 9), ty = s.y + uy * (r + 9);
      ctx2d.beginPath();
      ctx2d.moveTo(bx + px * 3, by + py * 3);
      ctx2d.lineTo(tx, ty);
      ctx2d.lineTo(bx - px * 3, by - py * 3);
      ctx2d.closePath(); ctx2d.fill();
    }
    ctx2d.restore();
  } else if (fx.kind === 'poison') {
    // Generic poison cloud: layered murky puffs that churn, with sickly bubbles rising out.
    const t = fx.t;
    ctx2d.save();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + t * 0.6;
      const wob = 0.75 + 0.2 * Math.sin(t * 3 + i);
      const px = s.x + Math.cos(a) * fx.radius * 0.5 * wob;
      const py = s.y + Math.sin(a) * fx.radius * 0.5 * wob;
      const pr = fx.radius * 0.5 * (0.8 + 0.2 * Math.sin(t * 4 + i * 1.7));
      ctx2d.fillStyle = 'rgba(74,110,40,0.15)';
      ctx2d.beginPath(); ctx2d.arc(px, py, pr, 0, Math.PI * 2); ctx2d.fill();
    }
    ctx2d.fillStyle = `rgba(90,122,46,${0.3 + 0.06 * Math.sin(t * 6)})`;
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, fx.radius * 0.72, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.fillStyle = 'rgba(140,180,70,0.12)';
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, fx.radius * 0.4, 0, Math.PI * 2); ctx2d.fill();
    for (let i = 0; i < 5; i++) {
      const bt = (t * 0.9 + i * 0.37) % 1;
      const bx = s.x + Math.sin(i * 2.1 + t) * fx.radius * 0.5;
      const by = s.y + fx.radius * 0.4 - bt * fx.radius * 0.9;
      ctx2d.fillStyle = `rgba(170,210,90,${0.5 * (1 - bt)})`;
      ctx2d.beginPath(); ctx2d.arc(bx, by, 1.6 + bt * 1.5, 0, Math.PI * 2); ctx2d.fill();
    }
    ctx2d.restore();
  } else if (fx.kind === 'infusionHit') {
    // Element-specific impact burst. Each one uses a different shape language so the
    // infusion is identifiable from the hit alone.
    const v = INFUSION_VIS[fx.infusion];
    if (v) {
      const pr = clamp(fx.t / fx.duration, 0, 1);
      const a = 1 - pr;
      const R = (fx.radius || 12) * 1.5;
      ctx2d.save();
      ctx2d.globalCompositeOperation = 'lighter';
      if (fx.infusion === 'frost') {
        // Angular shards spiking outward, plus a rime ring.
        ctx2d.strokeStyle = `rgba(234,249,255,${a})`;
        ctx2d.lineWidth = 1.6;
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2 + fx.seed;
          const len = R * (0.5 + pr * 0.9);
          ctx2d.beginPath();
          ctx2d.moveTo(s.x + Math.cos(ang) * R * 0.2, s.y + Math.sin(ang) * R * 0.2);
          ctx2d.lineTo(s.x + Math.cos(ang) * len, s.y + Math.sin(ang) * len);
          ctx2d.stroke();
        }
        ctx2d.strokeStyle = `rgba(127,212,242,${a * 0.7})`;
        ctx2d.beginPath(); ctx2d.arc(s.x, s.y, R * (0.35 + pr * 0.75), 0, Math.PI * 2); ctx2d.stroke();
      } else if (fx.infusion === 'shock') {
        // A jagged multi-pointed flash that stutters rather than expands smoothly.
        ctx2d.strokeStyle = `rgba(90,200,240,${a})`;
        ctx2d.lineWidth = 2;
        const pts = 5;
        ctx2d.beginPath();
        for (let i = 0; i <= pts * 2; i++) {
          const ang = (i / (pts * 2)) * Math.PI * 2 + fx.seed;
          const rr = R * (i % 2 ? 0.35 : 1.0) * (0.6 + pr * 0.7);
          i ? ctx2d.lineTo(s.x + Math.cos(ang) * rr, s.y + Math.sin(ang) * rr)
            : ctx2d.moveTo(s.x + Math.cos(ang) * rr, s.y + Math.sin(ang) * rr);
        }
        ctx2d.closePath(); ctx2d.stroke();
      } else if (fx.infusion === 'burning') {
        // Embers thrown upward off the impact.
        for (let i = 0; i < 7; i++) {
          const ang = -Math.PI / 2 + (i / 6 - 0.5) * 2.0 + fx.seed * 0.1;
          const d2 = R * pr * (0.8 + (i % 3) * 0.35);
          const ex = s.x + Math.cos(ang) * d2;
          const ey = s.y + Math.sin(ang) * d2 - pr * R * 0.5;
          ctx2d.fillStyle = pr < 0.45 ? `rgba(255,212,140,${a})` : `rgba(255,122,31,${a})`;
          ctx2d.beginPath(); ctx2d.arc(ex, ey, 2.6 * (1 - pr * 0.6), 0, Math.PI * 2); ctx2d.fill();
        }
      } else if (fx.infusion === 'poison') {
        // A wet splat that swells and sags, with bubbles rising off it.
        ctx2d.fillStyle = `rgba(169,94,192,${a * 0.5})`;
        ctx2d.beginPath();
        ctx2d.ellipse(s.x, s.y + R * 0.2, R * (0.4 + pr * 0.8), R * (0.25 + pr * 0.45), 0, 0, Math.PI * 2);
        ctx2d.fill();
        for (let i = 0; i < 4; i++) {
          const bx = s.x + Math.cos(fx.seed + i * 1.7) * R * 0.6;
          const by = s.y - pr * R * 0.9 - i * 1.5;
          ctx2d.fillStyle = `rgba(230,176,245,${a * 0.85})`;
          ctx2d.beginPath(); ctx2d.arc(bx, by, 1.5 + (1 - pr) * 1.4, 0, Math.PI * 2); ctx2d.fill();
        }
      }
      ctx2d.restore();
    }
  } else if (fx.kind === 'shockArc') {
    // Brief crackle between an infused hit and the foe it arcs to.
    const b = worldToScreen(fx.tx, fx.ty);
    ctx2d.save();
    ctx2d.globalAlpha = clamp(1 - fx.t / fx.duration, 0, 1);
    drawElectroArc(s.x, s.y, b.x, b.y);
    ctx2d.restore();
  } else if (fx.kind === 'poisonBurst') {
    // A poisoned corpse ruptures — a quick expanding puff of violet spores.
    const p = clamp(fx.t / fx.duration, 0, 1);
    const rr = fx.radius * (0.3 + 0.9 * p);
    const a = 1 - p;
    ctx2d.save();
    const g = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr);
    g.addColorStop(0, `rgba(190,110,225,${0.42 * a})`);
    g.addColorStop(0.6, `rgba(140,50,185,${0.26 * a})`);
    g.addColorStop(1, 'rgba(110,30,150,0)');
    ctx2d.fillStyle = g;
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, rr, 0, Math.PI * 2); ctx2d.fill();
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2 + fx.t * 2;
      const px = s.x + Math.cos(ang) * rr * 0.8, py = s.y + Math.sin(ang) * rr * 0.5;
      ctx2d.fillStyle = `rgba(205,140,240,${0.5 * a})`;
      ctx2d.beginPath(); ctx2d.arc(px, py, 2 + p * 2, 0, Math.PI * 2); ctx2d.fill();
    }
    ctx2d.restore();
  } else if (fx.kind === 'poisonPuddle') {
    // A flattened, bubbling pool of violet poison on the ground.
    const t = fx.t;
    const fade = fx.t > fx.duration - 0.4 ? clamp((fx.duration - fx.t) / 0.4, 0, 1) : Math.min(1, fx.t / 0.2);
    ctx2d.save();
    ctx2d.translate(s.x, s.y); ctx2d.scale(1, 0.5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + t * 0.5;
      const wob = 0.7 + 0.2 * Math.sin(t * 3 + i);
      const px = Math.cos(a) * fx.radius * 0.5 * wob, py = Math.sin(a) * fx.radius * 0.5 * wob;
      const pr = fx.radius * 0.5 * (0.8 + 0.2 * Math.sin(t * 4 + i * 1.7));
      ctx2d.fillStyle = `rgba(90,42,112,${0.3 * fade})`;
      ctx2d.beginPath(); ctx2d.arc(px, py, pr, 0, Math.PI * 2); ctx2d.fill();
    }
    ctx2d.fillStyle = `rgba(122,63,140,${0.42 * fade})`;
    ctx2d.beginPath(); ctx2d.arc(0, 0, fx.radius * 0.68, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.restore();
    for (let i = 0; i < 5; i++) {
      const bt = (t * 0.8 + i * 0.4) % 1;
      const bx = s.x + Math.sin(i * 2.3 + t) * fx.radius * 0.42;
      ctx2d.fillStyle = `rgba(190,130,220,${0.55 * (1 - bt) * fade})`;
      ctx2d.beginPath(); ctx2d.arc(bx, s.y - bt * 7, 1.4 + bt * 1.5, 0, Math.PI * 2); ctx2d.fill();
    }
  } else if (fx.kind === 'burningGround') {
    // A scorched patch licked by flickering flame with drifting embers.
    const t = fx.t;
    const grow = 1 + 1 * clamp(fx.t / fx.duration, 0, 1); // patch widens up to +100% over its life
    const fade = fx.t > fx.duration - 0.5 ? clamp((fx.duration - fx.t) / 0.5, 0, 1) : Math.min(1, fx.t / 0.3);
    ctx2d.save();
    ctx2d.translate(s.x, s.y); ctx2d.scale(1, 0.5);
    ctx2d.fillStyle = `rgba(30,14,6,${0.45 * fade})`;
    ctx2d.beginPath(); ctx2d.arc(0, 0, fx.radius * 0.85 * grow, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.restore();
    // Each patch generates its own random flame + ember layout once, so no two burning
    // patches share the same arrangement (kept on the effect so it stays stable per patch).
    if (!fx.flames) {
      fx.flames = [];
      const n = 6 + Math.floor(Math.random() * 3); // 6–8 flames
      for (let i = 0; i < n; i++) {
        fx.flames.push({
          a: Math.random() * Math.PI * 2,
          fr: fx.radius * (0.15 + 0.6 * Math.random()),
          phase: Math.random() * Math.PI * 2,
          size: 0.7 + Math.random() * 0.7,
        });
      }
      fx.embers = [];
      const en = 3 + Math.floor(Math.random() * 3); // 3–5 embers
      for (let i = 0; i < en; i++) {
        fx.embers.push({ ox: (Math.random() * 2 - 1) * fx.radius * 0.55, sway: Math.random() * Math.PI * 2, spd: 1.0 + Math.random() * 0.8, phase: Math.random() });
      }
    }
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'lighter';
    for (const fl of fx.flames) {
      const fxp = s.x + Math.cos(fl.a) * fl.fr * grow, fyp = s.y + Math.sin(fl.a) * fl.fr * grow * 0.5;
      const flick = 0.6 + 0.4 * Math.sin(t * 10 + fl.phase);
      const h = (6 + 9 * flick) * fade * fl.size;
      const grad = ctx2d.createRadialGradient(fxp, fyp - h * 0.4, 0, fxp, fyp - h * 0.4, h);
      grad.addColorStop(0, 'rgba(255,240,180,0.55)');
      grad.addColorStop(0.4, 'rgba(240,120,40,0.4)');
      grad.addColorStop(1, 'rgba(200,40,20,0)');
      ctx2d.fillStyle = grad;
      ctx2d.beginPath(); ctx2d.ellipse(fxp, fyp - h * 0.4, h * 0.5, h * 0.85, 0, 0, Math.PI * 2); ctx2d.fill();
    }
    for (const em of fx.embers) {
      const et = (t * em.spd + em.phase) % 1;
      const ex = s.x + em.ox * grow + Math.sin(em.sway + t) * fx.radius * 0.18 * grow;
      ctx2d.fillStyle = `rgba(255,180,80,${0.7 * (1 - et) * fade})`;
      ctx2d.beginPath(); ctx2d.arc(ex, s.y - et * 15, 1 + et, 0, Math.PI * 2); ctx2d.fill();
    }
    ctx2d.restore();
  } else if (fx.kind === 'frostGround') {
    // A soft, round rimed patch of ice whose edges feather out into the ground, dusted
    // with frost crystals.
    const fadeIn = fx.t > fx.duration - 0.5 ? clamp((fx.duration - fx.t) / 0.5, 0, 1) : Math.min(1, fx.t / 0.3);
    const fade = fadeIn * frostStackDim;
    ctx2d.save();
    const g = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, fx.radius);
    g.addColorStop(0, `rgba(200,235,250,${0.24 * fade})`);
    g.addColorStop(0.4, `rgba(165,208,232,${0.15 * fade})`);
    g.addColorStop(0.72, `rgba(140,190,220,${0.07 * fade})`);
    g.addColorStop(1, 'rgba(120,170,210,0)'); // fully transparent rim so it blends into the floor
    ctx2d.fillStyle = g;
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, fx.radius, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.restore();
    if (!fx.crystals) {
      fx.crystals = [];
      const n = 14 + Math.floor(Math.random() * 8); // doubled snowflake count
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, rr = fx.radius * (0.15 + 0.75 * Math.random());
        fx.crystals.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, sz: 2 + Math.random() * 3, rot: Math.random() * Math.PI });
      }
    }
    ctx2d.save();
    ctx2d.strokeStyle = `rgba(225,245,255,${0.45 * fade})`; ctx2d.lineWidth = 1.4;
    for (const c of fx.crystals) {
      const cx = s.x + c.x, cy = s.y + c.y;
      for (let k = 0; k < 3; k++) {
        const a = c.rot + k * (Math.PI / 3);
        ctx2d.beginPath();
        ctx2d.moveTo(cx - Math.cos(a) * c.sz, cy - Math.sin(a) * c.sz);
        ctx2d.lineTo(cx + Math.cos(a) * c.sz, cy + Math.sin(a) * c.sz);
        ctx2d.stroke();
      }
    }
    ctx2d.restore();
  } else if (fx.kind === 'electroField') {
    // One crackling arc to each tethered foe, plus its chained links.
    const targets = fx.targets || [];
    for (let i = 0; i < targets.length; i++) {
      const tp = worldToScreen(targets[i].x, targets[i].y);
      drawElectroArc(s.x, s.y, tp.x, tp.y);
      // Every branch restarts from the tethered foe, so forks read as a splitting tree.
      const paths = (fx.links && fx.links[i]) || [];
      for (const pts of paths) {
        let px = targets[i].x, py = targets[i].y;
        for (const cp of pts) {
          const p1 = worldToScreen(px, py), p2 = worldToScreen(cp.x, cp.y);
          drawElectroArc(p1.x, p1.y, p2.x, p2.y);
          px = cp.x; py = cp.y;
        }
      }
    }
  } else if (fx.kind === 'explosion') {
    // Fireball detonation: white flash -> billowing fireball, a shockwave ring,
    // radial ember shrapnel, and a lingering smoke puff.
    const p = clamp(fx.t / fx.duration, 0, 1);
    const r = fx.radius, a = 1 - p;
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'lighter';
    const er = r * (0.35 + 0.85 * p);
    const g1 = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, er);
    g1.addColorStop(0, `rgba(255,244,200,${0.85 * a})`);
    g1.addColorStop(0.4, `rgba(255,150,50,${0.7 * a})`);
    g1.addColorStop(0.8, `rgba(210,60,20,${0.4 * a})`);
    g1.addColorStop(1, 'rgba(120,20,10,0)');
    ctx2d.fillStyle = g1;
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, er, 0, Math.PI * 2); ctx2d.fill();
    if (p < 0.4) {
      ctx2d.fillStyle = `rgba(255,255,242,${(1 - p / 0.4) * 0.9})`;
      ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r * 0.5 * (1 - p), 0, Math.PI * 2); ctx2d.fill();
    }
    const emb = 11;
    for (let i = 0; i < emb; i++) {
      const ang = fx.seed + (i / emb) * Math.PI * 2;
      const d = r * (0.2 + p);
      const ex = s.x + Math.cos(ang) * d, ey = s.y + Math.sin(ang) * d;
      ctx2d.fillStyle = `rgba(255,${160 + ((i * 43) % 70)},60,${a})`;
      ctx2d.beginPath(); ctx2d.arc(ex, ey, 2.4 * (1 - p) + 0.6, 0, Math.PI * 2); ctx2d.fill();
    }
    ctx2d.globalCompositeOperation = 'source-over';
    ctx2d.strokeStyle = `rgba(255,205,130,${0.6 * a})`;
    ctx2d.lineWidth = 3 * (1 - p);
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r * (0.4 + 1.05 * p), 0, Math.PI * 2); ctx2d.stroke();
    if (p > 0.3) {
      ctx2d.fillStyle = `rgba(30,18,12,${0.22 * (p - 0.3)})`;
      ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r * 0.62 * p, 0, Math.PI * 2); ctx2d.fill();
    }
    ctx2d.restore();
  }
}

function drawElectroArc(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const perpX = -dy / len, perpY = dx / len;
  // Shorter segments + alternating offsets give a proper crackling zig-zag instead of a
  // near-straight beam. Widths are +15% over the original 3 / 1.3.
  const segs = Math.max(5, Math.floor(len / 11));
  const pts = zigzagPolyline(x1, y1, x2, y2, segs, 7, perpX, perpY);
  ctx2d.save();
  ctx2d.lineCap = 'round'; // no shadowBlur: the bloom pass already haloes bright strokes
  ctx2d.strokeStyle = 'rgba(120,200,255,0.5)'; ctx2d.lineWidth = 3.45; strokePolyline(pts);
  ctx2d.strokeStyle = '#eaf7ff'; ctx2d.lineWidth = 1.5; strokePolyline(pts);
  ctx2d.fillStyle = 'rgba(180,230,255,0.85)';
  ctx2d.beginPath(); ctx2d.arc(x2, y2, 2.4, 0, Math.PI * 2); ctx2d.fill();
  ctx2d.restore();
}

function drawBlood(b) {
  const s = worldToScreen(b.x, b.y);
  ctx2d.save();
  ctx2d.translate(s.x, s.y); ctx2d.rotate(b.rot);
  ctx2d.beginPath();
  b.points.forEach((p, i) => { if (i === 0) ctx2d.moveTo(p.x, p.y); else ctx2d.lineTo(p.x, p.y); });
  ctx2d.closePath();
  ctx2d.fillStyle = 'rgba(58,10,8,0.55)';
  ctx2d.fill();
  ctx2d.restore();
}

// An opened treasure chest (lid hinged back, glowing interior) — used by the chestBurst effect.
function drawOpenChest(x, y, glow) {
  ctx2d.save();
  ctx2d.translate(x, y);
  ctx2d.scale(3, 3);
  ctx2d.fillStyle = '#6b4326'; ctx2d.fillRect(-9, -1, 18, 8);            // body
  ctx2d.fillStyle = '#5a381f'; ctx2d.fillRect(-9, 2, 18, 1.4);          // plank shade
  ctx2d.fillStyle = '#33333d'; ctx2d.fillRect(-7.5, -1, 2.2, 8); ctx2d.fillRect(5.3, -1, 2.2, 8); // bands
  ctx2d.fillStyle = '#e0b34a'; ctx2d.fillRect(-2.4, 1.4, 4.8, 4);       // lock plate on front
  ctx2d.fillStyle = `rgba(255,236,150,${0.6 + 0.4 * glow})`;            // glowing open interior
  ctx2d.fillRect(-7.5, -2.6, 15, 2.8);
  ctx2d.save();                                                        // opened lid, hinged back
  ctx2d.translate(-8, -1.5);
  ctx2d.rotate(-0.9);
  ctx2d.fillStyle = '#7d5030';
  ctx2d.beginPath();
  ctx2d.moveTo(0, 0); ctx2d.lineTo(0, -4);
  ctx2d.quadraticCurveTo(9, -11, 18, -4); ctx2d.lineTo(18, 0); ctx2d.closePath(); ctx2d.fill();
  ctx2d.fillStyle = '#33333d'; ctx2d.fillRect(1.5, -4, 2.2, 4); ctx2d.fillRect(14.3, -4, 2.2, 4);
  ctx2d.restore();
  ctx2d.restore();
}

function drawPickup(pk) {
  const s = worldToScreen(pk.x, pk.y);
  if (pk.kind === 'xp') {
    ctx2d.save();
    ctx2d.shadowColor = '#3d6b8a'; ctx2d.shadowBlur = 7;
    ctx2d.fillStyle = '#4a86a8';
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, pk.radius, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.restore();
  } else if (pk.kind === 'gold') {
    ctx2d.save();
    ctx2d.shadowColor = '#d9a545'; ctx2d.shadowBlur = 8;
    ctx2d.fillStyle = '#d9a545';
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, pk.radius, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.fillStyle = '#f0d68a';
    ctx2d.beginPath(); ctx2d.arc(s.x - pk.radius * 0.28, s.y - pk.radius * 0.28, pk.radius * 0.4, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.restore();
  } else if (pk.kind === 'health') {
    // A little red potion flask, gently bobbing — drawn 50% larger than its base art.
    const bob = Math.sin(performance.now() / 260 + pk.id) * 1.5;
    ctx2d.save();
    ctx2d.translate(s.x, s.y + bob);
    ctx2d.scale(1.5, 1.5);
    ctx2d.shadowColor = '#e0384a'; ctx2d.shadowBlur = 8;
    ctx2d.fillStyle = '#3a1418'; ctx2d.fillRect(-4, -3, 8, 9);      // glass body
    ctx2d.fillStyle = '#d63340'; ctx2d.fillRect(-3, -1, 6, 7);      // red liquid
    ctx2d.fillStyle = '#f26b74'; ctx2d.fillRect(-2.4, 0, 1.6, 5);   // shine
    ctx2d.fillStyle = '#f0e2c0'; ctx2d.fillRect(-2, -6, 4, 3);      // neck
    ctx2d.fillStyle = '#7a5a3a'; ctx2d.fillRect(-2.2, -7.5, 4.4, 1.6); // cork
    ctx2d.restore();
  } else if (pk.kind === 'chest') {
    // A locked wooden treasure chest with iron bands and a gold lock, warmly glinting.
    const bob = Math.sin(performance.now() / 320 + pk.id) * 1.1;
    ctx2d.save();
    ctx2d.translate(s.x, s.y + bob);
    ctx2d.scale(3, 3); // treasure chests render 3x their base art
    ctx2d.shadowColor = 'rgba(230,190,90,0.55)'; ctx2d.shadowBlur = 11;
    ctx2d.fillStyle = '#4a2f19'; ctx2d.fillRect(-10, 6, 20, 2);           // ground shadow lip
    ctx2d.fillStyle = '#6b4326'; ctx2d.fillRect(-9, -1, 18, 8);           // wood body
    ctx2d.fillStyle = '#5a381f'; ctx2d.fillRect(-9, 2, 18, 1.4);          // plank shade
    ctx2d.fillStyle = '#7d5030';                                          // rounded lid
    ctx2d.beginPath();
    ctx2d.moveTo(-9, -1); ctx2d.lineTo(-9, -5);
    ctx2d.quadraticCurveTo(0, -12, 9, -5); ctx2d.lineTo(9, -1); ctx2d.closePath(); ctx2d.fill();
    ctx2d.fillStyle = 'rgba(240,210,150,0.35)';                           // lid highlight
    ctx2d.beginPath(); ctx2d.moveTo(-7, -5); ctx2d.quadraticCurveTo(0, -10.5, 7, -5); ctx2d.lineTo(6, -4); ctx2d.quadraticCurveTo(0, -8.6, -6, -4); ctx2d.closePath(); ctx2d.fill();
    ctx2d.fillStyle = '#33333d';                                         // iron bands
    ctx2d.fillRect(-7.5, -6.5, 2.2, 13); ctx2d.fillRect(5.3, -6.5, 2.2, 13);
    ctx2d.fillStyle = '#3a3a44'; ctx2d.fillRect(-9, -1.6, 18, 2.2);       // rim between lid and body
    ctx2d.fillStyle = '#e0b34a'; ctx2d.fillRect(-2.4, -1.4, 4.8, 5.2);    // gold lock plate
    ctx2d.fillStyle = '#8a6a1e'; ctx2d.fillRect(-2.4, -1.4, 4.8, 1);      // lock top shade
    ctx2d.fillStyle = '#2a2018';                                         // keyhole
    ctx2d.beginPath(); ctx2d.arc(0, 0.6, 0.9, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.fillRect(-0.5, 0.6, 1, 2.2);
    ctx2d.restore();
  } else if (pk.kind === 'key') {
    // A small silver fantasy key, bobbing with a bright glint.
    const bob = Math.sin(performance.now() / 240 + pk.id) * 1.4;
    ctx2d.save();
    ctx2d.translate(s.x, s.y + bob);
    ctx2d.scale(2, 2); // silver keys render 2x their base art
    ctx2d.rotate(-0.5);
    ctx2d.shadowColor = 'rgba(210,220,235,0.65)'; ctx2d.shadowBlur = 7;
    ctx2d.fillStyle = '#c3c9d4';
    ctx2d.beginPath(); ctx2d.arc(0, -5, 3.4, 0, Math.PI * 2); ctx2d.fill();   // bow ring
    ctx2d.fillStyle = '#2a2e38';
    ctx2d.beginPath(); ctx2d.arc(0, -5, 1.4, 0, Math.PI * 2); ctx2d.fill();   // ring hole
    ctx2d.fillStyle = '#c3c9d4';
    ctx2d.fillRect(-0.9, -2.4, 1.8, 8);                                       // shaft
    ctx2d.fillRect(0.9, 3.4, 3, 1.6);                                         // tooth 1
    ctx2d.fillRect(0.9, 5.6, 2, 1.6);                                         // tooth 2
    ctx2d.fillStyle = '#eef2f8';                                             // highlights
    ctx2d.fillRect(-0.6, -1.8, 0.7, 6);
    ctx2d.beginPath(); ctx2d.arc(-1, -6, 1, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.restore();
  }
}

function drawDamageNumber(d) {
  const s = worldToScreen(d.x, d.y);
  ctx2d.globalAlpha = clamp(1 - d.t / d.life, 0, 1);
  ctx2d.fillStyle = d.color;
  ctx2d.font = d.isCrit ? 'bold 18px Cinzel, serif' : '13px Cinzel, serif';
  ctx2d.textAlign = 'center';
  ctx2d.fillText(d.text, s.x, s.y, 200);
  ctx2d.globalAlpha = 1;
}

function drawPauseDim() {
  ctx2d.fillStyle = 'rgba(0,0,0,0.55)';
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);
}

function startClassSelect() {
  state = 'START';
  ui.hideMainMenu();
  ui.showClassSelect(CLASSES, (classDef) => {
    resetGame(classDef);
    ui.hideClassSelect();
    state = 'PLAYING';
  }, drawClassPortrait);
}

// ---------- Sandbox mode ----------
// A run with the director switched off: no wave spawner, no boss clock, no stage advance.
// Whatever the player places is the entire scenario, which is what makes it useful for
// measuring one skill against a known, unchanging load.
const freshSandboxCfg = () => ({
  classId: null, // chosen at class select, swappable later from the pause menu
  stage: 0,     // index into STAGES — sets the arena the scenario is staged in
  godMode: false,
  skills: {},   // id -> level (1..5)
  tomes: {},    // id -> level (0..20)
  enemy: { id: null, count: 50, aggressive: true, line: false, infiniteHp: false, spacing: 1 },
});
// Rebuilt on every entry rather than kept: a scenario left over from a previous test would
// quietly contaminate the next one, which is exactly what a measuring tool must not do.
let sandboxCfg = freshSandboxCfg();
// True while the setup screen is open OVER a running sandbox (reached from the pause menu)
// rather than before one starts. It decides whether Begin starts a fresh scenario or
// applies to the live one, and where Back returns to.
let sandboxLive = false;
// A physical respawn pad standing in the arena, sandbox only. Sits SOUTH of the player's start
// and clear of it: spawning in must not trigger it, and enemies are placed to the north, so
// putting the pad opposite them keeps it out of the formation entirely.
const SANDBOX_BUTTON = { x: 0, y: 120, radius: 46 };
let sandboxButton = null;

// Opened from the pause menu, over a sandbox already in progress.
function openSandboxFromPause() {
  sandboxLive = true;
  ui.hidePauseMenu();
  showSandboxSetup();
}

// Apply the edited scenario to the run in progress and drop straight back into it. Enemies are
// re-placed from the current config so the field always matches what the screen says.
function applySandboxLive() {
  ui.hideSandbox();
  player.godMode = sandboxCfg.godMode;
  applySandboxLoadout();
  currentStage = clamp(sandboxCfg.stage, 0, STAGES.length - 1);
  floorPattern = makeFloorPattern(STAGES[currentStage]);
  scatterDecor(STAGES[currentStage]);
  playMusic(`stage${currentStage + 1}`); // follow the stage into its own playlist
  enemies = [];
  spawnSandboxEnemies();
  sandboxButton = { ...SANDBOX_BUTTON, armed: true };
  sandboxLive = false;
  state = 'PLAYING';
}

function closeSandboxLive() {
  ui.hideSandbox();
  sandboxLive = false;
  openPause();
}

// Straight into the setup screen — no class select on the way. The setup screen has its own
// Character grid, so routing through the carousel first asked the same question twice and put
// a step between the button and the thing it opens.
function openSandbox() {
  sandboxLive = false;
  sandboxCfg = freshSandboxCfg();
  sandboxCfg.classId = CLASSES[0].id; // a sensible default; changeable in the grid
  ui.hideMainMenu();
  showSandboxSetup();
}

// The class def the scenario is currently set to, falling back to the first if the stored id
// ever goes stale (a class being renamed or removed, say).
function sandboxClassDef() {
  return CLASSES.find((c) => c.id === sandboxCfg.classId) || CLASSES[0];
}

function showSandboxSetup() {
  state = 'SANDBOX';
  ui.showSandbox(sandboxCfg, {
    // Skill defs are keyed by id but do not carry it as a field, so it has to be attached
    // here — the picker writes cfg entries by id and would otherwise key them all 'undefined'.
    classes: CLASSES,
    stages: STAGES,
    live: sandboxLive,
    skills: SKILL_ORDER.map((id) => ({ id, ...SKILLS[id] })),
    tomes: SUPPORT_ORDER.map((id) => ({ id, ...SUPPORTS[id] })),
    enemies: sandboxEnemyList(),
  }, {
    // Applies immediately as well as at launch, so it can be flipped for a run already up.
    onPickClass: (id) => {
      sandboxCfg.classId = id;
      // Mid-run: rebuild the body in place. Position is preserved so the scenario around
      // the player is untouched — only who is standing in it changes.
      if (player && sandboxMode) {
        const at = { x: player.x, y: player.y };
        player = createPlayer(CLASSES.find((c) => c.id === id));
        player.x = at.x; player.y = at.y;
        player.godMode = sandboxCfg.godMode;
        applySandboxLoadout();
      }
      showSandboxSetup();
    },
    onPickStage: (i) => { sandboxCfg.stage = i; showSandboxSetup(); },
    onToggleGod: () => { sandboxCfg.godMode = !sandboxCfg.godMode; if (player) player.godMode = sandboxCfg.godMode; showSandboxSetup(); },
    onToggleSkill: (id) => { sandboxCfg.skills[id] ? delete sandboxCfg.skills[id] : sandboxCfg.skills[id] = 1; showSandboxSetup(); },
    onSetSkillLevel: (id, lvl) => { if (lvl <= 0) delete sandboxCfg.skills[id]; else sandboxCfg.skills[id] = lvl; showSandboxSetup(); },
    onToggleTome: (id) => { sandboxCfg.tomes[id] ? delete sandboxCfg.tomes[id] : sandboxCfg.tomes[id] = 1; showSandboxSetup(); },
    // Level changes come from a slider dragged continuously, so this must NOT rebuild the
    // screen — doing so would destroy the input mid-drag and drop the pointer capture.
    onSetTomeLevel: (id, lvl) => {
      if (lvl <= 0) delete sandboxCfg.tomes[id]; else sandboxCfg.tomes[id] = lvl;
      if (player) applySandboxLoadout(); // live retune while a sandbox run is up
      const cell = document.querySelectorAll('#sandboxBody .sandboxSection')[1];
      if (cell) {
        const idx = SUPPORT_ORDER.indexOf(id);
        const val = cell.querySelectorAll('.sandboxSliderVal')[idx];
        if (val) val.textContent = `Lv ${lvl}`;
      }
    },
    onPickEnemy: (id) => { sandboxCfg.enemy.id = sandboxCfg.enemy.id === id ? null : id; showSandboxSetup(); },
    onEnemyOpt: (key, v) => {
      sandboxCfg.enemy[key] = v;
      if (key === 'count' || key === 'spacing') {
        // Slider drags must not rebuild the screen — that would destroy the input mid-drag.
        const vals = document.querySelectorAll('.sandboxEnemyOpts .sandboxSliderVal');
        if (key === 'count' && vals[0]) vals[0].textContent = String(v);
        if (key === 'spacing' && vals[1]) vals[1].textContent = `${(+v).toFixed(1)}x`;
      } else showSandboxSetup();
    },
    paintClass: (cv, id) => drawEnemyPortrait(cv, id, CLASSES.find((c) => c.id === id).color),
    paintEnemy: (cv, id) => paintEnemyPortrait(cv, id),
  });
}

// Everything with a sprite that can actually be fought, boss art included.
function sandboxEnemyList() {
  return ENEMY_ORDER.concat(DESERT_ENEMY_ORDER, UNDERWORLD_ENEMY_ORDER)
    .filter((id, i, a) => a.indexOf(id) === i)
    .map((id) => ({ id, name: ENEMY_TYPES[id].name }));
}

function closeSandbox() { ui.hideSandbox(); showMainMenu(); }

// Applies the configured skills and tomes onto the live player, replacing whatever is there.
// Called at run start and again whenever a tome slider moves mid-run.
function applySandboxLoadout() {
  player.activeSkills = Object.entries(sandboxCfg.skills).map(([id, level]) => ({ id, level, cd: 0 }));
  player.supports = { ...sandboxCfg.tomes };
  // Caps exist to force choices in a real run; in the sandbox they would only get in the way.
  player.skillCap = Math.max(player.activeSkills.length, 99);
  player.supportCap = 99;
}

function startSandboxRun() {
  ui.hideSandbox();
  resetGame(sandboxClassDef());
  sandboxMode = true;
  // resetGame always starts at stage 0; switch to the chosen one and rebuild the arena from
  // its definition so the floor art, lighting, boundary AND set-dressing all match. Missing
  // the re-scatter left the graveyard's tombstones and crosses standing in the desert.
  currentStage = clamp(sandboxCfg.stage, 0, STAGES.length - 1);
  floorPattern = makeFloorPattern(STAGES[currentStage]);
  scatterDecor(STAGES[currentStage]);
  // resetGame started stage 1's music; switch to the chosen stage's playlist.
  playMusic(`stage${currentStage + 1}`);
  player.godMode = sandboxCfg.godMode;
  applySandboxLoadout();
  spawnSandboxEnemies();
  sandboxButton = { ...SANDBOX_BUTTON, armed: true };
  state = 'PLAYING';
}

// Places the chosen enemy set in a block or a rank, centred ahead of the player so the whole
// formation is on screen at once rather than scattered around the arena.
function spawnSandboxEnemies() {
  const cfg = sandboxCfg.enemy;
  if (!cfg.id) return;
  const type = ENEMY_TYPES[cfg.id];
  const n = Math.max(1, Math.min(500, cfg.count));
  // One step value drives BOTH axes, so a grid stays square regardless of the sprite's own
  // proportions — a wide jackal and a tall zombie lay out on the same lattice.
  const step = Math.max(28, type.radius * 2.4) * (cfg.spacing || 1);
  const cols = cfg.line ? n : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const originX = player.x - ((cols - 1) * step) / 2;
  const originY = player.y - 260 - ((rows - 1) * step) / 2;
  const lim = ARENA_RADIUS - 40;
  for (let i = 0; i < n; i++) {
    const cx = i % cols, cy = Math.floor(i / cols);
    const hp = cfg.infiniteHp ? Infinity : type.hp;
    enemies.push({
      ...type, id: nextId++, spriteId: cfg.id,
      x: clamp(originX + cx * step, -lim, lim),
      y: clamp(originY + cy * step, -lim, lim),
      hp, maxHp: cfg.infiniteHp ? Infinity : hp,
      dead: false, hitCd: 0,
      sandboxPassive: !cfg.aggressive, // stands its ground instead of hunting
      invulnerable: cfg.infiniteHp,
    });
  }
}

// Small leaderboard portrait for a recorded run. Entries saved before classId existed only
// carry the display name, so fall back to matching that against the roster.
function drawRunPortrait(canvas, entry) {
  const cls = CLASSES.find((c) => c.id === entry.classId)
    || CLASSES.find((c) => c.name === entry.className);
  if (!cls) return;
  paintPortrait(canvas, () => {
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, H * 0.55, 2, W / 2, H * 0.55, W * 0.8);
    glow.addColorStop(0, `${cls.color}55`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    drawPortraitBust(g, cls.id, W, H);
  }, cls.id, spriteHasFacing(cls.id, 'front') ? 'front' : 'side');
}

// Paints a class's sprite into its select-screen portrait: a warm floor pool, a soft accent
// glow behind the figure, then the character standing front-on toward the viewer.
// Animated square portrait for the sandbox enemy grid. Reuses the live-portrait ticker, so
// each tile plays its own walk/flap cycle instead of showing a frozen pose.
function drawEnemyPortrait(canvas, spriteId, tintOverride) {
  const type = ENEMY_TYPES[spriteId] || { color: tintOverride || '#c9bfa8' };
  paintPortrait(canvas, () => {
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, H * 0.55, 3, W / 2, H * 0.55, W * 0.7);
    glow.addColorStop(0, `${type.color}33`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    // Fit by whichever dimension is tighter, so wide sprites (bat, jackal) stay inside the
    // tile instead of overflowing it the way a height-only fit would.
    const aspect = spriteAspect(spriteId) || 1;
    const pad = 0.82;
    const h = Math.min(H * pad, (W * pad) / aspect);
    drawSprite(g, spriteId, W / 2, H / 2, h, false, 'side');
  }, spriteId, 'side');
}
const paintEnemyPortrait = (cv, id) => drawEnemyPortrait(cv, id);

function drawClassPortrait(canvas, classDef) {
  paintPortrait(canvas, () => {
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, H * 0.55, 4, W / 2, H * 0.55, W * 0.72);
    glow.addColorStop(0, `${classDef.color}44`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    drawPortraitBust(g, classDef.id, W, H);
  }, classDef.id, spriteHasFacing(classDef.id, 'front') ? 'front' : 'side');
}

// Vertical band shown in a bust portrait, measured against the character's ARTWORK rather
// than its canvas: a little headroom above the crown, down to mid-torso. Framing against the
// canvas lined portraits up inconsistently, because sprites differ both in how much empty
// space sits above the head and in overall proportions.
const BUST_HEADROOM = 0.04;  // padding above the crown, as a fraction of content height
const BUST_DEPTH = 0.56;     // how far down the body to show, same units

function drawPortraitBust(g, spriteId, W, H) {
  const c = spriteContent(spriteId);
  const ch = Math.max(0.01, c.bottom - c.top);
  // Band expressed in canvas fractions, derived from the content box.
  const fTop = c.top - BUST_HEADROOM * ch;
  const fBottom = c.top + BUST_DEPTH * ch;
  const th = H / (fBottom - fTop);
  const sy = th * (0.5 - fTop);
  // Only ask for the front view when a real one exists. Otherwise 'front' silently resolves
  // to the side art anyway, and does so through a path that can still be holding the
  // procedural fallback — which is how the portrait ended up showing the old warrior.
  const dir = spriteHasFacing(spriteId, 'front') ? 'front' : 'side';
  drawSprite(g, spriteId, W / 2, sy, th, false, dir);
}

// Portraits paint once into their own canvas, but sprite PNGs decode asynchronously — so a
// portrait drawn before the art lands would keep the procedural version forever. Track what
// was painted and repaint when art arrives.
const livePortraits = [];
function paintPortrait(canvas, paint, spriteId, dir) {
  livePortraits.push({ canvas, paint, spriteId, dir, lastFrame: -1 });
  paint();
}

// Portraits animate through their walk frames so the characters look like they're stepping
// toward the viewer. Repainted only when the sprite actually advances a frame — at 240-480ms
// per frame that is a couple of repaints a second, not one per display frame.
function tickPortraits() {
  for (let i = livePortraits.length - 1; i >= 0; i--) {
    const p = livePortraits[i];
    if (!p.canvas.isConnected) { livePortraits.splice(i, 1); continue; }
    if (!p.spriteId) continue;
    const idx = spriteFrameIndex(p.spriteId, p.dir || 'side');
    if (idx !== p.lastFrame) { p.lastFrame = idx; p.paint(); }
  }
  requestAnimationFrame(tickPortraits);
}
requestAnimationFrame(tickPortraits);
onSpriteArtLoaded(() => {
  // A sheet finishing its load can change who belongs in the menu carousel, so recompute the
  // cast lazily on the next frame instead of polling it every frame.
  carouselDirty = true;
  // Drop portraits whose canvas has been torn out of the DOM, so this can't grow unbounded
  // as menus are opened and closed.
  for (let i = livePortraits.length - 1; i >= 0; i--) {
    const p = livePortraits[i];
    if (!p.canvas.isConnected) livePortraits.splice(i, 1);
    else p.paint();
  }
});

document.getElementById('backToMenuBtn').addEventListener('click', showMainMenu);
document.getElementById('resumeBtn').addEventListener('click', closePause);
document.getElementById('pauseSettingsBtn').addEventListener('click', () => openSettings('PAUSED'));
document.getElementById('pauseDevBtn').addEventListener('click', openDevTools);
document.getElementById('mainDevBtn').addEventListener('click', openDevTools);
document.getElementById('confirmYesBtn').addEventListener('click', () => closeConfirm(true));
document.getElementById('confirmNoBtn').addEventListener('click', () => closeConfirm(false));
document.getElementById('closeDevBtn').addEventListener('click', closeDevTools);

document.getElementById('devResetAllBtn').addEventListener('click', () => {
  // This discards every saved tuning, which is real work — never do it on a single click.
  const saved = Object.keys(storedTunes()).length;
  const warn = saved
    ? `Discard saved tuning for ${saved} skill${saved > 1 ? 's' : ''} and restore shipped defaults?`
    : 'Restore all skill stats to shipped defaults?';
  if (!window.confirm(warn)) return;
  clearStoredTunes();
  resetAllTunes();
  ui.showToast('Dev Tools', 'All skill stats restored to shipped defaults.', '#e6c14e');
  refreshDevTools();
});
document.getElementById('pauseQuitMenuBtn').addEventListener('click', quitToMenu);
document.getElementById('pauseQuitGameBtn').addEventListener('click', quitGame);
document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
document.getElementById('playGameBtn').addEventListener('click', startClassSelect);
document.getElementById('sandboxBtn').addEventListener('click', openSandbox);
document.getElementById('sandboxStartBtn').addEventListener('click', () => (sandboxLive ? applySandboxLive() : startSandboxRun()));
document.getElementById('sandboxBackBtn').addEventListener('click', () => (sandboxLive ? closeSandboxLive() : closeSandbox()));
document.getElementById('pauseSandboxBtn').addEventListener('click', openSandboxFromPause);
document.getElementById('leaderboardBtn').addEventListener('click', openLeaderboard);
document.getElementById('unlocksBtn').addEventListener('click', openUnlocks);
document.getElementById('closeUnlocksBtn').addEventListener('click', closeUnlocks);
document.getElementById('shopBtn').addEventListener('click', openShop);
document.getElementById('closeShopBtn').addEventListener('click', closeShop);
document.getElementById('mainSettingsBtn').addEventListener('click', () => openSettings('MAINMENU'));
document.getElementById('quitBtn').addEventListener('click', quitGame);
document.getElementById('closeLeaderboardBtn').addEventListener('click', closeLeaderboard);
document.getElementById('clearLeaderboardBtn').addEventListener('click', () => { clearEntries(); ui.showLeaderboard(getEntries(), drawRunPortrait); });

// Track changes announce themselves on screen — except the main theme. That one plays every
// time you touch the menu, so flashing it would make the notification routine background
// noise rather than something that marks a change worth noticing.
onTrackChange((name, listId) => { if (listId !== 'mainMenu') ui.showNowPlaying(name); });

// Audio needs a user gesture before it can start (browser autoplay policy).
setSfxVolume(getSettings().sfxVolume);
setMusicVolume(getSettings().musicVolume);
function firstGestureInit() {
  initAudio();
  // Start whatever the CURRENT context calls for, not the menu track. This handler fires on
  // the first gesture the browser accepts, which is not necessarily on the menu — if the run
  // is already going (the first accepted gesture was a pause, say) then hard-coding 'mainMenu'
  // crossfaded the stage song out and the title theme in, mid-fight.
  playMusic(player && state !== 'MAINMENU' ? `stage${currentStage + 1}` : 'mainMenu');
  resumeAudio();
  window.removeEventListener('pointerdown', firstGestureInit);
  window.removeEventListener('keydown', firstGestureInit);
}
window.addEventListener('pointerdown', firstGestureInit);
window.addEventListener('keydown', firstGestureInit);
document.addEventListener('click', (e) => { if (e.target.closest('button')) play('uiClick'); });

ui.applyInputMode(getSettings().inputPromptMode === 'auto' ? 'keyboard' : getSettings().inputPromptMode);
{ const bt = document.getElementById('buildTag'); if (bt) bt.textContent = BUILD_LABEL; }
ensureTitleArt();
applyDisplayMode(); // honour the saved windowed/borderless choice on launch
showMainMenu();
requestAnimationFrame(frame);
