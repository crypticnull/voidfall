"""Write saved dev-tools tunings into src/skills.js as the shipped defaults.

Save in Dev Tools persists to localStorage, which survives reloads but is still per-browser
and per-origin: clearing site data, using a different browser, or the packaged .exe (which
runs on its own origin) will not see it. Baking makes the values part of the code, so they
ship with the build and cannot be lost.

Usage:
    python tools/bake-tuning.py                  # bake tuning/skill-tuning.json
    python tools/bake-tuning.py --if-present     # ...or do nothing if it does not exist
    python tools/bake-tuning.py some-other.json  # bake an explicit file

tuning/skill-tuning.json is written by tools/dev-server.py whenever the game posts its tuning
(every Save, and every autosave). `npm run dist:portable` bakes before it builds, so values
tuned in the browser cannot be left out of a release by anyone forgetting a step.

Only keys that already exist in a skill's tune block are written, so a stale save from an
older build cannot introduce parameters a skill no longer has.
"""
import json, re, shutil, sys, time, pathlib

SKILLS = pathlib.Path('src/skills.js')
ROOT_TUNING = pathlib.Path('tuning')
# Player and enemy overrides are written into a GENERATED block rather than into the authored
# literals. Those literals are scaled by global multipliers at module load, so a value baked
# over them would be multiplied a second time on the next run; the generated block is applied
# after the multipliers, where a tuned number means exactly what it says.
# 'per-entity' writes one line per class; 'flat' writes one line per key, because the enemy
# side is four global multipliers rather than a roster.
# domain -> (file, generated block name, shape, pseudo-entity key for 'flat' domains)
#
# A 'flat' domain keeps all its numbers under one pseudo-entity id chosen by the dev panel, so
# the bake has to know that id to find them. It used to guess, by trying a chain of known names
# in turn — which silently baked NOTHING for any domain added later whose id was not on the
# list. Four of them (gold, potions, sample playback, the gold curves) were lost that way. The
# key is declared here now, so a new domain either states its id or fails loudly below.
ENTITY_TARGETS = {
    'classes': (pathlib.Path('src/classes.js'), 'CLASS_TUNE', 'per-entity', None),
    'enemies': (pathlib.Path('src/enemies.js'), 'ENEMY_GLOBAL_TUNE', 'flat', 'global'),
    'curve': (pathlib.Path('src/difficulty.js'), 'CURVE_TUNE', 'per-entity', None),
    'player': (pathlib.Path('src/classes.js'), 'PLAYER_GLOBAL_TUNE', 'flat', 'global'),
    'dash': (pathlib.Path('src/classes.js'), 'DASH_TUNE', 'flat', 'dodge'),
    'rarity': (pathlib.Path('src/loot.js'), 'RARITY_CURVE_TUNE', 'flat', 'affixes'),
    'drops': (pathlib.Path('src/loot.js'), 'CHEST_WEIGHT_TUNE', 'flat', 'weights'),
    'rates': (pathlib.Path('src/loot.js'), 'LOOT_RATE_TUNE', 'flat', 'perKill'),
    'relics': (pathlib.Path('src/relics.js'), 'RELIC_TUNE_OVERRIDE', 'flat', 'global'),
    'elites': (pathlib.Path('src/elites.js'), 'ELITE_TUNE_OVERRIDE', 'flat', 'global'),
    'void': (pathlib.Path('src/void.js'), 'VOID_TUNE_OVERRIDE', 'flat', 'global'),
    'terrain': (pathlib.Path('src/terrain.js'), 'TERRAIN_TUNE_OVERRIDE', 'flat', 'global'),
    'terraincolors': (pathlib.Path('src/terrain.js'), 'TERRAIN_COLOR_TUNE', 'per-entity', None),
    'graphics': (pathlib.Path('src/graphics.js'), 'GRAPHICS_TUNE_OVERRIDE', 'flat', 'global'),
    'gold': (pathlib.Path('src/loot.js'), 'GOLD_RATE_TUNE', 'flat', 'gold'),
    'potions': (pathlib.Path('src/loot.js'), 'POTION_RATE_TUNE', 'flat', 'potion'),
    'goldcurve': (pathlib.Path('src/loot.js'), 'GOLD_CURVE_TUNE', 'per-entity', None),
    'samples': (pathlib.Path('src/audio-samples.js'), 'SAMPLE_TUNE', 'per-entity', None),
    'procfx': (pathlib.Path('src/audio-samples.js'), 'PROC_FX_TUNE', 'flat', 'bus'),
    'upgrades': (pathlib.Path('src/skills.js'), 'UPGRADE_ROLL_TUNE', 'flat', 'roll'),
    'skillroll': (pathlib.Path('src/skills.js'), 'SKILL_DAMAGE_TUNE', 'flat', 'damage'),
    'samplefx': (pathlib.Path('src/audio-samples.js'), 'SAMPLE_FX_TUNE', 'flat', 'bus'),
    'tomes': (pathlib.Path('src/supports.js'), 'TOME_CURVE_TUNE', 'per-entity', None),
    'tomemaster': (pathlib.Path('src/supports.js'), 'TOME_MASTER_TUNE', 'flat', 'all'),
}


def fmt(v):
    """Match the file's style: integers without a trailing .0."""
    return str(int(v)) if isinstance(v, (int, float)) and float(v).is_integer() else str(v)


def bake(saved):
    src = SKILLS.read_text(encoding='utf-8')
    changed, skipped = [], []

    for skill_id, values in saved.items():
        # Find this skill's tune block: `<id>: {` ... `tune: { ... },`
        m = re.search(rf'^  {re.escape(skill_id)}: \{{', src, re.M)
        if not m:
            skipped.append(f'{skill_id}: no such skill')
            continue
        tm = re.compile(r'tune: \{(.*?)\},\n', re.S).search(src, m.end())
        if not tm:
            skipped.append(f'{skill_id}: no tune block')
            continue

        body = tm.group(1)
        for key, val in values.items():
            # Only replace keys the block already declares — never add new ones.
            km = re.search(rf'(\b{re.escape(key)}: )([-\d.]+)', body)
            if not km:
                skipped.append(f'{skill_id}.{key}: not in tune block')
                continue
            if km.group(2) != fmt(val):
                changed.append(f'{skill_id}.{key}: {km.group(2)} -> {fmt(val)}')
            body = body[:km.start(2)] + fmt(val) + body[km.end(2):]

        src = src[:tm.start(1)] + body + src[tm.end(1):]

    SKILLS.write_text(src, encoding='utf-8')
    return changed, skipped


def parse_block(body, shape):
    """Read an existing generated block back into a dict, so a bake can add to it."""
    out = {}
    if shape == 'flat':
        for k, v in re.findall(r'^\s*(\w+):\s*([-\d.]+),', body, re.M):
            out[k] = float(v)
    else:
        for ent, inner in re.findall(r'^\s*(\w+):\s*\{([^}]*)\},', body, re.M):
            out[ent] = {k: float(v) for k, v in re.findall(r'(\w+):\s*([-\d.]+)', inner)}
    return out


def strip_meta(d):
    """Drop bookkeeping keys the GAME writes into its store but which are not tunable values.

    `__base` records the baked value an override was made against, so the game can tell a real
    preference from a leftover after a rebalance (see loadStoredEntityTunes). It rides along in
    the posted JSON and must never reach a generated block — it is a nested object, not a number,
    and baking it would emit garbage into the source.
    """
    return {k: v for k, v in (d or {}).items() if not k.startswith('__')}


def meta_keys(path, block_name):
    """Keys the module still exposes a dial for, read from its `*_TUNE_META` object.

    Derived from the generated block's own name — PROC_FX_TUNE -> PROC_FX_TUNE_META — so a
    domain declares its valid keys once, in the place a reader would look for them. Returns None
    when there is no meta to read, which means "do not prune" rather than "prune everything".
    """
    src = path.read_text(encoding='utf-8')
    m = re.search(rf'^export const {block_name}_META = \{{\n(.*?)^\}};', src, re.S | re.M)
    if not m:
        return None
    keys = set(re.findall(r'^\s*(\w+):', m.group(1), re.M))
    return keys or None


def bake_entities(saved):
    """Fold the saved overrides INTO the generated CLASS_TUNE / ENEMY_TUNE / CURVE_TUNE blocks.

    Merged, never replaced — and that distinction is load-bearing. The game posts its tuning as
    a diff against the values it STARTED with, so the moment a bake lands those values become
    the new baseline and the next post is empty. A bake that rewrote the block from the file
    would then erase everything the previous bake had just written: two builds in a row and the
    tuning is gone, silently, with the file that "caused" it looking perfectly innocent.

    Merging makes a bake idempotent and an empty file a no-op, which is how the skills bake has
    always behaved — it edits values inside a tune block and leaves unlisted ones alone.
    """
    changed = []
    for domain, (path, name, shape, flat_key) in ENTITY_TARGETS.items():
        over = saved.get(domain) or {}
        if shape == 'flat':
            # Named, not guessed. If the panel ever changes the id, this reports it rather than
            # quietly baking an empty block over real values.
            if over and flat_key not in over:
                changed.append(f'!! {domain}: expected values under "{flat_key}", '
                               f'found {sorted(over)} — nothing baked')
                continue
            over = strip_meta(over.get(flat_key))
        src = path.read_text(encoding='utf-8')
        m = re.search(rf'^export const {name} = \{{\n(.*?)^\}};\n', src, re.S | re.M)
        if not m:
            changed.append(f'!! {path}: no {name} block to write into')
            continue
        merged = parse_block(m.group(1), shape)
        if shape == 'flat':
            merged.update(over)
            # Prune keys the module no longer has a dial for. Merging is right (see above) but it
            # is one-way: a key baked under an old schema stays in the block forever, quietly
            # landing as a dead property on the live object. Renaming the level-up roll from five
            # weights to a two-dial curve left `common` and `rare` behind exactly this way.
            #
            # The valid set is read from the module's own *_TUNE_META, so it cannot go stale the
            # way a hand-kept list here would. If no meta is found the prune is skipped rather
            # than guessed at — an unrecognised block is not licence to delete from it.
            valid = meta_keys(path, name)
            if valid:
                dead = [k for k in merged if k not in valid]
                for k in dead:
                    del merged[k]
                    changed.append(f'  pruned {domain}.{k} (no longer a dial)')
        else:
            for ent, vals in over.items():
                merged.setdefault(ent, {}).update(strip_meta(vals))
        lines = []
        if shape == 'flat':
            for k in sorted(merged):
                lines.append(f'  {k}: {fmt(merged[k])},\n')
        else:
            for ent in sorted(merged):
                vals = merged[ent]
                if not vals:
                    continue
                inner = ', '.join(f'{k}: {fmt(v)}' for k, v in sorted(vals.items()))
                lines.append(f'  {ent}: {{ {inner} }},\n')
        body = ''.join(lines)
        if body == m.group(1):
            continue
        src = src[:m.start(1)] + body + src[m.end(1):]
        path.write_text(src, encoding='utf-8')
        n = len(lines)
        changed.append(f'{domain}: {n} entr{"y" if n == 1 else "ies"} -> {path}')
    return changed


DEFAULT_SOURCE = pathlib.Path('tuning/skill-tuning.json')
ENTITY_SOURCE = pathlib.Path('tuning/entity-tuning.json')


def main():
    # With no path, bake the file the dev server writes when you press Save in Dev Tools.
    # --if-present makes an absent file a no-op instead of an error, which is what lets this
    # sit in front of the build unconditionally: a machine that has never tuned anything still
    # builds, while a machine that HAS cannot ship without the values going in first.
    args = [a for a in sys.argv[1:] if a != '--if-present']
    optional = '--if-present' in sys.argv[1:]
    src = pathlib.Path(args[0]) if args else DEFAULT_SOURCE
    if not src.exists():
        if optional:
            print(f'  no {src} — nothing to bake')
            return
        raise SystemExit(str(src) + ' not found\n\n' + (__doc__ or ''))
    saved = json.loads(src.read_text(encoding='utf-8'))
    print(f'  baking from {src}')
    changed, skipped = bake(saved)
    for c in changed:
        print('  baked  ' + c)
    for s in skipped:
        print('  SKIP   ' + s)
    if not changed:
        print('  (nothing to change — code already matches the saved values)')

    # Player and enemy stats ride along on the same invocation, so the build cannot bake one
    # and forget the other.
    if ENTITY_SOURCE.exists():
        print(f'  baking from {ENTITY_SOURCE}')
        for line in bake_entities(json.loads(ENTITY_SOURCE.read_text(encoding='utf-8'))) or ['  (no change)']:
            print('  baked  ' + line if not line.startswith(' ') else line)
    else:
        print(f'  no {ENTITY_SOURCE} — no player/enemy tuning to bake')

    # ---- The store is emptied by the bake that consumed it ----
    # This is the whole point of baking: the values are now IN the source, so the store that
    # held them is redundant the instant this finishes. Leaving it behind is what let a stale
    # override outlive the rebalance that superseded it — for three builds running the tome
    # curves were baked correctly and then quietly re-reverted at load by the very file the
    # bake had just read.
    #
    # A backup goes beside them first. Emptying is safe by construction (the source is the
    # record now) but a one-command undo costs nothing and this data is hand-tuned.
    stamp = time.strftime('%Y%m%d-%H%M%S')
    backup = ROOT_TUNING / '_backup'
    backup.mkdir(parents=True, exist_ok=True)
    for f in (src, ENTITY_SOURCE):
        if not f.exists() or f.read_text(encoding='utf-8').strip() in ('', '{}'):
            continue
        shutil.copy(f, backup / f'{f.stem}.{stamp}.json')
        f.write_text('{}\n', encoding='utf-8')
        print(f'  cleared {f} (baked into source; backup in {backup.name}/)')


if __name__ == '__main__':
    main()
