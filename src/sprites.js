// Procedural pixel-art sprites: each unit is composed from a handful of flat-color
// shapes drawn onto a small offscreen canvas, then scaled up with image smoothing
// disabled so the edges stay crisp/blocky like real pixel art — no external image
// files, no licensing concerns, and every unit shares the game's existing palette.

const R = (x, y, w, h, c) => ({ k: 'r', x, y, w, h, c });
const T = (x1, y1, x2, y2, x3, y3, c) => ({ k: 't', pts: [x1, y1, x2, y2, x3, y3], c });
const P = (pts, c) => ({ k: 'p', pts, c });
const C = (x, y, r, c) => ({ k: 'c', x, y, r, c });

const BONE = '#c9bfa8';
const BONE_DIM = '#8a7d68';
const IRON = '#8a8578';
const DARK = '#1a1209';
const WOOD = '#5a4a30';
const GLOW = '#d9a545';

// Shared "torso" shapes for a unit that only differ by leg position between the two
// walk-cycle frames; keeps the two frame arrays declared but avoids retyping everything.
// A knight in a full suit of plate: great helm with crimson plume, rounded
// pauldrons, ridged breastplate under a crimson surcoat, fauld skirt, an upright
// longsword on the right and a heater shield (gold cross) on the left arm.
const knightTorso = [
  // Breastplate
  P([6, 12, 18, 12, 16.5, 25, 7.5, 25], '#6b7280'),
  P([6.6, 12.5, 11.7, 13, 11.7, 24.5, 7.7, 24.5], '#7d8592'),
  R(11.6, 12, 1.1, 13, '#9aa0ab'),
  P([10, 15, 14, 15, 13, 25, 11, 25], '#7a1f1a'),
  R(10.7, 15.2, 2.6, 0.9, '#a13328'),
  // Belt + fauld skirt
  R(7, 23.4, 10, 1.8, '#2a2018'),
  C(12, 24.3, 1.2, '#d9a545'),
  R(7.5, 25, 9, 3, '#5c626e'),
  R(9.9, 25, 0.6, 3, '#3a3f48'), R(13.5, 25, 0.6, 3, '#3a3f48'),
  // Pauldrons
  C(6.5, 12.8, 3.3, '#8a919c'), C(17.5, 12.8, 3.3, '#8a919c'),
  C(6.5, 12.2, 2.1, '#9aa0ab'), C(17.5, 12.2, 2.1, '#9aa0ab'),
  R(4.8, 13.4, 3.4, 1.3, '#3a3f48'), R(15.8, 13.4, 3.4, 1.3, '#3a3f48'),
  // Longsword (right hand, upright)
  T(21.2, 3, 20.4, 10, 22, 10, '#eef2f7'),
  R(20.4, 10, 1.8, 11, '#cdd4df'),
  R(20.8, 10, 0.7, 11, '#eef2f7'),
  R(18.6, 20.5, 4.6, 1.6, '#d9a545'),
  R(20.5, 22, 1.2, 3, '#3a2a1a'),
  C(21.1, 25.4, 1.1, '#d9a545'),
  C(20.9, 21.4, 1.5, '#6b7280'),
  // Great helm
  R(8, 3, 8, 9.5, '#6b7280'),
  P([8, 3, 16, 3, 14.6, 0.8, 9.4, 0.8], '#8a919c'),
  R(8, 3, 0.9, 9, '#9aa0ab'),
  R(15.2, 4, 0.9, 7.5, '#4a4f59'),
  R(11.5, 3.4, 0.8, 2.4, '#4a4f59'),
  R(8.4, 6, 7.2, 1.6, '#141418'),
  R(10, 8.8, 0.8, 1, '#141418'), R(13.2, 8.8, 0.8, 1, '#141418'),
  // Crimson plume
  P([12.6, 0.8, 16, 1.8, 15, 5.5, 12.6, 3.8], '#a13328'),
  P([12.6, 1.2, 14.8, 1.9, 14.2, 4.4, 12.6, 3.4], '#c9453a'),
  // Heater shield (left arm, front)
  P([0, 17, 5, 14, 6, 24, 1, 27], '#4a1214'),
  P([1.2, 17, 5, 15, 5, 23, 2, 25], '#7a1f1a'),
  R(2.7, 17.5, 1, 5, '#d9a545'), R(1.6, 19.2, 3, 1, '#d9a545'),
  C(4.6, 22, 1.5, '#6b7280'),
];
// A robed elemental sorceress: layered violet robe with a gold-trimmed mantle, a
// wide-brimmed pointed hat with a gem band, and an arcane staff whose crystal pulses
// between the two frames.
const sorceressBody = [
  // Staff (behind body, right side)
  R(19, 5, 1.8, 25, '#5a4a30'), R(19.4, 5, 0.6, 25, '#7a6540'),
  // Draping sleeves
  P([4, 15, 8, 14, 7, 25, 2, 23], '#4a2f6e'),
  P([16, 14, 20, 15, 20, 23, 15, 25], '#4a2f6e'),
  // Robe bell
  P([8, 13, 16, 13, 21, 30, 3, 30], '#6b4a8a'),
  P([8, 13, 12, 13, 11, 30, 3, 30], '#5a3d78'),
  R(11.6, 14, 1.1, 16, '#7d5aa0'),
  R(8.6, 15, 0.7, 14, '#4a2f6e'), R(14.6, 15, 0.7, 14, '#4a2f6e'),
  R(3, 28.4, 18, 1.7, '#3d2758'),
  R(3, 29.7, 18, 0.8, '#d9a545'),
  // Shoulder mantle
  P([7, 12, 17, 12, 19, 16, 5, 16], '#4a2f6e'),
  R(9, 12.2, 6, 1, '#d9a545'),
  // Hands
  C(5.5, 21, 1.5, '#c9a9d8'), C(18.5, 20.5, 1.5, '#c9a9d8'),
  // Belt + gem
  R(7, 19.5, 10, 1.7, '#3d2758'), C(12, 20.3, 1.5, '#6bd9e0'), C(12, 20.3, 0.7, '#d0f7fa'),
  // Head (shadowed under brim)
  C(12, 9, 3.4, '#3a2b52'),
  R(10.3, 8.6, 1.1, 1.3, '#c98af0'), R(12.8, 8.6, 1.1, 1.3, '#c98af0'),
  // Wide-brim pointed hat
  P([2, 6.4, 22, 6.4, 19, 4.6, 5, 4.6], '#3d2758'),
  P([3, 5.6, 21, 5.6, 18.5, 4.6, 5.5, 4.6], '#5a3a7e'),
  P([7, 5, 16, 5, 15, 1.6, 11, 1.6], '#5a3a7e'),
  P([7, 5, 10.5, 5, 10.5, 2, 11, 1.6], '#4a2f6e'),
  P([15, 1.6, 11, 1.6, 13.5, 0.4, 17.5, 1.6], '#5a3a7e'),
  R(7.2, 4.2, 8.6, 1.3, '#d9a545'),
  C(11.5, 4.85, 0.95, '#6bd9e0'),
  C(18, 1.6, 1.3, '#d9a545'),
];

// A hooded ranger: layered green cloak over a strapped tunic, leather bracers and
// belt pouch, a back quiver with fletched arrows, and a recurve longbow at the side.
const rangerBody = [
  // Quiver on the back with arrows
  R(3.5, 10, 2.6, 9, '#3a2a1a'), R(3.5, 10, 0.8, 9, '#5a4a30'),
  R(4, 6, 0.6, 4, '#8a7d68'), R(5.1, 6, 0.6, 4, '#8a7d68'),
  T(3.6, 6, 4.3, 3.4, 5, 6, '#6b8f45'), T(4.7, 6, 5.4, 3.4, 6.1, 6, '#6b8f45'),
  // Recurve longbow + string
  P([20.5, 4, 21.6, 5, 20, 16, 19.2, 15], '#6b5230'),
  P([19.2, 15, 20, 16, 21.6, 27, 20.5, 28], '#6b5230'),
  R(19.4, 14.5, 1.4, 3, '#3a2a1a'),
  R(21.7, 4.5, 0.5, 23, '#c9bfa8'),
  // Cloak body
  P([6, 13, 18, 13, 20, 30, 4, 30], '#3d5228'),
  P([6, 13, 11, 13, 10, 30, 4, 30], '#33461f'),
  R(11.6, 14, 1, 16, '#4a6330'),
  R(8.6, 14, 0.7, 15, '#33461f'), R(14.6, 14, 0.7, 15, '#33461f'),
  R(4, 28.6, 16, 1.5, '#2a3818'),
  // Tunic + crossed straps
  P([8, 12, 16, 12, 15, 20, 9, 20], '#4a5c34'),
  R(11.6, 12, 1, 8, '#5c7040'),
  R(8.5, 13, 7, 1.2, '#5a4a30'), R(11.4, 12, 1.2, 8, '#5a4a30'),
  // Belt + buckle + pouch
  R(7, 19.5, 10, 1.8, '#3a2a1a'), C(12, 20.4, 1.1, '#d9a545'),
  R(14.5, 20, 2.6, 3, '#5a4a30'), R(14.5, 20, 2.6, 0.8, '#6b5838'),
  // Arms + bracer
  C(6, 18, 1.6, '#4a5c34'), R(4.8, 17, 2.2, 2.4, '#5a4a30'),
  C(18, 17.5, 1.5, '#4a5c34'),
  // Hood + shadowed face
  P([7.5, 11, 16.5, 11, 15.5, 4, 12, 1.2, 8.5, 4], '#3d5228'),
  P([8.5, 6, 12, 2.2, 11, 6.5], '#567a3a'),
  C(12, 9.2, 3.1, '#241f14'),
  R(10.7, 9, 1, 1.1, '#a8c96a'),
  C(12, 12, 1, '#d9a545'),
];

// ---------- Shared "gritty earth" palette ----------
// Muted umber/tan/bone family with 4 tonal steps per material, matching the reference art
// direction: heavy dark masses, warm mid-browns, and sparing bone-white highlights.
export const EARTH = {
  shadow: '#1a1611', dark: '#2b241b', mid: '#3f3527', lit: '#584833', edge: '#75603f',
  leather: '#7d5f3c', leatherHi: '#a67d4e',
  steel: '#8d8578', steelHi: '#c2b9a4',
  bone: '#e8dcc4', skinDk: '#9c7350', skinMid: '#c49a72', skinLt: '#e0bd94',
};

// Near-black cloth ramp for the shinobi. Kept cool/neutral (not EARTH's warm browns) so she
// actually reads as black-clad, while still carrying four tonal steps for form.
const INK = { black: '#0d0d11', dark: '#191920', mid: '#26262f', lit: '#35353f' };

// A shinobi swathed head-to-toe in cloth wraps — only a narrow slit of eyes shows. Rendered
// at double the old resolution so the wraps can carry real tonal depth: four charcoal steps
// warmed toward the earth palette, muted-leather sash, and bone-pale eyes. The two trailing
// wrap-ends are drawn per-frame (in the sprite def) so they flutter as she moves.
const shinobiBody = [
  // ---- torso ----
  P([14, 18, 26, 18, 25, 33, 15, 33], INK.dark),
  P([14, 18, 20, 18, 20, 33, 15, 33], INK.black),      // shaded left half
  P([24, 19, 26, 18, 25, 33, 23.5, 33], INK.mid),       // lit right edge
  // chest wrap bands
  R(14.5, 21, 11, 1.6, INK.mid),
  R(14.5, 24.5, 11, 1.6, INK.mid),
  R(15, 28, 10, 1.4, INK.black),
  // diagonal chest strap
  P([15, 19, 18, 19, 24, 33, 21, 33], INK.lit),
  // ---- shoulders + arms ----
  C(14, 19.5, 2.6, INK.dark), C(26, 19.5, 2.6, INK.dark),
  R(11.4, 20, 3.4, 8, INK.dark), R(25.2, 20, 3.4, 8, INK.dark),
  // banded forearm wraps
  R(11.2, 27.5, 3.6, 5.5, INK.mid), R(25.4, 27.5, 3.6, 5.5, INK.mid),
  R(11.2, 29, 3.6, 0.7, INK.black), R(11.2, 31, 3.6, 0.7, INK.black),
  R(25.4, 29, 3.6, 0.7, INK.black), R(25.4, 31, 3.6, 0.7, INK.black),
  C(12.9, 34, 2, INK.black), C(27.1, 34, 2, INK.black), // wrapped fists
  // ---- waist sash: still black cloth, just a lighter weave so the wrap reads ----
  R(14, 32.5, 12, 3.2, INK.mid),
  R(14, 32.5, 12, 1, INK.lit),
  P([18, 35, 21, 35, 20.5, 44, 18.5, 44], INK.mid),  // hanging knot-tail
  // shuriken pouch on the hip (cloth-wrapped, only the steel edge catches light)
  R(24.5, 33.5, 3.6, 3.4, INK.dark),
  R(24.5, 33.5, 3.6, 0.9, INK.mid),
  C(26.3, 35.6, 0.8, EARTH.steel),
  // ---- hooded, fully-wrapped head ----
  P([14, 16, 26, 16, 25.5, 8, 20, 4.5, 14.5, 8], INK.dark),
  P([14, 16, 20, 16, 20, 4.8, 14.5, 8], INK.black),
  P([16, 7.5, 20, 5, 24, 7.5, 24, 9, 16, 9], INK.mid),  // lit crown
  R(14.2, 14.6, 11.6, 1.6, INK.mid),                    // cowl fold under the chin
  // the eye slit: a deep recess with two cold, pale eyes
  R(15, 9.6, 10, 3, '#0b0a08'),
  R(16.6, 10.4, 2.6, 1.5, EARTH.bone),
  R(21.8, 10.4, 2.6, 1.5, EARTH.bone),
  R(17.5, 10.4, 1, 1.5, '#6b7a80'), R(22.7, 10.4, 1, 1.5, '#6b7a80'),
];

// Weathered skull for the flaming skull enemy. Five bone tones (shadow → cream) give it the
// rounded, sculpted read of the reference art, with fire glowing out of the eye sockets.
const flameSkullBone = (() => {
  const shadow = '#3d3226', dark = '#6b5a47', mid = '#8f7c63', lit = '#b5a184', hi = '#d8c8a8';
  return [
    // cranium
    P([8, 19, 7.5, 13, 9, 9, 13, 7.4, 17, 9, 18.5, 13, 18, 19], mid),
    P([8, 19, 7.5, 13, 9, 9, 12.4, 7.7, 12.4, 19], dark),      // shaded left half
    P([10.5, 9.4, 13, 8, 15.6, 9.6, 15, 11.2, 11, 11.2], lit), // lit crown
    P([12.6, 8.4, 14.2, 8.9, 13.6, 10], hi),                   // specular pop
    R(8.5, 15.4, 9, 1.1, dark),                                // brow ridge
    // weathering cracks
    P([10.8, 10, 11.5, 13.2, 10.9, 13.2], shadow),
    R(15.6, 11, 0.6, 2.4, shadow),
    // eye sockets: deep recess, then fire burning inside
    C(10.7, 17.2, 2.35, '#160d06'), C(15.3, 17.2, 2.35, '#160d06'),
    C(10.7, 17.3, 1.55, '#a8380f'), C(15.3, 17.3, 1.55, '#a8380f'),
    C(10.6, 17.0, 1.0, '#ff8c2a'), C(15.2, 17.0, 1.0, '#ff8c2a'),
    C(10.45, 16.8, 0.5, '#ffe0a0'), C(15.05, 16.8, 0.5, '#ffe0a0'),
    // nasal cavity
    P([13, 18.6, 11.9, 21.3, 14.1, 21.3], '#160d06'),
    // cheekbones
    P([8, 19, 10.1, 19, 10.1, 22, 8.6, 21.4], dark),
    P([18, 19, 15.9, 19, 15.9, 22, 17.4, 21.4], mid),
    // upper jaw + teeth
    P([9.5, 21.4, 16.5, 21.4, 16, 24.4, 10, 24.4], mid),
    R(10, 22.5, 6, 1.9, hi),
    R(11, 22.5, 0.5, 1.9, shadow), R(12.2, 22.5, 0.5, 1.9, shadow),
    R(13.4, 22.5, 0.5, 1.9, shadow), R(14.6, 22.5, 0.5, 1.9, shadow),
    // lower jaw + teeth
    P([10, 24.7, 16, 24.7, 15.2, 27.4, 10.8, 27.4], dark),
    R(10.7, 24.9, 4.7, 1.6, lit),
    R(11.7, 24.9, 0.5, 1.6, shadow), R(12.9, 24.9, 0.5, 1.6, shadow),
    R(14.1, 24.9, 0.5, 1.6, shadow),
  ];
})();

// ---------- The Skeleton (playable) ----------
// Same 40x56 construction as the shinobi: five bone tones for real sculpted depth, a dark
// cloth wrap to break up the silhouette, and hollow sockets lit by a cold grave-glow.
const SKEL = { shadow: '#3a372c', dark: '#7d7563', mid: '#a89e85', lit: '#cfc4a8', hi: '#ece2c8' };

const skeletonBody = [
  // ---- ribcage ----
  P([13, 17, 27, 17, 25.5, 31, 14.5, 31], SKEL.mid),
  P([13, 17, 20, 17, 20, 31, 14.5, 31], SKEL.dark),        // shaded left half
  P([25, 18, 27, 17, 25.5, 31, 24, 30], SKEL.lit),         // lit right edge
  // rib bands, with a dark gap between each
  R(14, 19.4, 12, 1.6, SKEL.lit), R(14.2, 22.2, 11.6, 1.6, SKEL.lit),
  R(14.6, 25, 10.8, 1.6, SKEL.dark), R(15, 27.8, 10, 1.4, SKEL.dark),
  R(19.4, 18, 1.6, 13, SKEL.hi),                           // sternum
  // ---- collar + shoulders ----
  R(12.6, 16, 14.8, 1.8, SKEL.lit),
  C(13, 18.6, 2.4, SKEL.mid), C(27, 18.6, 2.4, SKEL.mid),
  // ---- arm bones (humerus / forearm) ----
  R(11.6, 20, 2.6, 7, SKEL.mid), R(25.8, 20, 2.6, 7, SKEL.mid),
  R(11.6, 20, 1, 7, SKEL.dark), R(27.4, 20, 1, 7, SKEL.lit),
  C(12.9, 27.4, 1.5, SKEL.dark), C(27.1, 27.4, 1.5, SKEL.dark),   // elbow knobs
  R(11.8, 28.4, 2.2, 6, SKEL.mid), R(26, 28.4, 2.2, 6, SKEL.mid),
  C(12.9, 35, 1.9, SKEL.lit), C(27.1, 35, 1.9, SKEL.lit),          // bony hands
  // ---- dark cloth wrap at the hip (breaks up the silhouette) ----
  R(13.6, 31, 12.8, 3.4, '#2b241b'),
  R(13.6, 31, 12.8, 1, '#3f3527'),
  P([18, 34.2, 21.6, 34.2, 21, 42, 18.6, 42], '#2b241b'),
  // ---- pelvis ----
  P([14.6, 34, 25.4, 34, 24, 39, 16, 39], SKEL.mid),
  R(19.6, 34, 1, 5, SKEL.shadow),
  // ---- skull ----
  P([14.4, 16, 25.6, 16, 25.6, 8.6, 20, 4.6, 14.4, 8.6], SKEL.mid),
  P([14.4, 16, 20, 16, 20, 4.8, 14.4, 8.6], SKEL.dark),
  P([16.4, 7.6, 20, 5.2, 23.6, 7.6, 23.6, 9.4, 16.4, 9.4], SKEL.lit),  // lit cranium
  P([19, 5.6, 21.4, 6, 20.6, 7.4], SKEL.hi),                            // specular
  R(15.6, 12.4, 8.8, 1.2, SKEL.dark),                                   // cheek line
  // hollow sockets with a cold grave-glow
  C(17.2, 10.6, 2.2, '#14120c'), C(22.8, 10.6, 2.2, '#14120c'),
  C(17.2, 10.6, 1.05, '#5f7f6b'), C(22.8, 10.6, 1.05, '#5f7f6b'),
  C(17.0, 10.4, 0.5, '#bfe0cc'), C(22.6, 10.4, 0.5, '#bfe0cc'),
  // nasal cavity + jaw teeth
  P([20, 11.8, 19.1, 13.6, 20.9, 13.6], '#14120c'),
  R(16.4, 14, 7.2, 1.7, SKEL.hi),
  R(17.4, 14, 0.5, 1.7, SKEL.shadow), R(18.8, 14, 0.5, 1.7, SKEL.shadow),
  R(20.2, 14, 0.5, 1.7, SKEL.shadow), R(21.6, 14, 0.5, 1.7, SKEL.shadow),
];

// Leg bones (femur, knee, shin) + foot, parameterised so every facing reuses the construction.
function skeletonLegs(lx, rx, stride) {
  const L = lx - stride, Rt = rx + stride;
  return [
    R(L, 38, 3, 7, SKEL.mid), R(Rt, 38, 3, 7, SKEL.mid),           // femurs
    R(L, 38, 1.1, 7, SKEL.dark), R(Rt, 38, 1.1, 7, SKEL.dark),
    C(L + 1.5, 45.4, 1.7, SKEL.lit), C(Rt + 1.5, 45.4, 1.7, SKEL.lit), // knees
    R(L + 0.2, 46.4, 2.6, 6, SKEL.mid), R(Rt + 0.2, 46.4, 2.6, 6, SKEL.mid),
    R(L - 0.8, 52, 4.6, 2.2, SKEL.lit), R(Rt - 0.6, 52, 4.6, 2.2, SKEL.lit), // feet
    R(L - 0.8, 53.6, 4.6, 0.8, SKEL.dark), R(Rt - 0.6, 53.6, 4.6, 0.8, SKEL.dark),
  ];
}

// Painted over the skull when he faces away: the back of the cranium, no sockets.
const skeletonBackOverlay = [
  R(14.4, 8.4, 11.2, 6.4, SKEL.mid),
  P([15.4, 8.4, 20, 5.4, 24.6, 8.4, 24.6, 10, 15.4, 10], SKEL.lit),
  R(19.6, 8.6, 0.9, 6, SKEL.dark),   // cranial suture down the back
  R(15.8, 13.6, 8.4, 1.2, SKEL.dark),
];

// Wrapped legs + tabi boots for the shinobi, parameterised so the front/back views can reuse
// the same construction with a small stride offset.
function shinobiLegs(lx, rx, stride) {
  const L = lx - stride, Rt = rx + stride;
  return [
    R(L, 34, 4, 18, INK.dark), R(Rt, 34, 4, 18, INK.dark),
    R(L, 34, 1.5, 18, INK.black), R(Rt, 34, 1.5, 18, INK.black),
    R(L, 41, 4, 0.8, INK.mid), R(Rt, 41, 4, 0.8, INK.mid),
    R(L, 46.5, 4, 0.8, INK.mid), R(Rt, 46.5, 4, 0.8, INK.mid),
    R(L - 0.8, 51.5, 4.8, 2.8, INK.black), R(Rt - 0.4, 51.5, 4.8, 2.8, INK.black),
    R(L - 0.8, 53.7, 4.8, 0.8, INK.mid), R(Rt - 0.4, 53.7, 4.8, 0.8, INK.mid),
  ];
}

// Painted over the head when she faces away: covers the eye slit with the back of the hood
// and adds the knot that ties her wraps off.
const shinobiBackOverlay = [
  R(14.6, 8.6, 10.8, 5.2, INK.dark),          // blank out the eyes
  P([15, 8.6, 20, 6.6, 25, 8.6, 25, 10, 15, 10], INK.mid), // crown seam
  R(18.4, 12.6, 3.2, 2.4, INK.mid),           // knot
  R(18.4, 12.6, 3.2, 0.8, INK.lit),
];

// ---------- Enemy shared bodies (legs animate per frame) ----------
// Restyled at 2x resolution: five steps of rotten flesh (deep shadow → sickly highlight),
// exposed bone, and torn cloth, matching the flameSkull's tonal depth.
const zombieBody = (() => {
  const fleshDk = '#232d16', flesh = '#3a4a24', fleshMid = '#4e6231', fleshLit = '#6b8342', fleshHi = '#8fa85c';
  const boneC = '#c6bda2', boneDk = '#8f8770', gore = '#6e1a16', goreDk = '#3d0e0c';
  const clothDk = '#2a2b1c', cloth = '#43452c';
  return [
    // dangling arms
    R(1, 18, 3.6, 13, flesh), R(1, 18, 1.4, 13, fleshDk), C(2.8, 31, 2.4, fleshMid),
    R(21.4, 16.5, 3.4, 12, flesh), R(23.4, 16.5, 1.2, 12, fleshDk), C(23.1, 28.5, 2.2, fleshMid),
    // hunched torso
    P([5.5, 15, 21, 12.5, 23, 30, 4, 31], flesh),
    P([5.5, 15, 12.5, 14, 12.5, 31, 4, 31], fleshDk),          // shaded left
    P([19.5, 13, 21, 12.5, 23, 30, 21, 30], fleshMid),         // lit right edge
    // torn-open belly showing ribs
    P([8.5, 20, 18, 20, 17.5, 29, 8.5, 29], goreDk),
    P([9.5, 21, 17, 21, 16.6, 28, 9.5, 28], gore),
    R(10, 22, 6.6, 1.1, boneC), R(10.4, 24.2, 5.8, 1.1, boneC), R(10.8, 26.4, 5, 1.1, boneDk),
    // shoulder wound
    C(8.5, 16.5, 2.2, gore), C(8.5, 16.5, 1, goreDk),
    // tattered hem
    T(4, 31, 7, 36, 10, 31, cloth), T(10.5, 31, 13.5, 36.5, 16.5, 31, clothDk),
    T(17, 30, 20, 35, 23, 30, cloth),
    // head — lolling, gaunt
    C(15, 9, 5.6, fleshMid),
    P([9.6, 9, 20.6, 9, 19.2, 14.6, 11.4, 14.6], flesh),
    P([9.6, 9, 15, 9, 15, 14.6, 11.4, 14.6], fleshDk),         // shaded jaw
    P([12.5, 4.6, 17, 4.2, 18.6, 6.4, 12, 6.8], fleshHi),      // lit brow
    // sunken eyes with a sick yellow glimmer
    R(11.6, 7, 2.2, 2.4, '#151a0c'), R(16.4, 7, 2.2, 2.4, '#151a0c'),
    R(12.1, 7.5, 1.2, 1.4, '#c9b020'), R(16.9, 7.5, 1.2, 1.4, '#c9b020'),
    R(12.4, 7.8, 0.6, 0.8, DARK), R(17.2, 7.8, 0.6, 0.8, DARK),
    // broken grin
    R(11.8, 12.4, 6.4, 1.3, '#140f07'),
    R(12.3, 12, 1, 2, boneC), R(14.1, 12, 1, 2, boneC), R(15.9, 12, 1, 2, boneDk),
  ];
})();

const boneArcherBody = [
  // Bow (left) + nocked arrow
  P([3, 5, 4, 6, 2.5, 15, 1.5, 14], '#6b5230'), P([1.5, 14, 2.5, 15, 4, 24, 3, 25], '#6b5230'),
  R(0.9, 4.6, 0.5, 21, '#c9bfa8'),
  R(1, 14.5, 5, 0.7, '#8a7d68'), T(6, 14.8, 4, 13.6, 4, 16, '#a89e83'),
  // Spine + ribcage
  R(9.4, 12, 1.2, 10, BONE_DIM),
  P([6, 12, 13, 12, 12, 20, 7, 20], '#e8e0cc'),
  R(6.5, 13.5, 6, 0.9, BONE_DIM), R(6.5, 15.5, 6, 0.9, BONE_DIM), R(7, 17.5, 5, 0.9, BONE_DIM),
  // Arms
  R(4, 13, 1.8, 8, BONE), R(13, 13, 1.8, 7, BONE),
  C(4.9, 21, 1.3, BONE), C(13.9, 20, 1.3, BONE),
  C(6.5, 12.5, 1.8, BONE), C(12.5, 12.5, 1.8, BONE),
  P([7, 21, 12, 21, 11, 24, 8, 24], BONE_DIM),
  // Skull
  C(9.6, 7, 4.2, '#efe8d6'),
  P([6.6, 8, 12.6, 8, 11.6, 11, 7.6, 11], '#efe8d6'),
  R(7.4, 6.2, 1.8, 2, '#241a12'), R(10.4, 6.2, 1.8, 2, '#241a12'),
  T(9.1, 8.4, 9.6, 9.6, 10.1, 8.4, '#241a12'),
  R(7.8, 10.2, 3.6, 0.5, '#8a7d68'),
  R(6.8, 4.6, 5.6, 0.6, '#c9bfa8'),
];

const ogreBody = [
  // Club (right shoulder)
  R(23, 3, 4, 20, '#5a4630'), C(25, 3, 2.6, '#4a3a26'),
  R(23.4, 4, 1, 18, '#6b5238'),
  C(24, 5, 0.8, '#3a2d20'), C(26, 9, 0.8, '#3a2d20'), C(24.5, 14, 0.8, '#3a2d20'),
  // Arms
  R(3, 14, 3, 8, '#5c4630'), C(4.5, 15, 2.6, '#5c4630'), C(4.5, 22, 2, '#4a3826'),
  C(21, 13, 2.6, '#5c4630'),
  // Torso
  P([3, 11, 23, 11, 25, 25, 1, 25], '#5c4630'),
  P([3, 11, 13, 11, 12, 25, 1, 25], '#523e2a'),
  R(2, 23, 22, 2, '#3a2d20'),
  C(13, 18, 5, '#6b5238'),
  R(6, 13, 3, 2.4, '#4a3826'), R(16, 14, 3, 2.4, '#4a3826'), R(9, 20, 4, 2, '#4a3826'),
  P([9, 24, 17, 24, 16, 29, 10, 29], '#3a2d20'),
  // Head
  C(13, 7.5, 4.6, '#6b5238'),
  R(9.5, 7, 2, 1.3, '#2a1f14'), R(15, 7, 2, 1.3, '#2a1f14'),
  R(10.2, 7.3, 1.1, 1, '#c9b020'), R(15, 7.3, 1.1, 1, '#c9b020'),
  R(11, 10.2, 5, 1, '#2a1f14'),
  T(11, 10.5, 10.2, 12.6, 11.6, 10.5, BONE), T(15, 10.5, 15.8, 12.6, 14.4, 10.5, BONE),
  R(9, 5.4, 8, 0.8, '#7a5f42'),
];

// ---------- Horned Goblin ----------
// Procedural fallback only: the shipped art is hand-drawn PNGs (see the def below). These
// shapes are what draws if a file is missing, so they stay deliberately simple — a hunched,
// horned brute in the art's own mossy browns rather than an attempt to redraw it.
const GOB = { dark: '#211a10', mid: '#423320', lit: '#655838', hi: '#83764b', skin: '#a1845e' };
const gobBody = [
  // hunched torso, wider at the shoulders than the hips
  P([6, 14, 20, 14, 18, 24, 8, 24], GOB.mid),
  P([6, 14, 13, 14, 13, 24, 8, 24], GOB.lit),
  // slab arms hanging past the knee, knuckles low
  R(3.4, 14.5, 3.2, 10, GOB.mid), R(19.4, 14.5, 3.2, 10, GOB.mid),
  C(5, 25, 2.2, GOB.lit), C(21, 25, 2.2, GOB.lit),
  // head sunk between the shoulders
  C(13, 9.5, 5.4, GOB.lit), C(13, 8.6, 4.4, GOB.skin),
  // curved horns
  P([8.4, 6, 6, 1.5, 9.2, 3.4], GOB.hi), P([17.6, 6, 20, 1.5, 16.8, 3.4], GOB.hi),
  // eyes and tusks
  C(11, 9, 1.1, GOB.dark), C(15, 9, 1.1, GOB.dark),
  C(11.3, 8.7, 0.4, '#e8d9a8'), C(15.3, 8.7, 0.4, '#e8d9a8'),
  R(11.4, 12, 1, 1.8, '#e8d9a8'), R(13.6, 12, 1, 1.8, '#e8d9a8'),
];
// Squat legs, alternating on the two fallback frames so he at least shuffles.
const gobLegs = (step) => [
  R(8.6, 24, 3.6, step ? 7 : 6, GOB.mid), R(13.8, 24, 3.6, step ? 6 : 7, GOB.mid),
  R(7.8, step ? 30.4 : 29.4, 5, 1.6, GOB.dark), R(13, step ? 29.4 : 30.4, 5, 1.6, GOB.dark),
];

const skeletonMinionBody = [
  // Raised sword (right)
  T(15.5, 1, 14.7, 9, 16.3, 9, '#eef2f7'),
  R(14.7, 9, 1.6, 8, '#cdd4df'),
  R(13, 16.5, 5, 1.3, '#8a6a2f'), R(14.9, 18, 1, 2, '#3a2a1a'),
  // Round shield (left)
  C(3, 15, 3, '#4a3a26'), C(3, 15, 2.4, '#5a4a30'), C(3, 15, 1, '#6b5838'),
  R(2.4, 12.4, 1.2, 5.2, '#3a2d20'),
  // Arms
  R(4.5, 12, 1.5, 6, BONE), R(12, 11, 1.5, 6, BONE),
  C(5.2, 18, 1.1, BONE), C(12.7, 11, 1.1, BONE),
  // Ribcage + spine + shoulders + pelvis
  R(8.4, 11, 1.1, 9, BONE_DIM),
  P([5.5, 11, 11.5, 11, 10.5, 18, 6.5, 18], '#e8e0cc'),
  R(6, 12.4, 5, 0.8, BONE_DIM), R(6, 14.2, 5, 0.8, BONE_DIM), R(6.4, 16, 4, 0.8, BONE_DIM),
  C(6, 11, 1.6, BONE), C(11, 11, 1.6, BONE),
  P([6.5, 19, 10.5, 19, 9.8, 21.5, 7.2, 21.5], BONE_DIM),
  // Skull (allied gold eyes)
  C(8.5, 6.5, 3.6, '#efe8d6'),
  P([5.8, 7.4, 11.2, 7.4, 10.4, 10, 6.6, 10], '#efe8d6'),
  R(6.4, 5.8, 1.5, 1.7, '#241a12'), R(9.1, 5.8, 1.5, 1.7, '#241a12'),
  C(7.1, 6.5, 0.6, '#c9a227'), C(9.8, 6.5, 0.6, '#c9a227'),
  T(8, 7.6, 8.5, 8.6, 9, 7.6, '#241a12'),
  R(6.7, 9.4, 3.6, 0.5, '#8a7d68'),
];

// ---------- Stage 2 (Sundered Sands) shared bodies ----------
const jackalBody = [
  // Raised curled tail
  P([3, 8, 0, 2, 2, 2, 5, 8], '#8a6a3a'), P([3, 8, 1, 3, 4, 7], '#6b4f2a'),
  C(7, 8, 3.4, '#8a6a3a'), C(7, 8, 3, '#7a5c30'),
  // Body
  P([4, 5.5, 18, 5, 22, 8, 19, 11.5, 5, 11.5], '#8a6a3a'),
  P([4, 5.5, 11, 6, 11, 11.5, 5, 11.5], '#7a5c30'),
  R(5, 10.4, 14, 1, '#c9a878'),
  R(9, 6, 4, 1, '#6b4f2a'), R(13, 6.4, 3, 0.8, '#6b4f2a'),
  // Neck + head + snout
  P([16, 4, 21, 5, 23, 8.5, 18, 9, 16, 6.5], '#8a6a3a'),
  T(20.5, 5.5, 25.5, 7.5, 20.5, 9.5, '#8a6a3a'),
  R(22, 8, 3.4, 0.9, '#2a1d10'),
  // Ears + eye
  T(16.4, 3.5, 17.6, 0, 19, 4, '#8a6a3a'), T(16.8, 3.6, 17.7, 1, 18.6, 4, '#2a1d10'),
  T(18.4, 3.4, 19.6, 0.4, 20.6, 4.2, '#8a6a3a'),
  C(20, 6, 0.95, '#f0a030'), C(20.2, 6.1, 0.4, '#1a0f08'),
];

const mummyBody = [
  // Raised throwing arm + curse orb
  R(15, 10, 2.4, 7, '#c9bfa8'), C(16.2, 10, 1.6, '#b8ae95'),
  R(15, 11, 2.4, 0.8, '#8a7d68'), R(15, 14, 2.4, 0.8, '#8a7d68'),
  C(16.5, 8.5, 2.2, 'rgba(122,201,90,0.4)'), C(16.5, 8.5, 1.2, '#8fd968'),
  // Left arm
  R(2.6, 11, 2.4, 8, '#c9bfa8'), C(3.8, 19, 1.6, '#b8ae95'),
  R(2.6, 13, 2.4, 0.8, '#8a7d68'), R(2.6, 16, 2.4, 0.8, '#8a7d68'),
  // Torso wrapped
  P([5, 11, 15, 11, 16, 24, 4, 24], '#c9bfa8'),
  P([5, 11, 10, 11, 10, 24, 4, 24], '#b8ae95'),
  R(4.5, 13, 11, 1.2, '#8a7d68'), R(4.5, 16, 11, 1.2, '#8a7d68'), R(4.5, 19, 11, 1.2, '#8a7d68'), R(4.5, 22, 11, 1.2, '#8a7d68'),
  T(4, 24, 5, 27, 7, 24, '#b8ae95'), T(8, 24, 9, 27, 11, 24, '#b8ae95'), T(12, 24, 13, 27, 15, 24, '#b8ae95'),
  // Head wrapped + glowing eyes
  C(10, 6.5, 4.2, '#c9bfa8'),
  R(6, 5.5, 8, 1.3, '#8a7d68'), R(6.5, 8.5, 7, 1.3, '#8a7d68'),
  R(7.4, 6.6, 1.9, 1.8, '#0e1a10'), R(10.7, 6.6, 1.9, 1.8, '#0e1a10'),
  C(8.35, 7.4, 0.8, '#8fd968'), C(11.65, 7.4, 0.8, '#8fd968'),
];

const sandGolemBody = [
  // Chunky arms
  R(0.5, 13, 4, 9, '#a37f4a'), C(2.5, 22, 2.4, '#8a6a3a'),
  R(23.5, 13, 4, 9, '#a37f4a'), C(25.5, 22, 2.4, '#8a6a3a'),
  R(1, 13, 4, 1, '#c2a06a'), R(24, 13, 4, 1, '#c2a06a'),
  // Torso
  P([3, 9, 25, 9, 27, 26, 1, 26], '#b8935a'),
  P([3, 9, 14, 9, 13, 26, 1, 26], '#a8824a'),
  R(1, 25, 26, 2, '#6b4f2a'),
  R(5, 12, 5, 5, '#a37f4a'), R(18, 12, 5, 5, '#a37f4a'), R(11, 16, 6, 4, '#a37f4a'),
  R(5, 12, 5, 1, '#c2a06a'), R(18, 12, 5, 1, '#c2a06a'),
  R(9, 11, 0.8, 14, '#6b4f2a'), R(16, 11, 0.8, 13, '#6b4f2a'),
  R(12, 20, 3, 0.8, '#f0a030'), R(13, 19, 0.8, 3, '#f0a030'),
  // Blocky head
  R(9, 3, 10, 7, '#b8935a'), R(9, 3, 10, 1, '#c2a06a'),
  R(10.5, 5, 2.4, 2.4, '#6b4f2a'), R(15, 5, 2.4, 2.4, '#6b4f2a'),
  C(11.7, 6.2, 1, '#f0a030'), C(16.2, 6.2, 1, '#f0a030'),
  R(11, 9, 6, 0.8, '#6b4f2a'),
];

const stoneGolemBody = [
  // Massive arms
  R(0, 13, 5, 10, '#5c584c'), C(2.5, 23, 3, '#4a463c'),
  R(25, 13, 5, 10, '#5c584c'), C(27.5, 23, 3, '#4a463c'),
  R(0.5, 13, 5, 1.2, '#78746a'), R(25, 13, 5, 1.2, '#78746a'),
  // Torso
  P([3, 9, 27, 9, 29, 27, 1, 27], '#6e6a5e'),
  P([3, 9, 15, 9, 14, 27, 1, 27], '#5c584c'),
  R(1, 26, 28, 2, '#3a372e'),
  R(5, 12, 6, 6, '#78746a'), R(19, 12, 6, 6, '#78746a'),
  R(5, 12, 6, 1, '#8f8b80'), R(19, 12, 6, 1, '#8f8b80'),
  // Energy core
  R(11, 15, 8, 6, '#2a2820'), C(15, 18, 2.6, '#6bd9c9'), C(15, 18, 1.4, '#b6f5ec'),
  R(15, 9, 0.8, 6, '#3a372e'), R(9, 20, 4, 0.8, '#6bd9c9'), R(18, 21, 4, 0.8, '#6bd9c9'),
  // Head
  R(9, 2, 12, 8, '#6e6a5e'), R(9, 2, 12, 1.2, '#8f8b80'),
  R(10.5, 4.5, 2.6, 2.6, '#2a2820'), R(17, 4.5, 2.6, 2.6, '#2a2820'),
  C(11.8, 5.8, 1.2, '#6bd9c9'), C(18.3, 5.8, 1.2, '#6bd9c9'),
  R(11, 9, 8, 0.8, '#3a372e'),
];

// ---------- Stage 3 (Underworld) shared bodies ----------
const hollowZombieBody = [
  R(0.6, 13, 2.6, 9, '#2e2140'), C(1.9, 22, 1.7, '#3a2a4a'),
  R(15, 12, 2.4, 8, '#2e2140'), C(16.2, 20, 1.6, '#3a2a4a'),
  P([4, 11, 15, 9, 16.5, 21, 3, 22], '#3a2a4a'),
  P([4, 11, 9, 10, 9, 22, 3, 22], '#2e2140'),
  P([6, 14.5, 13, 14.5, 12.5, 21, 6, 21], '#241a30'),
  R(7, 16, 5, 0.8, '#7ac95a'), R(7.4, 18, 4, 0.8, '#7ac95a'),
  C(6, 12, 1.6, '#7ac95a'), C(6, 12, 0.7, '#2a4a1e'),
  T(3, 22, 5, 25.5, 7, 22, '#2e2140'), T(8, 22, 10, 25.5, 12, 22, '#2e2140'), T(12, 21, 14, 24.5, 16, 21, '#2e2140'),
  C(11, 6.5, 4, '#4a3a5e'),
  P([7.5, 6.5, 15, 6.5, 14, 10.5, 8.5, 10.5], '#3d2f50'),
  R(8.6, 5, 1.5, 1.7, '#8fd968'), R(12, 5, 1.5, 1.7, '#8fd968'),
  R(9.1, 5.4, 0.7, 0.8, '#1a2e12'), R(12.5, 5.4, 0.7, 0.8, '#1a2e12'),
  R(8.6, 9.2, 4.4, 0.9, '#120a1e'),
  R(9, 8.8, 0.7, 1.4, '#b8b0a0'), R(10.6, 8.8, 0.7, 1.4, '#b8b0a0'), R(12.2, 8.8, 0.7, 1.4, '#b8b0a0'),
];

const pitDemonBody = [
  // Folded wings
  P([2, 10, 0, 4, 1, 14, 5, 16], '#3a0f1e'), P([20, 10, 22, 4, 21, 14, 17, 16], '#3a0f1e'),
  P([2, 10, 1, 12, 5, 15], '#4a1424'), P([20, 10, 21, 12, 17, 15], '#4a1424'),
  // Spiked tail
  P([11, 26, 18, 28, 21, 24], '#5a1428'), T(20, 25, 23, 23, 20.5, 26, '#2a0f14'),
  // Clawed arms
  R(1.5, 13, 2.8, 8, '#7a1f3a'), C(2.9, 21, 1.8, '#8a2848'),
  T(1.5, 22, 0.5, 24, 2.5, 23, '#e0d0d4'), T(3.5, 22, 4.5, 24, 2.8, 23, '#e0d0d4'),
  R(17.5, 13, 2.8, 8, '#7a1f3a'), C(18.9, 21, 1.8, '#8a2848'),
  T(17.5, 22, 16.5, 24, 18.5, 23, '#e0d0d4'), T(19.5, 22, 20.5, 24, 18.8, 23, '#e0d0d4'),
  // Torso
  P([5, 10, 17, 10, 18, 24, 4, 24], '#7a1f3a'),
  P([5, 10, 11, 10, 11, 24, 4, 24], '#661832'),
  R(8, 13, 6, 0.8, '#5a1428'), R(8, 16, 6, 0.8, '#5a1428'), R(8, 19, 6, 0.8, '#5a1428'),
  R(10.6, 12, 0.8, 12, '#5a1428'),
  C(11, 13, 1.4, '#f0a030'),
  // Head + horns
  C(11, 6, 4.2, '#8a2848'),
  P([7, 7, 15, 7, 14, 10.5, 8, 10.5], '#7a1f3a'),
  T(6.5, 4, 4, 0, 8, 4, '#2a0f14'), T(4, 0, 4.6, 2, 6.5, 4, '#3a1420'),
  T(15.5, 4, 18, 0, 14, 4, '#2a0f14'), T(18, 0, 17.4, 2, 15.5, 4, '#3a1420'),
  C(9.2, 6, 1, '#f0d040'), C(9.2, 6, 0.4, '#1a0f08'), C(12.8, 6, 1, '#f0d040'), C(12.8, 6, 0.4, '#1a0f08'),
  R(9, 9.4, 4, 0.8, '#1a0808'),
  T(9.4, 9.4, 9.8, 10.6, 10.2, 9.4, '#e0d0d4'), T(11.4, 9.4, 11.8, 10.6, 12.2, 9.4, '#e0d0d4'),
];

const minotaurBody = [
  // Greataxe
  R(24, 4, 2.4, 24, '#3a2a1a'),
  P([21, 3, 27, 2, 28, 9, 22, 10], '#8a929e'), P([22, 4, 26.5, 3.5, 27, 8, 22.5, 8.5], '#b8c0cc'),
  P([21, 20, 27, 21, 26, 27, 22, 26], '#8a929e'),
  // Left fist
  R(2, 13, 3.4, 8, '#6b4a34'), C(3.7, 21, 2.4, '#5c3f2a'),
  R(2.2, 13, 3.4, 1, '#7a5740'),
  // Torso
  P([4, 11, 23, 11, 25, 26, 2, 26], '#5c3a28'),
  P([4, 11, 14, 11, 13, 26, 2, 26], '#4e3122'),
  R(2, 24, 22, 2, '#2a1a10'),
  C(9, 15, 3, '#6b4a34'), C(18, 15, 3, '#6b4a34'),
  R(9, 19, 9, 0.8, '#4a2f1e'), R(9, 21, 9, 0.8, '#4a2f1e'),
  T(4, 11, 3, 9, 6, 11, '#4e3122'), T(21, 11, 23, 9, 19, 11, '#4e3122'),
  // Bull head
  C(13, 7.5, 5, '#5c3f2a'), C(13, 6.8, 4.6, '#6b4a34'),
  P([9, 9, 17, 9, 16, 13, 10, 13], '#7a5740'),
  R(10.5, 11.5, 5, 0.8, '#3a251a'),
  C(11, 12.2, 0.7, '#2a1a10'), C(15, 12.2, 0.7, '#2a1a10'),
  C(11.5, 11.8, 1, '#c9a878'),
  // Horns
  P([8, 6, 3, 3, 1, 5, 6, 8], '#e8e0cc'), P([8, 6, 3.5, 3.6, 5.5, 7], '#c9bfa8'),
  P([18, 6, 23, 3, 25, 5, 20, 8], '#e8e0cc'), P([18, 6, 22.5, 3.6, 20.5, 7], '#c9bfa8'),
  R(9.6, 6.4, 1.8, 1.5, '#1a0f08'), R(15.6, 6.4, 1.8, 1.5, '#1a0f08'),
  C(10.5, 7, 0.7, '#f0a030'), C(16.5, 7, 0.7, '#f0a030'),
  R(9, 4.6, 8, 0.8, '#4e3122'),
];

// ---------- Boss shared bodies (legs + eye-glow animate per frame) ----------
// Skeleton King: a hulking skeletal lord with a massive crowned skull, bulky ribcage,
// and decaying steel plate only partially strapped on, hefting a great cleaver.
const skeletonKingBody = [
  R(28, 3, 4, 23, '#5c584c'), R(28.7, 3, 1.3, 23, '#78746a'),
  P([27.4, 3, 32.6, 3, 33.4, 7, 26.6, 7], '#5c584c'),
  R(26.5, 25, 6.4, 2, '#3a2d20'), R(29, 27, 2, 5, '#4a3826'),
  R(1.4, 15, 3, 12, '#c9bfa8'), C(2.9, 27, 2, '#c9bfa8'),
  R(27, 14, 3, 12, '#c9bfa8'), C(28.5, 25, 2, '#c9bfa8'),
  P([6, 15, 28, 15, 26, 31, 8, 31], '#d8cfb6'),
  R(16.4, 15, 1.4, 16, '#8a7d68'),
  R(8, 17.5, 18, 1.3, '#8a7d68'), R(8.6, 20.5, 17, 1.3, '#8a7d68'), R(9.2, 23.5, 16, 1.3, '#8a7d68'), R(9.8, 26.5, 15, 1.3, '#8a7d68'),
  P([6, 14, 17, 14, 16, 28, 7, 27], '#4a463c'),
  P([6, 14, 11, 14, 11, 27, 7, 27], '#5c584c'),
  R(7.5, 16.5, 8, 1, '#6b4a34'), C(9, 21, 1, '#241a12'), R(6, 26, 11, 1.4, '#332f27'),
  P([9, 31, 25, 31, 23, 35, 11, 35], '#c9bfa8'), R(11, 32, 12, 1, '#8a7d68'),
  C(27, 12.5, 5.2, '#4a463c'), C(27, 11.5, 3.6, '#6b6558'),
  R(22.5, 13, 8.4, 1.6, '#332f27'), R(23.5, 9.6, 6, 1, '#6b4a34'),
  T(24.6, 8, 27, 4.5, 29.4, 8, '#4a463c'),
  C(7, 13, 3.6, '#d8cfb6'),
  C(17, 8, 7.2, '#e8e0cc'),
  P([11, 9, 23, 9, 21, 15.5, 13, 15.5], '#e0d8c2'),
  T(16.2, 9.5, 17, 12, 17.8, 9.5, '#8a7d68'),
  R(12, 14, 10, 1, '#8a7d68'),
  R(12.6, 13.2, 0.9, 2.2, '#e8e0cc'), R(14.4, 13.2, 0.9, 2.2, '#e8e0cc'), R(16.2, 13.2, 0.9, 2.2, '#e8e0cc'), R(18, 13.2, 0.9, 2.2, '#e8e0cc'), R(19.8, 13.2, 0.9, 2.2, '#e8e0cc'),
  R(11.5, 3, 11, 0.9, '#c9bfa8'), R(19, 4.2, 4, 0.7, '#8a7d68'),
  R(11, 1.8, 12, 2, '#4a463c'), R(11, 1.8, 12, 0.7, '#6b6558'),
  T(12, 1.8, 12.5, 0, 13.5, 1.8, '#5c584c'), T(16.5, 1.8, 17, 0, 17.5, 1.8, '#5c584c'), T(20.5, 1.8, 21.5, 0, 22, 1.8, '#5c584c'),
  C(17, 2.9, 1, '#c94a3f'),
];

// Sand Pharaoh: golden nemes headdress with lapis stripes, a broad pectoral collar,
// crook & flail, false beard, and a gilded wrapped body.
const sandPharaohBody = [
  R(3, 10, 1.8, 18, '#d4af37'), P([2.4, 10, 3, 6, 6, 8, 4.8, 10], '#d4af37'),
  R(28.4, 10, 1.8, 18, '#d4af37'), R(27, 7, 4.6, 1.6, '#d4af37'),
  C(27.4, 6.4, 1, '#d4af37'), C(29.4, 6, 1, '#d4af37'), C(31.4, 6.4, 1, '#d4af37'),
  R(4.5, 16, 3, 11, '#c9bfa8'), R(26.5, 16, 3, 11, '#c9bfa8'),
  R(4.5, 18, 3, 1, '#d4af37'), R(4.5, 22, 3, 1, '#d4af37'), R(26.5, 18, 3, 1, '#d4af37'), R(26.5, 22, 3, 1, '#d4af37'),
  P([8, 16, 26, 16, 24, 35, 10, 35], '#c9bfa8'),
  R(9, 20, 16, 1.3, '#a89468'), R(9.5, 24, 15, 1.3, '#a89468'), R(10, 28, 14, 1.3, '#a89468'), R(10.5, 32, 13, 1.3, '#a89468'),
  P([9, 15, 25, 15, 26, 20, 20, 22, 14, 22, 8, 20], '#d4af37'),
  P([10, 15.5, 24, 15.5, 24.5, 19, 19.5, 20.5, 14.5, 20.5, 9.5, 19], '#f0c56a'),
  R(11, 16.5, 12, 0.8, '#2a3a5e'), C(17, 20, 1.5, '#3a5ea0'),
  R(9, 34, 16, 1.5, '#d4af37'),
  P([6, 8, 12, 6, 13, 22, 6, 24], '#d4af37'), P([28, 8, 22, 6, 21, 22, 28, 24], '#d4af37'),
  R(6.5, 10, 6, 1, '#2a3a5e'), R(6.5, 13, 6, 1, '#2a3a5e'), R(6.5, 16, 6, 1, '#2a3a5e'), R(6.5, 19, 6, 1, '#2a3a5e'),
  R(21.5, 10, 6, 1, '#2a3a5e'), R(21.5, 13, 6, 1, '#2a3a5e'), R(21.5, 16, 6, 1, '#2a3a5e'), R(21.5, 19, 6, 1, '#2a3a5e'),
  P([10, 6, 24, 6, 22, 2, 12, 2], '#d4af37'), R(10, 5, 14, 1.2, '#2a3a5e'),
  T(17, 2.5, 16, 0.5, 18, 0.5, '#d4af37'), C(17, 1.4, 0.9, '#3a5ea0'),
  C(17, 9.5, 5, '#e6c46e'), R(13, 14, 8, 1, '#c9a850'),
  R(15.6, 14, 2.8, 6, '#2a3a5e'), R(16.4, 14, 1.2, 6, '#d4af37'),
];

// Hollow Sovereign: a spectral underworld king — tattered violet royal robe over a
// hollow green-lit ribcage, skull face under a ghostly veil and green-gem crown.
const hollowSovereignBody = [
  R(28, 4, 2, 24, '#3a2d1a'), R(28.4, 4, 0.8, 24, '#5a4a30'),
  C(29, 3, 2.6, 'rgba(122,201,90,0.4)'), C(29, 3, 1.4, '#8fd968'),
  P([4, 14, 30, 14, 33, 40, 1, 40], '#3a2050'),
  P([4, 14, 12, 14, 11, 40, 1, 40], '#2e1740'),
  R(16.4, 15, 1.4, 25, '#4a2f6e'),
  P([7, 13, 27, 13, 25, 18, 9, 18], '#5a3d78'), R(9, 13.5, 16, 1, '#8a6ab0'),
  P([13, 18, 21, 18, 20, 30, 14, 30], '#1a0f28'),
  R(14, 20, 6, 1, '#4a2f6e'), R(14, 23, 6, 1, '#4a2f6e'), R(14.5, 26, 5, 1, '#4a2f6e'),
  C(17, 24, 1.6, 'rgba(122,201,90,0.5)'), C(17, 24, 0.8, '#8fd968'),
  P([2, 15, 7, 15, 6, 28, 1, 27], '#3a2050'), C(4, 28, 1.6, '#c9bfa8'),
  P([27, 15, 32, 15, 32, 27, 27, 28], '#3a2050'), C(30, 27, 1.6, '#c9bfa8'),
  C(17, 8, 5.6, '#c9bfa8'),
  P([12.4, 9, 21.6, 9, 20, 13.5, 14, 13.5], '#b8b0a0'),
  T(16.3, 9, 17, 11, 17.7, 9, '#4a2f6e'), R(13, 12.5, 8, 0.8, '#8a7d68'),
  P([10, 10, 8, 3, 12, 1, 17, 0, 22, 1, 26, 3, 24, 10], '#2e1740'),
  P([10.5, 9, 9, 4, 13, 2, 17, 1, 21, 2, 25, 4, 23.5, 9], 'rgba(74,47,110,0.5)'),
  R(11, 1.5, 12, 2, '#4a2f6e'),
  T(11.5, 1.5, 12, 0, 13, 1.5, '#6b4082'), T(16.5, 1.5, 17, 0, 17.5, 1.5, '#6b4082'), T(20.5, 1.5, 21, 0, 21.5, 1.5, '#6b4082'),
  C(17, 2.5, 1, '#8fd968'),
];

// ---------- Plague Doctor ----------
// Waxed leather coat over a pale mask. Muted greens and bone so he reads as a physician of
// the dying rather than another armoured fighter.
const PLAGUE = {
  coatDark: '#2b3327',
  coat: '#3c4a35',
  coatLit: '#4e6043',
  leather: '#5a4630',
  mask: '#d9cfae',
  maskShade: '#b3a887',
  lens: '#2a2a30',
  glass: '#7fa0a8',
  steel: '#cfd8e4',
};

const plagueLegs = (lx, rx, stride) => [
  R(lx - stride, 44, 4, 10, PLAGUE.coatDark),
  R(rx + stride, 44, 4, 10, PLAGUE.coatDark),
  R(lx - stride - 0.5, 52, 5, 3, PLAGUE.leather),   // boots
  R(rx + stride - 0.5, 52, 5, 3, PLAGUE.leather),
];

const plagueBody = [
  // Long coat, flaring toward the hem.
  P([13, 20, 27, 20, 29, 45, 11, 45], PLAGUE.coat),
  P([13, 20, 20, 20, 20, 45, 11, 45], PLAGUE.coatDark),   // shadowed side
  R(12.5, 30, 15, 1.6, PLAGUE.leather),                    // belt
  P([13, 20, 27, 20, 25, 26, 15, 26], PLAGUE.coatLit),     // shoulder cape
  // Head + wide brim.
  R(14, 8, 12, 2, PLAGUE.coatDark),                        // hat brim
  R(16.5, 3.5, 7, 5, PLAGUE.coatDark),                     // crown
  C(20, 13.5, 4.6, PLAGUE.mask),                           // mask
  C(21.6, 13.2, 1.5, PLAGUE.lens),                         // eye lens
  C(18.4, 13.2, 1.5, PLAGUE.lens),
  T(20, 15, 27.5, 17.5, 20.5, 18.5, PLAGUE.maskShade),     // beak
];

const plagueMaskFront = [
  C(20, 13.5, 4.8, PLAGUE.mask),
  C(22, 13, 1.6, PLAGUE.glass),
  C(18, 13, 1.6, PLAGUE.glass),
  T(20, 15.5, 21.6, 20, 18.4, 20, PLAGUE.maskShade),       // beak pointing at the viewer
];

const plagueBackOverlay = [
  C(20, 13, 4.8, PLAGUE.coatDark),                         // back of the hood/hat
  R(15, 21, 10, 18, PLAGUE.coatDark),                      // cape covering the back
];

// Scythe held at the side; `swing` shifts the haft slightly between frames.
const plagueScythe = (swing) => [
  P([27, 12 + swing, 29, 12 + swing, 25, 46 + swing, 23, 46 + swing], PLAGUE.leather),
  P([26, 12 + swing, 34, 8 + swing, 33, 12 + swing, 27.5, 15 + swing], PLAGUE.steel),
];

const SPRITE_DEFS = {
  warrior: {
    w: 24, h: 34, frameDuration: 260,
    // The first character drawn for the eight-direction pipeline: a real view for every
    // facing, so nothing is mirrored or borrowed, plus a dedicated portrait bust for the
    // menus. The procedural shapes below remain as the fallback if a file goes missing.
    images: {
      front:     'assets/sprites/warrior_front.png',
      right_45:  'assets/sprites/warrior_right_45.png',
      right:     'assets/sprites/warrior_right.png',
      right_135: 'assets/sprites/warrior_right_135.png',
      back:      'assets/sprites/warrior_back.png',
      left_135:  'assets/sprites/warrior_left_135.png',
      left:      'assets/sprites/warrior_left.png',
      left_45:   'assets/sprites/warrior_left_45.png',
      portrait:  'assets/sprites/warrior_portrait.png',
    },
    // Two frames per facing, 37x64 each in a 74x64 strip. Frame 1 is the drawn art; frame 2
    // is a derived passing pose from tools/make_walk_frame.py — legs converging under the
    // body with a 1px lift, or on the profiles (where one leg hides the other and converging
    // is meaningless) a bob and head-settle alone. The portrait gets the head settle only:
    // it is a bust, so there is no stride to animate. Originals are kept in
    // assets/sprites/source/ so a hand-drawn frame 2 can replace any of these later.
    imageFrames: 2,
    frames: [
      [
        R(8.5, 28, 3, 5.5, '#4a4f59'), R(12.5, 28, 3, 5.5, '#4a4f59'),
        R(9, 29, 1, 4, '#6b7280'), R(13, 29, 1, 4, '#6b7280'),
        R(8, 33, 3.6, 1.3, '#23232a'), R(12.3, 33, 3.6, 1.3, '#23232a'),
        ...knightTorso,
      ],
      [
        R(7.7, 28, 3, 5.5, '#4a4f59'), R(13.3, 28, 3, 5.5, '#4a4f59'),
        R(8.2, 29, 1, 4, '#6b7280'), R(13.8, 29, 1, 4, '#6b7280'),
        R(7.2, 33, 3.6, 1.3, '#23232a'), R(13.1, 33, 3.6, 1.3, '#23232a'),
        ...knightTorso,
      ],
    ],
  },
  sorceress: {
    // Six hand-drawn angles, and uniquely both HANDED profiles: left and right are separate
    // drawings rather than one sheet mirrored, so her staff stays in the same hand whichever
    // way she travels. front/back are head-on and never mirrored.
    //
    // No rear three-quarter (back135) in this set, so it falls back to the profile — see
    // DIR_FALLBACK. Drop a sorceress_back135.png in and it is picked up with no code change.
    images: {
      front:   'assets/sprites/sorceress_front.png',
      front45: 'assets/sprites/sorceress_front45.png',
      side:    'assets/sprites/sorceress_side.png',
      left45:  'assets/sprites/sorceress_left45.png',
      left:    'assets/sprites/sorceress_left.png',
      back:    'assets/sprites/sorceress_back.png',
      // Dedicated menu pose. Optional for every sprite — drop a file in and name it here and
      // the portraits pick it up; leave it out and they keep using the front walk frame.
      // Two frames like the rest of her, but a bust has no stride: frame 2 is the head settling
      // by 1px against the shoulders, nothing else.
      portrait: 'assets/sprites/sorceress_portrait.png',
    },
    // A single number applies to every sheet. Use a map when the art does not animate
    // uniformly, e.g. { default: 2, front: 4, portrait: 1 }.
    imageFrames: 2,
    // She hovers rather than walks — see drawPlayer().
    floats: true,
    // Reads 15% larger than the other classes.
    displayScale: 1.15,
    w: 24, h: 34, frameDuration: 480,
    // Hand-drawn art; procedural shapes below stay as the fallback if a file is missing.
    // Side sheet faces RIGHT — the engine mirrors it for leftward movement.
    frames: [
      [
        R(8.2, 30, 3, 3, '#3d2758'), R(12.8, 30, 3, 3, '#3d2758'),
        ...sorceressBody,
        C(19.9, 3.5, 3.4, 'rgba(107,217,224,0.28)'), C(19.9, 3.5, 2, '#6bd9e0'), C(19.2, 2.9, 0.7, '#d0f7fa'),
      ],
      [
        R(8.6, 30, 3, 3, '#3d2758'), R(12.4, 30, 3, 3, '#3d2758'),
        ...sorceressBody,
        C(19.9, 3.5, 4.4, 'rgba(107,217,224,0.42)'), C(19.9, 3.5, 2.6, '#a8f0f5'), C(19.1, 2.8, 0.9, '#eafdff'),
      ],
    ],
  },
  flameSkull: {
    // A weathered skull wreathed in fire. Style probe for the reference art direction:
    // a high tonal count on the bone (5 steps, warm-grey through cream) with a saturated
    // fire ramp behind it. The flames are redrawn per frame so they lick and flicker.
    w: 26, h: 30, frameDuration: 130,
    // Hand-drawn flicker frames, authored not derived (tools/make_sheet.py stitched them).
    // No facings: a floating skull is drawn head-on and serves every direction.
    //
    // fitExact: the art is 64px tall but a cinder skull draws at radius*3.8*scale = 74.1px.
    // Integer snapping would round 1.16x down to 1x and render it 14% too small.
    images: { side: 'assets/sprites/flameskull.png' },
    imageFrames: 2,
    fitExact: true,
    // Out of the menu carousel for the same reason as the bat: it floats and flickers rather
    // than walking, so it does not belong in a procession along a ground line.
    noShowcase: true,
    frames: [
      [
        // --- fire behind the skull (tall licks) ---
        P([4, 20, 6, 9, 4.5, 3, 8, 8, 9, 1, 11, 7], '#b03c10'),
        P([22, 20, 20, 9, 21.5, 3, 18, 8, 17, 1.5, 15, 7], '#b03c10'),
        P([5.5, 19, 7.5, 10, 6.5, 5, 9.5, 9], '#e0691a'),
        P([20.5, 19, 18.5, 10, 19.5, 5, 16.5, 9], '#e0691a'),
        P([8, 6, 10, 2, 11.5, 6.5], '#f5a03a'),
        P([18, 6, 16, 2, 14.5, 6.5], '#f5a03a'),
        P([11, 4, 13, 0.5, 15, 4, 13, 7], '#ffd06a'),
        ...flameSkullBone,
        // embers drifting up
        R(7, 4, 1, 1, '#ffbe5c'), R(19, 6, 1, 1, '#ffbe5c'), R(13, 1.5, 1, 1, '#ffe6a0'),
      ],
      [
        P([4, 20, 5.5, 10, 5.5, 4, 8.5, 9, 8, 2, 11, 8], '#b03c10'),
        P([22, 20, 20.5, 10, 20.5, 4, 17.5, 9, 18, 2, 15, 8], '#b03c10'),
        P([5.5, 19, 7, 11, 7.5, 6, 10, 10], '#e0691a'),
        P([20.5, 19, 19, 11, 18.5, 6, 16, 10], '#e0691a'),
        P([8.5, 7, 9.5, 3, 11, 7.5], '#f5a03a'),
        P([17.5, 7, 16.5, 3, 15, 7.5], '#f5a03a'),
        P([11.2, 5, 13, 1.8, 14.8, 5, 13, 8], '#ffd06a'),
        ...flameSkullBone,
        R(8, 2.5, 1, 1, '#ffbe5c'), R(18, 4, 1, 1, '#ffbe5c'), R(12, 0.8, 1, 1, '#ffe6a0'),
      ],
    ],
  },
  skeleton: {
    w: 40, h: 56, frameDuration: 260, // a loose, rattling gait
    // Hand-drawn art; the procedural shapes below stay as the fallback if a file is missing.
    // Side sheet faces RIGHT — the engine mirrors it for leftward movement.
    images: {
      side:  'assets/sprites/skeleton_right.png',
      front: 'assets/sprites/skeleton_front.png',
      back:  'assets/sprites/skeleton_back.png',
    },
    imageFrames: 2,
    frames: [
      [
        ...skeletonLegs(16.4, 20.2, 0),
        ...skeletonBody,
        // a spare bone held ready at his side
        R(29, 30, 2.2, 7, SKEL.lit), C(29.9, 29.6, 1.5, SKEL.hi), C(29.9, 37.2, 1.5, SKEL.hi),
      ],
      [
        ...skeletonLegs(16.4, 20.2, 0.9),
        ...skeletonBody,
        R(29, 28.6, 2.2, 7, SKEL.lit), C(29.9, 28.2, 1.5, SKEL.hi), C(29.9, 35.8, 1.5, SKEL.hi),
      ],
    ],
    // Facing the camera — squared-up, both arms visible, sockets front-on.
    framesFront: [
      [...skeletonLegs(16.4, 20.2, 0), ...skeletonBody],
      [...skeletonLegs(16.4, 20.2, 0.7), ...skeletonBody],
    ],
    // Facing away — back of the cranium, spine and shoulder blades instead of ribs.
    framesBack: [
      [
        ...skeletonLegs(16.4, 20.2, 0), ...skeletonBody, ...skeletonBackOverlay,
        R(19.4, 17, 1.8, 14, SKEL.lit),                                   // spine
        R(15, 18.4, 4.4, 3.4, SKEL.dark), R(20.6, 18.4, 4.4, 3.4, SKEL.dark), // shoulder blades
      ],
      [
        ...skeletonLegs(16.4, 20.2, 0.7), ...skeletonBody, ...skeletonBackOverlay,
        R(19.4, 17, 1.8, 14, SKEL.lit),
        R(15, 18.4, 4.4, 3.4, SKEL.dark), R(20.6, 18.4, 4.4, 3.4, SKEL.dark),
      ],
    ],
  },
  shinobi: {
    w: 40, h: 56, frameDuration: 200, // double-res + a quicker cycle — she's the agile one
    // Hand-drawn art; the procedural shapes below remain as the fallback if a file is missing.
    // Side sheet faces RIGHT — the engine mirrors it for leftward movement.
    images: {
      side:  'assets/sprites/shinobi_right.png',
      front: 'assets/sprites/shinobi_front.png',
      back:  'assets/sprites/shinobi_back.png',
    },
    imageFrames: 2,
    frames: [
      [
        // trailing wrap-ends behind her, swept back
        P([14, 20, 5, 13.5, 2.4, 16.5, 13, 23], INK.mid),
        P([14, 25, 6.5, 22.5, 3.6, 26, 13.5, 28.5], INK.dark),
        // full wrapped legs (hip down to the ankle) + tabi boots
        R(16.2, 34, 4, 18, INK.dark), R(20, 34, 4, 18, INK.dark),
        R(16.2, 34, 1.5, 18, INK.black), R(20, 34, 1.5, 18, INK.black),
        R(16.2, 41, 4, 0.8, INK.mid), R(20, 41, 4, 0.8, INK.mid),   // knee wrap band
        R(16.2, 46.5, 4, 0.8, INK.mid), R(20, 46.5, 4, 0.8, INK.mid),
        R(15.4, 51.5, 4.8, 2.8, INK.black), R(20, 51.5, 4.8, 2.8, INK.black),
        R(15.4, 53.7, 4.8, 0.8, INK.mid), R(20, 53.7, 4.8, 0.8, INK.mid),
        ...shinobiBody,
      ],
      [
        // ...flicking the other way on frame two so they flutter as she runs
        P([14, 20, 5.5, 16.5, 3, 19.5, 13, 23], INK.mid),
        P([14, 25, 7, 26.5, 4.8, 30.5, 13.5, 28.5], INK.dark),
        R(15.6, 34, 4, 18, INK.dark), R(20.6, 34, 4, 18, INK.dark),
        R(15.6, 34, 1.5, 18, INK.black), R(20.6, 34, 1.5, 18, INK.black),
        R(15.6, 41, 4, 0.8, INK.mid), R(20.6, 41, 4, 0.8, INK.mid),
        R(15.6, 46.5, 4, 0.8, INK.mid), R(20.6, 46.5, 4, 0.8, INK.mid),
        R(14.8, 51.5, 4.8, 2.8, INK.black), R(20.4, 51.5, 4.8, 2.8, INK.black),
        R(14.8, 53.7, 4.8, 0.8, INK.mid), R(20.4, 53.7, 4.8, 0.8, INK.mid),
        ...shinobiBody,
      ],
    ],
    // Facing the camera: squared-up stance, both wrap-tails peeking out either side.
    framesFront: [
      [
        P([13.6, 20, 4.6, 15, 2.4, 18, 13, 23], INK.mid),
        P([26.4, 20, 35.4, 15, 37.6, 18, 27, 23], INK.mid),
        ...shinobiLegs(16.4, 20.2, 0),
        ...shinobiBody,
      ],
      [
        P([13.6, 20, 5.2, 17.5, 3, 20.5, 13, 23], INK.mid),
        P([26.4, 20, 34.8, 17.5, 37, 20.5, 27, 23], INK.mid),
        ...shinobiLegs(16.4, 20.2, 0.6),
        ...shinobiBody,
      ],
    ],
    // Facing away: same silhouette, but the eye slit is covered by the back of the hood and
    // the knotted wrap-tails trail down the spine.
    framesBack: [
      [
        ...shinobiLegs(16.4, 20.2, 0),
        ...shinobiBody,
        ...shinobiBackOverlay,
        P([19, 17, 16.5, 30, 18.5, 31, 20.5, 18], INK.mid),
        P([21, 17, 23.5, 29, 21.5, 30.5, 19.6, 18], INK.dark),
      ],
      [
        ...shinobiLegs(16.4, 20.2, 0.6),
        ...shinobiBody,
        ...shinobiBackOverlay,
        P([19, 17, 17.5, 30.5, 19.5, 31.5, 20.5, 18], INK.mid),
        P([21, 17, 22.5, 30, 20.5, 31, 19.6, 18], INK.dark),
      ],
    ],
  },
  plaguedoctor: {
    // 40x56 like the other later characters, so hand-drawn art can slot straight in at the
    // 64px spec later. Silhouette reads as: wide brim, long beak, waxed coat, scythe haft.
    w: 40, h: 56, frameDuration: 250,
    // MIXED FRAME SIZES, on purpose and temporarily. The three cardinals are the original
    // 37x64 art; the four diagonals were drawn later at 54x96, the spec the marked and the
    // hollowed use. Both fill their canvas, so it is the same figure at 1.5x the pixel density
    // rather than a bigger one.
    //
    // This renders at the right SIZE — spriteQuad takes the height from sprite.h (sampled from
    // `right`) and the width from the frame actually being drawn, which is the same path
    // Akhmet's 2x portrait already goes through. What it costs is crispness: hand-drawn art
    // snaps to a whole-number scale against sprite.h=64, so the cardinals get exact NxN blocks
    // while the 96-tall diagonals are squeezed into that 64-tall box at a fractional ratio.
    // trimSprite also bows out on mixed sizes — free here, since his art fills the frame edge
    // to edge and the trim was already removing nothing.
    //
    // Redrawing front/back/right at 54x96 makes sprite.h 96 and every facing snaps crisp with
    // no code change. No `left` art in either spec: it mirrors `right`, as it always has.
    images: {
      front:     'assets/sprites/plaguedoctor_front.png',
      right_45:  'assets/sprites/plaguedoctor_right_45.png',
      side:      'assets/sprites/plaguedoctor_right.png',
      right_135: 'assets/sprites/plaguedoctor_right_135.png',
      back:      'assets/sprites/plaguedoctor_back.png',
      left_135:  'assets/sprites/plaguedoctor_left_135.png',
      left_45:   'assets/sprites/plaguedoctor_left_45.png',
    },
    imageFrames: 2,
    frames: [
      [...plagueLegs(15.5, 21, 0), ...plagueBody, ...plagueScythe(0)],
      [...plagueLegs(15.5, 21, 0.8), ...plagueBody, ...plagueScythe(0.5)],
    ],
    framesFront: [
      [...plagueLegs(15.5, 21, 0), ...plagueBody, ...plagueMaskFront],
      [...plagueLegs(15.5, 21, 0.8), ...plagueBody, ...plagueMaskFront],
    ],
    framesBack: [
      [...plagueLegs(15.5, 21, 0), ...plagueBody, ...plagueBackOverlay],
      [...plagueLegs(15.5, 21, 0.8), ...plagueBody, ...plagueBackOverlay],
    ],
  },
  // ---------- The void classes ----------
  // Hand-drawn art at 54x96, same spec as the marked below. Only the shinobi's third void
  // sibling is still on generated placeholder art (tools/make_void_classes.py); real art
  // overwrites the same paths and nothing here changes.
  //
  // SEVEN drawn facings, not eight: there is no left_135 art. DIR_FALLBACK covers it with a
  // MIRRORED right_135 — that candidate costs 0.5 against 45+ for any real neighbour, so it
  // wins outright, and a flipped rear three-quarter is exactly the right stand-in. Declaring a
  // flipped copy as a file would say the same thing while adding an asset that can go stale.
  // Drop a hollowed_left_135.png in and name it here and it takes over with no other change.
  hollowed: {
    w: 54, h: 96, frameDuration: 260,
    images: {
      front:     'assets/sprites/hollowed_front.png',
      right_45:  'assets/sprites/hollowed_right_45.png',
      right:     'assets/sprites/hollowed_right.png',
      right_135: 'assets/sprites/hollowed_right_135.png',
      back:      'assets/sprites/hollowed_back.png',
      left:      'assets/sprites/hollowed_left.png',
      left_45:   'assets/sprites/hollowed_left_45.png',
      // Hand-drawn bust, already at the walk frame's 54x96 — the size that matters, since
      // drawPortraitBust scales by the SPRITE's aspect rather than the portrait file's own.
      // Without a portrait at all it falls back to magnifying the top of the walk frame, which
      // on these tall figures zoomed ~6x and made the idle bob read as violent flashing.
      portrait:  'assets/sprites/hollowed_portrait.png',
    },
    // Frame 2 is derived by tools/make_walk_frame.py. `front` and the two pure profiles are
    // bob-only (--converge=0), the profiles because one leg hides the other. `back` and
    // right_45 needed --hip=57: he holds his arms clear of his body, so the hip detector read
    // an arm gap as a leg gap and put the hip at y≈32, which converged his chest instead of his
    // legs. The other facings detect it correctly at 52-58.
    imageFrames: 2,
    frames: [[], []],
  },
  // Hand-drawn art, and the first of the three void classes off the placeholder. A drawn view
  // for all EIGHT facings, so nothing is mirrored — `left`, `left_45` and `left_135` are their
  // own drawings rather than a flipped right, which is why they are listed explicitly instead of
  // being left to the mirror fallback.
  //
  // 54x96 frames rather than the 37x64 the other classes use. Nothing here has to agree with
  // that: loadSpriteImages takes w/h from the art itself (`fromImage`), so the `w`/`h` below
  // only ever describe the procedural fallback — which this class does not have. They are left
  // at the art's real size so the two cannot disagree.
  marked: {
    w: 54, h: 96, frameDuration: 260,
    images: {
      front:     'assets/sprites/marked_front.png',
      right_45:  'assets/sprites/marked_right_45.png',
      right:     'assets/sprites/marked_right.png',
      right_135: 'assets/sprites/marked_right_135.png',
      back:      'assets/sprites/marked_back.png',
      left_135:  'assets/sprites/marked_left_135.png',
      left:      'assets/sprites/marked_left.png',
      left_45:   'assets/sprites/marked_left_45.png',
      // Hand-drawn bust, already framed and already at the walk frame's 54x96 — which is the
      // size that matters, since drawPortraitBust scales by the SPRITE's aspect rather than the
      // portrait file's own. Without a portrait at all it falls back to magnifying the top of
      // the walk frame, which on these tall figures zoomed ~6x and made the idle bob read as
      // violent flashing on the class-select card.
      portrait:  'assets/sprites/marked_portrait.png',
    },
    // Frame 2 is derived by tools/make_walk_frame.py. The four diagonals and the back get the
    // full passing pose; `front` and the two pure profiles are bob-only (--converge=0), the
    // front because its stance leaves only 7 rows where the legs separate at all and the
    // profiles because one leg hides the other, so converging would smear the silhouette rather
    // than read as a stride. Originals are in assets/sprites/source/ for a hand-drawn frame 2.
    imageFrames: 2,
    frames: [[], []],
  },
  ranger: {
    w: 24, h: 34, frameDuration: 240,
    // Second character on the eight-direction pipeline. A drawn view for every facing, so
    // nothing is mirrored or borrowed — the left-hand views are their own art rather than a
    // flipped right, which is why `left`, `left_45` and `left_135` are listed explicitly
    // instead of being left to the mirror fallback. Plus a dedicated portrait bust for the
    // menus. The procedural shapes below remain as the fallback if a file goes missing.
    images: {
      front:     'assets/sprites/ranger_front.png',
      right_45:  'assets/sprites/ranger_right_45.png',
      right:     'assets/sprites/ranger_right.png',
      right_135: 'assets/sprites/ranger_right_135.png',
      back:      'assets/sprites/ranger_back.png',
      left_135:  'assets/sprites/ranger_left_135.png',
      left:      'assets/sprites/ranger_left.png',
      left_45:   'assets/sprites/ranger_left_45.png',
      portrait:  'assets/sprites/ranger_portrait.png',
    },
    // Two frames per facing, 37x64 each in a 74x64 strip — same treatment as the warrior.
    // Frame 2 is derived by tools/make_walk_frame.py: legs converging under the body with a
    // 1px lift, except on the two pure profiles, where one leg hides the other and converging
    // would just smear the silhouette — those get the lift and head-settle only. The portrait
    // gets the head settle alone, being a bust with no stride to animate. Originals are in
    // assets/sprites/source/ so a hand-drawn frame 2 can replace any of these later.
    imageFrames: 2,
    frames: [
      [
        R(8.2, 30, 3, 4, '#3a4a24'), R(12.8, 30, 3, 4, '#3a4a24'),
        R(7.8, 33, 3.4, 1.4, '#2a2018'), R(12.6, 33, 3.4, 1.4, '#2a2018'),
        ...rangerBody,
      ],
      [
        R(7.6, 30, 3, 4, '#3a4a24'), R(13.4, 30, 3, 4, '#3a4a24'),
        R(7.2, 33, 3.4, 1.4, '#2a2018'), R(13.2, 33, 3.4, 1.4, '#2a2018'),
        ...rangerBody,
      ],
    ],
  },
  zombie: {
    w: 28, h: 40, frameDuration: 320,
    // Hand-drawn art; procedural shapes below stay as the fallback if a file is missing.
    // fitExact: the art is 64px tall but a zombie draws at radius*3.8*scale = 85.5px. Integer
    // snapping would round that to 1x and render it 25% too small, so exact fit wins here and
    // the slight aliasing is accepted.
    images: {
      side:  'assets/sprites/zombie_right.png',
      front: 'assets/sprites/zombie_front.png',
      back:  'assets/sprites/zombie_back.png',
    },
    imageFrames: 2,
    fitExact: true,
    frames: [
      [
        R(8, 30, 4.6, 8, '#2a3018'), R(15, 31, 4.6, 7, '#2a3018'),
        R(8, 30, 1.6, 8, '#1d230f'), R(15, 31, 1.6, 7, '#1d230f'),
        R(7.4, 37.6, 5.4, 1.8, '#1a1410'), R(14.6, 37.6, 5.4, 1.8, '#1a1410'),
        ...zombieBody,
      ],
      [
        R(7.2, 31, 4.6, 7, '#2a3018'), R(15.6, 30, 4.6, 8, '#2a3018'),
        R(7.2, 31, 1.6, 7, '#1d230f'), R(15.6, 30, 1.6, 8, '#1d230f'),
        R(6.6, 37.6, 5.4, 1.8, '#1a1410'), R(15.2, 37.6, 5.4, 1.8, '#1a1410'),
        ...zombieBody,
      ],
    ],
  },
  bat: {
    w: 24, h: 18, frameDuration: 100,
    // Hand-drawn wing-flap frames. Unlike the walking characters these are authored, not
    // derived — the two poses ARE the animation, stitched by tools/make_sheet.py.
    //
    // No front/back sheets on purpose: the bat is drawn head-on and symmetric, so one view
    // serves every direction. Those facings mirror the side automatically, and because they
    // are not real facings the engine still h-flips by travel direction — harmless here.
    //
    // fitExact: the art is 37px tall but a bat draws at radius*3.8*scale = 51.3px. Integer
    // snapping would round 1.39x down to 1x and render it 28% too small.
    images: { side: 'assets/sprites/bat.png' },
    imageFrames: 2,
    fitExact: true,
    // Kept out of the menu carousel: that is a procession of figures walking a ground line,
    // and a hovering flyer with a wing-flap cycle reads as a mistake next to them.
    noShowcase: true,
    frames: [
      [
        P([12, 8, 1, 1, 4, 7, 7, 6, 9, 9], '#4a3a52'), P([12, 8, 23, 1, 20, 7, 17, 6, 15, 9], '#4a3a52'),
        P([12, 8, 4, 3, 7, 6, 9, 9], '#3a2d42'), P([12, 8, 20, 3, 17, 6, 15, 9], '#3a2d42'),
        C(12, 9.5, 3.6, '#2a1f30'), C(12, 8.5, 2.6, '#3a2d42'),
        T(9.5, 5, 10, 0.5, 11.5, 5, '#2a1f30'), T(12.5, 5, 14, 0.5, 14.5, 5, '#2a1f30'),
        C(10.6, 9, 0.9, '#e0857e'), C(13.4, 9, 0.9, '#e0857e'),
        T(11, 11, 12, 13, 13, 11, '#c9bfa8'),
      ],
      [
        P([12, 8, 3, 5, 7, 8, 9, 9], '#4a3a52'), P([12, 8, 21, 5, 17, 8, 15, 9], '#4a3a52'),
        C(12, 9.5, 3.6, '#2a1f30'), C(12, 8.5, 2.6, '#3a2d42'),
        T(9.5, 5, 10, 0.5, 11.5, 5, '#2a1f30'), T(12.5, 5, 14, 0.5, 14.5, 5, '#2a1f30'),
        C(10.6, 9, 0.9, '#e0857e'), C(13.4, 9, 0.9, '#e0857e'),
        T(11, 11, 12, 13, 13, 11, '#c9bfa8'),
      ],
      [
        P([12, 8, 2, 13, 6, 10, 9, 9], '#4a3a52'), P([12, 8, 22, 13, 18, 10, 15, 9], '#4a3a52'),
        P([12, 8, 6, 12, 9, 9], '#3a2d42'), P([12, 8, 18, 12, 15, 9], '#3a2d42'),
        C(12, 9.5, 3.6, '#2a1f30'), C(12, 8.5, 2.6, '#3a2d42'),
        T(9.5, 5, 10, 0.5, 11.5, 5, '#2a1f30'), T(12.5, 5, 14, 0.5, 14.5, 5, '#2a1f30'),
        C(10.6, 9, 1.2, '#f0a59e'), C(13.4, 9, 1.2, '#f0a59e'),
        T(11, 11, 12, 13, 13, 11, '#c9bfa8'),
      ],
    ],
  },
  skeletonArcher: {
    w: 20, h: 28, frameDuration: 280,
    // Hand-drawn profile, two frames. Side view only: the engine mirrors it by travel
    // direction, which is right for a figure drawn in profile.
    //
    // fitExact: the art is 64px tall but an archer draws at radius*3.8*scale = 74.1px. Integer
    // snapping would round 1.16x down to 1x and render it 14% too small.
    images: { side: 'assets/sprites/skeletonarcher.png' },
    imageFrames: 2,
    fitExact: true,
    // Drawn larger than its radius implies: 1.2 then a further 1.15 on top of that = 1.38.
    // Purely visual — the radius stays 13, so its hitbox, its collision footprint and its
    // 320px firing range are all unchanged.
    displayScale: 1.38,
    frames: [
      [
        R(7.4, 23, 1.7, 5, BONE), R(10.9, 23, 1.7, 5, BONE),
        R(6.8, 27.6, 2.8, 1, IRON), R(10.6, 27.6, 2.8, 1, IRON),
        ...boneArcherBody,
      ],
      [
        R(6.9, 23, 1.7, 5, BONE), R(11.4, 23, 1.7, 5, BONE),
        R(6.3, 27.6, 2.8, 1, IRON), R(11.1, 27.6, 2.8, 1, IRON),
        ...boneArcherBody,
      ],
    ],
  },
  hornedGoblin: {
    w: 26, h: 32, frameDuration: 300,
    // Hand-drawn, FOUR facings, ONE frame each. Everything else here ships two-frame sheets;
    // this art arrived as single stills, so imageFrames is 1 and he simply does not animate
    // yet. sliceSheet handles a count of 1, and dropping in 74px-wide two-frame sheets later
    // is a one-line change (imageFrames: 2) with no other edits.
    //
    // Single-frame art also keeps him out of the main-menu carousel automatically —
    // handDrawnSpriteIds() requires a side sheet with more than one frame, because that
    // procession is a walk cycle and a frozen figure would read as a bug.
    images: {
      side:    'assets/sprites/hornedgoblin_side.png',
      front45: 'assets/sprites/hornedgoblin_front45.png',
      front:   'assets/sprites/hornedgoblin_front.png',
      back:    'assets/sprites/hornedgoblin_back.png',
    },
    imageFrames: 1,
    // fitExact: the art is 64px tall but a goblin draws at radius*3.8*1.5 = 74.1px. Integer
    // snapping would round 1.16x down to 1x and render it 14% too small — which is exactly
    // the size match this enemy was added for.
    fitExact: true,
    // No back135/left/left45 art: DIR_FALLBACK sends back135 to the side view, and the two
    // left facings mirror side/front45 (LEFT_VARIANT finds no dedicated art, so the engine's
    // travel-direction flip stands). He is drawn near-symmetrically, so mirroring reads fine.
    frames: [
      [...gobLegs(0), ...gobBody],
      [...gobLegs(1), ...gobBody],
    ],
  },
  slime: {
    // Hand-drawn, four facings, ONE frame each — same arrangement as hornedGoblin, and the
    // same one-line upgrade path (imageFrames: 2) when animated sheets arrive.
    //
    // fitExact: the art is 64px tall but a slime draws at radius*3.8*1.5 = 96.9px. Integer
    // snapping would round 1.51x UP to 2x and render it a third too big — the one direction
    // the rounding hurts more than usual, since this is the size the Horned Goblin was
    // deliberately matched to.
    images: {
      side:    'assets/sprites/slime_side.png',
      front45: 'assets/sprites/slime_front45.png',
      front:   'assets/sprites/slime_front.png',
      back:    'assets/sprites/slime_back.png',
    },
    imageFrames: 1,
    fitExact: true,
    // Holds the slime at the apparent size it had as a procedural blob. Measured both ways:
    // the old shapes inked 73-82px over their squash cycle (mean ~77.5); the new art inks
    // 81-86 at radius 17 with no scale. 0.93 brings it back to ~77.5, so swapping the art
    // changes how the slime LOOKS and nothing about how big it reads — which also keeps the
    // Horned Goblin's deliberate size match to it intact.
    displayScale: 0.93,
    w: 24, h: 20, frameDuration: 420,
    frames: [
      [
        C(12, 12, 8.5, '#556b42'), C(12, 11.4, 7.8, '#5c7248'), C(12, 10.6, 6, '#688255'),
        C(9, 8, 2.6, '#8aa870'), C(15, 9, 1.4, '#8aa870'),
        C(7.5, 14, 1.4, '#4a5c38'), C(16, 15, 1.6, '#4a5c38'),
        C(10, 12, 1.1, '#1a2410'), C(14, 12, 1.1, '#1a2410'),
        C(10.3, 11.6, 0.4, '#cfe8b8'), C(14.3, 11.6, 0.4, '#cfe8b8'),
        R(11, 18, 2, 3, '#4a5c38'),
      ],
      [
        C(12, 13, 7.6, '#556b42'), C(4.5, 14, 3, '#556b42'), C(19.5, 14, 3, '#556b42'),
        C(12, 12.6, 7, '#5c7248'), C(12, 12, 5.4, '#688255'),
        C(9, 9.5, 2.6, '#8aa870'),
        C(10, 13, 1.1, '#1a2410'), C(14, 13, 1.1, '#1a2410'),
        C(6, 16, 1.4, '#4a5c38'), C(17, 16, 1.5, '#4a5c38'),
        R(11, 19, 2, 1, '#4a5c38'),
      ],
      [
        C(12, 11, 7.6, '#556b42'), C(12, 10.4, 6.8, '#5c7248'), C(12, 9.6, 5.2, '#688255'),
        C(9.5, 7, 2.8, '#8aa870'), C(15, 8, 1.4, '#8aa870'),
        C(10, 10.5, 1.1, '#1a2410'), C(14, 10.5, 1.1, '#1a2410'),
        C(10.3, 10.1, 0.4, '#cfe8b8'), C(14.3, 10.1, 0.4, '#cfe8b8'),
        R(11, 16, 2, 4, '#4a5c38'),
      ],
    ],
  },
  ogre: {
    w: 28, h: 32, frameDuration: 340,
    // Hand-drawn, two frames per facing. The front pair is authored (both poses drawn, looped
    // while he lumbers toward the camera); the side pair is the drawn profile plus a derived
    // passing frame. back/front45/back135 borrow the side view via DIR_FALLBACK and keep being
    // mirrored by travel direction, so they drop in cleanly when that art arrives.
    //
    // fitExact: the art is 64px tall but an ogre draws at radius*3.8*scale = 148.2px. Integer
    // snapping would round 2.32x down to 2x and render it 14% too small.
    images: {
      side:  'assets/sprites/ogre_side.png',
      front: 'assets/sprites/ogre_front.png',
    },
    imageFrames: 2,
    fitExact: true,
    frames: [
      [
        R(8, 25, 4.4, 7, '#4a3826'), R(15, 25, 4.4, 7, '#4a3826'),
        R(7.6, 31, 5, 1.4, '#2a1f14'), R(14.6, 31, 5, 1.4, '#2a1f14'),
        ...ogreBody,
      ],
      [
        R(7.4, 25, 4.4, 7, '#4a3826'), R(15.6, 25, 4.4, 7, '#4a3826'),
        R(7, 31, 5, 1.4, '#2a1f14'), R(15.2, 31, 5, 1.4, '#2a1f14'),
        ...ogreBody,
      ],
    ],
  },
  wraith: {
    // Restyled at 2x: layered translucent shroud (5 tones), a hollow skull-face deep inside
    // the cowl, and a ragged dissolving hem with drifting spirit motes.
    w: 32, h: 46, frameDuration: 360,
    frames: [
      [
        C(16, 26, 17, 'rgba(49,45,64,0.14)'),                       // ambient haze
        P([9, 13, 23, 13, 26, 32, 23, 38, 26, 44, 20, 39, 23, 45, 16, 39, 9, 45, 12, 39, 6, 44, 9, 38, 6, 32], '#3b3550'),
        P([9, 13, 16, 13, 16, 44, 9, 38, 6, 32], '#2a2639'),        // shaded left
        P([21, 14, 23, 13, 26, 32, 23, 34], '#4a4364'),             // lit right edge
        P([10.5, 4.5, 21.5, 4.5, 23, 16, 9, 16], '#332d47'),        // cowl
        P([10.5, 4.5, 16, 4.5, 16, 16, 9, 16], '#251f36'),
        C(16, 10, 4.6, '#0b0812'),                                  // hollow void inside the hood
        C(13.6, 9.6, 1.5, GLOW), C(18.4, 9.6, 1.5, GLOW),           // eyes
        C(13.6, 9.6, 0.7, '#fff2c4'), C(18.4, 9.6, 0.7, '#fff2c4'),
        R(21.6, 23, 2, 7.5, BONE), C(22.6, 30.5, 1.5, BONE),        // skeletal hand
        R(23.8, 27.5, 1.2, 3, BONE), R(20.4, 27.5, 1.2, 3, BONE),
        C(5.5, 29, 1.5, 'rgba(180,190,210,0.4)'), C(4, 33.5, 1.2, 'rgba(180,190,210,0.28)'),
      ],
      [
        C(16, 26, 17, 'rgba(49,45,64,0.14)'),
        P([9, 13, 23, 13, 26, 32, 22, 39, 26, 45, 19, 39, 22, 45, 16, 40, 10, 45, 13, 39, 6, 45, 9, 39, 6, 32], '#3b3550'),
        P([9, 13, 16, 13, 16, 45, 9, 39, 6, 32], '#2a2639'),
        P([21, 14, 23, 13, 26, 32, 23, 34], '#4a4364'),
        P([10.5, 4.5, 21.5, 4.5, 23, 16, 9, 16], '#332d47'),
        P([10.5, 4.5, 16, 4.5, 16, 16, 9, 16], '#251f36'),
        C(16, 10, 4.6, '#0b0812'),
        C(13.6, 9.6, 2, '#f0c56a'), C(18.4, 9.6, 2, '#f0c56a'),     // eyes flare on frame 2
        C(13.6, 9.6, 0.9, '#fff2c4'), C(18.4, 9.6, 0.9, '#fff2c4'),
        R(22.2, 21.5, 2, 7.5, BONE), C(23.2, 29, 1.5, BONE),
        R(24.4, 26, 1.2, 3, BONE), R(21, 26, 1.2, 3, BONE),
        C(5.5, 30.5, 1.5, 'rgba(180,190,210,0.45)'), C(4, 35, 1.2, 'rgba(180,190,210,0.32)'),
      ],
    ],
  },
  // ---------- Stage 3 (The Underworld) roster ----------
  hollowZombie: {
    w: 20, h: 28, frameDuration: 320,
    frames: [
      [
        R(6, 21, 3.4, 7, '#181022'), R(11, 22, 3.4, 6, '#181022'),
        R(5.6, 27.5, 4, 1.2, '#0e0818'), R(11, 27.5, 4, 1.2, '#0e0818'),
        ...hollowZombieBody,
      ],
      [
        R(5.4, 22, 3.4, 6, '#181022'), R(11.2, 21, 3.4, 7, '#181022'),
        R(5, 27.5, 4, 1.2, '#0e0818'), R(11.4, 27.5, 4, 1.2, '#0e0818'),
        ...hollowZombieBody,
      ],
    ],
  },
  wailingGhost: {
    w: 22, h: 28, frameDuration: 360,
    frames: [
      [
        C(11, 14, 11, 'rgba(140,200,170,0.14)'),
        P([6, 7, 16, 7, 18, 18, 15, 22, 17, 26, 13, 23, 15, 27, 11, 24, 7, 27, 9, 23, 5, 26, 7, 22, 4, 18], 'rgba(150,215,170,0.5)'),
        P([6, 7, 11, 7, 11, 24, 8, 24, 4, 18], 'rgba(110,180,140,0.4)'),
        P([7, 3, 15, 3, 16, 9, 6, 9], 'rgba(180,230,200,0.55)'),
        C(11, 8, 3, '#0e2a1e'),
        C(9, 7.5, 1.2, '#8fd968'), C(13, 7.5, 1.2, '#8fd968'),
        C(9, 7.5, 0.5, '#eafff0'), C(13, 7.5, 0.5, '#eafff0'),
        P([9.5, 10, 12.5, 10, 11, 13.5], '#0e2a1e'),
        C(6, 19, 1, 'rgba(200,240,215,0.4)'), C(16, 21, 0.9, 'rgba(200,240,215,0.35)'),
      ],
      [
        C(11, 14, 11, 'rgba(140,200,170,0.14)'),
        P([6, 7, 16, 7, 18, 18, 14, 24, 17, 27, 12, 24, 14, 28, 11, 25, 8, 28, 10, 24, 5, 27, 7, 23, 4, 18], 'rgba(160,225,180,0.55)'),
        P([6, 7, 11, 7, 11, 25, 8, 25, 4, 18], 'rgba(110,180,140,0.42)'),
        P([7, 3, 15, 3, 16, 9, 6, 9], 'rgba(180,230,200,0.6)'),
        C(11, 8, 3, '#0e2a1e'),
        C(9, 7.5, 1.5, '#a8f088'), C(13, 7.5, 1.5, '#a8f088'),
        C(9, 7.5, 0.6, '#eafff0'), C(13, 7.5, 0.6, '#eafff0'),
        P([9.2, 10.5, 12.8, 10.5, 11, 15], '#0e2a1e'),
        C(6, 20, 1, 'rgba(200,240,215,0.45)'), C(16, 22, 0.9, 'rgba(200,240,215,0.4)'),
      ],
    ],
  },
  pitDemon: {
    w: 22, h: 30, frameDuration: 280,
    frames: [
      [
        P([7, 24, 10, 24, 9, 30, 7, 29], '#5a1428'), P([12, 24, 15, 24, 15, 29, 13, 30], '#5a1428'),
        R(6.6, 29.5, 3, 1.2, '#1a0808'), R(12.6, 29.5, 3, 1.2, '#1a0808'),
        ...pitDemonBody,
      ],
      [
        P([6.4, 24, 9.4, 24, 8.4, 30, 6.4, 29], '#5a1428'), P([12.6, 24, 15.6, 24, 15.6, 29, 13.6, 30], '#5a1428'),
        R(6, 29.5, 3, 1.2, '#1a0808'), R(13.2, 29.5, 3, 1.2, '#1a0808'),
        ...pitDemonBody,
      ],
    ],
  },
  veinedEye: {
    w: 20, h: 28, frameDuration: 240,
    frames: [
      [
        P([10, 15, 7, 18, 9, 21, 6, 23, 10, 25, 8, 22, 11, 24, 9, 20], '#5c1f30'),
        P([10, 15, 13, 18, 11, 21, 14, 23, 10, 25, 12, 22, 9, 24, 11, 20], '#4a1626'),
        C(10, 9.5, 8, '#e0d6c0'),
        R(3, 8, 5, 0.7, '#a13a4a'), R(12, 7.5, 5, 0.7, '#a13a4a'), R(5, 13, 6, 0.6, '#a13a4a'),
        R(7, 4, 0.6, 4, '#a13a4a'), R(13, 5, 0.6, 4, '#a13a4a'),
        C(10, 9.5, 5, '#8a2848'), C(10, 9.5, 5, '#7a2040'),
        C(10, 9.5, 2.6, '#12060c'),
        C(8, 7.5, 1.2, 'rgba(255,255,255,0.6)'),
      ],
      [
        P([10, 15, 6, 17, 8, 20, 5, 22, 10, 26, 9, 22, 12, 24, 10, 20], '#5c1f30'),
        P([10, 15, 14, 17, 12, 20, 15, 22, 10, 26, 11, 22, 8, 24, 10, 20], '#4a1626'),
        C(10, 10, 8.3, '#e0d6c0'),
        R(3, 8.5, 5, 0.7, '#a13a4a'), R(12, 8, 5, 0.7, '#a13a4a'), R(5, 13.5, 6, 0.6, '#a13a4a'),
        R(7, 4.5, 0.6, 4, '#a13a4a'), R(13, 5.5, 0.6, 4, '#a13a4a'),
        C(10, 10, 5.4, '#8a2848'), C(10, 10, 5.4, '#7a2040'),
        C(11, 10.5, 2.8, '#12060c'),
        C(9, 8, 1.2, 'rgba(255,255,255,0.6)'),
      ],
    ],
  },
  giantWorm: {
    w: 22, h: 34, frameDuration: 360,
    frames: [
      [
        C(11, 30, 7.4, '#3a2048'), C(11, 30, 7, '#4a2a5e'), C(11, 30, 4.4, '#341c48'),
        C(11, 21, 6.6, '#5a3570'), C(11, 21, 4, '#341c48'),
        C(11, 12.5, 5.8, '#6b4082'), C(11, 12.5, 3.4, '#341c48'),
        C(11, 5.5, 4.8, '#7a4a92'), C(11, 5.5, 4.8, '#6b4082'),
        R(6.5, 4, 9, 1, '#8a5aa8'),
        P([7, 5, 4, 1, 8, 3], '#c9bfa8'), P([8.5, 5, 6, 0.5, 9.5, 3], '#c9bfa8'),
        P([15, 5, 18, 1, 14, 3], '#c9bfa8'), P([13.5, 5, 16, 0.5, 12.5, 3], '#c9bfa8'),
        C(9, 5.5, 0.9, '#f0d040'), C(13, 5.5, 0.9, '#f0d040'),
        C(9, 5.5, 0.4, '#1a0f14'), C(13, 5.5, 0.4, '#1a0f14'),
      ],
      [
        C(11, 30, 7.4, '#3a2048'), C(11, 30, 7, '#4a2a5e'), C(11, 30, 4.4, '#341c48'),
        C(11, 21.5, 6.6, '#5a3570'), C(11, 21.5, 4, '#341c48'),
        C(11, 13, 5.8, '#6b4082'), C(11, 13, 3.4, '#341c48'),
        C(11, 6, 4.8, '#7a4a92'), C(11, 6, 4.8, '#6b4082'),
        R(6.5, 4.5, 9, 1, '#8a5aa8'),
        P([7, 5.5, 4, 1.5, 8, 3.5], '#c9bfa8'), P([8.5, 5.5, 6, 1, 9.5, 3.5], '#c9bfa8'),
        P([15, 5.5, 18, 1.5, 14, 3.5], '#c9bfa8'), P([13.5, 5.5, 16, 1, 12.5, 3.5], '#c9bfa8'),
        C(9, 6, 1.2, '#f7e060'), C(13, 6, 1.2, '#f7e060'),
        C(9, 6, 0.5, '#1a0f14'), C(13, 6, 0.5, '#1a0f14'),
      ],
    ],
  },
  minotaur: {
    w: 28, h: 34, frameDuration: 240,
    frames: [
      [
        R(8, 26, 5, 6, '#4e3122'), R(15, 26, 5, 6, '#4e3122'),
        R(7.6, 31.5, 5, 1.4, '#1a0f08'), R(14.6, 31.5, 5, 1.4, '#1a0f08'),
        ...minotaurBody,
      ],
      [
        R(7.4, 26, 5, 6, '#4e3122'), R(15.6, 26, 5, 6, '#4e3122'),
        R(7, 31.5, 5, 1.4, '#1a0f08'), R(15.2, 31.5, 5, 1.4, '#1a0f08'),
        ...minotaurBody,
      ],
    ],
  },
  // ---------- Stage 2 (The Sundered Sands) roster ----------
  jackal: {
    w: 26, h: 17, frameDuration: 120,
    // Hand-drawn run cycle, authored not derived (tools/make_sheet.py stitched the two poses).
    // Side view only: a quadruped seen head-on reads as a blob, so the profile serves every
    // direction and the engine mirrors it for leftward movement — which is correct here.
    //
    // fitExact: the art is 37px tall but a jackal draws at radius*3.8*scale = 62.7px. Integer
    // snapping would round 1.69x UP to 2x and render it 18% too big.
    images: { side: 'assets/sprites/jackal.png' },
    imageFrames: 2,
    fitExact: true,
    frames: [
      [
        R(6, 11.5, 1.7, 5, '#4a3520'), R(9.5, 11.5, 1.7, 4, '#4a3520'),
        R(15, 11.5, 1.7, 4, '#4a3520'), R(18.5, 11.5, 1.7, 5, '#4a3520'),
        ...jackalBody,
      ],
      [
        R(5, 11.5, 1.7, 4, '#4a3520'), R(10.5, 11.5, 1.7, 5, '#4a3520'),
        R(16, 11.5, 1.7, 5, '#4a3520'), R(19.5, 11.5, 1.7, 4, '#4a3520'),
        ...jackalBody,
      ],
    ],
  },
  scarab: {
    w: 18, h: 16, frameDuration: 170,
    // Hand-drawn art; the procedural shapes below stay as the fallback if a file goes missing.
    // front and back are two drawn frames each. right is one drawn frame plus a derived second
    // one — a 1px scuttle bob rather than a leg cycle, because at this size a beetle's legs are
    // a couple of pixels and a stride would read as noise. left is right mirrored per frame.
    images: {
      front: 'assets/sprites/scarab_front.png',
      back:  'assets/sprites/scarab_back.png',
      right: 'assets/sprites/scarab_right.png',
      left:  'assets/sprites/scarab_left.png',
    },
    imageFrames: 2,
    frames: [
      [
        R(1.5, 9, 1.4, 3, '#0f2419'), R(2, 11, 2, 1, '#0f2419'),
        R(4, 10, 1.2, 3, '#0f2419'), R(13.4, 10, 1.2, 3, '#0f2419'),
        R(15.1, 9, 1.4, 3, '#0f2419'), R(14, 11, 2, 1, '#0f2419'),
        C(9, 8, 5.6, '#245040'), C(9, 7.4, 5, '#2f6650'),
        R(8.4, 3, 1.2, 10, '#123528'),
        C(6.5, 5.5, 1.7, '#3a7a5c'), C(11.5, 5.5, 1.7, '#3a7a5c'),
        C(7, 5, 0.7, '#7ac9a0'), C(11, 5, 0.7, '#7ac9a0'),
        C(9, 12, 2, '#1a3a2e'),
        T(9, 3, 8, 0.4, 10, 0.4, '#3a7a5c'),
        T(7, 13, 6, 14.6, 8, 13.5, '#0f2419'), T(11, 13, 12, 14.6, 10, 13.5, '#0f2419'),
        C(9, 8, 1, '#0a1a12'),
      ],
      [
        R(1, 9, 1.4, 3, '#0f2419'), R(1.5, 7, 2, 1, '#0f2419'),
        R(4.4, 10, 1.2, 3, '#0f2419'), R(13, 10, 1.2, 3, '#0f2419'),
        R(15.6, 9, 1.4, 3, '#0f2419'), R(14.5, 7, 2, 1, '#0f2419'),
        C(9, 8, 5.6, '#245040'), C(9, 7.4, 5, '#2f6650'),
        R(8.4, 3, 1.2, 10, '#123528'),
        C(6.5, 5.5, 1.7, '#3a7a5c'), C(11.5, 5.5, 1.7, '#3a7a5c'),
        C(7, 5, 0.7, '#7ac9a0'), C(11, 5, 0.7, '#7ac9a0'),
        C(9, 12, 2, '#1a3a2e'),
        T(9, 3, 8, 0.4, 10, 0.4, '#3a7a5c'),
        T(6.6, 13.2, 5.6, 14.8, 7.6, 13.7, '#0f2419'), T(11.4, 13.2, 12.4, 14.8, 10.4, 13.7, '#0f2419'),
        C(9, 8, 1, '#0a1a12'),
      ],
    ],
  },
  vulture: {
    w: 28, h: 20, frameDuration: 130,
    frames: [
      [
        P([14, 9, 2, 2, 5, 6, 9, 8, 12, 10], '#241f18'), P([14, 9, 26, 2, 23, 6, 19, 8, 16, 10], '#241f18'),
        P([14, 9, 6, 5, 10, 8, 12, 10], '#3a3226'), P([14, 9, 22, 5, 18, 8, 16, 10], '#3a3226'),
        R(4, 3, 3, 0.8, '#4a4030'), R(21, 3, 3, 0.8, '#4a4030'),
        C(14, 11.5, 4, '#2e281e'), C(14, 11, 3.4, '#3a3226'),
        P([12, 13.5, 16, 13.5, 15, 19, 13, 19], '#241f18'),
        R(11, 5, 3, 1, '#5a4438'),
        C(14, 7, 2.2, '#8a6a5a'), C(14, 6.5, 1.7, '#9a7a68'),
        T(14, 6, 18.5, 7.4, 14, 8.6, '#d9a545'), T(14, 6.6, 17, 7.4, 14, 8, '#b8862f'),
        C(13, 6.5, 0.7, '#f0d0a0'), C(13.1, 6.6, 0.35, '#1a0f08'),
      ],
      [
        P([14, 9, 3, 6, 7, 8, 10, 9, 12, 10], '#241f18'), P([14, 9, 25, 6, 21, 8, 18, 9, 16, 10], '#241f18'),
        P([14, 9, 8, 8, 11, 9.5, 12, 10], '#3a3226'), P([14, 9, 20, 8, 17, 9.5, 16, 10], '#3a3226'),
        R(5, 6.5, 3, 0.8, '#4a4030'), R(20, 6.5, 3, 0.8, '#4a4030'),
        C(14, 11.5, 4, '#2e281e'), C(14, 11, 3.4, '#3a3226'),
        P([12, 13.5, 16, 13.5, 15, 19, 13, 19], '#241f18'),
        R(11, 5, 3, 1, '#5a4438'),
        C(14, 7, 2.2, '#8a6a5a'), C(14, 6.5, 1.7, '#9a7a68'),
        T(14, 6, 18.5, 7.4, 14, 8.6, '#d9a545'), T(14, 6.6, 17, 7.4, 14, 8, '#b8862f'),
        C(13, 6.5, 0.7, '#f0d0a0'), C(13.1, 6.6, 0.35, '#1a0f08'),
      ],
    ],
  },
  mummy: {
    w: 20, h: 30, frameDuration: 320,
    frames: [
      [
        R(6, 24, 3, 6, '#c9bfa8'), R(6, 26, 3, 0.8, '#8a7d68'), R(11, 24, 3, 6, '#c9bfa8'), R(11, 26, 3, 0.8, '#8a7d68'),
        R(5.6, 29.5, 3.6, 1, '#8a7d68'), R(11, 29.5, 3.6, 1, '#8a7d68'),
        ...mummyBody,
      ],
      [
        R(5.4, 24, 3, 6, '#c9bfa8'), R(5.4, 26, 3, 0.8, '#8a7d68'), R(11.4, 24, 3, 6, '#c9bfa8'), R(11.4, 26, 3, 0.8, '#8a7d68'),
        R(5, 29.5, 3.6, 1, '#8a7d68'), R(11.4, 29.5, 3.6, 1, '#8a7d68'),
        ...mummyBody,
      ],
    ],
  },
  sandGolem: {
    w: 28, h: 32, frameDuration: 380,
    frames: [
      [
        R(7, 26, 5, 6, '#8a6a3a'), R(16, 26, 5, 6, '#8a6a3a'),
        R(7, 26, 5, 1, '#a37f4a'), R(16, 26, 5, 1, '#a37f4a'),
        ...sandGolemBody,
      ],
      [
        R(6.4, 26, 5, 6, '#8a6a3a'), R(16.6, 26, 5, 6, '#8a6a3a'),
        R(6.4, 26, 5, 1, '#a37f4a'), R(16.6, 26, 5, 1, '#a37f4a'),
        ...sandGolemBody,
      ],
    ],
  },
  stoneGolem: {
    w: 30, h: 34, frameDuration: 420,
    frames: [
      [
        R(7, 27, 6, 7, '#4a463c'), R(17, 27, 6, 7, '#4a463c'),
        R(7, 27, 6, 1.2, '#5c584c'), R(17, 27, 6, 1.2, '#5c584c'),
        ...stoneGolemBody,
      ],
      [
        R(6.4, 27, 6, 7, '#4a463c'), R(17.6, 27, 6, 7, '#4a463c'),
        R(6.4, 27, 6, 1.2, '#5c584c'), R(17.6, 27, 6, 1.2, '#5c584c'),
        ...stoneGolemBody,
      ],
    ],
  },
  boss: { // The Skeleton King (graveyard)
    w: 34, h: 42, frameDuration: 420,
    // First boss on the eight-direction pipeline: a drawn view for every facing, plus a
    // dedicated portrait for the menus. Replaces the old side-only, three-frame sheet — a boss
    // used to be shown in one strong profile, which was fine while it only ever charged at you
    // and wrong now that it circles, throws and backs away.
    //
    // He is robed and crowned, which is why his second frames were built with --converge=0 and
    // an explicit --shoulder: there are no legs to converge, and the automatic shoulder finder
    // caught the crown-to-skull step and hinged the head bob through his face.
    //
    // fitExact: the art is 128px tall but a boss draws at radius*2.8*scale = 176.4px. Integer
    // snapping would round 1.38x down to 1x and render him at a flat 128px — 27% too small.
    // (The art was redrawn at 2x, 64px -> 128px; fitExact is what keeps that a pure fidelity
    // change rather than a size change, since the snapped multiple would have moved.)
    images: {
      front:     'assets/sprites/skeletonking_front.png',
      right_45:  'assets/sprites/skeletonking_right_45.png',
      right:     'assets/sprites/skeletonking_right.png',
      right_135: 'assets/sprites/skeletonking_right_135.png',
      back:      'assets/sprites/skeletonking_back.png',
      left_135:  'assets/sprites/skeletonking_left_135.png',
      left:      'assets/sprites/skeletonking_left.png',
      left_45:   'assets/sprites/skeletonking_left_45.png',
      portrait:  'assets/sprites/skeletonking_portrait.png',
    },
    imageFrames: 2,
    fitExact: true,
    frames: [
      [
        R(11, 35, 4, 7, '#c9bfa8'), R(19, 35, 4, 7, '#c9bfa8'),
        R(10.6, 35.5, 4.8, 4, '#4a463c'), R(18.6, 35.5, 4.8, 4, '#4a463c'),
        R(10.6, 35.5, 4.8, 1, '#5c584c'), R(18.6, 35.5, 4.8, 1, '#5c584c'),
        R(10, 40.5, 5.4, 1.5, '#241a12'), R(18, 40.5, 5.4, 1.5, '#241a12'),
        ...skeletonKingBody,
        C(13.3, 8, 2, '#150c06'), C(20.7, 8, 2, '#150c06'),
        C(13.3, 8, 1.1, '#e0603a'), C(20.7, 8, 1.1, '#e0603a'),
      ],
      [
        R(10.5, 35, 4, 7, '#c9bfa8'), R(19.5, 35, 4, 7, '#c9bfa8'),
        R(10.1, 35.5, 4.8, 4, '#4a463c'), R(19.1, 35.5, 4.8, 4, '#4a463c'),
        R(10.1, 35.5, 4.8, 1, '#5c584c'), R(19.1, 35.5, 4.8, 1, '#5c584c'),
        R(9.5, 40.5, 5.4, 1.5, '#241a12'), R(18.5, 40.5, 5.4, 1.5, '#241a12'),
        ...skeletonKingBody,
        C(13.3, 8, 2, '#150c06'), C(20.7, 8, 2, '#150c06'),
        C(13.3, 8, 1.6, '#f5a852'), C(20.7, 8, 1.6, '#f5a852'),
      ],
    ],
  },
  sandPharaoh: {   // Akhmet, Undead Son of Anubis (the sundered sands)
    w: 34, h: 42, frameDuration: 440,
    // Eight drawn facings plus a portrait, same pipeline as the Skeleton King. Also robed and
    // headdressed, so his second frames were built the same way: --converge=0 (no legs to
    // converge under the wrappings) with an explicit --shoulder per direction, because the
    // automatic finder catches the headdress-to-skull step and hinges the bob through his face.
    //
    // fitExact for the same reason as the other bosses: the art is 64px tall but a boss draws
    // at radius*2.8*scale, and whole-number snapping would round that up and oversize him.
    //
    // His PORTRAIT is 74x128 while these body sheets are 39x64 — it was redrawn at 2x on its
    // own. That is safe only because spriteQuad takes each frame's width from the frame it is
    // drawing rather than from sprite.w (sampled from `right`); see the note there.
    images: {
      front:     'assets/sprites/sandpharaoh_front.png',
      right_45:  'assets/sprites/sandpharaoh_right_45.png',
      right:     'assets/sprites/sandpharaoh_right.png',
      right_135: 'assets/sprites/sandpharaoh_right_135.png',
      back:      'assets/sprites/sandpharaoh_back.png',
      left_135:  'assets/sprites/sandpharaoh_left_135.png',
      left:      'assets/sprites/sandpharaoh_left.png',
      left_45:   'assets/sprites/sandpharaoh_left_45.png',
      portrait:  'assets/sprites/sandpharaoh_portrait.png',
    },
    imageFrames: 2,
    fitExact: true,
    frames: [
      [
        R(11, 35, 4, 7, '#c9bfa8'), R(19, 35, 4, 7, '#c9bfa8'),
        R(11, 37, 4, 1, '#a89468'), R(19, 37, 4, 1, '#a89468'),
        R(10.6, 40.5, 4.8, 1.5, '#8a7355'), R(18.6, 40.5, 4.8, 1.5, '#8a7355'),
        ...sandPharaohBody,
        R(13.4, 9, 2.4, 0.9, '#1a1008'), R(18.2, 9, 2.4, 0.9, '#1a1008'),
        C(14.6, 9.4, 0.8, '#f0a030'), C(19.4, 9.4, 0.8, '#f0a030'),
      ],
      [
        R(10.5, 35, 4, 7, '#c9bfa8'), R(19.5, 35, 4, 7, '#c9bfa8'),
        R(10.5, 37, 4, 1, '#a89468'), R(19.5, 37, 4, 1, '#a89468'),
        R(10.1, 40.5, 4.8, 1.5, '#8a7355'), R(19.1, 40.5, 4.8, 1.5, '#8a7355'),
        ...sandPharaohBody,
        R(13.4, 9, 2.4, 0.9, '#1a1008'), R(18.2, 9, 2.4, 0.9, '#1a1008'),
        C(14.6, 9.4, 1.1, '#f7c060'), C(19.4, 9.4, 1.1, '#f7c060'),
      ],
    ],
  },
  hollowSovereign: {
    w: 34, h: 42, frameDuration: 420,
    frames: [
      [
        R(12, 39, 3, 3, '#c9bfa8'), R(19, 39, 3, 3, '#c9bfa8'),
        ...hollowSovereignBody,
        C(14.6, 8, 1.6, '#0e2a1e'), C(19.4, 8, 1.6, '#0e2a1e'),
        C(14.6, 8, 0.9, '#7ac95a'), C(19.4, 8, 0.9, '#7ac95a'),
      ],
      [
        R(11.5, 39, 3, 3, '#c9bfa8'), R(19.5, 39, 3, 3, '#c9bfa8'),
        ...hollowSovereignBody,
        C(14.6, 8, 1.6, '#0e2a1e'), C(19.4, 8, 1.6, '#0e2a1e'),
        C(14.6, 8, 1.3, '#a8f088'), C(19.4, 8, 1.3, '#a8f088'),
      ],
    ],
  },
  skeletonMinion: {
    w: 18, h: 26, frameDuration: 260,
    // Hand-drawn, two frames per facing. Only side and front exist so far; DIR_FALLBACK sends
    // back/front45/back135 to the side view, which keeps being mirrored by travel direction
    // (hasDir stays false for a borrowed facing). So a minion walking away shows its profile
    // rather than the procedural fallback, and drops in seamlessly when back art arrives.
    //
    // fitExact: the art is 64px tall but a minion draws at 46*1.5 = 69px. Integer snapping
    // would round 1.08x down to 1x and render it 7% too small.
    images: {
      side:  'assets/sprites/skeletonminion_side.png',
      front: 'assets/sprites/skeletonminion_front.png',
    },
    imageFrames: 2,
    fitExact: true,
    frames: [
      [
        R(6.4, 20, 1.7, 6, BONE), R(9.8, 20, 1.7, 6, BONE),
        R(5.8, 25.4, 2.8, 1, IRON), R(9.4, 25.4, 2.8, 1, IRON),
        ...skeletonMinionBody,
      ],
      [
        R(5.9, 20, 1.7, 6, BONE), R(10.3, 20, 1.7, 6, BONE),
        R(5.3, 25.4, 2.8, 1, IRON), R(9.9, 25.4, 2.8, 1, IRON),
        ...skeletonMinionBody,
      ],
    ],
  },
  arrow: {
    // Drawn pointing along +x; rotated to match flight direction at draw time.
    w: 18, h: 7,
    shapes: [
      // Feathered fletching
      T(0, 0.6, 5, 3.5, 3.5, 2, '#8a9a5a'),
      T(0, 6.4, 5, 3.5, 3.5, 5, '#6b7a3d'),
      T(1.5, 1.6, 4.6, 3.5, 3.8, 2.6, '#a8b86a'),
      // Shaft
      R(3, 2.9, 11, 1.1, '#7a6540'),
      R(3, 2.9, 11, 0.4, '#a08a5a'),
      // Metal head
      T(13.5, 1.2, 18, 3.5, 13.5, 5.8, '#cdd4df'),
      T(14.5, 2.3, 16.4, 3.5, 14.5, 4.7, '#8a929e'),
    ],
  },
};

const spriteCache = new Map();

function renderShapesToCanvas(shapes, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  for (const s of shapes) {
    g.fillStyle = s.c;
    if (s.k === 'r') g.fillRect(s.x, s.y, s.w, s.h);
    else if (s.k === 'c') { g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill(); }
    else if (s.k === 't') { g.beginPath(); g.moveTo(s.pts[0], s.pts[1]); g.lineTo(s.pts[2], s.pts[3]); g.lineTo(s.pts[4], s.pts[5]); g.closePath(); g.fill(); }
    else if (s.k === 'p') {
      g.beginPath();
      g.moveTo(s.pts[0], s.pts[1]);
      for (let i = 2; i < s.pts.length; i += 2) g.lineTo(s.pts[i], s.pts[i + 1]);
      g.closePath(); g.fill();
    }
  }
  return canvas;
}

// ---------- image-backed sprites ----------
// A sprite def may carry `images: { side, front, back }` pointing at transparent PNGs, plus
// `imageFrames` (how many animation frames each sheet holds, laid out left-to-right).
//
// Loading is async and non-blocking: buildSprite() returns the procedural sprite immediately
// and the PNGs overwrite it in place once decoded. If a file is missing or fails to decode,
// the procedural art simply stays — the game never renders an empty character.
//
// Frame size is taken from the PNG itself (width / imageFrames), not from the def, so the
// art dictates its own proportions and isn't locked to the fallback's dimensions.
// Vertical extent of a frame's actual artwork, as fractions of canvas height. Sprites differ
// in how much empty space sits above the head and in overall proportions, so portraits that
// frame a fixed slice of the *canvas* end up with heads at different heights. Measuring the
// content lets callers frame against the artwork itself.
function measureContent(canvas) {
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const d = g.getImageData(0, 0, w, h).data;
  let top = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    let any = false;
    for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { any = true; break; }
    if (any) { if (top < 0) top = y; bottom = y; }
  }
  if (top < 0) return { top: 0, bottom: 1 };
  return { top: top / h, bottom: (bottom + 1) / h };
}

// Cached per sprite; recomputed when hand-drawn art replaces the procedural fallback.
export function spriteContent(id, dir = 'front') {
  const sprite = spriteCache.get(id) || buildSprite(id);
  if (!sprite) return { top: 0, bottom: 1 };
  // Per facing, because artists frame each file differently — the sorceress portrait carries
  // five transparent rows above her hood where the ranger's carries one. Anything anchoring on
  // the canvas edge would hang them at different heights; anchoring on the measured ink does
  // not. Keyed by dir so asking for the portrait cannot return the front view's box.
  if (!sprite.content) sprite.content = {};
  if (!sprite.content[dir]) {
    const frame = (resolveDir(sprite, dir) || { frames: [] }).frames[0];
    sprite.content[dir] = frame ? measureContent(frame) : { top: 0, bottom: 1 };
  }
  return sprite.content[dir];
}

// Sprite art decodes asynchronously, after anything that draws once (portraits) has already
// painted. Listeners fire when a sheet lands so those can repaint themselves.
const artListeners = new Set();
export function onSpriteArtLoaded(cb) { artListeners.add(cb); return () => artListeners.delete(cb); }

// True only when a genuine view exists for that facing — a real front/back sheet, procedural
// or hand-drawn. Callers use this to avoid asking for a facing that would only mirror the side.
export function spriteHasFacing(id, dir) {
  const sprite = spriteCache.get(id) || buildSprite(id);
  // True only when this exact facing has its own artwork — a borrowed or mirrored stand-in
  // does not count, which is what callers are asking about.
  return !!(sprite && sprite.dirs && sprite.dirs[canonDir(dir)]);
}

function sliceSheet(img, frameCount, label) {
  let n = Math.max(1, frameCount || 1);
  // If the sheet doesn't divide evenly into the declared frame count, the count is wrong.
  // Fall back to a single frame and say so, rather than rendering a sliced-up character.
  if (n > 1 && img.width % n !== 0) {
    console.warn(`[sprites] ${label}: ${img.width}x${img.height} does not divide into ${n} frames — treating as 1 frame. Check imageFrames.`);
    n = 1;
  }
  const fw = Math.floor(img.width / n), fh = img.height;
  const frames = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas');
    c.width = fw; c.height = fh;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false; // keep hard pixel edges when slicing
    g.drawImage(img, i * fw, 0, fw, fh, 0, 0, fw, fh);
    frames.push(c);
  }
  return { frames, fw, fh };
}

// ---------- Boot readiness ----------
// Art decodes asynchronously, so anything drawn before it lands shows a stand-in and then
// swaps — the "pop in" the loading screen exists to hide. These counters let the boot sequence
// wait for the real thing.
//
// Counts SETTLED, not loaded: a 404 resolves the wait just as a successful decode does.
// Otherwise one missing file would hold the loading screen open forever, which is a far worse
// failure than the missing sprite it is reporting.
let assetsTotal = 0;
let assetsSettled = 0;
/** @type {((v?: unknown) => void)[]} */
const readyWaiters = [];

export function spriteAssetProgress() { return { loaded: assetsSettled, total: assetsTotal }; }

/** Resolves once every declared sprite image has loaded or failed. */
export function whenSpritesReady() {
  if (assetsSettled >= assetsTotal) return Promise.resolve();
  return new Promise((res) => readyWaiters.push(res));
}

function noteAssetSettled() {
  assetsSettled++;
  if (assetsSettled >= assetsTotal) readyWaiters.splice(0).forEach((r) => r());
}

function loadSpriteImages(id, def, entry) {
  // Facings arrive independently, so the trim has to wait for the last one. Cropping each sheet
  // as it lands would measure a different box per direction, and the creature would jump every
  // time it turned — the union box only means anything once every facing is in it.
  let pending = Object.values(def.images).filter(Boolean).length;
  const settleOne = () => {
    if (--pending > 0) return;
    if (!entry._trimmed) { entry._trimmed = true; trimSprite(entry); }
    entry.content = null;   // the extent changed again; remeasure
    for (const cb of artListeners) cb(id);
  };
  for (const [rawDir, src] of Object.entries(def.images)) {
    if (!src) continue;
    assetsTotal++;
    const dir = rawDir === PORTRAIT_DIR ? PORTRAIT_DIR : canonDir(rawDir);
    const img = new Image();
    img.onload = () => {
      const { frames, fw, fh } = sliceSheet(img, framesForDir(def, rawDir), src);
      entry.dirs[dir] = frames;
      // The right-facing sheet defines the sprite's real proportions — it is the view every
      // other one is measured against, and the one every sprite is most likely to ship.
      if (dir === 'right') { entry.w = fw; entry.h = fh; entry.fromImage = true; }
      // A sprite whose only art is a portrait still needs real dimensions from somewhere.
      else if (!entry.fromImage && dir === 'front') { entry.w = fw; entry.h = fh; entry.fromImage = true; }
      entry.content = null; // remeasure: the artwork's extent has changed
      noteAssetSettled();
      for (const cb of artListeners) cb(id);
      settleOne();
    };
    // A missing or broken file leaves that facing simply absent, and resolveDir routes around
    // it — which is the whole point of holding only real art.
    img.onerror = () => { noteAssetSettled(); for (const cb of artListeners) cb(id); settleOne(); };
    img.src = src;
  }
}

/**
 * How many frames a given direction's sheet holds.
 *
 * `imageFrames` may be a single number for the whole sprite, or a per-direction map for art
 * that does not animate uniformly — a four-frame front walk beside a two-frame profile, or a
 * still portrait beside both. Unlisted directions fall back to `default`, then to 1.
 */
function framesForDir(def, dir) {
  const n = def.imageFrames;
  if (n === undefined || n === null) return 1;
  if (typeof n === 'number') return n;
  const v = n[dir] !== undefined ? n[dir] : (n[canonDir(dir)] !== undefined ? n[canonDir(dir)] : n.default);
  return v === undefined ? 1 : v;
}

// A sprite may define up to three facings. `frames` is the side view (the default, and what
// every legacy sprite uses); optional `framesFront` / `framesBack` add toward-viewer and
// away-from-viewer views. Anything that omits them simply falls back to the side view, so
// existing sprites keep working untouched.
// ---------- Transparent-margin trim ----------
// A sprite sheet is a rectangle; the creature inside it is not. Every fully transparent pixel in
// that rectangle is still a pixel the GPU rasterises and blends — it samples a zero alpha and
// discards it, but it pays the fill cost first. With hundreds of large sprites overlapping, that
// wasted fill is the whole difference between 60fps and a slideshow, and it buys nothing at all.
//
// So each sprite is cropped to its inked bounds once, at build time, and the cropped canvas
// replaces the original. Nothing downstream changes: the quad is derived from the canvas, so a
// smaller canvas is a smaller quad automatically.
//
// ONE box for the whole sprite, measured across every frame and every facing — never per frame.
// Cropping frames independently would re-centre each one on its own ink, so a walk cycle whose
// arms swing wider on frame 2 would visibly shift on the spot. The union box preserves the
// relative framing the art was drawn with, which is the only thing that keeps animation still.
//
// The crop is symmetric about the centre for the same reason: the renderer positions a sprite by
// its quad's centre, so trimming 10px off the left and 2px off the right would slide the whole
// creature sideways. Taking the larger margin from both sides keeps the centre where it was, and
// still recovers most of the waste — the margins are near-symmetric on almost every sheet.
const TRIM_ALPHA = 4;   // below this, a pixel is not ink

/** Union of the inked bounds across a list of canvases, or null if they are all empty. */
function inkedBounds(canvases) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of canvases) {
    if (!c || !c.width || !c.height) continue;
    let data;
    try {
      data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    } catch {
      return null;   // tainted by a cross-origin image: leave it alone rather than guess
    }
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3] <= TRIM_ALPHA) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  return { x0, y0, x1, y1 };
}

/**
 * Crop every frame of a sprite to its shared inked box, in place. Returns the pixels saved, so
 * the saving is measurable rather than assumed.
 * @param {{ dirs?: Record<string, HTMLCanvasElement[]>, frames?: HTMLCanvasElement[],
 *           w: number, h: number }} entry
 */
export function trimSprite(entry) {
  const lists = entry.dirs ? Object.values(entry.dirs) : [entry.frames || []];
  const all = [].concat(...lists).filter(Boolean);
  if (!all.length) return 0;
  const W = all[0].width, H = all[0].height;
  // Mixed frame sizes mean the sheets were authored at different scales; a shared box would be
  // meaningless across them, so this bows out rather than mangling one of them.
  if (all.some((c) => c.width !== W || c.height !== H)) return 0;
  const b = inkedBounds(all);
  if (!b) return 0;
  // Symmetric margins, so the centre does not move.
  const mx = Math.min(b.x0, W - 1 - b.x1);
  const my = Math.min(b.y0, H - 1 - b.y1);
  if (mx <= 0 && my <= 0) return 0;
  const nw = W - mx * 2, nh = H - my * 2;
  if (nw < 2 || nh < 2) return 0;
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const src = list[i];
      if (!src) continue;
      const out = document.createElement('canvas');
      out.width = nw; out.height = nh;
      out.getContext('2d').drawImage(src, mx, my, nw, nh, 0, 0, nw, nh);
      list[i] = out;
    }
  }
  // The nominal size follows the art, or every quad derived from it would still be the old shape.
  entry.w = entry.w * (nw / W);
  entry.h = entry.h * (nh / H);
  return (W * H - nw * nh) * all.length;
}

function buildSprite(id) {
  const def = SPRITE_DEFS[id];
  if (!def) return null;
  const bake = (lists) => (lists || []).map((shapes) => renderShapesToCanvas(shapes, def.w, def.h));
  const side = bake(def.frames || [def.shapes]);
  // Only facings that GENUINELY exist go in. Nothing is pre-filled with a stand-in, so
  // resolveDir is the one place that decides what a missing facing falls back to — and
  // spriteHasFacing can answer honestly instead of every direction claiming to have art.
  const entry = {
    /** @type {Record<string, HTMLCanvasElement[]>} */
    dirs: { right: side },       // the procedural profile IS the right-facing view
    fitExact: !!def.fitExact,
    w: def.w, h: def.h, frameDuration: def.frameDuration || 250,
  };
  if (def.framesFront) entry.dirs.front = bake(def.framesFront);
  if (def.framesBack) entry.dirs.back = bake(def.framesBack);
  // Procedural sprites are drawn into a box sized for the widest pose, so most of them carry
  // real margin. Trimmed once here, before anything can cache a quad off the old dimensions.
  trimSprite(entry);
  spriteCache.set(id, entry);
  // Swap in hand-drawn PNGs over the procedural fallback once they decode.
  if (def.images) loadSpriteImages(id, def, entry);
  return entry;
}

// `phase` shifts this sprite's place in the walk cycle (milliseconds). Animation is driven off
// a single global clock, so without an offset every figure on screen steps in perfect unison —
// fine for a crowd of identical monsters, wrong for a line-up meant to look individually alive.
function currentFrame(sprite, dir = 'side', phase = 0) {
  const r = sprite.dirs ? resolveDir(sprite, dir) : { frames: sprite.frames };
  const frames = (r && r.frames) || [];
  if (frames.length <= 1) return frames[0];
  const idx = Math.floor((performance.now() + phase) / sprite.frameDuration) % frames.length;
  return frames[idx];
}

// Index of the frame a sprite is showing right now. Lets one-shot painters (portraits)
// repaint only on a frame change rather than every tick.
export function spriteFrameIndex(id, dir = 'side') {
  const sprite = spriteCache.get(id) || buildSprite(id);
  if (!sprite) return 0;
  const r = sprite.dirs ? resolveDir(sprite, dir) : { frames: sprite.frames };
  const frames = (r && r.frames) || [];
  if (!frames || frames.length <= 1) return 0;
  return Math.floor(performance.now() / sprite.frameDuration) % frames.length;
}

// `exactScale` bypasses the whole-number snapping below. Use it when the size is ANIMATING:
// snapping quantises a smoothly changing height into jumps of one source-pixel-block, so a
// figure growing continuously appears to click through a handful of fixed sizes instead.
// Gameplay keeps the snapping (crisp pixels at a size that never changes); the menu drum does
// not, and trades a little shimmer for smooth motion.
export function spriteQuad(id, targetHeight, flip = false, dir = 'side', phase = 0, exactScale = false) {
  const sprite = spriteCache.get(id) || buildSprite(id);
  if (!sprite) return null;
  // A sprite whose hand-drawn sheet is still in flight draws NOTHING rather than briefly
  // showing the procedural fallback underneath it. The fallback exists so missing art degrades
  // gracefully, not so the old artwork flashes on screen for a few frames every time a sheet
  // is still arriving — which is exactly what it did on the main menu, for a measured ~250ms.
  //
  // Only ever pending, never permanent: loadSpriteImages clears the flag when the side sheet
  // settles, whether it loaded or failed, so a 404 still ends up drawing the procedural shapes.
  if (sprite.awaitingArt) return null;
  // Hand-drawn art snaps to a whole-number scale so every source pixel becomes an exact
  // NxN block — fractional scaling under nearest-neighbour makes some pixels 1px and others
  // 2px, which shimmers. Procedural sprites keep smooth scaling: they're generated at
  // arbitrary sizes, so snapping them would visibly change how big each monster is.
  //
  // `fitExact` opts out of snapping: art drawn at one size but displayed at another (an
  // enemy sized from its collision radius, say) would otherwise round to the nearest whole
  // multiple and come out visibly wrong. Trades pixel-crispness for the correct size.
  const scale = (sprite.fromImage && !sprite.fitExact && !exactScale)
    ? Math.max(1, Math.round(targetHeight / sprite.h))
    : targetHeight / sprite.h;
  const h = sprite.h * scale;
  const canvas = currentFrame(sprite, dir, phase);
  // Width comes from the frame ACTUALLY being drawn, not from sprite.w. Those two agree for
  // every sprite whose facings were drawn at one size — which was all of them until Akhmet's
  // portrait was redrawn at 2x while his body sheets stayed at 1x. sprite.w/h is sampled once,
  // from the `right` sheet, so his 74x128 bust was being squeezed into a box shaped 39x64 and
  // came out ~5% wide. Taking the aspect from the frame is a no-op wherever the sizes match.
  const w = canvas && canvas.height ? h * (canvas.width / canvas.height) : sprite.w * scale;
  // Whether to mirror is the RESOLVER's decision, not the caller's: it is the only thing that
  // knows whether it handed back real left art or a flipped right sheet standing in for it.
  // A hand-drawn left view always wins over a mirror, because mirroring reverses everything
  // asymmetric — a staff switches hands, a hood's drape flips.
  const r = resolveDir(sprite, dir);
  let useFlip = !!(r && r.mirror);
  // `flip` survives only for callers still working in the old flat scheme, where the facing
  // carried no handedness and the caller tracked it separately. It cannot apply to a facing
  // that names its own side, or a left-walking enemy would be flipped back to the right.
  const canon = dir === PORTRAIT_DIR ? PORTRAIT_DIR : canonDir(dir);
  if (flip && canon === 'right' && !(r && r.mirror)) useFlip = true;
  return { canvas, w, h, flip: useFlip };
}

// Canvas 2D painter. Thin on purpose: every decision about WHICH image at WHAT size lives in
// spriteQuad above, so an alternative renderer (the WebGL batcher) draws byte-identical
// geometry rather than reimplementing the snapping rules and drifting out of agreement.
export function drawSprite(ctx, id, sx, sy, targetHeight, flip = false, dir = 'side', phase = 0, exactScale = false) {
  const q = spriteQuad(id, targetHeight, flip, dir, phase, exactScale);
  if (!q) return;
  ctx.save();
  if (q.flip) {
    ctx.translate(sx, sy);
    ctx.scale(-1, 1);
    ctx.drawImage(q.canvas, -q.w / 2, -q.h / 2, q.w, q.h);
  } else {
    ctx.drawImage(q.canvas, sx - q.w / 2, sy - q.h / 2, q.w, q.h);
  }
  ctx.restore();
}

// The showcase cast: every sprite whose art is hand-drawn AND animated, in definition order.
//
// This is derived, never a hand-maintained list: a sprite qualifies by declaring `images` and
// having its side sheet actually load with more than one frame. Dropping a new PNG pair into
// assets/sprites and pointing a def at it is therefore enough to enrol it — nothing else to
// update. Declaring `images` for art that does not exist yet (a placeholder path) correctly
// leaves the sprite out, because the load fails and `fromImage` is never set.
//
// `noShowcase: true` on a def opts it out. That is for art which is hand-drawn but does not
// belong in a walking line-up — a flyer, or anything whose animation is not a walk cycle.
export function handDrawnSpriteIds() {
  const ids = [];
  for (const id of Object.keys(SPRITE_DEFS)) {
    if (!SPRITE_DEFS[id].images || SPRITE_DEFS[id].noShowcase) continue;
    const sprite = spriteCache.get(id) || buildSprite(id);
    if (!sprite || !sprite.fromImage) continue;
    const frames = sprite.dirs ? (sprite.dirs.right || sprite.dirs.front) : sprite.frames;
    if (!frames || frames.length <= 1) continue;
    ids.push(id);
  }
  return ids;
}

// Width-to-height ratio of a sprite's art. Callers that size by height need this to avoid
// blowing a wide sprite (a quadruped, say) far off-screen when they ask for a tall one.
// True when a sprite's art is drawn levitating, so the renderer hovers it rather than
// planting it on the ground line.
// Display scale for a sprite, relative to the size its class would otherwise draw at.
// 1 means "same as everyone else".
export function spriteScale(id) {
  const s = SPRITE_DEFS[id];
  return (s && s.displayScale) || 1;
}

export function spriteFloats(id) {
  return !!(SPRITE_DEFS[id] && SPRITE_DEFS[id].floats);
}

export function spriteAspect(id) {
  const sprite = spriteCache.get(id) || buildSprite(id);
  return sprite && sprite.h ? sprite.w / sprite.h : 1;
}

// The facings a sprite may declare art for, from camera-facing round to away.
// Only `side` is required; anything else falls back through DIR_FALLBACK.
// 'left' and 'left45' are OPTIONAL mirror-overrides, not new facings: a sprite that ships
// them is drawn travelling left rather than being flipped. Everything without them keeps
// mirroring the right-facing art exactly as before.
// ---------- Sprite definition contract ----------
// A definition may declare art for any subset of the eight facings, plus a portrait:
//
//   images: {
//     front: '...png', right_45: '...png', right: '...png', right_135: '...png',
//     back:  '...png', left_135: '...png', left:  '...png', left_45:   '...png',
//     portrait: '...png',                    // menus only; never picked by movement
//   },
//   imageFrames: 2,                          // every sheet holds 2 frames, or...
//   imageFrames: { default: 2, front: 4, portrait: 1 },   // ...per direction
//
// Sheets are strips laid out left to right, sliced into `imageFrames` frames of equal width.
// Missing facings are filled in by resolveDir, mirroring a right-facing sheet where that
// serves — so art can arrive one direction at a time and nothing has to be finished at once.
// The legacy names (side, front45, back135, left45) are still accepted for every one of these.

// ---------- Facings ----------
// Eight views, named from the character's point of view: `front` is 6 o'clock (looking at the
// camera) and the rest run counter-clockwise round to `left_45`. A sprite may ship any subset;
// whatever is missing is resolved to the nearest thing that exists, mirroring where that helps.
export const SPRITE_DIRS = ['front', 'right_45', 'right', 'right_135', 'back', 'left_135', 'left', 'left_45'];

// Degrees, measured from `front` in the direction the list above runs.
const DIR_ANGLE = { front: 0, right_45: 45, right: 90, right_135: 135, back: 180, left_135: 225, left: 270, left_45: 315 };

// A dedicated portrait view. Not a facing — it never takes part in the fallback ring, is never
// mirrored, and is never picked by movement. It exists so a character can be drawn for the
// menus in a pose that has nothing to do with how it walks: front-on, weapon up, centred in
// frame. Falls back to `front` and then the normal chain when a sprite has no portrait art.
export const PORTRAIT_DIR = 'portrait';

// The names this system used before it had eight views, accepted anywhere a facing is given so
// every existing sprite definition, call site and saved value keeps working untouched.
// `side` meant "the right-facing profile", which is exactly `right`.
const DIR_ALIAS = { side: 'right', front45: 'right_45', back135: 'right_135', left45: 'left_45' };

/** Canonical name for a facing, accepting the legacy spellings. */
export function canonDir(d) { return DIR_ALIAS[d] || d; }

// Reflections across the vertical axis. A right-facing sheet flipped horizontally is a
// serviceable left-facing one, which is how every character worked before left art existed.
const MIRROR = {
  right: 'left', right_45: 'left_45', right_135: 'left_135',
  left: 'right', left_45: 'right_45', left_135: 'right_135',
};

// Drawn straight at or away from the camera. Mirroring these only swaps their own details —
// a torch changes hands and nothing reads as having turned — so they are never flipped.
const DIR_HEAD_ON = new Set(['front', 'back']);

// Shortest angle between two facings, in degrees (0-180).
function angleGap(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

// For every facing, the ordered list of what to draw when it has no art of its own: nearest
// angle first, and a mirrored sheet counted at its mirrored angle so `left` reaches for a
// flipped `right` before it reaches for `left_45`.
//
// Computed rather than hand-written. Eight facings x two handednesses is 16 entries per list
// and 128 in total — a table that size is transcribed wrongly, and silently, and the symptom
// is one enemy facing the wrong way at one angle.
const DIR_FALLBACK = {};
for (const want of SPRITE_DIRS) {
  const cands = [];
  for (const d of SPRITE_DIRS) {
    // Head-on views are a poor stand-in for a three-quarter one even at equal angle: a profile
    // still tells you which way the body is travelling, while a front or back view tells you
    // nothing. The penalty only breaks ties — an exact match still costs 0 — and it is what
    // keeps a sprite with no diagonal art showing a mirrored profile on the up-left walk
    // rather than turning to face away, which is what it has always done.
    const headOnPenalty = DIR_HEAD_ON.has(d) && d !== want ? 1 : 0;
    cands.push({ dir: d, mirror: false, cost: angleGap(DIR_ANGLE[d], DIR_ANGLE[want]) + headOnPenalty });
    const m = MIRROR[d];
    // A mirrored sheet stands in for the facing it reflects to. The +0.5 breaks ties towards
    // real art, so a genuine drawing always beats a flip of its neighbour.
    if (m && !DIR_HEAD_ON.has(d)) {
      cands.push({ dir: d, mirror: true, cost: angleGap(DIR_ANGLE[m], DIR_ANGLE[want]) + 0.5 });
    }
  }
  cands.sort((a, b) => a.cost - b.cost);
  DIR_FALLBACK[want] = cands;
}

/**
 * Picks the frames to draw for a facing, and says whether they need flipping.
 *
 * `sprite.dirs` holds ONLY art that genuinely exists — nothing is pre-filled with a stand-in —
 * so this is the single place that decides what a missing facing looks like.
 *
 * @returns {{ frames: HTMLCanvasElement[], mirror: boolean } | null}
 */
function resolveDir(sprite, dir) {
  const dirs = sprite.dirs || {};
  // The portrait is deliberately outside the ring: ask for it, and if it is not there fall
  // through to the ordinary front view rather than to some three-quarter walk frame.
  if (dir === PORTRAIT_DIR) {
    if (dirs[PORTRAIT_DIR] && dirs[PORTRAIT_DIR].length) {
      return { frames: dirs[PORTRAIT_DIR], mirror: false };
    }
    dir = 'front';
  }
  const want = canonDir(dir);
  const chain = DIR_FALLBACK[want] || DIR_FALLBACK.right;
  for (const c of chain) {
    const f = dirs[c.dir];
    if (f && f.length) return { frames: f, mirror: c.mirror };
  }
  return null;
}

/**
 * The facing that matches a movement or aim vector.
 *
 * Screen space: +y is down, so a vector pointing down the screen is walking toward the camera
 * and reads as `front`. Eight 45-degree buckets, each centred on its facing — offsetting by
 * half a bucket before flooring is what centres them, rather than having `front` cover 0-45.
 */
export function facingDir(dx, dy) {
  if (!dx && !dy) return 'right';
  // atan2(x, y) measured from straight-down, increasing the way SPRITE_DIRS runs.
  let deg = Math.atan2(dx, dy) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  const i = Math.floor((deg + 22.5) / 45) % 8;
  return SPRITE_DIRS[i];
}

/**
 * facingDir with HYSTERESIS: the octant only changes once the aim is clear of the boundary.
 *
 * The plain version floors the angle into one of eight 45-degree bins, so an aim vector sitting
 * ON a bin edge flips between two facings on sub-degree jitter — and an auto-aimed character
 * tracking a walking enemy sits on that edge constantly. The result reads as the sprite
 * vibrating between two poses.
 *
 * Rather than delaying the change — which would make every DELIBERATE turn feel late — the
 * boundary is simply made sticky: keep the current facing until the angle is `margin` degrees
 * past where the bin would normally hand over. A real turn crosses that in one frame and is
 * instant; jitter never does. Same idea as the class-select focus ring, which strobed for the
 * same reason: a discrete choice re-derived every frame from a value sitting on a tie.
 *
 * @param {number} dx @param {number} dy
 * @param {string|null} prev the facing currently being drawn, or null on the first frame
 * @param {number} [margin] degrees past the bin edge required to switch
 */
export function facingDirStable(dx, dy, prev, margin = 8) {
  const next = facingDir(dx, dy);
  if (!prev || next === prev) return next;
  const i = SPRITE_DIRS.indexOf(prev);
  if (i < 0) return next;
  if (!dx && !dy) return prev;
  let deg = Math.atan2(dx, dy) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  // Signed angular distance from the CENTRE of the facing already being drawn.
  const off = Math.abs(((deg - i * 45 + 540) % 360) - 180);
  return off < 22.5 + margin ? prev : next;
}

export function drawSpriteRotated(ctx, id, sx, sy, targetHeight, angle, lengthMult = 1) {
  const sprite = spriteCache.get(id) || buildSprite(id);
  if (!sprite) return;
  const scale = targetHeight / sprite.h;
  // lengthMult stretches only the sprite's length (its +x axis) — used to lengthen arrows
  // without making them thicker.
  const w = sprite.w * scale * lengthMult, h = sprite.h * scale;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.drawImage(currentFrame(sprite), -w / 2, -h / 2, w, h);
  ctx.restore();
}

export function hasSprite(id) { return !!SPRITE_DEFS[id]; }

// ---------- Start every sheet downloading at boot ----------
// buildSprite() bakes the procedural fallback synchronously and returns it, THEN kicks off the
// PNG loads — so anything drawn before a sheet lands shows the old procedural art. Left lazy,
// that gap opened wherever a sprite was first asked for: measured at 708ms (the menu carousel's
// first paint) with ~250ms of fetch behind it, which is ~30 frames of visibly wrong artwork on
// the main menu, and the same again the first time an unseen enemy type spawned mid-run.
//
// Priming here moves the whole burst to module-load time, so it resolves long before anything
// is on screen. It does not remove the asynchronous gap — nothing can, short of blocking the
// first paint — it relocates it to where there is nothing to look at yet.
//
// Only defs that declare `images` are touched: a purely procedural sprite has nothing to fetch,
// and baking its shapes early would just move work forward for no benefit. buildSprite caches
// into spriteCache, so the later lazy call sites all hit that cache instead of rebuilding.
for (const id of Object.keys(SPRITE_DEFS)) {
  if (SPRITE_DEFS[id].images) buildSprite(id);
}
