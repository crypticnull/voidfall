import { rand, pick, MAX_CRIT_CHANCE } from './utils.js';
import { grantArmor, shapeValue } from './difficulty.js';

export const AFFIXES = [
  { key: 'maxHp', label: (v) => `+${v} Maximum Life`, roll: () => Math.round(rand(8, 22)), apply: (p, v) => { p.maxHp += v; p.hp += v; } },
  { key: 'speed', label: (v) => `+${v}% Movement Speed`, roll: () => Math.round(rand(4, 10)), apply: (p, v) => { p.speedMult += v / 100; } },
  { key: 'armor', label: (v) => `+${v} Armor`, roll: () => Math.round(rand(2, 6)), apply: (p, v) => { grantArmor(p, v); } },
  { key: 'pickup', label: (v) => `+${v}% Pickup Radius`, roll: () => Math.round(rand(10, 25)), apply: (p, v) => { p.pickupRadiusMult += v / 100; } },
  { key: 'damage', label: (v) => `+${v}% Global Damage`, roll: () => Math.round(rand(5, 12)), apply: (p, v) => { p.itemDamageMult += v / 100; } },
  // `capped` takes the affix out of the pool once the stat it feeds can no longer move. Crit is
  // the only one with a true ceiling today; the hook is here so the others can join it when they
  // get one, rather than each growing its own special case at the roll site.
  { key: 'crit', label: (v) => `+${v}% Critical Chance`, roll: () => Math.round(rand(3, 8)),
    capped: (p) => (p.critChance || 0) >= MAX_CRIT_CHANCE,
    apply: (p, v) => { p.critChance += v / 100; } },
  { key: 'cdr', label: (v) => `-${v}% Cooldown`, roll: () => Math.round(rand(3, 7)), apply: (p, v) => { p.itemCooldownMult *= 1 - v / 100; } },
  // Magic find rolls as a normal affix now, so rarity can ride along on any item rather than
  // only arriving as its own standalone chest reward. Multiplicative, so stacks compound.
  { key: 'rarity', label: (v) => `+${v}% Rarity`, roll: () => Math.round(rand(4, 10)), apply: (p, v) => { p.rarityMult *= 1 + v / 100; } },
  // Chain and Fork moved here from the tome shelf. Both are hard-capped in main.js, so they
  // make poor tomes — there is no deep investment to sell — but they are excellent as a rare
  // find, where landing one at all is the reward.
  //
  // `minRarity` keeps them off Commons: a build-defining mechanic arriving on the tier you see
  // constantly would stop being a find. `maxValue` caps the roll independently of the rarity
  // value curve, which by Unique multiplies everything by ~5 and would otherwise hand out
  // numbers well past the point either stat still does anything.
  { key: 'chain', minRarity: 'rare', maxValue: 4,
    label: (v) => `Chaining effects bounce +${v} time${v > 1 ? 's' : ''}`,
    roll: () => 1, apply: (p, v) => { p.itemChainBonus += v; } },
  { key: 'fork', minRarity: 'rare', maxValue: 2,
    label: (v) => `Projectiles fork +${v} time${v > 1 ? 's' : ''} on impact`,
    roll: () => 1, apply: (p, v) => { p.itemForkBonus += v; } },
  // Pierce came off the tome shelf for the same reason as those two — it counts whole enemies,
  // so a smooth curve reads as dead levels and a step. No `minRarity` though: unlike chain and
  // fork it does not change what a build DOES, it just makes shots go further, so it is fine on
  // a Common. Capped at 6, past which a projectile is effectively unkillable and the number
  // stops meaning anything.
  { key: 'pierce', maxValue: 6,
    label: (v) => `Projectiles pierce +${v} enem${v > 1 ? 'ies' : 'y'}`,
    roll: () => Math.round(rand(1, 2)), apply: (p, v) => { p.itemPierceBonus += v; } },
];

// Item rarities mirror the chest tiers one-for-one, so a Legendary Cache always yields a
// Legendary relic. Each step adds an affix AND scales every rolled value by `valueMult`,
// which follows a soft exponential (~1.33× per step, 3.2× end to end) — a Unique feels like
// a real jackpot without trivialising the game the moment one drops.
export const RARITIES = {
  common:    { name: 'Common Relic',    color: '#9098a4', affixCount: 1 },
  rare:      { name: 'Rare Relic',      color: '#4a6fa5', affixCount: 2 },
  epic:      { name: 'Epic Relic',      color: '#9a4fbf', affixCount: 3 },
  legendary: { name: 'Legendary Relic', color: '#e0a033', affixCount: 4 },
  unique:    { name: 'Unique Relic',    color: '#d94a2f', affixCount: 5 },
};

/**
 * How affix magnitude climbs across the five rarities — the same shape as the difficulty
 * curve, with rarity index standing in for position:
 *
 *   valueMult(i) = end ^ ( (i / lastIndex) ^ bend )
 *
 * `end` is what a Unique is worth against a Common. `bend` decides WHERE the value arrives:
 * above 1 holds the low rarities down and saves the payoff for the top, below 1 hands it out
 * early. Common is 1x by construction, and Unique always lands exactly on `end`.
 *
 * The old table was hand-written and effectively bend 1 (a flat ~1.33x per step), which made
 * a Rare worth 1.35x a Common — most of a Common's second affix again, from the tier you see
 * constantly. bend 1.6 keeps the Unique jackpot identical and takes that back out of the
 * common end, which is where the inflation actually was.
 */
/* GENERATED: rarity curve tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole
   block from tuning/entity-tuning.json. */
export const RARITY_CURVE_TUNE = {
  bend: 1.6,
  end: 3,
};
/* END GENERATED */

export const RARITY_CURVE = { end: 3.2, bend: 1.6, ...RARITY_CURVE_TUNE };

export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'unique'];

/** Affix magnitude multiplier for a rarity, straight off the curve. */
export function rarityValueMult(rarity) {
  const i = RARITY_ORDER.indexOf(rarity);
  if (i <= 0) return 1;
  const t = i / (RARITY_ORDER.length - 1);
  return Math.pow(Math.max(1e-6, RARITY_CURVE.end), Math.pow(t, Math.max(0.05, RARITY_CURVE.bend)));
}
// Derived onto the defs so every existing reader keeps working unchanged.
/**
 * Recompute every rarity's multiplier from the curve. Called once at load, and again whenever
 * a dial moves — the defs are what the roller reads, so they have to be rebuilt rather than
 * consulted lazily.
 */
export function applyRarityCurve() {
  for (const id of Object.keys(RARITIES)) RARITIES[id].valueMult = rarityValueMult(id);
}
applyRarityCurve();

// Rolls an item of the given rarity. Its `valueMult` scales every affix's magnitude, so
// higher rarities are not just more numerous in mods but individually bigger. `boost` is an
// extra multiplier callers can layer on top.
export function rollItem(rarity = 'common', boost = 1, player = null) {
  const def = RARITIES[rarity];
  const valueMult = def.valueMult * boost;
  const count = def.affixCount;
  const chosen = [];
  // Rarity-gated affixes drop out of the pool entirely below their tier, rather than being
  // rolled and rejected — rejecting would quietly reduce the affix count on a Common.
  //
  // Maxed-out stats leave the pool the same way, and for the same reason a capped tome stops
  // being offered: a chest whose reward is "+6% Critical Chance" when you are already at the
  // ceiling is a chest that gave you nothing, and it cost a key to find out.
  const rank = RARITY_ORDER.indexOf(rarity);
  const pool = AFFIXES.filter((a) => (!a.minRarity || rank >= RARITY_ORDER.indexOf(a.minRarity))
    && !(player && a.capped && a.capped(player)));
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const affix = pool.splice(idx, 1)[0];
    let value = Math.max(1, Math.round(affix.roll() * valueMult));
    if (affix.maxValue !== undefined) value = Math.min(value, affix.maxValue);
    chosen.push({ key: affix.key, value, label: affix.label(value), apply: affix.apply });
  }
  return { rarity, name: def.name, color: def.color, affixes: chosen };
}

export function applyItem(player, item) {
  for (const a of item.affixes) a.apply(player, a.value);
}

// ---------- Treasure chest loot tiers ----------
// Five chest tiers, most-common -> rarest, each named for and yielding the matching item
// rarity above. A tier may instead roll from a weighted `pool` for a special reward —
// currently just 'skillUnlock' (free level-up + a permanent, stacking +1 active-skill slot)
// on Legendary. Magic find is no longer a standalone reward; it rolls as the 'rarity' affix
// so it can ride along with other stats.
// Epic and above HALVED again (they had been halved once already), and rare cut a further 20%.
//
// These weights are deliberately written to sum to 100, so each one IS its drop percentage and
// the intended change is the change you actually get. Scaling a tier's weight on its own does
// not do that: weights are relative, so halving epic while leaving the others alone only cuts
// its real share by 40%, and the 20% off rare came out as 4%. Common absorbs the remainder
// instead — it is the tier with no target of its own, and something has to take up the slack.
//
// Previous shares, for comparison: common 50, rare 28, epic 14, legendary 6, unique 2.
export const CHEST_TIERS = [
  { id: 'common',    name: 'Common Cache',    weight: 66.6, color: '#9098a4', itemRarity: 'common' },
  { id: 'rare',      name: 'Rare Cache',      weight: 22.4, color: '#4a6fa5', itemRarity: 'rare' },   // 28 * 0.8
  { id: 'epic',      name: 'Epic Cache',      weight: 7,    color: '#9a4fbf', itemRarity: 'epic' },   // 14 / 2
  { id: 'legendary', name: 'Legendary Cache', weight: 3,    color: '#e0a033', itemRarity: 'legendary', // 6 / 2
    pool: [{ kind: 'item', weight: 1 }, { kind: 'skillUnlock', weight: 1 }] },
  { id: 'unique',    name: 'Unique Cache',    weight: 1,    color: '#d94a2f', itemRarity: 'unique' },  // 2 / 2
];

/* GENERATED: chest weight tuning. Do not hand-edit -- tools/bake-tuning.py rewrites this whole
   block from tuning/entity-tuning.json. */
export const CHEST_WEIGHT_TUNE = {
  common: 90,
  epic: 2.0407843322727186,
  legendary: 0.2904055511922521,
  rare: 7.445889632376444,
  unique: 0.22292048415858734,
};
/* END GENERATED */
for (const t of CHEST_TIERS) {
  if (CHEST_WEIGHT_TUNE[t.id] !== undefined) t.weight = CHEST_WEIGHT_TUNE[t.id];
}

/**
 * Rescale the tier weights so they sum to 100, leaving every tier's SHARE untouched.
 *
 * Nothing in the roller needs this -- weights are relative, so 66.6/22.4/7/3/1 and twice those
 * numbers roll identically. The panel needs it: its sliders are labelled as percentages, and a
 * set that happens to add up to 119 would show a Common at 80.8 while it actually drops 67.6%
 * of the time. Called at load so a saved override from an older build, or a hand-edited file,
 * cannot open the panel on numbers that misdescribe the odds.
 */
export function normaliseChestWeights() {
  const total = CHEST_TIERS.reduce((a, t) => a + t.weight, 0);
  if (!(total > 0)) return;
  for (const t of CHEST_TIERS) t.weight = (t.weight / total) * 100;
}
normaliseChestWeights();

/**
 * The real odds, as a fraction of 1. Weights are RELATIVE, so a weight is only a percentage
 * while they happen to sum to 100 -- moving any one slider changes every other tier's chance
 * too. That is exactly what a bare weight slider hides, so the readout shows this instead.
 * @param {number} luck magic-find multiplier; bends the odds toward the rarer tiers
 */
export function chestOdds(luck = 1) {
  // Same call the roller makes, so the printed odds ARE the drawn odds. These were two separate
  // expressions and had drifted apart; sharing one is what stops that recurring.
  const w = tierWeights(CHEST_TIERS, luck);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  return CHEST_TIERS.map((t, i) => ({ id: t.id, p: w[i] / total }));
}

/** Tier weights as one live object, for the tuning panel. */
export const CHEST_WEIGHTS = {};
for (const t of CHEST_TIERS) {
  Object.defineProperty(CHEST_WEIGHTS, t.id, {
    enumerable: true, get: () => t.weight, set: (v) => { t.weight = v; },
  });
}

/* GENERATED: loot drop-rate tuning. Do not hand-edit -- tools/bake-tuning.py rewrites this
   whole block from tuning/entity-tuning.json. */
export const LOOT_RATE_TUNE = {
  chest: 0.7,
  key: 0.58,
  xp: 52.5,
  xpValue: 1.2857,
};
/* END GENERATED */

/**
 * Per-kill chance, as a PERCENTAGE, that a slain enemy leaves a chest or a silver key.
 *
 * The two are deliberately separate and deliberately close together: a chest needs a key to
 * open, so what the player actually feels is the ratio between them. Keys slightly rarer than
 * chests means you usually arrive at a chest holding nothing, which is the tension the pair is
 * for -- set keys above chests and both become a formality.
 */
export const LOOT_RATES = { chest: 1.2, key: 0.968, xp: 25, xpValue: 2.25, ...LOOT_RATE_TUNE };

/* GENERATED: gold and potion drop tuning. Do not hand-edit -- tools/bake-tuning.py rewrites
   this whole block from tuning/entity-tuning.json. */
export const GOLD_RATE_TUNE = {
  bossCoin: 7,
  bossHoard: 5,
  chanceEndless: 4,
  chanceHorde: 18,
  chanceNormal: 6,
  hordeStageMult: 1.3,
  perXp: 0.1,
};
export const POTION_RATE_TUNE = {
  chance: 2,
  heal: 35,
};
/* END GENERATED */

/**
 * Gold, per context, as a PERCENTAGE of kills that leave a coin.
 *
 * Three real percentages rather than a base plus multipliers. The player earns gold at wildly
 * different rates in these three situations -- the post-boss window is a dense scramble on a
 * clock, endless runs forever -- and what you want to set is "how much does endless pay", not
 * "endless is 0.7x of a number I have to go and look up". A multiplier chain also makes the
 * shop economy impossible to reason about, because no single number is the answer.
 *
 * `perXp` converts an enemy's xp value into coin and is shared: it is a statement about what a
 * given monster is WORTH, which does not change because a portal is open.
 */
export const GOLD_RATES = {
  chanceNormal: 50,     // regular stage play, before the boss falls
  chanceHorde: 50,      // boss down, portal open, stage still spawning
  chanceEndless: 50,    // after the final boss, for as long as it lasts
  perXp: 0.12,          // gold per point of the enemy's xp value
  bossHoard: 8,         // coins a felled boss scatters
  bossCoin: 5,          // gold in each of them
  hordeStageMult: 1.5,  // per stage past the first, compounding — see goldHordeScale
  ...GOLD_RATE_TUNE,
};

/**
 * Health potions. `chance` is a percentage of kills; `heal` is a percentage of MAX life, so it
 * stays meaningful to a character who has tripled their health since the last one dropped.
 */
export const POTION_RATES = {
  chance: 3.325,
  heal: 30,
  ...POTION_RATE_TUNE,
};

/* GENERATED: gold curve tuning. Do not hand-edit -- tools/bake-tuning.py rewrites this whole
   block from tuning/entity-tuning.json under the `goldcurve` domain. */
export const GOLD_CURVE_TUNE = {
  campaign: { bend: 1.45, beyond: 1.06, end: 2 },
  horde: { bend: 2.8, beyond: 3.135, end: 9, tailAt: 90 },
};
/* END GENERATED */

/**
 * How gold grows, on TWO independent curves with different clocks.
 *
 * Both use the same four dials and the same arithmetic as the difficulty curve — `end` is where
 * it lands, `bend` is where the growth arrives, `tailAt` is where the shape stops and `beyond`
 * compounds forever after (see shapeValue in difficulty.js). What differs is what the x axis
 * MEANS, which is why they are read through two separate functions rather than one:
 *
 *  campaign  x = difficulty position, 0..3 across the stages and onward through endless.
 *            One continuous arc for the whole run; tailAt 3 is the end of stage 3, so `beyond`
 *            is precisely the endless acceleration.
 *
 *  horde     x = SECONDS SPENT IN THE CURRENT HORDE RUSH, reset to zero every time a new one
 *            begins. Each rush is its own open-ended range: linger and the coins compound,
 *            step through the portal and the next one starts again from 1x. That is the whole
 *            point — it makes staying a decision with a growing payoff rather than a fixed
 *            bonus for being in a phase.
 *
 * Because the two clocks are unrelated, a single goldValueScale(ctx, x) would have taken an `x`
 * that meant stages for one caller and seconds for the other — the kind of parameter that reads
 * fine and is wrong half the time.
 *
 * The curves scale what a coin is WORTH, not how often one drops. A drop chance cannot
 * accelerate — it stops at 100%, which is exactly where both of these need to keep climbing.
 */
export const GOLD_CURVE = {
  campaign: { end: 2.4, bend: 1, tailAt: 3, beyond: 1.18 },
  // 2x by 30s in a rush, then +2.5% per second, forever. Open-ended by construction: there is
  // no ceiling, only the risk of staying.
  // `beyondPer: 300` — the tail compounds once per FIVE MINUTES rather than once per second.
  // Per-second was the honest unit for a seconds axis and a terrible one to tune: the useful
  // range sat between 1.000 and 1.02, and a nudge of 0.05 took five minutes from 14x to
  // 371,000x. Five minutes is the span a player might plausibly camp a portal for, so the
  // number on the dial is now "how much richer is minute five than minute zero".
  horde: { end: 2, bend: 1, tailAt: 30, beyond: 1.6, beyondPer: 300 },
};

// Merged PER CURVE, not spread over the top. A shallow `...GOLD_CURVE_TUNE` replaces each
// curve object wholesale, so a saved block naming only `end` and `bend` silently deleted
// `tailAt` — and shapeValue's Math.max(0.5, undefined) is NaN, which multiplies straight
// through into every coin the game drops. The panel saves a diff against the defaults, so a
// partial block is the normal case, not an edge one.
// `normal` was this curve's name before it gained a second clock and became `campaign`. Saves
// written under the old name are still out there — in the exe's userData and in any browser
// localStorage not yet rewritten — and without this alias the pull resurrects the dead key on
// every round while the real curve silently sits on its defaults.
const GOLD_CURVE_ALIASES = { normal: 'campaign' };

// Canonical keys first, then aliases — and an alias is only honoured when the real key is
// ABSENT. Applying them in plain object order let a stale `normal` block, which sorts after
// `campaign`, overwrite the newer values saved under the real name: the panel looked right,
// the game ran on numbers from before the rename, and nothing said so.
for (const [id, over] of Object.entries(GOLD_CURVE_TUNE)) {
  if (GOLD_CURVE[id]) Object.assign(GOLD_CURVE[id], over);
}
for (const [legacy, canonical] of Object.entries(GOLD_CURVE_ALIASES)) {
  if (GOLD_CURVE_TUNE[legacy] && !GOLD_CURVE_TUNE[canonical]) {
    Object.assign(GOLD_CURVE[canonical], GOLD_CURVE_TUNE[legacy]);
  }
}

/** Coin-value multiplier for the campaign, at a difficulty position. Endless rides its tail. */
export function goldCampaignScale(pos) {
  return shapeValue(GOLD_CURVE.campaign, pos);
}

/**
 * How much richer each successive horde rush is than the one before, compounding per stage.
 *
 * A later rush is a harder place to stand — the difficulty curve has been climbing the whole
 * time — so paying the same as the first one makes lingering strictly worse the further you
 * get. Expressed per stage rather than as a stage-2 special case, so stages beyond the second
 * inherit it without another dial: stage 1 is 1x, stage 2 is this, stage 3 is this squared.
 */
/**
 * Coin-value multiplier inside a horde rush.
 *
 * @param {number} seconds elapsed in THIS rush, reset per portal
 * @param {number} [stageIndex] 0-based stage the rush belongs to; stage 1 is 0
 */
export function goldHordeScale(seconds, stageIndex = 0) {
  const stage = Math.pow(GOLD_RATES.hordeStageMult, Math.max(0, stageIndex));
  return shapeValue(GOLD_CURVE.horde, seconds) * stage;
}

/** Which gold rate applies right now. Kept here beside the rates so the three contexts are
 *  named in one place rather than inferred at the call site. */
export function goldDropChance(ctx) {
  const pct = ctx === 'endless' ? GOLD_RATES.chanceEndless
    : ctx === 'horde' ? GOLD_RATES.chanceHorde
      : GOLD_RATES.chanceNormal;
  return pct / 100;
}

export const potionDropChance = () => POTION_RATES.chance / 100;
export const potionHealFraction = () => POTION_RATES.heal / 100;

/** Chance as a 0..1 fraction, which is what a roll actually wants. */
export const chestDropChance = () => LOOT_RATES.chest / 100;
export const keyDropChance = () => LOOT_RATES.key / 100;
// Read per kill rather than captured, so moving the slider takes effect on the next enemy
// that dies instead of on the next run.
export const xpDropChance = () => LOOT_RATES.xp / 100;
/** What one orb is worth, as a multiple of the dead enemy's own xp. */
export const xpOrbValue = () => LOOT_RATES.xpValue;

function rollFromPool(pool) {
  const total = pool.reduce((s, r) => s + r.weight, 0);
  let r = Math.random() * total;
  for (const opt of pool) { if ((r -= opt.weight) < 0) return opt.kind; }
  return 'item';
}

/**
 * Luck-weighted tier odds over a pool, as raw weights. THE one place the maths lives.
 *
 * `rollChestTier` and `chestOdds` both call it, because they used to compute it separately and
 * had drifted: the roller indexed within the FILTERED pool while the readout indexed the full
 * list, so on any guaranteed-tier chest they disagreed. A boss's guaranteed-Epic chest gave Epic
 * a luck multiplier of `luck^0` — none at all — while the panel showed it getting `luck^2`.
 *
 * Rank is taken from CHEST_TIERS itself, so filtering the pool cannot change what a tier is
 * worth. That is what the old code got wrong: rarity should not become weaker on a chest that
 * is guaranteed to be good.
 *
 * `LOOT_LUCK_EXP` softens the compounding the same way the level-up roll's `luckExp` does, and
 * for the same reason: raising each tier by `luck^rank` turns a +50% Rarity stat into a +406%
 * boost on Unique (1.5^4), which outruns the ladder it is climbing.
 */
const LOOT_LUCK_EXP = 0.7;

function tierWeights(pool, luck) {
  return pool.map((t) => {
    const rank = CHEST_TIERS.indexOf(t);
    return t.weight * Math.pow(luck, rank * LOOT_LUCK_EXP);
  });
}

// Weighted pick of a chest tier. `minTierId` excludes everything below it (guaranteed-good
// chests). `luck` (>=1) is a magic-find multiplier that bends the odds toward rarer tiers.
export function rollChestTier(minTierId = null, luck = 1) {
  let pool = CHEST_TIERS;
  if (minTierId) {
    const idx = CHEST_TIERS.findIndex((t) => t.id === minTierId);
    if (idx > 0) pool = CHEST_TIERS.slice(idx);
  }
  const w = tierWeights(pool, luck);
  const total = w.reduce((s, x) => s + x, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) { if ((r -= w[i]) < 0) return pool[i]; }
  return pool[pool.length - 1];
}

// Roll a full chest reward: the tier plus its payload — an item, or (for pooled tiers) a random
// entry from that tier's pool, which may be a special reward.
/**
 * Random STAT AFFIX items are switched off.
 *
 * Not because they were broken — because they were the wrong reward. A chest handing out
 * "+14% area, +9 max life" is another stat engine in a game whose level-ups, tomes and shop are
 * already stat engines, and in the late game the three of them together pulled every number up
 * far past anything the difficulty curve could answer. Relics, void powers and skill unlocks
 * stay: those give RULES, which is what a found object should do.
 *
 * While this is false, a chest that would have rolled an item pays a coin hoard instead — the
 * tier still decides how much, so opening a Unique Cache is still a moment. This is the slot
 * the designed items will occupy: one unique property each, its own art and splash. Flip the
 * flag back to restore the old affix roller exactly as it was.
 */
export const STAT_ITEMS_ENABLED = false;
/**
 * What a chest pays instead of an affix item, by tier. Exported so tools/gold-model.mjs can
 * price the shop against income the game ACTUALLY produces rather than a stale snapshot.
 *
 * Scaled to 0.241 of the first pass, which put chests at 81% of a cleared run's gold — one
 * source drowning out every other, so the horde rush, the boss hoard and the per-kill coins had
 * all stopped mattering. Half is the target, and half means chests must simply EQUAL everything
 * else; the model derives and prints the factor, so a future change to any value here should be
 * checked by re-running it rather than eyeballed.
 */
export const CHEST_GOLD = { common: 5, rare: 20, epic: 45, legendary: 95, unique: 215 };

export function rollChestReward(minTierId = null, luck = 1, player = null) {
  const tier = rollChestTier(minTierId, luck);
  const base = { tier: tier.id, tierName: tier.name, color: tier.color };
  const kind = tier.pool ? rollFromPool(tier.pool) : 'item';
  if (kind === 'skillUnlock') return { ...base, special: 'skillUnlock' };
  if (!STAT_ITEMS_ENABLED) {
    return { ...base, special: 'gold', gold: CHEST_GOLD[tier.id] || 30 };
  }
  // The rarity itself now carries the exponential value curve, so the tier maps straight across.
  // `player` is passed through so affixes for maxed-out stats can leave the pool.
  return { ...base, item: rollItem(tier.itemRarity, 1, player) };
}
