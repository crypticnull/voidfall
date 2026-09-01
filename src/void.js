// @ts-check
// ---------- Void Afflicted ----------
// The void is a thing the PLAYER does to the horde: collapses that haul bodies inward, marks
// that arm a death, relics that rewrite what a collapse means. Void Afflicted enemies were the
// same idea pointed the other way — and for a long while they were only a stat block wearing
// good art: tougher, angrier, and mechanically identical to everything else on the field.
//
// They now carry ONE power each, rolled at spawn. One, not several, and named on the body, so
// an afflicted enemy is a thing the player learns to read rather than a bundle of surprises:
// see that shape, know what it does. Four powers is enough for the roll to stay interesting
// across a run and few enough that all four are recognisable by the second stage.

/* GENERATED: void tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole block
   from tuning/entity-tuning.json under the `void` domain. */
export const VOID_TUNE_OVERRIDE = {
  chance: 5,
  chanceEndless: 15,
};
/* END GENERATED */

export const VOID_TUNE = {
  // ---- how often the void takes a body ----
  // `chance` is the CEILING the ramp climbs to, not a flat rate. The void is absent until its
  // introduction event fires (see voidIntroduction in main.js), then the per-spawn chance ramps
  // from chanceStart up to `chance` across `chanceRamp` difficulty positions. Absent-then-
  // arriving is the point: an enemy class that is simply always there is scenery, one that
  // ARRIVES mid-run is an event the run bends around.
  chance: 7,          // percent of campaign spawns, once the ramp completes
  chanceEndless: 18,  // ...and once endless begins, which is the void's own game
  chanceStart: 1.5,   // percent at the moment of introduction
  chanceRamp: 1.5,    // difficulty positions (stages) from introduction to full chance
  // The introduction fires at a position rolled per run inside this window. 0.35 is mid stage 1
  // and 2.4 is deep stage 3, so ANY stage can be where the void first shows itself — and the
  // window ends before endless begins, so a full campaign always meets it.
  introEarliest: 0.35,
  introLatest: 2.4,
  // The introduction is a SEQUENCE, not a stinger: omenSeconds of dread first (purple flickers
  // at the edge of vision, small shudders), then the card and a physical tear in the arena that
  // spends tearSeconds birthing afflicted before it seals. The omen is what makes the card land
  // — an announcement with no build-up reads as UI, one the player half-noticed coming reads as
  // the world doing something.
  omenSeconds: 18,
  tearSeconds: 10,
  tearSpawnEvery: 1.4,
  // ---- what affliction does to the statline ----
  // Deliberately still meaningful on top of the powers below: a power is what makes one
  // interesting, but it has to survive long enough to use it.
  hpMult: 2.6,
  damageMult: 1.5,
  speedMult: 1.12,
  xpMult: 2.5,
  // ---- Riftborn: tears a hole where it falls ----
  riftDamage: 0.9,    // multiple of the enemy's own contact damage, paid on implosion
  riftRadius: 150,
  riftDuration: 1.6,
  // The rift's grip on the PLAYER, as a percentage of the player's own speed at the core.
  // Below 100 by design: walking out is always possible, the rift just taxes the walk. The old
  // pull was a flat 150-280 px/s — faster than most classes at the centre — so being caught was
  // decided the moment it opened, and the only counterplay was never being there. A drag you
  // can fight reads as gravity; a drag you cannot read as a cutscene.
  riftPullPct: 70,
  // ---- Carrier: spreads the affliction ----
  contagionEvery: 6,   // seconds between attempts
  contagionRange: 170,
  // Hard ceiling on afflicted bodies alive at once. Contagion compounds — every convert is a
  // new carrier — so without a cap a quiet thirty seconds turns the whole field purple. The cap
  // is what keeps it a threat you can fall behind on rather than one you cannot come back from.
  contagionCap: 14,
  // ---- Devourer: eats the horde to grow ----
  devourEvery: 4,
  devourRange: 150,
  devourGain: 0.35,    // fraction of its own base health gained per body eaten
  devourMaxStacks: 6,  // and a ceiling, so a fed devourer is a boss-sized problem, not endless
  // ---- Chainbound: a live wire between two of them ----
  tetherRange: 420,    // how far apart two can be and still hold the line
  tetherDamage: 0.6,   // multiple of contact damage, per touch
  tetherCd: 1.2,       // seconds before the same line can burn you again
  ...VOID_TUNE_OVERRIDE,
};

export const VOID_TUNE_META = {
  chance:        { label: 'Afflicted / spawn (full)', min: 0, max: 100, step: 0.5, unit: '%' },
  chanceEndless: { label: 'Afflicted / spawn (Endless)', min: 0, max: 100, step: 0.5, unit: '%' },
  chanceStart:   { label: 'Chance at Introduction', min: 0, max: 50, step: 0.5, unit: '%' },
  chanceRamp:    { label: 'Ramp Length',           min: 0.1, max: 6, step: 0.1, unit: ' stages' },
  introEarliest: { label: 'Intro Earliest',        min: 0, max: 3, step: 0.05, unit: ' pos' },
  introLatest:   { label: 'Intro Latest',          min: 0, max: 3, step: 0.05, unit: ' pos' },
  omenSeconds:   { label: 'Omen Build-up',         min: 0, max: 60, step: 1, unit: 's' },
  tearSeconds:   { label: 'Tear Stays Open',       min: 2, max: 40, step: 1, unit: 's' },
  tearSpawnEvery: { label: 'Tear Births Every',    min: 0.3, max: 6, step: 0.1, unit: 's' },
  hpMult:        { label: 'Health vs Normal',  min: 1, max: 10, step: 0.1, unit: '×' },
  damageMult:    { label: 'Damage vs Normal',  min: 1, max: 6,  step: 0.1, unit: '×' },
  speedMult:     { label: 'Speed vs Normal',   min: 0.5, max: 3, step: 0.02, unit: '×' },
  xpMult:        { label: 'XP vs Normal',      min: 1, max: 10, step: 0.5, unit: '×' },
  riftDamage:    { label: 'Rift Damage',       min: 0, max: 4,  step: 0.1, unit: '×' },
  riftPullPct:   { label: 'Rift Pull vs Player Speed', min: 0, max: 200, step: 5, unit: '%' },
  riftRadius:    { label: 'Rift Radius',       min: 40, max: 500, step: 10 },
  riftDuration:  { label: 'Rift Duration',     min: 0.4, max: 6, step: 0.1, unit: 's' },
  contagionEvery: { label: 'Spread Every',     min: 1, max: 30, step: 0.5, unit: 's' },
  contagionRange: { label: 'Spread Range',     min: 40, max: 600, step: 10 },
  contagionCap:  { label: 'Max Afflicted Alive', min: 1, max: 60, step: 1 },
  devourEvery:   { label: 'Devour Every',      min: 0.5, max: 20, step: 0.5, unit: 's' },
  devourRange:   { label: 'Devour Range',      min: 40, max: 500, step: 10 },
  devourGain:    { label: 'Devour Health Gain', min: 0, max: 2, step: 0.05, unit: '×' },
  devourMaxStacks: { label: 'Devour Max Stacks', min: 1, max: 20, step: 1 },
  tetherRange:   { label: 'Tether Range',      min: 60, max: 900, step: 20 },
  tetherDamage:  { label: 'Tether Damage',     min: 0, max: 4, step: 0.1, unit: '×' },
  tetherCd:      { label: 'Tether Cooldown',   min: 0.2, max: 6, step: 0.1, unit: 's' },
};

/**
 * The four powers. `color` tints that body's flames, so the power is readable from the
 * silhouette alone before it has done anything — the same contract the elite name bar makes.
 *
 * @type {{ id: string, name: string, color: string, desc: string }[]}
 */
export const VOID_POWERS = [
  { id: 'rift', name: 'Riftborn', color: '#7a56d2',
    desc: 'tears a hole where it falls' },
  { id: 'contagion', name: 'Carrier', color: '#b04fd0',
    desc: 'spreads the affliction' },
  { id: 'devour', name: 'Devourer', color: '#4f3fa8',
    desc: 'eats the horde to grow' },
  { id: 'tether', name: 'Chainbound', color: '#9a6ae8',
    desc: 'strings a live wire to its kin' },
];

export const VOID_POWER = Object.fromEntries(VOID_POWERS.map((p) => [p.id, p]));

/** One power, rolled at spawn. @param {() => number} [rng] */
export function rollVoidPower(rng = Math.random) {
  return VOID_POWERS[Math.floor(rng() * VOID_POWERS.length)].id;
}
