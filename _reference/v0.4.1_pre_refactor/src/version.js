// Single source of truth for the build label shown on the main menu.
// Keep this in sync with the "version" field in package.json (which drives the
// exe filename, e.g. DuskfallSurvivors_Alpha_0.0.1.exe). Bump both together.
export const BUILD_STAGE = 'Alpha';
export const BUILD_VERSION = '0.4.1';
export const BUILD_LABEL = `${BUILD_STAGE} ${BUILD_VERSION}`;
