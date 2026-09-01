# Reference snapshots

Frozen copies of the codebase at points worth being able to look back at. **Nothing here is
loaded, imported, or built** — the `files` list in package.json does not include `_reference`,
so none of it ships in the exe.

## Why these exist

Two uses:

1. **Refactor safety net.** If a restructure goes wrong, the previous shape is here to diff
   against rather than reconstruct from memory.
2. **Rewrite reference.** If the game is ever rebuilt on a different renderer or engine, the
   gameplay rules — skill formulas, the difficulty curve, enemy stats, the sandbox — are all
   readable here without having to untangle whatever the live code has grown into by then.

## Snapshots

### v0.4.1_pre_refactor
Taken immediately before `main.js` (4,667 lines) was split into modules and type checking was
added. This is the last version where the whole game loop lives in one file. Useful as the
"here is the entire thing in one place" reference, which is genuinely easier to read end to
end than a well-factored version — just not to maintain.
