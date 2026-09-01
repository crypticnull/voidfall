// @ts-check
// ---------- The save reset token ----------
// ONE number that guarantees a build starts with no player data.
//
// This exists because "wipe my player data" kept being done by hand — delete a folder, clear a
// localStorage key — and hand-wiping fails in exactly the way you cannot see: it clears the
// place you thought of and leaves the one you forgot. The browser and the packaged exe keep
// SEPARATE stores, the exe's is a leveldb blob inside %APPDATA% that only exists once the game
// has been run, and a wipe done before a build is undone the moment the player opens the old
// build again. Every one of those failures looks identical from the outside: someone says it is
// wiped, and it is not.
//
// So the wipe stops being an action performed on a machine and becomes a FACT ABOUT THE BUILD.
// Every save carries the token it was written under. On load, a save whose token does not match
// this one is discarded rather than migrated — in the browser, in the exe, on any machine, on
// the first launch after the bump, without anyone having to find a folder.
//
// TO WIPE PLAYER DATA IN THE NEXT BUILD: run `npm run wipe-saves`, which bumps this number and
// clears the local stores too. Do not edit it by hand and do not skip the tool — the tool also
// verifies, and verification is the half that kept getting missed.
//
// What a bump destroys: gold, purchased shop upgrades, lifetime kills and deaths, and the
// leaderboard. What it keeps: audio/graphics/input settings, which are preferences rather than
// progress and are stored under their own key with no token.
export const SAVE_RESET_TOKEN = 3;
