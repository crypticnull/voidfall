"""Dev server for Voidfall Survivors.

Replaces `python -m http.server`. Two things it does that the stock one cannot:

  1. Accepts the skill tuning the game posts when you press Save in Dev Tools, and writes it
     into the REPO at tuning/skill-tuning.json. That file is what the build bakes into
     src/skills.js, so tuning done in the browser reaches a shipped release without anyone
     hand-copying a blob out of localStorage.

  2. Sends no-cache headers. The stock server does not, so an edited module keeps being served
     from the browser's memory cache and a change silently appears not to have taken.

Usage:
    python tools/dev-server.py [port]      # default 8791
"""
import base64
import hashlib
import json
import pathlib
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
TUNING_FILE = ROOT / 'tuning' / 'skill-tuning.json'
# Player and enemy base stats. A second file rather than a second section of the first, because
# the two bake into different source files and a bad write to one should not cost the other.
ENTITY_FILE = ROOT / 'tuning' / 'entity-tuning.json'
TITLE_PNG = ROOT / 'assets' / 'ui' / 'title-lockup.png'
TITLE_META = ROOT / 'assets' / 'ui' / 'title-lockup.json'
MAX_BODY = 256 * 1024   # a tuning blob is a few KB; anything near this is not one
MAX_PNG = 4 * 1024 * 1024


def title_source_hash():
    """Fingerprint of the code that DRAWS the lockup.

    Baking the title to a PNG means the drawing code stops running, so an edit to it would
    otherwise change nothing on screen and be silently lost. This hash is stored beside the
    PNG; tools/smoke.mjs recomputes it and fails the build when the two drift, which is the
    link between "the lockup changed" and "the image must be regenerated".
    """
    src = (ROOT / 'src' / 'main.js').read_text(encoding='utf-8')
    m = re.search(r'^function renderTitleArt\(.*?^\}', src, re.S | re.M)
    if not m:
        return None
    return hashlib.sha1(m.group(0).encode('utf-8')).hexdigest()


def src_token():
    """Newest mtime across src/, as an int. One token for the whole tree rather than per file:
    a module graph is only as fresh as its stalest node, and a shared token means one edit
    anywhere re-fetches all of it."""
    newest = 0
    for p in (ROOT / 'src').rglob('*.js'):
        try:
            newest = max(newest, int(p.stat().st_mtime * 1000))
        except OSError:
            pass
    return newest


# Relative specifiers only. A bare or absolute one is not ours to rewrite.
_IMPORT_RE = re.compile(r"""(\bfrom\s+|\bimport\s*\(?\s*)(['"])(\.{1,2}/[^'"?]+\.js)\2""")


def rewrite_imports(text, token):
    return _IMPORT_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}?v={token}{m.group(2)}", text)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_GET(self):
        # ---- ES module cache busting ----
        # `Cache-Control: no-store` is not enough. It governs the HTTP cache, but a module graph
        # is keyed by URL in the *module registry*: once main.js has resolved './supports.js',
        # that record is reused for the life of the page, and a plain reload in an embedded
        # browser will happily hand back the old evaluation. The symptom is the worst kind —
        # everything looks like it worked, the panel renders, and the numbers are from a build
        # that no longer exists on disk. It has produced a false "verified" twice.
        #
        # So relative specifiers inside src/*.js get a ?v=<newest-src-mtime> stamped on them as
        # they are served. Change any source file and every specifier in the graph changes with
        # it, so the whole graph is a cache miss and re-evaluates together. Costs a re-parse per
        # reload, which is nothing next to debugging a phantom.
        path = self.path.split('?')[0]
        # The tuning store, read back. Same two routes the game POSTs to, so the browser and the
        # exe share one mechanism and one store apiece — no localStorage authority sitting in
        # front of a file that only ever gets written.
        if path in ('/tuning', '/entity-tuning'):
            dest = TUNING_FILE if path == '/tuning' else ENTITY_FILE
            try:
                body = dest.read_bytes()
            except OSError:
                body = b'{}'          # never saved yet
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith('/src/') and path.endswith('.js'):
            f = ROOT / path.lstrip('/')
            if f.is_file():
                body = rewrite_imports(f.read_text(encoding='utf-8'), src_token()).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/javascript; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
        super().do_GET()

    def end_headers(self):
        # Every response is uncacheable. This is a dev server; correctness beats a warm cache,
        # and a stale module is far more expensive to debug than a re-fetch is to serve.
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def do_POST(self):
        route = self.path.split('?')[0]
        if route == '/bake-title':
            self.bake_title()
            return
        if route not in ('/tuning', '/entity-tuning'):
            self.send_error(404)
            return
        dest = TUNING_FILE if route == '/tuning' else ENTITY_FILE
        try:
            length = int(self.headers.get('Content-Length') or 0)
            if not 0 < length <= MAX_BODY:
                raise ValueError(f'body length {length} out of range')
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
            if not isinstance(payload, dict):
                raise ValueError('expected an object of {skillId: {param: value}}')
            # Written whole rather than merged: the game always posts its complete tuning
            # state, so the newest post is the truth. Merging would resurrect a skill the
            # player had just Reset.
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
        except Exception as err:                       # noqa: BLE001 - report, never crash
            self.send_error(400, str(err))
            return
        body = json.dumps({'ok': True, 'skills': sorted(payload)}).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        print(f'  tuning saved -> {dest.relative_to(ROOT)}  ({", ".join(sorted(payload)) or "empty"})')

    def bake_title(self):
        """Store the rendered title lockup as a PNG, with the source hash that produced it."""
        try:
            length = int(self.headers.get('Content-Length') or 0)
            if not 0 < length <= MAX_PNG:
                raise ValueError(f'body length {length} out of range')
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
            data = payload.get('png', '')
            if not data.startswith('data:image/png;base64,'):
                raise ValueError('expected a data:image/png;base64 payload')
            raw = base64.b64decode(data.split(',', 1)[1])
            if raw[:8] != b'\x89PNG\r\n\x1a\n':
                raise ValueError('decoded payload is not a PNG')
            TITLE_PNG.parent.mkdir(parents=True, exist_ok=True)
            TITLE_PNG.write_bytes(raw)
            TITLE_META.write_text(json.dumps({
                'sourceHash': title_source_hash(),
                'width': payload.get('width'),
                'height': payload.get('height'),
            }, indent=2) + '\n', encoding='utf-8')
        except Exception as err:                       # noqa: BLE001
            self.send_error(400, str(err))
            return
        body = json.dumps({'ok': True, 'bytes': len(raw)}).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        print(f'  title lockup baked -> {TITLE_PNG.relative_to(ROOT)}  ({len(raw)} bytes)')

    def log_message(self, fmt, *args):
        # Quiet: one line per request drowns the tuning messages that actually matter.
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
    print(f'Voidfall dev server  http://127.0.0.1:{port}/index.html')
    print(f'  serving  {ROOT}')
    print(f'  tuning   POST /tuning -> {TUNING_FILE.relative_to(ROOT)}')
    print(f'           POST /entity-tuning -> {ENTITY_FILE.relative_to(ROOT)}')
    print(f'  title    POST /bake-title -> {TITLE_PNG.relative_to(ROOT)}')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()


if __name__ == '__main__':
    main()
