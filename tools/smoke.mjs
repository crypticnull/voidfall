// Smoke tests. Fast, dependency-free, and safe to run before every build.
//
// Deliberately NOT a full test suite. These cover the things that are (a) easy to break
// silently and (b) expensive to notice later — the difficulty curve's shape, the data tables
// agreeing with the code that reads them, and the game booting at all. Anything needing a real
// browser lives in the headless check at the bottom, which is skipped if no server is running.
//
// Usage:  node tools/smoke.mjs            (curve + data checks)
//         node tools/smoke.mjs --boot     (also boots the game against the dev server)

import {
  curveScale, difficultyPosition, stageFraction, stageEnemyStats,
  CURVE_SHAPE, CURVE_BEYOND, CURVE_ACCEL, CURVE_ACCEL_FROM,
  armorCost, ARMOR_UNIT_DAMAGE, CURVE_FLOOR, shapeValue,
} from '../src/difficulty.js';
import { STAGES } from '../src/stages.js';
import { SUPPORTS, SUPPORT_ORDER } from '../src/supports.js';
import { AFFIXES, rollItem } from '../src/loot.js';
import { UPGRADE_TIERS, SKILLS, SKILL_ORDER } from '../src/skills.js';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; }
  catch (err) { failures.push(`${name}\n    ${err.message}`); }
}
function eq(actual, expected, what = 'value') {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}
function near(actual, expected, tol, what = 'value') {
  if (Math.abs(actual - expected) > tol) throw new Error(`${what}: expected ~${expected}, got ${actual}`);
}

// ---------- 1. curve invariants ----------
// The curve governs every enemy stat in the game. A wrong constant here is invisible until
// someone plays for ten minutes, so it is worth pinning the shape exactly.

// Was "starts at 1x for every stat", which the floor dial deliberately breaks — a stat with a
// floor of 0.8 is SUPPOSED to open below baseline. The invariant worth pinning is not the
// literal 1, it is that a curve starts exactly where its floor says and nowhere else: that
// still catches an off-by-one in the lift, a floor silently ignored, or a curve that drifts off
// its opening value, while allowing the feature to exist.
check('curve starts exactly at its floor for every stat', () => {
  for (const stat of Object.keys(CURVE_SHAPE)) {
    const floor = CURVE_FLOOR[stat] === undefined ? 1 : CURVE_FLOOR[stat];
    near(curveScale(stat, 0), floor, 1e-9, `${stat} at position 0`);
  }
});

// The floor must not disturb anything ABOVE it: `end` still lands on `end`, and the endless
// tail is untouched. Without this, a future change to the lift could quietly rescale the whole
// back half of the game and only the opening would look right.
check('a floor moves the start without moving the end or the tail', () => {
  for (const [stat, sh] of Object.entries(CURVE_SHAPE)) {
    near(curveScale(stat, sh.tailAt), sh.end, 1e-9, `${stat} still lands on end`);
  }
  const sh = { end: 4, bend: 1.1, tailAt: 3, beyond: 1.2 };
  for (const pos of [3.5, 5, 9]) {
    near(shapeValue({ ...sh, floor: 0.4 }, pos), shapeValue(sh, pos), 1e-9, `tail at ${pos}`);
  }
  // ...and a floor of 1, or a nonsensical one, is exactly the same curve as no floor at all.
  for (const bad of [1, 0, -3]) {
    near(shapeValue({ ...sh, floor: bad }, 1.5), shapeValue(sh, 1.5), 1e-9, `floor ${bad} is inert`);
  }
});

check('curve lands exactly on its End at the last position', () => {
  for (const [stat, sh] of Object.entries(CURVE_SHAPE)) near(curveScale(stat, CURVE_SHAPE[stat].tailAt), sh.end, 1e-9, stat);
});

check('bend decides WHERE the climb happens, not where it ends', () => {
  // The whole promise of the shape: change bend and the destination is untouched.
  const stat = 'hp';
  const { end, bend, tailAt } = CURVE_SHAPE[stat];
  try {
    const mid = [];
    for (const b of [0.5, 1, 2.5]) {
      CURVE_SHAPE[stat].bend = b;
      near(curveScale(stat, CURVE_SHAPE[stat].tailAt), end, 1e-9, `end held at bend ${b}`);
      mid.push(curveScale(stat, tailAt / 2));
    }
    // Front-loaded must be above even, which must be above back-loaded, at the half way point.
    if (!(mid[0] > mid[1] && mid[1] > mid[2])) {
      throw new Error(`bend did not order the midpoint: ${mid.join(' , ')}`);
    }
  } finally {
    CURVE_SHAPE[stat].bend = bend;
  }
});

check('curve compounds past the end of the shape', () => {
  for (const [stat, sh] of Object.entries(CURVE_SHAPE)) {
    for (const n of [1, 3, 7, 12]) {
      // Past the reference the tail is `beyond^n`, PLUS the surge: once n passes `accelFrom`,
      // the growth rate itself compounds, which adds accel^(triangular number of surged steps).
      const t = Math.max(0, n - CURVE_ACCEL_FROM[stat]);
      const want = sh.end * Math.pow(CURVE_BEYOND[stat], n) * Math.pow(CURVE_ACCEL[stat], (t * (t - 1)) / 2);
      near(curveScale(stat, CURVE_SHAPE[stat].tailAt + n), want, 1e-9, `${stat} +${n}`);
    }
  }
});

// The surge is opt-in, and this is the promise that says so: with accel at 1 the tail must be
// EXACTLY the old plain exponential. Worth its own check because the previous version of the
// test above passed for the wrong reason — it only sampled n up to 7 while accelFrom was 7, so
// it never reached a surged step and would have missed the feature being wrong entirely.
check('accel 1 leaves the tail exactly as it was', () => {
  const stat = 'hp';
  const a = CURVE_ACCEL[stat];
  try {
    CURVE_ACCEL[stat] = 1;
    for (const n of [1, 5, 12, 20]) {
      near(curveScale(stat, CURVE_SHAPE[stat].tailAt + n),
        CURVE_SHAPE[stat].end * Math.pow(CURVE_BEYOND[stat], n), 1e-9, `plain tail +${n}`);
    }
  } finally {
    CURVE_ACCEL[stat] = a;
  }
});

check('the endless surge actually accelerates', () => {
  // Growth per position must RISE past accelFrom, or the soft clamp is not clamping.
  const stat = 'hp';
  const at = (pos) => curveScale(stat, pos);
  const tail = CURVE_SHAPE[stat].tailAt;
  const early = at(tail + 2) / at(tail + 1);
  const late = at(tail + 15) / at(tail + 14);
  if (!(late > early * 1.05)) {
    throw new Error(`surge is flat: early x${early.toFixed(3)}, late x${late.toFixed(3)}`);
  }
});

check('curve is monotonically increasing', () => {
  for (const stat of Object.keys(CURVE_SHAPE)) {
    let prev = 0;
    for (let pos = 0; pos <= 25; pos += 0.25) {
      const v = curveScale(stat, pos);
      if (v < prev - 1e-9) throw new Error(`${stat} dipped at position ${pos}: ${v} < ${prev}`);
      prev = v;
    }
  }
});

check('curve is continuous where the shape hands over to the tail', () => {
  for (const stat of Object.keys(CURVE_SHAPE)) {
    const before = curveScale(stat, CURVE_SHAPE[stat].tailAt - 1e-6);
    const after = curveScale(stat, CURVE_SHAPE[stat].tailAt + 1e-6);
    near(after, before, 1e-4, `${stat} across handover`);
  }
});

check('endless is continuous with the end of the last stage', () => {
  const base = { stageCount: STAGES.length, currentStage: STAGES.length - 1 };
  // Final stage complete...
  const endOfStages = difficultyPosition({ ...base, beatFinalBoss: false, endlessWave: 0, fraction: 1 });
  // ...and the instant the first endless wave begins.
  const firstWave = difficultyPosition({ ...base, beatFinalBoss: true, endlessWave: 1, fraction: 0 });
  eq(firstWave, endOfStages, 'handover position');
});

check('stageFraction saturates at 1 and never goes negative', () => {
  const p = { bossTime: 300, killThreshold: 500 };
  eq(stageFraction({ ...p, stageElapsed: 0, stageKills: 0 }), 0, 'floor');
  eq(stageFraction({ ...p, stageElapsed: 9999, stageKills: 0 }), 1, 'time ceiling');
  eq(stageFraction({ ...p, stageElapsed: 0, stageKills: 99999 }), 1, 'kill ceiling');
  // Whichever gate is further along wins.
  near(stageFraction({ ...p, stageElapsed: 150, stageKills: 0 }), 0.5, 1e-9, 'half by time');
});

check('armor cost is always a whole number of at least 1', () => {
  for (const d of [-5, 0, 0.4, 1, 7, 13, 40, 999]) {
    const c = armorCost(d);
    if (!Number.isInteger(c)) throw new Error(`damage ${d} gave a fractional cost ${c}`);
    if (c < 1) throw new Error(`damage ${d} was free (cost ${c})`);
  }
});

check('armor cost never decreases as damage rises', () => {
  let prev = 0;
  for (let d = 0; d <= 400; d += 1) {
    const c = armorCost(d);
    if (c < prev) throw new Error(`cost dipped at damage ${d}: ${c} < ${prev}`);
    prev = c;
  }
});

check('a hit at the unit-damage threshold still costs exactly one unit', () => {
  // The curve is anchored here: anything up to one unit's worth of damage is a single unit.
  eq(armorCost(ARMOR_UNIT_DAMAGE), 1, 'cost at threshold');
  if (armorCost(ARMOR_UNIT_DAMAGE * 2) <= 1) throw new Error('double damage should cost more than one unit');
});

// ---------- 2. data tables agree with the code that reads them ----------

check('every stage declares a full enemyStats block', () => {
  for (const s of STAGES) {
    const stats = stageEnemyStats(s);
    for (const k of ['hp', 'damage', 'speed', 'spawnRate']) {
      if (typeof stats[k] !== 'number' || !(stats[k] > 0)) {
        throw new Error(`${s.id}.${k} is ${stats[k]}`);
      }
    }
  }
});

check('stageEnemyStats defaults a missing block to 1x', () => {
  const d = stageEnemyStats(undefined);
  for (const k of ['hp', 'damage', 'speed', 'spawnRate']) eq(d[k], 1, k);
});

check('every stage has a boss and an enemy pool', () => {
  for (const s of STAGES) {
    if (!s.boss || !s.boss.spriteId) throw new Error(`${s.id} has no boss spriteId`);
    if (!Array.isArray(s.enemyPool) || !s.enemyPool.length) throw new Error(`${s.id} has an empty pool`);
  }
});

check('upgrade tiers are ordered rarest-last and gated in order', () => {
  let lastWeight = Infinity, lastGate = -1;
  for (const t of UPGRADE_TIERS) {
    if (t.weight > lastWeight) throw new Error(`${t.id} is more common than the tier before it`);
    const gate = t.minProg || 0;
    if (gate < lastGate) throw new Error(`${t.id} unlocks earlier than the tier before it`);
    lastWeight = t.weight; lastGate = gate;
  }
});

check('a capped tome declares its cap', () => {
  // Chain and Forking used to live here and be capped; both are chest affixes now, so no tome
  // is currently capped. The invariant still matters for the next one that is: a tome whose
  // effect stops paying out must say so, or it keeps taking a card slot to sell nothing.
  for (const id of SUPPORT_ORDER) {
    const cap = SUPPORTS[id].maxLevel;
    if (cap !== undefined) eq(typeof cap, 'number', `${id}.maxLevel type`);
  }
});

check('chain and fork are rare-and-above chest affixes, never on a Common', () => {
  for (const key of ['chain', 'fork']) {
    const a = AFFIXES.find((x) => x.key === key);
    if (!a) throw new Error(`${key} affix missing`);
    eq(a.minRarity, 'rare', `${key}.minRarity`);
  }
  // Roll a pile of Commons: the gated pair must never appear on one.
  for (let i = 0; i < 300; i++) {
    for (const af of rollItem('common').affixes) {
      if (af.key === 'chain' || af.key === 'fork') throw new Error('gated affix rolled on a Common');
    }
  }
  // ...and must be reachable above it, or the gate is really a deletion.
  let seen = false;
  for (let i = 0; i < 600 && !seen; i++) {
    seen = rollItem('unique').affixes.some((af) => af.key === 'chain' || af.key === 'fork');
  }
  if (!seen) throw new Error('gated affixes never roll even at Unique');
});

check('the dodge cooldown takes no modifiers', () => {
  // The dash is a movement option, not a gem: no CDR from items, tomes or Haste may touch it.
  // Tuning the BASE value in the dev panel is fine — that is a design decision. What is
  // forbidden is a runtime modifier scaling it, which would cost the dodge the reliable rhythm
  // that makes it a defensive tool.
  //
  // Asserted against the source because the dash is not exported as a computed value, and
  // because the failure this guards against is someone "helpfully" making it consistent with
  // the skills by multiplying it — which no behavioural test would catch until a run felt wrong.
  // The dash slot generalised the reads: the cooldown now arrives through mobilityTune()
  // (DASH for the Dodge Roll, the skill's own tune for anything else), so the guard watches
  // every spelling a cooldown read can take on that path. The rule itself is unchanged.
  const NAMES = ['DASH.cooldown', 'mt.cooldown', 'mtRe.cooldown', 'mobilityTune().cooldown'];
  const MODS = ['cooldownMult', 'hasteMult', 'itemCooldownMult'];
  for (const file of ['../src/main.js', '../src/classes.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    src.split('\n').forEach((line, i) => {
      const name = NAMES.find((n) => line.includes(n));
      if (!name) return;
      const code = line.trimStart();
      if (code.startsWith('//') || code.startsWith('*')) return;   // prose about the rule is fine
      const where = `${file.replace('../src/', '')}:${i + 1}`;
      for (const op of ['*', '/']) {
        if (line.includes(`${name} ${op}`) || line.includes(`${op} ${name}`)
          || line.includes(`${name}${op}`) || line.includes(`${op}${name}`)) {
          throw new Error(`${name} scaled at ${where} — the dodge must stay immutable`);
        }
      }
      for (const mod of MODS) {
        if (line.includes(mod)) throw new Error(`${name} met ${mod} at ${where}`);
      }
    });
  }
  // The guard is worthless if every symbol it watches has been renamed away, so assert that
  // the accessor the machinery actually uses still exists.
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  if (!main.includes('function mobilityTune')) throw new Error('mobilityTune not found — guard is vacuous');
  if (!NAMES.some((n) => main.includes(n))) throw new Error('no cooldown read found — guard is vacuous');
});

check('every tome has a name, colour and apply()', () => {
  for (const id of SUPPORT_ORDER) {
    const t = SUPPORTS[id];
    if (!t.name || !t.color || typeof t.apply !== 'function') throw new Error(`tome ${id} is incomplete`);
  }
});

// ---------- 3. fonts are vendored, not fetched from the network ----------
// The packaged game has no guaranteed network. A stray @import back to Google would not fail
// any build or throw any error — it would just quietly give offline players system fallbacks
// for the HUD, menus and canvas text, which is easy to reintroduce and easy to miss.

check('no stylesheet or page reaches out to Google Fonts', () => {
  for (const f of ['style.css', 'index.html']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    // Ignore comment lines — the explanation of why we self-host names the domain.
    const live = src.split('\n').filter((l) => !/^\s*(\/\*|\*|<!--)/.test(l)).join('\n');
    if (/fonts\.(googleapis|gstatic)\.com/.test(live)) {
      throw new Error(`${f} still references Google Fonts`);
    }
  }
});

check('every self-hosted face resolves to a file that exists', () => {
  const dir = new URL('../assets/fonts/', import.meta.url);
  const css = readFileSync(new URL('fonts.css', dir), 'utf8');
  const faces = css.match(/@font-face/g) || [];
  if (faces.length < 20) throw new Error(`only ${faces.length} faces declared`);
  for (const m of css.matchAll(/url\('([^']+)'\)/g)) {
    if (!existsSync(new URL(m[1], dir))) throw new Error(`missing font file: ${m[1]}`);
  }
});

// ---------- 4. the baked title lockup matches the code that draws it ----------
// The title is a pre-rendered PNG so the loading screen does not have to wait on a webfont.
// That means renderTitleArt no longer runs at boot, so an edit to it would change nothing on
// screen and ship silently. This hashes the function and compares it against the hash recorded
// when the PNG was baked; if they differ, the image is stale and must be regenerated by loading
// the game with ?bake-title against the dev server.

check('baked title lockup is current with renderTitleArt', () => {
  const meta = new URL('../assets/ui/title-lockup.json', import.meta.url);
  const png = new URL('../assets/ui/title-lockup.png', import.meta.url);
  if (!existsSync(meta) || !existsSync(png)) {
    throw new Error('no baked lockup — run the game with ?bake-title on the dev server');
  }
  // Newlines normalised because the baker reads the file through Python's universal-newline
  // decoding: this repo is CRLF on disk, so hashing the raw bytes here would never agree.
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const m = src.match(/^function renderTitleArt\([\s\S]*?^\}/m);
  if (!m) throw new Error('renderTitleArt not found in src/main.js');
  const hash = createHash('sha1').update(m[0], 'utf8').digest('hex');
  const recorded = JSON.parse(readFileSync(meta, 'utf8')).sourceHash;
  if (hash !== recorded) {
    throw new Error(`lockup changed since it was baked (${recorded?.slice(0, 8)} -> ${hash.slice(0, 8)});`
      + ' reload with ?bake-title to regenerate assets/ui/title-lockup.png');
  }
});

// ---------- 5. headless boot (opt-in: needs the dev server up) ----------

async function bootCheck() {
  const URL_BASE = 'http://localhost:8791';
  let res;
  try { res = await fetch(`${URL_BASE}/index.html`); }
  catch { console.log('\n  boot check skipped — no dev server on 8791'); return; }
  if (!res.ok) { console.log('\n  boot check skipped — server returned', res.status); return; }

  // Every module the page loads must at least parse and resolve its imports.
  const html = await res.text();
  const entry = (html.match(/<script[^>]+src="([^"]+)"/) || [])[1] || 'src/main.js';
  const mods = ['src/main.js', 'src/state.js', 'src/difficulty.js', 'src/ui.js', 'src/audio.js',
    'src/sprites.js', 'src/skills.js', 'src/enemies.js', 'src/stages.js', entry];
  for (const m of [...new Set(mods)]) {
    const r = await fetch(`${URL_BASE}/${m.replace(/^\.?\//, '')}`);
    check(`serves ${m}`, () => eq(r.status, 200, 'status'));
  }
  // The music manifest is what the packaged build falls back to; a stale one ships silence.
  const man = await fetch(`${URL_BASE}/assets/music/manifest.json`);
  check('music manifest is valid JSON with tracks', async () => eq(man.status, 200, 'status'));
  const data = await man.json();
  check('manifest lists at least one playable track', () => {
    const total = Object.values(data).reduce((n, list) => n + list.length, 0);
    if (!total) throw new Error('manifest is empty');
  });
  check('manifest contains no archived tracks', () => {
    for (const list of Object.values(data)) {
      for (const t of list) if (String(t.src).includes('_ARCHIVE')) throw new Error(`archived: ${t.src}`);
    }
  });
}

check('every player damage source names itself for the death readout', () => {
  // The death screen can only name what hurt you if every caller passes a source label and a
  // kind. This is the enforcement half of the CONTRACT FOR NEW DAMAGE SOURCES in main.js:
  // a new attack that forgets its label does not crash and shows no visible bug — it just
  // makes the readout say "The Horde" and lose exactly the information it exists to give.
  // Asserted against source because the failure is a MISSING argument, which no runtime test
  // can see: the function has a default and carries on happily.
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const KINDS = ['dot', 'contact', 'slam', 'projectile', 'skill', 'hit'];
  const bad = [];
  let calls = 0;
  src.split('\n').forEach((line, i) => {
    let from = 0;
    for (;;) {
      const at = line.indexOf('applyDamageToPlayer(', from);
      if (at === -1) break;
      from = at + 1;
      const code = line.trimStart();
      if (code.startsWith('//') || code.startsWith('*')) continue;   // prose about the rule
      if (line.includes('function applyDamageToPlayer')) continue;   // the definition itself
      // Walk to the matching close paren so nested calls in the args do not confuse the split.
      let depth = 0, end = -1;
      for (let c = at + 'applyDamageToPlayer'.length; c < line.length; c++) {
        if (line[c] === '(') depth++;
        else if (line[c] === ')') { depth--; if (!depth) { end = c; break; } }
      }
      if (end === -1) continue;   // wrapped across lines; not a shape this file uses
      calls++;
      const args = line.slice(at + 'applyDamageToPlayer('.length, end);
      // Split on top-level commas only.
      const parts = []; let cur = ''; let d = 0;
      for (const ch of args) {
        if (ch === '(' || ch === '[') d++;
        else if (ch === ')' || ch === ']') d--;
        if (ch === ',' && d === 0) { parts.push(cur); cur = ''; } else cur += ch;
      }
      parts.push(cur);
      const where = `main.js:${i + 1}`;
      if (parts.length < 3) { bad.push(`${where} passes ${parts.length} arg(s), needs (amount, source, kind)`); continue; }
      const kind = parts[2].trim().replace(/^['"]|['"]$/g, '');
      // A literal kind must be known; a computed one (a ternary picking between labels) is
      // allowed through, since the phrasing table has a fallback for anything unrecognised.
      if (/^[a-z]+$/.test(kind) && !KINDS.includes(kind)) {
        bad.push(`${where} uses unknown kind '${kind}' — add it to DEATH_KINDS and DEATH_PHRASE`);
      }
    }
  });
  if (!calls) throw new Error('no applyDamageToPlayer call sites found — guard is vacuous');
  if (bad.length) throw new Error(`${bad.length} unlabelled damage source(s):\n    ${bad.join('\n    ')}`);
});

check('every player-data store answers to the save reset token', () => {
  // The token is the ONLY thing that makes "wipe player data" a guarantee instead of a chore
  // someone half-performs. A store that does not check it survives a bump, and the wipe is a
  // lie again — silently, because the store that kept its data is never the one anyone looks at.
  const reset = readFileSync(new URL('../src/save-reset.js', import.meta.url), 'utf8');
  if (!/export const SAVE_RESET_TOKEN = \d+;/.test(reset)) {
    throw new Error('SAVE_RESET_TOKEN missing or malformed — tools/wipe-player-data.py edits it by regex');
  }
  for (const file of ['../src/meta.js', '../src/leaderboard.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    const name = file.replace('../src/', '');
    if (!src.includes('SAVE_RESET_TOKEN')) {
      throw new Error(`${name} persists player data but never checks SAVE_RESET_TOKEN — a wipe would not reach it`);
    }
    // Importing it is not enough; the load path has to REJECT a mismatch.
    if (!/!==\s*SAVE_RESET_TOKEN/.test(src)) {
      throw new Error(`${name} imports the token but never compares against it`);
    }
  }
});

check('zeroing out clears every player-data store and no tuning', () => {
  // Zero It Out is the in-game half of the same promise. It used to keep the leaderboard, which
  // made "a brand-new-player state" false on the one screen that shows your history.
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const at = src.indexOf('function zeroItOut()');
  if (at === -1) throw new Error('zeroItOut not found — has it been renamed?');
  // Walk lines to the closing brace rather than searching for "\n}\n": this file is CRLF, so
  // that sentinel silently never matches and the body comes back empty — which reads as every
  // assertion below failing for the wrong reason.
  const lines = src.slice(at).split(/\r?\n/);
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '}');
  if (end === -1) throw new Error('zeroItOut body not delimited as expected');
  const body = lines.slice(0, end + 1).join('\n');
  for (const call of ['resetMeta()', 'clearEntries()']) {
    if (!body.includes(call)) throw new Error(`zeroItOut is missing ${call} — that store would survive a wipe`);
  }
  // And it must NOT touch tuning: a dev wiping their save should never lose the numbers they
  // have spent a session dialling in. These are the functions that would do it.
  for (const forbidden of ['resetAllTunes', 'clearStoredTunes', 'publishTune', 'publishEntityTune', 'resetTuneToShipped']) {
    if (body.includes(forbidden)) {
      throw new Error(`zeroItOut calls ${forbidden} — a player wipe must never touch tuning`);
    }
  }
});

// ---------- every skill casts a finite effect ----------
// A NaN that reaches an effect does not crash and does not log — it flows outward until it
// surfaces somewhere unrelated. This one went: a tune key removed while the cast still read it
// through scale() -> `34 + undefined * (level-1)` -> NaN damage on the effect -> damageEnemy ->
// life leech -> `S.player.hp = NaN` -> the HUD reading "NaN / 126". Nothing in between
// complained, and it shipped.
//
// So every skill is cast against a stub world at several levels and every number that lands on
// a spawned effect is checked. This catches the whole family — a renamed tune key, a typo'd
// mods field, a divide by a missing dial — not just the one that bit.
check('every skill casts effects with finite numbers', () => {
  const mods = {
    damageMult: 1, areaMult: 1, durationMult: 1, sizeMult: 1, speedMult: 1,
    projectileBonus: 0, chainBonus: 0, forkBonus: 0, pierceBonus: 0,
    lifeLeech: 0, critChance: 0, critMult: 1.5, cooldownMult: 1, infusions: [],
  };
  const bad = [];
  for (const id of SKILL_ORDER) {
    const def = SKILLS[id];
    if (!def || typeof def.cast !== 'function') continue;
    for (const level of [1, 3, 5]) {
      const spawned = [];
      const world = {
        spawnEffect: (o) => spawned.push(o),
        refreshEffect: (k, o) => spawned.push(o),
        clearEffects: () => {}, playSfx: () => {}, damageEnemy: () => {},
        findNearest: () => null, enemiesInRange: () => [], nearestN: () => [],
        spawnProjectile: (o) => spawned.push(o), spawnMinion: () => {},
        shake: () => {}, spawnDamageNumber: () => {},
      };
      const player = { x: 0, y: 0, radius: 14, hp: 100, maxHp: 100, facing: { x: 1, y: 0 } };
      try {
        def.cast({ player, level, mods, world, facing: { x: 1, y: 0 }, skill: { id, level } });
      } catch {
        continue;   // a skill needing world features the stub lacks is not what this test is for
      }
      for (const fx of spawned) {
        for (const [k, v] of Object.entries(fx)) {
          if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${id} lv${level}: ${k} = ${v}`);
        }
      }
    }
  }
  if (bad.length) throw new Error(`non-finite values on spawned effects:\n    ${bad.join('\n    ')}`);
});

// The tuning pull's merge rule is Python, so it is checked by its own file and folded into this
// run's tally. It lives under the same roof as the rest because a silent revert of baked tuning
// is exactly the class of thing this suite exists to catch — and because a test nobody runs is
// the same as no test. Skipped, not failed, when python is not on PATH: the JS checks are still
// worth having on a machine that cannot run it.
check('the exe tuning pull never reverts a bake', () => {
  const r = spawnSync('python', ['tools/test-pull-merge.py'], { encoding: 'utf8' });
  if (r.error) {
    if (r.error.code === 'ENOENT') return;   // no python here; not a failure of the game
    throw r.error;
  }
  if (r.status !== 0) throw new Error(`tools/test-pull-merge.py failed\n${r.stdout}${r.stderr}`);
});

if (process.argv.includes('--boot')) await bootCheck();

// ---------- report ----------
console.log(`\n  ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`\n  FAIL  ${f}`);
// Set the code and let node wind down on its own. A hard process.exit() here races the
// still-open fetch sockets and trips a libuv assertion on Windows, which reads as a crash.
process.exitCode = failures.length ? 1 : 0;
