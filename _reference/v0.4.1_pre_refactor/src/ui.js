const $ = (id) => document.getElementById(id);

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
  const prev = $('classPrevBtn');
  const next = $('classNextBtn');
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
      <div class="classCardStats">
        <span>❤ ${c.base.maxHp} Life</span>
        <span>⚡ ${c.base.speed} Speed</span>
        <span>🛡 ${c.base.armor} Armor</span>
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
    const card = list.querySelector('.classCard');
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
  $('hud').classList.remove('hidden');
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
  const rb = oldBtn.cloneNode(true); // clone to drop any prior click handler
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

export function showMainMenu(gold = 0) {
  const g = $('menuGold');
  if (g) g.textContent = gold;
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
        <div class="leaderboardClass">${e.className}${e.victory ? ' <span class="victoryMark" title="Run completed">✦</span>' : ''}<small>Level ${e.level} · Stage ${e.stage || 1}</small></div>
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

export function showEndScreen({ victory, time, level, kills, stage }, onRestart, onMainMenu) {
  const root = $('endScreen');
  $('endTitle').textContent = victory ? 'Victory' : 'You Have Fallen';
  $('endTitle').style.color = victory ? '#c9a227' : '#a13328';
  $('endSubtitle').textContent = victory
    ? 'The Hollow Sovereign falls. All three realms are cleansed.'
    : 'The horde overwhelmed you.';
  $('endStats').innerHTML = `
    <div><span>Time Survived</span><b>${fmtTime(time)}</b></div>
    <div><span>Stage Reached</span><b>${stage}</b></div>
    <div><span>Level Reached</span><b>${level}</b></div>
    <div><span>Kills</span><b>${kills}</b></div>
  `;
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
const SHOW_SUPPORT_TRAY = false;

// Compact vector icons for each skill's `icon` tag, tinted with the skill's accent.
const SKILL_ICONS = {
  scythe: '<svg viewBox="0 0 24 24"><g fill="none" stroke="#6b4f2e" stroke-width="2.2" stroke-linecap="round"><path d="M15.5 4.5 L9 21"/></g><path d="M15.5 4.5 C 9.5 3.2, 4.6 6.4, 3.4 11.6 C 6.2 7.6, 10.8 6.2, 15.2 7.6 Z" fill="currentColor"/><path d="M15.5 4.5 C 9.5 3.2, 4.6 6.4, 3.4 11.6" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.75"/></svg>',
  sword: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="#0e0a06" stroke-width="0.5" stroke-linejoin="round"><path d="M12 1.4 L13.7 4.8 L13.7 13.4 L10.3 13.4 L10.3 4.8 Z"/><rect x="5.4" y="13.4" width="13.2" height="2.7" rx="0.7"/><rect x="10.5" y="16.1" width="3" height="4.3"/><circle cx="12" cy="21.3" r="1.9"/></g><path d="M11.7 4.9 L11.7 13" stroke="#ffe6a0" stroke-width="0.9" opacity="0.55"/></svg>',
  fireball: '<svg viewBox="0 0 24 24"><path d="M12 2 C 9 7, 11 10, 12 13 C 10 12, 8.5 10, 9 7.5 C 6.5 10.5, 6 16, 9.5 20 C 11 21.5, 13 21.5, 15 20 C 18.5 16.5, 18 10, 12 2 Z" fill="currentColor"/><path d="M12 16 C 10.5 15, 10.5 12.5, 12 11 C 13.5 12.5, 13.5 15, 12 16 Z" fill="#ffe6a0" opacity="0.7"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><g transform="rotate(-45 12 12)"><path d="M2 8.4 L7.6 12 L2 15.6 L3.6 12 Z" fill="#8a9a5a"/><path d="M4 9.6 L8.4 12 L4 14.4 L5.2 12 Z" fill="#a8b86a"/><rect x="5" y="11.2" width="12" height="1.6" fill="#7a6540"/><rect x="5" y="11.2" width="12" height="0.6" fill="#a08a5a"/><path d="M16 9.2 L22.4 12 L16 14.8 Z" fill="#cdd4df"/><path d="M16.8 10.8 L20.2 12 L16.8 13.2 Z" fill="#8a929e"/></g></svg>',
  nova: '<svg viewBox="0 0 24 24"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3 V21 M3 12 H21 M5.5 5.5 L18.5 18.5 M18.5 5.5 L5.5 18.5"/><path d="M12 3 L10.5 5.5 M12 3 L13.5 5.5 M12 21 L10.5 18.5 M12 21 L13.5 18.5 M3 12 L5.5 10.5 M3 12 L5.5 13.5 M21 12 L18.5 10.5 M21 12 L18.5 13.5"/></g></svg>',
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
  // a struck spark
  critchance:    tome('<path d="M0 -4.6 L1.2 -1.2 L4.6 0 L1.2 1.2 L0 4.6 L-1.2 1.2 L-4.6 0 L-1.2 -1.2 Z"/>'),
  // a clock face
  duration:      tome('<circle cx="0" cy="0" r="4.2"/><path d="M0 -2.4 L0 0 L2 1.4"/>'),
  // one path splitting into two
  forking:       tome('<path d="M-4.2 0 L-0.6 0"/><path d="M-0.6 0 L3.6 -3.4"/><path d="M-0.6 0 L3.6 3.4"/><path d="M1.8 -3.8 L4.2 -3.8 L4.2 -1.6"/><path d="M1.8 3.8 L4.2 3.8 L4.2 1.6"/>'),
};

export function updateHUD(d) {
  $('hpFill').style.width = `${Math.max(0, (d.hp / d.maxHp) * 100)}%`;
  $('hpText').textContent = `${Math.ceil(d.hp)} / ${d.maxHp}`;
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
  $('timerText').textContent = fmtTime(d.elapsed);
  if (d.bossSpawned) {
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
    const cdRatio = s.cd > 0 ? Math.min(1, s.cd / (s.def.cooldownBase * 1.2)) : 0;
    const icon = SKILL_ICONS[s.def.icon] || `<span>${s.def.name[0]}</span>`;
    el.innerHTML = `${icon}<small>${s.level}</small><div class="gemCd" style="height:${cdRatio * 100}%"></div>`;
    tray.appendChild(el);
  }
  // Support gems are listed on the pause screen's modifier panels instead of the HUD, so the
  // tray is off by default. The rendering below is intact and correct — flip SHOW_SUPPORT_TRAY
  // to true to put the icons back on the HUD with no other changes needed.
  const supTray = $('supportTray');
  supTray.classList.toggle('hidden', !SHOW_SUPPORT_TRAY);
  if (!SHOW_SUPPORT_TRAY) return;
  supTray.innerHTML = '';
  for (const s of d.supports) {
    const el = document.createElement('div');
    el.className = 'gemIconSmall';
    el.style.setProperty('--accent', s.def.color);
    el.title = `${s.def.name} (Lv ${s.lvl})`;
    el.innerHTML = `<span>${s.def.name[0]}</span>`;
    supTray.appendChild(el);
  }
}

export function showPauseMenu() { $('pauseMenu').classList.remove('hidden'); }
export function hidePauseMenu() { $('pauseMenu').classList.add('hidden'); }

export function showSettingsMenu({ inputPromptMode, connectedPads, activeGamepadId, musicVolume, sfxVolume, displayMode, musicUnlocked, musicTracks }, onSelectInputMode, onSelectController, onMusicVolume, onSfxVolume, dev, extra) {
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

  const musicRange = $('musicVolumeRange');
  const musicValue = $('musicVolumeValue');
  musicRange.value = Math.round(musicVolume * 100);
  musicValue.textContent = Math.round(musicVolume * 100) + '%';
  musicRange.oninput = () => {
    const v = Number(musicRange.value) / 100;
    musicValue.textContent = Math.round(v * 100) + '%';
    onMusicVolume(v);
  };

  const sfxRange = $('sfxVolumeRange');
  const sfxValue = $('sfxVolumeValue');
  sfxRange.value = Math.round(sfxVolume * 100);
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

  // Music player (jukebox) — only shown once unlocked in the shop.
  const musicRow = $('musicPlayerRow');
  const musicOpts = $('musicPlayerOptions');
  musicOpts.innerHTML = '';
  if (musicUnlocked) {
    musicRow.classList.remove('hidden');
    for (const t of (musicTracks || [])) {
      const btn = document.createElement('button');
      btn.className = 'settingOption';
      btn.innerHTML = `<div class="settingOptionLabel">♪ ${t.name}</div>`;
      if (extra) btn.addEventListener('click', () => extra.onPlayTrack(t.id));
      musicOpts.appendChild(btn);
    }
  } else {
    musicRow.classList.add('hidden');
  }

  // Developer cheats: a single toggle reveals the three cheat buttons.
  $('settingsMenu').classList.remove('hidden');
}

// ---------- Dev Tools ----------
// Cheats plus a live-tuning box per skill. Only the stats a skill actually declares get a
// slider, so nothing irrelevant is shown for skills that don't use it.
export function showDevTools(state, handlers) {
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
    const rng = wrap.querySelector('.grantSlider');
    const num = wrap.querySelector('.grantNum');
    // Slider and field mirror each other; the button applies whatever is showing.
    rng.addEventListener('input', () => { num.value = rng.value; });
    num.addEventListener('input', () => {
      const v = parseFloat(num.value);
      if (Number.isFinite(v)) rng.value = Math.min(max, Math.max(0, v));
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
    + '<div class="settingOptionDesc">Clear gold, upgrades, keys and cheats &mdash; a brand-new-player state. '
    + 'Leaderboard and saved skill tuning are kept.</div>';
  zero.addEventListener('click', handlers.onZeroOut);
  resOpts.appendChild(zero);

  const cheatOpts = row('Cheats', state.inRun
    ? 'Testing shortcuts for the current run.'
    : 'Toggles persist into your next run. Run-only cheats appear once a run is active.');
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

  // ---- per-skill stat sliders ----
  const tuning = $('devTuning');
  tuning.innerHTML = '';
  const hint = document.createElement('div');
  hint.className = 'devHint';
  hint.textContent = state.inRun
    ? 'Click a skill’s icon to equip it · MAX jumps it to max level · '
      + 'Stick / D-pad adjusts sliders, bumpers (or Shift + arrows) for fine steps · '
      + 'Save keeps a skill’s values as its new defaults'
    : 'Stick / D-pad adjusts sliders, bumpers (or Shift + arrows) for fine steps · '
      + 'Save keeps a skill’s values as its new defaults · '
      + 'Equipping skills needs an active run';
  tuning.appendChild(hint);
  for (const sk of state.skillList) {
    const box = document.createElement('div');
    // "Unequipped" only means something during a run — on the main menu no skill is equipped,
    // so greying every box there would read as broken rather than informative.
    const off = state.inRun && !sk.active;
    box.className = 'tuneBox' + (off ? ' off' : '');
    // The accent drives the colour bars either side of the box. It's set inline, which beats
    // the stylesheet, so the greyed-out value has to be applied here rather than in CSS.
    box.style.setProperty('--accent', off ? '#3c3122' : sk.color);
    const icon = SKILL_ICONS[sk.icon] || '';
    // The icon is the on/off switch for the skill itself; MAX jumps it to max level and
    // back to base. Both act on the live player, so they're inert outside a run.
    const dis = state.inRun ? '' : ' disabled';
    const offTitle = state.inRun ? 'Toggle this skill on/off' : 'Start a run to equip skills';
    box.innerHTML = `<div class="tuneHead">`
      + `<button class="gemIcon tuneIcon tuneToggle${sk.active ? ' active' : ''}"`
      + ` style="--accent:${sk.color}" data-skill="${sk.id}" title="${offTitle}"${dis}>${icon}</button>`
      + `<span class="tuneName">${sk.name}</span>`
      + `<button class="tuneMax${sk.maxed ? ' active' : ''}" data-skill="${sk.id}"`
      + ` title="Max level, or back to base"${dis}>MAX</button>`
      + `<button class="tuneSave" data-skill="${sk.id}">Save</button>`
      + `<button class="tuneReset" data-skill="${sk.id}">Reset</button></div>`;
    const list = document.createElement('div');
    list.className = 'tuneList';
    for (const stat of sk.stats) {
      const line = document.createElement('div');
      line.className = 'tuneLine gpSlider'; // gpSlider = reachable by controller/keyboard nav
      const id = `tune_${sk.id}_${stat.key}`;
      const shown = Number(stat.value.toFixed(3));
      line.innerHTML = `<label for="${id}" class="tuneLabel">${stat.label}</label>`
        + `<input type="range" id="${id}" class="tuneSlider" min="${stat.min}" max="${stat.max}" `
        + `step="${stat.step}" value="${stat.value}" />`
        + `<span class="tuneValWrap">`
        + `<input type="number" id="${id}_n" class="tuneNum" min="${stat.min}" max="${stat.max}" `
        + `step="any" value="${shown}" />`
        + (stat.unit ? `<span class="tuneUnit">${stat.unit}</span>` : '')
        + `</span>`;

      const range = line.querySelector('.tuneSlider');
      const num = line.querySelector('.tuneNum');
      // Both paths clamp to the declared range — these drive live gameplay, and something
      // like a zero cooldown would fire every frame. They differ on precision: the slider
      // snaps to its step, but a typed number is honoured exactly, since typing 875 and
      // getting 880 defeats the point of having a keyboard field at all.
      const clampOnly = (v) => Number(Math.min(stat.max, Math.max(stat.min, v)).toFixed(4));
      const clampSnap = (v) => {
        const c = Math.min(stat.max, Math.max(stat.min, v));
        return Number((Math.round((c - stat.min) / stat.step) * stat.step + stat.min).toFixed(4));
      };
      // The slider can only sit on a step, so it shows the nearest one while the exact
      // typed value stays in effect.
      const push = (v) => { range.value = v; handlers.onTune(sk.id, stat.key, v); };

      range.addEventListener('input', () => {
        const v = clampSnap(parseFloat(range.value));
        num.value = v;
        handlers.onTune(sk.id, stat.key, v);
      });
      // Applies as you type so the effect is immediate, but the field's own text is left
      // alone mid-edit — rewriting it on every keystroke fights the caret.
      num.addEventListener('input', () => {
        const raw = parseFloat(num.value);
        if (Number.isFinite(raw)) push(clampOnly(raw));
      });
      // Committing normalises the text to the value actually in effect.
      const commit = () => {
        const raw = parseFloat(num.value);
        const v = Number.isFinite(raw) ? clampOnly(raw) : clampOnly(stat.value);
        num.value = v;
        push(v);
      };
      num.addEventListener('change', commit);
      num.addEventListener('blur', commit);
      num.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { commit(); num.blur(); }
      });
      // A focused number input swallows the wheel and edits its own value, so scrolling past
      // one would silently retune a skill. Drop focus and let the wheel scroll the page.
      num.addEventListener('wheel', () => { if (document.activeElement === num) num.blur(); }, { passive: true });
      list.appendChild(line);
    }
    box.appendChild(list);
    box.querySelector('.tuneReset').addEventListener('click', () => handlers.onResetSkill(sk.id));
    box.querySelector('.tuneSave').addEventListener('click', () => handlers.onSaveSkill(sk.id));
    if (state.inRun) {
      box.querySelector('.tuneToggle').addEventListener('click', () => handlers.onToggleSkill(sk.id));
      box.querySelector('.tuneMax').addEventListener('click', () => handlers.onMaxSkill(sk.id));
    }
    tuning.appendChild(box);
  }

  $('devMenu').classList.remove('hidden');
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

export function showUnlocks(skills, tomes = []) {
  const host = $('unlocksBody');
  host.innerHTML = '';
  host.appendChild(unlockSection('Skills', skills, (s) => SKILL_ICONS[s.icon]));
  if (tomes.length) host.appendChild(unlockSection('Tomes', tomes, (t) => TOME_ICONS[t.id]));
  $('unlocksMenu').classList.remove('hidden');
}
export function hideUnlocks() { $('unlocksMenu').classList.add('hidden'); }

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
  const sk = section('Skills', 'Click an icon to equip · stars set its level · the 4-skill cap is ignored here');
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
    const range = row.querySelector('input');
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
    const cr = slider.querySelector('input');
    cr.addEventListener('input', () => handlers.onEnemyOpt('count', +cr.value));
    o.appendChild(slider);

    const toggle = (label, key, onText, offText) => {
      const b = document.createElement('button');
      b.className = 'settingOption' + (cfg.enemy[key] ? ' active' : '');
      b.innerHTML = `<div class="settingOptionLabel">${label}: ${cfg.enemy[key] ? onText : offText}</div>`;
      b.addEventListener('click', () => handlers.onEnemyOpt(key, !cfg.enemy[key]));
      return b;
    };
    const opts2 = document.createElement('div');
    opts2.className = 'settingOptions';
    opts2.append(
      toggle('Behaviour', 'aggressive', 'Hunts you', 'Ignores you'),
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
    const spr = sp.querySelector('input');
    spr.addEventListener('input', () => handlers.onEnemyOpt('spacing', +spr.value));
    o.appendChild(sp);

    en.appendChild(o);
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
export function showStageCard(title, subtitle) {
  const card = $('stageCard');
  $('stageCardTitle').textContent = title;
  $('stageCardSub').textContent = subtitle || '';
  card.classList.remove('hidden', 'fading');
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
export function showToast(title, subtitle, color) {
  toastQueue.push({ title, subtitle, color });
  if (!toastTimer) drainToasts();
}
function drainToasts() {
  const next = toastQueue.shift();
  if (!next) { toastTimer = null; return; }
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.setProperty('--accent', next.color || '#4a6fa5');
  el.innerHTML = `<div class="toastTitle">${next.title}</div><div class="toastSubtitle">${next.subtitle}</div>`;
  $('toastContainer').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
  toastTimer = setTimeout(drainToasts, 550);
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
