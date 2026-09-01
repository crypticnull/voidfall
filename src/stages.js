import { ENEMY_ORDER, DESERT_ENEMY_ORDER, UNDERWORLD_ENEMY_ORDER } from './enemies.js';

// Stage definitions: each stage reskins the environment (floor texture, boundary,
// ambient lighting tint, scattered background decor) and ramps difficulty via
// enemy/boss multipliers. Entities themselves (player, regular enemies, UI) keep
// their established colors for gameplay clarity — only the "set dressing" shifts.
export const STAGES = [
  {
    id: 'graveyard',
    name: 'The Graveyard',
    flavor: 'Where the restless dead never sleep.',
    floorBase: '#1a140d',
    floorSpeck: [20, 16, 11],
    // Hand-drawn 64x64 tile. When present it replaces the procedural grain entirely; stages
    // without one keep generating theirs, so art can arrive stage by stage.
    floorTile: 'assets/tiles/stage1_floor.png',
    // Authored at 1024, drawn at a quarter — a 256px period, so the pattern repeats often enough
    // to read as ground texture rather than as one enormous picture the player walks across.
    // The other stages still use the 3x default, which is what their 64px tiles were drawn for.
    floorTileScale: 0.25,
    boundaryOuter: '#2e2115',
    boundaryInner: '#1a1209',
    glowTint: [10, 6, 3],
    decor: ['tombstone', 'cross'],
    // Per-stage enemy stat multipliers. These sit ON TOP of the global difficulty curve in
    // main.js (CURVE_AT_MID / CURVE_TARGETS) and the per-stage time ramp — the curve stays the
    // base layer describing how the whole game escalates, and these describe how THIS stage
    // differs from that baseline. 1 means "exactly what the curve says".
    enemyStats: { hp: 0.8, damage: 1, speed: 1, spawnRate: 1 },
    enemyPool: ENEMY_ORDER,
    // `weapon` picks which armament the boss swings on its slam, `rock` what it hurls —
    // see drawBossWeapon and ROCK_STYLES. Data rather than branches on spriteId, so a new
    // boss brings its own kit with it.
    boss: { id: 'skeletonKing', name: 'The Skeleton King', spriteId: 'boss', color: '#c9bfa8', hpMult: 1, dmgMult: 1, weapon: 'greatsword', rock: 'stone' },
  },
  {
    id: 'desert',
    name: 'The Sundered Sands',
    flavor: 'Endless dunes bury the bones of empires.',
    floorBase: '#3d2f1a',
    floorSpeck: [70, 54, 28],
    // Hand-drawn 64x64 tile, rendered at FLOOR_TILE_SCALE like stage 1's.
    floorTile: 'assets/tiles/stage2_floor.png',
    // Sand is far brighter than the other stages' art; knock it back so the arena stays
    // readable and the horde reads against it. Contrast is eased first so the knock-down
    // lands on a flatter image and the shadows between dunes don't go to black.
    floorTileContrast: 0.7,
    floorTileDim: 0.4,
    boundaryOuter: '#4a3a1f',
    boundaryInner: '#2e2312',
    glowTint: [14, 9, 3],
    decor: ['pillar', 'obelisk', 'rubble'],
    // Per-stage enemy stat multipliers. These sit ON TOP of the global difficulty curve in
    // main.js (CURVE_AT_MID / CURVE_TARGETS) and the per-stage time ramp — the curve stays the
    // base layer describing how the whole game escalates, and these describe how THIS stage
    // differs from that baseline. 1 means "exactly what the curve says".
    enemyStats: { hp: 1.7325, damage: 1.15, speed: 1, spawnRate: 1.26 }, // hp 1.5 +10% +5%; spawn 1.4 -10%
    enemyPool: DESERT_ENEMY_ORDER,
    // `id` and `spriteId` stay as they are — they key the art and the sandbox picker, and are
    // not shown to anyone. Only the displayed name changed.
    boss: { id: 'sandPharaoh', name: 'Akhmet, Undead Son of Anubis', spriteId: 'sandPharaoh', color: '#c9a227', hpMult: 1.3, dmgMult: 1.15, weapon: 'blackScythe', rock: 'black' },
    // Track that takes over when this stage's boss appears, matched by NAME against the
    // stage's own music folder. A boss track is pulled OUT of the normal rotation, so it is
    // only ever heard during the fight. Stages without one keep their usual shuffle playing.
    bossTrack: "Anubis' Hate",
  },
  {
    id: 'underworld',
    name: 'The Underworld',
    flavor: 'The final descent, where sovereigns rot.',
    floorBase: '#1e1730',
    floorSpeck: [40, 25, 55],
    // Hand-drawn 64x64 tile, rendered at FLOOR_TILE_SCALE like the other stages'.
    floorTile: 'assets/tiles/stage3_floor.png',
    boundaryOuter: '#2e1f45',
    boundaryInner: '#180f28',
    glowTint: [14, 5, 20],
    decor: ['skull', 'ribcage', 'bones'],
    // Per-stage enemy stat multipliers. These sit ON TOP of the global difficulty curve in
    // main.js (CURVE_AT_MID / CURVE_TARGETS) and the per-stage time ramp — the curve stays the
    // base layer describing how the whole game escalates, and these describe how THIS stage
    // differs from that baseline. 1 means "exactly what the curve says".
    enemyStats: { hp: 2.646, damage: 1.33, speed: 1, spawnRate: 1.615 }, // hp 2.1 +20% +5%; spawn 1.9 -15%
    enemyPool: UNDERWORLD_ENEMY_ORDER,
    boss: { id: 'hollowSovereign', name: 'The Hollow Sovereign', spriteId: 'hollowSovereign', color: '#6b3fa0', hpMult: 1.6, dmgMult: 1.3, weapon: 'greatsword', rock: 'stone' },
  },
];

// ---------- stage pacing ----------
// Moved here from main.js so pacing lives with the stages it paces — and so the Godot export
// can carry it (tools/export-godot-data.mjs reads this module; it cannot import main.js).

export const BOSS_TIME = 300; // seconds of survival that summon the boss

/**
 * Per-stage kills that summon the boss early — PER STAGE rather than one number for all.
 *
 * A flat 500 made the pace worst exactly where it matters most. Stage 1 has the weakest build
 * and the thinnest spawns, so 500 kills took the longest to reach and the opening dragged;
 * by stage 3 the same 500 arrived almost immediately. The gate got easier as the player got
 * stronger, which is backwards. These rise with the stage so each one takes roughly as long
 * as the last, and the early game stops being the slow part.
 */
export const KILL_THRESHOLDS = [350, 425, 600];
export const killThresholdFor = (stage) => KILL_THRESHOLDS[Math.min(stage, KILL_THRESHOLDS.length - 1)];
