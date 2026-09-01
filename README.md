# Voidfall Survivors

A horde-survival roguelike — pick a class, survive the crowd, build a character out of whatever
the level-ups offer. Three stages and a boss apiece, then endless waves that keep escalating.

**Alpha 0.7.0.** Runs in a browser or as a packaged Windows desktop app.

| | |
|---|---|
| 8 classes | 24 skill gems + 2 dash-slot mobility skills |
| 9 tomes | support gems that modify every skill you own |
| 3 stages + endless | The Graveyard · The Sundered Sands · The Underworld |
| 20 enemy types | plus 7 elite abilities, 3 named minibosses, 4 void powers |
| 6 relics · 11 items | run-shaping rules rather than stat sticks |

---

## Running it

```bash
npm install
npm run dev        # dev server on :8791 — open http://localhost:8791
```

```bash
npm start          # the same game in its Electron shell
```

There is **no build step for the game itself.** The browser loads `src/*.js` directly as ES
modules — no bundler, no transpile, no watch process. Edit a file, refresh, see it. The only
compile-shaped thing in the repo is the type checker, and it never rewrites code.

### Packaging

```bash
npm run dist:portable      # -> release/Voidfall_Alpha_<version>.exe
```

Version lives in `package.json` and is the single source of truth; `tools/sync-version.mjs`
rewrites `src/version.js` from it as part of the build, so the label on the title screen can
never drift from the filename of the exe. Builds are ~125 MB and are **not committed** — GitHub
hard-blocks files over 100 MB. They belong in Releases.

### Checks

```bash
npm run check      # sync-version + typecheck + 30 smoke tests
```

TypeScript runs in `checkJs` mode over plain JavaScript — types come from JSDoc, and nothing is
compiled. The smoke suite is deliberately *not* a full test suite: it covers what is easy to
break silently and expensive to notice later — the difficulty curve's shape, data tables agreeing
with the code that reads them, and a few specific bugs that have already cost a build.

---

## Layout

```
src/            engine + game systems
  main.js         the loop: update, render, effects, HUD
  skills.js       24 gems — each one's numbers live in a `tune` block
  supports.js     tomes, and the curve model their magnitudes come from
  difficulty.js   the shared curve every escalation is built on
  enemies.js  classes.js  loot.js  relics.js  items.js  elites.js  void.js
  sprites.js      sprite defs, 8-direction resolution, load-time trim
  gl/             WebGL sprite batcher (Canvas 2D is the fallback path)
tools/          the dev pipeline — see below
assets/         sprites, tiles, audio, fonts
electron/       desktop shell
docs/           art pipeline brief
spike3d/        feasibility spike (below)
```

---

## Two things worth knowing

### Tuning is a pipeline, not a pile of constants

Every number a skill depends on lives in a `tune` block rather than as a literal, so the in-game
dev panel can drive it with a slider at runtime. What you dial in a play session is saved to
`tuning/*.json`, and `npm run bake` writes those values **into the source** and empties the
store — so a tuned number ends up in `src/`, in version control, reviewable in a diff.

```
dev panel  →  tuning/*.json  →  npm run bake  →  src/*.js
```

The store being emptied by the bake is load-bearing: a baked value is *in* the source, so the
override that produced it is redundant the instant the bake finishes, and anything left behind
could only go stale. `tools/pull-exe-tuning.py` carries tuning done inside a packaged build back
to the repo, merging by whichever side was saved most recently.

### Art is an input, not an asset

Character art arrives as single frames per direction and goes through a scripted pipeline before
the game ever sees it: baselines normalised onto a common ground line, a second animation frame
**synthesised procedurally from the first** (`tools/make_walk_frame.py` finds the hip line from
the silhouette — it does not guess), frames stitched into sheets, and a union bounding box
computed across every frame and facing at load time.

The engine degrades gracefully throughout: a missing or corrupt PNG falls back to the procedural,
code-drawn version of that character, so art can land one file at a time and a bad export never
breaks the build.

`docs/art-pipeline-brief.md` documents the whole chain, generation included.

---

## `spike3d/`

A feasibility spike, kept because its result is worth keeping: the real, unmodified `src/skills.js`
driving a hand-rolled third-person 3D renderer. It exists to answer one question — whether the
game's simulation is separable from its renderer — and the answer was yes, through an 11-method
`world` interface, with zero changes to anything under `src/`.

```bash
npm run dev        # then open http://localhost:8791/spike3d/
```

Not a direction the project is taking. Just a measurement.

---

## Tooling notes

- `npm run wipe-saves` — bumps a build-stamped reset token so the next build discards old player
  data everywhere it exists, rather than relying on folders being cleared by hand.
- `tools/palette-sheet.py` — renders the UI colour tokens to a contact sheet, read straight from
  `style.css` so it cannot drift.
- `tools/gold-model.mjs` — computes a run's income from the game's own loot functions; shop
  prices are derived from it rather than chosen freehand.

---

*Alpha software. Everything here is subject to change, including the parts that look settled.*
