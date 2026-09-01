"""Guards the merge rule in pull-exe-tuning.py. Run by tools/smoke.mjs, exit 1 on failure.

This exists because the rule "the more recently saved file wins" was written down, believed, and
then quietly not applied to half the cases. The timestamp check only arbitrated keys BOTH stores
held. A key the repo store lacked was taken outright -- and because baking EMPTIES the store it
consumed, a freshly baked store is `{}`, so every key the exe holds looks new and the timestamp
rule guarded nothing at all. `pull` right after `bake` is the normal command pair, so the rule
was disabled by the exact workflow it belongs to.

The symptom is the worst kind: a stale exe value folds in as an ordinary addition, with no
CONFLICT line to notice it by, and the next bake writes it over the number the store had just
been emptied of. It reverted `enemies.global.hpMult` from a deliberate 2 back to 1.8.

So the shape of the thing is pinned here rather than in prose. Case 1 is that exact failure.
"""
import contextlib
import importlib.util
import io
import sys

spec = importlib.util.spec_from_file_location('pull', 'tools/pull-exe-tuning.py')
pull = importlib.util.module_from_spec(spec)
sys.argv = ['pull']                      # no --apply, so the module body is a no-op
with contextlib.redirect_stdout(io.StringIO()):
    spec.loader.exec_module(pull)

fails = []


def run(repo, exe, exe_newer):
    conflicts, superseded = [], []
    return pull.merge(repo, exe, conflicts, superseded, exe_newer), conflicts, superseded


def check(name, got, want):
    if got != want:
        fails.append(f'{name}\n      got  {got}\n      want {want}')


# 1. THE ORIGINAL FAILURE: the store was emptied by a bake, the exe still holds the old value.
out, _, sup = run({}, {'enemies': {'global': {'hpMult': 1.8}}}, exe_newer=False)
check('stale exe value is not pulled into a baked-empty store', out, {})
check('superseded value is named down to the leaf', sup, ['enemies.global.hpMult: 1.8'])

# 2. The same shape when the exe really is the newer side: genuine un-pulled balance work.
out, _, sup = run({}, {'enemies': {'global': {'hpMult': 1.8}}}, exe_newer=True)
check('newer exe value is pulled', out, {'enemies': {'global': {'hpMult': 1.8}}})
check('a newer exe addition is not reported as superseded', sup, [])

# 3. A subtree where one leaf is contested and one is new. Both decisions are per-leaf, which is
#    why merge has to descend into a subtree the repo lacks entirely rather than treat it as one
#    opaque value -- the first cut of this fix got that wrong and this case caught it.
out, con, sup = run({'e': {'g': {'hp': 2}}}, {'e': {'g': {'hp': 1.8, 'dmg': 0.85}}}, exe_newer=False)
check('mixed subtree keeps the repo value', out, {'e': {'g': {'hp': 2}}})
check('mixed subtree names the conflict', con, ['e.g.hp: 2 kept, exe had 1.8  (repo, newer)'])
check('mixed subtree names the untaken addition', sup, ['e.g.dmg: 0.85'])

# 4. Contested keys: unchanged behaviour, both directions.
both = ({'g': {'x': 1}}, {'g': {'x': 2}})
out, con, _ = run(*both, exe_newer=False)
check('conflict with repo newer keeps repo',
      (out, con), ({'g': {'x': 1}}, ['g.x: 1 kept, exe had 2  (repo, newer)']))
out, con, _ = run(*both, exe_newer=True)
check('conflict with exe newer takes exe',
      (out, con), ({'g': {'x': 2}}, ['g.x: 1 -> 2  (exe, newer)']))

# 5. The older guarantee, still standing: a pull folds INTO the repo file and never replaces it,
#    so browser-side tuning survives a pull from the exe.
out, _, _ = run({'fireball': {'life': 1.7}}, {'icebomb': {'cooldown': 2.4}}, exe_newer=True)
check('browser keys survive a pull',
      out, {'fireball': {'life': 1.7}, 'icebomb': {'cooldown': 2.4}})

# 6. A subtree whose every leaf was superseded leaves no empty husk in the store.
out, _, _ = run({}, {'void': {'global': {'chanceEndless': 15}}}, exe_newer=False)
check('no empty subtree is written', out, {})

for f in fails:
    print(f'    {f}')
print(f'  pull-merge: {"6 groups passed" if not fails else str(len(fails)) + " FAILED"}')
sys.exit(1 if fails else 0)
