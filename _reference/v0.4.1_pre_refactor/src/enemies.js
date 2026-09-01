// Global difficulty tuning: flat multipliers applied to every enemy's base health and
// damage (and to bosses). Bump these to make the whole roster tougher at once.
const ENEMY_HP_MULT = 1.44; // +20% base, then another +20%
const ENEMY_DMG_MULT = 1.2;

// Enemy type definitions. `tier` gates when they start appearing (seconds into the round).
export const ENEMY_TYPES = {
  zombie: {
    // radius 15 -> 18.75 (+25%). The drawn sprite is derived from radius, so raising it here
    // scales the art and the hitbox together and keeps their ratio identical.
    name: 'Shambler', tier: 0, radius: 18.75, speed: 65, hp: 26, damage: 9, xp: 4,
    color: '#4a5c34', contactCd: 0.7,
  },
  bat: {
    name: 'Swarm Bat', tier: 0, radius: 9, speed: 145, hp: 12, damage: 5, xp: 2,
    color: '#4a3a52', contactCd: 0.5,
  },
  skeletonArcher: {
    name: 'Bone Archer', tier: 60, radius: 13, speed: 55, hp: 22, damage: 8, xp: 6,
    color: '#a89e83', ranged: true, range: 320, shootCd: 1.6, projSpeed: 220, contactCd: 0.9,
  },
  slime: {
    name: 'Acid Slime', tier: 90, radius: 17, speed: 50, hp: 34, damage: 7, xp: 5,
    color: '#5c7248', splits: true, contactCd: 0.7,
  },
  ogre: {
    name: 'Rockhide Ogre', tier: 150, radius: 26, speed: 42, hp: 130, damage: 20, xp: 14,
    color: '#5c4630', contactCd: 1.0,
  },
  wraith: {
    name: 'Hollow Wraith', tier: 210, radius: 12, speed: 120, hp: 45, damage: 12, xp: 8,
    color: '#312d40', contactCd: 0.6,
  },
};

export const ENEMY_ORDER = ['zombie', 'bat', 'skeletonArcher', 'slime', 'ogre', 'wraith'];

// ---------- Stage 2 (The Sundered Sands) roster ----------
Object.assign(ENEMY_TYPES, {
  jackal: {
    name: 'Dune Jackal', tier: 0, radius: 11, speed: 150, hp: 16, damage: 6, xp: 3,
    color: '#8a6a3a', contactCd: 0.5,
  },
  scarab: {
    name: 'Carrion Scarab', tier: 30, radius: 9, speed: 75, hp: 20, damage: 5, xp: 3,
    color: '#2a5c48', splits: true, contactCd: 0.6,
  },
  vulture: {
    name: 'Ash Vulture', tier: 60, radius: 12, speed: 130, hp: 30, damage: 9, xp: 6,
    color: '#241f18', contactCd: 0.55,
  },
  mummy: {
    name: 'Wrapped Cursebearer', tier: 90, radius: 13, speed: 46, hp: 40, damage: 9, xp: 7,
    color: '#c9bfa8', ranged: true, range: 300, shootCd: 1.8, projSpeed: 190, contactCd: 0.9,
    projStyle: 'orb', projColor: '#7ac95a', projRadius: 6,
  },
  sandGolem: {
    name: 'Sand-Wrought Construct', tier: 150, radius: 27, speed: 40, hp: 165, damage: 21, xp: 15,
    color: '#b8935a', contactCd: 1.0,
  },
  stoneGolem: {
    name: 'Tomb Warden', tier: 210, radius: 30, speed: 36, hp: 220, damage: 25, xp: 19,
    color: '#6e6a5e', contactCd: 1.0,
  },
});
export const DESERT_ENEMY_ORDER = ['jackal', 'scarab', 'vulture', 'mummy', 'sandGolem', 'stoneGolem'];

// ---------- Stage 3 (The Underworld) roster ----------
Object.assign(ENEMY_TYPES, {
  hollowZombie: {
    name: 'Hollow Shambler', tier: 0, radius: 15, speed: 70, hp: 28, damage: 10, xp: 4,
    color: '#3a2a4a', contactCd: 0.7,
  },
  wailingGhost: {
    name: 'Wailing Ghost', tier: 30, radius: 11, speed: 145, hp: 20, damage: 7, xp: 4,
    color: '#8ce9c0', contactCd: 0.5,
  },
  pitDemon: {
    name: 'Pit Demon', tier: 60, radius: 16, speed: 95, hp: 52, damage: 14, xp: 7,
    color: '#7a1f3a', contactCd: 0.6,
  },
  veinedEye: {
    name: 'Veined Eye', tier: 90, radius: 13, speed: 35, hp: 44, damage: 9, xp: 7,
    color: '#8a2848', ranged: true, range: 280, shootCd: 1.6, projSpeed: 200, contactCd: 0.9,
    projStyle: 'orb', projColor: '#c9456c', projRadius: 6,
  },
  giantWorm: {
    name: 'Charnel Worm', tier: 150, radius: 26, speed: 50, hp: 160, damage: 20, xp: 16,
    color: '#4a2a5e', contactCd: 1.0,
  },
  minotaur: {
    name: 'Bound Minotaur', tier: 210, radius: 28, speed: 68, hp: 215, damage: 29, xp: 20,
    color: '#5c3a28', contactCd: 0.9,
  },
});
export const UNDERWORLD_ENEMY_ORDER = ['hollowZombie', 'wailingGhost', 'pitDemon', 'veinedEye', 'flameSkull', 'giantWorm', 'minotaur'];

// ---------- Shared: the flaming skull haunts both the graveyard and the underworld ----------
Object.assign(ENEMY_TYPES, {
  flameSkull: {
    name: 'Cinder Skull', tier: 45, radius: 13, speed: 118, hp: 30, damage: 11, xp: 6,
    color: '#e0691a', contactCd: 0.6, floats: true, // bobs in the air rather than walking
  },
});
ENEMY_ORDER.push('flameSkull');

export function poolForTime(t, order = ENEMY_ORDER) {
  return order.filter((id) => ENEMY_TYPES[id].tier <= t);
}

export function difficultyMult(t) {
  // gentle ramp: hp/damage scale up over the round
  return 1 + t / 240;
}

// Spawn cadence, tripled across the board (the /3) so the horde is three times denser.
export function spawnIntervalFor(t) {
  const base = 1.1;
  const min = 0.18;
  return Math.max(min, base - t / 260) / 3;
}

export function makeBoss(level, bossDef) {
  const hp = (900 + level * 140) * bossDef.hpMult * ENEMY_HP_MULT;
  return {
    name: bossDef.name, tier: 0, radius: 42, speed: 55,
    hp, maxHp: hp, damage: (26 + level * 3) * bossDef.dmgMult * ENEMY_DMG_MULT, xp: 0,
    color: bossDef.color, isBoss: true, contactCd: 0.8,
    slamCd: 3.2, slamRadius: 130, slamTelegraph: 0.9,
  };
}

// Apply the global multipliers to every registered enemy's base stats. Runs after the
// stage-2 and stage-3 rosters have been merged in above, so it covers all of them.
for (const t of Object.values(ENEMY_TYPES)) {
  t.hp = Math.round(t.hp * ENEMY_HP_MULT);
  t.damage = Math.round(t.damage * ENEMY_DMG_MULT);
}
