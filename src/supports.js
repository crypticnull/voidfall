// Support gems are global modifiers ("linked" conceptually to all active skills).
// Support gems are UNCAPPED — they can be stacked indefinitely, and each additional level
// re-applies the effect. Stack +projectiles far enough and the framerate is your only limit.

import { shapeValue } from './difficulty.js';
import { MAX_CRIT_CHANCE } from './utils.js';

/* GENERATED: tome curve tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole
   block from tuning/entity-tuning.json under the `tomes` domain. */
export const TOME_CURVE_TUNE = {
  addeddamage: { bend: 1, beyond: 1.0871, end: 3.5, lv1: 0, tailAt: 15 },
  critchance: { bend: 1, beyond: 1.0082, end: 1.92, lv1: 0, tailAt: 15 },
  critdamage: { bend: 1, beyond: 1.1087, end: 4.7, lv1: 0, tailAt: 15 },
  duration: { bend: 1, beyond: 1.1071, end: 4.6, lv1: 0, tailAt: 15 },
  fasterattacks: { bend: 1, beyond: 1.0059, end: 1.84, lv1: 0, tailAt: 15 },
  increasedarea: { bend: 1, beyond: 1.0968, end: 4, lv1: 0, tailAt: 15 },
  lifeleech: { bend: 1, beyond: 1.02, end: 1.37, lv1: 0, tailAt: 15 },
  multiproj: { bend: 1, beyond: 1.0553, end: 16, lv1: 0, tailAt: 15 },
  pierce: { bend: 1.2, end: 10 },
};
/* END GENERATED */

/**
 * How each tome's effect grows with its level, on the SAME four dials as the difficulty curve —
 * `end`, `bend`, `tailAt`, `beyond` — with tome level standing in for position.
 *
 *   magnitude(lvl) = shapeValue(curve, lvl) - 1
 *
 * The -1 is what makes it a magnitude rather than a multiplier: shapeValue is 1 at level 0, so
 * an unheld tome contributes nothing by construction, and `end` reads as "what this tome is
 * worth by level `tailAt`". A Damage end of 1.9 means +90% damage at level 5.
 *
 * `tailAt` is the reference level — the point every tome is balanced against —
 * and `beyond` is what each further level compounds by after that. Both were calibrated from
 * the old linear rates so switching to this model did not quietly rebalance anything: every
 * tome lands on its previous value at level 5 and within a percent of it at level 10.
 *
 * @type {Record<string, { end: number, bend: number, tailAt: number, beyond: number,
 *                         lv1?: number, mode?: 'exp'|'power' }>}
 */
// `mode: 'power'` on the two COUNTING tomes — see shapeValue. On an exponential curve a rounded
// count sits flat for the first half of its range and then explodes; the power form spreads the
// same total across every level, so each one buys a visible step. The other seven are
// proportions and stay exponential, which is the shape a percentage wants.
//
// `lv1` is the FIFTH dial: what level 1 of this tome is worth, pinned. Quantity has always had
// this — `tomeCount` floors it at 1, so the first Quantity is guaranteed to be a whole extra
// projectile no matter what the curve says underneath. Every other tome lacked it, and the
// curve alone gives a thin opening level: Damage at `end: 3` over 20 levels is worth +5.7% at
// level 1, which is not a pick you can feel. `lv1` sets that opening number directly.
//
// 0 means "no floor — use the curve", which is what all nine ship as, so the default behaviour
// is bit-for-bit what it was before this dial existed. See `tomeMagnitude` for the remap.
export const TOME_CURVE = {
  addeddamage:   { end: 4.6,  bend: 1, tailAt: 20, beyond: 1.034, lv1: 0 },
  multiproj:     { end: 21,   bend: 1, tailAt: 20, beyond: 1.040, lv1: 0, mode: 'power' },
  fasterattacks: { end: 1.88, bend: 1, tailAt: 20, beyond: 1.004, lv1: 0 },
  increasedarea: { end: 4,    bend: 1, tailAt: 20, beyond: 1.032, lv1: 0 },
  pierce:        { end: 21,   bend: 1, tailAt: 20, beyond: 1.040, lv1: 0, mode: 'power' },
  lifeleech:     { end: 1.4,  bend: 1, tailAt: 20, beyond: 1.013, lv1: 0 },
  // Magnitude is PERCENT POINTS of max life per second, not a proportion — 1.8 at the
  // reference means 1.8%/s. Power mode for the same reason the counting tomes use it: an
  // exponential spends its first half invisibly, and a regen tome whose early levels heal
  // nothing that shows on the bar is a dead pick. lv1 makes the first level worth feeling.
  hpregen:       { end: 2.8,  bend: 1, tailAt: 20, beyond: 1.03, lv1: 0.25, mode: 'power' },
  critchance:    { end: 2.6,  bend: 1, tailAt: 20, beyond: 1.027, lv1: 0 },
  critdamage:    { end: 5,    bend: 1, tailAt: 20, beyond: 1.034, lv1: 0 },
  duration:      { end: 3,    bend: 1, tailAt: 20, beyond: 1.029, lv1: 0 },
};

/* GENERATED: tome master tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole
   block from tuning/entity-tuning.json under the `tomemaster` domain. */
export const TOME_MASTER_TUNE = {
};
/* END GENERATED */

/**
 * One dial over the whole shelf. Scales every tome's MAGNITUDE — the `end - 1` part — rather
 * than `end` itself, so the number means what it says at both extremes: 0 makes tomes do
 * nothing, 1 is exactly as each is tuned, 2 doubles every tome's payoff. Scaling `end` raw
 * would make 0 mean "divide by nothing" instead.
 */
export const TOME_MASTER = { endScale: 1, ...TOME_MASTER_TUNE };

export const TOME_MASTER_TUNE_META = {
  endScale: { label: 'All Tome Power', min: 0, max: 3, step: 0.05, unit: '×' },
};
for (const [id, over] of Object.entries(TOME_CURVE_TUNE)) {
  if (TOME_CURVE[id]) Object.assign(TOME_CURVE[id], over);
}

/** How the dev panel presents a tome's dials. Level is the x axis, so tailAt is in LEVELS. */
export const TOME_TUNE_META = {
  // 25 -> 96. Quantity is the one tome whose `end` is a COUNT rather than a proportion, so it
  // needs a range the others never do: 25 capped it at +24 projectiles, which is a ceiling on
  // the build rather than on the slider. The other eight sit far below this and are unaffected.
  end:    { label: 'Value at Ref Lv', min: 1,  max: 96, step: 0.05, unit: '×' },
  bend:   { label: 'Bend',           min: 0.2, max: 3,  step: 0.05 },
  tailAt: { label: 'Reference Level', min: 1,  max: 20, step: 1 },
  beyond: { label: 'Per Level Past', min: 1,   max: 2,  step: 0.005, unit: '×' },
  // In MAGNITUDE units, the same units `end - 1` is in: 0.15 on a proportional tome is "level 1
  // is worth +15%", 1 on a counting tome is "level 1 hands over one whole thing". One range has
  // to cover both, hence a max well above anything a percentage tome wants.
  // 0 is off, and reads naturally as such: a floor of nothing is no floor.
  lv1:    { label: 'Lv 1 Floor',     min: 0,   max: 20, step: 0.01 },
};

/**
 * What a tome is worth at a given level. Zero at level 0, so an absent tome is free.
 * @param {string} id @param {number} lvl
 */
export function tomeMagnitude(id, lvl) {
  const c = TOME_CURVE[id];
  if (!c || !(lvl > 0)) return 0;
  const scale = TOME_MASTER.endScale;
  // The master scales the magnitude, so the curve shape is preserved and only its size moves.
  const end = scale === 1 ? c.end : 1 + (c.end - 1) * scale;
  const shape = { ...c, end };
  const raw = shapeValue(shape, lvl) - 1;
  const m = applyLv1Floor(shape, raw);
  // SOFT CAP. A tome carrying one of these keeps growing forever, but past `level` it stops
  // COMPOUNDING and adds a flat `perLevel` instead — so the curve's shaped run is what the tome
  // is really worth, and everything past it is a consolation prize.
  //
  // This replaced a hard `cap`, which clamped the value AND withdrew the tome from the card pool
  // the moment the curve reached it. That was the safe fix for a real problem — the seamless
  // `beyond` tail compounded into +316,325% in play — but it meant a deep endless run stopped
  // being offered Damage at all, and a dead card slot is its own kind of broken. Growth that
  // never stops but never runs away keeps the card meaningful without letting it detonate.
  //
  // Computed from the same scaled `shape`, so the master endScale dial still moves both halves
  // together and the seam cannot drift.
  const soft = SUPPORTS[id] && SUPPORTS[id].softCap;
  if (soft && lvl > soft.level) {
    const atSeam = applyLv1Floor(shape, shapeValue(shape, soft.level) - 1);
    return atSeam + (lvl - soft.level) * soft.perLevel;
  }
  return m;
}

/**
 * Lift the curve so level 1 is worth exactly `lv1`, without moving what the tome is worth at its
 * reference level.
 *
 * A plain clamp — `max(lv1, raw)` — was the obvious reading of "floor", and it is wrong here: it
 * would hold the first several levels at the SAME value until the curve climbed past the floor,
 * which is dead levels. That is the exact failure `mode: 'power'` was added to fix on the
 * counting tomes, and it would be worse here because it gets worse the more you raise the dial —
 * the harder you push for a meaningful level 1, the more levels you flatten behind it.
 *
 * So the raw curve is remapped from [raw(1), raw(tailAt)] onto [lv1, raw(tailAt)] instead. Level
 * 1 lands on `lv1`, the reference level still lands on `end - 1` so nothing already balanced
 * against it moves, and every level between them keeps its share of the climb. Past `tailAt` the
 * `beyond` compounding rides the same factor, so the tail stays monotone.
 *
 * @param {{ end: number, bend: number, tailAt: number, beyond: number, lv1?: number,
 *           mode?: 'exp'|'power' }} shape
 * @param {number} raw
 */
function applyLv1Floor(shape, raw) {
  const lv1 = shape.lv1 || 0;
  if (lv1 <= 0) return raw;                       // off: identical to having no dial at all
  const first = shapeValue(shape, 1) - 1;         // what level 1 is worth on the bare curve
  const ref = shapeValue(shape, shape.tailAt) - 1;
  // A floor at or above the reference value has no room to climb into. Rather than invert the
  // curve (higher levels worth LESS), flatten honestly to the floor and let the dev panel's
  // chart show it as the misconfiguration it is.
  if (!(ref > first) || lv1 >= ref) return Math.max(lv1, raw);
  return lv1 + (raw - first) * ((ref - lv1) / (ref - first));
}
// ---------- Live descriptions ----------
// A tome's text is GENERATED from its curve rather than written next to it. The old strings were
// per-level rates left over from the linear model this replaced ("+18% skill damage per level"),
// and nothing has been linear since: Damage is worth +8% at level 1 and +360% at level 20, so no
// single per-level figure was ever true. Worse, they were literals — every drag in the dev tools
// moved the numbers the game runs on and left the card advertising the old ones.
//
// Rounding is PER STAT, not global. A percentage reads as a whole number; nobody wants
// "+18.34% damage". But Quantity counts things, and rounding it to whole projectiles is exactly
// what made the tome look broken — three levels of "+0 projectiles" before the fourth finally
// landed one. Shown to one decimal it is visibly climbing the whole way up.
const pct = (v) => `${Math.round(v * 100)}%`;

// ---------- Counting tomes ----------
// Quantity and Pierce hand out WHOLE things. Both used to round inside `apply` and print the raw
// float on the card, so a card promising "+2.4 projectiles" delivered 2 — the text and the game
// disagreed by up to half a projectile at every level, in a stat where half a projectile is the
// difference between two and three.
//
// The count is computed HERE, once, and both the effect and the label read it. There is no
// second rounding rule to drift.
//
// Level 1 is pinned to exactly +1. The curve is smooth and starts near zero, so the first level
// of a Quantity tome rounded to nothing — you spent a card and fired the same number of shots,
// which reads as the tome being broken rather than as a curve arriving later. Pinning the first
// level costs nothing at the top and makes the pick legible at the bottom.
// Monotonic by construction: the curve only climbs, so Math.max keeps the pinned floor from
// ever being a step DOWN at level 2.
/**
 * Where a level's fraction of a unit becomes a whole one. 0.5 is the arithmetic answer and the
 * wrong one for a stat you BUY: a curve that climbs by less than a full unit per level will
 * always produce repeated integers under nearest-rounding, and a repeated integer is a level-up
 * that bought nothing. Quantity gained 0.78 of a projectile between levels 1 and 2 and both
 * landed on +1.
 *
 * At 0.35 a level only repeats when it genuinely bought less than a third of a unit — which is
 * a real answer rather than a rounding artefact. It shifts nothing else on the current curves:
 * every other breakpoint's fraction sits outside the 0.35–0.5 window this widens.
 */
const COUNT_THRESHOLD = 0.35;

/** @param {string} id @param {number} lvl */
export function tomeCount(id, lvl) {
  if (!(lvl > 0)) return 0;
  // ceil(x - t) is "round up once the fraction reaches t". Floored at 1 so the first level of a
  // counting tome always hands over something.
  return Math.max(1, Math.ceil(tomeMagnitude(id, lvl) - COUNT_THRESHOLD));
}

/** The tomes whose effect is a COUNT of whole things rather than a proportion. */
export const COUNTING_TOMES = new Set(['multiproj', 'pierce']);

/**
 * How many levels the count actually rises by between two levels. Zero is a real answer.
 * @param {string} id @param {number} from @param {number} to
 */
export function tomeGain(id, from, to) { return tomeCount(id, to) - tomeCount(id, from); }

/**
 * Levels needed from `lvl` before the count goes up at all.
 *
 * A counting tome spends stretches of its curve on the same integer — with a shallow `end` that
 * can be a dozen levels — so a card offering "+1 level" of it can hand over literally nothing.
 * A level-up card that does nothing is the worst thing in a game built on level-up cards, and
 * the player has no way to tell before choosing. The card generator asks this and rolls enough
 * levels to clear the step.
 *
 * Capped: if the curve is so flat that twelve levels do not move it, the tome is misconfigured
 * and the honest thing is to stop rather than hand out a free fortune.
 * @param {string} id @param {number} lvl @param {number} [maxSteps]
 */
export function levelsToNextCount(id, lvl, maxSteps = 12) {
  const base = tomeCount(id, lvl);
  for (let k = 1; k <= maxSteps; k++) if (tomeCount(id, lvl + k) > base) return k;
  return maxSteps;
}

/**
 * What a level-up CARD says: what THIS pick hands over, and nothing else.
 *
 * Every tome reports the gain now, not the running total. A card is an offer — the question it
 * has to answer is "what do I get for taking this", and a cumulative figure answers a different
 * one. Worse, it answers it ambiguously: "+107% skill damage" on a card looks like a card that
 * grants 107%, and the player has no way to tell how much of that they already had.
 *
 * Counting tomes were switched to the gain first, because a repeated integer made the problem
 * undeniable there. The same argument was always true of the proportional ones; the rounding
 * just hid it.
 * @param {string} id @param {number} from @param {number} to
 */
export function tomeCardDesc(id, from, to) {
  const def = SUPPORTS[id];
  if (!def) return '';
  if (def.gainFmt) return def.gainFmt(tomeGain(id, from, to));
  // Proportional tomes: the difference between the two levels' magnitudes, run through the
  // tome's own formatter so the wording and units stay identical to everywhere else.
  if (def.fmt) return def.fmt(tomeMagnitude(id, Math.max(0, to)) - tomeMagnitude(id, Math.max(0, from)));
  return '';
}

export const SUPPORTS = {
  addeddamage: {
    name: 'Damage', icon: '✖', color: '#8a2e22',
    fmt: (m) => `+${pct(m)} skill damage`,
    // NO HARD CAP. It used to stop dead at +700%, which also withdrew the tome from the card
    // pool at level 25 (tomeMaxLevel) — so the deepest runs, the ones with the most levels to
    // spend, were the ones that stopped being offered Damage.
    //
    // The soft cap keeps it growing without letting it detonate. Levels 1-25 are the authored
    // curve, ending at +707%; past that each level adds a flat +10% instead of compounding at
    // 3.4%. Uncapped compounding reached +423,519% by level 100 and +1.79 BILLION percent by
    // 200; the same levels now read +1,450% and +2,450%. Still a reward, no longer an exploit.
    softCap: { level: 25, perLevel: 0.1 },
    apply(mods, lvl) {
      mods.damageMult *= 1 + tomeMagnitude('addeddamage', lvl);
    },
  },
  multiproj: {
    name: 'Quantity', icon: '⁙', color: '#4a6d7a',
    // Counted, not curved: the label and the effect both read tomeCount, so the card cannot
    // promise a fraction of an arrow the game will not fire.
    fmtLvl: (lvl) => `+${tomeCount('multiproj', lvl)} projectile${tomeCount('multiproj', lvl) === 1 ? '' : 's'}`,
    gainFmt: (g) => (g > 0 ? `+${g} more projectile${g === 1 ? '' : 's'}` : 'no extra projectiles'),
    apply(mods, lvl) { mods.projectileBonus += tomeCount('multiproj', lvl); },
  },
  fasterattacks: {
    name: 'Swiftness', icon: '»', color: '#a8842f',
    // Capped in the TEXT at the same 90% the effect is capped at, so the card cannot promise a
    // reduction the floor below will not honour.
    fmt: (m) => `-${pct(Math.min(0.9, m))} cooldown`,
    // The ceiling `apply` below already enforces. Declaring it here is what lets the level-up
    // roller stop offering the tome once it is reached, instead of selling a level that the
    // clamp silently eats.
    cap: 0.9,
    // Floored at 10% of the original: a cooldown driven to zero is not a build, it is a
    // divide-by-nothing that fires every frame.
    apply(mods, lvl) { mods.cooldownMult *= Math.max(0.1, 1 - tomeMagnitude('fasterattacks', lvl)); },
  },
  increasedarea: {
    name: 'Scale', icon: '⤡', color: '#5c3f6e',
    fmt: (m) => `+${pct(m)} area of effect and effect size`,
    // 20% -> 15% per level. Additive off the per-level rate, not a multiplier on the total, so
    // the cut is the same 5 points at every level rather than compounding against itself.
    //
    // It also lands harder than it reads, because this tome is the only one that drives TWO
    // stats — area and size — and several skills multiply both together. Worth re-checking the
    // skills that do before cutting it again.
    apply(mods, lvl) { mods.areaMult *= 1 + tomeMagnitude('increasedarea', lvl); },
  },
  pierce: {
    name: 'Pierce', icon: '↠', color: '#2f6e5c',
    fmtLvl: (lvl) => `Projectiles pierce +${tomeCount('pierce', lvl)} enem${tomeCount('pierce', lvl) === 1 ? 'y' : 'ies'}`,
    gainFmt: (g) => (g > 0 ? `Pierce +${g} more enem${g === 1 ? 'y' : 'ies'}` : 'no extra pierce'),
    apply(mods, lvl) { mods.pierceBonus += tomeCount('pierce', lvl); },
  },
  lifeleech: {
    name: 'Lifesteal', icon: '♥', color: '#7a1f2e',
    fmt: (m) => `Leech ${pct(m)} of damage dealt as life`,
    apply(mods, lvl) { mods.lifeLeech += tomeMagnitude('lifeleech', lvl); },
  },
  hpregen: {
    name: 'HP Regen', icon: '❈', color: '#3fa66a',
    // Its own formatter, not pct(): that rounds to whole percent, and this tome lives below
    // 1% for most of its curve — every early level would display as "0%".
    fmt: (m) => `Regenerate ${+m.toFixed(1)}% of max life per second`,
    // CHASSIS, NOT WEAPON. Every other tome modifies what skills do, so `apply` writes into
    // the per-skill mods. Regen modifies the player, and pushing it through skill mods would
    // apply it once per equipped skill. The player's own regen tick in main.js reads the tome
    // level directly; this apply exists because the tome contract requires one.
    apply() {},
  },
  critchance: {
    name: 'Crit Chance', icon: '✦', color: '#3a3a42',
    fmt: (m) => `+${pct(m)} critical strike chance`,
    cap: MAX_CRIT_CHANCE,
    apply(mods, lvl) { mods.critChance += tomeMagnitude('critchance', lvl); },
  },
  critdamage: {
    name: 'Crit Damage', icon: '✹', color: '#7a2f3a',
    // ADDITIVE on the class's own multiplier, which starts at 1.5x-1.6x. +0.2 a level is a
    // real step against that base without the runaway a multiplicative bonus would give when
    // stacked with the Crit Chance tome — the two are meant to be taken together, and a
    // multiplicative pair compounds into the only build worth making.
    fmt: (m) => `+${pct(m)} critical strike damage`,
    apply(mods, lvl) { mods.critMultBonus += tomeMagnitude('critdamage', lvl); },
  },
  duration: {
    name: 'Duration', icon: '⏱', color: '#5c8a3f',
    fmt: (m) => `+${pct(m)} skill duration`,
    apply(mods, lvl) { mods.durationMult *= 1 + tomeMagnitude('duration', lvl); },
  },
};

/**
 * What a tome reads as at a given level — the TOTAL it is worth there, not a per-level rate,
 * because on a curve those are different questions and only the total is answerable.
 * @param {string} id @param {number} [lvl] the level being described; level 1 if unheld
 */
export function tomeDesc(id, lvl = 1) {
  const def = SUPPORTS[id];
  if (!def) return '';
  const L = Math.max(1, lvl);
  // `fmtLvl` takes the LEVEL, for the counting tomes whose text has to agree with a rounded
  // effect; `fmt` takes the magnitude, for the proportional ones where the float is the truth.
  if (def.fmtLvl) return def.fmtLvl(L);
  if (def.fmt) return def.fmt(tomeMagnitude(id, L));
  return '';
}

// `desc` stays a readable PROPERTY so the screens that spread a support wholesale — the unlocks
// list, the sandbox picker — keep working untouched. It is a getter, so the value is computed at
// read time from the live curve: a dev-tools drag is reflected the next time anything renders,
// with nothing to invalidate and no cache to go stale.
for (const [id, def] of Object.entries(SUPPORTS)) {
  Object.defineProperty(def, 'desc', { enumerable: true, get: () => tomeDesc(id, 1) });
}

// Chain and Forking left the tome shelf. Both are now hard-capped in main.js — fork depth at
// MAX_FORK_DEPTH, chain bonus at MAX_CHAIN_BONUS — which made them poor tomes: a tome is a
// thing you sink levels into, and these stopped paying out partway up with no way to say so on
// the card. They drop as Rare-and-above chest affixes instead, where landing one is the whole
// reward and there is no second level to sell.

// Pierce joins Chain and Forking off the shelf, and for the same reason those two left: it
// counts whole enemies, so a curve that arrives smoothly reads as three dead levels followed by
// a step. As a chest affix it lands once, at a number you can see, and there is no second level
// to sell. The definition stays so a save carrying the old tome still applies it.
export const TOME_DISABLED = new Set(['pierce']);

/** The shelf, in offer order — everything not disabled. */
export const SUPPORT_ORDER = Object.keys(SUPPORTS).filter((id) => !TOME_DISABLED.has(id));

/**
 * The level at which a capped tome stops improving, or null if it has no ceiling.
 *
 * DERIVED from the live curve rather than written down, because every dial that feeds it is
 * tunable — `end`, `bend`, `tailAt` and `beyond` all move the level where the cap is met, and a
 * hardcoded number would go stale on the next bake and start hiding levels that still pay out
 * (or offering ones that no longer do).
 *
 * Scans rather than solving: the curve changes form at `tailAt`, so there is no single closed
 * form, and this is called a handful of times per level-up.
 * @param {string} id
 */
export function tomeMaxLevel(id) {
  const def = SUPPORTS[id];
  if (!def || def.cap === undefined) return null;
  for (let l = 1; l <= 400; l++) if (tomeMagnitude(id, l) >= def.cap - 1e-9) return l;
  return null;   // curve never reaches its own cap; treat as uncapped
}
