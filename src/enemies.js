// Global difficulty tuning: flat multipliers applied to every enemy's base health and
// damage (and to bosses). Bump these to make the whole roster tougher at once.
// Health multipliers. These used to be ONE constant covering the roster and the bosses alike;
// they are split because the two are now being balanced independently, and a shared constant
// makes that impossible without one change silently dragging the other along.
//
// The arithmetic is left visible rather than folded into a literal, so the history of a number
// stays readable — the same style as ENEMY_DMG_MULT below.
const ENEMY_HP_MULT = 1.44 * 0.7 * 0.85; // +20%, +20%, -30% across the roster, then -15% more
const BOSS_HP_MULT = 1.44 * 0.6 * 0.8 * 0.85; // same base, -40%, then -20%, then -15% more
// The shipped values above are the STARTING POINT; ENEMY_GLOBALS below is what the game reads,
// and the dev tools move it live.
// 1.2, then -20% to compensate for armor becoming a depleting shield: it no longer shaves a
// slice off every hit forever, so the same raw numbers hit far harder once the shield is down.
// Applied here rather than per-enemy because this one constant feeds BOTH the roster (below)
// and makeBoss, so bosses are covered by the same change.
const ENEMY_DMG_MULT = 1.2 * 0.8;
// +15% across the board. Like the damage multiplier above, this one constant feeds BOTH the
// roster loop at the bottom of the file and makeBoss, so bosses keep pace with their horde
// instead of quietly becoming the slowest thing on the screen.
const ENEMY_SPEED_MULT = 1.15 * 0.9; // +15%, then -10%

// Enemy type definitions. `tier` gates when they start appearing (seconds into the round).
export const ENEMY_TYPES = {
  zombie: {
    behavior: 'walker',
    // radius 15 -> 18.75 (+25%). The drawn sprite is derived from radius, so raising it here
    // scales the art and the hitbox together and keeps their ratio identical.
    name: 'Shambler', tier: 0, radius: 18.75, speed: 65, hp: 26, damage: 9, xp: 4,
    color: '#4a5c34', contactCd: 0.7,
  },
  bat: {
    behavior: 'harrier',
    name: 'Swarm Bat', tier: 0, radius: 9, speed: 145, hp: 12, damage: 5, xp: 2,
    color: '#4a3a52', contactCd: 0.5,
  },
  skeletonArcher: {
    name: 'Bone Archer', tier: 60, radius: 13, speed: 55, hp: 22, damage: 8, xp: 6,
    color: '#a89e83', ranged: true, range: 320, shootCd: 1.6, projSpeed: 220, contactCd: 0.9,
  },
  slime: {
    behavior: 'walker',
    // radius 17 -> 11.9 (-30%). Taken off the RADIUS rather than the sprite's displayScale so
    // the hitbox, the collision footprint and the art all shrink together - the draw size is
    // derived from radius, so halving one without the other would leave a blob you could hit
    // from well outside its own silhouette.
    name: 'Acid Slime', tier: 90, radius: 11.9, speed: 50, hp: 34, damage: 7, xp: 5,
    // Retinted to the new art: the sprite is a charred, molten thing, not the green blob the
    // procedural fallback below still draws. This colour feeds hit particles and the minimap.
    color: '#7f3824', splits: true, contactCd: 0.7,
    // Every slime rolls its own size at spawn, +/-25% off that base radius, so a pack reads as
    // a pack of individuals rather than a row of clones.
    sizeSpread: 0.25,
    // Bounces instead of walking: lifts off the ground, stretches at the top of the arc and
    // flattens on impact. Cosmetic only — see hopPose() in main.js.
    hops: true,
  },
  hornedGoblin: {
    behavior: 'charger',
    // radius 13 is picked to make him read at the Acid Slime's on-screen size, as asked.
    // Measured through the live sprite pipeline rather than derived from the defs: the slime
    // draws into a 116x97 quad but its blob only inks 107x73 of it, while the goblin's art
    // fills its quad edge to edge. Matching the two *quads* would therefore have left the
    // goblin a third taller than the thing he is meant to match. At radius 13 he inks 74px
    // tall against the slime's 73 — same apparent height, and a much tighter hitbox, which is
    // right for a humanoid half the width of a blob.
    name: 'Horned Goblin', tier: 75, radius: 13, speed: 105, hp: 28, damage: 8, xp: 5,
    color: '#655838', contactCd: 0.6,
  },
  ogre: {
    behavior: 'walker',
    name: 'Rockhide Ogre', tier: 150, radius: 26, speed: 42, hp: 130, damage: 20, xp: 14,
    color: '#5c4630', contactCd: 1.0,
  },
  wraith: {
    behavior: 'strafer',
    name: 'Hollow Wraith', tier: 210, radius: 12, speed: 120, hp: 45, damage: 12, xp: 8,
    color: '#312d40', contactCd: 0.6,
  },
};

export const ENEMY_ORDER = ['zombie', 'bat', 'skeletonArcher', 'slime', 'hornedGoblin', 'ogre', 'wraith'];

// ---------- Stage 2 (The Sundered Sands) roster ----------
Object.assign(ENEMY_TYPES, {
  jackal: {
    behavior: 'charger',
    name: 'Dune Jackal', tier: 0, radius: 11, speed: 150, hp: 16, damage: 6, xp: 3,
    color: '#8a6a3a', contactCd: 0.5,
  },
  scarab: {
    behavior: 'harrier',
    name: 'Carrion Scarab', tier: 30, radius: 9, speed: 75, hp: 20, damage: 5, xp: 3,
    color: '#2a5c48', splits: true, contactCd: 0.6,
  },
  vulture: {
    behavior: 'strafer',
    name: 'Ash Vulture', tier: 60, radius: 12, speed: 130, hp: 30, damage: 9, xp: 6,
    color: '#241f18', contactCd: 0.55,
  },
  mummy: {
    name: 'Wrapped Cursebearer', tier: 90, radius: 13, speed: 46, hp: 40, damage: 9, xp: 7,
    color: '#c9bfa8', ranged: true, range: 300, shootCd: 1.8, projSpeed: 190, contactCd: 0.9,
    projStyle: 'orb', projColor: '#7ac95a', projRadius: 6,
  },
  sandGolem: {
    behavior: 'walker',
    name: 'Sand-Wrought Construct', tier: 150, radius: 27, speed: 40, hp: 165, damage: 21, xp: 15,
    color: '#b8935a', contactCd: 1.0,
  },
  stoneGolem: {
    behavior: 'walker',
    name: 'Tomb Warden', tier: 210, radius: 30, speed: 36, hp: 220, damage: 25, xp: 19,
    color: '#6e6a5e', contactCd: 1.0,
  },
});
export const DESERT_ENEMY_ORDER = ['jackal', 'scarab', 'vulture', 'mummy', 'sandGolem', 'stoneGolem'];

// ---------- Stage 3 (The Underworld) roster ----------
Object.assign(ENEMY_TYPES, {
  hollowZombie: {
    behavior: 'harrier',
    name: 'Hollow Shambler', tier: 0, radius: 15, speed: 70, hp: 28, damage: 10, xp: 4,
    color: '#3a2a4a', contactCd: 0.7,
  },
  wailingGhost: {
    behavior: 'strafer',
    name: 'Wailing Ghost', tier: 30, radius: 11, speed: 145, hp: 20, damage: 7, xp: 4,
    color: '#8ce9c0', contactCd: 0.5,
  },
  pitDemon: {
    behavior: 'charger',
    name: 'Pit Demon', tier: 60, radius: 16, speed: 95, hp: 52, damage: 14, xp: 7,
    color: '#7a1f3a', contactCd: 0.6,
  },
  veinedEye: {
    name: 'Veined Eye', tier: 90, radius: 13, speed: 35, hp: 44, damage: 9, xp: 7,
    color: '#8a2848', ranged: true, range: 280, shootCd: 1.6, projSpeed: 200, contactCd: 0.9,
    projStyle: 'orb', projColor: '#c9456c', projRadius: 6,
  },
  giantWorm: {
    behavior: 'walker',
    name: 'Charnel Worm', tier: 150, radius: 26, speed: 50, hp: 160, damage: 20, xp: 16,
    color: '#4a2a5e', contactCd: 1.0,
  },
  minotaur: {
    behavior: 'charger',
    name: 'Bound Minotaur', tier: 210, radius: 28, speed: 68, hp: 215, damage: 29, xp: 20,
    color: '#5c3a28', contactCd: 0.9,
  },
});
export const UNDERWORLD_ENEMY_ORDER = ['hollowZombie', 'wailingGhost', 'pitDemon', 'veinedEye', 'flameSkull', 'giantWorm', 'minotaur'];

// ---------- Shared: the flaming skull haunts both the graveyard and the underworld ----------
Object.assign(ENEMY_TYPES, {
  flameSkull: {
    behavior: 'strafer',
    name: 'Cinder Skull', tier: 45, radius: 13, speed: 118, hp: 30, damage: 11, xp: 6,
    color: '#e0691a', contactCd: 0.6, floats: true, // bobs in the air rather than walking
  },
});
ENEMY_ORDER.push('flameSkull');

export function poolForTime(t, order = ENEMY_ORDER) {
  return order.filter((id) => ENEMY_TYPES[id].tier <= t);
}

// How hard health follows size for enemies that roll one (see `sizeSpread`). Squared rather
// than linear so bigger genuinely means tougher and not merely wider: at the +25% end a slime
// carries 1.56x the health, at -25% only 0.56x. Raise it to make size a louder threat signal.
export const SIZE_HP_EXP = 2;

// Baseline size jitter every enemy gets. Small on purpose: enough that a crowd stops looking
// stamped from one mould, not enough to make any individual read as a different creature.
// A type opts out with `sizeSpread: 0`, or asks for more by declaring its own (slimes take
// 0.25, where the size difference is meant to be noticed and is paid for in health).
export const BASE_SIZE_SPREAD = 0.05;

// The size an enemy rolls at spawn, as a multiple of its declared radius.
export function rollSizeScale(type) {
  const spread = type.sizeSpread === undefined ? BASE_SIZE_SPREAD : type.sizeSpread;
  return spread ? 1 + (Math.random() * 2 - 1) * spread : 1;
}

export function difficultyMult(t) {
  // gentle ramp: hp/damage scale up over the round
  return 1 + t / 240;
}

// Spawn cadence, in SECONDS BETWEEN SPAWNS — the real quantity, not a multiplier on one.
// It starts at `spawnInterval` and tightens with time down to `spawnIntervalMin`.
//
// The old form was `max(0.18, 1.1 - t/260) / 3`, where the /3 was a "triple the density" pass
// laid on top. Folding that divisor into the numbers makes them mean what they say: 0.367s
// between spawns at the start rather than 1.1 divided by something you have to go and find.
// Smaller is denser, which is worth saying out loud on a dial called "rate".
export function spawnIntervalFor(t) {
  return Math.max(ENEMY_GLOBALS.spawnIntervalMin,
    ENEMY_GLOBALS.spawnInterval - t / (260 * 3));
}

// Base boss health, doubled from (900 + level*140). Applied at the base rather than to each
// stage's hpMult so every boss — including the endless-wave repeats, which re-enter through
// here — scales from the same doubled floor and the per-stage multipliers keep their meaning.
const BOSS_HP_BASE = 1800, BOSS_HP_PER_LEVEL = 280;

// Per-boss health, on top of the roster-wide bossHpMult. The three are fought at very different
// points in a run — the Skeleton King against a starting kit, the Hollow Sovereign against a
// finished build — so "the boss fight is too long" is almost never true of all three at once,
// and one shared dial cannot say which. The stage definitions already carry an authored hpMult
// (1 / 1.3 / 1.6); these sit on top of it so the shipped ratio survives being tuned.
//
// Keyed by boss id rather than by stage number, because endless waves re-fight the same bosses
// through this same function and a stage index would stop meaning anything there.
export const BOSS_HP_KEY = {
  skeletonKing: 'bossHpSkeletonKing',
  sandPharaoh: 'bossHpSandPharaoh',
  hollowSovereign: 'bossHpHollowSovereign',
};

/** The three per-boss dials, in fight order. @type {string[]} */
export const BOSS_HP_KEYS = ['bossHpSkeletonKing', 'bossHpSandPharaoh', 'bossHpHollowSovereign'];

export function makeBoss(level, bossDef) {
  // An unrecognised boss falls back to 1 rather than to undefined — a sandbox or a boss added
  // later without a dial should fight at its authored health, not at NaN.
  const perBoss = ENEMY_GLOBALS[BOSS_HP_KEY[bossDef.id]] || 1;
  const hp = (BOSS_HP_BASE + level * BOSS_HP_PER_LEVEL) * bossDef.hpMult * ENEMY_GLOBALS.bossHpMult * perBoss;
  return {
    name: bossDef.name, tier: 0, radius: 42, speed: 55 * ENEMY_GLOBALS.speedMult,
    hp, maxHp: hp, damage: (26 + level * 3) * bossDef.dmgMult * ENEMY_GLOBALS.dmgMult, xp: 0,
    color: bossDef.color, isBoss: true, contactCd: 0.8,
    // slamRadius doubled, 130 -> 260. It is the ONE number the whole attack is built from: the
    // damage circle, the ground telegraph and the drawn length of the weapon all read it, so
    // this one change makes the sword and the scythe 100% bigger in both reach and picture, and
    // they cannot drift apart.
    slamCd: 3.2, slamRadius: 260, slamTelegraph: 0.9,
    // Carried onto the entity so both spawn paths (the stage clock and the sandbox picker) get
    // it without either having to remember; the renderer only ever sees the entity.
    weapon: bossDef.weapon || 'greatsword',
    rock: bossDef.rock || 'stone',
  };
}

// The authored numbers, captured BEFORE any multiplier touches them. Everything below
// recomputes from this snapshot rather than scaling whatever is currently there — otherwise
// nudging a multiplier twice would compound instead of landing where the slider says.
//
// Frozen because it is the only surviving record of the shipped values: the literals above are
// overwritten in place at load, so if this drifts there is nothing left to restore from and
// every multiplier silently starts measuring against the wrong baseline. Cheap insurance
// against a class of bug that would be very hard to see.
//
// The invariant this creates, stated plainly for whoever comes next: nothing may write to
// ENEMY_TYPES[x].hp / .damage / .speed directly. Those three are DERIVED, and the next call to
// applyEnemyGlobals will overwrite them without warning. Change a multiplier, or change the
// authored literal — not the live value.
const AUTHORED = Object.freeze(Object.fromEntries(Object.entries(ENEMY_TYPES)
  .map(([id, t]) => [id, Object.freeze({ hp: t.hp, damage: t.damage, speed: t.speed })])));

// The four dials the whole roster hangs off, live rather than frozen at module load so the dev
// tools can move them. Bosses carry their own health multiplier because the two are balanced
// against different things: a boss fight is one long duel, a horde is attrition.
export const ENEMY_GLOBALS = {
  hpMult: ENEMY_HP_MULT,
  bossHpMult: BOSS_HP_MULT,
  bossHpSkeletonKing: 1,
  bossHpSandPharaoh: 1,
  bossHpHollowSovereign: 1,
  dmgMult: ENEMY_DMG_MULT,
  speedMult: ENEMY_SPEED_MULT,
  // Seconds between spawns, start and floor. Absolute values, not multipliers — see
  // spawnIntervalFor. 1.1/3 and 0.18/3, the old formula with its density divisor folded in.
  spawnInterval: 1.1 / 3,
  spawnIntervalMin: 0.18 / 3,
  // ---- crowd formation ----
  // How much room a body wants, as a multiple of the two radii summed. Below 1 they overlap;
  // above 1 they hold a visible gap, which is what lets a mob read as many bodies rather than
  // one dark mass. See crowdVary before raising this on its own.
  crowdSpacing: 1.08,
  crowdPush: 58,
  // The one that actually matters for the look. With a single spacing for everybody, the
  // separation solves into hexagonal packing and the horde becomes a tidy honeycomb that
  // clumps as one shape. Giving each body its own slightly different idea of personal space
  // breaks the lattice, so the crowd stays loose and irregular at the same density.
  crowdVary: 0.35,
};

// Recompute every registered enemy from the authored snapshot. Called once at load, and again
// whenever a global changes. Enemies already on the field keep the values they spawned with —
// rewriting a live body's max health mid-fight would move its health bar under the player.
export function applyEnemyGlobals() {
  for (const [id, t] of Object.entries(ENEMY_TYPES)) {
    const a = AUTHORED[id];
    if (!a) continue;
    t.hp = Math.round(a.hp * ENEMY_GLOBALS.hpMult);
    t.damage = Math.round(a.damage * ENEMY_GLOBALS.dmgMult);
    // Not rounded: speed is a per-second rate multiplied by dt every frame, so there is nothing
    // to be gained by snapping it to whole pixels and a slow enemy would lose real precision.
    t.speed = a.speed * ENEMY_GLOBALS.speedMult;
  }
}

// How the dev tools present the four dials. Shown as plain multipliers rather than percentages
// because that is how they read in the source, and 1 obviously means "as shipped".
export const ENEMY_TUNE_META = {
  hpMult:     { label: 'Enemy Health',  min: 0.1, max: 5, step: 0.05, unit: '×' },
  bossHpMult: { label: 'Boss Health',   min: 0.1, max: 5, step: 0.05, unit: '×' },
  // Labelled by who you are fighting, not by stage number, because that is how you think about
  // it while the health bar is on screen.
  bossHpSkeletonKing:    { label: 'Skeleton King',    min: 0.1, max: 5, step: 0.05, unit: '×' },
  bossHpSandPharaoh:     { label: 'Akhmet',           min: 0.1, max: 5, step: 0.05, unit: '×' },
  bossHpHollowSovereign: { label: 'Hollow Sovereign', min: 0.1, max: 5, step: 0.05, unit: '×' },
  dmgMult:    { label: 'Enemy Damage',  min: 0.1, max: 5, step: 0.05, unit: '×' },
  speedMult:  { label: 'Enemy Speed',   min: 0.1, max: 3, step: 0.05, unit: '×' },
  // Seconds, so SMALLER is a faster horde. Labelled as the interval it is rather than as a
  // "rate", because a slider called rate that goes down when you want more is a trap.
  spawnInterval:    { label: 'Spawn Interval',     min: 0.02, max: 3, step: 0.01, unit: 's' },
  spawnIntervalMin: { label: 'Spawn Interval Min', min: 0.01, max: 2, step: 0.01, unit: 's' },
  crowdSpacing: { label: 'Crowd Spacing',   min: 0.5, max: 2.5, step: 0.02, unit: '×' },
  crowdPush:    { label: 'Crowd Push',      min: 0,   max: 200, step: 2 },
  crowdVary:    { label: 'Spacing Variance', min: 0,  max: 1,   step: 0.05 },
};
// Every key the domain OWNS — what gets stored, reset and baked. Which of them a given panel
// draws is a separate question, answered by the display lists below.
export const ENEMY_TUNE_KEYS = ['hpMult', 'bossHpMult', ...BOSS_HP_KEYS, 'dmgMult', 'speedMult',
  'spawnInterval', 'spawnIntervalMin', 'crowdSpacing', 'crowdPush', 'crowdVary'];

// What the main Enemy Stats box shows. Health is absent because it is drawn as its own strip
// directly beneath — split for room, not repeated: two sliders bound to one number sit at
// different values the moment either is moved, and the one you are not looking at is the one
// that gets written last.
export const ENEMY_PAGE_KEYS = ['bossHpMult', 'dmgMult', 'speedMult',
  'spawnInterval', 'spawnIntervalMin', 'crowdSpacing', 'crowdPush', 'crowdVary'];

/* GENERATED: global enemy tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole
   block from tuning/entity-tuning.json. Applied over the shipped constants above, then the
   roster is built from it. */
export const ENEMY_GLOBAL_TUNE = {
  bossHpMult: 1.5,
  crowdVary: 0.3,
  dmgMult: 0.5,
  hpMult: 2,
  spawnInterval: 0.57,
  spawnIntervalMin: 0.1,
  speedMult: 1.1,
};
Object.assign(ENEMY_GLOBALS, ENEMY_GLOBAL_TUNE);
/* END GENERATED */

applyEnemyGlobals();

