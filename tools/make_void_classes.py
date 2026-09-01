"""Generate placeholder art for the three void classes.

PLACEHOLDER, deliberately in-engine: 37x64 single frames in the same spec as the hand-drawn
characters (see mr_assets/character_art/*), written to mr_assets/character_art/_generic/ and
then run through make_walk_frame.py into the shipped 2-frame sheets. When real art lands,
overwrite the sources and rebuild with the same command — nothing else changes.

All three are hooded void figures: near-black body (a silhouette that reads as an absence,
the same rule as the void skill icons) with each class's accent colour carrying the identity:

  hollowed  #6b3fc0  a hole clean through the chest, ringed in light
  marked    #a05fe0  three seal-dots down the hood

Usage:
    python tools/make_void_classes.py
"""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from make_walk_frame import encode_png

W, H = 37, 64

BODY = (18, 14, 32, 255)       # near-black violet
BODY_LIT = (30, 24, 52, 255)   # left-lit edge
HOOD_DK = (12, 9, 22, 255)     # inside of the hood: darker than the body, a true hole
CLASSES = {
    'hollowed': (107, 63, 192, 255),
    'marked': (160, 95, 224, 255),
}


def blank():
    return bytearray(W * H * 4)


def px(buf, x, y, c):
    if 0 <= x < W and 0 <= y < H:
        i = (y * W + x) * 4
        buf[i:i + 4] = bytes(c)


def rect(buf, x0, y0, w, h, c):
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            px(buf, x, y, c)


def det(x, y):
    """Cheap deterministic hash in [0,1): ragged hems and wisps must not change between runs."""
    n = (x * 374761393 + y * 668265263) & 0xffffffff
    n = (n ^ (n >> 13)) * 1274126177 & 0xffffffff
    return ((n ^ (n >> 16)) % 1000) / 1000


def cloak(buf, facing):
    """The shared body: hood, tapering cloak, ragged hem. Same silhouette all three wear."""
    cx = W // 2
    # Hood: a rounded mass, widest at the brow.
    for y in range(6, 20):
        half = 7 if 9 <= y <= 16 else 6 if y < 9 else 7
        rect(buf, cx - half, y, half * 2 + 1, 1, BODY)
        px(buf, cx - half, y, BODY_LIT)
    # Face: a hole. On the back view the hood is unbroken.
    if facing in ('front', 'right'):
        ox = 2 if facing == 'right' else 0
        for y in range(10, 17):
            half = 4 if 11 <= y <= 15 else 3
            rect(buf, cx - half + ox, y, half * 2 + 1 - abs(ox), 1, HOOD_DK)
    # Shoulders out to the cloak's widest point, then a taper to the hem.
    for y in range(20, 58):
        t = (y - 20) / 38
        half = round(9 + 2 * min(1, t * 3) - 3 * max(0, t - 0.6) / 0.4)
        # Ragged hem: the last rows lose pixels to deterministic noise.
        if y > 52 and det(half, y) < (y - 52) * 0.18:
            half -= 1
        rect(buf, cx - half, y, half * 2 + 1, 1, BODY)
        px(buf, cx - half, y, BODY_LIT)
        if y > 54 and det(y, half) < 0.5:
            px(buf, cx - half + 2 + int(det(y, 3) * (half * 2 - 3)), y, (0, 0, 0, 0))


def decorate(buf, cls, facing, accent):
    cx = W // 2
    bright = tuple(min(255, c + 70) for c in accent[:3]) + (255,)
    if cls == 'hollowed':
        # The hole through the chest — visible from every side, because it goes THROUGH.
        hy = 30
        for y in range(hy - 3, hy + 4):
            for x in range(cx - 3, cx + 4):
                d2 = (x - cx) ** 2 + (y - hy) ** 2
                if d2 <= 6:
                    px(buf, x, y, (0, 0, 0, 0))       # nothing at all: the floor shows through
                elif d2 <= 12:
                    px(buf, x, y, accent)
        px(buf, cx - 3, hy - 3, bright); px(buf, cx + 3, hy + 3, bright)
    elif cls == 'marked':
        # Three seal-dots down the hood and a faint third-eye slit on the brow.
        xs = cx + (2 if facing == 'right' else 0)
        for i, y in enumerate((8, 21, 26)):
            c = bright if i == 0 else accent
            px(buf, xs, y, c); px(buf, xs - 1, y, c); px(buf, xs + 1, y, c)
        if facing != 'back':
            rect(buf, xs - 2, 12, 5, 1, accent)
    # Accent eyes in the hood's dark, all three, so the face reads at play size.
    if facing in ('front', 'right'):
        ox = 2 if facing == 'right' else 0
        px(buf, cx - 2 + ox, 13, bright)
        if facing == 'front':
            px(buf, cx + 2, 13, bright)


def rim(buf, accent):
    """Accent-tinted edge on every body pixel that borders emptiness.

    The body is DELIBERATELY near-black — the void's whole visual language is a hole with a
    bright edge (see drawVoidFlames) — but a near-black figure on the near-black portrait
    background is invisible. The rim is what carries the silhouette, exactly as it does on the
    afflicted enemies' flames.
    """
    dim = tuple(int(c * 0.55) for c in accent[:3]) + (255,)
    edges = []
    for y in range(H):
        for x in range(W):
            i = (y * W + x) * 4
            if buf[i + 3] == 0:
                continue
            if tuple(buf[i:i + 4]) not in (BODY, BODY_LIT):
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if not (0 <= nx < W and 0 <= ny < H) or buf[(ny * W + nx) * 4 + 3] == 0:
                    edges.append((x, y))
                    break
    for x, y in edges:
        px(buf, x, y, dim)


# Portrait spec, matching warrior/sorceress/ranger: a 74x64 FILE that the engine slices into
# TWO 37x64 frames (imageFrames: 2, same as the walk sheets). Writing one 74-wide drawing here
# was the second half of the portrait bug — the engine showed its left 37px and the bust read as
# a magnified diagonal band. The bust is drawn once at frame size and stamped twice.
PFW, PH = 37, 64
PW = PFW * 2


def portrait(cls, accent):
    """A head-and-shoulders bust, drawn at the portrait spec rather than cropped from the walk
    frame.

    This is not a nicety — it is the fix for a real bug. A class WITHOUT dedicated portrait art
    goes through drawPortraitBust's fallback, which manufactures a bust by magnifying the top
    60% of the walk sprite. On a tall 37x64 figure whose head is a small hood that magnifies to
    roughly 6x, and since the portrait idle-bob moves in SOURCE pixels, every bob became an
    ~11px jump on screen — which read as the portrait flashing and jittering. Real bust art
    takes the "drawn whole" branch instead, with no magnification and no jitter.
    """
    buf = bytearray(PFW * PH * 4)

    def ppx(x, y, c):
        if 0 <= x < PFW and 0 <= y < PH:
            i = (y * PFW + x) * 4
            buf[i:i + 4] = bytes(c)

    cx = PFW // 2
    dim = tuple(int(c * 0.55) for c in accent[:3]) + (255,)
    bright = tuple(min(255, c + 70) for c in accent[:3]) + (255,)
    # Shoulders across the bottom, hood above — framed so the face sits at the card's centre.
    for y in range(38, PH):
        half = 13 + (y - 38) // 3
        for x in range(cx - half, cx + half + 1):
            ppx(x, y, BODY)
        ppx(cx - half, y, dim); ppx(cx + half, y, dim)
    for y in range(6, 40):
        t = (y - 6) / 34
        half = round(7 + 7 * min(1, t * 1.5))
        for x in range(cx - half, cx + half + 1):
            ppx(x, y, BODY)
        ppx(cx - half, y, dim); ppx(cx + half, y, dim)
    # The hood's hollow, and eyes in it.
    for y in range(14, 36):
        half = 8 if 18 <= y <= 32 else 6
        for x in range(cx - half, cx + half + 1):
            ppx(x, y, HOOD_DK)
    for dx in (-4, 4):
        for yy in range(23, 26):
            for xx in range(dx - 2, dx + 3):
                ppx(cx + xx, yy, accent)
        ppx(cx + dx, 24, bright)
    # Per-class tell, matching the walk sprite's.
    if cls == 'hollowed':
        for y in range(46, 56):
            for x in range(cx - 5, cx + 6):
                d2 = (x - cx) ** 2 + (y - 51) ** 2
                if d2 <= 14:
                    ppx(x, y, (0, 0, 0, 0))
                elif d2 <= 26:
                    ppx(x, y, accent)
    elif cls == 'marked':
        for i, y in enumerate((8, 11, 14)):
            c = bright if i == 0 else accent
            for x in range(cx - 2, cx + 3):
                ppx(x, y, c)
    return buf


def main():
    out_dir = pathlib.Path('mr_assets/character_art/_generic')
    out_dir.mkdir(parents=True, exist_ok=True)
    for cls, accent in CLASSES.items():
        for facing in ('front', 'right', 'back'):
            buf = blank()
            cloak(buf, facing)
            rim(buf, accent)
            decorate(buf, cls, facing, accent)
            path = out_dir / f'{cls}_{facing}.png'
            encode_png(str(path), W, H, buf)
            print('wrote', path)
        # Portraits go straight to assets/ — they are single frames, not walk sheets, so they
        # never pass through make_walk_frame.
        ppath = pathlib.Path('assets/sprites') / f'{cls}_portrait.png'
        one = portrait(cls, accent)
        sheet = bytearray(PW * PH * 4)
        for y in range(PH):
            for x in range(PFW):
                src = (y * PFW + x) * 4
                for f in range(2):
                    dst = (y * PW + x + f * PFW) * 4
                    sheet[dst:dst + 4] = one[src:src + 4]
        encode_png(str(ppath), PW, PH, sheet)
        print('wrote', ppath)


if __name__ == '__main__':
    main()
