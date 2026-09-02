# Voidfall Survivors — portfolio brief

**Purpose:** a handoff document for a chat writing this up as a portfolio piece on a personal
site, positioning the author as a **creative technologist** seeking work.

**Provenance:** every figure below was measured from the repository, not estimated. Where a claim
is a judgement rather than a measurement, it says so.

---

## The one-line version

A complete horde-survival roguelike — engine, game systems, art pipeline, audio, tooling and
desktop packaging — built solo from scratch in **eleven days**, shipping **25 playable builds**
in that time.

---

## The numbers

| | |
|---|---|
| **Total hand-written code** | ~33,300 lines |
| Game engine + systems (`src/`) | 25,900 lines |
| Custom dev tooling (`tools/`) | 3,800 lines across **21 tools** |
| Interface (`style.css` + `index.html`) | 3,100 lines |
| **First source file → v0.7.0** | 24 Jul → 3 Aug 2026 · **11 days** |
| **Playable builds shipped** | **25**, up to 5 in a single day |
| Automated checks | 30 smoke tests, TypeScript in `checkJs` mode |
| Dependencies | **Zero runtime dependencies.** No engine, no framework, no bundler |

### Content shipped

8 playable classes · 24 skill gems + 2 mobility skills · 9 support tomes · 20 enemy types ·
7 elite abilities · 3 named minibosses · 4 void powers · 6 relics · 11 items ·
3 stages + infinite endless mode · 23 original music tracks

---

## What it actually is

A top-down survival roguelike in the *Vampire Survivors* lineage: you pick a class, the screen
fills with enemies, and every level-up offers a choice that compounds. Runs last ten to twenty
minutes across three stages, each with a boss, then endless waves that escalate without limit.

**It runs two ways from one codebase** — in a browser as plain ES modules, and as a packaged
Windows desktop application via Electron.

**Written without an engine.** No Unity, no Godot, no Phaser, no React, no build step. The
browser loads the source files directly. Rendering is Canvas 2D with a hand-written WebGL sprite
batcher layered underneath for the crowd; when WebGL is unavailable it falls back to Canvas 2D
and the game is identical.

---

## Why this is a *creative technologist* piece specifically

The role sits between design and engineering. This project is unusual because **the engineering
was built to serve the design loop**, and that is visible in the artefacts rather than merely
claimed. Four things demonstrate it:

### 1. Game balance as a build pipeline, not a pile of constants

Every number a skill depends on lives in a `tune` block rather than as a literal, so an in-game
developer panel drives all of them with sliders **at runtime, mid-fight**. What gets dialled in
a play session is written to JSON, and a bake step compiles those values **into the source
files** and empties the store.

```
play the game → move a slider → bake → the value is now in src/, in git, in a diff
```

The design decision is that **balance changes are reviewable code changes**, not folklore. The
store being emptied is deliberate: a baked value is *in* the source, so the override that made it
is redundant the moment the bake finishes and could only go stale. A companion tool carries
tuning done inside a packaged build back to the repository, merging by whichever side was saved
more recently.

*Why it matters for the role:* this is a designer's feedback loop and an engineer's version
control made into the same object. Tuning was baked from live play sessions repeatedly across
the project's life.

### 2. An AI art pipeline where generation is the *input*, not the output

Character art is generated in ComfyUI, but the interesting engineering is on both sides of the
model.

**Before:** consistency across eight camera angles is solved *structurally* rather than by
prompting or curation. One reference character is generated, then an image-edit model re-renders
that same character from eight described viewpoints — the prompts describe **the camera, not the
character**. One run produces a complete, correctly-named directional set including the portrait.

**After:** generated frames go through a scripted correction chain before the game sees them —
baselines measured and normalised onto a common ground line (real deliveries disagreed by 5px on
a 96px frame, which reads in-game as the character bobbing when they turn); a **second animation
frame synthesised procedurally from the first** by finding the hip line in the silhouette; sheets
assembled with dimensions verified rather than assumed; a union bounding box computed at load.

The synthesis tool **self-diagnoses** — on a robed figure it detects too few rows with separable
legs and warns the operator rather than tearing the robe apart.

*Why it matters for the role:* this is the actual shape of production AI work — not "I prompted
an image," but "I built a system that constrains generation so consistency is structural, and
automated the correction of what still comes out wrong."

### 3. Design problems solved by measurement rather than taste

A representative sample, all real:

- **"The character glitches between enemies."** Two independent causes: a target picker that
  recomputed a pure nearest-enemy every frame (so near-ties swapped constantly), and a facing
  system that quantised aim into eight bins with a hard edge. Fixed with hysteresis on both —
  measured **592 flicker events → 0** on a jittering boundary, while a deliberate 180° turn still
  resolves in a single frame. A simple delay would have killed the flicker *and* made every real
  turn feel late.
- **"The void classes feel small."** They were rendering at **75%** the height of every other
  character. Sprites snapped to whole multiples of *their own* source height, so art drawn at
  higher resolution rendered *smaller* — and no per-character scale setting could fix it, because
  snapping only yields whole multiples.
- **A total game freeze.** The lightning renderer contained an unbounded loop whose only exit
  could never be reached given a single non-finite coordinate — in a path that runs every frame
  one particular skill is equipped.

*Why it matters for the role:* each of these is a *design* complaint ("it feels wrong") traced to
a specific mechanism and then verified numerically. That translation — vibe to measurement to
fix — is the job.

### 4. Tooling built because the work needed it

21 custom tools, including: a walk-cycle frame synthesiser; a tuning baker and a cross-build
tuning merger; a **gold economy model** that computes a run's income from the game's own loot
functions so shop prices are *derived* rather than guessed; a save-reset token system that makes
"wipe player data" a property of the build rather than a manual chore; a colour-palette contact
sheet generated from the stylesheet so it cannot drift; a performance harness; a music scanner
that converts and indexes audio by folder.

---

## The strongest single story (suggested lead)

**A feasibility spike that answered an architecture question with a measurement.**

Faced with "could this become a 3D game?", the answer was not an opinion. In roughly a day, the
real, **unmodified** game logic was pointed at a hand-written third-person 3D renderer through an
11-method interface. It ran: the actual skill code, carrying that day's balance values, driving a
3D world it had never heard of — with **zero changes to any game file**.

The result: ~35% of the codebase was portable, the renderer was not, and the honest recommendation
was *don't fork it — extract the shared core, because two diverging copies of the game design
would be the thing that kills it.*

**This is the portfolio's best single artefact** because it demonstrates the rarest thing on the
list: knowing when *not* to build something, and generating evidence to make that call instead of
arguing about it.

---

## Suggested framing for the site

Lead with the eleven days and the twenty-five builds — that is the shipping-velocity claim, and it
is verifiable. Then pivot immediately, because raw speed is the least interesting thing here:

> The interesting part isn't that it was fast. It's that a game with 24 skills and 20 enemy types
> stayed *tunable* — balance changes are code changes, art corrections are scripts, and "this
> feels wrong" gets traced to a number.

Sections that would work, in order of strength:

1. **The spike** — architecture questions answered with evidence *(strongest)*
2. **Balance as a pipeline** — the slider-to-source loop, ideally as a diagram
3. **The AI art pipeline** — camera prompts, not character prompts; generation as input
4. **Three bugs and how they were found** — the flicker, the 75% sprites, the freeze
5. **The numbers** — as a sidebar, not a headline

### Tone notes

- **Do not oversell the AI generation.** The defensible claim is about the *system around* the
  model, and it is stronger than a claim about prompting.
- **Do not call it finished.** It is Alpha 0.7.0, and saying so is more credible than not.
- The measurements are the differentiator. Wherever a choice can be stated as a number
  (592 → 0, 75%, 5px, 11 days, 25 builds), use the number.

---

## What to check before publishing

1. **Screenshots and a video clip.** There are none in this brief and a game portfolio piece
   needs them badly — gameplay footage, the dev tuning panel mid-session, the 8-direction sprite
   sheets, and the 3D spike side by side with the 2D game.
2. **Repository visibility.** The code is currently in a **private** GitHub repo under a
   proprietary all-rights-reserved licence. A portfolio piece that links to a repo nobody can
   open needs either a visibility change or a decision to show the work through writing and media
   instead.
3. **Playable demo.** The game runs in a browser with no build step, which makes hosting a demo
   unusually easy — this would be by far the highest-impact addition, and it is close to free.
4. **The music.** 23 original tracks were generated with Suno AI under a paid subscription.
   Mention or omit deliberately; do not let another writer imply they were composed by hand.
