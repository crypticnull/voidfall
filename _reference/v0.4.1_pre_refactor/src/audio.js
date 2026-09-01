// ---------- Procedural Sound FX — Web Audio API, zero external assets ----------
// Every sound is synthesized in real time using oscillators and noise buffers.

let ctx = null;
let masterGain = null;
let sfxGain = null;
let sfxLimiter = null;
let sfxShaper = null;

// Transfer curve that is EXACTLY unity below the knee and bends only above it. A plain
// tanh curve normalised to reach 1.0 has a slope of ~1.7 at the origin, which would make
// every quiet sound louder instead of leaving it alone — the shaper must be inaudible until
// something is actually near full scale.
const SOFT_KNEE = 0.6;
function softClipCurve(n = 2048) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    const a = Math.abs(x);
    c[i] = a <= SOFT_KNEE
      ? x                                                                   // untouched
      : Math.sign(x) * (SOFT_KNEE + (1 - SOFT_KNEE) * Math.tanh((a - SOFT_KNEE) / (1 - SOFT_KNEE)));
  }
  return c;
}
let sfxVolume = 1;

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.6;
    masterGain.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = sfxVolume;
    // A limiter between the sfx bus and the master. Every effect is its own short-lived
    // oscillator/noise burst, so a busy frame sums a dozen of them at once and the total sails
    // past 1.0 — which the output stage hard-clips, and hard clipping is exactly what a "pop"
    // sounds like. A fast-attack compressor with a high ratio rides that peak down instead.
    // Only the SFX go through it: the music must not duck every time something dies.
    sfxLimiter = ctx.createDynamicsCompressor();
    sfxLimiter.threshold.value = -12; // start holding back well before clipping
    sfxLimiter.knee.value = 6;        // soft bend, so quiet moments are untouched
    sfxLimiter.ratio.value = 12;      // limiting rather than gentle compression
    sfxLimiter.attack.value = 0.003;  // fast enough to catch a transient stack
    sfxLimiter.release.value = 0.18;  // slow enough not to pump between hits
    // Final safety after the limiter: a soft-clip curve. The compressor has a 3ms attack, so
    // the very first transient of a stacked frame slips past it — and that transient is the
    // pop. A waveshaper has no attack time at all: it bends anything approaching full scale
    // instead of letting it square off. tanh keeps quiet signals essentially untouched and
    // only rounds the peaks, so normal play sounds identical.
    sfxShaper = ctx.createWaveShaper();
    sfxShaper.curve = softClipCurve();
    sfxShaper.oversample = '2x'; // avoids the shaping itself adding harshness
    sfxGain.connect(sfxLimiter).connect(sfxShaper).connect(masterGain);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// Every voice fades in over a couple of milliseconds instead of snapping to full gain. An
// oscillator starting at full amplitude on an arbitrary point of its cycle is a step
// discontinuity — an audible tick on its own, and a chorus of them when a crowd dies at once.
// Too short to soften any of these sounds; long enough to remove the edge.
const ATTACK = 0.004;
function applyEnvelope(param, peak, duration) {
  const t = now();
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.min(ATTACK, duration * 0.5));
  param.exponentialRampToValueAtTime(0.001, t + duration);
}

function now() {
  ensureCtx();
  return ctx.currentTime;
}

// ---------- helpers ----------
function noiseBuffer(duration) {
  const len = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function playNoise(duration, freq, type = 'bandpass', gainVal = 0.3) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(duration);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now());
  g.gain.exponentialRampToValueAtTime(gainVal, (now()) + ATTACK);
  g.gain.exponentialRampToValueAtTime(0.001, now() + duration);
  src.connect(filter).connect(g).connect(sfxGain);
  src.start(now());
  src.stop(now() + duration);
}

function playTone(freq, duration, type = 'sine', gainVal = 0.25) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ctx.createGain();
  applyEnvelope(g.gain, gainVal, duration);
  osc.connect(g).connect(sfxGain);
  osc.start(now());
  osc.stop(now() + duration);
}

function playToneSlide(freqFrom, freqTo, duration, type = 'sine', gainVal = 0.2) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freqFrom, now());
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), now() + duration);
  const g = ctx.createGain();
  applyEnvelope(g.gain, gainVal, duration);
  osc.connect(g).connect(sfxGain);
  osc.start(now());
  osc.stop(now() + duration);
}

// ---------- SFX catalog ----------
const sfx = {};

sfx.slashHit = () => {
  playNoise(0.12, 350, 'bandpass', 0.45);
  playTone(80, 0.08, 'square', 0.15);
};

sfx.fireball = () => {
  const t = now();
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, t);
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.15);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, (t) + ATTACK);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  osc.connect(g).connect(sfxGain);
  osc.start(t); osc.stop(t + 0.2);
  playNoise(0.15, 800, 'bandpass', 0.2);
};

let lastFireballHit = 0;
sfx.fireballHit = () => {
  const t = now();
  // Throttle: a cluster of near-simultaneous blasts collapses to a single crackle rather
  // than an additive wall of sound.
  if (t - lastFireballHit < 0.045) return;
  lastFireballHit = t;
  // Crisp, fiery burst — a bright high-mid crackle over a light, quick punch. The old deep
  // sine sweep down to 45 Hz was the boomy "ticking" that stacked unpleasantly; it's gone.
  playNoise(0.13, 2400, 'bandpass', 0.14);   // fire crackle (high-mid)
  playNoise(0.09, 700, 'lowpass', 0.11);     // small punch — quiet and short
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(120, t + 0.09); // shallow drop, stays out of sub-bass
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.10, (t) + ATTACK);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  osc.connect(g).connect(sfxGain);
  osc.start(t); osc.stop(t + 0.11);
};

sfx.keyPickup = () => {
  const t = now();
  // Bright metallic ching — two quick high tones.
  const mk = (freq, delay, dur, gain) => {
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t + delay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + delay);
    g.gain.exponentialRampToValueAtTime(gain, t + delay + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
    o.connect(g).connect(sfxGain); o.start(t + delay); o.stop(t + delay + dur);
  };
  mk(1180, 0, 0.12, 0.16);
  mk(1760, 0.05, 0.16, 0.12);
};

sfx.jackpot = () => {
  const t = now();
  // Casino-jackpot cascade — a quick rising run of bright bell tones with a coin shimmer.
  [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => {
    const d = 0.06 * i;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f, t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.3);
    o.connect(g).connect(sfxGain); o.start(t + d); o.stop(t + d + 0.32);
  });
  for (let i = 0; i < 6; i++) {
    const d = 0.1 + 0.05 * i;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(1800 + Math.random() * 1000, t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.05, t + d + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.08);
    o.connect(g).connect(sfxGain); o.start(t + d); o.stop(t + d + 0.09);
  }
};

sfx.chestOpen = () => {
  const t = now();
  // Wooden creak + a rising treasure sparkle.
  playNoise(0.14, 500, 'lowpass', 0.12);
  [660, 880, 1320].forEach((f, i) => {
    const d = 0.045 * i;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f, t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.13, t + d + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.2);
    o.connect(g).connect(sfxGain); o.start(t + d); o.stop(t + d + 0.2);
  });
};

sfx.quickshot = () => {
  const t = now();
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(600, t);
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.06);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, (t) + ATTACK);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(g).connect(sfxGain);
  osc.start(t); osc.stop(t + 0.08);
};

sfx.iceShard = () => {
  playToneSlide(1200, 600, 0.25, 'sine', 0.18);
  playNoise(0.15, 3000, 'highpass', 0.12);
};

sfx.chainLightning = () => {
  const t = now();
  playNoise(0.2, 1500, 'bandpass', 0.3);
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(80, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.2, (t) + ATTACK);
  g.gain.linearRampToValueAtTime(0.3, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  osc.connect(g).connect(sfxGain);
  osc.start(t); osc.stop(t + 0.2);
};

sfx.heal = () => {
  const t = now();
  playTone(523, 0.15, 'sine', 0.2);
  setTimeout(() => playTone(659, 0.15, 'sine', 0.2), 80);
  setTimeout(() => playTone(784, 0.2, 'sine', 0.2), 160);
};

sfx.bloodArrow = () => {
  const t = now();
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(500, t);
  osc.frequency.exponentialRampToValueAtTime(250, t + 0.07);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, (t) + ATTACK);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(g).connect(sfxGain);
  osc.start(t); osc.stop(t + 0.1);
};

sfx.firestorm = () => {
  playNoise(0.4, 600, 'bandpass', 0.35);
  const t = now();
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.4);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, (t) + ATTACK);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  osc.connect(g).connect(sfxGain);
  osc.start(t); osc.stop(t + 0.45);
};

sfx.firebeam = () => {
  const t = now();
  playNoise(0.55, 520, 'bandpass', 0.3);
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(90, t);
  osc.frequency.exponentialRampToValueAtTime(150, t + 0.35);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.22, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  osc.connect(g).connect(sfxGain);
  osc.start(t); osc.stop(t + 0.6);
};

sfx.poisonFlask = () => {
  const t = now();
  playToneSlide(700, 300, 0.18, 'triangle', 0.16);
  setTimeout(() => playNoise(0.2, 900, 'bandpass', 0.18), 150);
};

sfx.flameWalk = () => {
  playNoise(0.35, 620, 'bandpass', 0.22);
  playTone(140, 0.2, 'sawtooth', 0.12);
};

sfx.electroFingers = () => {
  playNoise(0.16, 2200, 'highpass', 0.18);
  const t = now();
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(320, t);
  osc.frequency.exponentialRampToValueAtTime(180, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, (t) + ATTACK);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  osc.connect(g).connect(sfxGain);
  osc.start(t); osc.stop(t + 0.16);
};

sfx.skeletonMinion = () => {
  playNoise(0.1, 2000, 'highpass', 0.15);
  playTone(350, 0.1, 'square', 0.12);
};

sfx.goldPickup = () => {
  playTone(880, 0.06, 'square', 0.12);
  setTimeout(() => playTone(1320, 0.1, 'triangle', 0.12), 45);
};

sfx.enemyHit = () => {
  playNoise(0.08, 400, 'bandpass', 0.25);
  playTone(90, 0.06, 'square', 0.1);
};

sfx.enemyDie = () => {
  playNoise(0.18, 250, 'bandpass', 0.35);
  playTone(60, 0.12, 'square', 0.15);
};

sfx.xpPickup = (xp) => {
  const vol = Math.min(0.35, xp / 800);
  const baseFreq = 880 + xp * 4;
  playTone(baseFreq, 0.12, 'sine', vol);
  setTimeout(() => playTone(baseFreq * 1.25, 0.16, 'sine', vol * 0.7), 60);
};

sfx.itemPickup = () => {
  const t = now();
  playTone(660, 0.12, 'triangle', 0.22);
  setTimeout(() => playTone(880, 0.15, 'sine', 0.18), 70);
  setTimeout(() => playTone(1108, 0.2, 'sine', 0.14), 140);
};

sfx.levelUp = () => {
  const t = now();
  playTone(523, 0.18, 'triangle', 0.22);
  setTimeout(() => playTone(659, 0.18, 'triangle', 0.2), 100);
  setTimeout(() => playTone(784, 0.35, 'sine', 0.25), 200);
};

sfx.bossSpawn = () => {
  const t = now();
  playTone(55, 1.2, 'sawtooth', 0.25);
  playTone(58, 1.2, 'square', 0.12);
  playNoise(0.8, 100, 'lowpass', 0.3);
};

sfx.playerDeath = () => {
  const t = now();
  playToneSlide(400, 60, 0.5, 'sawtooth', 0.3);
  playNoise(0.4, 200, 'bandpass', 0.35);
  setTimeout(() => playTone(45, 0.4, 'square', 0.2), 100);
};

sfx.victory = () => {
  const t = now();
  [523, 659, 784, 1047].forEach((f, i) => {
    setTimeout(() => playTone(f, 0.6, 'triangle', 0.2), i * 100);
  });
};

sfx.bossDie = () => {
  const t = now();
  playNoise(0.4, 200, 'bandpass', 0.5);
  playTone(45, 0.3, 'square', 0.3);
  playToneSlide(80, 30, 0.6, 'sawtooth', 0.25);
};

sfx.uiClick = () => {
  const t = now();
  playTone(1200, 0.04, 'square', 0.1);
};

// ---------- Music (streamed, looped, crossfaded between stages) ----------
//
// Tracks are DISCOVERED, not listed here. Each stage owns a folder; every audio file in it is
// part of that stage's playlist, and a stage with more than one track shuffles between them.
// Drop a file in, and it is in rotation — nothing in this file needs editing.
//
// Discovery has two paths because the game runs in two places:
//   - dev server: the directory listing is fetchable, so new files appear on the next reload.
//   - packaged .exe: file:// cannot list a directory, so it reads assets/music/manifest.json
//     (regenerate with `python tools/scan-music.py` before building).
// The listing is tried first so development stays drop-in; the manifest is the fallback.
//
// Folders named _ARCHIVE are skipped by both paths — that is how a track is retired without
// deleting it, and why archived music never plays and never shows up in the jukebox.
//
// Slots exist for more stages than the game currently ships (see MUSIC_STAGE_SLOTS). An empty
// or missing folder simply contributes no playlist, and a stage with no music leaves whatever
// is already playing alone rather than cutting to silence — so scaffolding costs nothing and
// dropping a file into stage-7 wires itself up the day stage 7 exists.
const MUSIC_STAGE_SLOTS = 10;
const MUSIC_FOLDERS = { mainMenu: 'main-title' };
for (let i = 1; i <= MUSIC_STAGE_SLOTS; i++) MUSIC_FOLDERS['stage' + i] = 'stage-' + i;
const MUSIC_ROOT = 'assets/music';
const AUDIO_EXT = /\.(wav|mp3|ogg|m4a|flac)$/i;
const ARCHIVE_DIR = '_ARCHIVE';

// { mainMenu: [{src, name}], stage1: [...] } once discovery finishes; null until then.
let playlists = null;
// The jukebox reads this. It stays empty until discovery completes, then holds one entry per
// genuinely playable file — so a track moved into _ARCHIVE disappears from the list, and moving
// it back restores it, with no code change either way.
export const MUSIC_TRACK_LIST = [];

const CROSSFADE_SECONDS = 2;

let musicGain = null; // shared bus — holds the user's music volume level
let musicPlayers = null; // two alternating {el, gain} pairs so old/new tracks can overlap during a crossfade
let musicActiveIndex = 0;
let currentList = null;  // which playlist is playing ('stage1', ...)
let currentIndex = -1;   // which track within it
let musicVolume = 0.6;
// A playMusic() call that lands before discovery finishes is remembered, not dropped: the menu
// asks for music during module init, long before the first fetch can return.
let pendingRequest = null;

// Parse a dev-server directory listing. Anything ending in '/' is a subfolder (that is how
// _ARCHIVE is excluded) and anything without an audio extension is ignored.
function parseListing(html, folder) {
  const out = [];
  const re = /href="([^"?]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (href.endsWith('/') || href.startsWith('..')) continue;
    const name = decodeURIComponent(href.split('/').pop());
    if (!AUDIO_EXT.test(name)) continue;
    out.push({ src: `${MUSIC_ROOT}/${folder}/${name}`, name: name.replace(AUDIO_EXT, '') });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function discoverPlaylists() {
  const found = {};
  // Try the live directory listing first so newly added files need no build step.
  await Promise.all(Object.entries(MUSIC_FOLDERS).map(async ([id, folder]) => {
    try {
      const res = await fetch(`${MUSIC_ROOT}/${folder}/`);
      if (!res.ok) return;
      const text = await res.text();
      // A server with directory listing disabled may answer 200 with something else entirely,
      // so only accept a body that actually yielded playable entries.
      const tracks = parseListing(text, folder);
      if (tracks.length) found[id] = tracks;
    } catch (e) { /* no listing here (file://, or listings disabled) — manifest covers it */ }
  }));

  // Fill anything the listing did not answer for from the generated manifest.
  if (Object.keys(found).length < Object.keys(MUSIC_FOLDERS).length) {
    try {
      const res = await fetch(`${MUSIC_ROOT}/manifest.json`);
      if (res.ok) {
        const manifest = await res.json();
        for (const id of Object.keys(MUSIC_FOLDERS)) {
          if (!found[id] && Array.isArray(manifest[id]) && manifest[id].length) {
            // Belt and braces: a stale manifest could still name an archived file.
            found[id] = manifest[id].filter(t => t && t.src && !t.src.includes(`/${ARCHIVE_DIR}/`));
          }
        }
      }
    } catch (e) { /* no manifest either — those stages stay silent */ }
  }

  playlists = found;
  MUSIC_TRACK_LIST.length = 0;
  for (const id of Object.keys(MUSIC_FOLDERS)) {
    (playlists[id] || []).forEach((t, i) => MUSIC_TRACK_LIST.push({ id: `${id}#${i}`, name: t.name }));
  }
  if (pendingRequest) { const r = pendingRequest; pendingRequest = null; playMusic(r); }
}

function ensureMusicPlayers() {
  if (musicPlayers) return;
  musicGain = ctx.createGain();
  musicGain.gain.value = musicVolume;
  musicGain.connect(masterGain);
  musicPlayers = [0, 1].map(() => {
    const el = new Audio();
    el.preload = 'auto';
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain).connect(musicGain);
    return { el, gain };
  });
}

// Next track for a shuffling playlist: random, but never the one just played, so a two-track
// stage genuinely alternates instead of sometimes repeating itself.
function pickNext(list, avoid) {
  if (list.length <= 1) return 0;
  let i = Math.floor(Math.random() * (list.length - 1));
  if (i >= avoid) i += 1;
  return i;
}

// `trackId` is either a playlist id ('stage1') — start that stage, shuffling if it has several
// tracks — or a specific track ('stage1#2'), which the jukebox uses to honour an exact pick.
export function playMusic(trackId) {
  // Called before discovery finished (the menu asks on load). Remember it and start then.
  if (!playlists) { pendingRequest = trackId; return; }

  const [listId, idxStr] = String(trackId).split('#');
  const list = playlists[listId];
  if (!list || !list.length) return; // stage with no music: leave whatever is playing alone

  let index;
  if (idxStr !== undefined) {
    index = Number(idxStr);
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return;
  } else {
    // Already playing this stage — let the current track finish rather than restarting it.
    if (listId === currentList) return;
    index = Math.floor(Math.random() * list.length);
  }
  if (listId === currentList && index === currentIndex) return;

  startTrack(listId, index);
}

// Anyone who wants to know what just started — the on-screen flash, for one. audio.js stays
// out of the DOM; it only reports, and the UI layer decides what that looks like.
const trackListeners = new Set();
export function onTrackChange(cb) { trackListeners.add(cb); return () => trackListeners.delete(cb); }

function startTrack(listId, index) {
  const list = playlists[listId];
  const src = list[index].src;
  for (const cb of trackListeners) cb(list[index].name, listId);
  ensureCtx();
  ensureMusicPlayers();
  currentList = listId;
  currentIndex = index;
  const t = ctx.currentTime;
  const from = musicPlayers[musicActiveIndex];
  const toIndex = 1 - musicActiveIndex;
  const to = musicPlayers[toIndex];

  // Cancel any pending "pause after fade-out" left over from a previous transition —
  // this element is becoming active again, so it must not be paused mid-fade-in.
  if (to.pauseTimer) { clearTimeout(to.pauseTimer); to.pauseTimer = null; }
  // A lone track loops seamlessly on the element. With several, looping is off and `ended`
  // hands over to another one — that is the whole shuffle mechanism.
  const shuffles = list.length > 1;
  to.el.loop = !shuffles;
  to.el.onended = shuffles
    ? () => {
        // Ignore a stale handler from an element that has since been faded out and reused.
        if (musicPlayers[musicActiveIndex].el !== to.el || currentList !== listId) return;
        startTrack(listId, pickNext(playlists[listId], currentIndex));
      }
    : null;
  to.el.src = encodeURI(src);
  to.el.currentTime = 0;
  to.el.play().catch(() => {});
  to.gain.gain.cancelScheduledValues(t);
  to.gain.gain.setValueAtTime(0, t);
  to.gain.gain.linearRampToValueAtTime(1, t + CROSSFADE_SECONDS);

  if (from.el.src) {
    from.gain.gain.cancelScheduledValues(t);
    from.gain.gain.setValueAtTime(from.gain.gain.value, t);
    from.gain.gain.linearRampToValueAtTime(0, t + CROSSFADE_SECONDS);
    if (from.pauseTimer) clearTimeout(from.pauseTimer);
    from.pauseTimer = setTimeout(() => { from.el.pause(); from.pauseTimer = null; }, CROSSFADE_SECONDS * 1000 + 150);
  }
  musicActiveIndex = toIndex;
}

export function setMusicVolume(v) {
  musicVolume = Math.max(0, Math.min(1, v));
  if (musicGain) musicGain.gain.value = musicVolume;
}

// Resume playback after a user gesture. playMusic may have been called before any
// gesture (e.g. the menu on page load), leaving the AudioContext suspended and the
// <audio> element blocked by the browser's autoplay policy; this un-suspends the
// context and (re)starts the active track's element so music actually begins.
export function resumeAudio() {
  ensureCtx();
  if (ctx.state === 'suspended') ctx.resume();
  if (musicPlayers) {
    const active = musicPlayers[musicActiveIndex];
    if (active.el.src && active.el.paused) active.el.play().catch(() => {});
  }
}

// ---------- Public API ----------
export function initAudio() { ensureCtx(); }

// Discovery is fired at module load rather than from initAudio(), because the main menu asks
// for music before any user gesture has let us create an AudioContext. It only fetches text —
// no audio hardware is touched — so it is safe to run this early.
// MUSIC_TRACK_LIST is filled in place, so the jukebox — which reads it when the user opens
// settings, long after load — sees the discovered tracks without needing to subscribe.
discoverPlaylists();

export function setSfxVolume(v) {
  sfxVolume = Math.max(0, Math.min(1, v));
  if (sfxGain) sfxGain.gain.value = sfxVolume;
}

// Voice budget. Every sfx call allocates fresh Web Audio nodes, so a crowd dying at once
// (hundreds of deaths in a frame) used to spawn hundreds of simultaneous oscillators and
// break up the audio. Cap how many voices may START in a short window and drop the excess —
// past a dozen overlapping copies they're inaudible as distinct sounds anyway.
const VOICE_WINDOW_MS = 60;
const MAX_VOICES_PER_WINDOW = 14;
let voiceWindowStart = 0;
let voicesInWindow = 0;

export const play = (name, ...args) => {
  if (sfxVolume <= 0 || !sfx[name]) return;
  const t = performance.now();
  if (t - voiceWindowStart > VOICE_WINDOW_MS) { voiceWindowStart = t; voicesInWindow = 0; }
  if (voicesInWindow >= MAX_VOICES_PER_WINDOW) return;
  voicesInWindow++;
  sfx[name](...args);
};

export function getAvailableSFX() { return Object.keys(sfx); }
