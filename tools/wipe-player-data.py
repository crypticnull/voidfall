"""Guarantee that the next build starts with no player data — and prove it.

WHY THIS EXISTS
    "Wipe my player data" was done by hand several times and silently failed several times. The
    failure is always the same shape: player data lives in more than one place, someone clears
    the place they thought of, checks THAT place, finds it empty and reports success. The place
    they forgot still has the data.

    There are three places, and they behave differently:
      1. the dev server's browser localStorage  — per origin, only reachable from the page
      2. the packaged exe's own localStorage    — a leveldb blob under %APPDATA%, and it does
                                                  NOT EXIST until the exe has been run once,
                                                  so "the folder isn't there" proves nothing
      3. any build already on disk              — clearing a store today does nothing about the
                                                  save an older exe writes again tomorrow

    So this tool does not rely on deleting things. It bumps SAVE_RESET_TOKEN in
    src/save-reset.js, which every save is stamped with and checked against at load. A build
    carrying a new token discards any save written under an older one, on first launch, in every
    environment, on any machine. Deleting the local stores as well is belt and braces for the
    build you already have open.

USAGE
    npm run wipe-saves          bump the token, clear local stores, verify
    npm run wipe-saves -- --check   report only, change nothing

    Then build. The next exe starts clean by construction, not by inspection.
"""
import json, os, pathlib, re, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOKEN_FILE = ROOT / 'src' / 'save-reset.js'
TOKEN_RE = re.compile(r'^export const SAVE_RESET_TOKEN = (\d+);', re.M)

# Both app-name folders: the Duskfall -> Voidfall rename moved userData, and an old build still
# writes to the old one.
APP_DIRS = ['voidfall-survivors', 'duskfall-survivors']


def token_now():
    m = TOKEN_RE.search(TOKEN_FILE.read_text(encoding='utf-8'))
    if not m:
        raise SystemExit(f'!! {TOKEN_FILE}: SAVE_RESET_TOKEN not found — has it been renamed?')
    return int(m.group(1))


def bump_token():
    src = TOKEN_FILE.read_text(encoding='utf-8')
    cur = token_now()
    out = TOKEN_RE.sub(f'export const SAVE_RESET_TOKEN = {cur + 1};', src, count=1)
    TOKEN_FILE.write_text(out, encoding='utf-8')
    return cur, cur + 1


def store_dirs():
    """Every on-disk localStorage the game could have written, whether or not it exists."""
    appdata = os.environ.get('APPDATA')
    if not appdata:
        return []
    out = []
    for name in APP_DIRS:
        base = pathlib.Path(appdata) / name
        out.append(base / 'Local Storage')
        out.append(base / 'Session Storage')
    return out


def main():
    check_only = '--check' in sys.argv

    print('player-data stores on this machine:')
    present = []
    for d in store_dirs():
        exists = d.exists()
        size = sum(f.stat().st_size for f in d.rglob('*') if f.is_file()) if exists else 0
        # "absent" is reported explicitly, because an absent store is exactly what fooled the
        # last several wipes into declaring success.
        print(f'  {"PRESENT" if exists else "absent "}  {d}' + (f'  ({size} bytes)' if exists else ''))
        if exists:
            present.append(d)

    if check_only:
        print(f'\ntoken: {token_now()}  (--check: nothing changed)')
        return

    for d in present:
        shutil.rmtree(d, ignore_errors=True)

    # VERIFY the deletion rather than assuming it. A store held open by a running exe will
    # survive rmtree, and that has to be an error, not a shrug.
    still = [d for d in present if d.exists()]
    if still:
        print('\n!! these stores could not be removed — is the game still running?')
        for d in still:
            print(f'   {d}')
        raise SystemExit(1)

    old, new = bump_token()
    print(f'\nSAVE_RESET_TOKEN {old} -> {new}')
    print(f'  cleared {len(present)} on-disk store(s)')
    print('  every save written under an older token is now discarded at load,')
    print('  in the browser and in any build made from here on.')
    print('\nBuild now: the next exe starts with no player data by construction.')


if __name__ == '__main__':
    main()
