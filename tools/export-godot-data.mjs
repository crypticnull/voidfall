// Export the design layer to the Godot 3D fork.
//
//   node tools/export-godot-data.mjs [--out <voidfall-3d dir>]
//
// The 3D game does NOT re-author skill numbers. Every tune block, and the shape of every
// difficulty curve, is owned here in src/ and copied across as data — so a balance change made
// in the 2D game reaches the 3D one by re-running this script, never by editing GDScript.
// What genuinely forks is cast BEHAVIOUR (~1,500 lines), which is hand-ported per skill.
//
// Two files come out:
//
//   data/skills.json        every skill's authored fields + its tune block, plus the unit
//                           classification the Godot loader needs to convert px -> metres.
//   data/curve-golden.json  shapeValue sampled across a matrix of shapes and positions. The
//                           GDScript port is pinned against these, so the two implementations
//                           cannot drift silently — which is the whole reason the numbers are
//                           allowed to be single-sourced in the first place.
//
// Run it after `npm run bake`: baking folds live tuning into src/, so importing the module here
// picks up the shipped values rather than a stale literal.
import { SKILLS, SKILL_ORDER, MOBILITY_ORDER, TUNE_META } from '../src/skills.js';
import { shapeValue } from '../src/difficulty.js';
// Importing enemies.js runs applyEnemyGlobals() at module load, so ENEMY_TYPES here already
// carries the FINAL numbers the game fights with — globals folded in, exactly what should cross.
import { ENEMY_TYPES, ENEMY_ORDER, DESERT_ENEMY_ORDER, UNDERWORLD_ENEMY_ORDER,
  ENEMY_GLOBALS, SIZE_HP_EXP, BASE_SIZE_SPREAD } from '../src/enemies.js';
// Same story: CLASS_TUNE is applied to CLASSES at classes.js load, so `base` is final.
import { CLASSES, DASH, PLAYER_GLOBALS } from '../src/classes.js';
import { STAGES, BOSS_TIME, KILL_THRESHOLDS } from '../src/stages.js';
import { TERRAIN_TUNE, TERRAIN_COLOR_TUNE, ROCK_SQUASH, generateTerrain } from '../src/terrain.js';
import { ELITE_TUNE, ELITE_ABILITIES, ELITE_ONLY, MINIBOSSES,
  SUNDER_MULT, TETHER_PULL, TETHER_SLOW } from '../src/elites.js';
import { INFUSION_ART, NO_INFUSION, flow } from '../src/infusion-art.js';
import { SUPPORTS, SUPPORT_ORDER, TOME_CURVE, TOME_MASTER, COUNTING_TOMES,
  tomeMagnitude, tomeCount } from '../src/supports.js';
import { AI_TUNE, BEHAVIORS } from '../src/enemy-ai.js';
import { ARMOR_UNIT_DAMAGE, ARMOR_COST_EXP } from '../src/difficulty.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argOut = process.argv.indexOf('--out');
const OUT_ROOT = argOut > -1 && process.argv[argOut + 1]
  ? resolve(process.argv[argOut + 1])
  : resolve(HERE, '../../26_08_03_Voidfall_3D/voidfall-3d');
const OUT_DIR = resolve(OUT_ROOT, 'data');

// ---------- units ----------
// The 2D game measures in PIXELS: a bolt flies at 450 and a body has radius 14. Godot measures
// in metres, and leaving those numbers alone would give a 28-metre-wide zombie — physics,
// shadow and LOD defaults are all authored around human scale, so the conversion has to happen.
//
// It happens ONCE, at load, driven by these lists rather than by hand-editing the numbers, so
// the JSON stays in the units the 2D tuning panel writes and a re-export can never half-convert.
// 32 px per metre comes from the sprite scale: a 14px-radius body is 0.44m across the shoulders
// and the player mesh stands 1.8m, which is the scale the camera distances were chosen for.
const PX_PER_METRE = 32;

// Lengths. Anything measured across the ground plane or as a body size.
const LENGTH_KEYS = [
  'radius', 'radiusPerLevel', 'projSize', 'aoeRadius', 'distance', 'markWidth', 'eatRadius',
  'pullRadius', 'orbitRadius', 'collapseRadius', 'targetRange', 'chainRange', 'range', 'width',
  'maxRadius', 'innerRadius', 'starRadius', 'puddleRadius', 'splashRadius', 'spreadRadius',
  'knockback', 'force', 'burstKnockback',
  // Ice Bomb's throw corridor and its blast; Gravepull's inward yank, which is a distance
  // moved rather than a physics impulse and so scales exactly like knockback.
  'throwMin', 'throwMax', 'blastRadius', 'pull',
];
// Speeds — px/s, so the same divisor, but listed apart because a future change to how speed is
// expressed (say, metres per second authored directly) has to move only one list.
const SPEED_KEYS = ['speed', 'minionSpeed', 'shadeSpeed'];

// Percentages, angles, seconds, counts and multipliers all carry over untouched. Listed
// explicitly and asserted below rather than assumed: a NEW tune key that is silently neither
// converted nor declared is exactly the bug this file exists to prevent.
const UNITLESS_KEYS = [
  'cooldown', 'damage', 'damagePerLevel', 'arcDeg', 'life', 'lifeVary', 'charges', 'grace',
  'count', 'spreadDeg', 'stagger', 'jitterDeg', 'staggerEven', 'capacity', 'crowdFalloff',
  'chargeCap', 'durationPerLevel', 'burstRadiusPct', 'pierce', 'chain', 'forks', 'childChain',
  'coneDeg', 'duration', 'tickInterval', 'slowDuration', 'frostDuration', 'cloudDuration',
  'frostRadiusPct', 'burnDuration', 'burnDamage', 'burnDamagePerLevel', 'poisonDuration',
  'puddleDuration', 'freeze', 'freezePerLevel', 'freezeDuration', 'maxTargets', 'pulsePeriod',
  'spin', 'minionHp', 'minionHpPerLevel', 'minionDamage', 'minionDamagePerLevel', 'minionAtkCd',
  'minionCapBase', 'minionReviveTime', 'boltWidth', 'boltVibe',
  // Percentages, stack counts, and Hollow Echo's shade stats — all either dimensionless or
  // already in seconds / hit points, which carry over as-is.
  'healthPct', 'healthPctPerLevel', 'stacksToCollapse',
  'shadeHp', 'shadeHpPerLevel', 'shadeDamage', 'shadeDamagePerLevel', 'shadeLife', 'shadeAtkCd',
];

// ---------- skills ----------
// The mobility pair lives in its own order in the 2D game — they occupy the dash slot rather
// than a cast slot, so SKILL_ORDER (the level-up pool) does not list them. Both are exported:
// the count of "every skill in the game" is the two lists together, and a 3D port that only
// knew about SKILL_ORDER would report itself finished while the dodge was still missing.
const skills = {};
for (const id of [...SKILL_ORDER, ...MOBILITY_ORDER]) {
  const s = SKILLS[id];
  if (!s) throw new Error(`skill order names "${id}" but SKILLS has no such entry`);
  skills[id] = {
    id,
    name: s.name,
    desc: s.desc,
    color: s.color,
    icon: s.icon || null,
    category: s.category || null,
    designLevel: s.designLevel ?? null,
    cooldownBase: s.cooldownBase ?? null,
    // cast() is deliberately absent. Behaviour is the part that forks.
    tune: { ...(s.tune || {}) },
  };
}

// Every key that actually appears must be classified, or the Godot side would carry a pixel
// number into metre space and nobody would notice until a hitbox felt wrong.
const classified = new Set([...LENGTH_KEYS, ...SPEED_KEYS, ...UNITLESS_KEYS]);
const unknown = new Set();
for (const s of Object.values(skills)) {
  for (const k of Object.keys(s.tune)) if (!classified.has(k)) unknown.add(k);
}
if (unknown.size) {
  throw new Error(
    `Unclassified tune keys: ${[...unknown].join(', ')}\n` +
    'Add each to LENGTH_KEYS, SPEED_KEYS or UNITLESS_KEYS in tools/export-godot-data.mjs.');
}

// ---------- golden curve samples ----------
// A matrix, not a handful of spot checks: both modes, with and without a floor, with and
// without an accelerating tail, sampled below / at / well past the reference. Between them
// these hit every branch in shapeValue, so a GDScript port that passes cannot be subtly wrong.
const SHAPES = [
  { label: 'exp-plain',        end: 6,   bend: 1.6, tailAt: 12, beyond: 1.08 },
  { label: 'exp-flat-tail',    end: 3.5, bend: 0.7, tailAt: 8,  beyond: 1 },
  { label: 'exp-accel-tail',   end: 9,   bend: 2.2, tailAt: 15, beyond: 1.06, accel: 1.02, accelFrom: 3 },
  { label: 'exp-floored',      end: 6,   bend: 1.6, tailAt: 12, beyond: 1.08, floor: 2.5 },
  { label: 'exp-floor-below',  end: 6,   bend: 1.6, tailAt: 12, beyond: 1.08, floor: 0.6 },
  { label: 'exp-beyond-per',   end: 4,   bend: 1,   tailAt: 60, beyond: 1.9, beyondPer: 300 },
  { label: 'power-linear',     end: 25,  bend: 1,   tailAt: 20, beyond: 1.03, mode: 'power' },
  { label: 'power-late',       end: 12,  bend: 2.4, tailAt: 20, beyond: 1.01, mode: 'power' },
  { label: 'power-early',      end: 12,  bend: 0.4, tailAt: 20, beyond: 1,    mode: 'power' },
  { label: 'power-floored',    end: 25,  bend: 1,   tailAt: 20, beyond: 1.03, mode: 'power', floor: 4 },
  { label: 'bend-clamped',     end: 5,   bend: 0.001, tailAt: 10, beyond: 1.05 },
  { label: 'tail-clamped',     end: 5,   bend: 1,   tailAt: 0.1, beyond: 1.05 },
];
const POSITIONS = [-3, 0, 0.001, 0.5, 1, 2.5, 5, 7.999, 8, 10, 12, 15, 20, 40, 120, 300, 900];

const golden = SHAPES.map(({ label, ...sh }) => ({
  label,
  shape: sh,
  // Non-finite samples are dropped, not carried: the accelerating tail overflows to Infinity at
  // absurd positions (by design — it is the soft clamp doing its job), and JSON has no Infinity,
  // so JSON.stringify would smuggle it across as null and the GDScript side would choke on a
  // value that proves nothing anyway.
  samples: POSITIONS
    .map((pos) => ({ pos, value: shapeValue(sh, pos) }))
    .filter(({ value }) => Number.isFinite(value)),
}));

// ---------- write ----------
mkdirSync(OUT_DIR, { recursive: true });

const header = {
  _generated: 'tools/export-godot-data.mjs in the 2D repo — do not hand-edit, re-export instead',
  _source: 'voidfall-survivors src/skills.js',
};

writeFileSync(resolve(OUT_DIR, 'skills.json'), JSON.stringify({
  ...header,
  units: { pxPerMetre: PX_PER_METRE, lengthKeys: LENGTH_KEYS, speedKeys: SPEED_KEYS },
  order: SKILL_ORDER,
  mobilityOrder: MOBILITY_ORDER,
  // Carried so the Godot dev panel can label and bound a slider without a second copy of the
  // metadata; unused by the slice, and cheap.
  tuneMeta: TUNE_META,
  skills,
}, null, 2) + '\n');

writeFileSync(resolve(OUT_DIR, 'curve-golden.json'), JSON.stringify({
  ...header,
  _source: 'voidfall-survivors src/difficulty.js shapeValue',
  cases: golden,
}, null, 2) + '\n');

// ================================================================================
// The wider bridge: enemies, classes, stages, terrain, elites, infusion art.
// Same philosophy as the skills above — the 2D repo authors, this file carries, and the Godot
// side converts units once at load. Every family emits its own `units` block naming which of
// its NUMERIC keys are px lengths and which are px/s speeds; `classifyNumbers` refuses to emit
// a family containing a number nobody classified, which is the guard that keeps a future field
// from strolling into metre space still wearing pixels.
// ================================================================================

/**
 * Assert every numeric key across `rows` is classified, and return the family's units block.
 * Strings, booleans and arrays pass through untouched — units are a property of numbers.
 */
function classifyNumbers(family, rows, { length = [], speed = [], unitless = [] }) {
  const known = new Set([...length, ...speed, ...unitless]);
  const unknown = new Set();
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'number' && !known.has(k)) unknown.add(k);
    }
  }
  if (unknown.size) {
    throw new Error(
      `${family}: unclassified numeric keys: ${[...unknown].join(', ')}\n` +
      `Classify each as length/speed/unitless in the ${family} section of tools/export-godot-data.mjs.`);
  }
  return { pxPerMetre: PX_PER_METRE, lengthKeys: length, speedKeys: speed };
}

// ---------- enemies ----------
const enemyUnits = classifyNumbers('enemies', Object.values(ENEMY_TYPES), {
  length: ['radius', 'range', 'projRadius'],
  speed: ['speed', 'projSpeed'],
  // tier is seconds-into-stage; contactCd/shootCd are seconds; sizeSpread a ratio.
  unitless: ['tier', 'hp', 'damage', 'xp', 'contactCd', 'shootCd', 'sizeSpread'],
});

writeFileSync(resolve(OUT_DIR, 'enemies.json'), JSON.stringify({
  ...header,
  _source: 'voidfall-survivors src/enemies.js (post-applyEnemyGlobals — final numbers)',
  units: enemyUnits,
  types: ENEMY_TYPES,
  pools: {
    graveyard: ENEMY_ORDER,
    desert: DESERT_ENEMY_ORDER,
    underworld: UNDERWORLD_ENEMY_ORDER,
  },
  // Spawn cadence and crowd formation, already final. spawnInterval/-Min are seconds between
  // spawns; the interval tightens by t/780 (spawnIntervalFor's 260*3, restated here because a
  // function cannot cross as JSON — the Godot port re-derives from this named constant).
  globals: ENEMY_GLOBALS,
  spawnTightenDivisor: 260 * 3,
  sizeHpExp: SIZE_HP_EXP,
  baseSizeSpread: BASE_SIZE_SPREAD,
}, null, 2) + '\n');

// ---------- classes ----------
const classUnits = classifyNumbers('classes',
  [...CLASSES.map((c) => c.base), DASH, PLAYER_GLOBALS], {
    length: ['distance', 'pickupRadius'],
    speed: ['speed'],
    unitless: ['maxHp', 'armor', 'hpRegen', 'critChance', 'critMult',
      'charges', 'cooldown', 'time', 'hpMult', 'damageMult', 'speedMult', 'xpMult'],
  });

writeFileSync(resolve(OUT_DIR, 'classes.json'), JSON.stringify({
  ...header,
  _source: 'voidfall-survivors src/classes.js (post-CLASS_TUNE — final numbers)',
  units: classUnits,
  // Passive flags (plateImmune, overchannel, …) ride along as booleans — they are the part of
  // a class that is BEHAVIOUR, and the Godot side ports them by hand like skill casts.
  classes: CLASSES,
  dash: DASH,
  playerGlobals: PLAYER_GLOBALS,
}, null, 2) + '\n');

// ---------- stages ----------
const stageNumericRows = STAGES.flatMap((s) => [s, s.enemyStats, s.boss]);
const stageUnits = classifyNumbers('stages', stageNumericRows, {
  unitless: ['floorTileScale', 'floorTileContrast', 'floorTileDim',
    'hp', 'damage', 'speed', 'spawnRate', 'hpMult', 'dmgMult'],
});

writeFileSync(resolve(OUT_DIR, 'stages.json'), JSON.stringify({
  ...header,
  _source: 'voidfall-survivors src/stages.js',
  units: stageUnits,
  stages: STAGES,
  // Pacing: the boss arrives at BOSS_TIME seconds OR the stage's kill threshold, whichever
  // first (main.js applies an 0.7 hourglass multiplier the Godot side can ignore until relics
  // cross). Minibosses arrive at half the kill threshold.
  bossTime: BOSS_TIME,
  killThresholds: KILL_THRESHOLDS,
}, null, 2) + '\n');

// ---------- terrain ----------
const terrainUnits = classifyNumbers('terrain', [TERRAIN_TUNE, ...Object.values(TERRAIN_COLOR_TUNE)], {
  length: ['minRadius', 'maxRadius', 'clearRadius', 'edgeMargin', 'spacing'],
  unitless: ['clusters', 'ridgeChance', 'ridgeLength', 'sizeVary', 'seed',
    'rockHue', 'rockSat', 'rockLift', 'hueVary', 'lightVary'],
});

writeFileSync(resolve(OUT_DIR, 'terrain.json'), JSON.stringify({
  ...header,
  _source: 'voidfall-survivors src/terrain.js (TERRAIN_TUNE already carries the baked override)',
  units: terrainUnits,
  tune: TERRAIN_TUNE,
  colorTune: TERRAIN_COLOR_TUNE,
  rockSquash: ROCK_SQUASH,
  arenaRadius: 1500,
}, null, 2) + '\n');

// ---------- terrain goldens ----------
// generateTerrain run with pinned seeds, every rock captured in full — position, radius, the
// jag polygon, the identity rolls. The GDScript port must reproduce these EXACTLY (same rng,
// same call order), which is what lets the 3D game promise "the same seed is the same arena".
// The exporter's mulberry32 is a copy of the one inside generateTerrain, byte for byte.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const TERRAIN_GOLDEN_SEEDS = [2, 7];
const terrainGolden = TERRAIN_GOLDEN_SEEDS.map((seed) => {
  const t = generateTerrain(1500, mulberry32(seed));
  return {
    seed,
    arenaRadius: 1500,
    rocks: t.rocks.map((o) => ({
      x: o.x, y: o.y, r: o.r, seed: o.seed, jh: o.jh, jl: o.jl,
      poly: o.poly.map((p) => ({ a: p.a, f: p.f })),
    })),
  };
});

writeFileSync(resolve(OUT_DIR, 'terrain-golden.json'), JSON.stringify({
  ...header,
  _source: 'voidfall-survivors src/terrain.js generateTerrain, mulberry32-seeded',
  layouts: terrainGolden,
}, null, 2) + '\n');

// ---------- elites ----------
const eliteUnits = classifyNumbers('elites', [ELITE_TUNE, ...ELITE_ABILITIES, ...Object.values(MINIBOSSES)], {
  length: ['abilityRange'],
  unitless: ['hpMult', 'damageMult', 'speedMult', 'radiusMult', 'xpMult', 'abilityCd',
    'statusSeconds', 'spawnEvery', 'spawnEveryEndless', 'maxAlive', 'durMult'],
});

writeFileSync(resolve(OUT_DIR, 'elites.json'), JSON.stringify({
  ...header,
  _source: 'voidfall-survivors src/elites.js',
  units: eliteUnits,
  tune: ELITE_TUNE,
  abilities: ELITE_ABILITIES,
  eliteOnly: [...ELITE_ONLY],
  minibosses: MINIBOSSES,
  sunderMult: SUNDER_MULT,
  tetherPullPx: TETHER_PULL,   // px/s — a speed; named with its unit since it sits alone
  tetherSlow: TETHER_SLOW,
}, null, 2) + '\n');

// ---------- infusion art ----------
// The element table crosses verbatim — every field is either a colour or a dimensionless shape
// dial on geometry the skills size themselves. flow() is the one piece of arithmetic the 3D
// side duplicates (its generators need the same time-varying field), so it gets the golden
// treatment shapeValue got: sampled here by the original, pinned over there by the test.
const FLOW_XS = [0, 0.37, 1.5, 4.2, 9.99, 25];
const FLOW_TS = [0, 0.5, 3.13, 27.4];
const flowGolden = [];
for (const x of FLOW_XS) for (const t of FLOW_TS) flowGolden.push({ x, t, value: flow(x, t) });

writeFileSync(resolve(OUT_DIR, 'infusion-art.json'), JSON.stringify({
  ...header,
  _source: 'voidfall-survivors src/infusion-art.js',
  art: INFUSION_ART,
  noInfusion: NO_INFUSION,
  flowGolden,
}, null, 2) + '\n');

// ---------- supports (the tome shelf) ----------
// The card pool the level-up screen draws from, and the curve that decides what each level of
// a tome is worth. `apply` is behaviour and forks by hand, exactly like a skill's cast — but
// every tome's effect is one line off `tomeMagnitude` or `tomeCount`, so the numbers are all
// here and only the assignment is ported.
//
// Those two functions are the fourth and fifth pieces of duplicated arithmetic in the fork, so
// they get the same treatment as shapeValue: sampled here by the original, pinned over there.
const supports = {};
for (const id of SUPPORT_ORDER) {
  const s = SUPPORTS[id];
  supports[id] = {
    id,
    name: s.name,
    icon: s.icon,
    color: s.color,
    counting: COUNTING_TOMES.has(id),
    softCap: s.softCap || null,
  };
}

const TOME_LEVELS = [1, 2, 3, 5, 8, 12, 20, 25, 30, 50, 100];
const tomeGolden = [];
for (const id of SUPPORT_ORDER) {
  for (const lvl of TOME_LEVELS) {
    tomeGolden.push({
      id, lvl,
      magnitude: tomeMagnitude(id, lvl),
      count: COUNTING_TOMES.has(id) ? tomeCount(id, lvl) : null,
    });
  }
}

writeFileSync(resolve(OUT_DIR, 'supports.json'), JSON.stringify({
  ...header,
  _source: 'voidfall-survivors src/supports.js',
  order: SUPPORT_ORDER,
  supports,
  curves: TOME_CURVE,
  master: TOME_MASTER,
  countThreshold: 0.35,
  golden: tomeGolden,
}, null, 2) + '\n');

// ---------- enemy AI, and the armour model ----------
// AI_TUNE's distances are pixels and its speeds are multipliers of the enemy's own speed, so
// the classification below is the whole of what units mean here.
const aiRows = Object.values(AI_TUNE);
const aiUnits = classifyNumbers('enemy-ai', aiRows, {
  length: ['ringMin', 'ringMax', 'overshoot'],
  unitless: ['hopChance', 'hopSpeed', 'hopTime', 'waitTime', 'strafeSpeed', 'strafeTime',
    'dashSpeed', 'dashTime', 'restTime', 'windupTime', 'sprintSpeed', 'sprintTime'],
});

writeFileSync(resolve(OUT_DIR, 'combat.json'), JSON.stringify({
  ...header,
  _source: 'voidfall-survivors src/enemy-ai.js and src/difficulty.js',
  units: aiUnits,
  aiTune: AI_TUNE,
  behaviors: BEHAVIORS,
  // Armour is a pool of SHIELD UNITS, not flat reduction: a hit landing while any shield
  // remains is absorbed whole and costs units by its size. These two dials set that price.
  armor: { unitDamage: ARMOR_UNIT_DAMAGE, costExp: ARMOR_COST_EXP,
    rechargeDelay: 6, rechargeInterval: 2.5 },
  // xpForLevel in main.js. A function, restated as its two constants.
  xp: { base: 9, perLevel: 6.5 },
}, null, 2) + '\n');

const sampleCount = golden.reduce((a, g) => a + g.samples.length, 0);
const rockCount = terrainGolden.reduce((a, l) => a + l.rocks.length, 0);
console.log(`skills.json         ${Object.keys(skills).length} skills -> ${resolve(OUT_DIR, 'skills.json')}`);
console.log(`curve-golden.json   ${golden.length} shapes x ${POSITIONS.length} positions = ${sampleCount} samples`);
console.log(`enemies.json        ${Object.keys(ENEMY_TYPES).length} types, 3 pools`);
console.log(`classes.json        ${CLASSES.length} classes + dash + globals`);
console.log(`stages.json         ${STAGES.length} stages, bossTime ${BOSS_TIME}s`);
console.log(`terrain.json        tune + ${Object.keys(TERRAIN_COLOR_TUNE).length} stage tints`);
console.log(`terrain-golden.json seeds ${TERRAIN_GOLDEN_SEEDS.join(', ')} = ${rockCount} rocks`);
console.log(`elites.json         ${ELITE_ABILITIES.length} abilities, ${Object.keys(MINIBOSSES).length} minibosses`);
console.log(`infusion-art.json   ${Object.keys(INFUSION_ART).length} elements, ${flowGolden.length} flow samples`);
console.log(`supports.json       ${SUPPORT_ORDER.length} tomes, ${tomeGolden.length} golden samples`);
console.log(`combat.json         ${BEHAVIORS.length} behaviours, armour + xp curve`);
