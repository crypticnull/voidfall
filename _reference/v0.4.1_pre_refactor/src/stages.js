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
    boss: { id: 'skeletonKing', name: 'The Skeleton King', spriteId: 'boss', color: '#c9bfa8', hpMult: 1, dmgMult: 1 },
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
    enemyStats: { hp: 1.5, damage: 1.15, speed: 1, spawnRate: 1.4 },
    enemyPool: DESERT_ENEMY_ORDER,
    boss: { id: 'sandPharaoh', name: 'The Sand Pharaoh', spriteId: 'sandPharaoh', color: '#c9a227', hpMult: 1.3, dmgMult: 1.15 },
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
    enemyStats: { hp: 2.1, damage: 1.33, speed: 1, spawnRate: 1.9 },
    enemyPool: UNDERWORLD_ENEMY_ORDER,
    boss: { id: 'hollowSovereign', name: 'The Hollow Sovereign', spriteId: 'hollowSovereign', color: '#6b3fa0', hpMult: 1.6, dmgMult: 1.3 },
  },
];
