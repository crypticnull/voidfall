import { rand, pick } from './utils.js';

export const AFFIXES = [
  { key: 'maxHp', label: (v) => `+${v} Maximum Life`, roll: () => Math.round(rand(8, 22)), apply: (p, v) => { p.maxHp += v; p.hp += v; } },
  { key: 'speed', label: (v) => `+${v}% Movement Speed`, roll: () => Math.round(rand(4, 10)), apply: (p, v) => { p.speedMult += v / 100; } },
  { key: 'armor', label: (v) => `+${v} Armor`, roll: () => Math.round(rand(2, 6)), apply: (p, v) => { p.armor += v; } },
  { key: 'pickup', label: (v) => `+${v}% Pickup Radius`, roll: () => Math.round(rand(10, 25)), apply: (p, v) => { p.pickupRadiusMult += v / 100; } },
  { key: 'damage', label: (v) => `+${v}% Global Damage`, roll: () => Math.round(rand(5, 12)), apply: (p, v) => { p.itemDamageMult += v / 100; } },
  { key: 'crit', label: (v) => `+${v}% Critical Chance`, roll: () => Math.round(rand(3, 8)), apply: (p, v) => { p.critChance += v / 100; } },
  { key: 'cdr', label: (v) => `-${v}% Cooldown`, roll: () => Math.round(rand(3, 7)), apply: (p, v) => { p.itemCooldownMult *= 1 - v / 100; } },
  // Magic find rolls as a normal affix now, so rarity can ride along on any item rather than
  // only arriving as its own standalone chest reward. Multiplicative, so stacks compound.
  { key: 'rarity', label: (v) => `+${v}% Rarity`, roll: () => Math.round(rand(4, 10)), apply: (p, v) => { p.rarityMult *= 1 + v / 100; } },
];

// Item rarities mirror the chest tiers one-for-one, so a Legendary Cache always yields a
// Legendary relic. Each step adds an affix AND scales every rolled value by `valueMult`,
// which follows a soft exponential (~1.33× per step, 3.2× end to end) — a Unique feels like
// a real jackpot without trivialising the game the moment one drops.
export const RARITIES = {
  common:    { name: 'Common Relic',    color: '#9098a4', affixCount: 1, valueMult: 1.0 },
  rare:      { name: 'Rare Relic',      color: '#4a6fa5', affixCount: 2, valueMult: 1.35 },
  epic:      { name: 'Epic Relic',      color: '#9a4fbf', affixCount: 3, valueMult: 1.8 },
  legendary: { name: 'Legendary Relic', color: '#e0a033', affixCount: 4, valueMult: 2.4 },
  unique:    { name: 'Unique Relic',    color: '#d94a2f', affixCount: 5, valueMult: 3.2 },
};

// Rolls an item of the given rarity. Its `valueMult` scales every affix's magnitude, so
// higher rarities are not just more numerous in mods but individually bigger. `boost` is an
// extra multiplier callers can layer on top.
export function rollItem(rarity = 'common', boost = 1) {
  const def = RARITIES[rarity];
  const valueMult = def.valueMult * boost;
  const count = def.affixCount;
  const chosen = [];
  const pool = AFFIXES.slice();
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const affix = pool.splice(idx, 1)[0];
    const value = Math.max(1, Math.round(affix.roll() * valueMult));
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
export const CHEST_TIERS = [
  { id: 'common',    name: 'Common Cache',    weight: 50, color: '#9098a4', itemRarity: 'common' },
  { id: 'rare',      name: 'Rare Cache',      weight: 28, color: '#4a6fa5', itemRarity: 'rare' },
  { id: 'epic',      name: 'Epic Cache',      weight: 14, color: '#9a4fbf', itemRarity: 'epic' },
  { id: 'legendary', name: 'Legendary Cache', weight: 6,  color: '#e0a033', itemRarity: 'legendary',
    pool: [{ kind: 'item', weight: 1 }, { kind: 'skillUnlock', weight: 1 }] },
  { id: 'unique',    name: 'Unique Cache',    weight: 2,  color: '#d94a2f', itemRarity: 'unique' },
];

function rollFromPool(pool) {
  const total = pool.reduce((s, r) => s + r.weight, 0);
  let r = Math.random() * total;
  for (const opt of pool) { if ((r -= opt.weight) < 0) return opt.kind; }
  return 'item';
}

// Weighted pick of a chest tier. `minTierId` excludes everything below it (guaranteed-good
// chests). `luck` (>=1) is a magic-find multiplier that bends the odds toward rarer tiers,
// boosting each tier's weight by luck^rank so higher tiers benefit progressively more.
export function rollChestTier(minTierId = null, luck = 1) {
  let pool = CHEST_TIERS;
  if (minTierId) {
    const idx = CHEST_TIERS.findIndex((t) => t.id === minTierId);
    if (idx > 0) pool = CHEST_TIERS.slice(idx);
  }
  const weighted = pool.map((t, i) => ({ t, w: t.weight * Math.pow(luck, i) }));
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const x of weighted) { if ((r -= x.w) < 0) return x.t; }
  return pool[pool.length - 1];
}

// Roll a full chest reward: the tier plus its payload — an item, or (for pooled tiers) a random
// entry from that tier's pool, which may be a special reward.
export function rollChestReward(minTierId = null, luck = 1) {
  const tier = rollChestTier(minTierId, luck);
  const base = { tier: tier.id, tierName: tier.name, color: tier.color };
  const kind = tier.pool ? rollFromPool(tier.pool) : 'item';
  if (kind === 'skillUnlock') return { ...base, special: 'skillUnlock' };
  // The rarity itself now carries the exponential value curve, so the tier maps straight across.
  return { ...base, item: rollItem(tier.itemRarity) };
}
