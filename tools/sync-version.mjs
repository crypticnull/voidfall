// Rewrites BUILD_VERSION in src/version.js from package.json's "version".
//
// These were two hand-kept copies of one number and they drifted exactly the way two hand-kept
// copies of one number always do: 0.6.2 and 0.6.3 both shipped with a title screen reading
// "Alpha 0.6.1", because bumping package.json renames the exe and nothing complains when the
// label beside it stays put. A build you cannot identify from inside the game is worse than no
// label at all — it makes every bug report ambiguous.
//
// package.json is the source of truth because it is the one the tooling already reads: it names
// the exe, and electron-builder will not run without it. src/version.js stays a plain ES module
// with a literal in it rather than importing the manifest, because the browser loads these files
// straight from disk with no bundler and no JSON import to lean on.
//
// Runs as part of `npm run dist:portable`, so a release cannot be cut with a stale label.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const pkgPath = new URL('package.json', root);
const verPath = new URL('src/version.js', root);

const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`  version "${version}" in package.json is not semver — refusing to write it`);
  process.exit(1);
}

const src = readFileSync(verPath, 'utf8');
const re = /^(export const BUILD_VERSION = ')([^']*)(';)$/m;
const found = src.match(re);
// Loud rather than silent: if the declaration is ever renamed or reformatted, a regex that
// quietly matches nothing would leave the label frozen again with no sign anything went wrong.
if (!found) {
  console.error('  could not find `export const BUILD_VERSION = \'…\';` in src/version.js');
  process.exit(1);
}

if (found[2] === version) {
  console.log(`  version in sync (${version})`);
} else {
  writeFileSync(verPath, src.replace(re, `$1${version}$3`));
  console.log(`  version ${found[2]} -> ${version} in src/version.js`);
}
