"""Render the game's colour tokens to a PNG contact sheet.

A palette that only exists as `--bone: #c9bfa8` scattered through a 2,500-line stylesheet cannot
be looked at, and "looked at" is the only way to notice that two greys are doing one grey's job.
This draws every token at size, with its name, hex and the role it plays.

TWO SHEETS, because the project has two: the game's warm bone-and-blood UI, and the dev tools'
red-on-dark workbench that was deliberately split away from it (gold is the game's reward
colour and does not belong on a workbench's navigation — see the .devIcon block in style.css).
Showing them side by side is the point: it is the only view in which the split is visible.

Colours are READ FROM style.css rather than retyped here, so the sheet cannot drift from the
stylesheet the way a hand-kept copy would. Only the grouping and the role text live in this file.

Usage:  python tools/palette-sheet.py [out.png]
"""
import pathlib
import re
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = ROOT / 'style.css'

# --- token -> the role it actually plays, in the words the stylesheet uses for it -------------
# Anything not listed still renders; it just carries no role line.
ROLES = {
    'void': 'the black everything sits on',
    'panel-hi': 'raised plate — buttons, chips',
    'panel-lo': 'sunken plate — panels, wells',
    'iron': 'borders, keylines',
    'iron-lit': 'lit border, bevel highlight',
    'chrome': 'keylines, corner squares, idle button text',
    'chrome-lit': 'lit red — hover, active label',
    'chrome-dim': 'deep red — pressed, shadowed',
    'gold': 'gold stroke, rules, dividers',
    'gold-bright': 'lit gold — focus, selection, reward',
    'blood': 'health bar track, deep wound',
    'blood-bright': 'health fill, kill counter',
    'bone': 'primary text',
    'bone-dim': 'secondary text, captions',
    'steel': 'armour bar — cold plate',
}

# The dev-tools palette. These are literals in style.css rather than tokens (the workbench was
# split off after the token block was written), so they are located by the rule they live in.
DEV_HEXES = [
    ('tab plate', '#c9382e', '.devIcon:hover / .on — tabs in red, not gold'),
    ('tab plate (on)', '#d94a3d', '.devIcon.on — the selected page, one step brighter'),
    ('tab border', '#5c1a15', '.devIcon border — the red plate, deepened'),
    ('tab label', '#1a0806', '.devIcon label on the red plate'),
    ('dev label', '#e0655a', '#devMenu .settingLabel / .tuneName — red-on-dark labels'),
    ('confirm green', '#7fc46a', '.tuneMax.active / .tuneSave.saved — a state, not a press'),
    ('field black', '#0e0a06', '.tuneNum:focus — the well behind a focused number'),
    ('muted label', '#635b4d', '.tuneBox.off — an unequipped skill greys out'),
]

CANVAS_BG = '#141117'
CARD_BG = '#1c1920'


def read_tokens():
    """Pull `--name: #hex;` out of the :root block. The stylesheet is the single source."""
    css = CSS.read_text(encoding='utf-8')
    start = css.index(':root {')
    block = css[start:css.index('\n}', start)]
    found = re.findall(r'--([a-z-]+):\s*(#[0-9a-fA-F]{3,8})\s*;', block)
    # Dedupe, keeping the first definition — later breakpoints redefine sizes, not colours.
    seen, out = set(), []
    for name, hexv in found:
        if name in seen:
            continue
        seen.add(name)
        out.append((name, hexv.lower()))
    return out


def font(size, bold=False):
    for name in (('arialbd.ttf', 'seguisb.ttf') if bold else ('arial.ttf', 'segoeui.ttf')):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def luminance(hexv):
    r, g, b = (int(hexv[i:i + 2], 16) for i in (1, 3, 5))
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255


def draw_swatch(d, x, y, w, h, name, hexv, role):
    """One chip: the colour at size, its name, its hex, and what it is for."""
    d.rectangle([x, y, x + w, y + h], fill=CARD_BG)
    sw = 118
    d.rectangle([x, y, x + sw, y + h], fill=hexv)
    # A hairline inside the swatch so a near-black chip still shows its edge against the card.
    d.rectangle([x, y, x + sw, y + h], outline='#2e2a33', width=1)
    # The hex is printed ON the colour, flipped to stay legible on light and dark alike — which
    # doubles as a contrast check you can see at a glance.
    d.text((x + 8, y + h - 21), hexv.upper(), font=font(12, True),
           fill='#000000' if luminance(hexv) > 0.45 else '#ffffff')
    tx = x + sw + 14
    d.text((tx, y + 9), name, font=font(15, True), fill='#e8e2d4')
    if role:
        d.text((tx, y + 31), role, font=font(12), fill='#8a8496')


def draw_column(d, x, y, title, subtitle, rows, col_w):
    d.text((x, y), title, font=font(20, True), fill='#e8e2d4')
    d.text((x, y + 26), subtitle, font=font(12), fill='#8a8496')
    yy = y + 52
    for name, hexv, role in rows:
        draw_swatch(d, x, yy, col_w, 52, name, hexv, role)
        yy += 58
    return yy


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets/ui/palette.png'
    tokens = read_tokens()
    game_rows = [(f'--{n}', h, ROLES.get(n, '')) for n, h in tokens]
    dev_rows = [(n, h, r) for n, h, r in DEV_HEXES]

    col_w, gap, pad = 430, 46, 34
    head = 76
    body = max(len(game_rows), len(dev_rows)) * 58 + 52
    W = pad * 2 + col_w * 2 + gap
    H = head + body + pad + 26

    img = Image.new('RGB', (W, H), CANVAS_BG)
    d = ImageDraw.Draw(img)

    d.text((pad, 26), 'VOIDFALL SURVIVORS — COLOUR PALETTE', font=font(26, True), fill='#c9a227')
    d.text((pad, 56), f'read from style.css · {len(game_rows)} UI tokens + {len(dev_rows)} dev-tools colours',
           font=font(12), fill='#8a8496')

    draw_column(d, pad, head, 'GAME UI', 'the :root tokens — warm bone, iron and blood', game_rows, col_w)
    draw_column(d, pad + col_w + gap, head, 'DEV TOOLS',
                'the workbench — red on dark, deliberately not gold', dev_rows, col_w)

    d.text((pad, H - 24), 'tools/palette-sheet.py — regenerate after changing style.css',
           font=font(11), fill='#5b566a')

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f'wrote {out}  {W}x{H}')
    print(f'  game UI tokens: {len(game_rows)}')
    print(f'  dev tools:      {len(dev_rows)}')


if __name__ == '__main__':
    main()
