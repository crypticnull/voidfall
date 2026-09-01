"""Generate a 2-frame walk sheet from a single-frame character PNG.

Frame 1 is the supplied art, untouched. Frame 2 is a derived "passing pose": the legs
converge under the body and the torso rides 1px higher — the moment in a walk cycle where
the legs cross. Everything above the hip is copied verbatim, so only the legs are synthesised.

The hip line and the gap between the legs are detected from the silhouette rather than
hardcoded, so this works across characters of different proportions.

Usage:
    python tools/make_walk_frame.py assets/sprites/warrior_right.png
    python tools/make_walk_frame.py <in.png> [out.png] [--converge=N] [--lift=N] [--headbob=N]

    --converge  px each leg moves toward centre (default 2)
    --lift      px the whole body rises on the passing frame (default 1)
    --headbob   px the head settles relative to the torso (default 1, 0 to disable)
    --bust      the art is a portrait, not a walking figure: no stride, no body lift, and the
                shoulder line is found by the flare below the jaw rather than by the
                full-body proportions (which land in the middle of a face)
    --shoulder  row of the head/torso boundary; overrides auto-detection
    --hip       row of the hip line; overrides auto-detection. Needed when the figure holds
                its arms clear of its body: the detector reads the arm gap as a leg gap and
                puts the hip up in the chest, so the passing frame deforms the torso.
    --armswing  px protruding limbs shift vertically (default 0 = off)
                Shelved: at these sprite sizes only a handful of pixels move and the
                swing is not readable in motion. Kept for larger art or bigger offsets.

Writes the 2-frame sheet to out.png (defaults to overwriting in.png) and stashes the
untouched source alongside it in a `source/` folder.
"""
import struct, zlib, sys, os, shutil


def decode_png(path):
    d = open(path, 'rb').read()
    if d[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit(f'{path}: not a PNG')
    w, h = struct.unpack('>II', d[16:24])
    depth, ctype = d[24], d[25]
    if depth != 8 or ctype != 6:
        raise SystemExit(f'{path}: need 8-bit RGBA (depth=8, colortype=6); got depth={depth}, colortype={ctype}')
    idat = b''
    i = 8
    while i < len(d):
        ln = struct.unpack('>I', d[i:i + 4])[0]
        tag = d[i + 4:i + 8]
        if tag == b'IDAT':
            idat += d[i + 8:i + 8 + ln]
        i += 12 + ln
    raw = zlib.decompress(idat)

    stride = w * 4
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _ in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        for x in range(stride):
            a = line[x - 4] if x >= 4 else 0
            b = prev[x]
            c = prev[x - 4] if x >= 4 else 0
            if f == 1:   line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out += line
        prev = line
    return w, h, out


def encode_png(path, w, h, rgba):
    raw = b''.join(b'\x00' + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )


def runs(px, w, y, thresh=8):
    """Horizontal runs of opaque pixels on row y."""
    spans, start = [], None
    for x in range(w):
        solid = px[(y * w + x) * 4 + 3] > thresh
        if solid and start is None:
            start = x
        elif not solid and start is not None:
            spans.append((start, x - 1)); start = None
    if start is not None:
        spans.append((start, w - 1))
    return spans


def leg_spans(px, w, y, min_width):
    """The two outermost spans on a row, but only when both are wide enough to be legs.

    A stray 1px element (a weapon tip, a belt buckle) also splits a row into multiple spans.
    Treating that as a leg would shift the whole torso sideways, so require real width.
    """
    # Discard narrow strays (a weapon tip, a dangling buckle) BEFORE picking the outermost
    # spans. Taking sp[0]/sp[-1] first and width-testing after meant a 1px fleck at the edge
    # could masquerade as a leg, which both moved the wrong pixels and made find_legs stop
    # short of the real hip.
    sp = [r for r in runs(px, w, y) if (r[1] - r[0] + 1) >= min_width]
    if len(sp) < 2:
        return None, None
    return sp[0], sp[-1]


def find_legs(px, w, h, hip_override=None):
    """Walk up from the feet; the leg region is the run of rows split into two spans.

    Returns (hip_y, split_x). Falls back to proportional guesses if the silhouette never
    separates (e.g. a robed character with no visible gap between the legs).

    `hip_override` pins the hip line instead of detecting it. Detection assumes the only thing
    that splits a row into two spans is the gap between the legs, so a figure holding its ARMS
    clear of its body keeps splitting rows all the way up the torso and the upward walk runs
    straight past the real hip. The frame-2 converge then squeezes the chest inward instead of
    bringing the legs together, which reads as the body deforming rather than as a stride. It is
    not detectable from the silhouette — an arm gap and a leg gap are the same shape — so the
    caller has to say. The gap centre is re-measured from the override down, since gaps
    collected up in the torso would drag the split off the legs too.
    """
    min_width = max(2, w // 12)
    if hip_override is not None:
        gaps = []
        for y in range(hip_override, h):
            left, right = leg_spans(px, w, y, min_width)
            if left:
                gaps.append((left[1] + right[0]) // 2)
        return hip_override, (sum(gaps) // len(gaps)) if gaps else w // 2
    hip_y, gaps = None, []
    for y in range(h - 1, -1, -1):
        left, right = leg_spans(px, w, y, min_width)
        # Two spans of real width means the legs are separated. Anything narrower between
        # them (a dangling scabbard, a weapon tip) is ignored, not treated as a leg.
        if left:
            hip_y = y
            gaps.append((left[1] + right[0]) // 2)
        elif hip_y is not None:
            break  # legs have merged into the torso — this is the hip line
    if hip_y is None or not gaps:
        return int(h * 0.62), w // 2
    return hip_y, sum(gaps) // len(gaps)


def find_shoulders_bust(px, w, h):
    """Shoulder line for a PORTRAIT — head-and-shoulders, not a whole figure.

    find_shoulders() is built for full-body art, where the head is roughly the top fifth. On a
    bust the head fills nearly half the frame, so that proportional fallback lands in the middle
    of the face: it put the ranger's cut through her eyes and the sorceress's through her nose.
    Its "sharp neck step" test does not save them either, because hair and a hood merge the head
    into the shoulders with no step to find.

    What IS reliable on every bust is the shoulders flaring out below the jaw. This looks for the
    largest widening over a three-row window and cuts just above it, which finds the pauldron
    line on an armoured helm and the trapezius line under loose hair alike.
    """
    widths = []
    for y in range(h):
        sp = runs(px, w, y)
        widths.append(max((b - a + 1) for a, b in sp) if sp else 0)
    ink = [y for y, wd in enumerate(widths) if wd > 0]
    if not ink:
        return None, 'empty'
    top, bottom = ink[0], ink[-1]
    span = bottom - top + 1

    # Search the middle half only. Above it is skull and hair, which widen steadily and would
    # otherwise win; below it is the chest, which flares again at the arms.
    lo = max(top + 1, top + int(span * 0.25))
    hi = min(h - 1, top + int(span * 0.75))
    best_y, best = None, 0
    for y in range(lo, hi):
        # Three-row window: a real shoulder ramps over a couple of rows rather than stepping in
        # one, and comparing adjacent rows alone scores that ramp too low to beat the noise.
        jump = widths[min(y + 2, h - 1)] - widths[y - 1]
        if jump > best:
            best, best_y = jump, y
    if best_y is None:
        return top + max(1, round(span * 0.45)), 'bust proportional'
    return best_y, f'bust flare (+{best}px)'


def find_shoulders(px, w, h, override=None):
    """Locate the shoulder line — the boundary between head and torso.

    Two strategies, in order:
      1. A sharp widening of the silhouette (a distinct neck). Measures the widest span per
         row so an off-body element — a raised sword, a staff — can't be read as body width.
      2. Failing that, a proportional fallback at 20% down the occupied height. Characters in
         heavy helmets and pauldrons often taper smoothly with no detectable neck, and a
         guessed-wrong sharp step is worse than a consistent proportion.

    Pass --shoulder=N to set it explicitly. The chosen row is always printed so it can be
    checked and overridden per character.
    """
    if override is not None:
        return override, 'explicit'

    widths = []
    for y in range(h):
        sp = runs(px, w, y)
        widths.append(max((b - a + 1) for a, b in sp) if sp else 0)

    top = next((y for y, wd in enumerate(widths) if wd > 0), None)
    if top is None:
        return None, 'empty'
    bottom = max(y for y, wd in enumerate(widths) if wd > 0)

    # 1. sharp neck.
    # Skip the first rows below the crown: a head naturally widens as it rounds out, and that
    # early ramp can look exactly like a neck step. A real neck sits some way down the body.
    start = top + max(2, round((bottom - top) * 0.12))
    limit = max(start + 2, int(h * 0.45))
    best_y, best_jump = None, 0
    for y in range(start, min(limit, h)):
        jump = widths[y] - widths[y - 1]
        if jump > best_jump:
            best_jump, best_y = jump, y
    if best_y:
        head_w = max(widths[top:best_y]) if best_y > top else 0
        if best_jump >= 3 and head_w and widths[best_y] >= head_w * 1.35:
            return best_y, 'neck step'

    # 2. proportional
    return top + max(1, round((bottom - top) * 0.20)), 'proportional'


BLANK = bytes(4)  # fully transparent RGBA


def torso_edges(px, w, band):
    """Median left/right edge of the torso across the given rows.

    Arms and weapons jut past this; the torso itself sits near it. Using the median rather
    than the extremes means a single outstretched limb cannot drag the reference outward.
    """
    lefts, rights = [], []
    for y in band:
        sp = runs(px, w, y)
        if not sp:
            continue
        lefts.append(sp[0][0])
        rights.append(sp[-1][1])
    if not lefts:
        return None, None
    lefts.sort(); rights.sort()
    return lefts[len(lefts) // 2], rights[len(rights) // 2]


def swing_limbs(px, out, w, h, shoulder_y, hip_y, dy, jut=3):
    """Nudge protruding limbs vertically to suggest an arm swing.

    Only pixels beyond the torso's median edge move, so the body is untouched and a sprite
    with no outstretched arm simply gets no change. Each moved column re-fills the pixel it
    vacates from its own end, so the limb never develops a 1px hole at the shoulder.
    Left and right swing opposite ways, as arms do.
    """
    band = range(shoulder_y, min(hip_y, h))
    med_l, med_r = torso_edges(px, w, band)
    if med_l is None:
        return 0
    moved = 0

    def shift_column(x, direction):
        nonlocal moved
        col = [y for y in band if px[(y * w + x) * 4 + 3] > 8]
        if not col:
            return
        # Clear this column's band pixels in the output, then redraw shifted.
        for y in col:
            i = (y * w + x) * 4
            out[i:i + 4] = BLANK
        for y in col:
            ny = y + direction
            if 0 <= ny < h:
                src = (y * w + x) * 4
                dst = (ny * w + x) * 4
                out[dst:dst + 4] = px[src:src + 4]
        # Re-fill the vacated end so the limb keeps its length.
        fill_y = col[0] if direction > 0 else col[-1]
        i = (fill_y * w + x) * 4
        out[i:i + 4] = px[i:i + 4]
        moved += 1

    for x in range(w):
        # Right-side limb: anything reaching past the torso's right edge.
        if x > med_r + jut and any(px[(y * w + x) * 4 + 3] > 8 for y in band):
            shift_column(x, dy)
        # Left-side limb swings the other way.
        elif x < med_l - jut and any(px[(y * w + x) * 4 + 3] > 8 for y in band):
            shift_column(x, -dy)
    return moved


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a.split('=')[0]: a.split('=')[1] for a in sys.argv[1:] if a.startswith('--') and '=' in a}
    if not args:
        raise SystemExit(__doc__)
    src = args[0]
    dst = args[1] if len(args) > 1 else src
    # --bust: the art is a portrait. There is no stride to animate and no whole-body lift to
    # apply, and the shoulder line has to be found a different way — see find_shoulders_bust.
    # All of that is one decision about the artwork, so it is one flag rather than three the
    # caller has to remember to pass together.
    bust = '--bust' in sys.argv[1:]
    converge = int(flags.get('--converge', 0 if bust else 2))
    lift = int(flags.get('--lift', 0 if bust else 1))
    headbob = int(flags.get('--headbob', 1))
    armswing = int(flags.get('--armswing', 0))
    shoulder_override = int(flags['--shoulder']) if '--shoulder' in flags else None
    hip_override = int(flags['--hip']) if '--hip' in flags else None

    w, h, px = decode_png(src)
    if w % 2 == 0 and flags.get('--force') != '1':
        # A sheet that was already generated would come back in here and get doubled again.
        print(f'note: {src} is {w}x{h}; if this is already a 2-frame sheet, pass the single '
              f'frame instead (source/ holds the original).')

    hip_y, split_x = find_legs(px, w, h, hip_override)
    # A robed character has no separated legs, but a staff or a flared hem still splits rows
    # into multiple spans — which reads as a very short "leg" region low on the body. Moving
    # those spans would tear the robe apart, so warn and let the caller pass --converge=0.
    occupied = [y for y in range(h) if runs(px, w, y)]
    if occupied and converge:
        body_h = occupied[-1] - occupied[0] + 1
        leg_rows = sum(1 for y in range(hip_y, h) if leg_spans(px, w, y, max(2, w // 12))[0])
        if leg_rows < body_h * 0.15:
            print(f'  WARNING: only {leg_rows} rows show two legs ({body_h}px body). This may be '
                  f'a robed figure with no legs — re-run with --converge=0 for a bob-only frame.')
    if not headbob:
        shoulder_y, how = None, 'off'
    elif shoulder_override is not None:
        shoulder_y, how = shoulder_override, 'explicit'
    elif bust:
        shoulder_y, how = find_shoulders_bust(px, w, h)
    else:
        shoulder_y, how = find_shoulders(px, w, h)
    head_note = f'shoulder y={shoulder_y} ({how}) headbob={headbob}px' if shoulder_y else 'head bob: off'
    print(f'{src}: {w}x{h}  hip line y={hip_y} ({"explicit" if hip_override is not None else "detected"})  leg gap x={split_x}  converge={converge}px  lift={lift}px  {head_note}')

    def get(buf, x, y):
        if 0 <= x < w and 0 <= y < h:
            i = (y * w + x) * 4
            return buf[i:i + 4]
        return b'\x00\x00\x00\x00'

    def put(buf, x, y, p):
        if 0 <= x < w and 0 <= y < h and p[3] > 0:
            i = (y * w + x) * 4
            buf[i:i + 4] = p

    # Legs converge toward one another below the hip. Only the leftmost and rightmost spans
    # on each row are treated as legs — a span between them (a hanging scabbard, a weapon
    # tip) stays put, since shifting half of it one way and half the other would tear it.
    min_width = max(2, w // 12)
    conv = bytearray(w * h * 4)
    for y in range(h):
        left, right = leg_spans(px, w, y, min_width) if y >= hip_y else (None, None)
        for x in range(w):
            p = get(px, x, y)
            if p[3] == 0:
                continue
            dx = 0
            if left and left[0] <= x <= left[1]:
                dx = converge
            elif right and right[0] <= x <= right[1]:
                dx = -converge
            put(conv, x + dx, y, p)

    # Arms swing before the head/body offsets, so the limb move is relative to the body.
    if armswing and shoulder_y:
        n = swing_limbs(px, conv, w, h, shoulder_y, hip_y, armswing)
        print(f'  arm swing: {n} limb columns moved {armswing}px')

    # The head settles by `headbob` px relative to the torso. Combined with the whole-body
    # lift below, the head stays near its original height while the shoulders rise — which is
    # what a head bob actually looks like. Applied before the lift so the two compose.
    if shoulder_y and headbob:
        bobbed = bytearray(w * h * 4)
        for y in range(h):
            for x in range(w):
                # Rows above the shoulder are the head: pull them down into the shoulders.
                src_y = y - headbob if y < shoulder_y + headbob else y
                put(bobbed, x, y, get(conv, x, src_y))
        conv = bobbed

    # Whole body rises on the passing frame.
    frame2 = bytearray(w * h * 4)
    for y in range(h):
        for x in range(w):
            put(frame2, x, y, get(conv, x, y + lift))

    # Preserve the untouched single frame next to the sheet.
    srcdir = os.path.join(os.path.dirname(dst) or '.', 'source')
    os.makedirs(srcdir, exist_ok=True)
    keep = os.path.join(srcdir, os.path.splitext(os.path.basename(dst))[0] + '_frame1.png')
    if os.path.abspath(src) != os.path.abspath(keep):
        shutil.copyfile(src, keep)

    sw = w * 2
    sheet = bytearray(sw * h * 4)
    for y in range(h):
        for x in range(w):
            for buf, xo in ((px, 0), (frame2, w)):
                p = buf[(y * w + x) * 4:(y * w + x) * 4 + 4]
                if p[3] > 0:
                    j = (y * sw + x + xo) * 4
                    sheet[j:j + 4] = p

    encode_png(dst, sw, h, sheet)
    print(f'wrote {dst}  {sw}x{h}  (2 frames of {w}x{h});  source kept at {keep}')


if __name__ == '__main__':
    main()
