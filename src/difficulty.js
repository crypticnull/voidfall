// @ts-check
// ---------- Global difficulty curve ----------
// Extracted from main.js as PURE functions: everything the curve needs is passed in, nothing
// is read from module-level game state. That is the whole point of it living here — the curve
// is the most consequential set of numbers in the game and the easiest thing to get subtly
// wrong, so it should be testable without booting a run.
//
// Measured in "position", a continuous number that runs 0..1..2..3 across the three stages and
// keeps counting through endless waves — so difficulty does not restart or jump at a stage
// boundary the way per-stage multipliers do.
//
// The whole escalation is FOUR DIALS PER STAT — end, bend, tailAt, beyond. There is no table
// of per-stage values underneath: curveScale computes straight from the shape, so the chart in
// the dev tools and the numbers the game runs on cannot disagree.
//
// It got here in two steps. First a pair of exponential segments joined at a midpoint: compact,
// but you could not say "arrive later" without also moving where it ended. Then a table of
// eleven hand-set anchors per stat: complete control, forty-four sliders, and nobody ever
// wanted to know what stage 6 was worth on its own. The useful question was always "how steep,
// how late, and where does it stop bending" — which is what these four answer.
//
// Speed is deliberately the gentlest: past roughly 2x, enemies outrun the player and the game
// stops being readable rather than getting harder.

/** @typedef {{ hp: number, damage: number, speed: number, spawnRate: number }} StatSet */

/** Default position where the shape ends and the tail takes over. Per-stat, and movable. */
export const CURVE_LAST = 10;

/**
 * The whole escalation, per stat.
 *
 *   value(pos) = end ^ ( (pos/tailAt) ^ bend )      for 0 <= pos <= tailAt
 *   value(pos) = end * beyond ^ (pos - tailAt)      past that, forever
 *
 * `end` is where the ramp lands at the last position. `bend` is WHERE the difficulty arrives:
 * 1 is an even geometric climb (a straight line on the chart's log axis), above 1 holds the
 * early stages down and stacks the pain late, below 1 front-loads it.
 *
 * Every value starts at 1x by construction, so there is no way to accidentally begin a run at
 * anything other than baseline.
 * @type {Record<string, { end: number, bend: number, tailAt: number }>}
 */
// Chosen, not fitted. The old two-segment curve could not be reproduced by a single power law
// — speed and spawn rate especially, which spiked early then went flat — so these are round
// numbers picked to be a sane starting shape rather than an impression of what came before.
// Tune them; that is what they are for.
// `tailAt` is where that stat stops following its shape and starts compounding — per stat,
// because they do not all want to plateau together. Speed reaching its ceiling early while
// health keeps climbing is a perfectly good shape for a run, and one global value cannot say it.
export const CURVE_SHAPE = {
  hp:        { end: 9,   bend: 0.9,  tailAt: CURVE_LAST }, // the main pressure, all the way up
  damage:    { end: 4.5, bend: 0.95, tailAt: CURVE_LAST }, // near-even; a late spike feels unfair
  speed:     { end: 1.4, bend: 0.6,  tailAt: CURVE_LAST }, // gentlest: past ~2x enemies outrun you
  spawnRate: { end: 4.5, bend: 0.7,  tailAt: CURVE_LAST }, // density early, so the screen fills
};

/**
 * Growth per position PAST the end of the shape, compounding. Endless has no last stage, so
 * the shape has to hand over to a formula somewhere; this is where.
 * @type {Record<string, number>}
 */
/**
 * How fast the tail's own growth rate compounds, per position past `CURVE_ACCEL_FROM`.
 * 1 = the old straight tail. See tailGrowth.
 * @type {Record<string, number>}
 */
export const CURVE_ACCEL = {
  hp: 1, damage: 1, speed: 1, spawnRate: 1,
};
/**
 * How many positions past the reference the acceleration waits before biting, so the opening
 * waves stay a fair fight and the clamp arrives later in the run.
 * @type {Record<string, number>}
 */
export const CURVE_ACCEL_FROM = {
  hp: 0, damage: 0, speed: 0, spawnRate: 0,
};

/**
 * The FLOOR: what each stat is worth at the very start of the run, before the curve has climbed.
 *
 * Every curve begins at exactly 1x by construction, which means the opening minutes are always
 * the same fight no matter how the rest of the run is tuned — the dials move where difficulty
 * ARRIVES, never where it starts. A floor gives that missing dial: raise it and stage 1 opens
 * above baseline.
 *
 * 1 is off, and off is the default, so the shipped game is unchanged until a number is moved.
 * @type {Record<string, number>}
 */
export const CURVE_FLOOR = {
  hp: 1, damage: 1, speed: 1, spawnRate: 1,
};

export const CURVE_BEYOND = {
  hp: 1.2148,
  damage: 1.1487,
  speed: 1.0038,
  spawnRate: 1.0524,
};

/** A stage that names no multipliers sits exactly on the curve. @type {StatSet} */
export const STAGE_STATS_DEFAULT = { hp: 1, damage: 1, speed: 1, spawnRate: 1 };

/* GENERATED: difficulty curve tuning. Do not hand-edit — tools/bake-tuning.py rewrites this
   whole block from tuning/entity-tuning.json. Keys are `end`, `bend`, `tailAt` and
   `beyond`, per stat. */
export const CURVE_TUNE = {
  damage: { accel: 1.012, accelFrom: 7, bend: 1.3, beyond: 1.11, end: 2.5, tailAt: 3 },
  hp: { accel: 1.018, accelFrom: 4, bend: 0.9, beyond: 1.2, end: 4, floor: 0.8, tailAt: 3 },
  spawnRate: { bend: 2.05, beyond: 1.107, end: 3, tailAt: 3 },
  speed: { bend: 1.9, beyond: 1.107, end: 2, tailAt: 3 },
};
/* END GENERATED */

for (const [stat, over] of Object.entries(CURVE_TUNE)) {
  if (!CURVE_SHAPE[stat]) continue;
  if (over.end !== undefined) CURVE_SHAPE[stat].end = over.end;
  if (over.bend !== undefined) CURVE_SHAPE[stat].bend = over.bend;
  if (over.tailAt !== undefined) CURVE_SHAPE[stat].tailAt = over.tailAt;
  if (over.beyond !== undefined) CURVE_BEYOND[stat] = over.beyond;
  if (over.accel !== undefined) CURVE_ACCEL[stat] = over.accel;
  if (over.accelFrom !== undefined) CURVE_ACCEL_FROM[stat] = over.accelFrom;
  if (over.floor !== undefined) CURVE_FLOOR[stat] = over.floor;
}

/**
 * One stat's dials as a flat, live object — `end`, `bend`, `tailAt`, `beyond`. Accessors rather than a
 * copy, so the tuning panel and the curve read the same numbers with nothing to keep in sync.
 * @param {string} stat
 */
export function curveFlatFor(stat) {
  const o = {};
  Object.defineProperty(o, 'end', {
    enumerable: true, get: () => CURVE_SHAPE[stat].end, set: (v) => { CURVE_SHAPE[stat].end = v; },
  });
  Object.defineProperty(o, 'bend', {
    enumerable: true, get: () => CURVE_SHAPE[stat].bend, set: (v) => { CURVE_SHAPE[stat].bend = v; },
  });
  Object.defineProperty(o, 'tailAt', {
    enumerable: true, get: () => CURVE_SHAPE[stat].tailAt, set: (v) => { CURVE_SHAPE[stat].tailAt = v; },
  });
  Object.defineProperty(o, 'floor', {
    enumerable: true, get: () => CURVE_FLOOR[stat], set: (v) => { CURVE_FLOOR[stat] = v; },
  });
  Object.defineProperty(o, 'beyond', {
    enumerable: true, get: () => CURVE_BEYOND[stat], set: (v) => { CURVE_BEYOND[stat] = v; },
  });
  Object.defineProperty(o, 'accel', {
    enumerable: true, get: () => CURVE_ACCEL[stat], set: (v) => { CURVE_ACCEL[stat] = v; },
  });
  Object.defineProperty(o, 'accelFrom', {
    enumerable: true,
    get: () => CURVE_ACCEL_FROM[stat], set: (v) => { CURVE_ACCEL_FROM[stat] = v; },
  });
  return o;
}

const clamp01 = (/** @type {number} */ v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * How far through the current stage we are, by whichever gate summons the boss first.
 * @param {{ stageElapsed: number, stageKills: number, bossTime: number, killThreshold: number }} p
 * @returns {number} 0..1
 */
export function stageFraction(p) {
  return clamp01(Math.max(p.stageElapsed / p.bossTime, p.stageKills / p.killThreshold));
}

/**
 * Continuous difficulty position. Endless picks up exactly where stage 3 left off — wave 1
 * starts at the same value the stage ends on, so there is no discontinuity at the handover.
 * @param {{ currentStage: number, stageCount: number, beatFinalBoss: boolean,
 *           endlessWave: number, fraction: number }} p
 */
export function difficultyPosition(p) {
  if (p.beatFinalBoss) return p.stageCount + Math.max(0, p.endlessWave - 1) + p.fraction;
  return p.currentStage + p.fraction;
}

/**
 * Curve multiplier for one stat at a given position. Computed straight from the shape — there
 * is no table to read or interpolate, so there is nothing that can disagree with the picture.
 * @param {string} stat
 * @param {number} pos
 */
export function curveScale(stat, pos) {
  const sh = CURVE_SHAPE[stat];
  if (!sh) return 1;
  return shapeValue({ ...sh, beyond: CURVE_BEYOND[stat], floor: CURVE_FLOOR[stat],
    accel: CURVE_ACCEL[stat], accelFrom: CURVE_ACCEL_FROM[stat] }, pos);
}

/**
 * The curve form itself, with nothing game-specific in it.
 *
 *   value(pos) = end ^ ( (pos/tailAt) ^ bend )      for 0 <= pos <= tailAt
 *   value(pos) = end * beyond ^ (pos - tailAt)      past that, forever
 *
 * Pulled out of curveScale so the gold curves in loot.js can be the SAME shape rather than a
 * second implementation of it. Two copies of this arithmetic would drift, and the dev tools
 * chart draws whichever one it is handed — so a drift would be invisible until the numbers
 * disagreed in play.
 *
 * Always 1 at pos <= 0, so anything built on it starts at baseline by construction.
 * ---------- Two shapes, one set of dials ----------
 * `mode` picks the family. Both start at 1, both land exactly on `end` at `tailAt`, and both
 * take the same four dials — so the chart, the readouts and the tuning panel need to know
 * nothing about which one a given stat uses.
 *
 *   'exp' (default)  end ^ ((pos/tailAt) ^ bend)      — the original, and right for PROPORTIONS
 *   'power'          1 + (end-1) * (pos/tailAt)^bend  — right for COUNTS
 *
 * The distinction matters more than it looks. An exponential curve spends its whole first half
 * near 1, which is invisible on a percentage (nobody minds +4% damage at level 1) and fatal on a
 * count: rounded to whole projectiles, Quantity at end 25 sat on +1 from level 1 to level 7,
 * then went to +24 by level 20. Every early level bought nothing and every late one bought four.
 * That is not a tuning problem — no value of `end` fixes it, because raising the top only
 * steepens the cliff.
 *
 * The power form spreads the same total evenly: at bend 1 it is a straight line, so every level
 * is worth the same visible step, and `bend` still slides the payoff early or late. `end` keeps
 * its meaning in both, which is what lets one slider serve both families.
 *
 * `floor` is what position 0 is worth — see CURVE_FLOOR. Optional and 1 by default, so every
 * caller that does not set it (the tome curves, the gold curves) is untouched.
 *
 * @param {{ end: number, bend: number, tailAt: number, beyond: number,
 *           beyondPer?: number, accel?: number, accelFrom?: number, floor?: number,
 *           mode?: 'exp'|'power' }} sh
 * @param {number} pos
 */
export function shapeValue(sh, pos) {
  if (!sh || pos <= 0) return sh && sh.floor > 0 && sh.floor !== 1 ? sh.floor : 1;
  const end = Math.max(1e-6, sh.end);
  const tail = Math.max(0.5, sh.tailAt);
  // A floor LIFTS the curve rather than clamping it. `Math.max(floor, raw)` is the obvious
  // reading and it is wrong for exactly the reason the tome curves document: it holds the first
  // stretch flat at the floor until the curve climbs past it, so the higher the floor the more
  // early positions become dead — the opposite of what raising an opening difficulty is for.
  //
  // Remapping [1, end] onto [floor, end] keeps every position distinct and leaves the top
  // anchor exactly where it was, so `end` still means what it says and the tail past `tailAt`
  // is untouched (it multiplies `end`, which has not moved). Continuity at the handover is free
  // for the same reason.
  // Either side of 1: above it the run opens harder, below it the run opens SOFTER — enemies
  // start weaker than baseline and the curve climbs to the same `end`, which is the shape of an
  // easier on-ramp rather than an easier game. Zero and negative are refused rather than
  // clamped silently: a floor of 0 means enemies with no health, which is not a difficulty
  // setting, it is a broken run.
  if (sh.floor > 0 && sh.floor !== 1 && end > 1 && sh.floor < end) {
    const raw = shapeValue({ ...sh, floor: 1 }, pos);
    // ONLY the shaped run is remapped. Past `tailAt` the value is `end x growth`, and lifting
    // that would quietly compress the whole endless tail — the floor is a statement about where
    // the run STARTS, not a rescale of where it ends up. Handing the tail back untouched also
    // makes the handover continuous for free, since the shaped side lands exactly on `end`.
    if (pos >= tail) return raw;
    return sh.floor + (raw - 1) * ((end - sh.floor) / (end - 1));
  }
  if (sh.mode === 'power') {
    const per = sh.beyondPer || 1;
    if (pos >= tail) return end * tailGrowth(sh, (pos - tail) / per);
    return 1 + (end - 1) * Math.pow(pos / tail, Math.max(0.05, sh.bend));
  }
  // `beyondPer` is how many x-units one step of `beyond` covers. It exists because the curves
  // do not share an x unit: the difficulty and campaign curves step per POSITION, where 1 is a
  // whole stage and per-unit compounding is the natural reading, while the horde rush steps per
  // SECOND — and a rate quoted per second is unusable to tune, because 1.015 looks like nothing
  // and is 87x over five minutes. Quoting that curve per five minutes puts the dial back in the
  // units the person turning it is actually thinking in. Defaults to 1, so every existing curve
  // is unaffected.
  const per = sh.beyondPer || 1;
  if (pos >= tail) return end * tailGrowth(sh, (pos - tail) / per);
  return Math.pow(end, Math.pow(pos / tail, Math.max(0.05, sh.bend)));
}

/**
 * The tail past the reference, as a multiplier on `end`.
 *
 * Plain `beyond^k` is a straight line on a log axis: whatever it is worth at wave 1 it is worth
 * forever. That is what made endless monotonous — the shaped part of the curve ends at the last
 * stage, so every wave after it grew by exactly the same factor, and a run either outscaled that
 * fixed rate immediately or never did.
 *
 * `accel` compounds the GROWTH RATE itself, once per position past `accelFrom`. So the tail has
 * its own shape: it opens near parity with a levelling player, then bends upward and eventually
 * outruns anything. That is the soft clamp — not a wall you hit at a fixed wave, but a rate that
 * beats you at whatever wave your build runs out of road. Break the game harder and you get
 * further; you do not get to go forever.
 *
 *   rate at step i = beyond * accel^max(0, i - accelFrom - 1)
 *   value          = beyond^k * accel^T,  T the triangular number of accelerated steps
 *
 * `accel: 1` reduces to the old straight tail exactly, so every curve that does not set it is
 * unchanged.
 * @param {{ beyond?: number, accel?: number, accelFrom?: number }} sh
 * @param {number} k positions past the reference, already divided by `beyondPer`
 */
function tailGrowth(sh, k) {
  const beyond = sh.beyond === undefined ? 1 : sh.beyond;
  const accel = sh.accel === undefined ? 1 : sh.accel;
  const base = Math.pow(beyond, k);
  if (accel === 1 || k <= 0) return base;
  // Steps that have started accelerating, and the triangular sum of their exponents. Continuous
  // in k so the curve stays smooth between whole positions rather than stepping.
  const t = Math.max(0, k - (sh.accelFrom || 0));
  return base * Math.pow(accel, (t * (t - 1)) / 2);
}

/**
 * A stage's enemy multipliers with defaults filled in — a stage need only name what it changes.
 * @param {{ enemyStats?: Partial<StatSet> } | undefined | null} stage
 * @returns {StatSet}
 */
export function stageEnemyStats(stage) {
  return { ...STAGE_STATS_DEFAULT, ...(stage && stage.enemyStats) };
}

// ---------- Armor as a depleting shield ----------
// Armor is no longer flat damage reduction. It is a pool of SHIELD UNITS: a hit that lands
// while the shield holds is absorbed entirely and costs units instead of health.
//
// A light hit costs one unit. Heavier hits cost more, in whole units, on this curve — so a
// boss slam strips a shield that would have soaked several trash hits. Whole numbers keep it
// legible: the player can count what a hit will cost.
//
// ARMOR_UNIT_DAMAGE is the damage one unit covers; ARMOR_COST_EXP bends the curve. At 1.0 the
// cost is linear in damage; above 1.0 big hits cost disproportionately more.
export const ARMOR_UNIT_DAMAGE = 12;
export const ARMOR_COST_EXP = 1.15;

/**
 * Grants shield capacity and hands the new units over immediately, rather than raising the
 * ceiling and making the player wait for the recharge to climb into it.
 *
 * Recharge is meant to be the cost of LOSING armour, not of gaining it: picking up +4 Armor
 * and watching an empty bar tick up one unit every 2.5s reads as the pickup not having worked.
 * It is worst on a class that starts with none, where the reward is a bar that is still empty.
 *
 * Shared by both grant sites — the rarity affix and the level-up stat — so a third one cannot
 * quietly reintroduce the delay.
 *
 * @param {{ armor: number, armorLeft: number }} p
 * @param {number} v
 */
export function grantArmor(p, v) {
  p.armor += v;
  p.armorLeft = (p.armorLeft || 0) + v;
}

/**
 * Whole shield units a hit of `damage` consumes. Always at least 1, so no attack is free.
 * @param {number} damage
 */
export function armorCost(damage) {
  if (!(damage > 0)) return 1;
  return Math.max(1, Math.ceil(Math.pow(damage / ARMOR_UNIT_DAMAGE, ARMOR_COST_EXP)));
}
