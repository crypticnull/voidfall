"""Stitch already-drawn animation frames into one horizontal sprite sheet.

Use this when the frames are hand-authored -- a bat's wing flap, say -- rather than derived
from a single pose. That is the difference from make_walk_frame.py, which invents a second
frame from one drawing; here every frame is yours and the tool only lays them out.

The engine slices a sheet into `imageFrames` equal columns, so all inputs must share the same
dimensions. That is checked rather than assumed: a mismatched frame would otherwise slice into
a silently offset animation.

Usage:
    python tools/make_sheet.py assets/sprites/bat.png frame1.png frame2.png [frame3.png ...]
"""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from make_walk_frame import decode_png, encode_png


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    out_path = sys.argv[1]
    sources = sys.argv[2:]

    frames = []
    for src in sources:
        w, h, px = decode_png(src)
        frames.append((src, w, h, px))

    w0, h0 = frames[0][1], frames[0][2]
    for src, w, h, _ in frames[1:]:
        if (w, h) != (w0, h0):
            raise SystemExit(
                f'frame size mismatch: {sources[0]} is {w0}x{h0} but {src} is {w}x{h}.\n'
                'Every frame must match — the engine slices the sheet into equal columns.')

    n = len(frames)
    sheet_w = w0 * n
    out = bytearray(sheet_w * h0 * 4)
    for i, (_, w, h, px) in enumerate(frames):
        for y in range(h):
            src_row = y * w * 4
            dst_row = (y * sheet_w + i * w) * 4
            out[dst_row:dst_row + w * 4] = px[src_row:src_row + w * 4]

    encode_png(out_path, sheet_w, h0, bytes(out))
    print(f'wrote {out_path}  {sheet_w}x{h0}  ({n} frames of {w0}x{h0})')
    print(f'  set imageFrames: {n} on the sprite def')


if __name__ == '__main__':
    main()
