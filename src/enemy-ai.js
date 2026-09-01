// @ts-check
// ---------- Melee approach behaviours ----------
// Every melee enemy used to do exactly one thing: walk at the player until touching them. With
// twenty monsters on screen that reads as one substance flowing downhill rather than as twenty
// creatures, and there is no moment to react to — nothing ever commits, so nothing can be
// dodged, baited or spaced against.
//
// So melee enemies now pick from four approaches. The point is not that they are individually
// clever; it is that they arrive on DIFFERENT rhythms, so a crowd has texture and a player has
// something to read.
//
//   walker   plain, relentless approach. Kept because a horde needs a floor of pure pressure
//            to push against — if everything jinked, nothing would feel inevitable.
//   harrier  walks in, lands a hit, hops back out and comes again. The bounce is what makes a
//            swarm feel like it is worrying at you rather than smothering you.
//   strafer  circles at a held distance, then commits to a fast straight dash. The circling is
//            a tell: it is the wind-up that makes the dash dodgeable.
//   charger  sprints in a straight line, overshoots, turns around and does it again. Fast and
//            legible, and the overshoot is the window it gives you back.
//
// The state machine is deliberately tiny — a mode string and one timer per enemy. Anything
// richer costs per-frame work on hundreds of bodies, and none of it would be visible at the
// speed these things live and die at.

/** @typedef {{ mode: string, t: number, dir: number, seed: number }} AiState */

/**
 * Behaviour parameters. Times in seconds, distances in world units, speeds as multipliers of
 * the enemy's own speed so a slow monster stays slow in every mode.
 */
export const AI_TUNE = {
  harrier: {
    hopChance: 0.55,      // odds of bouncing after a hit rather than just standing on you
    hopSpeed: 1.9,        // fast: the hop should read as a recoil, not a stroll backwards
    hopTime: 0.28,
    waitTime: 0.35,       // beat spent out of reach before coming back in
  },
  strafer: {
    ringMin: 90,          // held distance while circling
    ringMax: 150,
    strafeSpeed: 0.95,
    strafeTime: 1.1,      // how long it circles before committing
    dashSpeed: 3.2,
    dashTime: 0.34,
    restTime: 0.45,       // recovery after a dash, and the window to punish it in
  },
  charger: {
    windupTime: 0.3,      // stops dead before launching: the tell
    sprintSpeed: 2.35,
    sprintTime: 0.85,
    overshoot: 40,        // keeps running past the player rather than braking on top of them
    restTime: 0.6,
  },
};

/** Every behaviour a melee enemy may be given. */
export const BEHAVIORS = ['walker', 'harrier', 'strafer', 'charger'];

/**
 * Deterministic per-enemy jitter in 0..1. Derived from the entity id so a given body keeps its
 * own timing for life — re-rolling each frame would make the whole crowd shimmer in lockstep,
 * which is the exact problem the turn-lag system elsewhere already had to solve.
 * @param {number} id
 * @param {number} salt
 */
function idNoise(id, salt = 0) {
  const x = Math.sin((id + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Start an enemy's state machine. Phases are staggered by id so a wave spawned on one frame
 * does not dash in unison.
 * @param {{ id: number, behavior?: string }} e
 * @returns {AiState}
 */
export function initAi(e) {
  const n = idNoise(e.id);
  return {
    mode: 'approach',
    // Negative start = a random slice of the first phase already elapsed, which spreads the
    // crowd's first commitment out instead of bunching it at t+0.
    t: -n * 0.6,
    dir: idNoise(e.id, 1) < 0.5 ? -1 : 1,   // which way this one circles
    seed: n,
  };
}

/**
 * Advance one melee enemy.
 *
 * `api` supplies the movement primitives from the game so this module stays free of game state:
 *   toward(e, target, speed, dt)   walk at the target, respecting the stand-off ring
 *   vec(e, dx, dy, speed, dt, face) move along an arbitrary vector, still facing the target
 *
 * @param {any} e enemy
 * @param {any} target what it is chasing (player or minion)
 * @param {number} speed already scaled for slows
 * @param {number} dt
 * @param {{ toward: Function, vec: Function, dist: Function }} api
 */
export function meleeStep(e, target, speed, dt, api) {
  const behavior = e.behavior || 'walker';
  if (behavior === 'walker') { api.toward(e, target, speed, dt); return; }

  if (!e.ai) e.ai = initAi(e);
  const ai = e.ai;
  ai.t += dt;
  const d = api.dist(e.x, e.y, target.x, target.y);
  const dx = target.x - e.x, dy = target.y - e.y;

  if (behavior === 'harrier') {
    const T = AI_TUNE.harrier;
    if (ai.mode === 'hop') {
      // Backwards, still facing the target — it is retreating from you, not fleeing.
      api.vec(e, -dx, -dy, speed * T.hopSpeed, dt, target);
      if (ai.t >= T.hopTime) { ai.mode = 'wait'; ai.t = 0; }
      return;
    }
    if (ai.mode === 'wait') {
      if (ai.t >= T.waitTime * (0.6 + ai.seed * 0.8)) { ai.mode = 'approach'; ai.t = 0; }
      return;
    }
    // Approaching. `justHit` is set by the contact code, which is the only place that knows a
    // blow actually landed — bouncing on proximity instead would make it recoil off shields,
    // off other bodies, and off near-misses it never connected with.
    api.toward(e, target, speed, dt);
    if (e.justHit) {
      e.justHit = false;
      if (idNoise(e.id, ai.t * 7) < T.hopChance) { ai.mode = 'hop'; ai.t = 0; }
    }
    return;
  }

  if (behavior === 'strafer') {
    const T = AI_TUNE.strafer;
    if (ai.mode === 'dash') {
      api.vec(e, dx, dy, speed * T.dashSpeed, dt, target);
      // Ends on contact as well as on time, so it does not keep shoving once it has arrived.
      if (ai.t >= T.dashTime || d <= e.radius + target.radius) { ai.mode = 'rest'; ai.t = 0; }
      return;
    }
    if (ai.mode === 'rest') {
      if (ai.t >= T.restTime) { ai.mode = 'approach'; ai.t = 0; }
      return;
    }
    // Circling. Outside the ring it closes, inside it backs off, and at the right distance it
    // slides sideways — so the ring is held from both directions rather than only approached.
    const ring = T.ringMin + (T.ringMax - T.ringMin) * ai.seed;
    if (d > ring * 1.15) {
      api.toward(e, target, speed, dt);
    } else if (d < ring * 0.8) {
      api.vec(e, -dx, -dy, speed * T.strafeSpeed, dt, target);
    } else {
      // Perpendicular to the line to the target: a true circle, not a drift.
      api.vec(e, -dy * ai.dir, dx * ai.dir, speed * T.strafeSpeed, dt, target);
    }
    if (ai.t >= T.strafeTime * (0.7 + ai.seed * 0.6)) { ai.mode = 'dash'; ai.t = 0; }
    return;
  }

  // charger
  const T = AI_TUNE.charger;
  if (ai.mode === 'windup') {
    // Holds still and faces you. Standing still in a moving crowd is itself the signal.
    api.vec(e, dx, dy, 0, dt, target);
    if (ai.t >= T.windupTime) {
      ai.mode = 'sprint'; ai.t = 0;
      // The line is fixed at launch, so it commits: a charge that steers is just a fast walk.
      const len = Math.hypot(dx, dy) || 1;
      ai.dirX = dx / len; ai.dirY = dy / len;
    }
    return;
  }
  if (ai.mode === 'sprint') {
    api.vec(e, ai.dirX, ai.dirY, speed * T.sprintSpeed, dt, target);
    if (ai.t >= T.sprintTime) { ai.mode = 'rest'; ai.t = 0; }
    return;
  }
  if (ai.mode === 'rest') {
    if (ai.t >= T.restTime * (0.7 + ai.seed * 0.6)) { ai.mode = 'approach'; ai.t = 0; }
    return;
  }
  // Approach until close enough to be worth committing to a line.
  api.toward(e, target, speed, dt);
  if (d < T.overshoot * 6) { ai.mode = 'windup'; ai.t = 0; }
}
