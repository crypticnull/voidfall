// Support gems are global modifiers ("linked" conceptually to all active skills).
// Support gems are UNCAPPED — they can be stacked indefinitely, and each additional level
// re-applies the effect. Stack +projectiles far enough and the framerate is your only limit.
export const SUPPORTS = {
  addeddamage: {
    name: 'Damage', color: '#8a2e22',
    desc: '+18% skill damage per level.',
    apply(mods, lvl) { mods.damageMult *= 1 + 0.18 * lvl; },
  },
  multiproj: {
    name: 'Quantity', color: '#4a6d7a',
    desc: '+1 projectile per level.',
    apply(mods, lvl) { mods.projectileBonus += lvl; },
  },
  fasterattacks: {
    name: 'Swiftness', color: '#a8842f',
    desc: '-10% cooldown per level.',
    apply(mods, lvl) { mods.cooldownMult *= Math.pow(0.9, lvl); },
  },
  increasedarea: {
    name: 'Scale', color: '#5c3f6e',
    desc: '+20% area of effect and effect size per level.',
    apply(mods, lvl) { const m = 1 + 0.2 * lvl; mods.areaMult *= m; mods.sizeMult *= m; },
  },
  pierce: {
    name: 'Pierce', color: '#2f6e5c',
    desc: 'Projectiles pierce +1 enemy per level.',
    apply(mods, lvl) { mods.pierceBonus += lvl; },
  },
  chain: {
    name: 'Chain', color: '#8a5a1f',
    desc: 'Chaining effects bounce +1 time per level.',
    apply(mods, lvl) { mods.chainBonus += lvl; },
  },
  lifeleech: {
    name: 'Lifesteal', color: '#7a1f2e',
    desc: 'Leech 2% of damage dealt as life per level.',
    apply(mods, lvl) { mods.lifeLeech += 0.02 * lvl; },
  },
  critchance: {
    name: 'Crit Chance', color: '#3a3a42',
    desc: '+8% critical strike chance per level.',
    apply(mods, lvl) { mods.critChance += 0.08 * lvl; },
  },
  duration: {
    name: 'Duration', color: '#5c8a3f',
    desc: '+10% skill duration per level.',
    apply(mods, lvl) { mods.durationMult *= 1 + 0.1 * lvl; },
  },
  forking: {
    name: 'Forking', color: '#2f6d8a',
    // maxLevel stops it being offered once it can no longer do anything: fork depth is clamped
    // at MAX_FORK_DEPTH in spawnProjectile, so a 4th level was a dead pick occupying a card.
    maxLevel: 3,
    desc: '+1 fork per level, up to 3. Forking shots split in two on impact.',
    apply(mods, lvl) { mods.forkBonus += lvl; },
  },
};

export const SUPPORT_ORDER = Object.keys(SUPPORTS);
