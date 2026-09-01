// @ts-check
// ---------- Graphics ----------
// Scene-wide render settings: things that change how the whole frame looks rather than what is
// in it. Kept apart from the gameplay tunables because these are a LOOK, not a balance decision
// — moving one changes nothing about how the game plays, which makes them safe to touch and the
// wrong thing to bury among numbers that are not.

/* GENERATED: graphics tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole block
   from tuning/entity-tuning.json under the `graphics` domain. */
export const GRAPHICS_TUNE_OVERRIDE = {
  bloom: 0.7,
};
/* END GENERATED */

export const GRAPHICS_TUNE = {
  // Strength of the additive glow pass. 0 skips it entirely, which is both free and the honest
  // way to judge a colour — bloom washes low-contrast surfaces together, and rock against floor
  // is exactly that case.
  bloom: 0.55,
  ...GRAPHICS_TUNE_OVERRIDE,
};

export const GRAPHICS_TUNE_META = {
  bloom: { label: 'Bloom Strength', min: 0, max: 1.5, step: 0.05 },
};
