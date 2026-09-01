// @ts-check
// ---------- WebGL2 sprite batcher ----------
// A drop-in replacement for the hot part of Canvas 2D rendering: drawing a great many textured
// quads. Canvas 2D issues one driver call per drawImage, so cost scales with SPRITE COUNT.
// This packs every quad into one vertex buffer and issues one draw call per texture, so cost
// scales with TEXTURE COUNT instead — which for this game is a few dozen no matter how many
// enemies are on screen.
//
// Deliberately narrow: quads only. Arcs, gradients, beams and text stay on Canvas 2D, which is
// good at them and is not where the time goes. See renderer-bench.mjs for the measurements
// this design is based on.
//
// Textures come from the existing sprite canvases, so the sprite system does not have to
// change — the same offscreen canvas that Canvas 2D blits is uploaded once and cached.

const VERT = `#version 300 es
in vec2 aPos;        // quad corner in pixels, already rotated on the CPU
in vec2 aUV;
in vec4 aTint;       // rgb multiply + alpha, per vertex so it can vary within a batch
out vec2 vUV;
out vec4 vTint;
uniform vec2 uResolution;
void main() {
  vUV = aUV;
  vTint = aTint;
  // Pixel space -> clip space, with Y flipped so +Y is down like Canvas 2D.
  vec2 clip = (aPos / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec4 vTint;
out vec4 fragColor;
uniform sampler2D uTex;
void main() {
  vec4 c = texture(uTex, vUV);
  if (c.a < 0.01) discard;   // keeps hard pixel-art edges from smearing into the background
  fragColor = vec4(c.rgb * vTint.rgb, c.a * vTint.a);
}`;

// Tint and alpha live in the VERTEX DATA rather than in uniforms. As uniforms they would each
// force a batch break on every change, which for effects — where colour varies per instance,
// and every particle fades on its own clock — would mean roughly one draw call per effect and
// no batching at all. As attributes, a thousand differently-coloured, differently-faded
// effect sprites sharing one texture still collapse into a single draw call.
const FLOATS_PER_VERT = 8;   // x, y, u, v, r, g, b, a
const VERTS_PER_QUAD = 6;    // two triangles, unindexed — simpler and fast enough at this size
const MAX_QUADS = 4096;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

export class SpriteBatch {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    const gl = /** @type {WebGL2RenderingContext} */ (
      canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: false })
    );
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.canvas = canvas;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(prog));
    }
    this.prog = prog;
    this.uResolution = gl.getUniformLocation(prog, 'uResolution');

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_QUADS * VERTS_PER_QUAD * FLOATS_PER_VERT * 4, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_VERT * 4;
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aUV = gl.getAttribLocation(prog, 'aUV');
    const aTint = gl.getAttribLocation(prog, 'aTint');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(aTint);
    gl.vertexAttribPointer(aTint, 4, gl.FLOAT, false, stride, 16);
    gl.bindVertexArray(null);

    // CPU-side staging buffer, written straight through with no per-quad allocation.
    this.data = new Float32Array(MAX_QUADS * VERTS_PER_QUAD * FLOATS_PER_VERT);
    this.count = 0;                  // quads staged
    /** @type {WebGLTexture|null} */ this.boundTex = null;
    /** Current blend mode: 'normal' (source-over) or 'add' (Canvas 2D's 'lighter'). */
    this.blend = 'normal';
    /** @type {Map<any, WebGLTexture>} */ this.texCache = new Map();
    this.stats = { draws: 0, quads: 0 };
  }

  /**
   * Uploads a source canvas/image once and reuses it. Keyed by the object itself, so the
   * sprite system's existing per-frame canvases work unchanged.
   * @param {TexImageSource & object} src
   */
  texture(src) {
    let t = this.texCache.get(src);
    if (t) return t;
    const gl = this.gl;
    t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    // NEAREST both ways: this is pixel art, and any filtering defeats the whole look.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    this.texCache.set(src, t);
    return t;
  }

  begin() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    this.count = 0;
    this.boundTex = null;
    this.blend = 'normal';
    this.stats.draws = 0;
    this.stats.quads = 0;
  }

  /**
   * Switch blend mode. 'add' is the GL equivalent of Canvas 2D's 'lighter' compositing, which
   * is what every glow, ember and beam in the game uses. Changing it breaks the batch, so
   * draw all the normal sprites and then all the additive ones rather than alternating.
   * @param {'normal'|'add'} mode
   */
  setBlend(mode) {
    if (mode === this.blend) return;
    this.flush();
    this.blend = mode;
  }

  /**
   * Stage one sprite. Only a texture change (or a blend-mode change, or filling the buffer)
   * breaks the batch — colour, alpha and rotation are all free, because they are baked into
   * the vertices rather than set as GL state.
   * @param {TexImageSource & object} src source canvas/image
   * @param {number} cx centre x, pixels
   * @param {number} cy centre y, pixels
   * @param {number} w
   * @param {number} h
   * @param {boolean} [flipX]
   * @param {number} [alpha]
   * @param {number} [angle] radians, clockwise, about the centre
   * @param {number} [r] tint multiply 0..1
   * @param {number} [g]
   * @param {number} [b]
   */
  draw(src, cx, cy, w, h, flipX = false, alpha = 1, angle = 0, r = 1, g = 1, b = 1) {
    const tex = this.texture(src);
    if (tex !== this.boundTex || this.count >= MAX_QUADS) {
      this.flush();
      this.boundTex = tex;
    }
    const hw = w / 2, hh = h / 2;
    const u0 = flipX ? 1 : 0, u1 = flipX ? 0 : 1;
    // Corners are transformed here on the CPU rather than via a per-quad matrix uniform: a
    // uniform would force one draw call per rotation, which for spinning effects is every
    // single instance. Four rotations per quad is far cheaper than losing the batch.
    let x0, y0, x1, y1, x2, y2, x3, y3;
    if (angle) {
      const c = Math.cos(angle), s = Math.sin(angle);
      x0 = cx - hw * c + hh * s; y0 = cy - hw * s - hh * c;  // top-left
      x1 = cx + hw * c + hh * s; y1 = cy + hw * s - hh * c;  // top-right
      x2 = cx - hw * c - hh * s; y2 = cy - hw * s + hh * c;  // bottom-left
      x3 = cx + hw * c - hh * s; y3 = cy + hw * s + hh * c;  // bottom-right
    } else {
      x0 = cx - hw; y0 = cy - hh;
      x1 = cx + hw; y1 = y0;
      x2 = x0;      y2 = cy + hh;
      x3 = x1;      y3 = y2;
    }
    const d = this.data;
    let o = this.count * VERTS_PER_QUAD * FLOATS_PER_VERT;
    d[o++] = x0; d[o++] = y0; d[o++] = u0; d[o++] = 0; d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = alpha;
    d[o++] = x1; d[o++] = y1; d[o++] = u1; d[o++] = 0; d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = alpha;
    d[o++] = x2; d[o++] = y2; d[o++] = u0; d[o++] = 1; d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = alpha;
    d[o++] = x1; d[o++] = y1; d[o++] = u1; d[o++] = 0; d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = alpha;
    d[o++] = x3; d[o++] = y3; d[o++] = u1; d[o++] = 1; d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = alpha;
    d[o++] = x2; d[o++] = y2; d[o++] = u0; d[o++] = 1; d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = alpha;
    this.count++;
  }

  flush() {
    if (!this.count || !this.boundTex) { this.count = 0; return; }
    const gl = this.gl;
    const used = this.count * VERTS_PER_QUAD * FLOATS_PER_VERT;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, used);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.boundTex);
    // Both modes take source alpha into account; 'add' simply accumulates into the destination
    // instead of replacing it, which is what makes overlapping glows build up brightness.
    if (this.blend === 'add') gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, this.count * VERTS_PER_QUAD);
    this.stats.draws++;
    this.stats.quads += this.count;
    this.count = 0;
  }

  end() { this.flush(); }

  /** Drop a cached texture when its source canvas is regenerated (sprite art reloaded). */
  invalidate(src) {
    const t = this.texCache.get(src);
    if (t) { this.gl.deleteTexture(t); this.texCache.delete(src); }
  }
}
