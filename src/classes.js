export const CLASSES = [
  {
    id: 'warrior',
    name: 'Warrior',
    tag: 'Melee Juggernaut',
    desc: 'Cleaves the horde apart at arm\'s length. His spiked plate wounds what strikes it, '
      + 'turns aside every affliction, and will not be moved.',
    color: '#a13328',
    startSkill: 'slash',
    // The plate is not just a number — three rules, one statement: HE DOES NOT CARE WHAT THE
    // HORDE DOES TO HIM. He is the first character a new player owns and the one whose job is
    // standing in the crowd, which made him the class most punished by touches, afflictions and
    // displacement — the worst one to learn on. These flip all three into his identity:
    //   plateImmune  elite afflictions never land            (see afflictPlayer)
    //   spikedPlate  bodies that hit him take armor-scaled damage back  (see shovePlayerFrom)
    //   immovable    knockback, yanks and rift-pulls do nothing         (same places)
    plateImmune: true,
    spikedPlate: true,
    immovable: true,
    base: { maxHp: 150, speed: 175, armor: 6, hpRegen: 0, critChance: 0.05, critMult: 1.5 },
  },
  {
    id: 'sorceress',
    name: 'Sorceress',
    tag: 'Elemental Caster',
    desc: 'Unarmored, and the heaviest hand there is. Her power gathers while she holds still.',
    color: '#6b4a8a',
    startSkill: 'fireball',
    // Overchannel: damage climbs while she is not moving, resets the moment she walks. Her
    // weakness is fragility and her fantasy is the artillery piece — this makes choosing WHERE
    // to stand, and daring to keep standing there, her entire game.
    overchannel: true,
    base: { maxHp: 95, speed: 165, armor: 0, hpRegen: 0, critChance: 0.08, critMult: 1.6 },
  },
  {
    id: 'ranger',
    name: 'Ranger',
    tag: 'Swift Marksman',
    desc: 'Outranges everything. The further the mark, the harder the arrow lands.',
    color: '#5c7a3d',
    startSkill: 'quickshot',
    // Sharpshooter: projectile damage scales with how far the target is at the moment of impact.
    // She already wants to be far away; this makes range her damage stat, so kiting is
    // genuinely optimal rather than merely safe.
    sharpshooter: true,
    base: { maxHp: 115, speed: 195, armor: 2, hpRegen: 0, critChance: 0.1, critMult: 1.5 },
  },
  {
    id: 'skeleton',
    name: 'The Skeleton',
    tag: 'Risen Bonecaster',
    desc: 'The swiftest and the frailest. He has died before — a killing blow only scatters '
      + 'his bones, and they find each other again.',
    color: '#a89e85',
    startSkill: 'bonethrow',
    // Bone Reassembly: a killing blow scatters him instead — untouchable for the two seconds
    // the bones take to crawl back together, then up at partial health. Once per stage. He is
    // the frailest class in the game and he is ALREADY DEAD; both facts belong in the kit.
    boneReassembly: true,
    base: { maxHp: 120, speed: 178, armor: 3, hpRegen: 0, critChance: 0.06, critMult: 1.5 },
  },
  {
    id: 'plaguedoctor',
    name: 'Plague Doctor',
    tag: 'Harvester of the Sick',
    desc: 'Reaps with a wide scythe. What dies at his feet fouls the air where it fell.',
    color: '#5f7a4a',
    startSkill: 'scythe',
    // Miasma: enemies that die within his reach can leave a brief toxin puff that poisons
    // whatever walks through it. The harvest feeds itself — the closer he reaps, the more the
    // air itself kills — which is the sustain-melee loop his regen already points at.
    miasma: true,
    base: { maxHp: 125, speed: 172, armor: 4, hpRegen: 0.4, critChance: 0.06, critMult: 1.55 },
  },
  // ---------- The three void classes ----------
  // Each extends an archetype the roster lacks, and each passive is built ON the void's own
  // machinery (collapses, entropy marks, the affliction system) rather than on new numbers.
  // Art is generated placeholder (tools/make_void_classes.py) until real portraits land.
  {
    id: 'hollowed',
    name: 'The Hollowed',
    tag: 'Vessel of the Maw',
    desc: 'A hole where a heart should be. Wounds never close on their own — only what the '
      + 'void consumes feeds him.',
    color: '#6b3fc0',
    startSkill: 'eventhorizon',
    // voidFeeds: kills by collapse restore life; noRegen: nothing else ever does. Sustain
    // exists ONLY through the mechanic, so the build is played around feeding the hole.
    voidFeeds: true,
    noRegen: true,
    base: { maxHp: 130, speed: 180, armor: 3, hpRegen: 0, critChance: 0.06, critMult: 1.5 },
  },
  {
    id: 'marked',
    name: 'The Marked',
    tag: 'Bearer of the Third Seal',
    desc: 'Her seal ripens in two marks instead of three — but her collapses only pull, never '
      + 'wound. She does not kill things; she unmakes where they stand.',
    color: '#a05fe0',
    startSkill: 'entropy',
    // sealBearer: Entropy detonates at 2 stacks; collapsePacifist: her collapses deal no
    // implosion damage. Pure control — the support-caster archetype the roster lacks.
    sealBearer: true,
    collapsePacifist: true,
    base: { maxHp: 105, speed: 185, armor: 1, hpRegen: 0, critChance: 0.08, critMult: 1.6 },
  },
  {
    id: 'shinobi',
    name: 'Shinobi',
    tag: 'Silent Blade',
    desc: 'Quick and barely armored, ringed by orbiting stars. Whatever has never touched him '
      + 'is struck true, every time.',
    color: '#4a5a72',
    startSkill: 'ninjastars',
    // First Strike: any enemy that has never landed a hit on him takes automatic crits; one
    // touch breaks the mark for good. The untouchable-dancer fantasy his statline points at,
    // turned into a rule with real skill expression behind it.
    firstStrike: true,
    base: { maxHp: 100, speed: 210, armor: 1, hpRegen: 0, critChance: 0.12, critMult: 1.7 },
  },
];

// Base movement for every class, applied here rather than edited into the six `base` blocks
// above so the numbers stay readable as the authored values and the tuning stays one line to
// find and change.
//
// Snapped to the nearest 5 afterwards. The multiplier lands on values like 191.19 and 229.43,
// and these are DISPLAYED on the class-select cards — a stat panel reading "191.19 speed" looks
// like a bug rather than a tuning decision. Rounding here rather than at the point of display
// means the number shown is the number the game actually runs on; formatting it only on screen
// would have made the card a polite lie.
const CLASS_SPEED_MULT = 1.15 * 0.95 * 1.10; // +15%, then -5%, then +10%
const SPEED_SNAP = 5;
for (const c of CLASSES) {
  c.base.speed = Math.round((c.base.speed * CLASS_SPEED_MULT) / SPEED_SNAP) * SPEED_SNAP;
}

// How the dev tools present each player stat.
export const CLASS_TUNE_META = {
  maxHp:      { label: 'Max Life',      min: 20,  max: 1000, step: 5 },
  speed:      { label: 'Move Speed',    min: 60,  max: 500,  step: 5 },
  armor:      { label: 'Armor',         min: 0,   max: 100,  step: 1 },
  hpRegen:    { label: 'Life Regen',    min: 0,   max: 20,   step: 0.1, unit: '/s' },
  critChance: { label: 'Crit Chance',   min: 0,   max: 1,    step: 0.01 },
  critMult:   { label: 'Crit Damage',   min: 1,   max: 6,    step: 0.05, unit: '×' },
};
export const CLASS_TUNE_KEYS = ['maxHp', 'speed', 'armor', 'hpRegen', 'critChance', 'critMult'];

// Across-the-board player multipliers, the counterpart to the enemy globals. Applied when a
// run STARTS, on top of whatever the class's own numbers say — so the six classes keep their
// relationships to each other and this moves the player as a whole against the roster.
//
// Damage is the odd one of the three: the player has no single damage stat, it comes out of
// whichever skills are equipped. It rides on the skill damage multiplier instead, which is the
// one number every skill's output already passes through.
export const PLAYER_TUNE_META = {
  hpMult:     { label: 'Player Health', min: 0.1, max: 5, step: 0.05, unit: '×' },
  damageMult: { label: 'Player Damage', min: 0.1, max: 5, step: 0.05, unit: '×' },
  speedMult:  { label: 'Player Speed',  min: 0.1, max: 3, step: 0.05, unit: '×' },
  // How fast the build comes online. Read live at every orb pickup, so it takes effect
  // mid-run — unlike health and speed, which are stamped on at spawn.
  xpMult:     { label: 'XP Rate',       min: 0.1, max: 10, step: 0.1, unit: '×' },
  // The odd one out in this box: an absolute reach in world pixels, not a multiplier, because
  // there is no per-class pickup radius for it to scale — every class starts from the same
  // number and only affixes and tomes move it. Read live at every pickup test like xpMult,
  // so it can be tuned mid-run.
  pickupRadius: { label: 'Pickup Radius', min: 20, max: 400, step: 5, unit: 'px' },
};
export const PLAYER_TUNE_KEYS = ['hpMult', 'damageMult', 'speedMult', 'xpMult', 'pickupRadius'];

/* GENERATED: global player tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole
   block from tuning/entity-tuning.json. */
export const PLAYER_GLOBAL_TUNE = {
  damageMult: 1,
  hpMult: 1.2,
  pickupRadius: 100,
  speedMult: 1.25,
  xpMult: 0.9,
};
/* END GENERATED */

export const PLAYER_GLOBALS = { hpMult: 1, damageMult: 1, speedMult: 1, xpMult: 1, pickupRadius: 75, ...PLAYER_GLOBAL_TUNE };

/* GENERATED: dodge tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole block
   from tuning/entity-tuning.json. */
export const DASH_TUNE = {
  distance: 100,
  time: 0.15,
};
/* END GENERATED */

/**
 * The dodge. Lives here with the player globals rather than in main.js because it is a player
 * capability every class shares, and because being data rather than constants is what lets the
 * dev panel move it.
 *
 * `cooldown` remains IMMUTABLE at runtime — no item, tome or Haste roll reduces it (see the
 * guard in tools/smoke.mjs). Tuning the base value here is a design decision; a modifier
 * shrinking it mid-run is the thing that would cost the dodge its reliable rhythm.
 */
export const DASH = {
  charges: 2,        // uses before the refill clock starts
  cooldown: 1.6,     // seconds to regain one charge
  time: 0.16,        // how long the burst lasts
  distance: 102.9,   // px covered; speed follows from the duration
  ...DASH_TUNE,
};

/** How the dev panel presents the dodge dials. */
export const DASH_TUNE_META = {
  charges:  { label: 'Dodge Charges',  min: 1,  max: 6,   step: 1 },
  cooldown: { label: 'Dodge Cooldown', min: 0.2, max: 6,  step: 0.05, unit: 's' },
  time:     { label: 'Dodge Duration', min: 0.05, max: 0.6, step: 0.01, unit: 's' },
  distance: { label: 'Dodge Distance', min: 20, max: 400, step: 1,   unit: 'px' },
};

/* GENERATED: player tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole block
   from tuning/entity-tuning.json. Applied AFTER the speed multiplier and its snapping above,
   so a tuned speed is used exactly as dialled instead of being scaled and rounded again. */
export const CLASS_TUNE = {
  plaguedoctor: { armor: 2, maxHp: 160, speed: 210 },
  ranger: { maxHp: 140, speed: 250 },
  shinobi: { hpRegen: 0.1, maxHp: 120, speed: 260 },
  skeleton: { armor: 4, critChance: 0.04, maxHp: 90, speed: 280 },
  sorceress: { critChance: 0.06, hpRegen: 0.5, maxHp: 115, speed: 215 },
  warrior: { armor: 8, critChance: 0.04, maxHp: 220, speed: 200 },
};
for (const c of CLASSES) {
  if (CLASS_TUNE[c.id]) Object.assign(c.base, CLASS_TUNE[c.id]);
}
/* END GENERATED */
