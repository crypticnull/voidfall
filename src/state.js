// @ts-check
// ---------- Shared run state ----------
// The mutable state of a run, in one place, so systems can be split out of main.js without
// each extraction dragging a pile of module-level `let`s along with it.
//
// It is a single mutable object rather than exported `let` bindings for a concrete reason:
// ES module bindings are read-only to importers, so `enemies = []` in one module would not be
// visible to another. Reassignment has to happen through a property — `S.enemies = []` — for
// every module to see the same thing.
//
// Scope is deliberately narrow. This holds what a RUN owns and what `resetRun()` clears.
// Input handling, gamepad focus, menu chrome and the like stay private to main.js: no other
// system needs them, and putting them here would make this a junk drawer.

/** @typedef {Record<string, any>} Entity */

export const S = {
  // ---- screen / flow ----
  /** @type {string} */
  state: 'START',

  // ---- entity collections. Replaced wholesale on reset, so always reach through S. ----
  /** @type {any} */        player: null,
  /** @type {Entity[]} */   enemies: [],
  /** @type {Entity[]} */   projectiles: [],
  /** @type {Entity[]} */   effects: [],
  /** @type {Entity[]} */   minions: [],
  /** @type {Entity[]} */   pickups: [],
  /** @type {Entity[]} */   dmgNumbers: [],
  /** @type {Entity[]} */   toasts: [],
  /** @type {Entity[]} */   bloodDecals: [],
  /** @type {Entity[]} */   decorObjects: [],

  // ---- run clocks and counters ----
  elapsed: 0,
  stageElapsed: 0,
  kills: 0,
  stageKills: 0,
  nextId: 1,
  spawnTimer: 0,
  pendingLevelUps: 0,
  rerollsLeft: 0,

  // ---- boss / progression ----
  bossSpawned: false,
  /** @type {any} */ boss: null,
  currentStage: 0,
  beatFinalBoss: false,
  endlessWave: 0,

  // ---- economy carried across a run ----
  keyCount: 0,
};
