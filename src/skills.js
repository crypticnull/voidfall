import { normalize, dist, MAX_CRIT_CHANCE } from './utils.js';
// The skill level-up damage roll is priced against the Damage tome, so the two cannot drift.
// One-way: supports.js does not import skills.js, so there is no cycle.
import { shapeValue } from './difficulty.js';
import { tomeMagnitude } from './supports.js';

// Each skill gem: id, name, desc, color, designLevel, cooldownBase (s), tags
//
// `designLevel` is the tier a gem was BALANCED around, not a cap — skills level without
// limit. It survives because the dev panel's MAX button needs somewhere sensible to jump
// to, and because a reader deserves to know where the authored numbers stop being tested.
// cast(ctx) is called by the game loop when the skill's cooldown fires.
// ctx = { player, level, mods, world, facing }
// world provides: findNearest(x,y,range), enemiesInRange(x,y,range),
//   spawnProjectile(opts), spawnEffect(opts), spawnMinion(opts)

function scale(base, perLevel, level) { return base + perLevel * (level - 1); }

// Skeleton minions strike once per hit-and-run dash rather than continuously, so each
// blow is scaled up to match the longer engage/disengage cycle.
export const SKELETON_STRIKE_MULT = 2.4;

// ---------- live-tunable skill stats ----------
// Every number a skill's cast() depends on lives in its `tune` block rather than as a literal,
// so the dev tools can drive them with sliders at runtime. TUNE_META describes how to present
// each key; a skill only shows the keys it actually declares, so irrelevant stats never appear.
export const TUNE_META = {
  cooldown:             { label: 'Cooldown',            min: 0.05, max: 12,   step: 0.05, unit: 's' },
  damage:               { label: 'Base Damage',         min: 0,    max: 200,  step: 1 },
  damagePerLevel:       { label: 'Damage / Level',      min: 0,    max: 40,   step: 0.1 },
  radius:               { label: 'Base Size',           min: 4,    max: 500,  step: 1 },
  radiusPerLevel:       { label: 'Size / Level',        min: 0,    max: 80,   step: 1 },
  arcDeg:               { label: 'Arc Width',           min: 15,   max: 360,  step: 5,    unit: '°' },
  knockback:            { label: 'Knockback',           min: 0,    max: 400,  step: 5 },
  speed:                { label: 'Travel Speed',        min: 20,   max: 1400, step: 10 },
  projSize:             { label: 'Projectile Size',     min: 1,    max: 40,   step: 0.5 },
  // Purely visual: scales the drawn thunderbolt blade, never the collision radius — that stays
  // on Projectile Size, so the look can be dialled without silently changing what a bolt hits.
  boltWidth:            { label: 'Bolt Width',          min: 0.3,  max: 2.5,  step: 0.05, unit: '×' },
  // Also visual-only: scales the zigzag amplitude of the spine, which re-rolls every frame —
  // so this is both how jagged the bolt is AND how hard it shakes in flight. 0 flies straight.
  boltVibe:             { label: 'Vibration',           min: 0,    max: 2.5,  step: 0.05, unit: '×' },
  life:                 { label: 'Projectile Life',     min: 0.1,  max: 8,    step: 0.05, unit: 's' },
  lifeVary:             { label: 'Life Variance',       min: 0,    max: 0.6,  step: 0.01 },
  charges:              { label: 'Charges',             min: 1,    max: 6,    step: 1 },
  distance:             { label: 'Distance',            min: 40,   max: 500,  step: 5,    unit: 'px' },
  grace:                { label: 'Grace Period',        min: 0,    max: 1.5,  step: 0.05, unit: 's' },
  markWidth:            { label: 'Mark Width',          min: 10,   max: 160,  step: 5,    unit: 'px' },
  count:                { label: 'Projectile Count',    min: 1,    max: 30,   step: 1 },
  spreadDeg:            { label: 'Spread',              min: 0,    max: 180,  step: 1,    unit: '°' },
  // The volley pair. Any skill that can gain +projectiles should carry both — see volleyShot.
  stagger:              { label: 'Shot Stagger',        min: 0,    max: 0.5,  step: 0.005, unit: 's' },
  jitterDeg:            { label: 'Aim Jitter',          min: 0,    max: 30,   step: 0.5,  unit: '°' },
  // 1 = an even ladder of shots, 0 = randomly scattered across the same window.
  staggerEven:          { label: 'Stagger Evenness',    min: 0,    max: 1,    step: 0.05 },
  aoeRadius:            { label: 'Explosion Size',      min: 4,    max: 300,  step: 1 },
  eatRadius:            { label: 'Swallow Radius',      min: 8,    max: 200,  step: 2 },
  pullRadius:           { label: 'Pull Radius',         min: 40,   max: 700,  step: 10 },
  orbitRadius:          { label: 'Orbit Radius',        min: 10,   max: 260,  step: 2 },
  capacity:             { label: 'Shots to Fill',       min: 1,    max: 20,   step: 1 },
  // ---- Salt Circle. `capacity` above is Nullward's and counts SHOTS, so the ring's charge
  // needs its own key rather than a second meaning bolted onto the same one.
  force:                { label: 'Push Force',          min: 0,    max: 2000, step: 10 },
  // 0 = every enemy takes the full push, 1 = the budget is divided strictly between them.
  // The dial that decides whether the ring is a wall or a nuisance when the wave is deep.
  crowdFalloff:         { label: 'Crowd Falloff',       min: 0,    max: 1.5,  step: 0.05 },
  chargeCap:            { label: 'Hold to Discharge',   min: 1,    max: 120,  step: 1 },
  durationPerLevel:     { label: 'Duration / Level',    min: 0,    max: 3,    step: 0.05, unit: 's' },
  burstRadiusPct:       { label: 'Discharge Size',      min: 50,   max: 300,  step: 5,    unit: '%' },
  burstKnockback:       { label: 'Discharge Shove',     min: 0,    max: 600,  step: 10 },
  collapseRadius:       { label: 'Collapse Radius',     min: 40,   max: 500,  step: 10 },
  targetRange:          { label: 'Targeting Range',     min: 80,   max: 2000, step: 20 },
  pierce:               { label: 'Pierce',              min: 0,    max: 20,   step: 1 },
  chain:                { label: 'Chain',               min: 0,    max: 20,   step: 1 },
  forks:                { label: 'Forks',               min: 0,    max: 3,    step: 1 },
  childChain:           { label: 'Chain (per fork)',    min: 0,    max: 20,   step: 1 },
  chainRange:           { label: 'Chain Range',         min: 40,   max: 900,  step: 10 },
  range:                { label: 'Range',               min: 40,   max: 1400, step: 10 },
  width:                { label: 'Beam Width',          min: 2,    max: 120,  step: 1 },
  coneDeg:              { label: 'Cone Angle',          min: 5,    max: 180,  step: 1,    unit: '°' },
  duration:             { label: 'Duration',            min: 0.1,  max: 15,   step: 0.05, unit: 's' },
  tickInterval:         { label: 'Tick Interval',       min: 0.02, max: 1,    step: 0.01, unit: 's' },
  slowDuration:         { label: 'Slow Duration',       min: 0.1,  max: 12,   step: 0.1,  unit: 's' },
  frostDuration:        { label: 'Frost Ground Time',   min: 0.2,  max: 15,   step: 0.1,  unit: 's' },
  cloudDuration:        { label: 'Frost Cloud Time',    min: 0.2,  max: 10,   step: 0.1,  unit: 's' },
  frostRadiusPct:       { label: 'Frost Ground Size',   min: 20,   max: 150,  step: 5,    unit: '%' },
  burnDuration:         { label: 'Burn Duration',       min: 0.2,  max: 15,   step: 0.1,  unit: 's' },
  burnDamage:           { label: 'Burn DPS',            min: 0,    max: 60,   step: 0.5 },
  burnDamagePerLevel:   { label: 'Burn DPS / Level',    min: 0,    max: 20,   step: 0.1 },
  poisonDuration:       { label: 'Poison Duration',     min: 0.2,  max: 20,   step: 0.5,  unit: 's' },
  puddleRadius:         { label: 'Puddle Size',         min: 4,    max: 250,  step: 1 },
  // Both of these existed in the flask's tune block but had no entry here, so the panel — which
  // only shows keys it can describe — silently skipped them.
  splashRadius:         { label: 'Splash Size',         min: 4,    max: 300,  step: 1 },
  spreadRadius:         { label: 'Death Spread Range',  min: 0,    max: 600,  step: 5 },
  puddleDuration:       { label: 'Puddle Duration',     min: 0.2,  max: 15,   step: 0.1,  unit: 's' },
  freeze:               { label: 'Freeze Buildup',      min: 1,    max: 200,  step: 1 },
  freezePerLevel:       { label: 'Freeze / Level',      min: 0,    max: 80,   step: 1 },
  freezeDuration:       { label: 'Freeze Duration',     min: 0.5,  max: 20,   step: 0.5,  unit: 's' },
  maxTargets:           { label: 'Max Targets',         min: 1,    max: 30,   step: 1 },
  maxRadius:            { label: 'Outer Reach',         min: 20,   max: 400,  step: 2 },
  innerRadius:          { label: 'Inner Reach',         min: 4,    max: 200,  step: 2 },
  pulsePeriod:          { label: 'Pulse Period',        min: 0.2,  max: 6,    step: 0.1,  unit: 's' },
  spin:                 { label: 'Spin Rate',           min: 0.2,  max: 15,   step: 0.1 },
  starRadius:           { label: 'Blade Size',          min: 2,    max: 60,   step: 0.5 },
  minionHp:             { label: 'Minion Health',       min: 5,    max: 400,  step: 5 },
  minionHpPerLevel:     { label: 'Minion HP / Level',   min: 0,    max: 60,   step: 1 },
  minionDamage:         { label: 'Minion Damage',       min: 1,    max: 120,  step: 1 },
  minionDamagePerLevel: { label: 'Minion Dmg / Level',  min: 0,    max: 40,   step: 0.5 },
  minionSpeed:          { label: 'Minion Speed',        min: 30,   max: 500,  step: 10 },
  minionAtkCd:          { label: 'Minion Attack Rate',  min: 0.1,  max: 5,    step: 0.05, unit: 's' },
  minionCapBase:        { label: 'Minion Cap',          min: 1,    max: 20,   step: 1 },
  minionReviveTime:     { label: 'Minion Revive',       min: 0.5,  max: 30,   step: 0.5,  unit: 's' },
};

/**
 * Projected damage for a skill at a given level, for the tuning panel's readout.
 *
 * Damage over time is counted in FULL — a burn or a poison contributes its DPS times its whole
 * duration, because that is what one cast eventually delivers to one enemy. It assumes the
 * target lives long enough to take all of it, which for a trash mob it often will not; treat a
 * heavy-DoT skill's number as its ceiling rather than its average.
 *
 * SINGLE TARGET, and with no player mods, supports or crits applied — this answers "what does
 * this gem do on its own as it levels", which is the question you are actually asking when you
 * drag its Damage / Level slider. A number that folded in the current build would move every
 * time you equipped something and tell you nothing about the gem.
 *
 * Levels 10 and 20 are past `designLevel` (most gems were balanced around 5) but no longer
 * past reach: skills level without limit, so these are levels a long run genuinely arrives
 * at. That is exactly why the projection matters — a per-level value that looks harmless at
 * 5 is the thing that decides whether level 20 is playable.
 *
 * @param {string} id
 * @param {number} level
 * @returns {{ perHit: number, hits: number, dps: number, kind: string } | null}
 */
export function skillDamageAt(id, level) {
  const def = SKILLS[id];
  if (!def || !def.tune) return null;
  const T = def.tune;
  const cd = T.cooldown || 1;

  // Minions do not hit on the caster's cooldown — they hold position and swing on their own
  // attack timer, so their rate is minionAtkCd and the cast interval is irrelevant to it.
  if (T.minionDamage !== undefined) {
    const per = scale(T.minionDamage, T.minionDamagePerLevel || 0, level) * SKELETON_STRIKE_MULT;
    const rate = T.minionAtkCd || 1;
    return { perHit: per, hits: 1, dps: per / rate, kind: 'per minion' };
  }

  const base = T.damage !== undefined
    ? scale(T.damage, T.damagePerLevel || 0, level) : 0;

  // A pure DEBUFF skill: its `damage` is a poison DPS applied for `poisonDuration`, not a hit.
  // Counting it as a per-cast hit — which is what happened before — reported Poison Flask at
  // its tick rate and ignored the six seconds that tick runs for, understating it several fold.
  if (T.poisonDuration !== undefined) {
    const total = base * T.poisonDuration;
    return { perHit: base, hits: 1, dps: total / cd, kind: `poison ${T.poisonDuration}s` };
  }

  // A channelled or ground effect ticks for its whole duration rather than landing once.
  let hits = 1;
  let kind = 'per cast';
  if (T.duration && T.tickInterval) {
    hits = Math.max(1, Math.floor(T.duration / T.tickInterval));
    kind = `${hits} ticks`;
  } else if (T.count && T.count > 1) {
    // Projectile count only counts as extra damage against ONE target if they can all land on
    // it, which a spread cannot. Counted anyway, and labelled, so the number is not silently
    // optimistic — a fan of six that hits one enemy once is a different weapon.
    hits = T.count;
    kind = `${hits} projectiles`;
  }

  let total = base * hits;

  // Burn is applied damage too, and on the skills that carry it it is most of the output.
  // burnDamage is a DPS, so the total it delivers is that times how long it burns for.
  if (T.burnDamage !== undefined) {
    const burnDps = scale(T.burnDamage, T.burnDamagePerLevel || 0, level);
    const burnTotal = burnDps * (T.burnDuration || 0);
    total += burnTotal;
    kind += ` + ${T.burnDuration}s burn`;
  }
  if (!total) return null;
  return { perHit: base, hits, dps: total / cd, kind };
}

/**
 * How the dev panel groups the skills. Ordered as the panel shows them, and keyed off a
 * `category` on each skill so a new gem lands in the right group by declaring one rather than
 * by being added to a list over here.
 */
export const SKILL_CATEGORIES = [
  { id: 'melee', label: 'Melee DPS' },
  { id: 'ranged', label: 'Ranged DPS' },
  { id: 'area', label: 'Area Skills' },
  { id: 'status', label: 'Status Skills' },
  { id: 'single', label: 'Single Target' },
  { id: 'minion', label: 'Minions' },
  // Wards are the first DEFENSIVE category. Every other gem in the game is a way to deal
  // damage; protection came only from stats, items and class passives, never from a gem the
  // player chose — which is why a level-up always felt like the same decision in a different
  // colour. A ward is picked instead of damage, so it has to pay for itself: each one converts
  // what it absorbs back into offence rather than being a quiet tax on the build.
  { id: 'ward', label: 'Wards' },
  // Mobility skills occupy the DASH SLOT, not a gem slot. The dodge button is a slot of its
  // own: everyone starts with the Dodge Roll in it, and finding another mobility skill swaps
  // what the button does rather than adding a fourth attack. Best of both worlds — the dash
  // stays a guaranteed, universal verb, and it is still buildable.
  { id: 'mobility', label: 'Mobility' },
];

/** What can sit in the dash slot. Deliberately NOT part of SKILL_ORDER — these are never
 *  offered as gems, only as slot swaps (see generateCards in main.js). */
export const MOBILITY_ORDER = ['dodgeroll', 'voidstep'];

export const SKILLS = {
  slash: {
    category: 'melee',
    name: 'Sword Slash', color: '#c47a1f', designLevel: 5,
    noProjectiles: true, // shape gains nothing from extra projectiles
    desc: 'A fast blade arc close in front, knocking the front rank back.',
    cooldownBase: 0.65,
    icon: 'sword',
    tune: { cooldown: 0.7, damage: 21, damagePerLevel: 6.5, radius: 125, arcDeg: 130, knockback: 200 },
    cast(ctx) {
      const { player, level, mods, world, facing } = ctx;
      const T = SKILLS.slash.tune;
      const dmg = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      // ONE area stat, applied once. This used to read `areaMult * sizeMult` back when those
      // were separate upgrades — legitimate then, but a skill offering both rolls compounded
      // them, which is how a swept arc ended up covering most of the screen.
      const radius = T.radius * mods.areaMult;
      const arc = T.arcDeg * Math.PI / 180;
      const fx = facing.x, fy = facing.y;
      const targets = world.enemiesInRange(player.x, player.y, radius);
      for (const e of targets) {
        const dx = e.x - player.x, dy = e.y - player.y;
        const d = Math.hypot(dx, dy) || 1;
        const dot = (dx / d) * fx + (dy / d) * fy;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (angle <= arc / 2) world.damageEnemy(e, dmg, mods, { knockback: T.knockback });
      }
      // Every swing, not only the ones that connect. The synthesised version this replaced was
      // a blade-into-body impact, so gating it on a hit was right; the recorded sample is the
      // SWISH of the swing itself, and a weapon that falls silent whenever you miss reads as
      // the attack not having fired at all.
      world.playSfx('slashHit');
      world.spawnEffect({ kind: 'slash', follow: true, x: player.x, y: player.y, radius, angle: arc, dir: Math.atan2(fy, fx), color: '#e8b45a', duration: 0.26, mods });
    },
  },

  scythe: {
    category: 'melee',
    name: 'Scythe Sweep', color: '#5f7a4a', designLevel: 5,
    noProjectiles: true, // a swept arc gains nothing from extra projectiles
    desc: 'A long crescent sweep covering almost everything in front of you.',
    cooldownBase: 1.0,
    icon: 'scythe',
    tune: { cooldown: 0.8, damage: 20, damagePerLevel: 7.6, radius: 200, arcDeg: 170, knockback: 60 },
    cast(ctx) {
      const { player, level, mods, world, facing } = ctx;
      const T = SKILLS.scythe.tune;
      const dmg = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      // ONE area stat, applied once. This used to read `areaMult * sizeMult` back when those
      // were separate upgrades — legitimate then, but a skill offering both rolls compounded
      // them, which is how a swept arc ended up covering most of the screen.
      const radius = T.radius * mods.areaMult;
      const arc = T.arcDeg * Math.PI / 180;
      const fx = facing.x, fy = facing.y;
      for (const e of world.enemiesInRange(player.x, player.y, radius)) {
        const dx = e.x - player.x, dy = e.y - player.y;
        const d = Math.hypot(dx, dy) || 1;
        const dot = (dx / d) * fx + (dy / d) * fy;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (angle <= arc / 2) world.damageEnemy(e, dmg, mods, { knockback: T.knockback });
      }
      // Every swing, not only the ones that connect. The synthesised version this replaced was
      // a blade-into-body impact, so gating it on a hit was right; the recorded sample is the
      // SWISH of the swing itself, and a weapon that falls silent whenever you miss reads as
      // the attack not having fired at all.
      world.playSfx('slashHit');
      world.spawnEffect({
        kind: 'scythe', follow: true, x: player.x, y: player.y,
        radius, angle: arc, dir: Math.atan2(fy, fx), color: '#9fd07a', duration: 0.38, mods,
      });
    },
  },

  fireball: {
    category: 'ranged',
    name: 'Fireball', color: '#c0421f', designLevel: 5,
    desc: 'A heavy bolt that detonates on impact. Short reach, hardest single hit.',
    cooldownBase: 0.95,
    icon: 'fireball',
    tune: { cooldown: 1.3, damage: 42, damagePerLevel: 14, speed: 450, projSize: 12, aoeRadius: 60,
      life: 1.7, lifeVary: 0.18, spreadDeg: 9, forks: 0, childChain: 0, targetRange: 500,
      stagger: 0.035, jitterDeg: 3.5, },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.fireball.tune;
      const target = world.findNearest(player.x, player.y, T.targetRange);
      if (!target) return;
      const dmg = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      const count = 1 + mods.projectileBonus;
      const spread = T.spreadDeg * Math.PI / 180;
      const baseAng = Math.atan2(target.y - player.y, target.x - player.x);
      world.playSfx('fireball');
      for (let i = 0; i < count; i++) {
        const shot = volleyShot(T, i, count, T.cooldown * mods.cooldownMult);
        const off = (i - (count - 1) / 2) * spread;
        const ang = baseAng + off + shot.jitter;
        world.spawnProjectile({
          delay: shot.delay,
          x: player.x, y: player.y, vx: Math.cos(ang) * T.speed, vy: Math.sin(ang) * T.speed,
          damage: dmg, radius: T.projSize * mods.sizeMult, pierce: mods.pierceBonus, chain: 0,
          // Speed is fixed, so varying how long a bolt lives is varying how far it reaches. A
          // volley that all fizzles on the same arc reads as one wide object; staggered burnout
          // reads as several bolts. Symmetric, so the average range is exactly T.life.
          life: T.life * (1 + (Math.random() * 2 - 1) * (T.lifeVary || 0)),
          forks: T.forks + mods.forkBonus, childChain: T.childChain + mods.chainBonus,
          color: '#c0421f', aoeRadius: T.aoeRadius * mods.areaMult, trail: '#d97a35', mods, isFire: true,
        });
      }
    },
  },

  quickshot: {
    category: 'single',
    name: 'Quick Shot', color: '#b8a678', designLevel: 5,
    desc: 'Rapid, heavy arrows at one distant foe. The steadiest damage there is.',
    cooldownBase: 0.8,
    icon: 'arrow',
    tune: { cooldown: 0.6, damage: 30, damagePerLevel: 6.3, speed: 700, projSize: 5, life: 2.5,
      spreadDeg: 7, forks: 0, childChain: 0, targetRange: 1100, stagger: 0.015, jitterDeg: 1, },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.quickshot.tune;
      const target = world.findNearest(player.x, player.y, T.targetRange);
      if (!target) return;
      const dmg = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      const count = 1 + mods.projectileBonus;
      const baseAng = Math.atan2(target.y - player.y, target.x - player.x);
      const spread = T.spreadDeg * Math.PI / 180;
      world.playSfx('quickshot');
      for (let i = 0; i < count; i++) {
        const shot = volleyShot(T, i, count, T.cooldown * mods.cooldownMult);
        const off = (i - (count - 1) / 2) * spread;
        const ang = baseAng + off + shot.jitter;
        world.spawnProjectile({
          delay: shot.delay,
          x: player.x, y: player.y, vx: Math.cos(ang) * T.speed, vy: Math.sin(ang) * T.speed,
          damage: dmg, radius: T.projSize, pierce: mods.pierceBonus, chain: 0, life: T.life,
          forks: T.forks + mods.forkBonus, childChain: T.childChain + mods.chainBonus,
          color: '#b8a678', trail: '#d4c48e', mods, isArrow: true, sizeScale: mods.sizeMult,
        });
      }
    },
  },

  icenova: {
    category: 'area',
    name: 'Ice Nova', color: '#6f95a8', designLevel: 5,
    desc: 'A wide frost burst that slows and leaves frozen ground. +patches per projectile.',
    cooldownBase: 2.4,
    icon: 'nova',
    tune: { cooldown: 2, damage: 40, damagePerLevel: 19, radius: 275, radiusPerLevel: 25,
      slowDuration: 2.5, frostDuration: 3, frostRadiusPct: 120, tickInterval: 0.25 },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.icenova.tune;
      const dmg = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      const radius = scale(T.radius, T.radiusPerLevel, level) * mods.areaMult;
      const targets = world.enemiesInRange(player.x, player.y, radius);
      for (const e of targets) {
        world.damageEnemy(e, dmg, mods, {});
        e.slowUntil = performance.now() + T.slowDuration * 1000 * mods.durationMult;
        e.slowFactor = 0.45;
      }
      world.spawnEffect({ kind: 'ring', x: player.x, y: player.y, radius, color: '#6f95a8', duration: 0.35, mods });
      // Lingering frosted ground keeps chilling foes who stand in it after the burst fades.
      const patches = 1 + mods.projectileBonus;
      const patchRadius = radius * (T.frostRadiusPct / 100);
      for (let i = 0; i < patches; i++) {
        // Each +projectile adds another patch, staggered the same way Flame Walk spaces its
        // burning ground: later patches trail the player and lock in where they are when
        // their delay elapses, so a moving caster lays a trail of frost.
        world.spawnEffect({
          kind: 'frostGround', x: player.x, y: player.y, radius: patchRadius, color: '#8fc7e0',
          duration: T.frostDuration * mods.durationMult, tickInterval: T.tickInterval, slowFactor: 0.5, slowDurationMs: 650,
          mods, delay: i * 0.1,
        });
      }
      world.playSfx('iceShard');
    },
  },

  iceshards: {
    category: 'status',
    name: 'Ice Shards', color: '#8fd0e8', designLevel: 5,
    desc: 'A piercing fan of shards that stacks Freeze, locking foes solid in ice.',
    cooldownBase: 1.6,
    icon: 'shard',
    tune: { cooldown: 1.3, damage: 4, damagePerLevel: 1.5, count: 6, spreadDeg: 50, speed: 220,
      life: 3.5, projSize: 6, pierce: 3,
      forks: 0, childChain: 0, freeze: 30, freezePerLevel: 15, freezeDuration: 6, targetRange: 800, stagger: 0.03, jitterDeg: 8, },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.iceshards.tune;
      const target = world.findNearest(player.x, player.y, T.targetRange);
      const baseAng = target
        ? Math.atan2(target.y - player.y, target.x - player.x)
        : Math.atan2(player.facing.y, player.facing.x);
      const count = T.count + mods.projectileBonus;
      const spread = T.spreadDeg * Math.PI / 180;
      const speed = T.speed;
      // It deals real damage now — modest, in line with the other Status skills — on top of the
      // freeze it exists for. It was the only skill in the game dealing none at all, which made
      // it read as broken rather than as specialised.
      const dmg = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      // Freeze buildup still scales with damage mods too. That is a deliberate double-dip kept
      // from when freeze was ALL this skill did — changing it now would quietly nerf the lock
      // on every damage-stacked build.
      const freezeAmount = scale(T.freeze, T.freezePerLevel, level) * mods.damageMult;
      const freezeDurationMs = T.freezeDuration * 1000 * mods.durationMult;
      world.playSfx('iceShard');
      for (let i = 0; i < count; i++) {
        const shot = volleyShot(T, i, count, T.cooldown * mods.cooldownMult);
        const off = count > 1 ? (i / (count - 1) - 0.5) * spread : 0;
        const ang = baseAng + off + shot.jitter;
        world.spawnProjectile({
          delay: shot.delay,
          x: player.x, y: player.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
          damage: dmg, radius: T.projSize * mods.sizeMult, pierce: T.pierce + mods.pierceBonus, chain: mods.chainBonus,
          forks: T.forks + mods.forkBonus, childChain: T.childChain + mods.chainBonus,
          life: T.life, color: '#8fd0e8', isIce: true, freezeAmount, freezeDurationMs,
          slowFactor: 0.75, slowDuration: 1200, mods,
        });
      }
    },
  },

  chainlightning: {
    category: 'ranged',
    name: 'Lightning Bolt', color: '#4fa8ff', designLevel: 5,
    desc: 'A bolt that forks on impact, each half arcing between nearby foes.',
    cooldownBase: 1.1,
    icon: 'bolt',
    tune: { cooldown: 0.9, damage: 10, damagePerLevel: 10, speed: 780, projSize: 7.5, boltWidth: 0.7,
      boltVibe: 0.35, life: 1.5, spreadDeg: 5, forks: 1, childChain: 3, chainRange: 480,
      targetRange: 700, stagger: 0.09, jitterDeg: 2, staggerEven: 1, },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.chainlightning.tune;
      const target = world.findNearest(player.x, player.y, T.targetRange);
      if (!target) return;
      const dmg = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      const baseAng = Math.atan2(target.y - player.y, target.x - player.x);
      const count = 1 + mods.projectileBonus;
      const spread = T.spreadDeg * Math.PI / 180;
      world.playSfx('chainLightning');
      for (let i = 0; i < count; i++) {
        const shot = volleyShot(T, i, count, T.cooldown * mods.cooldownMult);
        const ang = baseAng + (i - (count - 1) / 2) * spread + shot.jitter;
        world.spawnProjectile({
          delay: shot.delay,
          x: player.x, y: player.y, vx: Math.cos(ang) * T.speed, vy: Math.sin(ang) * T.speed,
          damage: dmg, radius: T.projSize * mods.sizeMult, pierce: 0,
          // The bolt forks first; each half then chains on its own. Chain bonuses feed the
          // children, since the parent is consumed by the fork before it can ricochet.
          forks: T.forks + mods.forkBonus, childChain: T.childChain + mods.chainBonus, chain: 0,
          chainRange: T.chainRange,
          life: T.life, color: '#4fa8ff', trail: '#9ed6ff', isLightning: true, mods,
        });
      }
    },
  },

  skeleton: {
    category: 'minion',
    name: 'Summon Skeleton', color: '#c9bfa0', designLevel: 5,
    desc: 'One skeleton per level, up to twelve. They dart in for heavy strikes and reassemble when felled. +1 per projectile.',
    cooldownBase: 7,
    icon: 'skull',
    tune: { cooldown: 5, minionCapBase: 12, minionHp: 40, minionHpPerLevel: 5, minionDamage: 5,
      minionDamagePerLevel: 1.5, minionSpeed: 210, minionAtkCd: 0.75, minionReviveTime: 6 },
    // How many skeletons should be standing. Exposed so the game loop can notice the moment
    // the cap rises and summon immediately, instead of waiting out the 7s cooldown.
    minionCap(level, mods) { return Math.min(level, SKILLS.skeleton.tune.minionCapBase) + mods.projectileBonus; },
    cast(ctx) {
      const { player, level, mods, world, skill } = ctx;
      const T = SKILLS.skeleton.tune;
      // Each +projectile raises the standing skeleton cap by one.
      const maxMinions = SKILLS.skeleton.minionCap(level, mods);
      const missing = maxMinions - world.countMinions('skeleton');
      if (missing <= 0) return;
      world.playSfx('skeletonMinion');
      for (let i = 0; i < missing; i++) {
        world.spawnMinion({
          type: 'skeleton', x: player.x + (Math.random() - 0.5) * 40, y: player.y + (Math.random() - 0.5) * 40,
          hp: T.minionHp + level * T.minionHpPerLevel, maxHp: T.minionHp + level * T.minionHpPerLevel,
          // He hits far harder per swing now, since he only lands one blow per dash-in
          // instead of grinding away in contact.
          damage: (T.minionDamage + level * T.minionDamagePerLevel) * SKELETON_STRIKE_MULT * mods.damageMult,
          speed: T.minionSpeed, atkRange: 34, atkCd: T.minionAtkCd,
          skillRef: skill, // lets the minion read live cooldown mods each frame
          state: 'dash', atkTimer: 0,
        });
      }
    },
  },

  firebeam: {
    category: 'single',
    name: 'Solar Ray', color: '#ff7a1f', designLevel: 5,
    desc: 'Channels a narrow searing beam that sweeps a line clean through the horde.',
    cooldownBase: 5.6,
    icon: 'beam',
    tune: { cooldown: 5, damage: 10, damagePerLevel: 4.5, range: 450, width: 22, duration: 1.05, tickInterval: 0.1 },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.firebeam.tune;
      const range = T.range;
      const inRange = world.enemiesInRange(player.x, player.y, range)
        .map((e) => ({ e, d: dist(player.x, player.y, e.x, e.y) }))
        .sort((a, b) => a.d - b.d);
      if (!inRange.length) return;
      const beams = 1 + mods.projectileBonus;
      const dmgPerTick = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      world.playSfx('firebeam');
      for (let i = 0; i < beams; i++) {
        const target = inRange[Math.min(i, inRange.length - 1)].e;
        world.spawnEffect({
          kind: 'firebeam', follow: true, targetId: target.id, range,
          x: player.x, y: player.y, tx: target.x, ty: target.y,
          width: T.width * mods.sizeMult, duration: T.duration * mods.durationMult, tickInterval: T.tickInterval, damagePerTick: dmgPerTick,
          color: '#ff7a1f', mods,
        });
      }
    },
  },

  poisonflask: {
    category: 'status',
    name: 'Poison Flask', color: '#9a4fb0', designLevel: 5,
    desc: 'Lobbed vials that splash on impact and leave pools stacking a long toxin.',
    cooldownBase: 1.7,
    icon: 'flask',
    // splashRadius is the burst thrown out when a vial breaks against a body — deliberately
    // wider than the puddle it leaves, since the splash is a one-off hit and the pool lingers.
    // spreadRadius is how far the poison jumps when a poisoned enemy DIES — the chain reaction
    // that makes the skill worth stacking. It lived as a bare constant in main.js, which meant
    // the one number that decides whether a pack chains or fizzles was the one number the
    // tuning panel could not reach.
    tune: { cooldown: 1.7, damage: 4, damagePerLevel: 2.1, speed: 390, projSize: 15, puddleRadius: 56,
      splashRadius: 84, puddleDuration: 3, poisonDuration: 6, spreadRadius: 200, stagger: 0.06, jitterDeg: 0, },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.poisonflask.tune;
      const count = 1 + mods.projectileBonus;
      // Poison is a debuff now: weaker per tick than burn, but it lasts 6s at base and stacks.
      const poisonDps = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      const poisonDur = T.poisonDuration * mods.durationMult;
      const dur = T.puddleDuration * mods.durationMult;
      const speed = T.speed;
      world.playSfx('poisonFlask');
      for (let i = 0; i < count; i++) {
        const shot = volleyShot(T, i, count, T.cooldown * mods.cooldownMult);
        const ang = Math.random() * Math.PI * 2;
        const reach = 110 + Math.random() * 150;
        world.spawnProjectile({
          delay: shot.delay,
          x: player.x, y: player.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
          // Tripled from 5. The bottle is the one thrown object you never saw in flight —
          // it read as a spark until it broke. Drives the drawn size too (see drawProjectile).
          damage: 0, radius: T.projSize * mods.sizeMult, life: reach / speed, color: '#9a4fb0', isFlask: true,
          puddleRadius: T.puddleRadius * mods.areaMult, splashRadius: T.splashRadius * mods.areaMult,
          puddleDuration: dur, poisonDps, poisonDur, mods,
        });
      }
    },
  },

  icebomb: {
    category: 'area',
    name: 'Ice Bomb', color: '#6fc9e8', designLevel: 5,
    desc: 'Lobs an aimed volley of frost charges downrange. Bursts on impact; charges that land on open ground leave chilling frost behind.',
    cooldownBase: 2.4,
    icon: 'icebomb',
    // A VOLLEY, unlike every other lobbed skill: `count` charges go out per cast regardless of
    // the projectile bonus, and the bonus adds to that. The identity of the skill is the salvo —
    // one bomb at a time would just be a colder Poison Flask.
    //
    // AIMED, not scattered. The volley is thrown DOWNRANGE at whatever you are pointing at, in a
    // narrow fan whose charges land at staggered distances — so a salvo walks a corridor through
    // the crowd rather than ringing the caster. `throwMin`/`throwMax` are that corridor's near
    // and far edge; flight time falls out of the distance, so the near charges burst first and
    // the volley reads as a walking barrage instead of one thump.
    //
    // Tight by design. `blastRadius` is well under Ice Nova's reach — the trade is that a Nova
    // is centred on you and this is placed where the crowd is.
    tune: {
      cooldown: 2.4, damage: 26, damagePerLevel: 9, count: 3,
      throwMin: 90, throwMax: 260, speed: 350, spreadDeg: 32, targetRange: 720,
      blastRadius: 66, freeze: 45, freezePerLevel: 12, freezeDuration: 4,
      slowDuration: 2.2,
      // The burst leaves two things behind, on different triggers.
      //
      // `cloudDuration` is the hanging mist, and it is thrown on EVERY burst - direct hit or
      // ground. It is the read, not a mechanic: it marks where the salvo landed for long
      // enough to aim the next one, and deliberately carries no chill of its own.
      //
      // `frostDuration`/`frostRadiusPct` are the rimed patch, and they are the MISS payoff -
      // ground detonations only. A bomb that lands on a body already spends itself on that
      // body (full blast damage plus freeze buildup); one that lands on dirt would otherwise
      // be a wasted charge, so it converts into area denial instead. Keeping the patch off
      // direct hits is also what stops the two from stacking on the same spot.
      cloudDuration: 2.5, frostDuration: 3, frostRadiusPct: 105, tickInterval: 0.25, stagger: 0.06, jitterDeg: 1,
    },
    cast(ctx) {
      const { player, level, mods, world, facing } = ctx;
      const T = SKILLS.icebomb.tune;
      const count = T.count + mods.projectileBonus;
      const dmg = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      const freezeAmount = scale(T.freeze, T.freezePerLevel, level);
      // Aim at the nearest body in range, and fall back to where the player is pointing when
      // there is nothing to throw at — the same rule the other aimed skills follow, so a bomb
      // never lands behind you just because the crowd happened to be there a moment ago.
      const target = world.findNearest(player.x, player.y, T.targetRange);
      const aim = target
        ? Math.atan2(target.y - player.y, target.x - player.x)
        : Math.atan2(facing.y, facing.x);
      const spread = (T.spreadDeg * Math.PI) / 180;
      world.playSfx('iceNova');
      for (let i = 0; i < count; i++) {
        // A LOOSE CLUSTER, not a line. Fan angle and throw distance both used to be driven by the
        // same `i`, which correlated them perfectly: charge 0 went hard left and short, the last
        // went hard right and long, and the salvo always landed as a tidy diagonal streak. The
        // two are independent now, so the impacts scatter across the corridor instead.
        //
        // Angle is free-random within the fan. Distance stays STRATIFIED — one charge per band
        // of the throw range, jittered inside its band — because pure randomness clumps, and a
        // salvo that drops all three charges on the same spot is the failure this is avoiding in
        // the other direction. Stratifying also keeps the staggered impact timing that makes the
        // volley read as a barrage rather than one thump.
        const shot = volleyShot(T, i, count, T.cooldown * mods.cooldownMult);
        const ang = aim + (Math.random() - 0.5) * spread + shot.jitter;
        const step = (i + Math.random()) / count;
        const reach = (T.throwMin + (T.throwMax - T.throwMin) * step) * mods.areaMult;
        world.spawnProjectile({
          delay: shot.delay,
          x: player.x, y: player.y,
          vx: Math.cos(ang) * T.speed, vy: Math.sin(ang) * T.speed,
          // Zero contact damage: the bomb does nothing until it bursts, so a charge that clips a
          // body on the way past still travels its full arc instead of dumping the blast early.
          damage: 0, radius: 6, life: reach / T.speed, lobDist: reach,
          color: '#6fc9e8', isIceBomb: true,
          blastDamage: dmg,
          blastRadius: T.blastRadius * mods.areaMult,
          freezeAmount, freezeDurationMs: T.freezeDuration * mods.durationMult * 1000,
          slowDuration: T.slowDuration * mods.durationMult, slowFactor: 0.5,
          cloudDuration: T.cloudDuration * mods.durationMult,
          groundDuration: T.frostDuration * mods.durationMult,
          groundRadius: T.blastRadius * mods.areaMult * (T.frostRadiusPct / 100),
          groundTick: T.tickInterval,
          mods,
        });
      }
    },
  },

  flamewalk: {
    category: 'area',
    name: 'Flame Walk', color: '#e0662f', designLevel: 5,
    desc: 'Scorches the ground in your wake, leaving a burn on anything that follows. +patches per projectile.',
    cooldownBase: 1.5,
    icon: 'flame',
    tune: { cooldown: 1.3, damage: 1, damagePerLevel: 0.7, radius: 120, duration: 5, tickInterval: 0.4,
      burnDamage: 3, burnDamagePerLevel: 1.2, burnDuration: 4 },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.flamewalk.tune;
      const count = 1 + mods.projectileBonus;
      const dmgPerTick = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      const dur = T.duration * mods.durationMult;
      const radius = T.radius * mods.areaMult;
      // Burn status the patch inflicts: a light DoT (weaker than poison) lasting 3s at base,
      // extended by duration powerups.
      const burnDps = scale(T.burnDamage, T.burnDamagePerLevel, level) * mods.damageMult;
      const burnDur = T.burnDuration * mods.durationMult;
      world.playSfx('flameWalk');
      for (let i = 0; i < count; i++) {
        // Later patches drop after a short delay so a moving player leaves a trail
        // instead of stacking them all on the same spot.
        world.spawnEffect({
          kind: 'burningGround', x: player.x, y: player.y, radius,
          duration: dur, tickInterval: T.tickInterval, damagePerTick: dmgPerTick, mods, delay: i * 0.1,
          burnDps, burnDur,
        });
      }
    },
  },

  bonethrow: {
    category: 'ranged',
    name: 'Bone Throw', color: '#cfc4a8', designLevel: 5,
    desc: 'Hurls a bone straight at the nearest foe that ricochets between nearby targets.',
    cooldownBase: 0.78, // +20% from 0.65
    icon: 'bone',
    tune: { cooldown: 0.65, damage: 14, damagePerLevel: 6.5, speed: 600, projSize: 14, life: 1.6,
      chain: 0, forks: 0, childChain: 0, chainRange: 130, targetRange: 1080, spreadDeg: 25, stagger: 0, jitterDeg: 0, },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.bonethrow.tune;
      const target = world.findNearest(player.x, player.y, T.targetRange);
      if (!target) return;
      const dmg = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      const count = 1 + mods.projectileBonus;
      const baseAng = Math.atan2(target.y - player.y, target.x - player.x);
      const speed = T.speed;
      world.playSfx('quickshot');
      // Straight at the target. Bones used to launch hard off to one side and curve back in,
      // which looked good on a single throw but meant every bone spent its first third of a
      // flight travelling away from what it was aimed at — it widened the effective miss window
      // and made the skill feel like it was ignoring your target.
      const spread = (T.spreadDeg * Math.PI) / 180;
      for (let i = 0; i < count; i++) {
        // Extra bones fan a few degrees off the line instead, centred so an odd count still puts
        // one bone dead on target rather than straddling it.
        const shot = volleyShot(T, i, count, T.cooldown * mods.cooldownMult);
        const ang = baseAng + (count > 1 ? (i / (count - 1) - 0.5) * spread : 0) + shot.jitter;
        world.spawnProjectile({
          delay: shot.delay,
          x: player.x, y: player.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
          damage: dmg, radius: T.projSize * mods.sizeMult, pierce: mods.pierceBonus,
          chain: T.chain + mods.chainBonus, chainRange: T.chainRange,
          forks: T.forks + mods.forkBonus, childChain: T.childChain + mods.chainBonus,
          life: T.life, color: '#cfc4a8', isBone: true, sizeScale: mods.sizeMult, mods,
        });
      }
    },
  },

  ninjastars: {
    category: 'melee',
    name: 'Ninja Stars', color: '#a8b4c2', designLevel: 5,
    desc: 'A ring of whirling shuriken that pulses out and back around you.',
    cooldownBase: 3.4,
    icon: 'star',
    tune: { cooldown: 2.1, damage: 5, damagePerLevel: 2, duration: 1.5, count: 5, maxRadius: 100,
      innerRadius: 34, pulsePeriod: 1, spin: 3.2, starRadius: 18, tickInterval: 0.15 },
    cast(ctx) {
      const { player, level, mods, world, skill } = ctx;
      const T = SKILLS.ninjastars.tune;
      world.playSfx('quickshot');
      world.spawnEffect({
        kind: 'ninjastars', follow: true, x: player.x, y: player.y, skillRef: skill,
        duration: T.duration * mods.durationMult,
        baseCount: T.count,                                  // recomputed live in updateEffect...
        count: T.count + mods.projectileBonus,               // ...so +projectile gems apply mid-spin
        maxRadius: T.maxRadius * mods.areaMult,
        innerRadius: T.innerRadius,
        pulsePeriod: T.pulsePeriod,
        spin: T.spin,
        starRadius: T.starRadius * mods.sizeMult,
        tickInterval: T.tickInterval,
        damagePerTick: scale(T.damage, T.damagePerLevel, level) * mods.damageMult,
        mods,
      });
    },
  },

  flamethrower: {
    category: 'status',
    name: 'Flamethrower', color: '#ff6a1f', designLevel: 5,
    noProjectiles: true, // shape gains nothing from extra projectiles
    desc: 'A long, narrow jet of flame that leaves everything in its line burning.',
    cooldownBase: 3.8, // flame duration, then the remainder as cooldown
    icon: 'flamestream',
    tune: { cooldown: 2.5, damage: 2, damagePerLevel: 0.9, range: 409.5, coneDeg: 25, duration: 2.1,
      tickInterval: 0.12, burnDamage: 4.5, burnDamagePerLevel: 0.7, burnDuration: 3 },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.flamethrower.tune;
      // sizeMult on the RANGE only, not the cone angle: `size` is in this skill's upgrade pool
      // and was doing nothing, but widening an already
      // wide cone with both stats would have made it a full circle. Reach is the honest read of
      // a bigger flame.
      const range = T.range * mods.areaMult;        // range grows with the Scale tome
      const halfAngle = (T.coneDeg * Math.PI / 180) * mods.areaMult / 2; // widens with the Scale tome
      world.playSfx('firebeam');
      world.spawnEffect({
        kind: 'flamethrower', follow: true, x: player.x, y: player.y,
        duration: T.duration, tickInterval: T.tickInterval, range, halfAngle,
        damagePerTick: scale(T.damage, T.damagePerLevel, level) * mods.damageMult,
        burnDps: scale(T.burnDamage, T.burnDamagePerLevel, level) * mods.damageMult,
        burnDur: T.burnDuration * mods.durationMult, mods,
      });
    },
  },

  electrofingers: {
    category: 'ranged',
    name: 'Electro Fingers', color: '#5ac8f0', designLevel: 5,
    desc: 'Tethers crackling lightning to up to five nearby foes at once.',
    cooldownBase: 0.9,
    icon: 'spark',
    tune: { cooldown: 1.5, damage: 2, damagePerLevel: 0.8, range: 400, maxTargets: 5,
      forks: 0, duration: 1.3, tickInterval: 0.12 },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.electrofingers.tune;
      if (!world.findNearest(player.x, player.y, T.range)) return;
      world.playSfx('electroFingers', T.duration);
      // One field effect owns all tethers so it can pick distinct nearest targets each
      // frame — never more than one beam per enemy, even as foes die and it re-targets.
      world.spawnEffect({
        kind: 'electroField', follow: true, x: player.x, y: player.y,
        range: T.range, maxTargets: T.maxTargets + mods.projectileBonus,
        duration: T.duration * mods.durationMult, tickInterval: T.tickInterval,
        damagePerTick: scale(T.damage, T.damagePerLevel, level) * mods.damageMult,
        chain: mods.chainBonus, fork: T.forks + mods.forkBonus, mods,
      });
    },
  },

  // ---------- The void line ----------
  // Every other element in the game ADDS light. The void takes it away, and these seven are
  // built on subtraction rather than on another damage number: they remove enemies from where
  // they were standing, remove their future, or remove the space between you and them.
  //
  // They also give the relic shelf a home. Hollow Star, Tidebreaker, Gravebloom and The Long
  // Dark all rewrite what a COLLAPSE does, and until now nothing in the pool reliably produced
  // one — so four of the six relics were rules waiting for a build that did not exist.
  //
  // Every skill in the line carries `voidLine: true`, and generateCards keeps the whole line
  // out of the level-up pool until the void's introduction has fired (see updateVoidIntro).
  // The power arriving WITH the threat is the fiction holding together: before the tear opens
  // the void does not exist in this run, and a card offering its magic would say otherwise.
  // Void classes are the exception by construction — their starting gem is already owned, and
  // owned skills keep levelling; only NEW offers are gated.

  gravepull: {
    category: 'melee',
    voidLine: true,
    name: 'Gravepull', color: '#7a56d2', designLevel: 5,
    noProjectiles: true,
    desc: 'A sweep that hauls the horde INTO you, then cuts. You choose when the crowd arrives.',
    cooldownBase: 1.5,
    icon: 'gravepull',
    tune: { cooldown: 1.6, damage: 26, damagePerLevel: 8, radius: 210, arcDeg: 170, pull: 150 },
    cast(ctx) {
      const { player, level, mods, world, facing } = ctx;
      const T = SKILLS.gravepull.tune;
      const dmg = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      const radius = T.radius * mods.areaMult;
      const dir = Math.atan2(facing.y, facing.x);
      const half = (T.arcDeg * Math.PI) / 180 / 2;
      for (const e of world.enemiesInRange(player.x, player.y, radius)) {
        const a = Math.atan2(e.y - player.y, e.x - player.x);
        // Shortest angular difference, so the arc wraps correctly either side of ±π.
        let d = Math.abs(((a - dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d > half) continue;
        world.damageEnemy(e, dmg, mods, {});
        // The pull IS the skill. Never past the player — a body dragged through you would end
        // up behind your back, which is the opposite of gathering a crowd in front of you.
        const dd = Math.hypot(e.x - player.x, e.y - player.y);
        if (dd > 1) {
          const step = Math.min(T.pull, Math.max(0, dd - (player.radius + e.radius)));
          e.x -= ((e.x - player.x) / dd) * step;
          e.y -= ((e.y - player.y) / dd) * step;
        }
      }
      world.spawnEffect({ kind: 'gravepull', x: player.x, y: player.y, radius,
        dir, angle: half * 2, duration: 0.34, mods });
      world.playSfx('scythe');
    },
  },

  wanderingmaw: {
    category: 'ranged',
    voidLine: true,
    name: 'Wandering Maw', color: '#5c3fb0', designLevel: 5,
    desc: 'A slow hole that drifts across the field, dragging the horde along with it.',
    cooldownBase: 4.5,
    icon: 'maw',
    tune: { cooldown: 4.2, damage: 44, damagePerLevel: 15, radius: 130, speed: 110,
      duration: 3.2, spreadDeg: 26, stagger: 0.12, jitterDeg: 10 },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.wanderingmaw.tune;
      const target = world.findNearest(player.x, player.y, 900);
      const baseAng = target
        ? Math.atan2(target.y - player.y, target.x - player.x)
        : Math.random() * Math.PI * 2;
      const count = 1 + mods.projectileBonus;
      const spread = (T.spreadDeg * Math.PI) / 180;
      for (let i = 0; i < count; i++) {
        const shot = volleyShot(T, i, count, T.cooldown * mods.cooldownMult);
        const ang = baseAng + (i - (count - 1) / 2) * spread + shot.jitter;
        // A singularity that MOVES — the same effect the player's collapses use, given a
        // velocity. Everything it hauls in comes with it, so a maw crossing a packed screen
        // arrives at the far side towing the crowd, and implodes on all of it at once.
        world.spawnEffect({
          kind: 'singularity', x: player.x, y: player.y,
          vx: Math.cos(ang) * T.speed, vy: Math.sin(ang) * T.speed,
          radius: T.radius * mods.areaMult, duration: T.duration * mods.durationMult,
          damage: scale(T.damage, T.damagePerLevel, level) * mods.damageMult,
          seed: Math.random() * 10, delay: shot.delay, mods,
        });
      }
      world.playSfx('iceNova');
    },
  },

  unmaking: {
    category: 'single',
    voidLine: true,
    name: 'Unmaking', color: '#8a4fd0', designLevel: 5,
    desc: 'A beam that eats a share of what the target has LEFT. Never quite finishes the job.',
    cooldownBase: 5,
    icon: 'unmake',
    tune: { cooldown: 1.5, damage: 20, damagePerLevel: 2.5, range: 480, width: 20,
      duration: 0.8, tickInterval: 0.15, healthPct: 4, healthPctPerLevel: 0.7 },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.unmaking.tune;
      const target = world.findNearest(player.x, player.y, T.range);
      if (!target) return;
      world.playSfx('firebeam');
      const beams = 1 + mods.projectileBonus;
      for (let i = 0; i < beams; i++) {
        world.spawnEffect({
          kind: 'unmaking', follow: true, targetId: target.id, range: T.range,
          x: player.x, y: player.y, tx: target.x, ty: target.y,
          width: T.width * mods.sizeMult,
          duration: T.duration * mods.durationMult, tickInterval: T.tickInterval,
          // Two components, and the split is the whole balance of the skill: a flat floor so
          // it is not useless on a nearly-dead target, plus a share of CURRENT health, which
          // is what makes it the answer to a health bar that will not move. Current rather
          // than max means every tick takes less than the last — it converges on a husk and
          // never on a kill, so it opens big targets up instead of deleting them.
          damagePerTick: scale(T.damage, T.damagePerLevel, level) * mods.damageMult,
          healthFrac: scale(T.healthPct, T.healthPctPerLevel, level) / 100,
          color: '#8a4fd0', mods, delay: i * 0.1,
        });
      }
    },
  },

  eventhorizon: {
    category: 'area',
    voidLine: true,
    name: 'Event Horizon', color: '#6b3fc0', designLevel: 5,
    desc: 'Opens a collapse that hauls everything inward for seconds, then implodes on all of it.',
    cooldownBase: 6,
    icon: 'horizon',
    tune: { cooldown: 5.5, damage: 60, damagePerLevel: 22, radius: 200, duration: 2.2,
      targetRange: 620 },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.eventhorizon.tune;
      // Placed on the thickest part of the crowd rather than on the nearest body: a collapse
      // is worth what it drags in, so the useful question is "where are they" not "what is
      // closest". Falls back to the player's own feet when the field is empty.
      let bx = player.x, by = player.y, best = -1;
      for (const e of world.enemiesInRange(player.x, player.y, T.targetRange)) {
        const n = world.enemiesInRange(e.x, e.y, T.radius).length;
        if (n > best) { best = n; bx = e.x; by = e.y; }
      }
      const count = 1 + mods.projectileBonus;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const off = i === 0 ? 0 : T.radius * 0.6;
        world.spawnEffect({
          kind: 'singularity', x: bx + Math.cos(a) * off, y: by + Math.sin(a) * off,
          radius: T.radius * mods.areaMult, duration: T.duration * mods.durationMult,
          damage: scale(T.damage, T.damagePerLevel, level) * mods.damageMult,
          seed: Math.random() * 10, delay: i * 0.12, mods,
        });
      }
      world.playSfx('iceNova');
    },
  },

  entropy: {
    category: 'status',
    voidLine: true,
    name: 'Entropy', color: '#a05fe0', designLevel: 5,
    desc: 'Stacks the void on everything near you. At three stacks a foe collapses, whatever its health.',
    cooldownBase: 2.4,
    icon: 'entropy',
    tune: { cooldown: 2, damage: 12, damagePerLevel: 3, radius: 315, stacksToCollapse: 3 },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.entropy.tune;
      const dmg = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      const radius = T.radius * mods.areaMult;
      // The Marked's seal ripens a mark early: two stacks where anyone else needs three.
      const need = Math.max(1, Math.round(T.stacksToCollapse) - (player.sealBearer ? 1 : 0));
      let any = false;
      for (const e of world.enemiesInRange(player.x, player.y, radius)) {
        any = true;
        world.damageEnemy(e, dmg, mods, {});
        if (e.dead) continue;
        // The mark is the weapon, not the damage. Three applications and the thing collapses
        // outright — which is the first rule in the game that ignores a health bar entirely,
        // and the reason Entropy is worth casting into something you cannot out-damage.
        e.entropyStacks = (e.entropyStacks || 0) + 1;
        world.markVoid(e);
        if (e.entropyStacks >= need) {
          e.entropyStacks = 0;
          world.collapse(e);
        }
      }
      world.spawnEffect({ kind: 'ring', x: player.x, y: player.y, radius,
        color: '#a05fe0', duration: 0.3, mods });
      if (any) world.playSfx('iceShard');
    },
  },

  hollowecho: {
    category: 'minion',
    voidLine: true,
    name: 'Hollow Echo', color: '#7a56d2', designLevel: 5,
    desc: 'Calls up shades of the recently slain. They fight for a while, then come apart.',
    cooldownBase: 6,
    icon: 'shade',
    tune: { cooldown: 5.5, shadeHp: 30, shadeHpPerLevel: 6, shadeDamage: 9,
      shadeDamagePerLevel: 3, shadeSpeed: 240, shadeLife: 9, shadeAtkCd: 0.7 },
    minionCap(level, mods) { return Math.min(2 + Math.floor(level / 3), 6) + mods.projectileBonus; },
    cast(ctx) {
      const { player, level, mods, world, skill } = ctx;
      const T = SKILLS.hollowecho.tune;
      const want = SKILLS.hollowecho.minionCap(level, mods);
      const missing = want - world.countMinions('shade');
      if (missing <= 0) return;
      const hp = T.shadeHp + level * T.shadeHpPerLevel;
      for (let i = 0; i < missing; i++) {
        world.spawnMinion({
          type: 'shade', x: player.x + (Math.random() - 0.5) * 60,
          y: player.y + (Math.random() - 0.5) * 60,
          hp, maxHp: hp,
          damage: (T.shadeDamage + level * T.shadeDamagePerLevel) * mods.damageMult,
          speed: T.shadeSpeed, atkRange: 30, atkCd: T.shadeAtkCd,
          // Shades EXPIRE rather than reviving. A skeleton is a standing retinue you keep; a
          // shade is a borrowed body that the void takes back, which is what stops this being
          // a second Summon Skeleton with different art.
          life: T.shadeLife * mods.durationMult,
          skillRef: skill, state: 'dash', atkTimer: 0,
        });
      }
      world.playSfx('skeletonMinion');
    },
  },

  // ---------- Mobility (the dash slot) ----------
  // Neither of these has a cast(): they fire from tryDash() in main.js when the dodge button
  // is pressed, off their own charge clock. Two skills is few enough that tryDash switches on
  // the id directly; a third mobility skill is the point to introduce a dash(ctx) contract.

  dodgeroll: {
    category: 'mobility',
    name: 'Dodge Roll', color: '#cdd3dd', designLevel: 1,
    desc: 'A quick burst of speed through the crowd. The step everyone is born knowing.',
    icon: 'roll',
    // Its numbers live in the DASH block (classes.js) where the dev sliders have always been —
    // this entry exists so the slot has a real occupant with a card, a name and an icon.
    tune: {},
  },

  voidstep: {
    category: 'mobility',
    voidLine: true,
    name: 'Void Step', color: '#7a56d2', designLevel: 5,
    desc: 'Stop being here; be there instead. Everything you pass through is marked by the void.',
    icon: 'blink',
    tune: { charges: 2, cooldown: 2.6, distance: 175, grace: 0.25, markWidth: 40 },
  },

  nullward: {
    category: 'ward',
    voidLine: true,
    name: 'Nullward', color: '#4f3fa8', designLevel: 5,
    desc: 'A rift orbits you, DRAGGING enemy shots out of the air. Once full, it collapses on the nearest foe.',
    cooldownBase: 8,
    icon: 'ward',
    tune: { cooldown: 7.5, damage: 40, damagePerLevel: 16, duration: 8, orbitRadius: 62,
      eatRadius: 30, pullRadius: 260, capacity: 5, collapseRadius: 170 },
    cast(ctx) {
      const { player, level, mods, world, skill } = ctx;
      const T = SKILLS.nullward.tune;
      // ONE effect owning every mouth, so the count can be recomputed live (baseCount, below)
      // the way Ninja Stars does — a Quantity tome adds a mouth to the ward already spinning
      // rather than waiting for the next cast. Spawning N separate effects could not do that.
      //
      // The standing ward is REFRESHED, not rebuilt. It holds its swallowed shots until it is
      // full, so replacing it every cooldown reset the count to zero and the ward could never
      // reach capacity — the same progress loss the old expiry timer caused. `eaten`, the live
      // mouth positions and the effect's own clock survive; only the tuned numbers are updated.
      world.refreshEffect('nullward', {
        kind: 'nullward', follow: true, x: player.x, y: player.y, skillRef: skill,
        // Kept for the effect record's sake; nullward opts out of timed expiry and lives until
        // it fills (see updateEffect).
        duration: T.duration * mods.durationMult,
        baseCount: 1,
        count: 1 + mods.projectileBonus,
        orbitRadius: T.orbitRadius * mods.sizeMult,
        eatRadius: T.eatRadius * mods.sizeMult,
        // The reach of the ward's gravity — area scales it, so +area makes the ward cover
        // more of the screen rather than just swallowing from marginally further out.
        pullRadius: T.pullRadius * mods.areaMult,
        collapseRadius: T.collapseRadius * mods.areaMult,
        capacity: Math.max(1, Math.round(T.capacity)),
        eaten: 0, phase: Math.random() * Math.PI * 2,
        damage: scale(T.damage, T.damagePerLevel, level) * mods.damageMult,
        color: '#4f3fa8', mods,
        // What a refresh must NOT overwrite: the charge it has built, the orbit it is part-way
        // through, and its live mouth positions.
      }, ['eaten', 'phase', 'mouths']);
      world.playSfx('iceNova');
    },
  },

  // The second ward, and the only skill in the game that PUSHES.
  //
  // Built to fill a hole Electro Fingers was covering alone. It is the one skill whose duration
  // exceeds its cooldown, so it is the one skill that is never off — every other "area" gem
  // pulses, and a pulse cannot hold a line. Ice Nova is instant, Gravepull is instant and pulls
  // the wrong way, Flame Walk only covers ground you have already left, and the Maw drifts away
  // from you. So the horde could be damaged constantly but never actually kept OFF you.
  //
  // Salt Circle is the inverse of Gravepull: continuous outward force on everything inside,
  // rather than one hard yank inward.
  //
  // IT LEVELS INTO ITS UPTIME. `duration` starts BELOW `cooldown`, so at level 1 the ring
  // guts out between casts and the horde gets a moment to close; each level extends it, and at
  // level 5 it finally covers the gap and becomes the permanent zone of control it is for. The
  // measured ladder is 76% / 82% / 88% / 94% / 100% uptime — every level buys real uptime and
  // NONE of them is dead, because permanence lands exactly on the last one instead of part way
  // up with the remainder spent on duration the cooldown does not need. Haste and Duration tomes
  // both reach it sooner, which is the reward for building toward the gem rather than past it.
  // That is the whole progression — the gem does not hit harder, it holds LONGER — which
  // is the honest way to level a skill whose value was never its damage. Duration tomes stack
  // on top and buy the same thing, which is why 'duration' is in its upgrade affinities.
  //
  // WHAT KEEPS IT HONEST: the force is a BUDGET shared by everyone standing in it, divided by
  // count^crowdFalloff. One body gets hurled; a deep-endless wall of them gets a shove. So it
  // reads as a wall early and visibly grinds thin later, which is the counterplay a 100%-uptime
  // control skill has to have — and it degrades on its own rather than through a nerf lever.
  //
  // And it pays for itself the way the ward category demands: holding the crowd back IS the
  // charge. Every body-second it pushes fills the ring, and a full ring discharges into damage.
  // The more it is asked to hold, the faster it answers.
  saltcircle: {
    category: 'ward',
    name: 'Salt Circle', color: '#c9bfa8', designLevel: 5,
    desc: 'A ring of salt you carry. Shoves the dead back out — its strength is SHARED, so a crowd grinds it thin. Each level holds the ring longer.',
    cooldownBase: 6,
    icon: 'saltcircle',
    tune: {
      // The pair that IS the progression: duration starts under the cooldown and grows past it,
      // so uptime is what a level buys. At 3.8 + 0.3/level the last level lands duration EXACTLY
      // on the cooldown, so every level buys real uptime and permanence is what maxing it pays.
      // Landing on the boundary is safe: casts run before effect expiry in the frame (see the
      // skill loop vs the effect loop in main.js), so the recast renews t before `t >= duration`
      // is ever tested. Cut the cooldown below 5 and this stops being a knife-edge at all.
      cooldown: 5, duration: 3.8, durationPerLevel: 0.3,
      radius: 165,
      // Push in px/sec applied to a LONE enemy. Everyone inside shares it.
      force: 620,
      // 0 = no sharing (full force each), 1 = strict division, 0.5 = square root. The dial that
      // decides whether this is a wall or a nuisance in deep waves.
      crowdFalloff: 0.5,
      // Body-seconds of pushing per point of charge, and what a full ring is worth.
      chargeCap: 26,
      // damagePerLevel is 0, not absent. Levels go into duration, not damage — but the KEY has
      // to exist, because the cast reads it through scale() and `34 + undefined * (level-1)` is
      // NaN. That NaN reached the player: the discharge fed damageEnemy, life leech multiplied
      // it into player health, and the HUD read "NaN / 126". A dial sitting at zero states the
      // intent and cannot rot; a missing key is a landmine. Damage stats and tomes still
      // multiply the discharge through mods.damageMult, so a damage build is not locked out.
      damage: 34, damagePerLevel: 0,
      // The discharge reaches past the ring itself, so it clears the rim it has been holding.
      burstRadiusPct: 135,
      burstKnockback: 190,
    },
    cast(ctx) {
      const { player, level, mods, world, skill } = ctx;
      const T = SKILLS.saltcircle.tune;
      // REFRESHED, not respawned — the same lesson Nullward learned. Recasting every cooldown
      // would reset the charge it has built, so the ring could never reach a discharge and the
      // half of the skill that pays for the ward would simply never fire.
      world.refreshEffect('saltcircle', {
        kind: 'saltcircle', follow: true, x: player.x, y: player.y, skillRef: skill,
        duration: scale(T.duration, T.durationPerLevel, level) * mods.durationMult,
        // Renews the CLOCK, not just the numbers. refreshEffect copies fields onto the live
        // effect and expiry is `fx.t >= fx.duration`, so without this the ring kept ageing
        // through every refresh and died on the timer set by its FIRST cast — it went dark for
        // seconds at a time and came back with its charge wiped. Resetting t here is what makes
        // `duration` mean "how long the ring lasts after a cast", which is the only reading
        // under which levelling it does anything.
        t: 0,
        radius: T.radius * mods.areaMult,
        force: T.force,
        crowdFalloff: T.crowdFalloff,
        chargeCap: Math.max(1, T.chargeCap),
        charge: 0,
        damage: scale(T.damage, T.damagePerLevel, level) * mods.damageMult,
        burstRadius: T.radius * mods.areaMult * (T.burstRadiusPct / 100),
        burstKnockback: T.burstKnockback,
        color: '#c9bfa8', mods,
      }, ['charge', 'flash']);
      world.playSfx('iceNova');
    },
  },
};

// Two baselines. SHIPPED never changes — it's the values compiled into this build, and what
// "Reset All" returns to. TUNE_DEFAULTS is the working baseline a per-skill Reset returns to,
// which Save overwrites so a dialled-in skill can be reverted to your saved numbers rather
// than all the way back to shipped.
const snapshot = () => Object.fromEntries(
  Object.entries(SKILLS).map(([id, def]) => [id, { ...(def.tune || {}) }])
);
const SHIPPED_TUNES = snapshot();
const TUNE_DEFAULTS = snapshot();

export function tuneDefaults(id) { return { ...(TUNE_DEFAULTS[id] || {}) }; }

// Promotes a skill's current values to be its defaults, so Reset returns here rather than to
// the shipped numbers. Returns the saved block for persisting.
export function saveTune(id) {
  if (!SKILLS[id] || !SKILLS[id].tune) return null;
  TUNE_DEFAULTS[id] = { ...SKILLS[id].tune };
  return { ...TUNE_DEFAULTS[id] };
}

// Applies stored overrides on boot. Unknown skills and keys are ignored so a saved file from
// an older build can't inject stale parameters into a skill that has since changed.
export function applyStoredTunes(stored) {
  if (!stored) return;
  for (const [id, vals] of Object.entries(stored)) {
    const def = SKILLS[id];
    if (!def || !def.tune) continue;
    for (const [k, v] of Object.entries(vals)) {
      if (k in def.tune && typeof v === 'number' && Number.isFinite(v)) {
        def.tune[k] = v;
        TUNE_DEFAULTS[id][k] = v;
      }
    }
  }
}
export function resetTune(id) {
  if (!SKILLS[id] || !SKILLS[id].tune) return;
  Object.assign(SKILLS[id].tune, TUNE_DEFAULTS[id]);
}
// Back to what THIS BUILD shipped for one skill, ignoring anything saved over it.
//
// Distinct from resetTune, which returns to TUNE_DEFAULTS — and applyStoredTunes overwrites
// those with the stored values at boot, so after a save resetTune returns you to your own
// numbers and appears to do nothing. That is the right behaviour for "undo my last fiddling",
// but not for the Reset button, which is meant to undo the saving too.
export function resetTuneToShipped(id) {
  if (!SKILLS[id] || !SKILLS[id].tune) return;
  Object.assign(SKILLS[id].tune, SHIPPED_TUNES[id]);
  TUNE_DEFAULTS[id] = { ...SHIPPED_TUNES[id] };
}
// Back to the values this build shipped with, discarding anything saved.
export function resetAllTunes() {
  for (const id of Object.keys(SKILLS)) {
    if (!SKILLS[id].tune) continue;
    Object.assign(SKILLS[id].tune, SHIPPED_TUNES[id]);
    TUNE_DEFAULTS[id] = { ...SHIPPED_TUNES[id] };
  }
}

// Cooldown is tunable, so everything that needs it must read the live value rather than the
// static cooldownBase field.
export function skillCooldown(id) {
  const def = SKILLS[id];
  return (def && def.tune && def.tune.cooldown) || (def && def.cooldownBase) || 1;
}

// ---------- Tiered skill-gem upgrades ----------
// Levelling a gem now rolls a rarity, mirroring the chest/relic tiers. Rarer upgrades give
// a bigger damage step, and from Epic upward start adding projectiles and elemental
// infusions — so a Legendary level-up on a favourite skill is a genuine event.
// Every level-up card — SKILL, TOME and STAT UP alike — rolls one of these tiers.
//   dmg/proj/infuse : what a SKILL upgrade grants
//   sup             : how many levels a TOME grants (range, inclusive)
//   stat            : multiplier range applied to a STAT UP's base value
export const UPGRADE_TIERS = [
  { id: 'common',    name: 'Common',    color: '#9098a4', dmg: 0.12, proj: 0, infuse: false, sup: [1, 1], stat: [1.0, 1.15] , minProg: 0 },
  { id: 'rare',      name: 'Rare',      color: '#4a6fa5', dmg: 0.22, proj: 0, infuse: false, sup: [1, 2], stat: [1.3, 1.5] , minProg: 0 },
  { id: 'epic',      name: 'Epic',      color: '#9a4fbf', dmg: 0.35, proj: 1, infuse: false, sup: [2, 3], stat: [1.7, 2.0] , minProg: 0.20 },
  { id: 'legendary', name: 'Legendary', color: '#e0a033', dmg: 0.55, proj: 1, infuse: true,  sup: [3, 4], stat: [2.3, 2.7] , minProg: 0.45 },
  { id: 'unique',    name: 'Unique',    color: '#d94a2f', dmg: 0.80, proj: 2, infuse: true,  sup: [4, 6], stat: [3.2, 3.8] , minProg: 0.70 },
];

/* GENERATED: level-up roll tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole
   block from tuning/entity-tuning.json under the `upgrades` domain. */
export const UPGRADE_ROLL_TUNE = {
  luckExp: 1.4,
};
/* END GENERATED */

/**
 * How often each tier turns up on a level-up card, and how hard the Rarity stat pushes.
 *
 * These were literals on the tiers above, which made the most-felt randomness in the game the
 * one thing not tunable — and they were wildly generous. At +22% Rarity a player saw an Epic or
 * better on **44% of level-ups**, because the weights were multiplied by `luck ^ tierIndex`:
 * a 22% stat became a 122% boost to Unique (1.22⁴) while Common got nothing. Compounding by
 * tier index is the right IDEA — rarity should favour the top end — but the exponent has to be
 * gentle or the stat outruns the ladder it is climbing.
 *
 * Retuned to ~15% for any Epic-or-better across the three cards at baseline, rising to ~20% at
 * +22% Rarity and ~25% at +50%. Rarity still matters and still visibly pays; it no longer makes
 * the tiers meaningless.
 *
 * `luckExp` is the softening: weight scales by `luck ^ (tierIndex * luckExp)`. At 1 it is the
 * old runaway behaviour, at 0 rarity stops biasing the roll entirely, and 0.7 sits where the
 * stat is worth stacking without flattening the ladder.
 */
export const UPGRADE_ROLL = {
  // Five hand-set weights became two dials on the SAME shaper every other curve in the game
  // uses — the difficulty ramp, the gold curves, the tome growth, the loot value ladder. They
  // were the last set of magic numbers not driven by a shape, which meant tuning them was five
  // values held against each other by eye with no way to say "make the top end rarer" in one
  // move.
  //
  //   weight(i) = end ^ -( (i / lastTier) ^ bend )
  //
  // Common is 1 by construction; `end` is how much rarer a Unique is than a Common; `bend`
  // decides WHERE the falloff bites — above 1 keeps the low tiers close together and saves the
  // collapse for the top, below 1 drops away immediately. Exactly the reading of `end`/`bend`
  // everywhere else, which is the point of reusing the form.
  end: 1200, bend: 1.45,
  luckExp: 0.7,
  ...UPGRADE_ROLL_TUNE,
};

/** How the dev panel presents the level-up roll. */
export const UPGRADE_ROLL_TUNE_META = {
  end:     { label: 'Unique Rarity',  min: 2, max: 5000, step: 10, unit: ':1' },
  bend:    { label: 'Falloff Bend',   min: 0.2, max: 3,  step: 0.05 },
  luckExp: { label: 'Rarity Push',    min: 0, max: 1.5,  step: 0.05, unit: '^' },
};
export const UPGRADE_ROLL_KEYS = Object.keys(UPGRADE_ROLL_TUNE_META);

/** Base weight for a tier index, straight off the shaper. Common is always 1. */
function tierWeight(i, last) {
  if (i <= 0) return 1;
  const end = Math.max(1.0001, UPGRADE_ROLL.end);
  return Math.pow(end, -Math.pow(i / last, Math.max(0.05, UPGRADE_ROLL.bend)));
}

/**
 * Odds of each tier for a given Rarity stat and run progress — the same arithmetic the roll
 * itself uses, exposed so the dev panel can show what the dials actually do rather than leaving
 * five relative weights to be interpreted by eye.
 * @param {number} luck @param {number} progress
 * @returns {{ tier: typeof UPGRADE_TIERS[number], p: number }[]}
 */
export function upgradeTierOdds(luck = 1, progress = 1) {
  const eff = progress + (luck - 1) * 0.5;
  const last = UPGRADE_TIERS.length - 1;
  const w = UPGRADE_TIERS.map((t, i) => {
    const gate = t.minProg ? Math.max(0, Math.min(1, (eff - t.minProg) / TIER_RAMP)) : 1;
    return tierWeight(i, last) * Math.pow(luck, i * UPGRADE_ROLL.luckExp) * gate;
  });
  const total = w.reduce((s, x) => s + x, 0);
  return UPGRADE_TIERS.map((t, i) => ({ tier: t, p: total > 0 ? w[i] / total : (i === 0 ? 1 : 0) }));
}

// Elemental infusions ride along on every hit the infused skill lands.
export const INFUSIONS = {
  frost:  { name: 'Frost',  color: '#8fd0e8', desc: 'hits chill foes, slowing them' },
  shock:  { name: 'Shock',  color: '#5ac8f0', desc: 'hits arc to a nearby foe' },
  burning:{ name: 'Burning',color: '#e0662f', desc: 'hits set foes ablaze' },
  poison: { name: 'Poison', color: '#9a4fb0', desc: 'hits stack lingering poison' },
  // The one infusion that is not a damage rider. Void marks, and the mark only pays out when the
  // foe DIES — into a collapse that drags the crowd inward. It is crowd SHAPING rather than
  // damage, which is the counterplay the deep endless waves actually need: past wave 12 the
  // problem is not that enemies survive, it is that they arrive spread out faster than any
  // single skill can sweep. A void build answers that by making the horde clump itself.
  void:   { name: 'Void',   color: '#7a56d2', desc: 'marked foes collapse on death, dragging the horde in' },
};
export const INFUSION_IDS = Object.keys(INFUSIONS);

// How long a tier takes to go from just-unlocked to its full weight.
const TIER_RAMP = 0.3;

// `progress` is 0..1 across a run. Each tier above Rare stays locked until progress passes
// its minProg, then fades in — otherwise the flat weights hand out Epic and Legendary rolls
// from the very first level-up, which leaves the tier system with nothing to build toward.
//
// `luck` (the player's Rarity stat) does two jobs: it biases the roll toward higher tiers as
// before, and it also pulls the unlock thresholds forward, so stacking Rarity actually opens
// the good tiers earlier rather than just re-weighting the ones already available.
export function rollUpgradeTier(luck = 1, progress = 1) {
  // Rolls straight off upgradeTierOdds, so the number the dev panel prints and the number the
  // game draws against cannot disagree — the readout IS the distribution.
  const odds = upgradeTierOdds(luck, progress);
  let r = Math.random();
  for (const o of odds) { if ((r -= o.p) < 0) return o.tier; }
  return UPGRADE_TIERS[0];
}

// How many support levels this tier hands out (integer, so the existing per-level maths
// stays clean — no fractional projectile counts).
export function rollSupportLevels(tier) {
  const [lo, hi] = tier.sup;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
// Multiplier applied to a stat node's base value for this tier.
export function rollStatMult(tier) {
  const [lo, hi] = tier.stat;
  return lo + Math.random() * (hi - lo);
}

// ---------- Upgradable skill parameters ----------
// Every skill already reads these from `mods`, so any of them is a valid upgrade target.
// `base` is the value a Common roll grants; rarer tiers scale it up.
export const SKILL_ATTRS = {
  damage:      { key: 'damageMult',      base: 0.12, fmt: (v) => `+${Math.round(v * 100)}% damage` },
};

// The other five — area, duration, haste, pierce, chain — were removed with the multi-roll
// level-up. They live on as CHEST AFFIXES, where a one-off find is the right shape for a stat
// that stops paying past a limit, and where they do not compete with the damage curve for the
// same card slot. `SKILL_UPGRADE_ATTRS` below is kept because it still records which parameters
// each skill would sensibly take, and that is the list to draw from when any of them come back.

// Which parameters each skill can actually roll. Damage is universal and always granted;
// these are the extras that are meaningful for that skill's shape.
const SKILL_UPGRADE_ATTRS = {
  slash:          ['area', 'haste'],
  scythe:         ['area', 'haste'],
  fireball:       ['area', 'pierce', 'haste'],
  quickshot:      ['pierce', 'haste', 'area'],
  icenova:        ['area', 'duration', 'haste'],
  icebomb:        ['area', 'duration', 'haste'],
  iceshards:      ['area', 'duration', 'pierce', 'haste'],
  chainlightning: ['chain', 'area', 'haste'],
  firebeam:       ['area', 'duration', 'haste'],
  skeleton:       ['duration', 'haste'],
  poisonflask:    ['area', 'duration', 'haste'],
  flamewalk:      ['area', 'duration', 'haste'],
  flamethrower:   ['area', 'duration', 'haste'], // area drives both range and cone width
  ninjastars:     ['area', 'duration', 'haste'],
  bonethrow:      ['chain', 'area', 'pierce', 'haste'],
  electrofingers: ['area', 'chain', 'duration', 'haste'],
  // The void line. Wandering Maw and Event Horizon take area and duration because both are
  // collapses whose worth is how much they reach and how long they haul; Unmaking takes
  // duration (more ticks) but not area, since a beam that got wider would stop being single
  // target; Entropy takes area alone, because a longer mark means nothing when three casts
  // detonate it anyway.
  gravepull:      ['area', 'haste'],
  wanderingmaw:   ['area', 'duration', 'haste'],
  unmaking:       ['duration', 'haste'],
  eventhorizon:   ['area', 'duration', 'haste'],
  entropy:        ['area', 'haste'],
  hollowecho:     ['duration', 'haste'],
  nullward:       ['area', 'duration', 'haste'],
  // No 'quantity': there is one ring and a second would be meaningless. Area widens the ground
  // it holds, damage feeds the discharge, and haste shortens the gap it never has anyway.
  // 'duration' rather than 'damage': levels and tomes both buy uptime, which is the whole
  // point of the gem. Damage still helps the discharge, it is just not what it is FOR.
  saltcircle:     ['area', 'duration', 'haste'],
};
for (const [id, attrs] of Object.entries(SKILL_UPGRADE_ATTRS)) {
  if (SKILLS[id]) SKILLS[id].upgrades = attrs;
}

// Rolls the full payload of a SKILL upgrade at a given tier: always a damage step, plus a
// tier-dependent number of extra parameter rolls, projectiles, and (top tiers) an infusion.
/* GENERATED: skill level-up damage tuning. Do not hand-edit — tools/bake-tuning.py rewrites this
   whole block from tuning/entity-tuning.json under the `skillroll` domain. */
export const SKILL_DAMAGE_TUNE = {
  bend: 0.79,
  end: 2.25,
  refLevel: 20,
  vsTome: 0.38,
};
/* END GENERATED */

/**
 * How big a +damage% roll a skill level-up hands out, by tier.
 *
 * It used to be five hand-set numbers on the tiers (0.12 / 0.22 / 0.35 / 0.55 / 0.80) with no
 * relationship to anything else in the game. That is what made the cards feel arbitrary: a
 * Common skill level and a Damage tome level were both "some damage", tuned in different places,
 * and nothing said which was worth more or kept them moving together.
 *
 * Two things fix that.
 *
 * `vsTome` TIES THE SCALE TO THE DAMAGE TOME. A Common roll is defined as this many Damage-tome
 * levels' worth, measured at `refLevel` — so re-tuning the tome moves skill level-ups with it and
 * the two can no longer drift apart. It is one number with a meaning you can say out loud:
 * "levelling a skill is worth 0.63 of a Damage tome level."
 *
 * `end` and `bend` SHAPE THE SPREAD ACROSS TIERS, on the same shaper as everything else — `end`
 * is what a Unique roll is worth against a Common, `bend` decides whether the tiers climb evenly
 * or hold flat and then jump at the top.
 *
 * The defaults reproduce the old five numbers almost exactly (0.12 / 0.22 / 0.35 / 0.54 / 0.80),
 * so this is a change of controls, not of balance.
 */
export const SKILL_DAMAGE = {
  vsTome: 0.63,
  refLevel: 10,
  end: 6.67,
  bend: 0.83,
  ...SKILL_DAMAGE_TUNE,
};

export const SKILL_DAMAGE_TUNE_META = {
  vsTome:   { label: 'vs Damage Tome', min: 0.05, max: 4,  step: 0.01, unit: '×' },
  refLevel: { label: 'Compared at Lv',  min: 1,   max: 20, step: 1 },
  end:      { label: 'Unique vs Common', min: 1,  max: 30, step: 0.05, unit: '×' },
  bend:     { label: 'Tier Bend',       min: 0.2, max: 3,  step: 0.01 },
};
export const SKILL_DAMAGE_KEYS = Object.keys(SKILL_DAMAGE_TUNE_META);

/**
 * What one Damage-tome level is worth at the reference level — the unit skill rolls are priced
 * in. Read live, so dragging the tome's curve moves the skill cards in the same motion.
 */
export function tomeDamageStep() {
  const L = Math.max(1, Math.round(SKILL_DAMAGE.refLevel));
  return Math.max(0.001, tomeMagnitude('addeddamage', L) - tomeMagnitude('addeddamage', L - 1));
}

/** The +damage% a roll of the given tier grants. @param {number} tierIdx */
export function skillDamageRoll(tierIdx) {
  const last = UPGRADE_TIERS.length - 1;
  const base = tomeDamageStep() * SKILL_DAMAGE.vsTome;
  const spread = shapeValue({ end: SKILL_DAMAGE.end, bend: SKILL_DAMAGE.bend, tailAt: last, beyond: 1 },
    Math.max(0, Math.min(last, tierIdx)));
  return +(base * spread).toFixed(4);
}

/**
 * A skill level-up grants ONE thing: a damage percentage.
 *
 * Area, duration, haste, pierce, chain and the projectile grants are all gone from this path.
 * Two reasons, and the second is the one that mattered. Cooldown and pierce STOP DOING ANYTHING
 * past a limit — cooldown is floored, pierce runs out of things to pass through — so rolling
 * them handed out cards that were silently worth nothing, and cooldown in particular collided
 * with the Swiftness tome and the cooldown affix, three sources fighting over one clamped stat.
 * And with six things on the table, no single one could be shaped: the damage distribution was
 * impossible to reason about while five other rolls moved with it.
 *
 * Only stats that can inflate without limit belong here. Damage is the one that qualifies, so it
 * is the only one left until its curve is settled.
 *
 * Infusions stay. They are not a stat roll — they change what a skill DOES rather than scaling a
 * number, they are the Legendary/Unique payoff, and they do not interfere with shaping damage.
 */
/**
 * @param {*} tier @param {*} skillDef
 * @param {string[]|string|null} held infusions this skill already carries
 *
 * `held` is a LIST now. Infusions stack rather than replace, so a roll must exclude everything
 * the skill already has — otherwise the pool keeps offering duplicates of what you hold, and
 * before stacking existed it could hand you Poison and silently delete your Void.
 * A string is still accepted so an in-flight save or an older caller does not break.
 */
export function rollSkillUpgrade(tier, skillDef, held) {
  const tierIdx = UPGRADE_TIERS.indexOf(tier);
  const rolls = [{ attr: 'damage', value: skillDamageRoll(tierIdx) }];
  const have = Array.isArray(held) ? held : (held ? [held] : []);
  let infusion = null;
  if (tier.infuse) {
    const fresh = INFUSION_IDS.filter((i) => !have.includes(i));
    // Every element already held: no infusion on this card rather than a wasted duplicate.
    infusion = fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : null;
  }
  return { rolls, proj: 0, infusion };
}

/**
 * Per-shot timing and aim jitter for a volley. EVERY skill that spawns more than one projectile
 * from one cast should route its loop through this.
 *
 * Two problems it solves, both caused by firing the whole volley on one frame at exact angles:
 * a Quantity stack came out as a single rigid pulse, and the extra projectiles formed a perfect
 * even fan — a semicircle of evenly spaced dots that reads as a UI element rather than a burst
 * of shots. Spacing them in TIME makes the volley something you watch arrive, and jittering the
 * angle makes it look thrown rather than plotted.
 *
 * The delay is drawn at RANDOM across the volley's window, not spaced evenly by index. Even
 * spacing is a metronome: it trades one mechanical pattern (all at once) for another (a perfect
 * tick-tick-tick), and at any real projectile count it reads as a machine rather than a burst.
 * A random draw lets shots bunch and gap the way a handful of thrown things actually does.
 *
 * The window is `stagger * (count - 1)`, so the dial still means "roughly this long between
 * shots" and the whole volley still lands in about the same time as an evenly spaced one.
 *
 * @param {*} T the skill's tune block; reads `stagger` (seconds per shot) and `jitterDeg`
 * @param {number} i index of this shot in the volley — kept so shot 0 can stay instant
 * @param {number} count how many shots this volley fires
 * @returns {{ delay: number, jitter: number }} pass `delay` straight into spawnProjectile
 */
export function volleyShot(T, i, count = 1, cdNow) {
  let stagger = T.stagger === undefined ? 0 : T.stagger;
  // The stagger is authored against the SHIPPED cooldown, and it does not shrink on its own:
  // stack enough cooldown reduction and the volley window outgrows the cooldown itself, so the
  // next cast begins before the last volley has finished leaving — every volley skill melts
  // into one continuous stream and the rhythm that makes a volley read as a volley is gone.
  // Clamped so the whole window fits inside 45% of the LIVE cooldown: however hasted the build
  // gets, more than half of every cycle is silence, and a volley stays a burst.
  if (cdNow !== undefined && count > 1) {
    stagger = Math.min(stagger, (cdNow * 0.45) / (count - 1));
  }
  const jitter = T.jitterDeg === undefined ? 0 : T.jitterDeg;
  // The first shot always fires immediately. Casting a skill and seeing NOTHING for 40ms reads
  // as input lag, however good the rest of the volley looks.
  const window = Math.max(0, (count - 1)) * stagger;
  // `staggerEven` blends between the two, rather than forcing one rule on every skill. Chain
  // Lightning wants the metronome — a rising ladder of bolts reads as a building charge, and the
  // regularity IS the effect. A shotgun of arrows wants the opposite. 1 is a perfect ladder,
  // 0 is a free-for-all, and anything between is a loose rhythm.
  const even = T.staggerEven === undefined ? 0 : T.staggerEven;
  const delay = i === 0 ? 0 : (i * stagger) * even + (Math.random() * window) * (1 - even);
  return {
    delay,
    jitter: ((Math.random() - 0.5) * jitter * Math.PI) / 180,
  };
}

export const SKILL_ORDER = ['slash', 'scythe', 'fireball', 'quickshot', 'icenova', 'icebomb', 'iceshards', 'chainlightning', 'firebeam', 'electrofingers', 'skeleton', 'poisonflask', 'flamewalk', 'flamethrower', 'ninjastars', 'bonethrow',
  'gravepull', 'wanderingmaw', 'unmaking', 'eventhorizon', 'entropy', 'hollowecho', 'nullward', 'saltcircle'];

// ---------- approximate DPS ----------
// Single-target DPS: damage one enemy takes if it stays in range/contact for the whole
// effect. Defined the same way for every skill, so the numbers are comparable across gems.
// Extra projectiles deliberately do NOT inflate this — they hit *more* enemies rather than
// hitting one enemy harder, so they're reported separately as a target count.
//
// These formulas mirror the damage math inside each cast() above. Keep them in sync.
const DPS_MODELS = {
  slash:          (L, m) => ({ burst: scale(20, 6, L) }),
  scythe:         (L, m) => ({ burst: scale(26, 8, L) }),
  fireball:       (L, m) => ({ burst: scale(24, 7, L), targets: 1 + m.projectileBonus }),
  quickshot:      (L, m) => ({ burst: scale(20, 6, L), targets: 1 + m.projectileBonus }),
  icenova:        (L, m) => ({ burst: scale(24, 8, L) }),
  // One charge's blast against one body. The volley hits MORE enemies, not one enemy harder, so
  // the extra charges are reported as a target count the way every other multi-shot skill is.
  icebomb:        (L, m) => ({ burst: scale(26, 9, L), targets: 3 + m.projectileBonus }),
  iceshards:      ()     => ({ burst: 0, control: true }), // deals no HP damage — pure freeze buildup
  chainlightning: (L, m) => ({ burst: scale(15, 5, L), targets: (1 + m.projectileBonus) * (3 + m.chainBonus) }),
  bonethrow:      (L, m) => ({ burst: scale(16, 5, L), targets: (1 + m.projectileBonus) * (3 + m.chainBonus) }),
  // Minions attack on their own timer, independent of the summon cooldown.
  // Cycle = rest (scales with cooldown mods) + retreat + approach.
  skeleton:       (L, m) => ({ flat: (8 + L * 2) * SKELETON_STRIKE_MULT
                    / (Math.max(0.12, 0.8 * m.cooldownMult) + 0.48)
                    * (Math.min(L, 5) + m.projectileBonus) }),
  firebeam:       (L, m) => ({ ticks: [scale(6, 2, L), 0.11, 1.25 * m.durationMult], targets: 1 + m.projectileBonus }),
  flamewalk:      (L, m) => ({ ticks: [scale(6, 2, L), 0.4, 5 * m.durationMult], dot: [scale(4, 1.2, L), 3 * m.durationMult] }),
  ninjastars:     (L, m) => ({ ticks: [scale(9, 3, L), 0.15, 2.6 * m.durationMult] }),
  flamethrower:   (L, m) => ({ ticks: [scale(5, 1.6, L), 0.1, 2], dot: [scale(5, 1.4, L), 3 * m.durationMult] }),
  electrofingers: (L, m) => ({ ticks: [scale(2, 0.64, L), 0.12, 0.85 * m.durationMult], targets: 5 + m.projectileBonus }),
  poisonflask:    (L, m) => ({ dot: [scale(3, 0.9, L), 6 * m.durationMult], targets: 1 + m.projectileBonus }),
  // ---- the void line ----
  gravepull:      (L, m) => ({ burst: scale(26, 8, L) }),
  wanderingmaw:   (L, m) => ({ burst: scale(44, 15, L), targets: 1 + m.projectileBonus }),
  // The flat floor plus the percent bite quoted against a NOMINAL 300-health target: percent
  // damage has no single number, so the estimate names the reference rather than pretending
  // one applies to everything.
  unmaking:       (L, m) => ({ ticks: [scale(6, 2, L) + 300 * scale(4, 0.7, L) / 100, 0.15, 1.2 * m.durationMult], targets: 1 + m.projectileBonus }),
  eventhorizon:   (L, m) => ({ burst: scale(60, 22, L), targets: 1 + m.projectileBonus }),
  entropy:        (L, m) => ({ burst: scale(8, 3, L) }),   // the collapse is the real output
  hollowecho:     (L, m) => ({ flat: (9 + L * 3) / 1.2
                    * (Math.min(2 + Math.floor(L / 3), 6) + m.projectileBonus) }),
  nullward:       ()     => ({ burst: 0, control: true }), // defensive — worth is what it eats
  // The discharge is real damage, but it fires on how hard the ring is being pressed rather
  // than on a clock, so there is no honest per-second figure to quote. Reported as burst plus
  // control, the same way the readout treats every skill whose value is positional.
  saltcircle:     ()     => ({ burst: 34, control: true }),
};

// Returns { dps, targets, control } for one active skill gem.
// `mods` must come from computeMods(player, skill) so per-gem bonuses are included.
export function estimateSkillDps(skill, mods, player) {
  const model = DPS_MODELS[skill.id];
  const def = SKILLS[skill.id];
  if (!model || !def) return { dps: 0, targets: 1 };
  const m = model(skill.level, mods);
  if (m.control) return { dps: 0, targets: 1, control: true };

  // Average crit multiplier, against the SAME cap damageEnemy() rolls against. This was its own
  // hardcoded 0.75, so raising the ceiling anywhere else would have left the DPS estimate quoting
  // the old number.
  const critChance = Math.min(MAX_CRIT_CHANCE, (player?.critChance || 0) + (mods.critChance || 0));
  const critAvg = 1 + critChance * ((player?.critMult || 1) - 1);
  const dmgMult = mods.damageMult * critAvg;

  const cd = Math.max(0.05, skillCooldown(skill.id) * mods.cooldownMult);
  let perCast = 0;
  if (m.burst) perCast += m.burst;
  if (m.ticks) { const [amt, interval, dur] = m.ticks; perCast += amt * Math.max(1, Math.floor(dur / interval)); }
  if (m.dot) { const [dps, dur] = m.dot; perCast += dps * dur; }

  // Minion damage is on its own attack timer, not the summon cooldown.
  const dps = (m.flat || 0) * dmgMult + (perCast * dmgMult) / cd;
  return { dps, targets: Math.round(m.targets || 1), control: false };
}
