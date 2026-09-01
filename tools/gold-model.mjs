// Expected gold from a stage-1 run, computed from the game's OWN loot functions — not a
// re-implementation. Used to derive the shop's prices in src/meta.js: every baseCost there is
// stated as a multiple of what a run actually pays, so repricing the economy means re-running
// this and updating the anchors, never re-guessing eleven numbers independently.
//
//   node tools/gold-model.mjs
//
// Two scenarios matter for the shop's entry prices:
//   FAIL   a new player dying at ~60% of stage 1, no boss, no rush — the common early outcome
//   CLEAR  a full stage-1 clear: all kills, boss hoard, and a 45-second horde rush
//
// CHESTS ARE PART OF THE INCOME NOW. Turning off stat-affix items made every chest pay a coin
// hoard instead (see STAT_ITEMS_ENABLED), which quietly became a large share of a run's gold —
// and the prices derived before that change were therefore too high for the economy that
// followed. Anything that pays gold belongs in this file; if a new source is added and not
// modelled here, the shop is being priced against a fiction.
import { GOLD_RATES, goldCampaignScale, goldHordeScale, goldDropChance,
  chestDropChance, keyDropChance, CHEST_TIERS, CHEST_GOLD, chestOdds } from '../src/loot.js';
import { ENEMY_TYPES } from '../src/enemies.js';

// Stage-1 tier gates, from enemies.js: what the horde is made of as the clock runs. The mix is
// weighted toward the cheap bodies because that is what poolForTime produces — every type in
// the pool rolls evenly, and the early types stay in the pool for the whole stage.
const POOL = [
  { until: 45, types: ['zombie', 'bat'] },
  { until: 60, types: ['zombie', 'bat', 'flameSkull'] },
  { until: 75, types: ['zombie', 'bat', 'flameSkull', 'skeletonArcher'] },
  { until: 90, types: ['zombie', 'bat', 'flameSkull', 'skeletonArcher', 'hornedGoblin'] },
  { until: 150, types: ['zombie', 'bat', 'flameSkull', 'skeletonArcher', 'hornedGoblin', 'slime'] },
  { until: 210, types: ['zombie', 'bat', 'flameSkull', 'skeletonArcher', 'hornedGoblin', 'slime', 'ogre'] },
  { until: 1e9, types: ['zombie', 'bat', 'flameSkull', 'skeletonArcher', 'hornedGoblin', 'slime', 'ogre', 'wraith'] },
];
const avgXpAt = (t) => {
  const row = POOL.find((r) => t < r.until);
  return row.types.reduce((s, id) => s + ENEMY_TYPES[id].xp, 0) / row.types.length;
};

// A stage-1 run to the 350-kill boss gate takes roughly 5 minutes of climbing kill rate.
// Kills are spread over that window so each lands on the right roster mix and curve position.
const KILLS_TO_BOSS = 350;
const STAGE_SECONDS = 300;

/** Average gold a single opened chest pays, across the tier table's own weights. */
function avgChestGold() {
  const total = CHEST_TIERS.reduce((s, t) => s + t.weight, 0);
  let g = 0;
  for (const t of CHEST_TIERS) {
    const share = t.weight / total;
    // The legendary tier rolls half skill-unlock, half gold — the unlock pays no coin.
    const goldShare = t.pool ? 0.5 : 1;
    g += share * goldShare * (CHEST_GOLD[t.id] || 0);
  }
  return g;
}

// A chest only pays if a key is also in hand. Keys drop slightly rarer than chests, so the
// binding rate is the key rate — chests beyond that sit unopened on the floor.
const openedChestsPerKill = Math.min(chestDropChance(), keyDropChance());

function campaignGold(killFraction) {
  let gold = 0;
  const kills = KILLS_TO_BOSS * killFraction;
  const chestAvg = avgChestGold();
  for (let i = 0; i < kills; i++) {
    const t = (i / KILLS_TO_BOSS) * STAGE_SECONDS;
    const pos = (i / KILLS_TO_BOSS);              // difficultyPosition covers stage 1 as 0..1
    gold += goldDropChance('normal') * avgXpAt(t) * GOLD_RATES.perXp * goldCampaignScale(pos);
    gold += openedChestsPerKill * chestAvg;       // the chest half of the income
  }
  return gold;
}

function hordeGold(seconds, killsPerSec) {
  let gold = 0;
  for (let s = 0; s < seconds; s += 1 / killsPerSec) {
    gold += goldDropChance('horde') * avgXpAt(STAGE_SECONDS) * GOLD_RATES.perXp * goldHordeScale(s, 0);
  }
  return gold;
}

const bossHoard = GOLD_RATES.bossHoard * Math.max(1, Math.round(GOLD_RATES.bossCoin * goldCampaignScale(1)));
// The boss's own chest is guaranteed and rolls at Epic or better.
const bossChest = CHEST_GOLD.epic;

const chestFail = KILLS_TO_BOSS * 0.6 * openedChestsPerKill * avgChestGold();
const chestClear = KILLS_TO_BOSS * openedChestsPerKill * avgChestGold();

const FAIL = campaignGold(0.6);
const CLEAR = campaignGold(1) + bossHoard + bossChest + hordeGold(45, 2);

// Chests should be HALF a cleared run's gold, not four fifths. A single source dominating the
// economy makes every other one decorative — the horde rush, the boss hoard and the per-kill
// coins all stopped mattering when one guaranteed Epic chest outweighed them together.
//
// The scale needed is not a taste call: for chests to be half the total they must equal
// everything else, so the factor is (non-chest income) / (current chest income). Printed here so
// the next person to move a chest value can re-derive it instead of guessing.
const TARGET_CHEST_SHARE = 0.5;
const chestsInClear = chestClear + bossChest;
const nonChest = CLEAR - chestsInClear;
const wantChest = (nonChest * TARGET_CHEST_SHARE) / (1 - TARGET_CHEST_SHARE);
const chestScale = wantChest / chestsInClear;

const r1 = (n) => n.toFixed(1);
console.log(`stage-1 kills to boss: ${KILLS_TO_BOSS}`);
console.log(`opened chests per kill: ${(openedChestsPerKill * 100).toFixed(2)}%  ·  avg chest: ${r1(avgChestGold())}g`);
console.log('');
console.log(`FAIL  (die at 60%, no boss):            ${r1(FAIL)} gold   (of which chests: ${r1(chestFail)})`);
console.log(`CLEAR (full stage + hoard + 45s rush):  ${r1(CLEAR)} gold   (of which chests: ${r1(chestClear + bossChest)})`);
console.log(`  boss hoard: ${bossHoard}, boss chest: ${bossChest}, rush: ${r1(hordeGold(45, 2))}`);
console.log('');
console.log(`chest share of CLEAR: ${(100 * chestsInClear / CLEAR).toFixed(0)}%  (target ${TARGET_CHEST_SHARE * 100}%)`);
if (Math.abs(chestScale - 1) > 0.03) {
  console.log(`  -> scale CHEST_GOLD by x${chestScale.toFixed(3)}:`);
  const scaled = Object.entries(CHEST_GOLD)
    .map(([k, v]) => `${k} ${v}->${Math.max(1, Math.round(v * chestScale / 5) * 5)}`).join(', ');
  console.log(`     ${scaled}`);
}
console.log('');
console.log('price anchors: cheap line ~= 1 FAIL, tome slot ~= 1 CLEAR, skill slot ~= 1.4 CLEAR');
console.log('');
console.log('suggested baseCosts at those anchors:');
const anchor = (mult, base) => Math.round((base * mult) / 5) * 5;
console.log(`  cheap stat lines   ~${anchor(1, FAIL)}  (moveSpeed / xpGain / critRate / area)`);
console.log(`  reroll             ~${anchor(4, FAIL)}`);
console.log(`  projectiles        ~${anchor(0.8, CLEAR)}`);
console.log(`  tome slot          ~${anchor(1, CLEAR)}  (first purchase, ladder x2.0)`);
console.log(`  skill slot         ~${anchor(1.4, CLEAR)}  (first purchase, ladder x2.2)`);
