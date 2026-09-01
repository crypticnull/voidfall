"""Regenerate assets/music/manifest.json from whatever is sitting in the music folders.

Why this exists: the game discovers tracks by reading the directory listing the dev server
produces, so during development dropping a .wav into a stage folder is genuinely all you have
to do. The packaged .exe has no such listing -- it loads from file://, where a directory is
not fetchable -- so it reads this manifest instead. Run this before building, and the two
paths agree.

Subfolders are never descended into, by this script or by the runtime scanner. That is the one
rule both implement, and it is what makes the archive layout work:

    stage-2/Sun Dance.ogg          live
    stage-2/_ARCHIVE/X.ogg         benched — pulled from rotation, moved back up to restore
    stage-2/_ARCHIVE/_WAV/*.wav    uncompressed masters of the LIVE tracks

_ARCHIVE therefore reads as "what is currently benched" rather than as a bin of masters. See
assets/music/README.txt.

Usage:
    python tools/scan-music.py
"""
import json, pathlib

MUSIC = pathlib.Path('assets/music')
AUDIO_EXT = {'.wav', '.mp3', '.ogg', '.m4a', '.flac'}
ARCHIVE = '_ARCHIVE'

# Folder on disk -> track id used by playMusic(). Mirrors MUSIC_FOLDERS in src/audio.js; keep
# STAGE_SLOTS in step with MUSIC_STAGE_SLOTS there. Slots past the stages the game actually
# ships are intentional -- an empty folder yields an empty playlist, which the runtime treats
# as "leave the current music playing", so scaffolding ahead of the content is free.
STAGE_SLOTS = 10
FOLDERS = {'mainMenu': 'main-title', 'shop': 'shop'}
FOLDERS.update({f'stage{i}': f'stage-{i}' for i in range(1, STAGE_SLOTS + 1)})


def scan(folder):
    d = MUSIC / folder
    if not d.is_dir():
        return []
    out = []
    for f in sorted(d.iterdir()):
        if f.is_dir():
            continue  # _ARCHIVE and any other nesting is deliberately not descended into
        if f.suffix.lower() not in AUDIO_EXT:
            continue
        out.append({'src': f'assets/music/{folder}/{f.name}', 'name': f.stem})
    return prefer_compressed(out)


# Preference order when one track exists in several formats. Lowest wins.
_EXT_RANK = {'.ogg': 0, '.m4a': 1, '.mp3': 2, '.flac': 3, '.wav': 4}


def prefer_compressed(tracks):
    """Collapse same-named tracks to one entry, keeping the most compressed format.

    A .wav sitting beside its own .ogg is the normal transient state of converting a new track,
    and it is also what you are left with when the master cannot be archived because something
    else has the file open. Without this the scanner lists the track twice -- the menu plays the
    same song as two different entries -- and the packaged build carries the uncompressed master.
    """
    best = {}
    for t in tracks:
        ext = pathlib.Path(t['src']).suffix.lower()
        cur = best.get(t['name'])
        if cur is None or _EXT_RANK.get(ext, 9) < _EXT_RANK.get(pathlib.Path(cur['src']).suffix.lower(), 9):
            best[t['name']] = t
    return [best[k] for k in sorted(best)]


def main():
    manifest = {tid: scan(folder) for tid, folder in FOLDERS.items()}
    path = MUSIC / 'manifest.json'
    path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

    total, empty = 0, []
    for tid, tracks in manifest.items():
        total += len(tracks)
        if not tracks:
            # Expected for scaffolded slots with no content yet -- summarised, not listed one
            # per line, so a real problem in a populated stage is not buried in the noise.
            empty.append(tid)
            continue
        shuffles = ' (shuffles)' if len(tracks) > 1 else ' (loops)'
        print(f'  {tid:9s} {len(tracks)} track(s){shuffles}')
        for t in tracks:
            print(f'            - {t["name"]}')
    if empty:
        print(f'  empty slots: {", ".join(empty)}')
    print(f'wrote {path}  ({total} tracks)')


if __name__ == '__main__':
    main()
