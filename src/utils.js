export function rand(min, max) { return min + Math.random() * (max - min); }
export function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
export function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }
export function dist2(x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; }
export function normalize(x, y) { const l = Math.hypot(x, y); return l === 0 ? { x: 0, y: 0 } : { x: x / l, y: y / l }; }
export function circleCollide(x1, y1, r1, x2, y2, r2) { return dist2(x1, y1, x2, y2) <= (r1 + r2) * (r1 + r2); }
export function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
export function pickWeighted(entries) {
  // entries: [[item, weight], ...]
  const total = entries.reduce((s, e) => s + e[1], 0);
  let r = rand(0, total);
  for (const [item, w] of entries) { if (r < w) return item; r -= w; }
  return entries[entries.length - 1][0];
}
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Hard ceiling on crit chance, as a fraction.
 *
 * Lives in utils — the one module everything imports — because it had drifted into TWO literals:
 * a named constant in main.js for the damage roll and the pause readout, and a bare `0.75` in
 * skills.js's DPS estimator. Two copies of a cap is how a panel ends up quoting a number the
 * game does not roll against, which is the exact bug the main.js constant was introduced to fix.
 *
 * Raised 0.75 -> 1.0: crit is an endgame chase stat for min/maxers, and the ceiling was low
 * enough that the Crit Chance tome ran out of room to be worth taking. It is not an early-game
 * threat — reaching it takes a deliberate, heavily invested build.
 */
export const MAX_CRIT_CHANCE = 1.0;
