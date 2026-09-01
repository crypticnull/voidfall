"""Copy tuning saved inside a packaged build into the repo, ready to bake.

The dev server writes tuning/skill-tuning.json directly whenever the browser posts a Save, so
browser tuning needs nothing. A packaged exe cannot do that -- it unpacks to a temp directory
and its own files live in a read-only asar -- so electron/main.js writes the same payload to
userData instead. This carries it the last hop.

Why it matters: `npm run dist:portable` bakes tuning/skill-tuning.json into src/skills.js on
every build. Balance work done in a release and NOT pulled first does not merely fail to ship,
it gets overwritten -- the build bakes whatever the repo file still says, silently reverting
the session. Run this before building whenever the last tuning happened in the exe.

Usage:
    python tools/pull-exe-tuning.py            # show what differs, write nothing
    python tools/pull-exe-tuning.py --apply    # copy it into tuning/skill-tuning.json
"""
import json, os, pathlib, shutil, sys, datetime

# Electron derives userData from package.json "name", so the Duskfall -> Voidfall rename moved
# this folder. Both are checked, newest first: an exe built before the rename still has its
# tuning under the old name, and silently finding nothing is worse than looking twice.
_APPDATA = pathlib.Path(os.environ['APPDATA'])
_CANDIDATES = [_APPDATA / 'voidfall-survivors', _APPDATA / 'duskfall-survivors']
APPDIR = next((d for d in _CANDIDATES if d.exists()), _CANDIDATES[0])
# Both files the packaged build writes. Skills bake into skills.js; player and enemy tuning
# bakes into classes.js and enemies.js. Pulling one and forgetting the other is exactly the
# silent-revert this tool exists to prevent, so they are always handled together.
PAIRS = [
    ('skills', APPDIR / 'skill-tuning.json', pathlib.Path('tuning/skill-tuning.json')),
    ('player/enemy', APPDIR / 'entity-tuning.json', pathlib.Path('tuning/entity-tuning.json')),
]


def load(p):
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as e:
        print(f'!! {p} is not valid JSON ({e}) -- refusing to use it')
        sys.exit(1)


def diff(repo, exe, prefix=''):
    """Print every leaf that differs. Both files nest one or two levels, so this recurses."""
    out = False
    for k in sorted(set(repo) | set(exe)):
        a, b = repo.get(k), exe.get(k)
        if isinstance(a, dict) or isinstance(b, dict):
            out |= diff(a or {}, b or {}, f'{prefix}{k}.')
        elif a != b:
            print(f'  {prefix}{k}: {"-" if a is None else a} -> {"-" if b is None else b}')
            out = True
    return out


def merge(repo, exe, conflicts, superseded, exe_newer, prefix=''):
    """Exe values folded INTO the repo file, rather than replacing it.

    Tuning happens on both sides — in the packaged build and in the browser — and the two write
    to different stores. Replacing the repo file wholesale, which is what this used to do,
    silently threw away every browser-side edit the moment anyone pulled from the exe.

    THE MORE RECENTLY SAVED FILE WINS, and that applies to every key the exe offers — whether the
    repo has its own value for it or not.

    Timestamp rather than a fixed preference, because neither side is reliably the authority.
    Tuning happens in the browser and in the packaged build, often in the same evening, and
    "which is newer" is the only thing that consistently answers which number the person
    actually meant. A fixed rule got this wrong the first time it mattered: it kept a browser
    value from before a play session that had deliberately changed it.

    AN ABSENT KEY IS NOT AN ABSENT OPINION. This used to take any key the repo lacked, on the
    reasoning that nothing was there to lose. That reasoning fails against the actual workflow:
    baking EMPTIES the store it consumed (tools/bake-tuning.py), so a freshly baked repo store is
    `{}` and every key the exe holds looks new. The timestamp rule then guarded nothing, in
    exactly the situation it exists for — `pull` immediately after `bake` is the normal command
    pair, so the rule was disabled by the workflow it belongs to. A stale exe value would be
    folded in as a plain addition, with no CONFLICT line to notice it by, and the next bake wrote
    it over the value the store had been emptied of.

    So a key missing from a NEWER repo store is treated as superseded by the bake that emptied
    it: reported, not taken. That can also catch genuine un-pulled exe work whose file happens to
    predate an unrelated browser bake — which is why it is reported loudly rather than dropped
    quietly. Surfacing a decision is the right failure direction; silently reverting a number
    someone deliberately set is not.
    """
    out = dict(repo)
    for k, b in exe.items():
        a = repo.get(k)
        # Recurse whenever the EXE side is a dict, including when the repo has no such subtree at
        # all (`a is None`). Descending only when both sides were dicts made a missing subtree an
        # opaque leaf: `enemies` would be taken or reported whole, so a stale value inside it was
        # never named. Every decision below is per-key, so it has to reach the keys.
        if isinstance(b, dict) and (a is None or isinstance(a, dict)):
            sub = merge(a or {}, b, conflicts, superseded, exe_newer, f'{prefix}{k}.')
            # Nothing survived and the repo had no such branch: leave it absent rather than
            # writing an empty object the store would carry around forever.
            if sub or k in repo:
                out[k] = sub
        elif k not in repo:
            if exe_newer:
                out[k] = b
            else:
                superseded.append(f'{prefix}{k}: {b}')
        elif a != b:
            if exe_newer:
                out[k] = b
                conflicts.append(f'{prefix}{k}: {a} -> {b}  (exe, newer)')
            else:
                conflicts.append(f'{prefix}{k}: {a} kept, exe had {b}  (repo, newer)')
    return out


apply = '--apply' in sys.argv[1:]
found = any_changes = False

for label, src, dest in PAIRS:
    exe = load(src)
    if exe is None:
        print(f'{label}: nothing saved by a packaged build ({src.name})')
        continue
    found = True
    repo = load(dest) or {}
    stamp = datetime.datetime.fromtimestamp(src.stat().st_mtime).strftime('%Y-%m-%d %H:%M')
    rstamp = (datetime.datetime.fromtimestamp(dest.stat().st_mtime).strftime('%Y-%m-%d %H:%M')
              if dest.exists() else 'missing')
    exe_newer = (not dest.exists()) or src.stat().st_mtime >= dest.stat().st_mtime
    print(f'\n{label}: exe saved {stamp} | repo saved {rstamp}'
          f'  --> {"exe" if exe_newer else "repo"} is newer')
    if not diff(repo, exe):
        print('  identical -- nothing to pull')
        continue
    if not exe_newer:
        # Said before --apply, not only after it: the whole point is that these look like
        # ordinary additions in the diff above and are the ones that quietly revert a bake.
        print('  ^ the repo store was saved LAST. Keys it does not list were emptied by a bake,')
        print('    so they are already in the source -- they will be reported, not pulled.')
    any_changes = True
    if not apply:
        continue
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        # The repo file is the only record of the previous values once this is rewritten.
        backup = dest.with_suffix('.json.bak')
        shutil.copy2(dest, backup)
        print(f'  previous values kept at {backup}')
    conflicts, superseded = [], []
    out = merge(repo, exe, conflicts, superseded, exe_newer)
    dest.write_text(json.dumps(out, indent=2), encoding='utf-8')
    print(f'  wrote {dest}')
    for c in conflicts:
        print(f'  CONFLICT {c}')
    if conflicts:
        who = 'the exe' if exe_newer else 'the repo'
        print(f'  ^ both sides had these. {who} was saved more recently, so it won.')
        print('    Edit the file by hand if the other side was right.')
    for s in superseded:
        print(f'  SUPERSEDED {s}')
    if superseded:
        print('  ^ the exe holds these, the newer repo store does not. Baking empties the store,')
        print('    so the source almost certainly already has them and the exe copy is stale.')
        print('    NOT pulled. If any is real balance work done in the exe and never pulled,')
        print(f'    add it to {dest} by hand before baking.')

if not found:
    print('\nNothing to pull. Either the exe was never tuned, or the Save predates the build')
    print('that added the writers (0.5.8).')
elif any_changes and not apply:
    print('\nRe-run with --apply to copy these into tuning/.')
elif any_changes:
    print('\n`npm run dist:portable` will bake them.')
