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
