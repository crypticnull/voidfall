// @ts-check
// ---------- Elemental infusion, applied to the ART ITSELF ----------
// An infusion used to be a clinging aura drawn behind whatever the skill already looked like.
// That reads as a sticker: the bolt is still a blue bolt, with some orange nearby. What an
// infusion should do is change what the skill IS — a burning-infused Lightning Bolt should be a
// bolt made of fire, not a bolt with fire next to it.
//
// So this does not draw anything. It hands the skills' own procedural generators a different set
// of PARAMETERS, and they build a structurally different shape out of them. Same generator, same
// code path, different result:
//
//   frost    few, long, straight facets with their angles SNAPPED to 30° — a bolt of ice reads
//            as fractured crystal because it literally cannot bend to an arbitrary angle
//   shock    more segments, wider throw, extra branches — the untamed version of itself
//   burning  time-varying turbulence and an upward bias, so the shape licks and rises like flame
//            rather than sitting still, plus embers shed off the path
//   poison   fewer, lazier segments with a downward bias and swollen joints — it sags and drips
//
// The palette is remapped rather than replaced. Each generator keeps its own light-to-dark
// STRUCTURE (core, mid, deep) and only the hues move, so an infused skill still reads as that
// skill at a glance — silhouette and contrast survive, colour does not.

/**
 * @typedef {{ core: string, mid: string, deep: string, glowRgb: string,
 *             segs: number, amp: number, snap: number, wobble: number,
 *             sag: number, forks: number, ember: number, swell: number }} InfusionArt
 */

/** @type {Record<string, InfusionArt>} */
export const INFUSION_ART = {
  frost: {
    core: '#eaf9ff', mid: '#7fd4f2', deep: '#3f8fbc', glowRgb: '127,212,242',
    // Half the segments and a third off the throw: ice fractures in long planes, it does not
    // scribble. `snap` is what actually sells it — quantising every offset to a 30° lattice
    // means the shape is built from a fixed set of angles, which is what "crystalline" means.
    segs: 0.5, amp: 0.7, snap: Math.PI / 6, wobble: 0, sag: 0, forks: 1, ember: 0, swell: 0,
  },
  shock: {
    core: '#f2fbff', mid: '#5ac8f0', deep: '#2a7fc0', glowRgb: '90,200,240',
    // The baseline turned up. Shock is the element these generators were authored for, so it
    // is the one infusion that exaggerates rather than transforms.
    segs: 1.45, amp: 1.3, snap: 0, wobble: 0, sag: 0, forks: 3, ember: 0, swell: 0,
  },
  burning: {
    core: '#ffe6a8', mid: '#ff7a1f', deep: '#c0421f', glowRgb: '255,122,31',
    // `wobble` drives the offsets from a time-varying field instead of pure noise, so the shape
    // MOVES between frames the way a flame does — static randomness reads as static gravel.
    // `sag` is negative: fire rises.
    segs: 1.1, amp: 0.9, snap: 0, wobble: 1, sag: -0.4, forks: 1, ember: 1, swell: 0,
  },
  void: {
    // The outlier of the set, on purpose. Every other infusion is a colour of energy; void is an
    // ABSENCE, so the palette inverts the usual rule — a near-black body with a pale violet rim,
    // rather than a bright core fading outward. On screen it reads as a hole in the scene with
    // light bending around its edge.
    //
    // `swell` at full and a negative `amp` are what sell it: the shape bulges at its joints and
    // its offsets point INWARD instead of out, so the geometry collapses toward its own centre
    // line instead of spraying away from it. Nothing else in the game moves that way.
    core: '#e8e2ff', mid: '#4a2f8f', deep: '#120a24', glowRgb: '122,86,210',
    segs: 0.6, amp: -0.85, snap: 0, wobble: 0.7, sag: 0, forks: 2, ember: 0, swell: 1,
  },
  poison: {
    core: '#e8c6f8', mid: '#a95ec0', deep: '#5e2a78', glowRgb: '169,94,192',
    // Fewer, lazier kinks that all lean the same way, with swollen joints. Reads as something
    // heavy and viscous rather than something energetic.
    segs: 0.75, amp: 0.6, snap: 0, wobble: 0.45, sag: 0.55, forks: 1, ember: 0, swell: 1,
  },
};

/** The un-infused baseline, so a generator can take one code path for both cases. */
/** @type {InfusionArt} */
export const NO_INFUSION = {
  core: '', mid: '', deep: '', glowRgb: '',
  segs: 1, amp: 1, snap: 0, wobble: 0, sag: 0, forks: 1, ember: 0, swell: 0,
};

/**
 * Art parameters for an infusion, or the neutral baseline. Callers never branch on `infusion`
 * themselves — they read the numbers and multiply, so the uninfused path is the same arithmetic
 * with 1s in it.
 * @param {string | null | undefined} kind
 * @returns {InfusionArt}
 */
export function infusionArt(kind) {
  return (kind && INFUSION_ART[kind]) || NO_INFUSION;
}

/**
 * Pick a colour from an infusion's ramp, falling back to the skill's own when uninfused.
 * `slot` names the position in the light-to-dark structure rather than a hue, which is what
 * lets one call site serve every element.
 * @param {InfusionArt} art
 * @param {'core'|'mid'|'deep'} slot
 * @param {string} fallback the skill's own colour for that slot
 */
export function tint(art, slot, fallback) {
  return art[slot] || fallback;
}

/**
 * Smooth, seeded, time-varying value in -1..1. Used for `wobble`: cheap value noise rather than
 * Math.random(), because a flame's shape has to be CONTINUOUS between frames. Random offsets
 * re-rolled every frame look like static, which is the single most common way procedural fire
 * goes wrong.
 * @param {number} x @param {number} t
 */
export function flow(x, t) {
  return Math.sin(x * 1.7 + t * 5.1) * 0.6 + Math.sin(x * 3.9 - t * 3.3) * 0.4;
}

/**
 * The shared jagged-path generator, infusion-aware.
 *
 * Replaces the plain "random offset per segment" version: same signature plus the art block, and
 * with NO_INFUSION it produces the same distribution it always did, so uninfused skills are
 * untouched.
 *
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @param {number} segments base segment count, scaled by art.segs
 * @param {number} jitter base perpendicular throw, scaled by art.amp
 * @param {number} perpX @param {number} perpY
 * @param {InfusionArt} art
 * @param {number} seed keeps concurrent paths from sharing a wobble phase
 * @param {number} t seconds, for the time-varying field
 * @returns {{x:number,y:number}[]}
 */
export function infusedPolyline(x1, y1, x2, y2, segments, jitter, perpX, perpY, art, seed = 0, t = 0) {
  const segs = Math.max(2, Math.round(segments * art.segs));
  const amp = jitter * art.amp;
  const pts = [{ x: x1, y: y1 }];
  for (let i = 1; i < segs; i++) {
    const f = i / segs;
    // Turbulence when the element wants to move, noise when it does not. Blended rather than
    // switched, so `wobble` is a dial and not a mode.
    const noise = (Math.random() - 0.5) * 2;
    const field = flow(i * 0.9 + seed, t);
    let off = (noise * (1 - art.wobble) + field * art.wobble) * amp * 0.5;
    // A constant lean along the perpendicular: fire rises off its own axis, poison drags below
    // it. Weighted by a half-sine so the ends stay pinned and only the middle bows.
    off += art.sag * amp * 0.5 * Math.sin(f * Math.PI);
    if (art.snap > 0) {
      // Quantise the offset to a lattice derived from the throw, which is what turns a smooth
      // scribble into flat crystal faces.
      const step = amp * Math.tan(art.snap) * 0.5 || 1;
      off = Math.round(off / step) * step;
    }
    pts.push({ x: x1 + (x2 - x1) * f + perpX * off, y: y1 + (y2 - y1) * f + perpY * off });
  }
  pts.push({ x: x2, y: y2 });
  return pts;
}
