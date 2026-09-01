// @ts-check
// ---------- Elites ----------
// The missing rung. A mob dies to one volley and a boss is a two-minute set piece; there was
// nothing in between, so a run was either trivial or a scheduled event. An elite takes real
// attention for maybe ten seconds and then pays out.
//
// Three things make one read as an elite rather than a fat mob: a NAME, a HEALTH BAR, and an
// ABILITY that does something to you. The first two are the promise, the third is the reason.
//
// Every elite carries exactly one ability, drawn from the four elements the player already
// knows plus three that only elites have. Reusing the player's own elements is deliberate —
// being frozen by a Rimewarden teaches what your own Frost infusion does to the horde.

import { rand } from './utils.js';

/* GENERATED: elite tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole block
   from tuning/entity-tuning.json under the `elites` domain. */
export const ELITE_TUNE_OVERRIDE = {
  abilityCd: 9,
  abilityRange: 200,
  spawnEvery: 100,
  statusSeconds: 1,
};
/* END GENERATED */

export const ELITE_TUNE = {
  // Health as a multiple of a normal enemy of the same stage. A boss is ~40x, so this sits
  // deliberately closer to the mob than to the boss: "a good deal more than regular mobs",
  // not "a small boss".
  hpMult: 9,
  damageMult: 1.6,
  speedMult: 0.88,       // slightly ponderous, so it can be kited
  radiusMult: 1.55,
  xpMult: 8,
  abilityCd: 4.5,        // seconds between casts
  abilityRange: 340,     // it will not cast from across the arena
  // How long the inflicted status rides the player. Cut 20% (from 4s) because the elite
  // debuffs have no counterplay: there is no cleanse, no resist stat and no dodge window — the
  // cast lands the moment you are inside abilityRange and the only lever you have is having
  // already been somewhere else. A status you cannot answer has to be SHORT, or it is not a
  // threat to play around, it is just a stretch of the run where you are worse and might die.
  //
  // Duration is the honest dial for that. The alternative — softening what each status does —
  // would blunt the identities (Blight stopping healing is the whole of Blight) while leaving
  // the helplessness exactly as long. Shortening the window keeps every effect as sharp as it
  // was and gives the player their character back sooner.
  statusSeconds: 3.2,
  // Cadence, and the ceiling that matters more than the cadence does.
  //
  // At 42s an elite that survived was still on the field when the next two arrived, and a
  // stage-1 run could face three at once plus the miniboss — several thousand health standing
  // between a starting character and any progress at all. The cap is the real fix: an elite is
  // meant to be a fight you stop for, and you can only stop for one at a time. The interval is
  // lengthened as well so the cap is rarely the thing enforcing it.
  spawnEvery: 68,        // seconds between elite spawns
  spawnEveryEndless: 40, // ...once endless starts, where the pace should tighten
  maxAlive: 2,           // never more than this many on the field at once
  ...ELITE_TUNE_OVERRIDE,
};

export const ELITE_TUNE_META = {
  hpMult:        { label: 'Health vs Mob',   min: 2, max: 40, step: 0.5, unit: '×' },
  damageMult:    { label: 'Damage vs Mob',   min: 1, max: 6,  step: 0.1, unit: '×' },
  speedMult:     { label: 'Speed vs Mob',    min: 0.4, max: 2, step: 0.02, unit: '×' },
  radiusMult:    { label: 'Size vs Mob',     min: 1, max: 3,  step: 0.05, unit: '×' },
  xpMult:        { label: 'XP vs Mob',       min: 1, max: 40, step: 1,   unit: '×' },
  abilityCd:     { label: 'Ability Cooldown', min: 1, max: 20, step: 0.5, unit: 's' },
  abilityRange:  { label: 'Ability Range',   min: 80, max: 900, step: 20 },
  statusSeconds: { label: 'Status Duration', min: 1, max: 15, step: 0.5, unit: 's' },
  spawnEvery:    { label: 'Spawn Every',     min: 5, max: 180, step: 1,  unit: 's' },
  spawnEveryEndless: { label: 'Spawn Every (Endless)', min: 5, max: 180, step: 1, unit: 's' },
  maxAlive:      { label: 'Max Alive at Once', min: 1, max: 10, step: 1 },
};

/**
 * The seven abilities. `id` is what lands on the player.
 *
 * The first four mirror the player's own elements. The last three exist ONLY here, and are
 * built to attack things the player's own kit cannot: armour, healing, and mobility. That is
 * what stops an elite from being a damage check — you can out-damage a big health pool, but
 * Sunder and Blight change how the next ten seconds have to be played.
 *
 * @type {{ id: string, name: string, title: string, color: string, desc: string,
 *          durMult?: number }[]}
 */
export const ELITE_ABILITIES = [
  // `durMult` scales statusSeconds for THIS ability alone. The three that deal ongoing harm —
  // burn and poison tick damage, the tether hauls you around — at full length stacked up into
  // "too tough" in playtesting, while the one-shot debuffs (frost, shock, sunder, blight) read
  // as fair. First pass cut them 40%, which over-corrected — the statuses became unnoticeable —
  // so they now run 20% shorter: long enough to be an event, short enough not to be a sentence.
  { id: 'burning', name: 'Emberbound', title: 'the Emberbound', color: '#e0662f',
    desc: 'sears you', durMult: 0.8 },
  { id: 'poison', name: 'Rotcaller', title: 'the Rotcaller', color: '#9a4fb0',
    desc: 'poisons you', durMult: 0.8 },
  { id: 'frost', name: 'Rimewarden', title: 'the Rimewarden', color: '#8fd0e8',
    desc: 'freezes your step' },
  { id: 'shock', name: 'Stormtouched', title: 'the Stormtouched', color: '#5ac8f0',
    desc: 'jolts your aim' },
  // ---- elite-only ----
  { id: 'sunder', name: 'Bonebreaker', title: 'the Bonebreaker', color: '#c9382e',
    desc: 'shatters your guard — you take more damage' },
  { id: 'blight', name: 'Grave Herald', title: 'the Grave Herald', color: '#3fa66a',
    desc: 'blights your wounds — no healing or leech' },
  { id: 'tether', name: 'Chainbinder', title: 'the Chainbinder', color: '#c9a227',
    desc: 'binds you — dragged and slowed', durMult: 0.8 },
];

/** Elite-only statuses, kept separate so the four shared ones are not duplicated here. */
export const ELITE_ONLY = new Set(['sunder', 'blight', 'tether']);

/**
 * The three named minibosses — one per stage, keyed by stage id.
 *
 * A rung above the elites: an elite is a promoted mob with a status effect, where a miniboss is
 * a CHARACTER, with a name that stays the same every run, a weapon you can see, and a skill
 * that asks something of you the horde does not. Health is pegged at a third of the stage boss
 * (see spawnMiniboss), so the fight is a rehearsal for the boss rather than a speed bump.
 *
 * `spriteId` borrows the stage's own heavyweight — the miniboss should look native to the land
 * it guards, and the name bar and weapon are what mark it out as somebody.
 */
export const MINIBOSSES = {
  graveyard: {
    id: 'mourngrim', name: 'Mourngrim, the Gravedigger', color: '#9fb06a',
    weapon: 'shovel', skill: 'unearth', spriteId: 'ogre',
    desc: 'digs the dead up from under your feet',
  },
  desert: {
    id: 'sekhra', name: 'Sekhra, the Sandbinder', color: '#d8a04a',
    weapon: 'khopesh', skill: 'cyclone', spriteId: 'sandGolem',
    desc: 'becomes the storm — stay out of the sand',
  },
  underworld: {
    id: 'karguth', name: 'Karguth, the Chainwright', color: '#c9584a',
    weapon: 'hook', skill: 'hellhook', spriteId: 'minotaur',
    desc: 'hurls a hook that drags you to him',
  },
};

/** Ability lookup by id. */
export const ELITE_ABILITY = Object.fromEntries(ELITE_ABILITIES.map((a) => [a.id, a]));

/** Sunder's damage-taken multiplier while it rides. */
export const SUNDER_MULT = 1.35;
/** How hard a tether hauls, in px/sec, and how much it slows. */
export const TETHER_PULL = 130;
export const TETHER_SLOW = 0.6;

/**
 * Build an elite from a normal enemy type.
 *
 * Takes the roster entry rather than inventing a creature, so an elite is always something the
 * stage actually contains — a bigger, named version of a monster you already recognise. That
 * reads far better than an unrelated model appearing from nowhere, and it means every stage
 * gains elites for free as its roster grows.
 *
 * @param {*} type the base enemy definition
 * @param {number} baseHp the health that enemy would have had at this point in the run
 * @param {number} baseDamage likewise for damage
 * @param {() => number} [rng]
 */
export function makeElite(type, baseHp, baseDamage, rng = Math.random) {
  const ability = ELITE_ABILITIES[Math.floor(rng() * ELITE_ABILITIES.length)];
  const hp = baseHp * ELITE_TUNE.hpMult;
  return {
    eliteName: `${type.name} ${ability.title}`,
    isElite: true,
    ability: ability.id,
    abilityColor: ability.color,
    abilityTimer: rand(1, ELITE_TUNE.abilityCd),   // not all at once on spawn
    hp, maxHp: hp,
    damage: Math.round(baseDamage * ELITE_TUNE.damageMult),
    radius: type.radius * ELITE_TUNE.radiusMult,
    speed: type.speed * ELITE_TUNE.speedMult,
    xp: Math.round((type.xp || 1) * ELITE_TUNE.xpMult),
  };
}
