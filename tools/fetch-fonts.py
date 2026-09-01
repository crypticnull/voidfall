# Vendors the game's webfonts into assets/fonts/ so the build carries them.
#
# style.css used to pull all four families straight from fonts.googleapis.com. That is fine in
# a browser with a network and wrong for a packaged Electron game: offline players got system
# fallbacks for the HUD, the menus AND the canvas damage numbers, which is a visible downgrade
# rather than a subtle one. It also meant a third-party request on every launch.
#
# Run this again if a family or weight is added to FAMILIES below; it rewrites
# assets/fonts/fonts.css wholesale and re-downloads only files it does not already have.
#
#   python tools/fetch-fonts.py

import os
import re
import urllib.request

# Exactly the families and weights style.css asked Google for, so appearance is unchanged.
FAMILIES = (
    'family=Cinzel:wght@500;700;900'
    '&family=Pirata+One'
    '&family=Pixelify+Sans:wght@400;500;600;700'
    '&family=Press+Start+2P'
)
CSS_URL = f'https://fonts.googleapis.com/css2?{FAMILIES}&display=swap'
# Without a modern browser UA the API serves legacy TTF instead of woff2 (roughly 4x the size).
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'assets', 'fonts')


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req) as r:
        return r.read()


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    css = get(CSS_URL).decode('utf-8')

    # Each @font-face in the response is one family + weight + unicode subset.
    blocks = re.findall(r'/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*\{.*?\})', css, re.S)
    if not blocks:
        raise SystemExit('no @font-face blocks in the response — did the API change?')

    out, seen, total = [], set(), 0
    for subset, block in blocks:
        fam = re.search(r"font-family:\s*'([^']+)'", block).group(1)
        weight = re.search(r'font-weight:\s*(\d+)', block).group(1)
        url = re.search(r'url\((https://[^)]+\.woff2)\)', block).group(1)
        urange = re.search(r'unicode-range:\s*([^;]+);', block)

        name = f'{slug(fam)}-{weight}-{slug(subset)}.woff2'
        path = os.path.join(OUT_DIR, name)
        if name not in seen:
            if not os.path.exists(path):
                with open(path, 'wb') as f:
                    f.write(get(url))
            seen.add(name)
            total += os.path.getsize(path)

        out.append(
            '@font-face {\n'
            f"  font-family: '{fam}';\n"
            '  font-style: normal;\n'
            f'  font-weight: {weight};\n'
            # block, not swap: these are the game's own faces, and a flash of Times New Roman
            # in a pixel-art menu looks worse than a few ms of nothing.
            '  font-display: block;\n'
            f"  src: url('{name}') format('woff2');\n"
            + (f'  unicode-range: {urange.group(1).strip()};\n' if urange else '')
            + '}\n'
        )

    header = (
        '/* Self-hosted game fonts — GENERATED, do not hand-edit.\n'
        '   Regenerate with: python tools/fetch-fonts.py\n'
        '   See that file for why these are vendored rather than fetched from Google. */\n\n'
    )
    with open(os.path.join(OUT_DIR, 'fonts.css'), 'w', encoding='utf-8') as f:
        f.write(header + '\n'.join(out))

    print(f'{len(seen)} files, {total / 1024:.1f} KB -> assets/fonts/')
    for n in sorted(seen):
        print('  ', n)


if __name__ == '__main__':
    main()
