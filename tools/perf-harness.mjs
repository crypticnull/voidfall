// ---------- Projectile / collision frame-budget harness ----------
// Answers one question with numbers instead of intuition: where does the frame actually go when
// a build stacks projectiles, and is "100 projectiles" a hardware limit or an implementation one?
//
// It runs the REAL spatial grid and the REAL swept-collision test, lifted verbatim from main.js
// rather than reimplemented — a harness that models its own idea of the hot loop measures its own
// idea of the cost. Rendering is excluded on purpose: it is GPU-batched and roughly flat in
// projectile count, whereas the broadphase is the part that scales with projectiles x enemies,
// and mixing the two hides which is which.
//
// Node, not the browser, so a run is repeatable and comparable across sessions — no compositor,
// no vsync, no background tab throttling.
//
//   node tools/perf-harness.mjs                    default sweep
//   node tools/perf-harness.mjs --proj 100 --enemies 500 --frames 600
//   node tools/perf-harness.mjs --variant all      compare candidate optimisations

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : dflt;
};
const flag = (name) => args.includes(`--${name}`);
const argStr = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};

const ARENA = 1400;          // matches ARENA_RADIUS closely enough for density to be honest
const GRID_CELL = 128;       // must track main.js
const DT = 1 / 60;

// ---------- world ----------
function makeEnemies(n, rng) {
  const out = [];
  for (let i = 0; i < n; i++) {
    // Radii sampled from the real roster: mostly small bodies with a FEW large ones. 2%, not
    // 10% — a wave carries an ogre or two among hundreds of shamblers, and the ratio decides
    // whether size-bucketing can pay for itself. Getting this wrong made bucketing look like a
    // regression on the first run, because brute-forcing fifty "large" bodies per projectile is
    // obviously worse than gridding them.
    const r = rng() < 0.98 ? 9 + rng() * 12 : 26 + rng() * 16;
    const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * ARENA;
    out.push({
      id: i, dead: false, radius: r,
      x: Math.cos(a) * d, y: Math.sin(a) * d,
      vx: (rng() - 0.5) * 120, vy: (rng() - 0.5) * 120,
      hp: 100,
    });
  }
  return out;
}

function makeProjectiles(n, rng) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const speed = 450 + rng() * 350;
    out.push({
      id: i, dead: false, radius: 5 + rng() * 10,
      x: (rng() - 0.5) * 300, y: (rng() - 0.5) * 300,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      hitSet: new Set(), hitArr: [], pierce: 3,
      // Staggered lifetimes. Projectiles are short-lived and constantly replaced; without
      // turnover every one of them ends up having already hit everything nearby, the dedupe
      // short-circuits fire on every candidate, and the loop measures itself doing nothing.
      life: 0.4 + rng() * 1.4, maxLife: 0.4 + rng() * 1.4,
    });
  }
  return out;
}

// Deterministic RNG so two runs are comparable. A harness whose input changes between runs
// cannot measure a 5% improvement.
function mulberry32(seed) {
  return function rng() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- the real broadphase, verbatim ----------
const cellKey = (cx, cy) => cx * 100000 + cy;

function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

class World {
  constructor(enemies) {
    this.enemies = enemies;
    this.grid = new Map();
    this.maxRadius = 0;
    // Buckets for the "size classes" variant: most bodies are small, so a global max radius
    // makes every query pay for the largest thing on the field.
    this.smallGrid = new Map();
    this.bigList = [];
    this.smallMax = 0;
    this.scratch = [];
    this.stats = { candidates: 0, exactTests: 0, hits: 0, cells: 0 };
  }

  rebuild(useBuckets) {
    this.grid.clear(); this.smallGrid.clear();
    this.bigList.length = 0;
    this.maxRadius = 0; this.smallMax = 0;
    const BIG = 20;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.radius > this.maxRadius) this.maxRadius = e.radius;
      const k = cellKey(Math.floor(e.x / GRID_CELL), Math.floor(e.y / GRID_CELL));
      const cell = this.grid.get(k);
      if (cell) cell.push(e); else this.grid.set(k, [e]);
      if (useBuckets) {
        if (e.radius >= BIG) { this.bigList.push(e); } else {
          if (e.radius > this.smallMax) this.smallMax = e.radius;
          const c2 = this.smallGrid.get(k);
          if (c2) c2.push(e); else this.smallGrid.set(k, [e]);
        }
      }
    }
  }

  step(dt) {
    for (const e of this.enemies) {
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (Math.abs(e.x) > ARENA) e.vx = -e.vx;
      if (Math.abs(e.y) > ARENA) e.vy = -e.vy;
    }
  }
}

// ---------- variants ----------
// Each takes the same world and projectile set and does the same work; they differ only in HOW.
const VARIANTS = {
  // What ships today: allocate a candidate array per projectile, widen by the global max radius,
  // dedupe hits through a Set.
  current(w, projs, dt) {
    for (const p of projs) {
      if (p.dead) continue;
      const sx = p.x - p.vx * dt, sy = p.y - p.vy * dt;
      const range = p.radius + w.maxRadius + Math.hypot(p.x - sx, p.y - sy) / 2;
      const near = [];
      const r2 = range * range;
      const minX = Math.floor((p.x - range) / GRID_CELL), maxX = Math.floor((p.x + range) / GRID_CELL);
      const minY = Math.floor((p.y - range) / GRID_CELL), maxY = Math.floor((p.y + range) / GRID_CELL);
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cy = minY; cy <= maxY; cy++) {
          w.stats.cells++;
          const cell = w.grid.get(cellKey(cx, cy));
          if (!cell) continue;
          for (const e of cell) {
            if (e.dead) continue;
            const dx = p.x - e.x, dy = p.y - e.y;
            if (dx * dx + dy * dy <= r2) near.push(e);
          }
        }
      }
      w.stats.candidates += near.length;
      for (const e of near) {
        if (e.dead || p.hitSet.has(e.id)) continue;
        w.stats.exactTests++;
        if (segDist(sx, sy, p.x, p.y, e.x, e.y) > p.radius + e.radius) continue;
        p.hitSet.add(e.id);
        w.stats.hits++;
      }
    }
  },

  // Same maths, no per-projectile array: the cell walk tests exactly where it stands.
  noalloc(w, projs, dt) {
    for (const p of projs) {
      if (p.dead) continue;
      const sx = p.x - p.vx * dt, sy = p.y - p.vy * dt;
      const range = p.radius + w.maxRadius + Math.hypot(p.x - sx, p.y - sy) / 2;
      const minX = Math.floor((p.x - range) / GRID_CELL), maxX = Math.floor((p.x + range) / GRID_CELL);
      const minY = Math.floor((p.y - range) / GRID_CELL), maxY = Math.floor((p.y + range) / GRID_CELL);
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cy = minY; cy <= maxY; cy++) {
          w.stats.cells++;
          const cell = w.grid.get(cellKey(cx, cy));
          if (!cell) continue;
          for (const e of cell) {
            if (e.dead || p.hitSet.has(e.id)) continue;
            w.stats.candidates++;
            w.stats.exactTests++;
            if (segDist(sx, sy, p.x, p.y, e.x, e.y) > p.radius + e.radius) continue;
            p.hitSet.add(e.id);
            w.stats.hits++;
          }
        }
      }
    }
  },

  // No allocation, and hits deduped through a short array instead of a Set. Most projectiles
  // touch a handful of bodies; a linear scan of 4 wins against hashing.
  noallocarr(w, projs, dt) {
    for (const p of projs) {
      if (p.dead) continue;
      const sx = p.x - p.vx * dt, sy = p.y - p.vy * dt;
      const range = p.radius + w.maxRadius + Math.hypot(p.x - sx, p.y - sy) / 2;
      const minX = Math.floor((p.x - range) / GRID_CELL), maxX = Math.floor((p.x + range) / GRID_CELL);
      const minY = Math.floor((p.y - range) / GRID_CELL), maxY = Math.floor((p.y + range) / GRID_CELL);
      const hit = p.hitArr;
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cy = minY; cy <= maxY; cy++) {
          w.stats.cells++;
          const cell = w.grid.get(cellKey(cx, cy));
          if (!cell) continue;
          for (const e of cell) {
            if (e.dead) continue;
            let seen = false;
            for (let i = 0; i < hit.length; i++) if (hit[i] === e.id) { seen = true; break; }
            if (seen) continue;
            w.stats.candidates++;
            w.stats.exactTests++;
            if (segDist(sx, sy, p.x, p.y, e.x, e.y) > p.radius + e.radius) continue;
            hit.push(e.id);
            w.stats.hits++;
          }
        }
      }
    }
  },

  // Everything above, plus size bucketing: small bodies widen by the small-body max only, and
  // the handful of large ones are tested directly. One ogre no longer taxes every query.
  buckets(w, projs, dt) {
    for (const p of projs) {
      if (p.dead) continue;
      const sx = p.x - p.vx * dt, sy = p.y - p.vy * dt;
      const travel = Math.hypot(p.x - sx, p.y - sy) / 2;
      const range = p.radius + w.smallMax + travel;
      const minX = Math.floor((p.x - range) / GRID_CELL), maxX = Math.floor((p.x + range) / GRID_CELL);
      const minY = Math.floor((p.y - range) / GRID_CELL), maxY = Math.floor((p.y + range) / GRID_CELL);
      const hit = p.hitArr;
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cy = minY; cy <= maxY; cy++) {
          w.stats.cells++;
          const cell = w.smallGrid.get(cellKey(cx, cy));
          if (!cell) continue;
          for (const e of cell) {
            if (e.dead) continue;
            let seen = false;
            for (let i = 0; i < hit.length; i++) if (hit[i] === e.id) { seen = true; break; }
            if (seen) continue;
            w.stats.candidates++;
            w.stats.exactTests++;
            if (segDist(sx, sy, p.x, p.y, e.x, e.y) > p.radius + e.radius) continue;
            hit.push(e.id);
            w.stats.hits++;
          }
        }
      }
      // The big ones, brute force — there are only ever a few, and skipping the grid for them
      // is cheaper than making every small query pay their radius.
      for (const e of w.bigList) {
        if (e.dead) continue;
        let seen = false;
        for (let i = 0; i < hit.length; i++) if (hit[i] === e.id) { seen = true; break; }
        if (seen) continue;
        w.stats.candidates++;
        w.stats.exactTests++;
        if (segDist(sx, sy, p.x, p.y, e.x, e.y) > p.radius + e.radius) continue;
        hit.push(e.id);
        w.stats.hits++;
      }
    }
  },
};

// ---------- run ----------
function run(variant, nProj, nEnemy, frames, seed = 12345) {
  const rng = mulberry32(seed);
  const enemies = makeEnemies(nEnemy, rng);
  const projs = makeProjectiles(nProj, rng);
  const w = new World(enemies);
  const useBuckets = variant === 'buckets';
  const fn = VARIANTS[variant];

  // Warm up so the JIT has tiered up before anything is timed.
  for (let i = 0; i < 120; i++) {
    for (const p of projs) { p.hitSet.clear(); p.hitArr.length = 0; }
    w.rebuild(useBuckets); fn(w, projs, DT);
  }
  for (const p of projs) { p.hitSet.clear(); p.hitArr.length = 0; }
  w.stats = { candidates: 0, exactTests: 0, hits: 0, cells: 0 };

  const samples = [];
  let rebuildTotal = 0;
  for (let f = 0; f < frames; f++) {
    // Turnover: a projectile that runs out of life is replaced by a fresh one at the player,
    // with empty hit memory. This is what keeps the measurement honest — a static set of
    // long-lived projectiles converges on "already hit everything" and stops doing work.
    for (const p of projs) {
      p.life -= DT;
      if (p.life > 0) continue;
      p.life = p.maxLife;
      p.hitSet.clear(); p.hitArr.length = 0;
      const a = rng() * Math.PI * 2, speed = 450 + rng() * 350;
      p.x = (rng() - 0.5) * 120; p.y = (rng() - 0.5) * 120;
      p.vx = Math.cos(a) * speed; p.vy = Math.sin(a) * speed;
    }
    w.step(DT);
    let t = process.hrtime.bigint();
    w.rebuild(useBuckets);
    rebuildTotal += Number(process.hrtime.bigint() - t) / 1e6;
    t = process.hrtime.bigint();
    fn(w, projs, DT);
    samples.push(Number(process.hrtime.bigint() - t) / 1e6);
    for (const p of projs) {
      p.x += p.vx * DT; p.y += p.vy * DT;
      if (Math.abs(p.x) > ARENA) p.vx = -p.vx;
      if (Math.abs(p.y) > ARENA) p.vy = -p.vy;
    }
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
  return {
    variant, nProj, nEnemy,
    mean, p95: samples[Math.floor(samples.length * 0.95)], max: samples[samples.length - 1],
    rebuild: rebuildTotal / frames,
    perFrame: {
      cells: w.stats.cells / frames,
      candidates: w.stats.candidates / frames,
      exact: w.stats.exactTests / frames,
    },
  };
}

const BUDGET = 1000 / 60; // 16.67ms
const pct = (ms) => `${((ms / BUDGET) * 100).toFixed(1)}%`;

function report(rows) {
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log(`\n  frame budget @60fps = ${BUDGET.toFixed(2)}ms\n`);
  console.log(`  ${pad('variant', 12)}${padL('proj', 6)}${padL('enemies', 9)}` +
    `${padL('collide', 10)}${padL('grid', 8)}${padL('p95', 9)}${padL('of budget', 11)}` +
    `${padL('cells/f', 10)}${padL('tests/f', 10)}`);
  console.log('  ' + '-'.repeat(85));
  for (const r of rows) {
    console.log(`  ${pad(r.variant, 12)}${padL(r.nProj, 6)}${padL(r.nEnemy, 9)}` +
      `${padL(r.mean.toFixed(2) + 'ms', 10)}${padL(r.rebuild.toFixed(2), 8)}` +
      `${padL(r.p95.toFixed(2) + 'ms', 9)}${padL(pct(r.mean + r.rebuild), 11)}` +
      `${padL(Math.round(r.perFrame.cells), 10)}${padL(Math.round(r.perFrame.exact), 10)}`);
  }
  console.log('');
}

const frames = arg('frames', 400);
const variant = argStr('variant', null);

if (variant === 'all') {
  const nProj = arg('proj', 100), nEnemy = arg('enemies', 500);
  report(Object.keys(VARIANTS).map((v) => run(v, nProj, nEnemy, frames)));
} else if (variant) {
  report([run(variant, arg('proj', 100), arg('enemies', 500), frames)]);
} else if (flag('sweep')) {
  const rows = [];
  for (const n of [10, 25, 50, 100, 200, 400]) rows.push(run('current', n, arg('enemies', 500), frames));
  report(rows);
} else {
  // Default: the scaling sweep AND the variant comparison at the headline load, which together
  // answer "how bad is it" and "is it inherent".
  const rows = [];
  for (const n of [10, 50, 100, 200]) rows.push(run('current', n, 500, frames));
  report(rows);
  report(Object.keys(VARIANTS).map((v) => run(v, 100, 500, frames)));
}
