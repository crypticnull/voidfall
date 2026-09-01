import { normalize, dist } from './utils.js';

// Each skill gem: id, name, desc, color, maxLevel, cooldownBase (s), tags
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
  life:                 { label: 'Projectile Life',     min: 0.1,  max: 8,    step: 0.05, unit: 's' },
  count:                { label: 'Projectile Count',    min: 1,    max: 30,   step: 1 },
  spreadDeg:            { label: 'Spread',              min: 0,    max: 180,  step: 1,    unit: '°' },
  aoeRadius:            { label: 'Explosion Size',      min: 4,    max: 300,  step: 1 },
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
  frostRadiusPct:       { label: 'Frost Ground Size',   min: 20,   max: 150,  step: 5,    unit: '%' },
  burnDuration:         { label: 'Burn Duration',       min: 0.2,  max: 15,   step: 0.1,  unit: 's' },
  burnDamage:           { label: 'Burn DPS',            min: 0,    max: 60,   step: 0.5 },
  burnDamagePerLevel:   { label: 'Burn DPS / Level',    min: 0,    max: 20,   step: 0.1 },
  poisonDuration:       { label: 'Poison Duration',     min: 0.2,  max: 20,   step: 0.5,  unit: 's' },
  puddleRadius:         { label: 'Puddle Size',         min: 4,    max: 250,  step: 1 },
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
};

export const SKILLS = {
  slash: {
    name: 'Sword Slash', color: '#c47a1f', maxLevel: 5,
    noProjectiles: true, // shape gains nothing from extra projectiles
    desc: 'A wide melee arc in front of you.',
    cooldownBase: 0.65,
    icon: 'sword',
    tune: { cooldown: 0.65, damage: 20, damagePerLevel: 6, radius: 150, arcDeg: 125, knockback: 90 },
    cast(ctx) {
      const { player, level, mods, world, facing } = ctx;
      const T = SKILLS.slash.tune;
      const dmg = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      const radius = T.radius * mods.areaMult;
      const arc = T.arcDeg * Math.PI / 180;
      const fx = facing.x, fy = facing.y;
      const targets = world.enemiesInRange(player.x, player.y, radius);
      let hitAny = false;
      for (const e of targets) {
        const dx = e.x - player.x, dy = e.y - player.y;
        const d = Math.hypot(dx, dy) || 1;
        const dot = (dx / d) * fx + (dy / d) * fy;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (angle <= arc / 2) { world.damageEnemy(e, dmg, mods, { knockback: T.knockback }); hitAny = true; }
      }
      if (hitAny) world.playSfx('slashHit');
      world.spawnEffect({ kind: 'slash', follow: true, x: player.x, y: player.y, radius, angle: arc, dir: Math.atan2(fy, fx), color: '#e8b45a', duration: 0.26 });
    },
  },

  scythe: {
    name: 'Scythe Sweep', color: '#5f7a4a', maxLevel: 5,
    noProjectiles: true, // a swept arc gains nothing from extra projectiles
    desc: 'Sweeps a crescent blade through a half-circle in front of you.',
    cooldownBase: 1.0,
    icon: 'scythe',
    tune: { cooldown: 1.0, damage: 26, damagePerLevel: 8, radius: 165, arcDeg: 180, knockback: 70 },
    cast(ctx) {
      const { player, level, mods, world, facing } = ctx;
      const T = SKILLS.scythe.tune;
      const dmg = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      const radius = T.radius * mods.areaMult;
      const arc = T.arcDeg * Math.PI / 180;
      const fx = facing.x, fy = facing.y;
      let hitAny = false;
      for (const e of world.enemiesInRange(player.x, player.y, radius)) {
        const dx = e.x - player.x, dy = e.y - player.y;
        const d = Math.hypot(dx, dy) || 1;
        const dot = (dx / d) * fx + (dy / d) * fy;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (angle <= arc / 2) { world.damageEnemy(e, dmg, mods, { knockback: T.knockback }); hitAny = true; }
      }
      if (hitAny) world.playSfx('slashHit');
      world.spawnEffect({
        kind: 'scythe', follow: true, x: player.x, y: player.y,
        radius, angle: arc, dir: Math.atan2(fy, fx), color: '#9fd07a', duration: 0.38,
      });
    },
  },

  fireball: {
    name: 'Fireball', color: '#c0421f', maxLevel: 5,
    desc: 'Launches a fireball that explodes on impact.',
    cooldownBase: 0.95,
    icon: 'fireball',
    tune: { cooldown: 0.95, damage: 24, damagePerLevel: 7, speed: 450, projSize: 12, aoeRadius: 69,
      life: 1.8, spreadDeg: 16, forks: 0, childChain: 0, targetRange: 1350 },
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
        const off = (i - (count - 1) / 2) * spread;
        const ang = baseAng + off;
        world.spawnProjectile({
          x: player.x, y: player.y, vx: Math.cos(ang) * T.speed, vy: Math.sin(ang) * T.speed,
          damage: dmg, radius: T.projSize * mods.sizeMult, pierce: mods.pierceBonus, chain: 0, life: T.life,
          forks: T.forks + mods.forkBonus, childChain: T.childChain + mods.chainBonus,
          color: '#c0421f', aoeRadius: T.aoeRadius * mods.areaMult, trail: '#d97a35', mods, isFire: true,
        });
      }
    },
  },

  quickshot: {
    name: 'Quick Shot', color: '#b8a678', maxLevel: 5,
    desc: 'Long-range low-damage arrows at the nearest foe.',
    cooldownBase: 0.8,
    icon: 'arrow',
    tune: { cooldown: 0.8, damage: 20, damagePerLevel: 6, speed: 690, projSize: 6, life: 2.4,
      spreadDeg: 9, forks: 0, childChain: 0, targetRange: 2700 },
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
        const off = (i - (count - 1) / 2) * spread;
        const ang = baseAng + off;
        world.spawnProjectile({
          x: player.x, y: player.y, vx: Math.cos(ang) * T.speed, vy: Math.sin(ang) * T.speed,
          damage: dmg, radius: T.projSize, pierce: mods.pierceBonus, chain: 0, life: T.life,
          forks: T.forks + mods.forkBonus, childChain: T.childChain + mods.chainBonus,
          color: '#b8a678', trail: '#d4c48e', mods, isArrow: true, sizeScale: mods.sizeMult,
        });
      }
    },
  },

  icenova: {
    name: 'Ice Nova', color: '#6f95a8', maxLevel: 5,
    desc: 'Bursts frost around you — damaging, slowing, and leaving frozen ground. +patches per projectile.',
    cooldownBase: 2.4,
    icon: 'nova',
    tune: { cooldown: 2.4, damage: 24, damagePerLevel: 8, radius: 247.5, radiusPerLevel: 33,
      slowDuration: 2, frostDuration: 3, frostRadiusPct: 85, tickInterval: 0.25 },
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
      world.spawnEffect({ kind: 'ring', x: player.x, y: player.y, radius, color: '#6f95a8', duration: 0.35 });
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
    name: 'Ice Shards', color: '#8fd0e8', maxLevel: 5,
    desc: 'A piercing fan of shards that stacks Freeze, locking foes solid in ice.',
    cooldownBase: 1.6,
    icon: 'shard',
    tune: { cooldown: 1.6, count: 6, spreadDeg: 50, speed: 243, life: 3.15, projSize: 6.75, pierce: 3,
      forks: 0, childChain: 0, freeze: 30, freezePerLevel: 20, freezeDuration: 6, targetRange: 1200 },
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
      // Damage powerups pump the hidden (non-damaging) freeze buildup rather than HP damage.
      const freezeAmount = scale(T.freeze, T.freezePerLevel, level) * mods.damageMult;
      const freezeDurationMs = T.freezeDuration * 1000 * mods.durationMult;
      world.playSfx('iceShard');
      for (let i = 0; i < count; i++) {
        const off = count > 1 ? (i / (count - 1) - 0.5) * spread : 0;
        const ang = baseAng + off;
        world.spawnProjectile({
          x: player.x, y: player.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
          damage: 0, radius: T.projSize * mods.sizeMult, pierce: T.pierce + mods.pierceBonus, chain: mods.chainBonus,
          forks: T.forks + mods.forkBonus, childChain: T.childChain + mods.chainBonus,
          life: T.life, color: '#8fd0e8', isIce: true, freezeAmount, freezeDurationMs,
          slowFactor: 0.75, slowDuration: 1200, mods,
        });
      }
    },
  },

  chainlightning: {
    name: 'Lightning Bolt', color: '#4fa8ff', maxLevel: 5,
    desc: 'A bolt that forks on impact, each half arcing between nearby foes.',
    cooldownBase: 1.1,
    icon: 'bolt',
    tune: { cooldown: 1.1, damage: 15, damagePerLevel: 5, speed: 780, projSize: 7.5, life: 1.5,
      spreadDeg: 17, forks: 1, childChain: 2, chainRange: 480, targetRange: 1350 },
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
        const ang = baseAng + (i - (count - 1) / 2) * spread;
        world.spawnProjectile({
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
    name: 'Summon Skeleton', color: '#c9bfa0', maxLevel: 5,
    desc: 'Raises a skeleton that darts in for heavy strikes. +1 skeleton per projectile.',
    cooldownBase: 7,
    icon: 'skull',
    tune: { cooldown: 7, minionCapBase: 5, minionHp: 40, minionHpPerLevel: 12, minionDamage: 8,
      minionDamagePerLevel: 2, minionSpeed: 225, minionAtkCd: 0.8 },
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
    name: 'Solar Ray', color: '#ff7a1f', maxLevel: 5,
    desc: 'Channels a wide, sweeping beam of flame that burns foes in its path.',
    cooldownBase: 5.6,
    icon: 'beam',
    tune: { cooldown: 5.6, damage: 6, damagePerLevel: 2, range: 900, width: 25.5, duration: 1.25, tickInterval: 0.11 },
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
    name: 'Poison Flask', color: '#9a4fb0', maxLevel: 5,
    desc: 'Lobs vials that shatter into pools, stacking a long-lasting poison that spreads on death.',
    cooldownBase: 1.7,
    icon: 'flask',
    tune: { cooldown: 1.7, damage: 3, damagePerLevel: 0.9, speed: 390, puddleRadius: 66,
      puddleDuration: 3, poisonDuration: 6 },
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
        const ang = Math.random() * Math.PI * 2;
        const reach = 110 + Math.random() * 150;
        world.spawnProjectile({
          x: player.x, y: player.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
          damage: 0, radius: 5, life: reach / speed, color: '#9a4fb0', isFlask: true,
          puddleRadius: T.puddleRadius * mods.areaMult, puddleDuration: dur, poisonDps, poisonDur, mods,
        });
      }
    },
  },

  flamewalk: {
    name: 'Flame Walk', color: '#e0662f', maxLevel: 5,
    desc: 'Scorches the ground in your wake and sets foes ablaze with a lingering burn. +patches per projectile.',
    cooldownBase: 1.5,
    icon: 'flame',
    tune: { cooldown: 1.5, damage: 6, damagePerLevel: 2, radius: 90, duration: 5, tickInterval: 0.4,
      burnDamage: 4, burnDamagePerLevel: 1.2, burnDuration: 3 },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.flamewalk.tune;
      const count = 1 + mods.projectileBonus;
      const dmgPerTick = scale(T.damage, T.damagePerLevel, level) * mods.damageMult;
      const dur = T.duration * mods.durationMult;
      const radius = T.radius * mods.areaMult * mods.sizeMult;
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
    name: 'Bone Throw', color: '#cfc4a8', maxLevel: 5,
    desc: 'Hurls a bone on a curving arc that ricochets between nearby foes.',
    cooldownBase: 0.78, // +20% from 0.65
    icon: 'bone',
    tune: { cooldown: 0.78, damage: 16, damagePerLevel: 5, speed: 600, projSize: 10.5, life: 1.6,
      chain: 2, forks: 0, childChain: 2, chainRange: 345, targetRange: 1080 },
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
      for (let i = 0; i < count; i++) {
        // Each bone launches off to one side and curves back in, so it flies a visible arc
        // rather than a straight line. Alternating the lean fans multiple bones apart.
        const lean = (i % 2 === 0 ? 1 : -1) * (0.42 + i * 0.05);
        const ang = baseAng + lean;
        world.spawnProjectile({
          x: player.x, y: player.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
          damage: dmg, radius: T.projSize * mods.sizeMult, pierce: mods.pierceBonus,
          chain: T.chain + mods.chainBonus, chainRange: T.chainRange,
          forks: T.forks + mods.forkBonus, childChain: T.childChain + mods.chainBonus,
          // Unwinds the launch lean and keeps turning, so the arc converges back onto the
          // line of fire around ~300px out rather than drifting wide of the target.
          curve: -lean * 5.5,
          life: T.life, color: '#cfc4a8', isBone: true, sizeScale: mods.sizeMult, mods,
        });
      }
    },
  },

  ninjastars: {
    name: 'Ninja Stars', color: '#a8b4c2', maxLevel: 5,
    desc: 'A ring of whirling shuriken that pulses out and back around you.',
    cooldownBase: 3.4,
    icon: 'star',
    tune: { cooldown: 3.4, damage: 9, damagePerLevel: 3, duration: 2.6, count: 5, maxRadius: 144,
      innerRadius: 39, pulsePeriod: 1, spin: 3.2, starRadius: 20.25, tickInterval: 0.15 },
    cast(ctx) {
      const { player, level, mods, world, skill } = ctx;
      const T = SKILLS.ninjastars.tune;
      world.playSfx('quickshot');
      world.spawnEffect({
        kind: 'ninjastars', follow: true, x: player.x, y: player.y, skillRef: skill,
        duration: T.duration * mods.durationMult,
        baseCount: T.count,                                  // recomputed live in updateEffect...
        count: T.count + mods.projectileBonus,               // ...so +projectile gems apply mid-spin
        maxRadius: T.maxRadius * mods.areaMult * mods.sizeMult,
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
    name: 'Flamethrower', color: '#ff6a1f', maxLevel: 5,
    noProjectiles: true, // shape gains nothing from extra projectiles
    desc: 'Sprays a sustained cone of fire that sets foes ablaze.',
    cooldownBase: 3.8, // flame duration, then the remainder as cooldown
    icon: 'flamestream',
    tune: { cooldown: 3.8, damage: 5, damagePerLevel: 1.6, range: 409.5, coneDeg: 25, duration: 2,
      tickInterval: 0.1, burnDamage: 5, burnDamagePerLevel: 1.4, burnDuration: 3 },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.flamethrower.tune;
      const range = T.range * mods.areaMult;                        // range grows with the Scale tome
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
    name: 'Electro Fingers', color: '#5ac8f0', maxLevel: 5,
    desc: 'Tethers crackling lightning to several nearby foes at once.',
    cooldownBase: 0.9,
    icon: 'spark',
    tune: { cooldown: 0.9, damage: 2, damagePerLevel: 0.64, range: 510, maxTargets: 5,
      forks: 0, duration: 0.85, tickInterval: 0.12 },
    cast(ctx) {
      const { player, level, mods, world } = ctx;
      const T = SKILLS.electrofingers.tune;
      if (!world.findNearest(player.x, player.y, T.range)) return;
      world.playSfx('electroFingers');
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
  { id: 'common',    name: 'Common',    color: '#9098a4', weight: 50, dmg: 0.12, proj: 0, infuse: false, sup: [1, 1], stat: [1.0, 1.15] , minProg: 0 },
  { id: 'rare',      name: 'Rare',      color: '#4a6fa5', weight: 28, dmg: 0.22, proj: 0, infuse: false, sup: [1, 2], stat: [1.3, 1.5] , minProg: 0 },
  { id: 'epic',      name: 'Epic',      color: '#9a4fbf', weight: 7, dmg: 0.35, proj: 1, infuse: false, sup: [2, 3], stat: [1.7, 2.0] , minProg: 0.20 },
  { id: 'legendary', name: 'Legendary', color: '#e0a033', weight: 3,  dmg: 0.55, proj: 1, infuse: true,  sup: [3, 4], stat: [2.3, 2.7] , minProg: 0.45 },
  { id: 'unique',    name: 'Unique',    color: '#d94a2f', weight: 1,  dmg: 0.80, proj: 2, infuse: true,  sup: [4, 6], stat: [3.2, 3.8] , minProg: 0.70 },
];

// Elemental infusions ride along on every hit the infused skill lands.
export const INFUSIONS = {
  frost:  { name: 'Frost',  color: '#8fd0e8', desc: 'hits chill foes, slowing them' },
  shock:  { name: 'Shock',  color: '#5ac8f0', desc: 'hits arc to a nearby foe' },
  burning:{ name: 'Burning',color: '#e0662f', desc: 'hits set foes ablaze' },
  poison: { name: 'Poison', color: '#9a4fb0', desc: 'hits stack lingering poison' },
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
  const eff = progress + (luck - 1) * 0.5;
  const weighted = UPGRADE_TIERS.map((t, i) => {
    const gate = t.minProg ? Math.max(0, Math.min(1, (eff - t.minProg) / TIER_RAMP)) : 1;
    return { t, w: t.weight * Math.pow(luck, i) * gate };
  });
  const total = weighted.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return UPGRADE_TIERS[0];
  let r = Math.random() * total;
  for (const x of weighted) { if ((r -= x.w) < 0) return x.t; }
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
  area:        { key: 'areaMult',        base: 0.15, fmt: (v) => `+${Math.round(v * 100)}% area & range` },
  size:        { key: 'sizeMult',        base: 0.15, fmt: (v) => `+${Math.round(v * 100)}% effect size` },
  duration:    { key: 'durationMult',    base: 0.15, fmt: (v) => `+${Math.round(v * 100)}% duration` },
  haste:       { key: 'cooldownMult',    base: 0.08, fmt: (v) => `-${Math.round(v * 100)}% cooldown` },
  pierce:      { key: 'pierceBonus',     base: 1, int: true, fmt: (v) => `+${v} pierce` },
  chain:       { key: 'chainBonus',      base: 1, int: true, fmt: (v) => `+${v} chain` },
};

// Which parameters each skill can actually roll. Damage is universal and always granted;
// these are the extras that are meaningful for that skill's shape.
const SKILL_UPGRADE_ATTRS = {
  slash:          ['area', 'size', 'haste'],
  scythe:         ['area', 'size', 'haste'],
  fireball:       ['area', 'pierce', 'haste'],
  quickshot:      ['pierce', 'haste', 'size'],
  icenova:        ['area', 'duration', 'haste'],
  iceshards:      ['area', 'duration', 'pierce', 'haste'],
  chainlightning: ['chain', 'area', 'haste'],
  firebeam:       ['area', 'duration', 'size', 'haste'],
  skeleton:       ['duration', 'haste'],
  poisonflask:    ['area', 'duration', 'haste'],
  flamewalk:      ['area', 'size', 'duration', 'haste'],
  flamethrower:   ['area', 'size', 'duration', 'haste'], // area drives both range and cone width
  ninjastars:     ['area', 'size', 'duration', 'haste'],
  bonethrow:      ['chain', 'area', 'pierce', 'haste'],
  electrofingers: ['area', 'chain', 'duration', 'haste'],
};
for (const [id, attrs] of Object.entries(SKILL_UPGRADE_ATTRS)) {
  if (SKILLS[id]) SKILLS[id].upgrades = attrs;
}

// Rolls the full payload of a SKILL upgrade at a given tier: always a damage step, plus a
// tier-dependent number of extra parameter rolls, projectiles, and (top tiers) an infusion.
export function rollSkillUpgrade(tier, skillDef, currentInfusion) {
  const tierIdx = UPGRADE_TIERS.indexOf(tier);
  const scale = 1 + tierIdx * 0.45;                 // rarer tiers roll bigger numbers
  const extras = [0, 1, 1, 2, 2][tierIdx];          // how many non-damage params to roll
  const rolls = [{ attr: 'damage', value: +(tier.dmg).toFixed(3) }];
  const poolAttrs = (skillDef.upgrades || []).slice();
  for (let i = 0; i < extras && poolAttrs.length; i++) {
    const a = poolAttrs.splice(Math.floor(Math.random() * poolAttrs.length), 1)[0];
    const def = SKILL_ATTRS[a];
    const v = def.int ? Math.max(1, Math.round(def.base * scale)) : +(def.base * scale).toFixed(3);
    rolls.push({ attr: a, value: v });
  }
  let infusion = null;
  if (tier.infuse) {
    const fresh = INFUSION_IDS.filter((i) => i !== currentInfusion);
    infusion = fresh[Math.floor(Math.random() * fresh.length)] || INFUSION_IDS[0];
  }
  return { rolls, proj: skillDef.noProjectiles ? 0 : tier.proj, infusion };
}

export const SKILL_ORDER = ['slash', 'scythe', 'fireball', 'quickshot', 'icenova', 'iceshards', 'chainlightning', 'firebeam', 'electrofingers', 'skeleton', 'poisonflask', 'flamewalk', 'flamethrower', 'ninjastars', 'bonethrow'];

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
};

// Returns { dps, targets, control } for one active skill gem.
// `mods` must come from computeMods(player, skill) so per-gem bonuses are included.
export function estimateSkillDps(skill, mods, player) {
  const model = DPS_MODELS[skill.id];
  const def = SKILLS[skill.id];
  if (!model || !def) return { dps: 0, targets: 1 };
  const m = model(skill.level, mods);
  if (m.control) return { dps: 0, targets: 1, control: true };

  // Average crit multiplier, matching the 75% crit-chance clamp in damageEnemy().
  const critChance = Math.min(0.75, (player?.critChance || 0) + (mods.critChance || 0));
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
