// Player power vs horde toughness, over a whole run.
//
// Why this exists: tuning the difficulty curve by eye means guessing at a race between two
// exponentials, and the earlier attempts at it used a tome-only proxy for player damage. That
// proxy was badly wrong in the first three stages, where power is dominated by ACQUIRING skills
// rather than by stacking tomes — it read stage 3 as a brick wall that play does not report.
//
// This runs the game's own estimateSkillDps over a simulated build instead, so the comparison is
// against the same arithmetic the dev panel quotes.
//
// Still a model, and these are its assumptions — read them before trusting a number:
//   - a fixed pick order (four skills, then alternating skill levels and tomes)
//   - a fixed level-up pace per position unit
//   - AoE credited by its `targets` count, which flatters clear-speed against crowds
//   - no dodging, no positioning, no chest affixes, no shop upgrades
// The SHAPE of the curves is what this is for. Absolute ratios are not meaningful.
//
//   node tools/race-model.mjs
//   node tools/race-model.mjs --hp-beyond 1.3 --hp-bend 1.4 --hp-end 4
//
import { SUPPORTS } from '../src/supports.js';
import { estimateSkillDps } from '../src/skills.js';
import { PLAYER_GLOBALS } from '../src/classes.js';
import { CURVE_SHAPE, CURVE_BEYOND, curveScale } from '../src/difficulty.js';

const SKILL_PICKS = ['fireball', 'quickshot', 'icenova', 'chainlightning', 'ninjastars', 'icebomb'];
const TOME_PICKS = ['addeddamage', 'fasterattacks', 'critchance', 'critdamage', 'multiproj', 'increasedarea'];

/** Level-ups banked by a given run position. */
export const levelUpsAt = (pos) => Math.round(4 + 3.2 * pos);

export function buildAt(levelUps) {
  const skills = [];
  const tomes = {};
  for (let i = 0; i < levelUps; i++) {
    if (i < 4 && i < SKILL_PICKS.length) { skills.push({ id: SKILL_PICKS[i], level: 1 }); continue; }
    if (i % 2 === 0) {
      const s = skills[(i / 2) % skills.length];
      if (s) s.level++;
    } else {
      const id = TOME_PICKS[((i - 1) / 2) % TOME_PICKS.length];
      tomes[id] = (tomes[id] || 0) + 1;
    }
  }
  return { skills, tomes };
}

export function dpsAt(levelUps) {
  const { skills, tomes } = buildAt(levelUps);
  const mods = {
    damageMult: PLAYER_GLOBALS.damageMult, cooldownMult: 1, areaMult: 1,
    projectileBonus: 0, pierceBonus: 0, chainBonus: 0, forkBonus: 0,
    critChance: 0, critMultBonus: 0, lifeLeech: 0, durationMult: 1, sizeMult: 1,
  };
  for (const [id, lvl] of Object.entries(tomes)) SUPPORTS[id].apply(mods, lvl);
  const player = { critChance: 0.05, critMult: 2 + (mods.critMultBonus || 0) };
  let total = 0;
  for (const s of skills) {
    const r = estimateSkillDps({ id: s.id, level: s.level }, mods, player);
    total += r.dps * Math.max(1, r.targets);
  }
  return total;
}

const POINTS = [[1, 'Stage 1'], [2, 'Stage 2'], [3, 'Stage 3'], [4, 'Wave 1'], [6, 'Wave 3'],
  [9, 'Wave 6'], [13, 'Wave 10'], [18, 'Wave 15'], [23, 'Wave 20']];

export function race(hpOverride) {
  const base = dpsAt(levelUpsAt(1));
  const hp = (pos) => {
    if (!hpOverride) return curveScale('hp', pos);
    const { end, bend, tailAt, beyond } =
      { ...CURVE_SHAPE.hp, beyond: CURVE_BEYOND.hp, ...hpOverride };
    return pos >= tailAt ? end * Math.pow(beyond, pos - tailAt)
      : Math.pow(end, Math.pow(pos / tailAt, bend));
  };
  return POINTS.map(([pos, label]) => {
    const d = dpsAt(levelUpsAt(pos)) / base;
    const h = hp(pos);
    return { pos, label, dps: d, hp: h, ratio: d / h };
  });
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? Number(args[i + 1]) : undefined;
  };
  const ov = {};
  for (const k of ['end', 'bend', 'beyond', 'tailAt']) {
    const v = flag('hp-' + k);
    if (v !== undefined) ov[k] = v;
  }
  const rows = race(Object.keys(ov).length ? ov : null);
  console.log(Object.keys(ov).length ? `hp override: ${JSON.stringify(ov)}` : 'hp: as baked');
  console.log('where        lvlUps   playerDPS    enemyHP    ratio   growth/pos');
  let prev = null;
  for (const r of rows) {
    const g = prev ? Math.pow(r.dps / prev.dps, 1 / (r.pos - prev.pos)) : NaN;
    const gh = prev ? Math.pow(r.hp / prev.hp, 1 / (r.pos - prev.pos)) : NaN;
    console.log(
      r.label.padEnd(12), String(levelUpsAt(r.pos)).padStart(6),
      (r.dps.toFixed(1) + 'x').padStart(11), (r.hp.toFixed(1) + 'x').padStart(10),
      r.ratio.toFixed(2).padStart(8),
      prev ? `   dps x${g.toFixed(2)}  hp x${gh.toFixed(2)}` : '');
    prev = r;
  }
}
main();
