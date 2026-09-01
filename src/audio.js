// ---------- Procedural Sound FX — Web Audio API, zero external assets ----------
// Every sound is synthesized in real time using oscillators and noise buffers.

let ctx = null;
import { loadSamples, playSample, sampleBuffer, pickVariant, PROC_FX } from './audio-samples.js';

/** Interchangeable takes of the cast. Add a third here and the no-repeat rule kicks in. */
const FIREBALL_TAKES = ['fireball1', 'fireball2'];

let masterGain = null;
let sfxGain = null;
/** Sub-bus carrying only the synthesised effects, so they can be levelled as a group. */
let procGain = null;
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
    // Fire and forget: the recorded sfx decode in the background and each one swaps itself in
    // as it lands. Until then the synthesised version plays, so nothing is silent while waiting.
    loadSamples(ctx);
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
    // The synth voices feed this rather than the sfx bus directly, so their level moves as one
    // without touching the recorded samples, which keep their own per-sample gains.
    procGain = ctx.createGain();
    procGain.gain.value = PROC_FX.volume;
    procGain.connect(sfxGain);
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

// ---------- noise toolkit ----------
// Everything a skill makes is built from these. No oscillators: a sine, saw, triangle or
// square has a definite pitch, and a definite pitch lands on some interval against whatever
// the music is playing — usually a sour one, and always a different one per track. Filtered
// noise has a spectral CENTRE rather than a fundamental, so it reads as bright or dark, sharp
// or dull, without ever being in or out of key.
//
// One buffer, made once and read from a random offset each time. Regenerating a fresh buffer
// per sound meant a few hundred KB of allocation every second in a busy fight, all of it
// immediately garbage.
const NOISE_SECONDS = 2;
let whiteBuf = null;

function whiteNoise() {
  if (whiteBuf) return whiteBuf;
  const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  whiteBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = whiteBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return whiteBuf;
}

/** A source reading the shared buffer from a random point, so repeats never sound identical. */
function noiseSource(duration) {
  const src = ctx.createBufferSource();
  src.buffer = whiteNoise();
  const maxOffset = Math.max(0, NOISE_SECONDS - duration - 0.01);
  src.start(now(), Math.random() * maxOffset, duration + 0.01);
  return src;
}

/**
 * The workhorse. A burst of noise pushed through a filter whose cutoff can travel, with a
 * percussive envelope.
 *
 * The filter sweep is what carries the character: rising reads as a launch or a charge,
 * falling as an impact settling. Because it is noise, none of it implies a key.
 *
 * @param {{ dur:number, from:number, to?:number, type?:BiquadFilterType, q?:number,
 *           gain?:number, attack?:number, curve?:number }} o
 */
function noiseFx(o) {
  const t = now();
  const dur = o.dur;
  const src = noiseSource(dur);
  const f = ctx.createBiquadFilter();
  f.type = o.type || 'bandpass';
  f.Q.value = o.q === undefined ? 1.2 : o.q;
  f.frequency.setValueAtTime(Math.max(20, o.from), t);
  if (o.to !== undefined && o.to !== o.from) {
    f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur * (o.curve || 1));
  }
  const g = ctx.createGain();
  const peak = o.gain === undefined ? 0.25 : o.gain;
  const atk = o.attack === undefined ? ATTACK : o.attack;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(procGain);
  src.stop(t + dur + 0.01);
  return { t, dur };
}

/**
 * Noise chopped by a fast random gain, which is what fire, sparks and electricity actually
 * sound like — broadband energy flickering rather than a tone wobbling.
 */
function noiseCrackle(dur, freq, gain = 0.2, rate = 60) {
  const t = now();
  const src = noiseSource(dur);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.Q.value = 0.9; f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  // Stepped, not smoothed: setValueAtTime holds each level until the next, giving the sound a
  // grain. Ramping between them would average it back into a smooth swell.
  const steps = Math.max(2, Math.floor(dur * rate));
  for (let i = 0; i < steps; i++) {
    const k = i / steps;
    const fade = 1 - k;                       // overall decay across the burst
    g.gain.setValueAtTime(Math.max(0.0001, gain * fade * (0.35 + Math.random() * 0.65)), t + k * dur);
  }
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(procGain);
  src.stop(t + dur + 0.01);
}

/**
 * The body of an impact: low, dark noise. Replaces the square/sine sub-thump the hits used to
 * carry, which was the most audible clash of the lot — a steady 60-90 Hz tone sitting directly
 * on top of the bass line.
 */
function noiseThump(dur, freq = 180, gain = 0.3) {
  noiseFx({ dur, from: freq, to: freq * 0.45, type: 'lowpass', q: 0.7, gain, curve: 0.8 });
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
  src.connect(filter).connect(g).connect(procGain);
  src.start(now());
  src.stop(now() + duration);
}

function playTone(freq, duration, type = 'sine', gainVal = 0.25) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ctx.createGain();
  applyEnvelope(g.gain, gainVal, duration);
  osc.connect(g).connect(procGain);
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
  osc.connect(g).connect(procGain);
  osc.start(now());
  osc.stop(now() + duration);
}

// ---------- SFX catalog ----------
const sfx = {};

// Skills, their effects and combat feedback are built ENTIRELY from filtered noise — see the
// noise toolkit above for why. Menu, pickup and reward sounds deliberately stay tonal: they
// are the moments the game is meant to sing at you, they fire in ones rather than dozens per
// second, and a rising major arpeggio reading as "good" is worth the occasional brush with the
// music. Everything below the pickups keeps its oscillators for that reason.

// A blade through the air and into something: a fast bright swish falling to a dull body.
sfx.slashHit = () => {
  if (sampleBuffer('swordSlash')) return playSample(ctx, sfxGain, 'swordSlash');
  noiseFx({ dur: 0.13, from: 5200, to: 900, type: 'bandpass', q: 0.8, gain: 0.40, curve: 0.7 });
  noiseThump(0.10, 260, 0.20);
};

// Launch. Rising filter = something leaving your hand and gaining speed.
sfx.fireball = () => {
  // Two recorded takes, one picked per cast. Fireball fires roughly once a second all run, so
  // it is the sound most exposed to sounding like a loop.
  const pick = pickVariant(FIREBALL_TAKES, 'fireball');
  if (pick && sampleBuffer(pick)) return playSample(ctx, sfxGain, pick);
  noiseFx({ dur: 0.22, from: 300, to: 2600, type: 'bandpass', q: 1.1, gain: 0.20 });
  noiseCrackle(0.20, 1500, 0.11, 70);
};

let lastFireballHit = 0;
sfx.fireballHit = () => {
  const t = now();
  // Throttle: a cluster of near-simultaneous blasts collapses to a single crackle rather
  // than an additive wall of sound.
  if (t - lastFireballHit < 0.045) return;
  lastFireballHit = t;
  noiseCrackle(0.16, 2600, 0.15, 90);                                        // fire
  noiseThump(0.11, 300, 0.16);                                               // body
};

sfx.quickshot = () => {
  noiseFx({ dur: 0.07, from: 4200, to: 1400, type: 'bandpass', q: 1.4, gain: 0.26, curve: 0.8 });
};

// Ice: bright, thin, and glassy. High Q here on purpose — the near-pitch is the "ring" of
// something brittle, and it is over in 60ms, far too short to argue with a chord.
sfx.iceShard = () => {
  noiseFx({ dur: 0.20, from: 7000, to: 3200, type: 'bandpass', q: 5, gain: 0.16 });
  noiseFx({ dur: 0.09, from: 9000, type: 'highpass', q: 0.7, gain: 0.10 });
};

sfx.chainLightning = () => {
  // Recorded crack when it has decoded, synthesised arc until then.
  if (sampleBuffer('lightningBolt')) return playSample(ctx, sfxGain, 'lightningBolt');
  noiseCrackle(0.22, 3200, 0.26, 130);                                       // the arc itself
  noiseFx({ dur: 0.10, from: 900, to: 240, type: 'lowpass', q: 0.8, gain: 0.16 });
};

sfx.bloodArrow = () => {
  noiseFx({ dur: 0.10, from: 3000, to: 700, type: 'bandpass', q: 1.6, gain: 0.24, curve: 0.8 });
  noiseThump(0.08, 220, 0.12);
};

sfx.firestorm = () => {
  noiseCrackle(0.45, 900, 0.24, 55);
  noiseFx({ dur: 0.45, from: 700, to: 180, type: 'lowpass', q: 0.6, gain: 0.22 });
};

sfx.firebeam = () => {
  // Sustained roar: slow attack so it swells rather than cracks, and a slow downward sweep so
  // it settles into the floor while it burns.
  noiseFx({ dur: 0.6, from: 1800, to: 500, type: 'bandpass', q: 0.8, gain: 0.24, attack: 0.08 });
  noiseCrackle(0.55, 2200, 0.10, 45);
};

sfx.poisonFlask = () => {
  noiseFx({ dur: 0.16, from: 1800, to: 5000, type: 'bandpass', q: 1.3, gain: 0.14 });  // throw
  setTimeout(() => {
    noiseFx({ dur: 0.26, from: 2400, to: 600, type: 'lowpass', q: 0.7, gain: 0.20 });  // splash
    noiseCrackle(0.24, 1200, 0.10, 40);                                                // fizz
  }, 150);
};

sfx.flameWalk = () => {
  noiseCrackle(0.38, 800, 0.17, 50);
  noiseFx({ dur: 0.35, from: 500, to: 200, type: 'lowpass', q: 0.6, gain: 0.13 });
};

// Takes the beam's duration so the sound lasts exactly as long as the visual does. The skill
// passes its own tune value, so retuning the beam length cannot leave the audio out of step.
sfx.electroFingers = (duration = 0.85) => {
  if (sampleBuffer('electroFingers')) {
    return playSample(ctx, sfxGain, 'electroFingers', { duration });
  }
  noiseCrackle(0.18, 4200, 0.16, 150);
  noiseFx({ dur: 0.10, from: 6000, type: 'highpass', q: 0.8, gain: 0.10 });
};

sfx.skeletonMinion = () => {
  // Dry bone rattle: two short clacks, filtered high and given no time to ring.
  noiseFx({ dur: 0.05, from: 3800, to: 1600, type: 'bandpass', q: 3, gain: 0.18 });
  setTimeout(() => noiseFx({ dur: 0.06, from: 3000, to: 1200, type: 'bandpass', q: 3, gain: 0.14 }), 55);
};

sfx.enemyHit = () => {
  noiseFx({ dur: 0.07, from: 2200, to: 600, type: 'bandpass', q: 1.1, gain: 0.22, curve: 0.7 });
  noiseThump(0.06, 200, 0.13);
};

sfx.enemyDie = () => {
  noiseFx({ dur: 0.20, from: 1600, to: 300, type: 'bandpass', q: 0.9, gain: 0.28 });
  noiseThump(0.16, 170, 0.20);
};

// ---- tonal by design: pickups, rewards and menu feedback ----
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
    o.connect(g).connect(procGain); o.start(t + delay); o.stop(t + delay + dur);
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
    o.connect(g).connect(procGain); o.start(t + d); o.stop(t + d + 0.32);
  });
  for (let i = 0; i < 6; i++) {
    const d = 0.1 + 0.05 * i;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(1800 + Math.random() * 1000, t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.05, t + d + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.08);
    o.connect(g).connect(procGain); o.start(t + d); o.stop(t + d + 0.09);
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
    o.connect(g).connect(procGain); o.start(t + d); o.stop(t + d + 0.2);
  });
};

sfx.heal = () => {
  const t = now();
  playTone(523, 0.15, 'sine', 0.2);
  setTimeout(() => playTone(659, 0.15, 'sine', 0.2), 80);
  setTimeout(() => playTone(784, 0.2, 'sine', 0.2), 160);
};

sfx.goldPickup = () => {
  playTone(880, 0.06, 'square', 0.12);
  setTimeout(() => playTone(1320, 0.1, 'triangle', 0.12), 45);
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
// `shop` covers the Upgrade Shop and the Sandbox setup screen — the two places you stand still
// and read numbers. An empty folder yields an empty playlist, which playMusic treats as "leave
// what is playing alone", so this is safe to wire up before there is a single track in it.
const MUSIC_FOLDERS = { mainMenu: 'main-title', shop: 'shop' };
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
  return preferCompressed(out);
}

/** Format preference when one track exists more than once. Lower wins. */
const EXT_RANK = { ogg: 0, m4a: 1, mp3: 2, flac: 3, wav: 4 };

/**
 * Collapse same-named tracks to one entry, keeping the most compressed format.
 *
 * Mirrors prefer_compressed() in tools/scan-music.py, so the dev server's live listing and the
 * packaged manifest agree. A .wav beside its own .ogg is what converting a track looks like
 * mid-flight — and what you are left with if the master cannot be archived because something
 * else has it open. Listing both makes the menu play one song as two entries.
 */
function preferCompressed(tracks) {
  const best = new Map();
  for (const t of tracks) {
    const ext = (t.src.split('.').pop() || '').toLowerCase();
    const cur = best.get(t.name);
    const curExt = cur ? (cur.src.split('.').pop() || '').toLowerCase() : null;
    if (!cur || (EXT_RANK[ext] ?? 9) < (EXT_RANK[curExt] ?? 9)) best.set(t.name, t);
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
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

// Shuffle order, drawn from a bag rather than rolled fresh each time.
//
// Picking uniformly at random and only skipping the previous track is memoryless: across three
// tracks it will happily play A B A B A and leave C unheard for a long stretch, which is what
// makes a "shuffle" feel like it is repeating itself. A bag guarantees every track in the stage
// plays once before any of them plays twice.
//
// Keyed by playlist and rebuilt whenever that playlist's length changes, so adding a track to a
// folder cannot leave a stale bag holding indices that no longer exist.
const shuffleBags = new Map();

// Boss tracks, listId -> track name. Registered by the game layer (main.js reads it off the
// stage definitions) so audio.js stays ignorant of stages and keeps working standalone.
//
// A boss track stays in its stage's normal rotation — being the boss theme is an ADDITIONAL
// role, not an exclusive one. It simply also gets forced on when the boss appears.
const bossTracks = new Map();

/** @param {Record<string, string|undefined>} map listId -> boss track name */
export function setBossTracks(map) {
  bossTracks.clear();
  for (const [id, name] of Object.entries(map)) if (name) bossTracks.set(id, name);
}

/** Index of a stage's boss track within its playlist, or -1. */
function bossIndex(listId) {
  const name = bossTracks.get(listId);
  if (!name) return -1;
  const list = playlists && playlists[listId];
  return list ? list.findIndex((t) => t.name === name) : -1;
}


function refillBag(listId, length) {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {    // Fisher-Yates
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  shuffleBags.set(listId, { length, order });
  return order;
}

/**
 * Next index for a shuffling playlist.
 * @param {string} listId
 * @param {number} length  how many tracks the playlist currently holds
 * @param {number} avoid   index just played, so a fresh bag cannot repeat it back-to-back
 */
function pickNext(listId, length, avoid) {
  if (length <= 1) return 0;
  let bag = shuffleBags.get(listId);
  if (!bag || bag.length !== length || !bag.order.length) bag = { length, order: refillBag(listId, length) };
  // A reshuffle can put the just-played track first, which would repeat it across the seam.
  // Swap it one place back so the cycle boundary is not audible.
  if (bag.order.length > 1 && bag.order[bag.order.length - 1] === avoid) {
    const last = bag.order.length - 1;
    [bag.order[last], bag.order[last - 1]] = [bag.order[last - 1], bag.order[last]];
  }
  return bag.order.pop();
}

// `trackId` is either a playlist id ('stage1') — start that stage, shuffling if it has several
// tracks — or a specific track ('stage1#2'), which the jukebox uses to honour an exact pick.
// ---------- Jukebox modes ----------
// 'off'      the game drives the music: each stage plays its own list, the menu its theme.
// 'shuffle'  one bag across EVERY track in the game, ignoring which stage you are on.
// 'loop'     whatever is playing repeats until you pick something else.
//
// While a mode is active the game's own requests are ignored — that is what "override" means
// here. A request naming an exact track (`listId#index`, which only the music screen sends) is
// always honoured, so picking a song never silently does nothing.
/** @type {'off'|'shuffle'|'loop'} */
let jukeboxMode = 'off';

export function getJukeboxMode() { return jukeboxMode; }

/**
 * Switches mode and acts on it immediately: shuffle jumps to a random track, loop latches the
 * one already playing, off hands control back to the caller (which then asks for whichever
 * list belongs to where the player is).
 */
export function setJukeboxMode(mode) {
  jukeboxMode = mode;
  if (mode === 'shuffle') { globalBag = []; playRandomTrack(); }
  else if (mode === 'loop' && currentList) startTrack(currentList, currentIndex, { loop: true });
}

/** Every track in the game as `listId#index`, in manifest order. */
function allTrackIds() {
  const out = [];
  if (!playlists) return out;
  for (const [listId, list] of Object.entries(playlists)) {
    for (let i = 0; i < list.length; i++) out.push(listId + '#' + i);
  }
  return out;
}

// A shuffle bag over the whole library, for the same reason the per-list ones exist: a
// memoryless roll repeats tracks far more often than people expect it to.
let globalBag = [];
function playRandomTrack() {
  const all = allTrackIds();
  if (!all.length) return;
  if (!globalBag.length) {
    globalBag = all.slice();
    for (let i = globalBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [globalBag[i], globalBag[j]] = [globalBag[j], globalBag[i]];
    }
    // Never open a fresh bag on the track that just finished.
    const playing = currentTrackId();
    if (globalBag.length > 1 && globalBag[0] === playing) globalBag.push(globalBag.shift());
  }
  const [listId, idx] = globalBag.shift().split('#');
  startTrack(listId, Number(idx));
}

export function playMusic(trackId) {
  // Called before discovery finished (the menu asks on load). Remember it and start then.
  if (!playlists) { pendingRequest = trackId; return; }

  const [listId, idxStr] = String(trackId).split('#');
  // A jukebox mode outranks the game's own stage/menu requests. An exact track still wins,
  // because that only ever comes from the player choosing one.
  if (jukeboxMode !== 'off' && idxStr === undefined) return;
  const list = playlists[listId];
  if (!list || !list.length) return; // stage with no music: leave whatever is playing alone

  let index;
  if (idxStr !== undefined) {
    index = Number(idxStr);
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return;
  } else {
    // Already playing this stage — let the current track finish rather than restarting it.
    if (listId === currentList) return;
    // Drawn from the shuffle bag too, so the opening track is part of the cycle rather than an
    // independent roll that could repeat one the bag is about to serve.
    index = pickNext(listId, list.length, -1);
  }
  if (listId === currentList && index === currentIndex) return;

  startTrack(listId, index);
}

/**
 * The track playing right now, in the same `listId#index` form playMusic() accepts, or null
 * when nothing is. Lets the music screen mark the current entry instead of showing a list of
 * songs with no indication which one you are hearing.
 */
export function currentTrackId() {
  return currentList && currentIndex >= 0 ? `${currentList}#${currentIndex}` : null;
}

// Anyone who wants to know what just started — the on-screen flash, for one. audio.js stays
// out of the DOM; it only reports, and the UI layer decides what that looks like.
const trackListeners = new Set();
export function onTrackChange(cb) { trackListeners.add(cb); return () => trackListeners.delete(cb); }

/**
 * Play a stage's designated boss theme, looping for the length of the fight.
 * No-op (leaving the stage music alone) if the stage has no boss track or it is missing from
 * the folder — a silent boss fight would be a worse failure than the wrong music.
 * @param {string} listId
 * @returns {boolean} whether a boss track actually started
 */
export function playBossMusic(listId) {
  // Part of the stage's music, so a jukebox mode outranks it like the rest.
  if (jukeboxMode !== 'off') return;
  if (!playlists) return false;
  const i = bossIndex(listId);
  if (i < 0) return false;
  if (currentList === listId && currentIndex === i) return true;  // already playing it
  startTrack(listId, i, { loop: true });
  return true;
}

function startTrack(listId, index, opts) {
  const list = playlists[listId];
  const src = list[index].src;
  // Remember what we are leaving, so the transport's ⏮ can walk back through what was actually
  // heard. An index-1 walk would be wrong the moment shuffle is involved, and shuffle is the
  // normal case here — every playlist with more than one track shuffles.
  if (!(opts && opts.fromHistory)) {
    const leaving = currentTrackId();
    if (leaving) {
      trackHistory.push(leaving);
      if (trackHistory.length > HISTORY_LIMIT) trackHistory.shift();
    }
  }
  // Starting a track is an intent to hear it, so it also lifts a pause.
  musicIsPaused = false;
  ensureCtx();
  ensureMusicPlayers();
  // Set BEFORE the listeners run. They are told what started, but the music screen also asks
  // currentTrackId() to move its ▶, and announcing the change while the module still reports
  // the outgoing track leaves that marker one track behind.
  currentList = listId;
  currentIndex = index;
  for (const cb of trackListeners) cb(list[index].name, listId);
  const t = ctx.currentTime;
  const from = musicPlayers[musicActiveIndex];
  const toIndex = 1 - musicActiveIndex;
  const to = musicPlayers[toIndex];

  // Cancel any pending "pause after fade-out" left over from a previous transition —
  // this element is becoming active again, so it must not be paused mid-fade-in.
  if (to.pauseTimer) { clearTimeout(to.pauseTimer); to.pauseTimer = null; }
  // A lone track loops seamlessly on the element. With several, looping is off and `ended`
  // hands over to another one — that is the whole shuffle mechanism.
  // A boss theme loops for the whole fight instead of handing over — the music should not
  // change halfway through a boss.
  const forceLoop = !!(opts && opts.loop) || jukeboxMode === 'loop';
  const shuffles = (list.length > 1 || jukeboxMode === 'shuffle') && !forceLoop;
  to.el.loop = !shuffles;
  to.el.onended = shuffles
    ? () => {
        // Ignore a stale handler from an element that has since been faded out and reused.
        if (musicPlayers[musicActiveIndex].el !== to.el) return;
        // Shuffle draws from every list; otherwise stay inside the one that is playing.
        if (jukeboxMode === 'shuffle') { playRandomTrack(); return; }
        if (currentList !== listId) return;
        startTrack(listId, pickNext(listId, playlists[listId].length, currentIndex));
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

// ---------- Transport ----------
// Skip forward, skip back, and pause — the three things you want while a track is playing, as
// opposed to the mode buttons, which decide what happens after it ends.

const trackHistory = [];
const HISTORY_LIMIT = 64;   // deep enough to walk back through a session, bounded so it cannot grow forever
let musicIsPaused = false;

export function isMusicPaused() { return musicIsPaused; }

/**
 * Pause or resume whatever is playing, without losing the position.
 * Pausing the media elements rather than muting the gain: a muted track keeps decoding and
 * keeps advancing, so unmuting would drop you somewhere later in the song.
 * @returns {boolean} the new paused state
 */
export function toggleMusicPaused() {
  musicIsPaused = !musicIsPaused;
  if (!musicPlayers) return musicIsPaused;
  for (const p of musicPlayers) {
    if (musicIsPaused) {
      // Both elements are handled, not just the active one: a pause landing mid-crossfade
      // would otherwise leave the outgoing track audible and running.
      if (!p.el.paused) { p.resumeOnPlay = true; p.el.pause(); }
    } else if (p.resumeOnPlay) {
      p.resumeOnPlay = false;
      p.el.play().catch(() => {});
    }
  }
  return musicIsPaused;
}

/**
 * Step through the library by `step` entries, in the order MUSIC_TRACK_LIST holds — which is
 * exactly the order the music screen lists them in.
 *
 * NOT "next index in the current playlist": the playlist you are in can be a single track (the
 * main menu is), and stepping inside it would restart the same song and look like a dead
 * button. The player is looking at all eighteen tracks in one column; ⏭ moving down that column
 * is the only behaviour that matches what is on screen.
 */
function stepLibrary(step) {
  const ids = MUSIC_TRACK_LIST.map((t) => t.id);
  if (!ids.length) return;
  const here = ids.indexOf(currentTrackId());
  // Nothing playing yet: ⏭ opens at the top, ⏮ at the bottom.
  const next = here < 0 ? (step > 0 ? 0 : ids.length - 1)
                        : (here + step + ids.length) % ids.length;
  const [listId, idx] = ids[next].split('#');
  startTrack(listId, Number(idx), { fromHistory: step < 0 });
}

/** Skip forward. Under shuffle that means another draw from the bag, not the next row. */
export function nextTrack() {
  if (!playlists) return;
  if (jukeboxMode === 'shuffle') { playRandomTrack(); return; }
  stepLibrary(1);
}

/**
 * Skip back. Under shuffle the order is random, so "previous" can only sensibly mean what you
 * actually just heard — hence the history. In every other mode the order is the visible list,
 * so it means the row above.
 */
export function prevTrack() {
  if (!playlists) return;
  if (jukeboxMode === 'shuffle') {
    while (trackHistory.length) {
      const [listId, idxStr] = trackHistory.pop().split('#');
      const list = playlists[listId];
      const idx = Number(idxStr);
      // A playlist can shrink between plays (a file removed, a rescan): skip anything stale
      // rather than starting an index that no longer exists.
      if (list && idx >= 0 && idx < list.length) { startTrack(listId, idx, { fromHistory: true }); return; }
    }
  }
  stepLibrary(-1);
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
  // Returned, not swallowed: a sustained sample gives back a handle with .stop(), and a caller
  // whose effect ends early (the beam's target dying) needs to be able to cut it short.
  return sfx[name](...args);
};

/** The audio clock, for anything animating against scheduled sound (the panel's playhead). */
export function audioNow() { return ctx ? ctx.currentTime : performance.now() / 1000; }

/**
 * Audition a sample from an arbitrary point, for the tuning panel's scrubber.
 *
 * Deliberately NOT the same call the game makes: this one plays from wherever you clicked,
 * ignoring the trim window, because the whole point is to hear what you are about to trim off.
 * Sustained samples still loop, so the crossfade can be judged by ear.
 * @param {string} id
 * @param {number} from seconds into the raw recording
 */
export function previewSample(id, from = 0) {
  if (!ctx) return undefined;
  const buf = sampleBuffer(id);
  if (!buf) return undefined;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 0.9;
  src.connect(g).connect(sfxGain);
  src.start(ctx.currentTime, Math.max(0, Math.min(from, buf.duration - 0.01)));
  let done = false;
  return { stop(release = 0.02) {
    if (done) return; done = true;
    const now = ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(0, now + release);
    try { src.stop(now + release + 0.02); } catch { /* already stopped */ }
  } };
}

/** Play a sample through the real game path, so a tuning change can be heard as it will ship. */
export function auditionSample(id, duration) {
  if (!ctx) return undefined;
  return playSample(ctx, sfxGain, id, duration ? { duration } : {});
}

/** Push the tuned procedural level onto the live bus. Called when the dev slider moves. */
export function applyProceduralVolume() {
  if (procGain) procGain.gain.value = PROC_FX.volume;
}

export function getAvailableSFX() { return Object.keys(sfx); }
