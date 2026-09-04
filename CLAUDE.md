# Voidfall Survivors — working notes

Vanilla JS ES modules, Canvas 2D + a WebGL sprite batcher, packaged with Electron. **No bundler,
no build step for the game.** The browser loads `src/*.js` directly; edit and refresh.

`README.md` covers what the project is. This file covers what will bite you.

---

## Before you finish anything

```bash
npm run check      # sync-version + typecheck + 30 smoke tests — must pass
```

Verify in the **browser** via the dev server (`npm run dev`, port 8791), not by reasoning about
what the code should do. This project has a measurement culture: when a change is claimed to fix
something, it is expected to come with a number that proves it — frames flipped before vs after,
pixels cropped, uptime percentage. "Should work" is not a result.

When adding a test for a bug, **deliberately re-break the code and confirm the test fails.** A
test that has never failed has not been shown to work.

---

## Tuning is a pipeline. Never hand-edit the numbers.

Every tunable value lives in a `tune` block or a `*_TUNE` object, driven by sliders in the in-game
dev panel at runtime.

```
dev panel → tuning/*.json → npm run bake → src/*.js   (store is then EMPTIED)
```

- **Blocks marked `/* GENERATED ... */` are rewritten wholesale by `tools/bake-tuning.py`.**
  Hand-edit one and the next bake destroys it. To change a baked value, POST it to the store
  (`curl -X POST localhost:8791/entity-tuning -d '{...}'`) and bake, or move the slider in-game.
- **The bake empties the store on purpose.** A baked value is *in* the source, so the override
  that produced it is redundant and could only go stale. An empty store is the correct committed
  state.
- **"pull and bake" is a standing routine** and means: `python tools/pull-exe-tuning.py` (dry run
  first), then `npm run bake`. Pull carries tuning done inside a packaged exe back to the repo.
- **The pull's `SUPERSEDED` lines are not errors.** They mean the exe holds values older than the
  last bake — correctly *not* pulled. Do not force them in.
- **Bake before committing**, so tuning changes land as readable diffs in `src/` rather than churn
  in a JSON blob.

## Wiping player data is a token bump, never a manual delete

```bash
npm run wipe-saves      # bumps SAVE_RESET_TOKEN, then build
```

Player data lives in **three places** (browser localStorage, the exe's leveldb under `%APPDATA%`,
and whatever an already-built exe writes tomorrow). Deleting folders has failed repeatedly and
silently — the exe's store does not exist until it has been run once, so "the folder isn't there"
proves nothing. The token travels *inside the build* and makes the wipe a property of the build.
Two smoke tests enforce it.

---

## Gotchas that have each cost a build

- **A phantom module.** The dev server stamps `?v=<mtime>` on imports, so `import('/src/x.js')`
  in the console is a *different module record* than the game is running. Read the real specifier
  out of the served `main.js` first. See any verification block in this session's history.
- **The level-up overlay freezes the sim.** Any polling loop must dismiss level-up cards or every
  reading looks frozen and every timing measurement is wrong.
- **CRLF line endings.** Anything parsing source must use `split(/\r?\n/)`, never `'\n}\n'`.
- **Check for one dev server.** `netstat -ano | grep ':8791.*LISTENING'` should return exactly one
  PID; a stale one answers first and serves old files.
- **`Math.round(0.5)` is 1 and sprite scale snaps to whole multiples of a sprite's OWN source
  height.** This made higher-resolution art render *smaller* — no per-character scale can fix it,
  because snapping only yields whole multiples.
- **Replace-first is dangerous in this codebase.** Many skills share identical lines; a
  `replace(a, b, 1)` on `damage: scale(T.damage, T.damagePerLevel, level)` once silently rewrote
  a different skill. Anchor replacements with surrounding context and verify which symbol changed.
- **A missing tune key becomes `NaN`, and `NaN` propagates silently** through damage → life leech
  → player health. `scale(34, undefined, L)` is `NaN`. A smoke test now casts every skill and
  fails on any non-finite value; keep it passing.

---

## Art pipeline

Deliveries land in `mr_assets/character_art/<name>/` — the **pristine archive**; never write back
to it. Every downstream step is re-runnable from there.

- **Current spec 54×96** per frame (older roster is 37×64), two frames per sheet laid
  left-to-right, **8-bit RGBA, hard alpha, no anti-aliasing**, 8 facings, portrait at the same
  frame size as the walk art.
- **`tools/make_walk_frame.py` synthesises frame 2** from frame 1 by finding the hip line in the
  silhouette. Flags that matter:
  - `--converge=0` for **robed figures and pure profiles** (the tool warns when it detects too
    few rows with separable legs — believe it).
  - `--hip=N` when a figure **holds its arms clear of its body**; the detector reads an arm gap as
    a leg gap and puts the hip in the chest.
  - `--bust` for portraits.
- **Normalise baselines before building sheets.** Independently-rendered facings disagree about
  where the floor is (measured: 5px on a 96px frame), which reads as bobbing when turning.
- `sprites.js` trims **one union box across every frame and facing, symmetric about the centre**.
  Both properties are load-bearing. It bows out entirely on mixed frame sizes.
- **Effects have two live paths — procedural AND sprite — permanently.** `effect-art.js` is the
  seam. This is not a migration; do not delete the procedural path.
- **`infusion-art.js` is the seam for elemental visuals.** All infused skills consume it; extend
  there rather than adding an overlay.
- New `.wav` in `assets/music` means: convert to ogg, archive the wav, rescan
  (`tools/scan-music.py`). WAV masters are gitignored — they are 644MB.

---

## Git / releases

Repo: **github.com/crypticnull/voidfall** (private, proprietary licence). `gh` CLI is installed
and authenticated.

```bash
npm run dist:portable                                    # -> release/Voidfall_Alpha_<v>.exe
gh release create v0.7.1 "release/Voidfall_Alpha_0.7.1.exe" \
  --title "Alpha 0.7.1" --notes-file notes.md --prerelease --verify-tag
```

Version lives in `package.json`; `tools/sync-version.mjs` rewrites `src/version.js` from it. Never
edit `src/version.js` by hand. Builds are ~125MB and are **gitignored** — GitHub blocks files over
100MB, so they ship as Releases (2GB limit) instead.

---

## Direction

The **2D game is the product.** A 3D follow-up is planned as a *separate Godot project* later; the
feasibility spike lives in `spike3d/` and its findings are in its comments. Do not push 3D work
forward unprompted.

`docs/` holds two handoff briefs — the ComfyUI art pipeline, and the project as a portfolio piece.

---

## Working style that fits this project

Say what was measured, not what was intended. If something was not verified, say so plainly rather
than implying it was. When a change has a real cost or a trade-off, name it in one line and move
on — the trade is usually the interesting part, and it belongs in a comment next to the number it
explains.

Comments here explain **why**, especially why an obvious simpler approach was rejected. That
history is the most valuable thing in the codebase; match its density when adding to it.
