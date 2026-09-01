// @ts-check
// ---------- Unique items ----------
// The rule that separates an item from everything else the game hands out: AN ITEM CHANGES A
// RULE, NEVER A NUMBER. If it could be written as "+X%", it belongs in a tome or the shop —
// the stat-affix chest items died for exactly that sin. Each of these rewrites how something
// works, which is what earns it a name, a splash and a permanent spot on the shelf.
//
// Items come from BOSSES: every stage boss in the campaign and every endless boss grants one
// on death (see grantBossItem in main.js). The shelf holds ITEM_CAP; with three slots and
// eleven items, most of the set goes unseen in any one run, which is what makes the grant a
// roll worth watching.

/** How many a run may hold. */
export const ITEM_CAP = 3;

/**
 * @typedef {{ id: string, name: string, icon: string, color: string, rule: string }} UItem
 * `rule` is the one sentence on the splash — written as the rule itself, not ad copy.
 */

/** @type {Record<string, UItem>} */
export const ITEMS = {
  // ---- they change how your skills fire ----
  ninefoldeye: {
    id: 'ninefoldeye', name: 'The Ninefold Eye', icon: '◉', color: '#8a4fd0',
    rule: 'Your slowest skill casts twice — the echo at half strength.',
  },
  metronome: {
    id: 'metronome', name: "Widow's Metronome", icon: '♩', color: '#c9a227',
    rule: 'Every fifth cast is a guaranteed crit and costs no cooldown.',
  },
  drownedhand: {
    id: 'drownedhand', name: 'Hand of the Drowned', icon: '☛', color: '#3f8fbc',
    rule: 'Shots that leave the arena return once from the far side.',
  },
  // ---- they change how you take damage ----
  saltledger: {
    id: 'saltledger', name: 'Salt Ledger', icon: '⁝', color: '#c9bfa8',
    rule: "Each stage, the first touch from every kind of foe is warded to nothing.",
  },
  ashenlung: {
    id: 'ashenlung', name: 'Ashen Lung', icon: '﴾', color: '#e0662f',
    rule: 'Burning and poison cannot kill you — but they linger twice as long.',
  },
  // ---- they change the economy ----
  tithebell: {
    id: 'tithebell', name: 'The Tithe Bell', icon: '♪', color: '#e0a033',
    rule: 'Gold flies to you from anywhere — the bell keeps a quarter of it.',
  },
  gravekeeper: {
    id: 'gravekeeper', name: "Gravekeeper's Ledger", icon: '✎', color: '#3fa66a',
    rule: 'Experience left on the field crawls to you, forever.',
  },
  unspentcoin: {
    id: 'unspentcoin', name: 'The Unspent Coin', icon: '◍', color: '#d4c48e',
    rule: 'Carry it to the next realm and it becomes a shop upgrade, free.',
  },
  // ---- they change the run's shape ----
  hourglass: {
    id: 'hourglass', name: 'Cracked Hourglass', icon: '⧗', color: '#d94a2f',
    rule: 'Bosses arrive a third sooner, and each leaves a second chest.',
  },
  longroad: {
    id: 'longroad', name: 'The Long Road', icon: '≡', color: '#4a6d7a',
    rule: 'One more tome slot — but every tome climbs a quarter slower.',
  },
  pilgrimsash: {
    id: 'pilgrimsash', name: "Pilgrim's Ash", icon: '⁂', color: '#cdd3dd',
    rule: 'Entering a new realm doubles your dodge charges for thirty seconds.',
  },
};

export const ITEM_ORDER = Object.keys(ITEMS);

/** @param {any} player @param {string} id */
export const hasItem = (player, id) => !!(player && player.items && player.items[id]);
/** @param {any} player */
export const itemsHeld = (player) => ITEM_ORDER.filter((id) => hasItem(player, id));

/**
 * The boss's grant: one item the run does not hold, uniform across what remains. Null when the
 * shelf is full or the set is exhausted — the caller pays a hoard instead, so the drop moment
 * never lands empty.
 * @param {any} player @param {() => number} [rng]
 */
export function rollBossItem(player, rng = Math.random) {
  if (itemsHeld(player).length >= ITEM_CAP) return null;
  const pool = ITEM_ORDER.filter((id) => !hasItem(player, id));
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}
