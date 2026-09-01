# Voidfall Survivors — AI art pipeline brief

**Purpose:** a handoff document for a separate chat drafting a LinkedIn series about this
ComfyUI sprite/texture pipeline.

**Provenance of the facts below.** Parts 1–2 were read directly from the three exported ComfyUI
workflow JSONs. Part 3 is the post-ComfyUI pipeline, owned and verified in the game repo. Part 4
is what remains unknown. Nothing here is inferred from how such pipelines "usually" work — if a
number appears, it was read out of a file.

---

## Part 1 — The three workflows

### A. `QWEN_2511_MULTI_ANGLE_CHARACTER` — the 8-direction engine ★

**This is the centrepiece and the most interesting thing in the pipeline.** It answers the
hardest question in AI game art: how do you get one character to stay the same character across
eight camera angles?

**The answer is that it doesn't generate eight characters. It generates one, then moves the
camera.** A single reference image goes in; eight branches re-render it from eight described
viewpoints using an image-edit model rather than a text-to-image model. Consistency isn't
prompted for or curated — it's structural.

| | |
|---|---|
| Base model | `qwen_image_edit_2511_bf16` (Qwen-Image-Edit 2511) |
| Text encoder | `qwen_2.5_vl_7b_fp8_scaled` |
| VAE | `qwen_image_vae` |
| LoRA 1 | `qwen-image-edit-2511-multiple-angles-lora` @ 1.0 |
| LoRA 2 | `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16` @ 1.0 |
| Graph size | **219 nodes, 8 parallel branches, 9 subgraphs, zero bypassed** |
| Sampler | euler / simple, **40 steps, CFG 3**, denoise 1 |
| Model sampling | `ModelSamplingAuraFlow` 3.1 · `CFGNorm` enabled |
| Reference method | `FluxKontextMultiReferenceLatentMethod` = `index_timestep_zero` (×16) |
| Conditioning | `TextEncodeQwenImageEditPlus` (×16 — 8 positive, 8 negative) |
| Output | `ImageResizeKJv2` → **1080 × 1920, nearest-exact** |

**The eight prompts are camera directions, not character descriptions** — verbatim:

1. `the camera looks at the character from medium distance to the right in a 3/4 view`
2. `the camera looks at her from a medium distance to the left in a 3/4 view`
3. `the camera looks at the character as they are looking to the right for a profile view`
4. `the camera looks at the character a they are looking to the left for a profile view`
5. `The camera looks at the characters back 3/4 view while the character looks to the right`
6. `The camera looks at the characters back 3/4 view while the character looks to the left`
7. `The camera looks at the character from the back`
8. `Turn the camera to an up close portrait bust shot`

Each carries the constraint `we can see the entire character from the top of their head to the
bottom of their shoes` — that line is what keeps framing consistent enough to be normalised
downstream.

**Every branch writes to its own named folder**, e.g.
`output/_DUSKFALL/CHAR_SETS/sand_golem/{45_left, 90_left, 45_right, 90_right, left_135,
right_135, back, close_up}` — the directory names map 1:1 onto the game engine's facing names.
**One run produces a complete, correctly-labelled character set**, including the portrait bust
(prompt 8) that the game uses on its class-select cards.

### B. `CRPTK-KREA2_V2` — the source-image generator

Where the reference character comes from before the multi-angle pass. Its own labels call it
**"CRYPTIK NULL / KREA2 S&BOX"** — a sandbox, i.e. a general-purpose generation rig rather than a
sprite-specific one.

| | |
|---|---|
| Base model | `moodyKrea2Mix_v30BF16` |
| Text encoder | `qwen3VL4BAbliteratedComfyui_v10` · VAE `qwen_image_vae` |
| Graph size | 67 nodes, 2 subgraphs, 14 bypassed |
| Structure | **two-pass**: text-to-image → latent upscale → refine |
| Pass 1 | sampler `res_2s`, scheduler `ddim_uniform`, 5 steps |
| Pass 2 | sampler `euler_ancestral`, scheduler `normal`, 6 steps, **denoise 0.25** |
| Between passes | `LatentUpscaleBy` bicubic **×1.36** |
| Guidance | `CFGGuider` 1.0 both passes, negative via `ConditioningZeroOut` |
| Model sampling | `ModelSamplingAuraFlow` 4.5 |
| Finishing | `VAEDecodeTiled` (512/64/64/8) → `ImageCASharpening+` 0.05 |
| Custom LoRA | `CRYPTIK_SAPPHIRE_V2` (self-trained, 3000 steps) @ 0.8, plus `krea2_Enhancer` @ 0.2 |
| Optional, disabled in saved state | Krea2 depth-control path (`DepthAnythingV2Preprocessor` → `Krea2ControlLoRALoader` @ 0.95 → `Krea2ControlApply`) |

> ⚠ **The saved widget state of this file is scratch, not the sprite recipe.** Its stored prompts
> are placeholders, and its LoRA toggles reflect an unrelated last session — several enabled
> LoRAs have nothing to do with game art. **Do not describe this file's saved LoRA stack in
> public material.** The sprite-relevant parts are the two-pass structure, the model, and the
> self-trained `CRYPTIK_SAPPHIRE_V2` character LoRA.

### C. `CRPTK_PXLART_TILE_MAKER` — seamless pixel-art textures

| | |
|---|---|
| Base model | `sd_xl_base_1.0` (plain SDXL — no LoRAs enabled) |
| Graph size | 32 nodes, 2 subgraphs |
| Tiling | **`SeamlessKSampler` + `SeamlessVae`** — tiling is enforced *during* sampling and decode, not patched afterwards |
| Sampling | 1024×1024, euler / normal, **20 steps, CFG 8** |
| Pixel-art conversion | `Image Pixelate` — 16-colour **k-means++** quantisation (100 iters), **Floyd–Steinberg** dithering, brightness-ordered palette |
| Verification | `RepeatImageBatch ×4` → preview, i.e. the tile is **rendered as a 2×2 grid to prove the seam** before it is accepted |
| Example prompt | `fantasy rpg video game art from the 90's of: sandy desert ripples` |
| Negative | `text, watermark, low quality` |

Two details worth drawing out for a technical audience:

- **Seamlessness is structural, not cosmetic** — the sampler and VAE both wrap, so the tile is
  born tileable rather than being edge-blended into looking tileable.
- **The pixel-art look is a deterministic post-process, not a prompt style** — a real
  quantiser with a real dither, which is why the output holds a fixed palette instead of
  approximating one.

In the shipped game: `stage1_floor.png` is 1024×1024; stages 2 and 3 are 64×64.

---

## Part 2 — The full chain, end to end

```
[B] KREA2 sandbox            one character concept, 2-pass, custom LoRA
        │  reference PNG
        ▼
[A] Qwen-Image-Edit 2511     8 camera angles + portrait bust, one run,
    multi-angle              foldered by facing name — 1080×1920 each
        │
        ▼
    Photoshop action         despeckle stray pixels, cut alpha  (author-built, batched)
        │
        ▼
    mr_assets/<character>/   pristine delivery archive
        │
        ▼
[REPO] normalise → synthesise frame 2 → assemble sheet → trim at load
        │
        ▼
    54×96 frames · 108×96 two-frame sheets · 8 facings · 8-bit RGBA

[C] Tile maker               seamless SDXL → 16-colour quantise → 2×2 seam check
```

**Scale check:** 1080×1920 generated → **54×96 in game**. The pipeline throws away ~95% of the
linear resolution it generates. That is not waste — it is what makes the downsample clean.

---

## Part 3 — The post-ComfyUI half (verified in the game repo)

Generated art is an **input**, not an asset. Five stages, all scripted, all re-runnable from the
pristine archive.

1. **Photoshop action** *(author-built)* — removes errant pixels and cuts the alpha channel.
   Everything downstream depends on hard-edged transparency; this is where it comes from.
2. **Baseline normalisation** — feet measured and shifted onto a common ground line.
   Real measurement: **5 px of spread on a 96 px frame** across one character's eight facings.
   Uncorrected it reads in-game as the character bobbing every time they turn. *(Root cause is
   visible in Part 1: the camera orbits the character, so ground contact genuinely moves per
   angle — and a 1080→96 downsample turns a small shift into a visible one.)*
3. **Walk-cycle synthesis** (`tools/make_walk_frame.py`) — **the second animation frame is
   generated procedurally from the first**, not drawn and not diffused. Hip line and leg gap are
   found from the silhouette; legs converge, torso lifts 1 px, head settles 1 px. It
   self-diagnoses: on a robed figure it detects too few rows with separable legs and *warns* to
   re-run bob-only rather than tearing the robe apart. Overrides exist for what detection can't
   see (`--hip`, `--shoulder`, `--converge`, `--lift`, `--bust`).
4. **Sheet assembly** — frames stitched left-to-right; frame dimensions **checked, not assumed**.
5. **Load-time trim** — the engine computes **one union bounding box across every frame and every
   facing**, cropped symmetrically about the centre. Per-facing boxes would make the character
   jump when turning; asymmetric cropping would slide the sprite off its own centre.

**Runtime guarantees:** integer-snapped scaling (every source pixel becomes an exact N×N block) ·
graceful degradation (a missing or corrupt PNG falls back to the procedural, code-drawn version,
so art lands one file at a time and a bad export never breaks the build) · 8-direction resolution
with mirroring fallback (a missing facing resolves to a mirrored neighbour — one character ships
7 drawn directions with the 8th mirrored and it is invisible in play).

**Verified inventory:** 98 sprite sheets, 84 stashed single frames, **100% of them 8-bit RGBA**.

---

## Part 4 — Still unknown (ask the author)

1. **Hit rate** — usable sets per run? How often does one of the eight angles fail and need a
   re-roll?
2. **Wall-clock** per character set (8 angles at 40 steps) and per tile.
3. **`CRYPTIK_SAPPHIRE_V2`** — dataset size, captioning, training config, and what it was trained
   to do. This is the most "proprietary" artefact in the chain.
4. **The Photoshop action's steps** — what exactly does the despeckle do, and how is alpha cut
   (threshold? colour key? selection?).
5. **How the reference character is chosen** from KREA2 output — curation criteria, and how many
   candidates per keeper.
6. **1080×1920 → 54×96** — what performs the downsample, and with what filter?
7. **Was the depth-control path ever used for sprites**, or is it there for other work?
8. **Audience/goal** for the series — clients, studios, other solo devs, recruiters? Is the
   pipeline something you're selling, or is this a credibility piece?

### One observation worth a sanity check

The multi-angle branches run **40 steps at CFG 3 with a 4-step Lightning LoRA at strength 1.0**.
Lightning LoRAs are distilled for ~4–8 steps; at 40 they're doing something other than what
they're built for, and the run costs roughly 10× the time a 4-step config would. It may be
deliberate — if the output is what you want, it's right by definition. But it's worth one A/B
before the series describes the settings publicly, because "40 steps" and "4-step Lightning LoRA"
in the same sentence is the kind of detail a technical commenter will pick up on.

---

## Part 5 — Suggested spine for the series

The strongest available story is **not** "AI made my game art." It's:

> **Generated art is an input, not an asset.** The interesting engineering is everything either
> side of the model — constraining generation so consistency is structural rather than lucky, and
> automating the correction of what still comes out wrong.

Post seeds, each backed by a verified fact above:

1. **"I don't generate eight sprites. I generate one and move the camera."** — the multi-angle
   workflow. Strongest opener; it's the counter-intuitive one.
2. **"My prompts don't describe the character. They describe the camera."** — the eight verbatim
   camera prompts.
3. **"The second animation frame isn't drawn or generated — it's computed from the silhouette."**
4. **"My tool told me it was about to ruin a robe."** — the self-diagnosing leg detector.
5. **"I generate at 1080×1920 to ship at 54×96."** — why throwing away 95% is the point.
6. **"Seamless tiles aren't edge-blended. The sampler wraps."** — plus the 2×2 seam check.
7. **"Eight camera angles disagree about where the floor is by 5 pixels."** — measurement over
   vibes.
8. **"If a PNG is missing, the game draws the character in code instead."** — graceful
   degradation as a production strategy.
9. **The one number nobody expects:** one run → 8 correctly-named folders → a complete character
   set, portrait included.
