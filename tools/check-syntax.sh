#!/usr/bin/env bash
# Syntax gate for this project's ES modules.
#
# `node --check file.js` is NOT reliable here: for a .js file containing `import`, node fails
# the CommonJS parse, notices module syntax, and then exits 0 without reporting the real
# error. Copying to .mjs forces a genuine module parse, which does report it.
set -u
fail=0
tmp="${TMPDIR:-/tmp}/dsyntax.$$"
mkdir -p "$tmp"
for f in "$@"; do
  cp "$f" "$tmp/$(basename "${f%.js}").mjs"
  if ! node --check "$tmp/$(basename "${f%.js}").mjs" 2>"$tmp/err"; then
    echo "FAIL  $f"; sed -n '1,6p' "$tmp/err"; fail=1
  else
    echo "ok    $f"
  fi
done
rm -rf "$tmp"
exit $fail
