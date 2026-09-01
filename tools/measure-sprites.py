"""Measure the shipped character sprites into geometry data for the Godot fork.

    python tools/measure-sprites.py

Writes `data/character-metrics.json` into the 3D project. This is the same contract every other
export keeps: the 2D repo owns the truth, the 3D side consumes it as data. Here the truth is the
ARTWORK — so instead of a human transcribing "he has big shoulders" into a style guide (which is
how the first pass went wrong), the builder gets the real silhouette, measured.

WHAT IS MEASURED, and why each piece exists:

  runs      Per row, the horizontal spans of opaque pixels in the FRONT view. The run COUNT is
            anatomy: three runs across the chest is arm|torso|arm, two runs low down is leg|leg,
            one run is a solid torso or head. That is how the body gets segmented into parts
            that can be rigged, without anyone hand-authoring where the hip is.
  depth     The same scan on the SIDE view, giving how deep the body is at that height. A
            character with no side art falls back to a fraction of its width, stated below.
  colours   Three tonal steps sampled from the actual pixels in that band (20th / 50th / 85th
            percentile by luminance), because the sprites are shaded, not flat — and the first
            pass looked lifeless precisely because it painted each part one flat colour.

Everything is normalised: x/z as a fraction of the sprite's ink width, y as a fraction of ink
height with 0 at the feet. The 3D builder scales that by the character's real height in metres,
so the measurements survive any change of scale.
"""
import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required:  python -m pip install pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "..", "26_08_03_Voidfall_3D", "voidfall-3d", "data")

ALPHA = 8      # a pixel counts as ink above this alpha; the art has hard edges, so this is safe
BANDS = 26     # height bands. Enough to catch a pauldron and a belt; few enough to stay chunky.

# frames: sheets in assets/sprites are horizontal strips of equal frames — frame 0 is the
# hand-drawn pose, frame 2 the derived passing pose. Only frame 0 is measured.
# depth_of_width: fallback body depth for characters with no side art, as a fraction of width.
CHARACTERS = {
    "warrior": {
        "front": "mr_assets/character_art/warrior/warrior_front.png",
        "side": "mr_assets/character_art/warrior/warrior_right.png",
    },
    "sorceress": {
        "front": "mr_assets/character_art/sorceress/sorceress_front.png",
        "side": "mr_assets/character_art/sorceress/sorceress_right.png",
    },
    "zombie": {
        "front": "assets/sprites/zombie_front.png", "front_frames": 2,
        "side": "assets/sprites/zombie_right.png", "side_frames": 2,
    },
    "skeletonArcher": {
        "front": "assets/sprites/skeletonarcher.png", "front_frames": 2,
        # No side art: a bone archer is a narrow figure, so depth tracks width closely.
        "depth_of_width": 0.55,
    },
    "bat": {
        "front": "assets/sprites/bat.png", "front_frames": 2,
        # A bat is nearly all wingspan; its body is a fraction of the sheet's width.
        "depth_of_width": 0.35,
    },
}


def load_frame(path, frames=1):
    im = Image.open(os.path.join(ROOT, path)).convert("RGBA")
    if frames > 1:
        im = im.crop((0, 0, im.width // frames, im.height))
    return im


def ink_bounds(im):
    px = im.load()
    xs, ys = [], []
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y][3] > ALPHA:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise ValueError("sprite is empty")
    return min(xs), min(ys), max(xs), max(ys)


def row_runs(px, y, x0, x1):
    """Opaque spans on one row, as (start, end) inclusive."""
    runs, start = [], None
    for x in range(x0, x1 + 1):
        solid = px[x, y][3] > ALPHA
        if solid and start is None:
            start = x
        elif not solid and start is not None:
            runs.append((start, x - 1))
            start = None
    if start is not None:
        runs.append((start, x1))
    return runs


def luminance(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


# Colour quantisation step. Sampling a free median per band gives every band a slightly
# different hex, which does two bad things: the model reads as photographic noise rather than as
# designed art, and the 3D builder can never merge neighbouring bands into one piece because
# their colours never match. Snapping to a coarse ladder collapses a character to roughly a
# dozen tones — closer to how the sprite was actually painted, and mergeable.
QUANT = 20


def quantise(c):
    return tuple(min(255, int(round(v / QUANT)) * QUANT) for v in c[:3])


def band_colors(px, y_lo, y_hi, x0, x1):
    """Three tonal steps from the band's own pixels — the art is shaded, so one flat colour per
    part is what made the first models look dead."""
    cols = []
    for y in range(y_lo, y_hi + 1):
        for x in range(x0, x1 + 1):
            c = px[x, y]
            if c[3] > ALPHA:
                cols.append(c)
    if not cols:
        return None
    cols.sort(key=luminance)
    def pick(f):
        c = quantise(cols[min(len(cols) - 1, int(len(cols) * f))])
        return "#%02x%02x%02x" % c
    return {"dark": pick(0.20), "mid": pick(0.50), "lit": pick(0.85)}


def measure(cfg):
    front = load_frame(cfg["front"], cfg.get("front_frames", 1))
    fx0, fy0, fx1, fy1 = ink_bounds(front)
    fpx = front.load()
    ink_w = fx1 - fx0 + 1
    ink_h = fy1 - fy0 + 1
    cx = (fx0 + fx1) / 2.0

    side = None
    if cfg.get("side"):
        side = load_frame(cfg["side"], cfg.get("side_frames", 1))
        sx0, sy0, sx1, sy1 = ink_bounds(side)
        spx = side.load()
        s_cx = (sx0 + sx1) / 2.0

    bands = []
    for b in range(BANDS):
        # Band 0 is at the FEET; the builder stacks upward, which is how a body is built.
        y_hi = fy1 - int(b * ink_h / BANDS)
        y_lo = fy1 - int((b + 1) * ink_h / BANDS) + 1
        y_lo = max(fy0, min(y_lo, y_hi))
        mid_y = (y_lo + y_hi) // 2

        runs = row_runs(fpx, mid_y, fx0, fx1)
        # Normalised, and centred on the sprite's own axis so left/right are signed offsets.
        norm_runs = [[round((a - cx) / ink_w, 4), round((b2 - cx) / ink_w, 4)] for a, b2 in runs]

        if side is not None:
            sy = int(sy1 - (fy1 - mid_y) * (sy1 - sy0 + 1) / ink_h)
            sy = max(sy0, min(sy, sy1))
            s_runs = row_runs(spx, sy, sx0, sx1)
            depth = 0.0
            if s_runs:
                depth = (max(r[1] for r in s_runs) - min(r[0] for r in s_runs) + 1) / ink_w
        else:
            width = sum(r[1] - r[0] + 1 for r in runs) / ink_w if runs else 0.0
            depth = width * cfg.get("depth_of_width", 0.55)

        bands.append({
            "u": round((b + 0.5) / BANDS, 4),          # 0 at the feet, 1 at the crown
            "runs": norm_runs,
            "depth": round(depth, 4),
            "colors": band_colors(fpx, y_lo, y_hi, fx0, fx1),
        })

    return {
        "aspect": round(ink_w / ink_h, 4),   # width as a fraction of height — the real build
        "inkPx": [ink_w, ink_h],
        "bands": bands,
        "landmarks": landmarks(bands),
    }


def landmarks(bands):
    """Anatomy, read off the run counts rather than authored by hand.

    The legs are where the silhouette SPLITS in two low down; the shoulders are the widest band
    in the upper body; the neck is the narrowest band above the shoulders. A character with no
    split (a robe, a bat) simply reports no hip, and the builder gives it a hem instead of legs.
    """
    n = len(bands)
    hip_u = None
    for i in range(n // 2):                       # scan the lower half, bottom-up
        if len(bands[i]["runs"]) >= 2:
            hip_u = bands[i]["u"]
        elif hip_u is not None:
            break

    def span(b):
        return (max(r[1] for r in b["runs"]) - min(r[0] for r in b["runs"])) if b["runs"] else 0.0

    # Shoulders are sought in the upper torso only. Searching the whole upper HALF found the
    # warrior's flared gauntlets at mid-body instead of his pauldrons — the widest thing above
    # the waist is not always the shoulder, but the widest thing just below the head is.
    shoulder_zone = [b for b in bands if 0.60 <= b["u"] <= 0.90]
    shoulder = max(shoulder_zone, key=span) if shoulder_zone else bands[-1]

    above = [b for b in bands if b["u"] > shoulder["u"]]
    neck = min(above, key=span) if above else shoulder

    return {
        "hipU": hip_u,                            # None = no legs in the silhouette
        "shoulderU": shoulder["u"],
        "neckU": neck["u"],
        # Anything above the neck is head; three runs across the chest means arms are separated
        # from the torso and can be rigged apart.
        "armsSeparate": any(len(b["runs"]) >= 3 for b in bands if 0.5 < b["u"] < shoulder["u"] + 0.01),
    }


def main():
    out = {
        "_generated": "tools/measure-sprites.py in the 2D repo — do not hand-edit, re-measure",
        "_source": "the shipped character sprites; frame 0 of any multi-frame sheet",
        "bands": BANDS,
        "characters": {},
    }
    for name, cfg in CHARACTERS.items():
        try:
            out["characters"][name] = measure(cfg)
            lm = out["characters"][name]["landmarks"]
            print("  %-16s aspect %.2f  hip %s  shoulder %.2f  arms %s" % (
                name, out["characters"][name]["aspect"],
                ("%.2f" % lm["hipU"]) if lm["hipU"] else "none",
                lm["shoulderU"], "split" if lm["armsSeparate"] else "merged"))
        except (FileNotFoundError, ValueError) as e:
            print("  %-16s SKIPPED (%s)" % (name, e))

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.abspath(os.path.join(OUT_DIR, "character-metrics.json"))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print("character-metrics.json  %d characters -> %s" % (len(out["characters"]), path))


if __name__ == "__main__":
    main()
