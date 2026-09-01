// Single source of truth for the build label shown on the main menu.
// Keep this in sync with the "version" field in package.json (which drives the
// exe filename, e.g. VoidfallSurvivors_Alpha_0.0.1.exe). Bump both together.
/** @type {'Alpha' | 'Beta' | 'Release'} */
export const BUILD_STAGE = 'Alpha';
export const BUILD_VERSION = '0.7.0';
export const BUILD_LABEL = `${BUILD_STAGE} ${BUILD_VERSION}`;

// Shop unlocks handed out free during development.
//
// The jukebox is a gold purchase in the finished game, but gating it while there is exactly one
// player only adds friction to testing. Free for every pre-release build; it becomes a purchase
// the moment BUILD_STAGE is 'Release'. Deriving it from the stage rather than a standalone flag
// means shipping cannot accidentally ship the dev freebie — there is no switch to remember.
// The cast widens BUILD_STAGE back to a plain string. TypeScript narrows a const to its
// literal initializer through control flow, so it reads `BUILD_STAGE !== 'Release'` as always
// true and reports the comparison as unreachable — even though the whole point is that this
// value changes between builds. The cast states that intent rather than suppressing the error.
export const IS_RELEASE = /** @type {string} */ (BUILD_STAGE) === 'Release';
export const JUKEBOX_FREE = !IS_RELEASE;
