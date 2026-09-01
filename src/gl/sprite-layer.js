// @ts-check
// ---------- The sprite band, rendered on the GPU ----------
// Sits between the two Canvas 2D halves of the frame: floor/decals/pickups/effects go down
// first, every character sprite is batched here, then projectiles/status/torchlight go over
// the top.
//
// The sprites render to an OFFSCREEN WebGL canvas which is then blitted into the 2D canvas in
// its correct place in the draw order — rather than being a second stacked <canvas> in the DOM.
// That choice is deliberate and costs one full-screen blit per frame:
//
//   * Compositing keeps working. drawPoisonStatus tints with 'source-atop', and several
//     effects use 'lighter'. Those read whatever is already on the 2D canvas, so the sprites
//     have to actually BE on it by the time they run. Stacked canvases cannot composite
//     against each other and the poison wash would silently stop tinting bodies.
//   * The 2D drawing code does not have to be split across two contexts, which would mean
//     every one of main.js's ~600 ctx2d calls having to pick the right target.
//
// If WebGL2 is unavailable (software rendering, an old GPU) this transparently falls back to
// drawing each sprite straight to the 2D context — same output, original performance.

import { SpriteBatch } from './sprite-batch.js';
import { drawSprite, spriteQuad } from '../sprites.js';

export class SpriteLayer {
  constructor() {
    /** @type {SpriteBatch|null} */ this.batch = null;
    /** @type {HTMLCanvasElement|null} */ this.glCanvas = null;
    /** @type {CanvasRenderingContext2D|null} */ this.ctx = null;
    /** Whether the GPU path is live. False means the 2D fallback is in use. */
    this.enabled = false;
    /** Set when WebGL init throws, so the reason is visible rather than a silent downgrade. */
    this.reason = 'not initialised';
    this.stats = { draws: 0, quads: 0 };
  }

  /** @param {number} w @param {number} h */
  init(w, h) {
    if (this.enabled) return this.resize(w, h);
    try {
      const c = document.createElement('canvas');
      c.width = Math.max(1, w); c.height = Math.max(1, h);
      this.batch = new SpriteBatch(c);
      this.glCanvas = c;
      this.enabled = true;
      this.reason = 'webgl2';
    } catch (err) {
      this.enabled = false;
      this.reason = 'fallback: ' + (err && err.message ? err.message : String(err));
    }
  }

  /** @param {number} w @param {number} h */
  resize(w, h) {
    if (!this.enabled || !this.glCanvas) return;
    if (this.glCanvas.width === w && this.glCanvas.height === h) return;
    this.glCanvas.width = Math.max(1, w);
    this.glCanvas.height = Math.max(1, h);
  }

  /**
   * Open the sprite band. Everything drawn until end() lands on the GPU layer.
   * @param {CanvasRenderingContext2D} ctx the 2D context the band composites into
   */
  begin(ctx, w, h) {
    this.ctx = ctx;
    if (!this.enabled || !this.batch) return;
    // Sized in the caller's LOGICAL units, not the 2D canvas's backing store: under a render
    // scale those differ, and the blit in end() happens through the same base transform. Taking
    // the backing size here would draw the band at the wrong scale on anything but 100%.
    this.resize(w || ctx.canvas.width, h || ctx.canvas.height);
    this.batch.begin();
  }

  /**
   * Same argument order as drawSprite(), minus the context — the layer owns the target.
   * @param {string} id
   * @param {number} x @param {number} y @param {number} targetHeight
   * @param {boolean} [flip] @param {string} [dir] @param {number} [phase] @param {boolean} [exact]
   * @param {number} [alpha]
   * @param {number} [squashX] @param {number} [squashY] non-uniform scale about the quad's
   *   centre, for squash-and-stretch. 1/1 is untouched. The caller owns any anchor correction:
   *   the quad is centred on (x, y), so squashing something that should stay planted needs its
   *   y nudged down by half the height it lost.
   */
  sprite(id, x, y, targetHeight, flip = false, dir = 'side', phase = 0, exact = false, alpha = 1,
         squashX = 1, squashY = 1, tint = null) {
    if (!this.enabled || !this.batch) {
      // Fallback: straight to 2D. Alpha and squash are applied around the call because
      // drawSprite has neither parameter, and adding them would only serve this branch.
      const ctx = this.ctx;
      if (!ctx) return;
      // A tint on the 2D path needs the sprite rendered to a scratch canvas first: drawSprite
      // paints straight into the destination and there is no per-draw colour on 2D. `source-in`
      // fills the sprite's own alpha, so the result is the SILHOUETTE recoloured — which is
      // exactly what a hit flash wants, and it keeps the two renderers agreeing.
      if (tint) {
        const q = spriteQuad(id, targetHeight, flip, dir, phase, exact);
        if (!q) return;
        const sc = tintScratch(q.w, q.h);
        const sg = sc.getContext('2d');
        sg.clearRect(0, 0, sc.width, sc.height);
        sg.globalCompositeOperation = 'source-over';
        sg.drawImage(q.canvas, 0, 0, q.w, q.h);
        sg.globalCompositeOperation = 'source-in';
        sg.fillStyle = `rgb(${Math.round(tint[0] * 255)},${Math.round(tint[1] * 255)},${Math.round(tint[2] * 255)})`;
        sg.fillRect(0, 0, q.w, q.h);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.scale(squashX * (q.flip ? -1 : 1), squashY);
        ctx.drawImage(sc, 0, 0, q.w, q.h, -q.w / 2, -q.h / 2, q.w, q.h);
        ctx.restore();
        return;
      }
      const plain = alpha === 1 && squashX === 1 && squashY === 1;
      if (!plain) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.scale(squashX, squashY);
        drawSprite(ctx, id, 0, 0, targetHeight, flip, dir, phase, exact);
        ctx.restore();
        return;
      }
      drawSprite(ctx, id, x, y, targetHeight, flip, dir, phase, exact);
      return;
    }
    const q = spriteQuad(id, targetHeight, flip, dir, phase, exact);
    if (!q) return;
    // Free on this path: the batcher already takes width and height separately, and it has
    // carried per-quad r/g/b since the effect layer needed them.
    const t = tint || [1, 1, 1];
    this.batch.draw(q.canvas, x, y, q.w * squashX, q.h * squashY, q.flip, alpha, 0, t[0], t[1], t[2]);
  }

  /**
   * An effect sprite: rotatable, tintable, and optionally additive. Kept separate from
   * sprite() because effects want a different set of knobs than characters do — and because
   * effect art is still arriving, so this is the path that grows.
   *
   * Falls back to Canvas 2D with the equivalent transform and 'lighter' compositing, so an
   * effect looks the same whichever renderer is live.
   *
   * @param {string} id
   * @param {number} x @param {number} y @param {number} targetHeight
   * @param {{ angle?: number, alpha?: number, blend?: 'normal'|'add',
   *           tint?: [number, number, number], phase?: number, flip?: boolean }} [opts]
   */
  effect(id, x, y, targetHeight, opts = {}) {
    const { angle = 0, alpha = 1, blend = 'normal', tint, phase = 0, flip = false } = opts;
    if (!this.enabled || !this.batch) {
      const ctx = this.ctx;
      if (!ctx) return;
      const q = spriteQuad(id, targetHeight, flip, 'side', phase, true);
      if (!q) return;
      ctx.save();
      if (blend === 'add') ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      if (angle) ctx.rotate(angle);
      if (q.flip) ctx.scale(-1, 1);
      ctx.drawImage(q.canvas, -q.w / 2, -q.h / 2, q.w, q.h);
      ctx.restore();
      return;
    }
    const q = spriteQuad(id, targetHeight, flip, 'side', phase, true);
    if (!q) return;
    this.batch.setBlend(blend);
    const t = tint || [1, 1, 1];
    this.batch.draw(q.canvas, x, y, q.w, q.h, q.flip, alpha, angle, t[0], t[1], t[2]);
  }

  /** Back to normal compositing. Call after a run of additive effects. */
  normalBlend() { if (this.enabled && this.batch) this.batch.setBlend('normal'); }

  /** Close the band and composite it into the 2D canvas. */
  end() {
    if (!this.enabled || !this.batch || !this.ctx || !this.glCanvas) return;
    this.batch.end();
    this.stats.draws = this.batch.stats.draws;
    this.stats.quads = this.batch.stats.quads;
    // Straight blit, no smoothing: the GL layer is already at device pixel scale, and letting
    // the 2D context filter it here would undo the nearest-neighbour sampling in the shader.
    const prev = this.ctx.imageSmoothingEnabled;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.glCanvas, 0, 0);
    this.ctx.imageSmoothingEnabled = prev;
  }
}

// One scratch canvas for every 2D tint, grown as needed. A fresh canvas per draw would
// allocate on every frame of every flash.
let _tintScratch = null;
function tintScratch(w, h) {
  if (!_tintScratch) _tintScratch = document.createElement('canvas');
  if (_tintScratch.width < w) _tintScratch.width = Math.ceil(w);
  if (_tintScratch.height < h) _tintScratch.height = Math.ceil(h);
  return _tintScratch;
}

export const spriteLayer = new SpriteLayer();
