// @ts-check
// ---------- Impassable terrain ----------
// Rocks and ridges scattered through the arena. They exist to give the floor an OPINION: an
// empty square means every fight is the same fight, and the only tactic is to walk backwards in
// a straight line. Obstacles turn that into corners to cut, gaps to funnel a horde through, and
// bodies to put between you and a boss.
//
// Everything is built from CIRCLES, including the ridges — a ridge is a row of overlapping
// circles rather than a capsule or a polygon. One shape means one collision routine, which is
// what keeps this cheap enough to run against several hundred enemies every frame, and it makes
// the silhouettes read as weathered rock rather than as geometry.
//
// Projectiles deliberately pass straight over. Blocking them would mean every volley you fire
// can be eaten by scenery you did not place, which feels like the game cheating; and enemies are
// overwhelmingly melee, so line-of-sight cover would cost far more than it bought.

// Deliberately not utils' rand(): that one always uses Math.random, and terrain generation
// takes an injectable rng so a layout can be reproduced from a seed when debugging one.
const between = (min, max, rng) => min + rng() * (max - min);

/* GENERATED: terrain tuning. Do not hand-edit — tools/bake-tuning.py rewrites this whole block
   from tuning/entity-tuning.json under the `terrain` domain. */
export const TERRAIN_TUNE_OVERRIDE = {
  clearRadius: 240,
  edgeMargin: 120,
  ridgeChance: 0.1,
  ridgeLength: 3,
  seed: 2,
  sizeVary: 0.2,
  spacing: 90,
};
/* END GENERATED */

/* GENERATED: per-stage rock colours. Do not hand-edit — tools/bake-tuning.py rewrites this
   whole block from tuning/entity-tuning.json under the `terraincolors` domain. Keyed by stage
   id, one entry per stage. */
export const TERRAIN_COLOR_TUNE = {
  desert: { hueVary: 10, lightVary: 4, rockHue: 65, rockLift: 34, rockSat: 0.38 },
  graveyard: { hueVary: 3, lightVary: 0, rockHue: 85, rockLift: 20, rockSat: 0.04 },
  underworld: { hueVary: 3, lightVary: 0, rockHue: 85, rockLift: 20, rockSat: 0.04 },
};
/* END GENERATED */

export const TERRAIN_TUNE = {
  clusters: 26,        // how many rock formations per arena
  minRadius: 26,
  maxRadius: 62,
  ridgeChance: 0.45,   // a cluster becomes a ridge rather than a boulder
  ridgeLength: 4,      // circles in a ridge
  clearRadius: 420,    // keep the player's spawn clear
  edgeMargin: 220,     // and stay off the arena wall
  // ---- scatter ----
  // `spacing` is the minimum gap between one formation and the next, measured centre to centre
  // and on top of their radii. Without it, purely random placement clumps: a few rocks land on
  // top of each other into one blob while whole quarters of the arena stay bare, which is the
  // opposite of the cover-and-funnels this is for.
  // Size variance stays HERE with the layout dials rather than moving to the per-stage colour
  // block, because unlike the colour ones it feeds the hitbox and has to regenerate the arena.
  sizeVary: 0.25,  // fraction of the rolled radius, +/-
  spacing: 150,
  // `seed` makes a layout reproducible. 0 means "roll a new one each stage"; any other value
  // pins the arena, so a layout worth keeping can be written down, and a bad one can be shown
  // to someone else rather than described.
  seed: 0,
  ...TERRAIN_TUNE_OVERRIDE,
};

export const TERRAIN_TUNE_META = {
  clusters:     { label: 'Formations',   min: 0, max: 80, step: 1 },
  minRadius:    { label: 'Min Rock Size', min: 8, max: 120, step: 2 },
  maxRadius:    { label: 'Max Rock Size', min: 8, max: 200, step: 2 },
  ridgeChance:  { label: 'Ridge Chance', min: 0, max: 1, step: 0.05, unit: '%' },
  ridgeLength:  { label: 'Ridge Length', min: 2, max: 10, step: 1 },
  clearRadius:  { label: 'Spawn Clearance', min: 100, max: 1200, step: 20 },
  edgeMargin:   { label: 'Edge Margin', min: 0, max: 600, step: 20 },
  sizeVary:     { label: 'Size Variance',  min: 0, max: 1,   step: 0.05, unit: '%' },
  spacing:      { label: 'Min Spacing',   min: 0, max: 600, step: 10 },
  seed:         { label: 'Layout Seed (0 = random)', min: 0, max: 999, step: 1 },
};

// The colour dials, split out per stage: each arena's floor art is different, so one global
// tint that flatters the graveyard reads wrong against the sands. All five act at DRAW time —
// no dial here ever regenerates the layout, so dragging one re-tints the field instantly.
//
// `rockLift` is ABSOLUTE 0-255 steps above the floor's average value, not a percentage: the
// floors sit around 0.14, where a "15% brighter" rock is two RGB steps and completely
// invisible. On a dark floor only a fixed offset guarantees separation.
// `hueVary`/`lightVary` scale each rock's own fixed -1..1 rolls, so variance re-tints without
// reshuffling — the rocks keep their identity and only their spread changes.
export const TERRAIN_COLOR_META = {
  // Spans the full range: the floors average ~36/255, so -255 is guaranteed black and +255
  // guaranteed white after the add — the ends of this slider are the ends of what a rock can be.
  rockLift:     { label: 'Rock Brightness', min: -255, max: 255, step: 2 },
  rockHue:      { label: 'Rock Hue',        min: 0, max: 360, step: 5, unit: '°' },
  rockSat:      { label: 'Rock Saturation', min: 0, max: 1,   step: 0.02, unit: '%' },
  hueVary:      { label: 'Hue Variance',   min: 0, max: 180, step: 5, unit: '°' },
  lightVary:    { label: 'Light Variance', min: 0, max: 80,  step: 2 },
};

/** Grid cell size for the broadphase. Comfortably larger than the biggest rock. */
const CELL = 256;

/**
 * One arena's worth of rock, plus the lookup grid that makes it queryable.
 *
 * The grid is the whole reason this is affordable. Several hundred enemies each testing every
 * rock every frame is the same O(n*m) trap that made the electro field cost 12ms; bucketing by
 * cell turns it into a handful of checks regardless of how much rock is on the field.
 */
export class Terrain {
  constructor() {
    /** @type {any[]} */
    this.rocks = [];
    /** @type {Map<string, number[]>} */
    this.grid = new Map();
    /**
     * One traced silhouette per FORMATION — overlapping rocks merged into a single continuous
     * path so an outcrop reads as one shape rather than several outlined blobs. Built once by
     * buildOutlines(); the rocks themselves still carry collision.
     * @type {{ rings: {x:number,y:number}[][], cx:number, cy:number, radius:number }[]}
     */
    this.outlines = [];
  }

  static key(cx, cy) { return `${cx},${cy}`; }

  index() {
    this.grid.clear();
    for (let i = 0; i < this.rocks.length; i++) {
      const o = this.rocks[i];
      // A rock can straddle cells, so it is registered in every cell its bounds touch.
      const x0 = Math.floor((o.x - o.r) / CELL), x1 = Math.floor((o.x + o.r) / CELL);
      const y0 = Math.floor((o.y - o.r) / CELL), y1 = Math.floor((o.y + o.r) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const k = Terrain.key(cx, cy);
          const list = this.grid.get(k);
          if (list) list.push(i); else this.grid.set(k, [i]);
        }
      }
    }
  }

  /** Rocks that could touch a circle at (x,y,r). @returns {any[]} */
  near(x, y, r) {
    const out = [];
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.grid.get(Terrain.key(cx, cy));
        if (!list) continue;
        for (const i of list) if (!out.includes(this.rocks[i])) out.push(this.rocks[i]);
      }
    }
    return out;
  }

  /**
   * Push a circular body out of any rock it is inside.
   *
   * Resolves position rather than blocking movement: an entity that is overlapping gets shoved
   * along the shortest way out. That keeps a body from ever becoming stuck — including one that
   * was spawned inside a rock, or shoved into one by a knock-back — where a "refuse the move"
   * test would trap it forever.
   *
   * @param {{x:number,y:number}} e @param {number} radius
   * @returns {boolean} true if it had to move
   */
  resolve(e, radius) {
    let moved = false;
    for (const o of this.near(e.x, e.y, radius)) {
      const dx = e.x - o.x, dy = e.y - o.y;
      const need = o.r + radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= need * need) continue;
      const d = Math.sqrt(d2) || 0.0001;
      const push = (need - d) / d;
      e.x += dx * push;
      e.y += dy * push;
      moved = true;
    }
    return moved;
  }

  /** Is this spot free? Used when placing things that must not start buried. */
  clearAt(x, y, radius) {
    for (const o of this.near(x, y, radius)) {
      const dx = x - o.x, dy = y - o.y;
      const need = o.r + radius;
      if (dx * dx + dy * dy < need * need) return false;
    }
    return true;
  }
}

/**
 * Build an arena's terrain.
 *
 * Rocks are kept off the player's spawn and off the arena wall. The wall margin matters more
 * than it looks: a rock touching the boundary makes a dead-end pocket, and being cornered by
 * scenery in a game about movement is the one outcome this system must not produce.
 *
 * @param {number} arenaRadius @param {() => number} [rng]
 */
export function generateTerrain(arenaRadius, rng) {
  // A pinned seed needs a deterministic generator; Math.random cannot be seeded. mulberry32 is
  // four lines and has a long enough period for a few thousand draws.
  if (!rng) {
    const fixed = Math.round(TERRAIN_TUNE.seed);
    if (fixed > 0) {
      let a = fixed >>> 0;
      rng = () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let x = Math.imul(a ^ (a >>> 15), 1 | a);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
    } else {
      rng = Math.random;
    }
  }
  const t = new Terrain();
  const lim = arenaRadius - TERRAIN_TUNE.edgeMargin;
  /** Cluster centres already placed, for the spacing test. */
  const centres = [];
  let guard = 0;
  while (t.rocks.length < TERRAIN_TUNE.clusters * TERRAIN_TUNE.ridgeLength && guard++ < 4000) {
    const cx = between(-lim, lim, rng);
    const cy = between(-lim, lim, rng);
    if (Math.hypot(cx, cy) < TERRAIN_TUNE.clearRadius) continue;   // spawn pocket stays open
    // Rejection sampling against everything already placed. Cheap here because the count is in
    // the dozens; anything larger would want a grid, but a grid for 30 items is more code than
    // it saves.
    let tooClose = false;
    for (const c of centres) {
      if (Math.hypot(cx - c.x, cy - c.y) < TERRAIN_TUNE.spacing) { tooClose = true; break; }
    }
    if (tooClose) continue;
    centres.push({ x: cx, y: cy });
    const isRidge = rng() < TERRAIN_TUNE.ridgeChance;
    const n = isRidge ? Math.max(2, Math.round(TERRAIN_TUNE.ridgeLength)) : 1;
    const ang = rng() * Math.PI * 2;
    const step = TERRAIN_TUNE.minRadius * 1.15;
    for (let i = 0; i < n; i++) {
      // The rolled size, then a per-rock jitter on top. Applied HERE rather than at draw time
      // because the radius is also the hitbox — a rock drawn bigger than it collides would be
      // scenery you can walk through, which is the one thing an obstacle must never be.
      const js = (rng() * 2 - 1) * TERRAIN_TUNE.sizeVary;
      const r = between(TERRAIN_TUNE.minRadius, TERRAIN_TUNE.maxRadius, rng)
        * (isRidge ? 0.72 : 1) * (1 + js);
      // A ridge drifts as it goes, so it curves instead of reading as a drawn line.
      const drift = (rng() - 0.5) * 0.5;
      const x = cx + Math.cos(ang + drift * i) * step * i;
      const y = cy + Math.sin(ang + drift * i) * step * i;
      if (Math.hypot(x, y) > lim || Math.hypot(x, y) < TERRAIN_TUNE.clearRadius) continue;
      // A jagged silhouette, baked once at generation. Stored as radius factors around the
      // circle so the drawn shape and the circular hitbox can never drift apart: the collision
      // radius is the shape's OUTER bound, and every vertex sits at or inside it, so nothing is
      // ever blocked by empty space it can see through.
      const sides = 7 + Math.floor(rng() * 4);
      const poly = [];
      for (let k = 0; k < sides; k++) {
        poly.push({
          a: (k / sides) * Math.PI * 2 + (rng() - 0.5) * 0.35,
          f: 0.74 + rng() * 0.26,
        });
      }
      // jh/jl are the rock's own identity: rolled once, scaled by the variance dials at draw.
      t.rocks.push({ x, y, r, seed: rng() * 1000, poly,
        jh: rng() * 2 - 1, jl: rng() * 2 - 1 });
    }
    if (t.rocks.length >= TERRAIN_TUNE.clusters * (isRidge ? TERRAIN_TUNE.ridgeLength : 1)) break;
  }
  t.index();
  buildOutlines(t);
  return t;
}

// ---------- Union outlines ----------
// Rocks are drawn as black shapes with a light edge, and overlapping ones therefore showed their
// internal edges crossing each other — one outcrop read as three blobs sharing a shadow. What is
// wanted is the UNION: a single continuous silhouette around the whole formation.
//
// Computed once here, in world space, rather than per frame. The alternative (compositing the
// outline out of an offscreen canvas every frame) costs a full-screen pass forever; a traced
// path costs one fill and one stroke per formation and never changes until the arena is rebuilt.
// Everything else about a rock is untouched — collision is still the circles, and regenerating
// with new dials re-traces from the new layout.

/** Vertical squash applied when a rock is drawn; the union has to be traced on that same shape. */
export const ROCK_SQUASH = 0.9;
/** Grid pitch for the contour trace, in world px. Small enough that the seam between two rocks
 *  disappears, large enough that a 26-formation arena traces in a few milliseconds. */
const TRACE_CELL = 3;

/** The drawn (squashed) vertex ring for one rock, in world space. */
function rockPolygon(o) {
  return o.poly.map((v) => ({
    x: o.x + Math.cos(v.a) * o.r * v.f,
    y: o.y + Math.sin(v.a) * o.r * v.f * ROCK_SQUASH,
  }));
}

function pointInPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Group rocks into connected components — two rocks join a formation when their drawn discs
 * overlap, so a ridge of touching boulders becomes one shape and a lone boulder stays itself.
 */
function clusterRocks(rocks) {
  const parent = rocks.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let i = 0; i < rocks.length; i++) {
    for (let j = i + 1; j < rocks.length; j++) {
      const a = rocks[i], b = rocks[j];
      // Generous: a hair of separation still reads as one formation once both are black.
      if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.98) join(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < rocks.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(rocks[i]);
  }
  return [...groups.values()];
}

/**
 * Marching squares over the cluster, linked into closed rings.
 *
 * Chosen over a analytic polygon-union because the input is a dozen jittered rings that touch,
 * nest and share vertices — every degenerate case a boolean-ops routine has to be careful about,
 * and none of which a sampled contour notices. The grid is the only approximation, and at a 3px
 * pitch followed by the smoothing pass below it is invisible at play size.
 */
function traceCluster(rocks) {
  const polys = rocks.map(rockPolygon);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (const v of p) {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
  }
  const pad = TRACE_CELL * 2;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const cols = Math.ceil((maxX - minX) / TRACE_CELL) + 1;
  const rows = Math.ceil((maxY - minY) / TRACE_CELL) + 1;
  // Sample the union once per grid corner.
  const inside = new Uint8Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const wx = minX + gx * TRACE_CELL, wy = minY + gy * TRACE_CELL;
      let hit = 0;
      for (const p of polys) if (pointInPoly(p, wx, wy)) { hit = 1; break; }
      inside[gy * cols + gx] = hit;
    }
  }
  // Each cell emits the segments its corner pattern implies, on midpoints of the crossed edges.
  const key = (x, y) => `${Math.round(x * 2)},${Math.round(y * 2)}`;
  const segs = [];
  for (let gy = 0; gy < rows - 1; gy++) {
    for (let gx = 0; gx < cols - 1; gx++) {
      const tl = inside[gy * cols + gx], tr = inside[gy * cols + gx + 1];
      const br = inside[(gy + 1) * cols + gx + 1], bl = inside[(gy + 1) * cols + gx];
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      const x0 = minX + gx * TRACE_CELL, y0 = minY + gy * TRACE_CELL;
      const h = TRACE_CELL / 2;
      const T = { x: x0 + h, y: y0 }, R = { x: x0 + TRACE_CELL, y: y0 + h };
      const B = { x: x0 + h, y: y0 + TRACE_CELL }, L = { x: x0, y: y0 + h };
      const push = (a, b) => segs.push([a, b]);
      // The two saddle cases (5, 10) are split the same way every time; on a shape this dense
      // either choice closes, and consistency is what keeps the rings linkable.
      switch (code) {
        case 1: case 14: push(L, B); break;
        case 2: case 13: push(B, R); break;
        case 3: case 12: push(L, R); break;
        case 4: case 11: push(T, R); break;
        case 6: case 9: push(T, B); break;
        case 7: case 8: push(L, T); break;
        case 5: push(L, T); push(B, R); break;
        case 10: push(L, B); push(T, R); break;
        default: break;
      }
    }
  }
  if (!segs.length) return [];
  // Link segments into closed rings, IGNORING their direction.
  //
  // The switch above pairs each corner pattern with its complement (1 with 14, 3 with 12, …)
  // because both describe the same edge — but they describe it with opposite winding, since
  // which side is "inside" has flipped. Walking start-to-end therefore stalled at the first
  // flipped segment and began a second ring from it, so every formation traced twice: two
  // half-rings of opposite winding, which cancel each other out under a nonzero fill and left
  // the rock hollow. Matching on either endpoint links each boundary into exactly one ring.
  const inc = new Map();
  for (const s of segs) {
    for (const end of [0, 1]) {
      const k = key(s[end].x, s[end].y);
      if (!inc.has(k)) inc.set(k, []);
      inc.get(k).push({ s, end });
    }
  }
  const used = new Set();
  const rings = [];
  for (const s0 of segs) {
    if (used.has(s0)) continue;
    used.add(s0);
    const ring = [s0[0], s0[1]];
    let cur = s0[1];
    for (let guard = 0; guard < segs.length * 2 + 8; guard++) {
      const cands = inc.get(key(cur.x, cur.y)) || [];
      const nxt = cands.find((c) => !used.has(c.s));
      if (!nxt) break;
      used.add(nxt.s);
      cur = nxt.s[1 - nxt.end];       // step to the far end, whichever way it was stored
      ring.push(cur);
    }
    if (ring.length > 6) rings.push(ring);
  }
  // Chaikin smoothing: two passes turns the grid's stair-steps into the weathered curve the
  // hand-jittered polygons had before they were unioned.
  const smooth = (ring) => {
    let pts = ring;
    for (let pass = 0; pass < 2; pass++) {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
        out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      pts = out;
    }
    return pts;
  };
  return rings.map(smooth);
}

/** Attach `t.outlines`: one entry per formation, each with its rings and a screen-cull box. */
function buildOutlines(t) {
  t.outlines = [];
  for (const group of clusterRocks(t.rocks)) {
    const rings = traceCluster(group);
    if (!rings.length) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of rings) for (const p of ring) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    t.outlines.push({ rings, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
      radius: Math.hypot(maxX - minX, maxY - minY) / 2 });
  }
}
