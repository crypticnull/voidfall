import { rand, randInt, clamp, dist, dist2, normalize, pick, pickWeighted, shuffle,
  MAX_CRIT_CHANCE } from './utils.js';
import { meleeStep } from './enemy-ai.js';
import { SAMPLES, SAMPLE_TUNE_META, PROC_FX, PROC_FX_TUNE_META,
  SAMPLE_FX, SAMPLE_FX_TUNE_META } from './audio-samples.js';
import { DASH, DASH_TUNE_META, CLASSES, CLASS_TUNE_META, CLASS_TUNE_KEYS, PLAYER_TUNE_META, PLAYER_TUNE_KEYS, PLAYER_GLOBALS } from './classes.js';
import { SKILLS, SKILL_ORDER, MOBILITY_ORDER, rollUpgradeTier, rollSupportLevels, rollStatMult,
  rollSkillUpgrade, SKILL_ATTRS, INFUSIONS, estimateSkillDps,
  TUNE_META, tuneDefaults, resetTuneToShipped, resetAllTunes, skillCooldown,
  saveTune, applyStoredTunes, skillDamageAt,
  UPGRADE_ROLL, UPGRADE_ROLL_TUNE_META, UPGRADE_ROLL_KEYS, upgradeTierOdds,
  SKILL_DAMAGE, SKILL_DAMAGE_TUNE_META, SKILL_DAMAGE_KEYS, skillDamageRoll, tomeDamageStep } from './skills.js';
import { SUPPORTS, SUPPORT_ORDER, TOME_CURVE, TOME_TUNE_META, TOME_MASTER,
  TOME_MASTER_TUNE_META, tomeDesc, tomeCardDesc, tomeCount,
  COUNTING_TOMES, levelsToNextCount, tomeMaxLevel, tomeMagnitude } from './supports.js';
import { ENEMY_TYPES, ENEMY_ORDER, DESERT_ENEMY_ORDER, UNDERWORLD_ENEMY_ORDER,
  poolForTime, difficultyMult, spawnIntervalFor, makeBoss,
  rollSizeScale, SIZE_HP_EXP, ENEMY_TUNE_META, ENEMY_TUNE_KEYS, ENEMY_PAGE_KEYS, BOSS_HP_KEYS,
  ENEMY_GLOBALS, applyEnemyGlobals } from './enemies.js';
import { rollItem, applyItem, rollChestReward, RARITY_CURVE, applyRarityCurve, CHEST_WEIGHTS, LOOT_RATES, chestDropChance, keyDropChance, xpDropChance, xpOrbValue, GOLD_RATES, GOLD_CURVE, goldCampaignScale, goldHordeScale, POTION_RATES, goldDropChance, potionDropChance, potionHealFraction } from './loot.js';
import { infusionArt, tint, infusedPolyline, flow, NO_INFUSION } from './infusion-art.js';
import { generateTerrain, TERRAIN_TUNE, TERRAIN_TUNE_META,
  TERRAIN_COLOR_TUNE, TERRAIN_COLOR_META } from './terrain.js';
import { GRAPHICS_TUNE, GRAPHICS_TUNE_META } from './graphics.js';
import { ELITE_TUNE, ELITE_TUNE_META, ELITE_ABILITY, ELITE_ABILITIES, makeElite,
  SUNDER_MULT, TETHER_PULL, TETHER_SLOW, MINIBOSSES } from './elites.js';
import { VOID_TUNE, VOID_TUNE_META, VOID_POWER, rollVoidPower } from './void.js';
import { ITEMS, ITEM_ORDER, ITEM_CAP, hasItem as holdsItem, itemsHeld, rollBossItem } from './items.js';
import { RELICS, RELIC_ORDER, RELIC_CAP, RELIC_TUNE, RELIC_TUNE_META, RELIC_GLOBAL_TUNE_META,
  relicCount, relicTier, relicsHeld, relicDropChance, rollRelic, relicDesc } from './relics.js';
import { pollGamepad, listConnectedPads } from './gamepad.js';
import { getSettings, setSetting } from './settings.js';
import { drawSprite, drawSpriteRotated, facingDir, facingDirStable, spriteHasFacing, onSpriteArtLoaded, PORTRAIT_DIR,
  spriteContent, spriteFrameIndex, handDrawnSpriteIds, spriteAspect, spriteFloats, spriteScale,
  hasSprite, whenSpritesReady, spriteAssetProgress } from './sprites.js';
import { initAudio, resumeAudio, setSfxVolume, setMusicVolume, play, playMusic, currentTrackId,
  MUSIC_TRACK_LIST, onTrackChange, setBossTracks, playBossMusic,
  getJukeboxMode, setJukeboxMode,
  isMusicPaused, toggleMusicPaused, nextTrack, prevTrack, applyProceduralVolume } from './audio.js';
import { getGold, addGold, setGold, resetMeta, getUpgradeLevel, upgradeCost, buyUpgrade,
  upgradeBonuses, UPGRADES, getDeaths, recordDeath, setAllUpgrades,
  addKills, flushKills, ACHIEVEMENTS, achievementState, grantRandomUpgradeLevel } from './meta.js';
import { getEntries, recordRun, clearEntries } from './leaderboard.js';
import { STAGES, BOSS_TIME, killThresholdFor } from './stages.js';
import { S } from './state.js';
import { stageFraction as dfStageFraction, difficultyPosition as dfPosition,
  curveScale as dfCurveScale, stageEnemyStats as dfStageStats,
  CURVE_LAST,  curveFlatFor, armorCost, grantArmor } from './difficulty.js';
import { BUILD_LABEL, JUKEBOX_FREE } from './version.js';
import { spriteLayer } from './gl/sprite-layer.js';
import { effectArt, hasAnyEffectArt } from './effect-art.js';
import * as ui from './ui.js';

// Tell the audio layer which track is each stage's boss theme. Derived from the stage table so
// assigning one is a single line in stages.js — and so audio.js never has to know about stages.
setBossTracks(Object.fromEntries(STAGES.map((st, i) => [`stage${i + 1}`, st.bossTrack])));

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
const ctx2d = canvas.getContext('2d');
ctx2d.imageSmoothingEnabled = false;
spriteLayer.init(window.innerWidth, window.innerHeight);

// The size the game DRAWS in, in CSS pixels — always the full window, whatever the render
// scale is. Every screen-space calculation in this file works in these units; the canvas's own
// backing store is what shrinks, and a base transform set once per frame maps between them.
//
// Keeping the two apart is the whole point: if the drawing code read the backing store instead,
// dropping to 50% would halve the pixels AND double the visible world, turning a graphics
// option into a gameplay one.
let viewW = window.innerWidth, viewH = window.innerHeight;

function resize() {
  const rs = clamp(getSettings().renderScale || 1, 0.25, 1);
  viewW = window.innerWidth; viewH = window.innerHeight;
  canvas.width = Math.max(1, Math.round(viewW * rs));
  canvas.height = Math.max(1, Math.round(viewH * rs));
  // CSS stretches the smaller buffer back over the whole window. #game is `position: fixed;
  // inset: 0` and `image-rendering: pixelated`, so the upscale is nearest-neighbour and stays
  // in keeping with the pixel art rather than going soft.
  ctx2d.imageSmoothingEnabled = false;
  // The GPU sprite band renders in the same logical space and is blitted 1:1 under the same
  // base transform, so it gets the logical size, not the backing-store size.
  spriteLayer.resize(viewW, viewH);
}
window.addEventListener('resize', resize);
resize();

// Re-reads the saved scale and rebuilds both buffers. Called when the setting changes.
function applyRenderScale() { resize(); }

// The lower-left perf readout is a diagnostic, not a HUD element, so it answers to a setting
// rather than being always on. Toggled with a class instead of an inline style so the frame
// profiler's own breakdown block (appended into #perfBox by drawPerfBreakdown) disappears with
// it and nothing has to remember to hide two things.
function applyPerfPanel() {
  const box = document.getElementById('perfBox');
  if (box) box.classList.toggle('hidden', !getSettings().showPerfPanel);
}

// The base transform every frame starts from: one scale that turns logical CSS pixels into
// backing-store pixels. Nothing else in this file calls setTransform, and every save() is
// paired with a restore(), so this survives the whole frame.
function beginFrameTransform() {
  // Read from the canvas's real backing store, NOT from the saved setting: they can disagree
  // for a frame after a resize, and rounding the buffer to whole pixels means the true ratio
  // is not exactly the setting anyway.
  const rs = canvas.width / viewW;
  ctx2d.setTransform(rs, 0, 0, rs, 0, 0);
}

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
// Floor tiles are the other thing that visibly pops in, so the boot gate waits on them too.
// Settled, not loaded — see the note in sprites.js.
let tilesTotal = 0, tilesSettled = 0;
/** @type {((v?: unknown) => void)[]} */
const tileWaiters = [];
function noteTileSettled() {
  tilesSettled++;
  if (tilesSettled >= tilesTotal) tileWaiters.splice(0).forEach((r) => r());
}
function whenTilesReady() {
  if (tilesSettled >= tilesTotal) return Promise.resolve();
  return new Promise((res) => tileWaiters.push(res));
}
function floorTileFor(stageDef) {
  const src = stageDef.floorTile;
  if (!src) return null;
  let entry = floorTileCache.get(src);
  if (!entry) {
    entry = { img: new Image(), ready: false };
    tilesTotal++;
    entry.img.onload = () => {
      noteTileSettled();
      entry.ready = true;
      // The pattern may have been built from the fallback before this resolved, so rebuild
      // the live one now rather than waiting for the next stage change.
      floorPattern = makeFloorPattern(STAGES[S.currentStage] || stageDef);
      // ...and drop the menu's cached copy, so a menu built before its tile decoded picks up
      // the real art on the next frame instead of keeping the procedural stand-in for good.
      menuFloor = null;
    };
    // A tile that never arrives must still release the loading screen.
    entry.img.onerror = noteTileSettled;
    entry.img.src = src;
    floorTileCache.set(src, entry);
  }
  return entry.ready ? entry.img : null;
}

// The main menu always shows the Underworld's floor, whatever stage the last run reached.
//
// It used to draw with the shared `floorPattern`, which is run state — so the backdrop was
// whichever stage you happened to quit from, and a fresh launch showed the Graveyard while
// quitting out of stage 3 showed the Underworld. Held separately here so the menu never
// depends on where a run got to.
//
// makeFloorPattern writes floorPatternSize as a side effect (the caller needs the tile's true
// period to wrap the scroll on). That is fine for the run, but building the menu's pattern
// would clobber the live value, so it is saved and put back around the call.
const MENU_FLOOR_STAGE = 2; // The Underworld
let menuFloor = null;
let menuFloorSize = 128;

// ---------- Endless backdrop shuffle ----------
// Past the final boss every downed boss moves the ground to a different realm. The stage the
// player is mechanically "in" does not change — only the floor does — so this is tracked apart
// from S.currentStage, which still drives enemy stats, boundaries and lighting.
const ENDLESS_FLOOR_FADE = 1.8;   // seconds, start to finish
const ENDLESS_FLOOR_PIXEL = 9;    // coarsest block, at the midpoint of the crossfade
// Never blend at full resolution. A full-arena pattern fill measures ~8.4ms at 1624x1269 —
// half a 60fps frame for ONE layer — so compositing two of them at native size costs the entire
// budget and drops frames for the whole transition. The blend always runs through the reduced
// buffer below, where two fills cost a quarter of one full-size fill at the shallowest step.
const ENDLESS_FLOOR_PIXEL_MIN = 2;
// Below this the destination is opaque enough that the source contributes nothing worth two
// draws; the transition just finishes early rather than paying for an invisible layer.
const ENDLESS_FLOOR_SNAP = 0.98;
let backdropStage = 0;
/** @type {{from: number, to: number, t: number} | null} */
let floorShift = null;

// Scratch buffer for the blend, kept between frames — allocating a canvas per frame would cost
// more than the drawing does.
let floorMixCanvas = null;
let floorMixCtx = null;

// One scaled tile canvas per stage, and the pattern built from it for a given context. The
// canvas is what the offscreen buffer needs: a CanvasPattern belongs to the context that made
// it, so the blend cannot reuse the main context's pattern and builds its own from the source.
const floorLayerCache = new Map();
function floorLayer(stageIndex) {
  const hit = floorLayerCache.get(stageIndex);
  if (hit) return hit;
  const canvas = makeFloorCanvas(STAGES[stageIndex]);
  // Not cached while null — the tile has not decoded yet, and caching the miss would leave this
  // realm blank for the rest of the run.
  if (!canvas) return null;
  const entry = { canvas, size: canvas.width, patterns: new Map() };
  floorLayerCache.set(stageIndex, entry);
  return entry;
}
function floorLayerPattern(entry, g) {
  let p = entry.patterns.get(g);
  if (!p) { p = g.createPattern(entry.canvas, 'repeat'); entry.patterns.set(g, p); }
  return p;
}

/** Begin a dissolve to a random OTHER realm's floor. */
function startBackdropShift() {
  const choices = STAGES.map((_, i) => i).filter((i) => i !== backdropStage);
  if (!choices.length) return;
  floorShift = { from: backdropStage, to: pick(choices), t: 0 };
}

function updateBackdropShift(dt) {
  if (!floorShift) return;
  floorShift.t += dt;
  // Snapped a hair early: past this the destination is opaque and the source contributes
  // nothing, so paying for a second layer and an upscale is pure waste.
  if (floorShift.t < ENDLESS_FLOOR_FADE * ENDLESS_FLOOR_SNAP) return;
  // Landed: adopt the new floor as the plain, un-pixelated one and stop compositing two layers.
  backdropStage = floorShift.to;
  floorShift = null;
  floorPattern = makeFloorPattern(STAGES[backdropStage]);
}

/** Fill a context with one floor layer, scrolled to the camera. */
function fillFloorLayer(g, pattern, period, c, w, h) {
  g.save();
  g.translate(((c.x % period) + period) % period, ((c.y % period) + period) % period);
  g.fillStyle = pattern;
  g.fillRect(-period, -period, w + period * 2, h + period * 2);
  g.restore();
}

function paintFloor(c) {
  if (!floorShift) {
    if (floorPattern) fillFloorLayer(ctx2d, floorPattern, floorPatternSize, c, viewW, viewH);
    return;
  }
  const k = clamp(floorShift.t / ENDLESS_FLOOR_FADE, 0, 1);
  const from = floorLayer(floorShift.from);
  const to = floorLayer(floorShift.to);
  // Either realm's art still decoding: fall back to whichever exists rather than a blank arena.
  if (!from || !to) {
    const only = to || from;
    if (only) fillFloorLayer(ctx2d, floorLayerPattern(only, ctx2d), only.size, c, viewW, viewH);
    return;
  }

  // Pixelation swells to its coarsest at the halfway point and resolves again — the blocks are
  // what carry the change, so the realms trade places while there is least detail on screen to
  // watch it happen. A straight cross-dissolve at full resolution just looks like two floors
  // ghosting through each other.
  //
  // The reduction is done by rendering into a SMALLER BUFFER and blowing it back up, not by
  // pre-blurring the tile. That pixelates the whole scrolling field rather than each tile in
  // isolation, and it is what makes the effect affordable: the two blended fills happen at
  // 1/px² of the area, so even the shallowest step costs a quarter of one full-size fill.
  const px = Math.max(ENDLESS_FLOOR_PIXEL_MIN,
    Math.round(ENDLESS_FLOOR_PIXEL_MIN + (ENDLESS_FLOOR_PIXEL - ENDLESS_FLOOR_PIXEL_MIN) * Math.sin(Math.PI * k)));
  const bw = Math.max(1, Math.ceil(viewW / px));
  const bh = Math.max(1, Math.ceil(viewH / px));
  if (!floorMixCanvas) {
    floorMixCanvas = document.createElement('canvas');
    floorMixCtx = floorMixCanvas.getContext('2d');
  }
  // Resizing a canvas clears it and drops its patterns, so only do it when the size really
  // changes — which is once per pixelation step, not once per frame.
  if (floorMixCanvas.width !== bw || floorMixCanvas.height !== bh) {
    floorMixCanvas.width = bw; floorMixCanvas.height = bh;
    from.patterns.delete(floorMixCtx); to.patterns.delete(floorMixCtx);
  }
  const g = floorMixCtx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, bw, bh);
  // Work in full-size coordinates and let the transform do the shrinking, so the scroll offset
  // and the tile period need no separate scaling.
  g.setTransform(1 / px, 0, 0, 1 / px, 0, 0);
  g.globalAlpha = 1;
  fillFloorLayer(g, floorLayerPattern(from, g), from.size, c, viewW, viewH);
  g.globalAlpha = k;
  fillFloorLayer(g, floorLayerPattern(to, g), to.size, c, viewW, viewH);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;

  ctx2d.save();
  ctx2d.imageSmoothingEnabled = false;   // hard blocks on the way back up, not a blur
  ctx2d.drawImage(floorMixCanvas, 0, 0, bw, bh, 0, 0, viewW, viewH);
  ctx2d.restore();
}

function menuFloorPattern() {
  // A null result means "tile not decoded yet", not "no floor" — so it is retried next frame
  // rather than cached. makeFloorPattern bails immediately in that state, so this costs a
  // property read per frame until the art lands.
  if (!menuFloor) {
    const prev = floorPatternSize;
    menuFloor = makeFloorPattern(STAGES[MENU_FLOOR_STAGE] || STAGES[0]);
    if (menuFloor) menuFloorSize = floorPatternSize;
    floorPatternSize = prev;
  }
  return menuFloor;
}

/**
 * The scaled, contrast-corrected, dimmed tile for a stage, as a canvas — the thing a repeating
 * pattern is built FROM. Split out of makeFloorPattern so the backdrop blend can build its own
 * pattern on its own offscreen context: a CanvasPattern belongs to the context that created it,
 * and reusing the main one on another canvas is not something to rely on.
 * Returns null while the art is still decoding.
 */
function makeFloorCanvas(stageDef) {
  const tileImg = floorTileFor(stageDef);
  if (!tileImg) return null;
  const c = document.createElement('canvas');
  // Per-stage, because tiles are authored at wildly different resolutions. The 3x default suits
  // the original 64px hand-drawn tiles, where the upscale is the point — the chunky pixels ARE
  // the style. A tile authored at 1024 is already at its intended size, and tripling it would
  // build a 3072px pattern canvas: bigger than the entire 3000px arena, for art that would then
  // read as enormous smeared blocks.
  const scale = stageDef.floorTileScale === undefined ? FLOOR_TILE_SCALE : stageDef.floorTileScale;
  c.width = tileImg.width * scale;
  c.height = tileImg.height * scale;
  const g = c.getContext('2d');
  // Nearest-neighbour is right for UPSCALING — the chunky pixels are the style — but wrong for
  // downscaling, where it throws away 15 of every 16 pixels and turns fine art into noise.
  // Smoothing goes on only when the tile is being shrunk.
  g.imageSmoothingEnabled = scale < 1;
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
  return c;
}

function makeFloorPattern(stageDef) {
  const tileImg = floorTileFor(stageDef);
  if (tileImg) {
    // Record the true period: the scroll offset below must wrap on THIS, not on a constant.
    // Drawn at FLOOR_TILE_SCALE so a 64px tile reads at its intended size on screen rather
    // than as fine noise. Scaled into the pattern canvas (not via a pattern transform) so
    // nearest-neighbour applies and the pixels stay crisp blocks.
    const c = makeFloorCanvas(stageDef);
    floorPatternSize = c.width;
    return ctx2d.createPattern(c, 'repeat');
  }
  // A stage that DECLARES a tile draws nothing until that tile is decoded. The procedural
  // speckle below is a fallback for stages with no art at all — showing it in the gap before a
  // real tile arrives meant the old floor flashed on every load, which is the same fault the
  // sprite fallback had. Better a beat of empty floor than a beat of the wrong floor.
  if (stageDef.floorTile) return null;
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
// Start every stage's tile downloading now, rather than at the moment each one is first
// drawn. floorTileFor() kicks off the load and caches it; the return value is unused here.
// Without this the menu's tile only began loading when the menu first painted, which is
// exactly when it needed to be ready.
for (const st of STAGES) floorTileFor(st);
floorPattern = makeFloorPattern(STAGES[0]);

const ARENA_RADIUS = 1500; // half-extent of the square arena (spans ±ARENA_RADIUS on each axis)
// BOSS_TIME and killThresholdFor moved to stages.js — pacing lives with the stages it paces,
// and the Godot export reads that module.
// Hard ceiling on live enemies. Past this the sim (collision, rendering, and especially the
// per-death sound effects) degrades badly, so spawning holds until the arena thins out.
// Bosses are exempt — one must always be able to appear.
const MAX_ENEMIES = 1024;
// Projectiles and effects are spawned in bursts (fanned shots, per-hit VFX) and were the two
// uncapped pools. Oldest entries are dropped first so the newest action stays visible.
const MAX_PROJECTILES = 512;
// Ceiling on chain bonuses from gear and upgrades.
//
// Chain had no cap at all, and unlike pierce it is self-propagating: every hop looks for
// another target from where it landed, so in a dense pack a big enough budget lets one shot
// walk the entire screen. That is not just strong, it is a frame-rate problem — each hop is
// another nearest-target search over the live enemy list.
//
// The base value a skill declares is NOT capped; this limits what mods can add on top.
const MAX_CHAIN_BONUS = 6;

// Damage carried into each successive hop, compounding. A chain that hits the tenth target as
// hard as the first makes every other targeting stat pointless — this way extra hops still add
// total damage, with each one worth less than the last, so the reach is the reward rather than
// a straight multiplier on output.
const CHAIN_DAMAGE_FALLOFF = 0.9;

// Deepest chain of forks a single shot may produce: 3 levels, so at most 8 endpoints.
const MAX_FORK_DEPTH = 3;
const MAX_EFFECTS = 512;
const MAX_DMG_NUMBERS = 256; // floating hit numbers alive at once
// How far outside the view a damage number is still worth creating and drawing.
const DMG_CULL_MARGIN = 48;
// Last value written to ctx.font by the damage-number pass, so the assignment can be skipped
// when it would not change anything. Reset each frame because other painters set the font too.
let dmgFontCache = null;
// ---------- Drop economy ----------
// Three independent currencies, three independent sets of knobs. They used to be entangled:
// gold was computed from the enemy's `xp` field, and the health potion roll was nested INSIDE
// the gold roll, so it could only ever drop alongside a coin. Tuning any one of them moved the
// others, and the potion rate silently varied from 1.6% to 6.7% by enemy worth as a side
// effect of that nesting rather than by anyone's decision.
//
// Each now reads: how often it drops, and how much it is worth. Nothing else.

// XP. Both halves — how OFTEN an orb drops and what it is WORTH — now live in LOOT_RATES, so
// the pair can be moved together. Their PRODUCT is the net rate against one orb per kill at
// face value, and it is the product that decides how fast a run levels.
//
// Retuned from "few, fat orbs" to "many, thin ones": 25% x 2.25 became 75% x 0.75, which is the
// same 0.5625 net. Three times as many orbs, each a third the size. Nothing about levelling
// speed changes; what changes is the FEEL — a steady trickle of pickups reads as constant
// reward, where one fat orb per four kills reads as three kills paying nothing.

// Gold. Still scales with how big the enemy was — a Minotaur should be worth more than a bat —
// but on its own multiplier, so changing what XP is worth no longer moves the gold economy.
/**
 * Which of the three gold contexts the run is in RIGHT NOW.
 *
 *  normal  - regular stage play
 *  horde   - the boss is down and the portal is open, but the stage is still spawning. The
 *            player is looting under pressure on a clock of their own choosing, which is a
 *            different economy from either of the others.
 *  endless - past the final boss.
 *
 * Endless is checked first: once the final boss is down there is no portal phase to be in.
 */
/**
 * The live coin-value multiplier for a context.
 *
 * The two curves run on unrelated clocks, so the choice of clock lives here rather than at each
 * call site: the horde reads SECONDS SINCE THIS PORTAL OPENED — `stagePortal.t`, which resets to
 * zero with each new portal because a fresh portal object is built each time — and everything
 * else reads the campaign's difficulty position.
 * @param {string} ctx
 */
function goldMultNow(ctx) {
  // The stage index rides along: a later rush pays more than an earlier one, and the rush
  // belongs to the stage whose boss just fell — which is still S.currentStage, because the
  // portal deliberately does not advance the stage until the player steps through it.
  if (ctx === 'horde') return goldHordeScale(stagePortal ? stagePortal.t : 0, S.currentStage);
  return goldCampaignScale(difficultyPosition());
}

function goldContext() {
  if (S.beatFinalBoss) return 'endless';
  if (stagePortal) return 'horde';
  return 'normal';
}

// Gold and potion rates moved to loot.js (GOLD_RATES / POTION_RATES) so they can be tuned and
// baked like every other drop number. The potion rate carries its own history: 4.75% was the
// average the old nested roll produced across the roster, then -30% to 3.325%.

// Tomes (support gems) held at once, before any shop upgrades. Three, so a new player can hold
// a real combination on their first run instead of choosing between two tomes and buying the
// third. The Reliquary Shelf line in meta.js buys three more, for six fully invested — the
// ceiling is unchanged, one rung of it just moved from "purchase" to "free".
const SUPPORT_SLOTS_BASE = 3;
// Active skill gems held at once, before any shop upgrades. The Rune Girdle line in meta.js
// buys two more, for five fully invested. Named here rather than written as a literal because
// the fallback for it appears in several places, and a bare `|| 5` in one of them silently
// disagreeing with the rest is exactly how a cap ends up meaning two different numbers.
//
// Three. It went to 2 for the fresh 0.6.7 economy to make the third slot a purchase, and that
// made the opening hours poorer rather than more interesting: two attacks is not yet a build,
// so the first several runs were spent earning the right to start playing.
const SKILL_SLOTS_BASE = 3;
// Chests and silver keys are switched off while power is rebalanced around the level-up
// screen alone. The loot tiers in loot.js stay intact — flip this back to true to restore
// drops, the key counter and the opening sequence exactly as they were.
// Chests and silver keys are back on. They were switched off while level-ups carried stat
// cards; with those gone, chests are where raw stats come from, so the two changes belong
// together — turning one off without the other leaves the build with no stat source at all.
const CHESTS_ENABLED = true;

// ---------- Global difficulty curve ----------
// The curve itself lives in difficulty.js as pure functions. These thin wrappers bind it to
// the live run state, so callers here keep the same zero-argument shape they always had while
// the maths stays independently testable.
function stageFraction() {
  return dfStageFraction({ stageElapsed: S.stageElapsed, stageKills: S.stageKills, bossTime: BOSS_TIME, killThreshold: killThresholdFor(S.currentStage) });
}
function difficultyPosition() {
  return dfPosition({
    currentStage: S.currentStage, stageCount: STAGES.length, beatFinalBoss: S.beatFinalBoss, endlessWave: S.endlessWave, fraction: stageFraction(),
  });
}
function stageEnemyStats(stage = STAGES[S.currentStage]) { return dfStageStats(stage); }
function curveScale(stat, pos = difficultyPosition()) { return dfCurveScale(stat, pos); }

// Stat nodes carry a BASE value that the rolled rarity scales, so a Unique "Vitality" is
// worth several times a Common one. `label` renders the rolled value for the card.
const STAT_NODES = [
  { id: 'vitality', name: 'Vitality', color: '#8a2e22', base: 30, round: 1,
    label: (v) => `+${v} Maximum Life`, apply(p, v) { p.maxHp += v; p.hp += v; } },
  { id: 'swiftfoot', name: 'Swift Foot', color: '#5c7a3d', base: 8, round: 1,
    label: (v) => `+${v}% Movement Speed`, apply(p, v) { p.speedMult += v / 100; } },
  { id: 'ironskin', name: 'Iron Skin', color: '#5a5a5e', base: 5, round: 1,
    label: (v) => `+${v} Armor`, apply(p, v) { grantArmor(p, v); } },
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
  return Number(Math.max(step, Math.round(v / step) * step).toFixed(step < 1 ? 1 : 0));
}

// (moved to state.js — see S)
// (moved to state.js — see S)
// `elapsed` is the cumulative run clock shown in the HUD and recorded to the leaderboard —
// it never resets between stages. `stageElapsed` is a separate, hidden per-stage clock that
// drives pacing: the enemy-tier unlocks, the spawn-rate ramp, and the boss's 5-minute
// guaranteed-arrival contingency.
// (moved to state.js — see S)
// Killing the final boss doesn't end the run — it flips into endless survival. `beatFinalBoss`
// is what marks the run as a victory on the leaderboard; `endlessWave` counts the boss cycles
// cleared after that point and drives the escalating difficulty.
// (moved to state.js — see S)
// (moved to state.js — see S)
// Silver keys held this run. Persist across stages; reset to 0 on new run / death / victory / quit.
// (moved to state.js — see S)
// Gold is KEPT ON DEATH, unconditionally. It used to be held at risk until you felled a boss:
// gold banked at each boss kill, and dying forfeited everything earned since that checkpoint.
// That gate is gone — every coin picked up is yours the moment you touch it, whether the run
// ends in a victory, a death, or a quit, and no boss has to die for it to count.

// "Final boss" is always the boss of the last stage that exists, so adding stages later
// automatically moves the goalpost without touching any of the rules keyed off it.
function isFinalStage() { return S.currentStage >= STAGES.length - 1; }
// (moved to state.js — see S)
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
// True while the player is deliberately aiming (right stick or mouse), as opposed to merely
// facing the way they are walking. Self-aiming skills read this — see the flamethrower.
let aimInputActive = false;
// How far the pad's auto-aim will look. Roughly a screen: far enough that it always finds the
// thing about to reach you, close enough that it does not spin the player toward a straggler
// on the far side of the arena.
const AUTO_AIM_RANGE = 700;

// ---------- Dodge dash ----------
// A short burst in the direction you are already holding. Two charges rather than one, because
// a single charge on a cooldown makes the dash a thing you hoard; two lets you spend one to get
// out and still have one for the mistake that follows. They refill ONE AT A TIME, so spending
// both means waiting the full cost of each rather than getting the pair back together.
// The dodge's numbers live in classes.js as DASH so the dev panel can move them; see there for
// why the cooldown takes no runtime modifiers.
//
// Speed is derived, not stored: distance and duration are the two things worth dialling, and a
// stored speed would let the three disagree. A function rather than a constant because both
// inputs are now live.
const dashSpeed = () => DASH.distance / DASH.time;

// The dash's motion smear: how many echoes, how far back they reach as a fraction of the
// SPRITE HEIGHT, and how opaque the nearest one is.
//
// Sprite height, not dash distance — which is what the first version used, and why the effect
// was invisible. The dash travels 100px and the character is about that wide, so echoes at
// 9-36px behind it sat entirely inside the body. A trail has to be measured against the thing
// it is trailing from, or a short dash produces a smear hidden under the sprite.
//
// Six echoes across the span. They are evenly spaced by construction — the offset is i/(N+1)
// of the span — so adding samples fills the SAME trail more densely rather than lengthening it;
// the tail still ends where DASH_BLUR_SPAN puts it.
const DASH_BLUR_SAMPLES = 6;
const DASH_BLUR_SPAN = 2.85;
const DASH_BLUR_ALPHA = 1.02;
// The smear shortens as the dash ends, but never to nothing before the dash does — collapsing
// it fully by the last frames just makes the effect flicker out early.
const DASH_BLUR_TAPER = 0.5;
// How long the smear LINGERS after the dash itself has finished, fading out.
//
// This is what makes the effect readable. The dash lasts 0.15s — nine frames, under half a
// blink — so however long or opaque the trail was, it appeared and vanished faster than the eye
// settles on it. Holding it for another 0.3s turns a flash into something you actually see
// resolve, without touching the dash's own timing or how far it carries you.
const DASH_BLUR_HOLD = 0.3;
// True while the pad's dash button is still held from a press we already acted on.
let dashPadLatch = false;

/**
 * Spend a charge and start a burst. Direction is whatever the player is HOLDING, falling back to
 * the way they are facing when standing still — a dodge that fires backwards because you happened
 * to be aiming behind you would get people killed.
 */
/**
 * The dials behind whatever occupies the dash slot. The Dodge Roll reads the DASH block —
 * that is where its dev sliders have always lived — and every other mobility skill carries
 * its own tune. One accessor, so the charge and recharge machinery cannot disagree about
 * whose numbers apply.
 */
function mobilityTune() {
  const id = (S.player && S.player.mobility && S.player.mobility.id) || 'dodgeroll';
  return id === 'dodgeroll' ? DASH : SKILLS[id].tune;
}

// The dodge button fires whatever sits in the MOBILITY SLOT. Two occupants exist, so this
// switches on the id; a third mobility skill is the point to give SKILLS a dash(ctx) contract.
function tryDash() {
  const p = S.player;
  if (!p || p.dashCharges <= 0 || p.dashT > 0) return;
  if (p.reassembling > 0) return;   // a pile of bones does not dodge-roll
  const mt = mobilityTune();
  let mx = 0, my = 0;
  if (keys.has('w') || keys.has('arrowup')) my -= 1;
  if (keys.has('s') || keys.has('arrowdown')) my += 1;
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
  if (keys.has('d') || keys.has('arrowright')) mx += 1;
  if (gp) { mx += gp.move.x; my += gp.move.y; }
  const dir = (mx || my) ? normalize(mx, my) : p.facing;
  p.dashCharges--;

  if (p.mobility.id === 'voidstep') {
    // No travel at all: the player is deleted here and restored there. Everything the LINE
    // crossed is void-marked, so the step through a crowd arms the whole file of them — the
    // skill is an escape that doubles as a fuse when the player has collapse sources.
    const from = { x: p.x, y: p.y };
    p.x += dir.x * mt.distance; p.y += dir.y * mt.distance;
    const lim = ARENA_RADIUS - p.radius;
    p.x = clamp(p.x, -lim, lim); p.y = clamp(p.y, -lim, lim);
    if (terrain) terrain.resolve(p, p.radius);
    for (const e of S.enemies) {
      if (e.dead) continue;
      if (segDist(from.x, from.y, p.x, p.y, e.x, e.y) <= (mt.markWidth || 40) / 2 + e.radius) {
        applyVoidMark(e);
      }
    }
    // A beat of grace on arrival — reappearing inside the crowd you stepped into is a choice,
    // but it should be a survivable one.
    p.silenceUntil = Math.max(p.silenceUntil || 0, performance.now() + (mt.grace || 0) * 1000);
    spawnEffect({ kind: 'ring', x: from.x, y: from.y, radius: 34, color: '#7a56d2', duration: 0.3, mods: {} });
    spawnEffect({ kind: 'ring', x: p.x, y: p.y, radius: 34, color: '#7a56d2', duration: 0.3, mods: {} });
    play('iceNova');
    if (p.dashCd <= 0) p.dashCd = mt.cooldown;
    return;
  }

  // ---- Dodge Roll, the default occupant ----
  p.dashDir = { x: dir.x, y: dir.y };
  p.dashT = DASH.time;
  // A streak along the path taken, drawn behind the player. Spawned at the moment of the dash
  // and left to fade on its own, so it reads as speed rather than as an attached particle.
  // follow: true pins it to the player for its whole life, so the smear travels WITH them and
  // reads as their own speed. Left unpinned it stayed where the dash began and turned into a
  // scorch mark on the floor the character had already left behind.
  //
  // It outlives the burst slightly (0.28s against DASH.time) so there is a moment of trailing
  // after the movement stops, rather than the streak vanishing on the same frame the player
  // plants their feet.
  spawnEffect({
    kind: 'dashStreak', follow: true, x: p.x, y: p.y, dir: Math.atan2(dir.y, dir.x),
    len: DASH.distance, duration: 0.28, color: p.classColor || '#cdd3dd',
  });
  // The refill clock only starts once something is actually missing.
  if (p.dashCd <= 0) p.dashCd = mt.cooldown;
}

/** Closest living enemy within `range`, or null. Shared by the pad's auto-aim and the flame. */
function nearestEnemyTo(from, range) {
  let best = null, bestD = range;
  for (const e of S.enemies) {
    if (e.dead) continue;
    const d = dist(from.x, from.y, e.x, e.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// How much closer a challenger must be before auto-aim abandons the enemy it is already on.
// 0.85 = it has to beat the current target by 15%.
const AIM_STICKINESS = 0.85;

/**
 * Auto-aim's target, with hysteresis — the fix for the character snapping between two enemies.
 *
 * nearestEnemyTo is a pure minimum recomputed every frame, so two foes at almost the same
 * distance trade the lead on sub-pixel movement and the character whips back and forth between
 * them. A timer would stop the flicker but would also make every genuine switch feel late.
 *
 * Stickiness answers both: the enemy already being aimed at keeps the aim until something is
 * MEANINGFULLY closer. A new threat that really is nearer wins on the frame it arrives; a tie
 * can never oscillate, because beating the incumbent by 15% and then losing to it by 15% cannot
 * both be true.
 */
function autoAimTarget(from, range, prevId) {
  let best = null, bestD = range;
  let cur = null, curD = Infinity;
  for (const e of S.enemies) {
    if (e.dead) continue;
    const d = dist(from.x, from.y, e.x, e.y);
    if (e.id === prevId) { cur = e; curD = d; }
    if (d < bestD) { bestD = d; best = e; }
  }
  // Hold the incumbent while it is still in reach and no one has clearly beaten it.
  if (cur && curD <= range && !(bestD < curD * AIM_STICKINESS)) return cur;
  return best;
}
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
    if (e.key === 'Escape') { /** @type {HTMLElement} */ (document.activeElement)?.blur(); e.preventDefault(); }
    return;
  }
  keys.add(e.key.toLowerCase());
  lastInputDevice = 'keyboard';
  const lower = e.key.toLowerCase();
  // Esc or P toggles pause during play.
  // Tab would otherwise move focus to the browser chrome mid-fight, so it is always consumed
  // while playing, whether or not a charge was available.
  if (S.state === 'PLAYING' && e.key === 'Tab') { tryDash(); e.preventDefault(); return; }
  if (S.state === 'PLAYING' && (e.key === 'Escape' || lower === 'p')) { openPause(); e.preventDefault(); return; }
  if (S.state === 'PAUSED' && lower === 'p') { closePause(); e.preventDefault(); return; }
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
/**
 * The focused ELEMENT, not just its coordinates.
 *
 * The row/col pair alone was not enough to hold focus still. The nav grid is rebuilt every
 * frame from live geometry, and `.gpFocused` applies `translateY(-4px)` — so the focused card
 * measures 4px higher than its neighbours, which changes how the grid sorts and groups, which
 * can resolve the same row/col to a DIFFERENT card on the next frame. That card then lifts, the
 * first one drops, and the two swap forever: on the class-select strip the highlight visibly
 * strobed between two neighbours at frame rate.
 *
 * Anchoring to the element breaks the loop — focus is a thing, and the indices are re-derived
 * from where that thing currently sits, so a few pixels of visual lift can never move it.
 * @type {Element|null}
 */
let gpFocusEl = null;

/**
 * Point gpFocusRow/gpFocusCol at `el`'s current position in a freshly built grid.
 * @returns {boolean} false if the element is no longer in the grid (menu changed under us).
 */
function syncFocusToElement(grid, el) {
  if (!el) return false;
  for (let r = 0; r < grid.length; r++) {
    const c = grid[r].items.findIndex((it) => it.btn === el);
    if (c !== -1) { gpFocusRow = r; gpFocusCol = c; return true; }
  }
  return false;
}
// Overlays with a natural "cancel" action mapped to the gamepad B button.
// Class select and level-up have no back action (a choice there is mandatory).
const BACK_ACTIONS = {
  pauseMenu: () => closePause(),
  settingsMenu: () => closeSettings(),
  confirmDialog: () => closeConfirm(false), // B / Esc declines
  devMenu: () => closeDevTools(), // returns to whichever menu opened it
  leaderboardMenu: () => closeLeaderboard(),
  unlocksMenu: () => closeUnlocks(),
  musicMenu: () => closeMusic(),
  shopMenu: () => closeShop(),
  classSelect: () => showMainMenu(),
  sandboxMenu: () => (sandboxLive ? closeSandboxLive() : closeSandbox()),
  // B on the results screen returns to the main menu — and MUST dismiss the results screen on
  // the way. It did not, which left both overlays visible at once: the menu appeared underneath
  // while Play Again sat on top, and the controller navigated the menu it could not see.
  endScreen: () => { ui.hideEndScreen(); showMainMenu(); },
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
// Focusable controls that are actually ON SCREEN.
//
// querySelectorAll returns hidden controls too, and `.hidden` is display:none — so the level-up
// overlay's Reroll button (hidden unless rerolls remain) was still a nav target. Pressing down
// moved focus onto something invisible, which read as the cards being deselected: the highlight
// simply vanished with nothing to land on. offsetParent is null for a display:none element, and
// the size check also drops anything collapsed to nothing.
function visibleFocusables(overlay) {
  return Array.from(overlay.querySelectorAll('button, .gpSlider')).filter((el) => {
    if (el.offsetParent === null) return false;      // display:none, or an ancestor is
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

// Groups the focusable controls into the rows the eye sees, so up/down steps through them one
// visual line at a time.
//
// Two controls share a row when their vertical extents OVERLAP by more than half the shorter
// one's height — a proportional test, not a pixel threshold. That matters because the same
// grid has to serve a menu with four tall buttons and the dev tuning panel with 139 sliders at
// a 26px pitch, and no single fixed tolerance fits both.
//
// The previous version keyed each row on the `top` of whichever control happened to create it,
// in DOM order, and compared later controls against that frozen value with a fixed 26px
// tolerance. On the tuning panel — several columns of skills whose blocks have different
// parameter counts, so the columns drift vertically against each other — controls landed in
// rows that did not correspond to any visual line. Walking up/down could then reach only 67 of
// 206 controls; 82 tuning sliders could not be selected at all.
//
// Sorting by `top` BEFORE grouping is what makes it robust: rows are then built in the order
// they appear down the page, and each row's span grows to cover the controls actually on that
// line, so drifting columns stay together instead of chaining into the wrong row.
function computeNavGrid(buttons) {
  const boxes = buttons
    .map((btn) => { const r = btn.getBoundingClientRect(); return { btn, top: r.top, bottom: r.bottom, h: r.height, x: r.left + r.width / 2 }; })
    .sort((a, b) => (a.top - b.top) || (a.x - b.x));

  const rows = [];
  let row = null;
  for (const b of boxes) {
    // Overlap needed to count as the same line: half the shorter of the two heights.
    //
    // Measured against the row's FIRST control — its anchor — and never against a running
    // maximum. Growing the span would let one unusually tall control chain two lines into one:
    // a two-line slider label is 32px against the usual 22, so it overlaps both the line above
    // and the line below, and a growing row would swallow the second. The anchor is the line.
    const need = row ? Math.min(b.h, row.h) * 0.5 : 0;
    if (row && b.top < row.bottom - need) {
      row.items.push({ btn: b.btn, x: b.x });
    } else {
      row = { y: b.top, bottom: b.bottom, h: b.h, items: [{ btn: b.btn, x: b.x }] };
      rows.push(row);
    }
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

/**
 * The overlay the player is actually looking at.
 *
 * Was `querySelector('.overlay:not(.hidden)')`, which returns the first match in DOCUMENT order
 * — not the one on top. Any moment two overlays are open at once, the controller would drive
 * whichever happened to be written earlier in index.html. That is how death-then-B left the
 * results screen unreachable: #mainMenu is declared long before #endScreen, so it won focus
 * while sitting invisibly behind it.
 *
 * Stacking order is the honest answer, so ask for it: highest z-index wins, and later in the
 * document breaks a tie — which is exactly how the browser decides what is painted on top.
 */
function topmostOverlay() {
  const open = [...document.querySelectorAll('.overlay:not(.hidden)')];
  let best = null, bestZ = -Infinity;
  for (const el of open) {
    const z = Number(getComputedStyle(el).zIndex) || 0;
    if (z >= bestZ) { bestZ = z; best = el; }   // >= so a later sibling wins an equal z
  }
  return best;
}

function updateGamepadMenuNav() {
  const overlay = topmostOverlay();
  if (!overlay) { gpFocusOverlay = null; return; }
  if (!gp) return;
  if (gp.justPressed[1]) { const back = BACK_ACTIONS[overlay.id]; if (back) { back(); return; } }
  // Right stick smoothly scrolls the tallest scrollable region in this overlay.
  const rsY = gp.rawAxes[3] || 0;
  if (Math.abs(rsY) > 0.18) {
    // The overlay itself is a candidate: Dev Tools scrolls at that level rather than inside
    // its panel, so without this the right stick would find nothing to move there.
    const scroller = [overlay, overlay.querySelector('.overlayInner'),
      .../** @type {NodeListOf<HTMLElement>} */ (overlay.querySelectorAll('.unlocksBody, .sandboxBody, .leaderboardList, .settingsList'))]
      .filter(Boolean).find((el) => el.scrollHeight > el.clientHeight + 1);
    if (scroller) scroller.scrollTop += rsY * 14;
  }
  const buttons = visibleFocusables(overlay);
  if (!buttons.length) return;
  const grid = computeNavGrid(buttons);
  if (overlay !== gpFocusOverlay) {
    gpFocusOverlay = overlay; gpFocusRow = 0; gpFocusCol = 0; gpLastScrolledTo = null; gpFocusEl = null;
  }
  // Follow the ELEMENT first. Only fall back to the stored coordinates when it has gone (the
  // menu rebuilt, or the carousel rotated it out) — see gpFocusEl for why this matters.
  if (!syncFocusToElement(grid, gpFocusEl)) {
    gpFocusRow = Math.min(gpFocusRow, grid.length - 1);
    gpFocusCol = Math.min(gpFocusCol, grid[gpFocusRow].items.length - 1);
  }

  const stepX = stickAxisStep(gp.rawAxes[0] || 0, 'x');
  const stepY = stickAxisStep(gp.rawAxes[1] || 0, 'y');
  const navLeft = gp.justPressed[14] || gp.justPressed[4] || stepX < 0;
  const navRight = gp.justPressed[15] || gp.justPressed[5] || stepX > 0;
  const focusedEl = grid[gpFocusRow].items[gpFocusCol].btn;
  // The tuning panel runs its own scheme (stick between tiles, d-pad within them) and consumes
  // the frame's input when it applies.
  const tookIt = tuningPanelNav(grid, focusedEl, gp, stepX, stepY);
  if (tookIt) {
    buttons.forEach((b) => b.classList.remove('gpFocused'));
    const f = grid[gpFocusRow].items[gpFocusCol].btn;
    f.classList.add('gpFocused');
    gpFocusEl = f;
    if (f !== gpLastScrolledTo) { f.scrollIntoView({ block: 'nearest' }); gpLastScrolledTo = f; }
    if (gp.justPressed[0] && !f.classList.contains('gpSlider')) f.click();
    return;
  }
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
  gpFocusEl = focused;
  // Only scroll when the focus actually moves. This runs every frame a pad is connected, so
  // scrolling unconditionally dragged the view back to the focused control the instant the
  // user scrolled anywhere with the mouse — the wheel appeared to be stuck.
  if (focused !== gpLastScrolledTo) {
    focused.scrollIntoView({ block: 'nearest' });
    gpLastScrolledTo = focused;
  }
  if (gp.justPressed[0] && !focused.classList.contains('gpSlider')) focused.click();
}

// ---- Dev Tools tuning panel: its own control scheme --------------------------------------
// The panel is 15 skill tiles laid out three across, each holding a stack of sliders. Treating
// it as one flat grid meant the stick and d-pad did the same thing and crossing it took dozens
// of presses. Here the two inputs are given separate jobs:
//
//   left stick   move between TILES  ·  on a slider, COARSE adjustment
//   d-pad        move within a tile  ·  on a slider, FINE adjustment
//
// Horizontal input adjusts whenever a slider is focused and navigates otherwise; vertical
// input always navigates. That is what lets one scheme cover both without a mode to toggle.

/** Every focusable control inside one skill tile, in the order it appears. */
function tileControls(tile) {
  return /** @type {HTMLElement[]} */ (Array.from(tile.querySelectorAll('button, .gpSlider')))
    .filter((el) => el.offsetParent !== null);
}

/** Points gpFocusRow/gpFocusCol at `el`. No-op if it is not in the grid. */
function setNavFocus(grid, el) {
  for (let r = 0; r < grid.length; r++) {
    const c = grid[r].items.findIndex((it) => it.btn === el);
    if (c >= 0) { gpFocusRow = r; gpFocusCol = c; return true; }
  }
  return false;
}

/** Steps to the next/previous control inside the same tile, stopping at its ends. */
/** The header row's buttons: icon, name/fold, MAX, Save, Reset. What the STICK walks across. */
function tileHeaderControls(tile) {
  return tileControls(tile).filter((el) => !el.classList.contains('gpSlider'));
}

/** Just the sliders. What the D-PAD walks down, and the only thing it can change. */
function tileSliders(tile) {
  return tileControls(tile).filter((el) => el.classList.contains('gpSlider'));
}

/**
 * D-pad vertical: step through this tile's sliders. From a header control it drops onto the
 * first (or last) slider, so the pad reaches the stats without the stick having to hand over.
 */
function moveAmongSliders(grid, tile, focusedEl, dir) {
  const sliders = tileSliders(tile);
  if (!sliders.length) return;
  const i = sliders.indexOf(focusedEl);
  if (i < 0) { setNavFocus(grid, dir > 0 ? sliders[0] : sliders[sliders.length - 1]); return; }
  // Clamped rather than wrapped: running off the end of a long stat list and landing back at
  // the top reads as the panel having jumped somewhere else entirely.
  setNavFocus(grid, sliders[clamp(i + dir, 0, sliders.length - 1)]);
}

/**
 * Stick horizontal: walk the header row. From a slider it returns to the fold toggle rather
 * than stepping sideways into another slider — the stick's horizontal axis means "move along
 * the header", and it should mean that from anywhere in the tile.
 */
function moveAmongHeader(grid, tile, focusedEl, dir) {
  const head = tileHeaderControls(tile);
  if (!head.length) return false;
  const i = head.indexOf(focusedEl);
  if (i < 0) {
    const fold = head.find((el) => el.classList.contains('tuneCollapse'));
    setNavFocus(grid, fold || head[0]);
    return true;
  }
  const next = clamp(i + dir, 0, head.length - 1);
  // Reports whether it actually went anywhere. At the end of the header row the clamp is a
  // no-op, and the caller needs to know that so it can leave the box for the next column
  // instead of silently eating the input — which is what made every multi-column dev page
  // (Classes, Curve, Tomes, Drops) unreachable past its left column on a controller.
  if (next === i) return false;
  setNavFocus(grid, head[next]);
  return true;
}

function moveWithinTile(grid, tile, focusedEl, dir) {
  const controls = tileControls(tile);
  const i = controls.indexOf(focusedEl);
  if (i < 0) return;
  setNavFocus(grid, controls[clamp(i + dir, 0, controls.length - 1)]);
}

/**
 * Jumps to the nearest tile in a direction, measured centre to centre. Spatial rather than
 * index-based because the tiles wrap into a ragged three-column grid whose rows have
 * different heights — walking an index would jump diagonally at the end of each row.
 */
function moveBetweenTiles(grid, tile, dirX, dirY) {
  const tiles = /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll('.tuneBox')))
    .filter((t) => t.offsetParent !== null);
  const here = tile.getBoundingClientRect();
  const hx = here.left + here.width / 2, hy = here.top + here.height / 2;
  let best = null, bestScore = Infinity;
  for (const t of tiles) {
    if (t === tile) continue;
    const r = t.getBoundingClientRect();
    const dx = (r.left + r.width / 2) - hx, dy = (r.top + r.height / 2) - hy;
    // Must actually lie in the direction asked for.
    if (dirX && Math.sign(dx) !== dirX) continue;
    if (dirY && Math.sign(dy) !== dirY) continue;
    // Distance along the axis of travel, plus a heavy penalty for drifting off it — so
    // "right" prefers the neighbour on the same line over one a row down.
    const along = Math.abs(dirX ? dx : dy);
    const off = Math.abs(dirX ? dy : dx);
    const score = along + off * 3;
    if (score < bestScore) { bestScore = score; best = t; }
  }
  if (!best) return;
  const controls = tileControls(best);
  if (!controls.length) return;
  // Land on the fold toggle when the tile has one. Arriving on the skill's on/off icon meant
  // the first thing the stick offered was the one control that changes the run rather than the
  // panel — and on a collapsed box, opening it is the only useful thing to do anyway.
  const collapse = controls.find((c) => c.classList.contains('tuneCollapse'));
  setNavFocus(grid, collapse || controls[0]);
}

/**
 * Handles one frame of input for the tuning panel. Returns true when it took the input, so
 * the general grid navigation below leaves it alone.
 */
function tuningPanelNav(grid, focusedEl, gp, stepX, stepY) {
  const tile = focusedEl.closest && focusedEl.closest('.tuneBox');
  if (!tile) return false;

  const dL = gp.justPressed[14], dR = gp.justPressed[15];
  const dU = gp.justPressed[12], dD = gp.justPressed[13];
  const range = focusedEl.classList.contains('gpSlider')
    ? focusedEl.querySelector('input[type="range"]') : null;

  // Two devices, two jobs, no overlap.
  //
  //   STICK  moves focus, and only ever moves focus: across the header row (icon, name, MAX,
  //          Save, Reset) and up and down the list of skills.
  //   D-PAD  belongs to the stat sliders alone: down and up to step between them, left and
  //          right to change the focused one.
  //
  // They used to share: the stick made a coarse adjustment on a slider and the pad moved focus
  // as well as edited. That meant the same control did different things depending on where
  // focus happened to sit, and analogue drift could alter a tuned number while you were only
  // trying to move past it.

  // --- D-pad: sliders ---
  if (range && (dL || dR)) { nudgeRange(range, dR ? 1 : -1, true); return true; }   // fine
  // Coarse moved to the bumpers rather than being dropped: these sliders span 0.05s cooldowns
  // to 2000px ranges, and stepping one of those in fine increments is not a real option.
  if (range && (gp.justPressed[4] || gp.justPressed[5])) {
    nudgeRange(range, gp.justPressed[5] ? 1 : -1, false); return true;
  }
  if (dU || dD) { moveAmongSliders(grid, tile, focusedEl, dD ? 1 : -1); return true; }
  // Horizontal pad off a slider does nothing at all, rather than falling through to moving
  // focus — the pad's horizontal axis means "change this value" everywhere in this panel.
  if (dL || dR) return true;

  // --- Stick: focus ---
  // Walks this box's header first; once it runs out of header, it steps to the box in the next
  // column. Same shape as the vertical case below — a tile edge is a handover, not a wall.
  if (stepX) {
    const dir = Math.sign(stepX);
    if (!moveAmongHeader(grid, tile, focusedEl, dir)) moveBetweenTiles(grid, tile, dir, 0);
    return true;
  }
  if (stepY) {
    // Moving up off the TOP tile has to leave the panel, or focus is trapped: this handler
    // swallows every stick input so the flat grid cannot fight it, and moveBetweenTiles only
    // knows about tune boxes — the category icons above are not tiles, so "up" from the first
    // row found nothing and silently did nothing.
    const before = `${gpFocusRow}:${gpFocusCol}`;
    moveBetweenTiles(grid, tile, 0, Math.sign(stepY));
    if (stepY < 0 && `${gpFocusRow}:${gpFocusCol}` === before) {
      // Land on the CURRENT section's icon rather than the first, so the grid opens where you
      // already are and one press left or right is the next section along.
      const icon = document.querySelector('.devIcon.on') || document.querySelector('.devIcon');
      if (icon) setNavFocus(grid, /** @type {HTMLElement} */ (icon));
    }
    return true;
  }
  return true; // focus is on the panel: swallow the rest so the flat grid cannot fight it
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
  const buttons = visibleFocusables(overlay);
  if (!buttons.length) return false;
  const grid = computeNavGrid(buttons);
  if (overlay !== gpFocusOverlay) {
    gpFocusOverlay = overlay; gpFocusRow = 0; gpFocusCol = 0; gpLastScrolledTo = null; gpFocusEl = null;
  }
  if (!syncFocusToElement(grid, gpFocusEl)) {
    gpFocusRow = Math.min(gpFocusRow, grid.length - 1);
    gpFocusCol = Math.min(gpFocusCol, grid[gpFocusRow].items.length - 1);
  }
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
  gpFocusEl = kFocused;
  kFocused.scrollIntoView({ block: 'nearest' });
  return true;
}

function xpForLevel(level) { return Math.round(9 + level * 6.5); }

function createPlayer(classDef) {
  const up = upgradeBonuses(); // permanent shop upgrades folded into the starting build
  return {
    x: 0, y: 0, radius: PLAYER_BASE_RADIUS * (PLAYER_SPRITE_HEIGHT / PLAYER_SPRITE_SOURCE_HEIGHT),
    // The global multipliers land HERE, at the one point a run's starting numbers are built,
    // so they apply once and every later bonus stacks on top of the scaled value rather than
    // the raw one. Health is rounded: a max life of 187.5 shows up in the HUD.
    baseSpeed: classDef.base.speed * PLAYER_GLOBALS.speedMult, speedMult: 1 + up.speedMult,
    maxHp: Math.round(classDef.base.maxHp * PLAYER_GLOBALS.hpMult),
    hp: Math.round(classDef.base.maxHp * PLAYER_GLOBALS.hpMult),
    hpRegen: classDef.base.hpRegen,
    // `armor` is the MAX shield (every +armor upgrade and item still writes to it, untouched);
    // `armorLeft` is what is currently standing. Starts full.
    armor: classDef.base.armor, armorLeft: classDef.base.armor, armorTimer: 0,
    critChance: classDef.base.critChance + up.critChance, critMult: classDef.base.critMult,
    pickupRadiusMult: 1,
    itemDamageMult: 1, itemCooldownMult: 1, xpGainMult: 1 + up.xpMult,
    /** @type {Record<string, number>} */ relics: {}, relicKills: 0, silenceLeft: 0,
    /** @type {Record<string, number>} */ items: {}, castTally: 0, ashUntil: 0,
    // Chain and Fork arrive as chest affixes now rather than tomes, so they need somewhere
    // on the player to accumulate — the tome path wrote straight into mods each frame.
    itemChainBonus: 0, itemForkBonus: 0, itemPierceBonus: 0,
    level: 1, xp: 0, xpToNext: xpForLevel(1),
    activeSkills: [{ id: classDef.startSkill, level: 1, cd: 0 }],
    // Max active skill gems. Legendary chests raise this by +1 on top (stacking).
    skillCap: SKILL_SLOTS_BASE + up.skillSlots,
    rarityMult: 1, // magic-find: Rare chests' rarity-boost reward raises this (×1.05, stacking)
    // Tomes occupy a limited number of slots — 3 to start, up to 6 via the shop. The cap is
    // what forces a choice: without it every tome was eventually collected and they stacked
    // into the dominant source of power.
    supportCap: SUPPORT_SLOTS_BASE + up.supportSlots,
    supports: {},
    facing: { x: 1, y: 0 },
    // Knock-back carried from a hit by a pressured body — see shovePlayerFrom. Declared here
    // rather than left to spring into existence so the player's shape is readable in one place.
    shoveX: 0, shoveY: 0, shoveT: 0,
    // Dash: charges in hand, time left on the current burst, its direction, and the timer
    // refilling the next charge. Declared here so the player's shape stays readable in one place.
    dashCharges: DASH.charges, dashT: 0, dashDir: { x: 1, y: 0 }, dashCd: 0, dashFade: 0,
    // The dash slot. Everyone is born with the Dodge Roll in it; a found mobility skill SWAPS
    // what the button does rather than joining the gem tray — see tryDash and generateCards.
    // The Turncoat is the exception both ways: born with Void Step, and locked to it.
    mobility: { id: classDef.startMobility || 'dodgeroll', level: 1 },
    classId: classDef.id, className: classDef.name, classColor: classDef.color,
    plateImmune: !!classDef.plateImmune,
    spikedPlate: !!classDef.spikedPlate,
    immovable: !!classDef.immovable,
    // The other five class passives — one flag each, mechanics at their named sites:
    // overchannel (movement + computeMods), sharpshooter (projectile hit), boneReassembly
    // (applyDamageToPlayer + movement), miasma (killEnemy), firstStrike (damageEnemy).
    overchannel: !!classDef.overchannel,
    sharpshooter: !!classDef.sharpshooter,
    boneReassembly: !!classDef.boneReassembly,
    miasma: !!classDef.miasma,
    firstStrike: !!classDef.firstStrike,
    stillTime: 0, reassembling: 0, reassembleUsed: false,
    // The void classes' rules — see classes.js for what each means.
    voidFeeds: !!classDef.voidFeeds,
    noRegen: !!classDef.noRegen,
    sealBearer: !!classDef.sealBearer,
    collapsePacifist: !!classDef.collapsePacifist,
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

// The crit ceiling now lives in utils.js, imported above — skills.js needs the same number for
// its DPS estimate, and a second literal there had already drifted.
/** Uncapped total, for deciding whether the cap is actually biting. */
function critChanceRaw(mods) { return (S.player.critChance || 0) + ((mods && mods.critChance) || 0); }
/** What the game rolls against. */
function critChanceNow(mods) { return clamp(critChanceRaw(mods), 0, MAX_CRIT_CHANCE); }

function computeMods(p, skill) {
  const up = upgradeBonuses();
  const mods = {
    // The global player damage dial rides in here rather than on the class, because damage is
    // not a player stat — it comes out of whichever skills are equipped, and every one of them
    // multiplies by this. Read live, so moving the slider mid-run takes effect on the next
    // cast; the modsCache is keyed per skill and rebuilt when the build changes.
    damageMult: p.itemDamageMult * PLAYER_GLOBALS.damageMult * overchannelMult(p),
    cooldownMult: p.itemCooldownMult, areaMult: 1 + up.areaMult,
    projectileBonus: up.projectiles, pierceBonus: p.itemPierceBonus || 0,
    chainBonus: p.itemChainBonus || 0, forkBonus: p.itemForkBonus || 0,
    critChance: 0, critMultBonus: 0, lifeLeech: 0,
    durationMult: 1, sizeMult: 1,
  };
  for (const [id, lvl] of Object.entries(p.supports)) SUPPORTS[id].apply(mods, lvl);
  if (skill) {
    const b = skill.bonus;
    if (b) {
      if (b.damageMult) mods.damageMult *= 1 + b.damageMult;
      if (b.areaMult) mods.areaMult *= 1 + b.areaMult;
      // Area and Size are one stat now. A sizeMult roll can still exist on a save made before
      // the merge, so it folds into area rather than being dropped on the floor.
      if (b.sizeMult) mods.areaMult *= 1 + b.sizeMult;
      if (b.durationMult) mods.durationMult *= 1 + b.durationMult;
      if (b.cooldownMult) mods.cooldownMult *= Math.max(0.1, 1 - b.cooldownMult);
      if (b.projectileBonus) mods.projectileBonus += b.projectileBonus;
      if (b.pierceBonus) mods.pierceBonus += b.pierceBonus;
      if (b.chainBonus) mods.chainBonus += b.chainBonus;
      if (b.forkBonus) mods.forkBonus += b.forkBonus;
    }
    // A LIST. Every infusion the skill carries fires on each hit, so picking up Poison no longer
    // costs you your Void. `mods.infusion` stays as the FIRST one purely so the art has a single
    // element to draw — a bolt made of four things at once reads as mud.
    const inf = skillInfusions(skill);
    if (inf.length) { mods.infusions = inf; mods.infusion = inf[0]; }
  }
  // sizeMult survives as a MIRROR of areaMult, not as a second stat. Skills draw a meaningful
  // distinction with it — a fireball's projectile is sized by one and its blast by the other —
  // and collapsing those call sites would flatten that. What is gone is the second upgrade
  // feeding it independently.
  mods.sizeMult = mods.areaMult;
  // Clamped once, here, rather than at each of the half-dozen places a skill reads it — a cap
  // applied per call site is a cap that the next skill added will quietly miss.
  mods.chainBonus = Math.min(mods.chainBonus, MAX_CHAIN_BONUS);
  // Cooldown floors at -95%. Each SOURCE already clamps itself (the tome at -90%, item affixes
  // likewise) but the sources MULTIPLY, so a deep endless build was stacking its way to
  // arbitrarily small cooldowns — which is where the +316,325%-damage runs came from: not one
  // broken number, but every skill in the build casting dozens of times a second.
  mods.cooldownMult = Math.max(0.05, mods.cooldownMult);
  return mods;
}

/**
 * @param classDef the character to build
 * @param startStage which stage to open on. 0 for a normal run; the sandbox's stage launchers
 *        pass 1 or 2 to drop straight into a later realm with the director fully switched on.
 */
function resetGame(classDef, startStage = 0) {
  S.player = createPlayer(classDef);
  S.enemies = []; S.projectiles = []; S.effects = []; S.minions = []; S.pickups = []; S.dmgNumbers = []; S.toasts = []; S.bloodDecals = [];
  S.elapsed = 0; S.stageElapsed = 0; S.kills = 0; S.stageKills = 0; S.nextId = 1; S.spawnTimer = 0; S.bossSpawned = false; S.boss = null; S.pendingLevelUps = 0;
  S.beatFinalBoss = false; S.endlessWave = 0; S.minibossSpawned = false;
  // The void sits out the opening. Its introduction fires at a difficulty position rolled per
  // run, so WHICH stage first turns purple varies — see updateVoidIntro for the whole sequence
  // (omen build-up, then the card and a tear the first afflicted crawl out of).
  S.voidIntroduced = false;
  S.voidIntroAt = VOID_TUNE.introEarliest
    + Math.random() * Math.max(0, VOID_TUNE.introLatest - VOID_TUNE.introEarliest);
  S.voidIntroPhase = 'waiting';
  S.voidOmenT = 0; S.voidOmenNext = 0; S.voidTearSpawnT = 0;
  S.voidForceNext = 0;
  pendingShots = [];   // a queued volley must not fire into the next run
  terrain = generateTerrain(ARENA_RADIUS);
  eliteTimer = ELITE_TUNE.spawnEvery;
  ui.resetHpBar();          // a new run must not flash the last one's killing blow
  ui.refreshRelicBar([]);   // relics do not carry between runs
  ui.refreshItemBar([]);    // nor do items — the shelf is a run's story
  gambit = null;            // no siege survives into a new run
  saltSeen.clear();
  // The dev max-skills toggle is per-run: a new run starts from the real loadout, and a
  // snapshot taken in the previous run must not be restorable into this one.
  maxSkillsOn = false; preMaxLoadout = null;
  sandboxMode = false; // startSandboxRun turns it back on after resetGame
  S.rerollsLeft = getUpgradeLevel('reroll'); // reroll allowance for this run, from the shop upgrade
  S.keyCount = 0; // fresh run starts with no keys
  shakeAmount = 0; shakeOffset = { x: 0, y: 0 };
  S.currentStage = clamp(startStage, 0, STAGES.length - 1);
  const stageDef = STAGES[S.currentStage];
  backdropStage = S.currentStage; floorShift = null;
  stagePortal = null;   // a portal from the stage just left must not stand in the new one
  // Floor art, lighting, boundary AND set-dressing all come from the stage definition; missing
  // the re-scatter is what once left the graveyard's tombstones standing in the desert.
  floorPattern = makeFloorPattern(stageDef);
  scatterDecor(stageDef);
  playMusic(`stage${S.currentStage + 1}`);
  ui.showStageCard(stageDef.name, stageDef.flavor || '');
}

function advanceStage() {
  S.currentStage++;
  terrain = generateTerrain(ARENA_RADIUS);   // a new realm gets new rock
  const stageDef = STAGES[S.currentStage];
  S.enemies = []; S.projectiles = []; S.effects = []; S.pickups = []; S.bloodDecals = [];
  // The run clock (`elapsed`) deliberately carries over — only the per-stage pacing resets.
  S.stageElapsed = 0; S.stageKills = 0; S.spawnTimer = 0; S.bossSpawned = false; S.boss = null;
  S.minibossSpawned = false;   // the new stage's own keeper is still out there
  // The Skeleton's reassembly recharges per stage — a new land, another death owed back.
  if (S.player) S.player.reassembleUsed = false;
  saltSeen.clear();            // the Salt Ledger opens a fresh page per realm
  applyStageItems();           // Unspent Coin cashes out; Pilgrim's Ash ignites
  // Health carries over from the previous stage — no free heal on transition.
  backdropStage = S.currentStage; floorShift = null;
  stagePortal = null;   // a portal from the stage just left must not stand in the new one
  floorPattern = makeFloorPattern(stageDef);
  scatterDecor(stageDef);
  playMusic('stage' + (S.currentStage + 1));
  ui.showStageCard(stageDef.name, stageDef.flavor || 'The horde regroups in a new land.');
}

// 3x the original 14px base radius. The splatter is the only lasting mark a kill leaves on the
// floor, and at 14 it was smaller than the body that made it.
const BLOOD_BASE_RADIUS = 42;

function spawnBlood(x, y, scale = 1) {
  S.bloodDecals.push({ x, y, points: makeBlobPoints(BLOOD_BASE_RADIUS * scale, 6, 0.55), rot: rand(0, Math.PI * 2) });
  if (S.bloodDecals.length > 150) S.bloodDecals.shift();
}

// Purely decorative background set-dressing — no collision, no gameplay effect.
// Scattered once per stage and drawn at reduced opacity so it stays behind the action.
function scatterDecor(stageDef) {
  S.decorObjects = [];
  const count = 24;
  const lim = ARENA_RADIUS - 120;
  for (let i = 0; i < count; i++) {
    S.decorObjects.push({
      x: rand(-lim, lim), y: rand(-lim, lim),
      type: pick(stageDef.decor), scale: rand(0.75, 1.35), rot: rand(0, Math.PI * 2),
    });
  }
}

// ---------- main menu / pause / settings / leaderboard ----------
function showMainMenu() {
  S.state = 'MAINMENU';
  document.getElementById('classSelect').classList.add('hidden');
  document.getElementById('hud').classList.add('hidden');
  ui.showMainMenu(getGold(), getDeaths());
  syncMenuEntries();
  playMusic('mainMenu');
}
function openPause() {
  S.state = 'PAUSED';
  // Sandbox-only entry point: a normal run has no scenario to edit.
  const sb = document.getElementById('pauseSandboxBtn');
  if (sb) sb.classList.toggle('hidden', !sandboxMode);
  syncMenuEntries();
  refreshPauseStats();
  ui.showPauseMenu();
}

// Builds the pause-screen readouts: everything currently modifying the player, and everything
// currently modifying the horde. Values are shown relative to baseline so it's obvious at a
// glance what's been gained (green) or lost (red).
function refreshPauseStats() {
  if (!S.player) return;
  const m = computeMods(S.player);
  const pct = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
  // Top-level PLAYER_GLOBALS are a designer baseline, not something the player earned, so they
  // pass through this panel invisibly: a stat reads +0% at the start of a run and then reports
  // exactly what the run has added to it.
  //
  // Showing them was actively misleading. A global damage dial of 0.8 opened every run at
  // "Skill Damage -20%", which reads as a penalty the player is carrying rather than as the
  // scale the whole game is balanced on — and it made a genuine +12% relic look like -10%.
  // Dividing the baseline out is the difference between "what am I worth" and "what have I
  // gained", and this panel only ever meant the second.
  //
  // `hpMult` and `speedMult` need nothing here: the first shows as an absolute Max Life, and the
  // second is folded into baseSpeed rather than into the speedMult this panel reads.
  const rel = (v, baseline) => v / (baseline || 1) - 1;
  const playerRows = [
    ['Max Life', Math.round(S.player.maxHp), S.player.maxHp > 100],
    ['Armor', S.player.armor, S.player.armor > 0],
    ['Move Speed', pct(S.player.speedMult - 1), S.player.speedMult > 1],
    ['Skill Damage', pct(rel(m.damageMult, PLAYER_GLOBALS.damageMult)),
      rel(m.damageMult, PLAYER_GLOBALS.damageMult) > 0],
    ['Cooldown', pct(m.cooldownMult - 1), m.cooldownMult < 1],
    ['Area / Size', pct(m.areaMult - 1), m.areaMult > 1],
    ['Duration', pct(m.durationMult - 1), m.durationMult > 1],
    ['Projectiles', `+${m.projectileBonus}`, m.projectileBonus > 0],
    ['Pierce', `+${m.pierceBonus}`, m.pierceBonus > 0],
    ['Chain', `+${m.chainBonus}`, m.chainBonus > 0],
    ['Forks', `+${m.forkBonus}`, m.forkBonus > 0],
    // The CAPPED figure, which is the one the game actually rolls against. It used to print the
    // raw sum: a build stacking Crit Chance read 92% on this panel while every hit was still
    // rolled at 75%, so the last third of that investment bought nothing and the readout said
    // otherwise. Flagged when it is being held down, or "75%" looks like a coincidence.
    ['Crit Chance', pct(critChanceNow(m)) + (critChanceRaw(m) > MAX_CRIT_CHANCE ? ' (max)' : ''), true],
    ['Crit Damage', `x${((S.player.critMult || 1) + (m.critMultBonus || 0)).toFixed(2)}`, true],
    ['Life Leech', pct(m.lifeLeech || 0), (m.lifeLeech || 0) > 0],
    ['Pickup Radius', pct(S.player.pickupRadiusMult - 1), S.player.pickupRadiusMult > 1],
    // XP gain had no row at all, so the one stat the shop sells purely to speed up levelling was
    // the one stat you could not check. Normalised the same way as Skill Damage: the effective
    // rate gainXp() uses, divided by the global baseline, so it opens at +0%.
    ['XP Gain', pct(rel((S.player.xpGainMult || 1) * PLAYER_GLOBALS.xpMult, PLAYER_GLOBALS.xpMult)),
      (S.player.xpGainMult || 1) > 1],
    ['Rarity', pct((S.player.rarityMult || 1) - 1), (S.player.rarityMult || 1) > 1],
    ['Skill Slots', `${S.player.activeSkills.length} / ${S.player.skillCap || SKILL_SLOTS_BASE}`, true],
  ];
  // Tomes, listed by name and level. They no longer appear on the HUD, so this is the only
  // place to see which ones are actually stacked — and unlike the aggregate rows above, it
  // shows *which* tomes produced those numbers. The slot count is shown even at zero: an
  // empty shelf is information now that it is capped.
  const owned = SUPPORT_ORDER.filter((id) => (S.player.supports[id] || 0) > 0);
  const cap = S.player.supportCap || SUPPORT_SLOTS_BASE;
  playerRows.push(['<b>Tomes</b>', `${owned.length} / ${cap} slots`, null]);
  if (owned.length) {
    for (const id of owned) {
      playerRows.push([
        `<span style="color:${SUPPORTS[id].color}">◆</span> ${SUPPORTS[id].name}`,
        `Lv ${S.player.supports[id]}`, true,
      ]);
    }
  }
  // Per-gem readout lives in its own panel so it can't crowd out the player stats above.
  // Each active gem gets a DPS line plus a line naming its tiered-upgrade bonuses.
  const skillBlocks = [];
  let totalDps = 0;
  for (const s of S.player.activeSkills) {
    const sm = computeMods(S.player, s);
    const { dps, targets, control } = estimateSkillDps(s, sm, S.player);
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
    for (const id of skillInfusions(s)) {
      bits.push(`<span style="color:${INFUSIONS[id].color}">${INFUSIONS[id].name}</span>`);
    }
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

  const stage = STAGES[S.currentStage];
  const waveHp = curveScale('hp'), waveDmg = curveScale('damage'), waveSpd = curveScale('speed');
  const waveRate = curveScale('spawnRate');
  const enemyRows = [
    ['Stage', S.beatFinalBoss ? `Endless — Wave ${S.endlessWave}` : `${S.currentStage + 1} — ${stage.name}`, false],
    ['Stage Health', `x${stageEnemyStats().hp.toFixed(2)}`, false],
    ['Stage Damage', `x${stageEnemyStats().damage.toFixed(2)}`, false],
    ['Stage Speed', `x${stageEnemyStats().speed.toFixed(2)}`, false],
    ['Stage Spawn Rate', `x${stageEnemyStats().spawnRate.toFixed(2)}`, false],
    ['Ramp (this stage)', `x${difficultyMult(S.stageElapsed).toFixed(2)}`, false],
    ['Curve Position', `${difficultyPosition().toFixed(2)} / ${CURVE_LAST} anchors, then exponential`, false],
    ['Curve Health', `x${waveHp.toFixed(2)}`, false],
    ['Curve Damage', `x${waveDmg.toFixed(2)}`, false],
    ['Curve Speed', `x${waveSpd.toFixed(2)}`, false],
    ['Curve Spawn Rate', `x${waveRate.toFixed(2)}`, false],
    ['Live Enemies', `${S.enemies.length} / ${MAX_ENEMIES}`, false],
    ['Kills (stage)', `${S.stageKills} / ${killThresholdFor(S.currentStage)}`, false],
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
function closePause() { ui.hidePauseMenu(); S.state = 'PLAYING'; }

function openLeaderboard() {
  S.state = 'LEADERBOARD';
  ui.hideMainMenu();
  ui.showLeaderboard(getEntries(), drawRunPortrait);
}
function closeLeaderboard() {
  ui.hideLeaderboard();
  S.state = 'MAINMENU';
  ui.showMainMenu(getGold(), getDeaths());
}

function openUnlocks() {
  S.state = 'UNLOCKS';
  ui.hideMainMenu();
  ui.showUnlocks(
    SKILL_ORDER.map((id) => SKILLS[id]),
    SUPPORT_ORDER.map((id) => ({ id, ...SUPPORTS[id] })), // id carried through: it keys the tome icon
  );
}
function closeUnlocks() {
  ui.hideUnlocks();
  S.state = 'MAINMENU';
  ui.showMainMenu(getGold(), getDeaths());
}

function openAchievements() {
  S.state = 'ACHIEVEMENTS';
  ui.hideMainMenu();
  // Rows are built fresh from meta.js every time, so the panel can never show a stale count.
  ui.showAchievements(ACHIEVEMENTS.map((a) => ({
    name: a.name, desc: a.desc, tiers: a.tiers, ...achievementState(a),
  })));
}
function closeAchievements() {
  ui.hideAchievements();
  S.state = 'MAINMENU';
  ui.showMainMenu(getGold(), getDeaths());
}

function refreshShop() {
  // Hide the jukebox upgrade while it is free, rather than leaving a purchase that buys
  // something the player already has — that is a gold trap, not a shop entry.
  const rows = UPGRADES.filter((def) => !(JUKEBOX_FREE && def.id === 'musicPlayer')).map((def) => ({
    id: def.id, name: def.name, stat: def.stat,
    level: getUpgradeLevel(def.id), max: def.max,
    effect: def.pct ? `+${Math.round(def.perLevel * 100)}% ${def.stat}` : `+${def.perLevel} ${def.stat}`,
    cost: upgradeCost(def),
  }));
  ui.showShop(getGold(), rows, (id) => { if (buyUpgrade(id)) play('itemPickup'); else play('uiClick'); refreshShop(); });
}
function openShop() {
  S.state = 'SHOP';
  ui.hideMainMenu();
  refreshShop();
  // The shop and the sandbox share a playlist: both are screens you stand still on and read
  // numbers, and neither wants the title theme's swagger. Silently a no-op until the folder
  // has something in it — an empty playlist leaves the menu music playing.
  playMusic('shop');
}
function closeShop() {
  ui.hideShop();
  S.state = 'MAINMENU';
  ui.showMainMenu(getGold(), getDeaths());
}

// Dev cheat: every skill gem and tome at max level. A toggle, not a one-shot — switching it
// off restores the loadout the run actually had, so a maxed build can be compared against the
// real one without restarting. The snapshot is deep enough to survive levelling while it is on.
// True for a sandbox run: suppresses the wave spawner, the boss clock and stage advance.
let sandboxMode = false;
let maxSkillsOn = false;
let preMaxLoadout = null;

function devMaxSkills() {
  if (!S.player) { ui.showToast('Max Skills', 'Start a run first.', '#c94a3f'); return; }
  if (maxSkillsOn) {
    if (preMaxLoadout) {
      S.player.activeSkills = preMaxLoadout.skills.map((s) => ({ ...s }));
      S.player.supports = { ...preMaxLoadout.supports };
    }
    preMaxLoadout = null;
    maxSkillsOn = false;
    ui.showToast('Max Skills', 'Off — original loadout restored.', '#8a7d68');
    return;
  }
  preMaxLoadout = {
    skills: S.player.activeSkills.map((s) => ({ ...s })),
    supports: { ...S.player.supports },
  };
  for (const id of SKILL_ORDER) {
    const ex = S.player.activeSkills.find((s) => s.id === id);
    const lvl = devSkillMaxLevel(id);
    if (ex) ex.level = lvl;
    else S.player.activeSkills.push({ id, level: lvl, cd: 0 });
  }
  for (const id of SUPPORT_ORDER) S.player.supports[id] = 5; // tomes are uncapped in dev; 5 is a sane default
  maxSkillsOn = true;
  play('levelUp');
  ui.showToast('Max Skills', 'All gems granted at max level.', '#e6c14e');
}

// Ceiling for DEV-GRANTED skill levels. Skills themselves have no cap — a run can level one
// as far as the cards keep coming — but "max" has to mean a specific number for a button to
// jump to, and an unbounded one would just hang the game. 5 is where the authored numbers stop
// being tested, so that is where the button stops.
const DEV_MAX_SKILL_LEVEL = 5;

function devSkillMaxLevel(id) {
  return Math.min(DEV_MAX_SKILL_LEVEL, SKILLS[id].designLevel || DEV_MAX_SKILL_LEVEL);
}

// Equips or unequips a skill at base level. Any number can be active at once — the normal
// skill cap is deliberately bypassed so combinations can be tested freely.
function devToggleSkill(id) {
  if (!S.player) { ui.showToast('Skills', 'Start a run first.', '#c94a3f'); return; }
  const i = S.player.activeSkills.findIndex((s) => s.id === id);
  if (i >= 0) {
    S.player.activeSkills.splice(i, 1);
    play('uiClick');
  } else {
    S.player.activeSkills.push({ id, level: 1, cd: 0 });
    play('levelUp');
  }
}

// MAX is a toggle between max level and base. Pressing it on an unequipped skill equips it
// straight at max, so it doubles as a one-click "give me this at full power".

// The Dev Tools screen. Cheats, the skill toggle grid, and a live-tuning box per skill.
// Only the stats a skill actually declares in its `tune` block get sliders, so nothing
// irrelevant appears for skills that don't use a given parameter.
// Tuning is NOT kept in localStorage. It lives in one file per environment, behind /tuning and
// /entity-tuning — see loadStores. Two localStorage keys used to shadow those files and were the
// single largest source of "my tuning reverted": a per-origin copy the exe and the browser each
// held privately, invisible to the other and to the build, quietly outliving every bake.

// Hue order is fixed and was validated for colour-blind separation — see the note beside
// CURVE_SERIES in ui.js. Changing the ORDER changes which pairs sit adjacent, so it is not
// cosmetic; re-validate if a stat is added.
const CURVE_SERIES_ORDER = /** @type {('hp'|'speed'|'damage'|'spawnRate')[]} */ (
  ['hp', 'speed', 'damage', 'spawnRate']);
const CURVE_STAT_LABEL = { hp: 'Health', speed: 'Speed', damage: 'Damage', spawnRate: 'Spawn Rate' };
const CURVE_STAT_COLOR = { hp: '#c9382e', speed: '#3987e5', damage: '#c98500', spawnRate: '#9085e9' };
// Built once: each is a live accessor onto that stat's anchors, not a copy.
const curveFlatTargets = Object.fromEntries(CURVE_SERIES_ORDER.map((k) => [k, curveFlatFor(k)]));

// Three dials per stat. `end` is where the ramp lands, `bend` is where the difficulty
// arrives, `beyond` is what carries endless past the end of the shape.
const CURVE_TUNE_META = {
  // Where the run STARTS. Every curve is 1x at position 0 by construction, so without this the
  // dials could only move where difficulty arrives, never how hard the opening is. Reshapes the
  // curve rather than clamping it, so moving it does not flatten the early positions — see
  // shapeValue. 1x is off; below 1 opens softer and still climbs to the same End.
  floor:  { label: 'Start Multiplier', min: 0.1, max: 10, step: 0.05, unit: '×' },
  end:    { label: 'End Multiplier', min: 1,    max: 60, step: 0.1,   unit: '×' },
  bend:   { label: 'Bend',           min: 0.2,  max: 4,  step: 0.05 },
  tailAt: { label: 'Tail Starts At',  min: 1,    max: 25, step: 0.5 },
  beyond: { label: 'Endless Growth', min: 1,    max: 2,  step: 0.005, unit: '×' },
  // The soft clamp. `Endless Growth` is a FIXED rate — whatever it is worth at wave 1 it is
  // worth at wave 40 — which is what made endless a straight line. These two bend that line:
  // Surge compounds the growth rate itself once per wave, and Surge Starts At holds it off so
  // the opening waves stay a fair fight. Surge 1 is the old straight tail exactly.
  accel:     { label: 'Endless Surge',    min: 1, max: 1.15, step: 0.001, unit: '×' },
  accelFrom: { label: 'Surge Starts At',  min: 0, max: 20,   step: 1,     unit: ' pos' },
};
const CURVE_TUNE_KEYS = ['floor', 'end', 'bend', 'tailAt', 'beyond', 'accel', 'accelFrom'];

// Affix magnitude across the five rarities. Same two-dial shape as the difficulty curve, with
// rarity index standing in for position — Common is 1x by construction and Unique lands
// exactly on `end`, so `bend` moves the middle without touching either anchor.
const RARITY_TUNE_META = {
  end:  { label: 'Unique vs Common', min: 1,    max: 10, step: 0.1, unit: '×' },
  bend: { label: 'Bend',             min: 0.2,  max: 4,  step: 0.05 },
};
const RARITY_TUNE_KEYS = ['end', 'bend'];

// Chest tier drop chances, as percentages that always sum to 100. The underlying weights are
// relative, so these could have been any scale -- pinning them to 100 is what lets each slider
// read as the actual odds instead of a number you have to normalise in your head.
const DROP_TUNE_META = {
  common:    { label: 'Common',    min: 0, max: 100, step: 0.1, unit: '%' },
  rare:      { label: 'Rare',      min: 0, max: 100, step: 0.1, unit: '%' },
  epic:      { label: 'Epic',      min: 0, max: 100, step: 0.1, unit: '%' },
  legendary: { label: 'Legendary', min: 0, max: 100, step: 0.1, unit: '%' },
  unique:    { label: 'Unique',    min: 0, max: 100, step: 0.1, unit: '%' },
};
const DROP_TUNE_KEYS = ['common', 'rare', 'epic', 'legendary', 'unique'];

// How often a kill leaves anything at all. Separate from the tier weights above, which only
// decide WHICH chest drops once one has -- these decide whether one does.
const RATE_TUNE_META = {
  // Two orders of magnitude coarser than the other two, and deliberately so: a quarter of all
  // kills leave an orb, where a chest is well under one in a hundred. It leads the box because
  // it is the one on this list a player actually feels every second.
  xp:      { label: 'XP Orb / kill', min: 0, max: 100, step: 0.5,  unit: '%' },
  // Paired with the rate above: net XP is rate x value, so moving one without the other
  // rebalances the whole run. Shown together for exactly that reason.
  xpValue: { label: 'XP per Orb',    min: 0.05, max: 6, step: 0.05, unit: '×' },
  chest: { label: 'Chest / kill',  min: 0, max: 10,  step: 0.01, unit: '%' },
  key:   { label: 'Key / kill',    min: 0, max: 10,  step: 0.01, unit: '%' },
};
const RATE_TUNE_KEYS = ['xp', 'xpValue', 'chest', 'key'];

// Gold, split by the three contexts it is earned in. Each is a real percentage of kills rather
// than a multiplier on a base, so "what does endless pay" has a single number as its answer.
const GOLD_TUNE_META = {
  chanceNormal:  { label: 'Coin / kill — Normal',  min: 0, max: 100, step: 0.5, unit: '%' },
  chanceHorde:   { label: 'Coin / kill — Horde',   min: 0, max: 100, step: 0.5, unit: '%' },
  chanceEndless: { label: 'Coin / kill — Endless', min: 0, max: 100, step: 0.5, unit: '%' },
  perXp:         { label: 'Gold per XP',           min: 0, max: 2,   step: 0.01 },
  bossHoard:     { label: 'Boss Hoard Coins',      min: 0, max: 40,  step: 1 },
  bossCoin:      { label: 'Gold per Hoard Coin',   min: 1, max: 100, step: 1 },
  hordeStageMult: { label: 'Horde × per Stage',  min: 1, max: 4,   step: 0.05, unit: '×' },
};
const GOLD_TUNE_KEYS = Object.keys(GOLD_TUNE_META);

const POTION_TUNE_META = {
  chance: { label: 'Potion / kill', min: 0, max: 25,  step: 0.025, unit: '%' },
  heal:   { label: 'Heals % of Max Life', min: 1, max: 100, step: 1, unit: '%' },
};
const POTION_TUNE_KEYS = Object.keys(POTION_TUNE_META);

// The gold curves. Same four dials as the difficulty curve because it is the same curve form;
// only what they scale differs.
const GOLDCURVE_TUNE_META = {
  end:    { label: 'End Multiplier', min: 1,    max: 20, step: 0.1,  unit: '×' },
  bend:   { label: 'Bend',           min: 0.2,  max: 3,  step: 0.05 },
  // Units differ by curve: positions for the campaign, seconds for the horde rush. One slider
  // range has to cover both, so it runs to 120 — a tailAt of 3 means stage 3 on one and three
  // seconds on the other, which the box titles say explicitly.
  tailAt: { label: 'Shape Ends At',  min: 1,    max: 120, step: 0.5 },
  // Units differ per curve, so the label cannot state one: the campaign compounds per
  // position, the horde per five minutes (beyondPer). Range widened for the horde's
  // coarser unit, where anything under ~1.2 is a barely-rising tail.
  beyond: { label: 'Endless Growth', min: 1,    max: 8,  step: 0.005, unit: '×' },
};
const GOLDCURVE_TUNE_KEYS = Object.keys(GOLDCURVE_TUNE_META);

// The live objects each domain edits, so one set of helpers can serve both.
const ENTITY_DOMAINS = {
  classes: {
    meta: CLASS_TUNE_META,
    keys: CLASS_TUNE_KEYS,
    // Base stats live on the class definition; the running player copied them at spawn.
    target: (id) => (CLASSES.find((c) => c.id === id) || {}).base,
    list: () => CLASSES.map((c) => ({ id: c.id, name: c.name, color: c.color })),
  },
  // Across-the-board player multipliers. Applied when a run starts (and, for damage, live per
  // cast), so unlike the per-class boxes below this one moves every class at once.
  player: {
    meta: PLAYER_TUNE_META,
    keys: PLAYER_TUNE_KEYS,
    target: (_id) => PLAYER_GLOBALS,
    list: () => [{ id: 'global', name: 'All Players', color: '#c9a227' }],
  },
  // How gold grows across a run. Two curves: the campaign one that carries into endless, and
  // the horde one that only exists at the end of stages 1 and 2.
  goldcurve: {
    meta: GOLDCURVE_TUNE_META,
    keys: GOLDCURVE_TUNE_KEYS,
    target: (id) => GOLD_CURVE[id],
    list: () => [
      { id: 'campaign', name: 'Gold Curve — Campaign & Endless', color: '#e6c14e' },
      { id: 'horde', name: 'Gold Curve — Horde Rush (per second)', color: '#d08a3f' },
    ],
    afterChange: () => ui.redrawGoldChart(),
  },
  // The dodge, sitting under the player multipliers because it is a player capability rather
  // than a skill — it belongs to every class and is never equipped.
  dash: {
    meta: DASH_TUNE_META,
    keys: Object.keys(DASH_TUNE_META),
    target: (_id) => DASH,
    list: () => [{ id: 'dodge', name: 'Dodge', color: '#cdd3dd' }],
  },
  // Gold, per context. The three chances are the point of this box.
  gold: {
    meta: GOLD_TUNE_META,
    keys: GOLD_TUNE_KEYS,
    target: (_id) => GOLD_RATES,
    list: () => [{ id: 'gold', name: 'Gold', color: '#e6c14e' }],
    // hordeStageMult feeds the horde readout, so this box has to refresh it too — the curves
    // are not the only thing those numbers depend on.
    afterChange: () => ui.redrawGoldChart(),
  },
  potions: {
    meta: POTION_TUNE_META,
    keys: POTION_TUNE_KEYS,
    target: (_id) => POTION_RATES,
    list: () => [{ id: 'potion', name: 'Health Potions', color: '#c1443c' }],
  },
  // Relics. One flat store (RELIC_TUNE) shown as one box per relic, because each relic owns a
  // different handful of keys — devEntityList filters by what the target actually holds, so the
  // per-relic key lists come from RELIC_TUNE_META rather than one domain-wide list.
  relics: {
    meta: { ...RELIC_GLOBAL_TUNE_META, ...Object.assign({}, ...Object.values(RELIC_TUNE_META)) },
    keys: Object.keys(RELIC_GLOBAL_TUNE_META),
    target: (_id) => RELIC_TUNE,
    list: () => [{ id: 'global', name: 'Relic Drops', color: '#c9a227' }],
  },
  graphics: {
    meta: GRAPHICS_TUNE_META,
    keys: Object.keys(GRAPHICS_TUNE_META),
    target: (_id) => GRAPHICS_TUNE,
    list: () => [{ id: 'global', name: 'Rendering', color: '#7a56d2' }],
  },
  terrain: {
    meta: TERRAIN_TUNE_META,
    keys: Object.keys(TERRAIN_TUNE_META),
    target: (_id) => TERRAIN_TUNE,
    list: () => [{ id: 'global', name: 'Terrain', color: '#7a6f5f' }],
  },
  // Rock colour is per stage — each floor's art is different, and a tint that flatters the
  // graveyard reads wrong against the sands. One box per stage, keyed by stage id.
  terraincolors: {
    meta: TERRAIN_COLOR_META,
    keys: Object.keys(TERRAIN_COLOR_META),
    target: (id) => TERRAIN_COLOR_TUNE[id],
    list: () => STAGES.map((st) => ({ id: st.id, name: st.name, color: '#7a6f5f' })),
  },
  elites: {
    meta: ELITE_TUNE_META,
    keys: Object.keys(ELITE_TUNE_META),
    target: (_id) => ELITE_TUNE,
    list: () => [{ id: 'global', name: 'Elites', color: '#c9382e' }],
  },
  // How often the void takes a body, what that does to it, and the dials behind each of the
  // four powers — so the affliction rate can be dialled in against the powers themselves
  // rather than one being guessed from the other.
  void: {
    meta: VOID_TUNE_META,
    keys: Object.keys(VOID_TUNE_META),
    target: (_id) => VOID_TUNE,
    list: () => [{ id: 'global', name: 'Void Afflicted', color: '#7a56d2' }],
  },
  // How often anything drops at all.
  rates: {
    meta: RATE_TUNE_META,
    keys: RATE_TUNE_KEYS,
    target: (_id) => LOOT_RATES,
    list: () => [{ id: 'perKill', name: 'Per-Kill Drop Rates', color: '#c9a227' }],
  },
  // How often each chest tier drops.
  drops: {
    meta: DROP_TUNE_META,
    keys: DROP_TUNE_KEYS,
    target: (_id) => CHEST_WEIGHTS,
    list: () => [{ id: 'weights', name: 'Drop Chance', color: '#4a6fa5' }],
    afterChange: () => ui.redrawLootChart(),
  },
  // How much an affix is worth at each rarity.
  rarity: {
    meta: RARITY_TUNE_META,
    keys: RARITY_TUNE_KEYS,
    target: (_id) => RARITY_CURVE,
    list: () => [{ id: 'affixes', name: 'Affix Value', color: '#9a4fbf' }],
    afterChange: () => { applyRarityCurve(); ui.redrawLootChart(playerLuck()); },
  },
  // The global escalation curve, one box of three dials per stat. The shape IS the curve —
  // there are no per-stage numbers underneath it to drift out of agreement with the picture.
  curve: {
    meta: CURVE_TUNE_META,
    keys: CURVE_TUNE_KEYS,
    target: (id) => curveFlatTargets[id],
    list: () => CURVE_SERIES_ORDER.map((k) => ({ id: k, name: CURVE_STAT_LABEL[k], color: CURVE_STAT_COLOR[k] })),
    afterChange: () => ui.redrawCurveChart(),
  },
  // One box, not twenty. Per-enemy sliders were the wrong altitude for balancing: the whole
  // roster is derived from these four dials, so this is where a change actually belongs.
  // `target` is the globals object itself, and every edit re-derives the roster from the
  // authored numbers — see applyEnemyGlobals.
  // The synthesised-effect bus. One dial, because the useful control over a family of generated
  // sounds is "all of them, quieter".
  procfx: {
    meta: PROC_FX_TUNE_META,
    keys: Object.keys(PROC_FX_TUNE_META),
    target: (_id) => PROC_FX,
    list: () => [{ id: 'bus', name: 'Procedural FX', color: '#7a9ec2' }],
    afterChange: () => applyProceduralVolume(),
  },
  // Its opposite number: one dial over every recorded sample. The two sit side by side on the
  // sound page because the only question worth asking about either is how it balances against
  // the other.
  samplefx: {
    meta: SAMPLE_FX_TUNE_META,
    keys: Object.keys(SAMPLE_FX_TUNE_META),
    target: (_id) => SAMPLE_FX,
    list: () => [{ id: 'bus', name: 'Recorded FX', color: '#5ac8f0' }],
  },
  // How often each tier turns up on a level-up card. Lives beside the loot rarity dials on the
  // Rarity page because they answer the same question about two different reward streams.
  // The +damage% a skill level-up grants, priced against the Damage tome — see SKILL_DAMAGE.
  skillroll: {
    meta: SKILL_DAMAGE_TUNE_META,
    keys: SKILL_DAMAGE_KEYS,
    target: (_id) => SKILL_DAMAGE,
    list: () => [{ id: 'damage', name: 'Skill Level-Up Damage', color: '#c94a3f' }],
    afterChange: () => ui.refreshUpgradeOdds(upgradeOddsRows()),
  },
  upgrades: {
    meta: UPGRADE_ROLL_TUNE_META,
    keys: UPGRADE_ROLL_KEYS,
    target: (_id) => UPGRADE_ROLL,
    list: () => [{ id: 'roll', name: 'Level-Up Roll', color: '#9a4fbf' }],
  },
  // One dial over the whole shelf, so the tomes can be moved as a group without nine edits.
  tomemaster: {
    meta: TOME_MASTER_TUNE_META,
    keys: Object.keys(TOME_MASTER_TUNE_META),
    target: (_id) => TOME_MASTER,
    list: () => [{ id: 'all', name: 'All Tomes', color: '#c9a227' }],
    afterChange: () => ui.redrawTomeChart(),
  },
  // Tome growth curves. Same four dials as the difficulty curve, with tome level on the x axis.
  tomes: {
    meta: TOME_TUNE_META,
    keys: Object.keys(TOME_TUNE_META),
    target: (id) => TOME_CURVE[id],
    // Counting tomes sort to the END of the grid, so the dial order matches the chart order:
    // the seven proportional tomes and their chart sit together at the top, and Quantity's box
    // lands beside the counting chart underneath rather than three rows away from it.
    // Stable otherwise — this only moves the counting ones, and it does not touch SUPPORT_ORDER,
    // which the chart palette indexes into (reordering that would reshuffle every line colour).
    list: () => [...SUPPORT_ORDER]
      .sort((a, b) => (COUNTING_TOMES.has(a) ? 1 : 0) - (COUNTING_TOMES.has(b) ? 1 : 0))
      .map((id) => ({ id, name: SUPPORTS[id].name, color: SUPPORTS[id].color })),
    afterChange: () => ui.redrawTomeChart(),
  },
  // Recorded sounds. Unlike every other domain these dials do not change game maths at all —
  // they change how a sample is cut up before playing, which is why they live beside the
  // waveform that shows the cut rather than in a list of numbers.
  samples: {
    meta: SAMPLE_TUNE_META,
    keys: Object.keys(SAMPLE_TUNE_META),
    target: (id) => SAMPLES[id],
    list: () => Object.keys(SAMPLES).map((id) => ({
      id,
      name: id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
      color: '#5ac8f0',
    })),
  },
  enemies: {
    meta: ENEMY_TUNE_META,
    keys: ENEMY_TUNE_KEYS,
    // Takes an id it ignores, so both domains share one call signature.
    target: (_id) => ENEMY_GLOBALS,
    list: () => [{ id: 'global', name: 'All Enemies', color: '#8a4038' }],
    afterChange: applyEnemyGlobals,
  },
};

// Shipped values, captured before any stored override lands on top. Reset needs something to
// go back TO, and once an override has been applied the original is otherwise gone — the
// module-level literal was overwritten in place.
const entityShipped = {};
for (const [domain, d] of Object.entries(ENTITY_DOMAINS)) {
  entityShipped[domain] = {};
  for (const { id } of d.list()) {
    const t = d.target(id);
    if (!t) continue;
    entityShipped[domain][id] = Object.fromEntries(
      d.keys.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
  }
}

/**
 * How many saved overrides are sitting on top of the baked values, across both stores.
 *
 * Surfaced in Dev Tools because the store is invisible otherwise: the numbers in the panel look
 * like the game's numbers whether they came from the build or from a save made months ago, and
 * there was no way to tell which. A count is the difference between "my tuning reverted" being a
 * mystery and being a thing you can see and clear.
 */
function storedTuneCount() {
  let n = 0;
  const ent = readEntityStore();
  for (const dom of Object.values(ent)) {
    for (const vals of Object.values(dom || {})) n += Object.keys(vals || {}).length;
  }
  for (const vals of Object.values(storedTunes())) n += Object.keys(vals || {}).length;
  return n;
}

/**
 * Throw away every saved override so the game runs on exactly what this build baked.
 *
 * Deliberately blunt. Baking already copied these values into the source — that is what baking
 * IS — so the stored copy is redundant the moment it lands, and the only thing it can do from
 * then on is go stale and undo a later change. Nothing of value is lost that is not already in
 * the release.
 */
function clearStoredTunes() {
  entityStore = {};
  tuneStore = {};
  // Re-publish the now-empty stores so the repo's tuning files stop carrying them too, otherwise
  // the next bake would fold the same stale numbers straight back into the source.
  publishEntityTune({});
  publishTune({});
}

function readEntityStore() { return entityStore; }

/**
 * Apply saved overrides on top of the baked values.
 *
 * The store is a SCRATCHPAD for changes that have not been baked yet — nothing more. Once a
 * value is baked it lives in the source and the stored copy is redundant; the only thing it can
 * still do is go stale and quietly undo a later rebalance, which is exactly what it did to the
 * tome curves across three builds running.
 *
 * There is no cleverness here on purpose. An earlier attempt stamped each override with the
 * baked value it was made against and dropped it when that moved — more rules, same outcome,
 * and one more thing to reason about when the numbers looked wrong. The store is cleared by
 * "Reset Tuning to Baked" in Dev Tools instead: a bake is a deliberate act, so clearing what it
 * superseded should be one too, and it should be visible.
 */
function applyStoredEntityTunes() {
  const all = entityStore;
  for (const [domain, d] of Object.entries(ENTITY_DOMAINS)) {
    for (const [id, over] of Object.entries(all[domain] || {})) {
      const t = d.target(id);
      if (!t) continue;                       // a stale save naming something that no longer exists
      for (const [k, v] of Object.entries(over)) {
        if (d.meta[k] && typeof v === 'number') t[k] = v;
      }
    }
  }
}

const entitySaveTimers = new Map();
function persistEntitySoon(domain, id) {
  const key = `${domain}/${id}`;
  clearTimeout(entitySaveTimers.get(key));
  entitySaveTimers.set(key, setTimeout(() => {
    entitySaveTimers.delete(key);
    persistEntity(domain, id);
  }, TUNE_AUTOSAVE_DELAY));
}

// Only the keys that actually differ from shipped are written. Storing the whole stat block
// would mean a future balance change to a stat you never touched could never reach you — your
// save would keep pinning it to the old number forever.
function persistEntity(domain, id) {
  const d = ENTITY_DOMAINS[domain];
  const t = d && d.target(id);
  if (!t) return;
  const base = (entityShipped[domain] || {})[id] || {};
  const diff = {};
  for (const k of d.keys) {
    if (t[k] === undefined) continue;
    if (Math.abs(t[k] - base[k]) > 1e-9) diff[k] = t[k];
  }
  const all = readEntityStore();
  all[domain] = all[domain] || {};
  if (Object.keys(diff).length) all[domain][id] = diff;
  else delete all[domain][id];
  entityStore = all;
  publishEntityTune(all);
}

// Same hop as publishTune, to its own endpoint and its own repo file.
function publishEntityTune(all) {
  try {
    fetch('/entity-tuning', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(all),
    }).catch(() => {});
  } catch { /* no fetch, or blocked — localStorage still holds it */ }
}

function resetEntity(domain, id) {
  const d = ENTITY_DOMAINS[domain];
  const t = d && d.target(id);
  if (!t) return;
  Object.assign(t, (entityShipped[domain] || {})[id] || {});
  if (d.afterChange) d.afterChange();
  clearTimeout(entitySaveTimers.get(`${domain}/${id}`));
  entitySaveTimers.delete(`${domain}/${id}`);
  const all = readEntityStore();
  if (all[domain]) delete all[domain][id];
  entityStore = all;
  publishEntityTune(all);
}

// Rows for the dev panel: only the keys an entity actually declares, in a fixed order.
// Magic find of the run in progress, or 1 on the main menu. The loot chart shows what THIS
// character's odds are, which is only meaningful while there is one.
function playerLuck() {
  return (S.player && S.player.rarityMult) || 1;
}

/**
 * @param {string} domain
 * @param {string[]} [keys] which of the domain's keys to DRAW. Defaults to all of them.
 *   A view, not a subset of the domain: storage, reset and baking all still work from the
 *   domain's own key list, so a dial shown on a different page is the same stored value and
 *   cannot drift from the one it was split off from.
 */
/**
 * Level-up tier odds at a few representative Rarity stats, plus the thing a player actually
 * experiences: the chance that AT LEAST ONE of the three offered cards is Epic or better.
 * Five relative weights are unreadable on their own — that last column is what "rarity feels too
 * high" is really about, and it is the number to tune against.
 */
function upgradeOddsRows() {
  const CARDS = 3;
  return [
    { label: 'No Rarity, mid run',  luck: 1,    prog: 0.5 },
    { label: 'No Rarity, late',     luck: 1,    prog: 1 },
    { label: '+22% Rarity, late',   luck: 1.22, prog: 1 },
    { label: '+50% Rarity, late',   luck: 1.5,  prog: 1 },
  ].map((r) => {
    const odds = upgradeTierOdds(r.luck, r.prog);
    const epicPlus = odds.slice(2).reduce((s, o) => s + o.p, 0);
    return {
      label: r.label,
      tiers: odds.map((o) => ({ name: o.tier.name, color: o.tier.color, pct: o.p * 100 })),
      anyEpic: (1 - Math.pow(1 - epicPlus, CARDS)) * 100,
    };
  });
}

function devEntityList(domain, keys) {
  const d = ENTITY_DOMAINS[domain];
  const use = keys || d.keys;
  return d.list().map((e) => {
    const t = d.target(e.id) || {};
    return {
      ...e,
      stats: use
        .filter((k) => t[k] !== undefined && d.meta[k])
        .map((k) => ({ key: k, value: t[k], ...d.meta[k] })),
    };
  });
}

// ---------- ONE store ----------
// Tuning lives in exactly one place per environment: the JSON the server holds behind /tuning
// and /entity-tuning. The dev server keeps it in tuning/*.json in the repo; the packaged exe
// keeps it in userData. Both are read at startup and written on change, through the same two
// routes, so the page needs no branch of its own.
//
// localStorage used to be the runtime authority with those files as a write-only export, which
// meant three copies of every number (localStorage, file, baked source) and nothing keeping them
// in step. Values that had already been baked kept being re-applied from a localStorage copy
// nobody could see, silently reverting later rebalances — three builds running, and each time it
// looked like the tuning had "got screwed up" rather than like a stale shadow winning.
//
// These two objects are a MIRROR of the file, not a second source of truth: every write goes to
// the server, and nothing reads them back except to compute the next diff.
/** @type {Record<string, any>} */ let tuneStore = {};
/** @type {Record<string, any>} */ let entityStore = {};

/**
 * Pull both stores and apply them over the baked values.
 *
 * Async, and deliberately not awaited by anything: the game reads every tuned number live — a
 * skill reads its `tune` block on each cast, the panel reads the target objects when it opens —
 * so values arriving a frame or two into the title screen is invisible. Blocking startup on a
 * fetch to make it synchronous would trade a real cost for a theoretical one.
 */
async function loadStores() {
  const get = async (route) => {
    try {
      const r = await fetch(route, { cache: 'no-store' });
      const j = await r.json();
      return (j && typeof j === 'object') ? j : {};
    } catch { return {}; }   // no server (file://, or serving statically) — baked values stand
  };
  [tuneStore, entityStore] = await Promise.all([get('/tuning'), get('/entity-tuning')]);
  applyStoredTunes(tuneStore);
  applyStoredEntityTunes();
  if (S.state === 'DEVTOOLS') refreshDevTools();
}

// Slider drags fire `input` continuously, so writing to storage on every one of them would
// mean hundreds of serialise-and-write cycles per adjustment. Coalesced instead: the last
// change for a skill wins, written a beat after you stop moving.
const TUNE_AUTOSAVE_DELAY = 250; // ms of quiet before the write
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const tuneSaveTimers = new Map();

function persistTuneSoon(id) {
  clearTimeout(tuneSaveTimers.get(id));
  tuneSaveTimers.set(id, setTimeout(() => { tuneSaveTimers.delete(id); persistTune(id); }, TUNE_AUTOSAVE_DELAY));
}

// Anything still waiting on its debounce is written out immediately. Called when the tuning
// panel closes and before the window goes away, so a value adjusted and then abandoned in the
// same breath is not lost to the 250ms gap.
function flushPendingTunes() {
  for (const [id, t] of tuneSaveTimers) { clearTimeout(t); persistTune(id); }
  tuneSaveTimers.clear();
}
window.addEventListener('pagehide', flushPendingTunes);
window.addEventListener('beforeunload', flushPendingTunes);

function persistTune(id) {
  const saved = saveTune(id);
  if (!saved) return;
  const all = { ...tuneStore, [id]: saved };
  tuneStore = all;
  publishTune(all);
}

// Hands the whole tuning state to the dev server, which writes it into the repo at
// tuning/skill-tuning.json — the file `npm run dist:portable` bakes into src/skills.js before
// it builds. That is what makes tuning done in the browser reach a shipped release.
//
// localStorage alone could never do that: it is per-origin, so the testing browser and the
// packaged exe keep entirely separate copies and neither is visible to a build running in
// Node. Balance work was being lost in exactly that gap.
//
// Fire-and-forget, and silent on failure by design: the stock http.server and the packaged
// exe both 404 or 501 this, and neither is a situation the player should see an error about.
// The values are already safe in localStorage; this is the extra hop to the repo.
function publishTune(all) {
  try {
    fetch('/tuning', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(all),
    }).catch(() => {});
  } catch { /* no fetch, or blocked — localStorage still holds it */ }
}

function storedTunes() { return tuneStore; }

// Removes one skill's stored override, leaving every other skill's alone.
function forgetStoredTune(id) {
  {
    const all = { ...tuneStore };
    if (!(id in all)) return;
    delete all[id];
    tuneStore = all;
    // Publish the removal as well. Without this, Reset would clear the value locally while the
    // repo file kept it, and the next build would quietly bake back the number you just undid.
    publishTune(all);
  }
}


loadStores();   // fetched, then applied — see the note on loadStores

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

/**
 * A COMPLETE wipe — everything a player has accumulated, gone.
 *
 * It used to keep the leaderboard, which made it useless for the one job it is asked to do:
 * "reset me to a brand-new player" is not satisfied by a menu still listing ten of your runs.
 * If a category of player data is added later it belongs in this function, and the smoke test
 * `zeroing out clears every player-data store` will fail until it is.
 *
 * Deliberately NOT cleared: audio/graphics/input settings, which are preferences rather than
 * progress, and skill tuning, which is dev-tools state rather than a player's save.
 */
function zeroItOut() {
  resetMeta();                       // gold, purchased upgrades, lifetime kills and deaths
  clearEntries();                    // and the leaderboard — a wipe that leaves times is not one
  setSetting('godMode', false);
  setSetting('infiniteRerolls', false);
  setSetting('allUpgrades', false);
  setAllUpgrades(false);             // the live overlay, not just the stored flag
  S.keyCount = 0;
  S.player = null;                     // drop any run in progress
  S.state = 'MAINMENU';
  ui.hidePauseMenu();
  ui.hideDevTools();
  showMainMenu();
  ui.showToast('Zeroed Out', 'Gold, upgrades, kills, deaths and the leaderboard are gone.', '#e6c14e');
}

function devSkillList() {
  return SKILL_ORDER.map((id) => {
    const def = SKILLS[id];
    const tune = def.tune || {};
    const stats = Object.keys(tune)
      .filter((k) => TUNE_META[k])
      .map((k) => ({ key: k, value: tune[k], ...TUNE_META[k] }));
    const owned = S.player && S.player.activeSkills.find((s) => s.id === id);
    return {
      id, name: def.name, color: def.color, icon: def.icon, category: def.category, stats,
      // Projected at 1 / 10 / 20 so the SHAPE of the scaling is visible. Most gems cap at 5;
      // 10 and 20 are extrapolations, and labelled as such, because a per-level value that
      // looks harmless at max level can still be the thing that breaks a long run.
      damageAt: [1, 10, 20].map((lvl) => ({ lvl, ...(skillDamageAt(id, lvl) || {}) })),
      active: !!owned,
    };
  });
}

let devReturnState = 'PAUSED';

function openDevTools() {
  // Only capture the return state on a genuine open. Re-entering while already open — a
  // double click, or a mouse click and controller A landing in the same frame — would
  // otherwise record DEVTOOLS as the place to go back to, and closing would then restore a
  // state with no menu on screen at all: a black screen with no way out.
  if (S.state !== 'DEVTOOLS') devReturnState = S.state;
  S.state = 'DEVTOOLS';
  renderDevTools();
}

function renderDevTools() {
  // Run-only sections key off where we came from, not the current state.
  const inRun = devReturnState === 'PAUSED' && !!S.player;
  // Reachable from both the pause menu and the main menu — hide whichever we came from.
  ui.hidePauseMenu();
  ui.hideMainMenu();
  ui.showDevTools(
    { godMode: getSettings().godMode, infiniteRerolls: getSettings().infiniteRerolls,
      perfProfiler: PERF.on, storedTuneCount: storedTuneCount(),
      allUpgrades: getSettings().allUpgrades, skillList: devSkillList(), inRun, maxSkills: maxSkillsOn,
      classList: devEntityList('classes'), enemyList: devEntityList('enemies', ENEMY_PAGE_KEYS),
      curveList: devEntityList('curve'), rarityList: devEntityList('rarity'),
      // The two strips under the Enemy Stats box. Same domain and same entity id as that box, so
      // all three write one stored entry — only the drawn keys differ.
      enemyHpList: devEntityList('enemies', ['hpMult'])
        .map((e) => ({ ...e, name: 'Enemy Health', color: '#8a4038' })),
      bossHpList: devEntityList('enemies', BOSS_HP_KEYS)
        .map((e) => ({ ...e, name: 'Boss Health Pools', color: '#c94a3f' })),
      goldList: devEntityList('gold'), potionList: devEntityList('potions'),
      dashList: devEntityList('dash'),
      goldCurveList: devEntityList('goldcurve'),
      // Which of the three gold rates is live right now. With three percentages on screen and
      // no way to tell which one the game is currently using, tuning them is guesswork.
      goldCtx: S.player ? goldContext() : null,
      goldChance: +(goldDropChance(S.player ? goldContext() : 'normal') * 100).toFixed(1),
      goldMult: +(S.player ? goldMultNow(goldContext()) : 1).toFixed(2),
      hordeSeconds: +(stagePortal ? stagePortal.t : 0).toFixed(1),
      sampleList: devEntityList('samples'), procFxList: devEntityList('procfx'),
      sampleFxList: devEntityList('samplefx'),
      upgradeList: devEntityList('upgrades'), upgradeOdds: upgradeOddsRows(),
      skillRollList: devEntityList('skillroll'),
      tomeList: devEntityList('tomes'), tomeMasterList: devEntityList('tomemaster'),
      dropList: devEntityList('drops'), rateList: devEntityList('rates'),
      playerList: devEntityList('player'),
      relicGlobal: devEntityList('relics'),
      eliteList: devEntityList('elites'),
      voidList: devEntityList('void'),
      terrainList: devEntityList('terrain'),
      terrainColorList: devEntityList('terraincolors'),
      graphicsList: devEntityList('graphics'),
      relicList: RELIC_ORDER.map((id) => ({
        id, name: RELICS[id].name, color: RELICS[id].color,
        stats: Object.entries(RELIC_TUNE_META[id] || {})
          .map(([k, m]) => ({ key: k, value: RELIC_TUNE[k], ...m })),
      })).filter((r) => r.stats.length) },
    {
      onToggleGod: () => { setSetting('godMode', !getSettings().godMode); refreshDevTools(); },
      onToggleRerolls: () => { setSetting('infiniteRerolls', !getSettings().infiniteRerolls); refreshDevTools(); },
      // Deliberately not persisted: profiling is something you switch on for a minute, and a
      // stray readout stuck on the HUD across sessions is worse than having to click it again.
      onTogglePerf: () => { PERF.on = !PERF.on; PERF.acc = {}; PERF.avg = {}; refreshDevTools(); },
      onClearStoredTunes: () => { clearStoredTunes(); refreshDevTools(); },
      // The setting is the record; setAllUpgrades is the live overlay meta.js reads through.
      // Both are set together here and at boot, so they cannot disagree.
      onToggleAllUpgrades: () => {
        const on = !getSettings().allUpgrades;
        setSetting('allUpgrades', on);
        setAllUpgrades(on);
        // A run already under way folded the old bonuses into the player when it started, so
        // say plainly that this lands on the next run rather than appearing to do nothing.
        ui.showToast(on ? 'All Upgrades ON' : 'All Upgrades OFF',
          S.player ? 'Applies from your next run.' : 'Applies to your next run.',
          on ? '#e6c14e' : '#cdd3dd');
        refreshDevTools();
      },
      onMaxSkills: () => { devMaxSkills(); refreshDevTools(); },
      onToggleSkill: (id) => { devToggleSkill(id); refreshDevTools(); },
      // Live edit: writing straight into the skill's tune block takes effect on the next cast,
      // and is then persisted automatically.
      //
      // It used to persist ONLY when you pressed Save, which meant every slider you moved and
      // did not explicitly save was discarded when the game closed — balance work silently
      // evaporating with no indication it had. Tuning is the whole point of this panel, so
      // keeping a change is now the default and there is nothing to remember.
      onTune: (id, key, value) => {
        if (!SKILLS[id] || !SKILLS[id].tune) return;
        SKILLS[id].tune[key] = value;
        // The damage projection is derived from these numbers, so it has to be repainted here.
        // Only that row — a full rebuild would replace the slider being dragged.
        ui.refreshSkillProjection(id);
        persistTuneSoon(id);
      },
      // Player and enemy stats. Written straight into the live definition, so an enemy
      // spawned on the next tick already uses the new number, then persisted like the skills.
      classTune: {
        onTune: (id, key, value) => {
          const t = ENTITY_DOMAINS.classes.target(id);
          if (t) { t[key] = value; persistEntitySoon('classes', id); }
        },
        onReset: (id) => { resetEntity('classes', id); refreshDevTools(); },
      },
      playerTune: {
        onTune: (id, key, value) => { PLAYER_GLOBALS[key] = value; persistEntitySoon('player', id); },
        onReset: (id) => { resetEntity('player', id); refreshDevTools(); },
      },
      // Every relic dial writes into the one flat RELIC_TUNE, so they all persist under the
      // single 'relics' entity no matter which box they were dragged in.
      graphicsTune: {
        onTune: (_id, key, value) => { GRAPHICS_TUNE[key] = value; persistEntitySoon('graphics', 'global'); },
        onReset: (_id) => { resetEntity('graphics', 'global'); refreshDevTools(); },
      },
      terrainTune: {
        onTune: (_id, key, value) => {
          TERRAIN_TUNE[key] = value;
          // Colour dials feed a cache; layout dials feed the generator. Dropping the cache is
          // cheap enough to do unconditionally, but regenerating is not — that would rebuild the
          // arena on every pixel of a slider drag — so it is limited to the keys that need it.
          floorAvgCache.clear();
          if (TERRAIN_LAYOUT_KEYS.has(key) && S.player) terrain = generateTerrain(ARENA_RADIUS);
          persistEntitySoon('terrain', 'global');
        },
        // Rebuilt immediately so a slider drag is visible on the field rather than next stage.
        onReset: (_id) => { resetEntity('terrain', 'global'); terrain = generateTerrain(ARENA_RADIUS); refreshDevTools(); },
      },
      // Colour only, never layout — no dial here regenerates anything, so a drag re-tints the
      // rocks on screen instantly and each stage keeps its own saved set.
      terrainColorTune: {
        onTune: (id, key, value) => {
          if (TERRAIN_COLOR_TUNE[id]) TERRAIN_COLOR_TUNE[id][key] = value;
          persistEntitySoon('terraincolors', id);
        },
        onReset: (id) => { resetEntity('terraincolors', id); refreshDevTools(); },
      },
      eliteTune: {
        onTune: (_id, key, value) => { ELITE_TUNE[key] = value; persistEntitySoon('elites', 'global'); },
        onReset: (_id) => { resetEntity('elites', 'global'); refreshDevTools(); },
      },
      voidTune: {
        onTune: (_id, key, value) => { VOID_TUNE[key] = value; persistEntitySoon('void', 'global'); },
        onReset: (_id) => { resetEntity('void', 'global'); refreshDevTools(); },
      },
      relicTune: {
        onTune: (_id, key, value) => { RELIC_TUNE[key] = value; persistEntitySoon('relics', 'global'); },
        onReset: (_id) => { resetEntity('relics', 'global'); refreshDevTools(); },
      },
      rateTune: {
        onTune: (id, key, value) => { LOOT_RATES[key] = value; persistEntitySoon('rates', id); },
        onReset: (id) => { resetEntity('rates', id); refreshDevTools(); },
      },
      dropTune: {
        onTune: (id, key, value) => {
          // These read as percentages, so they are kept summing to 100: the moved tier takes
          // the value you set and the other four share what is left, in their existing
          // proportions to each other.
          //
          // Without this the sliders lie. Weights are relative, so dragging Unique from 1 to 50
          // silently drops Common from 66.6% to 44.7% while its slider still reads 66.6 — the
          // number on screen stops being the odds. Rebalancing makes every slider mean the same
          // thing as the readout above it.
          const others = DROP_TUNE_KEYS.filter((k) => k !== key);
          const v = Math.max(0, Math.min(100, value));
          const rest = 100 - v;
          const sumOthers = others.reduce((a, k) => a + CHEST_WEIGHTS[k], 0);
          CHEST_WEIGHTS[key] = v;
          for (const k of others) {
            // If the others are all at zero there are no proportions to preserve, so split the
            // remainder evenly rather than dividing by zero.
            CHEST_WEIGHTS[k] = sumOthers > 0
              ? (CHEST_WEIGHTS[k] / sumOthers) * rest
              : rest / others.length;
          }
          ui.refreshDropRows(Object.fromEntries(DROP_TUNE_KEYS.map((k) => [k, CHEST_WEIGHTS[k]])));
          ui.redrawLootChart(playerLuck());
          persistEntitySoon('drops', id);
        },
        onReset: (id) => { resetEntity('drops', id); refreshDevTools(); },
      },
      rarityTune: {
        onTune: (id, key, value) => {
          RARITY_CURVE[key] = value;
          applyRarityCurve();                    // the defs are what the roller reads
          ui.redrawLootChart(playerLuck());
          persistEntitySoon('rarity', id);
        },
        onReset: (id) => { resetEntity('rarity', id); refreshDevTools(); },
      },
      skillRollTune: {
        onTune: (id, key, value) => {
          SKILL_DAMAGE[key] = value;
          ui.refreshUpgradeOdds(upgradeOddsRows());
          persistEntitySoon('skillroll', id);
        },
        onReset: (id) => { resetEntity('skillroll', id); refreshDevTools(); },
      },
      upgradeTune: {
        onTune: (id, key, value) => {
          UPGRADE_ROLL[key] = value;
          // The odds readout is the whole point of these five relative weights, so it repaints
          // on every drag rather than only when the panel reopens.
          ui.refreshUpgradeOdds(upgradeOddsRows());
          persistEntitySoon('upgrades', id);
        },
        onReset: (id) => { resetEntity('upgrades', id); refreshDevTools(); },
      },
      curveTune: {
        onTune: (id, key, value) => {
          curveFlatTargets[id][key] = value;
          ui.redrawCurveChart();                 // the picture is the point of this panel
          persistEntitySoon('curve', id);
        },
        onReset: (id) => { resetEntity('curve', id); refreshDevTools(); },
      },
      dashTune: {
        onTune: (id, key, value) => { DASH[key] = value; persistEntitySoon('dash', id); },
        onReset: (id) => { resetEntity('dash', id); refreshDevTools(); },
      },
      goldCurveTune: {
        onTune: (id, key, value) => {
          GOLD_CURVE[id][key] = value;
          ui.redrawGoldChart();                  // the picture is the point of this panel
          persistEntitySoon('goldcurve', id);
        },
        onReset: (id) => { resetEntity('goldcurve', id); refreshDevTools(); },
      },
      goldTune: {
        onTune: (id, key, value) => {
          GOLD_RATES[key] = value;
          ui.redrawGoldChart();   // the stage multiplier moves the readout under the chart
          persistEntitySoon('gold', id);
        },
        onReset: (id) => { resetEntity('gold', id); refreshDevTools(); },
      },
      potionTune: {
        onTune: (id, key, value) => { POTION_RATES[key] = value; persistEntitySoon('potions', id); },
        onReset: (id) => { resetEntity('potions', id); refreshDevTools(); },
      },
      tomeMasterTune: {
        onTune: (id, key, value) => {
          TOME_MASTER[key] = value;
          ui.redrawTomeChart();   // every line on the chart moves with this one
          persistEntitySoon('tomemaster', id);
        },
        onReset: (id) => { resetEntity('tomemaster', id); refreshDevTools(); },
      },
      tomeTune: {
        onTune: (id, key, value) => {
          const t = TOME_CURVE[id];
          if (!t) return;
          t[key] = value;
          ui.redrawTomeChart();   // the picture is the point of this panel
          persistEntitySoon('tomes', id);
        },
        onReset: (id) => { resetEntity('tomes', id); refreshDevTools(); },
      },
      procFxTune: {
        onTune: (id, key, value) => {
          PROC_FX[key] = value;
          applyProceduralVolume();   // live, so the next sound to fire uses it
          persistEntitySoon('procfx', id);
        },
        onReset: (id) => { resetEntity('procfx', id); refreshDevTools(); },
      },
      sampleFxTune: {
        // No apply step: playSample reads SAMPLE_FX.volume when it builds each voice, so the
        // next sound to fire already has it. Sounds already in flight keep the level they
        // started at, which is right — retuning a bus should not warble a sustained loop.
        onTune: (id, key, value) => { SAMPLE_FX[key] = value; persistEntitySoon('samplefx', id); },
        onReset: (id) => { resetEntity('samplefx', id); refreshDevTools(); },
      },
      sampleTune: {
        onTune: (id, key, value) => {
          const t = SAMPLES[id];
          if (!t) return;
          t[key] = value;
          // Redraw the waveform the moment a marker moves — the picture IS the readout here.
          ui.redrawWaves();
          persistEntitySoon('samples', id);
        },
        onReset: (id) => { resetEntity('samples', id); refreshDevTools(); },
      },
      enemyTune: {
        onTune: (id, key, value) => {
          const t = ENTITY_DOMAINS.enemies.target(id);
          if (!t) return;
          t[key] = value;
          // Rebuild the roster from the authored numbers so the new multiplier lands exactly
          // rather than stacking on the last one.
          applyEnemyGlobals();
          persistEntitySoon('enemies', id);
        },
        onReset: (id) => { resetEntity('enemies', id); refreshDevTools(); },
      },
      onGrantGold: (n) => {
        addGold(n); // HUD refreshes each frame; the menu re-reads gold when shown
        ui.showToast('Gold', `+${n.toLocaleString()} gold (${getGold().toLocaleString()} total).`, '#e6c14e');
        refreshDevTools();
      },
      onInfiniteGold: () => {
        setGold(9999999);
        ui.showToast('Gold', 'Balance set to 9,999,999.', '#e6c14e');
        refreshDevTools();
      },
      onGrantKeys: (n) => {
        if (!S.player) { ui.showToast('Keys', 'Start a run first.', '#c94a3f'); return; }
        S.keyCount += n;
        ui.showToast('Keys', `+${n} silver key${n > 1 ? 's' : ''}.`, '#cdd3dd');
        refreshDevTools();
      },
      onZeroOut: () => askConfirm(
        'Are you sure you want to zero out all your progress?',
        zeroItOut,
      ),
      // Reset drops the stored override as well as the live values. Without that, Reset would
      // restore the shipped numbers for this session and the saved ones would come back on the
      // next launch — the change would look like it had not taken.
      onResetSkill: (id) => {
        resetTuneToShipped(id);
        clearTimeout(tuneSaveTimers.get(id));
        tuneSaveTimers.delete(id);
        forgetStoredTune(id);
        refreshDevTools();
      },
    },
  );
}
// Repaint in place — no state round-trip, so a refresh can't disturb the return state.
function refreshDevTools() { if (S.state === 'DEVTOOLS') renderDevTools(); }

function closeDevTools() {
  ui.hideDevTools();
  // Never restore to DEVTOOLS or anything unexpected; the main menu is always a safe landing.
  const back = (devReturnState === 'PAUSED' && S.player) ? 'PAUSED' : 'MAINMENU';
  S.state = back;
  if (back === 'PAUSED') ui.showPauseMenu();
  else showMainMenu();
}

function refreshSettingsMenu() {
  ui.showSettingsMenu(
    {
      inputPromptMode: getSettings().inputPromptMode, connectedPads: listConnectedPads(),
      activeGamepadId: getSettings().activeGamepadId,
      musicVolume: getSettings().musicVolume, sfxVolume: getSettings().sfxVolume,
      displayMode: getSettings().displayMode,
      renderScale: getSettings().renderScale,
      showDevTools: getSettings().showDevTools,
      showPerfPanel: getSettings().showPerfPanel,
      uiScale: getSettings().uiScale,
    },
    (mode) => { setSetting('inputPromptMode', mode); refreshSettingsMenu(); },
    (padId) => { setSetting('activeGamepadId', padId); refreshSettingsMenu(); },
    (v) => { setSetting('musicVolume', v); setMusicVolume(v); },
    (v) => { setSetting('sfxVolume', v); setSfxVolume(v); },
    {},
    {
      onSelectDisplayMode: (mode) => { setSetting('displayMode', mode); applyDisplayMode(); refreshSettingsMenu(); },
      onSelectRenderScale: (v) => { setSetting('renderScale', v); applyRenderScale(); refreshSettingsMenu(); },
      onSelectUiScale: (v) => { setSetting('uiScale', v); applyUiScale(); refreshSettingsMenu(); },
      // Applied immediately as well as saved: the menus behind this screen are already built,
      // and the change should be there when you back out rather than on the next launch.
      onToggleDevTools: (on) => { setSetting('showDevTools', on); syncMenuEntries(); refreshSettingsMenu(); },
      onTogglePerfPanel: (on) => { setSetting('showPerfPanel', on); applyPerfPanel(); refreshSettingsMenu(); },
    },
  );
}

// UI scale is a single custom property; the stylesheet decides what it applies to (see the
// --ui-scale rules). Doing it here rather than per-element means a new overlay picks it up by
// being listed once in CSS instead of needing a JS hook.
// The window size the interface was laid out for. Panels, button rows and type sizes were all
// chosen against a widescreen frame at roughly this size; below it there simply is not room for
// them at full size, which is why buttons used to break out of their panels and run off-screen.
const UI_DESIGN_W = 1600;
const UI_DESIGN_H = 900;

/**
 * How much the interface has to shrink to fit the current window.
 *
 * The SMALLER of the two axis ratios, so the layout is contained rather than cropped — a window
 * that is wide but short is limited by its height, and vice versa.
 *
 * Capped at 1: this shrinks a cramped window to fit, it does not inflate a roomy one. Above the
 * design size everything stays exactly as authored, so a normal desktop sees no change at all.
 * The floor stops a tiny window from scaling the UI into illegibility — past that point it is
 * better to let it overflow than to render type nobody can read.
 */
function uiFitScale() {
  const fit = Math.min(window.innerWidth / UI_DESIGN_W, window.innerHeight / UI_DESIGN_H);
  return clamp(fit, 0.45, 1);
}

// The player's own UI Scale preference multiplies the fit, rather than replacing it: "Large"
// should still mean larger than normal on a small window, just starting from a smaller base.
function applyUiScale() {
  const pref = clamp(getSettings().uiScale || 1, 0.5, 2);
  document.documentElement.style.setProperty('--ui-scale', String(pref * uiFitScale()));
}
applyUiScale();
// Recomputed on resize. Cheap — two divides and a custom-property write — and it has to be
// live, because the whole point is the window being dragged smaller.
window.addEventListener('resize', applyUiScale);

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
  S.state = 'SETTINGS';
  refreshSettingsMenu();
}
function closeSettings() {
  ui.hideSettingsMenu();
  if (settingsReturnState === 'START') { S.state = 'START'; document.getElementById('classSelect').classList.remove('hidden'); }
  else if (settingsReturnState === 'MAINMENU') { S.state = 'MAINMENU'; ui.showMainMenu(getGold(), getDeaths()); }
  else { S.state = 'PAUSED'; ui.showPauseMenu(); }
}

// ---------- Music player ----------
// Its own screen rather than a row inside Settings: it is something you reach for in the
// middle of a session, and burying it two levels down made that a chore. Reachable from the
// main menu and from the pause menu, and it remembers which sent you.
let musicReturnState = 'MAINMENU';

function musicUnlocked() { return JUKEBOX_FREE || getUpgradeLevel('musicPlayer') > 0; }

// Menu entries that are not always there. Both pairs are hidden by default for the same
// reason — menu space — and both have to re-evaluate whenever a menu opens, because the thing
// that reveals them (buying the jukebox, ticking the Settings toggle) happens mid-session and
// must not need a reload to take effect.
//
// One function rather than one per entry: the next optional entry is a line here, not another
// near-identical helper that the menu-opening code has to remember to call.
function syncMenuEntries() {
  const shown = {
    musicBtn: musicUnlocked(),
    pauseMusicBtn: musicUnlocked(),
    mainDevBtn: !!getSettings().showDevTools,
    pauseDevBtn: !!getSettings().showDevTools,
  };
  for (const [id, on] of Object.entries(shown)) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !on);
  }
}
syncMenuEntries();

function openMusic(returnState) {
  musicReturnState = returnState;
  if (returnState === 'MAINMENU') ui.hideMainMenu();
  else ui.hidePauseMenu();
  S.state = 'MUSIC';
  refreshMusicMenu();
}

// Full rebuild. Only for opening the screen and for a mode change, which restyles the mode row.
// Everything else that happens on this screen only moves the ▶, and that goes through
// syncNowPlaying so the track list keeps its scroll position.
function refreshMusicMenu() {
  ui.showMusicMenu(
    MUSIC_TRACK_LIST,
    currentTrackId(),
    (id) => { playMusic(id); syncNowPlaying(); },
    getJukeboxMode(),
    (mode) => {
      setJukeboxMode(mode);
      // Disabling hands control back to whatever the player is actually in the middle of:
      // the stage's own list mid-run, the title theme on the menu. Without this, turning the
      // jukebox off would leave the last hand-picked track playing forever, which is not
      // "back to stage music" by any reading.
      if (mode === 'off') playMusic(S.player && !sandboxMode ? 'stage' + (S.currentStage + 1) : 'mainMenu');
      refreshMusicMenu();
    },
    transportState(),
  );
}

/** Move the ▶ and repaint the play/pause glyph, without disturbing the list. */
function syncNowPlaying() {
  ui.markNowPlaying(currentTrackId());
  ui.refreshMusicTransport(transportState());
}

function transportState() {
  return {
    paused: isMusicPaused(),
    onPrev: () => { prevTrack(); syncNowPlaying(); },
    onNext: () => { nextTrack(); syncNowPlaying(); },
    onToggle: () => { toggleMusicPaused(); syncNowPlaying(); },
  };
}

function closeMusic() {
  ui.hideMusicMenu();
  if (musicReturnState === 'MAINMENU') { S.state = 'MAINMENU'; ui.showMainMenu(getGold(), getDeaths()); }
  else { S.state = 'PAUSED'; ui.showPauseMenu(); }
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
  for (const e of S.enemies) {
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
    for (const e of S.enemies) {
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
// A pile of bones counts toward the standing total. Skeletons are never truly lost, so a fallen
// one is a slot that is already spoken for — summoning a replacement over it would let a player
// bank extra bodies by letting the retinue get chewed up, and end the fight with double the cap.
function countMinions(type) { return S.minions.filter((m) => !m.dead && m.type === type).length; }

// Damage numbers were the one unbounded pool. A wide multi-hit skill can generate thousands
// per second — Solar Ray at +18 projectiles sweeping a packed crowd is ~19 beams x every
// enemy they cross, several times a second — and at 0.7s of life they all overlap into an
// unreadable smear that costs more to draw than the fight itself. Capped like projectiles and
// effects; at the ceiling the OLDEST is dropped so the freshest hits are the ones shown.
//
// Rapid repeat hits on the SAME target now MERGE into one running total rather than stacking a
// fresh number on top of the last. That fixes two things at once:
//
//   * Readability — a multi-hit skill printed a tower of overlapping text at one spot.
//   * Flicker — the cap used to saturate within a fraction of a second, and from then on every
//     new hit evicted a number that was still fully opaque, so numbers blinked out mid-flight
//     instead of fading. Merging keeps the pool far below its ceiling, so eviction stops
//     happening at all in practice.
// The window has to clear the slowest repeating source, or merging never engages for it. The
// ground hazards tick every 0.4s, so a 0.35s window missed them entirely — and a crowd of 500
// poisoned enemies ticking at 2.5/s is precisely what used to saturate the cap.
const DMG_MERGE_WINDOW = 0.5; // how long a number stays open to absorbing further hits
const DMG_MERGE_LIMIT = 10;   // ...and how many, so a sustained beam can't pin one in place

function spawnDamageNumber(x, y, amount, isCrit, color, target) {
  // Nothing off-camera. In a late endless wave most hits land on enemies you cannot see, and
  // each one was still costing a merge lookup, an object, a slot in a 256-deep pool that then
  // evicted a number you COULD see, and a text draw. Culling at the source is the only place
  // that saves all four. Deliberately generous — the margin is a screen-space check against the
  // spawn point, so a number that would drift into view is still created.
  const sp = worldToScreen(x, y);
  if (!onScreen(sp.x, sp.y, DMG_CULL_MARGIN)) return;
  const live = target && target._dmgNum;
  // Merge only into a number that is still in the pool, still young, and of the same kind —
  // a crit has its own weight and colour and should never be folded into a plain hit.
  if (live && !live.dead && live.t < DMG_MERGE_WINDOW && live.merges < DMG_MERGE_LIMIT
      && live.isCrit === isCrit && live.color === (color || (isCrit ? '#c9a227' : '#c9bfa8'))) {
    live.amount += amount;
    live.text = String(live.amount);
    live.t = 0;                 // restart the fade so the growing total stays legible
    live.merges++;
    live.x = x + rand(-2, 2); live.y = y;  // re-anchor to the target instead of drifting off
    return;
  }
  if (S.dmgNumbers.length >= MAX_DMG_NUMBERS) {
    const dropped = S.dmgNumbers.shift();
    if (dropped) dropped.dead = true;      // so nothing merges into an evicted number
  }
  const d = { x: x + rand(-6, 6), y, amount, text: String(amount), isCrit,
    color: color || (isCrit ? '#c9a227' : '#c9bfa8'), t: 0, life: 0.7, merges: 0, dead: false };
  S.dmgNumbers.push(d);
  if (target) target._dmgNum = d;
}

function damageEnemy(enemy, baseDamage, mods, opts = {}) {
  if (enemy.dead) return;
  // Ashen Ledger's third copy: the payoff for stacking three different elements on one target,
  // which costs real infusion rolls and is why the bonus is worth this much.
  if (relicAt('ashenledger') >= 3 && statusCount(enemy) >= 3) {
    baseDamage *= 1 + RELIC_TUNE.ledgerTriple;
  }
  // Gravebloom reads this to know a collapse landed the killing blow.
  if (opts.collapse) enemy.lastHitByCollapse = true;
  // The Long Dark: everything past your torchlight hits harder — the whole run is fought by
  // firing into a dark you cannot read, which is a real trade rather than a free multiplier.
  if (relicAt('thelongdark') && !litByTorch(enemy)) baseDamage *= RELIC_TUNE.darkDamage;
  // Sandbox punching bags: still show numbers and take knockback, just never die — so a
  // damage test runs against a constant target count instead of thinning as it goes.
  if (enemy.invulnerable) {
    spawnDamageNumber(enemy.x, enemy.y - enemy.radius, Math.round(baseDamage), false, undefined, enemy);
    return;
  }
  let dmg = baseDamage;
  const totalCrit = critChanceNow(mods);
  let isCrit = false;
  // Crit DAMAGE comes from the class base plus any tome, the same way crit CHANCE just did
  // above — reading only the player here is what kept the Crit Damage tome from doing anything.
  const critMult = (S.player.critMult || 1) + (mods.critMultBonus || 0);
  // First Strike: the Shinobi's blades always find the mark on anything that has never touched
  // him. One landed hit — contact, arrow or boss rock — clears the mark permanently.
  const firstStrike = S.player.firstStrike && !enemy.touchedPlayer;
  if (firstStrike || Math.random() < totalCrit) { dmg *= critMult; isCrit = true; }
  enemy.hp -= dmg;
  spawnDamageNumber(enemy.x, enemy.y - enemy.radius, Math.round(dmg), isCrit, undefined, enemy);
  if (mods.lifeLeech && !afflicted('blight')) S.player.hp = Math.min(S.player.maxHp, S.player.hp + dmg * mods.lifeLeech);
  if (opts.knockback && !enemy.isBoss) {
    const n = normalize(enemy.x - S.player.x, enemy.y - S.player.y);
    enemy.x += n.x * opts.knockback * 0.2; enemy.y += n.y * opts.knockback * 0.2;
  }
  if (mods && !enemy.dead) {
    const list = mods.infusions || (mods.infusion ? [mods.infusion] : []);
    for (const kind of list) { if (enemy.dead) break; applyInfusion(enemy, kind, dmg, mods); }
  }
  if (enemy.hp <= 0 && !enemy.dead) killEnemy(enemy);
}

// Elemental infusion granted by a Legendary/Unique gem upgrade. Rides along on every hit the
// infused skill lands, scaling off that hit's damage so strong skills infuse harder.
function applyInfusion(e, kind, dmg, mods) {
  // Strip the infusion before re-entering damageEnemy so a shock arc can't chain infinitely.
  const plain = { ...mods, infusion: null, infusions: null };
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
  if (kind === 'void') applyVoidMark(e);
  else if (kind === 'frost') applySlow(e, 0.55, 1400);
  else if (kind === 'burning') applyBurn(e, dmg * 0.35, 3, plain);
  else if (kind === 'poison') applyPoison(e, dmg * 0.3, 6, plain);
  else if (kind === 'shock') {
    // A visual-only mark. Shock's mechanic is the arc below, which is over in a frame — so on a
    // busy screen the element read as "nothing happened" next to burn's flames and poison's
    // motes. This gives it the same lingering tell every other element already had, without
    // adding a mechanic the balance has not been tuned for.
    e.shockUntil = performance.now() + SHOCK_TELL_MS;
    const near = findNearest(e.x, e.y, 225, new Set([e.id])); // x1.5 with the AoE pass
    if (near) {
      damageEnemy(near, dmg * 0.4, plain, {});
      spawnEffect({ kind: 'shockArc', x: e.x, y: e.y, tx: near.x, ty: near.y, duration: 0.16 });
    }
  }
}

// ---------- Elites ----------
// Statuses that land on the PLAYER. Everything before this pointed the other way — the player
// inflicted, the horde suffered — so there was no machinery for being on the receiving end.
//
// Held as expiry timestamps rather than counters for the same reason the enemy statuses are:
// one number, no per-frame bookkeeping, and re-applying is just a later timestamp.

const AFFLICT_TICK = 0.5;        // seconds between damage-over-time ticks on the player
const AFFLICT_BURN_DPS = 14;
const AFFLICT_POISON_DPS = 9;

/** @param {string} kind @param {number} seconds */
function afflictPlayer(kind, seconds, quiet = false) {
  const p = S.player;
  if (!p) return;
  // The Warrior's full plate: elite afflictions do not land at all. Gated HERE, at the single
  // door every status walks through — elites, minibosses and boss skills included — so no new
  // caster can forget the rule. The tell is throttled: one "Immune" note per few seconds reads
  // as armor doing its job, one per cast reads as spam.
  if (p.plateImmune) {
    const now = performance.now();
    if (!quiet && (!p.immuneToldAt || now - p.immuneToldAt > 4000)) {
      p.immuneToldAt = now;
      ui.showToast('Full Plate', 'The affliction glances off the Warrior\'s armor.', '#a13328');
    }
    return;
  }
  // Ashen Lung makes the burning kinds linger twice as long — its half of the bargain.
  const lung = holdsItem(p, 'ashenlung') && (kind === 'burning' || kind === 'poison') ? 2 : 1;
  const until = performance.now() + seconds * 1000 * lung;
  p.afflict = p.afflict || {};
  p.afflict[kind] = Math.max(p.afflict[kind] || 0, until);
  // `quiet` exists for per-frame sources (standing in Sekhra's sand refreshes the slow every
  // tick) — a toast per refresh would bury the feed under one status.
  const ab = ELITE_ABILITY[kind];
  if (ab && !quiet) ui.showToast(ab.name, ab.desc, ab.color);
}

/** @param {string} kind */
function afflicted(kind) {
  const a = S.player && S.player.afflict;
  return !!(a && a[kind] > performance.now());
}

/**
 * One elite's turn to act. Walks up, and every `abilityCd` seconds lands its status on you if
 * you are inside `abilityRange`.
 *
 * Range-gated rather than global: an elite you have left behind should stop mattering, or the
 * pressure never lets up and kiting stops being an answer.
 */
/** How long a given elite status rides the player: the shared dial × that ability's own scale. */
function eliteStatusSeconds(kind) {
  const ab = ELITE_ABILITY[kind];
  return ELITE_TUNE.statusSeconds * ((ab && ab.durMult) || 1);
}

function updateElite(e, dt) {
  e.abilityTimer -= dt;
  if (e.abilityTimer > 0) return;
  if (dist(e.x, e.y, S.player.x, S.player.y) > ELITE_TUNE.abilityRange) return;
  e.abilityTimer = ELITE_TUNE.abilityCd;
  afflictPlayer(e.ability, eliteStatusSeconds(e.ability));
  spawnEffect({ kind: 'ring', x: e.x, y: e.y, radius: ELITE_TUNE.abilityRange * 0.5,
    color: e.abilityColor, duration: 0.4, mods: {} });
  play('bossSpawn');
}

/** Per-frame consequences of whatever is riding the player. */
function updateAfflictions(dt) {
  const p = S.player;
  if (!p || !p.afflict) return;
  const now = performance.now();
  // Damage-over-time TICKS in whole chunks rather than bleeding a fraction each frame.
  //
  // applyDamageToPlayer floors every hit at `Math.max(1, round(raw))`, so a per-frame slice of
  // 14 dps (~0.22 at 60fps) was rounded UP to 1 every single frame — burning dealt ~128/sec
  // instead of 14, and Sunder's multiplier vanished into the rounding because 0.22 and 0.30
  // both floor to the same 1. Half-second chunks are what the enemy-side burn already uses.
  p.afflictTick = (p.afflictTick === undefined ? AFFLICT_TICK : p.afflictTick) - dt;
  if (p.afflictTick <= 0) {
    p.afflictTick = AFFLICT_TICK;
    if (p.afflict.burning > now) applyDamageToPlayer(AFFLICT_BURN_DPS * AFFLICT_TICK, 'Burning', 'dot');
    if (p.afflict.poison > now) applyDamageToPlayer(AFFLICT_POISON_DPS * AFFLICT_TICK, 'Poison', 'dot');
  }
  // Tether hauls you toward the nearest elite that is still alive — the only affliction with a
  // source, so it has to find one rather than reading a stored reference that may have died.
  if (p.afflict.tether > now) {
    let src = null, best = Infinity;
    for (const e of S.enemies) {
      if (e.dead || !e.isElite) continue;
      const d = dist(e.x, e.y, p.x, p.y);
      if (d < best) { best = d; src = e; }
    }
    if (src && best > 1) {
      p.x += ((src.x - p.x) / best) * TETHER_PULL * dt;
      p.y += ((src.y - p.y) / best) * TETHER_PULL * dt;
    }
  }
}

// ---------- Relics ----------
// Each helper answers one question the game loop asks, so the rules live beside each other
// rather than smeared across the systems they touch.

/** The endless wave, or 0 during the campaign. Relics are the endless layer's own reward. */
const relicWave = () => (S.beatFinalBoss ? Math.max(1, S.endlessWave) : 0);
/** Inside the player's own light. The Long Dark keys both its damage and its blindness to this. */
const TORCH_REACH = 260;
const litByTorch = (e) => dist(e.x, e.y, S.player.x, S.player.y) <= TORCH_REACH;
/** @param {string} id */
const relicAt = (id) => (S.player ? relicTier(S.player, id) : 0);

/** Grant a copy, honouring the cap. Returns the tier it is now at, or 0 if refused. */
function grantRelic(id) {
  const p = S.player;
  if (!p) return 0;
  const held = relicsHeld(p);
  if (!p.relics[id] && held.length >= RELIC_CAP) return 0;   // shelf full, no new relics
  p.relics[id] = Math.min(3, (p.relics[id] || 0) + 1);
  refreshRelicBar();
  return p.relics[id];
}

/** Push the held relics at the HUD strip. Only on change — see refreshRelicBar in ui.js. */
function refreshRelicBar() {
  ui.refreshRelicBar(S.player ? relicsHeld(S.player).map((id) => ({
    id, name: RELICS[id].name, icon: RELICS[id].icon, color: RELICS[id].color,
    tier: relicTier(S.player, id), desc: relicDesc(S.player, id),
  })) : []);
}

/**
 * Hollow Star. Every Nth kill collapses regardless of any void mark.
 * Called for every death, so it is kept to a counter and a compare.
 */
function relicKillTick(enemy) {
  const t = relicAt('hollowstar');
  if (!t) return;
  const every = Math.max(2, Math.round(t >= 2 ? RELIC_TUNE.hollowEvery2 : RELIC_TUNE.hollowEvery));
  if (++S.player.relicKills < every) return;
  S.player.relicKills = 0;
  collapseVoid(enemy);
  // Tier 2 leaves the survivors marked, so the free collapse seeds the next one.
  if (t >= 2) for (const e of enemiesInRange(enemy.x, enemy.y, VOID_RADIUS)) {
    if (!e.dead) applyVoidMark(e);
  }
}

// ---------- Void ----------
// A mark that does nothing until the marked foe dies, then collapses into a singularity that
// DRAGS nearby enemies inward before imploding.
//
// The payoff is deliberately on death rather than on hit. An on-hit pull would fight the player
// for control of the battlefield every second; on death it fires exactly when a body drops,
// which is the moment the crowd is already reorganising, and it rewards killing the RIGHT foe —
// the one at the edge of the pack, whose collapse hauls the pack into your damage.
// ---------- Void Afflicted ----------
// A per-spawn variant, not a separate monster: any creature in the roster can come up touched
// by the void. Stronger across the board and wreathed in black fire, so the threat reads from
// its silhouette before you are close enough to see a health bar.
//
// A ROLL rather than a new enemy type because the horde's job is to be recognisable — you learn
// what a Swarm Bat does, and an afflicted one is that same knowledge plus a warning. A whole new
// creature would be something else to learn instead.
// The numbers now live in void.js behind dev-tools sliders — these read them live so a dial
// dragged mid-run takes effect on the next spawn rather than the next launch.
const VOID_AFFLICT_CHANCE = () => VOID_TUNE.chance / 100;
const VOID_AFFLICT_ENDLESS = () => VOID_TUNE.chanceEndless / 100;

/**
 * The live per-spawn affliction chance: zero before the void's introduction, then a ramp from
 * chanceStart up to the full rate across chanceRamp difficulty positions.
 *
 * A CURVE rather than a step, because the introduction is already the step — the event says
 * "they exist now", and the minutes after it should feel like a trickle becoming a presence
 * rather than the tap snapping to fully open. Endless uses its own ceiling, and by then the
 * ramp is long finished (introLatest < the endless handover), so the two never fight.
 */
function voidAfflictChanceNow() {
  if (S.voidForceNext > 0) return 1;   // the introduction's own heralds are always afflicted
  if (!S.voidIntroduced) return 0;
  const full = S.beatFinalBoss ? VOID_AFFLICT_ENDLESS() : VOID_AFFLICT_CHANCE();
  const frac = clamp((difficultyPosition() - S.voidIntroAt) / Math.max(0.1, VOID_TUNE.chanceRamp), 0, 1);
  // Eased toward the late end so the first minute after the event stays sparse; 1.35 was picked
  // by eye on the ramp table rather than exposed as a dial — the ramp length is the real lever.
  const start = VOID_TUNE.chanceStart / 100;
  return start + (full - start) * Math.pow(frac, 1.35);
}

/**
 * The void's introduction, staged: WAITING until the rolled position, then an OMEN build-up —
 * omenSeconds of purple flickers at the edge of vision and small shudders, dread before
 * anything is said — then the card lands and a TEAR opens in the arena, birthing afflicted
 * from its mouth until it seals. Fires once per run; any stage can be the one where the run
 * changes colour.
 *
 * The build-up is the point of the shape. An event that simply announces itself reads as UI;
 * one the player half-noticed coming — something purple at the corner of the screen, twice,
 * before the card ever confirms it — reads as the world doing something behind their back.
 */
function updateVoidIntro(dt) {
  if (S.voidIntroPhase === 'done' || !S.player) return;
  if (S.voidIntroPhase === 'waiting') {
    if (difficultyPosition() >= S.voidIntroAt) { S.voidIntroPhase = 'omen'; S.voidOmenT = 0; S.voidOmenNext = 0.5; }
    return;
  }
  if (S.voidIntroPhase === 'omen') {
    S.voidOmenT += dt;
    S.voidOmenNext -= dt;
    if (S.voidOmenNext <= 0) {
      // Flickers arrive irregularly — a metronome would read as a system, and dread is not
      // a system. Placed just past the edge of the view, so each one is half-seen.
      S.voidOmenNext = 1.4 + Math.random() * 2.0;
      const a = Math.random() * Math.PI * 2;
      const r = Math.hypot(viewW, viewH) * 0.5 - 40;
      spawnEffect({ kind: 'voidOmen', x: S.player.x + Math.cos(a) * r, y: S.player.y + Math.sin(a) * r,
        duration: 0.6, seed: Math.random() * 10 });
      shakeAmount = Math.max(shakeAmount, 1.1);
    }
    if (S.voidOmenT >= VOID_TUNE.omenSeconds) openVoidTear();
    return;
  }
  // 'open': the tear births afflicted from ITS mouth — position spawns, not edge spawns, so
  // the crawl-out is literal. The stage's own roster comes through, afflicted.
  const tear = S.effects.find((fx) => fx.kind === 'voidTear' && !fx.dead);
  if (!tear) {
    S.voidIntroPhase = 'done';
    return;
  }
  // Stop birthing shortly before the seal, so nothing spawns into the closing animation.
  if (tear.t < tear.duration - 0.8) {
    S.voidTearSpawnT -= dt;
    if (S.voidTearSpawnT <= 0) {
      S.voidTearSpawnT = VOID_TUNE.tearSpawnEvery;
      const pool = poolForTime(S.stageElapsed, STAGES[S.currentStage].enemyPool);
      if (pool && pool.length) {
        const a = Math.random() * Math.PI * 2;
        spawnLesser(pick(pool), tear.x + Math.cos(a) * 30, tear.y + Math.sin(a) * 30, true);
      }
    }
  }
}

function openVoidTear() {
  S.voidIntroPhase = 'open';
  S.voidIntroduced = true;   // the spawn-rate ramp starts the moment the tear is open
  S.voidTearSpawnT = 0.5;
  // Near the player but never on them: close enough that the birth is an event happening TO
  // this fight, far enough to run from. Clamped inside the arena like every collapse is.
  const a = Math.random() * Math.PI * 2;
  const lim = ARENA_RADIUS - 140;
  spawnEffect({
    kind: 'voidTear', seed: Math.random() * 10,
    x: clamp(S.player.x + Math.cos(a) * 400, -lim, lim),
    y: clamp(S.player.y + Math.sin(a) * 400, -lim, lim),
    radius: 66, duration: VOID_TUNE.tearSeconds,
  });
  ui.showStageCard('THE VOID TAKES NOTICE', 'A tear has opened. They are coming through.', 'void');
  play('bossSpawn');
  shakeAmount = Math.max(shakeAmount, 7);
}
const VOID_AFFLICT_HP = () => VOID_TUNE.hpMult;
const VOID_AFFLICT_DAMAGE = () => VOID_TUNE.damageMult;
const VOID_AFFLICT_SPEED = () => VOID_TUNE.speedMult;
const VOID_AFFLICT_XP = () => VOID_TUNE.xpMult;

const SHOCK_TELL_MS = 900;   // how long a shocked foe keeps crackling. Cosmetic only.
const VOID_MARK_MS = 4000;
const VOID_RADIUS = 150;          // reach of the pull
const VOID_PULL = 420;            // px/sec at the rim, rising toward the centre
const VOID_DURATION = 0.55;       // how long it hauls before it implodes
const VOID_DAMAGE_FRAC = 0.55;    // implosion damage, as a fraction of the killed foe's max life
const VOID_REF_HP = 40;           // the max life a "normal" collapse is sized against
const VOID_SCALE_PER_DOUBLING = 0.30;  // extra duration per doubling of the victim's max life
const VOID_MAX_SCALE = 6;         // ceiling, so a wave-20 boss does not open a permanent hole

function applyVoidMark(e) {
  e.voidUntil = performance.now() + VOID_MARK_MS;
}

/**
 * A marked foe dying. Bosses are pulled at a heavily reduced rate rather than exempted outright:
 * a boss that ignores the effect entirely makes a void build feel broken against the one fight
 * it most wants to matter in, but a boss yanked around like a bat stops reading as a boss.
 */
function collapseVoid(enemy) {
  const dmg = Math.max(1, (enemy.maxHp || 20) * VOID_DAMAGE_FRAC);
  // Duration scales with what died. A bat's collapse is a blink; a boss tears a hole that hangs
  // open for seconds and drags the whole arena into it — which is the payoff for landing the
  // mark on the hardest target rather than on whatever was nearest.
  //
  // Logarithmic, not linear: enemy max life spans several orders of magnitude across a run, so
  // a linear read would make an early bat instant and a wave-20 boss last a minute. Radius
  // grows on the same curve, at a gentler rate.
  const bulk = Math.max(1, (enemy.maxHp || 20) / VOID_REF_HP);
  const grow = Math.min(VOID_MAX_SCALE, 1 + Math.log2(bulk) * VOID_SCALE_PER_DOUBLING);
  // The hole opens INSIDE the arena even when the death that armed it happened against the
  // wall — a collapse centred out of bounds was hauling the horde through the boundary.
  const cLim = ARENA_RADIUS - 60;
  // The Marked's collapses only pull — damage zeroed, not reduced, because "she does not kill
  // things" is a rule the player can build around and a discount is just a worse number.
  const pacifist = S.player.collapsePacifist;
  spawnEffect({
    kind: 'singularity', x: clamp(enemy.x, -cLim, cLim), y: clamp(enemy.y, -cLim, cLim),
    radius: VOID_RADIUS * (1 + (grow - 1) * 0.45),
    duration: VOID_DURATION * grow, damage: pacifist ? 0 : dmg, seed: Math.random() * 10,
    mods: { damageMult: 1, lifeLeech: 0, critChance: 0 },
  });
  play('iceNova');
}

// Burn status: a light damage-over-time that lingers on the enemy after it leaves the flame.
// Applying it refreshes the duration and keeps the stronger damage.
/**
 * Seconds between damage-over-time ticks. Ashen Ledger's SECOND copy shortens it.
 *
 * The per-tick damage is deliberately left alone, so a shorter interval is a real DPS increase
 * rather than the same total delivered in smaller pieces — scaling the damage down to match
 * would make the relic a no-op that only changed how often numbers appear.
 */
function ledgerTickInterval() {
  return 0.5 / (relicAt('ashenledger') >= 2 ? Math.max(0.1, RELIC_TUNE.ledgerTick) : 1);
}

/** Ashen Ledger's duration multiplier, applied wherever a status is stamped on. */
function ledgerDuration(sec) {
  return relicAt('ashenledger') ? sec * RELIC_TUNE.ledgerDuration : sec;
}
/** How many distinct statuses a foe is carrying right now. */
function statusCount(e) {
  const now = performance.now();
  let n = 0;
  if (e.burnUntil > now) n++;
  if (e.poisonUntil > now) n++;
  if (e.slowUntil > now || e.frozenUntil > now) n++;
  return n;
}

function applyBurn(e, dps, durationSec, mods) {
  const until = performance.now() + ledgerDuration(durationSec) * 1000;
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
  e.poisonUntil = now + ledgerDuration(durationSec) * 1000; // re-applying refreshes in full
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
// Read from the flask's tune block rather than a constant here, so the range is on the panel
// with the rest of the skill. Falls back to the old literal if the key ever goes missing —
// a spread of 0 would kill the chain reaction outright, which is too quiet a way to break.
function poisonSpreadRadius() {
  const t = SKILLS.poisonflask && SKILLS.poisonflask.tune;
  return (t && t.spreadRadius !== undefined) ? t.spreadRadius : 165;
}
function spreadPoisonFrom(src) {
  const now = performance.now();
  const R = poisonSpreadRadius();
  if (R <= 0) return;
  let fresh = null, freshD = R;
  let any = null, anyD = R;
  for (const e of S.enemies) {
    if (e.dead || e === src) continue;
    const d = dist(src.x, src.y, e.x, e.y);
    if (d >= R) continue;
    if (d < anyD) { anyD = d; any = e; }
    const poisoned = e.poisonUntil && e.poisonUntil > now;
    if (!poisoned && d < freshD) { freshD = d; fresh = e; }
  }
  const target = fresh || any;
  if (!target) return;
  applyPoison(target, src.poisonDps || 1, src.poisonDuration || 6, src.poisonMods);
  spawnEffect({ kind: 'poisonBurst', x: src.x, y: src.y, radius: R * 0.5, duration: 0.4 });
}

function tickPoison(e, dt) {
  if (!e.poisonUntil || e.poisonUntil <= performance.now()) { e.poisonStacks = 0; return; }
  e.poisonTickTimer = (e.poisonTickTimer === undefined ? 0.5 : e.poisonTickTimer) - dt;
  if (e.poisonTickTimer <= 0) {
    damageEnemy(e, e.poisonDps * (e.poisonStacks || 1) * 0.5, e.poisonMods || {}, {}); // 0.5s of stacked DoT
    e.poisonTickTimer = ledgerTickInterval();
  }
}

// Apply/refresh a slow, always keeping the stronger (lower) factor while active.
function applySlow(e, factor, durMs) {
  durMs = ledgerDuration(durMs / 1000) * 1000;   // Ashen Ledger stretches chill too
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
    e.burnTickTimer = ledgerTickInterval();
  }
}

function killEnemy(enemy) {
  enemy.dead = true;
  // A poisoned corpse bursts, infecting the nearest healthy foe close by.
  if (enemy.poisonUntil && enemy.poisonUntil > performance.now()) spreadPoisonFrom(enemy);
  if (enemy.voidUntil && enemy.voidUntil > performance.now()) collapseVoid(enemy);
  // Riftborn: the hole is its whole point, so it opens whether the player earned the kill or
  // the thing simply expired. Placed after the mark check so a marked Riftborn does both —
  // a collapse hauling the horde in, and a rift hauling the player after it.
  if (enemy.voidPower === 'rift') voidRiftOnDeath(enemy);
  // A mimic pays what it swallowed, doubled — that is what the key and the fight bought.
  if (enemy.isMimic) {
    const rw = enemy.mimicReward;
    const paid = rw && rw.special === 'gold' ? rw.gold * 2 : 400;
    addGold(heldItem('tithebell') ? Math.round(paid * 0.75) : paid);
    showHeadline('Mimic Slain', `{+${paid}} gold, coughed up whole.`);
    play('jackpot');
  }
  // An elite always leaves a chest — that is the contract that makes one worth stopping for.
  // Rolled a tier up, and in endless it carries the same relic chance any chest does, which is
  // how "endless void loot" reaches a player who is killing elites rather than farming chests.
  if (enemy.isElite && CHESTS_ENABLED) {
    pushChest({ id: S.nextId++, kind: 'chest', x: enemy.x, y: enemy.y, radius: 30,
      reward: rollChestReward('rare', S.player.rarityMult, S.player), dead: false });
    S.pickups.push({ id: S.nextId++, kind: 'key', x: enemy.x + rand(-24, 24),
      y: enemy.y + rand(-24, 24), radius: 8, dead: false });
  }
  relicKillTick(enemy);
  if (relicAt('thelongdark') >= 2 && !litByTorch(enemy)) {
    const next = findNearest(enemy.x, enemy.y, 400, new Set([enemy.id]));
    if (next) next.darkRevealUntil = performance.now() + 1400;
  }
  if (enemy.frozenUntil && enemy.frozenUntil > performance.now()) spawnIceShatter(enemy.x, enemy.y, enemy.radius);
  spawnBlood(enemy.x, enemy.y, enemy.radius / 15);
  if (enemy.isBoss) {
    S.kills++;
    addKills();          // lifetime tally behind the achievements
    play('bossDie');
    // Bosses drop a locked chest (guaranteed Epic tier or better), plus a key to open it.
    //
    // NOT on the kill spot: the portal opens exactly there, and its stone ring and void flames
    // buried the chest under the one piece of scenery on the field. The drop is pushed out past
    // the portal's dressing (stones at ~68px, flame tips ~110px), and toward the PLAYER — that
    // side of the portal is the side they are already standing on, and the portal's own
    // anti-swallow nudge only ever moves it AWAY from the player, so the two can never be
    // shoved back on top of each other. Final stage has no portal and keeps the drop in place.
    let chestX = enemy.x, chestY = enemy.y;
    if (!sandboxMode && !isFinalStage()) {
      const toward = normalize(S.player.x - enemy.x, S.player.y - enemy.y);
      chestX = enemy.x + (toward.x || 0) * 170;
      chestY = enemy.y + (toward.y || 1) * 170;
      const lim = ARENA_RADIUS - 60;
      chestX = clamp(chestX, -lim, lim); chestY = clamp(chestY, -lim, lim);
      // A clamped corner drop could land inside a rock; shove it out the shortest way.
      if (terrain) { const spot = { x: chestX, y: chestY }; terrain.resolve(spot, 34); chestX = spot.x; chestY = spot.y; }
    }
    if (CHESTS_ENABLED) pushChest({ id: S.nextId++, kind: 'chest', x: chestX, y: chestY, radius: 32, reward: rollChestReward('epic', S.player.rarityMult, S.player), dead: false });
    S.pickups.push({ id: S.nextId++, kind: 'key', x: chestX + rand(-30, 30), y: chestY + rand(-30, 30), radius: 8, dead: false });
    // Cracked Hourglass: the hurried boss pays for the hurry with a second chest.
    if (CHESTS_ENABLED && heldItem('hourglass')) {
      pushChest({ id: S.nextId++, kind: 'chest', x: chestX + 70, y: chestY + 20, radius: 32, reward: rollChestReward('epic', S.player.rarityMult, S.player), dead: false });
      S.pickups.push({ id: S.nextId++, kind: 'key', x: chestX + rand(40, 90), y: chestY + rand(-30, 30), radius: 8, dead: false });
    }
    // Bosses drop a hoard of gold, scattered so it reads as a reward burst.
    // The hoard is the campaign's payout for the fight, so it rides the `normal` curve — the
    // horde curve covers the scramble AFTER this, which has not begun yet.
    const hoardCoin = Math.max(1, Math.round(GOLD_RATES.bossCoin * goldMultNow('normal')));
    for (let i = 0; i < GOLD_RATES.bossHoard; i++) {
      S.pickups.push({ id: S.nextId++, kind: 'gold', gold: hoardCoin, x: enemy.x + rand(-40, 40), y: enemy.y + rand(-40, 40), radius: 6, dead: false });
    }
    // A felled stage boss opens a way onward rather than yanking the player through it. The
    // kill scatters gold, a key and whatever the fight's own casualties left lying about, and
    // advancing on the same frame threw all of it away — the reward for the hardest moment in
    // the stage was collected by the next stage's loading screen. The portal waits.
    // Drop the reference as well as the body. advanceStage used to clear this on the same
    // frame; now that the stage keeps running while the player loots, leaving it set holds an
    // empty boss health bar on screen for as long as they take.
    S.boss = null;
    // Sandbox has no stage progression — a scenario is a scenario. Dropping a portal there
    // would offer a one-way door out of the very test being run.
    if (sandboxMode) return;
    // Every boss — campaign or endless — grants a unique item. The shelf caps at three, so a
    // full shelf pays a hoard instead: the moment never lands empty, and which three you ended
    // up with IS the run's identity.
    grantBossItem();
    if (!isFinalStage()) spawnStagePortal(enemy.x, enemy.y);
    else onBossDefeated();
    return;
  }
  S.kills++;
  S.stageKills++;
  addKills();            // lifetime tally behind the achievements
  play('enemyDie');
  // Sandbox drops nothing: XP would level the player mid-test and silently change the very
  // build being measured, and banked gold from a contrived scenario should not reach the shop.
  if (sandboxMode) return;
  // Plague Doctor's Miasma: a death within his reach can foul the air where the body fell.
  // Rides the flask-puddle effect wholesale, so the poison it deals is the poison the player
  // already understands. DPS scales with his level — the passive has to keep mattering after
  // the horde's health curve leaves its starting numbers behind.
  if (S.player.miasma && dist(enemy.x, enemy.y, S.player.x, S.player.y) < MIASMA_REACH
      && Math.random() < MIASMA_CHANCE
      && S.effects.reduce((n, fx) => n + (fx.miasma && !fx.dead ? 1 : 0), 0) < MIASMA_CAP) {
    spawnEffect({ kind: 'poisonPuddle', miasma: true, x: enemy.x, y: enemy.y, radius: 42,
      duration: 2.2, tickInterval: 0.4, poisonDps: 4 + S.player.level * 0.8, poisonDur: 2,
      mods: { damageMult: 1, lifeLeech: 0, critChance: 0 } });
  }
  // --- XP. Only one kill in four leaves an orb, each worth proportionally more: the field
  // stays far less littered (most of the visual noise AND the pickup cost at high kill rates)
  // for the same total. DROP_CHANCE is clutter, ORB_MULT is how fast levels come.
  // Gravebloom pays out on collapse kills specifically — the relic that lets a void build level
  // fast enough to keep pace with the endless surge, rather than one that bypasses it.
  // The Hollowed feeds on what the void consumes: a collapse kill closes his wounds a little.
  // This is his ONLY healing (see noRegen), so it is deliberately per-body — a collapse that
  // catches eight enemies is a real meal, a single kill is a bite.
  if (S.player.voidFeeds && enemy.lastHitByCollapse) {
    S.player.hp = Math.min(S.player.maxHp, S.player.hp + Math.max(2, S.player.maxHp * 0.015));
  }
  const bloom = relicAt('gravebloom');
  const bloomed = bloom > 0 && enemy.lastHitByCollapse;
  const xpMult = bloomed ? RELIC_TUNE.bloomXp : 1;
  if (bloomed || Math.random() < xpDropChance()) {
    S.pickups.push({
      id: S.nextId++, kind: 'xp', x: enemy.x + rand(-8, 8), y: enemy.y + rand(-8, 8),
      xp: Math.max(1, Math.round(enemy.xp * xpOrbValue() * xpMult)), radius: 7, dead: false,
    });
  }
  if (bloomed && bloom >= 2) {
    const coin = Math.max(1, Math.round(enemy.xp * GOLD_RATES.perXp * goldMultNow(goldContext())));
    S.pickups.push({ id: S.nextId++, kind: 'gold', gold: coin,
      x: enemy.x + rand(-10, 10), y: enemy.y + rand(-10, 10), radius: 6, dead: false });
  }

  // --- Gold. The fractional part resolves by chance rather than rounding, so a run of weak
  // enemies averages out to its true worth instead of every one of them being floored to zero
  // or rounded up to a whole coin.
  const ctx = goldContext();
  if (Math.random() < goldDropChance(ctx)) {
    // The curve scales what the coin is WORTH. Applied before the fractional roll below, so a
    // scaled-up value still resolves its remainder by chance rather than being rounded twice.
    const goldValue = enemy.xp * GOLD_RATES.perXp * goldMultNow(ctx);
    const goldAmt = Math.floor(goldValue) + (Math.random() < goldValue % 1 ? 1 : 0);
    if (goldAmt > 0) {
      S.pickups.push({ id: S.nextId++, kind: 'gold', gold: goldAmt, x: enemy.x + rand(-8, 8), y: enemy.y + rand(-8, 8), radius: 5, dead: false });
    }
  }

  // --- Health potion. Its own roll, so it can now drop from an enemy that left no coin.
  if (Math.random() < potionDropChance()) {
    S.pickups.push({ id: S.nextId++, kind: 'health', heal: potionHealFraction(), x: enemy.x + rand(-10, 10), y: enemy.y + rand(-10, 10), radius: 7, dead: false });
  }
  // Locked treasure chests replace the old direct item drops, at half the old rate (0.08 -> 0.04).
  // The reward inside is rolled now and revealed when a key opens it.
  if (CHESTS_ENABLED && Math.random() < chestDropChance()) {
    // Gravebloom's third copy lifts every endless chest one tier.
    const floorTier = (relicAt('gravebloom') >= 3 && relicWave() > 0) ? 'rare' : null;
    pushChest({ id: S.nextId++, kind: 'chest', x: enemy.x, y: enemy.y, radius: 30, reward: rollChestReward(floorTier, S.player.rarityMult, S.player), dead: false });
  }
  // Silver keys drop rarely to open those chests.
  if (CHESTS_ENABLED && Math.random() < keyDropChance()) {
    S.pickups.push({ id: S.nextId++, kind: 'key', x: enemy.x + rand(-10, 10), y: enemy.y + rand(-10, 10), radius: 10, dead: false });
  }
  if (enemy.splits) {
    const base = ENEMY_TYPES[enemy.spriteId];
    // Halves are measured off THIS parent, not off the type: a slime that rolled large leaves
    // large children behind it. Reading from base.radius instead would have made every split
    // produce the same standard pair, which reads as the size roll being ignored on death.
    const rolled = base.radius ? enemy.radius / base.radius : 1;
    for (let i = 0; i < 2; i++) {
      const hp = base.hp * 0.4 * Math.pow(rolled, SIZE_HP_EXP);
      S.enemies.push({
        ...base, id: S.nextId++, spriteId: enemy.spriteId, x: enemy.x + rand(-14, 14), y: enemy.y + rand(-14, 14),
        radius: enemy.radius * 0.6, hp, maxHp: hp, splits: false, dead: false, hitCd: 0,
      });
    }
  }
}

const world = { findNearest, enemiesInRange, countMinions, damageEnemy, spawnProjectile, spawnEffect, spawnMinion, playSfx: play,
  // The void line needs the collapse machinery the player's own infusion already uses, so
  // Entropy's detonation IS a collapse — it inherits Tidebreaker, Gravebloom and The Long Dark
  // for free rather than reimplementing a second kind of implosion beside them.
  collapse: collapseVoid, markVoid: applyVoidMark,
  /**
   * Update a standing effect of `kind` in place, or spawn it if none is up.
   *
   * For a PERSISTENT skill, recasting must not restart it. Nullward holds its swallowed shots
   * until it is full, so tearing the ward down and building a new one every cooldown reset the
   * count to zero — the same progress loss the old expiry timer caused, wearing a different
   * hat. Refreshing copies the freshly-computed numbers (count, damage, radii) onto the ward
   * that is already spinning and leaves everything it has EARNED alone.
   */
  refreshEffect: (kind, opts, keep) => {
    const live = S.effects.find((fx) => fx.kind === kind && !fx.dead);
    if (!live) { spawnEffect(opts); return; }
    for (const [k, v] of Object.entries(opts)) {
      if (k === 'kind' || keep.includes(k)) continue;
      live[k] = v;
    }
  } };
// Removes entries failing `keep`, preserving order, without allocating a new array.
function compact(arr, keep) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[w++] = arr[i];
  arr.length = w;
}

/**
 * Shots waiting on a `delay`. A staggered volley is the reason this exists.
 *
 * Firing every extra projectile on the same frame is what made a Quantity stack read as one fat
 * pulse — a rigid, evenly-spaced fan that leaves the screen as a single wall. Spacing them by a
 * few dozen milliseconds turns the same projectiles into a burst you can watch, and it costs
 * nothing: the shot is built at cast time and only its spawn is held back, so the volley still
 * uses the mods and aim it was cast with rather than re-reading them later.
 * @type {{ at: number, opts: any }[]}
 */
let pendingShots = [];

/**
 * The arena's rock, rebuilt per stage.
 *
 * Regenerated on every stage rather than once per run, so the three realms do not share a
 * layout — walking into stage 2 and recognising the boulder you kited around in stage 1 would
 * undo the whole point of generating it.
 * @type {import('./terrain.js').Terrain|null}
 */
let terrain = null;
/** Dials that change WHERE rock is, rather than what colour it is. Moving one rebuilds it. */
const TERRAIN_LAYOUT_KEYS = new Set(['clusters', 'minRadius', 'maxRadius', 'ridgeChance',
  'ridgeLength', 'clearRadius', 'edgeMargin', 'spacing', 'seed', 'sizeVary']);
/** The live rock, for the dev panel and for verifying collision. Same reason PERF is exported. */
export const debugTerrain = () => terrain;

/** Seconds until the next elite. Counts down in the spawn loop; reset on a new run. */
let eliteTimer = 0;

/** Release any queued shots whose delay has elapsed. Called once per update. */
function updatePendingShots(dt) {
  if (!pendingShots.length) return;
  let due = false;
  for (const q of pendingShots) { q.at -= dt; if (q.at <= 0) due = true; }
  if (!due) return;
  const still = [];
  for (const q of pendingShots) { if (q.at <= 0) spawnProjectile(q.opts); else still.push(q); }
  pendingShots = still;
}

function spawnProjectile(opts) {
  // `delay` holds the shot back without changing anything else about it.
  if (opts && opts.delay > 0) {
    const { delay, ...rest } = opts;
    pendingShots.push({ at: delay, opts: rest });
    return;
  }
  const p = { id: S.nextId++, hitSet: new Set(), dead: false, forks: 0, childChain: 0,
    mods: { damageMult: 1, lifeLeech: 0, critChance: 0 }, ...opts };
  // The life it STARTED with, so a projectile can tell how far through its flight it is. Lobbed
  // charges read their arc height off this; nothing else touches it.
  p.lifeMax = p.life;
  // Forks branch geometrically — each level doubles the projectile count, so an uncapped
  // Forking stack reaches thousands. Capped centrally so every skill and every forked child
  // inherits the limit without each needing to remember it.
  p.forks = Math.min(p.forks || 0, MAX_FORK_DEPTH);
  S.projectiles.push(p);
}
function spawnEffect(opts) { S.effects.push({ id: S.nextId++, t: 0, dead: false, ...opts }); }

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
// radius defaults BEFORE ...opts so a caller can still override it. Minions were being created
// without one, which quietly turned their position into NaN the first time they walked: the
// stand-off maths in moveToward reads e.radius, `undefined + n` is NaN, `d <= NaN` is false so
// the early-out never fires, and the step length lands on the position. A NaN position throws
// no error — drawImage just silently paints nothing — so the minions appeared to vanish.
// Skeleton minions, sized in one place. The drawn height and the collision radius are separate
// numbers used by separate systems, and nudging one without the other is how a sprite ends up
// bumping into things it visibly is not touching — so both are derived from the same scale.
// +30%, then another +15%: 46 -> 68.8 drawn, 14 -> 20.9 radius.
const MINION_SCALE = 1.3 * 1.15;
const MINION_SPRITE_H = 46 * MINION_SCALE;
const MINION_RADIUS = 14 * MINION_SCALE;

function spawnMinion(opts) {
  S.minions.push({ id: S.nextId++, hp: 0, dead: false, atkTimer: 0, radius: MINION_RADIUS, ...opts });
}

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
// Seconds without losing shield before it starts coming back, and seconds per unit restored.
//
// The recharge is NOT part of the brief — it is here because without it armor is a one-time
// buffer of a handful of hits and then a dead stat for the rest of the run, which would make
// every +armor pickup worthless after the first minute. Tunable, and removable if you would
// rather armor be a consumable resource.
const ARMOR_RECHARGE_DELAY = 6;
const ARMOR_RECHARGE_INTERVAL = 2.5;

// ---------- Death readout ----------
// What killed you, named. Every source that can reduce player health passes a label through
// applyDamageToPlayer; these two build that label from the thing doing the damage, so a new
// enemy or a promoted elite needs no extra bookkeeping to be named correctly on the screen.
//
// ============================ CONTRACT FOR NEW DAMAGE SOURCES ============================
// ANY new way to hurt the player — a new enemy attack, boss skill, hazard, damage-over-time,
// terrain, self-damage, anything — MUST call applyDamageToPlayer(amount, source, kind) with
// both a source label and a kind. A source that omits them is not a crash and not a visible
// bug; it is a death screen that shrugs and says "The Horde", which is precisely the moment
// the feature was supposed to explain. tools/smoke.mjs asserts every call site passes them,
// so a forgetful one fails `npm run check` rather than being discovered in a playtest.
//
//   source  what the player should blame, in their words. Use enemyLabel(e) whenever a
//           creature is behind it, so elites and Void Afflicted name themselves correctly.
//           For a named skill, "Owner — Skill Name" reads best: 'Karguth — Hellhook'.
//   kind    one of DEATH_KINDS, choosing the verb the screen phrases it with. If none of
//           them fit what you are adding, add a kind here AND a phrasing for it in
//           DEATH_PHRASE (ui.js) — the two lists are meant to be edited together.
// =========================================================================================
/** The damage categories the death screen knows how to phrase. See DEATH_PHRASE in ui.js. */
const DEATH_KINDS = ['dot', 'contact', 'slam', 'projectile', 'skill', 'hit'];

/** The creature's own name, preferring the elite/miniboss title it earned. */
function enemyLabel(e) {
  if (!e) return 'The Horde';
  if (e.eliteName) return e.eliteName;                 // "Rockhide Ogre the Rotcaller"
  const base = e.name || 'The Horde';
  return e.voidAfflicted ? `Void Afflicted ${base}` : base;
}

/** A shot, named after whoever loosed it — the body may already be dead by the time it lands. */
function projectileLabel(p) {
  const src = p.srcId !== undefined ? S.enemies.find((en) => en.id === p.srcId) : null;
  if (src) return `${enemyLabel(src)} — Shot`;
  return 'Enemy Shot';
}

/**
 * THE one place the player loses health — every source routes through here, which is what
 * makes the death readout trustworthy rather than a guess.
 *
 * `src` names what did it, in the player's language: 'Shambler', 'Boss Slam', 'Burning'. It is
 * recorded on every hit (not just fatal ones) because the interesting question after dying is
 * usually "what was chewing on me", and a damage-over-time tick that finishes you looks
 * identical to a melee hit unless the source is carried in.
 * @param {number} raw @param {string} [src] @param {string} [kind] one of DEATH_KINDS
 * @param {any} [srcEnemy] the creature behind the hit, when one exists — the Salt Ledger reads it
 */
function applyDamageToPlayer(raw, src, kind, srcEnemy) {
  // Two independent switches: the dev-tools cheat, and the sandbox's own per-scenario flag.
  // Kept separate so enabling it for a measurement cannot survive into a real run.
  if (getSettings().godMode || S.player.godMode) return;
  // Salt Ledger: the first touch from each KIND of foe each stage is warded to nothing. Keyed
  // by spriteId so a Shambler spends the ward for all Shamblers — the item is about knowing the
  // roster, and it reads per creature-kind, not per body.
  if (srcEnemy && heldItem('saltledger')) {
    const key = srcEnemy.spriteId || srcEnemy.name || '?';
    if (!saltSeen.has(key)) {
      saltSeen.add(key);
      spawnDamageNumber(S.player.x, S.player.y - S.player.radius, 0, false, '#c9bfa8', S.player);
      showHeadline('{Salt Ledger}', `${enemyLabel(srcEnemy)}'s first touch is warded.`);
      return;
    }
  }
  // Sunder is an elite-only affliction and the only thing in the game that multiplies incoming
  // damage. Applied before armour so it scales the hit that armour is then asked to absorb —
  // shattering a guard should make the shield worse, not be shrugged off by it.
  if (afflicted('sunder')) raw *= SUNDER_MULT;
  // Second Silence eats the hit that would end the run. Checked BEFORE armour and the health
  // subtraction so it cannot be skipped by a hit large enough to shatter the shield.
  if (S.player.silenceUntil && S.player.silenceUntil > performance.now()) return;

  // Armor is a shield that eats whole hits rather than shaving damage off them. A hit landing
  // while any shield remains is absorbed completely and costs units by its size; a hit bigger
  // than the shield left SHATTERS it and lands in full. That is what makes stacking armor
  // matter — a deep shield survives a boss slam, a shallow one is stripped and you still wear
  // the hit.
  S.player.armorTimer = 0;
  const cost = armorCost(raw);
  if (S.player.armorLeft > 0) {
    const had = S.player.armorLeft;
    S.player.armorLeft = Math.max(0, had - cost);
    if (had >= cost) {
      // Fully absorbed. Shown in the shield's own blue so it reads as armor, not health.
      spawnDamageNumber(S.player.x, S.player.y - S.player.radius, cost, false, '#7f93ab', S.player);
      shakeAmount = Math.min(16, shakeAmount + cost * 0.8);
      return;
    }
  }
  let reduced = Math.max(1, Math.round(raw));
  // Ashen Lung: damage-over-time cannot deliver the killing blow — it gnaws to 1 life and
  // stops. The direct hit that follows still can, which is the bargain's honest edge.
  if (kind === 'dot' && heldItem('ashenlung') && S.player.hp - reduced < 1) {
    reduced = Math.max(0, S.player.hp - 1);
    if (reduced === 0) return;
  }
  S.player.hp -= reduced;
  // The hit flash. Set HERE, on the one line that actually removes health, so every source
  // lights it — contact, projectiles, damage-over-time, a boss slam — without any of them
  // having to remember to. Armour absorbs are deliberately excluded: those return before this
  // line, and they already have their own blue readout.
  S.player.hurtFlash = 1;
  // Recorded AFTER armour, so the readout reports the hit that actually reached health rather
  // than one the shield ate. `hpLeft` is what remains, which is how the screen can tell a
  // finishing blow from the chip damage that set it up.
  S.lastHit = { src: src || 'The Horde', kind: kind || 'hit', amount: reduced,
    hpLeft: Math.max(0, S.player.hp), at: S.elapsed };
  spawnDamageNumber(S.player.x, S.player.y - S.player.radius, reduced, false, '#c94a3f', S.player);
  shakeAmount = Math.min(16, shakeAmount + reduced * 0.5);
  if (S.player.hp <= 0) {
    // Bone Reassembly, checked before the relic: the class passive is the Skeleton's own and
    // spends first, so a carried Second Silence still stands behind it. He scatters where he
    // fell — untouchable, uncontrollable — and the bones pull back together on their own clock.
    if (S.player.boneReassembly && !S.player.reassembleUsed) {
      S.player.reassembleUsed = true;
      S.player.reassembling = REASSEMBLE_TIME;
      S.player.hp = 1;
      S.player.silenceUntil = performance.now() + REASSEMBLE_TIME * 1000 + 200;
      S.player.shoveX = 0; S.player.shoveY = 0; S.player.shoveT = 0;   // a pile cannot be flung
      ui.showToast('Scattered', 'The Skeleton falls apart… and begins pulling himself together.',
        '#a89e85');
      play('bossSpawn');
      return;
    }
    // Second Silence: the run does not end while a charge remains. Left at 1 life with a brief
    // untouchable window, which is the part that matters — surviving at 1hp inside the same
    // crowd that just killed you is not a reprieve unless you can move first.
    const silence = relicAt('secondsilence');
    if (silence && S.player.silenceLeft > 0) {
      S.player.silenceLeft--;
      S.player.hp = 1;
      S.player.silenceUntil = performance.now() + RELIC_TUNE.silenceGrace * 1000;
      spawnEffect({ kind: 'ring', x: S.player.x, y: S.player.y, radius: 90,
        color: RELICS.secondsilence.color, duration: 0.5, mods: {} });
      // The third copy turns the panic beat into an offensive one.
      if (silence >= 3) collapseVoid({ x: S.player.x, y: S.player.y, maxHp: S.player.maxHp });
      ui.showToast('Second Silence', 'A fatal blow passes through you.',
        RELICS.secondsilence.color);
      play('levelUp');
    } else {
      S.player.hp = 0; triggerGameOver();
    }
  }
}

// Shield regrows after a lull. Called once per frame from the run update.
function updateArmor(dt) {
  const p = S.player;
  if (!p || p.armorLeft >= p.armor) return;
  p.armorTimer = (p.armorTimer || 0) + dt;
  if (p.armorTimer < ARMOR_RECHARGE_DELAY) return;
  const ticks = Math.floor((p.armorTimer - ARMOR_RECHARGE_DELAY) / ARMOR_RECHARGE_INTERVAL) + 1;
  p.armorLeft = Math.min(p.armor, p.armorLeft + ticks);
  p.armorTimer = ARMOR_RECHARGE_DELAY + ((p.armorTimer - ARMOR_RECHARGE_DELAY) % ARMOR_RECHARGE_INTERVAL);
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
  // Both radii are guarded. A missing radius here does not throw — it makes `stop` NaN, which
  // defeats the early-out below and writes NaN into the entity's position, and a NaN position
  // renders as nothing at all. Silent disappearance is a miserable thing to track down, so
  // treat an absent radius as zero rather than letting it poison the arithmetic.
  const stop = (e.radius || 0) + (target.radius || 0) * MELEE_STANDOFF;
  const d = Math.hypot(dx, dy);
  if (d <= stop) return; // already at the ring: hold, don't burrow into the target
  // Never overshoot the ring in a single step, or a fast enemy would jitter across it.
  const stepLen = Math.min(speed * dt, d - stop);
  e.x += n.x * stepLen; e.y += n.y * stepLen;
}

/**
 * Move along an ARBITRARY vector — sideways, backwards, or along a committed charge line —
 * while still facing whoever is being fought. moveToward can only walk at its target, so every
 * behaviour that is not a straight approach needs this.
 *
 * Facing is taken from the target rather than from travel: an enemy hopping backwards out of
 * reach should still be looking at the player, and one strafing should be side-on to them.
 * @param {any} e
 * @param {number} vx @param {number} vy
 * @param {number} speed @param {number} dt
 * @param {any} faceTarget
 */
function moveVec(e, vx, vy, speed, dt, faceTarget) {
  if (faceTarget) {
    const f = normalize(faceTarget.x - e.x, faceTarget.y - e.y);
    if (Math.abs(f.x) > 0.05) e.facingLeft = f.x < 0;
    e.dirX = f.x; e.dirY = f.y;
  }
  if (speed <= 0) return;                       // windup: face, do not travel
  const n = normalize(vx, vy);
  let nx = e.x + n.x * speed * dt;
  let ny = e.y + n.y * speed * dt;
  // Backing off and strafing can walk a body out of the arena, which walking at the player in
  // the middle of it never could. Keep them on the field.
  // Enemies collide with rock too — this is what makes an obstacle a tactical object rather
  // than scenery. A horde funnelling around a ridge is the whole reason the system exists.
  if (terrain) terrain.resolve(e, e.radius || 0);
  const lim = ARENA_RADIUS - (e.radius || 0);
  const d = Math.hypot(nx, ny);
  if (d > lim) { const k = lim / d; nx *= k; ny *= k; }
  e.x = nx; e.y = ny;
}

const AI_API = { toward: moveToward, vec: moveVec, dist };

// How hard bodies push out of each other, how far apart they aim to sit, and how much that
// distance differs body to body — all three live in ENEMY_GLOBALS so the dev panel can drive
// them while a horde is on screen, which is the only way to judge a crowd.

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
  // Each body's OWN idea of personal space, derived from its id so it never changes under it.
  // Two neighbours therefore push with slightly different strengths, and that asymmetry is the
  // point: equal mutual forces settle into a lattice, unequal ones never quite settle, so the
  // crowd keeps shuffling and stays irregular instead of packing into one tidy clot.
  const spacing = ENEMY_GLOBALS.crowdSpacing
    * (1 + (((e.id * 0.7548776662) % 1) - 0.5) * ENEMY_GLOBALS.crowdVary);
  // Widened by the largest spacing any body could want, or the roomiest ones would never see
  // the neighbours they are supposed to be avoiding.
  const reach = e.radius * 2 * ENEMY_GLOBALS.crowdSpacing * (1 + ENEMY_GLOBALS.crowdVary / 2);
  let px = 0, py = 0, n = 0;
  forEachNear(e.x, e.y, reach, (o) => {
    if (o === e || n >= 6) return; // cap the neighbours considered: cost, and 6 is plenty to unstack
    const want = (e.radius + o.radius) * spacing;
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
  e.x += (px / n) * ENEMY_GLOBALS.crowdPush * dt;
  e.y += (py / n) * ENEMY_GLOBALS.crowdPush * dt;
}

// Sandbox "Wander": drift from wherever it was placed, re-rolling its heading every so often.
// Not pathing and not fleeing — it is a way to watch a monster move, turn and animate without
// it beelining at you, which is what both other behaviours end in.
const WANDER_TURN_MIN = 1.1;   // seconds before the earliest heading change
const WANDER_TURN_SPAN = 2.2;  // ...and the window it lands in
const WANDER_SPEED = 0.6;      // fraction of its own speed; an amble, not a charge

function wanderStep(e, dt) {
  e.wanderTimer = (e.wanderTimer || 0) - dt;
  if (e.wanderAngle === undefined || e.wanderTimer <= 0) {
    e.wanderAngle = Math.random() * Math.PI * 2;
    e.wanderTimer = WANDER_TURN_MIN + Math.random() * WANDER_TURN_SPAN;
  }
  const sp = e.speed * WANDER_SPEED;
  let nx = e.x + Math.cos(e.wanderAngle) * sp * dt;
  let ny = e.y + Math.sin(e.wanderAngle) * sp * dt;
  const lim = ARENA_RADIUS - 40;
  // At the wall, turn back toward the middle rather than grinding along it — a clamp alone
  // would leave a row of enemies pressed into the boundary for the rest of the run.
  if (nx < -lim || nx > lim || ny < -lim || ny > lim) {
    e.wanderAngle = Math.atan2(-ny, -nx) + rand(-0.6, 0.6);
    e.wanderTimer = WANDER_TURN_MIN;
    nx = clamp(nx, -lim, lim); ny = clamp(ny, -lim, lim);
  }
  e.x = nx; e.y = ny;
  // Same two fields moveToward maintains, so the facing system picks the right view.
  if (Math.abs(Math.cos(e.wanderAngle)) > 0.05) e.facingLeft = Math.cos(e.wanderAngle) < 0;
  e.dirX = Math.cos(e.wanderAngle); e.dirY = Math.sin(e.wanderAngle);
}

function updateEnemy(e, dt) {
  if (e.dead) return;
  // Knock-back from a boss's thrown rock, bleeding off over ROCK_SHOVE_TIME. Applied before
  // anything else so pathing and crowd separation both act on the shoved position, which is
  // what stops a knocked body from simply walking straight back through the impulse.
  if (e.shoveT > 0) {
    const k = e.shoveT / (e.shoveMax || ROCK_SHOVE_TIME);   // 1 at impact, 0 when spent
    e.x += e.shoveX * k * dt;
    e.y += e.shoveY * k * dt;
    e.shoveT -= dt;
  }
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
  if (e.sandboxWander) { wanderStep(e, dt); return; }
  const slowed = e.slowUntil && e.slowUntil > performance.now();
  const speed = e.speed * (slowed ? e.slowFactor : 1);
  let target = S.player, td = dist(e.x, e.y, S.player.x, S.player.y);
  for (const m of S.minions) {
    // Bones are not a target. Letting the horde pile onto a reviving skeleton would trap it in
    // a loop of re-forming into the same crowd that just killed it, and would pull enemies off
    // the player to beat on something that cannot be hurt.
    if (m.dead || m.reviving) continue;
    const d = dist(e.x, e.y, m.x, m.y);
    if (d < td) { td = d; target = m; }
  }
  if (e.ranged) {
    e.shootTimer = (e.shootTimer || 0) - dt;
    const pd = dist(e.x, e.y, S.player.x, S.player.y);
    if (pd <= e.range) {
      if (e.shootTimer <= 0) {
        const n = normalize(S.player.x - e.x, S.player.y - e.y);
        spawnProjectile({
          x: e.x, y: e.y, vx: n.x * e.projSpeed, vy: n.y * e.projSpeed, radius: e.projRadius || 5, life: 3,
          color: e.projColor || '#a89e83', damage: e.damage, enemyOwned: true, isArrow: e.projStyle !== 'orb',
          srcId: e.id,   // so a landed shot can break the Shinobi's First Strike mark
        });
        e.shootTimer = e.shootCd;
      }
      if (pd > e.range * 0.6) moveToward(e, target, speed * 0.6, dt);
    } else moveToward(e, target, speed, dt);
  } else {
    meleeStep(e, target, speed, dt, AI_API);
  }
  e.hitCd = (e.hitCd || 0) - dt;
  if (e.hitCd <= 0 && dist(e.x, e.y, target.x, target.y) <= e.radius + target.radius) {
    // The harrier bounces off a CONNECTED hit, so the flag is set here rather than on
    // proximity — otherwise it would recoil from near-misses it never landed.
    e.justHit = true;
    if (target === S.player) { applyDamageToPlayer(e.damage, enemyLabel(e), 'contact', e); shovePlayerFrom(e); }
    else { target.hp -= e.damage; spawnDamageNumber(target.x, target.y, e.damage, false, '#c9756f', target); if (target.hp <= 0) downMinion(target); }
    e.hitCd = e.contactCd;
  }
}

function updateBoss(e, dt) {
  // A boss faces its TARGET, not merely its last step. It spends whole seconds rooted in a
  // wind-up or a slam telegraph, and every one of the branches below returns early — so facing
  // driven by movement would freeze mid-turn, or never be set at all.
  //
  // And it would never be set at all: updateEnemy hands bosses to this function BEFORE it calls
  // updateFacing, so this is the only place a boss's viewDir is ever assigned. Without it every
  // boss fell back to the 'side' view for its whole life, which is why the Skeleton King's other
  // seven sheets loaded and were never once drawn.
  const aim = normalize(S.player.x - e.x, S.player.y - e.y);
  if (aim.x || aim.y) {
    e.dirX = aim.x; e.dirY = aim.y;
    // Still maintained for sprites that have only a side sheet: they mirror off this flag.
    // A sprite with real left art resolves `left` directly and is never flipped — see spriteQuad.
    if (Math.abs(aim.x) > 0.05) e.facingLeft = aim.x < 0;
  }
  updateFacing(e, dt);
  // Ticked at the top, ahead of every branch below: the swing plays out AFTER the slam state
  // has gone back to idle, and half of those branches return early. Anywhere lower and the
  // blade would freeze mid-arc the moment the boss started doing something else.
  if (e.swingT > 0) e.swingT = Math.max(0, e.swingT - dt);

  // Wind-up for the thrown rock. Held before the slam check so the two never overlap: the
  // boss is committed to one heavy move at a time, which is what makes either one dodgeable.
  if (e.rockState === 'wind') {
    e.rockTimer -= dt;
    if (e.rockTimer <= 0) { throwBossRock(e); e.rockState = 'idle'; e.rockCdTimer = ROCK_COOLDOWN; }
    return;
  }
  // Signature-skill telegraph: rooted, like every other heavy move. One committed action at a
  // time is the whole grammar of the boss fight — each of these branches returns early so the
  // boss can never be slamming, throwing and casting in the same breath.
  if (e.bsState === 'telegraph') {
    e.bsTimer -= dt;
    if (e.bsTimer <= 0) { e.bsState = 'idle'; castBossSkill(e, e.bsCasting); }
    return;
  }
  if (e.slamState === 'telegraph') {
    e.slamTimer -= dt;
    if (e.slamTimer <= 0) {
      if (dist(S.player.x, S.player.y, e.x, e.y) <= e.slamRadius) applyDamageToPlayer(e.damage * 1.7, `${enemyLabel(e)} — Slam`, 'slam');
      sweepTrashMobs(e);
      e.slamState = 'idle'; e.slamCdTimer = e.slamCd;
      // Damage lands HERE, on the frame the wind-up ends, and the whip-round plays out from
      // this instant — the impact is the start of the swing, not the end of it, so what hurt
      // you is the same moment you saw the blade come round.
      e.swingT = GREATSWORD_SWING;
      play('bossSpawn');
      shakeAmount = Math.min(20, shakeAmount + 9);
    }
    return;
  }
  e.slamCdTimer = (e.slamCdTimer === undefined ? e.slamCd : e.slamCdTimer) - dt;
  moveToward(e, S.player, e.speed, dt);
  e.hitCd = (e.hitCd || 0) - dt;
  if (e.hitCd <= 0 && dist(e.x, e.y, S.player.x, S.player.y) <= e.radius + S.player.radius) {
    applyDamageToPlayer(e.damage, enemyLabel(e), 'contact', e); shovePlayerFrom(e); e.hitCd = e.contactCd;
  }
  if (e.slamCdTimer <= 0) { e.slamState = 'telegraph'; e.slamTimer = e.slamTelegraph; e.slamX = S.player.x; e.slamY = S.player.y; return; }

  // Rock throw. Only at range: up close the slam is the threat, and a boulder launched from
  // arm's length is unreadable and impossible to avoid.
  e.rockCdTimer = (e.rockCdTimer === undefined ? ROCK_COOLDOWN * 0.6 : e.rockCdTimer) - dt;
  const pd = dist(e.x, e.y, S.player.x, S.player.y);
  if (e.rockCdTimer <= 0 && pd > e.slamRadius && pd <= ROCK_RANGE) {
    e.rockState = 'wind'; e.rockTimer = ROCK_WINDUP;
    return;
  }

  // The boss's own two signature skills, alternating on one shared clock. Scheduled LAST, so
  // the slam and the rock — the moves the player has already learned — always take priority
  // and the new skills fill the space between them rather than crowding them out.
  const kit = BOSS_SKILLS[e.spriteId];
  if (!kit) return;
  e.bsCdTimer = (e.bsCdTimer === undefined ? BOSS_SKILL_CD * 0.5 : e.bsCdTimer) - dt;
  if (e.bsCdTimer > 0) return;
  let skill = kit[e.bsNext ? 1 : 0];
  // Marrow Harvest with no court in reach is a wasted telegraph — take the crown instead.
  if (skill === 'marrowHarvest' && !S.enemies.some((m) => !m.dead && !m.isBoss && !m.isElite
      && dist(m.x, m.y, e.x, e.y) < MARROW_REACH)) skill = kit[1];
  e.bsNext = !e.bsNext;
  e.bsCdTimer = BOSS_SKILL_CD;
  e.bsState = 'telegraph'; e.bsTimer = BOSS_SKILL_TELEGRAPH; e.bsCasting = skill;
}

// ---------- Boss signature skills ----------
// Two per boss, keyed by the entity's spriteId (the one identity both spawn paths carry).
// Each pair answers the same design question two ways: what does THIS land do to you that the
// others cannot? The graveyard spends its dead, the desert passes judgement, the underworld
// turns the player's own void against them.
const BOSS_SKILLS = {
  boss: ['marrowHarvest', 'crownOfBones'],              // The Skeleton King
  sandPharaoh: ['judgementRing', 'scarabHost'],         // Akhmet
  hollowSovereign: ['sovereignMaw', 'hollowLegion'],    // The Hollow Sovereign
};
const BOSS_SKILL_CD = 9;
const BOSS_SKILL_TELEGRAPH = 0.9;
const MARROW_REACH = 340;
const CURSE_GAP_HALF = 0.42;   // half-width of each escape gap, radians

// The Warrior's spiked plate: damage returned per landed contact hit, base plus max armor.
// At his tuned armor of 8 that is 17 per touch — about two-thirds of an early Shambler per
// swing IT initiated, rising as armor items land. Deliberately keyed to contact only:
// projectiles hitting plate is a different (unbuilt) idea, and thorns that answer arrows
// would quietly turn him into a turret.
const THORNS_BASE = 5;
const THORNS_PER_ARMOR = 1.5;

// How hard Nullward hauls on incoming fire, in px/sec² at the mouth. Tuned so a shot entering
// the pull radius side-on is turned into the ward rather than merely nudged — the whole point
// is that the ward is a place bullets GO, not a small circle they occasionally clip.
const NULLWARD_PULL = 2600;

// Sorceress Overchannel: up to +40% damage after two seconds planted, gone the moment she walks.
const OVERCHANNEL_MAX = 0.4;
const OVERCHANNEL_RAMP = 2;
/** Live multiplier, read by computeMods every frame. */
function overchannelMult(p) {
  if (!p.overchannel) return 1;
  return 1 + OVERCHANNEL_MAX * Math.min(1, (p.stillTime || 0) / OVERCHANNEL_RAMP);
}

// Ranger Sharpshooter: shot damage by distance at impact — under-tuned point blank, well over
// at her outrange. The midpoint (~1x) sits near where a mid-range class would fight, so the
// passive reads as "reward for range" rather than a flat buff.
const SHARP_MIN = 0.8;
const SHARP_MAX = 1.35;
// Where the payout peaks: HALF her signature skill's live targeting range, not a frozen pixel
// count. Quick Shot's tuned 1100px puts the peak at 550 — exactly where the old constant sat —
// but read through the tune every hit, so dragging the Targeting Range slider retunes the
// passive with it and the two can never drift apart.
const sharpRange = () => SKILLS.quickshot.tune.targetRange * 0.5;

// Skeleton Bone Reassembly: seconds scattered, and the health the bones stand back up with.
const REASSEMBLE_TIME = 2;
const REASSEMBLE_HP = 0.3;

// Plague Doctor Miasma: kills within reach may foul the air. Chance-gated and capped so a
// harvest reads as pockets of poison, not a lawn of it — and so the effect count stays sane.
const MIASMA_REACH = 150;
const MIASMA_CHANCE = 0.35;
const MIASMA_CAP = 12;

function castBossSkill(e, skill) {
  if (skill === 'marrowHarvest') {
    // The king eats his court: the six nearest trash mobs are consumed — no deaths, no drops,
    // their bodies simply stream into him as healing. It makes the space AROUND the boss a
    // resource the player can deny him by clearing it first.
    const prey = S.enemies
      .filter((m) => !m.dead && !m.isBoss && !m.isElite && dist(m.x, m.y, e.x, e.y) < MARROW_REACH)
      .sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))
      .slice(0, 6);
    for (const m of prey) {
      m.dead = true;   // straight to dead: consumed, not killed — no xp, no gold, no chest roll
      spawnEffect({ kind: 'soulStream', x: m.x, y: m.y, tx: e.x, ty: e.y, duration: 0.55, mods: {} });
    }
    if (prey.length) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.045 * prey.length);
      play('bossSpawn');
    }
  } else if (skill === 'crownOfBones') {
    // A dead king's crown, thrown: twelve bone shards in a full radial. Slow enough to walk
    // between — the skill is a screen-shaped question, not a bullet.
    const n = 12, base = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * Math.PI * 2;
      spawnProjectile({
        x: e.x, y: e.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
        radius: 6, life: 2.6, color: '#cfc4a8', damage: Math.round(e.damage * 0.6),
        enemyOwned: true, isArrow: false,
      });
    }
  } else if (skill === 'judgementRing') {
    // Anubis weighs you: an expanding ring of curse-light with two rotating gaps. Passing
    // through a gap is the acquittal; touching the ring is the sentence — damage and BLIGHT,
    // the healing cut, which is the most Akhmet thing a wound can be.
    // 0.64, down from 0.8. The ring is a positional test — read the gaps, walk through one —
    // and a positional test that one-shots stops teaching and starts feeling arbitrary, because
    // by the time you have learned the pattern the run is already over. It still hurts enough
    // that being caught is a real mistake; it no longer ends the fight on its own.
    spawnEffect({ kind: 'curseRing', x: e.x, y: e.y, radius: 46, duration: 2.6,
      gapA: Math.random() * Math.PI * 2, damage: Math.round(e.damage * 0.64), mods: {} });
  } else if (skill === 'scarabHost') {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.random();
      spawnLesser('scarab', e.x + Math.cos(a) * 70, e.y + Math.sin(a) * 70);
    }
  } else if (skill === 'sovereignMaw') {
    // The player's own collapse, inverted: a rift under their feet that pulls THEM. Escapable
    // at a walk from the edge, barely at a sprint from the middle, then it implodes.
    spawnEffect({ kind: 'hollowRift', x: S.player.x, y: S.player.y, radius: 170,
      duration: 2.2, damage: Math.round(e.damage * 1.4), mods: {} });
  } else if (skill === 'hollowLegion') {
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      spawnLesser(pick(['hollowZombie', 'pitDemon', 'wailingGhost']),
        e.x + Math.cos(a) * 120, e.y + Math.sin(a) * 120, true);   // void afflicted, all three
    }
  }
}

// Skeleton hit-and-run tuning. He darts in for one heavy strike, then immediately
// disengages instead of standing in the enemy trading blows.
const MINION_DASH_SPEED = 660;   // charge-in speed
const MINION_BACK_SPEED = 430;   // disengage speed
const MINION_STANDOFF = 104;     // hover distance held between strikes
const MINION_RETREAT_TIME = 0.32;

// ---------- Death, which is temporary ----------
// A skeleton that is cut down does not leave the roster. It collapses into a heap of bones,
// waits out a revive timer, and stands back up at full health — so once the player has earned a
// body they keep it, and a bad thirty seconds cannot permanently shrink the retinue.
//
// It matters more than it sounds. The cap is what multiplies the skill's damage, and before this
// a stage-3 crowd could strip a twelve-skeleton retinue down to two and leave it there: the
// re-summon only refilled on the 5s cast cooldown, one wave at a time, so the skill's real output
// collapsed exactly when it was needed. Reviving each body on its own clock decouples recovery
// from the cast rhythm and puts a floor under the whole build.
//
// The bones DRIFT back toward the player while they wait. Re-forming on the spot would drop the
// skeleton straight back into the pack that just killed it; teleporting it to the player's side
// would read as a glitch. Creeping home is legible and solves both.
const MINION_BONE_DRIFT = 62;

/**
 * Fell a minion: bones on the floor, revive clock started.
 * @param {any} m
 */
function downMinion(m) {
  // A shade does not revive — it is a borrowed body, and cut down it simply goes back. Same
  // reason its `life` timer exists: the retinue is the skeleton's, not the void's.
  if (m.type === 'shade') { m.dead = true; return; }
  m.reviving = true;
  m.hp = 0;
  m.state = 'wait';
  m.atkTimer = 0;
  m.returning = false;
  m.reviveTotal = reviveTime(m);
  m.reviveTimer = m.reviveTotal;
  // The same dry bone rattle as the summon, which is exactly right at both ends: it is one pile
  // of bones coming apart and, later, going back together.
  play('skeletonMinion');
}

/** Base revive duration for a minion, from its own skill's tuning. @param {any} m */
function reviveTime(m) {
  const T = m.skillRef && SKILLS[m.skillRef.id] && SKILLS[m.skillRef.id].tune;
  return (T && T.minionReviveTime) || 6;
}

function updateMinion(m, dt) {
  if (m.dead) return;
  // Shades expire on their own clock. Checked before everything else so a shade whose time is
  // up cannot land one last hit after the void has taken it back.
  if (m.life !== undefined) {
    m.life -= dt;
    if (m.life <= 0) {
      m.dead = true;
      spawnEffect({ kind: 'ring', x: m.x, y: m.y, radius: 34, color: '#7a56d2',
        duration: 0.35, mods: {} });
      return;
    }
  }
  if (m.reviving) { updateReviving(m, dt); return; }
  stepMinion(m, dt);
  // Pick the side/front sprite view, with the same staggered turn delay the enemies use.
  // stepMinion moves through moveToward(), which already sets dirX/dirY, so this needs no
  // extra bookkeeping — minions simply never called it while their art was side-only.
  updateFacing(m, dt);
  // Keep minions inside the arena, exactly as the player is clamped. An unbounded minion
  // wanders past the wall and drags the horde out with it, since enemies chase the nearest
  // target — which is what made the arena appear to leak.
  if (terrain) terrain.resolve(m, m.radius || MINION_RADIUS);
  const mLim = ARENA_RADIUS - (m.radius || MINION_RADIUS);
  m.x = clamp(m.x, -mLim, mLim);
  m.y = clamp(m.y, -mLim, mLim);
}

/**
 * A heap of bones counting down. The clock is DIVIDED by the live cooldown multiplier rather
 * than scaled once at death, for the same reason the strike timer reads mods every frame: haste
 * picked up mid-revive should shorten the wait it is currently sitting through, and a level-up
 * that arrives while half the retinue is down is precisely when the player wants to feel it.
 * @param {any} m
 * @param {number} dt
 */
function updateReviving(m, dt) {
  const cdMult = m.skillRef ? computeModsCached(S.player, m.skillRef).cooldownMult : 1;
  m.reviveTimer -= dt / Math.max(0.05, cdMult);
  // The timer is held in BASE seconds and drained faster or slower by the multiplier above, so
  // the ring's denominator must be the base duration too. Scaling this one by cdMult as well
  // would double-count the haste and fill the ring before the skeleton was due back.
  // Re-read rather than frozen at death, so dragging the dev slider retimes a wait in progress.
  m.reviveTotal = reviveTime(m);

  // Creep home. Slow enough to read as bones dragging themselves along, not as a body walking.
  const dx = S.player.x - m.x, dy = S.player.y - m.y;
  const d = Math.hypot(dx, dy);
  if (d > MINION_RING_RADIUS) {
    m.x += (dx / d) * MINION_BONE_DRIFT * dt;
    m.y += (dy / d) * MINION_BONE_DRIFT * dt;
  }

  if (m.reviveTimer > 0) return;
  m.reviving = false;
  // Full health at the CURRENT level, so a retinue raised at level 3 and revived at level 12 comes
  // back at level 12's toughness. maxHp is restated because levelling does not touch standing
  // minions — the revive is the one moment their statline can catch up.
  m.maxHp = minionMaxHp(m);
  m.hp = m.maxHp;
  m.state = 'wait';
  m.atkTimer = 0;
  play('skeletonMinion');
}

/** Health a minion should have at its summoner's present level. @param {any} m */
function minionMaxHp(m) {
  const s = m.skillRef;
  const T = s && SKILLS[s.id] && SKILLS[s.id].tune;
  if (!T || T.minionHp === undefined) return m.maxHp;
  return T.minionHp + s.level * (T.minionHpPerLevel || 0);
}

// Minions hunt whatever is nearest to *them*, which lets a chain of kills walk one clean off
// the screen. Past MINION_LEASH they abandon the fight and sprint back; they only re-engage
// once inside MINION_REGROUP. The gap between the two stops them flickering in and out of
// combat at the boundary.
const MINION_LEASH = 430;
const MINION_REGROUP = 190;
const MINION_RETURN_SPEED = 1.45; // hurries back rather than strolling

// ---------- Idle formation ----------
// With nothing to fight, minions used to all walk at the player and stop within 70px of them,
// which put the whole pack in one overlapping heap on top of the character — they read as a
// single smear rather than as a retinue, and they hid the player's own sprite.
//
// So an idle minion holds a SLOT on a loose ring instead. The slot comes from its position in
// the living-minion list, so the ring divides evenly however many are alive and re-divides the
// moment one dies — an id-hash would scatter them at random and let three of five sit in the
// same arc. The whole ring turns slowly so the formation reads as a group orbiting a leader
// rather than as a fixed diagram stamped on the floor.
const MINION_RING_RADIUS = 92;   // how far out the formation sits
const MINION_RING_SPREAD = 13;   // extra radius per minion, so a big pack does not crowd
const MINION_RING_SPIN = 0.25;   // radians/sec the whole formation drifts
const MINION_SLOT_SLACK = 14;    // deadband, so they settle rather than jitter on the mark

/**
 * Where this minion should stand when idle: its own slice of a ring around the player.
 * @param {any} m
 */
function minionIdleSpot(m) {
  // Reviving bodies are excluded, so the ring closes up around the ones still standing instead
  // of holding an empty slot for every heap of bones on the floor.
  const live = S.minions.filter((x) => !x.dead && !x.reviving);
  const n = Math.max(1, live.length);
  const idx = Math.max(0, live.findIndex((x) => x.id === m.id));
  const radius = MINION_RING_RADIUS + MINION_RING_SPREAD * (n - 1);
  const angle = (idx / n) * Math.PI * 2 + S.elapsed * MINION_RING_SPIN;
  return {
    x: S.player.x + Math.cos(angle) * radius,
    y: S.player.y + Math.sin(angle) * radius,
    radius: 0,
  };
}

function stepMinion(m, dt) {
  const pdx = S.player.x - m.x, pdy = S.player.y - m.y;
  const playerDist = Math.hypot(pdx, pdy);
  if (playerDist > MINION_LEASH) m.returning = true;
  else if (playerDist < MINION_REGROUP) m.returning = false;

  if (m.returning) {
    m.facingLeft = pdx < 0;
    moveToward(m, S.player, m.speed * MINION_RETURN_SPEED, dt);
    // Reset the attack cycle so he doesn't arrive mid-dash at a target he's abandoned.
    m.state = 'wait';
    m.atkTimer = 0;
    return;
  }

  // Always retarget to whatever is closest right now, so a kill mid-dash redirects him.
  const target = findNearest(m.x, m.y, 650);

  if (!target) {
    // Nothing to fight — take up formation rather than piling onto the player.
    m.state = 'wait';
    const spot = minionIdleSpot(m);
    const gap = dist(m.x, m.y, spot.x, spot.y);
    if (gap > MINION_SLOT_SLACK) {
      // Eased by distance: it ambles the last stretch instead of sprinting the final few
      // pixels and overshooting its mark, which is what makes a formation twitch.
      const ease = Math.min(1, gap / 90);
      moveToward(m, spot, m.speed * (0.35 + 0.65 * ease), dt);
    } else {
      // Standing at the post: keep looking at the player so the retinue faces its leader.
      const f = normalize(S.player.x - m.x, S.player.y - m.y);
      if (Math.abs(f.x) > 0.05) m.facingLeft = f.x < 0;
      m.dirX = f.x; m.dirY = f.y;
    }
    return;
  }

  const dx = target.x - m.x, dy = target.y - m.y;
  const d = Math.hypot(dx, dy) || 1;
  // Face the target at all times, including while backing away from it.
  m.facingLeft = dx < 0;

  // The gap between strikes tracks the player's live cooldown mods, so haste speeds the
  // skeleton up the same way it speeds up cast skills.
  const cdMult = m.skillRef ? computeModsCached(S.player, m.skillRef).cooldownMult : 1;
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

/**
 * Distance from point (px,py) to the segment (ax,ay)-(bx,by). Used for swept projectile hits.
 * Degenerates cleanly to a point test when the segment has no length, so a stationary or
 * first-frame projectile behaves exactly as it did before.
 */
function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
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
  // Hand of the Drowned: a player shot crossing the arena's edge comes back ONCE from the far
  // side, same heading. Once, or a pierce build turns the wall into a permanent ricochet.
  if (!p.enemyOwned && !p.wrapped && heldItem('drownedhand')
      && (Math.abs(p.x) > ARENA_RADIUS || Math.abs(p.y) > ARENA_RADIUS)) {
    if (Math.abs(p.x) > ARENA_RADIUS) p.x = -Math.sign(p.x) * ARENA_RADIUS;
    if (Math.abs(p.y) > ARENA_RADIUS) p.y = -Math.sign(p.y) * ARENA_RADIUS;
    p.wrapped = true;
  }
  if (p.life <= 0) {
    // A thrown flask shatters where it lands, leaving a lingering poison pool.
    if (p.isIceBomb) {
      burstIceBomb(p, true);   // ran out its arc over open dirt: this is the miss
    } else if (p.isFlask) {
      shatterFlask(p, false);
    } else if (p.isRock) {
      shatterRock(p);   // out of range: it lands and crumbles rather than blinking out
    } else if (p.aoeRadius) {
      // End of range with no target: it goes off where it ran out. Previously this drew the
      // flash but dealt no damage, which was survivable when a fireball always exploded on
      // impact — now that forking halves can end their flight in open air, a purely cosmetic
      // expiry would silently swallow most of a forked cast's damage.
      detonate(p, p.x, p.y);
    } else if (p.isFire) {
      spawnExplosion(p.x, p.y, p.aoeRadius || 46);
    }
    p.dead = true; return;
  }
  // Checked ahead of the plain enemy-projectile branch below: a rock is enemy-owned but hits
  // the horde too, and tests against its own polygon rather than a circle.
  if (p.isRock) { updateBossRock(p, dt); return; }
  if (p.enemyOwned) {
    if (dist(p.x, p.y, S.player.x, S.player.y) <= p.radius + S.player.radius) {
      const shooter = p.srcId !== undefined ? S.enemies.find((en) => en.id === p.srcId) : null;
      applyDamageToPlayer(p.damage, projectileLabel(p), 'projectile', shooter); p.dead = true;
      // A landed shot counts as touching the Shinobi: the archer that tagged him has earned
      // its way out of the automatic crits.
      if (S.player.firstStrike && p.srcId !== undefined) {
        const src = S.enemies.find((en) => en.id === p.srcId);
        if (src) src.touchedPlayer = true;
      }
    }
    return;
  }
  // A flask breaks against the first body it touches rather than sailing over it. Uses the
  // same grid query as every other projectile, but stops at the first hit instead of sweeping
  // the whole neighbourhood — a vial has nothing to pierce with.
  if (p.isFlask) {
    for (const e of enemiesInRange(p.x, p.y, p.radius + gridMaxRadius)) {
      if (e.dead) continue;
      if (dist(p.x, p.y, e.x, e.y) > p.radius + e.radius) continue;
      shatterFlask(p, true);
      p.dead = true;
      return;
    }
    return;
  }
  // A bomb bursts against the first body it reaches, the same way a flask breaks. Swept rather
  // than sampled (see the note below) because a charge covers ~5px a frame against a 6px radius,
  // so a sampled test would sail through a thin body and score the hit as a miss — which under
  // the rule above would wrongly pay out the ground patch.
  if (p.isIceBomb) {
    const bx = p.x - p.vx * dt, by = p.y - p.vy * dt;
    for (const e of enemiesInRange(p.x, p.y, p.radius + gridMaxRadius + Math.hypot(p.x - bx, p.y - by) / 2)) {
      if (e.dead || segDist(bx, by, p.x, p.y, e.x, e.y) > p.radius + e.radius) continue;
      burstIceBomb(p, false);
      p.dead = true;
      return;
    }
    return;
  }
  // The hot one: this used to test every projectile against every enemy. Narrowed to the grid
  // cells the projectile overlaps, widened by the largest live enemy radius so a big body is
  // never missed just because its centre sits outside the search circle.
  //
  // SWEPT, not sampled. The test used to ask "is the projectile overlapping a body right now",
  // once per frame, which silently misses whenever a shot travels further in one step than the
  // combined radii. That is not a rare case: Quick Shot moves 11.7px per frame at 60fps against
  // a 14px window on a Swarm Bat, so it was already marginal at full speed and missed outright
  // the moment the framerate dipped — which is exactly when the screen is busiest. Bones over
  // bats was the visible symptom; every fast projectile had it.
  //
  // Sweeping the segment from the previous position to the current one costs one extra
  // subtraction and a clamp per candidate, and makes hit detection frame-rate independent.
  const sx = p.x - p.vx * dt, sy = p.y - p.vy * dt;
  const near = enemiesInRange(p.x, p.y, p.radius + gridMaxRadius + Math.hypot(p.x - sx, p.y - sy) / 2);
  for (const e of near) {
    if (e.dead || p.hitSet.has(e.id)) continue;
    if (segDist(sx, sy, p.x, p.y, e.x, e.y) > p.radius + e.radius) continue;
    p.hitSet.add(e.id);
    if (p.damage > 0) {
      let dmg = p.damage;
      // Sharpshooter: paid at the moment of IMPACT, off the player's distance to the body hit —
      // not the distance at cast. Standing ground while the shot travels is what gets paid.
      if (S.player.sharpshooter) {
        dmg *= SHARP_MIN + (SHARP_MAX - SHARP_MIN)
          * clamp(dist(S.player.x, S.player.y, e.x, e.y) / sharpRange(), 0, 1);
      }
      damageEnemy(e, dmg, p.mods, {});
    }
    if (p.isIce) applyIceHit(e, p);
    if (p.aoeRadius) {
      // Fork FIRST, detonate last. A forking fireball splits off the body it struck and the
      // halves carry the payload onward — the blast is saved for the end of the chain, so
      // extra forks buy reach rather than extra explosions at the same spot.
      //
      // This branch used to end the projectile outright, which made Forking a dead stat on
      // every AoE skill: fireball has always passed `forks: T.forks + mods.forkBonus` and
      // could never act on it, so a fork roll on a fireball build did nothing at all.
      if (p.forks > 0) {
        forkProjectile(p, e);
      } else {
        detonate(p, e.x, e.y);   // final target: this is where it goes off
      }
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
        // Each hop carries less than the one before it, compounding down the chain.
        p.damage *= CHAIN_DAMAGE_FALLOFF;
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

/**
 * The blast at the end of an AoE projectile's life — on its final target, or wherever it ran
 * out of range. One routine for both, so the two cannot drift into dealing different damage.
 *
 * The centre enemy is NOT re-damaged here: whatever was struck already took the direct hit in
 * the collision loop, and hitSet keeps it out of the splash.
 * @param {any} p @param {number} x @param {number} y
 */
function detonate(p, x, y) {
  if (!p.aoeRadius) return;
  for (const other of enemiesInRange(x, y, p.aoeRadius)) {
    if (p.hitSet.has(other.id)) continue;
    p.hitSet.add(other.id);
    damageEnemy(other, p.damage * 0.6, p.mods, {});
  }
  if (p.isFire) spawnExplosion(x, y, p.aoeRadius);
}

// Splits a projectile in two at an impact point. Children inherit damage and visuals but get
// their own chain budget and one fewer fork, so higher fork counts branch out geometrically
// instead of running away without limit.
const FORK_SPREAD = 32 * Math.PI / 180; // how far each half veers off the parent's heading

function forkProjectile(p, hitEnemy) {
  const speed = Math.hypot(p.vx, p.vy) || 1;
  const baseAng = Math.atan2(p.vy, p.vx);
  for (const side of [-1, 1]) {
    if (S.projectiles.length >= MAX_PROJECTILES) break; // respect the global ceiling
    const ang = baseAng + side * FORK_SPREAD;
    spawnProjectile({
      ...p,
      id: S.nextId++,
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

// A vial breaking, whether against a body or on the ground.
//
// It always leaves the lingering pool — that is the skill's identity. Breaking against an
// enemy ADDITIONALLY throws out an immediate splash: a wide burst that poisons everything it
// catches once, right now. That is the whole point of an impact break — the pool alone rewards
// a miss and a direct hit identically, which is backwards.
//
// The splash applies poison but no direct damage, matching how every other poison source in
// the game works: the debuff carries the damage.
// ---------------------------------------------------------------------------------------
// Boss ranged attack: a thrown rock.
//
// Deliberately the plainest version of the idea - a grey lump on a straight line - because
// the shape and the hitbox are generated together and that is the part worth getting right
// now. Every boss shares one implementation; the per-boss flavour (what the object actually
// is) is meant to be layered on later by swapping the draw call, not the physics.

const ROCK_SPEED = 430;           // slow enough to read and dodge, fast enough to feel thrown
const ROCK_WINDUP = 0.5;          // the boss plants its feet before letting go
const ROCK_RANGE = 620;           // won't bother throwing from further out than this
const ROCK_COOLDOWN = 5.4;        // between throws, measured from the end of the last one
const ROCK_ENEMY_DMG = 30;        // what it does to whatever is standing in the way
const ROCK_SHOVE = 260;           // px/s of impulse handed to a body it ploughs through
const ROCK_SHOVE_TIME = 0.28;     // how long that impulse takes to bleed off

// ---------- Boulder flight ----------
// The rock is thrown, not fired: it carries a HEIGHT above the ground plane, arcs under gravity,
// lands, and bounces away with less of its energy each time until it has none left and breaks up.
//
// `z` is a third axis the rest of the game does not have. x/y stay the ground position — which
// is what collision, the spatial grid and the shadow all use — and z only ever offsets where the
// boulder is DRAWN. Keeping them separate is what lets a boulder pass harmlessly over a body's
// head without needing a single other system to learn about height.
const ROCK_GRAVITY = 1150;        // px/s² downward; tuned so a full-range throw hangs ~1.1s
const ROCK_LAUNCH_Z = 26;         // leaves the boss's hands at about shoulder height
const ROCK_BOUNCE = 0.46;         // fraction of vertical speed kept per bounce
const ROCK_GROUND_FRICTION = 0.68; // horizontal speed kept per bounce — it digs in as it lands
const ROCK_REST_VZ = 90;          // below this rebound speed there is no bounce left to take
const ROCK_REST_SPEED = 55;       // ...and below this it has stopped travelling, so it breaks up
const ROCK_HIT_HEIGHT = 34;       // a body is about this tall: higher than it and the rock sails over
const ROCK_MAX_BOUNCES = 4;       // a hard stop, so a shallow skip can never skitter forever

// A random lump. Vertices march around the circle in order with bounded angular jitter, so
// their angles stay strictly increasing - which is what lets the hitbox below find the right
// edge from an angle alone, with no sorting and no general point-in-polygon test.
//
// Radii are normalised to 1, so the shape is scale-free: `radius` on the projectile is the
// real size and every vertex is a fraction of it. The drawn silhouette and the collision
// boundary therefore read from the same numbers and cannot drift apart.
function makeRockShape() {
  const n = randInt(7, 11);
  const step = (Math.PI * 2) / n;
  const verts = [];
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    const a = i * step + rand(-step * 0.3, step * 0.3);
    const r = rand(0.62, 1);
    maxR = Math.max(maxR, r);
    verts.push({ a, r, x: 0, y: 0 });
  }
  // Renormalise so the widest vertex is exactly 1. Otherwise a lump that happened to roll
  // all-small radii would quietly be smaller than its stated radius, and the broad-phase
  // circle below would be loose by a different amount on every rock.
  for (const v of verts) { v.r /= maxR; v.x = Math.cos(v.a) * v.r; v.y = Math.sin(v.a) * v.r; }
  return verts;
}

// Distance from the rock's centre to its own edge along `ang` (world radians). This is the
// "matching hitbox": the same vertices that get drawn, so a spiky lump really does reach
// further on its spikes than in its notches.
//
// Exact rather than interpolated - the ray is intersected with the one edge spanning this
// angle. Costs a scan of at most n vertices and allocates nothing.
function rockEdgeRadius(p, ang) {
  const verts = p.verts;
  const n = verts.length;
  const TAU = Math.PI * 2;
  let local = (ang - p.spin) % TAU;      // the angle in the rock's own, unrotated frame
  if (local < 0) local += TAU;
  for (let i = 0; i < n; i++) {
    const A = verts[i], B = verts[(i + 1) % n];
    const a0 = A.a;
    const a1 = B.a < a0 ? B.a + TAU : B.a;   // the wrap-around edge closes the loop
    let t = local;
    if (t < a0) t += TAU;
    if (t > a1) continue;
    // Ray (cos t, sin t) from the origin, crossed with the edge A->B.
    const ex = B.x - A.x, ey = B.y - A.y;
    const den = Math.cos(t) * ey - Math.sin(t) * ex;
    if (Math.abs(den) < 1e-6) continue;
    const hit = (A.x * ey - A.y * ex) / den;
    if (hit > 0) return hit * p.radius;
  }
  return p.radius;                     // unreachable for a well-formed lump; fail large
}

// True if a circular body at (bx, by) overlaps the rock's actual silhouette.
function rockHits(p, bx, by, bodyRadius) {
  const dx = bx - p.x, dy = by - p.y;
  const d = Math.hypot(dx, dy);
  if (d > p.radius + bodyRadius) return false;   // broad phase: the circumscribed circle
  if (d <= bodyRadius) return true;              // the body swallows the rock's centre
  return d <= rockEdgeRadius(p, Math.atan2(dy, dx)) + bodyRadius;
}

// Hands a body an impulse that decays over ROCK_SHOVE_TIME rather than teleporting it. The
// rest of the game displaces enemies instantly, which is fine for a sword hit but reads as a
// glitch at this size - a boulder should visibly push things aside.
function shoveBody(e, dirX, dirY, power, time = ROCK_SHOVE_TIME) {
  const n = normalize(dirX, dirY);
  e.shoveX = n.x * power;
  e.shoveY = n.y * power;
  e.shoveT = time;
  // Remembered per body, because a sword sends things much further than a rock does and the
  // decay has to be read against the duration it was actually given.
  e.shoveMax = time;
}

// Everything a boss's sword or scythe catches that is not the player. The swing already covers
// the whole circle it damages, so it looked wrong for a crowd to stand inside the arc untouched
// while the blade passed through them — bodies go flying now, and take a little damage on the
// way out. The damage is the smaller half of this on purpose: the point is that the boss clears
// room around itself, not that it farms the horde for you.
const SLAM_MOB_SHOVE = 1250;      // px/s of impulse, ~250px of travel once it bleeds off
const SLAM_MOB_SHOVE_TIME = 0.4;
const SLAM_MOB_DAMAGE = 0.5;      // fraction of the boss's own damage

function sweepTrashMobs(boss) {
  for (const m of S.enemies) {
    if (m === boss || m.dead || m.isBoss) continue;
    const dx = m.x - boss.x, dy = m.y - boss.y;
    if (Math.hypot(dx, dy) > boss.slamRadius + m.radius) continue;
    // Outward from the boss, not from the player — this is the blade throwing them clear.
    // A body standing exactly on the boss has no direction to be thrown in, so it gets one.
    const away = (dx || dy) ? { x: dx, y: dy } : { x: Math.cos(m.wanderAngle || 0), y: Math.sin(m.wanderAngle || 0) };
    shoveBody(m, away.x, away.y, SLAM_MOB_SHOVE, SLAM_MOB_SHOVE_TIME);
    damageEnemy(m, boss.damage * SLAM_MOB_DAMAGE, { damageMult: 1, lifeLeech: 0, critChance: 0 });
  }
}

function throwBossRock(boss) {
  const n = normalize(S.player.x - boss.x, S.player.y - boss.y);
  // Sized off the boss, so a bigger boss throws a bigger rock, and clamped so the shape stays
  // legible against the horde instead of becoming a screen-filling disc.
  //
  // +50%: 0.72 -> 1.08, and the clamp bounds scale with it (22/44 -> 33/66). Scaling the factor
  // alone would have done almost nothing — every boss radius in the game lands the result on the
  // old 44 ceiling, so the clamp, not the factor, was setting the size.
  //
  // The hitbox follows for free: rockEdgeRadius measures the polygon in units of p.radius, so
  // the silhouette and what it can hit grow together and cannot drift apart.
  const radius = clamp(boss.radius * 1.08, 33, 66);
  // Aim the arc to land ON the player rather than at a fixed range: the throw is a lob, and a
  // lob that always peaks at the same distance would sail over anyone standing closer.
  // Solving 0 = z0 + vz·t − ½g·t² for vz gives the launch speed that puts the first landing
  // exactly at the target after t seconds of flight.
  const travel = clamp(dist(boss.x, boss.y, S.player.x, S.player.y), 120, ROCK_RANGE);
  const flight = travel / ROCK_SPEED;
  const vz = (0.5 * ROCK_GRAVITY * flight * flight - ROCK_LAUNCH_Z) / flight;
  spawnProjectile({
    x: boss.x + n.x * (boss.radius + radius * 0.6),
    y: boss.y + n.y * (boss.radius + radius * 0.6),
    vx: n.x * ROCK_SPEED, vy: n.y * ROCK_SPEED,
    // Height above the ground plane, and its rate of change. Only the boulder has these.
    z: ROCK_LAUNCH_Z, vz,
    bounces: 0,
    // Long enough to cover the arc plus every bounce; the resting test below is what normally
    // ends it, and this is only the backstop.
    radius, life: flight + 6,
    isRock: true, enemyOwned: true, rock: boss.rock,
    damage: boss.damage * 1.2,
    verts: makeRockShape(),
    spin: rand(0, Math.PI * 2),
    spinRate: rand(1.4, 3.4) * (Math.random() < 0.5 ? 1 : -1),
    // One hit per body: it ploughs through the horde rather than grinding the same enemy down
    // frame after frame while it passes over them.
    rockHitSet: new Set(),
  });
  shakeAmount = Math.min(16, shakeAmount + 4);
}

function updateBossRock(p, dt) {
  p.spin += p.spinRate * dt;

  // ---- gravity and the ground ----
  p.vz -= ROCK_GRAVITY * dt;
  p.z += p.vz * dt;
  if (p.z <= 0) {
    p.z = 0;
    p.bounces += 1;
    const rebound = -p.vz * ROCK_BOUNCE;
    const speed = Math.hypot(p.vx, p.vy) * ROCK_GROUND_FRICTION;
    // Out of energy: it settles where it landed and breaks apart, rather than jittering on the
    // spot with bounces too small to see.
    if (rebound < ROCK_REST_VZ || speed < ROCK_REST_SPEED || p.bounces > ROCK_MAX_BOUNCES) {
      shatterRock(p);
      shakeAmount = Math.min(16, shakeAmount + 3);
      play('enemyHit');
      p.dead = true;
      return;
    }
    p.vz = rebound;
    const k = speed / Math.max(1e-6, Math.hypot(p.vx, p.vy));
    p.vx *= k; p.vy *= k;
    // Each impact throws up dust and scrubs some spin, so the boulder visibly tires.
    p.spinRate *= 0.7;
    spawnEffect({ kind: 'rockDust', x: p.x, y: p.y, radius: p.radius * 0.7, duration: 0.35, shards: [], rock: p.rock });
    shakeAmount = Math.min(18, shakeAmount + 5);
    play('enemyHit');
    // A landing is a fresh impact: whatever it clipped on the way down can be hit again by the
    // next hop. Without this the boulder would roll through a crowd doing nothing.
    p.rockHitSet.clear();
  }

  // Airborne above head height, it passes over everything — that is the point of the arc.
  if (p.z > ROCK_HIT_HEIGHT) return;

  // Everything it ploughs through is damaged once, then shoved out of the flight path. The
  // sideways component is what makes it read as "knocked aside" rather than "carried along":
  // a body sitting dead on the centre line still gets pushed off it.
  for (const e of enemiesInRange(p.x, p.y, p.radius + gridMaxRadius)) {
    if (e.dead || e.isBoss || p.rockHitSet.has(e.id)) continue;
    if (!rockHits(p, e.x, e.y, e.radius)) continue;
    p.rockHitSet.add(e.id);
    e.hp -= ROCK_ENEMY_DMG;
    spawnDamageNumber(e.x, e.y - e.radius, ROCK_ENEMY_DMG, false, '#b9b4ab', e);
    const fwd = normalize(p.vx, p.vy);
    const side = normalize(e.x - p.x, e.y - p.y);
    shoveBody(e, fwd.x * 0.55 + side.x, fwd.y * 0.55 + side.y, ROCK_SHOVE);
    if (e.hp <= 0 && !e.dead) killEnemy(e);
  }
  if (rockHits(p, S.player.x, S.player.y, S.player.radius)) {
    applyDamageToPlayer(p.damage, `${S.boss ? enemyLabel(S.boss) : 'Boss'} — Hurled Rock`, 'projectile');
    if (S.boss) S.boss.touchedPlayer = true;   // the throw counts: First Strike mark broken
    const fwd = normalize(p.vx, p.vy);
    if (!S.player.immovable) { S.player.x += fwd.x * 26; S.player.y += fwd.y * 26; }
    shakeAmount = Math.min(22, shakeAmount + 10);
    shatterRock(p);
    p.dead = true;
  }
}

// Rock palettes, chosen by the boss that threw it. Akhmet hurls a black stone; the Skeleton
// King's stays the original grey.
const ROCK_STYLES = {
  stone: { body: '#6a6763', lit: '#8d8a85', line: '#39352f' },
  black: { body: '#242028', lit: '#3d3743', line: '#0b0a0d' },
};
const rockStyle = (name) => ROCK_STYLES[name] || ROCK_STYLES.stone;

function shatterRock(p) {
  const shards = [];
  for (let i = 0; i < 9; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(60, 210);
    shards.push({
      x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
      rot: rand(0, Math.PI * 2), spin: rand(-7, 7),
      size: rand(0.1, 0.24) * p.radius, life: rand(0.3, 0.6),
    });
  }
  spawnEffect({ kind: 'rockDust', x: p.x, y: p.y, radius: p.radius, duration: 0.6, shards, rock: p.rock });
}

function shatterFlask(p, onImpact) {
  spawnEffect({ kind: 'poisonPuddle', x: p.x, y: p.y, radius: p.puddleRadius,
    duration: p.puddleDuration, tickInterval: 0.4, poisonDps: p.poisonDps,
    poisonDur: p.poisonDur, mods: p.mods });
  if (!onImpact) return;
  const r = p.splashRadius || p.puddleRadius * 1.25;
  for (const e of enemiesInRange(p.x, p.y, r)) {
    if (e.dead || dist(p.x, p.y, e.x, e.y) > r + e.radius) continue;
    applyPoison(e, p.poisonDps, p.poisonDur, p.mods);
  }
  spawnEffect({ kind: 'poisonSplash', x: p.x, y: p.y, radius: r, duration: 0.45 });
  play('poisonFlask');
}

/**
 * An Ice Bomb going off, either against a body it struck or at the end of its lob.
 *
 * `onGround` separates the two, and it is the only thing that differs between them. A charge
 * that finds a target has already been paid for — full blast damage plus freeze buildup on
 * whatever it hit. A charge that runs out its arc over empty dirt has hit nothing, and rather
 * than being a wasted third of a salvo it converts into area denial: the rimed patch below.
 * So the patch is the MISS payoff, and putting it on direct hits too would both erase that
 * trade and stack a second chill source on a spot the freeze already covers.
 *
 * The hanging cloud is thrown either way. It is the read on where the volley landed, and
 * carries no chill of its own for the same reason.
 */
function burstIceBomb(p, onGround) {
  const r = p.blastRadius;
  for (const e of enemiesInRange(p.x, p.y, r)) {
    if (e.dead || dist(p.x, p.y, e.x, e.y) > r + e.radius) continue;
    damageEnemy(e, p.blastDamage, p.mods, { knockback: 30 });
    // Reuses the shard path, so freeze buildup, the boss exemption and the already-frozen guard
    // all behave identically to Ice Shards rather than being a second set of rules.
    applyIceHit(e, p);
  }
  spawnEffect({ kind: 'iceBurst', x: p.x, y: p.y, radius: r, duration: 0.42 });
  if (p.cloudDuration > 0) {
    spawnEffect({ kind: 'frostCloud', x: p.x, y: p.y, radius: r * 1.15, duration: p.cloudDuration });
  }
  if (onGround && p.groundDuration > 0) {
    spawnEffect({
      kind: 'frostGround', x: p.x, y: p.y, radius: p.groundRadius, color: '#8fc7e0',
      duration: p.groundDuration, tickInterval: p.groundTick, slowFactor: 0.5, slowDurationMs: 650,
      mods: p.mods,
    });
  }
  play('iceNova');
}

function updateEffect(fx, dt) {
  // Staggered placement: a delayed effect trails the player until its delay elapses,
  // then locks at the player's position (used by Flame Walk's spaced patches).
  if (fx.delay !== undefined && fx.delay > 0) {
    fx.delay -= dt;
    fx.x = S.player.x; fx.y = S.player.y;
    if (fx.delay > 0) return;
  }
  fx.t += dt;
  if (fx.follow) { fx.x = S.player.x; fx.y = S.player.y; }
  // Any effect that declares a base count re-derives it EVERY FRAME, so a Quantity tome picked
  // up mid-effect adds its blade or its mouth immediately rather than on the next cast. This
  // lived inside the ninjastars branch and so only ever served that one skill; Nullward was
  // given a baseCount and then silently never had it read.
  if (fx.baseCount !== undefined && fx.skillRef) {
    fx.count = fx.baseCount + computeModsCached(S.player, fx.skillRef).projectileBonus;
  }
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
  } else if (fx.kind === 'unearth') {
    // A grave-mound telegraph that erupts once at `eruptAt`: burst damage to a player still
    // standing on it, and a Shambler hauled up out of the dirt either way. The effect then
    // lives a little longer so the eruption has frames to be seen.
    if (!fx.erupted && fx.t >= fx.eruptAt) {
      fx.erupted = true;
      if (dist(fx.x, fx.y, S.player.x, S.player.y) <= fx.radius + S.player.radius) {
        applyDamageToPlayer(fx.damage, 'Mourngrim — Unearth', 'skill');
      }
      spawnDugUp(fx.x, fx.y);
      shakeAmount = Math.max(shakeAmount, 4);
    }
  } else if (fx.kind === 'sandCloud') {
    // Sekhra's wake. Standing in it refreshes the frost slow, quietly — the punishment for
    // holding your ground inside the storm is losing the legs to leave it.
    if (dist(fx.x, fx.y, S.player.x, S.player.y) <= fx.radius + S.player.radius) {
      afflictPlayer('frost', 0.9, true);
    }
  } else if (fx.kind === 'unmaking') {
    // Locks onto one body and eats a share of what it has LEFT, every tick. The target is
    // re-read by id each tick rather than held as a reference, so a target that dies mid-beam
    // ends the channel instead of leaving it firing at a corpse.
    const tgt = S.enemies.find((e) => e.id === fx.targetId && !e.dead);
    if (!tgt) { fx.dead = true; return; }
    fx.tx = tgt.x; fx.ty = tgt.y;
    fx.tickTimer = (fx.tickTimer === undefined ? 0 : fx.tickTimer) - dt;
    if (fx.tickTimer <= 0) {
      fx.tickTimer = fx.tickInterval;
      // Flat floor plus a share of CURRENT health. Current, not max: each tick takes a slice
      // of a smaller number than the last, so the sum converges rather than reaching zero —
      // it opens a big target up and leaves the kill to something else, which is the whole
      // reason a percent-health skill is safe to hand the player at all.
      damageEnemy(tgt, fx.damagePerTick + tgt.hp * fx.healthFrac, fx.mods, {});
    }
  } else if (fx.kind === 'saltcircle') {
    // The only outward force in the game. Everything else that moves a body moves it TOWARD
    // something — gravepull, the maw, a collapse. This shoves.
    //
    // Position is written directly rather than going through damageEnemy's `knockback`, because
    // that one is an impulse applied on a HIT and this is a continuous field that mostly does no
    // damage at all. Same idea, different clock.
    const inside = enemiesInRange(fx.x, fx.y, fx.radius);
    let held = 0;
    for (const e of inside) if (!e.dead && !e.isBoss) held++;
    if (held > 0) {
      // THE BUDGET. Force is divided by count^crowdFalloff, so one body is hurled and a wall of
      // them is merely slowed. This is what stops a 100%-uptime push from trivialising the game:
      // it degrades exactly when the game gets harder, on its own, with no separate nerf lever.
      const share = fx.force / Math.pow(held, fx.crowdFalloff);
      for (const e of inside) {
        // Bosses are never shoved, matching damageEnemy's knockback rule — a boss you could hold
        // at arm's length forever would not be a boss.
        if (e.dead || e.isBoss) continue;
        const n = normalize(e.x - fx.x, e.y - fx.y);
        // A body exactly on the centre has no direction to be pushed in; nudge it off the pole
        // rather than multiplying by a zero vector and stranding it there forever.
        const nx = (n.x === 0 && n.y === 0) ? 1 : n.x;
        e.x += nx * share * dt;
        e.y += n.y * share * dt;
      }
      // Holding the crowd back IS the charge — body-seconds, so the ring answers a mob faster
      // than it answers a straggler. This is the ward category's rule that a defensive gem must
      // convert what it absorbs into offence rather than being a quiet tax on the build.
      fx.charge = (fx.charge || 0) + held * dt;
      if (fx.charge >= fx.chargeCap) {
        fx.charge = 0;
        fx.flash = 1;
        for (const e of enemiesInRange(fx.x, fx.y, fx.burstRadius)) {
          if (e.dead) continue;
          damageEnemy(e, fx.damage, fx.mods, { knockback: fx.burstKnockback });
        }
        play('iceNova');
        shakeAmount = Math.max(shakeAmount, 3);
      }
    }
    if (fx.flash) fx.flash = Math.max(0, fx.flash - dt * 3);
  } else if (fx.kind === 'nullward') {
    // ONE effect owning N mouths, the same shape Ninja Stars uses — and for the same reason:
    // the count is recomputed live from projectileBonus (see baseCount, below), so a Quantity
    // tome picked up mid-ward adds a mouth immediately instead of on the next cast.
    //
    // The mouths share ONE charge pool. More mouths therefore fill the ward faster, which is
    // what +quantity should mean for a defensive skill, and the ward NEVER decays: it holds
    // whatever it has caught until it is full. It used to expire on a timer, which meant most
    // wards died holding two or three shots and the collapse was something you rarely saw.
    const t = performance.now() / 1000;
    const n = Math.max(1, Math.round(fx.count || 1));
    fx.mouths = fx.mouths || [];
    fx.mouths.length = n;
    for (let m = 0; m < n; m++) {
      const ang = fx.phase + t * 2.2 + (m / n) * Math.PI * 2;
      fx.mouths[m] = { x: fx.x + Math.cos(ang) * fx.orbitRadius, y: fx.y + Math.sin(ang) * fx.orbitRadius };
    }
    for (const p of S.projectiles) {
      if (p.dead || !p.enemyOwned || p.isRock) continue;   // a boulder is not a bullet
      // Pulled toward the NEAREST mouth, so a ring of them covers the approach rather than
      // fighting each other over the same shot.
      let mx = 0, my = 0, pd = Infinity;
      for (const mo of fx.mouths) {
        const d = dist(p.x, p.y, mo.x, mo.y);
        if (d < pd) { pd = d; mx = mo.x; my = mo.y; }
      }
      // GRAVITY, not a hitbox. Waiting for a shot to fly into a small orbiting circle meant
      // the ward only ever caught what was already going to miss you — it read as decoration.
      // Inside the pull radius the ward BENDS incoming fire toward itself, hard enough near the
      // centre to be inescapable, so standing behind it genuinely shelters you. The turn is
      // applied to the velocity rather than to the position, so a caught shot visibly curves
      // in instead of teleporting.
      if (pd < fx.pullRadius && pd > 0.001) {
        const grip = 1 - pd / fx.pullRadius;              // 0 at the rim, 1 at the mouth
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const ux = (mx - p.x) / pd, uy = (my - p.y) / pd;
        const bend = NULLWARD_PULL * grip * grip * dt;    // quadratic: gentle far, brutal close
        p.vx += ux * bend; p.vy += uy * bend;
        // Renormalise so the ward steers shots without also accelerating them into the player
        // if it somehow fails to swallow one.
        const ns = Math.hypot(p.vx, p.vy) || 1;
        p.vx = (p.vx / ns) * sp; p.vy = (p.vy / ns) * sp;
      }
      if (pd > fx.eatRadius + p.radius) continue;
      p.dead = true;
      fx.eaten++;
      spawnEffect({ kind: 'ring', x: mx, y: my, radius: 22, color: '#8a6ae8',
        duration: 0.22, mods: {} });
    }
    if (fx.eaten >= fx.capacity) {
      // Full: collapse on the nearest body, scaled by how much it swallowed.
      let best = null, bd = 520;
      for (const e of S.enemies) {
        if (e.dead) continue;
        const d = dist(e.x, e.y, fx.x, fx.y);
        if (d < bd) { bd = d; best = e; }
      }
      const at = best || { x: fx.x, y: fx.y };
      spawnEffect({ kind: 'singularity', x: at.x, y: at.y, radius: fx.collapseRadius,
        duration: 0.7, damage: fx.damage, seed: Math.random() * 10, mods: fx.mods });
      play('iceNova');
      fx.dead = true;
    }
  } else if (fx.kind === 'curseRing') {
    // Expands from the caster with two gaps sweeping round. One sentence per casting: the ring
    // hits at most once, so being caught is a mistake, not a shredder.
    fx.gapA += 0.9 * dt;
    fx.ringR = 46 + 250 * fx.t;
    if (!fx.hitDone) {
      const d = dist(fx.x, fx.y, S.player.x, S.player.y);
      if (Math.abs(d - fx.ringR) < 15 + S.player.radius) {
        const pa = Math.atan2(S.player.y - fx.y, S.player.x - fx.x);
        // Angular distance to the nearest gap centre; the pair sit opposite each other, so the
        // whole test folds into half a turn.
        const g = Math.abs(((((pa - fx.gapA) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2);
        const inGap = (Math.PI / 2 - g) < CURSE_GAP_HALF;
        if (!inGap) {
          fx.hitDone = true;
          applyDamageToPlayer(fx.damage, 'Akhmet — Judgement Ring', 'skill');
          afflictPlayer('blight', 4);
        }
      }
    }
  } else if (fx.kind === 'hollowRift') {
    // Pulls the PLAYER — the mirror of the singularity, which only ever pulls the horde.
    const d = dist(fx.x, fx.y, S.player.x, S.player.y);
    if (d > 1 && d < fx.radius && !S.player.immovable) {
      const grip = (1 - d / fx.radius);
      let force;
      if (fx.riftborn) {
        // An afflicted's death-rift DRAGS, never traps: the pull is a fraction of the player's
        // OWN speed (riftPullPct at the core, weaker at the rim), so walking out is always
        // possible and the rift taxes the walk instead of deciding it. Nullward's projectile
        // drag is the reference feel — an influence you fight, not a verdict. Relative to the
        // player's speed on purpose: a flat px/s number is a wall to a slow class and nothing
        // to a fast one, and this threat should read the same for everybody.
        const speedNow = S.player.baseSpeed * (S.player.speedMult || 1);
        force = speedNow * (VOID_TUNE.riftPullPct / 100) * (0.35 + 0.65 * grip);
      } else {
        // The Hollow Sovereign's Maw keeps its authored grip — a boss set piece is ALLOWED to
        // catch you; escapable at a walk from the edge, barely at a sprint from the middle.
        force = 150 + 130 * grip;
      }
      S.player.x += ((fx.x - S.player.x) / d) * force * dt;
      S.player.y += ((fx.y - S.player.y) / d) * force * dt;
    }
    if (!fx.burst && fx.t >= fx.duration - 0.05) {
      fx.burst = true;
      if (d <= fx.radius * 0.5) applyDamageToPlayer(fx.damage, fx.riftborn ? 'Riftborn — Collapse' : 'The Hollow Sovereign — Maw', 'skill');
      shakeAmount = Math.max(shakeAmount, 7);
      play('bossSpawn');
    }
  } else if (fx.kind === 'hellhook') {
    // The hook flies from where it was thrown toward the aim point, and connects if it passes
    // over the player. On a hit: damage, the tether status, and one hard yank toward Karguth —
    // the yank is the skill, the tether is the aftermath.
    const d = Math.max(1, dist(fx.x, fx.y, fx.tx, fx.ty));
    const ux = (fx.tx - fx.x) / d, uy = (fx.ty - fx.y) / d;
    const travel = 950 * fx.t;
    fx.hx = fx.x + ux * travel; fx.hy = fx.y + uy * travel;
    if (!fx.hit && dist(fx.hx, fx.hy, S.player.x, S.player.y) <= 22 + S.player.radius) {
      fx.hit = true;
      applyDamageToPlayer(fx.damage, 'Karguth — Hellhook', 'skill');
      afflictPlayer('tether', 2.5);
      // Yank toward the thrower's CURRENT position — he may have walked since the throw. The
      // immovable Warrior takes the hit and simply stands there holding the chain taut.
      if (!S.player.immovable) {
        const src = S.enemies.find((en) => en.id === fx.srcId && !en.dead);
        const ax = src ? src.x : fx.x, ay = src ? src.y : fx.y;
        const pd = Math.max(1, dist(S.player.x, S.player.y, ax, ay));
        const pull = Math.min(150, pd - 40);   // never yanked INTO him, only to arm's reach
        S.player.x += ((ax - S.player.x) / pd) * pull;
        S.player.y += ((ay - S.player.y) / pd) * pull;
      }
      shakeAmount = Math.max(shakeAmount, 6);
      fx.duration = fx.t + 0.15;             // the chain goes slack almost at once
    }
    if (travel > 680) fx.duration = Math.min(fx.duration, fx.t); // flew past: done
  } else if (fx.kind === 'singularity') {
    // Hauls every frame it is alive, then implodes once. The pull rises toward the centre so the
    // edge of the field is a suggestion and the middle is inescapable, which is what makes it
    // read as gravity rather than as a uniform shove.
    //
    // A collapse with a velocity DRIFTS — that is Wandering Maw, and it is the same effect
    // rather than a second one: everything the hole has caught keeps being hauled toward its
    // new position each frame, so the maw tows its catch across the field and implodes on the
    // whole crowd wherever it ends up. Clamped to the arena so it never wanders out of play.
    if (fx.vx || fx.vy) {
      fx.x += fx.vx * dt; fx.y += fx.vy * dt;
      const lim = ARENA_RADIUS - 20;
      fx.x = clamp(fx.x, -lim, lim); fx.y = clamp(fx.y, -lim, lim);
    }
    const p01 = clamp(fx.t / fx.duration, 0, 1);
    // Tidebreaker inverts the whole effect: the same field, pushing out. The Long Dark's third
    // copy multiplies the grip either way. Both are read per frame so a relic found mid-collapse
    // takes hold immediately rather than on the next one.
    const tide = relicAt('tidebreaker');
    const dir = tide ? -1 : 1;
    const force = VOID_PULL * (tide ? RELIC_TUNE.tideForce : 1)
      * (relicAt('thelongdark') >= 3 ? RELIC_TUNE.darkPull : 1);
    for (const e of enemiesInRange(fx.x, fx.y, fx.radius)) {
      if (e.dead) continue;
      const d = dist(fx.x, fx.y, e.x, e.y);
      if (d < 1 || d > fx.radius) continue;
      const grip = (1 - d / fx.radius) * (e.isBoss ? 0.12 : 1);
      const step = Math.min(d, force * grip * dt) * dir;
      e.x += ((fx.x - e.x) / d) * step;
      e.y += ((fx.y - e.y) / d) * step;
      // Hauled, but never through the wall: the pull writes positions directly, bypassing the
      // movement clamp, and a Tidebreaker push at the boundary was throwing bodies out of the
      // arena where nothing could reach them.
      const eLim = ARENA_RADIUS - (e.radius || 0);
      e.x = clamp(e.x, -eLim, eLim); e.y = clamp(e.y, -eLim, eLim);
      // Tier 2 staggers what it throws: an interrupted attack is the defensive half of a relic
      // that otherwise scatters your own damage.
      if (tide >= 2) e.attackStunUntil = performance.now() + RELIC_TUNE.tideStagger * 1000;
    }
    if (!fx.imploded && p01 >= 1) {
      fx.imploded = true;
      // Tidebreaker has thrown everything OUTWARD by now, so an implosion confined to the core
      // would hit nobody — it lands across the whole field instead, which is the trade for
      // losing the clumping.
      const hitR = tide ? fx.radius : fx.radius * 0.55;
      for (const e of enemiesInRange(fx.x, fx.y, hitR)) {
        if (e.dead) continue;
        damageEnemy(e, fx.damage, fx.mods, { collapse: true });
        if (tide >= 3 && !e.dead) damageEnemy(e, fx.damage, fx.mods, { collapse: true });
      }
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
  } else if (fx.kind === 'dashStreak') {
    // Ground-level only; nothing to update beyond its own lifetime.
  } else if (fx.kind === 'flamethrower') {
    // A sustained cone of fire in the player's aim direction; tick damage + burn to foes in it.
    // Sweeps live with the player's aim. With no aim input the cone would simply point the way
    // you are running, which for a sustained beam means spraying at empty floor while something
    // eats you from the side — so it finds the nearest target instead. Recomputed every tick, so
    // it tracks a moving enemy and hands control straight back the moment you touch the stick
    // or mouse.
    // On a pad the facing is already pointed at the nearest enemy, so this changes nothing
    // there. It is for the keyboard player who has not moved the mouse: a sustained beam that
    // sprays wherever they last walked is the one case where following facing is clearly wrong.
    // Only within reach — locking onto something the flame cannot touch would point the cone
    // away from whatever is actually on top of you.
    let aim = S.player.facing;
    if (!aimInputActive) {
      const near = nearestEnemyTo(S.player, fx.range * 1.2);
      if (near) aim = normalize(near.x - S.player.x, near.y - S.player.y);
    }
    fx.dir = Math.atan2(aim.y, aim.x);
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
      for (const e of S.enemies) {
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
    const primaries = nearestN(S.player.x, S.player.y, fx.range, fx.maxTargets);
    fx.targets = primaries.map((e) => ({ x: e.x, y: e.y, id: e.id }));
    // Each tether can run several independent chains outward — one plus however many forks.
    // links[i] is therefore a list of branches, each an array of points walking away from
    // that primary. `claimed` is shared across all of them so no foe is ever struck twice
    // by the same cast.
    fx.tickTimer = (fx.tickTimer === undefined ? initialTickPhase(fx) : fx.tickTimer) - dt;
    const retarget = fx.tickTimer <= 0 || !fx.linkRefs;
    // TOPOLOGY ON TICK, POSITIONS EVERY FRAME.
    //
    // This block used to rebuild the whole chain every frame, and each link searched by scanning
    // the ENTIRE enemy list: primaries x branches x chain full passes, so five tethers forking
    // three ways over a three-deep chain was 45 linear scans per field per frame. Against the
    // ~500 enemies of a deep endless wave that is over 20,000 distance checks a frame from one
    // effect — which is where the profiler's ~12ms in uEffects was going.
    //
    // Two fixes. Who is chained to whom only changes when the arc re-fires, so it is now decided
    // at TICK rate rather than frame rate; and the search asks the spatial grid for candidates
    // in range instead of walking every enemy alive. The arcs still track their targets smoothly
    // because the drawn positions are refreshed from the held references each frame.
    if (retarget) {
      fx.linkRefs = [];
      const branches = 1 + (fx.fork || 0);
      if (fx.chain > 0) {
        const claimed = new Set(primaries.map((e) => e.id));
        for (const primary of primaries) {
          const paths = [];
          for (let b = 0; b < branches; b++) {
            let prev = primary; const pts = [];
            for (let c = 0; c < fx.chain; c++) {
              let nn = null, nb = Infinity;
              for (const e of enemiesInRange(prev.x, prev.y, 210)) {
                if (e.dead || claimed.has(e.id)) continue;
                const d = dist(prev.x, prev.y, e.x, e.y);
                if (d <= 210 && d < nb) { nb = d; nn = e; } // x1.5 with the AoE pass
              }
              if (!nn) break;
              claimed.add(nn.id); pts.push(nn); prev = nn;   // the enemy itself, not a snapshot
            }
            if (pts.length) paths.push(pts);
          }
          fx.linkRefs.push(paths);
        }
      }
    }
    // Drawn points, refreshed from the live references. Dead links drop out here rather than
    // forcing a rebuild, so a chain frays as its victims die instead of snapping to new ones.
    fx.links = fx.linkRefs.map((paths) => paths
      .map((pts) => pts.filter((e) => !e.dead).map((e) => ({ x: e.x, y: e.y, id: e.id })))
      .filter((pts) => pts.length));
    if (fx.tickTimer <= 0) {
      for (const e of primaries) damageEnemy(e, fx.damagePerTick, fx.mods, {});
      // Straight off the references — this used to be an S.enemies.find() by id per chained
      // point, which is another full scan each, on top of the rebuild above.
      for (const paths of fx.linkRefs) for (const pts of paths) for (const e of pts) {
        if (!e.dead) damageEnemy(e, fx.damagePerTick * 0.7, fx.mods, {});
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
    if (!target || target.dead || dist(S.player.x, S.player.y, target.x, target.y) > fx.range) {
      target = findNearest(S.player.x, S.player.y, fx.range);
      fx.target = target;
      if (target) fx.targetId = target.id;
    }
    if (!target) { fx.dead = true; return; }
    fx.tx = target.x; fx.ty = target.y;
    fx.tickTimer = (fx.tickTimer === undefined ? initialTickPhase(fx) : fx.tickTimer) - dt;
    if (fx.tickTimer <= 0) {
      const halfW = fx.width * 0.5;
      for (const e of S.enemies) {
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
  } else if (fx.kind === 'rockDust') {
    for (const sh of fx.shards) {
      sh.vy += 520 * dt;          // heavier than ice: stone chips drop fast
      sh.x += sh.vx * dt; sh.y += sh.vy * dt;
      sh.rot += sh.spin * dt;
      sh.life -= dt;
    }
  } else if (fx.kind === 'iceShatter') {
    for (const s of fx.shards) {
      s.vy += 430 * dt;             // gravity on the flung shards
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.rot += s.spin * dt;
      s.life -= dt;
    }
  }
  // A ward holds until it is FULL — see the nullward branch. Everything else expires on its
  // own clock; opting out here is what stops a half-charged ward from being wasted.
  if (fx.kind !== 'nullward' && fx.t >= fx.duration) fx.dead = true;
}

function updatePickup(pk, dt) {
  // Straight off the global rather than a copy stamped onto the player at spawn. Keeping a
  // per-player duplicate would mean the slider did nothing until the next run, and would be a
  // second place the same number lives.
  const pr = PLAYER_GLOBALS.pickupRadius * S.player.pickupRadiusMult;
  const d = dist(pk.x, pk.y, S.player.x, S.player.y);
  // Locked chests are heavy — they don't get vacuumed in; you walk onto them.
  if (d < pr && pk.kind !== 'chest') {
    const n = normalize(S.player.x - pk.x, S.player.y - pk.y);
    const pull = 500 + (1 - Math.min(1, d / pr)) * 900;
    pk.x += n.x * pull * dt; pk.y += n.y * pull * dt;
  } else if (pk.kind === 'gold' && heldItem('tithebell')) {
    // The Tithe Bell: gold answers from ANYWHERE, flying fast enough to feel summoned. The
    // bell's quarter is taken at collection, not here.
    const n = normalize(S.player.x - pk.x, S.player.y - pk.y);
    pk.x += n.x * 460 * dt; pk.y += n.y * 460 * dt;
  } else if (pk.kind === 'xp' && heldItem('gravekeeper')) {
    // Gravekeeper's Ledger: experience is never lost to distance — it crawls, so a far corner's
    // orbs arrive as a slow procession rather than teleporting the reward.
    const n = normalize(S.player.x - pk.x, S.player.y - pk.y);
    pk.x += n.x * 55 * dt; pk.y += n.y * 55 * dt;
  }
  if (d < S.player.radius + pk.radius) {
    if (pk.kind === 'chest') {
      // Opens only if a key is available; otherwise the chest stays put until you have one.
      if (S.keyCount > 0) {
        S.keyCount--;
        // A MIMIC was never a chest. It bites the hand, then fights — and its death drops the
        // real thing, doubled. The key is still spent: you committed it to find out.
        if (pk.mimic) { springMimic(pk); return; }
        // A GAMBIT chest does not pay out on opening. It arms a siege where you stand, and the
        // hoard is only yours if you are still alive when the clock runs out. That is the loop
        // chests were missing: the reward is not a table roll, it is a decision about whether
        // you are strong enough RIGHT NOW.
        if (pk.gambit) { startGambit(pk); return; }
        pk.dead = true;
        play('jackpot');
        spawnChestBurst(pk.x, pk.y);
        const rw = pk.reward;
        // A relic supersedes whatever else the chest was holding. Rolled AT OPEN rather than at
        // drop, so the wave you open it on is the wave that decides — and so a chest carried
        // across a wave boundary is worth a little more, which is a nice thing to learn.
        const relicId = Math.random() < relicDropChance(relicWave())
          ? rollRelic(S.player, relicWave()) : null;
        if (relicId) {
          const tier = grantRelic(relicId);
          if (tier) {
            const def = RELICS[relicId];
            showHeadline(`Relic — {${def.name}${tier > 1 ? ` ${'I'.repeat(tier)}` : ''}}`,
              relicDesc(S.player, relicId));
            play('jackpot');
            // A first copy of Second Silence should be usable in the wave you found it.
            if (relicId === 'secondsilence' && !S.player.silenceLeft) S.player.silenceLeft = 1;
          }
        } else if (rw.special === 'skillUnlock') {
          S.player.skillCap = (S.player.skillCap || SKILL_SLOTS_BASE) + 1; // stacks with each legendary
          S.pendingLevelUps++;                            // free level-up, auto-shown next update
          showHeadline(`{${rw.tierName}}`, 'Free level-up · {+1} skill slot');
        } else if (rw.special === 'gold') {
          // Stat affixes are off (see STAT_ITEMS_ENABLED) — the chest pays a hoard instead,
          // scaled by its tier, so a Unique Cache is still worth crossing the arena for while
          // the designed item set is built to fill this slot.
          addGold(heldItem('tithebell') ? Math.round(rw.gold * 0.75) : rw.gold);
          showHeadline(`${rw.tierName} — {+${rw.gold}} gold`);
        } else {
          applyItem(S.player, rw.item);
          showHeadline(`${rw.tierName} — {${rw.item.name}}`,
            rw.item.affixes.map((a) => a.label).join(' • '));
        }
      }
      return;
    }
    pk.dead = true;
    if (pk.kind === 'xp') { play('xpPickup', pk.xp); gainXp(pk.xp); }
    else if (pk.kind === 'gold') {
      play('goldPickup');
      // The Tithe Bell's cut: it flew here on its own, and the bell keeps a quarter.
      addGold(heldItem('tithebell') ? Math.max(1, Math.round(pk.gold * 0.75)) : pk.gold);
    }
    else if (pk.kind === 'health') { play('heal');
      // Blight makes the potion fizzle rather than vanish silently - the toast is the tell.
      if (afflicted('blight')) showHeadline('{Blighted}', 'Your wounds refuse to close.');
      else S.player.hp = Math.min(S.player.maxHp, S.player.hp + Math.round(S.player.maxHp * pk.heal)); }
    else if (pk.kind === 'key') { S.keyCount++; play('keyPickup'); showHeadline('{Silver Key}'); }
  }
}

function gainXp(amount) {
  // The global dial multiplies the player's own XP bonus rather than replacing it, and is read
  // HERE rather than folded in at spawn so moving the slider takes effect on the next orb.
  S.player.xp += amount * (S.player.xpGainMult || 1) * PLAYER_GLOBALS.xpMult;
  let leveled = false;
  while (S.player.xp >= S.player.xpToNext) {
    S.player.xp -= S.player.xpToNext;
    S.player.level++;
    S.player.xpToNext = xpForLevel(S.player.level);
    S.pendingLevelUps++;
    leveled = true;
  }
  if (leveled) play('levelUp');
}

// How deep this run is, 0..1 — drives which upgrade tiers are available. Takes the better
// of elapsed time and stage reached, so rushing ahead unlocks the richer tiers as readily as
// grinding does, and endless play sits at full unlock.
function upgradeProgress() {
  if (S.beatFinalBoss) return 1;
  const byTime = clamp(S.elapsed / 540, 0, 1);                                  // ~9 min to full
  const byStage = clamp(S.currentStage / Math.max(1, STAGES.length - 1), 0, 1);
  return Math.max(byTime, byStage * 0.85);
}

function generateCards() {
  const pool = [];
  const known = S.player.activeSkills.map((s) => s.id);
  if (known.length < (S.player.skillCap || SKILL_SLOTS_BASE)) {
    for (const id of SKILL_ORDER) {
      if (known.includes(id)) continue;
      const def = SKILLS[id];
      if (def.minStage !== undefined && S.currentStage < def.minStage) continue; // stage-gated skills
      // The void line waits for the void. Before the tear opens these powers do not exist in
      // this run, and a card offering one would contradict the introduction event outright.
      // Owned void skills are unaffected (a void class's starting gem keeps levelling — this
      // loop only builds NEW offers), and the sandbox skips the gate because a test rig that
      // hides a third of the pool behind an 18-second cutscene is a worse rig.
      if (def.voidLine && !S.voidIntroduced && !sandboxMode) continue;
      pool.push({ type: 'skill-new', id, weight: def.rarity !== undefined ? def.rarity : 3 });
    }
  }
  // Mobility swaps: any dash-slot occupant the player is NOT using can be offered, at a low
  // weight — the slot changing hands should be an event a run sees once or twice, not a card
  // that crowds the build decisions every level. Taking one replaces the button outright.
  for (const id of MOBILITY_ORDER) {
    if (id === S.player.mobility.id || id === 'dodgeroll') continue; // the roll is the floor, never re-offered
    if (SKILLS[id].voidLine && !S.voidIntroduced && !sandboxMode) continue; // voidstep waits with its line
    pool.push({ type: 'mobility-swap', id, weight: 0.7 });
  }
  for (const s of S.player.activeSkills) {
    // No level ceiling. A gem you have committed to keeps being worth picking for the whole
    // run, rather than going dead at 5 and quietly shrinking the card pool every time one
    // tops out — which is what used to push a long run into offering nothing but tomes.
    // Each offered level-up rolls its own rarity, biased by the player's Item Rarity stat,
    // then rolls which of THIS skill's parameters the upgrade improves.
    const tier = rollUpgradeTier(S.player.rarityMult || 1, upgradeProgress());
    const up = rollSkillUpgrade(tier, SKILLS[s.id], skillInfusions(s));
    pool.push({ type: 'skill-level', id: s.id, weight: 2.2, tier, up, infusion: up.infusion });
  }
  // Tomes fill a limited shelf. Once it is full, only the tomes already carried are offered —
  // deepening what you chose rather than adding to it, which is where the sacrifice bites.
  const tomesHeld = SUPPORT_ORDER.filter((id) => (S.player.supports[id] || 0) > 0).length;
  const shelfFull = tomesHeld >= (S.player.supportCap || SUPPORT_SLOTS_BASE);
  for (const id of SUPPORT_ORDER) {
    const lvl = S.player.supports[id] || 0;
    if (lvl === 0 && shelfFull) continue;
    // The Hollowed's wounds never close — offering him a regen tome would be a card that does
    // nothing, which is worse than one card fewer.
    if (id === 'hpregen' && S.player.noRegen) continue;
    // A tome whose effect is capped stops being offered at that cap — otherwise it keeps
    // taking a card slot to sell a level the clamp eats. Derived from the curve, so it follows
    // the dials instead of going stale (see tomeMaxLevel).
    const tomeMax = tomeMaxLevel(id);
    if (tomeMax !== null && lvl >= tomeMax) continue;
    const tier = rollUpgradeTier(S.player.rarityMult || 1, upgradeProgress());
    let levels = rollSupportLevels(tier);
    // A counting tome sits on the same integer for a stretch of its curve, so the rolled level
    // count can buy nothing at all — which is how a card came to promise "+1 projectile" and
    // hand over none. Extend the roll until the count genuinely moves. The tier still decides
    // how GENEROUS the card is; this only stops it being empty.
    if (COUNTING_TOMES.has(id)) levels = Math.max(levels, levelsToNextCount(id, lvl));
    pool.push({ type: 'support', id, weight: lvl === 0 ? 2 : 1, tier, levels });
  }
  // Stat nodes are deliberately NOT offered here any more. A level-up is a build decision —
  // a new skill, a deeper one, or a tome — and a flat "+8 Max Life" card competing for one of
  // three slots mostly served to crowd out the choice that mattered. Raw stats come from the
  // shop and from chest affixes instead, where they are a reward rather than a turn skipped.
  // STAT_NODES itself stays: the chest affix roller still draws from it.

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
  if (card.type === 'mobility-swap') {
    const def = SKILLS[card.id];
    const cur = SKILLS[S.player.mobility.id];
    return { ...card, title: def.name, subtitle: 'MOBILITY — REPLACES YOUR DODGE',
      desc: `${def.desc} Takes the dodge button from ${cur.name}.`, color: def.color };
  }
  if (card.type === 'skill-level') {
    const s = S.player.activeSkills.find((x) => x.id === card.id);
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
    const lvl = S.player.supports[card.id] || 0;
    const n = card.levels || 1;
    const sub = t ? `${t.name.toUpperCase()} TOME` : 'TOME';
    return {
      ...card, title: n > 1 ? `${def.name} +${n}` : def.name,
      subtitle: `${sub} · Lv ${lvl} → ${lvl + n}`,
      // What the card BUYS. For a proportional tome that is the new total; for a counting one it
      // is the gain, because a total that has not moved reads exactly like one that has.
      //
      // A capped tome says so the FIRST time it is offered, and only then. Whether a tome runs
      // out is build-planning information — it decides whether the shelf slot is a long-term
      // investment or a sprint to a ceiling — and the one moment it changes a decision is when
      // you are choosing to pick it up at all. Repeating it on every subsequent level would just
      // be noise on a card whose job is to show what this pick buys.
      desc: tomeCardDesc(card.id, lvl, lvl + n)
        + (lvl === 0 && tomeMaxLevel(card.id) !== null ? ` · Max level ${tomeMaxLevel(card.id)}` : ''),
      color: t ? t.color : def.color,
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
    if (S.player.activeSkills.some((x) => x.id === card.id)) return;
    if (S.player.activeSkills.length >= (S.player.skillCap || SKILL_SLOTS_BASE)) return;
    S.player.activeSkills.push({ id: card.id, level: 1, cd: 0 });
  }
  else if (card.type === 'mobility-swap') {
    S.player.mobility = { id: card.id, level: 1 };
    // The new occupant's charge pool starts full — a swap should feel like an upgrade landing,
    // not a button going dark while the old cooldown drains into the new clock.
    S.player.dashCharges = mobilityTune().charges;
    S.player.dashCd = 0;
  }
  else if (card.type === 'skill-level') {
    const s = S.player.activeSkills.find((x) => x.id === card.id);
    if (!s) return;
    s.level++;
    if (card.up) {
      s.bonus = s.bonus || {};
      for (const r of card.up.rolls) {
        const k = SKILL_ATTRS[r.attr].key;
        s.bonus[k] = (s.bonus[k] || 0) + r.value;
      }
      if (card.up.proj) s.bonus.projectileBonus = (s.bonus.projectileBonus || 0) + card.up.proj;
      if (card.up.infusion) {
        s.infusions = skillInfusions(s);
        if (!s.infusions.includes(card.up.infusion)) s.infusions.push(card.up.infusion);
        s.infusion = s.infusions[0];   // kept in step for the art and for older readers
      }
    }
  }
  else if (card.type === 'support') {
    // The Long Road: the extra slot was paid for with pace — multi-level cards grant a quarter
    // fewer levels, floored at one so a card can never buy nothing.
    let lv = card.levels || 1;
    if (heldItem('longroad')) lv = Math.max(1, Math.floor(lv * 0.75));
    S.player.supports[card.id] = (S.player.supports[card.id] || 0) + lv;
  }
  else {
    const node = STAT_NODES.find((n) => n.id === card.id);
    node.apply(S.player, card.value !== undefined ? card.value : node.base);
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
      S.pendingLevelUps = Math.max(0, S.pendingLevelUps - 1);
      if (S.pendingLevelUps > 0) showLevelUpStep();
      else { ui.hideLevelUp(); S.state = 'PLAYING'; }
    }, {
      available: getSettings().infiniteRerolls || getUpgradeLevel('reroll') > 0,
      left: getSettings().infiniteRerolls ? Infinity : S.rerollsLeft,
      onReroll: () => {
        if (getSettings().infiniteRerolls) { play('uiClick'); render(); }        // dev cheat: free
        else if (S.rerollsLeft > 0) { S.rerollsLeft--; play('uiClick'); render(); }
      },
    });
  };
  render();
}

function triggerGameOver() {
  S.state = 'GAMEOVER';
  play('playerDeath');
  // Death costs no gold. This used to claw back everything gathered since the last boss
  // checkpoint, which meant a long run that ended one hit short of a boss paid out nothing.
  playMusic('mainMenu');
  // Lifetime death tally shown on the main menu. Counted even when the run is flagged a
  // victory — beating the final boss flips the run to endless, so reaching this function
  // still means the player died. Sandbox is excluded for the same reason it grants no XP or
  // gold: it is a test bench, and dying on it is not part of your record.
  // Sandbox is excluded from BOTH the death tally and the leaderboard, for the same reason it
  // grants no XP or gold: it is a test bench with hand-placed enemies, god mode and arbitrary
  // stage switching, so its numbers are meaningless as a record and were polluting the board
  // with impossible entries (stage 3 at 3.4s, 78 kills in under 4 seconds).
  if (!sandboxMode) {
    recordDeath();
    // Bank the run's kills now rather than waiting on the flush timer — this is the moment the
    // player is most likely to close the game, and a run's whole tally is worth more than the
    // couple of seconds of writes the timer exists to avoid.
    flushKills();
    // A run counts as a victory if the final boss was ever felled, even though play continued.
    recordRun({ time: S.elapsed, kills: S.kills, level: S.player.level, className: S.player.className, classId: S.player.classId, victory: S.beatFinalBoss, stage: S.currentStage + 1, endlessWave: S.endlessWave || 0 });
  }
  ui.showEndScreen({ victory: S.beatFinalBoss, time: S.elapsed, level: S.player.level,
    kills: S.kills, stage: S.currentStage + 1,
    wave: S.beatFinalBoss ? S.endlessWave : 0,
    // What actually finished the run. Passed whole rather than pre-formatted so the screen can
    // decide how to phrase a burn tick versus a boss slam.
    lastHit: S.lastHit || null }, startClassSelect, showMainMenu);
}
// The final boss falling flips the run into endless survival rather than ending it: the run
// is flagged a victory (for the leaderboard mark) and play continues until you die, so the
// recorded time becomes an honest "how long could you last" number.
function onBossDefeated() {
  play('victory');
  if (!S.beatFinalBoss) {
    S.beatFinalBoss = true;
    ui.showStageCard('The Sovereign Falls', 'Endless — survive as long as you can.');
  } else {
    ui.showStageCard(`Wave ${S.endlessWave} Survived`, 'The horde does not relent.');
  }
  S.endlessWave++;
  // Second Silence recharges per wave, which is what stops it being a one-off and makes the
  // wave boundary a beat the player feels.
  S.player.silenceLeft = relicAt('secondsilence') >= 2 ? 2 : (relicAt('secondsilence') ? 1 : 0);
  // Every endless boss moves the ground somewhere else. Purely cosmetic — the stage's stats,
  // walls and lighting stay put — but it stops an endless run from being one unchanging room.
  startBackdropShift();
  // Start the next boss cycle in place — same stage, harder everything.
  S.stageElapsed = 0; S.stageKills = 0; S.spawnTimer = 0; S.bossSpawned = false; S.boss = null;
}

// Everything in the game, deduped, in roster order. Endless draws from this instead of one
// stage's list: past the final boss the run is no longer "in" a stage in any meaningful sense,
// and restricting the horde to the Underworld's twenty-odd types made the late game read as the
// same fight repeating. Built once — the orders are module constants and never change.
const ENDLESS_POOL = ENEMY_ORDER.concat(DESERT_ENEMY_ORDER, UNDERWORLD_ENEMY_ORDER)
  .filter((id, i, a) => a.indexOf(id) === i);

function trySpawnEnemy() {
  // Endless ignores the tier gate as well as the stage list. Tiers ramp a stage up over its own
  // clock, and that clock restarts every endless wave — so gating would hide the heavyweights at
  // the start of each cycle, which is precisely when the run is supposed to be at its hardest.
  const pool = S.beatFinalBoss
    ? ENDLESS_POOL
    : poolForTime(S.stageElapsed, STAGES[S.currentStage].enemyPool);
  const id = pick(pool);
  const type = ENEMY_TYPES[id];
  const ang = rand(0, Math.PI * 2);
  const spawnDist = Math.max(viewW, viewH) * 0.62 + 60;
  let x = S.player.x + Math.cos(ang) * spawnDist;
  let y = S.player.y + Math.sin(ang) * spawnDist;
  const eLim = ARENA_RADIUS - 40;
  x = clamp(x, -eLim, eLim); y = clamp(y, -eLim, eLim);
  // Endless waves ratchet the whole roster up on an exponential curve, each stat separately.
  // Three layers, deliberately kept separate so each can be tuned without disturbing the
  // others: the global curve (how the whole game escalates), the per-stage time ramp (how this
  // stage escalates as it runs), and the stage's own stat multipliers (how this stage differs
  // from the baseline). HP and damage used to share a single per-stage number, so they could
  // not be moved independently, and there was no per-stage speed control at all.
  const st = stageEnemyStats();
  const ramp = difficultyMult(S.stageElapsed);
  // Per-spawn size roll (1 for anything that hasn't opted in). Applied to the RADIUS, which is
  // the single number both the hitbox and the drawn size come from - so one multiply resizes
  // the creature honestly instead of only its picture. Health follows on a steeper curve, so a
  // visibly big one really is the dangerous one.
  const sizeScale = rollSizeScale(type);
  // The siege around an open portal. Stamped ON THE BODY at spawn rather than read live, so a
  // thing that crawled out early stays as weak as it was born — which is what lets the red be
  // an honest readout: the redder it is, the later it arrived and the harder it hits. A global
  // tint would colour the harmless stragglers exactly like the monsters behind them.
  const pres = pressureLevel();
  const hp = type.hp * ramp * curveScale('hp') * st.hp * Math.pow(sizeScale, SIZE_HP_EXP)
    * (1 + PRESSURE_HP * pres);
  // Void affliction is rolled per spawn and folded into the numbers below, so an afflicted
  // creature is genuinely tougher rather than a normal one wearing an effect.
  const voided = Math.random() < voidAfflictChanceNow();
  if (voided && S.voidForceNext > 0) S.voidForceNext--;
  const vHp = voided ? VOID_AFFLICT_HP() : 1;
  S.enemies.push({
    ...type, id: S.nextId++, spriteId: id, x, y, hp: hp * vHp, maxHp: hp * vHp,
    voidAfflicted: voided,
    // One power per afflicted body, rolled here. Undefined on a normal enemy, so every void
    // behaviour downstream can gate on `e.voidPower` alone.
    voidPower: voided ? rollVoidPower() : undefined,
    xp: Math.round((type.xp || 1) * (voided ? VOID_AFFLICT_XP() : 1)),
    radius: type.radius * sizeScale,
    damage: Math.round(type.damage * (0.7 + ramp * 0.3) * curveScale('damage') * st.damage
      * (1 + PRESSURE_DAMAGE * pres) * (voided ? VOID_AFFLICT_DAMAGE() : 1)),
    speed: type.speed * curveScale('speed') * st.speed * (1 + PRESSURE_SPEED * pres)
      * (voided ? VOID_AFFLICT_SPEED() : 1),
    pressure: pres,
    dead: false, hitCd: 0,
  });
}

/**
 * Promote one of this stage's own monsters to elite and drop it near the player.
 *
 * Built from the live roster rather than a bespoke creature, so an elite is always a bigger,
 * named version of something already on screen — and every stage gains elites for free as its
 * roster grows.
 */
function spawnElite() {
  const pool = poolForTime(S.stageElapsed, STAGES[S.currentStage].enemyPool);
  if (!pool || !pool.length) return;
  const id = pick(pool);
  const type = ENEMY_TYPES[id];
  if (!type) return;
  const st = stageEnemyStats();
  const ramp = difficultyMult(S.stageElapsed);
  const baseHp = type.hp * ramp * curveScale('hp') * st.hp;
  const baseDmg = type.damage * (0.7 + ramp * 0.3) * curveScale('damage') * st.damage;
  // Spawned at arm's length, not on top of the player: an elite that opens by standing in your
  // face has already used its ability before you have seen its name.
  const a = Math.random() * Math.PI * 2;
  const lim = ARENA_RADIUS - 60;
  const e = {
    ...type, ...makeElite(type, baseHp, baseDmg), id: S.nextId++, spriteId: id,
    x: clamp(S.player.x + Math.cos(a) * 520, -lim, lim),
    y: clamp(S.player.y + Math.sin(a) * 520, -lim, lim),
    dead: false, hitCd: 0, pressure: 0,
  };
  e.speed *= curveScale('speed') * st.speed;
  S.enemies.push(e);
  play('bossSpawn');
  ui.showToast(e.eliteName, ELITE_ABILITY[e.ability].desc, e.abilityColor, 'epic');
}

// ---------- Minibosses ----------
// One named keeper per stage — see MINIBOSSES in elites.js for who they are. Mechanically an
// elite (chest contract, name bar) with the ability system swapped out for a bespoke skill.

const MB_CAST_CD = 7;        // seconds between skill uses
const MB_TELEGRAPH = 1.0;    // stands still and shows the weapon before every cast
const MB_CAST_RANGE = 640;   // will not open the fight from across the arena

function spawnMiniboss() {
  S.minibossSpawned = true;
  const stageDef = STAGES[S.currentStage];
  const def = MINIBOSSES[stageDef.id];
  if (!def || sandboxMode) return;
  // A third of the boss the player is building toward, computed from the SAME formula at the
  // same level — so the pegging holds no matter how the boss curve is tuned later.
  const boss = makeBoss(S.player.level, stageDef.boss);
  const hp = boss.hp / 3;
  const a = Math.random() * Math.PI * 2;
  const lim = ARENA_RADIUS - 80;
  const e = {
    behavior: 'walker', tier: 0,
    name: def.name, eliteName: def.name, isElite: true, isMiniboss: true,
    ability: null, abilityColor: def.color, color: def.color,
    mbSkill: def.skill, mbWeapon: def.weapon,
    mbState: 'idle', mbTimer: rand(2.5, 4),   // the entrance gets read before the first cast
    spriteId: def.spriteId, radius: 34, speed: 60 * ENEMY_GLOBALS.speedMult,
    hp, maxHp: hp, damage: Math.round(boss.damage * 0.55), xp: 120, contactCd: 0.8,
    x: clamp(S.player.x + Math.cos(a) * 560, -lim, lim),
    y: clamp(S.player.y + Math.sin(a) * 560, -lim, lim),
    id: S.nextId++, dead: false, hitCd: 0, pressure: 0,
  };
  S.enemies.push(e);
  play('bossSpawn');
  ui.showToast(def.name, def.desc, def.color, 'epic');
}

/**
 * The miniboss brain: a three-beat loop of idle → telegraph → cast. During the telegraph the
 * body STOPS (speed is zeroed, restored after) and the weapon rises — the stillness is the
 * warning, same language as the boss's slam wind-up.
 */
function updateMiniboss(e, dt) {
  e.mbTimer -= dt;
  if (e.mbState === 'idle') {
    if (e.mbTimer > 0) return;
    if (dist(e.x, e.y, S.player.x, S.player.y) > MB_CAST_RANGE) return; // wait until it matters
    e.mbState = 'telegraph'; e.mbTimer = MB_TELEGRAPH;
    e.mbAimX = S.player.x; e.mbAimY = S.player.y;
    e.mbBaseSpeed = e.speed; e.speed = 0;
    // Unearth telegraphs ON THE GROUND, where the danger will be: three grave-mounds around
    // where you are standing, dug the moment the shovel goes up.
    if (e.mbSkill === 'unearth') {
      for (let i = 0; i < 3; i++) {
        const ga = Math.random() * Math.PI * 2, gd = 40 + Math.random() * 110;
        spawnEffect({ kind: 'unearth', x: S.player.x + Math.cos(ga) * gd,
          y: S.player.y + Math.sin(ga) * gd, radius: 62,
          duration: MB_TELEGRAPH + 0.45, eruptAt: MB_TELEGRAPH,
          damage: e.damage, mods: {} });
      }
    }
    return;
  }
  if (e.mbState === 'telegraph') {
    if (e.mbTimer > 0) return;
    if (e.mbSkill === 'cyclone') {
      // Dash THROUGH the player's telegraphed position, not at it — the dodge is sideways.
      const d = Math.max(1, dist(e.x, e.y, e.mbAimX, e.mbAimY));
      e.mbVx = ((e.mbAimX - e.x) / d) * 520; e.mbVy = ((e.mbAimY - e.y) / d) * 520;
      e.mbState = 'dash'; e.mbTimer = 1.3; e.mbCloudTimer = 0;
      return;      // speed stays zeroed: the dash owns the body until it lands
    }
    if (e.mbSkill === 'hellhook') {
      spawnEffect({ kind: 'hellhook', x: e.x, y: e.y, tx: e.mbAimX, ty: e.mbAimY,
        srcId: e.id, damage: e.damage, duration: 0.8, mods: {} });
    }
    // Unearth already planted its mounds; they erupt on their own clock.
    e.mbState = 'idle'; e.mbTimer = MB_CAST_CD;
    e.speed = e.mbBaseSpeed;
    return;
  }
  if (e.mbState === 'dash') {
    e.x += e.mbVx * dt; e.y += e.mbVy * dt;
    const lim = ARENA_RADIUS - e.radius;
    if (Math.abs(e.x) > lim || Math.abs(e.y) > lim) e.mbTimer = 0;  // the wall ends the storm
    e.x = clamp(e.x, -lim, lim); e.y = clamp(e.y, -lim, lim);
    // A trail of choking sand, dropped by distance (via a timer) so the line is even.
    e.mbCloudTimer -= dt;
    if (e.mbCloudTimer <= 0) {
      e.mbCloudTimer = 0.14;
      spawnEffect({ kind: 'sandCloud', x: e.x, y: e.y, radius: 58, duration: 3.2, mods: {} });
    }
    if (e.mbTimer <= 0) { e.mbState = 'idle'; e.mbTimer = MB_CAST_CD; e.speed = e.mbBaseSpeed; }
    return;
  }
}

/**
 * A summoned lesser enemy at current stage scaling — the shared spawner behind Mourngrim's
 * dug-up Shamblers, Akhmet's scarabs and the Sovereign's legion. Summons are always the
 * roster's own creatures at honest stats, so a summon skill is pressure, never confetti.
 */
function spawnLesser(typeId, x, y, voided = false) {
  const type = ENEMY_TYPES[typeId];
  if (!type) return;
  const st = stageEnemyStats();
  const ramp = difficultyMult(S.stageElapsed);
  const vHp = voided ? VOID_AFFLICT_HP() : 1;
  const hp = type.hp * ramp * curveScale('hp') * st.hp * vHp;
  S.enemies.push({
    ...type, id: S.nextId++, spriteId: typeId, x, y, hp, maxHp: hp, voidAfflicted: voided,
    voidPower: voided ? rollVoidPower() : undefined,
    xp: Math.round((type.xp || 1) * (voided ? VOID_AFFLICT_XP() : 1)),
    damage: Math.round(type.damage * (0.7 + ramp * 0.3) * curveScale('damage') * st.damage
      * (voided ? VOID_AFFLICT_DAMAGE() : 1)),
    speed: type.speed * curveScale('speed') * st.speed * (voided ? VOID_AFFLICT_SPEED() : 1),
    dead: false, hitCd: 0, pressure: 0,
  });
}
/** A body Mourngrim digs out of the ground: the stage's own Shambler. */
function spawnDugUp(x, y) { spawnLesser('zombie', x, y); }

// ---------- Void powers ----------
// One per afflicted body (see void.js). Three of the four run on a timer here; the fourth
// (Riftborn) fires from killEnemy, because its whole idea is what happens after it dies.

/** Afflicted bodies currently alive — the ceiling contagion checks before it spreads. */
function afflictedCount() {
  let n = 0;
  for (const e of S.enemies) if (e.voidAfflicted && !e.dead) n++;
  return n;
}

/**
 * Turn a normal enemy afflicted where it stands. Used by Carrier, and deliberately applying the
 * SAME multipliers a spawn-time affliction would — a converted body is a real afflicted enemy,
 * not a weaker imitation, or spreading would be a downgrade the player could safely ignore.
 * Health scales rather than refills: catching a carrier's victim at half health should still
 * leave it at half.
 */
function afflictEnemy(e) {
  if (e.voidAfflicted || e.dead || e.isBoss || e.isElite) return;
  const frac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
  e.voidAfflicted = true;
  e.voidPower = rollVoidPower();
  e.maxHp *= VOID_AFFLICT_HP();
  e.hp = e.maxHp * frac;
  e.damage = Math.round(e.damage * VOID_AFFLICT_DAMAGE());
  e.speed *= VOID_AFFLICT_SPEED();
  e.xp = Math.round((e.xp || 1) * VOID_AFFLICT_XP());
  spawnEffect({ kind: 'ring', x: e.x, y: e.y, radius: 46, color: '#b04fd0',
    duration: 0.45, mods: {} });
}

/** Per-frame behaviour for the three powers that act while alive. */
function updateVoidPower(e, dt) {
  const t = VOID_TUNE;
  if (e.voidPower === 'contagion') {
    e.voidTimer = (e.voidTimer === undefined ? rand(1, t.contagionEvery) : e.voidTimer) - dt;
    if (e.voidTimer > 0) return;
    e.voidTimer = t.contagionEvery;
    if (afflictedCount() >= t.contagionCap) return;   // the ceiling that stops it running away
    // Nearest clean body, so a carrier in a pack visibly works outward from itself.
    let best = null, bestD = t.contagionRange;
    for (const o of S.enemies) {
      if (o === e || o.dead || o.voidAfflicted || o.isBoss || o.isElite) continue;
      const d = dist(e.x, e.y, o.x, o.y);
      if (d < bestD) { bestD = d; best = o; }
    }
    if (best) {
      afflictEnemy(best);
      spawnEffect({ kind: 'soulStream', x: e.x, y: e.y, tx: best.x, ty: best.y,
        duration: 0.5, voidTint: true, mods: {} });
    }
    return;
  }
  if (e.voidPower === 'devour') {
    e.voidStacks = e.voidStacks || 0;
    if (e.voidStacks >= t.devourMaxStacks) return;
    e.voidTimer = (e.voidTimer === undefined ? rand(1, t.devourEvery) : e.voidTimer) - dt;
    if (e.voidTimer > 0) return;
    e.voidTimer = t.devourEvery;
    // Eats its OWN side — never elites, bosses or other afflicted. A devourer that could eat
    // another afflicted body would collapse the whole mechanic into one survivor.
    let prey = null, bestD = t.devourRange;
    for (const o of S.enemies) {
      if (o === e || o.dead || o.voidAfflicted || o.isBoss || o.isElite) continue;
      const d = dist(e.x, e.y, o.x, o.y);
      if (d < bestD) { bestD = d; prey = o; }
    }
    if (!prey) return;
    prey.dead = true;              // consumed, not killed: no xp, no drops, no chest roll
    e.voidStacks++;
    const gain = e.maxHp * t.devourGain;
    e.maxHp += gain; e.hp += gain;
    e.radius *= 1.06;              // visibly bigger with every meal
    spawnEffect({ kind: 'soulStream', x: prey.x, y: prey.y, tx: e.x, ty: e.y,
      duration: 0.5, voidTint: true, mods: {} });
    return;
  }
  if (e.voidPower === 'tether') {
    // Pair up with the nearest other Chainbound. Resolved fresh every frame rather than stored,
    // so a broken pair (one died, one walked away) re-forms with whoever is closest without any
    // bookkeeping to go stale.
    e.voidLink = null;
    let bestD = t.tetherRange;
    for (const o of S.enemies) {
      if (o === e || o.dead || o.voidPower !== 'tether') continue;
      const d = dist(e.x, e.y, o.x, o.y);
      if (d < bestD) { bestD = d; e.voidLink = o; }
    }
    if (!e.voidLink) return;
    // Only the LOWER id of the pair tests the line, or both ends would burn the player twice
    // for one crossing.
    if (e.id > e.voidLink.id) return;
    e.voidBurnCd = (e.voidBurnCd || 0) - dt;
    if (e.voidBurnCd > 0) return;
    const o = e.voidLink;
    if (segDist(e.x, e.y, o.x, o.y, S.player.x, S.player.y) <= S.player.radius + 8) {
      applyDamageToPlayer(Math.round(e.damage * t.tetherDamage), 'Chainbound — Void Tether', 'skill');
      e.voidBurnCd = t.tetherCd;
      spawnEffect({ kind: 'ring', x: S.player.x, y: S.player.y, radius: 40,
        color: '#9a6ae8', duration: 0.3, mods: {} });
    }
  }
}

/** "r,g,b" pushed toward white by `k`. Used to derive a flame's bright core from its rim. */
function lightenRgb(rgb, k) {
  const [r, g, b] = rgb.split(',').map(Number);
  const up = (c) => Math.round(c + (255 - c) * k);
  return `${up(r)},${up(g)},${up(b)}`;
}

/**
 * The live wire between two Chainbound bodies: a dark cord with a bright crawling filament,
 * the same dark-body/bright-edge language as the flames themselves. Drawn under the enemies so
 * they stand ON their line rather than behind it.
 */
function drawVoidTether(a, b, seed) {
  const t = performance.now() / 1000;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const SEG = 12;
  ctx2d.save();
  // Two passes over one path: a thick near-black cord, then a thin bright filament on top.
  for (let pass = 0; pass < 2; pass++) {
    ctx2d.beginPath();
    for (let i = 0; i <= SEG; i++) {
      const f = i / SEG;
      // Sag in the middle and crawl along its length, so the line reads as energy rather than
      // as a drawn rule between two sprites.
      const wob = Math.sin(f * Math.PI) * Math.sin(t * 5 + f * 9 + seed) * 9;
      const x = a.x + dx * f + nx * wob;
      const y = a.y + dy * f + ny * wob;
      i ? ctx2d.lineTo(x, y) : ctx2d.moveTo(x, y);
    }
    if (pass === 0) {
      ctx2d.strokeStyle = 'rgba(12,5,26,0.9)'; ctx2d.lineWidth = 6;
    } else {
      ctx2d.strokeStyle = `rgba(190,150,255,${0.7 + 0.25 * Math.sin(t * 7 + seed)})`;
      ctx2d.lineWidth = 1.8;
    }
    ctx2d.stroke();
  }
  ctx2d.restore();
}

// ---------- Overhead headlines ----------
// Pickups, chests and items announce themselves OVER THE PLAYER, not in the corner. A toast in
// the bottom-right is unreadable while your eyes are on the middle of the screen — which is
// exactly where they are when you walk onto a chest — so the notice may as well not exist. The
// toast card is still used for things you are not looking at the floor for (elite arrivals, dev
// cheats, status warnings); see ui.showToast.
//
// White pixel type at subhead size, with GOLD picking out the one word that matters: the item's
// name, the amount of gold. Call sites mark those with braces — `Found {Hollow Star}` — so the
// emphasis lives in the message rather than in a second argument nobody would keep in step.
const HEADLINE_IN = 0.3;      // matching the toast's fade in...
const HEADLINE_HOLD = 4.5;    // ...its time on screen...
const HEADLINE_OUT = 0.3;     // ...and its fade out.
const HEADLINE_LIFE = HEADLINE_IN + HEADLINE_HOLD + HEADLINE_OUT;
const HEADLINE_MAX = 4;       // older ones drop off the top rather than towering
const HEADLINE_TITLE_PX = 22; // "subhead": above the damage numbers, below a stage card
const HEADLINE_SUB_PX = 15;
const HEADLINE_CLEARANCE = 52; // above the player's head, clear of the sprite and its health pips
const HEADLINE_GAP = 10;

/** @type {{ title: string, sub: string, t: number }[]} */
let headlines = [];

/**
 * Announce something over the player's head.
 * @param {string} title  braces mark gold: `Found {Hollow Star}`
 * @param {string} [sub]  same markup, smaller
 */
function showHeadline(title, sub) {
  headlines.push({ title, sub: sub || '', t: 0 });
  if (headlines.length > HEADLINE_MAX) headlines.shift();
}

/** Split `a {b} c` into coloured runs. */
function headlineParts(text) {
  const out = [];
  for (const chunk of String(text).split(/(\{[^}]*\})/)) {
    if (!chunk) continue;
    const gold = chunk.startsWith('{') && chunk.endsWith('}');
    out.push({ text: gold ? chunk.slice(1, -1) : chunk, gold });
  }
  return out;
}

/** One centred line of mixed white/gold runs, measured first so it centres as a whole. */
function drawHeadlineLine(text, cx, y, px, alpha) {
  const parts = headlineParts(text);
  ctx2d.font = `${px}px 'Pixelify Sans', sans-serif`;
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'middle';
  let total = 0;
  for (const p of parts) total += ctx2d.measureText(p.text).width;
  let x = cx - total / 2;
  for (const p of parts) {
    const w = ctx2d.measureText(p.text).width;
    // Heavy black outline: this floats over a lit floor, a horde and its own blood, and a plain
    // white glyph disappears into any of them.
    ctx2d.lineWidth = Math.max(3, px * 0.22);
    ctx2d.strokeStyle = `rgba(0,0,0,${0.85 * alpha})`;
    ctx2d.lineJoin = 'round';
    ctx2d.strokeText(p.text, x, y);
    ctx2d.fillStyle = p.gold ? `rgba(224,160,51,${alpha})` : `rgba(255,255,255,${alpha})`;
    ctx2d.fillText(p.text, x, y);
    x += w;
  }
}

function updateHeadlines(dt) {
  if (!headlines.length) return;
  for (const h of headlines) h.t += dt;
  headlines = headlines.filter((h) => h.t < HEADLINE_LIFE);
}

function drawHeadlines() {
  if (!headlines.length || !S.player) return;
  const s = worldToScreen(S.player.x, S.player.y);
  ctx2d.save();
  ctx2d.globalAlpha = 1;   // damage numbers leave theirs part-faded
  // Newest sits closest to the head and older ones are pushed up, so the cursor walks UPWARD from
  // the head accumulating real block heights. Offsetting each line by its own height instead
  // overlapped a two-line notice with the one above it.
  let bottom = s.y - HEADLINE_CLEARANCE;
  for (let i = headlines.length - 1; i >= 0; i--) {
    const h = headlines[i];
    const alpha = h.t < HEADLINE_IN ? h.t / HEADLINE_IN
      : h.t > HEADLINE_IN + HEADLINE_HOLD ? Math.max(0, (HEADLINE_LIFE - h.t) / HEADLINE_OUT)
        : 1;
    // Rises a little as it arrives, the same gesture the toast makes coming out of the corner.
    const rise = h.t < HEADLINE_IN ? (1 - h.t / HEADLINE_IN) * 10 : 0;
    const height = HEADLINE_TITLE_PX + (h.sub ? HEADLINE_SUB_PX + 4 : 0);
    const top = bottom - height + rise;
    drawHeadlineLine(h.title, s.x, top + HEADLINE_TITLE_PX * 0.5, HEADLINE_TITLE_PX, alpha);
    if (h.sub) {
      drawHeadlineLine(h.sub, s.x, top + HEADLINE_TITLE_PX + 4 + HEADLINE_SUB_PX * 0.5,
        HEADLINE_SUB_PX, alpha * 0.9);
    }
    bottom -= height + HEADLINE_GAP;
  }
  ctx2d.restore();
}

// ---------- Gambit chests and mimics ----------
// Chests used to be a loot table you walked onto: the reward was decided before you touched it,
// so the only decision was "can I reach it". Both of these put a DECISION back in the object.
//
//   A gambit chest arms a local siege and pays only if you outlive it — the reward is a bet on
//   your own build, and because the siege and the payout both scale with the run, it stays a
//   real question at wave 1 and at wave 30.
//   A mimic is the other half: sometimes the object bites, and the key you spent bought a fight
//   instead of a prize. It pays double for the fright.

const GAMBIT_CHANCE = 0.34;      // of chests, once past the tutorial stretch
const MIMIC_CHANCE = 0.12;
const GAMBIT_SECONDS = 15;
const GAMBIT_RADIUS = 460;       // how close the siege spawns — it comes to YOU, not the arena
const GAMBIT_SPAWN_EVERY = 0.34; // seconds between siege bodies

/** The live gambit, or null. Only one at a time: two overlapping sieges is noise, not tension. */
let gambit = null;

/**
 * The one door every chest enters the world through. Routing all four spawn sites here means a
 * chest added later cannot forget to roll its nature and quietly ship as always-safe.
 */
function pushChest(pk) {
  rollChestNature(pk);
  S.pickups.push(pk);
}

/** Roll a chest's nature at DROP time, so its look can tell the truth about what it is. */
function rollChestNature(pk) {
  // The first stage stays honest — a new player learns what a chest is before it learns to
  // lie to them.
  if (S.currentStage === 0 && !S.beatFinalBoss) return;
  const r = Math.random();
  if (r < MIMIC_CHANCE) pk.mimic = true;
  else if (r < MIMIC_CHANCE + GAMBIT_CHANCE) pk.gambit = true;
}

/** The chest was a monster. It springs, and its death leaves the doubled hoard. */
function springMimic(pk) {
  pk.dead = true;
  play('bossSpawn');
  shakeAmount = Math.max(shakeAmount, 8);
  const st = stageEnemyStats();
  const ramp = difficultyMult(S.stageElapsed);
  const hp = 240 * ramp * curveScale('hp') * st.hp;
  S.enemies.push({
    ...ENEMY_TYPES.ogre, name: 'Mimic', eliteName: 'Mimic', isElite: true, isMimic: true,
    ability: null, abilityColor: '#c9a227', color: '#8a6a3a',
    spriteId: 'ogre', radius: 24, speed: 130 * curveScale('speed') * st.speed,
    hp, maxHp: hp,
    damage: Math.round(22 * (0.7 + ramp * 0.3) * curveScale('damage') * st.damage),
    xp: 60, contactCd: 0.7,
    // The hoard it swallowed, paid out on death — doubled, because it cost a key and a fight.
    mimicReward: pk.reward,
    x: pk.x, y: pk.y, id: S.nextId++, dead: false, hitCd: 0, pressure: 0,
  });
  applyDamageToPlayer(Math.round(14 * curveScale('damage')), 'Mimic — Ambush', 'contact');
  showHeadline('{Mimic!}', 'The chest had teeth.');
}

/** Arm the siege. The chest stays on the field as the prize, unopenable until the clock ends. */
function startGambit(pk) {
  gambit = { t: GAMBIT_SECONDS, spawnT: 0, x: pk.x, y: pk.y, reward: pk.reward };
  pk.dead = true;
  play('bossSpawn');
  shakeAmount = Math.max(shakeAmount, 6);
  showHeadline('{Gambit}', `Survive {${GAMBIT_SECONDS}} seconds — the hoard is the wager.`);
}

/** The siege itself: bodies from every side, then the payout — or nothing, if you died. */
function updateGambit(dt) {
  if (!gambit) return;
  gambit.t -= dt;
  gambit.spawnT -= dt;
  if (gambit.spawnT <= 0 && S.enemies.length < MAX_ENEMIES) {
    gambit.spawnT = GAMBIT_SPAWN_EVERY;
    // Spawned around the PLAYER rather than the chest, so running away buys nothing — the
    // gambit is a fight you accepted, not a place you can leave.
    const a = Math.random() * Math.PI * 2;
    const lim = ARENA_RADIUS - 40;
    const gx = clamp(S.player.x + Math.cos(a) * GAMBIT_RADIUS, -lim, lim);
    const gy = clamp(S.player.y + Math.sin(a) * GAMBIT_RADIUS, -lim, lim);
    const pool = S.beatFinalBoss ? ENDLESS_POOL : poolForTime(S.stageElapsed, STAGES[S.currentStage].enemyPool);
    spawnLesser(pick(pool), gx, gy, Math.random() < 0.25);   // a quarter arrive afflicted
  }
  if (gambit.t > 0) return;
  // Survived. The wager pays in gold scaled by how deep the run is, plus the chest's own
  // reward — and in endless it rolls a relic, which is where the loop keeps its late teeth.
  const won = gambit.reward;
  const bonus = Math.round((200 + S.currentStage * 150) * (1 + (S.endlessWave || 0) * 0.35));
  addGold(heldItem('tithebell') ? Math.round(bonus * 0.75) : bonus);
  S.pendingLevelUps++;
  showHeadline('{Gambit Won}', `{+${bonus}} gold · a level · the hoard is yours.`);
  play('jackpot');
  spawnChestBurst(S.player.x, S.player.y);
  if (won && won.special === 'gold') addGold(won.gold);
  const relicId = Math.random() < relicDropChance(relicWave()) ? rollRelic(S.player, relicWave()) : null;
  if (relicId) {
    const tier = grantRelic(relicId);
    if (tier) {
      const def = RELICS[relicId];
      showHeadline(`Relic — {${def.name}${tier > 1 ? ` ${'I'.repeat(tier)}` : ''}}`,
        relicDesc(S.player, relicId));
      if (relicId === 'secondsilence' && !S.player.silenceLeft) S.player.silenceLeft = 1;
    }
  }
  gambit = null;
}

// ---------- Unique items ----------
// The rules themselves live at the seams they rewrite (search `heldItem(` to find every one);
// this block is the grant, the splash, and the per-stage triggers.

/** Convenience read against the live player. @param {string} id */
function heldItem(id) { return S.player && holdsItem(S.player, id); }

/** Is this the build's slowest skill? (The Ninefold Eye echoes only that one.) */
function isSlowestSkill(s) {
  let slowest = s;
  for (const o of S.player.activeSkills) {
    if (skillCooldown(o.id) > skillCooldown(slowest.id)) slowest = o;
  }
  return slowest === s;
}

/** The Salt Ledger's memory: enemy kinds that have already spent their first touch this stage. */
const saltSeen = new Set();

/** A boss has fallen: hand over one item, or a hoard when the shelf is full. */
function grantBossItem() {
  const id = rollBossItem(S.player);
  if (!id) {
    const hoard = 150 + S.currentStage * 100;
    addGold(heldItem('tithebell') ? Math.round(hoard * 0.75) : hoard);
    showHeadline('The Shelf Is Full', `Tribute converts to {+${hoard}} gold.`);
    return;
  }
  S.player.items[id] = 1;
  const def = ITEMS[id];
  ui.showItemSplash(def);
  ui.refreshItemBar(itemsHeld(S.player).map((i) => ITEMS[i]));
  play('jackpot');
  // The Long Road's slot arrives the moment the item does.
  if (id === 'longroad') S.player.supportCap = (S.player.supportCap || SUPPORT_SLOTS_BASE) + 1;
}

/** Stage-entry item triggers, called from advanceStage after the new realm is set up. */
function applyStageItems() {
  if (!S.player) return;
  // The Unspent Coin cashes out: one random shop line that is not maxed gains a level, free,
  // and the coin is spent — the shelf slot opens back up for the next boss.
  if (heldItem('unspentcoin')) {
    const granted = grantRandomUpgradeLevel();
    delete S.player.items.unspentcoin;
    ui.refreshItemBar(itemsHeld(S.player).map((i) => ITEMS[i]));
    showHeadline('The Unspent Coin', granted
      ? `It becomes {${granted}}, free.` : 'Nothing left to buy — {+200} gold.');
    if (!granted) addGold(200);
  }
  // Pilgrim's Ash: arrival burns bright — double dodge charges for thirty seconds.
  if (heldItem('pilgrimsash')) {
    S.player.dashCharges = mobilityTune().charges * 2;
    S.player.ashUntil = performance.now() + 30000;
    showHeadline("{Pilgrim's Ash}", 'Your step is doubled for thirty seconds.');
  }
}

/** Riftborn's payoff, called from killEnemy: the hole it leaves behind. */
function voidRiftOnDeath(e) {
  // `riftborn` distinguishes this from the Sovereign's Maw on the death readout — same effect,
  // very different story about how the run ended.
  spawnEffect({ kind: 'hollowRift', riftborn: true, x: e.x, y: e.y, radius: VOID_TUNE.riftRadius,
    duration: VOID_TUNE.riftDuration,
    damage: Math.max(1, Math.round(e.damage * VOID_TUNE.riftDamage)),
    mods: { damageMult: 1, lifeLeech: 0, critChance: 0 } });
}

function spawnBoss() {
  const stageDef = STAGES[S.currentStage];
  // Endless draws its boss from the WHOLE campaign rather than replaying the Sovereign forever
  // — the same reasoning as the endless enemy pool. Never the same king twice running, so a
  // long night cycles through all three of them.
  let bossDef = stageDef.boss;
  if (S.beatFinalBoss) {
    const pool = STAGES.map((st) => st.boss).filter((b) => b.id !== S.lastEndlessBoss);
    bossDef = pick(pool);
    S.lastEndlessBoss = bossDef.id;
  }
  S.boss = {
    ...makeBoss(S.player.level, bossDef), id: S.nextId++, spriteId: bossDef.spriteId,
    x: S.player.x + rand(-1, 1) * 500, y: S.player.y - 600, dead: false, hitCd: 0, slamState: 'idle',
  };
  const bLim = ARENA_RADIUS - 80;
  S.boss.x = clamp(S.boss.x, -bLim, bLim); S.boss.y = clamp(S.boss.y, -bLim, bLim);
  // Bosses ride the same curve as the roster, so a stage-2 boss is already meaningfully
  // tougher than a stage-1 one without needing its own separate scaling table.
  S.boss.maxHp = Math.round(S.boss.maxHp * curveScale('hp'));
  S.boss.hp = S.boss.maxHp;
  S.boss.damage = Math.round(S.boss.damage * curveScale('damage'));
  S.boss.speed = S.boss.speed * curveScale('speed');
  S.enemies.push(S.boss);
  S.bossSpawned = true;
  play('bossSpawn');
  // Hand the music over to this stage's boss theme, if it has one. Stages without one keep
  // their normal rotation, so this is safe to leave in place as the other two are assigned.
  playBossMusic(`stage${S.currentStage + 1}`);
  const bossLabel = S.endlessWave > 0 ? `${stageDef.boss.name} — Wave ${S.endlessWave + 1}` : stageDef.boss.name;
  ui.showToast(bossLabel, 'A boss draws near…', stageDef.boss.color);
}

// ---------- main loop ----------
function updateGamepadBadge(allPads) {
  const gpBadge = document.getElementById('gamepadStatus');
  gpBadge.classList.toggle('hidden', S.state !== 'START' && S.state !== 'SETTINGS');
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
  if (S.state !== 'SETTINGS') return;
  const sig = listConnectedPads().map((p) => p.id).join('|');
  if (sig !== lastPadsSignature) { lastPadsSignature = sig; refreshSettingsMenu(); }
}

let lastTime = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  // Wall clock across the whole callback, so the phase marks can be checked against a total
  // rather than trusted. Anything the marks do not account for is either work outside them or
  // work the browser does on our behalf — and knowing which is the whole point.
  const frameT0 = PERF.on ? performance.now() : 0;
  beginFrameTransform();
  ctx2d.clearRect(0, 0, viewW, viewH);

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

  if (S.state === 'PLAYING') {
    // B on an Xbox pad, edge-detected HERE rather than trusting gp.justPressed. That flag is
    // consumed by the menu navigation code, which does not run during play — so it stayed true
    // frame after frame and drained both charges the moment anything read it. Latching on our
    // own transition makes one press mean one dash, whatever the shared flag is doing.
    const padDash = !!(gp && gp.justPressed[1]);
    if (padDash && !dashPadLatch) tryDash();
    dashPadLatch = padDash;
    if (gp && (gp.justPressed[9] || gp.justPressed[8]) && performance.now() - lastPauseToggle > PAUSE_TOGGLE_COOLDOWN) {
      lastPauseToggle = performance.now(); openPause(); // Start or View/Back
    }
    pStart();
    update(dt);
    pMark('uRest');   // everything in update() after the last phase mark: cleanup, spawns, HUD
    render();
  } else {
    // What sits BEHIND an open menu. Menus reached from the main menu keep the carousel there;
    // the same menus reached from a pause keep the paused arena instead. Three of them can be
    // opened either way, so each is asked where it came from rather than guessed at.
    //
    // Dev Tools, Sandbox and the Music player were all missing from this list, so they rendered
    // over a stale or empty canvas — solid black. That went unnoticed while the scrim was at
    // 0.94 and hid the backdrop everywhere; once the scrim came down to 0.52 they were the only
    // screens with nothing behind them, which is what made them look "way darker".
    const OVER_MAIN = {
      SETTINGS: () => settingsReturnState === 'MAINMENU',
      DEVTOOLS: () => devReturnState === 'MAINMENU',
      MUSIC: () => musicReturnState === 'MAINMENU',
      SANDBOX: () => !sandboxLive,          // sandboxLive means it was opened mid-run
    };
    const dual = OVER_MAIN[S.state];
    const menuArtBehind = S.state === 'MAINMENU' || S.state === 'LEADERBOARD' || S.state === 'SHOP'
      || S.state === 'UNLOCKS' || S.state === 'ACHIEVEMENTS' || (dual ? dual() : false);
    const pausedBehind = S.state === 'PAUSED' || (dual ? !dual() : false);
    if (menuArtBehind) renderMainMenuArt();
    else if (S.state === 'LEVELUP' || pausedBehind) render();
    // Dev Tools is the one overlay that does NOT dim the scene behind it.
    //
    // The pause wash is right for pausing — the game is suspended and the menu is the subject.
    // Dev Tools is a workbench: half its dials are a colour or a shape out on the field, and a
    // 55% black wash over the canvas makes every one of them read wrong. This is a CANVAS fill,
    // not CSS, which is why removing the overlay's background and docking the panel narrower
    // both failed to reveal anything — the darkening was painted into the frame itself.
    if (pausedBehind && S.state !== 'DEVTOOLS') drawPauseDim();
    if (S.state === 'PAUSED' && gp && (gp.justPressed[9] || gp.justPressed[8]) && performance.now() - lastPauseToggle > PAUSE_TOGGLE_COOLDOWN) {
      lastPauseToggle = performance.now(); closePause();
    }
    if (S.state === 'SETTINGS') refreshSettingsMenuIfPadsChanged();
    updateGamepadMenuNav();
  }
  updatePerfBox(now);
  pFrame(PERF.on ? performance.now() - frameT0 : 0);
  requestAnimationFrame(frame);
}

// ---- TEMPORARY perf readout (FPS + live enemy count). Delete with its markup/CSS. ----
// FPS is counted over a rolling 250ms window rather than from a single frame delta, so the
// number is readable instead of flickering every frame.
let frameId = 0; // bumped once per update; scopes the per-frame mods cache
let frostStackDim = 1; // see the frostGround note in the update loop
let cloudStackDim = 1; // same problem, same fix — a volley throws one cloud per charge
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
  fpsEl.textContent = String(perfFps);
  fpsEl.className = 'perfVal' + (perfFps < 30 ? ' bad' : perfFps < 50 ? ' warn' : '');
  const live = S.state === 'PLAYING' || S.state === 'PAUSED' || S.state === 'LEVELUP';
  const n = live ? S.enemies.length : 0;
  enEl.textContent = String(n);
  enEl.className = 'perfVal' + (n >= MAX_ENEMIES ? ' bad' : n > MAX_ENEMIES * 0.75 ? ' warn' : '');
  // Projectiles and effects are uncapped (unlike enemies), so surface them here — a runaway
  // build shows up as one of these climbing without settling.
  const prEl = document.getElementById('perfProj');
  const fxEl = document.getElementById('perfFx');
  if (prEl) {
    const np = live ? S.projectiles.length : 0;
    prEl.textContent = String(np);
    prEl.className = 'perfVal' + (np >= MAX_PROJECTILES ? ' bad' : np > MAX_PROJECTILES * 0.75 ? ' warn' : '');
  }
  if (fxEl) {
    const nf = live ? S.effects.length : 0;
    fxEl.textContent = String(nf);
    fxEl.className = 'perfVal' + (nf >= MAX_EFFECTS ? ' bad' : nf > MAX_EFFECTS * 0.75 ? ' warn' : '');
  }
  drawPerfBreakdown();
}

// The phase breakdown, appended to the perf box while the profiler is on. It lives in the game
// rather than in a console because the only place the framerate is REAL is a real window: an
// embedded browser pane throttles requestAnimationFrame, so it reports 1fps whatever the load
// and every conclusion drawn from it is worthless. Read this in the exe.
//
// Phases are sorted by cost and shown against the whole-frame wall clock, so the gap between
// "accounted for" and "frame" is visible — that gap is the browser's own compositing and GPU
// work, which no amount of JS instrumentation can see from the inside.
let perfBreakEl = null;
function drawPerfBreakdown() {
  if (!PERF.on) {
    if (perfBreakEl) { perfBreakEl.remove(); perfBreakEl = null; }
    return;
  }
  const box = document.getElementById('perfBox') || document.querySelector('.perfBox');
  if (!box) return;
  if (!perfBreakEl) {
    perfBreakEl = document.createElement('div');
    perfBreakEl.className = 'perfBreak';
    box.appendChild(perfBreakEl);
  }
  const a = { ...PERF.avg };
  const frame = a.frameTotal || 0;
  delete a.frameTotal;
  const acct = Object.values(a).reduce((s, v) => s + v, 0);
  const rows = Object.entries(a).sort((x, y) => y[1] - x[1]).slice(0, 8)
    .filter(([, v]) => v >= 0.02)
    .map(([k, v]) => `<span>${k}</span><b>${v.toFixed(2)}</b>`).join('');
  perfBreakEl.innerHTML = `<span>frame</span><b>${frame.toFixed(2)}</b>`
    + `<span>js total</span><b>${acct.toFixed(2)}</b>`
    + `<span>gpu / idle</span><b>${Math.max(0, frame - acct).toFixed(2)}</b>`
    + `<hr>${rows}`;
}

// Pixel-art main title. Everything is drawn to a low-res offscreen canvas, then upscaled
// nearest-neighbor so the (still-gothic) fonts and the blocky gold frame read as pixel art.
function renderTitleArt(canvasId = 'titleCanvas') {
  const cv = /** @type {HTMLCanvasElement} */ (document.getElementById(canvasId));
  if (!cv) return;
  const PIX = 3, W = 600, H = 244;
  const sw = Math.round(W / PIX), sh = Math.round(H / PIX);
  cv.width = W; cv.height = H;
  const off = document.createElement('canvas'); off.width = sw; off.height = sh;
  const o = off.getContext('2d');
  o.imageSmoothingEnabled = false;
  o.clearRect(0, 0, sw, sh);

  // `dark` backs the frame and outlines the lettering. Was #2a1a08, a warm brown; now a neutral
  // off-black so the title plate matches the charcoal panels instead of being the last warm
  // element on the menu.
  const gold = '#c9a227', goldDim = '#7e611b', goldHi = '#f0d98a', dark = '#131316';
  // Lettering runs red; the frame stays gold on purpose, so these are their own set rather
  // than the frame's gold vars.
  //
  // KEEP IN SYNC with the .sectionTitle/.gameTitle gradient in style.css — the DOM headings
  // reproduce this exact ramp so the canvas plate and every screen title read as one family.
  // inkMid matches --chrome-lit there; the other two stops have no CSS variable and are
  // duplicated literally in both places.
  const inkHi = '#f0b0a0', inkMid = '#ad4136', inkLo = '#8a2118';
  // Warm backing glow.
  const bg = o.createRadialGradient(sw / 2, sh * 0.5, 3, sw / 2, sh * 0.5, sw * 0.62);
  bg.addColorStop(0, 'rgba(30,30,34,0.82)');
  bg.addColorStop(1, 'rgba(10,10,12,0.35)');
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

  // VOIDFALL — the gothic font, outlined and gold, sized to fit.
  o.textAlign = 'center'; o.textBaseline = 'alphabetic'; o.lineJoin = 'round';
  let fs = 36; o.font = `${fs}px 'Pirata One', serif`;
  while (o.measureText('VOIDFALL').width > sw - 26 && fs > 10) { fs -= 1; o.font = `${fs}px 'Pirata One', serif`; }
  const dy = Math.round(sh * 0.52);
  o.strokeStyle = dark; o.lineWidth = 3; o.strokeText('VOIDFALL', sw / 2, dy);
  const tg = o.createLinearGradient(0, dy - fs * 0.82, 0, dy + 2);
  tg.addColorStop(0, inkHi); tg.addColorStop(0.5, inkMid); tg.addColorStop(1, inkLo);
  o.fillStyle = tg; o.fillText('VOIDFALL', sw / 2, dy);

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
  o.fillStyle = inkMid; o.fillText('SURVIVORS', sw / 2, sy);
  try { o.letterSpacing = '0px'; } catch (e) { /* noop */ }

  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(off, 0, 0, sw, sh, 0, 0, W, H);
}

// Every face the CANVAS draws with, in the exact weight it draws at.
//
// This list is load-bearing now that the fonts are self-hosted. @font-face only fetches a face
// when something USES it, and a canvas `ctx.font = ...` does not count as use — the browser
// silently falls back instead. Anything drawn on canvas therefore has to be requested by hand.
//
// Weight matters as much as family: the damage numbers draw at 700, and the only DOM element
// using Pixelify Sans 700 is the key counter, which is hidden while chests are off. Ask for
// the wrong weight here and the numbers render in a synthesised bold of the 400 face.
const CANVAS_FONTS = [
  "36px 'Pirata One'",            // title art
  "11px 'Press Start 2P'",        // title subhead, SPAWN pad
  "700 17px 'Press Start 2P'",    // SPAWN pad label
  "700 16px 'Pixelify Sans'",     // damage numbers
  "700 22px 'Pixelify Sans'",     // crit damage numbers
  "12px Cinzel",                  // boss name plate
];

/** Resolves once every canvas face is downloaded and usable. */
function loadCanvasFonts() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.all(CANVAS_FONTS.map((f) => document.fonts.load(f).catch(() => {})));
}

// Render the title once its fonts are ready (fall back to an immediate draw).
// The lockup, baked. renderTitleArt draws it from scratch with canvas text, which means the
// title cannot appear until 'Pirata One' and 'Press Start 2P' have downloaded — on the LOADING
// screen, whose whole job is to be up before anything else. A pre-rendered PNG shows instantly
// and pixel-for-pixel identically, with no font dependency at all.
//
// The drawing code stays: it is the source of truth, and it is what regenerates this file.
const TITLE_LOCKUP_SRC = 'assets/ui/title-lockup.png';

/** Paints the baked lockup into a canvas. Resolves false if the image is not available. */
function paintBakedTitle(canvasId, img) {
  const cv = /** @type {HTMLCanvasElement} */ (document.getElementById(canvasId));
  if (!cv || !img.naturalWidth) return false;
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(img, 0, 0);
  return true;
}

// Only the menu title is a canvas now; the loading screen uses a plain <img> in index.html so
// the browser can fetch it during parse, before any of this has run.
const TITLE_CANVASES = ['titleCanvas'];

function drawTitleLive() {
  for (const id of TITLE_CANVASES) renderTitleArt(id);
}

function ensureTitleArt() {
  // Deliberately NOT drawn live first. An eager draw would run before the webfonts have
  // downloaded, and canvas text silently falls back — so the loading screen would show VOIDFALL
  // in a generic serif for a beat and then snap to the real face. That flash of the wrong font
  // is the exact thing baking the lockup was meant to remove. A local PNG decodes in a frame or
  // two; a blank plate for that long is invisible, a wrong typeface is not.
  const img = new Image();
  img.onload = () => { for (const id of TITLE_CANVASES) paintBakedTitle(id, img); };
  // No bake on disk (a fresh checkout, before the first ?bake-title): only then fall back to
  // drawing, and wait for the faces first so even the fallback path is never the wrong font.
  img.onerror = () => {
    loadCanvasFonts().then(drawTitleLive).catch(drawTitleLive);
  };
  img.src = TITLE_LOCKUP_SRC;
}

// ---- Re-baking -------------------------------------------------------------------------
// Load the page with ?bake-title and the lockup is redrawn from source, at full font fidelity,
// and POSTed to the dev server, which writes assets/ui/title-lockup.png plus a sidecar holding
// the hash of the drawing code that produced it.
//
// tools/smoke.mjs recomputes that hash and fails if it has drifted, so an edit to the lockup
// cannot ship without the image being regenerated — that is the link between the two. It is a
// deliberate two-step: rendering needs a browser, and `npm run check` runs in Node.
async function bakeTitleLockup() {
  await loadCanvasFonts().catch(() => {});
  await (document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve());
  drawTitleLive();
  const cv = /** @type {HTMLCanvasElement} */ (document.getElementById('titleCanvas'));
  if (!cv) return;
  const res = await fetch('/bake-title', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ png: cv.toDataURL('image/png'), width: cv.width, height: cv.height }),
  }).catch(() => null);
  const ok = !!res && res.ok;
  ui.showToast(ok ? 'Title baked' : 'Bake failed',
    ok ? `${TITLE_LOCKUP_SRC} regenerated.` : 'Is the dev server running?',
    ok ? '#c9a227' : '#c94a3f');
}
if (new URLSearchParams(location.search).has('bake-title')) {
  window.addEventListener('load', () => { bakeTitleLockup(); });
}

function renderMainMenuArt() {
  ctx2d.fillStyle = '#050403';
  ctx2d.fillRect(0, 0, viewW, viewH);
  const cx = viewW / 2, cy = viewH * 0.62;

  ctx2d.save();
  ctx2d.beginPath(); ctx2d.arc(cx, cy, Math.max(viewW, viewH), 0, Math.PI * 2); ctx2d.clip();
  const menuPat = menuFloorPattern();
  if (menuPat) {
    const fpm = menuFloorSize;
    ctx2d.translate(((cx % fpm) + fpm) % fpm, ((cy % fpm) + fpm) % fpm);
    ctx2d.fillStyle = menuPat;
    ctx2d.fillRect(-fpm, -fpm, viewW + fpm * 2, viewH + fpm * 2);
  }
  ctx2d.restore();

  const glow = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, Math.max(viewW, viewH) * 0.7);
  glow.addColorStop(0, 'rgba(10,6,3,0)');
  glow.addColorStop(0.55, 'rgba(10,6,3,0.25)');
  glow.addColorStop(1, 'rgba(4,2,1,0.88)');
  ctx2d.fillStyle = glow;
  ctx2d.fillRect(0, 0, viewW, viewH);

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
// Facings the menu drum uses per sprite, overriding the default profile. Only sprites that
// actually ship the named art belong here — anything else silently falls back via DIR_FALLBACK.
// The angle each character is shown at in the menu procession. left_45 is the house standard
// — it faces the walk direction and shows the face rather than a flat profile — and every
// character and enemy adopts it as their eight-direction art lands. Sorceress keeps the legacy
// spelling of the same facing; both resolve to left_45.
const CAROUSEL_DIR = {
  warrior: 'left_45', ranger: 'left_45', sorceress: 'left45',
  boss: 'left_45', sandPharaoh: 'left_45',      // both bosses ship the real three-quarter art
};

// Per-sprite size trim for the menu procession. The drum sizes every figure to the same lane
// height, which is right for a line-up of people but wrong for anything that is not person-sized
// — the scarab's art fills its frame edge to edge, so at full lane height a beetle marched past
// as tall as the Skeleton King. 1 (the default) means the lane height suits it as drawn.
const CAROUSEL_SCALE = { scarab: 0.5 };

const CAROUSEL_LANES = [
  // Height is deliberately an exact multiple of the 64px source art. Sprites that snap to a
  // whole-number scale and the zombie (which sets `fitExact` and does not snap) then land on
  // the same size — ask for 439 and the snapping ones round to 448 while the zombie stays 439.
  // alpha 1: fully opaque. Depth is carried by SIZE, not by fading — a translucent character
  // reads as a ghost rather than as a distant one.
  // Raised off dead-centre so the cast's HEADS pass through the gap between the two main-menu
  // panels. yFrac positions the sprite's centre, so at 0.5 the gap framed everyone's legs.
  { yFrac: 0.46, height: 448, alpha: 1, speed: 114.28, dir: -1 },
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
  // Nothing until the sheets land. There used to be a procedural stand-in cast here — boss,
  // wraith, bat, zombie, archer — drawn "rather than an empty stage" while the art loaded.
  // That WAS the old artwork flashing on boot: spriteQuad now refuses to hand back the
  // procedural fallback for a sprite whose sheet is still in flight, but the wraith has no
  // hand-drawn art at all, so it was exempt from that gate and kept appearing.
  //
  // An empty menu for the ~250ms the sheets take is the better trade, and once preloading
  // starts them at module-load time it is over before the menu is on screen.
  if (!carouselIds.length) return;

  const t = performance.now() / 1000;
  const cx = viewW / 2;
  const radius = viewW * DRUM_RADIUS_FRAC;
  const n = carouselIds.length;

  for (let li = 0; li < CAROUSEL_LANES.length; li++) {
    const lane = CAROUSEL_LANES[li];
    const y = viewH * lane.yFrac;
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
      // Per-sprite facing override for the showcase. The sorceress reads best three-quarter
      // rather than in pure profile, now that she has dedicated left art — the drum lane
      // travels left, so left45 is the angle that actually faces the way she is walking.
      const id = carouselIds[f.i];
      const dir = CAROUSEL_DIR[id] || 'side';
      // A dedicated left facing is already drawn facing left, so it must not also be mirrored.
      const mirror = (lane.dir < 0) && !dir.startsWith('left');
      const sc = CAROUSEL_SCALE[id] || 1;
      const h = f.h * sc;
      // Stand them on a common ground line, measured from where each drawing's INK ends rather
      // than where its canvas does. drawSprite centres on the y it is given, so two things were
      // lifting the scarab clear of the floor the others walk on: the 0.5 trim took half its
      // height off the bottom as well as the top, and its art carries 11% empty canvas below the
      // beetle where the jackal's and the walkers' ink runs to the edge. Grounding by ink covers
      // both, and is a no-op for every figure that already fills its frame.
      // Floaters keep their centre: a bat is meant to be off the ground.
      const grounded = !spriteFloats(id);
      const yy = grounded
        ? f.y + f.h / 2 + h / 2 - spriteContent(id, dir).bottom * h
        : f.y;
      drawSprite(ctx2d, id, f.x, yy, h, mirror, dir, phase, true);
    }
    ctx2d.restore();
  }
}

function update(dt) {
  S.elapsed += dt; S.stageElapsed += dt;

  shakeAmount = Math.max(0, shakeAmount - 40 * dt);
  shakeOffset = shakeAmount > 0 ? { x: rand(-1, 1) * shakeAmount, y: rand(-1, 1) * shakeAmount } : { x: 0, y: 0 };
  updateBackdropShift(dt);
  updateStagePortal(dt);

  let mx = 0, my = 0;
  if (keys.has('w') || keys.has('arrowup')) my -= 1;
  if (keys.has('s') || keys.has('arrowdown')) my += 1;
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
  if (keys.has('d') || keys.has('arrowright')) mx += 1;
  if (gp) { mx += gp.move.x; my += gp.move.y; }
  mx = clamp(mx, -1, 1); my = clamp(my, -1, 1);
  // Bone Reassembly: while the bones are crawling back together there is no body to steer.
  // Input is zeroed rather than the whole update skipped — the world keeps running around the
  // pile, which is the entire dread of the moment.
  if (S.player.reassembling > 0) {
    mx = 0; my = 0;
    S.player.reassembling -= dt;
    if (S.player.reassembling <= 0) {
      S.player.hp = Math.round(S.player.maxHp * REASSEMBLE_HP);
      // A short beat of grace on standing up — reassembling inside the crowd that killed you
      // is not a revival unless you can take a first step.
      S.player.silenceUntil = performance.now() + 800;
      spawnEffect({ kind: 'ring', x: S.player.x, y: S.player.y, radius: 90,
        color: '#cfc4a8', duration: 0.5, mods: {} });
      ui.showToast('Reassembled', 'The bones remember their shape.', '#a89e85');
      play('levelUp');
    }
  }
  // Overchannel: the Sorceress's power builds while she holds still. Keyed to INPUT, not to
  // displacement — being shoved does not break the channel, choosing to walk does.
  if (S.player.overchannel) {
    const moving = mx !== 0 || my !== 0 || S.player.dashT > 0;
    S.player.stillTime = moving ? 0 : (S.player.stillTime || 0) + dt;
  }
  const n = normalize(mx, my);
  // Frost and Tether both slow. Applied to the SPEED rather than to the position after the
  // fact, so the dash and the knock-back keep their own rules — being chilled should make you
  // walk slowly, not make your dodge shorter.
  let slow = 1;
  if (afflicted('frost')) slow *= 0.55;
  if (afflicted('tether')) slow *= TETHER_SLOW;
  const speed = S.player.baseSpeed * S.player.speedMult * slow;
  S.player.x += n.x * speed * dt;
  S.player.y += n.y * speed * dt;
  // The dash is added ON TOP of normal movement rather than replacing it, so steering still
  // works through the burst and it never reads as a stun. Direction is locked at the moment it
  // was spent, which is what makes it a commitment rather than a speed boost.
  if (S.player.dashT > 0) {
    S.player.x += S.player.dashDir.x * dashSpeed() * dt;
    S.player.y += S.player.dashDir.y * dashSpeed() * dt;
    S.player.dashT -= dt;
    S.player.dashFade = DASH_BLUR_HOLD;   // refreshed every frame of the burst
  } else if (S.player.dashFade > 0) {
    S.player.dashFade -= dt;              // the smear outlives the movement, fading as it goes
  }
  // One charge at a time: the timer only runs while something is missing, and resets after each
  // refill, so two spent charges cost two full cooldowns. Reads the equipped mobility skill's
  // dials, so a slot swap re-times the button from the next charge onward.
  const mtRe = mobilityTune();
  // Pilgrim's Ash burning out: over-cap charges vanish when the thirty seconds end.
  if (S.player.ashUntil && performance.now() > S.player.ashUntil) {
    S.player.ashUntil = 0;
    S.player.dashCharges = Math.min(S.player.dashCharges, mtRe.charges);
  }
  if (S.player.dashCharges < mtRe.charges) {
    S.player.dashCd -= dt;
    if (S.player.dashCd <= 0) {
      S.player.dashCharges++;
      S.player.dashCd = S.player.dashCharges < mtRe.charges ? mtRe.cooldown : 0;
    }
  } else {
    S.player.dashCd = 0;
  }
  // Knock-back from pressured bodies, bleeding off over PRESSURE_KNOCK_TIME. Added AFTER the
  // player's own movement rather than folded into it, so being shoved never cancels the input —
  // you keep steering while you are pushed, which is what stops it feeling like a stun.
  if (S.player.shoveT > 0) {
    const k = S.player.shoveT / PRESSURE_KNOCK_TIME;   // 1 at impact, 0 when spent
    S.player.x += S.player.shoveX * k * dt;
    S.player.y += S.player.shoveY * k * dt;
    S.player.shoveT -= dt;
    if (S.player.shoveT <= 0) { S.player.shoveX = 0; S.player.shoveY = 0; }
  }
  if (afflicted('shock')) {
    const wob = Math.sin(performance.now() / 90) * 0.30;   // ~17 degrees, wandering
    const a = Math.atan2(S.player.facing.y, S.player.facing.x) + wob;
    S.player.facing.x = Math.cos(a); S.player.facing.y = Math.sin(a);
  }
  // Rock is solid. Resolved AFTER movement, dash and knock-back have all had their say, so
  // nothing can be shoved through a boulder by something that ran later in the frame.
  if (terrain) terrain.resolve(S.player, S.player.radius);
  const pLim = ARENA_RADIUS - S.player.radius;
  S.player.x = clamp(S.player.x, -pLim, pLim);
  S.player.y = clamp(S.player.y, -pLim, pLim);
  // Shock is the control affliction: it does not slow you, it makes your aim wander. Applied
  // after facing is resolved so it perturbs whichever source won, rather than fighting the
  // input. Chosen over a stun because losing control of the camera for four seconds is
  // miserable, while shots drifting a few degrees is a problem you can play around.
  // Facing priority: gamepad right stick > mouse cursor (kb/mouse play) > movement.
  //
  // Whether either of the first two is live is recorded, not just which one won. Movement
  // decides facing when neither is, and a skill that wants to aim itself needs to tell those
  // apart: pointing somewhere because you asked is different from pointing somewhere because
  // that is the way you happen to be walking.
  aimInputActive = !!(gp && (gp.aim.x !== 0 || gp.aim.y !== 0))
    || (lastInputDevice === 'keyboard' && mouseAimActive);
  if (gp && (gp.aim.x !== 0 || gp.aim.y !== 0)) {
    S.player.facing = normalize(gp.aim.x, gp.aim.y);
  } else if (lastInputDevice === 'keyboard' && mouseAimActive) {
    const dx = mousePos.x - viewW / 2, dy = mousePos.y - viewH / 2;
    if (dx !== 0 || dy !== 0) S.player.facing = normalize(dx, dy);
  } else {
    // No deliberate aim. On a CONTROLLER, fall back to the nearest enemy rather than to the
    // direction of travel — that is the default for every aimed skill on a pad, not a
    // per-skill trick.
    //
    // Why only the pad: a mouse always has a position, so a keyboard player is never without an
    // aim vector and taking it off them would be wrong. A pad's right stick springs back to
    // centre, so the moment it is released the player has said nothing about where to point,
    // and answering "wherever you happen to be running" means kiting backwards while firing at
    // empty floor. Movement is still the last resort, for when nothing is in reach.
    const target = lastInputDevice === 'gamepad'
      ? autoAimTarget(S.player, AUTO_AIM_RANGE, S.player.aimTargetId) : null;
    S.player.aimTargetId = target ? target.id : null;
    if (target) S.player.facing = normalize(target.x - S.player.x, target.y - S.player.y);
    else if (n.x !== 0 || n.y !== 0) S.player.facing = n;
  }

  // The drawn facing is settled HERE rather than at the draw call, so it advances exactly once
  // per simulation step. Deriving it during render would re-evaluate it on every frame the
  // renderer produces, which is the same "decide it again and again from a value on a tie"
  // shape the flicker comes from in the first place.
  S.player.faceDir = facingDirStable(S.player.facing.x, S.player.facing.y, S.player.faceDir);

  // The Hollowed's wounds never close on their own — item regen included. Collapse kills are
  // his only sustain (see killEnemy), which is the entire shape of the class.
  if (S.player.hurtFlash) S.player.hurtFlash = Math.max(0, S.player.hurtFlash - dt / HURT_FLASH_TIME);
  if (!afflicted('blight') && !S.player.noRegen) {
    // The HP Regen tome joins the class's own regen HERE, inside the same guard — so Blight
    // silences it and The Hollowed's no-regen rule holds without either having to know the
    // tome exists. Magnitude is percent points of max life per second.
    const regenLvl = S.player.supports.hpregen || 0;
    const tomeRegen = regenLvl ? S.player.maxHp * (tomeMagnitude('hpregen', regenLvl) / 100) : 0;
    S.player.hp = Math.min(S.player.maxHp, S.player.hp + (S.player.hpRegen + tomeRegen) * dt);
  }

  for (const s of S.player.activeSkills) {
    // A summon whose cap has just risen fills the new slot at once. Without this, picking up
    // a +1 leaves the extra skeleton missing until the next cast — up to a full 7s wait.
    const def = SKILLS[s.id];
    if (def.minionCap) {
      const cap = def.minionCap(s.level, computeModsCached(S.player, s));
      if (s.minionCap !== undefined && cap > s.minionCap) s.cd = 0;
      s.minionCap = cap;
    }
    s.cd = (s.cd || 0) - dt;
    // A scattered Skeleton casts nothing; cooldowns keep draining so he wakes up swinging.
    if (s.cd <= 0 && !(S.player.reassembling > 0)) {
      const mods = computeMods(S.player, s);
      // Widow's Metronome: every fifth cast of ANYTHING crits and costs no cooldown. The
      // guarantee rides critChance past the cap on purpose — critChanceNow clamps it to the
      // ceiling, and the ceiling is 100%.
      const fifthCast = heldItem('metronome') && (++S.player.castTally % 5 === 0);
      if (fifthCast) mods.critChance = 99;
      SKILLS[s.id].cast({ player: S.player, level: s.level, mods, world, facing: S.player.facing, skill: s });
      // The Ninefold Eye: the SLOWEST skill in the build echoes its cast at half strength.
      // Slowest by live base cooldown, so the echo follows the build as it changes.
      if (heldItem('ninefoldeye') && isSlowestSkill(s)) {
        const echo = { ...mods, damageMult: mods.damageMult * 0.5 };
        SKILLS[s.id].cast({ player: S.player, level: s.level, mods: echo, world, facing: S.player.facing, skill: s });
      }
      s.cd = fifthCast ? 0 : skillCooldown(s.id) * mods.cooldownMult;
    }
  }

  // The horde never lets up — enemies keep pouring in through the boss fight so the kill
  // count can keep climbing for the leaderboard.
  // The respawn pad. `armed` means the player has to leave and step back on: standing in it
  // would otherwise refill the field every frame.
  if (sandboxMode && sandboxButton) {
    const d = dist(S.player.x, S.player.y, sandboxButton.x, sandboxButton.y);
    const touching = d <= sandboxButton.radius + S.player.radius;
    if (touching && sandboxButton.armed) {
      sandboxButton.armed = false;
      S.enemies = [];
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
    S.spawnTimer -= dt;
    // Accumulate rather than reset so short intervals don't lose spawns to frame time;
    // the guard keeps a long frame from dumping the whole horde at once.
    let spawnGuard = 0;
    while (S.spawnTimer <= 0 && spawnGuard++ < 10) {
      // At the ceiling, hold spawning entirely. Zeroing the timer (rather than letting it run
      // further negative) stops a spawn debt building up, which would otherwise dump a huge
      // burst the instant the count dipped back under the cap.
      if (S.enemies.length >= MAX_ENEMIES) { S.spawnTimer = 0; break; }
      trySpawnEnemy();
      // Endless waves shorten the gap between spawns on the same exponential curve as the
      // stat ramp — without it the horde thinned out over time, because a stronger player
      // cleared each spawn faster than the fixed interval could replace it.
      // The open-portal siege rides on top as one more divisor, so lingering thickens the horde
      // on the same curve that makes each body tougher.
      S.spawnTimer += spawnIntervalFor(S.stageElapsed)
        / (stageEnemyStats().spawnRate * curveScale('spawnRate') * (1 + PRESSURE_SPAWN * pressureLevel()));
    }
    // The boss is the ONLY way a stage ends — the timer just keeps counting the round's
    // run time; the boss arrives once THIS stage's hidden clock hits BOSS_TIME (or its kills do).
    // Elites arrive on their own clock, faster once endless begins. Never while the boss is up:
  // two health bars and two sets of telegraphs at once is noise, not difficulty.
  if (!S.bossSpawned && S.player && !sandboxMode) {
    eliteTimer -= dt;
    if (eliteTimer <= 0) {
      eliteTimer = S.beatFinalBoss ? ELITE_TUNE.spawnEveryEndless : ELITE_TUNE.spawnEvery;
      // Two gates, both about not stacking health bars the player cannot chew through:
      //  - the concurrency cap, counting minibosses too, since a keeper IS the fight you have
      //    stopped for and a second elite on top of it is the pile-up this prevents;
      //  - and the timer still resets either way, so a blocked spawn is skipped rather than
      //    banked — otherwise clearing the field would dump the whole backlog at once.
      let alive = 0;
      for (const e of S.enemies) if (e.isElite && !e.dead) alive++;
      if (alive < ELITE_TUNE.maxAlive) spawnElite();
    }
  }
  // The stage's named keeper arrives at HALF the boss's kill gate — deep enough in that the
  // build has taken shape, early enough that beating it changes the rest of the stage. One per
  // stage, campaign only: endless has the elite treadmill, and a fixed character respawning
  // every wave would spend the "somebody lives here" read that makes these three special.
  if (!S.minibossSpawned && !S.bossSpawned && !S.beatFinalBoss
      && S.stageKills >= killThresholdFor(S.currentStage) / 2) spawnMiniboss();
  // Cracked Hourglass hurries the boss: both gates shrink to 70%.
  const hgMult = heldItem('hourglass') ? 0.7 : 1;
  if (!S.bossSpawned && (S.stageElapsed >= BOSS_TIME * hgMult
      || S.stageKills >= killThresholdFor(S.currentStage) * hgMult)) spawnBoss();
  }

  updateArmor(dt);
  pMark('uMisc');
  for (const e of S.enemies) updateEnemy(e, dt);
  pMark('uEnemies');
  for (const m of S.minions) updateMinion(m, dt);
  pMark('uMinions');
  for (const p of S.projectiles) updateProjectile(p, dt);
  pMark('uProjectiles');
  frameId++; // new frame — per-frame caches (mods) become stale here
  updatePendingShots(dt);
  updateAfflictions(dt);
  updateHeadlines(dt);
  updateVoidIntro(dt);
  updateGambit(dt);
  for (const e of S.enemies) {
    if (e.dead) continue;
    if (e.voidPower) updateVoidPower(e, dt);
    if (!e.isElite) continue;
    // Minibosses run their own brain — updateElite would read the null ability and cast nothing.
    if (e.isMiniboss) updateMiniboss(e, dt); else updateElite(e, dt);
  }
  for (const fx of S.effects) updateEffect(fx, dt);
  pMark('uEffects');
  // Frost patches composite over one another, so a stack of them (Ice Nova with +projectile
  // lays several) blows out to near-white. Dim each patch as more become active so the
  // combined wash stays close to what a single patch looks like.
  let frostLive = 0;
  let cloudLive = 0;
  for (const fx of S.effects) {
    if (fx.kind === 'frostGround' && !(fx.delay > 0)) frostLive++;
    else if (fx.kind === 'frostCloud') cloudLive++;
  }
  frostStackDim = 1 / Math.sqrt(Math.max(1, frostLive));
  // An Ice Bomb salvo is three charges landing in a line a moment apart, so the clouds always
  // arrive on top of each other. Without this, a single volley reads as one white slab.
  cloudStackDim = 1 / Math.sqrt(Math.max(1, cloudLive));
  for (const pk of S.pickups) updatePickup(pk, dt);
  for (const d of S.dmgNumbers) { d.t += dt; d.y -= 38 * dt; }

  // Compact in place rather than rebuilding six arrays every frame — at a few hundred live
  // entities that was several thousand allocations a second feeding the collector.
  compact(S.enemies, (e) => !e.dead);
  compact(S.minions, (m) => !m.dead);
  compact(S.projectiles, (p) => !p.dead);
  compact(S.effects, (fx) => !fx.dead);
  if (S.effects.length > MAX_EFFECTS) S.effects.splice(0, S.effects.length - MAX_EFFECTS);
  if (S.projectiles.length > MAX_PROJECTILES) S.projectiles.splice(0, S.projectiles.length - MAX_PROJECTILES);
  compact(S.pickups, (pk) => !pk.dead);
  compact(S.dmgNumbers, (d) => { const alive = d.t < d.life; if (!alive) d.dead = true; return alive; });

  if (S.pendingLevelUps > 0 && S.state === 'PLAYING') { S.state = 'LEVELUP'; showLevelUpStep(); return; }

  ui.updateHUD({
    hp: S.player.hp, maxHp: S.player.maxHp, xp: S.player.xp, xpToNext: S.player.xpToNext, level: S.player.level,
    elapsed: S.elapsed, bossSpawned: S.bossSpawned, bossHp: S.boss ? S.boss.hp : 0, bossMaxHp: S.boss ? S.boss.maxHp : 0,
    // The siege clock. A SEPARATE readout that temporarily takes the timer's place — S.elapsed
    // above keeps counting underneath the whole time, because it is the run's total time and a
    // run does not stop happening while the player loots. Stepping through the portal drops
    // this and the real clock reappears at whatever it actually reached.
    pressure: stagePortal ? { t: stagePortal.t, level: pressureLevel() } : null,
    // The gambit's clock. Its own field rather than riding `pressure`, because the two can be
    // live at once (a gambit opened during a portal siege) and they mean different things.
    gambit: gambit ? { t: Math.max(0, gambit.t), total: GAMBIT_SECONDS } : null,
    bossName: S.boss ? S.boss.name : '', stage: S.currentStage + 1, stageName: STAGES[S.currentStage].name,
    endlessWave: S.beatFinalBoss ? S.endlessWave : 0, gold: getGold(), keys: S.keyCount, chestsEnabled: CHESTS_ENABLED,
    dash: { charges: S.player.dashCharges, max: mobilityTune().charges,
      cd: S.player.dashCd, cdMax: mobilityTune().cooldown,
      skillId: S.player.mobility.id, name: SKILLS[S.player.mobility.id].name,
      icon: SKILLS[S.player.mobility.id].icon, color: SKILLS[S.player.mobility.id].color },
    kills: S.kills, armor: S.player.armorLeft, maxArmor: S.player.armor,
    // cdMax is the cooldown gameplay is ACTUALLY running on, passed explicitly rather than
    // letting the HUD read def.cooldownBase. That static field is a second copy of the same
    // number and skillCooldown() prefers tune.cooldown over it — so a tuned cooldown moved the
    // real timer while the HUD ring kept scaling against the shipped one and sat pegged.
    skills: S.player.activeSkills.map((s) => ({ ...s, def: SKILLS[s.id], cdMax: skillCooldown(s.id) })),
    supports: Object.entries(S.player.supports).map(([id, lvl]) => ({ def: SUPPORTS[id], lvl })),
  });
}

function worldToScreen(x, y) {
  return { x: x - S.player.x + viewW / 2 + shakeOffset.x, y: y - S.player.y + viewH / 2 + shakeOffset.y };
}

// Effects that lie flat on the ground rather than happening in the air. These are drawn under
// the portal and the loot; everything else is drawn over them. Keep this in step with the
// ground-hazard branch in updateEffect, which ticks damage for the same set.
const GROUND_FX = new Set(['poison', 'poisonPuddle', 'burningGround', 'frostGround', 'unearth',
  'curseRing', 'hollowRift',
  // The salt ring is scratched in the dirt, so it belongs under the bodies it is holding back —
  // drawn over them it would hide the crowd it exists to keep at arm's length. This set is
  // draw ORDER only; the damage tick above keys off its own explicit list, so being here does
  // not make the ring a ground hazard.
  'saltcircle']);

// ---------- Frame phase profiler ----------
// The synthetic harness (tools/perf-harness.mjs) proved the projectile broadphase costs ~0.1% of
// a frame at 100 projectiles, which means the cost of a stacked build is somewhere else. Guessing
// where would just move the guess, so the real loop is split into named phases and timed.
//
// Off by default and shaped so that costs nothing: `PERF.on` is checked first in a function small
// enough to inline, so a disabled profiler is a predictable branch rather than a clock read.
// performance.now() is not free — a few hundred calls a frame would themselves show up.
export const PERF = {
  on: false,
  t0: 0,
  /** @type {Record<string, number>} */ acc: {},
  /** @type {Record<string, number>} */ avg: {},
  frames: 0,
};

function pStart() { if (PERF.on) PERF.t0 = performance.now(); }
function pMark(name) {
  if (!PERF.on) return;
  const now = performance.now();
  PERF.acc[name] = (PERF.acc[name] || 0) + (now - PERF.t0);
  PERF.t0 = now;
}

/**
 * Fold this frame into a rolling average. Called once a frame from frame().
 *
 * An exponential moving average rather than "sum over N frames, then divide". A fixed frame
 * window is a trap when the thing you are profiling is a framerate collapse: at 1fps a 30-frame
 * window is thirty SECONDS, so the figures you read describe whatever the game was doing half a
 * minute ago — which on the first run here meant a healthy 1.46ms while the screen sat at 1fps.
 * An EMA is always current no matter how slow the frame gets.
 */
const PERF_ALPHA = 0.12;
function pFrame(frameMs) {
  if (!PERF.on) return;
  PERF.frames++;
  PERF.acc.frameTotal = frameMs;
  for (const k of Object.keys(PERF.acc)) {
    const prev = PERF.avg[k];
    PERF.avg[k] = prev === undefined ? PERF.acc[k] : prev + (PERF.acc[k] - prev) * PERF_ALPHA;
  }
  PERF.acc = {};
}

/** Counts alongside the timings — a phase is only interpretable next to how much it processed. */
export function perfCounts() {
  return {
    enemies: S.enemies.length, projectiles: S.projectiles.length,
    effects: S.effects.length, dmgNumbers: S.dmgNumbers.length,
    minions: S.minions.length, pickups: S.pickups.length,
  };
}

function render() {
  pStart();
  ctx2d.save();
  drawArenaFloor();

  pMark('floor');
  for (const d of S.decorObjects) drawDecor(d);
  for (const b of S.bloodDecals) drawBlood(b);
  pMark('decor');
  // Ground hazards are painted BEFORE the portal and the loot, not with the rest of the
  // effects. They are wide, opaque and long-lived, so drawn afterwards they buried the two
  // things the player most needs to see: a portal you are trying to walk into, and the drops
  // you are trying to pick up. A puddle is floor, so it belongs with the floor.
  for (const fx of S.effects) if (GROUND_FX.has(fx.kind)) drawEffect(fx);
  // Rock goes ON TOP of the blood, the puddles and the frost — not under them. It used to be
  // painted with the floor so it caught the same vignette, which mattered when a rock was a grey
  // mixed a few steps off the ground; now that it is flat black with a lit edge there is nothing
  // for the vignette to do to it, and being buried under a poison pool was actively misleading.
  // An outcrop is not walkable ground, so it must never look like ground you could stand on.
  ctx2d.save();
  ctx2d.clip(arenaEdgePath(worldToScreen(0, 0)));
  drawTerrain();
  ctx2d.restore();
  for (const fx of S.effects) if (fx.kind === 'dashStreak') drawDashStreak(fx);
  if (stagePortal) drawStagePortal();
  if (sandboxMode && sandboxButton) drawSandboxButton();
  for (const pk of S.pickups) drawPickup(pk);
  pMark('groundFx');
  for (const fx of S.effects) if (!GROUND_FX.has(fx.kind)) drawEffect(fx);
  pMark('effects');

  // ---- the sprite band ----
  // Ground-level decoration that belongs UNDER the cast, then every character sprite batched
  // onto the GPU in one go, then the overlays that belong on top. See drawEnemyUnder.
  for (const e of S.enemies) drawEnemyUnder(e);
  pMark('enemyUnder');
  spriteLayer.begin(ctx2d, viewW, viewH);
  for (const e of S.enemies) drawEnemySprite(e);
  for (const m of S.minions) drawMinionSprite(m);
  drawPlayer();
  spriteLayer.end();
  pMark('sprites');
  for (const e of S.enemies) drawEnemyOver(e);
  for (const m of S.minions) drawMinionOver(m);
  // AFTER the sprite band, deliberately. This used to run with the effects layer, which is
  // painted before the sprites — so every on-body tell was buried under the player and all
  // that survived was a thin ring. The enemy statuses draw in drawEnemyOver, above their
  // sprites; the player's afflictions belong in the same layer for the same reason.
  drawAfflictions();
  pMark('enemyOver');

  for (const p of S.projectiles) drawProjectile(p);
  pMark('projectiles');
  dmgFontCache = null;   // other painters have touched ctx.font since last frame
  for (const d of S.dmgNumbers) drawDamageNumber(d);
  drawHeadlines();
  pMark('dmgNumbers');
  drawTorchlight();
  ctx2d.restore();
  pMark('torchlight');
  applyBloom();
  pMark('bloom');
}

// Bloom post-process: additively composite a blurred, contrast-crushed copy of the frame so
// bright things (fire, lightning, ice, torchlight, explosions, gems) glow. This runs only
// inside world rendering, so the DOM menus/HUD panels are never touched.
let bloomCanvas = null, bloomCtx = null;
// Buffer size as a fraction of the screen, and the blur radius measured against THAT buffer.
// Kept together because they only make sense as a pair: the blur is in buffer pixels, so
// changing the scale without changing the radius changes how far the glow spreads on screen.
// 3px at 0.5 and 2px at 0.34 are the same apparent spread.
const BLOOM_SCALE = 0.34;
const BLOOM_BLUR = 2;
function applyBloom() {
  const w = viewW, h = viewH;
  if (!w || !h) return;
  if (GRAPHICS_TUNE.bloom <= 0) return;  // fully off costs nothing rather than drawing at alpha 0
  // 0.5 -> 0.34. Bloom is a blur: it has no detail to lose, so its buffer can be far smaller
  // than the screen before anything is visible. Dropping each axis to a third cuts the pixels
  // this pass touches to ~46% of what half-res cost, and it is consistently the most expensive
  // phase in the frame because it reads and writes the WHOLE screen regardless of scene load.
  // The blur radius comes down with it, or a fixed 3px on a smaller buffer would spread the
  // glow half as far again in screen terms and wash the picture out.
  const bw = Math.max(1, Math.round(w * BLOOM_SCALE)), bh = Math.max(1, Math.round(h * BLOOM_SCALE));
  if (!bloomCanvas) { bloomCanvas = document.createElement('canvas'); bloomCtx = bloomCanvas.getContext('2d'); }
  if (bloomCanvas.width !== bw || bloomCanvas.height !== bh) { bloomCanvas.width = bw; bloomCanvas.height = bh; }
  // Crush the darks (high contrast leaves mostly the bright pixels) and blur into a soft glow.
  bloomCtx.clearRect(0, 0, bw, bh);
  bloomCtx.filter = `contrast(1.6) brightness(1.12) blur(${BLOOM_BLUR}px)`;
  bloomCtx.drawImage(canvas, 0, 0, w, h, 0, 0, bw, bh);
  bloomCtx.filter = 'none';
  // Add the glow back over the scene (additive — dark areas contribute ~nothing).
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  // Was a fixed 0.55. On a slider because bloom is the single biggest lever on how washed-out
  // the scene reads, and it interacts with everything else being tuned — 0 turns the pass off
  // entirely, which is also the cleanest way to see a colour as it truly is.
  ctx2d.globalAlpha = GRAPHICS_TUNE.bloom;
  ctx2d.imageSmoothingEnabled = true;
  ctx2d.drawImage(bloomCanvas, 0, 0, bw, bh, 0, 0, w, h);
  ctx2d.restore(); // restores composite/alpha and imageSmoothingEnabled(false) for crisp sprites
}

// ---------- Arena edge ----------
// The boundary used to be two strokeRects: a 10px line with a 3px line inside it, unchanged
// since the first build. A drawn outline reads as a UI element — the arena looked like a box on
// a screen rather than a place with sides.
//
// It is now a ragged edge cut out of the floor with layered noise, and the region beyond it is
// filled as solid rock. No stroke anywhere: the boundary is where the ground STOPS, which is how
// terrain actually reads. Enemies and the player still clamp to the true square — the noise only
// ever eats INWARD from it, so nothing can stand on painted rock.
const EDGE_STEP = 26;        // world px between outline samples; smaller = finer teeth
const EDGE_BITE = 46;        // deepest the noise cuts inward
/** @type {{x:number,y:number}[]|null} */
let arenaEdgeCache = null;
let arenaEdgeSeed = -1;

/** Deterministic 0..1 hash. Same edge every frame, and the same edge on every machine. */
function edgeNoise(i, salt) {
  const v = Math.sin(i * 12.9898 + salt * 78.233 + arenaEdgeSeed * 3.1415) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * The ragged outline, in world coordinates, walked clockwise around the square.
 * Cached: it is hundreds of points and it never changes while a stage is up.
 */
function arenaEdgePoly() {
  if (arenaEdgeCache && arenaEdgeSeed === S.currentStage) return arenaEdgeCache;
  arenaEdgeSeed = S.currentStage;
  const half = ARENA_RADIUS;
  const pts = [];
  // Two octaves: a slow swell that gives the wall large bays, and a fine chatter for the teeth.
  const biteAt = (t, side) => {
    const coarse = edgeNoise(Math.floor(t / 5), side * 7);
    const fine = edgeNoise(t, side * 13 + 1);
    return (coarse * 0.7 + fine * 0.3) * EDGE_BITE;
  };
  const perSide = Math.max(8, Math.round((half * 2) / EDGE_STEP));
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < perSide; k++) {
      const f = k / perSide;
      const d = -half + f * half * 2;
      const bite = biteAt(side * perSide + k, side);
      if (side === 0) pts.push({ x: d, y: -half + bite });        // top, cutting down
      else if (side === 1) pts.push({ x: half - bite, y: d });     // right, cutting left
      else if (side === 2) pts.push({ x: -d, y: half - bite });    // bottom, cutting up
      else pts.push({ x: -half + bite, y: -d });                   // left, cutting right
    }
  }
  arenaEdgeCache = pts;   // dropped automatically when S.currentStage moves (see the guard above)
  return pts;
}

/** The outline as a screen-space Path2D, rebuilt per frame because the camera moves. */
function arenaEdgePath(c) {
  const pts = arenaEdgePoly();
  const path = new Path2D();
  path.moveTo(c.x + pts[0].x, c.y + pts[0].y);
  for (let i = 1; i < pts.length; i++) path.lineTo(c.x + pts[i].x, c.y + pts[i].y);
  path.closePath();
  return path;
}

function drawArenaFloor() {
  const stageDef = STAGES[S.currentStage];
  ctx2d.fillStyle = '#050403';
  ctx2d.fillRect(0, 0, viewW, viewH);
  const c = worldToScreen(0, 0);
  const half = ARENA_RADIUS;
  const x0 = c.x - half, y0 = c.y - half, size = half * 2;

  // The floor is clipped to the RAGGED outline, so the ground itself ends unevenly.
  const edge = arenaEdgePath(c);
  ctx2d.save();
  ctx2d.clip(edge);
  paintFloor(c);
  ctx2d.restore();

  // Vignette, clipped the same way so it cannot bleed onto the rock.
  ctx2d.save();
  ctx2d.clip(edge);
  const falloff = ctx2d.createRadialGradient(c.x, c.y, half * 0.5, c.x, c.y, half * 1.15);
  falloff.addColorStop(0, 'rgba(0,0,0,0)');
  falloff.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx2d.fillStyle = falloff;
  ctx2d.fillRect(x0, y0, size, size);
  ctx2d.restore();

  // Everything beyond the outline is rock. Drawn as one even-odd fill of (big rect MINUS the
  // ragged outline), which paints only the band between them — no stroke, no outline, and the
  // teeth of the noise become the silhouette of the wall.
  // Beyond the ragged cut there is nothing to look at: the wall is painted the same near-black
  // as the void outside the arena, so it reads as the world simply ending. The boundary is the
  // SHAPE of the floor, not a thing drawn on top of it — no stroke, no lit face, no stage tint.
  //
  // Filling the whole viewport and punching the arena out of it, rather than padding a rectangle
  // around the arena: a padded rect leaves its own hard corner out in the dark, which trades one
  // straight line for another further away.
  const wall = new Path2D();
  wall.rect(0, 0, viewW, viewH);
  wall.addPath(edge);
  ctx2d.save();
  ctx2d.fillStyle = '#050403';   // same as the backdrop fill at the top of this function
  ctx2d.fill(wall, 'evenodd');
  // One soft black pass over the cut, clipped to the dark side. Without it the floor tiles end
  // on a crisp pixel edge and the raggedness reads as jagged rather than as depth.
  ctx2d.clip(wall, 'evenodd');
  ctx2d.globalAlpha = 0.55;
  ctx2d.strokeStyle = '#050403';
  ctx2d.lineWidth = 34;
  ctx2d.stroke(edge);
  ctx2d.globalAlpha = 1;
  ctx2d.restore();
}

/**
 * Rings around the player, one per active affliction, in that ability's colour.
 *
 * Drawn on the player rather than shown as HUD text: what is riding you changes how you play
 * RIGHT NOW, and glancing at a corner panel mid-fight is not something anyone does. Stacked
 * outward so several at once stay countable.
 */
// Sekhra's sand: a warm dust puff, dense at the heart and ragged at the edge.
const SAND_CLOUD_STOPS = [[0, 'rgba(216,160,74,0.5)'], [0.6, 'rgba(178,126,58,0.3)'],
  [1, 'rgba(178,126,58,0)']];

// Blight's wash: the poison recipe shifted to its sickly grave-green, so "no healing" reads as
// the body itself going wrong rather than as another purple poison.
const BLIGHT_WASH_STOPS = [[0, 'rgba(60,166,106,0.5)'], [0.72, 'rgba(45,120,80,0.28)'],
  [1, 'rgba(45,120,80,0)']];

function drawAfflictions() {
  const p = S.player;
  if (!p || !p.afflict) return;
  const now = performance.now();
  const tm = now / 1000;
  const c = worldToScreen(p.x, p.y);
  const r = p.radius;

  // Every affliction gets TWO layers: the on-body tell (below), which is what makes the status
  // recognisable at a glance, and a timer ring. The shared four reuse the ENEMY tells verbatim —
  // being seared by an Emberbound looks exactly like what your own fire does to the horde, so
  // the vocabulary is learned once and read everywhere.
  if (p.afflict.burning > now) drawBurningStatus(c.x, c.y, r);
  if (p.afflict.poison > now) drawPoisonStatus(c.x, c.y, r, { poisonStacks: 3 });
  if (p.afflict.frost > now) drawFrostStatus(c.x, c.y, r);
  if (p.afflict.shock > now) drawShockStatus(c.x, c.y, r, 1);

  // ---- elite-only tells ----
  // Sunder: the guard visibly broken. Jagged red cracks radiating off the body, re-seeded on a
  // slow clock so they creep rather than strobe, over a red pulse that beats like a warning —
  // this is the status that makes everything ELSE more dangerous, so it gets the loudest tell.
  if (p.afflict.sunder > now) {
    const step = Math.floor(now / 240);
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'lighter';
    drawGlow(c.x, c.y, '201,56,46', r * (1.6 + 0.35 * Math.sin(tm * 6)));
    ctx2d.restore();
    ctx2d.save();
    ctx2d.strokeStyle = 'rgba(255,120,100,0.9)';
    ctx2d.lineWidth = 1.6;
    ctx2d.beginPath();
    for (let i = 0; i < 4; i++) {
      const seed = (i * 47 + step * 13) % 360;
      const a = (seed / 360) * Math.PI * 2;
      // A two-kink crack from the body's edge outward: straight lines with corners, the same
      // "damage has angles" language as the shock arcs.
      let x = c.x + Math.cos(a) * r * 0.5, y = c.y + Math.sin(a) * r * 0.4;
      ctx2d.moveTo(x, y);
      for (let k = 1; k <= 2; k++) {
        const wob = ((seed * (k + 1)) % 7 - 3) * 0.12;
        x += Math.cos(a + wob) * r * 0.45; y += Math.sin(a + wob) * r * 0.4;
        ctx2d.lineTo(x, y);
      }
    }
    ctx2d.stroke();
    ctx2d.restore();
  }
  // Blight: healing severed. The body washes grave-green and sheds slow falling drips — decay
  // runs DOWN, where every healthy effect in the game rises.
  if (p.afflict.blight > now) {
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'source-atop';
    drawPuff('blightWash', BLIGHT_WASH_STOPS, c.x, c.y, r * 1.5, r * 1.5, 0.8);
    ctx2d.restore();
    ctx2d.save();
    ctx2d.fillStyle = 'rgba(80,190,120,0.8)';
    for (let i = 0; i < 3; i++) {
      const ph = (tm * 0.9 + i / 3) % 1;
      const dx = Math.sin(i * 2.4) * r * 0.6;
      const sz = 2.2 * (1 - ph * 0.5);
      ctx2d.beginPath();
      ctx2d.ellipse(c.x + dx, c.y - r * 0.2 + ph * r * 1.6, sz * 0.7, sz, 0, 0, Math.PI * 2);
      ctx2d.fill();
    }
    ctx2d.restore();
  }
  // Tether: the only affliction with a SOURCE, so its tell is the connection itself — a sagging
  // gold chain to the elite doing the hauling, found the same way the pull finds it. Without
  // this the drag reads as broken movement; with it, it reads as being dragged.
  if (p.afflict.tether > now) {
    let src = null, best = Infinity;
    for (const e of S.enemies) {
      if (e.dead || !e.isElite) continue;
      const d = dist(e.x, e.y, p.x, p.y);
      if (d < best) { best = d; src = e; }
    }
    if (src) {
      const s = worldToScreen(src.x, src.y);
      const links = Math.max(4, Math.min(14, Math.round(best / 34)));
      ctx2d.save();
      ctx2d.strokeStyle = 'rgba(201,162,39,0.9)';
      ctx2d.lineWidth = 1.5;
      for (let i = 0; i < links; i++) {
        const f = (i + 0.5) / links;
        // The chain sags between its ends and trembles with the pull.
        const sag = Math.sin(f * Math.PI) * (10 + Math.sin(tm * 7 + i) * 2.5);
        const lx = c.x + (s.x - c.x) * f, ly = c.y + (s.y - c.y) * f + sag;
        const ang = Math.atan2(s.y - c.y, s.x - c.x) + (i % 2 ? Math.PI / 2 : 0);
        ctx2d.beginPath();
        ctx2d.ellipse(lx, ly, 4, 2.4, ang, 0, Math.PI * 2);
        ctx2d.stroke();
      }
      ctx2d.restore();
    }
  }

  // Timer rings, one per active status. Thicker and glowing now — at 2px flat they were the
  // ONLY player-side visual and still barely registered; as rings over a proper tell they only
  // need to answer "how much longer", but they should at least be legible while doing it.
  let ring = 0;
  for (const [kind, until] of Object.entries(p.afflict)) {
    if (!(until > now)) continue;
    const ab = ELITE_ABILITY[kind];
    if (!ab) continue;
    const rr = r + 8 + ring * 5;
    // Fades as it expires, so the ring doubles as the timer. Denominator is the PER-ABILITY
    // duration — the shortened ones (burn/poison/tether) must still start as a full ring.
    const left = Math.min(1, (until - now) / (eliteStatusSeconds(kind) * 1000));
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'lighter';
    ctx2d.globalAlpha = 0.2 + 0.25 * left;
    ctx2d.strokeStyle = ab.color;
    ctx2d.lineWidth = 5;
    ctx2d.beginPath(); ctx2d.arc(c.x, c.y, rr, 0, Math.PI * 2 * left); ctx2d.stroke();
    ctx2d.restore();
    ctx2d.save();
    ctx2d.globalAlpha = 0.5 + 0.5 * left;
    ctx2d.strokeStyle = ab.color;
    ctx2d.lineWidth = 2.4;
    ctx2d.beginPath(); ctx2d.arc(c.x, c.y, rr, 0, Math.PI * 2 * left); ctx2d.stroke();
    ctx2d.restore();
    ring++;
  }
}

/**
 * The rock itself.
 *
 * Drawn as a stack of three offset discs per boulder — a dark cast shadow, the body, and a lit
 * cap pushed up-left — which reads as a solid mass catching the torchlight from above without
 * needing any art. Ridges come out as one continuous mound for free, because their circles
 * overlap and the caps merge.
 *
 * Culled per rock: at 100+ boulders across a 3000px arena only a handful are ever on screen.
 */
/**
 * The stage floor's HSV VALUE (0..1), cached per stage. Kept for other floor-derived tints.
 *
 * Measured from the art rather than written down, so rock automatically belongs to whatever
 * floor is installed — swapping the tile re-colours the terrain with no second edit, which is
 * exactly the drift that a hardcoded hex invites.
 *
 * Downsampling to 1x1 and reading that pixel IS the average: the browser's own box filter does
 * the summing, in C, instead of a JavaScript loop over a million pixels.
 * @type {Map<string, number>}
 */
const floorAvgCache = new Map();

/**
 * HSV to a css rgb() string. h in degrees, s and v in 0..1.
 *
 * Written out rather than reached for via a filter or a canvas round-trip because this runs once
 * per stage and the result is cached — and because HSV is the space the two rock dials are
 * authored in, so converting anywhere else would put a second definition of "hue" in the code.
 */
/** HSV to three 0-255 channels. Split out of hsvToRgbCss so callers that need an alpha can
 *  build their own rgba() instead of taking one apart again. */
function hsvToRgb(h, s, v) {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  const to255 = (n) => Math.max(0, Math.min(255, Math.round((n + m) * 255)));
  return [to255(r1), to255(g1), to255(b1)];
}
function hsvToRgbCss(h, s, v) {
  const [r, g, b] = hsvToRgb(h, s, v);
  return `rgb(${r},${g},${b})`;
}
function floorAverageColor(stageDef) {
  const key = stageDef.floorTile || stageDef.id;
  const hit = floorAvgCache.get(key);
  if (hit !== undefined) return hit;   // 0 is a real value for a black floor, so test presence
  // The PROCESSED floor, not the raw art. makeFloorCanvas applies the stage's contrast and its
  // `floorTileDim` knock-down before the tile ever reaches the screen — stage 2 dims by 0.4 —
  // so averaging the source file answers the wrong question. Stage 1 happens to have no dim,
  // which is exactly why sampling the raw image looked correct and would have shipped a glaring
  // mismatch the moment anyone walked into the desert.
  const floor = makeFloorCanvas(stageDef);
  if (!floor) return 0.14;                     // tile not decoded yet; ask again next frame
  const c = document.createElement('canvas');
  c.width = 1; c.height = 1;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.drawImage(floor, 0, 0, 1, 1);
  const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
  // Neutral grey, lifted a FIXED number of steps above the floor's HSV value.
  //
  // Desaturating in HSV is what keeps "grey" separate from "brighter": saturation drops to zero
  // without touching lightness. V is the max channel by definition, so a fully desaturated
  // colour is just that max on all three.
  //
  // The lift is absolute rather than proportional, and that is the whole lesson here. This floor
  // has a value of ~0.14, so every percentage version of this — +10%, +15% — moved the rock two
  // or three RGB steps and stayed invisible. `rockLift` is on a slider so the number is yours to
  // set by eye instead of mine to guess.
  const v = Math.max(r, gg, b) / 255;
  // The floor's own brightness, cached. The lift and the per-rock variance are applied at draw
  // time in rockStroke() so their sliders take effect without rebuilding this.
  const out = v;
  floorAvgCache.set(key, out);
  return out;
}

/**
 * Rock is now BLACK — the same `#050403` the out-of-bounds wall is filled with — so an outcrop
 * reads as the boundary's darkness pushing up through the floor rather than as a third material
 * floating between them.
 */
const ROCK_FILL = '#050403';

/**
 * The outline that does all the work now the fill is flat black. The per-stage colour dials
 * still drive it — Brightness becomes how strongly the edge catches the light, Hue and
 * Saturation what colour that light is, and the per-rock jitter keeps a field of them from
 * looking stamped. `a` is the pass alpha: one wide soft stroke, one crisp hairline.
 */
function rockStroke(c, a) {
  // rockLift is authored in 0-255 steps above the floor; as an edge it maps to how bright the
  // stroke is, floored so a stage that dialled lift to nothing still shows its silhouette.
  const v = Math.max(0.22, Math.min(1, (c.rockLift + 40) / 160));
  const hue = c.rockHue;
  const [r, g, b] = hsvToRgb(hue, c.rockSat, v);
  return `rgba(${r},${g},${b},${a})`;
}

/** The colour set for the stage on screen. Endless inherits stage 3's — same arena, same rock. */
function terrainColors() {
  const stageDef = STAGES[S.currentStage];
  return TERRAIN_COLOR_TUNE[stageDef && stageDef.id] || TERRAIN_COLOR_TUNE.graveyard;
}

function drawTerrain() {
  if (!terrain) return;
  const colors = terrainColors();
  // One path per FORMATION, not per rock. Overlapping rocks were each filled and stroked in
  // turn, so their internal edges crossed the shape and one outcrop read as three blobs sharing
  // a shadow; the union outline (traced once at generation — see buildOutlines in terrain.js)
  // makes it a single continuous silhouette. Rocks still collide as circles; only the picture
  // is merged.
  for (const g of terrain.outlines) {
    const c = worldToScreen(g.cx, g.cy);
    if (!onScreen(c.x, c.y, g.radius + 60)) continue;
    ctx2d.beginPath();
    for (const ring of g.rings) {
      for (let i = 0; i < ring.length; i++) {
        const sp = worldToScreen(ring[i].x, ring[i].y);
        i ? ctx2d.lineTo(sp.x, sp.y) : ctx2d.moveTo(sp.x, sp.y);
      }
      ctx2d.closePath();
    }
    // Filled with the WALL's exact black. The old fill was a grey lifted off the floor's average
    // brightness, which made rock a third material sitting between the floor and the boundary —
    // three values on screen where the world only has two. Now an outcrop IS the out-of-bounds
    // dark pushing up through the floor, and the edge is what separates it from the ground.
    ctx2d.fillStyle = ROCK_FILL;
    // even-odd, not the nonzero default: a formation can legitimately trace an inner ring (a
    // gap enclosed by a ring of boulders), and even-odd renders that as the hole it is instead
    // of depending on which way the tracer happened to wind it.
    ctx2d.fill('evenodd');
    // Two strokes, the same dark-body/bright-edge grammar the void flames and the thunderbolt
    // use: a soft wide glow so the edge reads against a dark floor at all, and a crisp hairline
    // on top so the shape stays sharp at play size.
    ctx2d.save();
    ctx2d.strokeStyle = rockStroke(colors, 0.16);
    ctx2d.lineWidth = 3.5;
    ctx2d.stroke();
    ctx2d.strokeStyle = rockStroke(colors, 0.8);
    ctx2d.lineWidth = 1.2;
    ctx2d.stroke();
    ctx2d.restore();
  }
}

function drawTorchlight() {
  const [tr, tg, tb] = STAGES[S.currentStage].glowTint;
  const cx = viewW / 2, cy = viewH / 2;
  const r = Math.min(viewW, viewH) * 0.56;
  const glow = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, r);
  glow.addColorStop(0, `rgba(${tr},${tg},${tb},0)`);
  glow.addColorStop(0.55, `rgba(${tr},${tg},${tb},0)`);
  glow.addColorStop(1, `rgba(${Math.round(tr * 0.6)},${Math.round(tg * 0.6)},${Math.round(tb * 0.6)},0.55)`);
  ctx2d.fillStyle = glow;
  ctx2d.fillRect(0, 0, viewW, viewH);
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
  if (s.x < -60 || s.x > viewW + 60 || s.y < -60 || s.y > viewH + 60) return;
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

// Enemies draw in three passes rather than one, because the sprite in the middle is batched on
// the GPU with every other sprite in the frame. Splitting the work this way is what lets the
// whole cast collapse into a handful of draw calls.
//
// The passes share a screen position computed ONCE, in drawEnemyUnder, and cached on the
// entity. Recomputing it per pass would re-read performance.now() for the hover bob and let
// the firelight glow drift a fraction of a pixel away from the sprite it belongs to.
//
// One deliberate change in appearance: hp bars and status effects now paint after ALL sprites
// rather than being interleaved, so a wounded enemy's bar is no longer hidden behind whichever
// monster happens to be drawn after it. Overlapping crowds read better for it.

function drawEnemyUnder(e) {
  const s = worldToScreen(e.x, e.y);
  e._vis = !(s.x < -80 || s.x > viewW + 80 || s.y < -80 || s.y > viewH + 80);
  if (!e._vis) return;
  // AFTER the screen position is computed, not before: reading e._sx at the top of this
  // function gets last frame's value, and nothing at all on the first frame an enemy is seen.
  // Flames tinted by the body's power, so which of the four it is reads off the silhouette
  // before it has done anything. A tethered pair also shows its live wire from under the
  // bodies, drawn here in the UNDER pass so the enemies stand on top of their own line.
  if (e.voidAfflicted) {
    const pw = e.voidPower && VOID_POWER[e.voidPower];
    drawVoidFlames(s.x, s.y, e.radius, e.id, pw ? { tint: pw.color } : {});
    if (e.voidPower === 'tether' && e.voidLink && !e.voidLink.dead && e.id < e.voidLink.id) {
      drawVoidTether(s, worldToScreen(e.voidLink.x, e.voidLink.y), e.id);
    }
  }
  // The wind-up used to be a bold ring at the slam radius. It has been replaced by the boss
  // hauling a greatsword back and whipping it round (drawBossGreatsword, in the over-pass), so
  // what remains down here is only the ground the sweep will cover — a faint scorch that fills
  // in as the swing loads. The blade is drawn to reach exactly this far, so the sword IS the
  // telegraph and this is just the floor reading of it.
  if (e.isBoss && e.slamState === 'telegraph') {
    const p = 1 - e.slamTimer / e.slamTelegraph;
    const n = parseInt(e.color.slice(1), 16);
    const rgb = `${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff}`;
    ctx2d.save();
    ctx2d.translate(s.x, s.y);
    ctx2d.scale(1, GREATSWORD_SQUASH);            // the reach lies flat on the ground
    const fill = ctx2d.createRadialGradient(0, 0, e.slamRadius * 0.25, 0, 0, e.slamRadius);
    fill.addColorStop(0, `rgba(${rgb},0)`);
    fill.addColorStop(1, `rgba(${rgb},${0.05 + 0.16 * p})`);
    ctx2d.fillStyle = fill;
    ctx2d.beginPath(); ctx2d.arc(0, 0, e.slamRadius, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.strokeStyle = `rgba(${rgb},${0.18 + 0.35 * p})`;
    ctx2d.lineWidth = 2;
    ctx2d.beginPath(); ctx2d.arc(0, 0, e.slamRadius, 0, Math.PI * 2); ctx2d.stroke();
    ctx2d.restore();
  }
  // Drawn UNDER the body, so the heat reads as coming off the thing rather than as a film laid
  // over its face. Additive, so a knot of pressured bodies glows brighter than any one of them.
  if (e.pressure > 0.02) drawPressureAura(s.x, s.y, e.radius, e.pressure);
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
  e._sx = s.x; e._sy = s.y;
}

// Walk cycles are driven off one global clock, so without an offset every monster on screen
// plants the same foot on the same frame and a crowd reads as a single mechanical organism.
//
// The offset is DERIVED FROM THE ENEMY'S id rather than rolled at spawn. Enemies are built in
// four separate places (the wave spawner, the boss, slime splits and the sandbox grid) with no
// shared constructor, so a field assigned at construction would have to be added four times
// and would be silently missed by the fifth. Every path already assigns a unique id.
//
// It must also be stable frame to frame — a fresh Math.random() each draw would make the
// sprite flicker between its frames rather than animate.
//
// 137 is coprime with the span, so sequential ids walk the whole range instead of falling into
// a short repeating cycle — which matters most for the sandbox grid, where ids are contiguous.
const ANIM_PHASE_SPAN = 2000; // ms; comfortably longer than any sprite's full cycle
const animPhase = (id) => (id * 137) % ANIM_PHASE_SPAN;

// Hop cycle for enemies that bounce instead of walking (slimes). Purely cosmetic: the body
// leaves the ground and squashes on landing, but the hitbox never moves, so what you can hit
// is exactly where the creature is standing. A hopping hitbox would make a slime untouchable
// at the top of its arc, which is not the intent.
//
// Phased off animPhase(e.id) like the walk cycles, so a pack of slimes does not bounce in
// lockstep — the same reason and the same source of stagger.
const HOP_PERIOD = 880;    // ms for one full hop
const HOP_AIR = 0.56;      // fraction of the cycle spent off the ground
const HOP_HEIGHT = 0.34;   // peak lift, as a fraction of the drawn height
const HOP_STRETCH = 0.13;  // how much it narrows and lengthens at the top of the arc
const HOP_SQUASH = 0.26;   // how flat it goes on impact

// Each hopper gets its own offset, rolled once and spread across a full two seconds — more
// than two hop cycles, so the pack scatters across the whole loop rather than clustering.
//
// Rolled lazily on first draw rather than at spawn, because enemies are constructed in four
// separate places with no shared constructor (see animPhase's note); assigning it here means
// every path gets it and none can silently miss it. Once set it never changes, so the hop
// stays continuous instead of flickering to a new point in the arc each frame.
const HOP_PHASE_SPAN = 2000; // ms

function hopPose(e) {
  if (e.hopPhase === undefined) e.hopPhase = Math.random() * HOP_PHASE_SPAN;
  const t = ((performance.now() + e.hopPhase) % HOP_PERIOD) / HOP_PERIOD;
  if (t < HOP_AIR) {
    const arc = Math.sin((t / HOP_AIR) * Math.PI);   // 0 -> 1 -> 0 over the flight
    return { lift: arc * HOP_HEIGHT, sx: 1 - HOP_STRETCH * arc, sy: 1 + HOP_STRETCH * arc };
  }
  // Grounded. Deepest right at touchdown and easing out from there, so the squash reads as an
  // impact rather than a slow crouch — the step change at the moment of landing is the point.
  const g = (t - HOP_AIR) / (1 - HOP_AIR);
  const squash = HOP_SQUASH * Math.pow(1 - g, 1.6);
  return { lift: 0, sx: 1 + squash, sy: 1 - squash };
}

function drawEnemySprite(e) {
  if (!e._vis) return;
  // The Long Dark hides what it empowers. Bosses stay visible regardless — a boss you cannot see
  // is not tense, it is a coin flip, and the relic is meant to change how you read a crowd.
  // Tier 2 briefly reveals the next foe after an unseen kill, via `darkRevealUntil`.
  if (relicAt('thelongdark') && !e.isBoss && !litByTorch(e)
      && !(e.darkRevealUntil > performance.now())) return;
  // displayScale lets a single monster be resized visually without touching its radius — the
  // radius is its hitbox and its collision footprint, so scaling art through it would quietly
  // change how the enemy plays.
  const size = e.radius * (e.isBoss ? 2.8 : 3.8) * MONSTER_SPRITE_SCALE * spriteScale(e.spriteId);
  let y = e._sy, sx = 1, sy = 1;
  if (e.hops) {
    const pose = hopPose(e);
    sx = pose.sx; sy = pose.sy;
    // Two vertical corrections, and both are needed. The lift raises the body off the ground;
    // the second term re-plants it, because the quad is centred on y — scaling its height
    // alone would shrink it from the feet as well as the head and leave a squashed slime
    // hovering. Pushing the centre down by half the height it lost keeps its base on the floor.
    y = e._sy - size * pose.lift + (size * (1 - sy)) / 2;
  }
  spriteLayer.sprite(e.spriteId, e._sx, y, size, e.facingLeft, e.viewDir || 'side',
    animPhase(e.id), false, 1, sx, sy);
}

// ---------- Miniboss weapons ----------
// Three hand-drawn implements, one per keeper. All animate off the miniboss state machine:
// carried at ease while idle, raised or spun through the telegraph, so the weapon IS the cast
// bar — the same lesson as the boss hauling his greatsword back.
function drawMinibossWeapon(e, sx, sy) {
  const tele = e.mbState === 'telegraph';
  // 0→1 through the telegraph, 0 otherwise.
  const k = tele ? clamp(1 - e.mbTimer / MB_TELEGRAPH, 0, 1) : 0;
  const tm = performance.now() / 1000;
  ctx2d.save();
  if (e.mbWeapon === 'shovel') {
    // A long-hafted casket shovel, resting over the shoulder; the telegraph swings it up
    // overhead, blade skyward, and the mounds erupt when it comes down.
    ctx2d.translate(sx + e.radius * 0.55, sy - e.radius * 0.1);
    ctx2d.rotate(-0.65 - k * 1.5 + Math.sin(tm * 1.3) * 0.04);
    const len = e.radius * 2.1;
    ctx2d.fillStyle = '#3a2c1c';                                  // haft
    ctx2d.fillRect(-2.2, -len, 4.4, len * 1.12);
    ctx2d.fillStyle = '#8a9098';                                  // the blade
    ctx2d.beginPath();
    ctx2d.moveTo(-8, -len); ctx2d.lineTo(8, -len);
    ctx2d.lineTo(6, -len - 16); ctx2d.lineTo(0, -len - 22); ctx2d.lineTo(-6, -len - 16);
    ctx2d.closePath(); ctx2d.fill();
    ctx2d.fillStyle = '#c8cdd4';                                  // lit edge
    ctx2d.fillRect(-8, -len - 2, 16, 2.4);
  } else if (e.mbWeapon === 'khopesh') {
    // Twin sickle-swords. At ease they hang crossed at her sides; the telegraph and the dash
    // whirl them around the body — the orbit radius is the warning about the orbit to come.
    const spin = e.mbState === 'dash' ? tm * 13 : tm * (1.2 + k * 6);
    const orbit = e.radius * (0.85 + k * 0.45 + (e.mbState === 'dash' ? 0.6 : 0));
    for (let b = 0; b < 2; b++) {
      const a = spin + b * Math.PI;
      const bx = sx + Math.cos(a) * orbit, by = sy + Math.sin(a) * orbit * 0.7;
      ctx2d.save();
      ctx2d.translate(bx, by);
      ctx2d.rotate(a + Math.PI / 2);
      ctx2d.strokeStyle = '#b8bec6'; ctx2d.lineWidth = 3.4; ctx2d.lineCap = 'round';
      ctx2d.beginPath(); ctx2d.arc(0, -6, 13, -Math.PI * 0.15, Math.PI * 0.75); ctx2d.stroke();
      ctx2d.strokeStyle = '#e2e6ea'; ctx2d.lineWidth = 1.2;
      ctx2d.beginPath(); ctx2d.arc(0, -6, 13, -Math.PI * 0.15, Math.PI * 0.75); ctx2d.stroke();
      ctx2d.fillStyle = '#5c4630';                                // grip
      ctx2d.fillRect(-1.8, 4, 3.6, 9);
      ctx2d.restore();
    }
  } else if (e.mbWeapon === 'hook') {
    // The hook at rest, dangling from a fist-length of chain and swaying with the walk. During
    // the telegraph the sway winds up into a fast circle — a sling being loaded.
    const hang = tele ? tm * 9 : tm * 1.7;
    const sway = tele ? 14 + k * 10 : 9;
    const hx = sx - e.radius * 0.6 + Math.sin(hang) * sway;
    const hy = sy + e.radius * 0.35 + Math.abs(Math.cos(hang)) * 4 + 10;
    ctx2d.strokeStyle = 'rgba(201,88,74,0.9)'; ctx2d.lineWidth = 1.5;
    const cx0 = sx - e.radius * 0.6, cy0 = sy + e.radius * 0.1;
    for (let i = 0; i < 3; i++) {
      const f = (i + 0.5) / 3;
      const lx = cx0 + (hx - cx0) * f, ly = cy0 + (hy - cy0) * f;
      ctx2d.beginPath(); ctx2d.ellipse(lx, ly, 3.6, 2.2, Math.atan2(hy - cy0, hx - cx0) + (i % 2 ? Math.PI / 2 : 0), 0, Math.PI * 2); ctx2d.stroke();
    }
    ctx2d.translate(hx, hy);
    ctx2d.rotate(Math.sin(hang) * 0.4);
    ctx2d.strokeStyle = '#c9cdd4'; ctx2d.lineWidth = 3; ctx2d.lineCap = 'round';
    ctx2d.beginPath(); ctx2d.arc(0, 4, 8, -0.4, Math.PI * 1.15); ctx2d.stroke();
  }
  ctx2d.restore();
}

// ---------- Boss greatsword ----------
// Stand-in art, drawn from shapes until a real blade exists. Kept as one rotated polygon set so
// swapping in a sprite later means replacing the body of drawGreatswordBlade and nothing else.
//
// The blade is sized to the boss's own slamRadius, so what the sword can reach and what the
// attack actually damages are the same distance by construction — the reason the old telegraph
// ring could be dropped without leaving the player guessing.
const GREATSWORD_SQUASH = 0.62;    // top-down foreshortening, same as the portal's swirl
const GREATSWORD_SWING = 0.34;     // seconds for the whip-round once the wind-up ends
const GREATSWORD_WIND = Math.PI * 0.75;   // how far back it is hauled before the strike

/** The blade itself, in local space: grip at the origin, pointing +X, `len` long. */
// One set of metals for every weapon in the game. The greatsword, the player's sword and the
// scythe were each drawn separately and had drifted into three different-looking alloys; sharing
// the palette AND the treatment below is what makes them read as one armoury.
const STEEL = { face: '#c2cad4', body: '#8d96a3', fuller: '#5d6572', line: '#2c3138', hone: '#f0f5fb' };
const FITTINGS = { grip: '#2b2119', wrap: '#4a3826', guard: '#7d6a3c', guardLit: '#9c874e', pommel: '#6b5a34' };

/**
 * A straight blade in local space: hilt at the origin, point at (len, 0).
 *
 * What makes it read as steel rather than a grey wedge — and what all three weapons now share —
 * is a taper to the point, a LIT FACE on the upper half only, a fuller down the middle, and a
 * dark keyline around the whole silhouette so it holds its shape against a busy floor.
 *
 * @param {CanvasRenderingContext2D} g
 * @param {number} len
 * @param {object} [o]
 * @param {number} [o.width]  blade width at the shoulder; defaults to a heavy two-hander
 * @param {number} [o.hilt]   how far out from the origin the steel actually starts (the fist)
 * @param {number} [o.guard]  half-length of the crossguard, 0 for none
 * @param {number} [o.grip]   length of grip drawn behind the hand, 0 for none
 * @param {number} [o.glow]   0..1 hot edge highlight
 */
function drawBladeShape(g, len, o = {}) {
  const w = o.width === undefined ? Math.max(9, len * 0.115) : o.width;
  const hilt = o.hilt === undefined ? 0 : o.hilt;
  const guard = o.guard === undefined ? w * 1.5 : o.guard;
  const grip = o.grip === undefined ? len * 0.2 : o.grip;
  const tip = len;
  const outline = () => {
    g.beginPath();
    g.moveTo(hilt, -w * 0.5); g.lineTo(tip - w * 0.9, -w * 0.34);
    g.lineTo(tip, 0);
    g.lineTo(tip - w * 0.9, w * 0.34); g.lineTo(hilt, w * 0.5);
    g.closePath();
  };
  if (grip > 0) {
    g.fillStyle = FITTINGS.grip;
    g.fillRect(hilt - grip, -w * 0.22, grip, w * 0.44);
    // Cord wrap: two bands, enough that the grip is not just a dark bar.
    g.fillStyle = FITTINGS.wrap;
    g.fillRect(hilt - grip * 0.72, -w * 0.24, Math.max(1, grip * 0.15), w * 0.48);
    g.fillRect(hilt - grip * 0.42, -w * 0.24, Math.max(1, grip * 0.15), w * 0.48);
    g.fillStyle = FITTINGS.pommel;
    g.beginPath(); g.arc(hilt - grip, 0, w * 0.36, 0, Math.PI * 2); g.fill();
  }
  if (guard > 0) {
    g.fillStyle = FITTINGS.guard;
    g.fillRect(hilt - w * 0.22, -guard, w * 0.5, guard * 2);
    g.fillStyle = FITTINGS.guardLit;                 // lit edge, same light as the blade face
    g.fillRect(hilt - w * 0.22, -guard, w * 0.5, Math.max(1, guard * 0.22));
  }
  outline();
  g.fillStyle = STEEL.body; g.fill();
  g.beginPath();                                      // lit face, upper half only
  g.moveTo(hilt, -w * 0.5); g.lineTo(tip - w * 0.9, -w * 0.34);
  g.lineTo(tip - w * 0.9, 0); g.lineTo(hilt, 0);
  g.closePath();
  g.fillStyle = STEEL.face; g.fill();
  g.fillStyle = STEEL.fuller;
  g.fillRect(hilt + w * 0.6, -w * 0.1, Math.max(0, tip - hilt - w * 1.8), w * 0.2);
  outline();
  g.strokeStyle = STEEL.line; g.lineWidth = 2; g.stroke();
  if (o.glow > 0) {
    g.globalAlpha = o.glow;
    g.strokeStyle = '#ffd9a0'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(hilt + w, -w * 0.42); g.lineTo(tip - w * 0.6, -w * 0.28); g.stroke();
    g.globalAlpha = 1;
  }
}

/**
 * A crescent scythe head, swept around a pivot at the origin. Arc space rather than local space:
 * a scythe's edge follows the circle it is cutting, which is the whole point of the shape.
 * Same steel and the same keyline as the blades above.
 */
function drawCrescentBlade(g, r, a0, a1, o = {}) {
  const thick = o.thick === undefined ? r * 0.2 : o.thick;
  const M = o.palette || STEEL;
  // Tapered: full thickness at the heel, drawn to nothing at the tip. A constant-width crescent
  // reads as a ring segment; the taper is what makes it a blade.
  const steps = 14;
  const inner = [];
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + (a1 - a0) * t;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    const ir = r - thick * (1 - t) * (1 - t * 0.35);
    inner.push([Math.cos(a) * ir, Math.sin(a) * ir]);
  }
  for (let i = inner.length - 1; i >= 0; i--) g.lineTo(inner[i][0], inner[i][1]);
  g.closePath();
  g.fillStyle = M.body; g.fill();
  g.strokeStyle = M.line; g.lineWidth = 2; g.stroke();
  // Honed outer edge — the cutting side, catching the light.
  g.strokeStyle = M.hone; g.lineWidth = 2;
  g.beginPath(); g.arc(0, 0, r - 1, a0, a1); g.stroke();
  // A softer inner highlight so the body of the crescent is not one flat grey.
  g.strokeStyle = M.face; g.lineWidth = Math.max(1.5, thick * 0.28);
  g.beginPath(); g.arc(0, 0, r - thick * 0.42, a0 + (a1 - a0) * 0.12, a1 - (a1 - a0) * 0.06); g.stroke();
}

/** The boss's two-hander: the heavy end of the same range. */
function drawGreatswordBlade(g, len, glow) {
  // Deliberately heavy — this is a greatsword, and the top-down squash at the call site
  // flattens it further, so a "correct" thickness reads as a rapier in play.
  drawBladeShape(g, len, { glow });
}

// Akhmet's scythe. The player's shape in a different metal: near-black iron with a cold
// highlight instead of a warm one, so it reads as the same class of weapon turned against you
// rather than as a recolour of his own sprite.
const BLACK_IRON = { face: '#4a4550', body: '#221f27', fuller: '#15131a', line: '#08070a', hone: '#b9a7d6' };

/**
 * A jagged haft, drawn from the fist out to the head. Not a straight stroke: the shaft kinks
 * along its length like something grown or broken rather than turned, which is what separates
 * his weapon from the player's clean timber snath at a glance.
 */
function drawJaggedHaft(g, len) {
  const segs = 7;
  const pts = [[-len * 0.16, 0]];
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    // Alternating kick, growing toward the head so the crooked end is the business end.
    pts.push([len * 0.86 * t - len * 0.16, (i % 2 ? 1 : -1) * len * 0.035 * t]);
  }
  const stroke = (color, width) => {
    g.strokeStyle = color; g.lineWidth = width;
    g.lineJoin = 'miter'; g.lineCap = 'butt';
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  };
  stroke(BLACK_IRON.line, 8);      // keyline first, so the shaft holds against the sand
  stroke('#2a2430', 5.5);
  stroke('#4b4356', 1.6);          // narrow lit side
  // Barbs along the shaft, on the outside of each kink.
  g.fillStyle = '#1a1720';
  for (let i = 2; i < pts.length - 1; i += 2) {
    const [x, y] = pts[i];
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len * 0.03, y + (i % 4 ? -1 : 1) * len * 0.05);
    g.lineTo(x + len * 0.06, y);
    g.closePath(); g.fill();
  }
}

/** Akhmet's black scythe, swept around the pivot. Mirrors the player's scythe geometry. */
function drawBlackScythe(g, len, glow) {
  drawJaggedHaft(g, len);
  // Iron collar at the join, matching the player's scythe construction.
  g.fillStyle = '#2a2430';
  g.fillRect(len * 0.66, -5, 10, 10);
  g.fillStyle = '#4b4356';
  g.fillRect(len * 0.66, -5, 10, 2.5);
  // The head. Already rotated into the swing by the caller, so these angles are relative to
  // the direction of travel: heel just behind the haft, tip leading the cut.
  drawCrescentBlade(g, len * 0.98, -0.1, 0.66, { thick: len * 0.2, palette: BLACK_IRON });
  if (glow > 0) {
    g.globalAlpha = glow * 0.8;
    g.strokeStyle = '#c9a8f0'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(0, 0, len * 0.98 - 1, -0.1, 0.66); g.stroke();
    g.globalAlpha = 1;
  }
}

// Which armament each boss swings, keyed by the `weapon` on its stage definition.
const BOSS_WEAPONS = { greatsword: drawGreatswordBlade, blackScythe: drawBlackScythe };

/**
 * The boss's slam, as a sword. Wind-up hauls the blade back and up; the strike whips it a full
 * turn around him. A full circle, not a directional arc, because the damage is radial — the
 * animation has to cover everything the attack actually hits or it teaches the wrong lesson.
 */
function drawBossGreatsword(e, sx, sy) {
  const swinging = (e.swingT || 0) > 0;
  if (e.slamState !== 'telegraph' && !swinging) return;
  const aim = Math.atan2((e.slamY ?? S.player.y) - e.y, (e.slamX ?? S.player.x) - e.x);
  const len = e.slamRadius;
  let ang, lift, glow, trail = 0;
  if (swinging) {
    const k = 1 - e.swingT / GREATSWORD_SWING;
    const ease = 1 - Math.pow(1 - k, 2.2);           // fast out of the wind-up, easing at the end
    ang = aim - GREATSWORD_WIND + Math.PI * 2 * ease;
    lift = (1 - k) * 6;
    glow = 1 - k;
    trail = ease;
  } else {
    const p = 1 - e.slamTimer / e.slamTelegraph;     // 0 -> 1 across the wind-up
    ang = aim - GREATSWORD_WIND * (0.35 + 0.65 * p);
    lift = 10 * p + Math.sin(p * 42) * p * 1.5;      // rises, with a tremble as it loads
    glow = p * 0.7;
  }

  ctx2d.save();
  ctx2d.translate(sx, sy - e.radius * 0.45 - lift);
  ctx2d.scale(1, GREATSWORD_SQUASH);

  // Motion trail: the wedge already swept this pass, fading behind the blade.
  if (trail > 0) {
    const from = aim - GREATSWORD_WIND;
    ctx2d.beginPath();
    ctx2d.moveTo(0, 0);
    ctx2d.arc(0, 0, len, from, ang);
    ctx2d.closePath();
    const tg = ctx2d.createRadialGradient(0, 0, len * 0.2, 0, 0, len);
    tg.addColorStop(0, 'rgba(255,225,180,0)');
    tg.addColorStop(1, `rgba(255,225,180,${0.3 * (1 - trail)})`);
    ctx2d.fillStyle = tg; ctx2d.fill();
    ctx2d.strokeStyle = `rgba(255,240,210,${0.55 * (1 - trail)})`;
    ctx2d.lineWidth = 3;
    ctx2d.beginPath(); ctx2d.arc(0, 0, len, from, ang); ctx2d.stroke();
  }

  ctx2d.rotate(ang);
  (BOSS_WEAPONS[e.weapon] || drawGreatswordBlade)(ctx2d, len, glow);
  ctx2d.restore();
}

function drawEnemyOver(e) {
  if (!e._vis) return;
  const sx = e._sx, sy = e._sy;
  const nowMs = performance.now();
  if (e.poisonUntil && e.poisonUntil > nowMs) drawPoisonStatus(sx, sy, e.radius, e);
  if (e.burnUntil && e.burnUntil > nowMs) drawBurningStatus(sx, sy, e.radius);
  if (e.frozenUntil && e.frozenUntil > nowMs) drawFrozenStatus(sx, sy, e);
  else if (e.slowUntil && e.slowUntil > nowMs) drawFrostStatus(sx, sy, e.radius);
  if (e.shockUntil && e.shockUntil > nowMs) drawShockStatus(sx, sy, e.radius, e.id);
  if (e.voidUntil && e.voidUntil > nowMs) drawVoidStatus(sx, sy, e.radius, e.id);
  // Elites get a boss-width bar that is ALWAYS shown, in their ability's colour. A bar that
  // only appears once chipped is fine for a mob you delete instantly; on something you have to
  // fight for ten seconds, the bar is how you know it is worth fighting.
  if (e.isElite) hpBar(sx, sy - e.radius - 14, e.isMiniboss ? 96 : 64, e.hp / e.maxHp, e.abilityColor);
  else if (e.hp < e.maxHp) hpBar(sx, sy - e.radius - 12, e.isBoss ? 70 : e.radius * 2.2, e.hp / e.maxHp, e.isBoss ? '#a13328' : '#7a1f1a');
  if (e.isElite) {
    ctx2d.font = "14px 'Pixelify Sans', sans-serif";
    ctx2d.textAlign = 'center';
    ctx2d.lineWidth = 4; ctx2d.strokeStyle = '#000';
    ctx2d.strokeText(e.eliteName, sx, sy - e.radius - 22);
    ctx2d.fillStyle = e.abilityColor;
    ctx2d.fillText(e.eliteName, sx, sy - e.radius - 22);
  }
  if (e.isMiniboss) drawMinibossWeapon(e, sx, sy);
  // Signature-skill wind-up: a tightening ring in the boss's own colour. Distinct from the slam
  // telegraph (a ground circle where the blow will land) — this one wraps the CASTER, because
  // what is coming is not positional and the useful information is "he is doing something".
  if (e.isBoss && e.bsState === 'telegraph') {
    const k = 1 - clamp(e.bsTimer / BOSS_SKILL_TELEGRAPH, 0, 1);
    const rr = e.radius * (2.2 - 1.0 * k);
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'lighter';
    ctx2d.strokeStyle = e.color || '#c9a227';
    ctx2d.globalAlpha = 0.25 + 0.55 * k;
    ctx2d.lineWidth = 3 + 3 * k;
    ctx2d.beginPath(); ctx2d.ellipse(sx, sy, rr, rr * 0.7, 0, 0, Math.PI * 2); ctx2d.stroke();
    ctx2d.restore();
  }
  // Over the sprite, not under it: a greatsword this size passes in front of its wielder for
  // most of the turn, and hiding it behind the body for that half loses the whole read.
  if (e.isBoss) drawBossGreatsword(e, sx, sy);
  if (e.isBoss) {
    // Floating name tag. Pixel face and the UI red, matching the rest of the chrome, at 19px
    // (12 x 1.6). Lifted to 1.35 radii clear of the body because the old -20px offset was
    // measured against the 12px text and the taller line now sat across the boss's head.
    // Blacked out behind so it stays legible over his own sprite and the horde around him.
    ctx2d.font = "19px 'Pixelify Sans', sans-serif";
    ctx2d.textAlign = 'center';
    ctx2d.lineWidth = 4; ctx2d.strokeStyle = '#000';
    ctx2d.strokeText(e.name, sx, sy - e.radius * 1.35 - 34);
    ctx2d.fillStyle = '#c9382e';   // --chrome; KEEP IN SYNC with the palette in style.css
    ctx2d.fillText(e.name, sx, sy - e.radius * 1.35 - 34);
  }
}

// Small flame tongues licking up off a burning enemy.
// Poisoned foes get a purple tint over their sprite plus a persistent cloud of drifting
// toxic motes. Denser as poison stacks build.
// ---------- pre-rendered radial puffs ----------
// createRadialGradient builds and rasterises a brand-new gradient on every single call. That
// is fine a few dozen times a frame and ruinous at scale: with ~490 poisoned and ~490 burning
// enemies the status layer was producing roughly 5,900 gradients per frame and the game fell
// to 25 FPS (40ms) — the status effects, not the sprites, were the whole cost.
//
// A radial puff is the same picture every time, so it is rendered ONCE into a small offscreen
// canvas and blitted thereafter. One bitmap per colour recipe, reused by every instance, at
// any size and alpha. Same trick as the sprite batcher: turn rasterisation into a blit.
const puffCache = new Map();
const PUFF_R = 48; // baked once at a generous radius; blits scale down cleanly from here

function radialPuff(key, stops) {
  let c = puffCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = PUFF_R * 2;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(PUFF_R, PUFF_R, 0, PUFF_R, PUFF_R, PUFF_R);
  for (const [stop, color] of stops) g.addColorStop(stop, color);
  x.fillStyle = g;
  x.beginPath(); x.arc(PUFF_R, PUFF_R, PUFF_R, 0, Math.PI * 2); x.fill();
  puffCache.set(key, c);
  return c;
}

/** Blit a cached puff centred at (x,y). `ry` differs from `rx` for the squashed flame tongues. */
function drawPuff(key, stops, x, y, rx, ry = rx, alpha = 1) {
  const c = radialPuff(key, stops);
  if (alpha !== 1) ctx2d.globalAlpha = alpha;
  ctx2d.drawImage(c, x - rx, y - ry, rx * 2, ry * 2);
  if (alpha !== 1) ctx2d.globalAlpha = 1;
}

// Colour recipes, baked at their reference strength. Where an effect varies its opacity, the
// puff is baked at the MAXIMUM and dimmed with globalAlpha on use — the gradient is linear in
// alpha, so that reproduces the original exactly rather than approximating it.
const POISON_WASH_MAX = 0.5;
const POISON_WASH_STOPS = [[0, `rgba(150,60,190,${POISON_WASH_MAX})`],
                           [1, `rgba(96,30,140,${POISON_WASH_MAX * 0.6})`]];
const POISON_MOTE_STOPS = [[0, 'rgba(190,110,225,0.5)'], [1, 'rgba(120,40,170,0)']];
// Vapour, not a disc. The alpha stays low and the falloff starts almost immediately, so a
// single lobe is barely visible on its own — the cloud's body comes from several of them
// overlapping at different offsets and sizes. A high-alpha stop with a late falloff (what this
// used to be) reads as a flat coloured circle no matter how it is animated.
const POISON_MIST_STOPS = [[0, 'rgba(198,146,236,0.11)'], [0.3, 'rgba(158,84,200,0.072)'],
                           [0.65, 'rgba(120,46,164,0.028)'], [1, 'rgba(96,22,136,0)']];
// The lingering pool: a touch denser than the airborne splash, since it is meant to sit and
// persist rather than disperse, but still nowhere near opaque.
const POISON_POOL_STOPS = [[0, 'rgba(158,80,198,0.30)'], [0.4, 'rgba(118,50,158,0.20)'],
                           [0.75, 'rgba(88,32,122,0.075)'], [1, 'rgba(72,24,104,0)']];
// Dark, not bright — this is a stain on the floor, and keeping it dim stops the pool tripping
// the bloom threshold and blowing out into a solid glowing disc.
const POISON_STAIN_STOPS = [[0, 'rgba(46,20,60,0.46)'], [0.6, 'rgba(38,16,52,0.24)'],
                            [1, 'rgba(28,11,40,0)']];
// The Plague Doctor's Miasma runs GREEN, matching the green strip on his coat, so his own
// passive is distinguishable at a glance from a Poison Flask pool sitting next to it. Same
// recipe shape as the purple pair above, hue-shifted — nothing else about the pool changes.
const MIASMA_POOL_STOPS = [[0, 'rgba(122,198,80,0.30)'], [0.4, 'rgba(84,158,50,0.20)'],
                           [0.75, 'rgba(56,122,32,0.075)'], [1, 'rgba(44,104,24,0)']];
const MIASMA_STAIN_STOPS = [[0, 'rgba(26,52,20,0.46)'], [0.6, 'rgba(20,44,16,0.24)'],
                            [1, 'rgba(14,34,11,0)']];
const FLAME_TONGUE_STOPS = [[0, 'rgba(255,230,150,0.55)'], [0.5, 'rgba(240,120,40,0.35)'],
                            [1, 'rgba(200,40,20,0)']];

function drawPoisonStatus(sx, sy, r, e) {
  const tm = performance.now() / 1000;
  const stacks = Math.max(1, e.poisonStacks || 1);
  ctx2d.save();
  // purple overlay wash on the body
  ctx2d.globalCompositeOperation = 'source-atop';
  const strength = Math.min(POISON_WASH_MAX, 0.2 + stacks * 0.045);
  drawPuff('poisonWash', POISON_WASH_STOPS, sx, sy, r * 1.4, r * 1.4, strength / POISON_WASH_MAX);
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
    drawPuff('poisonMote', POISON_MOTE_STOPS, px, py, sz * 2.2);
  }
  ctx2d.restore();
}

// The siege mark. A body spawned while the portal stands carries the pressure it was born under,
// and wears it as a red heat that intensifies with how dangerous it actually is.
//
// The red is the UI's own chrome red (#c9382e, --chrome in style.css) rather than a fresh one:
// the timer counting up in the HUD is the same colour, so the screen reads as one warning
// instead of two unrelated ones. KEEP IN SYNC with that variable.
function drawPressureAura(sx, sy, r, p) {
  const tm = performance.now() / 1000;
  // Faster, harder pulse the more dangerous the body — the same idea as the HUD timer's pulse.
  const beat = 0.72 + 0.28 * Math.sin(tm * (5 + 9 * p) + sx * 0.05);
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  // Outer heat haze.
  drawGlow(sx, sy, '201,56,46', r * (1.9 + 0.9 * p) * beat);
  // A tighter, brighter core so a fully-pressured body reads as lit from inside rather than
  // merely standing in a red pool.
  ctx2d.globalAlpha = 0.25 + 0.5 * p;
  drawGlow(sx, sy, '255,120,90', r * (0.9 + 0.5 * p) * beat);
  ctx2d.globalAlpha = 1;
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
    // Was an ellipse with radii (h*0.45, h*0.85); the blit keeps those proportions.
    drawPuff('flameTongue', FLAME_TONGUE_STOPS, fxp, fyp, h * 0.45, h * 0.85);
  }
  ctx2d.restore();
}

// Little ice-crystal glints around a chilled/slowed enemy.
/**
 * A shocked foe: short arcs snapping across the body.
 *
 * Strokes only, no gradients — the note above this block records the status layer producing
 * ~5,900 gradients a frame and dropping the game to 25fps, and shock lands on far more enemies
 * than freeze does because every arc target gets marked too.
 *
 * Seeded off the enemy id and quantised time, so each foe crackles differently but its own
 * pattern holds for a few frames instead of strobing every one.
 */
function drawShockStatus(sx, sy, r, id) {
  const step = Math.floor(performance.now() / 70);
  ctx2d.save();
  ctx2d.strokeStyle = 'rgba(150,225,255,0.85)';
  ctx2d.lineWidth = 1.2;
  ctx2d.beginPath();
  for (let i = 0; i < 3; i++) {
    const seed = (id * 7 + i * 31 + step * 13) % 360;
    const a = (seed / 360) * Math.PI * 2;
    const a2 = a + 1.6 + ((seed % 7) / 7);
    // A two-segment kink across the body rather than a smooth arc: lightning has corners.
    const x1 = sx + Math.cos(a) * r * 0.85, y1 = sy + Math.sin(a) * r * 0.7;
    const x2 = sx + Math.cos(a2) * r * 0.85, y2 = sy + Math.sin(a2) * r * 0.7;
    const mx = (x1 + x2) / 2 + Math.cos(seed) * r * 0.35;
    const my = (y1 + y2) / 2 + Math.sin(seed) * r * 0.35;
    ctx2d.moveTo(x1, y1); ctx2d.lineTo(mx, my); ctx2d.lineTo(x2, y2);
  }
  ctx2d.stroke();
  ctx2d.restore();
}

/**
 * A void-marked foe: a dark ring drawn INWARD, tightening as the mark ages.
 *
 * The mark decides whether a death collapses, so it is the one status the player most needs to
 * read before choosing a target — and it had no tell at all. Deliberately reads as absence
 * rather than glow, matching the element: a dark rim with a pale inner edge, no fill, so it
 * darkens the silhouette instead of lighting it up.
 */
function drawVoidStatus(sx, sy, r, id) {
  const t = (performance.now() / 900 + id * 0.3) % 1;
  const rr = r * (1.25 - 0.35 * t);            // collapses inward, then repeats
  ctx2d.save();
  ctx2d.strokeStyle = `rgba(18,10,36,${0.75 * (1 - t * 0.4)})`;
  ctx2d.lineWidth = 3;
  ctx2d.beginPath(); ctx2d.arc(sx, sy, rr, 0, Math.PI * 2); ctx2d.stroke();
  ctx2d.strokeStyle = `rgba(200,180,255,${0.5 * (1 - t)})`;
  ctx2d.lineWidth = 1;
  ctx2d.beginPath(); ctx2d.arc(sx, sy, rr - 1.5, 0, Math.PI * 2); ctx2d.stroke();
  ctx2d.restore();
}

/**
 * Black-and-violet fire on a Void Afflicted creature.
 *
 * Tribal-tattoo shapes rather than a particle flame: each tongue is ONE closed path built from
 * two quadratic curves that lean the same way and meet at a single sharp point. That is the
 * whole grammar of the style — a fat curved base, a hard taper, no rounded tip — and it is why
 * this reads as a marking rather than as an ordinary fire effect, which the game already has
 * three of.
 *
 * Drawn dark-first: a near-black body with a violet rim, so the flame SUBTRACTS from the
 * silhouette instead of glowing. Fire that makes an enemy brighter would fight the whole point
 * of the void, and would also make afflicted enemies easier to see rather than more ominous.
 */
/**
 * The void's tribal-tattoo fire. Two shapes out of one routine:
 *  - default, a fan across the top half — a creature wearing flames on its shoulders;
 *  - `ring`, tongues all the way round and leaning outward — a crown, used by the portal.
 * The ring case exists because the portal's swirl is squashed and dark and simply got lost on a
 * dark floor. Fire around the rim breaks its silhouette out of the ground it sits in.
 * @param {number} sx @param {number} sy @param {number} r @param {number} id
 * `tint` recolours the rim only — the body stays near-black, because the silhouette being a
 * HOLE is the whole read and a coloured fill would turn it into an ordinary glowing enemy.
 * @param {number} sx @param {number} sy @param {number} r @param {number} id
 * @param {{ ring?: boolean, tongues?: number, lenMult?: number, root?: number,
 *           spin?: number, pool?: boolean, tint?: string }} [o]
 */
function drawVoidFlames(sx, sy, r, id, o = {}) {
  const t = performance.now() / 1000;
  const rim = o.tint ? hexToRgb(o.tint) : '126,74,214';
  const core = o.tint ? lightenRgb(rim, 0.55) : '198,150,255';
  const ring = !!o.ring;
  const tongues = o.tongues || 5;
  const lenMult = o.lenMult || 1;
  // Line weights are authored against an enemy-sized body. On a portal at more than twice that
  // radius they would thin out to scratches, so they scale with the thing they are drawn on.
  const wk = Math.max(1, r / 22);
  ctx2d.save();
  for (let i = 0; i < tongues; i++) {
    // Each tongue on its own phase so they never march.
    const phase = i * 1.7 + id * 0.37;
    const lean = Math.sin(t * 2.1 + phase) * 0.42;
    // A ring spreads evenly through the full turn and may rotate; the fan spans the top half.
    const base = ring
      ? (i / tongues) * Math.PI * 2 + t * (o.spin || 0) + lean * 0.35
      : -Math.PI / 2 + (i / (tongues - 1) - 0.5) * 1.9 + lean * 0.35;
    // 60% longer: 1.35 -> 2.16 base, and the flicker term scales with it so the tongues still
    // breathe by the same proportion rather than going stiff at the new length.
    const len = r * (2.16 + 0.64 * Math.sin(t * 3.1 + phase)) * lenMult;
    const wide = r * 0.34;
    // Root of the tongue: on the body's shoulder, or out on the rim for a ring.
    const root = o.root === undefined ? 0.55 : o.root;
    const bx = sx + Math.cos(base) * r * root;
    const by = sy + Math.sin(base) * r * (ring ? root : 0.5);
    // Tip, pushed out along the tongue and curled by the lean. The upward bias is a top-fan
    // idea — on a ring it would drag every tongue northward and break the symmetry.
    const tipA = base + lean;
    const tx = bx + Math.cos(tipA) * len;
    const ty = by + Math.sin(tipA) * len - (ring ? 0 : r * 0.25);
    // The two control points sit on OPPOSITE sides of the spine and are both dragged the same
    // way — that asymmetry is what gives the hooked, carved look instead of a symmetric leaf.
    const nx = Math.cos(base + Math.PI / 2), ny = Math.sin(base + Math.PI / 2);
    const c1x = bx + nx * wide + Math.cos(tipA) * len * 0.45;
    const c1y = by + ny * wide + Math.sin(tipA) * len * 0.45;
    const c2x = bx - nx * wide * 0.7 + Math.cos(tipA) * len * 0.62;
    const c2y = by - ny * wide * 0.7 + Math.sin(tipA) * len * 0.62;
    ctx2d.beginPath();
    ctx2d.moveTo(bx + nx * wide * 0.5, by + ny * wide * 0.5);
    ctx2d.quadraticCurveTo(c1x, c1y, tx, ty);          // outward edge, bellied
    ctx2d.quadraticCurveTo(c2x, c2y, bx - nx * wide * 0.5, by - ny * wide * 0.5);
    ctx2d.closePath();
    ctx2d.fillStyle = 'rgba(10,4,20,0.95)';
    ctx2d.fill();
    // The rim carries the whole read. At 1.4px and half alpha the flames were invisible against
    // a dark floor — the shape was there and nobody could see it. Brighter, thicker, and with a
    // glow behind it, while the body stays near-black so the silhouette is still a void.
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'lighter';
    ctx2d.strokeStyle = `rgba(${rim},${0.30 + 0.16 * Math.sin(t * 4 + phase)})`;
    ctx2d.lineWidth = 5 * wk;
    ctx2d.stroke();
    ctx2d.restore();
    ctx2d.strokeStyle = `rgba(${core},${0.85 + 0.15 * Math.sin(t * 4 + phase)})`;
    ctx2d.lineWidth = 1.8 * wk;
    ctx2d.stroke();
  }
  // A dark pool under the body, tying the tongues to the creature. The portal already has its
  // own shadow and vortex, so a second black disc there would only mute the swirl.
  if (o.pool !== false) {
    ctx2d.fillStyle = 'rgba(12,5,26,0.55)';
    ctx2d.beginPath(); ctx2d.ellipse(sx, sy, r * 0.95, r * 0.7, 0, 0, Math.PI * 2); ctx2d.fill();
  }
  ctx2d.restore();
}

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

function drawMinionSprite(m) {
  const s = worldToScreen(m.x, m.y);
  m._sx = s.x; m._sy = s.y;
  // Bones are painted in the 2D overlay pass instead — there is no sprite for them, and the
  // position cache above is set first so the overlay still knows where to draw.
  if (m.reviving) return;
  // Same walk-cycle stagger as the enemies. A summoned squad is several copies of ONE sprite
  // moving together, so it shows lockstep even more plainly than a mixed crowd does. Minion
  // ids come from the same S.nextId counter as enemies, so the phases stay distinct across
  // both without any extra bookkeeping.
  // A shade has no sprite: it is a hole in the shape of what died, drawn in the overlay pass
  // with the void's own flames. Skipping the sprite layer here is what makes it read as an
  // absence rather than as a recoloured skeleton.
  if (m.type === 'shade') return;
  spriteLayer.sprite('skeletonMinion', s.x, s.y, MINION_SPRITE_H * MONSTER_SPRITE_SCALE, m.facingLeft,
    m.viewDir || 'side', animPhase(m.id));
}

function drawMinionOver(m) {
  if (m.type === 'shade') {
    // Body first — a near-black silhouette, dimming as its borrowed time runs out — then the
    // void flames over it, so a shade reads as one of THEIRS fighting for you.
    const fade = m.life !== undefined ? clamp(m.life / 1.2, 0.25, 1) : 1;
    ctx2d.save();
    ctx2d.globalAlpha = fade;
    ctx2d.fillStyle = 'rgba(8,4,18,0.88)';
    ctx2d.beginPath();
    ctx2d.ellipse(m._sx, m._sy, 11, 15, 0, 0, Math.PI * 2);
    ctx2d.fill();
    drawVoidFlames(m._sx, m._sy, 13, m.id, { tint: '#7a56d2', lenMult: 0.7, pool: false });
    ctx2d.restore();
    hpBar(m._sx, m._sy - 24, 22, m.hp / m.maxHp, '#7a56d2');
    return;
  }
  if (m.reviving) { drawBonePile(m); return; }
  // The bar rides with the sprite's height, or a taller skeleton would grow up through it.
  hpBar(m._sx, m._sy - 22 * MINION_SCALE, 22, m.hp / m.maxHp, '#6b8a52');
}

/**
 * A fallen skeleton: a low heap of bones with a ring closing around it as the revive completes.
 * Drawn as a RING rather than a bar because it is not health — a bar in the same place as every
 * other hp bar in the game would read as "this thing is nearly dead" when it means the opposite.
 * @param {any} m
 */
function drawBonePile(m) {
  const sx = m._sx, sy = m._sy;
  const total = Math.max(0.01, m.reviveTotal || 6);
  const done = clamp(1 - m.reviveTimer / total, 0, 1);
  // Rises as it nears completion, so the pile visibly gathers itself rather than sitting inert
  // for six seconds and then popping.
  const lift = done * done * 5;

  ctx2d.save();
  ctx2d.translate(sx, sy - lift);

  ctx2d.fillStyle = 'rgba(0,0,0,0.35)';
  ctx2d.beginPath(); ctx2d.ellipse(0, 4, 15, 5, 0, 0, Math.PI * 2); ctx2d.fill();

  // Three bones and a skull, laid out from the entity id so every heap is its own arrangement
  // instead of twelve identical stamps.
  const n = (m.id % 7) / 7;
  ctx2d.strokeStyle = `rgba(201,191,160,${0.55 + done * 0.4})`;
  ctx2d.lineCap = 'round';
  ctx2d.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const a = n * Math.PI + i * 1.9;
    const len = 7 + (i % 2) * 3;
    ctx2d.beginPath();
    ctx2d.moveTo(Math.cos(a) * -len, 2 + Math.sin(a) * -2.2);
    ctx2d.lineTo(Math.cos(a) * len, 2 + Math.sin(a) * 2.2);
    ctx2d.stroke();
  }
  ctx2d.fillStyle = `rgba(214,205,178,${0.7 + done * 0.3})`;
  ctx2d.beginPath(); ctx2d.arc(-2 + n * 4, -2, 4.2, 0, Math.PI * 2); ctx2d.fill();

  // The ring: unfilled arc is the wait, the closing sweep is the countdown.
  ctx2d.lineWidth = 2;
  ctx2d.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx2d.beginPath(); ctx2d.arc(0, 0, 17, 0, Math.PI * 2); ctx2d.stroke();
  ctx2d.strokeStyle = '#8fb36a';
  ctx2d.beginPath(); ctx2d.arc(0, 0, 17, -Math.PI / 2, -Math.PI / 2 + done * Math.PI * 2); ctx2d.stroke();
  ctx2d.restore();
}

// Characters render 50% larger than their 64px source art. This is a 1.5x scale, so source
// pixels no longer map 1:1 — accepted deliberately in favour of the bigger on-screen read.
const PLAYER_SPRITE_SOURCE_HEIGHT = 64;
const PLAYER_SPRITE_HEIGHT = 96;

// What a class actually stands at on screen, in logical pixels. Every player sprite is drawn to
// THIS regardless of the resolution its art was authored at — see drawPlayer for why that has to
// be stated explicitly rather than left to spriteQuad's snapping.
//
// It is 2x the 64px source rather than the 96 above because the snapping always rounded 96 up to
// the next whole multiple, so 128 is the size every class has really been rendering at since the
// art went hand-drawn. Naming it is a correction to the bookkeeping, not to the look.
// PLAYER_SPRITE_HEIGHT stays as it is: the hitbox is derived from it (see PLAYER_BASE_RADIUS)
// and folding these together would silently resize every player's collision.
const PLAYER_DRAW_HEIGHT = 128;

// How long the hit flash lasts, and how far toward pure red it pushes. 0.18s is short enough to
// read as an impact rather than a status — a longer one starts looking like the player is on
// fire, which is a different message the game already has a visual for.
const HURT_FLASH_TIME = 0.18;
const HURT_FLASH_DEPTH = 0.8;

// The hitbox is derived from the sprite scale rather than hard-coded, so scaling the art can
// never again leave the hitbox behind (it did: art went 64->96 while radius stayed 14, which
// silently shrank the player's hitbox from 44% of the sprite to 29%). Enemies get this for
// free because their sprite is drawn *from* radius; the player's sprite is a fixed height.
const PLAYER_BASE_RADIUS = 14;

// Monsters 50% up from their original radius * 3.8 (2.8 for bosses), matching the player's
// bump so relative proportions hold. Independent of PLAYER_SPRITE_HEIGHT on purpose — tying
// the two together meant changing one silently resized the other.
const MONSTER_SPRITE_SCALE = 1.5;

// Classes whose sprite hovers instead of planting on the ground. Read from the sprite def so
// it travels with the art: a character that is drawn levitating declares it once, next to the
// images, rather than needing a matching entry over here.
const FLOAT_BOB_PERIOD = 2200; // ms for a full rise-and-fall
const FLOAT_BOB_AMOUNT = 5;    // px peak-to-centre — deliberately small; it should read as
                               // breathing, not bouncing
const FLOAT_LIFT = 4;          // constant lift, so she never quite touches the floor

function drawPlayer() {
  const s = worldToScreen(S.player.x, S.player.y);
  // Bone Reassembly: no figure at all — a heap of bones on the floor, trembling harder as the
  // rebuild finishes. Same visual language as a downed minion, which is exactly the association
  // that sells "he will stand back up".
  if (S.player.reassembling > 0) {
    const k = 1 - S.player.reassembling / REASSEMBLE_TIME;   // 0 fresh, 1 nearly rebuilt
    const jit = k * k * 2.2;                                  // the pile shivers awake
    ctx2d.save();
    ctx2d.fillStyle = 'rgba(0,0,0,0.4)';
    ctx2d.beginPath(); ctx2d.ellipse(s.x, s.y + 8, 20, 8, 0, 0, Math.PI * 2); ctx2d.fill();
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4, r = 4 + (i % 3) * 5;
      const bx = s.x + Math.cos(a) * r + (Math.random() - 0.5) * jit;
      const by = s.y + Math.sin(a) * r * 0.5 + 4 + (Math.random() - 0.5) * jit;
      ctx2d.save();
      ctx2d.translate(bx, by); ctx2d.rotate(a + k * 1.2);
      ctx2d.fillStyle = i % 2 ? '#cfc4a8' : '#a89e85';
      ctx2d.fillRect(-5, -1.5, 10, 3);
      ctx2d.fillRect(-6, -2.5, 2.5, 5); ctx2d.fillRect(3.5, -2.5, 2.5, 5);   // knobbed ends
      ctx2d.restore();
    }
    // A gathering ring closes on the pile as the moment approaches.
    ctx2d.strokeStyle = `rgba(207,196,168,${0.25 + 0.45 * k})`;
    ctx2d.lineWidth = 1.6;
    ctx2d.beginPath(); ctx2d.ellipse(s.x, s.y + 4, 34 * (1 - k * 0.7), 20 * (1 - k * 0.7), 0, 0, Math.PI * 2); ctx2d.stroke();
    ctx2d.restore();
    return;
  }
  // Overchannel's tell: an arcane glow pooling under the Sorceress, swelling with the channel.
  // Under the sprite so it reads as power gathering at her feet, not a shield around her.
  if (S.player.overchannel && (S.player.stillTime || 0) > 0.2) {
    const frac = Math.min(1, S.player.stillTime / OVERCHANNEL_RAMP);
    ctx2d.save();
    ctx2d.globalAlpha = 0.16 + 0.3 * frac;
    drawGlow(s.x, s.y + 10, '150,100,220', 26 + 26 * frac);
    ctx2d.restore();
  }
  // Hysteresis-stabilised, computed in the update step. Falls back for the frames before the
  // first tick has run.
  const dir = S.player.faceDir || facingDir(S.player.facing.x, S.player.facing.y);
  // Ask for the FINAL on-screen height and draw exact, rather than asking for 96 and letting
  // spriteQuad's whole-number snapping round it up.
  //
  // That snapping is relative to each sprite's OWN source height, so it made higher-resolution
  // art render SMALLER — the exact opposite of the intent. At a 64px source, 96 rounds up to 2x
  // and the class stands 128px tall; at the 96px source the marked and the hollowed are drawn
  // at, it rounds to 1x and they stood 96px — 75% the height of everyone else, which is what
  // "they feel smaller" was. It could never be fixed with a displayScale either: snapping only
  // ever yields whole multiples of the source, so a 96px drawing can be 96 or 192 and nothing
  // between.
  //
  // NOT a size change for the 64px classes: PLAYER_DRAW_HEIGHT is exactly 2x64, the scale they
  // already rendered at, so `exact` lands on the same whole number and the same crisp blocks.
  // The 96px classes take a fractional 1.33x, which is the unavoidable cost of mixing source
  // resolutions and the right trade against standing a head short.
  const scale = spriteScale(S.player.classId);
  const height = PLAYER_DRAW_HEIGHT * scale;
  const exact = true;

  let y = s.y;
  if (spriteFloats(S.player.classId)) {
    // Pure sine on the wall clock rather than a per-frame accumulator: the hover then stays
    // smooth through a frame hitch instead of stuttering with it.
    y += Math.sin(performance.now() / FLOAT_BOB_PERIOD * Math.PI * 2) * FLOAT_BOB_AMOUNT - FLOAT_LIFT;
  }
  // Directional blur while dashing: the same sprite stamped a few times back along the dash
  // line, each fainter than the last. A real blur would be a shader pass and would soften the
  // pixel art it is smearing — the whole look depends on hard edges. Discrete echoes keep every
  // copy crisp and read as speed for the same reason a comic-book smear does.
  //
  // The span shrinks with the dash's remaining time, so the trail is longest at the launch and
  // has collapsed back into the body by the time the player plants their feet, rather than
  // switching off at full length.
  const dp = S.player;
  // Drawn for the dash AND for the hold after it. `fade` is 1 for the whole burst, then ramps
  // to 0 across the hold, so the trail settles out of the air instead of being switched off.
  const fade = dp.dashT > 0 ? 1 : Math.max(0, (dp.dashFade || 0) / DASH_BLUR_HOLD);
  if (fade > 0) {
    const prog = dp.dashT > 0 ? dp.dashT / Math.max(0.001, DASH.time) : 0;
    const span = height * DASH_BLUR_SPAN * (1 - DASH_BLUR_TAPER + DASH_BLUR_TAPER * prog);
    // Farthest first, so the nearest echo overlaps the ones behind it and the smear reads as
    // one tapering shape rather than a row of separate ghosts.
    for (let i = DASH_BLUR_SAMPLES; i >= 1; i--) {
      const f = i / (DASH_BLUR_SAMPLES + 1);
      const a = Math.min(1, DASH_BLUR_ALPHA * (1 - f) * (0.55 + 0.45 * prog) * fade);
      if (a <= 0.01) continue;
      spriteLayer.sprite(S.player.classId, s.x - dp.dashDir.x * span * f,
        y - dp.dashDir.y * span * f, height, S.player.facing.x < 0, dir, 0, exact, a);
    }
  }
  // Red over the silhouette for a beat after a hit. A tint rather than a shape: it follows the
  // art exactly, so it reads on every class without anyone drawing a hurt frame, and it cannot
  // drift out of register with a sprite that is mid-stride.
  //
  // Multiplicative, so green and blue are crushed and red is left alone — the figure goes red
  // rather than getting a red rectangle laid over it. Eased on the square so the colour leaves
  // fast and the flash reads as an impact instead of a fade.
  const hurt = S.player.hurtFlash || 0;
  const tint = hurt > 0
    ? [1, 1 - HURT_FLASH_DEPTH * hurt * hurt, 1 - HURT_FLASH_DEPTH * hurt * hurt]
    : null;
  spriteLayer.sprite(S.player.classId, s.x, y, height, S.player.facing.x < 0, dir, 0, exact,
    1, 1, 1, tint);
}

function drawFireball(sx, sy, vx, vy, radius, infusion) {
  const art = infusionArt(infusion);
  const now = performance.now() / 1000;
  const speed = Math.hypot(vx, vy) || 1;
  const dirX = -vx / speed, dirY = -vy / speed;
  for (let i = 3; i >= 1; i--) {
    const t = i / 3;
    const tx = sx + dirX * i * radius * 1.6;
    const ty = sy + dirY * i * radius * 1.6;
    ctx2d.globalAlpha = 0.32 * (1 - t * 0.55);
    ctx2d.fillStyle = i > 1.5 ? tint(art, 'deep', '#5c1f10') : tint(art, 'mid', '#d97a35');
    ctx2d.beginPath(); ctx2d.arc(tx, ty, radius * (1 - t * 0.45), 0, Math.PI * 2); ctx2d.fill();
  }
  ctx2d.globalAlpha = 1;

  ctx2d.save();
  ctx2d.translate(sx, sy);
  // The corona. Its POINT COUNT and how far each tongue reaches are what carry the element:
  // frost freezes into a few long static spines, shock spits many short ones, poison bulges
  // into fat lobes. Only the uninfused case keeps the original 5-point flicker.
  const spikes = Math.max(3, Math.round(5 * (art.segs || 1)));
  const flicker = art.snap > 0 ? 0 : Math.sin(now * 18 + sx) * 0.2;   // ice does not flicker
  ctx2d.fillStyle = tint(art, 'deep', '#a13328');
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + flicker;
    // Tongue length breathes with the turbulence field for burning, stays fixed for frost, and
    // swells unevenly for poison.
    const wob = art.wobble > 0 ? 1 + flow(i * 1.3, now) * 0.28 * art.wobble : 1;
    const len = radius * (1.3 + (i % 2) * 0.35) * art.amp * wob * (1 + art.swell * 0.25);
    const width = radius * 0.6 * (1 + art.swell * 0.5);
    ctx2d.beginPath();
    ctx2d.moveTo(Math.cos(a - 0.28) * width, Math.sin(a - 0.28) * width);
    ctx2d.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx2d.lineTo(Math.cos(a + 0.28) * width, Math.sin(a + 0.28) * width);
    ctx2d.closePath();
    ctx2d.fill();
  }
  const grad = ctx2d.createRadialGradient(0, 0, 0, 0, 0, radius * 1.15);
  // Four stops, light to dark. The infusion moves the hues and leaves the ramp alone, so the
  // ball keeps its hot-centre reading whatever element it has been given.
  grad.addColorStop(0, tint(art, 'core', '#fff3c4'));
  grad.addColorStop(0.35, tint(art, 'mid', '#ffb347'));
  grad.addColorStop(0.7, tint(art, 'deep', '#e8641f'));
  grad.addColorStop(1, art.deep ? shadeHex(art.deep, 0.45) : '#7a1f0f');
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
  // HARD-BOUNDED, not while(true). The only exit used to be `t >= 0.97`, and t advances by
  // 1/segments-sized steps — so a non-finite segment count (one Infinity coordinate reaching
  // drawElectroArc makes `len`, and therefore `segs`, Infinity) made the step 0 and the loop
  // eternal: a total, mid-frame freeze of the whole game, in a renderer that Electro Fingers
  // runs every frame it is equipped. A draw helper is never allowed to be the thing that
  // decides whether the game continues, so the iteration cap makes the worst bad input cost
  // a misdrawn arc instead of the session.
  const cap = Math.min(600, (Number.isFinite(segments) ? segments : 8) * 4 + 16);
  for (let guard = 0; guard < cap; guard++) {
    // Uneven gaps between kinks — evenly spaced ones read as a machined sawtooth.
    const step = (1 / segments) * (0.5 + Math.random() * 1.0);
    t += step;
    if (!(t < 0.97)) break;   // NaN exits too — `t >= 0.97` would loop forever on it
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

function drawLightningBolt(sx, sy, vx, vy, radius, infusion) {
  const art = infusionArt(infusion);
  const t = performance.now() / 1000;
  const seed = (sx * 0.013 + sy * 0.017) % 10;
  const speed = Math.hypot(vx, vy) || 1;
  const dirX = vx / speed, dirY = vy / speed;
  const perpX = -dirY, perpY = dirX;
  const len = 96; // a long, streaking bolt rather than a short spark
  const tailX = sx - dirX * len * 0.45, tailY = sy - dirY * len * 0.45;
  const headX = sx + dirX * len * 0.55, headY = sy + dirY * len * 0.55;
  // Same generator, different parameters: an ice bolt comes back as a handful of long snapped
  // facets, a burning one as a turbulent line that rises and moves between frames. Fewer, harder
  // segments than the old streak — this spine is now the SKELETON OF A SHAPE, and seven long
  // kinks read as a thunderbolt where eleven small ones read as a scribble.
  // `boltVibe` scales the spine's zigzag amplitude. The spine re-rolls every frame, so this one
  // dial is both how jagged the blade is and how violently it shakes in flight; at 0 the bolt
  // flies dead straight and only the outline's stepped notches remain. Read live, like boltWidth.
  const vibe = SKILLS.chainlightning.tune.boltVibe === undefined
    ? 1 : SKILLS.chainlightning.tune.boltVibe;
  const main = infusedPolyline(tailX, tailY, headX, headY, 7, radius * 2.6 * vibe, perpX, perpY, art, seed, t);

  // The bolt is a closed jagged blade, not a stroked line: near-black glass inside, hot blue rim
  // outside — the same dark-body/bright-edge treatment as the void flames, which is what ties
  // the game's energy visuals into one look. The blade tapers from a broad tail to a needle at
  // the strike tip, and every second vertex both pinches hard AND slides backward along the
  // direction of travel — the pinch alone just makes a wavy ribbon; the slide is what cuts the
  // classic stepped notches into the outline. The two flanks pinch on OPPOSITE vertices, so the
  // silhouette is asymmetric the way a drawn thunderbolt is, never a mirrored leaf.
  const n = main.length;
  ctx2d.save();
  ctx2d.lineJoin = 'miter';
  ctx2d.beginPath();
  // Width profile: a sine belly, so the blade needles out at BOTH tips and carries its width
  // through the middle. The belly sits off-centre (toward the head) so it still reads as
  // something thrown forward rather than a symmetric lozenge.
  // `boltWidth` is Lightning Bolt's own visual dial — width without touching the hitbox, which
  // stays on projSize/radius. Read live so the slider re-shapes bolts already in flight.
  const wMult = SKILLS.chainlightning.tune.boltWidth || 1;
  const bladeW = (f) => radius * wMult
    * (0.12 + 1.45 * Math.pow(Math.sin(Math.PI * Math.pow(f, 0.75)), 0.8));
  for (let i = 0; i < n; i++) {                       // down one flank...
    const f = i / (n - 1);
    let w = bladeW(f);
    let sl = 0;
    if (i % 2 === 1 && i < n - 1) { w *= 0.4; sl = -radius * 1.1; }
    const p = main[i];
    const x = p.x + perpX * w + dirX * sl, y = p.y + perpY * w + dirY * sl;
    if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
  }
  for (let i = n - 1; i >= 0; i--) {                  // ...and back up the other
    const f = i / (n - 1);
    let w = bladeW(f);
    let sl = 0;
    if (i % 2 === 0 && i > 0 && i < n - 1) { w *= 0.4; sl = radius * 1.1; }
    const p = main[i];
    ctx2d.lineTo(p.x - perpX * w + dirX * sl, p.y - perpY * w + dirY * sl);
  }
  ctx2d.closePath();
  // Dark interior first, then the rim in two passes exactly like the void flames: a wide
  // additive glow that reads as light coming off the edge, and a crisp bright line that carries
  // the shape. The interior keeps a whisper of the old core colour as a filament of charge.
  ctx2d.fillStyle = tint(art, 'deep', 'rgba(8,14,32,0.92)');
  ctx2d.fill();
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  ctx2d.strokeStyle = tint(art, 'mid', `rgba(64,150,255,${0.30 + 0.14 * Math.sin(t * 9 + seed)})`);
  ctx2d.lineWidth = 4.5;
  ctx2d.stroke();
  ctx2d.restore();
  ctx2d.strokeStyle = tint(art, 'core', '#9fdcff');
  ctx2d.lineWidth = 1.6;
  ctx2d.stroke();
  ctx2d.strokeStyle = tint(art, 'core', '#eaf6ff');
  ctx2d.globalAlpha = 0.5;
  ctx2d.lineWidth = 1.2;
  strokePolyline(main);                               // the inner filament
  ctx2d.globalAlpha = 1;

  // Branches. Shock throws several, everything else keeps the single original fork.
  const branches = Math.max(1, Math.round(art.forks));
  for (let b = 0; b < branches; b++) {
    const at = Math.floor(main.length * (0.35 + 0.3 * b / Math.max(1, branches - 1 || 1)));
    const mid = main[Math.min(main.length - 1, at)];
    const forkSign = (b % 2 === 0 ? 1 : -1) * (Math.random() > 0.5 ? 1 : -1);
    const forkEnd = {
      x: mid.x + perpX * radius * 3 * forkSign + dirX * 8,
      y: mid.y + perpY * radius * 3 * forkSign + dirY * 8,
    };
    const fork = infusedPolyline(mid.x, mid.y, forkEnd.x, forkEnd.y, 3, radius * vibe, perpX, perpY, art, seed + b, t);
    // Same two materials as the blade, one dark pass and one bright, so a fork reads as a
    // splinter of the same bolt rather than a decoration laid over it.
    ctx2d.globalAlpha = 0.85;
    ctx2d.strokeStyle = tint(art, 'deep', 'rgba(10,18,38,0.9)');
    ctx2d.lineWidth = 3.2;
    strokePolyline(fork);
    ctx2d.globalAlpha = 0.75;
    ctx2d.strokeStyle = tint(art, 'core', '#9fdcff');
    ctx2d.lineWidth = 1.1;
    strokePolyline(fork);
  }
  ctx2d.globalAlpha = 1;

  // Embers peel off the path itself rather than off the projectile's centre, so a burning bolt
  // sheds along its whole length the way a real one would.
  if (art.ember > 0) {
    for (let i = 1; i < main.length; i += 2) {
      const ph = ((t * 1.9 + i * 0.31 + seed) % 1);
      const p = main[i];
      ctx2d.fillStyle = ph < 0.45 ? tint(art, 'core', '#ffe6a8') : tint(art, 'mid', '#ff7a1f');
      ctx2d.globalAlpha = (1 - ph) * 0.8;
      ctx2d.beginPath();
      ctx2d.arc(p.x + perpX * ph * 6, p.y + perpY * ph * 6 - ph * 9, (1.9 - ph * 1.3), 0, Math.PI * 2);
      ctx2d.fill();
    }
    ctx2d.globalAlpha = 1;
  }
  // Swollen joints: poison pools at the kinks instead of running evenly.
  if (art.swell > 0) {
    ctx2d.fillStyle = tint(art, 'mid', '#a95ec0');
    ctx2d.globalAlpha = 0.7;
    for (let i = 1; i < main.length - 1; i += 2) {
      const p = main[i];
      ctx2d.beginPath();
      ctx2d.arc(p.x, p.y, 1.6 + Math.abs(flow(i + seed, t)) * 1.8, 0, Math.PI * 2);
      ctx2d.fill();
    }
    ctx2d.globalAlpha = 1;
  }
  ctx2d.restore();
}

/** Darken a hex colour toward black. Used to derive a ramp's outermost stop from its `deep`
 *  colour, so an infusion supplies three hues and the fourth follows rather than being listed. */
function shadeHex(hex, k) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
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
  return sx >= -margin && sx <= viewW + margin
      && sy >= -margin && sy <= viewH + margin;
}

// Worst-case screen reach of an effect, so wide ones (beams, novas, ground patches) aren't
// culled while part of them is still visible.
function effectReach(fx) {
  return Math.max(fx.radius || 0, fx.range || 0, fx.maxRadius || 0, fx.width || 0, 90) + 60;
}

// Scratch for the Ice Bomb trail's two bright cores. Module-level and reused so the wake stays
// allocation-free: a volley redraws this several times a frame and a fresh pair of arrays each
// time would be exactly the kind of steady garbage the damage-number pass was trimmed to avoid.
const trailCoreX = [0, 0];
const trailCoreY = [0, 0];

// Bone Throw's femur is drawn twice its original length. Purely visual — the projectile's
// collision radius is unchanged, so this does not quietly widen its hitbox.
const BONE_LENGTH_MULT = 2;

// The thrown rock. Plain grey stone for now, by request - the shape is the interesting part,
// and it is drawn from the SAME vertices the hitbox tests against, so what you dodge is what
// you see. A lit upper-left facet and a dark rim give it enough volume to read as heavy while
// it tumbles.
function drawBossRock(p, sx, sy) {
  const path = () => {
    ctx2d.beginPath();
    for (let i = 0; i < p.verts.length; i++) {
      const v = p.verts[i];
      const a = v.a + p.spin;
      const x = Math.cos(a) * v.r * p.radius, y = Math.sin(a) * v.r * p.radius;
      if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
    }
    ctx2d.closePath();
  };
  const z = p.z || 0;
  ctx2d.save();
  // Ground shadow, squashed and pinned to the GROUND position while the boulder itself rides
  // up on z. The gap between the two is the only cue that reads as height in a top-down view,
  // so the shadow also shrinks and fades with altitude — a shadow that stayed the same size
  // would make the rock look like it was growing rather than rising.
  const lift = clamp(z / 220, 0, 1);
  ctx2d.translate(sx, sy + p.radius * 0.55);
  ctx2d.scale(1, 0.36);
  ctx2d.globalAlpha = 0.4 * (1 - lift * 0.55);
  ctx2d.fillStyle = '#000';
  ctx2d.beginPath(); ctx2d.arc(0, 0, p.radius * 0.92 * (1 - lift * 0.3), 0, Math.PI * 2); ctx2d.fill();
  ctx2d.restore();

  ctx2d.save();
  ctx2d.translate(sx, sy - z);
  path();
  const M = rockStyle(p.rock);
  ctx2d.fillStyle = M.body; ctx2d.fill();
  // Lit facet: the same silhouette, shrunk and pushed up-left toward the light.
  ctx2d.save();
  ctx2d.clip();
  ctx2d.translate(-p.radius * 0.2, -p.radius * 0.22);
  ctx2d.scale(0.78, 0.78);
  path();
  ctx2d.fillStyle = M.lit; ctx2d.fill();
  ctx2d.restore();
  path();
  ctx2d.lineWidth = 2; ctx2d.strokeStyle = M.line; ctx2d.stroke();
  ctx2d.restore();
}

/**
 * The infusion art block for an EFFECT. Effects carry the caster's `mods`, which is where the
 * infusion lives, so this is the one lookup every effect renderer needs — no branching on the
 * element, no separate code path for the uninfused case (that returns the neutral block whose
 * dials are all 1).
 */
function fxArt(fx) {
  return infusionArt(fx && fx.mods && fx.mods.infusion);
}

/**
 * Infusions a skill carries, oldest first.
 *
 * Reads the modern list and falls back to the single `infusion` field a run started before the
 * change would still be holding.
 */
function skillInfusions(skill) {
  if (!skill) return [];
  if (Array.isArray(skill.infusions)) return skill.infusions;
  return skill.infusion ? [skill.infusion] : [];
}

/** Which drawing family a projectile belongs to — the flag its render branch keys off. */
function artKindOf(p) {
  return p.isIceBomb ? 'icebomb' : p.isFire ? 'fire' : p.isLightning ? 'lightning' : p.isIce ? 'ice'
    : p.isBone ? 'bone' : p.isFlask ? 'flask' : p.isArrow ? 'arrow' : p.isRock ? 'rock' : 'plain';
}
/** Families whose generator takes the infusion itself; these suppress the fallback aura. */
// Families whose own renderer consumes the infusion, so the fallback aura stands down for them.
// Everything listed here reads infusionArt() inside its draw branch.
const ART_INFUSED = new Set(['fire', 'lightning', 'ice', 'bone', 'flask', 'icebomb']);

function drawProjectile(p) {
  const s = worldToScreen(p.x, p.y);
  // Generous margin: arrows and bones are drawn stretched well past their own radius.
  if (!onScreen(s.x, s.y, (p.radius || 6) * 4 + 60)) return;
  const inf = p.mods && p.mods.infusion;
  // The aura is now a FALLBACK, not the effect. Skills whose own generator understands the
  // infusion redraw themselves in it; painting a coloured halo behind those as well would put
  // the element on screen twice and undo the point of doing it procedurally. Everything not yet
  // converted keeps the halo so no infused skill goes unreadable in the meantime.
  if (inf && !ART_INFUSED.has(artKindOf(p))) {
    drawInfusionAura(s.x, s.y, inf, p.id % 17, p.sizeScale || 1);
  }
  if (p.isArrow) {
    drawSpriteRotated(ctx2d, 'arrow', s.x, s.y, 9 * (p.sizeScale || 1), Math.atan2(p.vy, p.vx), 1.75);
    return;
  }
  if (p.isRock) {
    drawBossRock(p, s.x, s.y);
    return;
  }
  if (p.isIceBomb) {
    // Height is faked from how far through its lob the charge is — a half-sine, so it rises off
    // the caster and drops onto the target. There is no z in the sim; the arc is purely read
    // from `life` against the distance it was thrown, which keeps the hitbox on the ground where
    // the blast will land.
    const lifeMax = Math.max(0.001, p.lifeMax || p.life || 1);
    const t01 = clamp(1 - p.life / lifeMax, 0, 1);
    const lift = Math.sin(t01 * Math.PI) * 26;
    // Ground shadow stays put and shrinks with height — the only cue that reads as altitude from
    // directly above, and the thing that tells you where the burst is going to land.
    ctx2d.save();
    ctx2d.globalAlpha = 0.36 * (1 - Math.sin(t01 * Math.PI) * 0.5);
    ctx2d.fillStyle = '#000';
    ctx2d.beginPath();
    ctx2d.ellipse(s.x, s.y + 3, 5.5 - lift * 0.06, 2.6 - lift * 0.03, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.restore();

    // Snowflake wake, drawn under the charge.
    //
    // STATELESS BY DESIGN, which is the whole reason it is cheap. Ice bombs fly a straight line
    // at constant velocity, so where the charge was `age` seconds ago is exactly `-v * age` and
    // the height it had then falls out of the same half-sine as the charge's own lift. That
    // means no particle entities: nothing to spawn, update, sort, cull or garbage-collect, and
    // no per-flake state to keep alive. The trail costs the same whether it is one bomb or a
    // full volley of them, and it costs nothing at all once the bomb is gone.
    //
    // Two draw calls per charge, not fourteen: every flake's spokes go into ONE path that is
    // stroked once, and the bright cores of the two youngest into one fill. Flakes taper in
    // size with age instead of fading individually, because varying alpha per flake would mean
    // one stroke call each and that is the expensive way to buy the same read.
    const TRAIL = 7;
    ctx2d.save();
    ctx2d.strokeStyle = 'rgba(212,240,255,0.45)';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    for (let i = 1; i <= TRAIL; i++) {
      const age = i * 0.052;
      const k = 1 - i / (TRAIL + 1);              // 1 at the charge, 0 at the tail
      const backLift = Math.sin(clamp(1 - (p.life + age) / lifeMax, 0, 1) * Math.PI) * 26;
      // Released where the charge was, then drifting: settling downward and swaying sideways,
      // so the wake loosens behind the bomb rather than being a rigid stripe.
      const fx0 = s.x - p.vx * age + Math.sin(i * 2.3 + p.id) * age * 26;
      const fy0 = s.y - p.vy * age - backLift + age * 24;
      const sz = 0.6 + 2.4 * k;
      for (let a = 0; a < 3; a++) {
        const ang = a * (Math.PI / 3) + i * 0.9 + p.id;
        const cx = Math.cos(ang) * sz, cy = Math.sin(ang) * sz;
        ctx2d.moveTo(fx0 - cx, fy0 - cy);
        ctx2d.lineTo(fx0 + cx, fy0 + cy);
      }
      if (i <= 2) { trailCoreX[i - 1] = fx0; trailCoreY[i - 1] = fy0; }
    }
    ctx2d.stroke();
    ctx2d.fillStyle = 'rgba(238,252,255,0.6)';
    ctx2d.beginPath();
    for (let i = 0; i < 2; i++) {
      ctx2d.moveTo(trailCoreX[i] + 1.1, trailCoreY[i]);
      ctx2d.arc(trailCoreX[i], trailCoreY[i], 1.1, 0, Math.PI * 2);
    }
    ctx2d.fill();
    ctx2d.restore();

    const bombArt = infusionArt(inf);
    const bx = s.x, by = s.y - lift;
    drawGlow(bx, by, bombArt.glowRgb || '111,201,232', 14);
    ctx2d.save();
    ctx2d.translate(bx, by);
    ctx2d.rotate(performance.now() / 130 + p.id);
    // A faceted shard-cluster rather than a ball: it should read as frozen, and a spun polygon
    // catches the eye as it tumbles in a way a circle cannot.
    ctx2d.fillStyle = tint(bombArt, 'mid', '#bfeaff');
    ctx2d.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rr = i % 2 ? 4.2 : 6.4;
      i ? ctx2d.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx2d.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx2d.closePath(); ctx2d.fill();
    ctx2d.fillStyle = tint(bombArt, 'core', '#eafaff');
    ctx2d.beginPath(); ctx2d.arc(-1.4, -1.4, 2.1, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.restore();
    return;
  }
  if (p.isFlask) {
    const flaskArt = infusionArt(inf);
    // The bottle is drawn from its COLLISION RADIUS rather than at a fixed pixel size, so the
    // Flask Size dial (and any +size mod) moves the picture and the hitbox together. The /5 is
    // the radius the hand-authored rects below were drawn against.
    const fk = (p.radius || 5) / 5;
    drawGlow(s.x, s.y, flaskArt.glowRgb || '154,79,176', 13 * fk);
    ctx2d.save();
    ctx2d.translate(s.x, s.y);
    ctx2d.rotate(performance.now() / 110 + p.id);
    ctx2d.scale(fk, fk);
    ctx2d.fillStyle = '#3a1a48'; ctx2d.fillRect(-2.6, -1.5, 5.2, 6.5); // glass body
    ctx2d.fillStyle = tint(flaskArt, 'mid', '#9a4fb0'); ctx2d.fillRect(-2, -0.5, 4, 5); // liquid
    ctx2d.fillStyle = tint(flaskArt, 'core', '#c98af0'); ctx2d.fillRect(-1.6, 0.5, 1.4, 3); // shine
    ctx2d.fillStyle = '#2a1236'; ctx2d.fillRect(-1.2, -4, 2.4, 2.6); // neck
    ctx2d.fillStyle = '#7a5a3a'; ctx2d.fillRect(-1.3, -4.8, 2.6, 1); // cork
    ctx2d.restore();
    return;
  }
  if (p.isFire) {
    drawFireball(s.x, s.y, p.vx, p.vy, p.radius, inf);
    return;
  }
  if (p.isLightning) {
    drawLightningBolt(s.x, s.y, p.vx, p.vy, p.radius, inf);
    return;
  }
  if (p.isBone) {
    const boneArt = infusionArt(inf);
    drawGlow(s.x, s.y, boneArt.glowRgb || '230,220,190', 11);
    // A tumbling femur — knobbed at both ends, spinning end over end as it arcs.
    // Drawn FROM the collision radius rather than a separate hardcoded size: the bone spins,
    // so its swept shape is a circle of its half-length, and that is exactly p.radius. The two
    // previously had independent sizes and had drifted apart.
    const half = p.radius;          // half-length == collision radius
    const r = half / 2.1;           // the proportions below were authored against this
    ctx2d.save();
    ctx2d.translate(s.x, s.y);
    ctx2d.rotate(performance.now() / 42 + p.id);
    ctx2d.fillStyle = tint(boneArt, 'deep', '#cfc4a8');
    ctx2d.fillRect(-r * 0.34, -half, r * 0.68, half * 2);     // shaft
    ctx2d.beginPath();                                        // knobbed ends
    ctx2d.arc(-r * 0.4, -half, r * 0.52, 0, Math.PI * 2);
    ctx2d.arc(r * 0.4, -half, r * 0.52, 0, Math.PI * 2);
    ctx2d.arc(-r * 0.4, half, r * 0.52, 0, Math.PI * 2);
    ctx2d.arc(r * 0.4, half, r * 0.52, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.fillStyle = tint(boneArt, 'core', '#ece2c8');       // lit edge
    ctx2d.fillRect(-r * 0.34, -half, r * 0.24, half * 2);
    ctx2d.restore();
    return;
  }
  if (p.isIce) {
    const iceArt = infusionArt(inf);
    drawGlow(s.x, s.y, iceArt.glowRgb || '191,234,255', p.radius * 3);
    const r = p.radius;
    ctx2d.save();
    ctx2d.translate(s.x, s.y); ctx2d.rotate(Math.atan2(p.vy, p.vx));
    ctx2d.fillStyle = tint(iceArt, 'core', '#cdeeff'); // crystalline shard pointing along travel
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
function drawScytheSweep(cx, cy, dir, arc, radius, prog, art = NO_INFUSION) {
  // Flat circle, deliberately: the player's weapons sweep the ground plane head-on and are NOT
  // foreshortened the way the boss's greatsword is. Tilting these would make the player's own
  // attacks sit in a different space from the arena they are cutting through.
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
  // The smear takes the infusion's ramp; the blade below stays steel, so an infused cut reads
  // as a weapon carrying an element rather than a weapon made of one.
  g.addColorStop(0, 'rgba(120,160,90,0)');
  g.addColorStop(0.65, art.mid ? art.mid : 'rgba(140,190,100,0.12)');
  g.addColorStop(1, art.core ? art.core : 'rgba(205,240,170,0.30)');
  ctx2d.globalAlpha = art.core ? 0.3 : 1;
  ctx2d.fillStyle = g;
  ctx2d.fill();

  // Bright leading edge riding just behind the blade.
  const fade = 1 - prog * 0.3;
  ctx2d.globalAlpha = 1;
  ctx2d.strokeStyle = art.core ? art.core : `rgba(226,255,200,${0.85 * fade})`;
  ctx2d.globalAlpha = art.core ? 0.85 * fade : 1;
  ctx2d.lineWidth = 3.5 + art.swell * 2;
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, outerR * 0.97, curA - 0.3, curA);
  ctx2d.stroke();

  // ---- the weapon itself, in the pivot's own space ----
  ctx2d.save();
  ctx2d.translate(cx, cy);

  // Snath: from behind the hands out to where the head is mounted. Drawn as a tapered timber
  // with a lit side rather than a flat line, matching how the blades are shaded.
  const hx0 = -Math.cos(curA) * innerR * 1.9, hy0 = -Math.sin(curA) * innerR * 1.9;
  const hx1 = Math.cos(curA) * outerR * 0.84, hy1 = Math.sin(curA) * outerR * 0.84;
  ctx2d.lineCap = 'round';
  ctx2d.strokeStyle = STEEL.line; ctx2d.lineWidth = 6.5;
  ctx2d.beginPath(); ctx2d.moveTo(hx0, hy0); ctx2d.lineTo(hx1, hy1); ctx2d.stroke();
  ctx2d.strokeStyle = '#6b4f2e'; ctx2d.lineWidth = 4.5;
  ctx2d.beginPath(); ctx2d.moveTo(hx0, hy0); ctx2d.lineTo(hx1, hy1); ctx2d.stroke();
  ctx2d.strokeStyle = '#9b7746'; ctx2d.lineWidth = 1.4;
  ctx2d.beginPath(); ctx2d.moveTo(hx0, hy0); ctx2d.lineTo(hx1, hy1); ctx2d.stroke();
  // Iron collar where the head meets the snath — the join that sells it as a built tool.
  ctx2d.fillStyle = FITTINGS.guard;
  ctx2d.save();
  ctx2d.rotate(curA);
  ctx2d.fillRect(outerR * 0.78, -4.5, 9, 9);
  ctx2d.fillStyle = FITTINGS.guardLit;
  ctx2d.fillRect(outerR * 0.78, -4.5, 9, 2.5);
  ctx2d.restore();

  // Crescent head, tapering from the heel at the snath to a fine point leading the swing.
  const sweep = 0.62;
  drawCrescentBlade(ctx2d, outerR * 0.99, curA - sweep * 0.15, curA + sweep,
    { thick: outerR * 0.2 });
  ctx2d.restore();

  ctx2d.restore();
}

function drawSwordSlash(cx, cy, dir, arc, radius, prog, art = NO_INFUSION) {
  // A blade sweeps from one edge of the arc to the other over the effect's life, trailing a
  // bright crescent smear behind it so it reads as a physical slash.
  //
  // Flat circle on purpose — see the note in drawScytheSweep. The blade itself is drawn by the
  // shared drawBladeShape, so the player's sword is the same steel as the boss's greatsword,
  // just a one-handed cut of it: slimmer, shorter grip, smaller guard.
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
  g.addColorStop(0.7, art.mid ? art.mid : 'rgba(232,180,90,0.10)');
  g.addColorStop(1, art.core ? art.core : 'rgba(255,240,210,0.28)');
  ctx2d.globalAlpha = art.core ? 0.28 : 1;
  ctx2d.fillStyle = g;
  ctx2d.fill();

  // Bright leading edge just behind the blade tip.
  const fade = 1 - prog * 0.35;
  ctx2d.strokeStyle = `rgba(255,250,235,${0.85 * fade})`;
  ctx2d.lineWidth = 3;
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, outerR * 0.98, curA - 0.22, curA);
  ctx2d.stroke();

  // The sword, along the current sweep angle.
  ctx2d.save();
  ctx2d.translate(cx, cy);
  ctx2d.rotate(curA);
  drawBladeShape(ctx2d, outerR, {
    width: Math.max(7, outerR * 0.075),   // one-handed: noticeably slimmer than the two-hander
    hilt: innerR,
    guard: Math.max(6, outerR * 0.075) * 1.35,
    grip: innerR * 0.85,
    glow: 0.55 * fade,
  });
  ctx2d.restore();

  ctx2d.restore();
}

// Solar Ray: a hard, straight laser rather than a wandering flame ribbon, matching its icon.
// Layered strokes build the beam from a wide outer haze to a white-hot core; the contact
// point carries a fiery sphere that throws embers while it burns.
function drawFireBeam(x1, y1, x2, y2, width, time, intensity, embers, art = NO_INFUSION) {
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  ctx2d.lineCap = 'round';

  // Fast, shallow flicker — the beam should feel powered and steady, not fluttering. Frost
  // holds dead still instead: a beam of ice is a solid bar, and a flickering one reads as fire
  // wearing a blue coat.
  const I = intensity * (art.snap > 0 ? 1 : (0.9 + 0.1 * Math.sin(time * 40)));

  const beam = (w, col) => {
    ctx2d.strokeStyle = col;
    ctx2d.lineWidth = Math.max(1, w);
    ctx2d.beginPath();
    ctx2d.moveTo(x1, y1);
    ctx2d.lineTo(x2, y2);
    ctx2d.stroke();
  };
  // Four concentric strokes, dark to light. The infusion moves the hues and leaves that ramp
  // alone, so the beam keeps its hot-core read whatever element it is carrying.
  const lay = (w, fallback, slot, a) => {
    if (!art[slot]) { beam(w, fallback); return; }
    ctx2d.globalAlpha = a;
    beam(w, art[slot]);
    ctx2d.globalAlpha = 1;
  };
  lay(width * 1.9, `rgba(255,80,18,${0.16 * I})`, 'deep', 0.16 * I);   // outer haze
  lay(width * 1.1, `rgba(255,140,40,${0.36 * I})`, 'mid', 0.36 * I);   // body
  lay(width * 0.58, `rgba(255,205,110,${0.62 * I})`, 'core', 0.62 * I); // hot inner
  lay(width * 0.22, `rgba(255,252,240,${0.95 * I})`, 'core', 0.95 * I); // white core

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

// Draw an effect from hand-drawn art instead of procedurally. Returns false if this kind has
// no art registered, letting the caller fall through to its procedural painter.
//
// Effects render through spriteLayer.effect() rather than the batched band, because they sit
// UNDER the cast in the draw order and so cannot join that batch. They still benefit from the
// GPU path — rotation, tint and fade are all free per instance — they simply flush on their
// own. Grouping the registry by texture would batch them too, once there is enough art for
// that to matter.
function drawEffectFromArt(fx, s, life) {
  const art = effectArt(fx.kind);
  if (!art || !hasSprite(art.spriteId)) return false;
  let angle = 0;
  if (art.spin === 'velocity') angle = Math.atan2(fx.vy || 0, fx.vx || 1);
  else if (art.spin === 'time') angle = performance.now() / 1000 * (art.spinRate || 1);
  spriteLayer.begin(ctx2d, viewW, viewH);
  spriteLayer.effect(art.spriteId, s.x, s.y, (fx.radius || 16) * (art.scale || 2), {
    angle,
    alpha: art.fade ? life : 1,
    blend: art.blend || 'add',
    tint: art.tint,
  });
  spriteLayer.end();
  return true;
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
  // Sprite-backed effects, if this kind has art. Anything not listed in effect-art.js falls
  // straight through to the procedural painters below, which remain the default and are not
  // going away — see the note in that file about which effects suit which approach.
  if (hasAnyEffectArt() && drawEffectFromArt(fx, s, life)) return;
  if (fx.kind === 'scythe') {
    drawScytheSweep(s.x, s.y, fx.dir, fx.angle, fx.radius, clamp(fx.t / fx.duration, 0, 1), fxArt(fx));
  } else if (fx.kind === 'slash') {
    drawSwordSlash(s.x, s.y, fx.dir, fx.angle, fx.radius, clamp(fx.t / fx.duration, 0, 1), fxArt(fx));
  } else if (fx.kind === 'firebeam') {
    const b = worldToScreen(fx.tx, fx.ty);
    const fade = fx.t > fx.duration - 0.15 ? clamp((fx.duration - fx.t) / 0.15, 0, 1) : 1;
    drawFireBeam(s.x, s.y, b.x, b.y, fx.width, performance.now() / 1000, fade, fx.embers, fxArt(fx));
  } else if (fx.kind === 'ninjastars') {
    // Four-pointed steel shuriken, each spinning fast on its own axis as the ring orbits.
    //
    // `segs` drives the POINT COUNT, which is the only reshape that reads on a blade this small
    // and spinning this fast: frost cuts it to a stubby three-pointed crystal, shock spikes it
    // out to nine. The centre hole stays dark whatever the element — it is a hole.
    const nArt = fxArt(fx);
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
      ctx2d.fillStyle = tint(nArt, 'core', '#c2cbd6');
      ctx2d.beginPath();
      const pts = Math.max(3, Math.round(6 * (nArt.segs || 1)));
      for (let k = 0; k < pts; k++) {        // points, count set by the element
        const a0 = (k / pts) * Math.PI * 2;
        ctx2d.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
        const a1 = a0 + Math.PI / pts;       // inner notch between each point
        ctx2d.lineTo(Math.cos(a1) * r * 0.38, Math.sin(a1) * r * 0.38);
      }
      ctx2d.closePath(); ctx2d.fill();
      ctx2d.fillStyle = tint(nArt, 'deep', '#8a94a2');  // shaded underside
      ctx2d.beginPath(); ctx2d.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx2d.fill();
      ctx2d.fillStyle = '#2b241b';           // centre hole
      ctx2d.beginPath(); ctx2d.arc(0, 0, r * 0.13, 0, Math.PI * 2); ctx2d.fill();
      ctx2d.restore();
    }
    }
  } else if (fx.kind === 'flamethrower') {
    // Render the sprayed flame particles: each grows and cools (white → orange → red) as it
    // ages, then fades. Additive blending makes overlapping particles read as a fiery stream.
    // Each particle's own hot-to-cool ramp is remapped, so a frost-infused jet still cools from
    // bright to dark along its length — the read that makes it look like a spray at all.
    const ftArt = fxArt(fx);
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
      const hot = age < 0.4;
      if (ftArt.core) {
        g.addColorStop(0, hot ? ftArt.core : ftArt.mid);
        g.addColorStop(0.5, ftArt.mid);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx2d.globalAlpha = (hot ? 0.55 : 0.5) * a;
      } else {
        g.addColorStop(0, hot ? `rgba(255,255,225,${0.55 * a})` : `rgba(255,180,70,${0.5 * a})`);
        g.addColorStop(0.5, `rgba(255,115,30,${0.4 * a})`);
        g.addColorStop(1, 'rgba(150,30,10,0)');
      }
      ctx2d.fillStyle = g;
      ctx2d.beginPath(); ctx2d.arc(sp.x, sp.y, r, 0, Math.PI * 2); ctx2d.fill();
      ctx2d.globalAlpha = 1;
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
  } else if (fx.kind === 'rockDust') {
    // Where a thrown rock came apart: a low puff of grit with stone chips tumbling out of it.
    const life = clamp(1 - fx.t / fx.duration, 0, 1);
    ctx2d.save();
    ctx2d.globalAlpha = life * 0.45;
    ctx2d.fillStyle = '#5c5852';
    ctx2d.beginPath();
    ctx2d.ellipse(s.x, s.y, fx.radius * (1 + (1 - life) * 1.1), fx.radius * 0.42 * (1 + (1 - life)), 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.restore();
    for (const sh of fx.shards) {
      const cl = clamp(sh.life / 0.5, 0, 1);
      if (cl <= 0) continue;
      ctx2d.save();
      ctx2d.globalAlpha = cl;
      ctx2d.translate(s.x + sh.x, s.y + sh.y);
      ctx2d.rotate(sh.rot);
      ctx2d.fillStyle = rockStyle(fx.rock).body;
      ctx2d.fillRect(-sh.size, -sh.size * 0.7, sh.size * 2, sh.size * 1.4);
      ctx2d.restore();
    }
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
    //
    // Infusion reshapes the WAVE, not just its colour. `wobble` breaks the rim off a true circle
    // and makes it breathe, so a burning nova rolls outward like a pressure front instead of a
    // hoop; `snap` faceted it into flat planes; `segs` changes how many shards it throws.
    const art = fxArt(fx);
    const p = 1 - life;
    const r = fx.radius * (0.4 + 0.6 * p);
    const now = performance.now() / 1000;
    // A closed rim built from samples rather than arc(), so the dials have something to bend.
    const rimPath = (rad, amp) => {
      const N = 48;
      ctx2d.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        let k = 1;
        if (art.wobble > 0) k += flow(i * 0.45 + fx.id, now) * 0.09 * art.wobble;
        if (art.snap > 0) k = 1 + Math.round((k - 1) / 0.05) * 0.05;   // quantised: flat faces
        const rr = rad * k * (amp || 1);
        const x = s.x + Math.cos(a) * rr, y = s.y + Math.sin(a) * rr;
        i ? ctx2d.lineTo(x, y) : ctx2d.moveTo(x, y);
      }
      ctx2d.closePath();
    };
    ctx2d.save();
    const g = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    g.addColorStop(0, art.core ? `${art.core}` : `rgba(180,230,245,${0.18 * life})`);
    g.addColorStop(0.7, art.mid ? `${art.mid}` : `rgba(120,180,210,${0.1 * life})`);
    g.addColorStop(1, 'rgba(120,180,210,0)');
    ctx2d.globalAlpha = art.core ? 0.16 * life : 1;
    ctx2d.fillStyle = g;
    rimPath(r); ctx2d.fill();
    ctx2d.globalAlpha = 1;
    ctx2d.strokeStyle = tint(art, 'deep', `rgba(120,175,205,${0.5 * life})`);
    ctx2d.globalAlpha = art.deep ? 0.5 * life : 1;
    ctx2d.lineWidth = 6 + art.swell * 3;
    ctx2d.lineJoin = art.snap > 0 ? 'miter' : 'round';
    rimPath(r, 0.96); ctx2d.stroke();
    ctx2d.strokeStyle = tint(art, 'core', `rgba(224,246,255,${0.85 * life})`);
    ctx2d.globalAlpha = art.core ? 0.85 * life : 1;
    ctx2d.lineWidth = 2.5;
    rimPath(r); ctx2d.stroke();
    ctx2d.globalAlpha = 1;
    const shards = Math.max(4, Math.round(10 * (art.segs || 1))), rot = fx.t * 1.5;
    ctx2d.fillStyle = tint(art, 'core', `rgba(214,242,255,${0.8 * life})`);
    ctx2d.globalAlpha = art.core ? 0.8 * life : 1;
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
  } else if (fx.kind === 'iceBurst') {
    // A frost charge going off. Shards thrown outward on straight radial lines, plus a hard ring
    // that snaps to full radius almost immediately — the opposite read to the poison splash's
    // slow drifting cloud, because this one has to look brittle rather than billowing.
    const p = clamp(fx.t / fx.duration, 0, 1);
    const a = (1 - p) * (1 - p);
    const rr = fx.radius * Math.min(1, p * 3.2);   // snaps out, then holds
    // Screen coords, via the `s` that every other painter in here uses. This block read the
    // effect's WORLD position instead, so the burst was drawn offset by the whole camera
    // translation and was almost always off the edge of the screen. It is the Ice Bomb's only
    // detonation flash, so the skill has been going off invisibly.
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'lighter';
    // Expanding rim.
    ctx2d.strokeStyle = `rgba(191,234,255,${a * 0.85})`;
    ctx2d.lineWidth = 2.5 * (1 - p * 0.6);
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, rr, 0, Math.PI * 2); ctx2d.stroke();
    // Cold core wash, fading faster than the rim so the ring is what lingers.
    ctx2d.fillStyle = `rgba(111,201,232,${a * 0.3})`;
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, rr * 0.82, 0, Math.PI * 2); ctx2d.fill();
    // Shards. Angles are seeded off the effect id so one burst is not a rotation of the next.
    const SHARDS = 10;
    ctx2d.fillStyle = `rgba(234,250,255,${a})`;
    for (let i = 0; i < SHARDS; i++) {
      const ang = (i / SHARDS) * Math.PI * 2 + fx.id * 0.7;
      const d = rr * (0.55 + ((i * 7 + fx.id) % 5) / 10);
      const sx = s.x + Math.cos(ang) * d, sy = s.y + Math.sin(ang) * d;
      const len = 5 + ((i * 3 + fx.id) % 4);
      ctx2d.save();
      ctx2d.translate(sx, sy); ctx2d.rotate(ang);
      ctx2d.beginPath();
      ctx2d.moveTo(len, 0); ctx2d.lineTo(-len * 0.4, 2.1); ctx2d.lineTo(-len * 0.4, -2.1);
      ctx2d.closePath(); ctx2d.fill();
      ctx2d.restore();
    }
    ctx2d.restore();
  } else if (fx.kind === 'poisonSplash') {
    // A vial bursting against a body: a fast, wide gout of violet vapour that snaps out to
    // full radius and thins away. Quicker and broader than the corpse-rupture burst above, so
    // a direct hit reads as an impact rather than as another lingering cloud.
    const p = clamp(fx.t / fx.duration, 0, 1);
    const rr = fx.radius * (0.45 + 0.55 * Math.sqrt(p)); // fast out, then easing
    const a = (1 - p) * (1 - p);
    ctx2d.save();
    // A dozen soft lobes, each drifting outward on its own heading at its own rate. Because
    // every lobe is nearly transparent, the cloud is dense where they pile up and wispy at the
    // edges, and the boundary is ragged rather than a circle. The lobes keep creeping apart as
    // the cloud ages, so it disperses instead of simply fading.
    const LOBES = 12;
    for (let i = 0; i < LOBES; i++) {
      const seed = fx.id * 1.7 + i * 2.399;         // stable per lobe, varied between them
      const ang = (i / LOBES) * Math.PI * 2 + Math.sin(seed) * 0.9;
      // Lobes start already spread apart. Bunching them near the centre at spawn (they used to
      // start at 0.30 of the radius) stacked all twelve on top of each other for the first few
      // frames, and twelve translucent puffs in a heap is an opaque blob — which the bloom pass
      // then lit up like a solid ball.
      const creep = 0.72 + 0.40 * p * (0.6 + 0.4 * Math.sin(seed * 1.3));
      const dx = Math.cos(ang) * rr * creep;
      const dy = Math.sin(ang) * rr * creep * 0.72; // squashed: the cloud hugs the ground
      const lobeR = rr * (0.30 + 0.22 * Math.abs(Math.sin(seed * 2.1)));
      // Lobes fade at slightly different rates so the mass thins unevenly.
      const lobeA = a * (0.7 + 0.3 * Math.sin(seed * 0.9));
      drawPuff('poisonMist', POISON_MIST_STOPS, s.x + dx, s.y + dy, lobeR, lobeR * 0.82, lobeA);
    }
    ctx2d.restore();
  } else if (fx.kind === 'poisonPuddle') {
    // A low bank of toxic vapour lying over the ground, not a disc of flat colour.
    //
    // This was six hard-filled arcs plus one big one on top — genuinely opaque overlapping
    // circles, and the brightest thing on screen once the bloom pass got hold of them. Same
    // treatment as the splash now: soft puffs with diffuse edges, squashed flat and slowly
    // circulating, over a dark stain that keeps the pool sitting ON the floor rather than
    // glowing above it.
    const t = fx.t;
    const fade = fx.t > fx.duration - 0.4 ? clamp((fx.duration - fx.t) / 0.4, 0, 1) : Math.min(1, fx.t / 0.2);
    ctx2d.save();
    // Dark stain first — deliberately not purple-bright, so it grounds the effect and gives
    // the vapour something to read against instead of adding to the glow.
    const stainStops = fx.miasma ? MIASMA_STAIN_STOPS : POISON_STAIN_STOPS;
    const poolStops = fx.miasma ? MIASMA_POOL_STOPS : POISON_POOL_STOPS;
    // Cache keys differ per palette, or the first pool drawn would bake its colours for both.
    const stainKey = fx.miasma ? 'miasmaStain' : 'poisonStain';
    const poolKey = fx.miasma ? 'miasmaPool' : 'poisonPool';
    drawPuff(stainKey, stainStops, s.x, s.y, fx.radius * 0.95, fx.radius * 0.48, fade);
    const LOBES = 10;
    for (let i = 0; i < LOBES; i++) {
      const a = (i / LOBES) * Math.PI * 2 + t * 0.35;   // slow circulation
      // Held tighter than the splash's lobes: a pool should have a dense middle and a soft
      // edge, where an airburst is all edge.
      const wob = 0.44 + 0.16 * Math.sin(t * 1.6 + i * 1.3);
      const px = s.x + Math.cos(a) * fx.radius * wob;
      const py = s.y + Math.sin(a) * fx.radius * wob * 0.5;
      const pr = fx.radius * (0.40 + 0.12 * Math.sin(t * 2 + i * 1.7));
      drawPuff(poolKey, poolStops, px, py, pr, pr * 0.55, fade);
    }
    ctx2d.restore();
    for (let i = 0; i < 5; i++) {
      const bt = (t * 0.8 + i * 0.4) % 1;
      const bx = s.x + Math.sin(i * 2.3 + t) * fx.radius * 0.42;
      ctx2d.fillStyle = fx.miasma
        ? `rgba(150,220,110,${0.55 * (1 - bt) * fade})`
        : `rgba(190,130,220,${0.55 * (1 - bt) * fade})`;
      ctx2d.beginPath(); ctx2d.arc(bx, s.y - bt * 7, 1.4 + bt * 1.5, 0, Math.PI * 2); ctx2d.fill();
    }
  } else if (fx.kind === 'burningGround') {
    // A scorched patch licked by flickering flame with drifting embers.
    const t = fx.t;
    const grow = 1 + 1 * clamp(fx.t / fx.duration, 0, 1); // patch widens up to +100% over its life
    const fade = fx.t > fx.duration - 0.5 ? clamp((fx.duration - fx.t) / 0.5, 0, 1) : Math.min(1, fx.t / 0.3);
    ctx2d.save();
    ctx2d.translate(s.x, s.y); ctx2d.scale(1, 0.5);
    // The scorch mark itself: darkened toward the element rather than always charcoal, so a
    // frost-infused trail leaves rime on the ground instead of soot.
    const bgArt = fxArt(fx);
    ctx2d.globalAlpha = bgArt.deep ? 0.45 * fade : 1;
    ctx2d.fillStyle = bgArt.deep ? shadeHex(bgArt.deep, 0.5) : `rgba(30,14,6,${0.45 * fade})`;
    ctx2d.beginPath(); ctx2d.arc(0, 0, fx.radius * 0.85 * grow, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.globalAlpha = 1;
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
  } else if (fx.kind === 'unearth') {
    // Before the eruption: a swelling dirt mound with cracks spreading from its crown — the
    // ground bulging is the telegraph, read at a glance as "do not stand here". After: a burst
    // of thrown earth collapsing back down.
    const s2 = worldToScreen(fx.x, fx.y);
    if (!fx.erupted) {
      const k = clamp(fx.t / fx.eruptAt, 0, 1);
      ctx2d.save();
      ctx2d.globalAlpha = 0.5 + 0.3 * k;
      ctx2d.fillStyle = '#241c12';
      ctx2d.beginPath();
      ctx2d.ellipse(s2.x, s2.y, fx.radius * (0.5 + 0.5 * k), fx.radius * (0.32 + 0.32 * k) * 0.7, 0, 0, Math.PI * 2);
      ctx2d.fill();
      // Cracks crawl outward as the pressure builds.
      ctx2d.strokeStyle = `rgba(159,176,106,${0.35 + 0.5 * k})`;
      ctx2d.lineWidth = 1.5;
      ctx2d.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + fx.id;
        const len = fx.radius * k * (0.55 + ((fx.id * (i + 3)) % 5) * 0.09);
        let x = s2.x, y = s2.y;
        ctx2d.moveTo(x, y);
        for (let seg = 1; seg <= 2; seg++) {
          const wob = (((fx.id + i) * seg * 7) % 5 - 2) * 0.14;
          x += Math.cos(a + wob) * len * 0.5; y += Math.sin(a + wob) * len * 0.35;
          ctx2d.lineTo(x, y);
        }
      }
      ctx2d.stroke();
      ctx2d.restore();
    } else {
      const k = clamp((fx.t - fx.eruptAt) / (fx.duration - fx.eruptAt), 0, 1);
      ctx2d.save();
      ctx2d.globalAlpha = 1 - k;
      ctx2d.fillStyle = '#2e2415';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + fx.id;
        const fly = fx.radius * (0.3 + k * 1.1);
        const clod = 3.5 * (1 - k * 0.5);
        // Thrown up and falling back: height is a half-sine over the burst's own life.
        const lift = Math.sin(Math.min(1, k * 1.4) * Math.PI) * 26;
        ctx2d.fillRect(s2.x + Math.cos(a) * fly - clod / 2,
          s2.y + Math.sin(a) * fly * 0.6 - lift - clod / 2, clod, clod);
      }
      ctx2d.restore();
    }
  } else if (fx.kind === 'sandCloud') {
    // A slow-rolling dust cloud in the stage's sand palette. Fades in fast and out slow, and
    // drifts a little so a dashed line of clouds reads as one storm settling.
    const s2 = worldToScreen(fx.x, fx.y);
    const k = clamp(fx.t / fx.duration, 0, 1);
    const fade = Math.min(1, fx.t / 0.25) * (1 - Math.pow(k, 2));
    const tm2 = performance.now() / 1000;
    ctx2d.save();
    ctx2d.globalAlpha = 0.34 * fade;
    for (let i = 0; i < 3; i++) {
      const a = tm2 * 0.4 + i * 2.1 + fx.id;
      const wob = fx.radius * 0.25;
      drawPuff('sandCloud', SAND_CLOUD_STOPS,
        s2.x + Math.cos(a) * wob, s2.y + Math.sin(a) * wob * 0.6 - k * 6,
        fx.radius * (0.7 + i * 0.18));
    }
    ctx2d.restore();
  } else if (fx.kind === 'gravepull') {
    // Inward-raked claw marks over the swept arc: the arrows point AT the caster, because the
    // whole read is "this pulled them in" rather than "this pushed them away".
    const k = clamp(fx.t / fx.duration, 0, 1);
    const fade = 1 - k;
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'lighter';
    ctx2d.strokeStyle = `rgba(140,90,230,${0.55 * fade})`;
    ctx2d.lineWidth = 2.4;
    const RAKES = 7;
    for (let i = 0; i < RAKES; i++) {
      const a = fx.dir - fx.angle / 2 + (i / (RAKES - 1)) * fx.angle;
      // Each rake sweeps from the rim inward as the effect plays out.
      const r0 = fx.radius * (1 - k * 0.75);
      const r1 = r0 * 0.45;
      ctx2d.beginPath();
      ctx2d.moveTo(s.x + Math.cos(a) * r0, s.y + Math.sin(a) * r0 * 0.85);
      ctx2d.lineTo(s.x + Math.cos(a) * r1, s.y + Math.sin(a) * r1 * 0.85);
      ctx2d.stroke();
    }
    ctx2d.strokeStyle = `rgba(190,150,255,${0.4 * fade})`;
    ctx2d.lineWidth = 1.6;
    ctx2d.beginPath();
    ctx2d.ellipse(s.x, s.y, fx.radius * (1 - k * 0.75), fx.radius * (1 - k * 0.75) * 0.85,
      0, fx.dir - fx.angle / 2, fx.dir + fx.angle / 2);
    ctx2d.stroke();
    ctx2d.restore();
  } else if (fx.kind === 'unmaking') {
    // A dark cord with a bright filament, not a glowing beam — the void takes light away, so
    // its "beam" is a line of absence with an edge, same grammar as the flames and the bolt.
    const to = worldToScreen(fx.tx, fx.ty);
    const fade = fx.t > fx.duration - 0.15 ? clamp((fx.duration - fx.t) / 0.15, 0, 1) : 1;
    const tm2 = performance.now() / 1000;
    ctx2d.save();
    ctx2d.lineCap = 'round';
    ctx2d.globalAlpha = fade;
    ctx2d.strokeStyle = 'rgba(10,4,22,0.92)';
    ctx2d.lineWidth = fx.width;
    ctx2d.beginPath(); ctx2d.moveTo(s.x, s.y); ctx2d.lineTo(to.x, to.y); ctx2d.stroke();
    ctx2d.globalCompositeOperation = 'lighter';
    ctx2d.strokeStyle = `rgba(138,79,208,${0.4 + 0.2 * Math.sin(tm2 * 12)})`;
    ctx2d.lineWidth = fx.width * 0.55;
    ctx2d.beginPath(); ctx2d.moveTo(s.x, s.y); ctx2d.lineTo(to.x, to.y); ctx2d.stroke();
    ctx2d.globalCompositeOperation = 'source-over';
    ctx2d.strokeStyle = '#e2c4ff';
    ctx2d.lineWidth = 1.6;
    ctx2d.beginPath(); ctx2d.moveTo(s.x, s.y); ctx2d.lineTo(to.x, to.y); ctx2d.stroke();
    // Motes running UP the beam, from the target back to the caster: the target is being spent.
    for (let i = 0; i < 4; i++) {
      const f = ((tm2 * 0.9 + i * 0.25) % 1);
      const mx = to.x + (s.x - to.x) * f, my = to.y + (s.y - to.y) * f;
      ctx2d.fillStyle = `rgba(226,196,255,${(1 - f) * 0.9})`;
      ctx2d.fillRect(mx - 1.5, my - 1.5, 3, 3);
    }
    ctx2d.restore();
  } else if (fx.kind === 'saltcircle') {
    // Drawn on the GROUND, under the crowd: it is a line scratched in the dirt, not a bubble
    // around the player, and a filled dome would hide the very enemies it is holding back.
    const w = worldToScreen(fx.x, fx.y);
    const full = clamp((fx.charge || 0) / Math.max(1, fx.chargeCap), 0, 1);
    const flash = fx.flash || 0;
    ctx2d.save();
    // The ring itself: a scatter of grains rather than a clean stroke, so it reads as salt
    // thrown by hand. Seeded off the effect's own clock so it crawls slowly instead of
    // strobing — a ring that re-randomises every frame reads as static, not as a ward.
    const grains = 84;
    const spin = fx.t * 0.25;
    for (let i = 0; i < grains; i++) {
      const a = spin + (i / grains) * Math.PI * 2;
      // Deterministic per-grain wobble: the same grain keeps its offset frame to frame.
      const j = Math.sin(i * 12.9898) * 43758.5453;
      const wob = (j - Math.floor(j)) - 0.5;
      const rr = fx.radius + wob * 7;
      const gx = w.x + Math.cos(a) * rr, gy = w.y + Math.sin(a) * rr;
      // Fills clockwise with charge, so the ring doubles as its own progress bar — the player
      // reads "how close is the discharge" off the thing already in their peripheral vision.
      const lit = (i / grains) <= full;
      const sz = lit ? 2.4 : 1.6;
      ctx2d.fillStyle = lit
        ? `rgba(255,246,214,${0.75 + 0.25 * flash})`
        : 'rgba(201,191,168,0.45)';
      ctx2d.fillRect(gx - sz / 2, gy - sz / 2, sz, sz);
    }
    // A faint inner wash so the held ground reads as a place, not just an outline.
    const g = ctx2d.createRadialGradient(w.x, w.y, fx.radius * 0.55, w.x, w.y, fx.radius);
    g.addColorStop(0, 'rgba(201,191,168,0)');
    g.addColorStop(1, `rgba(226,214,182,${0.05 + 0.16 * full + 0.25 * flash})`);
    ctx2d.fillStyle = g;
    ctx2d.beginPath(); ctx2d.arc(w.x, w.y, fx.radius, 0, Math.PI * 2); ctx2d.fill();
    // The discharge, for the few frames it lasts.
    if (flash > 0) {
      ctx2d.globalCompositeOperation = 'lighter';
      ctx2d.strokeStyle = `rgba(255,250,230,${flash * 0.8})`;
      ctx2d.lineWidth = 2 + 6 * flash;
      ctx2d.beginPath();
      ctx2d.arc(w.x, w.y, fx.burstRadius * (1 - flash * 0.35), 0, Math.PI * 2);
      ctx2d.stroke();
    }
    ctx2d.restore();
  } else if (fx.kind === 'nullward') {
    // Every mouth, each showing the ward's SHARED fullness — they are one ward wearing several
    // faces, so a player reads "how close is this to going off" from any of them.
    if (!fx.mouths) return;
    const full = clamp(fx.eaten / Math.max(1, fx.capacity), 0, 1);
    const r = fx.eatRadius * (0.6 + 0.4 * full);
    for (const mo of fx.mouths) {
      const w = worldToScreen(mo.x, mo.y);
      ctx2d.save();
      // The gravity well's reach, drawn faintly — a pull you cannot see is a pull the player
      // cannot position around, which was half of why the ward felt useless.
      if (fx.pullRadius) {
        ctx2d.save();
        ctx2d.globalAlpha = 0.10 + 0.06 * Math.sin(performance.now() / 400);
        ctx2d.strokeStyle = '#7a56d2';
        ctx2d.lineWidth = 1.4;
        ctx2d.setLineDash([5, 9]);
        ctx2d.beginPath(); ctx2d.arc(w.x, w.y, fx.pullRadius, 0, Math.PI * 2); ctx2d.stroke();
        ctx2d.restore();
      }
      ctx2d.fillStyle = 'rgba(6,3,14,0.9)';
      ctx2d.beginPath(); ctx2d.arc(w.x, w.y, r, 0, Math.PI * 2); ctx2d.fill();
      ctx2d.globalCompositeOperation = 'lighter';
      ctx2d.strokeStyle = `rgba(120,90,235,${0.35 + 0.5 * full})`;
      ctx2d.lineWidth = 2 + 2 * full;
      ctx2d.beginPath(); ctx2d.arc(w.x, w.y, r + 2, 0, Math.PI * 2); ctx2d.stroke();
      // One pip per swallowed shot, so the count is readable rather than implied by brightness.
      ctx2d.fillStyle = '#c6b0ff';
      for (let i = 0; i < fx.eaten && i < 12; i++) {
        const a = (i / Math.max(1, fx.capacity)) * Math.PI * 2 - Math.PI / 2;
        ctx2d.beginPath(); ctx2d.arc(w.x + Math.cos(a) * (r + 8), w.y + Math.sin(a) * (r + 8), 1.6, 0, Math.PI * 2); ctx2d.fill();
      }
      ctx2d.restore();
    }
  } else if (fx.kind === 'soulStream') {
    // A consumed courtier: pale bone-light motes streaming along the line into the king. The
    // stream is the whole story of Marrow Harvest — bodies in, health up.
    const from = worldToScreen(fx.x, fx.y);
    const to = worldToScreen(fx.tx, fx.ty);
    const k = clamp(fx.t / fx.duration, 0, 1);
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const f = clamp(k * 1.5 - i * 0.13, 0, 1);
      const lx = from.x + (to.x - from.x) * f, ly = from.y + (to.y - from.y) * f;
      ctx2d.globalAlpha = (1 - f) * 0.8;
      // Bone-light for the Skeleton King's harvest, void-violet when the void is doing the
      // taking — same motion, so the shared reading is "something is being consumed".
      drawGlow(lx, ly, fx.voidTint ? '176,79,208' : '210,225,190', 9 - i * 1.5);
      ctx2d.fillStyle = fx.voidTint ? '#e2c4ff' : '#e8eeda';
      ctx2d.fillRect(lx - 1.5, ly - 1.5, 3, 3);
    }
    ctx2d.restore();
  } else if (fx.kind === 'curseRing') {
    // Gold judgement-light, broken by its two escape gaps. The gaps are drawn as absences —
    // the player reads "get to the dark part", which is exactly the instruction.
    const s2 = worldToScreen(fx.x, fx.y);
    const rr = fx.ringR || 46;
    const fade = clamp((fx.duration - fx.t) / 0.3, 0, 1);
    ctx2d.save();
    for (let g = 0; g < 2; g++) {
      const start = fx.gapA + g * Math.PI + CURSE_GAP_HALF;
      const end = fx.gapA + (g + 1) * Math.PI - CURSE_GAP_HALF;
      ctx2d.globalCompositeOperation = 'lighter';
      ctx2d.strokeStyle = `rgba(201,162,39,${0.3 * fade})`;
      ctx2d.lineWidth = 9;
      ctx2d.beginPath(); ctx2d.arc(s2.x, s2.y, rr, start, end); ctx2d.stroke();
      ctx2d.globalCompositeOperation = 'source-over';
      ctx2d.strokeStyle = `rgba(240,214,120,${0.9 * fade})`;
      ctx2d.lineWidth = 2.4;
      ctx2d.beginPath(); ctx2d.arc(s2.x, s2.y, rr, start, end); ctx2d.stroke();
    }
    ctx2d.restore();
  } else if (fx.kind === 'hollowRift') {
    // The singularity's grammar — a hole, not a glow — turned on the player. Dark disc, pale
    // violet rim, and inward streaks that say which way it is dragging you.
    const s2 = worldToScreen(fx.x, fx.y);
    const p01 = clamp(fx.t / fx.duration, 0, 1);
    const grow = p01 < 0.85 ? p01 / 0.85 : 1 - (p01 - 0.85) / 0.15;
    const core = fx.radius * 0.32 * grow;
    ctx2d.save();
    ctx2d.fillStyle = 'rgba(8,4,16,0.85)';
    ctx2d.beginPath(); ctx2d.ellipse(s2.x, s2.y, core, core * 0.7, 0, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.strokeStyle = `rgba(168,120,240,${0.5 + 0.4 * grow})`;
    ctx2d.lineWidth = 2.2;
    ctx2d.beginPath(); ctx2d.ellipse(s2.x, s2.y, core + 3, (core + 3) * 0.7, 0, 0, Math.PI * 2); ctx2d.stroke();
    // Streaks falling inward, staggered on their own phases.
    const tm2 = performance.now() / 1000;
    ctx2d.strokeStyle = 'rgba(140,100,210,0.5)';
    ctx2d.lineWidth = 1.4;
    ctx2d.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + i * 1.7;
      const ph = 1 - ((tm2 * 0.9 + i * 0.23) % 1);
      const r0 = fx.radius * (0.35 + 0.65 * ph), r1 = r0 - fx.radius * 0.14;
      ctx2d.moveTo(s2.x + Math.cos(a) * r0, s2.y + Math.sin(a) * r0 * 0.7);
      ctx2d.lineTo(s2.x + Math.cos(a) * Math.max(core, r1), s2.y + Math.sin(a) * Math.max(core, r1) * 0.7);
    }
    ctx2d.stroke();
    ctx2d.restore();
  } else if (fx.kind === 'hellhook') {
    // The chain drawn live from thrower to hook tip, the same link language as the tether
    // status — one visual for "chained", learned once.
    const from = worldToScreen(fx.x, fx.y);
    const tip = worldToScreen(fx.hx === undefined ? fx.x : fx.hx, fx.hy === undefined ? fx.y : fx.hy);
    const links = Math.max(2, Math.min(16, Math.round(dist(from.x, from.y, tip.x, tip.y) / 26)));
    ctx2d.save();
    ctx2d.strokeStyle = 'rgba(201,88,74,0.95)';
    ctx2d.lineWidth = 1.6;
    for (let i = 0; i < links; i++) {
      const f = (i + 0.5) / links;
      const lx = from.x + (tip.x - from.x) * f, ly = from.y + (tip.y - from.y) * f;
      const ang = Math.atan2(tip.y - from.y, tip.x - from.x) + (i % 2 ? Math.PI / 2 : 0);
      ctx2d.beginPath(); ctx2d.ellipse(lx, ly, 4.5, 2.6, ang, 0, Math.PI * 2); ctx2d.stroke();
    }
    // The hook head: a sharp open crescent, pointed the way it flies.
    const hang = Math.atan2(fx.ty - fx.y, fx.tx - fx.x);
    ctx2d.translate(tip.x, tip.y); ctx2d.rotate(hang);
    ctx2d.strokeStyle = '#c9cdd4'; ctx2d.lineWidth = 3; ctx2d.lineCap = 'round';
    ctx2d.beginPath(); ctx2d.arc(0, 0, 9, -0.4, Math.PI * 1.15); ctx2d.stroke();
    ctx2d.restore();
  } else if (fx.kind === 'voidOmen') {
    // A half-seen flicker at the edge of vision: two jagged strokes and a breath of glow, in
    // and gone. Deliberately underplayed — the omen works by being doubted.
    const k = clamp(fx.t / fx.duration, 0, 1);
    const a = Math.sin(k * Math.PI);
    const s2 = worldToScreen(fx.x, fx.y);
    ctx2d.save();
    ctx2d.globalAlpha = a * 0.7;
    ctx2d.globalCompositeOperation = 'lighter';
    drawGlow(s2.x, s2.y, '122,86,210', 46);
    ctx2d.strokeStyle = 'rgba(198,150,255,0.8)';
    ctx2d.lineWidth = 1.6;
    for (let i = 0; i < 2; i++) {
      ctx2d.beginPath();
      let px = s2.x + Math.sin(fx.seed * 3 + i * 7) * 10, py = s2.y - 26;
      ctx2d.moveTo(px, py);
      for (let sgm = 0; sgm < 4; sgm++) {
        px += Math.sin(fx.seed + i * 9 + sgm * 5 + fx.t * 40) * 9;
        py += 13;
        ctx2d.lineTo(px, py);
      }
      ctx2d.stroke();
    }
    ctx2d.restore();
  } else if (fx.kind === 'voidTear') {
    // The tear: a near-black fissure wearing the portal's void flames, so the player already
    // knows the vocabulary — this is the same wrongness the endless portal wears, arriving
    // early and uninvited. Opens over the first 0.4s, seals over the last 0.5s.
    const openK = clamp(fx.t / 0.4, 0, 1);
    const sealK = clamp((fx.duration - fx.t) / 0.5, 0, 1);
    const size = fx.radius * Math.min(openK, sealK);
    if (size > 1) {
      const s2 = worldToScreen(fx.x, fx.y);
      ctx2d.save();
      // The dark of it: a slashed ellipse, void-black with a bruised rim.
      ctx2d.translate(s2.x, s2.y);
      ctx2d.rotate(0.5 + Math.sin(fx.seed) * 0.3);
      const grad = ctx2d.createRadialGradient(0, 0, 0, 0, 0, size);
      grad.addColorStop(0, 'rgba(4,2,10,0.97)');
      grad.addColorStop(0.75, 'rgba(16,8,30,0.9)');
      grad.addColorStop(1, 'rgba(52,30,90,0.25)');
      ctx2d.fillStyle = grad;
      ctx2d.beginPath(); ctx2d.ellipse(0, 0, size, size * 0.42, 0, 0, Math.PI * 2); ctx2d.fill();
      ctx2d.strokeStyle = `rgba(126,74,214,${0.55 + 0.25 * Math.sin(performance.now() / 130)})`;
      ctx2d.lineWidth = 2;
      ctx2d.beginPath(); ctx2d.ellipse(0, 0, size, size * 0.42, 0, 0, Math.PI * 2); ctx2d.stroke();
      ctx2d.restore();
      // The flames are what sell it — the portal's own, at the tear's scale.
      drawVoidFlames(s2.x, s2.y, size * 0.8, fx.seed, { tongues: 7, lenMult: 1.15 });
    }
  } else if (fx.kind === 'singularity') {
    // Drawn as a HOLE, which is the whole point of the element: a black disc that grows as it
    // hauls, ringed by a bright rim, with the light around it bending inward. Every other effect
    // in the game adds light; this one takes it away, so it cannot be mistaken for anything else
    // on a screen already full of explosions.
    const p01 = clamp(fx.t / fx.duration, 0, 1);
    const art = fxArt(fx);
    // Grows while it pulls, then snaps shut at the end - the implosion is the payoff frame.
    const grow = p01 < 0.82 ? p01 / 0.82 : 1 - (p01 - 0.82) / 0.18;
    const core = fx.radius * 0.30 * grow;
    ctx2d.save();
    // Accretion: streaks spiralling inward, seeded so one collapse is not a copy of the next.
    ctx2d.globalCompositeOperation = 'lighter';
    ctx2d.strokeStyle = `rgba(${art.glowRgb || '122,86,210'},${0.5 * (1 - p01)})`;
    ctx2d.lineWidth = 1.4;
    ctx2d.beginPath();
    for (let i = 0; i < 10; i++) {
      const a0 = (i / 10) * Math.PI * 2 + fx.seed;
      const r0 = fx.radius * (0.45 + 0.55 * ((i * 3 + fx.seed) % 5) / 5);
      // Each streak winds in as the effect ages, so the field reads as rotating inward.
      const swirl = 1.7 * p01;
      for (let k = 0; k <= 6; k++) {
        const f = k / 6;
        const rr = r0 * (1 - f) + core * f;
        const aa = a0 + swirl * f;
        const px = s.x + Math.cos(aa) * rr, py = s.y + Math.sin(aa) * rr * 0.82;
        k ? ctx2d.lineTo(px, py) : ctx2d.moveTo(px, py);
      }
    }
    ctx2d.stroke();
    ctx2d.restore();
    ctx2d.save();
    // The hole itself. Painted opaque rather than blended, so it genuinely occludes.
    const g = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, core * 1.9);
    g.addColorStop(0, 'rgba(4,2,10,1)');
    g.addColorStop(0.62, `rgba(18,10,36,${0.92 * (1 - p01 * 0.3)})`);
    g.addColorStop(1, 'rgba(18,10,36,0)');
    ctx2d.fillStyle = g;
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, core * 1.9, 0, Math.PI * 2); ctx2d.fill();
    // Rim light, brightest as it snaps shut.
    ctx2d.globalCompositeOperation = 'lighter';
    ctx2d.strokeStyle = `rgba(232,226,255,${0.35 + 0.5 * p01})`;
    ctx2d.lineWidth = 1.6 + 1.6 * p01;
    ctx2d.beginPath(); ctx2d.arc(s.x, s.y, core, 0, Math.PI * 2); ctx2d.stroke();
    ctx2d.restore();
  } else if (fx.kind === 'frostCloud') {
    // The hanging mist an Ice Bomb leaves in the air, as opposed to the rimed patch it leaves on
    // the floor. Deliberately the opposite read to the iceBurst it follows: that one is brittle
    // and snaps outward, this one is soft, billows slowly and drifts. Drawn in the airborne pass
    // (it is not in GROUND_FX) so it hangs over bodies rather than being walked on.
    //
    // Fades IN fast and OUT slow across the last 45% of its life — a mist that vanished on a
    // timer would pop, and this one is on screen for seconds rather than a fraction of one.
    const p = clamp(fx.t / fx.duration, 0, 1);
    const fade = Math.min(1, fx.t / 0.18) * (p > 0.55 ? clamp((1 - p) / 0.45, 0, 1) : 1) * cloudStackDim;
    if (fade > 0.004) {
      // Puffs are seeded off the effect id, so one cloud is not a copy of the next but any given
      // cloud is stable frame to frame rather than boiling.
      if (!fx.puffs) {
        fx.puffs = [];
        const n = 7;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + fx.id * 0.9;
          const rr = fx.radius * (0.1 + 0.42 * ((i * 5 + fx.id) % 7) / 7);
          fx.puffs.push({
            x: Math.cos(a) * rr, y: Math.sin(a) * rr * 0.7,   // squashed: it sits on the ground
            sz: fx.radius * (0.34 + 0.2 * ((i * 3 + fx.id) % 5) / 5),
            drift: 0.35 + 0.5 * ((i * 11 + fx.id) % 4) / 4,
            rise: 5 + ((i * 7 + fx.id) % 6),
            phase: (i * 1.7 + fx.id) % (Math.PI * 2),
          });
        }
      }
      ctx2d.save();
      for (const q of fx.puffs) {
        // Each puff creeps outward from the centre and lifts a little over the cloud's life, so
        // the mass loosens as it dies instead of shrinking in place.
        const grow = 1 + p * 0.55;
        const px = s.x + q.x * (1 + p * q.drift) + Math.sin(q.phase + fx.t * 0.8) * 3;
        const py = s.y + q.y * (1 + p * q.drift) - p * q.rise;
        const rad = q.sz * grow;
        const g = ctx2d.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, `rgba(226,244,255,${0.3 * fade})`);
        g.addColorStop(0.55, `rgba(176,215,238,${0.15 * fade})`);
        g.addColorStop(1, 'rgba(150,195,225,0)'); // transparent rim, so puffs blend into each other
        ctx2d.fillStyle = g;
        ctx2d.beginPath(); ctx2d.arc(px, py, rad, 0, Math.PI * 2); ctx2d.fill();
      }
      // A few motes of frost suspended in it, on 'lighter' so they read as glints against the
      // mist rather than more grey.
      ctx2d.globalCompositeOperation = 'lighter';
      ctx2d.fillStyle = `rgba(232,250,255,${0.5 * fade})`;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + fx.id * 0.5 + fx.t * 0.35;
        const rr = fx.radius * (0.2 + 0.6 * ((i * 3 + fx.id) % 5) / 5) * (1 + p * 0.4);
        const mx = s.x + Math.cos(a) * rr;
        const my = s.y + Math.sin(a) * rr * 0.7 - p * 9;
        ctx2d.beginPath(); ctx2d.arc(mx, my, 1.1, 0, Math.PI * 2); ctx2d.fill();
      }
      ctx2d.restore();
    }
  } else if (fx.kind === 'electroField') {
    // One crackling arc to each tethered foe, plus its chained links.
    // The arc generator already takes a jag amplitude, so `amp` and `segs` drive it directly —
    // frost tethers snap into few straight facets, shock ones scribble wider.
    const eArt = fxArt(fx);
    const targets = fx.targets || [];
    for (let i = 0; i < targets.length; i++) {
      const tp = worldToScreen(targets[i].x, targets[i].y);
      drawElectroArc(s.x, s.y, tp.x, tp.y, eArt);
      // Every branch restarts from the tethered foe, so forks read as a splitting tree.
      const paths = (fx.links && fx.links[i]) || [];
      for (const pts of paths) {
        let px = targets[i].x, py = targets[i].y;
        for (const cp of pts) {
          const p1 = worldToScreen(px, py), p2 = worldToScreen(cp.x, cp.y);
          drawElectroArc(p1.x, p1.y, p2.x, p2.y, eArt);
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

function drawElectroArc(x1, y1, x2, y2, art = NO_INFUSION) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const perpX = -dy / len, perpY = dx / len;
  // Shorter segments + alternating offsets give a proper crackling zig-zag instead of a
  // near-straight beam. Widths are +15% over the original 3 / 1.3.
  //
  // The element drives the zig-zag directly: `segs` sets how finely the tether is chopped and
  // `amp` how far it throws. A frost tether becomes a few long straight facets, a shock one
  // scribbles wider than the baseline — the same generator, different numbers.
  // Clamped to a sane band as well as floored: `len` between two live entities is bounded by
  // the arena, so anything past ~400 segments means a corrupted coordinate got this far — and
  // the draw should degrade, never decide the frame does not end.
  const segs = Math.min(400, Math.max(3, Math.floor((len / 11) * (art.segs || 1)) || 3));
  const pts = zigzagPolyline(x1, y1, x2, y2, segs, 7 * (art.amp || 1), perpX, perpY);
  ctx2d.save();
  ctx2d.lineCap = art.snap > 0 ? 'butt' : 'round'; // no shadowBlur: bloom already haloes these
  ctx2d.lineJoin = art.snap > 0 ? 'miter' : 'round';
  ctx2d.globalAlpha = art.deep ? 0.5 : 1;
  ctx2d.strokeStyle = tint(art, 'deep', 'rgba(120,200,255,0.5)');
  ctx2d.lineWidth = 3.45 + art.swell * 2; strokePolyline(pts);
  ctx2d.globalAlpha = 1;
  ctx2d.strokeStyle = tint(art, 'core', '#eaf7ff'); ctx2d.lineWidth = 1.5; strokePolyline(pts);
  ctx2d.globalAlpha = art.mid ? 0.85 : 1;
  ctx2d.fillStyle = tint(art, 'mid', 'rgba(180,230,255,0.85)');
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
    // A little red potion flask, gently bobbing. 1.5 x 1.15 -- the art was already drawn half
    // again its base size, and this is a further 15% on top. Visual only: pk.radius still
    // drives collection, so what you see is not bigger than what you can pick up.
    const bob = Math.sin(performance.now() / 260 + pk.id) * 1.5;
    ctx2d.save();
    ctx2d.translate(s.x, s.y + bob);
    ctx2d.scale(1.725, 1.725);
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
    // A GAMBIT wears a red seal over the lock: the chest is telling the truth about the fight
    // it will start, so opening one is a choice and never an ambush.
    if (pk.gambit) {
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 260 + pk.id);
      ctx2d.fillStyle = `rgba(217,74,47,${pulse})`;
      ctx2d.beginPath();
      ctx2d.moveTo(0, -8.6); ctx2d.lineTo(3.4, -6.4); ctx2d.lineTo(2.2, -2.6);
      ctx2d.lineTo(-2.2, -2.6); ctx2d.lineTo(-3.4, -6.4); ctx2d.closePath(); ctx2d.fill();
      ctx2d.fillStyle = 'rgba(255,225,200,0.85)';
      ctx2d.fillRect(-0.5, -7.2, 1, 2.6); ctx2d.fillRect(-0.5, -3.9, 1, 1);
    }
    // A MIMIC gets the barest tell — one wrong tooth in the lid seam, and only sometimes.
    // Enough that a player who has been bitten starts LOOKING, which is the whole fun of it,
    // but never enough to be a reliable read.
    if (pk.mimic && Math.sin(performance.now() / 900 + pk.id * 2.7) > 0.72) {
      ctx2d.fillStyle = '#e8e0d0';
      ctx2d.beginPath();
      ctx2d.moveTo(-3, -1.2); ctx2d.lineTo(-2, 0.6); ctx2d.lineTo(-1, -1.2); ctx2d.closePath();
      ctx2d.fill();
    }
    ctx2d.restore();
  } else if (pk.kind === 'key') {
    // A small silver fantasy key, bobbing with a bright glint.
    const bob = Math.sin(performance.now() / 240 + pk.id) * 1.4;
    ctx2d.save();
    ctx2d.translate(s.x, s.y + bob);
    ctx2d.scale(2.3, 2.3); // 2x base art, then a further 15% -- see the potion above
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

// Damage number type sizes, 60% up from the previous 16 / 22. Kept as named constants because
// the outline width is derived from them — hardcoding the sizes inline meant the stroke stayed
// at 3px while the glyphs grew, which reads as a progressively thinner outline.
const DMG_FONT_PX = 26;        // 16 x 1.6
const DMG_CRIT_FONT_PX = 35;   // 22 x 1.6
const DMG_OUTLINE_RATIO = 3 / 16;   // the original 3px stroke against the original 16px type

function drawDamageNumber(d) {
  const s = worldToScreen(d.x, d.y);
  // The camera moves, so a number that was on screen when it spawned may not be now. strokeText
  // is among the most expensive calls in canvas 2D — it rasterises the glyph outline as a path —
  // and this is two of them per number, so skipping one entirely is worth the branch.
  if (!onScreen(s.x, s.y, DMG_CULL_MARGIN)) return;
  ctx2d.globalAlpha = clamp(1 - d.t / d.life, 0, 1);
  // Pixel font to match the rest of the game's type. Sized well above the old serif: a pixel
  // face reads smaller at the same nominal size, and these have to stay legible over a lit-up
  // crowd.
  const px = d.isCrit ? DMG_CRIT_FONT_PX : DMG_FONT_PX;
  // Assigning ctx.font re-parses the shorthand and can re-resolve the face, so it is skipped
  // when unchanged. With hundreds of numbers a frame and only two sizes in play, almost every
  // assignment after the first was setting it to what it already was.
  const want = `bold ${px}px "Pixelify Sans", sans-serif`;
  if (dmgFontCache !== want) { ctx2d.font = want; dmgFontCache = want; }
  ctx2d.textAlign = 'center';
  // Dark outline first. Without it the numbers vanish against fire, beams and poison clouds —
  // the exact moments there are numbers worth reading. Scaled with the type so the weight of
  // the outline stays constant relative to the glyphs.
  ctx2d.lineWidth = px * DMG_OUTLINE_RATIO;
  ctx2d.lineJoin = 'round';
  ctx2d.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx2d.strokeText(d.text, s.x, s.y, 200);
  ctx2d.fillStyle = d.color;
  ctx2d.fillText(d.text, s.x, s.y, 200);
  ctx2d.globalAlpha = 1;
}

function drawPauseDim() {
  ctx2d.fillStyle = 'rgba(0,0,0,0.55)';
  ctx2d.fillRect(0, 0, viewW, viewH);
}

function startClassSelect() {
  S.state = 'START';
  ui.hideMainMenu();
  ui.showClassSelect(CLASSES, (classDef) => {
    resetGame(classDef);
    ui.hideClassSelect();
    S.state = 'PLAYING';
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
  enemy: { id: null, count: 50, behaviour: 'hunt', line: false, infiniteHp: false, spacing: 1 },
  // A stage boss, placed on its own. Off unless asked for: a boss is the one thing here that
  // fights back hard, so it must never appear in a scenario the player did not ask it into.
  boss: { id: null, infiniteHp: false },
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

// ---------- Stage portal ----------
// Dropped where a non-final boss falls. Walking into it advances the stage, so the player
// decides when the stage ends instead of the kill deciding for them.
const PORTAL_RADIUS = 46;
const PORTAL_OPEN_TIME = 0.9;   // the vortex spins up before it will carry anyone
// The mouth is smaller than the stone ring — you step INTO the swirl, not onto the kerb.
const PORTAL_MOUTH = 0.66;
/** @type {{x:number,y:number,radius:number,t:number,armed:boolean,stones:object[]}|null} */
let stagePortal = null;

// ---------- Portal pressure ----------
// Killing a stage boss does not end the fight — it opens a door and starts a siege. The longer
// the player lingers to loot, the harder the stage pushes back: more spawns, faster and tougher
// bodies, and a rising red on everything that arrives. Stepping through the portal ends it.
//
// The whole phase is keyed off `stagePortal` existing, which is what makes it stage 1 and 2 only
// with no extra condition: the final boss goes to onBossDefeated and never opens a portal.
//
// The escalation is deliberately a RISK/REWARD dial, not a punishment. Everything the boss just
// dropped is still on the floor; staying to collect it is the player's choice to make, and the
// red on the horde is how expensive that choice has become.
const PRESSURE_FULL = 45;        // seconds to reach full intensity — the visual tops out here
const PRESSURE_SPAWN = 2.6;      // spawn rate multiplier at full intensity
const PRESSURE_SPEED = 0.55;     // +55% enemy speed at full
const PRESSURE_HP = 1.8;         // +180% health at full
const PRESSURE_DAMAGE = 0.9;     // +90% damage at full

/** 0 while no portal stands; otherwise 0..1 as the siege builds. */
function pressureLevel() {
  if (!stagePortal) return 0;
  return clamp(stagePortal.t / PRESSURE_FULL, 0, 1);
}

// How hard a pressured body throws the player on contact, and how long that impulse takes to
// bleed off. Scaled by the ATTACKER's own pressure, so a straggler born before the siege still
// hits like it always did and normal play is untouched — the shove is something the red ones
// bring with them. Late in a siege the horde genuinely pushes the player around the arena,
// which is the point: standing still to keep looting stops being a thing you can do.
const PRESSURE_KNOCKBACK = 420;      // px/s at full intensity
const PRESSURE_KNOCK_TIME = 0.22;    // seconds for it to bleed off

// Called on every LANDED contact hit (mob melee and boss body alike) — which makes it the one
// place the Warrior's plate answers back from, before the shove maths this was named for.
function shovePlayerFrom(e) {
  // Any landed touch breaks the Shinobi's First Strike mark for good — see damageEnemy.
  e.touchedPlayer = true;
  // Spiked plate: the body that struck him takes armor-scaled damage. Scales off MAX armor,
  // not what is currently standing — the spikes are bolted to the plate, not to the shield
  // charge — so every +armor item keeps feeding his offense even mid-brawl.
  if (S.player.spikedPlate && !e.dead) {
    damageEnemy(e, THORNS_BASE + S.player.armor * THORNS_PER_ARMOR, {}, {});
  }
  // Immovable: the hit still hurt, but it moves him nowhere.
  if (S.player.immovable) return;
  const p = e.pressure || 0;
  if (p <= 0.02) return;
  const n = normalize(S.player.x - e.x, S.player.y - e.y);
  // Directly away from whatever hit you. Coincident to the pixel (a body standing exactly on
  // the player) would normalize to zero, so fall back to shoving along its facing.
  const dx = n.x || e.dirX || 1;
  const dy = n.y || e.dirY || 0;
  const dir = normalize(dx, dy);
  const power = PRESSURE_KNOCKBACK * p;
  // Impulses ADD rather than replace: being hit by three things at once should throw the player
  // further than being hit by one, and replacing would let the last hit quietly cancel the rest.
  S.player.shoveX = (S.player.shoveX || 0) + dir.x * power;
  S.player.shoveY = (S.player.shoveY || 0) + dir.y * power;
  S.player.shoveT = PRESSURE_KNOCK_TIME;
}

function spawnStagePortal(x, y) {
  // TWO guards against the portal opening under the player's feet, because a melee kill lands
  // exactly there and swallowing them instantly would cost them the whole reward:
  //
  //  1. Nudge it clear if they are standing in the mouth. Cheap, and it also stops the swirl
  //     being hidden behind the player sprite at the moment it appears.
  const clear = PORTAL_RADIUS * PORTAL_MOUTH + S.player.radius + 24;
  const away = normalize(x - S.player.x, y - S.player.y);
  const d = dist(x, y, S.player.x, S.player.y);
  if (d < clear) {
    // Coincident to the pixel: normalize returns a zero vector, so fall back to shoving it
    // opposite the way the player is facing — behind them, never into their path.
    const dx = away.x || -S.player.facing.x || 0;
    const dy = away.y || -S.player.facing.y || 1;
    const n = normalize(dx, dy);
    x = S.player.x + n.x * clear;
    y = S.player.y + n.y * clear;
    // Keep it inside the arena; a boss felled against the wall must not push it out of bounds.
    const lim = ARENA_RADIUS - PORTAL_RADIUS * 1.5;
    x = clamp(x, -lim, lim); y = clamp(y, -lim, lim);
  }
  //  2. It stays inert until the player has been OUTSIDE it once (see updateStagePortal), so
  //     even if the nudge is clamped back onto them it still cannot fire on its own.
  // Stones are rolled ONCE and kept. Rolling them per frame would make the ring crawl and
  // shimmer; the only thing that should move here is the vortex.
  const stones = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
    stones.push({
      a,
      // Set OUTSIDE the swirl, not on its rim. At 1.0–1.14 they sat exactly on the bright edge
      // and the glow swallowed them — the ring was invisible at play size.
      dist: PORTAL_RADIUS * rand(1.3, 1.48),
      w: rand(10, 16), h: rand(9, 14),
      tilt: rand(-0.5, 0.5),
      shade: rand(0, 1),
    });
  }
  stagePortal = { x, y, radius: PORTAL_RADIUS, t: 0, armed: false, stones };
  play('bossSpawn');
  ui.showStageCard('HORDE RUSH!', 'Riches while it lasts — then step into the portal.', 'blood');
  ui.showToast('A Way Onward', 'Gather what you can, then step into the portal.', '#8a4fd0');
}

function updateStagePortal(dt) {
  if (!stagePortal) return;
  stagePortal.t += dt;
  const touching = dist(S.player.x, S.player.y, stagePortal.x, stagePortal.y)
    <= stagePortal.radius * PORTAL_MOUTH + S.player.radius;
  // Armed only once the player is clear of it. A melee kill lands standing on the corpse, so a
  // portal that could fire on the frame it appeared would swallow the player instantly — and
  // take with it the drops it exists to let them collect.
  if (!touching && stagePortal.t >= PORTAL_OPEN_TIME) stagePortal.armed = true;
  if (touching && stagePortal.armed) {
    stagePortal = null;
    advanceStage();
  }
}

// A purple vortex ringed by small standing stones. Everything is drawn from the clock, so it
// animates without needing any art: the swirl turns, the throat pulses, and motes spiral inward
// and wink out at the centre.
/**
 * The dash streak: a tapering smear along the path just travelled, fading over its lifetime.
 * Drawn under the sprite band so the character stays legible on top of it.
 */
function drawDashStreak(fx) {
  const k = 1 - fx.t / fx.duration;                 // 1 at spawn, 0 when spent
  if (k <= 0) return;
  const s = worldToScreen(fx.x, fx.y);
  ctx2d.save();
  ctx2d.translate(s.x, s.y);
  ctx2d.rotate(fx.dir);
  // Behind the player, so it points back the way they came.
  const g = ctx2d.createLinearGradient(0, 0, -fx.len, 0);
  g.addColorStop(0, `rgba(230,240,255,${0.55 * k})`);
  g.addColorStop(1, 'rgba(230,240,255,0)');
  ctx2d.fillStyle = g;
  const h = 13 * k;
  ctx2d.beginPath();
  ctx2d.moveTo(0, -h);
  ctx2d.lineTo(-fx.len, -h * 0.15);
  ctx2d.lineTo(-fx.len, h * 0.15);
  ctx2d.lineTo(0, h);
  ctx2d.closePath();
  ctx2d.fill();
  ctx2d.restore();
}

function drawStagePortal() {
  const p = stagePortal;
  const s = worldToScreen(p.x, p.y);
  if (!onScreen(s.x, s.y, p.radius * 2.4)) return;
  // Opens with a swell rather than appearing at full size.
  const open = clamp(p.t / PORTAL_OPEN_TIME, 0, 1);
  const grow = open < 1 ? 0.35 + 0.65 * (1 - Math.pow(1 - open, 3)) : 1;
  const r = p.radius * grow;
  const spin = p.t * 1.9;
  // Slow breath, so a portal left standing while the player loots never looks frozen.
  const pulse = 1 + Math.sin(p.t * 2.6) * 0.05;

  ctx2d.save();
  ctx2d.translate(s.x, s.y);

  // Ground shadow under the whole thing, squashed to sit flat.
  ctx2d.save();
  ctx2d.scale(1, 0.42);
  ctx2d.beginPath(); ctx2d.arc(0, 10, r * 1.2, 0, Math.PI * 2);
  ctx2d.fillStyle = 'rgba(0,0,0,0.45)'; ctx2d.fill();
  ctx2d.restore();

  // The swirl itself is drawn squashed too — it is a hole in the FLOOR, and a true circle
  // would read as a sphere standing upright in a top-down view.
  ctx2d.save();
  ctx2d.scale(1, 0.62);

  // Throat: bright rim falling away to near-black at the centre.
  const g = ctx2d.createRadialGradient(0, 0, r * 0.06, 0, 0, r * pulse);
  g.addColorStop(0, '#120a1e');
  g.addColorStop(0.45, '#5b2c9e');
  g.addColorStop(0.8, '#a05fe0');
  g.addColorStop(1, 'rgba(138,79,208,0)');
  ctx2d.beginPath(); ctx2d.arc(0, 0, r * pulse, 0, Math.PI * 2);
  ctx2d.fillStyle = g; ctx2d.fill();

  // Spiral arms. Each is an arc walked outward while the angle advances, so it winds — three
  // of them, evenly spaced and counter-rotating against the motes for a sense of depth.
  ctx2d.lineCap = 'round';
  for (let arm = 0; arm < 3; arm++) {
    ctx2d.beginPath();
    for (let i = 0; i <= 22; i++) {
      const f = i / 22;
      const rad = r * (0.12 + f * 0.86);
      const ang = -spin + (arm / 3) * Math.PI * 2 + f * 2.6;
      const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
      if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
    }
    ctx2d.strokeStyle = 'rgba(214,170,255,0.5)';
    ctx2d.lineWidth = Math.max(1, r * 0.07);
    ctx2d.stroke();
  }

  // Motes drawn inward. Each has its own phase so they do not arrive in step.
  for (let i = 0; i < 7; i++) {
    const ph = ((p.t * 0.85) + i / 7) % 1;
    const rad = r * (1.02 - ph * 0.95);
    const ang = spin * 1.5 + i * 2.39;
    const a = Math.sin(ph * Math.PI);       // fades in at the rim, out at the throat
    ctx2d.globalAlpha = a * 0.9;
    ctx2d.fillStyle = '#e8d2ff';
    const m = Math.max(1, r * 0.055);
    ctx2d.fillRect(Math.cos(ang) * rad - m / 2, Math.sin(ang) * rad - m / 2, m, m);
  }
  ctx2d.globalAlpha = 1;
  ctx2d.restore();

  // Glow is tight to the mouth and additive. It used to be r*1.5 and drawn over everything,
  // which washed the whole stone ring out to a flat magenta blob at play size.
  drawGlow(0, 0, '150,90,225', r * 0.95 * pulse);

  // The stone ring. Drawn after the swirl so the near stones occlude its edge, and squashed on
  // the same axis so the circle lies flat on the ground with the portal.
  for (const st of p.stones) {
    const x = Math.cos(st.a) * st.dist * grow;
    const y = Math.sin(st.a) * st.dist * grow * 0.62;
    ctx2d.save();
    ctx2d.translate(x, y);
    ctx2d.rotate(st.tilt);
    const w = st.w * grow, h = st.h * grow;
    ctx2d.fillStyle = 'rgba(0,0,0,0.55)';
    ctx2d.fillRect(-w / 2 - 1, -h / 2 + 3, w + 2, h);         // each stone's own shadow
    // Dark keyline first, then the face inside it: without the outline the stones dissolve into
    // whichever floor tile they happen to be standing on.
    ctx2d.fillStyle = '#221f1a';
    ctx2d.fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
    ctx2d.fillStyle = st.shade > 0.5 ? '#8b8474' : '#6e675a';
    ctx2d.fillRect(-w / 2, -h / 2, w, h);
    ctx2d.fillStyle = st.shade > 0.5 ? '#b3ab97' : '#918975'; // lit top face
    ctx2d.fillRect(-w / 2, -h / 2, w, Math.max(1, h * 0.34));
    // A touch of caught purple on the face turned toward the swirl. Light, not a wash.
    ctx2d.fillStyle = 'rgba(160,95,224,0.16)';
    ctx2d.fillRect(-w / 2, -h / 2, w, h);
    ctx2d.restore();
  }

  // A crown of void fire, drawn LAST so the tongues lick over the stones rather than hiding
  // behind them. Everything else about this portal lies flat in the floor — squashed swirl,
  // squashed ring, squashed shadow — which is exactly why it disappears into a dark stage. The
  // flames are only lightly squashed (0.8, not the 0.62 used elsewhere) so they stand up out of
  // the ground plane and give the eye something with height to catch.
  ctx2d.save();
  ctx2d.scale(1, 0.8);
  drawVoidFlames(0, 0, r, 0, {
    ring: true, tongues: 9, root: 1.02, lenMult: 0.62,
    spin: 0.28,     // a slow turn, against the swirl's own spin
    pool: false,    // the portal already has a shadow and a black throat
  });
  ctx2d.restore();
  ctx2d.restore();
}

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
  S.player.godMode = sandboxCfg.godMode;
  applySandboxLoadout();
  S.currentStage = clamp(sandboxCfg.stage, 0, STAGES.length - 1);
  backdropStage = S.currentStage; floorShift = null;
  stagePortal = null;   // a portal from the stage just left must not stand in the new one
  floorPattern = makeFloorPattern(STAGES[S.currentStage]);
  scatterDecor(STAGES[S.currentStage]);
  playMusic(`stage${S.currentStage + 1}`); // follow the stage into its own playlist
  S.enemies = [];
  spawnSandboxEnemies();
  sandboxButton = { ...SANDBOX_BUTTON, armed: true };
  sandboxLive = false;
  S.state = 'PLAYING';
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

// Start a REAL run at the chosen stage — the wave spawner, the boss clock and stage progression
// all switched on — rather than a sandbox scenario. This is the opposite of Begin: Begin builds
// a still life to measure one thing against, while this plays the actual game from a chosen
// realm so a later stage can be tested without grinding the earlier ones to reach it.
//
// The scenario the sandbox screen has configured is deliberately NOT applied. A stage is being
// tested as it ships — its own pools, pacing and starting loadout — and quietly carrying the
// player's placed horde or hand-set skills into it would be testing something else.
function startStageRun(stageIndex) {
  ui.hideSandbox();
  sandboxLive = false;
  resetGame(sandboxClassDef(), stageIndex);
  ui.showHud(false);   // the full HUD: this run scores XP and gold like any other
  S.state = 'PLAYING';
}

function showSandboxSetup() {
  S.state = 'SANDBOX';
  playMusic('shop');   // see openShop: shared "standing still, reading numbers" playlist
  ui.showSandbox(sandboxCfg, {
    // Skill defs are keyed by id but do not carry it as a field, so it has to be attached
    // here — the picker writes cfg entries by id and would otherwise key them all 'undefined'.
    classes: CLASSES,
    stages: STAGES,
    live: sandboxLive,
    skills: SKILL_ORDER.map((id) => ({ id, ...SKILLS[id] })),
    tomes: SUPPORT_ORDER.map((id) => ({ id, ...SUPPORTS[id] })),
    enemies: sandboxEnemyList(),
    bosses: sandboxBossList(),
  }, {
    // Applies immediately as well as at launch, so it can be flipped for a run already up.
    onPickClass: (id) => {
      sandboxCfg.classId = id;
      // Mid-run: rebuild the body in place. Position is preserved so the scenario around
      // the player is untouched — only who is standing in it changes.
      if (S.player && sandboxMode) {
        const at = { x: S.player.x, y: S.player.y };
        S.player = createPlayer(CLASSES.find((c) => c.id === id));
        S.player.x = at.x; S.player.y = at.y;
        S.player.godMode = sandboxCfg.godMode;
        applySandboxLoadout();
      }
      showSandboxSetup();
    },
    onPickStage: (i) => { sandboxCfg.stage = i; showSandboxSetup(); },
    onPlayStage: (i) => startStageRun(i),
    onToggleGod: () => { sandboxCfg.godMode = !sandboxCfg.godMode; if (S.player) S.player.godMode = sandboxCfg.godMode; showSandboxSetup(); },
    onToggleSkill: (id) => { sandboxCfg.skills[id] ? delete sandboxCfg.skills[id] : sandboxCfg.skills[id] = 1; showSandboxSetup(); },
    onSetSkillLevel: (id, lvl) => { if (lvl <= 0) delete sandboxCfg.skills[id]; else sandboxCfg.skills[id] = lvl; showSandboxSetup(); },
    onToggleTome: (id) => { sandboxCfg.tomes[id] ? delete sandboxCfg.tomes[id] : sandboxCfg.tomes[id] = 1; showSandboxSetup(); },
    // Level changes come from a slider dragged continuously, so this must NOT rebuild the
    // screen — doing so would destroy the input mid-drag and drop the pointer capture.
    onSetTomeLevel: (id, lvl) => {
      if (lvl <= 0) delete sandboxCfg.tomes[id]; else sandboxCfg.tomes[id] = lvl;
      if (S.player) applySandboxLoadout(); // live retune while a sandbox run is up
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
    onPickBoss: (id) => { sandboxCfg.boss.id = sandboxCfg.boss.id === id ? null : id; showSandboxSetup(); },
    onBossOpt: (key, v) => { sandboxCfg.boss[key] = v; showSandboxSetup(); },
    paintClass: (cv, id) => drawEnemyPortrait(cv, id, CLASSES.find((c) => c.id === id).color),
    paintEnemy: (cv, id) => paintEnemyPortrait(cv, id),
    // Bosses are keyed by their own id but drawn from spriteId, so the painter takes the
    // sprite rather than the id every other picker here passes.
    paintBoss: (cv, spriteId) => paintEnemyPortrait(cv, spriteId),
  });
}

// Every stage's boss, in stage order. Read off STAGES rather than listed by hand, so a stage
// added later brings its boss to this screen with nothing else to update.
function sandboxBossList() {
  return STAGES.filter((s) => s.boss).map((s, i) => ({
    id: s.boss.id, name: s.boss.name, spriteId: s.boss.spriteId, stageIndex: i,
  }));
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
  S.player.activeSkills = Object.entries(sandboxCfg.skills).map(([id, level]) => ({ id, level, cd: 0 }));
  S.player.supports = { ...sandboxCfg.tomes };
  // Caps exist to force choices in a real run; in the sandbox they would only get in the way.
  S.player.skillCap = Math.max(S.player.activeSkills.length, 99);
  S.player.supportCap = 99;
}

function startSandboxRun() {
  ui.hideSandbox();
  resetGame(sandboxClassDef(), sandboxCfg.stage);
  sandboxMode = true;
  S.player.godMode = sandboxCfg.godMode;
  // Sandbox skips the class-select carousel, which is what normally reveals the HUD — so it
  // has to be shown explicitly here, in its no-XP/no-gold mode.
  ui.showHud(true);
  applySandboxLoadout();
  spawnSandboxEnemies();
  spawnSandboxBoss();
  sandboxButton = { ...SANDBOX_BUTTON, armed: true };
  S.state = 'PLAYING';
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
  const originX = S.player.x - ((cols - 1) * step) / 2;
  const originY = S.player.y - 260 - ((rows - 1) * step) / 2;
  const lim = ARENA_RADIUS - 40;
  for (let i = 0; i < n; i++) {
    const cx = i % cols, cy = Math.floor(i / cols);
    // The sandbox rolls sizes too. It is the screen you use to LOOK at a monster, so showing
    // the clone army the wave spawner no longer produces would be actively misleading.
    const sizeScale = rollSizeScale(type);
    const hp = cfg.infiniteHp ? Infinity : type.hp * Math.pow(sizeScale, SIZE_HP_EXP);
    S.enemies.push({
      ...type, id: S.nextId++, spriteId: cfg.id,
      x: clamp(originX + cx * step, -lim, lim),
      y: clamp(originY + cy * step, -lim, lim),
      radius: type.radius * sizeScale,
      hp, maxHp: hp,
      dead: false, hitCd: 0,
      sandboxPassive: cfg.behaviour === 'ignore',  // stands its ground instead of hunting
      sandboxWander: cfg.behaviour === 'wander',   // ambles off on its own
      invulnerable: cfg.infiniteHp,
    });
  }
}

// Places the chosen boss, if any. Built the same way spawnBoss() builds the real one so it
// behaves identically — same stats, same slam, same rock throw — but WITHOUT the boss-fight
// machinery: no S.bossSpawned, no boss music, no victory when it dies. The sandbox has no
// director, and a boss that ended the scenario would defeat the point of placing one.
function spawnSandboxBoss() {
  const pick = sandboxCfg.boss.id;
  if (!pick) return;
  const stageDef = STAGES.find((s) => s.boss && s.boss.id === pick);
  if (!stageDef) return;
  const boss = {
    ...makeBoss(S.player.level, stageDef.boss), id: S.nextId++, spriteId: stageDef.boss.spriteId,
    // Far enough north to be clear of the enemy formation and to open at throwing range —
    // walking in from beyond ROCK_RANGE would mean waiting for it to close before it threw.
    x: S.player.x, y: S.player.y - 420,
    // Declared here rather than only assigned below, so the field is part of the entity's shape
    // instead of appearing on it conditionally.
    dead: false, hitCd: 0, slamState: 'idle', invulnerable: false,
  };
  if (sandboxCfg.boss.infiniteHp) { boss.hp = Infinity; boss.maxHp = Infinity; boss.invulnerable = true; }
  S.enemies.push(boss);
  // The health bar is gated on BOTH of these, not on S.boss alone — so both are set, or a boss
  // you placed yourself would fight you with no bar at all. Setting bossSpawned is safe here:
  // the only other thing that reads it is the auto-spawn check, which it correctly suppresses,
  // and the sandbox never wanted a second boss arriving on a timer anyway.
  S.boss = boss;
  S.bossSpawned = true;
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
  }, cls.id, PORTRAIT_DIR);
}

// Paints a class's sprite into its select-screen portrait: a warm floor pool, a soft accent
// glow behind the figure, then the character standing front-on toward the viewer.
// Animated square portrait for the sandbox enemy grid. Reuses the live-portrait ticker, so
// each tile plays its own walk/flap cycle instead of showing a frozen pose.
function drawEnemyPortrait(canvas, spriteId, tintOverride) {
  const type = ENEMY_TYPES[spriteId] || { color: tintOverride || '#c9bfa8' };
  // Anything that ships a dedicated portrait gets the class-select bust treatment — filling the
  // tile with head and shoulders — instead of a whole figure shrunk to fit. Keyed off the art
  // rather than off a list of ids, so the next boss or enemy to get a portrait drawn upgrades
  // here on its own, and everything without one keeps the standing-figure framing.
  const hasBust = spriteHasFacing(spriteId, PORTRAIT_DIR);
  paintPortrait(canvas, () => {
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, H * 0.55, 3, W / 2, H * 0.55, W * 0.7);
    glow.addColorStop(0, `${type.color}33`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    if (hasBust) { drawPortraitBust(g, spriteId, W, H); return; }
    // Fit by whichever dimension is tighter, so wide sprites (bat, jackal) stay inside the
    // tile instead of overflowing it the way a height-only fit would.
    const aspect = spriteAspect(spriteId) || 1;
    const pad = 0.82;
    const h = Math.min(H * pad, (W * pad) / aspect);
    const bob = portraitBob(spriteId);
    // Centring is right on the square roster tiles, where the fit leaves the same slack top and
    // bottom. On a PORTRAIT card the width is what binds, so centring drops the figure into the
    // middle of a tall card with a band of empty above him — the Hollow Sovereign, the one boss
    // with no drawn portrait, hung well below the two who have one. Tall cards hang him from the
    // same line as the others instead.
    const cy = H > W ? h / 2 + H * 0.05 : H / 2;
    drawSprite(g, spriteId, W / 2 + bob.x, cy + bob.y, h, false, 'front');
  }, spriteId, hasBust ? PORTRAIT_DIR : 'front');
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
  }, classDef.id, PORTRAIT_DIR);
}

// Vertical band shown in a bust portrait, measured against the character's ARTWORK rather
// than its canvas: a little headroom above the crown, down to mid-torso. Framing against the
// canvas lined portraits up inconsistently, because sprites differ both in how much empty
// space sits above the head and in overall proportions.
const BUST_HEADROOM = 0.04;  // padding above the crown, as a fraction of content height
const BUST_DEPTH = 0.56;     // how far down the body to show, same units

// Per-portrait framing trim. Every bust is composed by hand, so how much of the frame the FACE
// fills varies with how much hood, hair or helmet the artist drew around it — the sorceress's
// hood puts more material between her face and the edge than the ranger's hair does, and at the
// same scale she reads as further away. A small multiplier per character brings them into
// agreement. 1 (the default) means the art already frames itself.
// The Skeleton King is shown whole rather than as a bust, on the portrait-shaped boss card.
// 0.89 is the middle of a narrow window rather than a taste call. On that 96x184 card the two
// edges pull opposite ways: below 0.86 his drawing stops spanning the card's width and its own
// side edges show as gutters, and above 0.92 his boots run off the bottom. 0.89 sits between
// them with a few px of margin either way. Anything outside that window means changing the
// card, not the number — a square card has no such window at all, which is why the card changed.
// Akhmet takes the same number for the same reason: his portrait is drawn at the same 74x128
// as the King's and shares the same card, so the window that fits one fits the other.
const PORTRAIT_ZOOM = { sorceress: 1.1, boss: 0.89, sandPharaoh: 0.89 };

// Extra drop below the shared headroom, as a fraction of the CARD height. The zoom above is
// pinned by the width — it cannot grow without spilling and cannot shrink without gutters — so
// once it is set, whatever height is left over has to land somewhere. Left at the shared 3%
// headroom it landed under their feet as a visible strip of empty card. These push the surplus
// back above the crown, where the card's own edge hides it. The two differ because their
// drawings carry different transparent margins, so the same zoom leaves each a different gap.
const PORTRAIT_DROP = { boss: 0.027, sandPharaoh: 0.038 };

function drawPortraitBust(g, spriteId, W, H) {
  // A character that ships real portrait art is drawn WHOLE. That art is already framed as a
  // bust — head and shoulders, filling the panel — so running it through the crop below would
  // zoom into the top of a bust and cut the helmet in half. The band exists to manufacture a
  // bust from a full-body walk frame, which is the only case that still needs it.
  const bob = portraitBob(spriteId);
  if (spriteHasFacing(spriteId, PORTRAIT_DIR)) {
    // FILL the frame, don't fit inside it. Fitting (min) leaves the artwork's own edges
    // showing as a smaller rectangle floating in the card — the portrait reads as an image
    // pasted into a panel rather than as a window onto the character. Covering (max) scales
    // until the narrower axis fills and lets the surplus run off the edges.
    // Covering the frame is not quite enough on its own: the artwork carries its own
    // transparent margin inside the file, so filling the FILE still leaves the drawing's
    // edges visible as a gap down each side. A small overscan pushes that margin off the
    // frame. Scaled from the top, so the overflow is taken off the bottom of the chest.
    const PORTRAIT_OVERSCAN = 1.05;
    const aspect = spriteAspect(spriteId) || 1;   // w / h
    const hBase = Math.max(H, W / aspect) * PORTRAIT_OVERSCAN;   // the shared, unzoomed size
    const h = hBase * (PORTRAIT_ZOOM[spriteId] || 1);
    // Hang the art by its INK, not by the top of its canvas. Every portrait is framed by hand
    // and carries a different transparent margin above the head — five rows on the sorceress
    // against one on the ranger — so anchoring on the file edge hung her visibly lower than the
    // rest of the line-up. Measuring where the drawing actually starts and offsetting to a
    // common headroom lines them all up, including any portrait added later.
    const PORTRAIT_TOP_INK = 0.03;   // headroom above the crown, as a fraction of drawn height
    const inkTop = spriteContent(spriteId, PORTRAIT_DIR).top;
    // Measured against hBase, NOT h, so the headroom is the same distance down the panel at
    // every zoom. Against h the anchor scaled with the figure, and shrinking a portrait slid it
    // up the frame as well as making it smaller — the surplus would come off both ends instead
    // of off the chest. Identical to the old expression wherever zoom is 1.
    const topY = PORTRAIT_TOP_INK * hBase + (PORTRAIT_DROP[spriteId] || 0) * H;
    const sy = topY - inkTop * h + h / 2;
    // exactScale, and it matters twice over. spriteQuad otherwise snaps hand-drawn art to a
    // whole-number multiple of the source height — which quietly discarded both the 5% overscan
    // and this offset, rounding two portraits computed at 291px and 276px to the same 256px and
    // hanging them at different heights. It also makes the per-sprite zoom below a real dial
    // rather than something that does nothing until it jumps a whole 64px step. The snapping
    // exists to keep gameplay pixels crisp at a size that never changes; a portrait is painted
    // once into its own canvas, where the trade does not apply.
    drawSprite(g, spriteId, W / 2 + bob.x, sy + bob.y, h, false, PORTRAIT_DIR, 0, true);
    return;
  }
  const c = spriteContent(spriteId);
  const ch = Math.max(0.01, c.bottom - c.top);
  // Band expressed in canvas fractions, derived from the content box.
  const fTop = c.top - BUST_HEADROOM * ch;
  const fBottom = c.top + BUST_DEPTH * ch;
  const th = H / (fBottom - fTop);
  const sy = th * (0.5 - fTop);
  drawSprite(g, spriteId, W / 2 + bob.x, sy + bob.y, th, false, PORTRAIT_DIR);
}

// Portraits paint once into their own canvas, but sprite PNGs decode asynchronously — so a
// portrait drawn before the art lands would keep the procedural version forever. Track what
// was painted and repaint when art arrives.
const livePortraits = [];
// ---------- Portrait idle motion ----------
// Portraits are stills — the new eight-direction art ships one frame per facing — so without
// this they sit dead on screen next to a menu full of moving parts. A step cycle gives them
// life without needing animation frames drawn for every angle.
//
// Two components, both QUANTISED TO WHOLE PIXELS: a vertical bob, and a much smaller lateral
// sway at half the rate so the two do not simply trace a line. Rounding is not an optimisation
// here, it is the look — a sub-pixel offset on pixel art resamples the whole figure and turns
// crisp edges to mush on every frame.
//
// Rounding also makes it cheap. The offset only takes a handful of distinct values per cycle,
// so the ticker below repaints when the value CHANGES rather than every display frame — a few
// repaints a second per portrait instead of sixty, which matters with 26 tiles on the sandbox
// grid.
const PORTRAIT_BOB_PERIOD = 900;  // ms for one full step cycle
const PORTRAIT_BOB_PX = 2;        // vertical travel, in source pixels
const PORTRAIT_SWAY_PX = 1;       // lateral drift, deliberately smaller than the bob

// Stable per-sprite offset so a row of portraits does not bob in lockstep. Derived from the
// id rather than rolled, so a portrait keeps its phase across repaints and menu re-entries.
function portraitPhase(spriteId) {
  let h = 0;
  for (let i = 0; i < String(spriteId).length; i++) h = (h * 31 + String(spriteId).charCodeAt(i)) % 100000;
  return (h / 100000) * PORTRAIT_BOB_PERIOD;
}

function portraitBob(spriteId) {
  const t = (performance.now() + portraitPhase(spriteId)) / PORTRAIT_BOB_PERIOD;
  const a = t * Math.PI * 2;
  return {
    y: Math.round(Math.sin(a) * PORTRAIT_BOB_PX),
    x: Math.round(Math.sin(a / 2) * PORTRAIT_SWAY_PX),
  };
}

function paintPortrait(canvas, paint, spriteId, dir) {
  livePortraits.push({ canvas, paint, spriteId, dir, lastFrame: -1, lastBob: null });
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
    // Repaint when the walk frame advances OR the bob moves a whole pixel. Both are stepped,
    // so this stays a few repaints a second rather than one per display frame.
    const idx = spriteFrameIndex(p.spriteId, p.dir || 'side');
    const bob = portraitBob(p.spriteId);
    const key = bob.x + ',' + bob.y;
    if (idx !== p.lastFrame || key !== p.lastBob) { p.lastFrame = idx; p.lastBob = key; p.paint(); }
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
document.getElementById('achievementsBtn').addEventListener('click', openAchievements);
document.getElementById('closeAchievementsBtn').addEventListener('click', closeAchievements);
document.getElementById('shopBtn').addEventListener('click', openShop);
document.getElementById('closeShopBtn').addEventListener('click', closeShop);
document.getElementById('mainSettingsBtn').addEventListener('click', () => openSettings('MAINMENU'));
document.getElementById('musicBtn').addEventListener('click', () => openMusic('MAINMENU'));
document.getElementById('pauseMusicBtn').addEventListener('click', () => openMusic('PAUSED'));
document.getElementById('closeMusicBtn').addEventListener('click', closeMusic);
document.getElementById('quitBtn').addEventListener('click', quitGame);
document.getElementById('closeLeaderboardBtn').addEventListener('click', closeLeaderboard);
document.getElementById('clearLeaderboardBtn').addEventListener('click', () => { clearEntries(); ui.showLeaderboard(getEntries(), drawRunPortrait); });

// Track changes announce themselves on screen — except the main theme. That one plays every
// time you touch the menu, so flashing it would make the notification routine background
// noise rather than something that marks a change worth noticing.
onTrackChange((name, listId) => { if (listId !== 'mainMenu') ui.showNowPlaying(name); });

// Keep the music screen's ▶ marker on whatever is actually playing. Tracks change on their own
// — one ends and the next starts, a stage begins, a boss appears — and until now the list only
// re-marked itself when something redrew it, so leaving the screen open showed a stale ▶ until
// you backed out and came in again. Only repaints while the screen is up, so this costs nothing
// during a run.
onTrackChange(() => { if (S.state === 'MUSIC') syncNowPlaying(); });

// Audio needs a user gesture before it can start (browser autoplay policy).
setSfxVolume(getSettings().sfxVolume);
setMusicVolume(getSettings().musicVolume);
function firstGestureInit() {
  initAudio();
  // Start whatever the CURRENT context calls for, not the menu track. This handler fires on
  // the first gesture the browser accepts, which is not necessarily on the menu — if the run
  // is already going (the first accepted gesture was a pause, say) then hard-coding 'mainMenu'
  // crossfaded the stage song out and the title theme in, mid-fight.
  playMusic(S.player && S.state !== 'MAINMENU' ? `stage${S.currentStage + 1}` : 'mainMenu');
  resumeAudio();
  window.removeEventListener('pointerdown', firstGestureInit);
  window.removeEventListener('keydown', firstGestureInit);
}
window.addEventListener('pointerdown', firstGestureInit);
window.addEventListener('keydown', firstGestureInit);
// Every button in the game clicks, with one exception: the sample audition button in the dev
// panel. Its whole purpose is to let you hear a sound in isolation, and layering a UI blip over
// the first 80ms of it defeats that — you cannot judge an attack transient through a click.
document.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target)?.closest('button');
  if (btn && !btn.classList.contains('samplePlay')) play('uiClick');
});

ui.applyInputMode(getSettings().inputPromptMode === 'auto' ? 'keyboard' : getSettings().inputPromptMode);
{ const bt = document.getElementById('buildTag'); if (bt) bt.textContent = BUILD_LABEL; }
ensureTitleArt();
applyDisplayMode(); // honour the saved windowed/borderless choice on launch
applyPerfPanel();   // ...and the saved perf-readout choice
// The flag persists; the overlay it drives lives in memory, so it has to be re-applied here or
// the panel would show ON after a restart while nothing was actually overridden.
setAllUpgrades(getSettings().allUpgrades);

// ---------- Boot ----------
// Nothing is shown until the art is in. Sprite sheets and floor tiles decode asynchronously,
// and anything drawn before they land shows a procedural stand-in and then swaps — the pop-in
// this screen exists to hide. The menu, and the render loop behind it, wait for all of it.
const BOOT_TIMEOUT_MS = 10000;

function bootProgress() {
  const a = spriteAssetProgress();
  // Fonts and tiles are a small, fixed part of the work next to ~70 sprite sheets, so the bar
  // tracks the sheets and simply finishes when everything else has settled too.
  return a.total ? a.loaded / a.total : 1;
}

function tickLoadBar() {
  // The gold bar is the only progress readout. A "Loading 41 / 70" counter used to sit under
  // the lockup, but it is text — so it needed a font, and it was legible before the title was,
  // which put the least interesting thing on screen first.
  const fill = document.getElementById('loadBarFill');
  if (fill) fill.style.width = `${Math.round(bootProgress() * 100)}%`;
}
const loadBarTimer = setInterval(tickLoadBar, 60);
tickLoadBar();

function finishBoot() {
  clearInterval(loadBarTimer);
  const fill = document.getElementById('loadBarFill');
  if (fill) fill.style.width = '100%';
  const screen = document.getElementById('loadScreen');
  if (screen) {
    screen.classList.add('done');            // fades out over 0.45s
    setTimeout(() => screen.remove(), 600);  // then leaves the DOM entirely
  }
  showMainMenu();
  requestAnimationFrame(frame);
}

// The timeout is a safety net, not a schedule: every wait resolves on SETTLED rather than
// loaded, so a 404 cannot hold the screen open. This only covers a request that never returns
// at all — better to start on a half-drawn menu than to strand the player on a loading screen.
let booted = false;
const bootOnce = () => { if (!booted) { booted = true; finishBoot(); } };
Promise.all([
  whenSpritesReady(),
  whenTilesReady(),
  loadCanvasFonts().catch(() => {}),
  document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve(),
]).then(bootOnce).catch(bootOnce);
setTimeout(bootOnce, BOOT_TIMEOUT_MS);
