DUSKFALL SURVIVORS — music folders
==================================

Drop an audio file into a stage folder and it is in the game. There is no list of tracks in
the code to update.

  main-title/     plays on the main menu
  stage-1/ .. stage-10/   plays during that stage

Accepted formats: .wav .mp3 .ogg .m4a .flac

How a folder behaves
--------------------
  0 files   stage has no music; whatever is already playing keeps playing (no cut to silence)
  1 file    loops seamlessly
  2+ files  shuffles — a random track each time, never the same one twice in a row

Folder layout
-------------
    stage-2/
      Sun Dance.ogg              <- LIVE. In the shuffle, listed in the music player.
      _ARCHIVE/
        Laughing Dead.ogg        <- BENCHED. Pulled from circulation, ready to come back.
        _WAV/
          Sun Dance.wav          <- MASTER. The uncompressed source, kept forever.

_ARCHIVE is for tracks you have taken OUT of rotation and may want back. Drop the .ogg in and
it stops playing; move it back up one level and it returns. Nothing else to change either way.

_ARCHIVE/_WAV is a different thing: the uncompressed masters of tracks that ARE live. They live
there so a full folder listing reads as "what is benched" rather than being buried under twenty
wavs. Never delete them — the .ogg in the stage folder is a lossy render of these.

Neither scanner descends into subfolders at all, so anything under _ARCHIVE is invisible to the
game no matter how deeply it is nested.

Adding a track
--------------
Drop the .wav into the stage folder, then:

    ffmpeg -hide_banner -loglevel error -y -i "stage-2/Sun Dance.wav" \
      -c:a libvorbis -q:a 5 "stage-2/Sun Dance.ogg"

then move the .wav to that folder's _ARCHIVE/_WAV/ and rescan. A raw wav is ~30 MB against ~3 MB
converted; leaving one live in a stage folder does play, but it bloats the build badly.

Stages 4–10 are scaffolding
---------------------------
Those folders exist ahead of the stages themselves. They are empty and harmless; the day the
stage ships, its music is already wired.

Before building the .exe
------------------------
    python tools/scan-music.py

The dev server can list a directory, so during development new files appear on the next reload.
The packaged .exe loads from file:// where directories cannot be listed, so it reads
manifest.json instead. That command regenerates the manifest. Skipping it means the .exe plays
the old set — the browser will look right while the build does not.
