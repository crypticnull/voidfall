// @ts-check
// ---------- Recorded one-shots and sustained loops ----------
// Every other sound in this game is synthesised from filtered noise (see audio.js). These are
// the exceptions: recorded WAVs, converted to ogg, that want playing back rather than building.
//
// They ALL go through one player, even the one-shot that never loops. That is deliberate — the
// two things a recorded sample always needs are trimming and, if it has to last as long as a
// beam does, looping without a seam. Giving one-shots their own simpler path would mean the
// trim maths existed twice and drifted.
//
// The four dials per sample are `start`, `end`, `loopStart` and `crossfade`:
//
//   start ....... where playback begins. Recordings arrive with dead air at the head, and a
//                 sound that fires 160ms after the cast reads as unrelated to it.
//   loopStart ... where the ATTACK ends and the sustainable body begins. Looping from `start`
//                 would re-trigger the transient every pass, which is what makes a badly looped
//                 sample sound like a stutter rather than a held note.
//   end ......... where the body stops. Usually before the recording's own tail, since a decay
//                 baked into the loop is a volume dip once per cycle.
//   crossfade ... how long the outgoing pass overlaps the incoming one.
//
// The crossfade is why this schedules its own repeats instead of setting `loop = true` on a
// single BufferSource. The built-in loop is a hard butt-join: unless the waveform happens to be
// at the same point and phase at both ends, it clicks. Overlapping two copies with equal-power
// gain ramps has no seam to click at.

/** Equal-power rather than linear: two correlated copies at 0.5 gain sum to ~0.7, so a linear
 *  crossfade dips audibly in the middle. sqrt keeps the power constant across the overlap. */
const EQ_POWER_STEPS = 16;

/**
 * Applied to EVERY sample, including any added later. Defaults live here rather than being
 * repeated per entry so a new recording cannot quietly miss them by omission — which is exactly
 * how one sound ends up being the only robotic one in the mix.
 */
export const SAMPLE_DEFAULTS = {
  /**
   * Random pitch spread per use, as a fraction either side of 1. The single most audible tell
   * of a sampled game is the same waveform played identically twice in a row, and combat sounds
   * fire in bursts — a slash every 0.65s is four identical swishes a second at speed. A few
   * percent is below the threshold of sounding "detuned" but well above the threshold of
   * breaking the repetition.
   *
   * Pitch and speed move together, as with a real varispeed: resampling shifts both. That is a
   * feature for one-shots, where a slightly faster swish also reads as a slightly lighter one.
   */
  pitchJitter: 0.045,
};

/**
 * Per-sample playback shape. `gain` is a trim, not a mix level — the sfx bus still applies the
 * player's volume on top.
 * @type {Record<string, { file: string, start: number, end: number, loopStart: number,
 *                         crossfade: number, gain: number, rate: number, loop: boolean,
 *                         pitchJitter?: number }>}
 */
export const SAMPLES = {
  // Measured, not guessed: this recording is silent until ~0.15s, peaks at 0.30 and is back to
  // 2% of peak by 1.0s. Starting at 0.16 puts the crack on the cast; ending at 1.15 drops most
  // of a second of near-silence that would otherwise hold a voice open for nothing.
  lightningBolt: {
    file: 'assets/sfx/lightning-bolt.ogg',
    start: 0.16, end: 1.15, loopStart: 0.16, crossfade: 0.06, gain: 0.85, rate: 1, loop: false,
  },
  // No dead air at the head on this one — it is a fast swish that peaks at 0.12s and is silent
  // from 0.40s. The file runs 1.98s, so the trim drops three quarters of it: slash fires every
  // 0.65s, and holding a voice open for 2s of silence per cast stacks up fast.
  swordSlash: {
    file: 'assets/sfx/sword-slash.ogg',
    start: 0, end: 0.45, loopStart: 0, crossfade: 0.03, gain: 0.8, rate: 1, loop: false,
  },
  // Two takes of the same cast, picked between per use. They are separate entries rather than
  // one entry with two files because their envelopes genuinely differ — _1 starts on the
  // instant, _2 has ~75ms of silence before it — so they need their own trims. Sharing one set
  // of dials would mean tuning one correctly and the other wrongly.
  fireball1: {
    file: 'assets/sfx/fireball-1.ogg',
    start: 0, end: 0.9, loopStart: 0, crossfade: 0.04, gain: 0.75, rate: 1, loop: false,
  },
  fireball2: {
    file: 'assets/sfx/fireball-2.ogg',
    start: 0.075, end: 0.6, loopStart: 0.075, crossfade: 0.04, gain: 0.75, rate: 1, loop: false,
  },
  // Reaches full level by 0.10s then sits between 0.7 and 0.93 of peak all the way to 2.6s —
  // an almost ideal sustain. The first 0.12s is the attack and is played once; everything after
  // it is the body that repeats for as long as the beam is up.
  electroFingers: {
    file: 'assets/sfx/electro-fingers.ogg',
    start: 0, end: 2.6, loopStart: 0.12, crossfade: 0.09, gain: 0.5, rate: 1, loop: true,
  },
};

/* GENERATED: sample playback tuning. Do not hand-edit — tools/bake-tuning.py rewrites this
   whole block from tuning/entity-tuning.json under the `samples` domain. */
export const SAMPLE_TUNE = {
  electroFingers: { gain: 0.2 },
  fireball1: { gain: 0.25 },
  fireball2: { gain: 0.3 },
  lightningBolt: { gain: 0.1, pitchJitter: 0.065, start: 0.155 },
  swordSlash: { end: 0.385, gain: 0.15, start: 0.015 },
};
/* END GENERATED */

// Defaults first, then the baked tuning on top — so a sample may override a default, but never
// lose one by simply not mentioning it.
for (const def of Object.values(SAMPLES)) {
  for (const [k, v] of Object.entries(SAMPLE_DEFAULTS)) {
    if (def[k] === undefined) def[k] = v;
  }
}
for (const [id, over] of Object.entries(SAMPLE_TUNE)) {
  if (SAMPLES[id]) Object.assign(SAMPLES[id], over);
}

/* GENERATED: procedural fx tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole
   block from tuning/entity-tuning.json under the `procfx` domain. */
export const PROC_FX_TUNE = {
  volume: 0.3,
};
/* END GENERATED */

/**
 * Level for the SYNTHESISED effects only — everything built from filtered noise in audio.js,
 * as opposed to the recorded samples above.
 *
 * They are a separate bus because they are a separate kind of sound. The recorded ones are
 * individually trimmed and levelled; the procedural ones are a whole family generated from one
 * toolkit, and the useful control over them is "all of that, quieter" — especially once some
 * of them have been replaced by recordings and the remainder no longer sit at a matching level.
 */
export const PROC_FX = { volume: 1, ...PROC_FX_TUNE };

/** How the dev panel presents the procedural bus. */
export const PROC_FX_TUNE_META = {
  volume: { label: 'Procedural FX Level', min: 0, max: 2, step: 0.01 },
};

/* GENERATED: recorded fx tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole
   block from tuning/entity-tuning.json under the `samplefx` domain. */
export const SAMPLE_FX_TUNE = {
};
/* END GENERATED */

/**
 * The other half of the pair: one level over every RECORDED sample, the way PROC_FX covers every
 * synthesised one. Each sample's own `gain` is a trim that sets its level against its siblings;
 * this rides on top and moves the whole family at once.
 *
 * It exists because the two families are mixed against each other by ear and keep drifting apart
 * as recordings replace synthesised effects — and re-trimming five samples by hand to answer
 * "the recorded ones are too loud" is the sort of thing that goes wrong halfway through.
 */
export const SAMPLE_FX = { volume: 1, ...SAMPLE_FX_TUNE };

/** How the dev panel presents the recorded bus. */
export const SAMPLE_FX_TUNE_META = {
  volume: { label: 'Recorded FX Level', min: 0, max: 2, step: 0.01 },
};

/** How the dev panel presents each dial. Ranges are in seconds against the raw recording. */
export const SAMPLE_TUNE_META = {
  start:     { label: 'Trim Start',    min: 0, max: 4, step: 0.005, unit: 's' },
  end:       { label: 'Trim End',      min: 0, max: 8, step: 0.005, unit: 's' },
  loopStart: { label: 'Loop From',     min: 0, max: 4, step: 0.005, unit: 's' },
  crossfade: { label: 'Crossfade',     min: 0, max: 0.5, step: 0.005, unit: 's' },
  gain:      { label: 'Level',         min: 0, max: 2, step: 0.01 },
  rate:      { label: 'Pitch / Speed', min: 0.25, max: 3, step: 0.01, unit: '×' },
  pitchJitter: { label: 'Pitch Variation', min: 0, max: 0.3, step: 0.005, unit: '±' },
};

/** @type {Record<string, AudioBuffer>} */
const buffers = {};
/** @type {Record<string, Promise<AudioBuffer|null>>} */
const pending = {};

/** Decoded audio for a sample id, or null if it has not loaded (or failed). */
export function sampleBuffer(id) { return buffers[id] || null; }

/** True once every sample has resolved one way or the other. */
export function samplesReady() {
  return Object.keys(SAMPLES).every((id) => buffers[id] !== undefined || pending[id] === undefined);
}

/**
 * Fetch and decode every sample. Safe to call repeatedly; each file is fetched once.
 *
 * A failure here is deliberately not fatal and not retried — the caller keeps its synthesised
 * fallback, so a missing ogg costs the recorded texture and nothing else.
 * @param {AudioContext} ctx
 */
export function loadSamples(ctx) {
  for (const [id, def] of Object.entries(SAMPLES)) {
    if (buffers[id] || pending[id]) continue;
    pending[id] = fetch(def.file)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${def.file}`))))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => { buffers[id] = buf; return buf; })
      .catch((e) => { console.warn('[audio] sample failed:', id, e.message); return null; });
  }
  return Promise.all(Object.values(pending));
}

/** Last variant played per group, so a pick can avoid repeating itself. */
const lastVariant = {};

/**
 * Choose one of several interchangeable takes of the same sound.
 *
 * With THREE OR MORE variants the immediately-previous one is excluded, because a repeat is the
 * thing the variants exist to prevent. With only two it is not: excluding the last would force
 * strict alternation, and a perfectly regular A-B-A-B is a more audible pattern than the
 * occasional doubled take. Pitch jitter covers the doubles.
 *
 * @param {string[]} ids
 * @param {string} [group] key for the no-repeat memory; defaults to the joined ids
 */
export function pickVariant(ids, group) {
  if (!ids || !ids.length) return null;
  if (ids.length === 1) return ids[0];
  const key = group || ids.join('|');
  let pool = ids;
  if (ids.length > 2 && lastVariant[key]) {
    const filtered = ids.filter((id) => id !== lastVariant[key]);
    if (filtered.length) pool = filtered;
  }
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  lastVariant[key] = chosen;
  return chosen;
}

/**
 * Clamped, ordered playback window for a sample — the single place the four dials are turned
 * into real times, so the panel's waveform markers and the audio cannot disagree.
 * @param {string} id
 */
export function sampleWindow(id) {
  const def = SAMPLES[id];
  const buf = buffers[id];
  const dur = buf ? buf.duration : (def ? def.end : 0);
  const start = Math.max(0, Math.min(def.start, dur));
  const end = Math.max(start + 0.02, Math.min(def.end || dur, dur));
  // The body cannot begin before the sample does, and must leave something to repeat.
  const loopStart = Math.max(start, Math.min(def.loopStart, end - 0.05));
  const body = Math.max(0.02, end - loopStart);
  // A crossfade longer than the body would have a pass fading out before the previous one
  // finished fading in, which stacks copies instead of joining them.
  const crossfade = Math.max(0, Math.min(def.crossfade, body * 0.5));
  return { start, end, loopStart, body, crossfade, duration: dur };
}

/**
 * Play a sample.
 *
 * With `duration` given (a beam that lasts as long as its effect), the whole thing — attack plus
 * however many crossfaded body passes are needed — is scheduled UP FRONT against the audio
 * clock. Scheduling repeats from a JS timer instead would put every loop seam at the mercy of
 * the frame rate, and a dropped frame mid-beam is exactly when a gap would be audible.
 *
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 * @param {string} id
 * @param {{ duration?: number, gain?: number, rate?: number, pitchJitter?: number }} [opts]
 * @returns {{ stop: (release?: number) => void } | undefined}
 */
export function playSample(ctx, dest, id, opts = {}) {
  const def = SAMPLES[id];
  const buf = buffers[id];
  if (!def || !buf) return undefined;

  const w = sampleWindow(id);
  // Rolled once per use, not per pass: a looping sample must hold ONE pitch for its whole
  // sustain, or every crossfade seam would join two different pitches and warble.
  const jitter = opts.pitchJitter !== undefined ? opts.pitchJitter : (def.pitchJitter || 0);
  const wobble = jitter > 0 ? 1 + (Math.random() * 2 - 1) * jitter : 1;
  const rate = Math.max(0.05, (opts.rate || def.rate || 1) * wobble);
  const out = ctx.createGain();
  // The per-sample trim, then the recorded-bus level on top. An explicit `opts.gain` overrides
  // the trim but NOT the bus — a caller asking for a specific level still wants it mixed against
  // the rest of the family, or the bus would have a hole in it.
  out.gain.value = (opts.gain === undefined ? def.gain : opts.gain) * SAMPLE_FX.volume;
  out.connect(dest);

  const t0 = ctx.currentTime + 0.005;
  /** @type {AudioBufferSourceNode[]} */
  const sources = [];

  /** One pass through part of the buffer, with optional equal-power fades at either end. */
  const pass = (at, from, len, fadeIn, fadeOut) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    src.connect(g).connect(out);
    const wall = len / rate; // buffer seconds -> wall-clock seconds
    const fi = fadeIn / rate, fo = fadeOut / rate;
    if (fi > 0) {
      g.gain.setValueAtTime(0, at);
      for (let i = 1; i <= EQ_POWER_STEPS; i++) {
        const k = i / EQ_POWER_STEPS;
        g.gain.linearRampToValueAtTime(Math.sqrt(k), at + fi * k);
      }
    } else {
      g.gain.setValueAtTime(1, at);
    }
    if (fo > 0) {
      const s = at + wall - fo;
      g.gain.setValueAtTime(1, s);
      for (let i = 1; i <= EQ_POWER_STEPS; i++) {
        const k = i / EQ_POWER_STEPS;
        g.gain.linearRampToValueAtTime(Math.sqrt(1 - k), s + fo * k);
      }
    }
    src.start(at, from, len);
    src.stop(at + wall + 0.02);
    sources.push(src);
    return at + wall;
  };

  const want = opts.duration;
  if (!def.loop || !(want > 0)) {
    // One-shot: the trimmed window, once. Still fades out if a crossfade is set, so a sample
    // cut off mid-tail does not click.
    pass(t0, w.start, w.end - w.start, 0, w.crossfade);
  } else {
    // Attack once, then body passes overlapping by the crossfade until the beam is covered.
    let cursor = t0;
    const attackLen = w.loopStart - w.start;
    if (attackLen > 0.005) cursor = pass(cursor, w.start, attackLen, 0, w.crossfade);
    const until = t0 + want;
    // Each pass after the first starts `crossfade` early so its fade-in overlaps the previous
    // fade-out; that overlap is why the advance per pass is shorter than the body itself.
    const advance = (w.body - w.crossfade) / rate;
    let guard = 0;
    let at = attackLen > 0.005 ? cursor - w.crossfade / rate : cursor;
    while (at < until && guard++ < 512) {
      pass(at, w.loopStart, w.body, w.crossfade, w.crossfade);
      at += advance;
    }
    // Close the tail off at the requested length rather than letting the last pass run long.
    out.gain.setValueAtTime(out.gain.value, Math.max(t0, until - w.crossfade));
    out.gain.linearRampToValueAtTime(0, until + 0.01);
  }

  let stopped = false;
  return {
    stop(release = 0.06) {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0, now + release);
      for (const s of sources) { try { s.stop(now + release + 0.02); } catch { /* already done */ } }
    },
  };
}
