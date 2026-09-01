// @ts-check
// ---------- Relics ----------
// Found, never chosen. A relic arrives out of a chest, cannot be levelled, and the ONLY way to
// improve one is to find it again — at which point the rule changes rather than the number.
//
// That last part is the whole design. A relic that went +10% / +20% / +30% would be a tome with
// extra steps; a relic whose second copy makes collapses chain is a different build. It also
// means a duplicate is exciting rather than a consolation, which matters because duplicates are
// deliberately weighted to happen (see relicRollWeight).
//
// Relics are capped at RELIC_CAP with no swapping. Uncapped, the endgame collapses into "collect
// them all" and the difficulty clamp stops meaning anything; at four, every find after the
// fourth is a decision you are locked out of, which is what makes the first four matter.

/** How many a player may hold. */
export const RELIC_CAP = 4;

/* GENERATED: relic tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole block
   from tuning/entity-tuning.json under the `relics` domain. */
export const RELIC_TUNE_OVERRIDE = {
};
/* END GENERATED */

/**
 * Every number the relics run on, in one place so the dev panel can drive them.
 *
 * Deliberately flat rather than nested per relic: the panel builds one box per relic from
 * RELIC_TUNE_META below, and a flat store is what bakes cleanly through the existing entity
 * pipeline without teaching it a new shape.
 */
export const RELIC_TUNE = {
  dupWeight: 2.5,
  dropChance: 0.2,        // full rate, reached around wave 10
  rampWave: 10,           // how long the ramp to that rate takes
  hollowEvery: 12,        // kills per free collapse
  hollowEvery2: 8,        // ...once a second copy is found
  tideForce: 1.5,         // outward push multiplier
  tideStagger: 1.2,       // seconds an attack is interrupted for
  ledgerDuration: 2,      // status duration multiplier
  ledgerTick: 1.5,        // status tick-rate multiplier at tier 2
  ledgerTriple: 0.5,      // bonus damage at three statuses
  silenceGrace: 1.5,      // seconds of invulnerability
  bloomXp: 3,             // xp multiplier on collapse kills
  darkDamage: 2,          // damage multiplier beyond the torchlight
  darkPull: 2,            // collapse pull multiplier at tier 3
  ...RELIC_TUNE_OVERRIDE,
};

/** How the dev panel presents each relic's dials. Keyed by relic id. */
export const RELIC_TUNE_META = {
  hollowstar: {
    hollowEvery:  { label: 'Kills per Collapse',   min: 2, max: 40, step: 1 },
    hollowEvery2: { label: 'Kills per Collapse x2', min: 2, max: 40, step: 1 },
  },
  tidebreaker: {
    tideForce:   { label: 'Outward Force', min: 0.5, max: 4, step: 0.1, unit: '×' },
    tideStagger: { label: 'Stagger',       min: 0.1, max: 5, step: 0.1, unit: 's' },
  },
  ashenledger: {
    ledgerDuration: { label: 'Status Duration', min: 1, max: 6, step: 0.1, unit: '×' },
    ledgerTick:     { label: 'Tick Rate',       min: 1, max: 4, step: 0.1, unit: '×' },
    ledgerTriple:   { label: 'Triple-Status Bonus', min: 0, max: 3, step: 0.05, unit: '×' },
  },
  secondsilence: {
    silenceGrace: { label: 'Grace Period', min: 0.2, max: 6, step: 0.1, unit: 's' },
  },
  gravebloom: {
    bloomXp: { label: 'XP from Collapses', min: 1, max: 10, step: 0.5, unit: '×' },
  },
  thelongdark: {
    darkDamage: { label: 'Unseen Damage', min: 1, max: 6, step: 0.1, unit: '×' },
    darkPull:   { label: 'Collapse Pull', min: 1, max: 5, step: 0.1, unit: '×' },
  },
};

/** The shared dials, shown in their own box above the per-relic ones. */
export const RELIC_GLOBAL_TUNE_META = {
  dropChance: { label: 'Relic / chest',    min: 0, max: 1,  step: 0.01, unit: '%' },
  rampWave:   { label: 'Full Rate by Wave', min: 1, max: 30, step: 1 },
  dupWeight:  { label: 'Duplicate Weight', min: 1, max: 10, step: 0.1, unit: '×' },
};

/**
 * @typedef {{ id: string, name: string, icon: string, color: string,
 *             minWave: number, tiers: string[] }} Relic
 */

/**
 * `minWave` is the first endless wave the relic can appear on, NOT a hard gate on rarity — see
 * relicDropChance, which ramps the odds from "vanishingly rare" at wave 1 to the full rate
 * around wave 10. A relic you can theoretically see at wave 1 is a story; one you cannot see
 * until wave 10 is a chore with a countdown.
 *
 * @type {Record<string, Relic>}
 */
export const RELICS = {
  hollowstar: {
    id: 'hollowstar', name: 'Hollow Star', icon: '◈', color: '#7a56d2', minWave: 1,
    tiers: [
      'Every 12th kill collapses into the void',
      'Every 8th kill collapses, and the collapse marks survivors',
      'Collapses chain: a foe killed by one can trigger another',
    ],
  },
  tidebreaker: {
    id: 'tidebreaker', name: 'Tidebreaker', icon: '≈', color: '#3f8fbc', minWave: 2,
    tiers: [
      'Your collapses push OUT instead of in, at 1.5x force',
      'The shockwave staggers, interrupting enemy attacks',
      'Flung enemies take the implosion damage a second time',
    ],
  },
  ashenledger: {
    id: 'ashenledger', name: 'Ashen Ledger', icon: '☰', color: '#c98500', minWave: 1,
    tiers: [
      'Your status effects last twice as long',
      'Burn and poison tick 50% faster',
      'A foe carrying three statuses takes +50% damage',
    ],
  },
  secondsilence: {
    id: 'secondsilence', name: 'Second Silence', icon: '⏾', color: '#c9c2e8', minWave: 4,
    tiers: [
      'Once per wave, a fatal hit leaves you at 1 life instead',
      'Twice per wave',
      'The reprieve detonates a collapse centred on you',
    ],
  },
  gravebloom: {
    id: 'gravebloom', name: 'Gravebloom', icon: '✿', color: '#3fa66a', minWave: 1,
    tiers: [
      'Foes killed by a collapse drop 3x XP',
      'They drop gold as well',
      'Chests found in endless roll one tier higher',
    ],
  },
  thelongdark: {
    id: 'thelongdark', name: 'The Long Dark', icon: '☾', color: '#4a2f8f', minWave: 12,
    tiers: [
      'Foes beyond your torchlight take 2x damage, but are unseen',
      'Killing an unseen foe briefly reveals the next',
      'Your collapses pull twice as hard',
    ],
  },
};

export const RELIC_ORDER = Object.keys(RELICS);

/** Copies held, 0 if none. @param {any} player @param {string} id */
export const relicCount = (player, id) => (player && player.relics && player.relics[id]) || 0;
/** 1..3 once held, 0 if not. Capped: a fourth copy is dead weight and must not roll. */
export const relicTier = (player, id) => Math.min(3, relicCount(player, id));
/** @param {any} player @param {string} id */
export const hasRelic = (player, id) => relicCount(player, id) > 0;
/** @param {any} player */
export const relicsHeld = (player) => RELIC_ORDER.filter((id) => relicCount(player, id) > 0);

/**
 * How likely a chest is to hold a relic at all, by endless wave.
 *
 * Ramped rather than gated. Relics are the most interesting thing in the drop table, so locking
 * them behind wave 10 makes the first ten waves strictly less interesting than the eleventh —
 * the opposite of what a run should feel like. Instead they are possible from wave 1 at roughly
 * a fiftieth of the full rate, and climb to it by wave 10. An early relic is a run you remember.
 *
 * Campaign stages (wave 0) never drop them: the relic layer is the endless game's own reward,
 * and handing one out in stage 1 would spend the surprise before the run has a shape.
 * @param {number} wave
 */
export function relicDropChance(wave) {
  if (!(wave > 0)) return 0;
  const t = Math.min(1, wave / Math.max(1, RELIC_TUNE.rampWave));
  // Quartic ramp: ~0.4% at wave 1, ~2% by wave 5, the full rate from `rampWave` on.
  return RELIC_TUNE.dropChance * (0.02 + 0.98 * Math.pow(t, 4));
}

/**
 * Roll weight for one relic, given what the player already holds.
 *
 * DUPLICATES ARE FAVOURED, heavily and on purpose. On a flat pool, seeing the same relic three
 * times is so unlikely that the tier-2 and tier-3 rules would be decoration — written, tested,
 * and never witnessed. Weighting a held relic up means the upgrade path is something a run
 * actually travels, and it turns "another Hollow Star" into the good outcome.
 *
 * A relic already at tier 3 drops out entirely, and once the shelf is full only held relics can
 * roll, so a capped player is always rolling toward an upgrade rather than a dead card.
 * @param {any} player @param {string} id @param {number} wave
 */
export function relicRollWeight(player, id, wave) {
  const def = RELICS[id];
  if (!def || wave < def.minWave) return 0;
  const held = relicCount(player, id);
  if (held >= 3) return 0;                       // maxed: nothing left to give
  // 2.5x, not more. At 6x a simulated run ended with all four relics maxed every single time —
  // tier 1 and tier 2 were states nobody would ever be IN, so two thirds of the design was
  // decoration. At 2.5x a typical run finishes with a mixed shelf and usually one maxed relic,
  // which is the spread that makes the next duplicate worth wanting.
  if (held > 0) return RELIC_TUNE.dupWeight;
  if (relicsHeld(player).length >= RELIC_CAP) return 0;   // shelf full: no new relics
  return 1;
}

/**
 * Pick a relic, or null if nothing is eligible.
 * @param {any} player @param {number} wave @param {() => number} [rng]
 */
export function rollRelic(player, wave, rng = Math.random) {
  const pool = RELIC_ORDER.map((id) => [id, relicRollWeight(player, id, wave)])
    .filter(([, w]) => /** @type {number} */(w) > 0);
  const total = pool.reduce((s, [, w]) => s + /** @type {number} */(w), 0);
  if (!total) return null;
  let r = rng() * total;
  for (const [id, w] of pool) if ((r -= /** @type {number} */(w)) < 0) return /** @type {string} */(id);
  return /** @type {string} */(pool[pool.length - 1][0]);
}

/** The line shown for the copy the player is on. @param {any} player @param {string} id */
export function relicDesc(player, id) {
  const t = relicTier(player, id);
  return RELICS[id].tiers[Math.max(0, t - 1)];
}
