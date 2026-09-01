# Character sprite art

Drop hand-drawn PNGs here to replace the procedural (code-drawn) characters.
If a file is absent or fails to decode, the game silently keeps the procedural
fallback — so it is always safe to add these one at a time.

## Files currently wired up

| File                 | View                                    |
|----------------------|-----------------------------------------|
| `warrior_right.png`  | Side view, **facing right**             |
| `warrior_front.png`  | Facing the viewer (moving down-screen)  |
| `warrior_back.png`   | Facing away (moving up-screen)          |

The engine mirrors `_right` automatically for leftward movement. It never
mirrors the front or back views — those are drawn facing the camera already.

## Specification

- **Height: 64 px.** Characters render at exactly 64 px tall, so a 64 px-tall
  source maps 1:1 to screen pixels with no resampling.
- **Width: free.** The aspect ratio is read from the PNG itself. ~48 px is a
  natural match for the current builds, but wider or narrower is fine — the
  engine scales on height alone and lets width follow.
- **Frame count is set by `imageFrames` in `src/sprites.js`** — currently `1`
  for the warrior. For a 2-frame walk cycle, lay the frames out left-to-right on
  one row (a 2-frame sheet at 48 px wide is **96 × 64**), both frames the same
  width, and set `imageFrames: 2`. If the sheet width doesn't divide evenly by
  the declared count, the loader logs a warning and falls back to one frame
  rather than rendering a sliced-up character.
- **Transparent RGBA PNG, no anti-aliasing.** Use hard alpha edges — soft edges
  fringe badly against the dark stage backgrounds.
- **Centre the character in the frame**, and keep the same footing line across
  both frames. The sprite is centred on the entity position on both axes, so a
  shifted baseline between frames reads as an unintended bob.
- The walk cycle plays at `frameDuration: 260` ms per frame for the warrior.

## Monster art sizes

Monsters are sized from their collision radius, so they don't all share one height the way
characters do. Drawing them at these source heights makes each land on a clean **2x** render
with no resampling:

| Source height | Renders at | Monsters                                                        |
|---------------|-----------|------------------------------------------------------------------|
| 24 px         | 48 px     | Swarm Bat, Jackal, Scarab, Wailing Ghost                          |
| 32 px         | 64 px     | Bone Archer, Hollow Wraith, Vulture, Mummy, Veined Eye, Flame Skull |
| 40 px         | 80 px     | Shambler, Acid Slime, Hollow Zombie, Pit Demon                    |
| 64 px         | 128 px    | Rockhide Ogre, Sand Golem, Giant Worm, Minotaur                   |
| 80 px         | 160 px    | Stone Golem                                                       |

Widths are free, as with characters — only height matters.

**Snapping is automatic and applies only to image-backed sprites.** Once a monster has a PNG,
the engine rounds its scale to a whole number so every source pixel becomes an exact NxN
block. Procedural (code-drawn) monsters keep smooth scaling, because snapping those would
visibly change how big each one is on screen. So art drawn to the table above renders
pixel-perfect, and anything off-spec still works — it just snaps to the nearest whole
multiple, which may make it slightly larger or smaller than the table suggests.

## Adding another character

In `src/sprites.js`, add to that character's entry:

```js
images: {
  side:  'assets/sprites/<name>_right.png',
  front: 'assets/sprites/<name>_front.png',
  back:  'assets/sprites/<name>_back.png',
},
imageFrames: 2,
```

`front` and `back` are optional — omit either and that facing falls back to the
side view.
