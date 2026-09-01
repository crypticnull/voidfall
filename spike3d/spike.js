// ---------- The 3D port spike ----------
// One question, answered small: does the 11-method `world` seam hold — can the REAL skill
// layer, unmodified, drive a 3D game it has never heard of?
//
// The import below is the whole experiment. It is the same module the shipping 2D game runs,
// served from the same path, carrying today's baked tuning. Nothing in src/ was touched to
// make this page work; if that import needed an edit, the seam would be a hope rather than a
// boundary and a 3D fork would mean maintaining two design layers forever.
//
// Everything else in this file is deliberately disposable: a stub engine (spawn, move, collide,
// die) and a hand-rolled third-person renderer (perspective projection onto Canvas 2D, painter
// sort). Neither is proposed as the real 3D engine — they exist so the seam has something to
// push against.
//
// THE DIMENSIONAL TRICK, stated once: the sim stays 2D. Skills think in (x, y) on a plane, and
// the renderer maps sim (x, y) -> world (X, Z) with Y as height. That is the "stays on a ground
// plane" assumption from the feasibility read — nothing here would survive true verticality.
import { SKILLS } from '../src/skills.js';

// ---------- sim state (the stub engine's world) ----------
const S = {
  player: { x: 0, y: 0, radius: 14, faceAng: 0, walkPhase: 0, moving: false },
  enemies: [],
  projectiles: [],
  pending: [],       // spawnProjectile specs still waiting on their volley delay
  effects: [],       // explosions, corpse-sinks — anything with { t, duration }
  numbers: [],       // floating damage text
  time: 0,
};
const stats = { casts: 0, bolts: 0, hits: 0, kills: 0, sfx: 0 };
// Which of the eleven seam methods this skill actually exercised — reported on the HUD so the
// spike states its own result.
const seamCalls = {};
const count = (name) => { seamCalls[name] = (seamCalls[name] || 0) + 1; };

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// ---------- THE SEAM ----------
// All eleven methods skills.js is known to call, implemented against the stub engine. Fireball
// needs three (findNearest, playSfx, spawnProjectile); the rest are here so the adapter is the
// full contract rather than a fireball-shaped keyhole, and so pointing a second skill at this
// world is a one-line change.
const world = {
  findNearest(x, y, range) {
    count('findNearest');
    let best = null, bestD = range;
    for (const e of S.enemies) {
      if (e.dead) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  },
  enemiesInRange(x, y, r) {
    count('enemiesInRange');
    return S.enemies.filter((e) => !e.dead && dist(x, y, e.x, e.y) <= r);
  },
  damageEnemy(e, dmg, mods, opts = {}) {
    count('damageEnemy');
    if (e.dead) return;
    let final = dmg;
    let crit = false;
    if (mods && Math.random() < (mods.critChance || 0)) { final *= mods.critMult || 1.5; crit = true; }
    e.hp -= final;
    stats.hits++;
    S.numbers.push({ x: e.x, y: e.y, h: 46, t: 0, life: 0.8, text: String(Math.round(final)), crit });
    if (opts.knockback) {
      const n = Math.hypot(e.x - S.player.x, e.y - S.player.y) || 1;
      e.x += ((e.x - S.player.x) / n) * opts.knockback * 0.2;
      e.y += ((e.y - S.player.y) / n) * opts.knockback * 0.2;
    }
    if (e.hp <= 0) {
      e.dead = true;
      stats.kills++;
      S.effects.push({ kind: 'corpse', x: e.x, y: e.y, yaw: e.yaw, t: 0, duration: 0.7, size: e.radius });
    }
  },
  spawnProjectile(p) {
    count('spawnProjectile');
    stats.bolts++;
    if (p.delay > 0) S.pending.push({ ...p });
    else S.projectiles.push({ ...p, t: 0 });
  },
  spawnEffect(o) {
    count('spawnEffect');
    S.effects.push({ duration: 0.5, t: 0, ...o });
  },
  refreshEffect(kind, opts, keep = []) {
    count('refreshEffect');
    const live = S.effects.find((fx) => fx.kind === kind && !fx.dead);
    if (!live) { S.effects.push({ duration: 0.5, t: 0, ...opts }); return; }
    for (const [k, v] of Object.entries(opts)) if (k !== 'kind' && !keep.includes(k)) live[k] = v;
  },
  playSfx() { count('playSfx'); stats.sfx++; },
  spawnMinion() { count('spawnMinion'); },
  countMinions() { count('countMinions'); return 0; },
  markVoid() { count('markVoid'); },
  collapse() { count('collapse'); },
};

// Stand-in for computeMods — same shape the smoke suite uses. projectileBonus 2 on purpose:
// a three-bolt volley exercises the spread/stagger/jitter maths, so the 3D bolts fan and
// ripple exactly the way the 2D ones do, from the same code.
const mods = {
  damageMult: 1, areaMult: 1, durationMult: 1, sizeMult: 1, speedMult: 1, cooldownMult: 1,
  projectileBonus: 2, chainBonus: 0, forkBonus: 0, pierceBonus: 0,
  lifeLeech: 0, critChance: 0.08, critMult: 1.6, infusions: [],
};
const SKILL_LEVEL = 3;

// ---------- stub engine ----------
const ENEMY_TARGET = 14;
function spawnEnemy() {
  const a = Math.random() * Math.PI * 2;
  const r = 500 + Math.random() * 380;
  S.enemies.push({
    id: Math.random().toString(36).slice(2),
    x: S.player.x + Math.cos(a) * r, y: S.player.y + Math.sin(a) * r,
    radius: 13 + Math.random() * 5, hp: 90, maxHp: 90,
    speed: 55 + Math.random() * 35, yaw: 0, walkPhase: Math.random() * 7, dead: false,
  });
}

let castTimer = 0.6;
function updateSim(dt) {
  S.time += dt;

  // The cast clock — main.js's `s.cd` loop, reduced to its essence. The cadence itself comes
  // from the tune block, so today's baked 1.3s cooldown is what fires here.
  castTimer -= dt;
  if (castTimer <= 0) {
    castTimer = SKILLS.fireball.tune.cooldown * mods.cooldownMult;
    const before = stats.bolts;
    SKILLS.fireball.cast({
      player: S.player, level: SKILL_LEVEL, mods, world,
      facing: { x: Math.cos(S.player.faceAng), y: Math.sin(S.player.faceAng) },
      skill: { id: 'fireball', level: SKILL_LEVEL },
    });
    if (stats.bolts > before) stats.casts++;   // cast() returns silently with no target in range
  }

  // Volley delays — updatePendingShots, spike-sized.
  for (const p of S.pending) p.delay -= dt;
  for (let i = S.pending.length - 1; i >= 0; i--) {
    if (S.pending[i].delay <= 0) { S.projectiles.push({ ...S.pending[i], t: 0 }); S.pending.splice(i, 1); }
  }

  // Projectiles: fly, expire, detonate on first body. aoeRadius came from the cast already
  // multiplied by mods.areaMult — the engine just honours the numbers the skill sent.
  for (const p of S.projectiles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.t += dt;
    if (p.t >= p.life) { p.dead = true; continue; }
    for (const e of S.enemies) {
      if (e.dead) continue;
      if (dist(p.x, p.y, e.x, e.y) <= p.radius + e.radius) {
        for (const hit of world.enemiesInRange(p.x, p.y, p.aoeRadius)) {
          world.damageEnemy(hit, p.damage, p.mods, { knockback: 30 });
        }
        S.effects.push({ kind: 'explosion', x: p.x, y: p.y, t: 0, duration: 0.45, radius: p.aoeRadius });
        p.dead = true;
        break;
      }
    }
  }
  S.projectiles = S.projectiles.filter((p) => !p.dead);

  // Enemies shamble in. Contact does nothing — the spike has no health bar to threaten, and
  // player damage proves nothing about the seam.
  for (const e of S.enemies) {
    if (e.dead) continue;
    const d = dist(e.x, e.y, S.player.x, S.player.y);
    e.yaw = Math.atan2(S.player.x - e.x, S.player.y - e.y);
    if (d > e.radius + S.player.radius + 14) {
      e.x += ((S.player.x - e.x) / d) * e.speed * dt;
      e.y += ((S.player.y - e.y) / d) * e.speed * dt;
      e.walkPhase += dt * 7;
    }
    // Cheap pairwise separation so the horde RINGS the player instead of stacking into one
    // column of geometry — in 3D an overlap reads as a glitch, where in 2D it read as a crowd.
    for (const o of S.enemies) {
      if (o === e || o.dead) continue;
      const od = dist(e.x, e.y, o.x, o.y), min = e.radius + o.radius;
      if (od > 0 && od < min) {
        e.x += ((e.x - o.x) / od) * (min - od) * 0.5;
        e.y += ((e.y - o.y) / od) * (min - od) * 0.5;
      }
    }
  }
  S.enemies = S.enemies.filter((e) => !e.dead);
  while (S.enemies.length < ENEMY_TARGET) spawnEnemy();

  for (const fx of S.effects) fx.t += dt;
  S.effects = S.effects.filter((fx) => fx.t < fx.duration);
  for (const n of S.numbers) { n.t += dt; n.h += 42 * dt; }
  S.numbers = S.numbers.filter((n) => n.t < n.life);
}

// ---------- input: WASD moves, drag / Q / E orbits ----------
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
let camYaw = 0.6;
let dragging = false, lastMX = 0;
addEventListener('mousedown', (e) => { dragging = true; lastMX = e.clientX; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (dragging) { camYaw -= (e.clientX - lastMX) * 0.005; lastMX = e.clientX; }
});

const PLAYER_SPEED = 210;
function updatePlayer(dt) {
  if (keys.has('q')) camYaw += 1.6 * dt;
  if (keys.has('e')) camYaw -= 1.6 * dt;
  // Camera-relative movement: W walks away from the camera, the third-person convention.
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  let ix = 0, iz = 0;
  if (keys.has('w')) iz += 1;
  if (keys.has('s')) iz -= 1;
  if (keys.has('a')) ix -= 1;
  if (keys.has('d')) ix += 1;
  const len = Math.hypot(ix, iz);
  S.player.moving = len > 0;
  if (len > 0) {
    // Sim (x, y) IS world (X, Z) — one line of mapping, which is the ground-plane claim made real.
    S.player.x += ((rx * ix + fx * iz) / len) * PLAYER_SPEED * dt;
    S.player.y += ((rz * ix + fz * iz) / len) * PLAYER_SPEED * dt;
    S.player.walkPhase += dt * 8;
  }
  // Face the nearest threat while one is in the skill's own reach; otherwise face where you walk.
  const t = world.findNearest(S.player.x, S.player.y, SKILLS.fireball.tune.targetRange);
  if (t) S.player.faceAng = Math.atan2(t.y - S.player.y, t.x - S.player.x);
  else if (len > 0) S.player.faceAng = Math.atan2(rz * ix + fz * iz, rx * ix + fx * iz);
}

// ---------- renderer: third person, hand-rolled ----------
const cv = document.getElementById('spike');
const g = cv.getContext('2d');
let W = 0, H = 0, FOCAL = 0;
function fit() {
  W = cv.width = innerWidth * devicePixelRatio;
  H = cv.height = innerHeight * devicePixelRatio;
  FOCAL = H * 1.05;
}
addEventListener('resize', fit); fit();

const CAM_DIST = 330, CAM_H = 195, LOOK_H = 34, NEAR = 12, FOG = 1750;
let eye = { x: 0, y: 0, z: 0 }, pitch = 0;

function project(wx, wy, wz) {
  // World -> view: translate to the eye, yaw about Y, pitch about X, perspective divide.
  const tx = wx - eye.x, ty = wy - eye.y, tz = wz - eye.z;
  const c = Math.cos(camYaw), s = Math.sin(camYaw);
  const xr = tx * c - tz * s;
  const zr = tx * s + tz * c;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const yr = ty * cp + zr * sp;
  const zf = zr * cp - ty * sp;
  if (zf < NEAR) return null;
  return { x: W / 2 + (xr / zf) * FOCAL, y: H / 2 - (yr / zf) * FOCAL, z: zf };
}

const LIGHT = (() => { const l = { x: 0.45, y: 0.8, z: -0.3 }; const n = Math.hypot(l.x, l.y, l.z); return { x: l.x / n, y: l.y / n, z: l.z / n }; })();
const fog = (z) => Math.max(0, 1 - z / FOG);
let drawList = [];

function shadeColor(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.min(255, Math.round(((n >> v) & 255) * k));
  return `rgb(${f(16)},${f(8)},${f(0)})`;
}

/** An axis-defined box at (x, z) on the ground, yawed, faces lit and painter-sorted. */
function box(cx, baseY, cz, w, h, d, yaw, color) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const rot = (px, pz) => ({ x: cx + px * c - pz * s, z: cz + px * s + pz * c });
  const corners = [];
  for (const [px, py, pz] of [[-w/2,0,-d/2],[w/2,0,-d/2],[w/2,0,d/2],[-w/2,0,d/2],
                              [-w/2,h,-d/2],[w/2,h,-d/2],[w/2,h,d/2],[-w/2,h,d/2]]) {
    const r = rot(px, pz);
    corners.push({ x: r.x, y: baseY + py, z: r.z });
  }
  const faces = [
    { idx: [4,5,6,7], n: { x: 0, y: 1, z: 0 } },                       // top
    { idx: [0,1,5,4], n: { x: -s, y: 0, z: -c } },                     // -d side
    { idx: [2,3,7,6], n: { x: s, y: 0, z: c } },                       // +d side
    { idx: [1,2,6,5], n: { x: c, y: 0, z: -s } },                      // +w side
    { idx: [3,0,4,7], n: { x: -c, y: 0, z: s } },                      // -w side
  ];
  for (const f of faces) {
    const pts = f.idx.map((i) => project(corners[i].x, corners[i].y, corners[i].z));
    if (pts.some((p) => !p)) continue;
    const mid = f.idx.reduce((a, i) => ({ x: a.x + corners[i].x / 4, y: a.y + corners[i].y / 4, z: a.z + corners[i].z / 4 }), { x: 0, y: 0, z: 0 });
    // Backface cull against the actual eye ray, so only the visible three faces draw.
    if (f.n.x * (mid.x - eye.x) + f.n.y * (mid.y - eye.y) + f.n.z * (mid.z - eye.z) > 0) continue;
    const lum = 0.42 + 0.58 * Math.max(0, f.n.x * LIGHT.x + f.n.y * LIGHT.y + f.n.z * LIGHT.z);
    const depth = pts.reduce((a, p) => a + p.z, 0) / 4;
    const a = fog(depth);
    if (a <= 0.02) continue;
    drawList.push({ z: depth, draw() {
      g.globalAlpha = a;
      g.fillStyle = shadeColor(color, lum);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath(); g.fill();
      g.globalAlpha = 1;
    } });
  }
}

/** Blocky figure: legs that swing with a walk phase, torso, head, arms. Palette per faction. */
function humanoid(x, z, yaw, phase, pal, scale = 1, sink = 0) {
  const sw = Math.sin(phase) * 0.55;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const hip = (14 - sink * 14) * scale;
  const leg = (px) => box(x + px * c * scale, -sink * 44 * scale, z + px * s * scale, 5 * scale, hip, 6 * scale, yaw + 0, pal.legs);
  // Legs offset sideways from the facing axis, each thrown fore/aft by the swing.
  box(x - s * 4 * scale + Math.sin(yaw) * sw * 6 * scale, -sink * 44 * scale, z + c * 4 * scale + Math.cos(yaw) * sw * 6 * scale, 5.5 * scale, hip, 6 * scale, yaw, pal.legs);
  box(x + s * 4 * scale - Math.sin(yaw) * sw * 6 * scale, -sink * 44 * scale, z - c * 4 * scale - Math.cos(yaw) * sw * 6 * scale, 5.5 * scale, hip, 6 * scale, yaw, pal.legs);
  box(x, hip - sink * 44 * scale, z, 15 * scale, 18 * scale, 9 * scale, yaw, pal.torso);
  box(x, hip + 18 * scale - sink * 44 * scale, z, 9 * scale, 9 * scale, 9 * scale, yaw, pal.head);
  // Arms trail the legs in counter-swing.
  box(x - s * 10 * scale - Math.sin(yaw) * sw * 5 * scale, hip + 2 * scale - sink * 44 * scale, z + c * 10 * scale - Math.cos(yaw) * sw * 5 * scale, 4 * scale, 14 * scale, 5 * scale, yaw, pal.arms);
  box(x + s * 10 * scale + Math.sin(yaw) * sw * 5 * scale, hip + 2 * scale - sink * 44 * scale, z - c * 10 * scale + Math.cos(yaw) * sw * 5 * scale, 4 * scale, 14 * scale, 5 * scale, yaw, pal.arms);
  void leg;
}

const PAL_PLAYER = { legs: '#4a3a2c', torso: '#8a90a0', head: '#d8c9a8', arms: '#6a5a44' };
const PAL_ENEMY = { legs: '#3a4432', torso: '#55703f', head: '#8ba06a', arms: '#4a5a3a' };

function billboard(wx, wh, wz, draw) {
  const p = project(wx, wh, wz);
  if (!p) return;
  const a = fog(p.z);
  if (a <= 0.02) return;
  drawList.push({ z: p.z, draw: () => { g.globalAlpha = a; draw(p, FOCAL / p.z); g.globalAlpha = 1; } });
}

function render() {
  drawList = [];
  // Follow camera: behind the player along the yaw, pitched to look at chest height.
  eye = {
    x: S.player.x - Math.sin(camYaw) * CAM_DIST,
    y: CAM_H,
    z: S.player.y - Math.cos(camYaw) * CAM_DIST,
  };
  pitch = Math.atan2(CAM_H - LOOK_H, CAM_DIST);

  // Sky above the horizon, graveyard dirt below it.
  g.fillStyle = '#1c1725'; g.fillRect(0, 0, W, H);
  const hor = project(eye.x + Math.sin(camYaw) * 60000, 0, eye.z + Math.cos(camYaw) * 60000);
  const horY = hor ? hor.y : H * 0.35;
  const sky = g.createLinearGradient(0, 0, 0, horY);
  sky.addColorStop(0, '#0a0812'); sky.addColorStop(1, '#241a2e');
  g.fillStyle = sky; g.fillRect(0, 0, W, Math.max(0, horY));

  // Ground grid, faded by distance — enough parallax to sell the camera without a tile texture.
  const GRID = 130;
  const gx0 = Math.floor((S.player.x - 1500) / GRID) * GRID;
  const gz0 = Math.floor((S.player.y - 1500) / GRID) * GRID;
  g.lineWidth = Math.max(1, devicePixelRatio);
  for (let i = 0; i <= 2 * 1500 / GRID; i++) {
    for (const line of [
      [[gx0 + i * GRID, gz0], [gx0 + i * GRID, gz0 + 3000]],
      [[gx0, gz0 + i * GRID], [gx0 + 3000, gz0 + i * GRID]],
    ]) {
      const a = project(line[0][0], 0, line[0][1]);
      const b = project(line[1][0], 0, line[1][1]);
      if (!a || !b) continue;
      const al = Math.min(fog(a.z), fog(b.z)) * 0.35;
      if (al <= 0.02) continue;
      g.strokeStyle = `rgba(145,128,168,${al * 1.6})`;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
  }

  // A torch pool around the player — the 2D game's whole look is torchlight, and without a
  // splash of it the 3D floor reads as a void rather than as ground.
  billboard(S.player.x, 1, S.player.y, (p, sc) => {
    const r = 320 * sc;
    const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    grad.addColorStop(0, 'rgba(224,160,51,0.16)');
    grad.addColorStop(0.6, 'rgba(160,100,40,0.07)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(p.x, p.y, r, r * 0.42, 0, 0, 7); g.fill();
  });

  // Blob shadows ground everything that stands or flies.
  for (const e of S.enemies) billboard(e.x, 0.5, e.y, (p, sc) => {
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.beginPath(); g.ellipse(p.x, p.y, e.radius * 1.2 * sc, e.radius * 0.5 * sc, 0, 0, 7); g.fill();
  });
  billboard(S.player.x, 0.5, S.player.y, (p, sc) => {
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath(); g.ellipse(p.x, p.y, 18 * sc, 8 * sc, 0, 0, 7); g.fill();
  });

  for (const e of S.enemies) {
    humanoid(e.x, e.y, e.yaw, e.walkPhase, PAL_ENEMY, e.radius / 15);
    if (e.hp < e.maxHp) billboard(e.x, 52 * (e.radius / 15), e.y, (p, sc) => {
      const w = 34 * sc, h = 4.5 * sc;
      g.fillStyle = 'rgba(10,6,10,0.85)'; g.fillRect(p.x - w / 2, p.y, w, h);
      g.fillStyle = '#a13328'; g.fillRect(p.x - w / 2, p.y, w * Math.max(0, e.hp / e.maxHp), h);
    });
  }
  // Model yaw and sim facing use different angle conventions (atan2(dx, dy) vs atan2(dy, dx));
  // this converts between them the same way the enemy yaw above is computed.
  const playerYaw = Math.atan2(Math.cos(S.player.faceAng), Math.sin(S.player.faceAng));
  humanoid(S.player.x, S.player.y, playerYaw, S.player.moving ? S.player.walkPhase : 0, PAL_PLAYER, 1.1);

  // Fireballs: a lit core with two trailing ghosts. The radius is the projectile's own —
  // projSize x sizeMult, straight off the spec the cast sent.
  for (const p of S.projectiles) {
    for (const [back, alpha] of [[0.045, 0.25], [0.022, 0.5], [0, 1]]) {
      const bx = p.x - p.vx * back, by = p.y - p.vy * back;
      billboard(bx, 22, by, (pt, sc) => {
        const r = p.radius * 2 * sc * (1 + Math.sin(S.time * 30 + p.t * 40) * 0.08);
        const grad = g.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r);
        grad.addColorStop(0, `rgba(255,243,196,${alpha})`);
        grad.addColorStop(0.45, `rgba(255,179,71,${0.85 * alpha})`);
        grad.addColorStop(1, 'rgba(192,66,31,0)');
        g.fillStyle = grad;
        g.beginPath(); g.arc(pt.x, pt.y, r, 0, 7); g.fill();
      });
    }
  }

  for (const fx of S.effects) {
    const k = fx.t / fx.duration;
    if (fx.kind === 'explosion') {
      billboard(fx.x, 16, fx.y, (p, sc) => {
        const r = fx.radius * (0.35 + 0.75 * k) * sc;
        const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        grad.addColorStop(0, `rgba(255,240,190,${0.75 * (1 - k)})`);
        grad.addColorStop(0.6, `rgba(224,102,47,${0.5 * (1 - k)})`);
        grad.addColorStop(1, 'rgba(160,40,20,0)');
        g.fillStyle = grad;
        g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.fill();
        g.strokeStyle = `rgba(255,200,120,${0.7 * (1 - k)})`;
        g.lineWidth = 2.5 * devicePixelRatio * (1 - k);
        g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.stroke();
      });
    } else if (fx.kind === 'corpse') {
      humanoid(fx.x, fx.y, fx.yaw, 0, PAL_ENEMY, fx.size / 15, k);
    } else {
      // Unknown effect kinds from the seam get a generic puff rather than being dropped —
      // pointing another skill here should degrade visually, never crash.
      billboard(fx.x || 0, 20, fx.y || 0, (p, sc) => {
        g.fillStyle = `rgba(150,120,200,${0.4 * (1 - k)})`;
        g.beginPath(); g.arc(p.x, p.y, 30 * sc * (0.5 + k), 0, 7); g.fill();
      });
    }
  }

  for (const n of S.numbers) billboard(n.x, n.h, n.y, (p, sc) => {
    const px = (n.crit ? 30 : 22) * sc;
    g.font = `700 ${px}px 'Pixelify Sans', monospace`;
    g.textAlign = 'center';
    g.globalAlpha *= 1 - n.t / n.life;
    g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = px * 0.18; g.lineJoin = 'round';
    g.strokeText(n.text, p.x, p.y);
    g.fillStyle = n.crit ? '#ffd76a' : '#ffb347';
    g.fillText(n.text, p.x, p.y);
  });

  drawList.sort((a, b) => b.z - a.z);
  for (const d of drawList) d.draw();

  hud();
}

function hud() {
  const T = SKILLS.fireball.tune;
  const px = 15 * devicePixelRatio;
  g.font = `700 ${px}px 'Pixelify Sans', monospace`;
  g.textAlign = 'left';
  const lines = [
    ['#e0a033', '3D SPIKE — real src/skills.js, unmodified'],
    ['#c9bfa8', `fireball tune, live from the module: cd ${T.cooldown}s · life ${T.life}s · spread ${T.spreadDeg}° · aoe ${T.aoeRadius}`],
    ['#c9bfa8', `casts ${stats.casts} · bolts ${stats.bolts} · hits ${stats.hits} · kills ${stats.kills}`],
    ['#8a8a92', `seam calls: ${Object.entries(seamCalls).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`],
    ['#8a8a92', 'WASD move · drag or Q/E orbit — skills fire automatically'],
  ];
  lines.forEach(([color, text], i) => {
    g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = px * 0.25; g.lineJoin = 'round';
    g.strokeText(text, px, px * 1.6 * (i + 1));
    g.fillStyle = color;
    g.fillText(text, px, px * 1.6 * (i + 1));
  });
}

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updatePlayer(dt);
  updateSim(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Verification hook for the harness — and for anyone poking at whether the seam really held.
window.__spike = { S, stats, seamCalls, tune: SKILLS.fireball.tune };
