// The chart samples the REAL curve rather than repeating its arithmetic — the two drifting
// apart would mean tuning against a picture of something the game does not do.
import { curveScale, CURVE_SHAPE } from './difficulty.js';
import { STAGES } from './stages.js';
import { SAMPLES, sampleBuffer, sampleWindow } from './audio-samples.js';
import { audioNow, previewSample, auditionSample } from './audio.js';
import { RARITIES, RARITY_ORDER, chestOdds, goldCampaignScale, goldHordeScale } from './loot.js';
import { skillDamageAt, SKILL_CATEGORIES, UPGRADE_TIERS, SKILL_DAMAGE,
  skillDamageRoll, tomeDamageStep } from './skills.js';
import { SUPPORTS, SUPPORT_ORDER, tomeMagnitude, tomeCount, COUNTING_TOMES,
  tomeDesc } from './supports.js';
const tailOf = (k) => CURVE_SHAPE[k].tailAt;
const lastTail = () => Math.max(...Object.values(CURVE_SHAPE).map((v) => v.tailAt));
const $ = (id) => document.getElementById(id);
// Typed lookups. getElementById/querySelector are declared as returning the generic base
// types, so every `.value`, `.disabled` or `.offsetWidth` on a result reads as an error even
// though the element is obviously an input or a button. Casting once here beats casting at
// three dozen call sites, and keeps the checking on for genuine mistakes.
/** @returns {HTMLInputElement} */
const $input = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
/** @param {ParentNode} root @returns {HTMLInputElement} */
const qInput = (root, sel) => /** @type {HTMLInputElement} */ (root.querySelector(sel));
/** @param {ParentNode} root @returns {HTMLElement} */
const qEl = (root, sel) => /** @type {HTMLElement} */ (root.querySelector(sel));

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ---------- Xbox button glyphs & input prompts ----------
function glyph(label, cls) { return `<span class="xbBtn ${cls}">${label}</span>`; }
const XB = {
  A: glyph('A', 'btnA'),
  B: glyph('B', 'btnB'),
  X: glyph('X', 'btnX'),
  Y: glyph('Y', 'btnY'),
  Start: glyph('☰ Start', 'btnPill'),
  LB: glyph('LB', 'btnPill'),
  RB: glyph('RB', 'btnPill'),
  DPad: glyph('D-Pad', 'btnPill'),
  LStick: glyph('Left Stick', 'btnPill'),
  RStick: glyph('Right Stick', 'btnPill'),
};

function movePrompt(mode) { return mode === 'gamepad' ? `${XB.LStick} to move` : 'WASD / Arrow Keys to move'; }
function aimPrompt(mode) { return mode === 'gamepad' ? `${XB.RStick} to aim melee` : ''; }
function pausePrompt(mode) { return mode === 'gamepad' ? `${XB.Start} to pause` : "'P' to pause"; }
function confirmPrompt(mode) { return mode === 'gamepad' ? `${XB.A} to confirm · ${XB.DPad} / ${XB.LStick} / ${XB.LB} ${XB.RB} to navigate` : 'Click to select'; }
function resumePrompt(mode) { return mode === 'gamepad' ? `${XB.Start} or ${XB.B} to resume` : "Press 'P' to resume"; }
function confirmChoicePrompt(mode) {
  return mode === 'gamepad'
    ? `${XB.A} yes · ${XB.B} no`
    : 'Enter to confirm · Esc to cancel';
}

let lastInputMode = 'keyboard';
export function applyInputMode(mode) {
  lastInputMode = mode;
  // Control prompts now live on the pause menu rather than cluttering the gameplay screen.
  const pCtrl = $('pauseControls');
  if (pCtrl) pCtrl.innerHTML = `${movePrompt(mode)} · Skills fire automatically${mode === 'gamepad' ? ' · ' + aimPrompt(mode) : ''}`;
  const csHint = $('classSelectHint');
  if (csHint) csHint.innerHTML = confirmPrompt(mode);
  const pHint = $('pauseHint');
  if (pHint) pHint.innerHTML = resumePrompt(mode);
}

// Class select: a horizontal row of portrait cards. If more classes exist than comfortably
// fit, the row becomes a carousel with arrows; `drawPortrait` paints each character's sprite
// into that card's canvas (passed in so ui.js stays free of sprite-system knowledge).
export function showClassSelect(classes, onChoose, drawPortrait) {
  const root = $('classSelect');
  const list = $('classList');
  const viewport = root.querySelector('.classViewport');
  const prev = /** @type {HTMLButtonElement} */ ($('classPrevBtn'));
  const next = /** @type {HTMLButtonElement} */ ($('classNextBtn'));
  list.innerHTML = '';

  const buildCard = (c) => {
    const card = document.createElement('button');
    card.className = 'classCard';
    card.style.setProperty('--accent', c.color);
    card.innerHTML = `
      <div class="classPortrait"><canvas class="classPortraitCanvas" width="160" height="220"></canvas></div>
      <div class="classCardHeader">
        <span class="classDot" style="background:${c.color}"></span>
        <div>
          <div class="classCardName">${c.name}</div>
          <div class="classCardTag">${c.tag}</div>
        </div>
      </div>
      <div class="classCardDesc">${c.desc}</div>
      <!-- One stat per row, each split into icon / value / label cells so the three columns
           line up across every card. As a single flow-wrapped string the row count changed
           with the number of DIGITS — "98 Life" packed beside the next chip where "180 Life"
           did not — which pushed the divider below to a different height on each class. -->
      <div class="classCardStats">
        <div class="statRow"><span class="statIcon">❤</span><span class="statVal">${c.base.maxHp}</span><span class="statLbl">Life</span></div>
        <div class="statRow"><span class="statIcon">⚡</span><span class="statVal">${c.base.speed}</span><span class="statLbl">Speed</span></div>
        <div class="statRow"><span class="statIcon">🛡</span><span class="statVal">${c.base.armor}</span><span class="statLbl">Armor</span></div>
      </div>
      <div class="classCardSkill">Starting Gem: <b>${c.startSkill}</b></div>
    `;
    card.addEventListener('click', () => onChoose(c));
    list.appendChild(card);
    if (drawPortrait) drawPortrait(card.querySelector('.classPortraitCanvas'), c);
    return card;
  };

  for (const c of classes) buildCard(c);

  // ---- Infinite carousel -------------------------------------------------------------
  // The strip rotates rather than scrolling to a dead end. Its resting scroll position is 0;
  // stepping forward scrolls one card, then moves the leftmost card to the end and snaps back
  // to 0. The content either side of that snap is identical, so it is invisible — and because
  // there is never an end to reach, the row turns forever in either direction.
  //
  // Cards are MOVED, not cloned: each one owns a portrait canvas that the sprite system is
  // animating, so rebuilding them on every step would drop those and restart the animation.
  const GAP = 18;
  const stepOf = () => {
    const card = qEl(list, '.classCard');
    return card ? card.offsetWidth + GAP : 240;
  };
  const maxScroll = () => viewport.scrollWidth - viewport.clientWidth;
  let sliding = false;

  // Rotation needs room to scroll a full step from any resting offset, i.e. 2 steps of slack.
  // Short of that, add whole extra copies of the cast until there is — otherwise the scroll
  // would clamp mid-step and the strip would visibly jerk.
  const ensureRoom = () => {
    let guard = 4;
    while (maxScroll() < stepOf() * 2 && guard-- > 0) {
      for (const c of classes) buildCard(c);
    }
  };

  // Drag or wheel can leave the strip at an arbitrary offset. Fold that back to the resting
  // range by rotating, so a later arrow press still has its full step of room.
  const normalize = () => {
    const step = stepOf();
    let guard = list.children.length * 3;
    while (viewport.scrollLeft >= step - 1 && guard-- > 0) {
      list.appendChild(list.firstElementChild);
      viewport.scrollLeft -= step;
    }
  };

  const rotate = (dir) => {
    if (sliding || !infinite) return;
    normalize();
    const step = stepOf();
    sliding = true;
    if (dir > 0) {
      const base = viewport.scrollLeft;
      viewport.scrollTo({ left: base + step, behavior: 'smooth' });
      setTimeout(() => {
        list.appendChild(list.firstElementChild);
        viewport.scrollLeft = base; // identical content: the reset cannot be seen
        sliding = false;
      }, 300);
    } else {
      const base = viewport.scrollLeft;
      list.insertBefore(list.lastElementChild, list.firstElementChild);
      viewport.scrollLeft = base + step; // instant, cancels the shift — nothing appears to move
      viewport.scrollTo({ left: base, behavior: 'smooth' });
      setTimeout(() => { sliding = false; }, 300);
    }
  };

  let infinite = false;
  const sync = () => {
    const overflows = list.scrollWidth > viewport.clientWidth + 2;
    prev.classList.toggle('hidden', !overflows);
    next.classList.toggle('hidden', !overflows);
    if (overflows) ensureRoom();
    infinite = overflows && maxScroll() >= stepOf() * 2;
    // Never disabled: with rotation there is no end to arrive at.
    prev.disabled = false;
    next.disabled = false;
  };

  prev.onclick = () => rotate(-1);
  next.onclick = () => rotate(1);
  rotateClassStrip = rotate;

  root.classList.remove('hidden');
  $('hud').classList.add('hidden');
  requestAnimationFrame(sync); // measure after layout
}

// Lets the gamepad/keyboard navigator turn the class strip when focus reaches its edge,
// instead of wrapping to the far side and yanking the view with it.
let rotateClassStrip = null;
export function rotateClassCarousel(dir) {
  if (rotateClassStrip) rotateClassStrip(dir);
  return !!rotateClassStrip;
}
export function hideClassSelect() {
  $('classSelect').classList.add('hidden');
  showHud(false);
}

// Reveal the HUD in one of its two modes. Sandbox drops the XP bar and the gold panel —
// that mode awards neither, so a permanent "Lv 1" and a frozen 0 gold would be reporting
// systems that aren't running. Everything else stays, including Life, because a sandbox run
// with god mode off is exactly when health matters.
//
// This lives here rather than being toggled at each call site because the HUD is revealed from
// two unrelated paths (the class-select flow and the sandbox launcher), and only one of them
// used to un-hide it at all — which is why sandbox had no HUD.
export function showHud(sandbox = false) {
  const hud = $('hud');
  hud.classList.remove('hidden');
  hud.classList.toggle('sandboxHud', !!sandbox);
}

export function showLevelUp(cards, onChoose, reroll) {
  const root = $('levelUp');
  const list = $('cardList');
  list.innerHTML = '';
  for (const c of cards) {
    const el = document.createElement('button');
    el.className = 'levelCard';
    el.style.setProperty('--accent', c.color);
    el.innerHTML = `
      <div class="levelCardSubtitle">${c.subtitle}</div>
      <div class="levelCardTitle">${c.title}</div>
      <div class="levelCardDesc">${c.desc}</div>
    `;
    el.addEventListener('click', () => { root.classList.add('hidden'); onChoose(c); });
    list.appendChild(el);
  }
  // Reroll button only appears once the shop upgrade has been unlocked (available).
  const oldBtn = $('rerollBtn');
  const rb = /** @type {HTMLButtonElement} */ (oldBtn.cloneNode(true)); // clone to drop any prior click handler
  oldBtn.replaceWith(rb);
  if (reroll && reroll.available) {
    rb.classList.remove('hidden');
    rb.textContent = reroll.left === Infinity ? '↻ Reroll (∞)' : `↻ Reroll (${reroll.left} left)`;
    rb.disabled = reroll.left <= 0;
    if (reroll.left > 0) rb.addEventListener('click', () => reroll.onReroll());
  } else {
    rb.classList.add('hidden');
  }
  root.classList.remove('hidden');
}
export function hideLevelUp() { $('levelUp').classList.add('hidden'); }

export function showMainMenu(gold = 0, deaths = 0) {
  const g = $('menuGold');
  if (g) g.textContent = String(gold);
  const d = document.getElementById('menuDeaths');
  if (d) d.textContent = String(deaths);
  $('mainMenu').classList.remove('hidden');
}
export function hideMainMenu() { $('mainMenu').classList.add('hidden'); }

function shopPips(level, max) {
  let s = '';
  for (let i = 0; i < max; i++) s += `<span class="pip${i < level ? ' filled' : ''}"></span>`;
  return s;
}

export function showShop(gold, rows, onBuy) {
  $('shopGold').textContent = gold;
  const list = $('shopList');
  list.innerHTML = '';
  for (const r of rows) {
    const maxed = r.level >= r.max;
    const affordable = r.cost !== null && gold >= r.cost;
    const row = document.createElement('div');
    row.className = 'shopRow';
    row.innerHTML = `
      <div class="shopInfo">
        <div class="shopName">${r.name}</div>
        <div class="shopDesc">${r.effect} · Lv ${r.level}/${r.max}</div>
        <div class="shopPips">${shopPips(r.level, r.max)}</div>
      </div>
    `;
    const btn = document.createElement('button');
    btn.className = 'shopBuyBtn' + (maxed ? ' maxed' : (affordable ? '' : ' unaffordable'));
    btn.textContent = maxed ? 'MAX' : `◈ ${r.cost}`;
    btn.disabled = maxed;
    if (!maxed) btn.addEventListener('click', () => onBuy(r.id));
    row.appendChild(btn);
    list.appendChild(row);
  }
  $('shopMenu').classList.remove('hidden');
}
export function hideShop() { $('shopMenu').classList.add('hidden'); }

// Podium trophies for the top three runs — gold, silver, then a darker bronze. Each is a
// chunky pixel cup so it sits with the rest of the UI art; ranks 4+ just show their number.
const PODIUM = [
  { body: '#e0b23c', lit: '#ffe9a0', dark: '#8a6a1e' }, // gold
  { body: '#c2c8d0', lit: '#f0f4f8', dark: '#7d838c' }, // silver
  { body: '#a2662f', lit: '#d39257', dark: '#5e3a18' }, // bronze (darker, warmer)
];
function podiumTrophy(i) {
  const p = PODIUM[i];
  if (!p) return '';
  return `<svg class="podiumTrophy" viewBox="0 0 16 18" aria-label="Rank ${i + 1}">
    <rect x="4" y="14" width="8" height="2" fill="${p.dark}"/>
    <rect x="5" y="12" width="6" height="2" fill="${p.body}"/>
    <rect x="7" y="9"  width="2" height="3" fill="${p.dark}"/>
    <rect x="4" y="2"  width="8" height="7" fill="${p.body}"/>
    <rect x="4" y="2"  width="8" height="1" fill="${p.lit}"/>
    <rect x="5" y="3"  width="1" height="5" fill="${p.lit}"/>
    <path d="M4 9 L12 9 L10 11 L6 11 Z" fill="${p.body}"/>
    <rect x="2" y="3"  width="2" height="4" fill="${p.dark}"/>
    <rect x="12" y="3" width="2" height="4" fill="${p.dark}"/>
  </svg>`;
}

// `drawPortrait(canvas, classId)` paints the run's character beside their name. Older saved
// entries predate `classId`, so callers resolve it from the class name where they can.
// Local wall-clock time a record was set, 12-hour with am/pm. Entries saved before this
// column existed still carry a timestamp, so nothing needs migrating.
function fmtClock(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

// In-game confirmation, replacing window.confirm so it matches the game's look and can be
// driven by a controller. Yes is focused by default; the caller wires A/Enter and B/Esc.
export function showConfirm(message) {
  $('confirmMessage').textContent = message;
  $('confirmHint').innerHTML = confirmChoicePrompt(lastInputMode);
  $('confirmDialog').classList.remove('hidden');
  // Focus Yes so Enter/A acts on the obvious default without a stray click first.
  const yes = $('confirmYesBtn');
  if (yes) yes.focus();
}
export function hideConfirm() { $('confirmDialog').classList.add('hidden'); }

export function showLeaderboard(entries, drawPortrait) {
  const list = $('leaderboardList');
  list.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'leaderboardEmpty';
    empty.textContent = 'No runs recorded yet. Take up your blade.';
    list.appendChild(empty);
  } else {
    entries.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'leaderboardRow' + (e.victory ? ' victory' : '');
      row.innerHTML = `
        <div class="leaderboardRank">${podiumTrophy(i) || i + 1}</div>
        <div class="leaderboardFace"><canvas class="leaderboardFaceCanvas" width="52" height="60"></canvas></div>
        <div class="leaderboardClass">${e.className}${e.victory ? ' <span class="victoryMark" title="Run completed">✦</span>' : ''}<small>Level ${e.level} · ${e.endlessWave ? `Endless Wave ${e.endlessWave}` : `Stage ${e.stage || 1}`}</small></div>
        <div class="leaderboardStat"><b>${fmtTime(e.time)}</b>survived</div>
        <div class="leaderboardStat"><b>${e.kills}</b>kills</div>
        <div class="leaderboardStat"><b>${fmtClock(e.date)}</b>${new Date(e.date).toLocaleDateString()}</div>
      `;
      list.appendChild(row);
      if (drawPortrait) drawPortrait(row.querySelector('.leaderboardFaceCanvas'), e);
    });
  }
  $('leaderboardMenu').classList.remove('hidden');
}
export function hideLeaderboard() { $('leaderboardMenu').classList.add('hidden'); }

/**
 * The run-over screen.
 *
 * `beatFinalBoss` is NOT a victory here. Felling the Hollow Sovereign flips the run into endless
 * rather than ending it, so the only way to reach this screen at all is to die — which meant a
 * player who beat the boss and then died on endless wave 19 was congratulated with "Victory: all
 * three realms are cleansed" over their own corpse.
 *
 * The flag still matters, so it is kept and used for the SUBTITLE: dying at wave 19 having felled
 * the final boss is a different story from being overwhelmed in stage 1, and the screen should
 * tell the right one. The leaderboard keeps recording it as a victory, which is correct there —
 * that board is asking "did you ever beat the boss", not "how did this run end".
 */
/** Dismiss the results screen. Needed because B-to-go-back used to leave it on top of the menu. */
export function hideEndScreen() { $('endScreen').classList.add('hidden'); }

// How each damage kind is phrased on the death screen. The verb carries the whole difference
// between "a thing hit me" and "a thing I was already carrying finished me", which is exactly
// the question a player asks when a run ends with no enemy on top of them.
const DEATH_PHRASE = {
  dot: (src) => `${src} burned through the last of your life.`,
  contact: (src) => `${src} cut you down.`,
  slam: (src) => `${src} landed square on you.`,
  projectile: (src) => `${src} found its mark.`,
  skill: (src) => `${src} finished you.`,
  hit: (src) => `${src} finished you.`,
};

export function showEndScreen({ victory, time, level, kills, stage, wave, lastHit }, onRestart, onMainMenu) {
  const root = $('endScreen');
  $('endTitle').textContent = 'You Have Fallen';
  // Colour comes from a state class, not an inline style. The two hexes used to be hardcoded
  // here, which put them outside the palette entirely — and an inline style beats any
  // stylesheet rule, so this heading silently stayed the old brick red while every other
  // surface moved to the new one.
  $('endTitle').classList.remove('endVictory');
  $('endTitle').classList.add('endDefeat');
  $('endSubtitle').textContent = victory
    ? `The Hollow Sovereign fell, but the endless took you${wave ? ` at wave ${wave}` : ''}.`
    : 'The horde overwhelmed you.';
  $('endStats').innerHTML = `
    <div><span>Time Survived</span><b>${fmtTime(time)}</b></div>
    <div><span>${wave ? 'Wave Reached' : 'Stage Reached'}</span><b>${wave || stage}</b></div>
    <div><span>Level Reached</span><b>${level}</b></div>
    <div><span>Kills</span><b>${kills}</b></div>
  `;
  // The killing blow, named. Its own band under the stats rather than another stat cell,
  // because it is a sentence about the run and not a number to compare — and because a
  // damage-over-time death has no enemy standing over the body to explain itself.
  const blow = $('endKillingBlow');
  if (blow) {
    if (lastHit) {
      const phrase = (DEATH_PHRASE[lastHit.kind] || DEATH_PHRASE.hit)(lastHit.src);
      blow.innerHTML = `<span class="endBlowLabel">Killing Blow</span>`
        + `<span class="endBlowText">${phrase}</span>`
        + `<span class="endBlowDmg">${lastHit.amount} damage</span>`;
      blow.classList.remove('hidden');
    } else {
      blow.classList.add('hidden');
    }
  }
  root.classList.remove('hidden');
  const btn = $('endRestartBtn');
  const clean = btn.cloneNode(true);
  btn.replaceWith(clean);
  clean.addEventListener('click', () => { root.classList.add('hidden'); onRestart(); });

  const menuBtn = $('endMenuBtn');
  const cleanMenu = menuBtn.cloneNode(true);
  menuBtn.replaceWith(cleanMenu);
  cleanMenu.addEventListener('click', () => { root.classList.add('hidden'); onMainMenu(); });
}

// HUD support-gem tray. Off by default: supports read better as text in the pause menu's
// modifier panels than as unlabelled letter chips under the skill bar.
const SHOW_SUPPORT_TRAY = true;

// Compact vector icons for each skill's `icon` tag, tinted with the skill's accent.
const SKILL_ICONS = {
  scythe: '<svg viewBox="0 0 24 24"><g fill="none" stroke="#6b4f2e" stroke-width="2.2" stroke-linecap="round"><path d="M15.5 4.5 L9 21"/></g><path d="M15.5 4.5 C 9.5 3.2, 4.6 6.4, 3.4 11.6 C 6.2 7.6, 10.8 6.2, 15.2 7.6 Z" fill="currentColor"/><path d="M15.5 4.5 C 9.5 3.2, 4.6 6.4, 3.4 11.6" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.75"/></svg>',
  sword: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="#0e0a06" stroke-width="0.5" stroke-linejoin="round"><path d="M12 1.4 L13.7 4.8 L13.7 13.4 L10.3 13.4 L10.3 4.8 Z"/><rect x="5.4" y="13.4" width="13.2" height="2.7" rx="0.7"/><rect x="10.5" y="16.1" width="3" height="4.3"/><circle cx="12" cy="21.3" r="1.9"/></g><path d="M11.7 4.9 L11.7 13" stroke="#ffe6a0" stroke-width="0.9" opacity="0.55"/></svg>',
  fireball: '<svg viewBox="0 0 24 24"><path d="M12 2 C 9 7, 11 10, 12 13 C 10 12, 8.5 10, 9 7.5 C 6.5 10.5, 6 16, 9.5 20 C 11 21.5, 13 21.5, 15 20 C 18.5 16.5, 18 10, 12 2 Z" fill="currentColor"/><path d="M12 16 C 10.5 15, 10.5 12.5, 12 11 C 13.5 12.5, 13.5 15, 12 16 Z" fill="#ffe6a0" opacity="0.7"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><g transform="rotate(-45 12 12)"><path d="M2 8.4 L7.6 12 L2 15.6 L3.6 12 Z" fill="#8a9a5a"/><path d="M4 9.6 L8.4 12 L4 14.4 L5.2 12 Z" fill="#a8b86a"/><rect x="5" y="11.2" width="12" height="1.6" fill="#7a6540"/><rect x="5" y="11.2" width="12" height="0.6" fill="#a08a5a"/><path d="M16 9.2 L22.4 12 L16 14.8 Z" fill="#cdd4df"/><path d="M16.8 10.8 L20.2 12 L16.8 13.2 Z" fill="#8a929e"/></g></svg>',
  nova: '<svg viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3 V21 M3 12 H21 M5.5 5.5 L18.5 18.5 M18.5 5.5 L5.5 18.5"/><path d="M12 3 L10.5 5.5 M12 3 L13.5 5.5 M12 21 L10.5 18.5 M12 21 L13.5 18.5 M3 12 L5.5 10.5 M3 12 L5.5 13.5 M21 12 L18.5 10.5 M21 12 L18.5 13.5"/></g></svg>',
  // A faceted charge mid-arc with a lit fuse-spark, over its own ground shadow — the silhouette
  // says "thrown and about to go off", which is what separates it from Ice Nova's static burst.
  icebomb: '<svg viewBox="0 0 24 24">'
    + '<ellipse cx="12" cy="20.4" rx="5.2" ry="1.6" fill="#0e0a06" opacity="0.4"/>'
    + '<path d="M12 4.2 L17.4 8 L15.6 15.2 L8.4 15.2 L6.6 8 Z" fill="currentColor"/>'
    + '<path d="M12 4.2 L17.4 8 L12 10.2 Z" fill="#ffffff" opacity="0.42"/>'
    + '<path d="M12 10.2 L15.6 15.2 L8.4 15.2 Z" fill="#0e0a06" opacity="0.28"/>'
    + '<g stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.9">'
    + '<path d="M12 3.4 L12 1.4 M14.6 4.2 L16 2.8 M9.4 4.2 L8 2.8"/></g></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 2 L5 13 L11 13 L9 22 L19 9 L12.5 9 Z" fill="currentColor"/></svg>',
  bone: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="#0e0a06" stroke-width="0.5" stroke-linejoin="round"><rect x="9.4" y="5" width="5.2" height="14" rx="1.2"/><circle cx="8.8" cy="5.6" r="3"/><circle cx="15.2" cy="5.6" r="3"/><circle cx="8.8" cy="18.4" r="3"/><circle cx="15.2" cy="18.4" r="3"/></g></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 1.5 L14.4 9.6 L22.5 12 L14.4 14.4 L12 22.5 L9.6 14.4 L1.5 12 L9.6 9.6 Z" fill="currentColor" stroke="#0e0a06" stroke-width="0.5" stroke-linejoin="round"/><circle cx="12" cy="12" r="1.6" fill="#0e0a06"/></svg>',
  shard: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="#0e0a06" stroke-width="0.4" stroke-linejoin="round"><path d="M12 3 L13.4 12 L12 15 L10.6 12 Z"/><path d="M19.5 6 L15.5 13 L13.4 14.6 L16 8 Z" opacity="0.8"/><path d="M4.5 6 L8.5 13 L10.6 14.6 L8 8 Z" opacity="0.8"/></g></svg>',
  beam: '<svg viewBox="0 0 24 24"><rect x="0.8" y="10.5" width="15.4" height="3" fill="currentColor"/><rect x="0.8" y="11.4" width="15.4" height="1.2" fill="#ffe6a0" opacity="0.75"/><circle cx="17.1" cy="12" r="4" fill="currentColor"/><circle cx="17.1" cy="12" r="2" fill="#ffe6a0"/><g stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M20.4 8.6 L22.3 6.7"/><path d="M21.5 12 L23.5 12"/><path d="M20.4 15.4 L22.3 17.3"/><path d="M17.1 7.4 L17.1 5.3"/><path d="M17.1 16.6 L17.1 18.7"/></g></svg>',
  spark: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="#0e0a06" stroke-width="0.8" stroke-linejoin="round"><g transform="translate(12 9.2) scale(0.62)"><path d="M1 -10 L-7 1 L-1 1 L-3 10 L7 -3 L0.5 -3 Z"/></g><g transform="translate(7.4 11) rotate(-35) scale(0.5)" opacity="0.8"><path d="M1 -10 L-7 1 L-1 1 L-3 10 L7 -3 L0.5 -3 Z"/></g><g transform="translate(16.6 11) rotate(35) scale(0.5)" opacity="0.8"><path d="M1 -10 L-7 1 L-1 1 L-3 10 L7 -3 L0.5 -3 Z"/></g></g></svg>',
  skull: '<svg viewBox="0 0 24 24"><path d="M12 3 C 6.5 3, 4 6.5, 4 11 C 4 13.5, 5.5 14.5, 6 16 L6 19 L9 19 L9 21 L11 21 L11 18 L13 18 L13 21 L15 21 L15 19 L18 19 L18 16 C 18.5 14.5, 20 13.5, 20 11 C 20 6.5, 17.5 3, 12 3 Z" fill="currentColor"/><circle cx="9" cy="11" r="2.1" fill="#0e0a06"/><circle cx="15" cy="11" r="2.1" fill="#0e0a06"/><path d="M12 13 L10.6 16 L13.4 16 Z" fill="#0e0a06"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M6.5 18 C 3.5 18, 3.5 13.5, 6.5 13.5 C 5.5 9.5, 11 8, 12.5 12 C 15.5 9, 20.5 12.5, 18 15.5 C 20.5 16.5, 19 19.5, 16 18.5 C 14.5 20, 8.5 20, 6.5 18 Z" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="#0e0a06" opacity="0.5"/><circle cx="14" cy="14" r="1.5" fill="#0e0a06" opacity="0.5"/></svg>',
  flask: '<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="2.4" fill="currentColor"/><path d="M9.5 4 L9.5 9 L5 18 C 4 20.2, 5.5 21.5, 8 21.5 L16 21.5 C 18.5 21.5, 20 20.2, 19 18 L14.5 9 L14.5 4 Z" fill="currentColor"/><path d="M6.6 15 L17.4 15 L18.4 17.5 C 18 19.5, 6 19.5, 5.6 17.5 Z" fill="#0e0a06" opacity="0.35"/></svg>',
  flamestream: '<svg viewBox="0 0 24 24"><rect x="1.4" y="10.4" width="4.6" height="3.2" rx="0.7" fill="currentColor"/><path d="M6 12 C 10 9.5, 13 9.2, 16 7.4 C 15 9.6, 13.6 10.8, 11.6 11.6 C 15 11.6, 18.6 10.4, 22.2 8 C 20 12, 17.5 13.6, 14 14 C 17 14.8, 19.6 16, 21.6 18.2 C 16 16.6, 10 15.6, 6 12 Z" fill="currentColor"/><path d="M7 12 C 10 10.6, 12 10.4, 14.4 9.4 C 13.4 11, 12.2 11.7, 10.8 12.1 C 13 12.4, 15 13.2, 16.8 14.4 C 12.6 13.6, 9 13.2, 7 12 Z" fill="#ffe6a0" opacity="0.65"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M13 2 C 10 6, 12 9, 13 11 C 11 10, 10 8, 10.5 6 C 7.5 9, 7 14, 10 17.5 C 11.5 19, 14 19, 16 17.5 C 19 15, 18.5 9, 13 2 Z" fill="currentColor"/><line x1="4" y1="21" x2="20" y2="21" stroke="currentColor" stroke-width="1.6" opacity="0.45"/></svg>',

  // ---- the void line ----
  // All seven share one rule: the void is a HOLE, so each icon has a dark centre and its
  // meaning is carried by what is being pulled into it. That keeps them legible as a family in
  // the gem tray while staying distinct from each other at 24px.
  // Four arrows raked inward toward a dark crescent — the sweep that gathers.
  gravepull: '<svg viewBox="0 0 24 24"><path d="M3.4 7 C 8 3.4, 16 3.4, 20.6 7 C 17.6 6, 6.4 6, 3.4 7 Z" fill="currentColor"/>'
    + '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none">'
    + '<path d="M5 21 L8.4 14.4"/><path d="M11 22 L12 14.6"/><path d="M17.6 21.2 L14.6 14.6"/></g>'
    + '<g fill="currentColor"><path d="M8.4 13.4 L10.4 16.4 L6.6 16.6 Z"/><path d="M12 13.6 L14 16.8 L10.1 16.8 Z"/><path d="M14.6 13.6 L17.4 16.6 L13.6 16.8 Z"/></g></svg>',
  // A drifting hole with a motion wake behind it.
  maw: '<svg viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.6">'
    + '<path d="M2 8.5 L7 10"/><path d="M1.6 12 L6.6 12"/><path d="M2 15.5 L7 14"/></g>'
    + '<circle cx="15" cy="12" r="7.4" fill="currentColor"/>'
    + '<circle cx="15" cy="12" r="4.2" fill="#0e0a06"/>'
    + '<path d="M15 4.6 A 7.4 7.4 0 0 1 22.4 12" fill="none" stroke="#ffffff" stroke-width="1.2" opacity="0.6"/></svg>',
  // A bar being eaten away from the right: what Unmaking does to a health bar.
  unmake: '<svg viewBox="0 0 24 24"><rect x="2" y="9.4" width="12" height="5.2" rx="1" fill="currentColor"/>'
    + '<g fill="currentColor" opacity="0.55"><rect x="14.6" y="9.4" width="2.4" height="5.2" rx="0.6"/>'
    + '<rect x="17.8" y="10.4" width="1.8" height="3.2" rx="0.5" opacity="0.7"/>'
    + '<rect x="20.4" y="11.2" width="1.3" height="1.6" rx="0.4" opacity="0.5"/></g>'
    + '<rect x="2" y="9.4" width="12" height="1.6" rx="0.8" fill="#ffffff" opacity="0.35"/></svg>',
  // Concentric rings closing on a black core — the placed collapse.
  horizon: '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5">'
    + '<circle cx="12" cy="12" r="10.2" opacity="0.35"/><circle cx="12" cy="12" r="7.2" opacity="0.6"/>'
    + '<circle cx="12" cy="12" r="4.4" opacity="0.9"/></g>'
    + '<circle cx="12" cy="12" r="2.6" fill="#0e0a06" stroke="currentColor" stroke-width="1.2"/>'
    + '<g fill="currentColor"><path d="M12 1 L13.4 3.4 L10.6 3.4 Z"/><path d="M12 23 L10.6 20.6 L13.4 20.6 Z"/>'
    + '<path d="M1 12 L3.4 10.6 L3.4 13.4 Z"/><path d="M23 12 L20.6 13.4 L20.6 10.6 Z"/></g></svg>',
  // Three stacking pips over a cracked core: the mark that detonates on the third.
  entropy: '<svg viewBox="0 0 24 24"><circle cx="12" cy="14.6" r="6.6" fill="currentColor"/>'
    + '<path d="M12 8.6 L9.6 14 L12.8 14.6 L10.6 20.4 L15 14.2 L11.8 13.6 Z" fill="#0e0a06"/>'
    + '<g fill="currentColor"><circle cx="6.6" cy="4.4" r="2"/><circle cx="12" cy="3.4" r="2"/><circle cx="17.4" cy="4.4" r="2"/></g></svg>',
  // A hooded silhouette with nothing inside it.
  shade: '<svg viewBox="0 0 24 24"><path d="M12 2.4 C 7.4 2.4, 5.2 6.6, 5.4 11 C 5.6 15, 6.4 17.6, 5.2 21.4 '
    + 'C 7.6 20.2, 8.6 21.6, 12 21.6 C 15.4 21.6, 16.4 20.2, 18.8 21.4 '
    + 'C 17.6 17.6, 18.4 15, 18.6 11 C 18.8 6.6, 16.6 2.4, 12 2.4 Z" fill="currentColor"/>'
    + '<path d="M12 5.6 C 9.4 5.6, 8.2 8, 8.4 10.8 C 8.6 13, 9.6 14.2, 12 14.2 '
    + 'C 14.4 14.2, 15.4 13, 15.6 10.8 C 15.8 8, 14.6 5.6, 12 5.6 Z" fill="#0e0a06"/>'
    + '<g fill="currentColor"><circle cx="10.2" cy="10" r="1.1"/><circle cx="13.8" cy="10" r="1.1"/></g></svg>',
  // ---- mobility ----
  // A figure mid-tumble: three motion arcs behind a rolling ball.
  roll: '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round">'
    + '<path d="M3.4 16.6 A 9 9 0 0 1 7.4 6.4" stroke-width="1.4" opacity="0.35"/>'
    + '<path d="M6 17.6 A 7 7 0 0 1 9.4 8.6" stroke-width="1.5" opacity="0.6"/></g>'
    + '<circle cx="14.6" cy="13.4" r="6" fill="currentColor"/>'
    + '<path d="M14.6 7.4 A 6 6 0 0 1 20.6 13.4" fill="none" stroke="#ffffff" stroke-width="1.2" opacity="0.6"/>'
    + '<circle cx="14.6" cy="13.4" r="2" fill="#0e0a06" opacity="0.55"/></svg>',
  // Two figures, the first already emptied: departure and arrival of one body.
  blink: '<svg viewBox="0 0 24 24">'
    + '<g fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.45">'
    + '<circle cx="6.6" cy="8" r="2.4"/><path d="M6.6 10.8 L6.6 16.2 M6.6 12 L3.8 14.6 M6.6 12 L9.4 14.6"/></g>'
    + '<g stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.6">'
    + '<path d="M10.6 6.4 L13 5.6 M10.8 11.8 L13.2 11.8 M10.6 17.2 L13 18"/></g>'
    + '<g fill="currentColor"><circle cx="17.6" cy="8" r="2.6"/>'
    + '<path d="M17.6 10.8 L17.6 16.4 L15 20.4 L16.8 20.4 L17.6 18.6 L18.4 20.4 L20.2 20.4 L17.6 16.4 Z"/>'
    + '<path d="M17.6 11.6 L14.6 14.8 L15.8 15.8 L17.6 13.6 L19.4 15.8 L20.6 14.8 Z"/></g></svg>',
  // A shield whose centre is a hole, with a swallowed shot on its way in.
  ward: '<svg viewBox="0 0 24 24"><path d="M12 1.6 L21 4.6 L21 11.4 C 21 17, 17 20.6, 12 22.4 '
    + 'C 7 20.6, 3 17, 3 11.4 L3 4.6 Z" fill="currentColor"/>'
    + '<circle cx="12" cy="11.4" r="4.6" fill="#0e0a06"/>'
    + '<circle cx="12" cy="11.4" r="4.6" fill="none" stroke="#ffffff" stroke-width="0.9" opacity="0.5"/>'
    + '<g stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.75">'
    + '<path d="M12 3.4 L12 6.2"/></g>'
    + '<path d="M12 6.4 L13.4 4.2 L10.6 4.2 Z" fill="#ffffff" opacity="0.8"/></svg>',
  // A broken ring of grains with three shapes shoved outward from it. Deliberately NOT the ward
  // shield: both are wards, and if they shared a glyph the tray would stop telling you which one
  // you are holding — the same reason every tome keeps its own sigil.
  saltcircle: '<svg viewBox="0 0 24 24">'
    + '<g fill="currentColor">'
    + '<circle cx="12" cy="4.6" r="1.5"/><circle cx="16.6" cy="6.2" r="1.35"/>'
    + '<circle cx="19.4" cy="10.2" r="1.5"/><circle cx="19" cy="14.8" r="1.35"/>'
    + '<circle cx="16" cy="18.2" r="1.5"/><circle cx="12" cy="19.4" r="1.35"/>'
    + '<circle cx="8" cy="18.2" r="1.5"/><circle cx="5" cy="14.8" r="1.35"/>'
    + '<circle cx="4.6" cy="10.2" r="1.5"/><circle cx="7.4" cy="6.2" r="1.35"/>'
    + '</g>'
    + '<g stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" opacity="0.85">'
    + '<path d="M12 10.6 L12 7.4"/><path d="M9.1 12.6 L6.6 14.6"/><path d="M14.9 12.6 L17.4 14.6"/>'
    + '</g></svg>',
};

// ---------- Tome icons ----------
// Every tome is the same closed book, distinguished only by the sigil stamped on its cover.
// Holding the silhouette constant is the point: a tome should read as "a tome" at a glance,
// with the sigil telling you which one — the same way the skill gems share a gem shape.
// The cover takes `currentColor` so each tome's own colour drives it.
const TOME_BODY =
  '<path d="M4.2 3.2 C 4.2 2.5, 4.7 2.1, 5.4 2.1 L17.6 2.1 C 18.5 2.1, 19.2 2.7, 19.2 3.6 L19.2 20.4 C 19.2 21.3, 18.5 21.9, 17.6 21.9 L5.4 21.9 C 4.7 21.9, 4.2 21.5, 4.2 20.8 Z" fill="currentColor"/>' +
  '<rect x="4.2" y="2.1" width="2.9" height="19.8" fill="#0e0a06" opacity="0.42"/>' +
  '<rect x="17.4" y="3.4" width="1.9" height="17.2" fill="#e8dcc0" opacity="0.8"/>' +
  '<rect x="17.4" y="3.4" width="1.9" height="17.2" fill="none" stroke="#0e0a06" stroke-width="0.4" opacity="0.5"/>' +
  '<path d="M5.6 2.1 L5.6 21.9" stroke="#ffe6a0" stroke-width="0.5" opacity="0.3"/>';
const tome = (sigil) => `<svg viewBox="0 0 24 24">${TOME_BODY}<g transform="translate(12.2 12) scale(0.9)" fill="none" stroke="#ffe6a0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.92">${sigil}</g></svg>`;

const TOME_ICONS = {
  // chevron stack — force driven downward
  addeddamage:   tome('<path d="M-3.4 -1.4 L0 -4.4 L3.4 -1.4"/><path d="M-3.4 3 L0 0 L3.4 3"/>'),
  // three darts fanning out
  multiproj:     tome('<path d="M-3.6 -3.6 L3.6 -3.6"/><path d="M-3.6 0 L4.4 0"/><path d="M-3.6 3.6 L3.6 3.6"/><path d="M2 -5.2 L3.8 -3.6 L2 -2"/><path d="M2.8 -1.6 L4.6 0 L2.8 1.6"/><path d="M2 2 L3.8 3.6 L2 5.2"/>'),
  // hourglass running fast
  fasterattacks: tome('<path d="M-3 -4.2 L3 -4.2 L-3 4.2 L3 4.2 Z"/><path d="M-3.8 -4.2 L3.8 -4.2"/><path d="M-3.8 4.2 L3.8 4.2"/>'),
  // widening rings
  increasedarea: tome('<circle cx="0" cy="0" r="1.5"/><circle cx="0" cy="0" r="4.3" opacity="0.6"/>'),
  // a shaft driven clean through a barrier
  pierce:        tome('<path d="M-4.6 0 L4.6 0"/><path d="M2.8 -1.8 L4.8 0 L2.8 1.8"/><path d="M0 -4 L0 4" opacity="0.55"/>'),
  // two interlocked links
  chain:         tome('<rect x="-4.6" y="-2" width="5" height="4" rx="2"/><rect x="-0.4" y="-2" width="5" height="4" rx="2"/>'),
  // a drawn drop
  lifeleech:     tome('<path d="M0 -4.4 C 2.6 -1.4, 3.6 0.2, 3.6 1.8 A 3.6 3.6 0 0 1 -3.6 1.8 C -3.6 0.2, -2.6 -1.4, 0 -4.4 Z"/>'),
  // a healer's cross — the plainest possible "this restores you" mark
  hpregen:       tome('<path d="M0 -4.2 L0 4.2"/><path d="M-4.2 0 L4.2 0"/>'),
  // a struck spark
  critchance:    tome('<path d="M0 -4.6 L1.2 -1.2 L4.6 0 L1.2 1.2 L0 4.6 L-1.2 1.2 L-4.6 0 L-1.2 -1.2 Z"/>'),
  // the same spark, driven harder — pulled in to make room for the impact rays thrown off it.
  // Deliberately built from critchance's shape rather than a new one: they are the two halves of
  // the same mechanic, and the pair should read as related at a glance.
  critdamage:    tome('<path d="M0 -3.4 L0.9 -0.9 L3.4 0 L0.9 0.9 L0 3.4 L-0.9 0.9 L-3.4 0 L-0.9 -0.9 Z"/><path d="M2.4 -2.4 L4.4 -4.4"/><path d="M-2.4 -2.4 L-4.4 -4.4"/><path d="M2.4 2.4 L4.4 4.4"/><path d="M-2.4 2.4 L-4.4 4.4"/>'),
  // a clock face
  duration:      tome('<circle cx="0" cy="0" r="4.2"/><path d="M0 -2.4 L0 0 L2 1.4"/>'),
  // one path splitting into two
  forking:       tome('<path d="M-4.2 0 L-0.6 0"/><path d="M-0.6 0 L3.6 -3.4"/><path d="M-0.6 0 L3.6 3.4"/><path d="M1.8 -3.8 L4.2 -3.8 L4.2 -1.6"/><path d="M1.8 3.8 L4.2 3.8 L4.2 1.6"/>'),
};

// ---------- The life bar's damage flash ----------
// A bar that eases toward its new value hides the one thing the player needs in the instant
// they are hit: HOW BIG that hit was. The slide looks the same for a scratch and for half a
// health pool, and by the time it settles the moment has passed.
//
// So the fill snaps, and the damage is shown as a white block standing in the gap the hit just
// opened — sized to that hit alone, held briefly, then removed outright. No fade: a fade is the
// same soft motion in another costume.
const HP_FLASH_MS = 220;
let hpLast = null;        // the health this bar last drew, to size each loss against
let hpFlashTimer = null;

function updateHpBar(hp, maxHp) {
  const fill = $('hpFill');
  const loss = $('hpLoss');
  const pct = Math.max(0, (hp / maxHp) * 100);
  if (fill) fill.style.width = `${pct}%`;
  $('hpText').textContent = `${Math.ceil(hp)} / ${maxHp}`;

  if (loss) {
    // Only DAMAGE flashes. Healing, a new run, or a max-life change must not paint a block.
    const dropped = hpLast !== null && hp < hpLast && maxHp > 0;
    if (dropped) {
      const fromPct = Math.max(0, (hpLast / maxHp) * 100);
      loss.style.left = `${pct}%`;
      loss.style.width = `${Math.max(0.6, fromPct - pct)}%`;
      loss.classList.add('show');
      // Restarted, not queued: a second hit during the flash should show ITS OWN size from the
      // new edge rather than extending the old block, so rapid hits read as separate events.
      clearTimeout(hpFlashTimer);
      hpFlashTimer = setTimeout(() => loss.classList.remove('show'), HP_FLASH_MS);
    }
  }
  hpLast = hp;
}

/** Forget the last-seen health, so starting a run cannot flash the previous one's final hit. */
export function resetHpBar() { hpLast = null; if ($('hpLoss')) $('hpLoss').classList.remove('show'); }

export function updateHUD(d) {
  updateHpBar(d.hp, d.maxHp);
  // Armor is now a real pool — shield units standing out of a maximum — so the bar fills
  // against an actual capacity instead of the invented reference this used to need.
  //
  // A class with no armor at all (the Sorceress) hides the row entirely rather than showing a
  // permanently empty "0 / 0" bar, which reads as broken rather than as "not your mechanic".
  const armor = d.armor || 0, maxArmor = d.maxArmor || 0;
  const armorRow = document.getElementById('armorRow');
  if (armorRow) armorRow.classList.toggle('hidden', maxArmor <= 0);
  if (maxArmor > 0) {
    $('armorFill').style.width = `${(armor / maxArmor) * 100}%`;
    $('armorText').textContent = `${Math.round(armor)} / ${maxArmor}`;
  }
  $('xpFill').style.width = `${Math.max(0, (d.xp / d.xpToNext) * 100)}%`;
  $('levelText').textContent = `Lv ${d.level}`;
  $('killsText').textContent = `☠ ${d.kills}`;
  // `endlessWave` is already incremented when a wave begins, so it IS the current wave —
  // the old `+ 1` here put the HUD a wave ahead of the title card that announced it.
  $('stageText').textContent = d.endlessWave
    ? `Endless — Wave ${d.endlessWave}`
    : (d.stageName ? `Stage ${d.stage} — ${d.stageName}` : `Stage ${d.stage}`);
  $('goldText').textContent = d.gold;
  const kc = document.getElementById('keyCountText');
  if (kc) kc.textContent = d.keys || 0;
  // The whole key counter hides while chests are switched off, rather than sitting at a
  // permanent 0 and implying a system that no longer drops anything.
  const kg = document.getElementById('keyCounter');
  if (kg) kg.classList.toggle('hidden', !d.chestsEnabled);

  // Timer counts UP, recording the round's time until the boss is slain.
  // While a stage portal stands, the timer is TEMPORARILY given over to the siege clock: it
  // restarts from zero, turns the UI red and beats faster the longer the player stays. The run
  // clock (d.elapsed) is untouched and still running — it simply is not what is on screen — so
  // stepping through the portal brings it back at its true value, not at zero.
  const timer = $('timerText');
  // A gambit takes the clock over from everything else while it runs: it is the only thing on
  // screen with a deadline, and a countdown you cannot see is a wager you cannot play around.
  if (d.gambit) {
    timer.textContent = d.gambit.t.toFixed(1);
    timer.classList.add('hudTimePressure');
    // Beats faster as the wager closes — same language as the portal siege, opposite direction.
    timer.style.animationDuration = `${(1.0 - 0.72 * (1 - d.gambit.t / d.gambit.total)).toFixed(2)}s`;
  } else if (d.pressure) {
    timer.textContent = fmtTime(d.pressure.t);
    timer.classList.add('hudTimePressure');
    // Pulse period, driven from JS because it has to accelerate: 1.1s at the start down to
    // 0.28s at full intensity. Set as a style so the CSS keyframes stay a fixed animation.
    timer.style.animationDuration = `${(1.1 - 0.82 * d.pressure.level).toFixed(2)}s`;
  } else {
    timer.textContent = fmtTime(d.elapsed);
    timer.classList.remove('hudTimePressure');
    timer.style.animationDuration = '';
  }
  // bossMaxHp guards the gap between the boss dying and the stage ending: with the stage portal
  // the run carries on after the kill, and `bossSpawned` alone would keep an empty bar up.
  if (d.bossSpawned && d.bossMaxHp > 0) {
    $('bossBar').classList.remove('hidden');
    $('bossBarLabel').textContent = d.bossName || 'Boss';
    $('bossFill').style.width = `${Math.max(0, (d.bossHp / d.bossMaxHp) * 100)}%`;
  } else {
    $('bossBar').classList.add('hidden');
  }

  const tray = $('skillTray');
  tray.innerHTML = '';
  for (const s of d.skills) {
    const el = document.createElement('div');
    el.className = 'gemIcon';
    el.style.setProperty('--accent', s.def.color);
    el.title = `${s.def.name} (Lv ${s.level})`;
    const cdRatio = s.cd > 0 ? Math.min(1, s.cd / ((s.cdMax || s.def.cooldownBase) * 1.2)) : 0;
    const icon = SKILL_ICONS[s.def.icon] || `<span>${s.def.name[0]}</span>`;
    el.innerHTML = `${icon}<small>${s.level}</small><div class="gemCd" style="height:${cdRatio * 100}%"></div>`;
    tray.appendChild(el);
  }
  // The dash sits with the skills because it IS one from the player's side — a thing on a
  // cooldown you are watching for. Same gem shape and the same downward-draining fill, so it
  // reads as part of the row rather than as a separate widget parked next to it.
  //
  // Shown ONLY while something is recharging. At full charges it is not information, and a
  // permanently-lit chip in a row of real skills would just be a slot that never does anything.
  if (d.dash && d.dash.charges < d.dash.max) {
    const el = document.createElement('div');
    el.className = 'gemIcon dashChip';
    // The chip wears whatever occupies the mobility slot \u2014 icon, colour and name \u2014 so a swap
    // is visible on the HUD the moment it lands, not just in how the button behaves.
    el.style.setProperty('--accent', d.dash.color || '#cdd3dd');
    el.title = `${d.dash.name || 'Dodge'} (${d.dash.charges}/${d.dash.max})`;
    // Same ratio convention as a skill: full height at the start of the wait, draining to none.
    const cdRatio = d.dash.cd > 0 ? Math.min(1, d.dash.cd / d.dash.cdMax) : 0;
    const glyph = (d.dash.icon && SKILL_ICONS[d.dash.icon])
      ? SKILL_ICONS[d.dash.icon] : '<span class="dashGlyph">\u00bb</span>';
    el.innerHTML = `${glyph}<small>${d.dash.charges}</small>`
      + `<div class="gemCd" style="height:${cdRatio * 100}%"></div>`;
    tray.appendChild(el);
  }

  // Tomes held this run, in the top-right under the gold counter. The pause screen still lists
  // what they DO; this is just what you are carrying, which is the part worth seeing at a
  // glance while playing.
  const supTray = $('supportTray');
  supTray.classList.toggle('hidden', !SHOW_SUPPORT_TRAY);
  if (!SHOW_SUPPORT_TRAY) return;
  supTray.innerHTML = '';
  for (const s of d.supports) {
    const el = document.createElement('div');
    el.className = 'gemIconSmall';
    el.style.setProperty('--accent', s.def.color);
    el.title = `${s.def.name} (Lv ${s.lvl})`;
    // Glyph, not the name's first letter: Damage/Duration, Swiftness/Scale and the two Crits
    // all share theirs, and a HUD chip has no room to disambiguate.
    el.innerHTML = `<span>${s.def.icon || s.def.name[0]}</span><small>${s.lvl}</small>`;
    supTray.appendChild(el);
  }
}

export function showPauseMenu() { $('pauseMenu').classList.remove('hidden'); }
export function hidePauseMenu() { $('pauseMenu').classList.add('hidden'); }

export function showSettingsMenu({ inputPromptMode, connectedPads, activeGamepadId, musicVolume, sfxVolume, displayMode, renderScale, uiScale, showDevTools, showPerfPanel }, onSelectInputMode, onSelectController, onMusicVolume, onSfxVolume, dev, extra) {
  const inputOpts = $('inputModeOptions');
  inputOpts.innerHTML = '';
  const modes = [
    { id: 'auto', label: 'Auto', desc: 'Switches based on your last input' },
    { id: 'keyboard', label: 'Keyboard', desc: 'Always show keyboard prompts' },
    { id: 'gamepad', label: 'Gamepad', desc: 'Always show Xbox-style prompts' },
  ];
  for (const m of modes) {
    const btn = document.createElement('button');
    btn.className = 'settingOption' + (m.id === inputPromptMode ? ' active' : '');
    btn.innerHTML = `<div class="settingOptionLabel">${m.label}</div><div class="settingOptionDesc">${m.desc}</div>`;
    btn.addEventListener('click', () => onSelectInputMode(m.id));
    inputOpts.appendChild(btn);
  }

  const ctrlOpts = $('controllerOptions');
  ctrlOpts.innerHTML = '';
  const autoBtn = document.createElement('button');
  autoBtn.className = 'settingOption' + (!activeGamepadId ? ' active' : '');
  autoBtn.innerHTML = `<div class="settingOptionLabel">Auto</div><div class="settingOptionDesc">Best guess (prefers standard-mapped devices)</div>`;
  autoBtn.addEventListener('click', () => onSelectController(null));
  ctrlOpts.appendChild(autoBtn);
  for (const gp of connectedPads) {
    const btn = document.createElement('button');
    btn.className = 'settingOption' + (activeGamepadId === gp.id ? ' active' : '');
    btn.innerHTML = `<div class="settingOptionLabel">${gp.id.slice(0, 40)}</div><div class="settingOptionDesc">mapping: ${gp.mapping || '(none)'}</div>`;
    btn.addEventListener('click', () => onSelectController(gp.id));
    ctrlOpts.appendChild(btn);
  }
  if (!connectedPads.length) {
    const none = document.createElement('div');
    none.className = 'settingOptionDesc';
    none.textContent = 'No controllers detected right now.';
    ctrlOpts.appendChild(none);
  }

  const musicRange = $input('musicVolumeRange');
  const musicValue = $('musicVolumeValue');
  musicRange.value = String(Math.round(musicVolume * 100));
  musicValue.textContent = Math.round(musicVolume * 100) + '%';
  musicRange.oninput = () => {
    const v = Number(musicRange.value) / 100;
    musicValue.textContent = Math.round(v * 100) + '%';
    onMusicVolume(v);
  };

  const sfxRange = $input('sfxVolumeRange');
  const sfxValue = $('sfxVolumeValue');
  sfxRange.value = String(Math.round(sfxVolume * 100));
  sfxValue.textContent = Math.round(sfxVolume * 100) + '%';
  sfxRange.oninput = () => {
    const v = Number(sfxRange.value) / 100;
    sfxValue.textContent = Math.round(v * 100) + '%';
    onSfxVolume(v);
  };

  // Graphics: windowed vs borderless fullscreen.
  const dispOpts = $('displayModeOptions');
  dispOpts.innerHTML = '';
  for (const m of [{ id: 'windowed', label: 'Windowed', desc: 'Default resizable window' }, { id: 'borderless', label: 'Borderless', desc: 'Fills the whole screen' }]) {
    const btn = document.createElement('button');
    btn.className = 'settingOption' + (displayMode === m.id ? ' active' : '');
    btn.innerHTML = `<div class="settingOptionLabel">${m.label}</div><div class="settingOptionDesc">${m.desc}</div>`;
    if (extra) btn.addEventListener('click', () => extra.onSelectDisplayMode(m.id));
    dispOpts.appendChild(btn);
  }

  // Resolution and UI Scale. Both are pick-one lists of numbers, so they share one builder —
  // the only difference is which setting they read and which handler they call. Comparison is
  // on a rounded value because these round-trip through JSON and a stored 0.7500000001 would
  // otherwise leave nothing highlighted.
  const scalePicker = (nodeId, current, choices, onPick) => {
    const box = $(nodeId);
    if (!box) return;
    box.innerHTML = '';
    const near = (a, b) => Math.round(a * 100) === Math.round(b * 100);
    for (const c of choices) {
      const btn = document.createElement('button');
      btn.className = 'settingOption' + (near(current || 1, c.value) ? ' active' : '');
      btn.innerHTML = `<div class="settingOptionLabel">${c.label}</div><div class="settingOptionDesc">${c.desc}</div>`;
      if (extra && onPick) btn.addEventListener('click', () => onPick(c.value));
      box.appendChild(btn);
    }
  };
  scalePicker('renderScaleOptions', renderScale, [
    { value: 0.5,  label: '50%',   desc: 'Fastest, chunkiest' },
    { value: 0.75, label: '75%',   desc: 'Softer edges, more headroom' },
    { value: 1,    label: 'Native', desc: 'Full sharpness' },
  ], extra && extra.onSelectRenderScale);
  // Two-option pickers, same shape as the scale pickers above rather than a switch widget, so
  // they navigate and highlight identically under a controller.
  const togglePicker = (id, on, offText, onText, handler) => {
    const box = $(id);
    if (!box) return;
    box.innerHTML = '';
    for (const o of [{ on: false, ...offText }, { on: true, ...onText }]) {
      const btn = document.createElement('button');
      btn.className = 'settingOption' + (!!on === o.on ? ' active' : '');
      btn.innerHTML = `<div class="settingOptionLabel">${o.label}</div><div class="settingOptionDesc">${o.desc}</div>`;
      if (handler) btn.addEventListener('click', () => handler(o.on));
      box.appendChild(btn);
    }
  };
  togglePicker('perfPanelOptions', showPerfPanel,
    { label: 'Hidden', desc: 'Default' },
    { label: 'Shown', desc: 'Lower-left corner' },
    extra && extra.onTogglePerfPanel);
  const devBox = $('devToolsOptions');
  if (devBox) {
    devBox.innerHTML = '';
    for (const o of [{ on: false, label: 'Hidden', desc: 'Default' },
                     { on: true, label: 'Shown', desc: 'Adds it to both menus' }]) {
      const btn = document.createElement('button');
      btn.className = 'settingOption' + (!!showDevTools === o.on ? ' active' : '');
      btn.innerHTML = `<div class="settingOptionLabel">${o.label}</div><div class="settingOptionDesc">${o.desc}</div>`;
      if (extra && extra.onToggleDevTools) btn.addEventListener('click', () => extra.onToggleDevTools(o.on));
      devBox.appendChild(btn);
    }
  }
  scalePicker('uiScaleOptions', uiScale, [
    { value: 0.85, label: 'Small',  desc: 'More of the fight visible' },
    { value: 1,    label: 'Normal', desc: 'Default' },
    { value: 1.15, label: 'Large',  desc: 'Easier to read' },
    { value: 1.3,  label: 'Huge',   desc: 'Largest' },
  ], extra && extra.onSelectUiScale);


  // Developer cheats: a single toggle reveals the three cheat buttons.
  $('settingsMenu').classList.remove('hidden');
}

// ---------- Dev Tools ----------
// Cheats plus a live-tuning box per skill. Only the stats a skill actually declares get a
// slider, so nothing irrelevant is shown for skills that don't use it.
// ---------- Loot quality: five bars, one per rarity ----------
// Bars rather than a line: five named categories being compared by magnitude, not a continuous
// function. Each bar wears its own rarity colour — the same ones the chest toasts and item
// names already use, so a Legendary reads gold here exactly as it does everywhere else.
//
// The bar length is the affix multiplier against Common. `end` sets the scale, so the Unique
// bar is always full width and the question the picture answers is how much of that the
// middle tiers get — which is precisely what `bend` moves.
// The live player's magic find, handed in by main.js. 1 means no run, or no rarity bonus, in
// which case the second column is dropped entirely rather than shown as an identical number.
let lootLuck = 1;

/**
 * Match a canvas's backing store to the box it is actually drawn in.
 *
 * Every chart in this panel had drifted out of 1:1, and each one differently: the difficulty
 * curve was 900x260 shown at 1214x330, loot quality 900x150 shown at 1214x380 — two and a half
 * times its height — and the tome chart 200x220 shown at 1214x180, six times wider than it was
 * drawn. Text and hairlines stretch with everything else, which is what made them illegible
 * rather than merely soft.
 *
 * Returns false when the element has no size yet — a page that is still display:none — so the
 * caller can skip drawing rather than bake a wrong ratio in. showDevPage redraws on reveal.
 * @param {HTMLCanvasElement} cv
 */
function fitCanvas(cv) {
  const r = cv.getBoundingClientRect();
  const w = Math.round(r.width), h = Math.round(r.height);
  if (w < 2 || h < 2) return false;
  if (cv.width !== w) cv.width = w;
  if (cv.height !== h) cv.height = h;
  return true;
}

function drawLootChart(cv) {
  if (!fitCanvas(cv)) return;
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const L = 92, R = 210, T = 8, B = 6;
  const rowH = (H - T - B) / RARITY_ORDER.length;
  const maxV = Math.max(1.01, ...RARITY_ORDER.map((r) => RARITIES[r].valueMult));
  // Chest tiers map one-for-one onto item rarities, so the odds key straight across.
  const odds = Object.fromEntries(chestOdds(1).map((o) => [o.id, o.p]));
  const hasLuck = lootLuck > 1.001;
  const luckOdds = hasLuck ? Object.fromEntries(chestOdds(lootLuck).map((o) => [o.id, o.p])) : null;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#100d14';
  g.fillRect(0, 0, W, H);
  g.font = '11px monospace';
  g.textBaseline = 'middle';
  const note = document.getElementById('lootLuckNote');
  if (note) {
    note.textContent = hasLuck
      ? `base odds \u2192 at this run's +${Math.round((lootLuck - 1) * 100)}% Rarity`
      : 'base odds — start a run with +Rarity to see its effect';
  }
  RARITY_ORDER.forEach((id, i) => {
    const def = RARITIES[id];
    const y = T + i * rowH + rowH / 2;
    const bw = Math.max(2, ((W - L - R) * def.valueMult) / maxV);
    // Name in muted ink, never in the series colour — the bar beside it carries identity.
    g.fillStyle = '#9a9088';
    g.textAlign = 'right';
    g.fillText(def.name.replace(' Relic', ''), L - 10, y);
    g.fillStyle = def.color;
    g.fillRect(L, y - rowH * 0.28, bw, rowH * 0.56);
    // Value direct-labelled on every bar: five rows is few enough that reading each one off an
    // axis would be the slower way round.
    g.fillStyle = '#c9bfa8';
    g.textAlign = 'left';
    // Base odds, then what this character actually sees. Shown as an arrow to a second figure
    // rather than replacing the base: while tuning you need both, or you cannot tell whether a
    // number moved because you dragged a slider or because the run happens to be lucky.
    let pct = '';
    if (odds[id] !== undefined) {
      pct = '  \u00b7 ' + (odds[id] * 100).toFixed(1) + '%';
      if (luckOdds) pct += ' \u2192 ' + (luckOdds[id] * 100).toFixed(1) + '%';
      else pct += ' of drops';
    }
    g.fillText(def.valueMult.toFixed(2) + '\u00d7 \u00b7 ' + def.affixCount + ' affix' + (def.affixCount > 1 ? 'es' : '') + pct,
      L + bw + 8, y);
  });
}

function buildLootChart(host) {
  const wrap = document.createElement('div');
  wrap.className = 'curveChartWrap';
  const cv = document.createElement('canvas');
  cv.id = 'lootChart';
  cv.width = 900; cv.height = 150;
  cv.className = 'curveChart';
  wrap.appendChild(cv);
  const note = document.createElement('div');
  note.className = 'curveLegend';
  note.id = 'lootLuckNote';
  wrap.appendChild(note);
  host.appendChild(wrap);
  drawLootChart(cv);
  return cv;
}

/**
 * Push rebalanced weights into the drop sliders without rebuilding the panel.
 *
 * Same reasoning as refreshCurveRows was written for: a rebuild would tear out the slider under
 * the cursor and end the drag, so the other four would only catch up once you let go. Writing
 * into the live inputs lets all five move together while one is being dragged.
 */
export function refreshDropRows(weights) {
  for (const [id, v] of Object.entries(weights)) {
    const rng = document.getElementById(`dtune_weights_${id}`);
    const num = document.getElementById(`dtune_weights_${id}_n`);
    if (rng instanceof HTMLInputElement) rng.value = String(v);
    if (num instanceof HTMLInputElement) num.value = String(Number(v.toFixed(1)));
  }
}

export function redrawLootChart(luck) {
  if (typeof luck === 'number' && luck > 0) lootLuck = luck;
  const cv = document.getElementById('lootChart');
  if (cv instanceof HTMLCanvasElement) drawLootChart(cv);
}

// ---------- Difficulty curve chart ----------
// Four multipliers over one continuous "difficulty position" axis, redrawn on every slider
// move so the shape of a change is visible while making it.
//
// LOG scale on the value axis, and that is the whole reason this reads at all. Health climbs
// to 14x while speed stops near 1.8x, so on a linear axis speed and damage are pinned flat
// against the baseline and only health has any shape — you would be tuning three of the four
// blind. A log axis is honest here because every series is a multiplier against a shared 1x,
// so equal vertical distances mean equal proportional change. The alternative, a second axis
// for the small series, would let two different scales share one picture and is never worth it.
//
// Hue order is fixed and was validated, not chosen by eye: red, blue, yellow, violet. The
// obvious semantic assignment put blue next to violet, which are 1.9 apart under protanopia
// and 9.8 apart even with full colour vision — indistinguishable. Reordering so yellow sits
// between them takes the worst adjacent pair to 26.6 (CVD) and 27.5 (normal). Keep this order
// if a series is added or renamed.
/** @type {{ key: 'hp'|'speed'|'damage'|'spawnRate', label: string, color: string }[]} */
/**
 * The one palette every chart draws from.
 *
 * The first four are the difficulty curve's own colours, unchanged — the other charts were each
 * picking their own and drifting: the gold chart ran gold-on-orange, and the tome chart used
 * nine chip colours chosen to look right on a HUD badge, several of which were near-black on a
 * dark plot. Extended to nine hues here and checked rather than eyeballed: every entry clears
 * 3.5:1 on the panel background and no two sit closer than 29 degrees of hue, so the lines stay
 * separable both by contrast and by colour.
 */
export const CHART_PALETTE = [
  '#c9382e', '#3987e5', '#c98500', '#9085e9', '#3fa66a',
  '#e2679b', '#45c2c2', '#8fbf3f', '#b45ad1',
];

const CURVE_SERIES = [
  { key: 'hp',        label: 'Health',     color: '#c9382e' },
  { key: 'speed',     label: 'Speed',      color: '#3987e5' },
  { key: 'damage',    label: 'Damage',     color: '#c98500' },
  { key: 'spawnRate', label: 'Spawn Rate', color: '#9085e9' },
];

let curveHoverPos = null;

// How far into endless the chart runs. The campaign is three stages and then it never ends, so
// where the axis stops is a judgement about what is worth seeing rather than a real limit — and
// stopping just past the tail showed the compounding only as the first hint of a bend upward.
// Ten waves is where `beyond` has had enough room to show what it actually does.
const ENDLESS_WAVES_SHOWN = 10;

/**
 * Position of an endless wave, mirroring difficultyPosition() in difficulty.js: the campaign
 * occupies positions 0..stageCount-1, and endless wave 1 begins at stageCount.
 * @param {number} wave
 */
const endlessPos = (wave) => STAGES.length + Math.max(0, wave - 1);

/** What position `pos` is called, in the terms the player and the HUD use. */
function curvePosLabel(pos) {
  const i = Math.round(pos);
  return i < STAGES.length ? `Stage ${i + 1}` : `Wave ${i - STAGES.length + 1}`;
}

/**
 * Value gridlines, 1-2-5 per decade, generated rather than listed. The old fixed list stopped at
 * 50x, which was fine when the axis stopped a few positions past the tail — at endless wave 10 a
 * compounding stat is in the thousands, and the entire top of the chart had no gridline at all.
 * @param {number} maxVal
 */
function curveGridValues(maxVal, minVal = 1) {
  const out = [];
  // Below 1x as well as above, now that a curve can start under baseline. Walks down in the
  // same 1/2/5 steps so the axis reads consistently either side of 1 — without these the whole
  // sub-1 region is an unlabelled void and a curve drawn into it looks like a glitch rather
  // than a setting.
  for (let decade = 0.1; decade < 1; decade *= 10) {
    for (const m of [1, 2, 5]) {
      const v = +(decade * m).toFixed(4);
      if (v >= minVal && v < 1) out.push(v);
    }
  }
  for (let decade = 1; decade <= maxVal; decade *= 10) {
    for (const m of [1, 2, 5]) {
      const v = decade * m;
      if (v <= maxVal) out.push(v);
    }
  }
  return out;
}

function drawCurveChart(cv) {
  if (!fitCanvas(cv)) return;
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const L = 46, R = 96, T = 14, B = 30;          // right gutter holds the direct labels
  const pw = W - L - R, ph = H - T - B;
  // Far enough to reach endless wave 10, and never less than a few positions past the last
  // anchor — with a low tail those would be the same thing, and the tail must stay visible.
  const maxPos = Math.max(lastTail() + 5, endlessPos(ENDLESS_WAVES_SHOWN));
  // Headroom above the tallest target so the top line is not drawn on the frame.
  const maxVal = Math.max(2, ...CURVE_SERIES.map((s) => curveScale(s.key, maxPos))) * 1.15;
  // The floor dial lets a curve OPEN BELOW BASELINE, so the axis can no longer assume 1x is the
  // bottom. It used to clamp with Math.max(1, v), which drew every sub-1 value flat along the
  // frame — the curve looked broken because the chart was lying about it, not because the
  // number was wrong.
  //
  // Only extended when something actually goes under: with every floor at 1 the bottom stays
  // exactly 1x and the chart is pixel-identical to before, so the usual picture does not shift
  // just because the capability exists.
  const lowest = Math.min(...CURVE_SERIES.map((s) => curveScale(s.key, 0)));
  const minVal = lowest < 1 ? Math.max(0.01, lowest / 1.15) : 1;
  const loL = Math.log10(minVal), hiL = Math.log10(maxVal);
  const x = (pos) => L + (pos / maxPos) * pw;
  // log10, because the series span 1x to 14x and a linear axis flattens three of the four.
  const y = (v) => T + ph - ((Math.log10(Math.max(minVal, v)) - loL) / (hiL - loL)) * ph;

  g.clearRect(0, 0, W, H);
  g.fillStyle = '#100d14';
  g.fillRect(0, 0, W, H);

  // Recessive grid: value gridlines at each power-ish step, stage boundaries down the x.
  g.font = '10px monospace';
  g.textBaseline = 'middle';
  for (const v of curveGridValues(maxVal, minVal)) {
    const yy = Math.round(y(v)) + 0.5;
    g.strokeStyle = 'rgba(201,191,168,0.10)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, yy); g.lineTo(L + pw, yy); g.stroke();
    g.fillStyle = '#6f675f';
    g.textAlign = 'right';
    g.fillText(`${v}x`, L - 8, yy);
  }
  g.textAlign = 'center';
  for (let stage = 0; stage <= Math.floor(maxPos); stage++) {
    const xx = Math.round(x(stage)) + 0.5;
    g.strokeStyle = 'rgba(201,191,168,0.08)';
    g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, T + ph); g.stroke();
    // Named stages, then endless waves BY NAME rather than by raw position. A bare "7" on this
    // axis is meaningless — position 7 is endless wave 5, and the number the player sees on the
    // HUD is the wave. Waves are labelled at 1, then every fifth, so the axis stays readable.
    const wave = stage - STAGES.length + 1;
    const show = stage < STAGES.length || wave === 1 || wave % 5 === 0;
    if (show) {
      g.fillStyle = stage < STAGES.length ? '#6f675f' : '#7a6a52';
      g.fillText(curvePosLabel(stage), xx, H - 16);
    }
  }
  // Where each stat stops following its shape and starts compounding. Drawn per distinct
  // value, so the usual case (all four together) is still one line rather than four stacked.
  for (const tp of [...new Set(CURVE_SERIES.map((sr) => tailOf(sr.key)))]) {
    const mx = Math.round(x(tp)) + 0.5;
    g.strokeStyle = 'rgba(201,162,39,0.55)';
    g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(mx, T); g.lineTo(mx, T + ph); g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#a8842f';
    g.textAlign = 'left';
    g.fillText('tail', mx + 4, T + 8);
  }

  // The series. 2px, no per-point markers — this is a continuous function, not samples.
  const at = (key, pos) => curveScale(key, pos);
  for (const s of CURVE_SERIES) {
    g.strokeStyle = s.color;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 240; i++) {
      const pos = (i / 240) * maxPos;
      const px = x(pos), py = y(at(s.key, pos));
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
    // Direct label at the line end, so identity never depends on colour alone.
    g.fillStyle = s.color;
    g.textAlign = 'left';
    g.fillText(`${s.label} ${at(s.key, maxPos).toFixed(1)}x`, L + pw + 6, y(at(s.key, maxPos)));
  }

  // Persistent readout of the last built stage. Hovering the chart already answers "what is
  // it at position X", but the question actually being asked while tuning is always the same
  // one — what does this do to stage 3 — and that deserves an answer on screen at all times
  // rather than one that vanishes with the cursor. Positions are 0-indexed, so stage 3 is 2.
  const readout = document.getElementById('curveReadout');
  if (readout) {
    readout.innerHTML = CURVE_SERIES.map((sr) => {
      const v = at(sr.key, 2).toFixed(2);
      return `<span class="curveReadItem"><i style="background:${sr.color}"></i>${sr.label} ${v}×</span>`;
    }).join('');
  }

  // Hover crosshair with a readout of all four at that position.
  if (curveHoverPos !== null) {
    const hx = Math.round(x(curveHoverPos)) + 0.5;
    g.strokeStyle = 'rgba(201,191,168,0.35)';
    g.beginPath(); g.moveTo(hx, T); g.lineTo(hx, T + ph); g.stroke();
    for (const s of CURVE_SERIES) {
      const v = at(s.key, curveHoverPos);
      g.fillStyle = s.color;
      g.beginPath(); g.arc(hx, y(v), 3.5, 0, Math.PI * 2); g.fill();
    }
    const rows = CURVE_SERIES.map((s) => `${s.label} ${at(s.key, curveHoverPos).toFixed(2)}x`);
    const bw = 108, bh = rows.length * 13 + 16;
    const bx = Math.min(hx + 8, L + pw - bw), by = T + 6;
    g.fillStyle = 'rgba(12,10,16,0.92)';
    g.strokeStyle = 'rgba(201,191,168,0.25)';
    g.fillRect(bx, by, bw, bh); g.strokeRect(bx + 0.5, by + 0.5, bw, bh);
    g.fillStyle = '#c9bfa8';
    g.textAlign = 'left';
    g.fillText(curvePosLabel(curveHoverPos), bx + 7, by + 11);
    rows.forEach((t, i) => {
      g.fillStyle = CURVE_SERIES[i].color;
      g.fillRect(bx + 7, by + 20 + i * 13 - 3, 6, 6);
      g.fillStyle = '#c9bfa8';
      g.fillText(t, bx + 18, by + 20 + i * 13);
    });
  }
}

// The chart plus its legend. Kept beside the sliders that drive it, and redrawn by them.
function buildCurveChart(host) {
  const wrap = document.createElement('div');
  wrap.className = 'curveChartWrap';
  const cv = document.createElement('canvas');
  cv.id = 'curveChart';
  cv.width = 900; cv.height = 260;
  cv.className = 'curveChart';
  wrap.appendChild(cv);

  // A legend as well as the direct labels: two series can cross and swap ends, and a reader
  // should never have to work out which line is which from colour alone.
  const legend = document.createElement('div');
  legend.className = 'curveLegend';
  for (const s of CURVE_SERIES) {
    const item = document.createElement('span');
    item.className = 'curveLegendItem';
    item.innerHTML = `<i style="background:${s.color}"></i>${s.label}`;
    legend.appendChild(item);
  }
  wrap.appendChild(legend);

  const read = document.createElement('div');
  read.className = 'curveReadout';
  read.innerHTML = '<span class="curveReadLabel">At Stage 3</span><span id="curveReadout"></span>';
  wrap.appendChild(read);
  host.appendChild(wrap);

  const maxPosOf = () => lastTail() + 5;
  cv.addEventListener('mousemove', (ev) => {
    const r = cv.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * cv.width;
    const frac = (px - 46) / (cv.width - 46 - 96);
    curveHoverPos = frac >= 0 && frac <= 1 ? frac * maxPosOf() : null;
    drawCurveChart(cv);
  });
  cv.addEventListener('mouseleave', () => { curveHoverPos = null; drawCurveChart(cv); });

  drawCurveChart(cv);
  return cv;
}

export function redrawCurveChart() {
  const cv = document.getElementById('curveChart');
  if (cv instanceof HTMLCanvasElement) drawCurveChart(cv);
}

// One tuning row: label, slider, number field. Extracted from the skill panel so the player
// and enemy panels below behave identically -- the clamping rules, the snap-vs-exact split and
// the caret handling are subtle enough that a second copy would drift within a week.
//
// `onChange(value)` fires live on every edit; the caller decides what that means.
function buildTuneLine(list, idPrefix, stat, onChange) {
  const line = document.createElement('div');
  line.className = 'tuneLine gpSlider'; // gpSlider = reachable by controller/keyboard nav
  const id = `${idPrefix}_${stat.key}`;
  const shown = Number(stat.value.toFixed(3));
  line.innerHTML = `<label for="${id}" class="tuneLabel">${stat.label}</label>`
    + `<input type="range" id="${id}" class="tuneSlider" min="${stat.min}" max="${stat.max}" `
    + `step="${stat.step}" value="${stat.value}" />`
    + `<span class="tuneValWrap">`
    + `<input type="number" id="${id}_n" class="tuneNum" min="${stat.min}" max="${stat.max}" `
    + `step="any" value="${shown}" />`
    + (stat.unit ? `<span class="tuneUnit">${stat.unit}</span>` : '')
    + `</span>`;

  const range = qInput(line, '.tuneSlider');
  const num = qInput(line, '.tuneNum');
  // Both paths clamp to the declared range -- these drive live gameplay, and something like a
  // zero cooldown would fire every frame. They differ on precision: the slider snaps to its
  // step, but a typed number is honoured exactly, since typing 875 and getting 880 defeats the
  // point of having a keyboard field at all.
  const clampOnly = (v) => Number(Math.min(stat.max, Math.max(stat.min, v)).toFixed(4));
  const clampSnap = (v) => {
    const c = Math.min(stat.max, Math.max(stat.min, v));
    return Number((Math.round((c - stat.min) / stat.step) * stat.step + stat.min).toFixed(4));
  };
  // The slider can only sit on a step, so it shows the nearest one while the exact typed
  // value stays in effect.
  const push = (v) => { range.value = v; onChange(v); };

  range.addEventListener('input', () => {
    const v = clampSnap(parseFloat(range.value));
    num.value = String(v);
    onChange(v);
  });
  // Applies as you type so the effect is immediate, but the field's own text is left alone
  // mid-edit -- rewriting it on every keystroke fights the caret.
  num.addEventListener('input', () => {
    const raw = parseFloat(num.value);
    if (Number.isFinite(raw)) push(clampOnly(raw));
  });
  // Committing normalises the text to the value actually in effect.
  const commit = () => {
    const raw = parseFloat(num.value);
    const v = Number.isFinite(raw) ? clampOnly(raw) : clampOnly(stat.value);
    num.value = String(v);
    push(v);
  };
  num.addEventListener('change', commit);
  num.addEventListener('blur', commit);
  num.addEventListener('keydown', (/** @type {KeyboardEvent} */ ev) => {
    if (ev.key === 'Enter') { commit(); num.blur(); }
  });
  // A focused number input swallows the wheel and edits its own value, so scrolling past one
  // would silently retune something. Drop focus and let the wheel scroll the page.
  num.addEventListener('wheel', () => { if (document.activeElement === num) num.blur(); }, { passive: true });
  list.appendChild(line);
}

// A titled group of tuning boxes -- one box per entity, each with its own Save and Reset.
// Shared by the player and enemy panels; the skill panel keeps its own because its boxes carry
// extra controls (equip, MAX) that only make sense for a skill.
// ---------- Sample waveform: trim markers over a real peak envelope ----------
// The four dials on a recorded sound are the hardest thing in the tuning panel to set blind:
// "trim start 0.16" means nothing until you can see that the first 0.16s is silence. So each
// sample draws its own envelope with the markers laid over it, and clicking scrubs — the same
// loop the audio uses, auditioned from wherever you point at.

/** Peak envelope, min/max per column, cached per buffer since it never changes. */
const waveCache = new WeakMap();
function wavePeaks(buf, cols) {
  const hit = waveCache.get(buf);
  if (hit && hit.cols === cols) return hit.peaks;
  const ch = buf.getChannelData(0);
  const step = ch.length / cols;
  const peaks = new Float32Array(cols * 2);
  for (let i = 0; i < cols; i++) {
    const a = Math.floor(i * step), b = Math.min(ch.length, Math.floor((i + 1) * step));
    let lo = 0, hi = 0;
    // Min AND max rather than RMS: a waveform drawn from RMS hides the transient, which is
    // exactly the feature you are trying to trim against.
    for (let j = a; j < b; j++) { const v = ch[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
    peaks[i * 2] = lo; peaks[i * 2 + 1] = hi;
  }
  waveCache.set(buf, { cols, peaks });
  return peaks;
}

/**
 * Draw one sample's envelope with its trim window and playhead.
 * @param {HTMLCanvasElement} cv
 * @param {string} id
 * @param {number} head seconds, or -1 for none
 */
export function drawWave(cv, id, head = -1) {
  const g = cv.getContext('2d');
  // Match the backing store to the width the panel actually gives it. A fixed 520 stretched
  // across a 1250px box is a 2.4x upscale — soft everywhere, and the marker lines land between
  // pixels. One peak column per real pixel is also exactly the resolution the envelope wants.
  if (!fitCanvas(cv)) return;
  const W = cv.width, H = cv.height;
  const buf = sampleBuffer(id);
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#12100e';
  g.fillRect(0, 0, W, H);
  if (!buf) {
    g.fillStyle = '#6b6357';
    g.font = '12px ui-monospace, monospace';
    g.fillText('decoding…', 8, H / 2);
    return;
  }
  const dur = buf.duration;
  const x = (t) => (t / dur) * W;
  const w = sampleWindow(id);

  // Everything outside the trim is drawn dimmed rather than hidden — you need to see what you
  // are cutting off to know whether you cut in the right place.
  const peaks = wavePeaks(buf, W);
  const mid = H / 2;
  for (let i = 0; i < W; i++) {
    const t = (i / W) * dur;
    const inWin = t >= w.start && t <= w.end;
    g.fillStyle = inWin ? (t >= w.loopStart ? '#5ac8f0' : '#e8b45a') : '#3a352e';
    const lo = peaks[i * 2] * mid * 0.92, hi = peaks[i * 2 + 1] * mid * 0.92;
    g.fillRect(i, mid + lo, 1, Math.max(1, hi - lo));
  }

  // Markers. Start and end bracket the window; Loop is where the attack hands over to the body,
  // which is why the body is tinted differently either side of it.
  const mark = (t, col, label) => {
    const px = Math.round(x(t)) + 0.5;
    g.strokeStyle = col; g.lineWidth = 1;
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
    g.fillStyle = col;
    g.font = '9px ui-monospace, monospace';
    g.fillText(label, Math.min(W - 26, px + 3), 10);
  };
  mark(w.start, '#8fd694', 'IN');
  mark(w.end, '#d67a6a', 'OUT');
  if (SAMPLES[id] && SAMPLES[id].loop) mark(w.loopStart, '#cdd3dd', 'LOOP');

  if (head >= 0) {
    const px = Math.round(x(head)) + 0.5;
    g.strokeStyle = '#fff8e7'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
  }
}

/**
 * Waveform + scrub handling for one sample. Returns the canvas.
 * @param {string} id
 */
function buildWave(id) {
  const cv = document.createElement('canvas');
  cv.className = 'sampleWave';
  cv.width = 520; cv.height = 109;   // matches the CSS height, so the waveform is 1:1
  drawWave(cv, id);

  let raf = 0, playing = null, startedAt = 0, from = 0;
  const stop = () => {
    if (playing) { playing.stop(0.02); playing = null; }
    cancelAnimationFrame(raf); raf = 0;
  };
  const tick = () => {
    const buf = sampleBuffer(id);
    if (!buf) return;
    const t = from + (audioNow() - startedAt);
    if (t > buf.duration) { stop(); drawWave(cv, id); return; }
    drawWave(cv, id, t);
    raf = requestAnimationFrame(tick);
  };
  // Scrub: audition from wherever you point, through the real player, so what you hear is what
  // the game will play — including the loop if this sample sustains.
  const scrub = (ev) => {
    const buf = sampleBuffer(id);
    if (!buf) return;
    const r = cv.getBoundingClientRect();
    const t = Math.max(0, Math.min(buf.duration, ((ev.clientX - r.left) / r.width) * buf.duration));
    stop();
    from = t; startedAt = audioNow();
    playing = previewSample(id, t) || null;
    drawWave(cv, id, t);
    if (!raf) raf = requestAnimationFrame(tick);
  };
  cv.addEventListener('pointerdown', (ev) => {
    cv.setPointerCapture(ev.pointerId);
    scrub(ev);
    const move = (e) => { if (e.buttons) scrub(e); };
    const up = () => { cv.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    cv.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  cv.dataset.sampleId = id;
  return cv;
}

// ---------- Dev Tools section navigation ----------
// The panel grew one section at a time — cheats, skills, six entity domains, now samples — into
// a single column tall enough that finding the drop rates meant scrolling past everything else.
// So the sections become PAGES behind a grid of icons: one click to the one you want, and only
// that one rendered.
//
// This works by grouping what the builders already produced rather than by rewriting each of
// them to declare a page. Every section starts with a .devSectionTitle and runs until the next
// one, which is a rule they all follow already — so the split needs no cooperation from them,
// and a section added later is picked up without being told to opt in.

/** Glyph per section, matched on the title. Anything unlisted still gets a page, with a dot.
 *  @type {[RegExp, string, string][]} */
const DEV_ICONS = [
  [/cheat|grant/i,        '✦', 'Cheats'],
  [/skill/i,              '⚔', 'Skills'],
  [/player multi/i,       '◈', 'Player'],
  [/player stat|class/i,  '♟', 'Classes'],
  [/curve|difficulty/i,   '↗', 'Curve'],
  // Ahead of the rarity row: "Level-Up Rolls" would otherwise match nothing and fall back to a
  // dot, and it is about card odds rather than loot quality.
  [/level-up roll/i,      '⚄', 'Rolls'],
  [/rarit|quality/i,      '❖', 'Rarity'],
  [/^drops$|drop|chest|key/i, '⚱', 'Drops'],
  [/sound|sample|audio/i, '♫', 'Sound'],
  [/^tomes$/i,            'ᛞ', 'Tomes'],
  [/enem|monster/i,       '☠', 'Enemies'],
];

/** Which page is showing, kept across rebuilds so tuning does not bounce you back to page one. */
let devPage = 0;

/**
 * Split the dev body's flat sections into pages and put an icon grid above them.
 * @param {HTMLElement} body
 */
export function paginateDevTools(body) {
  if (!body) return;
  unpaginateDevTools(body);

  // Flatten the hosts' children into one stream. Which host a section was built into is an
  // implementation detail of the builders; the split is by section. The hosts themselves STAY —
  // showDevTools writes straight back into them by id on every rebuild, so removing them would
  // break the next refresh.
  // A host boundary starts a page as well as a section title does. The skill boxes carry no
  // .devSectionTitle of their own — they are just boxes in #devTuning — so splitting on titles
  // alone silently folded every skill into the cheats page.
  const HOST_TITLES = { devCheats: 'Cheats', devTuning: 'Skills', devEntityTuning: '' };
  const hosts = Array.from(body.children).filter((h) => h.classList.contains('devTuning')
    || h.classList.contains('settingsList'));
  const stream = [];
  for (const host of hosts) {
    let first = true;
    for (const c of Array.from(host.children)) {
      stream.push({ node: c, hostStart: first ? (HOST_TITLES[host.id] || '') : null });
      first = false;
    }
    host.classList.add('devHostEmptied');
  }

  /** @type {{ title: string, nodes: Element[] }[]} */
  const pages = [];
  for (const { node, hostStart } of stream) {
    const isTitle = node.classList.contains('devSectionTitle');
    const titleText = isTitle ? (node.textContent || '').trim() : '';
    // An EMPTY section title continues the page it is on rather than starting a new one. That
    // is how several boxes are grouped under one heading — the Drops page is built from four
    // separate buildTuneSection calls, only the first of which is titled.
    const opens = (isTitle && titleText) || (hostStart !== null && hostStart) || !pages.length;
    if (opens) pages.push({ title: titleText || hostStart || 'Cheats', nodes: [] });
    pages[pages.length - 1].nodes.push(node);
  }
  if (!pages.length) return;
  if (devPage >= pages.length) devPage = 0;

  const grid = document.createElement('div');
  grid.className = 'devIconGrid';
  body.appendChild(grid);

  pages.forEach((pg, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'devPage';
    // Pages whose boxes are meant to be read against each other go two-up. Six near-identical
    // class boxes — or gold beside the chest rates — is a long scroll in one column.
    if (/player stat|class/i.test(pg.title)) wrap.classList.add('devPageTwoCol');
    if (/^tomes$/i.test(pg.title)) wrap.classList.add('devPageThreeCol');
    // Drops splits unevenly on purpose: gold has six dials and the other two have two each,
    // so gold takes the left column outright and the short pair stacks on the right. Three
    // equal columns left the two small boxes half empty beside a tall one.
    if (/^drops$/i.test(pg.title)) wrap.classList.add('devPageDrops');
    // Four stats of four dials each. Stacked they pushed the chart off the top of the page,
    // which defeats the point of a live curve you tune against — a 2x2 halves the height so
    // the picture and every dial that shapes it stay in one view.
    if (/curve|difficulty/i.test(pg.title)) wrap.classList.add('devPageCurve');
    if (/rarit|quality/i.test(pg.title)) wrap.classList.add('devPageRarity');
    // The grid's active chip already names the section, so the heading would say it twice.
    for (const n of pg.nodes) {
      // The grid's chip already names the section, and a grouped section contributes an empty
      // title and an empty hint that would otherwise render as blank gaps between its boxes.
      if (n.classList.contains('devSectionTitle')) continue;
      if (n.classList.contains('devHint') && !(n.textContent || '').trim()) continue;
      wrap.appendChild(n);
    }
    body.appendChild(wrap);

    const found = DEV_ICONS.find(([re]) => re.test(pg.title));
    // Two sections can match the same icon row (both drop panels do). Sharing a glyph is fine —
    // sharing a LABEL is not, since then two chips read identically and neither says which.
    const dupe = found && pages.some((o, k) => k !== i && DEV_ICONS.find(([re]) => re.test(o.title)) === found);
    const label = found && !dupe ? found[2] : pg.title;
    const btn = document.createElement('button');
    btn.className = 'devIcon';
    btn.innerHTML = `<span class="devIconGlyph">${found ? found[1] : '●'}</span>`
      + `<span class="devIconLabel">${label}</span>`;
    btn.title = pg.title;
    btn.onclick = () => { devPage = i; showDevPage(body); };
    grid.appendChild(btn);
  });

  showDevPage(body);
}

/** Tear the pages down and hand the hosts back, so a rebuild starts from a clean panel. */
export function unpaginateDevTools(body) {
  if (!body) return;
  for (const pg of Array.from(body.querySelectorAll(':scope > .devPage'))) pg.remove();
  const grid = body.querySelector(':scope > .devIconGrid');
  if (grid) grid.remove();
  for (const h of Array.from(body.querySelectorAll('.devHostEmptied'))) {
    h.classList.remove('devHostEmptied');
  }
}

/** Show only the selected page, and mark its icon. */
function showDevPage(body) {
  const pages = body.querySelectorAll(':scope > .devPage');
  const icons = body.querySelectorAll('.devIcon');
  pages.forEach((pg, i) => { pg.classList.toggle('on', i === devPage); });
  icons.forEach((ic, i) => { ic.classList.toggle('on', i === devPage); });
  // Back to the top on a page change: pages differ wildly in length, and landing halfway down
  // a short one after scrolling a long one reads as the panel being broken.
  body.scrollTop = 0;
  // Anything that sizes its canvas from its own rendered width measured ZERO while its page was
  // display:none, so it has to be redrawn once the page is actually on screen.
  redrawWaves();
  redrawGoldChart();
  redrawTomeChart();
  redrawCurveChart();
  redrawLootChart();
}

// ---------- Gold curve charts ----------
// TWO charts, not two lines on one. The curves run on unrelated x axes — the campaign on
// difficulty position, the horde rush on seconds since the portal opened — and drawing them
// against a shared axis would put a "3" on the same gridline that means stage 3 for one line
// and three seconds for the other. Same log-scale rule as the difficulty chart, and both
// sample the REAL function so the picture cannot drift from what the game pays out.

/** @type {{ key: string, label: string, color: string, fn: (x:number)=>number, max: number,
 *           unit: string, marks: number[] }[]} */
const GOLD_CHARTS = [
  {
    key: 'campaign', label: 'Campaign / Endless', color: CHART_PALETTE[0],
    fn: goldCampaignScale, max: 8, unit: 'stage', marks: [1, 2, 3, 4, 5, 6, 7, 8],
  },
  {
    key: 'horde', label: 'Horde Rush (per rush)', color: CHART_PALETTE[1],
    // Open-ended, so the window shown is a judgement about what a player would plausibly
    // linger for rather than a real ceiling — the curve keeps climbing past the right edge.
    fn: goldHordeScale, max: 120, unit: 's', marks: [30, 60, 90, 120],
  },
];

function drawGoldChart(cv, spec) {
  const g = cv.getContext('2d');
  if (!fitCanvas(cv)) return;
  const W = cv.width, H = cv.height;
  const padL = 38, padB = 18, padT = 8, padR = 8;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#12100e';
  g.fillRect(0, 0, W, H);

  let hi = 2;
  for (let i = 0; i <= 80; i++) hi = Math.max(hi, spec.fn((i / 80) * spec.max));
  const x = (v) => padL + (v / spec.max) * (W - padL - padR);
  const y = (v) => H - padB - (Math.log(Math.max(1, v)) / Math.log(hi)) * (H - padB - padT);

  g.font = '10px ui-monospace, monospace';
  for (const mk of spec.marks) {
    const px = Math.round(x(mk)) + 0.5;
    g.strokeStyle = '#2e2922'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(px, padT); g.lineTo(px, H - padB); g.stroke();
    g.fillStyle = '#4a4238';
    g.fillText(spec.unit === 's' ? `${mk}s` : String(mk), px + 2, H - 5);
  }
  g.fillStyle = '#4a4238';
  for (const v of [1, 2, 5, 10, 20, 50]) {
    if (v > hi) continue;
    const py = Math.round(y(v)) + 0.5;
    g.strokeStyle = '#231f1a';
    g.beginPath(); g.moveTo(padL, py); g.lineTo(W - padR, py); g.stroke();
    g.fillText(`${v}×`, 4, py + 3);
  }

  g.strokeStyle = spec.color; g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 200; i++) {
    const v = (i / 200) * spec.max;
    const px = x(v), py = y(spec.fn(v));
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.stroke();
}

export function buildGoldChart(host) {
  for (const spec of GOLD_CHARTS) {
    const wrap = document.createElement('div');
    wrap.className = 'curveChartWrap';
    const cap = document.createElement('div');
    cap.className = 'curveLegend';
    cap.innerHTML = `<span><i style="background:${spec.color}"></i>${spec.label}</span>`;
    wrap.appendChild(cap);
    const cv = document.createElement('canvas');
    cv.className = 'curveChart goldChart';
    cv.dataset.chart = spec.key;
    cv.width = 620; cv.height = 195;
    wrap.appendChild(cv);
    host.appendChild(wrap);
    drawGoldChart(cv, spec);
    // Under the horde chart: what a rush is actually worth if you stand in it. Minutes rather
    // than the chart's seconds because a minute is the unit a player thinks in, and per stage
    // because the stage multiplier is the whole point of the pair being different.
    if (spec.key === 'horde') wrap.appendChild(buildHordeReadout());
    if (spec.key === 'campaign') wrap.appendChild(buildCampaignReadout());
  }
}

/**
 * The campaign curve at the end of stages 1, 2, 3 and 10.
 *
 * END of each stage, not the start: position N is where stage N finishes, and the value you
 * have BUILT UP to by then is the useful one — the start of stage 1 is 1x by construction and
 * says nothing. Stage 10 is past the campaign's three stages, so it reads off the endless tail
 * and is really "eight endless waves in" — which is the number worth watching, since that is
 * where `beyond` compounds without limit.
 */
function buildCampaignReadout() {
  const box = document.createElement('div');
  box.className = 'curveReadout hordeReadout';
  box.dataset.readout = 'campaign';
  fillCampaignReadout(box);
  return box;
}

// ---------- Tome growth charts ----------
// TWO charts, not nine curves on one — for the same reason the gold curves were split. Those
// could not share a gridline because one x axis was stages and the other seconds; these cannot
// share a Y axis because one is a PROPORTION and the other is a COUNT. Quantity reaching +20
// projectiles and Damage reaching +250% are not different sizes of the same quantity, they are
// different quantities, and stacking them on one axis said otherwise.
//
// It also made the picture useless. The axis is fitted to the largest series, so Quantity's 20
// set the ceiling and squashed the other seven into the bottom fifth of the plot — the exact
// thing you were looking at the chart to compare. Apart on their own axes, each group fills its
// own frame.
//
// Both sample the real functions the game applies — tomeMagnitude and tomeCount — so a line
// cannot show something a tome does not actually do. Each tome keeps the colour it has always
// had (its index in SUPPORT_ORDER), so splitting the picture did not reshuffle the legend.

/** Levels plotted. Far past the reference 5: `beyond` compounds forever, and the whole point of
 *  seeing it is knowing what a deeply stacked tome is actually worth. */
const TOME_CHART_LEVELS = 30;

/** Every tome, with the colour it is drawn in, split by what its number MEANS. */
const tomeSeries = () => SUPPORT_ORDER.map((id, idx) => ({
  id, name: SUPPORTS[id].name, color: CHART_PALETTE[idx % CHART_PALETTE.length],
}));
const proportionalTomes = () => tomeSeries().filter((t) => !COUNTING_TOMES.has(t.id));
const countingTomes = () => tomeSeries().filter((t) => COUNTING_TOMES.has(t.id));

/**
 * One tome chart. `spec` decides which group is drawn and how its Y axis reads.
 *
 * PROPORTIONS get a log axis: they span +3.5% to +250%, and on a linear one everything below
 * the top curve flattens against the floor. COUNTS get a linear axis and integer gridlines,
 * because a count IS linear — and because the power-mode curve it plots is a straight climb,
 * which a log axis would bend into a shape the tome does not have.
 */
function drawTomeChartOf(cv, spec) {
  const g = cv.getContext('2d');
  if (!fitCanvas(cv)) return;
  const W = cv.width, H = cv.height;
  const padL = 40, padB = 18, padT = 8, padR = 8;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#12100e';
  g.fillRect(0, 0, W, H);

  const series = spec.series();
  const valueAt = spec.valueAt;
  let hi = spec.floorHi;
  for (const t of series) {
    for (let l = 1; l <= TOME_CHART_LEVELS; l++) hi = Math.max(hi, valueAt(t.id, l));
  }
  const x = (lvl) => padL + ((lvl - 1) / (TOME_CHART_LEVELS - 1)) * (W - padL - padR);
  const y = spec.log
    ? (v) => H - padB - (Math.log(1 + Math.max(0, v)) / Math.log(1 + hi)) * (H - padB - padT)
    : (v) => H - padB - (Math.max(0, v) / hi) * (H - padB - padT);

  g.font = '9px ui-monospace, monospace';
  for (let l = 5; l <= TOME_CHART_LEVELS; l += 5) {
    const px = Math.round(x(l)) + 0.5;
    g.strokeStyle = l === 5 ? '#4a4238' : '#231f1a';   // the reference level, marked
    g.beginPath(); g.moveTo(px, padT); g.lineTo(px, H - padB); g.stroke();
    g.fillStyle = l === 5 ? '#8a7a55' : '#4a4238';
    g.fillText(`L${l}`, px + 2, H - 6);
  }
  g.fillStyle = '#4a4238';
  for (const v of spec.gridlines(hi)) {
    if (v > hi) continue;
    const py = Math.round(y(v)) + 0.5;
    g.strokeStyle = '#231f1a';
    g.beginPath(); g.moveTo(padL, py); g.lineTo(W - padR, py); g.stroke();
    g.fillText(spec.tick(v), 4, py + 3);
  }

  for (const t of series) {
    g.strokeStyle = t.color; g.lineWidth = 2;
    g.beginPath();
    // Counts are integers, so they are drawn as a STAIRCASE sampled at whole levels rather than
    // a smooth line through fractional ones. A diagonal between two levels would draw a +1.5
    // projectile that the game never grants.
    if (spec.stepped) {
      for (let l = 1; l <= TOME_CHART_LEVELS; l++) {
        const v = valueAt(t.id, l);
        if (l === 1) g.moveTo(x(l), y(v));
        else { g.lineTo(x(l), y(valueAt(t.id, l - 1))); g.lineTo(x(l), y(v)); }
      }
    } else {
      for (let i = 0; i <= 120; i++) {
        const lvl = 1 + (i / 120) * (TOME_CHART_LEVELS - 1);
        const px = x(lvl), py = y(valueAt(t.id, lvl));
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
    }
    g.stroke();
  }
}

/** @type {{ cls: string, title: string, series: () => any[], valueAt: (id:string,l:number)=>number,
 *           log: boolean, stepped: boolean, floorHi: number,
 *           gridlines: (hi:number)=>number[], tick: (v:number)=>string }[]} */
const TOME_CHARTS = [
  {
    cls: 'tomeChart', title: 'Proportions — % of a stat',
    series: proportionalTomes, valueAt: tomeMagnitude,
    log: true, stepped: false, floorHi: 1,
    gridlines: () => [0.25, 0.5, 1, 2, 5, 10],
    tick: (v) => `+${v * 100}%`,
  },
  {
    cls: 'tomeCountChart', title: 'Counts — whole extra things',
    series: countingTomes, valueAt: tomeCount,
    log: false, stepped: true, floorHi: 4,
    // Whole numbers only, thinned so a 20-high axis does not draw twenty gridlines.
    gridlines: (hi) => { const step = Math.max(1, Math.ceil(hi / 5));
      const out = []; for (let v = step; v <= hi; v += step) out.push(v); return out; },
    tick: (v) => `+${v}`,
  },
];

function buildOneTomeChart(host, spec) {
  const series = spec.series();
  if (!series.length) return;   // e.g. every counting tome disabled — draw no empty frame
  const wrap = document.createElement('div');
  wrap.className = 'curveChartWrap';
  const title = document.createElement('div');
  title.className = 'curveSubTitle';
  title.textContent = spec.title;
  wrap.appendChild(title);
  const key = document.createElement('div');
  key.className = 'curveLegend';
  key.innerHTML = series.map((t) =>
    `<span><i style="background:${t.color}"></i>${t.name}</span>`).join('');
  wrap.appendChild(key);
  const cv = document.createElement('canvas');
  cv.className = `curveChart ${spec.cls}`;
  // Starting size only — the real height comes from CSS, per chart (see style.css).
  cv.width = 900; cv.height = 220;
  wrap.appendChild(cv);
  host.appendChild(wrap);
  drawTomeChartOf(cv, spec);
}

/**
 * The proportions chart, above the dials that shape it.
 *
 * The counting chart is deliberately NOT built here — see buildTomeCountChart. Both above the
 * sliders meant neither the seven curves nor the dials fitted on screen together, which defeats
 * the point of a live chart: you drag a dial to watch the line move, and you cannot do that if
 * moving the dial scrolls the line out of view.
 */
export function buildTomeChart(host) { buildOneTomeChart(host, TOME_CHARTS[0]); }

/** The counting chart, built AFTER the dials so the seven-curve chart and the sliders share the
 *  screen. It is one series and one shape, so it is the one that can afford to be scrolled to. */
export function buildTomeCountChart(host) { buildOneTomeChart(host, TOME_CHARTS[1]); }

export function redrawTomeChart() {
  for (const spec of TOME_CHARTS) {
    const cv = document.querySelector(`canvas.${spec.cls}`);
    if (cv) drawTomeChartOf(/** @type {HTMLCanvasElement} */(cv), spec);
  }
  // The table is another view of the same curves, so it repaints with the picture. Every caller
  // that moves a tome dial already redraws the chart; none of them has to learn about this.
  refreshTomeBreakpoints();
}

/** Formats a multiplier: one decimal while it is still legible, whole numbers once it is not. */
const multStr = (v) => (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1));

function fillCampaignReadout(box) {
  const cells = [1, 2, 3, 10].map((st) =>
    `<span class="hordeCell"><b>S${st}</b> ${multStr(goldCampaignScale(st))}×</span>`).join('');
  box.innerHTML = `<span class="hordeRow"><i>By end of stage</i>${cells}</span>`;
}

/** Rows of "stage N rush: 1m / 3m / 5m", so the stage multiplier is visible as a number. */
function buildHordeReadout() {
  const box = document.createElement('div');
  box.className = 'curveReadout hordeReadout';
  box.dataset.readout = 'horde';
  fillHordeReadout(box);
  return box;
}

function fillHordeReadout(box) {
  const MINUTES = [1, 3, 5];
  // Stage 3's boss opens endless rather than a portal, so there is no third rush to show.
  box.innerHTML = [0, 1].map((stageIdx) => {
    const cells = MINUTES.map((m) =>
      `<span class="hordeCell"><b>${m}m</b> ${multStr(goldHordeScale(m * 60, stageIdx))}×</span>`).join('');
    return `<span class="hordeRow"><i>Stage ${stageIdx + 1} rush</i>${cells}</span>`;
  }).join('');
}

/**
 * Repaint the gold curves AND their readouts.
 *
 * The readouts are the part that was missing: they were built once and never touched again, so
 * a dial could be dragged from 2x to fifty million with the numbers underneath still showing
 * the value they had when the panel opened — the most misleading possible failure for a readout
 * whose entire job is to expose what a slider is about to do.
 */
export function redrawGoldChart() {
  for (const cv of document.querySelectorAll('canvas.goldChart')) {
    const spec = GOLD_CHARTS.find((c) => c.key === /** @type {HTMLCanvasElement} */(cv).dataset.chart);
    if (spec) drawGoldChart(/** @type {HTMLCanvasElement} */(cv), spec);
  }
  for (const el of document.querySelectorAll('[data-readout]')) {
    const box = /** @type {HTMLElement} */(el);
    if (box.dataset.readout === 'campaign') fillCampaignReadout(box);
    else if (box.dataset.readout === 'horde') fillHordeReadout(box);
  }
}

/**
 * Render one skill's damage projection from the LIVE tune block.
 *
 * Reads skillDamageAt at paint time rather than taking numbers handed over when the panel was
 * built, which is what makes it live: the tune object is mutated in place by the sliders, so
 * recomputing here always reflects the current value.
 * @param {HTMLElement} host
 * @param {string} id
 */
function fillProjection(host, id) {
  const proj = [1, 10, 20].map((lvl) => ({ lvl, ...(skillDamageAt(id, lvl) || {}) }))
    .filter((d) => d.dps !== undefined);
  if (!proj.length) { host.innerHTML = ''; return; }
  // DPS is the headline because cooldown is half of what a gem is; per-hit alone makes a slow
  // heavy hitter look better than it plays. Both are shown, so neither can mislead.
  host.innerHTML = `<span class="dmgProjLabel">Single target, no mods — ${proj[0].kind}</span>`
    + proj.map((d) => `<span class="dmgProjCell"><b>L${d.lvl}</b>`
      + `<i>${d.dps.toFixed(1)}</i> dps`
      + `<em>${d.perHit.toFixed(1)} hit</em></span>`).join('');
}

/**
 * Repaint one skill's projection after a slider moves.
 *
 * Deliberately NOT a panel rebuild: rebuilding mid-drag would replace the very input being
 * dragged, dropping the pointer capture and collapsing every panel the user had opened. Only
 * the projection row is rewritten, so the drag continues undisturbed.
 * @param {string} id
 */
export function refreshSkillProjection(id) {
  const host = document.querySelector(`.dmgProjection[data-skill="${id}"]`);
  if (host) fillProjection(/** @type {HTMLElement} */(host), id);
}

/** Repaint every sample waveform in the panel — cheap, and there are only ever a few. */
export function redrawWaves() {
  for (const cv of document.querySelectorAll('canvas.sampleWave')) {
    const c = /** @type {HTMLCanvasElement} */(cv);
    drawWave(c, c.dataset.sampleId);
  }
}

function buildTuneSection(host, title, blurb, entries, handlers, prefix, decorate, perBox) {
  const head = document.createElement('div');
  head.className = 'devSectionTitle';
  head.textContent = title;
  host.appendChild(head);
  const hint = document.createElement('div');
  hint.className = 'devHint';
  hint.textContent = blurb;
  host.appendChild(hint);
  // A section may put something above its boxes — the curve puts its chart there, so the
  // picture and the numbers that shape it are read together.
  if (decorate) decorate(host);

  for (const ent of entries) {
    const box = document.createElement('div');
    // Every tune box wears the panel style — red labels on dark, gold on hover. It started on
    // the sound panels, and having one look for "a box of dials" beats two arbitrary ones.
    box.className = 'tuneBox tunePanel';
    box.style.setProperty('--accent', ent.color || '#7a6f5f');
    box.innerHTML = `<div class="tuneHead">`
      + `<span class="tuneName">${ent.name}</span>`
      + `<button class="tuneReset" data-ent="${ent.id}">Reset</button></div>`;
    const list = document.createElement('div');
    list.className = 'tuneList';
    for (const stat of ent.stats) {
      buildTuneLine(list, `${prefix}_${ent.id}`, stat, (v) => handlers.onTune(ent.id, stat.key, v));
    }
    box.appendChild(list);
    box.querySelector('.tuneReset').addEventListener('click', () => handlers.onReset(ent.id));
    // A section may also put something inside each box — the samples put their waveform there,
    // since one shared picture cannot show four different recordings.
    if (perBox) perBox(box, ent);
    host.appendChild(box);
  }
}

/** Which panels are expanded, per group. Held across rebuilds — a tuning change rebuilds the
 *  whole panel, and having every box you had opened slam shut on each drag is unusable. */
const openSkills = new Set();
/** Which relic panels are twirled open. Its own set, so opening a relic leaves the skills alone. */
const openRelics = new Set();
const openSamples = new Set();

/**
 * Turn a tune box into a folding panel: its name becomes the toggle and everything below the
 * header hides when shut.
 *
 * The collapsed class goes on the BOX rather than on the stat list, because a box may hold more
 * than its sliders — the sample panels carry a waveform and an audition button too, and folding
 * only the list would leave those stranded under a closed header.
 *
 * @param {HTMLElement} box
 * @param {string} key id used to remember the open state
 * @param {Set<string>} openSet
 */
function makeCollapsible(box, key, openSet) {
  const name = box.querySelector('.tuneName');
  if (!name) return;
  const open = openSet.has(key);
  // The name is the toggle rather than a separate caret button: several of these headers
  // already carry Save and Reset, and a third small target makes it a lottery which you hit.
  const btn = document.createElement('button');
  btn.className = 'tuneName tuneCollapse';
  btn.type = 'button';
  btn.setAttribute('aria-expanded', String(open));
  btn.title = "Show or hide this panel's controls";
  btn.innerHTML = `<span class="tuneCaret">▸</span>${name.textContent}`;
  name.replaceWith(btn);
  box.classList.toggle('collapsed', !open);
  btn.addEventListener('click', () => {
    const nowOpen = !openSet.has(key);
    if (nowOpen) openSet.add(key); else openSet.delete(key);
    box.classList.toggle('collapsed', !nowOpen);
    btn.setAttribute('aria-expanded', String(nowOpen));
    // A waveform drawn while its panel was closed measured zero width.
    if (nowOpen) redrawWaves();
  });
}

/**
 * Put the panel back where it was after it is torn down and rebuilt.
 *
 * Every Reset button — on every dev page — goes through refreshDevTools, which rebuilds the whole
 * panel from scratch. The rebuilt DOM starts at scrollTop 0, so pressing Reset on a box halfway
 * down a long page threw you back to the top and you had to scroll back to see what the reset
 * did. Same for the keyboard/controller focus, which landed nowhere.
 *
 * Applied twice: once immediately, and once on the next frame. The charts size themselves from
 * their measured boxes (see fitCanvas), so the page is not at its final height until after a
 * layout pass, and a scrollTop set before that gets clamped to a shorter page.
 *
 * Focus is restored BEFORE the scroll and with preventScroll, because focusing an off-screen
 * control scrolls it into view and would undo the position we just restored.
 */
function restoreDevPanelPosition(body, top, focus) {
  const apply = () => {
    const el = focus && document.querySelector(focus);
    if (el) /** @type {HTMLElement} */(el).focus({ preventScroll: true });
    if (top > 0) body.scrollTop = top;
  };
  apply();
  requestAnimationFrame(apply);
}

/**
 * A selector that will still find the focused control after the panel is rebuilt.
 *
 * Sliders carry an id, so those are easy. Reset buttons do not — they are identified by the
 * entity they reset — and they are the single most likely thing to be focused when a rebuild
 * happens, since pressing one is what causes it. Without this branch, resetting with the
 * keyboard or a controller dropped focus to nothing and you had to tab back in from the top.
 */
function devFocusKey(el) {
  if (!el || el === document.body) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const ent = el.getAttribute && el.getAttribute('data-ent');
  if (ent && el.classList.length) {
    return `.${el.classList[0]}[data-ent="${CSS.escape(ent)}"]`;
  }
  return null;
}

export function showDevTools(state, handlers) {
  const body = $('devBody');
  // Captured before the teardown below, restored after pagination at the end of this function.
  const keepScroll = body.scrollTop;
  const keepFocus = devFocusKey(document.activeElement);
  // Hand the hosts back before rebuilding: last time round their children were moved into pages.
  unpaginateDevTools($('devBody'));
  const cheats = $('devCheats');
  cheats.innerHTML = '';

  const row = (label, desc) => {
    const r = document.createElement('div');
    r.className = 'settingRow';
    r.innerHTML = `<div class="settingLabel">${label}</div><div class="settingLabelDesc">${desc}</div>`;
    const opts = document.createElement('div');
    opts.className = 'settingOptions';
    r.appendChild(opts);
    cheats.appendChild(r);
    return opts;
  };

  // ---- resource granters + fresh-start reset, above the cheats ----
  const resOpts = row('Resources', 'Grant currency, or wipe progress back to a new-player state.');
  const grant = (label, key, max, step, onGrant) => {
    const wrap = document.createElement('div');
    wrap.className = 'grantRow gpSlider';
    const id = `grant_${key}`;
    wrap.innerHTML = `<label for="${id}" class="grantLabel">${label}</label>`
      + `<input type="range" id="${id}" class="tuneSlider grantSlider" min="0" max="${max}" step="${step}" value="0" />`
      + `<input type="number" id="${id}_n" class="tuneNum grantNum" min="0" max="${max}" step="any" value="0" />`
      + `<button class="grantBtn" id="${id}_b">Grant</button>`;
    const rng = qInput(wrap, '.grantSlider');
    const num = qInput(wrap, '.grantNum');
    // Slider and field mirror each other; the button applies whatever is showing.
    rng.addEventListener('input', () => { num.value = rng.value; });
    num.addEventListener('input', () => {
      const v = parseFloat(num.value);
      if (Number.isFinite(v)) rng.value = String(Math.min(max, Math.max(0, v)));
    });
    wrap.querySelector('.grantBtn').addEventListener('click', () => {
      const v = Math.max(0, Math.floor(parseFloat(num.value) || 0));
      if (v > 0) onGrant(v);
    });
    resOpts.appendChild(wrap);
  };
  grant('Gold', 'gold', 10000, 50, handlers.onGrantGold);
  grant('Keys', 'keys', 99, 1, handlers.onGrantKeys);

  const zero = document.createElement('button');
  zero.className = 'settingOption zeroBtn';
  zero.innerHTML = '<div class="settingOptionLabel">Zero It Out</div>'
    + '<div class="settingOptionDesc">Clear gold, upgrades, kills, deaths, keys, cheats and the '
    + 'leaderboard &mdash; a brand-new-player state. Tuning and settings are never touched.</div>';
  zero.addEventListener('click', handlers.onZeroOut);
  resOpts.appendChild(zero);

  const cheatOpts = row('Cheats', state.inRun
    ? 'Testing shortcuts for the current run.'
    : 'Toggles persist into your next run. Run-only cheats appear once a run is active.');
  // A grid, not a column. These are seven independent switches you scan for one of, and a single
  // tall list pushed the later ones off the page on the one screen you open to reach them fast.
  cheatOpts.classList.add('cheatGrid');
  const mk = (label, desc, active, onClick) => {
    const b = document.createElement('button');
    b.className = 'settingOption' + (active ? ' active' : '');
    b.innerHTML = `<div class="settingOptionLabel">${label}</div><div class="settingOptionDesc">${desc}</div>`;
    b.addEventListener('click', onClick);
    cheatOpts.appendChild(b);
  };
  mk(`God Mode: ${state.godMode ? 'ON' : 'OFF'}`, 'Player takes no damage', state.godMode, handlers.onToggleGod);
  if (state.inRun) mk(`Max Skills: ${state.maxSkills ? 'ON' : 'OFF'}`, 'Every skill at max level', state.maxSkills, handlers.onMaxSkills);
  mk(`Max Rerolls: ${state.infiniteRerolls ? 'ON' : 'OFF'}`, 'Unlimited free rerolls', state.infiniteRerolls, handlers.onToggleRerolls);
  // A grant, not a toggle: one press sets the balance so high the shop stops being a
  // constraint, which is all "infinite" needs to mean here. The exact-amount field below
  // still exists for when a test wants a REALISTIC balance instead.
  mk('Infinite Gold', 'Set gold to 9,999,999', false, handlers.onInfiniteGold);
  mk(`Enable All Upgrades: ${state.allUpgrades ? 'ON' : 'OFF'}`,
    'Every shop upgrade is set at max level.',
    state.allUpgrades, handlers.onToggleAllUpgrades);
  mk('Reset Tuning to Baked', state.storedTuneCount
    ? `Discard ${state.storedTuneCount} saved override(s) and use the values built into this `
      + 'release. Use this when tuning you already baked keeps coming back.'
    : 'No saved overrides — this build is already running its baked values.',
  false, handlers.onClearStoredTunes);
  mk(`Frame Profiler: ${state.perfProfiler ? 'ON' : 'OFF'}`,
    'Breaks the frame into named phases under the FPS box. Read it in the exe — an embedded '
    + 'browser throttles the frame clock and reports nonsense.',
    state.perfProfiler, handlers.onTogglePerf);

  // ---- per-skill stat sliders ----
  const tuning = $('devTuning');
  tuning.innerHTML = '';
  const hint = document.createElement('div');
  hint.className = 'devHint';
  // One line. Six group headings now take the height this used to, and the details it listed
  // (changes autosave, Reset restores shipped values) are true of every panel in the dev tools,
  // so saying them again here bought nothing.
  hint.textContent = state.inRun
    ? 'Click an icon to equip · stick moves, D-pad edits, A folds open'
    : 'Stick moves · D-pad edits · A folds open · equipping needs an active run';
  tuning.appendChild(hint);
  // Grouped by what a skill is FOR. Fifteen panels in one flat list gave no reason for any
  // particular order, so finding "the one that slows things down" meant reading all fifteen
  // names. The headings use .devSubTitle, NOT .devSectionTitle — the latter is what splits the
  // panel into pages, and each category becoming its own page is the opposite of the point.
  const byCat = new Map();
  for (const sk of state.skillList) {
    const key = sk.category || 'dps';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(sk);
  }
  const ordered = [];
  for (const cat of SKILL_CATEGORIES) {
    const group = byCat.get(cat.id);
    if (!group || !group.length) continue;      // a category with nothing in it draws nothing
    ordered.push({ heading: cat.label });
    for (const sk of group) ordered.push({ sk });
    byCat.delete(cat.id);
  }
  // Anything whose category is unknown still gets shown rather than silently dropped.
  for (const [, group] of byCat) for (const sk of group) ordered.push({ sk });

  for (const entry of ordered) {
    if (entry.heading) {
      const h = document.createElement('div');
      h.className = 'devSubTitle';
      h.textContent = entry.heading;
      tuning.appendChild(h);
      continue;
    }
    const sk = entry.sk;
    const box = document.createElement('div');
    // "Unequipped" only means something during a run — on the main menu no skill is equipped,
    // so greying every box there would read as broken rather than informative.
    const off = state.inRun && !sk.active;
    box.className = 'tuneBox' + (off ? ' off' : '');
    // The accent drives the colour bars either side of the box. It's set inline, which beats
    // the stylesheet, so the greyed-out value has to be applied here rather than in CSS.
    box.style.setProperty('--accent', off ? '#3c3122' : sk.color);
    const icon = SKILL_ICONS[sk.icon] || '';
    // The icon is the on/off switch for the skill itself. It acts on the live player, so it
    // is inert outside a run.
    //
    // Save is gone from every box in this panel: changes persist as they are made, so the
    // button only ever confirmed something that had already happened.
    const dis = state.inRun ? '' : ' disabled';
    const offTitle = state.inRun ? 'Toggle this skill on/off' : 'Start a run to equip skills';
    box.innerHTML = `<div class="tuneHead">`
      + `<button class="gemIcon tuneIcon tuneToggle${sk.active ? ' active' : ''}"`
      + ` style="--accent:${sk.color}" data-skill="${sk.id}" title="${offTitle}"${dis}>${icon}</button>`
      + `<span class="tuneName">${sk.name}</span>`
      + `<button class="tuneReset" data-skill="${sk.id}">Reset</button></div>`;
    // Damage projection, at the top of the fold. Recomputed on every rebuild, and a tuning
    // change rebuilds the panel — so dragging Damage / Level moves these numbers as you drag.
    const proj = (sk.damageAt || []).filter((d) => d.dps !== undefined);
    const list = document.createElement('div');
    list.className = 'tuneList';
    if (proj.length) {
      const r = document.createElement('div');
      r.className = 'dmgProjection';
      r.dataset.skill = sk.id;
      fillProjection(r, sk.id);
      list.appendChild(r);
    }
    for (const stat of sk.stats) {
      buildTuneLine(list, `tune_${sk.id}`, stat, (v) => handlers.onTune(sk.id, stat.key, v));
    }
    box.appendChild(list);
    box.querySelector('.tuneReset').addEventListener('click', () => handlers.onResetSkill(sk.id));
    if (state.inRun) {
      box.querySelector('.tuneToggle').addEventListener('click', () => handlers.onToggleSkill(sk.id));
    }
    // Collapsed by default: fifteen skills of up to twelve dials each is a very long scroll,
    // and the thing you almost always want is to find ONE skill. The names alone make an index.
    // Same text treatment as the sound panels; see .tunePanel in style.css.
    box.classList.add('tunePanel');
    makeCollapsible(box, sk.id, openSkills);
    tuning.appendChild(box);
  }

  // ---- player and enemy stat sliders ----
  // Kept in their own container below the skills rather than mixed in: these are the numbers
  // the whole game is measured against, and a change here moves every run, not one gem.
  const ents = $('devEntityTuning');
  ents.innerHTML = '';
  buildTuneSection(ents, 'Player Multipliers',
    'Across-the-board dials, 1x as shipped. Health and speed apply on the NEXT run; damage is live.',
    state.playerList, handlers.playerTune, 'ptune');

  // Empty title: the dodge joins the Player page as a second box rather than opening its own.
  buildTuneSection(ents, '', '', state.dashList, handlers.dashTune, 'dstune');

  buildTuneSection(ents, 'Player Stats',
    'Base stats per class. Changes apply to your NEXT run.',
    state.classList, handlers.classTune, 'ctune');
  buildTuneSection(ents, 'Difficulty Curve',
    'End is where a stat lands; Bend is when it arrives — above 1 stacks it late. Log scale.',
    state.curveList, handlers.curveTune, 'gtune', (host) => buildCurveChart(host));

  if (state.sampleList && state.sampleList.length) {
    buildTuneSection(ents, 'Sound FX Samples',
      'IN/OUT bracket what plays, LOOP is where the body repeats. Drag the wave to audition.',
      state.sampleList, handlers.sampleTune, 'stune', null,
      (box, ent) => {
        const wrap = document.createElement('div');
        wrap.className = 'sampleWrap';
        wrap.appendChild(buildWave(ent.id));
        const play = document.createElement('button');
        play.className = 'samplePlay';
        play.type = 'button';
        play.title = 'Play through the real game path — trim, loop and pitch variation included';
        // The glyph carries the meaning, so the label no longer has to explain itself. The
        // tooltip keeps what the old wording said, since "as in game" is the point of it.
        play.innerHTML = '<span class="samplePlayIcon">▶</span>Play';
        // Through the real player, trim and loop included — the scrubber auditions the raw
        // recording, so without this there is no way to hear the thing you actually tuned.
        play.onclick = () => auditionSample(ent.id, SAMPLES[ent.id].loop ? 1.6 : 0);
        wrap.appendChild(play);
        box.appendChild(wrap);
        // Five samples of seven dials and a waveform each is the same scroll problem the skills
        // had. Folded by default for the same reason: you come here to find one sound.
        // Tagged so the sound panels can be styled apart from the other tune boxes.
        box.classList.add('sampleBox');
        makeCollapsible(box, ent.id, openSamples);
      });
  }

  // Sits at the FOOT of the sound page, under the individual samples: it is the level for
  // everything that is not one of them.
  // The two buses at the foot of the sound page, as a pair: recorded first because that is what
  // the individual sample panels above it feed into, then the synthesised family it is balanced
  // against. Both are strips — one dial each does not want a whole box.
  if (state.sampleFxList && state.sampleFxList.length) {
    buildTuneSection(ents, '', '', state.sampleFxList, handlers.sampleFxTune, 'sftune', null,
      (box) => box.classList.add('flatStripBox'));
  }
  if (state.procFxList && state.procFxList.length) {
    buildTuneSection(ents, '', '', state.procFxList, handlers.procFxTune, 'pftune', null,
      (box) => box.classList.add('flatStripBox'));
  }

  // Sits directly above the tier odds: one decides how big a roll is, the other how often each
  // size turns up, and they are only meaningful read together.
  if (state.skillRollList && state.skillRollList.length) {
    buildTuneSection(ents, 'Level-Up Rolls',
      'A skill level-up grants one thing: +damage%. Its size is priced against a Damage tome '
      + 'level, so tuning the tome moves these with it.',
      state.skillRollList, handlers.skillRollTune, 'srtune', (host) => buildSkillRollTable(host));
  }
  if (state.upgradeList && state.upgradeList.length) {
    buildTuneSection(ents, '',
      'How often each tier appears on a card. Weights are relative; the bars below are the result.',
      state.upgradeList, handlers.upgradeTune, 'uptune',
      (host) => { lastOddsRows = state.upgradeOdds || []; buildUpgradeOdds(host); });
  }

  buildTuneSection(ents, 'Loot Quality',
    'Affix size by rarity. Common is 1x, Unique lands on End; Bend shapes everything between.',
    state.rarityList, handlers.rarityTune, 'rtune', (h) => buildLootChart(h));
  // Which tier drops belongs beside how good a tier IS — the chart above plots both, and the
  // two are tuned against each other rather than against the gold and potion rates.
  buildTuneSection(ents, '', '', state.dropList, handlers.dropTune, 'dtune');

  // Everything that decides WHAT falls off a corpse, in one place. These were three separate
  // stretches of panel — two of them with no heading at all — which meant comparing a gold rate
  // against a chest rate involved scrolling between them.
  // Order here IS the layout: the chart leads, the two curves that shape it sit directly under
  // it side by side, then the gold dials take the left column with the two short boxes stacked
  // beside them. See .devPageDrops.
  buildTuneSection(ents, 'Drops',
    'Curves scale what a coin is WORTH — a drop chance stops at 100%, so it cannot accelerate.',
    state.goldCurveList, handlers.goldCurveTune, 'gctune', (host) => {
      buildGoldChart(host);
      const r = document.createElement('div');
      r.className = 'curveReadout goldCtxReadout';
      const ctx = state.goldCtx;
      const NAMES = { normal: 'Normal', horde: 'Horde Rush', endless: 'Endless' };
      // Says what is ACTIVE, not what is configured — during a run the three sliders below
      // are not equally in play, and which one is live changes as the run progresses.
      // Horde also reports its own clock, because that is what its multiplier is riding on and
      // the number is meaningless without it.
      r.innerHTML = ctx
        ? `<b>Active now:</b> ${NAMES[ctx]} — ${state.goldChance}% of kills leave a coin, `
          + `coins worth ${state.goldMult}×`
          + (ctx === 'horde' ? ` (${state.hordeSeconds}s into this rush)` : '')
        : '<b>Active now:</b> no run in progress — Normal applies at the start of one';
      host.appendChild(r);
    });
  // Gold is the tall box that holds the left column; marked here rather than by position, so
  // reordering the sections above cannot silently hand the span to a different box.
  buildTuneSection(ents, '', '', state.goldList, handlers.goldTune, 'ggtune', null,
    (box) => box.classList.add('devBoxPrimary'));
  buildTuneSection(ents, '', '', state.potionList, handlers.potionTune, 'pptune');
  buildTuneSection(ents, '', '', state.rateList, handlers.rateTune, 'ktune');
  if (state.tomeList && state.tomeList.length) {
    buildTuneSection(ents, 'Tomes',
      'Same End / Bend / Tail dials as the difficulty curve, with tome level on the x axis.',
      state.tomeList, handlers.tomeTune, 'tmtune', (host) => {
        buildTomeChart(host);
        // Numbers under the picture: the chart shows how each tome bends, the table shows what
        // it is actually worth at the levels a run reaches.
        buildTomeBreakpoints(host);
        // The master sits directly under the chart, above the nine it governs — it is the
        // thing you reach for first when the whole shelf feels wrong.
        buildTuneSection(host, '', '', state.tomeMasterList, handlers.tomeMasterTune, 'tmmtune',
          null, (box) => box.classList.add('tomeMasterBox'));
      });
    // Below the dials, not above them: this keeps the proportions chart and the sliders on
    // screen together, which is the pairing you actually work in.
    buildTomeCountChart(ents);
  }

  if (state.graphicsList && state.graphicsList.length) {
    buildTuneSection(ents, 'Graphics',
      'Scene-wide render settings. These change the look, never the balance.',
      state.graphicsList, handlers.graphicsTune, 'gfxtune');
  }

  if (state.terrainList && state.terrainList.length) {
    buildTuneSection(ents, 'Terrain',
      'Impassable rock scattered through the arena. Rebuilt each stage.',
      state.terrainList, handlers.terrainTune, 'trtune');
  }

  if (state.terrainColorList && state.terrainColorList.length) {
    buildTuneSection(ents, 'Rock Colours',
      'Per-stage rock tint. Colour only — nothing here reshuffles the layout.',
      state.terrainColorList, handlers.terrainColorTune, 'trcolor');
  }

  if (state.eliteList && state.eliteList.length) {
    buildTuneSection(ents, 'Elites',
      'Named mid-tier foes. One ability each, always drop a chest.',
      state.eliteList, handlers.eliteTune, 'eltune');
  }

  if (state.voidList && state.voidList.length) {
    buildTuneSection(ents, 'Void Afflicted',
      'How often the void takes a body, and what its four powers do.',
      state.voidList, handlers.voidTune, 'voidtune');
  }

  // ---- Relics ----
  // Twirl-down per relic, like the skills page and for the same reason: six panels of dials is a
  // scroll, and what you want is almost always ONE relic.
  if (state.relicList && state.relicList.length) {
    buildTuneSection(ents, 'Relics',
      'Found in endless chests, capped at four, upgraded only by duplicates.',
      state.relicGlobal, handlers.relicTune, 'rlgtune', null,
      (box) => box.classList.add('flatStripBox'));
    buildTuneSection(ents, '', '', state.relicList, handlers.relicTune, 'rltune', null,
      (box, ent) => { box.classList.add('tunePanel'); makeCollapsible(box, ent.id, openRelics); });
  }

  buildTuneSection(ents, 'Enemy Stats',
    'Roster-wide multipliers, 1× as shipped. Applies to enemies spawned from now on.',
    state.enemyList, handlers.enemyTune, 'etune');

  // Health gets its own strips under the main box rather than four more rows inside it. They are
  // the numbers most often reached for, and a slider you are dragging against a health bar you
  // just watched should not be the seventh row of nine. Both untitled, so they join the Enemies
  // page instead of opening their own.
  if (state.enemyHpList && state.enemyHpList.length) {
    buildTuneSection(ents, '', '', state.enemyHpList, handlers.enemyTune, 'ehtune', null,
      (box) => box.classList.add('flatStripBox'));
  }
  // The three bosses side by side rather than stacked: the question being asked here is always
  // "is this one out of line with the other two", which is a comparison, not three readings.
  if (state.bossHpList && state.bossHpList.length) {
    buildTuneSection(ents, '', '', state.bossHpList, handlers.enemyTune, 'bhtune', null,
      (box) => box.classList.add('flatStripBox', 'flatStripWide'));
  }

  $('devMenu').classList.remove('hidden');

  // Everything is built; now split it into pages behind the icon grid.
  paginateDevTools($('devBody'));
  restoreDevPanelPosition(body, keepScroll, keepFocus);
}

export function hideDevTools() { $('devMenu').classList.add('hidden'); }

export function hideSettingsMenu() { $('settingsMenu').classList.add('hidden'); }

// Unlocks screen: a grid of every skill gem (icon + name).
// Two catalogues in one screen: the skill gems you cast, then the tomes you carry. Cells are
// styled as buttons ahead of being selectable — the eventual loadout screen picks from here,
// so the affordance is deliberate rather than premature.
function unlockSection(title, entries, iconFor) {
  const wrap = document.createElement('div');
  wrap.className = 'unlockSection';
  const h = document.createElement('div');
  h.className = 'unlockSectionTitle';
  h.textContent = title;
  wrap.appendChild(h);
  const grid = document.createElement('div');
  grid.className = 'unlocksGrid';
  for (const e of entries) {
    const cell = document.createElement('div');
    cell.className = 'unlockCell';
    const icon = iconFor(e) || `<span>${e.name[0]}</span>`;
    cell.innerHTML = `<div class="gemIcon unlockIcon" style="--accent:${e.color}">${icon}</div><div class="unlockName">${e.name}</div>`;
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);
  return wrap;
}

// ---------- Achievements ----------
// One card per track, showing ONLY the rung currently being climbed. The full ladder was on
// screen at first and it read as a wall of numbers you could not act on — five targets, four of
// them irrelevant. What matters is the one in front of you and how far along it you are, so the
// card is that: a count against the current target, a bar, and a "2/5" to say where on the climb
// this rung sits. Taking a tier advances the card to the next one on its own.
export function showAchievements(rows) {
  const host = $('achievementsBody');
  host.innerHTML = '';
  for (const r of rows) {
    const card = document.createElement('div');
    card.className = 'achieveRow' + (r.complete ? ' complete' : '');

    const head = document.createElement('div');
    head.className = 'achieveHead';
    const name = document.createElement('div');
    name.className = 'achieveName';
    name.textContent = r.rank ? `${r.name} — ${r.rank}` : r.name;
    const badge = document.createElement('div');
    badge.className = 'achieveBadge';
    // done+1 while climbing (the rung being worked on), pinned to the last one when finished.
    badge.textContent = r.complete ? `${r.tiers.length}/${r.tiers.length}`
                                   : `${r.done + 1}/${r.tiers.length}`;
    head.append(name, badge);

    // The count reads AGAINST the current target rather than as a bare lifetime total: the
    // target is the thing being progressed, so the two belong in one line.
    const count = document.createElement('div');
    count.className = 'achieveCount';
    if (r.complete) {
      count.textContent = r.value.toLocaleString();
    } else {
      count.innerHTML = `${r.value.toLocaleString()}<span class="achieveTarget"> / ${r.next.toLocaleString()}</span>`;
    }

    const track = document.createElement('div');
    track.className = 'achieveTrack';
    const fill = document.createElement('div');
    fill.className = 'achieveFill';
    fill.style.width = `${Math.round(r.fraction * 100)}%`;
    track.appendChild(fill);

    const desc = document.createElement('div');
    desc.className = 'achieveDesc';
    desc.textContent = r.complete ? `${r.desc}  ·  every mark taken` : r.desc;

    card.append(head, count, track, desc);
    host.appendChild(card);
  }
  $('achievementsMenu').classList.remove('hidden');
}
export function hideAchievements() { $('achievementsMenu').classList.add('hidden'); }

// ---------- Tome breakpoint table ----------
// The chart shows the SHAPE; this shows the numbers a player will actually read on a card. Both
// come from tomeDesc, so a row here is literally the level-up text at that level — there is no
// second formatter to drift, and a rounded count cannot disagree with the curve it came from.
const TOME_BREAKPOINTS = [1, 5, 10, 15, 20, 25];

function buildTomeBreakpoints(host) {
  const box = document.createElement('div');
  box.className = 'breakTable';
  box.id = 'tomeBreaks';
  host.appendChild(box);
  refreshTomeBreakpoints();
}

export function refreshTomeBreakpoints() {
  const box = document.getElementById('tomeBreaks');
  if (!box) return;
  const head = `<div class="breakRow breakHead"><div class="breakName"></div>${
    TOME_BREAKPOINTS.map((L) => `<div class="breakCell">Lv ${L}</div>`).join('')}</div>`;
  const rows = SUPPORT_ORDER.map((id) => {
    const def = SUPPORTS[id];
    return `<div class="breakRow">
      <div class="breakName" style="--c:${def.color}">${def.name}</div>
      ${TOME_BREAKPOINTS.map((L) => `<div class="breakCell">${tomeValueAt(id, L)}</div>`).join('')}
    </div>`;
  }).join('');
  box.innerHTML = head + rows;
}

// Just the magnitude, without the sentence around it — a table wants "+107%", not
// "+107% skill damage" repeated down every row under a column already labelled Lv 10.
function tomeValueAt(id, lvl) {
  const full = tomeDesc(id, lvl);
  const m = full.match(/[-+]?\d[\d.]*%?/);
  return m ? m[0] : full;
}

// ---------- Skill level-up damage, per tier ----------
// The whole point of pricing skill rolls against the Damage tome is being able to SEE the
// comparison, so the table states both: what each tier grants, and what one tome level is worth
// at the reference level. If the Common row and the tome row are wildly apart, one of the two is
// mistuned — which was impossible to notice while these were five unrelated constants.
function buildSkillRollTable(host) {
  const box = document.createElement('div');
  box.className = 'breakTable';
  box.id = 'skillRollTable';
  host.appendChild(box);
  refreshSkillRollTable();
}

export function refreshSkillRollTable() {
  const box = document.getElementById('skillRollTable');
  if (!box) return;
  const step = tomeDamageStep();
  box.innerHTML = `<div class="breakRow breakHead"><div class="breakName">Tier</div>`
    + `<div class="breakCell">+damage</div><div class="breakCell">vs tome lv</div></div>`
    + UPGRADE_TIERS.map((t, i) => {
      const v = skillDamageRoll(i);
      return `<div class="breakRow"><div class="breakName" style="--c:${t.color}">${t.name}</div>`
        + `<div class="breakCell">+${(v * 100).toFixed(0)}%</div>`
        + `<div class="breakCell">${(v / step).toFixed(2)}×</div></div>`;
    }).join('')
    + `<div class="oddsFoot">one Damage tome level at Lv ${Math.round(SKILL_DAMAGE.refLevel)} `
    + `is worth +${(step * 100).toFixed(0)}% — the unit these are priced in</div>`;
}

// ---------- Level-up odds readout ----------
// Five relative weights tell you nothing on their own. This turns them into the two numbers that
// matter: the per-card tier split, and the chance a level-up shows at least one Epic-or-better —
// which is what "rarity feels too high" actually means.
function buildUpgradeOdds(host) {
  const box = document.createElement('div');
  box.className = 'oddsTable';
  box.id = 'upgradeOdds';
  host.appendChild(box);
  refreshUpgradeOdds(null);
}

/** @type {any[]} */
let lastOddsRows = [];

/** @param {{label:string, tiers:{name:string,color:string,pct:number}[], anyEpic:number}[]} rows */
export function refreshUpgradeOdds(rows) {
  refreshSkillRollTable();
  if (rows) lastOddsRows = rows;
  const box = document.getElementById('upgradeOdds');
  if (!box || !lastOddsRows.length) return;
  box.innerHTML = lastOddsRows.map((r) => `
    <div class="oddsRow">
      <div class="oddsLabel">${r.label}</div>
      <div class="oddsBars">${r.tiers.map((t) => t.pct < 0.05 ? '' :
        `<span class="oddsSeg" style="--c:${t.color};flex:${t.pct}" title="${t.name} ${t.pct.toFixed(1)}%"></span>`).join('')}</div>
      <div class="oddsAny">${r.anyEpic.toFixed(0)}%</div>
    </div>`).join('')
    + `<div class="oddsFoot">bar = one card's tier split · right column = chance of any Epic+ across the three cards</div>`;
}

export function showUnlocks(skills, tomes = []) {
  const host = $('unlocksBody');
  host.innerHTML = '';
  host.appendChild(unlockSection('Skills', skills, (s) => SKILL_ICONS[s.icon]));
  if (tomes.length) host.appendChild(unlockSection('Tomes', tomes, (t) => TOME_ICONS[t.id]));
  $('unlocksMenu').classList.remove('hidden');
}
export function hideUnlocks() { $('unlocksMenu').classList.add('hidden'); }

// ---------- Music player ----------
// Rebuilt from the track list every time it opens, so a track added to the manifest appears
// without anything here needing to know about it. `nowPlayingId` marks the current one, which
// is the difference between a list of songs and a player.
/**
 * Rebuild the transport row. Split out of showMusicMenu because the play/pause glyph has to be
 * repainted when the button is pressed, and rebuilding the whole screen for that would rip the
 * track list out from under the scroll position.
 * @param {{paused: boolean, onPrev: () => void, onNext: () => void, onToggle: () => void}} t
 */
function renderTransport(t) {
  const host = $('musicTransport');
  if (!host || !t) return;
  host.innerHTML = '';
  for (const b of [
    { glyph: '<<', title: 'Previous track', fn: t.onPrev },
    // One button, two states — the glyph is the readout. Showing ▶ while paused and ❚❚ while
    // playing follows every media player there is: the icon is what pressing it will do.
    { glyph: t.paused ? '▶' : '❚❚', title: t.paused ? 'Resume' : 'Pause', fn: t.onToggle },
    { glyph: '>>', title: 'Next track', fn: t.onNext },
  ]) {
    const el = document.createElement('button');
    el.className = 'transportBtn';
    el.type = 'button';
    el.textContent = b.glyph;
    el.title = b.title;
    el.setAttribute('aria-label', b.title);
    el.addEventListener('click', b.fn);
    host.appendChild(el);
  }
}

/** Repaint just the play/pause glyph after a toggle. */
export function refreshMusicTransport(t) { renderTransport(t); }

/**
 * Move the ▶ to whichever row is playing, in place.
 *
 * Deliberately not a rebuild. Tracks change on their own — one ends, a stage starts, a boss
 * appears — and rebuilding eighteen rows for that would throw away the list's scroll position
 * while the player is reading it. Touching two rows keeps their place.
 *
 * @param {string|null} nowPlayingId
 */
export function markNowPlaying(nowPlayingId) {
  const host = $('musicBody');
  if (!host) return;
  // querySelectorAll is typed as Element, which has no dataset; these are all HTMLElements.
  for (const btn of /** @type {NodeListOf<HTMLElement>} */ (host.querySelectorAll('.settingOption'))) {
    const playing = btn.dataset.trackId === nowPlayingId;
    btn.classList.toggle('active', playing);
    const label = btn.querySelector('.settingOptionLabel');
    if (label) label.textContent = `${playing ? '▶' : '♪'} ${btn.dataset.trackName}`;
  }
}

export function showMusicMenu(tracks, nowPlayingId, onPlay, mode = 'off', onMode, transport) {
  const host = $('musicBody');
  host.innerHTML = '';
  for (const t of tracks || []) {
    const btn = document.createElement('button');
    btn.className = 'settingOption';
    // Stashed on the element so markNowPlaying can move the ▶ without rebuilding the list.
    btn.dataset.trackId = t.id;
    btn.dataset.trackName = t.name;
    const label = document.createElement('div');
    label.className = 'settingOptionLabel';
    btn.appendChild(label);
    btn.addEventListener('click', () => onPlay(t.id));
    host.appendChild(btn);
  }
  markNowPlaying(nowPlayingId);
  // The mode buttons. Rendered from the same list every time so the active one is always
  // whichever the audio layer actually reports, not a copy the UI keeps and can get wrong.
  const modes = $('musicModes');
  if (modes) {
    modes.innerHTML = '';
    for (const m of [
      { id: 'shuffle', label: '⤨ Shuffle', desc: 'Every track, any stage' },
      { id: 'loop', label: '⟳ Loop', desc: 'Repeat this one' },
      // 'off' is the resting state, not an opt-out — with no override the game just uses each
      // stage's own playlist. Named for what it does rather than for what it turns off, and it
      // lights up like the other two so one of the three is always visibly the current mode.
      { id: 'off', label: '✦ Default', desc: 'Default Playlists' },
    ]) {
      const b = document.createElement('button');
      b.className = 'ghostBtn' + (mode === m.id ? ' active' : '');
      b.innerHTML = `<div class="settingOptionLabel">${m.label}</div><div class="settingOptionDesc">${m.desc}</div>`;
      if (onMode) b.addEventListener('click', () => onMode(m.id));
      modes.appendChild(b);
    }
  }
  renderTransport(transport);
  $('musicMenu').classList.remove('hidden');
}
export function hideMusicMenu() { $('musicMenu').classList.add('hidden'); }

// ---------- Sandbox setup ----------
// Builds the whole scenario picker from data every time it opens, so newly added skills,
// tomes and enemies appear without touching this file. `cfg` is mutated in place and read
// back by the caller when Begin is pressed — no separate serialisation step to keep in sync.
//
// Every control is a real <button> or <input>, which is what makes the screen controller-
// navigable for free: the existing grid navigator already walks those.
export function showSandbox(cfg, opts, handlers) {
  const host = $('sandboxBody');
  host.innerHTML = '';

  const section = (title, hint) => {
    const w = document.createElement('div');
    w.className = 'sandboxSection';
    w.innerHTML = `<div class="unlockSectionTitle">${title}</div>`
      + (hint ? `<div class="devHint">${hint}</div>` : '');
    host.appendChild(w);
    return w;
  };

  // ---- character: swappable at any time, including mid-run from the pause menu. The class
  // sets base life/speed/armour, so being able to change it without restarting is the point —
  // the same loadout can be compared across bodies.
  const ch = section('Character');
  const chGrid = document.createElement('div');
  chGrid.className = 'sandboxGrid sandboxEnemyGrid';
  for (const c of opts.classes) {
    const on = cfg.classId === c.id;
    const cell = document.createElement('div');
    cell.className = 'sandboxCell' + (on ? '' : ' off');
    const btn = document.createElement('button');
    btn.className = 'sandboxEnemyBtn' + (on ? ' picked' : '');
    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 96; cv.className = 'sandboxEnemyPortrait';
    btn.appendChild(cv);
    btn.title = `${c.name} — ${c.base.maxHp} life · ${c.base.speed} speed · ${c.base.armor} armor`;
    btn.addEventListener('click', () => handlers.onPickClass(c.id));
    const name = document.createElement('div');
    name.className = 'unlockName';
    name.textContent = c.name;
    cell.append(btn, name);
    chGrid.appendChild(cell);
    if (handlers.paintClass) handlers.paintClass(cv, c.id);
  }
  ch.appendChild(chGrid);

  // ---- stage: sets the arena the whole scenario is staged in — floor art,
  // lighting and boundary all come from the stage def, and enemies read very differently
  // against one backdrop than another.
  const st = section('Stage');
  const stRow = document.createElement('div');
  stRow.className = 'settingOptions';
  opts.stages.forEach((s2, i) => {
    const b = document.createElement('button');
    b.className = 'settingOption' + (cfg.stage === i ? ' active' : '');
    b.innerHTML = `<div class="settingOptionLabel">${i + 1} — ${s2.name}</div>`
      + `<div class="settingOptionDesc">${s2.flavor}</div>`;
    b.addEventListener('click', () => handlers.onPickStage(i));
    stRow.appendChild(b);
  });
  st.appendChild(stRow);

  // ---- play a stage for real -----------------------------------------------------------
  // The picker above only chooses the BACKDROP for a sandbox scenario. These launch the actual
  // game at that stage — waves, boss clock, progression — so a later realm can be tested
  // without playing the earlier ones to reach it. Separated by their own caption because the
  // two rows look alike and do very different things: one dresses a set, the other starts a run.
  const playNote = document.createElement('div');
  playNote.className = 'devHint';
  playNote.textContent = 'Or play a stage for real — normal waves, boss and progression. '
    + 'Uses the character above; the scenario below is ignored.';
  st.appendChild(playNote);
  const playRow = document.createElement('div');
  playRow.className = 'settingOptions';
  opts.stages.forEach((s2, i) => {
    const b = document.createElement('button');
    b.className = 'settingOption sandboxPlayStage';
    b.innerHTML = `<div class="settingOptionLabel">▶ Play Stage ${i + 1}</div>`
      + `<div class="settingOptionDesc">${s2.name}</div>`;
    b.addEventListener('click', () => handlers.onPlayStage(i));
    playRow.appendChild(b);
  });
  st.appendChild(playRow);

  // ---- god mode: because a scenario you die out of measures nothing. Sandbox keeps its own
  // flag rather than borrowing the dev-tools setting, so turning it on for a test cannot leak
  // into a real run.
  const gm = section('Player');
  const gmBtn = document.createElement('button');
  gmBtn.className = 'settingOption' + (cfg.godMode ? ' active' : '');
  gmBtn.innerHTML = `<div class="settingOptionLabel">God Mode: ${cfg.godMode ? 'ON' : 'OFF'}</div>`
    + '<div class="settingOptionDesc">Player takes no damage</div>';
  gmBtn.addEventListener('click', () => handlers.onToggleGod());
  const gmWrap = document.createElement('div');
  gmWrap.className = 'settingOptions';
  gmWrap.appendChild(gmBtn);
  gm.appendChild(gmWrap);

  // ---- skills: toggle + five level stars ----
  // Says "the skill cap" rather than naming a number: the cap is 3 plus whatever the shop has
  // bought, so any figure written here would be wrong for most players and go stale besides.
  const sk = section('Skills', 'Click an icon to equip · stars set its level · the skill cap is ignored here');
  const skGrid = document.createElement('div');
  skGrid.className = 'sandboxGrid';
  for (const s of opts.skills) {
    const lvl = cfg.skills[s.id] || 0;
    const cell = document.createElement('div');
    cell.className = 'sandboxCell' + (lvl ? '' : ' off');
    const icon = document.createElement('button');
    icon.className = 'gemIcon unlockIcon sandboxIconBtn';
    icon.style.setProperty('--accent', s.color);
    icon.innerHTML = SKILL_ICONS[s.icon] || `<span>${s.name[0]}</span>`;
    icon.title = `${s.name} — toggle`;
    icon.addEventListener('click', () => handlers.onToggleSkill(s.id));
    const name = document.createElement('div');
    name.className = 'unlockName';
    name.textContent = s.name;
    const stars = document.createElement('div');
    stars.className = 'sandboxStars';
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement('button');
      b.className = 'sandboxStar' + (i <= lvl ? ' on' : '');
      b.textContent = i <= lvl ? '★' : '☆';
      b.title = `Level ${i}`;
      // Clicking the star you are already at clears back to unequipped, so a level can be
      // taken back down without hunting for a separate control.
      b.addEventListener('click', () => handlers.onSetSkillLevel(s.id, lvl === i ? 0 : i));
      stars.appendChild(b);
    }
    cell.append(icon, name, stars);
    skGrid.appendChild(cell);
  }
  sk.appendChild(skGrid);

  // ---- tomes: toggle + level slider ----
  const tm = section('Tomes', 'Sliders adjust live during play — the tome cap is ignored here');
  const tmGrid = document.createElement('div');
  tmGrid.className = 'sandboxGrid';
  for (const t of opts.tomes) {
    const lvl = cfg.tomes[t.id] || 0;
    const cell = document.createElement('div');
    cell.className = 'sandboxCell' + (lvl ? '' : ' off');
    const icon = document.createElement('button');
    icon.className = 'gemIcon unlockIcon sandboxIconBtn';
    icon.style.setProperty('--accent', t.color);
    icon.innerHTML = TOME_ICONS[t.id] || `<span>${t.name[0]}</span>`;
    icon.title = `${t.name} — toggle`;
    icon.addEventListener('click', () => handlers.onToggleTome(t.id));
    const name = document.createElement('div');
    name.className = 'unlockName';
    name.textContent = t.name;
    const row = document.createElement('div');
    row.className = 'gpSlider sandboxSlider';
    // Same `tuneSlider` class the dev tools use: one definition of the blocky track/thumb
    // rather than a second copy that would drift out of step with it.
    row.innerHTML = `<input class="tuneSlider" type="range" min="0" max="20" step="1" value="${lvl}">`
      + `<span class="sandboxSliderVal">Lv ${lvl}</span>`;
    const range = qInput(row, 'input');
    range.addEventListener('input', () => handlers.onSetTomeLevel(t.id, +range.value));
    cell.append(icon, name, row);
    tmGrid.appendChild(cell);
  }
  tm.appendChild(tmGrid);

  // ---- enemies: single pick, then its spawn options ----
  const en = section('Enemy', 'Pick one to place — its options appear below');
  const enGrid = document.createElement('div');
  enGrid.className = 'sandboxGrid sandboxEnemyGrid';
  for (const e of opts.enemies) {
    const on = cfg.enemy.id === e.id;
    const cell = document.createElement('div');
    cell.className = 'sandboxCell' + (on ? '' : ' off');
    const btn = document.createElement('button');
    btn.className = 'sandboxEnemyBtn' + (on ? ' picked' : '');
    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 96; cv.className = 'sandboxEnemyPortrait';
    btn.appendChild(cv);
    btn.title = e.name;
    btn.addEventListener('click', () => handlers.onPickEnemy(e.id));
    const name = document.createElement('div');
    name.className = 'unlockName';
    name.textContent = e.name;
    cell.append(btn, name);
    enGrid.appendChild(cell);
    if (handlers.paintEnemy) handlers.paintEnemy(cv, e.id);
  }
  en.appendChild(enGrid);

  if (cfg.enemy.id) {
    const o = document.createElement('div');
    o.className = 'sandboxEnemyOpts';
    const chosen = opts.enemies.find((x) => x.id === cfg.enemy.id);
    o.innerHTML = `<div class="sandboxOptTitle">${chosen ? chosen.name : ''}</div>`;

    const slider = document.createElement('div');
    slider.className = 'gpSlider sandboxSlider wide';
    slider.innerHTML = `<label>Count</label><input class="tuneSlider" type="range" min="1" max="500" step="1" value="${cfg.enemy.count}">`
      + `<span class="sandboxSliderVal">${cfg.enemy.count}</span>`;
    const cr = qInput(slider, 'input');
    cr.addEventListener('input', () => handlers.onEnemyOpt('count', +cr.value));
    o.appendChild(slider);

    const toggle = (label, key, onText, offText) => {
      const b = document.createElement('button');
      b.className = 'settingOption' + (cfg.enemy[key] ? ' active' : '');
      b.innerHTML = `<div class="settingOptionLabel">${label}: ${cfg.enemy[key] ? onText : offText}</div>`;
      b.addEventListener('click', () => handlers.onEnemyOpt(key, !cfg.enemy[key]));
      return b;
    };
    // Behaviour has three states, so it cycles through an ordered list rather than flipping a
    // boolean. Same control, same one-click feel — it just wraps at the end instead of at two.
    const cycle = (label, key, states) => {
      const i = Math.max(0, states.findIndex((st) => st.value === cfg.enemy[key]));
      const b = document.createElement('button');
      b.className = 'settingOption' + (i === 0 ? ' active' : '');
      b.innerHTML = `<div class="settingOptionLabel">${label}: ${states[i].text}</div>`;
      b.addEventListener('click', () => handlers.onEnemyOpt(key, states[(i + 1) % states.length].value));
      return b;
    };
    const opts2 = document.createElement('div');
    opts2.className = 'settingOptions';
    opts2.append(
      cycle('Behaviour', 'behaviour', [
        { value: 'hunt', text: 'Hunts you' },
        { value: 'ignore', text: 'Ignores you' },
        { value: 'wander', text: 'Wanders' },
      ]),
      toggle('Arrangement', 'line', 'Line', 'Grid'),
      toggle('Health', 'infiniteHp', 'Infinite', 'Normal'),
    );
    o.appendChild(opts2);

    // Spacing sits with the arrangement controls because it modifies them: it is the gap
    // between placements, and applies the same way to a grid or a line.
    const sp = document.createElement('div');
    sp.className = 'gpSlider sandboxSlider wide';
    sp.innerHTML = '<label>Spacing</label>'
      + `<input class="tuneSlider" type="range" min="0.5" max="5" step="0.1" value="${cfg.enemy.spacing}">`
      + `<span class="sandboxSliderVal">${cfg.enemy.spacing.toFixed(1)}x</span>`;
    const spr = qInput(sp, 'input');
    spr.addEventListener('input', () => handlers.onEnemyOpt('spacing', +spr.value));
    o.appendChild(sp);

    en.appendChild(o);
  }

  // ---- boss: its own pick, separate from the roster ----
  // Bosses are not in ENEMY_TYPES — they are built by makeBoss() from the stage definition —
  // so they need their own list rather than an entry in the grid above. Kept as a separate
  // section for the same reason: you place a horde OR you place a boss, and the count and
  // arrangement controls above mean nothing for a single one.
  const bs = section('Boss', 'Spawn a stage boss to fight — none by default');
  const bsGrid = document.createElement('div');
  // Boss cards are PORTRAIT, not square like the roster above. A boss is a full figure with a
  // crown, a cape and a weapon rather than a head-and-shoulders, and a square card could only
  // show him by cropping — his own art is 74x128, so a square frame either cut the crown off
  // the top or, once shrunk to fit, stopped covering the card and showed its own side edges.
  bsGrid.className = 'sandboxGrid sandboxEnemyGrid sandboxBossGrid';
  for (const b of opts.bosses || []) {
    const on = cfg.boss.id === b.id;
    const cell = document.createElement('div');
    cell.className = 'sandboxCell' + (on ? '' : ' off');
    const btn = document.createElement('button');
    btn.className = 'sandboxEnemyBtn' + (on ? ' picked' : '');
    const cv = document.createElement('canvas');
    // 96x184 — must stay in step with the aspect-ratio on .sandboxBossGrid .sandboxEnemyBtn,
    // or the backing store and the drawn box disagree and the art skews.
    cv.width = 96; cv.height = 184; cv.className = 'sandboxEnemyPortrait';
    btn.appendChild(cv);
    btn.title = b.name;
    btn.addEventListener('click', () => handlers.onPickBoss(b.id));
    const name = document.createElement('div');
    name.className = 'unlockName';
    name.textContent = b.name;
    cell.append(btn, name);
    bsGrid.appendChild(cell);
    if (handlers.paintBoss) handlers.paintBoss(cv, b.spriteId);
  }
  bs.appendChild(bsGrid);

  if (cfg.boss.id) {
    const o = document.createElement('div');
    o.className = 'sandboxEnemyOpts';
    const chosen = (opts.bosses || []).find((x) => x.id === cfg.boss.id);
    o.innerHTML = `<div class="sandboxOptTitle">${chosen ? chosen.name : ''}</div>`;
    const hp = document.createElement('button');
    hp.className = 'settingOption' + (cfg.boss.infiniteHp ? ' active' : '');
    hp.innerHTML = `<div class="settingOptionLabel">Health: ${cfg.boss.infiniteHp ? 'Infinite' : 'Normal'}</div>`
      + '<div class="settingOptionDesc">Infinite keeps it alive while you watch what it does.</div>';
    hp.addEventListener('click', () => handlers.onBossOpt('infiniteHp', !cfg.boss.infiniteHp));
    o.appendChild(hp);
    bs.appendChild(o);
  }

  const startBtn = $('sandboxStartBtn');
  const backBtn = $('sandboxBackBtn');
  startBtn.textContent = opts.live ? 'Apply & Resume' : 'Begin';
  backBtn.textContent = opts.live ? '← Back to Pause' : '← Back';
  $('sandboxMenu').classList.remove('hidden');
}
export function hideSandbox() { $('sandboxMenu').classList.add('hidden'); }

// Full-screen stage title card: big title + subtext, no background, holds then fades.
let stageCardTimer = null;
export function showStageCard(title, subtitle, variant) {
  const card = $('stageCard');
  $('stageCardTitle').textContent = title;
  $('stageCardSub').textContent = subtitle || '';
  // Strip the variant before the reflow below, not after: the slam animation only replays if the
  // class is absent across a layout boundary, and a second horde rush with a card that merely
  // fades in would read as a bug.
  card.classList.remove('hidden', 'fading', 'show', 'blood', 'void');
  if (variant) card.classList.add(variant);
  // force reflow so re-show restarts the transition cleanly
  void card.offsetWidth;
  card.classList.add('show');
  if (stageCardTimer) clearTimeout(stageCardTimer);
  stageCardTimer = setTimeout(() => {
    card.classList.remove('show');
    card.classList.add('fading'); // 0.66s fade
    stageCardTimer = setTimeout(() => { card.classList.add('hidden'); card.classList.remove('fading'); stageCardTimer = null; }, 660);
  }, 2000); // hold 2s
}

let toastTimer = null;
const toastQueue = [];
/**
 * @param {string} title
 * @param {string} subtitle
 * @param {string} [color] accent for the spine
 * @param {string} [tier] rarity id — tints the whole card, see .toastTier* in style.css
 */
export function showToast(title, subtitle, color, tier) {
  toastQueue.push({ title, subtitle, color, tier });
  if (!toastTimer) drainToasts();
}
function drainToasts() {
  const next = toastQueue.shift();
  if (!next) { toastTimer = null; return; }
  const el = document.createElement('div');
  // A rarity tier repaints the card; without one it keeps the default red fill.
  el.className = 'toast' + (next.tier ? ` toastTier toastTier-${next.tier}` : '');
  el.style.setProperty('--accent', next.color || '#4a6fa5');
  el.innerHTML = `<div class="toastTitle">${next.title}</div><div class="toastSubtitle">${next.subtitle}</div>`;
  $('toastContainer').appendChild(el);
  setTimeout(() => { el.classList.add('show'); syncToastHeight(); }, 10);
  // 4.5s on screen (was 3.5). The gap between toasts stays at 550ms, so a queue still drains
  // at the same rate — this only lengthens how long each one is readable.
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.remove(); syncToastHeight(); }, 300);
  }, 4500);
  toastTimer = setTimeout(drainToasts, 550);
}

// Publishes how tall the toast stack currently is, so the Now Playing flash can sit above it.
// Both are anchored to the bottom-right corner, and a song change landing on top of a pickup
// notice made an unreadable pile of the two; this lets the flash step up out of the way and
// drop back down once the stack empties. Measured rather than assumed because a toast's height
// depends on how far its subtitle wraps.
function syncToastHeight() {
  const box = $('toastContainer');
  const h = box.children.length ? Math.round(box.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--toast-h', `${h}px`);
}

// The global "now playing" flash. Re-triggering while one is already on screen restarts the
// cycle rather than being ignored — reflow between removing and re-adding the class is what
// makes the CSS animation actually replay.
export function showNowPlaying(name) {
  const el = $('nowPlaying');
  if (!el || !name) return;
  $('npTitle').textContent = name;
  el.classList.remove('playing');
  void el.offsetWidth;
  el.classList.add('playing');
}

/**
 * Repaint the relic strip. Called only when the set actually changes — a relic find is rare, so
 * rebuilding four rows then is free, where doing it per frame would not be.
 * @param {{ id: string, name: string, icon: string, color: string, tier: number, desc: string }[]} relics
 */
/** The item shelf, stacked under the relic bar in the same visual language — no pips, because
 *  items have no tiers: you hold the rule or you do not. */
// ---------- Relics & Items: the pause-menu collection ----------
// These used to be strips of rules text pinned to the HUD. Mid-fight nobody reads rules text —
// the strip was the tallest thing on screen and communicated nothing at the moment it appeared.
// The pause menu is where a player goes to READ, so the collection lives there now: a grid of
// icon cells, with the words held back until a cell is highlighted.
//
// The two refresh functions keep their old names and call sites; only where they render moved.
// Both sexes of pickup land in ONE grid (relics first) because the question they answer is the
// same — "what am I carrying?" — and two tiny grids would just be two places to look.
let pauseRelics = [];
let pauseItems = [];

export function refreshItemBar(items) {
  pauseItems = items || [];
  renderPauseCollection();
}

/**
 * The item splash: a boss just paid out a RULE, and the moment deserves more than a toast.
 * Reuses the stage-card overlay — same hold-and-fade, same pixel type — with the item's own
 * colour on the title and its rule as the subtitle, so the ceremony is consistent with the
 * game's other big announcements without a third overlay system to maintain.
 */
export function showItemSplash(item) {
  const card = $('stageCard');
  const title = $('stageCardTitle');
  showStageCard(`${item.icon} ${item.name}`, item.rule);
  card.classList.add('itemSplash');
  title.style.color = item.color;
  // The colour override must not leak onto the next stage card — clear it when this one fades.
  setTimeout(() => { title.style.color = ''; card.classList.remove('itemSplash'); }, 2700);
}

export function refreshRelicBar(relics) {
  pauseRelics = relics || [];
  renderPauseCollection();
}

const escCell = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function renderPauseCollection() {
  const grid = $('pauseRelicGrid');
  if (!grid) return;
  const cells = [];
  for (const r of pauseRelics) {
    // Pips rather than a number: a relic's copy count is not a level, and "Lv 2" would invite
    // the player to look for a way to level it.
    const pips = '◆'.repeat(r.tier) + '◇'.repeat(Math.max(0, 3 - r.tier));
    cells.push(collectionCell(r.icon, r.color, r.name, pips, r.desc));
  }
  for (const it of pauseItems) cells.push(collectionCell(it.icon, it.color, it.name, '', it.rule));
  grid.innerHTML = cells.length ? cells.join('')
    : '<div class="pauseCollectionEmpty">Nothing found yet — chests and bosses carry them.</div>';
  wireCollectionTooltips(grid);
}

function collectionCell(icon, color, name, pips, desc) {
  // A BUTTON, so the controller nav adopts it for free (visibleFocusables collects buttons) and
  // the keyboard reaches it with Tab. The tooltip payload rides in data-* so one shared tip
  // element serves every cell without a re-render.
  return `<button class="relicCell" type="button" style="--relicColor:${color}"`
    + ` data-name="${escCell(name)}" data-pips="${pips}" data-desc="${escCell(desc)}"`
    + ` aria-label="${escCell(name)}">${icon}</button>`;
}

// Controller highlight is a CLASS the nav loop stamps (.gpFocused), not DOM focus — so mouse
// and keyboard go through normal events while the pad is watched with a MutationObserver on
// exactly that class. One observer, re-targeted on every rebuild.
let collectionObserver = null;

function wireCollectionTooltips(grid) {
  for (const cell of grid.querySelectorAll('.relicCell')) {
    cell.addEventListener('mouseenter', () => showCollectionTip(cell));
    cell.addEventListener('mouseleave', hideCollectionTip);
  }
  // Keyboard: the menu's ARROW nav stamps .gpFocused (same system as the pad), so the observer
  // below covers it. Tab focus is the leftover path, handled by delegation — focusin bubbles
  // where focus does not, and one listener on the grid survives every innerHTML rebuild of the
  // cells beneath it.
  if (!grid.dataset.tipWired) {
    grid.dataset.tipWired = '1';
    grid.addEventListener('focusin', (e) => {
      const cell = e.target instanceof Element && e.target.closest('.relicCell');
      if (cell) showCollectionTip(cell);
    });
    grid.addEventListener('focusout', hideCollectionTip);
  }
  if (!collectionObserver) {
    collectionObserver = new MutationObserver(() => {
      const g = $('pauseRelicGrid');
      if (!g) return;
      const focused = g.querySelector('.relicCell.gpFocused');
      if (focused) showCollectionTip(focused);
      else if (!g.querySelector('.relicCell:hover, .relicCell:focus')) hideCollectionTip();
    });
  }
  collectionObserver.disconnect();
  collectionObserver.observe(grid, { attributes: true, attributeFilter: ['class'], subtree: true });
}

function showCollectionTip(cell) {
  const tip = $('pauseTooltip');
  const menu = $('pauseMenu');
  if (!tip || !menu) return;
  const color = cell.style.getPropertyValue('--relicColor') || '#7a56d2';
  tip.style.setProperty('--relicColor', color);
  tip.innerHTML = `<div class="relicName">${cell.dataset.name}`
    + (cell.dataset.pips ? `<span class="relicPips">${cell.dataset.pips}</span>` : '')
    + `</div><div class="relicDesc pauseTipDesc">${cell.dataset.desc}</div>`;
  tip.classList.remove('hidden');
  // Both rects are in VISUAL pixels, but style.left wants the overlay's LAYOUT pixels — and the
  // overlay is zoomed by --ui-scale. Recovering the factor from the overlay's own rect (visual
  // width / layout width) stays correct whatever the scale is set to, with no second source.
  const mr = menu.getBoundingClientRect();
  const cr = cell.getBoundingClientRect();
  const z = menu.offsetWidth ? mr.width / menu.offsetWidth : 1;
  const cx = (cr.left + cr.width / 2 - mr.left) / z;
  const cy = (cr.top - mr.top) / z;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const left = Math.max(8, Math.min(cx - w / 2, menu.offsetWidth - w - 8));
  // Above the cell; below it instead when the cell is already at the top of the screen.
  const top = cy - h - 10 >= 8 ? cy - h - 10 : (cr.bottom - mr.top) / z + 10;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideCollectionTip() {
  const tip = $('pauseTooltip');
  if (tip) tip.classList.add('hidden');
}
