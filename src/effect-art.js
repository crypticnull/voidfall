// @ts-check
// ---------- Effect art registry ----------
// Every visual effect in the game is currently PROCEDURAL: drawn with arcs, gradients and
// paths in main.js. That stays true and stays supported — procedural effects cost nothing to
// author, scale to any size, and recolour for free.
//
// This registry is the seam for the other half: hand-drawn effect sprites, added one at a time
// without rewriting anything. An effect kind listed here renders from art; an effect kind
// absent from here renders procedurally, exactly as it does today. Both paths coexist
// permanently — there is no migration and no cut-over, because some effects (a beam that
// stretches to an arbitrary length, a shockwave that scales with area) are genuinely better
// procedural, while others (a fireball, an explosion) read far better hand-drawn.
//
// To give an effect art:
//   1. Add a sprite def in sprites.js with `images` and `imageFrames` (as characters do).
//   2. Add an entry here naming that sprite id.
// Nothing in main.js changes.
//
// Fields:
//   spriteId  sprite def to draw (must exist in sprites.js, or the entry is ignored)
//   scale     multiplier on the effect's own radius to get the drawn height
//   blend     'add' for anything glowing (the default for effects), 'normal' for solid art
//   spin      'none' | 'velocity' (face travel direction) | 'time' (rotate continuously)
//   spinRate  radians/second when spin is 'time'
//   fade      true to multiply alpha by the effect's remaining life
//   tint      [r,g,b] 0..1 multiply, or omit to use the effect's own colour

/**
 * @typedef {{ spriteId: string, scale?: number, blend?: 'normal'|'add',
 *             spin?: 'none'|'velocity'|'time', spinRate?: number, fade?: boolean,
 *             tint?: [number, number, number] }} EffectArt
 */

/** @type {Record<string, EffectArt>} */
export const EFFECT_ART = {
  // Nothing yet — every kind falls through to its procedural painter. Examples of the shape
  // these entries take, for when the art arrives:
  //
  // fireball:  { spriteId: 'fxFireball',  scale: 2.6, blend: 'add', spin: 'velocity' },
  // explosion: { spriteId: 'fxExplosion', scale: 3.0, blend: 'add', fade: true },
  // frostNova: { spriteId: 'fxFrostNova', scale: 2.2, blend: 'add', spin: 'time', spinRate: 0.6 },
};

/**
 * Art for an effect kind, or null to draw it procedurally.
 * @param {string} kind
 * @returns {EffectArt|null}
 */
export function effectArt(kind) {
  return EFFECT_ART[kind] || null;
}

/** True if any effect at all has art — lets the renderer skip the lookup entirely while empty. */
export function hasAnyEffectArt() {
  return Object.keys(EFFECT_ART).length > 0;
}
